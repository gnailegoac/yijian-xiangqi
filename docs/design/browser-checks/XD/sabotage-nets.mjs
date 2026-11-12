// XD: does the self-test of the nets (N-125) notice when a net is taken away from the TEST FILE? Each case is a copy of
// the test file with one net removed, run alone (--test-name-pattern N-125) in one guarded process with a wall clock.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'C:/Users/USERNAME/git/yijian-xiangqi';
const guard = pathToFileURL(path.resolve(here, '../../tools/memguard.mjs')).href;
const base = fs.readFileSync(`${repo}/tests/unit/ui/audio-recipes.test.js`, 'utf8')
  .replace("'../../../src/ui/audio.js'", `'file:///${repo}/src/ui/audio.js'`)
  .replace("'../../../src/ui/speech.js'", `'file:///${repo}/src/ui/speech.js'`);
const sub = (a, b) => { if (!base.includes(a)) throw new Error('no anchor: ' + a.slice(0, 70)); return base.replace(a, () => b); };
const cases = {
  'as it is': base,
  'the samples are enumerable again': sub("enumerable: false });\n  }\n  /** @param {number} ch */", "enumerable: true });\n  }\n  /** @param {number} ch */"),
  'the context of a node is enumerable again': sub("    Object.defineProperty(this, 'context', { enumerable: false });\n", ''),
  'the curve is enumerable again': sub("    Object.defineProperty(node, 'curve', { value: null, writable: true, enumerable: false });\n", ''),
};
const run = file => new Promise(resolve => {
  const child = spawn(process.execPath, ['--import', guard, '--max-old-space-size=512', '--test-reporter=spec', '--test-name-pattern=N-125', file],
    { env: { ...process.env, MEM_LIMIT_MB: '800', NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '', killed = '';
  child.stdout.on('data', d => { text += d; });
  child.stderr.on('data', d => { text += d; });
  const timer = setTimeout(() => { killed = 'wall clock 30 s'; try { process.kill(child.pid); } catch { /* gone */ } }, 30000);
  child.on('exit', code => { clearTimeout(timer); resolve({ code, text, killed }); });
});
let i = 0;
for (const [name, code] of Object.entries(cases)) {
  const dir = path.join(here, 'mut4', `net${i++}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio.test.mjs'), code);
  const t0 = Date.now();
  const out = await run(path.join(dir, 'audio.test.mjs'));
  const why = /(?:AssertionError[^\n]*\n\s*)?([^\n]*(?:prints \d+ lines|Missing expected exception|did not reject|still pending|timed out|MEMGUARD)[^\n]*)/.exec(out.text)?.[1]?.trim() ?? '';
  console.log(`${name.padEnd(46)} pass ${/ℹ pass (\d+)/.exec(out.text)?.[1] ?? '?'} fail ${/ℹ fail (\d+)/.exec(out.text)?.[1] ?? '?'} exit ${out.code} ${Date.now() - t0} ms ${out.killed} ${why.slice(0, 150)}`);
}
