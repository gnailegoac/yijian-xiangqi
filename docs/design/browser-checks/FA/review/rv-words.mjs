// Review of FA item 7, the words and the look: 「好，这盘接着下！」 after a resignation is taken back, at the three sizes
// and in the three themes (screenshots, and what the bubble shows).
import { launch, open, sleep, waitReady, idle, waitPhase, centre, tapCell, SIZES, SHOTS } from './lib.mjs';

const LINE = '好，这盘接着下！';
const THEMES = { landscape: 'chibi', portrait: 'longzhong', phone: 'shachang' };
const browser = await launch();
try {
  for (const size of Object.keys(SIZES)) {
    for (const theme of size === 'landscape' ? ['chibi', 'longzhong', 'shachang'] : [THEMES[size]]) {
      const { context, page, errors } = await open(browser, { size, motion: 'reduced' });
      await page.goto(`/?test=1&coach=off&theme=${theme}`, { waitUntil: 'load' });
      await waitReady(page);
      await idle(page);
      // one round, then the child resigns on its own turn
      await tapCell(page, 7, 7); await waitPhase(page, 'selected');
      await tapCell(page, 7, 4); await waitPhase(page, 'tentative');
      await sleep(450);
      await page.locator('#confirm-button').tap();
      await page.waitForFunction(() => document.getElementById('app')?.dataset.ply === '2', null, { timeout: 15000 });
      await idle(page);
      await page.locator('#menu-button').tap();
      await page.locator('.hud-menu__item[data-menu="resign"]').tap();
      await page.locator('dialog[data-dialog="resign"] [data-choice="go"]').tap();
      await waitPhase(page, 'over');
      await page.waitForSelector('dialog[data-dialog="over"] [data-choice="review"]', { timeout: 15000 });
      await sleep(1200);
      await page.locator('dialog[data-dialog="over"] [data-choice="review"]').tap();
      await sleep(1200);
      await page.locator('#undo-button').tap();
      await waitPhase(page, 'childTurn', 5000);
      await sleep(900);
      const info = await page.evaluate(() => {
        const text = document.querySelector('.bubble__text');
        const box = document.querySelector('.bubble');
        if (!(text instanceof HTMLElement) || !(box instanceof HTMLElement)) return null;
        const cs = getComputedStyle(text);
        const r = text.getBoundingClientRect(), b = box.getBoundingClientRect();
        return { text: text.textContent, lines: Math.round(r.height / parseFloat(cs.lineHeight)), font: cs.fontSize, colour: cs.color, bubble: getComputedStyle(box).backgroundColor,
                 inside: r.left >= b.left - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1, inView: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight,
                 ply: document.getElementById('app')?.dataset.ply, theme: document.documentElement.dataset.theme,
                 log: [...document.querySelectorAll('.chat__log .msg[data-role="buddy"]')].slice(-1).map((el) => el.textContent) };
      });
      await page.screenshot({ path: `${SHOTS}/undo-resign-${size}-${theme}.png` });
      const ok = !!info && info.text === LINE && info.lines === 1 && info.inside && info.inView && info.ply === '2';
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${size} ${theme}: ${JSON.stringify(info)} ${errors.length ? JSON.stringify(errors.slice(0, 2)) : ''}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
