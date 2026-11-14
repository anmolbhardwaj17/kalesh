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
  widthSteps: 'Roads that change width with a jump instead of a taper',
};

/**
 * The ground checks of the terrain step (P1-015, tools/bake/terrain/terrainout.ts terrainInvariants), in plain
 * words, with the health.json gate number each one reads (P1-037). TERR-07 is the tunnel portals.
 */
export const GROUND_CHECKS = [
  { id: 'TERR-01', name: 'Gap between a road edge and the ground', gate: 'groundGapMaxM', unit: 'm', limit: '0.02 m' },
  { id: 'TERR-02', name: 'Ground poking up through a road or a deck', gate: 'groundAboveRoad', unit: '', limit: '0' },
  { id: 'TERR-03', name: 'Needle thin ground triangles', gate: 'needleShare', unit: '%', limit: '2 %' },
  { id: 'TERR-04', name: 'Ground edges that differ across a tile line', gate: 'seamMismatches', unit: '', limit: '0' },
  { id: 'TERR-05', name: 'Holes in the ground', gate: 'holeShare', unit: '%', limit: '0.1 %' },
  { id: 'TERR-06', name: 'The same ground twice, in time', gate: null, unit: '', limit: 'same hash' },
  { id: 'TERR-07', name: 'Open faces where a tunnel ramp meets its roof', gate: 'portalOpenFaces', unit: '', limit: '0' },
];

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
  // each gate count with how many of its items an entry explains (P1-017: gateReport, set before the tile step)
  const gates = Object.entries(GATE_NAMES).map(([key, name]) => {
    const g = h.gateReport?.gates?.[key];
    return { key, name, count: h.gates?.[key] ?? null, explained: g ? g.explained : null, owners: g ? [...new Set(g.items.filter((i) => i.explainedBy).map((i) => i.explainedBy.split(':')[0]))] : [] };
  });
  // the ground checks (P1-037): pass or fail from the invariants, the number from the gates block
  const ground = GROUND_CHECKS.map((g) => {
    const inv = (h.invariants ?? []).find((i) => typeof i.id === 'string' && i.id.startsWith(`${g.id}.`));
    const raw = g.gate ? h.gates?.[g.gate] : null;
    const value = typeof raw === 'number' ? (g.unit === '%' ? Math.round(raw * 10000) / 100 : raw) : null;
    return { id: g.id, name: g.name, unit: g.unit, limit: g.limit, value, ok: inv ? inv.ok : null, detail: inv ? inv.detail : null };
  });
  const dir = path.dirname(file);
  let pictures = [];
  try {
    pictures = fs.readdirSync(dir).filter((f) => /^repair_.*\.png$/.test(f)).sort();
  } catch {
    // no report folder
  }
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
    ground,
    pairs: { count: Array.isArray(h.pairs) ? h.pairs.length : 0, failed: Array.isArray(h.pairs) ? h.pairs.filter((p) => !p.ok).length : 0, worst },
    invariantsFailed: (h.invariants ?? []).filter((i) => !i.ok).map((i) => ({ id: i.id, detail: i.detail })),
    findings: h.gateReport?.findings ?? [],
    timing: readTiming(path.join(dir, 'timing.json'), h.stage),
    tiles: h.tiles?.record ? { written: h.tiles.written, bytes: h.tiles.record.stats?.bytes ?? null, bakeHash: h.tiles.record.bakeHash ?? null, dir: h.tiles.record.dir ?? null } : null,
    // files of the report folder the dashboard serves under /map/
    report: path.basename(file),
    pictures,
  };
}

/** The wall clock of the last bake (timing.json beside health.json, kept out of the report so it stays the same for the same inputs). */
function readTiming(file, stage) {
  try {
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    return t.stage === stage ? t : null;
  } catch {
    return null;
  }
}
