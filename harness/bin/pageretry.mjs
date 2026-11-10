// P4-045: timeouts and one retry for harness browser work. When another agent's GPU run (a verify, a sweep, another
// lookproof) holds the machine, Chromium can die under us ("Target page, context or browser has been closed" at
// browser.newPage) or hang at launch or page open. lookproof.mjs --perf wraps its launch and each row with these: a step
// that times out or finds the browser gone is tried once more on a fresh browser, and the load is logged.
// Pure helpers (no Playwright import), so vitest covers them with fakes (pageretry.test.mjs).
import os from 'node:os';

/** A step that did not finish in time. `timeout: true` marks it as worth a retry. */
export class StepTimeout extends Error {
  constructor(what, ms) {
    super(`${what} timed out after ${ms} ms`);
    this.name = 'StepTimeout';
    this.timeout = true;
  }
}

/**
 * `promise` or a StepTimeout after `ms`. `onLate(value)` runs if the promise resolves after the timeout, so a browser or
 * page that comes up late is closed instead of left behind.
 */
export function withTimeout(promise, ms, what, { onLate } = {}) {
  let handle;
  let late = false;
  const timer = new Promise((_, reject) => {
    handle = setTimeout(() => { late = true; reject(new StepTimeout(what, ms)); }, ms);
  });
  const run = Promise.resolve(promise).then((v) => {
    if (late && onLate) Promise.resolve().then(() => onLate(v)).catch(() => {});
    return v;
  });
  // A late rejection must not surface as an unhandled rejection.
  run.catch(() => {});
  return Promise.race([run, timer]).finally(() => clearTimeout(handle));
}

// Messages Playwright and Chromium give when the browser or page went away under us, or a step was cut off by a timeout.
const GONE = /Target page, context or browser has been closed|Target closed|browser has been closed|Browser closed|Browser has been disconnected|has been closed|crashed|disconnected|Connection closed|Protocol error|ECONNRESET|timed out|Timeout \d+ms exceeded/i;

/** True for an error worth one more try on a fresh browser: a timeout or a browser or page that went away. */
export function retryable(err) {
  if (!err) return false;
  if (err.timeout === true) return true;
  return GONE.test(String(err.message || err));
}

/**
 * Runs `fn(attempt)` and, when it throws a retryable error, calls `onRetry(err, attempt)` (relaunch the browser, log the
 * load) and runs it again, up to `retries` more times. Any other error, or the last one, is thrown.
 */
export async function retryOnce(fn, { retries = 1, isRetryable = retryable, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      if (onRetry) await onRetry(e, attempt + 1);
    }
  }
}

/** The machine load for a retry log line: 1 and 5 minute load averages and the core count. */
export function loadNow() {
  const [a1, a5] = os.loadavg();
  return { avg1: Math.round(a1 * 100) / 100, avg5: Math.round(a5 * 100) / 100, cores: os.cpus().length };
}

/** One line for an error (Playwright messages carry a call log after the first line). */
export function firstLine(err) {
  return String((err && err.message) || err).split('\n')[0];
}
