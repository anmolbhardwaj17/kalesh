// P2-007: the hero model rule of the ingest (glbcheck.mjs) and the ingest itself on a scratch copy (HARNESS_ROOT):
// a model over any hero limit is rejected with the reason, one inside lands in the manifest under its id, which is
// how the game replaces the parts kit stand-in (game/world/landmarks/landmark_model.gd).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { heroRule, levelOfName, makeGlb, parseGlb } from './glbcheck.mjs';

const LIMITS = { heroPartsMax: 8, heroTrianglesPerPart: 25000, heroMaterialsMax: 6, heroLods: 3, farSilhouetteTriangles: 2000 };
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A glTF JSON with mesh nodes {name: [triangles, material]} (accessor counts only: the rule reads counts). */
function model(nodes) {
  const json = { asset: { version: '2.0' }, nodes: [], meshes: [], accessors: [], materials: [] };
  for (const [name, [tris, mat]] of Object.entries(nodes)) {
    json.accessors.push({ componentType: 5125, count: tris * 3, type: 'SCALAR' });
    json.meshes.push({ primitives: [{ attributes: { POSITION: json.accessors.length - 1 }, indices: json.accessors.length - 1, material: mat ?? 0 }] });
    json.nodes.push({ name, mesh: json.meshes.length - 1 });
    while (json.materials.length <= (mat ?? 0)) json.materials.push({ name: `m${json.materials.length}` });
  }
  return json;
}

const good = () => model({ arch_LOD0: [24000, 0], arch_LOD1: [6000, 0], arch_LOD2: [1500, 1], attic_LOD0: [8000, 2], attic_LOD1: [2000, 2], attic_LOD2: [500, 2], far: [1200, 0] });

describe('hero model rule (P2-007)', () => {
  it('names map to levels', () => {
    expect(levelOfName('arch_LOD0')).toBe(0);
    expect(levelOfName('Attic_lod2')).toBe(2);
    expect(levelOfName('far')).toBe('far');
    expect(levelOfName('Camera')).toBeNull();
  });

  it('a model inside every limit passes; the .glb round trips', () => {
    const r = heroRule(parseGlb(makeGlb(good())).json, LIMITS);
    expect(r.reasons).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.parts.arch).toEqual([24000, 6000, 1500]);
    expect(r.far).toBe(1200);
  });

  it('every limit has its reason', () => {
    const heavy = good();
    heavy.accessors[0].count = 30000 * 3;
    expect(heroRule(heavy, LIMITS).reasons.join()).toMatch(/part arch has 30000 triangles at level 0, the limit is 25000/);
    const nine = model(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [[`p${i}_LOD0`, [10, 0]], [`p${i}_LOD1`, [5, 0]], [`p${i}_LOD2`, [2, 0]]]).flat().concat([['far', [10, 0]]])));
    expect(heroRule(nine, LIMITS).reasons.join()).toMatch(/9 parts, a hero has at most 8/);
    const mats = model({ a_LOD0: [10, 0], a_LOD1: [5, 1], a_LOD2: [2, 2], b_LOD0: [10, 3], b_LOD1: [5, 4], b_LOD2: [2, 5], c_LOD0: [10, 6], c_LOD1: [5, 6], c_LOD2: [2, 6], far: [10, 0] });
    expect(heroRule(mats, LIMITS).reasons.join()).toMatch(/7 materials, a hero has at most 6/);
    const noLod = model({ a_LOD0: [10, 0], a_LOD2: [2, 0], far: [10, 0] });
    expect(heroRule(noLod, LIMITS).reasons.join()).toMatch(/part a has no level 1/);
    const farHeavy = model({ a_LOD0: [10, 0], a_LOD1: [5, 0], a_LOD2: [2, 0], far: [2500, 0] });
    expect(heroRule(farHeavy, LIMITS).reasons.join()).toMatch(/far silhouette has 2500 triangles, it must stay under 2000/);
    const noFar = model({ a_LOD0: [10, 0], a_LOD1: [5, 0], a_LOD2: [2, 0] });
    expect(heroRule(noFar, LIMITS).reasons.join()).toMatch(/no far silhouette/);
    const stray = model({ a_LOD0: [10, 0], a_LOD1: [5, 0], a_LOD2: [2, 0], far: [10, 0], Cube: [12, 0] });
    expect(heroRule(stray, LIMITS).reasons.join()).toMatch(/"Cube" is not named/);
  });

  it('the ingest rejects a hero model over a limit with the reason and puts one inside in the manifest by its id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalesh-ingest-'));
    try {
      fs.mkdirSync(path.join(root, 'harness', 'requests'), { recursive: true });
      fs.mkdirSync(path.join(root, 'harness', 'verify'), { recursive: true });
      fs.mkdirSync(path.join(root, 'harness', 'reports'), { recursive: true });
      fs.mkdirSync(path.join(root, 'assets_inbox'), { recursive: true });
      fs.copyFileSync(path.join(HERE, '..', 'verify', 'perf_budgets.json'), path.join(root, 'harness', 'verify', 'perf_budgets.json'));
      const req = (id) => ({ id, kind: 'model', intent: 'hero landmark model', target: {} });
      fs.writeFileSync(path.join(root, 'harness', 'requests', 'assets.json'), JSON.stringify({ requests: [req('model_lm_india_gate'), req('model_lm_red_fort')] }));
      const heavy = good();
      heavy.accessors[0].count = 30000 * 3;
      fs.writeFileSync(path.join(root, 'assets_inbox', 'model_lm_red_fort.glb'), makeGlb(heavy));
      fs.writeFileSync(path.join(root, 'assets_inbox', 'model_lm_india_gate.glb'), makeGlb(good()));
      execFileSync(process.execPath, [path.join(HERE, 'ingest.mjs')], { env: { ...process.env, HARNESS_ROOT: root }, stdio: 'pipe' });
      const man = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'manifest.json'), 'utf8'));
      expect(man.models.model_lm_india_gate.path).toBe('assets/models/model_lm_india_gate.glb');
      expect(fs.existsSync(path.join(root, 'public', 'assets', 'models', 'model_lm_india_gate.glb'))).toBe(true);
      expect(man.models.model_lm_red_fort).toBeUndefined();
      expect(fs.existsSync(path.join(root, 'assets_inbox', '_rejected', 'model_lm_red_fort.glb'))).toBe(true);
      const log = fs.readFileSync(path.join(root, 'harness', 'reports', 'ingest.log'), 'utf8');
      expect(log).toMatch(/model_lm_red_fort\.glb: REJECTED: the hero rule: part arch has 30000 triangles at level 0, the limit is 25000/);
      expect(log).toMatch(/model_lm_india_gate\.glb: ingested .*hero rule ok: 2 parts, far 1200 triangles/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
