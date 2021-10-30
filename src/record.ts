// @ts-ignore
import RecordWorker from 'web-worker:./record.worker.ts'
// @ts-ignore
import record from './rrweb-record'
import {getUploadParams, noop} from "./utils";
import {OssBaseParams, RecordOptions, Snapshot, WorkerCallback} from "./types";

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
  private _fetchUrl: string | undefined
  // oss bizType
  private _bizType: string | undefined
  // oss 文件路径
  private _ossPath: string | undefined
  // oss上传参数获取 自定义方法
  private _customGet: (() => Promise<OssBaseParams | null>) | undefined
  // 录制参数
  private _recordOptions: any
  // oss kes提交方法
  private _submitKeyFn!: (data: string[]) => Promise<{ result: number }>
  // 停止录制
  private _stopRecord!: null | (() => void)
  // worker实例
  private _worker!: Worker | null
  // 录制快照
  private _snapshot!: null | Snapshot
  // 错误捕捉方法
  private _reportError!: (err: MessageEvent | Error) => void
  // oss key提交后的回调
  private _submitCallback!: () => any

  constructor(options: RecordOptions) {
    if (Record._instance) {
      return Record._instance;
    }
    this._init(options)
    Record._instance = this;
  }

  _init(options: RecordOptions) {
    const {
      url = '',
      bizType = '',
      customGet,
      isSubmitLocal = true,
      submitKeyFn,
      ossPath = '',
      reportError = noop,
      ...recordOptions
    } = options;
    Record._checkOptions(options)
    this._stopRecord = null;
    this._fetchUrl = url;
    this._ossPath = ossPath;
    this._bizType = bizType;
    this._customGet = customGet;
    this._snapshot = null
    this._submitCallback = noop
    this._submitKeyFn = submitKeyFn;
    this._reportError = reportError;
    this._recordOptions = {
      ...recordOptions,
      blockClass: /(^rr-block$)|(^__vconsole$)|(^eruda-container$)/,
      blockSelector: '#__vconsole',
      inlineStylesheet: false,
      emit: this._collectEvent.bind(this),
      recordLog: false,
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
    if (!options.url) {
      throw new Error('请提供获取oss上传参数接口地址')
    }
  }

  private _workerMessageHandler(e: MessageEvent) {
    const {action, payload} = e.data;
    const fnMap: WorkerCallback = {
      submitKey: (payload: any[]) => {
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
          this._submitCallback()
          this._submitCallback = noop
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
    getUploadParams(this._fetchUrl, this._bizType, this._customGet).then((res: OssBaseParams | null) => {
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
   * @param {string[]} data oss文件keys
   * @return Promise<Boolean|T>
   */
  private _submitKeyServer(data: string[]) {
    const fn = this._submitKeyFn
    if (typeof fn !== 'function') {
      console.error('请实现上传oss key方法')
      return Promise.resolve(data)
    }
    return fn(data)
      .then(({result}) => result !== 1 ? Promise.reject('提交失败') : false)
      .catch(() => data)
  }

  /**
   * 开始记录投保操作
   * 新开一个数组 重新生成全量快照
   */
  startRecord() {
    this._initWorker();
    this._worker?.postMessage({
      action: 'startRecord'
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
   * 获取全量快照
   */
  takeFullSnapshot() {
    if (this._stopRecord) return
    record.takeFullSnapshot(true)
  }

  /**
   * 用户本次投保结束 提交数据
   * @param submitCallback 提交执行完后的回调
   */
  submitRecord(submitCallback = noop) {
    if (!this._stopRecord) return
    this._closeRecord()
    clearTimeout(closeWorkerTimer)
    if (typeof submitCallback === "function") {
      this._submitCallback = submitCallback
    }
    this._worker?.postMessage({
      action: 'submitRecord'
    });
  }
}
