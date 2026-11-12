// Frame sequences of gestures and mood changes on the live stage (landscape, full motion).
import path from 'node:path';
export default async ({ page }) => {
  const out = process.env.RV_OUT;
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  const loc = page.locator('#buddy .buddy-fig');
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const b = await loc.boundingBox();
  const clip = { x: Math.max(0, b.x - 70), y: b.y - 20, width: b.width + 110, height: b.height + 30 };
  const seq = async (name, js, n, gap) => {
    await page.evaluate(js);
    for (let i = 0; i < n; i++) {
      await page.screenshot({ path: path.join(out, `f-${name}-${String(i).padStart(2, '0')}.png`), clip });
      await page.waitForTimeout(gap);
    }
    await page.waitForTimeout(900);
  };
  await seq('point', 'window.buddy.react("point")', 8, 110);
  await seq('peek', 'window.buddy.react("peek")', 6, 100);
  await seq('nod', 'window.buddy.react("nod")', 5, 70);
  await seq('alarm', 'window.buddy.setMood("alarmed")', 6, 50);
  await seq('cheer', 'window.buddy.setMood("cheering")', 9, 90);
  await seq('think', 'window.buddy.setMood("thinking")', 5, 70);
  await seq('idle', 'window.buddy.setMood("idle")', 5, 70);
  await seq('speak', 'window.buddy.setSpeaking(true)', 6, 60);
};
