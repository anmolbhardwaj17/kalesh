// P1-021 feel probe: the auto over the one-sided 0.15 m kerb (the course's side slab: the right rear wheel climbs it)
// at a held 40 km/h, judged like car_kerb: under 10 degrees of roll, no flip, under 5 percent speed loss. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'auto' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'kerb' });
D.timeScale(1);
S.log('auto one-sided kerb', r);
const problems = [];
if (!r.finished) problems.push('the run did not reach the end of the slab');
if (!(r.maxRollDeg < 10)) problems.push(`roll ${r.maxRollDeg} degrees (want under 10)`);
if (r.flipped) problems.push('the auto flipped');
if (!(r.speedLossPct < 5)) problems.push(`speed loss ${r.speedLossPct} percent (want under 5)`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ maxRollDeg: r.maxRollDeg, speedLossPct: r.speedLossPct, minKmh: r.minKmh });
