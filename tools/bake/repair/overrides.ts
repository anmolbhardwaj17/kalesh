// Overrides in the repair layer (OV1, MAP_REPAIR.md "Overrides format", "Verification"). A patch in a file of
// harness/data/overrides/ names its targets by stable id and by an anchor (latitude, longitude, tolerance). In a new
// extract the ids may have changed: the target is found by id first, then by the anchor within the tolerance, and a
// patch whose target is not there is listed as stale and stays in its file (the bake never writes the files).
// A resolved patch is applied by the one patch applier of the repair layer (apply.ts), the same one an automatic
// repair uses, and it takes the place of the repair of its issue: that issue is marked overridden. A patch with the
// action disable_repair switches off the repair of its issue instead of changing the map. Pure: the files are read
// by tools/bake/sources/overridesio.ts. A patch on an underground structure (graph/underground.ts, P1-041) is retired:
// the class already takes the structure out of every building rule, so the patch is kept in its file, listed in the
// health report with the outcome "underground" and not applied.
import type { P2 } from '../geom.ts';
import type { BlockGraph } from '../graph/build.ts';
import { projectOn } from '../rules/context.ts';
import type { Issue, Params, Patch } from '../rules/types.ts';
import { ADD_ACTIONS, addProblems, isAddAction, nearestEdge, parsePairs, projectAddParams } from './adds.ts';

export type Resolution = 'by_id' | 'by_anchor' | 'stale' | 'underground';

/** What became of a patch in the bake: fixed (applied), kept (a repair switched off), idle (nothing asked for it), stale, underground (retired: its footprint is an underground structure). */
export type OverrideOutcome = 'fixed' | 'kept' | 'idle' | 'stale' | 'underground';

/** A patch the engine does not apply: its target is gone, or it is an underground structure. */
export const unresolved = (o: { resolution: Resolution }): boolean => o.resolution === 'stale' || o.resolution === 'underground';

export interface OverrideEntry {
  /** The file name the patch came from ("<tileX>_<tileZ>.json"). */
  file: string;
  patch: Patch;
}

export interface ResolvedOverride {
  entry: OverrideEntry;
  resolution: Resolution;
  /** Ids of the targets in this extract (the same as the patch's when found by id). */
  targets: string[];
  /** The patch with every old id replaced by the id found in this extract: what the applier gets. */
  patch: Patch;
  /** Why the target is stale, or which ids were found again by the anchor. */
  note: string;
  applied: boolean;
  /** Issues this patch took the place of, by id. */
  issues: string[];
}

export interface OverrideRecord {
  id: string;
  issue: string;
  file: string;
  action: string;
  /** Who wrote the patch: owner (an inspector pick), judge (the top-view judge pass, P1-030), builder. */
  by: string;
  resolution: Resolution;
  outcome: OverrideOutcome;
  targets: string[];
  note: string;
  /** Issues the patch settled (their ids, as found in this bake). */
  issues: string[];
}

const ACTIONS = new Set<string>(['connect', 'terminate', 'remove', 'set_tag', 'move_node', 'set_lanes', 'set_height', 'replace_geometry', 'disable_repair', ...ADD_ACTIONS]);

/** Checks one patch from a file and returns what is wrong with it (empty when it is fine). */
export function patchProblems(p: unknown): string[] {
  const out: string[] = [];
  const o = p as Partial<Patch> | null;
  if (!o || typeof o !== 'object') return ['not an object'];
  if (typeof o.id !== 'string' || !o.id) out.push('no id');
  if (typeof o.issue !== 'string' || !o.issue) out.push('no issue');
  if (typeof o.action !== 'string' || !ACTIONS.has(o.action)) out.push(`action "${String(o.action)}" is not one of ${[...ACTIONS].join(', ')}`);
  const t = o.target;
  if (!t || !Array.isArray(t.ids) || !t.ids.every((x) => typeof x === 'string')) out.push('target.ids must be a list of ids');
  if (!t || !t.anchor || !Number.isFinite(t.anchor.lat) || !Number.isFinite(t.anchor.lon)) out.push('target.anchor needs a lat and a lon');
  if (!t || !Number.isFinite(t.tolerance_m) || t.tolerance_m < 0) out.push('target.tolerance_m must be a number of metres');
  if (!o.params || typeof o.params !== 'object') out.push('no params');
  else if (typeof o.action === 'string' && isAddAction(o.action)) out.push(...addProblems(o as Patch));
  return out;
}

/** Indexes of the features a patch can name: edges, footprints and stations of the graph, by id. */
interface Index {
  edges: Set<string>;
  footprints: Set<string>;
  stations: Set<string>;
  /** "way/<id>" (the source id the Phase 0 samples name roads by) to the first graph edge cut from that way. */
  ways: Map<string, string>;
  /** Ids of underground structures and their copies, to the structure's name. */
  underground: Map<string, string>;
}

function indexOf(g: BlockGraph): Index {
  const ways = new Map<string, string>();
  for (const e of g.edges) {
    const m = /^w(\d+)\./.exec(e.id);
    const key = m ? `way/${m[1]}` : '';
    if (key && (!ways.has(key) || e.id < (ways.get(key) as string))) ways.set(key, e.id);
  }
  const underground = new Map<string, string>();
  for (const u of g.underground ?? []) for (const id of [u.id, ...u.copies]) underground.set(id, u.name);
  return { edges: new Set(g.edges.map((e) => e.id)), footprints: new Set(g.footprints.map((f) => f.id)), stations: new Set((g.features.stations ?? []).map((s) => s.id)), ways, underground };
}

/** The id this graph knows a patch id by: itself, or the edge cut from the way it names; null when it is not here. */
const known = (ix: Index, id: string): string | null => (ix.edges.has(id) || ix.footprints.has(id) || ix.stations.has(id) ? id : (ix.ways.get(id) ?? null));
type Kind = 'station' | 'footprint' | 'edge' | 'any';
/** What a missing id was: a station by its node id, a road by a graph edge id, a way by its source id could be a road or a building (the patch may say). */
const kindOf = (id: string, hint: string | undefined): Kind => (id.startsWith('node/') ? 'station' : hint === 'road' ? 'edge' : hint === 'building' ? 'footprint' : id.startsWith('way/') ? 'any' : id.includes('/') ? 'footprint' : 'edge');

/** The feature of the wanted kind nearest to the anchor within the tolerance (metres), skipping ids already taken. */
function nearest(g: BlockGraph, anchor: P2, tol: number, kind: Kind, skip: ReadonlySet<string>): { id: string; d: number } | null {
  if (kind === 'any') {
    const a = nearest(g, anchor, tol, 'edge', skip);
    const b = nearest(g, anchor, tol, 'footprint', skip);
    return a && b ? (a.d <= b.d ? a : b) : (a ?? b);
  }
  let best: { id: string; d: number } | null = null;
  const take = (id: string, d: number): void => {
    if (d <= tol && !skip.has(id) && (!best || d < best.d)) best = { id, d };
  };
  if (kind === 'edge') {
    for (const e of g.edges) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const q of e.pts) {
        minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
      }
      if (anchor.x < minX - tol || anchor.x > maxX + tol || anchor.z < minZ - tol || anchor.z > maxZ + tol) continue;
      take(e.id, projectOn(anchor, e.pts).d);
    }
  } else if (kind === 'footprint') {
    for (const f of g.footprints) {
      let cx = 0, cz = 0;
      for (const q of f.ring) {
        cx += q.x; cz += q.z;
      }
      const n = f.ring.length || 1;
      // the nearest of its corners and its middle: a footprint is "at" the anchor when the anchor is on or beside it
      let d = Math.hypot(cx / n - anchor.x, cz / n - anchor.z);
      for (const q of f.ring) d = Math.min(d, Math.hypot(q.x - anchor.x, q.z - anchor.z));
      take(f.id, d);
    }
  } else {
    for (const s of g.features.stations ?? []) take(s.id, Math.hypot(s.x - anchor.x, s.z - anchor.z));
  }
  return best;
}

/** Replaces old ids by new ones inside every string of a params object (ids sit in comma separated lists). */
function remapParams(params: Params, map: ReadonlyMap<string, string>): Params {
  if (!map.size) return params;
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string' ? v.split(',').map((tok) => map.get(tok.trim()) ?? tok).join(',') : v;
  }
  return out;
}

/**
 * Finds a patch's targets in a graph: every id present means by id; otherwise each missing id is looked for at the
 * anchor (a road, a footprint or a station by the shape of the id) within the tolerance. One id missing and not found
 * makes the patch stale.
 */
export function resolveOverride(g: BlockGraph, entry: OverrideEntry, project: (lat: number, lon: number) => P2, ix: Index = indexOf(g)): ResolvedOverride {
  if (isAddAction(entry.patch.action)) return resolveAdd(g, entry, project, ix);
  const patch = entry.patch;
  const ids = patch.target.ids;
  const base = { entry, applied: false, issues: [] as string[] };
  const named = [...ids, ...['on', 'building'].flatMap((k) => String(patch.params[k] ?? '').split(','))].map((t) => t.trim()).find((t) => ix.underground.has(t));
  if (named !== undefined) return { ...base, resolution: 'underground', targets: [], patch, note: `${named} is ${ix.underground.get(named)}, an underground structure: no building rule sees it, so this patch is not needed and not applied` };
  const hints = String(patch.params['kinds'] ?? '').split(',');
  const found = ids.map((id) => known(ix, id));
  const taken = new Set(found.filter((f): f is string => f !== null));
  const map = new Map<string, string>();
  const targets: string[] = [];
  const notes: string[] = [];
  let anchor: P2 | null = null;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k] as string;
    const here = found[k] ?? null;
    if (here !== null) {
      targets.push(here);
      if (here !== id) map.set(id, here);
      continue;
    }
    anchor ??= project(patch.target.anchor.lat, patch.target.anchor.lon);
    const kind = kindOf(id, hints[k]?.trim());
    const hit = nearest(g, anchor, patch.target.tolerance_m, kind, taken);
    if (!hit) return { ...base, resolution: 'stale', targets: [], patch, note: `${id} is not in this extract and no ${kind === 'any' ? 'road or footprint' : kind} lies within ${patch.target.tolerance_m} m of the anchor` };
    taken.add(hit.id);
    map.set(id, hit.id);
    targets.push(hit.id);
    notes.push(`${id} is gone; ${hit.id} lies ${Math.round(hit.d * 10) / 10} m from the anchor`);
  }
  const resolution: Resolution = notes.length ? 'by_anchor' : 'by_id';
  if (!map.size) return { ...base, resolution, targets, patch, note: 'every target id is in this extract' };
  const remapped: Patch = { ...patch, target: { ...patch.target, ids: targets }, params: remapParams(patch.params, map) };
  return { ...base, resolution, targets, patch: remapped, note: notes.length ? notes.join('; ') : `${[...map].map(([a, b]) => `${a} is ${b} here`).join('; ')}` };
}

/**
 * An add patch (P1-045) in this extract. Its drawn geometry goes from latitude and longitude into block metres. The
 * roads it names (target ids and the join ids of an added road) are found by id; one that is gone is found again
 * under the drawn points within the tolerance (by anchor), and its join id becomes "snap"; with nothing there the
 * patch is stale. A patch with no ids at all is by_id: its drawn points are its only target.
 */
function resolveAdd(g: BlockGraph, entry: OverrideEntry, project: (lat: number, lon: number) => P2, ix: Index): ResolvedOverride {
  const patch = entry.patch;
  const base = { entry, applied: false, issues: [] as string[] };
  const params = projectAddParams(patch.params, project);
  const drawn: P2[] = [];
  for (const [x, z] of parsePairs(params['pts']) ?? []) drawn.push({ x, z });
  if (typeof params['x'] === 'number' && typeof params['z'] === 'number') drawn.push({ x: params['x'], z: params['z'] });
  if (!drawn.length) return { ...base, resolution: 'stale', targets: [], patch, note: 'the patch has no drawn geometry' };
  const tol = patch.target.tolerance_m;
  const nodes = new Set(g.nodes.map((n) => n.id));
  const has = (id: string): string | null => (nodes.has(id) ? id : known(ix, id));
  const notes: string[] = [];
  const targets: string[] = [];
  for (const id of patch.target.ids) {
    const here = has(id);
    if (here !== null) {
      targets.push(here);
      continue;
    }
    const hit = drawn.map((p) => nearestEdge(g, p, tol)).find((h) => h !== null);
    if (!hit) return { ...base, resolution: 'stale', targets: [], patch, note: `${id} is not in this extract and no road lies within ${tol} m of the drawn points` };
    targets.push(hit.e.id);
    notes.push(`${id} is gone; ${hit.e.id} lies ${Math.round(hit.d * 10) / 10} m from the drawn points`);
  }
  for (const key of ['join_a', 'join_b']) {
    const v = params[key];
    if (typeof v !== 'string' || v === 'snap' || v === 'none' || has(v) !== null) continue;
    params[key] = 'snap';
    notes.push(`${key} ${v} is gone: the end snaps to the nearest road`);
  }
  const resolution: Resolution = notes.length ? 'by_anchor' : 'by_id';
  const out: Patch = { ...patch, target: { ...patch.target, ids: targets }, params };
  return { ...base, resolution, targets, patch: out, note: notes.length ? notes.join('; ') : patch.target.ids.length ? 'every target id is in this extract' : 'drawn geometry, found by its points' };
}

export function resolveOverrides(g: BlockGraph, entries: readonly OverrideEntry[], project: (lat: number, lon: number) => P2): ResolvedOverride[] {
  const ix = indexOf(g);
  return entries.map((e) => resolveOverride(g, e, project, ix));
}

/**
 * True when a patch is for this issue: the same issue id, or the same rule with every target among the issue's
 * features (the ids of the issue changed because the extract did, the place did not).
 */
export function overrideMatches(o: ResolvedOverride, issue: Pick<Issue, 'id' | 'rule' | 'features'>): boolean {
  if (o.resolution === 'underground') return false;
  if (o.entry.patch.issue === issue.id) return true;
  if (unresolved(o) || !o.targets.length) return false;
  if (o.entry.patch.issue.split(':')[0] !== issue.rule) return false;
  const has = (t: string): boolean => issue.features.some((f) => f === t || f.startsWith(`${t}/`) || t.startsWith(`${f}/`));
  return o.targets.every(has);
}

/** The first patch that is for an issue (files are read in name order, so this is stable). */
export const overrideFor = (list: readonly ResolvedOverride[], issue: Pick<Issue, 'id' | 'rule' | 'features'>): ResolvedOverride | undefined => list.find((o) => overrideMatches(o, issue));

export const isDisable = (o: ResolvedOverride): boolean => o.entry.patch.action === 'disable_repair';

/** One record per patch, for health.json: the outcome follows from what the engine did with it. */
export function overrideRecords(list: readonly ResolvedOverride[], failed: ReadonlyMap<ResolvedOverride, string>): OverrideRecord[] {
  return list.map((o) => {
    const refused = failed.get(o);
    let outcome: OverrideOutcome;
    let note = o.note;
    if (o.resolution === 'stale') outcome = 'stale';
    else if (o.resolution === 'underground') outcome = 'underground';
    else if (refused !== undefined) {
      outcome = 'stale';
      note = `${o.note ? `${o.note}; ` : ''}the patch no longer fits: ${refused}`;
    } else if (isDisable(o)) outcome = o.issues.length ? 'kept' : 'idle';
    else outcome = o.applied ? 'fixed' : 'idle';
    const p = o.entry.patch;
    return { id: p.id, issue: p.issue, file: o.entry.file, action: p.action, by: String(p.by ?? ''), resolution: o.resolution, outcome, targets: o.targets, note, issues: o.issues };
  });
}

export interface OverrideCounts {
  files: number;
  patches: number;
  byId: number;
  byAnchor: number;
  stale: number;
  /** Patches that changed the map or the decisions (everything but disable_repair). */
  applied: number;
  /** Repairs switched off by a disable_repair patch. */
  switchedOff: number;
  idle: number;
  /** Issues settled by a patch (status overridden). */
  issuesSettled: number;
  /** Patches retired because their footprint is an underground structure (kept in their files, not applied). */
  underground: number;
}

export function overrideCounts(records: readonly OverrideRecord[], issuesSettled: number): OverrideCounts {
  return {
    files: new Set(records.map((r) => r.file)).size,
    patches: records.length,
    byId: records.filter((r) => r.resolution === 'by_id').length,
    byAnchor: records.filter((r) => r.resolution === 'by_anchor').length,
    stale: records.filter((r) => r.outcome === 'stale').length,
    applied: records.filter((r) => r.outcome === 'fixed').length,
    switchedOff: records.filter((r) => r.outcome === 'kept').length,
    idle: records.filter((r) => r.outcome === 'idle').length,
    issuesSettled,
    underground: records.filter((r) => r.outcome === 'underground').length,
  };
}
