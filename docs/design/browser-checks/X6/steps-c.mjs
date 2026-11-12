// Theme check: a finished line with links of both sides and the play button, a stale line, the sheet, the field.
export default async ({ page, shot }) => {
  await page.waitForSelector('html[data-ready="1"]');
  await page.evaluate(async () => {
    const d = window.__dev;
    d.run.heldLine();
    d.run.captionLine();
    await new Promise((r) => setTimeout(r, 50));
    d.chat.addChild('有更好的吗？');
    const id = d.chat.local(d.LINES.plan, { kind: 'ask', cue: '主公请看——' });
    d.chat.setChips(d.CHIPS.hint3);
  });
  await page.waitForTimeout(1500);
  await shot('1-rest');
  await page.tap('.bubble .move-link[data-color="black"]');
  await page.evaluate(() => { window.__dev.chat.end(window.__dev.lastId, { reason: 'aborted', source: 'none', stale: '已换一步' }); });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__dev.chat.setSheet(true, { focusInput: true }));
  await page.waitForTimeout(500);
  await page.fill('#chat-input', '马八进七好不好？');
  await shot('2-sheet');
};
