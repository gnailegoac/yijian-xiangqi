export default async ({ page, shot }) => {
  await page.waitForSelector('html[data-ready="1"]');
  const r = await page.evaluate(() => {
    const t = document.querySelector('#chat-toggle');
    const cs = getComputedStyle(t);
    return { font: cs.fontFamily, size: cs.fontSize, emoji: cs.fontVariantEmoji, text: t.textContent, code: t.textContent.codePointAt(0).toString(16) };
  });
  console.log(JSON.stringify(r));
  const clip = await page.evaluate(() => { const b = document.querySelector('.chat__tools').getBoundingClientRect(); return { x: b.x - 10, y: b.y - 10, width: b.width + 20, height: b.height + 20 }; });
  await page.screenshot({ path: 'work/X6/dbg-tools.png', clip });
};
