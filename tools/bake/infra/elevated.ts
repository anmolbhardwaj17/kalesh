// The metro viaduct, the foot over bridges and the supports of the rail bridges for the kits (P2-034, metro.md
// MET-VB1, foot_over_bridges.md, bridges.md RBR-U1). Heights come from the elevation step (elevation/overhead.ts)
// and the rail tracks (rails.ts); this file pairs the two tracks of the metro on one deck and finds where the piers,
// columns and stairs may stand: never in a road face (a lane, a parking bay, a junction) under the deck. Pure.
import { pointSegment } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { FootBridgeHeights, Viaduct } from '../elevation/overhead.ts';
import type { Track } from './rails.ts';

/** Deck of the metro under the rail level: the rail top on its plinth, the box girder (metro.md MET-VB1). */
export const METRO_RAIL_OVER_DECK_M = 0.45;
export const METRO_BOX_DEPTH_M = 2.1;
export const METRO_PIER_SPACING_M = 28;
/** A metro pier column: round, 1.6 m across (metro.md: 1.4 to 1.8 m). */
export const METRO_PIER_R = 0.8;
/** Two metro tracks closer than this are one twin-track deck. */
const PAIR_M = 7;
/** Below this height of the rail over the ground the line runs in a trough between walls (MET-RAMP), not on piers. */
export const METRO_TROUGH_M = 4.5;
export const RAIL_PIER_SPACING_M = 20;
export const FOB_COLUMN_R = 0.35;
export const FOB_SPAN_M = 30;
/** Stair slope of a foot bridge (rise over run). */
export const STAIR_SLOPE = 0.62;

export interface Support {
  variant: string;
  x: number;
  z: number;
  /** Foot and top of the column. */
  y0: number;
  y1: number;
  /** Direction of the deck in plan (unit). */
  dx: number;
  dz: number;
  /** Width of the deck it carries. */
  deckW: number;
  r: number;
}

export interface MetroDeck {
  variant: string;
  ids: string[];
  /** Twin track (one box carries both) or a single track. */
  twin: boolean;
  /** Every 10 m: x, z, rail level, ground. */
  pts: [number, number, number, number][];
}

export interface FootDeck {
  id: string;
  variant: string;
  /** Polylines of the walking level. */
  lines: P2[][];
  deckH: number;
  stairs: { x: number; z: number; dx: number; dz: number; rise: number }[];
}

type Blocked = (x: number, z: number, r: number, below: number) => boolean;

/** Searches a free spot for a support near the ideal place, along the line first (up to `reach` m each way). */
function freeSpot(at: (s: number) => { x: number; z: number } | null, s0: number, reach: number, blocked: (x: number, z: number) => boolean): { x: number; z: number; s: number } | null {
  for (let d = 0; d <= reach; d += 2) {
    for (const s of d === 0 ? [s0] : [s0 + d, s0 - d]) {
      const p = at(s);
      if (p && !blocked(p.x, p.z)) return { ...p, s };
    }
  }
  return null;
}

/** Point and height of a polyline with heights at arc length s (clamped to the line). */
function along(pts: readonly [number, number, number, number][], cum: readonly number[], s: number): [number, number, number, number] | null {
  if (s < 0 || s > (cum[cum.length - 1] as number)) return null;
  let k = 0;
  while (k + 2 < cum.length && (cum[k + 1] as number) < s) k++;
  const a = pts[k] as [number, number, number, number];
  const b = pts[k + 1] as [number, number, number, number];
  const t = ((s - (cum[k] as number)) / ((cum[k + 1] as number) - (cum[k] as number) || 1));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

const cumOf = (pts: readonly (readonly number[])[]): number[] => {
  const out = [0];
  for (let k = 1; k < pts.length; k++) out.push((out[k - 1] as number) + Math.hypot((pts[k] as number[])[0]! - (pts[k - 1] as number[])[0]!, (pts[k] as number[])[1]! - (pts[k - 1] as number[])[1]!));
  return out;
};

/**
 * The metro decks: two viaducts whose profiles run within PAIR_M of each other along most of their length are one
 * twin-track box on their middle line; piers every METRO_PIER_SPACING_M where the rail is high enough, moved along
 * the line up to 12 m off a road face.
 */
export function metroDecks(viaducts: readonly Viaduct[], variant: string, blocked: Blocked): { decks: MetroDeck[]; piers: Support[]; moved: number; skipped: number } {
  const decks: MetroDeck[] = [];
  const used = new Set<number>();
  viaducts.forEach((v, vi) => {
    if (used.has(vi) || v.profile.length < 2) return;
    used.add(vi);
    let mate = -1;
    viaducts.forEach((w, wi) => {
      if (mate >= 0 || used.has(wi) || w.profile.length < 2) return;
      const near = v.profile.filter(([x, z]) => w.profile.some(([a, b]) => Math.hypot(a - x, b - z) < PAIR_M + 5)).length;
      if (near >= v.profile.length * 0.7) mate = wi;
    });
    if (mate < 0) {
      decks.push({ variant, ids: [v.id], twin: false, pts: v.profile.map((p) => [...p] as [number, number, number, number]) });
      return;
    }
    used.add(mate);
    const w = viaducts[mate] as Viaduct;
    const wl = w.profile;
    const pts: [number, number, number, number][] = [];
    for (const [x, z, h, g] of v.profile) {
      let best: { d: number; x: number; z: number; h: number; g: number } | null = null;
      for (let k = 0; k + 1 < wl.length; k++) {
        const a = wl[k] as [number, number, number, number];
        const b = wl[k + 1] as [number, number, number, number];
        const ps = pointSegment({ x, z }, { x: a[0], z: a[1] }, { x: b[0], z: b[1] });
        if (!best || ps.d < best.d) best = { d: ps.d, x: ps.x, z: ps.z, h: a[2] + (b[2] - a[2]) * ps.t, g: a[3] + (b[3] - a[3]) * ps.t };
      }
      if (best && best.d < PAIR_M + 5) pts.push([(x + best.x) / 2, (z + best.z) / 2, (h + best.h) / 2, (g + best.g) / 2]);
      else pts.push([x, z, h, g]);
    }
    decks.push({ variant, ids: [v.id, w.id], twin: true, pts });
  });
  const piers: Support[] = [];
  let moved = 0;
  let skipped = 0;
  for (const d of decks) {
    const cum = cumOf(d.pts);
    const total = cum[cum.length - 1] as number;
    const deckW = d.twin ? 9.5 : 5.5;
    for (let s = METRO_PIER_SPACING_M / 2; s < total; s += METRO_PIER_SPACING_M) {
      const p0 = along(d.pts, cum, s);
      if (!p0 || p0[2] - p0[3] < METRO_TROUGH_M) continue;
      const top = (q: [number, number, number, number]): number => q[2] - METRO_RAIL_OVER_DECK_M - METRO_BOX_DEPTH_M;
      const spot = freeSpot((t) => {
        const q = along(d.pts, cum, t);
        return q && q[2] - q[3] >= METRO_TROUGH_M ? { x: q[0], z: q[1] } : null;
      }, s, 12, (x, z) => blocked(x, z, METRO_PIER_R + 0.3, top(p0)));
      if (!spot) {
        skipped++;
        continue;
      }
      if (spot.s !== s) moved++;
      const q = along(d.pts, cum, spot.s) as [number, number, number, number];
      const r = along(d.pts, cum, Math.min(total, spot.s + 1)) ?? q;
      const l = along(d.pts, cum, Math.max(0, spot.s - 1)) ?? q;
      const len = Math.hypot(r[0] - l[0], r[1] - l[1]) || 1;
      piers.push({ variant: d.variant, x: q[0], z: q[1], y0: q[3] - 1, y1: top(q), dx: (r[0] - l[0]) / len, dz: (r[1] - l[1]) / len, deckW, r: METRO_PIER_R });
    }
  }
  return { decks, piers, moved, skipped };
}

/** Foot bridges not on the road graph: the walking level, the columns that hold it and its stairs. */
export function footDecks(bridges: readonly { id: string; ways: string[]; pts: P2[][] }[], heights: readonly FootBridgeHeights[], variantOf: (b: { id: string; ways: readonly string[] }) => string, blocked: Blocked, ground: (x: number, z: number) => number): { decks: FootDeck[]; columns: Support[] } {
  const decks: FootDeck[] = [];
  const columns: Support[] = [];
  const byId = new Map(heights.map((h) => [h.id, h]));
  for (const b of bridges) {
    const h = byId.get(b.id);
    if (!h || h.solved || !Number.isFinite(h.deckH)) continue;
    const variant = variantOf(b);
    const lines = b.pts.filter((l) => l.length >= 2);
    if (!lines.length) continue;
    // a stair runs on from the end of the line it comes down from
    const stairs = h.stairs.map((st) => {
      let dir = { x: 1, z: 0 };
      let bestD = Infinity;
      for (const l of lines) {
        for (const [e, i] of [[0, 1], [l.length - 1, l.length - 2]] as [number, number][]) {
          const pe = l[e] as P2;
          const d = Math.hypot(pe.x - st.x, pe.z - st.z);
          if (d < bestD) {
            bestD = d;
            const pi = l[i] as P2;
            const len = Math.hypot(pe.x - pi.x, pe.z - pi.z) || 1;
            dir = { x: (pe.x - pi.x) / len, z: (pe.z - pi.z) / len };
          }
        }
      }
      return { x: st.x, z: st.z, dx: dir.x, dz: dir.z, rise: st.riseM };
    });
    decks.push({ id: b.id, variant, lines, deckH: h.deckH, stairs });
    const deckW = variant === 'FOB-B1' || variant === 'FOB-B3' ? 5 : variant === 'FOB-B5' ? 2.2 : 3.2;
    for (const l of lines) {
      const pts4 = l.map((p) => [p.x, p.z, h.deckH, ground(p.x, p.z)] as [number, number, number, number]);
      const cum = cumOf(pts4);
      const total = cum[cum.length - 1] as number;
      const n = Math.max(1, Math.ceil(total / FOB_SPAN_M));
      for (let k = 0; k <= n; k++) {
        const s = Math.min(total, Math.max(0, (total * k) / n));
        const spot = freeSpot((t) => {
          const q = along(pts4, cum, Math.min(total, Math.max(0, t)));
          return q ? { x: q[0], z: q[1] } : null;
        }, s, 8, (x, z) => blocked(x, z, FOB_COLUMN_R + 0.2, h.deckH));
        if (!spot) continue;
        const q = along(pts4, cum, Math.min(total, Math.max(0, spot.s))) as [number, number, number, number];
        const r = along(pts4, cum, Math.min(total, spot.s + 1)) ?? q;
        const lft = along(pts4, cum, Math.max(0, spot.s - 1)) ?? q;
        const len = Math.hypot(r[0] - lft[0], r[1] - lft[1]) || 1;
        const g = ground(q[0], q[1]);
        if (!Number.isFinite(g) || h.deckH - g < 2.5) continue;
        if (columns.some((c) => Math.hypot(c.x - q[0], c.z - q[1]) < 6)) continue;
        columns.push({ variant, x: q[0], z: q[1], y0: g - 0.5, y1: h.deckH - 1, dx: (r[0] - lft[0]) / len, dz: (r[1] - lft[1]) / len, deckW, r: FOB_COLUMN_R });
      }
    }
  }
  return { decks, columns };
}

/** Piers under the rail bridges longer than one span, off the roads under them. */
export function railBridgePiers(tracks: readonly Track[], blocked: Blocked): Support[] {
  const out: Support[] = [];
  for (const t of tracks) {
    if (!t.bridge || t.pts.length < 2) continue;
    const pts4 = t.pts.map((p) => [p.x, p.z, p.y, p.g] as [number, number, number, number]);
    const cum = cumOf(pts4);
    const total = cum[cum.length - 1] as number;
    if (total < RAIL_PIER_SPACING_M * 1.5) continue;
    const n = Math.round(total / RAIL_PIER_SPACING_M);
    for (let k = 1; k < n; k++) {
      const s = (total * k) / n;
      const spot = freeSpot((u) => {
        const q = along(pts4, cum, u);
        return q && u > 4 && u < total - 4 ? { x: q[0], z: q[1] } : null;
      }, s, 6, (x, z) => blocked(x, z, 1.2, (t.pts[0] as { y: number }).y));
      if (!spot) continue;
      const q = along(pts4, cum, spot.s) as [number, number, number, number];
      if (q[2] - q[3] < 3) continue;
      const r = along(pts4, cum, Math.min(total, spot.s + 1)) ?? q;
      const l = along(pts4, cum, Math.max(0, spot.s - 1)) ?? q;
      const len = Math.hypot(r[0] - l[0], r[1] - l[1]) || 1;
      out.push({ variant: t.variant, x: q[0], z: q[1], y0: q[3] - 1, y1: q[2] - 1.2, dx: (r[0] - l[0]) / len, dz: (r[1] - l[1]) / len, deckW: 5.5, r: 1.0 });
    }
  }
  return out;
}

