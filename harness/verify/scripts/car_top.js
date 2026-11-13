// P1-020 feel probe: top speed with full throttle on the course straight, held until the speed grows by under 0.1 km/h in
// 3 s of sim (GAME.md: about 140 km/h for the ordinary car, owner answer; acceptance 138 to 143 km/h). Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: 'top' });
D.timeScale(1);
S.log('straight to top speed', r);
const problems = [];
if (!(r.topSpeedKmh >= 138 && r.topSpeedKmh <= 143)) problems.push(`top speed ${r.topSpeedKmh} km/h (want 138 to 143)`);
if (!(r.peakSpeedKmh <= 143.5)) problems.push(`peak speed ${r.peakSpeedKmh} km/h overshoots`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ topSpeedKmh: r.topSpeedKmh, reachedAfterS: r.topReachedAfterS, distanceM: r.topDistanceM, gear: r.gear });
