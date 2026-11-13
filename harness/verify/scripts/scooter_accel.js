// Starts 0.5 m off the course straight's centre line: x 0 is a seam of the course mesh, where both wheel rays of a
// two wheeler run along a shared triangle edge (0.9 m of drift over 340 m there, 0.15 m off it).
// P1-021 feel probe: the scooter from rest to 60 km/h with full throttle on the course straight, in sim ticks (GAME.md:
// 5 to 6 s). Also checks input is answered in 1 tick. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'scooter' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: '60', mark: 60, brakeFrom: 60, x: 0.5 });
D.timeScale(1);
S.log('scooter straight to 60', r);
const problems = [];
if (!(r.zeroToMarkS >= 5 && r.zeroToMarkS <= 6)) problems.push(`0 to 60 km/h in ${r.zeroToMarkS} s (want 5 to 6 s)`);
if (r.latencyTicks !== 1 && r.latencyTicks !== 0) problems.push(`input answered after ${r.latencyTicks} ticks (want 1)`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the scooter drifted ${r.lateralDriftM} m sideways`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ zeroTo60S: r.zeroToMarkS, latencyTicks: r.latencyTicks });
