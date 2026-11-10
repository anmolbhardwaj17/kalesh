// P6-072: the load safe screenshot (shotretry.mjs) on a fake page.
import { describe, it, expect } from 'vitest';
import { screenshotWithRetry } from './shotretry.mjs';

const timeoutErr = (ms) => Object.assign(new Error(`page.screenshot: Timeout ${ms}ms exceeded.\nCall log:\n  - taking page screenshot`), { name: 'TimeoutError' });

/** A fake page: `shots` is a list of outcomes for each screenshot call ('ok' or an Error); `answer` how evaluate behaves. */
function fakePage(shots, answer = 'ok') {
  const calls = [];
  return {
    calls,
    async screenshot(o) {
      calls.push(o.timeout);
      const r = shots[calls.length - 1];
      if (r instanceof Error) throw r;
      return Buffer.from('png');
    },
    evaluate() {
      if (answer === 'ok') return Promise.resolve(1);
      if (answer === 'never') return new Promise(() => {});
      return Promise.reject(new Error(answer));
    },
  };
}

describe('screenshotWithRetry (P6-072)', () => {
  it('takes a shot at once with the first timeout', async () => {
    const page = fakePage(['ok']);
    const r = await screenshotWithRetry(page, { path: 'x.png' }, { timeoutMs: 100 });
    expect(r.tries).toBe(1);
    expect(page.calls).toEqual([100]);
  });

  it('retries a timeout while the page answers, with a longer timeout, and logs it', async () => {
    const page = fakePage([timeoutErr(100), timeoutErr(200), 'ok']);
    const lines = [];
    const r = await screenshotWithRetry(page, {}, { timeoutMs: 100, onRetry: (l) => lines.push(l) });
    expect(r.tries).toBe(3);
    expect(page.calls).toEqual([100, 200, 300]);
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(/screenshot retry 2\/3 after page.screenshot: Timeout 100ms exceeded/);
  });

  it('fails after `tries` timeouts with the last error', async () => {
    const page = fakePage([timeoutErr(100), timeoutErr(200), timeoutErr(300)]);
    await expect(screenshotWithRetry(page, {}, { timeoutMs: 100 })).rejects.toThrow(/Timeout 300ms/);
  });

  it('fails at once on a gone page or another error, never retrying', async () => {
    const crashed = fakePage([new Error('page.screenshot: Target crashed')]);
    await expect(screenshotWithRetry(crashed, {}, { timeoutMs: 100 })).rejects.toThrow(/Target crashed/);
    expect(crashed.calls.length).toBe(1);
    const other = fakePage([new Error('page.screenshot: path is not writable')]);
    await expect(screenshotWithRetry(other, {}, { timeoutMs: 100 })).rejects.toThrow(/not writable/);
    expect(other.calls.length).toBe(1);
  });

  it('fails after a timeout when the page does not answer, or answers that it is gone', async () => {
    const stuck = fakePage([timeoutErr(100), 'ok'], 'never');
    await expect(screenshotWithRetry(stuck, {}, { timeoutMs: 100, answerMs: 20 })).rejects.toThrow(/did not answer/);
    expect(stuck.calls.length).toBe(1);
    const gone = fakePage([timeoutErr(100), 'ok'], 'Target page, context or browser has been closed');
    await expect(screenshotWithRetry(gone, {}, { timeoutMs: 100 })).rejects.toThrow(/has been closed/);
  });
});
