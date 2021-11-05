# H5-Record

基于 [rrweb@0.9.14](https://github.com/rrweb-io/rrweb) 和WebWorker开发的H5页面录制SDK

### 使用方式：

```javascript
import H5Record from 'h5-record'

const record = H5Record(options)
record.startRecord()
```
```html
<script src="../record.min.js"></script>

<script>
  const record = window.H5Record(options)
  record.startRecord()
</script>
```

### 配置项:

`name`

Type: string  
Required: true  
Default: ''

项目名

`version`

Type: string  
Required: true  
Default: ''

版本号

> 回放录制数据时，根据项目名+版本号查找录制时的静态资源

`handleSubmit`

Type: (data: SubmitKeysData) => Promise<void>  
Required: true  
Default: ''

提交包含oss key数据、及设置的其他上传参数
返回fulfilled的promise视为上传成功，否则将视为上传失败，数据将保留到本地

`preUploadUrl`:

Type: string  
Required: false  
Default: ''  

> note: 设置此配置，须与bizType同时设置

获取oss上传参数接口地址，SDK使用oss postObject上传录制文件，需要提前通过接口获取OSS参数

`bizType`

Type: string  
Required: false  
Default: ''

> note:  设置此配置，须与url同时设置

申请的oss bucketName

`preUploadGet`

Type: () => Promise<OssBaseParams|null>  
Required: false  
Default: ''

> note: 设置此配置会忽略preUploadUrl、bizType配置

通过此配置可以自定义获取oss上传参数方法

`ossPath`

Type: string  
Required: false  
Default: ''

`isSubmitLocal`

Type: Boolean  
Required: false  
Default: ''

是否在实例化H5Record时，提交本地储存的录制数据

`reportError`

Type: (err: MessageEvent | Error) => void  
Required: false  
Default: () => {}

处理worker异常

> 其他设置参考rrweb@0.9.14配置项

### 方法:

`startRecord` 
@param data: Object  设置提交时所需的额外参数
@return void

调用此方法开启录制

`closeRecord`  
@return void

调用此方法关闭录制, 关闭WebWorker

`suspendRecord`  
@return void  

录制过程中，某个页面不需要录制，可以调用此方法保留当前录制数据，暂停录制

`resumeRecord`  
@return void

调用此方法取回暂停前的录制数据，继续之前的录制

`takeFullSnapshot`  
@return void

录制过程中，调用此方法重新获取当前页面结构快照

`submitRecord`  
@param data: Object  设置提交时所需的额外参数, 会覆盖`startRecord`设置的同名属性  
@params successCallback: () => void  
@return void

提交录制数据，并关闭录制。可提供一个回调函数，在数据提交完成后调用

`setHandleSubmit`  
@param action: (data: SubmitKeysData) => Promise<void>  提交函数, 同配置`handleSubmit`  
@return void

设置oss key数据上传方法，初始化时没有配置`handleSubmit`,可以通过此方法设置

`startWorkerAndSubmit`  
@param data: SubmitKeysData[]  提交包含oss key的录制数据
@return void

静态方法，开启worker并上传数据，不录制
