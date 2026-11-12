// Frames of one streamed line, clipped to the bubble, with the text length and the caret state of each frame.
export default async ({ page }) => {
  await page.waitForSelector('html[data-ready="1"]');
  const dir = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X6';
  const prefix = process.env.FRAME_PREFIX ?? 'f';
  const coach = await page.evaluate(() => { const r = document.querySelector('#buddy').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  page.evaluate(() => { window.__dev.run.planLine(); });
  await page.waitForTimeout(1150);
  const log = [];
  for (let i = 0; i < 12; i++) {
    const info = await page.evaluate(() => {
      const el = document.querySelector('.bubble__text');
      const b = el.closest('.bubble').getBoundingClientRect();
      const cs = getComputedStyle(el, '::after');
      return { t: Math.round(performance.now()), len: el.textContent.length, streaming: el.classList.contains('is-streaming'), caret: [cs.width, cs.height, cs.opacity, cs.animationName],
               top: b.top, bottom: b.bottom };
    });
    log.push(info);
    await page.screenshot({ path: `${dir}/${prefix}-${String(i).padStart(2, '0')}.png`, clip: { x: coach.x, y: Math.max(0, info.bottom - 100), width: coach.w, height: 104 } });
  }
  for (const row of log) console.log('frame', JSON.stringify(row));
};
