// Independent comparison of src/ui/texts.js with the code block of SPEC 4.28.8 (lines 2768-2803).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [spec, mod] = process.argv.slice(2);
const lines = readFileSync(spec, 'utf8').split(/\r?\n/).slice(2767, 2803);
if (!lines[0].startsWith('export const TXT') || lines[lines.length - 1] !== '};') throw new Error('block not found: ' + lines[0] + ' … ' + lines[lines.length - 1]);
const want = new Function(lines.join('\n').replace('export const TXT =', 'return') )();
const { TXT } = await import(pathToFileURL(mod).href);
let leaves = 0; const diffs = [];
const walk = (a, b, path) => {
  if (typeof a === 'function' || typeof b === 'function') {
    leaves++;
    if (typeof a !== 'function' || typeof b !== 'function') diffs.push(`${path}: type`);
    else for (const args of [[1, 2, 3], [34, 9, 1], [0, 0, 0]]) if (a(...args) !== b(...args)) diffs.push(`${path}(${args}): ${a(...args)} != ${b(...args)}`);
    return;
  }
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) { diffs.push(`${path}: shape`); return; }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join('|') !== kb.join('|')) diffs.push(`${path}: keys ${ka} vs ${kb}`);
    for (const k of ka) walk(a[k], b[k], `${path}.${k}`);
    return;
  }
  leaves++;
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};
walk(want, TXT, 'TXT');
const all = JSON.stringify(TXT) + TXT.over.stats(1, 2, 3);
console.log(JSON.stringify({ leaves, diffs, hasOffline: all.includes('离线'), keyOrderSame: JSON.stringify(Object.keys(want)) === JSON.stringify(Object.keys(TXT)) }));
