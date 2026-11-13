// P1-022 feel probe: jog north at the course's vault lane and press jump 0.75 m before each obstacle (a player who sees
// it coming). A 1.2 m wall and a 1.0 m railing are vaulted in 0.5 to 0.7 s and the feet end past the far face with no
// overlap; a 1.3 m wall is not vaulted (the jump only hops in front of it). Sim ticks; input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const w12 = await D.foot('run', { test: 'vault', wall: '1.2' });
const rail = await D.foot('run', { test: 'vault', wall: 'rail' });
const w13 = await D.foot('run', { test: 'vault', wall: '1.3' });
D.timeScale(1);
S.log('vault 1.2', w12, 'rail', rail, '1.3', w13);
const problems = [];
for (const [name, r] of [['1.2 m wall', w12], ['1.0 m railing', rail]]) {
  if (!r.vaulted) problems.push(`${name} not vaulted (end z ${r.endZ}, face ${r.faceZ})`);
  if (!(r.vaultS >= 0.5 && r.vaultS <= 0.7)) problems.push(`${name}: vault took ${r.vaultS} s (want 0.5 to 0.7)`);
  if (r.overlap) problems.push(`${name}: the body overlaps geometry after the vault`);
}
if (w13.vaulted || w13.vaultS !== null) problems.push(`the 1.3 m wall was vaulted (${JSON.stringify(w13)})`);
if (!(w13.endZ > w13.faceZ)) problems.push(`the body passed the 1.3 m wall (end z ${w13.endZ}, face ${w13.faceZ})`);
if (w13.overlap) problems.push('the body overlaps the 1.3 m wall');
return problems.length ? S.failed(problems.join('; '), { w12, rail, w13 }) : S.ok({ wall12S: w12.vaultS, railS: rail.vaultS, wall13: 'not vaulted' });
