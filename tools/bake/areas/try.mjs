// Runs the area generator alone on a dump of its map input (P2-009), in seconds: for tuning a profile, a blueprint or
// a generator rule without a whole bake.
//   KALESH_AREAS_DUMP=<file> npm run bake -- pilot --stage terrain --offline     (once: writes the dump)
//   node tools/bake/areas/try.mjs <file> [--pictures <folder>]
// The ground is flat here (the bake stands the shells on the solved ground); the area data, the blueprints and the
// keep list are read from the repo as they are now. Prints the same lines and checks as the bake.
import fs from 'node:fs';
import path from 'node:path';
const { geoToWorld } = await import('../../geo/projection.ts');
const { planParcels, generateCity, blendTransects, PLACEMENT_BUDGET_BYTES } = await import('./generator.ts');
const { areaInvariants } = await import('./checks.ts');
const { readAreaFiles } = await import('../sources/areastage.ts');
const { citySvg, transectSvg } = await import('./render.ts');
const { buildIndex } = await import('./profiles.ts');

const file = process.argv[2];
if (!file) {
  console.log('usage: node tools/bake/areas/try.mjs <dump file> [--pictures <folder>]');
  process.exit(2);
}
const pics = process.argv.includes('--pictures') ? process.argv[process.argv.indexOf('--pictures') + 1] : null;
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const read = readAreaFiles(process.cwd());
const project = (lon, lat) => {
  const w = geoToWorld(lat, lon, dump.origin);
  return { x: w.x, z: w.z };
};
let t = performance.now();
const plan = planParcels({ walkLines: [], waterLines: [], ...dump, data: read.data, project, blueprints: read.blueprints, keep: read.keep });
const tParcels = Math.round(performance.now() - t);
t = performance.now();
const city = generateCity(plan, () => 215, () => 215);
const tCity = Math.round(performance.now() - t);
const transects = blendTransects(plan, read.transects.map((x) => ({ id: x.id, name: x.name, area: x.area, a: project(x.from[0], x.from[1]), b: project(x.to[0], x.to[1]) })));
const s = city.stats;
const rec = {
  stage: 'try', parcels: plan.counts, odd: plan.odd.counts, infill: plan.infill.stats, blueprints: { files: read.blueprintFiles, blocks: plan.blueprint.blocks, replaced: plan.blueprint.replaced }, city: s,
  transects: transects.map((x) => ({ id: x.id, name: x.name, area: x.area, samples: x.samples.length, maxStep: Math.round(x.maxStep * 1000) / 1000, maxRise: Math.round(x.maxRise * 1000) / 1000, from: x.from, to: x.to })),
  offRoad: { count: 0, areaM2: 0 }, placementBudgetBytes: PLACEMENT_BUDGET_BYTES, files: {}, ms: { parcels: tParcels, city: tCity, parts: {} },
};
console.log(`parcels ${JSON.stringify(plan.counts)} in ${tParcels} ms ${JSON.stringify(plan.ms)}`);
console.log(`odd ${JSON.stringify(plan.odd.counts)}`);
console.log(`infill ${JSON.stringify(plan.infill.stats)}`);
console.log(`city in ${tCity} ms ${JSON.stringify(s.ms)}: ${s.shells} shells, ${s.triangles} triangles, from ${JSON.stringify(s.byFrom)}, roofs ${JSON.stringify(s.byRoof)}, kinds ${JSON.stringify(s.byProfileKind)}`);
console.log(`tags: ${s.tagged}, largest difference ${s.tagMaxFloorDiff} floors, ${s.tagOverOne} over 1`);
for (const p of s.profiles) console.log(`  ${p.key.padEnd(34)} ${String(p.shells).padStart(5)} shells  p10/50/90 ${p.p10}/${p.p50}/${p.p90}  classes ${p.classes.drawn.join(' ')} vs ${p.classes.profile.join(' ')} diff ${p.classDiff} (bins ${p.distanceAll}) on ${p.drawn}, ${p.capped} capped  top ${p.topType} ${p.topShare} (mix ${p.mixTop}) ${p.entropyBits} bits`);
console.log(`variety ${JSON.stringify(s.variety)}`);
console.log(`placements ${JSON.stringify({ ...s.placements, overBudget: s.placements.overBudget.length })}`);
for (const x of transects) console.log(`transect ${x.id}: ${x.samples.length} samples, max step ${x.maxStep.toFixed(3)}, own weight ${x.from.toFixed(2)} to ${x.to.toFixed(2)}, max rise ${x.maxRise.toFixed(3)}`);
for (const i of areaInvariants(rec)) console.log(`${i.ok ? 'ok  ' : 'FAIL'} ${i.id}: ${i.detail}`);
if (pics) {
  fs.mkdirSync(pics, { recursive: true });
  const index = buildIndex(read.data, project);
  const map = {
    roads: dump.edges.map((e) => ({ pts: e.pts, width: e.width })), parcels: plan.footprints, plans: city.plans, regularised: new Set(plan.odd.lines.filter((l) => l.action === 'regularised').map((l) => l.id)),
    areas: index.areas.map((a) => ({ id: a.id, rings: a.rings })), zones: dump.zones, transects,
  };
  const sharp = (await import('sharp')).default;
  const { AREA_VIEWS } = await import('../sources/areastage.ts');
  for (const v of AREA_VIEWS) {
    const a = index.areas.find((x) => x.id === v.area);
    const cx = (a.box[0] + a.box[1]) / 2;
    const cz = (a.box[2] + a.box[3]) / 2;
    const svg = citySvg(map, { minX: cx - v.halfM, maxX: cx + v.halfM, minZ: cz - v.halfM, maxZ: cz + v.halfM }, v.name);
    await sharp(Buffer.from(svg), { limitInputPixels: false }).resize(1600).png().toFile(path.join(pics, `try_${v.id}.png`));
  }
  if (transects.length) await sharp(Buffer.from(transectSvg(transects, 'Edge blending')), { limitInputPixels: false }).resize(1600).png().toFile(path.join(pics, 'try_blend.png'));
  console.log(`pictures in ${pics}`);
}
