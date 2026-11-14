#!/usr/bin/env node
// Agents now (owner 2026-11-14): who is working, one line each, shown on the dashboard overview page.
//   node harness/bin/agents.mjs set <name> --lane <main|map|lane2|verify|verify2> --role <builder|verifier|helper> --task <id> --what "<one line>"
//   node harness/bin/agents.mjs clear <name>
//   node harness/bin/agents.mjs list
// File: harness/state/agents.json (live state, not committed): { agents: [{ name, lane, role, task, what, since }] }.
// `since` is when the agent was first set for that task; setting the same name and task again keeps it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, nowISO } from './lib.mjs';

export const LANES = ['main', 'map', 'lane2', 'verify', 'verify2'];
export const ROLES = ['builder', 'verifier', 'helper'];

export function readAgents(file = PATHS.agents) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v?.agents) ? v.agents.filter((a) => a && a.name) : [];
  } catch { return []; }
}

function writeAgents(list, file = PATHS.agents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ agents: list }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const fold = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The list with `name` set (added, or replaced in place). Throws on a missing name or a lane or role that is not known. */
export function setAgent(list, name, opts, ts = nowISO()) {
  const n = fold(name);
  if (!n) throw new Error('an agent needs a name');
  const lane = fold(opts.lane) || 'main';
  const role = fold(opts.role) || 'builder';
  if (!LANES.includes(lane)) throw new Error(`lane must be one of ${LANES.join(', ')}`);
  if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(', ')}`);
  const task = fold(opts.task);
  const prev = list.find((a) => a.name === n);
  const entry = { name: n, lane, role, task, what: fold(opts.what), since: prev && prev.task === task ? prev.since : ts };
  return { list: prev ? list.map((a) => (a.name === n ? entry : a)) : [...list, entry], agent: entry };
}

/** The list without `name`. Throws when it is not there. */
export function clearAgent(list, name) {
  const n = fold(name);
  if (!list.some((a) => a.name === n)) throw new Error(`no agent ${n}`);
  return list.filter((a) => a.name !== n);
}

/** Parses `--key value` pairs after the positional words. */
export function parseArgs(argv) {
  const pos = []; const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { opts[argv[i].slice(2)] = argv[i + 1] ?? ''; i++; } else pos.push(argv[i]);
  }
  return { pos, opts };
}

function main(argv) {
  const { pos, opts } = parseArgs(argv);
  const [cmd, name] = pos;
  const list = readAgents();
  if (cmd === 'set') {
    const { list: next, agent } = setAgent(list, name, opts);
    writeAgents(next);
    console.log(`${agent.name} set: ${agent.role}, ${agent.lane} lane, ${agent.task || 'no task'}, ${agent.what}`);
    return 0;
  }
  if (cmd === 'clear') {
    writeAgents(clearAgent(list, name));
    console.log(`${name} cleared`);
    return 0;
  }
  if (cmd === 'list') {
    if (!list.length) console.log('no agents running');
    for (const a of list) console.log(`${a.name}  ${a.role}  ${a.lane}  ${a.task}  ${a.what}  since ${a.since}`);
    return 0;
  }
  console.log(String(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')).split('\n').slice(1, 6).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  return cmd ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.log(`agents: ${e.message}`);
    process.exitCode = 1;
  }
}
