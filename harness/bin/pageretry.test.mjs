// P4-045: the retry path of lookproof --perf with fake browsers: a browser closed under newPage and a hung launch each get
// one retry on a fresh browser; a real problem (a region that never loads) is not retried; a second failure is thrown.
import { describe, it, expect } from 'vitest';
import { withTimeout, retryOnce, retryable, StepTimeout, firstLine } from './pageretry.mjs';

const CLOSED = 'browser.newPage: Target page, context or browser has been closed\nCall log:\n  - <launching>';

/** A fake browser like Playwright's: newPage throws once it is closed; `dies` makes it die inside its first newPage (the race
 * the builders hit: connected when checked, closed by the time newPage runs). */
function fakeBrowser(id, log, { dies = false } = {}) {
  let open = true;
  return {
    id,
    isConnected: () => open,
    close: async () => { open = false; log.push(`close ${id}`); },
    newPage: async () => {
      if (dies) open = false;
      if (!open) throw new Error(CLOSED);
      log.push(`page on ${id}`);
      return { id: `${id}/page` };
    },
  };
}

describe('retryable', () => {
  it('retries a closed browser, a crash and a timeout, not a real problem', () => {
    expect(retryable(new Error(CLOSED))).toBe(true);
    expect(retryable(new Error('page.evaluate: Target crashed'))).toBe(true);
    expect(retryable(new StepTimeout('browser launch', 10))).toBe(true);
    expect(retryable(new Error('page.goto: Timeout 60000ms exceeded.'))).toBe(true);
    expect(retryable(new Error('den medium: level hub or the player on the ground never came'))).toBe(false);
    expect(retryable(null)).toBe(false);
  });
});

describe('withTimeout', () => {
  it('passes a value through and cuts a hang with a StepTimeout', async () => {
    expect(await withTimeout(Promise.resolve(3), 50, 'x')).toBe(3);
    const err = await withTimeout(new Promise(() => {}), 20, 'page open').catch((e) => e);
    expect(err).toBeInstanceOf(StepTimeout);
    expect(err.message).toBe('page open timed out after 20 ms');
    expect(retryable(err)).toBe(true);
  });
  it('closes what comes up after the timeout (onLate)', async () => {
    const late = [];
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    await withTimeout(p, 10, 'browser launch', { onLate: (v) => late.push(v) }).catch(() => {});
    resolve('browser B');
    await new Promise((r) => setTimeout(r, 5));
    expect(late).toEqual(['browser B']);
  });
});

describe('retryOnce: the lookproof --perf row loop with a fake browser', () => {
  /** The row as lookproof runs it: relaunch on a retry or a dead browser, then open a page. `launches`: 'ok' | 'dies' | 'hang'. */
  function rig(launches) {
    const log = [];
    let n = 0;
    const session = { browser: null };
    const relaunch = async () => {
      if (session.browser) await session.browser.close();
      const make = launches[n++] ?? 'ok';
      if (make === 'hang') session.browser = await withTimeout(new Promise(() => {}), 20, 'browser launch');
      else session.browser = fakeBrowser(`B${n}`, log, { dies: make === 'dies' });
    };
    const row = () => retryOnce(async (a) => {
      if (a > 0 || !session.browser || !session.browser.isConnected()) await relaunch();
      return session.browser.newPage();
    }, { onRetry: (e, k) => log.push(`retry ${k}: ${firstLine(e)}`) });
    return { log, session, row };
  }

  it('a browser closed under newPage (another agent took the GPU) is relaunched once and the row finishes', async () => {
    const { log, row } = rig(['dies', 'ok']);
    const page = await row();
    expect(page.id).toBe('B2/page');
    expect(log).toEqual(['retry 1: browser.newPage: Target page, context or browser has been closed', 'close B1', 'page on B2']);
  });

  it('a browser found closed before a row (the forced close probe) is relaunched without using the retry', async () => {
    const { log, session, row } = rig(['ok', 'ok']);
    await row();
    await session.browser.close(); // HARNESS_LOOKPROOF_PROBE=close, or a browser that died between rows
    await row();
    expect(log).toEqual(['page on B1', 'close B1', 'close B1', 'page on B2']);
    expect(log.some((l) => l.startsWith('retry'))).toBe(false);
  });

  it('a hung launch times out and the second launch is used', async () => {
    const { log, row } = rig(['hang', 'ok']);
    const page = await row();
    expect(page.id).toBe('B2/page');
    expect(log[0]).toBe('retry 1: browser launch timed out after 20 ms');
  });

  it('fails after one retry when the browser keeps dying, and never retries a real problem', async () => {
    const tries = [];
    const err = await retryOnce(async (a) => { tries.push(a); throw new Error(CLOSED); }).catch((e) => e);
    expect(tries).toEqual([0, 1]);
    expect(firstLine(err)).toMatch(/has been closed/);
    const once = [];
    await retryOnce(async (a) => { once.push(a); throw new Error('den medium: cameraPlace failed'); }).catch(() => {});
    expect(once).toEqual([0]);
  });
});
