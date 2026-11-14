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
// Scripts (owner rule 2026-11-14): which scripts a board carries depends on the place, the trade and the kind of
// board (SCRIPT_ODDS, scriptMode): never Hindi, English and Urdu on every board. Painted boards are lettered with a
// sign painter's brush (brush, painted: fat uneven strokes, block shadows or outlines); flex has the cheap print-shop
// look (loud gradients, a lined and shadowed name, a starburst, clip-art tiles, a phone band).
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
  // GB Road today (owner street view, Oct 2025): printed boards mostly blue with white letters or white with blue, a few
  // red or yellow; "importers and stockists" lines and goods lists of bearings and machinery
  hardware: {
    wear: 0.8, estd: [1935, 1995], wood: 0.25,
    flex: [['#1f5fa8', '#ffffff', '#f2c230'], ['#ffffff', '#1d3f8f', '#1f5fa8'], ['#2a6fbf', '#ffffff', '#ffffff'], ['#f4f6f8', '#1f4f99', '#c0261e'], ['#1d3f8f', '#f2f0e6', '#ffffff'], ['#c0261e', '#ffffff', '#f2c230'], ['#f2c230', '#1d3f8f', '#c0261e']],
    paint: [['#1f4f99', '#f2f0e6', '#0e1f3a'], ['#f1ecdf', '#1d3f8f', '#7d7d7d'], ['#2a6fbf', '#ffffff', '#10284a'], ['#f1ecdf', '#b3261e', '#2a2a2a'], ['#e8b923', '#1d3f8f', '#3a1d12']],
    tops: ['IMPORTERS & STOCKISTS', 'DEALS IN', 'AUTHORISED DEALERS', 'WHOLESALE DEALERS'],
  },
  hotel: { wear: 0.6, estd: [1965, 2010], wood: 0.15 },
  market: { wear: 0.45, estd: [1950, 2005], wood: 0.2 },
  office: { wear: 0.35, estd: [1960, 2012], wood: 0.05 },
  colonnade: { wear: 0.16, estd: [1934, 1999], wood: 0.0, showroom: true },
  lutyens: { wear: 0.15, estd: [1931, 1990], wood: 0.0, showroom: true },
};

/** The address line real boards print under the name: street and area only (public place names, no business). */
const ADDRESS = {
  bazaar: ['Chandni Chowk, Delhi-6', 'Main Road Chandni Chowk', 'Near Town Hall, Delhi-6'],
  gali: ['Kinari Bazar, Delhi-6', 'Khari Baoli, Delhi-6', 'Gali No. 4, Delhi-6'],
  hardware: ['G.B. Road, Delhi-6', 'Shradhanand Marg, Delhi', 'Ajmeri Gate, Delhi-6'],
  hotel: ['Main Bazar, Paharganj', 'Paharganj, New Delhi-55', 'Near New Delhi Rly. Stn.'],
  market: ['Janpath, New Delhi-1', 'Tibetan Market, Janpath'],
  office: ['Daryaganj, New Delhi-2', 'Asaf Ali Road, New Delhi', 'I.T.O., New Delhi'],
  colonnade: ['Connaught Place, New Delhi', 'Inner Circle, C.P.', 'Outer Circle, C.P.'],
  lutyens: ['New Delhi', 'Janpath, New Delhi'],
};
/** What hotels and lodges print on their boards. */
const HOTEL_LINES = ['AC ROOMS', 'LIFT', '24 HRS HOT WATER', 'WIFI', 'ROOFTOP', 'CCTV', 'TRAVEL DESK', 'ATTACHED BATH', 'FAMILY ROOMS'];
const LODGING = new Set(['hotel', 'lodge', 'dharamshala']);
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
  hardware: [['मोटर', 'पंप', 'बेयरिंग', 'पाइप'], ['All Types of Bearings', 'Sleeves', 'Plummer Blocks', 'Motors', 'V-Belts']],
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
/** Official names never go on a shop board (police posts, courts, municipal and government offices): their own boards
 * are a separate kind (govt_board, street dressing). Matched in every script of the entry and its tagline. */
export const OFFICIAL = /(^|[^a-z])(police|thana|chowki|court|municipal|government|govt|ministry|secretariat|department|sarkari|nagar nigam|parliament|assembly|revenue|tribunal|directorate|post office|ward office)($|[^a-z])|पुलिस|थाना|चौकी|न्यायालय|अदालत|सरकार|नगर निगम|मंत्रालय|विभाग|सचिवालय|पोस्ट ऑफिस|پولیس|عدالت|سرکار/i;
export const isOfficial = (x) => OFFICIAL.test([...Object.values(x.text || {}), x.hi || '', x.tagline || ''].join(' | ').toLowerCase());

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
  const list = names.names.filter((x) => !NOT_BOARDS.has(x.kind) && x.text && x.text.latn && !isOfficial(x)).map(withHi);
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
/** Which scripts a board carries (owner rule 2026-11-14: it depends on the place, the trade and the kind of shop,
 * never all three on every board). Modes: h Hindi only, he Hindi over English, e English only, eh English with a Hindi
 * line, u Urdu only, uh Urdu with Hindi. Odds per kit: Chandni Chowk painted boards are Hindi or Hindi over English;
 * the galis carry small Hindi boards and, by Jama Masjid and Urdu Bazaar, Urdu or Urdu with Hindi; GB Road machinery
 * flex is mostly English with a Hindi line on some; Paharganj hotels and travel shops are English, some with a Hindi
 * line; Connaught Place showrooms are English. */
const SCRIPT_ODDS = {
  bazaar: { h: 0.4, he: 0.42, e: 0.07, eh: 0.07, u: 0.01, uh: 0.03 },
  gali: { h: 0.5, he: 0.18, e: 0.03, eh: 0.03, u: 0.11, uh: 0.15 },
  hardware: { e: 0.58, eh: 0.3, he: 0.09, h: 0.03 },
  hotel: { e: 0.62, eh: 0.3, he: 0.06, h: 0.02 },
  market: { e: 0.72, eh: 0.24, he: 0.04 },
  office: { e: 0.35, eh: 0.3, he: 0.25, h: 0.1 },
  colonnade: { e: 0.9, eh: 0.1 },
  lutyens: { e: 0.6, eh: 0.4 },
};
/** Trades that print in English first, that keep to Hindi, and the trades of the Urdu bazaars. */
const ENGLISH_KINDS = new Set(['hotel', 'lodge', 'travel', 'electronics', 'bank', 'cafe', 'bar', 'bakery', 'optician', 'shoes', 'gallery', 'cinema', 'photo', 'coaching', 'clinic', 'pharmacy', 'chemist', 'office', 'restaurant']);
const HINDI_KINDS = new Set(['sweets', 'jeweller', 'cloth', 'bridal', 'spice', 'eatery', 'tea', 'dharamshala', 'tailor', 'bangles', 'repair']);
const URDU_KINDS = new Set(['hakim', 'attar', 'books', 'printing', 'eatery']);
const OLD_CITY = new Set(['bazaar', 'gali']);
/** The mode of one board, by the kit's odds, the trade and the kind of board, among the scripts its name has. */
export function scriptMode(n, kit, group, r) {
  const odds = { ...(SCRIPT_ODDS[kit] || SCRIPT_ODDS.market) };
  const mul = (keys, k) => keys.forEach((m) => (odds[m] = (odds[m] || 0) * k));
  if (OLD_CITY.has(kit)) {
    if (ENGLISH_KINDS.has(n.kind)) mul(['e', 'eh'], 3);
    if (HINDI_KINDS.has(n.kind)) mul(['h'], 1.5);
    if (URDU_KINDS.has(n.kind)) mul(['u', 'uh'], 3);
    // new lit boxes and printed flex lean to English, small boards and wall or shutter lettering to Hindi
    if (group === 'glow' || group === 'flex') mul(['e', 'eh'], 2.2);
    if (group === 'small' || group === 'wall') mul(['h'], 1.6);
  } else if (HINDI_KINDS.has(n.kind)) {
    odds.he = (odds.he || 0.03) * 4;
    odds.h = (odds.h || 0.02) * 4;
    mul(['eh'], 1.5);
  }
  const has = { h: !!n.text.deva, he: !!n.text.deva, e: true, eh: !!n.text.deva, u: !!n.text.arab, uh: !!n.text.arab };
  const modes = Object.keys(odds).filter((m) => has[m] && odds[m] > 0);
  let t = r() * modes.reduce((a, m) => a + odds[m], 0);
  for (const m of modes) {
    t -= odds[m];
    if (t <= 0) return m;
  }
  return 'e';
}
/** The lines of a name for a mode: [script, text] big, and the second (or null). */
function scriptLines(n, kit, group, r) {
  const m = scriptMode(n, kit, group, r);
  const L = (sc) => [sc, n.text[sc]];
  return { mode: m, l1: m === 'h' || m === 'he' ? L('deva') : m === 'u' || m === 'uh' ? L('arab') : L('latn'), l2: m === 'he' ? L('latn') : (m === 'eh' || m === 'uh') && n.text.deva ? L('deva') : null };
}
let FID = 0;
/** A sign painter's brush for one board (owner 2026-11-14: hand-painted signwriter letterforms, not clean type): a
 * wobble filter, so the edge of every stroke wanders as a brush does; how fat the strokes are; and the letter style:
 * `block` a solid shadow down and right, `outline` a contrasting line round each letter, `drop` a thin offset shadow,
 * `plain` one coat. */
function brush(r, seed) {
  const id = `br${FID++}`;
  const def = `<defs><filter id="${id}" x="-4%" y="-35%" width="108%" height="170%"><feTurbulence type="fractalNoise" baseFrequency="${(0.03 + r() * 0.03).toFixed(3)} ${(0.05 + r() * 0.04).toFixed(3)}" numOctaves="2" seed="${seed % 997}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${(2.4 + r() * 1.8).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
  const a = r();
  return { id, def, style: a < 0.4 ? 'block' : a < 0.63 ? 'outline' : a < 0.86 ? 'drop' : 'plain', fat: 0.01 + r() * 0.02 };
}
/** One painted line with the board's brush: fat uneven strokes and the board's shadow or outline (`main` lines only
 * carry the block shadow and the outline; small lines a thin shadow at most). */
function painted(b, font, text, o, fill, sh, main = true) {
  // (sized by the height the line really gets once it is fitted to its box: a long name painted small keeps thin
  // strokes and a short shadow, or its letters run into one another)
  const eff = fitLine(font, text, o).h;
  const sp = Math.max(0.4, eff * b.fat * (main ? 1 : 0.55));
  let g = '';
  if (sh && main && b.style === 'block') {
    const nn = Math.max(2, Math.round(eff * 0.075));
    for (let k = nn; k >= 1; k--) g += fitLine(font, text, { ...o, drop: null, x: o.x + k, y: o.y + k, attrs: `fill="${sh}"`, stroke: sh, strokePx: sp }).svg;
  } else if (sh && main && b.style === 'outline') {
    g += fitLine(font, text, { ...o, drop: null, attrs: `fill="${sh}"`, stroke: sh, strokePx: sp + Math.max(2.5, eff * 0.12) }).svg;
  } else if (sh && b.style !== 'plain') {
    const d = Math.max(1.2, eff * (main ? 0.055 : 0.04));
    g += fitLine(font, text, { ...o, x: o.x + d, y: o.y + d, attrs: `fill="${sh}"`, stroke: sh, strokePx: sp }).svg;
  }
  g += fitLine(font, text, { ...o, attrs: `fill="${fill}"`, stroke: fill, strokePx: sp }).svg;
  return `<g filter="url(#${b.id})">${g}</g>`;
}
function fontFor(script, kind, r) {
  if (script === 'arab') return 'nastaliq';
  if (kind === 'paint') return script === 'deva' ? pick(r, ['rozha', 'yatra', 'rozha', 'kalam', 'noto_serif_deva', 'mukta']) : pick(r, ['alfa', 'rozha', 'alfa', 'kalam', 'anton']);
  if (kind === 'flex') return script === 'deva' ? pick(r, ['mukta', 'khand', 'teko', 'noto_deva']) : pick(r, ['anton', 'oswald', 'mukta', 'teko']);
  return script === 'deva' ? pick(r, ['hind', 'mukta_b', 'khand']) : pick(r, ['oswald', 'hind', 'mukta_b']);
}
const capsOf = (txt, script, upper) => (script === 'latn' && upper ? txt.toUpperCase() : txt);
function arrow(x, y, w, h, fill, left) {
  const d = left ? `M${x + w},${y + h * 0.35} L${x + h * 0.6},${y + h * 0.35} L${x + h * 0.6},${y} L${x},${y + h / 2} L${x + h * 0.6},${y + h} L${x + h * 0.6},${y + h * 0.65} L${x + w},${y + h * 0.65} Z` : `M${x},${y + h * 0.35} L${x + w - h * 0.6},${y + h * 0.35} L${x + w - h * 0.6},${y} L${x + w},${y + h / 2} L${x + w - h * 0.6},${y + h} L${x + w - h * 0.6},${y + h * 0.65} L${x},${y + h * 0.65} Z`;
  return `<path d="${d}" fill="${fill}"/>`;
}
function pickN(r, a, n) {
  const c = a.slice();
  const out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(r() * c.length) % c.length, 1)[0]);
  return out;
}
function stars(cx, y, n, size, fill) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const sx = cx + (i - (n - 1) / 2) * size * 1.15;
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? size * 0.22 : size * 0.5;
      pts.push(`${(sx + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`);
    }
    s += `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
  }
  return s;
}
/** A border of bulbs (or LED dots) round a board, inset `i` px, every `step` px: yellow, the kit shader chases them at night. */
function bulbs(x, y, w, h, i, step, fill = '#ffd34d', rad = 4.3) {
  let s = '';
  const nx = Math.max(1, Math.round((w - 2 * i) / step));
  const ny = Math.max(1, Math.round((h - 2 * i) / step));
  for (let k = 0; k <= nx; k++) {
    const px = (x + i + ((w - 2 * i) * k) / nx).toFixed(1);
    s += `<circle cx="${px}" cy="${y + i}" r="${rad}" fill="${fill}"/><circle cx="${px}" cy="${y + h - i}" r="${rad}" fill="${fill}"/>`;
  }
  for (let k = 1; k < ny; k++) {
    const py = (y + i + ((h - 2 * i) * k) / ny).toFixed(1);
    s += `<circle cx="${x + i}" cy="${py}" r="${rad}" fill="${fill}"/><circle cx="${x + w - i}" cy="${py}" r="${rad}" fill="${fill}"/>`;
  }
  return s;
}
let GRAD = 0;
/** A linear gradient fill (printed flex and acrylic faces are rarely one flat colour). */
function grad(a, b, vertical = true) {
  const id = `gr${GRAD++}`;
  return { id, def: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`, fill: `url(#${id})` };
}
function shade(h, k) {
  const c = hex(h).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function screws(x, y, w, h, inset) {
  const out = [[x + inset, y + inset], [x + w - inset, y + inset], [x + inset, y + h - inset], [x + w - inset, y + h - inset]];
  // long boards are screwed along the top and bottom too
  if (w > h * 2.5) out.push([x + w * 0.36, y + inset], [x + w * 0.67, y + inset], [x + w * 0.5, y + h - inset]);
  if (h > w * 2.5) out.push([x + inset, y + h * 0.5], [x + w - inset, y + h * 0.5]);
  return out;
}
/** How old a board is (fix round 3: old boards hang beside newer ones): about a fifth are new, a quarter very old. */
function ageOf(r) {
  const a = r();
  if (a < 0.2) return 0.22 + r() * 0.15;
  if (a < 0.72) return 0.7 + r() * 0.4;
  return 1.1 + r() * 0.3;
}
/** Texels per metre of each group at its piece's size (kit_pieces.gd), so wear keeps its real size on every kind. */
const PPM = { fascia: 190, flex: 190, glow: 195, wall: 213, vertical: 213, enamel: 470, small: 420, notice: 400 };

function fascia(c, n, ctx) {
  const { r, st, kit } = ctx;
  const [x, y, w, h] = c;
  const pal = st.showroom ? pick(r, PAINT_SHOWROOM) : pick(r, st.paint || PAINT);
  const [bg, fg, sh] = pal;
  const wood = r() < st.wood;
  const upper = ctx.boards.case === 'upper' || r() < 0.4;
  const sl = scriptLines(n, kit, 'fascia', r);
  const l1 = sl.l1;
  let l2 = sl.l2;
  // a tagline (Latin letters) only where the board carries English
  if (n.tagline && (sl.mode === 'e' || (sl.mode === 'he' && r() < 0.4))) l2 = ['latn', n.tagline];
  const jit = st.showroom ? null : (i) => hash2(i, 7, ctx.seed) * 2 - 1;
  // showroom boards (Connaught Place) are neat cut letters; everywhere else a sign painter's brush
  const b = st.showroom ? null : brush(r, ctx.seed);
  const drop = b && b.style !== 'block' && r() < st.wear * 0.4 ? ((k) => (i) => i === k)(Math.floor(r() * 8) * 3) : null;
  const put = (font, text, o, fill, shd, main = true) => (b ? painted(b, font, text, o, fill, shd, main) : fitLine(font, text, { ...o, attrs: `fill="${fill}"` }).svg);
  let s = `${b ? b.def : ''}<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${bg}"/>`;
  if (wood) for (let k = 1; k < 3; k++) s += `<rect x="${x + 2}" y="${y + (h * k) / 3 - 1}" width="${w - 4}" height="2" fill="#000" opacity="0.25"/>`;
  // the painted border line, drawn by hand: a little off square, sometimes double
  if (b) {
    s += `<g filter="url(#${b.id})"><rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 14}" fill="none" stroke="${fg}" stroke-width="${(2.2 + r() * 2).toFixed(1)}" opacity="0.85"/>`;
    if (r() < 0.35) s += `<rect x="${x + 13}" y="${y + 13}" width="${w - 26}" height="${h - 26}" fill="none" stroke="${sh}" stroke-width="1.4" opacity="0.7"/>`;
    s += '</g>';
  }
  const extra = [];
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  // the words under the name follow the board's scripts: Hindi goods on a Hindi board, none on an Urdu one
  const hindiBoard = l1[0] === 'deva' && sl.mode === 'h';
  const goodsLine = l1[0] === 'arab' ? (sl.mode === 'uh' && gl[0].length ? ['deva', gl[0].slice(0, 3).join(' • ')] : null) : hindiBoard ? (gl[0].length ? ['deva', gl[0].slice(0, 3).join(' • ')] : null) : ['latn', LODGING.has(n.kind) ? pickN(r, HOTEL_LINES, 3).join(' • ') : gl[1].slice(0, 3).join(' • ')];
  let layout = st.showroom ? 0 : Math.floor(r() * 5);
  if (layout === 2 && !l2) layout = 0;
  if (layout === 3 && !goodsLine) layout = 0;
  const hasEstd = !st.showroom && r() < 0.5;
  const estd = hasEstd ? Math.floor(st.estd[0] + r() * (st.estd[1] - st.estd[0])) : 0;
  const shadow = st.showroom ? null : sh;
  const f1 = fontFor(l1[0], 'paint', r);
  const t1 = capsOf(l1[1], l1[0], upper);
  if (layout === 2) {
    // side by side: the first script left, the second right, a painted rule between
    s += put(f1, t1, { x: x + w * 0.27, y: y + h * 0.66, maxW: w * 0.42, size: h * 0.46, jitter: jit, drop }, fg, shadow);
    s += `<rect x="${x + w / 2 - 2}" y="${y + 16}" width="4" height="${h - 32}" fill="${fg}" opacity="0.8"/>`;
    const f2 = fontFor(l2[0], 'paint', r);
    s += put(f2, capsOf(l2[1], l2[0], upper), { x: x + w * 0.74, y: y + h * 0.66, maxW: w * 0.42, size: h * 0.42, jitter: jit }, fg, shadow);
  } else if (layout === 3) {
    // the name, then a goods band in the letter colour along the bottom
    s += put(f1, t1, { x: x + w / 2, y: y + h * 0.56, maxW: w - 44, size: h * 0.5, jitter: jit, drop }, fg, shadow);
    s += `<rect x="${x + 7}" y="${y + h * 0.68}" width="${w - 14}" height="${h * 0.24}" fill="${fg}"/>`;
    s += put(goodsLine[0] === 'deva' ? 'mukta' : 'oswald', goodsLine[1], { x: x + w / 2, y: y + h * 0.87, maxW: w - 50, size: h * 0.19 }, bg, null, false);
    extra.push(goodsLine[1]);
  } else {
    // the name big over a small second line (the other script, or the goods), with the estd year or a phone number
    if (!l2 && goodsLine) {
      l2 = goodsLine;
      extra.push(goodsLine[1]);
    }
    const corner = hasEstd || (!st.showroom && r() < 0.5);
    s += put(f1, t1, { x: x + w / 2, y: y + h * (l2 ? 0.5 : 0.68), maxW: corner ? w - 210 : w - 50, size: h * (l2 ? 0.44 : 0.56), jitter: jit, drop }, fg, shadow);
    if (l2) {
      const f2 = l2[0] === 'deva' ? pick(r, ['mukta', 'kalam', 'yatra']) : fontFor('latn', 'paint', r);
      s += put(f2, capsOf(l2[1], l2[0], true), { x: x + w / 2, y: y + h * 0.82, maxW: w - 130, size: h * 0.24, track: 1, jitter: jit }, fg, shadow, false);
      // a painter's flourish: a diamond each side of the small line
      if (b && r() < 0.45) for (const dx of [58, w - 58]) s += `<path d="M${x + dx - 9},${y + h * 0.76} l9,-7 l9,7 l-9,7 Z" fill="${fg}" opacity="0.9" filter="url(#${b.id})"/>`;
    }
    const latinBoard = l1[0] === 'latn' || (l2 && l2[0] === 'latn');
    if (hasEstd) {
      const e = latinBoard && (l1[0] === 'latn' || r() < 0.5) ? `Estd. ${estd}` : `स्था. ${estd}`;
      s += put(e.startsWith('स्था') ? 'mukta' : 'rozha', e, { x: x + 16, y: y + h * 0.3, maxW: 80, size: 15, anchor: 'start' }, fg, null, false);
      extra.push(e);
    } else if (corner) {
      const p = phone(r, r() < 0.5);
      s += put('kalam', p, { x: x + w - 16, y: y + h * 0.3, maxW: 110, size: 16, anchor: 'end' }, fg, null, false);
      extra.push(p);
    }
    if (layout === 4) s += arrow(x + w - 70, y + h - 30, 52, 18, fg, false);
    if (!st.showroom && !hasEstd && !corner && latinBoard && r() < 0.7) {
      const a = pick(r, ADDRESS[kit] || ADDRESS.market);
      s += put('kalam', a, { x: x + 16, y: y + h * 0.27, maxW: 150, size: 14, anchor: 'start' }, fg, null, false);
      extra.push(a);
    }
  }
  const mat = wood ? 'wood' : 'tin';
  return { svg: s, extra, mode: sl.mode, wear: { mat, bg: hex(bg), fg: hex(fg), screws: wood ? [] : screws(x, y, w, h, 12), brackets: [[x + w * 0.11, y], [x + w * 0.89, y]], wear: st.wear * ageOf(r), dent: !wood && r() < st.wear * 0.7 } };
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

/** A starburst badge, as print shops drop on every banner. */
function burst(cx, cy, r0, r1, n, fill) {
  const pts = [];
  for (let k = 0; k < n * 2; k++) {
    const a = (k * Math.PI) / n;
    const rr = k % 2 ? r0 : r1;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}
const BURSTS = { latn: [['BEST', 'PRICE'], ['100%', 'GENUINE'], ['WHOLE', 'SALE'], ['FIXED', 'RATE']], deva: [['थोक', 'रेट'], ['सही', 'दाम'], ['नया', 'माल']] };
const FLEX_TOPS_HI = ['थोक एवं फुटकर विक्रेता', 'हमारे यहाँ उपलब्ध', 'विश्वसनीय प्रतिष्ठान'];

function flex(c, n, ctx) {
  // the cheap print-shop look (owner 2026-11-14): a loud gradient, the name squeezed to the width in heavy type with a
  // white line and a dark line round it and a hard shadow, a slanted top line, a starburst, clip-art product tiles in
  // white boxes, phone numbers in a band with a handset disc; every line a different typeface
  const { r, st, kit } = ctx;
  const [x, y, w, h] = c;
  const [bg, fg, ac] = pick(r, st.flex || FLEX);
  const sl = scriptLines(n, kit, 'flex', r);
  const { l1, l2 } = sl;
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  const light = luma(hex(bg)) > 150;
  const two = r() < 0.45;
  const gf = grad(shade(bg, 1.14), two ? shade(ac === '#ffffff' ? bg : ac, light ? 1.0 : 0.9) : shade(bg, 0.76), r() < 0.6);
  let s = `${gf.def}<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${gf.fill}"/>`;
  // a printed photo backdrop: soft blobs behind the name, a swoosh under it
  for (let k = 0; k < 5; k++) s += `<ellipse cx="${(x + 30 + r() * (w - 60)).toFixed(1)}" cy="${(y + h * (0.15 + r() * 0.25)).toFixed(1)}" rx="${(30 + r() * 60).toFixed(1)}" ry="${(14 + r() * 24).toFixed(1)}" fill="${pick(r, ['#ffffff', '#000000', ac])}" opacity="0.08"/>`;
  s += `<path d="M${x + 2},${y + h * 0.4} Q${x + w * 0.5},${y + h * (0.3 + r() * 0.1)} ${x + w - 2},${y + h * 0.42} L${x + w - 2},${y + h * 0.47} L${x + 2},${y + h * 0.47} Z" fill="#fff" opacity="0.14"/>`;
  s += `<rect x="${x + 2}" y="${y + h * 0.45}" width="${w - 4}" height="${h * 0.1}" fill="${ac}"/>`;
  const extra = [];
  const hindi = l1[0] === 'deva';
  const top = n.tagline && !hindi ? n.tagline.toUpperCase() : hindi ? pick(r, FLEX_TOPS_HI) : st.tops ? pick(r, st.tops) : r() < 0.5 ? 'AUTHORISED DEALERS' : 'DEALS IN';
  s += `<g transform="skewX(-10)" transform-origin="${x + w / 2} ${y + h * 0.1}">` + fitLine(hindi ? 'khand' : 'oswald', top, { x: x + w / 2 + (y + h * 0.1) * 0.176, y: y + h * 0.105, maxW: w * 0.5, size: h * 0.082, track: 1, attrs: `fill="${fg}"` }).svg + '</g>';
  if (!(n.tagline && !hindi)) extra.push(top);
  const f1 = fontFor(l1[0], 'flex', r);
  // the name: a hard shadow, a dark line, a white line, the fill
  const nm = capsOf(l1[1], l1[0], true);
  const burstLeft = r() < 0.5;
  const no = { x: x + w / 2 + (burstLeft ? 36 : -36), y: y + h * 0.34, maxW: w - 134, size: h * 0.23, minSqueeze: 0.6 };
  const dark = light ? shade(fg, 0.45) : '#101014';
  const inner = light ? '#ffffff' : luma(hex(fg)) > 170 ? shade(bg, 0.5) : '#ffffff';
  s += fitLine(f1, nm, { ...no, x: no.x + 4, y: no.y + 4, attrs: 'fill="#000" opacity="0.5"', stroke: '#000', strokePx: 6 }).svg;
  s += fitLine(f1, nm, { ...no, attrs: `fill="${dark}"`, stroke: dark, strokePx: 7 }).svg;
  s += fitLine(f1, nm, { ...no, attrs: `fill="${inner}"`, stroke: inner, strokePx: 3.2 }).svg;
  s += fitLine(f1, nm, { ...no, attrs: `fill="${fg === inner ? ac : fg}"` }).svg;
  if (l2) s += fitLine(l2[0] === 'deva' ? 'mukta' : 'anton', capsOf(l2[1], l2[0], true), { x: x + w / 2, y: y + h * 0.435, maxW: w - 150, size: h * 0.085, attrs: `fill="${fg}"`, stroke: dark, strokePx: 0.8 }).svg;
  // the starburst, in a corner by the name
  const bt = pick(r, BURSTS[hindi ? 'deva' : 'latn']);
  const bx = burstLeft ? x + 44 : x + w - 44;
  const by = y + h * 0.2;
  const bc = pick(r, ['#e21b1b', '#ffd400', '#e21b1b']);
  s += burst(bx, by, 26, 37, 12, bc) + burst(bx, by, 23, 31, 12, shade(bc, 1.15));
  s += fitLine(hindi ? 'mukta' : 'anton', bt[0], { x: bx, y: by - 1, maxW: 44, size: 17, attrs: `fill="${bc === '#ffd400' ? '#b3120f' : '#ffffff'}"` }).svg;
  s += fitLine(hindi ? 'mukta' : 'anton', bt[1], { x: bx, y: by + 15, maxW: 44, size: 15, attrs: `fill="${bc === '#ffd400' ? '#b3120f' : '#ffffff'}"` }).svg;
  extra.push(bt.join(' '));
  const g = (hindi && gl[0].length ? gl[0] : gl[1]).join(' • ');
  s += fitLine(hindi && gl[0].length ? 'mukta' : 'oswald', g.toUpperCase(), { x: x + w / 2, y: y + h * 0.535, maxW: w - 40, size: h * 0.07, attrs: `fill="${luma(hex(ac)) > 150 ? '#14141a' : '#ffffff'}"` }).svg;
  extra.push(g);
  // product pictures in a row, each in its white box with a thin line
  const np = 5;
  const ps = (w - 24 - (np - 1) * 6) / np;
  const pss = Math.min(ps, h * 0.27);
  for (let i = 0; i < np; i++) {
    const px = x + 12 + i * (ps + 6) + (ps - pss) / 2;
    s += `<rect x="${(px - 2).toFixed(1)}" y="${(y + h * 0.59 - 2).toFixed(1)}" width="${(pss + 4).toFixed(1)}" height="${(pss + 4).toFixed(1)}" fill="#ffffff" stroke="${dark}" stroke-width="1"/>` + product(px, y + h * 0.59, pss, n.kind, r);
  }
  // the contact band: a handset disc, two numbers in heavy type, the address
  const p1 = phone(r, false);
  const p2 = phone(r, r() < 0.5);
  const ad = pick(r, ADDRESS[kit] || ADDRESS.market);
  const band = light ? shade(fg, 0.9) : shade(bg, 0.55);
  const bandInk = luma(hex(band)) > 150 ? '#14141a' : '#ffffff';
  s += `<rect x="${x + 2}" y="${y + h * 0.885}" width="${w - 4}" height="${h * 0.1}" fill="${band}"/>`;
  s += `<circle cx="${x + 20}" cy="${y + h * 0.935}" r="8" fill="${bandInk}"/><path d="M${x + 15.5},${y + h * 0.935 - 3.5} q4.5,-3.5 9,0 l-1.8,2.2 q-2.7,-1.6 -5.4,0 Z" fill="${band}"/><rect x="${x + 16.5}" y="${y + h * 0.935}" width="7" height="4" rx="1" fill="${band}"/>`;
  s += fitLine('anton', `${p1}, ${p2}`, { x: x + 34, y: y + h * 0.96, maxW: w * 0.52, size: h * 0.078, anchor: 'start', attrs: `fill="${bandInk}"` }).svg;
  s += fitLine('oswald', ad, { x: x + w - 12, y: y + h * 0.957, maxW: w * 0.36, size: h * 0.062, anchor: 'end', attrs: `fill="${bandInk}"` }).svg;
  extra.push(p1, p2, ad);
  return { svg: s, extra, mode: sl.mode, wear: { mat: 'flex', bg: hex(bg), screws: [], wear: st.wear * ageOf(r), tear: r() < st.wear * 0.5 } };
}

function glow(c, n, ctx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  const [bg, fg, ac] = pick(r, GLOW);
  const sl = scriptLines(n, ctx.kit, 'glow', r);
  const l1 = sl.l1;
  let l2 = sl.l2;
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  const lodging = LODGING.has(n.kind);
  if (n.tagline && !l2 && l1[0] === 'latn') l2 = ['latn', n.tagline];
  // a printed acrylic face: a gradient ground, a colour stripe, an outline frame, an icon disc with the initial, the
  // name with an outline, a services or goods line, and phone numbers or the address (shops print three or four lines)
  const gf = grad(shade(bg, 1.08), shade(bg, 0.86));
  let s = `${gf.def}<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="#3a3a3c"/><rect x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 16}" fill="${gf.fill}"/>`;
  s += `<rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 24}" fill="none" stroke="${ac}" stroke-width="2.5"/>`;
  const stripe = r() < 0.5;
  if (stripe) s += `<rect x="${x + 8}" y="${y + h - 34}" width="${w - 16}" height="22" fill="${ac}"/>`;
  const icon = r() < 0.65 && (lodging || l1[0] === 'latn');
  const ix = x + 46;
  if (icon) {
    s += `<circle cx="${ix}" cy="${y + h * 0.42}" r="27" fill="${ac}"/><circle cx="${ix}" cy="${y + h * 0.42}" r="22" fill="none" stroke="${bg}" stroke-width="2"/>`;
    if (lodging) s += stars(ix, y + h * 0.42, 1, 26, bg);
    else s += fitLine('alfa', n.text.latn.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || 'A', { x: ix, y: y + h * 0.42 + 11, maxW: 30, size: 30, attrs: `fill="${bg}"` }).svg;
  }
  const tx = icon ? x + w / 2 + 34 : x + w / 2;
  const tw = icon ? w - 120 : w - 50;
  const f1 = fontFor(l1[0], 'glow', r);
  const nm = capsOf(l1[1], l1[0], true);
  s += fitLine(f1, nm, { x: tx, y: y + h * 0.5, maxW: tw, size: h * 0.36, attrs: `fill="${fg}" stroke="${shade(bg, 0.6)}" stroke-width="1.4" paint-order="stroke"` }).svg;
  if (lodging) s += stars(tx, y + h * 0.13 + 4, 3, 13, '#f2c230');
  const extra = [];
  const second = l2 ? capsOf(l2[1], l2[0], true) : null;
  // the services or goods line follows the board: Hindi goods on a Hindi only box, nothing more on an Urdu only one
  const hindiOnly = sl.mode === 'h' && gl[0].length > 0;
  const svc = sl.mode === 'u' ? '' : hindiOnly ? gl[0].slice(0, 3).join(' • ') : lodging ? pickN(r, HOTEL_LINES, 3).join(' • ') : gl[1].slice(0, 3).join(' • ').toUpperCase();
  const line2 = second && (r() < 0.5 || !svc) ? second : svc;
  if (line2 === svc && svc) extra.push(svc);
  if (line2) s += fitLine((line2 === second && l2[0] === 'deva') || (line2 === svc && hindiOnly) ? 'hind' : 'oswald', line2, { x: tx, y: y + h * 0.69, maxW: tw, size: h * 0.13, attrs: `fill="${fg}"` }).svg;
  const p = phone(r, r() < 0.4);
  const ad = pick(r, ADDRESS[ctx.kit] || ADDRESS.market);
  const last = l1[0] === 'latn' || (l2 && l2[0] === 'latn') ? `${p}  •  ${ad}` : p;
  s += fitLine('oswald', last, { x: x + w / 2, y: y + h - 17, maxW: w - 40, size: 13, attrs: `fill="${stripe ? (luma(hex(ac)) > 150 ? '#1c1c1e' : '#ffffff') : fg}"` }).svg;
  extra.push(p);
  if (last !== p) extra.push(ad);
  return { svg: s, extra, mode: sl.mode, wear: { mat: 'acrylic', bg: hex(bg), screws: [], wear: st.wear * ageOf(r) * 0.8, dead: r() < st.wear * 0.45 } };
}

function wall(c, n, ctx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  const fg = pick(r, ['#9b1c1c', '#1d3f8f', '#1c1c1e', '#2c6e49']);
  const sl = scriptLines(n, ctx.kit, 'wall', r);
  const { l1, l2 } = sl;
  // brushed straight on the plaster or the shutter: one coat, fat uneven strokes, no shadow (the key must stay white)
  const b = { ...brush(r, ctx.seed), style: 'plain' };
  let s = `${b.def}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`;
  const f1 = fontFor(l1[0], 'paint', r);
  const jit = (i) => hash2(i, 11, ctx.seed) * 2 - 1;
  s += painted(b, f1, l1[1], { x: x + w / 2, y: y + h * (l2 ? 0.5 : 0.62), maxW: w - 60, size: h * 0.46, jitter: jit }, fg, null);
  const extra = [];
  if (l2) s += painted(b, 'kalam', l2[1], { x: x + w / 2 - 20, y: y + h * 0.84, maxW: w - 160, size: h * 0.24, jitter: jit }, fg, null, false);
  if (r() < 0.6) {
    s += arrow(x + w - 84, y + h * 0.68, 64, 24, fg, r() < 0.4);
    const t = r() < 0.5 ? 'गली में' : 'ऊपर';
    s += fitLine('kalam', t, { x: x + 54, y: y + h * 0.86, maxW: 90, size: 22, attrs: `fill="${fg}"` }).svg;
    extra.push(t);
  }
  if (!l2) {
    // a phone number painted under a one-line name (wall and shutter lettering carries the number)
    const p = phone(r, false);
    s += painted(b, 'kalam', p, { x: x + w / 2 - 20, y: y + h * 0.9, maxW: w - 250, size: h * 0.26 }, fg, null, false);
    extra.push(p);
  }
  return { svg: s, extra, mode: sl.mode, wear: { mat: 'wallpaint', bg: [255, 255, 255], screws: [], wear: Math.min(1.1, st.wear * (0.8 + r() * 0.6)) } };
}

function vertical(c, n, ctx, idx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  // the even cells are glow boxes or LED boards (lit at night, a bulb border the kit shader chases), the odd ones painted
  const lit = idx % 2 === 0;
  const [bg, fg, sh] = lit ? pick(r, GLOW) : st.showroom ? pick(r, PAINT_SHOWROOM) : pick(r, st.paint || PAINT);
  const ac = lit ? pick(r, ['#f2c230', '#c0261e', '#2e7d32', '#1d3f8f', '#ffffff']) : fg;
  const gf = grad(shade(bg, 1.1), shade(bg, 0.8));
  let s = `${gf.def}<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${lit ? gf.fill : bg}"/>`;
  // a lit board carries a running border: a dark channel 12 px wide all round with a bulb (or LED dot) every 15 px; the
  // kit shader runs the light along that band at night (surface_b.gdshaderinc, the band is the outer 0.1 of the width)
  if (lit) s += `<path fill-rule="evenodd" d="M${x + 2},${y + 2} h${w - 4} v${h - 4} h${-(w - 4)} Z M${x + 14},${y + 14} v${h - 28} h${w - 28} v${-(h - 28)} Z" fill="#17171a"/>` + bulbs(x, y, w, h, 8, 15, pick(r, ['#ffd34d', '#ffd34d', '#ff5a4d', '#7dffb0', '#ffffff'])) + `<rect x="${x + 17}" y="${y + 17}" width="${w - 34}" height="${h - 34}" fill="none" stroke="${ac}" stroke-width="2"/>`;
  else s += `<rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 14}" fill="none" stroke="${fg}" stroke-width="3"/>`;
  // scripts by place (owner rule): Paharganj and the new town stack English letters; in the old city a painted
  // vertical board often stacks the Hindi name, one akshara to a line
  const vmode = scriptMode(n, ctx.kit, 'vertical', r);
  const hindiStack = !lit && (vmode === 'h' || vmode === 'he') && !!n.text.deva;
  const latn = n.text.latn;
  const words = latn.toUpperCase().split(/\s+/);
  const kindWord = { hotel: 'HOTEL', lodge: 'GUEST HOUSE', dharamshala: 'DHARAMSHALA', clinic: 'CLINIC', hakim: 'DAWAKHANA', coaching: 'CLASSES' }[n.kind];
  let main = words.find((wd) => wd.length >= 3 && !(kindWord || '').includes(wd)) || words[0];
  main = main.replace(/[^A-Z0-9&]/g, '').slice(0, 10);
  let letters = [...main];
  if (hindiStack) {
    const seg = new Intl.Segmenter('hi', { granularity: 'grapheme' });
    const dw = n.text.deva.split(' ').filter((wd) => wd.length > 1);
    const ak = [...seg.segment(dw.slice(0, 2).join(''))].map((q) => q.segment).filter((q) => q.trim());
    if (ak.length >= 2 && ak.length <= 9) letters = ak;
  }
  const stacked = hindiStack && letters.join('') !== main;
  const vb = lit || st.showroom ? null : brush(r, ctx.seed);
  if (vb) s += vb.def;
  const lodging = LODGING.has(n.kind);
  // the head: stars for lodging, the Hindi word, or the kind word
  let top = y + 22;
  if (lodging) {
    s += stars(x + w / 2, top + 6, 3, 20, lit ? '#f2c230' : fg);
    top += 18;
  }
  if (n.text.deva && !stacked && (vmode === 'eh' || vmode === 'he' || vmode === 'h') && r() < 0.8) {
    s += fitLine('mukta', n.text.deva.split(' ')[0], { x: x + w / 2, y: top + 24, maxW: w - 30, size: 26, attrs: `fill="${fg}"` }).svg;
    top += 28;
  } else if (kindWord && !stacked) {
    s += fitLine('oswald', kindWord, { x: x + w / 2, y: top + 18, maxW: w - 30, size: 18, attrs: `fill="${fg}"` }).svg;
    top += 22;
  }
  const footH = 120;
  const lh = Math.min(44, (y + h - footH - top - 10) / Math.max(4, letters.length));
  // dead letters (fix round 3): on an older lit board the tube behind one or two letters has failed, so that part of the
  // face is dark by day and stays dark at night (the shader's glow is the face's own colour)
  const deadAt = lit && r() < 0.25 + st.wear * 0.5 ? Math.floor(r() * letters.length) : -1;
  const deadTwo = deadAt >= 0 && r() < 0.35 ? (deadAt + 2) % letters.length : -1;
  letters.forEach((ch, i) => {
    const lo = { x: x + w / 2, y: top + 8 + (i + 1) * lh, maxW: w - 40, size: lh * (stacked ? 0.8 : 0.95) };
    if (vb) s += painted(vb, stacked ? 'rozha' : 'alfa', ch, lo, fg, sh);
    else if (lit) s += fitLine('oswald', ch, { ...lo, attrs: `fill="${ac}"`, stroke: ac, strokePx: 3 }).svg + fitLine('oswald', ch, { ...lo, attrs: `fill="${fg}"` }).svg;
    else s += fitLine('alfa', ch, { ...lo, attrs: `fill="${fg}"` }).svg;
    if (i === deadAt || i === deadTwo) s += `<rect x="${x + 18}" y="${(top + 8 + i * lh + lh * 0.12).toFixed(1)}" width="${w - 36}" height="${(lh * 0.98).toFixed(1)}" fill="#0c0c0e" opacity="0.8"/>`;
  });
  // the foot: services or goods in small lines, then a phone number on a band
  const gl = GOODS[n.kind] || DEFAULT_GOODS;
  const lines = stacked && gl[0].length ? gl[0].slice(0, 3) : lodging ? pickN(r, HOTEL_LINES, 3) : gl[1].slice(0, 3).map((g) => g.toUpperCase());
  let fy = y + h - footH + 14;
  s += `<rect x="${x + 16}" y="${fy - 12}" width="${w - 32}" height="2" fill="${ac}"/>`;
  for (const t of lines) {
    s += fitLine(stacked && gl[0].length ? 'mukta' : 'oswald', t, { x: x + w / 2, y: fy + 12, maxW: w - 34, size: 14, attrs: `fill="${fg}"` }).svg;
    fy += 20;
  }
  const p = phone(r, false);
  s += `<rect x="${x + 14}" y="${y + h - 38}" width="${w - 28}" height="22" fill="${lit ? ac : fg}"/>`;
  s += fitLine('oswald', p, { x: x + w / 2, y: y + h - 21, maxW: w - 36, size: 14, attrs: `fill="${lit ? bg : bg}"` }).svg;
  return { svg: s, extra: [stacked ? letters.join('') : main, ...(kindWord && !stacked ? [kindWord] : []), ...lines, p], mode: stacked ? 'h' : vmode, wear: { mat: lit ? 'acrylic' : 'tin', bg: hex(bg), fg: hex(fg), screws: lit ? [] : screws(x, y, w, h, 10), wear: st.wear * ageOf(r) * (lit ? 0.8 : 1), lit, band: lit ? 15 : 0, dent: !lit && r() < st.wear * 0.5 } };
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
  return { svg: s, extra: [g], wear: { mat: 'enamel', bg: [228, 223, 210], screws: [[cx, cy - rr + 7], [cx, cy + rr - 7]], wear: st.wear * ageOf(r), disc: [cx, cy, rr] } };
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
  const sl = scriptLines(n, ctx.kit, 'small', r);
  const l1 = sl.l1;
  if (st.showroom) s += fitLine(fontFor(l1[0], 'paint', r), capsOf(l1[1], l1[0], true), { x: tx, y: y + h * 0.45, maxW: tw, size: h * 0.3, attrs: `fill="${fg}"` }).svg;
  else {
    const b = brush(r, ctx.seed);
    s += b.def + painted(b, fontFor(l1[0], 'paint', r), capsOf(l1[1], l1[0], true), { x: tx, y: y + h * 0.45, maxW: tw, size: h * 0.3, jitter: jit }, fg, sh);
  }
  const hg = l1[0] !== 'latn' && gl[0].length > 0;
  const g = (hg ? gl[0] : gl[1])[0];
  s += fitLine(hg ? pick(r, ['mukta', 'kalam']) : pick(r, ['oswald', 'kalam']), g, { x: tx, y: y + h * 0.72, maxW: tw, size: h * 0.17, attrs: `fill="${fg}"` }).svg;
  const p = phone(r, true);
  s += fitLine('oswald', p, { x: tx, y: y + h * 0.9, maxW: tw * 0.8, size: h * 0.12, attrs: `fill="${fg}"` }).svg;
  return { svg: s, extra: [g, p], wear: { mat: r() < st.wood ? 'wood' : 'tin', bg: hex(bg), fg: hex(fg), screws: screws(x, y, w, h, 14), wear: st.wear * ageOf(r), dent: r() < st.wear * 0.4 } };
}

function notice(c, _n, ctx, idx) {
  const { r, st } = ctx;
  const [x, y, w, h] = c;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`;
  const extra = [];
  if (idx >= 6) {
    // lettering painted straight on the plaster by a sign painter: a place to let and its number (fix round 3)
    const [hi, en] = idx === 6 ? ['किराये के लिए', 'TO LET'] : ['दुकान खाली है', 'SHOP FOR RENT'];
    const fg = pick(r, ['#9b1c1c', '#1d3f8f', '#1c1c1e']);
    const jit = (i) => hash2(i, 17, ctx.seed) * 2 - 1;
    const p = phone(r, false);
    const b = { ...brush(r, ctx.seed), style: 'plain' };
    s += b.def + painted(b, 'kalam', hi, { x: x + w / 2, y: y + h * 0.36, maxW: w - 20, size: h * 0.34, jitter: jit }, fg, null);
    // (the English line only where the street's boards carry English too)
    const eng = ctx.kit !== 'gali' || r() < 0.4;
    if (eng) s += painted(b, 'alfa', en, { x: x + w / 2, y: y + h * 0.66, maxW: w - 30, size: h * 0.26, jitter: jit }, fg, null, false);
    s += painted(b, 'kalam', p, { x: x + w / 2, y: y + h * (eng ? 0.93 : 0.8), maxW: w - 40, size: h * 0.24 }, fg, null, false);
    if (eng) s += `<rect x="${x + 14}" y="${y + h * 0.71}" width="${w - 28}" height="3" fill="${fg}" opacity="0.8"/>`;
    extra.push(hi, ...(eng ? [en] : []), p);
    return { svg: s, extra, wear: { mat: 'wallpaint', bg: [255, 255, 255], screws: [], wear: Math.min(1.1, st.wear * (0.8 + r() * 0.5)) } };
  }
  // a ragged sheet: the corners and edges torn by hand, never a clean rectangle
  const sheet = (px, py, pw, ph, tear) => {
    const pts = [];
    const n = 7;
    for (let i = 0; i <= n; i++) pts.push([px + (pw * i) / n, py + (i === 0 || i === n ? 0 : r() * 2.5)]);
    for (let i = 1; i <= n; i++) pts.push([px + pw - (i === n ? 0 : r() * 2.5), py + (ph * i) / n]);
    for (let i = 1; i <= n; i++) pts.push([px + pw - (pw * i) / n, py + ph - (i === n ? 0 : r() * 3)]);
    for (let i = 1; i < n; i++) pts.push([px + r() * 2.5, py + ph - (ph * i) / n]);
    // a torn corner
    if (tear > 0) {
      const k = Math.floor(r() * 4);
      const cx = k % 2 ? px + pw : px;
      const cy = k > 1 ? py + ph : py;
      for (const q of pts) {
        const d = Math.abs(q[0] - cx) + Math.abs(q[1] - cy);
        if (d < tear) {
          q[0] += (px + pw / 2 - q[0]) * (1 - d / tear) * 0.9;
          q[1] += (py + ph / 2 - q[1]) * (1 - d / tear) * 0.9;
        }
      }
    }
    return pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  };
  const papers = ['#f3eedc', '#f2d64b', '#f0b6c4', '#d8e7f0', '#efe7cf', '#bfe3c0'];
  // the layer under: scraps of older notices, mostly torn away, grey and yellowed
  const old = Math.round(st.wear * 4 * r());
  for (let i = 0; i < old; i++) {
    const pw = 26 + r() * 50;
    const ph = 16 + r() * 40;
    const px = x + 6 + r() * (w - pw - 12);
    const py = y + 6 + r() * (h - ph - 12);
    s += `<polygon points="${sheet(px, py, pw, ph, Math.min(pw, ph) * 1.2)}" fill="${shade(pick(r, papers), 0.82)}" opacity="0.9" transform="rotate(${((r() - 0.5) * 16).toFixed(1)} ${px + pw / 2} ${py + ph / 2})"/>`;
    for (let l = 0; l < 2; l++) s += `<rect x="${px + 5}" y="${py + 6 + l * 7}" width="${pw * 0.5}" height="2.5" fill="#3a3a3a" opacity="0.35" transform="rotate(${((r() - 0.5) * 10).toFixed(1)} ${px + pw / 2} ${py + ph / 2})"/>`;
  }
  const k = 1 + Math.floor(r() * 3);
  for (let i = 0; i < k; i++) {
    const pw = 64 + r() * 44;
    const ph = 74 + r() * 34;
    const px = x + 8 + i * ((w - 16 - pw) / Math.max(1, k - 1 || 1)) + (k === 1 ? (w - 16 - pw) / 2 : 0);
    const py = y + 6 + r() * (h - ph - 12);
    const paper = pick(r, papers);
    const rot = (r() - 0.5) * 9;
    const [hi, en] = NOTICES[(idx * 3 + i * 5 + Math.floor(r() * 4)) % NOTICES.length];
    s += `<g transform="rotate(${rot.toFixed(1)} ${px + pw / 2} ${py + ph / 2})"><polygon points="${sheet(px + 2, py + 2.5, pw, ph, 0)}" fill="#3b352c" opacity="0.28"/><polygon points="${sheet(px, py, pw, ph, r() < st.wear ? 14 + r() * 22 : 0)}" fill="${paper}"/>`;
    // a printed head band, as photocopied notices have
    s += `<rect x="${px + 5}" y="${py + 6}" width="${pw - 10}" height="20" fill="${pick(r, ['#1c1c1e', '#b3261e', '#1d3f8f'])}" opacity="0.85"/>`;
    s += fitLine('mukta', hi, { x: px + pw / 2, y: py + 22, maxW: pw - 14, size: 16, attrs: `fill="${paper}"` }).svg;
    s += fitLine('oswald', en.toUpperCase(), { x: px + pw / 2, y: py + 42, maxW: pw - 10, size: 13, attrs: 'fill="#b3261e"' }).svg;
    for (let l = 0; l < 3; l++) s += `<rect x="${px + 8}" y="${py + 49 + l * 7}" width="${pw - 16 - (l % 2) * 12}" height="3" fill="#2c2c2c" opacity="0.55"/>`;
    // tear-off strips with the number along the bottom, some already taken
    for (let t = 0; t < 5; t++) s += r() > st.wear * 0.5 ? `<rect x="${px + 3 + (t * (pw - 6)) / 5}" y="${py + ph - 13}" width="${(pw - 6) / 5 - 2}" height="11" fill="${paper}" stroke="#555" stroke-width="0.7"/>` : `<rect x="${px + 2 + (t * (pw - 6)) / 5}" y="${py + ph - 12}" width="${(pw - 6) / 5}" height="16" fill="#ffffff"/>`;
    s += `<rect x="${px + pw / 2 - 9}" y="${py - 3}" width="18" height="7" fill="#d8d2c0" opacity="0.9"/></g>`;
    extra.push(hi, en);
  }
  return { svg: s, extra, wear: { mat: 'paper', bg: [255, 255, 255], screws: [], wear: st.wear } };
}

const DRAW = { fascia, flex, glow, wall, vertical, enamel, small, notice };

// ------------------------------------------------------------------ wear (raster pass over one cell)
// Fix round 3 (verifier: wear did not read at 5 to 20 m): every mark is sized in metres (PPM) and big enough for the
// driving camera: rust runs 3 to 8 cm wide and up to the board's height from every screw and bracket, a ragged rust band
// along the bottom edge, paint peeled in hand-sized and larger sheets to an older coat (another colour, with the ghost of
// its lettering) or bare tin, one end of the board bleached by the sun, dust on the top lip with dirt runs under it, a
// bent corner; flex bleaches at one end, sags between its ties, tears at a corner and has holes; acrylic yellows, holds
// dirt along the bottom and has a dead tube. The amount is the kit's wear times the board's age (ageOf).
const RUST = [[112, 54, 24], [160, 84, 36], [84, 42, 22]];
const OLD_PAINT = [[[196, 176, 110], [96, 40, 32]], [[150, 62, 52], [226, 214, 180]], [[88, 116, 150], [222, 220, 208]], [[204, 198, 180], [70, 84, 120]], [[96, 132, 104], [214, 204, 170]]];
function wearCell(buf, W, g, cx0, cy0, spec, seed) {
  const { mat } = spec;
  const wear = Math.max(0, Math.min(1.35, spec.wear));
  const w1 = Math.min(1, wear);
  const w = g.w;
  const h = g.h;
  const m = PPM[g.id] || 200;
  const key = mat === 'wallpaint' || mat === 'paper' || mat === 'enamel';
  const behind = mat === 'flex' ? [78, 72, 64] : [128, 126, 120];
  const s = seed;
  const hs = (a, b) => hash2(a, b, s + 300);
  const side = hs(3, 5) < 0.5;
  const darkGround = luma(spec.bg) < 120;
  const dustC = darkGround ? [178, 160, 128] : [116, 100, 78];
  const runC = darkGround ? [164, 148, 120] : [78, 66, 52];
  const paintMat = mat === 'tin' || mat === 'wood' || mat === 'enamel';
  // the peel field of the whole cell, and the level that peels the wanted share of the board
  let pf = null;
  let thr = 9;
  if (paintMat && wear > 0.05) {
    pf = new Float32Array(w * h);
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const edge = Math.min(px, w - 1 - px, py, h - 1 - py) / m;
        pf[py * w + px] = fbm(px / (0.3 * m), py / (0.2 * m), s + 41, 3) * 0.8 + fbm(px / (0.06 * m), py / (0.06 * m), s + 43, 2) * 0.2 + sstep(0.07, 0.0, edge) * 0.1 + (py / h) * 0.05;
      }
    // (the name stays readable: at most three tenths of the oldest board has gone)
    const share = Math.min(0.26, Math.pow(wear, 1.6) * (mat === 'enamel' ? 0.1 : 0.18));
    const sorted = Float32Array.from(pf).sort();
    thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - share)))];
  }
  // what shows under the paint: an older coat in another colour with the ghost of its lettering, or the bare sheet
  const oldCoat = mat === 'tin' && hs(7, 9) < 0.55 ? OLD_PAINT[Math.floor(hs(8, 1) * OLD_PAINT.length) % OLD_PAINT.length] : null;
  // rust runs: every screw, and the two strap brackets on the top edge (wider)
  const runs = [];
  if (mat === 'tin' || mat === 'enamel') {
    for (const [sx, sy] of spec.screws) runs.push({ x: sx - cx0, y: sy - cy0, wd: (0.016 + 0.022 * hs(Math.round(sx), 1)) * m, len: (0.12 + 0.5 * hs(Math.round(sx), Math.round(sy))) * m * Math.min(1.2, wear * 1.3), screw: true });
    for (const [sx, sy] of spec.brackets || []) runs.push({ x: sx - cx0, y: sy - cy0, wd: (0.03 + 0.03 * hs(Math.round(sx), 2)) * m, len: (0.3 + 0.45 * hs(Math.round(sx), 3)) * m * Math.min(1.2, wear * 1.3), screw: false });
  }
  // flex: ties every 45 cm; some spans of the bottom hem ride up, one span of the top hem has dropped, a corner is torn
  const tie = 0.45 * m;
  const spans = Math.ceil(w / tie) + 1;
  const sagB = [];
  const sagT = [];
  for (let i = 0; i < spans; i++) {
    sagB.push(mat === 'flex' && hs(i, 31) < 0.25 + wear * 0.45 ? (0.015 + 0.07 * hs(i, 32)) * m * w1 : 0);
    sagT.push(0);
  }
  if (mat === 'flex' && spec.tear && hs(9, 33) < 0.5) sagT[Math.floor(hs(1, 33) * (spans - 1))] = (0.04 + 0.08 * hs(2, 33)) * m * w1;
  const tearR = mat === 'flex' && spec.tear ? (0.24 + 0.4 * hs(4, 33)) * m * w1 : 0;
  // the eyelets rust: a brown run down the sheet under some of the ties
  if (mat === 'flex') for (let i = 0; i < spans; i++) if (hs(i, 38) < 0.2 + 0.45 * w1) runs.push({ x: i * tie + 0.04 * m, y: 4, wd: (0.012 + 0.016 * hs(i, 39)) * m, len: (0.12 + 0.4 * hs(i, 40)) * m * Math.min(1.2, wear * 1.3), screw: false });
  const tearX = hs(5, 33) < 0.5 ? 0 : w;
  const holes = [];
  if (mat === 'flex') for (let i = 0; i < Math.floor(wear * 3.2 * hs(6, 33) + 0.3); i++) holes.push([w * (0.1 + 0.8 * hs(i, 34)), h * (0.15 + 0.7 * hs(i, 35)), (0.022 + 0.05 * hs(i, 36)) * m]);
  const deadU = spec.dead ? 0.08 + 0.55 * hs(1, 37) : -1;
  const band = spec.band || 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = ((cy0 + py) * W + cx0 + px) * 4;
      let c = [buf[i], buf[i + 1], buf[i + 2]];
      if (key && c[0] >= 250 && c[1] >= 250 && c[2] >= 250) continue;
      const u = px / w;
      const v = py / h;
      // inside the round enamel disc only
      if (spec.disc) {
        const d = Math.hypot(cx0 + px - spec.disc[0], cy0 + py - spec.disc[1]);
        if (d > spec.disc[2] + 0.5) continue;
      }
      const big = fbm(px / (0.5 * m), py / (0.5 * m), s, 2);
      const mid = fbm(px / (0.08 * m), py / (0.08 * m), s + 5, 2);
      const fine = hash2(px, py, s + 9);
      const edgeM = Math.min(px, w - 1 - px, py, h - 1 - py) / m;
      const inBand = band > 0 && Math.min(px, w - 1 - px, py, h - 1 - py) < band;
      // ---- sun: one end of the board has lost its colour (reds go pink, blues grey), the top more than the bottom
      const t = side ? u : 1 - u;
      const matK = { acrylic: 0.3, flex: 0.9, tin: 1, wood: 0.9, enamel: 0.45, paper: 0.5, wallpaint: 0.7 }[mat] || 1;
      const bleach = Math.min(0.82, wear * matK * (0.1 + 0.8 * Math.pow(sstep(0.05, 0.95, t), 1.3) * (0.55 + 0.9 * big)) * (1.12 - 0.3 * v));
      const l = luma(c);
      const pale = [150 + 0.42 * l, 150 + 0.42 * l, 150 + 0.42 * l];
      if (mat === 'flex') {
        // printed inks: magenta and yellow go first, the sheet turns a cold pale blue grey
        pale[0] -= 14;
        pale[2] += 8;
      }
      if (!inBand) for (let k = 0; k < 3; k++) c[k] += (Math.min(240, pale[k]) - c[k]) * bleach;
      if (mat === 'acrylic') {
        // yellowed plastic, a dead tube behind part of the face, dirt lying inside along the bottom
        c[2] *= 1 - 0.2 * w1;
        c[1] *= 1 - 0.05 * w1;
        if (deadU >= 0) {
          const dz = sstep(deadU - 0.04, deadU + 0.02, u) * (1 - sstep(deadU + 0.26, deadU + 0.32, u));
          for (let k = 0; k < 3; k++) c[k] *= 1 - 0.58 * dz;
        }
        const lie = sstep(1 - (0.05 + 0.06 * vnoise(px / (0.2 * m), 1.5, s + 61)) * (m / h), 1.0, v) * w1;
        for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - 0.55 * lie) + 58 * 0.55 * lie;
      }
      if (mat === 'flex') {
        // wrinkles from the ties and the sag: soft light and dark bands
        const wr = Math.sin((u * (w / m) * 2.2 + v * 1.4 + vnoise(u * 5, v * 3, s) * 1.6) * Math.PI * 2) * 0.11 * Math.min(1, wear * 1.3);
        const fold = Math.sin((v * 2.3 + vnoise(u * 3, v * 2, s + 3) * 1.2) * Math.PI * 2) * 0.05 * w1;
        for (let k = 0; k < 3; k++) c[k] *= 1 + wr + fold;
        // a film of street dust and exhaust over the whole sheet, thicker in clouds
        const film = Math.min(0.5, w1 * (0.12 + 0.3 * big));
        for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - film) + [146, 130, 104][k] * film;
      }
      // ---- dust on the top lip, dirt runs under it, grime along the bottom and in the corners
      const lip = sstep(0.1 * m, 0.012 * m, py) * (0.75 + 0.25 * mid);
      const col1 = vnoise(px / (0.045 * m), 0.5, s + 21);
      const runLen = (0.12 + 0.75 * vnoise(px / (0.11 * m), 3.5, s + 22)) * m;
      const run = sstep(0.56, 0.78, col1) * (1 - sstep(runLen * 0.35, runLen, py)) * (0.65 + 0.35 * mid);
      const corner = sstep(0.16 * m, 0.0, Math.min(px, w - 1 - px)) * sstep(0.16 * m, 0.0, Math.min(py, h - 1 - py));
      const foot = sstep(h - 0.07 * m, h, py) * 0.5;
      const dK = mat === 'acrylic' ? 0.7 : mat === 'paper' ? 0.5 : 1;
      const dust = Math.min(0.85, w1 * dK * Math.max(lip * 0.85, corner * 0.7, foot));
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - dust) + dustC[k] * dust;
      const rn = Math.min(0.8, w1 * dK * run * (mat === 'flex' ? 0.85 : 0.62));
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - rn) + runC[k] * rn;
      if (pf) {
        // ---- peeled paint: a sheet has come away; a light lifted lip above it, a shadow inside its upper edge
        const f = pf[py * w + px];
        const peel = sstep(thr, thr + 0.012, f);
        const lipUp = sstep(thr - 0.03, thr, f) * (1 - peel);
        if (peel > 0) {
          let under;
          if (mat === 'wood') {
            const grain = Math.sin(py * 0.9 + vnoise(px / 30, py / 6, s) * 6) * 12;
            under = [112 + grain, 80 + grain, 54 + grain];
          } else if (oldCoat) {
            // the older board: its ground, and broad strokes of its lettering in the middle band
            const ghost = sstep(0.52, 0.6, vnoise(px / (0.07 * m), py / (0.25 * m), s + 47)) * sstep(0.2, 0.3, v) * (1 - sstep(0.7, 0.8, v));
            under = oldCoat[0].map((b, k) => b + (oldCoat[1][k] - b) * ghost * 0.8);
          } else {
            const ru = sstep(0.42, 0.7, fbm(px / (0.09 * m), py / (0.09 * m), s + 51, 2));
            const rc = RUST[Math.floor(fine * 2.99)];
            under = behind.map((b, k) => b + (rc[k] - b) * ru);
          }
          const inner = 1 - 0.38 * (1 - sstep(thr, thr + 0.035, f));
          for (let k = 0; k < 3; k++) c[k] += (under[k] * inner - c[k]) * peel;
        }
        for (let k = 0; k < 3; k++) c[k] += (238 - c[k]) * lipUp * 0.38;
        if (mat === 'enamel') {
          // enamel chips: black steel with a rust ring, a few centimetres across
          const cs = 0.045 * m;
          const gx = Math.floor(px / cs);
          const gy = Math.floor(py / cs);
          if (hash2(gx, gy, s + 61) > 1 - wear * 0.035) {
            const dd = Math.hypot(px - (gx + 0.3 + 0.4 * hash2(gx, gy, s + 63)) * cs, py - (gy + 0.3 + 0.4 * hash2(gx, gy, s + 64)) * cs) / cs * (0.8 + 0.4 * vnoise(px / 5, py / 5, s + 65));
            const rr = 0.1 + 0.22 * hash2(gx, gy, s + 62);
            if (dd < rr) c = [30, 30, 38];
            else if (dd < rr + 0.12) c = c.map((v0, k) => (v0 + RUST[1][k] * 2) / 3);
          }
        }
      }
      if (runs.length) {
        // ---- rust: runs down from each screw and bracket, a ragged band along the bottom edge, thin lines up the sides
        let rs = 0;
        let core = 0;
        for (const rn2 of runs) {
          const lx = px - rn2.x;
          const ly = py - rn2.y;
          if (ly < -3 || ly > rn2.len) continue;
          const wob = Math.sin(ly * 0.11 + rn2.x) * rn2.wd * 0.25;
          const wd = rn2.wd * (1 + (ly / rn2.len) * 0.5);
          const across = sstep(wd, wd * 0.25, Math.abs(lx + wob));
          const along = Math.pow(Math.max(0, 1 - ly / rn2.len), 0.75);
          const a = across * along * (0.7 + 0.3 * vnoise(px / 3, py / 5, s + 71));
          rs = Math.max(rs, a);
          core = Math.max(core, sstep(wd * 0.45, 0, Math.abs(lx + wob)) * along);
          if (rn2.screw && Math.hypot(lx, ly) < 0.011 * m) rs = Math.max(rs, 1.5);
        }
        if (mat === 'tin') {
          const hb = (0.012 + 0.085 * fbm(px / (0.22 * m), 1.3, s + 73, 2)) * m * Math.min(1.25, wear * 1.2) * (0.8 + 0.4 * mid);
          rs = Math.max(rs, sstep(hb, hb * 0.55, h - 1 - py) * 0.95);
          rs = Math.max(rs, sstep(0.02 * m, 0.006 * m, Math.min(px, w - 1 - px)) * 0.7 * (0.5 + big));
          // blooms on an old sheet
          if (wear > 0.75) rs = Math.max(rs, sstep(0.7, 0.8, fbm(px / (0.06 * m), py / (0.06 * m), s + 77, 2)) * 0.6 * (wear - 0.5));
        }
        if (rs > 0) {
          const a = Math.min(0.93, rs * (0.35 + 0.65 * w1));
          const rc = rs > 1.2 ? [38, 32, 28] : RUST[1].map((b, k) => b + (RUST[2][k] - b) * Math.min(1, core * 0.9 + (fine - 0.5) * 0.3));
          for (let k = 0; k < 3; k++) c[k] += (rc[k] - c[k]) * a;
        }
        // a bent corner: the sheet folds out along a slanted crease, dark in the fold and light on the lip
        if (spec.dent) {
          const dc = Math.hypot((u - (side ? 0.07 : 0.93)) * (w / h), v - 0.86);
          if (dc < 0.5) {
            const dn = Math.sin(Math.min(1, dc / 0.5) * Math.PI * 1.5);
            for (let k = 0; k < 3; k++) c[k] *= 1 + dn * 0.26 * (1 - dc / 0.5);
          }
        }
      }
      if (mat === 'flex') {
        // ---- the sheet has gone: under a hem that rides up, over a hem that dropped, a torn corner, holes
        const sp = Math.floor(px / tie);
        const fr = (px - sp * tie) / tie;
        const arc = Math.pow(Math.sin(fr * Math.PI), 0.8);
        const eb = h - 1 - sagB[sp] * arc;
        const et = sagT[sp] * arc;
        let gone = py > eb || py < et;
        let frayed = (py > eb - 2.5 && py <= eb && sagB[sp] > 0) || (py >= et && py < et + 3 && sagT[sp] > 0);
        // the dropped hem throws a shadow on the sheet under it
        if (!gone && sagT[sp] > 0 && py < et + 0.06 * m) for (let k = 0; k < 3; k++) c[k] *= 0.72 + 0.28 * ((py - et) / (0.06 * m));
        if (tearR > 0) {
          const d = Math.hypot(px - tearX, (py - h) * 1.25);
          const rr = tearR * (0.82 + 0.36 * vnoise(px / (0.06 * m), py / (0.06 * m), s + 81));
          if (d < rr) gone = true;
          else if (d < rr + 3) frayed = true;
        }
        for (const [hx, hy, hr] of holes) {
          const d = Math.hypot(px - hx, py - hy);
          const rr = hr * (0.6 + 0.8 * vnoise(px / (0.02 * m), py / (0.02 * m), s + 83));
          if (d < rr) gone = true;
          else if (d < rr + 2.2) frayed = true;
        }
        if (gone) c = behind.map((b) => b + (mid - 0.5) * 14);
        else if (frayed) c = c.map((v0) => v0 + (226 - v0) * 0.6);
      }
      if (mat === 'wallpaint' || mat === 'paper') {
        // painted letters flake off the wall in patches (back to the key: the wall shows); paper yellows and tears
        const fl = fbm(px / (0.05 * m), py / (0.05 * m), s + 91, 3);
        if (fl > 1.0 - w1 * (mat === 'paper' ? 0.3 : 0.37)) {
          buf[i] = 255;
          buf[i + 1] = 255;
          buf[i + 2] = 255;
          continue;
        }
        if (mat === 'paper') {
          c[2] *= 1 - 0.22 * w1;
          c[1] *= 1 - 0.06 * w1;
          // damp stains
          const st2 = sstep(0.58, 0.7, fbm(px / (0.04 * m), py / (0.04 * m), s + 93, 2)) * w1;
          for (let k = 0; k < 3; k++) c[k] *= 1 - 0.25 * st2;
        }
      }
      // never pure white outside the keyed kinds (the key is white)
      for (let k = 0; k < 3; k++) buf[i + k] = Math.max(0, Math.min(key ? 244 : 250, Math.round(c[k] + (fine - 0.5) * 6)));
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
      if (out.mode) cell.scripts = out.mode;
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
