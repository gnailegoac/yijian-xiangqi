// Tiny exact-replace helper: node edit.mjs <file> <<< JSON [[old, new], ...]; keeps LF endings.
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2];
let s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const pairs = JSON.parse(readFileSync(process.argv[3], 'utf8'));
for (const [a, b] of pairs) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error(`expected exactly one match, found ${n}: ${a.slice(0, 80)}`); process.exit(1); }
  s = s.replace(a, () => b);
}
writeFileSync(file, s);
console.log(`ok ${pairs.length} edits in ${file}`);
