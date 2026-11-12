// Review of FA item 11 in the real page: the reload line. Must not appear on a slow but healthy start (every module
// request delayed), must go when the page comes up late after all, must appear when a module fails, and must be
// readable at the three sizes in the three themes' skeleton (screenshots, colours measured).
// Usage: node rv-boot.mjs [slow|late|fail|look|all]
import { launch, open, sleep, SIZES, SHOTS } from './lib.mjs';

const [what = 'all'] = process.argv.slice(2);
const LINE = '棋局没能打开，点这里重新加载';

/** Watches from navigation on: when the line was there, when the start card came. */
async function watch(page, ms) {
  const seen = { lineAt: -1, lineGoneAt: -1, cardAt: -1, lineNow: false };
  const started = Date.now();
  while (Date.now() - started < ms) {
    const s = await page.evaluate(() => ({ line: document.querySelector('.boot-fail') !== null, card: document.querySelector('dialog[data-dialog="start"]') !== null })).catch(() => null);
    const t = Date.now() - started;
    if (s) {
      if (s.line && seen.lineAt < 0) seen.lineAt = t;
      if (!s.line && seen.lineAt >= 0 && seen.lineGoneAt < 0) seen.lineGoneAt = t;
      if (s.card && seen.cardAt < 0) seen.cardAt = t;
      seen.lineNow = s.line;
    }
    await sleep(200);
  }
  return seen;
}

const browser = await launch();
try {
  if (what === 'slow' || what === 'all') {
    // a healthy start on a slow link: every module and stylesheet request takes `delay` ms more
    for (const delay of [400, 1500, 2500]) {
      const { context, page, errors } = await open(browser, { size: 'landscape', motion: 'reduced' });
      let requests = 0;
      await page.route(/\/(src|styles)\//, async (route) => { requests += 1; await sleep(delay); await route.continue().catch(() => {}); });
      const t0 = Date.now();
      const nav = page.goto('/', { waitUntil: 'load', timeout: 90000 }).then(() => Date.now() - t0);
      const seen = await watch(page, Math.max(26000, delay * 16));
      const loadAt = await nav;
      const ok = seen.lineAt < 0 && seen.cardAt >= 0;
      console.log(`${ok ? 'OK  ' : 'FAIL'} slow start, +${delay} ms per request (${requests} requests): load event at ${loadAt} ms, start card at ${seen.cardAt} ms, reload line ${seen.lineAt < 0 ? 'never' : `at ${seen.lineAt} ms`} (watched ${Math.max(26000, delay * 16)} ms) errors ${JSON.stringify(errors.slice(0, 2))}`);
      await context.close();
    }
  }

  if (what === 'late' || what === 'all') {
    // the modules load, nothing is drawn for 11 s, then the game starts after all: the line must come and go again
    const { context, page } = await open(browser, { size: 'portrait', motion: 'reduced' });
    await page.route('**/src/app.js', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('real')) { await route.continue(); return; }
      await route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: 'setTimeout(() => { import("./app.js?real=1"); }, 11000);\n' });
    });
    const t0 = Date.now();
    await page.goto('/', { waitUntil: 'load' });
    const loadAt = Date.now() - t0;
    const seen = await watch(page, 16000);
    let tapped = 'no start card';
    if (seen.cardAt >= 0) {
      const go = page.locator('dialog[data-dialog="start"] [data-choice="new"], dialog[data-dialog="start"] [data-choice="continue"]').first();
      await go.tap({ timeout: 5000 }).then(() => { tapped = 'start card tapped'; }).catch((e) => { tapped = `tap failed: ${e.message.split('\n')[0]}`; });
      await sleep(2500);
      tapped += `, phase ${await page.evaluate(() => document.getElementById('app')?.dataset.phase)}`;
    }
    const ok = seen.lineAt >= 0 && seen.lineGoneAt >= 0 && !seen.lineNow && seen.cardAt >= 0 && tapped.includes('childTurn');
    console.log(`${ok ? 'OK  ' : 'FAIL'} late start: load at ${loadAt} ms, line at ${seen.lineAt} ms, start card at ${seen.cardAt} ms, line gone at ${seen.lineGoneAt} ms, line now ${seen.lineNow}; ${tapped}`);
    await context.close();
  }

  if (what === 'fail' || what === 'all') {
    for (const size of Object.keys(SIZES)) {
      const { context, page } = await open(browser, { size, motion: 'reduced' });
      await page.route('**/src/coach/client.js', (route) => route.abort('connectionfailed'));
      const t0 = Date.now();
      await page.goto('/', { waitUntil: 'load' });
      await page.waitForSelector('.boot-fail button', { timeout: 12000 }).catch(() => {});
      const at = Date.now() - t0;
      const info = await page.evaluate(() => {
        const b = document.querySelector('.boot-fail button');
        if (!(b instanceof HTMLElement)) return null;
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { text: b.textContent, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], onTop: top === b,
                 font: getComputedStyle(b).fontSize, vw: innerWidth, vh: innerHeight };
      });
      await page.unroute('**/src/coach/client.js');
      let after = 'no line';
      if (info) {
        await page.locator('.boot-fail button').tap();
        await page.waitForSelector('dialog[data-dialog="start"]', { timeout: 15000 }).then(() => { after = 'reloaded into the start card'; }).catch(() => { after = 'no start card after the tap'; });
        after += `, line still there: ${await page.locator('.boot-fail').count() > 0}`;
      }
      const ok = !!info && info.text === LINE && info.onTop && info.box[0] >= 0 && info.box[0] + info.box[2] <= info.vw && info.box[3] >= 44 && after.startsWith('reloaded') && after.endsWith('false');
      console.log(`${ok ? 'OK  ' : 'FAIL'} module fails @${size}: line after ${at} ms ${JSON.stringify(info)}; ${after}`);
      await context.close();
    }
  }

  if (what === 'look' || what === 'all') {
    // the three themes' skeleton at the three sizes: the page never comes up, the theme attribute is what index.html
    // or an earlier visit left (set here by hand), the line is measured and photographed
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const parse = (text) => (text.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    for (const size of Object.keys(SIZES)) {
      for (const theme of ['chibi', 'longzhong', 'shachang']) {
        const { context, page } = await open(browser, { size, motion: 'reduced' });
        await page.route('**/src/ui/hud.js', (route) => route.abort('connectionfailed'));
        await page.goto('/', { waitUntil: 'load' });
        await page.waitForSelector('.boot-fail button', { timeout: 12000 }).catch(() => {});
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);      // as a stage that failed half-way leaves it
        await sleep(300);
        const info = await page.evaluate(() => {
          const b = document.querySelector('.boot-fail button');
          if (!(b instanceof HTMLElement)) return null;
          const cs = getComputedStyle(b);
          const r = b.getBoundingClientRect();
          return { color: cs.color, background: cs.backgroundColor, font: `${cs.fontSize} ${cs.fontWeight}`, lines: Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight)),
                   box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], theme: document.documentElement.dataset.theme,
                   page: getComputedStyle(document.body).backgroundColor };
        });
        await page.screenshot({ path: `${SHOTS}/bootfail-${size}-${theme}.png` });
        const contrast = info ? ratio(parse(info.color), parse(info.background)).toFixed(2) : 'n/a';
        console.log(`${info && Number(contrast) >= 4.5 ? 'OK  ' : 'FAIL'} look @${size} ${theme}: ${JSON.stringify(info)} contrast ${contrast}`);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
