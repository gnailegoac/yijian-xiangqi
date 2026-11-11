// Watchdog thread of memguard.mjs: kills the whole process when its resident memory passes the limit.
const fs = require('node:fs');

const limit = Number(process.env.MEM_LIMIT_MB || 3000);
const log = process.env.MEM_LOG;
let n = 0;
setInterval(() => {
  const mb = process.memoryUsage.rss() / 1048576;
  if (log && ++n % 10 === 0) fs.appendFileSync(log, `${new Date().toISOString().slice(11, 19)} rss ${mb.toFixed(0)} MB\n`);
  if (mb > limit) {
    const line = `MEMGUARD: resident size ${mb.toFixed(0)} MB is over the limit of ${limit} MB: killing process ${process.pid}\n`;
    try { fs.writeSync(2, line); } catch { /* stderr closed */ }
    if (log) fs.appendFileSync(log, line);
    process.kill(process.pid);
  }
}, 100);
