// P1-020: cost per V2 car per tick. Sixteen more cars (not the player) drive on the course straight; the cost per car is
// the median physics iteration with them less the iteration with the player alone, over 16 (the script time per car is
// printed beside it). Acceptance: 0.05 ms or less. Windowed at time scale 4, so a drawn frame holds two or more ticks.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.vehicle('cost', { n: 16 });
D.timeScale(1);
S.log('cost per car', r);
const problems = [];
if (!(r.msPerCar <= 0.05)) problems.push(`${r.msPerCar} ms per car per tick (want 0.05 or less; script ${r.scriptMsPerCar} ms)`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok(r);
