// Map inspector: the pure parts shared by the page, the server and the tests (TECH.md "Map inspector",
// MAP_REPAIR.md "Issue record" and "Overrides format"). No file or DOM access here, so the browser loads this file
// as it is (the server strips the types) and vitest imports it directly. Coordinates are world metres (the one world
// grid of the bake): east +X, north -Z, up +Y, no mirroring.

export const TILE_SIZE = 250;
/** Issues at or above this impact are "high impact" and sort first (MAP_REPAIR.md "Auto-repair bounds"). */
export const HIGH_IMPACT = 0.7;

export type PatchAction = 'connect' | 'terminate' | 'remove' | 'set_tag' | 'move_node' | 'set_lanes' | 'set_height' | 'replace_geometry' | 'disable_repair';
export type IssueStatus = 'open' | 'auto_repaired' | 'overridden' | 'explained';

export interface Proposal {
  action: PatchAction;
  params: Record<string, string | number | boolean>;
  confidence: number;
  reasoning: string;
  /** A polyline in world metres that the page draws. */
  preview: { x: number; z: number }[];
}

export interface IssueRecord {
  id: string;
  rule: string;
  block: string;
  district: string | null;
  /** World tile indices of the 250 m grid. */
  tile: [number, number];
  lat: number;
  lon: number;
  x: number;
  z: number;
  /** Ground height in metres above the page's datum (display only). */
  y?: number;
  features: string[];
  impact: number;
  confidence: number;
  status: IssueStatus;
  note?: string;
  proposals: Proposal[];
}

export interface IssuesFile {
  version: 1;
  block: string;
  /** Where the data came from, for the page footer. */
  source: string;
  rules: Record<string, string>;
  issues: IssueRecord[];
}

export interface Patch {
  id: string;
  issue: string;
  action: PatchAction;
  target: { ids: string[]; anchor: { lat: number; lon: number }; tolerance_m: number };
  params: Record<string, string | number | boolean>;
  why: string;
  by: string;
  source: string;
  date: string;
}

/** High impact: still open (waiting for a person) and impact 0.7 or more. */
export const isHigh = (i: Pick<IssueRecord, 'impact' | 'status'>): boolean => i.impact >= HIGH_IMPACT && i.status === 'open';

const STATUS_ORDER: Record<IssueStatus, number> = { open: 0, overridden: 1, explained: 2, auto_repaired: 3 };

/** The queue order: high impact first, then open before the rest, then by impact, then by id (stable). */
export function sortIssues(list: readonly IssueRecord[]): IssueRecord[] {
  return [...list].sort((a, b) => {
    const ha = isHigh(a) ? 0 : 1;
    const hb = isHigh(b) ? 0 : 1;
    if (ha !== hb) return ha - hb;
    if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (a.impact !== b.impact) return b.impact - a.impact;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The tile of a position on the 250 m grid. The same rule as the one world grid of the bake
 * (tools/bake/layout/grid.ts `tileOf`; tools/bake/layout/grid.test.ts holds the two in step). This file stays free of
 * imports so the page can load it as it is. The issues of the production bake carry world metres (tools/bake/repair/
 * engine.ts `issueRecords` adds the block's offset), so this is the tile of the override file.
 */
export function worldTile(x: number, z: number): [number, number] {
  return [Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)];
}

export const overrideFileName = (tile: readonly [number, number]): string => `${tile[0]}_${tile[1]}.json`;

const ACTION_WORDS: Record<PatchAction, string> = {
  connect: 'Join the roads',
  terminate: 'End the road here',
  remove: 'Remove it',
  set_tag: 'Change a tag',
  move_node: 'Move the point',
  set_lanes: 'Set the lane count',
  set_height: 'Set the height',
  replace_geometry: 'Redraw it',
  disable_repair: 'Leave it as it is',
};

/** Plain English name of a fix. */
export const actionWords = (a: string): string => ACTION_WORDS[a as PatchAction] ?? a;

/** Ids of graph nodes ("n123", "m45.0", "x..."): not targets of a patch (the same test as tools/bake/rules/types.ts isNodeId). */
export const isNodeId = (id: string): boolean => /^(n\d|m\d|x)/.test(id);

/** Builds the override patch (MAP_REPAIR.md "Overrides format") for a picked proposal. */
export function buildPatch(issue: IssueRecord, proposal: Proposal, opts: { note?: string; date: string; id: string; by?: string }): Patch {
  const note = (opts.note ?? '').trim();
  return {
    id: opts.id,
    issue: issue.id,
    action: proposal.action,
    target: { ids: issue.features.filter((f) => !isNodeId(f)), anchor: { lat: issue.lat, lon: issue.lon }, tolerance_m: 15 },
    params: proposal.params,
    why: note || proposal.reasoning,
    by: opts.by ?? 'owner',
    source: 'inspector',
    date: opts.date,
  };
}

/**
 * Adds a patch to the patches already in a tile's override file. One patch per issue: a new pick for the same
 * issue replaces the old one and keeps its id. Other patches (from the bake, or by hand) are left as they are.
 */
export function mergePatch(existing: readonly Patch[], tile: readonly [number, number], patch: Omit<Patch, 'id'> & { id?: string }): { patches: Patch[]; patch: Patch; replaced: boolean } {
  const at = existing.findIndex((p) => p.issue === patch.issue);
  if (at >= 0) {
    const kept = existing[at] as Patch;
    const merged: Patch = { ...patch, id: kept.id };
    const out = [...existing];
    out[at] = merged;
    return { patches: out, patch: merged, replaced: true };
  }
  const merged: Patch = { ...patch, id: patch.id ?? nextPatchId(existing, tile) };
  return { patches: [...existing, merged], patch: merged, replaced: false };
}

export function nextPatchId(existing: readonly { id: string }[], tile: readonly [number, number]): string {
  const prefix = `ov_${tile[0]}_${tile[1]}_`;
  let n = 0;
  for (const p of existing) if (p.id.startsWith(prefix)) n = Math.max(n, Number(p.id.slice(prefix.length)) || 0);
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

/** The inbox text of a pick (plain English, no em dashes): the loop reads it with `task.mjs inbox`. */
export function inboxText(issue: IssueRecord, proposal: Proposal | null, note: string, patchId: string | null, file: string | null): string {
  const where = `at x ${Math.round(issue.x)}, z ${Math.round(issue.z)}`;
  const n = note.trim();
  if (proposal) {
    return `Map inspector: for issue ${issue.id} ${where} I picked "${actionWords(proposal.action)}"${n ? `. Note: ${n}` : ''}. Patch ${patchId} is in ${file}.`;
  }
  return `Map inspector: note on issue ${issue.id} ${where}: ${n}`;
}

/** Screen-side helper: which issues does a filter keep. */
export type Filter = 'needs' | 'all' | 'auto' | 'picked';
export function filterIssues(list: readonly IssueRecord[], filter: Filter, picked: ReadonlySet<string>): IssueRecord[] {
  switch (filter) {
    case 'needs': return list.filter((i) => i.status === 'open' && !picked.has(i.id));
    case 'auto': return list.filter((i) => i.status === 'auto_repaired' || i.status === 'explained');
    case 'picked': return list.filter((i) => picked.has(i.id) || i.status === 'overridden');
    default: return [...list];
  }
}

/** The top proposal: the one with the highest confidence (the bake applies it as provisional). */
export function bestProposal(i: Pick<IssueRecord, 'proposals'>): Proposal | null {
  let best: Proposal | null = null;
  for (const p of i.proposals) if (!best || p.confidence > best.confidence) best = p;
  return best;
}

/** Free text search of the queue: every word must appear in the rule title, the note, the district or the id. */
export function searchIssues<T extends Pick<IssueRecord, 'id' | 'rule' | 'note' | 'district'>>(list: readonly T[], query: string, title: (i: T) => string = (i) => i.rule): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((i) => {
    const hay = `${title(i)} ${i.rule} ${i.note ?? ''} ${i.district ?? ''} ${i.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Scale bar: a round length (1, 2 or 5 times a power of ten metres) about `targetPx` long at `metresPerPx`. */
export function niceScale(metresPerPx: number, targetPx = 110): { metres: number; px: number; label: string } {
  if (!(metresPerPx > 0) || !Number.isFinite(metresPerPx)) return { metres: 0, px: 0, label: '' };
  const raw = metresPerPx * targetPx;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((s) => s * pow >= raw * 0.75) ?? 10;
  const metres = step * pow;
  return { metres, px: metres / metresPerPx, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}

export type LaneType = 'drive' | 'kerb' | 'footpath' | 'median' | 'parking' | 'planter' | 'gore' | string;
/**
 * The painted line between two neighbouring lanes of the lanes layer (laneout.ts, lanes [type, direction] left to
 * right): 'centre' between drive lanes of opposite directions, 'lane' between drive lanes of one direction, none else.
 */
export function laneBorder(left: readonly [LaneType, number] | undefined, right: readonly [LaneType, number] | undefined): 'centre' | 'lane' | null {
  if (!left || !right || left[0] !== 'drive' || right[0] !== 'drive') return null;
  return left[1] !== right[1] && left[1] !== 0 && right[1] !== 0 ? 'centre' : 'lane';
}
