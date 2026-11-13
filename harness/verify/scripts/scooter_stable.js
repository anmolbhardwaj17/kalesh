// P1-021 feel probe: the scooter (two wheels, the hidden stabiliser) holds up: 30 s of full throttle on the course
// straight, then a slalom at 40 km/h (a sine path 2 m either side, 24 m wave) for 12 s. No fall (roll of the physics
// body over 30 degrees, its up axis under 0.85, or no wheel down for 10 ticks); the slalom is real (over 1.2 m out)
// and the drawn body leans into it. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'scooter' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'stable' });
D.timeScale(1);
S.log('scooter stable', r);
const problems = [];
if (r.fell) problems.push('the scooter fell');
if (!(r.straight.maxRollDeg < 10)) problems.push(`roll ${r.straight.maxRollDeg} degrees on the straight (want under 10)`);
if (!(r.slalom.maxRollDeg < 15)) problems.push(`roll ${r.slalom.maxRollDeg} degrees in the slalom (want under 15)`);
if (!(r.straight.minWheelsInContact >= 1 && r.slalom.minWheelsInContact >= 1)) problems.push('both wheels left the ground');
if (!(r.slalom.maxLateralM > 1.2)) problems.push(`the slalom only went ${r.slalom.maxLateralM} m out (want over 1.2)`);
if (!(Math.abs(r.slalom.entryKmh - 40) <= 2)) problems.push(`slalom entered at ${r.slalom.entryKmh} km/h, not 40`);
if (!(r.slalom.maxLeanDeg > 5)) problems.push(`the body leaned only ${r.slalom.maxLeanDeg} degrees in the slalom`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ straight: r.straight, slalom: r.slalom });
