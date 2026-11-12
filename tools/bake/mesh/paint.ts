// Paint on the road (P1-014). Stop lines and zebra crossings are geometry: one line across the lanes that arrive at
// a junction, on every arm the lane model says stops, with the crossing between the line and the junction. Lane
// lines are not geometry in the game: the road shader draws them from the lane UV and the border codes of the lane
// faces (stripfaces.ts borderMarks). The stand-in scene has no road shader, so laneLineStrips draws the same codes
// as thin strips for the bench tiles only. Pure.
import { lerp } from '../roads/curve.ts';
import type { LaneDef, Station, Strip } from '../roads/model.ts';
import type { MeshInput } from './input.ts';
import type { Sink, V3 } from './solids.ts';
import { MARK_DASHED, MARK_NONE, borderMarks } from './stripfaces.ts';

export const PAINT_LIFT_M = 0.02;
export const STOP_LINE_M = 0.3;
export const DASH_M = 3;
export const DASH_GAP_M = 4.5;
const LINE_HALF_M = 0.06;

export interface StopLine {
  junction: string;
  arm: number;
  strip: number;
  /** Metres from the strip end back to the middle of the line. */
  back: number;
  /** The line's two ends in plan (across the arriving lanes). */
  a: [number, number];
  b: [number, number];
  crossing: boolean;
}

/** A cross-section of a strip `back` metres from one of its ends: frame, height and borders between two stations. */
export function sectionAt(s: Strip, end: 'start' | 'end', back: number): Station {
  const n = s.st.length;
  const at = (k: number): Station => s.st[end === 'start' ? k : n - 1 - k] as Station;
  let done = 0;
  for (let k = 0; k + 1 < n; k++) {
    const p = at(k);
    const q = at(k + 1);
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (done + len >= back || k + 2 === n) {
      const t = len > 1e-9 ? Math.max(0, Math.min(1, (back - done) / len)) : 0;
      const nl = Math.hypot(lerp(p.nx, q.nx, t), lerp(p.nz, q.nz, t)) || 1;
      return { ...p, x: lerp(p.x, q.x, t), z: lerp(p.z, q.z, t), nx: lerp(p.nx, q.nx, t) / nl, nz: lerp(p.nz, q.nz, t) / nl, h: lerp(p.h, q.h, t), g: lerp(p.g, q.g, t), s: lerp(p.s, q.s, t), b: p.b.map((v, j) => lerp(v, q.b[j] as number, t)) };
    }
    done += len;
  }
  return at(0);
}

/** Lanes of a strip that carry traffic towards the junction at `end`: the first and the last of them. */
export function arrivingLanes(s: Strip, end: 'start' | 'end'): [number, number] | null {
  const towards = end === 'end' ? 1 : -1;
  const ks = s.lanes.map((l: LaneDef, k: number) => (l.type === 'drive' && (l.dir === 0 || l.dir === towards) ? k : -1)).filter((k) => k >= 0);
  return ks.length ? [ks[0] as number, ks[ks.length - 1] as number] : null;
}

/** Stop lines and crossings of every junction arm that stops. */
export function paintStops(input: MeshInput, sink: Sink): { lines: StopLine[]; crossings: number } {
  const lines: StopLine[] = [];
  let crossings = 0;
  for (const j of input.junctions) {
    j.arms.forEach((arm, ai) => {
      if (!arm.stops) return;
      const s = input.strips[arm.strip] as Strip;
      const span = arrivingLanes(s, arm.end);
      if (!span) return;
      const length = Math.abs((s.st[s.st.length - 1] as Station).s - (s.st[0] as Station).s);
      const back = Math.min(arm.stopBack + STOP_LINE_M / 2, Math.max(STOP_LINE_M / 2, length - STOP_LINE_M / 2));
      const quadAcross = (near: number, far: number, k0: number, k1: number): void => {
        const p = sectionAt(s, arm.end, near);
        const q = sectionAt(s, arm.end, far);
        const P = (st: Station, k: number): V3 => [st.x + st.nx * (st.b[k] as number), st.h + PAINT_LIFT_M, st.z + st.nz * (st.b[k] as number)];
        sink.quad('marking', P(p, k0), P(p, k1), P(q, k1), P(q, k0), [0, 1, 0]);
      };
      quadAcross(back - STOP_LINE_M / 2, back + STOP_LINE_M / 2, span[0], span[1] + 1);
      const mid = sectionAt(s, arm.end, back);
      lines.push({
        junction: j.id, arm: ai, strip: arm.strip, back: Math.round(back * 1000) / 1000, crossing: arm.crossing,
        a: [mid.x + mid.nx * (mid.b[span[0]] as number), mid.z + mid.nz * (mid.b[span[0]] as number)], b: [mid.x + mid.nx * (mid.b[span[1] + 1] as number), mid.z + mid.nz * (mid.b[span[1] + 1] as number)],
      });
      if (!arm.crossing || arm.stopBack < 2.5 || length < arm.stopBack + 1) return;
      // the zebra: bars along the road between the junction and the stop line, across the whole carriageway
      crossings++;
      const drive = s.lanes.map((l, k) => (l.type === 'drive' ? k : -1)).filter((k) => k >= 0);
      const p = sectionAt(s, arm.end, 0.5);
      const q = sectionAt(s, arm.end, arm.stopBack - 0.6);
      const left = p.b[drive[0] as number] as number;
      const right = p.b[(drive[drive.length - 1] as number) + 1] as number;
      for (let lat = left - 0.4; lat - 0.5 > right + 0.3; lat -= 1) {
        const P = (st: Station, l: number): V3 => [st.x + st.nx * l, st.h + PAINT_LIFT_M, st.z + st.nz * l];
        sink.quad('marking', P(p, lat), P(p, lat - 0.5), P(q, lat - 0.5), P(q, lat), [0, 1, 0]);
      }
    });
  }
  return { lines, crossings };
}

/**
 * Lane lines as thin strips, for the stand-in scene only: the codes of borderMarks, a dashed line 3 m on and
 * 4.5 m off measured along v (the station's metres along its road), a solid line elsewhere. `inBox` picks the
 * stations drawn.
 */
export function laneLineStrips(strips: readonly Strip[], sink: Sink, inBox: (x: number, z: number) => boolean): number {
  let quads = 0;
  for (const s of strips) {
    const marks = borderMarks(s.lanes);
    for (let k = 0; k < marks.length; k++) {
      const code = marks[k] as number;
      if (code === MARK_NONE) continue;
      const dl = k > 0 && (s.lanes[k - 1] as LaneDef).type === 'drive';
      const dr = k < s.lanes.length && (s.lanes[k] as LaneDef).type === 'drive';
      // an edge line sits a little inside its driving lane
      const inset = dl && dr ? 0 : dl ? 0.2 : -0.2;
      for (let i = 0; i + 1 < s.st.length; i++) {
        const p = s.st[i] as Station;
        const q = s.st[i + 1] as Station;
        if (!inBox(p.x, p.z) && !inBox(q.x, q.z)) continue;
        const wide = (st: Station): boolean => (!dl || (st.b[k - 1] as number) - (st.b[k] as number) > 1.2) && (!dr || (st.b[k] as number) - (st.b[k + 1] as number) > 1.2);
        const len = Math.abs(q.s - p.s);
        if (!wide(p) || !wide(q) || len < 1e-6) continue;
        const pieces: [number, number][] = [];
        if (code !== MARK_DASHED) pieces.push([0, 1]);
        else {
          const period = DASH_M + DASH_GAP_M;
          const from = Math.min(p.s, q.s);
          for (let d = Math.floor(from / period) * period; d < from + len; d += period) {
            const a = Math.max(from, d);
            const b = Math.min(from + len, d + DASH_M);
            if (b > a) pieces.push(p.s <= q.s ? [(a - from) / len, (b - from) / len] : [1 - (b - from) / len, 1 - (a - from) / len]);
          }
        }
        const lp = (p.b[k] as number) + inset;
        const lq = (q.b[k] as number) + inset;
        for (const [u, v] of pieces) {
          const at = (t: number, off: number): V3 => {
            const lat = lerp(lp, lq, t) + off;
            return [lerp(p.x + p.nx * lat, q.x + q.nx * lat, t), lerp(p.h, q.h, t) + PAINT_LIFT_M, lerp(p.z + p.nz * lat, q.z + q.nz * lat, t)];
          };
          sink.quad('marking', at(u, LINE_HALF_M), at(u, -LINE_HALF_M), at(v, -LINE_HALF_M), at(v, LINE_HALF_M), [0, 1, 0]);
          quads++;
        }
      }
    }
  }
  return quads;
}
