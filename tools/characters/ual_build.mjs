#!/usr/bin/env node
// Humanoid stand-in build (P1-023): the Quaternius Universal Animation Library 1 and 2 (CC0) into the game's rig files.
//   node tools/characters/ual_build.mjs            download (when missing), extract, import, build
//   node tools/characters/ual_build.mjs --offline  use the zips already in data/ual/ only
// 1. Downloads the two free "Standard" zips from itch.io into the gitignored data/ual/ (the itch download page flow:
//    no account, price 0) and pins them in data/SOURCES.json (sha256, size, url, licence, credit).
// 2. Extracts only the three Godot .glb files and the licence into their own empty folder data/ual/extract/. Nothing
//    inside the downloads is run.
// 3. Copies the .glb files into the gitignored game/characters/ual_src/ with an import setting that retargets them to
//    Godot's SkeletonProfileHumanoid (game/characters/rig/ual_bone_map.tres), imports them headless and runs
//    game/characters/tools/build_humanoid.gd, which writes game/characters/rig/ual_clips.res, mannequin_m.scn and
//    mannequin_f.scn (the only committed outputs), then removes ual_src again.
// If the download fails the game keeps the capsule stand-in (on_foot.gd falls back when the rig files are missing).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/ual');
const EXTRACT = path.join(DATA, 'extract');
const SRC = path.join(ROOT, 'game/characters/ual_src');
const PACKS = {
  ual1_standard: { slug: 'universal-animation-library', zip: 'ual1_standard.zip', title: 'Universal Animation Library[Standard]' },
  ual2_standard: { slug: 'universal-animation-library-2', zip: 'ual2_standard.zip', title: 'Universal Animation Library 2[Standard]' },
};
// zip entry -> file name in ual_src
const GLBS = [
  ['ual1_standard', 'Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb', 'ual1.glb'],
  ['ual2_standard', 'Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb', 'ual2.glb'],
  ['ual2_standard', 'Universal Animation Library 2[Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb', 'mannequin_f.glb'],
];
const LICENCE = 'CC0 1.0 Universal (public domain dedication)';
const CREDIT = 'Animations and mannequins: Universal Animation Library 1 and 2 by Quaternius (quaternius.com), CC0';

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

class Jar {
  constructor() { this.c = new Map(); }
  take(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [kv] = line.split(';'); const i = kv.indexOf('=');
      if (i > 0) this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function get(jar, url, opts = {}) {
  const res = await fetch(url, { ...opts, redirect: 'follow', headers: { cookie: jar.header(), 'user-agent': 'kalesh-build', ...(opts.headers || {}) } });
  jar.take(res);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

const csrf = (html) => (html.match(/name="csrf_token" value="([^"]+)"/) || [])[1];

// The itch.io flow of a free download: the game page gives a CSRF token, download_url gives the download page, and a
// POST per upload gives a signed file URL that lasts 60 s.
async function download(pack, out) {
  const jar = new Jar();
  const base = `https://quaternius.itch.io/${pack.slug}`;
  const page = await (await get(jar, base)).text();
  const form = (t) => ({ method: 'POST', body: new URLSearchParams({ csrf_token: t }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' } });
  const { url: dlPage } = await (await get(jar, `${base}/download_url`, form(csrf(page)))).json();
  const html = await (await get(jar, dlPage)).text();
  const ids = [...html.matchAll(/data-upload_id="(\d+)"/g)].map((m) => m[1]);
  const names = [...html.matchAll(/class="name" title="([^"]+)"/g)].map((m) => m[1]);
  const k = names.findIndex((n) => n.includes('[Standard]'));
  if (k < 0 || !ids[k]) throw new Error(`${pack.slug}: no Standard upload on the download page (${dlPage}, ${html.length} bytes, ids ${ids}, names ${names})`);
  const file = await (await get(jar, `${base}/file/${ids[k]}?source=game_download&after_download_lightbox=1&as_props=1`, { ...form(csrf(html)), headers: { ...form('').headers, referer: dlPage } })).json();
  if (!file.url) throw new Error(`${pack.slug}: ${JSON.stringify(file.errors || file)}`);
  const buf = Buffer.from(await (await fetch(file.url)).arrayBuffer());
  fs.writeFileSync(out, buf);
  return `${base} (upload ${ids[k]}, ${names[k]})`;
}

function pin(id, file, url) {
  const p = path.join(ROOT, 'data/SOURCES.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rel = path.relative(ROOT, file);
  const old = j.files[id];
  const sum = sha256(file);
  if (old && old.sha256 === sum) return;
  j.files[id] = {
    file: rel, bytes: fs.statSync(file).size, sha256: sum, date: new Date().toISOString().slice(0, 10), url, licence: LICENCE,
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', credit: CREDIT,
    note: 'the free Standard pack from the itch.io download page; only the Godot .glb files and License.txt are extracted (P1-023)',
  };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}

function importFile(name) {
  return `[remap]\n\nimporter="scene"\nimporter_version=1\ntype="PackedScene"\n\n[deps]\n\nsource_file="res://characters/ual_src/${name}"\n\n[params]\n\n`
    + 'nodes/root_type=""\nnodes/root_name=""\nnodes/apply_root_scale=true\nnodes/root_scale=1.0\nnodes/import_as_skeleton_bones=false\n'
    + 'meshes/ensure_tangents=true\nmeshes/generate_lods=false\nmeshes/create_shadow_meshes=false\nmeshes/light_baking=0\n'
    + 'skins/use_named_skins=true\nanimation/import=true\nanimation/fps=30\nanimation/trimming=false\nanimation/remove_immutable_tracks=true\n'
    + 'animation/import_rest_as_RESET=false\nimport_script/path=""\n'
    + '_subresources={\n"nodes": {\n"PATH:Armature/Skeleton3D": {\n"retarget/bone_map": Resource("res://characters/rig/ual_bone_map.tres")\n}\n}\n}\n'
    + 'gltf/naming_version=2\ngltf/embedded_image_handling=1\n';
}

function godot(args, label) {
  const bin = spawnSync('node', ['harness/bin/godot.mjs', 'path'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0 || /SCRIPT ERROR|^ERROR: (?!.*(leaked|still in use|Pages in use))/m.test(text)) {
    console.log(text.split('\n').filter((l) => /ERROR|build_humanoid/.test(l)).join('\n'));
    throw new Error(`${label} failed (exit ${r.status})`);
  }
  return text;
}

async function main() {
  const offline = process.argv.includes('--offline');
  fs.mkdirSync(DATA, { recursive: true });
  for (const [id, pack] of Object.entries(PACKS)) {
    const zip = path.join(DATA, pack.zip);
    if (!fs.existsSync(zip)) {
      if (offline) throw new Error(`missing ${zip} (--offline)`);
      const from = await download(pack, zip);
      console.log(`downloaded ${pack.zip} from ${from}`);
    }
    pin(id, zip, `https://quaternius.itch.io/${pack.slug}`);
  }
  fs.rmSync(EXTRACT, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT, { recursive: true });
  for (const [id, pack] of Object.entries(PACKS)) {
    const want = GLBS.filter((g) => g[0] === id).map((g) => g[1]).concat(`${pack.title}/License.txt`);
    // unzip reads [ and ] in a name as a wildcard set: escape them
    const pats = want.map((w) => w.replace(/[[\]]/g, (c) => `\\${c}`));
    const r = spawnSync('unzip', ['-q', '-o', path.join(DATA, pack.zip), ...pats, '-d', EXTRACT], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`unzip ${pack.zip}: ${r.stderr}`);
  }
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.mkdirSync(SRC, { recursive: true });
  for (const [, entry, name] of GLBS) {
    fs.copyFileSync(path.join(EXTRACT, entry), path.join(SRC, name));
    fs.writeFileSync(path.join(SRC, `${name}.import`), importFile(name));
  }
  try {
    godot(['--headless', '--path', 'game', '--import'], 'import');
    const out = godot(['--headless', '--path', 'game', '-s', 'res://characters/tools/build_humanoid.gd', '--quit-after', '2000'], 'build');
    console.log(out.split('\n').filter((l) => l.startsWith('stride') || l.startsWith('build_humanoid')).join('\n'));
  } finally {
    fs.rmSync(SRC, { recursive: true, force: true });
  }
  for (const f of ['ual_clips.res', 'mannequin_m.scn', 'mannequin_f.scn']) {
    const p = path.join(ROOT, 'game/characters/rig', f);
    console.log(`${path.relative(ROOT, p)} ${(fs.statSync(p).size / 1e6).toFixed(2)} MB`);
  }
}

main().catch((e) => { console.log(`ual_build: ${e.message}`); process.exit(1); });
