// The infrastructure kits of a bake stage (P2-034, STYLE_BIBLE.md "Infrastructure", the reference folder
// harness/design/reference/infrastructure/): every flyover, bridge, viaduct, rail stretch and foot bridge as kit
// inputs per tile (infra.json in the tile folder, world metres), which the game builds in the signed look
// (game/world/infra/), and the plain shapes the kits stand on as colliders (`railbed`, `fob`, `pier`, `abutment`
// materials in the tiles, never drawn when the folder has infra.json). The road structures' own colliders come from
// the mesh step (mesh/structures.ts: barrier, fascia, retaining, abutment, pier). Pure.
//
// Records of one tile (numbers rounded to the centimetre, flat arrays to keep the file small):
//   edges   {v, k: d|f, p: [x, y, z, top, foot, ox, oz] per point}  a deck side (d) or a fill side (f): the road edge
//           at the lane top, the barrier top, the foot of the side face, the outward normal
//   soffits {v, p: [lx, ly, lz, rx, ry, rz] per point}             a deck's underside, left and right edge
//   faces   {v, p: 4 corners}                                        a plain end wall where a ramp meets a deck
//   piers   {v, x, z, y0, y1, dx, dz, w, d, s, r?, portal?}          a column: foot, top, the deck direction, the
//           ring width across the deck, the deck width, the shape (twin, single, wall, round), a round radius
//   beams   {v, r: 4 plan corners, y0, y1}                            a portal's cross beam
//   tracks  {v, b: bridge, p: [x, y, z, g, f] per point}             a railway track: y the sleeper base, g the ground,
//           f 0 ballast, 1 level crossing, 2 bridge deck
//   masts   {x, y, z, dx, dz, reach, wire}                           an overhead line mast and its arm
//   metro   {v, twin, p: [x, y, z, g] per point}                     a metro deck: y the rail level
//   fobs    {v, w, h, p: [x, z] per point, stairs: [[x, z, dx, dz, rise]]}  a foot bridge's walking level
import type { P2 } from '../geom.ts';
import type { FootBridgeHeights, Viaduct } from '../elevation/overhead.ts';
import type { Strip } from '../roads/model.ts';
import { Sink } from '../mesh/solids.ts';
import type { V3 } from '../mesh/solids.ts';
import { pierColumns, prismSides } from '../mesh/structures.ts';
import type { KitRecords, Pier } from '../mesh/structures.ts';
import type { SourceMesh } from '../tile/cutter.ts';
import { TILE_M } from '../layout/grid.ts';
import { F_BALLAST, F_BRIDGE, F_CROSSING, buildTracks } from './rails.ts';
import type { RailIn } from './rails.ts';
import { footDecks, metroDecks, railBridgePiers, STAIR_SLOPE } from './elevated.ts';
import { buildPlatforms } from './platforms.ts';
import type { PlatformSource } from './platforms.ts';
import { triangulateRing } from '../mesh/solids.ts';
import type { Support } from './elevated.ts';
import { VARIANTS, footBridgeVariant, railVariant } from './variants.ts';
import type { VariantRules } from './variants.ts';

export interface InfraInput {
  strips: readonly Strip[];
  variants: readonly (string | null)[];
  kit: KitRecords;
  piers: readonly Pier[];
  rails: readonly { id: string; kind: string; name: string; pts: P2[]; bridge: boolean; tunnel: boolean; layer: number }[];
  viaducts: readonly Viaduct[];
  footBridges: readonly { id: string; ways: string[]; pts: P2[][] }[];
  footHeights: readonly FootBridgeHeights[];
  ground: (x: number, z: number) => number;
  groundModel: (x: number, z: number) => number;
  roadAt: (x: number, z: number, near: number) => number;
  blocked: (x: number, z: number, r: number, below: number) => boolean;
  railEmbankment: number;
  /** Skyline pieces outside the stage (the Signature Bridge, bridges.md BRI-Y2): block metres, the bearing of the deck. */
  skyline?: readonly { id: string; variant: string; name: string; x: number; z: number; y: number; bearingDeg: number }[];
  /** Railway platforms of the extract (platforms.ts); absent: none. */
  platforms?: readonly PlatformSource[];
  rules: VariantRules;
  /** World = block + offset. */
  offset: P2;
  stage: string;
  block: string;
}

export interface InfraRecord {
  variants: Record<string, number>;
  edgesM: number;
  piers: number;
  tracksKm: number;
  levelCrossingSamples: number;
  embankmentM: number;
  railBridges: number;
  masts: number;
  platforms: number;
  platformsSkipped: number;
  metroDecks: number;
  metroPiers: number;
  metroPiersMoved: number;
  metroPiersSkipped: number;
  footBridges: number;
  footColumns: number;
  stairs: number;
  /** Structures left with no kit (must be 0): strips on a deck or a fill without a variant. */
  withoutKit: string[];
  tiles: number;
  envelopeTriangles: number;
}

type TileRecs = Record<string, unknown[]>;

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

export function buildInfra(input: InfraInput): { file: unknown; meshes: SourceMesh[]; record: InfraRecord } {
  const { offset } = input;
  const tiles = new Map<string, TileRecs>();
  const tileOf = (bx: number, bz: number): string => `${Math.floor((bx + offset.x) / TILE_M)}_${Math.floor((bz + offset.z) / TILE_M)}`;
  const put = (tile: string, kind: string, rec: unknown): void => {
    let t = tiles.get(tile);
    if (!t) tiles.set(tile, (t = {}));
    (t[kind] ??= []).push(rec);
  };
  const W = (x: number, z: number): [number, number] => [r2(x + offset.x), r2(z + offset.z)];
  const P = (x: number, y: number, z: number): [number, number, number] => [r2(x + offset.x), r2(y), r2(z + offset.z)];
  const count: Record<string, number> = {};
  const used = (v: string): void => {
    count[v] = (count[v] ?? 0) + 1;
  };
  const record: InfraRecord = { variants: count, edgesM: 0, piers: 0, tracksKm: 0, levelCrossingSamples: 0, embankmentM: 0, railBridges: 0, masts: 0, platforms: 0, platformsSkipped: 0, metroDecks: 0, metroPiers: 0, metroPiersMoved: 0, metroPiersSkipped: 0, footBridges: 0, footColumns: 0, stairs: 0, withoutKit: [], tiles: 0, envelopeTriangles: 0 };

  /** Cuts a run of points into pieces per tile (by the midpoint of each segment), each piece sharing its end point with the next. */
  const perTile = <T>(pts: readonly T[], xz: (p: T) => [number, number], emit: (tile: string, piece: T[]) => void): void => {
    if (pts.length < 2) return;
    let cur: T[] = [pts[0] as T];
    let tile = '';
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = xz(pts[k] as T);
      const [bx, bz] = xz(pts[k + 1] as T);
      const t = tileOf((ax + bx) / 2, (az + bz) / 2);
      if (tile && t !== tile) {
        emit(tile, cur);
        cur = [pts[k] as T];
      }
      tile = t;
      cur.push(pts[k + 1] as T);
    }
    if (cur.length >= 2) emit(tile, cur);
  };

  // ---- road structures: deck and fill sides, undersides, end walls, piers and portal beams
  const variantOf = (si: number): string => {
    const v = input.variants[si];
    if (v) return v;
    const s = input.strips[si] as Strip;
    if (record.withoutKit.length < 40 && !record.withoutKit.includes(s.id)) record.withoutKit.push(s.id);
    return 'FLY-T1';
  };
  const runs = new Map<string, typeof input.kit.edges>();
  for (const e of input.kit.edges) {
    const k = `${e.strip}|${e.side}|${e.kind}`;
    let list = runs.get(k);
    if (!list) runs.set(k, (list = []));
    list.push(e);
  }
  for (const list of runs.values()) {
    list.sort((a, b) => a.station - b.station);
    // consecutive stations make one run
    let run: typeof list = [];
    const flush = (): void => {
      if (!run.length) return;
      const first = run[0] as (typeof list)[number];
      const v = variantOf(first.strip);
      used(v);
      const pts = [
        { p: first.a, top: first.top[0], foot: first.foot[0], o: first.out },
        ...run.map((e) => ({ p: e.b, top: e.top[1], foot: e.foot[1], o: e.out })),
      ];
      for (let k = 1; k < pts.length; k++) record.edgesM += Math.hypot((pts[k] as { p: V3 }).p[0] - (pts[k - 1] as { p: V3 }).p[0], (pts[k] as { p: V3 }).p[2] - (pts[k - 1] as { p: V3 }).p[2]);
      perTile(pts, (q) => [q.p[0], q.p[2]], (tile, piece) => {
        put(tile, 'edges', { v, k: first.kind === 'deck' ? 'd' : 'f', p: piece.flatMap((q) => [...P(q.p[0], q.p[1], q.p[2]), r2(q.top), r2(q.foot), r3(q.o[0]), r3(q.o[1])]) });
      });
      run = [];
    };
    for (const e of list) {
      const last = run[run.length - 1];
      if (last && e.station !== last.station + 1) flush();
      run.push(e);
    }
    flush();
  }
  const soffitRuns = new Map<number, typeof input.kit.soffits>();
  for (const s of input.kit.soffits) {
    let list = soffitRuns.get(s.strip);
    if (!list) soffitRuns.set(s.strip, (list = []));
    list.push(s);
  }
  for (const [si, list] of soffitRuns) {
    list.sort((a, b) => a.station - b.station);
    const v = variantOf(si);
    let run: typeof list = [];
    const flush = (): void => {
      if (!run.length) return;
      const first = run[0] as (typeof list)[number];
      const pts = [{ l: first.l0, r: first.r0 }, ...run.map((s) => ({ l: s.l1, r: s.r1 }))];
      perTile(pts, (q) => [(q.l[0] + q.r[0]) / 2, (q.l[2] + q.r[2]) / 2], (tile, piece) => {
        put(tile, 'soffits', { v, p: piece.flatMap((q) => [...P(q.l[0], q.l[1], q.l[2]), ...P(q.r[0], q.r[1], q.r[2])]) });
      });
      run = [];
    };
    for (const s of list) {
      const last = run[run.length - 1];
      if (last && s.station !== last.station + 1) flush();
      run.push(s);
    }
    flush();
  }
  for (const f of input.kit.faces) {
    const [a] = f.pts;
    put(tileOf(a[0], a[2]), 'faces', { v: variantOf(f.strip), p: f.pts.flatMap((q) => [r2(q[0] + offset.x), r2(q[1]), r2(q[2] + offset.z)]) });
  }
  for (const p of input.piers) {
    const cx = p.ring.reduce((s, q) => s + q[0], 0) / p.ring.length;
    const cz = p.ring.reduce((s, q) => s + q[1], 0) / p.ring.length;
    const a = p.ring[0] as [number, number];
    const b = p.ring[1] as [number, number];
    const across = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [x, z] = W(cx, cz);
    const dir = p.dir ?? [1, 0];
    put(tileOf(cx, cz), 'piers', { v: variantOf(p.strip), x, z, y0: r2(p.bottom), y1: r2(p.top), dx: r3(dir[0]), dz: r3(dir[1]), w: r2(across), d: r2(p.deckW ?? across), s: p.portal ? 'portal' : (p.shape ?? 'wall'), ...(p.portal ? { ring: p.ring.flatMap((q) => W(q[0], q[1])) } : {}) });
    record.piers++;
  }
  for (const b of input.kit.beams) {
    const cx = b.ring.reduce((s, q) => s + q[0], 0) / b.ring.length;
    const cz = b.ring.reduce((s, q) => s + q[1], 0) / b.ring.length;
    put(tileOf(cx, cz), 'beams', { v: variantOf(b.strip), r: b.ring.flatMap((q) => W(q[0], q[1])), y0: r2(b.bottom), y1: r2(b.top) });
  }

  // ---- envelopes: the colliders of what the kits add (block metres, cut into the tiles with the road mesh)
  const sink = new Sink();
  const support = (s: Support, kind: string): void => {
    const shape = kind === 'metro' || kind === 'fob' ? 'round' : 'wall';
    const half = shape === 'round' ? 0.5 : Math.min(2.75, s.deckW / 2 - 0.25);
    // a round column of radius r: the octagon of pierColumns scaled to it
    const nx = -s.dz;
    const nz = s.dx;
    let rings = pierColumns(shape, s.x, s.z, nx, nz, half);
    if (shape === 'round') rings = rings.map((ring) => ring.map(([x, z]) => [s.x + (x - s.x) * (s.r / 0.5), s.z + (z - s.z) * (s.r / 0.5)] as [number, number]));
    for (const ring of rings) prismSides(sink, 'pier', ring, s.y0, s.y1);
    const [x, z] = W(s.x, s.z);
    put(tileOf(s.x, s.z), 'piers', { v: s.variant, x, z, y0: r2(s.y0), y1: r2(s.y1), dx: r3(s.dx), dz: r3(s.dz), w: r2(shape === 'round' ? s.r * 2 : half * 2), d: r2(s.deckW), s: shape, r: r2(s.r) });
  };

  // ---- railway: tracks, rail bridges and their piers and abutments, the overhead line masts
  const railLines: RailIn[] = input.rails.filter((r) => r.kind === 'rail' || (r.kind === 'metro' && !r.bridge && !r.tunnel)).map((r) => ({
    id: r.id, name: r.name, kind: r.kind, pts: r.pts, bridge: r.bridge, tunnel: r.tunnel,
    variant: r.kind === 'metro' ? input.rules.metro.ramp : railVariant(r, input.rules),
  }));
  const rail = buildTracks({ lines: railLines, ground: input.ground, groundModel: input.groundModel, roadAt: input.roadAt, blocked: input.blocked, railEmbankment: input.railEmbankment });
  record.tracksKm = rail.stats.km;
  record.levelCrossingSamples = rail.stats.crossings;
  record.embankmentM = rail.stats.embankmentM;
  record.railBridges = rail.stats.bridges;
  record.masts = rail.masts.length;
  for (const t of rail.tracks) {
    used(t.variant);
    perTile(t.pts, (q) => [q.x, q.z], (tile, piece) => {
      put(tile, 'tracks', { v: t.variant, b: t.bridge ? 1 : 0, p: piece.flatMap((q) => [...P(q.x, q.y, q.z), r2(q.g), q.f]) });
    });
    // the envelope: the ballast bed's top and sides (not across a level crossing), a bridge's end walls
    for (let k = 0; k + 1 < t.pts.length; k++) {
      const p = t.pts[k] as (typeof t.pts)[number];
      const q = t.pts[k + 1] as (typeof t.pts)[number];
      if (p.f === F_CROSSING || q.f === F_CROSSING) continue;
      const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const nx = -(q.z - p.z) / len;
      const nz = (q.x - p.x) / len;
      const hw = p.f === F_BRIDGE ? 2.6 : 1.7;
      const A = (s: { x: number; z: number }, side: number, y: number): V3 => [s.x + nx * hw * side, y, s.z + nz * hw * side];
      sink.quad('railbed', A(p, 1, p.y), A(q, 1, q.y), A(q, -1, q.y), A(p, -1, p.y), [0, 1, 0]);
      if (p.f === F_BALLAST && q.f === F_BALLAST) {
        for (const side of [1, -1]) {
          const out = (s: (typeof t.pts)[number]): V3 => [s.x + nx * (hw + Math.max(0.3, s.y - s.g)) * side, Math.min(s.g, s.y) - 0.05, s.z + nz * (hw + Math.max(0.3, s.y - s.g)) * side];
          sink.quad('railbed', A(p, side, p.y), out(p), out(q), A(q, side, q.y), [nx * side, 0.5, nz * side]);
        }
      }
    }
    if (t.bridge && t.pts.length >= 2) {
      for (const e of [0, t.pts.length - 1]) {
        const p = t.pts[e] as (typeof t.pts)[number];
        const o = t.pts[e === 0 ? 1 : e - 1] as (typeof t.pts)[number];
        const len = Math.hypot(p.x - o.x, p.z - o.z) || 1;
        const nx = -(p.z - o.z) / len;
        const nz = (p.x - o.x) / len;
        const A = (side: number, y: number): V3 => [p.x + nx * 3.2 * side, y, p.z + nz * 3.2 * side];
        sink.quad('abutment', A(1, p.y), A(-1, p.y), A(-1, p.g - 0.5), A(1, p.g - 0.5), [(p.x - o.x) / len, 0, (p.z - o.z) / len]);
      }
    }
  }
  for (const s of railBridgePiers(rail.tracks, input.blocked)) support(s, 'rail');
  for (const m of rail.masts) {
    const [x, z] = W(m.x, m.z);
    put(tileOf(m.x, m.z), 'masts', { x, y: r2(m.y), z, dx: r3(m.dx), dz: r3(m.dz), reach: r2(m.reach), wire: r2(m.wire) });
    // the mast's foot as a collider (a steel column 0.35 m square)
    prismSides(sink, 'pier', [[m.x - 0.18, m.z - 0.18], [m.x + 0.18, m.z - 0.18], [m.x + 0.18, m.z + 0.18], [m.x - 0.18, m.z + 0.18]], m.y, m.y + 3);
  }

  // ---- platforms beside the tracks, with their roofs (an envelope prism as the collider)
  const plat = buildPlatforms(input.platforms ?? [], rail.tracks);
  record.platforms = plat.platforms.length;
  record.platformsSkipped = plat.skipped;
  for (const p of plat.platforms) {
    used('RAIL-PLAT');
    const mid = { x: (p.axis[0].x + p.axis[1].x) / 2, z: (p.axis[0].z + p.axis[1].z) / 2 };
    let low = Infinity;
    for (const q of p.ring) {
      const g = input.ground(q.x, q.z);
      low = Math.min(low, Number.isFinite(g) ? g : input.groundModel(q.x, q.z));
    }
    const foot = Math.min(low, p.top - 0.3) - 0.3;
    put(tileOf(mid.x, mid.z), 'platforms', { v: 'RAIL-PLAT', r: p.ring.flatMap((q) => W(q.x, q.z)), a: [...W(p.axis[0].x, p.axis[0].z), ...W(p.axis[1].x, p.axis[1].z)], h: r2(p.top), g: r2(foot), roof: p.roof ? 1 : 0 });
    // (cut into 30 m slabs across its axis, every edge under 20 m: the tile cutter takes a triangle to the tile of its
    // centre and allows 250 m past it, and a station platform is up to 600 m long)
    const ax = p.axis[1].x - p.axis[0].x;
    const az = p.axis[1].z - p.axis[0].z;
    const al = Math.hypot(ax, az) || 1;
    const along = (q: P2): number => ((q.x - p.axis[0].x) * ax + (q.z - p.axis[0].z) * az) / al;
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of p.ring) {
      lo = Math.min(lo, along(q));
      hi = Math.max(hi, along(q));
    }
    const slabs = Math.max(1, Math.ceil((hi - lo) / 30));
    for (let k = 0; k < slabs; k++) {
      const piece = clipSlab(p.ring, along, lo + ((hi - lo) * k) / slabs - 1e-6, lo + ((hi - lo) * (k + 1)) / slabs + 1e-6);
      if (piece.length < 3) continue;
      const fine = densify(piece, 20);
      prismSides(sink, 'platform', fine.map((q) => [q.x, q.z] as [number, number]), foot, p.top);
      const idx = triangulateRing(fine.map((q) => [q.x, q.z] as [number, number]));
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const [a, b, c] = [fine[idx[t] as number] as P2, fine[idx[t + 1] as number] as P2, fine[idx[t + 2] as number] as P2];
        sink.tri('platform', [a.x, p.top, a.z], [b.x, p.top, b.z], [c.x, p.top, c.z], [0, 1, 0]);
      }
    }
  }

  // ---- the elevated metro
  const metro = metroDecks(input.viaducts, input.rules.metro.viaduct, input.blocked);
  record.metroDecks = metro.decks.length;
  record.metroPiers = metro.piers.length;
  record.metroPiersMoved = metro.moved;
  record.metroPiersSkipped = metro.skipped;
  for (const d of metro.decks) {
    used(d.variant);
    perTile(d.pts, (q) => [q[0], q[1]], (tile, piece) => {
      put(tile, 'metro', { v: d.variant, twin: d.twin ? 1 : 0, p: piece.flatMap((q) => [...P(q[0], q[2], q[1]), r2(q[3])]) });
    });
  }
  for (const p of metro.piers) support(p, 'metro');

  // ---- foot over bridges off the road graph (the ones on it are road structures with a FOB variant)
  const foot = footDecks(input.footBridges, input.footHeights, (b) => footBridgeVariant(b, input.rules), input.blocked, (x, z) => {
    const g = input.ground(x, z);
    return Number.isFinite(g) ? g : input.groundModel(x, z);
  });
  record.footBridges = foot.decks.length;
  record.footColumns = foot.columns.length;
  for (const d of foot.decks) {
    used(d.variant);
    const w = d.variant === 'FOB-B1' || d.variant === 'FOB-B3' ? 5 : d.variant === 'FOB-B5' ? 2.2 : 3.2;
    const stairs = d.stairs.map((s) => [...W(s.x, s.z), r3(s.dx), r3(s.dz), r2(s.rise)]);
    record.stairs += stairs.length;
    for (const l of d.lines) {
      // a foot bridge is one record per line in the tile of its middle (its stairs with it)
      const mid = l[Math.floor(l.length / 2)] as P2;
      put(tileOf(mid.x, mid.z), 'fobs', { v: d.variant, w, h: r2(d.deckH), p: l.flatMap((q) => W(q.x, q.z)), stairs: d.lines.indexOf(l) === 0 ? stairs : [] });
      // the envelope: the walking slab
      for (let k = 0; k + 1 < l.length; k++) {
        const p = l[k] as P2;
        const q = l[k + 1] as P2;
        const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const nx = (-(q.z - p.z) / len) * (w / 2);
        const nz = ((q.x - p.x) / len) * (w / 2);
        sink.quad('fob', [p.x + nx, d.deckH, p.z + nz], [q.x + nx, d.deckH, q.z + nz], [q.x - nx, d.deckH, q.z - nz], [p.x - nx, d.deckH, p.z - nz], [0, 1, 0]);
      }
    }
    for (const s of d.stairs) {
      // the stair as a slope from the deck down to the ground ahead of the bridge end
      const run = s.rise / STAIR_SLOPE;
      const hw = Math.min(1.25, w / 2);
      const nx = -s.dz * hw;
      const nz = s.dx * hw;
      const ex = s.x + s.dx * run;
      const ez = s.z + s.dz * run;
      sink.quad('fob', [s.x + nx, d.deckH, s.z + nz], [ex + nx, d.deckH - s.rise, ez + nz], [ex - nx, d.deckH - s.rise, ez - nz], [s.x - nx, d.deckH, s.z - nz], [0, 1, 0]);
    }
  }
  for (const c of foot.columns) support(c, 'fob');

  const meshes: SourceMesh[] = [...sink.meshes.values()].filter((m) => m.idx.length > 0);
  record.envelopeTriangles = meshes.reduce((s, m) => s + m.idx.length / 3, 0);
  record.tiles = tiles.size;
  const out: Record<string, TileRecs> = {};
  for (const id of [...tiles.keys()].sort()) out[id] = tiles.get(id) as TileRecs;
  const file = {
    _doc: 'Infrastructure kits of the tile folder (P2-034, tools/bake/infra/build.ts header has every record): per tile the flyover and bridge sides, undersides and piers, the railway tracks and their overhead line masts, the metro decks and the foot over bridges, world metres. The game builds each from its variant kit (game/world/infra/); the tiles hold the plain shapes as colliders only.',
    version: 1, stage: input.stage, block: input.block,
    variants: Object.fromEntries(Object.keys(count).sort().map((k) => [k, { name: VARIANTS[k]?.name ?? k, family: VARIANTS[k]?.family ?? '', uses: count[k] }])),
    // far pieces of the skyline, never reachable: the game builds them once with the landmarks' haze material
    skyline: (input.skyline ?? []).map((k) => {
      used(k.variant);
      return { id: k.id, v: k.variant, name: k.name, pos: P(k.x, k.y, k.z), bearingDeg: k.bearingDeg };
    }),
    tiles: out,
  };
  return { file, meshes, record };
}


/** The part of a ring between two values of a linear measure (Sutherland-Hodgman against the two half planes). */
export function clipSlab(ring: readonly P2[], f: (q: P2) => number, lo: number, hi: number): P2[] {
  const cut = (pts: readonly P2[], keep: (v: number) => boolean, at: number): P2[] => {
    const out: P2[] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k] as P2;
      const b = pts[(k + 1) % pts.length] as P2;
      const fa = f(a);
      const fb = f(b);
      if (keep(fa)) out.push(a);
      if (keep(fa) !== keep(fb)) {
        const t = (at - fa) / (fb - fa);
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    return out;
  };
  return cut(cut(ring, (v) => v >= lo, lo), (v) => v <= hi, hi);
}

/** A ring with points added so no edge is longer than `max`. */
export function densify(ring: readonly P2[], max: number): P2[] {
  const out: P2[] = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k] as P2;
    const b = ring[(k + 1) % ring.length] as P2;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / max));
    for (let i = 0; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
  }
  return out;
}
