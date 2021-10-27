import crypto from 'crypto';
import {
  Readable,
  FetchResult,
  FetchOptions,
  ReadObjectResult,
  WriteObjectOptions,
  BaseSDKConfig,
  BaseObjectStorageSDK,
  EMPTY_OPTS,
} from './common';
import { gmt } from './util';

const REGIONS = {
  GUANGZHOU: 'cn-guangzhou',
};
export type KsyunRegion = keyof typeof REGIONS;
export interface KsyunSDKConfig extends BaseSDKConfig {
  region: KsyunRegion;
  internal: boolean;
}

function getEndPoint(config: KsyunSDKConfig) {
  return `${config.bucket}.ks3-${REGIONS[config.region]}${config.internal ? '-internal' : ''}.ksyuncs.com`;
}
export class KsyunObjectStorageSDK extends BaseObjectStorageSDK {
  private _config: KsyunSDKConfig;
  constructor(config: KsyunSDKConfig) {
    super(config);
    this._config = config;
  }
  private _getAuth(objectKey: string, options: FetchOptions, date: string): string {
    // https://docs.ksyun.com/documents/2321
    const contentString =
      `${options.method}\n` +
      `${options.headers?.['Content-MD5'] || ''}\n` + // content-md5
      `${options.headers?.['Content-Type'] || ''}\n` + // content-type
      `${date}\n` + // Date
      calcCanonicalizedOSSHeaders(options.headers) + // CanonicalizedOSSHeaders
      `/${this._config.bucket}/${objectKey}`; // CanonicalizedResource

    const signature = crypto.createHmac('sha1', this._config.secretKey).update(contentString).digest('base64');

    return 'KSS ' + this._config.accessKey + ':' + signature;
  }

  readObject(filename: string): Promise<ReadObjectResult | null> {
    return new Promise((resolve, reject) => {
      const options: FetchOptions = {
        method: 'GET',
        host: getEndPoint(this._config),
        path: `/${filename}`,
        headers: null,
        returnStream: true,
      };
      const dt = gmt();
      options.headers = {
        Date: dt,
        Authorization: this._getAuth(filename, options, dt),
      };
      this._fetch(options, (err: Error, result: FetchResult) => {
        if (!err) {
          return resolve({
            headers: result.headers,
            stream: result.body,
          });
        }
        if (!result || !result.Error) {
          return reject(err);
        }
        if (result.Error.Code === 'NoSuchKey') {
          // 文件不存在当成正常情况，返回 null。
          return resolve(null);
        }
        reject(err);
      });
    });
  }
  writeObject(filename: string, req: Readable, options: WriteObjectOptions = EMPTY_OPTS): Promise<void | string> {
    return new Promise((resolve, reject) => {
      const fetchOptions: FetchOptions = {
        method: 'PUT',
        host: getEndPoint(this._config),
        path: `/${filename}`,
        headers: null,
        returnStream: false,
        body: req,
        limit: options.limit,
        calcHash: options.calcHash,
      };
      const dt = gmt();
      fetchOptions.headers = {
        ...options.headers,
        Date: dt,
        Authorization: this._getAuth(filename, fetchOptions, dt),
      };
      if (options.contentEncoding) {
        fetchOptions.headers['Content-Encoding'] = options.contentEncoding;
      }
      if (options.contentType) {
        fetchOptions.headers['Content-Type'] = options.contentType;
      }
      this._fetch(fetchOptions, (err, result, reqBodyHash) => {
        if (!err) {
          // logger.debug(result);
          return resolve(reqBodyHash);
        }
        // if (err === ABORTED_ERR || err === TOO_LARGE_ERR) {
        //   // 不需要打印日志
        //   // console.log(err);
        // } else if (!result || !result.Error) {
        //   logger.serror('ALI-OSS', err);
        // } else {
        //   logger.serror('ALI-OSS', JSON.stringify(result.Error));
        // }
        reject(result?.Error || err);
      });
    });
  }

  deleteObject(filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: FetchOptions = {
        method: 'DELETE',
        host: getEndPoint(this._config),
        path: `/${filename}`,
        headers: null,
        returnStream: false,
      };
      const dt = gmt();
      options.headers = {
        Date: dt,
        Authorization: this._getAuth(filename, options, dt),
      };
      this._fetch(options, (err, result) => {
        if (!err) {
          // logger.debug(result);
          return resolve();
        }
        // if (!result || !result.Error) {
        //   logger.serror('TX-OSS', err);
        // } else {
        //   logger.serror('TX-OSS', JSON.stringify(result.Error));
        // }
        reject(result?.Error || err);
      });
    });
  }
}

function calcCanonicalizedOSSHeaders(headers: Record<string, string>): string {
  if (!headers) return '';
  const props = [];
  for (const k in headers) {
    const lk = k.toLowerCase();
    if (lk.startsWith('x-kss-')) {
      props.push(`${lk}:${headers[k]}`);
    }
  }
  // 如果设置CanonicalizedOSSHeaders为空，则无需在最后添加分隔符\n
  return props.length ? props.sort().join('\n') + '\n' : '';
}
