// Reviewer helpers: board clip screenshots and a screencast contact sheet.
export const OUT = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
export async function boardShot(page, name, pad = 6) {
  const b = await page.locator('#board').boundingBox();
  const vp = page.viewportSize();
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  await page.screenshot({ path: `${OUT}-${name}.png`, clip: { x, y, width: Math.min(vp.width - x, b.width + 2 * pad), height: Math.min(vp.height - y, b.height + 2 * pad) } });
}
export async function areaShot(page, name, fx, fy, fw, fh) {
  const b = await page.locator('#board').boundingBox();
  await page.screenshot({ path: `${OUT}-${name}.png`, clip: { x: b.x + fx * b.width, y: b.y + fy * b.height, width: fw * b.width, height: fh * b.height } });
}
export const sleep = (page, ms) => page.waitForTimeout(ms);
export const ev = (page, fn, arg) => page.evaluate(fn, arg);
/** Records real-time frames while action runs; returns [{t, data}] */
export async function record(page, action, ms) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ ts: f.metadata.timestamp * 1000, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  await page.waitForTimeout(100);
  const t0 = Date.now();
  const started = action();
  await page.waitForTimeout(ms);
  await started;
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  return frames.filter((f) => f.ts >= t0 - 20).map((f) => ({ t: Math.round(f.ts - t0), data: f.data }));
}
export async function sheet(page, name, frames, { clip, cols = 6, scale = 0.6, pick = null, max = 18 } = {}) {
  let chosen = frames;
  if (pick) chosen = pick.map((t) => frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best), frames[0]));
  else if (frames.length > max) { const step = frames.length / max; chosen = Array.from({ length: max }, (_, i) => frames[Math.floor(i * step)]); }
  const vp = page.viewportSize();
  const p2 = await page.context().newPage();
  await p2.setViewportSize({ width: 1900, height: 1400 });
  await p2.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;background:#1a1a1a;font:11px monospace;color:#fff"><div id="g" style="display:grid;gap:3px;padding:3px;width:max-content"></div></body>');
  await p2.evaluate(async ({ chosen, clip, cols, scale, vpw }) => {
    const g = document.getElementById('g');
    g.style.gridTemplateColumns = `repeat(${cols}, max-content)`;
    for (const f of chosen) {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${f.data}`;
      await img.decode();
      const k = img.naturalWidth / vpw;
      const cv = document.createElement('canvas');
      cv.width = Math.round(clip.width * k); cv.height = Math.round(clip.height * k);
      cv.style.width = `${clip.width * scale}px`; cv.style.height = `${clip.height * scale}px`; cv.style.display = 'block';
      cv.getContext('2d').drawImage(img, clip.x * k, clip.y * k, clip.width * k, clip.height * k, 0, 0, cv.width, cv.height);
      const fig = document.createElement('figure'); fig.style.margin = '0';
      const cap = document.createElement('figcaption'); cap.textContent = `${f.t} ms`;
      fig.append(cv, cap); g.append(fig);
    }
  }, { chosen, clip, cols, scale, vpw: vp.width });
  await p2.locator('#g').screenshot({ path: `${OUT}-${name}.png` });
  await p2.close();
  return chosen.map((f) => f.t);
}
export async function clipOf(page, squares, margin = 1.2) {
  return page.evaluate(({ squares, margin }) => {
    const host = document.querySelector('#board'), box = host.getBoundingClientRect(), c = window.view.cell();
    const pts = squares.map(([row, col]) => window.view.squareCenter({ row, col }));
    const x0 = Math.max(0, Math.min(...pts.map((p) => p.x)) - margin * c), y0 = Math.max(0, Math.min(...pts.map((p) => p.y)) - margin * c);
    const x1 = Math.min(box.width, Math.max(...pts.map((p) => p.x)) + margin * c), y1 = Math.min(box.height, Math.max(...pts.map((p) => p.y)) + margin * c);
    return { x: box.x + x0, y: box.y + y0, width: x1 - x0, height: y1 - y0 };
  }, { squares, margin });
}
export const boardClip = async (page) => { const b = await page.locator('#board').boundingBox(); return { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: b.width + 8, height: b.height + 8 }; };
