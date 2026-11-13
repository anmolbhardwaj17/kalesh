// P1-023: foot slide of the humanoid at walk and jog (and sprint, reported), and the animation cost per character.
// foot('anim', {gait}) presses the gait keys on the course pad, waits 1 s, then samples three cycles of the clip every
// tick: slide is the stance foot's mean backward speed in the body frame against the ground speed (foot_contact.gd).
// Acceptance: under 5 percent at walk and at jog; the animation (AnimationTree advance and bone update) costs under
// 0.05 ms per character a tick, measured among 16 walking characters (foot('animcost')).
const S = window.__sim;
const D = S.D;
await D.load('course');
await S.frames(2);
const out = {};
for (const gait of ['walk', 'jog', 'sprint']) out[gait] = await D.foot('anim', { gait });
S.log('foot anim', out);
const problems = [];
for (const gait of ['walk', 'jog']) {
  const r = out[gait];
  if (!(r.slidePct < 5)) problems.push(`${gait}: foot slide ${r.slidePct} percent (want under 5; foot ${r.footMs} m/s, ground ${r.groundMs} m/s, clip ${r.clip} at ${r.rate})`);
}
const expect = { walk: 'walk', jog: 'jog', sprint: 'sprint' };
for (const [gait, st] of Object.entries(expect)) if (out[gait].state !== st) problems.push(`${gait}: the body plays ${out[gait].state} (want ${st})`);
// the cost per character among 16 walking characters (each one's median over 2 s; the median of those): the player's
// own reading above is one character alone, kept for the report
const crowd = await D.foot('animcost', { n: 16 });
S.log('anim cost', crowd);
if (!(crowd.msPerCharacter < 0.05)) problems.push(`animation costs ${crowd.msPerCharacter} ms per character a tick among 16 (want under 0.05)`);
const summary = Object.fromEntries(Object.entries(out).map(([g, r]) => [g, { slidePct: r.slidePct, rate: r.rate, ms: r.animMsPerTick }]));
summary.animMsPerCharacter = crowd.msPerCharacter;
return problems.length ? S.failed(problems.join('; '), { out, crowd }) : S.ok(summary);
