// P1-022 feel probe: jog north for 1 s, then let go of W and hold S (back toward the camera): the body faces south
// within 1 degree after 0.20 to 0.30 s (GAME.md: 180 degrees in 0.25 s while jogging). Sim ticks; input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.foot('run', { test: 'turn' });
D.timeScale(1);
S.log('foot turn', r);
const problems = [];
if (!(r.turnS >= 0.2 && r.turnS <= 0.3)) problems.push(`180 degrees in ${r.turnS} s (want 0.20 to 0.30)`);
if (!(Math.abs(r.speedBeforeMs - 3.8) < 0.05)) problems.push(`not jogging before the turn (${r.speedBeforeMs} m/s)`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ turnS: r.turnS });
