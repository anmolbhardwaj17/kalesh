// P1-020 feel probe: full right lock at a held 38 km/h on the course pad; the steady turn radius is speed over yaw rate
// (acceptance 6 to 8 m). Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'lock', kmh: 38 });
D.timeScale(1);
S.log('full lock', r);
const problems = [];
if (!(r.radiusM >= 6 && r.radiusM <= 8)) problems.push(`full lock radius ${r.radiusM} m at ${r.heldKmh} km/h (want 6 to 8 m)`);
if (!(Math.abs(r.heldKmh - 38) <= 2)) problems.push(`held ${r.heldKmh} km/h, not 38`);
if (!r.turnsRight) problems.push('steer right did not turn the car right (clockwise from above)');
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ radiusM: r.radiusM, heldKmh: r.heldKmh, lateralG: r.lateralG });
