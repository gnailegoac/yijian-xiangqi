// probe: zero-wait touch, measured in the page: touch -> selected / trial / committed marks
export default async ({ page }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.evaluate(() => window.__dev.startScene('opening'));
  await w(900);
  await page.evaluate(() => {
    window.__lat = [];
    let t0 = 0, label = '';
    const mark = (what) => { window.__lat.push([label, what, Math.round(performance.now() - t0)]); };
    window.addEventListener('pointerdown', () => { t0 = performance.now(); label = `tap${window.__lat.filter((r) => r[1] === 'down').length + 1}`; mark('down'); }, true);
    const seen = new Set();
    const obs = new MutationObserver(() => {
      const checks = { selected: !!document.querySelector('.piece.is-selected'), trial: !!document.querySelector('.piece.is-trial'), phaseTentative: document.querySelector('#app').dataset.phase === 'tentative',
        ply1: document.querySelector('#app').dataset.ply === '1', mood: document.querySelector('#buddy svg.buddy').dataset.mood !== 'idle' };
      for (const [k, v] of Object.entries(checks)) if (v && !seen.has(k)) { seen.add(k); mark(k); }
    });
    obs.observe(document.documentElement, { subtree: true, attributes: true, childList: true });
  });
  const cell = async (row, col) => { const box = await page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`).boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const a = await cell(9, 7), b = await cell(7, 6);
  await page.touchscreen.tap(a.x, a.y);
  await w(420);
  await page.touchscreen.tap(b.x, b.y);
  await w(900);
  await page.touchscreen.tap(b.x, b.y);
  await w(900);
  console.error(JSON.stringify(await page.evaluate(() => window.__lat)));
};
