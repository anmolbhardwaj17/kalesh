// Road topology shared by the block graph (tools/bake/graph/build.ts) and the lane model prototype's site graph
// (tools/bake/roads/graph.ts): way runs are cut at every node they share, chains through plain nodes are joined
// again, and edges that run on into each other at a node get one tangent there. Pure; node ids are numbers (OSM ids,
// negative for nodes made by a clip).
import type { P2 } from '../geom.ts';
import type { Road } from '../osm.ts';

/** A stretch of one way after clipping: node ids and points in step, in the direction of travel for a one-way. */
export interface Run {
  road: Road;
  nodes: number[];
  pts: P2[];
  /** The run goes against its way's own node order (a oneway=-1 way turned to the direction of travel). */
  reversed?: boolean;
}

export interface DraftPart {
  road: Road;
  /** Index of this piece along its way (0 for the first piece of the way that survives the clip). */
  part: number;
  /** Points of the piece (the first point of a piece is the last of the one before). */
  pts: P2[];
  /** The piece runs against its way's own node order. */
  reversed: boolean;
}

export interface Draft {
  a: number;
  b: number;
  cls: string;
  link: boolean;
  oneway: boolean;
  name: string;
  parts: DraftPart[];
}

export interface CutResult {
  drafts: Draft[];
  /** Position of every node an edge ends at. */
  position: Map<number, P2>;
}

/**
 * Cuts runs at every node used by more than one run (or twice by one), then joins chains through nodes that only
 * two edge ends use when both sides have the same class, link flag and direction rule. `keep` nodes (clip ends) are
 * never joined through. Deterministic for a given run order.
 */
export function cutAndJoin(runs: readonly Run[], keep: ReadonlySet<number>): CutResult {
  // how often a node is used: an end counts once, a point inside a run twice
  const use = new Map<number, number>();
  for (const r of runs) r.nodes.forEach((id, i) => use.set(id, (use.get(id) ?? 0) + (i === 0 || i === r.nodes.length - 1 ? 1 : 2)));
  const drafts: Draft[] = [];
  const position = new Map<number, P2>();
  const partOf = new Map<Road, number>();
  for (const r of runs) {
    let start = 0;
    for (let i = 1; i < r.nodes.length; i++) {
      const last = i === r.nodes.length - 1;
      if (!last && (use.get(r.nodes[i] as number) ?? 0) <= 2) continue;
      const part = partOf.get(r.road) ?? 0;
      partOf.set(r.road, part + 1);
      drafts.push({ a: r.nodes[start] as number, b: r.nodes[i] as number, cls: r.road.cls, link: r.road.link, oneway: r.road.oneway, name: r.road.name, parts: [{ road: r.road, part, pts: r.pts.slice(start, i + 1), reversed: r.reversed === true }] });
      position.set(r.nodes[start] as number, r.pts[start] as P2);
      position.set(r.nodes[i] as number, r.pts[i] as P2);
      start = i;
    }
  }
  return { drafts: joinChains(drafts, keep), position };
}

function reverseDraft(d: Draft): void {
  [d.a, d.b] = [d.b, d.a];
  d.parts = d.parts.reverse().map((p) => ({ road: p.road, part: p.part, pts: p.pts.slice().reverse(), reversed: !p.reversed }));
}

/** Joins drafts through nodes with exactly two ends (one pass over a work list, no rebuild per join). */
function joinChains(input: Draft[], keep: ReadonlySet<number>): Draft[] {
  const alive = new Set<Draft>(input);
  const at = new Map<number, Draft[]>();
  const addAt = (id: number, d: Draft): void => {
    const list = at.get(id);
    if (list) list.push(d);
    else at.set(id, [d]);
  };
  for (const d of input) {
    addAt(d.a, d);
    if (d.b !== d.a) addAt(d.b, d);
  }
  const order = [...at.keys()];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of order) {
      const list = at.get(id);
      if (!list || list.length !== 2 || keep.has(id)) continue;
      const [p, q] = list as [Draft, Draft];
      if (p === q || p.a === p.b || q.a === q.b) continue;
      if (p.cls !== q.cls || p.link !== q.link || p.oneway !== q.oneway) continue;
      let first = p;
      let second = q;
      if (p.oneway) {
        if (p.b === id && q.a === id) [first, second] = [p, q];
        else if (q.b === id && p.a === id) [first, second] = [q, p];
        else continue;
      } else {
        if (first.b !== id) reverseDraft(first);
        if (second.a !== id) reverseDraft(second);
      }
      // the far end of `second` now belongs to `first`
      const far = second.b;
      first.b = far;
      first.parts.push(...second.parts);
      if (!first.name) first.name = second.name;
      alive.delete(second);
      at.delete(id);
      const farList = at.get(far);
      if (farList) {
        const k = farList.indexOf(second);
        if (k >= 0) {
          if (farList.includes(first)) farList.splice(k, 1); // the chain closed into a loop: one entry for it
          else farList[k] = first;
        }
      }
      changed = true;
    }
  }
  return input.filter((d) => alive.has(d));
}

export const draftPoints = (d: Draft): P2[] => d.parts.flatMap((part, i) => (i === 0 ? part.pts : part.pts.slice(1)));

function dirAt(d: Draft, atStart: boolean): P2 {
  const pts = draftPoints(d);
  const a = (atStart ? pts[0] : pts[pts.length - 2]) as P2;
  const b = (atStart ? pts[1] : pts[pts.length - 1]) as P2;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
}

export interface EndHint {
  /** Direction along the draft's own order at its start and at its end. */
  start?: P2;
  end?: P2;
}

/**
 * One tangent through a node: at every node, the two ends that run on into each other most nearly (under 45 degrees
 * apart; never two one-way ends that both arrive or both leave) share one direction there, so the reference line does
 * not kink at a node that only exists in the map. Clip ends keep their own direction.
 */
export function throughHints(drafts: readonly Draft[], keep: ReadonlySet<number>): Map<Draft, EndHint> {
  const hint = new Map<Draft, EndHint>();
  const endsAt = new Map<number, { d: Draft; atStart: boolean }[]>();
  for (const d of drafts) {
    for (const [id, atStart] of [[d.a, true], [d.b, false]] as [number, boolean][]) {
      const list = endsAt.get(id);
      if (list) list.push({ d, atStart });
      else endsAt.set(id, [{ d, atStart }]);
    }
  }
  for (const [id, list] of endsAt) {
    if (keep.has(id) || list.length < 2) continue;
    const towards = list.map((e) => {
      const dir = dirAt(e.d, e.atStart);
      // the direction of travel into the node along this end
      return e.atStart ? { x: -dir.x, z: -dir.z } : dir;
    });
    const cand: { i: number; j: number; dot: number }[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i] as { d: Draft; atStart: boolean };
        const q = list[j] as { d: Draft; atStart: boolean };
        if (p.d === q.d) continue;
        if (p.d.oneway && q.d.oneway && p.atStart === q.atStart) continue; // two that arrive or two that leave
        const tp = towards[i] as P2;
        const tq = towards[j] as P2;
        // walking through the node from p to q: into it along p, out of it along q
        cand.push({ i, j, dot: -(tp.x * tq.x + tp.z * tq.z) });
      }
    }
    cand.sort((x, y) => y.dot - x.dot || x.i - y.i || x.j - y.j);
    const taken = new Set<number>();
    for (const c of cand) {
      if (c.dot < Math.cos(Math.PI / 4) || taken.has(c.i) || taken.has(c.j)) continue;
      taken.add(c.i);
      taken.add(c.j);
      const p = list[c.i] as { d: Draft; atStart: boolean };
      const q = list[c.j] as { d: Draft; atStart: boolean };
      const tp = towards[c.i] as P2;
      const tq = towards[c.j] as P2;
      const sx = tp.x - tq.x;
      const sz = tp.z - tq.z;
      const len = Math.hypot(sx, sz) || 1;
      const through = { x: sx / len, z: sz / len };
      // as a direction along each draft's own order
      const hp = hint.get(p.d) ?? {};
      if (p.atStart) hp.start = { x: -through.x, z: -through.z };
      else hp.end = through;
      hint.set(p.d, hp);
      const hq = hint.get(q.d) ?? {};
      if (q.atStart) hq.start = through;
      else hq.end = { x: -through.x, z: -through.z };
      hint.set(q.d, hq);
    }
  }
  return hint;
}
