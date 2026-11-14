// Car tunnels, underpasses and cuts in their variant's kit (P2-032, harness/design/reference/infrastructure/
// tunnels.md and underpasses_subways.md, STYLE_BIBLE.md "Infrastructure"). The mesh step (mesh/structures.ts) keeps
// the plain shapes as colliders: the side walls (`wall`, merged with the parapets), the ceiling of a roofed stretch
// (`ceiling`, a collider since P2-032) and the headwall across every mouth. This file gives every lowered strip its
// variant, cuts the wall, ceiling and headwall records into runs per tile for the game's tunnel kit
// (game/world/infra/kit_tunnel.gd), places the drain gratings (at every sag and just outside every mouth), and checks
// every roofed stretch: the headroom from the drawn road to the ceiling, and the cover of ground or road over it.
// Pure.
//
// Records of one tile (world metres, rounded to the centimetre):
//   twalls  {v, r, pp, s0, p: [x, y, z, top, g, ox, oz] per point}  a side wall run: r 1 under a roof, pp 1 with a
//           parapet over the ground; y the road edge at the lane top, top the wall top (the ceiling when roofed), g the
//           ground there, o the outward normal; s0 the metres along the run where this piece starts (panel rhythm)
//   tceils  {v, s0, p: [lx, ly, lz, rx, ry, rz] per point}          a ceiling run, left and right edge
//   theads  {v, a: [x, z], b: [x, z], y0, y1, road, n: [nx, nz], name, floor}  a headwall: from the ceiling (y0) to
//           its top (y1), road 1 when a road at grade lies over the mouth, n towards the open ramp, floor the road
//   tdrains {v, a: [x, y, z], b: [x, y, z]}                          a drain grating across the carriageway
//   tlines  {v, m, s0, p: [x, y, z] per point}                         a lane line along a lowered stretch (m: 1 dashed,
//           2 centre, 3 edge; mesh/stripfaces.ts borderMarks): the road shader that draws the lane UV's codes is not
//           in the game yet, so the kit paints them in tunnels and their ramps
import type { Joint, Station, Strip } from '../roads/model.ts';
import type { Headwall, KitSoffit, KitWall } from '../mesh/structures.ts';
import { MARK_NONE, borderMarks } from '../mesh/stripfaces.ts';

/** Variant ids of the lowered structures (tunnels.md and underpasses_subways.md). */
export const TUNNEL_VARIANTS = ['TUN-T1', 'TUN-T2', 'TUN-T3', 'UND-U1', 'SUB-S4'] as const;
/** Least headroom from the drawn road to the ceiling (m): the acceptance of P2-032 (IRC asks 5.5 m, the bake builds 5.5). */
export const MIN_HEADROOM_M = 5.0;
/** Least ground or road over the ceiling (m): the roof slab. Less is an open roof. */
export const MIN_COVER_M = 0.3;
/** A drain grating's depth along the road (m). */
export const DRAIN_M = 0.6;

const K_CUT = 3;
const K_TUNNEL = 4;
const lowered = (k: number): boolean => k === K_CUT || k === K_TUNNEL;

/**
 * The variant of every strip with a lowered station (null for the rest): a pedestrian way is a subway (SUB-S4); the
 * Pragati Maidan Tunnel's secondary ways are the main tunnel (TUN-T1) and its primary links the box underpasses
 * (TUN-T2); a service way is the basement and service tunnel kit (TUN-T3); every other cut or underpass is the
 * flyover-era painted underpass (UND-U1). An unnamed strip joined end to end to a Pragati Maidan strip takes its kit
 * (the approach before the tag).
 */
export function tunnelVariants(strips: readonly Strip[], joints: readonly Joint[], kinds: readonly ArrayLike<number>[]): (string | null)[] {
  const has = strips.map((s, si) => {
    const k = kinds[si] as ArrayLike<number>;
    for (let i = 0; i < s.st.length; i++) if (lowered(k[i] as number)) return true;
    return false;
  });
  const own = (s: Strip): string | null => {
    if (s.cls === 'pedestrian' || s.cls === 'footway' || s.cls === 'steps' || s.cls === 'path') return 'SUB-S4';
    if (/pragati maidan/i.test(s.name)) return s.cls === 'primary' ? 'TUN-T2' : s.cls === 'service' ? 'TUN-T3' : 'TUN-T1';
    return null;
  };
  const out = strips.map((s, si) => (has[si] ? own(s) : null));
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const j of joints) {
      for (const [a, b] of [[j.a.strip, j.b.strip], [j.b.strip, j.a.strip]] as const) {
        const va = out[a];
        if (!va || out[b] || !has[b] || va === 'SUB-S4') continue;
        const sb = strips[b] as Strip;
        if (sb.name && sb.name !== (strips[a] as Strip).name) continue;
        if (sb.cls === 'service' || sb.cls === 'pedestrian') continue;
        out[b] = va;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out.map((v, si) => {
    if (v || !has[si]) return v;
    return (strips[si] as Strip).cls === 'service' ? 'TUN-T3' : 'UND-U1';
  });
}

export interface TunnelInput {
  strips: readonly Strip[];
  kinds: readonly ArrayLike<number>[];
  variants: readonly (string | null)[];
  walls: readonly KitWall[];
  ceilings: readonly KitSoffit[];
  headwalls: readonly Headwall[];
  /** The final ground (NaN on a road face). */
  ground: (x: number, z: number) => number;
  /** The road face at a point within `reach` of `near` (the mesh step's faces), else NaN. */
  roadAt: (x: number, z: number, near: number, reach?: number) => number;
}

export interface TunnelPortal {
  name: string;
  variant: string;
  strip: string;
  /** Middle of the mouth at the road (block metres) and the compass bearing the mouth faces (out to the ramp). */
  x: number;
  y: number;
  z: number;
  facesDeg: number;
  widthM: number;
  underRoad: boolean;
}

export interface TunnelRecord {
  /** Lowered strips by variant. */
  variants: Record<string, number>;
  roofedM: number;
  openWallM: number;
  /** Roofed segments measured, the least headroom and cover found, and the segments under the limits. */
  segments: number;
  minHeadroomM: number;
  minCoverM: number;
  lowHeadroom: { strip: string; x: number; z: number; headroomM: number }[];
  noCover: { strip: string; x: number; z: number; coverM: number }[];
  /** Samples where no road was found under the ceiling (must be 0), and all samples under each limit. */
  noRoad: number;
  lowHeadroomCount: number;
  noCoverCount: number;
  /** Steepest lowered segment of a tunnel strip (one with a roof) per variant (percent). */
  steepestRampPct: Record<string, number>;
  portals: TunnelPortal[];
  drains: number;
}

export interface TunnelOut {
  record: TunnelRecord;
  /** Records in block metres; build.ts moves them to world metres and cuts them per tile. */
  walls: { v: string; roofed: boolean; parapet: boolean; s0: number; pts: { p: [number, number, number]; top: number; g: number; o: [number, number] }[] }[];
  ceilings: { v: string; s0: number; pts: { l: [number, number, number]; r: [number, number, number] }[] }[];
  heads: { v: string; ax: number; az: number; bx: number; bz: number; y0: number; y1: number; road: boolean; nx: number; nz: number; name: string; floor: number }[];
  drains: { v: string; a: [number, number, number]; b: [number, number, number] }[];
  lines: { v: string; m: number; pts: [number, number, number][] }[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

export function buildTunnels(input: TunnelInput): TunnelOut {
  const { strips } = input;
  const vOf = (si: number): string => input.variants[si] ?? 'UND-U1';
  const rec: TunnelRecord = { variants: {}, roofedM: 0, openWallM: 0, segments: 0, minHeadroomM: Infinity, minCoverM: Infinity, lowHeadroom: [], noCover: [], noRoad: 0, lowHeadroomCount: 0, noCoverCount: 0, steepestRampPct: {}, portals: [], drains: 0 };
  input.variants.forEach((v) => {
    if (v) rec.variants[v] = (rec.variants[v] ?? 0) + 1;
  });
  const out: TunnelOut = { record: rec, walls: [], ceilings: [], heads: [], drains: [], lines: [] };

  // ---- side walls: runs of consecutive stations with one roof and parapet state
  const wallRuns = new Map<string, KitWall[]>();
  for (const w of input.walls) {
    const k = `${w.strip}|${w.side}`;
    let l = wallRuns.get(k);
    if (!l) wallRuns.set(k, (l = []));
    l.push(w);
  }
  for (const list of wallRuns.values()) {
    list.sort((a, b) => a.station - b.station);
    let run: KitWall[] = [];
    const flush = (): void => {
      const first = run[0];
      if (!first) return;
      const pts = [{ p: first.a, top: first.top[0], g: first.ground[0], o: first.out }, ...run.map((w) => ({ p: w.b, top: w.top[1], g: w.ground[1], o: w.out }))];
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot((pts[k] as { p: number[] }).p[0]! - (pts[k - 1] as { p: number[] }).p[0]!, (pts[k] as { p: number[] }).p[2]! - (pts[k - 1] as { p: number[] }).p[2]!);
      out.walls.push({ v: vOf(first.strip), roofed: first.roofed, parapet: first.parapet, s0: 0, pts });
      if (first.roofed) rec.roofedM += len / 2;
      else rec.openWallM += len;
      run = [];
    };
    for (const w of list) {
      const last = run[run.length - 1];
      if (last && (w.station !== last.station + 1 || w.roofed !== last.roofed || w.parapet !== last.parapet)) flush();
      run.push(w);
    }
    flush();
  }

  // ---- ceilings, with the headroom and cover checks of every roofed segment
  const ceilRuns = new Map<number, KitSoffit[]>();
  for (const c of input.ceilings) {
    let l = ceilRuns.get(c.strip);
    if (!l) ceilRuns.set(c.strip, (l = []));
    l.push(c);
  }
  for (const [si, list] of ceilRuns) {
    list.sort((a, b) => a.station - b.station);
    const s = strips[si] as Strip;
    let run: KitSoffit[] = [];
    const flush = (): void => {
      const first = run[0];
      if (!first) return;
      out.ceilings.push({ v: vOf(si), s0: 0, pts: [{ l: first.l0, r: first.r0 }, ...run.map((c) => ({ l: c.l1, r: c.r1 }))] });
      run = [];
    };
    for (const c of list) {
      const last = run[run.length - 1];
      if (last && c.station !== last.station + 1) flush();
      run.push(c);
      // the checks: three points across the middle of the segment
      rec.segments++;
      for (const t of [0.15, 0.5, 0.85]) {
        const x = ((c.l0[0] + c.l1[0]) / 2) * (1 - t) + ((c.r0[0] + c.r1[0]) / 2) * t;
        const z = ((c.l0[2] + c.l1[2]) / 2) * (1 - t) + ((c.r0[2] + c.r1[2]) / 2) * t;
        const ceil = ((c.l0[1] + c.l1[1]) / 2) * (1 - t) + ((c.r0[1] + c.r1[1]) / 2) * t;
        const road = input.roadAt(x, z, ceil - 5.5, 2.5);
        if (!Number.isFinite(road)) {
          rec.noRoad++;
        } else {
          const head = ceil - road;
          if (head < rec.minHeadroomM) rec.minHeadroomM = head;
          if (head < MIN_HEADROOM_M) rec.lowHeadroomCount++;
          if (head < MIN_HEADROOM_M && rec.lowHeadroom.length < 40) rec.lowHeadroom.push({ strip: s.id, x: r2(x), z: r2(z), headroomM: r2(head) });
        }
        let above = input.ground(x, z);
        if (!Number.isFinite(above)) above = input.roadAt(x, z, ceil + 3, 3);
        const cover = Number.isFinite(above) ? above - ceil : -Infinity;
        if (cover < rec.minCoverM) rec.minCoverM = cover;
        if (cover < MIN_COVER_M) rec.noCoverCount++;
        if (cover < MIN_COVER_M && rec.noCover.length < 40) rec.noCover.push({ strip: s.id, x: r2(x), z: r2(z), coverM: Number.isFinite(cover) ? r2(cover) : -999 });
      }
    }
    flush();
  }

  // ---- headwalls and the portal list
  for (const h of input.headwalls) {
    const s = strips[h.strip] as Strip;
    const st = s.st[h.station] as Station;
    const v = vOf(h.strip);
    const name = s.name || (v === 'TUN-T1' || v === 'TUN-T2' ? 'Pragati Maidan Tunnel' : '');
    out.heads.push({ v, ax: h.ax, az: h.az, bx: h.bx, bz: h.bz, y0: h.bottom, y1: h.top, road: h.underRoad, nx: h.nx, nz: h.nz, name, floor: st.h });
    const deg = ((Math.atan2(h.nx, -h.nz) * 180) / Math.PI + 360) % 360;
    rec.portals.push({ name: name || '(unnamed)', variant: v, strip: s.id, x: r2((h.ax + h.bx) / 2), y: r2(st.h), z: r2((h.az + h.bz) / 2), facesDeg: Math.round(deg), widthM: r2(Math.hypot(h.bx - h.ax, h.bz - h.az)), underRoad: h.underRoad });
  }

  // ---- drains: across the carriageway at every sag of a lowered stretch and 2 m outside every mouth; ramp grades
  const across = (s: Strip, i: number, y: number): { a: [number, number, number]; b: [number, number, number] } => {
    const st = s.st[i] as Station;
    const L = s.lanes.length;
    return { a: [st.x + st.nx * (st.b[0] as number), y, st.z + st.nz * (st.b[0] as number)], b: [st.x + st.nx * (st.b[L] as number), y, st.z + st.nz * (st.b[L] as number)] };
  };
  const roofedStrips = new Set(input.ceilings.map((c) => c.strip));
  strips.forEach((s, si) => {
    const v = input.variants[si];
    if (!v || v === 'SUB-S4') return;
    const k = input.kinds[si] as ArrayLike<number>;
    const n = s.st.length;
    for (let i = 1; i + 1 < n; i++) {
      if (!lowered(k[i] as number)) continue;
      const h = (s.st[i] as Station).h;
      if (h <= (s.st[i - 1] as Station).h && h < (s.st[i + 1] as Station).h) {
        out.drains.push({ v, ...across(s, i, h + 0.012) });
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      if (!lowered(k[i] as number) && !lowered(k[i + 1] as number)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < 0.5) continue;
      const g = (Math.abs(q.h - p.h) / d) * 100;
      // the ramps of a tunnel (a strip with a roof): a cut under a railway bridge keeps its class grade
      if (roofedStrips.has(si) && g > (rec.steepestRampPct[v] ?? 0)) rec.steepestRampPct[v] = Math.round(g * 100) / 100;
    }
  });
  for (const h of input.headwalls) {
    const s = strips[h.strip] as Strip;
    const v = vOf(h.strip);
    if (v === 'SUB-S4') continue;
    // 2 m outside the mouth, on the open side: between the two stations around that point
    const st = s.st[h.station] as Station;
    const along = (i: number): number => ((s.st[i] as Station).x - st.x) * h.nx + ((s.st[i] as Station).z - st.z) * h.nz;
    const step = h.station > 0 && along(h.station - 1) > 0 ? -1 : 1;
    for (let i = h.station; i + step >= 0 && i + step < s.st.length; i += step) {
      const j = i + step;
      const ai = along(i);
      const aj = along(j);
      if (aj < 2) continue;
      const t = aj - ai > 1e-6 ? (2 - ai) / (aj - ai) : 0;
      const p = across(s, i, (s.st[i] as Station).h);
      const q = across(s, j, (s.st[j] as Station).h);
      const L = (u: [number, number, number], w: [number, number, number]): [number, number, number] => [u[0] + (w[0] - u[0]) * t, u[1] + (w[1] - u[1]) * t + 0.012, u[2] + (w[2] - u[2]) * t];
      out.drains.push({ v, a: L(p.a, q.a), b: L(p.b, q.b) });
      break;
    }
  }
  // ---- lane lines along every lowered stretch of a road (not a subway)
  strips.forEach((s, si) => {
    const v = input.variants[si];
    if (!v || v === 'SUB-S4') return;
    const k = input.kinds[si] as ArrayLike<number>;
    const marks = borderMarks(s.lanes);
    const n = s.st.length;
    let i = 0;
    while (i + 1 < n) {
      if (!lowered(k[i] as number) && !lowered(k[i + 1] as number)) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j + 1 < n && (lowered(k[j] as number) || lowered(k[j + 1] as number))) j++;
      marks.forEach((m, b) => {
        if (m === MARK_NONE) return;
        const pts: [number, number, number][] = [];
        for (let q = i; q <= j; q++) {
          const st = s.st[q] as Station;
          const off = st.b[b] as number;
          pts.push([st.x + st.nx * off, st.h, st.z + st.nz * off]);
        }
        out.lines.push({ v, m, pts });
      });
      i = j;
    }
  });
  rec.drains = out.drains.length;
  if (rec.minHeadroomM === Infinity) rec.minHeadroomM = 0;
  if (rec.minCoverM === Infinity) rec.minCoverM = 0;
  rec.roofedM = Math.round(rec.roofedM);
  rec.openWallM = Math.round(rec.openWallM);
  return out;
}

/** The invariant of the bake: every roofed stretch has 5.0 m of headroom over the drawn road and a cover over it. */
export function tunnelInvariant(rec: TunnelRecord): { id: string; ok: boolean; detail: string } {
  const ok = rec.lowHeadroom.length === 0 && rec.noCover.length === 0 && rec.noRoad === 0;
  return {
    id: 'TUN-01.depth_headroom_cover',
    ok,
    detail: ok
      ? `${rec.segments} roofed segments (${rec.roofedM} m of tunnel): least headroom ${rec.minHeadroomM.toFixed(2)} m (limit ${MIN_HEADROOM_M}), least cover ${rec.minCoverM.toFixed(2)} m (limit ${MIN_COVER_M}), ${rec.portals.length} mouths`
      : `${rec.lowHeadroomCount} samples under ${MIN_HEADROOM_M} m of headroom (${JSON.stringify(rec.lowHeadroom.slice(0, 3))}), ${rec.noCoverCount} with no cover (${JSON.stringify(rec.noCover.slice(0, 3))}), ${rec.noRoad} with no road under the ceiling`,
  };
}
