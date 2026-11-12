// probe: what keeps the main thread busy after the tap on 开战！ (frame gaps, long tasks, marks)
export default async ({ page }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.evaluate(() => {
    window.__m = [];
    const t0 = performance.now();
    window.__mark = (name) => window.__m.push([name, Math.round(performance.now() - t0)]);
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__m.push([`longtask ${Math.round(e.duration)}ms`, Math.round(e.startTime - t0)]); }).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const tick = () => { const n = performance.now(); if (n - last > 34) window.__m.push([`frame gap ${Math.round(n - last)}ms`, Math.round(last - t0)]); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.addEventListener('pointerdown', () => window.__mark('pointerdown'), true);
    window.addEventListener('click', () => window.__mark('click'), true);
    window.addEventListener('audio:unlocked', () => window.__mark('audio:unlocked'));
    const real = window.__dev.real;
    const reset = real.reset.bind(real);
    real.reset = (...a) => { window.__mark('reset()'); const p = reset(...a); window.__mark('reset() returned'); return p; };
    const obs = new MutationObserver(() => { if (!document.querySelector('dialog[data-dialog="start"]')) { window.__mark('start overlay removed'); obs.disconnect(); } });
    obs.observe(document.querySelector('#overlays'), { childList: true, subtree: true });
  });
  await w(600);
  await page.tap('[data-choice="new"]');
  await w(2500);
  console.error(JSON.stringify(await page.evaluate(() => window.__m.sort((a, b) => a[1] - b[1]))).replace(/\],\[/g, '],\n['));
};
