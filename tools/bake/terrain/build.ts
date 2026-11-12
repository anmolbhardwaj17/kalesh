// The ground of a bake stage (P1-015, MAP_REPAIR.md "Terrain that fits the roads", ARCH_OPTIONS TF2): the entry of
// the terrain step. Order: collect the points and segments (the road mesh's free edges, footprints, water, open
// land, the outline, the tile lines, a lattice inside the blocks); one constrained Delaunay triangulation of all of
// it; heights; then the draw meshes, tile by tile. It reads the road mesh, the lane model's heights and the ground
// model and builds none of them again. The ground is cut to the road edge, so there is no second surface under a
// road that could disagree with it (the old game's fault). Pure.
import { TILE_M } from '../layout/grid.ts';
import type { MeshData } from '../tile.ts';
import { TERRAIN_DEFAULTS, collect } from './collect.ts';
import type { Collected, TerrainInput, TerrainOptions } from './collect.ts';
import { buildSurface } from './surface.ts';
import type { Surface } from './surface.ts';
import { C_GROUND, C_LAWN, C_PLOT, C_WATER, triangulate } from './triangulate.ts';
import type { Triangulation } from './triangulate.ts';

export interface GroundTile {
  tx: number;
  tz: number;
  /** x and z in metres from the tile's north-west corner (world grid), y in metres as solved; Godot winding. */
  meshes: MeshData[];
}

export interface Ground {
  input: TerrainInput;
  options: TerrainOptions;
  collected: Collected;
  tg: Triangulation;
  surface: Surface;
  tiles: GroundTile[];
  ms: Record<string, number>;
}

export const MATERIAL_OF: Readonly<Record<number, string>> = { [C_GROUND]: 'ground', [C_LAWN]: 'lawn', [C_PLOT]: 'plot', [C_WATER]: 'bed' };
export const GROUND_MATERIALS = ['ground', 'lawn', 'plot', 'bed', 'water'] as const;

class Group {
  readonly meshes = new Map<string, MeshData>();
  private readonly index = new Map<string, Map<number, number>>();

  mesh(material: string): MeshData {
    let m = this.meshes.get(material);
    if (!m) this.meshes.set(material, (m = { name: material, material, pos: [], nrm: [], idx: [] }));
    return m;
  }

  /** A shared vertex of a material (one per triangulation vertex), or a new one when `v` is negative. */
  vertex(material: string, v: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const m = this.mesh(material);
    let ids = this.index.get(material);
    if (!ids) this.index.set(material, (ids = new Map()));
    const old = v >= 0 ? ids.get(v) : undefined;
    if (old !== undefined) return old;
    const id = m.pos.length / 3;
    m.pos.push(x, y, z);
    m.nrm.push(nx, ny, nz);
    if (v >= 0) ids.set(v, id);
    return id;
  }
}

/**
 * Draw meshes of the ground. `pick` names the group of a triangle from its centre in block metres (a negative
 * number: left out); `origin` is taken off x and z. Every triangle turns Godot's way (clockwise seen from above).
 */
export function emitGround(g: Pick<Ground, 'tg' | 'surface'>, pick: (cx: number, cz: number) => number, origin: (group: number) => { x: number; z: number }): Map<number, MeshData[]> {
  const { vx, vz } = g.tg;
  const s = g.surface;
  const groups = new Map<number, Group>();
  const groupAt = (cx: number, cz: number): { grp: Group; o: { x: number; z: number } } | null => {
    const id = pick(cx, cz);
    if (id < 0) return null;
    let grp = groups.get(id);
    if (!grp) groups.set(id, (grp = new Group()));
    return { grp, o: origin(id) };
  };
  const ne = s.cls.length;
  for (let e = 0; e < ne; e++) {
    const a = s.tri[e * 3] as number;
    const b = s.tri[e * 3 + 1] as number;
    const c = s.tri[e * 3 + 2] as number;
    const at = groupAt(((vx[a] as number) + (vx[b] as number) + (vx[c] as number)) / 3, ((vz[a] as number) + (vz[b] as number) + (vz[c] as number)) / 3);
    if (!at) continue;
    const material = MATERIAL_OF[s.cls[e] as number] as string;
    const m = at.grp.mesh(material);
    for (let i = 0; i < 3; i++) {
      const v = s.tri[e * 3 + i] as number;
      const y = s.cy[e * 3 + i] as number;
      // a corner at its vertex's own height shares the vertex; a corner at a step gets its own
      m.idx.push(at.grp.vertex(material, y === s.vy[v] ? v : -1, (vx[v] as number) - at.o.x, y, (vz[v] as number) - at.o.z, s.nrm[v * 3] as number, s.nrm[v * 3 + 1] as number, s.nrm[v * 3 + 2] as number));
    }
    if (s.cls[e] === C_WATER) {
      const level = (s.waters[s.body[e] as number] as { level: number }).level;
      const w = at.grp.mesh('water');
      for (let i = 0; i < 3; i++) {
        const v = s.tri[e * 3 + i] as number;
        w.idx.push(at.grp.vertex('water', v, (vx[v] as number) - at.o.x, level, (vz[v] as number) - at.o.z, 0, 1, 0));
      }
    }
  }
  for (let k = 0; k + 11 < s.skirts.length; k += 12) {
    const p = s.skirts;
    const at = groupAt(((p[k] as number) + (p[k + 3] as number) + (p[k + 6] as number)) / 3, ((p[k + 2] as number) + (p[k + 5] as number) + (p[k + 8] as number)) / 3);
    if (!at) continue;
    const m = at.grp.mesh('ground');
    const n = [p[k + 9] as number, p[k + 10] as number, p[k + 11] as number];
    const ux = (p[k + 3] as number) - (p[k] as number);
    const uy = (p[k + 4] as number) - (p[k + 1] as number);
    const uz = (p[k + 5] as number) - (p[k + 2] as number);
    const wx = (p[k + 6] as number) - (p[k] as number);
    const wy = (p[k + 7] as number) - (p[k + 1] as number);
    const wz = (p[k + 8] as number) - (p[k + 2] as number);
    // Godot: for a front face (b - a) x (c - a) points away from the viewer
    const facing = (uy * wz - uz * wy) * (n[0] as number) + (uz * wx - ux * wz) * (n[1] as number) + (ux * wy - uy * wx) * (n[2] as number);
    for (const i of facing > 0 ? [0, 2, 1] : [0, 1, 2]) m.idx.push(at.grp.vertex('ground', -1, (p[k + i * 3] as number) - at.o.x, p[k + i * 3 + 1] as number, (p[k + i * 3 + 2] as number) - at.o.z, n[0] as number, n[1] as number, n[2] as number));
  }
  const out = new Map<number, MeshData[]>();
  for (const [id, grp] of groups) out.set(id, GROUND_MATERIALS.map((name) => grp.meshes.get(name)).filter((m): m is MeshData => m !== undefined && m.idx.length > 0));
  return out;
}

export function buildGround(input: TerrainInput, options: Partial<TerrainOptions> = {}): Ground {
  const opt: TerrainOptions = { ...TERRAIN_DEFAULTS, ...options };
  const ms: Record<string, number> = {};
  const t0 = Date.now();
  let clock = t0;
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = now - clock;
    clock = now;
  };
  const collected = collect(input, opt);
  lap('collect');
  const tg = triangulate(collected, opt);
  for (const [k, v] of Object.entries(tg.ms)) ms[k] = v;
  clock = Date.now();
  const surface = buildSurface(input, tg, collected.meet, opt);
  lap('heights');
  // tiles of the one world grid: a triangle lies inside one tile, because the tile lines are edges of the triangulation
  const SPAN = 100000;
  const { x: ox, z: oz } = input.offset;
  const by = emitGround({ tg, surface }, (cx, cz) => (Math.floor((cx + ox) / TILE_M) + SPAN / 2) * SPAN + (Math.floor((cz + oz) / TILE_M) + SPAN / 2), (id) => ({ x: (Math.floor(id / SPAN) - SPAN / 2) * TILE_M - ox, z: ((id % SPAN) - SPAN / 2) * TILE_M - oz }));
  const tiles: GroundTile[] = [...by].map(([id, meshes]) => ({ tx: Math.floor(id / SPAN) - SPAN / 2, tz: (id % SPAN) - SPAN / 2, meshes })).sort((p, q) => p.tz - q.tz || p.tx - q.tx);
  lap('tiles');
  ms['total'] = Date.now() - t0;
  return { input, options: opt, collected, tg, surface, tiles, ms };
}
