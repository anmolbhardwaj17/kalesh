import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { candidates, errorLines, findGodot, godotConfig, parseSums, releaseAsset, releaseUrl, toolsBinary, versionMatches } from './godot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('godot.mjs: pin and version', () => {
  it('kit.config.json pins 4.7.2.stable with the candidate list', () => {
    const c = godotConfig(ROOT);
    expect(c.version).toBe('4.7.2.stable');
    expect(c.release).toBe('4.7.2-stable');
    expect(c.project).toBe('game');
    expect(c.candidates).toEqual(['env GODOT', 'tools/godot/', '/Applications/Godot.app/Contents/MacOS/Godot']);
  });
  it('matches the full version string but not a neighbour version', () => {
    expect(versionMatches('4.7.2.stable.official.ed1daf0bf\n', '4.7.2.stable')).toBe(true);
    expect(versionMatches('4.7.2.stable', '4.7.2.stable')).toBe(true);
    expect(versionMatches('4.7.21.stable.official', '4.7.2.stable')).toBe(false);
    expect(versionMatches('4.7.2.rc1.official', '4.7.2.stable')).toBe(false);
    expect(versionMatches('4.6.1.stable.official', '4.7.2.stable')).toBe(false);
    expect(versionMatches('', '4.7.2.stable')).toBe(false);
  });
});

describe('godot.mjs: candidates', () => {
  it('orders env GODOT, then tools/godot/, then the macOS app', () => {
    const list = candidates({ env: { GODOT: '/x/godot' }, root: '/r', platform: 'darwin', arch: 'arm64', release: '4.7.2-stable' });
    expect(list.map((c) => c.source)).toEqual(['env GODOT', 'tools/godot/', '/Applications']);
    expect(list[1]?.path).toBe('/r/tools/godot/Godot.app/Contents/MacOS/Godot');
  });
  it('has no macOS app candidate on Windows and uses the console exe in tools/godot/', () => {
    const list = candidates({ env: {}, root: '/r', platform: 'win32', arch: 'x64', release: '4.7.2-stable' });
    expect(list.map((c) => c.source)).toEqual(['tools/godot/']);
    expect(list[0]?.path.endsWith('Godot_v4.7.2-stable_win64_console.exe')).toBe(true);
    expect(toolsBinary('/r', 'linux', 'x64', '4.7.2-stable')).toBe('/r/tools/godot/Godot_v4.7.2-stable_linux.x86_64');
  });
  it('picks the first candidate whose version matches and skips a wrong version', () => {
    const versions = { '/a': '4.6.1.stable.official', '/b': null, '/c': '4.7.2.stable.official.x' };
    const hit = findGodot({
      pin: '4.7.2.stable',
      list: [{ source: 'A', path: '/a' }, { source: 'B', path: '/b' }, { source: 'C', path: '/c' }],
      probe: (p) => versions[p] ?? null,
    });
    expect(hit.path).toBe('/c');
    expect(hit.tried).toHaveLength(3);
    const none = findGodot({ pin: '4.7.2.stable', list: [{ source: 'A', path: '/a' }], probe: (p) => versions[p] ?? null });
    expect(none.path).toBeNull();
  });
});

describe('godot.mjs: download pieces (no network)', () => {
  it('names the official release zips and URLs', () => {
    expect(releaseAsset('darwin', 'arm64', '4.7.2-stable')).toBe('Godot_v4.7.2-stable_macos.universal.zip');
    expect(releaseAsset('win32', 'x64', '4.7.2-stable')).toBe('Godot_v4.7.2-stable_win64.exe.zip');
    expect(releaseAsset('win32', 'arm64', '4.7.2-stable')).toBe('Godot_v4.7.2-stable_windows_arm64.exe.zip');
    expect(releaseAsset('linux', 'x64', '4.7.2-stable')).toBe('Godot_v4.7.2-stable_linux.x86_64.zip');
    expect(() => releaseAsset('aix', 'x64', '4.7.2-stable')).toThrow();
    expect(releaseUrl('4.7.2-stable', 'SHA512-SUMS.txt')).toBe('https://github.com/godotengine/godot/releases/download/4.7.2-stable/SHA512-SUMS.txt');
  });
  it('parses SHA512-SUMS.txt lines', () => {
    const h = 'a'.repeat(128);
    const m = parseSums(`${h}  Godot_v4.7.2-stable_win64.exe.zip\n${'B'.repeat(128)} *Godot_v4.7.2-stable_macos.universal.zip\nnot a line\n`);
    expect(m.get('Godot_v4.7.2-stable_win64.exe.zip')).toBe(h);
    expect(m.get('Godot_v4.7.2-stable_macos.universal.zip')).toBe('b'.repeat(128));
    expect(m.size).toBe(2);
  });
});

describe('godot.mjs: output checks', () => {
  it('flags ERROR and SCRIPT ERROR lines only', () => {
    const out = 'Godot Engine v4.7.2\nWARNING: something\nERROR: Cannot open file\n   SCRIPT ERROR: Parse Error: x\nall good\n';
    expect(errorLines(out)).toHaveLength(2);
    expect(errorLines('\x1b[91mERROR: coloured\x1b[0m\n')).toHaveLength(1);
    expect(errorLines('PASS projection origin\nFAIL nothing here\n')).toHaveLength(0);
  });
});

describe('godot.mjs: this machine', () => {
  it('--version prints the pin and the binary path, and tools/godot/ is gitignored', () => {
    const out = execFileSync('node', [path.join(ROOT, 'harness/bin/godot.mjs'), '--version', '--no-download'], { encoding: 'utf8' }).trim();
    const [ver, ...rest] = out.split(' ');
    expect(ver).toBe('4.7.2.stable');
    expect(fs.existsSync(rest.join(' '))).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toMatch(/^tools\/godot\/$/m);
  });
});
