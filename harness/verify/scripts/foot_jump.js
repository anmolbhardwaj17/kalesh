// P1-022 feel probe: a jump from standing and one while jogging on the flat pad (Space through the InputMap action).
// GAME.md: apex 0.45 m in 0.30 s; acceptance 0.42 to 0.48 m reached in 0.27 to 0.33 s. Sim ticks.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const stand = await D.foot('run', { test: 'jump' });
const run = await D.foot('run', { test: 'jump', running: true });
D.timeScale(1);
S.log('jump standing', stand, 'jump jogging', run);
const problems = [];
for (const [name, r] of [['standing', stand], ['jogging', run]]) {
  if (!(r.apexM >= 0.42 && r.apexM <= 0.48)) problems.push(`${name}: apex ${r.apexM} m (want 0.42 to 0.48)`);
  if (!(r.apexS >= 0.27 && r.apexS <= 0.33)) problems.push(`${name}: apex after ${r.apexS} s (want 0.27 to 0.33)`);
  if (!(r.landS > r.apexS)) problems.push(`${name}: did not land (landS ${r.landS})`);
}
return problems.length ? S.failed(problems.join('; '), { stand, run }) : S.ok({ standing: [stand.apexM, stand.apexS], jogging: [run.apexM, run.apexS] });
