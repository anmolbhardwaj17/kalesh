#!/usr/bin/env node
// Asset request CLI. Manages harness/requests/*.json (what the owner is asked to make).
// Status of every request is derived from files on disk, so the dashboard never writes these JSONs.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT, readJSON, writeJSON, nowISO, parseArgs, splitList, manifest, manifestEntry, statusOf, withLock } from './lib.mjs';

const HELP = `Asset requests (art, sound and voice the owner makes with AI tools and uploads on the dashboard)

Images (textures, decals, icons, portraits, keyart, backdrops, ui):
  add --kind <texture|decal|icon|portrait|keyart|backdrop|ui> --id <id> --intent "what it is"
      [--prompt "final ChatGPT prompt"] [--placeholder "color=#1f2533,pattern=noise,scale=1"]
      [--used-by L03,main_menu] [--priority 1-3] [--batch B1-textures] [--w 1024 --h 1024]
  set-prompt --id <id> --prompt "..." [--priority n] [--batch name]     (works for sfx/music ids too)
  revise --id <id> --note "what to change" [--prompt "new prompt"] [--remove]
                                                 ask the owner for a new version (--remove: take the bad file out of the game)
  review --id <id> --ok [--note "..."] [--fit ok|pending|mismatch] [--fit-note "..."]
                                                 mark a delivered file as checked; fit = works where the game uses it
  fit-pending [--json]                           approved images whose in-game fit is not confirmed yet
  unreviewed [--json]                            delivered images not reviewed yet
  pending [--sfx|--music]                        requests that still need a final prompt
  list [--status waiting|received|ready|redo] [--kind texture]
3D model (kind model, ids model_<name>, a .glb; rigged characters need a skeleton):
  add --kind model --id model_guard --intent "what it is" --prompt "step by step instructions for the owner"
      [--portrait portrait_guard] [--used-by L01] [--priority 2] [--batch "B3 models"]
      Limits after ingest: at most 25000 triangles and 3 materials. Upload the Mixamo .fbx or a .glb on the dashboard card; ingest converts an .fbx to .glb and checks it.
Sound:
  sfx-add --id sfx_x --desc "..." [--prompt "..."] [--duration 1.5] [--loop] [--used-by L03] [--priority n]
  music-add --id mus_x --desc "..." [--prompt "..."] [--duration 90] [--loop] [--mood "..."]
  voice-add --id vo_L03_010 --speaker guide --text "..." [--direction "..."] [--milestone L03]
  voice-profile --speaker guide --name "Guide" --profile "ElevenLabs voice design text"
Other:
  stats                                          counts by status
  ids --json                                     every id by type (used by assets:sync)

Ids: snake_case with a prefix: tex_ decal_ icon_ portrait_ keyart_ backdrop_ ui_ model_ sfx_ mus_ vo_.
Files the owner uploads land in assets_inbox/ and are processed by harness/bin/ingest.mjs into public/assets/.`;

const KIND_DEFAULTS = {
  texture: { prefix: 'tex_', dir: 'textures', w: 1024, h: 1024, tileable: true, normalMap: true, alpha: false, gen: 'square 1024x1024' },
  decal: { prefix: 'decal_', dir: 'decals', w: 512, h: 512, tileable: false, normalMap: false, alpha: true, gen: 'square 1024x1024' },
  icon: { prefix: 'icon_', dir: 'icons', w: 256, h: 256, tileable: false, normalMap: false, alpha: true, gen: 'square 1024x1024' },
  portrait: { prefix: 'portrait_', dir: 'portraits', w: 512, h: 768, tileable: false, normalMap: false, alpha: true, gen: 'portrait 1024x1536' },
  keyart: { prefix: 'keyart_', dir: 'keyart', w: 1536, h: 1024, tileable: false, normalMap: false, alpha: false, gen: 'landscape 1536x1024' },
  backdrop: { prefix: 'backdrop_', dir: 'backdrops', w: 1536, h: 1024, tileable: false, normalMap: false, alpha: false, gen: 'landscape 1536x1024' },
  model: { prefix: 'model_', dir: 'models', ext: 'glb', w: 0, h: 0, tileable: false, normalMap: false, alpha: false, gen: 'rigged .glb, humanoid skeleton, up to 25000 triangles and 3 materials', maxTriangles: 25000, maxMaterials: 3 },
  ui: { prefix: 'ui_', dir: 'ui', w: 1024, h: 1024, tileable: false, normalMap: false, alpha: true, gen: 'square 1024x1024' },
};

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const str = (v) => (v === undefined || v === true ? undefined : String(v));

const load = (file, empty) => readJSON(file, empty);
const files = {
  assets: () => load(PATHS.reqAssets, { requests: [] }),
  sfx: () => load(PATHS.reqSfx, { requests: [] }),
  music: () => load(PATHS.reqMusic, { requests: [] }),
  voice: () => load(PATHS.reqVoice, { voices: [], lines: [] }),
};


function findAny(id) {
  for (const [type, f, key] of [['image', PATHS.reqAssets, 'requests'], ['sfx', PATHS.reqSfx, 'requests'], ['music', PATHS.reqMusic, 'requests'], ['voice', PATHS.reqVoice, 'lines']]) {
    const data = readJSON(f, null); if (!data) continue;
    const r = (data[key] || []).find((x) => x.id === id);
    if (r) return { type, file: f, key, data, req: r };
  }
  return null;
}

function parsePlaceholder(s, kind) {
  const base = { color: '#1f2533', pattern: kind === 'texture' ? 'noise' : 'flat', scale: 1 };
  if (!s) return base;
  for (const kv of String(s).split(',')) {
    const [k, v] = kv.split('=').map((x) => x.trim());
    if (k) base[k] = isNaN(Number(v)) ? v : Number(v);
  }
  return base;
}

function checkId(id, prefix) {
  if (!id || !/^[A-Za-z0-9_]+$/.test(id)) { console.error('id must be snake_case letters, digits and underscores'); process.exit(2); }
  if (prefix && !id.startsWith(prefix)) { console.error(`id for this kind must start with ${prefix}`); process.exit(2); }
}

function print(s) { process.stdout.write(s + '\n'); }

switch (cmd) {
  case undefined: case 'help': case '--help': print(HELP); break;

  case 'add': {
    const kind = str(args.kind); const d = KIND_DEFAULTS[kind];
    if (!d) { console.error(`--kind must be one of ${Object.keys(KIND_DEFAULTS).join(', ')}`); process.exit(2); }
    const id = str(args.id); checkId(id, d.prefix);
    if (!str(args.intent) && !str(args.prompt)) { console.error('add needs --intent (or --prompt)'); process.exit(2); }
    withLock(() => {
      const data = files.assets();
      const existing = data.requests.find((r) => r.id === id);
      if (existing) {
        existing.used_by = [...new Set([...(existing.used_by || []), ...splitList(args['used-by'], /,/)])];
        writeJSON(PATHS.reqAssets, data); print(`exists: ${id} (used_by updated)`); return;
      }
      const w = args.w ? Number(args.w) : d.w; const h = args.h ? Number(args.h) : d.h;
      data.requests.push({
        id, kind, intent: str(args.intent) || '', prompt: str(args.prompt) || null, generate: d.gen,
        target: kind === 'model'
          ? { out: `${d.dir}/${id}.${d.ext}`, maxTriangles: d.maxTriangles, maxMaterials: d.maxMaterials }
          : { w, h, tileable: d.tileable, normalMap: d.normalMap, alpha: d.alpha, out: `${d.dir}/${id}.webp` },
        placeholder: parsePlaceholder(str(args.placeholder), kind),
        ...(kind === 'model' && str(args.portrait) ? { source: str(args.portrait) } : {}),
        used_by: splitList(args['used-by'], /,/), priority: args.priority ? Number(args.priority) : 2,
        batch: str(args.batch) || null, created: nowISO(),
      });
      writeJSON(PATHS.reqAssets, data); print(`added ${id}`);
      print('next: reference the id in code with its placeholder (TECH.md "Assets"); the game swaps in the file once it is ingested');
    });
    break;
  }

  case 'set-prompt': {
    const id = str(args.id); const prompt = str(args.prompt);
    if (!id || !prompt) { console.error('set-prompt --id <id> --prompt "..."'); process.exit(2); }
    withLock(() => {
      const hit = findAny(id); if (!hit) { console.error(`no request ${id}`); process.exit(2); }
      hit.req.prompt = prompt;
      if (args.priority) hit.req.priority = Number(args.priority);
      if (str(args.batch)) hit.req.batch = str(args.batch);
      hit.req.promptAt = nowISO();
      writeJSON(hit.file, hit.data); print(`prompt set: ${id}`);
    });
    break;
  }

  case 'revise': {
    // Ask the owner for a new version. --prompt replaces the prompt (fix the cause, not just the symptom).
    // --remove also takes the current file out of the game manifest so the placeholder shows until the new file arrives.
    const id = str(args.id); const note = str(args.note) || 'needs a new version';
    withLock(() => {
      const hit = findAny(id); if (!hit) { console.error(`no request ${id}`); process.exit(2); }
      const man = manifest(); const inMan = manifestEntry(man, id);
      hit.req.redo = { at: nowISO(), note };
      if (str(args.prompt)) { hit.req.prompt = str(args.prompt); hit.req.promptAt = nowISO(); }
      hit.req.review = { at: nowISO(), verdict: 'redo', note, ingestedAt: inMan?.ingestedAt || null, removed: !!args.remove };
      writeJSON(hit.file, hit.data);
      if (args.remove && inMan) {
        if (man.images?.[id]) delete man.images[id]; else if (man.models?.[id]) delete man.models[id]; else delete man.audio[id];
        writeJSON(PATHS.manifest, man);
      }
      print(`marked for redo: ${id}${args.remove && inMan ? ' (removed from game, placeholder until the new file)' : ''}`);
    });
    break;
  }

  case 'review': {
    // Record that a delivered file was checked and is good enough. --note keeps a minor remark without asking for a redo.
    const id = str(args.id);
    if (!id || !args.ok) { console.error('review --id <id> --ok [--note "..."] [--fit ok|pending|mismatch] [--fit-note "..."]   (to reject use: revise --id <id> --note "..." [--prompt "..."] [--remove])'); process.exit(2); }
    withLock(() => {
      const hit = findAny(id); if (!hit) { console.error(`no request ${id}`); process.exit(2); }
      const man = manifest(); const inMan = manifestEntry(man, id);
      if (!inMan) { console.error(`${id} has no file in the game yet`); process.exit(2); }
      // fit: does it work where the game uses it? ok = checked in game, pending = its game feature is not built yet, mismatch = the game side must change (a task was added).
      const fit = str(args.fit) || 'pending';
      if (!['ok', 'pending', 'mismatch'].includes(fit)) { console.error('--fit must be ok, pending or mismatch'); process.exit(2); }
      hit.req.review = { at: nowISO(), verdict: 'ok', note: str(args.note) || '', ingestedAt: inMan.ingestedAt || null, fit, fitNote: str(args['fit-note']) || '' };
      writeJSON(hit.file, hit.data); print(`reviewed ok: ${id} (fit ${fit})`);
    });
    break;
  }

  case 'fit-pending': {
    // Approved images whose fit in the game is not confirmed yet (their feature was not built at review time, or a mismatch task is open).
    const man = manifest();
    const rows = files.assets().requests.filter((r) => man.images?.[r.id] && r.review?.verdict === 'ok' && r.review.fit !== 'ok')
      .map((r) => args.json ? r.id : `${r.id} [${r.kind}] fit ${r.review.fit || 'pending'}${r.review.fitNote ? ': ' + r.review.fitNote : ''}`);
    print(args.json ? JSON.stringify(rows) : (rows.join('\n') || 'none'));
    break;
  }

  case 'unreviewed': {
    // Delivered images whose current file has not been reviewed yet (new upload, or replaced after a review).
    const man = manifest();
    const rows = files.assets().requests.filter((r) => {
      const m = man.images?.[r.id]; if (!m || r.kind === 'model') return false;
      return !r.review || !r.review.ingestedAt || Date.parse(r.review.ingestedAt) < Date.parse(m.ingestedAt || 0);
    }).map((r) => args.json ? r.id : `${r.id} [${r.kind} ${r.target.w}x${r.target.h}${r.target.tileable ? ' tileable' : ''}${r.target.alpha ? ' alpha' : ''}] ${r.batch || ''}\n    file: public/${man.images[r.id].path}\n    intent: ${r.intent}`);
    print(args.json ? JSON.stringify(rows) : (rows.join('\n') || 'none'));
    break;
  }

  case 'pending': {
    let list;
    if (args.sfx) list = files.sfx().requests.filter((r) => !r.prompt).map((r) => `${r.id}  ${r.desc}`);
    else if (args.music) list = files.music().requests.filter((r) => !r.prompt).map((r) => `${r.id}  ${r.desc}`);
    else list = files.assets().requests.filter((r) => !r.prompt).map((r) => `${r.id} [${r.kind}${r.kind === 'model' ? '' : ` ${r.target.w}x${r.target.h}${r.target.tileable ? ' tileable' : ''}${r.target.alpha ? ' alpha' : ''}`}] used by ${(r.used_by || []).join(',') || '-'}\n    intent: ${r.intent}`);
    print(list.length ? list.join('\n') : 'nothing pending');
    break;
  }

  case 'list': {
    const man = manifest();
    const want = str(args.status); const kind = str(args.kind);
    const rows = files.assets().requests
      .map((r) => ({ r, s: statusOf(r.id, r, man) }))
      .filter(({ r, s }) => (!want || s === want) && (!kind || r.kind === kind))
      .map(({ r, s }) => `${s.padEnd(8)} p${r.priority} ${r.id} [${r.kind}] ${r.batch || ''}`);
    print(rows.join('\n') || 'none');
    break;
  }

  case 'sfx-add': case 'music-add': {
    const isSfx = cmd === 'sfx-add';
    const id = str(args.id); checkId(id, isSfx ? 'sfx_' : 'mus_');
    if (!str(args.desc)) { console.error('needs --desc'); process.exit(2); }
    withLock(() => {
      const file = isSfx ? PATHS.reqSfx : PATHS.reqMusic;
      const data = isSfx ? files.sfx() : files.music();
      const ex = data.requests.find((r) => r.id === id);
      if (ex) { ex.used_by = [...new Set([...(ex.used_by || []), ...splitList(args['used-by'], /,/)])]; writeJSON(file, data); print(`exists: ${id}`); return; }
      data.requests.push({ id, desc: str(args.desc), prompt: str(args.prompt) || null, duration_s: args.duration ? Number(args.duration) : (isSfx ? 1.5 : 90), loop: !!args.loop, mood: str(args.mood) || null, used_by: splitList(args['used-by'], /,/), priority: args.priority ? Number(args.priority) : 2, created: nowISO() });
      writeJSON(file, data); print(`added ${id}`);
    });
    break;
  }

  case 'voice-add': {
    const id = str(args.id); checkId(id, 'vo_');
    const speaker = str(args.speaker); const text = str(args.text);
    if (!speaker || !text) { console.error('voice-add needs --speaker and --text'); process.exit(2); }
    if (/—/.test(text)) { console.error('no em dashes in lines'); process.exit(2); }
    withLock(() => {
      const data = files.voice();
      const ex = data.lines.find((l) => l.id === id);
      const line = { id, speaker, text, direction: str(args.direction) || '', milestone: str(args.milestone || args.mission) || null, updated: nowISO() };
      if (ex) {
        const changed = ex.text !== text;
        Object.assign(ex, line);
        if (changed) ex.redo = { at: nowISO(), note: 'line text changed' };
      } else data.lines.push(line);
      writeJSON(PATHS.reqVoice, data); print(`${ex ? 'updated' : 'added'} ${id}`);
    });
    break;
  }

  case 'voice-profile': {
    const speaker = str(args.speaker); if (!speaker || !str(args.profile)) { console.error('voice-profile --speaker x --profile "..."'); process.exit(2); }
    withLock(() => {
      const data = files.voice();
      const ex = data.voices.find((v) => v.speaker === speaker);
      const v = { speaker, name: str(args.name) || speaker, profile: str(args.profile) };
      if (ex) Object.assign(ex, v); else data.voices.push(v);
      writeJSON(PATHS.reqVoice, data); print(`voice profile set: ${speaker}`);
    });
    break;
  }

  case 'stats': {
    const man = manifest();
    const count = (list) => list.reduce((acc, r) => { const s = statusOf(r.id, r, man); acc[s] = (acc[s] || 0) + 1; return acc; }, {});
    print(JSON.stringify({ images: count(files.assets().requests), sfx: count(files.sfx().requests), music: count(files.music().requests), voice: count(files.voice().lines) }, null, 2));
    break;
  }

  case 'ids': {
    const out = {
      texture: files.assets().requests.filter((r) => r.kind === 'texture').map((r) => r.id),
      image: files.assets().requests.filter((r) => r.kind !== 'texture').map((r) => r.id),
      sfx: files.sfx().requests.map((r) => r.id),
      music: files.music().requests.map((r) => r.id),
      voice: files.voice().lines.map((l) => l.id),
    };
    print(args.json ? JSON.stringify(out) : Object.entries(out).map(([k, v]) => `${k}: ${v.length}`).join('\n'));
    break;
  }

  default: console.error(`Unknown command ${cmd}`); print(HELP); process.exit(2);
}
