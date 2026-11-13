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
  // ---- route following with real inputs (P1-024). Points are world metres [x, y, z]; only x and z steer.
  const wrapPi = (a) => { let v = a; while (v > Math.PI) v -= 2 * Math.PI; while (v < -Math.PI) v += 2 * Math.PI; return v; };
  function pathOf(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]));
    return { points, cum, length: cum[cum.length - 1] };
  }
  /** The point at distance s along a path: [x, z, segment direction heading]. */
  function pointAt(path, s) {
    const { points, cum } = path;
    const d = Math.max(0, Math.min(path.length, s));
    let i = 1;
    while (i < points.length - 1 && cum[i] < d) i++;
    const a = points[i - 1];
    const b = points[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, Math.atan2(b[0] - a[0], -(b[2] - a[2]))];
  }
  /** Where (x, z) projects onto the path near the last segment `from`: {s, off, seg}. */
  function project(path, x, z, from = 0) {
    const { points, cum } = path;
    let best = { s: 0, off: Infinity, seg: from };
    for (let i = Math.max(1, from - 2); i < Math.min(points.length, from + 40); i++) {
      const a = points[i - 1];
      const b = points[i];
      const abx = b[0] - a[0];
      const abz = b[2] - a[2];
      const L2 = abx * abx + abz * abz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[2]) * abz) / L2));
      const off = Math.hypot(x - (a[0] + abx * t), z - (a[2] + abz * t));
      if (off < best.off - 1e-6) best = { s: cum[i - 1] + t * Math.sqrt(L2), off, seg: i };
    }
    return best;
  }
  /**
   * Drives the player's vehicle along `points` with real inputs only (steer and throttle through debug.input, once a
   * frame): pure pursuit on a look-ahead point, a speed hold that slows for bends, and a brake to a stop at the end.
   * opts: {kmh (25), minKmh (12), lookM (6), maxOffM (6), stuckS (8), sim (budget s), label, stop (true), onFrame(info)}.
   * Resolves {s, length, maxOffM, simS, end} at the end; throws on leaving the route, getting stuck or the budget.
   */
  async function drive(points, opts = {}) {
    const path = pathOf(points);
    const vmax = (opts.kmh ?? 25) / 3.6;
    const vmin = (opts.minKmh ?? 12) / 3.6;
    const label = opts.label || 'drive';
    const t0 = clock().t;
    const budget = opts.sim ?? 30 + path.length / Math.max(vmin, vmax * 0.6);
    let seg = 1;
    let maxOff = 0;
    let bestS = 0;
    let bestAt = t0;
    let stopping = false;
    try {
      for (;;) {
        const p = D.state().player;
        const t = clock().t;
        const pr = project(path, p.pos[0], p.pos[2], seg);
        seg = pr.seg;
        maxOff = Math.max(maxOff, pr.off);
        if (pr.s > bestS + 1) { bestS = pr.s; bestAt = t; }
        const left = path.length - pr.s;
        const info = { s: pr.s, left, off: pr.off, speed: p.speed, t: t - t0, pos: p.pos, heading: p.heading };
        if (opts.onFrame) await opts.onFrame(info);
        if (pr.off > (opts.maxOffM ?? 6)) throw new Error(`${label}: ${pr.off.toFixed(1)} m off the route at ${pr.s.toFixed(0)} of ${path.length.toFixed(0)} m (${p.pos.map((v) => v.toFixed(1)).join(', ')})`);
        if (t - bestAt > (opts.stuckS ?? 8)) throw new Error(`${label}: stuck at ${pr.s.toFixed(0)} of ${path.length.toFixed(0)} m for ${(t - bestAt).toFixed(1)} s (${p.pos.map((v) => v.toFixed(1)).join(', ')})`);
        if (t - t0 > budget) throw new Error(`${label}: ${budget.toFixed(0)} s of sim and only ${pr.s.toFixed(0)} of ${path.length.toFixed(0)} m`);
        if (opts.stop === false && left < 3) break;
        if (left < 1.5 || stopping) {
          stopping = true;
          if (Math.abs(p.speed) < 0.3) break;
          D.input('throttle', -1);
          D.input('steer', 0);
          await frames(1);
          continue;
        }
        const look = Math.max(opts.lookM ?? 6, 3 + Math.abs(p.speed) * 0.7);
        const aim = pointAt(path, pr.s + look);
        const want = Math.atan2(aim[0] - p.pos[0], -(aim[1] - p.pos[2]));
        const err = wrapPi(want - p.heading);
        D.input('steer', Math.max(-1, Math.min(1, err * 2.2)));
        // slow for the bend ahead (the heading change over the next 25 m) and for the stop at the end
        const bend = Math.abs(wrapPi(pointAt(path, pr.s + 25)[2] - pointAt(path, pr.s + 2)[2]));
        let v = Math.max(vmin, vmax * (1 - bend / 1.3));
        if (opts.stop !== false) v = Math.min(v, Math.sqrt(2 * 2.5 * Math.max(0, left - 1)));
        const e = v - p.speed;
        D.input('throttle', e > 0 ? Math.min(1, e * 0.9 + 0.15) : Math.max(-1, e * 0.8));
        await frames(1);
      }
    } finally {
      D.input('throttle', 0);
      D.input('steer', 0);
    }
    const p = D.state().player;
    return { s: Math.max(bestS, path.length - Math.hypot(points[points.length - 1][0] - p.pos[0], points[points.length - 1][2] - p.pos[2])), length: path.length, maxOffM: maxOff, simS: clock().t - t0, end: p };
  }
  /**
   * Walks the player on foot along `points` with real inputs only (move_x and move_y through debug.input, relative to
   * the camera's look, the way the keys work; look_x turns the camera toward the walk unless turnCamera is false):
   * opts {gait: 'jog' | 'walk' | 'sprint', lookM (1.5), maxOffM (3), stuckS (6), sim, label, turnCamera, onFrame(info)}.
   * Stops on the last point. Resolves {s, length, maxOffM, simS, end}.
   */
  async function walk(points, opts = {}) {
    const path = pathOf(points);
    const label = opts.label || 'walk';
    const t0 = clock().t;
    const budget = opts.sim ?? 20 + path.length / 1.2;
    const gaitKey = opts.gait === 'walk' ? 'walk' : opts.gait === 'sprint' ? 'sprint' : null;
    let seg = 1;
    let maxOff = 0;
    let bestS = 0;
    let bestAt = t0;
    if (gaitKey) D.input(gaitKey, 1);
    try {
      for (;;) {
        const st = D.state();
        const p = st.player;
        const t = clock().t;
        const pr = project(path, p.pos[0], p.pos[2], seg);
        seg = pr.seg;
        maxOff = Math.max(maxOff, pr.off);
        if (pr.s > bestS + 0.5) { bestS = pr.s; bestAt = t; }
        const left = path.length - pr.s;
        if (opts.onFrame) await opts.onFrame({ s: pr.s, left, off: pr.off, t: t - t0, pos: p.pos });
        if (pr.off > (opts.maxOffM ?? 3)) throw new Error(`${label}: ${pr.off.toFixed(1)} m off the path at ${pr.s.toFixed(0)} of ${path.length.toFixed(0)} m`);
        if (t - bestAt > (opts.stuckS ?? 6)) throw new Error(`${label}: stuck at ${pr.s.toFixed(1)} of ${path.length.toFixed(0)} m (${p.pos.map((v) => v.toFixed(2)).join(', ')})`);
        if (t - t0 > budget) throw new Error(`${label}: ${budget.toFixed(0)} s of sim and only ${pr.s.toFixed(0)} of ${path.length.toFixed(0)} m`);
        const end = points[points.length - 1];
        if (left < 0.6 || Math.hypot(end[0] - p.pos[0], end[2] - p.pos[2]) < 0.6) break;
        const aim = pointAt(path, pr.s + (opts.lookM ?? 1.5));
        let dx = aim[0] - p.pos[0];
        let dz = aim[1] - p.pos[2];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        const cd = st.camera ? st.camera.dir : [0, 0, -1];
        const fl = Math.hypot(cd[0], cd[2]) || 1;
        const fx = cd[0] / fl;
        const fz = cd[2] / fl;
        // on_foot.gd read_input: move = f * forward + r * side with r = (-f.z, 0, f.x)
        D.input('move_y', dx * fx + dz * fz);
        D.input('move_x', dx * -fz + dz * fx);
        // and the look keys turn the camera behind the walk, the way a player keeps the view ahead
        if (opts.turnCamera !== false) {
          const yawErr = wrapPi(Math.atan2(dx, -dz) - Math.atan2(fx, -fz));
          D.input('look_x', Math.abs(yawErr) < 0.05 ? 0 : Math.max(-1, Math.min(1, yawErr * 1.5)));
        }
        await frames(1);
      }
    } finally {
      D.input('move_x', 0);
      D.input('move_y', 0);
      D.input('look_x', 0);
      if (gaitKey) D.input(gaitKey, 0);
    }
    const p = D.state().player;
    return { s: bestS, length: path.length, maxOffM: maxOff, simS: clock().t - t0, end: p };
  }
  /** Standard script result. */
  const ok = (summary) => ({ ok: true, log: logLines.slice(-40), summary });
  const failed = (reason, summary) => ({ ok: false, reason: String(reason), log: logLines.slice(-40), summary });
  return { D, clock, frames, progress, log, until, waitSim, press, shot, ok, failed, drive, walk, pathOf, project };
})()
