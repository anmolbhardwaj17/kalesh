// Map inspector, the access tab (P2-043): the pure parts shared by the page, the server and the tests. The data is the
// `acc` field of the strips of the lanes layer (harness/reports/map/lanes.json, tools/bake/roads/laneout.ts lanesLayer):
// the modes of the edge, the step that decided them last and why. An owner edit becomes a rule of harness/data/access.json
// with by "owner" (graph/access.ts: owner beats judge beats rule). No file or DOM access and no imports, so the browser
// loads this file as it is. World metres: east +X, north -Z.

export type Headline = 'car' | 'two_wheeler' | 'foot';
export const HEADLINES: readonly Headline[] = ['car', 'two_wheeler', 'foot'];

export interface StripAccess { m: string[]; r: string; why: string; rule?: string; hours?: string; ways: string[] }
export interface AccessStrip { id: string; edge: string; kind: string; cls: string; name: string; acc?: StripAccess; ref: [number, number][] }

const HEADLINE_WORDS: Record<Headline, string> = { car: 'Cars and autos', two_wheeler: 'Scooters and motorcycles', foot: 'Walkers on the carriageway' };
export const headlineWords = (h: Headline): string => HEADLINE_WORDS[h];

/** Who decided the modes, in plain words (the reason of graph/access.ts). */
export function reasonWords(r: string): { label: string; long: string } {
  switch (r) {
    case 'class': return { label: 'Road type', long: 'No rule or tag changes what the road type allows.' };
    case 'osm_tag': return { label: 'Map data tags', long: 'The map data (OpenStreetMap) says who may use this way.' };
    case 'osm_barrier': return { label: 'A barrier on the way', long: 'The map data has a bollard, a block or a locked gate on this way.' };
    case 'width': return { label: 'Too narrow', long: 'The carriageway is too narrow for a car or a scooter.' };
    case 'surface': return { label: 'Unpaved surface', long: 'An unpaved minor way is not a road for cars.' };
    case 'context': return { label: 'Common sense for the place', long: 'A kind of place decides it: an old city gali, a park path.' };
    case 'rule': return { label: 'A Delhi rule', long: 'A rule with its references in the access rules file decides it.' };
    case 'judge': return { label: 'The judge pass', long: 'A top-view judge pass looked at the satellite picture and decided.' };
    case 'owner': return { label: 'Your edit', long: 'You set this in the inspector. It beats the judge and the rules.' };
    default: return { label: 'Not recorded', long: 'The bake did not record who decided.' };
  }
}

/** The three headline modes of a strip: car (a car or an auto), two-wheeler and foot. */
export function headlines(modes: readonly string[]): Record<Headline, boolean> {
  return { car: modes.includes('car'), two_wheeler: modes.includes('two_wheeler'), foot: modes.includes('foot') };
}

const ALL = ['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency'];

/**
 * The modes after an owner sets the three headline switches: the car switch covers car and auto; cycles and emergency
 * vehicles stay as they were (an owner who closes a road to cars does not shut the ambulance out).
 */
export function applyHeadlines(current: readonly string[], want: Record<Headline, boolean>): string[] {
  const on = new Set(current);
  const set = (modes: string[], v: boolean): void => { for (const m of modes) { if (v) on.add(m); else on.delete(m); } };
  set(['car', 'auto'], want.car);
  set(['two_wheeler'], want.two_wheeler);
  set(['foot'], want.foot);
  return ALL.filter((m) => on.has(m));
}

export const ownerRuleId = (edge: string): string => `owner_${edge.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;

export interface OwnerRuleInput {
  edge: string;
  name: string;
  cls: string;
  /** Every reference point of the edge's strips (world metres). */
  points: [number, number][];
  ways: string[];
  modes: string[];
  note: string;
  date: string;
  toGeo: (x: number, z: number) => { lat: number; lon: number };
}

/**
 * The rule of access.json for an owner edit: the OSM ways of the edge inside a circle that holds every point of it
 * (graph ids change when the repair cuts and joins edges; ways and place do not).
 */
export function buildOwnerRule(i: OwnerRuleInput): Record<string, unknown> {
  const xs = i.points.map((p) => p[0]);
  const zs = i.points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const r = Math.max(...i.points.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) + 1.5;
  const g = i.toGeo(cx, cz);
  const label = i.name || `an unnamed ${i.cls.replace(/_/g, ' ')}`;
  return {
    id: ownerRuleId(i.edge),
    by: 'owner',
    kind: 'rule',
    why: i.note.trim().length >= 20 ? i.note.trim() : `Set in the map inspector on ${i.date} for ${label}${i.note.trim() ? `: ${i.note.trim()}` : ''}`,
    refs: [`map inspector access tab, ${i.date} (edge ${i.edge})`],
    modes: ALL.filter((m) => i.modes.includes(m)),
    barrier: 'none',
    match: { ways: i.ways, within: { lat: Math.round(g.lat * 1e7) / 1e7, lon: Math.round(g.lon * 1e7) / 1e7, radiusM: Math.ceil(r) } },
  };
}

/** Problems with an owner edit before anything is written. */
export function accessInputProblems(input: { edge?: unknown; want?: unknown }): string[] {
  const out: string[] = [];
  if (typeof input.edge !== 'string' || !input.edge) out.push('Pick a road first.');
  const w = input.want as Record<string, unknown> | undefined;
  if (!w || HEADLINES.some((h) => typeof w[h] !== 'boolean')) out.push('Say for cars, scooters and walkers whether they may use the road.');
  return out;
}

export function accessInboxText(name: string, x: number, z: number, from: readonly string[], to: readonly string[], note: string, ruleId: string): string {
  const words = (m: readonly string[]): string => HEADLINES.map((h) => `${h === 'car' ? 'cars' : h === 'two_wheeler' ? 'scooters' : 'walkers'} ${m.includes(h) ? 'yes' : 'no'}`).join(', ');
  return `Map inspector (access): ${name || 'a road'} near world ${Math.round(x)}, ${Math.round(z)}: was ${words(from)}; now ${words(to)}.${note ? ` Note: ${note}.` : ''} Written as rule ${ruleId} (by owner) in harness/data/access.json; the next bake uses it.`;
}

/** Counts for the tab header: edges (one per graph edge) by what a car may do, and the decided-by counts. */
export function accessSummary(strips: readonly AccessStrip[]): { edges: number; carFree: number; byReason: Record<string, number> } {
  const seen = new Map<string, StripAccess>();
  for (const s of strips) if (s.acc && s.kind !== 'zone' && !seen.has(s.edge)) seen.set(s.edge, s.acc);
  const byReason: Record<string, number> = {};
  let carFree = 0;
  for (const a of seen.values()) {
    byReason[a.r] = (byReason[a.r] ?? 0) + 1;
    if (!a.m.includes('car')) carFree++;
  }
  return { edges: seen.size, carFree, byReason };
}

/** The strips of one edge, and the nearest road strip to a point (the click on the map). */
export function stripsOfEdge(strips: readonly AccessStrip[], edge: string): AccessStrip[] {
  return strips.filter((s) => s.edge === edge && s.kind !== 'zone');
}

export function nearestAccessStrip(strips: readonly AccessStrip[], x: number, z: number, maxM: number): { strip: AccessStrip; d: number } | null {
  let best: { strip: AccessStrip; d: number } | null = null;
  for (const s of strips) {
    if (!s.acc || s.kind === 'zone') continue;
    for (let i = 1; i < s.ref.length; i++) {
      const a = s.ref[i - 1] as [number, number];
      const b = s.ref[i] as [number, number];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
      const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
      if (d <= maxM && (!best || d < best.d)) best = { strip: s, d };
    }
  }
  return best;
}
