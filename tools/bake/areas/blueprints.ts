// Area blueprints (P2-009, DELHI_WORLD.md "OSM is reference, not the final word"): for the places we know, an authored
// file harness/data/blueprints/<area>.json sets the blocks (outline, type, floors, roof, colour, ground floor) from
// photos and satellite, whatever OSM draws there. Precedence on any square metre: road, then landmark zone, then
// blueprint, then the generator on the repaired footprints. So a block is cut back to the road edge like any footprint,
// a block inside a landmark zone is left out (the landmark builds that ground), and every map footprint a block
// covers, or that lies inside a `clear` ring, leaves with a log line. Pure: the files are read by
// tools/bake/sources/areastage.ts.
//
// File (rings are [lon, lat] lists, like areas.geojson):
//   { "area": "<area id>", "evidence": "<sheet section, photo set>",
//     "clear": [ ring, ... ],                       optional: map footprints with their centre inside leave
//     "blocks": [ { "id": "A1", "ring": ring, "type": "<building type>", "floors": 2, "height_m": 12,
//                   "roof": "flat", "tint": "<palette word>", "ground_floor": "colonnade", "evidence": "..." } ] }
import type { P2 } from '../geom.ts';
import { pointInRing, ringArea } from '../geom.ts';
import { BUILDING_TYPES } from './schema.ts';

export interface BlueprintBlock {
  id: string;
  ring: [number, number][];
  type: string;
  floors: number;
  height_m?: number;
  roof?: string;
  tint?: string;
  ground_floor?: string;
  evidence: string;
}

export interface Blueprint {
  area: string;
  evidence: string;
  clear?: [number, number][][];
  blocks: BlueprintBlock[];
}

export interface BlueprintFootprint {
  id: string;
  source: string;
  ring: P2[];
  area: number;
  height: number | null;
  levels: number | null;
  tags: Record<string, string>;
}

export interface BlueprintLine {
  /** The block ("bp/<area>/<id>") or the map footprint the line is about. */
  id: string;
  blueprint: string;
  action: 'placed' | 'in_landmark_zone' | 'on_road' | 'replaced_footprint';
  detail: string;
  x: number;
  z: number;
}

const ROOFS = ['flat', 'mumty', 'setback', 'crown', 'gable'];
const ringOk = (r: unknown): r is [number, number][] => Array.isArray(r) && r.length >= 3 && r.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number');

/** Problems of one blueprint file; empty when it can be used. */
export function checkBlueprint(bp: Blueprint, file: string, areaIds: ReadonlySet<string>, palette: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  if (typeof bp.area !== 'string' || !areaIds.has(bp.area)) out.push(`${file}: area "${String(bp.area)}" is not a drawn area`);
  if (typeof bp.evidence !== 'string' || bp.evidence.length < 25) out.push(`${file}: needs an evidence line (sheet section, photo set)`);
  for (const r of bp.clear ?? []) if (!ringOk(r)) out.push(`${file}: a clear ring is not a list of [lon, lat]`);
  if (!Array.isArray(bp.blocks)) return [...out, `${file}: blocks must be a list`];
  const seen = new Set<string>();
  for (const b of bp.blocks) {
    const at = `${file} block ${String(b.id)}`;
    if (typeof b.id !== 'string' || !/^[A-Za-z0-9_]+$/.test(b.id)) out.push(`${at}: id must be letters, digits and _`);
    else if (seen.has(b.id)) out.push(`${at}: id used twice`);
    seen.add(b.id);
    if (!ringOk(b.ring)) out.push(`${at}: ring is not a list of [lon, lat]`);
    if (!(BUILDING_TYPES as readonly string[]).includes(b.type)) out.push(`${at}: unknown building type "${b.type}"`);
    if (!Number.isInteger(b.floors) || b.floors < 1 || b.floors > 60) out.push(`${at}: floors must be a whole number from 1 to 60`);
    if (b.height_m !== undefined && !(b.height_m >= 2.2 && b.height_m <= 250)) out.push(`${at}: height_m must be 2.2 to 250`);
    if (b.roof !== undefined && !ROOFS.includes(b.roof)) out.push(`${at}: roof must be one of ${ROOFS.join(', ')}`);
    if (b.tint !== undefined && !(b.tint in palette)) out.push(`${at}: tint "${b.tint}" is not in palette.json`);
    if (typeof b.evidence !== 'string' || b.evidence.length < 25) out.push(`${at}: needs an evidence line`);
  }
  return out;
}

export interface BlueprintInput<F extends BlueprintFootprint> {
  footprints: readonly F[];
  blueprints: readonly Blueprint[];
  /** [lon, lat] to block metres. */
  project: (lon: number, lat: number) => P2;
  /** Is the point inside a landmark zone. */
  inZone: (x: number, z: number) => boolean;
  /** A block off the road faces: its parts (empty when nothing is left), as repair/clear.ts cuts a footprint. */
  offRoad: (f: BlueprintFootprint) => BlueprintFootprint[];
}

const centreOf = (ring: readonly P2[]): P2 => {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p.x;
    z += p.z;
  }
  return { x: x / ring.length, z: z / ring.length };
};
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

/** The footprints with the blueprint blocks in place of what they cover. */
export function applyBlueprints<F extends BlueprintFootprint>(input: BlueprintInput<F>): { footprints: (F | BlueprintFootprint)[]; lines: BlueprintLine[]; blocks: number; replaced: number } {
  const lines: BlueprintLine[] = [];
  const blocks: BlueprintFootprint[] = [];
  const clears: { area: string; ring: P2[] }[] = [];
  for (const bp of input.blueprints) {
    for (const r of bp.clear ?? []) clears.push({ area: bp.area, ring: r.map(([lon, lat]) => input.project(lon, lat)) });
    for (const b of bp.blocks) {
      const id = `bp/${bp.area}/${b.id}`;
      const ring = b.ring.map(([lon, lat]) => input.project(lon, lat)).map((p) => ({ x: r2(p.x), z: r2(p.z) }));
      if (ring.length > 1 && ring[0]!.x === ring[ring.length - 1]!.x && ring[0]!.z === ring[ring.length - 1]!.z) ring.pop();
      const c = centreOf(ring);
      if (input.inZone(c.x, c.z)) {
        lines.push({ id, blueprint: bp.area, action: 'in_landmark_zone', detail: 'inside a landmark zone: the landmark builds this ground, the block is left out', x: r2(c.x), z: r2(c.z) });
        continue;
      }
      const tags: Record<string, string> = { building: 'yes', 'gen:type': b.type, 'gen:floors': String(b.floors), 'gen:blueprint': bp.area };
      if (b.roof) tags['gen:roof'] = b.roof;
      if (b.tint) tags['gen:tint'] = b.tint;
      if (b.ground_floor) tags['gen:ground_floor'] = b.ground_floor;
      const whole: BlueprintFootprint = { id, source: 'blueprint', ring, area: r2(Math.abs(ringArea(ring))), height: b.height_m ?? null, levels: b.floors, tags };
      const parts = input.offRoad(whole);
      if (!parts.length) {
        lines.push({ id, blueprint: bp.area, action: 'on_road', detail: 'the whole block stands on a road: the road wins, nothing is placed', x: r2(c.x), z: r2(c.z) });
        continue;
      }
      for (const p of parts) {
        blocks.push({ ...p, source: 'blueprint', tags });
        const pc = centreOf(p.ring);
        lines.push({ id: p.id, blueprint: bp.area, action: 'placed', detail: parts.length > 1 || Math.abs(p.area - whole.area) > 0.5 ? `cut back to the road edge (${whole.area} m2 drawn, ${p.area} m2 placed)` : `${b.type}, ${b.floors} floors`, x: r2(pc.x), z: r2(pc.z) });
      }
    }
  }
  if (!blocks.length && !clears.length) return { footprints: input.footprints.slice(), lines, blocks: 0, replaced: 0 };
  // map footprints under a block or inside a clear ring leave
  const out: (F | BlueprintFootprint)[] = [];
  let replaced = 0;
  const boxes = blocks.map((b) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of b.ring) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    return { b, x0, x1, z0, z1 };
  });
  for (const f of input.footprints) {
    const c = centreOf(f.ring);
    let why = '';
    for (const cl of clears) if (pointInRing(c, cl.ring)) why = `inside the cleared ground of blueprint ${cl.area}`;
    if (!why) {
      for (const { b, x0, x1, z0, z1 } of boxes) {
        // its centre under the block, or a third of its corners and edge middles
        let inside = 0;
        let total = 0;
        const test = (p: P2): void => {
          total++;
          if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && pointInRing(p, b.ring)) inside++;
        };
        for (let k = 0; k < f.ring.length; k++) {
          const p = f.ring[k] as P2;
          const q = f.ring[(k + 1) % f.ring.length] as P2;
          test(p);
          test({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
        }
        if ((c.x >= x0 && c.x <= x1 && c.z >= z0 && c.z <= z1 && pointInRing(c, b.ring)) || inside * 3 >= total) {
          why = `under blueprint block ${b.id}`;
          break;
        }
      }
    }
    if (why) {
      replaced++;
      lines.push({ id: f.id, blueprint: why.replace(/^.* /, ''), action: 'replaced_footprint', detail: `${why}: the blueprint is the decision, the map footprint leaves`, x: r2(c.x), z: r2(c.z) });
    } else out.push(f);
  }
  out.push(...blocks);
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { footprints: out, lines, blocks: blocks.length, replaced };
}
