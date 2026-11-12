// XD review: the first tap with the browser's real autoplay policy switched on (headless Chrome lets an AudioContext
// run without a gesture by default; an iPad does not). With --autoplay-policy=document-user-activation-required a
// finger's pointerdown is no activation: the context is created suspended and runs only after the finger has lifted,
// which is the path Safari takes. Runs a steps file of tools/shot.mjs in such a browser.
//   node policy-run.mjs --url <page> --steps <file.mjs> --out <png base> [--w 1180 --h 820] [--mouse]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const touch = !process.argv.includes('--mouse');

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--autoplay-policy=document-user-activation-required'] });
const context = await browser.newContext({ viewport: { width: Number(arg('w', '1180')), height: Number(arg('h', '820')) }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, locale: 'zh-CN' });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 400)));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
const base = arg('out').replace(/\.png$/i, '');
const shot = async name => { await page.screenshot({ path: `${base}-${name}.png` }); };
let stepError = null;
try {
  await page.goto(arg('url'), { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(600);
  const module = await import(pathToFileURL(arg('steps')).href);
  await module.default({ page, shot, context });
} catch (error) {
  stepError = String(error && error.stack ? error.stack : error).slice(0, 1500);
}
await browser.close();
console.log(JSON.stringify({ ok: !stepError && pageErrors.length === 0, pageErrors, consoleErrors, stepError }, null, 1));
process.exit(stepError || pageErrors.length ? 1 : 0);
