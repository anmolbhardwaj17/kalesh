// KTL1 tile reader for the map inspector page (TECH.md "Tile format (T1, KTL1)"). The same bytes the game reads.
// Plain typed array views over the file: no copies, no per-vertex work. The page loads this file as it is (the
// server strips the types).

export interface Ktl1Mesh {
  name: string;
  material: string;
  /** x, y, z per vertex, metres from the tile origin. */
  pos: Float32Array;
  nrm: Float32Array;
  idx: Uint32Array;
}

export interface Ktl1Tile {
  header: {
    format: string;
    tile: { district?: string; block?: string; x: number; z: number; size: number };
    origin: [number, number, number];
  };
  meshes: Ktl1Mesh[];
}

/** Reads a KTL1 file. Throws on a wrong magic or version: a bad tile is reported by the caller and skipped. */
export function readKtl1(buffer: ArrayBuffer): Ktl1Tile {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || bytes[0] !== 0x4b || bytes[1] !== 0x54 || bytes[2] !== 0x4c || bytes[3] !== 0x31) throw new Error('not a KTL1 tile');
  const view = new DataView(buffer);
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`KTL1 version ${version} is not supported`);
  const headLen = view.getUint32(8, true);
  let json = '';
  for (let i = 0; i < headLen; i++) json += String.fromCharCode(bytes[12 + i] as number);
  const header = JSON.parse(json) as Ktl1Tile['header'] & { meshes: { name: string; material: string; vertices: number; indices: number; pos: number; nrm: number; idx: number }[] };
  const base = 12 + headLen;
  const meshes: Ktl1Mesh[] = header.meshes.map((m) => ({
    name: m.name,
    material: m.material,
    pos: new Float32Array(buffer, base + m.pos, m.vertices * 3),
    nrm: new Float32Array(buffer, base + m.nrm, m.vertices * 3),
    idx: new Uint32Array(buffer, base + m.idx, m.indices),
  }));
  return { header: { format: header.format, tile: header.tile, origin: header.origin }, meshes };
}
