import { request, Agent, IncomingMessage, ClientRequest } from 'http';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import pump from 'pump';
import { Parser as XMLParser } from 'xml2js';
import getRawBody from 'raw-body';
export { Readable, Writable } from 'stream';
import { waitForDrain } from './util';

/** @internal */
export const EMPTY_OPTS = {};
/** @internal */
export type HashType = 'md5' | 'sha1' | 'sha128' | 'sha256';
export const ABORTED_ERR = new Error('aborted');
export const TOO_LARGE_ERR = new Error('too_large');

export type WriteObjectOptions = {
  /** 最大允许的文件大小，以 byte 计数。不指定参数或参数 <= 0 则不限制大小。 */
  limit?: number;
  /** 是否计算上传文件的哈希，如果指定为 true，则计算 sha256。也可以指定哈希算法。  */
  calcHash?: HashType;
  /** 设置 content-type */
  contentType?: string;
  /** 设置 content-encoding */
  contentEncoding?: 'deflate' | 'gzip';
  /** 额外的 headers */
  headers?: Record<string, string>;
};
/**
 * @internal
 */
export type FetchOptions = {
  method: string;
  host: string;
  path: string;
  returnStream: boolean;
  headers: {
    Authorization?: string;
    [s: string]: string;
  };
  body?: Readable;
  limit?: number;
  calcHash?: HashType;
};
/**
 * @internal
 */
export type FetchResult = {
  body?: Readable;
  headers?: Record<string, string>;
  Error?: {
    // 腾讯云返回的接口数据字段
    Code: string;
  };
  [prop: string]: unknown;
};
export type ReadObjectResult = {
  stream: Readable;
  headers?: Record<string, string>;
};

export interface BaseSDKConfig<Region = string> {
  timeout?: number;
  secretKey: string;
  accessKey: string;
  bucket: string;
  region: Region;
}
export abstract class BaseObjectStorageSDK {
  private _globalAgent: Agent;
  private _xmlParser: XMLParser;
  private _timeout: number;
  constructor(config: BaseSDKConfig) {
    this._timeout = config.timeout || 30000;
  }
  protected get _XMLParser() {
    if (!this._xmlParser)
      this._xmlParser = new XMLParser({
        explicitArray: false,
      });
    return this._xmlParser;
  }
  protected get _GlobalAgent() {
    if (!this._globalAgent)
      this._globalAgent = new Agent({
        keepAlive: true,
        maxSockets: 1000,
        maxFreeSockets: 256,
        timeout: this._timeout,
      });
    return this._globalAgent;
  }
  protected _pipeReqeuest(
    body: Readable,
    req: ClientRequest,
    limit: number,
    calcHash: HashType,
    callback: (err?: Error, hash?: string) => void,
  ): void {
    if (!limit && !calcHash) {
      // 如果不限制文件大小，也不需要计算哈希，则直接使用 pump 转发即可。
      pump(body, req, (err) => {
        callback(err);
      });
      return;
    }
    let complete = false;
    let received = 0;
    const hash = calcHash ? createHash(calcHash) : null;
    const TIMEOUT = this._timeout;
    const ctx = {
      onAborted(): void {
        if (complete) return;
        ctx.done(ABORTED_ERR);
      },
      done(err?: Error): void {
        // mark complete
        complete = true;
        if (err) {
          // console.log('req aborted')
          req.destroy();
        }
        ctx.cleanup();
        callback(err, calcHash ? hash.digest('hex') : null);
      },
      cleanup(): void {
        // console.log('clear pipe req');
        body.off('aborted', ctx.onAborted);
        body.off('data', ctx.onData);
        body.off('end', ctx.onEnd);
        body.off('error', ctx.onError);
        body.off('close', ctx.onClose);
        req.off('aborted', ctx.onAborted);
        req.off('end', ctx.onEnd);
        req.off('error', ctx.onError);
        req.off('close', ctx.onClose);
        ctx.onAborted = ctx.onClose = ctx.onEnd = ctx.onData = ctx.onError = ctx.cleanup = ctx.done = null;
      },
      onClose(): void {
        if (complete) return;
        ctx.done();
      },
      onError(err: Error): void {
        if (complete) return;
        ctx.done(err);
      },
      onEnd(): void {
        if (complete) return;
        req.end();
        ctx.done();
      },
      onData(chunk: Buffer): void {
        if (complete) return;
        // console.log('onData', chunk.length);
        received += chunk.length;
        // console.log(received, limit);
        if (received > limit) {
          ctx.done(TOO_LARGE_ERR);
          return;
        }
        if (calcHash) {
          hash.update(chunk);
        }
        // console.log('write!');
        if (!req.write(chunk)) {
          // console.log('drain!');
          body.pause();
          waitForDrain(req, TIMEOUT).then(
            () => {
              // console.log('wr')
              if (complete) return;
              // console.log('resume');
              body.resume();
            },
            (err) => {
              // console.log('wf d', complete, err);
              if (complete) return;
              ctx.done(err);
            },
          );
        }
      },
    };
    body.on('aborted', ctx.onAborted);
    body.on('close', ctx.onClose);
    body.on('data', ctx.onData);
    body.on('end', ctx.onEnd);
    body.on('error', ctx.onError);
    req.on('aborted', ctx.onAborted);
    req.on('error', ctx.onError);
    req.on('close', ctx.onClose);
    req.on('end', ctx.onEnd);
  }
  protected getBody(
    res: IncomingMessage,
    contentType: string,
    callback: (err: Error, body?: Record<string, string>) => void,
  ): void {
    getRawBody(res, true, (err, body) => {
      if (err) return callback(err);
      if (!body) {
        return callback(null);
      }
      const i = contentType.indexOf(';');
      if (i > 0) {
        contentType = contentType.slice(0, i);
      }
      if (contentType === 'application/xml') {
        this._XMLParser.parseString(body, (err: Error, result: Record<string, string>) => {
          if (err) return callback(err);
          callback(null, result);
        });
      } else if (contentType === 'application/json') {
        try {
          callback(null, JSON.parse(body));
        } catch (ex) {
          callback(ex);
        }
      } else {
        callback(new Error('unsupported content-type:' + contentType));
      }
    });
  }

  protected _fetch(
    options: FetchOptions,
    callback: (err: Error, result?: FetchResult, requestBodyHash?: string) => void,
  ): void {
    let done = false;
    let hash: string = null;

    function finish(err: Error, result?: FetchResult): void {
      if (done) return;
      if (!err && options.calcHash && !hash) {
        err = new Error('unexpected error: calculated hash is empty');
        process.nextTick(() => callback(err));
        return;
      }
      // console.log(err);
      done = true;
      process.nextTick(() => callback(err, result || null, hash));
    }
    const req = request(
      {
        method: options.method,
        path: options.path,
        host: options.host,
        headers: options.headers,
        agent: this._GlobalAgent,
        timeout: this._timeout,
      },
      (res) => {
        const contentType = res.headers['content-type'];
        // console.log(res.statusCode, contentType);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          this.getBody(res, contentType, (err, result) => {
            // console.log(result);
            return finish(new Error(res.statusMessage), err ? null : result);
          });
        } else if (!options.returnStream) {
          this.getBody(res, contentType, (err, result) => {
            return finish(err, err ? null : result);
          });
        } else {
          const headers: Record<string, string> = {};
          contentType && (headers['Content-Type'] = contentType);
          const contentEncoding = res.headers['content-encoding'];
          contentEncoding && (headers['Content-Encoding'] = contentEncoding);
          finish(null, {
            headers,
            body: res,
          });
        }
      },
    );
    function onReqErr(err: Error): void {
      req.off('error', onReqErr);
      finish(err);
    }
    req.on('error', onReqErr);

    if (options.body) {
      this._pipeReqeuest(options.body, req, options.limit, options.calcHash, function (err: Error, bodyHash: string) {
        if (done) return;
        if (err) {
          finish(err);
        } else {
          hash = bodyHash;
        }
      });
    } else {
      req.end();
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  readObject(filename: string): Promise<ReadObjectResult | null> {
    throw new Error('abstract method');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deleteObject(filename: string): Promise<void> {
    throw new Error('abstract method');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  writeObject(filename: string, req: Readable, options?: WriteObjectOptions): Promise<void | string> {
    throw new Error('abstract method');
  }
}
