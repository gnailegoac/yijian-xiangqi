export default async ({ page, shot }) => {
  const box = () => page.evaluate(() => { const c = document.querySelector('dialog[data-dialog="over"]'), b = c.querySelector('.hud-over__buttons'), a = c.querySelector('[data-choice="again"]'); const r = (e) => { const x = e.getBoundingClientRect(); return [x.x, x.y, x.width, x.height].map((v) => +v.toFixed(1)); };
    return { card: r(c), row: r(b), again: r(a), scroll: [c.scrollHeight, c.clientHeight] }; });
  await page.evaluate(() => { document.querySelector('.hud-rotate .hud-btn')?.click(); __dev.over('win'); }); await page.waitForTimeout(3600);
  console.log('BOX ' + JSON.stringify(await box()));
  await shot('overWin');
  await page.evaluate(() => { const c = document.querySelector('dialog[data-dialog="over"]'); c.scrollTop = 80; }); await page.waitForTimeout(200);
  await shot('overWin-scrolled');
  await page.evaluate(() => { __dev.over('draw'); }); await page.waitForTimeout(3600);
  await shot('overDraw');
};
