import 'formdata-polyfill'
import localforage from "localforage";
// @ts-ignore
import {deflate} from "pako/lib/deflate.js";
import {KeysParam, OssBaseParams, OssParam, RecordEvent, Snapshot, WorkerFnKey} from "./types";

/**
 * 生成uuid
 * @return {string}
 */
function getUUID() {
  return 'xxxxxxxx-xyxx-xxxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

localforage.config({
  name: '$$record',
  storeName: '_record_data_',
  description: '储存录屏数据'
});

// 最大事件个数
const maxLength = 100;

// 分批提交的阈值
const submitThrottle = 10;

// 防抖定时器
let debounceTimer = 0;

const LOG_KEY = 'log_events';
const OSS_EVENTS = 'oss_events';
const OSS_KEYS = 'oss_keys';

const worker = {
  ossBaseParams: {} as OssBaseParams,
  recording: false,
  events: [[]] as Array<RecordEvent[]>,
  ossParams: [] as OssParam[], // 待提交的oss参数
  ossKeys: [] as string[], // 阿里云oss文件key
  /**
   * 获取最后一个事件数组
   */
  getLastEvents() {
    return this.events[this.events.length - 1];
  },

  /**
   * 获取提交oss参数
   * @private
   */
  getOssData() {
    const lastEvents = this.getLastEvents();
    const submitEvents = lastEvents.splice(0, submitThrottle);
    const ossFile = deflate(JSON.stringify(submitEvents), {level: 6}).toString();
    const fileName = getUUID()
    const key = this.ossBaseParams.ossPath + fileName
    const params: OssParam = {key, file: ossFile}
    this.ossKeys.push(fileName)
    this.ossParams.push(params)
    if (lastEvents.length > submitThrottle) {
      // 处理没有ossParams时，未处理的event
      this.getOssData()
    }
  },

  /**
   * 数据提交到阿里云
   * 提交失败返回包含提交参数的promise
   * @param params 提交的参数
   * @private
   */
  submitOss(params: OssParam) {
    const ossBaseParams = this.ossBaseParams;
    if (!ossBaseParams) {
      return Promise.resolve(params)
    }
    const {uploadHost, data} = ossBaseParams
    if (!data || !uploadHost) return Promise.resolve(params);
    // 合并顺序不能变  保证file是最后一个
    const _params = Object.assign(data, params);
    let formData = new FormData();
    for (const key in _params) {
      if (!_params.hasOwnProperty(key)) continue;
      formData.append(key, _params[key]);
    }
    return fetch(uploadHost, {
      method: 'POST',
      body: formData
    }).then(res => res.status !== 200 ? Promise.reject('') : false)
      .catch(() => params);
  },

  /**
   * 提交业务需要的录制快照
   * @param lastSubmit 标记用户提交了订单
   * @private
   */
  submitOssParams (lastSubmit = false) {
    const submitPromises = this.ossParams.splice(0, 5)
      .filter(Boolean)
      .map(v => this.submitOss(v));
    Promise.all(submitPromises).then((res) => {
      const failParams = res.filter(Boolean) as OssParam[];
      if (!lastSubmit) {
        this.ossParams = failParams.concat(this.ossParams);
        return;
      }
      // 用户提交订单后  失败的提交全部保存到本地
      this.addLocalData(OSS_EVENTS, failParams, true);
      if (this.ossParams.length > 0) {
        // 提交剩下的录制
        this.submitOssParams(lastSubmit);
        return;
      }
      this.closeWorker();
    });
  },

  /**
   * 提交文件上传oss文件key
   * @param data 要提交的内容
   * @param mergeToLast  是否入最后一个合并
   * @private
   */
  async submitKeys(data: KeysParam[] | null, mergeToLast?: boolean) {
    let body = [] as KeysParam[]
    if (data && data.length > 0) {
      body = data
    } else {
      const path = this.ossBaseParams.ossPath
      const keysParam = (await this.getLocalOssKeys()) || []
      let lastFileName = this.ossKeys
      if (keysParam.length > 0 && mergeToLast) {
        const lastParam = keysParam.pop()
        const canMerge = lastParam && lastParam.path === path
        lastFileName = canMerge ? lastParam.fileName.concat(lastFileName) : lastFileName
      }
      body = keysParam.concat({
        fileName: lastFileName,
        path,
      })
    }
    self.postMessage({
      action: 'submitKey',
      payload: body
    })
  },

  /**
   * key提交失败保存到本地
   */
  async saveKeys(data: KeysParam[]) {
    if (data.length > 0) {
      await this.addLocalData(OSS_KEYS, data, true);
    }
    // fix: 在提交请求执行后再清空 修复在提交keys的时候worker已关闭
    this.ossKeys = [];
    this.closeWorker();
  },

  /**
   * 添加数据到本地
   * @param key 储存的key
   * @param value 储存value
   * @param savaPrv 是否保留之前的数据
   * @private
   */
  async addLocalData(key: string, value: Array<KeysParam | OssParam | RecordEvent>, savaPrv = false) {
    try {
      if (value.length === 0) return
      if (!savaPrv) {
        return localforage.setItem(key, value);
      }
      const oldVal = await localforage.getItem(key)
      const newVal = ((oldVal || []) as Array<OssParam|string|unknown>).concat(value)
      await localforage.setItem(key, newVal)
    } catch (e) {
      this.addLocalData(key, value, savaPrv);
    }
  },

  /**
   * 保存最大日志事件数到本地  5秒钟保存一次
   * @private
   */
  localEvents() {
    const allEvents = this.events.flat().slice(0 - maxLength);
    this.addLocalData(LOG_KEY, allEvents);
  },

  /**
   * 提交本地保存的事件
   */
  async submitLocal() {
    const ossParams = await this.getLocalOssParams()
    const keysParam = await this.getLocalOssKeys()
    if (!ossParams && !keysParam) {
      this.closeWorker();
      return;
    }
    if (ossParams) {
      this.ossParams = this.ossParams.concat(ossParams);
      this.submitOssParams(true);
    }
    if (keysParam) {
      await this.submitKeys(keysParam);
    }
  },

  /**
   * 获取本地oss params
   */
  async getLocalOssParams () {
    return this.getLocalData<OssParam>(OSS_EVENTS)
  },

  /**
   * 获取本地oss keys
   */
  async getLocalOssKeys () {
    return this.getLocalData<KeysParam>(OSS_KEYS)
  },

  /**
   * 获取本地数据
   */
  async getLocalData<T> (name: string) {
    const data = (await localforage.getItem(name).catch(() => null)) as Array<T> | null
    if (!data || data.length === 0) return null
    await localforage.removeItem(name)
    return data
  },

  /**
   * 收集快照
   * @param data
   */
  collectEvent(data: {event: any, isCheckout: boolean}) {
    const {event, isCheckout} = data;
    if (isCheckout) {
      this.events.push([]);
    }
    const lastEvents = this.getLastEvents();
    lastEvents.push(event);
    const lastLength = lastEvents.length;
    if (lastLength > 0 && lastLength % submitThrottle === 0) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.getOssData()
        this.submitOssParams()
      }, 100);
    }
    // clearTimeout(timer);
    // timer = setTimeout(() => {
    //   this.localEvents()
    // }, 5000);
  },

  /**
   * 开始记录投保操作
   * 新开一个数组 重新生成全量快照
   */
  startRecord() {
    this.resetRecord()
    this.recording = true
  },

  /**
   * 用户本次投保结束 提交数据
   */
  submitRecord(payload: { mergeToLast: boolean }) {
    this.recording = false
    this.getOssData()
    this.submitOssParams(true)
    this.submitKeys(null, payload.mergeToLast)
  },

  /**
   * 重置录制
   */
  resetRecord() {
    this.ossParams = [];
    this.ossKeys = [];
    this.recording = false;
  },

  /**
   * 初始化
   */
  setOssBaseParams(payload: OssBaseParams) {
    this.ossBaseParams = payload;
  },

  /**
   * 暂停录制 获取当前录制内容
   */
  getSnapshot() {
    self.postMessage({
      action: 'postSnapshot',
      payload: {
        events: this.events,
        ossParams: this.ossParams,
        ossKeys: this.ossKeys
      }
    });
  },

  /**
   * 恢复录制 获取暂停前的录制内容
   */
  resumeSnapshot(payload: Snapshot) {
    const {events, ossParams, ossKeys} = payload;
    this.recording = true
    this.events = events
    this.ossParams = ossParams
    this.ossKeys = ossKeys
  },

  /**
   * 关闭web worker
   */
  closeWorker() {
    if (this.recording) {
      return
    }
    // 因为是分开提交 判断都提交完后再关闭
    const el = ([] as Array<OssParam|string>).concat(this.ossParams, this.ossKeys);
    if (el.length > 0) return;
    this.resetRecord();
    self.postMessage({
      action: 'closeWorker'
    })
  }
}

self.onmessage = function (e) {
  const {action, payload} = e.data
  try {
    worker[action as WorkerFnKey](payload || {})
  } catch (e) {
    self.postMessage({
      action: 'reportError',
      payload: e
    })
  }
};
