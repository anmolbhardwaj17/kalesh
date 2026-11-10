#!/usr/bin/env node
// Dashboard notices (P2B-106): problems the owner should see on the "Needs you" tab, such as a failed git push.
//   node harness/bin/notice.mjs add "<text>"     adds a notice and prints its id
//   node harness/bin/notice.mjs resolve <id>     marks it resolved (it leaves the dashboard)
//   node harness/bin/notice.mjs list [--all]     prints the open notices (--all: resolved ones too)
// File: harness/state/notices.jsonl, one JSON line per notice: { id, ts, text, resolved } (resolvedAt once resolved).
// The dashboard (/api/state `notices`) shows the open ones at the top of "Needs you" and counts them in its badge.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, readJSONL, nowISO } from './lib.mjs';

/** Next id: N1, N2, ... one more than the highest id in the file. */
export function nextNoticeId(list) {
  let max = 0;
  for (const n of list) {
    const m = /^N(\d+)$/.exec(String(n?.id ?? ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `N${max + 1}`;
}

/** The list with a new open notice appended (text trimmed, whitespace folded). Throws on empty text. */
export function addNotice(list, text, ts = nowISO()) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('a notice needs text');
  const notice = { id: nextNoticeId(list), ts, text: clean, resolved: false };
  return { list: [...list, notice], notice };
}

/** The list with notice `id` resolved. Throws when no notice has that id. */
export function resolveNotice(list, id, ts = nowISO()) {
  const want = String(id).toUpperCase();
  if (!list.some((n) => String(n.id).toUpperCase() === want)) throw new Error(`no notice ${id}`);
  return list.map((n) => (String(n.id).toUpperCase() === want && !n.resolved ? { ...n, resolved: true, resolvedAt: ts } : n));
}

/** Open notices, newest first (what the dashboard shows). */
export function openNotices(list) {
  return list.filter((n) => n && !n.resolved && n.text).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

export function readNotices(file = PATHS.notices) {
  return readJSONL(file);
}

function writeNotices(list, file = PATHS.notices) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, list.map((n) => JSON.stringify(n)).join('\n') + (list.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const list = readNotices();
  if (cmd === 'add') {
    const { list: next, notice } = addNotice(list, rest.join(' '));
    writeNotices(next);
    console.log(`${notice.id} added: ${notice.text}`);
    return 0;
  }
  if (cmd === 'resolve') {
    if (!rest[0]) throw new Error('usage: notice.mjs resolve <id>');
    writeNotices(resolveNotice(list, rest[0]));
    console.log(`${rest[0].toUpperCase()} resolved`);
    return 0;
  }
  if (cmd === 'list') {
    const shown = rest.includes('--all') ? list : openNotices(list);
    if (!shown.length) console.log('no open notices');
    for (const n of shown) console.log(`${n.id}  ${n.ts}  ${n.resolved ? '[resolved] ' : ''}${n.text}`);
    return 0;
  }
  console.log(String(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')).split('\n').slice(1, 7).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  return cmd ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.log(`notice: ${e.message}`);
    process.exitCode = 1;
  }
}
