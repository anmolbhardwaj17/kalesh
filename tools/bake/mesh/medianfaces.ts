// Medians between the two carriageways of a divided street (P1-032, MAP_REPAIR.md "OSM is the starting point"): the
// lane model gives each carriageway a 0.3 m kerb on its median side and leaves the space between the two to the
// ground. This fills it. Where a reference (harness/data/medians.json: a photo or a satellite reading) gives the
// divider's width and type, the divider is that wide, in the middle, and the rest is carriageway asphalt (the two
// median kerb lanes go flat with it; since P1-034 the lane model gives most of that room to the lanes first,
// roads/dividers.ts, so only what they cannot take is left here);
// with no reference the median fills the whole gap OSM's two centre lines leave (width source "osm").
//
// Faces are built on the carriageways' own border vertices: the side along carriageway A takes A's border points,
// the side along B takes B's border points between the two points where A's stations project onto B, so the median
// shares every edge with both (conform.ts puts the projected points into B's edges). A quad is left out where the gap
// is under 15 cm (the kerbs as good as touch: the default median of two kerbs stays), over MAX_GAP_M (a park or a block between
// two roads, not a median), off the ground level, or where another face lies in it. Pure.
import { KERB_RAISE } from '../roads/model.ts';
import { refFor } from '../roads/medianrefs.ts';
import type { MedianRef, MedianType } from '../roads/medianrefs.ts';
import type { LaneDef, Station, Strip } from '../roads/model.ts';
import { sharedArea } from './clip.ts';
import type { Ring } from './clip.ts';
import { CUT_EDGE, FaceSet } from './faces.ts';
import type { Corner, FaceKind } from './faces.ts';
import type { Borders } from './stripfaces.ts';
import { K_GRADE } from './stripfaces.ts';
import type { FaceGrid } from './structures.ts';

/** A gap wider than this between two carriageways is not filled (m): a park, a lawn or a block lies between. */
export const MAX_GAP_M = 12;
/** Under this the two median kerbs as good as touch (m): the default median of two kerbs stays and the ground closes the slot (a median face a few centimetres wide left the ground a slot it did not fill, P1-032). */
export const MIN_GAP_M = 0.15;
/** A projected point this near a vertex of the other carriageway's border is put on it (m). */
const SNAP_M = 0.01;
/** A median with no reference this wide or wider is a planter, a narrower one a paved kerb (m). */
export const PLANTED_M = 2.5;
/** A median quad sharing more than this with another face is left out (m2): even a thin overlap puts two faces on one edge. */
const OVERLAP_M2 = 1e-4;
/** Two carriageways whose heights differ more than this across the gap are on two levels (m). */
const MAX_DH_M = 0.4;
/** A reference width counts as met when the built divider is within this of it (m). */
export const REF_TOL_M = 0.5;
/** A flat band beside a reference divider narrower than this is not drawn: the median takes the whole gap there (m). */
const MIN_BAND_M = 0.1;

export type { MedianRef, MedianType } from '../roads/medianrefs.ts';
export { refFor } from '../roads/medianrefs.ts';

/** A strip of one carriageway and the strips of the other carriageway of the street, in order along their edge. */
export type StripPair = readonly [number, readonly number[]];

export interface MedianRun {
  a: number;
  b: number;
  name: string;
  /** Metres of carriageway A along which the median is filled. */
  lengthM: number;
  /** Mean width of the space between the two carriageways' fast lanes (both median kerb lanes and the gap). */
  spanM: number;
  /** The divider as built: mean width (m), type, the source of its width. */
  widthM: number;
  type: MedianType;
  source: 'osm' | 'photo' | 'satellite';
  ref?: string;
  /** A reference that could not be met (the gap is narrower than the reference divider plus its kerbs). */
  refWidthM?: number;
}

export interface MedianReport {
  pairs: number;
  runs: number;
  faces: number;
  /** Metres of paired carriageway by what lies on its median side. */
  metres: { filled: number; touching: number; wide: number; levels: number; blocked: number; offEnd: number };
  /** (offEnd stays 0 in the totals: a stretch past one strip of the other carriageway is beside another of its strips.) */
  /** Median metres by the source of the width: OSM's two centre lines, a photo, a satellite reading, or the two-kerb default. */
  bySource: { osm: number; photo: number; satellite: number; default: number };
  /** Reference medians that disagree with OSM's gap (the reference is wider than the gap allows). */
  disagree: { name: string; refWidthM: number; spanM: number; ref: string }[];
  /** The median kerb lanes laid flat beside a reference divider (faces). */
  flattened: number;
  list: MedianRun[];
}

const MEDIAN_KIND: Readonly<Record<MedianType, FaceKind>> = { kerb: 'median', barrier: 'median', painted: 'median', planter: 'planter' };

interface Proj {
  x: number;
  z: number;
  /** Float index along B's border points (j + t). */
  u: number;
  d: number;
  h: number;
}

/** The median-side border of the other carriageway: the right border of each of its strips in turn, one point per station (a joint row once). */
interface Side {
  n: number;
  x: number[];
  z: number[];
  h: number[];
  nx: number[];
  nz: number[];
  kind: number[];
  /** Strip, station and median lane width of every point, and its strip's edge. */
  edge: string[];
  strip: number[];
  station: number[];
  w: number[];
}

function sideOf(list: readonly number[], strips: readonly Strip[], kinds: readonly ArrayLike<number>[], borders: Borders): Side {
  const out: Side = { n: 0, x: [], z: [], h: [], nx: [], nz: [], kind: [], edge: [], strip: [], station: [], w: [] };
  for (const si of list) {
    const s = strips[si] as Strip;
    if (!medianSide(s)) continue;
    const W = s.lanes.length + 1;
    const u = borders.of(si);
    const k = kinds[si] as ArrayLike<number>;
    for (let i = 0; i < s.st.length; i++) {
      const x = u.x[i * W + W - 1] as number;
      const z = u.z[i * W + W - 1] as number;
      const last = out.n - 1;
      // the first row of the next strip is the last row of this one (Borders pins them)
      if (last >= 0 && Math.hypot((out.x[last] as number) - x, (out.z[last] as number) - z) < 0.002) continue;
      out.x.push(x);
      out.z.push(z);
      out.h.push((s.st[u.from[i * W + W - 1] as number] as Station).h);
      out.nx.push((s.st[i] as Station).nx);
      out.nz.push((s.st[i] as Station).nz);
      out.kind.push(k[i] as number);
      out.edge.push(s.edge);
      out.strip.push(si);
      out.station.push(i);
      out.w.push((s.lanes[s.lanes.length - 1] as LaneDef).width);
      out.n++;
    }
  }
  return out;
}

/** Nearest point on the other carriageway's median-side border to (x, z), with its float index, distance and height. */
function project(b: Side, x: number, z: number): Proj | null {
  let best: Proj | null = null;
  for (let j = 0; j + 1 < b.n; j++) {
    const ax = b.x[j] as number;
    const az = b.z[j] as number;
    const dx = (b.x[j + 1] as number) - ax;
    const dz = (b.z[j + 1] as number) - az;
    const l2 = dx * dx + dz * dz;
    // the other carriageway's border runs on only along one edge: across a junction on that side (a side street)
    // the junction's own ring is the edge, and a straight bridge left hairlines beside it (P1-032)
    if (b.edge[j] !== b.edge[j + 1] || l2 > 400) continue;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { x: px, z: pz, u: j + t, d, h: (b.h[j] as number) + ((b.h[j + 1] as number) - (b.h[j] as number)) * t };
  }
  // a point a few millimetres from one of B's vertices is that vertex: a second vertex beside it leaves a hairline
  // (a loop of no area) or a T joint conform cannot put in (P1-032)
  if (best) {
    const k = Math.round(best.u);
    if (Math.hypot((b.x[k] as number) - best.x, (b.z[k] as number) - best.z) < SNAP_M) best = { ...best, x: b.x[k] as number, z: b.z[k] as number, u: k, h: b.h[k] as number };
  }
  return best;
}

/** A corner of another face within a few millimetres of an edge of the ring (not at its ends): a T joint the repair cannot always put in. */
function touchesCorner(ring: readonly (readonly [number, number])[], others: readonly Ring[]): boolean {
  for (const o of others) {
    for (const [x, z] of o) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k] as readonly [number, number];
        const b = ring[(k + 1) % ring.length] as readonly [number, number];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz;
        if (l2 < 1e-12) continue;
        const t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
        if (d < 0.003 && Math.hypot(x - a[0], z - a[1]) > 0.002 && Math.hypot(x - b[0], z - b[1]) > 0.002) return true;
      }
    }
  }
  return false;
}

const medianSide = (s: Strip): boolean => {
  const l = s.lanes[s.lanes.length - 1] as LaneDef | undefined;
  return !!l && (l.type === 'median' || l.type === 'planter' || l.type === 'gore');
};

export function addMedianFaces(fs: FaceSet, strips: readonly Strip[], kinds: readonly ArrayLike<number>[], borders: Borders, grid: FaceGrid, pairs: readonly StripPair[], refs: readonly MedianRef[], firstStripFace: readonly number[], faceIds: number[] = []): MedianReport {
  const out: MedianReport = { pairs: 0, runs: 0, faces: 0, metres: { filled: 0, touching: 0, wide: 0, levels: 0, blocked: 0, offEnd: 0 }, bySource: { osm: 0, photo: 0, satellite: 0, default: 0 }, disagree: [], flattened: 0, list: [] };
  const flatten = new Set<number>();
  // a median border segment (strip and station) belongs to one median: a strip paired with two streets, or two
  // strips of one street beside the same stretch, must not fill one gap twice (two faces on one edge, P1-032)
  const claimed = new Map<number, number>();
  const added: { ring: [number, number][]; x0: number; x1: number; z0: number; z1: number }[] = [];
  for (const [pairNo, [ai, bList]] of pairs.entries()) {
    const A = strips[ai] as Strip;
    const B = sideOf(bList, strips, kinds, borders);
    const bi = B.strip[0] ?? -1;
    const bName = bi >= 0 ? (strips[bi] as Strip).name : '';
    if (!medianSide(A) || A.st.length < 2 || B.n < 2) continue;
    out.pairs++;
    const WA = A.lanes.length + 1;
    const ua = borders.of(ai);
    const kA = WA - 1;
    const wA = (A.lanes[A.lanes.length - 1] as LaneDef).width;
    const raiseA = (A.lanes[A.lanes.length - 1] as LaneDef).raise;
    const kindA = kinds[ai] as ArrayLike<number>;
    const nA = A.st.length;
    // every station of A: its median-side border point, the nearest point of B's, and whether a median fits there
    const pa: { x: number; z: number; h: number; p: Proj | null; ok: boolean; why: keyof MedianReport['metres'] | null }[] = [];
    for (let i = 0; i < nA; i++) {
      const x = ua.x[i * WA + kA] as number;
      const z = ua.z[i * WA + kA] as number;
      const h = (A.st[ua.from[i * WA + kA] as number] as Station).h;
      const p = project(B, x, z);
      let why: keyof MedianReport['metres'] | null = null;
      if (!p) why = 'offEnd';
      else if (p.u <= 1e-6 || p.u >= B.n - 1 - 1e-6) why = 'offEnd';
      else if (p.d < MIN_GAP_M) why = 'touching';
      else if (p.d > MAX_GAP_M) why = 'wide';
      else {
        const st = A.st[i] as Station;
        const j = Math.floor(p.u);
        // the point of B must lie on A's median side (the right of A's station order), and the gap on B's right too
        const rightOfA = (p.x - x) * -st.nx + (p.z - z) * -st.nz > 0;
        const rightOfB = (x - p.x) * -(B.nx[j] as number) + (z - p.z) * -(B.nz[j] as number) > 0;
        if (!rightOfA || !rightOfB) why = 'blocked';
        else if ((kindA[i] as number) !== K_GRADE || (B.kind[j] as number) !== K_GRADE || (B.kind[Math.min(j + 1, B.n - 1)] as number) !== K_GRADE || Math.abs(h - p.h) > MAX_DH_M) why = 'levels';
      }
      pa.push({ x, z, h, p, ok: why === null, why });
    }
    // runs of quads: both stations fit, B's points move one way, nothing else lies in the quad
    let run: { from: number; spans: number[]; len: number; widths: number[]; ref: MedianRef | null; flatOk: boolean } | null = null;
    let dirB = 0;
    const close = (): void => {
      if (!run || !run.len) {
        run = null;
        return;
      }
      const span = run.spans.reduce((s, v) => s + v, 0) / run.spans.length;
      const width = run.widths.reduce((s, v) => s + v, 0) / run.widths.length;
      const r = run.ref;
      const met = r !== null && Math.abs(width - r.width) <= REF_TOL_M;
      const source: MedianRun['source'] = met && r ? r.source : 'osm';
      out.list.push({ a: ai, b: bi, name: A.name || bName, lengthM: Math.round(run.len * 10) / 10, spanM: Math.round(span * 100) / 100, widthM: Math.round(width * 100) / 100, type: r?.type ?? (width >= PLANTED_M ? 'planter' : 'kerb'), source, ...(r ? { ref: r.ref } : {}), ...(r && !met ? { refWidthM: r.width } : {}) });
      if (r && !met) out.disagree.push({ name: A.name || bName, refWidthM: r.width, spanM: Math.round(span * 100) / 100, ref: r.ref });
      out.bySource[source] += run.len;
      out.runs++;
      run = null;
    };
    for (let i = 0; i + 1 < nA; i++) {
      const p = pa[i] as (typeof pa)[number];
      const q = pa[i + 1] as (typeof pa)[number];
      const segLen = Math.hypot(q.x - p.x, q.z - p.z);
      if (!p.ok || !q.ok) {
        close();
        const why = (p.ok ? q.why : p.why) as keyof MedianReport['metres'];
        // every strip of the other street is tried: a stretch past one of them is beside another, so it is not counted
        if (why !== 'offEnd') out.metres[why] += segLen;
        if (why === 'touching') out.bySource.default += segLen;
        continue;
      }
      const pp = p.p as Proj;
      const qp = q.p as Proj;
      const du = qp.u - pp.u;
      const dir = du > 1e-9 ? 1 : du < -1e-9 ? -1 : 0;
      if ((dir === 0 && Math.hypot(qp.x - pp.x, qp.z - pp.z) > 1e-9) || (dir !== 0 && dirB !== 0 && dir !== dirB && run)) {
        close();
        out.metres.blocked += segLen;
        dirB = dir;
        continue;
      }
      if (dir !== 0) dirB = dir;
      // B's border points strictly between the two projections, walking from q's back to p's
      const chain: Corner[] = [];
      const lo = Math.min(pp.u, qp.u);
      const hi = Math.max(pp.u, qp.u);
      const js: number[] = [];
      for (let j = Math.floor(lo) + 1; j < hi - 1e-9; j++) if (j > lo + 1e-9) js.push(j);
      if (dir > 0) js.reverse();
      for (const j of js) chain.push({ x: B.x[j] as number, z: B.z[j] as number, y: B.h[j] as number });
      const ring: [number, number][] = [[p.x, p.z], [q.x, q.z], [qp.x, qp.z], ...chain.map((c) => [c.x, c.z] as [number, number]), [pp.x, pp.z]];
      // anything else in the quad (another road, a junction surface) keeps it open
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of ring) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      const others: Ring[] = [];
      for (const f of grid.near(x0, z0, x1, z1)) {
        const piece = fs.piece[f] as number;
        if (piece === ai || piece === bi) continue;
        others.push(fs.ring(f));
      }
      for (const a of added) if (a.x0 <= x1 && a.x1 >= x0 && a.z0 <= z1 && a.z1 >= z0) others.push(a.ring);
      const segs = [ai * 1e6 + i];
      for (let j = Math.floor(lo); j <= Math.ceil(hi) - 1; j++) segs.push((B.strip[j] as number) * 1e6 + (B.station[j] as number));
      if (segs.some((k) => (claimed.get(k) ?? pairNo) !== pairNo) || (others.length && (sharedArea([ring], others, { x: x0, z: z0 }) > OVERLAP_M2 || touchesCorner(ring, others)))) {
        close();
        out.metres.blocked += segLen;
        continue;
      }
      for (const k of segs) claimed.set(k, pairNo);
      added.push({ ring, x0, x1, z0, z1 });
      const ref = refFor(refs, A, bName, (p.x + q.x) / 2, (p.z + q.z) / 2);
      const wB = B.w[Math.floor(pp.u)] as number;
      if (run && run.ref !== ref) close();
      if (!run) run = { from: i, spans: [], len: 0, widths: [], ref, flatOk: true };
      // a reference divider in the middle with flat carriageway either side, where the gap holds it
      const fA = (d: number): number => (d + wA + wB - (ref?.width ?? 0)) / 2 - wA;
      const fB = (d: number): number => (d + wA + wB - (ref?.width ?? 0)) / 2 - wB;
      const banded = ref !== null && fA(pp.d) >= MIN_BAND_M && fA(qp.d) >= MIN_BAND_M && fB(pp.d) >= MIN_BAND_M && fB(qp.d) >= MIN_BAND_M;
      const raise = raiseA > 0 ? raiseA : KERB_RAISE;
      // no reference: a median of PLANTED_M or more is planted (most of Delhi's wide dividers), a narrower one paved
      const span = (pp.d + qp.d) / 2 + wA + wB;
      const kind: FaceKind = ref ? MEDIAN_KIND[ref.type] : span >= PLANTED_M ? 'planter' : 'median';
      const meta = (k: FaceKind, r: number): Parameters<FaceSet['add']>[1] => ({ piece: ai, kind: k, cut: CUT_EDGE, raise: r, sheet: 0, station: -1, lane: -1 });
      if (!banded) {
        const corners: Corner[] = [{ x: p.x, z: p.z, y: p.h + raise }, { x: q.x, z: q.z, y: q.h + raise }, { x: qp.x, z: qp.z, y: qp.h + raise }, ...chain.map((c) => ({ ...c, y: c.y + raise })), { x: pp.x, z: pp.z, y: pp.h + raise }];
        const f = fs.add(corners, meta(kind, raise));
        if (f >= 0) {
          out.faces++;
          faceIds.push(f);
        }
        run.widths.push(((pp.d + qp.d) / 2) + wA + wB);
      } else {
        // points on the line across from A's border to B's at a distance from A's side
        const at = (s: { x: number; z: number; h: number }, t: Proj, dist: number, lift: number): Corner => {
          const f = dist / t.d;
          return { x: s.x + (t.x - s.x) * f, z: s.z + (t.z - s.z) * f, y: s.h + (t.h - s.h) * f + lift };
        };
        const a1p = at(p, pp, fA(pp.d), 0);
        const a1q = at(q, qp, fA(qp.d), 0);
        const a2p = at(p, pp, fA(pp.d) + (ref as MedianRef).width, 0);
        const a2q = at(q, qp, fA(qp.d) + (ref as MedianRef).width, 0);
        const lift = (c: Corner): Corner => ({ ...c, y: c.y + raise });
        for (const [corners, k, r] of [
          [[{ x: p.x, z: p.z, y: p.h }, { x: q.x, z: q.z, y: q.h }, a1q, a1p], 'drive', 0],
          [[a1p, a1q, a2q, a2p].map(lift), kind, raise],
          [[a2p, a2q, { x: qp.x, z: qp.z, y: qp.h }, ...chain, { x: pp.x, z: pp.z, y: pp.h }], 'drive', 0],
        ] as [Corner[], FaceKind, number][]) {
          const f = fs.add(corners, meta(k, r));
          if (f >= 0) {
            out.faces++;
            faceIds.push(f);
          }
        }
        run.widths.push((ref as MedianRef).width);
        flatten.add(ai * 1e6 + i);
        for (let j = Math.floor(lo); j <= Math.ceil(hi) - 1; j++) flatten.add((B.strip[j] as number) * 1e6 + (B.station[j] as number));
      }
      run.spans.push((pp.d + qp.d) / 2 + wA + wB);
      run.len += segLen;
      out.metres.filled += segLen;
    }
    close();
  }
  // the median kerb lanes beside a reference divider lie flat: they are carriageway asphalt there
  for (const key of flatten) {
    const si = Math.floor(key / 1e6);
    const i = key % 1e6;
    const s = strips[si] as Strip;
    const lane = s.lanes.length - 1;
    for (let f = firstStripFace[si] as number; f < (firstStripFace[si + 1] as number); f++) {
      if (fs.station[f] !== i || fs.lane[f] !== lane) continue;
      const r = fs.raise[f] as number;
      if (r <= 0) continue;
      for (let c = fs.start[f] as number; c < (fs.start[f] as number) + (fs.len[f] as number); c++) fs.ys[c] = (fs.ys[c] as number) - r;
      fs.raise[f] = 0;
      fs.kind[f] = 0;
      out.flattened++;
    }
  }
  for (const k of Object.keys(out.metres) as (keyof MedianReport['metres'])[]) out.metres[k] = Math.round(out.metres[k]);
  for (const k of Object.keys(out.bySource) as (keyof MedianReport['bySource'])[]) out.bySource[k] = Math.round(out.bySource[k]);
  return out;
}
