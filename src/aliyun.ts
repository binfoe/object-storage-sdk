import crypto from 'crypto';
import type { OutgoingHttpHeaders } from 'http';
import type {
  Readable,
  FetchResult,
  FetchOptions,
  ReadObjectResult,
  WriteObjectOptions,
  BaseSDKConfig,
} from './common';
import { BaseObjectStorageSDK, EMPTY_OPTS } from './common';
import { gmt } from './util';

export interface AliyunSDKConfig extends BaseSDKConfig {
  region: string;
}

export class AliyunObjectStorageSDK extends BaseObjectStorageSDK {
  private _config: AliyunSDKConfig;
  constructor(config: AliyunSDKConfig) {
    super(config);
    this._config = config;
  }
  private _getAuth(objectKey: string, method: string, headers: OutgoingHttpHeaders | undefined, date: string): string {
    // https://help.aliyun.com/document_detail/31951.html
    const contentString =
      `${method}\n` +
      `${headers?.['Content-MD5'] ?? ''}\n` + // content-md5
      `${headers?.['Content-Type'] ?? ''}\n` + // content-type
      `${date}\n${
        // Date
        calcCanonicalizedOSSHeaders(headers) // CanonicalizedOSSHeaders
      }/${this._config.bucket}/${objectKey}`; // CanonicalizedResource

    const signature = crypto.createHmac('sha1', this._config.secretKey).update(contentString).digest('base64');

    return `OSS ${this._config.accessKey}:${signature}`;
  }

  readObject(filename: string): Promise<ReadObjectResult | null> {
    return new Promise((resolve, reject) => {
      const dt = gmt();
      const options: FetchOptions = {
        method: 'GET',
        host: `${this._config.bucket}.${this._config.region}.aliyuncs.com`,
        path: `/${filename}`,
        returnStream: true,
        headers: {
          Date: dt,
          Authorization: this._getAuth(filename, 'GET', undefined, dt),
        },
      };
      this._fetch(options, (err: Error, result: FetchResult) => {
        if (!err) {
          return resolve({
            headers: result.headers,
            stream: result.body,
          });
        }
        if (!result?.Error) {
          return reject(err);
        }
        if (result.Error.Code === 'NoSuchKey') {
          // 文件不存在也当成正常情况返回。业务层直接 req.end()。
          // 业务层新建面板后，可能从来没有上传过面板数据。
          return resolve(null);
        }
        reject(err);
      });
    });
  }
  writeObject(filename: string, req: Readable, options: WriteObjectOptions = EMPTY_OPTS): Promise<void | string> {
    return new Promise((resolve, reject) => {
      const dt = gmt();

      const headers: OutgoingHttpHeaders = {
        ...options.headers,
        Date: dt,
        Authorization: this._getAuth(filename, 'PUT', options.headers, dt),
      };

      if (options.contentEncoding) {
        headers['Content-Encoding'] = options.contentEncoding;
      }
      if (options.contentType) {
        headers['Content-Type'] = options.contentType;
      }
      const fetchOptions: FetchOptions = {
        method: 'PUT',
        host: `${this._config.bucket}.${this._config.region}.aliyuncs.com`,
        path: `/${filename}`,
        returnStream: false,
        body: req,
        limit: options.limit,
        calcHash: options.calcHash,
        headers,
      };

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
        reject(result?.Error ?? err);
      });
    });
  }

  deleteObject(filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const dt = gmt();
      const options: FetchOptions = {
        method: 'DELETE',
        host: `${this._config.bucket}.${this._config.region}.aliyuncs.com`,
        path: `/${filename}`,
        returnStream: false,
        headers: {
          Date: dt,
          Authorization: this._getAuth(filename, 'DELETE', undefined, dt),
        },
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
        reject(result?.Error ?? err);
      });
    });
  }
}

function calcCanonicalizedOSSHeaders(headers?: OutgoingHttpHeaders): string {
  if (!headers) return '';
  const props = [];
  for (const k in headers) {
    const lk = k.toLowerCase();
    if (lk.startsWith('x-kss-')) {
      props.push(`${lk}:${headers[k]}`);
    }
  }
  // 如果设置CanonicalizedOSSHeaders为空，则无需在最后添加分隔符\n
  return props.length ? `${props.sort().join('\n')}\n` : '';
}
