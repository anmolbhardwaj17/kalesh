// P1-020 feel probe: 0 to 100 km/h with full throttle from rest on the course straight, in sim ticks (GAME.md "Movement
// and camera feel": 10 to 12 s for the ordinary car). Also checks input is answered in 1 tick. Input only (the probe
// presses the InputMap actions); the vehicle is staged with place(), as teleport does.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: '100' });
D.timeScale(1);
S.log('straight to 100', r);
const problems = [];
if (!(r.zeroTo100S >= 10 && r.zeroTo100S <= 12)) problems.push(`0 to 100 km/h in ${r.zeroTo100S} s (want 10 to 12 s)`);
if (r.latencyTicks !== 1 && r.latencyTicks !== 0) problems.push(`input answered after ${r.latencyTicks} ticks (want 1)`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the car drifted ${r.lateralDriftM} m sideways on the straight`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ zeroTo100S: r.zeroTo100S, latencyTicks: r.latencyTicks, zeroTo100DistanceM: r.zeroTo100DistanceM });
