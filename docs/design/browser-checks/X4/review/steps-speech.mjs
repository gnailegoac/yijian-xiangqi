// Reviewer: the read-aloud card of dev/audio.html.
export default async ({ page, shot }) => {
  const last = () => page.evaluate(() => document.querySelector('#last').textContent);
  const out = {};
  await page.click('[data-sfx="place"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const n = document.querySelector('.rack'); if (n) n.scrollTop = n.scrollHeight; });
  await page.click('#say1');
  out.off = await last();
  await page.click('#readAloud');
  await page.click('#say3');
  await page.waitForTimeout(300);
  out.on = await last();
  out.dot = await page.evaluate(() => document.querySelector('#speaking').dataset.state);
  out.voices = await page.evaluate(() => speechSynthesis.getVoices().map(v => v.lang));
  await shot('speech');
  await page.click('#hush');
  await page.click('#readAloud');
  // every control of the page is a real control and at least 44 px
  out.small = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, input[type="range"], [role="button"]')]
    .filter(n => n.offsetParent !== null)
    .map(n => { const r = n.getBoundingClientRect(); return { id: n.id || n.textContent.trim().slice(0, 10), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter(r => r.w < 44 || r.h < 44));
  console.log('SPEECH ' + JSON.stringify(out));
};
