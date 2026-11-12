// Reviewer: look at dev/audio.html in several states.
export default async ({ page, shot }) => {
  const theme = process.env.X4R_THEME;
  await shot('0-locked');
  if (theme) await page.click(`#theme [data-theme-id="${theme}"]`);
  await page.click('[data-sfx="trial.confirm"]');
  await page.waitForTimeout(500);
  await page.click('#musicToggle');
  await page.click('#anchors [data-tension="0.95"]');
  await page.waitForTimeout(2500);
  await page.click('[data-sfx="win"]');
  await page.waitForTimeout(700);
  await shot('1-playing');
  await page.waitForTimeout(150);
  await shot('2-playing');
  // bottom of the pads and of the rack
  await page.evaluate(() => {
    for (const sel of ['.pads', '.rack']) { const n = document.querySelector(sel); if (n) n.scrollTop = n.scrollHeight; }
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(400);
  await shot('3-bottom');
  // mid page on phones / portrait
  await page.evaluate(() => { window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.33)); });
  await page.waitForTimeout(300);
  await shot('4-mid');
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, input[type="range"], [role="button"]')]
    .filter(n => n.offsetParent !== null)
    .map(n => { const r = n.getBoundingClientRect(); return { id: n.id || n.dataset.sfx || n.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter(r => r.w < 44 || r.h < 44));
  console.log('SMALL', JSON.stringify(small));
  await page.click('#musicToggle');
};
