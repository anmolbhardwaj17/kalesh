// P1-024 base test (4): no node under World has a negative scale or a mirrored basis, on the live tree after streaming
// (city('mirror'): every Node3D under the scene's World root, local and global basis, every MultiMesh instance of the
// dressing, and every streamed collider body, which is a physics server body with no node). Checked at the start (Janpath), then after streaming in the ITO crossing and Chandni
// Chowk rings (teleport, staging).
const S = window.__sim;
const D = S.D;
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
const problems = [];
const runs = [];
const check = async (where) => {
  const m = await D.city('mirror');
  const w = D.state().world;
  runs.push({ where, nodes: m.nodes, instances: m.instances, bodies: m.bodies, bad: m.bad.length, tiles: w.tiles });
  S.log(where, { nodes: m.nodes, instances: m.instances, bodies: m.bodies, bad: m.bad, tiles: w.loaded });
  if (m.error) problems.push(`${where}: ${m.error}`);
  if (m.bad.length) problems.push(`${where}: ${m.bad.length + (m.more || 0)} mirrored: ${m.bad.slice(0, 5).join('; ')}`);
  // every live tile adds its mesh nodes (ground and roads, building shells) and its collider bodies
  if (!(m.nodes >= 2 * w.tiles)) problems.push(`${where}: only ${m.nodes} nodes under World for ${w.tiles} tiles (the streamed tiles are missing)`);
  if (!(m.bodies >= w.tiles)) problems.push(`${where}: only ${m.bodies} collider bodies for ${w.tiles} tiles`);
};
await check('start');
for (const [where, to] of [['ito_crossing', [1761.2, 0, -1229.2]], ['chandni_chowk', [773.5, 0, -4321.3]]]) {
  const ok = await D.teleport(to);
  await S.frames(3);
  if (ok !== true) { problems.push(`teleport to ${where} answered ${ok}`); continue; }
  await check(where);
}
if (problems.length) return S.failed(problems.join('; '), runs);
return S.ok(runs);
