// Map inspector, the lanes layer (P1-025): the pure parts shared by the page, the server and the tests. The data is the
// lanes layer file of the bake (harness/reports/map/lanes.json, tools/bake/roads/laneout.ts lanesLayer) and the lanes
// record of health.json. No file or DOM access and no imports, so the browser loads this file as it is. World metres:
// east +X, north -Z, no mirroring.

export interface LaneStrip {
  id: string;
  edge: string;
  kind: string;
  cls: string;
  name: string;
  hero: string | null;
  bridge: boolean;
  from?: string;
  by?: string;
  taper?: [number, number, number];
  lanes: [string, number][];
  ref: [number, number][];
  n: [number, number][];
  b: number[] | number[][];
}
export interface LaneZone { id: string; kind: string; node: [number, number]; nose: [number, number]; noseM: number }
export interface LanesFile { origin?: { lat: number; lon: number }; offset?: [number, number]; strips: LaneStrip[]; zones: LaneZone[] }
export interface TaperFinding { strip: string; cls: string; lengthM: number; shiftM: number; neededM: number; why: string }
export interface LanesHealth { counts?: Record<string, number>; zones?: { zones: number; diverges: number; merges: number }; tapers?: { tapers: number; violations: number; findings: TaperFinding[] }; inference?: { from: Record<string, number> } }

/** The id of the issue an owner's lane count patch is filed under (one patch per road edge). */
export const lanesIssueId = (edge: string): string => `lanes:${edge}`;
export const isOwnerLanes = (by: string | undefined): boolean => !!by && by.startsWith('lanes:');

/** Where the lane count of a road came from, in plain words: a short label and a longer line. */
export function sourceWords(from: string | undefined, by?: string): { label: string; long: string } {
  switch (from) {
    case 'class': return { label: 'Road type default', long: 'No lane count is known for this road, so it has the usual count for its type of road.' };
    case 'tag': return { label: 'Map data', long: 'The map data (OpenStreetMap) gives the number of lanes for this road.' };
    case 'street': return { label: 'Taken along the street', long: 'This stretch has no count of its own. It takes the count of the nearest stretch of the same street that has one.' };
    case 'pair': return { label: 'Other side of the street', long: 'The street has two separate carriageways. This one takes the count of the other.' };
    case 'corridor': return { label: 'Taken along the road', long: 'This street has no count of its own. It takes the count and lane width of the nearest road it runs on into through a junction (same name or same kind of road, nearly straight on), so the road keeps one width.' };
    case 'spec': return { label: 'Hero road spec', long: 'A hand written road spec (a hero road) sets the lanes here.' };
    case 'fit': return { label: 'Fitted to the street', long: 'The road was too short for a smooth change of lane count, so it takes the count of the street beside it.' };
    case 'width': return { label: 'From the tagged width', long: 'The map data gives the road width, and the lane count follows from it.' };
    case 'room': return { label: 'Limited by room', long: 'The count was cut down because the road has no room for more lanes beside the other carriageway.' };
    case 'zone': return { label: 'Both branches together', long: 'A split zone carries the lanes of its two branches side by side. Its count is the count of the road before the split.' };
    case 'repair':
      return isOwnerLanes(by)
        ? { label: 'Your override', long: 'You set this lane count in the inspector. It is kept in the overrides folder and applies on every bake.' }
        : { label: 'Repair rule', long: `A repair rule set this lane count${by ? ` (${by.split(':')[0]})` : ''}.` };
    default: return { label: 'Not recorded', long: 'The bake did not record where this lane count came from.' };
  }
}

export const driveLaneCount = (s: Pick<LaneStrip, 'lanes'>): number => s.lanes.filter(([t]) => t === 'drive').length;

/** The lateral position of every lane border at one point of a strip (one list when it is the same along the strip). */
export const borderAt = (s: Pick<LaneStrip, 'b'>, pt: number): number[] => (Array.isArray(s.b[0]) ? (s.b as number[][])[pt] ?? [] : (s.b as number[]));

/** Widths along a strip in metres: the driving lanes together and the whole cross section, smallest and largest over its points. */
export function stripWidths(s: Pick<LaneStrip, 'lanes' | 'b' | 'ref'>): { drive: [number, number]; total: [number, number]; lane: [number, number] } {
  const out = { drive: [Infinity, 0] as [number, number], total: [Infinity, 0] as [number, number], lane: [Infinity, 0] as [number, number] };
  const points = Array.isArray(s.b[0]) ? s.ref.length : 1;
  for (let pt = 0; pt < points; pt++) {
    const b = borderAt(s, pt);
    let drive = 0;
    s.lanes.forEach(([type], k) => {
      const w = (b[k] ?? 0) - (b[k + 1] ?? 0);
      if (type === 'drive') { drive += w; out.lane = [Math.min(out.lane[0], w), Math.max(out.lane[1], w)]; }
    });
    const total = (b[0] ?? 0) - (b[b.length - 1] ?? 0);
    out.drive = [Math.min(out.drive[0], drive), Math.max(out.drive[1], drive)];
    out.total = [Math.min(out.total[0], total), Math.max(out.total[1], total)];
  }
  for (const k of ['drive', 'total', 'lane'] as const) if (!Number.isFinite(out[k][0])) out[k] = [0, 0];
  return out;
}

/** "3.3 m" or "3.3 to 4.1 m". */
export function metres(range: readonly [number, number]): string {
  const f = (v: number): string => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return Math.abs(range[1] - range[0]) < 0.15 ? `${f(range[1])} m` : `${f(range[0])} to ${f(range[1])} m`;
}

export const LANE_TYPE_WORDS: Record<string, string> = { drive: 'Driving lane', kerb: 'Kerb', footpath: 'Footpath', median: 'Median', parking: 'Parking', planter: 'Planter', gore: 'Painted island' };

/** A cross section part narrower than this is not listed (m): a split zone keeps its painted island at no width before the nose. */
export const PART_MIN_M = 0.005;

/**
 * The parts of a cross section at one point, left to right, as the lanes tab lists them: parts with no width left
 * out, and neighbours of the same type and direction that are left next to each other merged (P1-036: a split zone
 * listed "Painted island 0.00 m" three times).
 */
export function sectionParts(lanes: readonly (readonly [string, number])[], b: readonly number[]): { type: string; dir: number; widthM: number }[] {
  const out: { type: string; dir: number; widthM: number }[] = [];
  lanes.forEach(([type, dir], k) => {
    const w = (b[k] ?? 0) - (b[k + 1] ?? 0);
    if (w < PART_MIN_M) return;
    const last = out[out.length - 1];
    // two driving lanes stay two lanes; other parts of one kind side by side are one part
    if (last && last.type === type && last.dir === dir && type !== 'drive') last.widthM += w;
    else out.push({ type, dir, widthM: w });
  });
  return out;
}

/** Distance in metres from a point to a polyline, and the index of the nearest point. */
export function distAlong(x: number, z: number, pts: readonly (readonly [number, number])[]): { d: number; at: number } {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i] as [number, number];
    const [bx, bz] = pts[i + 1] as [number, number];
    const dx = bx - ax; const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) { best = d; at = t > 0.5 ? i + 1 : i; }
  }
  if (pts.length === 1) best = Math.hypot(x - (pts[0] as [number, number])[0], z - (pts[0] as [number, number])[1]);
  return { d: best, at };
}

const boxes = new WeakMap<object, { minX: number; maxX: number; minZ: number; maxZ: number; half: number }[]>();
/**
 * The strip under a point (world metres): the one whose cross section is nearest, within `slackM` of its edge. A strip
 * on a bridge or a taper does not win over a plain strip unless it is nearer.
 */
export function nearestStrip(strips: readonly LaneStrip[], x: number, z: number, slackM = 4): { strip: LaneStrip; index: number; d: number; at: number } | null {
  let cache = boxes.get(strips);
  if (!cache) {
    cache = strips.map((s) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [px, pz] of s.ref) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz); }
      const w = stripWidths(s).total[1];
      return { minX, maxX, minZ, maxZ, half: Math.max(w / 2, 1) + 0.5 };
    });
    boxes.set(strips, cache);
  }
  let best: { strip: LaneStrip; index: number; d: number; at: number } | null = null;
  let bestScore = Infinity;
  for (let k = 0; k < strips.length; k++) {
    const bx = cache[k] as { minX: number; maxX: number; minZ: number; maxZ: number; half: number };
    const m = bx.half + slackM;
    if (x < bx.minX - m || x > bx.maxX + m || z < bx.minZ - m || z > bx.maxZ + m) continue;
    const s = strips[k] as LaneStrip;
    const { d, at } = distAlong(x, z, s.ref);
    const score = d - bx.half;
    if (score <= slackM && score < bestScore) { bestScore = score; best = { strip: s, index: k, d, at }; }
  }
  return best;
}

export interface LaneItem {
  kind: 'zone' | 'taper';
  id: string;
  /** Strip the item is on (its reference line is highlighted). */
  strip: string;
  title: string;
  detail: string;
  x: number;
  z: number;
  /** Metres from the nearest listed place called "near" (the ITO crossing first). */
  fromFocus: number;
}

const rd = (v: number): number => Math.round(v * 10) / 10;

/**
 * The split zones (every diverge and merge of the lane model) and the taper findings of the health report as one list.
 * The counts are the health report's: `zones` has one row per zone of the layer file, `findings` one per finding.
 * Sorted by distance from the focus point (the ITO crossing) so the places Anmol checks first come first.
 */
export function laneItems(file: Pick<LanesFile, 'strips' | 'zones'>, health: LanesHealth | null, focus: { x: number; z: number } | null): LaneItem[] {
  const byId = new Map(file.strips.map((s) => [s.id, s]));
  const far = (x: number, z: number): number => (focus ? Math.hypot(x - focus.x, z - focus.z) : 0);
  const items: LaneItem[] = [];
  for (const z of file.zones) {
    const s = byId.get(z.id);
    const road = s?.name || (s ? s.cls.replace(/_link$/, '') : 'road');
    const split = z.kind === 'diverge';
    const nose = rd(z.noseM);
    const lanes = s ? driveLaneCount(s) : 0;
    items.push({
      kind: 'zone', id: z.id, strip: z.id,
      title: split ? `Road splits in two${s?.name ? ` on ${road}` : ''}` : `Two roads merge into one${s?.name ? ` on ${road}` : ''}`,
      detail: `${split ? 'Split' : 'Merge'} zone ${nose} m long to the painted island${lanes ? `, ${lanes} lanes together` : ''}.`,
      x: (z.node[0] + z.nose[0]) / 2, z: (z.node[1] + z.nose[1]) / 2, fromFocus: 0,
    });
  }
  for (const t of health?.tapers?.findings ?? []) {
    const s = byId.get(t.strip);
    if (!s) continue;
    const mid = s.ref[Math.floor(s.ref.length / 2)] as [number, number];
    items.push({
      kind: 'taper', id: t.strip, strip: t.strip,
      title: `Lane widths change too fast${s.name ? ` on ${s.name}` : ''}`,
      detail: `Over ${rd(t.lengthM)} m the lanes shift ${rd(t.shiftM)} m. A ${t.cls} road needs ${rd(t.neededM)} m. ${t.why}`,
      x: mid[0], z: mid[1], fromFocus: 0,
    });
  }
  for (const it of items) it.fromFocus = far(it.x, it.z);
  // taper findings stay above the zones within one distance band; the list is by distance from the focus
  items.sort((a, b) => (a.fromFocus - b.fromFocus) || (a.id < b.id ? -1 : 1));
  return items;
}

/** The "near the focus" limit in metres: items inside it are listed under the focus place's name. */
export const NEAR_FOCUS_M = 1000;

/** A one line summary from the health report: "141 split zones (66 splits, 75 merges), 3 taper findings, 5,721 road sections". */
export function lanesSummary(health: LanesHealth | null, strips: number): string {
  const z = health?.zones;
  const t = health?.tapers;
  const n = (v: number): string => v.toLocaleString('en');
  const parts: string[] = [];
  if (z) parts.push(`${n(z.zones)} split zones (${n(z.diverges)} splits, ${n(z.merges)} merges)`);
  if (t) parts.push(`${n(t.violations)} taper findings`);
  parts.push(`${n(strips)} road sections`);
  return parts.join(', ');
}

/** The inbox line of a lane count pick (plain English, no em dashes). */
export function lanesInboxText(road: string, x: number, z: number, from: number, to: number, note: string, patchId: string, file: string): string {
  const n = note.trim();
  return `Map inspector: I set the lane count of ${road} at x ${Math.round(x)}, z ${Math.round(z)} from ${from} to ${to}${n ? `. Note: ${n}` : ''}. Patch ${patchId} is in overrides/${file}.`;
}
