import crypto from 'crypto';
import { Transform } from 'stream';
import { Client, ClientOptions } from 'minio';
import {
  Readable,
  WriteObjectOptions,
  EMPTY_OPTS,
  ReadObjectResult,
  BaseSDKConfig,
  BaseObjectStorageSDK,
} from './common';

export type MinioSDKConfig = BaseSDKConfig & Exclude<ClientOptions, 'secretKey' | 'accessKey'>;

export class MinioObjectStorageSDK extends BaseObjectStorageSDK {
  private _config: MinioSDKConfig;
  private _client: Client;
  constructor(config: MinioSDKConfig) {
    super(config);
    this._config = config;
  }

  async _getClient() {
    if (!this._client) {
      this._client = new Client(this._config);
      if (!(await this._client.bucketExists(this._config.bucket))) {
        await this._client.makeBucket(this._config.bucket, this._config.region);
      }
    }
    return this._client;
  }
  async readObject(filename: string) {
    const client = await this._getClient();
    let meta;
    try {
      const stat = await client.statObject(this._config.bucket, filename);
      meta = stat.metaData;
    } catch (ex) {
      if (ex.code === 'NotFound') {
        return null;
      }
      // eslint-disable-next-line no-console
      console.error(ex);
      throw ex;
    }
    const stream = await client.getObject(this._config.bucket, filename);
    return {
      headers: meta,
      stream,
    } as ReadObjectResult;
  }
  async writeObject(filename: string, req: Readable, options: WriteObjectOptions = EMPTY_OPTS) {
    const client = await this._getClient();
    const meta = options.headers || {};
    if (options.contentEncoding) {
      meta['Content-Encoding'] = options.contentEncoding;
    }
    if (options.contentType) {
      meta['Content-Type'] = options.contentType;
    }
    if (options.calcHash) {
      /*
       * 由于 minio 版本的 oss 只会在本地 dev 阶段使用，
       * 代码逻辑不需要太严谨地考虑容错逻辑。
       */
      const hash = crypto.createHash('sha256');
      const transform = new Transform();
      let hashstr;
      req.on('data', (chunk) => {
        transform.write(chunk);
        hash.update(chunk);
      });
      req.on('end', () => {
        hashstr = hash.digest('hex');
        transform.end();
      });
      await client.putObject(this._config.bucket, filename, transform, meta);
      return hashstr;
    } else {
      await client.putObject(this._config.bucket, filename, req, meta);
    }
  }
  async deleteObject(filename: string) {
    const client = await this._getClient();
    await client.removeObject(this._config.bucket, filename);
  }
}
