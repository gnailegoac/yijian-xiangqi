// Task 2 on dev/stage.html (the real stage, the real figure): the game-over card of a win and of a loss.
// For each: a full picture, the card's left edge zoomed 4x, the boxes, and the check
//   "while the card is up, the coach column's figure is fully transparent, or no part of its painted box lies outside the card".
// With XC_PIXELS=1 (run it with ?motion=reduced, so nothing loops) it also compares the pixels outside the card with
// the figure as it is and with the figure removed (visibility: hidden): they must be identical.
// XC_EXPECT=1 turns the check into an assertion. XC_MODE=landscape|other tells what to expect of the layout.
import { readFileSync } from 'node:fs';
import { clip, note, save, zoomClip } from './lib.mjs';

const sleep = (page, ms) => page.waitForTimeout(ms);

/** Boxes of the card and of the coach column's figure, in CSS px. */
const probe = () => {
  const rect = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const app = document.querySelector('#app');
  const card = document.querySelector('#overlays dialog[data-dialog="over"]');
  const fig = document.querySelector('#buddy .buddy-fig');
  const svg = fig?.querySelector('svg.buddy');
  if (!card || !fig || !svg) return { missing: { card: !card, fig: !fig, svg: !svg } };
  // the painted box: the drawing's own box and every rendered shape of it (the raised fan leaves the viewBox), 2 px of
  // margin for strokes; and the pool of light (.buddy-fig::before: 6 % wider than the figure on each side)
  let painted = null;
  const add = (r) => { if (!(r.width > 0 || r.height > 0)) return; painted = painted ? { left: Math.min(painted.left, r.left), top: Math.min(painted.top, r.top), right: Math.max(painted.right, r.right), bottom: Math.max(painted.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  for (const el of svg.querySelectorAll('path, circle, ellipse, rect, text, line, polygon, polyline')) add(el.getBoundingClientRect());
  painted = { left: painted.left - 2, top: painted.top - 2, right: painted.right + 2, bottom: painted.bottom + 2 };
  const f = fig.getBoundingClientRect();
  const before = getComputedStyle(fig, '::before');
  const pool = { left: f.left + parseFloat(before.left), top: f.top + parseFloat(before.top), right: f.right - parseFloat(before.right), bottom: f.bottom - parseFloat(before.bottom) };
  const c = card.getBoundingClientRect();
  const all = { left: Math.min(painted.left, pool.left), top: Math.min(painted.top, pool.top), right: Math.max(painted.right, pool.right), bottom: Math.max(painted.bottom, pool.bottom) };
  const out = (box) => ({ left: Math.max(0, c.left - box.left), top: Math.max(0, c.top - box.top), right: Math.max(0, box.right - c.right), bottom: Math.max(0, box.bottom - c.bottom) });
  const cs = getComputedStyle(fig);
  return {
    layout: app.dataset.layout, phase: app.dataset.phase, mood: svg.dataset.mood, variant: document.querySelector('#buddy').dataset.variant,
    opacity: Number(cs.opacity), visibility: cs.visibility,
    card: rect(c), fig: rect(f), painted, pool, drawingOutside: out(painted), poolOutside: out(pool), allOutside: out(all),
    layerClass: card.parentElement.className, chips: document.querySelectorAll('#chat .chip').length,
    undo: document.querySelector('#undo-button')?.textContent, history: document.querySelector('#history-button')?.textContent,
  };
};
const worst = (o) => Math.max(o.left, o.top, o.right, o.bottom);

async function untilCard(page) {
  await page.waitForFunction(() => document.querySelector('#overlays .hud-layer--over.is-open > dialog[data-dialog="over"]'), null, { timeout: 30000 });
}

export default async ({ page, shot, context }) => {
  const expect = process.env.XC_EXPECT === '1';
  const wantPixels = process.env.XC_PIXELS === '1';
  const results = {};
  const failures = [];
  await page.waitForFunction(() => window.__dev && document.querySelectorAll('.piece').length === 32);
  await sleep(page, 600);

  for (const scene of (process.env.XC_SCENES ?? 'win,loss').split(',')) {
    if (scene === 'draw') {
      await page.evaluate(() => { window.__dev.stop(); window.__dev.startScene('fork'); });
      await sleep(page, 1200);
      await page.evaluate(() => { void window.__dev.raw.over('draw', 'repetition', { proud: null, goal: null }); });
    } else {
      await page.evaluate((s) => window.__dev.moment[s === 'win' ? 'mate' : 'loss'](), scene);
      await sleep(page, 1300);
      await page.evaluate(() => window.__dev.act.confirm());
    }
    await untilCard(page);
    // the first second of the card: is the figure seen beside it at any moment after the card has come in?
    const timeline = [];
    const t0 = Date.now();
    for (const at of [60, 160, 260, 360, 520, 800, 1200, 1700, 2400]) {
      await sleep(page, Math.max(0, at - (Date.now() - t0)));
      const p = await page.evaluate(probe);
      timeline.push({ t: Date.now() - t0, opacity: p.opacity, mood: p.mood, drawingOutside: Math.round(worst(p.drawingOutside) * 10) / 10 });
    }
    await sleep(page, 900);
    const p = await page.evaluate(probe);
    results[scene] = { ...p, timeline };
    note(`CARD ${scene}`, { layout: p.layout, mood: p.mood, opacity: p.opacity, card: [p.card.left, p.card.top, p.card.right, p.card.bottom].map(Math.round),
                            painted: [p.painted.left, p.painted.top, p.painted.right, p.painted.bottom].map(Math.round), drawingOutside: p.drawingOutside, poolOutside: p.poolOutside, chips: p.chips });
    note(`TIME ${scene}`, timeline.map((s) => `${s.t}ms o=${s.opacity} ${s.mood} out=${s.drawingOutside}`));
    await shot(`${process.env.XC_TAG}-${scene}-card`);
    // the card's left edge, over the height of the figure
    const top = Math.max(0, Math.min(p.painted.top, p.card.top) - 12), bottom = Math.min(page.viewportSize().height, Math.max(p.painted.bottom, p.pool.bottom) + 16);
    if (p.layout === 'landscape') {
      await zoomClip(page, context, `${scene}-edge`, { x: p.card.left - 56, y: Math.max(top, p.painted.top - 24), width: 112, height: bottom - Math.max(top, p.painted.top - 24) }, 4);
      await clip(page, `${scene}-column`, { x: p.card.left - 70, y: top, width: p.card.width + 140, height: bottom - top });
    } else {
      await clip(page, `${scene}-sheet`, { x: 0, y: Math.max(0, p.card.top - 220), width: page.viewportSize().width, height: page.viewportSize().height - Math.max(0, p.card.top - 220) });
    }

    // the check
    const transparent = p.opacity === 0 || p.visibility === 'hidden';
    const covered = worst(p.allOutside) === 0;
    const late = timeline.filter((s) => s.t >= 520 && !(s.opacity === 0 || s.drawingOutside === 0));
    results[scene].check = { transparent, covered, ok: transparent || covered, lateSamples: late.length };
    if (process.env.XC_MODE === 'landscape' && !(transparent || covered)) failures.push(`${scene}: the figure shows outside the card (opacity ${p.opacity}, outside ${JSON.stringify(p.allOutside)})`);
    if (process.env.XC_MODE === 'landscape' && late.length) failures.push(`${scene}: seen outside the card ${late.length} time(s) later than 500 ms after the card came in`);
    if (process.env.XC_MODE === 'other' && (p.opacity !== 1 || p.variant !== 'bust')) failures.push(`${scene}: portrait / compact must keep the bust as it was (opacity ${p.opacity}, variant ${p.variant})`);

    if (wantPixels) {
      // Pixels outside the card: the page as it is, then with the figure taken out of the picture (visibility: hidden),
      // then as it is again. First wait until the page is still (the takeaway and the rival's line arrive after the card).
      const vw = page.viewportSize();
      const full = { x: 0, y: 0, width: vw.width, height: vw.height };
      const card = { left: Math.floor(p.card.left * 2), top: Math.floor(p.card.top * 2), right: Math.ceil(p.card.right * 2), bottom: Math.ceil(p.card.bottom * 2) };
      const diff = async (one, two) => {
        const pg = await context.newPage();
        await pg.setContent('<body></body>');
        const r = await pg.evaluate(async ({ one, two, card }) => {
          const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, cv.width, cv.height); };
          const A = await load(one), B = await load(two);
          let outside = 0, inside = 0, maxOut = 0;
          let box = null;
          for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
            const i = (y * A.width + x) * 4;
            const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
            if (!d) continue;
            const inCard = x >= card.left && x < card.right && y >= card.top && y < card.bottom;
            if (inCard) inside++; else { outside++; if (d > maxOut) maxOut = d; box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y]; }
          }
          return { outside, inside, maxOut, box: box && box.map((v) => v / 2) };
        }, { one: readFileSync(one).toString('base64'), two: readFileSync(two).toString('base64'), card });
        await pg.close();
        return r;
      };
      let a1 = await clip(page, `${scene}-px-a1`, full);
      let still = 0, tries = 0;
      while (still < 2 && tries < 24) {
        await sleep(page, 450);
        const next = await clip(page, `${scene}-px-s`, full);
        const d = await diff(a1.path, next.path);
        still = d.outside + d.inside === 0 ? still + 1 : 0;
        if (d.outside + d.inside) a1 = await clip(page, `${scene}-px-a1`, full);
        tries++;
      }
      await page.addStyleTag({ content: '#buddy .buddy-fig { visibility: hidden !important; } /* xc-probe */' });
      await sleep(page, 250);
      const b = await clip(page, `${scene}-px-b`, full);
      await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('xc-probe')) s.remove(); });
      await sleep(page, 250);
      const a2 = await clip(page, `${scene}-px-a2`, full);
      const noise = await diff(a1.path, a2.path);
      const gone = await diff(a1.path, b.path);
      results[scene].pixels = { tries, noise, gone };
      note(`PIXELS ${scene}`, { tries, noise, gone });
      const quiet = noise.outside + noise.inside === 0;
      if (!quiet) note(`NOISE ${scene}`, 'the page is not still: the pixel comparison says nothing');
      if (process.env.XC_MODE === 'landscape' && !quiet) failures.push(`${scene}: the page never came to rest, no pixel comparison`);
      if (process.env.XC_MODE === 'landscape' && quiet && gone.outside !== 0) failures.push(`${scene}: ${gone.outside} device pixels outside the card change when the figure is removed (box ${JSON.stringify(gone.box)})`);
    }

    // close the card with 回看棋局: he is back, and the under-bar and the tools are both on screen
    await page.locator('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
    await sleep(page, 1100);
    const after = await page.evaluate(() => {
      const fig = document.querySelector('#buddy .buddy-fig');
      return { opacity: Number(getComputedStyle(fig).opacity), card: !!document.querySelector('#overlays dialog[data-dialog="over"]'), undo: document.querySelector('#undo-button')?.textContent,
               history: document.querySelector('#history-button')?.textContent, chips: document.querySelectorAll('#chat .chip').length, mood: fig.querySelector('svg.buddy').dataset.mood };
    });
    results[scene].closed = after;
    note(`CLOSED ${scene}`, after);
    if (after.opacity !== 1 || after.card) failures.push(`${scene}: after 回看棋局 the figure must be back (opacity ${after.opacity}, card ${after.card})`);
    await shot(`${process.env.XC_TAG}-${scene}-closed`);
  }
  save('card.json', results);
  if (expect && failures.length) throw new Error(failures.join(' | '));
  note('EXPECT', failures.length ? failures : 'ok');
};
