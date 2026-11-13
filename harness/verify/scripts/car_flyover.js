// P1-020 feel probe: over the course flyover's deck (six 20 m segments with 1.5 cm lips and one open 4 cm joint) at a held
// 100 km/h. Acceptance: all wheels in contact for at least 95 percent of the ticks on the deck. Input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('run', { test: 'flyover' });
D.timeScale(1);
S.log('flyover deck', r);
const problems = [];
if (!r.finished) problems.push('the run did not cross the deck');
if (!(r.entryKmh >= 95)) problems.push(`entered the deck at ${r.entryKmh} km/h, not 100`);
if (!(r.allWheelsTicksPct >= 95)) problems.push(`all wheels in contact on ${r.allWheelsTicksPct} percent of the deck ticks (want 95 or more)`);
if (r.flipped) problems.push('the car flipped');
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ allWheelsTicksPct: r.allWheelsTicksPct, ticks: r.ticks, entryKmh: r.entryKmh, maxRollDeg: r.maxRollDeg });
