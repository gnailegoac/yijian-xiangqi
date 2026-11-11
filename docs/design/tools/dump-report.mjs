// usage: node dump-report.mjs <journal.jsonl> <label> [<label>...]  -> prints the full structured result of those agents
import { readFileSync } from 'node:fs';
const [path, ...want] = process.argv.slice(2);
const labels = new Map();
for (const line of readFileSync(path, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const e = JSON.parse(line);
  if (e.type === 'started') labels.set(e.agentId, e.label);
  if (e.type === 'result' && want.includes(labels.get(e.agentId))) {
    const r = e.result ?? {};
    console.log(`\n######## ${labels.get(e.agentId)} ########`);
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'string') console.log(`\n== ${k} ==\n${v}`);
      else if (Array.isArray(v)) { console.log(`\n== ${k} (${v.length}) ==`); for (const it of v) console.log('- ' + (typeof it === 'string' ? it : Object.entries(it).map(([a, b]) => `${a}: ${b}`).join('\n    '))); }
      else console.log(`\n== ${k} ==\n${JSON.stringify(v)}`);
    }
  }
}
