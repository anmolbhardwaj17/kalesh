// The cache key of the shared pilot bake (P1-038 acceptance: a code change in tools/bake invalidates the shared bake).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashInputs } from './sharedbake.mjs';

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sharedbake-key-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put('tools/bake/main.ts', 'export const a = 1;\n');
  put('tools/bake/graph/build.ts', 'export const b = 1;\n');
  put('tools/bake/graph/build.test.ts', 'test\n');
  put('tools/geo/projection.ts', 'export const p = 1;\n');
  put('harness/data/districts.json', '{}\n');
  put('harness/data/milestones.json', '{}\n');
  put('data/SOURCES.json', JSON.stringify({ files: { osm: { sha256: 'aa' }, other: { sha256: 'bb' } } }));
  return { root, put };
}

describe('shared bake cache key', () => {
  it('the same inputs give the same key; a code, data or pin change gives another; a test, the milestones file or an unrelated pin does not', () => {
    const { root, put } = tempRoot();
    const key = () => hashInputs(root, ['osm']);
    const base = key();
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(key()).toBe(base);
    // not bake inputs
    put('tools/bake/graph/build.test.ts', 'a different test\n');
    put('harness/data/milestones.json', '{"x":1}\n');
    put('data/SOURCES.json', JSON.stringify({ files: { osm: { sha256: 'aa' }, other: { sha256: 'cc' } } }));
    expect(key()).toBe(base);
    // bake inputs
    put('tools/bake/graph/build.ts', 'export const b = 2;\n');
    const code = key();
    expect(code).not.toBe(base);
    put('tools/geo/projection.ts', 'export const p = 2;\n');
    const geo = key();
    expect(geo).not.toBe(code);
    put('harness/data/districts.json', '{"a":1}\n');
    const data = key();
    expect(data).not.toBe(geo);
    put('data/SOURCES.json', JSON.stringify({ files: { osm: { sha256: 'zz' } } }));
    expect(key()).not.toBe(data);
    put('tools/bake/new.ts', 'export {};\n');
    expect(key()).not.toBe(data);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
