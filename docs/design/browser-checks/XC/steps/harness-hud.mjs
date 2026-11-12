// The hud harness with its panel: the 军师栏 selector (default: placeholder; then every mood through the <select>),
// and the game-over card with the figure chosen through the selector.
export default async ({ page, shot }) => {
  await page.waitForFunction(() => window.__dev);
  await page.waitForTimeout(400);
  await shot('default');
  const info = await page.evaluate(() => {
    const sel = document.querySelector('#dev-figure');
    const r = sel.getBoundingClientRect();
    return { options: [...sel.options].map((o) => o.value || o.text), value: sel.value, box: [r.left, r.top, r.width, r.height].map(Math.round), buddyChildren: document.querySelector('#buddy').childElementCount };
  });
  console.error('SELECT ' + JSON.stringify(info));
  await page.selectOption('#dev-figure', 'cheering');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ mood: document.querySelector('#buddy svg.buddy')?.dataset.mood ?? null, variant: document.querySelector('#buddy').dataset.variant ?? null, value: document.querySelector('#dev-figure').value }));
  console.error('PICKED ' + JSON.stringify(after));
  await shot('cheering');
  await page.evaluate(() => window.__dev.over('win'));
  await page.waitForTimeout(900);
  const up = await page.evaluate(() => ({ opacity: getComputedStyle(document.querySelector('#buddy .buddy-fig')).opacity, layout: document.querySelector('#app').dataset.layout }));
  console.error('CARD ' + JSON.stringify(up));
  await shot('cheering-card');
  await page.selectOption('#dev-figure', '');
  await page.waitForTimeout(300);
  console.error('BACK ' + JSON.stringify(await page.evaluate(() => ({ buddyChildren: document.querySelector('#buddy').childElementCount, value: document.querySelector('#dev-figure').value }))));
};
