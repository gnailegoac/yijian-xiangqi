// Prints the shell commands of an agent transcript that never got a result (they were running when the run was cut off)
// and the background commands it had started. Usage: node pending-cmds.mjs <agent-xxx.jsonl>...
import fs from 'node:fs';
for (const file of process.argv.slice(2)) {
  const pending = new Map();
  const background = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const m = o.message; if (!m || !Array.isArray(m.content)) continue;
    const t = (o.timestamp || '').slice(11, 19);
    for (const c of m.content) {
      if (c.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell')) {
        const cmd = String((c.input || {}).command || '').replace(/\s+/g, ' ');
        pending.set(c.id, `${t} ${cmd.slice(0, 700)}`);
        if ((c.input || {}).run_in_background) background.push(`${t} ${cmd.slice(0, 500)}`);
      } else if (c.type === 'tool_result') pending.delete(c.tool_use_id);
    }
  }
  console.log(`#### ${file.split(/[\/]/).slice(-2).join('/')}`);
  for (const p of pending.values()) console.log(`  NO RESULT: ${p}`);
  for (const b of background.slice(-4)) console.log(`  background: ${b}`);
}
