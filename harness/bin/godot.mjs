#!/usr/bin/env node
// Finds the pinned Godot engine and runs it on the project in game/.
//
//   node harness/bin/godot.mjs --version        prints "<version> <binary path>" (the pinned version, checked)
//   node harness/bin/godot.mjs path             prints the binary path only
//   node harness/bin/godot.mjs check            headless import of the project; fails on any ERROR or SCRIPT ERROR line
//   node harness/bin/godot.mjs test             import, then the headless GDScript tests (game/tests/run_tests.gd)
//   node harness/bin/godot.mjs frame <out.png>  one windowed frame of the main scene through Movie Maker
//                                               (--frames N, default 30; --resolution WxH, default 1280x720)
//   node harness/bin/godot.mjs run -- <args>    the engine with any other arguments
// Options: --no-download (fail instead of downloading when no matching binary is found).
//
// Candidate order (kit.config.json "godot"): env GODOT, then tools/godot/, then /Applications/Godot.app. Each candidate's
// --version must start with the pinned version. Only when none matches does it download the official portable build of
// the pinned release for this platform into tools/godot/ (gitignored), checked against the release's SHA512-SUMS.txt.
// It never installs anything outside the repo. This Mac already has the engine; the download is for other machines.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HARNESS_ROOT
  ? path.resolve(process.env.HARNESS_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAC_APP = '/Applications/Godot.app/Contents/MacOS/Godot';
const DEFAULTS = { version: '4.7.2.stable', release: '4.7.2-stable', project: 'game' };

export function godotConfig(root = ROOT) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(root, 'harness', 'kit.config.json'), 'utf8')).godot || {}; } catch { /* defaults */ }
  return { ...DEFAULTS, ...c };
}

/** True when a `godot --version` output is the pinned version ("4.7.2.stable" matches "4.7.2.stable.official.ed1daf0bf"). */
export function versionMatches(output, pin) {
  const v = String(output || '').trim().split(/\s+/).pop() || '';
  return v === pin || v.startsWith(pin + '.');
}

/** The release zip for a platform and CPU, as named on the official GitHub release page. */
export function releaseAsset(platform, arch, release) {
  const base = `Godot_v${release}`;
  if (platform === 'darwin') return `${base}_macos.universal.zip`;
  if (platform === 'win32') return arch === 'arm64' ? `${base}_windows_arm64.exe.zip` : `${base}_win64.exe.zip`;
  if (platform === 'linux') return arch === 'arm64' ? `${base}_linux.arm64.zip` : `${base}_linux.x86_64.zip`;
  throw new Error(`no official Godot build for platform ${platform}`);
}

export function releaseUrl(release, file) {
  return `https://github.com/godotengine/godot/releases/download/${release}/${file}`;
}

/** The binary inside tools/godot/ after the zip is extracted (the console build on Windows, so output reaches the pipe). */
export function toolsBinary(root, platform, arch, release) {
  const dir = path.join(root, 'tools', 'godot');
  const base = `Godot_v${release}`;
  if (platform === 'darwin') return path.join(dir, 'Godot.app', 'Contents', 'MacOS', 'Godot');
  if (platform === 'win32') return path.join(dir, arch === 'arm64' ? `${base}_windows_arm64_console.exe` : `${base}_win64_console.exe`);
  return path.join(dir, arch === 'arm64' ? `${base}_linux.arm64` : `${base}_linux.x86_64`);
}

/** Candidate binaries in order, each with where it came from. */
export function candidates({ env = process.env, root = ROOT, platform = process.platform, arch = process.arch, release = DEFAULTS.release } = {}) {
  const list = [];
  if (env.GODOT) list.push({ source: 'env GODOT', path: env.GODOT });
  list.push({ source: 'tools/godot/', path: toolsBinary(root, platform, arch, release) });
  if (platform === 'darwin') list.push({ source: '/Applications', path: MAC_APP });
  return list;
}

/** Parses a SHA512-SUMS.txt ("<hash>  <file>" per line) into a Map of file to lower case hash. */
export function parseSums(text) {
  const m = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const hit = line.trim().match(/^([0-9a-fA-F]{128})\s+\*?(.+)$/);
    if (hit) m.set(hit[2].trim(), hit[1].toLowerCase());
  }
  return m;
}

/** Lines of Godot output that mean something went wrong: ERROR, SCRIPT ERROR, USER ERROR (and their WARNING-free kin). */
export function errorLines(output) {
  return stripAnsi(output).split(/\r?\n/).filter((l) => /^\s*(ERROR|SCRIPT ERROR|USER ERROR|USER SCRIPT ERROR)\b/.test(l));
}

/** Godot colours its output even into a pipe; drop the escape codes. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function runVersion(bin) {
  if (!fs.existsSync(bin)) return null;
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

/** The first candidate whose version matches the pin, or null. `probe(path)` returns its --version text or null. */
export function findGodot({ pin = DEFAULTS.version, list = candidates(), probe = runVersion } = {}) {
  const tried = [];
  for (const c of list) {
    const v = probe(c.path);
    tried.push({ ...c, version: v });
    if (v && versionMatches(v, pin)) return { path: c.path, version: v, source: c.source, tried };
  }
  return { path: null, version: null, source: null, tried };
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${url} (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Downloads the pinned portable build into tools/godot/, checks its SHA512 against the release sums, extracts it. */
export async function downloadGodot({ root = ROOT, platform = process.platform, arch = process.arch, cfg = godotConfig(root) } = {}) {
  const asset = releaseAsset(platform, arch, cfg.release);
  const dir = path.join(root, 'tools', 'godot');
  fs.mkdirSync(dir, { recursive: true });
  console.log(`godot: no ${cfg.version} binary found, downloading ${asset} into tools/godot/`);
  const sums = parseSums((await fetchBuffer(releaseUrl(cfg.release, 'SHA512-SUMS.txt'))).toString('utf8'));
  const want = sums.get(asset);
  if (!want) throw new Error(`SHA512-SUMS.txt of ${cfg.release} has no line for ${asset}`);
  const zip = await fetchBuffer(releaseUrl(cfg.release, asset));
  const got = crypto.createHash('sha512').update(zip).digest('hex');
  if (got !== want) throw new Error(`checksum mismatch for ${asset}: got ${got.slice(0, 16)}..., want ${want.slice(0, 16)}...`);
  const zipPath = path.join(dir, asset);
  fs.writeFileSync(zipPath, zip);
  // tar (bsdtar) reads zip files on macOS and Windows 10+; unzip on Linux.
  const x = platform === 'linux'
    ? spawnSync('unzip', ['-o', '-q', zipPath, '-d', dir], { stdio: 'inherit' })
    : spawnSync('tar', ['-xf', zipPath, '-C', dir], { stdio: 'inherit' });
  if (x.status !== 0) throw new Error(`could not extract ${zipPath}`);
  fs.rmSync(zipPath, { force: true });
  const bin = toolsBinary(root, platform, arch, cfg.release);
  if (platform !== 'win32' && fs.existsSync(bin)) fs.chmodSync(bin, 0o755);
  return bin;
}

/** Resolves the pinned binary, downloading only when allowed and nothing matches. Exits with a message on failure. */
export async function resolveGodot({ allowDownload = true } = {}) {
  const cfg = godotConfig();
  const list = candidates({ release: cfg.release });
  let hit = findGodot({ pin: cfg.version, list });
  if (!hit.path && allowDownload) {
    await downloadGodot({ cfg });
    hit = findGodot({ pin: cfg.version, list });
  }
  if (!hit.path) {
    const lines = hit.tried.map((t) => `  ${t.source}: ${t.path} -> ${t.version || 'missing'}`).join('\n');
    throw new Error(`no Godot ${cfg.version} binary found. Tried:\n${lines}`);
  }
  return { ...hit, cfg };
}

function runGodot(bin, args, { timeoutMs = 300000, echo = true } = {}) {
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const out = stripAnsi(`${r.stdout || ''}${r.stderr || ''}`);
  if (echo && out.trim()) process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  return { status: r.status ?? (r.signal ? 1 : 0), out, timedOut: r.error?.code === 'ETIMEDOUT' };
}

function judge(label, r) {
  const errs = errorLines(r.out);
  if (r.timedOut) { console.log(`godot ${label}: FAIL (timed out)`); return 1; }
  if (r.status !== 0 || errs.length) {
    console.log(`godot ${label}: FAIL (exit ${r.status}, ${errs.length} error line(s))`);
    for (const e of errs.slice(0, 20)) console.log(`  ${e.trim()}`);
    return 1;
  }
  console.log(`godot ${label}: ok`);
  return 0;
}

async function main(argv) {
  const args = argv.slice(2);
  const allowDownload = !args.includes('--no-download');
  const cmd = args.find((a) => !a.startsWith('--')) || (args.includes('--version') ? '--version' : 'help');
  if (cmd === 'help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const g = await resolveGodot({ allowDownload });
  const project = path.join(ROOT, g.cfg.project);
  if (cmd === '--version') { console.log(`${g.cfg.version} ${g.path}`); return 0; }
  if (cmd === 'path') { console.log(g.path); return 0; }
  if (cmd === 'check') {
    const r = runGodot(g.path, ['--headless', '--path', project, '--import'], { echo: false });
    const code = judge('check', r);
    if (code) process.stdout.write(r.out);
    return code;
  }
  if (cmd === 'test') {
    const imp = runGodot(g.path, ['--headless', '--path', project, '--import'], { echo: false });
    if (judge('import', imp)) { process.stdout.write(imp.out); return 1; }
    // --quit-after is a safety net: if the runner dies before quit(), the engine still exits (and the error lines fail it).
    return judge('test', runGodot(g.path, ['--headless', '--path', project, '-s', 'res://tests/run_tests.gd', '--quit-after', '600'], { timeoutMs: 180000 }));
  }
  if (cmd === 'frame') {
    const out = args[args.indexOf('frame') + 1];
    if (!out || out.startsWith('--')) throw new Error('usage: godot.mjs frame <out.png> [--frames N] [--resolution WxH]');
    const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
    const frames = Number(opt('--frames', '30'));
    const res = opt('--resolution', '1280x720');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-frame-'));
    try {
      const imp = runGodot(g.path, ['--headless', '--path', project, '--import'], { echo: false });
      if (judge('import', imp)) return 1;
      const r = runGodot(g.path, ['--path', project, '--resolution', res, '--write-movie', path.join(tmp, 'f.png'), '--fixed-fps', '60', '--quit-after', String(frames)]);
      const pngs = fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
      if (!pngs.length) { console.log('godot frame: FAIL (Movie Maker wrote no PNG)'); return 1; }
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.copyFileSync(path.join(tmp, pngs[pngs.length - 1]), path.resolve(out));
      console.log(`godot frame: wrote ${path.resolve(out)} (frame ${pngs.length} of ${pngs.length})`);
      return judge('frame', r);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  if (cmd === 'run') {
    const rest = args.includes('--') ? args.slice(args.indexOf('--') + 1) : [];
    return spawnSync(g.path, rest, { stdio: 'inherit', cwd: ROOT }).status ?? 1;
  }
  throw new Error(`unknown command ${cmd} (run with no arguments for help)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => process.exit(code), (e) => { console.log(`godot: ${e.message}`); process.exit(1); });
}
