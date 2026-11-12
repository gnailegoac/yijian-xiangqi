// Crops the bottom band (under-bar + actions) and the top bar of several screenshots into one tall PNG via a browser page.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [out, crop, ...files] = process.argv.slice(2);          // crop = "x,y,w,h" in image px, or "full"
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: Number(process.env.VW ?? 2400), height: 900 } });
const [x, y, w, h] = crop === 'full' ? [0, 0, 0, 0] : crop.split(',').map(Number);
const cols = Number(process.env.COLS ?? 1);
const scale = Number(process.env.SCALE ?? 1);
let html = `<body style="margin:0;background:#444;display:grid;grid-template-columns:repeat(${cols},max-content);gap:6px;padding:6px;font:12px sans-serif;color:#fff">`;
for (const f of files) {
  const b64 = readFileSync(f).toString('base64');
  const name = f.split('/').pop();
  html += crop === 'full'
    ? `<div><div>${name}</div><img src="data:image/png;base64,${b64}" style="display:block;zoom:${scale}"></div>`
    : `<div><div>${name}</div><div style="width:${w * scale}px;height:${h * scale}px;overflow:hidden"><img src="data:image/png;base64,${b64}" style="display:block;transform-origin:0 0;transform:scale(${scale}) translate(${-x}px,${-y}px)"></div></div>`;
}
await page.setContent(html + '</body>');
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
