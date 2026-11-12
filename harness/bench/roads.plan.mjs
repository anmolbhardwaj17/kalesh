// Plan of the road bench scene (game/bench/roads/, --arch=roads:<site>). Since P1-014 the scene shows the
// production road mesh: the bake step `mesh` (tools/bake/mesh/, `npm run bake -- pilot --stage mesh --offline`) cuts
// a stand-in tile and camera poses for each site out of the pilot mesh into game/bench/roads/gen/<site>.ktl and
// <site>.json, and writes its gate counts to harness/reports/map/health.json (mesh). Run with
// node harness/bench/arch.mjs roads. Each setup is one site: it loads the tile, takes one shot per pose
// (harness/reports/arch/roads/roads_<site>_<pose>.png; tops look straight down with north up, eye poses are at
// driver height) and runs the ray probe (the collider against the drawn surface). before() folds the bake's numbers
// into harness/reports/arch/roads.json. The Phase 0 prototype bake (harness/bench/roads.mjs) no longer feeds the scene.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = path.join(ROOT, 'game', 'bench', 'roads', 'gen');
const HEALTH = path.join(ROOT, 'harness', 'reports', 'map', 'health.json');
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

const base = { gpu: false, driver: 'metal', paths: [], shot: false, project: { physics: { '3d/physics_engine': 'Jolt Physics' } }, resolution: '1600x1000' };
const setups = [
  { ...base, id: 'ito', option: 'J3 production mesh', group: 'site', tokens: 'ito', note: 'the ITO flyover with its service lanes and the junctions under it' },
  { ...base, id: 'cp', option: 'J3 production mesh', group: 'site', tokens: 'cp', note: 'the Connaught Place inner circle with its radials' },
  { ...base, id: 'india_gate', option: 'J3 production mesh', group: 'site', tokens: 'india_gate', note: 'the India Gate hexagon and its avenues' },
  { ...base, id: 'chandni_chowk', option: 'J3 production mesh', group: 'site', tokens: 'chandni_chowk', note: 'Chandni Chowk and the old city lanes beside it' },
];

const extra = {};
for (const s of setups) {
  extra[s.id] = async (ctx, game, row) => {
    const meta = readJson(path.join(GEN, `${s.id}.json`));
    if (!meta) throw new Error(`no baked site ${s.id}: run npm run bake -- pilot --stage mesh --offline`);
    const info = await game.client.call('bench', 'info');
    if (info.error) throw new Error(info.error);
    row.scene = info;
    row.shots = [];
    for (const pose of meta.poses) {
      const r = await game.client.call('bench', 'pose', { name: pose.name });
      if (r.error) throw new Error(r.error);
      await game.client.call('frames', 10);
      const file = path.join(ctx.shotDir, `roads_${s.id}_${pose.name}.png`);
      await game.client.call('shot', file);
      row.shots.push({ pose: pose.name, kind: pose.kind, file: path.relative(ROOT, file), note: pose.note });
    }
    row.probe = await game.client.call('bench', 'probe');
    row.line = `${s.id}: ${info.triangles} triangles, ${info.colliderChunks} collider chunks (attach ${info.attachTotalMs} ms, worst chunk ${info.attachWorstChunkMs} ms), ${row.shots.length} shots, ray probe ${row.probe.hits}/${row.probe.points} hits, max error ${row.probe.maxErrorM} m`;
  };
}

export default {
  name: 'roads',
  scene: 'game/bench/roads/',
  defaults: { resolution: '1600x1000', windowMs: 1000, warmMs: 500 },
  howMeasured: 'The production road mesh (tools/bake/mesh/, the bake step mesh) is built once for the whole pilot centre; each site tile is the part of it inside the site box, plus lane lines as strips and a stand-in ground sheet. The gate counts are in harness/reports/map/health.json (mesh). The scene loads the tile, takes the shots and casts a ray down at every probe point against the collider.',
  setups,
  extra,
  before: async (ctx, report) => {
    const health = readJson(HEALTH);
    if (!health?.mesh) throw new Error('harness/reports/map/health.json has no mesh record: run npm run bake -- pilot --stage mesh --offline');
    report.mesh = { hash: health.mesh.hash, buildMs: health.mesh.buildMs, counts: health.mesh.counts, gates: health.mesh.gates, files: health.mesh.files };
  },
  notMeasured: [
    { id: 'lane_shader', option: 'LN1', reason: 'lane lines are drawn as thin strips in this stand-in scene; the production mesh carries the lane UV and border codes, the T1 tile has no UV channel yet and the road shader is not written', estimate: 'saves the marking triangles' },
    { id: 'terrain', option: 'TF2', reason: 'the ground in the scene is a stand-in sheet under the roads; the ground cut to the road edges is the terrain step', estimate: 'none' },
  ],
};
