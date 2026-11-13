// What the road mesh builder reads (P1-014, MAP_REPAIR.md "Junction mesh builder"): the lane model's strips with the
// heights and station kinds of the elevation step, the joints, the explained ends, and every junction as plain data:
// its arms (the strip end, the stop line, the raised edge widths after the edges gave way) and the planned ring and
// corner bands of junction.ts with each cut vertex named as a border of its strip. Nothing is built again here: the
// lane model and the heights are the ones the lanes and elevation steps made. Pure.
import type { P2 } from '../geom.ts';
import type { JunctionPlan, RingItem } from '../roads/junction.ts';
import { classDefaults } from '../roads/model.ts';
import type { Joint, Strip, StripEnd } from '../roads/model.ts';
import type { ExplainedEnd, LaneBuild } from '../roads/network.ts';
import type { MidCrossing } from '../roads/netctx.ts';
import type { MedianRef, StripPair } from './medianfaces.ts';

/** A ring vertex: border `border` of the arm's strip at its end station, or a free point of corner `corner`. */
export type MeshRingItem = { kind: 'cut'; arm: number; border: number } | { kind: 'pt'; x: number; z: number; corner: number; frac: number };

export interface MeshArm {
  strip: number;
  end: StripEnd;
  /** Metres from the strip end back to the stop line; 0: the stop line is the cut line. */
  stopBack: number;
  crossing: boolean;
  /** The lane model says traffic on this arm stops before the junction (a stop line with a crossing, or signals). */
  stops: boolean;
  /** Raised edge width on the arm's left and right, looking away from the junction: at the strip end, and in the plan. */
  edges: [number, number];
  nominal: [number, number];
  /** Corner radius of the arm's class (m). */
  radius: number;
}

export interface MeshBandPlan {
  ring: MeshRingItem[];
  /** How many ring points, from the start, are the kerb line facing the carriageway. */
  inner: number;
  skirt?: boolean[];
}

export interface MeshJunction {
  id: string;
  centre: P2;
  /** Height of the centre (the elevation solve). */
  h: number;
  control: 'signals' | 'priority';
  arms: MeshArm[];
  /** The planned ring (J1 from lane edges with corner arcs; for J2 the planner's plain polygon, which the mesh does not use); null: no usable plan. */
  ring: MeshRingItem[] | null;
  bands: MeshBandPlan[];
  corners: { kind: 'fillet' | 'through' | 'gap'; radius: number }[];
  method: 'J1' | 'J2';
  why?: string;
  /** The connecting lane paths: their centre lines and the width of the lane each leaves. */
  paths: { pts: [number, number][]; width: number }[];
}

export interface MeshInput {
  strips: readonly Strip[];
  joints: readonly Joint[];
  junctions: MeshJunction[];
  ends: readonly ExplainedEnd[];
  /** Per strip and station: 0 at grade, 1 fill, 2 deck, 3 cut, 4 tunnel (elevation/structures.ts STATION_KINDS). */
  kinds: readonly ArrayLike<number>[];
  /** Strips of the two carriageways of one street, side by side (P1-032): the median between them is filled. */
  pairs: StripPair[];
  /** Reference medians (harness/data/medians.json, block metres). */
  medianRefs: readonly MedianRef[];
  /** Crossings away from the junctions (the lane model's, P1-032). */
  crossings: readonly MidCrossing[];
}

/**
 * Strip pairs of paired carriageways: every strip of an edge with the strips of an edge it is paired with, in order
 * along that edge (medianfaces.ts projects onto them as one border). Each pair of edges once, from the lower index.
 */
export function stripPairs(build: Pick<LaneBuild, 'road' | 'built'>): StripPair[] {
  const index = new Map(build.road.source.map((e, i) => [e.id, i]));
  const out: StripPair[] = [];
  build.road.source.forEach((e, i) => {
    const a = build.built.get(i);
    if (!a) return;
    for (const pid of e.pairedWith) {
      const j = index.get(pid);
      if (j === undefined || j <= i) continue;
      const b = build.built.get(j);
      if (!b) continue;
      const other: number[] = [];
      for (let y = b.first; y <= b.last; y++) other.push(y);
      for (let x = a.first; x <= a.last; x++) out.push([x, other]);
    }
  });
  return out.sort((p, q) => p[0] - q[0] || (p[1][0] as number) - (q[1][0] as number));
}

export function meshInput(build: Pick<LaneBuild, 'strips' | 'joints' | 'junctions' | 'junctionPlans' | 'ends' | 'built' | 'road' | 'crossings'>, junctionHeights: ArrayLike<number>, kinds: readonly ArrayLike<number>[], medianRefs: readonly MedianRef[] = []): MeshInput {
  const junctions: MeshJunction[] = build.junctions.map((j, ji) => {
    const jp = build.junctionPlans[ji] as JunctionPlan;
    let usable = jp !== undefined && jp.arms.length === j.arms.length;
    // every border of an arm's planned cross-section (looking away from the junction, left to right) as a border of its strip
    const borderOf: number[][] = j.arms.map((_, i) => {
      const ap = jp?.arms[i];
      const b = ap ? build.built.get(ap.end.edge) : undefined;
      if (!ap || !b) {
        usable = false;
        return [];
      }
      const lanes = ap.end.atStart ? b.startLanes : b.endLanes;
      const n = ap.cs.lanes.length;
      if (lanes.length !== n || lanes.some((l) => l < 0)) {
        usable = false;
        return [];
      }
      const out: number[] = [];
      for (let border = 0; border <= n; border++) {
        const kb = ap.end.atStart ? border : n - border;
        out.push(kb < n ? (lanes[kb] as number) : (lanes[n - 1] as number) + 1);
      }
      return out;
    });
    const item = (it: RingItem): MeshRingItem => (it.kind === 'cut' ? { kind: 'cut', arm: it.arm, border: (borderOf[it.arm] as number[])[it.border] as number } : { kind: 'pt', x: it.x, z: it.z, corner: it.corner, frac: it.frac });
    const arms: MeshArm[] = j.arms.map((a, i) => {
      const ap = jp?.arms[i];
      const s = build.strips[a.strip] as Strip;
      const towards = a.end === 'end' ? 1 : -1;
      const arrives = s.lanes.some((l) => l.type === 'drive' && (l.dir === 0 || l.dir === towards));
      const nominal: [number, number] = ap ? [(ap.borders[0] as number) - (ap.borders[ap.coreFirst] as number), (ap.borders[ap.coreLast + 1] as number) - (ap.borders[ap.borders.length - 1] as number)] : [a.edges[0], a.edges[1]];
      return { strip: a.strip, end: a.end, stopBack: a.stopBack, crossing: a.crossing, stops: arrives && (a.stopBack > 0 || j.control === 'signals'), edges: [a.edges[0], a.edges[1]], nominal, radius: classDefaults(s.cls).cornerRadius };
    });
    return {
      id: j.id, centre: j.centre, h: junctionHeights[ji] as number, control: j.control, arms,
      ring: usable ? jp.ring.map(item) : null,
      bands: usable ? jp.bands.map((b) => ({ ring: b.ring.map(item), inner: b.inner, ...(b.skirt ? { skirt: b.skirt.slice() } : {}) })) : [],
      corners: usable ? jp.corners.map((c) => ({ kind: c.kind, radius: c.radius })) : [],
      method: usable ? jp.method : 'J2', ...(jp?.why ? { why: jp.why } : {}),
      paths: j.paths.map((p) => {
        const s = build.strips[p.from[0]] as Strip;
        const st = (j.arms[p.fromArm]?.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Strip['st'][number];
        return { pts: p.pts.map((q) => [q.x, q.z] as [number, number]), width: Math.round(((st.b[p.from[1]] as number) - (st.b[p.from[1] + 1] as number)) * 1000) / 1000 };
      }),
    };
  });
  return { strips: build.strips, joints: build.joints, junctions, ends: build.ends, kinds, pairs: stripPairs(build), medianRefs, crossings: build.crossings };
}
