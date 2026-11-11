// What the elevation step writes (P1-013): the heights file of a stage (a build product: one height per station,
// the junction centres, the structures) and the elevation record of the health report. Pure.
import type { P2 } from '../geom.ts';
import { hashText } from '../graph/checks.ts';
import type { Station, Strip } from '../roads/model.ts';
import type { ElevationChecks, Finding } from './checks.ts';
import type { RailLine } from './crossings.ts';
import { AT_GRADE_M } from './limits.ts';
import type { ElevationResult, SolveReport, Unmet } from './solve.ts';
import { STATION_KINDS } from './structures.ts';
import type { Structure, StructureResult } from './structures.ts';

export const ELEVATION_FORMAT = 'kalesh-elevation-1';

export interface ElevationFile {
  _doc: string;
  format: string;
  block: string;
  stage: string;
  /** Hash of the lane model these heights belong to (lanes.json). */
  lanes: string;
  kinds: readonly string[];
  /** Per strip of the lane model, in its order: carriageway height and ground model height of every station (m), and the station's kind as an index into `kinds`. */
  strips: { id: string; h: number[]; g: number[]; k: number[] }[];
  junctions: { id: string; h: number }[];
  /** Map edge ends: the height the road leaves the stage at (the next stage or the connector starts from it). */
  ties: { strip: string; end: string; x: number; z: number; h: number; target: number; kind: string }[];
  /** Railway lines at the places a road crosses them: the height the rail has there (block metres). */
  rails: { id: string; x: number; z: number; h: number; over: boolean }[];
  structures: Structure[];
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

export function elevationFile(strips: readonly Strip[], junctionIds: readonly string[], res: ElevationResult, st: StructureResult, rails: readonly RailLine[], block: string, stage: string, lanesHash: string): ElevationFile {
  return {
    _doc: 'Heights of one bake stage (tools/bake/elevation/solve.ts): one solve over the whole lane model. Block metres above the geoid (the ground model is GEDTM30 smoothed over 60 m). strips follow lanes.json strip for strip and station for station: h the carriageway height, g the ground model, k the station kind (index into kinds). A deck stands on piers, a fill between walls, a cut between walls under the ground, a tunnel under a roof.',
    format: ELEVATION_FORMAT, block, stage, lanes: lanesHash, kinds: STATION_KINDS,
    strips: strips.map((s, si) => ({ id: s.id, h: s.st.map((p) => r3(p.h)), g: s.st.map((p) => r3(p.g)), k: Array.from(st.kinds[si] as Uint8Array) })),
    junctions: junctionIds.map((id, i) => ({ id, h: r3(res.junctionHeights[i] as number) })),
    ties: res.ties.map((t) => {
      const s = strips[t.strip] as Strip;
      const p = (t.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
      return { strip: s.id, end: t.end, x: p.x, z: p.z, h: r3(t.h), target: r3(t.target), kind: t.kind };
    }),
    rails: res.crossings.rails.map((x) => ({ id: (rails[x.rail] as RailLine).id, x: r2(x.x), z: r2(x.z), h: r3(x.railH), over: !x.roadAbove })),
    structures: st.structures,
  };
}

export const elevationHash = (file: ElevationFile): string => hashText(JSON.stringify(file));

export interface ElevationRecord {
  hash: string;
  /** Wall time of the solve (crossings, system, rounds, station heights), and of its parts. */
  solveMs: number;
  solver: SolveReport;
  /** Largest height difference between two solves of the same input (m). */
  twoRunsMaxDiffM: number;
  gates: { heightSteps: number; gradeViolations: number; curveViolations: number; clearanceViolations: number; crossfallViolations: number };
  steps: ElevationChecks['steps'];
  grade: ElevationChecks['grade'];
  curves: ElevationChecks['curves'];
  clearance: ElevationChecks['clearance'];
  crossfall: ElevationChecks['crossfall'];
  ties: ElevationChecks['ties'] & { byKind: Record<string, number>; movedEnds: { strip: string; name: string; kind: string; targetM: number; heightM: number; why: string }[] };
  /** Every limit that does not hold on the stations, and every limit the solver gave up, with the place (world metres) and the reason. */
  findings: Finding[];
  unmet: (Omit<Unmet, 'strip'> & { strip: string; name: string })[];
  /** Every structure with its kind, sunk and structureM (world metres for x and z). */
  structures: Structure[];
  structureCounts: Record<string, number>;
  structureM: number;
  /**
   * Road that is neither at grade nor on a structure: between 0.6 and 2 m off the ground model (a low bank or a
   * shallow dip the terrain is graded to). Stretches and metres, above and under the ground.
   */
  graded: { above: number; aboveM: number; under: number; underM: number };
  abutments: number;
  /** Structure ends that do not come back to the ground: at the map edge (the structure goes on outside), at a dead end under the ground, and raised ends that hang in the air (the gate count floatingEnds). */
  openEnds: { mapEdge: number; underGround: number; floating: number };
  files: Record<string, string | string[]>;
}

export function elevationRecord(strips: readonly Strip[], res: ElevationResult, checks: ElevationChecks, st: StructureResult, offset: P2, hash: string, twoRunsMaxDiffM: number, files: ElevationRecord['files']): ElevationRecord {
  const world = <T extends { x: number; z: number }>(p: T): T => ({ ...p, x: r2(p.x + offset.x), z: r2(p.z + offset.z) });
  const counts: Record<string, number> = {};
  for (const s of st.structures) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  const graded = { above: 0, aboveM: 0, under: 0, underM: 0 };
  strips.forEach((s, si) => {
    let was = 0;
    s.st.forEach((p, i) => {
      const off = (st.kinds[si] as Uint8Array)[i] === 0 && Math.abs(p.h - p.g) > AT_GRADE_M ? Math.sign(p.h - p.g) : 0;
      const next = s.st[i + 1];
      if (off !== 0 && off !== was) graded[off > 0 ? 'above' : 'under']++;
      if (off !== 0 && next) graded[off > 0 ? 'aboveM' : 'underM'] += Math.hypot(next.x - p.x, next.z - p.z);
      was = off;
    });
  });
  graded.aboveM = Math.round(graded.aboveM);
  graded.underM = Math.round(graded.underM);
  const byKind: Record<string, number> = {};
  for (const t of res.ties) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
  return {
    hash, solveMs: res.report.ms['total'] ?? 0, solver: res.report, twoRunsMaxDiffM,
    gates: { heightSteps: checks.findings.filter((f) => f.kind === 'step').length, gradeViolations: checks.grade.violations, curveViolations: checks.curves.violations, clearanceViolations: checks.clearance.violations, crossfallViolations: checks.crossfall.violations },
    steps: checks.steps, grade: checks.grade, curves: checks.curves, clearance: checks.clearance, crossfall: checks.crossfall,
    ties: {
      ...checks.ties, byKind,
      movedEnds: res.ties.filter((t) => Math.abs(t.h - t.target) > 0.05).map((t) => ({
        strip: (strips[t.strip] as Strip).id, name: (strips[t.strip] as Strip).name, kind: t.kind, targetM: r2(t.target), heightM: r2(t.h),
        why: 'a clearance next to the map edge needs the road to leave the stage at this height (the limits come before the tie)',
      })),
    },
    findings: checks.findings.map(world),
    unmet: res.unmet.map((u) => world({ ...u, strip: (strips[u.strip] as Strip).id, name: (strips[u.strip] as Strip).name })),
    structures: st.structures.map(world), structureCounts: counts, structureM: Math.round(st.structures.reduce((n, s) => n + s.structureM, 0)),
    graded, abutments: st.abutments.length,
    openEnds: { mapEdge: st.abutments.filter((a) => a.mapEdge).length, underGround: st.abutments.filter((a) => a.open && !a.mapEdge && a.hag < 0).length, floating: st.abutments.filter((a) => a.open && !a.mapEdge && a.hag > 0).length }, files,
  };
}
