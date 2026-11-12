// XD: is the decay of the impulse worth computing once for both channels? Cold code, a fresh page per sample.
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const variants = {
  twice: `(sampleRate) => { const lcg = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
    const len = Math.floor(sampleRate * 1.1); const rnd = lcg(12345); const out = [new Float32Array(len), new Float32Array(len)];
    const t = performance.now();
    for (const data of out) { let lp = 0; for (let i = 0; i < len; i++) { const x = i / len; lp += (rnd() * 2 - 1 - lp) * (0.55 - 0.4 * x); data[i] = lp * (1 - x) ** 2.6; } }
    const ms = performance.now() - t; let h = 0; for (const d of out) for (let i = 0; i < len; i += 97) h = (h * 31 + Math.round(d[i] * 1e9)) | 0; return { ms, h }; }`,
  once: `(sampleRate) => { const lcg = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
    const len = Math.floor(sampleRate * 1.1); const rnd = lcg(12345); const out = [new Float32Array(len), new Float32Array(len)];
    const t = performance.now();
    const decay = new Float64Array(len); for (let i = 0; i < len; i++) decay[i] = (1 - i / len) ** 2.6;
    for (const data of out) { let lp = 0; for (let i = 0; i < len; i++) { const x = i / len; lp += (rnd() * 2 - 1 - lp) * (0.55 - 0.4 * x); data[i] = lp * decay[i]; } }
    const ms = performance.now() - t; let h = 0; for (const d of out) for (let i = 0; i < len; i += 97) h = (h * 31 + Math.round(d[i] * 1e9)) | 0; return { ms, h }; }`,
  noise: `(sampleRate) => { const lcg = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
    const t = performance.now(); const data = new Float32Array(Math.floor(sampleRate * 2)); const rnd = lcg(99); for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
    const ms = performance.now() - t; return { ms, h: 0 }; }`,
};
const med = a => [...a].sort((x, y) => x - y)[(a.length - 1) >> 1];
for (const [name, src] of Object.entries(variants)) {
  const times = []; const hashes = new Set();
  for (let i = 0; i < 9; i++) {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const r = await page.evaluate(`(${src})(48000)`);
    times.push(Math.round(r.ms * 100) / 100); hashes.add(r.h);
    await page.close();
  }
  console.log(name.padEnd(6), 'cold ms: median', med(times), 'worst', Math.max(...times), 'all', JSON.stringify(times), 'hash', [...hashes].join(','));
}
await browser.close();
