// probe: how long does a bare AudioContext take here, and what does audio.unlock() add?
export default async ({ page }) => {
  await page.waitForTimeout(500);
  const out = await page.evaluate(async () => {
    const t0 = performance.now();
    const ctx = new AudioContext();
    const t1 = performance.now();
    const m = await import('/src/ui/audio.js');
    const a = m.createAudio();
    const t2 = performance.now();
    const p = a.unlock();
    const t3 = performance.now();
    await p;
    const t4 = performance.now();
    await ctx.close();
    return { bareContextMs: Math.round(t1 - t0), unlockSyncMs: Math.round(t3 - t2), unlockResolvedMs: Math.round(t4 - t2), state: ctx.state };
  });
  console.error(JSON.stringify(out));
};
