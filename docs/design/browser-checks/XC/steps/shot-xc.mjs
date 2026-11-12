// Open a page in headless Chrome, optionally run steps, take screenshots, and report errors.
// Usage:
//   node shot.mjs --url http://127.0.0.1:5201/dev/board.html --out C:\path\shot.png
//        [--w 1180 --h 820] [--touch] [--dark] [--reduced] [--wait 800] [--full]
//        [--steps C:\path\steps.mjs]
// --steps: an ES module that default-exports async ({ page, shot }) => { ... }.
//          `shot(name)` saves another screenshot next to --out as <out-without-ext>-<name>.png.
//          Use it to click, type, wait and capture several states in one run.
// Prints one JSON object: { ok, title, viewport, consoleErrors, pageErrors, failedRequests, shots, overflowX }.
// Exit code 1 when the page threw, a request failed, or the steps module threw.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');

const flag = name => process.argv.includes(`--${name}`);
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const url = arg('url');
const out = arg('out');
if (!url || !out) { console.error('need --url and --out'); process.exit(2); }
const width = Number(arg('w', '1180'));
const height = Number(arg('h', '820'));
const wait = Number(arg('wait', '600'));

const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const context = await browser.newContext({
  viewport: { width, height }, deviceScaleFactor: 2, hasTouch: flag('touch'), isMobile: flag('touch'),
  colorScheme: flag('dark') ? 'dark' : 'light', reducedMotion: flag('reduced') ? 'reduce' : 'no-preference', locale: 'zh-CN',
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400)); });
page.on('pageerror', error => pageErrors.push(String(error && error.stack ? error.stack : error).slice(0, 800)));
page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });

const shots = [];
const base = out.replace(/\.png$/i, '');
const shot = async name => { const file = name ? `${base}-${name}.png` : `${base}.png`; await page.screenshot({ path: file, fullPage: flag('full') }); shots.push(file); return file; };

let stepError = null;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(wait);
  const steps = arg('steps');
  if (steps) {
    const module = await import(pathToFileURL(steps).href);
    await module.default({ page, shot, context });
  } else {
    await shot('');
  }
} catch (error) {
  stepError = String(error && error.stack ? error.stack : error).slice(0, 1200);
}
const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => null);
const title = await page.title().catch(() => '');
// XC copy of tools/shot.mjs: today Chrome sometimes does not exit after Browser.close and Playwright then waits for
// ever (its fallback is taskkill, which hangs on this machine). So: report first, ask Chrome for its process ids,
// close with a deadline, and end the processes directly when the deadline passes.
const ok = !stepError && pageErrors.length === 0 && failedRequests.length === 0;
console.log(JSON.stringify({ ok, title, viewport: { width, height }, consoleErrors, pageErrors, failedRequests, stepError, shots, overflowX }, null, 1));
let pids = [];
try {
  const cdp = await browser.newBrowserCDPSession();
  const info = await Promise.race([cdp.send('SystemInfo.getProcessInfo'), new Promise((r) => setTimeout(r, 3000, null))]);
  if (info) pids = info.processInfo.map((p) => p.id);
} catch { /* no process list: close() alone has to do */ }
const closing = browser.close().then(() => 'closed', () => 'closed');
const first = await Promise.race([closing, new Promise((r) => setTimeout(r, 5000, 'late'))]);
if (first === 'late') {
  console.error('XC-SHOT close was late, ending chrome processes ' + pids.join(','));
  for (const pid of pids) { try { process.kill(pid); } catch { /* already gone */ } }
  await Promise.race([closing, new Promise((r) => setTimeout(r, 8000))]);
}
process.exit(ok ? 0 : 1);
