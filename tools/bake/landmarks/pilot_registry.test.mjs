// The landmark registry of the pilot centre on the real stage files (P2-005 acceptance 1 and 3): built offline from
// data/pilot_centre/ (gitignored; the test skips with the reason when the files are missing) and the Wikidata cache.
// Checks the candidate count, the source id and evidence line of each, the same hash twice, that the committed files
// are this build, and that every source disagreement is in the registry's issues.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readRegistryInput } from '../sources/landmarksio.ts';
import { buildRegistry } from './registry.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = 'data/pilot_centre';
const missing = ['osm.json', 'wikidata.json', 'wikidata_entities.json'].filter((f) => !fs.existsSync(path.join(ROOT, DIR, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${DIR}): run npm run bake -- pilot --stage sources, then node tools/bake/landmarks/build.mjs` : '';

describe.skipIf(missing.length > 0)(`pilot centre landmark registry${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let read;
  let a;
  let b;
  const build = async () => {
    if (!a) {
      const lines = [];
      // net null: an offline build, the cache and the OSM tags only
      read = await readRegistryInput({ root: ROOT, stage: 'pilot', net: null, today: '2026-11-13', log: (l) => lines.push(l) });
      a = buildRegistry(read.input);
      b = buildRegistry((await readRegistryInput({ root: ROOT, stage: 'pilot', net: null, today: '2026-11-13', log: () => {} })).input);
    }
    return a;
  };

  it('gives at least 300 candidates, each with a source id and an evidence line, and the same output hash twice', async () => {
    const res = await build();
    expect(res.problems).toEqual([]);
    expect(read.wikidata.notFetched).toEqual([]);
    expect(res.entries.length).toBeGreaterThanOrEqual(300);
    for (const e of res.entries) {
      expect(e.ids.osm ?? e.ids.wikidata, e.id).toBeTruthy();
      expect(e.evidence, e.id).toMatch(/(OSM (node|way|relation)\/\d+|Wikidata Q\d+)/);
    }
    expect(b.hash).toBe(res.hash);
    expect(b.files).toEqual(res.files);
    expect(b.issuesText).toBe(res.issuesText);
  });

  it('the committed files of harness/data/landmarks/ and landmarks_markers.json are this build', async () => {
    const res = await build();
    const differ = Object.keys(res.files).filter((f) => !fs.existsSync(path.join(ROOT, f)) || fs.readFileSync(path.join(ROOT, f), 'utf8') !== res.files[f]);
    expect(differ, 'run node tools/bake/landmarks/build.mjs').toEqual([]);
    const onDisk = fs.readdirSync(path.join(ROOT, 'harness/data/landmarks')).filter((f) => f.endsWith('.json')).map((f) => `harness/data/landmarks/${f}`).sort();
    expect(onDisk).toEqual(Object.keys(res.files).filter((f) => f.startsWith('harness/data/landmarks/')).sort());
  });

  it('flags every name-fallback match and puts every entry whose sources disagree by more than 50 m in issues.json', async () => {
    const res = await build();
    const issues = JSON.parse(res.issuesText);
    expect(issues).toMatchObject({ version: 1, block: 'centre' });
    const ids = new Set(issues.issues.map((i) => i.id));
    const disagree = res.entries.filter((e) => e.agreement && e.agreement.osm_to_wikidata_m > 50 && !e.agreement.inside_footprint);
    expect(disagree.length).toBeGreaterThan(5);
    for (const e of disagree) {
      expect(ids.has(e.issue), `${e.id} ${e.issue}`).toBe(true);
      expect(e.place === 'held' || e.flags.includes('position_checked_by_hand'), e.id).toBe(true);
    }
    const named = res.entries.filter((e) => e.match === 'name_distance');
    expect(named.length).toBeGreaterThan(0);
    for (const e of named) {
      expect(e.flags, e.id).toContain('fallback_name_match');
      expect(ids.has(e.issue), e.id).toBe(true);
    }
    // every issue record has the fields the inspector reads, in world metres on the one tile grid
    for (const i of issues.issues) {
      expect(i).toMatchObject({ block: 'centre', status: expect.stringMatching(/^(open|overridden)$/) });
      expect(i.tile).toEqual([Math.floor(i.x / 250), Math.floor(i.z / 250)]);
      expect(i.features.length).toBe(2);
      expect(i.proposals.length).toBeGreaterThanOrEqual(2);
    }
    // the report on disk (when the build has been run here) lists the same issues
    const file = path.join(ROOT, 'harness/reports/map/landmarks/issues.json');
    if (fs.existsSync(file)) expect(fs.readFileSync(file, 'utf8')).toBe(res.issuesText);
  });

  it('builds in a few seconds', async () => {
    const t0 = Date.now();
    buildRegistry(read.input);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
