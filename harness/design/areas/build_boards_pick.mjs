// node build_boards_pick.mjs <area> <from> i,j,k ["note"]  -> adds picks (by title) from list_<area>_<from>.json to picks.json
import fs from 'node:fs';
const [area, from, idx, note = ''] = process.argv.slice(2);
const root = new URL('../../reports/areaphotos/', import.meta.url).pathname;
const list = JSON.parse(fs.readFileSync(root + `list_${process.env.LIST || area}_${from}.json`, 'utf8'));
const pf = root + 'picks.json'; const picks = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
const a = picks[area] ||= {};
for (const n of idx.split(',').map(Number)) { const c = list.find(x => x.i === n); if (!c) { console.log('missing', n); continue; } a[c.title] = { ...c, note: note || a[c.title]?.note || '' }; }
fs.writeFileSync(pf, JSON.stringify(picks, null, 1)); console.log(area, Object.keys(a).length);
