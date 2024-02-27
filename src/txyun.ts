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

function getObjectKeys(obj: Record<string, unknown>): string[] {
  const list = Object.keys(obj);
  return list.sort(function (a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    return a === b ? 0 : a > b ? 1 : -1;
  });
}

function camSafeUrlEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function obj2str(obj: Record<string, unknown>): string {
  const list = [];
  const keyList = getObjectKeys(obj);
  for (let i = 0; i < keyList.length; i++) {
    let key = keyList[i];
    let val = obj[key] === undefined || obj[key] === null ? '' : `${obj[key]}`;
    key = key.toLowerCase();
    key = camSafeUrlEncode(key);
    val = camSafeUrlEncode(val) || '';
    list.push(`${key}=${val}`);
  }
  return list.join('&');
}

export interface TxyunSDKConfig extends BaseSDKConfig {
  appId: string;
}
export class TxyunObjectStorageSDK extends BaseObjectStorageSDK {
  private _config: TxyunSDKConfig;
  constructor(config: TxyunSDKConfig) {
    super(config);
    this._config = config;
  }
  private _getAuth(method: string, path: string, headers: OutgoingHttpHeaders | undefined): string {
    const secretId = this._config.accessKey;
    const secretKey = this._config.secretKey;

    // 签名有效起止时间
    const now = ((Date.now() / 1000) | 0) - 1;
    const keyTime = `${now};${now + 900}`;
    const headerList = headers ? getObjectKeys(headers).join(';').toLowerCase() : '';
    const paramList = ''; // getObjectKeys(queryParams).join(';').toLowerCase();

    // 签名算法说明文档：https://www.qcloud.com/document/product/436/7778
    // 步骤一：计算 SignKey
    const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');

    // 步骤二：构成 FormatString
    const formatString = `${method.toLowerCase()}\n${path}\n` + `\n${headers ? obj2str(headers) : ''}\n`;
    // formatString = Buffer.from(formatString, 'utf8');

    // 步骤三：计算 StringToSign
    const res = crypto.createHash('sha1').update(formatString).digest('hex');
    const stringToSign = `sha1\n${keyTime}\n${res}\n`;

    // 步骤四：计算 Signature
    const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');

    // 步骤五：构造 Authorization
    return (
      `q-sign-algorithm=sha1` +
      `&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=${paramList}&q-signature=${signature}`
    );
  }
  readObject(filename: string): Promise<ReadObjectResult | null> {
    return new Promise((resolve, reject) => {
      const path = `/${filename}`;
      const options: FetchOptions = {
        method: 'GET',
        host: `${this._config.bucket}-${this._config.appId}.cos.${this._config.region}.myqcloud.com`,
        path,
        returnStream: true,
        headers: {
          Authorization: this._getAuth('GET', path, undefined),
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
      const path = `/${filename}`;
      const headers: OutgoingHttpHeaders = {
        ...options.headers,
        Authorization: this._getAuth('PUT', path, options.headers),
      };
      if (options.contentEncoding) {
        headers['Content-Encoding'] = options.contentEncoding;
      }
      if (options.contentType) {
        headers['Content-Type'] = options.contentType;
      }
      const fetchOptions: FetchOptions = {
        method: 'PUT',
        path,
        host: `${this._config.bucket}-${this._config.appId}.cos.${this._config.region}.myqcloud.com`,
        headers,
        returnStream: false,
        body: req,
        limit: options.limit,
        calcHash: options.calcHash,
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
        //   logger.serror('TX-OSS', err);
        // } else {
        //   logger.serror('TX-OSS', JSON.stringify(result.Error));
        // }
        reject(result?.Error ?? err);
      });
    });
  }
  deleteObject(filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const path = `/${filename}`;
      const options: FetchOptions = {
        method: 'DELETE',
        host: `${this._config.bucket}-${this._config.appId}.cos.${this._config.region}.myqcloud.com`,
        path,
        headers: {
          Authorization: this._getAuth('DELETE', path, undefined),
        },
        returnStream: false,
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
