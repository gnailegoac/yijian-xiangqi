// node pngdiff.mjs a.png b.png [diff-out.png] [x,y,w,h in device px to look at only]
// Prints how many pixels differ, the largest difference per channel (0..255), and the box of the differences.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');

export async function pngDiff(browser, a, b, out = null, only = null) {
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  const r = await page.evaluate(async ({ one, two, only, wantImage }) => {
    const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, cv.width, cv.height); };
    const A = await load(one), B = await load(two);
    if (A.width !== B.width || A.height !== B.height) return { sizeMismatch: [A.width, A.height, B.width, B.height] };
    const x0 = only ? only[0] : 0, y0 = only ? only[1] : 0, x1 = only ? only[0] + only[2] : A.width, y1 = only ? only[1] + only[3] : A.height;
    let count = 0, max = 0, box = null;
    const hist = { 1: 0, 2: 0, '3-8': 0, '9+': 0 };
    const cv = document.createElement('canvas'); cv.width = A.width; cv.height = A.height;
    const cx = cv.getContext('2d');
    const O = cx.createImageData(A.width, A.height);
    for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
      const i = (y * A.width + x) * 4;
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      const g = (A.data[i] + A.data[i + 1] + A.data[i + 2]) / 12;
      O.data[i] = d ? 255 : g; O.data[i + 1] = d ? Math.max(0, 200 - d * 12) : g; O.data[i + 2] = d ? 0 : g; O.data[i + 3] = 255;
      if (!d || x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      count++;
      if (d > max) max = d;
      hist[d === 1 ? 1 : d === 2 ? 2 : d <= 8 ? '3-8' : '9+']++;
      box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
    }
    let image = null;
    if (wantImage) { cx.putImageData(O, 0, 0); image = cv.toDataURL('image/png').split(',')[1]; }
    return { size: [A.width, A.height], count, max, hist, box, image };
  }, { one: readFileSync(a).toString('base64'), two: readFileSync(b).toString('base64'), only, wantImage: !!out });
  await page.close();
  if (out && r.image) writeFileSync(out, Buffer.from(r.image, 'base64'));
  delete r.image;
  return r;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pngdiff.mjs')) {
  const [a, b, out, only] = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const r = await pngDiff(browser, a, b, out && out !== '-' ? out : null, only ? only.split(',').map(Number) : null);
  await browser.close();
  console.log(JSON.stringify(r));
}
