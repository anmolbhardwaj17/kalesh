// Tunnel mouths on the built ground (P1-037, TERR-07): where a tunnel ramp open to the sky meets its roofed part,
// the ground runs across the road on the roof, and the face between the ground and the roof's underside must be
// closed by the mesh's headwall (mesh/structures.ts). Found from the road faces themselves, not from the headwall
// list, so a mouth the mesh gave no headwall counts as open. Pure.
import { edgeKey } from '../mesh/conform.ts';
import { K_CUT, K_TUNNEL } from '../mesh/stripfaces.ts';
import type { Ground } from './build.ts';
import { MEET_NONE, MEET_WALL } from './collect.ts';
import { toUnits } from './predicates.ts';
import { headwallAt } from './surface.ts';

export interface PortalChecks {
  /** Road face edges across a tunnel mouth (an open tunnel face beside a roofed one), their length (m). */
  edges: number;
  lengthM: number;
  /** Headwalls the mesh built. */
  headwalls: number;
  /** Mouth edges with no headwall along them. */
  missing: number;
  /** Mouth edge ends where the ground is under the slab over the roof or over the headwall top. */
  groundOff: number;
  /** Open faces: missing plus groundOff (the gate, 0). */
  open: number;
  /** The first 20 findings (world metres). */
  list: { x: number; z: number; what: string }[];
}

/** The ground across a mouth may be this far past its limits (m). */
const SLACK_M = 0.01;

export function checkPortals(g: Ground): PortalChecks {
  const { input, tg, surface: s, collected } = g;
  const { fs, edges } = input;
  const meet = collected.meet;
  const out: PortalChecks = { edges: 0, lengthM: 0, headwalls: input.portals?.length ?? 0, missing: 0, groundOff: 0, open: 0, list: [] };
  const find = (x: number, z: number, what: string): void => {
    if (out.list.length < 20) out.list.push({ x: Math.round((x + input.offset.x) * 10) / 10, z: Math.round((z + input.offset.z) * 10) / 10, what });
  };
  const pk = (x: number, z: number): number => (x + 33554432) * 67108864 + (z + 33554432);
  // triangulation vertices on road edges by position (the road mesh's vertices are points of the triangulation)
  const vertexAt = new Map<number, number>();
  const road = tg.road;
  for (let k = 0; k < road.a.length; k++) {
    if (!road.alive[k]) continue;
    for (const v of [road.a[k] as number, road.b[k] as number]) vertexAt.set(pk(tg.cdt.x[v] as number, tg.cdt.z[v] as number), v);
  }
  const tunnelFace = (f: number, roofedSide: boolean): boolean => {
    const piece = fs.piece[f] as number;
    const i = fs.station[f] as number;
    if (piece >= input.strips.length || i < 0) return false;
    const kind = input.kinds[piece] as ArrayLike<number>;
    const k = [kind[i] as number, kind[i + 1] as number];
    return roofedSide ? k.every((x) => x === K_TUNNEL) : k.some((x) => x === K_TUNNEL || x === K_CUT);
  };
  let len = 0;
  for (const [key, c] of edges.at) {
    const f = edges.owner[c] as number;
    if (meet[f] !== MEET_WALL || !tunnelFace(f, false)) continue;
    const a = Math.floor(key / 4194304);
    const b = key % 4194304;
    const twin = edges.at.get(edgeKey(b, a));
    if (twin === undefined) continue;
    const o = edges.owner[twin] as number;
    if (meet[o] !== MEET_NONE || !tunnelFace(o, true)) continue;
    const ax = fs.vx[a] as number;
    const az = fs.vz[a] as number;
    const bx = fs.vx[b] as number;
    const bz = fs.vz[b] as number;
    out.edges++;
    len += Math.hypot(bx - ax, bz - az);
    const ha = headwallAt(input.portals, ax, az);
    const hb = headwallAt(input.portals, bx, bz);
    if (!ha || !hb) {
      out.missing++;
      find((ax + bx) / 2, (az + bz) / 2, `tunnel mouth edge with no headwall (face ${f})`);
      continue;
    }
    for (const [x, z, h] of [[ax, az, ha], [bx, bz, hb]] as const) {
      const v = vertexAt.get(pk(toUnits(x), toUnits(z)));
      const y = v === undefined ? NaN : (s.vy[v] as number);
      // no ground there: a road at grade over the roof closes the mouth's top (the headwall reaches under it)
      if (Number.isNaN(y) && h.underRoad) continue;
      if (Number.isNaN(y) || y < Math.min(h.bottom + 0.5, h.top) - SLACK_M || y > h.top + SLACK_M) {
        out.groundOff++;
        find(x, z, Number.isNaN(y) ? `no ground vertex at a tunnel mouth (face ${f})` : `ground ${Math.round((y - h.top) * 1000) / 1000} m off the headwall top at a tunnel mouth (face ${f})`);
      }
    }
  }
  out.lengthM = Math.round(len * 10) / 10;
  out.open = out.missing + out.groundOff;
  return out;
}
