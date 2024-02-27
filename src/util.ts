import type { Writable } from 'stream';
import { formatRFC7231 } from 'date-fns';

export const TIMEOUT_ERROR = new Error('waitForDrain timeout');

/**
 * 等待流的 drain 事件
 * @param s Writable Stream
 * @param timeout 如果等待超时，则抛出错误。默认 10 秒。
 */
export async function waitForDrain(s: Writable, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const ctx = {
      tm: setTimeout(function () {
        if (done) return;
        ctx.clear();
        reject(TIMEOUT_ERROR);
      }, timeout),
      onDrain: function (): void {
        if (done) return;
        ctx.clear();
        resolve();
      },
      onError: function (err: Error): void {
        if (done) return;
        ctx.clear();
        reject(err);
      },
      onEnd: function (): void {
        if (done) return;
        ctx.clear();
        resolve();
      },
      onClose: function (): void {
        if (done) return;
        ctx.clear();
        reject(new Error('closed'));
      },
      clear: function (): void {
        done = true;
        s.off('drain', ctx.onDrain);
        s.off('error', ctx.onError);
        s.off('close', ctx.onClose);
        s.off('end', ctx.onEnd);
        clearTimeout(ctx.tm);
        // ctx.onDrain = ctx.onEnd = ctx.onError = ctx.onClose = ctx.tm = ctx.clear = null;
      },
    };
    s.on('drain', ctx.onDrain);
    s.on('error', ctx.onError);
    s.on('close', ctx.onClose);
    s.on('end', ctx.onEnd);
  });
}

export function gmt() {
  return formatRFC7231(new Date());
}
