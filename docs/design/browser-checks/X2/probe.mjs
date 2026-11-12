export default async ({ page }) => {
  const out = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.bv-label')];
    const b = (el) => { const r = el.getBBox(); return [el.textContent, Math.round(r.y * 10) / 10, Math.round(r.height * 10) / 10, getComputedStyle(el).fontFamily.slice(0, 30)]; };
    return { top: b(labels[0]), bottom: b(labels[1]), river: b(document.querySelector('.bv-rivertext')), seal: b(document.querySelector('.bv-seal text')),
      nodes: document.querySelectorAll('.bv *').length, pieces: document.querySelectorAll('.piece').length, cells: document.querySelectorAll('.board-cell').length,
      c: getComputedStyle(document.querySelector('.bv')).getPropertyValue('--c') };
  });
  console.log(JSON.stringify(out));
};
