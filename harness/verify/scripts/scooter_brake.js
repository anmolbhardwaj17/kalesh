// Starts 0.5 m off the course straight's centre line: x 0 is a seam of the course mesh, where both wheel rays of a
// two wheeler run along a shared triangle edge (0.9 m of drift over 340 m there, 0.15 m off it).
// P1-021 feel probe: the scooter's full brake from 80 km/h to a stop on the course straight (GAME.md: 25 to 32 m),
// measured from the tick the speed falls through 80 km/h. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'scooter' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: '80', mark: 80, brakeFrom: 80, x: 0.5 });
D.timeScale(1);
S.log('scooter brake from 80', r);
const problems = [];
if (!(r.brakeFromM >= 25 && r.brakeFromM <= 32)) problems.push(`80 to 0 in ${r.brakeFromM} m (want 25 to 32 m)`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the scooter pulled ${r.lateralDriftM} m sideways under braking`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ brakeFrom80M: r.brakeFromM, brakeTimeS: r.brakeTimeS });
