// P1-022 feel probe: sprint from a full stamina bar until it runs out (want 8 s within 0.3 s), then stand still until the
// bar is full again (want 5 s within 0.3 s). Sim ticks; input only (Shift and W through the InputMap actions).
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.foot('run', { test: 'stamina' });
D.timeScale(1);
S.log('foot stamina', r);
const problems = [];
if (!(Math.abs(r.sprintS - 8) <= 0.3)) problems.push(`sprint lasted ${r.sprintS} s (want 8 within 0.3)`);
if (!(Math.abs(r.regenS - 5) <= 0.3)) problems.push(`stamina came back in ${r.regenS} s (want 5 within 0.3)`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ sprintS: r.sprintS, regenS: r.regenS });
