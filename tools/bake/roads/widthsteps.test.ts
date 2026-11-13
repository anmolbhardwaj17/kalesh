// Road width continuity (P1-046) on small sketches: the corridor step of the lane count inference (a street with no
// count of its own takes the count of the road it runs on into through a junction, not a class default), the width
// step check, the tapers the lane model builds across a junction where the width changes, and a short road between
// two junctions that takes the corridor's section whole. The pilot centre is checked by the bake (LANES-06).
import { describe, expect, it } from 'vitest';
import { taggedLanes } from '../graph/classify';
import { Sketch } from '../testmap';
import { checkTapers } from './checks';
import { classDefaults, csBorders, csWidth, lane } from './model';
import type { CrossSection, Strip } from './model';
import { laneGraph } from './laneout';
import { buildLaneModel } from './network';
import type { LaneBuild, LaneModelInput } from './network';
import { sectionFor, withDrive } from './netwidths';
import { inferStreets } from './street';
import { carriagewayWidth, checkWidthSteps, pairedOf } from './widthsteps';

const wayLanesOf = (s: Sketch): Map<string, number> => {
  const out = new Map<string, number>();
  for (const e of s.elements) {
    if (e.type !== 'way' || !e.tags?.['highway']) continue;
    const n = taggedLanes(e.tags);
    if (n !== null) out.set(`way/${e.id}`, n);
  }
  return out;
};
const build = (s: Sketch, extra: Partial<LaneModelInput> = {}): LaneBuild => {
  const g = s.graph(500);
  return buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: wayLanesOf(s), ...extra });
};
const steps = (b: LaneBuild): number => checkWidthSteps(b.strips, b.joints, b.junctions, pairedOf(b.road.source)).steps;
const stripsOf = (b: LaneBuild, way: number): Strip[] => b.strips.filter((s) => s.edge.startsWith(`w${way}.`));
const drive = (s: Strip): number => s.lanes.filter((l) => l.type === 'drive').length;

/** A road going east through a junction at x = 0 (a side street goes north there): two ways with their own tags. */
const through = (west: Record<string, string>, east: Record<string, string>, eastLen = 300, turnDeg = 0): { s: Sketch; w: number; e: number } => {
  const s = new Sketch();
  const a = s.node(-300, 0);
  const j = s.node(0, 0);
  const t = (turnDeg * Math.PI) / 180;
  const b = s.node(Math.round(eastLen * Math.cos(t)), Math.round(eastLen * Math.sin(t)));
  const w = s.way([a, j], west);
  const e = s.way([j, b], east);
  s.way([j, [0, 150]], { highway: 'residential' });
  return { s, w, e };
};

describe('the corridor step of the lane counts', () => {
  it('a street with no count of its own takes the count and lane width of the road it runs on into, not its class default', () => {
    const { s, w, e } = through({ highway: 'secondary', oneway: 'yes', name: 'North Marg', lanes: '3' }, { highway: 'secondary', oneway: 'yes', name: 'South Marg' });
    const r = inferStreets(s.graph(500), wayLanesOf(s));
    expect(r.byEdge.get(`w${w}.0`)).toMatchObject({ lanes: 3, from: 'tag' });
    // two names: two streets, one corridor (same class, straight on through the junction)
    expect(r.byEdge.get(`w${e}.0`)!.street).not.toBe(r.byEdge.get(`w${w}.0`)!.street);
    expect(r.byEdge.get(`w${e}.0`)).toMatchObject({ lanes: 3, from: 'corridor' });
    expect(classDefaults('secondary').oneWay).toBe(2);
  });
  it('a road that turns away more than 20 degrees, or of another class and name, is another corridor and keeps its default', () => {
    const bent = through({ highway: 'secondary', oneway: 'yes', name: 'North Marg', lanes: '3' }, { highway: 'secondary', oneway: 'yes', name: 'South Marg' }, 300, 30);
    expect(inferStreets(bent.s.graph(500), wayLanesOf(bent.s)).byEdge.get(`w${bent.e}.0`)).toMatchObject({ lanes: 2, from: 'class' });
    const other = through({ highway: 'secondary', oneway: 'yes', name: 'North Marg', lanes: '3' }, { highway: 'tertiary', oneway: 'yes', name: 'Gali Road' });
    expect(inferStreets(other.s.graph(500), wayLanesOf(other.s)).byEdge.get(`w${other.e}.0`)).toMatchObject({ lanes: 2, from: 'class' });
  });
  it('the same name carries through a change of class', () => {
    const { s, e } = through({ highway: 'secondary', name: 'Long Marg', lanes: '6' }, { highway: 'tertiary', name: 'Long Marg' });
    expect(inferStreets(s.graph(500), wayLanesOf(s)).byEdge.get(`w${e}.0`)).toMatchObject({ lanes: 6, from: 'corridor' });
  });
});

describe('the width step check', () => {
  it('finds the step a junction leaves between a 4 lane and a 2 lane road of one name when the width rounds are off', () => {
    const { s } = through({ highway: 'secondary', name: 'Long Marg', lanes: '4' }, { highway: 'secondary', name: 'Long Marg', lanes: '2' });
    const off = build(s, { widthContinuity: false });
    const c = checkWidthSteps(off.strips, off.joints, off.junctions);
    // (the street's own widening at the junction is a taper too: it is the width rounds that make every step a taper)
    expect(c.corridors).toBeGreaterThan(0);
    expect(c.list.every((x) => x.kind === 'junction')).toBe(true);
  });
  it('measures the carriageway between the kerbs: footpaths, kerbs and medians do not count', () => {
    const lanes = [lane('footpath', 2), lane('kerb', 0.3), lane('drive', 3.3, 1), lane('drive', 3.3, -1), lane('kerb', 0.3), lane('footpath', 2)];
    const cs: CrossSection = { lanes, offset: 5.6 };
    expect(carriagewayWidth(lanes, csBorders(cs))).toBeCloseTo(6.6, 9);
    expect(csWidth(cs)).toBeCloseTo(11.2, 9);
  });
});

describe('tapers across a junction', () => {
  it('a gali against a two-lane road: the road narrows to the gali at the junction over the length its class asks, no step left', () => {
    const { s, w, e } = through({ highway: 'residential', width: '2' }, { highway: 'residential' });
    const b = build(s);
    expect(steps(b)).toBe(0);
    expect(stripsOf(b, w).every((st) => st.lanes.some((l) => l.tag === 'gali'))).toBe(true);
    const east = stripsOf(b, e);
    const first = east[0] as Strip;
    expect(first.kind).toBe('taper');
    // at the junction the road is as wide as the gali, then it widens to its two lanes
    expect(carriagewayWidth(first.lanes, first.st[0]!.b)).toBeCloseTo(2, 1);
    expect(carriagewayWidth(first.lanes, first.st[first.st.length - 1]!.b)).toBeCloseTo(6, 1);
    expect(b.widthFixes.tapers.some((t) => t.edge === `w${e}.0` && t.atStart)).toBe(true);
    expect(checkTapers(b.strips).violations).toBe(0);
  });
  it('a wider road on the far side: the narrower one widens to it before the junction; the taper keeps the class ratio (1:20 for a secondary)', () => {
    const { s, w, e } = through({ highway: 'secondary', name: 'Long Marg', lanes: '4' }, { highway: 'secondary', name: 'Long Marg', lanes: '2' }, 400);
    const b = build(s);
    expect(steps(b)).toBe(0);
    expect(classDefaults('secondary').taper).toBe(20);
    expect(stripsOf(b, w).every((st) => drive(st) === 4)).toBe(true);
    const taper = stripsOf(b, e).find((st) => st.kind === 'taper') as Strip;
    expect(taper.taper!.length).toBeGreaterThanOrEqual(20 * taper.taper!.shift * 0.98 - 0.05);
    expect(checkTapers(b.strips).violations).toBe(0);
  });
  it('in the lane graph a lane that tapers to nothing runs on into the lane beside it, so no traffic lane just ends', () => {
    const { s } = through({ highway: 'secondary', name: 'Long Marg', lanes: '4' }, { highway: 'secondary', name: 'Long Marg', lanes: '2' }, 400);
    const b = build(s);
    const g = laneGraph(b, 'test', { x: 0, z: 0 });
    const byId = new Map(g.lanes.map((l) => [l.id, l]));
    let dropped = 0;
    b.strips.forEach((st, si) => {
      if (st.kind !== 'taper') return;
      st.lanes.forEach((l, k) => {
        if (l.type !== 'drive' || l.dir === 0) return;
        const out = (l.dir === 1 ? st.st[st.st.length - 1] : st.st[0])!;
        if (out.b[k]! - out.b[k + 1]! >= 0.05) return;
        dropped++;
        expect(byId.get(`s${si}.${k}`)!.next.length).toBeGreaterThan(0);
      });
    });
    expect(dropped).toBeGreaterThan(0);
  });
  it('a short road between two long ones: the long roads narrow to it at both junctions, each over its class length', () => {
    const s = new Sketch();
    const n = [-400, 0, 25, 425].map((x) => s.node(x, 0));
    // (the short road has a name of its own: the street rule of street.ts does not reach it, the width step does)
    const ways = [0, 1, 2].map((i) => s.way([n[i]!, n[i + 1]!], { highway: 'secondary', name: i === 1 ? 'Short Marg' : 'Long Marg', lanes: i === 1 ? '2' : '4' }));
    s.way([n[1]!, [0, 150]], { highway: 'residential' });
    s.way([n[2]!, [25, -150]], { highway: 'residential' });
    const b = build(s);
    expect(steps(b)).toBe(0);
    expect(b.widthFixes.tapers.map((t) => [t.edge, t.atStart, t.lanes])).toEqual([[`w${ways[0]}.0`, false, 2], [`w${ways[2]}.0`, true, 2]]);
    expect(checkTapers(b.strips).violations).toBe(0);
  });
  it('where neither road has room for a taper, the shorter one takes the section of the other whole', () => {
    const s = new Sketch();
    const n = [-40, 0, 25, 425].map((x) => s.node(x, 0));
    const ways = [0, 1, 2].map((i) => s.way([n[i]!, n[i + 1]!], { highway: 'secondary', name: i === 1 ? 'Short Marg' : 'Long Marg', lanes: i === 1 ? '2' : '4' }));
    s.way([n[1]!, [0, 150]], { highway: 'residential' });
    s.way([n[2]!, [25, -150]], { highway: 'residential' });
    const b = build(s);
    expect(steps(b)).toBe(0);
    expect(b.widthFixes.whole).toContainEqual(expect.objectContaining({ edge: `w${ways[1]}.0`, lanes: 4 }));
    expect(stripsOf(b, ways[1]!).every((st) => drive(st) === 4)).toBe(true);
  });
  it('builds the same model twice', () => {
    const { s } = through({ highway: 'residential', width: '2' }, { highway: 'residential' });
    const a = build(s);
    const c = build(s);
    expect(JSON.stringify(a.strips)).toBe(JSON.stringify(c.strips));
    expect(a.widthFixes).toEqual(c.widthFixes);
  });
});

describe('sections for a width', () => {
  it('lanes of at least a drive lane, a gali only on the classes whose narrow stretches are galis', () => {
    expect(sectionFor('secondary', false, 13.2, 4)).toEqual({ lanes: 4, laneWidth: 3.3, gali: false });
    expect(sectionFor('secondary', false, 6.6, 4)).toEqual({ lanes: 2, laneWidth: 3.3, gali: false });
    expect(sectionFor('residential', false, 2, 1)).toEqual({ lanes: 1, laneWidth: 2, gali: true });
    expect(sectionFor('secondary', false, 2, 1)).toBeNull();
    expect(sectionFor('secondary', false, 14, 2)?.lanes).toBe(4);
  });
  it('withDrive keeps the edge lanes and the drive centre, or the right border of a paired carriageway', () => {
    const own: CrossSection = { lanes: [lane('footpath', 2), lane('kerb', 0.3), lane('drive', 3.3, 1), lane('drive', 3.3, 1), lane('median', 0.3)], offset: 5.6 };
    const wide = withDrive(own, { lanes: 3, laneWidth: 3.3, gali: false });
    expect(wide.lanes.map((l) => l.type)).toEqual(['footpath', 'kerb', 'drive', 'drive', 'drive', 'median']);
    const ob = csBorders(own);
    const wb = csBorders(wide);
    // the drive lanes keep their centre
    expect((wb[2]! + wb[5]!) / 2).toBeCloseTo((ob[2]! + ob[4]!) / 2, 9);
    const kerbSide = withDrive(own, { lanes: 3, laneWidth: 3.3, gali: false, rightAt: own.offset - csWidth(own) });
    const kb = csBorders(kerbSide);
    expect(kb[kb.length - 1]).toBeCloseTo(ob[ob.length - 1]!, 9);
  });
});
