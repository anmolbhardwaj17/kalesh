// The map health summary for the dashboard (P1-011): reads harness/reports/map/health.json, written by the bake
// (tools/bake/main.ts, shape in tools/bake/report/health.ts), and boils it down to the numbers the Map tab shows.
// The same numbers as the file, nothing recomputed. Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import { R } from './lib.mjs';

export const HEALTH_FILE = process.env.HARNESS_MAP_HEALTH ? path.resolve(process.env.HARNESS_MAP_HEALTH) : R('harness', 'reports', 'map', 'health.json');

/** Plain English names of the six gate counts (MAP_REPAIR.md "Verification"). */
export const GATE_NAMES = {
  openPorts: 'Roads that end at the edge of a district with no way on',
  floatingEnds: 'Bridge or ramp ends hanging in the air',
  unjoinedEnds: 'Road ends that nearly touch another road',
  overlappingRoadFaces: 'Road surfaces lying on top of each other',
  laneContinuityBreaks: 'Lanes that stop or start with no taper',
  tapersOutOfLimits: 'Lane tapers that are too short',
};

/**
 * What the dashboard shows. null when there is no report yet. `stale` is true when the file is older than the
 * counts (an old report with no counts block): the panel then says to run the bake again.
 */
export function mapHealth(file = HEALTH_FILE) {
  let text;
  let at = 0;
  try {
    text = fs.readFileSync(file, 'utf8');
    at = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  let h;
  try {
    h = JSON.parse(text);
  } catch {
    return { at, error: 'The map health report could not be read (it is not valid JSON). Run the bake again.' };
  }
  const c = h.counts;
  if (!c) return { at, stage: h.stage ?? null, error: 'This report was made before the counts were added. Run "npm run bake -- pilot --stage repair --offline" to make a new one.' };
  const ov = h.overrides ?? {};
  const gates = Object.entries(GATE_NAMES).map(([key, name]) => ({ key, name, count: h.gates?.[key] ?? null }));
  const worst = h.layout ? { bearingDeg: h.layout.worstPairBearingDeg, distancePct: h.layout.worstPairDistancePct } : null;
  const byRule = Object.entries(c.byRule ?? {}).sort((a, b) => b[1] - a[1]).map(([rule, found]) => ({ rule, found, auto: h.repairs?.byRule?.[rule] ?? 0 }));
  return {
    at,
    stage: h.stage ?? null,
    block: h.block ?? null,
    found: c.found,
    repairedAuto: c.repairedAuto,
    fixedByOverrides: c.fixedByOverrides,
    repairsSwitchedOff: c.repairsSwitchedOff,
    staleOverrides: c.staleOverrides,
    leftOpen: c.leftOpen,
    highImpactOpen: c.highImpactOpen,
    explained: c.explained,
    byRule,
    overrides: { patches: ov.patches ?? 0, files: ov.files ?? 0, byId: ov.byId ?? 0, byAnchor: ov.byAnchor ?? 0, outsideStage: ov.outsideStage ?? 0, stale: (ov.records ?? []).filter((r) => r.outcome === 'stale').map((r) => ({ id: r.id, file: r.file, note: r.note })) },
    gates,
    pairs: { count: Array.isArray(h.pairs) ? h.pairs.length : 0, failed: Array.isArray(h.pairs) ? h.pairs.filter((p) => !p.ok).length : 0, worst },
    invariantsFailed: (h.invariants ?? []).filter((i) => !i.ok).map((i) => ({ id: i.id, detail: i.detail })),
  };
}
