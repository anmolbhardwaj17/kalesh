// P1-021 feel probe: the auto's full brake from 60 km/h to a stop on the course straight (GAME.md: 18 to 22 m), measured
// from the tick the speed falls through 60 km/h. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'auto' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'straight', until: '60', mark: 60, brakeFrom: 60 });
D.timeScale(1);
S.log('auto brake from 60', r);
const problems = [];
if (!(r.brakeFromM >= 18 && r.brakeFromM <= 22)) problems.push(`60 to 0 in ${r.brakeFromM} m (want 18 to 22 m)`);
if (!(r.lateralDriftM < 0.5)) problems.push(`the auto pulled ${r.lateralDriftM} m sideways under braking`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ brakeFrom60M: r.brakeFromM, brakeTimeS: r.brakeTimeS });
