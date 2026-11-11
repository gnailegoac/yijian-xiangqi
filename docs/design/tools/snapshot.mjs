// Copies the repository's working tree into snapshots/<name>, so that a later package can be compared with the state it
// started from. Never copied: the local configuration (.env, .env.local and their kin), .git, node_modules, the build
// output, test output and the old v1 code. The design notes of the moment are put beside the tree.
// usage: node snapshot.mjs <repo> <snapshots dir> <name> [<notes file> ...]
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [, , repoArg, rootArg, name, ...notes] = process.argv;
if (!repoArg || !rootArg || !name) { console.error('usage: node snapshot.mjs <repo> <snapshots dir> <name> [<notes file> ...]'); process.exit(2); }
const repo = resolve(repoArg), target = join(resolve(rootArg), name);
if (existsSync(target)) { console.error(`snapshot exists already: ${target}`); process.exit(2); }

const SKIP = new Set(['.git', '.github', 'node_modules', 'dist', 'legacy', 'docs', 'test-results', 'playwright-report', 'artifacts', '.env', '.env.local']);
mkdirSync(target, { recursive: true });
const copied = [];
for (const entry of readdirSync(repo)) {
  if (SKIP.has(entry) || (entry.startsWith('.env') && entry !== '.env.example')) continue;
  cpSync(join(repo, entry), join(target, entry), { recursive: true });
  copied.push(entry);
}
for (const file of notes) cpSync(file, join(target, basename(file)));
if (readdirSync(target).some(entry => entry.startsWith('.env') && entry !== '.env.example')) { console.error('a local configuration file was copied: remove the snapshot'); process.exit(1); }
console.log(`${target}\n${copied.join(' ')}${notes.length ? `\n+ ${notes.map(f => basename(f)).join(' ')}` : ''}`);
