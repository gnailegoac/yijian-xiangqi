// G4: the compact stage shrinks to the miniature when the sheet opens. Frames every ~70 ms with data-motion="full".
export default async ({ page, shot }) => {
  await page.evaluate(async () => {
    document.documentElement.dataset.motion = 'full';
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    window.__set = (sheet) => { const app = document.getElementById('app'); applyLayout(app, computeLayout({ W: innerWidth, H: innerHeight, visibleH: innerHeight, sheet }), null); app.dataset.sheet = sheet ? '1' : '0'; };
    window.__set(false);
  });
  await page.waitForTimeout(150);
  await shot('f0');
  await page.evaluate(() => window.__set(true));
  for (let i = 1; i <= 4; i++) { await page.waitForTimeout(45); await shot('f' + i); }
  await page.waitForTimeout(300);
  await shot('f5');
  const t = await page.evaluate(() => getComputedStyle(document.getElementById('stage')).transition);
  await page.evaluate(() => window.__set(false));
  await page.waitForTimeout(90);
  await shot('back-mid');
  console.log(JSON.stringify({ transition: t }));
};
