// Invariants of the bake steps built so far (P1-007). Each returns pass or fail with a reason; the driver records them
// in the health report and stops before writing tiles when one fails (TECH.md "World pipeline (offline bake)"). Later
// steps add theirs here: open ports, floating ends, overlapping road faces, lane breaks. The layout invariants (no
// mirror, translation only, the centre pair gate, far blocks, block gaps, the map extent) are rule R-STITCH in
// tools/bake/layout/gate.ts, run by the driver before the first step.
import type { GroundModel } from './heights.ts';
import { ringProblems } from './layout/outline.ts';
import type { StagePlan } from './layout/stages.ts';
import { outlineRing } from './layout/outline.ts';
import { FORBIDDEN, pinProblems } from './pins.ts';
import type { SourcesFile } from './pins.ts';
import type { InvariantResult } from './report/health.ts';

/** The result of the sources step for one pin, as the invariants need it. */
export interface SourceState {
  id: string;
  kind: string;
  action: 'reused' | 'fetched' | 'unreachable' | 'mismatch';
}

const ok = (id: string, detail: string): InvariantResult => ({ id, ok: true, detail });
const fail = (id: string, detail: string): InvariantResult => ({ id, ok: false, detail });

export function outlineInvariants(plan: StagePlan): InvariantResult[] {
  const problems = ringProblems(outlineRing(plan.outline.coords, plan.origin));
  return [
    problems.length ? fail('outline.simple', problems.slice(0, 5).join('; ')) : ok('outline.simple', `${plan.outline.coords.length - 1} points, no crossing`),
    plan.areaKm2 > 0.01 ? ok('outline.area', `${plan.areaKm2.toFixed(2)} km2`) : fail('outline.area', `area ${plan.areaKm2} km2`),
  ];
}

export function sourceInvariants(plan: StagePlan, states: readonly SourceState[], pins: SourcesFile): InvariantResult[] {
  const out: InvariantResult[] = [];
  const by = new Map(states.map((s) => [s.kind, s]));
  const have = (kind: string): boolean => {
    const s = by.get(kind);
    return !!s && (s.action === 'reused' || s.action === 'fetched');
  };
  const forbidden = plan.sources.filter((s) => FORBIDDEN.test(s.kind) || FORBIDDEN.test(s.id));
  out.push(forbidden.length ? fail('sources.noFabdem', forbidden.map((s) => s.id).join(', ')) : ok('sources.noFabdem', 'no non-commercial source is read'));
  const mismatched = states.filter((s) => s.action === 'mismatch');
  out.push(mismatched.length ? fail('sources.hashes', `local file differs from its pin: ${mismatched.map((s) => s.id).join(', ')}`) : ok('sources.hashes', `${states.filter((s) => s.action === 'reused' || s.action === 'fetched').length} files match their pins`));
  for (const kind of ['osm', 'overture_buildings']) {
    if (plan.def.sources.includes(kind)) out.push(have(kind) ? ok(`sources.${kind}`, 'pinned') : fail(`sources.${kind}`, `${kind} is not there (${by.get(kind)?.action ?? 'not run'})`));
  }
  out.push(have('gedtm30') || have('glo30') ? ok('sources.ground', have('gedtm30') ? 'GEDTM30 window' : 'GLO-30 fallback') : fail('sources.ground', 'neither GEDTM30 nor GLO-30 is there'));
  const stagePins: SourcesFile = { files: {}, unreachable: {} };
  for (const s of plan.sources) {
    const p = pins.files[s.id];
    if (p) stagePins.files[s.id] = p;
  }
  const problems = pinProblems(stagePins);
  out.push(problems.length ? fail('sources.pins', problems.join('; ')) : ok('sources.pins', 'every file has its hash, licence and credit line'));
  return out;
}

/** Heights of Delhi's plain are about 200 to 240 m (EGM2008); anything far outside is a unit or a reading fault. */
export function groundInvariants(g: GroundModel): InvariantResult[] {
  const { min, max } = g.stats;
  const sane = Number.isFinite(min) && Number.isFinite(max) && min > 150 && max < 320 && max - min < 120;
  return [sane ? ok('ground.range', `${min.toFixed(1)} to ${max.toFixed(1)} m (${g.source})`) : fail('ground.range', `heights ${min} to ${max} m are outside 150 to 320 m`)];
}
