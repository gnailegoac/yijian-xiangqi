// Reviewer: a reply that is still awaited + a local line (the takeback offer), then the reply arrives.
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector('html[data-ready="1"]');
  await w(600);
  await page.evaluate(() => { window.__dev.run.oppTakeback(); });
  await w(900);
  await shot('1-offer');
  await w(1900);
  await shot('2-reply-typing');
  await w(4000);
  await shot('3-reply-done');
  await page.evaluate(() => window.__dev.chat.setSheet(true));
  await w(600);
  await shot('4-log');
  // caret frames: start a line and take frames 120 ms apart
  await page.evaluate(() => { window.__dev.chat.setSheet(false); });
  await w(400);
  await page.evaluate(() => { window.__dev.run.praiseLine(); });
  await w(1500);
  for (let i = 0; i < 5; i++) { await shot(`5-caret-${i}`); await w(120); }
};
