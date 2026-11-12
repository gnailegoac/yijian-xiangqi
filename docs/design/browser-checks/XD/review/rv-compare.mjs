// XD review: compares a measure=1 result with XA's two reference runs, field by field (the reviewer's own comparison).
import { readFileSync } from 'node:fs';
const load = p => JSON.parse(readFileSync(p, 'utf8'));
const mine = load(process.argv[2]);
const refs = process.argv.slice(3).map(load);
const walk = (a, b, path, out) => {
  if (typeof a === 'number' && typeof b === 'number') { out.n++; const d = Math.abs(a - b); if (d > out.max) { out.max = d; out.at = path; } if (d > 0) out.differ++; return; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (a !== b) out.other.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); return; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a) || !(k in b)) { out.other.push(`${path}.${k}: only in one`); continue; }
    walk(a[k], b[k], `${path}.${k}`, out);
  }
};
const strip = r => { const { wallMs, prerenderMs, ...rest } = r; return rest; };       // timings are not levels
console.log(`mine: ok ${mine.ok}, problems ${JSON.stringify(mine.problems)}, rows sfx ${mine.sfx.length} bed ${mine.bed.length} mix ${mine.mix.length}, wall ${mine.wallMs} ms, prerender ${mine.prerenderMs} ms, lead ${mine.lead}`);
refs.forEach((ref, i) => {
  const out = { n: 0, max: 0, at: '', differ: 0, other: [] };
  walk(strip(mine), strip(ref), '', out);
  console.log(`vs reference ${i + 1}: ${out.n} numeric fields, ${out.differ} differ, largest difference ${out.max} at ${out.at}; other differences: ${out.other.length ? out.other.join(' | ') : 'none'}`);
});
if (refs.length === 2) { const out = { n: 0, max: 0, at: '', differ: 0, other: [] }; walk(strip(refs[0]), strip(refs[1]), '', out); console.log(`reference 1 vs reference 2: ${out.n} fields, ${out.differ} differ, largest ${out.max}`); }
console.log('loudest effect in play', Math.max(...mine.sfx.map(s => s.worst)).toFixed(2), 'dBFS; loudest mix', Math.max(...mine.mix.flatMap(m => [m.chibi, m.longzhong, m.shachang])).toFixed(2), 'dBFS');
