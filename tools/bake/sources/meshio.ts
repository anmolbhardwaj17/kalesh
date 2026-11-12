// Files of the mesh step (P1-014): the stand-in tiles of the road bench scene, cut from the production road mesh
// (game/bench/roads/gen/<site>.ktl with its camera poses in <site>.json; the folder is not imported by Godot).
// The mesh itself is pure (tools/bake/mesh/).
import fs from 'node:fs';
import path from 'node:path';
import type { SiteTile } from '../mesh/meshout.ts';
import { encodeT1 } from '../tile.ts';

/** Writes one site's tile and poses and returns their repo-relative (or absolute, outside root) paths. */
export function writeSiteTile(root: string, dir: string, site: SiteTile): { tile: string; poses: string; bytes: number } {
  const out = path.isAbsolute(dir) ? dir : path.join(root, dir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '.gdignore'), '');
  const bytes = encodeT1(site.tile);
  const tile = path.join(out, `${site.meta.site}.ktl`);
  fs.writeFileSync(tile, bytes);
  const poses = path.join(out, `${site.meta.site}.json`);
  fs.writeFileSync(poses, JSON.stringify(site.meta, null, 2) + '\n');
  const rel = (f: string): string => (f.startsWith(root) ? path.relative(root, f) : f);
  return { tile: rel(tile), poses: rel(poses), bytes: bytes.length };
}
