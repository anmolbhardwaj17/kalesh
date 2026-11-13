#!/usr/bin/env node
// Road width continuity report (P1-046): every width step of a lane model before a change and what closed it after.
// Reads two lane model files (the bake writes data/pilot_centre/lanes.json), counts their width steps with the bake's
// own check (tools/bake/roads/widthsteps.ts), names for every step of the first file what the second one did there (a
// taper on one road at the junction, a road settled whole, the corridor step of the lane counts, or the widths now
// match), and draws north-up lane pictures of named sites from both files side by side.
//
//   node tools/bake/report/widthreport.mjs --before <old lanes.json> [--after data/pilot_centre/lanes.json]
//       [--layer-before <old harness/reports/map/lanes.json>] [--out harness/reports/map] [--prefix p1-046]
//
// Writes <out>/<prefix>_width_steps.json and, per site, <out>/<prefix>_<site>_before.png and _after.png, and one
// sheet <out>/<prefix>_width_sheet.jpg. Block metres (x east, z south), as the model files.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { lanesSvg } from '../roads/lanerender.ts';
import { checkWidthSteps, pairedOf, ringOf } from '../roads/widthsteps.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Sites drawn before and after (block metres): the owner's report first. */
export const SITES = [
  { id: 'kartavya_hexagon', name: 'Kartavya Path at the India Gate hexagon (the owner, 2026-11-13)', x: -190, z: -10, half: 300 },
  { id: 'janpath_tolstoy', name: 'Janpath, Tolstoy Marg and Kasturba Gandhi Marg south of CP', x: -800, z: -1560, half: 260 },
  { id: 'paharganj_galis', name: 'Paharganj: Chitragupta Road and the lanes off it', x: -2020, z: -3080, half: 200 },
];

/** A lane model file as the objects the checks and the renderer read. */
export function fromFile(file, source) {
  const strips = file.strips.map((s) => ({ ...s, ways: [], st: s.st.map((p) => ({ x: p[0], z: p[1], nx: p[2], nz: p[3], s: p[4], layer: p[5], bridge: p[6] === 1, h: 0, g: 0, structure: 0, edgeRaise: 0, b: p.slice(7) })) }));
  return { strips, joints: file.joints, junctions: file.junctions, zones: file.zones, zoneStrips: file.zones.map((z) => z.strip), ends: file.ends, internal: file.internal ?? [], road: { source }, widthFixes: file.widthFixes ?? { tapers: [], whole: [], rounds: 0, left: 0 } };
}

/** What the second model did at the place of a step of the first one. */
export function fixedBy(step, after, layer) {
  const edges = [...new Set([...step.a, ...step.b].map((id) => id.replace(/_\d+$/, '')))];
  const tapers = after.widthFixes.tapers.filter((t) => edges.includes(t.edge));
  if (tapers.length) return tapers.map((t) => `taper: ${t.edge} meets ${t.lanes} lanes of ${Math.round(t.laneWidth * 100) / 100} m at its ${t.atStart ? 'start' : 'end'} and tapers to its own section${t.short ? ' over the length it has (shorter than its class asks, explained)' : ''}`).join('; ');
  const whole = after.widthFixes.whole.filter((w) => edges.includes(w.edge));
  if (whole.length) return whole.map((w) => `whole: ${w.edge} takes ${w.lanes} lanes of ${Math.round(w.laneWidth * 100) / 100} m (too short for a taper either side)`).join('; ');
  const from = new Map((layer?.strips ?? []).map((s) => [s.edge, s.from]));
  const corridor = edges.filter((e) => from.get(e) === 'corridor');
  if (corridor.length) return `corridor: ${corridor.join(', ')} take the lane count of the road they run on into`;
  const gone = edges.filter((e) => !after.strips.some((s) => s.edge === e));
  if (gone.length === edges.length) return 'the roads became part of a junction (no strip of their own)';
  return 'the widths now match (lane counts along the corridor, class taper lengths)';
}

async function main() {
  const beforeFile = arg('--before');
  if (!beforeFile) throw new Error('widthreport needs --before <lane model file of the earlier bake>');
  const afterFile = path.resolve(ROOT, arg('--after', 'data/pilot_centre/lanes.json'));
  const out = path.resolve(ROOT, arg('--out', 'harness/reports/map'));
  const prefix = arg('--prefix', 'p1-046');
  const graph = readJson(path.join(ROOT, 'data/pilot_centre/graph_repaired.json'));
  const paired = pairedOf(graph.edges);
  const ring = ringOf(graph.edges);
  const before = fromFile(readJson(path.resolve(ROOT, beforeFile)), graph.edges);
  const after = fromFile(readJson(afterFile), graph.edges);
  const layer = fs.existsSync(path.join(ROOT, 'harness/reports/map/lanes.json')) ? readJson(path.join(ROOT, 'harness/reports/map/lanes.json')) : null;
  const wb = checkWidthSteps(before.strips, before.joints, before.junctions, paired, ring);
  const wa = checkWidthSteps(after.strips, after.joints, after.junctions, paired, ring);
  const list = wb.list.map((s) => ({ ...s, fixedBy: fixedBy(s, after, layer) }));
  const tally = {};
  for (const s of list) {
    const k = s.fixedBy.split(':')[0].replace(/^the .*/, s.fixedBy);
    tally[k] = (tally[k] ?? 0) + 1;
  }
  const report = {
    _doc: 'Width steps (P1-046, tools/bake/roads/widthsteps.ts: a carriageway change of more than 1 m within 5 m along a corridor, not inside a taper) of the lane model before the change and after it, each former step with what closed it. Block metres (x east, z south). Written by tools/bake/report/widthreport.mjs.',
    before: { file: path.relative(ROOT, path.resolve(ROOT, beforeFile)), steps: wb.steps, byKind: wb.byKind, corridors: wb.corridors },
    after: { file: path.relative(ROOT, afterFile), steps: wa.steps, byKind: wa.byKind, corridors: wa.corridors, tapers: after.widthFixes.tapers.length, shortTapers: after.widthFixes.tapers.filter((t) => t.short).length, whole: after.widthFixes.whole.length },
    fixedBy: tally,
    left: wa.list,
    steps: list,
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${prefix}_width_steps.json`), JSON.stringify(report, null, 1) + '\n');
  console.log(`width steps: ${wb.steps} before, ${wa.steps} after; fixed by ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const panels = [];
  for (const site of SITES) {
    const box = { minX: site.x - site.half, maxX: site.x + site.half, minZ: site.z - site.half, maxZ: site.z + site.half };
    const inBox = (s) => s.x >= box.minX && s.x <= box.maxX && s.z >= box.minZ && s.z <= box.maxZ;
    const nb = wb.list.filter(inBox).length;
    const na = wa.list.filter(inBox).length;
    const row = [];
    for (const [tag, m, n] of [['before', before, nb], ['after', after, na]]) {
      const svg = lanesSvg(m, box, `${site.name}: ${tag}, ${n} width steps`);
      const file = path.join(out, `${prefix}_${site.id}_${tag}.png`);
      await sharp(Buffer.from(svg), { limitInputPixels: false }).resize(1200).png().toFile(file);
      row.push(file);
    }
    panels.push(row);
    console.log(`  ${site.id}: ${nb} steps before, ${na} after: ${row.map((f) => path.relative(ROOT, f)).join(', ')}`);
  }
  const W = 800;
  const tiles = [];
  for (const [i, row] of panels.entries()) for (const [k, f] of row.entries()) tiles.push({ input: await sharp(f).resize(W).png().toBuffer(), left: k * (W + 10), top: i * (W + 10) });
  const sheet = path.join(out, `${prefix}_width_sheet.jpg`);
  await sharp({ create: { width: 2 * W + 10, height: panels.length * (W + 10) - 10, channels: 3, background: '#1f2328' } }).composite(tiles).jpeg({ quality: 82 }).toFile(sheet);
  console.log(`  sheet ${path.relative(ROOT, sheet)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
