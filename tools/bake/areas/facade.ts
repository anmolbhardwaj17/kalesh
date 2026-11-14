// Facade module placements of one building (P2-009, DELHI_WORLD.md "The generator": "facade modules from the area
// kit", TECH.md "Rendering of the city": repeated modules are MultiMesh instances). Each bay of each floor of a wall
// that can be seen is one instance of a module named "<building type>.<part>" (plan.ts TYPES lists the parts); the kit
// of P2-010 gives every id its mesh, and the ids never change, so baked placements stay good when a mesh is replaced.
//
// The module frame: x along the wall (to the right seen from outside), y up, z out of the wall; the origin is the
// bottom middle of the bay on the wall plane. A module is authored MODULE_W wide and MODULE_H high and the instance
// scales it to the bay (x) and the floor (y); a roof parapet module is MODULE_W wide and PARAPET_H high.
// Custom data per instance: the building's wall colour and its wear (grime), packed as 0xRRGGBBWW.
// Which walls: a wall that looks on a road gets every floor; a wall that looks on open ground or a yard gets its upper
// floors only (the first to go when a tile is over its placement budget); a party wall gets nothing. Pure.
import { rngFor } from '../rand.ts';
import type { Rand } from '../rand.ts';
import type { BuildingPlan, TypeSpec } from './plan.ts';
import type { GenShell, Wall } from './shellgen.ts';
import type { ProfileView } from './views.ts';

export const MODULE_W = 3.0;
export const MODULE_H = 3.2;
export const PARAPET_H = 1.0;
/** A bay narrower than this carries no module (m). */
export const MIN_BAY_W = 1.3;

export type Exposure = 'street' | 'open' | 'hidden';

export interface FacadeInstance {
  module: string;
  /** Twelve numbers in MultiMesh buffer order (basis rows, each followed by the origin's part), block metres. */
  xform: number[];
  /** 0xRRGGBBWW. */
  data: number;
  /** 0 street ground floor, 1 street upper floors and parapets, 2 upper floors on open ground. */
  cls: 0 | 1 | 2;
}

/** Every part name the generator places. */
export const PARTS = ['gf_shop', 'gf_door', 'gf_plain', 'gf_colonnade', 'gf_arcade', 'gf_gate', 'up_window', 'up_balcony', 'up_jharokha', 'up_blank', 'up_strip', 'up_glass', 'roof_parapet'] as const;

function pick(r: Rand, list: readonly (readonly [string, number])[]): string {
  let total = 0;
  for (const [, w] of list) total += w;
  let u = r.next() * total;
  for (const [v, w] of list) {
    u -= w;
    if (u < 0) return v;
  }
  return (list[list.length - 1] as readonly [string, number])[0];
}

export const packData = (tint: number, wear: number): number => (((tint & 0xffffff) << 8) | Math.max(0, Math.min(255, Math.round(wear * 255)))) >>> 0;

export function facadeOf(shell: GenShell, plan: BuildingPlan, view: ProfileView | undefined, spec: TypeSpec, exposure: (w: Wall) => Exposure, tile: { tx: number; tz: number }): FacadeInstance[] {
  if (plan.worship) return [];
  const out: FacadeInstance[] = [];
  const r = rngFor(tile.tx, tile.tz, plan.id, 'facade');
  const data = packData(plan.tint, plan.wear);
  const shops = view ? view.shops : true;
  const balcony = view ? view.balcony / 0.5 : 1;
  const gf = spec.gf.map(([p, w]) => [shops || p !== 'gf_shop' ? p : 'gf_plain', w] as const);
  const up = spec.up.map(([p, w]) => [p, p === 'up_balcony' || p === 'up_jharokha' ? w * balcony : w] as const);
  const parapetShare = view ? Math.min(1, view.parapet + 0.3) : 0.8;
  let door = false;
  for (const w of shell.walls) {
    // the draws of a wall are made whatever it shows, so a neighbour that hides it does not shift the rest
    const cols: { gf: string; up: string; rail: boolean }[] = [];
    for (let c = 0; c < w.bays; c++) cols.push({ gf: pick(r, gf), up: pick(r, up), rail: r.next() < parapetShare });
    if (!w.bays || w.len / w.bays < MIN_BAY_W) continue;
    const ex = exposure(w);
    if (ex === 'hidden') continue;
    const bw = w.len / w.bays;
    const tx = (w.bx - w.ax) / w.len;
    const tz = (w.bz - w.az) / w.len;
    // x of the module frame: up cross out
    const xx = w.nz;
    const xz = -w.nx;
    const put = (module: string, c: number, y: number, sy: number, cls: 0 | 1 | 2): void => {
      const ox = w.ax + tx * (c + 0.5) * bw;
      const oz = w.az + tz * (c + 0.5) * bw;
      const sx = bw / MODULE_W;
      out.push({ module: `${plan.type}.${module}`, xform: [xx * sx, 0, w.nx, ox, 0, sy, 0, y, xz * sx, 0, w.nz, oz], data, cls });
    };
    for (let c = 0; c < w.bays; c++) {
      const col = cols[c] as { gf: string; up: string; rail: boolean };
      for (let k = w.floor0; k < w.floor0 + w.floors; k++) {
        if (k === 0) {
          if (ex !== 'street') continue;
          let part = col.gf;
          if (!door && c === Math.floor(w.bays / 2) && part !== 'gf_colonnade' && part !== 'gf_arcade') {
            part = 'gf_door';
            door = true;
          }
          put(part, c, shell.groundY, plan.groundM / MODULE_H, 0);
        } else put(col.up, c, shell.groundY + plan.groundM + (k - 1) * plan.floorM, plan.floorM / MODULE_H, ex === 'street' ? 1 : 2);
      }
      if (ex === 'street' && plan.parapetM > 0 && col.rail && w.floor0 + w.floors >= plan.floors - (plan.roof === 'setback' ? 1 : 0)) {
        // the wall top of this wall: the roof line, or the terrace edge of a setback
        const topY = w.floor0 + w.floors === plan.floors ? shell.roofY - plan.parapetM : shell.groundY + plan.groundM + (w.floor0 + w.floors - 1) * plan.floorM;
        put('roof_parapet', c, topY, plan.parapetM / PARAPET_H, 1);
      }
    }
  }
  return out;
}
