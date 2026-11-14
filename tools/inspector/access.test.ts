import { describe, expect, it } from 'vitest';
import { accessInputProblems, accessSummary, applyHeadlines, buildOwnerRule, headlines, nearestAccessStrip, ownerRuleId, reasonWords } from './access.ts';
import { edgeAccess } from '../bake/graph/access.ts';
import type { AccessEdge, AccessRule } from '../bake/graph/access.ts';

const strip = (edge: string, modes: string[], r = 'context', pts: [number, number][] = [[0, 0], [50, 0]]) => ({ id: `${edge}_0`, edge, kind: 'road', cls: 'residential', name: 'Gali', ref: pts, acc: { m: modes, r, why: 'x', ways: ['way/1'] } });

describe('inspector access tab (P2-043)', () => {
  it('shows car, two-wheeler and foot per road, and tells who decided', () => {
    expect(headlines(['two_wheeler', 'cycle', 'foot', 'emergency'])).toEqual({ car: false, two_wheeler: true, foot: true });
    expect(reasonWords('owner').label).toBe('Your edit');
    expect(reasonWords('judge').label).toMatch(/judge/i);
  });

  it('the car switch covers car and auto; cycles and emergency vehicles keep what the road had', () => {
    const closed = ['two_wheeler', 'cycle', 'foot', 'emergency'];
    expect(applyHeadlines(closed, { car: true, two_wheeler: true, foot: true })).toEqual(['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency']);
    expect(applyHeadlines(['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency'], { car: false, two_wheeler: false, foot: true })).toEqual(['cycle', 'foot', 'emergency']);
    expect(applyHeadlines(['car', 'auto'], { car: false, two_wheeler: false, foot: false })).toEqual([]);
  });

  it('an owner edit is an owner rule that matches the edge by its ways and place, with a reason', () => {
    const rule = buildOwnerRule({ edge: 'w12.0', name: 'Dariba Kalan', cls: 'residential', points: [[0, 0], [30, 0], [60, 10]], ways: ['way/12'], modes: ['foot', 'cycle', 'emergency'], note: 'I walked it, no car fits', date: '2026-11-14', toGeo: (x, z) => ({ lat: 28.6 - z / 111000, lon: 77.2 + x / 98000 }) }) as { id: string; by: string; why: string; modes: string[]; match: { ways: string[]; within: { radiusM: number } } };
    expect(rule.id).toBe(ownerRuleId('w12.0'));
    expect(rule).toMatchObject({ by: 'owner', modes: ['cycle', 'foot', 'emergency'], match: { ways: ['way/12'] } });
    expect(rule.match.within.radiusM).toBeGreaterThanOrEqual(31);
    expect(rule.why.length).toBeGreaterThanOrEqual(20);
  });

  it('the owner edit beats the judge decision and the rule in the bake (owner beats judge beats rule)', () => {
    const e: AccessEdge = { id: 'w12.0', cls: 'residential', link: false, name: 'Dariba Kalan', width: 3.6, tags: {}, ways: ['way/12'], pts: [{ x: 0, z: 0 }, { x: 30, z: 0 }] };
    const gali: AccessRule = { id: 'g', by: 'rule', kind: 'context', why: 'old city gali: two-wheelers', refs: ['x'], modes: ['two_wheeler', 'cycle', 'foot', 'emergency'], match: { classes: ['residential'] } };
    const judge: AccessRule = { id: 'j', by: 'judge', kind: 'context', why: 'the picture shows cars here', refs: ['s'], modes: ['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency'], match: { ways: ['way/12'] } };
    const rule = buildOwnerRule({ edge: 'w12.0', name: '', cls: 'residential', points: [[0, 0], [30, 0]], ways: ['way/12'], modes: ['foot', 'emergency'], note: 'walkers only, a market lane', date: '2026-11-14', toGeo: (x, z) => ({ lat: z, lon: x }) });
    const ownerRule: AccessRule = { ...(rule as unknown as AccessRule), match: { ways: ['way/12'] } };
    const ctx = (rules: AccessRule[]) => ({ rules, openAt: () => null, areaAt: () => null, barriers: new Map() });
    expect(edgeAccess(e, ctx([gali, judge])).reason).toBe('judge');
    expect(edgeAccess(e, ctx([ownerRule, judge, gali]))).toMatchObject({ reason: 'owner', modes: ['foot', 'emergency'] });
  });

  it('refuses an edit with no road or no answer for one of the three modes; counts roads once, not per carriageway', () => {
    expect(accessInputProblems({ edge: '', want: { car: true } })).toHaveLength(2);
    expect(accessInputProblems({ edge: 'w1.0', want: { car: true, two_wheeler: false, foot: true } })).toEqual([]);
    const strips = [strip('a', ['car']), strip('b', ['foot'], 'rule'), strip('b', ['foot'], 'rule')];
    expect(accessSummary(strips)).toEqual({ edges: 2, carFree: 1, byReason: { context: 1, rule: 1 } });
  });

  it('finds the road under a click', () => {
    const strips = [strip('a', ['car'], 'class', [[0, 0], [100, 0]]), strip('b', ['foot'], 'rule', [[0, 10], [100, 10]])];
    expect(nearestAccessStrip(strips, 50, 8, 4)?.strip.edge).toBe('b');
    expect(nearestAccessStrip(strips, 50, 40, 4)).toBeNull();
  });
});
