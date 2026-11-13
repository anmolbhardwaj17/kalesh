// P1-023: the humanoid from the on-foot play camera, input only, in the course scene. Four named shots for the
// verifier (VERIFY.md rubric lines 11 and 22: real proportions, nothing stretched or flattened, the three leads told
// apart): foot_anim_walk (walking on the pad), foot_anim_sprint (sprinting), foot_anim_vault (in the middle of the vault
// over the 1.2 m wall of the vault lane), lead_lineup (Bittu, SI Meera Rana and Danny side by side, the camera turned to
// face them). The sim is held for each shot, so the pose in the shot is the pose checked. Lockstep, windowed.
const S = window.__sim;
const D = S.D;
await D.load('course');
await S.frames(3);
await S.waitSim(0.5);
const problems = [];
const out = {};
const anim = async () => (await D.foot('info')).anim || {};
async function held(name, want) {
  await D.hold({ at: D.clock().t });
  await S.until(() => D.hold().paused, { sim: 1, label: `hold for ${name}` });
  const a = await anim();
  out[name] = { state: a.state, rate: a.rate, look: a.look };
  if (want && a.state !== want) problems.push(`${name}: the body plays ${a.state} (want ${want})`);
  await S.shot(name);
  await D.hold({ release: true });
}
// walk north on the pad
await D.foot('stage', { x: -290, z: 40, h: 0 });
D.input('move_forward', 1);
D.input('walk', true);
await S.waitSim(1.6);
await held('foot_anim_walk', 'walk');
D.input('walk', false);
D.input('move_forward', 0);
// sprint
await D.foot('stage', { x: -290, z: 40, h: 0 });
D.input('move_forward', 1);
D.input('sprint', true);
await S.waitSim(1.2);
await held('foot_anim_sprint', 'sprint');
D.input('sprint', false);
D.input('move_forward', 0);
// vault: jog at the 1.2 m wall of the vault lane and press jump 0.75 m before its face, as the foot_vault probe does
// (one probe run first only to read where the lane is)
const lane = await D.foot('run', { test: 'vault', wall: '1.2' });
const face = lane.faceZ;
await D.foot('stage', { x: lane.x, z: face + 5, h: 0 });
D.input('move_forward', 1);
await S.until(() => D.state().player.pos[2] - face <= 0.75, { sim: 4, label: 'at the wall' });
D.input('jump', true);
await S.waitSim(0.17);
D.input('jump', false);
await held('foot_anim_vault', 'vault');
D.input('move_forward', 0);
await S.waitSim(0.6);
// the three leads
const line = await D.foot('lineup', { x: -290, z: 40, h: 180 });
out.lineup = { player: line.player.look, meera: line.meera, danny: line.danny };
await held('lead_lineup', 'idle');
if (!(line.meera.look === 'meera' && line.danny.look === 'danny' && line.meera.ticks > 30 && line.danny.ticks > 30)) problems.push(`lineup looks ${JSON.stringify(out.lineup)}`);
await D.foot('lineup', { clear: true });
S.log('shots', out);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
