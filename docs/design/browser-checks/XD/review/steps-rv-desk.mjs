// XD review: the sound desk after the first tap, at one size / theme. RV_THEME chibi|longzhong|shachang, RV_INPUT touch|mouse
const THEME = process.env.RV_THEME ?? 'chibi';
const INPUT = process.env.RV_INPUT ?? 'touch';
export default async ({ page, shot }) => {
  if (THEME !== 'chibi') await page.locator(`#theme button[data-theme-id="${THEME}"]`).click({ trial: false }).catch(() => {});
  // the theme click above is itself a gesture: start again from a fresh page, with the theme in the URL instead
  await page.goto(page.url().split('?')[0] + `?theme=${THEME}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await shot('idle');
  const pad = page.locator('[data-sfx="place"]').first();
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (INPUT === 'touch') await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(900);
  await shot('tapped');
  const log = page.locator('#log');
  await log.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await shot('log');
  const info = await page.evaluate(() => {
    const log = document.querySelector('#log');
    const card = log.closest('.card');
    const r = card.getBoundingClientRect();
    const items = [...log.children].map(li => ({ text: li.textContent, h: Math.round(li.getBoundingClientRect().height), w: Math.round(li.getBoundingClientRect().width), sw: li.scrollWidth, cw: li.clientWidth }));
    const small = [...document.querySelectorAll('button, a.btn, input[type=range]')].map(b => { const q = b.getBoundingClientRect(); return { id: b.id || b.dataset.sfx || b.textContent.trim().slice(0, 8), w: Math.round(q.width), h: Math.round(q.height) }; }).filter(q => q.w > 0 && (q.h < 44 || q.w < 44));
    return { card: { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }, cardOverflow: card.scrollWidth - card.clientWidth, items, small,
      state: document.querySelector('#state').dataset.state, wakeHidden: document.querySelector('#wake').hidden, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  console.log('RVDESK ' + JSON.stringify(info));
  // 拆台重搭: a new engine; its first tap is timed again
  await page.locator('#rebuild').scrollIntoViewIfNeeded();
  await page.locator('#rebuild').click();
  await page.waitForTimeout(200);
  await pad.scrollIntoViewIfNeeded();
  const box2 = await pad.boundingBox();
  if (INPUT === 'touch') await page.touchscreen.tap(box2.x + box2.width / 2, box2.y + box2.height / 2);
  else await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.waitForTimeout(900);
  await log.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await shot('rebuilt-log');
  console.log('RVDESK2 ' + JSON.stringify(await page.evaluate(() => [...document.querySelector('#log').children].map(li => li.textContent))));
};
