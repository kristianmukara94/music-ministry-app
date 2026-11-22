// Rebuilds web/js/ordo-citations.js from the laptop's Ordo (src/data/lectionary_ordo.json): the references only, no names and no texts.
// Run after the Ordo changes: node scripts/build-web-ordo-citations.mjs   (server/test/web-planner-calendar.test.mjs keeps the two equal)
import fs from 'node:fs';

const ordo = JSON.parse(fs.readFileSync(new URL('../src/data/lectionary_ordo.json', import.meta.url), 'utf8')).days;
const FIELDS = ['r1', 'ps', 'r2', 'acc', 'gos'];
const pick = (entry) => Object.fromEntries(FIELDS.filter((f) => typeof entry[f] === 'string' && entry[f].trim()).map((f) => [f, entry[f]]));
const days = {};
for (const [code, entry] of Object.entries(ordo)) {
  const day = pick(entry);
  for (const cycle of ['A', 'B', 'C', 'I', 'II']) if (entry[cycle] && typeof entry[cycle] === 'object' && Object.keys(pick(entry[cycle])).length) day[cycle] = pick(entry[cycle]);
  if (Object.keys(day).length) days[code] = day;
}
const target = new URL('../web/js/ordo-citations.js', import.meta.url);
const current = fs.readFileSync(target, 'utf8');
const head = current.slice(0, current.indexOf('export const ORDO_CITATIONS'));
const lines = Object.entries(days).map(([code, day]) => `  ${JSON.stringify(code)}: ${JSON.stringify(day)},`);
fs.writeFileSync(target, `${head}export const ORDO_CITATIONS = {\n${lines.join('\n')}\n};\n`);
console.log(`${Object.keys(days).length} days written to web/js/ordo-citations.js`);
