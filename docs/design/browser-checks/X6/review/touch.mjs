// Reviewer: tap-target sizes (the element box united with its ::before / ::after tap areas).
export default async ({ page }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector('html[data-ready="1"]');
  await w(500);
  await page.evaluate(() => { window.__dev.run.planLine(); });
  await w(6500);
  const measure = () => page.evaluate(() => {
    const area = (el) => {
      const b = el.getBoundingClientRect();
      let top = b.top, bottom = b.bottom, left = b.left, right = b.right;
      for (const pseudo of ['::before', '::after']) {
        const s = getComputedStyle(el, pseudo);
        if (s.content === 'none' || s.position !== 'absolute' || s.pointerEvents === 'none') continue;
        const h = parseFloat(s.height), wd = parseFloat(s.width);
        const t = parseFloat(s.top), l = parseFloat(s.left);
        // the pseudo box relative to the element's padding box
        const tf = s.transform && s.transform !== 'none' ? new DOMMatrix(s.transform) : null;
        const y = b.top + (isNaN(t) ? 0 : t) + (tf ? tf.m42 : 0), x = b.left + (isNaN(l) ? 0 : l) + (tf ? tf.m41 : 0);
        if (!isNaN(h)) { top = Math.min(top, y); bottom = Math.max(bottom, y + h); }
        if (!isNaN(wd)) { left = Math.min(left, x); right = Math.max(right, x + wd); }
      }
      return [Math.round(right - left), Math.round(bottom - top)];
    };
    const out = {};
    const add = (name, sel) => { const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length); if (els.length) out[name] = els.map(area).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1])]); };
    add('chip', '.chip'); add('toggle', '#chat-toggle'); add('history', '#history-button'); add('head', '.chat__head'); add('send', '#chat-send');
    add('input', '#chat-input'); add('link', '.move-link[data-move]'); add('play', '.move-link--play');
    return out;
  });
  console.log('TOUCH rest ' + JSON.stringify(await measure()));
  await page.evaluate(() => { window.__dev.chat.setSheet(true, { focusInput: true }); });
  await w(500);
  console.log('TOUCH sheet ' + JSON.stringify(await measure()));
  await page.evaluate(() => { const d = window.__dev; d.state.kb = true; d.relayout(); });
  await w(400);
  console.log('TOUCH kb ' + JSON.stringify(await measure()));
};
