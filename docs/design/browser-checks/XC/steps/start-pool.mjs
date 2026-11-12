// The greeter of the start overlay has its own pool of light (hud.css restates inset and background of
// .buddy-fig::before). Proof that the change of buddy.css does not reach it: the computed style of his ::before, and
// the same picture with the reviewed (old) base rule of buddy.css injected over the new one.
import { clip, note } from './lib.mjs';
export default async ({ page }) => {
  await page.waitForFunction(() => window.__dev);
  await page.evaluate(() => { void window.__dev.start('again'); });
  await page.waitForTimeout(1800);                    // cheering for 1.2 s, then idle
  const cs = await page.evaluate(() => {
    const fig = document.querySelector('#overlays .hud-start__figure .buddy-fig');
    const s = getComputedStyle(fig, '::before');
    return { background: s.backgroundImage, inset: [s.top, s.right, s.bottom, s.left], h: fig.getBoundingClientRect().height, mood: fig.querySelector('svg.buddy').dataset.mood };
  });
  note('GREETER', cs);
  const vw = page.viewportSize();
  const full = { x: 0, y: 0, width: vw.width, height: vw.height };
  await clip(page, 'start-new', full);
  await page.addStyleTag({ content: `.buddy-fig::before { background:
    radial-gradient(50% 9% at 50% 95.5%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 100%),
    radial-gradient(50% 50% at 50% 56%, color-mix(in srgb, var(--wei) 26%, transparent), transparent 100%); } /* the reviewed base rule */` });
  await page.waitForTimeout(300);
  await clip(page, 'start-old-base', full);
};
