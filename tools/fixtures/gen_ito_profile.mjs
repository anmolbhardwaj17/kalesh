#!/usr/bin/env node
// Writes harness/data/fixtures/ito_phase0_profile.json: the heights the Phase 0 road bench solved at the ITO site
// (tools/bake/roads/site.ts with the dense prototype solver, P0-019), for every strip that carries a structure (the
// flyover decks and their ramps), as lat, lon and height. The production elevation solver (tools/bake/elevation/) is
// held against it on the pilot centre (tools/bake/elevation/pilot_elevation.test.mjs): the flyover must come out
// within 0.3 m of this. Needs the Phase 0 downloads (data/pilot/, gitignored):
//   node tools/fixtures/gen_ito_profile.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../bake/roads/site.ts';
import { SITES, groundSampler } from '../../harness/bench/roads.mjs';
import { pilotAreas } from '../../harness/bench/pilot_data/lib.mjs';
import { loadArea } from '../../harness/bench/pilot_data/load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'harness', 'data', 'fixtures', 'ito_phase0_profile.json');
const def = SITES.find((s) => s.id === 'ito');
const area = pilotAreas().find((a) => a.id === def.area);
const ctx = loadArea(area);
if (!ctx) throw new Error('data/pilot/osm/ito.json is missing: run node harness/bench/pilot_data/fetch.mjs first');
const ground = await groundSampler(ctx, def.region);
const r = buildSite({ site: { id: def.id, name: def.name, region: def.region, classes: def.classes, exclude: def.exclude, clusterDist: def.clusterDist }, roads: ctx.map.roads, ground: ground.at, heroes: [] });
const r2 = (v) => Math.round(v * 100) / 100;
const strips = [];
let worst = 0;
for (const s of r.strips) {
  if (!s.st.some((st) => st.structure > 0)) continue;
  // curvature of the solved profile, for the record: the second difference over three stations
  for (let i = 1; i + 1 < s.st.length; i++) {
    const d1 = Math.hypot(s.st[i].x - s.st[i - 1].x, s.st[i].z - s.st[i - 1].z);
    const d2 = Math.hypot(s.st[i + 1].x - s.st[i].x, s.st[i + 1].z - s.st[i].z);
    if (d1 < 1 || d2 < 1) continue;
    worst = Math.max(worst, Math.abs((s.st[i + 1].h - s.st[i].h) / d2 - (s.st[i].h - s.st[i - 1].h) / d1) / ((d1 + d2) / 2));
  }
  strips.push({
    id: s.id, cls: s.cls, link: s.link, ways: s.ways, maxAboveGroundM: r2(Math.max(...s.st.map((st) => st.h - st.g))),
    pts: s.st.map((st) => {
      const g = ctx.proj.toGeo(st.x, st.z);
      return [Math.round(g.lat * 1e7) / 1e7, Math.round(g.lon * 1e7) / 1e7, r2(st.h), r2(st.g), st.structure];
    }),
  });
}
const out = {
  _doc: 'Heights of the ITO flyover and its ramps as the Phase 0 road bench solved them (tools/bake/roads/site.ts, dense prototype solver, P0-019), written by tools/fixtures/gen_ito_profile.mjs. One entry per strip with a structure; pts are [lat, lon, carriageway height m, ground model m, structure (0 at grade, 1 ramp on fill, 2 deck)]. Do not edit by hand.',
  site: def.id, excluded: def.exclude, solver: r.solve, tightestVerticalCurveRadiusM: Math.round(1 / worst), strips,
};
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}: ${strips.length} strips, ${strips.reduce((n, s) => n + s.pts.length, 0)} points, tightest vertical curve radius ${out.tightestVerticalCurveRadiusM} m`);
for (const s of strips) console.log(`  ${s.id} ${s.cls}${s.link ? '_link' : ''} ${s.pts.length} points, up to ${s.maxAboveGroundM} m above the ground, ways ${s.ways.join(' ')}`);
