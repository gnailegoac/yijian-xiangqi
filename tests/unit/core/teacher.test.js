// Unit tests of src/core/teacher.js (contract sections 4.7 and 14.1): the skill model, the teaching opponent, tension and
// takeaways. The opponent is tested on hand-built root tables with a stub `verify`; nothing depends on the clock
// (Date.now is stubbed where finishGame reads it). One test searches real opening positions, bounded by depth and
// nodes: the first moves of the rival (CONTRACT-NOTES 143 c). Expected values are the numbers of section 4.7 and of the
// owner's rulings, or are computed here independently of the implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, boardToFen, createInitialBoard, getLegalMoves } from '../../../src/core/engine.js';
import { describeMove } from '../../../src/core/notation.js';
import { MATE, createSearcher, mateIn, revealDepth, revealTier, scoreToCp } from '../../../src/core/search.js';
import {
  createSkillProfile, migrateSkillProfile, createGameSkill, reviveGameSkill, recordChildMove, recordOpponentMove, rewindGameSkill,
  effectiveLevel, revealFor, findRate, levelParams, teachingContext, chooseTeachingMove, tension, gameTakeaways, finishGame,
  expectedAccuracy, levelFromAccuracy,
} from '../../../src/core/teacher.js';
import { mulberry32 } from '../../helpers/playout.js';

// ---------------------------------------------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------------------------------------------

/** The start position, the rival (black) to move. The codes of most tables below are no moves of it: there it is only an input of the opponent's random generator. */
const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b';
const ref = code => ({ from: { row: Number(code[0]), col: Number(code[1]) }, to: { row: Number(code[2]), col: Number(code[3]) } });
const codeOf = move => `${move.from.row}${move.from.col}${move.to.row}${move.to.col}`;
const near = (actual, expected, eps = 1e-9, message = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${message} expected ${expected}, got ${actual}`);

/**
 * A root line (section 3.2). byDepth[d - 1] = exact score at iteration d; by default the line was exact in every iteration it lists,
 * its score is the last of them and its naive glance is the first.
 */
function line(code, byDepth, opts = {}) {
  const score = opts.score ?? byDepth[byDepth.length - 1];
  return {
    move: ref(code), score, depth: opts.depth ?? byDepth.length, upper: opts.upper ?? null, mate: mateIn(score),
    pv: (opts.pv ?? [code]).map(ref), byDepth: byDepth.slice(), naive: opts.naive ?? byDepth[0], repeats: opts.repeats ?? 1,
  };
}
/** A line with the same score at every depth 1..depth. */
const flat = (code, score, depth = 5, opts = {}) => line(code, Array(depth).fill(score), opts);

/** A table in the order section 3.2 prescribes: lines exact at `depth` first (best first), then the rest by min(score, upper). */
function tableOf(lines, opts = {}) {
  const depth = opts.depth ?? Math.max(...lines.map(l => l.depth));
  const allDepth = opts.allDepth ?? Math.min(...lines.map(l => l.byDepth.length));
  const bound = l => Math.min(l.score, l.upper ?? Infinity);
  const sorted = lines.slice().sort((a, b) => {
    const ea = a.depth === depth, eb = b.depth === depth;
    if (ea !== eb) return ea ? -1 : 1;
    return ea ? b.score - a.score : bound(b) - bound(a);
  });
  return { fen: opts.fen ?? FEN, turn: 'black', depth, allDepth, lines: sorted, nodes: 0, timeMs: 0, stopped: 'depth' };
}

/** A verify stub: answers from `answers` (code -> RootLine) and logs the codes it was asked for; any other move fails the test. */
function verifier(answers = {}) {
  const calls = [];
  const verify = async move => {
    const code = codeOf(move);
    calls.push(code);
    assert.ok(code in answers, `verify was called for ${code}, which the test does not expect`);
    return answers[code];
  };
  return { verify, calls };
}
const noVerify = async move => assert.fail(`verify must not be called (asked for ${codeOf(move)})`);

/** A TeachingContext of a level-5 rival in the middle of a later game; nothing in it blocks a gift. */
const ctxOf = (over = {}) => ({
  level: 5, reveal: 4, bandShift: 0, sinceChance: 99, sinceBlunder: 99, lastKind: null, spared: 0, aheadRun: 0, chances: 0,
  moveNo: 10, seed: 1, lastChildMove: null, firstGame: false, ...over,
});

const info = (code, over = {}) => ({ ...ref(code), notation: '炮二平五', piece: 'cannon', color: 'red', captured: null, ...over });
/** A MoveSample; `first` / `final` in `over` are merged into a perfect first try, and `final` defaults to a copy of `first`. */
function sample(ply, over = {}) {
  const first = { move: info('7774'), loss: 0, cat: 'best', ...(over.first ?? {}) };
  const final = { ...first, ...(over.final ?? {}) };
  return {
    ply, tries: 1, hint: 0, hintMax: 0, self: true, bestCp: 0, legalCount: 30, test: null, danger: null, habit: null, avoided: null,
    patterns: [], captured: null, thinkMs: 1000, ...over, first, final,
  };
}
/** A TeachingChoice as recordOpponentMove reads it. */
const choiceOf = (over = {}) => ({
  move: ref('0010'), line: flat('0010', 0), mode: 'spar', kind: 'honest', loss: 0, evalAfter: 0, evalBest: 0, chance: null, overlooked: null, ...over,
});
const aChance = { gain: 200, points: 2, tier: 1, revealDepth: 2, line: [] };

/** A profile with the given fields over a fresh one. */
const profileOf = (over = {}) => ({ ...createSkillProfile(over.level ?? 2), ...over });
/** A game with `count` counted samples of one loss each (weight 1), recorded on even plies. */
function gameOf(profile, count, loss = 0, over = {}) {
  let game = createGameSkill(7);
  for (let i = 0; i < count; i++) game = recordChildMove(profile, game, sample(2 * i, { ...over, first: { loss, cat: loss >= 300 ? 'blunder' : 'best', ...(over.first ?? {}) } }));
  return game;
}

/** A context of the given level whose band is centred on 0 (T' = 0), so that a level child (evalBest 0) is sparred with at every level. */
const centred = (level, over = {}) => ctxOf({ level, bandShift: -levelParams(level).T, ...over });

/** How often `pick(choice)` holds over the seeds 1..count. */
async function frequency(table, ctx, verify, pick, count = 2000) {
  let hits = 0;
  for (let seed = 1; seed <= count; seed++) if (pick(await chooseTeachingMove(table, { ...ctx, seed }, verify))) hits++;
  return hits / count;
}
/** |observed - p| <= three standard deviations of a binomial share over n draws (exact when p is 0 or 1). */
function withinThreeSigma(observed, p, n, message) {
  const sigma = Math.sqrt(p * (1 - p) / n);
  assert.ok(Math.abs(observed - p) <= 3 * sigma + 1e-12, `${message}: expected ${p} +- ${(3 * sigma).toFixed(4)}, got ${observed}`);
}

// ---------------------------------------------------------------------------------------------------------------
// level scale and parameters
// ---------------------------------------------------------------------------------------------------------------

test('levelParams at anchors and midpoints; expectedAccuracy and levelFromAccuracy are inverse on [1, 9]', () => {
  // the table of 4.7.5, column by column. Re-tuned below level 5 (CONTRACT-NOTES 104 and 124): at level 1 T is 300 (was 80),
  // C 500 (was 450) and gap 1 (was 2); at level 3 T is 150 (was 60) and C 500 (was 350). The rows of levels 5, 7 and 9 are the contract's.
  const anchors = {
    1: { honestDepth: 3, vmax: 1, T: 300, W: 120, J: 60, C: 500, gap: 1, overlook: [0.60, 0.90, 1] },
    3: { honestDepth: 4, vmax: 2, T: 150, W: 110, J: 45, C: 500, gap: 2, overlook: [0.40, 0.70, 1] },
    5: { honestDepth: 5, vmax: 3, T: 40, W: 100, J: 30, C: 250, gap: 3, overlook: [0.20, 0.45, 0.90] },
    7: { honestDepth: 6, vmax: 4, T: 20, W: 90, J: 20, C: 150, gap: 3, overlook: [0.08, 0.20, 0.50] },
    9: { honestDepth: null, vmax: 4, T: 0, W: 80, J: 10, C: 80, gap: 4, overlook: [0, 0.05, 0.20] },
  };
  for (const [level, want] of Object.entries(anchors)) {
    const p = levelParams(Number(level));
    assert.deepEqual(Object.keys(p).sort(), ['C', 'J', 'T', 'W', 'gap', 'honestDepth', 'overlook', 'vmax'], `keys at level ${level}`);
    for (const key of ['vmax', 'gap']) assert.equal(p[key], want[key], `${key} at level ${level}`);
    for (const key of ['T', 'W', 'J', 'C']) near(p[key], want[key], 1e-9, `${key} at level ${level}`);
    for (const tier of [1, 2, 3]) near(p.overlook[tier], want.overlook[tier - 1], 1e-9, `overlook[${tier}] at level ${level}`);
    if (want.honestDepth !== null) assert.equal(p.honestDepth, want.honestDepth, `honestDepth at level ${level}`);
  }
  // level 9: "table depth". No opponent table of 4.8.1 is deeper than 8 and no table of any job deeper than 9.
  assert.ok(Number.isInteger(levelParams(9).honestDepth) && levelParams(9).honestDepth >= 9);

  // midpoints: linear between the neighbouring anchors; the discrete parameters are rounded
  const mid = {
    2: { honestDepth: 4, vmax: 2, T: 225, W: 115, J: 52.5, C: 500, gap: 2, overlook: [0.50, 0.80, 1] },
    4: { honestDepth: 5, vmax: 3, T: 95, W: 105, J: 37.5, C: 375, gap: 3, overlook: [0.30, 0.575, 0.95] },
    6: { honestDepth: 6, vmax: 4, T: 30, W: 95, J: 25, C: 200, gap: 3, overlook: [0.14, 0.325, 0.70] },
    8: { honestDepth: null, vmax: 4, T: 10, W: 85, J: 15, C: 115, gap: 4, overlook: [0.04, 0.125, 0.35] },
  };
  for (const [level, want] of Object.entries(mid)) {
    const p = levelParams(Number(level));
    for (const key of ['vmax', 'gap']) assert.equal(p[key], want[key], `${key} at level ${level}`);
    for (const key of ['T', 'W', 'J', 'C']) near(p[key], want[key], 1e-9, `${key} at level ${level}`);
    for (const tier of [1, 2, 3]) near(p.overlook[tier], want.overlook[tier - 1], 1e-9, `overlook[${tier}] at level ${level}`);
    if (want.honestDepth !== null) assert.equal(p.honestDepth, want.honestDepth, `honestDepth at level ${level}`);
  }
  near(levelParams(1.5).T, 262.5);
  near(levelParams(7.5).C, 132.5);
  near(levelParams(5.5).overlook[2], 0.3875);
  // gap 1 holds below level 2 only: 1.495 -> 1, 1.5 -> 2
  assert.deepEqual([1, 1.5, 1.99, 2, 2.5].map(level => levelParams(level).gap), [1, 1, 1, 2, 2]);
  // from level 5 up nothing is re-tuned: every parameter follows the contract's anchors (T -10, W -5 per level, ...)
  for (let level = 5; level <= 9; level += 0.5) {
    const p = levelParams(level);
    near(p.T, 40 - 10 * (level - 5), 1e-9, `T at level ${level}`);
    near(p.W, 100 - 5 * (level - 5), 1e-9, `W at level ${level}`);
    near(p.C, level <= 7 ? 250 - 50 * (level - 5) : 150 - 35 * (level - 7), 1e-9, `C at level ${level}`);
    near(p.J, level <= 7 ? 30 - 5 * (level - 5) : 20 - 5 * (level - 7), 1e-9, `J at level ${level}`);
  }
  // rounded to the nearest integer: 3.25 -> 3, 1.25 -> 1, 2.25 -> 2, 3.25 -> 3, 3.75 -> 4, 5.75 -> 6
  assert.deepEqual([levelParams(1.5).honestDepth, levelParams(1.5).vmax, levelParams(3.5).gap, levelParams(7.5).gap, levelParams(6.5).vmax, levelParams(6.5).honestDepth],
                   [3, 1, 2, 3, 4, 6]);

  // integers stay integers and every parameter moves in one direction between levels 1 and 9; outside the scale it is clamped
  let prev = levelParams(1);
  for (let level = 1; level <= 9 + 1e-9; level += 0.125) {
    const p = levelParams(level);
    for (const key of ['honestDepth', 'vmax', 'gap']) {
      assert.ok(Number.isInteger(p[key]), `${key} is an integer at level ${level}`);
      assert.ok(p[key] >= prev[key], `${key} never falls (level ${level})`);
    }
    for (const key of ['T', 'W', 'J', 'C']) assert.ok(p[key] <= prev[key] + 1e-9, `${key} never rises (level ${level})`);
    for (const tier of [1, 2, 3]) assert.ok(p.overlook[tier] <= prev.overlook[tier] + 1e-9 && p.overlook[tier] >= 0 && p.overlook[tier] <= 1);
    prev = p;
  }
  assert.deepEqual(levelParams(0), levelParams(1));
  assert.deepEqual(levelParams(-3), levelParams(1));
  assert.deepEqual(levelParams(12), levelParams(9));

  // E(level): the anchors of 4.7.1, linear in between
  const E = [0.70, 0.76, 0.81, 0.87, 0.895, 0.915, 0.945, 0.96, 0.975];
  E.forEach((e, i) => near(expectedAccuracy(i + 1), e, 1e-12, `E(${i + 1})`));
  near(expectedAccuracy(1.5), 0.73);
  near(expectedAccuracy(4.5), 0.8825);
  near(expectedAccuracy(8.25), 0.96375);
  assert.equal(expectedAccuracy(0), 0.70);
  assert.equal(expectedAccuracy(11), 0.975);

  // inverse on [1, 9], both ways, and clamped outside
  for (let level = 1; level <= 9 + 1e-9; level += 1 / 16) near(levelFromAccuracy(expectedAccuracy(level)), Math.min(level, 9), 1e-9, `invE(E(${level}))`);
  for (let acc = 0.70; acc <= 0.975; acc += 0.0025) near(expectedAccuracy(levelFromAccuracy(acc)), acc, 1e-9, `E(invE(${acc}))`);
  for (let level = 1; level < 9; level += 0.25) assert.ok(expectedAccuracy(level + 0.25) > expectedAccuracy(level), 'E rises strictly');
  assert.equal(levelFromAccuracy(0.2), 1);
  assert.equal(levelFromAccuracy(0.70), 1);
  assert.equal(levelFromAccuracy(0.975), 9);
  assert.equal(levelFromAccuracy(1), 9);
  near(levelFromAccuracy(0.9), 5.25);
  near(levelFromAccuracy(0.79), 2.6);
});

// ---------------------------------------------------------------------------------------------------------------
// what is measured
// ---------------------------------------------------------------------------------------------------------------

test('a single 600-cp blunder after 20 perfect moves changes effectiveLevel by at most 0.25', () => {
  for (const level of [1, 2, 3.4, 5, 7.5, 9]) {
    const profile = profileOf({ level });
    let game = createGameSkill(1);
    let before = effectiveLevel(profile, game);
    assert.equal(before, level);
    for (let i = 0; i < 20; i++) {
      game = recordChildMove(profile, game, sample(2 * i));
      const now = effectiveLevel(profile, game);
      assert.ok(Math.abs(now - before) <= 0.25 + 1e-12, `a perfect move changes level ${level} by ${now - before}`);
      before = now;
    }
    game = recordChildMove(profile, game, sample(40, { first: { loss: 600, cat: 'blunder' } }));
    const after = effectiveLevel(profile, game);
    assert.ok(Math.abs(after - before) <= 0.25 + 1e-12, `the blunder changes level ${level} by ${after - before}`);
    assert.ok(after <= before, 'a blunder never raises the level');
  }

  // the numbers of 4.7.2 at level 5: twenty perfect moves give invE(1) = 9, shrunk by 20 / 80, so the shift is +1.0;
  // the blunder moves the target to (invE(20 / 21) - 5) * 21 / 81 = 0.646, and the rate limit allows only -0.25
  const profile = profileOf({ level: 5 });
  let game = gameOf(profile, 20);
  near(game.shift, 1.0);
  near(effectiveLevel(profile, game), 6.0);
  game = recordChildMove(profile, game, sample(40, { first: { loss: 600, cat: 'blunder' } }));
  near(game.n, 21);
  near(game.accSum, 20);
  near(game.shift, 0.75);
  near(effectiveLevel(profile, game), 5.75);

  // nothing moves before four counted samples; the shift is bounded by +-1.5 and the level by [1, 9]
  let early = createGameSkill(1);
  for (let i = 0; i < 3; i++) early = recordChildMove(profile, early, sample(2 * i, { first: { loss: 600, cat: 'blunder' } }));
  assert.equal(early.shift, 0);
  early = recordChildMove(profile, early, sample(6, { first: { loss: 600, cat: 'blunder' } }));
  near(early.shift, -0.25, 1e-12, 'the fourth sample: (invE(0) - 5) * 4 / 64');
  let bad = createGameSkill(1);
  const strong = profileOf({ level: 9 });
  for (let i = 0; i < 300; i++) bad = recordChildMove(strong, bad, sample(2 * i, { first: { loss: 600, cat: 'blunder' } }));
  assert.ok(bad.shift >= -1.5 && bad.shift < -1.4, `shift floor, got ${bad.shift}`);
  assert.equal(effectiveLevel(profileOf({ level: 1.2 }), { ...bad, drift: -3 }), 1);
  assert.equal(effectiveLevel(profileOf({ level: 8.9 }), { ...createGameSkill(1), shift: 1.5, drift: 2 }), 9);
});

test('sample weights: forced move, pouch 3, decided position', () => {
  const profile = profileOf({ level: 4 });
  /** The weight and the accuracy one sample adds. */
  const added = over => {
    const game = recordChildMove(profile, createGameSkill(1), sample(0, over));
    return { w: game.n, wAcc: game.accSum };
  };
  assert.deepEqual(added({}), { w: 1, wAcc: 1 });
  // forced move: two legal moves or fewer (0 = not known, CONTRACT-NOTES 69 d)
  assert.equal(added({ legalCount: 2 }).w, 0);
  assert.equal(added({ legalCount: 1 }).w, 0);
  assert.equal(added({ legalCount: 0 }).w, 0);
  assert.equal(added({ legalCount: 3 }).w, 1);
  // pouches opened before the first try
  assert.equal(added({ hint: 3, hintMax: 3 }).w, 0);
  assert.equal(added({ hint: 2, hintMax: 2 }).w, 0.5);
  assert.equal(added({ hint: 1, hintMax: 1 }).w, 0.5);
  assert.equal(added({ hint: 0, hintMax: 3 }).w, 1, 'a pouch opened after the first try does not change the weight');
  // decided position
  assert.equal(added({ bestCp: 1200 }).w, 0);
  assert.equal(added({ bestCp: -1200 }).w, 0);
  assert.equal(added({ bestCp: 2000 }).w, 0);
  assert.equal(added({ bestCp: 1199 }).w, 0.5);
  assert.equal(added({ bestCp: 700 }).w, 0.5);
  assert.equal(added({ bestCp: -700 }).w, 0.5);
  assert.equal(added({ bestCp: 699 }).w, 1);
  assert.equal(added({ bestCp: 700, hint: 1 }).w, 0.5, 'half weight is not halved again');
  assert.equal(added({ bestCp: 700, hint: 3 }).w, 0);

  // accuracy max(0, 1 - first.loss / 300), from the FIRST try whatever the confirmed move was
  near(added({ first: { loss: 150, cat: 'mistake' } }).wAcc, 0.5);
  near(added({ first: { loss: 30, cat: 'good' } }).wAcc, 0.9);
  assert.equal(added({ first: { loss: 300, cat: 'blunder' } }).wAcc, 0);
  assert.equal(added({ first: { loss: 600, cat: 'blunder' } }).wAcc, 0);
  near(added({ first: { loss: 150, cat: 'mistake' }, final: { loss: 0, cat: 'best' } }).wAcc, 0.5);
  near(added({ first: { loss: 0, cat: 'best' }, final: { loss: 600, cat: 'blunder' } }).wAcc, 1);
  near(added({ first: { loss: 150, cat: 'mistake' }, hint: 2 }).wAcc, 0.25);

  // a sample of weight 0 is still kept and still marked
  const game = recordChildMove(profile, createGameSkill(1), sample(0, { legalCount: 1 }));
  assert.equal(game.samples.length, 1);
  assert.equal(game.marks.length, 1);
  assert.equal(game.n, 0);
});

test('finishGame: caps 0.5 and placement 1.0; n < 8 leaves the level alone; streak and bandShift sequences; habits decay and grow', t => {
  t.mock.method(Date, 'now', () => 1790000000000);

  // cap 0.5 after the three placement games: 40 perfect moves ask for (9 - 3) * 0.25 = 1.5
  let profile = profileOf({ level: 3, games: 5 });
  let fin = finishGame(profile, gameOf(profile, 40), 'win');
  assert.equal(fin.delta, 0.5);
  assert.equal(fin.profile.level, 3.5);
  profile = profileOf({ level: 8, games: 3 });
  fin = finishGame(profile, gameOf(profile, 40, 150), 'loss');       // accuracy 0.5 -> invE = 1 -> (1 - 8) * 0.25
  assert.equal(fin.delta, -0.5);
  assert.equal(fin.profile.level, 7.5);

  // placement: double weight, cap 1.0, for games 0, 1 and 2
  for (const games of [0, 1, 2]) {
    profile = profileOf({ level: 2, games });
    fin = finishGame(profile, gameOf(profile, 40), 'win');           // (9 - 2) * 0.5 = 3.5 -> 1.0
    assert.equal(fin.delta, 1, `placement cap in game ${games + 1}`);
    assert.equal(fin.profile.level, 3);
    assert.equal(fin.profile.games, games + 1);
  }
  profile = profileOf({ level: 2, games: 0 });
  const tenPerfect = gameOf(profile, 10);                             // w = 2 * 10 / 110; the shift does not enter the formula
  fin = finishGame(profile, tenPerfect, 'draw');
  near(fin.delta, Math.min(1, 7 * 2 * 10 / 110));
  profile = profileOf({ level: 5, games: 1 });
  fin = finishGame(profile, gameOf(profile, 10, 30), 'draw');        // accuracy 0.9 -> invE 5.25; w = 2 * 10 / 110
  near(fin.delta, 0.25 * 2 * 10 / 110);
  near(fin.profile.level, 5 + 0.25 * 2 * 10 / 110);

  // below the caps: target invE(0.9) = 5.25, w = min(0.25, 20 / 120), plus 0.35 * drift
  profile = profileOf({ level: 4, games: 10 });
  fin = finishGame(profile, { ...gameOf(profile, 20, 30), drift: -0.5 }, 'draw');
  near(fin.delta, 1.25 * (20 / 120) + 0.35 * -0.5);
  near(fin.profile.level, 4 + 1.25 * (20 / 120) - 0.175);
  fin = finishGame(profile, { ...gameOf(profile, 20, 30), drift: 2 }, 'draw');
  assert.equal(fin.delta, 0.5, 'the drift term is inside the cap');
  // the level stays inside [1, 9]
  assert.equal(finishGame(profileOf({ level: 8.8, games: 9 }), { ...gameOf(profileOf({ level: 8.8 }), 40), drift: 2 }, 'win').profile.level, 9);
  assert.equal(finishGame(profileOf({ level: 1.1, games: 9 }), { ...gameOf(profileOf({ level: 1.1 }), 40, 300), drift: -3 }, 'loss').profile.level, 1);
  near(finishGame(profileOf({ level: 8.8, games: 9 }), gameOf(profileOf({ level: 8.8 }), 40), 'win').profile.level, 8.85);

  // n < 8: nothing but `recent` changes, takeaways are still returned
  profile = profileOf({ level: 3, games: 4, streak: 2, bandShift: 15, habits: { greedy: 2 }, tactics: { seen: [1, 2, 3], found: [1, 1, 0] } });
  const before = structuredClone(profile);
  const short = { ...gameOf(profile, 7, 300, { habit: 'greedy', danger: 'hangs_moved_piece', test: { tier: 1, kind: 'win', found: false } }), drift: -3 };
  assert.equal(short.n, 7);
  fin = finishGame(profile, short, 'loss');
  assert.equal(fin.delta, 0);
  assert.deepEqual(fin.takeaways.map(t => t.kind), ['lesson']);
  assert.deepEqual(fin.takeaways, gameTakeaways(short, 'loss', profile));
  assert.deepEqual({ ...fin.profile, recent: [] }, before);
  assert.deepEqual(fin.profile.recent, [{ at: 1790000000000, result: 'loss', acc: 0, n: 7, level: 3 }]);
  assert.deepEqual(profile, before, 'the input profile is not changed');
  // seven and a half counted moves are still fewer than eight; eight count
  let halves = createGameSkill(1);
  for (let i = 0; i < 15; i++) halves = recordChildMove(profile, halves, sample(2 * i, { hint: 1 }));
  assert.equal(halves.n, 7.5);
  assert.equal(finishGame(profile, halves, 'win').profile.games, 4);
  assert.equal(finishGame(profile, gameOf(profile, 8), 'win').profile.games, 5);
  // an empty game: accuracy 0 by convention, the profile stays valid JSON
  fin = finishGame(profile, createGameSkill(1), 'loss');
  assert.deepEqual(fin.profile.recent, [{ at: 1790000000000, result: 'loss', acc: 0, n: 0, level: 3 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(fin.profile)), fin.profile);

  // streak and bandShift: win -25, loss +40, draw +5, clamped to [-60, +120]
  profile = profileOf({ level: 5, games: 20 });
  const steady = gameOf(profile, 10, 30);
  const seen = [];
  for (const result of ['win', 'win', 'win', 'loss', 'loss', 'draw', 'loss', 'loss', 'loss', 'win', 'draw', 'draw', 'loss', 'win']) {
    profile = finishGame(profile, steady, result).profile;
    seen.push([profile.streak, profile.bandShift]);
  }
  assert.deepEqual(seen, [[1, -25], [2, -50], [3, -60], [-1, -20], [-2, 20], [0, 25], [-1, 65], [-2, 105], [-3, 120], [1, 95], [0, 100], [0, 105],
                          [-1, 120], [1, 95]]);

  // habits: every count x0.9, +1 per sample with a habit (cap 9), below 0.2 deleted
  profile = profileOf({ level: 5, games: 20, habits: { greedy: 1, hang_piece: 0.21, bad_trade: 8.9 } });
  let game = gameOf(profile, 8);
  for (const [i, habit] of ['greedy', 'greedy', 'miss_threat', 'bad_trade', 'bad_trade', 'bad_trade'].entries()) {
    game = recordChildMove(profile, game, sample(100 + 2 * i, { habit, danger: 'slow', first: { loss: 200, cat: 'mistake' } }));
  }
  fin = finishGame(profile, game, 'draw');
  assert.deepEqual(Object.keys(fin.profile.habits).sort(), ['bad_trade', 'greedy', 'miss_threat']);
  near(fin.profile.habits.greedy, 0.9 + 2);
  near(fin.profile.habits.miss_threat, 1);
  assert.equal(fin.profile.habits.bad_trade, 9);
  // decay alone: 1 -> 0.9^k, gone at the 16th game (0.9^15 = 0.206, 0.9^16 = 0.185)
  profile = profileOf({ level: 5, games: 20, habits: { miss_mate: 1 } });
  for (let k = 1; k <= 16; k++) {
    profile = finishGame(profile, steady, 'draw').profile;
    if (k <= 15) near(profile.habits.miss_mate, 0.9 ** k, 1e-12, `after ${k} games`);
  }
  assert.deepEqual(profile.habits, {});

  // games, recent (ten kept, newest last) and the entry of this game
  profile = profileOf({ level: 4, games: 10 });
  for (let i = 0; i < 12; i++) profile = finishGame(profile, gameOf(profile, 8 + i, 30), 'draw').profile;
  assert.equal(profile.games, 22);
  assert.equal(profile.recent.length, 10);
  assert.deepEqual(profile.recent.map(r => r.n), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const last = profile.recent[9];
  assert.deepEqual(Object.keys(last), ['at', 'result', 'acc', 'n', 'level']);
  assert.equal(last.at, 1790000000000);
  assert.equal(last.result, 'draw');
  near(last.acc, 0.9);
  assert.equal(last.level, profile.level);
  assert.equal(profile.v, 1);
});

test('first-games bonus is +100, +100, +50, 0', () => {
  const game = createGameSkill(99);
  const extra = { moveNo: 3, lastChildMove: ref('7774') };
  assert.deepEqual([0, 1, 2, 3, 4, 50].map(games => teachingContext(profileOf({ games }), game, extra).bandShift), [100, 100, 50, 0, 0, 0]);
  // added to the stored band, which is not changed
  const profile = profileOf({ games: 1, bandShift: -60 });
  assert.equal(teachingContext(profile, game, extra).bandShift, 40);
  assert.equal(profile.bandShift, -60);
  assert.equal(teachingContext(profileOf({ games: 2, bandShift: 120 }), game, extra).bandShift, 170);
  assert.deepEqual([0, 1, 2, 3].map(games => teachingContext(profileOf({ games }), game, extra).firstGame), [true, false, false, false]);

  // the rest of the context is the game's counters, the effective level and the child's horizon
  const played = { ...game, shift: 0.5, drift: -1, sinceChance: 4, sinceBlunder: 1, lastKind: 'chance', spared: 1, aheadRun: 2, chances: 3 };
  assert.deepEqual(teachingContext(profileOf({ level: 6, games: 7, bandShift: 20 }), played, extra), {
    level: 5.5, reveal: 4, bandShift: 20, sinceChance: 4, sinceBlunder: 1, lastKind: 'chance', spared: 1, aheadRun: 2, chances: 3,
    moveNo: 3, seed: 99, lastChildMove: ref('7774'), lastChildCapture: false, firstGame: false, missRun: 0, lastRival: 0,
  });
});

test('teachingContext copies lastChildCapture: true only when the caller says true; absent means false', () => {
  const profile = profileOf({ level: 3, games: 4 });
  const game = createGameSkill(5);
  const last = ref('7774');
  assert.equal(teachingContext(profile, game, { moveNo: 6, lastChildMove: last, lastChildCapture: true }).lastChildCapture, true);
  assert.equal(teachingContext(profile, game, { moveNo: 6, lastChildMove: last, lastChildCapture: false }).lastChildCapture, false);
  assert.equal(teachingContext(profile, game, { moveNo: 6, lastChildMove: last }).lastChildCapture, false);
  assert.equal(teachingContext(profile, game, { moveNo: 6, lastChildMove: null }).lastChildCapture, false);
  // only the boolean true counts: a truthy value of another type is not a capture
  for (const other of [1, 'true', {}, null, undefined]) {
    assert.equal(teachingContext(profile, game, { moveNo: 6, lastChildMove: last, lastChildCapture: other }).lastChildCapture, false, String(other));
  }
  // the field is always a boolean, the move is passed on as it came, and the input is not changed
  const extra = { moveNo: 6, lastChildMove: last, lastChildCapture: true };
  const frozen = structuredClone(extra);
  const ctx = teachingContext(profile, game, extra);
  assert.equal(typeof ctx.lastChildCapture, 'boolean');
  assert.equal(ctx.lastChildMove, last);
  assert.deepEqual(extra, frozen);
});

test('tactics counters and revealFor: ten found tier-2 tests lift a level-3 profile to reveal 4', t => {
  t.mock.method(Date, 'now', () => 1790000000000);
  // priors only (4.7.3): below about 3.8 reveal 2, up to about 6.5 reveal 4, above reveal 6
  assert.deepEqual([1, 2, 3, 3.7, 3.9, 5, 6.5, 6.7, 7, 9].map(level => revealFor(profileOf({ level }))), [2, 2, 2, 2, 4, 4, 4, 6, 6, 6]);
  // findRate = (found + 4 * P0) / (seen + 4); P0 at the anchors and between them
  const P0 = { 1: [0.50, 0.10, 0.02], 3: [0.70, 0.25, 0.05], 5: [0.85, 0.50, 0.15], 7: [0.95, 0.75, 0.40], 9: [0.98, 0.90, 0.70] };
  for (const [level, row] of Object.entries(P0)) {
    for (const tier of [1, 2, 3]) near(findRate(profileOf({ level: Number(level) }), tier), row[tier - 1], 1e-12, `P0(${level}, ${tier})`);
  }
  near(findRate(profileOf({ level: 4 }), 2), 0.375);
  near(findRate(profileOf({ level: 6, tactics: { seen: [0, 0, 6], found: [0, 0, 3] } }), 3), (3 + 4 * 0.275) / 10);

  // a level-3 profile; ten found tier-2 tests in one game. The accuracy 0.81 = E(3) keeps the level where it is.
  const profile = profileOf({ level: 3, games: 5 });
  assert.equal(revealFor(profile), 2);
  near(findRate(profile, 2), 0.25);
  let game = createGameSkill(1);
  for (let i = 0; i < 10; i++) game = recordChildMove(profile, game, sample(2 * i, { first: { loss: 57, cat: 'good' }, test: { tier: 2, kind: 'win', found: true } }));
  const fin = finishGame(profile, game, 'win');
  near(fin.profile.level, 3, 1e-9);
  let counter = 0;
  for (let i = 0; i < 10; i++) counter = 0.97 * counter + 1;
  near(fin.profile.tactics.seen[1], counter, 1e-12);
  near(fin.profile.tactics.found[1], counter, 1e-12);
  assert.deepEqual([fin.profile.tactics.seen[0], fin.profile.tactics.seen[2], fin.profile.tactics.found[0], fin.profile.tactics.found[2]], [0, 0, 0, 0]);
  near(findRate(fin.profile, 2), (counter + 1) / (counter + 4), 1e-9);
  assert.equal(revealFor(fin.profile), 4);
  assert.equal(teachingContext(fin.profile, createGameSkill(2), { moveNo: 1, lastChildMove: null }).reveal, 4);
  assert.deepEqual(profile.tactics, { seen: [0, 0, 0], found: [0, 0, 0] }, 'the input profile is not changed');

  // missed tests count as seen only; the counters decay in the order the tests were met
  game = createGameSkill(1);
  const tests = [[1, true], [1, false], [3, false], [1, true], [3, true]];
  for (let i = 0; i < 8; i++) {
    const [tier, found] = tests[i] ?? [null, false];
    game = recordChildMove(profile, game, sample(2 * i, { first: { loss: 57, cat: 'good' }, test: tier ? { tier, kind: 'save', found } : null }));
  }
  const mixed = finishGame(profile, game, 'draw').profile.tactics;
  near(mixed.seen[0], (1 * 0.97 + 1) * 0.97 + 1, 1e-12);
  near(mixed.found[0], (1 * 0.97 + 0) * 0.97 + 1, 1e-12);
  near(mixed.seen[2], 1.97, 1e-12);
  near(mixed.found[2], 1, 1e-12);
  assert.equal(mixed.seen[1], 0);

  // the horizon is the highest tier with every tier below it at 0.35 or more: a low tier 2 hides a high tier 3
  assert.equal(revealFor(profileOf({ level: 5, tactics: { seen: [0, 30, 30], found: [0, 0, 30] } })), 2);
  assert.equal(revealFor(profileOf({ level: 9, tactics: { seen: [30, 0, 0], found: [0, 0, 0] } })), 2, 'at least tier 1');
  assert.equal(revealFor(profileOf({ level: 3, tactics: { seen: [0, 20, 20], found: [0, 20, 20] } })), 6);
  // a find rate of exactly 0.35 is inside the horizon (">= 0.35"), in every tier
  const edgeThree = profileOf({ level: 9, tactics: { seen: [0, 0, 4], found: [0, 0, 0] } });
  assert.equal(findRate(edgeThree, 3), 0.35);
  assert.equal(revealFor(edgeThree), 6);
  const edgeOneTwo = profileOf({ level: 1, tactics: { seen: [4, 4, 0], found: [0.8, 2.4, 0] } });
  assert.deepEqual([findRate(edgeOneTwo, 1), findRate(edgeOneTwo, 2)], [0.35, 0.35]);
  assert.equal(revealFor(edgeOneTwo), 4);
});

test('band drift: six ease moves give -0.5; a spar move resets the run; finish counts as press', () => {
  /** Play the modes in order from a fresh game. */
  const play = (modes, game = createGameSkill(1)) => modes.reduce((g, mode, i) => recordOpponentMove(g, 2 * i + 1, choiceOf({ mode })), game);
  const rep = (mode, n) => Array(n).fill(mode);

  assert.equal(play(rep('ease', 5)).drift, 0);
  let game = play(rep('ease', 6));
  assert.equal(game.drift, -0.5);
  assert.equal(game.easeRun, 6);
  assert.equal(game.pressRun, 0);
  assert.equal(play(rep('ease', 11)).drift, -0.5);
  assert.equal(play(rep('ease', 12)).drift, -1);
  assert.equal(play(rep('ease', 36)).drift, -3);
  assert.equal(play(rep('ease', 60)).drift, -3, 'floor -3');

  // a spar move resets the run: five + spar + five gives nothing, the sixth after the reset does
  game = play([...rep('ease', 5), 'spar', ...rep('ease', 5)]);
  assert.equal(game.drift, 0);
  assert.equal(game.easeRun, 5);
  assert.equal(play([...rep('ease', 5), 'spar', ...rep('ease', 6)]).drift, -0.5);
  game = play([...rep('press', 9), 'spar']);
  assert.deepEqual([game.easeRun, game.pressRun, game.drift], [0, 0, 0]);
  // a press move resets the ease run and the other way round
  assert.equal(play([...rep('ease', 5), 'press', ...rep('ease', 5)]).drift, 0);
  assert.equal(play([...rep('press', 9), 'ease', ...rep('press', 9)]).drift, 0);

  // ten press moves give +0.5, and finish counts as press
  assert.equal(play(rep('press', 9)).drift, 0);
  assert.equal(play(rep('press', 10)).drift, 0.5);
  game = play([...rep('press', 5), ...rep('finish', 5)]);
  assert.equal(game.drift, 0.5);
  assert.equal(game.pressRun, 10);
  assert.equal(play(rep('finish', 20)).drift, 1);
  assert.equal(play(rep('press', 40)).drift, 2);
  assert.equal(play(rep('press', 70)).drift, 2, 'ceiling +2');
  // six ease moves after a rise take half a level back
  assert.equal(play([...rep('press', 10), ...rep('ease', 6)]).drift, 0);

  // the drift is part of the effective level
  const profile = profileOf({ level: 4 });
  assert.equal(effectiveLevel(profile, play(rep('ease', 12))), 3);
  assert.equal(effectiveLevel(profile, play(rep('press', 20))), 5);
});

test('recordOpponentMove: sinceChance, chances, sinceBlunder, lastKind, aheadRun, spared and the mark', () => {
  const start = createGameSkill(5);
  assert.deepEqual([start.sinceChance, start.sinceBlunder, start.lastKind, start.aheadRun, start.spared, start.chances], [99, 99, null, 0, 0, 0]);
  const frozen = structuredClone(start);

  let game = recordOpponentMove(start, 1, choiceOf({ kind: 'variety', evalBest: 599 }));
  assert.deepEqual(start, frozen, 'a new object: the input is not changed');
  assert.deepEqual([game.sinceChance, game.sinceBlunder, game.lastKind, game.aheadRun, game.chances], [100, 100, 'variety', 0, 0]);
  game = recordOpponentMove(game, 3, choiceOf({ kind: 'chance', chance: aChance, evalBest: 600 }));
  assert.deepEqual([game.sinceChance, game.lastKind, game.aheadRun, game.chances], [0, 'chance', 1, 1]);
  game = recordOpponentMove(game, 5, choiceOf({ kind: 'honest', evalBest: 900 }));
  assert.deepEqual([game.sinceChance, game.lastKind, game.aheadRun, game.chances], [1, 'honest', 2, 1]);
  game = recordOpponentMove(game, 7, choiceOf({ kind: 'finisher', mode: 'finish', chance: aChance, evalBest: 100 }));
  assert.deepEqual([game.sinceChance, game.lastKind, game.aheadRun, game.chances], [0, 'finisher', 0, 2]);

  // spared counts overlooked mates only
  game = recordOpponentMove(game, 9, choiceOf({ kind: 'overlook', overlooked: { gain: 300, mate: false, line: [] } }));
  assert.equal(game.spared, 0);
  game = recordOpponentMove(game, 11, choiceOf({ kind: 'overlook', overlooked: { gain: 1900, mate: true, line: [] } }));
  assert.equal(game.spared, 1);
  assert.equal(game.chances, 2);

  // sinceBlunder: 0 at a confirmed blunder (the FINAL move counts), +1 per rival move
  const profile = profileOf({ level: 3 });
  game = recordChildMove(profile, game, sample(12, { first: { loss: 0, cat: 'best' }, final: { loss: 600, cat: 'blunder' } }));
  assert.equal(game.sinceBlunder, 0);
  game = recordOpponentMove(game, 13, choiceOf());
  game = recordChildMove(profile, game, sample(14, { first: { loss: 600, cat: 'blunder' }, final: { loss: 0, cat: 'best' } }));
  assert.equal(game.sinceBlunder, 1, 'a blunder that was taken back is not a confirmed blunder');
  game = recordOpponentMove(game, 15, choiceOf());
  assert.equal(game.sinceBlunder, 2);

  // one mark per recorded ply, each a snapshot of the counters after that ply
  assert.deepEqual(game.marks.map(m => m.ply), [1, 3, 5, 7, 9, 11, 12, 13, 14, 15]);
  const last = game.marks.at(-1);
  assert.deepEqual(last, {
    ply: 15, n: game.n, accSum: game.accSum, shift: game.shift, drift: game.drift, easeRun: game.easeRun, pressRun: game.pressRun, aheadRun: game.aheadRun,
    sinceChance: game.sinceChance, sinceBlunder: game.sinceBlunder, lastKind: game.lastKind, spared: game.spared, chances: game.chances,
    missRun: 0, lastRival: 1 + 90 * 0 + 9, samples: 2,
  });
  assert.equal(game.seed, 5);
});

test('rewindGameSkill restores every counter bit-exactly', () => {
  const rnd = mulberry32(20261110);
  const profile = profileOf({ level: 4.3 });
  const modes = ['press', 'spar', 'ease', 'ease', 'finish'];
  const kinds = ['honest', 'variety', 'overlook', 'chance', 'concession', 'finisher'];
  const cats = ['best', 'good', 'ok', 'mistake', 'blunder'];
  /** snapshots[k] = the game after k plies were recorded */
  const snapshots = [createGameSkill(424242)];
  let game = snapshots[0];
  for (let ply = 0; ply < 60; ply++) {
    if (ply % 2 === 0) {
      const loss = Math.floor(rnd() * 5) * 77.7;
      game = recordChildMove(profile, game, sample(ply, {
        hint: Math.floor(rnd() * 4), bestCp: Math.floor(rnd() * 1500) - 750, legalCount: 1 + Math.floor(rnd() * 30),
        first: { loss, cat: cats[Math.floor(rnd() * 5)] }, final: { loss: 0, cat: cats[Math.floor(rnd() * 5)] },
      }));
    } else {
      const kind = kinds[Math.floor(rnd() * 6)];
      // the first seven rival moves ease (a drift step), the last eleven press; in between anything
      const mode = ply < 14 ? 'ease' : ply >= 38 ? 'press' : modes[Math.floor(rnd() * 5)];
      game = recordOpponentMove(game, ply, choiceOf({
        mode, kind, evalBest: Math.floor(rnd() * 1600) - 400,
        chance: kind === 'chance' || kind === 'finisher' ? aChance : null,
        overlooked: kind === 'overlook' ? { gain: 300, mate: rnd() < 0.5, line: [] } : null,
      }));
    }
    snapshots.push(game);
  }
  // the sequence moved every counter at least once, so the comparison below means something
  const end = snapshots[60];
  for (const moved of [g => g.n > 0, g => g.accSum > 0, g => g.shift !== 0, g => g.drift < 0, g => g.pressRun >= 10, g => g.spared > 0, g => g.chances > 0,
                       g => g.sinceChance < 99, g => g.sinceBlunder < 99, g => g.easeRun >= 6, g => g.aheadRun >= 2, g => g.lastKind === 'overlook']) {
    assert.ok(snapshots.some(moved), `the sequence reaches ${moved}`);
  }
  assert.notEqual(snapshots[14].drift, end.drift, 'the drift moved both ways');
  assert.equal(end.marks.length, 60);
  assert.equal(end.samples.length, 30);

  const frozen = structuredClone(end);
  for (let ply = 0; ply <= 60; ply++) {
    assert.deepStrictEqual(rewindGameSkill(end, ply), snapshots[ply], `undo to ply ${ply}`);
    // and from a save: the counters survive JSON bit for bit
    assert.deepStrictEqual(rewindGameSkill(JSON.parse(JSON.stringify(end)), ply), snapshots[ply], `undo to ply ${ply} after a reload`);
  }
  assert.deepStrictEqual(end, frozen, 'the input is not changed');
  assert.deepStrictEqual(rewindGameSkill(end, 1000), end);
  assert.deepStrictEqual(rewindGameSkill(rewindGameSkill(end, 31), 17), snapshots[17]);
  // undo, then play on: the same moves give the same counters again
  let again = rewindGameSkill(end, 58);
  again = recordChildMove(profile, again, end.samples[29]);
  assert.deepStrictEqual(again, snapshots[59]);
  // a sample recorded late (deferred, section 4.25.5) keeps its own ply: undoing the rival's reply keeps it, undoing the move drops it
  let late = recordOpponentMove(recordChildMove(profile, snapshots[58], end.samples[29]), 59, choiceOf());
  assert.deepStrictEqual(rewindGameSkill(late, 59), snapshots[59]);
  assert.deepStrictEqual(rewindGameSkill(late, 58), snapshots[58]);
});

test('recordChildMove keeps the newest 300 samples and never mutates its inputs', () => {
  const profile = profileOf({ level: 5 });
  const frozenProfile = structuredClone(profile);
  let game = createGameSkill(3);
  for (let i = 0; i < 305; i++) {
    const before = game;
    const copy = structuredClone(before);
    game = recordChildMove(profile, before, sample(2 * i));
    if (i % 60 === 0) assert.deepEqual(before, copy);
  }
  assert.equal(game.samples.length, 300);
  assert.equal(game.samples[0].ply, 10);
  assert.equal(game.samples[299].ply, 608);
  assert.equal(game.n, 305, 'the sums keep every sample');
  assert.equal(game.marks.length, 305);
  assert.equal(game.marks.at(-1).samples, 300);
  assert.deepEqual(profile, frozenProfile);
});

// ---------------------------------------------------------------------------------------------------------------
// the teaching opponent: hand-built tables
// ---------------------------------------------------------------------------------------------------------------

/** One winning move (300 cp above every other move from depth 1 on): a tier-1 punishment the rival may overlook. `shift` moves the whole table. */
const oneWinner = (shift = 0) => tableOf([
  flat('0001', 0 + shift, 5, { pv: ['0001', '9091', '0102'] }), flat('1011', -300 + shift), flat('2021', -310 + shift), flat('3031', -320 + shift),
  flat('4041', -330 + shift), flat('5051', -340 + shift),
]);
const asExact = l => ({ ...l, depth: 5, upper: null });

test('press returns the honest move even when an overlook would be possible', async () => {
  // level 1: the band is [+180, +420] (T 300, W 120; T was 80 before CONTRACT-NOTES 104 and 124). With the child at +500 the rival presses.
  const pressed = oneWinner(-500);
  for (let seed = 1; seed <= 300; seed++) {
    const c = await chooseTeachingMove(pressed, ctxOf({ level: 1, reveal: 2, seed }), noVerify);
    assert.equal(c.mode, 'press');
    assert.equal(c.kind, 'honest');
    assert.equal(codeOf(c.move), '0001');
    assert.equal(c.loss, 0);
    assert.equal(c.overlooked, null);
    assert.equal(c.chance, null);
  }
  // the same table inside the band: the level-1 rival misses the punishment in 60 % of the positions
  const inBand = oneWinner(-300);
  const { verify } = verifier({ 1011: inBand.lines[1] });
  const share = await frequency(inBand, ctxOf({ level: 1, reveal: 2 }), verify, c => c.kind === 'overlook' && c.mode === 'spar', 300);
  assert.ok(share > 0.45 && share < 0.75, `overlook share in the band: ${share}`);
  // the edge of the band: +420 is spar, +421 is press
  assert.equal((await chooseTeachingMove(oneWinner(-420), ctxOf({ level: 1, seed: 3 }), verifier({ 1011: asExact(oneWinner(-420).lines[1]) }).verify)).mode, 'spar');
  assert.equal((await chooseTeachingMove(oneWinner(-421), ctxOf({ level: 1, seed: 3 }), noVerify)).mode, 'press');
  // the lower edge: +180 is spar, +179 is ease
  assert.equal((await chooseTeachingMove(oneWinner(-180), ctxOf({ level: 1, seed: 3 }), verifier({ 1011: oneWinner(-180).lines[1] }).verify)).mode, 'spar');
  assert.equal((await chooseTeachingMove(oneWinner(-179), ctxOf({ level: 1, seed: 3 }), verifier({ 1011: oneWinner(-179).lines[1] }).verify)).mode, 'ease');
  // the band moves with bandShift: +500 is inside [280, 520] with a first-game bonus of 100
  assert.equal((await chooseTeachingMove(pressed, ctxOf({ level: 1, bandShift: 100, seed: 3 }), verifier({ 1011: asExact(pressed.lines[1]) }).verify)).mode, 'spar');
});

test('guard rail: press is unchanged; a child ahead of the band meets proper play at every level, whatever else the context says', async () => {
  // The upper edge of the band, T + W. From level 5 up it is the contract's (4.7.5); below, T was raised (level 1: 300 + 120,
  // level 3: 150 + 110). What the rival does above that edge is what 4.7.5 says: his honest move, nothing else.
  const edge = { 1: 420, 2: 340, 3: 260, 4: 200, 5: 140, 6: 125, 7: 110, 8: 95, 9: 80 };
  const contexts = [
    {}, { sinceBlunder: 0 }, { sinceBlunder: 1 }, { sinceBlunder: 2 }, { lastKind: 'overlook' }, { lastKind: 'honest' }, { sinceChance: 0 }, { spared: 0 },
    { lastChildMove: ref('5501'), lastChildCapture: true }, { lastChildMove: ref('5501'), lastChildCapture: false }, { chances: 0 }, { reveal: 6 },
  ];
  for (const [level, top] of Object.entries(edge)) {
    near(levelParams(Number(level)).T + levelParams(Number(level)).W, top, 1e-9, `band edge at level ${level}`);
    // one cp above the band: the punishing move is played, never an overlook, a chance or a concession
    const ahead = oneWinner(-(top + 1));
    for (const over of contexts) {
      for (let seed = 1; seed <= 25; seed++) {
        const c = await chooseTeachingMove(ahead, ctxOf({ level: Number(level), seed, ...over }), noVerify);
        assert.equal(c.mode, 'press', `level ${level}`);
        assert.equal(c.kind, 'honest');
        assert.equal(codeOf(c.move), '0001');
        assert.equal(c.loss, 0);
        assert.equal(c.overlooked, null);
        assert.equal(c.chance, null);
      }
    }
    // exactly on the edge the rival still spars
    const onEdge = oneWinner(-top);
    assert.equal((await chooseTeachingMove(onEdge, ctxOf({ level: Number(level), seed: 3 }), verifier({ 1011: asExact(onEdge.lines[1]) }).verify)).mode, 'spar', `level ${level}`);
  }
  // a mate is delivered in press, also by a level-1 rival that has spared none yet
  const mating = tableOf([line('0001', [-400, MATE - 1, MATE - 1, MATE - 1, MATE - 1]), flat('1011', -400), flat('2021', -450)]);
  for (const level of [1, 2.5, 4, 5, 9]) {
    // the band is pushed far down so that the child counts as ahead although it is being mated
    const c = await chooseTeachingMove(mating, ctxOf({ level, bandShift: -3000 }), noVerify);
    assert.equal(c.mode, 'press');
    assert.equal(codeOf(c.move), '0001');
  }
});

test('the honest move follows honestDepth', async () => {
  // '0001' is best at depth 3 and bad from depth 4 on; '2021' is best at depth 4 and bad from depth 5 on; '1011' is the table's
  // best move (depth 6). Four iterations are all-exact. The child is far ahead (the band is moved down by 200, so that +390
  // is above it at level 1 too), so every level presses.
  const table = tableOf([
    line('1011', [-400, -400, -400, -400, -390, -390]),
    line('0001', [-350, -350, -320, -600, -600, -600]),
    line('2021', [-450, -450, -450, -380, -500, -500]),
    flat('3031', -520, 6),
  ], { allDepth: 4 });
  const pick = async level => {
    const c = await chooseTeachingMove(table, ctxOf({ level, bandShift: -200 }), noVerify);
    assert.equal(c.mode, 'press');
    assert.equal(c.kind, 'honest');
    assert.equal(c.evalBest, 390);
    return c;
  };
  // honestDepth 3 (levels below 2): the depth-3 move
  for (const level of [1, 1.4]) {
    const c = await pick(level);
    assert.equal(codeOf(c.move), '0001', `level ${level} looks 3 deep`);
    assert.equal(c.loss, 210);
    assert.equal(c.evalAfter, 600);
  }
  // honestDepth 4, and 5 read at min(honestDepth, allDepth) = 4: the depth-4 move
  for (const level of [2, 3, 4, 5, 5.9]) {
    const c = await pick(level);
    assert.equal(codeOf(c.move), '2021', `level ${level} looks 4 deep`);
    assert.equal(c.loss, 110);
    assert.equal(c.evalAfter, 500);
  }
  // honestDepth >= the table's depth (6 from level 6 on): the table's best move
  for (const level of [6, 7, 8, 9]) {
    const c = await pick(level);
    assert.equal(codeOf(c.move), '1011', `level ${level} plays the best move`);
    assert.equal(c.loss, 0);
    assert.equal(c.evalAfter, 390);
  }
  // honestDepth is read at min(honestDepth, allDepth): with only three all-exact iterations level 5 falls back to depth 3
  const shallow = tableOf([
    line('1011', [-400, -400, -400, -400, -390, -390]),
    line('0001', [-350, -350, -320], { upper: -600 }),
    line('2021', [-450, -450, -450], { upper: -420 }),
  ]);
  assert.equal(shallow.allDepth, 3);
  const c = await chooseTeachingMove(shallow, ctxOf({ level: 5 }), noVerify);
  assert.equal(codeOf(c.move), '0001');
  assert.equal(c.loss, 210, 'the loss of a line that is not exact comes from its bound');
  assert.equal(c.evalAfter, 600);
  // level 9 plays the table's best move whatever the depth; a table no deeper than honestDepth gives the best move at every level
  assert.equal(codeOf((await chooseTeachingMove(shallow, ctxOf({ level: 9 }), noVerify)).move), '1011');
  const three = tableOf([line('1011', [-400, -400, -390]), line('0001', [-350, -350, -600])]);
  assert.equal(codeOf((await chooseTeachingMove(three, ctxOf({ level: 1, bandShift: -200 }), noVerify)).move), '1011');
});

/**
 * Many quiet moves a few centipawns apart: nothing to overlook, plenty to concede. '9091' is not exact at depth 5: it looks like
 * a 22-cp move (the only one between 15 and 30) and loses 100.
 */
const quietTable = () => tableOf([
  flat('0001', 0), flat('1011', -5), flat('2021', -10), flat('3031', -15), flat('6061', -30), flat('7071', -40),
  line('8081', [0, 0, 0, -60, -60]), line('0010', [0, 0, 0, -80, -80]), line('1020', [-5, -5, -5, -100, -100]),
  line('9091', [0, 0, 0, -22], { upper: -20 }),
]);
const hiddenLoss = line('9091', [0, 0, 0, -22, -100]);

test('spar: over 2000 seeds the loss never exceeds J + 40 and its mean is below J / 2', async () => {
  const table = quietTable();
  assert.deepEqual([table.depth, table.allDepth], [5, 4]);
  for (const level of [5, 1, 3]) {
    const J = levelParams(level).J;
    const { verify, calls } = verifier({ 9091: hiddenLoss });
    let sum = 0, worst = 0, conceded = 0;
    const kinds = new Set();
    for (let seed = 1; seed <= 2000; seed++) {
      const c = await chooseTeachingMove(table, centred(level, { seed }), verify);
      assert.equal(c.mode, 'spar');
      assert.equal(c.evalBest, 0);
      assert.equal(c.evalAfter, c.loss, 'evalAfter = evalBest + loss');
      assert.equal(c.chance, null);
      assert.equal(c.overlooked, null);
      const played = table.lines.find(l => codeOf(l.move) === codeOf(c.move));
      assert.equal(c.loss, 0 - (codeOf(c.move) === '9091' ? hiddenLoss.score : played.score), 'the loss is the true loss of the move played');
      kinds.add(c.kind);
      assert.equal(c.kind === 'concession', c.loss > 0, 'a concession costs something; the honest move is the best one here');
      sum += c.loss;
      worst = Math.max(worst, c.loss);
      if (c.loss > 0) conceded++;
    }
    assert.ok(worst <= J + 40, `level ${level}: worst loss ${worst} > J + 40 = ${J + 40}`);
    assert.ok(sum / 2000 < J / 2, `level ${level}: mean loss ${sum / 2000} >= J / 2 = ${J / 2}`);
    assert.deepEqual([...kinds].sort(), ['concession', 'honest']);
    assert.ok(conceded > 300, `level ${level}: the rival does play small inaccuracies (${conceded} of 2000)`);
    assert.ok(calls.length > 0, 'the line that is not exact was verified before it could be played');
    // most moves are near-best: a wish J * u^2 below 12 cp gives the honest move, which is the best one here: a share of sqrt(12 / J)
    const quiet = await frequency(table, centred(level), verify, c => c.loss === 0 && c.kind === 'honest');
    withinThreeSigma(quiet, Math.sqrt(12 / J), 2000, `level ${level}: share of honest moves`);
  }
  // "never overshoot": with one 70-cp move beside the best one, a level-1 rival (J = 60) plays it only when it wished for more
  // than 35 cp (70 is then nearer to the wish than 0, and within wish + 40): J * u^2 > 35, a share of 1 - sqrt(35 / 60)
  const two = tableOf([flat('0001', 0), line('1011', [0, 0, 0, -70, -70])]);
  const share = await frequency(two, centred(1), noVerify, c => c.loss === 70 && c.kind === 'concession');
  withinThreeSigma(share, 1 - Math.sqrt(35 / 60), 2000, 'share of the 70-cp concession');
  assert.equal(await frequency(two, ctxOf({ level: 5 }), noVerify, c => c.loss === 0), 1, 'level 5 (J = 30) never wishes for 70 - 40 or more');
  // a 90-cp move needs a wish of 50 or more (90 <= wish + 40): a share of 1 - sqrt(50 / 60)
  const ninety = tableOf([flat('0001', 0), line('1011', [0, 0, 0, -90, -90])]);
  withinThreeSigma(await frequency(ninety, centred(1), noVerify, c => c.loss === 90), 1 - Math.sqrt(50 / 60), 2000, 'share of the 90-cp concession');
});

/**
 * The child is 300 behind a level-5 rival (ease; desired = C = 250, ceiling 250, natTol 60). Three chances by provisional loss:
 * '9091' 245 (a hidden blunder: verify shows -700), '8081' 240 (visible only at depth 5), '7071' 200 (visible at depth 3).
 */
const easeTable = () => tableOf([
  flat('0001', 300, 5, { pv: ['0001', '9998'] }), flat('1011', 290), flat('2021', 280), flat('3031', 270),
  line('7071', [300, 300, 100, 100, 100], { pv: ['7071', '6665', '0010', '6564'] }),
  line('8081', [300, 300, 300, 300, 60], { pv: ['8081', '6665'] }),
  line('9091', [300, 300, 300, 55], { upper: 60 }),
]);
const hiddenBlunder = line('9091', [300, 300, 300, 55, -700], { pv: ['9091', '7770'] });

test('ease: a chosen chance has 150 <= loss <= ceiling and revealDepth <= reveal; no chance before gap; a hidden blunder exposed by verify is rejected', async () => {
  const table = easeTable();
  const P = levelParams(5);
  const ceiling = Math.min(P.C, 1.3 * Math.min(P.C, P.T + 300) + 30);
  assert.equal(ceiling, 250);

  for (let seed = 1; seed <= 40; seed++) {
    const { verify, calls } = verifier({ 9091: hiddenBlunder });
    const c = await chooseTeachingMove(table, ctxOf({ seed }), verify);
    assert.equal(c.mode, 'ease');
    assert.equal(c.kind, 'chance');
    // the hidden blunder was looked at first (its provisional loss is nearest to the wish) and thrown out by verify;
    // the depth-5 chance is outside reveal 4; the depth-3 chance is taken
    assert.deepEqual(calls, ['9091']);
    assert.equal(codeOf(c.move), '7071');
    assert.ok(c.loss >= 150 && c.loss <= ceiling);
    assert.equal(c.loss, 200);
    assert.equal(c.evalBest, -300);
    assert.equal(c.evalAfter, -100);
    const rd = revealDepth(c.line.byDepth, c.line.score, 'bad');
    assert.equal(rd, 3);
    assert.ok(rd <= 4);
    assert.deepEqual(c.chance, { gain: 200, points: 2, tier: revealTier(rd), revealDepth: 3, line: ['6665', '0010', '6564'].map(ref) });
    assert.equal(c.overlooked, null);
  }

  // a child who sees three moves deep (reveal 6) gets the deeper chance; one who sees only captures (reveal 2) gets none
  let c = await chooseTeachingMove(table, ctxOf({ reveal: 6 }), verifier({ 9091: hiddenBlunder }).verify);
  assert.equal(codeOf(c.move), '8081');
  assert.deepEqual(c.chance, { gain: 240, points: 2.4, tier: 3, revealDepth: 5, line: [ref('6665')] });
  c = await chooseTeachingMove(table, ctxOf({ reveal: 2 }), verifier({ 9091: hiddenBlunder }).verify);
  assert.equal(c.kind, 'concession');
  assert.equal(c.chance, null);
  assert.equal(codeOf(c.move), '3031');
  assert.equal(c.loss, 30);

  // no chance before gap (3 at level 5): the rival gives a quiet concession instead, at most 140 cp
  for (const sinceChance of [0, 1, 2]) {
    c = await chooseTeachingMove(table, ctxOf({ sinceChance }), noVerify);
    assert.equal(c.kind, 'concession', `sinceChance ${sinceChance}`);
    assert.equal(c.chance, null);
    assert.ok(c.loss > 0 && c.loss <= 140);
  }
  assert.equal((await chooseTeachingMove(table, ctxOf({ sinceChance: 3 }), verifier({ 9091: hiddenBlunder }).verify)).kind, 'chance');
  // below level 2 the gap is 1 (CONTRACT-NOTES 104; it was 2): one other rival move between two chances is enough there.
  // From level 2 on it is the contract's 2 (and 3 from level 4).
  assert.deepEqual([1, 1.9, 2, 3, 4].map(level => levelParams(level).gap), [1, 1, 2, 2, 3]);
  c = await chooseTeachingMove(table, ctxOf({ level: 1, reveal: 4, sinceChance: 0 }), noVerify);
  assert.equal(c.kind, 'concession', 'level 1, right after a chance: none');
  assert.equal(c.chance, null);
  c = await chooseTeachingMove(table, ctxOf({ level: 1, reveal: 4, sinceChance: 1 }), verifier({ 9091: hiddenBlunder }).verify);
  assert.equal(c.kind, 'chance', 'level 1, one rival move after a chance');
  assert.equal(codeOf(c.move), '7071');
  c = await chooseTeachingMove(table, ctxOf({ level: 2, reveal: 4, sinceChance: 1 }), noVerify);
  assert.equal(c.kind, 'concession', 'level 2 still waits two moves');
  assert.equal(c.chance, null);
  assert.equal((await chooseTeachingMove(table, ctxOf({ level: 2, reveal: 4, sinceChance: 2 }), verifier({ 9091: hiddenBlunder }).verify)).kind, 'chance');

  // the hidden blunder is rejected also when it is the only candidate: nothing worse than the ceiling is ever played
  const only = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270), line('9091', [300, 300, 300, 55], { upper: 60 })]);
  const { verify, calls } = verifier({ 9091: hiddenBlunder });
  c = await chooseTeachingMove(only, ctxOf(), verify);
  assert.deepEqual(calls, ['9091']);
  assert.notEqual(codeOf(c.move), '9091');
  assert.equal(c.kind, 'concession');

  // a chance must look natural: the same loss on a move that is bad at every shallow depth is not offered
  const crude = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270), flat('7071', 100)]);
  c = await chooseTeachingMove(crude, ctxOf(), noVerify);
  assert.equal(c.kind, 'concession');
  assert.equal(codeOf(c.move), '3031');

  // below level 4 a move that only looks best at a glance (static evaluation) is natural too: the greedy capture that loses the piece
  const greedy = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270), flat('7071', 100, 5, { naive: 300, pv: ['7071', '6665'] })]);
  c = await chooseTeachingMove(greedy, ctxOf({ level: 3, reveal: 2 }), noVerify);
  assert.equal(c.mode, 'ease');
  assert.equal(c.kind, 'chance');
  assert.equal(codeOf(c.move), '7071');
  assert.deepEqual(c.chance, { gain: 200, points: 2, tier: 1, revealDepth: 1, line: [ref('6665')] });
  assert.equal((await chooseTeachingMove(greedy, ctxOf({ level: 4, reveal: 2 }), noVerify)).kind, 'concession', 'not from level 4 on');
  assert.equal((await chooseTeachingMove(crude, ctxOf({ level: 3, reveal: 2 }), noVerify)).kind, 'concession', 'and not when the glance sees the loss');

  // naturalness relaxes as the deficit grows: natTol = 40 + (deficit - 300) / 2. A move 80 cp off the top at every shallow depth
  // is offered when the child is 340 behind (T' - eBest = 380, natTol 80) and not when it is 300 behind (natTol 60)
  const offTop = s => tableOf([flat('0001', s), flat('1011', s - 10), flat('2021', s - 20), flat('3031', s - 30),
                               line('7071', [s - 80, s - 80, s - 80, s - 200, s - 200])]);
  c = await chooseTeachingMove(offTop(340), ctxOf(), noVerify);
  assert.equal(c.kind, 'chance');
  assert.equal(codeOf(c.move), '7071');
  assert.equal(c.chance.revealDepth, 4);
  c = await chooseTeachingMove(offTop(300), ctxOf(), noVerify);
  assert.equal(c.kind, 'concession');
  assert.notEqual(codeOf(c.move), '7071');
  // the three numbers of natTol, edge by edge: (rival's score, cp off the top at depths 1-3) -> natural or not
  const offBy = (s, off) => tableOf([flat('0001', s), flat('1011', s - 10), flat('2021', s - 20), flat('3031', s - 30),
                                     line('7071', [s - off, s - off, s - off, s - 200, s - 200])]);
  for (const [s, off, natural] of [[260, 40, true], [260, 41, false], [300, 60, true], [300, 61, false], [340, 80, true], [340, 81, false], [200, 40, true], [200, 41, false]]) {
    c = await chooseTeachingMove(offBy(s, off), ctxOf(), noVerify);
    assert.equal(c.kind, natural ? 'chance' : 'concession', `score ${s}, ${off} cp off the top`);
  }

  // a chance needs a wish of at least 150 cp: a child 120 below the band target gets a quiet concession
  const mild = tableOf([flat('0001', 80), flat('1011', 70), flat('2021', 60), flat('3031', 50), line('7071', [80, 80, -80, -80, -80])]);
  c = await chooseTeachingMove(mild, ctxOf(), noVerify);
  assert.equal(c.mode, 'ease');
  assert.equal(c.kind, 'concession');
  assert.equal(c.loss, 30);
  // the ceiling of a chance is min(C, 1.3 * desired + 30): 238 for a wish of 160 ...
  const wish160 = loss => tableOf([flat('0001', 120), flat('1011', 110), flat('2021', 100), flat('3031', 90), line('7071', [120, 120, 120 - loss, 120 - loss, 120 - loss])]);
  assert.equal((await chooseTeachingMove(wish160(238), ctxOf(), noVerify)).kind, 'chance');
  assert.equal((await chooseTeachingMove(wish160(239), ctxOf(), noVerify)).kind, 'concession');
  assert.equal((await chooseTeachingMove(wish160(150), ctxOf(), noVerify)).kind, 'chance');
  c = await chooseTeachingMove(wish160(149), ctxOf(), noVerify);
  assert.equal(c.kind, 'concession', '149 cp is not a chance');
  assert.equal(c.loss, 30, 'and too much for a quiet concession, which is looked for below 140 cp');
  // ... and never above C (250 at level 5), however far behind the child is
  const farBehind = loss => tableOf([flat('0001', 900), flat('1011', 890), flat('2021', 880), flat('3031', 870), line('7071', [900, 900, 900 - loss, 900 - loss, 900 - loss])]);
  assert.equal((await chooseTeachingMove(farBehind(250), ctxOf(), noVerify)).kind, 'chance');
  assert.equal((await chooseTeachingMove(farBehind(251), ctxOf(), noVerify)).kind, 'concession');
  // below level 5 C is larger (CONTRACT-NOTES 104), but never above the 500 cp that a gift may give up (CONTRACT-NOTES 124 j):
  // 500 at levels 1 to 3 (4.7.5 had 450 and 350), 375 at level 4
  for (const [level, C] of [[1, 500], [2, 500], [3, 500], [4, 375], [4.9, 262.5], [5, 250], [7, 150]]) {
    near(levelParams(level).C, C, 1e-9, `C at level ${level}`);
    const most = Math.floor(C);
    c = await chooseTeachingMove(farBehind(most), ctxOf({ level }), noVerify);
    assert.equal(c.kind, 'chance', `level ${level}: a chance of ${most} cp`);
    assert.equal(c.loss, most);
    c = await chooseTeachingMove(farBehind(most + 1), ctxOf({ level }), noVerify);
    assert.equal(c.kind, 'concession', `level ${level}: never more than C`);
    assert.ok(c.loss <= 140);
  }
  // a move whose provisional loss is below 150 is not a chance candidate, even when verify then shows 160
  // (which is too much for a quiet concession as well)
  const under = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270), line('7071', [300, 300, 300, 180], { upper: 185 })]);
  c = await chooseTeachingMove(under, ctxOf(), verifier({ 7071: line('7071', [300, 300, 300, 180, 140]) }).verify);
  assert.equal(c.kind, 'concession');
  assert.equal(codeOf(c.move), '3031');

  // quiet concessions: the wish is min(desired, 120), so 125 cp is nearer than 100 ...
  const nearWish = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), line('3031', [300, 300, 300, 200, 200]), line('4041', [300, 300, 300, 175, 175])]);
  c = await chooseTeachingMove(nearWish, ctxOf({ sinceChance: 0 }), noVerify);
  assert.equal(c.kind, 'concession');
  assert.equal(c.loss, 125);
  // ... and only moves that look like less than 140 cp are candidates: 145 is nearer to the wish than 60 and is still not played
  const wide = tableOf([flat('0001', 300), flat('1011', 295), flat('2021', 290), flat('3031', 285), line('4041', [300, 300, 300, 155, 155]), line('5051', [300, 300, 300, 240, 240])]);
  c = await chooseTeachingMove(wide, ctxOf({ sinceChance: 0 }), noVerify);
  assert.equal(c.kind, 'concession');
  assert.equal(c.loss, 60);
  // looking natural at depth vmax + 1 is not enough: level 3 has vmax 2, level 5 has vmax 3
  const late = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270), line('7071', [100, 100, 300, 100, 100], { naive: 100 })]);
  assert.equal((await chooseTeachingMove(late, ctxOf({ level: 5 }), noVerify)).kind, 'chance');
  assert.equal((await chooseTeachingMove(late, ctxOf({ level: 3 }), noVerify)).kind, 'concession');

  // a chance is never bigger than C: at level 9 (C = 80) nothing reaches the 150 cp of a chance
  c = await chooseTeachingMove(table, ctxOf({ level: 9, reveal: 6 }), noVerify);
  assert.equal(c.mode, 'ease');
  assert.equal(c.chance, null);
  assert.ok(c.loss <= 80 + 40);
});

test('verification budget: a shallow, undecided verify result ends the loops; a decisive one is used', async () => {
  // the budget runs out while the first candidate is verified (depth 4 of 5, no mate): no chance, no concession, no further call
  const table = easeTable();
  const shallow = line('9091', [300, 300, 300, 55]);
  let { verify, calls } = verifier({ 9091: shallow });
  let c = await chooseTeachingMove(table, ctxOf(), verify);
  assert.deepEqual(calls, ['9091']);
  assert.equal(c.kind, 'honest');
  assert.equal(codeOf(c.move), '0001');
  // a verify result that stopped early on a forced mate is decisive: it is read, and here it is rejected as a blunder
  const mated = line('9091', [300, 300, 300, -(MATE - 4)]);
  ({ verify, calls } = verifier({ 9091: mated }));
  c = await chooseTeachingMove(table, ctxOf(), verify);
  assert.deepEqual(calls, ['9091']);
  assert.equal(c.kind, 'chance');
  assert.equal(codeOf(c.move), '7071');
  // in the concession loop the best fit so far is returned
  const quiet = tableOf([
    flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270),
    line('4041', [300, 300, 300, 185], { upper: 190 }), line('5051', [300, 300, 300, 175], { upper: 180 }), line('6061', [300, 300, 300, 165], { upper: 170 }),
  ]);
  ({ verify, calls } = verifier({ 4041: line('4041', [300, 300, 300, 185, 240]), 5051: line('5051', [300, 300, 300, 175]) }));
  c = await chooseTeachingMove(quiet, ctxOf({ sinceChance: 0 }), verify);      // want 120: candidates by distance are 4041 (115), 5051 (125), 6061 (135)
  assert.deepEqual(calls, ['4041', '5051']);
  assert.equal(c.kind, 'concession');
  assert.equal(codeOf(c.move), '4041');
  assert.equal(c.loss, 60);
  // with budget left, the fit is the candidate whose verified loss is nearest to the wish, not the first acceptable one
  const fits = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270),
                        line('4041', [300, 300, 300, 185], { upper: 190 }), line('5051', [300, 300, 300, 200, 200])]);
  ({ verify, calls } = verifier({ 4041: line('4041', [300, 300, 300, 185, 240]) }));
  c = await chooseTeachingMove(fits, ctxOf({ sinceChance: 0 }), verify);
  assert.deepEqual(calls, ['4041']);
  assert.equal(codeOf(c.move), '5051');
  assert.equal(c.loss, 100);
  // a line that is exact at the table's depth but was not exact in every iteration before it has no full byDepth:
  // it is verified before its reveal depth is read
  const gappy = tableOf([flat('0001', 300), flat('1011', 290), flat('2021', 280), flat('3031', 270), line('7071', [300, 300, 100], { depth: 5, score: 100 })], { allDepth: 3 });
  ({ verify, calls } = verifier({ 7071: line('7071', [300, 300, 100, 100, 100], { pv: ['7071', '6665'] }) }));
  c = await chooseTeachingMove(gappy, ctxOf(), verify);
  assert.deepEqual(calls, ['7071']);
  assert.equal(c.kind, 'chance');
  assert.deepEqual(c.chance, { gain: 200, points: 2, tier: 2, revealDepth: 3, line: [ref('6665')] });
  // the budget is shared by the whole selection: when it goes on the overlook check, no chance and no concession is looked for,
  // not even among moves that need no verification
  const shared = tableOf([flat('0001', 300), line('7071', [300, 300, 100, 100, 100]), flat('1011', 90), flat('2021', 80)]);
  let afterSpent = 0, untouched = 0;
  for (let seed = 1; seed <= 200; seed++) {
    ({ verify, calls } = verifier({ 7071: line('7071', [300, 300, 100, 100]) }));
    c = await chooseTeachingMove(shared, ctxOf({ seed }), verify);
    if (calls.length === 1) {
      afterSpent++;
      assert.equal(c.kind, 'honest', `seed ${seed}: the overlook check used the budget up`);
      assert.equal(codeOf(c.move), '0001');
    } else {
      untouched++;
      assert.equal(calls.length, 0);
      assert.equal(c.kind, 'chance', `seed ${seed}: no overlook was tried, the exact chance needs no verification`);
    }
  }
  assert.ok(afterSpent > 100 && untouched > 20, `both paths occur (${afterSpent}, ${untouched})`);      // p = 0.45 * 1.6 = 0.72
  // a rejected promise (a cancelled job) is passed on, not swallowed
  await assert.rejects(chooseTeachingMove(table, ctxOf(), async () => { throw { cancelled: true }; }), { cancelled: true });
});

test('no concession within two rival moves of a child blunder, and never two in a row', async () => {
  // The rule as re-tuned (CONTRACT-NOTES 104 c): from level 5 up it is the contract's, no gift on the two rival moves after a
  // blunder. Below level 5 only the move that answers the blunder is barred. "Never two in a row" holds at every level.
  const table = easeTable();
  const answers = { 9091: hiddenBlunder };
  const gift = c => c.kind === 'chance' || c.kind === 'concession';
  // from level 5 up, within two rival moves of a blunder: the honest move, whatever the deficit
  for (const level of [5, 6.5, 9]) {
    for (const sinceBlunder of [0, 1]) {
      for (let seed = 1; seed <= 40; seed++) {
        const c = await chooseTeachingMove(table, ctxOf({ level, sinceBlunder, seed }), noVerify);
        assert.equal(c.mode, 'ease');
        assert.equal(c.kind, 'honest', `level ${level}, sinceBlunder ${sinceBlunder}`);
        assert.equal(c.loss, 0);
        assert.equal(c.chance, null);
      }
    }
    assert.ok(gift(await chooseTeachingMove(table, ctxOf({ level, sinceBlunder: 2 }), verifier(answers).verify)), `level ${level}: free again on the third move`);
  }
  assert.equal((await chooseTeachingMove(table, ctxOf({ sinceBlunder: 2 }), verifier(answers).verify)).kind, 'chance');
  // below level 5: the move that answers the blunder is honest (the overlook step alone decides it) ...
  for (const level of [1, 2, 3, 4, 4.99]) {
    for (let seed = 1; seed <= 40; seed++) {
      const c = await chooseTeachingMove(table, ctxOf({ level, reveal: 4, sinceBlunder: 0, seed }), noVerify);
      assert.equal(c.mode, 'ease');
      assert.equal(c.kind, 'honest', `level ${level}: no gift in answer to a blunder`);
      assert.equal(c.loss, 0);
      assert.equal(c.chance, null);
    }
    // ... and the next one may give again (it was barred too before the re-tuning)
    for (const sinceBlunder of [1, 2, 99]) {
      const c = await chooseTeachingMove(table, ctxOf({ level, reveal: 4, sinceBlunder }), verifier(answers).verify);
      assert.equal(c.kind, 'chance', `level ${level}, sinceBlunder ${sinceBlunder}`);
      assert.equal(codeOf(c.move), '7071');
    }
  }
  // ... at every level and also inside the first game's window of the guaranteed chance (rival moves 3 to 6): the move that
  // answers a blunder is never a gift (CONTRACT-NOTES 104 c)
  for (const level of [1, 2, 3, 4.99, 5, 7, 9]) {
    for (const moveNo of [3, 4, 5, 6]) {
      for (let seed = 1; seed <= 10; seed++) {
        const c = await chooseTeachingMove(table, ctxOf({ level, reveal: 2, sinceBlunder: 0, firstGame: true, chances: 0, bandShift: 100, moveNo, seed }), noVerify);
        assert.equal(c.kind, 'honest', `first game, level ${level}, rival move ${moveNo}`);
        assert.equal(c.loss, 0);
        assert.equal(c.chance, null);
      }
    }
  }
  // never two in a row: after a chance or a concession the next move is honest, at every level; other kinds do not block
  for (const level of [1, 3, 4.99, 5, 7, 9]) {
    for (const lastKind of ['chance', 'concession']) {
      for (const sinceBlunder of [1, 2, 99]) {
        const c = await chooseTeachingMove(table, ctxOf({ level, reveal: 4, lastKind, sinceBlunder }), noVerify);
        assert.equal(c.kind, 'honest', `level ${level} after a ${lastKind}`);
        assert.equal(c.loss, 0);
      }
    }
  }
  for (const lastKind of ['honest', 'variety', 'overlook', 'finisher', null]) {
    assert.equal((await chooseTeachingMove(table, ctxOf({ lastKind }), verifier(answers).verify)).kind, 'chance', `after ${lastKind}`);
    assert.equal((await chooseTeachingMove(table, ctxOf({ level: 2, reveal: 4, lastKind }), verifier(answers).verify)).kind, 'chance', `level 2 after ${lastKind}`);
  }
  // the same in the band: no small inaccuracy either
  for (const blocked of [{ sinceBlunder: 1 }, { sinceBlunder: 0 }, { lastKind: 'concession' }, { lastKind: 'chance' }]) {
    const share = await frequency(quietTable(), ctxOf(blocked), noVerify, c => c.kind === 'honest' && c.loss === 0, 300);
    assert.equal(share, 1, JSON.stringify(blocked));
  }
  for (const blocked of [{ sinceBlunder: 0 }, { lastKind: 'concession' }, { lastKind: 'chance' }]) {
    const share = await frequency(quietTable(), centred(3, blocked), noVerify, c => c.kind === 'honest' && c.loss === 0, 300);
    assert.equal(share, 1, `level 3: ${JSON.stringify(blocked)}`);
  }
  const eased = await frequency(quietTable(), centred(3, { sinceBlunder: 1 }), verifier({ 9091: hiddenLoss }).verify, c => c.kind === 'concession', 300);
  assert.ok(eased > 0.2, `level 3, one move after the answer: small inaccuracies are back (${eased})`);

  // through the game counters, from level 5 up: blunder, two honest replies, a chance, an honest move, a concession (the gap
  // forbids a chance), an honest move
  const play = async level => {
    const profile = profileOf({ level, games: 9 });
    let game = createGameSkill(77);
    for (let i = 0; i < 6; i++) game = recordChildMove(profile, game, sample(2 * i, { first: { loss: 300 * (1 - expectedAccuracy(level)), cat: 'good' } }));
    game = recordChildMove(profile, game, sample(12, { first: { loss: 600, cat: 'blunder' } }));
    assert.equal(game.sinceBlunder, 0);
    const kinds = [];
    for (let k = 0; k < 7; k++) {
      const ctx = teachingContext(profile, game, { moveNo: 7 + k, lastChildMove: null });
      assert.ok(ctx.level > level - 1 && ctx.level <= level, `the rival is still about level ${level} (${ctx.level})`);
      const c = await chooseTeachingMove(table, { ...ctx, reveal: 4 }, verifier(answers).verify);
      kinds.push(c.kind);
      game = recordOpponentMove(game, 13 + 2 * k, c);
    }
    return { kinds, game };
  };
  let played = await play(6);
  assert.deepEqual(played.kinds, ['honest', 'honest', 'chance', 'honest', 'concession', 'honest', 'chance']);
  assert.equal(played.game.chances, 2);
  // ... and below level 5: the answer to the blunder is honest, the chance comes one move earlier
  played = await play(4.5);
  assert.deepEqual(played.kinds, ['honest', 'chance', 'honest', 'concession', 'honest', 'chance', 'honest']);
  assert.equal(played.game.chances, 2);
});

test('a fit that gives nothing up is an honest move: a concession always costs something, and only a real one blocks the next', async () => {
  // The child is 300 behind a level-5 rival (ease). Only the best move looks natural (the others are 120 cp off the top at every
  // depth) and there is nothing to overlook (the next move is less than 150 cp behind): the concession loop settles on the best move.
  const bare = tableOf([flat('0001', 300), flat('1011', 180), flat('2021', 170)]);
  for (let seed = 1; seed <= 100; seed++) {
    const c = await chooseTeachingMove(bare, ctxOf({ seed }), noVerify);
    assert.equal(c.mode, 'ease');
    assert.equal(codeOf(c.move), '0001');
    assert.equal(c.loss, 0);
    assert.equal(c.kind, 'honest', 'the best move is not a concession');
    assert.equal(c.chance, null);
  }
  // In the band: with one 70-cp move beside the best one, a level-1 rival (J = 60) settles on the best move for every wish up to
  // 35 cp. All of those are honest moves; the concessions are exactly the 70-cp moves.
  const two = tableOf([flat('0001', 0), line('1011', [0, 0, 0, -70, -70])]);
  let honest = 0, conceded = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const c = await chooseTeachingMove(two, centred(1, { seed }), noVerify);
    assert.equal(c.kind === 'concession', c.loss > 0, `seed ${seed}: kind ${c.kind} with loss ${c.loss}`);
    if (c.kind === 'honest') honest++;
    else conceded++;
    assert.equal(c.loss, c.kind === 'honest' ? 0 : 70);
  }
  withinThreeSigma(honest / 2000, Math.sqrt(35 / 60), 2000, 'share of honest best moves');
  assert.equal(honest + conceded, 2000);

  // When no candidate fits at all, the HONEST move is played, which is not always the best one: a level-1 rival looks three
  // moves deep. '2021' is its depth-3 choice and loses 200; the best move does not look natural at a glance, and '1011' keeps
  // the gap below the 150 cp of an overlook.
  const shortSighted = tableOf([flat('0001', 0), flat('1011', -100), line('2021', [50, 50, 50, -200, -200])]);
  for (let seed = 1; seed <= 200; seed++) {
    const c = await chooseTeachingMove(shortSighted, centred(1, { reveal: 2, seed }), noVerify);
    assert.equal(c.mode, 'spar');
    assert.equal(c.kind, 'honest');
    assert.equal(codeOf(c.move), '2021');
    assert.equal(c.loss, 200);
  }
  // The other way round: when the loop settles on the best move, that move is played, not the depth-3 choice. Here the best
  // move looks natural (30 cp off the top at a glance), so every wish of 12 cp or more ends on it: a share of 1 - sqrt(12 / 60).
  const settles = tableOf([flat('0001', 0), flat('1011', -100), line('2021', [30, 30, 30, -200, -200])]);
  let onBest = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const c = await chooseTeachingMove(settles, centred(1, { reveal: 2, seed }), noVerify);
    assert.equal(c.kind, 'honest');
    assert.equal(c.loss, codeOf(c.move) === '0001' ? 0 : 200);
    assert.ok(['0001', '2021'].includes(codeOf(c.move)));
    if (codeOf(c.move) === '0001') onBest++;
  }
  withinThreeSigma(onBest / 2000, 1 - Math.sqrt(12 / 60), 2000, 'share of wishes that end on the best move');
  // A move that wins outright is never a candidate for giving something back. Four moves win by the repetition rule (seen from
  // depth 4, so there is nothing to overlook and no mate to deliver); the only other move is what a depth-3 player prefers.
  const won = MATE - 103;
  const verdicts = tableOf([
    line('0001', [0, 0, 0, won, won]), line('1011', [0, 0, 0, won, won]), line('2021', [0, 0, 0, won, won]), line('3031', [0, 0, 0, won, won]),
    line('4041', [50, 50, 50, 40, 40]),
  ]);
  for (let seed = 1; seed <= 50; seed++) {
    const c = await chooseTeachingMove(verdicts, ctxOf({ level: 1, reveal: 2, seed }), noVerify);
    assert.equal(c.mode, 'ease');
    assert.equal(c.kind, 'honest');
    assert.equal(codeOf(c.move), '4041', 'the depth-3 move, not a winning line relabelled as a gift');
    assert.equal(c.overlooked, null);
  }

  // Through the game counters: after such a move the rival may give at once; after a real concession it may not.
  const profile = profileOf({ level: 5, games: 9 });
  const at = game => teachingContext(profile, game, { moveNo: 10, lastChildMove: null });
  const nothing = await chooseTeachingMove(bare, at(createGameSkill(77)), noVerify);
  assert.equal(nothing.kind, 'honest');
  let game = recordOpponentMove(createGameSkill(77), 19, nothing);
  assert.equal(game.lastKind, 'honest');
  assert.equal((await chooseTeachingMove(easeTable(), at(game), verifier({ 9091: hiddenBlunder }).verify)).kind, 'chance');
  const real = await chooseTeachingMove(easeTable(), at({ ...createGameSkill(77), sinceChance: 0 }), noVerify);
  assert.equal(real.kind, 'concession');
  assert.ok(real.loss > 0);
  game = recordOpponentMove({ ...createGameSkill(77), sinceChance: 0 }, 19, real);
  const next = await chooseTeachingMove(easeTable(), at(game), noVerify);
  assert.equal(next.kind, 'honest', 'never two concessions in a row');
  assert.equal(next.loss, 0);
});

/**
 * The first game: a level-2 rival, the band shifted by +100 (T' = 325, spar from +210 to +440), the child at +250.
 * '7071' is a tier-1 chance (loss 200, visible at depth 2); '8081' is nearer to the wish but only visible at depth 4.
 */
const firstGameTable = (withTierOne = true) => tableOf([
  flat('0001', -250), flat('1011', -260), flat('2021', -270), flat('3031', -280), flat('4041', -290),
  line('8081', [-250, -250, -250, -430, -430], { pv: ['8081', '6665'] }),
  ...(withTierOne ? [line('7071', [-250, -450, -450, -450, -450], { pv: ['7071', '6665', '0010'] })] : []),
]);

test('first game: a tier-1 chance is offered between rival moves 3 and 6 when one exists; variety covers only moves 1-2', async () => {
  const table = firstGameTable();
  const first = over => ctxOf({ level: 2, reveal: 2, bandShift: 100, firstGame: true, chances: 0, ...over });

  for (const moveNo of [3, 4, 5, 6]) {
    for (let seed = 1; seed <= 50; seed++) {
      const c = await chooseTeachingMove(table, first({ moveNo, seed }), noVerify);
      assert.equal(c.mode, 'spar');
      assert.equal(c.kind, 'chance', `rival move ${moveNo}`);
      assert.equal(codeOf(c.move), '7071');
      assert.deepEqual(c.chance, { gain: 200, points: 2, tier: 1, revealDepth: 2, line: [ref('6665'), ref('0010')] });
    }
  }
  // the guarantee overrides the gap and the rest of the gift rule, and it asks for tier 1 even from a child with a deeper horizon ...
  assert.equal((await chooseTeachingMove(table, first({ moveNo: 4, sinceBlunder: 1, sinceChance: 0, lastKind: 'concession' }), noVerify)).kind, 'chance');
  assert.equal(codeOf((await chooseTeachingMove(table, first({ moveNo: 4, reveal: 6 }), noVerify)).move), '7071');
  // ... but it is never the answer to a blunder (CONTRACT-NOTES 104 c; as 4.7.5 was written it overrode that too): on that move
  // the rival plays as in any other game, with or without something to overlook
  for (const moveNo of [3, 4, 5, 6]) {
    for (let seed = 1; seed <= 50; seed++) {
      const c = await chooseTeachingMove(table, first({ moveNo, sinceBlunder: 0, seed }), noVerify);
      assert.equal(c.mode, 'spar');
      assert.equal(c.kind, 'honest', `rival move ${moveNo} answers a blunder`);
      assert.equal(codeOf(c.move), '0001');
      assert.equal(c.chance, null);
    }
  }
  const slip = tableOf([...firstGameTable().lines.filter(l => codeOf(l.move) !== '0001').map(l => ({ ...l })), flat('0001', 50)]);       // one punishing move, 300 cp clear
  let punished = 0, missed = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = await chooseTeachingMove(slip, first({ moveNo: 4, sinceBlunder: 0, seed }), verifier({ 1011: slip.lines[1] }).verify);
    assert.ok(c.kind === 'honest' || c.kind === 'overlook', `the overlook step alone decides (${c.kind})`);
    assert.equal(c.chance, null);
    if (c.kind === 'honest') punished++;
    else missed++;
    assert.equal(codeOf(c.move), c.kind === 'honest' ? '0001' : '1011');
  }
  assert.ok(punished > 20 && missed > 20, `both happen (${punished} punished, ${missed} missed)`);
  // through the game counters: no tier-1 chance existed on rival move 3, the child blunders on its fourth move; rival move 4
  // is honest and the guaranteed chance comes on move 5
  {
    const profile = profileOf({ level: 2, games: 0 });
    let game = createGameSkill(31);
    for (let k = 0; k < 3; k++) {
      game = recordChildMove(profile, game, sample(2 * k));
      game = recordOpponentMove(game, 2 * k + 1, choiceOf({ kind: k < 2 ? 'variety' : 'honest' }));
    }
    game = recordChildMove(profile, game, sample(6, { first: { loss: 600, cat: 'blunder' } }));
    let ctx = teachingContext(profile, game, { moveNo: 4, lastChildMove: null });
    assert.deepEqual([ctx.firstGame, ctx.chances, ctx.sinceBlunder, ctx.bandShift, ctx.reveal], [true, 0, 0, 100, 2]);
    let c = await chooseTeachingMove(table, ctx, noVerify);
    assert.equal(c.mode, 'spar');
    assert.equal(c.kind, 'honest');
    assert.equal(c.chance, null);
    game = recordOpponentMove(game, 7, c);
    game = recordChildMove(profile, game, sample(8));
    ctx = teachingContext(profile, game, { moveNo: 5, lastChildMove: null });
    assert.deepEqual([ctx.chances, ctx.sinceBlunder], [0, 1]);
    c = await chooseTeachingMove(table, ctx, noVerify);
    assert.equal(c.kind, 'chance');
    assert.equal(codeOf(c.move), '7071');
    assert.equal(recordOpponentMove(game, 9, c).chances, 1);
  }
  // outside moves 3-6, after the chance was given, or in a later game: no chance in the band
  for (const ctx of [first({ moveNo: 7 }), first({ moveNo: 12 }), first({ moveNo: 4, chances: 1 }), first({ moveNo: 5, firstGame: false })]) {
    const share = await frequency(table, ctx, noVerify, c => c.chance === null && c.loss <= levelParams(2).J + 40, 200);
    assert.equal(share, 1);
  }
  // "when one exists": without a tier-1 chance the rival plays honestly; it does not give a quiet concession instead
  for (let seed = 1; seed <= 50; seed++) {
    const c = await chooseTeachingMove(firstGameTable(false), first({ moveNo: 4, seed }), noVerify);
    assert.equal(c.kind, 'honest');
    assert.equal(codeOf(c.move), '0001');
  }

  // variety: uniform among the moves within 25 cp of the best; two moves in the first game, four afterwards
  const near25 = ['0001', '1011', '2021'];
  for (const [ctx, varied] of [[first({ moveNo: 1 }), true], [first({ moveNo: 2 }), true], [first({ moveNo: 3 }), false],
                               [ctxOf({ moveNo: 3 }), true], [ctxOf({ moveNo: 4 }), true], [ctxOf({ moveNo: 5 }), false]]) {
    const counts = {};
    for (let seed = 1; seed <= 600; seed++) {
      const c = await chooseTeachingMove(table, { ...ctx, seed }, noVerify);
      assert.equal(c.kind === 'variety', varied, `rival move ${ctx.moveNo}, first game ${ctx.firstGame}`);
      if (!varied) continue;
      counts[codeOf(c.move)] = (counts[codeOf(c.move)] ?? 0) + 1;
      assert.ok(c.loss <= 25);
      assert.equal(c.chance, null);
    }
    if (varied) {
      assert.deepEqual(Object.keys(counts).sort(), near25);
      for (const code of near25) withinThreeSigma(counts[code] / 600, 1 / 3, 600, `variety share of ${code}`);
    }
  }
  // variety comes before everything else, also in a position the rival would otherwise press or finish
  const ahead = tableOf([flat('0001', -700), flat('1011', -710), flat('2021', -900)]);
  const c = await chooseTeachingMove(ahead, ctxOf({ moveNo: 2, aheadRun: 3 }), noVerify);
  assert.equal(c.kind, 'variety');
  assert.equal(c.mode, 'finish');
});

/** The child's forced mate in `n` after the rival's move, as the rival's score of that move. */
const childMates = n => -(MATE - 2 * n);

test('finisher: at +600 for two decisions the rival picks a line that gives the child a mate within reveal / 2; otherwise a decisive win within reveal; otherwise honest', async () => {
  assert.deepEqual([1, 2, 3].map(n => mateIn(-childMates(n))), [1, 2, 3]);
  const best = flat('0001', -700);
  const quiet = flat('1011', -800);
  const win500 = line('2021', [-700, -700, -1200, -1200, -1200], { pv: ['2021', '6665'] });       // visible at depth 3
  const win800 = line('3031', [-700, -700, -700, -1500, -1500], { pv: ['3031', '6665'] });        // visible at depth 4
  const mate2 = line('4041', [-700, -700, -700, childMates(2), childMates(2)], { pv: ['4041', '6665', '0010', '6564'] });
  const mate1 = line('5051', [-700, childMates(1), childMates(1), childMates(1), childMates(1)], { pv: ['5051', '6665'] });
  const mate3 = line('6061', [-700, -700, -700, -700, childMates(3)], { pv: ['6061', '6665'] });
  const run = (lines, over = {}) => chooseTeachingMove(tableOf(lines), ctxOf({ aheadRun: 1, ...over }), noVerify);

  // mates within reveal / 2, the shortest first
  let c = await run([best, quiet, win500, mate2, mate1]);
  assert.equal(c.mode, 'finish');
  assert.equal(c.kind, 'finisher');
  assert.equal(codeOf(c.move), '5051');
  assert.deepEqual(c.chance, { gain: 1300, points: 13, tier: 1, revealDepth: 2, line: [ref('6665')] });
  assert.equal(c.evalBest, 700);
  assert.equal(c.evalAfter, 2000);
  assert.equal(c.loss, 1300);
  c = await run([best, quiet, win500, mate2]);
  assert.equal(codeOf(c.move), '4041', 'reveal 4: a mate in two');
  assert.deepEqual(c.chance, { gain: 1300, points: 13, tier: 2, revealDepth: 4, line: ['6665', '0010', '6564'].map(ref) });
  assert.equal(codeOf((await run([best, quiet, mate3, mate2], { reveal: 6 })).move), '4041', 'the shorter mate wins');
  assert.equal(codeOf((await run([best, quiet, win500, mate3], { reveal: 6 })).move), '6061', 'reveal 6: a mate in three');
  assert.equal(codeOf((await run([best, quiet, mate2, mate1], { reveal: 2 })).move), '5051', 'reveal 2: a mate in one');

  // otherwise a decisive win (300..900 cp) the child can see within reveal, the biggest first
  c = await run([best, quiet, win500, win800]);
  assert.equal(c.kind, 'finisher');
  assert.equal(codeOf(c.move), '3031');
  assert.deepEqual(c.chance, { gain: 800, points: 8, tier: 2, revealDepth: 4, line: [ref('6665')] });
  // a mate that is too deep for this child is not a "win" either (its loss is above 900), and a win beyond reveal does not count
  c = await run([best, quiet, win500, win800, mate2], { reveal: 2 });
  assert.equal(c.kind, 'honest');
  assert.equal(codeOf(c.move), '0001');
  assert.equal(c.chance, null);
  const win2 = line('2021', [-700, -1200, -1200, -1200, -1200], { pv: ['2021', '6665'] });        // visible at depth 2
  c = await run([best, quiet, win2, win800, mate2], { reveal: 2 });
  assert.equal(codeOf(c.move), '2021');
  assert.deepEqual(c.chance, { gain: 500, points: 5, tier: 1, revealDepth: 2, line: [ref('6665')] });
  // bounds of a "decisive win": 299 is too little, 901 too much
  assert.equal((await run([best, quiet, line('2021', [-700, -700, -999, -999, -999])])).kind, 'honest');
  assert.equal((await run([best, quiet, line('2021', [-700, -700, -1601, -1601, -1601])])).kind, 'honest');
  assert.equal((await run([best, quiet, line('2021', [-700, -700, -1000, -1000, -1000])])).kind, 'finisher');
  assert.equal((await run([best, quiet, line('2021', [-700, -700, -1600, -1600, -1600])])).kind, 'finisher');

  // otherwise honest
  c = await run([best, quiet, flat('2021', -850)]);
  assert.equal(c.mode, 'finish');
  assert.equal(c.kind, 'honest');
  assert.equal(codeOf(c.move), '0001');

  // the trigger: +600 before the move AND at the previous decision
  assert.equal((await run([best, quiet, win500, mate1], { aheadRun: 0 })).mode, 'press');
  assert.equal(codeOf((await run([best, quiet, win500, mate1], { aheadRun: 0 })).move), '0001');
  assert.equal((await run([flat('0001', -599), flat('1011', -800), mate1])).mode, 'press');
  assert.equal((await run([flat('0001', -600), flat('1011', -800), mate1])).mode, 'finish');
  // two decisions in a row at +600, through the game counters
  let game = recordOpponentMove(createGameSkill(1), 1, choiceOf({ evalBest: 650 }));
  assert.equal(teachingContext(profileOf({ games: 5 }), game, { moveNo: 2, lastChildMove: null }).aheadRun, 1);
  game = recordOpponentMove(game, 3, choiceOf({ evalBest: 300 }));
  assert.equal(game.aheadRun, 0);

  // a line that is not exact in the table is verified first; five candidates at most, the biggest provisional losses first
  const unsure = line('4041', [-700, -700, -700, -700], { upper: -650 });
  const table = tableOf([best, quiet, win500, unsure]);
  const { verify, calls } = verifier({ 4041: mate2 });
  c = await chooseTeachingMove(table, ctxOf({ aheadRun: 1 }), verify);
  assert.deepEqual(calls, ['4041']);
  assert.equal(codeOf(c.move), '4041');
  assert.equal(c.chance.gain, 1300);

  // a repetition verdict (|mate| >= 50) is not a mate and not a win: never a finish
  const verdict = line('4041', [-700, -700, -(MATE - 102), -(MATE - 102), -(MATE - 102)]);
  assert.equal(mateIn(MATE - 102), 51);
  c = await run([best, quiet, verdict]);
  assert.equal(c.kind, 'honest');
  assert.equal(codeOf(c.move), '0001');
  // ... also when the verdict would count as a "decisive win" by its size (800 cp here)
  c = await run([flat('0001', -1200), flat('1011', -1300), line('4041', [-1200, -1200, -(MATE - 102), -(MATE - 102), -(MATE - 102)])]);
  assert.equal(c.mode, 'finish');
  assert.equal(c.kind, 'honest');
  assert.equal(codeOf(c.move), '0001');
  // a crack must still look natural at some shallow depth (tolerance 200): a move that is plainly losing at depth 1 is not played
  c = await run([best, quiet, flat('2021', -1200)]);
  assert.equal(c.kind, 'honest');
  // 150 cp off the top at depth 1 is natural enough for a commander under pressure, 250 cp is not
  c = await run([best, quiet, line('5051', [-850, childMates(1), childMates(1), childMates(1), childMates(1)])]);
  assert.equal(c.kind, 'finisher');
  assert.equal(codeOf(c.move), '5051');
  c = await run([best, quiet, line('5051', [-950, childMates(1), childMates(1), childMates(1), childMates(1)])]);
  assert.equal(c.kind, 'honest');
});

/** The rival has a mate in two ('0001'); the best other move keeps +100. */
const mateTable = (score = MATE - 3) => tableOf([
  line('0001', [100, 100, score, score, score], { pv: ['0001', '9091', '0102'] }), flat('1011', 100), flat('2021', 50), flat('3031', 0),
]);

test('spared mates: at most one per game from level 3, two below; x1.5 in the first game', async () => {
  const table = mateTable();
  assert.equal(table.lines[0].mate, 2);
  const answers = { 1011: table.lines[1] };
  const spared = c => c.kind === 'overlook';

  // level 3, the child is being mated (ease): 0.70 * 1.6 is capped at 0.95
  let seenChoice = null;
  let share = await frequency(table, ctxOf({ level: 3 }), verifier(answers).verify, c => {
    if (spared(c)) seenChoice = c;
    return spared(c);
  });
  withinThreeSigma(share, 0.95, 2000, 'level 3, no mate spared yet');
  assert.equal(codeOf(seenChoice.move), '1011');
  assert.deepEqual(seenChoice.overlooked, { gain: 1900, mate: true, line: ['0001', '9091', '0102'].map(ref) });
  assert.equal(seenChoice.loss, 1900);
  assert.equal(seenChoice.evalAfter, -100);
  assert.equal(seenChoice.evalBest, -2000);
  assert.equal(seenChoice.chance, null);
  assert.equal(recordOpponentMove(createGameSkill(1), 1, seenChoice).spared, 1);
  // when the mate is not missed it is delivered
  const delivered = await chooseTeachingMove(table, ctxOf({ level: 3, spared: 1 }), noVerify);
  assert.equal(delivered.kind, 'honest');
  assert.equal(codeOf(delivered.move), '0001');
  assert.equal(delivered.loss, 0);

  // from level 3 up: one spared mate per game
  for (const level of [3, 5, 7]) {
    assert.equal(await frequency(table, ctxOf({ level, spared: 1 }), noVerify, spared, 500), 0, `level ${level}, one mate already spared`);
  }
  // below level 3: a second one, 0.6 times as likely, and never a third
  const p2 = levelParams(2.9).overlook[2] * 1.6 * 0.6;
  near(p2, 0.71 * 1.6 * 0.6);
  share = await frequency(table, ctxOf({ level: 2.9, spared: 1 }), verifier(answers).verify, spared);
  withinThreeSigma(share, p2, 2000, 'level 2.9, second spared mate');
  assert.equal(await frequency(table, ctxOf({ level: 2.9, spared: 2 }), noVerify, spared, 500), 0);
  assert.equal(await frequency(table, ctxOf({ level: 1, spared: 2 }), noVerify, spared, 500), 0);

  // x1.5 in the first game (level 7: 0.20 * 1.6 = 0.32 against 0.48)
  share = await frequency(table, ctxOf({ level: 7 }), verifier(answers).verify, spared);
  withinThreeSigma(share, 0.32, 2000, 'level 7, later game');
  share = await frequency(table, ctxOf({ level: 7, firstGame: true, moveNo: 9 }), verifier(answers).verify, spared);
  withinThreeSigma(share, 0.48, 2000, 'level 7, first game');
  // a mate in one is a tier-1 punishment, a mate in three or more tier 3
  const inOne = tableOf([line('0001', [100, MATE - 1, MATE - 1, MATE - 1, MATE - 1]), flat('1011', 100), flat('2021', 50)]);
  share = await frequency(inOne, ctxOf({ level: 5 }), verifier({ 1011: inOne.lines[1] }).verify, spared);
  withinThreeSigma(share, 0.20 * 1.6, 2000, 'mate in one at level 5');
  const inFour = tableOf([line('0001', [100, 100, 100, 100, MATE - 7]), flat('1011', 100), flat('2021', 50)]);
  share = await frequency(inFour, ctxOf({ level: 7 }), verifier({ 1011: inFour.lines[1] }).verify, spared);
  withinThreeSigma(share, 0.50 * 1.6, 2000, 'mate in four at level 7');
  // level 9 never misses a mate in one; in press the mate is always delivered
  assert.equal(await frequency(inOne, ctxOf({ level: 9 }), noVerify, spared, 500), 0);

  // the missed mate must not turn out to lose: a reply that is mated itself is not played
  const losing = { 1011: line('1011', [100, 100, 100, 100, -(MATE - 4)]) };
  assert.equal(await frequency(table, ctxOf({ level: 3 }), verifier(losing).verify, spared, 300), 0);
  // and a move that verify shows to be a forced win is not an "overlook"
  const winning = { 1011: line('1011', [100, 100, 100, 100, MATE - 5]) };
  assert.equal(await frequency(table, ctxOf({ level: 3 }), verifier(winning).verify, spared, 300), 0);

  // a repetition verdict (|mate| >= 50) is not a mate: it can be overlooked like any win, but it is never a spared mate
  const ban = mateTable(MATE - 103);
  assert.equal(ban.lines[0].mate, 52);
  let overlooked = null;
  share = await frequency(ban, ctxOf({ level: 3, spared: 1 }), verifier({ 1011: ban.lines[1] }).verify, c => {
    if (spared(c)) overlooked = c;
    return spared(c);
  });
  withinThreeSigma(share, 0.95, 2000, 'a repetition verdict at level 3 (tier 2, ease), one mate already spared');
  assert.equal(overlooked.overlooked.mate, false);
  assert.equal(recordOpponentMove({ ...createGameSkill(1), spared: 1 }, 1, overlooked).spared, 1);
  // four moves that all win by the repetition rule: nothing to overlook, and none of them is a "concession"
  const bans = tableOf([flat('0001', MATE - 103), flat('1011', MATE - 103), flat('2021', MATE - 103), flat('3031', MATE - 103), flat('4041', 100)]);
  assert.equal(await frequency(bans, ctxOf(), noVerify, c => c.kind === 'honest' && codeOf(c.move) === '0001' && c.loss === 0, 100), 1);

  // a mate is spared only when the next move is at least 150 cp worse: with the board already worth +1880 the mate is
  // delivered at once, and it is never traded for a chance or a concession
  const crushing = tableOf([line('0001', [1880, 1880, MATE - 3, MATE - 3, MATE - 3]), flat('1011', 1880), flat('2021', 1700)]);
  assert.equal(await frequency(crushing, ctxOf({ level: 1 }), noVerify, c => c.kind === 'honest' && codeOf(c.move) === '0001', 300), 1);
});

test('guard rail: spared mates stay capped by level, two below level 3 and one from there up, also in the first game', async () => {
  // CONTRACT-NOTES 104 d: the cap depends on the level and is at most 1 from level 5 up. The re-tuning left it as 4.7.5 gives it.
  const table = mateTable();
  const inOne = tableOf([line('0001', [100, MATE - 1, MATE - 1, MATE - 1, MATE - 1]), flat('1011', 100), flat('2021', 50)]);
  const spared = c => c.kind === 'overlook';
  for (let level = 1; level <= 9; level += 0.5) {
    const cap = level >= 3 ? 1 : 2;
    assert.ok(level < 5 || cap === 1, 'at most one from level 5 up');
    for (const [t, answers] of [[table, { 1011: table.lines[1] }], [inOne, { 1011: inOne.lines[1] }]]) {
      for (const over of [{}, { firstGame: true }, { bandShift: 2100 }, { lastKind: 'overlook' }, { sinceBlunder: 0 }]) {
        // at the cap, and beyond it: the mate is delivered
        for (const count of [cap, cap + 1, 5]) {
          for (let seed = 1; seed <= 60; seed++) {
            const c = await chooseTeachingMove(t, ctxOf({ level, spared: count, seed, ...over }), noVerify);
            assert.equal(c.kind, 'honest', `level ${level}, ${count} spared`);
            assert.equal(codeOf(c.move), '0001');
            assert.equal(c.overlooked, null);
          }
        }
      }
      // below the cap a mate can still be spared where the level's table allows it (level 9 never misses a mate in one)
      if (level <= 7) assert.ok(await frequency(t, ctxOf({ level, spared: cap - 1 }), verifier(answers).verify, spared, 300) > 0, `level ${level}: ${cap - 1} spared so far`);
    }
  }
  // through the game counters: the same mate offered move after move is spared at most twice at level 2 and once at levels 3 and 5
  for (const [level, most] of [[1, 2], [2, 2], [2.9, 2], [3, 1], [4, 1], [5, 1], [7, 1]]) {
    for (let seed = 1; seed <= 40; seed++) {
      const profile = profileOf({ level, games: 9 });
      let game = createGameSkill(seed);
      const kinds = [];
      for (let k = 0; k < 6; k++) {
        const ctx = teachingContext(profile, game, { moveNo: 10 + k, lastChildMove: null });
        // every rival move meets a new position (its own fen), as in a game
        const c = await chooseTeachingMove({ ...table, fen: `${FEN} ${k}` }, ctx, verifier({ 1011: table.lines[1] }).verify);
        kinds.push(c.kind);
        game = recordOpponentMove(game, 20 + 2 * k, c);
      }
      assert.ok(game.spared <= most, `level ${level}, seed ${seed}: ${game.spared} mates spared (${kinds.join(' ')})`);
      assert.equal(kinds.filter(k => k === 'overlook').length, game.spared);
      assert.ok(kinds.slice(most).includes('honest'), 'the mate is delivered in the end');
    }
  }
});

test('guard rail: from level 5 up the selection follows section 4.7.5 as written', async () => {
  // CONTRACT-NOTES 104 e. Every number below is the contract's (the table of 4.7.5 between its anchors at levels 5, 7 and 9),
  // computed here without the module. What was re-tuned below level 5 must not reach these levels.
  const contract = { honestDepth: [5, 6, 9], vmax: [3, 4, 4], T: [40, 20, 0], W: [100, 90, 80], J: [30, 20, 10], C: [250, 150, 80], gap: [3, 3, 4],
                     1: [0.20, 0.08, 0], 2: [0.45, 0.20, 0.05], 3: [0.90, 0.50, 0.20] };
  const at = (row, level) => { const x = (level - 5) / 2, i = Math.min(1, Math.floor(x)); return row[i] + (row[i + 1] - row[i]) * (x - i); };
  for (let level = 5; level <= 9; level += 0.25) {
    const p = levelParams(level);
    for (const key of ['T', 'W', 'J', 'C']) near(p[key], at(contract[key], level), 1e-9, `${key} at level ${level}`);
    for (const key of ['vmax', 'gap']) assert.equal(p[key], Math.round(at(contract[key], level)), `${key} at level ${level}`);
    if (level < 9) assert.equal(p.honestDepth, Math.round(at(contract.honestDepth, level)), `honestDepth at level ${level}`);
    for (const tier of [1, 2, 3]) near(p.overlook[tier], at(contract[tier], level), 1e-9, `overlook[${tier}] at level ${level}`);
  }
  // just below level 5 the re-tuned C still shows (level 3 is 500 now: 251.25; with the 350 of 4.7.5 it was 250.5), at level 5 it does not
  near(levelParams(4.99).C, 251.25);
  near(levelParams(5).C, 250);

  const table = easeTable();
  const answers = { 9091: hiddenBlunder };
  const gift = c => c.kind === 'chance' || c.kind === 'concession';
  for (const level of [5, 5.01, 6, 7, 8.5, 9]) {
    // two rival moves without a gift after a blunder (below level 5: one)
    for (const sinceBlunder of [0, 1]) {
      const c = await chooseTeachingMove(table, ctxOf({ level, sinceBlunder }), noVerify);
      assert.equal(c.kind, 'honest', `level ${level}, sinceBlunder ${sinceBlunder}`);
      assert.equal(c.loss, 0);
    }
    assert.ok(gift(await chooseTeachingMove(table, ctxOf({ level, sinceBlunder: 2 }), verifier(answers).verify)), `level ${level}: a gift on the third move`);
    // one spared mate per game
    const mate = mateTable();
    assert.equal(await frequency(mate, ctxOf({ level, spared: 1 }), noVerify, c => c.kind === 'overlook', 200), 0, `level ${level}: a second mate is never spared`);
  }
  assert.equal((await chooseTeachingMove(table, ctxOf({ level: 4.99, sinceBlunder: 1 }), verifier(answers).verify)).kind, 'chance', 'level 4.99 gives one move earlier');
  // the largest chance is the contract's C: 250 at level 5, 200 at level 6, 150 at level 7; from there on C is below the 150 cp of a chance
  const farBehind = loss => tableOf([flat('0001', 900), flat('1011', 890), flat('2021', 880), flat('3031', 870), line('7071', [900, 900, 900 - loss, 900 - loss, 900 - loss])]);
  for (const [level, C] of [[5, 250], [6, 200], [7, 150]]) {
    assert.equal((await chooseTeachingMove(farBehind(C), ctxOf({ level }), noVerify)).kind, 'chance', `level ${level}: ${C} cp`);
    assert.equal((await chooseTeachingMove(farBehind(C + 1), ctxOf({ level }), noVerify)).kind, 'concession', `level ${level}: ${C + 1} cp`);
  }
  for (const level of [7.5, 8, 9]) assert.equal((await chooseTeachingMove(farBehind(150), ctxOf({ level, reveal: 6 }), noVerify)).chance, null, `level ${level}: no chance at all`);
  // the gap between two chances: three rival moves at levels 5 to 7 (four from level 8, where no chance is left to give)
  for (const [level, gap] of [[5, 3], [6, 3], [7, 3]]) {
    assert.equal((await chooseTeachingMove(farBehind(150), ctxOf({ level, sinceChance: gap - 1 }), noVerify)).chance, null, `level ${level}, ${gap - 1} moves after a chance`);
    assert.equal((await chooseTeachingMove(farBehind(150), ctxOf({ level, sinceChance: gap }), noVerify)).kind, 'chance', `level ${level}, ${gap} moves after a chance`);
  }
  assert.deepEqual([5, 6, 7, 7.99, 8, 9].map(level => levelParams(level).gap), [3, 3, 3, 3, 4, 4]);
});

test('a line that the search values as a plain repetition is never offered as a chance', async () => {
  // The child is 400 behind a level-1 rival. '7071' steps back so that the child can bring an earlier position back: the search
  // scores that line -20 for the rival (Appendix A3.4), a "loss" of 420 that no child can cash in. '8081' really loses a piece.
  assert.equal(scoreToCp(-20), -20);
  const rep = line('7071', [400, 400, -20, -20, -20], { pv: ['7071', '5565'] });
  const real = line('8081', [400, 400, 100, 100, 100], { pv: ['8081', '6665'] });
  const quiet = [flat('0001', 400), flat('1011', 390), flat('2021', 380), flat('3031', 370)];
  const low = { level: 1, reveal: 4 };
  // alone, the repetition would be the chance nearest to the wish; it is passed over and the rival gives a quiet concession
  for (let seed = 1; seed <= 40; seed++) {
    const c = await chooseTeachingMove(tableOf([...quiet, rep]), ctxOf({ ...low, seed }), noVerify);
    assert.equal(c.mode, 'ease');
    assert.equal(c.kind, 'concession');
    assert.equal(c.chance, null);
    assert.notEqual(codeOf(c.move), '7071');
  }
  // with a real chance beside it, the real one is offered although the repetition is nearer to the wish
  let c = await chooseTeachingMove(tableOf([...quiet, rep, real]), ctxOf(low), noVerify);
  assert.equal(c.kind, 'chance');
  assert.equal(codeOf(c.move), '8081');
  assert.deepEqual(c.chance, { gain: 300, points: 3, tier: 2, revealDepth: 3, line: [ref('6665')] });
  // one centipawn beside the repetition value the line is an ordinary chance
  for (const score of [-21, -19]) {
    c = await chooseTeachingMove(tableOf([...quiet, line('7071', [400, 400, score, score, score], { pv: ['7071', '5565'] })]), ctxOf(low), noVerify);
    assert.equal(c.kind, 'chance', `score ${score}`);
    assert.equal(codeOf(c.move), '7071');
  }
  // a line that is not exact in the table is recognised after verify, and the next candidate is tried
  const unsure = line('7071', [400, 400, 400, 60], { upper: 70 });
  const { verify, calls } = verifier({ 7071: rep });
  c = await chooseTeachingMove(tableOf([...quiet, unsure, line('8081', [400, 400, 150, 150, 150], { pv: ['8081', '6665'] })]), ctxOf(low), verify);
  assert.deepEqual(calls, ['7071']);
  assert.equal(c.kind, 'chance');
  assert.equal(codeOf(c.move), '8081');
  // the same at every level: at level 5 (C = 250) a child 200 behind was offered the repetition as a chance of 220 before
  const five = [flat('0001', 200), flat('1011', 190), flat('2021', 180), flat('3031', 170)];
  for (const level of [3, 5, 7]) {
    c = await chooseTeachingMove(tableOf([...five, line('7071', [200, 200, -20, -20, -20], { pv: ['7071', '5565'] })]), ctxOf({ level }), noVerify);
    assert.equal(c.kind, 'concession', `level ${level}`);
    assert.notEqual(codeOf(c.move), '7071');
  }
  // the first game's guaranteed chance is no exception
  const first = ctxOf({ level: 2, reveal: 2, bandShift: 100, firstGame: true, chances: 0, moveNo: 4 });
  c = await chooseTeachingMove(tableOf([...five, line('7071', [200, -20, -20, -20, -20], { pv: ['7071', '5565'] })]), first, noVerify);
  assert.equal(c.kind, 'honest');
  assert.equal(codeOf(c.move), '0001');
  c = await chooseTeachingMove(tableOf([...five, line('7071', [200, -21, -21, -21, -21], { pv: ['7071', '5565'] })]), first, noVerify);
  assert.equal(c.kind, 'chance', 'the same table with a real loss of 221 cp');
});

test('overlook frequency over 2000 seeds matches the table within three standard deviations; a recapture is overlooked 0.3x as often', async () => {
  // the punishing move stands out at depth 1 (tier 1), at depth 3 (tier 2) or only at depth 5 (tier 3); the child is level with the band
  const others = () => [flat('1011', -300), flat('2021', -310), flat('3031', -320), flat('4041', -330), flat('5051', -340)];
  const tables = {
    1: tableOf([flat('0001', 0), ...others()]),
    2: tableOf([line('0001', [-300, -300, 0, 0, 0]), ...others()]),
    3: tableOf([line('0001', [-300, -300, -300, -300, 0]), ...others()]),
  };
  const expected = { 1: [0.60, 0.90, 1], 3: [0.40, 0.70, 1], 5: [0.20, 0.45, 0.90], 7: [0.08, 0.20, 0.50], 9: [0, 0.05, 0.20] };
  const overlooks = c => c.kind === 'overlook';
  for (const [level, row] of Object.entries(expected)) {
    for (const tier of [1, 2, 3]) {
      const table = tables[tier];
      const p = Math.min(0.95, row[tier - 1]);
      const share = await frequency(table, centred(Number(level)), verifier({ 1011: table.lines[1] }).verify, c => {
        assert.equal(c.mode, 'spar');
        if (overlooks(c)) {
          assert.equal(codeOf(c.move), '1011', 'the best of the other moves is played');
          assert.deepEqual(c.overlooked, { gain: 300, mate: false, line: [ref('0001')] });
          assert.equal(c.loss, 300);
        } else {
          assert.equal(codeOf(c.move), '0001');
        }
        return overlooks(c);
      });
      withinThreeSigma(share, p, 2000, `level ${level}, tier ${tier}`);
    }
  }

  // a true recapture (the child's last move took a piece and the punishing move takes back on that square) is overlooked 0.3
  // times as often (CONTRACT-NOTES 104 b)
  const onto = { lastChildMove: { from: { row: 5, col: 5 }, to: { row: 0, col: 1 } } };
  for (const [level, tier, p] of [[1, 1, 0.60], [3, 2, 0.70], [5, 3, 0.90], [7, 2, 0.20]]) {
    const table = tables[tier];
    const share = await frequency(table, centred(level, { ...onto, lastChildCapture: true }), verifier({ 1011: table.lines[1] }).verify, overlooks);
    withinThreeSigma(share, 0.3 * p, 2000, `recapture at level ${level}, tier ${tier}`);
  }
  // a piece the child simply moved en prise is no recapture: the level's full probability, with the flag false or absent
  // (before the re-tuning this case was treated as a recapture as well)
  for (const [level, tier, p] of [[1, 1, 0.60], [3, 2, 0.70], [5, 3, 0.90], [7, 2, 0.20]]) {
    const table = tables[tier];
    for (const flag of [{ lastChildCapture: false }, {}]) {
      const share = await frequency(table, centred(level, { ...onto, ...flag }), verifier({ 1011: table.lines[1] }).verify, overlooks);
      withinThreeSigma(share, p, 2000, `a piece moved en prise at level ${level}, tier ${tier} (${JSON.stringify(flag)})`);
    }
  }
  // a capture whose punishment lands on another square changes nothing, nor does a capture flag without a move or one that is
  // not the boolean true
  const elsewhere = { lastChildMove: { from: { row: 0, col: 1 }, to: { row: 5, col: 5 } } };
  for (const over of [elsewhere, { ...elsewhere, lastChildCapture: true }, { lastChildMove: null, lastChildCapture: true }, { ...onto, lastChildCapture: 1 }]) {
    const share = await frequency(tables[1], centred(1, over), verifier({ 1011: tables[1].lines[1] }).verify, overlooks);
    withinThreeSigma(share, 0.60, 2000, `not a recapture: ${JSON.stringify(over)}`);
  }
  // behind the band (ease, x1.6) at level 1: a true recapture is missed with 0.60 * 1.6 * 0.3 = 0.288; a piece moved en prise
  // with 0.60 * 1.6 = 0.96, which the cap brings to 0.95
  const behindBand = tableOf([flat('0001', 300), flat('1011', 0), flat('2021', -10), flat('3031', -20)]);
  let share = await frequency(behindBand, ctxOf({ level: 1, ...onto, lastChildCapture: true }), verifier({ 1011: behindBand.lines[1] }).verify, overlooks);
  withinThreeSigma(share, 0.3 * 0.60 * 1.6, 2000, 'a true recapture in ease at level 1');
  share = await frequency(behindBand, ctxOf({ level: 1, ...onto }), verifier({ 1011: behindBand.lines[1] }).verify, overlooks);
  withinThreeSigma(share, 0.95, 2000, 'a piece moved en prise in ease at level 1');

  // 1.6 times as likely when the child is behind the band (ease)
  const behind = tableOf([flat('0001', 300), flat('1011', 0), flat('2021', -10), flat('3031', -20)]);
  share = await frequency(behind, ctxOf({ level: 5, sinceBlunder: 0 }), verifier({ 1011: behind.lines[1] }).verify, c => {
    assert.equal(c.mode, 'ease');
    return overlooks(c);
  });
  withinThreeSigma(share, 0.20 * 1.6, 2000, 'ease at level 5, tier 1');

  // nothing to overlook: more than three winning moves, or the next move is less than 150 cp behind
  const many = tableOf([flat('0001', 0), flat('1011', -10), flat('2021', -20), flat('3031', -30), flat('4041', -300)]);
  assert.equal(await frequency(many, centred(1), noVerify, overlooks, 300), 0);
  const close = tableOf([flat('0001', 0), flat('1011', -149), flat('2021', -310)]);
  assert.equal(await frequency(close, centred(1), noVerify, overlooks, 300), 0);
  const edge = tableOf([flat('0001', 0), flat('1011', -150), flat('2021', -310)]);
  assert.ok(await frequency(edge, centred(1), verifier({ 1011: edge.lines[1] }).verify, overlooks, 300) > 0.4, 'exactly 150 cp behind is enough');
  // a reply that turns out to be mated is never played as an overlook, even where the rival is lost anyway and the
  // 150-cp bound alone would let it pass (the band is pushed up so that the rival eases in a lost position)
  const lost = tableOf([flat('0001', -1500), flat('1011', -1900), flat('2021', -1900)]);
  const lostCtx = ctxOf({ level: 1, bandShift: 2000 });
  assert.equal((await chooseTeachingMove(lost, lostCtx, verifier({ 1011: lost.lines[1] }).verify)).mode, 'ease');
  assert.ok(await frequency(lost, lostCtx, verifier({ 1011: lost.lines[1] }).verify, overlooks, 300) > 0.4);
  assert.equal(await frequency(lost, lostCtx, verifier({ 1011: line('1011', [-1900, -1900, -1900, -1900, -(MATE - 4)]) }).verify, overlooks, 300), 0);
  // verify shows that the "other move" loses far more than the table thought: the punishment is played after all
  const worse = { 1011: line('1011', [-300, -300, -300, -300, -451]) };
  assert.equal(await frequency(tables[1], centred(1), verifier(worse).verify, overlooks, 300), 0);
  const stillFine = { 1011: line('1011', [-300, -300, -300, -300, -450]) };
  assert.ok(await frequency(tables[1], centred(1), verifier(stillFine).verify, overlooks, 300) > 0.4);
});

test('repetition: a line with repeats 2 is never chosen when a non-repeating line within 200 cp exists', async () => {
  // the repeating move is the table's best; fresh moves are 150 cp and more behind
  const lines = gap => [flat('0001', 50, 5, { repeats: 2 }), flat('1011', 50 - gap), flat('2021', 30 - gap), flat('3031', 20 - gap), flat('4041', 10 - gap)];
  const table = tableOf(lines(150));
  const situations = [
    ctxOf({ bandShift: -400 }),                         // press
    ctxOf(),                                            // spar
    ctxOf({ bandShift: 300 }),                          // ease
    ctxOf({ moveNo: 1 }),                               // variety
    ctxOf({ level: 1, reveal: 2 }), ctxOf({ level: 9, reveal: 6 }),
    ctxOf({ bandShift: -400, aheadRun: 2 }),
  ];
  for (const ctx of situations) {
    for (let seed = 1; seed <= 200; seed++) {
      const c = await chooseTeachingMove(table, { ...ctx, seed }, noVerify);
      assert.notEqual(codeOf(c.move), '0001', `mode ${c.mode}, kind ${c.kind}`);
      assert.equal(c.evalBest, 100, 'the best playable move is the best fresh one');
    }
  }
  // 199 cp behind is still "within 200": the repeating move stays out; from 200 cp on it is allowed
  let c = await chooseTeachingMove(tableOf(lines(199)), ctxOf({ bandShift: -400 }), noVerify);
  assert.equal(codeOf(c.move), '1011');
  c = await chooseTeachingMove(tableOf(lines(200)), ctxOf({ bandShift: -400 }), noVerify);
  assert.equal(c.mode, 'press');
  assert.equal(codeOf(c.move), '0001', 'every fresh move is 200 cp or more below: the repetition is playable');
  assert.equal(c.evalBest, -50);

  // a third occurrence only by force
  const third = tableOf([flat('0001', 500, 5, { repeats: 3 }), flat('1011', -900, 5, { repeats: 2 }), flat('2021', -1500)]);
  for (const ctx of situations) {
    for (let seed = 1; seed <= 50; seed++) assert.notEqual(codeOf((await chooseTeachingMove(third, { ...ctx, seed }, noVerify)).move), '0001');
  }
  const forced = tableOf([flat('0001', 0, 5, { repeats: 3 }), flat('1011', -50, 5, { repeats: 4 })]);
  c = await chooseTeachingMove(forced, ctxOf({ bandShift: -400 }), noVerify);
  assert.equal(codeOf(c.move), '0001');
  // one playable move: it is played, in every mode, without a search
  const single = tableOf([flat('0001', 500, 5, { repeats: 3 }), flat('1011', -1500)]);
  for (const ctx of situations) {
    c = await chooseTeachingMove(single, ctx, noVerify);
    assert.equal(codeOf(c.move), '1011');
    assert.equal(c.kind, 'honest');
    assert.equal(c.loss, 0);
  }
  await assert.rejects(chooseTeachingMove(tableOf([], { depth: 0, allDepth: 0 }), ctxOf(), noVerify), RangeError);
});

test('determinism: same seed and fen give the same choice', async () => {
  const table = quietTable();
  const other = tableOf(table.lines, { fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b' });
  const play = (t, seed, over = {}) => chooseTeachingMove(t, ctxOf({ seed, ...over }), verifier({ 9091: hiddenLoss }).verify);
  let differByFen = 0, differBySeed = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const a = await play(table, seed), b = await play(table, seed);
    assert.deepStrictEqual(a, b, `seed ${seed}`);
    // a copy of the table (as it arrives from the worker) and its bookkeeping fields do not matter
    const copy = { ...structuredClone(table), nodes: 12345, timeMs: 678 };
    assert.deepStrictEqual(await play(copy, seed), a);
    if (codeOf((await play(other, seed)).move) !== codeOf(a.move)) differByFen++;
    if (codeOf((await play(table, seed + 1000)).move) !== codeOf(a.move)) differBySeed++;
  }
  assert.ok(differByFen > 10, `another position draws other numbers (${differByFen} of 100 choices differ)`);
  assert.ok(differBySeed > 10, `another game draws other numbers (${differBySeed} of 100 choices differ)`);
  // the opening variety and the overlook are deterministic too
  for (const [t, over, answers] of [[firstGameTable(), { moveNo: 1 }, {}], [oneWinner(-100), { level: 1 }, { 1011: oneWinner(-100).lines[1] }]]) {
    for (let seed = 1; seed <= 30; seed++) {
      const a = await chooseTeachingMove(t, ctxOf({ seed, ...over }), verifier(answers).verify);
      assert.deepStrictEqual(await chooseTeachingMove(t, ctxOf({ seed, ...over }), verifier(answers).verify), a);
    }
  }
  // The capture flag of the recapture rule (CONTRACT-NOTES 104 b, f) is a field of the context like any other: the same
  // context gives the same choice, and the flag draws no random number of its own. With the same seed the true recapture is
  // overlooked only where the piece moved en prise is overlooked too (one draw, compared with 0.18 and with 0.60).
  const slip = oneWinner(-300), onto = { lastChildMove: ref('5501') };      // level 1: the child at +300 is in the middle of the band
  const slipAnswer = { 1011: slip.lines[1] };
  let recaptureMissed = 0, enPriseMissed = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const kinds = {};
    for (const lastChildCapture of [true, false]) {
      const ctx = ctxOf({ level: 1, seed, ...onto, lastChildCapture });
      const a = await chooseTeachingMove(slip, ctx, verifier(slipAnswer).verify);
      assert.deepStrictEqual(await chooseTeachingMove(structuredClone(slip), structuredClone(ctx), verifier(slipAnswer).verify), a, `seed ${seed}`);
      assert.equal(a.mode, 'spar');
      kinds[lastChildCapture] = a.kind;
    }
    if (kinds.true === 'overlook') {
      recaptureMissed++;
      assert.equal(kinds.false, 'overlook', `seed ${seed}: what is missed as a recapture is missed as a piece en prise`);
    }
    if (kinds.false === 'overlook') enPriseMissed++;
  }
  assert.ok(recaptureMissed > 20 && enPriseMissed > 2 * recaptureMissed, `${recaptureMissed} recaptures and ${enPriseMissed} pieces en prise missed of 300`);
  // the table and the context are not changed
  const frozenTable = structuredClone(table), ctx = ctxOf({ seed: 5 }), frozenCtx = structuredClone(ctx);
  await chooseTeachingMove(table, ctx, verifier({ 9091: hiddenLoss }).verify);
  assert.deepStrictEqual(table, frozenTable);
  assert.deepStrictEqual(ctx, frozenCtx);
});

// ---------------------------------------------------------------------------------------------------------------
// naturalness rails (CONTRACT-NOTES 124): the rival must not look as if he were throwing the game
// ---------------------------------------------------------------------------------------------------------------

/**
 * Black (the rival) to move. His rook stands on 50. The child has a horse on 56 and a cannon on 20, both of which that
 * rook can take, and a rook on 91 that can take on 51 and 31. The squares 40 and 51 to 55 are empty.
 */
const RAIL_FEN = '3k5/9/C8/9/9/r5N2/9/9/9/1R3K3 b';
/** The same position with a ROOK of the child on 56. */
const ROOK_FEN = '3k5/9/C8/9/9/r5R2/9/9/9/1R3K3 b';
/** Taking on 56 is worth `gain`; every quiet move keeps +100 or less. The child is far behind: the rival eases off. */
const takingTable = (fen = RAIL_FEN, gain = 500) =>
  tableOf([flat('5056', gain), flat('5051', 100), flat('5052', 90), flat('5053', 80), flat('5054', 70)], { fen });
/** A verify that answers with the table's own line for whatever move it is asked. */
const echo = table => async move => table.lines.find(l => codeOf(l.move) === codeOf(move));
/** The rival's move 40 -> 50 as the game record keeps it: 1 + 90 * from + to, a square being row * 9 + col. */
const LAST_4050 = 1 + 90 * (4 * 9 + 0) + (5 * 9 + 0);

test('rails state: missRun and lastRival live in the game record, its marks and the context; a record saved without them works', () => {
  const start = createGameSkill(3);
  assert.deepEqual([start.missRun, start.lastRival], [0, 0]);

  // an overlook lengthens the run, a gift leaves it as it is, a proper move ends it; lastRival is the move just played
  const steps = [['overlook', 1], ['overlook', 2], ['chance', 2], ['concession', 2], ['overlook', 3], ['honest', 0], ['overlook', 1], ['variety', 0],
                 ['overlook', 1], ['finisher', 0]];
  let game = start;
  steps.forEach(([kind, want], i) => {
    game = recordOpponentMove(game, 2 * i + 1, choiceOf({
      kind, move: ref(`${i}0${i}1`), chance: kind === 'chance' || kind === 'finisher' ? aChance : null,
      overlooked: kind === 'overlook' ? { gain: 300, mate: false, line: [] } : null,
    }));
    assert.equal(game.missRun, want, `missRun after ${kind} (step ${i})`);
    assert.equal(game.lastRival, 1 + 90 * (9 * i) + (9 * i + 1), `lastRival after step ${i}`);
    assert.deepEqual([game.marks.at(-1).missRun, game.marks.at(-1).lastRival], [game.missRun, game.lastRival], 'the mark holds both');
  });
  assert.equal(recordOpponentMove(start, 1, choiceOf({ move: ref('4050') })).lastRival, LAST_4050);
  assert.deepEqual([start.missRun, start.lastRival], [0, 0], 'the input is not changed');

  // a move of the child changes neither; the context carries both; undo restores them
  const profile = profileOf({ level: 2 });
  const afterChild = recordChildMove(profile, game, sample(40));
  assert.deepEqual([afterChild.missRun, afterChild.lastRival], [game.missRun, game.lastRival]);
  assert.deepEqual([afterChild.marks.at(-1).missRun, afterChild.marks.at(-1).lastRival], [game.missRun, game.lastRival]);
  const ctx = teachingContext(profile, game, { moveNo: 11, lastChildMove: null });
  assert.deepEqual([ctx.missRun, ctx.lastRival], [game.missRun, game.lastRival]);
  const undone = rewindGameSkill(game, 6);                           // back to after the chance of step 2 (ply 5)
  assert.deepEqual([undone.missRun, undone.lastRival], [2, 1 + 90 * 18 + 19]);
  assert.deepEqual([rewindGameSkill(game, 0).missRun, rewindGameSkill(game, 0).lastRival], [0, 0]);

  // a record saved before the rails existed has neither field, in the record or in its marks: absent means 0
  const old = JSON.parse(JSON.stringify(game));
  delete old.missRun;
  delete old.lastRival;
  for (const mark of old.marks) {
    delete mark.missRun;
    delete mark.lastRival;
  }
  const revived = reviveGameSkill(old, 3);
  assert.deepStrictEqual(revived, { ...game, missRun: 0, lastRival: 0, marks: game.marks.map(m => ({ ...m, missRun: 0, lastRival: 0 })) });
  // and it plays on even without being revived
  const oldCtx = teachingContext(profile, old, { moveNo: 11, lastChildMove: null });
  assert.deepEqual([oldCtx.missRun, oldCtx.lastRival], [0, 0]);
  assert.equal(recordOpponentMove(old, 41, choiceOf({ kind: 'overlook', overlooked: { gain: 300, mate: false, line: [] } })).missRun, 1);
  assert.equal(recordOpponentMove(old, 41, choiceOf({ kind: 'chance', chance: aChance })).missRun, 0);
  assert.deepEqual([rewindGameSkill(old, 6).missRun, rewindGameSkill(old, 6).lastRival], [0, 0]);
  assert.deepEqual([recordChildMove(profile, old, sample(40)).marks.at(-1).missRun, recordChildMove(profile, old, sample(40)).marks.at(-1).lastRival], [0, 0]);

  // values that cannot be are brought into range
  const saved = JSON.parse(JSON.stringify(game));
  const odd = reviveGameSkill({ ...saved, missRun: -4, lastRival: 1e9 }, 3);
  assert.deepEqual([odd.missRun, odd.lastRival], [0, 8100]);
  const odder = reviveGameSkill({ ...saved, missRun: 'two', lastRival: null }, 3);
  assert.deepEqual([odder.missRun, odder.lastRival], [0, 0]);
  assert.equal(reviveGameSkill({ ...saved, missRun: 2.9 }, 3).missRun, 2);
  // a move that is not on the board leaves no trace
  assert.equal(recordOpponentMove(start, 1, choiceOf({ move: { from: { row: 12, col: 0 }, to: { row: 0, col: 0 } } })).lastRival, 0);
  // and a choice recorded without its move (a minimal object, as a caller may hold after a restore) is still recorded
  for (const move of [undefined, null, {}, { from: { row: 0, col: 0 } }]) {
    const minimal = recordOpponentMove(game, 41, choiceOf({ kind: 'overlook', move, overlooked: { gain: 300, mate: false, line: [] } }));
    assert.deepEqual([minimal.lastRival, minimal.missRun, minimal.lastKind], [0, game.missRun + 1, 'overlook']);
  }
});

test('rail (h): a mate in one is never left unplayed on two rival moves running', async () => {
  const inOne = tableOf([line('0001', [100, MATE - 1, MATE - 1, MATE - 1, MATE - 1]), flat('1011', 100), flat('2021', 50)]);
  assert.equal(inOne.lines[0].mate, 1);
  const spared = c => c.kind === 'overlook';
  for (const level of [1, 2, 3, 4.5]) {
    // his last move was an overlook: the mate is played, whatever else the context says
    for (const over of [{}, { firstGame: true }, { sinceBlunder: 0 }, { missRun: 1 }, { bandShift: 500 }]) {
      for (let seed = 1; seed <= 100; seed++) {
        const c = await chooseTeachingMove(inOne, ctxOf({ level, lastKind: 'overlook', seed, ...over }), noVerify);
        assert.equal(c.kind, 'honest', `level ${level}`);
        assert.equal(codeOf(c.move), '0001');
        assert.equal(c.loss, 0);
        assert.equal(c.overlooked, null);
      }
    }
    // after any other move it can be missed as before
    for (const lastKind of [null, 'honest', 'variety', 'chance', 'concession', 'finisher']) {
      assert.ok(await frequency(inOne, ctxOf({ level, lastKind }), echo(inOne), spared, 300) > 0, `level ${level} after ${lastKind}`);
    }
  }
  // the rail is about a mate in one: a longer mate can be missed again
  const inTwo = mateTable();
  assert.equal(inTwo.lines[0].mate, 2);
  assert.ok(await frequency(inTwo, ctxOf({ level: 1, lastKind: 'overlook' }), echo(inTwo), spared, 300) > 0);

  // through the game record: the same mate in one on six rival moves running
  let sparedOnce = 0;
  for (const level of [1, 2, 2.9]) {
    for (let seed = 1; seed <= 60; seed++) {
      const profile = profileOf({ level, games: 9 });
      let game = createGameSkill(seed);
      const kinds = [];
      for (let k = 0; k < 6; k++) {
        const ctx = teachingContext(profile, game, { moveNo: 10 + k, lastChildMove: null });
        const c = await chooseTeachingMove({ ...inOne, fen: `${FEN} ${k}` }, ctx, echo(inOne));
        kinds.push(c.kind);
        game = recordOpponentMove(game, 20 + 2 * k, c);
      }
      for (let k = 1; k < 6; k++) assert.ok(!(kinds[k] === 'overlook' && kinds[k - 1] === 'overlook'), `level ${level}, seed ${seed}: ${kinds.join(' ')}`);
      assert.ok(game.spared <= 2, 'the cap of the level still holds');
      if (game.spared > 0) sparedOnce++;
    }
  }
  assert.ok(sparedOnce > 100, 'a single miss stays common at these levels');
});

test('rail (i): after two overlooks since his last proper move a piece that is there for the taking is not left again', async () => {
  const table = takingTable();
  const overlooked = c => c.kind === 'overlook';
  // while the run is short the horse is overlooked as the level's table says (level 1, ease: capped at 0.95) ...
  for (const missRun of [undefined, 0, 1]) {
    withinThreeSigma(await frequency(table, ctxOf({ level: 1, sinceBlunder: 0, missRun }), echo(table), overlooked, 1000), 0.95, 1000, `missRun ${missRun}`);
  }
  // ... and after two overlooks it is taken, at every level and whatever else the context says
  for (const level of [1, 2, 3, 4.9, 5, 7]) {
    for (const over of [{ missRun: 2 }, { missRun: 3 }, { missRun: 9 }, { missRun: 2, lastKind: 'chance' }, { missRun: 2, sinceBlunder: 0 }, { missRun: 2, firstGame: true, moveNo: 5 }]) {
      for (let seed = 1; seed <= 60; seed++) {
        const c = await chooseTeachingMove(table, ctxOf({ level, seed, ...over }), noVerify);
        assert.equal(c.kind, 'honest', `level ${level}, ${JSON.stringify(over)}`);
        assert.equal(codeOf(c.move), '5056');
        assert.equal(c.loss, 0);
      }
    }
  }
  // an overlook needs a punishing move that stands out by 150 cp (4.7.5): at 149 there is nothing to overlook
  const small = takingTable(RAIL_FEN, 249);
  assert.equal(await frequency(small, ctxOf({ level: 1, missRun: 0, sinceBlunder: 0 }), noVerify, overlooked, 300), 0);
  assert.equal((await chooseTeachingMove(small, ctxOf({ level: 1, missRun: 2, sinceBlunder: 0 }), noVerify)).kind, 'honest');
  const edge = takingTable(RAIL_FEN, 250);                           // 150 more: a slip, and after two overlooks it is taken
  assert.ok(await frequency(edge, ctxOf({ level: 1, missRun: 1, sinceBlunder: 0 }), echo(edge), overlooked, 300) > 0.8);
  assert.equal(await frequency(edge, ctxOf({ level: 1, missRun: 2, sinceBlunder: 0 }), noVerify, overlooked, 300), 0);
  // the same holds when taking is one of the best moves without standing out: a quiet move ('5055') is as good as taking the
  // horse. Twice he may play neither; the third time he plays one of the two.
  const twoBest = tableOf([flat('5056', 500), flat('5055', 480), flat('5051', 100), flat('5052', 90)], { fen: RAIL_FEN });
  assert.ok(await frequency(twoBest, ctxOf({ level: 1, missRun: 1, sinceBlunder: 0 }), echo(twoBest), overlooked, 300) > 0.8);
  for (let seed = 1; seed <= 100; seed++) {
    const third = await chooseTeachingMove(twoBest, ctxOf({ level: 1, missRun: 2, seed }), noVerify);
    assert.equal(third.kind, 'honest');
    assert.ok(['5056', '5055'].includes(codeOf(third.move)));
  }
  // a punishing move that takes nothing is no piece left hanging: the run does not stop him from overlooking it
  const quietWin = tableOf([flat('5055', 500), flat('5051', 100), flat('5052', 90), flat('5053', 80)], { fen: RAIL_FEN });
  assert.ok(await frequency(quietWin, ctxOf({ level: 1, missRun: 2, sinceBlunder: 0 }), echo(quietWin), overlooked, 300) > 0.8);

  // what he plays instead: his plain move when that takes such a piece or is one of the best moves, else the best move.
  // At level 1 the plain move of ease is the best move of a depth-1 search (the first number of each line).
  const blind = tableOf([flat('5056', 500), line('5051', [600, 100, 100, 100, 100]), flat('5052', 90), flat('5053', 80)], { fen: RAIL_FEN });
  let c = await chooseTeachingMove(blind, ctxOf({ level: 1, missRun: 2 }), noVerify);
  assert.equal(codeOf(c.move), '5056', 'a plain move that takes nothing and is worse gives way to the best move');
  const greedy = tableOf([flat('5056', 500), line('5020', [600, 300, 300, 300, 300]), flat('5051', 100), flat('5052', 90)], { fen: RAIL_FEN });
  c = await chooseTeachingMove(greedy, ctxOf({ level: 1, missRun: 2 }), noVerify);
  assert.equal(codeOf(c.move), '5020', 'a plain move that takes the other piece (worth 200 more than the best quiet move) is played');
  assert.equal(c.kind, 'honest');
  assert.equal(c.loss, 200);

  // Only the overlook step leaves a piece that is there for the taking. The shallow move of ease does not: '5051' looks best
  // at depth 1 and is a quiet move worth 400 less than taking the horse. (verify refuses the overlook, so the plain move is played.)
  const shallow = tableOf([flat('5056', 500), line('5051', [600, 100, 100, 100, 100]), flat('5052', 90), flat('5053', 80)], { fen: RAIL_FEN });
  const refuse = { 5051: line('5051', [600, 100, 100, 100, -(MATE - 4)]) };
  for (const over of [{ sinceBlunder: 0 }, { lastKind: 'chance' }, { lastKind: 'concession', missRun: 1 }]) {
    for (let seed = 1; seed <= 60; seed++) {
      c = await chooseTeachingMove(shallow, ctxOf({ level: 1, seed, ...over }), verifier(refuse).verify);
      assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.loss], ['ease', 'honest', '5056', 0], JSON.stringify(over));
    }
  }
  // the same shallow move is played when nothing is there for the taking (the horse is gone: '5056' is a quiet move)
  const QUIET_FEN = RAIL_FEN.replace('r5N2', 'r8');
  c = await chooseTeachingMove({ ...shallow, fen: QUIET_FEN }, ctxOf({ level: 1, sinceBlunder: 0 }), verifier(refuse).verify);
  assert.deepEqual([c.kind, codeOf(c.move), c.loss], ['honest', '5051', 400]);

  // A piece that one of the best moves wins on the spot while a quiet move is nearly as good ('5055', 70 cp less: taking
  // does not beat it by a pawn, and nothing stands out by 150, so nothing is overlooked here). With no overlook behind him a
  // gift elsewhere is allowed. Once he has overlooked something since his last proper move it is not: an overlook, a gift
  // and a second overlook would leave the same piece three times running.
  const nearly = (fen, pv) => tableOf([
    flat('5056', 500, 5, { pv }), flat('5055', 430), line('5053', [600, 200, 200, 200, 200], { pv: ['5053', '9181'] }), flat('5051', 100), flat('5052', 90),
  ], { fen });
  const free = ['5056', '9181'];                                     // the child does not take back on 56
  const PAWN_FEN = RAIL_FEN.replace('r5N2', 'r5P2');
  for (const fen of [RAIL_FEN, PAWN_FEN]) {
    for (let seed = 1; seed <= 40; seed++) {
      c = await chooseTeachingMove(nearly(fen, free), ctxOf({ level: 1, seed, missRun: 0 }), noVerify);
      assert.deepEqual([c.kind, codeOf(c.move), c.chance.gain], ['chance', '5053', 300], 'no overlook behind him: a gift elsewhere');
      for (const missRun of [1, 2]) {
        c = await chooseTeachingMove(nearly(fen, free), ctxOf({ level: 1, seed, missRun }), noVerify);
        assert.deepEqual([c.kind, codeOf(c.move), c.loss], ['honest', '5056', 0], `after ${missRun} overlook(s) he takes`);
        // also when no gift is due: the shallow move ('5053' looks best at depth 1) gives way to the capture
        c = await chooseTeachingMove(nearly(fen, free), ctxOf({ level: 1, seed, missRun, lastKind: 'chance' }), noVerify);
        assert.deepEqual([c.kind, codeOf(c.move)], ['honest', '5056']);
      }
      c = await chooseTeachingMove(nearly(fen, free), ctxOf({ level: 1, seed, missRun: 0, lastKind: 'chance' }), noVerify);
      assert.deepEqual([c.kind, codeOf(c.move), c.loss], ['honest', '5053', 300], 'no overlook behind him: the shallow move of ease');
    }
  }
  // an even exchange is no piece left hanging: his rook takes a rook on 56 and is taken back. The gift elsewhere stays allowed.
  for (let seed = 1; seed <= 40; seed++) {
    c = await chooseTeachingMove(nearly(ROOK_FEN, ['5056', '9156']), ctxOf({ level: 1, seed, missRun: 1 }), noVerify);
    assert.deepEqual([c.kind, codeOf(c.move)], ['chance', '5053']);
  }
  // a horse for his rook is no gain either (taken back by the child); a rook that is not taken back is
  c = await chooseTeachingMove(nearly(RAIL_FEN, ['5056', '9156']), ctxOf({ level: 1, missRun: 1 }), noVerify);
  assert.deepEqual([c.kind, codeOf(c.move)], ['chance', '5053']);
  c = await chooseTeachingMove(nearly(ROOK_FEN, free), ctxOf({ level: 1, missRun: 1 }), noVerify);
  assert.deepEqual([c.kind, codeOf(c.move)], ['honest', '5056']);
  // a capture that is not one of the best moves (the horse is poisoned: taking it is 400 worse than the quiet '5055') leaves nothing hanging
  const poisoned = tableOf([
    flat('5055', 500), flat('5054', 400), flat('5056', 100, 5, { pv: free }), line('5053', [600, 200, 200, 200, 200], { pv: ['5053', '9181'] }), flat('5051', 100),
  ], { fen: RAIL_FEN });
  c = await chooseTeachingMove(poisoned, ctxOf({ level: 1, missRun: 1 }), noVerify);
  assert.deepEqual([c.kind, codeOf(c.move)], ['chance', '5053']);

  // through the game record, with a child that blunders on every move (no gift is ever due, so the plain move is played
  // whenever he does not overlook) and a shallow move that would leave the horse: it is never left three times running
  {
    const weak = profileOf({ level: 1, games: 9 });
    let plainMoves = 0;
    for (let seed = 1; seed <= 120; seed++) {
      let game = createGameSkill(seed), left = 0;
      for (let k = 0; k < 12; k++) {
        game = recordChildMove(weak, game, sample(20 + 2 * k, { first: { loss: 600, cat: 'blunder' } }));
        const ctx = teachingContext(weak, game, { moveNo: 11 + k, lastChildMove: null });
        assert.deepEqual([ctx.level, ctx.sinceBlunder], [1, 0]);
        const move = await chooseTeachingMove({ ...shallow, fen: `${RAIL_FEN} ${k}` }, ctx, echo(shallow));
        left = codeOf(move.move) === '5056' ? 0 : left + 1;
        assert.ok(left <= 2, `seed ${seed}, rival move ${k}: the horse is left a third time running (${move.kind})`);
        if (move.kind !== 'overlook') {
          plainMoves++;
          assert.deepEqual([move.kind, codeOf(move.move)], ['honest', '5056']);
        }
        game = recordOpponentMove(game, 21 + 2 * k, move);
      }
    }
    assert.ok(plainMoves > 400);
  }

  // through the game record: the horse hangs on nine rival moves running
  const profile = profileOf({ level: 1, games: 9 });
  let twice = 0;
  for (let seed = 1; seed <= 80; seed++) {
    let game = createGameSkill(seed), run = 0;
    for (let k = 0; k < 9; k++) {
      const ctx = teachingContext(profile, game, { moveNo: 10 + k, lastChildMove: null });
      const move = await chooseTeachingMove({ ...table, fen: `${RAIL_FEN} ${k}` }, ctx, echo(table));
      if (run >= 2) {
        twice++;
        assert.equal(move.kind, 'honest', `seed ${seed}, rival move ${k}`);
        assert.equal(codeOf(move.move), '5056');
      }
      assert.ok(move.kind === 'overlook' || move.kind === 'honest', 'no gift while the horse hangs');
      run = move.kind === 'overlook' ? run + 1 : 0;
      game = recordOpponentMove(game, 20 + 2 * k, move);
      assert.equal(game.missRun, run);
    }
  }
  assert.ok(twice > 80, 'the run of two is reached in most games');
});

test('rail (j): a gift never gives up more than 500 cp or a rook for less than a rook, and declining to take a piece is never a gift', async () => {
  // the size: C never exceeds 500, and the chance next to the cap is the last one offered
  for (let level = 1; level <= 9; level += 0.25) assert.ok(levelParams(level).C <= 500, `C at level ${level}`);
  const gift = (loss, pv = ['5053', '9181']) => tableOf([
    flat('5055', 700), flat('5051', 690), flat('5052', 680), flat('5054', 670), line('5053', [700, 700 - loss, 700 - loss, 700 - loss, 700 - loss], { pv }),
  ], { fen: RAIL_FEN });
  const far = { level: 1, bandShift: 400 };                          // the child is 700 behind and far below the band: the wish is as large as C
  let c = await chooseTeachingMove(gift(500), ctxOf(far), noVerify);
  assert.equal(c.kind, 'chance');
  assert.equal(c.chance.gain, 500);
  c = await chooseTeachingMove(gift(501), ctxOf(far), noVerify);
  assert.equal(c.kind, 'concession', '501 cp is no chance at any level');
  assert.notEqual(codeOf(c.move), '5053');

  // a rook for less than a rook: in the line the child's rook takes his rook on 51 and he takes nothing, or too little
  const rookLost = ['5051', '9151'];
  const givesRook = (loss, pv) => tableOf([
    flat('5055', 700), flat('5052', 690), flat('5054', 680), flat('5053', 670), line('5051', [700, 700 - loss, 700 - loss, 700 - loss, 700 - loss], { pv }),
  ], { fen: RAIL_FEN });
  for (let seed = 1; seed <= 40; seed++) {
    c = await chooseTeachingMove(givesRook(400, rookLost), ctxOf({ ...far, seed }), noVerify);
    assert.notEqual(codeOf(c.move), '5051', 'not as a chance');
    assert.equal(c.chance, null);
    c = await chooseTeachingMove(givesRook(100, rookLost), ctxOf({ ...far, seed }), noVerify);
    assert.notEqual(codeOf(c.move), '5051', 'not as a quiet concession either');
  }
  // the same move is a chance when the line loses no rook
  c = await chooseTeachingMove(givesRook(400, ['5051', '9181']), ctxOf(far), noVerify);
  assert.equal(c.kind, 'chance');
  assert.equal(codeOf(c.move), '5051');
  // and when he takes a rook himself along the line (a rook for a rook): his rook on 51 takes the rook on 91 and is taken from 90
  const trade = tableOf([flat('5155', 700), flat('5152', 690), flat('5154', 680), flat('5153', 670),
                         line('5191', [700, 300, 300, 300, 300], { pv: ['5191', '9091'] })], { fen: '3k5/9/C8/9/9/1r4N2/9/9/9/RR3K3 b' });
  c = await chooseTeachingMove(trade, ctxOf(far), noVerify);
  assert.equal(c.kind, 'chance');
  assert.equal(codeOf(c.move), '5191');

  // declining to take: the horse on 56 is there for the taking and a natural move elsewhere would lose 300 at depth 2
  const tempting = fen => tableOf([
    flat(fen === RAIL_FEN ? '5056' : '5055', 500), line('5053', [450, 200, 200, 200, 200], { pv: ['5053', '9181'] }), flat('5051', 100), flat('5052', 90),
  ], { fen });
  const mated = { 5053: line('5053', [450, 200, 200, 200, -(MATE - 4)]) };      // the overlook step is refused, so the gift step decides
  for (let seed = 1; seed <= 60; seed++) {
    c = await chooseTeachingMove(tempting(RAIL_FEN), ctxOf({ level: 1, seed }), verifier(mated).verify);
    assert.equal(c.kind, 'honest', 'while the horse hangs he gives nothing elsewhere');
    assert.equal(codeOf(c.move), '5056');
  }
  // the same table with a quiet best move in the place of the capture: the move elsewhere is offered as a chance
  const QUIET_FEN = RAIL_FEN.replace('r5N2', 'r8');
  let chances = 0;
  for (let seed = 1; seed <= 60; seed++) {
    c = await chooseTeachingMove(tempting(QUIET_FEN), ctxOf({ level: 1, seed }), verifier(mated).verify);
    if (c.kind === 'chance') {
      chances++;
      assert.equal(codeOf(c.move), '5053');
      assert.equal(c.chance.gain, 300);
    }
  }
  assert.ok(chances > 0);
  // "there for the taking" starts at one pawn: taking the horse for 100 cp more than the best quiet move ('5051', +200) rules
  // out a gift elsewhere; for 99 cp more it does not (nothing stands out by 150 here, so nothing is overlooked either)
  const pawnMore = gain => tableOf([
    flat('5056', gain), flat('5051', 200), line('5053', [gain, gain - 160, gain - 160, gain - 160, gain - 160], { pv: ['5053', '9181'] }), flat('5052', 90),
  ], { fen: RAIL_FEN });
  for (let seed = 1; seed <= 40; seed++) {
    c = await chooseTeachingMove(pawnMore(300), ctxOf({ level: 1, seed }), noVerify);
    assert.deepEqual([c.kind, codeOf(c.move)], ['honest', '5056'], 'one pawn more: he takes');
    c = await chooseTeachingMove(pawnMore(299), ctxOf({ level: 1, seed }), noVerify);
    assert.deepEqual([c.kind, codeOf(c.move), c.chance.gain], ['chance', '5053', 160], '99 cp more: a gift elsewhere is allowed');
  }
  // a gift that takes the piece with a loss is still a gift (he takes, badly): only declining is ruled out
  const clumsy = tableOf([flat('5056', 500), line('5020', [480, 300, 300, 300, 300], { pv: ['5020', '9181'] }), flat('5051', 100), flat('5052', 90)], { fen: RAIL_FEN });
  const refused = { 5020: line('5020', [480, 300, 300, 300, -(MATE - 4)]) };
  let took = 0;
  for (let seed = 1; seed <= 60; seed++) {
    c = await chooseTeachingMove(clumsy, ctxOf({ level: 1, seed }), verifier(refused).verify);
    assert.ok(['5056', '5020'].includes(codeOf(c.move)));
    if (c.kind === 'chance') took++;
  }
  assert.ok(took > 0, 'taking the cannon instead (200 worse) is offered as a chance');
});

test('rail (k): a rook that has just taken a piece and can be taken back is always taken back', async () => {
  const table = takingTable(ROOK_FEN, 1000);
  const arrived = ref('9656');                                       // the child's rook came to 56 ...
  const tookThere = { lastChildMove: arrived, lastChildCapture: true };          // ... and took a piece there
  for (const level of [1, 2, 3, 4.9, 5, 7]) {
    for (const over of [{}, { sinceBlunder: 0 }, { firstGame: true, moveNo: 5 }, { lastKind: 'overlook', missRun: 1 }, { bandShift: 300 }]) {
      for (let seed = 1; seed <= 60; seed++) {
        const c = await chooseTeachingMove(table, ctxOf({ level, seed, ...tookThere, ...over }), noVerify);
        assert.equal(c.kind, 'honest', `level ${level}, ${JSON.stringify(over)}`);
        assert.equal(codeOf(c.move), '5056');
      }
    }
  }
  // a rook that simply moved en prise is no recapture: it keeps the level's full probability (CONTRACT-NOTES 104 b)
  const missed = c => c.kind === 'overlook';
  withinThreeSigma(await frequency(table, ctxOf({ level: 1, lastChildMove: arrived, sinceBlunder: 0 }), echo(table), missed, 1000), 0.95, 1000, 'moved en prise');
  // another piece that took and can be taken back is missed at most with the reduced probability: 0.60 * 1.6 * 0.3 at level 1
  const horse = takingTable(RAIL_FEN, 500);
  withinThreeSigma(await frequency(horse, ctxOf({ level: 1, sinceBlunder: 0, ...tookThere }), echo(horse), missed, 2000),
                   levelParams(1).overlook[1] * 1.6 * 0.3, 2000, 'a horse taken back');
  // taking back is one of the best moves but not the best: a move that is as good may be played, a worse one never
  const equal = tableOf([flat('5055', 1030), flat('5056', 1000), flat('5051', 100), flat('5052', 90)], { fen: ROOK_FEN });
  for (let seed = 1; seed <= 60; seed++) {
    const c = await chooseTeachingMove(equal, ctxOf({ level: 1, seed, ...tookThere }), noVerify);
    assert.ok(['5055', '5056'].includes(codeOf(c.move)));
    assert.equal(c.kind, 'honest');
  }
});

test('rail (l): 600 cp or more ahead, the rival does not take his last move back while another move within 200 cp exists', async () => {
  const shuffle = (top, rest = top - 10) =>
    tableOf([flat('5040', top), flat('5051', rest), flat('5052', rest - 40), flat('5053', rest - 90), flat('5054', rest - 100)], { fen: RAIL_FEN });
  const back = c => codeOf(c.move) === '5040';
  const quiet = { lastKind: 'chance' };                              // no gift on this move: his plain move is played
  for (const level of [1, 3, 5, 7, 9]) {
    const table = shuffle(700);
    // 700 ahead: going back to 40 is not played, whatever else the context says
    for (const over of [{}, quiet, { sinceBlunder: 0 }, { firstGame: true, moveNo: 5 }, { missRun: 2 }]) {
      assert.equal(await frequency(table, ctxOf({ level, lastRival: LAST_4050, ...over }), echo(table), back, 150), 0, `level ${level}, ${JSON.stringify(over)}`);
    }
    // the best of the other moves takes its place
    let c = await chooseTeachingMove(table, ctxOf({ level, lastRival: LAST_4050, ...quiet }), echo(table));
    assert.equal(codeOf(c.move), '5051');
    assert.equal(c.evalBest, -690);
    assert.equal(c.loss, 0);
    // it was not his last move, or the record does not know his last move: nothing changes
    for (const lastRival of [undefined, 0, LAST_4050 + 1, 1 + 90 * (5 * 9) + 4 * 9]) {
      c = await chooseTeachingMove(table, ctxOf({ level, lastRival, ...quiet }), echo(table));
      assert.equal(codeOf(c.move), '5040', `level ${level}, lastRival ${lastRival}`);
    }
    // just under 600 ahead he may go back; at exactly 600 he does not
    c = await chooseTeachingMove(shuffle(599), ctxOf({ level, lastRival: LAST_4050, ...quiet }), echo(shuffle(599)));
    assert.equal(codeOf(c.move), '5040');
    c = await chooseTeachingMove(shuffle(600), ctxOf({ level, lastRival: LAST_4050, ...quiet }), echo(shuffle(600)));
    assert.equal(codeOf(c.move), '5051');
    // when every other move is 200 cp or more worse, going back is no shuffle: it stays his best move (evalBest is read from it)
    assert.equal(await frequency(shuffle(900, 701), ctxOf({ level, lastRival: LAST_4050 }), echo(shuffle(900, 701)), back, 150), 0);
    assert.equal((await chooseTeachingMove(shuffle(900, 701), ctxOf({ level, lastRival: LAST_4050 }), echo(shuffle(900, 701)))).evalBest, -701);
    assert.equal((await chooseTeachingMove(shuffle(900, 700), ctxOf({ level, lastRival: LAST_4050 }), echo(shuffle(900, 700)))).evalBest, -900);
  }
  assert.equal(await frequency(shuffle(900, 700), ctxOf({ level: 9, lastRival: LAST_4050 }), noVerify, back, 50), 1, 'level 9 plays it');
  // the only legal move is played even if it goes back
  const forced = tableOf([flat('5040', 700)], { fen: RAIL_FEN });
  assert.equal(codeOf((await chooseTeachingMove(forced, ctxOf({ level: 1, lastRival: LAST_4050 }), noVerify)).move), '5040');

  // A move back that mates is no shuffle and is never left out, although another move keeps +1840 or more (a mate counts
  // 2000 cp, so such a move is "within 200"). With the mate left out the rival would not see it at all: no cap, no rail (h),
  // no level 9 would make him play it.
  for (const second of [1840, 1950]) {
    const mating = tableOf([line('5040', [100, MATE - 1, MATE - 1, MATE - 1, MATE - 1]), flat('5051', second), flat('5052', 1700), flat('5053', 100)], { fen: RAIL_FEN });
    assert.equal(mating.lines[0].mate, 1);
    for (const [level, over] of [[1, { spared: 2 }], [1, { lastKind: 'overlook' }], [2.9, { spared: 2 }], [3, { spared: 1 }], [5, { spared: 1 }], [7, { spared: 1 }], [9, {}]]) {
      for (let seed = 1; seed <= 40; seed++) {
        const c = await chooseTeachingMove(mating, ctxOf({ level, seed, lastRival: LAST_4050, ...over }), noVerify);
        assert.deepEqual([c.kind, codeOf(c.move), c.loss, c.evalBest], ['honest', '5040', 0, -2000], `level ${level}, ${JSON.stringify(over)}, second best ${second}`);
      }
    }
  }
  // where the level and the cap allow it, that mate is missed as any other mate in one would be, and it counts as a spared mate
  const spare = tableOf([line('5040', [100, MATE - 1, MATE - 1, MATE - 1, MATE - 1]), flat('5051', 1840), flat('5052', 1700)], { fen: RAIL_FEN });
  withinThreeSigma(await frequency(spare, ctxOf({ level: 1, lastRival: LAST_4050 }), echo(spare), c => c.kind === 'overlook' && c.overlooked.mate === true && codeOf(c.move) === '5051', 1000),
                   0.95, 1000, 'a mate in one by the move back, level 1, none spared yet');
  // a longer mate by the move back is kept as well
  const inTwoBack = tableOf([line('5040', [100, 100, MATE - 3, MATE - 3, MATE - 3]), flat('5051', 1950), flat('5052', 1800)], { fen: RAIL_FEN });
  assert.equal(codeOf((await chooseTeachingMove(inTwoBack, ctxOf({ level: 5, spared: 1, lastRival: LAST_4050 }), noVerify)).move), '5040');
});

test('ease below level 5: without a gift the rival plays the move of a shallower search; press, spar and mates keep the honest move', async () => {
  // '5051' is the best move from depth 3 on (the honest move of every level here); '5052' looks best at depths 1 and 2
  // and is 50 cp worse; '5053' looks best at depth 1 only. No move stands out by 150, so nothing is overlooked.
  const table = tableOf([
    line('5051', [100, 100, 300, 300, 300]), line('5052', [250, 250, 250, 250, 250]), line('5053', [280, 200, 200, 200, 200]), flat('5054', 190),
  ], { fen: RAIL_FEN });
  const noGift = { lastKind: 'chance' };
  const played = async over => codeOf((await chooseTeachingMove(table, ctxOf({ ...noGift, ...over }), noVerify)).move);
  // ease (the child is 300 behind): depth 1 below level 2, depth 2 up to level 3.5, then the honest move
  assert.equal(await played({ level: 1 }), '5053');
  assert.equal(await played({ level: 1.4 }), '5053');
  assert.equal(await played({ level: 2 }), '5052');
  assert.equal(await played({ level: 3 }), '5052');
  assert.equal(await played({ level: 4 }), '5051');
  for (const level of [5, 6, 7, 9]) assert.equal(await played({ level }), '5051', `level ${level}: as section 4.7.5 has it`);
  let c = await chooseTeachingMove(table, ctxOf({ ...noGift, level: 1 }), noVerify);
  assert.deepEqual([c.mode, c.kind, c.loss, c.evalAfter], ['ease', 'honest', 100, -200]);
  // spar and press: the honest move (depth 3 at level 1), as before
  c = await chooseTeachingMove(table, ctxOf({ ...noGift, level: 1, bandShift: -levelParams(1).T - 300 }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['spar', 'honest', '5051']);
  c = await chooseTeachingMove(table, ctxOf({ ...noGift, level: 1, bandShift: -levelParams(1).T - 600 }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['press', 'honest', '5051']);
  // the move after a blunder and the move after a gift alike
  assert.equal(await played({ level: 1, lastKind: null, sinceBlunder: 0 }), '5053');

  // His own mistakes stay inside what a gift may give up (CONTRACT-NOTES 124 j), as far as the table knows: a move that looks
  // best at depth 1 but gives up more than 500 cp, lets the child repeat, or loses a rook for nothing is passed over for the
  // next best shallow move.
  const on = async t => codeOf((await chooseTeachingMove(t, ctxOf({ ...noGift, level: 1 }), noVerify)).move);
  const tempting = bad => tableOf([line('5055', [100, 100, 300, 300, 300]), bad, line('5053', [280, 200, 200, 200, 200]), flat('5054', 190)], { fen: RAIL_FEN });
  assert.equal(await on(tempting(line('5052', [290, -200, -200, -200, -200]))), '5052', 'a shallow mistake of exactly 500 cp is played');
  assert.equal(await on(tempting(line('5052', [290, -201, -201, -201, -201]))), '5053', '501 cp is not');
  assert.equal(await on(tempting(line('5052', [290, -19, -19, -19, -19]))), '5052');
  assert.equal(await on(tempting(line('5052', [290, -20, -20, -20, -20]))), '5053', 'a line the search values as a repetition is not');
  assert.equal(await on(tempting(line('5051', [290, 250, 250, 250, 250], { pv: ['5051', '9181'] }))), '5051');
  assert.equal(await on(tempting(line('5051', [290, 250, 250, 250, 250], { pv: ['5051', '9151'] }))), '5053', 'a line in which his rook is taken for nothing is not');
  // a move the table knows only by its bound: the bound counts
  assert.equal(await on(tempting(line('5052', [290, 290, 290], { upper: -201 }))), '5053');
  assert.equal(await on(tempting(line('5052', [290, 290, 290], { upper: -200 }))), '5052');
  // a forced mate is played by the honest move, never traded for the shallow one
  const mate = tableOf([line('5051', [100, 100, MATE - 3, MATE - 3, MATE - 3]), flat('5052', 1900), flat('5053', 1890)], { fen: RAIL_FEN });
  c = await chooseTeachingMove(mate, ctxOf({ level: 1, spared: 2 }), noVerify);
  assert.deepEqual([c.kind, codeOf(c.move)], ['honest', '5051']);
});

// ---------------------------------------------------------------------------------------------------------------
// the wrap-up of a long game (CONTRACT-NOTES 143 b)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The numbers of the wrap-up as the simulation left them: from his move 60 on he cracks when the child is level
 * (within half a pawn: -50 cp or better) or ahead; from his move 80 on he presses when he is 250 cp or more ahead.
 * While the child stands below +250 (clear) the crack is a slip: no mate, 500 cp at most, no rook for less than a rook
 * (CONTRACT-NOTES 151).
 */
const WRAP = Object.freeze({ move: 60, ahead: -50, clear: 250, pressMove: 80, behind: 250 });

/** The child stands at `e` cp after the rival's best move ('0001'). With `crack`, '5051' looks as good at depth 1 and lets the child mate at once. */
const aheadTable = (e, crack = true) => tableOf([
  flat('0001', -e), flat('1011', -e - 100),
  ...(crack ? [line('5051', [-e, childMates(1), childMates(1), childMates(1), childMates(1)], { pv: ['5051', '6665'] })] : []),
]);
/** A line that looks as good as the best move at depth 1 and gives the child `gain` cp from depth 2 on. */
const winLine = (e, gain) => line('2021', [-e, -e - gain, -e - gain, -e - gain, -e - gain], { pv: ['2021', '6665'] });
/** The child stands at `e` cp; '2021' gives `gain` cp, visible at depth 2. */
const winTable = (e, gain) => tableOf([flat('0001', -e), flat('1011', -e - 100), winLine(e, gain)]);
/** The child stands at `e` cp; '4041' lets the child mate in two, visible at depth 4. */
const mate2Table = e => tableOf([
  flat('0001', -e), flat('1011', -e - 100),
  line('4041', [-e, -e, -e, childMates(2), childMates(2)], { pv: ['4041', '6665', '0010', '6564'] }),
]);
/**
 * The rival is `b` cp ahead. '5051' is his best move from depth 3 on (the honest move of every level), '5053' looks best
 * at depth 1 (what a level-1 rival plays while he eases off without a gift); nothing stands out by 150, so nothing is overlooked.
 */
const behindTable = b => tableOf([
  line('5051', [b - 200, b - 200, b, b, b]), flat('5052', b - 50), line('5053', [b - 20, b - 100, b - 100, b - 100, b - 100]), flat('5054', b - 110),
], { fen: RAIL_FEN });

test('wrap-up (a): from his move 60 on a child who is level (-50 cp or better) or ahead meets a rival who cracks, whatever aheadRun says; -51 cp and move 59 are as before', async () => {
  const { move, ahead, clear } = WRAP;
  assert.deepEqual([ahead, clear], [-50, 250]);
  // Level 1: T' = 300, the band begins at +180, so the rival eases off against a child who is level. No gift is due (his last move was one).
  const low = over => ctxOf({ level: 1, reveal: 2, lastKind: 'chance', ...over });
  let c = await chooseTeachingMove(aheadTable(ahead), low({ moveNo: move - 1 }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['ease', 'honest', '0001']);
  // the mode is 'finish'; from a level game he does not walk into the mate, though (the slip, in the next test)
  c = await chooseTeachingMove(aheadTable(ahead), low({ moveNo: move }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.chance], ['finish', 'honest', '0001', null]);
  c = await chooseTeachingMove(aheadTable(clear), low({ moveNo: move }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['finish', 'finisher', '5051']);
  assert.deepEqual(c.chance, { gain: 2000 - clear, points: (2000 - clear) / 100, tier: 1, revealDepth: 2, line: [ref('6665')] });
  assert.deepEqual([c.evalBest, c.evalAfter], [clear, 2000]);
  c = await chooseTeachingMove(aheadTable(ahead - 1), low({ moveNo: move }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.evalBest], ['ease', 'honest', '0001', ahead - 1]);
  // on every later move, and aheadRun plays no part
  for (const moveNo of [move + 1, 80, 119]) {
    for (const aheadRun of [0, 1, 5]) {
      assert.equal((await chooseTeachingMove(aheadTable(ahead), low({ moveNo, aheadRun }), noVerify)).mode, 'finish', `move ${moveNo}, aheadRun ${aheadRun}`);
      assert.equal((await chooseTeachingMove(aheadTable(ahead - 1), low({ moveNo, aheadRun }), noVerify)).mode, 'ease', `move ${moveNo}, aheadRun ${aheadRun}`);
    }
  }
  // the finish of section 4.7.6 is what it was before move 60: +600 on two decisions running
  assert.equal((await chooseTeachingMove(aheadTable(600), low({ moveNo: move - 1, aheadRun: 1 }), noVerify)).mode, 'finish');
  assert.equal((await chooseTeachingMove(aheadTable(600), low({ moveNo: move - 1, aheadRun: 0 }), noVerify)).mode, 'press');
  assert.equal((await chooseTeachingMove(aheadTable(600), low({ moveNo: move, aheadRun: 0 }), noVerify)).mode, 'finish');

  // whatever the band says: a level-5 rival spars with a child who is level (the band reaches from -60 to +140) and presses one at +250
  for (const [e, before] of [[ahead, 'spar'], [clear, 'press']]) {
    c = await chooseTeachingMove(winTable(e, 500), ctxOf({ moveNo: move - 1, lastKind: 'chance' }), noVerify);
    assert.deepEqual([c.mode, c.kind, codeOf(c.move)], [before, 'honest', '0001'], `child at ${e}`);
    c = await chooseTeachingMove(winTable(e, 500), ctxOf({ moveNo: move, lastKind: 'chance' }), noVerify);
    assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['finish', 'finisher', '2021'], `child at ${e}`);
  }

  // the finisher step is used as it is once the child is clearly ahead: a mate inside the child's horizon first, else a
  // win of 300 to 900 cp inside it, else his honest move
  c = await chooseTeachingMove(winTable(clear, 900), low({ moveNo: move }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.chance.gain], ['finish', 'finisher', '2021', 900]);
  c = await chooseTeachingMove(winTable(clear, 901), low({ moveNo: move }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['finish', 'honest', '0001']);
  c = await chooseTeachingMove(aheadTable(clear, false), low({ moveNo: move }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.loss, c.chance], ['finish', 'honest', '0001', 0, null]);
  // a mate beyond the child's horizon is no finish: reveal 2 sees a mate in one, not in two
  c = await chooseTeachingMove(mate2Table(clear), low({ moveNo: move }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['finish', 'honest', '0001']);
  c = await chooseTeachingMove(mate2Table(clear), low({ moveNo: move, reveal: 4 }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['finish', 'finisher', '4041']);
});

test('wrap-up (a), the slip: while the child is not clearly ahead (below +250) the crack is no mate, 300 to 500 cp, and no rook for less than a rook; from +250 on it is the finisher as written (CONTRACT-NOTES 151)', async () => {
  const { move, ahead, clear } = WRAP;
  const low = over => ctxOf({ level: 1, reveal: 4, lastKind: 'chance', ...over });
  const pick = async (table, over = {}) => {
    const c = await chooseTeachingMove(table, low({ moveNo: move, ...over }), noVerify);
    return [c.mode, c.kind, codeOf(c.move), c.chance === null ? null : c.chance.gain];
  };
  for (const e of [ahead, 0, 100, clear - 1]) {
    // no mate: neither in one nor in two, though both lie inside the child's horizon
    assert.deepEqual(await pick(aheadTable(e)), ['finish', 'honest', '0001', null], `mate in one, child at ${e}`);
    assert.deepEqual(await pick(mate2Table(e)), ['finish', 'honest', '0001', null], `mate in two, child at ${e}`);
    // the size: 300 to 500 cp
    assert.deepEqual(await pick(winTable(e, 299)), ['finish', 'honest', '0001', null], `299 cp, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 300)), ['finish', 'finisher', '2021', 300], `300 cp, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 500)), ['finish', 'finisher', '2021', 500], `500 cp, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 501)), ['finish', 'honest', '0001', null], `501 cp, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 900)), ['finish', 'honest', '0001', null], `900 cp, child at ${e}`);
    // with a mate and a slip on the table he slips
    assert.deepEqual(await pick(tableOf([...aheadTable(e).lines, winLine(e, 400)])), ['finish', 'finisher', '2021', 400], `mate and slip, child at ${e}`);
  }
  // from +250 on: the mate first, and a win of up to 900 cp
  assert.deepEqual(await pick(aheadTable(clear)), ['finish', 'finisher', '5051', 2000 - clear]);
  assert.deepEqual(await pick(mate2Table(clear)), ['finish', 'finisher', '4041', 2000 - clear]);
  assert.deepEqual(await pick(winTable(clear, 501)), ['finish', 'finisher', '2021', 501]);
  assert.deepEqual(await pick(tableOf([...aheadTable(clear).lines, winLine(clear, 400)])), ['finish', 'finisher', '5051', 2000 - clear]);
  // before move 60 the finish of section 4.7.6 never meets a child below +600, so nothing changes there
  assert.deepEqual(await pick(aheadTable(600), { moveNo: move - 1, aheadRun: 1 }), ['finish', 'finisher', '5051', 1400]);

  // no rook for less than a rook (rail j): in the line the child's rook takes his rook on 51 and he takes nothing
  const rook = (e, pv) => tableOf([flat('5055', -e), flat('5052', -e - 100), line('5051', [-e, -e - 400, -e - 400, -e - 400, -e - 400], { pv })], { fen: RAIL_FEN });
  assert.deepEqual(await pick(rook(ahead, ['5051', '9151'])), ['finish', 'honest', '5055', null]);
  assert.deepEqual(await pick(rook(clear - 1, ['5051', '9151'])), ['finish', 'honest', '5055', null]);
  assert.deepEqual(await pick(rook(ahead, ['5051', '9181'])), ['finish', 'finisher', '5051', 400], 'the same loss without the rook is a slip');
  assert.deepEqual(await pick(rook(clear, ['5051', '9151'])), ['finish', 'finisher', '5051', 400], 'clearly ahead, the finisher is as written');
});

test('wrap-up (a), the slip on a line the table did not search to its depth: the verified line decides (no mate, 500 cp at most), and the candidates are the five largest provisional losses among those of 500 cp or less', async () => {
  const { move, ahead, clear } = WRAP;
  const low = over => ctxOf({ level: 1, reveal: 4, lastKind: 'chance', ...over });
  const pick = async (table, verify) => {
    const c = await chooseTeachingMove(table, low({ moveNo: move }), verify);
    return [c.mode, c.kind, codeOf(c.move), c.chance === null ? null : c.chance.gain, c.loss];
  };
  /** The child stands at `e`; '2021' was exact up to depth 3 only and loses `shallow` cp there: its provisional loss. */
  const open = (e, shallow, opts = {}) => tableOf([
    flat('0001', -e), flat('1011', -e - 100), line('2021', [-e, -e - shallow, -e - shallow], { pv: ['2021', '6665'], ...opts }),
  ]);
  /** What the verification of '2021' finds at depth 5: a loss of `gain` cp, or a mate in two for the child. */
  const lossOf = (e, shallow, gain) => line('2021', [-e, -e - shallow, -e - shallow, -e - gain, -e - gain], { pv: ['2021', '6665'] });
  const mateOf = (e, shallow) => line('2021', [-e, -e - shallow, -e - shallow, childMates(2), childMates(2)], { pv: ['2021', '6665', '0010', '6564'] });
  const honest = ['finish', 'honest', '0001', null, 0];

  for (const e of [ahead, 0, clear - 1]) {
    // a provisional loss of 200 cp: the line is verified, and what the verification finds decides
    let v = verifier({ 2021: lossOf(e, 200, 400) });
    assert.deepEqual(await pick(open(e, 200), v.verify), ['finish', 'finisher', '2021', 400, 400], `verified 400, child at ${e}`);
    assert.deepEqual(v.calls, ['2021']);
    assert.deepEqual(await pick(open(e, 200), verifier({ 2021: lossOf(e, 200, 500) }).verify), ['finish', 'finisher', '2021', 500, 500], `verified 500, child at ${e}`);
    assert.deepEqual(await pick(open(e, 200), verifier({ 2021: lossOf(e, 200, 501) }).verify), honest, `verified 501, child at ${e}`);
    assert.deepEqual(await pick(open(e, 200), verifier({ 2021: lossOf(e, 200, 900) }).verify), honest, `verified 900, child at ${e}`);
    // the mate that only the verification sees: he does not walk into it, though it lies inside the child's horizon
    v = verifier({ 2021: mateOf(e, 200) });
    assert.deepEqual(await pick(open(e, 200), v.verify), honest, `verified mate in two, child at ${e}`);
    assert.deepEqual(v.calls, ['2021']);
    // the verification budget is used up: no slip
    assert.deepEqual(await pick(open(e, 200), async () => null), honest, `no budget, child at ${e}`);

    // the candidates: a provisional loss of 500 cp is verified, one of 501 cp is not looked at (by its shallow score or by its bound)
    assert.deepEqual(await pick(open(e, 500), verifier({ 2021: lossOf(e, 500, 400) }).verify), ['finish', 'finisher', '2021', 400, 400], `provisional 500, child at ${e}`);
    assert.deepEqual(await pick(open(e, 501), noVerify), honest, `provisional 501, child at ${e}`);
    assert.deepEqual(await pick(open(e, 200, { upper: -e - 500 }), verifier({ 2021: lossOf(e, 200, 500) }).verify), ['finish', 'finisher', '2021', 500, 500], `bound 500, child at ${e}`);
    assert.deepEqual(await pick(open(e, 200, { upper: -e - 501 }), noVerify), honest, `bound 501, child at ${e}`);
    assert.deepEqual(await pick(open(e, 200, { upper: childMates(1) }), noVerify), honest, `a proven mate, child at ${e}`);
  }
  // from +250 on the same lines are the finisher as written: the verified mate first, a verified win of up to 900 cp
  assert.deepEqual(await pick(open(clear, 200), verifier({ 2021: mateOf(clear, 200) }).verify), ['finish', 'finisher', '2021', 2000 - clear, 2000 - clear]);
  assert.deepEqual(await pick(open(clear, 200), verifier({ 2021: lossOf(clear, 200, 501) }).verify), ['finish', 'finisher', '2021', 501, 501]);
  assert.deepEqual(await pick(open(clear, 501), verifier({ 2021: lossOf(clear, 501, 400) }).verify), ['finish', 'finisher', '2021', 400, 400]);

  // the five candidates of a slip: five mates and two larger wins on the table do not crowd out the one move that is a slip
  const crowd = e => tableOf([
    flat('0001', -e), flat('1011', -e - 100),
    ...['5051', '5052', '5053', '5054', '5055'].map(code => line(code, [-e, childMates(1), childMates(1), childMates(1), childMates(1)], { pv: [code, '6665'] })),
    line('3031', [-e, -e - 900, -e - 900, -e - 900, -e - 900], { pv: ['3031', '6665'] }),
    line('3032', [-e, -e - 600, -e - 600, -e - 600, -e - 600], { pv: ['3032', '6665'] }),
    winLine(e, 400),
  ]);
  for (const e of [ahead, 0, clear - 1]) assert.deepEqual(await pick(crowd(e), noVerify), ['finish', 'finisher', '2021', 400, 400], `child at ${e}`);
  assert.deepEqual(await pick(crowd(clear), noVerify), ['finish', 'finisher', '5051', 2000 - clear, 2000 - clear], 'clearly ahead, the five largest of all: a mate');
});

test('wrap-up (a), the manners of a gift: no crack as the answer to a blunder, two honest moves after a chance of his, a slip until his last chance is five moves old, and of two slips the one that does not show at a glance (CONTRACT-NOTES 151)', async () => {
  const { move, ahead, clear } = WRAP;
  const low = over => ctxOf({ level: 1, reveal: 4, ...over });
  const pick = async (table, over = {}) => {
    const c = await chooseTeachingMove(table, low({ moveNo: move, ...over }), noVerify);
    return [c.mode, c.kind, codeOf(c.move), c.chance === null ? null : c.chance.gain];
  };
  const honest = ['finish', 'honest', '0001', null];
  const slip400 = ['finish', 'finisher', '2021', 400];
  /** A mate in one for the child and a slip of 400 cp on the same table. */
  const both = e => tableOf([...aheadTable(e).lines, winLine(e, 400)]);

  // 1. Never as the answer to a blunder of the child: one rival move of waiting below level 5, two from level 5 up (GIFT_WAIT).
  for (const e of [ahead, 0, clear, 599]) {
    assert.deepEqual(await pick(winTable(e, 400), { sinceBlunder: 0 }), honest, `level 1, the answer to a blunder, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 400), { sinceBlunder: 1 }), slip400, `level 1, one move later, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 400), { level: 4.9, sinceBlunder: 1 }), slip400, `level 4.9, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 400), { level: 5, sinceBlunder: 1 }), honest, `level 5, one move later, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 400), { level: 5, sinceBlunder: 2 }), slip400, `level 5, two moves later, child at ${e}`);
  }

  // 2. After a chance of his (a slip is one) he plays two honest moves before the wrap-up cracks again.
  for (const e of [ahead, 0, clear, 599]) {
    assert.deepEqual(await pick(winTable(e, 400), { sinceChance: 0 }), honest, `the move after his chance, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 400), { sinceChance: 1 }), honest, `the second move after it, child at ${e}`);
    assert.deepEqual(await pick(winTable(e, 400), { sinceChance: 2 }), slip400, `the third move after it, child at ${e}`);
  }

  // 3. Until his last chance is five moves old the crack stays a slip, however far ahead the child is: no mate, 500 cp at most.
  for (const e of [clear, 400, 599]) {
    for (const sinceChance of [2, 3, 4]) {
      assert.deepEqual(await pick(aheadTable(e), { sinceChance }), honest, `mate in one, child at ${e}, his chance ${sinceChance} moves old`);
      assert.deepEqual(await pick(winTable(e, 501), { sinceChance }), honest, `501 cp, child at ${e}, his chance ${sinceChance} moves old`);
      assert.deepEqual(await pick(both(e), { sinceChance }), slip400, `mate and slip, child at ${e}, his chance ${sinceChance} moves old`);
    }
    assert.deepEqual(await pick(aheadTable(e), { sinceChance: 5 }), ['finish', 'finisher', '5051', 2000 - e], `mate in one, child at ${e}, his chance five moves old`);
    assert.deepEqual(await pick(winTable(e, 501), { sinceChance: 5 }), ['finish', 'finisher', '2021', 501], `501 cp, child at ${e}, his chance five moves old`);
    assert.deepEqual(await pick(both(e), { sinceChance: 5 }), ['finish', 'finisher', '5051', 2000 - e], `mate and slip, child at ${e}, his chance five moves old`);
  }
  // a level game stays a slip whatever the age of his last chance
  assert.deepEqual(await pick(both(clear - 1), { sinceChance: 99 }), slip400);

  // 4. Section 4.7.6 is not held up: at +600 on the second decision running the finisher is as written, whatever he gave
  //    a move ago and whatever the child has just blundered; on the first such decision the wrap-up's manners hold.
  assert.deepEqual(await pick(aheadTable(600), { aheadRun: 1, sinceChance: 0, sinceBlunder: 0 }), ['finish', 'finisher', '5051', 1400]);
  assert.deepEqual(await pick(aheadTable(600), { aheadRun: 0, sinceChance: 0 }), honest);
  assert.deepEqual(await pick(aheadTable(600), { aheadRun: 0, sinceBlunder: 0 }), honest);
  assert.deepEqual(await pick(aheadTable(600), { aheadRun: 0, sinceChance: 4 }), honest);
  assert.deepEqual(await pick(aheadTable(600), { aheadRun: 0, sinceChance: 5 }), ['finish', 'finisher', '5051', 1400]);
  // ... and before move 60 nothing of this applies
  assert.deepEqual(await pick(aheadTable(600), { moveNo: move - 1, aheadRun: 1, sinceChance: 0, sinceBlunder: 0 }), ['finish', 'finisher', '5051', 1400]);

  // 5. Of two slips, the one that does not show at a glance. '3031' leaves a piece hanging: it loses 450 cp from depth 1 on
  //    and only the naive glance of a low level likes it. '2021' loses 400 cp from depth 2 on.
  const two = e => tableOf([
    flat('0001', -e), flat('1011', -e - 100),
    line('3031', Array(5).fill(-e - 450), { naive: -e, pv: ['3031', '6665'] }),
    winLine(e, 400),
  ]);
  const hanging = e => tableOf([flat('0001', -e), flat('1011', -e - 100), line('3031', Array(5).fill(-e - 450), { naive: -e, pv: ['3031', '6665'] })]);
  for (const e of [ahead, 0, clear - 1]) {
    assert.deepEqual(await pick(two(e)), slip400, `child at ${e}`);
    assert.deepEqual(await pick(hanging(e)), ['finish', 'finisher', '3031', 450], `alone it is a slip all the same, child at ${e}`);
  }
  // of two slips that both need a second look, the larger
  assert.deepEqual(await pick(tableOf([...winTable(0, 400).lines, line('3031', [0, -350, -350, -350, -350], { pv: ['3031', '6665'] })])), slip400);
  assert.deepEqual(await pick(tableOf([...winTable(0, 350).lines, line('3031', [0, 0, -400, -400, -400], { pv: ['3031', '6665'] })])), ['finish', 'finisher', '3031', 400]);
  // a slip that shows at depth 3 is not preferred to a larger one that shows at depth 2: only the glance counts
  assert.deepEqual(await pick(tableOf([...winTable(0, 400).lines, line('3031', [0, 0, -350, -350, -350], { pv: ['3031', '6665'] })])), slip400);
  // clearly ahead and settled, the finisher as written takes the largest win
  assert.deepEqual(await pick(two(clear)), ['finish', 'finisher', '3031', 450]);
  // of two slips that both show at a glance, the larger
  const glance = (code, gain) => line(code, Array(5).fill(-gain), { naive: 0, pv: [code, '6665'] });
  assert.deepEqual(await pick(tableOf([flat('0001', 0), flat('1011', -100), glance('3031', 350), glance('3032', 450)])), ['finish', 'finisher', '3032', 450]);

  // 6. Section 4.7.6 needs the stand of this decision too: a child who was at +600 a decision ago (aheadRun 1) and is
  //    below it now meets the wrap-up's manners, not the finisher as written.
  assert.deepEqual(await pick(aheadTable(599), { aheadRun: 1, sinceChance: 0 }), honest);
  assert.deepEqual(await pick(aheadTable(599), { aheadRun: 1, sinceBlunder: 0 }), honest);
  assert.deepEqual(await pick(aheadTable(599), { aheadRun: 1, sinceChance: 4 }), honest);
  assert.deepEqual(await pick(aheadTable(599), { aheadRun: 1, sinceChance: 5 }), ['finish', 'finisher', '5051', 1401]);

  // 7. The move he holds with is the honest move of his level, not the table's best: '1011' is the best move of a
  //    search of depth 3 (level 1), '0001' the best at the table's depth.
  const deep = e => tableOf([line('0001', [-e - 80, -e - 80, -e - 80, -e, -e]), line('1011', [-e - 30, -e - 30, -e - 30, -e - 30, -e - 60]), winLine(e, 400)]);
  for (const e of [0, clear, 599]) {
    assert.deepEqual(await pick(deep(e), { sinceChance: 0 }), ['finish', 'honest', '1011', null], `after his chance, child at ${e}`);
    assert.deepEqual(await pick(deep(e), { sinceBlunder: 0 }), ['finish', 'honest', '1011', null], `the answer to a blunder, child at ${e}`);
    assert.deepEqual(await pick(deep(e)), slip400, `nothing to wait for, child at ${e}`);
  }

  // 8. The wait counts from a blunder only: a move judged a mistake leaves sinceBlunder as it is.
  const blundered = recordOpponentMove(recordChildMove(profileOf(), createGameSkill(1), sample(0, { first: { loss: 400, cat: 'blunder' } })), 1, choiceOf());
  assert.equal(blundered.sinceBlunder, 1);
  assert.equal(recordChildMove(profileOf(), blundered, sample(2, { first: { loss: 200, cat: 'mistake' } })).sinceBlunder, 1);
});

test('wrap-up (b): from his move 80 on a rival who is 250 or more ahead plays properly and wins his won game: no ease move, no overlook, no gift; 249 cp and move 79 are as before', async () => {
  const { move, pressMove, behind } = WRAP;
  // 1. No ease move. A level-1 rival who may not give (his last move was a gift) plays the move of a depth-1 search while
  //    he eases off, and his honest move, the best of depth 3, once he wraps the game up.
  const low = over => ctxOf({ level: 1, lastKind: 'chance', ...over });
  for (const moveNo of [move - 1, move, pressMove - 1]) {
    const c = await chooseTeachingMove(behindTable(behind), low({ moveNo }), noVerify);
    assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.evalBest], ['ease', 'honest', '5053', -behind], `move ${moveNo}: he is ahead and still eases off`);
  }
  let c = await chooseTeachingMove(behindTable(behind), low({ moveNo: pressMove }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.loss, c.chance, c.overlooked], ['press', 'honest', '5051', 0, null, null]);
  c = await chooseTeachingMove(behindTable(behind - 1), low({ moveNo: pressMove }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.evalBest], ['ease', 'honest', '5053', 1 - behind]);
  for (const moveNo of [pressMove + 1, 100, 119]) {
    assert.equal((await chooseTeachingMove(behindTable(behind), low({ moveNo }), noVerify)).mode, 'press', `move ${moveNo}`);
    assert.equal((await chooseTeachingMove(behindTable(behind - 1), low({ moveNo }), noVerify)).mode, 'ease', `move ${moveNo}`);
  }
  // at every level: he plays the honest move of his level (from level 5 up his best move here, as ever in press)
  for (const level of [1, 2.5, 4, 5, 7, 9]) {
    c = await chooseTeachingMove(behindTable(behind), ctxOf({ level, moveNo: pressMove }), noVerify);
    assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['press', 'honest', '5051'], `level ${level}`);
  }

  // 2. No overlook. One move wins 200 cp more than every other from depth 3 on: before move 80 the easing rival misses
  //    it on most seeds; from move 80 on he never does.
  const slip = tableOf([line('5051', [0, 0, 300, 300, 300]), flat('5052', 100), flat('5053', 90), flat('5054', -100)], { fen: RAIL_FEN });
  let missed = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const before = await chooseTeachingMove(slip, ctxOf({ level: 1, moveNo: pressMove - 1, seed }), echo(slip));
    assert.equal(before.mode, 'ease');
    if (before.kind === 'overlook') missed++;
    const after = await chooseTeachingMove(slip, ctxOf({ level: 1, moveNo: pressMove, seed }), noVerify);
    assert.deepEqual([after.mode, after.kind, codeOf(after.move), after.overlooked, after.chance], ['press', 'honest', '5051', null, null], `seed ${seed}`);
  }
  assert.ok(missed >= 80, `before move 80 the punishing move was missed on ${missed} of 100 seeds`);

  // 3. No gift. The child of the ease table (300 behind a level-5 rival) is given a chance on move 79 and meets the best move from move 80 on.
  const table = easeTable();
  c = await chooseTeachingMove(table, ctxOf({ moveNo: pressMove - 1 }), verifier({ 9091: hiddenBlunder }).verify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['ease', 'chance', '7071']);
  for (let seed = 1; seed <= 40; seed++) {
    c = await chooseTeachingMove(table, ctxOf({ moveNo: pressMove, seed }), noVerify);
    assert.deepEqual([c.mode, c.kind, codeOf(c.move), c.loss, c.chance, c.overlooked], ['press', 'honest', '0001', 0, null, null]);
  }

  // 4. What is true of press stays true: a forced mate is played, and far ahead he does not take his last move back (rail l).
  const mate = tableOf([line('5051', [100, 100, MATE - 3, MATE - 3, MATE - 3]), flat('5052', 1900), flat('5053', 1890)], { fen: RAIL_FEN });
  c = await chooseTeachingMove(mate, ctxOf({ level: 1, moveNo: pressMove }), noVerify);
  assert.deepEqual([c.mode, c.kind, codeOf(c.move)], ['press', 'honest', '5051']);
  const back = tableOf([flat('5040', 700), flat('5051', 690), flat('5052', 400)], { fen: RAIL_FEN });
  c = await chooseTeachingMove(back, ctxOf({ level: 5, moveNo: pressMove, lastRival: LAST_4050 }), noVerify);
  assert.deepEqual([c.mode, codeOf(c.move)], ['press', '5051']);
});

test('wrap-up (c): in between nothing changes: a child who is behind by more than 50 and less than 250 cp gets the choice of move 59 on every later move, seed by seed, and one who is behind by 250 or more gets it up to move 79', async () => {
  const { move, pressMove, behind } = WRAP;
  /** The table with every score moved by `by` cp. */
  const moved = (table, by) => tableOf(table.lines.map(l => ({
    ...l, score: l.score + by, byDepth: l.byDepth.map(s => s + by), naive: l.naive + by, upper: l.upper === null ? null : l.upper + by,
  })), { fen: table.fen });
  const between = [aheadTable(WRAP.ahead - 1), aheadTable(-100), behindTable(behind - 1), behindTable(100), moved(quietTable(), 60), oneWinner(51), oneWinner(200), takingTable(RAIL_FEN, 240)];
  const behindMore = [behindTable(behind), behindTable(600), oneWinner(300), easeTable()];
  const kinds = new Set(), modes = new Set();
  let compared = 0;
  for (const [tables, later, inBetween] of [[between, [move, pressMove - 1, pressMove, 119], true], [behindMore, [move, pressMove - 1], false]]) {
    for (const table of tables) {
      const eBest = -scoreToCp(table.lines[0].score);
      assert.ok(inBetween ? eBest > -behind && eBest < WRAP.ahead : eBest <= -behind, `the premise: the child stands at ${eBest}`);
      for (const level of [1, 3, 5, 7]) {
        for (let seed = 1; seed <= 20; seed++) {
          const at = moveNo => chooseTeachingMove(table, ctxOf({ level, moveNo, seed }), echo(table));
          const before = await at(move - 1);
          for (const moveNo of later) assert.deepEqual(await at(moveNo), before, `level ${level}, seed ${seed}, child at ${eBest}, move ${moveNo}`);
          kinds.add(before.kind);
          modes.add(before.mode);
          compared++;
        }
      }
    }
  }
  // the comparison covered both modes a child who is behind can meet (no band presses a child who is behind), and soft moves as well as honest ones
  assert.deepEqual([...modes].sort(), ['ease', 'spar']);
  assert.ok(kinds.has('honest') && kinds.has('overlook') && (kinds.has('chance') || kinds.has('concession')), `kinds ${[...kinds].join(' ')} in ${compared} choices`);
});

test('wrap-up: a move of mode press or finish made from his move 60 on leaves the drift and both runs as they are', async () => {
  // his move 60 is ply 119 when he is black and ply 118 when he is red; move 59 is ply 117 or 116
  const at = (run, ply, mode) => {
    const game = recordOpponentMove({ ...createGameSkill(3), ...run }, ply, choiceOf({ mode }));
    return [game.easeRun, game.pressRun, game.drift];
  };
  for (const mode of ['press', 'finish']) {
    for (const [last, first] of [[117, 119], [116, 118]]) {
      // the tenth press move running lifts the level by half a step before move 60 ...
      assert.deepEqual(at({ pressRun: 9 }, last, mode), [0, 10, 0.5], `${mode}, ply ${last}`);
      // ... and from move 60 on it is not counted: no step, and the run stays where it was
      assert.deepEqual(at({ pressRun: 9 }, first, mode), [0, 9, 0], `${mode}, ply ${first}`);
      assert.deepEqual(at({ pressRun: 9 }, 239, mode), [0, 9, 0]);
      // a run of ease moves is not ended by it either, and a drift that is there stays
      assert.deepEqual(at({ easeRun: 5, drift: -1 }, last, mode), [0, 1, -1]);
      assert.deepEqual(at({ easeRun: 5, drift: -1 }, first, mode), [5, 0, -1]);
    }
  }
  // ease and spar moves count on move 60 and later as they always did
  assert.deepEqual(at({ easeRun: 5 }, 119, 'ease'), [6, 0, -0.5]);
  assert.deepEqual(at({ easeRun: 5, pressRun: 0 }, 119, 'spar'), [0, 0, 0]);
  assert.deepEqual(at({ pressRun: 9 }, 119, 'spar'), [0, 0, 0]);
  // a whole game: 59 press moves lift the drift to its ceiling; sixty more from move 60 on change nothing
  let game = createGameSkill(1);
  for (let no = 1; no <= 59; no++) game = recordOpponentMove(game, 2 * no - 1, choiceOf({ mode: 'press' }));
  assert.deepEqual([game.pressRun, game.drift], [59, 2]);
  let slow = createGameSkill(1);
  for (let no = 1; no <= 59; no++) slow = recordOpponentMove(slow, 2 * no - 1, choiceOf({ mode: no % 2 === 0 ? 'spar' : 'press' }));
  assert.deepEqual([slow.pressRun, slow.drift], [1, 0]);
  for (let no = 60; no <= 119; no++) slow = recordOpponentMove(slow, 2 * no - 1, choiceOf({ mode: no % 2 === 0 ? 'finish' : 'press' }));
  assert.deepEqual([slow.easeRun, slow.pressRun, slow.drift], [0, 1, 0], 'sixty wrap-up moves: nothing moved');

  // everything else a rival move records is recorded for a wrap-up move too, and the mark carries the unchanged drift
  const before = { ...createGameSkill(3), pressRun: 9, drift: 0.5, aheadRun: 2, sinceChance: 4, sinceBlunder: 7, missRun: 1 };
  const after = recordOpponentMove(before, 119, choiceOf({ mode: 'finish', kind: 'finisher', chance: aChance, evalBest: 700, move: ref('4050') }));
  assert.deepEqual([after.pressRun, after.drift, after.aheadRun, after.sinceChance, after.sinceBlunder, after.lastKind, after.chances, after.missRun, after.lastRival],
    [9, 0.5, 3, 0, 8, 'finisher', 1, 0, LAST_4050]);
  assert.deepEqual([after.marks.at(-1).ply, after.marks.at(-1).pressRun, after.marks.at(-1).drift], [119, 9, 0.5]);

  // through the selection: the move he plays when the game is wrapped up does not move the drift, the same move on move 59 does
  const profile = profileOf({ level: 5, games: 5 });
  for (const [table, mode, moveNo] of [[behindTable(WRAP.behind), 'press', WRAP.pressMove], [aheadTable(WRAP.ahead), 'finish', WRAP.move]]) {
    const ready = { ...createGameSkill(9), pressRun: 9 };
    const ctx = teachingContext(profile, ready, { moveNo, lastChildMove: null });
    const choice = await chooseTeachingMove(table, ctx, noVerify);
    assert.equal(choice.mode, mode);
    const wrapped = recordOpponentMove(ready, 2 * moveNo - 1, choice);
    assert.deepEqual([wrapped.pressRun, wrapped.drift, effectiveLevel(profile, wrapped)], [9, 0, 5], mode);
    assert.equal(recordOpponentMove(ready, 117, choice).drift, 0.5, 'the same choice on move 59 is counted');
  }
});

// ---------------------------------------------------------------------------------------------------------------
// first moves that look like an opening (CONTRACT-NOTES 143 c)
// ---------------------------------------------------------------------------------------------------------------

/** The start position with the rival to move, as black and as red. */
const START_BLACK = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b';
const START_RED = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
/** A table of the given moves, all of them equally good, for the side that is to move in `fen`. */
const openingTable = (fen, codes) => ({ ...tableOf(codes.map(code => flat(code, 0)), { fen }), turn: fen.endsWith(' w') ? 'red' : 'black' });
/** The moves picked on the first move of a later game over the seeds 1..count, as a map code -> times. */
async function openingPicks(table, count = 120, over = {}) {
  const counts = {};
  for (let seed = 1; seed <= count; seed++) {
    const c = await chooseTeachingMove(table, ctxOf({ moveNo: 1, seed, ...over }), noVerify);
    assert.equal(c.kind, 'variety');
    counts[codeOf(c.move)] = (counts[codeOf(c.move)] ?? 0) + 1;
  }
  return counts;
}

test('opening variety: a developing move is preferred when the pool holds one; the pool as before when it holds none or nothing else', async () => {
  // Every move below is a legal first move. 卒1进1 ('3040' for black, '6858' for red) is no developing move: next to it a
  // developing move is always picked, and any other move shares the picks with it.
  const cases = [
    // [black's move, the same move of red (the board turned by 180 degrees), developing?, what it is]
    ['0122', '9776', true, '马2进3: a horse from the back rank to the third rank'],
    ['0120', '9778', true, '马2进1: to the edge'],
    ['0726', '9172', true, '马8进7'],
    ['0728', '9170', true, '马8进9'],
    ['2124', '7774', true, '炮2平5: a cannon sideways along its rank'],
    ['2725', '7173', true, '炮8平6'],
    ['2120', '7778', true, '炮2平1'],
    ['2131', '7767', false, '炮2进1: a cannon forward'],
    ['2161', '7737', false, '炮2进4'],
    ['2111', '7787', false, '炮2退1'],
    ['2191', '7707', true, '炮2进7: it takes the horse (any capture)'],
    ['0224', '9674', true, '象3进5: an elephant from the back rank'],
    ['0624', '9274', true, '象7进5'],
    ['0220', '9678', true, '象3进1'],
    ['0314', '9584', true, '士4进5: an advisor from the back rank'],
    ['0514', '9384', true, '士6进5'],
    ['3242', '6656', true, '卒3进1: a pawn of the third file'],
    ['3646', '6252', true, '卒7进1: a pawn of the seventh file'],
    ['3444', '6454', false, '卒5进1: the centre pawn'],
    ['3848', '6050', false, '卒9进1: an edge pawn'],
    ['0010', '9888', true, '车1进1: a rook one step forward from its corner'],
    ['0818', '9080', true, '车9进1'],
    ['0020', '9878', false, '车1进2: two steps forward'],
    ['0414', '9484', false, '将5进1: the king'],
  ];
  for (const [black, red, developing, what] of cases) {
    // the two codes name the same move on a board turned around
    assert.equal(red, [9 - Number(black[0]), 8 - Number(black[1]), 9 - Number(black[2]), 8 - Number(black[3])].join(''), what);
    for (const [fen, code, plain] of [[START_BLACK, black, '3040'], [START_RED, red, '6858']]) {
      const picks = await openingPicks(openingTable(fen, [plain, code]));
      if (developing) assert.deepEqual(picks, { [code]: 120 }, `${what} (${code}) is a developing move`);
      else assert.ok(picks[code] >= 30 && picks[plain] >= 30 && picks[code] + picks[plain] === 120, `${what} (${code}) is none: ${JSON.stringify(picks)}`);
    }
  }
  // rook moves along the back rank and along the second rank, on a board where they exist: black's left rook stands on
  // the second rank (after 车1进1), the right horse is out and the right rook's way along the back rank is free
  const ROOKS = '1nbakab1r/r8/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b';
  for (const [code, developing, what] of [
    ['0807', true, '车9平8: from the corner along the back rank'], ['1013', true, '车1平4: along the second rank'], ['1020', false, '车1进1 from the second rank: forward'],
    ['0818', true, '车9进1: one step forward from the corner'], ['0828', false, '车9进2'], ['1000', false, '车1退1: back to the corner'],
  ]) {
    const picks = await openingPicks(openingTable(ROOKS, ['3040', code]));
    if (developing) assert.deepEqual(picks, { [code]: 120 }, what);
    else assert.ok(picks[code] >= 30 && picks['3040'] >= 30, `${what}: ${JSON.stringify(picks)}`);
  }
  // a cannon that has left its rank does not develop by moving sideways there; a horse that is out already does not by moving on
  const OUT = 'r1bakabnr/9/2n4c1/p1p1p1p1p/1c7/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b';      // 炮2进2 and 马2进3 have been played
  for (const code of ['4142', '2243', '2234']) {
    const picks = await openingPicks(openingTable(OUT, ['3040', code]));
    assert.ok(picks[code] >= 30 && picks['3040'] >= 30, `${code}: ${JSON.stringify(picks)}`);
  }
  // pieces that are out do not develop a second time: a horse that comes back to the third rank (马4退3), an elephant
  // and an advisor that have left the back rank (象5进3, 士5退4), a rook moving along the third rank (车1平2 up there)
  const BACK = 'r3kabnr/4a4/1c2b2c1/p1p1p1p1p/3n5/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b';      // 马2进3, 马3进4, 象3进5 and 士4进5 have been played
  const THIRD = '1nbakab1r/9/r3c1nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b';       // the left rook stands on the third rank, 炮2平5 and 马8进7 are played
  for (const [fen, code] of [[BACK, '4322'], [BACK, '2442'], [BACK, '1403'], [THIRD, '2021']]) {
    const picks = await openingPicks(openingTable(fen, ['3040', code]));
    assert.ok(picks[code] >= 30 && picks['3040'] >= 30, `${code}: ${JSON.stringify(picks)}`);
  }

  // a pool with several developing moves: uniform among them, the others are never picked
  const mixed = openingTable(START_BLACK, ['0122', '2131', '2724', '3040', '0624', '2161']);
  const picks = await openingPicks(mixed, 600);
  assert.deepEqual(Object.keys(picks).sort(), ['0122', '0624', '2724']);
  for (const code of ['0122', '0624', '2724']) withinThreeSigma(picks[code] / 600, 1 / 3, 600, `share of ${code}`);
  // a pool without a developing move: uniform among all of it, as before
  const none = await openingPicks(openingTable(START_BLACK, ['3040', '2131', '3848']), 600);
  for (const code of ['3040', '2131', '3848']) withinThreeSigma(none[code] / 600, 1 / 3, 600, `share of ${code}`);
  // "Otherwise the pool as today": with developing moves only, or with none, the pick is the very move it was before the
  // rule. The generator of section 4.7.5 (mulberry32 of seed ^ fnv1a(fen)) is asked once and indexes the near-best moves
  // in table order; it is written out here.
  const fnv1a = text => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return h >>> 0;
  };
  for (const codes of [['0122', '2724', '0624', '3242'], ['3040', '2131', '3848', '2161', '0414']]) {
    const table = openingTable(START_BLACK, codes);
    for (let seed = 1; seed <= 80; seed++) {
      const expected = codes[Math.floor(mulberry32((seed ^ fnv1a(START_BLACK)) >>> 0)() * codes.length)];
      assert.equal(codeOf((await chooseTeachingMove(table, ctxOf({ moveNo: 2, seed }), noVerify)).move), expected, `seed ${seed}`);
    }
  }
  // the margin and the move numbers of step 1 are what they were: a developing move 26 cp below the best is not in the pool,
  // and on move 5 (move 3 of a first game) there is no variety
  const far = { ...tableOf([flat('3040', 0), flat('2131', -10), flat('0122', -26)], { fen: START_BLACK }) };
  assert.deepEqual(Object.keys(await openingPicks(far)).sort(), ['2131', '3040']);
  const near = { ...tableOf([flat('3040', 0), flat('2131', -10), flat('0122', -25)], { fen: START_BLACK }) };
  assert.deepEqual(await openingPicks(near), { '0122': 120 });
  assert.deepEqual(await openingPicks(near, 40, { moveNo: 4 }), { '0122': 40 });
  assert.deepEqual(await openingPicks(near, 40, { moveNo: 2, firstGame: true }), { '0122': 40 });
  assert.equal((await chooseTeachingMove(near, ctxOf({ moveNo: 5 }), noVerify)).kind === 'variety', false);
  assert.equal((await chooseTeachingMove(near, ctxOf({ moveNo: 3, firstGame: true }), noVerify)).kind === 'variety', false);
  // a table whose position cannot be read has no developing move: the pool as it is
  const blind = await openingPicks({ ...mixed, fen: 'not a position' }, 300);
  assert.equal(Object.keys(blind).length, 6);
});

/** A developing move told from its notation and from where the piece stands, for either side (the rule of the owner, written out on the move's text). */
function isDevelopingByText(info, side) {
  const back = side === 'black' ? 0 : 9, step = side === 'black' ? 1 : -1;
  const n = info.notation;
  if (info.captured !== null) return true;
  const row = info.from.row;
  if (/^马[28二八]进[1379一三七九]$/u.test(n)) return row === back;
  if (/^炮.平.$/u.test(n)) return row === back + 2 * step;
  if (/^[象相士仕].进.$/u.test(n)) return row === back;
  if (/^[卒兵][37三七]进[1一]$/u.test(n)) return true;
  if (/^车.平.$/u.test(n)) return row === back || row === back + step;
  if (/^车[19一九]进[1一]$/u.test(n)) return row === back;
  return false;
}

test('opening variety on real positions: after 炮二平五, 马二进三, 兵三进一 and 相三进五 his first moves are developing moves whenever the pool holds one, and the same for the same seed', { timeout: 60000 }, async t => {
  const start = createInitialBoard();
  const firsts = [['炮二平五', '7774'], ['马二进三', '9776'], ['兵三进一', '6656'], ['相三进五', '9674']];
  const report = [];
  let mixedPools = 0;
  /** Checks the picks on one real table: the rival to move in `board`, his move number `moveNo`. */
  const check = async (board, side, moveNo, what) => {
    const fen = boardToFen(board, side);
    // the table of his turn below level 5: depth 5, every move exact to depth 3, the best six exact (bounded: it ends by its depth)
    const table = createSearcher().analyzeSync({ fen, history: [], allDepth: 3, multiPV: 6, maxDepth: 5, maxNodes: 3_000_000, timeMs: 3_600_000 });
    assert.equal(table.depth, 5, `${what}: the search reached its depth`);
    const best = scoreToCp(table.lines[0].score);
    const pool = table.lines.filter(l => l.depth === table.depth && best - scoreToCp(l.score) <= 25).map(l => describeMove(board, l.move));
    const developing = pool.filter(info => isDevelopingByText(info, side));
    if (developing.length > 0 && developing.length < pool.length) mixedPools++;
    const picked = new Set();
    for (let seed = 1; seed <= 150; seed++) {
      const ctx = ctxOf({ level: 2, moveNo, seed });
      const c = await chooseTeachingMove(table, ctx, noVerify);
      assert.equal(c.kind, 'variety');
      const info = describeMove(board, c.move);
      assert.ok(pool.some(m => m.notation === info.notation), `${what}: ${info.notation} is one of the near-best moves`);
      if (developing.length > 0) assert.ok(isDevelopingByText(info, side), `${what}, seed ${seed}: ${info.notation} is no developing move, the pool has ${developing.map(m => m.notation).join(' ')}`);
      assert.deepEqual(await chooseTeachingMove(table, { ...ctx }, noVerify), c, `${what}, seed ${seed}: the same seed and position give the same pick`);
      picked.add(info.notation);
    }
    // every developing move of the pool gets its turn (the pick is uniform among them)
    if (developing.length > 0) assert.deepEqual([...picked].sort(), developing.map(m => m.notation).sort(), what);
    report.push(`${what}: pool ${pool.map(m => m.notation).join(' ')} -> picked ${[...picked].join(' ')}`);
    return table;
  };
  for (const [name, code] of firsts) {
    const move = getLegalMoves(start, 'red').find(m => codeOf(m) === code);
    assert.equal(describeMove(start, move).notation, name);
    let board = applyMove(start, move);
    // his first move, and his second after the child's 马八进七 (a move that is there after each of the four)
    const table = await check(board, 'black', 1, `after ${name}`);
    const reply = table.lines.find(l => {
      const info = describeMove(board, l.move);
      return info.captured === null && isDevelopingByText(info, 'black') && scoreToCp(table.lines[0].score) - scoreToCp(l.score) <= 25 && l.depth === table.depth;
    });
    assert.ok(reply, `after ${name} the pool holds a developing move`);
    board = applyMove(board, getLegalMoves(board, 'black').find(m => codeOf(m) === codeOf(reply.move)));
    const second = getLegalMoves(board, 'red').find(m => codeOf(m) === '9172');
    assert.ok(second, '马八进七 is there');
    assert.equal(describeMove(board, second).notation, '马八进七');
    await check(applyMove(board, second), 'black', 2, `after ${name}, his reply and 马八进七`);
  }
  // the rival with the red pieces, on the very first move of a game: the same rule seen from the other side of the board
  await check(start, 'red', 1, 'the start position, he is red');
  assert.ok(mixedPools >= 3, `in ${mixedPools} of these positions the pool holds developing moves and others`);
  t.diagnostic(report.join('; '));
});

// ---------------------------------------------------------------------------------------------------------------
// tension
// ---------------------------------------------------------------------------------------------------------------

/** PositionFacts as far as tension reads them. */
const factsOf = (over = {}) => ({
  check: null, hanging: [], kings: { red: { pressure: 0 }, black: { pressure: 0 } }, mates: { red: null, black: null }, material: { phase: 0 }, ...over,
});
const quietInputs = (over = {}) => ({ facts: factsOf(), score: 0, evalNow: 0, evalTwoPliesAgo: 0, ...over });
/** The value the smoothing settles on when the same inputs are fed again and again. */
function settled(inputs) {
  let x = 0.1;
  for (let i = 0; i < 200; i++) x = tension(inputs, x);
  return x;
}

test('tension: the four reference values; rises faster than it falls', () => {
  const rook = { gain: 900, now: true };
  // quiet opening 0.10; a rook hanging 0.50; in check with a rook hanging 0.78; forced mate on the board 0.87 or more
  near(settled(quietInputs()), 0.10, 0.005);
  near(settled(quietInputs({ facts: factsOf({ hanging: [rook] }) })), 0.50, 0.006);
  near(settled(quietInputs({ facts: factsOf({ hanging: [rook], check: { checkers: [] } }) })), 0.78, 0.005);
  const mateByScore = settled(quietInputs({ score: MATE - 5, evalNow: -2000, evalTwoPliesAgo: -2000 }));
  near(mateByScore, 0.865, 1e-9);
  assert.ok(Math.round(mateByScore * 100) / 100 >= 0.87);
  near(settled(quietInputs({ score: -(MATE - 4), evalNow: 2000, evalTwoPliesAgo: 2000 })), 0.865, 1e-9, 'a mate for either side');
  near(settled(quietInputs({ facts: factsOf({ mates: { red: null, black: { in: 2 } } }) })), 0.865, 1e-9, 'a mate threat in the facts');
  assert.ok(settled(quietInputs({ score: MATE - 5, facts: factsOf({ check: { checkers: [] }, hanging: [rook] }) })) > 0.87);
  // the exact formula for one mixed case
  const mixed = quietInputs({
    facts: factsOf({ hanging: [{ gain: 450, now: true }, { gain: 900, now: false }], kings: { red: { pressure: 0.25 }, black: { pressure: 0.5 } }, material: { phase: 0.6 } }),
    evalNow: 100, evalTwoPliesAgo: -150,
  });
  near(settled(mixed), 1 - 0.90 * (1 - 0.45 * 0.5) * (1 - 0.45 * 0.5) * (1 - 0.40 * 0.5) * (1 - 0.30 * 0.8 * 0.6), 1e-9);
  // a piece that is not hanging right now does not count; a close endgame is tense, a decided one is not
  near(settled(quietInputs({ facts: factsOf({ hanging: [{ gain: 900, now: false }] }) })), 0.10, 1e-9);
  near(settled(quietInputs({ facts: factsOf({ material: { phase: 1 } }) })), 1 - 0.90 * 0.70, 1e-9);
  near(settled(quietInputs({ facts: factsOf({ material: { phase: 1 } }), evalNow: 600, evalTwoPliesAgo: 600 })), 0.10, 1e-9);
  // no evaluation two plies ago (start of a game): no swing
  near(settled(quietInputs({ evalNow: 400, evalTwoPliesAgo: null })), 0.10, 1e-9);
  near(settled(quietInputs({ evalNow: 400, evalTwoPliesAgo: -100 })), 1 - 0.90 * 0.55, 1e-9);
  // a repetition verdict (|mate| >= 50) is not a forced mate
  near(settled(quietInputs({ score: MATE - 103, evalNow: -2000, evalTwoPliesAgo: -2000 })), 0.10, 1e-9);
  assert.equal(scoreToCp(MATE - 103), 2000);

  // fast attack (0.7 of the way up), slow release (0.25 of the way down); prev = 0.1 at game start
  const hang = quietInputs({ facts: factsOf({ hanging: [rook] }) });
  const up = tension(hang, 0.1);
  near(up, 0.1 + (0.505 - 0.1) * 0.7, 1e-9);
  const down = tension(quietInputs(), 0.505);
  near(down, 0.505 - (0.505 - 0.1) * 0.25, 1e-9);
  assert.ok(up - 0.1 > 0.505 - down, 'rises faster than it falls');
  near(tension(quietInputs(), 0.1), 0.1, 1e-12);
  // always inside 0..1
  for (const prev of [0, 0.1, 0.5, 1]) {
    for (const inputs of [quietInputs(), hang, mixed, quietInputs({ score: MATE - 1, facts: factsOf({ check: { checkers: [] }, hanging: [rook], kings: { red: { pressure: 1 }, black: { pressure: 1 } } }) })]) {
      const x = tension(inputs, prev);
      assert.ok(x >= 0 && x <= 1);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// takeaways
// ---------------------------------------------------------------------------------------------------------------

test('gameTakeaways: ordering, omission, and self-found moves preferred for the highlight', () => {
  const profile = profileOf({ level: 4, games: 6 });
  const game = samples => ({ ...createGameSkill(1), samples, n: samples.length, accSum: samples.length * 0.8 });
  const moveA = info('7774', { notation: '炮二平五' }), moveB = info('9776', { notation: '马二进三', piece: 'horse' });
  const moveC = info('7707', { notation: '炮二进七', captured: 'horse' });
  const found = (tier, on = true) => ({ tier, kind: 'win', found: on });
  const slip = (ply, danger, loss, over = {}) => sample(ply, { danger, first: { move: moveC, loss, cat: loss >= 300 ? 'blunder' : 'mistake' }, final: { move: moveA, loss: 0, cat: 'good' }, ...over });

  // ordering: highlight, lesson, pattern; at most three items
  let out = gameTakeaways(game([
    sample(0, { final: { cat: 'good' }, first: { cat: 'good' } }),
    sample(2, { test: found(1), final: { move: moveB, cat: 'best' } }),
    slip(4, 'hangs_moved_piece', 200),
    sample(6, { patterns: ['fork_two', 'check_fork'], final: { move: moveC, cat: 'best' } }),
    slip(8, 'hangs_moved_piece', 250),
    slip(10, 'allows_mate', 400),
  ]), 'win', profile);
  assert.deepEqual(out.map(t => t.kind), ['highlight', 'lesson', 'pattern']);
  assert.deepEqual(out[0], { kind: 'highlight', ply: 2, move: moveB, self: true });
  // the lesson: the danger with the largest summed loss (200 + 250 > 400), its count and its costliest example (the tried move)
  assert.deepEqual(out[1], { kind: 'lesson', danger: 'hangs_moved_piece', count: 2, ply: 8, move: moveC });
  assert.deepEqual(out[2], { kind: 'pattern', pattern: 'fork_two', ply: 6, move: moveC });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'data only');

  // the lesson reads the FIRST try: a mistake that was taken back still teaches; a first try that was fine does not
  out = gameTakeaways(game([
    sample(0, { danger: 'slow', first: { loss: 100, cat: 'ok' } }),
    sample(2, { danger: 'bad_trade', first: { loss: 0, cat: 'best' }, final: { loss: 300, cat: 'blunder' } }),
    slip(4, null, 500),                                              // no danger known: nothing to report
  ]), 'loss', profile);
  assert.ok(!out.some(t => t.kind === 'lesson'));
  out = gameTakeaways(game([slip(0, 'unguards', 150), slip(2, 'misses_win', 290), slip(4, 'unguards', 139)]), 'loss', profile);
  assert.deepEqual(out.find(t => t.kind === 'lesson'), { kind: 'lesson', danger: 'misses_win', count: 1, ply: 2, move: moveC });
  out = gameTakeaways(game([slip(0, 'unguards', 150), slip(2, 'misses_win', 290), slip(4, 'unguards', 141)]), 'loss', profile);
  assert.deepEqual(out.find(t => t.kind === 'lesson'), { kind: 'lesson', danger: 'unguards', count: 2, ply: 0, move: moveC });

  // omission: nothing to say gives nothing; no mistake, no lesson; no pattern and no progress, no third item
  assert.deepEqual(gameTakeaways(createGameSkill(1), 'draw', profile), []);
  assert.deepEqual(gameTakeaways(game([sample(0, { first: { cat: 'good' } }), sample(2, { first: { cat: 'ok', loss: 60 } })]), 'draw', profile), []);
  out = gameTakeaways(game([sample(0, { first: { cat: 'best' } })]), 'draw', profile);
  assert.deepEqual(out, [{ kind: 'highlight', ply: 0, move: moveA, self: true }]);
  out = gameTakeaways(game([slip(0, 'slow', 130)]), 'draw', profile);
  assert.deepEqual(out.map(t => t.kind), ['lesson']);

  // the highlight prefers what the child found alone (self) over anything found with a pouch
  const helped = sample(2, { self: false, hintMax: 3, test: found(3), final: { move: moveB, cat: 'brilliant' } });
  out = gameTakeaways(game([sample(0, { first: { cat: 'best' } }), helped, sample(4, { first: { cat: 'good' } })]), 'win', profile);
  assert.deepEqual(out[0], { kind: 'highlight', ply: 0, move: moveA, self: true });
  // no self sample qualifies: the same rule over all samples, marked self: false
  out = gameTakeaways(game([sample(0, { first: { cat: 'good' } }), helped, sample(4, { first: { cat: 'ok' } })]), 'win', profile);
  assert.deepEqual(out[0], { kind: 'highlight', ply: 2, move: moveB, self: false });

  // the rule inside one group: a found test in the highest tier (ties: the latest) ...
  out = gameTakeaways(game([
    sample(0, { test: found(1) }), sample(2, { test: found(2) }), sample(4, { test: found(3, false), first: { cat: 'brilliant' } }),
    sample(6, { test: found(2), final: { move: moveB } }), sample(8, { test: found(1) }),
  ]), 'win', profile);
  assert.deepEqual(out[0], { kind: 'highlight', ply: 6, move: moveB, self: true });
  // ... else a brilliant move, else a best move (first idea preferred, then the latest), else the first named pattern
  out = gameTakeaways(game([sample(0, { first: { cat: 'best' } }), sample(2, { first: { cat: 'brilliant' } }), sample(4, { first: { cat: 'best' } })]), 'win', profile);
  assert.equal(out[0].ply, 2);
  out = gameTakeaways(game([
    sample(0, { tries: 1, first: { cat: 'best' } }), sample(2, { tries: 1, first: { cat: 'best' } }),
    sample(4, { tries: 3, first: { cat: 'mistake', loss: 150 }, final: { cat: 'best', loss: 0 } }),
  ]), 'win', profile);
  assert.equal(out[0].ply, 2, 'a best move found at once beats a later one found on the third try');
  out = gameTakeaways(game([sample(0, { tries: 2, final: { cat: 'best' }, first: { cat: 'ok', loss: 60 } }), sample(2, { tries: 4, final: { cat: 'best' }, first: { cat: 'ok', loss: 60 } })]), 'win', profile);
  assert.equal(out[0].ply, 2, 'without a first-idea move: the latest');
  out = gameTakeaways(game([
    sample(0, { first: { cat: 'good' } }), sample(2, { first: { cat: 'good' }, patterns: ['central_cannon'] }),
    sample(4, { first: { cat: 'ok', loss: 60 }, patterns: ['screen_horses'], final: { move: moveB, cat: 'ok', loss: 60 } }),
  ]), 'draw', profile);
  assert.deepEqual(out, [{ kind: 'highlight', ply: 2, move: moveA, pattern: 'central_cannon', self: true },
                         { kind: 'pattern', pattern: 'screen_horses', ply: 4, move: moveB }]);
  // the pattern item is never the highlight again
  out = gameTakeaways(game([sample(0, { test: found(1), patterns: ['fork_two'] })]), 'win', profile);
  assert.deepEqual(out.map(t => t.kind), ['highlight']);

  // the highlight shows the move that was PLAYED: a find that was tried first and then given up for a worse move is not
  // the best moment (found describes the first try) ...
  const gaveUp = sample(4, { tries: 2, test: found(2), first: { move: moveC, loss: 0, cat: 'best' }, final: { move: moveB, loss: 200, cat: 'ok' } });
  out = gameTakeaways(game([sample(0, { first: { cat: 'good' } }), sample(2, { first: { cat: 'best' } }), gaveUp]), 'win', profile);
  assert.deepEqual(out[0], { kind: 'highlight', ply: 2, move: moveA, self: true });
  assert.deepEqual(gameTakeaways(game([sample(0, { first: { cat: 'good' } }), gaveUp]), 'win', profile), [], 'and nothing else in this game is a best moment');
  // ... while a find that was confirmed, or exchanged for another move of the winning group (within 60 cp), is
  for (const [loss, counts] of [[0, true], [60, true], [61, false]]) {
    const kept = sample(4, { tries: 2, test: found(2), first: { move: moveC, loss: 0, cat: 'best' }, final: { move: moveB, loss, cat: 'good' } });
    out = gameTakeaways(game([sample(0, { first: { cat: 'good' } }), kept]), 'win', profile);
    assert.deepEqual(out, counts ? [{ kind: 'highlight', ply: 4, move: moveB, self: true }] : [], `confirmed move ${loss} cp below the best`);
  }
  // a move the game judged a mistake is never the best moment, whatever pattern it played; the pattern is still reported
  for (const cat of ['mistake', 'blunder']) {
    const flawed = sample(2, { patterns: ['fork_two'], first: { move: moveC, loss: 250, cat }, final: { move: moveC, loss: 250, cat } });
    out = gameTakeaways(game([sample(0, { first: { cat: 'good' } }), flawed]), 'loss', profile);
    assert.deepEqual(out, [{ kind: 'pattern', pattern: 'fork_two', ply: 2, move: moveC }], `a ${cat} that played a pattern`);
  }
  out = gameTakeaways(game([sample(0, { first: { cat: 'good' } }), sample(2, { patterns: ['fork_two'], first: { move: moveC, loss: 60, cat: 'ok' } })]), 'loss', profile);
  assert.deepEqual(out, [{ kind: 'highlight', ply: 2, move: moveC, pattern: 'fork_two', self: true }]);

  // progress: this game's accuracy is 0.05 or more above the mean of profile.recent; a pattern comes first
  const usual = profileOf({ level: 4, games: 6, recent: [0.70, 0.80].map((acc, i) => ({ at: i, result: 'draw', acc, n: 20, level: 4 })) });
  const steady = [sample(0, { first: { cat: 'good' } })];
  out = gameTakeaways({ ...game(steady), n: 20, accSum: 16 }, 'win', usual);
  assert.deepEqual(out, [{ kind: 'progress', acc: 0.8, usual: 0.75 }]);
  assert.deepEqual(gameTakeaways({ ...game(steady), n: 20, accSum: 15.9 }, 'win', usual), []);
  assert.deepEqual(gameTakeaways({ ...game(steady), n: 20, accSum: 16 }, 'win', profile), [], 'no earlier game to compare with');
  out = gameTakeaways({ ...game([sample(0, { first: { cat: 'good' }, patterns: ['iron_bolt'] }), sample(2, { first: { cat: 'good' }, patterns: ['smother'] })]), n: 20, accSum: 19 }, 'win', usual);
  assert.deepEqual(out.map(t => t.kind), ['highlight', 'pattern']);
  // a game without a counted move has no accuracy; an earlier one is left out of the mean
  assert.deepEqual(gameTakeaways({ ...game(steady), n: 0, accSum: 0 }, 'win', usual), []);
  const withEmpty = { ...usual, recent: [...usual.recent, { at: 9, result: 'loss', acc: 0, n: 0, level: 4 }] };
  assert.deepEqual(gameTakeaways({ ...game(steady), n: 20, accSum: 16 }, 'win', withEmpty), [{ kind: 'progress', acc: 0.8, usual: 0.75 }]);

  // finishGame returns the same items, compared against the games before this one
  const fin = finishGame(usual, { ...game(steady), n: 20, accSum: 16 }, 'win');
  assert.deepEqual(fin.takeaways, [{ kind: 'progress', acc: 0.8, usual: 0.75 }]);
});

// ---------------------------------------------------------------------------------------------------------------
// what the store and the director load
// ---------------------------------------------------------------------------------------------------------------

test('createSkillProfile and migrateSkillProfile: defaults, clamps, garbage never throws, a valid profile comes back equal', t => {
  t.mock.method(Date, 'now', () => 1790000000000);
  assert.deepEqual(createSkillProfile(), { v: 1, level: 2, games: 0, tactics: { seen: [0, 0, 0], found: [0, 0, 0] }, streak: 0, bandShift: 0, habits: {}, recent: [] });
  assert.deepEqual([createSkillProfile(4).level, createSkillProfile(6).level, createSkillProfile(0).level, createSkillProfile(99).level, createSkillProfile(NaN).level,
                    createSkillProfile(undefined).level], [4, 6, 1, 9, 2, 2]);
  assert.notEqual(createSkillProfile().tactics, createSkillProfile().tactics, 'no shared arrays');

  // garbage of every kind gives a usable profile at the default level, and nothing throws
  const fresh = createSkillProfile(2);
  for (const raw of [undefined, null, 0, 7, 'x', true, [], [1, 2], {}, { v: 2 }, { level: 'high' }, { level: NaN }, { level: Infinity }, { tactics: 5, habits: [], recent: {} },
                     { tactics: { seen: 'abc', found: null } }, { recent: [null, 5, 'x', {}, { at: 1 }] }, Object.create(null), new Date(0), () => 1]) {
    assert.deepEqual(migrateSkillProfile(raw), fresh, `raw = ${String(JSON.stringify(raw))}`);
  }
  // every field is brought into its range one by one; what is valid is kept
  const repaired = migrateSkillProfile({
    v: 0, level: 12, games: -4, tactics: { seen: [3, -1, 'x', 9], found: [5, 2] }, streak: 2.9, bandShift: 500,
    habits: { greedy: 20, hang_piece: 0, nonsense: 3, miss_mate: 'often', bad_trade: 1.5 },
    recent: [{ at: 5, result: 'win', acc: 1.4, n: 30, level: 0 }, { at: 6, result: 'won', acc: 0.5, n: 30, level: 3 }, { at: 7, result: 'draw', acc: 0.5, n: -1, level: 3 }],
    extra: 'dropped',
  });
  assert.deepEqual(repaired, {
    v: 1, level: 9, games: 0, tactics: { seen: [3, 0, 0], found: [3, 0, 0] }, streak: 2, bandShift: 120, habits: { greedy: 9, bad_trade: 1.5 },
    recent: [{ at: 5, result: 'win', acc: 1, n: 30, level: 1 }],
  });
  assert.equal(migrateSkillProfile({ level: 0.2, bandShift: -500 }).level, 1);
  assert.equal(migrateSkillProfile({ level: 0.2, bandShift: -500 }).bandShift, -60);
  assert.equal(migrateSkillProfile({ recent: Array.from({ length: 14 }, (_, i) => ({ at: i, result: 'draw', acc: 0.8, n: 10, level: 3 })) }).recent[0].at, 4);

  // a profile this module produced comes back equal (also after JSON), as a new object
  let profile = profileOf({ level: 3.25, games: 2, habits: { greedy: 1.9 } });
  for (const result of ['win', 'loss', 'draw', 'win']) {
    let game = createGameSkill(1);
    for (let i = 0; i < 12; i++) {
      game = recordChildMove(profile, game, sample(2 * i, { first: { loss: 20 * (i % 5), cat: 'good' }, habit: i % 4 === 0 ? 'hang_piece' : null,
                                                             test: i % 3 === 0 ? { tier: 1 + (i % 3), kind: 'win', found: i % 2 === 0 } : null }));
    }
    profile = finishGame(profile, game, result).profile;
  }
  const again = migrateSkillProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepStrictEqual(again, profile);
  assert.notEqual(migrateSkillProfile(profile), profile);
  assert.deepStrictEqual(migrateSkillProfile(profile), profile);
  // everything read from a profile works on a migrated one
  for (const raw of [null, { level: 'x' }, repaired]) {
    const p = migrateSkillProfile(raw);
    assert.ok([2, 4, 6].includes(revealFor(p)));
    assert.ok(findRate(p, 3) >= 0 && findRate(p, 3) <= 1);
    assert.ok(effectiveLevel(p, createGameSkill(1)) >= 1);
    assert.equal(finishGame(p, gameOf(p, 9), 'win').profile.v, 1);
  }
});

test('createGameSkill and reviveGameSkill: start values, garbage gives a fresh game, a recorded game survives a save unchanged', () => {
  assert.deepEqual(createGameSkill(2891336453), {
    seed: 2891336453, samples: [], n: 0, accSum: 0, shift: 0, drift: 0, easeRun: 0, pressRun: 0, aheadRun: 0, sinceChance: 99, sinceBlunder: 99,
    lastKind: null, spared: 0, chances: 0, missRun: 0, lastRival: 0, marks: [],
  });
  assert.equal(createGameSkill(-1).seed, 4294967295, 'the seed is a uint32');
  assert.equal(createGameSkill(NaN).seed, 0);

  const fresh = createGameSkill(42);
  for (const raw of [undefined, null, 3, 'skill', [], {}, { samples: [], marks: [] }, { ...fresh, samples: 'none' }, { ...fresh, marks: null }, { ...fresh, n: '3' },
                     { ...fresh, shift: NaN }, { ...fresh, drift: null }, { ...fresh, chances: undefined }]) {
    assert.deepEqual(reviveGameSkill(raw, 42), fresh, `raw = ${String(JSON.stringify(raw))}`);
  }

  // a game recorded here, written to a save and read back, is the same game
  const profile = profileOf({ level: 3 });
  let game = createGameSkill(42);
  for (let ply = 0; ply < 30; ply++) {
    game = ply % 2 === 0
      ? recordChildMove(profile, game, sample(ply, {
        first: { loss: 33.3 * (ply % 7), cat: ply % 7 > 4 ? 'mistake' : 'good', move: info('7774', { captured: ply % 6 === 0 ? 'pawn' : null }) },
        test: ply % 8 === 0 ? { tier: 2, kind: 'save', found: ply % 16 === 0 } : null, danger: ply % 7 > 4 ? 'unguards' : null, habit: ply % 7 > 4 ? 'hang_piece' : null,
        avoided: ply === 4 ? 'greedy' : null, patterns: ply === 2 ? ['screen_horses', 'central_cannon'] : [], captured: ply % 6 === 0 ? 'pawn' : null,
        hint: ply % 4 === 2 ? 1 : 0, hintMax: ply % 4 === 2 ? 2 : 0, self: ply % 4 !== 2, tries: 1 + (ply % 3),
      }))
      : recordOpponentMove(game, ply, choiceOf({ mode: ['ease', 'spar', 'press'][ply % 3], kind: ply === 7 ? 'chance' : 'honest', chance: ply === 7 ? aChance : null, evalBest: 100 * ply - 900 }));
  }
  const saved = JSON.parse(JSON.stringify(game));
  const revived = reviveGameSkill(saved, 42);
  assert.deepStrictEqual(revived, game);
  assert.notEqual(revived, saved);
  // usable at once: undo and the next move work on the revived game
  assert.deepStrictEqual(rewindGameSkill(revived, 11), rewindGameSkill(game, 11));
  assert.deepStrictEqual(recordOpponentMove(revived, 31, choiceOf()), recordOpponentMove(game, 31, choiceOf()));
  // the game's own seed wins over the saved one
  assert.equal(reviveGameSkill(saved, 7).seed, 7);

  // out-of-range values are brought into range; unusable samples and marks are dropped, usable ones repaired
  const good = saved.samples[0];
  const odd = reviveGameSkill({
    ...saved, shift: 9, drift: -9, n: -2, accSum: 5, easeRun: -1, spared: 2.7, lastKind: 'gift', seed: 'x',
    samples: [null, 5, { ply: 0 }, { ...good, first: null }, { ...good, ply: -1 }, { ...good, final: { ...good.final, cat: 'superb' } },
              { ply: 6, first: good.first, final: good.final, tries: 0, hint: 7, hintMax: 2, bestCp: 1e9, legalCount: -3, test: { tier: 4, kind: 'win', found: true },
                danger: 'boredom', habit: 'laziness', avoided: 'greedy', patterns: ['screen_horses', 'made_up', 4], captured: 'queen', thinkMs: -5, junk: 1 }],
    marks: [null, { ply: 3 }, { ...saved.marks[0], shift: 'x' }, { ...saved.marks[1], lastKind: 17, drift: 99 }],
  }, 42);
  assert.deepEqual([odd.seed, odd.shift, odd.drift, odd.n, odd.accSum, odd.easeRun, odd.spared, odd.lastKind], [42, 1.5, -3, 0, 0, 0, 2, null]);
  assert.deepEqual(odd.samples, [{
    ply: 6, first: good.first, final: good.final, tries: 1, hint: 0, hintMax: 2, self: false, bestCp: 2000, legalCount: 0, test: null, danger: null, habit: null,
    avoided: 'greedy', patterns: ['screen_horses'], captured: null, thinkMs: 0,
  }]);
  assert.deepEqual(odd.marks, [{ ...saved.marks[1], lastKind: null, drift: 2 }]);
  // 300 samples at most
  const many = { ...saved, samples: Array.from({ length: 320 }, (_, i) => ({ ...good, ply: 2 * i })) };
  const kept = reviveGameSkill(many, 42).samples;
  assert.equal(kept.length, 300);
  assert.equal(kept[0].ply, 40);
});
