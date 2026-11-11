// Mirrors the design contract, the decision records and the helper scripts into <repo>/docs/design, replacing
// private details with placeholders on the way: the system user name in paths (also its 8.3 short form) and any
// host name given with --hide-host. The working copies are never changed.
// Usage: node sync-docs.mjs --repo <repo> [--workflow <script.js>]... [--hide-host <host>]...
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
/** @param {string} name @returns {string[]} */
const all = name => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const repo = all('--repo')[0];
if (!repo) { console.error('missing --repo'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const design = path.join(here, '..', 'design');
const out = path.join(repo, 'docs', 'design');

const user = os.userInfo().username;
const short = `${user.slice(0, 6).toUpperCase()}~1`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** @type {[RegExp, string][]} */
const rules = [
  [new RegExp(esc(short), 'g'), 'USERNA~1'],
  [new RegExp(esc(user), 'gi'), 'USERNAME'],
  ...all('--hide-host').map(h => /** @type {[RegExp, string]} */ ([new RegExp(esc(h), 'gi'), 'gateway.example.com'])),
];

const jobs = [
  ...fs.readdirSync(design).filter(f => /^(SPEC\.md|SPEC-TOC\.txt|CONTRACT-NOTES\.md|WAVE\d+-NOTES\.md)$/.test(f))
    .map(f => ({ from: path.join(design, f), to: path.join(out, f) })),
  ...fs.readdirSync(here).filter(f => /\.(mjs|cjs)$/.test(f)).map(f => ({ from: path.join(here, f), to: path.join(out, 'tools', f) })),
  ...all('--workflow').map(f => ({ from: f, to: path.join(out, 'tools', path.basename(f)) })),
];

fs.mkdirSync(path.join(out, 'tools'), { recursive: true });
let left = 0;
for (const { from, to } of jobs) {
  let text = fs.readFileSync(from, 'utf8');
  let count = 0;
  for (const [re, by] of rules) text = text.replace(re, () => { count++; return by; });
  fs.writeFileSync(to, text, 'utf8');
  const residue = rules.reduce((n, [re]) => n + (text.match(re) || []).length, 0);
  left += residue;
  console.log(`${path.relative(repo, to).split(path.sep).join('/')}: ${text.length} chars, ${count} replaced${residue ? `, ${residue} LEFT` : ''}`);
}
if (left) { console.error(`${left} private strings left`); process.exit(1); }
