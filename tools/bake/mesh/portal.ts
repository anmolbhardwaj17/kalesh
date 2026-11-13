// Portal piers (P1-036): where a deck crosses a wide junction or a road below, the pier under its middle has nowhere
// to stand and the span grows (95 m over the Kashmere Gate junction). A portal stands two legs beside the deck, each
// on the nearest spot outside every road face, and carries the deck on a cross beam between them. The beam keeps the
// headroom over every face it passes over. Pure.
import { DECK_DEPTH, HEADROOM } from '../roads/model.ts';
import type { Station } from '../roads/model.ts';
import { sharedArea } from './clip.ts';
import { CUT_NONE } from './faces.ts';
import type { FaceSet } from './faces.ts';
import type { Sink, V3 } from './solids.ts';
import type { FaceGrid } from './structures.ts';

/** A blocked pier place this far past the last pier gets a portal (m): early enough that a stretch where legs cannot stand either still leaves room for one before 60 m. */
export const PORTAL_AFTER_M = 34;
/** How far beside the deck edge a leg may stand (m). */
export const PORTAL_REACH_M = 30;
/** Leg footprint: across the deck and along it (m). */
export const LEG_ACROSS_M = 1.2;
export const LEG_ALONG_M = 1.0;
/** The cross beam: its width along the deck, and how deep it may hang under the deck when the headroom allows (m). */
export const BEAM_ALONG_M = 1.0;
export const BEAM_DROP_M = 0.6;

export interface Portal {
  legs: [number, number][][];
  /** Lateral offsets (station frame) of the two leg centres. */
  at: [number, number];
  beamBottom: number;
  top: number;
  bottom: number;
}

const inFace = (fs: FaceSet, f: number, x: number, z: number): boolean => {
  const s = fs.start[f] as number;
  const n = fs.len[f] as number;
  let inside = false;
  for (let k = 0, j = n - 1; k < n; j = k++) {
    const a = fs.ids[s + k] as number;
    const b = fs.ids[s + j] as number;
    const az = fs.vz[a] as number;
    const bz = fs.vz[b] as number;
    if (az > z !== bz > z && x < (((fs.vx[b] as number) - (fs.vx[a] as number)) * (z - az)) / (bz - az) + (fs.vx[a] as number)) inside = !inside;
  }
  return inside;
};

/** Top height of a face at a plan point: its corners weighted by distance (a junction surface can be hundreds of metres across). */
const heightAt = (fs: FaceSet, f: number, x: number, z: number): number => {
  const s = fs.start[f] as number;
  let w = 0;
  let y = 0;
  for (let k = 0; k < (fs.len[f] as number); k++) {
    const id = fs.ids[s + k] as number;
    const d2 = ((fs.vx[id] as number) - x) ** 2 + ((fs.vz[id] as number) - z) ** 2;
    if (d2 < 1e-6) return fs.ys[s + k] as number;
    w += 1 / (d2 * d2);
    y += (fs.ys[s + k] as number) / (d2 * d2);
  }
  return y / w;
};

/** Any road face but a roofed tunnel under the ground: nothing of a portal leg may stand in it. */
const blocksLeg = (fs: FaceSet, f: number): boolean => !((fs.sheet[f] as number) >= 2000 && fs.cut[f] === CUT_NONE);

/**
 * A portal at station `st` of a deck on `sheet`, or why not: no free spot for a leg within reach on one side, or the
 * beam would leave less than the headroom over a face it passes over.
 */
export function findPortal(fs: FaceSet, grid: FaceGrid, st: Station, sheet: number): Portal | string {
  const L = st.b.length - 1;
  const tx = -st.nz;
  const tz = st.nx;
  const P = (lat: number, along: number): [number, number] => [st.x + st.nx * lat + tx * along, st.z + st.nz * lat + tz * along];
  const legRing = (lat: number): [number, number][] => [P(lat + LEG_ACROSS_M / 2, LEG_ALONG_M / 2), P(lat - LEG_ACROSS_M / 2, LEG_ALONG_M / 2), P(lat - LEG_ACROSS_M / 2, -LEG_ALONG_M / 2), P(lat + LEG_ACROSS_M / 2, -LEG_ALONG_M / 2)];
  const free = (lat: number): boolean => {
    const ring = legRing(lat);
    const probes: [number, number][] = [...ring, P(lat, 0), ...ring.map((r, k) => [(r[0] + (ring[(k + 1) % 4] as [number, number])[0]) / 2, (r[1] + (ring[(k + 1) % 4] as [number, number])[1]) / 2] as [number, number])];
    const xs = ring.map((r) => r[0]);
    const zs = ring.map((r) => r[1]);
    const near = grid.near(Math.min(...xs) - 0.5, Math.min(...zs) - 0.5, Math.max(...xs) + 0.5, Math.max(...zs) + 0.5).filter((f) => blocksLeg(fs, f));
    if (near.some((f) => probes.some(([x, z]) => inFace(fs, f, x, z)))) return false;
    if (near.length && sharedArea([ring], near.map((f) => fs.ring(f)), { x: P(lat, 0)[0], z: P(lat, 0)[1] }) > 0.005) return false;
    // no face corner inside the footprint either
    return !near.some((f) => fs.ring(f).some(([x, z]) => Math.abs((x - P(lat, 0)[0]) * st.nx + (z - P(lat, 0)[1]) * st.nz) < LEG_ACROSS_M / 2 && Math.abs((x - P(lat, 0)[0]) * tx + (z - P(lat, 0)[1]) * tz) < LEG_ALONG_M / 2));
  };
  const leg = (from: number, dir: 1 | -1): number | null => {
    for (let d = 0.5; d <= PORTAL_REACH_M; d += 0.5) {
      const lat = from + dir * (d + LEG_ACROSS_M / 2);
      if (free(lat)) return lat;
    }
    return null;
  };
  const left = leg(st.b[0] as number, 1);
  if (left === null) return 'no room for a leg on the left';
  const right = leg(st.b[L] as number, -1);
  if (right === null) return 'no room for a leg on the right';
  // the headroom under the beam: every face below the deck's own level that the beam line passes over
  const deckBottom = st.h - DECK_DEPTH;
  let lowest = Infinity;
  for (let lat = right; lat <= left; lat += 0.5) {
    for (const along of [-BEAM_ALONG_M / 2, BEAM_ALONG_M / 2]) {
      const [x, z] = P(lat, along);
      for (const f of grid.near(x - 0.1, z - 0.1, x + 0.1, z + 0.1)) {
        if (fs.sheet[f] === sheet || !inFace(fs, f, x, z)) continue;
        const topY = heightAt(fs, f, x, z);
        if (topY < deckBottom) lowest = Math.min(lowest, deckBottom - topY);
      }
    }
  }
  if (lowest < HEADROOM) return `the beam would leave ${Math.round(lowest * 100) / 100} m over a road`;
  const drop = Math.min(BEAM_DROP_M, lowest === Infinity ? BEAM_DROP_M : lowest - HEADROOM);
  return { legs: [legRing(left), legRing(right)], at: [left, right], beamBottom: deckBottom - drop, top: st.h - 0.15, bottom: st.g - 1 };
}

/** The four sides of a vertical box over a plan ring, normals out. */
function sides(sink: Sink, material: string, ring: readonly [number, number][], bottom: number, top: number): void {
  const cx = ring.reduce((s, r) => s + r[0], 0) / ring.length;
  const cz = ring.reduce((s, r) => s + r[1], 0) / ring.length;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k] as [number, number];
    const b = ring[(k + 1) % ring.length] as [number, number];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    let nx = ez / len;
    let nz = -ex / len;
    if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    sink.quad(material, [a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], [nx, 0, nz]);
  }
}

/** Draws a portal: two legs from the ground to the beam, and the beam from leg to leg under the deck. */
export function emitPortal(sink: Sink, st: Station, p: Portal): void {
  const tx = -st.nz;
  const tz = st.nx;
  for (const ring of p.legs) sides(sink, 'pier', ring, p.bottom, p.beamBottom);
  const P = (lat: number, along: number): [number, number] => [st.x + st.nx * lat + tx * along, st.z + st.nz * lat + tz * along];
  const l = p.at[0] + LEG_ACROSS_M / 2;
  const r = p.at[1] - LEG_ACROSS_M / 2;
  const beam: [number, number][] = [P(l, BEAM_ALONG_M / 2), P(r, BEAM_ALONG_M / 2), P(r, -BEAM_ALONG_M / 2), P(l, -BEAM_ALONG_M / 2)];
  sides(sink, 'pier', beam, p.beamBottom, p.top);
  const v = (q: [number, number], y: number): V3 => [q[0], y, q[1]];
  const [a, b, c, d] = beam as [[number, number], [number, number], [number, number], [number, number]];
  // the beam's underside faces down, its top (beside the deck) faces up
  sink.quad('pier', v(a, p.beamBottom), v(d, p.beamBottom), v(c, p.beamBottom), v(b, p.beamBottom), [0, -1, 0]);
  sink.quad('pier', v(a, p.top), v(b, p.top), v(c, p.top), v(d, p.top), [0, 1, 0]);
}
