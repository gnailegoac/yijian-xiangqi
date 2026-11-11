// Prints a part of the prompt an agent was started with (from its transcript): the text from one marker up to another.
// Usage: node agent-prompt.mjs <agent-xxx.jsonl> [from-marker] [to-marker]
import fs from 'node:fs';

const [, , file, from = 'YOUR PACKAGE:', to = 'HOW TO WORK'] = process.argv;
let found = null;
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!l.includes('"role":"user"')) continue;
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  const c = o.message && o.message.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : '';
  const a = text.indexOf(from);
  if (a < 0) continue;
  const b = text.indexOf(to, a);
  // the harness indents the relayed prompt by two spaces: remove that indentation
  found = text.slice(a, b < 0 ? undefined : b).split('\n').map(line => line.replace(/^ {2}/, '')).join('\n').trimEnd();
  break;
}
if (found === null) { console.error(`marker not found: ${from}`); process.exit(1); }
console.log(found);
