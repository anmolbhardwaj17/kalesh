// Bridge and flyover rules (R-BRIDGE) on the block graph: ends without support and bridges without a layer, ramps
// that end in the air, decks that cannot reach their clearance over what they cross, ramps too short for their grade
// limit, and a bridge with no ground road at either end. Heights are the elevation solver's job (tools/bake/roads/
// elevation.ts); these rules check in plan whether a solution can exist. Pure.
import { boxOf, segmentCrossing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import { DECK_DEPTH, HEADROOM, maxGrade } from '../roads/model.ts';
import { atGrade, byId, r3 } from './context.ts';
import type { End, Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

/** A run of bridge pieces on one layer along one edge. */
export interface Span {
  edge: GraphEdge;
  s0: number;
  s1: number;
  layer: number;
}

export interface ChainEnd {
  span: Span;
  atStart: boolean;
  /** The node the chain ends at; null when the bridge tag stops inside an edge (the road goes on at grade). */
  node: string | null;
}

/** Bridge spans joined end to end on one layer are one structure. */
export interface Chain {
  spans: Span[];
  layer: number;
  length: number;
  ends: ChainEnd[];
  /** Node ids inside the structure: where two of its spans meet. */
  inner: string[];
}

const EPS = 0.01;

export function bridgeChains(ctx: RuleContext): Chain[] {
  const cached = ctx.cache.get('bridgeChains') as Chain[] | undefined;
  if (cached) return cached;
  const spans: Span[] = [];
  for (const e of ctx.graph.edges) {
    let cur: Span | null = null;
    for (const p of e.pieces) {
      if (p.bridge && cur && cur.layer === p.layer && Math.abs(cur.s1 - p.s0) < EPS) cur.s1 = p.s1;
      else if (p.bridge) {
        cur = { edge: e, s0: p.s0, s1: p.s1, layer: p.layer };
        spans.push(cur);
      } else cur = null;
    }
  }
  // spans that touch one node on one layer belong together
  const parent = spans.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i] as number] as number;
    return i;
  };
  const touch = new Map<string, number[]>();
  const nodeAt = (s: Span, atStart: boolean): string | null => (atStart ? (s.s0 <= EPS ? s.edge.a : null) : s.s1 >= s.edge.len - EPS ? s.edge.b : null);
  spans.forEach((s, i) => {
    for (const atStart of [true, false]) {
      const n = nodeAt(s, atStart);
      if (!n) continue;
      const key = `${n}|${s.layer}`;
      const list = touch.get(key);
      if (list) {
        parent[find(i)] = find(list[0] as number);
        list.push(i);
      } else touch.set(key, [i]);
    }
  });
  const groups = new Map<number, Span[]>();
  spans.forEach((s, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(s);
    else groups.set(r, [s]);
  });
  const chains: Chain[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => byId(a.edge, b.edge) || a.s0 - b.s0);
    const layer = (list[0] as Span).layer;
    const ends: ChainEnd[] = [];
    const inner = new Set<string>();
    for (const s of list) {
      for (const atStart of [true, false]) {
        const n = nodeAt(s, atStart);
        const meets = n ? (touch.get(`${n}|${layer}`) ?? []).length : 0;
        if (n && meets >= 2) inner.add(n);
        else ends.push({ span: s, atStart, node: n });
      }
    }
    chains.push({ spans: list, layer, length: list.reduce((t, s) => t + s.s1 - s.s0, 0), ends, inner: [...inner].sort() });
  }
  chains.sort((a, b) => byId((a.spans[0] as Span).edge, (b.spans[0] as Span).edge) || (a.spans[0] as Span).s0 - (b.spans[0] as Span).s0);
  ctx.cache.set('bridgeChains', chains);
  return chains;
}

const chainEdges = (c: Chain): GraphEdge[] => [...new Set(c.spans.map((s) => s.edge))];
const spanMid = (ctx: RuleContext, s: Span): P2 => ctx.pointAt(s.edge, (s.s0 + s.s1) / 2);
const spanEndPoint = (ctx: RuleContext, e: ChainEnd): P2 => ctx.pointAt(e.span.edge, e.atStart ? e.span.s0 : e.span.s1);

/** Chain ends at a node where no road goes on (the stage outline is not such an end). */
function unsupported(ctx: RuleContext, c: Chain): ChainEnd[] {
  const mine = new Set(chainEdges(c));
  return c.ends.filter((e) => {
    if (!e.node) return false;
    const node = ctx.nodes.get(e.node);
    if (!node || node.kind === 'map_edge') return false;
    return !(ctx.ends.get(e.node) ?? []).some((o) => !mine.has(o.edge));
  });
}

/** A structure with no supported end at all: rule R-BRIDGE-05 reports it once, R-BRIDGE-01 leaves its ends alone. */
const isolated = (ctx: RuleContext, c: Chain): boolean => c.ends.length > 0 && unsupported(ctx, c).length === c.ends.length;

export const bridgeSupport: Rule = {
  id: 'R-BRIDGE-01',
  area: 'bridges',
  title: 'Bridge or flyover end without support, or a bridge without a layer',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const chain of bridgeChains(ctx)) {
      const edges = chainEdges(chain);
      const first = edges[0] as GraphEdge;
      if (!isolated(ctx, chain)) {
        for (const end of unsupported(ctx, chain)) {
          // a ramp (link) with nothing after it is the ramp rule's issue, not counted twice
          if (end.span.edge.road.link) continue;
          const p = spanEndPoint(ctx, end);
          out.push(ctx.issue(bridgeSupport, p, [end.span.edge.id, end.node as string], edges, 0.8, `the ${Math.round(chain.length)} m bridge ends with no road beyond it`, [
            ctx.proposal('terminate', { node: end.node as string, with: 'abutment' }, 0.4, { kind: 'other' }, 'No road goes on from this end of the bridge: close it with an abutment and a barrier, or find the missing approach', [p]),
          ]));
        }
      }
      if (chain.layer === 0) {
        const ids = edges.map((e) => e.id);
        out.push(ctx.issue(bridgeSupport, spanMid(ctx, chain.spans[0] as Span), ['layer', ...ids.slice(0, 4)], edges, 0.9, `bridge of ${Math.round(chain.length)} m with no layer tag`, [
          ctx.proposal('set_tag', { key: 'layer', value: 1, on: ids.join(',') }, 0.85, { kind: 'bridge_layer_tag' }, 'A way tagged bridge with no layer: it is one level up (a tag only, no geometry moves)', first.pts),
        ]));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const rampInAir: Rule = {
  id: 'R-BRIDGE-02',
  area: 'bridges',
  title: 'Ramp that ends in the air',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const chain of bridgeChains(ctx)) {
      const edges = chainEdges(chain);
      const mine = new Set(edges);
      const first = edges[0] as GraphEdge;
      // a ground road that meets the deck inside the structure: it would need its own ramp
      for (const id of chain.inner) {
        const node = ctx.nodes.get(id);
        if (!node) continue;
        for (const o of ctx.ends.get(id) ?? []) {
          const lv = ctx.endLevel(o);
          if (mine.has(o.edge) || lv.bridge || lv.layer >= chain.layer) continue;
          out.push(ctx.issue(rampInAir, node, [o.edge.id, first.id, id], [o.edge, ...edges], 0.7, `ground road (layer ${lv.layer}) joins a deck on layer ${chain.layer} inside its span`, [
            ctx.proposal('replace_geometry', { op: 'ramp', on: o.edge.id, to_layer: chain.layer }, 0.6, { kind: 'other' }, 'The joining road needs a ramp: raise its last stretch to the deck (the elevation solver sets the length from the grade limit)', o.edge.pts),
          ]));
        }
      }
      // a bridge ramp that stops with nothing after it
      for (const end of isolated(ctx, chain) ? [] : unsupported(ctx, chain)) {
        if (!end.span.edge.road.link) continue;
        const p = spanEndPoint(ctx, end);
        out.push(ctx.issue(rampInAir, p, [end.span.edge.id, end.node as string], [end.span.edge], 0.8, 'a bridge ramp ends with no road after it', [
          ctx.proposal('terminate', { node: end.node as string, with: 'barrier' }, 0.4, { kind: 'other' }, 'The ramp has no way on from here: find the road it should meet, or close it', [p]),
        ]));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** Height a deck needs over a road: the headroom and the deck's own depth. */
export const DECK_RISE = HEADROOM + DECK_DEPTH;
const RUN_LIMIT = 600;

/**
 * Metres from s on an edge, walking with (dir 1) or against (dir -1) its points, to the first node where the road
 * must be at grade: a junction with a ground road that is neither a ramp nor the road itself running on. Infinity
 * when the walk leaves the stage, dead-ends, or finds none within RUN_LIMIT.
 */
export function runToGrade(ctx: RuleContext, e: GraphEdge, s: number, dir: 1 | -1): number {
  let run = dir > 0 ? e.len - s : s;
  let end: End = { edge: e, atStart: dir < 0 };
  const seen = new Set<GraphEdge>([e]);
  for (;;) {
    if (run > RUN_LIMIT) return Infinity;
    const node = ctx.nodeOf(end);
    if (node.kind === 'map_edge' || node.kind === 'end') return Infinity;
    const next = ctx.through(end);
    const here = end;
    // a ramp is often tagged bridge right down to the junction: the ground road it meets there says it is down
    if ((ctx.ends.get(node.id) ?? []).some((o) => o.edge !== here.edge && o.edge !== next?.edge && !o.edge.road.link && atGrade(ctx.endLevel(o)))) return run;
    if (!next || seen.has(next.edge)) return Infinity;
    seen.add(next.edge);
    run += next.edge.len;
    end = ctx.otherEnd(next);
  }
}

export interface DeckRun {
  /** The deck edge that crosses, where, and the road under it. */
  deck: GraphEdge;
  under: GraphEdge;
  at: P2;
  /** main: the deck's own road to the ground; ramp: a slip road that leaves the deck. */
  kind: 'main' | 'ramp';
  /** The edge the run is measured along (the deck, or the ramp). */
  edge: GraphEdge;
  run: number;
  need: number;
}

/** For every place a deck (layer 1 or more) crosses a road at ground level: the runs to the ground and what they need. */
export function deckRuns(ctx: RuleContext): DeckRun[] {
  const cached = ctx.cache.get('deckRuns') as DeckRun[] | undefined;
  if (cached) return cached;
  const best = new Map<string, DeckRun>();
  const keep = (r: DeckRun): void => {
    const key = `${r.kind}|${r.edge.id}|${r.under.id}`;
    const prev = best.get(key);
    if (!prev || r.run < prev.run) best.set(key, r);
  };
  for (const s of ctx.segList) {
    if (!s.lv.bridge || s.lv.layer < 1) continue;
    for (const o of ctx.segs.query(boxOf([s.a, s.b]))) {
      if (o.edge === s.edge || !atGrade(o.lv)) continue;
      const c = segmentCrossing(s.a, s.b, o.a, o.b, 1e-6);
      if (!c) continue;
      const at = { x: c.x, z: c.z };
      const sc = s.s + c.t * Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const e = s.edge;
      const need = DECK_RISE / maxGrade(e.road.cls, e.road.link);
      for (const dir of [1, -1] as const) {
        keep({ deck: e, under: o.edge, at, kind: 'main', edge: e, run: runToGrade(ctx, e, sc, dir), need });
        // slip roads that leave the deck before it is down: the deck's run to the node, then the ramp's own
        let d = dir > 0 ? e.len - sc : sc;
        let end: End = { edge: e, atStart: dir < 0 };
        const seen = new Set<GraphEdge>([e]);
        while (d < need) {
          const node = ctx.nodeOf(end);
          const next = ctx.through(end);
          for (const r of ctx.ends.get(node.id) ?? []) {
            if (r.edge === end.edge || r.edge === next?.edge || !r.edge.road.link) continue;
            const rampNeed = DECK_RISE / maxGrade(r.edge.road.cls, true);
            keep({ deck: e, under: o.edge, at, kind: 'ramp', edge: r.edge, run: d + runToGrade(ctx, r.edge, r.atStart ? 0 : r.edge.len, r.atStart ? 1 : -1), need: rampNeed });
          }
          if (!next || seen.has(next.edge) || !ctx.endLevel(end).bridge) break;
          seen.add(next.edge);
          d += next.edge.len;
          end = ctx.otherEnd(next);
        }
      }
    }
  }
  const list = [...best.values()].sort((a, b) => byId(a.edge, b.edge) || byId(a.under, b.under) || (a.kind < b.kind ? -1 : 1));
  ctx.cache.set('deckRuns', list);
  return list;
}

function shortRun(ctx: RuleContext, rule: Rule, r: DeckRun): Issue {
  const short = r3(DECK_RISE - (r.run * DECK_RISE) / r.need);
  const pct = Math.round((DECK_RISE / r.run) * 1000) / 10;
  const limit = Math.round((DECK_RISE / r.need) * 1000) / 10;
  const what = r.kind === 'main' ? `${r.deck.id} crosses over ${r.under.id}` : `the ramp ${r.edge.id} leaves the deck of ${r.deck.id} over ${r.under.id}`;
  return ctx.issue(rule, r.at, [r.edge.id, r.under.id], [r.edge, r.under], 0.7, `${Math.round(r.run)} m to the ground, ${Math.round(r.need)} m needed for ${DECK_RISE} m (${pct} percent against a limit of ${limit})`, [
    ctx.proposal('set_height', { mode: 'lower_under', on: r.under.id, by_m: Math.round(short * 10) / 10 }, 0.5, { kind: 'other' }, `${what} but reaches the ground ${Math.round(r.run)} m on: at the grade limit it is ${Math.round(short * 10) / 10} m short of its clearance, so the road under it dips by that much`, r.under.pts),
    ctx.proposal('replace_geometry', { op: 'longer_ramp', on: r.edge.id, need_m: Math.round(r.need) }, 0.3, { kind: 'other' }, 'Or the ramp starts earlier than the map shows: lengthen it', r.edge.pts),
  ]);
}

export const deckClearance: Rule = {
  id: 'R-BRIDGE-03',
  area: 'bridges',
  title: 'Deck cannot reach its clearance over the road it crosses',
  confidence: 0.7,
  detect: (ctx) => deckRuns(ctx).filter((r) => r.kind === 'main' && r.run < r.need).map((r) => shortRun(ctx, deckClearance, r)),
  repair: (i, p) => patchOf(i, p),
};

export const rampGrade: Rule = {
  id: 'R-BRIDGE-04',
  area: 'bridges',
  title: 'Ramp too short for its grade limit',
  confidence: 0.7,
  detect: (ctx) => deckRuns(ctx).filter((r) => r.kind === 'ramp' && r.run < r.need).map((r) => shortRun(ctx, rampGrade, r)),
  repair: (i, p) => patchOf(i, p),
};

export const bridgeNoGround: Rule = {
  id: 'R-BRIDGE-05',
  area: 'bridges',
  title: 'Bridge with no ground road at either end',
  confidence: 0.75,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const chain of bridgeChains(ctx)) {
      if (!isolated(ctx, chain)) continue;
      const edges = chainEdges(chain);
      const first = edges[0] as GraphEdge;
      out.push(ctx.issue(bridgeNoGround, spanMid(ctx, chain.spans[0] as Span), edges.map((e) => e.id).slice(0, 4), edges, 0.75, `a ${Math.round(chain.length)} m bridge that no ground road reaches`, [
        ctx.proposal('remove', { drop: edges.map((e) => e.id).join(',') }, 0.5, { kind: 'other' }, 'A bridge drawn on its own: no road reaches either end. Leave it out until its approaches are mapped', first.pts),
        ctx.proposal('terminate', { node: (chain.ends[0] as ChainEnd).node as string, with: 'abutment' }, 0.3, { kind: 'other' }, 'Or keep it as a closed structure with an abutment at each end', first.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
