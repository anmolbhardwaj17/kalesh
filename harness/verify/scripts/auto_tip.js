// P1-021 feel probe: the auto at full right lock at a held 40 km/h (from the moment the lock goes on to the end of the
// steady turn): under 12 degrees of roll, no tip over, a wheel always down on each side of the tip axis. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'auto' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'lock', kmh: 40 });
D.timeScale(1);
S.log('auto full lock at 40', r);
const problems = [];
if (!(r.maxRollDeg < 12)) problems.push(`roll ${r.maxRollDeg} degrees at full lock (want under 12)`);
if (r.flipped) problems.push('the auto tipped over');
if (!(r.minWheelsInContact >= 2)) problems.push(`only ${r.minWheelsInContact} wheels down at the worst tick`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ maxRollDeg: r.maxRollDeg, heldKmh: r.heldKmh, radiusM: r.radiusM, lateralG: r.lateralG, minWheels: r.minWheelsInContact });
