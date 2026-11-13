// A north-up picture of the landmark registry of a stage (SVG text; the driver turns it into a PNG): x east to the
// right, z south downwards, so north is up with no flip. Arterials grey and hero roads brown, the stage outline
// dashed, focus districts as thin outlines. Heroes are large red dots with their footprint and name, signatures
// orange with their name, markers small blue dots (grey when there is no OSM object to place). A red ring marks an
// entry that is held because its sources disagree, with a line to the Wikidata point. Far landmarks are arrows on
// the frame with their name, bearing and distance. Pure.
import { projector } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';
import type { RegistryInput } from './registry.ts';
import type { Entry } from './types.ts';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function registrySvg(input: RegistryInput, entries: readonly Entry[], title: string, pad = 700): string {
  const proj = projector(input.origin);
  const ll = (lat: number, lon: number): P2 => proj.toWorld(lat, lon);
  const outline = input.outline.map(([lon, lat]) => ll(lat, lon));
  const xs = outline.map((p) => p.x);
  const zs = outline.map((p) => p.z);
  const minX = Math.floor(Math.min(...xs) - pad);
  const minZ = Math.floor(Math.min(...zs) - pad);
  const w = Math.ceil(Math.max(...xs) + pad - minX);
  const h = Math.ceil(Math.max(...zs) + pad - minZ);
  const f = (v: number): string => (Math.round(v * 10) / 10).toString();
  const line = (pts: readonly P2[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.z)}`).join('');
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${w} ${h}" width="${w}" height="${h}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect x="${minX}" y="${minZ}" width="${w}" height="${h}" fill="#f7f5f0"/>`);
  out.push(`<path d="${input.roads.filter((r) => !r.hero).map((r) => line(r.pts)).join('')}" fill="none" stroke="#b9b6ae" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
  out.push(`<path d="${input.roads.filter((r) => r.hero).map((r) => line(r.pts)).join('')}" fill="none" stroke="#a9825a" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const d of input.districts) {
    const ring = d.coords.map(([lon, lat]) => ll(lat, lon));
    out.push(`<path d="${line(ring)}Z" fill="none" stroke="#7d8aa0" stroke-width="5" stroke-dasharray="14 12"/>`);
    const top = ring.reduce((a, b) => (b.z < a.z ? b : a));
    out.push(`<text x="${f(top.x)}" y="${f(top.z - 25)}" font-size="70" fill="#7d8aa0" text-anchor="middle">${esc(d.id)}</text>`);
  }
  out.push(`<path d="${line(outline)}Z" fill="none" stroke="#555" stroke-width="8" stroke-dasharray="40 20"/>`);

  const near = entries.filter((e) => !e.far);
  const order = { marker: 0, signature: 1, hero: 2 } as const;
  const labels: string[] = [];
  for (const e of [...near].sort((a, b) => order[a.tier] - order[b.tier])) {
    const p = ll(e.lat, e.lon);
    if (e.tier !== 'marker' && e.footprint?.ring) {
      out.push(`<path d="${line(e.footprint.ring.map(([la, lo]) => ll(la, lo)))}Z" fill="${e.tier === 'hero' ? '#d8432f' : '#ef9a2a'}" fill-opacity="0.25" stroke="${e.tier === 'hero' ? '#d8432f' : '#ef9a2a'}" stroke-width="4"/>`);
    }
    if (e.tier === 'hero' && typeof e.extent?.['outer_circle_radius_m'] === 'number') out.push(`<circle cx="${f(p.x)}" cy="${f(p.z)}" r="${e.extent['outer_circle_radius_m']}" fill="none" stroke="#d8432f" stroke-width="5" stroke-dasharray="18 10"/>`);
    if (e.place === 'held' && e.agreement) {
      const q = ll(e.agreement.wikidata[0], e.agreement.wikidata[1]);
      // a far away Wikidata point (a wrong tag) is drawn as a short stub, not a line across the map
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const k = d > 600 ? 600 / d : 1;
      out.push(`<path d="M${f(p.x)} ${f(p.z)}L${f(p.x + (q.x - p.x) * k)} ${f(p.z + (q.z - p.z) * k)}" stroke="#c2185b" stroke-width="5"/>`);
      out.push(`<circle cx="${f(p.x)}" cy="${f(p.z)}" r="42" fill="none" stroke="#c2185b" stroke-width="7"/>`);
    }
    const r = e.tier === 'hero' ? 46 : e.tier === 'signature' ? 26 : 13;
    const fill = e.tier === 'hero' ? '#d8432f' : e.tier === 'signature' ? '#ef9a2a' : e.place === 'unplaced' ? '#9a9a9a' : '#3d7bd9';
    out.push(`<circle cx="${f(p.x)}" cy="${f(p.z)}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="${e.tier === 'marker' ? 3 : 5}"${e.worship ? ' stroke-dasharray="6 4"' : ''}/>`);
    if (e.underground) out.push(`<path d="M${f(p.x - r)} ${f(p.z + r + 8)}L${f(p.x + r)} ${f(p.z + r + 8)}" stroke="#333" stroke-width="6"/>`);
    if (e.tier === 'hero') labels.push(`<text x="${f(p.x + 60)}" y="${f(p.z - 40)}" font-size="120" font-weight="bold" fill="#8f2416" stroke="#f7f5f0" stroke-width="10" paint-order="stroke">${esc(e.name.en)}  ${e.height_m ?? '?'} m</text>`);
    else if (e.tier === 'signature') labels.push(`<text x="${f(p.x + 36)}" y="${f(p.z + 18)}" font-size="58" fill="#7a4a05" stroke="#f7f5f0" stroke-width="7" paint-order="stroke">${esc(e.name.en.length > 30 ? `${e.name.en.slice(0, 29)}.` : e.name.en)}${e.station ? ' (station)' : ''}</text>`);
  }
  out.push(...labels);

  // far landmarks: an arrow from the frame edge along the real bearing from the pivot
  const cz = minZ + h / 2;
  const pivot = ll(input.origin.lat, input.origin.lon);
  out.push(`<circle cx="${f(pivot.x)}" cy="${f(pivot.z)}" r="70" fill="none" stroke="#222" stroke-width="5"/>`);
  // labels of arrows that end on the same edge are stacked, so three landmarks to the south do not print on each other
  const stack = new Map<string, number>();
  for (const e of entries.filter((x) => x.far && x.bearing_deg !== undefined).sort((a, b) => (a.bearing_deg as number) - (b.bearing_deg as number))) {
    const a = ((e.bearing_deg as number) * Math.PI) / 180;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    // from the pivot along the bearing to the inner edge of the frame
    const tx = dx > 0 ? (minX + w - 260 - pivot.x) / dx : dx < 0 ? (minX + 260 - pivot.x) / dx : Infinity;
    const tz = dz > 0 ? (minZ + h - 200 - pivot.z) / dz : dz < 0 ? (minZ + 320 - pivot.z) / dz : Infinity;
    const t = Math.min(tx, tz);
    const tip = { x: pivot.x + dx * t, z: pivot.z + dz * t };
    const tail = { x: pivot.x + dx * (t - 380), z: pivot.z + dz * (t - 380) };
    out.push(`<path d="M${f(pivot.x)} ${f(pivot.z)}L${f(tail.x)} ${f(tail.z)}" stroke="#5b3fa6" stroke-width="3" stroke-dasharray="10 16" opacity="0.5"/>`);
    out.push(`<path d="M${f(tail.x)} ${f(tail.z)}L${f(tip.x)} ${f(tip.z)}" stroke="#5b3fa6" stroke-width="16"/>`);
    out.push(`<circle cx="${f(tip.x)}" cy="${f(tip.z)}" r="34" fill="#5b3fa6"/>`);
    const edge = tz < tx ? (dz > 0 ? 'south' : 'north') : dx > 0 ? 'east' : 'west';
    const rank = stack.get(edge) ?? 0;
    stack.set(edge, rank + 1);
    const side = edge === 'east' || edge === 'west';
    const anchor = side ? (edge === 'east' ? 'end' : 'start') : 'start';
    const lx = side ? tip.x + (edge === 'east' ? -50 : 50) : tip.x + 60;
    const ly = side ? tip.z + (tip.z > cz ? -60 - rank * 110 : 110 + rank * 110) : edge === 'south' ? tip.z + 25 - rank * 115 : tip.z + 25 + rank * 115;
    out.push(`<text x="${f(lx)}" y="${f(ly)}" font-size="74" fill="#3d2a78" text-anchor="${anchor}" stroke="#f7f5f0" stroke-width="8" paint-order="stroke">${esc(e.name.en)}: ${e.bearing_deg} deg, ${((e.distance_m ?? 0) / 1000).toFixed(1)} km, ${e.height_m ?? '?'} m</text>`);
  }

  const n = (t: Entry['tier']): number => near.filter((e) => e.tier === t).length;
  const legend = [
    `hero ${n('hero')} (red), signature ${n('signature')} (orange), marker ${n('marker')} (blue; grey: no OSM object), far ${entries.filter((e) => e.far).length} (purple arrows: real bearing from ${input.originName})`,
    `held ${near.filter((e) => e.place === 'held').length} (red ring: sources disagree by more than 50 m), dashed rim: place of worship, underline: underground`,
  ];
  out.push(`<text x="${minX + 60}" y="${minZ + 130}" font-size="110" font-weight="bold" fill="#222">${esc(title)}</text>`);
  legend.forEach((l, i) => out.push(`<text x="${minX + 60}" y="${minZ + 225 + i * 80}" font-size="62" fill="#444">${esc(l)}</text>`));
  out.push('</svg>');
  return out.join('\n');
}
