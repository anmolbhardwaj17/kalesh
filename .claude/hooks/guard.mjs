#!/usr/bin/env node
// PreToolUse guard for Bash, Write and Edit. Defense in depth on top of auto mode.
// Exit 2 blocks the tool call and shows stderr to Claude. Exit 0 = no opinion.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const home = os.homedir();
const allowedRoots = [root, path.resolve(os.tmpdir()), '/tmp', '/private/tmp', '/var/folders', path.join(home, '.claude', 'projects'), input.scratchpad_dir].filter(Boolean).map((p) => path.resolve(p));
const inside = (p) => allowedRoots.some((r) => p === r || p.startsWith(r + path.sep));
const block = (msg) => { process.stderr.write(`Blocked by harness guard: ${msg}\n`); process.exit(2); };

const tool = input.tool_name;
const ti = input.tool_input || {};

if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
  const fp = ti.file_path || ti.notebook_path;
  if (fp) {
    const abs = path.resolve(root, String(fp).replace(/^~(?=$|\/)/, home));
    if (!inside(abs)) block(`writing outside the project (${abs}). Keep all work inside ${root}.`);
  }
  process.exit(0);
}

if (tool === 'Bash') {
  const cmd = String(ti.command || '');
  const c = cmd.replace(/\s+/g, ' ');
  if (/(^|[;&|(\s])sudo\s/.test(c)) block('sudo is not allowed. Find a way that does not need root.');
  if (/git\s+push\b[^;&|]*\s(--force\b|-f\b|--force-with-lease\b)/.test(c)) block('force push is not allowed.');
  if (/git\s+reset\s+--hard\b/.test(c)) block('git reset --hard destroys work. Use: git stash push -u -m "<task id> failed attempt" (recoverable).');
  if (/git\s+clean\s+-[a-zA-Z]*f/.test(c)) block('git clean -f deletes untracked files. Use git stash push -u instead.');
  if (/(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/.test(c)) block('piping downloads into a shell is not allowed.');
  if (/\bnpm\s+(i|install|add)\b[^;&|]*\s(-g|--global)\b/.test(c) || /\b(brew|port)\s+(install|uninstall|upgrade)\b/.test(c)) block('global installs are not allowed. Use project devDependencies (npm i -D) or npx.');
  // rm -r / -f on paths outside the project
  const rmRe = /(?:^|[;&|(]\s*|\s)rm\s+((?:-[a-zA-Z]+\s+)*)([^;&|]*)/g;
  let m;
  while ((m = rmRe.exec(c))) {
    const flags = m[1] || '';
    if (!/[rRf]/.test(flags)) continue;
    const targets = m[2].trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    for (let t of targets) {
      t = t.replace(/^['"]|['"]$/g, '');
      if (t === '/' || t === '~' || t === '*' || t === '.' || t === '..' || /^\$\{?HOME\}?/.test(t)) block(`refusing rm on "${t}".`);
      if (t.startsWith('$')) block(`refusing rm on an unresolved variable "${t}". Use the literal path inside the project.`);
      const abs = path.resolve(root, t.replace(/^~(?=$|\/)/, home));
      if (!inside(abs)) block(`refusing rm outside the project (${abs}).`);
      if (abs === root) block('refusing to delete the project root.');
      if (abs === path.join(root, '.git') || abs.startsWith(path.join(root, '.git') + path.sep)) block('refusing to delete .git.');
      if (abs.startsWith(path.join(root, 'harness', 'state'))) block('refusing to delete harness/state (project memory). Edit through task.mjs instead.');
    }
  }
  process.exit(0);
}

process.exit(0);
