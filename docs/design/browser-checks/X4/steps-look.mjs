// Unlocks, starts the music at some tension, plays a stinger and captures the page.
export default async ({ page, shot }) => {
  const theme = process.env.X4_THEME;
  if (theme) await page.click(`#theme [data-theme-id="${theme}"]`);
  await shot('0-locked');
  await page.click('[data-sfx="select"]');
  await page.waitForTimeout(500);
  await page.click('#musicToggle');
  await page.click('#anchors [data-tension="0.6"]');
  await page.waitForTimeout(2500);
  await page.click('[data-sfx="check.give"]');
  await page.waitForTimeout(140);
  await shot('1-playing');
  await page.waitForTimeout(110);
  await shot('2-playing');
  await page.evaluate(() => { for (const el of document.querySelectorAll('.pads, .rack, html')) el.scrollTop = 1e6; });
  await page.waitForTimeout(400);
  await shot('3-bottom');
  const small = await page.evaluate(() => [...document.querySelectorAll('button, input[type=range], a.btn')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.dataset.sfx || e.textContent.trim().slice(0, 8), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(r => r.w < 44 || r.h < 44));
  console.log('targets under 44px:', JSON.stringify(small));
};
