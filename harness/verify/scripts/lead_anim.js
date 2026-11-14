// P2-063: each lead on its own model and its own locomotion clips (rig/loco_<id>.res), in numbers, input only, course
// scene. Per lead (the player dressed as that lead, foot('dress')): foot('anim') at walk, jog and sprint (play rate 0.9
// to 1.15, planted foot slide and wander under 5 percent, the P2-041 bar), and foot('feel', {test: 'pops'}) at a
// steady walk, jog and sprint (trunk bones turn at most 12 degrees a tick, limbs 42, the hips' step changes by at most
// 0.045 m and an ankle's by 0.17 m from one tick to the next: no pops from a retargeted skeleton). Headless.
const S = window.__sim;
const D = S.D;
await D.load('course');
await S.frames(2);
const problems = [];
const out = {};
for (const look of ['bittu', 'meera', 'danny']) {
  out[look] = {};
  for (const gait of ['walk', 'jog', 'sprint']) {
    const r = await D.foot('anim', { gait, look });
    out[look][gait] = { rate: r.rate, slidePct: r.slidePct, wanderPct: r.wanderPct, state: r.state, look: r.look };
    if (r.look !== look) problems.push(`${look} ${gait}: the body is ${r.look}`);
    if (!(r.rate >= 0.9 && r.rate <= 1.15)) problems.push(`${look} ${gait}: play rate ${r.rate} (want 0.9 to 1.15)`);
    if (!(r.slidePct < 5)) problems.push(`${look} ${gait}: foot slide ${r.slidePct} percent (want under 5)`);
    if (!(r.wanderPct < 5)) problems.push(`${look} ${gait}: the planted foot moves ${r.wanderPct} percent of the ground covered (want under 5)`);
    if (r.state !== gait) problems.push(`${look} ${gait}: plays ${r.state}`);
  }
  for (const move of ['walk', 'jog', 'sprint']) {
    const p = await D.foot('feel', { test: 'pops', move });
    out[look][`pops_${move}`] = { coreDeg: p.coreDeg, limbDeg: p.limbDeg, hipsJerkM: p.hipsJerkM, footJerkM: p.footJerkM, worstBone: p.worstBone };
    if (!(p.coreDeg <= 12)) problems.push(`${look} ${move}: a trunk bone turns ${p.coreDeg} degrees in a tick (want 12 or less)`);
    if (!(p.limbDeg <= 42)) problems.push(`${look} ${move}: a limb bone turns ${p.limbDeg} degrees in a tick (${p.worstBone}; want 42 or less)`);
    if (!(p.hipsJerkM <= 0.045)) problems.push(`${look} ${move}: the hips' step changes by ${p.hipsJerkM} m (want 0.045 or less)`);
    if (!(p.footJerkM <= 0.17)) problems.push(`${look} ${move}: an ankle's step changes by ${p.footJerkM} m (want 0.17 or less)`);
  }
}
await D.foot('dress', { look: 'bittu' });
S.log('leads', out);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
