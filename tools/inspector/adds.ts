// Map inspector, the draw tool (P1-045): the pure parts shared by the page, the server and the tests. The owner
// clicks points on the map, picks what to add (a road, a median, a footpath, a crossing, a barrier), sets its width or
// lanes and the reference it is drawn from; the server turns that into an add patch of the overrides format
// (MAP_REPAIR.md "Overrides format", tools/bake/repair/adds.ts) in the file of the first point's world tile. No file
// or DOM access and no imports, so the browser loads this file as it is. World metres: east +X, north -Z.

export type AddKind = 'add_way' | 'add_median' | 'add_footpath' | 'add_crossing' | 'add_barrier';

export interface AddKindInfo {
  kind: AddKind;
  /** The button label. */
  label: string;
  /** One line of help: what to click. */
  help: string;
  /** Drawn as a line (two or more clicks) or as one point. */
  line: boolean;
}

export const ADD_KINDS: readonly AddKindInfo[] = [
  { kind: 'add_way', label: 'Road', line: true, help: 'Click along the new road, from where it meets a road to its end. An end within 15 m of a road joins it.' },
  { kind: 'add_median', label: 'Median', line: true, help: 'Click along the middle of a two-way road, from where the divider starts to where it ends.' },
  { kind: 'add_footpath', label: 'Footpath', line: true, help: 'Click along the side of the road where the footpath runs.' },
  { kind: 'add_crossing', label: 'Crossing', line: false, help: 'Click the road where people cross. A crossing near a junction gets a zebra.' },
  { kind: 'add_barrier', label: 'Barrier', line: false, help: 'Click the road where a barrier closes it. Traffic stops on both sides.' },
];

export const ROAD_CLASSES = ['service', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary'] as const;
export const MEDIAN_TYPES = ['kerb', 'planter', 'barrier', 'painted'] as const;
export const BARRIER_KINDS = ['barricade', 'bollards', 'gate', 'wall'] as const;

export const kindInfo = (k: string): AddKindInfo | undefined => ADD_KINDS.find((x) => x.kind === k);

/** A road of the map (context.json roads: id and world points) the drawn points can name. */
export interface MapRoad { id: string; pts: [number, number][] }

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** The road nearest to a point within `tol` metres, or null. */
export function nearestRoad(roads: readonly MapRoad[], x: number, z: number, tol: number): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const r of roads) {
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k] as [number, number];
      const b = r.pts[k + 1] as [number, number];
      const d = distToSeg(x, z, a[0], a[1], b[0], b[1]);
      if (d <= tol && (!best || d < best.d)) best = { id: r.id, d };
    }
  }
  return best;
}

/** Roads within `tol` of the drawn line, in the order the line meets them (by the nearest drawn point). */
export function roadsAlong(roads: readonly MapRoad[], pts: readonly [number, number][], tol: number): string[] {
  const out: string[] = [];
  // samples every 4 m along the line
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k] as [number, number];
    const b = pts[k + 1] as [number, number];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let i = 0; i <= n; i++) {
      const hit = nearestRoad(roads, a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, tol);
      if (hit && !out.includes(hit.id)) out.push(hit.id);
    }
  }
  return out;
}

export interface AddInput {
  kind: string;
  /** Clicked points in world metres. */
  points: [number, number][];
  /** Settings of the kind: highway, lanes, oneway, name (road); width, type (median); width (footpath); kind (barrier). */
  settings: Record<string, string | number | boolean>;
  reference: { link: string; date: string };
  note: string;
}

export interface AddPatchOut {
  issue: string;
  action: AddKind;
  target: { ids: string[]; anchor: { lat: number; lon: number }; tolerance_m: number };
  params: Record<string, string | number | boolean>;
  why: string;
  by: string;
  source: string;
  date: string;
  reference: { link: string; date: string; note?: string };
}

const round7 = (v: number): number => Math.round(v * 1e7) / 1e7;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** What is wrong with a drawing before it becomes a patch (plain words for the page; empty when it is fine). */
export function addInputProblems(input: AddInput): string[] {
  const out: string[] = [];
  const info = kindInfo(input.kind);
  if (!info) return [`Pick what to add.`];
  const pts = Array.isArray(input.points) ? input.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
  if (info.line && pts.length < 2) out.push('Click at least two points on the map.');
  if (!info.line && pts.length !== 1) out.push('Click one point on the map.');
  if (!/^https?:\/\/\S+$/.test(String(input.reference?.link ?? '').trim())) out.push('Add the link of the photo or satellite view this is drawn from.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.reference?.date ?? ''))) out.push('Add the date you looked at the reference (YYYY-MM-DD).');
  const s = input.settings ?? {};
  if (input.kind === 'add_median') {
    const w = num(s['width']);
    if (w === null || w < 0.3 || w > 30) out.push('The median width must be 0.3 to 30 m.');
  }
  if (input.kind === 'add_way') {
    const l = num(s['lanes']);
    if (l === null || l < 1 || l > 8 || !Number.isInteger(l)) out.push('The lane count must be a whole number from 1 to 8.');
  }
  if (input.kind === 'add_footpath') {
    const w = num(s['width']);
    if (w === null || w < 0.6 || w > 10) out.push('The footpath width must be 0.6 to 10 m.');
  }
  return out;
}

/**
 * The add patch of a drawing (without its id, which the server gives from the tile file). `toGeo` turns world metres
 * into latitude and longitude (the bake's frame); `roads` are the map roads the drawn points can name by id.
 */
export function buildAddPatch(input: AddInput, opts: { date: string; toGeo: (x: number, z: number) => { lat: number; lon: number }; roads: readonly MapRoad[]; tolerance?: number }): AddPatchOut {
  const info = kindInfo(input.kind) as AddKindInfo;
  const tol = opts.tolerance ?? 15;
  const pts = input.points.map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
  const geo = pts.map(([x, z]) => opts.toGeo(x, z));
  const text = geo.map((g) => `${round7(g.lat)},${round7(g.lon)}`).join(';');
  const s = input.settings ?? {};
  const params: Record<string, string | number | boolean> = info.line ? { path: text } : { at: text };
  let ids: string[] = [];
  const first = pts[0] as [number, number];
  const last = pts[pts.length - 1] as [number, number];
  if (input.kind === 'add_way') {
    params['highway'] = ROAD_CLASSES.includes(String(s['highway']) as (typeof ROAD_CLASSES)[number]) ? String(s['highway']) : 'service';
    params['lanes'] = num(s['lanes']) ?? 1;
    if (s['oneway'] === true) params['oneway'] = true;
    if (typeof s['name'] === 'string' && s['name'].trim()) params['name'] = s['name'].trim();
    // an end near a road joins that road (by id); an end in the open stays free
    const a = nearestRoad(opts.roads, first[0], first[1], tol);
    const b = nearestRoad(opts.roads, last[0], last[1], tol);
    params['join_a'] = a ? a.id : 'none';
    params['join_b'] = b ? b.id : 'none';
    ids = [...new Set([a?.id, b?.id].filter((x): x is string => !!x))];
  } else if (input.kind === 'add_median') {
    params['width'] = num(s['width']) as number;
    params['type'] = MEDIAN_TYPES.includes(String(s['type']) as (typeof MEDIAN_TYPES)[number]) ? String(s['type']) : 'kerb';
    ids = roadsAlong(opts.roads, pts, Math.min(tol, 8));
  } else if (input.kind === 'add_footpath') {
    params['width'] = num(s['width']) as number;
    ids = roadsAlong(opts.roads, pts, tol);
  } else {
    const hit = nearestRoad(opts.roads, first[0], first[1], tol);
    if (hit) {
      params['on'] = hit.id;
      ids = [hit.id];
    }
    if (input.kind === 'add_barrier') params['kind'] = BARRIER_KINDS.includes(String(s['kind']) as (typeof BARRIER_KINDS)[number]) ? String(s['kind']) : 'barricade';
  }
  const note = String(input.note ?? '').trim();
  return {
    issue: '', action: info.kind, target: { ids, anchor: { lat: round7((geo[0] as { lat: number }).lat), lon: round7((geo[0] as { lon: number }).lon) }, tolerance_m: tol },
    params, why: note || `${info.label} drawn in the map inspector`, by: 'owner', source: 'inspector', date: opts.date,
    reference: { link: input.reference.link.trim(), date: input.reference.date, ...(note ? { note } : {}) },
  };
}

/** The inbox text of a drawing (plain English, no em dashes). */
export function addInboxText(info: AddKindInfo, x: number, z: number, points: number, patchId: string, file: string, note: string): string {
  const n = note.trim();
  return `Map inspector: I drew a ${info.label.toLowerCase()} at x ${Math.round(x)}, z ${Math.round(z)} (${points} point${points === 1 ? '' : 's'})${n ? `. Note: ${n}` : ''}. Patch ${patchId} is in overrides/${file}.`;
}

/** The context.json roads as MapRoad (their p list is x, y, z triples). */
export function mapRoads(context: { roads?: { id?: string; p: number[] }[] } | null): MapRoad[] {
  const out: MapRoad[] = [];
  for (const r of context?.roads ?? []) {
    if (!r.id) continue;
    const pts: [number, number][] = [];
    for (let k = 0; k + 2 < r.p.length; k += 3) pts.push([r.p[k] as number, r.p[k + 2] as number]);
    out.push({ id: r.id, pts });
  }
  return out;
}
