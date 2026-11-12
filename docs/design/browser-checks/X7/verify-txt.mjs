// Compares src/ui/texts.js TXT with the code block of SPEC 4.28.8 (deep equality; the stats function by output and source).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const spec = readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const start = spec.findIndex(l => l.startsWith('export const TXT = {'));
let end = start; while (!spec[end].startsWith('};')) end++;
const src = spec.slice(start, end + 1).join('\n').replace('export const TXT =', 'return');
const want = new Function(src.replace(/;\s*$/, ''))();
const { TXT } = await import(pathToFileURL(process.argv[3]).href);
let diffs = 0, leaves = 0;
const walk = (a, b, path) => {
  if (typeof a === 'function' || typeof b === 'function') {
    leaves++;
    const args = [[34, 9, 1], [0, 0, 0], [120, 15, 3]];
    for (const x of args) if (a(...x) !== b(...x)) { diffs++; console.log('DIFF fn', path, a(...x), b(...x)); }
    return;
  }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b ?? {});
    if (Array.isArray(a) !== Array.isArray(b)) { diffs++; console.log('DIFF kind', path); }
    if (ka.join('|') !== kb.join('|')) { diffs++; console.log('DIFF keys', path, ka, kb); }
    for (const k of ka) walk(a[k], b?.[k], `${path}.${k}`);
    return;
  }
  leaves++;
  if (a !== b) { diffs++; console.log('DIFF', path, JSON.stringify(a), JSON.stringify(b)); }
};
walk(want, TXT, 'TXT');
const all = JSON.stringify(TXT, (k, v) => typeof v === 'function' ? v(1, 2, 3) : v);
console.log(JSON.stringify({ leaves, diffs, hasLixian: all.includes('离线') }));
process.exit(diffs ? 1 : 0);
