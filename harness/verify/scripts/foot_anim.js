// P1-023, P2-041: foot slide and play rate of the humanoid at walk, jog and sprint, and the animation cost per character.
// foot('anim', {gait}) presses the gait keys on the course pad, waits 1.5 s, then samples three gait cycles every tick.
// Slide is the planted foot's mean backward speed in the body frame against the ground speed (foot_contact.gd: a foot
// is planted while its ball is on the ground, so the flight of a run is not counted); wander is how far the planted
// ball moves over the ground per metre the body covers. Acceptance (P2-041): the play rate of the walk, jog and sprint
// clips is between 0.9 and 1.15 (1 is the built clip's own pace), slide and wander are under 5 percent at all three;
// the animation with the body feel (lean, foot placement) costs under 0.05 ms per character a tick among 16 walking
// characters (foot('animcost')). Prints one line per gait: rate, cadence, how much faster the built cycle is than the
// library clip it is made from, slide.
const S = window.__sim;
const D = S.D;
await D.load('course');
await S.frames(2);
const out = {};
for (const gait of ['walk', 'jog', 'sprint']) out[gait] = await D.foot('anim', { gait });
S.log('foot anim', out);
const problems = [];
for (const gait of ['walk', 'jog', 'sprint']) {
  const r = out[gait];
  S.log(`${gait}: clip ${r.clip} rate ${r.rate} (${r.cadenceSpm} steps a minute, built cycle ${r.sourceRate}x the library clip's), slide ${r.slidePct} percent, wander ${r.wanderPct} percent`);
  if (!(r.rate >= 0.9 && r.rate <= 1.15)) problems.push(`${gait}: play rate ${r.rate} (want 0.9 to 1.15; clip ${r.clip})`);
  if (!(r.slidePct < 5)) problems.push(`${gait}: foot slide ${r.slidePct} percent (want under 5; foot ${r.footMs} m/s, ground ${r.groundMs} m/s, clip ${r.clip} at ${r.rate})`);
  if (!(r.wanderPct < 5)) problems.push(`${gait}: the planted foot moves ${r.wanderPct} percent of the ground covered (want under 5)`);
  if (!(r.downShare > 0.1)) problems.push(`${gait}: a foot is down in only ${r.downShare} of the samples`);
}
const expect = { walk: 'walk', jog: 'jog', sprint: 'sprint' };
for (const [gait, st] of Object.entries(expect)) if (out[gait].state !== st) problems.push(`${gait}: the body plays ${out[gait].state} (want ${st})`);
// the cost per character among 16 walking characters (each one's median over 2 s; the median of those): the player's
// own reading above is one character alone, kept for the report
const crowd = await D.foot('animcost', { n: 16 });
S.log('anim cost', crowd);
if (!(crowd.msPerCharacter < 0.05)) problems.push(`animation costs ${crowd.msPerCharacter} ms per character a tick among 16 (want under 0.05)`);
const summary = Object.fromEntries(Object.entries(out).map(([g, r]) => [g, { rate: r.rate, cadenceSpm: r.cadenceSpm, sourceRate: r.sourceRate, slidePct: r.slidePct, wanderPct: r.wanderPct, ms: r.animMsPerTick }]));
summary.animMsPerCharacter = crowd.msPerCharacter;
return problems.length ? S.failed(problems.join('; '), { out, crowd }) : S.ok(summary);
