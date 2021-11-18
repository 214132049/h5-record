// @ts-ignore
import RecordWorker from 'web-worker:./record.worker.ts'
// @ts-ignore
import record from './rrweb-record'
import {getUploadParams, isArray, noop} from "./utils";
import {
  HandleError,
  HandleSubmit,
  OssBaseParams,
  OtherSubmitData,
  RecordOptions,
  Snapshot,
  SubmitKeysData,
  WorkerCallback
} from "./types";

// 关闭worker定时器
let closeWorkerTimer: number;

export default class Record {
  // 录制实例
  private static _instance: Record
  // oss bizType
  private static _bizType: string | undefined
  // oss 文件路径
  private static _ossPath: string | undefined
  // 获取oss上传参数接口地址
  private static _preUploadUrl: string | undefined
  // oss上传参数获取 自定义方法
  private static _preUploadGet: (() => Promise<OssBaseParams | null>) | undefined
  // 检测oss上传结果接口地址
  private static _checkUploadUrl: string | undefined
  // 录制项目信息
  private static _projectInfo: string | undefined
  // 录制参数
  private static _recordOptions: any
  // oss kes提交方法
  private static _handleSubmit: HandleSubmit | undefined
  // 停止录制
  private static _stopRecord: null | (() => void)
  // worker实例
  private static _worker: Worker | null
  // 录制快照
  private static _snapshot: null | Snapshot
  // 错误捕捉方法
  private static _reportError: HandleError = noop
  // oss key提交后的回调
  private static _successCallback: () => any
  
  constructor(options: RecordOptions) {
    if (Record._instance) {
      return Record._instance;
    }
    Record._init(options)
    Record._instance = this;
  }
  
  /**
   * 初始化参数
   * @param {Object} options 配置参数
   * @private
   */
  private static _init(options: RecordOptions) {
    const {
      preUploadUrl = '',
      bizType = '',
      preUploadGet,
      isSubmitLocal = true,
      checkUploadUrl = '',
      handleSubmit,
      ossPath = '',
      name = '',
      version = '',
      reportError = noop,
      ...recordOptions
    } = options;
    try {
      this._checkOptions(options)
    } catch (e) {
      console.error('[录制SDK实例化失败]:' + (e as Error).message)
      return
    }
    this._stopRecord = null;
    this._worker = null;
    this._bizType = bizType;
    this._ossPath = ossPath;
    this._preUploadUrl = preUploadUrl;
    this._preUploadGet = preUploadGet;
    this._checkUploadUrl = checkUploadUrl;
    this._snapshot = null
    this._projectInfo = name + '$$' + version
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
      this._initSubmit()
    }
  }
  
  /**
   * 检查初始化参数
   * @param {Object} options  初始化参数
   * @private
   */
  private static _checkOptions(options: RecordOptions) {
    if (!options.name || !options.version) {
      throw new Error('请提供项目名以及版本号')
    }
    if (!options.bizType) {
      throw new Error('请提供OSS上传bizType')
    }
    if (!options.preUploadUrl) {
      throw new Error('请提供获取oss上传参数接口地址')
    }
    if (!options.checkUploadUrl) {
      throw new Error('请提供检测oss上传结果接口地址')
    }
  }
  
  /**
   * 创建worker
   * @private
   */
  private static _createWorker(): Worker | null {
    if (!window.Worker) {
      new Error('你的当前运行环境不支持web worker');
      return null;
    }
    const worker: Worker = new RecordWorker();
    worker.onmessageerror = (e: MessageEvent) => {
      typeof this._reportError === 'function' && this._reportError(e)
    };
    worker.onmessage = this._workerMessageHandler.bind(this);
    return worker
  }
  
  /**
   * worker onmessage函数
   * @param {MessageEvent} e postMessage事件
   * @private
   */
  private static _workerMessageHandler(e: MessageEvent) {
    const {action, payload} = e.data;
    const fnMap: WorkerCallback = {
      submitKey: async (payload: SubmitKeysData[]) => {
        const keyPromise = payload.map(v => this._submitKeyServer(v));
        const res = await Promise.all(keyPromise);
        const failParams = res.filter(Boolean);
        this._worker && this._worker.postMessage({
          action: 'saveKeys',
          payload: failParams
        });
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
   * @param {boolean} [onlyWorker=false] 是否仅创建worker
   * @private
   */
  private static _initWorker(onlyWorker: boolean = false) {
    if (this._worker) {
      return
    }
    this._worker = this._createWorker();
    this._worker && this._worker.postMessage({
      action: 'setOtherData',
      payload: {
        h5Version: this._projectInfo,
        checkUrl: this._checkUploadUrl,
        bizType: this._bizType
      }
    });
    if (this._ossPath) {
      this._worker && this._worker.postMessage({
        action: 'setOssBaseParams',
        payload: {
          ossPath: this._ossPath
        }
      });
    }
    if (onlyWorker) return;
    getUploadParams(this._preUploadUrl, this._bizType, this._preUploadGet).then((res: OssBaseParams | null) => {
      if (!res) return
      if (this._ossPath) {
        res.ossPath = this._ossPath
      } else {
        // 没有设置ossPath时
        this._ossPath = res.ossPath
      }
      this._worker && this._worker.postMessage({
        action: 'setOssBaseParams',
        payload: res
      });
    })
  }
  
  /**
   * 关闭web worker
   * @private
   */
  private static _closeWorker() {
    this._worker && this._worker.terminate()
    this._worker = null
  }
  
  /**
   * 检测用户是否有操作
   * 一定时间内没有操作 暂时关闭web worker 释放内存
   * @param {number} time 定时器时间
   * @private
   */
  private static _suspendWorker(time: number = 0) {
    clearTimeout(closeWorkerTimer);
    closeWorkerTimer = setTimeout(() => {
      this._worker && this._worker.postMessage({
        action: 'getSnapshot'
      });
    }, time * 1000);
  }
  
  /**
   * 重启web worker 并向新worker传递暂停之前的内容
   * @private
   */
  private static _resumeWorker() {
    this._initWorker();
    if (this._snapshot) {
      this._worker && this._worker.postMessage({
        action: 'resumeSnapshot',
        payload: this._snapshot
      });
      this._snapshot = null;
    }
  }
  
  /**
   * 开始录制
   * @private
   */
  private static _startRecord() {
    this._stopRecord = record(this._recordOptions);
  }
  
  /**
   * 关闭录制
   * @private
   */
  private static _closeRecord() {
    this._stopRecord && this._stopRecord()
    this._stopRecord = null
  }
  
  /**
   * 收集快照
   * @param {Object} event 快照
   * @param {boolean} isCheckout // isCheckout 是一个标识，说明重新制作了快照
   */
  private static _collectEvent(event: any, isCheckout?: boolean) {
    this._suspendWorker(5);
    this._resumeWorker();
    this._worker && this._worker.postMessage({
      action: 'collectEvent',
      payload: {
        event,
        isCheckout
      }
    });
  }
  
  /**
   * 提交oss key
   * @param {SubmitKeysData} data 录制数据
   */
  private static _submitKeyServer(data: SubmitKeysData) {
    try {
      const fn = this._handleSubmit
      if (typeof fn !== 'function') {
        throw new Error('handleSubmit不是函数')
      }
      const result = fn(data)
      if (!result || !result.then) {
        throw new Error('handleSubmit返回不符合要求')
      }
      return result.then(() => false).catch(() => data)
    } catch (e) {
      console.error('[oss Key提交失败]:', (e as Error).message)
      this._reportError((e as Error).message)
      return Promise.resolve(data)
    }
  }
  
  /**
   * 不需要录制时 初始化提交
   * @param {Array<SubmitKeysData>} data 录制数据
   * @private
   */
  private static _initSubmit(data: SubmitKeysData[] = []) {
    this._initWorker(data.length > 0)
    this._worker && this._worker.postMessage({
      action: 'submitLocalAndLatest',
      payload: {
        data
      }
    });
  }
  
  /**
   * 不录制只提交数据
   * @param {Object} params 函数参数
   * @param {Array[]} params.data 录制数据
   * @param {Function} [params.handleSubmit]  提交函数
   * @param {Function} [params.successCallback=()=>{}] 成功回调函数
   * @param {Function} [params.handleError=()=>{}] 成功回调函数
   */
  static startWorkerAndSubmit(params: {
    data: SubmitKeysData[],
    handleSubmit?: HandleSubmit,
    successCallback?: () => void,
    bizType?: string,
    checkUploadUrl?: string,
    handleError?: HandleError
  }) {
    const {data, handleSubmit, successCallback = noop, handleError, bizType, checkUploadUrl} = params
    if (!data) return
    if (!bizType && !this._bizType) {
      throw new Error('请提供OSS上传bizType')
    }
    if (!checkUploadUrl && !this._checkUploadUrl) {
      throw new Error('请提供检测oss上传结果接口地址')
    }
    this._bizType = bizType || this._bizType
    this._checkUploadUrl = checkUploadUrl || this._checkUploadUrl
    let oldHandleSubmit: HandleSubmit | undefined = undefined
    if (handleSubmit) {
      oldHandleSubmit = this._handleSubmit
      this._handleSubmit = handleSubmit
    }
    let oldHandleError: HandleError | undefined = undefined
    if (handleError && typeof handleError === 'function') {
      oldHandleError = this._reportError
      this._reportError = handleError
    }
    const _data = isArray(data) ? data : [data]
    this._successCallback = () => {
      if (oldHandleSubmit) {
        this._handleSubmit = oldHandleSubmit
      }
      if (oldHandleError) {
        this._reportError = oldHandleError
      }
      typeof successCallback === "function" && successCallback()
    }
    this._initSubmit(_data as SubmitKeysData[])
  }
  
  /**
   * 开始记录操作
   * @param {Object} data 开始录制时 设置额外提交参数
   */
  startRecord(data?: OtherSubmitData) {
    Record._initWorker();
    Record._worker && Record._worker.postMessage({
      action: 'startRecord',
      payload: data
    });
    if (Record._stopRecord) {
      Record._reportError("重新获取全量快照")
      this.takeFullSnapshot();
    } else {
      Record._reportError("开始录制")
      Record._startRecord()
    }
  }
  
  /**
   * 关闭录制
   */
  closeRecord() {
    Record._closeRecord()
    Record._closeWorker();
  }
  
  /**
   * 继续录制
   */
  resumeRecord() {
    Record._resumeWorker();
    Record._startRecord()
  }
  
  /**
   * 暂停录制
   */
  suspendRecord() {
    Record._closeRecord()
    Record._suspendWorker()
  }
  
  /**
   * 重新生成全量快照
   */
  takeFullSnapshot() {
    record.takeFullSnapshot(true)
  }
  
  /**
   * 设置上传方法 初始化没有提供oss key上传,可以通过此方法设置
   * @param action 录制数据提交函数
   */
  setHandleSubmit(action: HandleSubmit) {
    Record._handleSubmit = action
  }
  
  /**
   * 用户本次投保结束 提交数据
   * @param {Object} data 提交时额外参数
   * @param {Function} [successCallback=()=>{}] 提交执行完后的回调
   */
  submitRecord(data: OtherSubmitData = {} as OtherSubmitData, successCallback = noop) {
    if (!Record._stopRecord) {
      typeof successCallback === "function" && successCallback()
      return
    }
    Record._closeRecord()
    clearTimeout(closeWorkerTimer)
    Record._resumeWorker()
    if (typeof successCallback === "function") {
      Record._successCallback = successCallback
    }
    Record._reportError("提交录制")
    Record._worker && Record._worker.postMessage({
      action: 'submitRecord',
      payload: data
    });
  }
}
