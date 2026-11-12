import { LAB } from './lab.mjs';
export default async ({ page }) => {
  await page.addScriptTag({ content: LAB });
  const out = await page.evaluate(async () => {
    const { render, stats } = await window.lab();
    const res = {};
    for (const name of ['ui.tap', 'hint.3', 'place', 'praise.good', 'select']) {
      for (const when of [0.045, 0.05]) {
        const r = await render({ seconds: 3.2, job: a => a.play(name, { when }) });
        res[name + '@' + when] = stats(r.buffer);
      }
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
};
