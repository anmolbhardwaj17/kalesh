// Sim timed helpers for page-side verify scripts. browser.mjs evaluates this file before every script step and puts the
// result on window.__sim, so a script starts with `const S = window.__sim;`.
// Rules these helpers keep: a script never waits a fixed number of wall clock ms for the game to do something. It waits on a
// game condition, polled once per render frame (debug.frames), with a timeout in SIM seconds and a clear message. With the
// page param lockstep=1 (scenario option `lockstep: true`) every frame runs a fixed slice of sim, so a script that steers
// between frames steers the same steps on every run, on a loaded page too. A wall clock cap only catches a sim that stopped.
// Needs from the game (docs/GAME_HOOKS.md): debug.clock(), debug.frames(n), debug.input(action, value), debug.state().
(() => {
  const D = window.__game.debug;
  const clock = () => D.clock();
  // Automatic progress marks for long script steps: browser.mjs sets window.__scriptAutoProgress for a step whose budget is
  // AUTO_PROGRESS_MIN_MS or more. Every `until` that resolves marks, and so does every second of sim that frames() sees pass.
  // A script whose sim still moves runs on past its budget on a loaded machine; one whose sim stopped fails as stalled.
  // A script that calls S.progress itself keeps only its own marks.
  let ownMarks = false;
  let autoSimT = null;
  const logLines = [];
  window.__scriptLog = logLines;
  function autoMark(label) {
    if (ownMarks || window.__scriptAutoProgress !== true) return;
    const prev = window.__scriptProgress;
    window.__scriptProgress = { n: (prev && prev.n ? prev.n : 0) + 1, at: Date.now(), label: `auto ${String(label).slice(0, 110)}`, auto: true };
  }
  /** Resolves after `n` render frames (their steps and render). */
  async function frames(n = 1) {
    const r = await D.frames(n);
    if (!ownMarks && window.__scriptAutoProgress === true) {
      const t = clock().t;
      if (autoSimT === null || t < autoSimT) autoSimT = t;
      else if (t - autoSimT >= 1) { autoSimT = t; autoMark(`sim ${t.toFixed(1)} s`); }
    }
    return r;
  }
  /** Marks progress by hand (a long script that is still working says so; see browser.mjs budgets). */
  function progress(label) {
    ownMarks = true;
    const prev = window.__scriptProgress;
    window.__scriptProgress = { n: (prev && prev.n ? prev.n : 0) + 1, at: Date.now(), label: String(label).slice(0, 120) };
  }
  function log(...parts) { const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '); logLines.push(`${clock().t.toFixed(2)} ${line}`); return line; }
  /** Waits until pred() is truthy, polled once a frame, at most `sim` seconds of SIM time (and a wall cap for a stopped sim). */
  async function until(pred, { sim = 10, label = 'condition', wallMs } = {}) {
    const c0 = clock();
    const cap = wallMs ?? 15000 + (sim / Math.max(0.25, c0.scale || 1)) * 8000;
    const w0 = performance.now();
    for (;;) {
      let v; try { v = pred(); } catch (e) { throw new Error(`${label}: the check threw ${e && e.message ? e.message : e}`); }
      if (v) { autoMark(label); return v; }
      const t = clock();
      if (t.t - c0.t > sim) throw new Error(`${label}: not true after ${sim} s of sim (state ${JSON.stringify(D.state()).slice(0, 300)})`);
      if (performance.now() - w0 > cap) throw new Error(`${label}: the sim moved ${(t.t - c0.t).toFixed(2)} s in ${Math.round(cap / 1000)} s of wall time (paused ${t.paused})`);
      await frames(1);
    }
  }
  /** Lets `sec` seconds of sim pass. */
  async function waitSim(sec) { const t0 = clock().t; return until(() => clock().t >= t0 + sec - 1e-9, { sim: sec + 1, label: `wait ${sec} s of sim` }); }
  /** Holds an input action for `sec` seconds of sim, then releases it. */
  async function press(action, value = 1, sec = 0.1) {
    D.input(action, value);
    try { await waitSim(sec); } finally { D.input(action, Array.isArray(value) ? value.map(() => 0) : typeof value === 'boolean' ? false : 0); }
  }
  /** A screenshot through the harness (browser.mjs exposes window.__shot). */
  async function shot(name) { if (typeof window.__shot === 'function') await window.__shot(name); }
  /** Standard script result. */
  const ok = (summary) => ({ ok: true, log: logLines.slice(-40), summary });
  const failed = (reason, summary) => ({ ok: false, reason: String(reason), log: logLines.slice(-40), summary });
  return { D, clock, frames, progress, log, until, waitSim, press, shot, ok, failed };
})()
