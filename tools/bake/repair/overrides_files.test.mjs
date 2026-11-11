// Override files (P1-011): reading harness/data/overrides/ for the bake, and the sample files of the repo. File access
// is why this is a .mjs test (tools/bake/purity.test.ts keeps the .ts files of the bake free of it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projector } from '../../geo/projection.ts';
import { overrideFile, tileOf } from '../layout/grid.ts';
import { blockFrame } from '../layout/placement.ts';
import { patchProblems } from './overrides.ts';
import { readOverrides } from '../sources/overridesio.ts';

describe('override files', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'overrides-'));
  const good = { id: 'ov_a', issue: 'R-ROAD-01:w1.0', action: 'terminate', target: { ids: ['w1.0'], anchor: { lat: 28.6, lon: 77.2 }, tolerance_m: 15 }, params: {}, why: '', by: 'owner', source: 'inspector', date: '2026-11-12' };

  it('reads every file in name order and keeps the patches in file order', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '2_1.json'), JSON.stringify([{ ...good, id: 'ov_b' }, { ...good, id: 'ov_c' }]));
    fs.writeFileSync(path.join(dir, '-1_3.json'), JSON.stringify([good]));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not an override');
    expect(readOverrides('/', dir).map((e) => `${e.file}:${e.patch.id}`)).toEqual(['-1_3.json:ov_a', '2_1.json:ov_b', '2_1.json:ov_c']);
    expect(readOverrides('/', path.join(dir, 'missing'))).toEqual([]);
  });

  it('names the file and the patch when something is wrong, and a district folder is refused', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '0_0.json'), '[{');
    expect(() => readOverrides('/', dir)).toThrow(/0_0\.json is not valid JSON/);
    fs.writeFileSync(path.join(dir, '0_0.json'), JSON.stringify([{ ...good, action: 'delete' }]));
    expect(() => readOverrides('/', dir)).toThrow(/0_0\.json, patch 1 \(ov_a\): action "delete" is not one of/);
    fs.writeFileSync(path.join(dir, '0_0.json'), JSON.stringify([good, good]));
    expect(() => readOverrides('/', dir)).toThrow(/patch id ov_a is already used in 0_0\.json/);
    fs.writeFileSync(path.join(dir, '0_0.json'), JSON.stringify([good]));
    fs.writeFileSync(path.join(dir, 'cp.json'), '[]');
    expect(() => readOverrides('/', dir)).toThrow(/cp\.json: the name must be <tileX>_<tileZ>\.json/);
    fs.rmSync(path.join(dir, 'cp.json'));
    fs.mkdirSync(path.join(dir, 'cp'));
    expect(() => readOverrides('/', dir)).toThrow(/is a folder/);
  });

  it('patchProblems lists every missing field', () => {
    expect(patchProblems(good)).toEqual([]);
    expect(patchProblems({})).toEqual(expect.arrayContaining(['no id', 'no issue', 'no params']));
    expect(patchProblems({ ...good, target: { ids: [1], anchor: {}, tolerance_m: -1 } })).toHaveLength(3);
  });
});

describe('the sample override files of the repo', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', '..');
  const dir = path.join(root, 'harness', 'data', 'overrides');
  const districts = JSON.parse(fs.readFileSync(path.join(root, 'harness/data/districts.json'), 'utf8')) ;
  const frame = blockFrame(districts, 'centre');

  it('sit straight in the folder, each named by the world tile of its anchor, and no district folder remains', () => {
    const entries = readOverrides(root);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory())).toEqual([]);
    const proj = projector(frame.origin);
    for (const e of entries) {
      const b = proj.toWorld(e.patch.target.anchor.lat, e.patch.target.anchor.lon);
      const t = tileOf(b.x + frame.offset.x, b.z + frame.offset.z);
      expect(e.file, e.patch.id).toBe(overrideFile(t.tx, t.tz));
    }
  });
});
