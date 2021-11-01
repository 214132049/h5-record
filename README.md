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

`submitKeyFn`

Type: (data: KeysParam) => Promise<{result: number}>  
Required: true  
Default: ''

录制文件储存在oss上，需设置此函数提交oss文件key  

submitKeyFn方法参数及要求：  
@params: data: KeysParam[]  oss文件key对象  
@params: data.filename: KeysParam[]  oss文件key数组  
@params: data.path: KeysParam[]  oss文件key对应的osspath, 与`ossPath`对应  
@return: object 上传成功后需返回包含属性result=1的对象

若方法不符合要求，将视为上传失败，oss key数组将保留到本地

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

`mergeToLast`

Type: boolean  
Required: false  
Default: false

ossPath相同时，本次录制数据是否与本地oss key最后一个合并

> 受浏览器同源限制，同源页面下此属性才有效

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
@params submitCallback: () => {}  
@return void

提交录制数据，并关闭录制。可提供一个回调函数，在数据提交完成后调用


