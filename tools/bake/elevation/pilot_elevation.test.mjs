// The elevation solve of the pilot centre (P1-013 acceptance), from the pinned stage files in data/pilot_centre/
// (gitignored; the test skips with the reason when they are missing). It runs the bake driver through the elevation
// step into a temp report folder and reads the health record and the heights file: no steps, grades and vertical
// curves inside their class limits, every clearance, the ITO flyover against the Phase 0 site result
// (harness/data/fixtures/ito_phase0_profile.json), the railway bridge over Minto Road, every structure listed, the
// solve time and two runs that agree.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projector } from '../../geo/projection.ts';
import { stagePlan } from '../layout/stages.ts';
import { logLines, sharedBake } from '../../testkit/sharedbake.mjs';
import { blockFrame } from '../layout/placement.ts';
import { DECK_DEPTH, HEADROOM, maxGrade, RAIL_DECK_DEPTH_M, WATER_CLEARANCE_M } from './limits.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';
const PHASE0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/fixtures/ito_phase0_profile.json'), 'utf8'));

describe.skipIf(missing.length > 0)(`pilot centre elevation${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let done;
  const baked = () => (done ??= build());
  const build = async () => {
    const sb = await sharedBake();
    const { report, health, lines } = sb;
    const heights = JSON.parse(fs.readFileSync(sb.file(health.elevation.files.heights), 'utf8'));
    const lanes = JSON.parse(fs.readFileSync(sb.file(health.lanes.files.model), 'utf8'));
    const graph = JSON.parse(fs.readFileSync(sb.file('graph_repaired.json'), 'utf8'));
    logLines(lines, '[elevation]');
    return { report, health, el: health.elevation, heights, lanes, graph, lines };
  };
  /** The shared bake (tools/testkit/sharedbake.mjs) is built by the first test file that asks, once per run, and kept between runs. */
  const T = 1800000;

  it('the bake runs through the elevation step: converged, nothing given up, two runs within 0.000001 m', async () => {
    const { report, health, el, heights, lanes } = await baked();
    expect(report.steps.slice(0, 6)).toEqual(['sources', 'ground', 'graph', 'repair', 'lanes', 'elevation']);
    expect(report.stoppedBeforeTiles).toBe(false);
    const inv = Object.fromEntries(health.invariants.filter((i) => i.id.startsWith('ELEV-')).map((i) => [i.id, i.ok]));
    expect(inv).toEqual({ 'ELEV-01.no_steps': true, 'ELEV-02.grades_and_curves': true, 'ELEV-03.clearances': true, 'ELEV-04.solved': true, 'ELEV-05.same_twice': true, 'ELEV-06.overhead': true });
    expect(el.solver.converged).toBe(true);
    expect(el.unmet).toEqual([]);
    expect(el.findings).toEqual([]);
    console.log(`[elevation] solve time ${el.solveMs} ms (${JSON.stringify(el.solver.ms)}); two runs differ by ${el.twoRunsMaxDiffM} m`);
    expect(el.twoRunsMaxDiffM).toBeLessThanOrEqual(1e-6);
    expect(el.solver.unknowns).toBeGreaterThan(30000);
    // the heights file follows the lane model strip for strip, station for station
    expect(heights.lanes).toBe(health.lanes.hash);
    expect(heights.strips).toHaveLength(lanes.strips.length);
    heights.strips.forEach((s, i) => {
      expect(s.id).toBe(lanes.strips[i].id);
      expect(s.h).toHaveLength(lanes.strips[i].st.length);
    });
    expect(heights.junctions).toHaveLength(lanes.junctions.length);
    expect(el.files.pictures.filter((p) => p.endsWith('.png')).map((p) => path.basename(p)).sort()).toEqual(['elevation_pilot.png', 'elevation_pilot_ito.png']);
  }, T);

  it('0 height steps at nodes; grade violations 0; no vertical curve under its class limit', async () => {
    const { el, heights, lanes } = await baked();
    expect(el.steps.joints).toBeGreaterThan(400);
    expect(el.steps.maxMismatchM).toBeLessThan(0.01);
    expect(el.gates).toEqual({ heightSteps: 0, gradeViolations: 0, curveViolations: 0, clearanceViolations: 0, crossfallViolations: 0 });
    expect(el.grade.segments).toBeGreaterThan(80000);
    expect(el.grade.violations).toBe(0);
    expect(el.curves.measured).toBeGreaterThan(80000);
    expect(el.curves.violations).toBe(0);
    expect(el.steps.steepestJunctionPct).toBeLessThanOrEqual(5.0001);
    // measured again here from the two files, on the heights as written (millimetres): every joint, every station pair
    let step = 0;
    for (const j of lanes.joints) {
      const h = (e) => heights.strips[e.strip].h[e.end === 'start' ? 0 : heights.strips[e.strip].h.length - 1];
      step = Math.max(step, Math.abs(h(j.a) - h(j.b)));
    }
    expect(step).toBeLessThan(0.01);
    let over = 0;
    let steepest = 0;
    lanes.strips.forEach((s, si) => {
      const limit = maxGrade(s.cls, s.link);
      const h = heights.strips[si].h;
      for (let i = 0; i + 1 < s.st.length; i++) {
        const d = Math.hypot(s.st[i + 1][0] - s.st[i][0], s.st[i + 1][1] - s.st[i][1]);
        if (d < 1) continue;
        const g = Math.abs(h[i + 1] - h[i]) / d;
        steepest = Math.max(steepest, g / limit);
        // a millimetre of rounding at each end of a metre of road is 0.2 percent of grade
        if (g > limit + 0.002 / d) over++;
      }
    });
    expect(over).toBe(0);
    expect(steepest).toBeGreaterThan(0.99);
  }, T);

  it('every crossing of two levels has its clearance: 5.5 m under a road over a road, under a railway bridge and over a junction; 6.5 m over a railway line; 2.5 m over water', async () => {
    const { el } = await baked();
    const c = el.clearance;
    console.log(`[elevation] clearances: ${JSON.stringify(c)}`);
    expect(c.violations).toBe(0);
    expect(c.roadCrossings).toBeGreaterThan(50);
    expect(c.minRoadM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
    expect(c.junctionCrossings).toBeGreaterThan(5);
    expect(c.minJunctionM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
    expect(c.roadUnderRail).toBeGreaterThan(50);
    expect(c.minRoadUnderRailM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
    expect(c.roadOverRail).toBeGreaterThan(30);
    expect(c.minRoadOverRailM).toBeGreaterThanOrEqual(6.5 - 0.02);
    expect(c.waterCrossings).toBeGreaterThan(0);
    expect(c.minOverWaterM).toBeGreaterThanOrEqual(WATER_CLEARANCE_M - 0.02);
    expect(c.tunnelStations).toBeGreaterThan(1000);
    expect(c.minCoverM).toBeGreaterThanOrEqual(6.7 - 0.02);
    expect(el.crossfall.limited).toBeGreaterThan(3000);
    expect(el.crossfall.violations).toBe(0);
  }, T);

  it('the ITO flyover against the Phase 0 site result: the decks within 0.3 m; the ramps are listed with their difference', async () => {
    const { heights, lanes, graph } = await baked();
    const proj = projector(plan.origin);
    const rows = [];
    const all = [];
    for (const f of PHASE0.strips) {
      // the strips of the same OSM ways (never the road under the deck), and the split zones they run into
      const edges = new Set(graph.edges.filter((e) => e.pieces.some((p) => f.ways.includes(p.way))).map((e) => e.id));
      const mine = new Set();
      lanes.strips.forEach((s, si) => edges.has(s.edge) && mine.add(si));
      for (const z of lanes.zones) if ([z.parent, z.left, z.right].some((r) => r && mine.has(r[0]))) mine.add(z.strip);
      const cands = [...mine].map((si) => ({ s: lanes.strips[si], si }));
      let worst = 0;
      let sum = 0;
      let n = 0;
      let groundDiff = 0;
      for (const [lat, lon, h, g] of f.pts) {
        const p = proj.toWorld(lat, lon);
        let best = null;
        let bd = 6;
        for (const { s, si } of cands) {
          s.st.forEach((st, i) => {
            const d = Math.hypot(st[0] - p.x, st[1] - p.z);
            if (d < bd) {
              bd = d;
              best = { si, i };
            }
          });
        }
        if (!best) continue;
        const dh = heights.strips[best.si].h[best.i] - h;
        worst = Math.max(worst, Math.abs(dh));
        groundDiff = Math.max(groundDiff, Math.abs(heights.strips[best.si].g[best.i] - g));
        sum += dh;
        n++;
        all.push(Math.abs(dh));
      }
      rows.push({ id: f.id, link: f.link, deck: f.pts.every((p) => p[4] === 2), points: f.pts.length, matched: n, meanM: Math.round((sum / Math.max(1, n)) * 100) / 100, worstM: Math.round(worst * 100) / 100, groundDiffM: Math.round(groundDiff * 100) / 100 });
    }
    all.sort((a, b) => a - b);
    const median = all[all.length >> 1];
    const p90 = all[Math.floor(all.length * 0.9)];
    for (const r of rows) console.log(`[elevation] ITO against Phase 0: ${r.id}${r.deck ? ' (all deck)' : ''}: ${r.matched} of ${r.points} points, mean ${r.meanM} m, worst ${r.worstM} m (ground models differ by ${r.groundDiffM} m at most)`);
    console.log(`[elevation] ITO against Phase 0: ${all.length} points, median ${median.toFixed(2)} m, 90 percent within ${p90.toFixed(2)} m, worst ${all[all.length - 1].toFixed(2)} m`);
    expect(all.length).toBeGreaterThan(440);
    // the two ground models are the same source read two ways
    for (const r of rows) expect(r.groundDiffM).toBeLessThan(0.05);
    // the decks (every strip that is deck from end to end) are within 0.3 m of the Phase 0 heights
    const decks = rows.filter((r) => r.deck);
    expect(decks.length).toBeGreaterThanOrEqual(3);
    for (const r of decks) expect(r.worstM).toBeLessThan(0.3);
    expect(median).toBeLessThan(0.3);
    // the approach ramps differ by more, every difference explained (decisions.md "ITO ramps against Phase 0 (P1-035)"):
    // the block lane model starts the two merges at the ramp feet 30 m and 56 m later than Phase 0 did (the north
    // ramps, and the south one, touch down later; the climbing carriageway follows its pair), and the solver holds the
    // slip road under the loop ramp 0.28 m nearer the ground than Phase 0 lowered it. With both imposed every point is
    // within 0.29 m (measured 2026-11-13)
    expect(all[all.length - 1]).toBeLessThan(1.7);
  }, T);

  it('the railway bridge over Minto Road (Vivekanand Marg) keeps 5.5 m over the road: the road dips for it, and that is listed', async () => {
    const { el, heights, lanes } = await baked();
    const offset = blockFrame(districts, plan.def.block).offset;
    const cut = el.structures.find((s) => s.kind === 'cut' && /Vivekanand Marg/.test(s.name) && s.crosses.includes('railway'));
    expect(cut).toBeDefined();
    expect(cut.sunk).toBeGreaterThan(1.5);
    expect(cut.sunk).toBeLessThan(3.5);
    expect(cut.structureM).toBeGreaterThan(80);
    // measured again from the files: every place a rail passes over Vivekanand Marg
    const at = { x: cut.x - offset.x, z: cut.z - offset.z };
    const rails = heights.rails.filter((r) => r.over && Math.hypot(r.x - at.x, r.z - at.z) < 120);
    expect(rails.length).toBeGreaterThan(3);
    let least = Infinity;
    for (const r of rails) {
      let best = null;
      let bd = 12;
      lanes.strips.forEach((s, si) => {
        if (!/Vivekanand Marg/.test(s.name)) return;
        s.st.forEach((st, i) => {
          const d = Math.hypot(st[0] - r.x, st[1] - r.z);
          if (d < bd) {
            bd = d;
            best = heights.strips[si].h[i];
          }
        });
      });
      if (best !== null) least = Math.min(least, r.h - RAIL_DECK_DEPTH_M - best);
    }
    console.log(`[elevation] Minto Road rail bridge: least headroom ${least.toFixed(2)} m over the road at ${rails.length} rails; the road is ${cut.sunk} m under the ground model over ${cut.structureM} m`);
    // the nearest station is up to 2 m along the road from the rail: 2 m at 6 percent
    expect(least).toBeGreaterThanOrEqual(HEADROOM - 0.15);
  }, T);

  it('every structure is in health.json with its kind, sunk and structureM; the Pragati Maidan tunnel is a tunnel with its cuts', async () => {
    const { el, heights } = await baked();
    expect(el.structures.length).toBeGreaterThan(25);
    expect(heights.structures).toHaveLength(el.structures.length);
    for (const s of el.structures) {
      expect(['deck', 'fill', 'cut', 'tunnel']).toContain(s.kind);
      expect(typeof s.sunk).toBe('number');
      expect(s.sunk).toBeGreaterThanOrEqual(0);
      expect(s.structureM).toBeGreaterThan(0);
      expect(s.id).toMatch(/^S\d+$/);
    }
    // every station off the ground by 2 m or more belongs to a structure: the kinds in the file say so
    let stray = 0;
    heights.strips.forEach((s) => s.h.forEach((h, i) => {
      if (Math.abs(h - s.g[i]) > 2.001 && s.k[i] === 0) stray++;
    }));
    expect(stray).toBe(0);
    const tunnel = el.structures.filter((s) => s.kind === 'tunnel' && /Pragati Maidan Tunnel/.test(s.name)).sort((a, b) => b.structureM - a.structureM)[0];
    expect(tunnel.tunnelM).toBeGreaterThan(2000);
    expect(tunnel.cutM).toBeGreaterThan(300);
    expect(tunnel.sunk).toBeGreaterThan(6.6);
    expect(tunnel.sunk).toBeLessThan(9);
    expect(tunnel.crosses).toContain('railway');
    const ito = el.structures.find((s) => s.kind === 'deck' && /ITO Flyover/.test(s.name));
    expect(ito.structureM).toBeGreaterThan(1200);
    expect(ito.maxAboveM).toBeGreaterThan(6.5);
    expect(ito.maxAboveM).toBeLessThan(8.5);
    expect(ito.openEnds).toBe(0);
    expect(el.structureCounts.deck).toBeGreaterThan(10);
    expect(el.structureCounts.tunnel).toBeGreaterThan(5);
    // the map edge ties: every end is listed; the ones a clearance moved say why
    expect(el.ties.ends).toBeGreaterThan(150);
    expect(el.ties.movedEnds.length).toBe(el.ties.moved);
    for (const t of el.ties.movedEnds) expect(t.why.length).toBeGreaterThan(20);
    console.log(`[elevation] structures: ${JSON.stringify(el.structureCounts)}, ${el.structureM} m; graded ${JSON.stringify(el.graded)}; open ends ${JSON.stringify(el.openEnds)}; ties moved ${el.ties.movedEnds.map((t) => `${t.name || t.strip} ${(t.heightM - t.targetM).toFixed(2)} m`).join(', ')}`);
  }, T);

  it('metro viaducts and foot bridges have heights and clearances in elevation.json (P1-035)', async () => {
    const { el, heights, graph } = await baked();
    const o = el.overhead;
    console.log(`[elevation] overhead: ${JSON.stringify({ ...o, short: o.short.length })}; short: ${o.short.map((x) => `${x.over} over ${x.under} ${x.clearanceM} of ${x.needM} m`).join(', ')}`);
    // the Blue Line's two tracks east of Mandi House (to the Yamuna) and west of Rajiv Chowk
    expect(heights.viaducts.length).toBe(4);
    for (const v of heights.viaducts) {
      expect(v.name).toBe('Blue Line');
      expect(v.profile.length).toBeGreaterThan(20);
      expect(v.maxAboveM).toBeGreaterThan(7.5);
      expect(v.crossings.length).toBeGreaterThan(2);
      expect(v.ends.some((e) => e.kind === 'portal' || e.kind === 'grade')).toBe(true);
      for (const e of v.ends.filter((x) => x.kind !== 'open')) expect(Math.abs(e.h - e.g)).toBeLessThan(0.01);
    }
    expect(heights.viaducts.filter((v) => v.crossings.some((c) => c.kind === 'water' && /Yamuna/.test(c.name)))).toHaveLength(2);
    // what a viaduct cannot clear is listed, never hidden: two tracks over the Bangla Sahib Road junction 190 m from where they leave the ground
    expect(o.viaductShortM).toBeLessThan(0.5);
    for (const x of o.short) expect(x.under).toBe('Bangla Sahib Road');
    expect(heights.footBridges).toHaveLength(graph.features.footBridges.length);
    for (const f of heights.footBridges) {
      expect(Number.isFinite(f.deckH)).toBe(true);
      expect(f.shortM).toBe(0);
      if (!f.solved) expect(f.stairs.length).toBeGreaterThan(0);
    }
    expect(o.footCrossings).toBeGreaterThan(100);
    expect(o.footMinClearanceM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
  }, T);

  it('roads under flyovers are lowered 1 m or less but at Kashmere Gate (listed with its reason); no raised end hangs in the air (P1-035)', async () => {
    const { el } = await baked();
    const sunk = el.structures.filter((s) => (s.kind === 'deck' || s.kind === 'fill') && s.sunk > 1);
    console.log(`[elevation] raised structures over a lowered road: ${el.structures.filter((s) => (s.kind === 'deck' || s.kind === 'fill') && s.sunk > 0.05).map((s) => `${s.name || s.id} ${s.sunk} m`).join(', ')}`);
    // the Kashmere Gate cluster's centre, held down by its tunnel arm 157 m out (harness/data/gate_explanations.json, P1-036)
    expect(sunk.map((s) => s.name)).toEqual([expect.stringMatching(/Hanuman Mandir/)]);
    const explained = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/gate_explanations.json'), 'utf8')).findings.find((f) => /sunk/.test(f.what));
    expect(explained.measured).toMatch(/Hanuman Mandir 1\.72 m/);
    const geeta = el.structures.find((s) => /Geeta Colony/.test(s.name));
    expect(geeta.sunk).toBeLessThanOrEqual(1);
    // its slip goes on past the stage edge raised, and says why
    const slip = el.ties.movedEnds.find((t) => t.strip === 'w175769954.0_0');
    expect(slip.heightM - slip.targetM).toBeGreaterThan(2);
    expect(slip.why).toMatch(/ramp goes on outside the stage/);
    expect(el.openEnds.floating).toBe(0);
  }, T);

  it('uses DECK_DEPTH and the class limits the unit tests name', () => {
    expect(DECK_DEPTH).toBe(1.2);
    expect(HEADROOM).toBe(5.5);
  });
});
