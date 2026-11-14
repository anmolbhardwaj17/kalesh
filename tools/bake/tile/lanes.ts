// The lanes array of a tile (P1-016, TECH.md "Tile format": "lanes, the lane graph for traffic and pursuit"): the
// lane graph of the lanes step (roads/laneout.ts laneGraph) with heights, cut at the tile lines. A driving lane is cut
// into pieces, one per run of segments whose middle lies in one tile, so no point lies far outside its tile; the
// pieces of one lane share their end points and name each other in `next`. A junction path is cut the same way (most
// stay whole; a few of the widest junctions have paths over a kilometre long). Heights: a lane point takes its station's solved height; a path runs evenly from the
// height where its lane ends to the height where the next lane starts. Pure.
import type { P2 } from '../geom.ts';
import { tileId, tileOf } from '../layout/grid.ts';
import type { Strip } from '../roads/model.ts';
import type { LaneGraphFile } from '../roads/laneout.ts';
import type { TileLane } from './codec.ts';

/** A piece of the lane graph in world metres, with the tile it is filed under. */
export type LanePiece = TileLane & { tile: string };

export function lanePieces(g: LaneGraphFile, strips: readonly Strip[], offset: P2): LanePiece[] {
  const firstPiece = new Map<string, string>();
  const lastHeight = new Map<string, number>();
  const firstHeight = new Map<string, number>();
  const runs: { of: string; next: string[]; back: string[] | null; list: LanePiece[] }[] = [];
  for (const l of g.lanes) {
    const s = strips[l.strip] as Strip;
    const dir = s.lanes[l.lane]?.dir ?? 1;
    const hs = s.st.map((st) => st.h);
    if (dir === -1) hs.reverse();
    const pts = l.pts.map((p, i) => [p[0] + offset.x, hs[i] ?? hs[hs.length - 1] ?? 0, p[1] + offset.z] as V3);
    firstHeight.set(l.id, pts[0]?.[1] ?? 0);
    lastHeight.set(l.id, pts[pts.length - 1]?.[1] ?? 0);
    const base = { kind: 'lane' as const, of: l.id, cls: l.cls, widthM: l.widthM, layer: l.layer, ...(l.gali ? { gali: true as const } : {}), ...(l.modes ? { modes: l.modes } : {}), ...(l.private ? { private: true as const } : {}) };
    const list = cut(pts, (k, tile, p) => ({ ...base, id: `${l.id}:${k}`, part: k, next: [], pts: p, tile }));
    if (!list.length) continue;
    firstPiece.set(l.id, (list[0] as LanePiece).id);
    runs.push({ of: l.id, next: l.next, back: l.bothWays ? (l.back ?? []) : null, list });
  }
  const byId = new Map(g.lanes.map((l) => [l.id, l]));
  for (const p of g.paths) {
    const h0 = lastHeight.get(p.from) ?? 0;
    const h1 = firstHeight.get(p.to) ?? h0;
    let total = 0;
    for (let i = 1; i < p.pts.length; i++) total += Math.hypot((p.pts[i] as [number, number])[0] - (p.pts[i - 1] as [number, number])[0], (p.pts[i] as [number, number])[1] - (p.pts[i - 1] as [number, number])[1]);
    let run = 0;
    const pts = p.pts.map((q, i) => {
      if (i > 0) run += Math.hypot(q[0] - (p.pts[i - 1] as [number, number])[0], q[1] - (p.pts[i - 1] as [number, number])[1]);
      return [q[0] + offset.x, h0 + (h1 - h0) * (total > 0 ? run / total : 0), q[1] + offset.z] as V3;
    });
    const from = byId.get(p.from);
    const base = { kind: 'path' as const, of: p.id, cls: from?.cls ?? '', widthM: from?.widthM ?? 0, layer: from?.layer ?? 0, junction: p.junction, turn: p.turn, stop: p.stop, ...(p.modes ? { modes: p.modes } : {}) };
    const list = cut(pts, (k, tile, q) => ({ ...base, id: `${p.id}:${k}`, part: k, next: [], pts: q, tile }));
    if (!list.length) continue;
    firstPiece.set(p.id, (list[0] as LanePiece).id);
    runs.push({ of: p.id, next: [p.to], back: null, list });
  }
  const to = (ids: readonly string[]): string[] => ids.map((id) => firstPiece.get(id)).filter((x): x is string => x !== undefined);
  const out: LanePiece[] = [];
  for (const { next, back, list } of runs) {
    list.forEach((p, k) => {
      p.next = k + 1 < list.length ? [(list[k + 1] as LanePiece).id] : to(next);
      if (back) p.back = k > 0 ? [(list[k - 1] as LanePiece).id] : to(back);
      out.push(p);
    });
  }
  return out;
}

type V3 = [number, number, number];

/** A polyline (world metres) cut into runs of segments whose middles lie in one tile; neighbouring runs share a point. */
function cut(pts: readonly V3[], make: (k: number, tile: string, pts: number[]) => LanePiece): LanePiece[] {
  const list: LanePiece[] = [];
  let cur: { tile: string; pts: number[] } | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as V3;
    const b = pts[i + 1] as V3;
    const t = tileOf((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
    const tile = tileId(t.tx, t.tz);
    if (!cur || cur.tile !== tile) {
      if (cur) list.push(make(list.length, cur.tile, cur.pts));
      cur = { tile, pts: [a[0], a[1], a[2]] };
    }
    cur.pts.push(b[0], b[1], b[2]);
  }
  if (cur) list.push(make(list.length, cur.tile, cur.pts));
  return list;
}
