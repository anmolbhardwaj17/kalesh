#!/usr/bin/env node
// Lead model build (P2-063): the owner's three lead models (public/assets/models/model_lead_<id>.glb, text to 3D plus
// the Mixamo auto rig, converted from FBX by ingest) into the game's rig files.
//   node tools/characters/lead_build.mjs              all three leads that have a file in the manifest
//   node tools/characters/lead_build.mjs bittu danny  only these
// 1. Copies each .glb into the gitignored game/characters/lead_src/<id>.glb and repairs one thing the FBX to glTF step
//    leaves wrong: the root joint (mixamorig_Hips) keeps the FBX armature's Z-up translation while every other joint
//    and the skin's bind matrices are Y-up, so the joint is moved to its bind position (the inverse bind matrix). The
//    single frame "mixamo_com" animation is dropped.
// 2. Writes an import setting that retargets the skeleton to Godot's SkeletonProfileHumanoid
//    (game/characters/rig/mixamo_bone_map.tres, the same profile as the Universal Animation Library clips), imports
//    headless and runs game/characters/tools/build_leads.gd, which writes game/characters/rig/lead_<id>.scn (three
//    mesh levels, the stylised B material with the model's own texture, VRAM compressed) and lead_<id>_albedo.res, then
//    game/characters/tools/build_locomotion.gd -- lead <id> (rig/loco_<id>.res: the walk, jog, sprint, crouch walk and
//    the moves rebuilt on this skeleton, feet planted on its own legs) and rig/clips_<id>.res (the library clips on the
//    model's own rest, the limbs aimed at the mannequin's: characters/tools/lead_retarget.gd). P2-068: the model's
//    bind and rest pose stay exactly as Mixamo delivered them (no silhouette fix, no re-posing). Those four files per
//    lead are the only committed outputs; lead_src is removed again. A new model for one lead: put its glb in the
//    manifest (ingest does that) and run `node tools/characters/lead_build.mjs <id>`.
// Without a model file a lead keeps the stand-in mannequin (humanoid_anim.gd falls back).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'game/characters/lead_src');
const RIG = path.join(ROOT, 'game/characters/rig');
const LEADS = ['bittu', 'meera', 'danny'];

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a binary glTF`);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const rest = b.subarray(20 + jl);
  const binLen = rest.length >= 8 ? rest.readUInt32LE(0) : 0;
  const bin = binLen ? rest.subarray(8, 8 + binLen) : Buffer.alloc(0);
  return { json, bin };
}

function writeGlb(file, json, bin) {
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (js.length % 4)) % 4;
  js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
  const bpad = (4 - (bin.length % 4)) % 4;
  const bb = Buffer.concat([bin, Buffer.alloc(bpad, 0)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bb.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bb.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, js, bh, bb]));
}

// The 4x4 inverse bind matrix of joint slot `j` (column major) as its inverse's translation (a rigid matrix: -R^T t).
function bindOrigin(json, bin, skin, j) {
  const acc = json.accessors[skin.inverseBindMatrices];
  const bv = json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0) + j * 64;
  const m = [];
  for (let i = 0; i < 16; i++) m.push(bin.readFloatLE(off + i * 4));
  // column major: R columns are m[0..2], m[4..6], m[8..10]; t is m[12..14]
  const t = [m[12], m[13], m[14]];
  const col = (c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [-dot(col(0), t), -dot(col(1), t), -dot(col(2), t)];
}

// Moves every root joint (a joint whose parent is not a joint) to its bind position; answers what moved.
export function repairRoots(json, bin) {
  const out = [];
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  for (const skin of json.skins || []) {
    const joints = new Set(skin.joints);
    skin.joints.forEach((ni, j) => {
      const p = parent.get(ni);
      if (p !== undefined && joints.has(p)) return;
      const pn = p === undefined ? null : json.nodes[p];
      if (pn && (pn.matrix || pn.rotation || pn.translation || pn.scale)) return; // a transformed parent: leave it
      const n = json.nodes[ni];
      const want = bindOrigin(json, bin, skin, j);
      const was = n.translation || [0, 0, 0];
      const d = Math.hypot(want[0] - was[0], want[1] - was[1], want[2] - was[2]);
      if (d > 1e-4) {
        n.translation = want.map((v) => Math.round(v * 1e6) / 1e6);
        out.push(`${n.name}: [${was.map((v) => v.toFixed(4))}] -> [${n.translation.map((v) => v.toFixed(4))}]`);
      }
    });
  }
  delete json.animations;
  return out;
}

function importFile(name) {
  return `[remap]\n\nimporter="scene"\nimporter_version=1\ntype="PackedScene"\n\n[deps]\n\nsource_file="res://characters/lead_src/${name}"\n\n[params]\n\n`
    + 'nodes/root_type=""\nnodes/root_name=""\nnodes/apply_root_scale=true\nnodes/root_scale=1.0\nnodes/import_as_skeleton_bones=false\n'
    + 'meshes/ensure_tangents=false\nmeshes/generate_lods=false\nmeshes/create_shadow_meshes=false\nmeshes/light_baking=0\n'
    + 'skins/use_named_skins=true\nanimation/import=false\nanimation/fps=30\nanimation/trimming=false\nanimation/remove_immutable_tracks=true\n'
    + 'animation/import_rest_as_RESET=false\nimport_script/path=""\n'
    + '_subresources={\n"nodes": {\n"PATH:Skeleton3D": {\n"retarget/bone_map": Resource("res://characters/rig/mixamo_bone_map.tres"),\n"retarget/rest_fixer/fix_silhouette/enable": false\n}\n}\n}\n'
    + 'gltf/naming_version=2\ngltf/embedded_image_handling=3\n';
}

function godot(args, label) {
  const bin = spawnSync('node', ['harness/bin/godot.mjs', 'path'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0 || /SCRIPT ERROR|^ERROR: (?!.*(leaked|still in use|Pages in use))/m.test(text)) {
    console.log(text.split('\n').filter((l) => /ERROR|build_leads|at: /.test(l)).join('\n'));
    throw new Error(`${label} failed (exit ${r.status})`);
  }
  return text;
}

function main() {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = want.length ? want : LEADS;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/manifest.json'), 'utf8'));
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.mkdirSync(SRC, { recursive: true });
  const built = [];
  for (const id of ids) {
    const entry = manifest.models?.[`model_lead_${id}`];
    const file = entry && path.join(ROOT, 'public', entry.path);
    if (!file || !fs.existsSync(file)) { console.log(`${id}: no model file, keeps the stand-in`); continue; }
    const { json, bin } = readGlb(file);
    const moved = repairRoots(json, bin);
    for (const m of moved) console.log(`${id}: root joint ${m}`);
    writeGlb(path.join(SRC, `${id}.glb`), json, bin);
    fs.writeFileSync(path.join(SRC, `${id}.glb.import`), importFile(`${id}.glb`));
    built.push(id);
  }
  if (!built.length) { console.log('lead_build: nothing to build'); return; }
  try {
    godot(['--headless', '--path', 'game', '--import'], 'import');
    const out = godot(['--headless', '--path', 'game', '-s', 'res://characters/tools/build_leads.gd', '--quit-after', '20000', '--', ...built], 'build');
    console.log(out.split('\n').filter((l) => /^(lead|build_leads)/.test(l)).join('\n'));
    // the lead's own locomotion clips, built on its skeleton (feet planted on its legs)
    for (const id of built) {
      const lo = godot(['--headless', '--path', 'game', '-s', 'res://characters/tools/build_locomotion.gd', '--quit-after', '20000', '--', 'lead', id], `locomotion ${id}`);
      if (!/build_locomotion: ok/.test(lo)) throw new Error(`locomotion ${id}: no ok line`);
      console.log(lo.split('\n').filter((l) => /^(aimed|gait|move|ground)/.test(l)).map((l) => `${id} ${l}`).join('\n'));
    }
  } finally {
    if (!process.env.LEAD_BUILD_KEEP) fs.rmSync(SRC, { recursive: true, force: true });
  }
  for (const id of built) {
    for (const f of [`lead_${id}.scn`, `lead_${id}_albedo.res`, `loco_${id}.res`, `clips_${id}.res`]) {
      const p = path.join(RIG, f);
      if (fs.existsSync(p)) console.log(`${path.relative(ROOT, p)} ${(fs.statSync(p).size / 1e6).toFixed(2)} MB`);
    }
  }
}

main();
