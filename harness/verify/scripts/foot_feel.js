// P2-041: how the on-foot body moves, in numbers (the frame strips of foot_feel_strip are for the eyes). Input only.
//   pops    start from standing, stop from a jog and plant-and-turn back (each stop and turn at three points of the
//           gait cycle), read every tick in skeleton space: no trunk bone turns more than coreDeg in a tick, no limb
//           bone more than limbDeg, the hips' step never changes by more than hipsJerkM from one tick to the next and
//           an ankle's by no more than footJerkM. The steady walk, jog and sprint are measured the same way, under
//           the same limits (measured base line: a jog's trunk 4.9 degrees, its ankle 0.108 m; a pop of the old
//           Transition restart was a 0.19 m hips jump).
//   ik      feet on the kerb lane and the stairs at a walk and a jog: of the planted feet (the animation has the foot
//           down and the capsule stands on the ground) the 95th percentile is within ikP95M of the surface and
//           ikSharePct percent are within 3 cm; the worst may not pass ikWorstM. The hips never step more than
//           hipsStepM in a tick beyond the body's own climb (the capsule hops 15 to 18 cm at a kerb or a riser).
//           Known gap (reported in P2-041): a few ticks of a walking step that comes off a kerb or whose foot drifts
//           over a stair edge are 5 to 9 cm off; running down the stairs is mostly a fall and is reported only.
//   camera  a start, a sprint, a stop and a turn: the follow lag stays under 0.15 m, the camera never jitters
// Headless, course scene. The limits are fixed numbers (set from the measured base line, P2-041).
const S = window.__sim;
const D = S.D;
const LIMIT = { coreDeg: 12, limbDeg: 42, hipsJerkM: 0.045, footJerkM: 0.17, ikP95M: 0.02, ikSharePct: 97, ikWorstM: 0.12, hipsStepM: 0.065, jitterM: 0.006, flips: 0, lagM: 0.15 };
await D.load('course');
await S.frames(2);
const out = { pops: {}, ik: {}, limit: LIMIT };
const problems = [];
for (const move of ['walk', 'jog', 'sprint', 'start', 'stop', 'turn']) {
  const r = await D.foot('feel', { test: 'pops', move });
  out.pops[move] = r;
  const base = ['walk', 'jog', 'sprint'].includes(move);
  if (!base && !r.states.includes(move)) problems.push(`${move}: the ${move} clip never played (states ${r.states})`);
  for (const k of ['coreDeg', 'limbDeg', 'hipsJerkM', 'footJerkM']) {
    if (!(r[k] <= LIMIT[k])) problems.push(`${move}: ${k} ${r[k]} (limit ${LIMIT[k]}${k === 'limbDeg' ? `, ${r.worstBone}` : k === 'coreDeg' ? `, ${r.worstCore}` : ''})`);
  }
}
D.timeScale(4);
for (const [gait, run] of [['walk', 'kerbs_north'], ['jog', 'kerbs_north'], ['walk', 'stairs_north'], ['walk', 'stairs_south'], ['jog', 'stairs_north'], ['jog', 'stairs_south']]) {
  const r = await D.foot('feel', { test: 'ik', gait, run });
  out.ik[`${gait}_${run}`] = r;
  if (!r.finished) problems.push(`ik ${gait} ${run}: the run did not come through`);
  if (!(r.samples > 50)) problems.push(`ik ${gait} ${run}: only ${r.samples} planted samples`);
  // running down the stairs is a string of falls (0.8 m of drop a stride): reported, not judged
  if (gait === 'jog' && run === 'stairs_south') continue;
  if (!(r.p95ErrM <= LIMIT.ikP95M)) problems.push(`ik ${gait} ${run}: planted feet p95 ${r.p95ErrM} m from the surface (limit ${LIMIT.ikP95M})`);
  if (!(r.within3cmPct >= LIMIT.ikSharePct)) problems.push(`ik ${gait} ${run}: ${r.within3cmPct} percent of planted feet within 3 cm (want ${LIMIT.ikSharePct})`);
  if (!(r.maxErrM <= LIMIT.ikWorstM)) problems.push(`ik ${gait} ${run}: a planted foot ${r.maxErrM} m from the surface (limit ${LIMIT.ikWorstM}; ${JSON.stringify(r.worst)})`);
  if (!(r.hipsStepMaxM <= LIMIT.hipsStepM)) problems.push(`ik ${gait} ${run}: the hips step ${r.hipsStepMaxM} m in a tick (limit ${LIMIT.hipsStepM}; ${r.hipsStepAt})`);
}
D.timeScale(1);
const cam = await D.foot('feel', { test: 'camera' });
out.camera = cam;
if (!(cam.jitterM <= LIMIT.jitterM)) problems.push(`camera jitter ${cam.jitterM} m (limit ${LIMIT.jitterM})`);
if (!(cam.flips <= LIMIT.flips)) problems.push(`camera offset reverses ${cam.flips} times (limit ${LIMIT.flips})`);
if (!(cam.lagMaxM <= LIMIT.lagM && cam.lagMaxM > 0.03)) problems.push(`camera follow lag ${cam.lagMaxM} m (want 0.03 to ${LIMIT.lagM})`);
S.log('feel', out);
const brief = { pops: Object.fromEntries(Object.entries(out.pops).map(([k, r]) => [k, [r.coreDeg, r.limbDeg, r.hipsJerkM, r.footJerkM]])),
  ik: Object.fromEntries(Object.entries(out.ik).map(([k, r]) => [k, { maxM: r.maxErrM, p95M: r.p95ErrM, within3cmPct: r.within3cmPct, hipsStepM: r.hipsStepMaxM, n: r.samples }])), camera: cam };
return problems.length ? S.failed(problems.join('; '), out) : S.ok(brief);
