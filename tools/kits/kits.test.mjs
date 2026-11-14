// Area kits data (P2-010): every kit's facade colours are palette words of the area data, every building type of the
// bake has a kit, every kit names a names file and a sheet that exist, and the generated sign boards carry only
// names copied from the kit's names file (respect rule: invented names only, DELHI_WORLD.md section 3).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILDING_TYPES } from '../bake/areas/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const KITS = read('game/world/kits/kits.json');
const PALETTE = read('harness/data/areas/palette.json');
const BOARDS = read('game/world/kits/textures/boards.json');

describe('area kits', () => {
  it('maps every generated building type to a kit', () => {
    for (const t of BUILDING_TYPES) expect(KITS.kits[KITS.types[t]], t).toBeTruthy();
  });
  it('has at least six facade colours per kit, all palette words', () => {
    for (const [id, k] of Object.entries(KITS.kits)) {
      expect(new Set(k.facade).size, id).toBeGreaterThanOrEqual(6);
      for (const w of k.facade) expect(PALETTE[w], `${id} ${w}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(k.accent.length, id).toBeGreaterThanOrEqual(6);
      expect(fs.existsSync(path.join(ROOT, k.sheet)), k.sheet).toBe(true);
      expect(fs.existsSync(path.join(ROOT, 'game/data/names', `${k.area}.json`)), k.area).toBe(true);
    }
  });
  it('writes sign boards only with names from the kit names file', () => {
    for (const [id, k] of Object.entries(KITS.kits)) {
      const b = BOARDS.kits[id];
      expect(b.area, id).toBe(k.area);
      expect(b.cells.length, id).toBe(32);
      const names = read(`game/data/names/${k.area}.json`).names.map((n) => JSON.stringify(n.text));
      for (const c of b.cells) expect(names, `${id} cell ${c.cell}`).toContain(JSON.stringify(c.text));
    }
  });
});
