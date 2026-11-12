// stage.js: pacing of the strategist's lines (K-101), mouth, read-aloud, the cue queue and settle(), layout and sheet, game over
import { load, suite, calls, clearCalls, tapCell, spyAudio, sounds, audioLog } from './lib.mjs';

const HELPERS = () => {
  const d = window.__dev;
  const flags0 = { check: false, mate: false, checkedKing: null, checkers: [], crossed: false };
  const t = {
    flags0,
    board: () => d.G.board,
    mv: (b, fr, fc, tr, tc) => ({ from: { row: fr, col: fc }, to: { row: tr, col: tc }, piece: b[fr][fc], captured: b[tr][tc] }),
    after: (b, m) => { const n = b.map((r) => r.slice()); n[m.to.row][m.to.col] = m.piece; n[m.from.row][m.from.col] = null; return n; },
    view: (b, last, by, extra = {}) => ({ board: b, bottom: 'red', lastMove: last, lastBy: by, check: null, checkers: [], round: 1, trophies: { mine: [], lost: [] }, ...extra }),
    V: (cat, o = {}) => ({ cat, final: true, held: false, voiced: false, earned: false, focus: [], ...o }),
    at: (id) => { const el = document.querySelector(`.piece[data-id="${id}"]`); return el ? `${el.dataset.row}${el.dataset.col}` : null; },
    mood: () => document.querySelector('#buddy svg.buddy').dataset.mood,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    text: () => document.querySelector('#buddy .bubble .bubble__text')?.textContent ?? '',
    seg: (text) => [{ type: 'text', text }],
    /** Resolves with the ms until the bubble shows `text` (or -1 after `max`). */
    async until(text, max = 6000) {
      const t0 = performance.now();
      while (performance.now() - t0 < max) { if (t.text().includes(text)) return Math.round(performance.now() - t0); await t.sleep(20); }
      return -1;
    },
    async trial() {
      const m = t.mv(d.G.board, 9, 7, 7, 6);
      await d.real.tentative(m, { notation: '马二进三', aim: false });
      d.real.phase({ phase: 'tentative', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      return m;
    },
    commitInfo(m, extra = {}) {
      return { move: m, notation: 'x', flags: flags0, fromTrial: true, cat: 'good', praise: null, stamp: null, self: false, softCheck: false,
               view: t.view(t.after(d.G.board, m), m, 'child'), ...extra };
    },
    async fresh() {
      d.real.settle();
      await d.real.reset(t.view(d.G.board, null, null), { deal: false });
      d.real.phase({ phase: 'childTurn', canUndo: false, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      if (window.__audio) window.__audio.length = 0;
      window.__calls.length = 0;
    },
    overView: (result, reason, extra = {}) => ({ result, reason, byChildMate: false, stats: { rounds: 30, captures: 5, brilliant: 1 }, proud: null, rank: null, goal: null, kept: null, quiet: false, ...extra }),
  };
  window.__t = t;
};

export default async ({ page, context }) => {
  const S = suite();
  const w = (ms) => page.waitForTimeout(ms);
  await spyAudio(page);
  const boot = async (query = '') => { await load(page, query); await page.evaluate(HELPERS); await page.evaluate(() => window.__t.fresh()); };
  await boot();
  const reading = (chars) => Math.max(1200, Math.min(3200, 700 + 60 * chars));

  await S.test('K-101: a local line waits while a reply awaits its first text, and for the reading time after it ended', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      s.coachBegin({ id: 'a', kind: 'opp', cue: null });
      const id = s.coachLocal(T.seg('要不要悔一步重想？'));
      await T.sleep(500);
      const whileWaiting = T.text();
      const line = '他跳马，护住了中间的卒。';                       // 12 visible characters
      s.coachSegment('a', { type: 'text', text: line });
      s.coachEnd('a', { reason: 'done', source: 'local' });
      const shownAfter = await T.until('要不要悔一步重想？');
      return { id: typeof id, whileWaiting, shownAfter };
    });
    t.eq(d.id, 'string', 'coachLocal returns its id synchronously');
    t.eq(d.whileWaiting, '', 'not shown while the reply has said nothing');
    t.near(d.shownAfter, reading(12), 260, 'shown after the reading time of the 12-character line (1420 ms)');
  });

  await S.test('K-101: held lines are shown in order, each after the reading time of the one before; coachBegin takes the bubble at once', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      const ids = [s.coachLocal(T.seg('第一句：先看对方的炮。')), s.coachLocal(T.seg('第二句：再看自己的马。')), s.coachLocal(T.seg('第三句。'))];
      const first = T.text().length > 0 || (await T.until('第一句', 600)) >= 0;
      const second = await T.until('第二句');
      const third = await T.until('第三句');
      // a reply the child caused takes the bubble at once, also inside a reading time
      s.coachLocal(T.seg('这一句刚刚出现，还没读完。'));
      await T.sleep(200);
      s.coachBegin({ id: 'now', kind: 'ask', cue: null });
      s.coachSegment('now', { type: 'text', text: '马上回答。' });
      const took = await T.until('马上回答', 800);
      s.coachEnd('now', { reason: 'done', source: 'llm' });
      return { distinct: new Set(ids).size, first, second, third, took };
    });
    t.eq([d.distinct, d.first], [3, true], 'three ids; the first line is shown at once');
    t.near(d.second, reading(11), 300, 'the second after the reading time of the first (11 characters -> 1360 ms)');
    t.near(d.third, reading(11), 300, 'the third after the reading time of the second');
    t.ok(d.took >= 0 && d.took < 500, `coachBegin is not paced (${d.took} ms)`);
  });

  await S.test('K-101: a held line is dropped, never shown late, at tentative / retracted / committed / rivalMoved / undone / reset / over / settle', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
      const out = {};
      const cases = {
        tentative: async () => { await T.trial(); },
        retracted: async () => { await T.trial(); hold(); await T.sleep(20); await s.retracted({ reselect: false, targets: [], forbidden: [] }); },
        committed: async () => { const m = await T.trial(); hold(); await T.sleep(20); await s.committed(T.commitInfo(m)); },
        rivalMoved: async () => { const m = T.mv(b, 0, 7, 2, 6); await s.rivalMoved({ move: m, notation: '马8进7', flags: T.flags0, caption: [], lostBig: false, softCheck: false, view: T.view(T.after(b, m), m, 'opponent') }); },
        undone: async () => { await s.undone({ steps: [], view: T.view(b, null, null) }); },
        reset: async () => { await s.reset(T.view(b, null, null), { deal: false }); },
        over: async () => { s.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0 }); await s.over(T.overView('draw', 'repetition', { quiet: true })); },
        settle: async () => { s.settle(); },
      };
      const hold = () => { s.coachLocal(T.seg('现在的一句话，要读一会儿。')); s.coachLocal(T.seg('排队的话')); };
      for (const [name, run] of Object.entries(cases)) {
        await T.fresh();
        if (name !== 'retracted' && name !== 'committed') hold();
        await run();
        const shown = await T.until('排队的话', 2600);
        out[name] = shown;
      }
      await T.fresh();
      return out;
    });
    for (const name of ['tentative', 'retracted', 'committed', 'rivalMoved', 'undone', 'reset', 'over', 'settle']) t.eq(d[name], -1, name);
  });

  await S.test('a local line keeps its id for a stale label; a held line that is ended is never shown', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      const id = s.coachLocal(T.seg('小主公，这一步亮记下了。'));
      await T.sleep(600);
      s.coachEnd(id, { reason: 'aborted', source: 'none', stale: '已落子' });
      const stale = [document.querySelector('#buddy .bubble').dataset.state, document.querySelector('#buddy .bubble__stale').textContent];
      await T.fresh();
      s.coachLocal(T.seg('先说这一句，慢慢读。'));
      const heldId = s.coachLocal(T.seg('这句会被取消'));
      s.coachEnd(heldId, { reason: 'aborted', source: 'none' });
      return { stale, shown: await T.until('这句会被取消', 2400) };
    });
    t.eq(d.stale, ['stale', '已落子'], 'the label reaches the shown local line');
    t.eq(d.shown, -1, 'the ended held line is gone');
  });

  await S.test('with ?test=1 the reading time is 300 ms', async (t) => {
    await boot('test=1');
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      s.coachLocal(T.seg('第一句：这是一句很长很长很长很长很长很长的话。'));
      s.coachLocal(T.seg('第二句'));
      return T.until('第二句');
    });
    t.near(d, 300, 220, 'second line after 300 ms');
    await boot();
  });

  await S.test('his mouth moves while a line is typed and closes 200 ms after it is on screen; `thinking` only until the first text', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, svg = document.querySelector('#buddy svg.buddy');
      await T.fresh();
      const mouths = [];
      const watch = setInterval(() => mouths.push(svg.dataset.mouth), 40);
      s.coachBegin({ id: 'm', kind: 'opp', cue: null });
      const waiting = T.mood();
      await T.sleep(200);
      mouths.length = 0;
      for (const text of ['他把车', '开出来', '了，要', '小心这', '条线。']) { s.coachSegment('m', { type: 'text', text }); await T.sleep(110); }
      const speakingMood = T.mood();
      const during = new Set(mouths).size;
      s.coachEnd('m', { reason: 'done', source: 'llm' });
      await T.sleep(900);
      mouths.length = 0;
      await T.sleep(500);
      clearInterval(watch);
      // a local line: the mouth moves while it types
      mouths.length = 0;
      const w2 = setInterval(() => mouths.push(svg.dataset.mouth), 40);
      await T.sleep(1500);
      mouths.length = 0;
      s.coachLocal(T.seg('小主公，这一步走得稳，亮记下了，咱们接着看下一步怎么走。'));
      await T.sleep(600);
      const local = new Set(mouths).size;
      clearInterval(w2);
      return { waiting, speakingMood, during, after: new Set(mouths).size, local };
    });
    t.eq([d.waiting, d.speakingMood], ['thinking', 'idle'], 'thinking, then the base mood when he speaks');
    t.ok(d.during >= 2, 'the mouth alternates while the reply streams');
    t.ok(d.local >= 2, 'the mouth alternates while a local line types');
  });

  await S.test('read-aloud is fed whole sentences and flushed at the end of the line; cancelled by settle()', async (t) => {
    await context.addInitScript(() => {
      const spoken = [];
      window.__spoken = spoken;
      class Utter { constructor(text) { this.text = text; } }
      const synth = { speaking: false, pending: false, getVoices: () => [{ lang: 'zh-CN', name: 'fake' }], addEventListener() {},
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 150); }, cancel() { spoken.push('<cancel>'); } };
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      window.SpeechSynthesisUtterance = Utter;
    });
    await boot();
    await page.mouse.click(5, 300);                                 // a gesture: nothing is spoken before one
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      s.applySettings({ ...window.__dev.settings, readAloud: true });
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await T.fresh();
      window.__spoken.length = 0;
      s.coachBegin({ id: 'ra', kind: 'opp', cue: null });
      for (const text of ['他跳', '马了。小', '主公，看', '中路']) { s.coachSegment('ra', { type: 'text', text }); await T.sleep(80); }
      const mid = window.__spoken.filter((x) => x.trim() && x !== '<cancel>').join('|');
      s.coachEnd('ra', { reason: 'done', source: 'llm' });
      await T.sleep(500);
      const all = window.__spoken.filter((x) => x.trim() && x !== '<cancel>').join('|');
      s.coachBegin({ id: 'rb', kind: 'opp', cue: null });
      s.coachSegment('rb', { type: 'text', text: '这一句会被打断。后面还有很多很多字，' });
      await T.sleep(40);
      window.__spoken.length = 0;
      s.settle();
      return { mid, all, cancelled: window.__spoken.includes('<cancel>') };
    });
    t.ok(d.mid.includes('他跳马了。') && !d.mid.includes('中路'), `only whole sentences are spoken while the line streams (${d.mid})`);
    t.ok(d.all.replace(/\|/g, '') === '他跳马了。小主公，看中路', `the rest is spoken when the line ends (${d.all})`);
    t.ok(d.cancelled, 'settle() cancels speech');
  });

  await S.test('cue queue: a rival move that arrives while the stamp of the child move plays waits its turn', async (t) => {
    await boot();
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b0 = window.__dev.G.board;
      await T.fresh();
      const m = await T.trial();
      const order = [];
      const info = T.commitInfo(m, { stamp: { text: '屏风马！', size: 'full' }, praise: { tier: 'good', streak: 1 } });
      const b1 = info.view.board;
      const reply = T.mv(b1, 0, 7, 2, 6);
      const t0 = performance.now();
      const c = s.committed(info).then(() => order.push(['committed', Math.round(performance.now() - t0)]));
      const r = s.rivalMoved({ move: reply, notation: '马8进7', flags: T.flags0, caption: [], lostBig: false, softCheck: false, view: T.view(T.after(b1, reply), reply, 'opponent') })
        .then(() => order.push(['rivalMoved', Math.round(performance.now() - t0)]));
      const samples = [];
      while (order.length < 2 && performance.now() - t0 < 6000) {
        samples.push({ t: Math.round(performance.now() - t0), rival: T.at(reply.piece.id), stamp: !!document.querySelector('.fx-stamp'), popup: !!document.querySelector('.fx-popup') });
        await T.sleep(40);
      }
      await Promise.all([c, r]);
      const movedAt = samples.find((x) => x.rival === '26')?.t ?? -1;
      const stampEnd = Math.max(...samples.filter((x) => x.stamp).map((x) => x.t));
      const popupStart = samples.find((x) => x.popup)?.t ?? -1;
      return { order, movedAt, stampEnd, popupStart, final: [T.at(m.piece.id), T.at(reply.piece.id)], movedWhileStamp: samples.some((x) => x.stamp && x.rival === '26') };
    });
    t.eq(d.order.map((o) => o[0]), ['committed', 'rivalMoved'], 'the promises resolve in order');
    t.ok(!d.movedWhileStamp && d.movedAt > d.stampEnd, `the rival piece moves only after the stamp (stamp until ${d.stampEnd} ms, move at ${d.movedAt} ms)`);
    t.ok(d.popupStart > d.stampEnd - 60, `the popup follows the stamp (${d.popupStart} ms)`);
    t.eq(d.final, ['76', '26'], 'both moves are on the board');
  });

  await S.test('settle(): every cue reaches its final state at once; promises resolve; scheduled sounds and lines are dropped', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b0 = window.__dev.G.board;
      await T.fresh();
      const m = T.mv(b0, 7, 1, 0, 1);
      await s.tentative(m, { notation: '炮八进七', aim: true });
      const info = T.commitInfo(m, { stamp: { text: '屏风马！', size: 'full' }, praise: { tier: 'lord', streak: 1 } });
      info.view.trophies = { mine: [m.captured], lost: [] };
      const b1 = info.view.board;
      const reply = T.mv(b1, 0, 0, 0, 1);
      let resolved = 0;
      const c = s.committed(info).then(() => { resolved += 1; });
      const r = s.rivalMoved({ move: reply, notation: '车1平2', flags: T.flags0, caption: [], lostBig: true, softCheck: false,
                               view: T.view(T.after(b1, reply), reply, 'opponent', { round: 3, trophies: { mine: [m.captured], lost: [m.piece] } }) }).then(() => { resolved += 1; });
      s.coachBegin({ id: 'z', kind: 'opp', cue: null });
      s.coachSegment('z', { type: 'text', text: '这句话正说到一半' });
      await T.sleep(260);                                            // the cannon shot is in mid-flight
      window.__audio.length = 0;
      s.settle();
      const now = { mine: T.at(m.piece.id), victim: T.at(m.captured.id), rival: T.at(reply.piece.id), stamp: !!document.querySelector('.fx-stamp'), popup: !!document.querySelector('.fx-popup'),
                    lost: document.querySelectorAll('.hud-tray--lost .hud-disc').length, round: document.querySelector('.hud-round b').textContent,
                    cancelled: window.__audio.some((c) => c[0] === 'cancelScheduled'), streaming: document.querySelectorAll('.msg[data-state="streaming"]').length };
      await T.sleep(30);
      now.busy = document.documentElement.dataset.uiBusy ?? null;
      s.coachSegment('z', { type: 'text', text: '，不该再长出来' });
      await T.sleep(200);
      return { now, resolved, grew: T.text().includes('不该再长出来'), pieces: document.querySelectorAll('.piece[data-id]').length };
    });
    t.eq(d.now, { mine: null, victim: null, rival: '01', stamp: false, popup: false, lost: 1, round: '3', cancelled: true, streaming: 0, busy: null },
      'right after settle(): the child cannon was taken back by the rook, nothing animates, the hud shows the last view');
    t.eq([d.resolved, d.grew, d.pieces], [2, false, 30], 'both promises resolved; the line does not grow; 30 pieces left');
  });

  await S.test('confirm while the comment streams (settle, then committed): the line is stale with 已落子 and never grows again', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      const m = await T.trial();
      s.verdict(T.V('good'));
      s.coachBegin({ id: 'cm', kind: 'try', cue: null });
      s.coachSegment('cm', { type: 'text', text: '这一步把马跳出来，' });
      await T.sleep(500);
      s.settle();                                                   // the director settles before every command
      const done = s.committed(T.commitInfo(m));
      const at = { state: document.querySelector('#buddy .bubble').dataset.state, label: document.querySelector('#buddy .bubble__stale').textContent, text: T.text() };
      s.coachSegment('cm', { type: 'text', text: '后面的字不该出现' });
      s.coachEnd('cm', { reason: 'done', source: 'llm' });
      await done;
      await T.sleep(600);
      return { at, later: T.text(), log: document.querySelector('.msg[data-id="cm"]').dataset.state };
    });
    t.eq(d.at, { state: 'stale', label: '已落子', text: '这一步把马跳出来，' }, 'stale at once');
    t.eq([d.later, d.log], ['这一步把马跳出来，', 'stale'], 'no growth; stale in the log');
  });

  await S.test('zero-wait touch: a selection and a trial start in the same frame while the cue of the rival move is still playing', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b0 = window.__dev.G.board;
      await T.fresh();
      const r = T.mv(b0, 0, 7, 2, 6);
      const b1 = T.after(b0, r);
      let rivalDone = false;
      const p = s.rivalMoved({ move: r, notation: '马8进7', flags: { check: true, mate: false, checkedKing: { row: 9, col: 4 }, checkers: [{ row: 2, col: 6 }], crossed: false }, caption: [], lostBig: false, softCheck: false,
                               view: T.view(b1, r, 'opponent', { check: 'red', checkers: [{ row: 2, col: 6 }] }) });
      p.then(() => { rivalDone = true; });
      await T.sleep(120);
      const m = T.mv(b1, 9, 7, 7, 6);
      s.selected(m.from, [m], []);
      const selected = !!document.querySelector('.piece.is-selected[data-id="' + m.piece.id + '"]');
      const landed = s.tentative(m, { notation: '马二进三', aim: false });
      s.verdict({ cat: 'good', final: false, held: false, voiced: false, earned: false, focus: [] });
      const now = { trial: !!document.querySelector('.piece.is-trial[data-id="' + m.piece.id + '"]'), mood: T.mood(), rivalDone };
      await landed;
      const after = { rivalDoneWhenLanded: rivalDone };
      await p;
      return { selected, now, after, rival: T.at(r.piece.id) };
    });
    t.eq(d.selected, true, 'selected at once');
    t.eq(d.now, { trial: true, mood: 'pleased', rivalDone: false }, 'the trial and the face are there while the rival cue (E1, travel, 将军！) is still running');
    t.eq(d.rival, '26', 'and the rival move still ends where it should');
  });

  await S.test('layout: applyLayout on resize, buddy variant, chat layout; the sheet sets #app[data-sheet]', async (t) => {
    const read = () => page.evaluate(() => { const app = document.querySelector('#app'); return [app.dataset.layout, document.querySelector('#buddy').dataset.variant, document.querySelector('#chat').dataset.mode, app.style.getPropertyValue('--c')]; });
    await page.setViewportSize({ width: 820, height: 1180 }); await w(250);
    const portrait = await read();
    await page.setViewportSize({ width: 360, height: 740 }); await w(250);
    const compact = await read();
    // compact: the sheet shrinks the stage to a miniature; the board ignores taps and one tap on it closes the sheet
    await page.evaluate(() => { window.__dev.real.coachLocal(window.__t.seg('点一下气泡，打开回看。')); });
    await w(500);
    await page.click('#buddy .bubble');
    await w(450);
    const open = await page.evaluate(() => [document.querySelector('#app').dataset.sheet, document.querySelector('#board').classList.contains('is-interactive'), getComputedStyle(document.querySelector('#stage')).transform !== 'none']);
    await clearCalls(page);
    const box = await page.locator('#stage').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 40);
    await w(450);
    const closed = await page.evaluate(() => [document.querySelector('#app').dataset.sheet, document.querySelector('#board').classList.contains('is-interactive')]);
    const taps = (await calls(page)).filter((c) => c[0] === 'tap').length;
    await page.setViewportSize({ width: 1180, height: 820 }); await w(250);
    const landscape = await read();
    t.eq(portrait, ['portrait', 'bust', 'portrait', '76.6px'], '820x1180');
    t.eq(compact, ['compact', 'bust', 'compact', '38.26px'], '360x740');
    t.eq(landscape, ['landscape', 'full', 'landscape', '65.28px'], '1180x820');
    t.eq(open, ['1', false, true], 'compact sheet: data-sheet, board not interactive, stage scaled');
    t.eq([closed, taps], [['0', true], 0], 'a tap on the miniature closes the sheet and is not a move');
  });

  await S.test('portrait: the sheet never covers the trial square (inline max-height, at least 280 px)', async (t) => {
    await page.setViewportSize({ width: 820, height: 1180 }); await w(250);
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
      await T.fresh();
      await s.tentative(T.mv(b, 7, 7, 7, 4), { notation: '炮二平五', aim: false });     // row 7: under the sheet
      document.querySelector('#history-button').click();
      await T.sleep(400);
      const chat = document.querySelector('#chat').getBoundingClientRect();
      const cell = document.querySelector('.board-cell[data-row="7"][data-col="4"]').getBoundingClientRect();
      const out = { sheet: document.querySelector('#app').dataset.sheet, maxHeight: document.querySelector('#chat').style.maxHeight, top: Math.round(chat.top), squareBottom: Math.round(cell.bottom), height: Math.round(chat.height) };
      document.querySelector('.chat__head').click();
      await T.sleep(300);
      out.cleared = document.querySelector('#chat').style.maxHeight;
      await T.fresh();
      return out;
    });
    t.ok(d.sheet === '1' && d.maxHeight !== '', `the sheet is limited (${d.maxHeight})`);
    t.ok(d.top >= d.squareBottom - 2 && d.height >= 280, `its top (${d.top}) is below the square (${d.squareBottom}); height ${d.height}`);
    t.eq(d.cleared, '', 'the limit goes with the sheet');
    await page.setViewportSize({ width: 1180, height: 820 }); await w(250);
  });

  await S.test('over (win): scene, confetti, rays, 本局最佳 replay on the old position, then the card; undone clears all of it', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, dev = window.__dev, b = dev.G.board;
      await T.fresh();
      s.tension(0.9);
      s.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 40 });
      window.__audio.length = 0;
      const proudBefore = dev.SCENES ? null : null;
      const before = dev.parse ? window.__dev.G.board : b;
      const pm = T.mv(before, 9, 7, 7, 6);
      const t0 = performance.now();
      let up = -1;
      const p = s.over(T.overView('win', 'stalemate', { proud: { before, move: pm, notation: '马二进三', self: true }, rank: { to: 4, name: '初露锋芒' }, goal: '下一盘小目标' })).then(() => { up = Math.round(performance.now() - t0); });
      await T.sleep(300);
      const start = { mood: T.mood(), rays: !!document.querySelector('.stage-rays'), live: document.querySelector('.fx-canvas') ? 1 : 0, banner: document.querySelector('.fx-banner')?.dataset.kind,
                      vignette: document.querySelector('#board').style.getPropertyValue('--tension'), card: !!document.querySelector('dialog[data-dialog="over"]') };
      let ribbon = null, replayPiece = null;
      while (up < 0 && performance.now() - t0 < 12000) {
        const r = document.querySelector('.stage-ribbon');
        if (r && !ribbon) ribbon = r.textContent;
        if (r && T.at(pm.piece.id) === '76') replayPiece = '76';
        await T.sleep(60);
      }
      await p;
      const end = { card: !!document.querySelector('dialog[data-dialog="over"]'), ribbon: !!document.querySelector('.stage-ribbon'), at: T.at(pm.piece.id), interactive: document.querySelector('#board').classList.contains('is-interactive') };
      const audio = { plays: window.__audio.filter((c) => c[0] === 'play' && /^(win|lose|draw|praise)/.test(c[1])).map((c) => c[1]), scene: window.__audio.filter((c) => c[0] === 'music.setScene').map((c) => c[1]) };
      // the takeaway is streamed into the card
      s.coachBegin({ id: 'ov', kind: 'over', cue: '大捷！', target: 'card' });
      s.coachSegment('ov', { type: 'text', text: '这一局赢得漂亮！' });
      s.coachEnd('ov', { reason: 'done', source: 'local' });
      await T.sleep(700);
      const takeaway = document.querySelector('.hud-over__takeaway').textContent;
      const bubbleUntouched = !T.text().includes('这一局赢得漂亮');
      // undo: everything of the ending goes
      window.__audio.length = 0;
      await s.undone({ steps: [], view: T.view(b, null, null) });
      s.phase({ phase: 'childTurn', canUndo: false, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      await T.sleep(400);
      const undone = { rays: !!document.querySelector('.stage-rays'), card: !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]'), scene: window.__audio.filter((c) => c[0] === 'music.setScene').map((c) => c[1]),
                       mood: T.mood(), vignette: document.querySelector('#board').style.getPropertyValue('--tension') };
      return { start, ribbon, replayPiece, up, end, audio, takeaway, bubbleUntouched, undone };
    });
    t.eq(d.start, { mood: 'cheering', rays: true, live: 1, banner: 'stalemate', vignette: '0', card: false }, 'at once: cheering, rays, 困毙 banner, the red glow rests, no card yet');
    t.eq([d.ribbon, d.replayPiece], ['本局最佳', '76'], 'the ribbon and the replayed move');
    t.ok(d.up > 5000, `over() resolves when the card is up (${d.up} ms: celebration, 3 s replay, card)`);
    t.eq(d.end, { card: true, ribbon: false, at: '97', interactive: true }, 'the card is up; the board is back on the final position');
    t.eq(d.audio, { plays: ['win', 'praise.great'], scene: ['victory'] }, 'win for a win that is not a mate; 妙计 for the replay; scene victory');
    t.ok(d.takeaway.includes('这一局赢得漂亮！') && d.bubbleUntouched, 'target card: the takeaway is in the card, not in the bubble');
    t.eq(d.undone, { rays: false, card: false, scene: ['game'], mood: 'idle', vignette: '0.9' }, 'after an undo');
  });

  await S.test('over: a mate by the child sounds no second `win`; a loss dims the board, says 惜败，再战！ calmly; a draw; quiet = the card only', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
      const out = {};
      const run = async (name, view) => {
        await T.fresh();
        s.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 40 });
        window.__audio.length = 0;
        const t0 = performance.now();
        let ms = -1;
        const p = s.over(view).then(() => { ms = Math.round(performance.now() - t0); });
        await T.sleep(250);
        const banner = document.querySelector('.fx-banner');
        const early = { mood: T.mood(), banner: banner ? [banner.dataset.kind, banner.dataset.tone] : null, lost: document.querySelector('#board').classList.contains('is-lost'), rays: !!document.querySelector('.stage-rays'),
                        card: !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]'), ribbon: !!document.querySelector('.stage-ribbon') };
        await p;
        out[name] = { early, ms, card: !!document.querySelector('dialog[data-dialog="over"]'), title: document.querySelector('.hud-over__title')?.textContent,
                      plays: window.__audio.filter((c) => c[0] === 'play' && /^(win|lose|draw)/.test(c[1])).map((c) => c[1]), scene: window.__audio.filter((c) => c[0] === 'music.setScene').map((c) => c[1]) };
      };
      await run('mate', T.overView('win', 'checkmate', { byChildMate: true }));
      await run('loss', T.overView('loss', 'checkmate'));
      await run('draw', T.overView('draw', 'repetition'));
      await run('quiet', T.overView('loss', 'resign', { quiet: true }));
      await T.fresh();
      out.afterReset = { lost: document.querySelector('#board').classList.contains('is-lost'), card: !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]') };
      return out;
    });
    t.eq([d.mate.early.mood, d.mate.early.banner, d.mate.plays, d.mate.scene, d.mate.title], ['cheering', null, [], ['victory'], '大获全胜！'], 'mate: no banner and no win stinger from the stage (the board played both)');
    t.eq([d.loss.early.mood, d.loss.early.banner, d.loss.early.lost, d.loss.early.rays, d.loss.plays, d.loss.scene, d.loss.title], ['consoling', ['lose', 'calm'], true, false, ['lose'], ['defeat'], '惜败一局'], 'loss');
    t.ok(d.loss.ms >= 1400 && d.loss.card && !d.loss.early.card, `loss: the card follows the banner (${d.loss.ms} ms)`);
    t.eq([d.draw.early.mood, d.draw.early.banner, d.draw.plays, d.draw.title], ['pleased', ['draw', 'calm'], ['draw'], '握手言和'], 'draw');
    t.eq([d.quiet.early, d.quiet.plays, d.quiet.scene], [{ mood: 'consoling', banner: null, lost: false, rays: false, card: true, ribbon: false }, [], []], 'quiet: the card only, no sound');
    t.ok(d.quiet.ms < 200, `quiet resolves at once (${d.quiet.ms} ms)`);
    t.eq(d.afterReset, { lost: false, card: false }, 'reset clears the ending');
  });

  await S.test('reduced motion: no rays; the rank of a game-over view reaches the settings sheet', async (t) => {
    await boot('motion=reduced');
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      s.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 40 });
      await s.over(T.overView('win', 'stalemate', { rank: { to: 5, name: '运筹帷幄' } }));
      return { rays: !!document.querySelector('.stage-rays'), card: !!document.querySelector('dialog[data-dialog="over"]') };
    });
    t.eq(d, { rays: false, card: true }, 'no rays, the card');
    await page.evaluate(() => window.__t.fresh());
    await page.click('#menu-button'); await w(200);
    await page.click('.hud-menu__item[data-menu="settings"]'); await w(200);
    t.eq(await page.evaluate(() => document.querySelector('.hud-rank__name')?.textContent), '运筹帷幄', 'status.rank on openSettings');
    await page.keyboard.press('Escape');
    await boot();
  });

  await S.test('reset: orientation follows view.bottom, the log is emptied, deal resolves after 开战！; coachBegin target card without a card falls back to the bubble', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
      s.coachLocal(T.seg('旧的一句话。'));
      await T.sleep(300);
      const t0 = performance.now();
      let banner = null;
      const p = s.reset({ ...T.view(b, null, null), bottom: 'black' }, { deal: true });
      const watch = setInterval(() => { const el = document.querySelector('.fx-banner'); if (el) banner = el.dataset.kind; }, 50);
      await p;
      clearInterval(watch);
      const out = { ms: Math.round(performance.now() - t0), banner, bottom: document.querySelector('#board').dataset.bottom, log: document.querySelectorAll('.chat__log .msg').length,
                    bubble: document.querySelector('#buddy .bubble').textContent, pieces: document.querySelectorAll('.piece[data-id]').length, sound: window.__audio.filter((c) => c[0] === 'play').map((c) => c[1]).includes('deal') };
      s.coachBegin({ id: 'c', kind: 'over', cue: null, target: 'card' });
      s.coachSegment('c', { type: 'text', text: '没有卡片时在气泡里说。' });
      s.coachEnd('c', { reason: 'done', source: 'local' });
      out.fallback = await T.until('没有卡片时在气泡里说', 1500);
      await T.fresh();
      return out;
    });
    t.ok(d.ms > 1200 && d.banner === 'start' && d.sound, `the deal and 开战！ are awaited (${d.ms} ms)`);
    t.eq([d.bottom, d.log, d.bubble, d.pieces], ['black', 0, '', 32], 'black at the bottom, empty log and bubble, 32 pieces');
    t.ok(d.fallback >= 0, 'card target without a card: the bubble');
  });

  await S.test('the bubble forgets the rival-move caption when the child moves on without a comment, and at an undo', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, dev = window.__dev, b = dev.G.board;
      await T.fresh();
      const cap = () => document.querySelector('#buddy .bubble__caption').textContent;
      s.caption(dev.parse('【马8进7】出子', { board: b }));
      s.coachBegin({ id: 'o', kind: 'opp', cue: null });
      s.coachSegment('o', { type: 'text', text: '他跳马了。' });
      s.coachEnd('o', { reason: 'done', source: 'local' });
      await T.sleep(500);
      const before = [cap(), T.text()];
      const m = await T.trial();                                    // a nod, no comment
      s.verdict(T.V('good'));
      const duringTrial = [cap(), T.text()];
      await s.committed(T.commitInfo(m));
      const afterCommit = [cap(), T.text()];
      // with a comment on the trial the comment stays
      await T.fresh();
      s.caption(dev.parse('【马8进7】出子', { board: b }));
      const m2 = await T.trial();
      s.coachBegin({ id: 'c', kind: 'try', cue: null });
      s.coachSegment('c', { type: 'text', text: '这步走得稳。' });
      s.coachEnd('c', { reason: 'done', source: 'llm' });
      await T.sleep(500);
      await s.committed(T.commitInfo(m2));
      const kept = [cap(), T.text(), document.querySelector('#buddy .bubble').dataset.state];
      // undo
      s.caption(dev.parse('【马8进7】出子', { board: b }));
      await s.undone({ steps: [], view: T.view(b, null, null) });
      const afterUndo = cap();
      return { before, duringTrial, afterCommit, kept, afterUndo };
    });
    t.eq(d.before, ['马8进7出子', '他跳马了。'], 'caption with its sentence');
    t.eq(d.duringTrial, ['马8进7出子', '他跳马了。'], 'still there during a silent trial');
    t.eq(d.afterCommit, ['', ''], 'gone when the move is played');
    t.eq(d.kept, ['', '这步走得稳。', 'done'], 'a finished trial comment stays (not stale) after the commit');
    t.eq(d.afterUndo, '', 'gone after an undo');
  });

  await S.test('coachReset empties the line for its replacement; coachEnd cut keeps whole sentences; an aborted empty line leaves no trace', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      s.coachBegin({ id: 'r', kind: 'ask', cue: null });
      s.coachSegment('r', { type: 'text', text: '这段话会被换掉' });
      await T.sleep(500);
      s.coachReset('r');
      const afterReset = T.text();
      s.coachSegment('r', { type: 'text', text: '这件事亮帮不上忙。咱们接着看棋？' });
      s.coachEnd('r', { reason: 'done', source: 'local' });
      await T.sleep(700);
      const replaced = [T.text(), document.querySelector('#buddy .bubble').dataset.source];
      s.coachBegin({ id: 'k', kind: 'opp', cue: null });
      s.coachSegment('k', { type: 'text', text: '第一句说完了。第二句说到一' });
      await T.sleep(900);
      s.coachEnd('k', { reason: 'cut', source: 'mixed' });
      await T.sleep(200);
      const cut = [T.text(), document.querySelector('#buddy .bubble').dataset.source];
      s.coachBegin({ id: 'e', kind: 'opp', cue: null });
      s.coachEnd('e', { reason: 'aborted', source: 'none' });
      return { afterReset, replaced, cut, trace: !!document.querySelector('.msg[data-id="e"]') };
    });
    t.eq(d.afterReset, '', 'reset');
    t.eq(d.replaced, ['这件事亮帮不上忙。咱们接着看棋？', 'local'], 'the replacement');
    t.eq(d.cut, ['第一句说完了。', 'mixed'], 'cut: whole sentences stay');
    t.eq(d.trace, false, 'aborted with no text: removed');
  });

  await S.test('visibilitychange reaches audio.setHidden; every gesture calls audio.unlock (window, capture)', async (t) => {
    const d = await page.evaluate(async () => {
      window.__audio.length = 0;
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const hidden = window.__audio.filter((c) => c[0] === 'setHidden').map((c) => c[1]);
      window.__audio.length = 0;
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      return { hidden, unlocks: window.__audio.filter((c) => c[0] === 'unlock').length };
    });
    t.eq(d, { hidden: [true, false], unlocks: 2 }, 'setHidden(true), setHidden(false); unlock on pointerdown and on keydown');
  });

  S.report();
};
