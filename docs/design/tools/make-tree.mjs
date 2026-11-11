// Makes a private working copy of the repository for a package that must not disturb the engineers at work in the real
// tree: every tracked-looking file except the local configuration, the build output and the old v1 code; node_modules is a
// junction to the repository's; a throw-away git repository records the starting state, so that `git diff` in the copy
// shows exactly what the package changed.
// usage: node make-tree.mjs <repo> <target>
import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [, , repoArg, targetArg] = process.argv;
if (!repoArg || !targetArg) { console.error('usage: node make-tree.mjs <repo> <target>'); process.exit(2); }
const repo = resolve(repoArg), target = resolve(targetArg);
if (existsSync(target)) { console.error(`target exists already: ${target}`); process.exit(2); }

const SKIP = new Set(['.git', 'node_modules', 'dist', 'legacy', 'test-results', 'playwright-report', '.env', '.env.local']);
mkdirSync(target, { recursive: true });
let copied = 0;
for (const name of readdirSync(repo)) {
  if (SKIP.has(name) || name.startsWith('.env.') && name !== '.env.example') continue;
  cpSync(join(repo, name), join(target, name), { recursive: true });
  copied += 1;
}
symlinkSync(join(repo, 'node_modules'), join(target, 'node_modules'), 'junction');

const git = (...args) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q');
git('config', 'core.autocrlf', 'false');
git('config', 'user.name', 'scratch');
git('config', 'user.email', 'scratch@localhost');
git('add', '-A');
git('commit', '-q', '-m', 'starting state of the private copy');
console.log(`copied ${copied} top-level entries to ${target}; base commit ${git('rev-parse', '--short', 'HEAD').trim()}`);
console.log(git('status', '--short').trim() || 'clean');
