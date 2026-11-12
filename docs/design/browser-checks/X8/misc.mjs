export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const D = (fn, a) => page.evaluate(fn, a);
  await w(5200);
  await D(() => window.__dev.act.move(7, 7, 7, 4));
  await w(2600);
  if (process.env.SHEET === '1') {
    await D(() => document.querySelector('#history-button').click());
    await w(700);
  }
  await shot(process.env.NAME ?? 'x');
};
