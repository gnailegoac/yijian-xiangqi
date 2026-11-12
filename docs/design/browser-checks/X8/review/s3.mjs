// the end of a won game at full size: replay ribbon, card, 回看棋局
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const D = (fn, arg) => page.evaluate(fn, arg);
  await D(() => window.__dev.moment.mate());
  await w(2400);
  await D(() => window.__dev.act.confirm());
  await page.waitForSelector('.stage-ribbon', { timeout: 15000 });
  await w(250); await shot('replay-250');
  await w(900); await shot('replay-1150');
  await w(600); await shot('replay-1750');
  await D(() => window.__dev.cardUp());
  await w(5200); await shot('card');
  await page.click('dialog[data-dialog="over"] [data-choice="review"]');
  await w(900); await shot('review');
  await w(2800); await shot('review-later');
};
