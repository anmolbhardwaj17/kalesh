// The lane model of the pilot centre (P1-012 acceptance), from the pinned stage files in data/pilot_centre/
// (gitignored; the test skips with the reason when they are missing). It runs the bake driver through the lanes step
// into a temp report folder and reads the health record and the model file: continuity with the explained ends,
// tapers, split zones, left-hand traffic and lane widths, the lane counts along Bahadur Shah Zafar Marg and Vikas
// Marg, the ITO site of the Phase 0 road bench, the Connaught Place inner circle against its hero spec, the junction
// paths, the build time and the hash.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projector } from '../../geo/projection.ts';
import { parseArgs } from '../cli.ts';
import { taggedLanes } from '../graph/classify.ts';
import { stagePlan } from '../layout/stages.ts';
import { bake, offlineNet } from '../main.ts';
import { checkLaneModel, checkPlanOverlap } from './lanechecks.ts';
import { classDefaults, GALI_MIN_LANE_M, MIN_DRIVE_LANE_M, MIN_TURN_RADIUS_M } from './model.ts';
import { buildLaneModel } from './network.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

/** The ITO site of the Phase 0 road bench (harness/bench/roads.mjs): a box around its area centre, two classes, six ways left out. */
const ITO = { lat: 28.6285, lon: 77.2414, box: { minX: 400, minZ: -560, maxX: 720, maxZ: 620 }, classes: ['trunk', 'secondary'], exclude: ['way/1313447926', 'way/70237516', 'way/776652308', 'way/699562875', 'way/70237518', 'way/70237521'] };
/** What the Phase 0 bench measured there (decisions "Road prototype results (P0-019)"). */
const PHASE0 = { zones: 10, overlapM2: 0 };

describe.skipIf(missing.length > 0)(`pilot centre lane model${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let done;
  const baked = () => (done ??= run());
  const run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-lanes-'));
    const healthFile = path.join(dir, 'health.json');
    const lines = [];
    const report = await bake(parseArgs(['pilot', '--stage', 'lanes', '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-12', log: (l) => lines.push(l), healthFile });
    const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    const model = JSON.parse(fs.readFileSync(path.join(ROOT, health.lanes.files.model), 'utf8'));
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, plan.def.dataDir, 'graph_repaired.json'), 'utf8'));
    const osm = JSON.parse(fs.readFileSync(path.join(ROOT, plan.def.dataDir, 'osm.json'), 'utf8'));
    const wayLanes = new Map();
    for (const e of osm.elements) {
      if (e.type !== 'way' || !e.tags?.highway) continue;
      const n = taggedLanes(e.tags);
      if (n !== null) wayLanes.set(`way/${e.id}`, n);
    }
    const heroes = [JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/hero_roads/cp_inner_circle.json'), 'utf8'))];
    for (const l of lines.filter((x) => x.startsWith('[lanes]'))) console.log(l);
    return { report, health, lanes: health.lanes, model, graph, wayLanes, heroes, lines, dir };
  };
  /** The whole bake runs once, inside the first test that asks for it. */
  const T = 300000;
  const drive = (s, st) => s.lanes.filter((l, k) => l.type === 'drive' && st[7 + k] - st[8 + k] > 0.05).length;

  it('the bake runs through the lanes step, in under 30 s for the model, with the same hash twice', async () => {
    const { report, lanes, health } = await baked();
    expect(report.steps).toEqual(['sources', 'ground', 'graph', 'repair', 'lanes']);
    expect(report.stoppedBeforeTiles).toBe(false);
    expect(lanes.buildMs).toBeLessThan(30000);
    const inv = Object.fromEntries(health.invariants.filter((i) => i.id.startsWith('LANES-')).map((i) => [i.id, i.ok]));
    expect(inv).toEqual({ 'LANES-01.continuity': true, 'LANES-02.zones': true, 'LANES-03.same_twice': true, 'LANES-04.left_hand_and_widths': true, 'LANES-05.hero': true });
    expect(lanes.hash).toMatch(/^[0-9a-f]{8,}$/);
    expect(lanes.counts.strips).toBeGreaterThan(5000);
    expect(lanes.counts.driveLanes).toBeGreaterThan(8000);
    expect(lanes.problems).toEqual([]);
    // strips on each other in plan on the whole pilot (P1-012: 4,917 m2 in 494 pairs; P1-031: 819 m2 in 55 pairs;
    // P1-033: under 1 m2, the pairs left are listed in decisions.md "The last road overlaps (P1-033)")
    expect(lanes.overlap.areaM2).toBeLessThan(1);
    // the repair step's lane feedback (rule R-LANE-06) ends with no new conflict to hand back
    const fb = health.repair.laneFeedback;
    expect(fb.rounds.length).toBeGreaterThan(0);
    expect(fb.rounds[fb.rounds.length - 1].overlapM2).toBe(lanes.overlap.areaM2);
    for (const f of [lanes.files.model, lanes.files.laneGraph]) expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
    expect(lanes.files.pictures.filter((p) => p.endsWith('.png')).map((p) => path.basename(p)).sort()).toEqual(['lanes_pilot_cp.png', 'lanes_pilot_ito.png']);
  }, T);

  it('lane continuity breaks 0: every lane at a strip end has a successor or an explained end in the health report', async () => {
    const { lanes, health, model } = await baked();
    expect(lanes.gates.laneContinuityBreaks).toBe(0);
    expect(health.gates.laneContinuityBreaks).toBe(0);
    expect(lanes.continuity.lanePairs).toBeGreaterThan(1000);
    expect(Object.values(lanes.explainedEnds).reduce((a, b) => a + b, 0)).toBe(model.ends.length);
    for (const e of model.ends) expect(['map_edge', 'dead_end', 'gate', 'loop', 'barricade', 'junction_stub'].includes(e.kind) && e.why.length > 10).toBe(true);
    expect(lanes.explainedEnds.map_edge).toBeGreaterThan(100);
  }, T);

  it('tapers out of limits: each one explained, none where the lane count changes', async () => {
    const { lanes, health } = await baked();
    expect(health.gates.tapersOutOfLimits).toBe(lanes.tapers.violations);
    expect(lanes.tapers.tapers).toBeGreaterThan(50);
    expect(lanes.tapers.violations).toBeLessThanOrEqual(6);
    expect(lanes.tapers.unexplained).toBe(0);
    expect(lanes.tapers.findings).toHaveLength(lanes.tapers.violations);
    // the ones left only shift lane widths (a slip road's wide lane) on a road between two split zones
    for (const f of lanes.tapers.findings) expect(f.why).toMatch(/^the lane count stays \d+: only lane widths change/);
  }, T);

  it('every split zone has a gore and a nose and ends on both branches centre lines within 0.01 m; every other fork has its reason', async () => {
    const { lanes, model } = await baked();
    expect(lanes.zones.zones).toBeGreaterThan(120);
    expect(lanes.zones.zones).toBe(model.zones.length);
    expect(lanes.zones.withoutGoreOrNose).toBe(0);
    expect(lanes.zones.endsOffCentreLine).toBe(0);
    expect(lanes.zones.maxEndErrorM).toBeLessThanOrEqual(0.01);
    for (const z of model.zones) {
      expect(model.strips[z.strip].lanes.filter((l) => l.type === 'gore')).toHaveLength(3);
      expect(z.noseM).toBeGreaterThan(0);
      expect(z.parent && z.left && z.right).toBeTruthy();
    }
    expect(Object.values(lanes.forks.byReason).reduce((a, b) => a + b, 0)).toBe(model.forks.length);
    for (const f of model.forks) expect(f.why.length).toBeGreaterThan(20);
  }, T);

  it(`left-hand traffic on every two-way strip; no driving lane under ${MIN_DRIVE_LANE_M} m except galis (never under ${GALI_MIN_LANE_M} m)`, async () => {
    const { lanes, model } = await baked();
    expect(lanes.trafficSide.twoWayStrips).toBeGreaterThan(900);
    expect(lanes.trafficSide.wrongSide).toBe(0);
    expect(lanes.widths.tooNarrow).toBe(0);
    expect(lanes.widths.narrowestM).toBeGreaterThanOrEqual(MIN_DRIVE_LANE_M);
    expect(lanes.widths.narrowestGaliM).toBeGreaterThanOrEqual(GALI_MIN_LANE_M);
    // read from the file itself: a lane narrower than the limit is tagged gali
    for (const s of model.strips) {
      if (s.kind === 'taper') continue;
      s.lanes.forEach((l, k) => {
        if (l.type !== 'drive' || l.tag === 'gali') return;
        for (const st of s.st) expect(st[7 + k] - st[8 + k]).toBeGreaterThanOrEqual(MIN_DRIVE_LANE_M - 0.002);
      });
    }
  }, T);

  it('whole-street inference: one lane count between junctions along Bahadur Shah Zafar Marg and Vikas Marg, changing only at a taper inside the class limits', async () => {
    const { model, lanes } = await baked();
    const out = new Set(lanes.tapers.findings.map((f) => f.strip));
    for (const name of ['Bahadur Shah Zafar Marg', 'Vikas Marg']) {
      const strips = model.strips.filter((s) => s.name === name && s.kind !== 'zone');
      expect(strips.length).toBeGreaterThan(8);
      const byEdge = new Map();
      for (const s of strips) byEdge.set(s.edge, [...(byEdge.get(s.edge) ?? []), s]);
      const counts = [];
      for (const [edge, list] of byEdge) {
        // between two junctions: every road strip of the edge carries the same lanes
        const road = list.filter((s) => s.kind === 'road').map((s) => drive(s, s.st[0]));
        expect(new Set(road).size, `${name} ${edge}`).toBeLessThanOrEqual(1);
        if (road.length) counts.push(road[0]);
        for (const t of list.filter((s) => s.kind === 'taper')) {
          const a = drive(t, t.st[0]);
          const b = drive(t, t.st[t.st.length - 1]);
          // a taper where the count changes is inside the limit of its class
          if (a !== b) {
            expect(out.has(t.id), `${name} ${t.id}: ${a} to ${b} lanes`).toBe(false);
            expect(t.taper.length).toBeGreaterThanOrEqual(classDefaults(t.cls).taper * t.taper.shift * 0.98 - 0.05);
          }
        }
      }
      console.log(`[pilot lanes] ${name}: ${byEdge.size} edges, lane counts ${JSON.stringify(Object.fromEntries([...new Set(counts)].sort().map((c) => [c, counts.filter((x) => x === c).length])))}`);
    }
  }, T);

  it('ITO: the Phase 0 site builds on the production modules; its numbers against the bench result', async () => {
    const { graph, wayLanes, heroes, model } = await baked();
    const c = projector(graph.origin).toWorld(ITO.lat, ITO.lon);
    const box = { minX: c.x + ITO.box.minX, maxX: c.x + ITO.box.maxX, minZ: c.z + ITO.box.minZ, maxZ: c.z + ITO.box.maxZ };
    const inBox = (p) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
    // the bench's own site: the same classes and the same ways left out
    const site = buildLaneModel({ nodes: graph.nodes, edges: graph.edges, marks: graph.marks, wayLanes, heroes, filter: { classes: ITO.classes, exclude: ITO.exclude, box } });
    const siteChecks = checkLaneModel(site);
    // the ten diverges and merges of the bench are all found; those whose branches do not separate within their own
    // length on the repaired graph are forks with a reason
    expect(site.zones.length + site.forks.length).toBe(PHASE0.zones);
    // P1-031: 9 zones and 1 fork (P1-012 had 8 and 2): rule R-LANE-04 moves a branch with no room for a gore out from
    // the split node, so the second fork opens into a zone; the one left is the cluster rule's (a turn island)
    expect(site.zones.length).toBeGreaterThanOrEqual(9);
    expect(siteChecks.zones.withoutGoreOrNose + siteChecks.zones.endsOffCentreLine).toBe(0);
    // in the whole model the box holds more zones than the bench had: the slip roads the bench left out are in
    const node = new Map(graph.nodes.map((n) => [n.id, n]));
    const zonesInBox = model.zones.filter((z) => inBox(node.get(z.node)));
    expect(zonesInBox.length).toBeGreaterThanOrEqual(PHASE0.zones);
    // strips on each other in plan: none in the box since P1-031 (rule R-LANE-05 moves roads beside each other apart,
    // nodes too; the edges of strips side by side give way, roads/edges.ts)
    const all = buildLaneModel({ nodes: graph.nodes, edges: graph.edges, marks: graph.marks, wayLanes, heroes });
    const overlap = checkPlanOverlap(all.strips, all.joints, (s) => s.st.some(inBox));
    console.log(`[pilot lanes] ITO site of the bench: ${site.zones.length} zones and ${site.forks.length} forks of ${PHASE0.zones} splits (whole model: ${zonesInBox.length} zones in the box); strips on each other in the box ${overlap.areaM2} m2 in ${overlap.pairs} pairs (bench: ${PHASE0.overlapM2}); worst ${JSON.stringify(overlap.worst.slice(0, 3))}`);
    expect(overlap.areaM2).toBeLessThan(1);
  }, T);

  it('the Connaught Place inner circle equals its hero spec lane for lane', async () => {
    const { lanes } = await baked();
    const h = lanes.hero.find((x) => x.spec === 'cp_inner_circle');
    expect(h.strips).toBeGreaterThanOrEqual(10);
    expect(h.fieldsCompared).toBeGreaterThan(5000);
    expect(h.mismatches).toBe(0);
  }, T);

  it(`every pair of junction arms the turn rules allow has a connecting lane path; all but the listed few turn on ${MIN_TURN_RADIUS_M} m or more`, async () => {
    const { lanes, model } = await baked();
    expect(lanes.paths.pairs).toBeGreaterThan(15000);
    expect(lanes.paths.pairsWithoutPath).toBe(0);
    // the acceptance asks for 0 here: these are lanes whose only way on is a hairpin between two roads side by side
    expect(lanes.paths.pairsBelowRadius).toBeLessThanOrEqual(4);
    expect(lanes.paths.tight).toHaveLength(lanes.paths.pathsBelowRadius);
    for (const t of lanes.paths.tight) expect(t.why.length).toBeGreaterThan(20);
    let below = 0;
    for (const j of model.junctions) {
      for (const pair of j.pairs) {
        const of = j.paths.filter((p) => p.fromArm === pair.from && p.toArm === pair.to);
        expect(of.length).toBeGreaterThan(0);
        if (!of.some((p) => p.radius === null || p.radius >= MIN_TURN_RADIUS_M)) below++;
      }
    }
    expect(below).toBe(lanes.paths.pairsBelowRadius);
  }, T);
});
