// End kerbs (P1-037): a road that the lane model closes as a dead end used to stop as a square cut with the ground
// right at the asphalt's edge. Now a raised kerb runs across the whole end, as on a real closed lane: the kerb faces
// rise from the carriageway to it, a cap closes its far side, and the ground meets its top. Only ends at grade, and
// only where nothing else lies (another road, a junction): such an end stays as it was and is counted. Pure.
import { sharedArea } from './clip.ts';
import type { Corner, FaceSet } from './faces.ts';
import type { MeshInput } from './input.ts';
import { K_GRADE, cutOf, sheetOf } from './stripfaces.ts';
import type { Borders } from './stripfaces.ts';
import type { FaceGrid } from './structures.ts';
import { KERB_RAISE } from '../roads/model.ts';
import type { Station, Strip } from '../roads/model.ts';

/** How deep the kerb across a closed end is, along the road (m). */
export const END_KERB_M = 0.45;

export interface EndKerbReport {
  /** Dead ends of the lane model, and how many got a kerb. */
  deadEnds: number;
  kerbs: number;
  /** Left as they were: not at grade (a raised or lowered end), or another face lies where the kerb would go. */
  notAtGrade: number;
  blocked: number;
  /** Faces of the kerbs (for the overlap proof and the pictures). */
  faces: number[];
  /** Where the kerbs are (block metres): the middle of the end line. */
  at: { strip: number; end: 'start' | 'end'; x: number; z: number }[];
}

export function addEndKerbs(fs: FaceSet, input: Pick<MeshInput, 'strips' | 'kinds' | 'ends'>, borders: Borders, grid: FaceGrid): EndKerbReport {
  const out: EndKerbReport = { deadEnds: 0, kerbs: 0, notAtGrade: 0, blocked: 0, faces: [], at: [] };
  for (const e of input.ends) {
    if (e.kind !== 'dead_end') continue;
    out.deadEnds++;
    const s = input.strips[e.strip] as Strip;
    const kind = input.kinds[e.strip] as ArrayLike<number>;
    const n = s.st.length;
    if (n < 2) continue;
    const i = e.end === 'start' ? 0 : n - 1;
    const j = e.end === 'start' ? 1 : n - 2;
    if (kind[i] !== K_GRADE || kind[j] !== K_GRADE) {
      out.notAtGrade++;
      continue;
    }
    const st = s.st[i] as Station;
    const nb = s.st[j] as Station;
    const len = Math.hypot(st.x - nb.x, st.z - nb.z) || 1;
    // outwards, past the end
    const ox = ((st.x - nb.x) / len) * END_KERB_M;
    const oz = ((st.z - nb.z) / len) * END_KERB_M;
    const L = s.lanes.length;
    const W = L + 1;
    const u = borders.of(e.strip);
    const y = st.h + KERB_RAISE;
    const v0 = st.s;
    const v1 = st.s + (e.end === 'start' ? -END_KERB_M : END_KERB_M);
    const back: Corner[] = [];
    for (let k = 0; k <= L; k++) back.push({ x: u.x[i * W + k] as number, z: u.z[i * W + k] as number, y, u: 0, v: v0 });
    const first = back[0] as Corner;
    const last = back[L] as Corner;
    if (Math.hypot(last.x - first.x, last.z - first.z) < 0.5) continue;
    // the ring: the end line through every lane border, then out and back across
    const ring: Corner[] = [...back, { x: last.x + ox, z: last.z + oz, y, u: 0, v: v1 }, { x: first.x + ox, z: first.z + oz, y, u: 0, v: v1 }];
    const quad: [number, number][] = [[first.x, first.z], [last.x, last.z], [last.x + ox, last.z + oz], [first.x + ox, first.z + oz]];
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of quad) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const others = grid.near(x0, z0, x1, z1).filter((f) => fs.piece[f] !== e.strip);
    if (others.length && sharedArea([quad], others.map((f) => fs.ring(f)), { x: first.x, z: first.z }) > 1e-4) {
      out.blocked++;
      continue;
    }
    const seg = Math.min(i, j);
    const f = fs.add(ring, { piece: e.strip, kind: 'kerb', cut: cutOf(K_GRADE, K_GRADE), raise: KERB_RAISE, sheet: sheetOf(st, K_GRADE), station: seg });
    if (f < 0) continue;
    out.kerbs++;
    out.faces.push(f);
    out.at.push({ strip: e.strip, end: e.end, x: (first.x + last.x) / 2 + ox / 2, z: (first.z + last.z) / 2 + oz / 2 });
  }
  return out;
}
