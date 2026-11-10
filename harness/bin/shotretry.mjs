// P6-072: a scenario screenshot that survives a loaded machine. Playwright's page.screenshot waits for the compositor to give
// it a new frame, on plain wall clock (30 s by default). At a load average of 35 to 50 (two verify runs, a sweep and builders on
// 12 cores, swap in use) a page can go 30 s without a composited frame although nothing is wrong with it: shiro_seq_pin and
// shiro_seq_swipe failed once each on "page.screenshot: Timeout 30000ms exceeded" and passed on a rerun and in a flakecheck.
// Rule (as P6-070's waitFor: only a page that answers counts): a screenshot timeout is retried while the page still answers a
// trivial evaluate, with a longer timeout each try, up to `tries` tries; a page that is gone (crash, closed) or that does not
// answer fails at once with that reason. Any other error is thrown as before.

/** Error text of a page that is gone (renderer crash, page or browser closed). */
const GONE = /Target crashed|crash|Target page, context or browser has been closed|Target closed|has been closed/i;
const TIMEOUT = /Timeout \d+ms exceeded|TimeoutError/i;

function firstLine(err) {
  return String((err && err.message) || err).split('\n')[0];
}

/**
 * Takes `page.screenshot(opts)`, retrying a timeout while the page answers. Returns `{ buffer, tries, waitedMs }`; throws the
 * last error when it cannot (`tries` timeouts, a gone page, a page that does not answer within `answerMs`, another error).
 * `onRetry(line)` is told about each retry (the scenario log). Timeouts grow: `timeoutMs`, then x2, x3.
 */
export async function screenshotWithRetry(page, opts = {}, { tries = 3, timeoutMs = 30000, answerMs = 10000, onRetry = null } = {}) {
  const t0 = Date.now();
  let last = null;
  for (let k = 1; k <= tries; k++) {
    try {
      const buffer = await page.screenshot({ ...opts, timeout: timeoutMs * k });
      return { buffer, tries: k, waitedMs: Date.now() - t0 };
    } catch (e) {
      last = e;
      const msg = firstLine(e);
      if (GONE.test(msg) || !TIMEOUT.test(msg) || k === tries) throw e;
      // Does the page still answer? A stuck or gone page fails now, with that reason.
      let handle;
      const late = new Promise((r) => { handle = setTimeout(() => r({ late: true }), answerMs); });
      const r = await Promise.race([Promise.resolve().then(() => page.evaluate('1')).then(() => ({ ok: true }), (err) => ({ err })), late]);
      clearTimeout(handle);
      if (r.late) throw new Error(`${msg} (the page did not answer for ${Math.round(answerMs / 1000)} s after it)`);
      if (r.err) throw r.err;
      onRetry?.(`screenshot retry ${k + 1}/${tries} after ${msg} (the page answers; ${Math.round((Date.now() - t0) / 1000)} s so far)`);
    }
  }
  throw last;
}
