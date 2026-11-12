// Under prefers-reduced-motion: does a synchronous read after a write see the new geometry (FLIP, §10.2.6)?
export default async ({ page }) => {
  const result = await page.evaluate(async () => {
    const out = { prefersReduce: matchMedia('(prefers-reduced-motion: reduce)').matches, motionAttr: document.documentElement.dataset.motion ?? null };
    const host = document.getElementById('board');
    const piece = document.createElement('div');
    piece.style.cssText = 'position:absolute;width:20px;height:20px;--vx:1;left:calc(var(--vx) * 30px);top:0;background:red';
    host.append(piece);
    const before = piece.getBoundingClientRect().left;
    piece.style.setProperty('--vx', '5');
    const after = piece.getBoundingClientRect().left;                 // the FLIP "after" read
    out.syncReadMoved = Math.round(after - before);                   // 120 when the write is visible at once
    out.transitionDuration = getComputedStyle(piece).transitionDuration;
    let ends = 0;
    piece.addEventListener('transitionend', () => { ends++; });
    await new Promise(r => setTimeout(r, 120));
    out.laterMoved = Math.round(piece.getBoundingClientRect().left - before);
    out.transitionendEvents = ends;
    // An element that declares its own transition: does transitionend still arrive?
    const sheet = document.createElement('div');
    sheet.style.cssText = 'position:absolute;width:20px;height:20px;top:30px;left:0;opacity:1;transition:opacity 240ms';
    host.append(sheet);
    sheet.getBoundingClientRect();
    let sheetEnds = 0;
    sheet.addEventListener('transitionend', () => { sheetEnds++; });
    sheet.style.opacity = '0';
    await new Promise(r => setTimeout(r, 400));
    out.declaredTransitionEnds = sheetEnds;
    out.declaredTransitionDuration = getComputedStyle(sheet).transitionDuration;
    piece.remove(); sheet.remove();
    return out;
  });
  console.log('FLIP', JSON.stringify(result));
};
