#!/usr/bin/env node
// SessionStart hook (startup | resume | clear | compact).
// Prints plain text, which Claude Code adds to the main session's context.
// Written as factual project state, not as instructions.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no stdin */ }
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const run = (args) => {
  try { return execFileSync('node', [path.join(root, 'harness/bin/task.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }).trim(); }
  catch (e) { return `(task.mjs ${args.join(' ')} failed: ${String(e.message).split('\n')[0]})`; }
};
// Start the dashboard with the session if it is not running (port from harness/kit.config.json, default 4477).
let dash = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'harness/kit.config.json'), 'utf8'));
  const port = Number(process.env.HARNESS_DASHBOARD_PORT || cfg.dashboardPort || 4477);
  let up = false;
  try { execFileSync('curl', ['-s', '-o', '/dev/null', '--max-time', '1', `http://127.0.0.1:${port}/api/ping`], { timeout: 3000 }); up = true; } catch { /* not running */ }
  if (!up) {
    fs.mkdirSync(path.join(root, 'harness/reports'), { recursive: true });
    const out = fs.openSync(path.join(root, 'harness/reports/dashboard.log'), 'a');
    spawn(process.execPath, [path.join(root, 'harness/bin/dashboard.mjs')], { cwd: root, detached: true, stdio: ['ignore', out, out] }).unref();
  }
  dash = `Dashboard: http://localhost:${port}${up ? '' : ' (started now)'}`;
} catch { dash = 'Dashboard: not started (no harness/kit.config.json)'; }
let tail = '';
try { tail = fs.readFileSync(path.join(root, 'harness/state/journal.md'), 'utf8').trim().split('\n').filter((l) => l.startsWith('- ')).slice(-8).join('\n'); } catch { /* none */ }

const out = [
  `Project state at session ${input.source || 'start'} (from harness/bin/task.mjs status):`,
  run(['status']),
  dash,
  '',
  'Recent journal lines:',
  tail || '(empty)',
  '',
  'The orchestrator loop for this project is defined in CLAUDE.md under "The loop". Project state lives in harness/state/, so nothing is lost when context is compacted.',
].join('\n');
process.stdout.write(out + '\n');
