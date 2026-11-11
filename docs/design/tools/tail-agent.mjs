// Prints what an agent transcript ends with: last activity, files it wrote, and its last text notes.
// Usage: node tail-agent.mjs <agent-xxx.jsonl> [how many notes]
import fs from 'node:fs';

const [, , file, nStr] = process.argv;
const n = Number(nStr) || 6;
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const notes = [];
const edits = new Map();
let last = null;
for (const l of lines) {
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  const m = o.message;
  if (!m || !Array.isArray(m.content)) continue;
  if (o.timestamp) last = o.timestamp;
  for (const c of m.content) {
    if (c.type === 'text' && m.role === 'assistant' && c.text.trim()) {
      notes.push(`${(o.timestamp || '').slice(11, 16)} ${c.text.trim().replace(/\s+/g, ' ').slice(0, 900)}`);
    }
    if (c.type === 'tool_use' && (c.name === 'Edit' || c.name === 'Write') && c.input && c.input.file_path) {
      const p = c.input.file_path.split('\\').join('/').replace(/^.*yijian-xiangqi\//, '').replace(/^.*scratchpad\//, 'SCRATCH/');
      edits.set(p, (edits.get(p) || 0) + 1);
    }
  }
}
console.log('last activity:', last, ' lines:', lines.length);
console.log('files written:', [...edits].map(([p, k]) => `${p} x${k}`).join(', '));
console.log(notes.slice(-n).join('\n--\n'));
