// stage.js: start overlay, phase bookkeeping, review, tap outside, idle peek, missing handlers
import { load, suite, calls, clearCalls, tapCell, spyAudio, BASE } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const HELPERS = () => {
  const d = window.__dev;
  const flags0 = { check: false, mate: false, checkedKing: null, checkers: [], crossed: false };
  const t = {
    flags0,
    mv: (b, fr, fc, tr, tc) => ({ from: { row: fr, col: fc }, to: { row: tr, col: tc }, piece: b[fr][fc], captured: b[tr][tc] }),
    after: (b, m) => { const n = b.map((r) => r.slice()); n[m.to.row][m.to.col] = m.piece; n[m.from.row][m.from.col] = null; return n; },
    view: (b, last, by, extra = {}) => ({ board: b, bottom: 'red', lastMove: last, lastBy: by, check: null, checkers: [], round: 1, trophies: { mine: [], lost: [] }, ...extra }),
    at: (id) => { const el = document.querySelector(`.piece[data-id="${id}"]`); return el ? `${el.dataset.row}${el.dataset.col}` : null; },
    mood: () => document.querySelector('#buddy svg.buddy').dataset.mood,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    text: () => document.querySelector('#buddy .bubble .bubble__text')?.textContent ?? '',
    seg: (text) => [{ type: 'text', text }],
    phase: (p, extra = {}) => d.real.phase({ phase: p, canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0, ...extra }),
    async fresh() {
      d.real.settle();
      await d.real.reset(t.view(d.G.board, null, null), { deal: false });
      t.phase('childTurn', { canUndo: false });
      if (window.__audio) window.__audio.length = 0;
      window.__calls.length = 0;
    },
    overView: (result, reason, extra = {}) => ({ result, reason, byChildMate: false, stats: { rounds: 30, captures: 5, brilliant: 1 }, proud: null, rank: null, goal: null, kept: null, quiet: false, ...extra }),
  };
  window.__t = t;
};

export default async ({ page }) => {
  const S = suite();
  const w = (ms) => page.waitForTimeout(ms);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await spyAudio(page);
  const boot = async (query = '') => { await load(page, query); await page.evaluate(HELPERS); await page.evaluate(() => window.__t.fresh()); };

  await S.test("start(): the overlay is up before any game; 开战！ resolves 'new'; with a save 继续上一局 resolves 'continue'", async (t) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.goto(`${BASE}?panel=0`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await w(600);
    const before = await page.evaluate(() => ({ start: !!document.querySelector('dialog[data-dialog="start"]'), pieces: document.querySelectorAll('.piece').length, phase: document.querySelector('#app').dataset.phase }));
    t.eq(before, { start: true, pieces: 0, phase: 'boot' }, 'title card over the empty board, phase boot');
    await page.click('[data-choice="new"]');
    await w(900);
    const after = await page.evaluate(() => ({ start: !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="start"]'), pieces: document.querySelectorAll('.piece').length, log: window.__dev.logLines.find((l) => l.startsWith('start ->')) }));
    t.eq(after, { start: false, pieces: 32, log: "start -> 'new'" }, 'the choice starts the game');
    const cont = page.evaluate(() => window.__dev.real.start({ hasSave: true, firstVisit: false, canImport: false }));
    await w(500);
    const line = await page.evaluate(() => document.querySelector('.hud-start__line').textContent);
    await page.click('[data-choice="continue"]');
    t.eq([await cont, line], ['continue', '小主公回来了！上一局还没下完呢。'], 'continue');
  });

  await S.test("start(): 导入存档 hands the file text to importBackup and resolves 'import'", async (t) => {
    await boot();
    const file = 'C:/Users/USERNAME/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X8/tests/backup.json';
    writeFileSync(file, '{"kind":"yijian-backup","v":1}');
    const done = page.evaluate(() => window.__dev.real.start({ hasSave: false, firstVisit: true, canImport: true }));
    await w(500);
    t.ok(await page.evaluate(() => !!document.querySelector('dialog[data-dialog="start"] [data-choice="import"]')), 'the import button is offered');
    await page.setInputFiles('#overlays input[type="file"]', file);
    t.eq(await done, 'import', 'resolves import');
    t.eq((await calls(page)).filter((c) => c[0] === 'importBackup'), [['importBackup', '{"kind":"yijian-backup","v":1}']], 'importBackup(text)');
  });

  await S.test('phase: #app[data-phase][data-ply]; 对方正在想… only while he thinks; a trial that was neither retracted nor committed is dropped', async (t) => {
    await boot();
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board, app = document.querySelector('#app');
      const out = {};
      T.phase('opponentTurn', { ply: 5, canAsk: false });
      out.thinking = [app.dataset.phase, app.dataset.ply, T.text(), document.querySelector('#hint-button').disabled];
      T.phase('opponentTurn', { ply: 5, canAsk: false, failed: true });
      out.failed = [T.text(), document.querySelector('#retry-opponent').hidden];
      T.phase('childTurn', { ply: 6, hintLevel: 2 });
      out.turn = [app.dataset.phase, app.dataset.ply, T.text(), document.querySelector('#hint-button').dataset.level];
      // resign with a trial on the board: no retracted(), no committed()
      const m = T.mv(b, 9, 7, 7, 6);
      await s.tentative(m, { notation: 'x', aim: false });
      T.phase('tentative');
      out.trial = !!document.querySelector('.piece.is-trial');
      T.phase('over');
      await T.sleep(50);
      out.dropped = [!!document.querySelector('.piece.is-trial'), T.at(m.piece.id)];
      return out;
    });
    t.eq(d.thinking, ['opponentTurn', '5', '对方正在想…', true], 'rival thinking');
    t.eq(d.failed, ['', false], 'failed: the status line leaves the bubble, the retry control is shown');
    t.eq(d.turn, ['childTurn', '6', '', '2'], 'child turn: status gone, pouch level');
    t.eq([d.trial, d.dropped], [true, [false, '97']], 'the abandoned trial is taken off the board');
  });

  await S.test('review: the last-move line redraws the last move; the card buttons become newGame / close + review', async (t) => {
    await boot();
    await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
      const m = T.mv(b, 0, 7, 2, 6);
      await s.rivalMoved({ move: m, notation: '马8进7', flags: T.flags0, caption: [], lostBig: false, softCheck: false, view: T.view(T.after(b, m), m, 'opponent') });
      s.notation([{ n: 1, red: '炮二平五', black: '马8进7' }], 2);
      T.phase('childTurn', { ply: 2 });
    });
    await page.click('.hud-last');
    await w(200);
    const arrow = await page.evaluate(() => { const a = document.querySelector('.arrow'); return a ? [a.dataset.style, a.dataset.from, a.dataset.to] : null; });
    t.eq(arrow, ['last', '07', '26'], 'a `last` arrow on the last move');
    await page.evaluate(async () => { const T = window.__t, s = window.__dev.real; T.phase('over'); await s.over(T.overView('loss', 'resign', { quiet: true })); window.__calls.length = 0; });
    await w(450);
    await page.click('dialog[data-dialog="over"] [data-choice="review"]');
    await w(450);
    const afterReview = await page.evaluate(() => ({ card: !!document.querySelector('dialog[data-dialog="over"]'), arrow: document.querySelector('.arrow')?.dataset.style }));
    t.eq(afterReview, { card: false, arrow: 'last' }, '回看棋局: the card is closed, the arrow is drawn');
    await page.evaluate(async () => { const T = window.__t, s = window.__dev.real; await s.over(T.overView('loss', 'resign', { quiet: true })); });
    await w(450);
    await page.click('dialog[data-dialog="over"] [data-choice="again"]');
    t.eq((await calls(page)).filter((c) => c[0] === 'newGame').length, 1, '再来一局 -> newGame');
  });

  await S.test('landscape sheet: the bubble opens it; the board stays a board; a button keeps its meaning; a tap on the empty shell closes it', async (t) => {
    await boot();
    await page.evaluate(() => { window.__dev.real.coachLocal(window.__t.seg('点一下气泡。')); });
    await w(500);
    await page.click('#buddy .bubble');
    await w(400);
    const open = await page.evaluate(() => document.querySelector('#app').dataset.sheet);
    await clearCalls(page);
    await tapCell(page, 7, 7);
    await page.evaluate(() => window.__t.phase('childTurn', { canUndo: true }));
    await w(400);
    await page.click('#undo-button');
    const still = await page.evaluate(() => document.querySelector('#app').dataset.sheet);
    const got = await calls(page);
    const bar = await page.locator('#topbar').boundingBox();
    await page.mouse.click(bar.x + bar.width * 0.55, bar.y + bar.height / 2);
    await w(400);
    const closed = await page.evaluate(() => document.querySelector('#app').dataset.sheet);
    t.eq([open, still, closed], ['1', '1', '0'], 'open -> still open after board tap and undo -> closed by a tap on the top bar');
    t.eq(got, [['tap', 7, 7, 'tap'], ['undo']], 'the board tap and the button were forwarded');
  });

  await S.test('the silent idle peek: 45 s without input, once per position (fake clock)', async (t) => {
    await boot();
    await page.clock.install();
    const nudge = () => page.evaluate(() => document.querySelector('#hint-button').classList.contains('is-nudge'));
    await page.evaluate(() => window.__t.phase('childTurn', { ply: 4 }));
    await page.clock.runFor(44000);
    const before = await nudge();
    await page.clock.runFor(1500);
    const at45 = await nudge();
    await page.clock.runFor(2000);
    await page.evaluate(() => window.__t.phase('childTurn', { ply: 4 }));          // the same position again
    await page.clock.runFor(46000);
    const again = await nudge();
    await page.evaluate(() => window.__t.phase('childTurn', { ply: 6 }));          // a new position
    await page.clock.runFor(30000);
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));     // any input starts the wait again
    await page.clock.runFor(30000);
    const afterActivity = await nudge();
    await page.clock.runFor(15300);
    const next = await nudge();
    await page.evaluate(() => window.__t.phase('opponentTurn', { ply: 7 }));
    await page.clock.runFor(60000);
    const rival = await nudge();
    t.eq([before, at45, again, afterActivity, next, rival], [false, true, false, false, true, false], 'peek + nudge at 45 s; not twice for one position; restarted by activity; never while the rival thinks');
  });

  await S.test('a stage without handlers (stage.on never called, or {}) forwards nothing and throws nothing', async (t) => {
    await boot();
    await page.evaluate(() => window.__dev.real.on({}));
    await tapCell(page, 7, 7);
    await page.keyboard.press('u');
    await page.keyboard.press('h');
    await page.click('#mute-button');
    await page.evaluate(() => { window.__dev.real.chips(window.__dev.SETS.turn()); });
    await page.click('.chip[data-ask="score"]');
    await w(200);
    t.eq(errors, [], 'no page errors');
  });

  S.report();
};
