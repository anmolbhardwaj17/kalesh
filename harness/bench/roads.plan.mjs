// Plan of the road bench scene (P0-019; harness/design/ARCH_OPTIONS.md rows LN, HR, J, EL, TF). Run by
// node harness/bench/arch.mjs roads, which harness/bench/roads.mjs starts after it has baked the two sites
// (game/bench/roads/gen/<site>.ktl and <site>.json; check counts in harness/reports/arch/roads_bake.json).
// The scene is game/bench/roads/ (--arch=roads:<site>). Each setup is one site: it loads the stand-in tile, takes
// one shot per camera pose of the site (tops look straight down with north up, eye poses are at driver height),
// and runs the ray probe (the collider against the drawn surface). before() folds the bake's numbers into the
// report, so harness/reports/arch/roads.json holds everything P0-020 needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = path.join(ROOT, 'game', 'bench', 'roads', 'gen');
const BAKE = path.join(ROOT, 'harness', 'reports', 'arch', 'roads_bake.json');
const HERO = path.join(ROOT, 'harness', 'data', 'hero_roads');
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

const base = { gpu: false, driver: 'metal', paths: [], shot: false, project: { physics: { '3d/physics_engine': 'Jolt Physics' } }, resolution: '1600x1000' };
const setups = [
  { ...base, id: 'ito', option: 'LN1 EL1 J3 TF2', group: 'site', tokens: 'ito', note: 'the ITO flyover with its service lanes, the junction under it and the loop ramps' },
  { ...base, id: 'cp', option: 'HR1 J3 TF2', group: 'site', tokens: 'cp', note: 'the Connaught Place inner circle (hero road spec) with its radials' },
];

/** A reference photo of a hero spec for the side by side sheet. Reference only: it stays in harness/reports. */
async function referencePhoto(spec, refId, file) {
  const ref = spec?.refs?.[refId];
  const m = ref && /\/wiki\/(File:.+)$/.exec(ref.url);
  if (!m) return null;
  try {
    const api = new URL('https://commons.wikimedia.org/w/api.php');
    api.search = new URLSearchParams({ action: 'query', format: 'json', titles: decodeURIComponent(m[1]), prop: 'imageinfo', iiprop: 'url', iiurlwidth: '960' }).toString();
    const headers = { 'User-Agent': 'map-bake-fetch/1.0' };
    const info = await (await fetch(api, { headers, signal: AbortSignal.timeout(30000) })).json();
    const page = Object.values(info.query.pages)[0];
    const res = await fetch(page.imageinfo[0].thumburl, { headers, signal: AbortSignal.timeout(60000) });
    if (!res.ok) return null;
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return { file, ref };
  } catch {
    return null;
  }
}

const extra = {};
for (const s of setups) {
  extra[s.id] = async (ctx, game, row) => {
    const meta = readJson(path.join(GEN, `${s.id}.json`));
    if (!meta) throw new Error(`no baked site ${s.id}: run node harness/bench/roads.mjs (it bakes, then starts this bench)`);
    const info = await game.client.call('bench', 'info');
    if (info.error) throw new Error(info.error);
    row.scene = info;
    row.shots = [];
    for (const pose of meta.poses) {
      const r = await game.client.call('bench', 'pose', { name: pose.name });
      if (r.error) throw new Error(r.error);
      await game.client.call('frames', 10);
      const file = path.join(ctx.shotDir, `${s.id}_${pose.name}.png`);
      await game.client.call('shot', file);
      row.shots.push({ pose: pose.name, kind: pose.kind, file: path.relative(ROOT, file), note: pose.note });
      if (pose.portrait) {
        // the reference photo is upright: keep the middle of the frame at 3 to 4
        const m = await sharp(file).metadata();
        const w = Math.round((m.height * 3) / 4);
        const crop = path.join(ctx.shotDir, `${s.id}_${pose.name}_portrait.png`);
        await sharp(file).extract({ left: Math.round((m.width - w) / 2), top: 0, width: w, height: m.height }).toFile(crop);
        const spec = readJson(path.join(HERO, 'cp_inner_circle.json'));
        const photo = await referencePhoto(spec, 'cp_empty_road_2020', path.join(ctx.shotDir, 'reference_cp_empty_road_2020.jpg'));
        if (photo) {
          const h = 1000;
          const left = await sharp(photo.file).resize({ height: h }).toBuffer({ resolveWithObject: true });
          const right = await sharp(crop).resize({ height: h }).toBuffer({ resolveWithObject: true });
          const sheet = path.join(ctx.shotDir, 'hero_cp_pose_sheet.jpg');
          await sharp({ create: { width: left.info.width + right.info.width + 12, height: h, channels: 3, background: '#111' } })
            .composite([{ input: left.data, left: 0, top: 0 }, { input: right.data, left: left.info.width + 12, top: 0 }]).jpeg({ quality: 85 }).toFile(sheet);
          row.heroPose = { pose: pose.name, sheet: path.relative(ROOT, sheet), reference: photo.ref.url, licence: photo.ref.licence, author: photo.ref.author, note: 'left: the reference photo (reference only, not in the repo); right: the bench scene from the matched pose' };
        } else row.heroPose = { pose: pose.name, sheet: null, note: 'the reference photo could not be fetched: no side by side sheet' };
      }
    }
    row.probe = await game.client.call('bench', 'probe');
    row.line = `${s.id}: ${info.triangles} triangles, ${info.colliderChunks} collider chunks (attach ${info.attachTotalMs} ms, worst chunk ${info.attachWorstChunkMs} ms), ${row.shots.length} shots, ray probe ${row.probe.hits}/${row.probe.points} hits, max error ${row.probe.maxErrorM} m`;
  };
}

export default {
  name: 'roads',
  scene: 'game/bench/roads/',
  defaults: { resolution: '1600x1000', windowMs: 1000, warmMs: 500 },
  howMeasured: 'The lane model prototype (tools/bake/roads/, TypeScript, run by node harness/bench/roads.mjs) bakes each site three times in one Node process; buildMs.best is the faster of the last two runs and covers graph, lane sections, split zones, junctions, heights, meshes, both terrains and every check. Check counts are read from the finished model and mesh, not from the builder: overlap is the area that pairs of road triangles share at one level, continuity compares the border points of every lane at every joint, the TF2 gap is the height difference on the edges that road and ground share, the TF1 gap samples a 2 m grid beside every road edge. The Godot run loads the baked T1 tile on Jolt, attaches one collider chunk per frame, takes one shot per pose and sends a ray down at the probe points.',
  setups,
  extra,
  before: async (ctx, report) => {
    const bake = readJson(BAKE);
    if (!bake) throw new Error('harness/reports/arch/roads_bake.json is missing: run node harness/bench/roads.mjs');
    report.bake = { at: bake.at, node: bake.node, writtenBy: bake.writtenBy };
    report.sites = bake.sites;
    report.checks = Object.fromEntries(Object.entries(bake.sites).map(([id, s]) => [id, { ...s.checks, buildMs: s.buildMs.best, triangles: s.stats.triangles, tf2Triangles: s.stats.tf2Triangles, tf1Triangles: s.stats.tf1Triangles }]));
  },
  notMeasured: [
    { id: 'india_gate', option: 'HR1 (if time)', reason: 'the India Gate hexagon with two avenues was not built: the time box went to the two must sites', estimate: 'same builder as the CP ring; it needs its own spec and reference photos' },
    { id: 'lane_shader', option: 'LN1 (if time)', reason: 'lane markings are thin strips of geometry here, not drawn in the road shader from lane UVs; the T1 tile has no UV channel yet', estimate: 'saves the marking triangles (28 percent of the ITO tile)' },
    { id: 'j2_union', option: 'J2', reason: 'the polygon union library (Clipper2) could not be added in this run (the dependency install was denied). The zero overlap proof is done on the mesh instead (every pair of road triangles clipped against each other), and the fallback is a plain polygon of chords', estimate: 'a union would also give the fallback its exact outline' },
    { id: 'tf1_drawn', option: 'TF1', reason: 'the TF1 grid is built and measured in the bake but not drawn in the scene', estimate: 'none needed: the gap numbers decide' },
  ],
};
