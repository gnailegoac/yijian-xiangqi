// Prints the boxes of the shell regions and of the characters (shell preview mode).
export default async ({ page, shot }) => {
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => {
    const out = {};
    for (const sel of ['#app', '#topbar', '#stage', '#board', '#underbar', '#coach', '#buddy', '#chat', '#actions', '.buddy-fig', '.bubble', '.rival', '.rival__disc', '.rival__say']) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const r = el.getBoundingClientRect();
      out[sel] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(' ');
    }
    out.vars = ['--buddy-h', '--top', '--panel-w', '--c'].map((v) => `${v}=${getComputedStyle(document.querySelector('#app')).getPropertyValue(v)}`).join(' ');
    out.layout = document.querySelector('#app').dataset.layout;
    return out;
  });
  console.log('RECTS ' + JSON.stringify(rows));
  if (process.env.X5_SHOT) await shot(process.env.X5_SHOT);
};
