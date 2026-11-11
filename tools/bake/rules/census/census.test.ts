import { describe, expect, it } from 'vitest';
import { Sketch } from '../../testmap';
import { bridgeChains } from './bridges';
import { CATALOGUE, catalogueLines, countByRule, runRules } from './catalogue';
import { onewayPairStats } from './roads';
import { checkProfile } from './terrain';
import { autoProposal } from './types';

const of = <T extends { rule: string }>(issues: T[], rule: string): T[] => issues.filter((i) => i.rule === rule);

describe('rule engine (RE1)', () => {
  it('every rule has an id, an area, a detect function and a confidence, with unique ids', () => {
    const lines = catalogueLines();
    expect(new Set(lines.map((l) => l.id)).size).toBe(CATALOGUE.length);
    for (const r of CATALOGUE) {
      expect(r.id).toMatch(/^R-[A-Z]+-\d\d$/);
      expect(typeof r.detect).toBe('function');
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('R-ROAD-01: a dead end 3 m short of another road is found and is an automatic short join', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'residential' });
    s.way([[50, 60], [50, 3]], { highway: 'residential' });
    const issues = of(runRules(s.ctx()), 'R-ROAD-01');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.note).toBe('gap 3 m');
    const auto = autoProposal(issues[0]!);
    expect(auto?.action).toBe('connect');
    expect(auto?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('R-ROAD-01: a 10 m gap is queued, a driveway stub and a bridge overhead are not issues', () => {
    const s = new Sketch();
    const a = s.node(0, 0);
    const mid = s.node(50, 0);
    const b = s.node(100, 0);
    s.way([a, mid, b], { highway: 'residential' });
    s.way([[20, 60], [20, 10]], { highway: 'residential' }); // 10 m short
    s.way([mid, [56, 8]], { highway: 'service' }); // a stub that leaves the road and stays beside it
    s.way([[80, 40], [80, 2]], { highway: 'residential', bridge: 'yes', layer: '1' }); // ends over the road
    const issues = of(runRules(s.ctx()), 'R-ROAD-01');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.note).toBe('gap 10 m');
    expect(autoProposal(issues[0]!)).toBeNull();
  });

  it('R-ROAD-02: ways that cross on one layer with no shared node; a shared node or another layer is fine', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'tertiary' });
    s.way([[50, -40], [50, 40]], { highway: 'residential' }); // crosses, no node
    s.way([[70, -40], [70, 40]], { highway: 'residential', bridge: 'yes', layer: '1' }); // flies over
    const n = s.node(20, 0);
    s.elements.find((e) => e.type === 'way' && e.id === 100)!.nodes!.splice(1, 0, n);
    s.way([[20, -40], n, [20, 40]], { highway: 'residential' }); // proper junction
    const issues = of(runRules(s.ctx()), 'R-ROAD-02');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.features).toEqual(['way/100', 'way/101']);
    expect(issues[0]!.x).toBeCloseTo(50);
    expect(autoProposal(issues[0]!)).toBeNull();
  });

  it('R-ROAD-04: a one-way with its opposite pair passes, a lone one-way is listed once per street', () => {
    const s = new Sketch();
    s.way([[0, 0], [200, 0]], { highway: 'primary', oneway: 'yes', name: 'Paired Marg' });
    s.way([[200, 14], [0, 14]], { highway: 'primary', oneway: 'yes', name: 'Paired Marg' });
    s.way([[0, 300], [120, 300]], { highway: 'secondary', oneway: 'yes', name: 'Lone Road' });
    s.way([[120, 300], [240, 300]], { highway: 'secondary', oneway: 'yes', name: 'Lone Road' });
    const ctx = s.ctx();
    const issues = of(runRules(ctx), 'R-ROAD-04');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.note).toContain('Lone Road');
    expect(onewayPairStats(ctx.map)).toMatchObject({ candidates: 4, paired: 2 });
  });

  it('R-BRIDGE-01: a bridge with no layer is an automatic tag fix; an end with no road beyond is queued', () => {
    const s = new Sketch();
    const a = s.node(0, 0);
    const b = s.node(60, 0);
    const c = s.node(120, 0);
    s.way([[-80, 0], a], { highway: 'primary' });
    s.way([a, b], { highway: 'primary', bridge: 'yes' });
    s.way([b, c], { highway: 'primary', bridge: 'yes' }); // c has nothing after it
    const ctx = s.ctx();
    expect(bridgeChains(ctx.map)).toHaveLength(1);
    expect(bridgeChains(ctx.map)[0]!.length).toBeCloseTo(120);
    const issues = of(runRules(ctx), 'R-BRIDGE-01');
    expect(issues.map((i) => i.note).sort()).toEqual(['bridge of 120 m with no layer tag', 'the 120 m bridge ends with no road beyond it']);
    expect(issues.filter((i) => autoProposal(i) !== null)).toHaveLength(1);
  });

  it('R-BRIDGE-02: a ground road that meets a deck inside its span is a ramp in the air', () => {
    const s = new Sketch();
    const a = s.node(0, 0);
    const m = s.node(60, 0);
    const b = s.node(120, 0);
    s.way([[-50, 0], a], { highway: 'trunk' });
    s.way([a, m, b], { highway: 'trunk', bridge: 'yes', layer: '1' });
    s.way([b, [170, 0]], { highway: 'trunk' });
    s.way([[60, -40], m], { highway: 'trunk_link' });
    const issues = runRules(s.ctx());
    expect(of(issues, 'R-BRIDGE-02')).toHaveLength(1);
    expect(of(issues, 'R-BRIDGE-01')).toHaveLength(0);
  });

  it('R-BLDG-01: a sliver into a class-default width is automatic, a centre line through a building is queued', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'residential' }); // 5.5 m by class: edge at 2.75 m
    s.building([[10, 2], [20, 2], [20, 12], [10, 12]]); // 0.75 m into the carriageway
    s.building([[60, -4], [70, -4], [70, 6], [60, 6]]); // the road runs through it
    s.building([[30, 6], [40, 6], [40, 16], [30, 16]]); // clear
    const issues = of(runRules(s.ctx()), 'R-BLDG-01');
    expect(issues).toHaveLength(2);
    const sliver = issues.find((i) => i.note.includes('0.8 m into'))!;
    expect(autoProposal(sliver)?.params).toMatchObject({ key: 'width', value: '3.6' });
    expect(autoProposal(issues.find((i) => i !== sliver)!)).toBeNull();
  });

  it('R-BLDG-03: an exact duplicate is removed automatically, a nested footprint is queued', () => {
    const s = new Sketch();
    s.building([[0, 0], [10, 0], [10, 10], [0, 10]], { name: 'kept' });
    s.building([[0, 0], [10, 0], [10, 10], [0, 10]]);
    s.building([[40, 0], [60, 0], [60, 20], [40, 20]]);
    s.building([[44, 4], [50, 4], [50, 10], [44, 10]]);
    const issues = of(runRules(s.ctx()), 'R-BLDG-03');
    expect(issues).toHaveLength(2);
    const exact = issues.find((i) => i.note === 'exact duplicate')!;
    expect(autoProposal(exact)?.params).toMatchObject({ drop: 'way/101' });
    expect(autoProposal(issues.find((i) => i !== exact)!)).toBeNull();
  });

  it('R-TERR-03: a roof left in the height data shows as an outlier along the road', () => {
    const s = new Sketch();
    s.way([[0, 0], [300, 0]], { highway: 'secondary' });
    s.way([[0, 100], [300, 100]], { highway: 'secondary' });
    const ground = (x: number, z: number) => 210 + x * 0.002 + (z === 0 && x > 140 && x < 160 ? 6 : 0);
    const issues = of(runRules(s.ctx(ground)), 'R-TERR-03');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.features).toEqual(['way/100']);
    expect(checkProfile([210, 210, 210, 216, 210, 210, 210]).outliers).toBe(2);
    expect(of(runRules(s.ctx()), 'R-TERR-03')).toHaveLength(0);
  });

  it('the same input gives the same issues, and the counts add up', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'residential' });
    s.way([[50, 60], [50, 3]], { highway: 'residential' });
    s.building([[10, 2], [20, 2], [20, 12], [10, 12]]);
    const a = runRules(s.ctx());
    const b = runRules(s.ctx());
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    const counts = countByRule(a);
    expect(counts.reduce((n, c) => n + c.issues, 0)).toBe(a.length);
    for (const c of counts) expect(c.auto + c.queued).toBe(c.issues);
    for (const i of a) expect(i.id.startsWith(`${i.rule}:`)).toBe(true);
  });
});
