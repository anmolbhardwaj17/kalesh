import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { taskIds, pickVerified, readCopies } from './playcopy.mjs';

const c = (sha, subject) => ({ sha, subject });

describe('playcopy (P4-073)', () => {
  it('reads task ids from a commit subject', () => {
    expect(taskIds('[P4-091][P4-092] Glare targets (verifying)')).toEqual(['P4-091', 'P4-092']);
    expect(taskIds('P4-071 done; P4-091..093 added')).toEqual([]);
    expect(taskIds('[P2B-108] cpu cap')).toEqual(['P2B-108']);
  });

  it('picks the newest verified commit and the state commits after it, stopping before an unverified task commit', () => {
    const status = (id) => ({ 'T-A': 'done', 'T-B': 'doing', 'T-C': 'done', 'T-D': 'todo' })[id] || 'done';
    const log = [
      c('7', 'D verifying; next start'),
      c('6', '[T-D] new work (verifying)'),
      c('5', 'state'),
      c('4', '[T-B] failed attempt (verifying)'),
      c('3', 'C done'),
      c('2', '[T-C] work (verifying)'),
      c('1', '[T-A] old work'),
    ];
    expect(pickVerified(log, status).sha).toBe('3');
    // Everything settled: the newest commit.
    expect(pickVerified(log, () => 'done').sha).toBe('7');
    // No verified task commit at all.
    expect(pickVerified([c('2', '[T-B] x'), c('1', 'state')], status)).toBeNull();
    // A pending commit older than the newest verified one does not hold the copy back: that tree passed with it.
    expect(pickVerified([c('3', 'state'), c('2', '[T-C] y'), c('1', '[T-B] x')], status).sha).toBe('3');
  });

  it('lists only copies that still have a game/project.godot, current first', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playcopy-'));
    try {
      expect(readCopies(root)).toEqual([]);
      for (const s of ['bbb', 'aaa']) { fs.mkdirSync(path.join(root, s, 'game'), { recursive: true }); fs.writeFileSync(path.join(root, s, 'game', 'project.godot'), ''); }
      fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ sha: 'bbb', copies: [{ sha: 'bbb' }, { sha: 'gone' }, { sha: 'aaa' }] }));
      expect(readCopies(root).map((x) => x.sha)).toEqual(['bbb', 'aaa']);
      expect(readCopies(root)[0].project).toBe(path.join(root, 'bbb', 'game'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
