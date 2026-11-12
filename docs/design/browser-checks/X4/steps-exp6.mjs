import { LAB } from './lab.mjs';
export default async ({ page }) => {
  await page.addScriptTag({ content: LAB });
  const out = await page.evaluate(async () => {
    const { render, stats } = await window.lab();
    const res = {};
    for (const name of ['ui.tap', 'capture', 'win', 'trial.confirm', 'place', 'move.king']) {
      res[name] = {};
      for (const at of [0.05, 0.2, 0.5, 1.0, 2.0, 4.0]) {
        const r = await render({ seconds: at + 4.2, job: a => a.play(name, { when: at - 0.005, scale: 1.25 }) });
        res[name][at] = stats(r.buffer).peak;
      }
    }
    return res;
  });
  for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), Object.entries(v).map(([t, p]) => `${t}s: ${p}`).join('   '));
};
