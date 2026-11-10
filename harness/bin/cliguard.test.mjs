import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';
import { closeMatches, unknownNames, checkVerifyArgs, checkFlakeArgs, VERIFY_BOOLEANS, FLAKE_BOOLEANS, scenarioNames, milestoneIds } from './cliguard.mjs';

const BIN = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(BIN, '..', '..');
const SCEN = ['move_seq_camera_jump', 'move_seq_sprint', 'test_street_day', 'test_street_night_rain', 'hero_face'];
const MIS = ['CUT', 'M01', 'M02', 'M20', 'TEST'];
const v = (argv) => checkVerifyArgs(parseArgs(argv, { booleans: VERIFY_BOOLEANS }), { scenarios: SCEN, milestones: MIS });
const f = (argv) => checkFlakeArgs(parseArgs(argv, { booleans: FLAKE_BOOLEANS }), { scenarios: SCEN, milestones: MIS });

describe('verify and flakecheck name checks (P5-089)', () => {
  it('finds close matches by containment, case and small typos', () => {
    expect(closeMatches('camera_jump', SCEN)[0]).toBe('move_seq_camera_jump');
    expect(closeMatches('m20', MIS)[0]).toBe('M20');
    expect(closeMatches('hero_fcae', SCEN)).toContain('hero_face');
    expect(closeMatches('zzzzzzzzzz', SCEN)).toEqual([]);
  });
  it('matches prefixes and names exactly', () => {
    expect(unknownNames(['test_street*', 'hero_face'], SCEN)).toEqual([]);
    expect(unknownNames(['camera_jump', 'nope*'], SCEN).map((u) => u.name)).toEqual(['camera_jump', 'nope*']);
  });
  it('lets good runs through', () => {
    expect(v([]).exit).toBeNull();
    expect(v(['--quick']).exit).toBeNull();
    expect(v(['--only', 'move_seq_camera_jump,test_street*', '--no-build', '--jobs', '2']).exit).toBeNull();
    expect(v(['--milestone', 'M01,M20', '--no-build', '--no-checks', '--report', 'x.json']).exit).toBeNull();
    expect(v(['--all', '--dry']).exit).toBeNull();
  });
  it('refuses an unknown --only name and names the close match', () => {
    const r = v(['--only', 'camera_jump']);
    expect(r.exit).toBe(2);
    expect(r.text).toContain('unknown scenario "camera_jump"; close matches: move_seq_camera_jump');
    expect(v(['--only', 'move_seq_sprint,nope*']).text).toContain('"nope*"');
  });
  it('refuses a space separated milestone list and says to use commas', () => {
    const r = v(['--milestone', 'M01', 'M20']);
    expect(r.exit).toBe(2);
    expect(r.text).toContain('use --milestone M01,M20');
    expect(v(['--only', 'hero_face', 'move_seq_sprint']).text).toContain('use --only hero_face,move_seq_sprint');
    expect(v(['--no-build', 'hero_face']).text).toContain('unknown word: hero_face');
  });
  it('refuses an unknown milestone, an empty list and an unknown flag', () => {
    expect(v(['--milestone', 'M99']).text).toContain('unknown milestone "M99"');
    expect(v(['--milestone', 'm20']).text).toContain('close matches: M20');
    expect(v(['--milestone']).exit).toBe(2);
    expect(v(['--only=']).exit).toBe(2);
    expect(v(['--quikc']).text).toContain('close matches: --quick');
  });
  it('flakecheck refuses unknown scenarios, milestones, load-set names and flags; space or comma lists both work', () => {
    expect(f(['move_seq_sprint', 'M01,hero_face', '--runs', '5', '--no-build']).exit).toBeNull();
    expect(f(['M01', '--no-build', 'hero_face']).exit).toBeNull();
    const r = f(['camera_jump', 'M99']);
    expect(r.exit).toBe(2);
    expect(r.text).toContain('move_seq_camera_jump');
    expect(r.text).toContain('unknown milestone "M99"');
    expect(f(['hero_face', '--load-set', 'hero_face,nope']).text).toContain('--load-set: unknown scenario "nope"');
    expect(f(['hero_face', '--rnus', '5']).text).toContain('--runs');
  });
  it('reads the real scenario and milestone lists', () => {
    expect(scenarioNames(ROOT)).toContain('hooks_contract');
    expect(Array.isArray(milestoneIds(ROOT))).toBe(true);
  });
  it('verify.mjs and flakecheck.mjs exit 2 before building', () => {
    const run = (tool, a) => spawnSync(process.execPath, [path.join(BIN, tool), ...a], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    for (const [tool, a, want] of [
      ['verify.mjs', ['--only', 'hooks_contrac'], 'hooks_contract'],
      ['verify.mjs', ['--milestone', 'L01', 'L20'], 'use --milestone L01,L20'],
      ['flakecheck.mjs', ['hooks_contrac', '--runs', '5'], 'hooks_contract'],
    ]) {
      const r = run(tool, a);
      expect(r.status, `${tool} ${a.join(' ')}`).toBe(2);
      expect(r.stdout).toContain(want);
      expect(r.stdout).toContain('nothing run');
      expect(r.stdout).not.toContain('built in');
    }
  });
});
