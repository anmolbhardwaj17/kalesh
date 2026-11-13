// The landmark registry build (P2-005), on its own, without a whole bake:
//   node tools/bake/landmarks/build.mjs [stage] [--offline] [--check]
// stage      a stage of harness/data/districts.json "stages" (default: pilot)
// --offline  never touch the network: the Wikidata cache and the OSM tags only
// --check    build twice and compare with the files on disk; write nothing (exit 1 when they differ)
// Reads the stage's pinned OSM and Wikidata files (data/<stage>/, gitignored), harness/data/landmark_list.json (the
// owner list), harness/data/landmarks.overrides.json (edits), the areas and the underground list. Writes
// harness/data/landmarks/<id>.json (heroes and signatures), harness/data/landmarks_markers.json, and under
// harness/reports/map/landmarks/ the registry's issues.json, registry.json (counts, rejects, the output hash) and a
// north-up picture landmarks_<stage>.png.
// An .mjs script: the files and the network are in tools/bake/sources/landmarksio.ts, the pure build in registry.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { readRegistryInput, writeRegistry } = await import('../sources/landmarksio.ts');
const { writePicture } = await import('../sources/graphinput.ts');
const { registrySvg } = await import('./render.ts');
const { buildRegistry } = await import('./registry.ts');
const { realNet } = await import('../sources/net.ts');

const args = process.argv.slice(2);
const stage = args.find((a) => !a.startsWith('--')) ?? 'pilot';
const offline = args.includes('--offline');
const check = args.includes('--check');
const log = (l) => console.log(`[landmarks] ${l}`);

const t0 = Date.now();
const read = await readRegistryInput({ root: ROOT, stage, net: offline || check ? null : realNet(), today: new Date().toISOString().slice(0, 10), log });
const first = buildRegistry(read.input);
const second = buildRegistry(read.input);
const s = first.stats;
log(`stage ${stage}: ${s.candidates} candidates (hero ${s.perTier.hero}, signature ${s.perTier.signature}, marker ${s.perTier.marker}); OSM ${s.perSource.osm}, Wikidata ${s.perSource.wikidata}, ASI ${s.perSource.asi}`);
log(`joins: wikidata tag ${s.perMatch.wikidata_tag}, owner list ids ${s.perMatch.owner_list}, name fallback ${s.perMatch.name_distance} (all flagged), one source ${s.perMatch.none}`);
log(`issues: ${Object.entries(s.issues).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; held ${s.held}, unplaced ${s.unplaced}, far ${s.far}, worship ${s.worship}, underground ${s.underground}`);
log(`rejected ${s.rejected}, outside the stage outline ${s.outsideStage}, heights to read by hand ${s.heightsMissing.length}, stale edits ${s.staleEdits.length}`);
log(`wikidata: ${read.wikidata.boxItems} items of the box query, ${read.wikidata.cached} from the cache, ${read.wikidata.fetched} fetched now${read.wikidata.notFetched.length ? `, ${read.wikidata.notFetched.length} NOT fetched (${read.wikidata.error})` : ''}`);
log(`hash ${first.hash} (second build ${second.hash}: ${first.hash === second.hash ? 'same' : 'DIFFERENT'})`);
for (const p of first.problems) log(`PROBLEM ${p}`);
if (first.hash !== second.hash) process.exitCode = 1;
if (first.problems.length) process.exitCode = 1;

if (check) {
  const diff = Object.keys(first.files).filter((f) => !fs.existsSync(path.join(ROOT, f)) || fs.readFileSync(path.join(ROOT, f), 'utf8') !== first.files[f]);
  log(diff.length ? `--check: ${diff.length} files differ from the build (${diff.slice(0, 5).join(', ')})` : '--check: the files on disk are the build');
  if (diff.length) process.exitCode = 1;
} else {
  const w = writeRegistry(ROOT, first, { stage, osm_base: read.input.osmBase, wikidata: read.wikidata, osm_skipped: read.osmSkipped, ms: Date.now() - t0 });
  log(`wrote ${w.written.length} files, removed ${w.removed.length}, unchanged ${w.unchanged}; ${w.issuesFile}, ${w.reportFile}`);
  const pictures = await writePicture(ROOT, `harness/reports/map/landmarks/landmarks_${stage}.png`, registrySvg(read.input, first.entries, `Landmark registry, ${stage} stage, north up (OSM ${read.input.osmBase.slice(0, 10)})`), 2400);
  log(`picture ${pictures.join(', ')}`);
}
