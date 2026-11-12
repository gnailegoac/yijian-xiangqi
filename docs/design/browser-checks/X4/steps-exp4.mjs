import { LAB } from './lab.mjs';
export default async ({ page }) => {
  await page.addScriptTag({ content: LAB });
  const out = await page.evaluate(async () => {
    const { render, stats } = await window.lab();
    const res = {};
    for (const when of [0.045, 0.3, 1.0, 1.7321, 2.5]) {
      const r = await render({ seconds: 6, job: a => a.play('praise.great', { when }) });
      res['great@' + when] = stats(r.buffer);
    }
    return res;
  });
  console.log(JSON.stringify(out));
};
