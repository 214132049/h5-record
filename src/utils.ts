import 'whatwg-fetch'
import {encode} from 'base-64';
import HmacSHA1 from 'crypto-js/hmac-sha1';
import encBase64 from 'crypto-js/enc-base64';
import {OssBaseParams} from "./types";

export const noop = () => {
}

/**
 * 封装的fetch
 * @param url 请求地址
 * @param data 请求参数
 */
export const fetchJson = (url: string, data: any) => {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  }).then(res => res.json())
}

/**
 * 获取policy
 */
function getPolicy() {
  const expiration = new Date();
  const expirationMonth = expiration.getMonth() + 1;
  const expirationDate = expiration.getDate();
  const policyText = {
    expiration: `${expiration.getFullYear() + 1}-${expirationMonth > 9 ? expirationMonth : `0${expirationMonth}`}-${expirationDate > 9 ? expirationDate : `0${expirationDate}`}T12:00:00.000Z`, // 设置该Policy的失效时间，超过这个失效时间之后，就没有办法通过这个policy上传文件了
    conditions: [
      ['content-length-range', 0, 1048576000] // 设置上传文件的大小限制
    ]
  };
  return encode(JSON.stringify(policyText));
}

/**
 * 获取上传文件需要的所有参数  使用OSS PostObject方式
 * @param fetchUrl 获取上传参数的url
 * @param biz_type oss bucket
 * @param preUploadGet 自定义获取参数方法
 * @return
 */
export async function getUploadParams(fetchUrl?: string, biz_type?: string, preUploadGet?: () => Promise<OssBaseParams | null>): Promise<OssBaseParams | null> {
  let data: any
  if (typeof preUploadGet === 'function') {
    data = await preUploadGet()
  } else if (fetchUrl && biz_type) {
    data = await fetchJson(fetchUrl, {
      prepare2UploadReqDTOs: [
        {bizType: biz_type, fileCount: 1}
      ]
    }).catch(() => null)
  } else {
    throw new Error('请设置url, biz_type或实现获取oss参数方法')
  }
  if (!data) return null;
  const policy = getPolicy();
  const {
    privateOssTokenDTO: {stsAccessKey, stsAccessId, stsToken, timestamp, bucketName, endpoint},
    uploadPrepareInfoDTOs
  } = data;
  const uploadHost = endpoint.replace(/\/\//, `//${bucketName}.`);
  const bytes = HmacSHA1(policy, stsAccessKey);
  const signature = encBase64.stringify(bytes);
  return {
    data: {
      policy,
      success_action_status: 200,
      signature,
      timestamp,
      OSSAccessKeyId: stsAccessId,
      'x-oss-security-token': stsToken,
    },
    uploadHost,
    ossPath: uploadPrepareInfoDTOs[0]?.bizTypePath
  } as OssBaseParams
}

export const isPlainObject = (obj: any) => Object.prototype.toString.call(obj) === '[object Object]'

export const isArray = (obj: any) => Object.prototype.toString.call(obj) === '[object Array]'
