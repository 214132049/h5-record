export interface OssBaseParams {
  uploadHost: string,
  data: {
    [key: string]: any
  }
}

export interface RecordEvent {
  [key: string]: any
}

export interface OssParam {
  key: string,
  file: string
}

export interface Snapshot {
  events: Array<RecordEvent[]>,
  ossParams: OssParam[],
  ossKeys: string[]
}

export type WorkerFnKey = 'submitLocal' | 'setOssBaseParams' | 'saveKeys' | 'getSnapshot' | 'resumeSnapshot' | 'collectEvent' | 'startRecord' | 'submitRecord'

export interface WorkerCallback {
  submitKey: (payload: any[]) => void,
  postSnapshot: (payload: Snapshot) => void,
  closeWorker: () => void,
  reportError: (err: Error | MessageEvent) => void
}

export interface RecordOptions {
  // 获取oss上传参数接口地址
  url: string,
  // oss bizType
  bizType: string,
  // oss上传参数获取 自定义方法
  customGet: () => Promise<OssBaseParams|null>
  // oss kes提交方法
  submitKeyFn: (data: string[]) => Promise<{result: number}>,
  // 是否提交本地储存的录制数据
  isSubmitLocal?: boolean,
  // 错误报告
  reportError?: (err: MessageEvent | Error) => void,
  [key: string]: any
}