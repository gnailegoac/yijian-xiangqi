// Measures how far the drawing reaches beyond its figure box for every mood (and the point gesture).
// Exact: samples every visible outline through its screen matrix. Values in CSS px; positive = outside.
export default async ({ page }) => {
  const rows = await page.evaluate(async () => {
    const moods = ['idle', 'listening', 'thinking', 'curious', 'pleased', 'impressed', 'worried', 'alarmed', 'cheering', 'consoling'];
    const host = document.querySelector('#buddy');
    const out = [];
    const measure = (name) => {
      const h = host.getBoundingClientRect();
      const fig = host.querySelector('.buddy-fig').getBoundingClientRect();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const el of host.querySelectorAll('.b-fig path, .b-fig circle, .b-fig ellipse, .b-fig rect')) {
        if (!el.getClientRects().length) continue;                      // display: none
        const m = el.getScreenCTM();
        const len = el.getTotalLength();
        const half = (parseFloat(getComputedStyle(el).strokeWidth) || 0) / 2 * Math.hypot(m.a, m.b);
        for (let i = 0; i <= 40; i++) {
          const p = el.getPointAtLength((len * i) / 40).matrixTransform(m);
          x0 = Math.min(x0, p.x - half); x1 = Math.max(x1, p.x + half); y0 = Math.min(y0, p.y - half); y1 = Math.max(y1, p.y + half);
        }
      }
      out.push({ name, hostLeft: Math.round(h.left - x0), figLeft: Math.round(fig.left - x0), figRight: Math.round(x1 - fig.right), top: Math.round(fig.top - y0), bottom: Math.round(y1 - fig.bottom) });
    };
    for (const m of moods) { window.buddy.setMood(m, { instant: true }); measure(m); }
    window.buddy.setMood('idle', { instant: true });
    window.buddy.react('point');
    await new Promise((r) => setTimeout(r, 100));
    measure('point');
    return out;
  });
  console.log('EXTENT ' + JSON.stringify(rows));
};
