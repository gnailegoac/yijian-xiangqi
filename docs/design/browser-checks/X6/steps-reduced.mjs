// Reduced motion: the caret is steady, nothing loops, text appears at once per push.
export default async ({ page }) => {
  await page.waitForSelector('html[data-ready="1"]');
  const dir = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X6';
  const coach = await page.evaluate(() => { const r = document.querySelector('#coach').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  page.evaluate(() => { window.__dev.run.tryLine(); });
  await page.waitForTimeout(1500);
  const a = await page.evaluate(() => {
    const el = document.querySelector('.bubble__text');
    const cs = getComputedStyle(el, '::after');
    const running = document.getAnimations().filter((x) => x.playState === 'running').map((x) => x.animationName || x.constructor.name);
    return { motion: document.documentElement.dataset.motion, len: el.textContent.length, streaming: el.classList.contains('is-streaming'), reducedClass: el.classList.contains('is-reduced'),
             caret: [cs.width, cs.height, cs.opacity, cs.animationName], running };
  });
  console.log('reduced', JSON.stringify(a));
  await page.screenshot({ path: `${dir}/red-1.png`, clip: coach });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__dev.chat.setChips(window.__dev.CHIPS.hint3); window.__dev.chat.setSheet(true); });
  const b = await page.evaluate(() => ({ running: document.getAnimations().filter((x) => x.playState === 'running').map((x) => x.animationName || x.constructor.name), sheet: document.querySelector('#chat').dataset.sheet }));
  console.log('reduced after', JSON.stringify(b));
  await page.screenshot({ path: `${dir}/red-2.png`, clip: coach });
};
