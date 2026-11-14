#!/usr/bin/env node
// Processes files the owner uploaded (assets_inbox/<id>.<ext>) into game-ready files in public/assets/ and updates
// public/assets/manifest.json, which the game reads to swap placeholders for real files.
//   images: resized to the request's target size (sharp), alpha kept when the request needs it, encoded WebP.
//           Without sharp installed the file is copied as is (a warning goes in the log).
//   audio:  loudness-normalised MP3 with ffmpeg when it is on the PATH, else copied.
//   models: .glb copied; an .fbx (the Mixamo download) is first converted to .glb with the pinned Godot engine (fbx2glb.mjs,
//           skeleton, weights, materials and textures kept; the FBX stays in _processed/); the note lists triangles, materials and bones; a file that is not glTF binary is rejected with a plain message on the card. A hero landmark
//           model (id model_lm_<registry id>) must also pass the hero rule (glbcheck.mjs heroRule: at most 8 parts of
//           25,000 triangles, 6 materials, 3 levels a part, one far silhouette under 2,000 triangles) or it is
//           rejected with every reason; once in the manifest it replaces the parts kit stand-in by id (P2-007).
// Processed originals move to assets_inbox/_processed/, files with no matching request to _unmatched/, bad ones to _rejected/.
// Usage: node harness/bin/ingest.mjs [--id <id>]
// (The original harness's ingest also built normal and roughness maps and decimated rigged models; add such steps here per game.)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { H, PATHS, readJSON, writeJSON, nowISO, parseArgs, withLock } from './lib.mjs';
import os from 'node:os';
import { heroRule, isHeroModelId, modelStats, parseGlb } from './glbcheck.mjs';
import { convertFbxToGlb } from './fbx2glb.mjs';

const args = parseArgs(process.argv.slice(2));
const IMG = new Set(['png', 'jpg', 'jpeg', 'webp']);
const AUD = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const dirs = { processed: path.join(PATHS.inboxDir, '_processed'), rejected: path.join(PATHS.inboxDir, '_rejected'), unmatched: path.join(PATHS.inboxDir, '_unmatched') };
const LOG = path.join(path.dirname(PATHS.reportLatest), 'ingest.log');

function log(msg) { const line = `${nowISO()} ${msg}`; console.log(line); fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n'); }
function has(bin) { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }

function findRequest(id) {
  for (const [type, file, key] of [['image', PATHS.reqAssets, 'requests'], ['sfx', PATHS.reqSfx, 'requests'], ['music', PATHS.reqMusic, 'requests'], ['voice', PATHS.reqVoice, 'lines']]) {
    const r = (readJSON(file, { [key]: [] })[key] || []).find((x) => x.id === id);
    if (r) return { type, req: r };
  }
  return null;
}

async function processImage(file, req) {
  const out = path.join(PATHS.publicAssets, req.target?.out || `images/${req.id}.webp`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let sharp = null;
  try { sharp = (await import('sharp')).default; } catch { /* optional */ }
  if (!sharp) {
    const copy = out.replace(/\.webp$/, path.extname(file));
    fs.copyFileSync(file, copy);
    return { entry: { path: path.relative(path.dirname(PATHS.publicAssets), copy).replace(/\\/g, '/'), ingestedAt: nowISO() }, note: ' copied as is (install sharp to resize and encode)' };
  }
  let img = sharp(file);
  const meta = await img.metadata();
  if (req.target?.w && req.target?.h) img = img.resize(req.target.w, req.target.h, { fit: req.target.tileable ? 'fill' : 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (!req.target?.alpha) img = img.flatten({ background: '#000000' });
  await img.webp({ quality: 88, alphaQuality: 100 }).toFile(out);
  const warn = req.target?.alpha && !meta.hasAlpha ? ' WARNING: the request needs transparency and the upload has none' : '';
  return { entry: { path: `assets/${path.relative(PATHS.publicAssets, out).replace(/\\/g, '/')}`, w: req.target?.w, h: req.target?.h, ingestedAt: nowISO() }, note: ` ${meta.width}x${meta.height} -> ${req.target?.w ?? meta.width}x${req.target?.h ?? meta.height}${warn}` };
}

function processAudio(file, req, type) {
  const sub = type === 'voice' ? 'voice' : type === 'music' ? 'music' : 'sfx';
  const out = path.join(PATHS.publicAssets, 'audio', sub, `${req.id}.mp3`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (has('ffmpeg')) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '160k', out]);
    return { entry: { path: `assets/audio/${sub}/${req.id}.mp3`, ingestedAt: nowISO() }, note: ' normalised with ffmpeg' };
  }
  const copy = out.replace(/\.mp3$/, path.extname(file));
  fs.copyFileSync(file, copy);
  return { entry: { path: `assets/audio/${sub}/${path.basename(copy)}`, ingestedAt: nowISO() }, note: ' copied (no ffmpeg on the PATH)' };
}

async function processModel(file, req, ext = 'glb') {
  let glbFile = file;
  let tmp = null;
  let from = '';
  try {
    if (ext === 'fbx') {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx2glb-'));
      glbFile = path.join(tmp, `${req.id}.glb`);
      const c = await convertFbxToGlb(file, glbFile);
      if (!c.meshes) throw new Error('the FBX has no mesh in it');
      from = `converted from FBX (${c.bones} bones), `;
    }
    const buf = fs.readFileSync(glbFile);
    if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('this is not a binary glTF (.glb) file');
    const json = parseGlb(buf).json;
    let hero = '';
    if (isHeroModelId(req.id)) {
      const limits = readJSON(H('verify', 'perf_budgets.json'), { world: { landmarks: {} } }).world?.landmarks ?? {};
      const r = heroRule(json, limits);
      if (!r.ok) throw new Error(`the hero rule: ${r.reasons.join('; ')}`);
      hero = `, hero rule ok: ${Object.keys(r.parts).length} parts, far ${r.far} triangles, ${r.materials} materials`;
    }
    // Stats and warnings only: the card says "upload it anyway", the reviewer says what to change.
    const st = modelStats(json);
    const warn = [];
    if (req.target?.maxTriangles && st.triangles > req.target.maxTriangles) warn.push(`over the ${req.target.maxTriangles} triangle target`);
    if (req.target?.maxMaterials && st.materials > req.target.maxMaterials) warn.push(`over the ${req.target.maxMaterials} material target`);
    if (/rigged|skeleton/.test(String(req.generate || '')) && (!st.skins || !st.weighted)) warn.push('no skeleton with skin weights found');
    const stats = `${st.triangles} triangles, ${st.materials} materials, ${st.joints} bones${warn.length ? `, WARNING: ${warn.join('; ')}` : ''}`;
    const out = path.join(PATHS.publicAssets, req.target?.out || `models/${req.id}.glb`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(glbFile, out);
    return { entry: { path: `assets/${path.relative(PATHS.publicAssets, out).replace(/\\/g, '/')}`, bytes: buf.length, kind: 'model', ingestedAt: nowISO() }, note: ` ${from}${Math.round(buf.length / 1024)} KB, ${stats}${hero}` };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  if (!fs.existsSync(PATHS.inboxDir)) { console.log('no assets_inbox/ yet'); return; }
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const files = fs.readdirSync(PATHS.inboxDir).filter((f) => fs.statSync(path.join(PATHS.inboxDir, f)).isFile() && !f.startsWith('.'));
  for (const f of files) {
    const id = f.slice(0, f.lastIndexOf('.'));
    const ext = f.slice(f.lastIndexOf('.') + 1).toLowerCase();
    if (args.id && args.id !== true && id !== String(args.id)) continue;
    const src = path.join(PATHS.inboxDir, f);
    const hit = findRequest(id);
    if (!hit) { fs.renameSync(src, path.join(dirs.unmatched, f)); log(`${f}: no request with id ${id}, moved to _unmatched`); continue; }
    try {
      let r;
      if (hit.type === 'image' && hit.req.kind === 'model') { if (ext !== 'glb' && ext !== 'fbx') throw new Error('upload the .fbx from Mixamo, or a .glb file'); r = await processModel(src, hit.req, ext); }
      else if (hit.type === 'image') { if (!IMG.has(ext)) throw new Error(`upload an image (${[...IMG].join(', ')})`); r = await processImage(src, hit.req); }
      else { if (!AUD.has(ext)) throw new Error(`upload audio (${[...AUD].join(', ')})`); r = processAudio(src, hit.req, hit.type); }
      withLock(() => {
        const man = readJSON(PATHS.manifest, { images: {}, audio: {}, models: {} });
        const bucket = hit.req.kind === 'model' ? 'models' : hit.type === 'image' ? 'images' : 'audio';
        (man[bucket] ||= {})[id] = r.entry;
        writeJSON(PATHS.manifest, man);
      });
      fs.renameSync(src, path.join(dirs.processed, f));
      log(`${f}: ingested${r.note}`);
    } catch (e) {
      fs.renameSync(src, path.join(dirs.rejected, f));
      log(`${f}: REJECTED: ${e.message}`);
    }
  }
}

main().catch((e) => { log(`ingest failed: ${e.message}`); process.exit(1); });
