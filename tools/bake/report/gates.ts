// The six gate counts of MAP_REPAIR.md "Verification" with their items, and the entries that explain the ones left
// (P1-017): open boundary ports, floating ends, unjoined ends, overlapping road faces, broken lane continuity and
// tapers out of limits must each be 0, or every item must be explained, by the model itself (a taper that only
// changes lane widths) or by an entry of harness/data/gate_explanations.json naming the task that owns it. An item no
// entry explains stops the bake before tiles are written (invariant GATES-01). Pure; the driver reads the file.
import type { InvariantResult } from './health.ts';

export const GATE_ORDER = ['openPorts', 'floatingEnds', 'unjoinedEnds', 'overlappingRoadFaces', 'laneContinuityBreaks', 'tapersOutOfLimits'] as const;
export type GateKey = (typeof GATE_ORDER)[number];

/** One thing a gate counts: a strip end, a map edge node, a pair of faces. `id` is stable across bakes of the same pinned data. */
export interface GateItem {
  id: string;
  /** A class of item an entry can name instead of listing ids (for example a junction at the stage edge). */
  kind: string;
  name: string;
  /** World metres, where known. */
  x?: number;
  z?: number;
  detail: string;
  /** The model's own explanation (a taper whose lane count stays): explained without an entry. */
  why?: string;
}

/** An entry of harness/data/gate_explanations.json. */
export interface GateExplanation {
  gate: GateKey;
  /** Item ids it explains, and/or item kinds. */
  items?: string[];
  kinds?: string[];
  owner: string;
  why: string;
}

/** Known defects outside the six gates, listed in the report with their owner (the same file, `findings`). */
export interface GateFinding {
  what: string;
  measured: string;
  owner: string;
}

export interface GateFile {
  explanations: GateExplanation[];
  findings: GateFinding[];
}

export interface GateLine {
  count: number;
  explained: number;
  unexplained: number;
  items: (GateItem & { explainedBy: string | null })[];
}

export interface GateReport {
  ok: boolean;
  gates: Record<string, GateLine>;
  /** Entries that matched nothing in this bake (fixed since, or their ids changed): listed, not an error. */
  idle: { gate: string; owner: string; items: string[] }[];
  findings: GateFinding[];
}

export function explainGates(items: Record<GateKey, GateItem[]>, file: GateFile): GateReport {
  const gates: Record<string, GateLine> = {};
  const used = new Set<GateExplanation>();
  const usedIds = new Map<GateExplanation, Set<string>>();
  for (const key of GATE_ORDER) {
    const list = items[key] ?? [];
    const out: GateLine['items'] = [];
    for (const it of list) {
      let by: string | null = it.why ? `the model: ${it.why}` : null;
      if (!by) {
        const e = file.explanations.find((x) => x.gate === key && ((x.items ?? []).includes(it.id) || (x.kinds ?? []).includes(it.kind)));
        if (e) {
          by = `${e.owner}: ${e.why}`;
          used.add(e);
          if (!usedIds.has(e)) usedIds.set(e, new Set());
          usedIds.get(e)!.add(it.id);
        }
      }
      out.push({ ...it, explainedBy: by });
    }
    const explained = out.filter((i) => i.explainedBy !== null).length;
    gates[key] = { count: out.length, explained, unexplained: out.length - explained, items: out };
  }
  const idle: GateReport['idle'] = [];
  for (const e of file.explanations) {
    const missing = (e.items ?? []).filter((id) => !usedIds.get(e)?.has(id));
    if (!used.has(e) || missing.length) idle.push({ gate: e.gate, owner: e.owner, items: used.has(e) ? missing : [...(e.items ?? []), ...(e.kinds ?? []).map((k) => `kind ${k}`)] });
  }
  return { ok: Object.values(gates).every((g) => g.unexplained === 0), gates, idle, findings: file.findings };
}

export function gateInvariant(r: GateReport): InvariantResult {
  const lines = GATE_ORDER.map((k) => `${k} ${r.gates[k]?.count ?? 0}${r.gates[k]?.unexplained ? ` (${r.gates[k]!.unexplained} unexplained)` : ''}`);
  if (r.ok) return { id: 'GATES-01.explained', ok: true, detail: `every gate count is 0 or explained: ${lines.join(', ')}` };
  const bad = GATE_ORDER.flatMap((k) => (r.gates[k]?.items ?? []).filter((i) => !i.explainedBy).map((i) => `${k} ${i.id} (${i.detail})`));
  return { id: 'GATES-01.explained', ok: false, detail: `${bad.length} gate items no entry explains: ${bad.slice(0, 4).join('; ')}` };
}

export function gateLog(r: GateReport): string[] {
  const out = GATE_ORDER.map((k) => {
    const g = r.gates[k] as GateLine;
    const by = new Map<string, number>();
    for (const i of g.items) {
      const who = i.explainedBy ? (i.explainedBy.split(':')[0] as string) : 'NOT EXPLAINED';
      by.set(who, (by.get(who) ?? 0) + 1);
    }
    return `${k}: ${g.count}${g.count ? ` (${[...by].map(([w, n]) => `${n} by ${w}`).join(', ')})` : ''}`;
  });
  if (r.idle.length) out.push(`entries that matched nothing this bake: ${r.idle.map((i) => `${i.gate} ${i.owner} [${i.items.join(', ')}]`).join('; ')}`);
  out.push(`known findings outside the gates: ${r.findings.map((f) => `${f.owner} ${f.what} (${f.measured})`).join('; ')}`);
  return out;
}
