// Rival (SPEC 4.22, 11.7, 14.4): 司马懿's canned lines and his mood rule.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RIVAL_NAME, RIVAL_TITLE, CHILD_TITLE, RIVAL_LINES, rivalReact } from '../../../src/game/rival.js';
import { mulberry32 } from '../../helpers/playout.js';

const POOLS = ['start', 'check', 'smug', 'quiet', 'rattled', 'frown', 'checked', 'win', 'lose', 'draw'];
const ALL_LINES = Object.values(RIVAL_LINES).flat();
const MOODS = ['calm', 'thinking', 'frown', 'rattled', 'smug'];

/** Characters as a child counts them (code points). */
const len = text => [...text].length;

/** A state in which a line is allowed (the last one was long ago) and one in which it is not. */
const FREE = { rivalMoveNo: 12, lineAt: -99 };
const JUST_SPOKE = { rivalMoveNo: 12, lineAt: 11 };

/** Generators that always return the same value. */
const at = x => () => x;

/** The name of the pool a line belongs to, or undefined when it is not one of his lines. */
const poolOf = line => POOLS.find(pool => RIVAL_LINES[pool].includes(line));

/** Every combination of the three flags of a `moved` event. */
const MOVED = [false, true].flatMap(tacticLanded => [false, true].flatMap(gaveCheck => [false, true].map(
  punishesChild => ({ kind: 'moved', tacticLanded, gaveCheck, punishesChild }))));

test('at least 30 lines, each at most 10 characters', () => {
  assert.deepEqual(Object.keys(RIVAL_LINES), POOLS);
  assert.ok(ALL_LINES.length >= 30, `${ALL_LINES.length} lines`);
  assert.equal(ALL_LINES.length, 33);
  assert.equal(new Set(ALL_LINES).size, ALL_LINES.length, 'no line appears twice');
  for (const pool of POOLS) assert.ok(RIVAL_LINES[pool].length >= 2, `pool ${pool} has a choice`);
  for (const line of ALL_LINES) {
    assert.equal(typeof line, 'string');
    assert.ok(len(line) >= 2 && len(line) <= 10, `「${line}」 has ${len(line)} characters`);
    assert.match(line, /[。！…]$/u, `「${line}」 ends like a spoken sentence`);
    assert.doesNotMatch(line, /[A-Za-z0-9!?,.;:]/, `「${line}」 uses full-width Chinese only`);
  }
});

test('no line contains 你 or 小主公', () => {
  for (const line of ALL_LINES) {
    for (const word of ['你', '小主公', '主公', '您', '汝', '尔', '小儿', '孩']) assert.ok(!line.includes(word), `「${line}」 speaks about the child (${word})`);
    // the words banned from every child-facing string of the game layer (SPEC 4.23)
    for (const word of ['主帅', '阿策', '阿弈', '离线', '引擎', '程序']) assert.ok(!line.includes(word), `「${line}」 contains ${word}`);
  }
});

test('names and titles of the two commanders', () => {
  assert.equal(RIVAL_NAME, '司马懿');
  assert.equal(RIVAL_TITLE, '魏 · 大都督');
  assert.equal(CHILD_TITLE, '蜀 · 小主公');
});

test('the lines of 4.22 in the owner\'s wording (CONTRACT-NOTES 113), character for character', () => {
  assert.deepEqual(RIVAL_LINES, {
    start: ['请。', '开局吧。', '请出招。'],
    check: ['将军。', '兵临城下。'],
    smug: ['此计已成。', '早有防备。', '看我这一手。', '正合我意。'],
    quiet: ['稳扎稳打。', '不急。', '步步为营。', '再布一子。', '且看后手。'],
    rattled: ['竟有此着！', '失算了……', '好生厉害。', '这一手厉害。', '这倒没料到。'],
    frown: ['容我三思……', '局势不妙。', '须得小心。', '此局难解。'],
    checked: ['不慌。', '来得好。', '有点意思。'],
    win: ['承让。', '承让，改日再战。'],
    lose: ['此局是我输了。', '心服口服。', '来日再战。'],
    draw: ['平分秋色。', '不分胜负。'],
  });
});

test('a proud but worthy rival: no line belittles a move of the child or gloats (CONTRACT-NOTES 113)', () => {
  // the rewording kept the size of every pool of 4.22
  assert.deepEqual(Object.fromEntries(POOLS.map(pool => [pool, RIVAL_LINES[pool].length])),
    { start: 3, check: 2, smug: 4, quiet: 5, rattled: 5, frown: 4, checked: 3, win: 2, lose: 3, draw: 2 });

  // the eight lines the owner took out stay out, in every pool
  const retired = ['落子无悔。', '此路不通。', '兵不厌诈。', '果然如此。', '大意了。', '小小风浪。', '不足为惧。', '胜负已分。'];
  for (const line of retired) assert.ok(!ALL_LINES.includes(line), `「${line}」 is back`);

  // the game has a take-back (悔棋), so he never says a move cannot be taken back
  for (const line of ALL_LINES) assert.ok(!line.includes('无悔'), `「${line}」`);
  // a mating move is a `moved` event with gaveCheck like any other check, so a check line may be the last thing a child
  // who has just lost reads before 承让: it never asks for an answer that does not exist, and never talks of the result
  for (const rnd of [at(0), at(0.5), at(0.999999)]) {
    const mating = rivalReact({ kind: 'moved', gaveCheck: true, punishesChild: true }, FREE, rnd);
    assert.equal(mating.mood, 'calm');
    assert.equal(poolOf(mating.line), 'check');
  }
  for (const line of RIVAL_LINES.check) {
    for (const word of ['请', '应', '解', '接', '逃', '躲', '胜', '负', '赢', '输', '败', '杀']) assert.ok(!line.includes(word), `「${line}」 with the mating move (${word})`);
  }
  // checked, he does not wave the child's check away
  for (const line of RIVAL_LINES.checked) {
    for (const word of ['不足', '小小', '区区']) assert.ok(!line.includes(word), `「${line}」 belittles the check (${word})`);
  }
  // smug is pride in his own move, never that the child was fooled
  for (const line of RIVAL_LINES.smug) {
    for (const word of ['诈', '果然', '中计', '上当']) assert.ok(!line.includes(word), `「${line}」 gloats (${word})`);
  }
  // punished, he credits the move; he does not put it down to his own carelessness
  for (const line of RIVAL_LINES.rattled) assert.ok(!line.includes('大意'), `「${line}」 explains the child's move away`);
  // after his win: thanks, at most a rematch, and not a word about the result
  for (const line of RIVAL_LINES.win) {
    assert.ok(line.startsWith('承让'), `「${line}」`);
    for (const word of ['胜', '负', '赢', '输', '败']) assert.ok(!line.includes(word), `「${line}」 rubs the result in (${word})`);
  }
});

test('the mood rule: start, thinking, moved, punished, checked, over', () => {
  // start: calm, always with a start line, even right after another line
  for (const s of [FREE, JUST_SPOKE, { rivalMoveNo: 0, lineAt: -99 }, { rivalMoveNo: 0, lineAt: 0 }]) {
    const r = rivalReact({ kind: 'start' }, s, at(0.5));
    assert.equal(r.mood, 'calm');
    assert.equal(poolOf(r.line), 'start');
  }

  // thinking: a frown only when he is in trouble
  assert.deepEqual(rivalReact({ kind: 'thinking' }, FREE, at(0)), { mood: 'thinking' });
  assert.deepEqual(rivalReact({ kind: 'thinking', trouble: false }, FREE, at(0)), { mood: 'thinking' });
  assert.equal(rivalReact({ kind: 'thinking', trouble: true }, FREE, at(0)).mood, 'frown');
  assert.equal(poolOf(rivalReact({ kind: 'thinking', trouble: true }, FREE, at(0)).line), 'frown');
  assert.deepEqual(rivalReact({ kind: 'thinking', trouble: true }, JUST_SPOKE, at(0)), { mood: 'frown' });

  // moved: smug after his own tactic, calm otherwise
  assert.equal(rivalReact({ kind: 'moved', tacticLanded: true }, FREE, at(0)).mood, 'smug');
  assert.equal(poolOf(rivalReact({ kind: 'moved', tacticLanded: true }, FREE, at(0)).line), 'smug');
  assert.equal(rivalReact({ kind: 'moved', tacticLanded: true, gaveCheck: true }, FREE, at(0)).mood, 'smug');
  assert.deepEqual(rivalReact({ kind: 'moved', tacticLanded: true }, JUST_SPOKE, at(0)), { mood: 'smug' });
  assert.equal(rivalReact({ kind: 'moved', gaveCheck: true }, FREE, at(0)).mood, 'calm');
  assert.equal(poolOf(rivalReact({ kind: 'moved', gaveCheck: true }, FREE, at(0)).line), 'check');
  assert.deepEqual(rivalReact({ kind: 'moved', gaveCheck: true }, JUST_SPOKE, at(0)), { mood: 'calm' });
  assert.equal(rivalReact({ kind: 'moved' }, FREE, at(0.99)).mood, 'calm');
  assert.deepEqual(rivalReact({ kind: 'moved' }, JUST_SPOKE, at(0)), { mood: 'calm' });

  // a tactic that only punishes the child's slip is an ordinary move: the check line, or now and then a quiet one
  assert.equal(poolOf(rivalReact({ kind: 'moved', tacticLanded: true, punishesChild: true, gaveCheck: true }, FREE, at(0)).line), 'check');
  assert.equal(poolOf(rivalReact({ kind: 'moved', tacticLanded: true, punishesChild: true }, FREE, at(0)).line), 'quiet');
  assert.deepEqual(rivalReact({ kind: 'moved', tacticLanded: true, punishesChild: true }, FREE, at(0.5)), { mood: 'calm' });

  // punished: rattled
  assert.equal(rivalReact({ kind: 'punished' }, FREE, at(0)).mood, 'rattled');
  assert.equal(poolOf(rivalReact({ kind: 'punished' }, FREE, at(0)).line), 'rattled');
  assert.deepEqual(rivalReact({ kind: 'punished' }, JUST_SPOKE, at(0)), { mood: 'rattled' });

  // checked: calm, he takes the check in his stride
  assert.equal(rivalReact({ kind: 'checked' }, FREE, at(0)).mood, 'calm');
  assert.equal(poolOf(rivalReact({ kind: 'checked' }, FREE, at(0)).line), 'checked');
  assert.deepEqual(rivalReact({ kind: 'checked' }, JUST_SPOKE, at(0)), { mood: 'calm' });

  // over: calm; `result` is the child's result, so the child's loss is his win
  for (const s of [FREE, JUST_SPOKE]) {
    for (const [result, pool] of [['loss', 'win'], ['win', 'lose'], ['draw', 'draw']]) {
      const r = rivalReact({ kind: 'over', result }, s, at(0.5));
      assert.equal(r.mood, 'calm');
      assert.equal(poolOf(r.line), pool, `child ${result}`);
    }
  }
  // an over event that carries no result has nothing to say
  assert.deepEqual(rivalReact({ kind: 'over' }, FREE, at(0)), { mood: 'calm' });
});

test('a line is drawn from the pool named by the mood or event, and every line of a pool can come up', () => {
  const cases = [
    [{ kind: 'start' }, 'start'], [{ kind: 'thinking', trouble: true }, 'frown'], [{ kind: 'moved', tacticLanded: true }, 'smug'],
    [{ kind: 'moved', gaveCheck: true }, 'check'], [{ kind: 'punished' }, 'rattled'], [{ kind: 'checked' }, 'checked'],
    [{ kind: 'over', result: 'loss' }, 'win'], [{ kind: 'over', result: 'win' }, 'lose'], [{ kind: 'over', result: 'draw' }, 'draw'],
  ];
  for (const [ev, pool] of cases) {
    const rnd = mulberry32(7);
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const r = rivalReact(ev, FREE, rnd);
      assert.ok(RIVAL_LINES[pool].includes(r.line), `${ev.kind}: 「${r.line}」 is not a ${pool} line`);
      seen.add(r.line);
    }
    assert.equal(seen.size, RIVAL_LINES[pool].length, `every ${pool} line comes up`);
    // the ends of the generator's range stay inside the pool, and so does a generator that wrongly returns 1
    assert.equal(rivalReact(ev, FREE, at(0)).line, RIVAL_LINES[pool][0]);
    assert.equal(rivalReact(ev, FREE, at(0.999999)).line, RIVAL_LINES[pool].at(-1));
    assert.equal(rivalReact(ev, FREE, at(1)).line, RIVAL_LINES[pool].at(-1));

    // no favourite: an even sweep of the generator's range lands on every line of the pool equally often
    const size = RIVAL_LINES[pool].length;
    const times = new Map();
    for (let i = 0; i < 40 * size; i++) {
      const line = rivalReact(ev, FREE, at((i + 0.5) / (40 * size))).line;
      times.set(line, (times.get(line) ?? 0) + 1);
    }
    for (const line of RIVAL_LINES[pool]) assert.equal(times.get(line), 40, `「${line}」 in the ${pool} pool`);
  }

  // a calm move: a `quiet` line with probability 0.3, otherwise nothing
  const rnd = mulberry32(11);
  const quiet = new Map();
  let spoken = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const r = rivalReact({ kind: 'moved' }, FREE, rnd);
    assert.equal(r.mood, 'calm');
    if (r.line === undefined) continue;
    assert.ok(RIVAL_LINES.quiet.includes(r.line), `「${r.line}」 is not a quiet line`);
    quiet.set(r.line, (quiet.get(r.line) ?? 0) + 1);
    spoken += 1;
  }
  assert.ok(Math.abs(spoken / N - 0.3) < 0.015, `a quiet line on ${(100 * spoken / N).toFixed(1)} % of calm moves`);
  assert.equal(quiet.size, RIVAL_LINES.quiet.length);
  assert.equal(rivalReact({ kind: 'moved' }, FREE, at(0)).line, RIVAL_LINES.quiet[0]);
  assert.deepEqual(rivalReact({ kind: 'moved' }, FREE, at(0.3)), { mood: 'calm' });
  assert.deepEqual(rivalReact({ kind: 'moved' }, FREE, at(0.99)), { mood: 'calm' });

  // the quiet lines have no favourite either
  for (const line of RIVAL_LINES.quiet) {
    const share = quiet.get(line) / spoken;
    assert.ok(Math.abs(share - 1 / RIVAL_LINES.quiet.length) < 0.03, `「${line}」 is ${(100 * share).toFixed(1)} % of the quiet lines`);
  }
});

test('the result is deterministic for a given generator and never touches its arguments', () => {
  const events = [{ kind: 'start' }, { kind: 'thinking', trouble: true }, ...MOVED, { kind: 'punished' }, { kind: 'checked' }, { kind: 'over', result: 'win' }];
  const run = seed => {
    const rnd = mulberry32(seed);
    return events.map(ev => rivalReact(ev, FREE, rnd));
  };
  assert.deepEqual(run(42), run(42));

  const ev = Object.freeze({ kind: 'moved', gaveCheck: true });
  const s = Object.freeze({ rivalMoveNo: 9, lineAt: 2 });
  const lines = structuredClone(RIVAL_LINES);
  rivalReact(ev, s, mulberry32(1));
  assert.deepEqual(RIVAL_LINES, lines);
  for (const r of run(3)) {
    assert.ok(MOODS.includes(r.mood));
    assert.deepEqual(Object.keys(r).sort(), r.line === undefined ? ['mood'] : ['line', 'mood']);
  }
});

test('at most one line per five rival moves except start and over', () => {
  // the gap itself: the fifth rival move after a line is the first that may carry another
  for (const ev of [{ kind: 'thinking', trouble: true }, { kind: 'moved', tacticLanded: true }, { kind: 'moved', gaveCheck: true },
                    { kind: 'moved' }, { kind: 'punished' }, { kind: 'checked' }]) {
    for (const gap of [0, 1, 2, 3, 4]) {
      assert.equal(rivalReact(ev, { rivalMoveNo: 20 + gap, lineAt: 20 }, at(0)).line, undefined, `${ev.kind}, ${gap} moves after a line`);
    }
    assert.equal(typeof rivalReact(ev, { rivalMoveNo: 25, lineAt: 20 }, at(0)).line, 'string', `${ev.kind}, five moves after a line`);
    assert.equal(typeof rivalReact(ev, { rivalMoveNo: 1, lineAt: -99 }, at(0)).line, 'string', `${ev.kind}, no line yet this game`);
    // a mark ahead of the game (the director does not rewind it on undo) keeps him quiet; it never counts as a long silence
    for (const rivalMoveNo of [3, 9, 14, 18]) {
      assert.equal(rivalReact(ev, { rivalMoveNo, lineAt: 14 }, at(0)).line, undefined, `${ev.kind}, rival move ${rivalMoveNo} with the last line marked at 14`);
    }
    assert.equal(typeof rivalReact(ev, { rivalMoveNo: 19, lineAt: 14 }, at(0)).line, 'string');
  }

  // whole games, the way the director drives him (SPEC 5.8): thinking, moved, then the child's answer; the director
  // remembers the rival move number of every line (Budgets.rivalLineAt)
  let total = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = mulberry32(seed);
    let lineAt = -99;
    const spokeAt = [];
    const say = (ev, rivalMoveNo) => {
      const r = rivalReact(ev, { rivalMoveNo, lineAt }, rnd);
      if (r.line !== undefined) {
        assert.ok(ALL_LINES.includes(r.line));
        spokeAt.push(rivalMoveNo);
        lineAt = rivalMoveNo;
      }
    };

    assert.equal(poolOf(rivalReact({ kind: 'start' }, { rivalMoveNo: 0, lineAt }, rnd).line), 'start');
    for (let k = 1; k <= 60; k++) {
      say({ kind: 'thinking', trouble: rnd() < 0.3 }, k);
      say({ kind: 'moved', tacticLanded: rnd() < 0.25, gaveCheck: rnd() < 0.2, punishesChild: rnd() < 0.2 }, k);
      const answer = rnd();
      if (answer < 0.2) say({ kind: 'punished' }, k);
      else if (answer < 0.4) say({ kind: 'checked' }, k);
    }
    for (let i = 1; i < spokeAt.length; i++) {
      assert.ok(spokeAt[i] - spokeAt[i - 1] >= 5, `seed ${seed}: lines at rival moves ${spokeAt[i - 1]} and ${spokeAt[i]}`);
    }
    assert.ok(spokeAt.length <= 12, `seed ${seed}: ${spokeAt.length} lines in 60 rival moves`);
    total += spokeAt.length;

    // the closing line is outside the rule: it comes even right after another line
    const last = rivalReact({ kind: 'over', result: 'win' }, { rivalMoveNo: 60, lineAt: 60 }, rnd);
    assert.equal(poolOf(last.line), 'lose');
  }
  assert.ok(total >= 40 * 6, `he is not mute: ${total} lines in 40 games`);
});

test('smug never follows a child blunder; rattled only after being punished', () => {
  const generators = [at(0), at(0.29), at(0.3), at(0.5), at(0.999999), mulberry32(5)];

  for (const rnd of generators) {
    for (const s of [FREE, JUST_SPOKE]) {
      // a move that punishes the child's slip is never smug, tactic or not, check or not
      for (const ev of MOVED.filter(e => e.punishesChild)) {
        for (let i = 0; i < 50; i++) {
          const r = rivalReact(ev, s, rnd);
          assert.equal(r.mood, 'calm', JSON.stringify(ev));
          assert.ok(r.line === undefined || !RIVAL_LINES.smug.includes(r.line), `「${r.line}」 after a child blunder`);
        }
      }
      // smug needs his own tactic
      for (const ev of MOVED) {
        const r = rivalReact(ev, s, rnd);
        assert.equal(r.mood === 'smug', ev.tacticLanded && !ev.punishesChild, JSON.stringify(ev));
        if (r.line !== undefined && RIVAL_LINES.smug.includes(r.line)) assert.equal(r.mood, 'smug');
      }

      // rattled is the reaction to being punished, and the only one
      for (let i = 0; i < 20; i++) {
        const r = rivalReact({ kind: 'punished' }, s, rnd);
        assert.equal(r.mood, 'rattled');
        assert.ok(r.line === undefined || RIVAL_LINES.rattled.includes(r.line));
      }
      const others = [{ kind: 'start' }, { kind: 'thinking' }, { kind: 'thinking', trouble: true }, ...MOVED, { kind: 'checked' },
                      { kind: 'over', result: 'win' }, { kind: 'over', result: 'loss' }, { kind: 'over', result: 'draw' }];
      for (const ev of others) {
        for (let i = 0; i < 20; i++) {
          const r = rivalReact(ev, s, rnd);
          assert.notEqual(r.mood, 'rattled', JSON.stringify(ev));
          assert.ok(r.line === undefined || !RIVAL_LINES.rattled.includes(r.line), `「${r.line}」 without being punished`);
        }
      }
    }
  }

  // winning or losing, he never gloats: the closing lines carry no smug line and no word about the child
  for (const result of ['win', 'loss', 'draw']) {
    for (let i = 0; i < 50; i++) {
      const r = rivalReact({ kind: 'over', result }, FREE, mulberry32(i));
      assert.equal(r.mood, 'calm');
      assert.ok(!RIVAL_LINES.smug.includes(r.line));
    }
  }
});
