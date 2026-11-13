// Turn rules from the map (P1-032, MAP_REPAIR.md "Lane-level road model"): OSM turn restriction relations and
// turn:lanes tags, read into what the junction planner (connect.ts planTurns) takes. A restriction names OSM ways and
// a via node or via ways; the lane model knows block graph edges (chains of way pieces) and junction clusters, so a
// restriction becomes "from edge, to edge, at the cluster that holds this node". turn:lanes lists the lanes of one
// direction from left to right as the driver sees them; in Delhi (left-hand traffic) that is kerb lane first, the
// order connect.ts `arriving` gives. Reference turn lanes (harness/data/turn_lanes.json, read from satellite or
// photos where OSM has none) come in the same shape and win over OSM. Pure.
import type { GraphEdge, GraphNode } from '../graph/build.ts';
import type { P2 } from '../geom.ts';
import type { OsmElement } from '../osm.ts';
import type { TurnKind, TurnRestriction } from './connect.ts';

/** A restriction relation as read: OSM ids as "way/<id>" and "n<id>" (the graph's node id form). */
export interface OsmRestriction {
  id: string;
  kind: 'no' | 'only';
  /** The restriction value: no_left_turn, only_straight_on, no_u_turn, ... */
  type: string;
  from: string[];
  to: string[];
  viaNode: string | null;
  viaWays: string[];
}

/** Turn lane designations of one way and how to tell which direction arrives at a node. */
export interface WayTurns {
  way: string;
  /** Lanes of the way's own direction (turn:lanes on a one-way way, or turn:lanes:forward), left to right. */
  forward: string[][] | null;
  backward: string[][] | null;
  /** Node ids ("n<id>") and plan positions of the way, in its order. */
  nodes: string[];
  pts: P2[];
  /** Where the tags came from: the OSM extract, or a reference entry (satellite, photo). */
  source: string;
}

export interface TurnInputs {
  restrictions: OsmRestriction[];
  /** Relations that could not be read (no from, no to, no via, an unknown value). */
  unread: { id: string; why: string }[];
  wayTurns: Map<string, WayTurns>;
}

/** Restriction values the planner can apply (the rest, like no_entry on a node, are counted as unread). */
const KINDS = /^(no|only)_(left_turn|right_turn|straight_on|u_turn)$/;

/** Reads restriction relations and turn lane tags out of OSM elements (the osm_turns pin). */
export function readTurnElements(elements: readonly OsmElement[], project: (lat: number, lon: number) => P2, nodeAt: (id: number) => { lat: number; lon: number } | null): TurnInputs {
  const out: TurnInputs = { restrictions: [], unread: [], wayTurns: new Map() };
  for (const el of elements) {
    if (el.type === 'relation' && el.tags?.['type'] === 'restriction') {
      const id = `relation/${el.id}`;
      const value = el.tags['restriction'] ?? Object.entries(el.tags).find(([k]) => k.startsWith('restriction:'))?.[1] ?? '';
      if (el.tags['restriction'] === undefined) {
        out.unread.push({ id, why: `only a vehicle or condition restriction (${Object.keys(el.tags).filter((k) => k.startsWith('restriction')).join(', ')}): not for every vehicle` });
        continue;
      }
      if (!KINDS.test(value)) {
        out.unread.push({ id, why: `restriction=${value} is not a turn the planner applies` });
        continue;
      }
      const members = el.members ?? [];
      const from = members.filter((m) => m.role === 'from' && m.type === 'way').map((m) => `way/${m.ref}`);
      const to = members.filter((m) => m.role === 'to' && m.type === 'way').map((m) => `way/${m.ref}`);
      const vn = members.find((m) => m.role === 'via' && m.type === 'node');
      const vw = members.filter((m) => m.role === 'via' && m.type === 'way').map((m) => `way/${m.ref}`);
      if (!from.length || !to.length || (!vn && !vw.length)) {
        out.unread.push({ id, why: 'a from, to or via member is missing' });
        continue;
      }
      out.restrictions.push({ id, kind: value.startsWith('only') ? 'only' : 'no', type: value, from, to, viaNode: vn ? `n${vn.ref}` : null, viaWays: vw });
    } else if (el.type === 'way' && el.tags?.['highway']) {
      const t = wayTurnsOf(el, project, nodeAt, 'osm');
      if (t) out.wayTurns.set(t.way, t);
    }
  }
  out.restrictions.sort((a, b) => (a.id < b.id ? -1 : 1));
  return out;
}

/** turn:lanes value to designations per lane: "left|through;right|" to [["left"], ["through", "right"], ["none"]]. */
export function parseTurnLanes(v: string): string[][] {
  return v.split('|').map((lane) => {
    const d = lane.split(';').map((x) => x.trim()).filter((x) => x.length > 0);
    return d.length ? d : ['none'];
  });
}

/** The turn lanes of a way from its tags (OSM, or a reference entry's tags in the same names), or null when it has none. */
export function wayTurnsOf(el: Pick<OsmElement, 'id' | 'nodes' | 'tags'>, project: (lat: number, lon: number) => P2, nodeAt: (id: number) => { lat: number; lon: number } | null, source: string): WayTurns | null {
  const tags = el.tags ?? {};
  const oneway = tags['oneway'] === 'yes' || tags['oneway'] === '1' || tags['junction'] === 'roundabout';
  const reverse = tags['oneway'] === '-1';
  const any = tags['turn:lanes'];
  let forward = tags['turn:lanes:forward'] ? parseTurnLanes(tags['turn:lanes:forward']) : null;
  let backward = tags['turn:lanes:backward'] ? parseTurnLanes(tags['turn:lanes:backward']) : null;
  if (any) {
    if (reverse) backward = backward ?? parseTurnLanes(any);
    else if (oneway || !forward) forward = forward ?? parseTurnLanes(any);
  }
  if (!forward && !backward) return null;
  const nodes: string[] = [];
  const pts: P2[] = [];
  for (const n of el.nodes ?? []) {
    const ll = nodeAt(n);
    if (!ll) continue;
    nodes.push(`n${n}`);
    pts.push(project(ll.lat, ll.lon));
  }
  if (pts.length < 2) return null;
  return { way: `way/${el.id}`, forward, backward, nodes, pts, source };
}

export interface MappedRestriction extends TurnRestriction {
  via: string;
  relation: string;
}

export interface RestrictionReport {
  relations: number;
  /** Relations that became at least one edge pair at a node of the graph. */
  mapped: number;
  unmapped: { id: string; why: string }[];
  unread: { id: string; why: string }[];
  byType: Record<string, number>;
}

/**
 * Restrictions on block graph edges: the from edge carries a piece of a from way and ends at a node the via touches
 * (the via node, or an end of an edge along a via way), the to edge likewise. A via way inside one junction cluster
 * (the usual case: the short link between the two carriageways of a divided road) then names one cluster; the
 * planner applies a restriction only at the cluster that holds its via node.
 */
export function mapRestrictions(nodes: readonly GraphNode[], edges: readonly GraphEdge[], t: TurnInputs): { list: MappedRestriction[]; report: RestrictionReport } {
  const byWay = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    for (const p of e.pieces) {
      const l = byWay.get(p.way);
      if (l) {
        if (!l.includes(e)) l.push(e);
      } else byWay.set(p.way, [e]);
    }
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const report: RestrictionReport = { relations: t.restrictions.length + t.unread.length, mapped: 0, unmapped: [], unread: t.unread.slice(), byType: {} };
  const list: MappedRestriction[] = [];
  for (const r of t.restrictions) {
    report.byType[r.type] = (report.byType[r.type] ?? 0) + 1;
    const via = new Set<string>();
    if (r.viaNode && nodeIds.has(r.viaNode)) via.add(r.viaNode);
    for (const w of r.viaWays) for (const e of byWay.get(w) ?? []) {
      via.add(e.a);
      via.add(e.b);
    }
    if (!via.size) {
      report.unmapped.push({ id: r.id, why: r.viaNode ? `via node ${r.viaNode} is not a node of the graph (joined or cut by the repair)` : 'no edge carries the via way' });
      continue;
    }
    const at = (ways: readonly string[]): { e: GraphEdge; node: string }[] => {
      const found: { e: GraphEdge; node: string }[] = [];
      for (const w of ways) for (const e of byWay.get(w) ?? []) for (const n of [e.a, e.b]) if (via.has(n) && !found.some((f) => f.e === e && f.node === n)) found.push({ e, node: n });
      return found;
    };
    const from = at(r.from);
    const to = at(r.to);
    if (!from.length || !to.length) {
      report.unmapped.push({ id: r.id, why: !from.length ? 'no edge of the from way ends at the via' : 'no edge of the to way ends at the via' });
      continue;
    }
    let n = 0;
    for (const f of from) {
      for (const g of to) {
        if (f.e.id === g.e.id && r.type !== 'no_u_turn') continue;
        list.push({ from: f.e.id, to: g.e.id, kind: r.kind, via: f.node, relation: r.id });
        n++;
        // a via way chain that runs from one junction to another: where traffic can enter the chain only from the
        // from edge, "from, via, to" is the same as "last via edge, to" at the junction the to edge leaves
        if (r.kind === 'no' && r.viaWays.length && f.node !== g.node) {
          const chain = r.viaWays.flatMap((w) => byWay.get(w) ?? []);
          const last = chain.find((e) => e.oneway && e.b === g.node);
          const first = chain.find((e) => e.oneway && e.a === f.node);
          if (!last || !first || !chain.every((e) => e.oneway)) continue;
          const feeders = edges.filter((e) => e !== first && ((e.b === f.node) || (!e.oneway && e.a === f.node)));
          if (feeders.length === 1 && feeders[0] === f.e) list.push({ from: last.id, to: g.e.id, kind: 'no', via: g.node, relation: r.id });
        }
      }
    }
    if (n) report.mapped++;
    else report.unmapped.push({ id: r.id, why: 'from and to are one edge' });
  }
  return { list, report };
}

/** Designations that allow a movement of each kind (merge_to_* lanes go on straight). */
const ALLOWS: Readonly<Record<TurnKind, readonly string[]>> = {
  left: ['left', 'slight_left', 'sharp_left'],
  right: ['right', 'slight_right', 'sharp_right'],
  straight: ['through', 'none', 'merge_to_left', 'merge_to_right'],
  u: ['reverse'],
};

export const laneAllows = (designation: readonly string[], kind: TurnKind): boolean => designation.some((d) => ALLOWS[kind].includes(d));

/**
 * The designations of the lanes that arrive at a junction along an arm, kerb lane first, or null. `node` is the
 * arm's junction node, (ox, oz) the arm's direction away from the junction. When the arm is the part of the way after
 * the node (the way runs on away from the junction along it), its traffic arrives against the way: the backward lanes.
 */
export function arrivingTurns(t: WayTurns, node: string, ox: number, oz: number): string[][] | null {
  const i = t.nodes.indexOf(node);
  if (i < 0) return null;
  const last = t.nodes.length - 1;
  let after: boolean;
  if (i === last) after = false;
  else if (i === 0) after = true;
  else {
    const a = t.pts[i] as P2;
    const b = t.pts[i + 1] as P2;
    after = (b.x - a.x) * ox + (b.z - a.z) * oz > 0;
  }
  return after ? t.backward : t.forward;
}
