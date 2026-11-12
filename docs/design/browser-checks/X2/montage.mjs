// Build a contact sheet (one PNG) from several PNG files using a headless page. Usage: node montage.mjs out.png cols scale crop a.png b.png ...
// crop = "x,y,w,h" in source pixels or "-" for none.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const [out, cols, scale, crop, ...files] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
const imgs = files.map((f) => ({ name: f.replace(/^.*[\/]/, '').replace(/\.png$/, ''), src: `data:image/png;base64,${readFileSync(f).toString('base64')}` }));
const c = crop === '-' ? null : crop.split(',').map(Number);
await page.setContent(`<body style="margin:0;background:#222;font:12px monospace;color:#fff"><div id="g" style="display:grid;grid-template-columns:repeat(${cols},max-content);gap:4px;padding:4px;width:max-content">${imgs.map((i) => `<figure style="margin:0"><div style="overflow:hidden;${c ? `width:${c[2] * scale}px;height:${c[3] * scale}px` : ''}"><img src="${i.src}" style="display:block;transform-origin:0 0;${c ? `transform:scale(${scale}) translate(${-c[0]}px,${-c[1]}px)` : `zoom:${scale}`}"></div><figcaption>${i.name}</figcaption></figure>`).join('')}</div></body>`);
await page.waitForTimeout(300);
await page.locator('#g').screenshot({ path: out });
await browser.close();
console.log('ok', out);
