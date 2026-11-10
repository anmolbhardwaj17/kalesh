#!/usr/bin/env node
// Verify snapshot (owner, 2026-10-09): check a finished task on a frozen commit while the next builder
// works in the main checkout. Puts the worktree .worktrees/verify at the given commit (default HEAD), shares the main
// node_modules, and prints its path. The verifier runs verify.mjs and shoot.mjs from that folder, so its reports and
// screenshots stay in .worktrees/verify/harness/reports and never touch the main checkout.
// Usage: node harness/bin/snapshot.mjs [<commit>] [--name verify2]   (--name: a second snapshot folder for the lane 2 verifier)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, R } from './lib.mjs';

const sh = (c, cwd = ROOT) => execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const argv = process.argv.slice(2);
const ni = argv.indexOf('--name');
const name = ni >= 0 ? argv.splice(ni, 2)[1] : 'verify';
const sha = sh(`git rev-parse --short ${argv[0] || 'HEAD'}`);
const WT = R('.worktrees', name);
if (!fs.existsSync(path.join(WT, '.git'))) { sh('git worktree prune'); sh(`git worktree add --detach "${WT}" ${sha}`); }
else sh(`git checkout --detach --force ${sha}`, WT);
const nm = path.join(WT, 'node_modules');
if (!fs.existsSync(nm)) fs.symlinkSync(R('node_modules'), nm, 'dir');
console.log(`SNAPSHOT ${sha} at ${WT}`);
