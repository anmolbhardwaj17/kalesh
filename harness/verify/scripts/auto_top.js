// P1-021 feel probe: the auto's top speed with full throttle on the course straight, held until the speed grows by under
// 0.1 km/h in 3 s of sim (GAME.md: about 65 km/h; acceptance 63 to 67 km/h). Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'auto' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: 'top', mark: 40, brakeFrom: 60 });
D.timeScale(1);
S.log('auto straight to top speed', r);
const problems = [];
if (!(r.topSpeedKmh >= 63 && r.topSpeedKmh <= 67)) problems.push(`top speed ${r.topSpeedKmh} km/h (want 63 to 67)`);
if (!(r.peakSpeedKmh <= 67.5)) problems.push(`peak speed ${r.peakSpeedKmh} km/h overshoots`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the auto drifted ${r.lateralDriftM} m sideways`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ topSpeedKmh: r.topSpeedKmh, reachedAfterS: r.topReachedAfterS, gear: r.gear });
