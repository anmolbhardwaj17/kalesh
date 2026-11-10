import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, checkCliArgs } from './lib.mjs';

const BIN = path.dirname(fileURLToPath(import.meta.url));
const KNOWN = ['region', 'no-build'];

describe('measuring tool flags (P5-057)', () => {
  it('goes on with known flags', () => {
    expect(checkCliArgs(parseArgs(['--region', 'den', '--no-build']), KNOWN, 'U').exit).toBeNull();
  });
  it('prints the usage on --help and -h', () => {
    expect(checkCliArgs(parseArgs(['--help']), KNOWN, 'U')).toEqual({ exit: 0, text: 'U' });
    expect(checkCliArgs(parseArgs(['-h']), KNOWN, 'U')).toEqual({ exit: 0, text: 'U' });
    expect(checkCliArgs(parseArgs(['--region', 'den', '--help']), KNOWN, 'U').exit).toBe(0);
  });
  it('refuses an unknown flag or a stray word', () => {
    const r = checkCliArgs(parseArgs(['--regoin', 'den']), KNOWN, 'U');
    expect(r.exit).toBe(2);
    expect(r.text).toContain('--regoin');
    expect(checkCliArgs(parseArgs(['storm_drains']), KNOWN, 'U').exit).toBe(2);
  });
  it('verify, gateretry and flakecheck print their usage on --help before building', () => {
    for (const tool of ['verify.mjs', 'gateretry.mjs', 'flakecheck.mjs']) {
      const r = spawnSync(process.execPath, [path.join(BIN, tool), '--help'], { encoding: 'utf8', timeout: 20000 });
      expect(r.status, tool).toBe(0);
      expect(r.stdout, tool).not.toContain('built in');
    }
  });
});
