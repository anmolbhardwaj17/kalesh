#!/usr/bin/env node
// Mixamo clip build (P2-072): the owner's Mixamo clips (FBX, without skin, 30 fps) into the game's animation
// libraries for the three leads.
//   node tools/characters/mixamo_build.mjs            import every clip and build rig/mixamo/*.res and the per-lead sets
//   node tools/characters/mixamo_build.mjs --no-leads the shared libraries only
//   node tools/characters/mixamo_build.mjs --leads-only  the per-lead sets only (from the committed libraries)
// Source: assets_inbox/mixamo/<category>/<Clip Name>.fbx (gitignored: the Mixamo licence lets the game use the motion
// but not share the raw files). Only the converted Godot resources are committed.
// 1. Copies each FBX to the gitignored game/characters/mixamo_src/<category>/<slug>.fbx with an import setting that
//    retargets the Mixamo skeleton to Godot's SkeletonProfileHumanoid (rig/mixamo_bone_map.tres, the same map and rest
//    fix the lead models are imported with, P2-068), imports headless.
// 2. game/characters/tools/build_mixamo.gd writes game/characters/rig/mixamo/<category>.res (one AnimationLibrary per
//    category, clips named by slug: "Walking (1).fbx" is walking_1), with loop flags set and root motion moved from
//    the hips onto the profile's Root bone, and game/data/mixamo_clips.json (every clip by name with its category,
//    source file, length, loop, root motion and turn).
// 3. Then the same script with `-- leads` builds rig/mx_<id>.res per lead: the picked clips (mixamo_picks.json) aimed
//    onto the lead's limbs and fitted to the game's gaits (humanoid_anim.gd plays it).
// game/characters/mixamo_src is removed again (MIXAMO_KEEP=1 keeps it).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INBOX = path.join(ROOT, 'assets_inbox/mixamo');
const SRC = path.join(ROOT, 'game/characters/mixamo_src');

export function slug(name) {
  return name.toLowerCase().replace(/\.fbx$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Every clip in the inbox: [{category, file, name}], names unique (a repeated name gets its category in front). */
export function scan(dir = INBOX) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const cat of fs.readdirSync(dir).sort()) {
    const cdir = path.join(dir, cat);
    if (!fs.statSync(cdir).isDirectory()) continue;
    for (const f of fs.readdirSync(cdir).sort()) {
      if (!/\.fbx$/i.test(f)) continue;
      out.push({ category: slug(cat), file: `${cat}/${f}`, name: slug(f) });
    }
  }
  const seen = new Map();
  for (const c of out) seen.set(c.name, (seen.get(c.name) || 0) + 1);
  for (const c of out) if (seen.get(c.name) > 1) c.name = `${c.category}_${c.name}`;
  return out;
}

function importFile(rel) {
  return `[remap]\n\nimporter="scene"\nimporter_version=1\ntype="PackedScene"\n\n[deps]\n\nsource_file="res://characters/mixamo_src/${rel}"\n\n[params]\n\n`
    + 'nodes/root_type=""\nnodes/root_name=""\nnodes/apply_root_scale=true\nnodes/root_scale=1.0\nnodes/import_as_skeleton_bones=false\n'
    + 'meshes/generate_lods=false\nmeshes/create_shadow_meshes=false\nskins/use_named_skins=true\n'
    + 'animation/import=true\nanimation/fps=30\nanimation/trimming=false\nanimation/remove_immutable_tracks=true\nanimation/import_rest_as_RESET=false\nimport_script/path=""\n'
    + '_subresources={\n"nodes": {\n"PATH:Skeleton3D": {\n"retarget/bone_map": Resource("res://characters/rig/mixamo_bone_map.tres"),\n'
    + '"retarget/rest_fixer/fix_silhouette/enable": false,\n"retarget/remove_tracks/unmapped_bones": true\n}\n}\n}\n'
    + 'fbx/importer=0\nfbx/allow_geometry_helper_nodes=false\nfbx/embedded_image_handling=1\nfbx/naming_version=2\n';
}

function godot(args, label) {
  const bin = spawnSync('node', ['harness/bin/godot.mjs', 'path'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: 1800000, maxBuffer: 256 * 1024 * 1024 });
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0 || /SCRIPT ERROR|^ERROR: (?!.*(leaked|still in use|Pages in use))/m.test(text)) {
    console.log(text.split('\n').filter((l) => /ERROR|build_mixamo|at: /.test(l)).slice(0, 60).join('\n'));
    throw new Error(`${label} failed (exit ${r.status})`);
  }
  return text;
}

function main() {
  const clips = scan();
  if (!clips.length) { console.log('mixamo_build: no clips in assets_inbox/mixamo'); return; }
  const leads = !process.argv.includes('--no-leads');
  if (process.argv.includes('--leads-only')) {
    const lo = godot(['--headless', '--path', 'game', '-s', 'res://characters/tools/build_mixamo.gd', '--quit-after', '200000', '--', 'leads'], 'leads');
    console.log(lo.split('\n').filter((l) => /^(build_mixamo|lead |gait |aim )/.test(l)).join('\n'));
    return;
  }
  fs.rmSync(SRC, { recursive: true, force: true });
  for (const c of clips) {
    const rel = `${c.category}/${c.name}.fbx`;
    fs.mkdirSync(path.join(SRC, c.category), { recursive: true });
    fs.copyFileSync(path.join(INBOX, c.file), path.join(SRC, rel));
    fs.writeFileSync(path.join(SRC, `${rel}.import`), importFile(rel));
  }
  fs.writeFileSync(path.join(SRC, 'list.json'), JSON.stringify(clips, null, 1));
  console.log(`mixamo_build: ${clips.length} clips copied`);
  try {
    godot(['--headless', '--path', 'game', '--import'], 'import');
    const out = godot(['--headless', '--path', 'game', '-s', 'res://characters/tools/build_mixamo.gd', '--quit-after', '200000', '--', 'library'], 'library');
    console.log(out.split('\n').filter((l) => /^(build_mixamo|lib )/.test(l)).join('\n'));
    if (leads) {
      const lo = godot(['--headless', '--path', 'game', '-s', 'res://characters/tools/build_mixamo.gd', '--quit-after', '200000', '--', 'leads'], 'leads');
      console.log(lo.split('\n').filter((l) => /^(build_mixamo|lead |gait |aim )/.test(l)).join('\n'));
    }
  } finally {
    if (!process.env.MIXAMO_KEEP) fs.rmSync(SRC, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
