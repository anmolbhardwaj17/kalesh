// Elevation solver for a whole block (P1-013, ARCH_OPTIONS EL1, MAP_REPAIR.md "Elevation solver"). One solve over
// the whole lane model, so two roads can never disagree where they meet (the old game sampled heights per vertex and
// its roads floated over or sank into the ground).
//
// The unknowns are the knot heights of every chain of strips (profile.ts) and one height per junction centre. The
// cost is the prototype's (roads/elevation.ts): stay near the ground model (GEDTM30 smoothed over 60 m), stay
// smooth, keep the two carriageways of a street level, keep a junction on one gentle surface. A bridge tag only
// frees a stretch from the ground (a tunnel is pulled, loosely, to its cover depth). The limits are never traded
// against the cost:
//   grade per class on every knot interval, vertical curve radius per class at every knot (both hold at every point
//   of the profile, see profile.ts); the clearance wherever two levels cross, over or under a junction, at every
//   railway line; the deck over water (a bridge stands clear of the water under it, whatever its two banks do);
//   the cover of a tunnel; the crossfall between the two carriageways of a street where both are at grade.
// A map edge end is tied to the ground model there by a spring thousands of times stiffer than the ground under a
// station: the road leaves the map at ground height, to a centimetre or so, unless a clearance next to the edge needs
// the end itself to move (a road that dips under a railway bridge 40 m inside the map). Where the road itself has to
// stand over something within a ramp's length of the edge, the tie is softer than the road under it: the road goes
// on outside, so its ramp may go on there too before the road under it is lowered. The height an end got is in the
// result for the next stage or the connector to take. Limits are held by the method of multipliers: a broken limit
// becomes a stiff spring whose target moves until the limit holds to a thousandth of a millimetre; a spring that
// would pull the wrong way is dropped. Each round is a Newton step on the stretched springs, checked against the
// cost so the set of springs cannot cycle. Grade, curve and junction limits come first (every one of them holds on a
// level road, so together they can always be met): the multipliers of the others stop at a cap, so where a ramp is
// too short the solver starts it earlier, then lowers the road under it (both are only cost), and gives up clearance
// last. What it gave up is listed (unmet), never hidden. Pure, and the same bits every run.
import type { Joint, Station, Strip, StripEnd } from '../roads/model.ts';
import { findCrossings, levelOf } from './crossings.ts';
import type { Crossings, ElevationJunction, RailLine, WaterArea } from './crossings.ts';
import { AT_GRADE_M, CROSSFALL_MAX, minCurveRadius, DECK_OVER_WATER_M, JUNCTION_SLOPE_MAX, RAIL_EMBANKMENT_M, RAIL_OVER_ROAD_M, ROAD_OVER_RAIL_M, ROAD_OVER_ROAD_CENTRE_M, ROAD_OVER_ROAD_M, TUNNEL_COVER_M, tunnelGradeCaps } from './limits.ts';
import { combine, Profiles } from './profile.ts';
import type { Chain, Expr } from './profile.ts';
import { dot, solveWithLimits } from './multipliers.ts';
import type { Limit as LoopLimit, Term } from './multipliers.ts';

export interface ElevationInput {
  strips: Strip[];
  joints: readonly Joint[];
  junctions: readonly ElevationJunction[];
  /** The two carriageways of one street: the strips of each side. */
  pairs: readonly { a: readonly number[]; b: readonly number[] }[];
  ground: (x: number, z: number) => number;
  /** Strip ends where the road goes on outside the map: tied to the ground model. */
  ties?: readonly { strip: number; end: StripEnd }[];
  /** Per strip and station: 1 a tunnel under the ground, 2 a passage through a building (crossings.ts TunnelKind). */
  tunnels?: readonly (ArrayLike<number> | undefined)[];
  rails?: readonly RailLine[];
  water?: readonly WaterArea[];
  knotSpacing?: number;
}

export type LimitKind = 'grade' | 'curve' | 'junction' | 'clearance' | 'rail' | 'water' | 'cover' | 'crossfall' | 'ceiling';

export interface PairSample {
  a: [number, number];
  b: [number, number];
  dist: number;
  /** The crossfall limit applies here: both carriageways came out at grade. */
  limited: boolean;
}

export interface Tie {
  strip: number;
  end: StripEnd;
  /** What the end is tied to: the ground model, or the height a deck or a tunnel has there. */
  target: number;
  kind: 'ground' | 'deck' | 'water' | 'tunnel';
  /** The road stands over something within a ramp's length of the edge: the tie is soft, the ramp may go on outside. */
  ramp?: boolean;
  /** The height the end got. */
  h: number;
}

export interface Unmet {
  kind: LimitKind;
  /** How far short of the limit, in the limit's own measure (metres of height). */
  short: number;
  strip: number;
  x: number;
  z: number;
}

export interface SolveReport {
  strips: number;
  stations: number;
  chains: number;
  knots: number;
  unknowns: number;
  ties: number;
  branches: number;
  loops: number;
  matrix: number;
  factor: number;
  rounds: number;
  factorisations: number;
  converged: boolean;
  limits: Record<LimitKind, number>;
  active: Record<LimitKind, number>;
  /** Pairs of strips of different levels on each other, and the stations where the clearance is held. */
  roadCrossings: number;
  roadOverlaps: number;
  junctionCrossings: number;
  railCrossings: number;
  levelCrossings: number;
  waterCrossings: number;
  pairSamples: number;
  ms: Record<string, number>;
}

export interface ElevationResult {
  junctionHeights: number[];
  crossings: Crossings;
  pairSamples: PairSample[];
  ties: Tie[];
  tunnels: readonly (ArrayLike<number> | undefined)[];
  /** Limits the solve could not meet (a clearance given up for a grade): empty on a sound map. */
  unmet: Unmet[];
  report: SolveReport;
}

const W_GROUND = 1;
const W_BEND = 4e5;
const W_SLOPE = 5;
const W_PAIR = 2;
const W_JUNCTION = 50;
const W_TIE = 1e4;
/**
 * The tie of an end whose own road must stand over something (a clearance that lifts it) within TIE_RAMP_M of the
 * edge along its chain: a quarter of a held road (P1-035). With the stiff tie the Geeta Colony slip, whose bridge
 * stands 37 m inside the stage edge, could not rise and the service road under it went 4 m into the ground.
 */
const W_TIE_RAMP = 50;
/** A ramp's length: 7 m of clearance at 5 percent and its two vertical curves. */
const TIE_RAMP_M = 200;
const W_DECK = 0.002;
const W_HELD = 200;
/** Two arms of a junction are one street running straight on when they leave it within 30 degrees of opposite. */
const THROUGH_COS = Math.cos((30 * Math.PI) / 180);
const MU = 1e5;
/** The multiplier of a clearance stops here (the pull of a spring one metre short): grades and curves come first. */
const CAP = MU;
const TOL = 1e-6;
const MAX_ROUNDS = 60;
const INNER_ROUNDS = 40;
/** A tunnel follows the ground at its cover depth, loosely: without this a dead end tunnel has nothing to stop it going down. */
const W_TUNNEL = 0.25;
const KINDS: readonly LimitKind[] = ['grade', 'curve', 'junction', 'clearance', 'rail', 'water', 'cover', 'crossfall', 'ceiling'];
/** A deck may stand this far above the highest place a clearance needs it (m). */
const CEILING_SLACK_M = 0.05;

interface Limit extends LoopLimit<LimitKind> {
  strip: number;
  station: number;
  /** A crossfall limit: its pair sample. A ceiling: its run of deck. */
  sample: number;
  /** The constant of the limit's expression (bound is stored without it). */
  k: number;
  /** The limit holds its strip up at its station (a clearance over something, the water under a deck). */
  lifts: boolean;
}

const endStation = (s: Strip, end: StripEnd): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;

/** Sets g and h on every station and returns the junction centre heights with everything the checks read. */
export function solveBlockElevation(input: ElevationInput): ElevationResult {
  const clock = (globalThis as unknown as { performance: { now(): number } }).performance;
  const t0 = clock.now();
  const ms: Record<string, number> = {};
  let lapAt = t0;
  const lap = (name: string): void => {
    const now = clock.now();
    ms[name] = Math.round(now - lapAt);
    lapAt = now;
  };
  const { strips, joints, junctions } = input;
  const tunnels = input.tunnels ?? [];
  const tun = (si: number, i: number): number => tunnels[si]?.[i] ?? 0;
  let stations = 0;
  for (const s of strips) {
    stations += s.st.length;
    for (const st of s.st) st.g = input.ground(st.x, st.z);
  }
  const crossings = findCrossings({ strips, joints, junctions, tunnels, rails: input.rails ?? [], water: input.water ?? [], ground: input.ground, railEmbankment: RAIL_EMBANKMENT_M });
  lap('crossings');

  // map edge ends: the ground model, or the height a deck or a tunnel has there
  const wet = new Map<number, number>();
  for (const w of crossings.water) for (let i = w.first; i <= w.last; i++) wet.set(w.strip * 1e6 + i, w.level);
  const ties: Tie[] = (input.ties ?? []).map((t) => {
    const s = strips[t.strip] as Strip;
    const i = t.end === 'start' ? 0 : s.st.length - 1;
    const st = s.st[i] as Station;
    const level = wet.get(t.strip * 1e6 + i);
    if (tun(t.strip, i) === 1) return { ...t, target: st.g - TUNNEL_COVER_M, kind: 'tunnel' as const, h: 0 };
    if (level !== undefined) return { ...t, target: level + DECK_OVER_WATER_M, kind: 'water' as const, h: 0 };
    if (st.bridge) return { ...t, target: st.g + ROAD_OVER_ROAD_CENTRE_M, kind: 'deck' as const, h: 0 };
    return { ...t, target: st.g, kind: 'ground' as const, h: 0 };
  });
  const gradeCaps = tunnelGradeCaps(strips, joints, tunnels);
  const P = new Profiles(strips, joints, { spacing: input.knotSpacing ?? 12, gradeCaps });
  const n = P.free + junctions.length;
  const centre = (ji: number): Expr => ({ idx: [P.free + ji], c: [1], k: 0 });
  lap('profiles');

  const terms: Term[] = [];
  const limits: Limit[] = [];
  const term = (e: Expr, target: number, w: number): void => {
    if (e.idx.length && w > 0) terms.push({ idx: e.idx, c: e.c, target: target - e.k, w });
  };
  const limit = (kind: LimitKind, e: Expr, bound: number, strip: number, station: number, cap = Infinity, sample = -1, lifts = false): void => {
    if (e.idx.length) limits.push({ kind, idx: e.idx, c: e.c, bound: bound - e.k, mu: MU, cap, lam: 0, enabled: kind !== 'crossfall' && kind !== 'ceiling', strip, station, sample, k: e.k, lifts });
  };
  const minus = (a: Expr, b: Expr): Expr => combine([{ e: a, s: 1 }, { e: b, s: -1 }]);
  const neg = (a: Expr): Expr => ({ idx: a.idx, c: a.c.map((v) => -v), k: -a.k });

  // the ground under every station that is free to follow it; a bridge is not, a tunnel follows its cover depth
  strips.forEach((s, si) => {
    const pos = P.pos[si] as Float64Array;
    s.st.forEach((st, i) => {
      if (st.bridge) return;
      const trib = ((i > 0 ? (pos[i] as number) - (pos[i - 1] as number) : 0) + (i + 1 < pos.length ? (pos[i + 1] as number) - (pos[i] as number) : 0)) / 2;
      if (tun(si, i) === 1) term(P.station(si, i), st.g - TUNNEL_COVER_M, W_TUNNEL * trib);
      else term(P.station(si, i), st.g, W_GROUND * trib);
    });
  });
  // a deck is pulled, very weakly, towards the straight line between its two banks (or the ground, where that is
  // higher). It is free of the ground, but in the second phase it gets a ceiling: no deck stands higher than the
  // highest place a clearance needs it (or its own two ends), so it cannot arch up between two far supports
  const runs: { first: [number, number]; last: [number, number] }[] = [];
  const runOf = new Map<number, number>();
  P.chains.forEach((c: Chain) => {
    const run: { si: number; i: number; x: number; trib: number }[] = [];
    const flush = (): void => {
      if (run.length > 1) {
        const a = run[0] as { si: number; i: number; x: number };
        const b = run[run.length - 1] as { si: number; i: number; x: number };
        const ga = ((strips[a.si] as Strip).st[a.i] as Station).g;
        const gb = ((strips[b.si] as Strip).st[b.i] as Station).g;
        for (const r of run) {
          const chord = ga + ((gb - ga) * (r.x - a.x)) / Math.max(1e-6, b.x - a.x);
          term(P.station(r.si, r.i), Math.max(((strips[r.si] as Strip).st[r.i] as Station).g, chord), W_DECK * r.trib);
          limit('ceiling', neg(P.station(r.si, r.i)), 0, r.si, r.i, CAP, runs.length);
          runOf.set(r.si * 1e6 + r.i, runs.length);
        }
        runs.push({ first: [a.si, a.i], last: [b.si, b.i] });
      }
      run.length = 0;
    };
    for (const p of c.parts) {
      const s = strips[p.strip] as Strip;
      const pos = P.pos[p.strip] as Float64Array;
      for (let k = 0; k < s.st.length; k++) {
        const i = p.reversed ? s.st.length - 1 - k : k;
        if (!(s.st[i] as Station).bridge) {
          flush();
          continue;
        }
        const trib = ((i > 0 ? (pos[i] as number) - (pos[i - 1] as number) : 0) + (i + 1 < pos.length ? (pos[i + 1] as number) - (pos[i] as number) : 0)) / 2;
        run.push({ si: p.strip, i, x: P.xOf(p.strip, i).x, trib });
      }
    }
    flush();
  });
  // along every chain: a little pull to level, bending, and the grade and curve limits
  P.chains.forEach((c: Chain, ci) => {
    const first = c.parts[0] as { strip: number; reversed: boolean };
    const where = (x: number): [number, number] => {
      // the strip and station nearest chain metres x, for the report
      let p = c.parts[0] as Chain['parts'][number];
      for (const q of c.parts) if (q.x0 <= x) p = q;
      const pos = P.pos[p.strip] as Float64Array;
      const at = p.reversed ? p.x0 + p.len - x : x - p.x0;
      let i = 0;
      while (i + 1 < pos.length && (pos[i + 1] as number) <= at) i++;
      return [p.strip, i];
    };
    const mean = (strips[first.strip] as Strip).st.reduce((a, st) => a + st.g, 0) / (strips[first.strip] as Strip).st.length;
    const knots = c.loop ? c.m : c.m + 1;
    for (let i = 0; i < knots; i++) term(P.knot(ci, i), mean, 1e-4);
    for (let i = 0; i < c.m; i++) {
      const rise = minus(P.knot(ci, i + 1), P.knot(ci, i));
      term(rise, 0, W_SLOPE / c.d);
      const [si, at] = where((i + 0.5) * c.d);
      const g = (c.grade[i] as number) * c.d;
      limit('grade', rise, -g, si, at);
      limit('grade', neg(rise), -g, si, at);
    }
    for (let i = c.loop ? 0 : 1; i < (c.loop ? c.m : c.m); i++) {
      const bend = combine([{ e: P.knot(ci, i - 1), s: 1 }, { e: P.knot(ci, i), s: -2 }, { e: P.knot(ci, i + 1), s: 1 }]);
      term(bend, 0, W_BEND / (c.d * c.d * c.d));
      const [si, at] = where(i * c.d);
      const k = (c.curve[i] as number) * c.d * c.d;
      limit('curve', bend, -k, si, at);
      limit('curve', neg(bend), -k, si, at);
    }
  });
  // junctions: every arm's cut and the centre lie on one gentle surface
  junctions.forEach((jn, ji) => {
    const cv = centre(ji);
    for (const arm of jn.arms) {
      const s = strips[arm.strip] as Strip;
      const i = arm.end === 'start' ? 0 : s.st.length - 1;
      const st = s.st[i] as Station;
      const d = Math.max(2, Math.hypot(st.x - jn.centre.x, st.z - jn.centre.z));
      const v = P.station(arm.strip, i);
      const rise = minus(cv, v);
      term(rise, 0, W_JUNCTION / d);
      limit('junction', rise, -JUNCTION_SLOPE_MAX * d, arm.strip, i);
      limit('junction', neg(rise), -JUNCTION_SLOPE_MAX * d, arm.strip, i);
      // bending through the cut: the knot next to the arm's end, the end, the centre
      const at = P.xOf(arm.strip, i);
      const c = P.chains[at.chain] as Chain;
      if (!c.loop) {
        const nb = at.x < c.length / 2 ? P.knot(at.chain, 1) : P.knot(at.chain, c.m - 1);
        const k = 2 / (c.d + d);
        term(combine([{ e: nb, s: k / c.d }, { e: v, s: -k * (1 / c.d + 1 / d) }, { e: cv, s: k / d }]), 0, (W_BEND * (c.d + d)) / 2);
      }
    }
    term(cv, input.ground(jn.centre.x, jn.centre.z), W_GROUND * 4);
    // a street that runs straight on through the junction bends through it like through any knot (no hinge at the centre)
    const arms = jn.arms.map((arm) => {
      const s = strips[arm.strip] as Strip;
      const i = arm.end === 'start' ? 0 : s.st.length - 1;
      const st = s.st[i] as Station;
      const out = arm.end === 'start' ? 1 : -1;
      return { arm, i, st, hx: -st.nz * out, hz: st.nx * out, d: Math.max(2, Math.hypot(st.x - jn.centre.x, st.z - jn.centre.z)), k: 1 / minCurveRadius(s.cls, s.link) };
    });
    const through: { a: number; b: number; straight: number }[] = [];
    for (let a = 0; a < arms.length; a++) {
      for (let b = a + 1; b < arms.length; b++) {
        const p = arms[a] as (typeof arms)[number];
        const q = arms[b] as (typeof arms)[number];
        const straight = -(p.hx * q.hx + p.hz * q.hz);
        if (straight > THROUGH_COS) through.push({ a, b, straight });
      }
    }
    const used = new Set<number>();
    for (const t of through.sort((p, q) => q.straight - p.straight || p.a - q.a || p.b - q.b)) {
      if (used.has(t.a) || used.has(t.b)) continue;
      used.add(t.a);
      used.add(t.b);
      const p = arms[t.a] as (typeof arms)[number];
      const q = arms[t.b] as (typeof arms)[number];
      const k = 2 / (p.d + q.d);
      const bend = combine([{ e: P.station(p.arm.strip, p.i), s: 1 / p.d }, { e: cv, s: -(1 / p.d + 1 / q.d) }, { e: P.station(q.arm.strip, q.i), s: 1 / q.d }]);
      term(bend, 0, (W_BEND * k * k * (p.d + q.d)) / 2);
      // the change of grade through the centre, held to the tighter of the two classes' curve limits
      const most = (Math.min(p.k, q.k) * (p.d + q.d)) / 2;
      limit('curve', bend, -most, p.arm.strip, p.i);
      limit('curve', neg(bend), -most, p.arm.strip, p.i);
    }
  });
  // the two carriageways of one street stay level with each other
  const pairSamples: PairSample[] = [];
  for (const pair of input.pairs) {
    const other: { si: number; i: number; st: Station }[] = [];
    for (const sj of pair.b) (strips[sj] as Strip).st.forEach((st, i) => other.push({ si: sj, i, st }));
    for (const si of pair.a) {
      const s = strips[si] as Strip;
      const pos = P.pos[si] as Float64Array;
      const step = Math.max(1, Math.round((input.knotSpacing ?? 12) / Math.max(0.5, (pos[pos.length - 1] as number) / Math.max(1, pos.length - 1))));
      for (let i = 0; i < s.st.length; i += step) {
        const p = s.st[i] as Station;
        let best: (typeof other)[number] | null = null;
        let bestD = 30;
        for (const o of other) {
          const d = Math.hypot(p.x - o.st.x, p.z - o.st.z);
          if (d < bestD && o.st.bridge === p.bridge && o.st.layer === p.layer && tun(o.si, o.i) === tun(si, i)) {
            bestD = d;
            best = o;
          }
        }
        if (!best || bestD < 0.5) continue;
        const diff = minus(P.station(si, i), P.station(best.si, best.i));
        term(diff, 0, W_PAIR);
        const plain = !p.bridge && tun(si, i) !== 1;
        if (plain) {
          limit('crossfall', diff, -CROSSFALL_MAX * bestD, si, i, CAP, pairSamples.length);
          limit('crossfall', neg(diff), -CROSSFALL_MAX * bestD, si, i, CAP, pairSamples.length);
        }
        pairSamples.push({ a: [si, i], b: [best.si, best.i], dist: bestD, limited: false });
      }
    }
  }
  // clearances
  const along = (strip: number, station: number, t: number, shift: number): Expr => {
    const a = P.xOf(strip, station);
    const b = P.xOf(strip, Math.min(station + 1, (strips[strip] as Strip).st.length - 1));
    const c = P.chains[a.chain] as Chain;
    const x = a.x + (b.x - a.x) * t + shift;
    return P.at(a.chain, c.loop ? x : Math.max(0, Math.min(c.length, x)));
  };
  for (const x of crossings.roads) limit('clearance', minus(P.station(x.up, x.upStation, x.upT), P.station(x.low, x.lowStation, x.lowT)), x.centre ? ROAD_OVER_ROAD_CENTRE_M : ROAD_OVER_ROAD_M, x.up, x.upStation, CAP, -1, true);
  // the road at ground level that a deck passes over (or a tunnel under) is held to the ground far harder than a
  // ramp is: the structure's own ramps start earlier first, and only when their grade limit is met does the ground
  // road move. It is still only cost: `sunk` says how far it went
  const held = new Set<number>();
  const hold = (strip: number, station: number, t: number): void => {
    const st = (strips[strip] as Strip).st;
    const a = st[station] as Station;
    if (levelOf(a, tun(strip, station)) !== 0 || held.has(strip * 1e6 + station)) return;
    held.add(strip * 1e6 + station);
    const b = st[station + 1];
    term(P.station(strip, station, b ? t : 0), b && t > 0 ? a.g + (b.g - a.g) * t : a.g, W_HELD);
  };
  for (const x of crossings.roads) {
    hold(x.low, x.lowStation, x.lowT);
    hold(x.up, x.upStation, x.upT);
  }
  const heldJunctions = new Set<number>();
  for (const x of crossings.junctions) {
    const jn = junctions[x.junction] as ElevationJunction;
    const ground = jn.arms.every((arm) => levelOf(endStation(strips[arm.strip] as Strip, arm.end), tun(arm.strip, arm.end === 'start' ? 0 : (strips[arm.strip] as Strip).st.length - 1)) === 0);
    if (ground && !heldJunctions.has(x.junction)) {
      heldJunctions.add(x.junction);
      term(centre(x.junction), input.ground(jn.centre.x, jn.centre.z), W_HELD * 4);
    }
    for (const i of x.stations) hold(x.strip, i, 0);
  }
  for (const x of crossings.junctions) {
    for (const i of x.stations) {
      const e = P.station(x.strip, i);
      limit('clearance', x.above ? minus(e, centre(x.junction)) : minus(centre(x.junction), e), ROAD_OVER_ROAD_CENTRE_M, x.strip, i, CAP, -1, x.above);
    }
  }
  for (const x of crossings.rails) {
    for (const shift of [-3, 0, 3]) {
      const e = along(x.strip, x.station, x.t, shift);
      if (x.roadAbove) limit('rail', e, x.railH + ROAD_OVER_RAIL_M, x.strip, x.station, CAP, -1, true);
      else limit('rail', neg(e), -(x.railH - RAIL_OVER_ROAD_M), x.strip, x.station, CAP);
    }
  }
  for (const w of crossings.water) for (let i = w.first; i <= w.last; i++) limit('water', P.station(w.strip, i), w.level + DECK_OVER_WATER_M, w.strip, i, CAP, -1, true);
  // the map edge ties: soft where the road must rise for something within a ramp's length of the edge
  const lifted = new Map<number, number[]>();
  for (const l of limits) {
    if (!l.lifts) continue;
    const at = P.xOf(l.strip, l.station);
    const list = lifted.get(at.chain);
    if (list) list.push(at.x);
    else lifted.set(at.chain, [at.x]);
  }
  for (const t of ties) {
    const i = t.end === 'start' ? 0 : (strips[t.strip] as Strip).st.length - 1;
    const at = P.xOf(t.strip, i);
    t.ramp = (lifted.get(at.chain) ?? []).some((x) => Math.abs(x - at.x) < TIE_RAMP_M);
    term(P.station(t.strip, i), t.target, t.ramp ? W_TIE_RAMP : W_TIE);
  }
  strips.forEach((s, si) => {
    s.st.forEach((st, i) => {
      if (tun(si, i) === 1) limit('cover', neg(P.station(si, i)), -(st.g - TUNNEL_COVER_M), si, i, CAP);
    });
  });
  lap('terms');

  // second phase: the crossfall limit where both carriageways of a street came out at grade, and a ceiling on every
  // deck at the highest place a clearance needs it
  const heightOf = (knots: Float64Array, at: [number, number]): number => P.heightAt(knots, at[0], at[1]);
  const secondPhase = (at: Float64Array): number => {
    const knots = P.knotValues(at);
    const atGrade = (q: [number, number]): boolean => Math.abs(heightOf(knots, q) - ((strips[q[0]] as Strip).st[q[1]] as Station).g) <= AT_GRADE_M;
    const top = runs.map((r) => Math.max(heightOf(knots, r.first), heightOf(knots, r.last)));
    for (const l of limits) {
      const run = l.lifts && l.enabled ? runOf.get(l.strip * 1e6 + l.station) : undefined;
      if (run !== undefined) top[run] = Math.max(top[run] as number, heightOf(knots, [l.strip, l.station]) + l.bound - dot(l, at));
    }
    let on = 0;
    for (const l of limits) {
      if (l.kind === 'ceiling') {
        l.bound = -((top[l.sample] as number) + CEILING_SLACK_M) - l.k;
        l.enabled = true;
        on++;
      }
      if (l.kind !== 'crossfall') continue;
      const sample = pairSamples[l.sample] as PairSample;
      if (atGrade(sample.a) && atGrade(sample.b)) {
        l.enabled = true;
        sample.limited = true;
        on++;
      }
    }
    return on;
  };
  const loop = solveWithLimits(n, terms, limits, secondPhase, { tol: TOL, maxRounds: MAX_ROUNDS, innerRounds: INNER_ROUNDS });
  const x = loop.x;
  ms['order'] = loop.orderMs;
  lap('solve');
  ms['solve'] = (ms['solve'] ?? 0) - loop.orderMs;

  // heights of every station and junction
  const knots = P.knotValues(x);
  strips.forEach((s, si) => s.st.forEach((st, i) => (st.h = P.heightAt(knots, si, i))));
  for (const t of ties) t.h = endStation(strips[t.strip] as Strip, t.end).h;
  const count = (pick: (l: Limit) => boolean): Record<LimitKind, number> => {
    const out = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<LimitKind, number>;
    for (const l of limits) if (pick(l)) out[l.kind]++;
    return out;
  };
  const unmet: Unmet[] = [];
  for (const l of limits) {
    if (!l.enabled) continue;
    const short = l.bound - dot(l, x);
    if (short <= 1e-4) continue;
    const st = (strips[l.strip] as Strip).st[l.station] as Station;
    unmet.push({ kind: l.kind, short: Math.round(short * 1000) / 1000, strip: l.strip, x: st.x, z: st.z });
  }
  lap('heights');
  ms['total'] = Math.round(clock.now() - t0);
  return {
    junctionHeights: junctions.map((_, ji) => x[P.free + ji] as number), crossings, pairSamples, ties, tunnels, unmet,
    report: {
      strips: strips.length, stations, chains: P.chains.length, knots: P.counts.knots, unknowns: n, ties: ties.length, branches: P.counts.branches, loops: P.counts.loops,
      matrix: loop.matrix, factor: loop.factor, rounds: loop.rounds, factorisations: loop.factorisations, converged: loop.converged, limits: count((l) => l.enabled), active: count((l) => l.enabled && l.lam > 0),
      roadCrossings: crossings.roadPairs, roadOverlaps: crossings.roads.length, junctionCrossings: crossings.junctions.length, railCrossings: crossings.rails.length, levelCrossings: crossings.levelCrossings,
      waterCrossings: crossings.water.length, pairSamples: pairSamples.length, ms,
    },
  };
}
