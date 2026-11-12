// Reviewer: does a sound that was ringing when the child muted (or left the page) come back on unmute / return?
export default async ({ page }) => {
  const snap = () => page.evaluate(() => ({ max: window.__desk.maxDb(), peak: window.__desk.peakDb(), state: window.__desk.contextState(), live: window.__desk.live() }));
  const reset = () => page.evaluate(() => window.__desk.resetMax());
  const out = {};
  await page.click('[data-sfx="place"]');
  await page.waitForTimeout(900);

  // 1. mute in the middle of the win fanfare, unmute two seconds later
  await page.click('[data-sfx="win"]');
  await page.waitForTimeout(500);
  await page.click('#mute');
  await page.waitForTimeout(2000);
  out.muted = await snap();
  await reset();
  await page.click('#mute');
  await page.waitForTimeout(2500);
  out.afterUnmute = await snap();

  // 2. the same with "hidden"
  await reset();
  await page.click('[data-sfx="win"]');
  await page.waitForTimeout(500);
  await page.click('#hidden');
  await page.waitForTimeout(2000);
  out.hidden = await snap();
  await reset();
  await page.click('#hidden');
  await page.waitForTimeout(2500);
  out.afterVisible = await snap();

  // 3. a sound scheduled ahead (when 0.6 .. 2.6 s), muted before it starts
  await reset();
  await page.click('#book');
  await page.waitForTimeout(200);
  await page.click('#mute');
  await page.waitForTimeout(3500);
  await reset();
  await page.click('#mute');
  await page.waitForTimeout(3500);
  out.bookedThenMutedThenUnmuted = await snap();

  // 4. control: after all that a pad still sounds
  await reset();
  await page.click('[data-sfx="place"]');
  await page.waitForTimeout(600);
  out.control = await snap();
  console.log('LEFTOVER ' + JSON.stringify(out));
};
