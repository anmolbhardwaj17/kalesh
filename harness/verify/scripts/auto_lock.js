// P1-021 feel probe: the auto at full right lock at a held 15 km/h on the course pad; the steady turn radius is speed
// over yaw rate (acceptance 3.5 to 4.5 m: tight enough for a gali corner). Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'auto' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'lock', kmh: 15 });
D.timeScale(1);
S.log('auto full lock at 15', r);
const problems = [];
if (!(r.radiusM >= 3.5 && r.radiusM <= 4.5)) problems.push(`full lock radius ${r.radiusM} m at ${r.heldKmh} km/h (want 3.5 to 4.5 m)`);
if (!(Math.abs(r.heldKmh - 15) <= 1.5)) problems.push(`held ${r.heldKmh} km/h, not 15`);
if (!r.turnsRight) problems.push('steer right did not turn the auto right (clockwise from above)');
if (r.flipped) problems.push('the auto tipped over');
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ radiusM: r.radiusM, heldKmh: r.heldKmh, maxRollDeg: r.maxRollDeg });
