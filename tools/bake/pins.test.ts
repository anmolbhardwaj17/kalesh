import { describe, expect, it } from 'vitest';
import sourcesRaw from '../../data/SOURCES.json?raw';
import districtsRaw from '../../harness/data/districts.json?raw';
import pilotRaw from '../../harness/data/districts/pilot_centre.geojson?raw';
import { stagePlan } from './layout/stages';
import type { DistrictsWithStages, StageDef } from './layout/stages';
import { FORBIDDEN, LICENCES, SOURCE_KINDS, pinProblems } from './pins';
import type { Pin, SourcesFile } from './pins';

const sources = JSON.parse(sourcesRaw) as SourcesFile;
const good: Pin = { file: 'data/x/a.json', bytes: 10, sha256: 'a'.repeat(64), date: '2026-11-11', url: 'https://example.org/a', licence: 'CC0 1.0', credit: 'none needed (CC0)' };

describe('pin list data/SOURCES.json', () => {
  it('every pinned source has a licence and a credit line (and a hash, a size, a url, a path under data/)', () => {
    expect(Object.keys(sources.files).length).toBeGreaterThan(0);
    expect(pinProblems(sources)).toEqual([]);
  });

  it('the check fails on a source without a licence or a credit line', () => {
    const noCredit = { ...good, credit: '' };
    const { licence: _gone, ...noLicence } = good;
    void _gone;
    expect(pinProblems({ files: { a: good }, unreachable: {} })).toEqual([]);
    expect(pinProblems({ files: { a: noCredit }, unreachable: {} })).toEqual(['a: no credit line']);
    expect(pinProblems({ files: { b: noLicence as Pin }, unreachable: {} })).toEqual(['b: no licence']);
    expect(pinProblems({ files: { c: { ...good, sha256: 'xyz' } }, unreachable: {} })).toEqual(['c: sha256 is not 64 hex characters']);
    expect(pinProblems({ files: { d: { ...good, file: '/tmp/d.json' } }, unreachable: {} })).toEqual(['d: file /tmp/d.json is not under data/']);
  });

  it('every bake source kind has a licence row with a credit line, and none is FABDEM', () => {
    for (const k of SOURCE_KINDS) {
      expect(LICENCES[k].licence.length).toBeGreaterThan(2);
      expect(LICENCES[k].credit.length).toBeGreaterThan(2);
      expect(FORBIDDEN.test(k)).toBe(false);
    }
  });

  it('the pilot stage reads the five sources and never FABDEM; every pin of the stage, once fetched, carries its stage box', () => {
    const plan = stagePlan(JSON.parse(districtsRaw) as DistrictsWithStages, 'pilot', pilotRaw);
    expect(plan.sources.map((s) => s.kind).sort()).toEqual(['gedtm30', 'glo30', 'osm', 'osm_turns', 'overture_buildings', 'wikidata']);
    expect(plan.sources.some((s) => FORBIDDEN.test(s.id) || FORBIDDEN.test(s.file))).toBe(false);
    for (const s of plan.sources) {
      const pin = sources.files[s.id];
      if (!pin || s.kind === 'glo30') continue;
      expect(pin.stage, s.id).toBe('pilot');
      expect(pin.box, s.id).toBeTruthy();
    }
  });

  it('a stage that names FABDEM is refused', () => {
    const file = JSON.parse(districtsRaw) as DistrictsWithStages & { stages: Record<string, StageDef> };
    const pilot = file.stages['pilot'] as StageDef;
    const bad: DistrictsWithStages = { ...file, stages: { ...file.stages, pilot: { ...pilot, sources: [...pilot.sources, 'fabdem'] } } };
    expect(() => stagePlan(bad, 'pilot', pilotRaw)).toThrow(/never read/);
  });
});
