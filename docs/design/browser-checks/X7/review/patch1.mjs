// One-off edit helper for the reviewer: exact, single-occurrence replacements in a file (fails loudly otherwise).
import { readFileSync, writeFileSync } from 'node:fs';
const [file, specFile] = process.argv.slice(2);
let text = readFileSync(file, 'utf8');
const edits = JSON.parse(readFileSync(specFile, 'utf8'));
for (const [i, e] of edits.entries()) {
  const n = text.split(e.old).length - 1;
  if (n !== 1) throw new Error(`edit ${i}: ${n} occurrences of ${JSON.stringify(e.old.slice(0, 80))}`);
  text = text.replace(e.old, () => e.new);
}
if (text.includes('\r')) throw new Error('CR in output');
writeFileSync(file, text);
console.log(`applied ${edits.length} edits to ${file}`);
