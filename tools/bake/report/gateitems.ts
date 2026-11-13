// The items behind the six gate counts (P1-017), gathered from the step records in memory: open boundary ports from
// the repaired graph and the lane model, lane breaks and tapers from the lane checks, floating ends, unjoined ends and
// overlapping faces from the mesh checks. Ids are stable across bakes of the same pinned data (strip ids come from
// OSM way ids), so harness/data/gate_explanations.json can name them. Pure.
import type { MeshChecks } from '../mesh/checks.ts';
import type { RepairedGraph } from '../repair/engine.ts';
import type { LaneChecks } from '../roads/lanechecks.ts';
import type { LaneBuild } from '../roads/network.ts';
import type { GateItem, GateKey } from './gates.ts';

/** Names of the strips by id, for the report. */
const namer = (b: LaneBuild) => {
  const by = new Map(b.strips.map((s) => [s.id, s]));
  return (id: string): string => {
    const s = by.get(id);
    return s ? `${s.name || `(no name, ${s.cls})`}` : id;
  };
};

/**
 * Open boundary ports: a road that leaves the stage must end in a strip end the lane model explains as `map_edge`
 * (the road goes on in the next stage, tied to its height at the outline). A map edge node a junction took in, or a
 * stub of a junction there, is a port with no way on.
 */
export function openPortItems(g: Pick<RepairedGraph, 'nodes' | 'edges'>, b: LaneBuild): GateItem[] {
  const ends = new Map(b.ends.map((e) => [e.node, e]));
  const inJunction = new Map<string, string>();
  for (const j of b.junctions) for (const n of j.nodes) inJunction.set(n, j.id);
  const internal = new Map(b.internal.map((i) => [i.edge, i.why]));
  const out: GateItem[] = [];
  for (const n of g.nodes) {
    if (n.kind !== 'map_edge') continue;
    const end = ends.get(n.id);
    if (end?.kind === 'map_edge') continue;
    const e = g.edges.find((x) => x.a === n.id || x.b === n.id);
    const name = e ? e.name || `(no name, ${e.road?.cls ?? 'road'})` : '(no edge)';
    const base = { id: n.id, name, x: n.x, z: n.z };
    if (end) out.push({ ...base, kind: `stage_edge_${end.kind}`, detail: `the lane model ends the road here as ${end.kind}: ${end.why}` });
    else if (inJunction.has(n.id)) out.push({ ...base, kind: 'stage_edge_junction', detail: `junction ${inJunction.get(n.id)} takes in the map edge node: the road leaves the stage through the junction surface` });
    else if (e && internal.has(e.id)) out.push({ ...base, kind: 'stage_edge_junction', detail: `edge ${e.id} is inside a junction (${internal.get(e.id)})` });
    else out.push({ ...base, kind: 'stage_edge_no_strip', detail: `edge ${e?.id ?? '?'} has no strip at the outline` });
  }
  return out;
}

/** Items of a list that may be cut short (the check keeps the first n): the rest become one unlisted item, never explained. */
const rest = (count: number, listed: number, gate: string): GateItem[] =>
  count > listed ? [{ id: `${gate}:unlisted`, kind: 'unlisted', name: '', detail: `${count - listed} more not listed by the check` }] : [];

export function gateItems(g: Pick<RepairedGraph, 'nodes' | 'edges'>, b: LaneBuild, lc: LaneChecks, mc: MeshChecks): Record<GateKey, GateItem[]> {
  const name = namer(b);
  const unjoined = mc.ends.unjoinedList.map((e) => ({ id: `${e.strip} ${e.end}`, kind: 'unjoined_end', name: name(e.strip), x: e.x, z: e.z, detail: `${e.end} of ${e.strip} touches no strip, junction or explained end` }));
  const floating = mc.ends.floatingList.map((e) => ({ id: `${e.strip} ${e.end}`, kind: `floating_${e.kind}`, name: name(e.strip), x: e.x, z: e.z, detail: `${e.kind} end ${e.aboveGroundM} m above the ground with no road on` }));
  const o = mc.overlap;
  const pairs = [...o.worst.filter((w) => w.areaM2 > 0.01).slice(0, o.pairsOver), ...o.stripPairs.worst.slice(0, o.stripPairs.pairs)].map((w) => ({ id: `${w.a}|${w.b}`, kind: 'faces_on_each_other', name: `${name(w.a)} on ${name(w.b)}`, x: w.x, z: w.z, detail: `${w.areaM2} m2 under both` }));
  const breaks = lc.continuity.list.map((l) => ({ id: `${l.strip} lane ${l.lane}`, kind: 'lane_break', name: name(l.strip), detail: l.why }));
  const tapers = lc.tapers.list.map((t) => {
    const ex = lc.tapers.explained.find((x) => x.strip === t.strip);
    return { id: t.strip, kind: 'taper', name: name(t.strip), detail: `${t.cls}: ${t.lengthM} m for a ${t.shiftM} m shift (needs ${t.neededM} m)`, ...(ex ? { why: ex.why } : {}) };
  });
  const steps = lc.widthSteps.list.map((w) => ({ id: `${w.where} ${w.a.join('+')}|${w.b.join('+')}`, kind: `width_step_${w.kind}`, name: w.names.filter((n) => n).join(' / ') || w.classes.join(' / '), x: w.x, z: w.z, detail: `${w.fromM} m to ${w.toM} m of carriageway (${w.classes.join(', ')})` }));
  return {
    openPorts: openPortItems(g, b),
    floatingEnds: [...floating, ...rest(mc.ends.floating, floating.length, 'floatingEnds')],
    unjoinedEnds: [...unjoined, ...rest(mc.ends.unjoined, unjoined.length, 'unjoinedEnds')],
    overlappingRoadFaces: [...pairs, ...rest(o.pairsOver + o.stripPairs.pairs, pairs.length, 'overlappingRoadFaces')],
    laneContinuityBreaks: [...breaks, ...rest(lc.continuity.breaks, breaks.length, 'laneContinuityBreaks')],
    tapersOutOfLimits: [...tapers, ...rest(lc.tapers.violations, tapers.length, 'tapersOutOfLimits')],
    widthSteps: [...steps, ...rest(lc.widthSteps.steps, steps.length, 'widthSteps')],
  };
}
