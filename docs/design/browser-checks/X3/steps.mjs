// Generic steps runner for dev/fx.html. The plan is a JSON file named by FX_PLAN:
// [{ clock?: true, eval?: string, run?: number, scrub?: number, wait?: number, snap?: string, full?: string, log?: string, css?: boolean }]
//   clock: install Playwright's fake clock and pause it (rAF, timers and performance.now then advance only with `run`)
//   eval:  JS evaluated in the page
//   run:   advance the fake clock by ms (canvas particles move; WAAPI animations do not follow the fake clock)
//   scrub: pause every animation under #board and set its currentTime to ms (DOM effects)
//   wait:  real ms
//   snap:  screenshot clipped to the board (+ margin); css: true = 1x scale
//   full:  whole viewport
//   log:   JS evaluated in the page, result printed
import { readFileSync } from 'node:fs';

export default async ({ page, shot }) => {
  const plan = JSON.parse(readFileSync(process.env.FX_PLAN, 'utf8'));
  const dir = process.env.FX_OUT;
  const margin = Number(process.env.FX_MARGIN ?? 36);
  const view = page.viewportSize();
  const box = await page.evaluate(m => {
    const r = document.getElementById('board').getBoundingClientRect();
    return { x: Math.max(0, r.left - m), y: Math.max(0, r.top - m), right: r.right + m, bottom: r.bottom + m };
  }, margin);
  const clip = { x: box.x, y: box.y, width: Math.min(view.width, box.right) - box.x, height: Math.min(view.height, box.bottom) - box.y };
  const t0 = Date.now();
  for (const step of plan) {
    if (step.clock) { await page.clock.install(); await page.clock.pauseAt(Date.now() + 1000); await page.clock.runFor(100); }
    if (step.eval) await page.evaluate(`void (${step.eval})`);
    if (step.run) await page.clock.runFor(step.run);
    if (step.scrub !== undefined) {
      await page.evaluate(ms => {
        for (const a of document.getElementById('board').getAnimations({ subtree: true })) { a.pause(); a.currentTime = ms; }
      }, step.scrub);
    }
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.snap) {
      let area = clip;
      if (step.around) {
        area = await page.evaluate(([row, col, rw, rh]) => {
          const r = document.getElementById('board').getBoundingClientRect(), c = __lab.cell();
          const x = r.left + (0.6 + col) * c, y = r.top + (0.8 + row) * c;
          const x0 = Math.max(0, x - rw * c), y0 = Math.max(0, y - rh * c);
          return { x: x0, y: y0, width: Math.min(innerWidth, x + rw * c) - x0, height: Math.min(innerHeight, y + rh * c) - y0 };
        }, [step.around[0], step.around[1], step.around[2], step.around[3] ?? step.around[2]]);
      }
      await page.screenshot({ path: `${dir}/${step.snap}.png`, clip: area, scale: step.css ? 'css' : 'device' }); console.error(`snap ${step.snap} @${Date.now() - t0}ms`); }
    if (step.full) await shot(step.full);
    if (step.log) console.error('LOG', step.log, JSON.stringify(await page.evaluate(step.log)));
  }
};
