// other sizes: a trial with comment, then the win (rays, confetti), the replay ribbon, the card
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const D = (fn, arg) => page.evaluate(fn, arg);
  await D(() => window.__dev.startScene('opening'));
  await w(800);
  await D(() => window.__dev.act.move(7, 7, 7, 4));
  await w(2600); await shot('trial');
  await D(() => window.__dev.moment.mate());
  await w(2400);
  await D(() => window.__dev.act.confirm());
  await w(3900); await shot('win');
  await page.waitForSelector('.stage-ribbon', { timeout: 15000 });
  await w(1000); await shot('replay');
  await D(() => window.__dev.cardUp());
  await w(1200); await shot('card');
};
