// Hero roads (ARCH_OPTIONS HR1): a spec file gives a road its checked cross-section and the things along it
// (colonnade edge, tree line, lamps, park railing). The spec overrides tags and class defaults, and the check
// compares the baked strips with the spec lane by lane. Spec files: harness/data/hero_roads/<id>.json.
import type { Placement } from '../tile/codec.ts';
import { borderPoint, laneRaise } from './mesh.ts';
import type { MeshSet } from './mesh.ts';
import { lane } from './model.ts';
import type { CrossSection, LaneDef, LaneType, Station, Strip } from './model.ts';

export interface HeroLane {
  id: string;
  type: LaneType;
  width: number;
  raise: number;
  count?: number;
  hedge?: boolean;
  ref: string[];
}

export interface HeroAlong {
  side: 'left' | 'right';
  lane: string;
  offsetFromLaneEdge: number;
  spacing: number;
  height: number;
  ref: string[];
}

export interface HeroSpec {
  id: string;
  name: string;
  status: string;
  covers: { osmWays: number[]; ref: string[] };
  traffic: { oneway: boolean; ref: string[] };
  crossSection: { lanes: HeroLane[] };
  median: { type: string; width: number; ref: string[] };
  kerbs: { height: number; ref: string[] };
  footpaths: { left: { width: number; ref: string[] }; right: { width: number; ref: string[] } };
  colonnadeEdge?: { side: 'left' | 'right'; setback: number; bay: number; columnDiameter: number; columnHeight: number; walkDepth: number; blockHeight: number; blockDepth: number; ref: string[] };
  treeLine?: HeroAlong;
  lamps?: HeroAlong;
  parkEdge?: { side: 'left' | 'right'; height: number; ref: string[] };
  refs: Record<string, { url: string; licence: string; licenceUrl?: string; author?: string; date?: string; shows?: string }>;
}

/** The spec's lanes as a cross-section: drive lanes centred on the reference line. */
export function heroCrossSection(spec: HeroSpec): CrossSection {
  const lanes: LaneDef[] = [];
  let before = 0;
  let drive = 0;
  let seenDrive = false;
  for (const l of spec.crossSection.lanes) {
    const n = l.type === 'drive' ? Math.max(1, l.count ?? 1) : 1;
    for (let i = 0; i < n; i++) lanes.push(lane(l.type, l.width, l.type === 'drive' ? 1 : 0, l.raise));
    if (l.type === 'drive') {
      seenDrive = true;
      drive += n * l.width;
    } else if (!seenDrive) before += l.width;
  }
  return { lanes, offset: before + drive / 2 };
}

/** How many fields of a spec carry references, and those with none or with one that is missing, has no link or no licence. */
export function specRefProblems(spec: HeroSpec): { fields: number; problems: string[] } {
  const out: string[] = [];
  let fields = 0;
  const check = (field: string, ref: string[] | undefined): void => {
    fields++;
    if (!ref || ref.length === 0) {
      out.push(`${field}: no reference`);
      return;
    }
    for (const id of ref) {
      const r = spec.refs[id];
      if (!r) out.push(`${field}: reference ${id} is not in refs`);
      else if (!r.url || !r.licence) out.push(`${field}: reference ${id} has no link or no licence`);
    }
  };
  check('covers', spec.covers.ref);
  check('traffic', spec.traffic.ref);
  for (const l of spec.crossSection.lanes) check(`crossSection.${l.id}`, l.ref);
  check('median', spec.median.ref);
  check('kerbs', spec.kerbs.ref);
  check('footpaths.left', spec.footpaths.left.ref);
  check('footpaths.right', spec.footpaths.right.ref);
  if (spec.colonnadeEdge) check('colonnadeEdge', spec.colonnadeEdge.ref);
  if (spec.treeLine) check('treeLine', spec.treeLine.ref);
  if (spec.lamps) check('lamps', spec.lamps.ref);
  if (spec.parkEdge) check('parkEdge', spec.parkEdge.ref);
  return { fields, problems: out };
}

export interface HeroCheck {
  spec: string;
  strips: number;
  stationsChecked: number;
  fieldsCompared: number;
  mismatches: number;
  list: string[];
  /** The baked cross-section at the middle of the first strip: type and width per lane, left to right. */
  baked: { type: string; width: number; raise: number }[];
}

/**
 * Compares the baked strips of a hero road with its spec: lane order, type, width, raise and direction at every
 * station, the lane count, the footpath widths, the kerb height and no median. A taper on a hero road is a mismatch.
 */
export function checkHero(spec: HeroSpec, strips: readonly Strip[]): HeroCheck {
  const want = heroCrossSection(spec);
  const out: HeroCheck = { spec: spec.id, strips: 0, stationsChecked: 0, fieldsCompared: 0, mismatches: 0, list: [], baked: [] };
  const miss = (text: string): void => {
    out.mismatches++;
    if (out.list.length < 12) out.list.push(text);
  };
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  for (const s of strips) {
    if (s.hero !== spec.id) continue;
    out.strips++;
    if (s.kind !== 'road') {
      miss(`${s.id}: a ${s.kind} strip on a hero road (the cross-section must not change)`);
      continue;
    }
    out.fieldsCompared++;
    if (s.lanes.length !== want.lanes.length) {
      miss(`${s.id}: ${s.lanes.length} lanes, the spec has ${want.lanes.length}`);
      continue;
    }
    const mid = s.st[Math.floor(s.st.length / 2)] as Station;
    if (out.baked.length === 0) out.baked = s.lanes.map((l, k) => ({ type: l.type, width: r((mid.b[k] as number) - (mid.b[k + 1] as number)), raise: r(laneRaise(s.lanes, k, mid)) }));
    for (const st of s.st) {
      out.stationsChecked++;
      for (let k = 0; k < want.lanes.length; k++) {
        const w = want.lanes[k] as LaneDef;
        const l = s.lanes[k] as LaneDef;
        const width = (st.b[k] as number) - (st.b[k + 1] as number);
        out.fieldsCompared += 4;
        if (l.type !== w.type) miss(`${s.id} lane ${k}: type ${l.type}, the spec says ${w.type}`);
        if (Math.abs(width - w.width) > 0.005) miss(`${s.id} lane ${k}: width ${r(width)} m, the spec says ${w.width} m`);
        if (Math.abs(laneRaise(s.lanes, k, st) - w.raise) > 0.005) miss(`${s.id} lane ${k}: raise ${r(laneRaise(s.lanes, k, st))} m, the spec says ${w.raise} m`);
        if (l.dir !== w.dir) miss(`${s.id} lane ${k}: direction ${l.dir}, the spec says ${w.dir}`);
      }
      out.fieldsCompared++;
      if (Math.abs((st.b[0] as number) - want.offset) > 0.005) miss(`${s.id}: the drive lanes are not centred on the way (offset ${r(st.b[0] as number)} m, the spec gives ${r(want.offset)} m)`);
    }
    // the summary fields of the spec against the baked lanes
    const drive = s.lanes.filter((l) => l.type === 'drive').length;
    const specDrive = spec.crossSection.lanes.filter((l) => l.type === 'drive').reduce((n, l) => n + (l.count ?? 1), 0);
    const foot = s.lanes.map((l, k) => ({ l, k })).filter((x) => x.l.type === 'footpath');
    out.fieldsCompared += 5;
    if (drive !== specDrive) miss(`${s.id}: ${drive} drive lanes, the spec says ${specDrive}`);
    if (foot.length > 0 && Math.abs((foot[0] as { l: LaneDef }).l.width - spec.footpaths.left.width) > 0.005) miss(`${s.id}: left footpath ${(foot[0] as { l: LaneDef }).l.width} m, the spec says ${spec.footpaths.left.width} m`);
    if (foot.length > 1 && Math.abs((foot[foot.length - 1] as { l: LaneDef }).l.width - spec.footpaths.right.width) > 0.005) miss(`${s.id}: right footpath ${(foot[foot.length - 1] as { l: LaneDef }).l.width} m, the spec says ${spec.footpaths.right.width} m`);
    if (spec.median.type === 'none' && s.lanes.some((l) => l.type === 'median')) miss(`${s.id}: a median lane, the spec says none`);
    const kerb = s.lanes.find((l) => l.type === 'kerb');
    if (kerb && Math.abs(kerb.raise - spec.kerbs.height) > 0.005) miss(`${s.id}: kerb ${kerb.raise} m high, the spec says ${spec.kerbs.height} m`);
  }
  if (out.strips === 0) miss('no baked strip carries this spec');
  return out;
}

export interface HeroFurniture {
  placements: Placement[];
  counts: Record<string, number>;
  /** Spacing actually baked for each line, against the spec's. */
  spacing: Record<string, { spec: number; baked: number }>;
}

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * The things along a hero road, from the baked strips: the colonnade block (a stand-in mass with a covered walk
 * and one column per bay), trees, lamps, a hedge on the planter, the park railing. Positions are in district metres.
 */
export function buildHeroFurniture(spec: HeroSpec, strips: readonly Strip[], set: MeshSet): HeroFurniture {
  const xf: Record<string, number[]> = { column: [], tree: [], lamp: [] };
  const counts: Record<string, number> = { column: 0, tree: 0, lamp: 0, blocks: 0 };
  const spacing: Record<string, { spec: number; baked: number }> = {};
  const place = (module: string, x: number, y: number, z: number, yaw: number, scale = 1): void => {
    const c = Math.cos(yaw) * scale;
    const s = Math.sin(yaw) * scale;
    (xf[module] as number[]).push(c, 0, s, x, 0, scale, 0, y, -s, 0, c, z);
    counts[module] = (counts[module] as number) + 1;
  };
  const laneIndex = (id: string): number => {
    let k = 0;
    for (const l of spec.crossSection.lanes) {
      if (l.id === id) return k;
      k += l.type === 'drive' ? Math.max(1, l.count ?? 1) : 1;
    }
    return -1;
  };
  let lineLength = 0;
  const mine = strips.filter((s) => s.hero === spec.id && s.kind === 'road');
  mine.forEach((s, si) => {
    const L = s.lanes.length;
    const lengths: number[] = [0];
    for (let i = 1; i < s.st.length; i++) lengths.push((lengths[i - 1] as number) + Math.hypot((s.st[i] as Station).x - (s.st[i - 1] as Station).x, (s.st[i] as Station).z - (s.st[i - 1] as Station).z));
    const total = lengths[lengths.length - 1] as number;
    lineLength += total;
    // a point at a distance along the strip and a lateral position
    const at = (d: number, lateral: number): { x: number; y: number; z: number; yaw: number } => {
      let i = 0;
      while (i + 2 < lengths.length && (lengths[i + 1] as number) < d) i++;
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      const t = Math.max(0, Math.min(1, (d - (lengths[i] as number)) / Math.max(1e-6, (lengths[i + 1] as number) - (lengths[i] as number))));
      const nx = p.nx + (q.nx - p.nx) * t;
      const nz = p.nz + (q.nz - p.nz) * t;
      return { x: p.x + (q.x - p.x) * t + nx * lateral, y: p.h + (q.h - p.h) * t, z: p.z + (q.z - p.z) * t + nz * lateral, yaw: Math.atan2(nx, nz) };
    };
    const first = s.st[0] as Station;
    const along = (line: HeroAlong, module: string, jitter: number): void => {
      const k = laneIndex(line.lane);
      if (k < 0) return;
      const sign = line.side === 'left' ? -1 : 1;
      const lateral = (line.side === 'left' ? (first.b[k] as number) : (first.b[k + 1] as number)) + sign * line.offsetFromLaneEdge;
      const n = Math.max(1, Math.round(total / line.spacing));
      const raise = laneRaise(s.lanes, k, first);
      for (let i = 0; i < n; i++) {
        const d = ((i + 0.5) / n) * total + (hash(si * 97 + i) - 0.5) * jitter;
        const p = at(Math.max(0.5, Math.min(total - 0.5, d)), lateral);
        place(module, p.x, p.y + raise, p.z, p.yaw, module === 'tree' ? 0.8 + hash(si * 31 + i * 7) * 0.5 : 1);
      }
    };
    if (spec.treeLine) along(spec.treeLine, 'tree', spec.treeLine.spacing * 0.5);
    if (spec.lamps) along(spec.lamps, 'lamp', 0);
    // hedge: a low box on every planter lane that asks for one
    spec.crossSection.lanes.forEach((sl) => {
      if (sl.type !== 'planter' || !sl.hedge) return;
      const k = laneIndex(sl.id);
      const mesh = set.get('hedge');
      for (let i = 0; i + 1 < s.st.length; i++) {
        const p = s.st[i] as Station;
        const q = s.st[i + 1] as Station;
        const inset = 0.25;
        const pt = (st: Station, lat: number, y: number): [number, number, number] => [st.x + st.nx * lat, st.h + sl.raise + y, st.z + st.nz * lat];
        const a = (p.b[k] as number) - inset;
        const b = (p.b[k + 1] as number) + inset;
        const h = 0.75;
        mesh.quad(pt(p, a, h), pt(p, b, h), pt(q, b, h), pt(q, a, h), [0, 1, 0]);
        mesh.quad(pt(p, a, 0), pt(q, a, 0), pt(q, a, h), pt(p, a, h), [p.nx, 0, p.nz]);
        mesh.quad(pt(p, b, 0), pt(q, b, 0), pt(q, b, h), pt(p, b, h), [-p.nx, 0, -p.nz]);
      }
    });
    // park railing along the outer edge of its side
    if (spec.parkEdge) {
      const k = spec.parkEdge.side === 'left' ? 0 : L;
      const sign = spec.parkEdge.side === 'left' ? 1 : -1;
      const mesh = set.get('railing');
      for (let i = 0; i + 1 < s.st.length; i++) {
        const p = s.st[i] as Station;
        const q = s.st[i + 1] as Station;
        const a = borderPoint(p, k);
        const b = borderPoint(q, k);
        const ya = p.h + laneRaise(s.lanes, k === 0 ? 0 : L - 1, p);
        const yb = q.h + laneRaise(s.lanes, k === 0 ? 0 : L - 1, q);
        for (const side of [1, -1]) mesh.quad([a.x, ya, a.z], [b.x, yb, b.z], [b.x, yb + spec.parkEdge.height, b.z], [a.x, ya + spec.parkEdge.height, a.z], [p.nx * sign * side, 0, p.nz * sign * side]);
      }
    }
    // colonnade block: a covered walk behind a column line, the first floor above it, the block behind
    const ce = spec.colonnadeEdge;
    if (ce && total > 8) {
      counts['blocks'] = (counts['blocks'] as number) + 1;
      const k = ce.side === 'left' ? 0 : L;
      const sign = ce.side === 'left' ? 1 : -1;
      const front = (st: Station): number => (st.b[k] as number) + sign * ce.setback;
      const mesh = set.get('colonnade');
      const pt = (st: Station, lat: number, y: number): [number, number, number] => [st.x + st.nx * lat, st.h + (s.lanes[k === 0 ? 0 : L - 1] as LaneDef).raise + y, st.z + st.nz * lat];
      for (let i = 0; i + 1 < s.st.length; i++) {
        const p = s.st[i] as Station;
        const q = s.st[i + 1] as Station;
        const f0 = front(p);
        const f1 = front(q);
        const w0 = f0 + sign * ce.walkDepth;
        const w1 = f1 + sign * ce.walkDepth;
        const e0 = f0 + sign * ce.blockDepth;
        const e1 = f1 + sign * ce.blockDepth;
        const toRoad: [number, number, number] = [-p.nx * sign, 0, -p.nz * sign];
        // first floor front above the columns, the soffit of the walk, the shop wall behind the walk, the roof, the back
        mesh.quad(pt(p, f0, ce.columnHeight), pt(q, f1, ce.columnHeight), pt(q, f1, ce.blockHeight), pt(p, f0, ce.blockHeight), toRoad);
        mesh.quad(pt(p, f0, ce.columnHeight), pt(q, f1, ce.columnHeight), pt(q, w1, ce.columnHeight), pt(p, w0, ce.columnHeight), [0, -1, 0]);
        mesh.quad(pt(p, w0, 0), pt(q, w1, 0), pt(q, w1, ce.columnHeight), pt(p, w0, ce.columnHeight), toRoad);
        mesh.quad(pt(p, f0, ce.blockHeight), pt(q, f1, ce.blockHeight), pt(q, e1, ce.blockHeight), pt(p, e0, ce.blockHeight), [0, 1, 0]);
        mesh.quad(pt(p, e0, 0), pt(q, e1, 0), pt(q, e1, ce.blockHeight), pt(p, e0, ce.blockHeight), [p.nx * sign, 0, p.nz * sign]);
        // the floor of the walk, level with the footpath
        set.get('footpath').quad(pt(p, f0, 0), pt(q, f1, 0), pt(q, w1, 0), pt(p, w0, 0), [0, 1, 0]);
      }
      // block ends
      for (const i of [0, s.st.length - 1]) {
        const st = s.st[i] as Station;
        const other = s.st[i === 0 ? 1 : i - 1] as Station;
        const tx = st.x - other.x;
        const tz = st.z - other.z;
        const len = Math.hypot(tx, tz) || 1;
        const f = front(st);
        mesh.quad(pt(st, f, ce.columnHeight), pt(st, f + sign * ce.blockDepth, ce.columnHeight), pt(st, f + sign * ce.blockDepth, ce.blockHeight), pt(st, f, ce.blockHeight), [tx / len, 0, tz / len]);
        mesh.quad(pt(st, f + sign * ce.walkDepth, 0), pt(st, f + sign * ce.blockDepth, 0), pt(st, f + sign * ce.blockDepth, ce.columnHeight), pt(st, f + sign * ce.walkDepth, ce.columnHeight), [tx / len, 0, tz / len]);
      }
      const n = Math.max(2, Math.round(total / ce.bay));
      for (let i = 0; i <= n; i++) {
        const p = at((i / n) * total, front(first) + sign * ce.columnDiameter * 0.6);
        place('column', p.x, p.y + (s.lanes[k === 0 ? 0 : L - 1] as LaneDef).raise, p.z, p.yaw);
      }
    }
  });
  if (spec.treeLine) spacing['treeLine'] = { spec: spec.treeLine.spacing, baked: Math.round((lineLength / Math.max(1, counts['tree'] as number)) * 100) / 100 };
  if (spec.lamps) spacing['lamps'] = { spec: spec.lamps.spacing, baked: Math.round((lineLength / Math.max(1, counts['lamp'] as number)) * 100) / 100 };
  if (spec.colonnadeEdge) spacing['colonnadeBay'] = { spec: spec.colonnadeEdge.bay, baked: Math.round((lineLength / Math.max(1, (counts['column'] as number) - (counts['blocks'] as number))) * 100) / 100 };
  return { placements: Object.entries(xf).filter(([, v]) => v.length > 0).map(([module, xforms]) => ({ module, xforms })), counts, spacing };
}
