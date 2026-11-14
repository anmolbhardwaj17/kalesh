// The hero model rule of the ingest (P2-007; DELHI_WORLD.md section 10 step 5, HM2; perf_budgets.json
// world.landmarks): a delivered hero landmark model (request id model_lm_<registry id>) is at most 8 parts of at most
// 25,000 triangles each, at most 6 materials in all, 3 levels per part (mesh nodes named <part>_LOD0, <part>_LOD1,
// <part>_LOD2, each level no heavier than the one before) and one far silhouette (a mesh node named `far` or
// <name>_far) under 2,000 triangles. A model that breaks a limit is rejected with every reason; one inside replaces
// the parts kit stand-in by its id (game/world/landmarks/landmark_model.gd). Pure: reads the glTF binary only.

/** Splits a .glb into its JSON and binary chunks. Throws on a file that is not glTF binary. */
export function parseGlb(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('this is not a binary glTF (.glb) file');
  const len = buf.readUInt32LE(8);
  let at = 12;
  let json = null;
  let bin = null;
  while (at + 8 <= Math.min(len, buf.length)) {
    const n = buf.readUInt32LE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + n);
    if (type === 'JSON') json = JSON.parse(body.toString('utf8'));
    else if (type === 'BIN\0') bin = body;
    at += 8 + n;
  }
  if (!json) throw new Error('the .glb has no JSON chunk');
  return { json, bin };
}

/** The level of a mesh node by its name: 0 to 2, 'far', or null. */
export function levelOfName(name) {
  const s = String(name || '').toLowerCase();
  if (s === 'far' || s.endsWith('_far')) return 'far';
  const m = /^(.+)_lod([0-9]+)$/.exec(s);
  return m ? Number(m[2]) : null;
}

const partOfName = (name) => /^(.+)_lod[0-9]+$/i.exec(String(name))?.[1] ?? null;

/** Triangles of a glTF mesh (triangle primitives: indices / 3, else positions / 3) and the materials it uses. */
export function meshTriangles(json, meshIndex) {
  const mesh = json.meshes?.[meshIndex];
  let tris = 0;
  const mats = new Set();
  for (const p of mesh?.primitives || []) {
    if ((p.mode ?? 4) !== 4) continue;
    const acc = p.indices !== undefined ? json.accessors?.[p.indices] : json.accessors?.[p.attributes?.POSITION];
    tris += Math.floor((acc?.count ?? 0) / 3);
    if (p.material !== undefined) mats.add(p.material);
  }
  return { tris, mats };
}

/**
 * The hero rule on a parsed glTF. `limits` is perf_budgets.json world.landmarks. Returns {ok, reasons, parts:
 * {name: [tris at LOD0, LOD1, LOD2]}, far: tris|null, materials}.
 */
export function heroRule(json, limits) {
  const L = { parts: limits.heroPartsMax ?? 8, perPart: limits.heroTrianglesPerPart ?? 25000, materials: limits.heroMaterialsMax ?? 6, lods: limits.heroLods ?? 3, far: limits.farSilhouetteTriangles ?? 2000 };
  const reasons = [];
  const parts = {};
  const farNodes = [];
  const used = new Set();
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    const { tris, mats } = meshTriangles(json, node.mesh);
    for (const m of mats) used.add(m);
    const lv = levelOfName(node.name);
    if (lv === 'far') {
      farNodes.push({ name: node.name, tris });
      continue;
    }
    const part = partOfName(node.name);
    if (lv === null || part === null) {
      reasons.push(`mesh node "${node.name ?? '(no name)'}" is not named <part>_LOD0, _LOD1, _LOD2 or far`);
      continue;
    }
    if (lv >= L.lods) {
      reasons.push(`mesh node "${node.name}" is level ${lv}: a hero has levels 0 to ${L.lods - 1} and a far silhouette`);
      continue;
    }
    (parts[part] ||= Array(L.lods).fill(null))[lv] = ((parts[part][lv] ?? 0) + tris);
  }
  const names = Object.keys(parts).sort();
  if (names.length === 0) reasons.push('no part: name the mesh nodes <part>_LOD0, <part>_LOD1, <part>_LOD2');
  if (names.length > L.parts) reasons.push(`${names.length} parts, a hero has at most ${L.parts}`);
  for (const n of names) {
    const lv = parts[n];
    const missing = lv.map((t, k) => (t === null ? k : null)).filter((k) => k !== null);
    if (missing.length) reasons.push(`part ${n} has no level ${missing.join(', ')}: each part needs ${L.lods} levels`);
    if ((lv[0] ?? 0) > L.perPart) reasons.push(`part ${n} has ${lv[0]} triangles at level 0, the limit is ${L.perPart}`);
    for (let k = 1; k < L.lods; k++) if (lv[k] !== null && lv[k - 1] !== null && lv[k] > lv[k - 1]) reasons.push(`part ${n} level ${k} (${lv[k]} triangles) is heavier than level ${k - 1} (${lv[k - 1]})`);
  }
  if (farNodes.length !== 1) reasons.push(farNodes.length === 0 ? 'no far silhouette: add one mesh node named far' : `${farNodes.length} far silhouettes, a hero has one`);
  const far = farNodes.reduce((n, f) => n + f.tris, 0);
  if (farNodes.length && far >= L.far) reasons.push(`the far silhouette has ${far} triangles, it must stay under ${L.far}`);
  const materials = Math.max(used.size, 0);
  if (materials > L.materials) reasons.push(`${materials} materials, a hero has at most ${L.materials}`);
  return { ok: reasons.length === 0, reasons, parts, far: farNodes.length ? far : null, materials };
}

/** True for the request id of a hero landmark model. */
export const isHeroModelId = (id) => /^model_lm_/.test(String(id));

/** Builds a .glb from a glTF JSON and a binary chunk (tests and tools that write models). */
export function makeGlb(json, bin = Buffer.alloc(0)) {
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const b = pad(bin, 0);
  const chunks = [Buffer.alloc(8), j];
  chunks[0].writeUInt32LE(j.length, 0);
  chunks[0].write('JSON', 4, 'latin1');
  if (b.length) {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.write('BIN\0', 4, 'latin1');
    chunks.push(h, b);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}

/**
 * What a delivered model contains, from its glTF JSON: triangles (every mesh a node uses, once per node), materials,
 * textures, skins, joints (bones) and whether the meshes carry skin weights. Used by the ingest note and the FBX test.
 */
export function modelStats(json) {
  let triangles = 0;
  const materials = new Set();
  let weighted = false;
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    const { tris, mats } = meshTriangles(json, node.mesh);
    triangles += tris;
    for (const m of mats) materials.add(m);
    if ((json.meshes?.[node.mesh]?.primitives || []).some((p) => p.attributes?.JOINTS_0 !== undefined && p.attributes?.WEIGHTS_0 !== undefined)) weighted = true;
  }
  const joints = new Set();
  for (const s of json.skins || []) for (const j of s.joints || []) joints.add(j);
  return { triangles, materials: materials.size, textures: (json.images || []).length, skins: (json.skins || []).length, joints: joints.size, weighted };
}
