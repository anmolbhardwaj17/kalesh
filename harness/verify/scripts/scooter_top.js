// Starts 0.5 m off the course straight's centre line: x 0 is a seam of the course mesh, where both wheel rays of a
// two wheeler run along a shared triangle edge (0.9 m of drift over 340 m there, 0.15 m off it).
// P1-021 feel probe: the scooter's top speed with full throttle on the course straight, held until the speed grows by
// under 0.1 km/h in 3 s of sim (GAME.md: about 90 km/h; acceptance 88 to 92 km/h). Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'scooter' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: 'top', mark: 60, brakeFrom: 80, x: 0.5 });
D.timeScale(1);
S.log('scooter straight to top speed', r);
const problems = [];
if (!(r.topSpeedKmh >= 88 && r.topSpeedKmh <= 92)) problems.push(`top speed ${r.topSpeedKmh} km/h (want 88 to 92)`);
if (!(r.peakSpeedKmh <= 92.5)) problems.push(`peak speed ${r.peakSpeedKmh} km/h overshoots`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the scooter drifted ${r.lateralDriftM} m sideways`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ topSpeedKmh: r.topSpeedKmh, reachedAfterS: r.topReachedAfterS, gear: r.gear });
