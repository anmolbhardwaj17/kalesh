// P4-071: frame sequences of a transition, one frame every `everyMs` (150 ms), from a screencast (screencast.mjs). Pure, unit
// tested (frameseq.test.mjs). The screencast sends a frame only when the picture changes, so the frame on screen at a tick is
// the last one that arrived before it, and the time since it arrived (`staleMs`) is how long the picture has not changed.
// The page records what it was showing (`phases`: [{w: Date.now() ms, phase}], from `debug.ui('transition')`) so each tick
// knows whether the loading screen, a card, the results or the game was up:
//   loading   the loading screen covers the game (black or a still is fine there)
//   card      a chapter card or the results card (a still picture is fine there)
//   play      the game (the end beat, a cutscene and `reveal`, the loading screen fading out over the started game, count
//             as play): never black, never frozen
// Judged outside the loading screen: no run of plain black ticks longer than `blackMaxMs`, and no picture unchanged for longer
// than `frozenMaxMs` while the game is on screen.
// P4-091: frame arrival alone cannot see a freeze. Chromium keeps sending frames while the main thread is busy (the compositor
// still runs CSS animations and re-sends the last picture), so a 1.2 s busy loop read as 14 ms stale. Each frame may carry a
// small luma image (`luma`, 0..255 levels, any fixed size): a tick is STILL when its picture differs from the previous tick's
// by under `STILL_DIFF` mean luma levels, and `stillMs` counts the run of still ticks. A frozen game is the longer of the
// arrival age (`staleMs`) and that run. Measured (P4-091, 160 x 90 luma): a forced 1.2 s busy loop at the start of the end
// beat gives 0.00 a tick (the same picture re-sent); the stillest live game seen (the player idle, the camera settled at the
// end of M05's end beat) 0.07 to 0.09. The verifier's 0.08 sat inside that live range, so the limit is 0.04.
// P4-096: a still picture is not a freeze while the page kept rendering. Under load the screencast sends few frames (383 to
// 456 against about 1075) and a static cutscene shot (the end of M07) shows the same picture for over a second, so both the
// arrival age and the still run grew past the limit while the game ran fine. The page's sampler (one rAF callback a frame)
// notes `stalls`: wall spans [w0, w1] (Date.now() ms) in which the game drew no new frame (`debug.clock().frame` stood) for
// over `STALL_MS`. When stalls are given, a tick's frozen age is the shorter of its picture age and how long the page has
// stalled at that tick (0 outside a stall). A busy main thread (the `txfreeze` negative control) stalls rAF and the game's
// frames together, so it still fails; a static shot of a game that kept drawing passes.

/** Mean luma difference (levels, 0..255) under which two ticks show the same picture (P4-091). */
export const STILL_DIFF = 0.04;

/** A gap between two new game frames longer than this (ms) is a page stall (P4-096, the page sampler's threshold). */
export const STALL_MS = 100;

/** P4-096: the stall [w0, w1] (wall ms) that contains wall ms `w`, or null. `stalls` sorted by w0. */
export function stallAt(stalls, w) {
  if (!stalls) return null;
  for (const s of stalls) {
    if (s.w0 > w) break;
    if (w <= s.w1) return s;
  }
  return null;
}

/** Mean absolute difference of two luma images of the same size, in levels; Infinity when either is missing or sizes differ. */
export function lumaDiff(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** What a page phase is for the judge. */
export function phaseClass(phase) {
  if (phase === 'loading') return 'loading';
  // P6-040: the ending's credits roll is a card class screen (a full screen DOM page over the game).
  if (phase === 'card' || phase === 'results' || phase === 'title' || phase === 'menu' || phase === 'credits') return 'card';
  return 'play';
}

/** The phase at wall ms `w` (the last sample at or before it; the first sample before any). */
export function phaseAt(phases, w) {
  if (!phases || phases.length === 0) return 'play';
  let lo = 0, hi = phases.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (phases[mid].w <= w) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return phases[best].phase;
}

/**
 * P4-097: the page samples its phase once a frame, so a load that runs in one long task (a region swap under a held frame,
 * the screen still waiting for its delay) never shows up as `loading`: its stall kept the last sample, `play`. `spans`
 * ([{w0, w1}] wall ms, from the page's load log: run start to the screen starting to leave) are laid over the samples as
 * `phase`; outside them the samples stand. Returns a new sorted phase list without repeats.
 */
export function withSpans(phases, spans, phase = 'loading') {
  const list = Array.isArray(phases) ? phases : [];
  const sp = (Array.isArray(spans) ? spans : []).filter((s) => Number.isFinite(s.w0) && Number.isFinite(s.w1) && s.w1 > s.w0).sort((a, b) => a.w0 - b.w0);
  if (!sp.length) return [...list];
  const inSpan = (w) => sp.some((s) => w >= s.w0 && w < s.w1);
  const times = [...new Set([...list.map((p) => p.w), ...sp.flatMap((s) => [s.w0, s.w1])])].sort((a, b) => a - b);
  const out = [];
  for (const w of times) {
    const p = inSpan(w) ? phase : phaseAt(list, w);
    if (!out.length || out[out.length - 1].phase !== p) out.push({ w, phase: p });
  }
  return out;
}

/**
 * P4-097: the page stalls ([{w0, w1}] wall ms) with how much of each fell in a play class phase (`playMs`: the game was on
 * screen and did not draw), longest in play first. A stall under the loading screen or a card has `playMs` 0.
 */
export function playStalls(stalls, phases, step = 5) {
  const out = [];
  for (const s of Array.isArray(stalls) ? stalls : []) {
    let play = 0;
    for (let w = s.w0; w < s.w1; w += step) if (phaseClass(phaseAt(phases, w)) === 'play') play += Math.min(step, s.w1 - w);
    out.push({ w0: s.w0, w1: s.w1, ms: Math.round(s.w1 - s.w0), playMs: Math.round(play), phase: phaseAt(phases, s.w0) });
  }
  return out.sort((a, b) => b.playMs - a.playMs);
}

/**
 * Resamples frames [{t (s since epoch), black, luma?}] (sorted) to one tick every `everyMs` from the first frame to `endT` (s).
 * Each tick: {ms (since the first frame), index (frame on screen), black, staleMs, phase, cls, diff, stillMs}. `diff` is the
 * mean luma difference to the previous tick's picture (0 on the same frame, Infinity on the first tick or with no luma);
 * `stillMs` is how long the game picture has shown no change of `stillDiff` or more, counted over `play` ticks only (a card
 * or the loading screen resets it). P4-096: with `stalls` (the page's own stalls, wall ms) each tick also has `stallMs`, how
 * long the page had drawn no new frame at that tick (counted from the start of the current play run at most), and `frozenMs`,
 * the age the judge reads: the shorter of the picture's age and `stallMs`. Without `stalls` `frozenMs` is the picture's age.
 */
export function resample(frames, endT, everyMs = 150, phases = [], { stillDiff = STILL_DIFF, stalls = null } = {}) {
  const ticks = [];
  if (!frames.length) return ticks;
  const first = frames[0].t;
  let i = 0;
  let prev = null;
  let playSince = null;
  const sorted = Array.isArray(stalls) ? [...stalls].sort((a, b) => a.w0 - b.w0) : null;
  for (let ms = 0; first + ms / 1000 <= endT + 1e-6; ms += everyMs) {
    const at = first + ms / 1000;
    while (i + 1 < frames.length && frames[i + 1].t <= at) i++;
    const phase = phaseAt(phases, at * 1000);
    const cls = phaseClass(phase);
    const diff = !prev ? Infinity : prev.index === i ? 0 : lumaDiff(frames[prev.index].luma, frames[i].luma);
    const still = cls === 'play' && prev && prev.cls === 'play' && diff < stillDiff;
    const stillMs = still ? prev.stillMs + everyMs : 0;
    const staleMs = Math.round((at - frames[i].t) * 1000);
    const w = at * 1000;
    if (cls === 'play' && (!prev || prev.cls !== 'play')) playSince = w;
    const age = Math.max(staleMs, stillMs);
    const k = { ms, index: i, black: !!frames[i].black, staleMs, phase, cls, diff: Number.isFinite(diff) ? +diff.toFixed(3) : null, stillMs, frozenMs: cls === 'play' ? age : 0 };
    if (sorted) {
      const s = stallAt(sorted, w);
      k.stallMs = s ? Math.max(0, Math.round(w - Math.max(s.w0, playSince ?? s.w0))) : 0;
      k.frozenMs = cls === 'play' ? Math.min(age, k.stallMs) : 0;
    }
    ticks.push(k);
    prev = k;
  }
  return ticks;
}

/**
 * The judge over resampled ticks: the longest plain black run outside the loading screen (ms, ticks times `everyMs`) and the
 * longest frozen stretch while the game is on screen (a tick whose picture is older than `frozenMaxMs`: the longer of its
 * arrival age and its run of still ticks, P4-091; P4-096: no longer than the page's own stall there, `frozenMs`).
 */
export function judgeTicks(ticks, { everyMs = 150, blackMaxMs = 500, frozenMaxMs = 500 } = {}) {
  let run = 0, longestBlack = 0, blackAt = null, runStart = null;
  let frozen = 0, frozenAt = null;
  for (const k of ticks) {
    if (k.black && k.cls !== 'loading') {
      if (run === 0) runStart = k.ms;
      run += everyMs;
      if (run > longestBlack) { longestBlack = run; blackAt = runStart; }
    } else run = 0;
    // P4-091: the picture has not changed for the longer of its arrival age and its run of still ticks; P4-096: and the page
    // drew no new frame for that long (`frozenMs`, when the page sent its stalls).
    const still = k.frozenMs ?? Math.max(k.staleMs, k.stillMs || 0);
    if (k.cls === 'play' && still > frozen) { frozen = still; frozenAt = k.stallMs !== undefined ? k.ms - still : k.ms - (k.stillMs || 0); }
  }
  const problems = [];
  if (longestBlack > blackMaxMs) problems.push(`plain black for ${longestBlack} ms from ${blackAt} ms outside the loading screen (limit ${blackMaxMs})`);
  if (frozen > frozenMaxMs) problems.push(`the game picture froze for ${frozen} ms at ${frozenAt} ms (limit ${frozenMaxMs}${ticks.some((k) => k.stallMs !== undefined) ? ', the page drew no new frame' : ''})`);
  const phases = [];
  for (const k of ticks) if (!phases.length || phases[phases.length - 1].phase !== k.phase) phases.push({ phase: k.phase, ms: k.ms });
  return { ok: problems.length === 0, problems, longestBlackMs: longestBlack, blackAtMs: blackAt, frozenMs: frozen, frozenAtMs: frozenAt, phases };
}
