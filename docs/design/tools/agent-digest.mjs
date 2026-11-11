// Turns an agent transcript (agent-xxx.jsonl) into a readable trail: the agent's notes, the edits it made to repo
// files, the commands it ran and the end of each command's output. For a colleague who continues interrupted work.
// Usage: node agent-digest.mjs <agent-xxx.jsonl> <out.md> [title]
import fs from 'node:fs';

const [, , file, out, title] = process.argv;
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)} …[${s.length - n} more chars]` : s);
const tail = (s, n) => (s.length > n ? `[${s.length - n} chars before] … ${s.slice(-n)}` : s);
const rel = p => p.split('\\').join('/').replace(/^.*yijian-xiangqi\//, '').replace(/^.*scratchpad\//, 'SCRATCH/');
const md = [`# ${title || 'Trail of an interrupted agent'}`, '',
  'This is a machine-made digest of the transcript of a colleague whose run was cut off before the final report.',
  'Notes are the colleague\'s own words; edits show the start of the replaced and of the new text; command output is cut to its end.',
  'SCRATCH/ is the scratchpad folder. Nothing here is verified.', ''];
/** @type {Map<string, {name: string, what: string}>} */
const pending = new Map();
for (const l of lines) {
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  const m = o.message;
  if (!m || !Array.isArray(m.content)) continue;
  const t = (o.timestamp || '').slice(11, 16);
  for (const c of m.content) {
    if (c.type === 'text' && m.role === 'assistant' && c.text.trim()) {
      md.push(`**[${t}] note:** ${clip(c.text.trim(), 3000)}`, '');
    } else if (c.type === 'tool_use') {
      const i = c.input || {};
      if (c.name === 'Edit') {
        md.push(`[${t}] EDIT ${rel(i.file_path || '')}`, '```', `- ${clip(String(i.old_string || ''), 500)}`, `+ ${clip(String(i.new_string || ''), 900)}`, '```', '');
      } else if (c.name === 'Write') {
        md.push(`[${t}] WRITE ${rel(i.file_path || '')} (${String(i.content || '').length} chars)`, '');
      } else if (c.name === 'Bash' || c.name === 'PowerShell') {
        pending.set(c.id, { name: c.name, what: clip(String(i.command || '').replace(/\s+/g, ' '), 400) });
      }
    } else if (c.type === 'tool_result' && pending.has(c.tool_use_id)) {
      const p = pending.get(c.tool_use_id);
      pending.delete(c.tool_use_id);
      let text = '';
      if (typeof c.content === 'string') text = c.content;
      else if (Array.isArray(c.content)) text = c.content.map(x => (x && x.type === 'text' ? x.text : '')).join('\n');
      if (p) md.push(`[${t}] RUN ${p.what}`, '```', tail(text.trim(), 700), '```', '');
    }
  }
}
fs.writeFileSync(out, md.join('\n'), 'utf8');
console.log(`${out}: ${md.length} lines, ${fs.statSync(out).size} bytes`);
