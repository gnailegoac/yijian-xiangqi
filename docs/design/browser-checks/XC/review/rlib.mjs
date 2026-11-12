// Reviewer's helpers (XC review).
import { writeFileSync, mkdirSync } from 'node:fs';
export const OUT = process.env.RV_OUT;
export const TAG = process.env.RV_TAG ?? 'x';
if (OUT) mkdirSync(OUT, { recursive: true });
export const file = (name) => `${OUT}/${TAG}-${name}`;
export const note = (label, data) => console.error(`${label} ${JSON.stringify(data)}`);
export const save = (name, data) => writeFileSync(file(name), JSON.stringify(data, null, 1));

/** Screenshot of a CSS-px box as a PNG buffer (2 device px per CSS px). */
export async function grab(page, name, box) {
  const vw = page.viewportSize();
  const b = box ?? { x: 0, y: 0, width: vw.width, height: vw.height };
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  const width = Math.min(vw.width - x, Math.ceil(b.width)), height = Math.min(vw.height - y, Math.ceil(b.height));
  const path = file(`${name}.png`);
  const buf = await page.screenshot({ path, clip: { x, y, width, height } });
  return { path, buf, x, y, width, height };
}

/** Runs fn(dataA, dataB, w, h, extra) in a blank page over two PNG buffers decoded to RGBA. */
export async function compare(context, bufA, bufB, fnSource, extra = null) {
  const p = await context.newPage();
  await p.setContent('<body></body>');
  const r = await p.evaluate(async ({ a, b, fnSource, extra }) => {
    const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, cv.width, cv.height); };
    const A = await load(a), B = b ? await load(b) : null;
    return (0, eval)(`(${fnSource})`)(A.data, B ? B.data : null, A.width, A.height, extra);
  }, { a: bufA.toString('base64'), b: bufB ? bufB.toString('base64') : null, fnSource, extra });
  await p.close();
  return r;
}

/** Number of differing device pixels inside / outside a box (device px), and the bounding box of the outside ones. */
export const DIFF = `(A, B, w, h, box) => {
  let inside = 0, outside = 0, max = 0, bb = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
    if (!d) continue;
    const inBox = box && x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    if (inBox) inside++; else { outside++; if (d > max) max = d; bb = bb ? [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)] : [x, y, x, y]; }
  }
  return { inside, outside, max, box: bb && bb.map((v) => v / 2) };
}`;

/** An enlarged copy of a PNG (nearest neighbour), written to `path`. */
export async function zoom(context, buf, path, factor = 4) {
  const p = await context.newPage();
  await p.setContent('<body style="margin:0"></body>');
  const size = await p.evaluate(async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }, buf.toString('base64'));
  const W = Math.round(size[0] * factor / 2), H = Math.round(size[1] * factor / 2);
  await p.setViewportSize({ width: W, height: H });
  await p.setContent(`<body style="margin:0;overflow:hidden;background:#000"><img style="display:block;width:${W}px;height:${H}px;image-rendering:pixelated" src="data:image/png;base64,${buf.toString('base64')}"></body>`);
  await p.waitForTimeout(100);
  await p.screenshot({ path });
  await p.close();
}
