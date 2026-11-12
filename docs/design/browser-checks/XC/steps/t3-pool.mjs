// Task 3: the pool of light under the figure (.buddy-fig::before).
// For every figure named in XC_FIGS (css selectors of .buddy-fig elements, '|' separated, each "name=selector"):
//   - a 4x picture of the feet (the lower part of the pool's box and what lies under it),
//   - the pool alone: the page with the pool minus the page without it (the ::before switched off), measured per row and
//     per column, so that "ends in a hard line" is a number: the strength of the glow on the outermost pixel ring of its
//     box, and whether anything is painted outside the box.
// XC_PREP: JS run in the page first. XC_EXPECT=1: assertions (edge ring <= 2 levels of 255, nothing outside the box).
import { readFileSync } from 'node:fs';
import { clip, note, save, zoomClip } from './lib.mjs';

const figBoxes = (sel) => {
  const fig = document.querySelector(sel);
  if (!fig) return null;
  fig.scrollIntoView({ block: 'center', inline: 'nearest' });
  const f = fig.getBoundingClientRect();
  const cs = getComputedStyle(fig, '::before');
  const box = fig.closest('.buddy-box');
  const pool = { left: f.left + parseFloat(cs.left), top: f.top + parseFloat(cs.top), right: f.right - parseFloat(cs.right), bottom: f.bottom - parseFloat(cs.bottom) };
  const chip = [...document.querySelectorAll('#chat .chip, .mock__chips span, .shell-chat span')].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0).sort((a, b) => a.top - b.top)[0];
  return { variant: box?.dataset.variant, fig: { left: f.left, top: f.top, right: f.right, bottom: f.bottom, width: f.width, height: f.height }, pool,
           mask: cs.maskImage || cs.webkitMaskImage, background: cs.backgroundImage.slice(0, 220), chipTop: chip ? chip.top : null,
           mood: fig.querySelector('svg.buddy')?.dataset.mood, theme: document.documentElement.dataset.theme };
};

async function diffPool(context, onePath, twoPath, region, pool) {
  const pg = await context.newPage();
  await pg.setContent('<body></body>');
  const r = await pg.evaluate(async ({ one, two, region, pool }) => {
    const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, cv.width, cv.height); };
    const A = await load(one), B = await load(two);
    const W = A.width, H = A.height;
    // the pool's box in device px of the clip
    const px = { left: Math.round((pool.left - region.x) * 2), top: Math.round((pool.top - region.y) * 2), right: Math.round((pool.right - region.x) * 2), bottom: Math.round((pool.bottom - region.y) * 2) };
    const rowMax = new Array(H).fill(0), colMax = new Array(W).fill(0);
    let outside = 0, outsideMax = 0, total = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      if (!d) continue;
      total++;
      if (d > rowMax[y]) rowMax[y] = d;
      if (d > colMax[x]) colMax[x] = d;
      if (x < px.left || x >= px.right || y < px.top || y >= px.bottom) { outside++; if (d > outsideMax) outsideMax = d; }
    }
    const ring = { bottom: rowMax[px.bottom - 1] ?? null, top: rowMax[px.top] ?? null, left: colMax[px.left] ?? null, right: colMax[px.right - 1] ?? null };
    // the 14 device rows above the bottom edge (bottom-up) and the 6 below it
    const lastRows = []; for (let y = px.bottom - 1; y >= Math.max(0, px.bottom - 14); y--) lastRows.push(rowMax[y]);
    const below = []; for (let y = px.bottom; y < Math.min(H, px.bottom + 6); y++) below.push(rowMax[y]);
    // the largest step between two neighbouring rows in the lower fifth of the box (a hard line is a big step)
    let step = 0, stepAt = -1;
    for (let y = Math.max(1, Math.round(px.bottom - (px.bottom - px.top) * 0.2)); y <= Math.min(H - 1, px.bottom + 2); y++) { const s = Math.abs(rowMax[y] - rowMax[y - 1]); if (s > step) { step = s; stepAt = y - px.bottom; } }
    const peak = Math.max(...rowMax);
    return { px, size: [W, H], changed: total, outside, outsideMax, ring, lastRows, below, peak, step, stepAt };
  }, { one: readFileSync(onePath).toString('base64'), two: readFileSync(twoPath).toString('base64'), region, pool });
  await pg.close();
  return r;
}

export default async ({ page, shot, context }) => {
  const expect = process.env.XC_EXPECT === '1';
  await page.waitForTimeout(Number(process.env.XC_WAIT ?? '900'));
  if (process.env.XC_PREP) { await page.evaluate(process.env.XC_PREP); await page.waitForTimeout(Number(process.env.XC_PREP_WAIT ?? '900')); }
  const figs = (process.env.XC_FIGS ?? 'coach=#buddy .buddy-fig').split('|').map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
  const results = {};
  const failures = [];
  await shot(`${process.env.XC_TAG}-page`);
  for (const [name, sel] of figs) {
    const b = await page.evaluate(figBoxes, sel);
    if (!b) { note(`MISSING ${name}`, sel); failures.push(`${name}: no element ${sel}`); continue; }
    await page.waitForTimeout(200);
    const vw = page.viewportSize();
    // the feet: the lower 32 % of the figure, the pool's whole width, and 44 px under the box (the top of the chip row is there)
    const full = b.variant !== 'bust';
    const feet = full
      ? { x: Math.max(0, b.pool.left - 10), y: b.fig.bottom - b.fig.height * 0.32, width: Math.min(vw.width, b.pool.right + 10) - Math.max(0, b.pool.left - 10), height: b.fig.height * 0.32 + 44 }
      : { x: Math.max(0, b.fig.left - 16), y: Math.max(0, b.fig.top - 16), width: b.fig.width + 32, height: b.fig.height + 32 };
    feet.height = Math.min(feet.height, vw.height - feet.y);
    await zoomClip(page, context, `${name}-feet`, feet, 4);
    // the pool alone
    const region = { x: Math.max(0, Math.floor(b.pool.left - 12)), y: Math.max(0, Math.floor(b.pool.top - 12)) };
    region.width = Math.min(vw.width, Math.ceil(b.pool.right + 12)) - region.x;
    region.height = Math.min(vw.height, Math.ceil(b.pool.bottom + 12)) - region.y;
    const a = await clip(page, `${name}-pool-a`, region);
    await page.addStyleTag({ content: `${sel}::before { display: none !important; } /* xc-probe */` });
    await page.waitForTimeout(150);
    const off = await clip(page, `${name}-pool-b`, region);
    await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('xc-probe')) s.remove(); });
    await page.waitForTimeout(100);
    const d = await diffPool(context, a.path, off.path, { x: a.x, y: a.y }, b.pool);
    results[name] = { ...b, feet, diff: d };
    note(`POOL ${name}`, { variant: b.variant, theme: b.theme, figH: Math.round(b.fig.height * 10) / 10, poolBottom: Math.round(b.pool.bottom * 10) / 10, figBottom: Math.round(b.fig.bottom * 10) / 10, chipTop: b.chipTop && Math.round(b.chipTop * 10) / 10,
                             peak: d.peak, ring: d.ring, lastRows: d.lastRows.join(','), below: d.below.join(','), outside: d.outside, step: `${d.step}@${d.stepAt}`, mask: b.mask });
    if (full) {
      if (Math.max(d.ring.bottom, d.ring.top, d.ring.left, d.ring.right) > 2) failures.push(`${name}: the glow is still ${JSON.stringify(d.ring)} strong on the edge of its box`);
      if (d.outside) failures.push(`${name}: ${d.outside} pixels painted outside the pool's box`);
      if (Math.abs(b.pool.bottom - b.fig.bottom) > 0.01) failures.push(`${name}: the pool's box is no longer the figure's (bottom ${b.pool.bottom} vs ${b.fig.bottom})`);
    }
  }
  save('pool.json', results);
  if (expect && failures.length) throw new Error(failures.join(' | '));
  note('EXPECT', failures.length ? failures : 'ok');
};
