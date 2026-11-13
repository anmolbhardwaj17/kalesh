// P1-022: cost per on-foot character per tick. Sixteen more characters (not the player) walk on the course pad; the cost
// per character is the median physics iteration with them less the iteration with the player alone, over 16 (the script
// time per character is printed beside it). Acceptance: 0.05 ms or less. Windowed at time scale 4, so a drawn frame
// holds two or more ticks.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.foot('cost', { n: 16 });
D.timeScale(1);
S.log('cost per character', r);
const problems = [];
if (!(r.msPerCharacter <= 0.05)) problems.push(`${r.msPerCharacter} ms per character per tick (want 0.05 or less; script ${r.scriptMsPerCharacter} ms)`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok(r);
