// P2-072: the Mixamo build names every clip by a unique slug, and the raw FBX never reach git (the Mixamo licence
// lets the game use the motion, not share the files): only converted resources are tracked.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, slug } from './mixamo_build.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

describe('mixamo_build', () => {
  it('slugs clip names', () => {
    expect(slug('Walking (1).fbx')).toBe('walking_1');
    expect(slug('Right Turn W_ Briefcase.fbx')).toBe('right_turn_w_briefcase');
  });

  it('scans categories and keeps names unique', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-'));
    for (const [cat, f] of [['walk', 'Walking.fbx'], ['idle', 'Walking.fbx'], ['idle', 'Breathing Idle.fbx'], ['idle', 'notes.txt']]) {
      fs.mkdirSync(path.join(dir, cat), { recursive: true });
      fs.writeFileSync(path.join(dir, cat, f), 'x');
    }
    const clips = scan(dir);
    expect(clips.map((c) => c.name).sort()).toEqual(['breathing_idle', 'idle_walking', 'walk_walking']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists every converted clip and tracks no raw FBX', () => {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/mixamo_clips.json'), 'utf8'));
    expect(idx.clips.length).toBe(161);
    expect(new Set(idx.clips.map((c) => c.name)).size).toBe(161);
    const tracked = execFileSync('git', ['ls-files', 'assets_inbox', 'game/characters'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    expect(tracked.filter((f) => /\.fbx$/i.test(f) || f.includes('mixamo_src/'))).toEqual([]);
    const ignored = execFileSync('git', ['check-ignore', 'assets_inbox/mixamo_probe.fbx', 'game/characters/mixamo_src/walk/walking.fbx'], { cwd: ROOT, encoding: 'utf8' });
    expect(ignored.trim().split('\n').length).toBe(2);
  });
});
