export interface OssBaseParams {
  uploadHost: string,
  ossPath: string
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

export interface KeysParam {
  path: string,
  fileName: string[]
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
  // oss kes提交方法
  submitKeyFn: (data: KeysParam) => Promise<{result: number}>,
  // 获取oss上传参数接口地址
  preUploadUrl?: string,
  // oss bizType
  bizType?: string,
  // oss 文件路径
  ossPath?: string
  // 是否与本地oss key最后一个合并
  mergeToLast?: boolean
  // oss上传参数获取 自定义方法
  preUploadGet?: (() => Promise<OssBaseParams|null>) | undefined
  // 是否提交本地储存的录制数据
  isSubmitLocal?: boolean,
  // 错误报告
  reportError?: (err: MessageEvent | Error) => void,
  [key: string]: any
}