// node montage.mjs out.png cols a.png b.png ...   -> a contact sheet rendered through headless Chrome
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const [out, cols, ...files] = process.argv.slice(2);
const w = Number(process.env.FRAME_W ?? 590);
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:4px;padding:4px;font:12px monospace;color:#fff">` +
  files.map((f) => `<figure style="margin:0"><img src="${pathToFileURL(f).href}" style="width:${w}px;display:block"><figcaption>${f.split(/[\/]/).pop()}</figcaption></figure>`).join('') + '</body>';
const page_html = out.replace(/\.png$/, '.html');
writeFileSync(page_html, html);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: cols * (w + 4) + 4, height: 800 } });
await page.goto(pathToFileURL(page_html).href, { waitUntil: 'load' });
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
