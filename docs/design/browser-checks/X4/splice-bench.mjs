// One-off: replaces the bench section of dev/audio.html with bench-new.txt.
import { readFileSync, writeFileSync } from 'node:fs';
const page = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/audio.html';
let s = readFileSync(page, 'utf8');
const neu = readFileSync(new URL('./bench-new.txt', import.meta.url), 'utf8').replace(/\r/g, '');
const a = s.indexOf('  // ---- the page ----');
const b = s.indexOf('  } catch (error) {', a);
if (a < 0 || b < 0) throw new Error('markers not found');
s = s.slice(0, a) + neu + s.slice(b);
const r1 = '    const created = seen.length - before;';
if (!s.includes(r1)) throw new Error('r1');
if (!s.includes('const firstStart')) s = s.replace(r1, r1 + '\n    const firstStart = Math.min(...seen.slice(before).map(rec => rec.s));');
const r2 = '    return { buffer, created, live, unlockMs };';
if (s.includes(r2)) s = s.replace(r2, '    return { buffer, created, firstStart, live, unlockMs };');
writeFileSync(page, s.replace(/\r/g, ''));
console.log('spliced', s.length);
