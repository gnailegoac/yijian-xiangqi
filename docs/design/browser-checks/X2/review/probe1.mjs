export default async ({ page }) => {
  const base = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const info = await page.evaluate(() => {
    const out = {};
    const labels = [...document.querySelectorAll('.bv-art .bv-label')];
    out.labels = labels.map((t) => { const b = t.getBBox(); return { text: t.textContent, y: b.y, h: b.height, x: b.x, w: b.width, font: getComputedStyle(t).fontFamily.slice(0, 80), size: getComputedStyle(t).fontSize }; });
    const ext = (t) => { const n = t.getNumberOfChars(); const r = []; for (let i = 0; i < n; i++) { const e = t.getExtentOfChar(i); r.push([Math.round(e.x), Math.round(e.y * 10) / 10, Math.round(e.width), Math.round(e.height * 10) / 10]); } return r; };
    out.ext = labels.map(ext);
    const seals = [...document.querySelectorAll('.bv-seal text')];
    out.seals = seals.map((t) => { const b = t.getBBox(); return { text: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height }; });
    const rt = [...document.querySelectorAll('.bv-rivertext')];
    out.river = rt.map((t) => { const b = t.getBBox(); return { text: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height }; });
    const p = document.querySelector('.piece[data-row="9"][data-col="0"]');
    const pb = p.getBoundingClientRect(), hb = document.querySelector('#board').getBoundingClientRect();
    out.piece = { top: (pb.top - hb.top) / hb.height * 1060, bottom: (pb.bottom - hb.top) / hb.height * 1060, left: (pb.left - hb.left) / hb.width * 920 };
    const g = document.querySelector('.piece__glyph');
    out.glyphFont = getComputedStyle(g).fontFamily;
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  // hide pieces to see the art alone
  await page.evaluate(() => { document.querySelector('.bv-pieces').style.visibility = 'hidden'; });
  const box = await page.locator('#board').boundingBox();
  await page.screenshot({ path: `${base}-art.png`, clip: box });
  await page.screenshot({ path: `${base}-artbl.png`, clip: { x: box.x, y: box.y + box.height * 0.86, width: box.width * 0.5, height: box.height * 0.14 } });
};
