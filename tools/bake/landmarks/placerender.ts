// North-up pictures of the landmark placement (P2-006): pads, zones, surroundings, the buildings a landmark took and
// the far landmarks on their bearings. Pure: returns SVG text.
import type { Box2, P2 } from '../geom.ts';
import type { PlaceResult, Placement } from './place.ts';

export interface PlaceMap {
  outline: readonly P2[];
  /** Road centre lines with their width (block metres). */
  roads: readonly { pts: readonly P2[]; width: number }[];
  open: readonly (readonly P2[])[];
  water: readonly (readonly P2[])[];
  /** The plain buildings that stay. */
  buildings: readonly (readonly P2[])[];
  /** The footprints a landmark took, by how. */
  taken: readonly { ring: readonly P2[]; how: 'replaced' | 'part' }[];
  /** Wall and fence lines the surroundings name. */
  lines: readonly { pts: readonly P2[]; wall: boolean }[];
}

const TIER_COLOUR = { hero: '#d62828', signature: '#f77f00', marker: '#3a6ea5' } as const;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The placement of a box of the stage. `far` draws the far landmarks as arrows on the edge of the picture. */
export function placementSvg(res: PlaceResult, map: PlaceMap, box: Box2, title: string, opt: { labels: 'all' | 'named'; far: boolean; pivot?: P2; offset?: P2 } = { labels: 'named', far: false }): string {
  const W = 2400;
  const scale = W / (box.maxX - box.minX);
  const H = Math.round((box.maxZ - box.minZ) * scale);
  const X = (x: number): string => ((x - box.minX) * scale).toFixed(1);
  const Y = (z: number): string => ((z - box.minZ) * scale).toFixed(1);
  const inBox = (pts: readonly P2[], pad = 0): boolean => pts.some((p) => p.x >= box.minX - pad && p.x <= box.maxX + pad && p.z >= box.minZ - pad && p.z <= box.maxZ + pad);
  const poly = (ring: readonly P2[]): string => ring.map((p) => `${X(p.x)},${Y(p.z)}`).join(' ');
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 150}" viewBox="0 0 ${W} ${H + 150}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H + 150}" fill="#f3efe6"/>`);
  out.push(`<clipPath id="map"><rect width="${W}" height="${H}"/></clipPath><g clip-path="url(#map)">`);
  out.push(`<polygon points="${poly(map.outline)}" fill="#e9e4d8" stroke="#8a8578" stroke-width="2"/>`);
  // forecourts lie on plain ground only: the lawns and the water of the map are drawn over them, as the ground lays them
  for (const g of res.ground) if (g.cls === 'forecourt' && inBox(g.ring)) out.push(`<polygon points="${poly(g.ring)}" fill="${g.material === 'lawn' ? '#b9d3a0' : '#e6c9a3'}"/>`);
  for (const r of map.open) if (inBox(r)) out.push(`<polygon points="${poly(r)}" fill="#b9d3a0"/>`);
  for (const r of map.water) if (inBox(r)) out.push(`<polygon points="${poly(r)}" fill="#8fb8d8"/>`);
  for (const r of map.buildings) if (inBox(r)) out.push(`<polygon points="${poly(r)}" fill="#cfc8ba"/>`);
  for (const r of map.roads) if (inBox(r.pts, 30)) out.push(`<polyline points="${poly(r.pts)}" fill="none" stroke="#6f6c66" stroke-width="${Math.max(1, r.width * scale).toFixed(1)}" stroke-linejoin="round"/>`);
  for (const t of map.taken) if (inBox(t.ring)) out.push(`<polygon points="${poly(t.ring)}" fill="${t.how === 'part' ? '#c98b5e' : '#c0392b'}" fill-opacity="${t.how === 'part' ? 0.85 : 0.55}" stroke="#7a3b1d" stroke-width="0.6"/>`);
  for (const g of res.ground) {
    if (!inBox(g.ring)) continue;
    if (g.cls === 'moat') out.push(`<polygon points="${poly(g.ring)}" fill="#7b6a58" fill-opacity="0.8"/>`);
    else if (g.cls === 'wallbase') out.push(`<polygon points="${poly(g.ring)}" fill="#7a2e1d"/>`);
    else if (g.cls === 'pad') out.push(`<polygon points="${poly(g.ring)}" fill="#f6e27a" stroke="#8a6d00" stroke-width="1.5"/>`);
  }
  for (const l of map.lines) if (inBox(l.pts)) out.push(`<polyline points="${poly(l.pts)}" fill="none" stroke="${l.wall ? '#7a2e1d' : '#5b6770'}" stroke-width="${l.wall ? 2.5 : 1.5}" ${l.wall ? '' : 'stroke-dasharray="6 4"'}/>`);
  const label = (p: Placement): boolean => opt.labels === 'all' || p.tier !== 'marker';
  for (const p of res.placements) {
    if (p.x < box.minX || p.x > box.maxX || p.z < box.minZ || p.z > box.maxZ) {
      if (!p.zone || !inBox(p.zone.ring)) continue;
    }
    const col = TIER_COLOUR[p.tier];
    if (p.zone) out.push(`<polygon points="${poly(p.zone.ring)}" fill="none" stroke="${col}" stroke-width="${p.tier === 'marker' ? 1.5 : 3}" stroke-dasharray="${p.mode === 'site' ? '14 6' : '5 4'}"/>`);
    if (p.footprint) out.push(`<polygon points="${poly(p.footprint)}" fill="${col}" fill-opacity="${p.mode === 'structure' ? 0.55 : 0.06}" stroke="${col}" stroke-width="1"/>`);
    const r = p.tier === 'hero' ? 9 : p.tier === 'signature' ? 7 : 4;
    out.push(`<circle cx="${X(p.x)}" cy="${Y(p.z)}" r="${r}" fill="${p.underground ? '#ffffff' : col}" stroke="${col}" stroke-width="2"/>`);
    // the front: an arrow along the bearing the landmark faces
    if (p.yawDeg !== null && p.mode !== 'point') {
      const len = (p.tier === 'hero' ? 46 : 28) * (p.frontKnown ? 1 : 0.6);
      const dx = Math.sin((p.yawDeg * Math.PI) / 180) * len;
      const dy = -Math.cos((p.yawDeg * Math.PI) / 180) * len;
      out.push(`<line x1="${X(p.x)}" y1="${Y(p.z)}" x2="${(Number(X(p.x)) + dx).toFixed(1)}" y2="${(Number(Y(p.z)) + dy).toFixed(1)}" stroke="${col}" stroke-width="${p.frontKnown ? 3 : 1.5}" ${p.frontKnown ? '' : 'stroke-dasharray="4 3"'}/>`);
    }
    if (label(p)) out.push(`<text x="${(Number(X(p.x)) + r + 5).toFixed(1)}" y="${(Number(Y(p.z)) - r - 3).toFixed(1)}" font-size="${p.tier === 'hero' ? 30 : p.tier === 'signature' ? 20 : 16}" font-weight="${p.tier === 'hero' ? 700 : 400}" fill="#1c1c1c" stroke="#f3efe6" stroke-width="4" paint-order="stroke">${esc(p.name)}</text>`);
  }
  if (opt.far && opt.pivot && opt.offset) {
    // far landmarks: an arrow from the pivot's side of the picture edge along the world bearing
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    for (const f of res.far) {
      const b = (f.worldBearingDeg * Math.PI) / 180;
      const dx = Math.sin(b);
      const dz = -Math.cos(b);
      const t = Math.min(dx > 0 ? (box.maxX - cx) / dx : dx < 0 ? (box.minX - cx) / dx : Infinity, dz > 0 ? (box.maxZ - cz) / dz : dz < 0 ? (box.minZ - cz) / dz : Infinity) * 0.93;
      const ex = cx + dx * t;
      const ez = cz + dz * t;
      const sx = cx + dx * (t - 220);
      const sz = cz + dz * (t - 220);
      out.push(`<line x1="${X(sx)}" y1="${Y(sz)}" x2="${X(ex)}" y2="${Y(ez)}" stroke="#5a189a" stroke-width="5"/><circle cx="${X(ex)}" cy="${Y(ez)}" r="9" fill="#5a189a"/>`);
      out.push(`<text x="${X(sx)}" y="${(Number(Y(sz)) - 12).toFixed(1)}" font-size="22" fill="#5a189a" stroke="#f3efe6" stroke-width="4" paint-order="stroke" text-anchor="middle">${esc(f.name)}: ${f.worldBearingDeg.toFixed(1)} deg, ${(f.worldDistanceM / 1000).toFixed(1)} km (backdrop)</text>`);
    }
  }
  out.push('</g>');
  const s = res.stats;
  out.push(`<text x="24" y="${H + 44}" font-size="34" font-weight="700" fill="#1c1c1c">${esc(title)}</text>`);
  out.push(`<text x="24" y="${H + 84}" font-size="24" fill="#333">Placed ${s.placed} (hero ${s.byTier.hero}, signature ${s.byTier.signature}, marker ${s.byTier.marker}); ${s.pads} pads (${s.padM2} m2), ${s.zones} zones; buildings replaced ${s.replaced}, taken as parts ${s.parts}; far ${s.far}; not placed ${s.skipped}</text>`);
  const key: [string, string][] = [['#f6e27a', 'pad (flat)'], ['#e6c9a3', 'forecourt'], ['#b9d3a0', 'lawn'], ['#8fb8d8', 'water'], ['#7a2e1d', 'wall'], ['#7b6a58', 'moat'], ['#c0392b', 'building replaced'], ['#c98b5e', 'building taken as a part'], ['#cfc8ba', 'plain building']];
  let kx = 24;
  for (const [c, t] of key) {
    out.push(`<rect x="${kx}" y="${H + 104}" width="26" height="26" fill="${c}" stroke="#555"/><text x="${kx + 34}" y="${H + 125}" font-size="22" fill="#333">${t}</text>`);
    kx += 60 + t.length * 12;
  }
  out.push(`<text x="${kx + 10}" y="${H + 125}" font-size="22" fill="#333">dashed outline: zone (red hero, orange signature, blue marker); line from the dot: the front</text>`);
  out.push('</svg>');
  return out.join('\n');
}
