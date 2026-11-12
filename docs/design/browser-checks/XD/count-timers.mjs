// XD: how many timers does each test of audio-recipes.test.js arm, and how many tasks does it run? (to size the budgets)
// Writes a copy of the test file that prints the counts, and runs it once in one guarded process.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'C:/Users/USERNAME/git/yijian-xiangqi';
const guard = pathToFileURL(path.resolve(here, '../../tools/memguard.mjs')).href;
let test = fs.readFileSync(`${repo}/tests/unit/ui/audio-recipes.test.js`, 'utf8');
const sub = (a, b) => { if (!test.includes(a)) throw new Error('no anchor: ' + a.slice(0, 60)); test = test.replace(a, () => b); };
sub("'../../../src/ui/audio.js'", `'file:///${repo}/src/ui/audio.js'`);
sub("'../../../src/ui/speech.js'", `'file:///${repo}/src/ui/speech.js'`);
sub('  t.after(() => {\n    G.AudioContext = saved.AudioContext;', "  t.after(() => {\n    console.log(`XDCOUNT mock ${armed} ${t.name}`);\n    G.AudioContext = saved.AudioContext;");
sub('  t.after(() => { G.setTimeout = realSetTimeout; G.clearTimeout = realClearTimeout; });', '  t.after(() => { console.log(`XDCOUNT task armed ${seq} ran ${ran} ${t.name}`); G.setTimeout = realSetTimeout; G.clearTimeout = realClearTimeout; });');
const dir = path.join(here, 'mut4', 'count');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'audio.test.mjs'), test);
const out = spawnSync(process.execPath, ['--import', guard, '--max-old-space-size=768', '--test-reporter=spec', path.join(dir, 'audio.test.mjs')],
  { encoding: 'utf8', timeout: 60000, env: { ...process.env, MEM_LIMIT_MB: '600', NODE_OPTIONS: '' } });
const text = out.stdout + out.stderr;
const rows = [...text.matchAll(/XDCOUNT (mock (\d+)|task armed (\d+) ran (\d+)) (.*)/g)];
const mock = rows.filter(r => r[2]).map(r => ({ n: Number(r[2]), name: r[5] })).sort((a, b) => b.n - a.n);
const task = rows.filter(r => r[3]).map(r => ({ armed: Number(r[3]), ran: Number(r[4]), name: r[5] }));
console.log('tests', /ℹ pass (\d+)/.exec(text)?.[1], 'pass', /ℹ fail (\d+)/.exec(text)?.[1], 'fail');
console.log('mock timers armed per test, the five largest:');
for (const r of mock.slice(0, 5)) console.log(`  ${String(r.n).padStart(6)}  ${r.name.slice(0, 100)}`);
console.log('task timers per test:');
for (const r of task) console.log(`  armed ${String(r.armed).padStart(4)} ran ${String(r.ran).padStart(4)}  ${r.name.slice(0, 90)}`);
