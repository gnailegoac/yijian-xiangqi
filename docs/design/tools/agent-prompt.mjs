// Prints the package part of the prompt an agent was started with (from its transcript).
// Usage: node agent-prompt.mjs <agent-xxx.jsonl> [from-marker] [to-marker]
import fs from 'node:fs';

const [, , file, from = 'YOUR PACKAGE:', to = 'HOW TO WORK'] = process.argv;
const first = fs.readFileSync(file, 'utf8').split('\n').find(l => l.includes('"role":"user"'));
const o = JSON.parse(first);
const c = o.message.content;
const text = typeof c === 'string' ? c : c.map(x => x.text || '').join('\n');
const a = text.indexOf(from);
const b = text.indexOf(to, a);
console.log(text.slice(a < 0 ? 0 : a, b < 0 ? undefined : b));
