// P2-063: each lead model in a real street at player height, input only. Start: spawn pin chandni_chowk_east (--spawn),
// in the auto on Chandni Chowk main road; F gets the player out (PlayerMode), then for each lead the player's body is
// dressed as that lead (foot('dress'), staging only) and two shots are taken with the sim held: the on-foot play camera
// as the player sees it (lead_<id>_street_play) and a camera 2.2 m in front and to the right at eye height
// (lead_<id>_street_close). `node harness/bin/leadsheet.mjs` lays them out with the course shots.
const S = window.__sim;
const D = S.D;
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
const problems = [];
const out = {};
D.input('enter_exit', 1);
await S.until(() => D.state().player.mode === 'foot', { sim: 6, label: 'out of the auto' });
D.input('enter_exit', 0);
await S.waitSim(1.0);
// a few steps forward, away from the auto
D.input('walk', true);
D.input('move_y', 1);
await S.waitSim(1.5);
D.input('move_y', 0);
D.input('walk', false);
await S.waitSim(1.0);
for (const id of ['bittu', 'meera', 'danny']) {
  await D.foot('dress', { look: id });
  await S.waitSim(1.0);
  await D.hold({ at: D.clock().t + 1e-4 });
  await S.until(() => D.hold().paused, { sim: 2, label: 'hold' });
  const i = await D.foot('info');
  out[id] = { model: i.anim.model, state: i.anim.state, pos: i.pos };
  if (i.anim.model !== 'lead') problems.push(`${id}: drawn on the ${i.anim.model}`);
  await S.shot(`lead_${id}_street_play`);
  const p = i.pos;
  const h = i.heading;
  const f = [Math.sin(h), -Math.cos(h)];
  const r = [Math.cos(h), Math.sin(h)];
  D.setCamera({ pos: [p[0] + f[0] * 2.0 + r[0] * 1.0, p[1] + 1.6, p[2] + f[1] * 2.0 + r[1] * 1.0], target: [p[0], p[1] + 1.1, p[2]] });
  await S.frames(3);
  await S.shot(`lead_${id}_street_close`);
  D.setCamera(null);
  await S.frames(1);
  await D.hold({ release: true });
  await S.until(() => !D.hold().paused, { sim: 2, label: 'release' });
}
await D.foot('dress', { look: 'bittu' });
S.log('street', out);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
