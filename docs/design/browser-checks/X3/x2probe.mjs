// Read-only probe of X2's harness: does the real board mount fx, and do fx's layers sit where they should?
export default async ({ page, shot }) => {
  const info = await page.evaluate(() => {
    const fxEl = document.querySelector('.bv-fx'); if (!fxEl) return { mounted: false };
    const bv = fxEl.closest('.bv'), cvs = fxEl.querySelector('.fx-canvas'), r = cvs?.getBoundingClientRect(), b = bv.getBoundingClientRect();
    const c = parseFloat(getComputedStyle(bv).getPropertyValue('--c'));
    return { mounted: !!cvs, children: [...fxEl.children].map(e => e.className), c, bleed: r ? [(b.left - r.left) / c, (b.top - r.top) / c] : null, backing: cvs ? [cvs.width, cvs.height, cvs.width * cvs.height] : null,
      overflow: getComputedStyle(fxEl).overflow, z: getComputedStyle(fxEl).zIndex, q: cvs?.dataset.q };
  });
  console.error('X2PROBE', JSON.stringify(info));
  await shot('board');
};
