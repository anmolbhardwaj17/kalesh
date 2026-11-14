// The files side of the access step (P2-042, tools/bake/graph/access.ts): reads harness/data/access.json and the
// area files, projects the rules' circles into block metres and builds the lookups the pure step asks for.
import fs from 'node:fs';
import path from 'node:path';
import type { P2 } from '../geom.ts';
import { boxOf } from '../geom.ts';
import { buildIndex, parseAreaFiles, resolveAt } from '../areas/profiles.ts';
import { MODES, barrierIndex, graphAccess, inRings } from '../graph/access.ts';
import type { AccessContext, AccessRecord, AccessRule, EdgeAccess, EdgeBarrier, Mode } from '../graph/access.ts';
import { barriersOnEdges } from '../graph/build.ts';
import type { GraphEdge } from '../graph/build.ts';
import type { AreaFeature, BarrierFeature } from '../graph/features.ts';

export const ACCESS_FILE = 'harness/data/access.json';

interface RuleFile {
  rules: (Omit<AccessRule, 'match'> & { match: Omit<AccessRule['match'], 'within'> & { within?: { lat: number; lon: number; radiusM: number } } })[];
}

/** Problems with the rules file (an unknown mode, a rule with no reference or no match). */
export function accessFileProblems(file: unknown): string[] {
  const out: string[] = [];
  const f = file as RuleFile;
  if (!f || !Array.isArray(f.rules)) return ['access.json: needs a rules array'];
  const ids = new Set<string>();
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
  return { rules: readAccessRules(root, project), openAt: openLookup(open), areaAt, barriers };
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
