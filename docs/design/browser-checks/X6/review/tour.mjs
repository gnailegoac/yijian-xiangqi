// Reviewer tour: the main states of the chat panel in one run.
export default async ({ page, shot }) => {
  const run = (name, ...args) => page.evaluate(([n, a]) => { window.__dev.run[n](...a); }, [name, args]);
  const w = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector('html[data-ready="1"]');
  await w(900);
  await shot('01-rest');

  await run('tryLine');
  await w(450);
  await shot('02-dots');
  await w(1100);
  await shot('03-typing');
  await w(4500);
  await shot('04-done');

  await run('planLine');
  await w(6500);
  await shot('05-plan');
  // tap the first link
  await page.locator('#buddy .move-link[data-move]').first().tap().catch(async () => { await page.locator('#buddy .move-link[data-move]').first().click(); });
  await w(200);
  await shot('06-link-active');

  await run('heldLine');
  await w(900);
  await shot('07-held');

  await run('oppLine');
  await w(600);
  await shot('08-caption');
  await w(5000);
  await shot('09-opp');

  await run('toolLine');
  await w(1500);
  await shot('10-tool');
  await w(5500);
  await shot('11-tool-answer');

  await run('abortRetract');
  await w(3200);
  await shot('12-stale');

  await page.evaluate(() => window.__dev.chat.setChips(window.__dev.CHIPS.hint3));
  await w(700);
  await shot('13-hint3');

  await run('sheetOpen');
  await w(120);
  await shot('14-sheet-opening');
  await w(500);
  await shot('15-sheet');

  await run('sheetFocus');
  await w(400);
  await page.locator('#chat-input').fill('炮二平五好不好？');
  await w(200);
  await shot('16-input');

  await page.evaluate(() => { document.querySelector('[data-toggle="kb"]').click(); });
  await w(500);
  await shot('17-keyboard');
  await page.evaluate(() => { document.querySelector('[data-toggle="kb"]').click(); });
  await w(300);
  await run('sheetClose');
  await w(500);
  await shot('18-closed');
};
