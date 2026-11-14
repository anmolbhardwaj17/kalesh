// Reads and writes harness/data/access.json (P2-043) in the file's hand-kept shape: a value whose one-line form fits
// in 200 characters stays on one line (modes, match, a circle), a longer one is spread over lines. The bake, the judge
// pass (tools/inspector/accessjudge.mjs), the metro zone generator and the inspector server all write through here,
// so a change to one rule is a small diff.
import fs from 'node:fs';

const WIDTH = 200;

export function formatJson(v, indent = 0) {
  const pad = '  '.repeat(indent);
  const inline = (x) => {
    if (Array.isArray(x)) return `[${x.map(inline).join(', ')}]`;
    if (x !== null && typeof x === 'object') {
      const e = Object.entries(x);
      return e.length ? `{ ${e.map(([k, y]) => `${JSON.stringify(k)}: ${inline(y)}`).join(', ')} }` : '{}';
    }
    return JSON.stringify(x);
  };
  const one = inline(v);
  if (typeof v !== 'object' || v === null || one.length + pad.length + 14 <= WIDTH) return one;
  if (Array.isArray(v)) return `[\n${v.map((x) => `${pad}  ${formatJson(x, indent + 1)}`).join(',\n')}\n${pad}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${formatJson(x, indent + 1)}`).join(',\n')}\n${pad}}`;
}

/** The file as text: the top level and every rule and zone always spread, the leaves as formatJson says. */
export function accessText(file) {
  const parts = [];
  for (const [k, v] of Object.entries(file)) {
    if ((k === 'rules' || k === 'zones') && Array.isArray(v)) {
      const items = v.map((r) => `    {\n${Object.entries(r).map(([a, b]) => `      ${JSON.stringify(a)}: ${formatJson(b, 3)}`).join(',\n')}\n    }`);
      parts.push(`  ${JSON.stringify(k)}: [\n${items.join(',\n')}\n  ]`);
    } else parts.push(`  ${JSON.stringify(k)}: ${formatJson(v, 1)}`);
  }
  return `{\n${parts.join(',\n')}\n}\n`;
}

export const readAccessFile = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeAccessFile = (file, data) => fs.writeFileSync(file, accessText(data));
