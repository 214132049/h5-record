import {encode} from 'base-64';
import HmacSHA1 from 'crypto-js/hmac-sha1';
import encBase64 from 'crypto-js/enc-base64';
import {OssBaseParams} from "./types";

export const noop = () => {
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
 * @param customGet 自定义获取参数方法
 * @return
 */
export async function getUploadParams(fetchUrl: string, biz_type: string, customGet = noop): Promise<OssBaseParams|null> {
  if ((!fetchUrl || !biz_type) && !customGet) {
    throw new Error('请设置url, biz_type或实现获取oss参数方法')
  }
  const policy = getPolicy();
  let data: any
  if (typeof customGet === 'function') {
    data = await customGet()
  } else {
    data = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prepare2UploadReqDTOs: [
          {bizType: biz_type, fileCount: 1}
        ]
      })
    }).then(res => res.json()).catch(() => null)
  }
  if (!data) return null;
  const {privateOssTokenDTO: {stsAccessKey, stsAccessId, stsToken, timestamp, bucketName, endpoint}} = data;
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
    uploadHost
  } as OssBaseParams
}
