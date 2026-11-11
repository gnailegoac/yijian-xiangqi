// Machine-level backstop: kills any system Node process (C:\Program Files\nodejs\node.exe) whose working set passes a
// limit, and logs it. It exists because one runaway test process took 50 GB three times and crashed the build session.
// Usage: node mem-watchdog.mjs <log file> [limit GB = 8] [hours = 10]
// It keeps one PowerShell process alive and asks it once per second (Get-Process only: no WMI, which hangs here).
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [, , logFile, limitGb = '8', hours = '10'] = process.argv;
const limit = Number(limitGb) * 1024;                       // MB
const log = line => fs.appendFileSync(logFile, `${new Date().toISOString().slice(0, 19)}Z ${line}\n`);
const ps = spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
const ask = "Get-Process node -ErrorAction SilentlyContinue | ForEach-Object { $path = ''; try { $path = $_.Path } catch {}; \"P $($_.Id) $([int]($_.WS / 1MB)) $path\" }; 'END'\n";

let buf = '';
let peak = 0;
ps.stdout.on('data', chunk => {
  buf += chunk;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, at).trim();
    buf = buf.slice(at + 1);
    const m = /^P (\d+) (\d+) (.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]), mb = Number(m[2]), exe = m[3];
    if (pid === process.pid || !/\\nodejs\\node\.exe$/i.test(exe)) continue;
    if (mb > peak) { peak = mb; if (mb > 2048) log(`note: pid ${pid} is at ${mb} MB`); }
    if (mb > limit) {
      log(`KILL pid ${pid} at ${mb} MB (limit ${limit} MB)`);
      try { process.kill(pid); } catch (error) { log(`kill failed: ${error.code}`); }
    }
  }
});
ps.on('exit', code => { log(`powershell ended (${code}); watchdog stops`); process.exit(1); });

log(`watchdog started: limit ${limit} MB, for ${hours} h, pid ${process.pid}`);
const timer = setInterval(() => ps.stdin.write(ask), 1000);
setTimeout(() => { clearInterval(timer); log(`watchdog ends after ${hours} h; highest seen ${peak} MB`); ps.stdin.end(); process.exit(0); }, Number(hours) * 3600 * 1000);
