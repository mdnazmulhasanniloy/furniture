// Fails if two locale JSON files don't have identical key sets. Usage: node i18n-check.mjs en.json ar.json
import { readFileSync } from 'node:fs';
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const [a, b] = process.argv.slice(2).map(f => new Set(keys(JSON.parse(readFileSync(f, 'utf8')))));
const missB = [...a].filter(k => !b.has(k)), missA = [...b].filter(k => !a.has(k));
if (missA.length || missB.length) { console.error('Missing in 2nd:', missB, '\nMissing in 1st:', missA); process.exit(1); }
console.log(`i18n OK — ${a.size} keys`);
