import { LAB } from './lab.mjs';
export default async ({ page }) => {
  // live
  await page.click('[data-sfx="ui.tap"]');
  await page.waitForTimeout(800);
  const live = {};
  for (const name of ['praise.great', 'praise.good', 'praise.great', 'place', 'praise.great', 'hint.1', 'praise.great', 'praise.great']) {
    await page.evaluate(() => window.__desk.resetMax());
    await page.click(`[data-sfx="${name}"]`);
    await page.waitForTimeout(1600);
    (live[name] ??= []).push(+(await page.evaluate(() => window.__desk.maxDb())).toFixed(1));
  }
  console.log('live', JSON.stringify(live), 'sampleRate', await page.evaluate(() => new (window.AudioContext)().sampleRate));
};
