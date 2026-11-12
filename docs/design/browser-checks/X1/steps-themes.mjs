export default async ({ page, shot }) => {
  for (const theme of ['chibi', 'longzhong', 'shachang']) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(120);
    await shot(theme);
  }
};
