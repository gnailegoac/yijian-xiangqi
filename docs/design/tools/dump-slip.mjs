// dump-slip.mjs <journal.jsonl> <out dir>: writes each agent result of the slip review as a text file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const [journal, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let n = 0;
for (const line of readFileSync(journal, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let j;
  try { j = JSON.parse(line); } catch { continue; }
  if (j.type !== 'result') continue;
  const r = j.result ?? j.value ?? j.output;
  if (!r || typeof r !== 'object') continue;
  n++;
  const name = /look/i.test(j.label ?? '') ? 'look' : /code/i.test(j.label ?? '') ? 'code' : `agent${n}`;
  const parts = [`######## ${j.label ?? name} ########`, '', '== status ==', r.status, '', '== summary ==', r.summary, '', `== found (${(r.found ?? []).length}) ==`];
  for (const f of r.found ?? []) parts.push(`- severity: ${f.severity}\n    where: ${f.where}\n    problem: ${f.problem}\n    fixed: ${f.fixed}`);
  parts.push('', `== checks (${(r.checks ?? []).length}) ==`);
  for (const c of r.checks ?? []) parts.push(`- command: ${c.command}\n    outcome: ${c.outcome}`);
  parts.push('', `== forOwner (${(r.forOwner ?? []).length}) ==`);
  for (const f of r.forOwner ?? []) parts.push(`- ${f}`);
  writeFileSync(`${out}/review-slip-${name}.txt`, parts.join('\n') + '\n');
  console.log(`${name}: ${parts.join('\n').length} chars; keys of the journal line: ${Object.keys(j).join(',')}`);
}
if (n === 0) console.log('no result lines; first line keys:', Object.keys(JSON.parse(readFileSync(journal, 'utf8').split('\n')[0])).join(','));
