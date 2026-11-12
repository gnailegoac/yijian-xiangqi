// stage.js: the verdict table (11.5), the trial guard, the stage's sounds (10.5.4), board moments
import { load, suite, calls, clearCalls, tapCell, cellPoint, spyAudio, audioLog, clearAudio, sounds, mood } from './lib.mjs';

/** Helpers that live in the page: sample moves and views on the start position. */
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
    bubble: () => { const b = document.querySelector('#buddy .bubble'); return { state: b.dataset.state ?? null, text: b.querySelector('.bubble__text')?.textContent ?? '', all: b.textContent }; },
    /** A trial of the quiet horse move (9,7)->(7,6) on the start position, hovering. */
    async trial(capture = false) {
      const b = d.G.board;
      const m = capture ? t.mv(b, 7, 1, 0, 1) : t.mv(b, 9, 7, 7, 6);
      await d.real.tentative(m, { notation: capture ? '炮八进七' : '马二进三', aim: capture });
      d.real.phase({ phase: 'tentative', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      return m;
    },
    commitInfo(m, extra = {}) {
      const b = t.after(d.G.board, m);
      return { move: m, notation: 'x', flags: flags0, fromTrial: true, cat: 'good', praise: null, stamp: null, self: false, softCheck: false,
               view: t.view(b, m, 'child', { trophies: { mine: m.captured ? [m.captured] : [], lost: [] } }), ...extra };
    },
    /** Back to the start position, nothing in flight. */
    async fresh() {
      d.real.settle();
      await d.real.reset(t.view(d.G.board, null, null), { deal: false });
      d.real.phase({ phase: 'childTurn', canUndo: false, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
      if (window.__audio) window.__audio.length = 0;
      window.__calls.length = 0;
    },
  };
  window.__t = t;
};

export default async ({ page }) => {
  const S = suite();
  const w = (ms) => page.waitForTimeout(ms);
  await spyAudio(page);
  const boot = async (query = '') => { await load(page, query); await page.evaluate(HELPERS); await page.evaluate(() => window.__t.fresh()); };
  await boot();
  const stageSounds = async () => (await sounds(page)).filter((n) => /^(turn\.yours|fan\.sweep|hint\.|stamp|praise\.|warn|lose|draw|win|chat\.send|chat\.receive)/.test(n));

  await S.test('11.5: every row of the verdict table gives its mood; a provisional verdict changes only the mood', async (t) => {
    const rows = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      const out = {};
      const one = async (name, v) => {
        await T.fresh();
        await T.trial();
        window.__audio.length = 0;
        s.verdict(v);
        out[name] = { mood: T.mood(), suspense: window.__audio.filter((c) => c[0] === 'setSuspense').map((c) => c[1]), warn: window.__audio.filter((c) => c[0] === 'play' && c[1] === 'warn').length };
      };
      await one('pending', { cat: 'pending', final: false, held: false, voiced: false, earned: false, focus: [] });
      await one('provisional blunder', { cat: 'blunder', final: false, held: false, voiced: false, earned: false, focus: [] });
      await one('brilliant', T.V('brilliant', { earned: true }));
      await one('best earned', T.V('best', { earned: true }));
      await one('best', T.V('best'));
      await one('good', T.V('good'));
      await one('ok', T.V('ok'));
      await one('mistake', T.V('mistake'));
      await one('mistake held voiced', T.V('mistake', { held: true, voiced: true, focus: [{ row: 2, col: 6 }] }));
      await one('mistake held', T.V('mistake', { held: true }));
      await one('blunder held voiced', T.V('blunder', { held: true, voiced: true }));
      const alarmedAt = performance.now();
      await T.sleep(1350);
      out['blunder held voiced, 1.35 s later'] = { mood: T.mood() };
      void alarmedAt;
      await one('blunder held', T.V('blunder', { held: true }));
      await one('blunder', T.V('blunder'));
      return out;
    });
    const want = {
      'pending': ['thinking', [], 0], 'provisional blunder': ['worried', [], 0],
      'brilliant': ['impressed', [false], 0], 'best earned': ['impressed', [false], 0], 'best': ['pleased', [false], 0], 'good': ['pleased', [false], 0], 'ok': ['idle', [false], 0],
      'mistake': ['curious', [false], 0], 'mistake held voiced': ['worried', [true], 1], 'mistake held': ['worried', [true], 0],
      'blunder held voiced': ['alarmed', [true], 1], 'blunder held': ['worried', [true], 0], 'blunder': ['worried', [false], 0],
    };
    for (const [name, [m, suspense, warn]] of Object.entries(want)) t.eq([rows[name].mood, rows[name].suspense, rows[name].warn], [m, suspense, warn], name);
    t.eq(rows['blunder held voiced, 1.35 s later'].mood, 'worried', 'alarmed for 1200 ms, then worried');
  });

  await S.test('11.5: good / ok / un-earned best nod (seen under reduced motion as a brief smile); a mistake does not', async (t) => {
    await boot('motion=reduced');
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, eyes = () => document.querySelector('#buddy svg.buddy').dataset.eyes;
      const out = {};
      await T.fresh(); await T.trial(); s.verdict(T.V('ok')); out.ok = eyes(); await T.sleep(650); out.okLater = eyes();
      await T.fresh(); await T.trial(); s.verdict(T.V('mistake')); out.mistake = eyes();
      await T.fresh(); await T.trial(); s.verdict({ ...T.V('ok'), final: false }); out.provisional = eyes();
      return out;
    });
    t.eq(d, { ok: 'happy', okLater: 'open', mistake: 'open', provisional: 'open' }, 'eyes');
    await boot();
  });

  await S.test('trial guard: 200 ms for every verdict, 700 ms and one wobble for a blunder (real taps on the destination)', async (t) => {
    // Every touch is judged by the time it really arrived (measured in the page), so a slow machine cannot blur the result.
    const run = async (cat, gaps) => {
      await page.evaluate(() => window.__t.fresh());
      const point = await cellPoint(page, 7, 6);
      await page.evaluate(async (cat) => {
        const T = window.__t;
        window.__taps = [];
        if (!window.__upSpy) { window.__upSpy = true; document.querySelector('#board').addEventListener('pointerup', () => window.__taps.push(['up', Math.round(performance.now() - window.__landed)]), true); }
        await T.trial();
        window.__landed = performance.now();
        const body = document.querySelector('.piece.is-trial .piece__body');
        const n0 = body.getAnimations().length;
        window.__dev.real.verdict(T.V(cat));
        window.__wobble = body.getAnimations().length - n0;
        window.__dev.real.on({ tap: () => window.__taps.push(['pick', Math.round(performance.now() - window.__landed)]) });
      }, cat);
      for (const gap of gaps) { await w(gap); await page.touchscreen.tap(point.x, point.y); }
      await w(60);
      const log = await page.evaluate(() => window.__taps);
      const ups = [];
      for (let i = 0; i < log.length; i++) if (log[i][0] === 'up') ups.push({ dt: log[i][1], picked: !!log[i + 1] && log[i + 1][0] === 'pick' });
      await page.evaluate(() => { window.__dev.real.on(Object.fromEntries(['tap', 'confirm', 'retract', 'undo', 'hint', 'ask', 'chip', 'moveLink', 'playLine', 'newGame', 'resign', 'retryOpponent', 'retryEngine', 'setting', 'exportRecord', 'exportBackup', 'importBackup', 'stopCoach', 'activity'].map((n) => [n, (...a) => { window.__calls.push([n, ...a]); }]))); });
      return { ups, wobble: await page.evaluate(() => window.__wobble) };
    };
    const blunder = await run('blunder', [60, 150, 150, 500, 200]);
    const early = blunder.ups.filter((u) => u.dt < 690), late = blunder.ups.filter((u) => u.dt > 710);
    t.ok(early.length >= 1 && late.length >= 1, 'blunder: touches before and after 700 ms were made (' + JSON.stringify(blunder.ups) + ')');
    t.ok(early.every((u) => !u.picked), 'blunder: every touch before 700 ms is swallowed (' + JSON.stringify(early) + ')');
    t.ok(late.every((u) => u.picked), 'blunder: every touch after 700 ms is delivered (' + JSON.stringify(late) + ')');
    t.ok(blunder.wobble >= 1, 'blunder: the piece wobbles');
    const good = await run('good', [320, 200]);
    const after = good.ups.filter((u) => u.dt > 210);
    t.ok(after.length >= 1 && after.every((u) => u.picked), 'good: a touch after 200 ms is delivered (' + JSON.stringify(good.ups) + ')');
    t.ok(good.ups.filter((u) => u.dt < 190).every((u) => !u.picked), 'good: a touch before 200 ms is swallowed');
    t.eq(good.wobble, 0, 'good: no wobble');
  });

  await S.test('retracted: the mood rests, suspense ends, the trial comment is marked 已换一步, the piece is back', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, dev = window.__dev;
      await T.fresh();
      const m = await T.trial();
      s.verdict(T.V('mistake', { held: true, voiced: true }));
      s.coachBegin({ id: 'q1', kind: 'try', cue: '且慢……' });
      s.coachSegment('q1', { type: 'text', text: '这个子，真的没人管吗？' });
      s.coachEnd('q1', { reason: 'done', source: 'local' });
      await T.sleep(700);
      window.__audio.length = 0;
      const before = { mood: T.mood(), at: T.at(m.piece.id) };
      await s.retracted({ reselect: true, targets: [m], forbidden: [] });
      return { before, mood: T.mood(), at: T.at(m.piece.id), bubble: T.bubble(), stale: document.querySelector('#buddy .bubble__stale')?.textContent,
               suspense: window.__audio.filter((c) => c[0] === 'setSuspense').map((c) => c[1]), selected: !!document.querySelector('.piece.is-selected'),
               logState: document.querySelector('.msg[data-id="q1"]').dataset.state };
    });
    t.eq(d.before, { mood: 'worried', at: '76' }, 'before: worried; the horse hovers on its trial square');
    t.eq([d.mood, d.at, d.selected], ['idle', '97', true], 'after: idle, back, selected again');
    t.eq([d.bubble.state, d.stale, d.logState], ['stale', '已换一步', 'stale'], 'the line is stale in the bubble and in the log');
    t.eq(d.suspense, [false], 'setSuspense(false)');
  });

  await S.test('a switched trial marks the old comment 已换一步; a new trial after a retract leaves an old line alone', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      await T.trial();
      s.coachBegin({ id: 'c1', kind: 'try', cue: null });
      s.coachSegment('c1', { type: 'text', text: '这步走得稳，' });                     // still streaming
      await T.sleep(450);
      const b = window.__dev.G.board;
      await s.tentative(T.mv(b, 9, 7, 7, 8), { notation: '马二进一', aim: false });      // the same piece, another square
      const afterSwitch = { state: document.querySelector('.msg[data-id="c1"]').dataset.state, tag: document.querySelector('.msg[data-id="c1"] .msg__tag')?.textContent };
      s.coachSegment('c1', { type: 'text', text: '不该再出现的字' });
      await T.sleep(300);
      return { afterSwitch, text: document.querySelector('.msg[data-id="c1"] .msg__text').textContent };
    });
    t.eq(d.afterSwitch, { state: 'stale', tag: '已换一步' }, 'stale after the switch');
    t.ok(!d.text.includes('不该再出现的字'), 'a late segment of the interrupted reply is not shown');
  });

  await S.test('10.5.4: pouches -> fan.sweep + hint.N; childSaid -> chat.send; one chat.receive per line; tension reaches board and music', async (t) => {
    await page.evaluate(() => window.__t.fresh());
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, plays = () => window.__audio.filter((c) => c[0] === 'play').map((c) => c[1]);
      const out = {};
      window.__audio.length = 0; s.hint(1, {}); out.h1 = plays(); out.h1mood = T.mood();
      window.__audio.length = 0; s.hint(2, { pieces: [{ row: 9, col: 7 }], squares: [{ row: 7, col: 6 }] }); out.h2 = plays(); out.spot = !!document.querySelector('.bv-spot');
      window.__audio.length = 0; s.hint(3, { move: { from: { row: 9, col: 7 }, to: { row: 7, col: 6 } } }); out.h3 = plays();
      out.arrow = document.querySelector('.arrow')?.dataset.style; await T.sleep(320); out.spotAfter3 = !!document.querySelector('.bv-spot');
      window.__audio.length = 0; s.childSaid('对方会怎么应？'); out.said = plays();
      window.__audio.length = 0;
      s.coachBegin({ id: 'r1', kind: 'ask', cue: null });
      out.beforeText = plays();
      for (const text of ['多半', '是出', '车。']) s.coachSegment('r1', { type: 'text', text });
      s.coachEnd('r1', { reason: 'done', source: 'llm' });
      out.reply = plays();
      await T.sleep(2300);
      window.__audio.length = 0; s.coachLocal([{ type: 'text', text: '小主公，慢慢想。' }]); out.local = plays();
      window.__audio.length = 0; s.tension(0.7); out.tension = window.__audio.filter((c) => c[0] === 'setTension').map((c) => c[1]);
      out.vignette = document.querySelector('#board').style.getPropertyValue('--tension');
      return out;
    });
    t.eq(d.h1, ['fan.sweep', 'hint.1'], 'pouch 1');
    t.eq(d.h1mood, 'curious', 'pouch 1: curious');
    t.eq(d.h2, ['fan.sweep', 'hint.2'], 'pouch 2');
    t.ok(d.spot, 'pouch 2: the spotlight');
    t.eq(d.h3.filter((n) => n !== 'arrow'), ['fan.sweep', 'hint.3'], 'pouch 3');
    t.eq([d.arrow, d.spotAfter3], ['hint', false], 'pouch 3: a hint arrow, and the spotlight gives way to it');
    t.eq(d.said, ['chat.send'], 'childSaid');
    t.eq([d.beforeText, d.reply], [[], ['chat.receive']], 'chat.receive on the first segment, once');
    t.eq(d.local, ['chat.receive'], 'a local line');
    t.eq([d.tension, d.vignette], [[0.7], '0.7'], 'tension');
  });

  await S.test('committed: stamp first (small at gain .5), then the popup with its sound; the mark; moods held; trophies; round', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      const out = {};
      const run = async (name, extra, capture = false) => {
        await T.fresh();
        const m = await T.trial(capture);
        window.__audio.length = 0;
        const seen = [];
        const watch = setInterval(() => {
          const stamp = document.querySelector('.fx-stamp'), popup = document.querySelector('.fx-popup:not([data-tone="mark"])');
          const key = `${stamp ? 'stamp' : ''}${popup ? 'popup:' + popup.dataset.tone + ':' + popup.querySelector('.fx-popup__text').textContent : ''}${document.querySelector('.fx-popup__mark, .fx-popup[data-tone="mark"]') ? '+mark' : ''}`;
          if (key && seen[seen.length - 1] !== key) seen.push(key);
        }, 25);
        const info = T.commitInfo(m, extra);
        info.view.round = 7;
        const t0 = performance.now();
        await s.committed(info);
        const ms = Math.round(performance.now() - t0);
        await T.sleep(120);
        clearInterval(watch);
        out[name] = { seen, ms, mood: T.mood(), plays: window.__audio.filter((c) => c[0] === 'play' && /^(stamp|praise)/.test(c[1])).map((c) => (c[2] && c[2].gain ? [c[1], c[2].gain] : c[1])),
                      at: T.at(m.piece.id), round: document.querySelector('.hud-round b').textContent, tray: document.querySelectorAll('.hud-tray--mine .hud-disc').length };
      };
      await run('plain', {});
      await run('capture', {}, true);
      await run('good', { praise: { tier: 'good', streak: 1 } });
      await run('great', { praise: { tier: 'great', streak: 2 }, self: true });
      await run('streak', { praise: { tier: 'great', streak: 4 } });
      await run('brilliant', { praise: { tier: 'brilliant', streak: 1 } });
      await run('lord+stamp', { praise: { tier: 'lord', streak: 5 }, stamp: { text: '屏风马！', size: 'full' }, self: true });
      await run('small stamp', { stamp: { text: '当头炮！', size: 'small' } });
      await run('self alone', { self: true });
      await run('slip', { cat: 'blunder' });
      await T.sleep(1350);
      out.slipLater = T.mood();
      return out;
    });
    t.eq([d.plain.seen, d.plain.plays, d.plain.mood, d.plain.at, d.plain.round, d.plain.tray], [[], [], 'idle', '76', '7', 0], 'plain: no popup, no sound, idle, piece seated, round');
    t.eq([d.capture.at, d.capture.tray], ['01', 1], 'capture: the piece is on the victim square, the trophy tray has one disc');
    t.eq([d.good.seen, d.good.plays, d.good.mood], [['popup:good:好棋！'], ['praise.good'], 'pleased'], 'good');
    t.eq([d.great.seen, d.great.plays, d.great.mood], [['popup:great:妙计！+mark'], ['praise.great'], 'impressed'], 'great with 自己想的');
    t.eq(d.streak.seen, ['popup:great:4连妙手！'], 'the streak text replaces 妙计！');
    t.eq([d.brilliant.seen, d.brilliant.plays, d.brilliant.mood], [['popup:brilliant:神来之笔！'], ['praise.brilliant'], 'impressed'], 'brilliant');
    t.eq([d['lord+stamp'].seen, d['lord+stamp'].plays, d['lord+stamp'].mood], [['stamp', 'popup:lord:主公英明！+mark'], ['stamp', 'praise.brilliant'], 'cheering'], 'lord: the stamp, then 主公英明！, cheering');
    t.ok(d['lord+stamp'].ms > 1900, `the cue lasts through stamp and popup (${d['lord+stamp'].ms} ms)`);
    t.eq([d['small stamp'].seen, d['small stamp'].plays], [['stamp'], [['stamp', 0.5]]], 'small stamp at gain .5');
    t.eq(d['self alone'].seen, ['+mark'], '自己想的 alone');
    t.eq([d.slip.seen, d.slip.plays, d.slip.mood, d.slipLater], [[], [], 'worried', 'idle'], 'a committed blunder: worried for 1200 ms, nothing else');
  });

  await S.test('committed: a check holds `pleased`; a mate cheers at once; fromTrial:false plays the move from its origin', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real;
      await T.fresh();
      const b = window.__dev.G.board;
      const m = T.mv(b, 9, 7, 7, 6);
      const info = T.commitInfo(m, { fromTrial: false, softCheck: true, flags: { check: true, mate: false, checkedKing: { row: 0, col: 4 }, checkers: [{ row: 7, col: 6 }], crossed: false } });
      await s.committed(info);
      const check = { mood: T.mood(), at: T.at(m.piece.id), ring: !!document.querySelector('.bv-checkring') };
      await T.fresh();
      const m2 = await T.trial();
      const done = s.committed(T.commitInfo(m2, { flags: { check: true, mate: true, checkedKing: { row: 0, col: 4 }, checkers: [{ row: 7, col: 6 }], crossed: false } }));
      const mate = T.mood();
      s.settle();
      await done;
      return { check, mate };
    });
    t.eq(d.check, { mood: 'pleased', at: '76', ring: true }, 'check (soft): pleased, moved without a trial, check ring');
    t.eq(d.mate, 'cheering', 'mate: cheering in the same frame');
  });

  await S.test('rivalMoved: divider in the log, caption, moods (check -> worried, big loss -> alarmed then worried), trophies', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, dev = window.__dev;
      await T.fresh();
      const b0 = dev.G.board;
      const mine = T.mv(b0, 7, 1, 0, 1);                          // 炮八进七 takes the horse
      await s.tentative(mine, { notation: '炮八进七', aim: true });
      await s.committed(T.commitInfo(mine));
      const b1 = T.after(b0, mine);
      s.phase({ phase: 'opponentTurn', canUndo: true, hintLevel: 0, canAsk: false, failed: false, ply: 13 });
      const status = T.bubble();
      const reply = T.mv(b1, 0, 0, 0, 1);                         // 车1平2 takes the cannon back
      const b2 = T.after(b1, reply);
      const p = s.rivalMoved({ move: reply, notation: '车1平2', flags: T.flags0, caption: dev.parse('【车1平2】吃子', { board: b1 }), lostBig: true, softCheck: false,
                               view: T.view(b2, reply, 'opponent', { round: 8, trophies: { mine: [mine.captured], lost: [reply.captured] } }) });
      const during = T.mood();
      await p;
      s.phase({ phase: 'childTurn', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 14 });
      const out = { status, during, event: [...document.querySelectorAll('.chat__event')].pop()?.textContent, caption: document.querySelector('.bubble__caption').textContent,
                    at: T.at(reply.piece.id), lost: document.querySelectorAll('.hud-tray--lost .hud-disc').length, round: document.querySelector('.hud-round b').textContent };
      await T.sleep(1300);
      out.later = T.mood();
      // a check without a capture
      const chk = T.mv(b2, 0, 7, 2, 6);
      const b3 = T.after(b2, chk);
      await s.rivalMoved({ move: chk, notation: '马8进7', flags: { check: true, mate: false, checkedKing: { row: 9, col: 4 }, checkers: [{ row: 2, col: 6 }], crossed: false }, caption: [], lostBig: false, softCheck: true,
                           view: T.view(b3, chk, 'opponent', { check: 'red', checkers: [{ row: 2, col: 6 }] }) });
      out.check = T.mood();
      // and a quiet move
      const quiet = T.mv(b3, 3, 0, 4, 0);
      await s.rivalMoved({ move: quiet, notation: '卒1进1', flags: T.flags0, caption: [], lostBig: false, softCheck: false, view: T.view(T.after(b3, quiet), quiet, 'opponent') });
      out.quiet = T.mood();
      return out;
    });
    t.eq(d.status.text, '对方正在想…', 'the status line while the rival thinks (the bubble was stale or empty)');
    t.eq([d.during, d.later], ['alarmed', 'worried'], 'a big piece fell: alarmed, then worried');
    t.eq(d.event, '第 7 回合 · 对方 车1平2', 'the divider names the round of the move (13 plies before it)');
    t.eq([d.caption, d.at, d.lost, d.round], ['车1平2吃子', '01', 1, '8'], 'caption, piece, lost trophies, round');
    t.eq([d.check, d.quiet], ['worried', 'idle'], 'check -> worried; a quiet move -> idle');
  });

  await S.test('turn.yours sounds 3 s after the rival landed if the board was not touched, and not otherwise', async (t) => {
    const run = async (touch) => {
      await page.evaluate(async () => {
        const T = window.__t, s = window.__dev.real, b = window.__dev.G.board;
        await T.fresh();
        const m = T.mv(b, 0, 7, 2, 6);
        s.phase({ phase: 'opponentTurn', canUndo: false, hintLevel: 0, canAsk: false, failed: false, ply: 1 });
        const p = s.rivalMoved({ move: m, notation: '马8进7', flags: T.flags0, caption: [], lostBig: false, softCheck: false, view: T.view(T.after(b, m), m, 'opponent') });
        s.phase({ phase: 'childTurn', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 2 });
        await p;
        window.__audio.length = 0;
      });
      if (touch) { await w(800); await tapCell(page, 5, 4); }
      await w(touch ? 2700 : 2500);
      const early = (await sounds(page)).includes('turn.yours');
      await w(900);
      return { early, late: (await sounds(page)).includes('turn.yours') };
    };
    t.eq(await run(false), { early: false, late: true }, 'untouched: after 3 s, not before');
    t.eq(await run(true), { early: false, late: false }, 'touched: never');
  });

  await S.test('rejected nudges the piece (the soft `illegal`), not for reason `over`; selected marks the piece; streak 3 shakes his head', async (t) => {
    await boot('motion=reduced');
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, plays = () => window.__audio.filter((c) => c[0] === 'play').map((c) => c[1]);
      const out = {};
      window.__audio.length = 0; s.rejected({ row: 9, col: 4 }, 'not-a-target', 1); out.one = plays();
      window.__audio.length = 0; s.rejected({ row: 9, col: 4 }, 'over', 1); out.over = plays();
      s.rejected({ row: 9, col: 4 }, 'no-moves', 3); out.shake = document.querySelector('#buddy svg.buddy').dataset.mouth;
      s.selected({ row: 9, col: 7 }, [T.mv(T.board(), 9, 7, 7, 6)], []);
      out.sel = [!!document.querySelector('.piece.is-selected[data-row="9"][data-col="7"]'), document.querySelectorAll('.board-cell.is-legal').length];
      s.selected(null, [], []);
      out.none = !!document.querySelector('.piece.is-selected');
      return out;
    });
    t.eq(d, { one: ['illegal'], over: [], shake: 'wavy', sel: [true, 1], none: false }, 'state');
    await boot();
  });

  await S.test('see-first helpers: arrows by group, clearArrows, highlight, preview (ghosts, resolves, real pieces untouched)', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, b = T.board();
      await T.fresh();
      const out = {};
      s.arrows([{ from: { row: 9, col: 7 }, to: { row: 7, col: 6 }, style: 'idea' }], { group: 'ask' });
      s.arrows([{ from: { row: 0, col: 7 }, to: { row: 2, col: 6 }, style: 'threat', badge: '2' }], { group: 'chat' });
      out.two = [...document.querySelectorAll('.arrow')].map((a) => a.dataset.style).sort();
      s.clearArrows('chat');
      await T.sleep(260);
      out.one = [...document.querySelectorAll('.arrow')].map((a) => a.dataset.style);
      s.clearArrows();
      await T.sleep(260);
      out.none = document.querySelectorAll('.arrow').length;
      s.highlight({ pieces: [{ row: 2, col: 1 }] });
      out.ring = document.querySelectorAll('.bv-hlring').length;
      s.highlight(null);
      await T.sleep(300);
      out.ringGone = document.querySelectorAll('.bv-hlring').length;
      const m1 = T.mv(b, 9, 7, 7, 6), m2 = T.mv(T.after(b, m1), 0, 7, 2, 6);
      const t0 = performance.now();
      const p = s.preview([m1, m2], { from: 'now' });
      await T.sleep(900);
      out.ghosts = document.querySelectorAll('.piece.is-ghost.is-preview').length;
      out.real = [T.at(m1.piece.id), T.at(m2.piece.id)];
      await p;
      out.ms = Math.round(performance.now() - t0);
      out.after = document.querySelectorAll('.piece.is-ghost').length;
      return out;
    });
    t.eq([d.two, d.one, d.none], [['idea', 'threat'], ['idea'], 0], 'arrows and groups');
    t.eq([d.ring, d.ringGone], [1, 0], 'highlight');
    t.ok(d.ghosts >= 1, 'ghost pieces play the line');
    t.eq(d.real, ['97', '07'], 'the real pieces never move');
    t.ok(d.ms >= 2400 && d.after === 0, `preview resolves when the ghosts have left (${d.ms} ms)`);
  });

  await S.test('tool rounds: the indicator, `thinking` while he tries the move, ghosts for a link', async (t) => {
    const d = await page.evaluate(async () => {
      const T = window.__t, s = window.__dev.real, dev = window.__dev;
      await T.fresh();
      const link = dev.parse('【马二进三】')[0].link;
      s.coachBegin({ id: 'tl', kind: 'ask', cue: null });
      const waiting = T.mood();
      s.coachTool('tl', { phase: 'start', notation: '马二进三', link });
      const tool = { mood: T.mood(), text: document.querySelector('#buddy .chat-tool')?.textContent };
      await T.sleep(500);
      const ghosts = document.querySelectorAll('.piece.is-ghost.is-preview').length;
      s.coachTool('tl', { phase: 'end' });
      s.coachSegment('tl', { type: 'text', text: '可以走。' });
      const speaking = T.mood();
      s.coachEnd('tl', { reason: 'done', source: 'llm' });
      return { waiting, tool, ghosts, speaking, toolGone: !document.querySelector('#buddy .chat-tool') };
    });
    t.eq(d.waiting, 'thinking', 'thinking while the first text is awaited');
    t.eq(d.tool, { mood: 'thinking', text: '亮在沙盘上摆一摆【马二进三】……' }, 'tool start');
    t.ok(d.ghosts >= 1, 'the tried move is played by a ghost');
    t.eq([d.speaking, d.toolGone], ['idle', true], 'back to the base mood with the first text; the indicator is gone');
  });

  S.report();
};
