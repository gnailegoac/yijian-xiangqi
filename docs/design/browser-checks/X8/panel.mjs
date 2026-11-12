export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await w(1200);
  await shot('closed');
  await page.click('#dev-toggle');
  await w(300);
  await shot('open');
  // press a few raw buttons through the panel itself
  const press = async (label) => { await page.locator('#dev button', { hasText: label }).first().click(); };
  await press('tentative 瞄准'); await w(700);
  await press('v blunder 稳住+问'); await w(500);
  await page.click('#dev-toggle'); await w(200);
  await shot('raw-blunder-held');
  await page.click('#dev-toggle'); await w(200);
  await press('主公英明！+招式'); await w(1700);
  await page.click('#dev-toggle'); await w(600);
  await shot('raw-lord');
  await page.click('#dev-toggle'); await w(200);
  await press('沙场'); await w(400);
  await press('精简'); await w(300);
  await press('对方 吃大子'); await w(900);
  await page.click('#dev-toggle'); await w(200);
  await shot('raw-shachang-reduced-lostbig');
  const log = await page.evaluate(() => window.__dev.logLines.slice(-12));
  console.error(log.join('\n'));
};
