// magnify: screenshot a region of the board at device pixels, then show it 3x nearest-neighbour in a second page
import { OUT, sleep, ev } from './rlib.mjs';
export async function magnify(page, name, fx, fy, fw, fh, k = 3) {
  const b = await page.locator('#board').boundingBox();
  const buf = await page.screenshot({ clip: { x: b.x + fx * b.width, y: b.y + fy * b.height, width: fw * b.width, height: fh * b.height } });
  const p2 = await page.context().newPage();
  await p2.setContent(`<body style="margin:0;background:#000"><img id="i" style="image-rendering:pixelated;display:block" src="data:image/png;base64,${buf.toString('base64')}"></body>`);
  await p2.evaluate(async (k) => { const i = document.getElementById('i'); await i.decode(); i.style.width = `${i.naturalWidth * k / 2}px`; }, k);
  await p2.locator('#i').screenshot({ path: `${OUT}-${name}.png` });
  await p2.close();
}
export default async ({ page }) => {
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'over'; });
  await sleep(page, 400);
  await magnify(page, 'br-none', 0.5, 0.9, 0.5, 0.1);
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'childTurn'; });
  await sleep(page, 1700);
  await magnify(page, 'br-glow', 0.5, 0.9, 0.5, 0.1);
};
