// Stale labels: inline, corner (line full), corner next to the more-mark; four layouts.
import path from 'node:path';
export default async ({ page }) => {
  const out = process.env.RV_OUT, tag = process.env.RV_TAG ?? 'sl';
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  const click = async (sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); };
  const snap = async (name) => {
    const loc = page.locator('.mock__coach'); await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(120);
    const b = await loc.boundingBox();
    await page.screenshot({ path: path.join(out, `${tag}-${name}.png`), clip: { x: Math.max(0, b.x - 40), y: Math.max(0, b.y - 8), width: Math.min(b.width + 60, 1180 - Math.max(0, b.x - 40)), height: b.height + 16 } });
  };
  const line = async (text, cue) => page.evaluate(([t, c]) => {
    const el = window.buddy.bubble.begin({ id: 'x' + Math.random(), cue: c });
    el.textContent = t; el.parentElement.dataset.state = 'done'; el.parentElement.dataset.source = 'llm';
  }, [text, cue]);
  const FULL = { landscape: 21, 'landscape-kb': 19, portrait: 36, compact: 17 };
  for (const layout of ['landscape', 'landscape-kb', 'portrait', 'compact']) {
    await click(`[data-mock="${layout}"]`);
    const n = FULL[layout];
    await line('好'.repeat(n * 2 - 1) + '。', null); await page.waitForTimeout(100);
    await page.evaluate(() => window.buddy.bubble.markStale('已换一步')); await page.waitForTimeout(150); await snap(`${layout}-full`);
    await line('这步棋走得稳，先把马跳出来。', '好棋！'); await page.waitForTimeout(350);
    await page.evaluate(() => window.buddy.bubble.markStale('已落子')); await page.waitForTimeout(150); await snap(`${layout}-short`);
    await line('小主公请看，这一步炮打中兵看似得了一子，其实对方的马正好回踩，咱们的炮就回不来了。先把车开出来，守住这条线，再找机会进攻，才是万全之策。亮以为，稳一手更好。再多说两句，气泡就装不下了，这时右下角会出现一个小标记。再多说两句，气泡就装不下了，这时右下角会出现一个小标记。', null); await page.waitForTimeout(100);
    await page.evaluate(() => window.buddy.bubble.markStale('已落子')); await page.waitForTimeout(150); await snap(`${layout}-over`);
  }
};
