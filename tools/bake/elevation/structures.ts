// Structures read from the solved heights (P1-013, MAP_REPAIR.md "Elevation solver": "abutments are simply where a
// profile leaves the ground"). No tag makes a structure: a road more than 2 m off the ground model is on (or in)
// one, and the structure runs on along the road, both ways, until the road is back within 0.6 m of the ground:
// those ends are the abutments. Raised: a deck on piers above 3 m, a ramp on fill between walls under it. Lowered:
// a tunnel where the map says tunnel, an open cut between walls elsewhere. The two carriageways of a street and
// the ramps that join them are one structure. Each is listed with its kind, its length (structureM) and how far
// a road was lowered for it (sunk). Pure.
import type { Joint, Station, Strip } from '../roads/model.ts';
import type { Crossings, ElevationJunction, WaterArea } from './crossings.ts';
import { AT_GRADE_M, DECK_MIN_M, STRUCTURE_M } from './limits.ts';
import type { PairSample } from './solve.ts';

export type StructureKind = 'deck' | 'fill' | 'cut' | 'tunnel';
/** Per station: 0 at grade, 1 fill, 2 deck, 3 cut, 4 tunnel. */
export const STATION_KINDS: readonly (StructureKind | 'grade')[] = ['grade', 'fill', 'deck', 'cut', 'tunnel'];

export interface Structure {
  id: string;
  kind: StructureKind;
  /** Street names along it (the three longest). */
  name: string;
  strips: number;
  /** Metres of road on (or in) the structure, every carriageway and ramp counted. */
  structureM: number;
  deckM: number;
  fillM: number;
  cutM: number;
  tunnelM: number;
  /** Of structureM, the metres that carry no bridge or tunnel tag: where the solver started the ramp before the tag. */
  untaggedM: number;
  maxAboveM: number;
  maxBelowM: number;
  /**
   * Metres under the ground model. For a deck or a fill: of the lowest road that passes under it (0 when nothing
   * had to be lowered to keep the clearance). For a cut or a tunnel: of its own road at its deepest.
   */
  sunk: number;
  /** What it crosses: road names, "railway", "water: <name>". */
  crosses: string[];
  /** Block metres of its highest (or deepest) point. */
  x: number;
  z: number;
  abutments: number;
  /** Ends that do not come back to the ground: the structure runs on past the map edge or stops at a dead end. */
  openEnds: number;
}

export interface Abutment {
  strip: number;
  station: number;
  x: number;
  z: number;
  /** Height above the ground model there (negative in a cut). */
  hag: number;
  open: boolean;
  /** The open end is a map edge end: the structure goes on outside the stage. */
  mapEdge: boolean;
}

export interface StructureResult {
  /** Per strip and station: the index into STATION_KINDS. */
  kinds: Uint8Array[];
  structures: Structure[];
  abutments: Abutment[];
}

export interface StructureInput {
  strips: Strip[];
  joints: readonly Joint[];
  junctions: readonly ElevationJunction[];
  junctionHeights: readonly number[];
  tunnels: readonly (ArrayLike<number> | undefined)[];
  crossings: Crossings;
  pairSamples: readonly PairSample[];
  water?: readonly WaterArea[];
  /** Map edge ends (the solve's ties). */
  ties?: readonly { strip: number; end: 'start' | 'end' }[];
  ground: (x: number, z: number) => number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

/** Marks every station (also `structure` on the station: 1 fill, 2 deck, else 0) and lists the structures. */
export function readStructures(input: StructureInput): StructureResult {
  const { strips, joints } = input;
  const tun = (si: number, i: number): number => input.tunnels[si]?.[i] ?? 0;
  const hag = (si: number, i: number): number => ((strips[si] as Strip).st[i] as Station).h - ((strips[si] as Strip).st[i] as Station).g;
  // +1 raised, -1 lowered, 0 at grade
  const side: Int8Array[] = strips.map((s, si) => Int8Array.from(s.st, (_, i) => (hag(si, i) > STRUCTURE_M ? 1 : hag(si, i) < -STRUCTURE_M || (tun(si, i) === 1 && hag(si, i) < -AT_GRADE_M) ? -1 : 0)));
  const off = (si: number, i: number, sign: number): boolean => hag(si, i) * sign > AT_GRADE_M;
  const endIdx = (e: { strip: number; end: 'start' | 'end' }): number => (e.end === 'start' ? 0 : (strips[e.strip] as Strip).st.length - 1);
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    strips.forEach((_, si) => {
      const o = side[si] as Int8Array;
      for (let i = 1; i < o.length; i++) {
        if (o[i - 1] !== 0 && o[i] === 0 && off(si, i, o[i - 1] as number)) {
          o[i] = o[i - 1] as number;
          changed = true;
        }
      }
      for (let i = o.length - 2; i >= 0; i--) {
        if (o[i + 1] !== 0 && o[i] === 0 && off(si, i, o[i + 1] as number)) {
          o[i] = o[i + 1] as number;
          changed = true;
        }
      }
    });
    // the two ends of a joint are one cross-section
    for (const j of joints) {
      const a = (side[j.a.strip] as Int8Array)[endIdx(j.a)] as number;
      const b = (side[j.b.strip] as Int8Array)[endIdx(j.b)] as number;
      if (a !== b && (a === 0 || b === 0)) {
        (side[j.a.strip] as Int8Array)[endIdx(j.a)] = (side[j.b.strip] as Int8Array)[endIdx(j.b)] = a || b;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const kinds = strips.map((s, si) => Uint8Array.from(s.st, (_, i) => {
    const o = (side[si] as Int8Array)[i] as number;
    return o > 0 ? (hag(si, i) > DECK_MIN_M ? 2 : 1) : o < 0 ? (tun(si, i) === 1 ? 4 : 3) : 0;
  }));
  strips.forEach((s, si) => s.st.forEach((st, i) => {
    const k = (kinds[si] as Uint8Array)[i] as number;
    st.structure = k === 1 || k === 2 ? k : 0;
  }));

  // connected stretches are one structure: along a strip, through joints and junctions, across the two carriageways
  const base: number[] = [];
  let total = 0;
  for (const s of strips) {
    base.push(total);
    total += s.st.length;
  }
  const parent = new Int32Array(total);
  for (let i = 0; i < total; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  const id = (si: number, i: number): number => (base[si] as number) + i;
  const sideAt = (si: number, i: number): number => (side[si] as Int8Array)[i] as number;
  const unite = (a: [number, number], b: [number, number]): void => {
    if (sideAt(a[0], a[1]) !== 0 && sideAt(a[0], a[1]) === sideAt(b[0], b[1])) parent[Math.max(find(id(a[0], a[1])), find(id(b[0], b[1])))] = Math.min(find(id(a[0], a[1])), find(id(b[0], b[1])));
  };
  strips.forEach((s, si) => {
    for (let i = 1; i < s.st.length; i++) unite([si, i - 1], [si, i]);
  });
  for (const j of joints) unite([j.a.strip, endIdx(j.a)], [j.b.strip, endIdx(j.b)]);
  for (const jn of input.junctions) for (let a = 0; a < jn.arms.length; a++) for (let b = a + 1; b < jn.arms.length; b++) unite([(jn.arms[a] as { strip: number }).strip, endIdx(jn.arms[a] as { strip: number; end: 'start' | 'end' })], [(jn.arms[b] as { strip: number }).strip, endIdx(jn.arms[b] as { strip: number; end: 'start' | 'end' })]);
  for (const p of input.pairSamples) unite(p.a, p.b);

  interface Acc { sign: number; strips: Set<number>; m: number[]; untagged: number; above: number; below: number; x: number; z: number; names: Map<string, number>; crosses: Set<string>; sunk: number; abutments: number; open: number; first: number }
  const acc = new Map<number, Acc>();
  const get = (si: number, i: number): Acc | null => {
    if (sideAt(si, i) === 0) return null;
    const root = find(id(si, i));
    let a = acc.get(root);
    if (!a) {
      a = { sign: sideAt(si, i), strips: new Set(), m: [0, 0, 0, 0, 0], untagged: 0, above: 0, below: 0, x: 0, z: 0, names: new Map(), crosses: new Set(), sunk: 0, abutments: 0, open: 0, first: root };
      acc.set(root, a);
    }
    return a;
  };
  // which strip ends go on into something (a joint or a junction): an end that does not is open
  const continues = new Set<number>();
  for (const j of joints) for (const e of [j.a, j.b]) continues.add(e.strip * 2 + (e.end === 'start' ? 0 : 1));
  for (const jn of input.junctions) for (const e of jn.arms) continues.add(e.strip * 2 + (e.end === 'start' ? 0 : 1));
  const atEdge = new Set((input.ties ?? []).map((t) => t.strip * 2 + (t.end === 'start' ? 0 : 1)));
  const abutments: Abutment[] = [];
  strips.forEach((s, si) => {
    for (let i = 0; i < s.st.length; i++) {
      const a = get(si, i);
      if (!a) continue;
      const st = s.st[i] as Station;
      const h = hag(si, i);
      a.strips.add(si);
      if (h > a.above || -h > a.below) {
        if (h > a.above) a.above = h;
        if (-h > a.below) a.below = -h;
        a.x = st.x;
        a.z = st.z;
      }
      if (a.sign < 0) a.sunk = Math.max(a.sunk, -h);
      const next = s.st[i + 1];
      if (next && sideAt(si, i + 1) === sideAt(si, i)) {
        const d = Math.hypot(next.x - st.x, next.z - st.z);
        const k = (kinds[si] as Uint8Array)[i] as number;
        a.m[k] = (a.m[k] as number) + d;
        if (!(st.bridge || tun(si, i) === 1)) a.untagged += d;
        if (s.name) a.names.set(s.name, (a.names.get(s.name) ?? 0) + d);
      }
      const edge = i === 0 || i === s.st.length - 1;
      const inner = (i > 0 && sideAt(si, i - 1) === 0) || (i + 1 < s.st.length && sideAt(si, i + 1) === 0);
      const open = edge && !continues.has(si * 2 + (i === 0 ? 0 : 1)) && Math.abs(h) > AT_GRADE_M;
      if (inner || open) {
        a.abutments++;
        if (open) a.open++;
        abutments.push({ strip: si, station: i, x: st.x, z: st.z, hag: r2(h), open, mapEdge: open && atEdge.has(si * 2 + (i === 0 ? 0 : 1)) });
      }
    }
  });
  // what each structure crosses, and how far the road under a raised one lies below the ground
  const nameOf = (si: number): string => (strips[si] as Strip).name || `${(strips[si] as Strip).cls} road`;
  for (const x of input.crossings.roads) {
    const up = get(x.up, x.upStation);
    const low = (strips[x.low] as Strip).st[x.lowStation] as Station;
    if (up && up.sign > 0) {
      up.crosses.add(nameOf(x.low));
      up.sunk = Math.max(up.sunk, low.g - low.h);
    }
    const down = get(x.low, x.lowStation);
    if (down && down.sign < 0) down.crosses.add(nameOf(x.up));
  }
  for (const x of input.crossings.junctions) {
    const jn = input.junctions[x.junction] as ElevationJunction;
    for (const i of x.stations) {
      const a = get(x.strip, i);
      if (!a) continue;
      for (const arm of jn.arms.slice(0, 2)) a.crosses.add(nameOf(arm.strip));
      if (a.sign > 0 && x.above) a.sunk = Math.max(a.sunk, input.ground(jn.centre.x, jn.centre.z) - (input.junctionHeights[x.junction] as number));
    }
  }
  for (const x of input.crossings.rails) get(x.strip, x.station)?.crosses.add('railway');
  for (const w of input.crossings.water) for (let i = w.first; i <= w.last; i++) get(w.strip, i)?.crosses.add(`water: ${(input.water?.[w.water] as WaterArea | undefined)?.name || 'unnamed'}`);

  const structures: Structure[] = [...acc.values()].sort((a, b) => a.first - b.first).map((a, n) => {
    const [, fill, deck, cut, tunnel] = a.m as [number, number, number, number, number];
    const kind: StructureKind = a.sign > 0 ? (deck > 0 || a.above > DECK_MIN_M ? 'deck' : 'fill') : tunnel > 0 ? 'tunnel' : 'cut';
    const names = [...a.names].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).slice(0, 3).map((p) => p[0]);
    return {
      id: `S${n + 1}`, kind, name: names.join(', '), strips: a.strips.size, structureM: r2(fill + deck + cut + tunnel), deckM: r2(deck), fillM: r2(fill), cutM: r2(cut), tunnelM: r2(tunnel),
      untaggedM: r2(a.untagged), maxAboveM: r2(a.above), maxBelowM: r2(a.below), sunk: r2(Math.max(0, a.sunk)), crosses: [...a.crosses].sort().slice(0, 8), x: r2(a.x), z: r2(a.z), abutments: a.abutments, openEnds: a.open,
    };
  });
  return { kinds, structures, abutments };
}
