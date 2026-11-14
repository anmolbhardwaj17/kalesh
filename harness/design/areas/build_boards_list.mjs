import fs from 'node:fs';
const area = process.argv[2];
const j = JSON.parse(fs.readFileSync(new URL('../../reports/areaphotos/candidates.json', import.meta.url).pathname, 'utf8'))[area];
const PLACE = /delhi|chandni|connaught|janpath|jantar|kartavya|rajpath|india gate|paharganj|ajmeri|red fort|lal qila|\bito\b|pragati|bharat mandapam|sansad|parliament|barakhamba|fatehpuri|sisganj|sis ganj|jama masjid|asaf ali|kinari|dariba|khari baoli|chawri|ballimaran|kasturba|netaji|tolstoy|central vista|vikas marg|shraddhanand|g\.? ?b\.? road|nehru|raisina/i;
const EXCL = /geograph|london|bristol|england|hong kong|HK Central|himachal|pune|mumbai|rayleigh|silvertown|knowle|tyburn|food|rabri|kulfi|chaat|burger|dosa|platter|thali|biryani|lassi|plate|breakfast|dinner|lunch|paratha|interior|ceiling|dome|painting|inscription|plant|flower|bird/i;
const rows = Object.values(j).filter(c => (c.cat || PLACE.test(c.title + ' ' + c.desc)) && !EXCL.test(c.title)).sort((a, b) => a.title.localeCompare(b.title));
rows.forEach((c, i) => console.log(i, c.year, c.title.replace('File:', '').slice(0, 70), '|', c.desc.slice(0, 50)));
console.log(rows.length);
