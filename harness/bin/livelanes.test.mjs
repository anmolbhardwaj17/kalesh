import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mainRootOf, laneRoot, scanReports, liveLanes, resolveLaneFile } from './livelanes.mjs';

let main;
const png = (p, ageSec = 0) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
  const t = new Date(Date.now() - ageSec * 1000);
  fs.utimesSync(p, t, t);
};
const rep = (lane, ...p) => path.join(main, lane === 'main' ? '' : path.join('.worktrees', lane), 'harness', 'reports', ...p);

beforeAll(() => {
  main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'livelanes-')));
  png(rep('main', 'shots', 'a.png'), 300);
  png(rep('main', 'shots', 'art_hidden.png'), 1);
  png(rep('main', 'shots', 'note.txt'), 1);
  png(rep('main', 'signs', 'sign1.jpg'), 10);
  png(rep('main', 'history', 'old.png'), 1);
  png(rep('main', 'flakecheck', 'raw.png'), 1);
  png(rep('main', 'flakecheck', 'shots', 'f.png'), 50);
  png(rep('main', 'arch', 'roads', 'r.png'), 20);
  for (let i = 0; i < 12; i++) png(rep('map', 'map', `m${i}.png`), 100 + i);
  png(rep('verify', 'shots', 'v.png'), 5);
  png(rep('lane2', 'shots', 'l.png'), 5);
  png(path.join(main, 'secret.png'), 9000);
  fs.symlinkSync(path.join(main, 'secret.png'), rep('main', 'shots', 'link.png'));
});
afterAll(() => fs.rmSync(main, { recursive: true, force: true }));

describe('live lanes (P2-066)', () => {
  it('finds the main checkout from a worktree', () => {
    expect(mainRootOf('/a/b/.worktrees/verify2')).toBe('/a/b');
    expect(mainRootOf('/a/b')).toBe('/a/b');
    expect(laneRoot('/a/b', 'map')).toBe('/a/b/.worktrees/map');
    expect(laneRoot('/a/b', 'main')).toBe('/a/b');
    expect(laneRoot('/a/b', '../x')).toBeNull();
  });

  it('scans shots and subfolders, newest first, images only, skipping heavy folders', () => {
    const names = scanReports(main).map((x) => x.name);
    expect(names).toEqual(['signs/sign1.jpg', 'arch/roads/r.png', 'flakecheck/shots/f.png', 'shots/a.png', 'shots/link.png']);
    expect(names[0]).toBe('signs/sign1.jpg');
    expect(names).not.toContain('shots/art_hidden.png');
    expect(names).not.toContain('shots/note.txt');
    expect(names.some((n) => n.startsWith('history/') || n === 'flakecheck/raw.png')).toBe(false);
  });

  it('caps each lane', () => {
    expect(scanReports(path.join(main, '.worktrees', 'map'), 8)).toHaveLength(8);
    expect(scanReports(path.join(main, 'nothing-here'))).toEqual([]);
  });

  it('labels lanes from agents.json and puts verifiers apart', () => {
    const agents = [
      { name: 'builder-main', lane: 'main', role: 'builder', task: 'P2-048', what: 'shop signs' },
      { name: 'builder-map', lane: 'map', role: 'builder', task: 'P2-032', what: 'tunnel fix' },
      { name: 'builder-ghost', lane: 'ghost', role: 'builder', task: 'P9', what: 'no folder' },
      { name: 'v', lane: 'lane2', role: 'verifier', task: 'P2-063', what: 'checking leads' },
    ];
    const { builders, verifiers } = liveLanes(main, agents, [{ name: 'look_proof/s/a.png', t: Date.now(), url: '/lshots/x' }]);
    expect(builders.map((b) => [b.lane, b.task, b.what])).toEqual([['main', 'P2-048', 'shop signs'], ['map', 'P2-032', 'tunnel fix']]);
    expect(builders[0].items[0].name).toBe('look_proof/s/a.png');
    expect(builders[1].items).toHaveLength(8);
    expect(builders[1].items[0].url).toBe('/lane/map/map/m0.png');
    expect(verifiers.map((v) => [v.lane, v.task])).toEqual([['lane2', 'P2-063'], ['verify', '']]);
  });

  it('main lane shows even with no agent', () => {
    const { builders } = liveLanes(main, []);
    expect(builders.map((b) => b.lane)).toEqual(['main']);
    expect(builders[0].task).toBe('');
  });

  describe('path guard', () => {
    it('serves images under harness/reports of main and worktrees', () => {
      expect(resolveLaneFile(main, 'main', 'shots/a.png')).toBe(rep('main', 'shots', 'a.png'));
      expect(resolveLaneFile(main, 'map', 'map/m1.png')).toBe(rep('map', 'map', 'm1.png'));
      expect(resolveLaneFile(main, 'main', 'signs/sign1.jpg')).toBeTruthy();
    });
    it('rejects everything else', () => {
      expect(resolveLaneFile(main, 'main', '../secret.png')).toBeNull();
      expect(resolveLaneFile(main, 'main', 'shots/../../../secret.png')).toBeNull();
      expect(resolveLaneFile(main, 'main', '/etc/passwd')).toBeNull();
      expect(resolveLaneFile(main, 'main', 'shots/note.txt')).toBeNull();
      expect(resolveLaneFile(main, 'main', 'shots/link.png')).toBeNull();
      expect(resolveLaneFile(main, 'main', 'shots/a.png\0')).toBeNull();
      expect(resolveLaneFile(main, 'main', 'shots\\a.png')).toBeNull();
      expect(resolveLaneFile(main, '..', 'secret.png')).toBeNull();
      expect(resolveLaneFile(main, '../..', 'x.png')).toBeNull();
      expect(resolveLaneFile(main, 'nope', 'shots/a.png')).toBeNull();
      expect(resolveLaneFile(main, 'map', 'missing.png')).toBeNull();
      expect(resolveLaneFile(main, 'main', 'shots')).toBeNull();
      expect(resolveLaneFile(main, '', 'shots/a.png')).toBeNull();
    });
  });
});
