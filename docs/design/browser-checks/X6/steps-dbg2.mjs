export default async ({ page }) => {
  await page.waitForSelector('html[data-ready="1"]');
  const dir = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X6';
  await page.evaluate(() => { const d = window.__dev; d.chat.local(d.LINES.plan, { kind: 'hint' }); });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.bubble').getBoundingClientRect();
    const links = [...document.querySelectorAll('.bubble .move-link')].map((el) => {
      const q = el.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return { text: el.textContent, box: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)], hit: hit && (hit.textContent.slice(0, 8) + '|' + hit.className),
               z: [getComputedStyle(el, '::before').zIndex, getComputedStyle(el, '::after').zIndex, getComputedStyle(el).position, getComputedStyle(el).zIndex] };
    });
    return { bubble: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], links };
  });
  console.log('dbg', JSON.stringify(r));
  await page.evaluate(() => { window.__clicks = []; document.addEventListener('click', (e) => window.__clicks.push([e.target.textContent.slice(0, 6), Math.round(e.clientX), Math.round(e.clientY), e.pointerType]), true); });
  for (let i = 0; i < 3; i++) {
    await page.locator('.bubble .move-link[data-move]').nth(i).tap();
    await page.waitForTimeout(100);
  }
  console.log('clicks', JSON.stringify(await page.evaluate(() => window.__clicks)));
  const b = r.bubble;
  await page.screenshot({ path: `${dir}/dbg-bubble.png`, clip: { x: 0, y: b[1] - 10, width: 360, height: b[3] + 20 } });
};
