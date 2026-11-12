// XD (fourth engineer): the SAFE mutation runner. Replaces mutate.cjs.UNSAFE.
// Every mutant's test run is ONE node process (the test file is run directly, not through `node --test`, so there is
// no runner process whose child could outlive a timeout), started with the memory guard imported (MEM_LIMIT_MB,
// default 1000), a V8 heap cap, and a wall-clock limit after which the process is killed by pid.
// Use:  node mutate-safe.mjs [--only <substring>] [--list] [--limit-mb 1000] [--seconds 60] [--pattern <test name regexp>] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'C:/Users/USERNAME/git/yijian-xiangqi';
const guard = pathToFileURL(path.resolve(here, '../../tools/memguard.mjs')).href;
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const only = arg('--only', '');
const limitMb = Number(arg('--limit-mb', '1000'));
const seconds = Number(arg('--seconds', '60'));
const pattern = arg('--pattern', '');
const verbose = process.argv.includes('--verbose');

const cur = fs.readFileSync(`${repo}/src/ui/audio.js`, 'utf8');
const test = fs.readFileSync(`${repo}/tests/unit/ui/audio-recipes.test.js`, 'utf8');
const sub = (text, a, b) => { if (!text.includes(a)) throw new Error('no anchor: ' + a.slice(0, 70)); return text.replace(a, () => b); };
const mutants = (await import(pathToFileURL(path.join(here, 'mutants.mjs')).href)).default({ cur, sub, before: fs.readFileSync(path.join(here, 'audio.before.js'), 'utf8') });

if (process.argv.includes('--list')) { console.log(Object.keys(mutants).join('\n')); process.exit(0); }

/** @returns {Promise<{code:number|null, signal:string|null, text:string, killed:string}>} */
function run(file) {
  return new Promise(resolve => {
    const args = ['--import', guard, '--max-old-space-size=768', '--test-reporter=spec'];
    if (pattern) args.push(`--test-name-pattern=${pattern}`);
    args.push(file);
    const env = { ...process.env, MEM_LIMIT_MB: String(limitMb), NODE_OPTIONS: '' };
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    let killed = '';
    child.stdout.on('data', d => { text += d; });
    child.stderr.on('data', d => { text += d; });
    const timer = setTimeout(() => { killed = `wall clock ${seconds} s`; try { process.kill(child.pid); } catch { /* gone */ } }, seconds * 1000);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, text, killed }); });
  });
}

let i = 0;
const rows = [];
for (const [name, code] of Object.entries(mutants)) {
  i++;
  if (only && !name.includes(only)) continue;
  const dir = path.join(here, 'mut4', String(i).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio.js'), code);
  const t = test
    .replace("'../../../src/ui/audio.js'", "'./audio.js'")
    .replace("'../../../src/ui/speech.js'", `'file:///${repo}/src/ui/speech.js'`);
  if (t === test) throw new Error('the test imports were not rewritten');
  fs.writeFileSync(path.join(dir, 'audio.test.mjs'), t);
  const t0 = Date.now();
  const out = await run(path.join(dir, 'audio.test.mjs'));
  const ms = Date.now() - t0;
  const num = key => (new RegExp(`ℹ ${key} (\\d+)`).exec(out.text)?.[1] ?? '?');
  const failed = [...new Set([...out.text.matchAll(/^✖ (.+?) \(\d/gm)].map(m => m[1].slice(0, 110)))];
  const memguard = /MEMGUARD[^\n]*/.exec(out.text)?.[0] ?? '';
  const hang = out.killed || memguard ? `  ** NOT BOUNDED: ${out.killed} ${memguard}` : '';
  const lastOk = [...out.text.matchAll(/^✔ (.+?) \(\d/gm)].map(m => m[1]).at(-1) ?? '';
  console.log(`${name.padEnd(44)} pass ${num('pass')} fail ${num('fail')} cancelled ${num('cancelled')}  exit ${out.code ?? out.signal}  ${ms} ms${hang}`);
  for (const f of failed) console.log(`      ✖ ${f}`);
  if (hang) console.log(`      last test that finished: ${lastOk.slice(0, 110)}`);
  if (verbose) console.log(out.text.split('\n').filter(l => !l.startsWith('✔')).slice(0, 120).join('\n'));
  rows.push({ name, pass: num('pass'), fail: num('fail'), exit: out.code, hang: !!hang, failed });
}
fs.writeFileSync(path.join(here, 'mutate-safe.last.json'), JSON.stringify(rows, null, 1));
