// Shared helpers of the XC steps files (run through tools/shot.mjs --steps).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const OUT = process.env.XC_OUT;                       // folder for this run's pictures and json
export const TAG = process.env.XC_TAG ?? 'x';                // prefix of every file name of this run
if (OUT) mkdirSync(OUT, { recursive: true });

export const file = (name) => `${OUT}/${TAG}-${name}`;
export function save(name, data) { writeFileSync(file(name), JSON.stringify(data, null, 1)); }
export function note(label, data) { console.error(`${label} ${JSON.stringify(data)}`); }

/** A clipped screenshot (CSS px), 2 device px per CSS px. */
export async function clip(page, name, box) {
  const vw = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  const width = Math.min(vw.width - x, Math.ceil(box.width)), height = Math.min(vw.height - y, Math.ceil(box.height));
  const path = file(`${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, clip: { x, y, width, height } });
  return { path, x, y, width, height };
}

/** The same clip, enlarged: every CSS px of the page becomes `zoom` px of the picture (nearest neighbour above 2x). */
export async function zoomClip(page, context, name, box, zoom = 4) {
  const c = await clip(page, `${name}-raw`, box);
  const data = readFileSync(c.path).toString('base64');
  const p = await context.newPage();
  await p.setViewportSize({ width: Math.round(c.width * zoom / 2), height: Math.round(c.height * zoom / 2) });
  await p.setContent(`<body style="margin:0;overflow:hidden;background:#000"><img style="display:block;width:100vw;height:100vh;image-rendering:pixelated" src="data:image/png;base64,${data}"></body>`);
  await p.waitForTimeout(120);
  await p.screenshot({ path: file(`${name}.png`) });
  await p.close();
  return c;
}

/** Decodes a PNG file in the page and returns its RGBA rows through a callback run in the page. */
export async function pixels(page, context, pngPath, fnSource) {
  const data = readFileSync(pngPath).toString('base64');
  const p = await context.newPage();
  await p.setContent('<body></body>');
  const result = await p.evaluate(async ({ data, fnSource }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return (0, eval)(`(${fnSource})`)(image.data, image.width, image.height);
  }, { data, fnSource });
  await p.close();
  return result;
}
