// Lists the elements that reach past the right edge of the viewport, and controls smaller than 44 px.
export default async ({ page }) => {
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5) wide.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).slice(0, 40)} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
    }
    const small = [];
    for (const el of document.querySelectorAll('button, select, input, .bubble:not([data-empty])')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (el.classList.contains('move-link')) continue;
      if (r.height < 43.5 || r.width < 43.5) small.push(`${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return { vw, scrollW: document.documentElement.scrollWidth, wide: wide.slice(0, 25), small: small.slice(0, 25) };
  });
  console.log(JSON.stringify(report, null, 1));
};
