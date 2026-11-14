// Who may use each road (P2-042, Anmol 2026-11-14: "some roads are roads but cars cannot go"; "it's not even OSM
// rules, we have to have common sense too for some areas"). One access record per graph edge: the modes allowed on
// its carriageway lanes and the reason the last change was made. Pure: the driver (sources/accessio.ts) reads the
// rules file and the area index and hands them in as data and functions.
//
// Modes: car, auto (the three-wheeler), two_wheeler (scooters and motorcycles), cycle (bicycles and cycle rickshaws),
// foot (walkers on the carriageway itself: a shared lane, a pedestrian street; walkers on a main road use its
// footpaths, not its lanes) and emergency (fire, ambulance and police vehicles).
//
// Steps, each one may change the modes and becomes the reason (counted in health.json access.byReason):
//   class      the Delhi default of the road class (a pedestrian street: foot, cycle, emergency; a motorway: cars)
//   osm_tag    the way's access, vehicle, motor_vehicle, motorcar, motorcycle, bicycle and foot tags (OSM is one input)
//   osm_barrier a barrier node on the way that stops cars (bollard, block, locked gate)
//   width      common sense: a carriageway under 2.8 m takes no car or auto, under 1.6 m no two-wheeler
//   surface    common sense: an unpaved minor way takes no car or auto
//   context    common sense: a minor way inside a park or lawn is foot first; old city galis (rules file, kind context)
//   rule       a Delhi rule from references (rules file, kind rule): Chandni Chowk main road, inside the India Gate hexagon
//   judge      a decision of the top-view judge pass (rules file, by judge)
//   owner      Anmol's word or an inspector pick (rules file, by owner): overrides everything
import type { P2 } from '../geom.ts';
import { pointInRing } from '../geom.ts';

export const MODES = ['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency'] as const;
export type Mode = (typeof MODES)[number];
export type AccessReason = 'class' | 'osm_tag' | 'osm_barrier' | 'width' | 'surface' | 'context' | 'rule' | 'judge' | 'owner';
export const REASONS: readonly AccessReason[] = ['class', 'osm_tag', 'osm_barrier', 'width', 'surface', 'context', 'rule', 'judge', 'owner'];

/** The OSM keys an edge carries for this model (graph/build.ts `edgeAccessTags`). */
export const ACCESS_KEYS = ['access', 'vehicle', 'motor_vehicle', 'motorcar', 'motorcycle', 'moped', 'bicycle', 'foot', 'emergency', 'motor_vehicle:conditional', 'access:conditional', 'surface'] as const;

/** A carriageway narrower than this takes no car or auto (a car is 1.7 m wide plus a margin each side). */
export const CAR_MIN_WIDTH_M = 2.8;
/** Narrower than this takes no two-wheeler. */
export const TWO_WHEELER_MIN_WIDTH_M = 1.6;
/** Narrower than this takes no cycle rickshaw (a bicycle still fits; the cycle mode covers both). */
export const CYCLE_MIN_WIDTH_M = 1.2;

/** Classes whose lanes are shared with walkers (no footpath beside them as a rule). */
export const SHARED_CLASSES: ReadonlySet<string> = new Set(['residential', 'living_street', 'service', 'unclassified', 'pedestrian', 'track', 'road']);
/** Minor classes a context rule may close to cars (never a through road of tertiary class or above). */
export const MINOR_CLASSES: ReadonlySet<string> = SHARED_CLASSES;
/** Open ground kinds (osm.ts openKind) whose minor ways are foot first. A stadium or golf course is not. */
export const FOOT_FIRST_OPEN: ReadonlySet<string> = new Set([
  'leisure=park', 'leisure=garden', 'leisure=playground', 'leisure=recreation_ground', 'landuse=grass', 'landuse=recreation_ground', 'landuse=meadow', 'landuse=village_green', 'landuse=forest', 'natural=grassland', 'natural=wood', 'natural=scrub',
]);
const UNPAVED = new Set(['unpaved', 'dirt', 'earth', 'ground', 'grass', 'sand', 'mud', 'gravel', 'fine_gravel', 'pebblestone', 'compacted', 'woodchips', 'grass_paver']);

export interface EdgeAccess {
  modes: Mode[];
  reason: AccessReason;
  /** One plain line: why the modes are what they are. */
  why: string;
  /** The rules file entry that decided it (rule, context, judge, owner). */
  rule?: string;
  /** The hours a time rule holds (the game models the day: the rule applies). */
  hours?: string;
  /** access=private, destination or customers: allowed, never a through route for traffic. */
  private?: true;
  /** Where cars meet this edge: a line of bollards across it (rule or OSM tag), or nothing (a violation only). */
  barrier?: 'bollards';
}

export interface AccessEdge {
  id: string;
  cls: string;
  link: boolean;
  name: string;
  /** Carriageway width (m) of the repaired graph. */
  width: number;
  /** The OSM keys of ACCESS_KEYS the edge's ways carry (graph/build.ts). */
  tags: Readonly<Record<string, string>>;
  ways: readonly string[];
  pts: readonly P2[];
}

/** A barrier node of OSM on the edge (graph features.barriers). */
export interface EdgeBarrier {
  id: string;
  kind: string;
  /** True when it stops a car (barrierStops). */
  stopsCar: boolean;
  stopsTwoWheeler: boolean;
  /** The gate is not open to the public (access private or no, locked, or untagged): see AccessMatch.gate. */
  restricted?: boolean;
}

export interface AccessMatch {
  /** "way/<id>" */
  ways?: readonly string[];
  edges?: readonly string[];
  /** A regular expression on the edge name. */
  name?: string;
  classes?: readonly string[];
  /** Every point of the edge within this circle (block metres; the driver projects lat and lon). */
  within?: { x: number; z: number; r: number };
  /** The edge's middle point lies in a drawn area of these ids, or in an area or rule cell of these archetypes. */
  areas?: readonly string[];
  archetypes?: readonly string[];
  /** Only edges at most this wide (m). */
  maxWidthM?: number;
  /** Not edges whose name matches this. */
  notName?: string;
  /** The edge lies in one of these zones of the rules file (a drawn ring: its middle point; a set of circles: every sample point inside one circle). */
  zones?: readonly string[];
  /** The edge carries a gate node of OSM that is not open to the public (access private or no, locked, or no access tag at all): a government or compound gate. */
  gate?: 'restricted';
  /** The edge's OSM keys hold one of these "key=value" pairs (service access tags: a forecourt road that still takes deliveries). */
  tagged?: readonly string[];
  /** Not when the edge's OSM keys hold one of these "key=value" pairs. */
  notTagged?: readonly string[];
}

export interface AccessRule {
  id: string;
  /** rule and context are the bake's own (references); judge and owner are decisions on top. */
  by: 'rule' | 'judge' | 'owner';
  kind?: 'rule' | 'context';
  why: string;
  refs: readonly string[];
  modes: readonly Mode[];
  hours?: string;
  barrier?: 'bollards' | 'none';
  /** Allowed but never a through route for traffic (a service access). */
  private?: boolean;
  match: AccessMatch;
}

/** A zone of the rules file as a test of an edge's sample points (the driver builds it from circles or a ring). */
export type ZoneTest = (s: { all: readonly P2[]; mid: P2 }) => boolean;

export interface AccessContext {
  rules: readonly AccessRule[];
  /** The open ground kind holding a point, or null (graph features.open). */
  openAt: (x: number, z: number) => string | null;
  /** The area id and archetype holding a point (areas/profiles.ts resolveAt), or null. */
  areaAt: (x: number, z: number) => { id: string; archetype: string } | null;
  /** Barrier nodes by edge id. */
  barriers: ReadonlyMap<string, readonly EdgeBarrier[]>;
  /** The zones of the rules file by id. */
  zones?: ReadonlyMap<string, ZoneTest>;
}

const sortModes = (set: ReadonlySet<Mode>): Mode[] => MODES.filter((m) => set.has(m));

/** The Delhi default of a class (link roads take their class's). */
export function classModes(cls: string): Mode[] {
  if (cls === 'motorway') return ['car', 'emergency'];
  if (cls === 'pedestrian') return ['cycle', 'foot', 'emergency'];
  if (cls === 'track') return ['two_wheeler', 'cycle', 'foot', 'emergency'];
  if (SHARED_CLASSES.has(cls)) return [...MODES];
  return ['car', 'auto', 'two_wheeler', 'cycle', 'emergency'];
}

/** Values of an access key: undefined (no say), true (allowed) or false (not allowed); private counts as allowed. */
export function tagSays(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'no' || s === 'agricultural' || s === 'forestry' || s === 'delivery' || s === 'use_sidepath' || s === 'discouraged') return false;
  if (s === 'yes' || s === 'designated' || s === 'permissive' || s === 'destination' || s === 'customers' || s === 'private' || s === 'official') return true;
  return undefined;
}

/** "no @ (09:00-21:00)" and the like: the value and the hours, or null. */
export function conditional(v: string | undefined): { value: string; hours: string } | null {
  if (v === undefined) return null;
  const m = /^\s*([a-z_]+)\s*@\s*\(?\s*([^)]*?)\s*\)?\s*$/i.exec(v);
  return m ? { value: (m[1] as string).toLowerCase(), hours: (m[2] as string).trim() } : null;
}

/**
 * The modes the OSM tags give, from the general key to the specific one (access, vehicle, motor_vehicle, then
 * motorcar, motorcycle, bicycle, foot, emergency), starting from the class default. A daytime conditional applies.
 */
export function tagModes(base: readonly Mode[], tags: Readonly<Record<string, string>>): { modes: Mode[]; changed: boolean; hours?: string; private: boolean } {
  const on = new Set<Mode>(base);
  const start = sortModes(on).join(',');
  const set = (modes: readonly Mode[], v: boolean | undefined): void => {
    if (v === undefined) return;
    for (const m of modes) {
      if (v) on.add(m);
      else on.delete(m);
    }
  };
  const access = tags['access'];
  // a general "yes" never opens what the class keeps out (a pedestrian street tagged access=yes stays car-free)
  if (tagSays(access) === false) set(['car', 'auto', 'two_wheeler', 'cycle', 'foot'], false);
  set(['car', 'auto', 'two_wheeler', 'cycle'], tagSays(tags['vehicle']) === false ? false : undefined);
  let hours: string | undefined;
  let mv = tagSays(tags['motor_vehicle']);
  const cond = conditional(tags['motor_vehicle:conditional']) ?? conditional(tags['access:conditional']);
  if (cond) {
    const c = tagSays(cond.value);
    // the game plays the day: a rule of the day (09:00-21:00, "Mo-Su 08:00-22:00") holds
    if (c !== undefined && /\d{1,2}:\d{2}/.test(cond.hours)) {
      mv = c;
      hours = cond.hours;
    }
  }
  if (mv === false) set(['car', 'auto', 'two_wheeler'], false);
  else if (mv === true && tagSays(access) === false) set(['car', 'auto', 'two_wheeler'], true);
  const car = tagSays(tags['motorcar']);
  set(['car', 'auto'], car === false ? false : car === true && (mv === false || tagSays(access) === false) ? true : undefined);
  const moto = tagSays(tags['motorcycle']) ?? tagSays(tags['moped']);
  set(['two_wheeler'], moto === false ? false : moto === true && (mv === false || tagSays(access) === false) ? true : undefined);
  set(['cycle'], tagSays(tags['bicycle']));
  set(['foot'], tagSays(tags['foot']));
  if (tagSays(tags['emergency']) === false) on.delete('emergency');
  const modes = sortModes(on);
  const priv = ['private', 'destination', 'customers'].includes((access ?? '').trim().toLowerCase());
  return { modes, changed: modes.join(',') !== start, ...(hours ? { hours } : {}), private: priv };
}

/** What a barrier node does to the traffic through it. */
export function barrierStops(kind: string, tags: Readonly<Record<string, string>>): { car: boolean; twoWheeler: boolean } {
  const k = kind.split(';')[0]?.trim() ?? '';
  const locked = (tags['locked'] ?? '').toLowerCase() === 'yes';
  const closedByTag = tagSays(tags['motor_vehicle']) === false || tagSays(tags['access']) === false || conditional(tags['motor_vehicle:conditional'])?.value === 'no';
  if (kind.includes('bollard') || k === 'block' || k === 'jersey_barrier' || k === 'bollard') return { car: true, twoWheeler: false };
  if (k === 'motorcycle_barrier' || k === 'turnstile' || k === 'full-height_turnstile' || k === 'stile' || k === 'kissing_gate') return { car: true, twoWheeler: true };
  if (k === 'cycle_barrier') return { car: true, twoWheeler: false };
  if (k === 'gate' || k === 'lift_gate' || k === 'swing_gate' || k === 'hampshire_gate' || k === 'sliding_gate') return { car: locked || closedByTag, twoWheeler: locked };
  return { car: false, twoWheeler: false };
}

/** A gate or lift gate that is not open to the public: access private or no, locked, or no access tag at all. */
export function gateRestricted(kind: string, tags: Readonly<Record<string, string>>): boolean {
  const k = kind.split(';')[0]?.trim() ?? '';
  if (!['gate', 'lift_gate', 'swing_gate', 'sliding_gate'].includes(k)) return false;
  const a = (tags['access'] ?? '').trim().toLowerCase();
  if (a === 'yes' || a === 'permissive' || a === 'designated' || a === 'customers') return false;
  return (tags['locked'] ?? '').toLowerCase() !== 'no';
}

/** Points along an edge for the area and circle tests: its ends and its middle by length. */
function samples(pts: readonly P2[]): { mid: P2; all: P2[] } {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot((pts[i] as P2).x - (pts[i - 1] as P2).x, (pts[i] as P2).z - (pts[i - 1] as P2).z);
  const at = (d: number): P2 => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as P2;
      const b = pts[i] as P2;
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      if (acc + l >= d && l > 0) {
        const t = (d - acc) / l;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
      acc += l;
    }
    return pts[pts.length - 1] as P2;
  };
  const n = Math.max(2, Math.min(12, Math.ceil(len / 20)));
  const all: P2[] = [];
  for (let i = 0; i <= n; i++) all.push(at((len * i) / n));
  return { mid: at(len / 2), all };
}

/** True when a rule's match holds for the edge. */
export function ruleMatches(m: AccessMatch, e: AccessEdge, ctx: Pick<AccessContext, 'areaAt'> & Partial<Pick<AccessContext, 'zones' | 'barriers'>>): boolean {
  if (m.edges && !m.edges.includes(e.id)) return false;
  if (m.ways && !e.ways.some((w) => (m.ways as readonly string[]).includes(w))) return false;
  if (m.classes && !m.classes.includes(e.cls)) return false;
  if (m.name !== undefined && !new RegExp(m.name, 'i').test(e.name)) return false;
  if (m.notName !== undefined && new RegExp(m.notName, 'i').test(e.name)) return false;
  if (m.maxWidthM !== undefined && !(e.width <= m.maxWidthM)) return false;
  const keyed = (list: readonly string[]): boolean => list.some((kv) => {
    const i = kv.indexOf('=');
    return i > 0 && e.tags[kv.slice(0, i)] === kv.slice(i + 1);
  });
  if (m.tagged && !keyed(m.tagged)) return false;
  if (m.notTagged && keyed(m.notTagged)) return false;
  if (m.gate === 'restricted' && !(ctx.barriers?.get(e.id) ?? []).some((b) => b.restricted)) return false;
  if (m.zones) {
    const s = samples(e.pts);
    if (!m.zones.some((z) => ctx.zones?.get(z)?.(s) === true)) return false;
  }
  if (m.within || m.areas || m.archetypes) {
    const s = samples(e.pts);
    if (m.within) {
      const w = m.within;
      if (!s.all.every((p) => Math.hypot(p.x - w.x, p.z - w.z) <= w.r)) return false;
    }
    if (m.areas || m.archetypes) {
      const a = ctx.areaAt(s.mid.x, s.mid.z);
      if (!a) return false;
      if (m.areas && !m.areas.includes(a.id)) return false;
      if (m.archetypes && !m.archetypes.includes(a.archetype)) return false;
    }
  }
  return true;
}

/** The access record of one edge. */
export function edgeAccess(e: AccessEdge, ctx: AccessContext): EdgeAccess {
  let modes = classModes(e.cls);
  let out: EdgeAccess = { modes, reason: 'class', why: `the ${e.cls}${e.link ? ' link' : ''} class default` };
  const change = (next: readonly Mode[], reason: AccessReason, why: string, extra: Partial<EdgeAccess> = {}): void => {
    const sorted = MODES.filter((m) => next.includes(m));
    if (sorted.join(',') === modes.join(',') && !extra.rule) return;
    modes = sorted;
    out = { ...out, ...extra, modes, reason, why };
  };
  // OSM tags
  const t = tagModes(modes, e.tags);
  if (t.changed) change(t.modes, 'osm_tag', `OSM ${Object.entries(e.tags).filter(([k]) => k !== 'surface').map(([k, v]) => `${k}=${v}`).join(', ')}`, t.hours ? { hours: t.hours } : {});
  if (t.private) out = { ...out, private: true };
  // OSM barriers on the way
  const bars = ctx.barriers.get(e.id) ?? [];
  const stopCar = bars.filter((b) => b.stopsCar);
  if (stopCar.length) {
    const stop2 = stopCar.some((b) => b.stopsTwoWheeler);
    change(modes.filter((m) => m !== 'car' && m !== 'auto' && m !== 'emergency' && !(stop2 && m === 'two_wheeler')), 'osm_barrier', `OSM barrier ${stopCar.map((b) => `${b.kind} (${b.id})`).join(', ')} on the way`);
  }
  // common sense: width, surface, context
  if (e.width < CAR_MIN_WIDTH_M && modes.some((m) => m === 'car' || m === 'auto' || m === 'emergency')) {
    const keep = modes.filter((m) => m !== 'car' && m !== 'auto' && m !== 'emergency' && !(m === 'two_wheeler' && e.width < TWO_WHEELER_MIN_WIDTH_M) && !(m === 'cycle' && e.width < CYCLE_MIN_WIDTH_M));
    change(keep, 'width', `${e.width} m of carriageway: no room for a car (needs ${CAR_MIN_WIDTH_M} m)${e.width < TWO_WHEELER_MIN_WIDTH_M ? ` or a two-wheeler (${TWO_WHEELER_MIN_WIDTH_M} m)` : ''}`);
  }
  const surface = (e.tags['surface'] ?? '').toLowerCase();
  if (UNPAVED.has(surface) && MINOR_CLASSES.has(e.cls) && modes.some((m) => m === 'car' || m === 'auto')) {
    change(modes.filter((m) => m !== 'car' && m !== 'auto'), 'surface', `surface=${surface}: not a road for cars`);
  }
  if (MINOR_CLASSES.has(e.cls) && !e.link) {
    const s = samples(e.pts);
    const inside = s.all.filter((p) => {
      const k = ctx.openAt(p.x, p.z);
      return k !== null && FOOT_FIRST_OPEN.has(k);
    }).length;
    if (inside / s.all.length >= 0.8) {
      const kind = ctx.openAt(s.mid.x, s.mid.z) ?? 'open ground';
      change(modes.filter((m) => m === 'cycle' || m === 'foot' || m === 'emergency').concat(modes.includes('foot') ? [] : ['foot']), 'context', `a ${e.cls} way inside a park or lawn (${kind}): foot first`);
    }
  }
  // rules of the file: rule and context first, then the judge, then the owner; a later entry of one rank wins
  const rank = (r: AccessRule): number => (r.by === 'owner' ? 2 : r.by === 'judge' ? 1 : 0);
  const ordered = ctx.rules.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i);
  for (const { r } of ordered) {
    if (!ruleMatches(r.match, e, ctx)) continue;
    const reason: AccessReason = r.by === 'owner' ? 'owner' : r.by === 'judge' ? 'judge' : r.kind === 'context' ? 'context' : 'rule';
    // a rule never opens a way to a vehicle it is too narrow for (the width step stays true)
    const fits = r.modes.filter((m) => !((m === 'car' || m === 'auto' || m === 'emergency') && e.width < CAR_MIN_WIDTH_M && r.by === 'rule'));
    change(fits, reason, r.why, { rule: r.id, ...(r.hours ? { hours: r.hours } : {}) });
    if (r.private) out = { ...out, private: true };
    if (r.barrier === 'bollards') out = { ...out, barrier: 'bollards' };
    else if (r.barrier === 'none' && out.barrier) {
      const next: EdgeAccess = { ...out };
      delete next.barrier;
      out = next;
    }
  }
  // an OSM tag that closes a real road to cars (access=no, motor_vehicle=no) is closed with bollards where cars meet it
  if (out.reason === 'osm_tag' && !out.modes.includes('car') && !classModes(e.cls).every((m) => m !== 'car') && e.width >= CAR_MIN_WIDTH_M && out.barrier === undefined) out = { ...out, barrier: 'bollards' };
  return out;
}

export const allows = (a: Pick<EdgeAccess, 'modes'>, m: Mode): boolean => a.modes.includes(m);

/** True when every point of a ring list holds `p` in its outer ring and in none of its holes (EvenOdd). */
export function inRings(rings: readonly (readonly P2[])[], p: P2): boolean {
  let n = 0;
  for (const r of rings) if (pointInRing(p, r as P2[])) n++;
  return n % 2 === 1;
}

/** The graph edge fields the access step reads (graph/build.ts GraphEdge). */
export interface AccessGraphEdge {
  id: string;
  name: string;
  pts: readonly P2[];
  len: number;
  pieces: readonly { way: string }[];
  road: { cls: string; link: boolean; width: number };
  access?: Readonly<Record<string, string>>;
}

export interface AccessRecord {
  _doc: string;
  /** Edges and km open to each mode. */
  byMode: Record<Mode, { edges: number; km: number }>;
  /** Edges and km whose modes the step of that name decided last. */
  byReason: Record<AccessReason, { edges: number; km: number; closedToCars: number }>;
  /** Edges closed to cars and km, and the ones marked private (allowed, never a through route). */
  carFree: { edges: number; km: number };
  private: { edges: number; km: number };
  /** Rules file entries and the edges each one decided. */
  rules: { id: string; by: string; kind: string; edges: number; km: number }[];
  /** OSM barrier nodes on the road graph by kind, and the ones that stop a car. */
  osmBarriers: { total: number; onEdges: number; stopCar: number; byKind: Record<string, number> };
}

/** Access of every edge of the repaired graph, by edge id, with its record for health.json. */
export function graphAccess(edges: readonly AccessGraphEdge[], ctx: AccessContext, osmBarriers: readonly { kind: string; tags: Record<string, string>; edge?: string }[] = []): { access: Map<string, EdgeAccess>; record: AccessRecord } {
  const access = new Map<string, EdgeAccess>();
  const km = (m: number): number => Math.round(m / 10) / 100;
  const byMode = Object.fromEntries(MODES.map((m) => [m, { edges: 0, km: 0 }])) as Record<Mode, { edges: number; km: number }>;
  const byReason = Object.fromEntries(REASONS.map((r) => [r, { edges: 0, km: 0, closedToCars: 0 }])) as AccessRecord['byReason'];
  const len = { carFree: 0, carFreeN: 0, priv: 0, privN: 0 };
  const ruleHits = new Map<string, { edges: number; m: number }>();
  const mByMode = new Map<Mode, number>();
  const mByReason = new Map<AccessReason, number>();
  for (const e of edges) {
    const a = edgeAccess({ id: e.id, cls: e.road.cls, link: e.road.link, name: e.name, width: e.road.width, tags: e.access ?? {}, ways: e.pieces.map((p) => p.way), pts: e.pts }, ctx);
    access.set(e.id, a);
    for (const m of a.modes) {
      byMode[m].edges++;
      mByMode.set(m, (mByMode.get(m) ?? 0) + e.len);
    }
    const r = byReason[a.reason];
    r.edges++;
    mByReason.set(a.reason, (mByReason.get(a.reason) ?? 0) + e.len);
    if (!a.modes.includes('car')) {
      len.carFree += e.len;
      len.carFreeN++;
      if (classModes(e.road.cls).includes('car')) r.closedToCars++;
    }
    if (a.private) {
      len.priv += e.len;
      len.privN++;
    }
    if (a.rule) {
      const h = ruleHits.get(a.rule) ?? { edges: 0, m: 0 };
      h.edges++;
      h.m += e.len;
      ruleHits.set(a.rule, h);
    }
  }
  for (const m of MODES) byMode[m].km = km(mByMode.get(m) ?? 0);
  for (const r of REASONS) byReason[r].km = km(mByReason.get(r) ?? 0);
  const byKind: Record<string, number> = {};
  for (const b of osmBarriers) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
  return {
    access,
    record: {
      _doc: 'Who may use each road (P2-042, tools/bake/graph/access.ts): edges and km of the repaired graph open to each mode, and by the step that decided last (class default, OSM tag, OSM barrier, width, surface, context, rule, judge, owner). closedToCars counts edges whose class takes cars and that step closed. barriers and walkways are filled by the mesh and terrain steps.',
      byMode, byReason, carFree: { edges: len.carFreeN, km: km(len.carFree) }, private: { edges: len.privN, km: km(len.priv) },
      rules: ctx.rules.map((r) => ({ id: r.id, by: r.by, kind: r.kind ?? (r.by === 'rule' ? 'rule' : r.by), edges: ruleHits.get(r.id)?.edges ?? 0, km: km(ruleHits.get(r.id)?.m ?? 0) })),
      osmBarriers: { total: osmBarriers.length, onEdges: osmBarriers.filter((b) => b.edge !== undefined).length, stopCar: osmBarriers.filter((b) => b.edge !== undefined && barrierStops(b.kind, b.tags).car).length, byKind },
    },
  };
}

/** The barriers of the access context from the graph's barrier nodes (those on an edge). */
export function barrierIndex(barriers: readonly { id: string; kind: string; tags: Record<string, string>; edge?: string }[]): Map<string, EdgeBarrier[]> {
  const out = new Map<string, EdgeBarrier[]>();
  for (const b of barriers) {
    if (b.edge === undefined) continue;
    const s = barrierStops(b.kind, b.tags);
    (out.get(b.edge) ?? out.set(b.edge, []).get(b.edge) as EdgeBarrier[]).push({ id: b.id, kind: b.kind, stopsCar: s.car, stopsTwoWheeler: s.twoWheeler, restricted: gateRestricted(b.kind, b.tags) });
  }
  return out;
}
