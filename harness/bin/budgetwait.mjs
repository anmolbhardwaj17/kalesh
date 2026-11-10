// The load safe wall clock budget both browser.mjs loops share (P5-044 attempt 2): a verify script step's `timeout`
// (P5-042, mark `window.__scriptProgress`) and the autopilot guard (`budgetedCall`, mark `window.__pilotProgress`).
// The rule matches the autopilot's own (src/debug/autopilot/budget.ts): `budgetMs` whatever happens; past it, on while the
// page's progress mark is fresh within `stallMs`, up to `slowCap` x the budget.

/** A progress probe the page did not answer in time (P5-042 attempt 2): unknown, never read as "no marks". */
export const UNKNOWN = Symbol('unknown');

/** Reads `window[name]` (a progress mark `{n, label, at}`, or null) within `ms`; UNKNOWN when the page does not answer in time. */
export async function readMark(page, name, ms = 5000) {
  let handle;
  const late = new Promise((r) => { handle = setTimeout(() => r(UNKNOWN), ms); });
  try { return await Promise.race([Promise.resolve().then(() => page.evaluate((n) => window[n] || null, name)).catch(() => UNKNOWN), late]); }
  finally { clearTimeout(handle); }
}

/**
 * Waits on `run` (a promise) under the budget. Returns `{ done: true, value, ms, lastMark }` when it settled, or
 * `{ done: false, why, ms, lastMark }` when it was judged out of time.
 * Past the budget the page's mark is probed every `pollMs`:
 * - a probe the busy page does not answer within `probeMs` is unknown: the last mark read stands; with none read yet the
 *   probe is asked once more for `retryProbeMs` (a busy page is the case the budget exists for); still unanswered with no
 *   mark ever read fails ("the page never answered");
 * - a page that answers null has no marks and fails;
 * - a mark older than `stallMs` fails as stalled; a run still marking at the cap fails at the cap.
 * `graceMs` is added to the budget, the stall gap and the cap (the autopilot guard lets the page's own budget end first).
 * A run that settles while a probe waits is never judged.
 */
export async function waitWithBudget(page, run, { budgetMs, stallMs, slowCap = 3, graceMs = 0, markName, probeMs = 5000, retryProbeMs = 15000, pollMs = 5000 }) {
  const t0 = Date.now();
  const box = { done: false, value: undefined };
  const settled = Promise.resolve(run).then((v) => { box.done = true; box.value = v; });
  let handle;
  const sleep = (ms) => new Promise((r) => { handle = setTimeout(r, Math.max(50, ms)); });
  const nap = async (ms) => { await Promise.race([settled, sleep(ms)]); clearTimeout(handle); };
  const ok = (lastMark) => ({ done: true, value: box.value, ms: Date.now() - t0, lastMark });
  const limit = budgetMs + graceMs;
  const stallLimit = stallMs + graceMs;
  const cap = Math.round(budgetMs * slowCap) + graceMs;
  await nap(limit);
  let last = null;
  while (!box.done) {
    let mark = await readMark(page, markName, probeMs);
    if (mark === UNKNOWN && !last && !box.done) mark = await readMark(page, markName, retryProbeMs);
    if (box.done) break;
    const unanswered = mark === UNKNOWN;
    if (unanswered) mark = last;
    if (mark) last = mark;
    const elapsed = Date.now() - t0;
    const quiet = mark && typeof mark.at === 'number' ? Date.now() - mark.at : Infinity;
    if (!mark || quiet > stallLimit || elapsed >= cap) {
      const why = !mark ? (unanswered ? 'the page never answered the progress probe' : 'no progress marks')
        : quiet > stallLimit ? `stalled: no progress for ${Math.round(quiet / 1000)} s, last mark ${mark.n} ${mark.label}`
          : `still progressing at the ${cap} ms cap, last mark ${mark.n} ${mark.label}`;
      return { done: false, why, ms: elapsed, lastMark: last };
    }
    await nap(Math.min(pollMs, cap - elapsed, stallLimit - quiet + 100));
  }
  return ok(last);
}
