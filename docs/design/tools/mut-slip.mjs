// mut-slip.mjs <tree> <scratch dir>: mutants of the wrap-up manners in a scratch copy; says which survive the teacher tests.
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [tree, scratch] = process.argv.slice(2);
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
cpSync(`${tree}/src`, `${scratch}/src`, { recursive: true });
mkdirSync(`${scratch}/tests/unit/core`, { recursive: true });
cpSync(`${tree}/tests/unit/core/teacher.test.js`, `${scratch}/tests/unit/core/teacher.test.js`);
cpSync(`${tree}/package.json`, `${scratch}/package.json`);
for (const extra of ['tests/unit/helpers', 'tests/helpers', 'tests/fixtures']) if (existsSync(`${tree}/${extra}`)) cpSync(`${tree}/${extra}`, `${scratch}/${extra}`, { recursive: true });
const file = `${scratch}/src/core/teacher.js`;
const original = readFileSync(file, 'utf8');
const MUTANTS = [
  ['no wait after a blunder', `ctx.sinceBlunder < GIFT_WAIT[ctx.level < GIFT_WAIT_LEVEL ? 0 : 1] || ctx.sinceChance < WRAP_UP_HOLD`, `ctx.sinceChance < WRAP_UP_HOLD`],
  ['wait index swapped', `GIFT_WAIT[ctx.level < GIFT_WAIT_LEVEL ? 0 : 1] || ctx.sinceChance < WRAP_UP_HOLD`, `GIFT_WAIT[ctx.level < GIFT_WAIT_LEVEL ? 1 : 0] || ctx.sinceChance < WRAP_UP_HOLD`],
  ['no hold', `|| ctx.sinceChance < WRAP_UP_HOLD)) return choice(honest, 'honest');`, `|| false)) return choice(honest, 'honest');`],
  ['hold 1', `const WRAP_UP_HOLD = 2;`, `const WRAP_UP_HOLD = 1;`],
  ['hold 3', `const WRAP_UP_HOLD = 2;`, `const WRAP_UP_HOLD = 3;`],
  ['settle 4', `const WRAP_UP_SETTLE = 5;`, `const WRAP_UP_SETTLE = 4;`],
  ['settle 6', `const WRAP_UP_SETTLE = 5;`, `const WRAP_UP_SETTLE = 6;`],
  ['no settle', `const slip = wrapUp && (eBest < WRAP_UP_CLEAR || ctx.sinceChance < WRAP_UP_SETTLE);`, `const slip = wrapUp && (eBest < WRAP_UP_CLEAR);`],
  ['manners at +600 twice', `const wrapUp = !(eBest >= 600 && ctx.aheadRun >= 1);`, `const wrapUp = true;`],
  ['wrapUp ignores aheadRun', `const wrapUp = !(eBest >= 600 && ctx.aheadRun >= 1);`, `const wrapUp = !(eBest >= 600);`],
  ['slip without wrapUp', `const slip = wrapUp && (eBest < WRAP_UP_CLEAR || ctx.sinceChance < WRAP_UP_SETTLE);`, `const slip = eBest < WRAP_UP_CLEAR || ctx.sinceChance < WRAP_UP_SETTLE;`],
  ['no quiet preference', `(slip ? Math.min(b.rd, 2) - Math.min(a.rd, 2) : 0) || b.loss - a.loss`, `b.loss - a.loss`],
  ['quiet preference everywhere', `(slip ? Math.min(b.rd, 2) - Math.min(a.rd, 2) : 0) || b.loss - a.loss`, `(Math.min(b.rd, 2) - Math.min(a.rd, 2)) || b.loss - a.loss`],
  ['deepest first', `(slip ? Math.min(b.rd, 2) - Math.min(a.rd, 2) : 0) || b.loss - a.loss`, `(slip ? b.rd - a.rd : 0) || b.loss - a.loss`],
];
for (const [name, from, to] of MUTANTS) {
  if (!original.includes(from)) { console.log(`?? ${name}: text not found`); continue; }
  writeFileSync(file, original.replace(from, () => to));
  const r = spawnSync(process.execPath, ['--test', 'tests/unit/core/teacher.test.js'], { cwd: scratch, encoding: 'utf8', timeout: 120000 });
  const out = `${r.stdout}\n${r.stderr}`;
  const failed = [...out.matchAll(/^✖ (.{0,90})/gmu)].map(m => m[1]);
  console.log(`${r.status === 0 ? 'SURVIVES' : 'killed  '}  ${name}${failed.length ? `  <- ${[...new Set(failed)][0]}` : ''}`);
}
writeFileSync(file, original);
