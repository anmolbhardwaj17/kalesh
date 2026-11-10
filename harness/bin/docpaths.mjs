// Doc path check (P2B-033). The design docs and the module map name source files; a renamed or deleted file must not
// leave a dead path behind. This reads every `src/...` path in the docs below and fails on one that does not exist.
//   node harness/bin/docpaths.mjs   (exit 1 on a missing path or an unmapped module)
// Rules:
//   - A path is any `src/...` token (in backticks or not). Templates are skipped: a path with `<`, `*`, `{` or `Mxx`
//     (`src/data/bake/<region>.<time>.bin`, `src/missions/defs/Mxx.ts`).
//   - A path without a file extension may be a prefix (VERIFY's quick set areas: `src/core/loop` matches `loop.ts`).
//   - Short names: in a row or line that names `src/a/b/x.ts`, a later backticked `y.ts` or `c/z.ts` (a file name ending in
//     .ts, .json, .glsl or .bin) is read as `src/a/b/y.ts` (READ_MAP and ARCHITECTURE list siblings that way). A full path
//     outside src/ (a harness/ script) ends that run, so `rat_gait.js` after `harness/verify/...` is not checked.
//   - Mapped modules: every module (not a test, not a .d.ts) under MAPPED_DIRS must be named (a full path, or a short
//     name in a list after one) in docs/ARCHITECTURE.md and in docs/READ_MAP.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DOCS = [
  'docs/ARCHITECTURE.md',
  'docs/READ_MAP.md',
  'harness/design/TECH.md',
  'harness/design/VERIFY.md',
  'harness/design/STYLE_BIBLE.md',
  'harness/design/GAME.md',
];

/** Directories whose every module must have a row in ARCHITECTURE.md and a mention in READ_MAP.md. Empty by default; the
 * ADOPT phase lists the folders it wants mapped (for example ['src/render', 'src/audio']). */
export const MAPPED_DIRS = [];

const SHORT_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(ts|json|glsl|bin)$/;
const FULL_RE = /(?:^|[^A-Za-z0-9_./-])((?:src|harness|docs|build|public)\/[A-Za-z0-9_./<>*{}-]*[A-Za-z0-9_/>*}])/g;

export const isTemplate = (p) => /[<*{]|Mxx/.test(p);

/**
 * Every `src/` path a doc names, with the line it is on. `short` marks a path read from a short sibling name.
 * @param {string} text
 */
export function docPaths(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // Tokens in order: full paths anywhere, short names only inside backticks.
    const tokens = [];
    for (const m of line.matchAll(FULL_RE)) {
      const at = m.index + m[0].indexOf(m[1]);
      tokens.push({ at, end: at + m[1].length, full: m[1] });
    }
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      const t = m[1];
      if (t.includes('/') && /^(src|harness|docs|build|public)\//.test(t)) continue;
      if (SHORT_RE.test(t)) tokens.push({ at: m.index, end: m.index + m[0].length, short: t });
    }
    tokens.sort((a, b) => a.at - b.at);
    let dir = null;
    let prevEnd = 0;
    for (const t of tokens) {
      // A short name belongs to the list only when nothing but commas, spaces and "and" stand between it and the path
      // or short name before it ("`src/a/x.ts`, `y.ts` and `z.ts`"); anything else ends the list.
      const gap = line.slice(prevEnd, t.at).replace(/`/g, '').trim();
      const listed = /^(,\s*)?(and)?$/.test(gap);
      prevEnd = t.end;
      if (t.full) {
        const p = t.full.replace(/[.,;:]+$/, '');
        if (!p.startsWith('src/')) { dir = null; continue; }
        dir = p.endsWith('/') ? p.replace(/\/$/, '') : path.posix.dirname(p);
        if (!isTemplate(p)) out.push({ path: p.replace(/\/$/, ''), line: i + 1, short: false });
      } else if (dir && listed && !isTemplate(t.short)) {
        out.push({ path: path.posix.join(dir, t.short), line: i + 1, short: true, dir });
      } else {
        dir = null;
      }
    }
  });
  return out;
}

/** Does a doc path exist (a file or directory, or for a path with no extension, a prefix of an entry in its folder)? */
export function pathExists(p, root = ROOT) {
  const abs = path.join(root, p);
  if (fs.existsSync(abs)) return true;
  if (path.posix.extname(p)) return false;
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.startsWith(base));
}

/** Where a short name after a path in `dir` may live: `dir`, then each parent folder up to `src`. */
export function shortCandidates(dir, short) {
  const out = [];
  for (let d = dir; d === 'src' || d.startsWith('src/'); d = path.posix.dirname(d)) {
    out.push(path.posix.join(d, short));
    if (d === 'src') break;
  }
  return out;
}

/** Modules under MAPPED_DIRS (no tests, no type declarations), repo relative. */
export function mappedModules(root = ROOT) {
  const out = [];
  for (const d of MAPPED_DIRS) {
    const abs = path.join(root, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f.endsWith('.d.ts')) continue;
      out.push(`${d}/${f}`);
    }
  }
  return out.sort();
}

/**
 * Checks every doc. Returns { missing: [{doc, line, path}], unmappedArch: [module], unmappedReadMap: [module], checked }.
 * Short names that do not exist are reported only when their full form is not a known module elsewhere: a short name
 * after a path in another folder (`prefabs/parts.ts` after `src/world/region.ts`) resolves under that folder.
 */
export function checkDocs(root = ROOT) {
  const missing = [];
  let checked = 0;
  const named = {};
  for (const doc of DOCS) {
    const file = path.join(root, doc);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const paths = docPaths(text);
    for (const p of paths) {
      checked++;
      if (p.short) {
        // A short name may be relative to the listed path's folder or to one of its parents up to src/
        // ("`src/world/regionRuntime.ts`, `systems/props.ts`" is src/systems/props.ts).
        const found = shortCandidates(p.dir, p.path.slice(p.dir.length + 1)).find((c) => pathExists(c, root));
        if (found) { p.path = found; continue; }
      } else if (pathExists(p.path, root)) continue;
      missing.push({ doc, line: p.line, path: p.path, short: p.short });
    }
    named[doc] = new Set(paths.map((p) => p.path));
  }
  const mods = mappedModules(root);
  const unmappedArch = mods.filter((m) => !named['docs/ARCHITECTURE.md']?.has(m));
  const unmappedReadMap = mods.filter((m) => !named['docs/READ_MAP.md']?.has(m));
  return { missing, unmappedArch, unmappedReadMap, checked };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = checkDocs();
  for (const m of r.missing) console.log(`MISSING ${m.doc}:${m.line} ${m.path}${m.short ? ' (short name)' : ''}`);
  for (const m of r.unmappedArch) console.log(`NO ROW  docs/ARCHITECTURE.md has no row naming ${m}`);
  for (const m of r.unmappedReadMap) console.log(`NO READ docs/READ_MAP.md does not list ${m}`);
  const bad = r.missing.length + r.unmappedArch.length + r.unmappedReadMap.length;
  console.log(bad ? `docpaths: ${bad} problem(s) in ${r.checked} paths` : `docpaths: ${r.checked} paths OK, ${mappedModules().length} modules mapped`);
  process.exit(bad ? 1 : 0);
}
