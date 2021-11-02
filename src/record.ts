// @ts-ignore
import RecordWorker from 'web-worker:./record.worker.ts'
// @ts-ignore
import record from './rrweb-record'
import {getUploadParams, noop} from "./utils";
import {
  OssBaseParams,
  OtherSubmitData,
  RecordOptions,
  Snapshot,
  SubmitKeysData,
  WorkerCallback
} from "./types";

/**
 * 创建worker
 */
function createWorker(): Worker {
  if (!window.Worker) {
    new Error('你的当前运行环境不支持web worker')
  }
  return new RecordWorker();
}

// 关闭worker定时器
let closeWorkerTimer: number;

export default class Record {
  // 录制实例
  private static _instance: Record
  // 获取oss上传参数接口地址
  private _preUploadUrl: string | undefined
  // oss bizType
  private _bizType: string | undefined
  // oss 文件路径
  private _ossPath: string | undefined
  // 是否与本地oss key最后一个合并
  private _mergeToLast: boolean | undefined
  // oss上传参数获取 自定义方法
  private _preUploadGet: (() => Promise<OssBaseParams | null>) | undefined
  // 录制参数
  private _recordOptions: any
  // oss kes提交方法
  private _handleSubmit: ((data: SubmitKeysData) => Promise<void>) | undefined
  // 停止录制
  private _stopRecord!: null | (() => void)
  // worker实例
  private _worker!: Worker | null
  // 录制快照
  private _snapshot!: null | Snapshot
  // 错误捕捉方法
  private _reportError!: (err: MessageEvent | Error) => void
  // oss key提交后的回调
  private _successCallback!: () => any

  constructor(options: RecordOptions) {
    if (Record._instance) {
      return Record._instance;
    }
    this._init(options)
    Record._instance = this;
  }

  _init(options: RecordOptions) {
    const {
      preUploadUrl = '',
      bizType = '',
      preUploadGet,
      isSubmitLocal = true,
      handleSubmit,
      ossPath = '',
      mergeToLast = false,
      reportError = noop,
      ...recordOptions
    } = options;
    Record._checkOptions(options)
    this._stopRecord = null;
    this._preUploadUrl = preUploadUrl;
    this._ossPath = ossPath;
    this._bizType = bizType;
    this._mergeToLast = Boolean(mergeToLast);
    this._preUploadGet = preUploadGet;
    this._snapshot = null
    this._successCallback = noop
    this._handleSubmit = handleSubmit;
    this._reportError = reportError;
    this._recordOptions = {
      blockClass: /(^rr-block$)|(^__vconsole$)|(^eruda-container$)/,
      blockSelector: '#__vconsole',
      inlineStylesheet: false,
      recordLog: false,
      ...recordOptions,
      emit: this._collectEvent.bind(this),
    };
    if (isSubmitLocal) {
      this._initWorker()
      this._worker?.postMessage({
        action: 'submitLocal'
      });
    }
  }

  private static _checkOptions(options: RecordOptions) {
    if (!options.bizType) {
      throw new Error('请提供OSS上传bizType')
    }
    if (!options.preUploadUrl) {
      throw new Error('请提供获取oss上传参数接口地址')
    }
    if (typeof options.handleSubmit !== 'function') {
      console.error('没有实现上传oss key方法, 数据将保存到本地!!!')
    }
  }

  private _workerMessageHandler(e: MessageEvent) {
    const {action, payload} = e.data;
    const fnMap: WorkerCallback = {
      submitKey: (payload: SubmitKeysData[]) => {
        const keyPromise = payload.map(v => this._submitKeyServer(v))
        Promise.all(keyPromise).then(res => {
          const failParams = res.filter(Boolean)
          this._worker?.postMessage({
            action: 'saveKeys',
            payload: failParams
          });
        })
      },
      postSnapshot: (payload: Snapshot) => {
        this._snapshot = payload;
        this._closeWorker();
      },
      closeWorker: () => {
        this._closeWorker()
        try {
          this._successCallback()
          this._successCallback = noop
        } catch (e) {
        }
      },
      reportError: this._reportError
    };
    fnMap[action as keyof WorkerCallback](payload);
  }

  /**
   * 初始化web worker
   */
  private _initWorker() {
    if (this._worker) {
      return
    }
    this._worker = createWorker();
    this._worker.onmessageerror = (e: MessageEvent) => {
      typeof this._reportError === 'function' && this._reportError(e)
    };
    this._worker.onmessage = this._workerMessageHandler.bind(this);
    getUploadParams(this._preUploadUrl, this._bizType, this._preUploadGet).then((res: OssBaseParams | null) => {
      if (!res) return
      if (this._ossPath) {
        res.ossPath = this._ossPath
      }
      this._worker?.postMessage({
        action: 'setOssBaseParams',
        payload: res
      });
    })
  }

  /**
   * 关闭web worker
   */
  private _closeWorker() {
    this._worker?.terminate()
    this._worker = null
  }

  /**
   * 检测用户是否有操作
   * 一定时间内没有操作 暂时关闭web worker 释放内存
   */
  _suspendWorker(time: number = 5) {
    clearTimeout(closeWorkerTimer);
    closeWorkerTimer = setTimeout(() => {
      this._worker?.postMessage({
        action: 'getSnapshot'
      });
    }, time * 1000);
  }

  /**
   * 重启web worker 并向新worker传递暂停之前的内容
   */
  private _resumeWorker() {
    this._initWorker();
    if (this._snapshot) {
      this._worker?.postMessage({
        action: 'resumeSnapshot',
        payload: this._snapshot
      });
      this._snapshot = null;
    }
  }

  /**
   * 开始录制
   */
  private _startRecord() {
    this._stopRecord = record(this._recordOptions);
  }

  /**
   * 关闭录制
   */
  private _closeRecord() {
    this._stopRecord && this._stopRecord()
    this._stopRecord = null
  }

  /**
   * 收集快照
   * @param event 快照
   * @param isCheckout // isCheckout 是一个标识，说明重新制作了快照
   */
  private _collectEvent(event: any, isCheckout?: boolean) {
    this._suspendWorker();
    this._resumeWorker();
    this._worker?.postMessage({
      action: 'collectEvent',
      payload: {
        event,
        isCheckout
      }
    });
  }

  /**
   * 提交oss key
   * @param {SubmitKeysData} data
   */
  private _submitKeyServer(data: SubmitKeysData) {
    const fn = this._handleSubmit
    if (typeof fn !== 'function') {
      return Promise.resolve(data)
    }
    return fn(data).then(() => false).catch(() => data)
  }

  /**
   * 开始记录操作
   * @param data 开始录制时 设置额外提交参数
   */
  startRecord(data: OtherSubmitData) {
    this._initWorker();
    this._worker?.postMessage({
      action: 'startRecord',
      payload: data
    });
    this._startRecord()
  }

  /**
   * 关闭录制
   */
  closeRecord() {
    this._closeRecord()
    this._closeWorker();
  }

  /**
   * 继续录制
   */
  resumeRecord() {
    this._initWorker()
    if (this._snapshot) {
      this._worker?.postMessage({
        action: 'resumeSnapshot',
        payload: this._snapshot
      });
      this._snapshot = null;
    }
    this._startRecord()
  }

  /**
   * 暂停录制
   */
  suspendRecord() {
    this._closeRecord()
    this._suspendWorker()
  }

  /**
   * 重新生成全量快照
   */
  takeFullSnapshot() {
    if (this._stopRecord) return
    record.takeFullSnapshot(true)
  }

  /**
   * 设置上传方法 初始化没有提供oss key上传,可以通过此方法设置
   */
  setHandleSubmit(action: (data: SubmitKeysData) => Promise<void>) {
    if (typeof action !== 'function') {
      return
    }
    this._handleSubmit = action
  }

  /**
   * 用户本次投保结束 提交数据
   * @param data 提交时额外参数
   * @param successCallback 提交执行完后的回调
   */
  submitRecord(data: OtherSubmitData = {}, successCallback = noop) {
    if (!this._stopRecord) return
    this._closeRecord()
    clearTimeout(closeWorkerTimer)
    if (typeof successCallback === "function") {
      this._successCallback = successCallback
    }
    this._worker?.postMessage({
      action: 'submitRecord',
      payload: {
        mergeToLast: this._mergeToLast,
        data
      }
    });
  }
}
