// P1-021 feel probe: the auto from rest to 40 km/h with full throttle on the course straight, in sim ticks (GAME.md: 5 to
// 6 s). Also checks input is answered in 1 tick. Input only (the probe presses the InputMap actions).
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'auto' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: '40', mark: 40, brakeFrom: 40 });
D.timeScale(1);
S.log('auto straight to 40', r);
const problems = [];
if (!(r.zeroToMarkS >= 5 && r.zeroToMarkS <= 6)) problems.push(`0 to 40 km/h in ${r.zeroToMarkS} s (want 5 to 6 s)`);
if (r.latencyTicks !== 1 && r.latencyTicks !== 0) problems.push(`input answered after ${r.latencyTicks} ticks (want 1)`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the auto drifted ${r.lateralDriftM} m sideways`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ zeroTo40S: r.zeroToMarkS, latencyTicks: r.latencyTicks });
