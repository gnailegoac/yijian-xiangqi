// Reviewer's adversarial check on dev/hud.html?figure=cheering (the real figure in the coach column):
// while the game-over card is up in landscape, the figure that has stepped out is not a control either:
// Tab never lands on something the child cannot see, a tap where he stood reaches nothing of him, and he is a
// control again when the card has gone. Also: every mood, Esc, a new game, a second card, the start overlay.
import { grab, compare, DIFF, note, save } from './rlib.mjs';
const sleep = (page, ms) => page.waitForTimeout(ms);
const MOODS = ['idle', 'listening', 'thinking', 'curious', 'pleased', 'impressed', 'worried', 'alarmed', 'cheering', 'consoling'];

const seenState = () => {
  const fig = document.querySelector('#buddy .buddy-fig');
  if (!fig) return null;
  const cs = getComputedStyle(fig);
  return { opacity: cs.opacity, visibility: cs.visibility, mood: fig.querySelector('svg').dataset.mood, card: !!document.querySelector('#overlays .hud-layer--over:not(.is-closing) > dialog'), layout: document.querySelector('#app').dataset.layout };
};

/** Presses Tab `n` times from the top of the page; returns what was focused and whether it can be seen. */
async function tabWalk(page, n = 30) {
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  const stops = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return { what: 'body', seen: true };
      let seen = true;
      for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.opacity === '0' || cs.visibility !== 'visible' || cs.display === 'none') seen = false; }
      return { what: e.id || (e.dataset.choice ? `choice:${e.dataset.choice}` : '') || String(e.className).split(' ')[0] || e.tagName, seen };
    }));
  }
  return stops;
}

export default async ({ page, shot, context }) => {
  const landscape = process.env.RV_MODE === 'landscape';
  const fails = [], out = {};
  await page.waitForFunction(() => window.__dev && document.querySelector('#buddy .buddy-fig'));
  await sleep(page, 400);
  await page.evaluate(() => { window.__taps = 0; document.querySelector('#buddy').addEventListener('buddy:tap', () => window.__taps++); });

  // 1. before the card: he is a control
  const before = await tabWalk(page);
  if (!before.some((s) => s.what === 'buddy-fig' && s.seen)) fails.push('before the card: Tab does not reach the figure');
  if (before.some((s) => !s.seen)) fails.push(`before the card: Tab lands on something unseen: ${JSON.stringify(before.filter((s) => !s.seen))}`);

  // 2. the card up
  await page.evaluate(() => window.__dev.over('win'));
  await sleep(page, 900);
  const up = await page.evaluate(seenState);
  out.up = up;
  const walk = await tabWalk(page);
  out.walk = walk.map((s) => `${s.what}${s.seen ? '' : '(UNSEEN)'}`);
  note('RV tab-with-card', out.walk.join(' '));
  if (landscape) {
    if (!(up.opacity === '0')) fails.push(`card up: opacity ${up.opacity}`);
    if (walk.some((s) => !s.seen)) fails.push(`card up: Tab lands on something the child cannot see: ${JSON.stringify(walk.filter((s) => !s.seen).map((s) => s.what))}`);
    // taps where he stands, outside the card
    const pts = await page.evaluate(() => {
      const f = document.querySelector('#buddy .buddy-fig').getBoundingClientRect(), c = document.querySelector('#overlays dialog[data-dialog="over"]').getBoundingClientRect();
      const list = [];
      for (let y = f.top + 4; y < f.bottom - 2; y += 12) for (let x = f.left + 4; x < f.right - 2; x += 12) {
        if (x >= c.left && x < c.right && y >= c.top && y < c.bottom) continue;
        const e = document.elementFromPoint(x, y);
        list.push({ x: Math.round(x), y: Math.round(y), fig: !!(e && e.closest('.buddy-fig')) });
      }
      return list;
    });
    const onFig = pts.filter((p) => p.fig);
    out.outsidePoints = pts.length; out.hitFigure = onFig.length;
    note('RV hit-with-card', { pointsOutsideCard: pts.length, hitFigure: onFig.length, first: onFig[0] ?? null });
    if (onFig.length) fails.push(`card up: ${onFig.length} of ${pts.length} points of his box outside the card still hit the figure`);
    if (pts.length) {
      const p = onFig[0] ?? pts[0];
      await page.touchscreen.tap(p.x, p.y);
      await sleep(page, 150);
      const taps = await page.evaluate(() => window.__taps);
      if (taps) fails.push(`card up: a tap at ${p.x},${p.y} made the hidden figure react (${taps})`);
    }
  } else if (up.opacity !== '1' || up.visibility !== 'visible') fails.push(`portrait / compact: the bust must stay as it was (${JSON.stringify(up)})`);

  // 3. every mood while the card stays up: nothing of him in the picture (compare with the figure taken out)
  if (landscape) {
    await page.addStyleTag({ content: '#buddy .buddy-fig svg { display: none !important } #buddy .buddy-fig::before { display: none !important } /* rv-C */' });
    await sleep(page, 400);
    const C = await grab(page, 'moods-C');
    await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('rv-C')) s.remove(); });
    const moods = {}, shots = {};
    for (const mood of MOODS) {
      await page.evaluate((m) => window.__dev.coachFigure(m), mood);
      await sleep(page, 250);
      shots[mood] = { A: await grab(page, 'moods-A'), s: await page.evaluate(seenState) };
    }
    for (const mood of MOODS) {            // compare afterwards: opening another page moves the focus ring in this one
      const d = await compare(context, C.buf, shots[mood].A.buf, DIFF, null);
      const st = shots[mood].s;
      moods[mood] = { differ: d.outside, opacity: st.opacity, mood: st.mood };
      if (d.outside || st.mood !== mood) fails.push(`card up, mood ${mood}: ${d.outside} px differ from the page without him (mood shown ${st.mood})`);
    }
    out.moods = moods;
    note('RV moods-with-card', Object.entries(moods).map(([m, v]) => `${m}:${v.differ}`).join(' '));
  }
  await shot(`${process.env.RV_TAG}-card`);

  // 4. the card goes: 回看棋局, Esc, a new game, close(); a second card replacing the first keeps him out
  const back = async (label) => {
    await sleep(page, 700);
    const s = await page.evaluate(seenState);
    out[label] = s;
    if (s.card || s.opacity !== '1' || s.visibility !== 'visible') fails.push(`${label}: he is not back (${JSON.stringify(s)})`);
  };
  await page.locator('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
  await back('after 回看棋局');
  const after = await tabWalk(page);
  if (!after.some((s) => s.what === 'buddy-fig' && s.seen)) fails.push('after the card: Tab does not reach the figure again');
  await page.evaluate(() => { window.__taps = 0; });
  await page.locator('#buddy .buddy-fig').tap();
  await sleep(page, 100);
  if ((await page.evaluate(() => window.__taps)) !== 1) fails.push('after the card: a tap on him sends no buddy:tap');

  await page.evaluate(() => window.__dev.over('loss'));
  await sleep(page, 600);
  await page.locator('#overlays dialog[data-dialog="over"] [data-choice="again"]').focus();
  await page.keyboard.press('Escape');
  await back('after Esc');

  await page.evaluate(() => window.__dev.over('draw'));
  await sleep(page, 600);
  await page.evaluate(() => window.__dev.over('win'));            // a second card replaces the first
  await sleep(page, 150);
  const mid = await page.evaluate(seenState);
  await sleep(page, 600);
  const two = await page.evaluate(seenState);
  out.replaced = { mid, two, layers: await page.evaluate(() => document.querySelectorAll('#overlays .hud-layer--over').length) };
  if (landscape && (two.opacity !== '0' || mid.opacity === '1')) fails.push(`second card: ${JSON.stringify(out.replaced)}`);
  await page.locator('#overlays .hud-layer--over:not(.is-closing) [data-choice="again"]').click();
  await back('after 再来一局');

  // 5. a sheet over the card (menu -> settings): he stays out; closeAll() closes the card too and he is back
  await page.evaluate(() => window.__dev.over('win'));
  await sleep(page, 600);
  await page.evaluate(() => { document.querySelector('#menu-button').click(); document.querySelector('.hud-menu__item[data-menu="settings"]').click(); });
  await sleep(page, 500);
  const under = await page.evaluate(seenState);
  out.sheet = { under, sheetOpen: await page.evaluate(() => !!document.querySelector('#overlays dialog[data-dialog="settings"]')) };
  if (!out.sheet.sheetOpen) fails.push('the settings sheet did not open over the card');
  if (landscape && (under.opacity !== '0' || !under.card)) fails.push(`sheet over the card: ${JSON.stringify(out.sheet)}`);
  await page.evaluate(() => window.__dev.hud.closeAll());
  await back('after closeAll()');

  // 6. the start overlay still hides him, in every layout, and he returns
  const done = page.evaluate(() => { window.__dev.start('again'); });
  await done;
  await sleep(page, 700);
  const underStart = await page.evaluate(seenState);
  if (underStart.opacity !== '0') fails.push(`start overlay: opacity ${underStart.opacity}`);
  await page.locator('#overlays dialog[data-dialog="start"] [data-choice="new"]').click();
  await back('after the start overlay');

  save('inert.json', out);
  note('RV-RESULT', fails.length ? fails : 'ok');
  if (fails.length) throw new Error(fails.join(' | '));
};
