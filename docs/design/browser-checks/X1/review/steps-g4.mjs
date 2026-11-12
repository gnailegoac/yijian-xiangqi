// G4: frames of the compact miniature opening and closing, with the stage's box at each frame.
export default async ({ page, shot }) => {
  await page.evaluate(async () => {
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    document.documentElement.dataset.motion = new URL(location.href).searchParams.get('motion') === 'reduced' ? 'reduced' : 'full';
    const app = document.getElementById('app');
    window.__set = (sheet) => {
      const r = computeLayout({ W: innerWidth, H: innerHeight, visibleH: innerHeight, sheet });
      app.dataset.sheet = sheet ? '1' : '0';
      applyLayout(app, r, window.visualViewport);
    };
    window.__box = () => { const b = document.getElementById('stage').getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10).join(' '); };
    window.__set(false);
  });
  await page.waitForTimeout(100);
  const track = async (label, sheet) => {
    // Sample the box on every animation frame for 400 ms inside the page (no screenshot latency).
    const samples = await page.evaluate((s) => new Promise((resolve) => {
      const out = [];
      const t0 = performance.now();
      window.__set(s);
      const tick = () => {
        out.push(`${Math.round(performance.now() - t0)}ms ${window.__box()}`);
        if (performance.now() - t0 < 400) requestAnimationFrame(tick); else resolve(out);
      };
      requestAnimationFrame(tick);
    }), sheet);
    console.log(label, JSON.stringify(samples.filter((_, i) => i % 3 === 0 || i === samples.length - 1)));
  };
  await track('open', true);
  await shot('open-end');
  await track('close', false);
  await shot('close-end');
  // one visual mid-frame of the closing
  await page.evaluate(() => window.__set(true));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__set(false));
  await page.waitForTimeout(90);
  await shot('close-mid');
};
