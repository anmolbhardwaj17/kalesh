// P6-070: the waitFor step (waitpredicate.mjs) on a fake page and vitest fake timers (setTimeout and Date), so the rules
// are judged on an exact clock: a page busy for seconds is not "false", a crash and a throwing predicate fail at once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForPredicate, waitForError, predicateSource } from './waitpredicate.mjs';

const later = (ms, fn) => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, ms));
const never = () => new Promise(() => {});

/** A fake page: `answer(n, t)` gives the n-th probe's promise (t = fake ms since the start). */
function fakePage(answer) {
  let n = 0;
  const t0 = Date.now();
  return {
    get probes() { return n; },
    evaluate(src) {
      expect(typeof src).toBe('string');
      n++;
      return answer(n, Date.now() - t0);
    },
  };
}
async function drive(p) {
  let done = false;
  const out = Promise.resolve(p).finally(() => { done = true; });
  for (let i = 0; !done && i < 20000; i++) await vi.advanceTimersByTimeAsync(5);
  if (!done) throw new Error('drive: still pending after 100 s of fake time');
  return out;
}
const O = { timeoutMs: 1000, pollMs: 50, graceMs: 100, slowCap: 3 };

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('waitForPredicate', () => {
  it('passes as soon as the page answers true', async () => {
    const page = fakePage((n) => Promise.resolve(n >= 3));
    const r = await drive(waitForPredicate(page, 'x', O));
    expect(r.ok).toBe(true);
    expect(page.probes).toBe(3);
  });

  it('times out on a page that answers false for the whole budget', async () => {
    const r = await drive(waitForPredicate(fakePage(() => Promise.resolve(false)), 'x', O));
    expect(r).toMatchObject({ ok: false, kind: 'timeout', stalledMs: 0 });
    expect(r.ms).toBeGreaterThanOrEqual(1000);
    expect(r.ms).toBeLessThan(1100);
    expect(r.answers).toBeGreaterThan(10);
  });

  it('a page busy for longer than the budget, then true: passes (the busy time is not counted as false)', async () => {
    // The region was set before the wait; the page's main thread is stalled 1.8 s (the budget is 1 s), then answers true.
    const page = fakePage((n) => (n === 1 ? later(1800, () => true) : Promise.resolve(true)));
    const r = await drive(waitForPredicate(page, 'x', O));
    expect(r.ok).toBe(true);
    expect(r.ms).toBeGreaterThanOrEqual(1800);
  });

  it('the old rule would have failed that case: a stall then false still times out on answered time', async () => {
    const page = fakePage((n) => (n === 1 ? later(1800, () => false) : Promise.resolve(false)));
    const r = await drive(waitForPredicate(page, 'x', O));
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
    expect(r.stalledMs).toBe(1700);
    expect(r.ms - r.stalledMs).toBeGreaterThanOrEqual(1000);
  });

  it('a page that never answers fails as stalled at the slow cap', async () => {
    const r = await drive(waitForPredicate(fakePage(() => never()), 'x', O));
    expect(r).toMatchObject({ ok: false, kind: 'stalled', answers: 0 });
    expect(r.ms).toBe(3000);
    expect(r.reason).toMatch(/did not answer/);
  });

  it('a page that keeps stalling between answers fails at the cap, not before', async () => {
    const page = fakePage(() => later(600, () => false));
    const r = await drive(waitForPredicate(page, 'x', O));
    expect(r).toMatchObject({ ok: false });
    expect(r.ms).toBeGreaterThanOrEqual(2000);
  });

  it('a crashed page and a throwing predicate fail at once, each named', async () => {
    const crashed = await drive(waitForPredicate(fakePage(() => Promise.reject(new Error('page.evaluate: Target crashed'))), 'x', O));
    expect(crashed).toMatchObject({ ok: false, kind: 'crashed', reason: 'Target crashed' });
    expect(crashed.ms).toBeLessThan(10);
    const closed = await drive(waitForPredicate(fakePage(() => Promise.reject(new Error('page.evaluate: Target page, context or browser has been closed'))), 'x', O));
    expect(closed.kind).toBe('crashed');
    const threw = await drive(waitForPredicate(fakePage(() => Promise.reject(new Error("page.evaluate: TypeError: Cannot read properties of undefined (reading 'debug')\n  at x"))), 'x', O));
    expect(threw).toMatchObject({ ok: false, kind: 'threw', reason: "TypeError: Cannot read properties of undefined (reading 'debug')" });
  });

  it('a navigation (a reload step just before) is retried, not a failure', async () => {
    const page = fakePage((n) => (n <= 2 ? Promise.reject(new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation')) : Promise.resolve(true)));
    const r = await drive(waitForPredicate(page, 'x', O));
    expect(r.ok).toBe(true);
    expect(page.probes).toBe(3);
  });
});

describe('waitForError and predicateSource', () => {
  it('names the kind, keeps the "waitFor timed out:" head for a real timeout, and gives the counts', () => {
    const e = waitForError("state().region === 'a'", { ok: false, kind: 'timeout', ms: 10012, stalledMs: 0, answers: 50 }, { region: 'b' });
    expect(e).toMatch(/^waitFor timed out: state\(\)\.region === 'a' \(10012 ms, 0 ms unanswered, 50 answers; page \{"region":"b"\}\)$/);
    expect(waitForError('x', { ok: false, kind: 'crashed', ms: 5, stalledMs: 0, answers: 0, reason: 'Target crashed' }, null)).toMatch(/^waitFor failed: page crashed: x \(Target crashed; /);
    expect(waitForError('x', { ok: false, kind: 'stalled', ms: 30000, stalledMs: 29000, answers: 1, reason: 'r' }, 'no answer')).toMatch(/^waitFor stalled/);
  });

  it('wraps the expression so a trailing line comment or an IIFE still works', async () => {
    const run = (expr) => new Function(`return ${predicateSource(expr)};`)();
    expect(await run('1 + 1 === 2 // note')).toBe(true);
    expect(await run('(() => { const a = 3; return a > 2; })()')).toBe(true);
    expect(await run("''")).toBe(false);
    expect(await run('() => 5')).toBe(true);
    expect(await run('Promise.resolve(0)')).toBe(false);
  });
});
