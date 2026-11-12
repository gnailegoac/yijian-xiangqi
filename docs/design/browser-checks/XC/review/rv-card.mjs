// Reviewer's check of item 2 on dev/stage.html (real stage, real figure, real card).
// For win and loss, with the card up and the page still:
//   A = the page as it is;  C = the figure removed (svg and ::before not displayed);  B = the figure forced opaque (the state before the fix).
//   Claim: A == C everywhere (nothing of him shows), and B != A somewhere outside the card for the cheering figure
//   (so this comparison would have caught the old state).
import { grab, compare, DIFF, note, save, zoom, file } from './rlib.mjs';
const sleep = (page, ms) => page.waitForTimeout(ms);
const TAG = process.env.RV_TAG;

export default async ({ page, shot, context }) => {
  const landscape = process.env.RV_MODE === 'landscape';
  const fails = [];
  const out = {};
  await page.waitForFunction(() => window.__dev && document.querySelectorAll('.piece').length === 32);
  await sleep(page, 500);
  const full = process.env.RV_FULL === '1';
  let region = null;
  const G = (name) => grab(page, name, region ?? undefined);
  for (const scene of ['win', 'loss']) {
    await page.evaluate((s) => window.__dev.moment[s === 'win' ? 'mate' : 'loss'](), scene);
    await sleep(page, 1300);
    await page.evaluate(() => window.__dev.act.confirm());
    await page.waitForFunction(() => document.querySelector('#overlays .hud-layer--over.is-open > dialog[data-dialog="over"]'), null, { timeout: 30000 });
    const t0 = Date.now(), timeline = [];
    if (full) {
      for (const at of [40, 120, 200, 300, 420, 600, 900, 1400]) {
        await sleep(page, Math.max(0, at - (Date.now() - t0)));
        const st = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#buddy .buddy-fig')); return [Number(cs.opacity).toFixed(2), cs.visibility]; });
        timeline.push([Date.now() - t0, ...st]);
      }
      note(`RV fade ${scene}`, timeline.map((x) => x.join('/')).join(' '));
      if (landscape) for (const [t, o, v] of timeline) if (t >= 420 && (o !== '0.00' || v !== 'hidden')) fails.push(`${scene}: ${t} ms after the card came in the figure is ${o}/${v}`);
      region = await page.evaluate(() => { const b = document.querySelector('#board').getBoundingClientRect(), c = document.querySelector('#coach').getBoundingClientRect(); const x = Math.ceil(b.right) + 6; return innerWidth - x < 40 ? null : { x, y: Math.floor(c.top) - 4, width: innerWidth - x, height: Math.min(innerHeight, Math.ceil(c.bottom) + 4) - (Math.floor(c.top) - 4) }; });      // no strip beside the board (compact): the whole page
    }
    // wait until the page is still
    let prev = await G(`${scene}-still`), still = 0, tries = 0;
    while (still < 2 && tries < 30) {
      await sleep(page, 400);
      const next = await G(`${scene}-still`);
      const d = await compare(context, prev.buf, next.buf, DIFF, null);
      still = d.outside === 0 ? still + 1 : 0; prev = next; tries++;
    }
    const info = await page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
      const fig = document.querySelector('#buddy .buddy-fig');
      const cs = getComputedStyle(fig);
      return { layout: document.querySelector('#app').dataset.layout, card: r(document.querySelector('#overlays dialog[data-dialog="over"]')), fig: r(fig),
               mood: fig.querySelector('svg').dataset.mood, variant: document.querySelector('#buddy').dataset.variant, opacity: cs.opacity, visibility: cs.visibility,
               undo: document.querySelector('#undo-button').textContent, undoDisabled: document.querySelector('#undo-button').disabled };
    });
    const A = await G(`${scene}-A`);
    await page.addStyleTag({ content: '#buddy .buddy-fig svg { display: none !important } #buddy .buddy-fig::before { display: none !important } /* rv-C */' });
    await sleep(page, 200);
    const C = await G(`${scene}-C`);
    await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('rv-C')) s.remove(); });
    await page.addStyleTag({ content: '#buddy .buddy-fig { opacity: 1 !important; visibility: visible !important; transition: none !important } /* rv-B */' });
    await sleep(page, 200);
    const B = await G(`${scene}-B`);
    await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('rv-B')) s.remove(); });
    await sleep(page, 200);
    const A2 = await G(`${scene}-A2`);
    const ox = region ? A.x : 0, oy = region ? A.y : 0;
    const box = { left: Math.floor((info.card.left - ox) * 2), top: Math.floor((info.card.top - oy) * 2), right: Math.ceil((info.card.right - ox) * 2), bottom: Math.ceil((info.card.bottom - oy) * 2) };
    const noise = await compare(context, A.buf, A2.buf, DIFF, box);
    const gone = await compare(context, A.buf, C.buf, DIFF, box);
    const forced = await compare(context, A.buf, B.buf, DIFF, box);
    out[scene] = { info, tries, noise, gone, forced };
    note(`RV ${scene}`, { layout: info.layout, variant: info.variant, mood: info.mood, opacity: info.opacity, vis: info.visibility, undo: info.undo, noise: [noise.inside, noise.outside], gone: [gone.inside, gone.outside], forcedOutside: forced.outside, forcedBox: forced.box });
    const moving = noise.inside + noise.outside > 0;
    if (moving && full) note(`RV ${scene}`, 'the strip is never still in full motion (victory rays): no pixel claim, the computed state decides');
    else if (moving) fails.push(`${scene}: page not still`);
    if (landscape && (info.opacity !== '0' || info.visibility !== 'hidden')) fails.push(`${scene}: with the card up the figure is ${info.opacity}/${info.visibility}`);
    if (!landscape && (info.opacity !== '1' || info.visibility !== 'visible' || info.variant !== 'bust')) fails.push(`${scene}: portrait / compact: the bust is ${info.opacity}/${info.visibility}/${info.variant}`);
    if (moving && full) { /* nothing to compare */ } else if (landscape) {
      if (gone.outside || gone.inside) fails.push(`${scene}: removing the figure changes ${gone.outside} px outside / ${gone.inside} inside the card`);
    } else if (forced.inside + forced.outside) fails.push(`${scene}: portrait/compact: forcing the figure opaque changes pixels, so it was not as before`);
    if (info.undo !== '悔棋') fails.push(`${scene}: undo label ${info.undo}`);
    if (landscape) {
      const vw = page.viewportSize();
      const y0 = Math.max(0, info.fig.top - 30);
      const edge = await grab(page, `${scene}-edge-raw`, { x: info.card.left - 70, y: y0, width: 140, height: Math.min(vw.height, info.fig.bottom + 24) - y0 });
      await zoom(context, edge.buf, file(`${scene}-edge.png`), 4);
      // what a tap reaches where the figure stands beside / under the card
      const hit = await page.evaluate(() => {
        const fig = document.querySelector('#buddy .buddy-fig'); const f = fig.getBoundingClientRect();
        const card = document.querySelector('#overlays dialog[data-dialog="over"]').getBoundingClientRect();
        const pts = [[card.left - 4, f.top + f.height * 0.35], [f.left + f.width / 2, Math.min(f.bottom - 3, innerHeight - 1)], [card.left - 2, f.bottom - 10]];
        return pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return { x: Math.round(x), y: Math.round(y), hit: e ? (e.closest('.buddy-fig') ? 'buddy-fig' : (e.id || String(e.className).slice(0, 40) || e.tagName)) : null }; });
      });
      out[scene].hit = hit;
      note(`RV hit ${scene}`, hit);
    }
    await shot(`${TAG}-${scene}-card`);
    await page.locator('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
    await sleep(page, 900);
    const after = await page.evaluate(() => { const fig = document.querySelector('#buddy .buddy-fig'); const cs = getComputedStyle(fig); return { opacity: cs.opacity, visibility: cs.visibility, card: !!document.querySelector('#overlays dialog[data-dialog="over"]'), undo: document.querySelector('#undo-button').textContent, history: document.querySelector('#history-button')?.textContent ?? null }; });
    out[scene].after = after;
    note(`RV after ${scene}`, after);
    if (after.opacity !== '1' || after.visibility !== 'visible' || after.card) fails.push(`${scene}: figure not back after 回看棋局: ${JSON.stringify(after)}`);
    if (after.undo !== '悔棋') fails.push(`${scene}: undo label after close ${after.undo}`);
    await shot(`${TAG}-${scene}-closed`);
  }
  save('card.json', out);
  note('RV-RESULT', fails.length ? fails : 'ok');
  if (fails.length) throw new Error(fails.join(' | '));
};
