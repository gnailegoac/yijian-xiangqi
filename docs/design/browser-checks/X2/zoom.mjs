// Zoomed crops of the board for close inspection.
export default async ({ page, shot }) => {
  const box = await page.locator('#board').boundingBox();
  const clip = (name, x, y, w, h) => page.screenshot({ path: `C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X2/zoom-${name}.png`, clip: { x: box.x + x, y: box.y + y, width: w, height: h } });
  await clip('bl', 0, box.height - 200, 300, 200);
  await clip('tr', box.width - 300, 0, 300, 200);
  await clip('river', 0, box.height / 2 - 90, box.width, 180);
};
