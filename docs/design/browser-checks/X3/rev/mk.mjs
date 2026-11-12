// node mk.mjs <out.json> <prefix> <evalJS> <row> <col> <rw> <rh> <t1,t2,...>   canvas sequence with the fake clock
import { writeFileSync } from 'node:fs';
const [out, prefix, js, row, col, rw, rh, times, pre] = process.argv.slice(2);
const plan = [{ clock: true }];
if (pre) plan.push({ eval: pre });
plan.push({ eval: js });
let t = 0;
for (const s of times.split(',')) { const at = Number(s); plan.push({ run: at - t, snap: `${prefix}-${String(at).padStart(4, '0')}`, around: [Number(row), Number(col), Number(rw), Number(rh)], css: true }); t = at; }
writeFileSync(out, JSON.stringify(plan));
