// Reads the override files (harness/data/overrides/<tileX>_<tileZ>.json, MAP_REPAIR.md "Overrides format") for the
// bake. The bake only reads them: a stale patch stays in its file. A file that is not valid JSON, or a patch that is
// missing a field, stops the bake with the file and the patch named, so a typo is never ignored.
import fs from 'node:fs';
import path from 'node:path';
import { parseTileId } from '../layout/grid.ts';
import { patchProblems } from '../repair/overrides.ts';
import type { OverrideEntry } from '../repair/overrides.ts';
import type { Patch } from '../rules/types.ts';

export const OVERRIDES_DIR = path.join('harness', 'data', 'overrides');

/** Every patch of every tile file, files in name order, patches in file order. `dir` defaults to the repo's folder. */
export function readOverrides(root: string, dir: string = path.join(root, OVERRIDES_DIR)): OverrideEntry[] {
  if (!fs.existsSync(dir)) return [];
  const out: OverrideEntry[] = [];
  const seen = new Map<string, string>();
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) throw new Error(`${path.relative(root, full)} is a folder: override files are <tileX>_<tileZ>.json straight in ${OVERRIDES_DIR}`);
    if (!name.endsWith('.json')) continue;
    try {
      parseTileId(name.slice(0, -'.json'.length));
    } catch {
      throw new Error(`${path.relative(root, full)}: the name must be <tileX>_<tileZ>.json (whole numbers of the 250 m world grid)`);
    }
    let list: unknown;
    try {
      list = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      throw new Error(`${path.relative(root, full)} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!Array.isArray(list)) throw new Error(`${path.relative(root, full)} must hold one array of patches`);
    list.forEach((p, k) => {
      const bad = patchProblems(p);
      if (bad.length) throw new Error(`${path.relative(root, full)}, patch ${k + 1}${(p as Patch)?.id ? ` (${(p as Patch).id})` : ''}: ${bad.join('; ')}`);
      const patch = p as Patch;
      const twin = seen.get(patch.id);
      if (twin) throw new Error(`${path.relative(root, full)}: patch id ${patch.id} is already used in ${twin}`);
      seen.set(patch.id, name);
      out.push({ file: name, patch });
    });
  }
  return out;
}
