// P2-007: no pop on the way to India Gate. A frame sequence of a 140 km/h approach along Kartavya Path (one frame every
// 150 ms: 5.83 m apart) through each level change of India Gate (the far silhouette to level 2 at 1,800 m, level 2 to 1
// at 900 m, level 1 to 0 at 350 m). The camera is at the play camera's height (2 m over the road) looking at the arch.
// The level changes are distance based cross-fades (visibility ranges, game/world/systems/landmarks.gd), so frames at
// the positions of the run show what the player sees. Shots pop_ig_<boundary>_<k>; each frame's record (the summary) has the arch's box on
// screen, and harness/bin/popcheck.mjs turns the run into a contact sheet and the frame to frame change inside that box
// (a pop is a change well over its neighbours').
const S = window.__sim;
const D = S.D;
const params = window.__scriptParams || {};
const V = (params.kmh ?? 140) / 3.6;
const STEP_S = 0.15;
const Z = params.z ?? 444.0;
const EYE = 2.0;
await S.until(() => D.state().world && D.state().world.ready, { sim: 30, label: 'the city ring is attached' });
let kit = await D.city('kit');
for (let i = 0; i < 120 && !kit.ready; i++) {
  await S.waitSim(0.5);
  kit = await D.city('kit');
}
if (!kit.ready) return S.failed(`kit landmarks still building: ${kit.building.join(', ')}`);
const ig = kit.landmarks.find((l) => l.id === 'india_gate');
if (!ig) return S.failed('no India Gate in the kit');
const [gx, gy, gz] = ig.pos;
const windows = params.windows || [[1800, 200], [900, 110], [350, 60]];
const frames = [];
for (const [b, half] of windows) {
  // the ring round the camera: stage the player at the start of the window, under the camera's line
  await D.teleport([gx - (b + half), 0, Z + 8]);
  const steps = Math.round((2 * half) / (V * STEP_S));
  for (let k = 0; k <= steps; k++) {
    const d = b + half - k * V * STEP_S;
    const pos = [gx - d, gy + EYE + 1.0, Z];
    await D.setCamera({ pos, target: [gx, gy + 18, gz] });
    await S.frames(2);
    const sc = await D.city('screen', { points: [[gx, gy, gz - 13], [gx, gy, gz + 13], [gx, gy + 42, gz - 13], [gx, gy + 42, gz + 13]] });
    const xs = sc.points.map((p) => p.x);
    const ys = sc.points.map((p) => p.y);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v));
    const name = `pop_ig_${b}_${String(k).padStart(2, '0')}`;
    const lv = (await D.city('kit')).landmarks.find((l) => l.id === 'india_gate').level;
    frames.push({ name, d: Math.round(d * 10) / 10, level: lv, box, size: sc.size });
    await S.shot(name);
  }
}
await D.setCamera(null);
return S.ok({ kmh: params.kmh ?? 140, stepS: STEP_S, count: frames.length, windows, frames });
