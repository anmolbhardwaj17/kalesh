// Gate counts of the road mesh (P1-014, MAP_REPAIR.md "Verification"). Every check reads the finished faces and
// the draw meshes, not the builder's notes: the overlap proof (proof.ts), the watertight check (free edges that do
// not close, edges used twice, T joints left), strip ends that join nothing, raised ends in the air, parapets away
// from a structure, piers standing in a lane of another level, kerb heights, the lane UV, the stop lines, the length
// of connecting lane path that lies on no road face. Pure.
import type { LaneDef, Station, Strip } from '../roads/model.ts';
import type { RoadMesh } from './build.ts';
import { sharedArea } from './clip.ts';
import { edgeKey } from './conform.ts';
import { LANE_KINDS } from './faces.ts';
import type { MeshInput } from './input.ts';
import { arrivingLanes, sectionAt } from './paint.ts';
import { inFace } from './portal.ts';
import { proveNoOverlap } from './proof.ts';
import type { OverlapProof } from './proof.ts';
import { K_DECK, K_FILL, K_GRADE } from './stripfaces.ts';
import { blocksPier } from './structures.ts';

/** A parapet triangle lies on its structure's stretch of road, or this close to its edge (m). */
export const PARAPET_REACH_M = 0.6;

export interface MeshChecks {
  overlap: OverlapProof;
  watertight: {
    /** Free edges that do not close into a loop, edges two faces have the same way round, vertices left on another face's free edge: 0 for a watertight surface. */
    openBoundaryEdges: number;
    unclosed: number;
    doubled: number;
    tJointsLeft: number;
    /** Where the first doubled edges and unclosed chains are (block metres; the health record turns them into world metres). */
    doubledAt: { x: number; z: number; pieces: [number, number] }[];
    unclosedAt: { x: number; z: number; edges: number }[];
    zeroAt: { x: number; z: number; edges: number }[];
    tJointsAt: { x: number; z: number; piece: number }[];
    freeEdges: number;
    loops: number;
    /** Loops around a road region, and loops around a block the roads enclose. */
    outerLoops: number;
    blockLoops: number;
    sliverLoops: number;
    sliverM2: number;
    tJointsRepaired: number;
    nearMisses: number;
    nearMissMaxM: number;
  };
  ends: {
    stripEnds: number;
    /** Ends whose every driving lane is shared with the face after it: a joint or a junction. */
    joined: number;
    explained: Record<string, number>;
    /** Ends with a driving lane that meets nothing and no reason in the lane model. */
    unjoined: number;
    unjoinedList: { strip: string; end: string; x: number; z: number }[];
    /** Raised ends (a deck or a walled ramp) with nothing after them and not at the map edge. */
    floating: number;
    floatingList: { strip: string; end: string; kind: string; x: number; z: number; aboveGroundM: number }[];
  };
  railings: { segments: number; parapets: number; byKind: Record<string, number>; parapetTriangles: number; atGrade: number; list: { x: number; z: number }[] };
  /** Piers (portal legs counted one by one), and the spans longer than LONG_SPAN_M with the reason no portal stands in them. */
  piers: { piers: number; portals: number; inLane: number; list: { strip: string; x: number; z: number; areaM2: number }[]; moved: number; maxSpanM: number; longSpans: { strip: string; x: number; z: number; spanM: number; why: string }[]; joints: number };
  kerbs: RoadMesh['steps']['kerbs'];
  uv: {
    lanes: number;
    corners: number;
    /** Corners whose u is not the corner's place across its lane (0 at the left border, 1 at the right). */
    badU: number;
    /** Corners whose v is not the metres along the road of the station they stand on. */
    badV: number;
    /** Vertices two lanes of one strip share where the two disagree about v. */
    borderMismatch: number;
    /** Lane pairs at a joint inside one road whose v differs across the joint by more than a centimetre. */
    jointPairs: number;
    jointMismatch: number;
    /** Lane triangles in the draw meshes (each carries a UV), road triangles with a line on a border, meshes whose UV does not cover every vertex, and border codes the shader does not know. */
    laneTriangles: number;
    markedTriangles: number;
    unaligned: number;
    badCodes: number;
    /** Metres of v per metre of lane centre line, smallest and largest (1 on a straight road). */
    stretchMin: number;
    stretchMax: number;
    ok: boolean;
  };
  stopLines: { armsThatStop: number; lines: number; missing: number; crossings: number; list: { junction: string; arm: number; why: string }[] };
  /** Connecting lane paths of the junctions, sampled every metre: the length that lies on no road face at all (P1-042), and the junctions with the most. */
  paths: { junctions: number; totalM: number; offFaceM: number; worst: { junction: string; offM: number }[] };
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

export function checkRoadMesh(input: MeshInput, mesh: RoadMesh): MeshChecks {
  const { fs, edges } = mesh;
  const { strips, kinds } = input;
  const name = (piece: number): string => (piece < strips.length ? (strips[piece] as Strip).id : (input.junctions[piece - strips.length] as { id: string }).id);
  const overlap = proveNoOverlap(fs, strips, input.joints, mesh.index, mesh.junctions.faces, mesh.junctions.sheets, name, mesh.medianFaces);

  // ends: from the faces, lane by lane
  const explained = new Map<string, string>();
  for (const e of input.ends) explained.set(`${e.strip}:${e.end}`, e.kind);
  const ends: MeshChecks['ends'] = { stripEnds: 0, joined: 0, explained: {}, unjoined: 0, unjoinedList: [], floating: 0, floatingList: [] };
  strips.forEach((s, si) => {
    const u = mesh.borders.of(si);
    const W = s.lanes.length + 1;
    const n = s.st.length;
    for (const end of ['start', 'end'] as const) {
      ends.stripEnds++;
      const i = end === 'start' ? 0 : n - 1;
      const st = s.st[i] as Station;
      let open = false;
      s.lanes.forEach((l: LaneDef, k: number) => {
        if (l.type !== 'drive' || (st.b[k] as number) - (st.b[k + 1] as number) < 0.05) return;
        const a = fs.find(u.x[i * W + k] as number, u.z[i * W + k] as number);
        const b = fs.find(u.x[i * W + k + 1] as number, u.z[i * W + k + 1] as number);
        // the lane's own edge across the road runs right to left at the start, left to right at the end
        const own = end === 'start' ? edgeKey(b, a) : edgeKey(a, b);
        const twin = end === 'start' ? edgeKey(a, b) : edgeKey(b, a);
        // an edge that is no longer there was split by a vertex of the face after it: joined
        if (a >= 0 && b >= 0 && edges.at.has(own) && !edges.at.has(twin)) open = true;
      });
      const why = explained.get(`${si}:${end}`);
      if (!open) ends.joined++;
      else if (why) ends.explained[why] = (ends.explained[why] ?? 0) + 1;
      else {
        ends.unjoined++;
        if (ends.unjoinedList.length < 30) ends.unjoinedList.push({ strip: s.id, end, x: r1(st.x), z: r1(st.z) });
      }
      const kind = (kinds[si] as ArrayLike<number>)[i] as number;
      if (open && why !== 'map_edge' && (kind === K_DECK || kind === K_FILL)) {
        ends.floating++;
        if (ends.floatingList.length < 30) ends.floatingList.push({ strip: s.id, end, kind: kind === K_DECK ? 'deck' : 'fill', x: r1(st.x), z: r1(st.z), aboveGroundM: Math.round((st.h - st.g) * 100) / 100 });
      }
    }
  });

  // parapets: every triangle of the parapet mesh lies beside a structure station
  const railings: MeshChecks['railings'] = { segments: mesh.structures.segments.length, parapets: mesh.structures.parapets, byKind: mesh.structures.byKind, parapetTriangles: 0, atGrade: 0, list: [] };
  const par = mesh.sink.meshes.get('parapet');
  if (par) {
    for (let t = 0; t + 2 < par.idx.length; t += 3) {
      railings.parapetTriangles++;
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < 3; k++) {
        cx += (par.pos[(par.idx[t + k] as number) * 3] as number) / 3;
        cz += (par.pos[(par.idx[t + k] as number) * 3 + 2] as number) / 3;
      }
      let onStructure = false;
      // the stretches around the point: a wall stands at, or just outside, the edge of its road
      const nearby = new Set<number>();
      for (const [ox, oz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]] as [number, number][]) for (const id of mesh.index.around(cx + ox, cz + oz)) nearby.add(id);
      for (const id of nearby) {
        const si = mesh.index.strip[id] as number;
        const i = mesh.index.station[id] as number;
        const k = kinds[si] as ArrayLike<number>;
        if (k[i] === K_GRADE && k[i + 1] === K_GRADE) continue;
        // on the stretch, or within a wall's width of its edge (a cut's wall stands outside the road)
        const quad = mesh.index.quad(si, i);
        let inside = false;
        let dist = Infinity;
        for (let a = 0, b = quad.length - 1; a < quad.length; b = a++) {
          const [ax, az] = quad[a] as [number, number];
          const [bx, bz] = quad[b] as [number, number];
          if (az > cz !== bz > cz && cx < ((bx - ax) * (cz - az)) / (bz - az) + ax) inside = !inside;
          const dx = bx - ax;
          const dz = bz - az;
          const t2 = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz || 1)));
          dist = Math.min(dist, Math.hypot(cx - (ax + dx * t2), cz - (az + dz * t2)));
        }
        if (inside || dist <= PARAPET_REACH_M) {
          onStructure = true;
          break;
        }
      }
      if (!onStructure) {
        railings.atGrade++;
        if (railings.list.length < 20) railings.list.push({ x: r1(cx), z: r1(cz) });
      }
    }
  }

  // piers: none in a face of another level
  const longSpans = mesh.structures.longSpans.map((l) => {
    const s = strips[l.strip] as Strip;
    const st = s.st[Math.min(l.station, s.st.length - 1)] as Station;
    return { strip: s.id, x: r1(st.x), z: r1(st.z), spanM: l.spanM, why: l.why };
  });
  const piers: MeshChecks['piers'] = { piers: mesh.structures.piers.length, portals: mesh.structures.portals, inLane: 0, list: [], moved: mesh.structures.piersMoved, maxSpanM: mesh.structures.maxSpanM, longSpans, joints: mesh.structures.joints };
  for (const p of mesh.structures.piers) {
    const xs = p.ring.map((q) => q[0]);
    const zs = p.ring.map((q) => q[1]);
    const under = mesh.grid.near(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)).filter((f) => blocksPier(fs, f, p.sheet));
    if (!under.length) continue;
    const area = sharedArea([p.ring], under.map((f) => fs.ring(f)), { x: xs[0] as number, z: zs[0] as number });
    if (area > 0.01) {
      piers.inLane++;
      if (piers.list.length < 20) piers.list.push({ strip: (strips[p.strip] as Strip).id, x: r1(xs[0] as number), z: r1(zs[0] as number), areaM2: Math.round(area * 100) / 100 });
    }
  }

  // the lane UV
  const uv: MeshChecks['uv'] = { lanes: 0, corners: 0, badU: 0, badV: 0, borderMismatch: 0, jointPairs: 0, jointMismatch: 0, laneTriangles: 0, markedTriangles: 0, unaligned: 0, badCodes: 0, stretchMin: Infinity, stretchMax: 0, ok: false };
  const drive = LANE_KINDS.indexOf('drive');
  strips.forEach((s, si) => {
    const vAt = new Map<number, number>();
    const u = mesh.borders.of(si);
    const W = s.lanes.length + 1;
    for (let f = mesh.stripFaces.first[si] as number; f < (mesh.stripFaces.first[si + 1] as number); f++) {
      if (fs.kind[f] !== drive) continue;
      uv.lanes++;
      const i = fs.station[f] as number;
      const k = fs.lane[f] as number;
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      const start = fs.start[f] as number;
      for (let c = start; c < start + (fs.len[f] as number); c++) {
        uv.corners++;
        const id = fs.ids[c] as number;
        const x = fs.vx[id] as number;
        const z = fs.vz[id] as number;
        const v = fs.vs[c] as number;
        // which of the lane's four corners it is, or a vertex put into one of its edges
        let found = false;
        for (const [row, kb, wantU] of [[i, k, 0], [i + 1, k, 0], [i, k + 1, 1], [i + 1, k + 1, 1]] as [number, number, number][]) {
          if (Math.hypot(x - (u.x[row * W + kb] as number), z - (u.z[row * W + kb] as number)) > 0.0015) continue;
          found = true;
          const src = s.st[u.from[row * W + kb] as number] as Station;
          if (Math.abs((fs.us[c] as number) - wantU) > 1e-9 && (p.b[k] as number) - (p.b[k + 1] as number) > 0.05 && (q.b[k] as number) - (q.b[k + 1] as number) > 0.05) uv.badU++;
          if (Math.abs(v - src.s) > 1e-6) uv.badV++;
          break;
        }
        if (!found && ((fs.us[c] as number) < -1e-9 || (fs.us[c] as number) > 1 + 1e-9)) uv.badU++;
        if (!found && (v < Math.min(p.s, q.s) - 1e-6 || v > Math.max(p.s, q.s) + 1e-6)) uv.badV++;
        const seen = vAt.get(id);
        if (seen === undefined) vAt.set(id, v);
        else if (Math.abs(seen - v) > 1e-6) uv.borderMismatch++;
      }
      const mid = (st: Station): [number, number] => {
        const lat = ((st.b[k] as number) + (st.b[k + 1] as number)) / 2;
        return [st.x + st.nx * lat, st.z + st.nz * lat];
      };
      const a = mid(p);
      const b = mid(q);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1 && (p.b[k] as number) - (p.b[k + 1] as number) > 1 && (q.b[k] as number) - (q.b[k + 1] as number) > 1) {
        const stretch = Math.abs(q.s - p.s) / len;
        uv.stretchMin = Math.min(uv.stretchMin, stretch);
        uv.stretchMax = Math.max(uv.stretchMax, stretch);
      }
    }
  });
  for (const j of input.joints) {
    if (j.kind !== 'section') continue;
    const sa = strips[j.a.strip] as Strip;
    const sb = strips[j.b.strip] as Strip;
    const va = (j.a.end === 'start' ? sa.st[0] : sa.st[sa.st.length - 1]) as Station;
    const vb = (j.b.end === 'start' ? sb.st[0] : sb.st[sb.st.length - 1]) as Station;
    for (const [la, lb] of j.lanes) {
      if ((sa.lanes[la] as LaneDef).type !== 'drive' || (sb.lanes[lb] as LaneDef).type !== 'drive') continue;
      uv.jointPairs++;
      if (Math.abs(va.s - vb.s) > 0.01) uv.jointMismatch++;
    }
  }
  // in the draw meshes: every vertex of a top mesh has its UV and border codes, and the codes are ones the shader knows
  uv.laneTriangles = mesh.tops.laneTriangles;
  for (const m of mesh.sink.meshes.values()) {
    if (!m.uv.length) continue;
    const vertices = m.pos.length / 3;
    if (m.uv.length !== vertices * 2 || m.uv2.length !== vertices * 2) uv.unaligned++;
    for (const code of m.uv2) if (code !== 0 && code !== 1 && code !== 2 && code !== 3) uv.badCodes++;
    if (m.material === 'road') for (let t = 0; t + 2 < m.idx.length; t += 3) if ((m.uv2[(m.idx[t] as number) * 2] as number) + (m.uv2[(m.idx[t] as number) * 2 + 1] as number) > 0) uv.markedTriangles++;
  }
  if (uv.stretchMin === Infinity) uv.stretchMin = 0;
  uv.stretchMin = Math.round(uv.stretchMin * 1000) / 1000;
  uv.stretchMax = Math.round(uv.stretchMax * 1000) / 1000;
  uv.ok = uv.lanes > 0 && uv.laneTriangles > 0 && uv.badU + uv.badV + uv.borderMismatch + uv.jointMismatch + uv.unaligned + uv.badCodes === 0;

  // stop lines: one on every arm the lane model says stops, across every arriving lane
  const stopLines: MeshChecks['stopLines'] = { armsThatStop: 0, lines: mesh.stops.lines.length, missing: 0, crossings: mesh.stops.crossings, list: [] };
  const lineOf = new Map(mesh.stops.lines.map((l) => [`${l.junction}:${l.arm}`, l]));
  for (const j of input.junctions) {
    j.arms.forEach((arm, ai) => {
      const s = strips[arm.strip] as Strip;
      const span = arrivingLanes(s, arm.end);
      if (!span || !(arm.stopBack > 0 || j.control === 'signals')) return;
      stopLines.armsThatStop++;
      const line = lineOf.get(`${j.id}:${ai}`);
      let why = line ? '' : 'no stop line';
      if (line) {
        const at = sectionAt(s, arm.end, line.back);
        for (let k = span[0]; k <= span[1] && !why; k++) {
          if ((s.lanes[k] as LaneDef).type !== 'drive') continue;
          const lat = ((at.b[k] as number) + (at.b[k + 1] as number)) / 2;
          const x = at.x + at.nx * lat;
          const z = at.z + at.nz * lat;
          const dx = line.b[0] - line.a[0];
          const dz = line.b[1] - line.a[1];
          const len2 = dx * dx + dz * dz || 1;
          const t = ((x - line.a[0]) * dx + (z - line.a[1]) * dz) / len2;
          const d = Math.hypot(x - (line.a[0] + dx * t), z - (line.a[1] + dz * t));
          if (t < -0.01 || t > 1.01 || d > 0.2) why = `the line does not cross lane ${k}`;
        }
        const length = Math.abs((s.st[s.st.length - 1] as Station).s - (s.st[0] as Station).s);
        if (!why && Math.abs(line.back - arm.stopBack) > 0.2 && length > arm.stopBack + 0.5) why = `the line is ${line.back} m back, the lane model says ${arm.stopBack} m`;
      }
      if (why) {
        stopLines.missing++;
        if (stopLines.list.length < 20) stopLines.list.push({ junction: j.id, arm: ai, why });
      }
    });
  }

  // lane paths: a point of a path is on the road when any face holds it
  const paths: MeshChecks['paths'] = { junctions: input.junctions.length, totalM: 0, offFaceM: 0, worst: [] };
  const onFace = (x: number, z: number): boolean => mesh.grid.near(x - 0.01, z - 0.01, x + 0.01, z + 0.01).some((f) => inFace(fs, f, x, z));
  for (const j of input.junctions) {
    let off = 0;
    for (const p of j.paths) {
      for (let k = 1; k < p.pts.length; k++) {
        const [ax, az] = p.pts[k - 1] as [number, number];
        const [bx, bz] = p.pts[k] as [number, number];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len));
        for (let t = 0; t < n; t++) {
          paths.totalM += len / n;
          if (!onFace(ax + ((bx - ax) * (t + 0.5)) / n, az + ((bz - az) * (t + 0.5)) / n)) off += len / n;
        }
      }
    }
    paths.offFaceM += off;
    if (off >= 1) paths.worst.push({ junction: j.id, offM: r1(off) });
  }
  paths.totalM = Math.round(paths.totalM);
  paths.offFaceM = r1(paths.offFaceM);
  paths.worst = paths.worst.sort((p, q) => q.offM - p.offM || (p.junction < q.junction ? -1 : 1)).slice(0, 12);

  const b = mesh.boundary;
  return {
    overlap,
    watertight: {
      openBoundaryEdges: b.unclosed + edges.doubled + mesh.conform.tJointsLeft, unclosed: b.unclosed, doubled: edges.doubled, tJointsLeft: mesh.conform.tJointsLeft, freeEdges: b.freeEdges,
      loops: b.loops.length, outerLoops: b.loops.filter((l) => l.area > 0).length, blockLoops: b.loops.filter((l) => l.area < 0).length, sliverLoops: b.sliverLoops, sliverM2: b.sliverM2,
      tJointsRepaired: mesh.conform.inserted, nearMisses: mesh.conform.nearMisses, nearMissMaxM: mesh.conform.nearMissMaxM,
      doubledAt: edges.doubledAt, unclosedAt: b.unclosedAt, zeroAt: b.zeroAt, tJointsAt: mesh.conform.tJointsAt,
    },
    ends, railings, piers, kerbs: mesh.steps.kerbs, uv, stopLines, paths,
  };
}
