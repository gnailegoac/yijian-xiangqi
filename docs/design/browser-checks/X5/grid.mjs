// Lays PNGs out in a grid as one image, using Playwright (no image library needed).
// usage: [ZOOM=0.5] node grid.mjs out.png a.png b.png ... [--cols N]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
const colsAt = args.indexOf('--cols');
const cols = colsAt >= 0 ? Number(args.splice(colsAt, 2)[1]) : 1;
const [out, ...files] = args;
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const zoom = process.env.ZOOM ?? '0.5';
const cells = files.map((f) => `<figure style="margin:0"><figcaption>${path.basename(f)}</figcaption><img src="${pathToFileURL(path.resolve(f)).href}" style="display:block;zoom:${zoom}"></figure>`).join('');
const html = `<body style="margin:0;background:#777;font:12px sans-serif;color:#fff"><div id="g" style="display:grid;grid-template-columns:repeat(${cols},max-content);gap:6px;padding:6px;width:max-content">${cells}</div></body>`;
const tmp = path.resolve(path.dirname(out), '_grid.html');
fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8">${html}`);
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
await page.locator('#g').screenshot({ path: out });
await browser.close();
