// node crop.mjs in.png out.png x y w h [zoom]  (device pixels) -> a crop rendered through headless Chrome
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const [src, out, x, y, w, h, zoom = '1'] = process.argv.slice(2);
const z = Number(zoom);
const htmlFile = out.replace(/\.png$/, '.html');
writeFileSync(htmlFile, `<body style="margin:0;overflow:hidden;background:#000"><img src="${pathToFileURL(src).href}" style="position:absolute;left:${-x * z}px;top:${-y * z}px;transform-origin:0 0;transform:scale(${z})"></body>`);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: Math.round(w * z), height: Math.round(h * z) } });
await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
