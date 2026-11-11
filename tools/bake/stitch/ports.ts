// Closing the boundary ports of a district (ARCH_OPTIONS FL1, SC1). Every port ends in exactly one closure:
//   connector    a big road that an authored connector (harness/data/connectors/) takes over
//   street_net   two or more small ports close together, joined by a short generated back street outside the clip
//   loop         one small through street on its own: a turning loop
//   gate         a service road: a closed gate at the clip line
//   dead_end     a lane: it ends at a wall of the edge band (explained in `reason`)
//   open         a big road with no connector yet: it needs an authored connector (drawn with a barrier)
// Small ports close automatically; a closure that the generator is not sure of carries `review`.
import type { P2 } from '../geom.ts';
import { ringAt, ringLength, ringProject } from './clip.ts';
import type { Port } from './clip.ts';

export type ClosureKind = 'connector' | 'street_net' | 'loop' | 'gate' | 'dead_end' | 'open';

export interface Closure {
  kind: ClosureKind;
  ports: string[];
  /** Closed by a rule, with no authored data. */
  auto: boolean;
  /** Closed by a rule, but a person should look at it (a through street turned into a loop, a closure that had no room). */
  review: boolean;
  reason: string;
  /** Generated street centre lines (each a polyline) and their carriageway width. */
  streets: P2[][];
  width: number;
  /** A turning loop: its centre and radius. */
  loop?: { x: number; z: number; r: number };
  /** A gate, wall or barrier across the road: its two ends. */
  bar?: [P2, P2];
  connector?: string;
}

export interface CloseOptions {
  /** Small ports closer than this along the clip ring join one street net. */
  chainGap: number;
  /** How far outside the clip line the generated back street runs. */
  setback: number;
  loopRadius: number;
  /** Returns what a generated line runs into (another district, a connector, water), or null when it is free. */
  blocked?: (line: readonly P2[]) => string | null;
}

export const CLOSE_DEFAULTS: CloseOptions = { chainGap: 140, setback: 26, loopRadius: 9 };

const LOOP_CLASSES = new Set(['tertiary', 'unclassified', 'residential', 'road']);

/** The clip ring between two arc lengths, pushed outwards by `setback`: the line of a generated back street. */
export function backStreet(ring: readonly P2[], s0: number, s1: number, setback: number, step = 6): P2[] {
  const total = ringLength(ring);
  let span = s1 - s0;
  if (span < 0) span += total;
  const n = Math.max(1, Math.ceil(span / step));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + (span * i) / n;
    const a = ringAt(ring, s - 4);
    const b = ringAt(ring, s + 4);
    const here = ringAt(ring, s);
    let nx = a.nx + b.nx;
    let nz = a.nz + b.nz;
    const len = Math.hypot(nx, nz);
    if (len < 1e-6) continue;
    nx /= len;
    nz /= len;
    const p = { x: here.x + nx * setback, z: here.z + nz * setback };
    // the first and last point stay (the stubs end on them); a point in between that a concave corner folds back is dropped
    if (i === 0 || i === n || ringProject(ring, p).d >= setback * 0.95) out.push(p);
  }
  return out;
}

const bar = (p: Port, out: number, half: number): [P2, P2] => {
  const cx = p.x + p.dx * out;
  const cz = p.z + p.dz * out;
  return [{ x: cx + p.dz * half, z: cz - p.dx * half }, { x: cx - p.dz * half, z: cz + p.dx * half }];
};

/**
 * One closure per port. `connectors` maps a port id to the connector that ends on it.
 * Chains never run across a big port: a generated back street does not cross an arterial.
 */
export function closePorts(ports: readonly Port[], ring: readonly P2[], connectors: ReadonlyMap<string, string>, opts: CloseOptions = CLOSE_DEFAULTS): Closure[] {
  const out: Closure[] = [];
  const total = ringLength(ring);
  const sorted = ports.slice().sort((a, b) => a.s - b.s);
  for (const p of sorted) {
    if (!p.big) continue;
    const id = connectors.get(p.id);
    if (id) out.push({ kind: 'connector', ports: [p.id], auto: false, review: false, reason: `joined by the authored connector ${id}`, streets: [], width: p.width, connector: id });
    else out.push({ kind: 'open', ports: [p.id], auto: false, review: false, reason: `needs an authored connector: ${p.name || 'unnamed road'} (${p.cls}${p.link ? ' link' : ''})`, streets: [], width: p.width, bar: bar(p, 1.5, p.width / 2 + 1.5) });
  }
  // chains of small ports; a big port between two small ones breaks the chain
  const chains: Port[][] = [];
  const n = sorted.length;
  if (n > 0) {
    // start after a break, so a chain that wraps around the ring's start is found whole
    let start = 0;
    for (let i = 0; i < n; i++) {
      const prev = sorted[(i + n - 1) % n] as Port;
      const here = sorted[i] as Port;
      let gap = here.s - prev.s;
      if (gap < 0) gap += total;
      if (here.big || prev.big || gap > opts.chainGap || n === 1) {
        start = i;
        break;
      }
    }
    let chain: Port[] = [];
    for (let k = 0; k < n; k++) {
      const here = sorted[(start + k) % n] as Port;
      const prev = sorted[(start + k + n - 1) % n] as Port;
      let gap = here.s - prev.s;
      if (gap < 0) gap += total;
      if (here.big) {
        if (chain.length) chains.push(chain);
        chain = [];
        continue;
      }
      if (k > 0 && chain.length && gap > opts.chainGap) {
        chains.push(chain);
        chain = [];
      }
      chain.push(here);
    }
    if (chain.length) chains.push(chain);
  }
  const single = (p: Port, why = ''): Closure => {
    const wide = Math.max(4, p.width);
    if (LOOP_CLASSES.has(p.cls)) {
      const r = opts.loopRadius;
      const c = { x: p.x + p.dx * (6 + r), z: p.z + p.dz * (6 + r) };
      const circle: P2[] = [];
      for (let i = 0; i <= 24; i++) circle.push({ x: c.x + Math.cos((i / 24) * 2 * Math.PI) * r, z: c.z + Math.sin((i / 24) * 2 * Math.PI) * r });
      const stub = [{ x: p.x, z: p.z }, { x: p.x + p.dx * 6, z: p.z + p.dz * 6 }];
      const hit = opts.blocked ? opts.blocked([...stub, ...circle]) : null;
      if (!hit) {
        return {
          kind: 'loop', ports: [p.id], auto: true, review: p.cls === 'tertiary', streets: [stub, circle], width: Math.min(wide, 6), loop: { x: c.x, z: c.z, r },
          reason: `${p.name || `a ${p.cls} street`} has no neighbour within ${opts.chainGap} m: it ends in a turning loop${p.cls === 'tertiary' ? ' (a through street: check that a loop is right)' : ''}${why}`,
        };
      }
      return { kind: 'dead_end', ports: [p.id], auto: true, review: true, streets: [], width: wide, bar: bar(p, 3, wide / 2 + 1), reason: `${p.name || `a ${p.cls} street`}: no room for a loop (${hit}); it ends at a wall${why}` };
    }
    if (p.cls === 'service') return { kind: 'gate', ports: [p.id], auto: true, review: false, streets: [], width: wide, bar: bar(p, 2, wide / 2 + 1), reason: `a service road leaves the district here: it ends at a closed gate${why}` };
    return { kind: 'dead_end', ports: [p.id], auto: true, review: false, streets: [], width: wide, bar: bar(p, 3, wide / 2 + 1), reason: `a ${p.cls.replace('_', ' ')} lane: it ends at a wall of the edge band${why}` };
  };
  for (const chain of chains) {
    if (chain.length < 2) {
      out.push(single(chain[0] as Port));
      continue;
    }
    const first = chain[0] as Port;
    const last = chain[chain.length - 1] as Port;
    const line = backStreet(ring, first.s, last.s, opts.setback);
    const stubs = chain.map((p) => {
      const q = ringAt(ring, p.s);
      const end = line.reduce((m, v) => (Math.hypot(v.x - q.x, v.z - q.z) < Math.hypot(m.x - q.x, m.z - q.z) ? v : m), line[0] as P2);
      return [{ x: p.x, z: p.z }, { x: p.x + p.dx * 5, z: p.z + p.dz * 5 }, { x: end.x, z: end.z }];
    });
    const hit = line.length < 2 ? 'the clip line folds back on itself here' : opts.blocked ? opts.blocked(line) ?? stubs.map((s) => (opts.blocked as (l: readonly P2[]) => string | null)(s)).find((h) => h) ?? null : null;
    if (hit) {
      for (const p of chain) out.push(single(p, `; a street net was not possible (${hit})`));
      continue;
    }
    out.push({
      kind: 'street_net', ports: chain.map((p) => p.id), auto: true, review: false, streets: [line, ...stubs], width: 5,
      reason: `${chain.length} small roads leave the district within ${Math.round(((last.s - first.s + total) % total))} m of clip line: a generated back street ${opts.setback} m outside joins them`,
    });
  }
  return out;
}

export interface ClosureCount {
  ports: number;
  big: number;
  small: number;
  byKind: Record<ClosureKind, number>;
  /** Ports closed with no authored data (review or not). */
  auto: number;
  autoReview: number;
  /** Big ports: joined by an authored connector, and still open. */
  authored: number;
  open: number;
  autoShare: number;
}

export function countClosures(ports: readonly Port[], closures: readonly Closure[]): ClosureCount {
  const byKind: Record<ClosureKind, number> = { connector: 0, street_net: 0, loop: 0, gate: 0, dead_end: 0, open: 0 };
  let auto = 0;
  let review = 0;
  for (const c of closures) {
    byKind[c.kind] += c.ports.length;
    if (c.auto) auto += c.ports.length;
    if (c.auto && c.review) review += c.ports.length;
  }
  const big = ports.filter((p) => p.big).length;
  return { ports: ports.length, big, small: ports.length - big, byKind, auto, autoReview: review, authored: byKind.connector, open: byKind.open, autoShare: ports.length ? auto / ports.length : 1 };
}
