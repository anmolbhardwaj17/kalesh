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
  it('writes sign boards only with names from the kit names file (P2-048: every kind but paper notices)', () => {
    for (const [id, k] of Object.entries(KITS.kits)) {
      const b = BOARDS.kits[id];
      expect(b.area, id).toBe(k.area);
      const total = BOARDS.groups.reduce((a, g) => a + g.count, 0);
      expect(b.cells.length, id).toBe(total);
      const names = read(`game/data/names/${k.area}.json`).names.map((n) => JSON.stringify(n.text));
      for (const c of b.cells) if (c.group !== 'notice') expect(names, `${id} ${c.group} ${c.cell}`).toContain(JSON.stringify(c.text));
    }
  });
  it('shows phone numbers one digit short, so no real line is ever on a board', () => {
    for (const b of Object.values(BOARDS.kits))
      for (const c of b.cells)
        for (const e of c.extra) {
          const m = String(e).match(/^(?:Ph\.|M\.) ([\d ]+)$/);
          if (m) expect(m[1].replace(/ /g, '').length, e).toBeLessThan(e.startsWith('M.') ? 10 : 8);
        }
  });
  it('keeps official names off shop boards: no police, court, municipal, government or thana on any board (P2-048)', () => {
    // its own word list (not the generator's), so a change there cannot quietly let an official name through
    const LATN = ['police', 'thana', 'chowki', 'court', 'municipal', 'government', 'govt', 'ministry', 'secretariat', 'department', 'sarkari', 'nagar nigam', 'parliament', 'tribunal'];
    const OTHER = ['पुलिस', 'थाना', 'चौकी', 'न्यायालय', 'अदालत', 'सरकार', 'नगर निगम', 'मंत्रालय', 'विभाग', 'سرکار', 'پولیس'];
    for (const [id, b] of Object.entries(BOARDS.kits))
      for (const c of b.cells) {
        if (c.group === 'notice') continue;
        const all = [...Object.values(c.text || {}), c.tagline || '', ...c.extra.map(String)].join(' | ');
        const low = all.toLowerCase();
        for (const w of LATN) expect(new RegExp(`(^|[^a-z])${w}($|[^a-z])`).test(low), `${id} ${c.group} ${c.cell}: "${all}" has "${w}"`).toBe(false);
        for (const w of OTHER) expect(all.includes(w), `${id} ${c.group} ${c.cell}: "${all}" has "${w}"`).toBe(false);
      }
  });
  it('lays the sign atlas out without overlaps, inside the atlas', () => {
    const cells = [];
    for (const g of BOARDS.groups)
      for (let i = 0; i < g.count; i++) cells.push([g.x + (i % g.cols) * g.w, g.y + Math.floor(i / g.cols) * g.h, g.w, g.h]);
    for (const [x, y, w, h] of cells) expect(x >= 0 && y >= 0 && x + w <= BOARDS.atlas && y + h <= BOARDS.atlas).toBe(true);
    for (let a = 0; a < cells.length; a++)
      for (let b = a + 1; b < cells.length; b++) {
        const [ax, ay, aw, ah] = cells[a];
        const [bx, by, bw, bh] = cells[b];
        expect(ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah, `${a} ${b}`).toBe(false);
      }
  });
  it('keeps the pieces of one place on a bay at or under a whole share (kit_modules.gd PIECES slots: front, sill, spill)', () => {
    // pieces of a slot take back to back ranges of one bay hash (buildings.gd): past 1 the last pieces never draw
    const src = fs.readFileSync(path.join(ROOT, 'game/world/kits/kit_modules.gd'), 'utf8');
    const slots = {};
    for (const m of src.matchAll(/"(\w+)": \{"from": \[[^\]]*\], "share": "(\w+)", "column": \w+, "slot": "(\w+)"\}/g)) (slots[m[3]] ||= []).push(m[2]);
    expect(Object.keys(slots).sort()).toEqual(['front', 'sill', 'spill']);
    for (const [id, k] of Object.entries(KITS.kits))
      for (const [slot, shares] of Object.entries(slots)) {
        const sum = shares.reduce((a, sh) => a + (k.shares[sh] ?? 0), 0);
        expect(sum, `${id} ${slot}`).toBeLessThanOrEqual(1.0001);
      }
  });
  it('wears the old city boards far more than the Connaught Place ones, and ages each board on its own (P2-048 round 3)', () => {
    expect(BOARDS.kits.gali.wear).toBeGreaterThan(BOARDS.kits.colonnade.wear * 3);
    expect(BOARDS.kits.hardware.wear).toBeGreaterThan(BOARDS.kits.market.wear);
  });
  it('picks the scripts of a board by place (owner rule 2026-11-14): Hindi first in the old city, English first on GB Road, in Paharganj and Connaught Place, Urdu only in the old city', () => {
    const share = (id, modes) => {
      const cells = BOARDS.kits[id].cells.filter((c) => c.scripts);
      return cells.filter((c) => modes.includes(c.scripts)).length / cells.length;
    };
    for (const id of ['bazaar', 'gali']) expect(share(id, ['h', 'he', 'u', 'uh']), id).toBeGreaterThan(0.6);
    for (const id of ['hardware', 'hotel', 'market']) expect(share(id, ['e', 'eh']), id).toBeGreaterThan(0.75);
    expect(share('colonnade', ['e'])).toBeGreaterThan(0.75);
    expect(share('gali', ['u', 'uh'])).toBeGreaterThan(0);
    for (const id of ['hardware', 'hotel', 'market', 'colonnade', 'lutyens', 'office']) expect(share(id, ['u', 'uh']), id).toBe(0);
    // no board carries all three scripts: a mode is at most two
    for (const b of Object.values(BOARDS.kits)) for (const c of b.cells) if (c.scripts) expect(['h', 'he', 'e', 'eh', 'u', 'uh']).toContain(c.scripts);
  });
  it('uses only free fonts, each credited (tools/kits/fonts/CREDITS.md)', () => {
    const credits = fs.readFileSync(path.join(ROOT, 'tools/kits/fonts/CREDITS.md'), 'utf8');
    for (const f of fs.readdirSync(path.join(ROOT, 'tools/kits/fonts')).filter((x) => x.endsWith('.ttf'))) expect(credits, f).toContain(f);
    expect(credits).toMatch(/SIL Open Font License/);
  });
});
