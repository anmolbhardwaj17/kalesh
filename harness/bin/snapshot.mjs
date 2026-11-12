#!/usr/bin/env node
// Verify snapshot (owner, 2026-10-09): check a finished task on a frozen commit while the next builder
// works in the main checkout. Puts the worktree .worktrees/verify at the given commit (default HEAD), shares the main
// node_modules, and prints its path. The verifier runs verify.mjs and shoot.mjs from that folder, so its reports and
// screenshots stay in .worktrees/verify/harness/reports and never touch the main checkout.
// The full tile set (game/world/tiles/) is copied from the main checkout when it carries the commit's game/world/tiles.hash.
// Usage: node harness/bin/snapshot.mjs [<commit>] [--name verify2]   (--name: a second snapshot folder for the lane 2 verifier)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, R } from './lib.mjs';
import { provideTiles } from './tileset.mjs';

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
// The baked tiles are gitignored: the worktree gets the full set from the main checkout when its bake hash is the one this
// commit expects (game/world/tiles.hash), else the snapshot stops with the rebake message (P1-018).
const tiles = provideTiles(WT, ROOT);
if (!tiles.ok) { console.log(`SNAPSHOT ${sha} at ${WT} STOPPED: ${tiles.reason}`); process.exit(1); }
if (tiles.status !== 'none') console.log(`tiles: ${tiles.status} (${tiles.reason})`);
// A fresh worktree has no game/.godot import cache: without it the first lookproof run fails on every texture
// ("Unable to open res://.godot/imported/..."). Run the headless import there now (P0-036).
let imp = 'ok';
try { execSync('node harness/bin/godot.mjs check', { cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (e) { imp = 'FAILED'; process.stdout.write(String(e.stdout || '') + String(e.stderr || '')); }
console.log(`SNAPSHOT ${sha} at ${WT} (godot import ${imp})`);
if (imp !== 'ok') process.exitCode = 1;
