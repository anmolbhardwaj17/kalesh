// The rule catalogue and auto-repair on the pilot centre graph (P1-010 acceptance), from the pinned stage files in
// data/pilot_centre/ (gitignored; the test skips with the reason when they are missing). It reads the bake through the
// repair step with no overrides (tools/testkit/sharedbake.mjs repairBaseline, kept between runs) and checks: counts by
// rule, proposals on every queued issue, one log line per applied repair, a second run that applies nothing. The rest
// of the repair acceptance is in pilot_repair_rules.test.mjs (every rule twice, the whole repair on its own) and
// pilot_repair_pick.test.mjs (an owner pick through the inspector into the next bake).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repairBaseline, sharedBake } from '../../testkit/sharedbake.mjs';
import { CATALOGUE } from '../rules/catalogue.ts';
import { stagePlan } from '../layout/stages.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

/** What P1-010 asked for; since P1-030 (auto-repair everything basic) the pilot centre gives about 98 percent. */
const ASKED_AUTO_SHARE = 0.65;
/** The owner queue of P1-030: at most this many sites over the whole pilot, each a genuine question. */
const OWNER_QUEUE_MAX = 50;

describe.skipIf(missing.length > 0)(`pilot centre repair${reason ? ` (skipped: ${reason})` : ''}`, () => {
  const baked = () => repairBaseline();
  const T = 1800000;

  it('the report lists counts by rule, and the driver stops on no repair invariant', async () => {
    const { report, health, lines } = await baked();
    expect(report.steps.slice(0, 4)).toEqual(['sources', 'ground', 'graph', 'repair']);
    expect(report.stoppedBeforeTiles).toBe(false);
    const s = health.repair.summary;
    expect(s.byRule.map((r) => r.rule)).toEqual(CATALOGUE.map((r) => r.id));
    expect(s.byRule.reduce((n, r) => n + r.issues, 0)).toBe(s.total);
    expect(s.auto + s.queued + s.explained).toBe(s.total);
    expect(health.issues.total).toBe(s.total);
    expect(health.repairs.auto).toBe(s.auto);
    for (const r of s.byRule.filter((x) => x.issues > 0)) expect(health.issues.byRule[r.rule]).toBe(r.issues);
    expect(lines.filter((l) => l.startsWith('[repair] R-')).length).toBe(s.byRule.filter((r) => r.issues > 0).length);
    console.log(`[pilot repair] ${s.total} issues: ${s.auto} repaired on their own (${(s.autoShare * 100).toFixed(1)} percent, ${(s.autoShareOfChanged * 100).toFixed(1)} percent of repaired plus queued, ${(s.withoutTerrainOutliers.autoShare * 100).toFixed(1)} percent without R-TERR-03), ${s.queued} queued (${s.highImpact} high impact), ${s.explained} explained`);
    console.log(`[pilot repair] by rule: ${s.byRule.filter((r) => r.issues).map((r) => `${r.rule} ${r.issues} (${r.auto} auto, ${r.queued} queued, ${r.explained} explained)`).join('; ')}`);
  }, T);

  it(`repairs most issues on its own (the acceptance asks ${ASKED_AUTO_SHARE * 100} percent; the measured share is printed and recorded)`, async () => {
    const { health } = await baked();
    const s = health.repair.summary;
    // Measured 2026-11-11: 53.4 percent with the signed bounds alone. Since P1-030 the bake settles everything basic
    // itself (the gali rule, buildings that give way, dead ends by geometry, the policy table): 97.8 percent with no
    // override patch, and what is left goes to the top-view judge pass.
    expect(s.autoShare).toBeGreaterThan(ASKED_AUTO_SHARE);
    expect(s.autoShare).toBeGreaterThan(0.95);
    expect(s.decidedPolicy).toBeGreaterThan(100);
    // every rule of the bounds list that can repair did repair something on the pilot, or found nothing
    const by = Object.fromEntries(s.byRule.map((r) => [r.rule, r]));
    for (const id of ['R-ROAD-01', 'R-LANE-FIT-01', 'R-LANE-FIT-03', 'R-BLDG-01', 'R-TERR-03']) expect(by[id].auto).toBeGreaterThan(0);
    // never automatic: one-way streets with no pair and roads that leave the stage are explained, hero issues queued
    expect(by['R-ROAD-04']).toMatchObject({ auto: 0, queued: 0 });
    expect(by['R-ROAD-04'].explained).toBeGreaterThan(10);
    // a hero road takes its own spec on its own; a listed road with no spec yet is planned work (explained)
    for (const id of ['R-HERO-01', 'R-HERO-03', 'R-HERO-04']) expect(by[id].auto).toBe(0);
    expect(by['R-HERO-01'].queued).toBe(0);
    // no building is left on a road as a question, and every dead end is decided or goes to the judge pass
    expect(by['R-BLDG-01']).toMatchObject({ queued: 0 });
    expect(by['R-BLDG-01'].auto).toBe(by['R-BLDG-01'].issues);
  }, T);

  it('every queued issue has a proposal with a confidence, a reasoning line and a preview polyline; before the judge pass the queue is already near the owner limit', async () => {
    const { issues, health } = await baked();
    expect(issues.version).toBe(1);
    expect(Object.keys(issues.rules)).toEqual(CATALOGUE.map((r) => r.id));
    expect(issues.issues.length).toBe(health.repair.summary.total);
    expect(new Set(issues.issues.map((i) => i.id)).size).toBe(issues.issues.length);
    const queued = issues.issues.filter((i) => i.status === 'open');
    expect(queued.length).toBe(health.repair.summary.queued);
    // with no override patch at all (no judge pass, no owner pick) the rules leave about 53 sites: what the top view decides
    expect(queued.length).toBeLessThanOrEqual(OWNER_QUEUE_MAX + 10);
    for (const i of queued) {
      expect(i.proposals.length).toBeGreaterThan(0);
      for (const p of i.proposals) {
        expect(p.confidence).toBeGreaterThan(0);
        expect(p.confidence).toBeLessThanOrEqual(1);
        expect(p.reasoning.length).toBeGreaterThan(10);
        expect(p.preview.length).toBeGreaterThan(0);
        for (const q of p.preview) expect(Number.isFinite(q.x) && Number.isFinite(q.z)).toBe(true);
      }
    }
    expect(health.repair.queuedWithoutProposal).toBe(0);
    for (const i of issues.issues) {
      expect(['open', 'auto_repaired', 'explained']).toContain(i.status);
      expect(i.block).toBe('centre');
      expect(i.tile).toHaveLength(2);
      // the one hero road with a spec file is frozen: only its own spec and fixes that leave the road alone apply
      if (i.hero === 'cp_inner_circle' && i.status === 'auto_repaired') expect(['R-HERO-02', 'R-BLDG-01', 'R-TERR-03', 'R-BLDG-03', 'R-ROAD-01']).toContain(i.rule);
      if (i.decided) expect(i.decision.length).toBeGreaterThan(10);
    }
    // issues inside a focus district carry its id
    expect(new Set(issues.issues.map((i) => i.district)).size).toBeGreaterThan(2);
  }, T);

  it('repairs.jsonl has one line per applied repair with before and after, and a second run applies 0 new repairs', async () => {
    const { repairs, issues, health } = await baked();
    // one line per applied patch: a building on a road that a later shift moved under it again has two (the footpath
    // or lane gave way, then the building), and an issue the policy settled whose patch had nothing left to change has none
    const auto = new Map(issues.issues.filter((i) => i.status === 'auto_repaired').map((i) => [i.id, i]));
    const lines = new Set(repairs.map((r) => r.issue));
    for (const id of lines) expect(auto.has(id)).toBe(true);
    const noLine = [...auto.values()].filter((i) => !lines.has(i.id));
    expect(noLine.length).toBeLessThan(10);
    for (const i of noLine) expect(i.decided).toBe('policy');
    expect(repairs.length - lines.size).toBeLessThan(30);
    expect(repairs.filter((r) => r.decided).length).toBe(health.repair.summary.decidedPolicy - noLine.length);
    for (const r of repairs) {
      expect(r.rule && r.issue && r.patch && r.before && r.after).toBeTruthy();
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
      expect(r.patch.issue).toBe(r.issue);
      expect(Object.keys(r.before).length).toBeGreaterThan(0);
      expect(Object.keys(r.after).length).toBeGreaterThan(0);
    }
    expect(health.repair.secondRunRepairs).toBe(0);
    expect(health.repair.summary.unconverged).toBe(0);
    expect(health.invariants.filter((x) => x.id.startsWith('REPAIR-')).map((x) => [x.id, x.ok])).toEqual([['REPAIR-01.fixed_point', true], ['REPAIR-02.proposals', true], ['REPAIR-03.topology', true]]);
  }, T);

  it('P1-030: after the judge pass the owner queue is at most 50, no building is left on a road, every dead end and overlap is settled', async () => {
    const { health } = await sharedBake();
    const d = health.decisions;
    console.log(`[pilot repair] owner queue ${d.ownerQueue} (policy ${d.byPolicy}, judge ${d.byJudge}); buildings ${JSON.stringify(d.buildings)}; cleared ${JSON.stringify(health.buildings.counts)}; overlaps ${JSON.stringify(d.overlaps)}; dead ends ${JSON.stringify(d.deadEnds)}`);
    expect(d.ownerQueue).toBeLessThanOrEqual(OWNER_QUEUE_MAX);
    expect(health.counts.leftOpen).toBe(d.ownerQueue);
    expect(d.buildings.unresolved).toBe(0);
    expect(d.buildings.roadGaveWay + d.buildings.footpathGaveWay + d.buildings.buildingGivesWay).toBe(d.buildings.issues);
    // measured on the road mesh: every footprint that stood on a road face was moved, cut, cut in two or dropped
    const c = health.buildings.counts;
    expect(c.shifted + c.trimmed + c.split + c.dropped).toBe(c.onRoad);
    expect(health.buildings.left).toMatchObject({ count: 0, areaM2: 0 });
    expect(health.invariants.find((x) => x.id === 'BLDG-01.off_the_road').ok).toBe(true);
    expect(d.overlaps.unresolved).toBe(0);
    expect(d.overlaps.mergedZones.merges + d.overlaps.mergedZones.diverges).toBeGreaterThan(100);
    expect(d.deadEnds.unresolved).toBe(0);
    expect(d.deadEnds.connectedByRule + d.deadEnds.connectedByJudge).toBeGreaterThan(40);
    // every judge patch found its issue and went in
    const judge = health.overrides.records.filter((r) => r.by === 'judge');
    expect(judge.length).toBeGreaterThan(40);
    expect(judge.filter((r) => r.outcome !== 'fixed' && r.outcome !== 'kept')).toEqual([]);
  }, T);
});
