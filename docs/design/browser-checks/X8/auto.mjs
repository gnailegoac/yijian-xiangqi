// ?auto=1: the whole script plays by itself to the end (the loss card), with no error on the way.
export default async ({ page, shot }) => {
  const t0 = Date.now();
  const seen = new Set();
  let done = false;
  while (Date.now() - t0 < 200000) {
    const s = await page.evaluate(() => ({ scene: window.__dev.G.scene, phase: window.__dev.G.phase, card: !!document.querySelector('dialog[data-dialog="over"]'), result: window.__dev.G.result?.result ?? null,
      takeaway: document.querySelector('.hud-over__takeaway')?.textContent ?? '' }));
    seen.add(`${s.scene}:${s.phase}`);
    if (s.scene === 'loss' && s.card && s.result === 'loss' && s.takeaway.length > 20) { done = true; break; }
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  await shot('end');
  const log = await page.evaluate(() => ({ lines: window.__dev.logLines.length, handlers: [...new Set(window.__dev.calls.map((c) => c[0]))].sort() }));
  console.error('auto', JSON.stringify({ done, seconds: Math.round((Date.now() - t0) / 1000), scenes: [...new Set([...seen].map((x) => x.split(':')[0]))], phases: [...new Set([...seen].map((x) => x.split(':')[1]))].sort(), handlers: log.handlers }));
  if (!done) throw new Error('the script did not reach the loss card');
};
