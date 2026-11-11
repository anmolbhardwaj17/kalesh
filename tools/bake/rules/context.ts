// What a rule sees (RE1): the block graph of tools/bake/graph/ with the indexes rules share (edge ends per node, a
// grid of road segments with their level, a grid of footprints), the marks earlier repairs left, and the driver's
// environment (projection, tiles, ground, hero specs). Built once per graph state; rules only read. Pure.
import { Grid, boxOf, pointSegment } from '../geom.ts';
import type { Box2, P2 } from '../geom.ts';
import { classImpact } from '../osm.ts';
import type { BlockGraph, GraphEdge, GraphFootprint, GraphNode } from '../graph/build.ts';
import { isLowImpact } from '../repair/bounds.ts';
import type { Issue, Marks, Measure, Params, Patch, PatchAction, Proposal, RuleArea, RuleEnv } from './types.ts';

export interface Level {
  layer: number;
  bridge: boolean;
  tunnel: boolean;
}

export const GROUND: Level = { layer: 0, bridge: false, tunnel: false };
/** On the same level: the same layer, both or neither a bridge, both or neither a tunnel. */
export const sameLevel = (a: Level, b: Level): boolean => a.layer === b.layer && a.bridge === b.bridge && a.tunnel === b.tunnel;
export const atGrade = (l: Level): boolean => l.layer === 0 && !l.bridge && !l.tunnel;

export interface Seg {
  edge: GraphEdge;
  /** Index of the segment's first point in edge.pts. */
  i: number;
  a: P2;
  b: P2;
  /** Metres along the edge at a. */
  s: number;
  lv: Level;
}

/** One end of an edge at a node. */
export interface End {
  edge: GraphEdge;
  atStart: boolean;
}

export interface Fp {
  f: GraphFootprint;
  box: Box2;
  centre: P2;
}

export interface Rule {
  id: string;
  area: RuleArea;
  title: string;
  /** Base confidence of a detection by this rule (single issues may differ). */
  confidence: number;
  detect(ctx: RuleContext): Issue[];
  /** The patch (overrides form) of a proposal, when the rule can repair. Rules without it only detect. */
  repair?(issue: Issue, proposal: Proposal): Patch | null;
}

const r1 = (v: number): number => Math.round(v * 10) / 10 + 0;
const r7 = (v: number): number => Math.round(v * 1e7) / 1e7;
export const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
export const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
export const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class RuleContext {
  readonly graph: BlockGraph;
  readonly env: RuleEnv;
  readonly marks: Marks;
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();
  /** Edge ends per node id, in edge order. A loop edge is listed twice. */
  readonly ends = new Map<string, End[]>();
  private segGrid: Grid<Seg> | null = null;
  private segAll: Seg[] = [];
  private fpGrid: Grid<Fp> | null = null;
  private fpList: Fp[] | null = null;
  private walkGrid: Grid<[P2, P2]> | null = null;
  private readonly cums = new Map<GraphEdge, number[]>();
  private readonly heroBy = new Map<string, string>();
  private readonly heroNames = new Map<string, string>();
  /** Results rules share within one run (bridge spans, deck crossings), by name. */
  readonly cache = new Map<string, unknown>();

  constructor(graph: BlockGraph, env: RuleEnv, marks: Marks = {}) {
    this.graph = graph;
    this.env = env;
    this.marks = marks;
    for (const n of graph.nodes) this.nodes.set(n.id, n);
    for (const e of graph.edges) {
      this.edges.set(e.id, e);
      for (const atStart of [true, false]) {
        const id = atStart ? e.a : e.b;
        const list = this.ends.get(id);
        if (list) list.push({ edge: e, atStart });
        else this.ends.set(id, [{ edge: e, atStart }]);
      }
    }
    for (const spec of env.heroSpecs ?? []) for (const w of spec.covers.osmWays) this.heroBy.set(`way/${w}`, spec.id);
    for (const h of env.heroList ?? []) {
      for (const n of h.osmNames) this.heroNames.set(n, h.id);
      for (const w of h.osmWays ?? []) if (!this.heroBy.has(`way/${w}`)) this.heroBy.set(`way/${w}`, h.id);
    }
  }

  /** Cumulative length at every point of an edge. */
  cum(e: GraphEdge): number[] {
    let c = this.cums.get(e);
    if (!c) {
      c = [0];
      for (let i = 1; i < e.pts.length; i++) c.push((c[i - 1] as number) + Math.hypot((e.pts[i] as P2).x - (e.pts[i - 1] as P2).x, (e.pts[i] as P2).z - (e.pts[i - 1] as P2).z));
      this.cums.set(e, c);
    }
    return c;
  }

  /** The level (layer, bridge, tunnel) of an edge at s metres along it. */
  levelAt(e: GraphEdge, s: number): Level {
    for (const p of e.pieces) if (s <= p.s1 + 1e-6) return p;
    return e.pieces[e.pieces.length - 1] ?? GROUND;
  }

  endLevel(end: End): Level {
    return end.atStart ? (end.edge.pieces[0] ?? GROUND) : (end.edge.pieces[end.edge.pieces.length - 1] ?? GROUND);
  }

  nodeOf(end: End): GraphNode {
    return this.nodes.get(end.atStart ? end.edge.a : end.edge.b) as GraphNode;
  }

  otherEnd(end: End): End {
    return { edge: end.edge, atStart: !end.atStart };
  }

  /** The point s metres along an edge and the unit direction of travel there. */
  pointAt(e: GraphEdge, s: number): P2 & { tx: number; tz: number } {
    const c = this.cum(e);
    let i = 0;
    while (i + 2 < c.length && (c[i + 1] as number) < s) i++;
    const a = e.pts[i] as P2;
    const b = e.pts[i + 1] as P2;
    const l = (c[i + 1] as number) - (c[i] as number) || 1;
    const t = Math.max(0, Math.min(1, (s - (c[i] as number)) / l));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l };
  }

  /** Unit vector along the edge away from the node of this end, measured over the first d metres. */
  dirFrom(end: End, d = 8): P2 {
    const e = end.edge;
    const far = Math.min(d, e.len / 2);
    const p0 = end.atStart ? (e.pts[0] as P2) : (e.pts[e.pts.length - 1] as P2);
    const p1 = this.pointAt(e, end.atStart ? far : e.len - far);
    const l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    return { x: (p1.x - p0.x) / l, z: (p1.z - p0.z) / l };
  }

  /** Points every `step` metres along an edge, leaving `skip` metres free at both ends. */
  samples(e: GraphEdge, step: number, skip = 0): (P2 & { tx: number; tz: number; s: number })[] {
    const out: (P2 & { tx: number; tz: number; s: number })[] = [];
    const span = e.len - 2 * skip;
    if (span <= 0) return out;
    const n = Math.max(1, Math.round(span / step));
    for (let k = 0; k <= n; k++) {
      const s = skip + (span * k) / n;
      out.push({ ...this.pointAt(e, s), s });
    }
    return out;
  }

  /** Every road segment with its level, in a grid. */
  get segs(): Grid<Seg> {
    if (this.segGrid) return this.segGrid;
    const grid = new Grid<Seg>(40);
    for (const e of this.graph.edges) {
      const c = this.cum(e);
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i] as P2;
        const b = e.pts[i + 1] as P2;
        const seg: Seg = { edge: e, i, a, b, s: c[i] as number, lv: this.levelAt(e, ((c[i] as number) + (c[i + 1] as number)) / 2) };
        this.segAll.push(seg);
        grid.insert(boxOf([a, b]), seg);
      }
    }
    this.segGrid = grid;
    return grid;
  }

  /** Every road segment, in edge order. */
  get segList(): Seg[] {
    void this.segs;
    return this.segAll;
  }

  /** Road segments within `radius` metres of a point, nearest first, at most one per edge unless `all`. */
  near(p: P2, radius: number): { seg: Seg; d: number; x: number; z: number; t: number }[] {
    const best = new Map<GraphEdge, { seg: Seg; d: number; x: number; z: number; t: number }>();
    for (const seg of this.segs.query({ minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z }, radius)) {
      const c = pointSegment(p, seg.a, seg.b);
      if (c.d > radius) continue;
      const prev = best.get(seg.edge);
      if (!prev || c.d < prev.d) best.set(seg.edge, { seg, d: c.d, x: c.x, z: c.z, t: c.t });
    }
    return [...best.values()].sort((a, b) => a.d - b.d || (a.seg.edge.id < b.seg.edge.id ? -1 : 1));
  }

  get footprints(): Fp[] {
    if (!this.fpList) {
      this.fpList = this.graph.footprints.map((f) => {
        const box = boxOf(f.ring);
        return { f, box, centre: { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 } };
      });
    }
    return this.fpList;
  }

  get fps(): Grid<Fp> {
    if (!this.fpGrid) {
      this.fpGrid = new Grid<Fp>(40);
      for (const f of this.footprints) this.fpGrid.insert(f.box, f);
    }
    return this.fpGrid;
  }

  /**
   * The edge end a road runs on into at the node of `end`: the only other end at a node with two ends (whatever its
   * class), else the other end of the same class, link flag, direction rule and name that leaves within 30 degrees of
   * straight on. Null when none or more than one fits.
   */
  through(end: End): End | null {
    const id = end.atStart ? end.edge.a : end.edge.b;
    const others = (this.ends.get(id) ?? []).filter((o) => o.edge !== end.edge);
    const e = end.edge;
    const same = (o: End): boolean => o.edge.road.cls === e.road.cls && o.edge.road.link === e.road.link && o.edge.oneway === e.oneway && o.edge.name === e.name;
    if (others.length === 1) return others[0] as End;
    const d = this.dirFrom(end);
    const fit = others.filter((o) => {
      if (!same(o)) return false;
      const q = this.dirFrom(o);
      return d.x * q.x + d.z * q.z < -0.866;
    });
    return fit.length === 1 ? (fit[0] as End) : null;
  }

  /** Distance (m) from a point to the nearest walkway of the environment within `radius`; Infinity when none. */
  walkwayNear(p: P2, radius: number): number {
    let grid = this.walkGrid;
    if (!grid) {
      grid = new Grid<[P2, P2]>(40);
      for (const line of this.env.walkways ?? []) for (let i = 0; i + 1 < line.length; i++) grid.insert(boxOf([line[i] as P2, line[i + 1] as P2]), [line[i] as P2, line[i + 1] as P2]);
      this.walkGrid = grid;
    }
    let best = Infinity;
    for (const [a, b] of grid.query({ minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z }, radius)) best = Math.min(best, pointSegment(p, a, b).d);
    return best <= radius ? best : Infinity;
  }

  /** The hero road an edge belongs to: a spec that covers one of its ways, else a listed hero street by name. */
  heroOf(e: GraphEdge): string | null {
    for (const p of e.pieces) {
      const h = this.heroBy.get(p.way);
      if (h) return h;
    }
    return (e.name && this.heroNames.get(e.name)) || null;
  }

  mark(id: string, key: string): string | number | boolean | undefined {
    return this.marks[id]?.[key];
  }

  /** Impact 0 to 1: the biggest road class involved, 0.9 at least on a hero road, a little more near a mission place. */
  impact(edges: readonly GraphEdge[], at: P2, base = 0.1): number {
    let v = base;
    for (const e of edges) {
      v = Math.max(v, classImpact(e.road.cls));
      if (this.heroOf(e)) v = Math.max(v, 0.9);
    }
    for (const m of this.env.missionPlaces ?? []) {
      if (Math.hypot(m.x - at.x, m.z - at.z) <= 150) {
        v = Math.min(1, v + 0.1);
        break;
      }
    }
    return r2(v);
  }

  /** A proposal with its low impact flag set by the bounds. */
  proposal(action: PatchAction, params: Params, confidence: number, measure: Measure, reasoning: string, preview: readonly P2[]): Proposal {
    return { action, params, confidence: r2(confidence), lowImpact: isLowImpact(measure), measure, reasoning, preview: preview.map((p) => ({ x: r1(p.x), z: r1(p.z) })) };
  }

  /** An issue with its place filled in. `edges` are the roads involved (impact and hero status come from them). */
  issue(rule: Rule, at: P2, features: readonly string[], edges: readonly GraphEdge[], confidence: number, note: string, proposals: Proposal[], impact?: number): Issue {
    const g = this.env.toGeo(at.x, at.z);
    let hero: string | null = null;
    for (const e of edges) hero = hero ?? this.heroOf(e);
    return {
      id: `${rule.id}:${features.join(':')}`, rule: rule.id, block: this.graph.block, district: this.env.district ? this.env.district(at.x, at.z) : null, tile: this.env.tile(at.x, at.z),
      lat: r7(g.lat), lon: r7(g.lon), x: r1(at.x), z: r1(at.z), features: [...features], impact: impact ?? this.impact(edges, at), confidence: r2(confidence), status: 'open', note, hero, proposals,
    };
  }
}

/** Unit left normal of a direction of travel (x east, z south: the left of (dx, dz) is (dz, -dx)). */
export const leftOf = (tx: number, tz: number): P2 => ({ x: tz, z: -tx });

/** Smallest distance from a point to a polyline, with the closest point and the metres along. */
export function projectOn(p: P2, pts: readonly P2[]): { d: number; x: number; z: number; i: number; t: number } {
  let best = { d: Infinity, x: 0, z: 0, i: 0, t: 0 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = pointSegment(p, pts[i] as P2, pts[i + 1] as P2);
    if (c.d < best.d) best = { d: c.d, x: c.x, z: c.z, i, t: c.t };
  }
  return best;
}
