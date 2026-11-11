// Module size rule (TECH.md "Source layout", docs/ARCHITECTURE.md "Target module map"): a TypeScript file over 800
// lines fails. The old game's 4,065 line tile manager owned streaming, building, physics and cleanup at once; small
// files keep each module to one job. The GDScript side is game/tests/test_module_size.gd (600 lines).
//
// Files already over the limit go on EXCEPTIONS with the backlog task that splits or retires them. An entry that is
// back under the limit, or whose file is gone, fails too.
import { describe, expect, it } from 'vitest';

const LIMIT = 800;
// Repo-relative path -> [task id, why]. None today.
const EXCEPTIONS: Record<string, [string, string]> = {};
// Every TypeScript file of the tooling and the harness, read by vite at test time (keys are '/tools/...').
const SOURCES = import.meta.glob(['/tools/**/*.ts', '/harness/**/*.ts', '!**/node_modules/**', '!/tools/godot/**', '!/harness/reports/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const FILES = new Map(Object.entries(SOURCES).map(([k, v]) => [k.replace(/^\//, ''), v]));

export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const n = text.split('\n').length - 1;
  return text.endsWith('\n') ? n : n + 1;
}

describe('module size', () => {
  it('counts lines like wc -l plus a last line without a newline', () => {
    expect([lineCount(''), lineCount('a'), lineCount('a\n'), lineCount('a\nb'), lineCount('a\n\nb\n')]).toEqual([0, 1, 1, 2, 3]);
  });

  it(`no TypeScript file is over ${LIMIT} lines`, () => {
    expect(FILES.size).toBeGreaterThan(10);
    expect(FILES.has('tools/geo/projection.ts')).toBe(true); // vite leaves the importing file itself out
    const over = [...FILES]
      .map(([file, text]) => ({ file, lines: lineCount(text) }))
      .filter((r) => r.lines > LIMIT && !(r.file in EXCEPTIONS))
      .map((r) => `${r.file}: ${r.lines} lines, split it (one job per file)`);
    expect(over).toEqual([]);
  });

  it('every exception is still over the limit and names the task that splits or retires it', () => {
    const bad: string[] = [];
    for (const [file, [task, why]] of Object.entries(EXCEPTIONS)) {
      const text = FILES.get(file);
      if (text === undefined) bad.push(`${file}: the file is gone, take it off the list`);
      else if (lineCount(text) <= LIMIT) bad.push(`${file}: back under ${LIMIT} lines, take it off the list`);
      if (!/^P\d+-\d{3}$/.test(task) || why.length < 10) bad.push(`${file}: needs a task id and a reason`);
    }
    expect(bad).toEqual([]);
  });
});
