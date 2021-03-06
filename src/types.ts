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

export interface OtherSubmitData {
  bizType: string,
  h5Version: string,
  checkUrl: string,
  [key: string]: any
}

export type SubmitKeysData = {
  path: string,
  fileName: string[]
} & OtherSubmitData

export interface Snapshot {
  events: Array<RecordEvent[]>,
  ossParams: OssParam[],
  ossKeys: string[],
  otherData: OtherSubmitData,
  ossBaseParams: OssBaseParams
}

export type WorkerFnKey = 'submitLocalAndLatest' | 'setOssBaseParams' | 'saveKeys' | 'getSnapshot' | 'resumeSnapshot' | 'collectEvent' | 'startRecord' | 'submitRecord' | 'setOtherData'

export interface WorkerCallback {
  submitKey: (payload: SubmitKeysData[]) => void,
  postSnapshot: (payload: Snapshot) => void,
  closeWorker: () => void,
  reportError: (val: any) => void
}

export type HandleSubmit = (data: SubmitKeysData) => Promise<void>

export type HandleError = (message: any) => void

export interface RecordOptions {
  // 项目名
  name: string,
  // 版本号
  version: string,
  // oss kes提交方法
  handleSubmit: HandleSubmit,
  // 获取oss上传参数接口地址
  preUploadUrl?: string,
  // oss bizType
  bizType?: string,
  // oss 文件路径
  ossPath?: string
  // oss上传参数获取 自定义方法
  preUploadGet?: (() => Promise<OssBaseParams|null>) | undefined
  // oss上传校验接口
  checkUploadUrl: string,
  // 是否提交本地储存的录制数据
  isSubmitLocal?: boolean,
  // 错误报告
  reportError?: (err: MessageEvent | Error) => void,
  [key: string]: any
}