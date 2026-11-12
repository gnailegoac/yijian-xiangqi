export default async ({ page }) => {
  const log = await page.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    __dev.hud.showStart({ hasSave: false, firstVisit: true, canImport: false });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const b = document.querySelector('#overlays .buddy');
      out.push(`${Math.round(performance.now() - t0)}:${b?.dataset.mood ?? b?.closest('[data-mood]')?.dataset.mood ?? '?'}`);
    }
    return out;
  });
  console.log('MOOD ' + log.join(' '));
};
