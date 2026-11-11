// Purity rule of the bake (docs/ARCHITECTURE.md "How the pieces fit"): tools/bake/main.ts and tools/bake/sources/
// are the only bake files that touch files or the network. Every other file under tools/bake/ is pure functions, so
// the same inputs give the same tiles and every step can be tested without a disk or a network.
import { describe, expect, it } from 'vitest';

// Every TypeScript file under tools/bake/, read by vite at test time (keys are '/tools/bake/...').
const FILES = import.meta.glob(['/tools/bake/**/*.ts'], { query: '?raw', import: 'default', eager: true });

/** Files allowed to touch files and the network. */
export const isDriver = (file: string): boolean => file === 'tools/bake/main.ts' || file.startsWith('tools/bake/sources/');

// Built from pieces so this file never matches its own patterns.
const NODE_IO = ['fs', 'fs/promises', 'net', 'http', 'https', 'http2', 'tls', 'dgram', 'child_process', 'worker_threads'];
const IMPORT_RE = new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|^\\s*import\\s+)['"](?:node:)?(${NODE_IO.map((m) => m.replace('/', '\\/')).join('|')})['"]`, 'm');
const FETCH_RE = new RegExp('(?<![\\w$])' + 'fe' + 'tch\\s*\\(');
const RANDOM_RE = new RegExp('Math\\.' + 'random\\s*\\(');

/** Source without block comments and whole-line comments (a URL inside a string keeps its //). */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

/** Why a pure bake file breaks the rule, or an empty list. */
export function impurities(text: string): string[] {
  const code = stripComments(text);
  const out: string[] = [];
  const m = IMPORT_RE.exec(code);
  if (m) out.push(`imports node:${m[1]}`);
  if (FETCH_RE.test(code)) out.push('calls fetch');
  if (RANDOM_RE.test(code)) out.push('calls Math.random (use tools/bake/rand.ts)');
  return out;
}

describe('bake purity', () => {
  it('the checker catches each kind of impurity and lets pure code through', () => {
    const q = "'";
    expect(impurities(`import fs from ${q}node:fs${q};`)).toEqual(['imports node:fs']);
    expect(impurities(`import { readFileSync } from ${q}fs${q};`)).toEqual(['imports node:fs']);
    expect(impurities(`const n = await import(${q}node:net${q});`)).toEqual(['imports node:net']);
    expect(impurities(`import * as h from "node:http";`)).toEqual(['imports node:http']);
    expect(impurities(`const r = await ${'fe'}tch(url);`)).toEqual(['calls fetch']);
    expect(impurities(`const r = await net.${'fe'}tch(url);`)).toEqual(['calls fetch']);
    expect(impurities(`const v = Math.${'random'}();`)).toEqual(['calls Math.random (use tools/bake/rand.ts)']);
    expect(impurities(`// we never ${'fe'}tch( here\nconst a = prefetch(1); const b = fetchRetry;`)).toEqual([]);
    expect(impurities(`import { sha } from ${q}./pins.ts${q}; import path from ${q}node:path${q};`)).toEqual([]);
  });

  it('only main.ts and sources/ touch files or the network', () => {
    const keys = Object.keys(FILES).map((k) => k.replace(/^\//, ''));
    expect(keys).toContain('tools/bake/main.ts');
    expect(keys.some((k) => k.startsWith('tools/bake/sources/'))).toBe(true);
    expect(keys.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const [key, text] of Object.entries(FILES)) {
      const file = key.replace(/^\//, '');
      if (isDriver(file)) continue;
      for (const why of impurities(text)) bad.push(`${file}: ${why}`);
    }
    expect(bad).toEqual([]);
  });

  it('the drivers really are the ones doing the work (the rule is not vacuous)', () => {
    const main = FILES['/tools/bake/main.ts'] ?? '';
    const stage = FILES['/tools/bake/sources/pinfile.ts'] ?? '';
    expect(impurities(main)).toContain('imports node:fs');
    expect(impurities(stage)).toContain('imports node:fs');
  });
});
