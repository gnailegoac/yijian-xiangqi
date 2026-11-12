// Per-frame cost of the fx loop under CPU throttling (SPEC §10.6: <= 2 ms of JS per frame at x4).
// Wraps the rAF callback named `frame` (the fx loop) and records its duration and the gap between frames.
export default async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const measure = (label, spawn, ms) => page.evaluate(async ([code, duration]) => {
    const fx = __lab.fx; fx.clear();
    const raf = window.requestAnimationFrame; const js = [], gaps = [], lives = []; let last = 0;
    window.requestAnimationFrame = cb => raf(cb.name !== 'frame' ? cb : now => {
      const t0 = performance.now(); cb(now); js.push(performance.now() - t0);
      if (last) gaps.push(now - last); last = now; lives.push(fx.live);
    });
    const T = __lab.pt(3, 4), P = __lab.pt(7, 4);
    const t0 = performance.now();
    while (performance.now() - t0 < duration) { if (fx.live === 0) new Function('fx', 'T', 'P', code)(fx, T, P); await new Promise(raf); }
    window.requestAnimationFrame = raf; fx.clear();
    const sort = a => a.slice().sort((x, y) => x - y), pct = (a, p) => sort(a)[Math.floor(a.length * p)] ?? 0;
    return { frames: js.length, jsAvg: +(js.reduce((a, b) => a + b, 0) / js.length).toFixed(2), jsP95: +pct(js, 0.95).toFixed(2), jsMax: +Math.max(...js).toFixed(2),
      gapMedian: +pct(gaps, 0.5).toFixed(1), gapP95: +pct(gaps, 0.95).toFixed(1), peakLive: Math.max(...lives), q: __lab.q() };
  }, [spawn, ms]).then(r => console.error(label.padEnd(44), JSON.stringify(r)));

  const loads = [
    ['cannon + check, all at once (90)', "fx.burst('sparks', P, {n:6, dir:0}); fx.trail(P, T); fx.burst('explosion', T); fx.burst('sparks', T, {n:16})"],
    ['confetti + stars (154)', "fx.confetti(); fx.burst('stars', T, {n:14})"],
    ['pool full (320)', 'for (let i = 0; i < 4; i++) fx.confetti()'],
  ];
  for (const rate of [1, 4, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const [name, code] of loads) await measure(`x${rate} ${name}`, code, 2500);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
};
