// Pairing of one-way carriageways (MAP_REPAIR.md "Pipeline" step 2): OSM draws a divided street as two one-way ways,
// often with different names on the two halves ("Inderprastha Marg" and "Indraprastha Marg", "Tilak Marg" and
// "Tilak Road") or no name on one of them (Mathura Road along Pragati Maidan has none). Two edges are one street when
// they run in opposite directions side by side, each on the right of the other (Delhi keeps left), within
// PAIR_GAP metres along enough of their length, with names that agree. Halves with two different names pair only when
// they run tight (TIGHT_GAP) along most of both lengths (the Shivaji flyover drawn as "Shivaji Flyover" one way and
// "Maharaja Ranjeet Singh Marg" the other); such a pair is marked `namesDiffer` for review. Roundabouts and links
// never pair. Pure.
import { Grid, boxOf, pointSegment } from '../geom.ts';
import type { P2 } from '../geom.ts';

/** Classes whose one-way ways may be half of a divided street. */
export const PAIR_CLASSES: ReadonlySet<string> = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
/** Farthest centre line distance between two carriageways of one street (m; the medians of the pilot reach 40). */
export const PAIR_GAP = 45;
/** Closest (m): two lines closer than this are a duplicate or a drawing error, not two carriageways. */
export const PAIR_MIN_GAP = 1;
/** Two halves with different names must stay this close (m) to pair. */
export const TIGHT_GAP = 16;
const STEP = 8;

export interface PairEdge {
  index: number;
  pts: P2[];
  len: number;
  cls: string;
  name: string;
  ref: string;
  /** Highest layer the edge reaches on a bridge or in a tunnel (0 at grade): halves with different names must match. */
  level: number;
  /** Candidate for pairing: one-way, not a link, not a roundabout, of a PAIR_CLASSES class. */
  pairable: boolean;
}

export interface PairResult {
  a: number;
  b: number;
  /** Metres of a and of b that found the other beside them. */
  matchedA: number;
  matchedB: number;
  /** Median centre line distance (m). */
  gap: number;
  /** The two halves carry different names: paired on geometry alone. */
  namesDiffer: boolean;
}

const GENERIC = new Set(['road', 'rd', 'marg', 'street', 'st', 'path', 'avenue', 'lane']);

/** A street name for comparison: lower case, letters and digits only, without the generic words. */
export function normName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !GENERIC.has(w))
    .join(' ');
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] as number;
      row[j] = Math.min((row[j] as number) + 1, (row[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] as number;
}

/** Names that may be the two halves of one street: equal after normName, a spelling apart, or one of them missing. */
export function namesAgree(a: PairEdge, b: PairEdge): boolean {
  if (a.cls !== b.cls && (!a.name || !b.name)) return false;
  if (a.ref && b.ref && a.ref === b.ref) return true;
  const na = normName(a.name);
  const nb = normName(b.name);
  if (!na || !nb) return true;
  if (na === nb) return true;
  // "Radial Road 3" and "Radial Road 4" are two streets, however alike the rest of the name is
  if ((na.match(/\d+/g) ?? []).join(',') !== (nb.match(/\d+/g) ?? []).join(',')) return false;
  const longest = Math.max(na.length, nb.length);
  return longest >= 6 && editDistance(na, nb) / longest <= 0.2;
}

interface Seg {
  edge: PairEdge;
  a: P2;
  b: P2;
}

/** Points every STEP metres with the direction of travel there, the ends left out. */
function samples(pts: readonly P2[], len: number): { p: P2; tx: number; tz: number }[] {
  const out: { p: P2; tx: number; tz: number }[] = [];
  const n = Math.max(3, Math.floor(len / STEP));
  const step = len / (n + 1);
  let seg = 0;
  let segStart = 0;
  for (let k = 1; k <= n; k++) {
    const s = k * step;
    while (seg + 2 < pts.length && segStart + Math.hypot((pts[seg + 1] as P2).x - (pts[seg] as P2).x, (pts[seg + 1] as P2).z - (pts[seg] as P2).z) < s) {
      segStart += Math.hypot((pts[seg + 1] as P2).x - (pts[seg] as P2).x, (pts[seg + 1] as P2).z - (pts[seg] as P2).z);
      seg++;
    }
    const a = pts[seg] as P2;
    const b = pts[seg + 1] as P2;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const t = Math.min(1, Math.max(0, (s - segStart) / l));
    out.push({ p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l });
  }
  return out;
}

/**
 * Pairs of carriageways. For every sample of a candidate edge, the nearest other candidate that runs the opposite way
 * on its right within PAIR_GAP counts STEP metres for that edge. A pair needs, from either side, at least
 * min(40 m, half the edge) of matched length.
 */
export function pairCarriageways(edges: readonly PairEdge[]): PairResult[] {
  const cand = edges.filter((e) => e.pairable && e.len >= 10);
  const grid = new Grid<Seg>(PAIR_GAP);
  for (const e of cand) {
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i] as P2;
      const b = e.pts[i + 1] as P2;
      grid.insert(boxOf([a, b]), { edge: e, a, b });
    }
  }
  const matched = new Map<string, { a: number; b: number; ab: number; ba: number; gaps: number[]; differ: boolean }>();
  for (const e of cand) {
    const list = samples(e.pts, e.len);
    const per = e.len / (list.length + 1);
    for (const s of list) {
      let best: { edge: PairEdge; d: number } | null = null;
      for (const seg of grid.query(boxOf([s.p]), PAIR_GAP)) {
        if (seg.edge === e) continue;
        const agree = namesAgree(e, seg.edge);
        const pr = pointSegment(s.p, seg.a, seg.b);
        if (pr.d > (agree ? PAIR_GAP : TIGHT_GAP) || pr.d < PAIR_MIN_GAP || (!agree && e.level !== seg.edge.level)) continue;
        const sx = seg.b.x - seg.a.x;
        const sz = seg.b.z - seg.a.z;
        const sl = Math.hypot(sx, sz) || 1;
        if ((s.tx * sx + s.tz * sz) / sl > -0.7) continue;
        // left-hand traffic: the other carriageway is on the right of the direction of travel
        if ((pr.x - s.p.x) * s.tz - (pr.z - s.p.z) * s.tx >= 0) continue;
        if (!best || pr.d < best.d || (pr.d === best.d && seg.edge.index < best.edge.index)) best = { edge: seg.edge, d: pr.d };
      }
      if (!best) continue;
      const lo = Math.min(e.index, best.edge.index);
      const hi = Math.max(e.index, best.edge.index);
      const key = `${lo}:${hi}`;
      const m = matched.get(key) ?? { a: lo, b: hi, ab: 0, ba: 0, gaps: [], differ: !namesAgree(e, best.edge) };
      if (e.index === lo) m.ab += per;
      else m.ba += per;
      m.gaps.push(best.d);
      matched.set(key, m);
    }
  }
  const byIndex = new Map(cand.map((e) => [e.index, e]));
  const out: PairResult[] = [];
  for (const m of matched.values()) {
    const ea = byIndex.get(m.a) as PairEdge;
    const eb = byIndex.get(m.b) as PairEdge;
    if (m.differ) {
      // different names: most of both edges, from both sides
      if (m.ab < Math.min(60, ea.len * 0.6) || m.ba < Math.min(60, eb.len * 0.6)) continue;
    } else if (m.ab < Math.min(40, ea.len / 2) && m.ba < Math.min(40, eb.len / 2)) continue;
    const gaps = m.gaps.slice().sort((x, y) => x - y);
    out.push({ a: m.a, b: m.b, matchedA: round1(m.ab), matchedB: round1(m.ba), gap: round1(gaps[Math.floor(gaps.length / 2)] as number), namesDiffer: m.differ });
  }
  out.sort((x, y) => x.a - y.a || x.b - y.b);
  return out;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
