// Captures the shell in the three themes and reports the region boxes.
export default async ({ page, shot }) => {
  const boxes = async () => page.evaluate(() => {
    const ids = ['app', 'topbar', 'stage', 'board', 'underbar', 'coach', 'buddy', 'chat', 'actions', 'overlays'];
    const out = {};
    for (const id of ids) {
      const r = document.getElementById(id).getBoundingClientRect();
      out[id] = [r.left, r.top, r.width, r.height].map(n => Math.round(n * 100) / 100).join(' ');
    }
    out.scroll = `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight} / ${innerWidth}x${innerHeight}`;
    out.layoutAttr = document.getElementById('app').dataset.layout;
    out.fsBody = getComputedStyle(document.body).fontSize;
    return out;
  });
  console.log(JSON.stringify(await boxes(), null, 1));
  for (const theme of ['chibi', 'longzhong', 'shachang']) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(120);
    await shot(theme);
  }
};
