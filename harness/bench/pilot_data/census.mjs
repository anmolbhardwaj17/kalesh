#!/usr/bin/env node
// Pilot data census (P0-018, ARCH_OPTIONS.md rows RS, BS, GS, RE, AR, OV, LM, AD). Reads the pinned downloads of
// fetch.mjs and writes, in harness/reports/arch/:
//   pilot_data.json            sources and licences, issue counts per site and rule, tag coverage, BS1 against BS2,
//                              the Overture road check, the AR1 share, the overrides test
//   terrain_sources.json       GS1, GS2 and GS3 at 20 control points, along 20 road profiles and under dense blocks
//   world_sources.json         every landmark and area source with its licence, and what covers the pilot
//   landmarks_pilot_draft.json the landmark candidates by LM1 with tiers and OSM to Wikidata distances
//   pilot_data/*.png           north-up debug renders of the issues
//
//   node harness/bench/pilot_data/census.mjs                         the census
//   node harness/bench/pilot_data/census.mjs --write-sample-overrides  also (re)write the sample OV1 patches
//
// All map logic is typed code in tools/bake/ (rules, buildings, ground, overrides, landmarks); this driver only
// loads files, calls it and writes the reports. Nothing here needs Godot.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projector } from '../../../tools/geo/projection.ts';
import { Grid, boxOf, pointInRing, pointSegment, resample } from '../../../tools/bake/geom.ts';
import { tagCoverage } from '../../../tools/bake/osm.ts';
import { CATALOGUE, catalogueLines, countByRule, runRules } from '../../../tools/bake/rules/catalogue.ts';
import { autoProposal } from '../../../tools/bake/rules/types.ts';
import { onewayPairStats } from '../../../tools/bake/rules/roads.ts';
import { bridgeChains } from '../../../tools/bake/rules/bridges.ts';
import { checkProfile, PROFILE_STEP } from '../../../tools/bake/rules/terrain.ts';
import { coveredShare, footprintStats, mergeFootprints, osmTagLoss } from '../../../tools/bake/buildings.ts';
import { diffStats, fitGround, profileStats } from '../../../tools/bake/ground.ts';
import { applyPatches, markOverridden, overrideTile, staleReport } from '../../../tools/bake/overrides.ts';
import { buildingOnRoad } from '../../../tools/bake/rules/buildings.ts';
import { distanceStats, joinLandmarks, osmLandmarks } from '../../../tools/bake/landmarks.ts';
import { LICENCES } from './licences.mjs';
import { PILOT, REPORTS, ROOT, TODAY, inBox, loadSources, pilotAreas, readJson, rel, round, unionBox, writeJson } from './lib.mjs';
import { googleFootprints, loadArea, loadHeights, msFootprints, overtureFootprints, overtureSegments, sampler } from './load.mjs';
import { renderMap } from './render.mjs';

const args = process.argv.slice(2);
const writeSamples = args.includes('--write-sample-overrides');
const t00 = Date.now();
const areas = pilotAreas();
const sources = loadSources();
const checks = readJson(path.join(PILOT, 'licence_checks.json'), { checks: {} }).checks;
const notMeasured = [];
const cpus = os.cpus();
const machine = `${os.hostname().replace(/\.local$/, '')}, ${os.platform()} ${os.arch()}, ${cpus[0]?.model || 'unknown cpu'}, ${cpus.length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`;
const stamp = { at: new Date().toISOString(), machine, node: process.version };
const shotDir = path.join(REPORTS, 'pilot_data');
fs.mkdirSync(shotDir, { recursive: true });

/** One licence row as the reports quote it: the table entry plus what the fetch saw on the licence page. */
function licenceRow(l) {
  const c = checks[l.id] || {};
  return {
    id: l.id, source: l.source, layer: l.layer, use: l.use, licence: l.licence, licenceUrl: l.licenceUrl, licenceText: l.licenceText || null, credit: l.credit,
    freePublicGame: l.free, soldGame: l.sold, conditions: l.conditions, shipped: l.shipped, dateChecked: c.dateChecked || TODAY,
    checked: {
      httpStatus: c.httpStatus ?? null, phraseFound: c.phraseFound ?? null, phrasesFound: c.found || [], quote: c.quote ? c.quote.slice(0, 320) : null, pageSha256: c.sha256 || null, error: c.error || null,
      statementFrom: c.phraseFound ? `the licence page itself (fetched ${c.dateChecked}, phrase found by the script)` : c.httpStatus === 200 ? `the publisher's page was reached (${c.dateChecked}) but the script could not read the licence phrase from it (a PDF, a script-built page, or no licence stated): the statement is the builder's reading and stays a belief` : `the page could not be reached by the script (${c.error || `HTTP ${c.httpStatus}`}): the statement is a belief from the design docs`,
    },
  };
}

// ------------------------------------------------------------------ load

const heights = await loadHeights(unionBox(areas));
const ctxs = [];
for (const area of areas) {
  const ctx = loadArea(area);
  if (!ctx) {
    notMeasured.push({ id: `osm_${area.id}`, reason: 'the OSM extract of this box is not in data/pilot (fetch failed or not run)' });
    continue;
  }
  ctx.overture = overtureFootprints(ctx);
  ctx.google = googleFootprints(ctx);
  ctx.ms = msFootprints(ctx);
  ctx.ground = { gedtm: heights.gedtm && sampler(heights.gedtm, ctx.proj), glo30: heights.glo30 && sampler(heights.glo30, ctx.proj), fabdem: heights.fabdem && sampler(heights.fabdem, ctx.proj) };
  ctxs.push(ctx);
}
const ruleCtx = (ctx, ground = ctx.ground.gedtm, map = ctx.map) => ({ district: ctx.area.id, map, box: ctx.box, toGeo: (x, z) => ctx.proj.toGeo(x, z), ...(ground ? { ground } : {}) });

// ------------------------------------------------------------------ issue census, tag coverage, AR1 share

const sites = {};
const allIssues = {};
for (const ctx of ctxs) {
  const t0 = Date.now();
  const issues = runRules(ruleCtx(ctx));
  const ms = Date.now() - t0;
  allIssues[ctx.area.id] = issues;
  const counts = countByRule(issues);
  const total = issues.length;
  const auto = issues.filter((i) => autoProposal(i) !== null).length;
  const chains = bridgeChains(ctx.map);
  sites[ctx.area.id] = {
    name: ctx.area.name, role: ctx.area.role, osmBase: ctx.osmBase, boxKm2: round(ctx.boxAreaM2 / 1e6, 2), ruleMs: ms,
    issues: total, autoRepair: auto, autoShare: round(auto / Math.max(1, total), 3), queued: total - auto,
    perRule: Object.fromEntries(counts.map((c) => [c.rule, { issues: c.issues, auto: c.auto, queued: c.queued }])),
    highImpactQueued: issues.filter((i) => autoProposal(i) === null && i.impact >= 0.7).length,
    tagCoverage: tagCoverage(ctx.map), footways: ctx.map.footways, undergroundFootprintsLeftOut: ctx.map.underground, onewayPairs: onewayPairStats(ctx.map),
    bridges: { chains: chains.length, metres: Math.round(chains.reduce((s, c) => s + c.length, 0)), withoutLayer: chains.filter((c) => c.layer === 0).length },
    worst: issues.filter((i) => autoProposal(i) === null).sort((a, b) => b.impact - a.impact).slice(0, 5).map((i) => ({ id: i.id, impact: i.impact, note: i.note, lat: i.lat, lon: i.lon })),
  };
  console.log(`${ctx.area.id}: ${total} issues (${auto} auto), ${ms} ms`);
}
const pilotIds = ctxs.filter((c) => c.area.role === 'pilot').map((c) => c.area.id);
const sumRule = (rule, key) => pilotIds.reduce((s, id) => s + sites[id].perRule[rule][key], 0);
const totals = {
  note: 'the four pilot districts (the far district is listed per site only)',
  issues: pilotIds.reduce((s, id) => s + sites[id].issues, 0), autoRepair: pilotIds.reduce((s, id) => s + sites[id].autoRepair, 0),
  perRule: Object.fromEntries(CATALOGUE.map((r) => [r.id, { title: r.title, issues: sumRule(r.id, 'issues'), auto: sumRule(r.id, 'auto'), autoShare: round(sumRule(r.id, 'auto') / Math.max(1, sumRule(r.id, 'issues')), 3) }])),
};
totals.autoShare = round(totals.autoRepair / Math.max(1, totals.issues), 3);
const mapOnly = CATALOGUE.filter((r) => r.area !== 'terrain').map((r) => r.id);
totals.withoutTerrainRule = {
  issues: mapOnly.reduce((s, r) => s + totals.perRule[r].issues, 0), autoRepair: mapOnly.reduce((s, r) => s + totals.perRule[r].auto, 0),
};
totals.withoutTerrainRule.autoShare = round(totals.withoutTerrainRule.autoRepair / Math.max(1, totals.withoutTerrainRule.issues), 3);

// ------------------------------------------------------------------ buildings: BS1 (Overture) against BS2 (own merge)

const OVERTURE_KEYS = [['names', 'name'], ['height', 'height'], ['num_floors', 'building:levels'], ['min_height', 'min_height'], ['roof_shape', 'roof:shape'], ['roof_material', 'roof:material'], ['roof_color', 'roof:colour'], ['roof_height', 'roof:height'], ['facade_material', 'building:material'], ['facade_color', 'building:colour'], ['level', 'layer'], ['num_floors_underground', 'building:levels:underground']];

function osmIdOf(row) {
  const rec = row.sources?.find((s) => s.dataset === 'OpenStreetMap')?.record_id;
  const m = rec && /^([wr])(\d+)/.exec(rec);
  return m ? `${m[1] === 'w' ? 'way' : 'relation'}/${m[2]}` : null;
}

const buildings = { how: 'BS1 is the Overture buildings theme as downloaded. BS2 is our own merge in priority order OSM, Google Open Buildings (confidence 0.7 or more), Microsoft: a later footprint is added only where it covers less than 20 percent of footprints already taken, dropped as the same building from 50 percent, and logged as a conflict in between (tools/bake/buildings.ts). Duplicates left are pairs where the smaller footprint lies 60 percent or more inside the larger. Coverage is the share of the box under any footprint (sample grid, no double count).', sites: {} };
for (const ctx of ctxs) {
  const row = { osm: footprintStats(ctx.map.buildings, ctx.boxAreaM2) };
  row.osm.coveredShare = coveredShare(ctx.map.buildings, ctx.box);
  if (ctx.overture) {
    const bySource = {};
    for (const f of ctx.overture) bySource[f.source.replace('overture:', '')] = (bySource[f.source.replace('overture:', '')] || 0) + 1;
    const byOsmId = new Map();
    for (const f of ctx.overture) {
      const id = osmIdOf(f.row);
      if (id && !byOsmId.has(id)) byOsmId.set(id, f.row);
    }
    const loss = osmTagLoss(ctx.map.buildings, (id) => {
      const r = byOsmId.get(id);
      if (!r) return null;
      const kept = new Set(['building']);
      for (const [field, key] of OVERTURE_KEYS) if (r[field] !== null && r[field] !== undefined) kept.add(key);
      if (r.names?.common) for (const lang of Object.keys(r.names.common)) kept.add(`name:${lang}`);
      return kept;
    });
    const keyRows = Object.entries(loss.keys).map(([key, v]) => ({ key, osm: v.osm, kept: v.kept })).sort((a, b) => b.osm - a.osm);
    const tagsTotal = keyRows.reduce((s, k) => s + k.osm, 0);
    const tagsKept = keyRows.reduce((s, k) => s + k.kept, 0);
    row.bs1 = {
      ...footprintStats(ctx.overture, ctx.boxAreaM2), coveredShare: coveredShare(ctx.overture, ctx.box), bySource,
      osmBuildingsFoundById: loss.foundById, osmBuildings: loss.osmBuildings, osmTagsKeptShare: round(tagsKept / Math.max(1, tagsTotal), 3),
      osmTagsKeptShareWithoutBuildingKey: round((tagsKept - (loss.keys.building?.kept || 0)) / Math.max(1, tagsTotal - (loss.keys.building?.osm || 0)), 3),
      tagKeys: keyRows.slice(0, 14), lostKeys: keyRows.filter((k) => k.kept === 0).slice(0, 12).map((k) => `${k.key} (${k.osm})`),
      withHeightOrLevelsShare: round(ctx.overture.filter((f) => f.height !== null || f.levels !== null).length / Math.max(1, ctx.overture.length), 3),
    };
  }
  if (ctx.google && ctx.ms) {
    const t0 = Date.now();
    const merge = mergeFootprints([ctx.map.buildings, ctx.google, ctx.ms]);
    ctx.bs2 = merge.merged;
    row.bs2 = {
      ...footprintStats(merge.merged, ctx.boxAreaM2), coveredShare: coveredShare(merge.merged, ctx.box), bySource: merge.bySource, mergeMs: Date.now() - t0,
      inputs: { osm: ctx.map.buildings.length, google: ctx.google.length, googleBelowConfidence: ctx.google.belowConfidence, ms: ctx.ms.length },
      osmTagsKeptShare: 1, withHeightOrLevelsShare: round(merge.merged.filter((f) => f.height !== null || f.levels !== null).length / Math.max(1, merge.merged.length), 3),
    };
  }
  // what each set costs the repair layer: footprints that reach into a carriageway (rule R-BLDG-01 on that set)
  for (const [key, set] of [['osm', ctx.map.buildings], ['bs1', ctx.overture], ['bs2', ctx.bs2]]) {
    if (!set || !row[key]) continue;
    const found = buildingOnRoad.detect(ruleCtx(ctx, null, { ...ctx.map, buildings: set.map((f) => ({ ...f, tags: f.tags || {} })) }));
    row[key].roadOverlaps = { issues: found.length, auto: found.filter((i) => autoProposal(i) !== null).length, centreLineThroughFootprint: found.filter((i) => i.note.startsWith('the road centre line')).length };
  }
  row.bs3 = { note: 'OSM footprints only: the osm row above', coveredShare: row.osm.coveredShare, count: row.osm.count };
  buildings.sites[ctx.area.id] = row;
}
if (!ctxs.some((c) => c.overture)) notMeasured.push({ id: 'bs1_overture', reason: 'the Overture buildings download is missing (see data/SOURCES.json unreachable)' });
if (!ctxs.some((c) => c.bs2)) notMeasured.push({ id: 'bs2_merge', reason: 'the Google or Microsoft footprints are missing (see data/SOURCES.json unreachable)' });
{
  const cc = buildings.sites.chandni_chowk;
  if (cc?.bs1 && cc?.bs2) {
    buildings.chandniChowk = {
      coveredShare: { bs1: cc.bs1.coveredShare, bs2: cc.bs2.coveredShare, bs3: cc.osm.coveredShare }, count: { bs1: cc.bs1.count, bs2: cc.bs2.count, bs3: cc.osm.count },
      duplicatePairsLeft: { bs1: cc.bs1.duplicatePairs, bs2: cc.bs2.duplicatePairs }, medianAreaM2: { bs1: cc.bs1.medianAreaM2, bs2: cc.bs2.medianAreaM2 },
      roadOverlaps: { bs1: cc.bs1.roadOverlaps?.issues, bs2: cc.bs2.roadOverlaps?.issues, bs3: cc.osm.roadOverlaps?.issues },
    };
  }
}

// ------------------------------------------------------------------ roads: what Overture adds over OSM (RS1, RS2)

const CARRIAGE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian']);
const roadsCheck = { how: 'Overture transportation segments (subtype road) that touch each box, against the OSM carriageways of the same box. A segment counts as OSM-only when every entry of its sources names OpenStreetMap.', sites: {} };
for (const ctx of ctxs) {
  const segs = overtureSegments(ctx);
  if (!segs) continue;
  const car = segs.filter((s) => CARRIAGE.has(s.cls));
  const share = (f) => round(car.filter(f).length / Math.max(1, car.length), 3);
  roadsCheck.sites[ctx.area.id] = {
    overtureSegments: segs.length, overtureCarriagewaySegments: car.length, overtureCarriagewayKm: round(car.reduce((s, x) => s + x.km, 0), 2),
    osmCarriagewayWays: ctx.map.roads.length, osmCarriagewayKm: sites[ctx.area.id].tagCoverage.roadKm,
    segmentsOsmOnly: car.filter((s) => s.datasets.every((d) => d === 'OpenStreetMap')).length, segmentsWithOtherSource: car.filter((s) => s.datasets.some((d) => d !== 'OpenStreetMap')).length,
    otherSources: [...new Set(car.flatMap((s) => s.datasets).filter((d) => d !== 'OpenStreetMap'))],
    otherSourceProperties: [...new Set(car.flatMap((s) => (s.row.sources || []).filter((x) => x.dataset !== 'OpenStreetMap').map((x) => x.property)))].slice(0, 8),
    withSpeedLimit: share((s) => s.row.speed_limits), withWidthRule: share((s) => s.row.width_rules), withLevelRule: share((s) => s.row.level_rules), withSurface: share((s) => s.row.road_surface),
    classUnknown: segs.filter((s) => s.cls === 'unknown').length,
  };
}
if (!Object.keys(roadsCheck.sites).length) notMeasured.push({ id: 'rs_overture_roads', reason: 'the Overture transportation download is missing' });

// ------------------------------------------------------------------ overrides (OV1)

const overridesDir = path.join(ROOT, 'harness', 'data', 'overrides');
function samplePatches() {
  // two real issues of the census as patches, plus one patch whose target does not exist (the stale case)
  const made = [];
  const pick = (district, test) => {
    const i = (allIssues[district] || []).find(test);
    return i ? { district, i } : null;
  };
  const a = pick('chandni_chowk', (i) => i.rule === 'R-BRIDGE-01') || pick('ito', (i) => i.rule === 'R-BRIDGE-01') || pick('ito', (i) => i.rule === 'R-BLDG-01' && autoProposal(i));
  const b = pick('cp', (i) => i.rule === 'R-BLDG-03') || pick('cp', (i) => i.rule === 'R-BLDG-01' && autoProposal(i));
  for (const [n, hit] of [a, b].entries()) {
    if (!hit) continue;
    const { district, i } = hit;
    const p = autoProposal(i) || i.proposals[0];
    const ids = i.features.filter((f) => !f.startsWith('node/'));
    const ctx = ctxs.find((c) => c.area.id === district);
    const kinds = ids.map((id) => (ctx.map.roads.some((r) => r.id === id) ? 'road' : 'building')).join(',');
    made.push({
      district, patch: {
        id: `ov_${district}_${String(n + 1).padStart(4, '0')}`, issue: i.id, action: p.action, target: { ids, anchor: { lat: i.lat, lon: i.lon }, tolerance_m: 15 },
        params: { ...p.params, kinds }, why: `Sample patch of the data bench: ${p.reasoning}`, by: 'builder', source: 'bench', date: TODAY,
      },
    });
  }
  const cp = ctxs.find((c) => c.area.id === 'cp');
  if (cp) {
    made.push({
      district: 'cp', patch: {
        id: 'ov_cp_stale_sample', issue: 'R-ROAD-01:way/1:way/2:node/3', action: 'connect', target: { ids: ['way/1', 'way/2'], anchor: { lat: cp.area.bbox.south + 0.0002, lon: cp.area.bbox.west + 0.0002 }, tolerance_m: 1 },
        params: { to: 'way/2', kinds: 'road,road' }, why: 'Sample of a stale patch: its ways are not in the extract and nothing lies within 1 m of the anchor. It must be reported, never dropped.', by: 'builder', source: 'bench', date: TODAY,
      },
    });
  }
  return made;
}

if (writeSamples) {
  const byFile = new Map();
  for (const { district, patch } of samplePatches()) {
    const ctx = ctxs.find((c) => c.area.id === district);
    const tile = overrideTile(ctx.proj.toWorld(patch.target.anchor.lat, patch.target.anchor.lon));
    const file = path.join(overridesDir, district, tile.file);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(patch);
  }
  fs.rmSync(overridesDir, { recursive: true, force: true });
  for (const [file, patches] of byFile) writeJson(file, patches);
  console.log(`wrote ${byFile.size} override files under ${rel(overridesDir)}`);
}

const overrides = { how: 'Sample OV1 patches in harness/data/overrides/<district>/<tileX>_<tileZ>.json (250 m tiles of the district frame, filed under the tile of the anchor). Run 1 applies them to the extract as fetched: targets are found by id. Run 2 is the same extract with every way id changed (a stand-in for a new extract where ways were redrawn): targets must be found again by the anchor. After each run the rules run again: a patch that changes the map (set_tag, remove) makes its issue go away (gone); a patch that only decides (terminate, connect) leaves the issue found and marks it overridden, so it is not raised again.', files: [], run1: [], run2: [], stale: [] };
if (fs.existsSync(overridesDir)) {
  for (const district of fs.readdirSync(overridesDir).sort()) {
    const dir = path.join(overridesDir, district);
    if (!fs.statSync(dir).isDirectory()) continue;
    const ctx0 = ctxs.find((c) => c.area.id === district);
    if (!ctx0) continue;
    const patches = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const list = readJson(path.join(dir, f));
      overrides.files.push({ file: rel(path.join(dir, f)), patches: list.length });
      patches.push(...list);
    }
    const project = (lat, lon) => ctx0.proj.toWorld(lat, lon);
    const run = (shift) => {
      const ctx = loadArea(ctx0.area);
      if (shift) {
        for (const r of ctx.map.roads) r.id = `way/${Number(r.id.slice(4)) + shift}`;
        for (const b of ctx.map.buildings) if (b.id.startsWith('way/')) b.id = `way/${Number(b.id.slice(4)) + shift}`;
      }
      const results = applyPatches(ctx.map, patches, project);
      const after = runRules(ruleCtx(ctx0, ctx0.ground.gedtm, ctx.map));
      const outcome = markOverridden(after, results);
      return results.map((r, k) => ({ id: r.patch.id, district, action: r.patch.action, resolution: r.resolution, targets: r.targets, applied: r.applied, issueAfterRerun: outcome[k].outcome, note: r.note }));
    };
    const r1 = run(0);
    const r2 = run(9000000000000);
    overrides.run1.push(...r1);
    overrides.run2.push(...r2);
    overrides.stale.push(...staleReport(applyPatches(loadArea(ctx0.area).map, patches, project)).map((s) => ({ district, ...s })));
  }
  overrides.summary = {
    patches: overrides.run1.length, run1ById: overrides.run1.filter((r) => r.resolution === 'by_id').length, run2ByAnchor: overrides.run2.filter((r) => r.resolution === 'by_anchor').length,
    staleReported: overrides.stale.length, keptInFile: true, sameOutcomeBothRuns: overrides.run1.every((r, k) => r.issueAfterRerun === overrides.run2[k].issueAfterRerun),
  };
} else {
  notMeasured.push({ id: 'ov1_overrides', reason: 'no sample patches under harness/data/overrides (run census.mjs --write-sample-overrides once)' });
}

// ------------------------------------------------------------------ ground height: GS1, GS2, GS3

const GS = { gs1s: 'GEDTM30 v1.2 smoothed with the same 60 m Gaussian as GS2 (no samples dropped)', gs1: 'GEDTM30 v1.2, read by bilinear interpolation', gs2: 'Copernicus GLO-30 with the ground filter', gs3: 'FABDEM V1-2 (yardstick only)', raw: 'Copernicus GLO-30 as it is (a surface model)' };
const terrain = {
  ...stamp, bench: 'terrain_sources', writtenBy: 'node harness/bench/pilot_data/census.mjs',
  how: 'Every source is sampled by bilinear interpolation in WGS84. Heights are metres above the EGM2008 geoid in all three files. GS2: GLO-30 cells of each box (plus 150 m) are kept only when at most 10 percent of the cell lies under a building (5 by 5 points against the Overture footprints) and then a Gaussian surface (60 m) is fitted, dropping samples more than 1.5 m above the fit and fitting again (tools/bake/ground.ts fitGround). There is no surveyed truth here: FABDEM is the yardstick for the differences, and the roughness, step and outlier numbers judge each source on its own. Control points are centres of the largest OSM parks, pitches and lawns with no building within 40 m (5 per pilot district; a district with too few takes 15 m, then any lawn, and says so per point). Road profiles are the longest ground level ways of class tertiary and above (5 per pilot district), sampled every 15 m. Dense block lines are six east to west lines of 600 m through the 250 m cell with the most buildings in Chandni Chowk and in Laxmi Nagar.',
  sources: {}, gs2Filter: {}, controlPoints: null, roadProfiles: null, denseBlocks: null, outlierRule: null, licences: [], reading: null, notMeasured: [],
};
for (const [key, id] of [['gs1', 'gedtm30'], ['gs2', 'glo30'], ['gs3', 'fabdem']]) {
  const pinned = sources.files[id];
  terrain.sources[key] = { what: GS[key], pinned: pinned ? { file: pinned.file, url: pinned.url, sha256: pinned.sha256, bytes: pinned.bytes, date: pinned.date, note: pinned.note } : null };
  terrain.licences.push(licenceRow(LICENCES.find((l) => l.id === id)));
  if (!pinned) terrain.notMeasured.push({ id: key, reason: sources.unreachable[id] ? `unreachable after three tries: ${sources.unreachable[id].error}` : 'not downloaded' });
}
terrain.licences.push(licenceRow(LICENCES.find((l) => l.id === 'cartodem')));

const haveAll = heights.gedtm && heights.glo30 && heights.fabdem;
if (haveAll) {
  // GS2 per area
  for (const ctx of ctxs) {
    const built = ctx.overture || ctx.bs2 || ctx.map.buildings;
    const grid = new Grid(40);
    for (const b of built) grid.insert(b.box, b);
    ctx.builtGrid = grid;
    const covered = (p) => grid.query({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z }).some((b) => p.x >= b.box.minX && p.x <= b.box.maxX && p.z >= b.box.minZ && p.z <= b.box.maxZ && pointInRing(p, b.ring));
    const g = heights.glo30;
    const samples = [];
    let cells = 0;
    for (let j = 0; j < g.height; j++) {
      for (let i = 0; i < g.width; i++) {
        const lat = g.north + j * g.dLat;
        const lon = g.west + i * g.dLon;
        const p = ctx.proj.toWorld(lat, lon);
        if (p.x < ctx.box.minX - 150 || p.x > ctx.box.maxX + 150 || p.z < ctx.box.minZ - 150 || p.z > ctx.box.maxZ + 150) continue;
        const h = g.data[j * g.width + i];
        if (!Number.isFinite(h)) continue;
        cells++;
        let under = 0;
        for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) if (covered({ x: p.x + (a - 2) * 6, z: p.z + (b - 2) * 6 })) under++;
        if (under / 25 <= 0.1) samples.push({ x: p.x, z: p.z, h });
      }
    }
    const surface = fitGround(samples);
    ctx.ground.gs2 = surface.at;
    // GS1 smoothed the same way: every GEDTM30 cell of the box is a sample, none is dropped (it is a bare-earth model)
    const gd = heights.gedtm;
    const all = [];
    for (let j = 0; j < gd.height; j++) {
      for (let i = 0; i < gd.width; i++) {
        const p = ctx.proj.toWorld(gd.north + (j + 0.5) * gd.dLat, gd.west + (i + 0.5) * gd.dLon);
        if (p.x < ctx.box.minX - 150 || p.x > ctx.box.maxX + 150 || p.z < ctx.box.minZ - 150 || p.z > ctx.box.maxZ + 150) continue;
        const h = gd.data[j * gd.width + i];
        if (Number.isFinite(h)) all.push({ x: p.x, z: p.z, h });
      }
    }
    ctx.ground.gs1s = fitGround(all, { sigma: 60, dropAbove: Infinity, passes: 1 }).at;
    terrain.gs2Filter[ctx.area.id] = { cells, openCells: samples.length, openShare: round(samples.length / Math.max(1, cells), 3), keptAfterFit: surface.kept, droppedAboveFit: surface.dropped };
  }
  const SRC = (ctx) => ({ gs1: ctx.ground.gedtm, gs1s: ctx.ground.gs1s, gs2: ctx.ground.gs2, gs3: ctx.ground.fabdem, raw: ctx.ground.glo30 });
  const KEYS = ['gs1', 'gs1s', 'gs2', 'gs3', 'raw'];
  const pilots = ctxs.filter((c) => c.area.role === 'pilot');

  // 20 control points on open ground
  const points = [];
  for (const ctx of pilots) {
    const cands = ctx.map.open.filter((o) => inBoxM(ctx.box, o.centre) && pointInRing(o.centre, o.ring)).sort((a, b) => b.area - a.area);
    let n = 0;
    // first the points with no building within 40 m; a district with too few such lawns takes 15 m, then any lawn
    for (const clear of [40, 15, 0]) {
      for (const o of cands) {
        if (n >= 5) break;
        if (clear > 0 && ctx.builtGrid.query(boxOf([o.centre]), clear).some((b) => b.ring.some((q, k) => pointSegment(o.centre, q, b.ring[(k + 1) % b.ring.length]).d < clear))) continue;
        if (points.some((q) => q.district === ctx.area.id && Math.hypot(q.x - o.centre.x, q.z - o.centre.z) < 100)) continue;
        const s = SRC(ctx);
        const h = Object.fromEntries(Object.entries(s).map(([k, f]) => [k, round(f(o.centre.x, o.centre.z), 2)]));
        if (Object.values(h).some((v) => v === null)) continue;
        const g = ctx.proj.toGeo(o.centre.x, o.centre.z);
        points.push({ district: ctx.area.id, osm: o.id, kind: o.kind, areaM2: Math.round(o.area), clearOfBuildingsM: clear, lat: round(g.lat, 6), lon: round(g.lon, 6), x: round(o.centre.x, 1), z: round(o.centre.z, 1), ...h });
        n++;
      }
    }
  }
  const d = (a, b) => diffStats(points.map((p) => p[a] - p[b]));
  terrain.controlPoints = {
    count: points.length, differencesM: { gs1_minus_gs3: d('gs1', 'gs3'), gs1s_minus_gs3: d('gs1s', 'gs3'), gs2_minus_gs3: d('gs2', 'gs3'), gs1_minus_gs2: d('gs1', 'gs2'), raw_minus_gs3: d('raw', 'gs3') },
    perDistrict: Object.fromEntries(pilots.map((c) => [c.area.id, { gs1_minus_gs3: diffStats(points.filter((p) => p.district === c.area.id).map((p) => p.gs1 - p.gs3)), gs1s_minus_gs3: diffStats(points.filter((p) => p.district === c.area.id).map((p) => p.gs1s - p.gs3)), gs2_minus_gs3: diffStats(points.filter((p) => p.district === c.area.id).map((p) => p.gs2 - p.gs3)) }])),
    points,
  };

  // 20 road profiles
  const profiles = [];
  for (const ctx of pilots) {
    const roads = ctx.map.roads.filter((r) => !r.bridge && !r.tunnel && r.layer === 0 && !r.link && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(r.cls) && r.length >= 150).sort((a, b) => b.length - a.length);
    const used = [];
    for (const r of roads) {
      if (used.length >= 5) break;
      if (used.some((u) => u.name && u.name === r.name)) continue;
      const pts = resample(r.pts, PROFILE_STEP).filter((p) => inBoxM(ctx.box, p));
      if (pts.length < 8) continue;
      const row = { district: ctx.area.id, way: r.id, name: r.name, cls: r.cls, metres: Math.round(r.length), samples: pts.length };
      let ok = true;
      const series = {};
      for (const [k, f] of Object.entries(SRC(ctx))) {
        const h = pts.map((p) => f(p.x, p.z));
        if (h.some((v) => v === null)) ok = false;
        series[k] = h;
      }
      if (!ok) continue;
      for (const k of Object.keys(series)) {
        row[k] = { ...profileStats(series[k], PROFILE_STEP), outliers: checkProfile(series[k]).outliers, rmsToGs3: diffStats(series[k].map((v, i) => v - series.gs3[i])).rms };
      }
      used.push(r);
      profiles.push(row);
    }
  }
  const mean = (k, f) => round(profiles.reduce((s, p) => s + p[k][f], 0) / Math.max(1, profiles.length), 3);
  const max = (k, f) => round(Math.max(...profiles.map((p) => p[k][f])), 3);
  terrain.roadProfiles = {
    count: profiles.length, stepM: PROFILE_STEP,
    summary: Object.fromEntries(KEYS.map((k) => [k, { meanRoughnessM: mean(k, 'roughness'), worstRoughnessM: max(k, 'roughness'), meanMaxStepM: mean(k, 'maxStep'), worstStepM: max(k, 'maxStep'), worstGradePct: max(k, 'maxGradePct'), outlierSamples: profiles.reduce((s, p) => s + p[k].outliers, 0), samples: profiles.reduce((s, p) => s + p.samples, 0), meanRmsToGs3M: mean(k, 'rmsToGs3') }])),
    profiles,
  };

  // steps under dense blocks
  const dense = {};
  for (const id of ['chandni_chowk', 'laxmi_nagar']) {
    const ctx = ctxs.find((c) => c.area.id === id);
    if (!ctx) continue;
    const built = ctx.overture || ctx.bs2 || ctx.map.buildings;
    const count = new Map();
    for (const b of built) {
      if (!inBoxM(ctx.box, b.centre, -300)) continue;
      const key = `${Math.floor(b.centre.x / 250)},${Math.floor(b.centre.z / 250)}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    const [cx, cz] = best[0].split(',').map(Number);
    const x0 = cx * 250 + 125 - 300;
    const lines = {};
    for (const k of KEYS) lines[k] = [];
    for (let n = 0; n < 6; n++) {
      const z = cz * 250 + 20 + n * 42;
      for (const [k, f] of Object.entries(SRC(ctx))) {
        const h = [];
        for (let x = x0; x <= x0 + 600; x += 15) h.push(f(x, z));
        if (h.every((v) => v !== null)) lines[k].push(profileStats(h, 15));
      }
    }
    dense[id] = { cell: best[0], buildingsInCell: best[1], lines: 6, ...Object.fromEntries(Object.entries(lines).map(([k, l]) => [k, { meanRoughnessM: round(l.reduce((s, v) => s + v.roughness, 0) / Math.max(1, l.length), 3), worstStepM: round(Math.max(...l.map((v) => v.maxStep)), 2), heightRangeM: round(Math.max(...l.map((v) => v.max)) - Math.min(...l.map((v) => v.min)), 2) }])) };
  }
  terrain.denseBlocks = dense;

  // the outlier rule with each source
  terrain.outlierRule = { rule: 'R-TERR-03', how: 'roads with at least one sample more than 1.5 m off the running median or a step steeper than 10 percent', sites: {} };
  for (const ctx of ctxs) {
    const row = { groundRoads: ctx.map.roads.filter((r) => !r.bridge && !r.tunnel && r.layer === 0 && r.length >= 60).length };
    for (const [k, f] of Object.entries(SRC(ctx))) row[k] = CATALOGUE.find((r) => r.id === 'R-TERR-03').detect(ruleCtx(ctx, f)).length;
    terrain.outlierRule.sites[ctx.area.id] = row;
  }
  const cp = terrain.controlPoints.differencesM;
  const rp = terrain.roadProfiles.summary;
  terrain.reading = {
    gs1: `GEDTM30: ${cp.gs1_minus_gs3.rms} m RMS from the yardstick at ${points.length} open points (mean ${cp.gs1_minus_gs3.mean}), road roughness ${rp.gs1.meanRoughnessM} m, worst step ${rp.gs1.worstStepM} m in 15 m, ${rp.gs1.outlierSamples} outlier samples of ${rp.gs1.samples}`,
    gs1s: `GEDTM30 smoothed over 60 m: ${cp.gs1s_minus_gs3.rms} m RMS (mean ${cp.gs1s_minus_gs3.mean}), road roughness ${rp.gs1s.meanRoughnessM} m, worst step ${rp.gs1s.worstStepM} m, ${rp.gs1s.outlierSamples} outlier samples`,
    gs2: `GLO-30 with the ground filter: ${cp.gs2_minus_gs3.rms} m RMS (mean ${cp.gs2_minus_gs3.mean}), road roughness ${rp.gs2.meanRoughnessM} m, worst step ${rp.gs2.worstStepM} m, ${rp.gs2.outlierSamples} outlier samples`,
    gs3: `FABDEM: road roughness ${rp.gs3.meanRoughnessM} m, worst step ${rp.gs3.worstStepM} m, ${rp.gs3.outlierSamples} outlier samples; never shipped`,
    raw: `GLO-30 unfiltered: ${cp.raw_minus_gs3.rms} m RMS (mean ${cp.raw_minus_gs3.mean}), road roughness ${rp.raw.meanRoughnessM} m, worst step ${rp.raw.worstStepM} m`,
  };
} else {
  terrain.notMeasured.push({ id: 'gs_compare', reason: 'one of the three height files is missing, so the comparison did not run' });
}
function inBoxM(box, p, pad = 0) {
  return p.x >= box.minX - pad && p.x <= box.maxX + pad && p.z >= box.minZ - pad && p.z <= box.maxZ + pad;
}
writeJson(path.join(REPORTS, 'terrain_sources.json'), terrain);

// ------------------------------------------------------------------ landmarks (LM1) and world sources

const HEROES = ['India Gate', 'Red Fort', 'Jama Masjid'];
const SIGNATURES = ['Jantar Mantar', 'Connaught Place', 'Central Park', 'Rashtrapati Bhavan', 'Chandni Chowk', 'Agrasen ki Baoli', 'National War Memorial', 'Pragati Maidan', 'Bharat Mandapam', 'Supreme Court of India', 'Gurudwara Sis Ganj Sahib', 'Fatehpuri Mosque', 'Town Hall', 'Raj Ghat'];
const wd = readJson(path.join(PILOT, 'landmarks', 'wikidata.json'));
const landmarks = { ...stamp, bench: 'landmarks_pilot_draft', writtenBy: 'node harness/bench/pilot_data/census.mjs', how: 'LM1: OSM objects with a wikidata tag, or a name and a landmark tag (historic, tourism, place of worship, station, mall, stadium, park, garden), joined to the Wikidata items whose coordinate lies in the same box on the wikidata tag; a name match within 150 m is the flagged fallback. The ASI id is Wikidata P1371 (N-DL-*). The tier is proposed from a score (owner names, ASI listing, sitelinks, footprint size); the owner list and inspector edits win later. A draft: nothing is placed from it.', heroesNamedByOwner: HEROES, signatureNames: SIGNATURES, sites: {}, totals: null, candidates: [], notMeasured: [] };
if (wd) {
  const parseItems = (rows) => {
    const byQ = new Map();
    for (const r of rows) {
      const qid = r.item.value.split('/').pop();
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord?.value || '');
      if (!m) continue;
      let it = byQ.get(qid);
      if (!it) {
        it = { qid, label: r.itemLabel?.value || qid, labelHi: r.hi?.value || null, lat: Number(m[2]), lon: Number(m[1]), sitelinks: Number(r.sitelinks?.value || 0), asi: r.asi?.value || null, inception: r.inception?.value?.slice(0, 10) || null, heightM: r.height ? Number(r.height.value) : null, instanceOf: [], heritage: [], commons: r.commons?.value || null };
        byQ.set(qid, it);
      }
      if (r.instLabel && !it.instanceOf.includes(r.instLabel.value)) it.instanceOf.push(r.instLabel.value);
      if (r.heritageLabel && !it.heritage.includes(r.heritageLabel.value)) it.heritage.push(r.heritageLabel.value);
    }
    return [...byQ.values()];
  };
  const asiAll = wd.asiDelhi || [];
  const all = [];
  for (const ctx of ctxs) {
    const items = parseItems(wd.boxes[ctx.area.id] || []);
    const osm = osmLandmarks(ctx.raw.elements).filter((o) => inBox(ctx.area.bbox, o.lat, o.lon));
    const cands = joinLandmarks(osm, items, { heroes: HEROES, signatures: SIGNATURES, nameRadius: 150 });
    for (const c of cands) c.district = ctx.area.id;
    const tier = (t) => cands.filter((c) => c.tier === t).length;
    const dist = distanceStats(cands);
    landmarks.sites[ctx.area.id] = {
      candidates: cands.length, perSource: { osm: cands.filter((c) => c.sources.includes('osm')).length, wikidata: cands.filter((c) => c.sources.includes('wikidata')).length, asi: cands.filter((c) => c.sources.includes('asi')).length, osmOnly: cands.filter((c) => c.sources.length === 1 && c.sources[0] === 'osm').length, wikidataOnly: cands.filter((c) => !c.sources.includes('osm')).length },
      perTier: { hero: tier('hero'), signature: tier('signature'), marker: tier('marker') }, withOsmFootprint: cands.filter((c) => c.hasFootprint).length,
      match: { wikidataTag: cands.filter((c) => c.match === 'wikidata_tag').length, nameDistanceFallback: cands.filter((c) => c.match === 'name_distance').length, osmWikidataTagNotInBoxQuery: cands.filter((c) => c.flags.includes('wikidata_tag_not_in_box_query')).length },
      osmToWikidata: dist, flaggedOver50m: cands.filter((c) => c.flags.includes('osm_wikidata_over_50m')).map((c) => ({ name: c.name, wikidata: c.ids.wikidata, osm: c.ids.osm, metres: c.osmToWikidataM, footprintM2: c.footprintM2 })).slice(0, 12),
      heroes: cands.filter((c) => c.tier === 'hero').map((c) => ({ name: c.name, wikidata: c.ids.wikidata, osm: c.ids.osm, asi: c.ids.asi, hasFootprint: c.hasFootprint, metres: c.osmToWikidataM })),
      asiInBox: asiAll.filter((r) => { const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord?.value || ''); return m && inBox(ctx.area.bbox, Number(m[2]), Number(m[1])); }).length,
    };
    all.push(...cands);
  }
  const pilotCands = all.filter((c) => pilotIds.includes(c.district));
  const tierN = (t) => pilotCands.filter((c) => c.tier === t).length;
  landmarks.totals = {
    note: 'the four pilot districts', candidates: pilotCands.length, perTier: { hero: tierN('hero'), signature: tierN('signature'), marker: tierN('marker') },
    perSource: { osm: pilotCands.filter((c) => c.sources.includes('osm')).length, wikidata: pilotCands.filter((c) => c.sources.includes('wikidata')).length, asi: pilotCands.filter((c) => c.sources.includes('asi')).length },
    withOsmFootprint: pilotCands.filter((c) => c.hasFootprint).length, heroAndSignatureWithFootprint: pilotCands.filter((c) => c.tier !== 'marker' && c.hasFootprint).length, heroAndSignature: pilotCands.filter((c) => c.tier !== 'marker').length,
    osmToWikidata: distanceStats(pilotCands), osmToWikidataWithFootprint: distanceStats(pilotCands.filter((c) => c.hasFootprint)),
    fallbackNameMatches: pilotCands.filter((c) => c.match === 'name_distance').length,
    asiDelhiCircle: { wikidataRowsWithAsiId: asiAll.length, distinctIds: new Set(asiAll.map((r) => r.asi.value)).size, withCoordinate: asiAll.filter((r) => r.coord).length, inPilotBoxes: pilotIds.reduce((s, id) => s + landmarks.sites[id].asiInBox, 0) },
  };
  const asiPage = sources.files.asi_delhi_list;
  landmarks.totals.asiListPage = asiPage ? { url: asiPage.url, bytes: asiPage.bytes, sha256: asiPage.sha256, note: 'the page was reached and pinned; the ids are read through Wikidata P1371, the page is only the cross-check of the count' } : { unreachable: sources.unreachable.asi_delhi_list || null };
  if (asiPage) {
    const html = fs.readFileSync(path.join(ROOT, asiPage.file), 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').split('\n').filter((l) => l.trim()).length;
    const rows = (html.match(/<tr[\s>]/g) || []).length;
    landmarks.totals.asiListPage.tableRows = rows;
    landmarks.totals.asiListPage.textLines = text;
    landmarks.totals.asiListPage.machineReadable = rows > 100;
    if (rows <= 100) landmarks.totals.asiListPage.note = 'the page was reached and pinned, but the list is not in the served HTML (no table rows; it is loaded another way), so the official count could not be read here. The ASI ids come through Wikidata P1371 only';
  }
  landmarks.candidates = all.map((c) => ({ id: c.id, district: c.district, name: c.name, nameHi: c.nameHi, ids: c.ids, lat: round(c.lat, 6), lon: round(c.lon, 6), tier: c.tier, score: c.score, tierReason: c.tierReason, kind: c.kind, match: c.match, hasFootprint: c.hasFootprint, footprintM2: c.footprintM2, osmToWikidataM: c.osmToWikidataM, sitelinks: c.sitelinks, heightM: c.heightM, inception: c.inception, flags: c.flags }));
} else {
  landmarks.notMeasured.push({ id: 'lm1_join', reason: sources.unreachable.wikidata ? `Wikidata was unreachable: ${sources.unreachable.wikidata.error}` : 'the Wikidata download is missing' });
}
writeJson(path.join(REPORTS, 'landmarks_pilot_draft.json'), landmarks);

// area sources: what covers the pilot, and the 100 m feature table (if time item)
const areaCover = {};
const featureTables = {};
for (const ctx of ctxs) {
  const tagged = (key, values) => ctx.raw.elements.filter((e) => e.tags && e.tags[key] !== undefined && (!values || values.includes(e.tags[key])));
  const landuse = {};
  for (const e of tagged('landuse')) landuse[e.tags.landuse] = (landuse[e.tags.landuse] || 0) + 1;
  areaCover[ctx.area.id] = {
    osmLandusePolygons: tagged('landuse').length, osmLanduseKinds: Object.entries(landuse).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} (${n})`),
    osmPlaceNames: tagged('place', ['suburb', 'neighbourhood', 'quarter', 'locality']).map((e) => e.tags.name).filter(Boolean).slice(0, 20), osmOpenGroundPolygons: ctx.map.open.length,
    footprints: { osm: ctx.map.buildings.length, google: ctx.google?.length ?? null, microsoft: ctx.ms?.length ?? null, overture: ctx.overture?.length ?? null },
  };
  if (ctx.area.role !== 'pilot' || ctx.area.id === 'india_gate') continue;
  // 100 m cells: building count and coverage, median footprint, road metres, open ground share, mean height hint
  const built = ctx.overture || ctx.bs2 || ctx.map.buildings;
  const cells = new Map();
  const cell = (x, z) => {
    const key = `${Math.floor(x / 100)},${Math.floor(z / 100)}`;
    if (!cells.has(key)) cells.set(key, { cx: Math.floor(x / 100), cz: Math.floor(z / 100), buildings: 0, footprintM2: 0, areas: [], roadM: 0, majorRoadM: 0, openM2: 0, heights: [] });
    return cells.get(key);
  };
  for (const b of built) {
    if (!inBoxM(ctx.box, b.centre)) continue;
    const c = cell(b.centre.x, b.centre.z);
    c.buildings++;
    c.footprintM2 += b.area;
    c.areas.push(b.area);
    if (b.height !== null) c.heights.push(b.height);
    else if (b.levels !== null) c.heights.push(b.levels * 3.2);
  }
  for (const r of ctx.map.roads) {
    const pts = resample(r.pts, 10);
    for (const p of pts) {
      if (!inBoxM(ctx.box, p)) continue;
      const c = cell(p.x, p.z);
      c.roadM += 10;
      if (['motorway', 'trunk', 'primary', 'secondary'].includes(r.cls)) c.majorRoadM += 10;
    }
  }
  for (const o of ctx.map.open) if (inBoxM(ctx.box, o.centre)) cell(o.centre.x, o.centre.z).openM2 += o.area;
  const rows = [...cells.values()].map((c) => {
    const a = c.areas.sort((x, y) => x - y);
    return { cx: c.cx, cz: c.cz, buildings: c.buildings, coverage: round(Math.min(1, c.footprintM2 / 10000), 3), medianFootprintM2: round(a[Math.floor(a.length / 2)] ?? 0, 1), roadM: c.roadM, majorRoadM: c.majorRoadM, openShare: round(Math.min(1, c.openM2 / 10000), 3), meanHeightM: c.heights.length ? round(c.heights.reduce((s, v) => s + v, 0) / c.heights.length, 1) : null };
  });
  writeJson(path.join(shotDir, `features_100m_${ctx.area.id}.json`), { district: ctx.area.id, cellM: 100, frame: 'district metres, origin at the area centre, x east, z south', buildingsFrom: ctx.overture ? 'Overture (BS1)' : 'own merge', cells: rows }, false);
  const q = (f, p) => { const v = rows.map(f).sort((a, b) => a - b); return v[Math.floor((v.length - 1) * p)]; };
  featureTables[ctx.area.id] = {
    file: rel(path.join(shotDir, `features_100m_${ctx.area.id}.json`)), cells: rows.length,
    buildingsPerCell: { p10: q((r) => r.buildings, 0.1), median: q((r) => r.buildings, 0.5), p90: q((r) => r.buildings, 0.9) }, coverage: { p10: q((r) => r.coverage, 0.1), median: q((r) => r.coverage, 0.5), p90: q((r) => r.coverage, 0.9) },
    medianFootprintM2: { p10: q((r) => r.medianFootprintM2, 0.1), median: q((r) => r.medianFootprintM2, 0.5), p90: q((r) => r.medianFootprintM2, 0.9) }, roadMPerCell: { median: q((r) => r.roadM, 0.5), p90: q((r) => r.roadM, 0.9) },
    cellsWithHeightHint: rows.filter((r) => r.meanHeightM !== null).length,
  };
}
const world = {
  ...stamp, bench: 'world_sources', writtenBy: 'node harness/bench/pilot_data/census.mjs',
  how: 'Every landmark and area source named in DELHI_WORLD.md "Sources" and "Area division from open data". Each licence page was fetched by fetch.mjs on dateChecked; checked.statementFrom says whether the script read the licence phrase on the page or the row stays a belief.',
  landmarkSources: LICENCES.filter((l) => ['landmark', 'reference'].includes(l.layer) || l.id === 'osm').map(licenceRow),
  areaSources: LICENCES.filter((l) => l.layer === 'area' || ['google_open_buildings', 'ms_footprints', 'open_buildings_25d'].includes(l.id)).map(licenceRow),
  coverageOfThePilot: {
    how: 'Counted from the pinned downloads for the sources that were fetched. Census wards, ward boundaries, MPD maps, Sentinel-2 and VIIRS were not downloaded in this bench: AD2 (hand-drawn areas seeded by OSM land use and colony names, with the footprint grid as evidence) does not need them, and three of them need an account or have no open licence.',
    sites: areaCover,
    notFetched: [
      { id: 'census2011', reason: 'ward tables are on data.gov.in and censusindia.gov.in as spreadsheets per district; not needed for AD2, usable under GODL when wanted' },
      { id: 'ward_boundaries', reason: 'not needed for AD2; the DataMeet repository has a Delhi folder and its readme states CC BY 4.0 for every dataset unless it says otherwise' },
      { id: 'mpd_landuse', reason: 'scanned PDFs with no open licence: reference only' },
      { id: 'sentinel2', reason: 'needs a Copernicus Data Space account for bulk download (an owner action); 10 m cells; only used as a greenery hint' },
      { id: 'viirs', reason: 'needs a free account at the Earth Observation Group; about 500 m cells are coarser than a pilot district' },
    ],
  },
  featureTable100m: Object.keys(featureTables).length ? { how: 'If time item, done for three pilot districts: per 100 m cell the building count and coverage, median footprint, road metres, open ground share and a mean height hint. The full tables are files beside this report.', sites: featureTables } : null,
  landmarkSummary: landmarks.totals,
  notMeasured: [
    { id: 'building_heights_open_buildings_25d', reason: 'if time item, not done: the Open Buildings 2.5D Temporal data is served through Earth Engine, which needs a Google account (an owner action). Licence checked: CC BY 4.0 or ODbL, so it may be used once fetched' },
    ...(Object.keys(featureTables).length ? [] : [{ id: 'feature_table_100m', reason: 'if time item, did not run (no footprints)' }]),
  ],
};
writeJson(path.join(REPORTS, 'world_sources.json'), world);

// ------------------------------------------------------------------ debug renders

const renders = [];
for (const ctx of ctxs.filter((c) => c.area.role === 'pilot')) {
  const issues = allIssues[ctx.area.id];
  const counts = Object.fromEntries(CATALOGUE.map((r) => [r.id, issues.filter((i) => i.rule === r.id).length]));
  const base = { roads: ctx.map.roads, buildings: ctx.map.buildings, open: ctx.map.open };
  const mapRules = CATALOGUE.filter((r) => r.area !== 'terrain').map((r) => r.id);
  const f1 = path.join(shotDir, `issues_${ctx.area.id}.png`);
  await renderMap(f1, ctx.box, { ...base, issues, counts, title: `${ctx.area.name}: road, bridge and building issues on OSM (north up). Grey blocks: OSM buildings` }, { rules: mapRules });
  renders.push({ file: rel(f1), district: ctx.area.id, shows: mapRules, counts: Object.fromEntries(mapRules.map((r) => [r, counts[r]])) });
}
{
  // one terrain picture and one building source picture, both of Chandni Chowk (the dense case)
  const ctx = ctxs.find((c) => c.area.id === 'chandni_chowk');
  if (ctx) {
    const issues = allIssues[ctx.area.id];
    const f2 = path.join(shotDir, 'terrain_outliers_chandni_chowk.png');
    await renderMap(f2, ctx.box, { roads: ctx.map.roads, buildings: ctx.map.buildings, open: ctx.map.open, issues, counts: { 'R-TERR-03': issues.filter((i) => i.rule === 'R-TERR-03').length }, title: 'Chandni Chowk with Red Fort: ground height outliers along roads, GEDTM30 (north up)' }, { rules: ['R-TERR-03'], dot: 4 });
    renders.push({ file: rel(f2), district: ctx.area.id, shows: ['R-TERR-03'] });
    if (ctx.overture) {
      const colour = { 'overture:OpenStreetMap': '#8c8474', 'overture:Google Open Buildings': '#e0a060', 'overture:Microsoft ML Buildings': '#6fa8dc' };
      const f3 = path.join(shotDir, 'buildings_bs1_chandni_chowk.png');
      await renderMap(f3, ctx.box, {
        roads: ctx.map.roads, open: ctx.map.open, buildings: ctx.overture.map((b) => ({ ring: b.ring, fill: colour[b.source] || '#c9c2b4' })), issues: [],
        title: `Chandni Chowk with Red Fort: Overture buildings (BS1) by source. Grey OSM ${buildings.sites.chandni_chowk.bs1.bySource.OpenStreetMap || 0}, orange Google ${buildings.sites.chandni_chowk.bs1.bySource['Google Open Buildings'] || 0}, blue Microsoft ${buildings.sites.chandni_chowk.bs1.bySource['Microsoft ML Buildings'] || 0} (north up)`,
      }, { rules: [] });
      renders.push({ file: rel(f3), district: ctx.area.id, shows: ['BS1 footprints by source'] });
    }
  }
}

// ------------------------------------------------------------------ pilot_data.json

const mapLicences = LICENCES.filter((l) => l.layer === 'map' || l.layer === 'height' || ['mapillary', 'sentinel2', 'commons'].includes(l.id)).map(licenceRow);
const pinned = Object.entries(sources.files).map(([id, f]) => ({ id, file: f.file, url: f.url, date: f.date, licence: f.licence, licenceUrl: f.licenceUrl, credit: f.credit, bytes: f.bytes, sha256: f.sha256, release: f.release || null, osmBase: f.osmBase || null, remote: f.remote || null, note: f.note }));
const report = {
  ...stamp, bench: 'pilot_data', writtenBy: 'node harness/bench/pilot_data/fetch.mjs, then node harness/bench/pilot_data/census.mjs', bakeLanguage: 'B1: Node and TypeScript (tools/bake/, run by Node 22 without a build step); DuckDB for Node reads Overture, geotiff.js reads the height files. No Python was needed (B3 not used).',
  areas: areas.map((a) => ({ id: a.id, name: a.name, role: a.role, bbox: a.bbox, centre: a.centre })),
  sources: { pinnedFiles: pinned, unreachable: sources.unreachable, pinList: 'data/SOURCES.json', licences: mapLicences },
  ruleEngine: { option: 'RE1', catalogue: catalogueLines(), order: CATALOGUE.map((r) => r.id), code: 'tools/bake/rules/' },
  autoRepair: { option: 'AR1', rule: 'an issue repairs on its own when a proposal has confidence 0.8 or more and a low impact; low impact is defined per rule: a join of 5 m or less, a bridge layer tag, a building reaching 1.5 m or less into a class-default width, an exact duplicate footprint, a height outlier of 3 m or less', totals },
  census: { how: 'Rules run per district on the OSM extract in the district frame (origin at the area centre). R-TERR-03 uses GEDTM30 here; terrain_sources.json runs it with every height source. Ends outside the download box are not counted as dangling.', sites },
  buildings, roads: roadsCheck, overrides,
  debugRenders: renders,
  wallMs: Date.now() - t00,
  notMeasured: [
    ...notMeasured,
    { id: 'osmium_extract', reason: 'not needed: Overpass answered every box, so no regional extract was cut' },
    { id: 'metro_and_fob_rules', reason: 'R-RAIL and R-FOB are not in the MUST list of this bench; they come with the repair layer build' },
  ],
};
writeJson(path.join(REPORTS, 'pilot_data.json'), report);
console.log(`pilot: ${totals.issues} issues, ${totals.autoRepair} automatic (${totals.autoShare}); without the terrain rule ${totals.withoutTerrainRule.issues} / ${totals.withoutTerrainRule.autoRepair} (${totals.withoutTerrainRule.autoShare})`);
console.log(`wrote pilot_data.json, terrain_sources.json, world_sources.json, landmarks_pilot_draft.json and ${renders.length} renders in ${rel(REPORTS)} (${Date.now() - t00} ms)`);
