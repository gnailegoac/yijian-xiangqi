// Reviewer's adversarial tests of stage.js (run through tools/shot.mjs --steps on dev/stage.html).
import { load, suite, spyAudio, sounds, clearAudio } from './lib.mjs';

const HELPERS = () => {
  const d = window.__dev;
  const flags0 = { check: false, mate: false, checkedKing: null, checkers: [], crossed: false };
  const t = {
    flags0,
    mv: (b, fr, fc, tr, tc) => ({ from: { row: fr, col: fc }, to: { row: tr, col: tc }, piece: b[fr][fc], captured: b[tr][tc] }),
    after: (b, m) => { const n = b.map((r) => r.slice()); n[m.to.row][m.to.col] = m.piece; n[m.from.row][m.from.col] = null; return n; },
    view: (b, last, by, extra = {}) => ({ board: b, bottom: 'red', lastMove: last, lastBy: by, check: null, checkers: [], round: 1, trophies: { mine: [], lost: [] }, ...extra }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    text: () => document.querySelector('#buddy .bubble .bubble__text')?.textContent ?? '',
    seg: (text) => [{ type: 'text', text }],
    rival: () => document.querySelector('.rival').dataset.mood,
    async until(fn, max = 6000) {
      const t0 = performance.now();
      while (performance.now() - t0 < max) { if (fn()) return Math.round(performance.now() - t0); await t.sleep(16); }
      return -1;
    },
    async trial(fr = 9, fc = 7, tr = 7, tc = 6) {
      const m = t.mv(d.G.board, fr, fc, tr, tc);
      await d.real.tentative(m, { notation: '马二进三', aim: !!m.captured });
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
      if (window.__calls) window.__calls.length = 0;
    },
    /** Samples fn() every frame for `ms`; returns the changes as [t, value]. */
    trace(fn, ms) {
      const rows = [];
      const t0 = performance.now();
      return new Promise((resolve) => {
        const tick = () => {
          const v = fn();
          if (!rows.length || rows[rows.length - 1][1] !== v) rows.push([Math.round(performance.now() - t0), v]);
          if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(rows);
        };
        tick();
      });
    },
    overView: (result, reason, extra = {}) => ({ result, reason, byChildMate: false, stats: { rounds: 30, captures: 5, brilliant: 1 }, proud: null, rank: null, goal: null, kept: null, quiet: false, ...extra }),
  };
  window.__t = t;
};

/** A speechSynthesis that only records what it is asked to say. */
const FAKE_SPEECH = () => {
  const said = (window.__said = []);
  class U { constructor(text) { this.text = text; this.volume = 1; } }
  const synth = {
    speaking: false, pending: false,
    getVoices: () => [{ lang: 'zh-CN', name: 'fake' }],
    addEventListener() {}, removeEventListener() {},
    speak(u) { if (u.volume > 0 && u.text.trim()) said.push(u.text); setTimeout(() => u.onend && u.onend(), 30); },
    cancel() { said.push('<cancel>'); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U;
};

export default async ({ page }) => {
  const S = suite();
  await spyAudio(page);
  const boot = async (query = '', opts = {}) => { await load(page, query, opts); await page.evaluate(HELPERS); if (!opts.director) await page.evaluate(() => window.__t.fresh()); };
  await boot();

  await S.test('rival: `rattled` told with the commit waits for the pay-off (the stamp), is still on his face at the popup, and `thinking` follows it', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      const m = await T.trial();
      await T.sleep(500);
      const state = () => `${T.rival()}|${document.querySelector('.fx-stamp') ? 'stamp' : ''}|${[...document.querySelectorAll('.fx-popup')].map((p) => p.dataset.tone).join('+')}`;
      const tracing = T.trace(state, 5200);
      // one run of calls, as the director makes them (5.8 E-commit, then E-rival in the same batch)
      const done = s.committed(T.commitInfo(m, { stamp: { text: '屏风马！', size: 'full' }, praise: { tier: 'lord', streak: 1 }, self: true }));
      s.rival({ mood: 'rattled', line: '什么？！' });
      s.phase({ phase: 'opponentTurn', canUndo: true, hintLevel: 0, canAsk: false, failed: false, ply: 1 });
      s.rival({ mood: 'thinking' });
      const atOnce = T.rival();
      await done;
      return { atOnce, rows: await tracing };
    });
    const at = (pred) => (d.rows.find((r) => pred(r[1])) ?? [-1])[0];
    const rattledAt = at((v) => v.startsWith('rattled'));
    const stampAt = at((v) => v.includes('|stamp|'));
    const popupAt = at((v) => v.endsWith('lord') || v.includes('lord+'));
    const thinkingAt = (d.rows.find((r) => r[0] > rattledAt && r[1].startsWith('thinking')) ?? [-1])[0];
    t.ok(d.atOnce !== 'thinking', `the thinking face does not wipe the reaction in the same run (${d.atOnce})`);
    t.ok(rattledAt >= 0 && stampAt >= 0 && Math.abs(rattledAt - stampAt) <= 120, `rattled (${rattledAt}) fires with the stamp (${stampAt})`);
    t.ok(popupAt > stampAt && d.rows.some((r) => r[1].startsWith('rattled') && r[1].includes('lord')), `still rattled when 主公英明！ pops (${popupAt}): ${JSON.stringify(d.rows)}`);
    t.near(thinkingAt - rattledAt, 2400, 200, 'thinking follows when the line he said has gone (2.4 s)');
  });

  await S.test('rival: rattled with no commit in flight shows at once; thinking waits 1.6 s; his next move takes the face at once; nothing is left stuck after settle()', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      s.rival({ mood: 'rattled' });
      const a = T.rival();
      s.rival({ mood: 'thinking' });
      const b = T.rival();
      const thinkAfter = await T.until(() => T.rival() === 'thinking', 3000);
      // held, then he moves: `calm` (or `smug`) is not delayed
      s.rival({ mood: 'rattled' });
      s.rival({ mood: 'frown' });
      await T.sleep(200);
      s.rival({ mood: 'smug', line: '此计已成。' });
      const c = T.rival();
      await T.sleep(1800);
      const afterSmug = T.rival();
      // a commit that is cut by settle(): the reaction is released, later ones are not delayed for ever
      await T.fresh();
      const m = await T.trial();
      s.committed(T.commitInfo(m, { stamp: { text: '屏风马！', size: 'full' } }));
      s.rival({ mood: 'rattled' });
      const due = T.rival();
      s.settle();
      const settled = T.rival();
      await T.fresh();
      s.rival({ mood: 'rattled' });
      const again = T.rival();
      return { a, b, thinkAfter, c, afterSmug, due, settled, again };
    });
    t.eq([d.a, d.b], ['rattled', 'rattled'], 'shown at once and not wiped by thinking');
    t.near(d.thinkAfter, 1600, 150, 'thinking after 1.6 s');
    t.eq([d.c, d.afterSmug], ['smug', 'smug'], 'his own move takes the face at once, the waiting frown is dropped');
    t.eq([d.due, d.settled, d.again], ['calm', 'rattled', 'rattled'], 'waits for the pay-off; settle() releases it; a later reaction is immediate');
  });

  await S.test('rival: the thinking dots never outlive his turn (undo, new game, game over, a failed search); undo also clears a reaction', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
      const out = {};
      const think = async () => { await T.fresh(); s.phase({ phase: 'opponentTurn', canUndo: true, hintLevel: 0, canAsk: false, failed: false, ply: 1 }); s.rival({ mood: 'thinking' }); };
      await think(); const before = T.rival();
      s.settle(); await s.undone({ steps: [], view: T.view(b, null, null) }); out.undone = T.rival();
      await think(); s.settle(); await s.reset(T.view(b, null, null), { deal: false }); out.reset = T.rival();
      await think(); s.phase({ phase: 'opponentTurn', canUndo: true, hintLevel: 0, canAsk: false, failed: true, ply: 1 }); out.failed = T.rival();
      await think(); s.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 1 }); await s.over(T.overView('loss', 'resign', { quiet: true })); out.over = T.rival();
      await T.fresh(); s.rival({ mood: 'rattled' }); s.settle(); await s.undone({ steps: [], view: T.view(b, null, null) }); out.rattledUndone = T.rival();
      await T.fresh();
      return { before, ...out, dots: document.querySelector('.rival').dataset.say === 'dots' };
    });
    t.eq(d, { before: 'thinking', undone: 'calm', reset: 'calm', failed: 'calm', over: 'calm', rattledUndone: 'calm', dots: false }, 'calm again, no dots');
  });

  await S.test('reset: the red tension glow of the game before is gone', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      s.tension(0.95);
      const before = getComputedStyle(document.querySelector('.bv')).getPropertyValue('--tension').trim();
      s.settle();
      await s.reset(T.view(window.__dev.G.board, null, null), { deal: false });
      const after = getComputedStyle(document.querySelector('.bv')).getPropertyValue('--tension').trim();
      s.tension(0.4);
      return { before, after, told: getComputedStyle(document.querySelector('.bv')).getPropertyValue('--tension').trim() };
    });
    t.eq([d.before, Number(d.after), d.told], ['0.95', 0, '0.4'], 'tension');
  });

  await S.test('K-101: a line told in the same run just before retracted() / committed() is kept and follows the change; an older held line is dropped', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      const question = async () => {                       // a voiced held trial: the guiding question has just been said
        await T.fresh();
        const m = await T.trial();
        s.verdict({ cat: 'mistake', final: true, held: true, voiced: true, earned: false, focus: [] });
        s.coachBegin({ id: 'q', kind: 'try', cue: '且慢……' });
        s.coachSegment('q', { type: 'text', text: '这个兵，真的没人保护吗？' });
        s.coachEnd('q', { reason: 'done', source: 'local' });
        await T.sleep(400);                                // well inside its reading time (1.4 s)
        return m;
      };
      const out = {};
      await question();
      s.coachLocal(T.seg('小主公好眼力！换一步再想。'));    // 4.25.7: the line, then session.retract()
      const heldFirst = !T.text().includes('好眼力');
      await s.retracted({ reselect: true, targets: [], forbidden: [] });
      out.seen = await T.until(() => T.text().includes('好眼力'), 2500);
      out.heldFirst = heldFirst;
      out.staleInLog = [...document.querySelectorAll('.msg[data-kind="try"]')].map((e) => e.dataset.state).pop();

      const m = await question();
      s.coachLocal(T.seg('好，听主公的，就走这一步。'));      // 5.8 E-commit: STR.ownWay, then stage.committed
      await s.committed(T.commitInfo(m));
      out.ownWay = await T.until(() => T.text().includes('听主公的'), 3000);

      await question();
      s.coachLocal(T.seg('这句是早先排队的。'));
      await T.sleep(30);                                   // another run of calls
      await s.retracted({ reselect: false, targets: [], forbidden: [] });
      out.older = await T.until(() => T.text().includes('早先排队'), 2600);
      await T.fresh();
      return out;
    });
    t.ok(d.heldFirst, 'the line is held behind the question (K-101)');
    t.ok(d.seen >= 0 && d.seen < 400, `shown right after the retract, not dropped (${d.seen} ms)`);
    t.eq(d.staleInLog, 'stale', 'the question is 已换一步');
    t.ok(d.ownWay >= 0 && d.ownWay < 1500, `the line told with the commit is shown when the question has been read (${d.ownWay} ms)`);
    t.eq(d.older, -1, 'a line held since an earlier run is dropped');
  });

  await S.test('game-over card: chips told while the card is up stay hidden; they come out with 回看棋局, and with Esc', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      const chips = () => [...document.querySelectorAll('#chat .chip')].map((c) => c.textContent);
      const over = async () => {
        await T.fresh();
        s.chips([{ id: 'score', label: '现在谁占上风？', ask: 'score' }]);
        s.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
        s.chips([]);
        await s.over(T.overView('draw', 'repetition', { quiet: true }));
        s.chips([{ id: 'proud', label: '我哪步下得最好？', ask: 'proud' }, { id: 'next', label: '下一盘注意什么？', ask: 'next' }]);
      };
      const out = {};
      await over();
      out.underCard = chips();
      document.querySelector('dialog[data-dialog="over"] [data-choice="review"]').click();
      out.afterReview = chips();
      await over();
      const card = document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      out.afterEsc = (await T.until(() => chips().length === 2, 1500)) >= 0;
      // the game goes on (undo): the chips of the new turn are not swallowed
      await over();
      s.settle();
      await s.undone({ steps: [], view: T.view(window.__dev.G.board, null, null) });
      s.phase({ phase: 'childTurn', canUndo: false, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      s.chips([{ id: 'score', label: '现在谁占上风？', ask: 'score' }]);
      out.afterUndo = chips();
      await T.sleep(500);
      out.afterUndoLater = chips();
      await T.fresh();
      return out;
    });
    t.eq(d.underCard, [], 'no chip under the card');
    t.eq(d.afterReview, ['我哪步下得最好？', '下一盘注意什么？'], 'the chips come out when the card is closed');
    t.ok(d.afterEsc, 'also when the card was closed with Esc');
    t.eq([d.afterUndo, d.afterUndoLater], [['现在谁占上风？'], ['现在谁占上风？']], 'after an undo the turn chips show and stay');
  });

  await S.test('over cue: when the game goes on without a settle() (phase leaves `over`), nothing of the ending follows; the board is the game again', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, dev = window.__dev;
      await T.fresh();
      const proud = { before: dev.SCENES ? dev.G.board : dev.G.board, move: T.mv(dev.G.board, 7, 1, 7, 4), notation: '炮八平五', self: false };
      s.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      const done = s.over(T.overView('loss', 'resign', { proud }));
      await T.until(() => !!document.querySelector('.stage-ribbon'), 4000);      // the replay has begun
      await T.sleep(600);                                                        // ... and its move is on the board
      s.phase({ phase: 'childTurn', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      const now = { ribbon: !!document.querySelector('.stage-ribbon'), lost: document.querySelector('.bv').classList.contains('is-lost'),
        cannon: document.querySelector('.piece[data-type="cannon"][data-color="red"][data-row="7"][data-col="1"]') !== null,
        interactive: document.querySelector('.bv').classList.contains('is-interactive') };
      await T.sleep(4200);
      const later = { card: !!document.querySelector('dialog[data-dialog="over"]'), popup: !!document.querySelector('.fx-popup'),
        interactive: document.querySelector('.bv').classList.contains('is-interactive') };
      await Promise.race([done, T.sleep(500)]);
      await T.fresh();
      return { now, later };
    });
    t.eq(d.now, { ribbon: false, lost: false, cannon: true, interactive: true }, 'at once: no ribbon, no dimming, the position of the game, a board that can be touched');
    t.eq(d.later, { card: false, popup: false, interactive: true }, 'later: no card, no popup');
  });

  await S.test('mouth: a reply that is cut off without a call (trial switched by a tap, retract by a tap, a new reply) stops his mouth', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      const flapping = async () => { const seen = new Set(); for (let i = 0; i < 12; i++) { seen.add(document.querySelector('#buddy svg.buddy').dataset.mouth); await T.sleep(60); } return seen.size > 1; };
      const out = {};
      await T.fresh();
      await T.trial(9, 7, 7, 6);
      s.verdict({ cat: 'good', final: true, held: false, voiced: false, earned: false, focus: [] });
      s.coachBegin({ id: 'x1', kind: 'try', cue: null });
      s.coachSegment('x1', { type: 'text', text: '这一步把马跳出来，' });
      await T.sleep(500);
      out.streaming = await flapping();
      await T.trial(9, 7, 7, 8);                             // no settle(): the child tapped another target; the new trial gets a nod only
      s.verdict({ cat: 'ok', final: true, held: false, voiced: false, earned: false, focus: [] });
      await T.sleep(700);
      out.afterSwitch = await flapping();
      s.coachBegin({ id: 'x2', kind: 'try', cue: null });
      s.coachSegment('x2', { type: 'text', text: '边马不太好，' });
      await T.sleep(400);
      await s.retracted({ reselect: true, targets: [], forbidden: [] });
      await T.sleep(700);
      out.afterRetract = await flapping();
      // an ask that is replaced by another ask before it has finished
      await T.fresh();
      s.coachBegin({ id: 'a1', kind: 'ask', cue: null });
      s.coachSegment('a1', { type: 'text', text: '先看中路，' });
      await T.sleep(400);
      s.coachBegin({ id: 'a2', kind: 'ask', cue: null });    // the client aborted a1 without a call
      await T.sleep(600);
      out.whileWaiting = await flapping();
      s.coachSegment('a2', { type: 'text', text: '再看两翼。' });
      s.coachEnd('a2', { reason: 'done', source: 'llm' });
      await T.sleep(1500);
      out.afterEnd = await flapping();
      await T.fresh();
      return out;
    });
    t.eq(d, { streaming: true, afterSwitch: false, afterRetract: false, whileWaiting: false, afterEnd: false }, 'mouth');
  });

  await S.test('review arrow: a cannon that did not capture went straight; a horse goes round its leg', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
      const shape = async (m) => {
        await T.fresh();
        const done = s.committed({ ...T.commitInfo(m), fromTrial: false });
        s.settle();
        await done;
        document.querySelector('#app').dispatchEvent(new CustomEvent('hud:action', { bubbles: true, detail: { action: 'review' } }));
        const path = document.querySelector('.arrow[data-style="last"] .arrow__line');
        const out = path ? path.getAttribute('d') : null;
        s.settle();
        await s.reset(T.view(b, null, null), { deal: false });
        return out;
      };
      return { cannon: await shape(T.mv(b, 7, 7, 7, 4)), horse: await shape(T.mv(b, 9, 7, 7, 6)), capture: await shape(T.mv(b, 7, 1, 0, 1)) };
    });
    t.ok(d.cannon && !d.cannon.includes('Q'), `cannon, no capture: a straight line (${d.cannon})`);
    t.ok(d.horse && d.horse.includes('Q'), `horse: through the leg square (${d.horse})`);
    t.ok(d.capture && d.capture.includes('Q'), `cannon capture: the arc over the screen (${d.capture})`);
  });

  // ---- read-aloud and mute ------------------------------------------------------------------------------------------

  await page.addInitScript(FAKE_SPEECH);
  await boot();
  await S.test('mute silences read-aloud: no sentence is spoken while muted, and the voice returns with the sound', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, dev = window.__dev;
      const said = () => window.__said.filter((x) => x !== '<cancel>');
      const apply = (patch) => { Object.assign(window.__set ??= { ...dev.settings }, patch); s.applySettings({ ...window.__set }); };
      await T.fresh();
      apply({ readAloud: true });
      document.querySelector('#board').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));      // a gesture primes the voice
      s.coachLocal(T.seg('第一句话。'));
      await T.sleep(300);
      const on = said().length;
      apply({ sfx: false, music: false });                 // what the mute button does through the director
      await T.fresh();
      window.__said.length = 0;
      s.coachLocal(T.seg('静音的时候不该读出来。'));
      await T.sleep(300);
      const muted = said().length;
      apply({ sfx: true, music: true });
      await T.fresh();
      s.coachLocal(T.seg('声音回来了。'));
      await T.sleep(300);
      const back = said().length;
      apply({ readAloud: false });
      return { on, muted, back };
    });
    t.ok(d.on >= 1, `spoken while read-aloud is on (${d.on})`);
    t.eq(d.muted, 0, 'nothing spoken while muted');
    t.ok(d.back >= 1, 'spoken again after unmute');
  });

  // ---- the end of a game, with the fake director: the king that was mated lies toppled also after 本局最佳 -------------

  await boot('', { director: true });
  await S.test('win by mate: after the 本局最佳 replay the mated king lies toppled and grey again; no second `win`, no second 绝杀', async (t) => {
    await page.evaluate(() => window.__dev.moment.mate());
    await page.waitForTimeout(1500);
    await clearAudio(page);
    const d = await page.evaluate(async () => {
      const T = window.__t, dev = window.__dev;
      const king = () => document.querySelector('.piece[data-type="king"][data-color="black"]');
      const banners = [];
      const obs = new MutationObserver(() => { const b = document.querySelector('.fx-banner'); if (b && banners[banners.length - 1] !== b.dataset.kind) banners.push(b.dataset.kind); });
      obs.observe(document.querySelector('#board'), { childList: true, subtree: true });
      dev.act.confirm();
      await T.until(() => king().classList.contains('is-fallen'), 3000);
      const atMate = [king().classList.contains('is-fallen')];
      await T.until(() => !!document.querySelector('.stage-ribbon'), 9000);
      await T.sleep(300);
      const inReplay = { ribbon: true, kingUp: !king().classList.contains('is-fallen'), pieces: document.querySelectorAll('.piece[data-id]').length };
      await dev.cardUp();
      await T.sleep(400);
      obs.disconnect();
      const end = { fallen: king().classList.contains('is-fallen'), grey: king().classList.contains('is-grey'), at: `${king().dataset.row}${king().dataset.col}`,
        cannon: !!document.querySelector('.piece[data-type="cannon"][data-color="red"][data-row="7"][data-col="4"]'), pieces: document.querySelectorAll('.piece[data-id]').length,
        last: document.querySelectorAll('.board-cell.is-last-to[data-row="7"][data-col="4"]').length, check: document.querySelectorAll('.board-cell.is-check').length,
        busy: document.documentElement.dataset.uiBusy ?? '', ribbon: !!document.querySelector('.stage-ribbon'), rays: !!document.querySelector('.stage-rays') };
      return { atMate, inReplay, end, banners };
    });
    const played = await sounds(page);
    t.eq(d.atMate, [true], 'the king topples at the mate');
    t.ok(d.inReplay.kingUp, 'the replay shows an older position');
    t.eq(d.end, { fallen: true, grey: true, at: '04', cannon: true, pieces: d.end.pieces, last: 1, check: 0, busy: '', ribbon: false, rays: true }, 'the final position, with the king as the mate left it');
    t.eq(played.filter((n) => n === 'win').length, 1, `one win stinger (${played.join(' ')})`);
    t.eq(d.banners.filter((k) => k === 'mate').length, 1, `one 绝杀 banner (${d.banners.join(' ')})`);
  });

  await S.test('settle() in the middle of the 本局最佳 replay: the final position with the toppled king at once, the card comes up, over() resolves', async (t) => {
    await page.evaluate(() => window.__dev.moment.mate());
    await page.waitForTimeout(1500);
    const d = await page.evaluate(async () => {
      const T = window.__t, dev = window.__dev;
      const king = () => document.querySelector('.piece[data-type="king"][data-color="black"]');
      dev.act.confirm();
      await T.until(() => !!document.querySelector('.stage-ribbon'), 9000);
      await T.sleep(700);                                  // the replayed move is on its way
      const mid = { horseBack: !!document.querySelector('.piece[data-type="horse"][data-color="red"]'), card: !!document.querySelector('dialog[data-dialog="over"]') };
      dev.real.settle();
      const now = { ribbon: !!document.querySelector('.stage-ribbon'), fallen: king().classList.contains('is-fallen'), grey: king().classList.contains('is-grey'),
        cannon: !!document.querySelector('.piece[data-type="cannon"][data-color="red"][data-row="7"][data-col="4"]'), popup: !!document.querySelector('.fx-popup'),
        interactive: document.querySelector('.bv').classList.contains('is-interactive') };
      await T.sleep(60);
      const card = !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]');
      const idle = await Promise.race([window.__ui ? window.__ui.idle().then(() => true) : Promise.resolve(true), T.sleep(1500).then(() => false)]);
      return { mid, now, card, idle };
    });
    t.eq(d.mid.card, false, 'no card during the replay');
    t.eq(d.now, { ribbon: false, fallen: true, grey: true, cannon: true, popup: false, interactive: true }, 'the final position at once');
    t.ok(d.card, 'the card comes up');
    t.ok(d.idle, 'nothing is left in flight');
  });

  await S.test('loss by mate: after the replay the child\'s king lies toppled, the board is dimmed, only `lose` was sounded; a restored finished game shows it too, silently', async (t) => {
    await page.evaluate(() => window.__dev.moment.loss());
    await page.waitForTimeout(1500);
    await clearAudio(page);
    const d = await page.evaluate(async () => {
      const T = window.__t, dev = window.__dev;
      const king = () => document.querySelector('.piece[data-type="king"][data-color="red"]');
      dev.act.confirm();
      await dev.cardUp();
      await T.sleep(400);
      const end = { fallen: king().classList.contains('is-fallen'), grey: king().classList.contains('is-grey'), lost: document.querySelector('.bv').classList.contains('is-lost'),
        banner: !!document.querySelector('.fx-banner[data-kind="mate"]') };
      // the same finished game, restored: reset, then over with quiet
      const view = dev.viewOf();
      dev.stop();
      dev.real.settle();
      if (window.__audio) window.__audio.length = 0;
      await dev.real.reset(view, { deal: false });
      const upright = !king().classList.contains('is-fallen');
      dev.real.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 2 });
      await dev.real.over({ result: 'loss', reason: 'checkmate', byChildMate: false, stats: { rounds: 27, captures: 0, brilliant: 0 }, proud: null, rank: null, goal: null, kept: null, quiet: true });
      const quiet = { fallen: king().classList.contains('is-fallen'), grey: king().classList.contains('is-grey'), card: !!document.querySelector('dialog[data-dialog="over"]'),
        sounds: (window.__audio ?? []).filter((c) => c[0] === 'play').map((c) => c[1]) };
      return { end, upright, quiet };
    });
    const played = await sounds(page);
    t.eq(d.end, { fallen: true, grey: true, lost: true, banner: false }, 'toppled, dimmed, never a 绝杀 banner');
    t.ok(!played.includes('win'), `no win stinger on a loss (${played.join(' ')})`);
    t.ok(d.upright, 'reset() seats the pieces upright');
    t.eq(d.quiet, { fallen: true, grey: true, card: true, sounds: [] }, 'quiet: the card on the final position, the king toppled, no sound');
  });

  S.report();
};
