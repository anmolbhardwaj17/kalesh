// P2B-033: every src/ path the design docs and the module map name exists, and every look and life module is mapped.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The design docs start as kit templates whose src/ paths are examples; the path check bites once ADOPT fills them in
// (TECH.md no longer starts with the template marker).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = (() => { try { return fs.readFileSync(path.join(ROOT, 'harness/design/TECH.md'), 'utf8').includes('<!-- Template.'); } catch { return true; } })();
import { checkDocs, docPaths, pathExists, shortCandidates, mappedModules } from './docpaths.mjs';

describe('doc paths (P2B-033)', () => {
  it.skipIf(TEMPLATE)('every src/ path in ARCHITECTURE, READ_MAP, TECH, VERIFY, STYLE_BIBLE and GAME exists', () => {
    const r = checkDocs();
        expect(r.missing.map((m) => `${m.doc}:${m.line} ${m.path}`)).toEqual([]);
  });

  it('every module under MAPPED_DIRS has an ARCHITECTURE row and a READ_MAP line', () => {
    const r = checkDocs();
        expect(r.unmappedArch).toEqual([]);
    expect(r.unmappedReadMap).toEqual([]);
  });

  it('reads full paths, short sibling names in a list, and skips templates', () => {
    const got = docPaths('Source: `src/render/grade.ts`, `gradePass.ts` and `glare.ts`; data `src/data/bake/<region>.<time>.bin`, `src/missions/defs/Mxx.ts`.');
    expect(got.map((g) => g.path)).toEqual(['src/render/grade.ts', 'src/render/gradePass.ts', 'src/render/glare.ts']);
    // Prose between a path and a name ends the list: `noise.ts` here is not read as src/render/noise.ts.
    expect(docPaths('`src/render/flicker.ts` feeds the gem through `noise.ts`').map((g) => g.path)).toEqual(['src/render/flicker.ts']);
    // A harness path ends a src list.
    expect(docPaths('`src/render/ao.ts`, `harness/bin/aocheck.mjs`, `ao.test.ts`').map((g) => g.path)).toEqual(['src/render/ao.ts']);
  });

  it('bites: a planted dead path and a dead short name are found', () => {
    expect(pathExists('src/render/noSuchModule.ts')).toBe(false);
    expect(shortCandidates('src/world/levels/harbor', 'lab.ts')).toEqual([
      'src/world/levels/harbor/lab.ts',
      'src/world/levels/lab.ts',
      'src/world/lab.ts',
      'src/lab.ts',
    ]);
    const planted = docPaths('| `src/render/volumes.ts`, `volumez.ts` | shafts |');
    expect(planted.map((p) => p.path)).toEqual(['src/render/volumes.ts', 'src/render/volumez.ts']);
    expect(planted.filter((p) => !pathExists(p.path)).map((p) => p.path)).toContain('src/render/volumez.ts');
  });
});
