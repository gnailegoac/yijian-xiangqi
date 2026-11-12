// Task 2, the motion (full motion, dev/hud.html?figure=cheering): exact frames of the coach column while the game-over
// card comes in (the figure fades out with it) and while it goes with 回看棋局 (he fades back in).
// The transitions the change starts are paused and stepped to fixed times (Web Animations), so every frame is exact;
// the hud's removal timer of the closing card is held until the frames are taken.
import { clip, note } from './lib.mjs';
const TIMES = [0, 50, 100, 150, 200, 250, 300];
export default async ({ page }) => {
  await page.waitForFunction(() => window.__dev);
  await page.waitForTimeout(2200);                                     // the three hops of cheering are over
  const coach = await page.evaluate(() => { const r = document.querySelector('#coach').getBoundingClientRect(); return { x: r.left - 70, y: r.top, width: r.width + 86, height: r.height }; });
  const rows = [];
  const step = async (label) => {
    for (const t of TIMES) {
      const o = await page.evaluate((time) => {
        for (const a of window.__xc) a.currentTime = time;
        const f = document.querySelector('#buddy .buddy-fig'), c = document.querySelector('#overlays .hud-over');
        return { fig: Number(getComputedStyle(f).opacity).toFixed(2), card: c ? Number(getComputedStyle(c).opacity).toFixed(2) : null, n: window.__xc.length };
      }, t);
      await clip(page, `f-${label}-${String(t).padStart(3, '0')}`, coach);
      rows.push(`${label} t=${t} fig=${o.fig} card=${o.card} (${o.n} animations)`);
    }
    await page.evaluate(() => { for (const a of window.__xc) { try { a.finish(); } catch { a.cancel(); } } });
  };
  const arm = () => {                                                  // runs in the page right after the trigger
    void getComputedStyle(document.querySelector('#buddy .buddy-fig')).opacity;       // style flush: the transitions exist now
    window.__xc = document.getAnimations().filter((a) => !window.__old.has(a));
    for (const a of document.getAnimations()) a.pause();
  };
  // the card comes in
  await page.evaluate((armSrc) => {
    window.__old = new Set(document.getAnimations());
    window.__dev.over('win', { type: false });
    (0, eval)(`(${armSrc})`)();
  }, arm.toString());
  await step('in');
  await page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });
  await page.waitForTimeout(900);
  // the card goes (回看棋局); its node would be removed 300 ms later: hold that timer
  await page.evaluate((armSrc) => {
    window.__old = new Set(document.getAnimations());
    const real = window.setTimeout, held = [];
    window.setTimeout = (fn, ms, ...args) => { held.push(() => fn(...args)); return 0; };
    document.querySelector('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
    window.setTimeout = real;
    window.__release = () => { for (const f of held.splice(0)) f(); };
    (0, eval)(`(${armSrc})`)();
  }, arm.toString());
  await step('out');
  await page.evaluate(() => { window.__release(); for (const a of document.getAnimations()) a.play(); });
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => ({ fig: getComputedStyle(document.querySelector('#buddy .buddy-fig')).opacity, card: !!document.querySelector('#overlays .hud-over') }));
  note('FRAMES', rows);
  note('END', end);
};
