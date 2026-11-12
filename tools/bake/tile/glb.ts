// The same tile as a glTF binary (.glb, ARCH_OPTIONS T3): the format the Phase 0 tile bench measured against T1.
// Moved here from tools/bake/tile.ts in P1-016. Pure.
import type { TileContent } from './codec.ts';

function ascii(text: string): Uint8Array {
  const safe = text.replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const out = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i++) out[i] = safe.charCodeAt(i);
  return out;
}

/** The same tile as a .glb: one node per material mesh, collider chunks as extra mesh nodes named col_*. */
export function encodeGlb(t: TileContent): Uint8Array {
  const views: { byteOffset: number; byteLength: number; target?: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: { offset: number; f32?: number[]; u32?: number[] }[] = [];
  let at = 0;
  const add = (data: number[], kind: 'f32' | 'u32', target?: number): number => {
    views.push({ byteOffset: at, byteLength: data.length * 4, ...(target ? { target } : {}) });
    chunks.push(kind === 'f32' ? { offset: at, f32: data } : { offset: at, u32: data });
    at += data.length * 4;
    return views.length - 1;
  };
  const vec3 = (data: number[], withBounds: boolean): number => {
    const acc: Record<string, unknown> = { bufferView: add(data, 'f32', 34962), componentType: 5126, count: data.length / 3, type: 'VEC3' };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i++) {
        const v = Math.fround(data[i] as number);
        if (v < (min[i % 3] as number)) min[i % 3] = v;
        if (v > (max[i % 3] as number)) max[i % 3] = v;
      }
      acc['min'] = min;
      acc['max'] = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const indices = (data: number[]): number => {
    accessors.push({ bufferView: add(data, 'u32', 34963), componentType: 5125, count: data.length, type: 'SCALAR' });
    return accessors.length - 1;
  };
  // glTF front faces are counter-clockwise: swap two corners of every triangle
  const flip = (idx: number[]): number[] => {
    const out = idx.slice();
    for (let i = 0; i + 2 < out.length; i += 3) {
      const b = out[i + 1] as number;
      out[i + 1] = out[i + 2] as number;
      out[i + 2] = b;
    }
    return out;
  };
  const materials = [...new Set(t.meshes.map((m) => m.material))];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  for (const m of t.meshes) {
    meshes.push({ name: m.name, primitives: [{ attributes: { POSITION: vec3(m.pos, true), NORMAL: vec3(m.nrm, false) }, indices: indices(flip(m.idx)), material: materials.indexOf(m.material) }] });
    nodes.push({ name: m.name, mesh: meshes.length - 1 });
  }
  for (const c of t.colliders) {
    const idx: number[] = [];
    for (let i = 0; i < c.faces.length / 3; i++) idx.push(i);
    meshes.push({ name: c.name, primitives: [{ attributes: { POSITION: vec3(c.faces, true) }, indices: indices(flip(idx)) }] });
    nodes.push({ name: c.name, mesh: meshes.length - 1 });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'tools/bake/tile.ts' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
    materials: materials.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.9 } })),
    accessors, bufferViews: views.map((v) => ({ buffer: 0, ...v })), buffers: [{ byteLength: at }],
    extras: { tile: { district: t.district, x: t.tx, z: t.tz, size: t.size }, origin: t.origin },
  };
  let json = JSON.stringify(gltf);
  while (json.length % 4 !== 0) json += ' ';
  const head = ascii(json);
  const total = 12 + 8 + head.length + 8 + at;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, head.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(head, 20);
  const bin = 20 + head.length;
  view.setUint32(bin, at, true);
  view.setUint32(bin + 4, 0x004e4942, true); // "BIN"
  for (const c of chunks) {
    if (c.f32) for (let i = 0; i < c.f32.length; i++) view.setFloat32(bin + 8 + c.offset + i * 4, c.f32[i] as number, true);
    if (c.u32) for (let i = 0; i < c.u32.length; i++) view.setUint32(bin + 8 + c.offset + i * 4, c.u32[i] as number, true);
  }
  return out;
}
