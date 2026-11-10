#!/usr/bin/env node
// Harness task CLI: the only writer of harness/state/backlog.json.
// Run with no arguments for help.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { PATHS, ROOT, config, readJSON, writeJSON, readJSONL, appendJSONL, appendJournal, nowISO, git, parseArgs, splitList, treeHash } from './lib.mjs';
import { loadMilestones, scriptIds, phaseRequired, requiredMilestones, milestoneReasons } from './milestoneset.mjs';
import { ensureAllCopy, fullRunReasons, decideRetry, failedItems, changedSince, loadSharedPaths, retryFile } from './gatecheck.mjs';

const HELP = `Harness task CLI

  status [--json]                 Compact state: phase, counts, next task, inbox, blocked
  next                            Print the next task to work on, or a sentinel:
                                    RESUME <id>                a task was left in progress
                                    PHASE_NEEDS_PLANNING <P>   active phase has no tasks: spawn planner
                                    PHASE_GATE <P>             all tasks done: run the phase gate
                                    STUCK <P>                  only blocked/waiting tasks remain
                                    ALL_PHASES_DONE            run: task.mjs gate --final
  show <id>                       Full task JSON
  start <id>                      Mark doing (attempts += 1)
  done <id> --summary "..."       Mark done, journal it
  fail <id> --reason "..."        Back to todo with the reason (3rd failure => blocked)
  block <id> --reason "..."       Mark blocked
  unblock <id> [--note "..."]     Back to todo, attempts reset
  skip <id> --reason "..."        Mark skipped (counts as done for deps and gates)
  note <id> "text"                Append a note to a task
  deps <id> [--add a,b] [--remove c]  Add or remove dependencies of an existing task
  move <id> --phase P7 [--priority 4]  Move an open task to another phase (id kept)
  order <id,id,...>               Explicit order among tasks of the same phase and priority
  planned <P>                     Mark a phase as planned (end of PLAN_PHASE); until then next prints PHASE_NEEDS_PLANNING
  add --phase P2 --title "..." --desc "..." [--accept "a|b|c"] [--deps P2-001,P2-002]
      [--agent builder|planner|content-writer|art-director] [--priority 1-5] [--kind feature|bug|polish|mentor|art|content] [--model fable]
  add-json <file>                 Add many tasks: [{phase,title,desc,accept[],deps[],agent,priority,kind,model?}]
  phase-add --id P8 --name "..." --goal "..." [--exit "a|b"] [--milestones L05,L06] [--after P7]
  phase-done <P>                  Close a phase (all tasks done/skipped) and activate the next
  playtest <P> "item|item|..."    Set the playtest checklist the owner sees for a phase
  inbox [--all]                   Unacknowledged mentor messages (all with --all)
  inbox-add "text" [--source terminal]   Record a mentor message typed in the terminal
  inbox-ack <id> --reply "..." [--tasks P2-010,P2-011]
  milestone <ID> <planned|building|playable|polished> [--note "..."]   (alias: mission)
  signoff "<the owner's exact words>"   Phase 0: record the owner's style sign-off (needed by gate P0)
  archsignoff "<the owner's exact words>"   Phase 0: record the owner's architecture sign-off (needed by gate P0)
  gate <P>                        Check a phase gate (tasks + the phase's full verify report, or a retry of what it failed:
                                    harness/bin/gatecheck.mjs, gateretry.mjs). Milestones counted: the required ones
                                    of this phase and every earlier phase, plus optional ones with a play script (milestoneset.mjs)
  gate --final                    Prints ALL GATES PASSED when the whole game is done (every phase, every counted milestone)
  model <id> <fable|opus|sonnet|none>   Tag a task with its model tier (shown as MODEL <name> in show and next)
  log "text"                      Append a line to the journal
`;

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

function loadBacklog() { return readJSON(PATHS.backlog); }
function saveBacklog(b) { b.updated = nowISO(); writeJSON(PATHS.backlog, b); }
function loadState() { return readJSON(PATHS.state, {}); }
function saveState(patch) { const s = { ...loadState(), ...patch, updated: nowISO() }; writeJSON(PATHS.state, s); return s; }

const DONEISH = new Set(['done', 'skipped']);
function phaseIndex(b, pid) { return b.phases.findIndex((p) => p.id === pid); }
function activePhase(b) { return b.phases.find((p) => p.status !== 'done') || null; }
function taskById(b, id) {
  const t = b.tasks.find((x) => x.id === id);
  if (!t) { console.error(`No task ${id}`); process.exit(2); }
  return t;
}
function depsDone(b, t) { return (t.deps || []).every((d) => { const x = b.tasks.find((y) => y.id === d); return x && DONEISH.has(x.status); }); }
function nextId(b, phase) {
  // Match by id prefix, not phase: a task moved to another phase keeps its id, so a phase filter reused ids (P7-097 twice, 2026-10-16).
  const nums = b.tasks.filter((t) => t.id.startsWith(phase + '-')).map((t) => parseInt(t.id.slice(phase.length + 1), 10)).filter((n) => !isNaN(n));
  return `${phase}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

function computeNext(b) {
  const doing = b.tasks.find((t) => t.status === 'doing');
  if (doing) return { sentinel: 'RESUME', task: doing };
  const ap = activePhase(b);
  if (!ap) return { sentinel: 'ALL_PHASES_DONE' };
  const apIdx = phaseIndex(b, ap.id);
  const eligible = b.tasks.filter((t) => t.status === 'todo' && phaseIndex(b, t.phase) <= apIdx && depsDone(b, t));
  // Bugs go before features of the same priority (owner, 2026-10-10); an explicit order field breaks ties before the id.
  const bugFirst = (t) => (t.kind === 'bug' ? 0 : 1);
  eligible.sort((x, y) => (phaseIndex(b, x.phase) - phaseIndex(b, y.phase)) || ((x.priority ?? 3) - (y.priority ?? 3)) || (bugFirst(x) - bugFirst(y)) || ((x.order ?? 1e9) - (y.order ?? 1e9)) || x.id.localeCompare(y.id));
  // A phase is planned once the planner marks it (task.mjs planned <P>); carry-over tasks moved into a later phase do not count as its plan.
  if (ap.planned === false) return { sentinel: 'PHASE_NEEDS_PLANNING', phase: ap };
  if (eligible.length) return { sentinel: null, task: eligible[0] };
  const phaseTasks = b.tasks.filter((t) => t.phase === ap.id && t.status !== 'skipped'); // skipped tasks (moved elsewhere) do not count as a plan
  if (phaseTasks.length === 0) return { sentinel: 'PHASE_NEEDS_PLANNING', phase: ap };
  const open = b.tasks.filter((t) => phaseIndex(b, t.phase) <= apIdx && !DONEISH.has(t.status));
  if (open.length === 0) return { sentinel: 'PHASE_GATE', phase: ap };
  return { sentinel: 'STUCK', phase: ap, open };
}

function fmtTask(t) {
  const lines = [
    `TASK ${t.id}  [${t.phase}] ${t.title}`,
    `agent: ${t.agent || 'builder'}   kind: ${t.kind || 'feature'}   priority: ${t.priority ?? 3}   attempts: ${t.attempts || 0}   status: ${t.status}${t.model ? `   MODEL ${t.model}` : ''}`,
    `deps: ${(t.deps || []).join(', ') || '-'}`,
    '', t.desc || '', '',
    'Acceptance criteria:',
    ...(t.accept || []).map((a, i) => `  ${i + 1}. ${a}`),
  ];
  if (t.notes?.length) lines.push('', 'Notes / previous attempts:', ...t.notes.slice(-6).map((n) => `  - ${n}`));
  return lines.join('\n');
}

function unackedInbox() {
  const acked = new Set(readJSONL(PATHS.inboxAcks).map((a) => a.id));
  return readJSONL(PATHS.inbox).filter((m) => !acked.has(m.id));
}

function latestReport() { return readJSON(PATHS.reportLatest, null); }

function srcCommitTime() {
  const t = git(`log -1 --format=%ct -- ${config().srcDir || 'src'}`);
  return t ? parseInt(t, 10) * 1000 : 0;
}

// Gates count the required milestones of the phase and every earlier phase, plus optional ones with a play script
// (harness/bin/milestoneset.mjs).
function milestoneIdsInPhase(b, phase) { return phaseRequired(b.phases, phase.id, loadMilestones(), scriptIds()); }

function checkReport(missionIds, label) {
  const reasons = [];
  const rep = latestReport();
  if (!rep) { reasons.push('No verify report yet: run node harness/bin/verify.mjs --all'); return reasons; }
  if (rep.mode !== 'all') reasons.push(`Latest report is mode "${rep.mode}", the gate needs a full run (verify.mjs --all)`);
  if (!rep.ok) reasons.push(`Latest report is not ok: ${rep.failReason || 'see harness/reports/latest.json'}`);
  if ((rep.consoleErrors || []).length) reasons.push(`${rep.consoleErrors.length} console error(s) in the latest report`);
  const repTime = Date.parse(rep.finishedAt || rep.startedAt || 0);
  const srcT = srcCommitTime();
  if (srcT && repTime < srcT) reasons.push('Latest report is older than the last commit touching src/: re-run verify.mjs --all');
  reasons.push(...milestoneReasons(missionIds, rep.milestones || {}, label, scriptIds()));
  return reasons;
}

// Phase gate paths (P4-101): the saved --all report for the phase passes on its own, or a retry of what it failed passes
// when the fix touches no shared-system path (harness/bin/gatecheck.mjs). Prints which path it used and why.
function gatePath(pid, missionIds) {
  const { rep: all, file, saved } = ensureAllCopy(pid);
  const mr = (res) => milestoneReasons(missionIds, res, pid, scriptIds());
  const rel = (f) => path.relative(ROOT, f);
  const info = [];
  if (!all) return { reasons: ['No full verify report for this phase: run node harness/bin/verify.mjs --all'], info: ['  path: none (no --all report in latest.json or reports/history)'], via: '' };
  info.push(`  full run: ${rel(file)}${saved ? ' (saved now)' : ''}, commit ${all.commit}, ${all.startedAt}, ${all.ok ? 'OK' : 'FAIL'}`);
  const full = fullRunReasons(all, { srcCommitMs: srcCommitTime(), missionReasonsFn: mr });
  if (!full.length) { info.push('  path: full run (it passed and is newer than the last src/ commit)'); return { reasons: [], info, via: 'via the full run' }; }
  const { items } = failedItems(all);
  info.push(`  full run failed on: ${items.length ? items.map((i) => i.id).join(', ') : 'nothing named'}`);
  const retry = readJSON(retryFile(pid), null);
  const changed = changedSince(all.commit);
  const dec = decideRetry({ all, retry, changed: changed ?? [], shared: loadSharedPaths(), tree: retry ? treeHash() : null, missionReasonsFn: mr, phase: pid });
  if (changed === null) { dec.ok = false; dec.reasons.unshift(`(c) cannot diff from the full run's commit ${all.commit}: run verify --all`); }
  if (dec.ok) {
    info.push(`  path: retry (${rel(retryFile(pid))}, commit ${retry.commit}): ${changed.length} file(s) changed since ${all.commit}, none shared`);
    for (const l of dec.retried) info.push(`    retried ${l}`);
    info.push(`    verify --quick ok; ${Object.keys(retry.missions.results).length} milestones ok`);
    return { reasons: [], info, via: 'via the retry' };
  }
  info.push(dec.sharedFiles.length
    ? `  path: full run needed: the fix touches shared files: ${dec.sharedFiles.join(', ')}`
    : `  path: retry not proven yet (${changed ? `${changed.length} file(s) changed since ${all.commit}, none shared` : 'no diff'})`);
  return { reasons: [...full.map((r) => `full run: ${r}`), ...dec.reasons.map((r) => `retry: ${r}`)], info, via: '' };
}

// The orchestrator's Claude Code log: every turn resends it, so a big one burns usage (a 59 MB one froze the
// terminal on 2026-10-13). Past 15 MB, suggest a fresh session; all state lives in files.
function sessionLogHint(limitMB = 15) {
  try {
    const dir = path.join(os.homedir(), '.claude', 'projects', ROOT.replace(/[^A-Za-z0-9]/g, '-'));
    const logs = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => fs.statSync(path.join(dir, f)));
    const newest = logs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    const mb = newest ? newest.size / 1024 / 1024 : 0;
    return mb > limitMB ? [`session log: ${mb.toFixed(0)} MB, over ${limitMB} MB: finish the current task, then start a fresh session (/clear, then /goal again)`] : [];
  } catch { return []; }
}

function print(s) { process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }

switch (cmd) {
  case undefined: case 'help': case '--help': print(HELP); break;

  case 'status': {
    // Keep Claude's temp screenshots for this repo under the cap (prints only when it deletes).
    try { spawnSync(process.execPath, [path.join(ROOT, 'harness/bin/tmpclean.mjs'), '--quiet'], { stdio: 'inherit', timeout: 60000 }); } catch {}
    const b = loadBacklog();
    const ap = activePhase(b);
    const count = (st) => b.tasks.filter((t) => t.status === st).length;
    const nx = computeNext(b);
    const inbox = unackedInbox();
    const blocked = b.tasks.filter((t) => t.status === 'blocked');
    const st = loadState();
    const rep = latestReport();
    const assets = readJSON(PATHS.reqAssets, { requests: [] }).requests || [];
    const intents = assets.filter((a) => !a.prompt).length;
    const sinceArt = st.tasksDoneSinceArtPass || 0;
    // Delivered images whose current file has no review yet (new upload or a replacement after a review).
    const man = readJSON(PATHS.manifest, { images: {} });
    const unreviewed = assets.filter((a) => { const m = man.images?.[a.id]; return m && (!a.review?.ingestedAt || Date.parse(a.review.ingestedAt) < Date.parse(m.ingestedAt || 0)); }).length;
    const out = {
      phase: ap ? `${ap.id} ${ap.name}` : 'ALL DONE',
      tasks: { todo: count('todo'), doing: count('doing'), done: count('done'), blocked: count('blocked'), skipped: count('skipped') },
      next: nx.sentinel ? `${nx.sentinel}${nx.phase ? ' ' + nx.phase.id : ''}${nx.task ? ' ' + nx.task.id : ''}` : `${nx.task.id} ${nx.task.title}`,
      inbox_unacked: inbox.length,
      blocked: blocked.map((t) => `${t.id} ${t.title}`),
      last_verify: rep ? `${rep.mode} ${rep.ok ? 'OK' : 'FAIL'} at ${rep.finishedAt}` : 'none',
      art_pass_due: intents >= config().artPass.intents || (sinceArt >= config().artPass.tasksSince && intents > 0),
      art_intents_pending: intents,
      art_review_due: unreviewed > 0,
      art_unreviewed: unreviewed,
      art_fit_pending: assets.filter((a) => man.images?.[a.id] && a.review?.verdict === 'ok' && a.review.fit !== 'ok').length,
    };
    if (args.json) print(JSON.stringify(out, null, 2));
    else print([
      `${config().game} status  |  phase: ${out.phase}`,
      `tasks: ${out.tasks.done} done, ${out.tasks.todo} todo, ${out.tasks.doing} doing, ${out.tasks.blocked} blocked, ${out.tasks.skipped} skipped`,
      `next: ${out.next}`,
      `inbox: ${out.inbox_unacked} unacknowledged mentor message(s)${out.inbox_unacked ? '  -> run: node harness/bin/task.mjs inbox' : ''}`,
      `blocked: ${out.blocked.length ? out.blocked.join('; ') : 'none'}`,
      `last verify: ${out.last_verify}`,
      `art pass due: ${out.art_pass_due ? 'YES (' + intents + ' intents waiting for prompts)' : 'no'}`,
      `art review due: ${out.art_review_due ? 'YES (' + unreviewed + ' delivered images not reviewed)' : 'no'}${out.art_fit_pending ? `  (in-game fit not confirmed yet: ${out.art_fit_pending})` : ''}`,
      ...(st.styleSignoff ? [] : ['style sign-off: not yet (Phase 0 waits for the owner; record it with task.mjs signoff "<quote>")']),
      ...(st.archSignoff ? [] : ['architecture sign-off: not yet (Phase 0 waits for the owner; record it with task.mjs archsignoff "<quote>")']),
      ...sessionLogHint(config().sessionLogLimitMB),
    ].join('\n'));
    break;
  }

  case 'next': {
    const b = loadBacklog();
    const nx = computeNext(b);
    if (nx.sentinel === 'RESUME') print(`RESUME ${nx.task.id}\n(This task was in progress when the last session stopped. Check git status, then continue or restart it.)\n\n${fmtTask(nx.task)}`);
    else if (nx.sentinel === 'PHASE_NEEDS_PLANNING') print(`PHASE_NEEDS_PLANNING ${nx.phase.id}\nPhase: ${nx.phase.name}\nGoal: ${nx.phase.goal}\nExit: ${(nx.phase.exit || []).join(' | ')}\nMilestones: ${(nx.phase.milestones || []).join(', ') || '-'}\n-> Spawn the planner agent for this phase.`);
    else if (nx.sentinel === 'PHASE_GATE') print(`PHASE_GATE ${nx.phase.id}\nAll tasks of ${nx.phase.id} are done. Run: node harness/bin/verify.mjs --all, then node harness/bin/task.mjs gate ${nx.phase.id}\nAfter a failed gate whose fix touches no shared code: node harness/bin/gateretry.mjs ${nx.phase.id} (--dry shows if it applies), then task.mjs gate ${nx.phase.id}`);
    else if (nx.sentinel === 'STUCK') print(`STUCK ${nx.phase.id}\nOnly blocked or waiting tasks remain:\n${nx.open.map((t) => `  ${t.id} [${t.status}] ${t.title} deps: ${(t.deps || []).join(',') || '-'}`).join('\n')}\n-> Re-plan: add tasks that unblock these, or unblock with a new approach. Never wait for the owner (except Phase 0 interviews).`);
    else if (nx.sentinel === 'ALL_PHASES_DONE') print('ALL_PHASES_DONE\nRun: node harness/bin/verify.mjs --all, then node harness/bin/task.mjs gate --final');
    else print(fmtTask(nx.task));
    break;
  }

  case 'show': { const b = loadBacklog(); print(JSON.stringify(taskById(b, args._[1]), null, 2)); break; }

  case 'start': {
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    t.status = 'doing'; t.attempts = (t.attempts || 0) + 1; t.started = nowISO();
    saveBacklog(b); saveState({ currentTask: t.id });
    appendJournal(`[${t.id}] start (attempt ${t.attempts}): ${t.title}`);
    print(`started ${t.id} (attempt ${t.attempts})`); break;
  }

  case 'done': {
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    if (!args.summary || args.summary === true) { console.error('done needs --summary "what changed and how it was verified"'); process.exit(2); }
    t.status = 'done'; t.done = nowISO(); t.summary = String(args.summary);
    t.commit = git('rev-parse --short HEAD') || null;
    saveBacklog(b);
    const st = loadState();
    saveState({ currentTask: null, lastTaskDone: t.id, tasksDoneSinceArtPass: (t.agent === 'art-director' ? 0 : (st.tasksDoneSinceArtPass || 0) + 1) });
    appendJournal(`[${t.id}] done: ${t.summary}`);
    print(`done ${t.id}`); break;
  }

  case 'fail': {
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    const reason = args.reason && args.reason !== true ? String(args.reason) : 'no reason given';
    t.notes = [...(t.notes || []), `attempt ${t.attempts || 1} failed: ${reason}`];
    t.status = (t.attempts || 1) >= 3 ? 'blocked' : 'todo';
    saveBacklog(b); saveState({ currentTask: null });
    appendJournal(`[${t.id}] ${t.status === 'blocked' ? 'BLOCKED after 3 attempts' : 'failed attempt ' + t.attempts}: ${reason}`);
    print(t.status === 'blocked' ? `${t.id} is now BLOCKED. Add a follow-up task that takes a different approach, then move on.` : `${t.id} back to todo`);
    break;
  }

  case 'block': case 'skip': {
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    const reason = args.reason && args.reason !== true ? String(args.reason) : 'no reason given';
    t.status = cmd === 'block' ? 'blocked' : 'skipped';
    t.notes = [...(t.notes || []), `${t.status}: ${reason}`];
    saveBacklog(b); if (loadState().currentTask === t.id) saveState({ currentTask: null });
    appendJournal(`[${t.id}] ${t.status}: ${reason}`); print(`${t.id} ${t.status}`); break;
  }

  case 'unblock': {
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    t.status = 'todo'; t.attempts = 0;
    if (args.note && args.note !== true) t.notes = [...(t.notes || []), `unblocked: ${args.note}`];
    saveBacklog(b); appendJournal(`[${t.id}] unblocked${args.note ? ': ' + args.note : ''}`); print(`${t.id} todo`); break;
  }

  case 'model': {
    // Tag a task with the model tier the orchestrator spawns it on (CLAUDE.md "Fable tier"): task.mjs model <id> fable|none
    const b = loadBacklog(); const t = taskById(b, args._[1]); const m = args._[2];
    if (!m) { console.error('model <id> <fable|opus|sonnet|none>'); process.exit(2); }
    if (m === 'none') delete t.model; else t.model = String(m);
    saveBacklog(b); appendJournal(`[${t.id}] model: ${m}`); print(`${t.id} model ${m}`); break;
  }

  case 'note': {
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    t.notes = [...(t.notes || []), args._.slice(2).join(' ')]; saveBacklog(b); print('noted'); break;
  }

  case 'deps': {
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    const add = splitList(args.add, /,/); const rem = new Set(splitList(args.remove, /,/));
    for (const d of add) { if (d === t.id) { console.error('a task cannot depend on itself'); process.exit(2); } taskById(b, d); }
    t.deps = [...new Set([...(t.deps || []), ...add])].filter((d) => !rem.has(d));
    saveBacklog(b); appendJournal(`[${t.id}] deps now: ${t.deps.join(', ') || '-'}`); print(`${t.id} deps: ${t.deps.join(', ') || '-'}`); break;
  }

  case 'planned': {
    // The planner runs this at the end of PLAN_PHASE <P>.
    const b = loadBacklog(); const ph = b.phases.find((p) => p.id === args._[1]);
    if (!ph) { console.error(`Unknown phase ${args._[1]}`); process.exit(2); }
    ph.planned = true; saveBacklog(b); appendJournal(`phase ${ph.id} planned`); print(`phase ${ph.id} planned`); break;
  }

  case 'order': {
    // Set an explicit order among same-phase, same-priority tasks: task.mjs order P2-101,P2-102,... (lower comes first).
    const b = loadBacklog(); const ids = splitList(args._[1], /,/);
    ids.forEach((id, i) => { taskById(b, id).order = (i + 1) * 10; });
    saveBacklog(b); appendJournal(`order set: ${ids.join(', ')}`); print(`order set for ${ids.length} tasks`); break;
  }

  case 'move': {
    // Move an open task to another phase and/or change its priority; the id stays so deps and notes keep pointing at it.
    const b = loadBacklog(); const t = taskById(b, args._[1]);
    if (t.status === 'done' || t.status === 'skipped') { console.error(`${t.id} is ${t.status}; only open tasks move`); process.exit(2); }
    const ph = args.phase && args.phase !== true ? String(args.phase) : t.phase;
    if (phaseIndex(b, ph) < 0) { console.error(`Unknown phase ${ph}`); process.exit(2); }
    const from = t.phase; t.phase = ph;
    if (args.priority) t.priority = parseInt(args.priority, 10);
    if (t.status === 'doing') t.status = 'todo';
    saveBacklog(b); appendJournal(`[${t.id}] moved ${from} -> ${ph}, priority ${t.priority}`); print(`${t.id} moved ${from} -> ${ph}, priority ${t.priority}`); break;
  }

  case 'add': {
    const b = loadBacklog();
    const phase = args.phase && args.phase !== true ? String(args.phase) : activePhase(b)?.id;
    if (!phase || phaseIndex(b, phase) < 0) { console.error(`Unknown phase ${phase}`); process.exit(2); }
    if (!args.title || args.title === true) { console.error('add needs --title'); process.exit(2); }
    const t = {
      id: nextId(b, phase), phase, title: String(args.title), desc: args.desc && args.desc !== true ? String(args.desc) : '',
      accept: splitList(args.accept, /\|/), deps: splitList(args.deps, /,/), agent: args.agent && args.agent !== true ? String(args.agent) : 'builder',
      priority: args.priority ? parseInt(args.priority, 10) : 3, kind: args.kind && args.kind !== true ? String(args.kind) : 'feature',
      status: 'todo', attempts: 0, notes: [], created: nowISO(), ...(args.model && args.model !== true ? { model: String(args.model) } : {}),
    };
    b.tasks.push(t); saveBacklog(b); appendJournal(`[${t.id}] added: ${t.title}`); print(`added ${t.id}`); break;
  }

  case 'add-json': {
    const b = loadBacklog();
    const list = readJSON(path.resolve(process.cwd(), args._[1]));
    const items = Array.isArray(list) ? list : list.tasks;
    const added = [];
    const localIds = {}; // allow deps that reference earlier items by "#n" (1-based index in this file)
    items.forEach((it, i) => {
      const phase = it.phase || activePhase(b)?.id;
      if (phaseIndex(b, phase) < 0) { console.error(`Unknown phase ${phase} in item ${i + 1}`); process.exit(2); }
      const id = nextId(b, phase);
      localIds[`#${i + 1}`] = id;
      const deps = (it.deps || []).map((d) => localIds[d] || d);
      const t = { id, phase, title: it.title, desc: it.desc || '', accept: it.accept || [], deps, agent: it.agent || 'builder', priority: it.priority ?? 3, kind: it.kind || 'feature', status: 'todo', attempts: 0, notes: [], created: nowISO(), ...(it.model ? { model: String(it.model) } : {}) };
      b.tasks.push(t); added.push(id);
    });
    saveBacklog(b); appendJournal(`added ${added.length} tasks: ${added.join(', ')}`); print(`added ${added.length}: ${added.join(', ')}`); break;
  }

  case 'phase-add': {
    const b = loadBacklog();
    if (!args.id || !args.name) { console.error('phase-add needs --id and --name'); process.exit(2); }
    const p = { id: String(args.id), name: String(args.name), goal: args.goal ? String(args.goal) : '', exit: splitList(args.exit, /\|/), milestones: splitList(args.milestones, /,/), status: 'planned', playtest: [] };
    const after = args.after ? phaseIndex(b, String(args.after)) : b.phases.length - 1;
    b.phases.splice(after + 1, 0, p); saveBacklog(b); appendJournal(`phase added: ${p.id} ${p.name}`); print(`phase ${p.id} added`); break;
  }

  case 'phase-done': {
    const b = loadBacklog(); const pid = args._[1]; const p = b.phases.find((x) => x.id === pid);
    if (!p) { console.error(`No phase ${pid}`); process.exit(2); }
    const open = b.tasks.filter((t) => t.phase === pid && !DONEISH.has(t.status));
    if (open.length) { console.error(`Phase ${pid} still has open tasks: ${open.map((t) => t.id).join(', ')}`); process.exit(1); }
    p.status = 'done'; p.doneAt = nowISO();
    const nxt = b.phases.find((x) => x.status !== 'done'); if (nxt) nxt.status = 'active';
    saveBacklog(b); appendJournal(`PHASE ${pid} DONE: ${p.name}${nxt ? '. Next: ' + nxt.id + ' ' + nxt.name : ''}`);
    print(`phase ${pid} done${nxt ? '; active: ' + nxt.id : '; all phases done'}`); break;
  }

  case 'playtest': {
    const b = loadBacklog(); const p = b.phases.find((x) => x.id === args._[1]);
    if (!p) { console.error('No such phase'); process.exit(2); }
    p.playtest = splitList(args._.slice(2).join(' '), /\|/); saveBacklog(b); print(`playtest checklist set for ${p.id} (${p.playtest.length} items)`); break;
  }

  case 'inbox': {
    const msgs = args.all ? readJSONL(PATHS.inbox) : unackedInbox();
    if (!msgs.length) { print('No unacknowledged mentor messages.'); break; }
    print(msgs.map((m) => `[${m.id}] ${m.ts} (${m.source || 'dashboard'})\n${m.text}`).join('\n\n'));
    print('\nFor each: decide (new task / reprioritize / design change / answer), act, then: task.mjs inbox-ack <id> --reply "one line"');
    break;
  }

  case 'inbox-add': {
    const text = args._.slice(1).join(' ').trim();
    if (!text) { console.error('inbox-add needs text'); process.exit(2); }
    const id = `m${Date.now().toString(36)}`;
    appendJSONL(PATHS.inbox, { id, ts: nowISO(), text, source: args.source && args.source !== true ? String(args.source) : 'terminal' });
    print(`recorded ${id}`); break;
  }

  case 'inbox-ack': {
    const id = args._[1];
    if (!id || !args.reply || args.reply === true) { console.error('inbox-ack <id> --reply "..."'); process.exit(2); }
    appendJSONL(PATHS.inboxAcks, { id, ts: nowISO(), reply: String(args.reply), tasks: splitList(args.tasks, /,/) });
    appendJournal(`mentor message ${id} handled: ${args.reply}`); print(`acknowledged ${id}`); break;
  }

  case 'signoff': {
    // Phase 0 (ADOPT + STYLE DISCOVERY) ends only with the owner's explicit sign-off on the style. Record his words verbatim.
    const quote = args._.slice(1).join(' ').trim();
    if (!quote) { console.error('signoff "<the owner\'s exact words>"'); process.exit(2); }
    saveState({ styleSignoff: { at: nowISO(), quote } });
    fs.appendFileSync(PATHS.decisions, `\n## ${nowISO().slice(0, 10)}: style signed off by ${config().owner}\nQuote: "${quote}"\nSee harness/design/STYLE_OPTIONS.md and STYLE_BIBLE.md. From now on the never-wait rule applies.\n`);
    appendJournal(`style sign-off recorded: ${quote}`); print('style sign-off recorded'); break;
  }

  case 'archsignoff': {
    // Phase 0 ARCHITECTURE DISCOVERY ends only with the owner's explicit sign-off on the architecture. Record his words verbatim.
    const quote = args._.slice(1).join(' ').trim();
    if (!quote) { console.error('archsignoff "<the owner\'s exact words>"'); process.exit(2); }
    saveState({ archSignoff: { at: nowISO(), quote } });
    fs.appendFileSync(PATHS.decisions, `\n## ${nowISO().slice(0, 10)}: architecture signed off by ${config().owner}\nQuote: "${quote}"\nSee harness/design/ARCH_OPTIONS.md, TECH.md and docs/ARCHITECTURE.md.\n`);
    appendJournal(`architecture sign-off recorded: ${quote}`); print('architecture sign-off recorded'); break;
  }

  case 'milestone': case 'mission': {
    const [_, mid, status] = args._;
    const allowed = ['planned', 'building', 'playable', 'polished'];
    if (!mid || !allowed.includes(status)) { console.error(`milestone <ID> <${allowed.join('|')}>`); process.exit(2); }
    const ms = readJSON(PATHS.milestoneStatus, {});
    ms[mid] = { ...(ms[mid] || {}), status, updated: nowISO(), ...(args.note && args.note !== true ? { note: String(args.note) } : {}) };
    writeJSON(PATHS.milestoneStatus, ms); print(`${mid} -> ${status}`); break;
  }

  case 'gate': {
    const b = loadBacklog();
    if (args.final) {
      const reasons = [];
      const notDone = b.phases.filter((p) => p.status !== 'done');
      if (notDone.length) reasons.push(`Phases not done: ${notDone.map((p) => p.id).join(', ')}`);
      const blocked = b.tasks.filter((t) => t.status === 'blocked');
      if (blocked.length) reasons.push(`Blocked tasks: ${blocked.map((t) => t.id).join(', ')}`);
      const open = b.tasks.filter((t) => !DONEISH.has(t.status));
      if (open.length) reasons.push(`Open tasks: ${open.length}`);
      reasons.push(...checkReport(requiredMilestones(loadMilestones(), scriptIds()), 'Final'));
      if (!loadState().styleSignoff) reasons.push('No style sign-off recorded (task.mjs signoff)');
      if (b.phases.some((x) => x.archSignoff) && !loadState().archSignoff) reasons.push('No architecture sign-off recorded (task.mjs archsignoff)');
      if (reasons.length) { print('GATE NOT PASSED (final)\n' + reasons.map((r) => `  - ${r}`).join('\n')); process.exitCode = 1; }
      else print('ALL GATES PASSED');
      break;
    }
    const pid = args._[1]; const p = b.phases.find((x) => x.id === pid);
    if (!p) { console.error('gate <P> or gate --final'); process.exit(2); }
    const reasons = [];
    const open = b.tasks.filter((t) => phaseIndex(b, t.phase) <= phaseIndex(b, pid) && !DONEISH.has(t.status));
    if (open.length) reasons.push(`Open tasks: ${open.map((t) => `${t.id}[${t.status}]`).join(', ')}`);
    if (p.signoff && !loadState().styleSignoff) reasons.push(`Phase ${pid} needs the owner's style sign-off: task.mjs signoff "<quote>"`);
    if (p.archSignoff && !loadState().archSignoff) reasons.push(`Phase ${pid} needs the owner's architecture sign-off: task.mjs archsignoff "<quote>"`);
    const g = gatePath(pid, milestoneIdsInPhase(b, p));
    reasons.push(...g.reasons);
    if (reasons.length) { print(`GATE ${pid} NOT PASSED\n${g.info.join('\n')}\n` + reasons.map((r) => `  - ${r}`).join('\n')); process.exitCode = 1; }
    else print(`GATE ${pid} PASSED ${g.via}\n${g.info.join('\n')}\n-> now: task.mjs playtest ${pid} "..."; task.mjs phase-done ${pid}; git tag phase-${pid}`);
    break;
  }

  case 'log': { appendJournal(args._.slice(1).join(' ')); print('logged'); break; }

  default: console.error(`Unknown command ${cmd}\n`); print(HELP); process.exit(2);
}
