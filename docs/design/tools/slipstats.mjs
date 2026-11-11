// slipstats.mjs <print dir>: slips (finisher moves of 500 cp or less from his move 60 on) per game, runs, sizes, and what follows.
import { readdirSync, readFileSync } from 'node:fs';
const dir = process.argv[2];
const ROW = /^\s*(\d+)\. (.+?) \((-?\d+)[^)]*\)\s+(\S+)(?: 吃\S)? \[(\w+) (\w+)(?: -(\d+))?[^\]]* L([\d.]+)\]/u;
let games = 0, withSlip = 0, slips = 0;
const perGame = {}, runs = {}, sizes = { '150-199': 0, '200-299': 0, '300-399': 0, '400-500': 0 }, firstAt = { '60': 0, '61-64': 0, '65-69': 0, '70-79': 0, '80+': 0 };
const toEnd = [];
const many = [];
for (const f of readdirSync(dir)) {
  if (f.startsWith('plain-')) continue;
  games++;
  const text = readFileSync(`${dir}/${f}`, 'utf8').split('\n');
  const result = /孩子胜/.test(text[0]) ? 'win' : /孩子负/.test(text[0]) ? 'loss' : 'draw';
  const rows = text.map(l => ROW.exec(l)).filter(Boolean).map(m => ({ no: +m[1], ev: +m[3], mode: m[5], kind: m[6], loss: +(m[7] ?? 0) }));
  const last = rows.length ? rows[rows.length - 1].no : 0;
  let n = 0, run = 0, best = 0, first = null;
  for (const r of rows) {
    const slip = r.no >= 60 && r.mode === 'finish' && r.kind === 'finisher' && r.loss > 0 && r.loss <= 500;
    if (slip) {
      n++; run++; best = Math.max(best, run);
      if (first === null) first = r.no;
      const k = r.loss < 200 ? '150-199' : r.loss < 300 ? '200-299' : r.loss < 400 ? '300-399' : '400-500';
      sizes[k]++;
    } else run = 0;
  }
  if (n > 0) {
    withSlip++; slips += n;
    perGame[n] = (perGame[n] ?? 0) + 1;
    runs[best] = (runs[best] ?? 0) + 1;
    const k = first === 60 ? '60' : first <= 64 ? '61-64' : first <= 69 ? '65-69' : first <= 79 ? '70-79' : '80+';
    firstAt[k]++;
    toEnd.push({ d: last - first, result });
    if (n >= 4) many.push(`${f.replace('.txt', '')}(${n} slips, longest run ${best}, ${result}, ${last})`);
  }
}
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
console.log(`${dir.split(/[\\/]/).pop()}: ${games} teaching games, ${withSlip} with a slip, ${slips} slips`);
console.log('slips per game:', JSON.stringify(perGame));
console.log('longest run of slips on his moves running, per game:', JSON.stringify(runs));
console.log('sizes:', JSON.stringify(sizes));
console.log('first slip at move:', JSON.stringify(firstAt));
for (const res of ['win', 'draw', 'loss']) {
  const d = toEnd.filter(t => t.result === res).map(t => t.d);
  console.log(`  games with a slip ending in a ${res}: ${d.length}, his moves from the first slip to the end: median ${med(d)}`);
}
console.log('four slips or more:', many.join(' '));
