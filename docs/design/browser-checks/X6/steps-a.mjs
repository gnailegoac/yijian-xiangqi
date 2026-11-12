// Landscape tour: streaming frames, done, held, stale, tool, sheet, input, keyboard.
export default async ({ page, shot }) => {
  const dev = (fn, ...args) => page.evaluate(([f, a]) => window.__dev.run[f](...a), [fn, args]);
  await page.waitForSelector('html[data-ready="1"]');
  // 1. streamed try line: dots, then frames of typing
  page.evaluate(() => { window.__dev.run.tryLine(); });
  await page.waitForTimeout(700);
  await shot('01-dots');
  await page.waitForTimeout(650);
  await shot('02-typing-a');
  await page.waitForTimeout(120);
  await shot('03-typing-b');
  await page.waitForTimeout(120);
  await shot('04-typing-c');
  await page.waitForTimeout(2500);
  await shot('05-done');
  // 2. tap the link
  await page.tap('.bubble .move-link');
  await page.waitForTimeout(150);
  await shot('06-link-active');
  // 3. held local line with warn cue + held chips
  await dev('heldLine');
  await page.waitForTimeout(900);
  await shot('07-held');
  // 4. plan line with three links and the play button
  page.evaluate(() => { window.__dev.run.planLine(); });
  await page.waitForTimeout(4200);
  await shot('08-plan');
  // 5. aborted -> stale
  page.evaluate(() => { window.__dev.run.abortRetract(); });
  await page.waitForTimeout(2600);
  await shot('09-stale');
  // 6. tool indicator
  page.evaluate(() => { window.__dev.run.toolLine(); });
  await page.waitForTimeout(1500);
  await shot('10-tool');
  await page.waitForTimeout(3200);
  await shot('11-tool-answer');
  // 7. caption + chips
  await dev('captionLine');
  await page.waitForTimeout(300);
  await shot('12-caption');
  // 8. sheet
  await page.tap('#history-button');
  await page.waitForTimeout(100);
  await shot('13-sheet-opening');
  await page.waitForTimeout(400);
  await shot('14-sheet');
  // 9. input
  await page.tap('#chat-toggle');
  await page.waitForTimeout(300);
  await page.fill('#chat-input', '马八进七好不好？');
  await shot('15-input');
  // 10. keyboard up
  await page.evaluate(() => { document.querySelector('[data-toggle="kb"]').click(); });
  await page.waitForTimeout(400);
  await shot('16-keyboard');
};
