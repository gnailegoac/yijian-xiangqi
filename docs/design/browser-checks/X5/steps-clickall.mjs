// Taps every control of dev/buddy.html once (in several layouts, themes and both motion modes).
// shot.mjs reports page errors and console errors; this file only drives.
export default async ({ page, shot }) => {
  const tap = async (sel) => { const loc = page.locator(sel); await loc.scrollIntoViewIfNeeded(); await loc.tap(); };
  const all = async (sel, gap = 60) => {
    const n = await page.locator(sel).count();
    for (let i = 0; i < n; i++) { const loc = page.locator(sel).nth(i); await loc.scrollIntoViewIfNeeded(); await loc.tap(); await page.waitForTimeout(gap); }
    return n;
  };
  const counts = {};
  for (const motion of ['full', 'reduced']) {
    await tap(`[data-motion-id="${motion}"]`);
    for (const theme of ['longzhong', 'shachang', 'chibi']) await tap(`[data-theme-id="${theme}"]`);
    for (const mock of ['landscape', 'landscape-kb', 'portrait', 'compact', 'landscape']) {
      await tap(`[data-mock="${mock}"]`);
      counts.moods = await all('#mood-buttons button');
      await tap('#opt-hold'); await all('#mood-buttons button', 30); await tap('#opt-hold');
      await tap('#opt-instant'); await all('#mood-buttons button', 30); await tap('#opt-instant');
      counts.gestures = await all('#gesture-buttons button', 120);
      counts.bubble = await all('#bubble-buttons button', 90);
      counts.scenes = await all('#scene-buttons button', 250);
      await page.selectOption('#base-select', 'pleased');
      await page.selectOption('#base-select', 'idle');
      for (const id of ['#speak-on', '#speak-off', '#variant-bust', '#variant-full', '#destroy', '#recreate']) { await tap(id); await page.waitForTimeout(60); }
    }
    for (const rl of ['portrait', 'compact', 'landscape']) { await tap(`[data-rl="${rl}"]`); counts.rival = await all('#rival-buttons button', 120); }
    await tap('#rival-line'); await all('#rival-buttons button', 60); await tap('#rival-line');
    await tap('[data-facing="landscape"]'); await tap('[data-facing=""]');
  }
  // the three events reach the document
  await tap('[data-motion-id="full"]');
  await tap('[data-mock="landscape"]');
  await tap('[data-scene="ask"]');
  await page.waitForTimeout(3200);
  await page.locator('#buddy .buddy-fig').tap();
  await page.locator('#buddy .bubble .move-link').first().tap();
  await page.locator('#buddy .bubble__text').tap({ position: { x: 4, y: 4 } });
  const log = await page.locator('#log').textContent();
  const seen = ['buddy:tap', 'chat:movelink', 'bubble:expand'].map((t) => `${t}=${log.includes(t)}`).join(' ');
  const expands = (log.match(/bubble:expand/g) ?? []).length;
  console.log(`CLICKED ${JSON.stringify(counts)}  EVENTS ${seen}  expandCount=${expands}`);
  if (!/buddy:tap=true chat:movelink=true bubble:expand=true/.test(seen) || expands !== 1) throw new Error('events: ' + seen + ' expands ' + expands);
  await shot('end');
};
