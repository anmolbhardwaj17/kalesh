import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'game/data/names');
const areasDir = path.join(root, 'harness/design/areas');
const areas = fs.readdirSync(areasDir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));

// Real brands, chains, parties, people and well-known eateries that must never appear on a sign.
const BLOCK = [
  'mcdonald', 'kfc', 'domino', 'pizza hut', 'subway', 'starbucks', 'burger king', 'dunkin', 'baskin', 'haldiram', 'bikaner',
  'barista', 'cafe coffee day', 'costa', 'nike', 'adidas', 'puma', 'reebok', 'bata', 'woodland', 'fabindia', 'raymond', 'titan', 'tanishq',
  'reliance', 'tata', 'airtel', 'jio', 'vodafone', 'amul', 'maggi', 'nestle', 'britannia', 'parle', 'coca', 'pepsi', 'sprite', 'thums up',
  'oyo', 'uber', 'ola', 'zomato', 'swiggy', 'paytm', 'phonepe', 'amazon', 'flipkart', 'samsung', 'apple', 'sony', 'philips', 'nokia', 'xiaomi',
  'hdfc', 'sbi', 'icici', 'axis bank', 'pnb', 'lic ', 'indian oil', 'bharat petroleum', 'hindustan petroleum', 'mahindra', 'maruti', 'hero ',
  'bajaj', 'tvs', 'honda', 'toyota', 'ashok leyland', 'air india', 'indigo', 'spicejet', 'jet airways', 'oberoi', 'leela', 'itc', 'imperial',
  'taj ', 'hyatt', 'marriott', 'hilton', 'radisson', 'karim', 'kwality', 'moti mahal', 'gaylord', 'wenger', 'nirula', 'saravana', 'sagar ratna',
  'khan chacha', 'kake da', 'giani', 'ram ladoo', 'kuremal', 'ghantewala', 'natraj', 'jain coffee', 'paranthe wali', 'pind balluchi', 'oxford',
  'bjp', 'bharatiya', 'congress', 'aam aadmi', ' aap ', 'bsp', 'samajwadi', 'shiv sena', 'trinamool', 'cpi', 'rjd', 'jdu', 'ncp', 'akali',
  'gandhi ', 'nehru', 'modi', 'kejriwal', 'sonia', 'rahul', 'shah rukh', 'amitabh', 'sachin', 'ambani', 'adani',
  'ikea', 'zara', 'h&m', 'levi', 'lacoste', 'gucci', 'prada', 'louis', 'rolex', 'dell', 'hp ', 'lenovo', 'asus', 'whatsapp', 'google', 'facebook',
  'netflix', 'youtube', 'instagram', 'khadi bhandar', 'cottage emporium', 'central cottage', 'mother dairy', 'big bazaar', 'dmart', 'pantaloons',
  'lifestyle', 'westside', 'shoppers stop', 'croma', 'vijay sales', 'yamaha', 'suzuki', 'royal enfield', 'hindustan unilever', 'dabur', 'patanjali',
];
const BLOCK_DEVA = ['भाजपा', 'कांग्रेस', 'आम आदमी', 'बसपा', 'शिवसेना', 'गांधी', 'नेहरू', 'मोदी', 'केजरीवाल', 'हल्दीराम', 'करीम', 'मैकडॉनल्ड'];
// Real place names used as street or station boards (not brands, parties or people).
const REAL_PLACE_OK = new Set(['Kasturba Gandhi Marg', 'Bahadur Shah Zafar Marg']);

// A block entry matches at the start of a word; one with a trailing space must also end a word.
const hits = (text, b) => new RegExp('(^|[^a-z])' + b.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (b.endsWith(' ') ? '($|[^a-z])' : '')).test(text);
const load = id => JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));

describe('invented sign names', () => {
  it('has one file for every area sheet', () => {
    expect(areas.length).toBeGreaterThanOrEqual(11);
    for (const a of areas) expect(fs.existsSync(path.join(dir, a + '.json')), a).toBe(true);
  });

  for (const a of areas) {
    describe(a, () => {
      const d = load(a);
      it('has 60+ names and 8+ kinds with a positive weight', () => {
        expect(d.names.length).toBeGreaterThanOrEqual(60);
        expect(new Set(d.names.map(n => n.kind)).size).toBeGreaterThanOrEqual(8);
        for (const n of d.names) {
          expect(typeof n.kind).toBe('string');
          expect(n.weight).toBeGreaterThan(0);
          expect(n.text.latn?.length, JSON.stringify(n)).toBeGreaterThan(0);
        }
      });
      it('gives every Devanagari or Urdu name a Latin form', () => {
        for (const n of d.names) if (n.text.deva || n.text.arab) expect(n.text.latn, JSON.stringify(n)).toBeTruthy();
      });
      it('keeps each script in its own block and under 60 characters', () => {
        for (const n of d.names) {
          if (n.text.deva) expect(n.text.deva).toMatch(/[ऀ-ॿ]/);
          if (n.text.arab) expect(n.text.arab).toMatch(/[؀-ۿ]/);
          for (const v of Object.values(n.text)) {
            expect(v.length).toBeLessThanOrEqual(60);
            expect(v).not.toMatch(/—|–/);
          }
        }
      });
      it('has no duplicate names', () => {
        const s = d.names.map(n => n.text.latn.toLowerCase());
        expect(new Set(s).size).toBe(s.length);
      });
      it('carries no real brand, party, chain or person', () => {
        for (const n of d.names) {
          if (REAL_PLACE_OK.has(n.text.latn)) continue;
          const lat = n.text.latn.toLowerCase();
          for (const b of BLOCK) expect(hits(lat, b), `${a}: "${n.text.latn}" contains "${b}"`).toBe(false);
          if (n.text.deva) for (const b of BLOCK_DEVA) expect(n.text.deva.includes(b), `${a}: "${n.text.deva}" contains "${b}"`).toBe(false);
        }
      });
    });
  }
});
