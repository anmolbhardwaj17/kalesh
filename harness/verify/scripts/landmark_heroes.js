// P2-007: the parts kit heroes at player height. For each pose of game/data/landmark_poses.json (params.poses picks
// some, default all): the player is staged at the pose (teleport: the ring there loads and the kit landmarks near it
// are built), the camera stands at the ground there plus the eye height (1.7 m on foot) looking at the landmark, and
// the shot is taken. Checks: every kit landmark is built (city('kit')), each one's built height is within 5 percent
// of its registry height, the landmark looked at is in front of the camera and in the middle half of the frame, and
// Jama Masjid is flagged as a place of worship that is never a combat arena.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const params = window.__scriptParams || {};
const poses = data.poses || {};
const eye = data.eyeM || 1.7;
const pick = params.poses || Object.keys(poses);
await S.until(() => D.state().world && D.state().world.ready, { sim: 20, label: 'the city ring is attached' });
const problems = [];
// the kit builds every landmark on worker threads from the start; wait until all are in (at most 60 s of game time)
let kit = await D.city('kit');
for (let i = 0; i < 120 && !kit.ready; i++) {
  await S.waitSim(0.5);
  kit = await D.city('kit');
}
if (!kit.ready) problems.push(`kit landmarks still building: ${kit.building.join(', ')}`);
const by = new Map(kit.landmarks.map((l) => [l.id, l]));
for (const l of kit.landmarks) {
  if (l.heightErrPct !== null && l.heightErrPct > 5) problems.push(`${l.id}: built ${l.heightM} m against ${l.registryHeightM} m (${l.heightErrPct} percent)`);
  // the hero rule the stand-in keeps too (DELHI_WORLD.md section 10, HM2): 8 parts of 25,000 triangles, a far silhouette under 2,000
  if (l.source === 'kit' && l.triangles.length === 4) {
    if (l.parts > 8) problems.push(`${l.id}: ${l.parts} parts, 8 at most`);
    if (l.maxPartTriangles[0] > 25000) problems.push(`${l.id}: a part of ${l.maxPartTriangles[0]} triangles at level 0, 25,000 at most`);
    if (l.triangles[3] >= 2000) problems.push(`${l.id}: far silhouette ${l.triangles[3]} triangles, under 2,000`);
  }
}
const jm = by.get('jama_masjid');
if (!jm || !jm.worship || jm.combatArena !== false) problems.push(`Jama Masjid must be built and flagged worship, never a combat arena (${JSON.stringify(jm && { worship: jm.worship, combatArena: jm.combatArena })})`);
const pins = await D.city('pins');
const shots = {};
for (const id of pick) {
  const p = poses[id];
  if (!p) {
    problems.push(`no pose ${id}`);
    continue;
  }
  const lm = by.get(p.look.landmark);
  // the player (in the vehicle) stands 10 m behind the eye, out of the view; the eye is on the drawn ground there
  const look0 = lm ? lm.pos : [p.at[0] + 1, 0, p.at[1]];
  const off0 = p.look.offset || [0, 0];
  const dx = look0[0] + off0[0] - p.at[0];
  const dz = look0[2] + off0[1] - p.at[1];
  const dl = Math.hypot(dx, dz) || 1;
  const ok = await D.teleport([p.at[0] - (dx / dl) * 10, 0, p.at[1] - (dz / dl) * 10]);
  if (ok !== true) problems.push(`${id}: teleport answered ${ok}`);
  await S.frames(2);
  const surf = (await D.city('surface', { points: [[p.at[0], p.at[1]]] }))[0];
  const ground = surf && surf.drawn ? surf.drawnY : D.state().player.pos[1];
  const pin = (await D.city('pins')).find((q) => q.id === `lm:${p.look.landmark}`) || pins.find((q) => q.id === `lm:${p.look.landmark}`);
  const base = lm ? lm.pos : pin ? [pin.x, pin.y, pin.z] : null;
  if (!base) {
    problems.push(`${id}: no landmark ${p.look.landmark}`);
    continue;
  }
  const off = p.look.offset || [0, 0];
  const target = [base[0] + off[0], base[1] + (p.look.up || 0), base[2] + off[1]];
  const pos = [p.at[0], ground + eye, p.at[1]];
  await D.setCamera({ pos, target });
  // two seconds of game time: the ring settles and the level fades end
  await S.waitSim(2);
  const sc = await D.city('screen', { points: [target] });
  const at = sc.points[0];
  const mid = at.front && at.x > sc.size[0] / 4 && at.x < (3 * sc.size[0]) / 4 && at.y > 0 && at.y < sc.size[1];
  if (!mid) problems.push(`${id}: ${p.look.landmark} is not in the middle half of the frame (${at.x.toFixed(0)}, ${at.y.toFixed(0)}, front ${at.front})`);
  const report = await D.city('kit');
  const shown = report.landmarks.find((l) => l.id === p.landmark) || report.landmarks.find((l) => l.id === p.look.landmark);
  shots[id] = { shot: p.shot, pos, target, distance: Math.hypot(target[0] - pos[0], target[2] - pos[2]).toFixed(1), level: shown ? shown.level : null };
  S.log(id, shots[id]);
  await S.shot(p.shot);
}
await D.setCamera(null);
const heights = kit.landmarks.map((l) => ({ id: l.id, registry: l.registryHeightM, built: l.heightM, errPct: l.heightErrPct, part: l.heightPart, triangles: l.triangles, maxPartTriangles: l.maxPartTriangles, parts: l.parts, buildMs: l.buildMs }));
if (problems.length) return S.failed(problems.join('; '), { heights, shots });
return S.ok({ heights, shots });
