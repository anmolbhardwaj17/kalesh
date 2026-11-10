#!/usr/bin/env node
// Lane 2 (owner, 2026-10-10): a second builder works in .worktrees/lane2 on branch lane2, on UI and tooling tasks that
// never touch src/actors/** or physics, while the main builder works in the main checkout.
// Usage:
//   node harness/bin/lane.mjs sync     create the worktree, or move lane2 to the main HEAD when it has no unmerged work
//   node harness/bin/lane.mjs status   lane2 commits not yet in main, and uncommitted files in the worktree
//   node harness/bin/lane.mjs merge    merge lane2 into the main checkout (a normal merge commit, no history rewrite)
// Commit lane work inside the worktree: git -C .worktrees/lane2 add -A && git -C .worktrees/lane2 commit -m "..."
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, R } from './lib.mjs';

const sh = (c, cwd = ROOT) => execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const WT = R('.worktrees', 'lane2');
const cmd = process.argv[2] || 'status';
const exists = fs.existsSync(path.join(WT, '.git'));
const unmerged = () => (exists ? sh('git rev-list --count HEAD..lane2') : '0');
const dirty = () => (exists ? sh('git status --porcelain', WT) : '');

if (cmd === 'sync') {
  const head = sh('git rev-parse --short HEAD');
  if (!exists) {
    sh('git worktree prune');
    sh(`git worktree add -B lane2 "${WT}" ${head}`);
  } else {
    if (dirty()) { console.log(`LANE2 BUSY: uncommitted work in ${WT}`); process.exit(1); }
    if (unmerged() !== '0') { console.log(`LANE2 NOT MERGED: ${unmerged()} commits; run lane.mjs merge first`); process.exit(1); }
    sh(`git checkout -B lane2 ${head}`, WT);
  }
  const nm = path.join(WT, 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(R('node_modules'), nm, 'dir');
  console.log(`LANE2 ready at ${head} in ${WT}`);
} else if (cmd === 'status') {
  console.log(`lane2: ${unmerged()} commits not in main; ${dirty().split('\n').filter(Boolean).length} uncommitted files`);
} else if (cmd === 'merge') {
  if (dirty()) { console.log('LANE2 has uncommitted work; commit it in the worktree first'); process.exit(1); }
  if (unmerged() === '0') { console.log('nothing to merge'); process.exit(0); }
  try {
    const out = sh('git merge --no-ff lane2 -m "Merge lane2 into main\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"');
    console.log(`MERGED lane2\n${out.split('\n').slice(-3).join('\n')}`);
  } catch (e) {
    console.log(`MERGE FAILED: ${String(e.stdout || e.stderr || e.message).trim().split('\n').slice(-6).join('\n')}`);
    process.exit(1);
  }
} else { console.log('usage: lane.mjs sync|status|merge'); process.exit(2); }
