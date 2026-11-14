// Map inspector: plain English for an issue (P1-039, Anmol 2026-11-12: every card must say what it is, where, what is
// wrong and what the fix does, in words a non-engineer understands). Pure, no imports: the page loads this file with
// its types stripped and vitest imports it. Names come from context.json (road names and refs, named footprints) and
// the places of tiles/index.json. World metres: east +X, north -Z.

export interface CtxRoad { id?: string; k: string; w: number; p: number[]; n?: string; r?: string }
export interface CtxNamed { id: string; n: string; x: number; z: number; k: string }
export interface Place { id?: string; name: string; x: number; z: number }
export interface DescribeIssue { rule: string; x: number; z: number; features: string[]; note?: string; proposals: { action: string; confidence: number; reasoning: string }[]; status?: string; decided?: string; decision?: string; judgeNote?: string }

export interface RoadInfo { id: string; name: string; ref: string; cls: string; pts: [number, number][] }
export interface NameIndex {
  roads: Map<string, RoadInfo>;
  /** Named roads cut into 100 m cells for the nearest named road search. */
  cells: Map<string, RoadInfo[]>;
  footprints: Map<string, CtxNamed>;
  /** Reference points for "120 m north of X": the places, then named stations, monuments and places of worship. */
  landmarks: Place[];
}

const CELL = 100;
const cellKey = (x: number, z: number): string => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
/** Named footprints of these kinds are too plain to steer by (a house); every other named footprint is a landmark. */
const PLAIN_KINDS = new Set(['apartments', 'detached', 'house', 'residential', 'garage', 'shed', 'roof', 'construction', 'dormitory', 'retail', 'fast food', 'restaurant', 'bank']);
/** A name worth steering by: not a bare number or a two letter tag. */
const steerName = (n: string): boolean => n.length >= 3 && !/^\d/.test(n);

/** Builds the name index once per page load. Files written before P1-039 have no ids or names: then it is empty. */
export function buildNameIndex(ctx: { roads?: CtxRoad[]; named?: CtxNamed[] } | null, places: readonly Place[]): NameIndex {
  const roads = new Map<string, RoadInfo>();
  const cells = new Map<string, RoadInfo[]>();
  for (const r of ctx?.roads ?? []) {
    if (!r.id) continue;
    const pts: [number, number][] = [];
    for (let k = 0; k + 2 < r.p.length; k += 3) pts.push([r.p[k] as number, r.p[k + 2] as number]);
    const info: RoadInfo = { id: r.id, name: r.n ?? '', ref: r.r ?? '', cls: r.k, pts };
    roads.set(r.id, info);
    if (!info.name) continue;
    const seen = new Set<string>();
    for (const [x, z] of pts) {
      const key = cellKey(x, z);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = cells.get(key) ?? [];
      list.push(info);
      cells.set(key, list);
    }
  }
  const footprints = new Map<string, CtxNamed>();
  for (const f of ctx?.named ?? []) footprints.set(f.id, f);
  const landmarks: Place[] = [...places.map((p) => ({ name: p.name, x: p.x, z: p.z }))];
  for (const f of ctx?.named ?? []) if (!PLAIN_KINDS.has(f.k) && steerName(f.n)) landmarks.push({ name: f.n, x: f.x, z: f.z });
  return { roads, cells, footprints, landmarks };
}

/** Distance from a point to a polyline. */
export function distToLine(x: number, z: number, pts: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k] as [number, number]; const [bx, bz] = pts[k + 1] as [number, number];
    const dx = bx - ax; const dz = bz - az; const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  if (pts.length === 1) best = Math.hypot((pts[0] as [number, number])[0] - x, (pts[0] as [number, number])[1] - z);
  return best;
}

/** The point of a polyline nearest to (x, z). */
export function nearestOnLine(x: number, z: number, pts: readonly (readonly [number, number])[]): [number, number] {
  let best: [number, number] = pts.length ? [(pts[0] as [number, number])[0], (pts[0] as [number, number])[1]] : [x, z];
  let bd = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k] as [number, number]; const [bx, bz] = pts[k + 1] as [number, number];
    const dx = bx - ax; const dz = bz - az; const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t; const pz = az + dz * t; const d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}

/** Where the words "where" point at: the issue's spot, except a building issue, whose spot is its building's middle,
 * so all the road pieces that run into one big footprint would read the same. There it is the point of the road piece
 * nearest that middle, which is where the road meets the building. */
export function spotOf(i: DescribeIssue, idx: NameIndex): [number, number] {
  if (i.rule.startsWith('R-BLDG')) {
    const road = i.features.filter(isEdgeId).map((f) => idx.roads.get(f)).find(Boolean);
    if (road && road.pts.length) return nearestOnLine(i.x, i.z, road.pts);
  }
  return [i.x, i.z];
}

/** The nearest named road within `radius` metres, leaving out the names in `skip`. */
export function nearestNamedRoad(idx: NameIndex, x: number, z: number, radius = 250, skip: ReadonlySet<string> = new Set()): RoadInfo | null {
  let best: RoadInfo | null = null;
  let bd = radius;
  const r = Math.ceil(radius / CELL);
  const cx = Math.floor(x / CELL); const cz = Math.floor(z / CELL);
  const done = new Set<RoadInfo>();
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    for (const road of idx.cells.get(`${cx + i},${cz + j}`) ?? []) {
      if (done.has(road) || skip.has(road.name)) continue;
      done.add(road);
      const d = distToLine(x, z, road.pts);
      if (d < bd) { bd = d; best = road; }
    }
  }
  return best;
}

/** Compass words from a reference point to a spot (north is -Z). */
export function compass(dx: number, dz: number): string {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI; // 0 north, 90 east
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[((Math.round(a / 45) % 8) + 8) % 8] as string;
}

/** "120 m north of Rajiv Chowk", or "at Rajiv Chowk" when closer than 30 m. Rounded to 10 m (to 50 m past 500 m). */
export function whereWords(idx: NameIndex, x: number, z: number, skip = ''): string {
  let best: Place | null = null;
  let bd = Infinity;
  for (const p of idx.landmarks) { if (skip && skip.startsWith(p.name)) continue; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
  if (!best) return '';
  if (bd < 30) return `at ${best.name}`;
  const step = bd > 500 ? 50 : 10;
  const m = Math.round(bd / step) * step;
  const dist = m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, '')} km` : `${m} m`;
  return `${dist} ${compass(x - best.x, z - best.z)} of ${best.name}`;
}

const CLASS_WORDS: Record<string, string> = {
  motorway: 'expressway', trunk: 'main road', primary: 'main road', secondary: 'road', tertiary: 'road', unclassified: 'road',
  residential: 'street', living_street: 'lane', service: 'service road', pedestrian: 'walkway', footway: 'footpath', path: 'path', cycleway: 'cycle track', track: 'track',
};
export const classWords = (cls: string): string => (cls.endsWith('_link') ? 'slip road' : CLASS_WORDS[cls] ?? 'road');

const isEdgeId = (f: string): boolean => /^[wm]\d+\.\d+$/.test(f);
const isFootprintId = (f: string): boolean => /^(overture\/|way\/)/.test(f);

/** A road in words: its name (and ref), or "Unnamed service road off Janpath". */
export function roadWords(idx: NameIndex, road: RoadInfo, x: number, z: number): string {
  if (road.name) return road.ref && !road.name.includes(road.ref) ? `${road.name} (${road.ref})` : road.name;
  if (road.ref) return `${road.ref} (${classWords(road.cls)})`;
  const near = nearestNamedRoad(idx, x, z, 200);
  return `Unnamed ${classWords(road.cls)}${near ? ` off ${near.name}` : ''}`;
}

/** The text of a note or reasoning before the first colon, when it reads like a name ("Connaught Place, Middle Circle: ..."). */
const nameBeforeColon = (s: string | undefined): string => { const m = /^([^:]{3,60}):/.exec(s ?? ''); return m && !/\d/.test(m[1] as string) && !/^(changed|the|an?) /i.test(m[1] as string) ? (m[1] as string).trim() : ''; };

/** What the issue is about, in words: the named thing, or its kind plus the nearest named road. */
export function subjectWords(i: DescribeIssue, idx: NameIndex): string {
  const near = (): string => { const r = nearestNamedRoad(idx, i.x, i.z, 200); return r ? r.name : ''; };
  if (i.rule.startsWith('R-HERO')) { const n = nameBeforeColon(i.note); if (n) return n; }
  if (i.rule === 'R-RAIL-02') { const n = nameBeforeColon(i.note); return n ? `${n} station` : 'A station'; }
  if (i.rule === 'R-STITCH-07') { const m = /^(.+?) leaves the map/.exec(i.note ?? ''); if (m) return m[1] as string; }
  if (i.rule.startsWith('R-BLDG')) {
    const fp = i.features.find(isFootprintId);
    const named = fp ? idx.footprints.get(fp) : undefined;
    if (named) return named.k === 'building' ? named.n : `${named.n} (${named.k})`;
    const road = i.features.filter(isEdgeId).map((f) => idx.roads.get(f)).find(Boolean);
    const by = road?.name || near();
    return by ? `A building on ${by}` : 'A building';
  }
  if (i.rule === 'R-FOB-01') { const r = near(); return r ? `Foot over bridge on ${r}` : 'A foot over bridge'; }
  const roads = i.features.filter(isEdgeId).map((f) => idx.roads.get(f)).filter((r): r is RoadInfo => !!r);
  if (roads.length) {
    const first = roads[0] as RoadInfo;
    const other = roads.find((r) => r.name && r.name !== first.name);
    const main = roadWords(idx, first, i.x, i.z);
    return other && i.rule !== 'R-ROAD-07' && first.name ? `${main} and ${other.name}` : main;
  }
  if (i.features.some((f) => /^n\d/.test(f))) { const r = near(); return r ? `A junction on ${r}` : 'A junction'; }
  const r = near();
  return r ? `A spot on ${r}` : 'A spot on the map';
}

/** One plain sentence per rule: what is wrong, for someone who is not a map engineer. */
export const PROBLEM_WORDS: Record<string, string> = {
  'R-ROAD-01': 'The road stops just short of another road instead of joining it.',
  'R-ROAD-02': 'Two roads cross with no junction, so the game cannot tell if they meet or one goes over.',
  'R-ROAD-03': 'Two roads are drawn on top of each other.',
  'R-ROAD-04': 'This road is marked one-way, but there is no road for the other direction beside it.',
  'R-ROAD-05': 'The road is wider or narrower than its type and lanes need.',
  'R-ROAD-06': 'The number of lanes changes with no room to widen or narrow smoothly.',
  'R-ROAD-07': 'The two sides of this street have different names, so the map is not sure they are one street.',
  'R-BRIDGE-01': 'A bridge or flyover ends with nothing to hold it up or no road beyond it.',
  'R-BRIDGE-02': 'A ramp ends in the air.',
  'R-BRIDGE-03': 'The flyover comes down too steeply to clear the road under it.',
  'R-BRIDGE-04': 'The ramp is too short to climb at a safe slope.',
  'R-BRIDGE-05': 'A bridge has no road at either end.',
  'R-LANE-FIT-01': 'The two sides of the road are drawn closer together than their lanes need.',
  'R-LANE-FIT-02': 'A slip road is drawn as a short sharp diagonal that cars could not take smoothly.',
  'R-LANE-FIT-03': 'The map guessed the number of lanes here, and the guess does not match the rest of the street.',
  'R-LANE-01': 'Lanes go missing where the road splits or merges.',
  'R-LANE-02': 'A very short piece of road changes its number of lanes twice in a row.',
  'R-LANE-03': 'Two roads touch at a point where they should not.',
  'R-LANE-04': 'There is no room for the painted island where the road splits or merges.',
  'R-LANE-05': 'Two roads side by side are drawn so close that their surfaces overlap.',
  'R-LANE-06': 'The lanes of two roads overlap each other.',
  'R-JUNC-01': 'Two roads leave the junction almost on top of each other.',
  'R-JUNC-02': 'A road surface covers a junction it does not belong to.',
  'R-JUNC-03': 'Many points close together make this junction too big and messy to build as one.',
  'R-JUNC-04': 'A road arm at the junction is shorter than the curve of its corner.',
  'R-FOOT-01': 'The footpath is missing on a short piece of this street.',
  'R-FOOT-02': 'The footpath would lie in the middle of another road.',
  'R-BLDG-01': 'A building outline sat on the road or its footpath, so the road would run into a wall.',
  'R-BLDG-02': 'The building outline is broken (it crosses itself, or it is tiny or a thin sliver).',
  'R-BLDG-03': 'The same building is drawn twice.',
  'R-BLDG-04': 'The building height cannot be right for its number of floors.',
  'R-RAIL-01': 'Metro pillars would stand in the middle of a road.',
  'R-RAIL-02': 'The station has no street close to it, so nobody could walk in.',
  'R-FOB-01': 'A foot over bridge comes down where there is no footpath.',
  'R-STITCH-07': 'The road runs off the edge of the map with nothing to close it.',
  'R-HERO-01': 'This is a main road we check by hand. Its hand made plan is written when that road is built in detail.',
  'R-HERO-02': 'This main road does not match its hand made plan.',
  'R-HERO-03': 'An automatic fix changed a main road that we check by hand.',
  'R-HERO-04': 'A field in a main road plan has no source.',
  'R-TERR-01': 'The ground rises above the road surface beside it.',
  'R-TERR-02': 'A road at ground level runs through water with no bridge.',
  'R-TERR-03': 'The height data along this road jumps, so the road would have a step in it.',
  'R-TERR-04': 'A road crosses a tunnel mouth at ground level just where the tunnel tag ends, so it would lie over the open ramp.',
};

/**
 * The plain question an open issue asks the owner (P1-030: only sites the rules and the top-view judge pass could
 * not decide reach him, each as a question with options).
 */
export const QUESTION_WORDS: Record<string, string> = {
  'R-ROAD-01': 'Does this road really join the road ahead, or does it end here at a gate, a wall or a kerb?',
  'R-ROAD-02': 'Do these two roads meet here at a crossing, or does one pass over the other?',
  'R-ROAD-03': 'Is this one road drawn twice, or are these two separate roads side by side?',
  'R-JUNC-04': 'Is this short stub a real side road, or a drawing slip that should go?',
  'R-BLDG-03': 'Are these two separate buildings, one inside the other, or one building drawn twice?',
  'R-BLDG-04': 'Is this building really that tall, or is the height a typing mistake?',
  'R-LANE-01': 'How many lanes does this road really have where it splits or merges?',
};

const FIX_WORDS: Record<string, string> = {
  connect: 'Join it up', terminate: 'Keep it as a real dead end', remove: 'Take it out of the map', set_tag: 'Change how the map describes it',
  move_node: 'Move the road so it fits', set_lanes: 'Change the number of lanes', set_height: 'Change the height', replace_geometry: 'Redraw the shape', disable_repair: 'Leave it as the map has it',
};
export const fixWords = (action: string): string => FIX_WORDS[action] ?? action;

/** Swaps the map ids in a bake sentence for names: roads by name ("this road" when unnamed), nodes and footprints by kind. */
export function humanise(text: string, idx: NameIndex): string {
  return text
    .replace(/\b(?:the )?(?:junction|node) [nm]\d{3,}\b/g, 'the junction')
    .replace(/\b[wm]\d+\.\d+\b/g, (id) => { const r = idx.roads.get(id); return r?.name ? r.name : r ? `the ${classWords(r.cls)}` : 'the road'; })
    .replace(/(foot over bridge) way\/\d+/g, '$1')
    .replace(/\b(overture\/[0-9a-f-]+|way\/\d+)/g, (id) => idx.footprints.get(id)?.n ?? 'the building')
    .replace(/\bnode\/\d+\b/g, 'the point')
    .replace(/\b[nm]\d{3,}\b/g, 'the junction')
    .replace(/"" and ""/g, 'two unnamed sides')
    .replace(/\s+\(harness\/[^)]*\)/g, '');
}

export interface Description {
  /** What and where: "Unnamed service road off Janpath, 120 m north of Rajiv Chowk". */
  title: string;
  what: string;
  where: string;
  /** What is wrong, one plain sentence. */
  problem: string;
  /** The measured detail of the bake (its note), with ids swapped for names. */
  detail: string;
  /** What the most likely fix does, or null when there is no proposal. */
  fix: string | null;
  /** An issue that waits for the owner: the plain question and one line per option, the likeliest first. Null for a settled issue. */
  question: string | null;
  options: string[];
  /** How a settled issue was settled, in plain words ("Fixed by a rule", "Decided from the top view"), with the reason; null for an open one. */
  settled: string | null;
}

/** Everything a card and the detail panel say about an issue. */
export function describeIssue(i: DescribeIssue, idx: NameIndex, ruleTitle = ''): Description {
  const what = subjectWords(i, idx);
  const [sx, sz] = spotOf(i, idx);
  const where = whereWords(idx, sx, sz, what);
  const problem = PROBLEM_WORDS[i.rule] ?? (ruleTitle ? `${ruleTitle}.` : 'The map has a problem here.');
  let best: DescribeIssue['proposals'][number] | null = null;
  for (const p of i.proposals) if (!best || p.confidence > best.confidence) best = p;
  const fix = best ? `${fixWords(best.action)}: ${lowerFirst(humanise(best.reasoning, idx))}` : null;
  const open = i.status === undefined || i.status === 'open';
  const options = open ? i.proposals.slice().sort((a, b) => b.confidence - a.confidence).map((p) => `${fixWords(p.action)}: ${lowerFirst(humanise(p.reasoning, idx))}`) : [];
  const asked = QUESTION_WORDS[i.rule] ?? 'Which of these is right here?';
  const question = open ? (i.judgeNote ? `${asked} From above it was not clear: ${lowerFirst(humanise(i.judgeNote, idx))}` : asked) : null;
  const how = i.decided === 'judge' ? 'Decided from the top view' : i.decided === 'policy' ? 'Decided by a rule' : i.status === 'auto_repaired' ? 'Fixed by a rule' : i.status === 'overridden' ? 'Fixed by a patch' : i.status === 'explained' ? 'Left as it is' : null;
  const settled = open || !how ? null : i.decision ? `${how}: ${lowerFirst(humanise(i.decision, idx))}` : how;
  return { title: where ? `${what}, ${where}` : what, what, where, problem, detail: humanise(i.note ?? '', idx), fix, question, options, settled };
}

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
