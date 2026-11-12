// dev panel, black side, start overlay variants
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const D = (fn, arg) => page.evaluate(fn, arg);
  await page.click('#dev-toggle');
  await w(400); await shot('panel');
  await page.click('#dev-toggle');
  await D(() => window.__dev.startScene('opening', { deal: true, human: 'black' }));
  await w(4200); await shot('black');
  await D(() => window.__dev.act.move(2, 1, 2, 4));
  await w(1500); await shot('black-trial');
  await D(() => { window.__dev.raw.start({ hasSave: true, firstVisit: false, canImport: false }); });
  await w(1700); await shot('start-save');
  await page.click('[data-choice="continue"]');
  await w(800);
  await D(() => { window.__dev.raw.start({ hasSave: false, firstVisit: true, canImport: true }); });
  await w(1700); await shot('start-import');
};
