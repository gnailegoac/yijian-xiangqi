// montage.mjs <out.png> <cols> <scale> <label=file>...   : a labelled contact sheet of PNG files (headless Chrome).
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const [out, cols, scale, ...items] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const cells = items.map((it) => { const i = it.indexOf('='); const label = it.slice(0, i), file = it.slice(i + 1); return `<figure><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"><figcaption>${label}</figcaption></figure>`; }).join('');
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0;background:#444;font:600 14px system-ui;color:#fff"><div id="g" style="display:inline-grid;grid-template-columns:repeat(${cols},auto);gap:6px;padding:6px">${cells}</div><style>figure{margin:0}img{display:block;zoom:${scale};image-rendering:pixelated}figcaption{padding:2px 4px;background:#000}</style></body>`);
await page.waitForTimeout(300);
await page.locator('#g').screenshot({ path: out });
await browser.close();
console.log('montage', out);
