// Reviewer's check of item 3: the pool of light (.buddy-fig::before).
// For every figure named in RV_FIGS (name=selector|...): hide the drawing, take the box with a margin as P (glow on
// the background) and Z (glow switched off). D = |P - Z| is what the glow paints. Then the same with the reviewed
// (old) base rule injected, to show that the measurement sees the hard line it is meant to see.
import { grab, compare, note, save, zoom, file } from './rlib.mjs';
const sleep = (page, ms) => page.waitForTimeout(ms);
const OLD = `.buddy-fig::before { background:
    radial-gradient(50% 9% at 50% 95.5%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 100%),
    radial-gradient(50% 50% at 50% 56%, color-mix(in srgb, var(--wei) 26%, transparent), transparent 100%); } /* rv-old */`;
const M = 44;      // margin around the figure's box, CSS px

/** Runs in the blank page: A = with glow, B = without. box = the glow's box in device px inside the clip. */
const MEASURE = `(A, B, w, h, box) => {
  const D = new Uint8Array(w * h);
  let peak = 0, outside = 0, outsideMax = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
    D[y * w + x] = d;
    if (d > peak) peak = d;
    const inside = x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    if (!inside && d) { outside++; if (d > outsideMax) outsideMax = d; }
  }
  // strength on the outermost device-pixel ring inside the box
  const ring = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let x = box.left; x < box.right; x++) { ring.top = Math.max(ring.top, D[box.top * w + x]); ring.bottom = Math.max(ring.bottom, D[(box.bottom - 1) * w + x]); }
  for (let y = box.top; y < box.bottom; y++) { ring.left = Math.max(ring.left, D[y * w + box.left]); ring.right = Math.max(ring.right, D[y * w + box.right - 1]); }
  // the largest step between two neighbouring device pixels, anywhere in the clip (a hard line is a large step)
  let stepV = 0, stepVAt = null, stepH = 0, stepHAt = null;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) { const s = Math.abs(D[(y + 1) * w + x] - D[y * w + x]); if (s > stepV) { stepV = s; stepVAt = [x / 2, y / 2]; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) { const s = Math.abs(D[y * w + x + 1] - D[y * w + x]); if (s > stepH) { stepH = s; stepHAt = [x / 2, y / 2]; } }
  // the centre column from the bottom edge upward (device px), to see the ramp
  const cx = Math.round((box.left + box.right) / 2), ramp = [];
  for (let k = 0; k < 14; k++) ramp.push(D[(box.bottom - 1 - k) * w + cx]);
  return { peak, outside, outsideMax, ring, stepV, stepVAt, stepH, stepHAt, ramp };
}`;

export default async ({ page, shot, context }) => {
  const wait = Number(process.env.RV_WAIT ?? 900);
  await sleep(page, wait);
  const figs = (process.env.RV_FIGS ?? 'coach=#buddy .buddy-fig').split('|').map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
  const fails = [], out = {};
  for (const [name, sel] of figs) {
    const el = page.locator(sel).first();
    if (!(await el.count())) { fails.push(`${name}: no element ${sel}`); continue; }
    await el.scrollIntoViewIfNeeded();
    await sleep(page, 150);
    const geo = async () => page.evaluate((sel) => {
      const fig = document.querySelector(sel); const f = fig.getBoundingClientRect(); const b = getComputedStyle(fig, '::before');
      const host = fig.closest('.buddy-box');
      return { fig: { left: f.left, top: f.top, right: f.right, bottom: f.bottom, width: f.width, height: f.height }, variant: host?.dataset.variant ?? null, opacity: getComputedStyle(fig).opacity,
               pool: { left: f.left + parseFloat(b.left), top: f.top + parseFloat(b.top), right: f.right - parseFloat(b.right), bottom: f.bottom - parseFloat(b.bottom) }, bg: b.backgroundImage.slice(0, 60),
               chipsTop: (() => { const c = document.querySelector('#chat .chips, #chat .chat__chips, .coach__chat'); return c ? c.getBoundingClientRect().top : null; })() };
    }, sel);
    const g = await geo();
    const clipBox = { x: g.fig.left - M, y: g.fig.top - M, width: g.fig.width + 2 * M, height: g.fig.height + 2 * M };
    const measure = async (tag) => {
      await page.addStyleTag({ content: `${sel} svg.buddy { visibility: hidden !important } /* rv-hide */` });
      await sleep(page, 120);
      const P = await grab(page, `${name}-${tag}-P`, clipBox);
      await page.addStyleTag({ content: `${sel}::before { background: none !important } /* rv-off */` });
      await sleep(page, 120);
      const Z = await grab(page, `${name}-${tag}-Z`, clipBox);
      await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (/rv-hide|rv-off/.test(s.textContent)) s.remove(); });
      await sleep(page, 80);
      const box = { left: Math.round((g.pool.left - P.x) * 2), top: Math.round((g.pool.top - P.y) * 2), right: Math.round((g.pool.right - P.x) * 2), bottom: Math.round((g.pool.bottom - P.y) * 2) };
      box.left = Math.max(0, box.left); box.top = Math.max(0, box.top); box.right = Math.min(P.width * 2, box.right); box.bottom = Math.min(P.height * 2, box.bottom);
      return { m: await compare(context, P.buf, Z.buf, MEASURE, box), P, clippedBelow: (g.pool.bottom - P.y) * 2 >= P.height * 2 };
    };
    const now = await measure('now');
    // the picture with the drawing, for the eye: the feet, 4x
    const feet = await grab(page, `${name}-feet-raw`, { x: g.fig.left - 30, y: g.fig.bottom - 70, width: g.fig.width + 60, height: 100 });
    await zoom(context, feet.buf, file(`${name}-feet.png`), 4);
    const whole = await grab(page, `${name}-now`, clipBox);
    // the reviewed rule, for comparison
    await page.addStyleTag({ content: OLD });
    await sleep(page, 120);
    const gOld = await geo();
    const old = await measure('old');
    const feetOld = await grab(page, `${name}-feet-old-raw`, { x: g.fig.left - 30, y: g.fig.bottom - 70, width: g.fig.width + 60, height: 100 });
    await zoom(context, feetOld.buf, file(`${name}-feet-old.png`), 4);
    const wholeOld = await grab(page, `${name}-old`, clipBox);
    await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (/rv-old/.test(s.textContent)) s.remove(); });
    await sleep(page, 80);
    const same = await compare(context, whole.buf, wholeOld.buf, `(A, B, w, h) => { let n = 0; for (let i = 0; i < w * h * 4; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) n++; return n; }`);
    const moved = ['left', 'top', 'right', 'bottom'].some((k) => Math.abs(g.fig[k] - gOld.fig[k]) > 0.001);
    out[name] = { geo: g, now: now.m, old: old.m, oldVsNowPixels: same, moved };
    const n = now.m, o = old.m;
    note(`RV pool ${name}`, { variant: g.variant, figH: Math.round(g.fig.height), peak: n.peak, outside: n.outside, ring: n.ring, stepV: n.stepV, stepVAt: n.stepVAt, stepH: n.stepH, ramp: n.ramp.join(','),
                              old: { peak: o.peak, outside: o.outside, ring: o.ring, stepV: o.stepV, stepVAt: o.stepVAt }, oldVsNowPixels: same, moved });
    if (g.opacity !== '1') fails.push(`${name}: figure opacity ${g.opacity} (cannot measure)`);
    if (moved) fails.push(`${name}: the figure's box moved`);
    if (g.variant === 'bust') {
      if (same !== 0) fails.push(`${name}: the bust changed (${same} px differ between the reviewed rule and now)`);
    } else {
      if (n.outside) fails.push(`${name}: ${n.outside} px painted outside the glow's box (max ${n.outsideMax})`);
      for (const side of ['top', 'bottom', 'left', 'right']) if (n.ring[side] > 2) fails.push(`${name}: glow strength ${n.ring[side]} on the ${side} edge`);
      if (n.stepV > 4 || n.stepH > 4) fails.push(`${name}: a step of ${n.stepV} / ${n.stepH} between neighbouring pixels (hard line?) at ${JSON.stringify(n.stepVAt)}`);
      if (n.peak < 12) fails.push(`${name}: the glow is nearly gone (peak ${n.peak})`);
      if (!(o.ring.bottom > 12 && o.stepV > 12)) fails.push(`${name}: the measurement does not see the old hard line (old ring.bottom ${o.ring.bottom}, stepV ${o.stepV})`);
    }
  }
  await shot(`${process.env.RV_TAG}-page`);
  save('pool.json', out);
  note('RV-RESULT', fails.length ? fails : 'ok');
  if (fails.length) throw new Error(fails.join(' | '));
};
