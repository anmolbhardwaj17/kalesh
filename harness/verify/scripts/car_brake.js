// P1-020 feel probe: full brake from 100 km/h to a stop on the course straight (GAME.md: 38 to 45 m for the ordinary car),
// measured from the tick the speed falls through 100 km/h. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: '100' });
D.timeScale(1);
S.log('brake from 100', r);
const problems = [];
if (!(r.brakeFrom100M >= 38 && r.brakeFrom100M <= 45)) problems.push(`100 to 0 in ${r.brakeFrom100M} m (want 38 to 45 m)`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the car pulled ${r.lateralDriftM} m sideways under braking`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ brakeFrom100M: r.brakeFrom100M, brakeTimeS: r.brakeTimeS });
