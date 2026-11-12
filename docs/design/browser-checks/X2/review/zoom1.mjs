// zoomed crops of the corners and label rows
export default async ({ page, shot }) => {
  const base = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const clip = async (name, sel, x, y, w, h) => {
    const box = await page.locator(sel).boundingBox();
    await page.screenshot({ path: `${base}-${name}.png`, clip: { x: box.x + x * box.width, y: box.y + y * box.height, width: w * box.width, height: h * box.height } });
  };
  await page.waitForTimeout(300);
  await clip('bl', '#board', 0, 0.86, 0.5, 0.14);
  await clip('br', '#board', 0.5, 0.86, 0.5, 0.14);
  await clip('tl', '#board', 0, 0, 0.5, 0.14);
  await clip('tr', '#board', 0.5, 0, 0.5, 0.14);
  await clip('river', '#board', 0, 0.38, 1, 0.24);
};
