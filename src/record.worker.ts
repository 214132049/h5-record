import 'formdata-polyfill'
import localforage from "localforage";
// @ts-ignore
import {deflate} from "pako/lib/deflate.js";
import {
  OssBaseParams,
  OssParam,
  OtherSubmitData,
  RecordEvent,
  Snapshot,
  SubmitKeysData,
  WorkerFnKey
} from "./types";
import {fetchJson, isPlainObject} from "./utils";

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
  name: 'ins-record',
  storeName: 'recordData',
  description: '储存录屏数据'
});

// 最大事件个数
const maxLength = 100;

// 分批提交的阈值
const submitThrottle = 10;

const LOG_KEY = 'log_events';
const OSS_EVENTS = 'oss_events';
const OSS_KEYS = 'oss_keys';

// 最后提交时调用次数 为0时关闭worker 保证所有提交都处理完成
let submitCount = 0;

const worker = {
  ossBaseParams: {} as OssBaseParams,
  recording: false,
  otherData: {} as OtherSubmitData,
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
    if (!this.ossBaseParams.ossPath) {
      return;
    }
    const lastEvents = this.getLastEvents();
    const submitEvents = lastEvents.splice(0, submitThrottle);
    const ossFile = deflate(JSON.stringify(submitEvents), {level: 6}).toString();
    const fileName = this.otherData.h5Version + '$$' + getUUID()
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
  async submitOss(params: OssParam) {
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
    try {
      this.logger({message: '[Start upload]', data: params.key});
      const res = await fetch(uploadHost, {
        method: 'POST',
        body: formData
      });
      if (!res || res.status !== 200) {
        throw new Error('上传失败')
      }
      const checkRes = await fetchJson(this.otherData.checkUrl, {
        bizType: this.otherData.bizType,
        keyList: [params.key]
      })
      this.logger({message: '[Check Result]', data: checkRes.content});
      if (checkRes.result !== 1 || checkRes.content.length === 0) {
        throw new Error('文件校验失败')
      }
      return false;
    } catch (e) {
      this.logger({message: (e as ErrorEvent).message, data: params});
      return params;
    }
  },
  
  /**
   * 提交业务需要的录制快照
   * @param lastSubmit 标记用户提交了订单
   * @private
   */
  submitOssParams(lastSubmit = false) {
    if (lastSubmit) {
      submitCount += 1
    }
    const submitPromises = this.ossParams.splice(0, 5).map(v => this.submitOss(v));
    Promise.all(submitPromises).then((res) => {
      const failParams = res.filter(Boolean) as OssParam[];
      if (!lastSubmit) {
        this.ossParams = failParams.concat(this.ossParams);
        return;
      }
      submitCount -= 1
      // 用户提交订单后  失败的提交全部保存到本地
      this.addLocalData(OSS_EVENTS, failParams, true);
      if (this.ossParams.length > 0) {
        // 提交剩下的录制
        this.submitOssParams(lastSubmit);
        return;
      }
      if (submitCount > 0) {
        return;
      }
      this.logger('[Close Worker submitOssParams]');
      this.closeWorker();
    });
  },
  
  /**
   * 提交文件上传oss文件key
   * @param data 要提交的内容
   * @private
   */
  async submitKeys(data: SubmitKeysData[]) {
    if (data.length === 0) {
      return
    }
    self.postMessage({
      action: 'submitKey',
      payload: data
    })
  },
  
  /**
   * key提交失败保存到本地
   */
  async saveKeys(data: SubmitKeysData[]) {
    if (data.length > 0) {
      await this.addLocalData(OSS_KEYS, data, true);
    }
    // fix: 在提交请求执行后再清空 修复在提交keys的时候worker已关闭
    this.ossKeys = [];
    this.logger('[Close Worker saveKeys]');
    this.closeWorker();
  },
  
  /**
   * 添加数据到本地
   * @param key 储存的key
   * @param value 储存value
   * @param savaPrv 是否保留之前的数据
   * @private
   */
  async addLocalData(key: string, value: Array<SubmitKeysData | OssParam | RecordEvent>, savaPrv = false) {
    try {
      if (value.length === 0) return
      if (!savaPrv) {
        return localforage.setItem(key, value);
      }
      const oldVal = await localforage.getItem(key)
      const newVal = ((oldVal || []) as Array<OssParam | SubmitKeysData | RecordEvent | unknown>).concat(value)
      this.logger({message: '[addLocalData]' + key, data: newVal});
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
   * 提交本地保存的数据和最新产生的数据
   */
  async submitLocalAndLatest(params: { lastSubmit?: boolean, data?: SubmitKeysData[] }) {
    const {lastSubmit = false, data = []} = params
    const ossParams = await this.getLocalOssParams() || []
    let keysParam = await this.getLocalOssKeys() || []
    keysParam = keysParam.concat(data)
    if (!lastSubmit && ossParams.length === 0 && keysParam.length === 0) {
      this.closeWorker();
      return;
    }
    this.ossParams = this.ossParams.concat(ossParams)
    if (this.ossParams.length > 0) {
      this.submitOssParams(true);
    }
    if (lastSubmit) {
      keysParam.push({
        path: this.ossBaseParams.ossPath,
        fileName: this.ossKeys,
        ...this.otherData
      })
    }
    this.submitKeys(keysParam);
  },
  
  /**
   * 获取本地oss params
   */
  async getLocalOssParams() {
    return this.getLocalData<OssParam>(OSS_EVENTS)
  },
  
  /**
   * 获取本地oss keys
   */
  async getLocalOssKeys() {
    return this.getLocalData<SubmitKeysData>(OSS_KEYS)
  },
  
  /**
   * 获取本地数据
   */
  async getLocalData<T>(name: string) {
    const data = (await localforage.getItem(name).catch(() => null)) as Array<T> | null
    if (!data || data.length === 0) return null
    await localforage.removeItem(name)
    return data
  },
  
  /**
   * 收集快照
   * @param data
   */
  collectEvent(data: { event: any, isCheckout: boolean }) {
    const {event, isCheckout} = data;
    if (isCheckout) {
      this.events.push([]);
    }
    const lastEvents = this.getLastEvents();
    lastEvents.push(event);
    const lastLength = lastEvents.length;
    if (lastLength > 0 && lastLength % submitThrottle === 0) {
      this.getOssData()
      this.submitOssParams()
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
  startRecord(payload: OtherSubmitData) {
    this.resetRecord()
    this.setOtherData(payload)
    this.recording = true
  },
  
  /**
   * 用户本次投保结束 提交数据
   */
  async submitRecord(payload: OtherSubmitData) {
    this.recording = false
    this.setOtherData(payload)
    this.getOssData()
    this.submitLocalAndLatest({lastSubmit: true})
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
   * 设置oss提交参数
   */
  setOssBaseParams(payload: OssBaseParams) {
    this.ossBaseParams = payload;
  },
  
  /**
   * 设置业务其他参数
   */
  setOtherData(payload: OtherSubmitData) {
    const data = isPlainObject(payload) ? payload : {}
    this.otherData = {...this.otherData, ...data}
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
        ossKeys: this.ossKeys,
        otherData: this.otherData,
        ossBaseParams: this.ossBaseParams
      }
    });
  },
  
  /**
   * 恢复录制 获取暂停前的录制内容
   */
  resumeSnapshot(payload: Snapshot) {
    const {events, ossParams, ossKeys, otherData, ossBaseParams} = payload || {};
    this.recording = true
    this.events = events
    this.ossParams = ossParams
    this.ossKeys = ossKeys
    this.otherData = otherData
    this.ossBaseParams = ossBaseParams
  },
  
  /**
   * 关闭web worker
   */
  closeWorker() {
    if (this.recording) {
      return
    }
    // 因为是分开提交 判断都提交完后再关闭
    const el = ([] as Array<OssParam | string>).concat(this.ossParams, this.ossKeys);
    this.logger({
      message: '[Close Worker]',
      data: this.ossParams.length + '-' + this.ossKeys.length + '-' + submitCount
    });
    if (el.length > 0 || submitCount > 0) return;
    this.resetRecord();
    this.otherData = {} as OtherSubmitData
    self.postMessage({
      action: 'closeWorker'
    })
  },
  
  logger(message: string | { message: string, data: any }) {
    let payload = typeof message === 'string' ? {message} : message
    try {
      self.postMessage({
        action: 'reportError',
        payload: JSON.stringify(payload)
      })
    } finally {
    }
  }
}

self.onmessage = function (e) {
  const {action, payload} = e.data
  try {
    worker[action as WorkerFnKey](payload)
  } catch (e) {
    self.postMessage({
      action: 'reportError',
      payload: (e as ErrorEvent).message
    })
  }
};
