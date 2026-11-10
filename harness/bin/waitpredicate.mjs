// P6-070: the `{waitFor}` step of verify and shoot scenarios. It replaces Playwright's page.waitForFunction, which had two
// faults under a loaded machine:
// - its timeout is plain wall clock: a page too busy (or swapped out) to answer the poll counted as "false" for that time,
//   so a page stalled for a few seconds after a region load failed a 10 s wait even though the predicate was already true;
// - the step's catch turned every rejection into "waitFor timed out": a predicate that threw (16 ms) and a crashed page
//   ("Target crashed", 0.5 s) read the same as a real 10 s timeout.
// Rule: the budget counts only time the page answered. A probe unanswered past `graceMs` is unknown, and that time is not
// counted, up to `slowCap` x the budget of wall clock. A crashed or closed page and a predicate that throws fail at once, each
// with its own reason. A navigation (a reload step just before) is unknown, not a failure, as with waitForFunction.

/** Error text of a page that is gone (renderer crash, page or browser closed). */
const GONE = /Target crashed|crash|Target page, context or browser has been closed|Target closed|has been closed/i;
/** Error text of a page between documents (a reload or navigation): try again, as Playwright's own wait does. */
const NAVIGATING = /Execution context was destroyed|Cannot find context|navigat|frame was detached/i;

function firstLine(err) {
  return String((err && err.message) || err).split('\n')[0].replace(/^page\.evaluate: /, '');
}

/** The predicate as one page expression: truthy (awaited; a function is called) becomes true. */
export function predicateSource(expr) {
  return `(async () => { const v = (\n${expr}\n); return !!(typeof v === 'function' ? await v() : await v); })()`;
}

/**
 * Waits until `expr` (a page expression) is truthy. Returns `{ ok: true, ms }` or
 * `{ ok: false, kind: 'timeout' | 'stalled' | 'crashed' | 'threw', ms, stalledMs, answers, reason }`.
 * - timeout: the page answered false for `timeoutMs` of answered time;
 * - stalled: `timeoutMs * slowCap` of wall clock passed, most of it with the page not answering;
 * - crashed: the page is gone; threw: the predicate threw (`reason` is the error).
 */
export async function waitForPredicate(page, expr, { timeoutMs = 20000, pollMs = 200, graceMs = 1000, slowCap = 3 } = {}) {
  const src = predicateSource(expr);
  const t0 = Date.now();
  const capMs = Math.round(timeoutMs * slowCap);
  let stalledMs = 0;
  let answers = 0;
  const out = (kind, extra = {}) => ({ ok: false, kind, ms: Date.now() - t0, stalledMs: Math.round(stalledMs), answers, ...extra });
  for (;;) {
    const sent = Date.now();
    let handle;
    const capLeft = Math.max(1, capMs - (sent - t0));
    const late = new Promise((r) => { handle = setTimeout(() => r({ late: true }), capLeft); });
    const r = await Promise.race([
      Promise.resolve().then(() => page.evaluate(src)).then((v) => ({ v }), (e) => ({ e })),
      late,
    ]);
    clearTimeout(handle);
    const took = Date.now() - sent;
    if (took > graceMs) stalledMs += took - graceMs;
    if (r.late) return out('stalled', { reason: `the page did not answer for ${Math.round(took / 1000)} s` });
    if (r.e) {
      const msg = firstLine(r.e);
      if (GONE.test(msg)) return out('crashed', { reason: msg });
      if (!NAVIGATING.test(msg)) return out('threw', { reason: msg });
    } else {
      answers++;
      if (r.v === true) return { ok: true, ms: Date.now() - t0 };
    }
    const wall = Date.now() - t0;
    if (wall - stalledMs >= timeoutMs) return out('timeout');
    if (wall >= capMs) return out('stalled', { reason: `${Math.round(stalledMs / 1000)} s of ${Math.round(wall / 1000)} s without an answer` });
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

/** The step error line: what kind of end, the expression, and the counts that tell a busy page from a false predicate. */
export function waitForError(expr, w, seen) {
  const head = w.kind === 'timeout' ? 'waitFor timed out'
    : w.kind === 'stalled' ? 'waitFor stalled (page not answering)'
      : w.kind === 'crashed' ? 'waitFor failed: page crashed'
        : 'waitFor failed: predicate threw';
  const why = w.reason ? `${w.reason}; ` : '';
  return `${head}: ${expr} (${why}${w.ms} ms, ${w.stalledMs} ms unanswered, ${w.answers} answers; page ${JSON.stringify(seen)})`;
}
