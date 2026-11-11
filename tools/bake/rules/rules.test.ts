// The production rule catalogue on small synthetic maps (tools/bake/testmap.ts): for every rule id one map that the
// rule detects and one clean map, the fixed order, and a file for every rule area of MAP_REPAIR.md "Rule engine".
// Bounds, the repair log and the fixed point are tested in tools/bake/repair/repair.test.ts; the pilot centre in
// tools/bake/repair/pilot_repair.test.mjs.
import { describe, expect, it } from 'vitest';
import raw from '../../../harness/data/hero_roads/cp_inner_circle.json?raw';
import type { BlockGraph } from '../graph/build';
import type { HeroSpec } from '../roads/hero';
import { Sketch, rulesOn } from '../testmap';
import { AREA_FILES, CATALOGUE, catalogueLines, countByRule, runRules, timeRules } from './catalogue';
import { junctionClusters } from './junctions';
import { splits } from './lanes';
import { checkProfile } from './terrain';
import type { Issue, Marks, RuleEnv } from './types';

const spec = JSON.parse(raw) as HeroSpec;
const FILES = import.meta.glob(['/tools/bake/rules/*.ts', '/tools/bake/layout/gate.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Case {
  s: Sketch;
  env?: Partial<RuleEnv> | ((g: BlockGraph) => Partial<RuleEnv>);
  marks?: (g: BlockGraph) => Marks;
}

function issuesOf(rule: string, c: Case): Issue[] {
  const g = c.s.graph();
  const env = typeof c.env === 'function' ? c.env(g) : c.env;
  return runRules(rulesOn(g, { nodeTags: c.s.nodeTags(), ...env }, c.marks ? c.marks(g) : {})).filter((i) => i.rule === rule);
}

const sketch = (draw: (s: Sketch) => void): Sketch => {
  const s = new Sketch();
  draw(s);
  return s;
};

/** A street cut into edges at side streets: [x0, x1, ...] along north 0, with the tags of each piece. */
function street(s: Sketch, xs: number[], tags: Record<string, string>[], base: Record<string, string>): void {
  const nodes = xs.map((x) => s.node(x, 0));
  for (let i = 0; i + 1 < nodes.length; i++) s.way([nodes[i]!, nodes[i + 1]!], { ...base, ...tags[i] });
  for (let i = 1; i + 1 < nodes.length; i++) s.way([nodes[i]!, [xs[i]!, 90]], { highway: 'residential' });
}

/** A one-way trunk road that a slip road leaves at (0, 0); `slip` are the slip road's points after the node. */
function diverge(s: Sketch, slip: [number, number][], mainOut: Record<string, string> = {}, single: Record<string, string> = {}): void {
  const n = s.node(0, 0);
  s.way([[-300, 0], n], { highway: 'trunk', oneway: 'yes', name: 'Ring Road', ...single });
  s.way([n, [300, 0]], { highway: 'trunk', oneway: 'yes', name: 'Ring Road', ...mainOut });
  s.way([n, ...slip], { highway: 'trunk_link', oneway: 'yes' });
}

/** A flyover along north 0 over a street at x 0, with side streets where the road is at grade again. */
function flyover(s: Sketch, grade: number, extra: (s: Sketch, deck: number) => void = () => undefined): void {
  const a = s.node(-100, 0);
  const b = s.node(100, 0);
  const deck = s.node(20, 0);
  const west = s.node(-grade, 0);
  const east = s.node(grade, 0);
  s.way([[-400, 0], west, a], { highway: 'primary', name: 'Flyover Marg' });
  s.way([a, deck, b], { highway: 'primary', name: 'Flyover Marg', bridge: 'yes', layer: '1' });
  s.way([b, east, [400, 0]], { highway: 'primary', name: 'Flyover Marg' });
  s.way([west, [-grade, 120]], { highway: 'residential' });
  s.way([east, [grade, 120]], { highway: 'residential' });
  s.way([[0, -150], [0, 150]], { highway: 'tertiary' });
  extra(s, deck);
}

const heroList = [{ id: 'janpath', name: 'Janpath', osmNames: ['Janpath'] }];

const CASES: Record<string, { hit: () => Case; clean: () => Case; also?: (issues: Issue[]) => void }> = {
  'R-ROAD-01': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [100, 0]], { highway: 'residential' }); s.way([[50, 60], [50, 3]], { highway: 'residential' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [100, 0]], { highway: 'residential' }); s.way([[50, 60], [50, 30]], { highway: 'residential' }); s.way([[80, 40], [80, 2]], { highway: 'residential', bridge: 'yes', layer: '1' }); }) }),
    also: (i) => { expect(i[0]!.note).toBe('gap 3 m'); expect(i[0]!.proposals.map((p) => p.action)).toEqual(['connect', 'terminate']); },
  },
  'R-ROAD-02': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [100, 0]], { highway: 'tertiary' }); s.way([[50, -40], [50, 40]], { highway: 'residential' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [100, 0]], { highway: 'tertiary' }); s.way([[50, -40], [50, 40]], { highway: 'residential', bridge: 'yes', layer: '1' }); const n = s.node(20, 0); s.way([[20, -40], n, [20, 40]], { highway: 'residential' }); s.way([[-50, 0], n], { highway: 'tertiary' }); }) }),
    also: (i) => { expect(i[0]!.x).toBeCloseTo(50); expect(i[0]!.z).toBeCloseTo(0); },
  },
  'R-ROAD-03': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [200, 0]], { highway: 'residential' }); s.way([[20, 0.5], [180, 0.5]], { highway: 'service' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [200, 0]], { highway: 'residential' }); s.way([[20, 8], [180, 8]], { highway: 'service' }); }) }),
  },
  'R-ROAD-04': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 300], [240, 300]], { highway: 'secondary', oneway: 'yes', name: 'Lone Road' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[-300, 8], [300, 8]], { highway: 'secondary', oneway: 'yes', name: 'Paired Marg' }); s.way([[300, -8], [-300, -8]], { highway: 'secondary', oneway: 'yes', name: 'Paired Marg' }); }) }),
    also: (i) => { expect(i[0]!.status).toBe('explained'); expect(i[0]!.note).toContain('Lone Road'); },
  },
  'R-ROAD-05': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [200, 0]], { highway: 'primary', lanes: '4', width: '5' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [200, 0]], { highway: 'primary', lanes: '2', width: '7' }); }) }),
  },
  'R-ROAD-06': {
    hit: () => ({ s: sketch((s) => street(s, [0, 20, 45], [{ lanes: '2' }, { lanes: '4' }], { highway: 'secondary', name: 'X Marg' })) }),
    clean: () => ({ s: sketch((s) => street(s, [0, 20, 45], [{ lanes: '2' }, { lanes: '2' }], { highway: 'secondary', name: 'X Marg' })) }),
  },
  'R-ROAD-07': {
    hit: () => ({ s: sketch((s) => { s.way([[-200, 4.5], [200, 4.5]], { highway: 'secondary', oneway: 'yes', name: 'Shivaji Flyover' }); s.way([[200, -4.5], [-200, -4.5]], { highway: 'secondary', oneway: 'yes', name: 'Maharaja Ranjeet Singh Marg' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[-200, 4.5], [200, 4.5]], { highway: 'secondary', oneway: 'yes', name: 'Tilak Marg' }); s.way([[200, -4.5], [-200, -4.5]], { highway: 'secondary', oneway: 'yes', name: 'Tilak Road' }); }) }),
  },
  'R-BRIDGE-01': {
    hit: () => ({ s: sketch((s) => { const a = s.node(0, 0); const b = s.node(60, 0); s.way([[-80, 0], a], { highway: 'primary' }); s.way([a, b], { highway: 'primary', bridge: 'yes' }); s.way([b, [140, 0]], { highway: 'primary' }); }) }),
    clean: () => ({ s: sketch((s) => { const a = s.node(0, 0); const b = s.node(60, 0); s.way([[-80, 0], a], { highway: 'primary' }); s.way([a, b], { highway: 'primary', bridge: 'yes', layer: '1' }); s.way([b, [140, 0]], { highway: 'primary' }); }) }),
    also: (i) => { expect(i[0]!.note).toBe('bridge of 60 m with no layer tag'); },
  },
  'R-BRIDGE-02': {
    hit: () => ({ s: sketch((s) => { const a = s.node(0, 0); const m = s.node(60, 0); const b = s.node(120, 0); s.way([[-50, 0], a], { highway: 'trunk' }); s.way([a, m, b], { highway: 'trunk', bridge: 'yes', layer: '1' }); s.way([b, [170, 0]], { highway: 'trunk' }); s.way([[60, -40], m], { highway: 'trunk_link' }); }) }),
    clean: () => ({ s: sketch((s) => { const a = s.node(0, 0); const m = s.node(60, 0); const b = s.node(120, 0); s.way([[-50, 0], a], { highway: 'trunk' }); s.way([a, m, b], { highway: 'trunk', bridge: 'yes', layer: '1' }); s.way([b, [170, 0]], { highway: 'trunk' }); }) }),
  },
  'R-BRIDGE-03': {
    // the deck must be 6.7 m up over the street at x 0 and is at grade again 120 m on: 134 m are needed at 5 percent
    hit: () => ({ s: sketch((s) => flyover(s, 120)) }),
    clean: () => ({ s: sketch((s) => flyover(s, 180)) }),
    also: (i) => { expect(i[0]!.note).toContain('120 m to the ground, 134 m needed'); },
  },
  'R-BRIDGE-04': {
    hit: () => ({ s: sketch((s) => flyover(s, 180, (t, deck) => { const q = t.node(60, -30); t.way([deck, q], { highway: 'primary_link', oneway: 'yes', bridge: 'yes', layer: '1' }); t.way([[60, -120], q, [140, -30]], { highway: 'residential' }); })) }),
    clean: () => ({ s: sketch((s) => flyover(s, 180, (t, deck) => { const q = t.node(170, -30); t.way([deck, q], { highway: 'primary_link', oneway: 'yes', bridge: 'yes', layer: '1' }); t.way([[170, -120], q, [240, -30]], { highway: 'residential' }); })) }),
  },
  'R-BRIDGE-05': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [60, 0]], { highway: 'primary', bridge: 'yes', layer: '1' }); }) }),
    clean: () => ({ s: sketch((s) => { const a = s.node(0, 0); const b = s.node(60, 0); s.way([[-80, 0], a], { highway: 'primary' }); s.way([a, b], { highway: 'primary', bridge: 'yes', layer: '1' }); s.way([b, [140, 0]], { highway: 'primary' }); }) }),
  },
  'R-LANE-FIT-01': {
    hit: () => ({ s: sketch((s) => { s.way([[-200, 2], [200, 2]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); s.way([[200, -2], [-200, -2]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[-200, 7], [200, 7]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); s.way([[200, -7], [-200, -7]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); }) }),
    also: (i) => { expect(i[0]!.note).toBe('4 m between the centre lines, 7.2 m needed'); expect(i[0]!.proposals[0]!.params).toMatchObject({ op: 'shift_apart', shift_m: 1.6 }); },
  },
  'R-LANE-FIT-02': {
    hit: () => ({ s: sketch((s) => diverge(s, [[10, -8], [250, -8]])) }),
    clean: () => ({ s: sketch((s) => diverge(s, [[60, -8], [250, -8]])) }),
  },
  'R-LANE-FIT-03': {
    hit: () => ({ s: sketch((s) => street(s, [-200, 0, 200], [{}, { lanes: '3' }], { highway: 'secondary', name: 'X Marg' })) }),
    clean: () => ({ s: sketch((s) => street(s, [-200, 0, 200], [{}, {}], { highway: 'secondary', name: 'X Marg' })) }),
    also: (i) => { expect(i[0]!.proposals[0]!.params).toMatchObject({ lanes: 3, from: 'ahead' }); },
  },
  'R-LANE-01': {
    hit: () => ({ s: sketch((s) => diverge(s, [[80, -10], [250, -30]], { lanes: '3' }, { lanes: '2' })) }),
    clean: () => ({ s: sketch((s) => diverge(s, [[80, -10], [250, -30]], { lanes: '2' }, { lanes: '2' })) }),
  },
  'R-LANE-02': {
    hit: () => ({ s: sketch((s) => street(s, [-200, 0, 30, 230], [{ lanes: '2' }, { lanes: '4' }, { lanes: '2' }], { highway: 'secondary', name: 'X Marg' })) }),
    clean: () => ({ s: sketch((s) => street(s, [-200, 0, 30, 230], [{ lanes: '2' }, { lanes: '2' }, { lanes: '2' }], { highway: 'secondary', name: 'X Marg' })) }),
  },
  'R-LANE-03': {
    hit: () => ({ s: sketch((s) => { s.way([[-200, 6], [0, 0.15], [200, 6]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); s.way([[200, -6], [0, -0.15], [-200, -6]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[-200, 7], [200, 7]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); s.way([[200, -7], [-200, -7]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' }); }) }),
  },
  'R-LANE-04': {
    hit: () => ({ s: sketch((s) => diverge(s, [[20, -2]])) }),
    clean: () => ({ s: sketch((s) => diverge(s, [[80, -10], [250, -30]])) }),
  },
  'R-LANE-05': {
    // a service road drawn 4 m from a one-way secondary road; 9 m apart they keep their kerbs
    hit: () => ({ s: sketch((s) => { s.way([[-200, 0], [200, 0]], { highway: 'secondary', oneway: 'yes', name: 'Barakhamba Road' }); s.way([[-120, 4], [120, 4]], { highway: 'service' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[-200, 0], [200, 0]], { highway: 'secondary', oneway: 'yes', name: 'Barakhamba Road' }); s.way([[-120, 9], [120, 9]], { highway: 'service' }); }) }),
    also: (i) => { expect(i[0]!.proposals[0]!.params).toMatchObject({ op: 'shift_apart', move_nodes: true }); },
  },
  'R-JUNC-01': {
    hit: () => ({ s: sketch((s) => { const n = s.node(0, 0); s.way([[-100, 0], n], { highway: 'residential' }); s.way([n, [100, 0]], { highway: 'residential' }); s.way([n, [100, 8.7]], { highway: 'service' }); }) }),
    clean: () => ({ s: sketch((s) => { const n = s.node(0, 0); s.way([[-100, 0], n], { highway: 'residential' }); s.way([n, [100, 0]], { highway: 'residential' }); s.way([n, [0, 100]], { highway: 'service' }); }) }),
  },
  'R-JUNC-02': {
    hit: () => ({ s: sketch((s) => { const n = s.node(0, 0); s.way([[-80, 0], n], { highway: 'residential' }); s.way([n, [0, -80]], { highway: 'residential' }); s.way([n, [60, -60]], { highway: 'residential' }); s.way([[-150, 2], [150, 2]], { highway: 'tertiary' }); }) }),
    clean: () => ({ s: sketch((s) => { const n = s.node(0, 0); s.way([[-80, 0], n], { highway: 'residential' }); s.way([n, [0, -80]], { highway: 'residential' }); s.way([n, [60, -60]], { highway: 'residential' }); s.way([[-150, 30], [150, 30]], { highway: 'tertiary' }); }) }),
  },
  'R-JUNC-03': {
    hit: () => ({ s: sketch((s) => street(s, [-100, 0, 15, 30, 45, 60, 160], [{}, {}, {}, {}, {}, {}], { highway: 'tertiary', name: 'Ladder Road' })) }),
    clean: () => ({ s: sketch((s) => street(s, [-100, 0, 15, 160], [{}, {}, {}], { highway: 'tertiary', name: 'Ladder Road' })) }),
  },
  'R-JUNC-04': {
    hit: () => ({ s: sketch((s) => { const n = s.node(0, 0); s.way([[-100, 0], n, [100, 0]], { highway: 'residential' }); s.way([n, [0, 3]], { highway: 'residential' }); }) }),
    clean: () => ({ s: sketch((s) => { const n = s.node(0, 0); s.way([[-100, 0], n, [100, 0]], { highway: 'residential' }); s.way([n, [0, 30]], { highway: 'residential' }); }) }),
  },
  'R-FOOT-01': {
    hit: () => ({ s: sketch((s) => street(s, [-200, 0, 40, 240], [{}, { sidewalk: 'no' }, {}], { highway: 'tertiary', name: 'X Marg' })) }),
    clean: () => ({ s: sketch((s) => street(s, [-200, 0, 40, 240], [{}, {}, {}], { highway: 'tertiary', name: 'X Marg' })) }),
    also: (i) => { expect(i.map((x) => x.features[1]).sort()).toEqual(['left', 'right']); },
  },
  'R-FOOT-02': {
    hit: () => ({ s: sketch((s) => { s.way([[-200, 0], [200, 0]], { highway: 'tertiary' }); s.way([[-150, 5], [150, 5]], { highway: 'residential' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[-200, 0], [200, 0]], { highway: 'tertiary' }); s.way([[-150, 30], [150, 30]], { highway: 'residential' }); }) }),
  },
  'R-BLDG-01': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [100, 0]], { highway: 'residential' }); s.building([[10, 2.2], [20, 2.2], [20, 12], [10, 12]]); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [100, 0]], { highway: 'residential' }); s.building([[10, 6], [20, 6], [20, 16], [10, 16]]); }) }),
    also: (i) => { expect(i[0]!.note).toBe('0.8 m into a 6 m carriageway (class default)'); expect(i[0]!.proposals[0]!.params).toMatchObject({ key: 'width', value: 4 }); },
  },
  'R-BLDG-02': {
    hit: () => ({ s: sketch((s) => { s.building([[0, 0], [20, 0], [20, 20], [10, -5], [0, 20]]); s.building([[100, 0], [130, 0], [130, 0.4], [100, 0.4]]); }) }),
    clean: () => ({ s: sketch((s) => { s.building([[0, 0], [20, 0], [20, 20], [0, 20]]); }) }),
    also: (i) => { expect(i.map((x) => x.note).sort()).toEqual(['a sliver about 0.39 m wide', 'the outline crosses itself']); },
  },
  'R-BLDG-03': {
    hit: () => ({ s: sketch((s) => { s.building([[0, 0], [10, 0], [10, 10], [0, 10]], { name: 'kept' }); s.building([[0, 0], [10, 0], [10, 10], [0, 10]]); s.building([[40, 0], [60, 0], [60, 20], [40, 20]]); s.building([[44, 4], [50, 4], [50, 10], [44, 10]]); }) }),
    clean: () => ({ s: sketch((s) => { s.building([[0, 0], [10, 0], [10, 10], [0, 10]]); s.building([[10.2, 0], [20, 0], [20, 10], [10.2, 10]]); }) }),
    also: (i) => { expect(i.map((x) => x.note).sort()).toEqual(['exact duplicate', 'nested footprint']); expect(i.find((x) => x.note === 'exact duplicate')!.proposals[0]!.params).toMatchObject({ drop: 'way/101', keep: 'way/100' }); },
  },
  'R-BLDG-04': {
    hit: () => ({ s: sketch((s) => { s.building([[0, 0], [10, 0], [10, 10], [0, 10]], { height: '60', 'building:levels': '2' }); }) }),
    clean: () => ({ s: sketch((s) => { s.building([[0, 0], [10, 0], [10, 10], [0, 10]], { height: '7', 'building:levels': '2' }); s.building([[40, 0], [50, 0], [50, 10], [40, 10]]); }) }),
  },
  'R-RAIL-01': {
    hit: () => ({ s: sketch((s) => { s.way([[-200, 0], [200, 0]], { highway: 'secondary' }); s.way([[-200, 0.5], [200, 0.5]], { railway: 'subway', bridge: 'yes', layer: '1', name: 'Blue Line' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[-200, 0], [200, 0]], { highway: 'secondary' }); s.way([[-200, 30], [200, 30]], { railway: 'subway', bridge: 'yes', layer: '1', name: 'Blue Line' }); s.way([[0, -200], [0, 200]], { railway: 'subway', bridge: 'yes', layer: '1', name: 'Violet Line' }); }) }),
  },
  'R-RAIL-02': {
    hit: () => ({ s: sketch((s) => { s.node(0, 300, { railway: 'station', name: 'Lost Halt' }); s.way([[-200, -300], [200, -300]], { highway: 'residential' }); }) }),
    clean: () => ({ s: sketch((s) => { s.node(0, 300, { railway: 'station', station: 'subway', name: 'Mandi House' }); s.way([[-200, 310], [200, 310]], { railway: 'subway' }); s.way([[-200, 280], [200, 280]], { highway: 'residential' }); }) }),
    also: (i) => { expect(i.map((x) => x.features[1]).sort()).toEqual(['line', 'street']); },
  },
  'R-FOB-01': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [0, 200]], { highway: 'residential' }); s.way([[-20, 100], [1, 100]], { highway: 'footway', bridge: 'yes' }); }) }),
    // one end 2 m beyond the kerb, the other 17 m out on a flight of steps the driver passes in as a walkway
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [0, 200]], { highway: 'residential' }); s.way([[-5, 100], [20, 100]], { highway: 'footway', bridge: 'yes' }); }), env: { walkways: [[{ x: 20, z: -100 }, { x: 20, z: -110 }]] } }),
    also: (i) => { expect(i).toHaveLength(2); expect(i.map((x) => x.proposals[0]!.action).sort()).toEqual(['connect', 'move_node']); },
  },
  'R-STITCH-07': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [900, 0]], { highway: 'primary', name: 'Mathura Road' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'primary', name: 'Mathura Road' }); s.way([[0, 100], [900, 100]], { highway: 'service' }); }) }),
    also: (i) => { expect(i[0]!.status).toBe('open'); expect(i[0]!.proposals[0]!.params).toMatchObject({ with: 'barrier' }); },
  },
  'R-HERO-01': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary', name: 'Janpath' }); }), env: { heroList } }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary', name: 'Tolstoy Marg' }); }), env: { heroList } }),
    also: (i) => { expect(i[0]!.hero).toBe('janpath'); expect(i[0]!.impact).toBeGreaterThanOrEqual(0.9); },
  },
  'R-HERO-02': {
    hit: () => { const s = new Sketch(); const w = s.way([[0, 0], [300, 0]], { highway: 'tertiary', oneway: 'yes', lanes: '3', name: 'Inner Circle' }); return { s, env: { heroSpecs: [{ ...spec, covers: { ...spec.covers, osmWays: [w] } }] } }; },
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'tertiary', oneway: 'yes', lanes: '3', name: 'Inner Circle' }); }), env: { heroSpecs: [spec] } }),
    also: (i) => { expect(i[0]!.note).toContain('3 lanes, the spec says 4'); },
  },
  'R-HERO-03': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary', name: 'Janpath' }); }), env: { heroList }, marks: (g) => ({ [g.edges[0]!.id]: { lanes_from: 'ahead', by: 'R-LANE-FIT-03:w100.0' } }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary', name: 'Janpath' }); }), env: { heroList }, marks: (g) => ({ [g.edges[0]!.id]: { lanes_from: 'spec', profile: 'smoothed' } }) }),
  },
  'R-HERO-04': {
    hit: () => ({ s: new Sketch(), env: { heroSpecs: [{ ...spec, kerbs: { ...spec.kerbs, ref: [] } }] } }),
    clean: () => ({ s: new Sketch(), env: { heroSpecs: [spec] } }),
    also: (i) => { expect(i[0]!.note).toContain('kerbs: no reference'); },
  },
  'R-TERR-01': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'residential' }); }), env: { ground: (_x: number, z: number) => 210 + (z <= -3.5 ? 2 : 0) } }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'residential' }); }), env: { ground: (x: number) => 210 + x * 0.002 } }),
    also: (i) => { expect(i[0]!.proposals[0]!.params).toMatchObject({ mode: 'cut_corridor', max_m: 2 }); },
  },
  'R-TERR-02': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary' }); const ids = ([[100, -20], [160, -20], [160, 20], [100, 20]] as [number, number][]).map(([x, n]) => s.node(x, n)); s.way([...ids, ids[0]!], { natural: 'water', name: 'Boat Club pond' }); }) }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary', bridge: 'yes', layer: '1' }); const ids = ([[100, -20], [160, -20], [160, 20], [100, 20]] as [number, number][]).map(([x, n]) => s.node(x, n)); s.way([...ids, ids[0]!], { natural: 'water' }); }) }),
    also: (i) => { expect(i[0]!.note).toBe('60 m of the road lie in Boat Club pond'); },
  },
  'R-TERR-03': {
    hit: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary' }); }), env: { heightSource: (x: number) => 210 + (Math.abs(x - 150) < 1 ? 6 : 0) } }),
    clean: () => ({ s: sketch((s) => { s.way([[0, 0], [300, 0]], { highway: 'secondary' }); }), env: { heightSource: (x: number) => 210 + x * 0.002 } }),
    also: (i) => { expect(i[0]!.proposals[0]!.params).toMatchObject({ mode: 'smooth_profile', max_m: 6 }); expect(checkProfile([210, 210, 210, 216, 210, 210, 210]).outliers).toBe(2); },
  },
};

describe('rule catalogue (RE1)', () => {
  it('every rule has an id, an area, a detect function and a confidence, with unique ids', () => {
    const lines = catalogueLines();
    expect(new Set(lines.map((l) => l.id)).size).toBe(CATALOGUE.length);
    for (const r of CATALOGUE) {
      expect(r.id).toMatch(/^R-[A-Z]+(-FIT)?-\d\d$/);
      expect(typeof r.detect).toBe('function');
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('runs in one fixed order', () => {
    expect(CATALOGUE.map((r) => r.id)).toEqual([
      'R-ROAD-01', 'R-ROAD-02', 'R-ROAD-03', 'R-ROAD-04', 'R-ROAD-05', 'R-ROAD-07',
      'R-BRIDGE-01', 'R-BRIDGE-02', 'R-BRIDGE-03', 'R-BRIDGE-04', 'R-BRIDGE-05',
      'R-LANE-FIT-01', 'R-LANE-FIT-02', 'R-LANE-FIT-03',
      'R-ROAD-06', 'R-LANE-01', 'R-LANE-02', 'R-LANE-03', 'R-LANE-04', 'R-LANE-05',
      'R-JUNC-01', 'R-JUNC-02', 'R-JUNC-03', 'R-JUNC-04',
      'R-FOOT-01', 'R-FOOT-02',
      'R-BLDG-01', 'R-BLDG-02', 'R-BLDG-03', 'R-BLDG-04',
      'R-RAIL-01', 'R-RAIL-02',
      'R-FOB-01',
      'R-STITCH-07',
      'R-HERO-01', 'R-HERO-02', 'R-HERO-03', 'R-HERO-04',
      'R-TERR-01', 'R-TERR-02', 'R-TERR-03',
    ]);
  });

  it('has a file for every rule area of the MAP_REPAIR.md table, and every rule sits in its area file', () => {
    expect(Object.keys(AREA_FILES).sort()).toEqual(['bridges', 'buildings', 'fob', 'footpaths', 'hero', 'junctions', 'lanes', 'rail', 'roads', 'stitch', 'terrain']);
    for (const r of CATALOGUE) {
      const text = FILES[`/${AREA_FILES[r.area]}`];
      expect(text, `${AREA_FILES[r.area]} for ${r.id}`).toBeTruthy();
      expect(text).toContain(`id: '${r.id}'`);
    }
    // the layout part of R-STITCH (01 to 06) runs before the first bake step
    expect(FILES['/tools/bake/layout/gate.ts']).toContain('R-STITCH-06');
  });

  it('every rule id has a map it detects and a clean map', () => {
    expect(Object.keys(CASES).sort()).toEqual(CATALOGUE.map((r) => r.id).sort());
  });

  it.each(CATALOGUE.map((r) => [r.id, r.title]))('%s detects: %s', (id) => {
    const c = CASES[id]!;
    const issues = issuesOf(id, c.hit());
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(i.id.startsWith(`${id}:`)).toBe(true);
      expect(i.proposals.length).toBeGreaterThan(0);
      for (const p of i.proposals) {
        expect(p.confidence).toBeGreaterThan(0);
        expect(p.reasoning.length).toBeGreaterThan(10);
        expect(p.preview.length).toBeGreaterThan(0);
        expect(p.reasoning).not.toContain(String.fromCharCode(0x2014));
      }
      expect(Number.isFinite(i.x) && Number.isFinite(i.z)).toBe(true);
      expect(i.tile).toEqual([Math.floor(i.x / 250), Math.floor(i.z / 250)]);
    }
    c.also?.(issues);
  });

  it.each(CATALOGUE.map((r) => [r.id]))('%s finds nothing on a clean map', (id) => {
    expect(issuesOf(id, CASES[id]!.clean())).toEqual([]);
  });

  it('the same graph gives the same issues, the counts add up and every rule is timed', () => {
    const c = CASES['R-BLDG-01']!.hit();
    c.s.way([[50, 60], [50, 3]], { highway: 'residential' });
    const g = c.s.graph();
    const a = runRules(rulesOn(g));
    const b = runRules(rulesOn(g));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((i) => i.rule)).toEqual(['R-ROAD-01', 'R-BLDG-01']);
    const counts = countByRule(a);
    expect(counts.reduce((n, x) => n + x.issues, 0)).toBe(a.length);
    for (const x of counts) expect(x.auto + x.queued + x.explained).toBe(x.issues);
    let clock = 0;
    const timed = timeRules(rulesOn(g), () => (clock += 2));
    expect(Object.keys(timed.ms)).toEqual(CATALOGUE.map((r) => r.id));
    expect(timed.issues.map((i) => i.id)).toEqual(a.map((i) => i.id));
  });

  it('a noexit node is a mapped dead end, not a dangling end', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'residential' });
    const end = s.node(50, 3, { noexit: 'yes' });
    s.way([[50, 60], end], { highway: 'residential' });
    expect(issuesOf('R-ROAD-01', { s })).toEqual([]);
  });

  it('a road that leaves a stage inside its block is explained, not queued', () => {
    const c = CASES['R-STITCH-07']!.hit();
    const issues = issuesOf('R-STITCH-07', { ...c, env: { mapEdge: 'stage' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.status).toBe('explained');
  });

  it('finds splits and junction clusters for the lane model and the junction builder', () => {
    const s = new Sketch();
    diverge(s, [[80, -10], [250, -30]]);
    const ctx = rulesOn(s.graph());
    const sp = splits(ctx);
    expect(sp).toHaveLength(1);
    expect(sp[0]!.kind).toBe('diverge');
    expect(sp[0]!.minor.edge.road.link).toBe(true);
    const t = new Sketch();
    street(t, [-100, 0, 15, 160], [{}, {}, {}], { highway: 'tertiary', name: 'Ladder Road' });
    const clusters = junctionClusters(rulesOn(t.graph()));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.nodes).toHaveLength(2);
    expect(clusters[0]!.span).toBeCloseTo(15, 3);
  });
});
