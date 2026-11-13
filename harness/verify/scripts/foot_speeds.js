// P1-022 feel probe: walk, jog, sprint and crouch from rest on the open pad of the course scene, in sim ticks: 1 s to
// get going, then the ground speed over 2 s. GAME.md "Movement and camera feel": walk 1.6, jog 3.8, sprint 6.5,
// crouch 1.2 m/s, each within 3 percent. Input only (the probe presses the InputMap actions); only the start is staged.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(4);
await S.frames(2);
const r = await D.foot('run', { test: 'speeds' });
D.timeScale(1);
S.log('foot speeds', r);
const problems = [];
for (const g of ['walk', 'jog', 'sprint', 'crouch']) {
  const x = r[g];
  if (!x || !(Math.abs(x.errorPct) <= 3)) problems.push(`${g}: ${x && x.measuredMs} m/s (want ${x && x.targetMs} within 3 percent)`);
}
const st = D.state();
if (!st.player || st.player.mode !== 'foot') problems.push(`state().player.mode is ${st.player && st.player.mode} on foot`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.measuredMs])));
