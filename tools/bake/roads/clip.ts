// Free road ends that run into another road's surface (P1-033). A dead end drawn up to the kerb of a hero road, two
// roads cut by the stage outline just before the junction where they meet (it lies outside the stage, in a later
// stage's bake): the end of the strip lies on the other road. Such an end has no junction and no joint; it stops where
// the other surface begins. The strip is shortened from that end, one station at a time, until it shares no area with
// any other strip, but by no more than CLIP_MAX_M, and only while something of it is left; the explained end keeps its kind. The
// last cut station is set back between the two stations around the point where the overlap ends (CLIP_REFINE steps).
// Pure.
import type { Joint, Station, Strip, StripEnd } from './model.ts';
import type { ExplainedEnd } from './netctx.ts';
import { OVERLAP_EPS_M2, stripOverlaps } from './overlap.ts';
import type { StripOverlap } from './overlap.ts';
import { overlapPoly, polyArea } from './trigrid.ts';
import type { Vec3 } from './trigrid.ts';

/** The most a free end gives up (m), and the kinds of end that may move. */
export const CLIP_MAX_M = 30;
const FREE: ReadonlySet<ExplainedEnd['kind']> = new Set(['dead_end', 'map_edge', 'gate', 'barricade']);
const ROUNDS = 4;
const CLIP_REFINE = 6;

export interface EndClips {
  /** Strip ends shortened, stations removed, and metres given up in all. */
  ends: number;
  stations: number;
  metres: number;
}

const quadTris = (p: Station, q: Station): Vec3[][] => {
  const v = (st: Station, lat: number): Vec3 => [st.x + st.nx * lat, 0, st.z + st.nz * lat];
  const n = p.b.length - 1;
  const a = v(p, p.b[0] as number);
  const c = v(p, p.b[n] as number);
  const d = v(q, q.b[0] as number);
  const e = v(q, q.b[n] as number);
  return [[a, c, d], [c, e, d]];
};

/** True when the quad between two stations shares area with the quad between `s` and `t`. */
function quadHits(p: Station, q: Station, s: Station, t: Station): boolean {
  for (const ta of quadTris(p, q)) {
    for (const tb of quadTris(s, t)) {
      const poly = overlapPoly(ta as [Vec3, Vec3, Vec3], tb as [Vec3, Vec3, Vec3]);
      if (poly.length >= 3 && polyArea(poly) >= OVERLAP_EPS_M2) return true;
    }
  }
  return false;
}

const lerpStation = (a: Station, b: Station, t: number): Station => {
  const nx = a.nx + (b.nx - a.nx) * t;
  const nz = a.nz + (b.nz - a.nz) * t;
  const l = Math.hypot(nx, nz) || 1;
  return {
    ...a, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: nx / l, nz: nz / l, s: a.s + (b.s - a.s) * t, h: a.h + (b.h - a.h) * t, g: a.g + (b.g - a.g) * t,
    b: a.b.map((v, i) => v + ((b.b[i] as number) - v) * t), edgeRaise: a.edgeRaise + (b.edgeRaise - a.edgeRaise) * t,
  };
};

export function clipEnds(strips: Strip[], joints: readonly Joint[], ends: readonly ExplainedEnd[]): EndClips {
  const free = new Set(ends.filter((e) => FREE.has(e.kind)).map((e) => `${e.strip}:${e.end}`));
  const out: EndClips = { ends: 0, stations: 0, metres: 0 };
  const clipped = new Set<string>();
  for (let round = 0; round < ROUNDS; round++) {
    const { overlaps } = stripOverlaps(strips, joints);
    // per strip end: the quads (counted from that end) another strip lies on, and which strip and quad that is
    const want = new Map<string, { depth: number; hits: [Station, Station][] }>();
    const note = (o: StripOverlap, mine: 'a' | 'b'): void => {
      const t = o[mine];
      const other = mine === 'a' ? o.b : o.a;
      const s = strips[t.strip] as Strip;
      const last = s.st.length - 2;
      for (const end of ['start', 'end'] as StripEnd[]) {
        if (!free.has(`${t.strip}:${end}`)) continue;
        const depth = end === 'start' ? t.quad + 1 : last - t.quad + 1;
        const key = `${t.strip}:${end}`;
        const w = want.get(key) ?? { depth: 0, hits: [] };
        w.depth = Math.max(w.depth, depth);
        // the other strip's quad by its stations: an index would move when that strip is clipped at its start
        const os = strips[other.strip] as Strip;
        w.hits.push([os.st[other.quad] as Station, os.st[other.quad + 1] as Station]);
        want.set(key, w);
      }
    };
    // a pair is settled by one end: the one that gives up less
    const pairs = new Map<string, StripOverlap[]>();
    for (const o of overlaps) {
      const k = `${o.a.strip}|${o.b.strip}`;
      const list = pairs.get(k);
      if (list) list.push(o);
      else pairs.set(k, [o]);
    }
    const chosen = new Map<string, { depth: number; hits: [Station, Station][] }>();
    for (const list of pairs.values()) {
      want.clear();
      for (const o of list) {
        note(o, 'a');
        note(o, 'b');
      }
      let best: string | null = null;
      for (const [key, w] of want) {
        const [si] = key.split(':');
        const s = strips[Number(si)] as Strip;
        const metres = lengthFrom(s, key.endsWith(':start') ? 'start' : 'end', w.depth);
        if (metres > CLIP_MAX_M || s.st.length - w.depth < 1) continue;
        if (best === null || w.depth < (want.get(best) as { depth: number }).depth) best = key;
      }
      if (best === null) continue;
      const w = want.get(best) as { depth: number; hits: [Station, Station][] };
      const prev = chosen.get(best);
      if (!prev || w.depth > prev.depth) chosen.set(best, { depth: Math.max(w.depth, prev?.depth ?? 0), hits: [...(prev?.hits ?? []), ...w.hits] });
      else prev.hits.push(...w.hits);
    }
    if (chosen.size === 0) break;
    for (const [key, w] of [...chosen].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
      const [si, end] = key.split(':') as [string, StripEnd];
      const s = strips[Number(si)] as Strip;
      const before = s.st.length;
      const metres0 = lengthFrom(s, end, before - 1);
      if (end === 'end') s.st.reverse();
      // drop the quads the other strips lie on; then set the new end back towards the dropped station while it stays clear
      const dropped = s.st.splice(0, w.depth);
      const keep = s.st[0] as Station;
      const next = dropped[dropped.length - 1] as Station;
      const clear = (st: Station): boolean => !w.hits.some(([a, b]) => quadHits(st, keep, a, b));
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < CLIP_REFINE; k++) {
        const mid = (lo + hi) / 2;
        if (clear(lerpStation(keep, next, mid))) lo = mid;
        else hi = mid;
      }
      if (lo > 0.05) s.st.unshift(lerpStation(keep, next, lo));
      if (s.st.length < 2) {
        // nothing of the strip would be left: it stays as it is
        s.st.unshift(...dropped);
        if (end === 'end') s.st.reverse();
        continue;
      }
      if (end === 'end') s.st.reverse();
      clipped.add(key);
      out.stations += before - s.st.length;
      out.metres += metres0 - lengthFrom(s, end, s.st.length - 1);
    }
  }
  out.ends = clipped.size;
  out.metres = Math.round(out.metres * 10) / 10;
  return out;
}

/** Length of the first `quads` quads of a strip from one end. */
function lengthFrom(s: Strip, end: StripEnd, quads: number): number {
  let len = 0;
  const n = s.st.length;
  for (let k = 0; k < quads && k + 1 < n; k++) {
    const i = end === 'start' ? k : n - 1 - k;
    const j = end === 'start' ? k + 1 : n - 2 - k;
    len += Math.hypot((s.st[i] as Station).x - (s.st[j] as Station).x, (s.st[i] as Station).z - (s.st[j] as Station).z);
  }
  return len;
}
