// Close-ups of the placeholder board: corners, river edges, palace.
export default async ({ page, shot }) => {
  const b = await page.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const k = b.w / 9.2;
  const base = (await shot('whole')).replace(/-whole\.png$/, '');
  const clip = async (name, x, y, w, h) => page.screenshot({ path: `${base}-${name}.png`, clip: { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h } });
  await clip('tl', b.x, b.y, 2.2 * k, 2.2 * k);
  await clip('br', b.x + b.w - 2.2 * k, b.y + b.h - 2.2 * k, 2.2 * k, 2.2 * k);
  await clip('river-l', b.x, b.y + 4.3 * k, 3 * k, 2 * k);
  await clip('river-r', b.x + b.w - 3 * k, b.y + 4.3 * k, 3 * k, 2 * k);
  await clip('palace-b', b.x + 3.1 * k, b.y + 7.3 * k, 3 * k, 3.2 * k);
  console.log(JSON.stringify({ b, k }));
};
