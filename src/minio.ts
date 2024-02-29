import crypto from 'crypto';
import type { ClientOptions } from 'minio';
import { Client } from 'minio';
import type { WriteObjectOptions, ReadObjectResult, BaseSDKConfig } from './common';
import { Readable, EMPTY_OPTS, BaseObjectStorageSDK, TOO_LARGE_ERR } from './common';

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
    const meta = options.headers ?? {};
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
      const transform = new Readable({
        read() {},
      });
      let hashstr;
      req.on('data', (chunk) => {
        transform.push(chunk);
        hash.update(chunk);
      });
      req.on('end', () => {
        hashstr = hash.digest('hex');
        transform.push(null);
      });
      req.on('error', (err) => {
        transform.destroy(err);
      });
      await client.putObject(this._config.bucket, filename, transform, meta);
      return hashstr;
    } else if (options.limit) {
      const LIMIT_SIZE = options.limit ?? 0;
      const transform = new Readable({
        read() {},
      });
      let total = 0;
      let end = false;
      req.on('data', (chunk) => {
        if (end) return;
        total += chunk.length;
        if (total > LIMIT_SIZE) {
          end = true;
          transform.destroy(TOO_LARGE_ERR);
          return;
        }
        transform.push(chunk);
      });
      req.on('end', () => {
        if (end) return;
        transform.push(null);
        end = true;
      });
      req.on('error', (err) => {
        transform.destroy(err);
      });
      await client.putObject(this._config.bucket, filename, transform, meta);
    } else {
      await client.putObject(this._config.bucket, filename, req, meta);
    }
  }
  async deleteObject(filename: string) {
    const client = await this._getClient();
    await client.removeObject(this._config.bucket, filename);
  }
}
