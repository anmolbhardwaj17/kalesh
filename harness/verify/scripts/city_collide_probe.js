// P1-024 base test (2a): collision shapes match the visible meshes in the real city. 200 seeded points over 10 tiles
// (harness/data/fixtures/city_routes.json probeTiles: Connaught Place, Janpath, ITO, the Ring Road flyover, Chandni
// Chowk, India Gate, Jama Masjid, the station): for each tile the player is staged at its centre (teleport, so its ring
// is live), then a ray down from above everything meets the colliders and the highest drawn surface of the tile files is
// found at the same point (city('surface')). Every probe must hit a collider within 0.05 m of the drawn surface.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const tiles = data.probeTiles || [];
if (tiles.length !== 10) return S.failed(`city_routes.json probeTiles has ${tiles.length} tiles, the test wants 10`);
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
// a fixed seed: the same 200 points on every run (Park-Miller)
let seed = 24024;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const problems = [];
const perTile = {};
let worst = { gapM: 0 };
let count = 0;
for (const id of tiles) {
  const [tx, tz] = id.split('_').map(Number);
  const ok = await D.teleport([tx * 250 + 125, 0, tz * 250 + 125]);
  await S.frames(2);
  if (ok !== true) { problems.push(`teleport to tile ${id} answered ${ok}`); continue; }
  const pts = [];
  for (let i = 0; i < 20; i++) pts.push([tx * 250 + 2 + rnd() * 246, tz * 250 + 2 + rnd() * 246]);
  const res = await D.city('surface', { points: pts });
  const bad = res.filter((r) => !r.hit || !r.drawn || !(r.gapM <= 0.05));
  const mats = {};
  for (const r of res) mats[r.material] = (mats[r.material] || 0) + 1;
  perTile[id] = { probes: res.length, bad: bad.length, maxGapM: Math.max(...res.map((r) => r.gapM)), materials: mats };
  for (const r of res) if (r.gapM > worst.gapM) worst = { ...r, tile: id };
  count += res.length;
  for (const r of bad.slice(0, 3)) problems.push(`tile ${id} at ${r.x.toFixed(1)}, ${r.z.toFixed(1)}: ${!r.hit ? 'no collider' : !r.drawn ? 'nothing drawn' : `collider ${r.colliderY.toFixed(3)} against drawn ${r.drawnY.toFixed(3)} (${r.material}), ${r.gapM.toFixed(3)} m`}`);
  S.log(id, perTile[id]);
}
if (count !== 200) problems.push(`${count} probes, not 200`);
if (problems.length) return S.failed(problems.slice(0, 12).join('; '), { perTile, worst });
return S.ok({ probes: count, worst, perTile });
