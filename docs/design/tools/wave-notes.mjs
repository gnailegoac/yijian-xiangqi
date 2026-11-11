// Builds a notes file for later packages from the journals of one build wave.
// usage: node wave-notes.mjs --title "Wave 1" --out <file.md> <journal.jsonl> [<journal.jsonl> ...]
// For each package it takes the reviewer's report when there is one (else the implementer's) for the readings,
// and the union of both reports for the requests to other packages.
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
let title = 'Wave', out = '';
const journals = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--title') title = argv[++i];
  else if (argv[i] === '--out') out = argv[++i];
  else journals.push(argv[i]);
}
if (!out || journals.length === 0) { console.error('usage: node wave-notes.mjs --title T --out file.md journal...'); process.exit(2); }

/** @type {Map<string, {impl?: any, review?: any}>} */
const packages = new Map();
const running = [];
for (const path of journals) {
  const labels = new Map();
  const done = new Set();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.type === 'started') labels.set(entry.agentId, entry.label);
    if (entry.type === 'result') {
      done.add(entry.agentId);
      const label = labels.get(entry.agentId) ?? '';
      const [stage, id] = label.split(':');
      if (!id || (stage !== 'impl' && stage !== 'review')) continue;
      const slot = packages.get(id) ?? {};
      slot[stage] = entry.result;
      packages.set(id, slot);
    }
  }
  for (const [agentId, label] of labels) if (!done.has(agentId)) running.push(label);
}
// An agent that was cut off in one journal and finished in a later run (another journal) is not running.
for (let i = running.length - 1; i >= 0; i--) {
  const [stage, id] = running[i].split(':');
  if (packages.get(id)?.[stage]) running.splice(i, 1);
}

// Best-effort owner of a file named in a request.
const OWNERS = [
  [/coach-handler|server\/prompt|server\/provider|server\/mock|server\/tools|server\/narrat/, 'S2'],
  [/server\/(config|guard|sign)/, 'S1'],
  [/coach\/client/, 'C4'], [/coach\/brief/, 'C3'], [/coach\/(book|fallback|local)/, 'C2'], [/coach\/(protocol|markup|lexicon)/, 'C1'],
  [/game\/director|game\/ports/, 'G4'], [/game\/session/, 'G1'], [/game\/tasks/, 'G2'], [/game\/(store|record)/, 'G3'],
  [/game\/(strings|rival|rank|goals|profile)|src\/config/, 'G5'],
  [/src\/app\.js|index\.html/, 'A1'],
  [/core\/(engine|notation)/, 'B1'], [/core\/(position|search|worker)/, 'B2'], [/core\/(facts|motifs|patterns|analy)/, 'B3'],
  [/core\/teacher/, 'B4'], [/core\/(brain|opponent|advisor)/, 'B5'],
  [/ui\/stage/, 'X8'], [/ui\/(layout|geometry)|styles\/(tokens|themes|layout)/, 'X1'], [/board/, 'X2'], [/fx/, 'X3'],
  [/audio|speech/, 'X4'], [/buddy|rival-view/, 'X5'], [/chat/, 'X6'], [/hud/, 'X7'],
  [/e2e/, 'E1'], [/coach-bench|scripts\/sim|README/, 'T2'], [/scripts\/(serve|build)|\.env\.example|\.gitattributes/, 'T1'],
];
const ownersOf = (/** @type {string} */ file) => {
  const found = [];
  for (const [re, id] of OWNERS) if (re.test(file) && !found.includes(id)) found.push(id);
  for (const m of file.matchAll(/\b([A-Z][0-9])\b/g)) if (!found.includes(m[1])) found.push(m[1]);
  return found;
};
const one = (/** @type {unknown} */ s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();

const ids = [...packages.keys()].sort();
const lines = [];
lines.push(`# ${title} notes — readings and requests reported by the packages of this wave`, '');
lines.push('Generated from the workflow journals. Part 1: how each package read an unclear point of SPEC.md (the reviewer\'s final list). ' +
  'Part 2: what each package asks of a package that comes later, grouped by the file named. Part 3: what each package left unverified. ' +
  'A later package reads Part 1 for the packages it builds on and every entry of Part 2 that names one of its files. ' +
  'Where an entry here contradicts CONTRACT-NOTES.md section I or the "Owner decisions" section at the end of this file, the owner decision wins.', '');
if (running.length) lines.push(`> NOT FINAL: still running when this was generated: ${running.join(', ')}`, '');

lines.push('## Part 1. Readings by package', '');
for (const id of ids) {
  const { impl, review } = packages.get(id) ?? {};
  const src = review ?? impl;
  const issues = src?.contractIssues ?? [];
  lines.push(`### ${id}${review ? '' : ' (implementer report only)'}`, '');
  if (!issues.length) lines.push('- (none reported)');
  for (const it of issues) lines.push(`- **${one(it.specRef)}** — ${one(it.problem)} **Reading:** ${one(it.readingChosen)}`);
  lines.push('');
}

lines.push('## Part 2. Requests to other packages, by file', '');
/** @type {Map<string, {from: string, request: string}[]>} */
const byFile = new Map();
for (const id of ids) {
  const { impl, review } = packages.get(id) ?? {};
  const seen = new Set();
  for (const [stage, rep] of [['review', review], ['impl', impl]]) {
    for (const need of rep?.needsFromOthers ?? []) {
      const request = one(need.request);
      const key = one(need.file) + '|' + request.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      const file = one(need.file);
      const list = byFile.get(file) ?? [];
      list.push({ from: `${id} ${stage}`, request });
      byFile.set(file, list);
    }
  }
}
const files = [...byFile.keys()].sort((a, b) => (ownersOf(a)[0] ?? 'zz').localeCompare(ownersOf(b)[0] ?? 'zz') || a.localeCompare(b));
for (const file of files) {
  const owners = ownersOf(file);
  lines.push(`### ${file}${owners.length ? `  [${owners.join(', ')}]` : ''}`, '');
  for (const { from, request } of byFile.get(file) ?? []) lines.push(`- (from ${from}) ${request}`);
  lines.push('');
}

lines.push('## Part 3. Left unverified or not done, by package', '');
for (const id of ids) {
  const { impl, review } = packages.get(id) ?? {};
  const rest = [...(review?.remaining ?? []), ...(review ? [] : impl?.notDone ?? [])];
  const open = (review?.found ?? []).filter((/** @type {any} */ f) => f.fixed === false);
  lines.push(`### ${id}  (impl: ${impl?.status ?? 'missing'}; review: ${review ? 'done' : 'missing'})`, '');
  if (!rest.length && !open.length) lines.push('- (nothing)');
  for (const r of rest) lines.push(`- ${one(r)}`);
  for (const f of open) lines.push(`- [${f.severity}, not fixed] ${one(f.where)}: ${one(f.problem)}`);
  lines.push('');
}

writeFileSync(out, lines.join('\n'), 'utf8');
const counts = ids.map(id => {
  const { impl, review } = packages.get(id) ?? {};
  const found = review?.found ?? [];
  return `${id}: impl=${impl?.status ?? '-'} review=${review ? 'done' : '-'} found=${found.length} (critical ${found.filter((/** @type {any} */ f) => f.severity === 'critical').length}, major ${found.filter((/** @type {any} */ f) => f.severity === 'major').length}) unfixed=${found.filter((/** @type {any} */ f) => f.fixed === false).length}`;
});
console.log(counts.join('\n'));
console.log(`running: ${running.join(', ') || '(none)'}`);
console.log(`requests: ${[...byFile.values()].reduce((n, l) => n + l.length, 0)} across ${byFile.size} file groups; wrote ${out}`);
