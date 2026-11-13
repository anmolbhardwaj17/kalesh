// P1-021 feel probe: the auto takes the course gali's right angle corner (two lanes 3 m wide between 2.5 m walls) with
// scripted inputs: creep north at 8 km/h near the west wall, full right lock at the turn point, out along the east
// lane. Every tick the collision box (with a 2 cm skin) is tested against the walls: no contact at all, and the
// footprint gap stays above 0. Input only; only the start is staged.
const S = window.__sim;
const D = S.D;
await D.load('course');
await D.vehicle('use', { id: 'auto' });
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'gali' });
D.timeScale(1);
S.log('auto gali corner', r);
const problems = [];
if (!r.finished) problems.push(`the auto did not come out of the east lane (last ${JSON.stringify(r.trace.slice(-2))})`);
if (r.contactTicks) problems.push(`the auto touched a wall on ${r.contactTicks} ticks (first at ${JSON.stringify(r.firstContact)})`);
if (!(r.minClearanceM > 0)) problems.push(`no gap to the wall at ${JSON.stringify(r.minClearanceAt)}`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ minClearanceM: r.minClearanceM, at: r.minClearanceAt, simS: r.simS });
