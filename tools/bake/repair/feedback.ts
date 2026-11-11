// The repair step with the lane model's feedback (P1-033, rule R-LANE-06). The rules read the graph; the lane model
// builds wider than the graph widths in places (roads/surfaces.ts). So the repair runs, the lane model is built on its
// result, and where two strips lie on each other the two roads go back to the repair as conflicts with the centre line
// distance they need; the repair runs again from the raw graph with every conflict found so far, up to
// FEEDBACK_ROUNDS times. The last result is the repaired graph; its environment (with the conflicts) is the one the
// fixed point check must use. Pure.
import type { BlockGraph } from '../graph/build.ts';
import { buildLaneModel } from '../roads/network.ts';
import type { LaneBuild, LaneModelInput } from '../roads/network.ts';
import { stripOverlaps } from '../roads/overlap.ts';
import { laneConflicts } from '../roads/surfaces.ts';
import type { LaneConflict } from '../roads/surfaces.ts';
import type { RuleEnv } from '../rules/types.ts';
import { repairGraph } from './engine.ts';
import type { RepairedGraph, RepairOptions, RepairResult } from './engine.ts';

export const FEEDBACK_ROUNDS = 2;

export interface FeedbackRound {
  /** Strip overlap of the lane model built on this round's repair (m2, pairs). */
  overlapM2: number;
  pairs: number;
  /** Conflicts handed back after this round (new ones), and overlaps it could not hand back, by reason. */
  conflicts: number;
  skipped: Record<string, number>;
}

export interface FeedbackResult {
  res: RepairResult;
  env: RuleEnv;
  conflicts: LaneConflict[];
  rounds: FeedbackRound[];
  /** The lane model of the last round, built on `res.graph` (the lanes step reuses it). */
  build: LaneBuild;
}

export function repairWithLanes(raw: BlockGraph, env: RuleEnv, opts: RepairOptions, laneInput: (g: RepairedGraph) => LaneModelInput, rounds = FEEDBACK_ROUNDS): FeedbackResult {
  const all = new Map<string, LaneConflict>();
  let curEnv = env;
  let res = repairGraph(raw, curEnv, opts);
  const log: FeedbackRound[] = [];
  let build = buildLaneModel(laneInput(res.graph));
  for (let round = 0; round <= rounds; round++) {
    if (round > 0) build = buildLaneModel(laneInput(res.graph));
    const { overlaps } = stripOverlaps(build.strips, build.joints);
    const found = laneConflicts(build, overlaps);
    let added = 0;
    for (const c of found.conflicts) {
      const key = `${c.a}|${c.b}`;
      const prev = all.get(key);
      // the same pair again: it needs more than it was given (the distance it keeps now plus the new depth)
      if (!prev || c.minSep > prev.minSep) {
        all.set(key, c);
        added++;
      }
    }
    log.push({ overlapM2: Math.round(overlaps.reduce((s, o) => s + o.area, 0) * 100) / 100, pairs: new Set(overlaps.map((o) => `${o.a.strip}|${o.b.strip}`)).size, conflicts: added, skipped: found.skipped });
    if (added === 0 || round === rounds) break;
    curEnv = { ...env, laneConflicts: [...all.values()].sort((p, q) => (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : p.b > q.b ? 1 : 0)) };
    res = repairGraph(raw, curEnv, opts);
  }
  return { res, env: curEnv, conflicts: [...(curEnv.laneConflicts ?? [])], rounds: log, build };
}
