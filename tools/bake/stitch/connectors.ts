// Connectors of the composite map (ARCH_OPTIONS SC1, SC2). A connector is authored data: control points in game
// metres (the world frame), a road class and a lane set, one JSON file each in harness/data/connectors/. This file
// turns a connector into roads for the lane model of tools/bake/roads/ (the same builder as real roads) and checks
// its curve radius. SC2 (a real road's shape, shortened) is `shorten` below.
import { boxOf, polylineLength } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { Road } from '../osm.ts';
import { smoothLine } from '../roads/curve.ts';
import { classDefaults, maxGrade } from '../roads/model.ts';
import type { Station } from '../roads/model.ts';
import { buildSite } from '../roads/site.ts';
import type { SiteResult } from '../roads/site.ts';

export interface ConnectorSpan {
  /** Control point numbers: the span runs from point `from` to point `to`. */
  from: number;
  to: number;
  kind: 'bridge';
  layer: number;
  over: string;
}

export interface ConnectorSpec {
  id: string;
  name: string;
  /** The real road this connector stands for. */
  standsFor: string;
  kind: 'ring_arc' | 'flyover' | 'bridge' | 'link';
  status: string;
  class: string;
  lanes: { forward: number; backward: number };
  /** The port at each end: the district and the name of the road that leaves it there. */
  from: { district: string; port: string };
  to: { district: string; port: string };
  /** Control points in world metres (east +X, north -Z). The first and last lie on the two ports. */
  points: { x: number; z: number }[];
  spans?: ConnectorSpan[];
  /** Roads or tracks the connector passes over: authored the same way, built on the ground under it. */
  under?: { id: string; name: string; class: string; lanes: number; points: { x: number; z: number }[] }[];
  notes?: string;
}

/** Design speed per class in the compressed city and the smallest curve radius it allows (e = 4 percent, f from IRC 38). */
export const MIN_RADIUS: Readonly<Record<string, { kmh: number; radius: number }>> = {
  motorway: { kmh: 80, radius: 230 },
  trunk: { kmh: 60, radius: 120 },
  primary: { kmh: 50, radius: 80 },
  secondary: { kmh: 40, radius: 50 },
  tertiary: { kmh: 30, radius: 25 },
};
export const minRadius = (cls: string): number => MIN_RADIUS[cls]?.radius ?? 15;

/** What is wrong with a connector file, as text: an empty list means it can be built. */
export function specProblems(spec: ConnectorSpec): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9_]+$/.test(spec.id ?? '')) out.push('id must be lower case letters, digits and underscores');
  if (!Array.isArray(spec.points) || spec.points.length < 2) out.push('at least two control points');
  else if (spec.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) out.push('every control point needs x and z in metres');
  if (!MIN_RADIUS[spec.class]) out.push(`class ${spec.class} is not a connector class (${Object.keys(MIN_RADIUS).join(', ')})`);
  if (!spec.lanes || spec.lanes.forward < 1 || spec.lanes.backward < 1) out.push('a lane set with at least one lane each way');
  else if (spec.lanes.forward !== spec.lanes.backward) out.push('the lane model prototype builds a two-way road with the same lane count each way');
  for (const s of spec.spans ?? []) {
    if (!(s.from >= 0 && s.to > s.from && s.to < (spec.points?.length ?? 0))) out.push(`span over ${s.over}: from and to must be control point numbers in order`);
  }
  for (const key of Object.keys(spec)) if (/^(rot|scale|mirror|flip)/i.test(key)) out.push(`key ${key}: a connector has no rotation, scale or mirror`);
  return out;
}

/** The connector's line: a smooth curve through the control points that leaves each end along the port's road. */
export function connectorLine(spec: ConnectorSpec, startDir?: P2, endDir?: P2, step = 6): { pts: P2[]; controlIndex: number[] } {
  const curve = smoothLine(spec.points, step, startDir, endDir);
  const controlIndex: number[] = [];
  let at = 0;
  for (const c of spec.points) {
    while (at < curve.pts.length - 1 && Math.hypot((curve.pts[at] as P2).x - c.x, (curve.pts[at] as P2).z - c.z) > 1e-6) at++;
    controlIndex.push(at);
  }
  return { pts: curve.pts, controlIndex };
}

let nodeBase = 9_000_000_000;

const makeRoad = (id: string, name: string, cls: string, lanes: number, pts: P2[], nodes: number[], bridge: boolean, layer: number): Road => {
  const tags: Record<string, string> = { highway: cls, name, lanes: String(lanes) };
  if (bridge) tags['bridge'] = 'yes';
  if (layer !== 0) tags['layer'] = String(layer);
  return {
    id, nodes, pts, tags, cls, link: false, layer, bridge, tunnel: false, oneway: false, name,
    width: lanes * classDefaults(cls).laneWidth, widthFrom: 'lanes', length: polylineLength(pts), box: boxOf(pts),
  };
};

/**
 * A connector as roads of the bake's map model, ready for the lane model: one way per stretch (at grade, bridge, at
 * grade), joined at shared nodes so the graph makes one edge of them, plus the roads it passes over.
 */
export function connectorRoads(spec: ConnectorSpec, startDir?: P2, endDir?: P2): Road[] {
  const { pts, controlIndex } = connectorLine(spec, startDir, endDir);
  const nodes = pts.map(() => nodeBase++);
  const lanes = spec.lanes.forward + spec.lanes.backward;
  // cut points: the ends of every span
  const cuts = new Set<number>([0, pts.length - 1]);
  const spans = (spec.spans ?? []).map((s) => ({ a: controlIndex[s.from] as number, b: controlIndex[s.to] as number, layer: s.layer }));
  for (const s of spans) {
    cuts.add(s.a);
    cuts.add(s.b);
  }
  const order = [...cuts].sort((a, b) => a - b);
  const out: Road[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    const a = order[i] as number;
    const b = order[i + 1] as number;
    if (b <= a) continue;
    const span = spans.find((s) => a >= s.a && b <= s.b);
    out.push(makeRoad(`connector/${spec.id}#${i}`, spec.name, spec.class, lanes, pts.slice(a, b + 1), nodes.slice(a, b + 1), span !== undefined, span ? span.layer : 0));
  }
  for (const u of spec.under ?? []) {
    const line = smoothLine(u.points, 6).pts;
    out.push(makeRoad(`connector/${spec.id}/under/${u.id}`, u.name, u.class, u.lanes, line, line.map(() => nodeBase++), false, 0));
  }
  return out;
}

export interface RadiusCheck {
  minRadiusM: number;
  limitM: number;
  /** Stretches (runs of samples) tighter than the limit. */
  violations: number;
  lengthBelowM: number;
  worstAt: P2 | null;
}

/** Curve radius along a line, from the circle through points `chord` metres apart, against a limit. */
export function radiusCheck(line: readonly P2[], limit: number, chord = 20): RadiusCheck {
  // resample evenly so the three points of every circle are the same distance apart
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((line[i] as P2).x - (line[i - 1] as P2).x, (line[i] as P2).z - (line[i - 1] as P2).z));
  const total = cum[cum.length - 1] as number;
  const step = 4;
  const at = (s: number): P2 => {
    let i = 0;
    while (i + 2 < cum.length && (cum[i + 1] as number) < s) i++;
    const len = (cum[i + 1] as number) - (cum[i] as number);
    const t = len === 0 ? 0 : (s - (cum[i] as number)) / len;
    return { x: (line[i] as P2).x + ((line[i + 1] as P2).x - (line[i] as P2).x) * t, z: (line[i] as P2).z + ((line[i + 1] as P2).z - (line[i] as P2).z) * t };
  };
  const out: RadiusCheck = { minRadiusM: Infinity, limitM: limit, violations: 0, lengthBelowM: 0, worstAt: null };
  let inRun = false;
  for (let s = chord; s <= total - chord; s += step) {
    const a = at(s - chord);
    const b = at(s);
    const c = at(s + chord);
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const twice = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    const radius = twice < 1e-9 ? Infinity : (ab * bc * ca) / (2 * twice);
    if (radius < out.minRadiusM) {
      out.minRadiusM = radius;
      out.worstAt = b;
    }
    if (radius < limit) {
      out.lengthBelowM += step;
      if (!inRun) out.violations++;
      inRun = true;
    } else inRun = false;
  }
  return out;
}

export interface Shortened {
  pts: P2[];
  /** Game length over real length. */
  ratio: number;
  /** How far the shape was turned to fit between the two ports, degrees. */
  turnDeg: number;
  realLengthM: number;
  lengthM: number;
}

/**
 * SC2: the real road's shape between two districts, shortened to fit between the two ports in the game. One
 * similarity (a scale and a turn) moves the real ends onto the ports; the shape in between keeps its bends, with
 * every radius and every ramp length multiplied by the ratio.
 */
export function shorten(real: readonly P2[], a: P2, b: P2): Shortened {
  const sim = similarity(real[0] as P2, real[real.length - 1] as P2, a, b);
  const pts = real.map(sim.map);
  return { pts, ratio: sim.ratio, turnDeg: sim.turnDeg, realLengthM: polylineLength(real), lengthM: polylineLength(pts) };
}

/** The similarity (one scale, one turn, one shift) that moves r0 onto a and r1 onto b. */
export function similarity(r0: P2, r1: P2, a: P2, b: P2): { map: (p: P2) => P2; ratio: number; turnDeg: number } {
  const rx = r1.x - r0.x;
  const rz = r1.z - r0.z;
  const gx = b.x - a.x;
  const gz = b.z - a.z;
  const ratio = Math.hypot(gx, gz) / Math.hypot(rx, rz);
  const turn = Math.atan2(gz, gx) - Math.atan2(rz, rx);
  const cos = Math.cos(turn) * ratio;
  const sin = Math.sin(turn) * ratio;
  let deg = (turn * 180) / Math.PI;
  if (deg > 180) deg -= 360;
  if (deg < -180) deg += 360;
  return { map: (p) => ({ x: a.x + (p.x - r0.x) * cos - (p.z - r0.z) * sin, z: a.z + (p.x - r0.x) * sin + (p.z - r0.z) * cos }), ratio, turnDeg: deg };
}

export interface ConnectorBuild {
  id: string;
  cls: string;
  /** The lane model's result for the connector and the roads it passes over. */
  site: SiteResult;
  line: P2[];
  lengthM: number;
  radius: RadiusCheck;
  grade: { limitPct: number; maxPct: number; violations: number };
  /** Least height of a deck above the road under it, metres (null when it passes over no road). */
  minClearanceM: number | null;
  clearanceViolations: number;
  /** Stretches at grade that stand more than 0.6 m off the ground model. */
  floating: number;
  sunk: number;
  /** Stations on a ramp or a deck, and the highest point above the ground. */
  structureM: number;
  maxAboveGroundM: number;
  /** Carriageway height at the first and the last station of the connector's own line. */
  startH: number;
  endH: number;
  ms: number;
}

/**
 * Builds a connector with the lane model of tools/bake/roads/ (graph, lane sections, heights, meshes, checks): the
 * same builder as a real road. `ground` is the ground of the stitched world, so the connector's grades come from
 * the height offsets of the districts it joins. No terrain is built: the caller owns the ground.
 */
export function buildConnector(spec: ConnectorSpec, ground: (x: number, z: number) => number, startDir?: P2, endDir?: P2): ConnectorBuild {
  const t0 = Date.now();
  const roads = connectorRoads(spec, startDir, endDir);
  const all = roads.flatMap((r) => r.pts);
  const box = boxOf(all);
  const classes = [...new Set(roads.map((r) => r.cls))];
  const site = buildSite({
    site: { id: `connector_${spec.id}`, name: spec.name, region: { kind: 'box', minX: box.minX - 60, minZ: box.minZ - 60, maxX: box.maxX + 60, maxZ: box.maxZ + 60 }, classes },
    roads, ground, terrain: false,
  });
  const line = connectorLine(spec, startDir, endDir).pts;
  // the connector's own strips: those made of its ways (not the roads under it)
  const own = site.strips.filter((s) => s.ways.some((w) => w.startsWith(`connector/${spec.id}#`)));
  const limit = maxGrade(spec.class, false);
  let maxPct = 0;
  let violations = 0;
  let structureM = 0;
  let above = 0;
  for (const s of own) {
    let run = false;
    for (let i = 1; i < s.st.length; i++) {
      const a = s.st[i - 1] as Station;
      const b = s.st[i] as Station;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 0.5) continue;
      const g = Math.abs(b.h - a.h) / d;
      maxPct = Math.max(maxPct, g * 100);
      const over = g > limit + 0.003;
      if (over && !run) violations++;
      run = over;
      if (a.structure > 0 || b.structure > 0) structureM += d;
      above = Math.max(above, b.h - b.g);
    }
  }
  const first = line[0] as P2;
  const last = line[line.length - 1] as P2;
  const nearest = (p: P2): number => {
    let best = Infinity;
    let h = 0;
    for (const s of own) {
      for (const st of s.st) {
        const d = Math.hypot(st.x - p.x, st.z - p.z);
        if (d < best) {
          best = d;
          h = st.h;
        }
      }
    }
    return h;
  };
  const c = site.checks;
  return {
    id: spec.id, cls: spec.class, site, line, lengthM: polylineLength(line), radius: radiusCheck(line, minRadius(spec.class)),
    grade: { limitPct: limit * 100, maxPct: Math.round(maxPct * 100) / 100, violations },
    minClearanceM: c.overlap.minClearanceM, clearanceViolations: c.overlap.clearanceViolations, floating: c.heights.floating, sunk: c.heights.sunk,
    structureM: Math.round(structureM), maxAboveGroundM: Math.round(above * 100) / 100, startH: nearest(first), endH: nearest(last), ms: Date.now() - t0,
  };
}
