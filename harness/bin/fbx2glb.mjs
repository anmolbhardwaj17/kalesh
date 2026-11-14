#!/usr/bin/env node
// Converts an .fbx (the Mixamo download) to a binary glTF (.glb) with the pinned Godot engine, headless (fbx2glb.gd:
// Godot reads FBX through ufbx and writes glTF; skeleton, skin weights, materials and textures survive, textures are
// embedded). Used by ingest.mjs for model cards. Usage: node harness/bin/fbx2glb.mjs <in.fbx> <out.glb>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveGodot } from './godot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The Godot project of this checkout (not HARNESS_ROOT: a scratch root in tests has no game/).
const PROJECT = path.resolve(HERE, '..', '..', 'game');

/** Converts `src` (.fbx) to `dst` (.glb). Returns {bones, meshes}; throws an Error with a plain message when it cannot. */
export async function convertFbxToGlb(src, dst) {
  if (!fs.existsSync(src)) throw new Error(`no such file ${src}`);
  const g = await resolveGodot({ allowDownload: true });
  fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
  fs.rmSync(dst, { force: true });
  const r = spawnSync(g.path, ['--headless', '--path', PROJECT, '-s', path.join(HERE, 'fbx2glb.gd'), '--', path.resolve(src), path.resolve(dst)], { encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const fail = /FBX2GLB FAIL (.*)/.exec(out);
  if (fail) throw new Error(`could not convert the FBX: ${fail[1].trim()}`);
  const ok = /FBX2GLB OK bones=(\d+) meshes=(\d+)/.exec(out);
  if (!ok || !fs.existsSync(dst)) throw new Error(r.error?.code === 'ETIMEDOUT' ? 'converting the FBX took too long' : 'could not convert the FBX (Godot gave no result)');
  return { bones: Number(ok[1]), meshes: Number(ok[2]) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) { console.log('usage: node harness/bin/fbx2glb.mjs <in.fbx> <out.glb>'); process.exit(2); }
  convertFbxToGlb(src, dst).then((r) => console.log(`converted: ${r.bones} bones, ${r.meshes} meshes -> ${dst}`), (e) => { console.log(e.message); process.exit(1); });
}
