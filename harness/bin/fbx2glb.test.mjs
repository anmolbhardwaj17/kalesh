// P2-062: the model card accepts the Mixamo .fbx. fixtures/models/rigged_box.fbx (24 KB, made in Blender: three
// "mixamorig:" bones, a skinned box, one material) is converted to .glb by the pinned Godot engine (headless) and the
// skeleton, the skin weights and the material must survive; the ingest does the same on a scratch copy and keeps the
// original FBX in _processed/. Needs the engine (godot.mjs); the first test is skipped when it is not found.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findGodot } from './godot.mjs';
import { convertFbxToGlb } from './fbx2glb.mjs';
import { modelStats, parseGlb } from './glbcheck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', 'fixtures', 'models', 'rigged_box.fbx');
const haveGodot = !!findGodot().path;

describe('modelStats', () => {
  it('counts triangles, materials, joints and skin weights', () => {
    const json = {
      nodes: [{ mesh: 0 }], accessors: [{ count: 36 }, { count: 24 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 1, JOINTS_0: 1, WEIGHTS_0: 1 }, indices: 0, material: 0 }] }],
      skins: [{ joints: [1, 2, 3] }], images: [{}],
    };
    expect(modelStats(json)).toEqual({ triangles: 12, materials: 1, textures: 1, skins: 1, joints: 3, weighted: true });
  });
});

describe.skipIf(!haveGodot)('FBX to GLB (needs the Godot engine)', () => {
  it('keeps the skeleton, the skin weights and the material', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalesh-fbx-'));
    try {
      const out = path.join(dir, 'out.glb');
      const r = await convertFbxToGlb(FIXTURE, out);
      expect(r.bones).toBe(3);
      const { json } = parseGlb(fs.readFileSync(out));
      const st = modelStats(json);
      expect(st.skins).toBeGreaterThanOrEqual(1);
      expect(st.joints).toBe(3);
      expect(st.weighted).toBe(true);
      expect(st.materials).toBeGreaterThanOrEqual(1);
      expect(st.triangles).toBeGreaterThan(20);
      const names = (json.nodes || []).map((n) => n.name);
      expect(names.some((n) => /Hips/.test(n))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120000);

  it('a bad FBX is reported in plain words', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalesh-fbx-'));
    try {
      const bad = path.join(dir, 'bad.fbx');
      fs.writeFileSync(bad, 'this is not an fbx');
      await expect(convertFbxToGlb(bad, path.join(dir, 'bad.glb'))).rejects.toThrow(/could not convert the FBX/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120000);

  it('the ingest converts an uploaded .fbx, lists the stats and keeps the original', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalesh-ingest-'));
    try {
      for (const d of ['harness/requests', 'harness/verify', 'harness/reports', 'assets_inbox']) fs.mkdirSync(path.join(root, d), { recursive: true });
      const req = { id: 'model_lead_bittu', kind: 'model', intent: 'lead', generate: 'rigged .glb, humanoid skeleton', target: { out: 'models/model_lead_bittu.glb', maxTriangles: 25000, maxMaterials: 3 } };
      fs.writeFileSync(path.join(root, 'harness', 'requests', 'assets.json'), JSON.stringify({ requests: [req] }));
      fs.copyFileSync(FIXTURE, path.join(root, 'assets_inbox', 'model_lead_bittu.fbx'));
      execFileSync(process.execPath, [path.join(HERE, 'ingest.mjs')], { env: { ...process.env, HARNESS_ROOT: root }, stdio: 'pipe', timeout: 200000 });
      const man = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'manifest.json'), 'utf8'));
      expect(man.models.model_lead_bittu.path).toBe('assets/models/model_lead_bittu.glb');
      expect(fs.readFileSync(path.join(root, 'public', 'assets', 'models', 'model_lead_bittu.glb')).toString('latin1', 0, 4)).toBe('glTF');
      expect(fs.existsSync(path.join(root, 'assets_inbox', '_processed', 'model_lead_bittu.fbx'))).toBe(true);
      const log = fs.readFileSync(path.join(root, 'harness', 'reports', 'ingest.log'), 'utf8');
      expect(log).toMatch(/model_lead_bittu\.fbx: ingested converted from FBX \(3 bones\).* 3 bones/);
      expect(log).not.toMatch(/WARNING/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 240000);
});
