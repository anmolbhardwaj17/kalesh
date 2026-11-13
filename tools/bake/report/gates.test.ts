import { describe, expect, it } from 'vitest';
import { explainGates, gateInvariant, gateLog, itemMatches } from './gates.ts';
import type { GateItem, GateKey } from './gates.ts';

const empty = (): Record<GateKey, GateItem[]> => ({ openPorts: [], floatingEnds: [], unjoinedEnds: [], overlappingRoadFaces: [], laneContinuityBreaks: [], tapersOutOfLimits: [] });
const item = (id: string, kind = 'x', why?: string): GateItem => ({ id, kind, name: id, detail: `item ${id}`, ...(why ? { why } : {}) });

describe('gate explanations (P1-017)', () => {
  it('an entry names a zone by its other face: * stands for the zone number, which any map change renumbers (P1-030)', () => {
    expect(itemMatches('w77617201.0_0|zone_merge_*', 'w77617201.0_0|zone_merge_3996')).toBe(true);
    expect(itemMatches('w77617201.0_0|zone_merge_*', 'w77617201.0_0|zone_diverge_3996')).toBe(false);
    expect(itemMatches('w77617201.0_0|zone_merge_*', 'w77617201x0_0|zone_merge_1')).toBe(false);
    expect(itemMatches('w1.0_0 start', 'w1.0_0 start')).toBe(true);
    const items = empty();
    items.overlappingRoadFaces = [item('w1.0_0|zone_merge_12')];
    const r = explainGates(items, { explanations: [{ gate: 'overlappingRoadFaces', items: ['w1.0_0|zone_merge_*'], owner: 'explained', why: 'a hairline' }], findings: [] });
    expect(r.ok).toBe(true);
    expect(r.idle).toEqual([]);
  });

  it('all zero is ok with no entry', () => {
    const r = explainGates(empty(), { explanations: [], findings: [] });
    expect(r.ok).toBe(true);
    expect(gateInvariant(r).ok).toBe(true);
    expect(Object.values(r.gates).every((g) => g.count === 0)).toBe(true);
  });

  it('explains by id, by kind and by the model; an item nothing explains stops the bake', () => {
    const items = empty();
    items.unjoinedEnds = [item('w1.0_0 start'), item('w2.0_0 end')];
    items.openPorts = [item('m9.0', 'stage_edge_junction')];
    items.tapersOutOfLimits = [item('w3.0_0', 'taper', 'the lane count stays 3')];
    const file = {
      explanations: [
        { gate: 'unjoinedEnds' as const, items: ['w1.0_0 start'], owner: 'P1-036', why: 'ring has no shape' },
        { gate: 'openPorts' as const, kinds: ['stage_edge_junction'], owner: 'stage edge', why: 'junction at the outline' },
        { gate: 'floatingEnds' as const, items: ['w7.0_0 start'], owner: 'P1-035', why: 'fixed since' },
      ],
      findings: [{ what: 'drains', measured: 'flat', owner: 'P1-037' }],
    };
    const r = explainGates(items, file);
    expect(r.gates['unjoinedEnds']).toMatchObject({ count: 2, explained: 1, unexplained: 1 });
    expect(r.gates['openPorts']).toMatchObject({ count: 1, explained: 1, unexplained: 0 });
    expect(r.gates['tapersOutOfLimits']?.items[0]?.explainedBy).toBe('the model: the lane count stays 3');
    expect(r.ok).toBe(false);
    const inv = gateInvariant(r);
    expect(inv.ok).toBe(false);
    expect(inv.detail).toContain('unjoinedEnds w2.0_0 end');
    // the entry for an item that is gone is listed as idle, not an error
    expect(r.idle).toEqual([{ gate: 'floatingEnds', owner: 'P1-035', items: ['w7.0_0 start'] }]);
    expect(r.findings).toHaveLength(1);
    expect(gateLog(r).join('\n')).toContain('unjoinedEnds: 2 (1 by P1-036, 1 by NOT EXPLAINED)');
  });

  it('an entry that names another gate does not explain the item', () => {
    const items = empty();
    items.floatingEnds = [item('w1.0_0 start')];
    const r = explainGates(items, { explanations: [{ gate: 'unjoinedEnds', items: ['w1.0_0 start'], owner: 'P1-036', why: 'x' }], findings: [] });
    expect(r.ok).toBe(false);
  });
});
