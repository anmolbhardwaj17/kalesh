// P5-044 attempt 2: the load safe budget wait (budgetwait.mjs) and the autopilot guard (browser.mjs budgetedCall) on a fake
// page. Times are small (tens of ms) so the rules run as they do with the real 5 s probes and 150 s stall gap.
// P6-045: every test runs on vitest fake timers (setTimeout and Date), so a loaded machine cannot push a 30 ms call past
// its 100 ms budget: the clock only moves when `drive` moves it, in 5 ms steps, and the order of events is exact.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readMark, UNKNOWN, waitWithBudget } from './budgetwait.mjs';
import { budgetedCall } from './browser.mjs';

const never = () => new Promise(() => {});
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const T = { probeMs: 40, retryProbeMs: 120, pollMs: 40 };

/**
 * A fake page: `evaluate(fn, arg)` with an object arg is the debug call (it settles after `runMs`, never when null); with a
 * string arg it is a progress probe, answered by `probe(n)` (n = 1 for the first probe).
 */
function fakePage(runMs, probe) {
  let probes = 0;
  return {
    get probes() { return probes; },
    evaluate(_fn, arg) {
      if (arg && typeof arg === 'object') return runMs == null ? never() : later(runMs, { ok: true, value: 'won' });
      probes++;
      return probe(probes);
    },
  };
}
const fresh = (n, label = 'step') => Promise.resolve({ n, label, at: Date.now() });
/** Runs `p` to the end on the fake clock (5 ms steps, microtasks flushed between), with a wall of fake time as a backstop. */
async function drive(p) {
  let done = false;
  const out = Promise.resolve(p).finally(() => { done = true; });
  for (let i = 0; !done && i < 4000; i++) await vi.advanceTimersByTimeAsync(5);
  if (!done) throw new Error('drive: still pending after 20 s of fake time');
  return out;
}
const guard = (page, o = {}) => drive(budgetedCall(page, 'autopilot', [], { budgetMs: 100, graceMs: 0, stallMs: 400, slowCap: 30, ...T, ...o }));

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('readMark', () => {
  it('returns the mark, null, or UNKNOWN when the page does not answer in time', async () => {
    expect(await drive(readMark(fakePage(null, () => fresh(3, 'x')), '__pilotProgress', 40))).toMatchObject({ n: 3, label: 'x' });
    expect(await drive(readMark(fakePage(null, () => Promise.resolve(null)), '__pilotProgress', 40))).toBe(null);
    expect(await drive(readMark(fakePage(null, () => never()), '__pilotProgress', 40))).toBe(UNKNOWN);
    expect(await drive(readMark(fakePage(null, () => Promise.reject(new Error('navigated'))), '__pilotProgress', 40))).toBe(UNKNOWN);
  });
});

describe('budgetedCall (autopilot guard)', () => {
  it('within the budget: the call result, no probe', async () => {
    // 90 ms of a 100 ms budget: on the fake clock a probe anywhere before the budget (even at the 50 ms nap floor) is seen.
    const page = fakePage(90, () => fresh(1));
    const r = await guard(page);
    expect(r).toMatchObject({ ok: true, value: 'won' });
    expect(page.probes).toBe(0);
  });

  it('a first probe the busy page does not answer, then fresh marks: runs on to a pass', async () => {
    const page = fakePage(700, (n) => (n === 1 ? never() : fresh(n)));
    const r = await guard(page);
    expect(r.ok, r.error).toBe(true);
    expect(r.value).toBe('won');
    expect(r.wallMs).toBeGreaterThan(100);
    expect(page.probes).toBeGreaterThan(2);
  });

  it('a page that answers null (no marks) fails past the budget', async () => {
    const r = await guard(fakePage(null, () => Promise.resolve(null)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no progress marks/);
    expect(r.wallMs).toBeLessThan(400);
  });

  it('a page that never answers a probe fails (after one longer retry)', async () => {
    const page = fakePage(null, () => never());
    const r = await guard(page);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/never answered the progress probe/);
    expect(page.probes).toBe(2);
  });

  it('a mark, then silence: fails as stalled', async () => {
    const r = await guard(fakePage(null, (n) => (n === 1 ? fresh(1, 'den') : never())), { stallMs: 250 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/stalled: no progress .* last mark 1 den/);
  });

  it('a mark that stays the same (answered, never fresh): fails as stalled', async () => {
    const at = Date.now();
    const r = await guard(fakePage(null, () => Promise.resolve({ n: 4, label: 'fridge', at })), { stallMs: 250 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/stalled: .* last mark 4 fridge/);
  });

  it('marks that alternate for ever (a looping bot): fails at the cap', async () => {
    const t0 = Date.now();
    const r = await guard(fakePage(null, (n) => fresh(n, n % 2 ? 'A' : 'B')), { slowCap: 5 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/still progressing at the 500 ms cap/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
  });

  it('a call that settles while a probe waits is never judged', async () => {
    const r = await guard(fakePage(180, () => never()));
    expect(r.ok, r.error).toBe(true);
  });

  it('graceMs is added to the budget: no probe before budget + grace', async () => {
    const page = fakePage(200, () => fresh(1));
    const r = await guard(page, { graceMs: 150 });
    expect(r.ok).toBe(true);
    expect(page.probes).toBe(0);
  });
});

describe('waitWithBudget (script step)', () => {
  it('a script result past its budget while marking: done, with the last mark', async () => {
    const page = fakePage(null, (n) => (n === 1 ? never() : fresh(n, 'load')));
    const w = await drive(waitWithBudget(page, later(500, { ok: true }), { budgetMs: 100, stallMs: 400, slowCap: 30, markName: '__scriptProgress', ...T }));
    expect(w.done).toBe(true);
    expect(w.value).toEqual({ ok: true });
    expect(w.lastMark).toMatchObject({ label: 'load' });
  });

  it('a script with no marks fails at its budget', async () => {
    const w = await drive(waitWithBudget(fakePage(null, () => Promise.resolve(null)), never(), { budgetMs: 100, stallMs: 400, markName: '__scriptProgress', ...T }));
    expect(w).toMatchObject({ done: false, why: 'no progress marks' });
  });
});
