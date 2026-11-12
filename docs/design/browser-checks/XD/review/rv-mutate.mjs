// XD review: the reviewer's mutants of src/ui/audio.js, run SAFELY (same scheme as the engineer's mutate-safe.mjs):
// one node process per mutant (the test file is run directly, no `node --test` runner in between), the memory guard
// imported with MEM_LIMIT_MB, a V8 heap cap, and a wall-clock kill by pid.
// Use: node rv-mutate.mjs [--only <substring>] [--limit-mb 1000] [--seconds 40] [--set mine|engineer]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'C:/Users/USERNAME/git/yijian-xiangqi';
const guard = pathToFileURL(path.resolve(here, '../../../tools/memguard.mjs')).href;
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const only = arg('--only', '');
const limitMb = Number(arg('--limit-mb', '1000'));
const seconds = Number(arg('--seconds', '40'));
const set = arg('--set', 'mine');

const cur = fs.readFileSync(`${repo}/src/ui/audio.js`, 'utf8');
const test = fs.readFileSync(`${repo}/tests/unit/ui/audio-recipes.test.js`, 'utf8');
const sub = (text, a, b) => { if (!text.includes(a)) throw new Error('no anchor: ' + a.slice(0, 70)); return text.replace(a, () => b); };

const mine = {
  'as it is': cur,
  'R1 the gesture ignores the prepared tables': sub(cur, 'const ahead = prepared.find(p => p.rate === ctx.sampleRate);', 'const ahead = [].find(p => p.rate === ctx.sampleRate);'),
  'R2 a failed render of a new palette keeps the old buffer': sub(cur, '() => { if (gen === renderGen) stingers.delete(name); },', '() => {},'),
  'R3 no guard after the audio:unlocked event': sub(cur, "      if (rig !== r) return;                     // a listener of the event disposed the engine: nothing is started for it\n", ''),
  'R4 the renders run at 44.1 kHz whatever the rig': sub(cur, 'else setup = stingerSetup(name, palette, r.ctx.sampleRate, r.impulse);', 'else setup = stingerSetup(name, palette, 44100, r.impulse);'),
  'R5 the tables of another rate are copied in': sub(cur, 'const ahead = prepared.find(p => p.rate === ctx.sampleRate);', 'const ahead = prepared[0];'),
  'R6 tables are prepared without an AudioContext': sub(cur, 'let prepareTimer = contextCtor() ? setTimeout(prepare, PREPARE_MS) : 0;', 'let prepareTimer = setTimeout(prepare, PREPARE_MS);'),
  'R8 a theme renders before the engine is unlocked': sub(cur, '    if (unlocked) renderStingers(r);\n  }', '    renderStingers(r);\n  }'),
  'R9 a new palette throws the old buffers away at once': sub(cur, '    if (unlocked) renderStingers(r);\n  }', '    stingers.clear();\n    if (unlocked) renderStingers(r);\n  }'),
  'R10 the cap on unlock() is not cleared': sub(cur, 'rendered.then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(true); });', 'rendered.then(() => { resolve(true); }, () => { resolve(true); });'),
  'R11 a stopped run keeps its timer': sub(cur, "      const stop = () => {\n        clearTimeout(timer);", "      const stop = () => {"),
  'R12 the renders wait 16 ms between the tasks': sub(cur, 'if (jobs.length < PRERENDERED.length) timer = setTimeout(step, 0);', 'if (jobs.length < PRERENDERED.length) timer = setTimeout(step, 16);'),
  'R13 the stingers are rendered in reverse order': sub(cur, 'const name = PRERENDERED[jobs.length];', 'const name = PRERENDERED[PRERENDERED.length - 1 - jobs.length];'),
  'R14 the mute at the first gesture ends the renders': sub(cur, "      if (!parkTimer) parkAfter(0);              // it was started only to unlock it; it stays parked", "      if (!parkTimer) parkAfter(0);\n      stopRender();"),
};

let mutants = mine;
if (set === 'engineer') {
  mutants = (await import(pathToFileURL(path.join(here, '..', 'mutants.mjs')).href)).default({ cur, sub, before: fs.readFileSync(path.join(here, '..', 'audio.before.js'), 'utf8') });
}

/** @returns {Promise<{code:number|null, signal:string|null, text:string, killed:string}>} */
function run(file) {
  return new Promise(resolve => {
    const args = ['--import', guard, '--max-old-space-size=768', '--test-reporter=spec', file];
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
  const dir = path.join(here, set === 'engineer' ? 'mutE' : 'mutR', String(i).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio.js'), code);
  const t = test.replace("'../../../src/ui/audio.js'", "'./audio.js'").replace("'../../../src/ui/speech.js'", `'file:///${repo}/src/ui/speech.js'`);
  if (t === test) throw new Error('the test imports were not rewritten');
  fs.writeFileSync(path.join(dir, 'audio.test.mjs'), t);
  const t0 = Date.now();
  const out = await run(path.join(dir, 'audio.test.mjs'));
  const ms = Date.now() - t0;
  const num = key => (new RegExp(`ℹ ${key} (\\d+)`).exec(out.text)?.[1] ?? '?');
  const failed = [...new Set([...out.text.matchAll(/^✖ (.+?) \(\d/gm)].map(m => m[1].slice(0, 120)))];
  const memguard = /MEMGUARD[^\n]*/.exec(out.text)?.[0] ?? '';
  const hang = out.killed || memguard ? `  ** NOT BOUNDED: ${out.killed} ${memguard}` : '';
  const verdict = name === 'as it is' || name.startsWith('as it is') ? (num('fail') === '0' && !hang ? 'ok' : 'BROKEN') : (hang ? 'NOT BOUNDED' : num('fail') !== '0' && num('fail') !== '?' ? 'caught' : 'SURVIVED');
  console.log(`${verdict.padEnd(11)} ${name.padEnd(58)} pass ${num('pass')} fail ${num('fail')}  exit ${out.code ?? out.signal}  ${ms} ms${hang}`);
  for (const f of failed.slice(0, 6)) console.log(`      ✖ ${f}`);
  if (failed.length > 6) console.log(`      ... and ${failed.length - 6} more`);
  rows.push({ name, verdict, pass: num('pass'), fail: num('fail'), exit: out.code, ms, failed });
}
fs.writeFileSync(path.join(here, `rv-mutate-${set}.last.json`), JSON.stringify(rows, null, 1));
