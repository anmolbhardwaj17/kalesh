// The owner's Phase 0 sign-offs: style, architecture, game design. One table, used by task.mjs (commands, status, gates)
// and by the dashboard, so a new sign-off is one row here. A sign-off is recorded in harness/state/state.json as
// { at, quote } under its stateKey; a phase asks for it with a flag on the phase in backlog.json (set with task.mjs phase-flag).
export const SIGNOFFS = [
  { key: 'style', label: 'Style', stateKey: 'styleSignoff', phaseFlag: 'signoff', command: 'signoff', record: 'style signed off', see: 'harness/design/STYLE_OPTIONS.md and STYLE_BIBLE.md. From now on the never-wait rule applies.', always: true },
  { key: 'architecture', label: 'Architecture', stateKey: 'archSignoff', phaseFlag: 'archSignoff', command: 'archsignoff', record: 'architecture signed off', see: 'harness/design/ARCH_OPTIONS.md, TECH.md and docs/ARCHITECTURE.md.' },
  { key: 'design', label: 'Game design', stateKey: 'designSignoff', phaseFlag: 'designSignoff', command: 'designsignoff', record: 'game design signed off', see: 'harness/design/GAME_DESIGN_OPTIONS.md and GAME.md (fantasy, core loop, pillars, mission list, progression plan).' },
];

export const PHASE_FLAGS = SIGNOFFS.map((s) => s.phaseFlag);

/** The sign-off whose CLI command is `command`, or undefined. */
export const signoffByCommand = (command) => SIGNOFFS.find((s) => s.command === command);

/** One row per sign-off for the dashboard and status: { key, label, command, signed, at, quote }. */
export function signoffStates(state) {
  return SIGNOFFS.map((s) => {
    const v = state && state[s.stateKey];
    return { key: s.key, label: s.label, command: s.command, signed: !!v, at: v?.at || null, quote: v?.quote || null };
  });
}

/** The `status` lines for the sign-offs not recorded yet. */
export function statusLines(state) {
  return SIGNOFFS.filter((s) => !(state && state[s.stateKey])).map((s) => `${s.label.toLowerCase()} sign-off: not yet (Phase 0 waits for the owner; record it with task.mjs ${s.command} "<quote>")`);
}

/** Gate reasons for one phase: its flagged sign-offs that are not recorded. The wording names the sign-off. */
export function phaseReasons(phase, state) {
  const out = [];
  for (const s of SIGNOFFS) {
    if (!phase[s.phaseFlag] || (state && state[s.stateKey])) continue;
    if (s.key === 'design') out.push(`No game design sign-off recorded: Phase ${phase.id} needs the owner's game design sign-off (task.mjs designsignoff "<quote>")`);
    else out.push(`Phase ${phase.id} needs the owner's ${s.label.toLowerCase()} sign-off: task.mjs ${s.command} "<quote>"`);
  }
  return out;
}

/** Gate reasons for the final gate: style always, the others when any phase asked for them. */
export function finalReasons(phases, state) {
  const out = [];
  for (const s of SIGNOFFS) {
    if (state && state[s.stateKey]) continue;
    if (!s.always && !phases.some((p) => p[s.phaseFlag])) continue;
    out.push(s.key === 'design' ? 'No game design sign-off recorded (task.mjs designsignoff)' : `No ${s.label.toLowerCase()} sign-off recorded (task.mjs ${s.command})`);
  }
  return out;
}

/** The exit line Phase 0 gains with the design sign-off. */
export const DESIGN_EXIT = 'the owner signed off a game design (task.mjs designsignoff); GAME.md has the fantasy, core loop, pillars, mission list and progression plan';
