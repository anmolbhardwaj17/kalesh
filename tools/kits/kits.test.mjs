// Area kits data (P2-010): every kit's facade colours are palette words of the area data, every building type of the
// bake has a kit, every kit names a names file and a sheet that exist, and the generated sign boards carry only
// names copied from the kit's names file (respect rule: invented names only, DELHI_WORLD.md section 3).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILDING_TYPES } from '../bake/areas/schema.ts';
import { BRICK_WORDS } from './sample_walls.mjs';

const hsv = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d > 0) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((hh * 60) + 360) % 360, mx > 0 ? d / mx : 0, mx];
};

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
  it('takes every kit wall colour from its area board photos (decisions.md 2026-11-14)', () => {
    const SAMPLES = read('tools/kits/wall_samples.json');
    for (const [id, k] of Object.entries(KITS.kits)) {
      const w = k.walls;
      expect(w, id).toBeTruthy();
      expect(fs.existsSync(path.join(ROOT, w.board)), w.board).toBe(true);
      expect(w.board, id).toContain(SAMPLES.kits[id].board);
      expect(w.colours.length, id).toBeGreaterThanOrEqual(6);
      for (const s of w.samples) {
        expect(s.photo, id).toBeGreaterThan(0);
        expect(s.hex, id).toMatch(/^#[0-9a-f]{6}$/);
      }
      for (const c of w.colours) {
        const [h, s, v] = hsv(c);
        expect(v, `${id} ${c} under the cap`).toBeLessThanOrEqual((SAMPLES.kits[id].cap ?? SAMPLES.cap) / 255 + 0.005);
        expect(v >= w.range.v[0] - 0.005 && v <= w.range.v[1] + 0.005 && s <= w.range.s[1] + 0.005, `${id} ${c} in range`).toBe(true);
        expect(h >= 0, id).toBe(true);
      }
      // every palette word the bake paints walls with has kit colours; a painted word maps only to sampled colours
      for (const word of Object.keys(KITS.palette)) {
        expect(w.map[word]?.length, `${id} ${word}`).toBeGreaterThan(0);
        if (!BRICK_WORDS.includes(word)) for (const c of w.map[word]) expect(w.colours, `${id} ${word}`).toContain(c);
      }
    }
  });
  it('keeps old city walls dusty: no bazaar or gali wall colour above 0.3 saturation', () => {
    for (const id of ['bazaar', 'gali']) for (const c of KITS.kits[id].walls.colours) expect(hsv(c)[1], `${id} ${c}`).toBeLessThanOrEqual(0.3);
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
