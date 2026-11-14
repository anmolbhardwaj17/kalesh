// Sign boards of the area kits (P2-048, harness/design/areas/signboards.md): one 2048 px sign atlas per kit
// (game/world/kits/textures/<kit>_signs.png) with the board kinds real Delhi streets show, each cell drawn for the
// kit's area and worn by its own amount. Kinds (GROUPS, the layout the kit shader and kit_pieces.gd read):
//   fascia    hand-painted tin or wooden board over a shutter: uneven brush letters with drop shadows, Hindi over
//             English or side by side, an estd year, a goods list, a phone number, sometimes an arrow
//   flex      printed flex banner on a steel frame: bold printed type, product pictures, phone numbers, address
//   glow      acrylic glow box: printed face, backlit at night (the shader's emission)
//   wall      lettering painted straight on the wall or a shutter (white is the key: the wall shows through)
//   vertical  tall board up the facade: stacked letters (hotels, lodges, clinics)
//   enamel    round enamel-style board (white is the key round the disc)
//   small     small tailor, laundry, repair or clinic boards
//   notice    paper notices pasted on a wall (white is the key)
// Wear per cell (raster pass after the SVG): sun fade, dust in corners and along the bottom, dirt runs, rust streaks
// from screws and edges, peeling and chipped paint (tin, wood, enamel), torn and faded flex, yellowed acrylic, missing
// letters. More in the old city, less in Connaught Place showrooms (STYLE[kit].wear).
// Names come only from game/data/names/<area>.json (respect rule); the other words are generic shop words (GOODS,
// NOTICES), never brands. Phone numbers are one digit short, so none can be a real line. Fonts: tools/kits/fonts/
// (free licences, CREDITS.md), shaped by tools/kits/signtext.mjs.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fitLine } from './signtext.mjs';

export const SIGN_ATLAS = 2048;
/** The sign atlas layout: cells of a group sit left to right, then down. Mirrored in kit_b (surface_b.gdshaderinc SIGN_*). */
export const GROUPS = [
  { id: 'fascia', x: 0, y: 0, w: 512, h: 128, cols: 4, count: 20 },
  { id: 'flex', x: 0, y: 640, w: 512, h: 192, cols: 4, count: 8 },
  { id: 'glow', x: 0, y: 1024, w: 512, h: 128, cols: 4, count: 8 },
  { id: 'wall', x: 0, y: 1280, w: 512, h: 128, cols: 4, count: 4 },
  { id: 'vertical', x: 0, y: 1408, w: 128, h: 512, cols: 8, count: 8 },
  { id: 'enamel', x: 1024, y: 1408, w: 256, h: 256, cols: 4, count: 4 },
  { id: 'small', x: 1024, y: 1664, w: 256, h: 128, cols: 4, count: 8 },
  { id: 'notice', x: 0, y: 1920, w: 256, h: 128, cols: 8, count: 8 },
];

/** Per kit: wear (0 to 1), estd years, how many painted boards are wood rather than tin, flex and glow palettes. */
const STYLE = {
  bazaar: { wear: 0.72, estd: [1898, 1988], wood: 0.35, urdu: true },
  gali: { wear: 0.85, estd: [1890, 1980], wood: 0.45, urdu: true },
  hardware: { wear: 0.8, estd: [1935, 1995], wood: 0.25 },
  hotel: { wear: 0.6, estd: [1965, 2010], wood: 0.15 },
  market: { wear: 0.45, estd: [1950, 2005], wood: 0.2 },
  office: { wear: 0.35, estd: [1960, 2012], wood: 0.05 },
  colonnade: { wear: 0.16, estd: [1934, 1999], wood: 0.0, showroom: true },
  lutyens: { wear: 0.15, estd: [1931, 1990], wood: 0.0, showroom: true },
};

/** Generic goods words per shop kind (Hindi, English): no names, no brands. */
const GOODS = {
  cloth: [['साड़ी', 'सूट', 'दुपट्टा'], ['Sarees', 'Suits', 'Dupattas']],
  bridal: [['लहंगा', 'शेरवानी', 'चुनरी'], ['Lehengas', 'Sherwanis', 'Bridal Wear']],
  jeweller: [['सोना', 'चाँदी', 'हीरा'], ['Gold', 'Silver', 'Diamond']],
  sweets: [['मिठाई', 'नमकीन', 'घेवर'], ['Sweets', 'Namkeen', 'Pure Ghee']],
  eatery: [['छोले भटूरे', 'पराठे', 'थाली'], ['Veg Thali', 'Parathas', 'Lassi']],
  restaurant: [['शाकाहारी', 'थाली'], ['Veg & Non-Veg', 'Family Restaurant']],
  tea: [['चाय', 'लस्सी', 'नाश्ता'], ['Tea', 'Coffee', 'Snacks']],
  hotel: [['कमरे उपलब्ध', 'एसी'], ['Rooms Available', 'AC & Non-AC', '24 Hrs Hot Water']],
  lodge: [['कमरे उपलब्ध'], ['Rooms', 'Dormitory', 'Hot Water']],
  dharamshala: [['ठहरने की व्यवस्था'], ['Rooms for Pilgrims']],
  clinic: [['डॉक्टर', 'दवाखाना'], ['Clinic', 'Timing 10 AM - 2 PM']],
  hakim: [['यूनानी दवाखाना'], ['Unani Dawakhana']],
  pharmacy: [['दवाइयाँ', 'सर्जिकल'], ['Medicines', 'Surgicals']],
  chemist: [['दवाइयाँ'], ['Chemists & Druggists']],
  coaching: [['कोचिंग', 'ट्यूशन'], ['Coaching', 'Spoken English', 'Tuition']],
  school: [['विद्यालय'], ['School']],
  transport: [['माल ढुलाई', 'बस बुकिंग'], ['Goods Transport', 'Bus Booking']],
  travel: [['टूर', 'टिकट'], ['Tours & Travels', 'Air & Rail Tickets', 'Taxi']],
  spice: [['मसाले', 'मेवा', 'चाय पत्ती'], ['Spices', 'Dry Fruits', 'Tea']],
  attar: [['इत्र', 'अत्तर'], ['Attar', 'Perfumes']],
  books: [['किताबें', 'कॉपियाँ'], ['Books', 'Stationery']],
  printing: [['छपाई', 'शादी कार्ड'], ['Printing', 'Wedding Cards']],
  repair: [['मरम्मत'], ['Repairing', 'Mobile', 'Watch']],
  tailor: [['सिलाई'], ['Ladies & Gents Tailors']],
  hardware: [['मोटर', 'पंप', 'बेयरिंग', 'पाइप'], ['Motors', 'Pumps', 'Bearings', 'Pipe Fittings', 'V-Belts']],
  bangles: [['चूड़ियाँ'], ['Bangles']],
  bakery: [['केक', 'पेस्ट्री'], ['Cakes', 'Pastries', 'Breads']],
  cafe: [['कॉफ़ी'], ['Coffee', 'Snacks']],
  bar: [[], ['Bar & Restaurant']],
  clothing: [['कपड़े'], ['Readymade Garments', 'Kurtas', 'Jeans']],
  shoes: [['जूते'], ['Footwear']],
  optician: [['चश्मे'], ['Spectacles', 'Eye Testing']],
  bank: [['बैंक'], ['ATM', 'Banking']],
  gallery: [['कला'], ['Art Gallery']],
  handicraft: [['हस्तशिल्प'], ['Handicrafts', 'Brass', 'Stoles']],
  electronics: [['मोबाइल', 'टीवी'], ['Mobiles', 'Electronics', 'Repairs']],
  photo: [['फोटो'], ['Photo Studio', 'Passport Photos']],
  tourist: [['जानकारी'], ['Tourist Information']],
  office: [['कार्यालय'], ['Office']],
  newsroom: [['समाचार'], ['News']],
  theatre: [['रंगमंच'], ['Theatre']],
  cinema: [['सिनेमा'], ['Cinema']],
};
const DEFAULT_GOODS = [['थोक एवं फुटकर'], ['Wholesale & Retail']];
/** Paper notices: generic words only. */
const NOTICES = [
  ['किराये के लिए', 'To Let'], ['कमरा खाली है', 'Room Available'], ['ट्यूशन', 'Tuition Classes'], ['बिजली मिस्त्री', 'Electrician'],
  ['प्लंबर', 'Plumber'], ['खोया पाया', 'Lost & Found'], ['योग कक्षा', 'Yoga Classes'], ['नौकरी', 'Job Vacancy'],
  ['पीजी', 'PG for Boys'], ['सिलाई सीखें', 'Stitching Classes'], ['पेंटर', 'Painter'], ['कूलर रिपेयर', 'Cooler Repair'],
];
/** Kinds a group prefers (first pick), in order. */
const PREFER = {
  vertical: ['hotel', 'lodge', 'dharamshala', 'clinic', 'hakim', 'coaching', 'office', 'travel', 'printing'],
  small: ['tailor', 'repair', 'clinic', 'pharmacy', 'chemist', 'coaching', 'printing', 'photo', 'optician', 'hakim'],
  enamel: ['jeweller', 'sweets', 'attar', 'spice', 'bangles', 'hakim', 'pharmacy', 'chemist', 'tea'],
  glow: ['pharmacy', 'chemist', 'clinic', 'bank', 'cafe', 'restaurant', 'clothing', 'electronics', 'optician', 'shoes', 'bakery', 'hotel', 'travel', 'jeweller'],
  flex: ['hardware', 'electronics', 'travel', 'transport', 'coaching', 'cloth', 'clothing', 'eatery', 'restaurant', 'hotel', 'handicraft'],
  wall: ['coaching', 'transport', 'printing', 'tailor', 'repair', 'hakim', 'clinic', 'tea'],
};
/** board_style words of the names files -> sign group (unknown words are ignored). */
const STYLE_GROUP = {
  fascia: 'fascia', painted: 'fascia', hoarding: 'flex', shutter_paint: 'wall', painted_shutter: 'wall', tin: 'fascia', wood: 'fascia', hand_painted: 'fascia', board: 'fascia',
  flex: 'flex', banner: 'flex', printed: 'flex',
  glow: 'glow', glow_box: 'glow', acrylic: 'glow', neon: 'glow', led: 'glow', backlit: 'glow',
  wall: 'wall', wall_paint: 'wall', shutter: 'wall',
  vertical: 'vertical', tall: 'vertical',
  enamel: 'enamel', round: 'enamel',
  small: 'small',
};
/** A names entry with its optional `hi` (Devanagari) used as text.deva when text has none. Copies, never edits. */
function withHi(x) {
  if (x.hi && !x.text.deva) return { ...x, text: { ...x.text, deva: x.hi }, src: x.text };
  return x;
}
const NOT_BOARDS = new Set(['wall_writing', 'poster_line', 'cart', 'hoarding', 'protest', 'govt_board']);

// ------------------------------------------------------------------ small helpers
function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, s, oct = 3) {
  let a = 0.5;
  let t = 0;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    t += a * vnoise(x * f, y * f, s + i * 31);
    a *= 0.5;
    f *= 2;
  }
  return t / (1 - Math.pow(0.5, oct));
}
const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

/** Phone numbers one digit short (mobile 9 digits, landline 7), so no real line is ever shown. */
function phone(r, landline) {
  const d = (n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  return landline ? `Ph. 23${d(1)}${d(1)} ${d(3)}` : `M. 9${Math.floor(r() * 3) + 7}${d(3)} ${d(4)}`;
}

// painted grounds and letter colours seen on Delhi boards (signboards.md): ground, letters, shadow
const PAINT = [
  ['#e8b923', '#b3261e', '#3a1d12'], ['#b3261e', '#f6e9c8', '#2b1410'], ['#1f4f99', '#f2f0e6', '#0e1f3a'], ['#f1ecdf', '#b3261e', '#2a2a2a'],
  ['#f1ecdf', '#1d3f8f', '#7d7d7d'], ['#2c6e49', '#f6e9c8', '#10281a'], ['#1c1c1e', '#e8b923', '#5a4410'], ['#d9c27a', '#1c1c1e', '#7b5e2a'],
  ['#7a1f2b', '#f2d16b', '#2a0b10'], ['#0f6e74', '#f6e9c8', '#06302f'],
];
const PAINT_SHOWROOM = [['#1c1c1e', '#e9d7a6', '#000000'], ['#f2f0ea', '#1c1c1e', '#9a9a96'], ['#2c3e70', '#f2f0ea', '#10182c'], ['#6b2a24', '#f1e6cc', '#2a100c']];
const FLEX = [
  ['#f2c230', '#1d3f8f', '#c0261e'], ['#1f5fa8', '#ffffff', '#f2c230'], ['#ffffff', '#c0261e', '#1d3f8f'], ['#c0261e', '#ffffff', '#f2c230'],
  ['#0f7c7c', '#ffffff', '#f2c230'], ['#7b2d8b', '#ffffff', '#f2c230'], ['#111111', '#f2c230', '#ffffff'],
];
const GLOW = [['#f7f5ef', '#c0261e', '#1d3f8f'], ['#1d3f8f', '#ffffff', '#f2c230'], ['#c0261e', '#ffffff', '#ffffff'], ['#f7f5ef', '#2e7d32', '#1c1c1e'], ['#111111', '#f2f0ea', '#e8b923'], ['#2e7d32', '#ffffff', '#f2c230']];

/** The board names of a group: shop kinds of the names file, preferred kinds first, then by weight; deterministic. */
export function namesFor(group, names, n, seed) {
  const list = names.names.filter((x) => !NOT_BOARDS.has(x.kind) && x.text && x.text.latn).map(withHi);
  const pref = PREFER[group] || [];
  const r = rngOf(seed);
  // an entry with a board_style (the parody entries, decisions.md 2026-11-14) goes on that kind of board first
  const styled = (x) => (x.board_style ? (STYLE_GROUP[x.board_style] === group ? 30 : -30) : 0);
  const scored = list.map((x, i) => ({ x, i, s: styled(x) + (pref.includes(x.kind) ? 10 - pref.indexOf(x.kind) * 0.3 : 0) + (x.weight ?? 1) + r() * 2.5 }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const out = [];
  for (let k = 0; out.length < n; k++) out.push(scored[k % scored.length].x);
  return out;
}

// ------------------------------------------------------------------ cells (SVG and a wear spec each)
/** The two lines of a name: [script, text] big, and the second (or null), by the kit's script order and a coin. */
function nameLines(n, scripts, r) {
  const have = scripts.filter((s) => n.text[s]);
  if (!have.length) return [['latn', n.text.latn], null];
  let first = have[0];
  if (have.length > 1 && r() < 0.3) first = have[1];
  const second = have.find((s) => s !== first && (s === 'latn' || s === 'deva'));
  return [[first, n.text[first]], second ? [second, n.text[second]] : null];
}
function fontFor(script, kind, r) {
  if (script === 'arab') return 'nastaliq';
  if (kind === 'paint') return script === 'deva' ? pick(r, ['rozha', 'yatra', 'rozha', 'kalam', 'noto_serif_deva', 'mukta']) : pick(r, ['alfa', 'rozha', 'alfa', 'kalam', 'anton']);
  if (kind === 'flex') return script === 'deva' ? pick(r, ['mukta', 'khand', 'teko', 'noto_deva']) : pick(r, ['anton', 'oswald', 'mukta', 'teko']);
  return script === 'deva' ? pick(r, ['hind', 'mukta_b', 'khand']) : pick(r, ['oswald', 'hind', 'mukta_b']);
}
const capsOf = (txt, script, upper) => (script === 'latn' && upper ? txt.toUpperCase() : txt);
/** A line with an optional drop shadow (sign painters' offset shadow). */
function line(font, text, o, fill, shadow, sd) {
  let s = '';
  if (shadow) s += fitLine(font, text, { ...o, x: o.x + sd, y: o.y + sd, attrs: `fill="${shadow}"` }).svg;
  return s + fitLine(font, text, { ...o, attrs: `fill="${fill}"` }).svg;
}
function arrow(x, y, w, h, fill, left) {
  const d = left ? `M${x + w},${y + h * 0.35} L${x + h * 0.6},${y + h * 0.35} L${x + h * 0.6},${y} L${x},${y + h / 2} L${x + h * 0.6},${y + h} L${x + h * 0.6},${y + h * 0.65} L${x + w},${y + h * 0.65} Z` : `M${x},${y + h * 0.35} L${x + w - h * 0.6},${y + h * 0.35} L${x + w - h * 0.6},${y} L${x + w},${y + h / 2} L${x + w - h * 0.6},${y + h} L${x + w - h * 0.6},${y + h * 0.65} L${x},${y + h * 0.65} Z`;
  return `<path d="${d}" fill="${fill}"/>`;
}
function screws(x, y, w, h, inset) {
  return [[x + inset, y + inset], [x + w - inset, y + inset], [x + inset, y + h - inset], [x + w - inset, y + h - inset]];
}

function fascia(c, n, ctx) {
  const { r, st, kit } = ctx;
  const [x, y, w, h] = c;
  const pal = st.showroom ? pick(r, PAINT_SHOWROOM) : pick(r, PAINT);
  const [bg, fg, sh] = pal;
  const wood = r() < st.wood;
  const upper = ctx.boards.case === 'upper' || r() < 0.4;
  let [l1, l2] = nameLines(n, ctx.boards.scripts, r);
  if (n.tagline && (!l2 || r() < 0.5)) l2 = ['latn', n.tagline];
  const jit = st.showroom ? null : (i) => hash2(i, 7, ctx.seed) * 2 - 1;
  const drop = !st.showroom && r() < st.wear * 0.4 ? ((k) => (i) => i === k)(Math.floor(r() * 8) * 3) : null;
  let s = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${bg}"/>`;
  if (wood) for (let k = 1; k < 3; k++) s += `<rect x="${x + 2}" y="${y + (h * k) / 3 - 1}" width="${w - 4}" height="2" fill="#000" opacity="0.25"/>`;
  if (!st.showroom) s += `<rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 14}" fill="none" stroke="${fg}" stroke-width="3" opacity="0.8"/>`;
  const layout = st.showroom ? 0 : Math.floor(r() * 5);
  const extra = [];
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  const hasEstd = !st.showroom && r() < 0.5;
  const estd = hasEstd ? Math.floor(st.estd[0] + r() * (st.estd[1] - st.estd[0])) : 0;
  const sd = st.showroom ? 0 : 3;
  const shadow = st.showroom ? null : sh;
  const f1 = fontFor(l1[0], 'paint', r);
  const t1 = capsOf(l1[1], l1[0], upper);
  if (layout === 2 && l2) {
    // side by side: Hindi left, English right, a painted rule between
    s += line(f1, t1, { x: x + w * 0.27, y: y + h * 0.66, maxW: w * 0.44, size: h * 0.46, jitter: jit, drop }, fg, shadow, sd);
    s += `<rect x="${x + w / 2 - 2}" y="${y + 16}" width="4" height="${h - 32}" fill="${fg}" opacity="0.8"/>`;
    const f2 = fontFor(l2[0], 'paint', r);
    s += line(f2, capsOf(l2[1], l2[0], upper), { x: x + w * 0.74, y: y + h * 0.66, maxW: w * 0.44, size: h * 0.42, jitter: jit }, fg, shadow, sd);
  } else if (layout === 3) {
    // the name, then a goods band in the shadow colour along the bottom
    s += line(f1, t1, { x: x + w / 2, y: y + h * 0.56, maxW: w - 40, size: h * 0.5, jitter: jit, drop }, fg, shadow, sd);
    s += `<rect x="${x + 7}" y="${y + h * 0.68}" width="${w - 14}" height="${h * 0.24}" fill="${fg}"/>`;
    const g = r() < 0.5 && gl[0].length ? gl[0].join(' • ') : gl[1].join(' • ');
    s += fitLine(r() < 0.5 && gl[0].length ? 'mukta' : 'oswald', g, { x: x + w / 2, y: y + h * 0.87, maxW: w - 50, size: h * 0.19, attrs: `fill="${bg}"` }).svg;
    extra.push(g);
  } else {
    // Hindi (or the first script) big over the second line small, with the estd year or a phone number
    const big = l2 ? 0.44 : 0.56;
    const corner = hasEstd || (!st.showroom && r() < 0.5);
    s += line(f1, t1, { x: x + w / 2, y: y + h * (l2 ? 0.5 : 0.66), maxW: corner ? w - 210 : w - 46, size: h * big, jitter: jit, drop }, fg, shadow, sd);
    if (l2) {
      const f2 = l2[0] === 'deva' ? 'mukta' : fontFor('latn', 'paint', r);
      s += line(f2, capsOf(l2[1], l2[0], true), { x: x + w / 2, y: y + h * 0.82, maxW: w - 120, size: h * 0.24, track: 1 }, fg, shadow, sd * 0.5);
    }
    if (hasEstd) {
      const e = l1[0] === 'deva' && r() < 0.5 ? `स्था. ${estd}` : `Estd. ${estd}`;
      s += fitLine(e.startsWith('स्था') ? 'mukta' : 'rozha', e, { x: x + 16, y: y + h * 0.3, maxW: 80, size: 15, anchor: 'start', attrs: `fill="${fg}"` }).svg;
      extra.push(e);
    } else if (corner) {
      const p = phone(r, r() < 0.5);
      s += fitLine('oswald', p, { x: x + w - 16, y: y + h * 0.3, maxW: 110, size: 15, anchor: 'end', attrs: `fill="${fg}"` }).svg;
      extra.push(p);
    }
    if (layout === 4 && !l2) {
      s += arrow(x + w - 92, y + h - 34, 72, 22, fg, false);
    }
  }
  const mat = wood ? 'wood' : 'tin';
  return { svg: s, extra, wear: { mat, bg: hex(bg), screws: wood ? [] : screws(x, y, w, h, 12), wear: st.wear * (0.6 + r() * 0.7), dent: !wood && r() < st.wear * 0.6 } };
}

/** A product picture on a flex banner: a photo-like tile with a simple object of the shop's kind. */
function product(x, y, s, kind, r) {
  const bgc = pick(r, ['#ffffff', '#eef2f5', '#f6f1e4']);
  let o = `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${bgc}"/><rect x="${x}" y="${y + s * 0.7}" width="${s}" height="${s * 0.3}" fill="#000" opacity="0.07"/>`;
  const cx = x + s / 2;
  const cy = y + s / 2;
  const col = pick(r, ['#2f5d8a', '#c0392b', '#3a7d44', '#7a7d7e', '#e6b422', '#1c1c1e']);
  const kindSet = {
    hardware: ['gear', 'motor', 'bearing', 'pipe', 'belt'],
    electronics: ['phone', 'tv'],
    cloth: ['drape'], clothing: ['drape', 'shirt'], bridal: ['drape'],
    eatery: ['thali'], restaurant: ['thali'], sweets: ['thali'], tea: ['cup'],
    travel: ['plane', 'bus'], transport: ['bus', 'truck'],
    hotel: ['bed'], lodge: ['bed'], coaching: ['book'], books: ['book'], handicraft: ['drape', 'pot'],
  }[kind] || ['box'];
  const t = pick(r, kindSet);
  if (t === 'gear') o += `<circle cx="${cx}" cy="${cy}" r="${s * 0.3}" fill="none" stroke="${col}" stroke-width="${s * 0.12}" stroke-dasharray="${s * 0.09} ${s * 0.06}"/><circle cx="${cx}" cy="${cy}" r="${s * 0.22}" fill="${col}"/><circle cx="${cx}" cy="${cy}" r="${s * 0.08}" fill="${bgc}"/>`;
  else if (t === 'motor') o += `<rect x="${x + s * 0.18}" y="${y + s * 0.3}" width="${s * 0.55}" height="${s * 0.4}" rx="${s * 0.08}" fill="${col}"/><rect x="${x + s * 0.73}" y="${y + s * 0.46}" width="${s * 0.14}" height="${s * 0.08}" fill="#888"/><rect x="${x + s * 0.24}" y="${y + s * 0.7}" width="${s * 0.43}" height="${s * 0.07}" fill="#444"/>`;
  else if (t === 'bearing') o += `<circle cx="${cx}" cy="${cy}" r="${s * 0.32}" fill="#9aa0a6"/><circle cx="${cx}" cy="${cy}" r="${s * 0.22}" fill="#5f6368"/><circle cx="${cx}" cy="${cy}" r="${s * 0.13}" fill="${bgc}"/>`;
  else if (t === 'pipe') o += `<rect x="${x + s * 0.12}" y="${y + s * 0.4}" width="${s * 0.76}" height="${s * 0.2}" fill="${col}"/><rect x="${x + s * 0.42}" y="${y + s * 0.18}" width="${s * 0.2}" height="${s * 0.64}" fill="${col}" opacity="0.85"/>`;
  else if (t === 'belt') o += `<ellipse cx="${cx}" cy="${cy}" rx="${s * 0.34}" ry="${s * 0.24}" fill="none" stroke="#222" stroke-width="${s * 0.09}"/>`;
  else if (t === 'phone') o += `<rect x="${x + s * 0.33}" y="${y + s * 0.15}" width="${s * 0.34}" height="${s * 0.68}" rx="${s * 0.05}" fill="#1c1c1e"/><rect x="${x + s * 0.36}" y="${y + s * 0.2}" width="${s * 0.28}" height="${s * 0.52}" fill="${col}"/>`;
  else if (t === 'tv') o += `<rect x="${x + s * 0.12}" y="${y + s * 0.22}" width="${s * 0.76}" height="${s * 0.48}" fill="#1c1c1e"/><rect x="${x + s * 0.16}" y="${y + s * 0.26}" width="${s * 0.68}" height="${s * 0.4}" fill="${col}"/>`;
  else if (t === 'drape') o += `<path d="M${x + s * 0.3},${y + s * 0.12} Q${x + s * 0.75},${y + s * 0.3} ${x + s * 0.55},${y + s * 0.9} L${x + s * 0.3},${y + s * 0.9} Z" fill="${col}"/><path d="M${x + s * 0.55},${y + s * 0.9} Q${x + s * 0.75},${y + s * 0.3} ${x + s * 0.3},${y + s * 0.12}" fill="none" stroke="#e6b422" stroke-width="${s * 0.05}"/>`;
  else if (t === 'shirt') o += `<path d="M${x + s * 0.3},${y + s * 0.2} L${x + s * 0.7},${y + s * 0.2} L${x + s * 0.85},${y + s * 0.38} L${x + s * 0.72},${y + s * 0.45} L${x + s * 0.72},${y + s * 0.85} L${x + s * 0.28},${y + s * 0.85} L${x + s * 0.28},${y + s * 0.45} L${x + s * 0.15},${y + s * 0.38} Z" fill="${col}"/>`;
  else if (t === 'thali') o += `<circle cx="${cx}" cy="${cy}" r="${s * 0.36}" fill="#c9ccd0"/><circle cx="${cx - s * 0.13}" cy="${cy - s * 0.1}" r="${s * 0.09}" fill="#e6b422"/><circle cx="${cx + s * 0.13}" cy="${cy - s * 0.08}" r="${s * 0.09}" fill="#c0392b"/><circle cx="${cx}" cy="${cy + s * 0.14}" r="${s * 0.1}" fill="#f6f1e4"/>`;
  else if (t === 'cup') o += `<rect x="${x + s * 0.32}" y="${y + s * 0.32}" width="${s * 0.3}" height="${s * 0.38}" fill="#d9c9a8"/><rect x="${x + s * 0.32}" y="${y + s * 0.32}" width="${s * 0.3}" height="${s * 0.08}" fill="#8d5a3b"/>`;
  else if (t === 'plane') o += `<path d="M${x + s * 0.1},${y + s * 0.5} L${x + s * 0.9},${y + s * 0.45} L${x + s * 0.9},${y + s * 0.55} Z M${x + s * 0.45},${y + s * 0.2} L${x + s * 0.58},${y + s * 0.5} L${x + s * 0.45},${y + s * 0.8} Z" fill="${col}"/>`;
  else if (t === 'bus' || t === 'truck') o += `<rect x="${x + s * 0.1}" y="${y + s * 0.3}" width="${s * 0.8}" height="${s * 0.38}" fill="${col}"/><rect x="${x + s * 0.15}" y="${y + s * 0.35}" width="${s * 0.6}" height="${s * 0.12}" fill="#cfe3f0"/><circle cx="${x + s * 0.28}" cy="${y + s * 0.7}" r="${s * 0.07}" fill="#222"/><circle cx="${x + s * 0.72}" cy="${y + s * 0.7}" r="${s * 0.07}" fill="#222"/>`;
  else if (t === 'bed') o += `<rect x="${x + s * 0.12}" y="${y + s * 0.45}" width="${s * 0.76}" height="${s * 0.2}" fill="${col}"/><rect x="${x + s * 0.12}" y="${y + s * 0.3}" width="${s * 0.08}" height="${s * 0.45}" fill="#5d4037"/><rect x="${x + s * 0.2}" y="${y + s * 0.38}" width="${s * 0.18}" height="${s * 0.08}" fill="#fff"/>`;
  else if (t === 'book') o += `<rect x="${x + s * 0.25}" y="${y + s * 0.2}" width="${s * 0.5}" height="${s * 0.6}" fill="${col}"/><rect x="${x + s * 0.3}" y="${y + s * 0.3}" width="${s * 0.4}" height="${s * 0.06}" fill="#fff"/>`;
  else if (t === 'pot') o += `<ellipse cx="${cx}" cy="${cy + s * 0.08}" rx="${s * 0.26}" ry="${s * 0.24}" fill="#b0702e"/><rect x="${cx - s * 0.1}" y="${y + s * 0.2}" width="${s * 0.2}" height="${s * 0.12}" fill="#b0702e"/>`;
  else o += `<rect x="${x + s * 0.2}" y="${y + s * 0.3}" width="${s * 0.6}" height="${s * 0.45}" fill="${col}"/><rect x="${x + s * 0.2}" y="${y + s * 0.3}" width="${s * 0.6}" height="${s * 0.1}" fill="#000" opacity="0.2"/>`;
  return o;
}

function flex(c, n, ctx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  const [bg, fg, ac] = pick(r, FLEX);
  const [l1, l2] = nameLines(n, ctx.boards.scripts, r);
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  let s = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${bg}"/>`;
  // a printed gradient band behind the name and a contrasting strip
  s += `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h * 0.42}" fill="#fff" opacity="0.12"/>`;
  s += `<rect x="${x + 2}" y="${y + h * 0.45}" width="${w - 4}" height="${h * 0.1}" fill="${ac}"/>`;
  const extra = [];
  const top = n.tagline ? n.tagline.toUpperCase() : r() < 0.5 ? 'AUTHORISED DEALERS' : 'DEALS IN';
  s += fitLine('oswald', top, { x: x + w / 2, y: y + h * 0.1, maxW: w * 0.5, size: h * 0.075, attrs: `fill="${fg}"` }).svg;
  if (!n.tagline) extra.push(top);
  const f1 = fontFor(l1[0], 'flex', r);
  s += fitLine(f1, capsOf(l1[1], l1[0], true), { x: x + w / 2, y: y + h * 0.33, maxW: w - 30, size: h * 0.22, attrs: `fill="${fg}" stroke="${bg === '#ffffff' ? '#ffffff' : '#000'}" stroke-width="0" ` }).svg;
  if (l2) s += fitLine(l2[0] === 'deva' ? 'mukta' : 'oswald', capsOf(l2[1], l2[0], true), { x: x + w / 2, y: y + h * 0.43, maxW: w - 80, size: h * 0.085, attrs: `fill="${fg}"` }).svg;
  const g = gl[1].join(' • ');
  s += fitLine('oswald', g.toUpperCase(), { x: x + w / 2, y: y + h * 0.535, maxW: w - 40, size: h * 0.07, attrs: `fill="${bg}"` }).svg;
  extra.push(g);
  // product pictures in a row
  const np = 5;
  const ps = (w - 24 - (np - 1) * 6) / np;
  const pss = Math.min(ps, h * 0.27);
  for (let i = 0; i < np; i++) s += product(x + 12 + i * (ps + 6) + (ps - pss) / 2, y + h * 0.59, pss, n.kind, r);
  const p1 = phone(r, false);
  const p2 = phone(r, r() < 0.5);
  s += fitLine('anton', `${p1}, ${p2}`, { x: x + w / 2, y: y + h * 0.95, maxW: w - 30, size: h * 0.075, attrs: `fill="${ac === '#ffffff' ? fg : ac}"` }).svg;
  extra.push(p1, p2);
  return { svg: s, extra, wear: { mat: 'flex', bg: hex(bg), screws: [], wear: st.wear * (0.5 + r() * 0.8), tear: r() < st.wear * 0.7 } };
}

function glow(c, n, ctx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  const [bg, fg, ac] = pick(r, GLOW);
  let [l1, l2] = nameLines(n, ctx.boards.scripts, r);
  if (n.tagline && !l2) l2 = ['latn', n.tagline];
  let s = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="#3a3a3c"/><rect x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 16}" fill="${bg}"/>`;
  s += `<rect x="${x + 8}" y="${y + h - 26}" width="${w - 16}" height="10" fill="${ac}"/>`;
  const f1 = fontFor(l1[0], 'glow', r);
  s += fitLine(f1, capsOf(l1[1], l1[0], true), { x: x + w / 2, y: y + h * (l2 ? 0.52 : 0.62), maxW: w - 50, size: h * (l2 ? 0.42 : 0.5), attrs: `fill="${fg}"` }).svg;
  if (l2) s += fitLine(l2[0] === 'deva' ? 'hind' : 'oswald', capsOf(l2[1], l2[0], true), { x: x + w / 2, y: y + h * 0.74, maxW: w - 140, size: h * 0.16, attrs: `fill="${fg}"` }).svg;
  return { svg: s, extra: [], wear: { mat: 'acrylic', bg: hex(bg), screws: [], wear: st.wear * (0.3 + r() * 0.5) } };
}

function wall(c, n, ctx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  const fg = pick(r, ['#9b1c1c', '#1d3f8f', '#1c1c1e', '#2c6e49']);
  const [l1, l2] = nameLines(n, ctx.boards.scripts, r);
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`;
  const f1 = fontFor(l1[0], 'paint', r);
  const jit = (i) => hash2(i, 11, ctx.seed) * 2 - 1;
  s += fitLine(f1, l1[1], { x: x + w / 2, y: y + h * (l2 ? 0.5 : 0.62), maxW: w - 60, size: h * 0.46, jitter: jit, attrs: `fill="${fg}"` }).svg;
  const extra = [];
  if (l2) s += fitLine(l2[0] === 'deva' ? 'kalam' : 'kalam', l2[1], { x: x + w / 2 - 20, y: y + h * 0.84, maxW: w - 160, size: h * 0.24, jitter: jit, attrs: `fill="${fg}"` }).svg;
  if (r() < 0.6) {
    s += arrow(x + w - 84, y + h * 0.68, 64, 24, fg, r() < 0.4);
    const t = r() < 0.5 ? 'गली में' : 'ऊपर';
    s += fitLine('kalam', t, { x: x + 54, y: y + h * 0.86, maxW: 90, size: 22, attrs: `fill="${fg}"` }).svg;
    extra.push(t);
  }
  return { svg: s, extra, wear: { mat: 'wallpaint', bg: [255, 255, 255], screws: [], wear: Math.min(1, st.wear * (0.8 + r() * 0.6)) } };
}

function vertical(c, n, ctx, idx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  // the even cells are glow boxes, the odd ones painted (the kit shader lights the even ones at night)
  const lit = idx % 2 === 0;
  const [bg, fg, sh] = lit ? pick(r, GLOW) : st.showroom ? pick(r, PAINT_SHOWROOM) : pick(r, PAINT);
  let s = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${bg}"/>`;
  if (!lit) s += `<rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 14}" fill="none" stroke="${fg}" stroke-width="3"/>`;
  // the first word stacked letter by letter (Latin) or word by word (Devanagari), the rest small at the foot
  const latn = n.text.latn;
  const words = latn.toUpperCase().split(/\s+/);
  const kindWord = { hotel: 'HOTEL', lodge: 'LODGE', dharamshala: 'DHARAMSHALA', clinic: 'CLINIC', hakim: 'DAWAKHANA', coaching: 'CLASSES' }[n.kind];
  let main = words.find((wd) => wd.length >= 3 && wd !== kindWord) || words[0];
  main = main.replace(/[^A-Z0-9&]/g, '').slice(0, 9);
  const letters = [...main];
  const lh = Math.min(48, (h * 0.78) / Math.max(4, letters.length));
  const top = y + 16;
  if (n.text.deva && r() < 0.5) {
    s += fitLine('mukta', n.text.deva.split(' ')[0], { x: x + w / 2, y: top + 26, maxW: w - 16, size: 26, attrs: `fill="${fg}"` }).svg;
  }
  letters.forEach((ch, i) => {
    s += fitLine(lit ? 'oswald' : 'alfa', ch, { x: x + w / 2, y: top + 40 + (i + 1) * lh, maxW: w - 22, size: lh * 0.95, attrs: `fill="${fg}"` }).svg;
  });
  const foot = kindWord || words.filter((wd) => wd !== main).join(' ');
  if (foot) s += fitLine('oswald', foot, { x: x + w / 2, y: y + h - 18, maxW: w - 16, size: 20, attrs: `fill="${sh === '#000000' ? fg : fg}"` }).svg;
  return { svg: s, extra: [main, foot].filter(Boolean), wear: { mat: lit ? 'acrylic' : 'tin', bg: hex(bg), screws: lit ? [] : screws(x, y, w, h, 10), wear: st.wear * (0.5 + r() * 0.6), lit } };
}

function enamel(c, n, ctx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  const ring = pick(r, ['#1d3f8f', '#b3261e', '#2c6e49', '#1c1c1e']);
  const ink = pick(r, ['#b3261e', '#1d3f8f']);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rr = w / 2 - 8;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${ring}"/><circle cx="${cx}" cy="${cy}" r="${rr - 14}" fill="#e4dfd2"/>`;
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  const deva = n.text.deva || n.text.latn;
  const words = deva.split(' ');
  const half = Math.ceil(words.length / 2);
  s += fitLine('noto_serif_deva', words.slice(0, half).join(' '), { x: cx, y: cy - 22, maxW: rr * 1.5, size: 40, attrs: `fill="${ink}"` }).svg;
  if (words.length > 1) s += fitLine('noto_serif_deva', words.slice(half).join(' '), { x: cx, y: cy + 22, maxW: rr * 1.6, size: 36, attrs: `fill="${ink}"` }).svg;
  const g = gl[0].length ? gl[0].join(' ') : gl[1][0];
  s += fitLine('mukta', g, { x: cx, y: cy + 62, maxW: rr * 1.2, size: 22, attrs: `fill="${ring}"` }).svg;
  return { svg: s, extra: [g], wear: { mat: 'enamel', bg: [228, 223, 210], screws: [[cx, cy - rr + 7], [cx, cy + rr - 7]], wear: st.wear * (0.5 + r() * 0.7), disc: [cx, cy, rr] } };
}

function small(c, n, ctx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  const [bg, fg, sh] = st.showroom ? pick(r, PAINT_SHOWROOM) : pick(r, PAINT);
  let s = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${bg}"/><rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" fill="none" stroke="${fg}" stroke-width="2"/>`;
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  const fig = n.kind === 'tailor' || (n.kind === 'clothing' && r() < 0.5);
  const tx = fig ? x + w * 0.6 : x + w / 2;
  const tw = fig ? w * 0.68 : w - 24;
  if (fig) {
    // a painted figure in a long coat, as tailors paint them
    s += `<circle cx="${x + 40}" cy="${y + 30}" r="10" fill="#8d5a3b"/><path d="M${x + 26},${y + 42} L${x + 54},${y + 42} L${x + 60},${y + h - 14} L${x + 20},${y + h - 14} Z" fill="${pick(r, ['#1d3f8f', '#7a1f2b', '#2c6e49'])}"/>`;
  }
  const jit = st.showroom ? null : (i) => hash2(i, 13, ctx.seed) * 2 - 1;
  const [l1, l2] = nameLines(n, ctx.boards.scripts, r);
  s += line(fontFor(l1[0], 'paint', r), capsOf(l1[1], l1[0], true), { x: tx, y: y + h * 0.45, maxW: tw, size: h * 0.3, jitter: jit }, fg, st.showroom ? null : sh, 2);
  const g = (l1[0] === 'deva' && gl[0].length ? gl[0] : gl[1])[0];
  s += fitLine(l1[0] === 'deva' && gl[0].length ? 'mukta' : 'oswald', g, { x: tx, y: y + h * 0.72, maxW: tw, size: h * 0.17, attrs: `fill="${fg}"` }).svg;
  const p = phone(r, true);
  s += fitLine('oswald', p, { x: tx, y: y + h * 0.9, maxW: tw * 0.8, size: h * 0.12, attrs: `fill="${fg}"` }).svg;
  return { svg: s, extra: [g, p], wear: { mat: r() < st.wood ? 'wood' : 'tin', bg: hex(bg), screws: screws(x, y, w, h, 9), wear: st.wear * (0.6 + r() * 0.7) } };
}

function notice(c, _n, ctx, idx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`;
  const extra = [];
  const k = 1 + Math.floor(r() * 3);
  for (let i = 0; i < k; i++) {
    const pw = 60 + r() * 40;
    const ph = 70 + r() * 30;
    const px = x + 10 + i * ((w - 20 - pw) / Math.max(1, k - 1 || 1)) + (k === 1 ? (w - 20 - pw) / 2 : 0);
    const py = y + 8 + r() * (h - ph - 16);
    const paper = pick(r, ['#f3eedc', '#f2d64b', '#f0b6c4', '#d8e7f0', '#efe7cf']);
    const rot = (r() - 0.5) * 7;
    const [hi, en] = NOTICES[(idx * 3 + i * 5 + Math.floor(r() * 4)) % NOTICES.length];
    s += `<g transform="rotate(${rot.toFixed(1)} ${px + pw / 2} ${py + ph / 2})"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${paper}"/>`;
    s += fitLine('mukta', hi, { x: px + pw / 2, y: py + 22, maxW: pw - 8, size: 17, attrs: 'fill="#1c1c1e"' }).svg;
    s += fitLine('oswald', en.toUpperCase(), { x: px + pw / 2, y: py + 40, maxW: pw - 8, size: 12, attrs: 'fill="#b3261e"' }).svg;
    for (let l = 0; l < 3; l++) s += `<rect x="${px + 8}" y="${py + 48 + l * 7}" width="${pw - 16 - (l % 2) * 12}" height="3" fill="#2c2c2c" opacity="0.55"/>`;
    // tear-off strips with the number along the bottom
    for (let t = 0; t < 5; t++) s += `<rect x="${px + 3 + t * (pw - 6) / 5}" y="${py + ph - 12}" width="${(pw - 6) / 5 - 2}" height="10" fill="${paper}" stroke="#555" stroke-width="0.6"/>`;
    s += `<rect x="${px + pw / 2 - 8}" y="${py - 3}" width="16" height="6" fill="#d8d2c0" opacity="0.9"/></g>`;
    extra.push(hi, en);
  }
  return { svg: s, extra, wear: { mat: 'paper', bg: [255, 255, 255], screws: [], wear: st.wear } };
}

const DRAW = { fascia, flex, glow, wall, vertical, enamel, small, notice };

// ------------------------------------------------------------------ wear (raster pass over one cell)
const RUST = [[118, 58, 26], [150, 80, 38], [92, 48, 26]];
function wearCell(buf, W, g, cx0, cy0, spec, seed) {
  const { mat, wear } = spec;
  const w = g.w;
  const h = g.h;
  const key = mat === 'wallpaint' || mat === 'paper' || mat === 'enamel';
  const base = mat === 'wood' ? [104, 74, 50] : mat === 'flex' ? [38, 36, 34] : [128, 126, 120];
  const s = seed;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = ((cy0 + py) * W + cx0 + px) * 4;
      let c = [buf[i], buf[i + 1], buf[i + 2]];
      if (key && c[0] >= 250 && c[1] >= 250 && c[2] >= 250) continue;
      const u = px / w;
      const v = py / h;
      // inside the round enamel disc only
      if (spec.disc) {
        const dx = cx0 + px - spec.disc[0] + 0;
        const dy = cy0 + py - spec.disc[1];
        const d = Math.hypot(dx, dy);
        if (d > spec.disc[2] + 0.5) continue;
      }
      const big = fbm(px / 60, py / 60, s);
      const mid = fbm(px / 14, py / 14, s + 5);
      const fine = hash2(px, py, s + 9);
      // sun fade: paler and greyer, more at the top and in big soft clouds
      const fade = wear * (0.22 + 0.45 * big) * (1.15 - 0.45 * v) * (mat === 'acrylic' ? 0.4 : 1);
      const l = luma(c);
      for (let k = 0; k < 3; k++) c[k] = c[k] + (Math.min(235, l * 1.05 + 40) - c[k]) * Math.min(0.75, fade);
      if (mat === 'flex') {
        // flex inks: reds and yellows wash out first; wrinkles from the ties
        c[0] = c[0] + (225 - c[0]) * wear * 0.15 * big;
        const wr = Math.sin((u * 9 + v * 3 + vnoise(u * 4, v * 4, s) * 2) * Math.PI * 2) * 0.06 * Math.min(1, wear * 1.4) * sstep(0.35, 0.0, Math.min(u, 1 - u));
        for (let k = 0; k < 3; k++) c[k] *= 1 + wr;
      }
      if (mat === 'acrylic') {
        // yellowed plastic
        c[2] *= 1 - 0.12 * wear;
      }
      // dust and soot: corners, the top lip, the bottom edge, and dirt runs down from the top
      const edge = Math.min(u, 1 - u, v * (h / w), (1 - v) * (h / w));
      const corner = sstep(0.12, 0.0, Math.min(u, 1 - u)) * sstep(0.35, 0.0, Math.min(v, 1 - v));
      const bottom = sstep(0.75, 1.0, v);
      const runs = sstep(0.55, 0.85, vnoise(px / 9, 0.5, s + 21)) * (1 - v) * sstep(0.0, 0.25, fbm(px / 9, py / 40, s + 23));
      const dust = wear * Math.min(1, corner * 0.8 + bottom * 0.35 + runs * 0.45 + sstep(0.02, 0.0, edge) * 0.5) * (0.6 + 0.4 * mid);
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - 0.5 * dust) + [96, 84, 66][k] * 0.5 * dust;
      if (mat === 'tin' || mat === 'enamel' || mat === 'wood') {
        // peeling and chipped paint: bare metal (with rust) or wood under the paint, a lifted light rim
        const pf = fbm(px / 26, py / 18, s + 41) * 0.85 + fbm(px / 7, py / 7, s + 43) * 0.15 + sstep(0.035, 0.0, edge) * 0.22;
        const thr = 1.0 - wear * 0.32;
        const peel = sstep(thr, thr + 0.02, pf);
        const rim = sstep(thr - 0.035, thr, pf) * (1 - peel);
        if (peel > 0) {
          let under = base.slice();
          if (mat !== 'wood') {
            const ru = sstep(0.4, 0.75, fbm(px / 8, py / 8, s + 51));
            const rc = RUST[Math.floor(fine * 2.99)];
            under = under.map((b, k) => b + (rc[k] - b) * ru);
          } else {
            const grain = Math.sin(py * 0.9 + vnoise(px / 30, py / 6, s) * 6) * 10;
            under = under.map((b) => b + grain);
          }
          for (let k = 0; k < 3; k++) c[k] = c[k] + (under[k] - c[k]) * peel;
        }
        for (let k = 0; k < 3; k++) c[k] = c[k] + (235 - c[k]) * rim * 0.25;
        if (mat === 'enamel') {
          // enamel chips: small dark spots with a rust ring
          const ch = hash2(Math.floor(px / 10), Math.floor(py / 10), s + 61);
          if (ch > 1 - wear * 0.025) {
            const ccx = (Math.floor(px / 10) + 0.5) * 10;
            const ccy = (Math.floor(py / 10) + 0.5) * 10;
            const dd = Math.hypot(px - ccx, py - ccy);
            if (dd < 3.2) c = [30, 30, 38];
            else if (dd < 4.6) c = c.map((v0, k) => (v0 + RUST[1][k]) / 2);
          }
        }
      }
      if (mat === 'tin' || mat === 'enamel') {
        // rust streaks running down from each screw and from the bottom corners
        let rs = 0;
        for (const [sx, sy] of spec.screws) {
          const lx = cx0 + px - sx;
          const ly = cy0 + py - sy;
          if (ly < -2) continue;
          const len = 18 + 70 * wear * hash2(Math.round(sx), Math.round(sy), s);
          const width = 2.5 + ly * 0.04;
          const inLine = sstep(width, 0, Math.abs(lx + Math.sin(ly * 0.15) * 1.2));
          rs = Math.max(rs, inLine * Math.exp(-Math.max(0, ly) / len) * (0.6 + 0.4 * vnoise(px / 3, py / 3, s + 71)));
          // the screw itself, dark with a rust halo
          const dd = Math.hypot(lx, ly);
          if (dd < 2.6) rs = Math.max(rs, 1.4);
        }
        const r0 = Math.min(1, rs * (0.5 + wear));
        const rc = rs > 1.2 ? [40, 34, 30] : RUST[0];
        for (let k = 0; k < 3; k++) c[k] = c[k] + (rc[k] - c[k]) * r0;
        // dents: a soft dark and light pair across a bent corner
        if (spec.dent) {
          const dn = Math.sin(Math.min(1, Math.hypot(u - 0.85, (v - 0.8) * (h / w)) * 9) * Math.PI);
          if (Math.hypot(u - 0.85, (v - 0.8) * (h / w)) < 0.11) for (let k = 0; k < 3; k++) c[k] *= 1 + dn * 0.12;
        }
      }
      if (mat === 'flex' && spec.tear) {
        // a torn corner and a split along the top hem, the dark frame and wall behind
        const t1 = Math.hypot(u - 0.97, v - 0.08) < 0.06 + 0.04 * vnoise(px / 5, py / 5, s + 81);
        const t2 = v < 0.06 && Math.abs(u - 0.3 - 0.4 * hash2(1, 2, s)) < 0.06 * wear * vnoise(px / 4, 1, s + 83);
        if (t1 || t2) c = base.slice();
      }
      if (mat === 'wallpaint' || mat === 'paper') {
        // painted letters flake off the wall (back to the key: the wall shows), paper tears and yellows
        const fl = fbm(px / 7, py / 7, s + 91);
        if (fl > 1.05 - wear * 0.4) {
          buf[i] = 255;
          buf[i + 1] = 255;
          buf[i + 2] = 255;
          continue;
        }
        if (mat === 'paper') {
          c[2] *= 1 - 0.18 * wear;
          c[1] *= 1 - 0.05 * wear;
        }
      }
      // never pure white outside the keyed kinds (the key is white)
      for (let k = 0; k < 3; k++) {
        const vv = Math.max(0, Math.min(key ? 246 : 250, Math.round(c[k] + (fine - 0.5) * 6)));
        buf[i + k] = vv;
      }
    }
  }
}

// ------------------------------------------------------------------ the atlas of one kit
/** Draws the sign atlas of one kit; returns the cells for boards.json. */
export async function signAtlas(id, kit, names, outFile) {
  const st = STYLE[id] || STYLE.market;
  const boards = kit.boards;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIGN_ATLAS}" height="${SIGN_ATLAS}"><rect width="${SIGN_ATLAS}" height="${SIGN_ATLAS}" fill="#4a4743"/>`;
  const cells = [];
  const specs = [];
  for (const [gi, g] of GROUPS.entries()) {
    const list = namesFor(g.id, names, g.count, strHash(id + g.id));
    for (let i = 0; i < g.count; i++) {
      const cx = g.x + (i % g.cols) * g.w;
      const cy = g.y + Math.floor(i / g.cols) * g.h;
      const seed = strHash(`${id}/${g.id}/${i}`);
      const ctx = { r: rngOf(seed), st, boards, kit: id, seed };
      const n = list[i];
      const out = DRAW[g.id]([cx, cy, g.w, g.h], n, ctx, i);
      svg += out.svg;
      specs.push({ g, cx, cy, spec: out.wear, seed });
      const cell = { group: g.id, cell: i, extra: out.extra };
      if (g.id !== 'notice') Object.assign(cell, { kind: n.kind, text: n.src || n.text }, n.tagline ? { tagline: n.tagline } : {});
      cells.push(cell);
    }
    void gi;
  }
  svg += '</svg>';
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // raw RGB -> RGBA for the pass
  const W = info.width;
  const rgba = Buffer.alloc(W * info.height * 4);
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    rgba[q] = data[p];
    rgba[q + 1] = data[p + 1];
    rgba[q + 2] = data[p + 2];
    rgba[q + 3] = 255;
  }
  for (const s of specs) wearCell(rgba, W, s.g, s.cx, s.cy, s.spec, s.seed & 0xffff);
  await sharp(rgba, { raw: { width: W, height: info.height, channels: 4 } }).removeAlpha().png({ palette: true, colours: 256, dither: 0.6, effort: 8 }).toFile(outFile);
  return { wear: st.wear, cells };
}

/** Every kit's sign atlas (tools/kits/make_textures.mjs calls this). */
export async function allSigns(root, kits, outDir) {
  const res = {};
  for (const [id, kit] of Object.entries(kits)) {
    const names = JSON.parse(fs.readFileSync(path.join(root, 'game/data/names', `${kit.area}.json`), 'utf8'));
    res[id] = { area: kit.area, ...(await signAtlas(id, kit, names, path.join(outDir, `${id}_signs.png`))) };
  }
  return res;
}
