// Blocks and the placement method of the signed seamless map (P1-008; TECH.md "World layout", MAP_REPAIR.md "District
// frames and stitching"; data harness/data/districts.json). A block is one continuous piece of the map with one frame.
//
//   offset = pivot.world + factor * geoToWorld(block origin, pivot)      pivot India Gate; centre 1.0, far blocks 0.5
//   world  = offset + geoToWorld(lat, lon, block origin)                 a translation, nothing else
//
// World axes: east +X, north -Z, up +Y, metres. There is no rotation, scale or mirror anywhere: `transformCheck`
// proves it on numbers for a placement, `forbiddenTransformKeys` proves that no data file can even carry one.
// The placer, the transform check and the key check come from the Phase 0 stitch bench (tools/bake/stitch/frames.ts,
// retired in P1-008); the island placement that went with them (layout C boxes, draft offsets) is gone.
// Pure: the driver reads the file and passes it in.
import { projector } from '../../geo/projection.ts';
import type { LatLon, Projector } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';
import { geodesic } from './geodesic.ts';

export interface Pivot extends LatLon {
  name: string;
  /** World metres of the pivot. This fixes the world origin. */
  world: P2;
}

export interface BlockDef {
  id: string;
  name: string;
  /** The projection origin of the block: a real, checked point inside it. */
  frameOrigin: LatLon & { name?: string; from?: string };
  /** 1.0 for the centre block, the far factor for every far block. */
  factor: number;
  /** World metres of the frame origin, as the method gives them (kept in the file to 0.1 m, checked against the method). */
  offset: P2;
  /** Outline file (GeoJSON, WGS84) relative to harness/data/, once it is drawn. */
  outline?: string;
  covers?: string;
}

export interface FocusDef {
  id: string;
  name: string;
  stage: string;
  block: string;
  focus?: boolean;
  /** A real point inside the focus district (a label and camera target; not a frame). */
  origin?: LatLon;
  /** Outline file relative to harness/data/, or a draft ring written in the file itself. */
  outline?: string | { status: string; ring: [number, number][] };
}

export interface LayoutGates {
  centrePairBearingDeg: number;
  centrePairDistancePct: number;
  farBearingDeg: number;
  farDistancePct: number;
  mapWidthMaxKm: number;
  reachMaxKm: number;
  blockGapMinM: number;
}

export interface LayoutFile {
  status?: string;
  method: { pivot: Pivot; centreFactor: number; farFactor: number; gates: LayoutGates };
  blocks: BlockDef[];
  districts: FocusDef[];
  planned?: FocusDef[];
}

/** The placement method: where a block's frame origin sits in the world. No offset is ever set by hand. */
export function blockOffset(pivot: Pivot, factor: number, origin: LatLon): P2 {
  const v = projector(pivot).toWorld(origin.lat, origin.lon);
  return { x: pivot.world.x + factor * v.x, z: pivot.world.z + factor * v.z };
}

/** A frame: a projection origin and the world position of that origin. */
export interface Frame {
  id: string;
  origin: LatLon;
  offset: P2;
}

export interface Placer {
  readonly frame: Frame;
  readonly proj: Projector;
  /** WGS84 degrees to world metres. */
  toWorld(lat: number, lon: number): P2;
  /** Block metres to world metres. */
  place(p: P2): P2;
  /** World metres to block metres. */
  local(p: P2): P2;
  toGeo(world: P2): LatLon;
}

/** The block's own projection, then the offset. A translation: nothing here can turn, stretch or flip. */
export function placer(frame: Frame): Placer {
  const proj = projector(frame.origin);
  const { x: ox, z: oz } = frame.offset;
  return {
    frame, proj,
    toWorld: (lat, lon) => {
      const p = proj.toWorld(lat, lon);
      return { x: p.x + ox, z: p.z + oz };
    },
    place: (p) => ({ x: p.x + ox, z: p.z + oz }),
    local: (p) => ({ x: p.x - ox, z: p.z - oz }),
    toGeo: (w) => proj.toGeo(w.x - ox, w.z - oz),
  };
}

/** The frame of a block, with the offset computed by the method (the number in the file is only a record of it). */
export function blockFrame(file: LayoutFile, id: string): Frame {
  const b = file.blocks.find((x) => x.id === id);
  if (!b) throw new Error(`no block "${id}" in harness/data/districts.json (blocks: ${file.blocks.map((x) => x.id).join(', ')})`);
  return { id: b.id, origin: { lat: b.frameOrigin.lat, lon: b.frameOrigin.lon }, offset: blockOffset(file.method.pivot, b.factor, b.frameOrigin) };
}

/** One placer per block, in file order. */
export const blockPlacers = (file: LayoutFile): Placer[] => file.blocks.map((b) => placer(blockFrame(file, b.id)));

/** The centre block: the one at factor 1.0 whose frame origin is the pivot. */
export function centreBlock(file: LayoutFile): BlockDef {
  const c = file.blocks.find((b) => b.factor === file.method.centreFactor);
  if (!c) throw new Error('districts.json has no centre block (a block at the centre factor)');
  return c;
}

/** How far the offsets in the file may differ from the method: they are written to 0.1 m. */
export const OFFSET_RECORD_TOL_M = 0.06;

/** Problems of the layout data itself. Empty when the file follows the signed method. */
export function layoutProblems(file: LayoutFile): string[] {
  const out: string[] = [];
  const { pivot, centreFactor, farFactor } = file.method;
  if (centreFactor !== 1) out.push(`the centre factor is ${centreFactor}, the signed value is 1.0`);
  if (!(farFactor > 0 && farFactor <= 1)) out.push(`the far factor ${farFactor} is not in (0, 1]`);
  if (![pivot.lat, pivot.lon, pivot.world.x, pivot.world.z].every(Number.isFinite)) out.push('the pivot needs lat, lon and a world position');
  const ids = new Set<string>();
  let centres = 0;
  for (const b of file.blocks) {
    if (ids.has(b.id)) out.push(`block ${b.id} is listed twice`);
    ids.add(b.id);
    if (b.factor === centreFactor) {
      centres++;
      if (b.frameOrigin.lat !== pivot.lat || b.frameOrigin.lon !== pivot.lon) out.push(`block ${b.id}: the centre block's frame origin must be the pivot (${pivot.name})`);
    } else if (b.factor !== farFactor) {
      out.push(`block ${b.id}: factor ${b.factor} is neither the centre factor ${centreFactor} nor the far factor ${farFactor}`);
    }
    const want = blockOffset(pivot, b.factor, b.frameOrigin);
    const d = Math.hypot(want.x - b.offset.x, want.z - b.offset.z);
    if (!(d <= OFFSET_RECORD_TOL_M)) out.push(`block ${b.id}: offset (${b.offset.x}, ${b.offset.z}) is ${d.toFixed(2)} m off the method's (${want.x.toFixed(1)}, ${want.z.toFixed(1)})`);
  }
  if (centres !== 1) out.push(`there must be exactly one centre block (found ${centres})`);
  for (const d of [...file.districts, ...(file.planned ?? [])]) {
    // a "later" place may name a far block that is added when its stage is planned (Noida)
    if (!ids.has(d.block) && d.stage !== 'later') out.push(`district ${d.id}: block "${d.block}" is not in blocks`);
  }
  for (const k of forbiddenTransformKeys(file)) out.push(`key ${k} could carry a rotation, a scale or a mirror`);
  return out;
}

const FORBIDDEN = /^(rot|rotation|rotate|yaw|angle|heading|scale|mirror|flip|basis|matrix|transform|skew)/i;

/** Keys of a data file that could carry a rotation, a scale or a mirror: there must be none. */
export function forbiddenTransformKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (FORBIDDEN.test(k)) out.push(here);
    out.push(...forbiddenTransformKeys(v, here));
  }
  return out;
}

export interface TransformCheck {
  block: string;
  /** Largest difference of the block-to-world Jacobian from the identity (0 for a pure translation). */
  jacobianError: number;
  /** Angle between true north at the frame origin and -Z in the world, degrees. */
  northOffDeg: number;
  /** Angle between true east at the frame origin and +X in the world, degrees. */
  eastOffDeg: number;
  /** Determinant of (east, north) in the map plane with north up: +1 for a true map, -1 for a mirrored one. */
  determinant: number;
  handed: 1 | -1;
  /** World metres per real metre along north and along east at the frame origin (1 for no scale). */
  scaleNorth: number;
  scaleEast: number;
  ok: boolean;
}

const deg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Proves on numbers that a placement is a translation and nothing else: the block-to-world Jacobian is the identity,
 * true north at the frame origin is -Z, true east is +X, the determinant is +1 and a real metre is a world metre.
 */
export function transformCheck(p: Placer): TransformCheck {
  const o = p.place({ x: 0, z: 0 });
  const ex = p.place({ x: 1000, z: 0 });
  const ez = p.place({ x: 0, z: 1000 });
  const j = [(ex.x - o.x) / 1000, (ez.x - o.x) / 1000, (ex.z - o.z) / 1000, (ez.z - o.z) / 1000] as const;
  const jacobianError = Math.max(Math.abs(j[0] - 1), Math.abs(j[1]), Math.abs(j[2]), Math.abs(j[3] - 1));
  // real steps of about 200 m north and east through the frame origin, centred so curvature cancels
  const { lat, lon } = p.frame.origin;
  const d = 0.0009;
  const n0 = p.toWorld(lat - d, lon);
  const n1 = p.toWorld(lat + d, lon);
  const e0 = p.toWorld(lat, lon - d);
  const e1 = p.toWorld(lat, lon + d);
  // map plane with north up: u = x, v = -z
  const north = { u: n1.x - n0.x, v: -(n1.z - n0.z) };
  const east = { u: e1.x - e0.x, v: -(e1.z - e0.z) };
  const nLen = Math.hypot(north.u, north.v);
  const eLen = Math.hypot(east.u, east.v);
  const northOffDeg = deg(Math.atan2(north.u, north.v));
  const eastOffDeg = deg(Math.atan2(-east.v, east.u));
  const determinant = (east.u * north.v - east.v * north.u) / (nLen * eLen || 1);
  const handed = determinant > 0 ? 1 : -1;
  const scaleNorth = nLen / geodesic({ lat: lat - d, lon }, { lat: lat + d, lon }).distanceM;
  const scaleEast = eLen / geodesic({ lat, lon: lon - d }, { lat, lon: lon + d }).distanceM;
  const ok =
    jacobianError < 1e-9 && Math.abs(northOffDeg) < 1e-6 && Math.abs(eastOffDeg) < 1e-6 && handed === 1 && Math.abs(determinant - 1) < 1e-9 &&
    north.v > 0 && east.u > 0 && Math.abs(scaleNorth - 1) < 1e-5 && Math.abs(scaleEast - 1) < 1e-5;
  return { block: p.frame.id, jacobianError, northOffDeg, eastOffDeg, determinant, handed, scaleNorth, scaleEast, ok };
}
