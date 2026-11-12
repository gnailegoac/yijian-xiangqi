// Details: a used chip, the stop button with dots in the log, the tool indicator in the log, an empty sheet.
export default async ({ page, shot }) => {
  await page.waitForSelector('html[data-ready="1"]');
  await page.evaluate(() => {
    const app = document.querySelector('#app');
    for (const t of ['chat:chip', 'chat:ask']) app.addEventListener(t, (e) => e.stopImmediatePropagation(), true);
    window.__dev.chat.setChips(window.__dev.CHIPS.trial);
  });
  await page.waitForTimeout(600);
  await page.tap('.chip[data-ask="reply"]');
  await page.waitForTimeout(200);
  await shot('1-used-chip');
  await page.evaluate(() => { const d = window.__dev; d.chat.setSheet(true, { focusInput: true }); d.chat.addChild('对方会怎么应？'); d.chat.begin({ id: 'w1', kind: 'ask' }); });
  await page.waitForTimeout(700);
  await shot('2-stop-dots');
  await page.evaluate(() => { const d = window.__dev; d.chat.tool('w1', { phase: 'start', notation: '炮二平五' }); });
  await page.waitForTimeout(300);
  await shot('3-tool-in-log');
  await page.evaluate(() => { const d = window.__dev; d.chat.tool('w1', { phase: 'end' }); for (const seg of d.LINES.tool) d.chat.segment('w1', seg); });
  await page.waitForTimeout(250);
  await shot('4-typing-in-log');
  await page.evaluate(() => { const d = window.__dev; d.chat.end('w1', { reason: 'done', source: 'llm' }); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const d = window.__dev; d.chat.clear(); d.chat.setChips([]); d.chat.setSheet(true); });
  await page.waitForTimeout(400);
  await shot('5-empty-sheet');
};
