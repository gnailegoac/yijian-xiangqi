// XD: is a run of dev/audio.html?measure=1 with the engine of this package the same, number for number, as XA's runs?
// Usage: node compare-xa.mjs <mine.json> <reference.json> [<reference2.json> ...]
// Every numeric field of every row (sfx, bed, mix) is compared; prerenderMs and wallMs are timings and are only printed.
import { readFileSync } from 'node:fs';

const load = f => JSON.parse(readFileSync(f, 'utf8'));
const mine = load(process.argv[2]);
for (const ref of process.argv.slice(3)) {
  const other = load(ref);
  let fields = 0, different = 0, largest = 0;
  const notes = [];
  for (const table of ['sfx', 'bed', 'mix']) {
    const key = row => row.name ?? row.label;
    if (mine[table].length !== other[table].length) notes.push(`${table}: ${mine[table].length} rows vs ${other[table].length}`);
    for (const row of mine[table]) {
      const o = other[table].find(x => key(x) === key(row));
      if (!o) { notes.push(`${table} ${key(row)}: not in the reference`); continue; }
      for (const k of new Set([...Object.keys(row), ...Object.keys(o)])) {
        const a = row[k], b = o[k];
        fields++;
        if (typeof a === 'number' && typeof b === 'number') {
          const d = Math.abs(a - b);
          if (d > 0) { different++; largest = Math.max(largest, d); if (notes.length < 12) notes.push(`${table} ${key(row)}.${k}: ${a} vs ${b}`); }
        } else if (JSON.stringify(a) !== JSON.stringify(b)) {
          different++;
          if (notes.length < 12) notes.push(`${table} ${key(row)}.${k}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
      }
    }
  }
  console.log(`vs ${ref.split(/[\\/]/).slice(-2).join('/')}: ok ${mine.ok}/${other.ok}, problems ${mine.problems.length}/${other.problems.length}, lead ${mine.lead === other.lead ? 'same' : 'DIFFERENT'}, ` +
    `${fields} fields compared, ${different} different (largest difference ${largest}); prerenderMs ${mine.prerenderMs} vs ${other.prerenderMs}, wallMs ${mine.wallMs} vs ${other.wallMs}`);
  for (const n of notes) console.log('   ', n);
}
const loudest = Math.max(...mine.sfx.map(s => s.worst));
const mixMax = Math.max(...mine.mix.flatMap(m => [m.chibi, m.longzhong, m.shachang]));
console.log(`mine: loudest single effect in play ${loudest.toFixed(2)} dBFS; loudest stack ${mixMax.toFixed(2)} dBFS; bed rows ${mine.bed.map(b => `${b.label}:${b.rmsLikeContract?.toFixed(2)}`).join(' ')}`);
