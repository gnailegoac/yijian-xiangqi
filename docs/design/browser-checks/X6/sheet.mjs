// Contact sheet: crops the same rectangle out of several screenshots and lays them out in a grid.
// node sheet.mjs --out sheet.png --crop x,y,w,h (CSS px of the original viewport) --cols 4 --scale 0.6 a.png b.png ...
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = opt('out', 'sheet.png');
const [cx, cy, cw, ch] = opt('crop', '0,0,1180,820').split(',').map(Number);
const cols = Number(opt('cols', '4'));
const scale = Number(opt('scale', '0.6'));
const files = args.map((f) => resolve(f));
const w = Math.round(cw * scale), h = Math.round(ch * scale);
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#888;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;padding:6px;font:12px/16px sans-serif;color:#fff}
figure{margin:0}div{width:${w}px;height:${h}px;overflow:hidden;position:relative}
img{position:absolute;left:${-cx * scale}px;top:${-cy * scale}px;transform-origin:0 0}
figcaption{background:#222;padding:1px 4px}</style>
${files.map((f) => `<figure><div><img src="${pathToFileURL(f).href}" data-f="1"></div><figcaption>${basename(f)}</figcaption></figure>`).join('')}
<script>for(const img of document.images){const f=()=>{img.style.width=(img.naturalWidth/2*${scale})+'px'};if(img.complete)f();else img.onload=f}</script>`;
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const rows = Math.ceil(files.length / cols);
await page.setViewportSize({ width: cols * (w + 6) + 6, height: rows * (h + 24) + 12 });
const tmp = resolve(out + '.html'); writeFileSync(tmp, html); await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(out), fullPage: true });
await browser.close();
console.log(out, files.length);
