#!/usr/bin/env node
// Which milestones count for gates and the dashboard. A milestone is a playable end-to-end unit of the game (a level,
// mission, stage, quest, run: kit.config.json `milestoneWord` names it). They live in harness/data/milestones.json:
//   { "milestones": [ { "id": "L01", "title": "First level", "required": true, "summary": "..." }, ... ] }
// A milestone is PLAYABLE by the harness when it has a play script: harness/verify/milestones/<ID>.js (a page-side script
// that drives the game through window.__game.debug and returns {ok, reason, log}; see docs/GAME_HOOKS.md).
// Each backlog phase lists its milestones (`phase.milestones: ["L01", "L02"]`). Gates are cumulative: a phase gate needs
// every counted milestone of that phase and of every earlier phase. Counted = required (the default), or optional with a
// play script (it is in the game now, so it must keep working).
//
//   node harness/bin/milestoneset.mjs              print the counted milestones per phase and the final set
//   node harness/bin/milestoneset.mjs --selftest   prove the counting on in-memory data (exit 1 on failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, ROOT, readJSON, config } from './lib.mjs';

export function scriptsDir() { return path.join(ROOT, config().milestoneScripts); }

/** Milestone ids that have a play script in `dir`. */
export function scriptIds(dir = scriptsDir()) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).map((f) => (f.match(/^([A-Za-z0-9_-]+)\.js$/) || [])[1]).filter(Boolean));
}

export const isRequired = (m) => m.required !== false;
export function isCounted(m, scripts) { return isRequired(m) || scripts.has(m.id); }

export function loadMilestones() { return readJSON(PATHS.milestones, { milestones: [] }).milestones || []; }

/** Every counted milestone id (the final gate). */
export function requiredMilestones(milestones, scripts) { return milestones.filter((m) => isCounted(m, scripts)).map((m) => m.id); }

/** Counted milestone ids for a phase gate: the counted milestones of this phase and every earlier one. */
export function phaseRequired(phases, phaseId, milestones, scripts) {
  const idx = phases.findIndex((p) => p.id === phaseId);
  if (idx < 0) return [];
  const ids = new Set(phases.slice(0, idx + 1).flatMap((p) => p.milestones || []));
  return milestones.filter((m) => ids.has(m.id) && isCounted(m, scripts)).map((m) => m.id);
}

/** Gate reasons for the milestone part of a verify report. results: report.milestones ({ id: { ok } }). */
export function milestoneReasons(required, results, label, scripts) {
  const reasons = [];
  const noScript = required.filter((id) => !scripts.has(id));
  if (noScript.length) reasons.push(`${label}: milestones with no play script yet (${config().milestoneScripts}/<ID>.js): ${noScript.join(', ')}`);
  const withScript = required.filter((id) => scripts.has(id));
  const missing = withScript.filter((id) => !results?.[id]);
  const failed = required.filter((id) => results?.[id] && !results[id].ok);
  if (missing.length) reasons.push(`${label}: milestones not in the report: ${missing.join(', ')}`);
  if (failed.length) reasons.push(`${label}: milestones failing: ${failed.join(', ')}`);
  return reasons;
}

/** Dashboard counts: playable out of required. */
export function milestoneCounts(milestones, mstatus, scripts) {
  const playable = (id) => ['playable', 'polished'].includes(mstatus?.[id]?.status);
  const req = milestones.filter(isRequired);
  const opt = milestones.filter((m) => !isRequired(m));
  return {
    required: { total: req.length, playable: req.filter((m) => playable(m.id)).length },
    optional: { total: opt.length, playable: opt.filter((m) => playable(m.id)).length, scripted: opt.filter((m) => scripts.has(m.id)).length },
  };
}

export function runSelfTest(log = () => {}) {
  const check = (cond, msg) => { if (!cond) throw new Error(`selftest: ${msg}`); log(`ok  ${msg}`); };
  const ms = [{ id: 'L01' }, { id: 'L02' }, { id: 'S01', required: false }, { id: 'L03' }];
  const phases = [{ id: 'P1', milestones: ['L01'] }, { id: 'P2', milestones: ['L02', 'S01'] }, { id: 'P3', milestones: ['L03'] }];
  check(phaseRequired(phases, 'P2', ms, new Set()).join() === 'L01,L02', 'P2 gate is cumulative and skips an optional milestone with no script');
  check(phaseRequired(phases, 'P2', ms, new Set(['S01'])).includes('S01'), 'an optional milestone with a script counts');
  const r = milestoneReasons(['L01', 'L02'], { L01: { ok: true } }, 'P2', new Set(['L01']));
  check(r.some((x) => x.includes('no play script') && x.includes('L02')), 'a required milestone without a script blocks the gate');
  const r2 = milestoneReasons(['L01'], { L01: { ok: false } }, 'P1', new Set(['L01']));
  check(r2.some((x) => x.includes('failing')), 'a failing milestone blocks the gate');
  check(milestoneReasons(['L01'], { L01: { ok: true } }, 'P1', new Set(['L01'])).length === 0, 'a passing milestone passes');
  check(requiredMilestones(ms, new Set()).length === 3, 'final gate counts the 3 required milestones');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) {
    try { runSelfTest((l) => console.log(l)); console.log('MILESTONESET SELFTEST OK'); }
    catch (e) { console.log(String(e.message || e)); console.log('MILESTONESET SELFTEST FAIL'); process.exitCode = 1; }
  } else {
    const ms = loadMilestones(); const sc = scriptIds();
    const backlog = readJSON(PATHS.backlog, { phases: [] });
    console.log(`play scripts: ${[...sc].sort().join(', ') || '-'}`);
    for (const p of backlog.phases) if (p.milestones?.length) console.log(`${p.id}: ${phaseRequired(backlog.phases, p.id, ms, sc).join(' ') || '-'}`);
    const fin = requiredMilestones(ms, sc);
    console.log(`final: ${fin.length} ${config().milestoneWord}s: ${fin.join(' ')}`);
  }
}
