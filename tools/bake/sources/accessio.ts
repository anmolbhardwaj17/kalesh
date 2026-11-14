// The files side of the access step (P2-042, tools/bake/graph/access.ts): reads harness/data/access.json and the
// area files, projects the rules' circles into block metres and builds the lookups the pure step asks for.
import fs from 'node:fs';
import path from 'node:path';
import type { P2 } from '../geom.ts';
import { boxOf, pointInRing } from '../geom.ts';
import { buildIndex, parseAreaFiles, resolveAt } from '../areas/profiles.ts';
import { MODES, barrierIndex, graphAccess, inRings } from '../graph/access.ts';
import type { AccessContext, AccessRecord, AccessRule, EdgeAccess, EdgeBarrier, Mode, ZoneTest } from '../graph/access.ts';
import { barriersOnEdges } from '../graph/build.ts';
import type { GraphEdge } from '../graph/build.ts';
import type { AreaFeature, BarrierFeature } from '../graph/features.ts';

export const ACCESS_FILE = 'harness/data/access.json';

/** A zone of the rules file: a drawn ring (the edge's middle point inside) or circles (every sample point inside one of them). */
export interface ZoneDef {
  id: string;
  why: string;
  refs: string[];
  ring?: [number, number][];
  circles?: { name: string; lat: number; lon: number; radiusM: number }[];
}

interface RuleFile {
  zones?: ZoneDef[];
  rules: (Omit<AccessRule, 'match'> & { match: Omit<AccessRule['match'], 'within'> & { within?: { lat: number; lon: number; radiusM: number } } })[];
}

/** Problems with the rules file (an unknown mode, a rule with no reference or no match). */
export function accessFileProblems(file: unknown): string[] {
  const out: string[] = [];
  const f = file as RuleFile;
  if (!f || !Array.isArray(f.rules)) return ['access.json: needs a rules array'];
  const ids = new Set<string>();
  const zoneIds = new Set<string>();
  for (const z of f.zones ?? []) {
    const at = `access.json zone ${z.id ?? '?'}`;
    if (typeof z.id !== 'string' || !/^[a-z0-9_]+$/.test(z.id)) out.push(`${at}: id must be lower case letters, digits and underscores`);
    if (zoneIds.has(z.id)) out.push(`${at}: id used twice`);
    zoneIds.add(z.id);
    if (typeof z.why !== 'string' || z.why.length < 20) out.push(`${at}: why must say the reason in a sentence`);
    if (!Array.isArray(z.refs) || !z.refs.length) out.push(`${at}: needs at least one reference`);
    const ringOk = Array.isArray(z.ring) && z.ring.length >= 4 && z.ring.every((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite));
    const circlesOk = Array.isArray(z.circles) && z.circles.length > 0 && z.circles.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.radiusM > 0);
    if (ringOk === circlesOk) out.push(`${at}: needs a ring of [lat, lon] points (4 or more) or circles, not both`);
  }
  for (const r of f.rules) {
    const at = `access.json rule ${r.id ?? '?'}`;
    if (typeof r.id !== 'string' || !/^[a-z0-9_]+$/.test(r.id)) out.push(`${at}: id must be lower case letters, digits and underscores`);
    if (ids.has(r.id)) out.push(`${at}: id used twice`);
    ids.add(r.id);
    if (!['rule', 'judge', 'owner'].includes(r.by)) out.push(`${at}: by must be rule, judge or owner`);
    if (r.kind !== undefined && !['rule', 'context'].includes(r.kind)) out.push(`${at}: kind must be rule or context`);
    if (typeof r.why !== 'string' || r.why.length < 20) out.push(`${at}: why must say the reason in a sentence`);
    if (!Array.isArray(r.refs) || !r.refs.length) out.push(`${at}: needs at least one reference`);
    if (!Array.isArray(r.modes) || r.modes.some((m) => !(MODES as readonly string[]).includes(m))) out.push(`${at}: modes must be from ${MODES.join(', ')}`);
    if (r.barrier !== undefined && r.barrier !== 'bollards' && r.barrier !== 'none') out.push(`${at}: barrier must be bollards or none`);
    if (!r.match || !Object.keys(r.match).length) out.push(`${at}: an empty match would take every road`);
    for (const z of r.match?.zones ?? []) if (!zoneIds.has(z)) out.push(`${at}: match names the zone ${z}, which the file does not define`);
    if (r.match?.gate !== undefined && r.match.gate !== 'restricted') out.push(`${at}: match.gate must be restricted`);
  }
  return out;
}

/** The zones of the file as tests of an edge, in block metres. */
export function readAccessZones(root: string, project: (lat: number, lon: number) => P2): Map<string, ZoneTest> {
  const file = path.join(root, ACCESS_FILE);
  const out = new Map<string, ZoneTest>();
  if (!fs.existsSync(file)) return out;
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as RuleFile;
  for (const z of json.zones ?? []) {
    if (z.ring) {
      const ring = z.ring.map(([lat, lon]) => project(lat, lon));
      out.set(z.id, (s) => pointInRing(s.mid, ring));
    } else if (z.circles) {
      const circles = z.circles.map((c) => ({ ...project(c.lat, c.lon), r: c.radiusM }));
      out.set(z.id, (s) => circles.some((c) => s.all.every((p) => Math.hypot(p.x - c.x, p.z - c.z) <= c.r)));
    }
  }
  return out;
}

/** The rules of the file with their circles in block metres. */
export function readAccessRules(root: string, project: (lat: number, lon: number) => P2): AccessRule[] {
  const file = path.join(root, ACCESS_FILE);
  if (!fs.existsSync(file)) return [];
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as RuleFile;
  const bad = accessFileProblems(json);
  if (bad.length) throw new Error(`${ACCESS_FILE}: ${bad.join('; ')}`);
  return json.rules.map((r) => {
    const { within, ...rest } = r.match;
    const p = within ? project(within.lat, within.lon) : null;
    return { ...r, modes: r.modes as Mode[], match: { ...rest, ...(within && p ? { within: { x: p.x, z: p.z, r: within.radiusM } } : {}) } };
  });
}

/** The area index (drawn areas and rule cells) as a lookup from block metres. */
export function readAreaLookup(root: string, project: (lat: number, lon: number) => P2): (x: number, z: number) => { id: string; archetype: string } | null {
  const dir = path.join(root, 'harness', 'data', 'areas');
  if (!fs.existsSync(dir)) return () => null;
  const files: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n);
      if (fs.statSync(f).isDirectory()) walk(f);
      else if (n.endsWith('.json') || n.endsWith('.geojson')) files[path.relative(root, f).split(path.sep).join('/')] = fs.readFileSync(f, 'utf8');
    }
  };
  walk(dir);
  const index = buildIndex(parseAreaFiles(files), (lon, lat) => project(lat, lon));
  return (x, z) => {
    const r = resolveAt(index, x, z);
    return r.kind === 'none' ? null : { id: r.kind === 'area' ? r.id : '', archetype: r.archetype };
  };
}

/** The open ground kind holding a point (the first open area of the graph that holds it). */
export function openLookup(open: readonly AreaFeature[]): (x: number, z: number) => string | null {
  const CELL = 100;
  const grid = new Map<string, number[]>();
  const boxes = open.map((o) => boxOf(o.rings.flat()));
  boxes.forEach((b, i) => {
    for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) (grid.get(`${x},${z}`) ?? grid.set(`${x},${z}`, []).get(`${x},${z}`) as number[]).push(i);
  });
  return (x, z) => {
    for (const i of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const b = boxes[i];
      const o = open[i] as AreaFeature;
      if (b && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && inRings(o.rings, { x, z })) return o.kind;
    }
    return null;
  };
}

export function accessContext(root: string, project: (lat: number, lon: number) => P2, open: readonly AreaFeature[], barriers: ReadonlyMap<string, readonly EdgeBarrier[]>): AccessContext {
  const areaAt = readAreaLookup(root, project);
  return { rules: readAccessRules(root, project), openAt: openLookup(open), areaAt, barriers, zones: readAccessZones(root, project) };
}

/** The access step: every edge of the repaired graph with its modes, the barrier nodes put on the repaired edges. */
export function runAccessStep(root: string, project: (lat: number, lon: number) => P2, repaired: { edges: readonly GraphEdge[]; features: { open: readonly AreaFeature[]; barriers?: readonly BarrierFeature[] } }): { access: Map<string, EdgeAccess>; record: AccessRecord; barriers: BarrierFeature[] } {
  // the graph step put each barrier on a raw edge; the repair cut and joined edges since
  const barriers = (repaired.features.barriers ?? []).map((b) => {
    const c: BarrierFeature = { id: b.id, kind: b.kind, x: b.x, z: b.z, tags: { ...b.tags } };
    return c;
  });
  barriersOnEdges(barriers, repaired.edges);
  const ctx = accessContext(root, project, repaired.features.open, barrierIndex(barriers));
  const { access, record } = graphAccess(repaired.edges, ctx, barriers);
  return { access, record, barriers };
}
