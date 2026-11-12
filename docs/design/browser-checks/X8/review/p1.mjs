// probe: the find. What does .rival[data-mood] show over time after the confirm?
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.evaluate(() => window.__dev.moment.find());
  await w(2600);
  await page.evaluate(() => {
    window.__trace = [];
    const t0 = performance.now();
    const snap = () => {
      const rival = document.querySelector('.rival');
      const row = [Math.round(performance.now() - t0), rival.dataset.mood, rival.dataset.say, document.querySelector('.rival__line').textContent,
        document.querySelector('#buddy svg.buddy').dataset.mood,
        document.querySelector('.fx-banner') ? 'banner:' + document.querySelector('.fx-banner').textContent : '',
        document.querySelector('.fx-stamp') ? 'stamp' : '', [...document.querySelectorAll('.fx-popup')].map((p) => p.textContent).join('+')];
      const last = window.__trace[window.__trace.length - 1];
      if (!last || last.slice(1).join('|') !== row.slice(1).join('|')) window.__trace.push(row);
      if (performance.now() - t0 < 5000) requestAnimationFrame(snap);
    };
    window.__dev.act.confirm();
    snap();
  });
  await w(300); await shot('find-300');
  await w(900); await shot('find-1200');
  await w(1500); await shot('find-2700');
  await w(2500);
  console.error(JSON.stringify(await page.evaluate(() => window.__trace), null, 0).replace(/\],\[/g, '],\n['));
};
