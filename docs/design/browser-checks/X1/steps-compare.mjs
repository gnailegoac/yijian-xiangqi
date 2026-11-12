// Measures every region before (CSS-only defaults) and after applyLayout(computeLayout()), prints both and the max difference.
export default async ({ page, shot }) => {
  const measure = () => page.evaluate(() => {
    const ids = ['app', 'topbar', 'stage', 'board', 'underbar', 'coach', 'buddy', 'chat', 'actions', 'overlays'];
    const out = {};
    for (const id of ids) { const r = document.getElementById(id).getBoundingClientRect(); out[id] = [r.left, r.top, r.width, r.height].map(v => Math.round(v * 100) / 100); }
    out.layout = document.getElementById('app').dataset.layout;
    out.c = getComputedStyle(document.getElementById('app')).getPropertyValue('--c');
    out.scrollW = document.documentElement.scrollWidth; out.clientW = document.documentElement.clientWidth;
    out.scrollH = document.documentElement.scrollHeight; out.clientH = document.documentElement.clientHeight;
    return out;
  });
  const before = await measure();
  await shot('pre');
  const result = await page.evaluate(async () => {
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    const app = document.getElementById('app');
    const vv = window.visualViewport;
    const r = computeLayout({ W: innerWidth, H: innerHeight, visibleH: vv ? vv.height : innerHeight, sheet: false });
    applyLayout(app, r, vv);
    return r;
  });
  const after = await measure();
  await shot('post');
  let max = 0; const diffs = {};
  for (const k of Object.keys(before)) if (Array.isArray(before[k])) { const d = before[k].map((v, i) => Math.round(Math.abs(v - after[k][i]) * 100) / 100); diffs[k] = d; max = Math.max(max, ...d); }
  console.log(JSON.stringify({ result, before, after, diffs, max }));
};
