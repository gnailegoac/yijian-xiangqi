// Task 2 on dev/hud.html with the harness's coach figure (?figure=cheering): what hud.css does to the coach column's
// figure under the game-over card and under the start overlay, in the hud's own harness.
// XC_MODE=landscape: he must be transparent while the card is up. XC_MODE=other: he must stay as he is (the sheet covers the bust).
import { note, save } from './lib.mjs';

const state = () => {
  const fig = document.querySelector('#buddy .buddy-fig');
  const card = document.querySelector('#overlays .hud-layer--over:not(.is-closing) > dialog[data-dialog="over"]');
  const start = document.querySelector('#overlays .hud-layer--start:not(.is-closing)');
  if (!fig) return { fig: false, buddyChildren: document.querySelector('#buddy').childElementCount };
  const f = fig.getBoundingClientRect(), c = card?.getBoundingClientRect();
  return { fig: true, opacity: Number(getComputedStyle(fig).opacity), mood: fig.querySelector('svg.buddy').dataset.mood, variant: document.querySelector('#buddy').dataset.variant,
           layout: document.querySelector('#app').dataset.layout, card: !!card, start: !!start,
           figBox: [f.left, f.top, f.right, f.bottom].map(Math.round), cardBox: c ? [c.left, c.top, c.right, c.bottom].map(Math.round) : null };
};

export default async ({ page, shot }) => {
  const mode = process.env.XC_MODE, tag = process.env.XC_TAG;
  const failures = [];
  const rows = {};
  await page.waitForFunction(() => window.__dev);
  await page.waitForTimeout(500);
  rows.idle = await page.evaluate(state);
  if (!rows.idle.fig || rows.idle.opacity !== 1) failures.push(`the figure is not in the column: ${JSON.stringify(rows.idle)}`);
  for (const kind of ['win', 'loss']) {
    await page.evaluate((k) => { window.__dev.coachFigure(k === 'win' ? 'cheering' : 'consoling'); window.__dev.over(k); }, kind);
    await page.waitForTimeout(900);
    rows[kind] = await page.evaluate(state);
    await shot(`${tag}-${kind}-card`);
    const want = mode === 'landscape' ? 0 : 1;
    if (!rows[kind].card || rows[kind].opacity !== want) failures.push(`${kind}: card up, figure opacity ${rows[kind].opacity}, want ${want}`);
    await page.locator('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
    await page.waitForTimeout(700);
    rows[`${kind}-closed`] = await page.evaluate(state);
    if (rows[`${kind}-closed`].card || rows[`${kind}-closed`].opacity !== 1) failures.push(`${kind}: after 回看棋局 he must be back: ${JSON.stringify(rows[`${kind}-closed`])}`);
  }
  // every mood he can have (cheering is the widest): with the card up he is transparent in landscape, whatever the pose
  rows.moods = {};
  for (const m of ['idle', 'listening', 'thinking', 'curious', 'pleased', 'impressed', 'worried', 'alarmed', 'cheering', 'consoling']) {
    await page.evaluate((mood) => { window.__dev.coachFigure(mood); window.__dev.over('win', { type: false }); }, m);
    await page.waitForTimeout(450);
    const r = await page.evaluate(state);
    rows.moods[m] = { opacity: r.opacity, mood: r.mood, select: await page.evaluate(() => document.querySelector('#dev-figure').value) };
    const want = mode === 'landscape' ? 0 : 1;
    if (r.mood !== m || r.opacity !== want || !r.card) failures.push(`mood ${m}: ${JSON.stringify(r)}`);
    await page.evaluate(() => window.__dev.set('childTurn'));
    await page.waitForTimeout(350);
  }
  // Esc closes the card too
  await page.evaluate(() => window.__dev.over('win'));
  await page.waitForTimeout(700);
  await page.locator('#overlays dialog[data-dialog="over"] [data-choice="again"]').focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  rows.esc = await page.evaluate(state);
  if (rows.esc.card || rows.esc.opacity !== 1) failures.push(`Esc: he must be back: ${JSON.stringify(rows.esc)}`);
  // a new game (setPhase leaves 'over': the hud closes the card itself)
  await page.evaluate(() => window.__dev.over('win'));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__dev.set('childTurn'));
  await page.waitForTimeout(700);
  rows.newGame = await page.evaluate(state);
  if (rows.newGame.card || rows.newGame.opacity !== 1) failures.push(`new game: he must be back: ${JSON.stringify(rows.newGame)}`);
  // the start overlay (the rule of package XB, unchanged): transparent in every layout
  await page.evaluate(() => { void window.__dev.start('again'); });
  await page.waitForTimeout(700);
  rows.start = await page.evaluate(state);
  await shot(`${tag}-start`);
  if (!rows.start.start || rows.start.opacity !== 0) failures.push(`start overlay: figure opacity ${rows.start.opacity}, want 0`);
  await page.locator('#overlays dialog[data-dialog="start"] [data-choice="new"]').click();
  await page.waitForTimeout(900);
  rows.started = await page.evaluate(state);
  if (rows.started.opacity !== 1) failures.push(`after the start overlay he must be back: ${JSON.stringify(rows.started)}`);
  // back to the placeholder
  await page.evaluate(() => window.__dev.coachFigure(''));
  await page.waitForTimeout(200);
  rows.placeholder = await page.evaluate(state);
  if (rows.placeholder.fig || rows.placeholder.buddyChildren !== 0) failures.push(`placeholder: #buddy is not empty again: ${JSON.stringify(rows.placeholder)}`);
  note('HUD', rows);
  save('hud-figure.json', rows);
  if (failures.length) throw new Error(failures.join(' | '));
  note('EXPECT', 'ok');
};
