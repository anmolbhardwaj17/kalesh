// A north-up debug picture of the lane model (SVG text; the driver turns it into a PNG): x east to the right, z south
// downwards, so north is up with no flip. Lanes by type (drive lanes dark, galis brown, bridges blue-grey), white lane
// lines, an arrow per driving lane, gores yellow with a red dot at the nose, junction paths by turn (left cyan,
// straight white, right magenta, U-turn red), stop lines red, explained ends as rings (map edge orange, dead end
// grey), roads inside a junction dashed. Pure.
import type { Box2, P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import type { LaneDef, Station, Strip } from './model.ts';
import type { LaneBuild } from './network.ts';

const FILL: Record<string, string> = { drive: '#4a4a52', parking: '#6d6d78', gore: '#d9b83a', kerb: '#cfcac0', footpath: '#b9ad98', planter: '#6f9a55', median: '#8fae7a' };
const TURN: Record<string, string> = { left: '#35c9d6', straight: '#ffffff', right: '#e05ad0', u: '#ff4030' };

const f = (v: number): string => (Math.round(v * 100) / 100).toString();
const at = (st: Station, lat: number): P2 => ({ x: st.x + st.nx * lat, z: st.z + st.nz * lat });

/** SVG of the lane model inside a box (block metres; one SVG unit is one metre). */
export function lanesSvg(b: LaneBuild, box: Box2, title: string): string {
  const w = box.maxX - box.minX;
  const h = box.maxZ - box.minZ;
  const inside = (p: P2, pad = 30): boolean => p.x >= box.minX - pad && p.x <= box.maxX + pad && p.z >= box.minZ - pad && p.z <= box.maxZ + pad;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(box.minX)} ${f(box.minZ)} ${f(w)} ${f(h)}" width="${Math.round(w)}" height="${Math.round(h)}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect x="${f(box.minX)}" y="${f(box.minZ)}" width="${f(w)}" height="${f(h)}" fill="#7d8a66"/>`);
  const fills = new Map<string, string[]>();
  const add = (key: string, d: string): void => {
    const list = fills.get(key);
    if (list) list.push(d);
    else fills.set(key, [d]);
  };
  const lines: string[] = [];
  const arrows: string[] = [];
  const shown = b.strips.map((s) => s.st.some((st) => inside(st)));
  // at grade first, bridges on top
  for (const level of [0, 1]) {
    b.strips.forEach((s, si) => {
      if (!shown[si]) return;
      const up = s.st.some((st) => st.bridge);
      if ((level === 1) !== up) return;
      s.lanes.forEach((l: LaneDef, k) => {
        const left = s.st.map((st) => at(st, st.b[k] as number));
        const right = s.st.map((st) => at(st, st.b[k + 1] as number)).reverse();
        const d = [...left, ...right].map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.z)}`).join('') + 'Z';
        const fill = l.type === 'drive' ? (l.tag === 'gali' ? '#6b5a4a' : up ? '#5a6478' : s.hero ? '#3f4a58' : (FILL['drive'] as string)) : (FILL[l.type] ?? '#888');
        add(`${level}|${fill}`, d);
        if (l.type !== 'drive') return;
        // lane line on the right border when the next lane is a drive lane too
        if ((s.lanes[k + 1] as LaneDef | undefined)?.type === 'drive') lines.push(s.st.map((st, i) => `${i ? 'L' : 'M'}${f(at(st, st.b[k + 1] as number).x)} ${f(at(st, st.b[k + 1] as number).z)}`).join(''));
        const mid = s.st[Math.floor(s.st.length / 2)] as Station;
        const width = (mid.b[k] as number) - (mid.b[k + 1] as number);
        if (l.dir === 0 || width < 1.5 || s.st.length < 3) return;
        const c = at(mid, ((mid.b[k] as number) + (mid.b[k + 1] as number)) / 2);
        // the direction of the station order is (-nz, nx)
        const tx = -mid.nz * l.dir;
        const tz = mid.nx * l.dir;
        const a = Math.min(1.1, width * 0.3);
        arrows.push(`M${f(c.x + tx * a * 1.6)} ${f(c.z + tz * a * 1.6)}L${f(c.x - tx * a + tz * a * 0.7)} ${f(c.z - tz * a - tx * a * 0.7)}L${f(c.x - tx * a - tz * a * 0.7)} ${f(c.z - tz * a + tx * a * 0.7)}Z`);
      });
    });
    for (const [key, list] of [...fills].filter(([k]) => k.startsWith(`${level}|`)).sort((p, q) => (p[0] < q[0] ? -1 : 1))) out.push(`<path d="${list.join('')}" fill="${key.split('|')[1]}"/>`);
  }
  out.push(`<path d="${lines.join('')}" fill="none" stroke="#f4f4f4" stroke-width="0.12" stroke-dasharray="1.5 1.5"/>`);
  out.push(`<path d="${arrows.join('')}" fill="#f2e9c9"/>`);
  // roads inside a junction
  const internal = new Set(b.internal.map((i) => i.edge));
  const dashed = b.road.source.filter((e: GraphEdge) => internal.has(e.id) && e.pts.some((p) => inside(p))).map((e: GraphEdge) => e.pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.z)}`).join(''));
  out.push(`<path d="${dashed.join('')}" fill="none" stroke="#2d2d33" stroke-width="0.35" stroke-dasharray="0.8 0.8"/>`);
  // junction paths and stop lines
  const byTurn = new Map<string, string[]>();
  const stops: string[] = [];
  for (const j of b.junctions) {
    if (!inside(j.centre, 60)) continue;
    for (const p of j.paths) {
      const d = p.pts.map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.z)}`).join('');
      const list = byTurn.get(p.turn);
      if (list) list.push(d);
      else byTurn.set(p.turn, [d]);
    }
    for (const a of j.arms) {
      const s = b.strips[a.strip] as Strip;
      const towards = a.end === 'end' ? 1 : -1;
      const back = Math.round(a.stopBack / 4);
      const idx = a.end === 'end' ? Math.max(0, s.st.length - 1 - back) : Math.min(s.st.length - 1, back);
      const st = s.st[idx] as Station;
      s.lanes.forEach((l, k) => {
        if (l.type !== 'drive' || (l.dir !== 0 && l.dir !== towards)) return;
        const p = at(st, st.b[k] as number);
        const q = at(st, st.b[k + 1] as number);
        stops.push(`M${f(p.x)} ${f(p.z)}L${f(q.x)} ${f(q.z)}`);
      });
    }
  }
  for (const [turn, list] of [...byTurn].sort((p, q) => (p[0] < q[0] ? -1 : 1))) out.push(`<path d="${list.join('')}" fill="none" stroke="${TURN[turn] ?? '#fff'}" stroke-width="0.16" stroke-opacity="0.85"/>`);
  out.push(`<path d="${stops.join('')}" fill="none" stroke="#e0352b" stroke-width="0.4"/>`);
  // noses and ends
  b.zones.forEach((_, i) => {
    const s = b.strips[b.zoneStrips[i] as number] as Strip;
    const last = s.st[s.st.length - 1] as Station;
    const g = s.lanes.findIndex((l) => l.type === 'gore');
    const p = at(last, ((last.b[g] as number) + (last.b[g + 3] as number)) / 2);
    if (inside(p)) out.push(`<circle cx="${f(p.x)}" cy="${f(p.z)}" r="0.9" fill="#e0352b"/>`);
  });
  for (const e of b.ends) {
    const s = b.strips[e.strip] as Strip;
    const st = (e.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
    if (inside(st)) out.push(`<circle cx="${f(st.x)}" cy="${f(st.z)}" r="2.2" fill="none" stroke="${e.kind === 'map_edge' ? '#ff8a1f' : '#d8d8d8'}" stroke-width="0.6"/>`);
  }
  // title, north arrow, scale bar
  const u = Math.max(w, h) / 100;
  const ax = box.minX + 4 * u;
  const az = box.minZ + 3 * u;
  out.push(`<rect x="${f(box.minX)}" y="${f(box.minZ)}" width="${f(w)}" height="${f(11 * u)}" fill="#1f2328" fill-opacity="0.72"/>`);
  out.push(`<path d="M${f(ax)} ${f(az)}l${f(-1.5 * u)} ${f(4.5 * u)}h${f(3 * u)}z" fill="#fff"/><text x="${f(ax)}" y="${f(az + 7 * u)}" font-size="${f(2.2 * u)}" text-anchor="middle" fill="#fff">N</text>`);
  out.push(`<text x="${f(box.minX + 9 * u)}" y="${f(box.minZ + 4.6 * u)}" font-size="${f(2.6 * u)}" fill="#fff">${title}</text>`);
  out.push(`<text x="${f(box.minX + 9 * u)}" y="${f(box.minZ + 7.2 * u)}" font-size="${f(1.35 * u)}" fill="#d9dde3">lanes: drive dark grey, gali brown, bridge blue-grey, hero road navy; gore yellow, red dot at the nose; stop lines red</text>`);
  out.push(`<text x="${f(box.minX + 9 * u)}" y="${f(box.minZ + 9.6 * u)}" font-size="${f(1.35 * u)}" fill="#d9dde3">paths: left cyan, straight white, right magenta, U-turn red; rings: map edge orange, dead end grey; dashed: road inside a junction</text>`);
  const bar = w > 800 ? 100 : w > 300 ? 50 : 20;
  out.push(`<path d="M${f(box.maxX - 4 * u - bar)} ${f(box.maxZ - 3 * u)}h${bar}" stroke="#fff" stroke-width="${f(0.5 * u)}"/><text x="${f(box.maxX - 4 * u - bar / 2)} " y="${f(box.maxZ - 4.2 * u)}" font-size="${f(1.8 * u)}" text-anchor="middle" fill="#fff">${bar} m</text>`);
  out.push('</svg>');
  return out.join('\n');
}
