// scripts/sim.js (T2) — the teaching-opponent simulation (`npm run test:sim`; contract section 14.1 with the bars of
// CONTRACT-NOTES 130 as 143 (d) changed them).
//
//   node scripts/sim.js [--games 64] [--seed 1] [--only <pairing,...>] [--path table|slow|mid|fast] [--jobs n] [--json <file>] [--print <dir>]
//
// It answers one question with numbers: does 司马懿 keep a child of each strength in a game the child can win, without
// looking as if he threw it? Simulated children (bots A to D: mixtures of shallow searches) play whole games as red
// against the rival, and the script counts where the child stood, who won and how, and how often the rival did
// something a child would notice as a give-away (the rails (h) to (l) of CONTRACT-NOTES 124).
//
// The pairings (`--only` takes their names, or a kind such as `matched`, or `weak` for the eight pairings of bots A and B):
//   plain-A..D    the plain engine: the best move of the rival's table, no teaching          (the baseline: it must crush)
//   matched-A..D  the teaching rival at the bot's own level (1.5, 3, 5, 6.5), a child who has played five games
//   coached-A..D  the same, and 诸葛亮 holds a move that loses 300 cp or more: seven times in ten the bot looks again
//   high-A        the teaching rival started 3.5 levels too high for bot A (level 5)
//   first-A, -B   the first game ever (level 2, profile.games = 0); firstc-A, -B the same with 诸葛亮
//
// How the rival moves (`--path`):
//   slow, mid, fast
//           the game's own path: the `opponent` job of createBrain() with the plan row of that speed class (section
//           4.8.1), on a virtual clock. The clock advances by a fixed step every time it is read, and the search reads
//           it once per 2048 nodes, so a time budget is a node budget: a device of a fixed speed (DEVICES below).
//           The rival thinks as deep as his level and never deeper than the plan row (CONTRACT-NOTES 143 a: depth 5
//           below level 5, 6 below level 7, 7 below level 9), so below level 5 he is the same rival on the three
//           devices, up to the searches that a budget ends early. `mid` is the default: it is the real job, and 64
//           games per pairing take ten to fifteen minutes with five workers; `fast` takes about a quarter of an hour.
//           Run `--path fast` as well before a release: from level 5 up the devices still differ.
//   table   chooseTeachingMove on a depth-bound table (depth 5, every move exact to depth 3, top six exact), verified by
//           depth-bound single-move searches. The reached numbers of CONTRACT-NOTES 130 were measured this way; it is
//           the quickest path (about five minutes).
// In every path the bot's own search and the observer's table (below) are depth-bound, and the clock is the virtual
// one for as long as a game runs. No decision depends on wall-clock time: the same seeds give the same numbers on any
// machine and under any load. With a brain path the bot and the observer search with a searcher of their own, so the
// brain under test runs nothing but its opponent jobs. What that leaves out of the real game: the survey and assess
// jobs of the child's turn, which warm the transposition table the rival's search then uses.
//
// Seeds: game i of a pairing has the seed number `--seed` + i. The same seed number gives bots of the same letter the
// same random stream in every pairing, so pairings are compared on paired games.
//
// The rails are counted by an observer that does not use the teacher's own bookkeeping: it reads a table of the rival's
// position (depth 5, every move exact to depth 3, top six exact; with `--path table` that is the rival's own table),
// the static exchange value of every capture, and the rules. With a brain path the rival's own table is another one
// (deeper from level 5 up), so a move of his counts as worse than what the observer would have played only when his own
// search says so too.
//
// Games run in worker threads (`--jobs`, default the processor count minus two, at most 8). Every game has a ply limit;
// a worker that does not finish a game within GAME_TIMEOUT_MS, or that dies, is replaced and the game is reported as
// not finished. Exit code: 0 when every bar that applies is met, 1 when a bar fails, a game did not finish or a result
// file could not be written, 2 for a usage error (an unknown option, a value or an output path that cannot be used:
// the paths of `--json` and `--print` are checked before any game is played). With fewer than 64 games per pairing (a
// quick look) only the bars marked † apply: the others, among them every bar that is a share of a few cases (the rails
// (i), (k) and (l), the plain engine's bar, the long games), are printed with their numbers and marked 不计.
import { realpathSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createBrain, planFor } from '../src/core/brain.js';
import { applyMove, boardToFen, createInitialBoard, drawStatus, getLegalMoves, playableMoves, plyRecord, positionKey } from '../src/core/engine.js';
import { positionFacts, quickVerdict, tacticalTest } from '../src/core/facts.js';
import { describeMove } from '../src/core/notation.js';
import { Position, colOf, mvTo, rowOf } from '../src/core/position.js';
import { WIN, createSearcher, mateIn, scoreToCp } from '../src/core/search.js';
import { PIECE_VALUE } from '../src/core/codes.js';
import { chooseTeachingMove, createGameSkill, createSkillProfile, effectiveLevel, recordChildMove, recordOpponentMove, teachingContext } from '../src/core/teacher.js';

/** @import { Analysis, Board, Line, Move, MoveRef, MoveSample, PlyRecord, RootLine, SkillProfile, TeachingChoice, TeachingContext } from '../src/core/types.js' */
/** @import { Brain } from '../src/core/brain.js' */

const USAGE = 'node scripts/sim.js [--games 64] [--seed 1] [--only <pairing,...>] [--path table|slow|mid|fast] [--jobs n] [--json <file>] [--print <dir>]';

// ---------------------------------------------------------------------------------------------------------------
// What is played
// ---------------------------------------------------------------------------------------------------------------

/** Games per pairing by default, and the number from which every bar applies (CONTRACT-NOTES 130). */
const FULL_GAMES = 64;
const DEFAULT_SEED = 1;
/** Largest default number of workers. */
const MAX_DEFAULT_JOBS = 8;
/** A game that reaches this many plies is stopped and scored by the child's last evaluation. */
const PLY_LIMIT = 240;
/** Evaluation beyond which a stopped game counts as won or lost, cp. */
const STOPPED_MARGIN = 400;
/**
 * A worker that does not finish a game within this time is replaced; the game is reported as not finished. A game
 * takes a second (table path) to about a minute (a long game on the fast path) on the dev machine; the limit leaves
 * room for a heavily loaded one.
 */
const GAME_TIMEOUT_MS = 600_000;
/**
 * Heap limits of one worker, MB. The old generation is capped far above what a game holds (a few MB). The young
 * generation is kept small: every search leaves short-lived typed arrays behind, and frequent scavenges keep a worker
 * at about 50 MB of resident memory instead of 150, at no measurable cost in time.
 */
const WORKER_HEAP_MB = 256, WORKER_YOUNG_MB = 8;
/** A time budget that no search of the simulation reaches: such a search is bound by its depth alone. */
const UNBOUNDED_MS = 3_600_000;

/** The bot's own search: what it could see at most, and the table its moves are judged by. */
const CHILD_TABLE = Object.freeze({ allDepth: 3, multiPV: 4, maxDepth: 4 });
/** The observer's table of the rival's position; with `--path table` also the rival's own table. */
const JUDGE_TABLE = Object.freeze({ allDepth: 3, multiPV: 6, maxDepth: 5 });
/** Uniform noise on what a bot sees, cp (plus or minus half of it). */
const VISION_NOISE = 20;
/** 诸葛亮 holds a first try that loses this much, cp ... */
const HELD_LOSS = 300;
/** ... the coached bot then looks again this many plies deeper ... */
const SECOND_LOOK = 2;
/** ... with this probability. */
const COACH_HEED = 0.7;
/** MoveSample.first.loss and final.loss are capped at this (section 4.7.2). */
const LOSS_CAP = 600;
/** A child turn counts as "in the band" when the child's evaluation is within this, cp. */
const BAND = 300;
/** A chance counts as taken when the child's next move loses at most this share of what was offered. */
const TAKEN_SHARE = 0.4;

/**
 * The simulated children: at every move the bot picks the best move of one of these searches, chosen with the given
 * probability. Depth 0 is the glance (static evaluation after the move, no reply considered); the mixtures are the
 * reference players of section 4.7.1.
 * @type {Readonly<Record<BotName, readonly (readonly [number, number])[]>>}
 */
const BOTS = Object.freeze({
  A: Object.freeze([Object.freeze(/** @type {const} */ ([0, 0.6])), Object.freeze(/** @type {const} */ ([1, 0.4]))]),
  B: Object.freeze([Object.freeze(/** @type {const} */ ([0, 0.2])), Object.freeze(/** @type {const} */ ([1, 0.8]))]),
  C: Object.freeze([Object.freeze(/** @type {const} */ ([1, 0.5])), Object.freeze(/** @type {const} */ ([2, 0.5]))]),
  D: Object.freeze([Object.freeze(/** @type {const} */ ([2, 0.4])), Object.freeze(/** @type {const} */ ([3, 0.6]))]),
});
/**
 * The level at which the matched rival starts against each bot. By the anchors of section 4.7.1 bot A is the level-1
 * mixture, B level 3, C level 5 and D lies between 6 and 7.
 */
const BOT_LEVEL = Object.freeze({ A: 1.5, B: 3, C: 5, D: 6.5 });
/** Level of a child's very first game (D-35). */
const FIRST_LEVEL = 2;
/** The rival of `high-A` starts this many levels above bot A. */
const TOO_HIGH = 3.5;
/** Games a child of the matched, coached and high pairings has played before (no first-games bonus). */
const GAMES_BEFORE = 5;

/** @typedef {'A'|'B'|'C'|'D'} BotName */
/** @typedef {'plain'|'matched'|'coached'|'high'|'first'|'firstc'} PairingKind */
/** @typedef {'table'|'slow'|'mid'|'fast'} PathName */
/** @typedef {TeachingChoice['mode']} Mode */
/** @typedef {TeachingChoice['kind']} Kind */

/**
 * @typedef {Object} Pairing
 * @property {string} name
 * @property {PairingKind} kind
 * @property {BotName} bot
 * @property {number} level        level of the profile the rival is given
 * @property {number} played       profile.games
 * @property {boolean} coached     诸葛亮 holds the bot's blunders
 * @property {boolean} teaching    false for the plain engine
 */

/** @param {PairingKind} kind @param {BotName} bot @returns {Pairing} */
function pairing(kind, bot) {
  const first = kind === 'first' || kind === 'firstc';
  return Object.freeze({
    name: `${kind}-${bot}`,
    kind,
    bot,
    level: first ? FIRST_LEVEL : kind === 'high' ? BOT_LEVEL[bot] + TOO_HIGH : BOT_LEVEL[bot],
    played: first || kind === 'plain' ? 0 : GAMES_BEFORE,
    coached: kind === 'coached' || kind === 'firstc',
    teaching: kind !== 'plain',
  });
}

/** @type {readonly BotName[]} */
const ALL_BOTS = Object.freeze(['A', 'B', 'C', 'D']);
/** @type {readonly BotName[]} */
const WEAK_BOTS = Object.freeze(['A', 'B']);
/** Every pairing, in the order of the table. @type {readonly Pairing[]} */
export const PAIRINGS = Object.freeze([
  ...ALL_BOTS.map(bot => pairing('plain', bot)),
  ...ALL_BOTS.map(bot => pairing('matched', bot)),
  ...ALL_BOTS.map(bot => pairing('coached', bot)),
  pairing('high', 'A'),
  ...WEAK_BOTS.map(bot => pairing('first', bot)),
  ...WEAK_BOTS.map(bot => pairing('firstc', bot)),
]);
/** `--only weak`: the pairings of the two weak bots against the teaching rival at their level and in their first game. */
const WEAK = Object.freeze(['matched-A', 'matched-B', 'coached-A', 'coached-B', 'first-A', 'first-B', 'firstc-A', 'firstc-B']);

/** @param {string} name @returns {Pairing} */
function pairingOf(name) {
  const found = PAIRINGS.find(p => p.name === name);
  if (!found) throw new RangeError(`unknown pairing ${name}`);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// The virtual clock and the devices
// ---------------------------------------------------------------------------------------------------------------

/** search.js reads the clock once per this many nodes (Appendix A3.2, item 2). */
const POLL_NODES = 2048;
/** Leaves of perft(start, 3), which the calibration of createBrain() times (Appendix A3.9). */
const CALIBRATION_LEAVES = 79666;

/**
 * The devices of the brain paths: the perft speed the calibration measures (it selects the plan row: fast from 3 M
 * leaves per second, mid from 1 M) and the search speed in nodes per second. `fast` is the dev machine of Appendix A1
 * as this build measures itself on it (calibration 8.6 to 9.0 M leaves per second, the rival's table search 2.1 M
 * nodes per second); `mid` is four times slower (the mid-range phone of A1); `slow` is ten times slower (the low-end
 * phone of A1, eight times slower, sits on the border between the mid and the slow row).
 * @type {Readonly<Record<Exclude<PathName, 'table'>, {perftNps:number, nps:number}>>}
 */
export const DEVICES = Object.freeze({
  fast: Object.freeze({ perftNps: 8_400_000, nps: 2_000_000 }),
  mid: Object.freeze({ perftNps: 2_100_000, nps: 500_000 }),
  slow: Object.freeze({ perftNps: 840_000, nps: 200_000 }),
});

/** The virtual clock of this thread: `now` advances by `tick` ms at every read. */
const clock = { now: 0, tick: 1 };
const virtualPerformance = /** @type {Performance} */ (/** @type {unknown} */ ({
  now: () => {
    clock.now += clock.tick;
    return clock.now;
  },
}));

/**
 * Runs `play` with the global `performance` replaced by the virtual clock (search.js and brain.js read the time from
 * that global at every use), and puts the real one back afterwards.
 * @template T
 * @param {() => Promise<T>} play
 * @returns {Promise<T>}
 */
async function onVirtualClock(play) {
  const real = globalThis.performance;
  clock.now = 0;
  clock.tick = 1;
  globalThis.performance = virtualPerformance;
  try {
    return await play();
  } finally {
    globalThis.performance = real;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

/** mulberry32: a small seeded generator, uniform in [0, 1). @param {number} seed uint32 @returns {() => number} */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The 32-bit seed of a game: of the game record (the teaching rival's random choices) and, mixed once more, of the bot.
 * It depends on the seed number and the bot's letter only, so every pairing of a bot plays paired games.
 * @param {number} seed the seed number of the game @param {BotName} bot
 * @returns {number} uint32
 */
export function gameSeed(seed, bot) {
  return (Math.imul(0x9E3779B9, seed) + bot.charCodeAt(0)) >>> 0;
}
/** Mixed into the game seed for the bot's own generator. */
const BOT_STREAM = 0xABCDEF;

/** @param {MoveRef} a @param {MoveRef} b @returns {boolean} */
function sameMove(a, b) {
  return a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
}

/** @param {{row:number, col:number}} square @returns {string} */
function squareKey(square) {
  return `${square.row},${square.col}`;
}

/** @param {MoveRef} move @returns {MoveRef} the move that takes it back */
function reversed(move) {
  return { from: move.to, to: move.from };
}

/** Value of a line of `table` that may not be exact at the table's depth, cp. @param {Analysis} table @param {RootLine} line @returns {number} */
function lineValue(table, line) {
  if (line.depth === table.depth) return scoreToCp(line.score);
  const shallow = table.allDepth >= 1 && line.byDepth.length >= table.allDepth ? scoreToCp(line.byDepth[table.allDepth - 1]) : scoreToCp(line.score);
  return line.upper === null ? shallow : Math.min(shallow, scoreToCp(line.upper));
}

/** The moves of a continuation the teacher hands over as a principal variation and the brain as a Line. @param {Line} line @returns {MoveRef[]} */
function movesOf(line) {
  const raw = /** @type {unknown} */ (line);
  return Array.isArray(raw) ? /** @type {MoveRef[]} */ (raw) : line.moves;
}

/** @param {number[]} values @returns {number} NaN for an empty list */
function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------------------------------------------
// The two ways the rival's move is found
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} RivalTurn
 * @property {TeachingChoice} choice
 * @property {Analysis} judge          the observer's table of the position
 * @property {boolean} own             `judge` is the table the choice was made on
 *
 * @typedef {Object} Engine
 * @property {() => void} reset                                                  a new game: nothing of the last one is left
 * @property {(fen:string, history:string[]) => Promise<Analysis>} childTable
 * @property {(turn:{fen:string, history:string[], ply:number, ctx:TeachingContext, plain:boolean}) => Promise<RivalTurn>} rival
 */

/** The plain engine's move as a choice: the best move of the table, played properly. @param {Analysis} table @returns {TeachingChoice} */
function plainChoice(table) {
  const best = table.lines[0];
  const evalBest = 0 - scoreToCp(best.score);
  return { move: best.move, line: best, mode: 'press', kind: 'honest', loss: 0, evalAfter: evalBest, evalBest, chance: null, overlooked: null };
}

/** `--path table`: chooseTeachingMove on a depth-bound table. @returns {Engine} */
function createTableEngine() {
  const searcher = createSearcher();
  return {
    reset() {
      searcher.clear();
    },
    async childTable(fen, history) {
      return searcher.analyzeSync({ fen, history, ...CHILD_TABLE, timeMs: UNBOUNDED_MS });
    },
    async rival({ fen, history, ctx, plain }) {
      const table = searcher.analyzeSync({ fen, history, ...JUDGE_TABLE, timeMs: UNBOUNDED_MS });
      if (plain) return { choice: plainChoice(table), judge: table, own: true };
      /** An exact single-move line at the table's depth (section 4.7.5). @param {MoveRef} move */
      const verify = async move => searcher.analyzeSync({
        fen, history, rootMoves: [move], allDepth: table.depth, maxDepth: table.depth, minDepth: Math.min(table.depth, 4), timeMs: UNBOUNDED_MS,
      }).lines[0];
      return { choice: await chooseTeachingMove(table, ctx, verify), judge: table, own: true };
    },
  };
}

/**
 * `--path slow|mid|fast`: the opponent job of the brain on the virtual clock of a device. A new brain per game: its
 * transposition table is the only thing a brain keeps, and a game must not depend on the games a worker played before.
 * @param {Exclude<PathName, 'table'>} device
 * @returns {Engine}
 */
function createBrainEngine(device) {
  const { perftNps, nps } = DEVICES[device];
  // The simulation's own searcher, for the bot's table and the observer's table. The brain under test searches nothing
  // but its own jobs, and the bot sees the same in every path: no deeper entry of the rival's table reaches its search.
  const own = createSearcher();
  /** @type {Brain|null} */
  let brain = null;
  let tensionPrev = 0.1;
  /** @type {number|null} */
  let evalBefore = null;
  /** @returns {Brain} */
  const current = () => {
    if (brain === null) throw new Error('the engine was not reset before the game');
    return brain;
  };
  return {
    reset() {
      clock.tick = CALIBRATION_LEAVES / perftNps * 1000;
      brain = createBrain();
      clock.tick = POLL_NODES / nps * 1000;
      if (brain.speed.speedClass !== device) throw new Error(`the virtual device calibrated as ${brain.speed.speedClass}, not ${device}`);
      own.clear();
      tensionPrev = 0.1;
      evalBefore = null;
    },
    async childTable(fen, history) {
      return own.analyzeSync({ fen, history, ...CHILD_TABLE, timeMs: UNBOUNDED_MS });
    },
    async rival({ fen, history, ply, ctx, plain }) {
      const judge = own.analyzeSync({ fen, history, ...JUDGE_TABLE, timeMs: UNBOUNDED_MS });
      if (plain) {
        const plan = planFor(device);
        // the table request of the opponent job (section 4.8.2), its best move played
        const table = await current().analyze({ fen, history, allDepth: plan.allDepth, multiPV: JUDGE_TABLE.multiPV, maxDepth: plan.opponentDepth, timeMs: plan.thinkMs });
        return { choice: plainChoice(table), judge, own: false };
      }
      const turn = await current().opponent({ fen, history, ply, ctx, tensionPrev, evalTwoPliesAgo: evalBefore });
      tensionPrev = turn.tension;
      evalBefore = turn.evalAfter;
      return { choice: turn.choice, judge, own: false };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The observer: what a person watching the rival would count (CONTRACT-NOTES 124 h to l, 104 a, c, d)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} RailCounts          per game; every rival move is looked at
 * @property {number} moves
 * @property {number} mate1              a mate in one was on the board
 * @property {number} mate1Miss          ... and the move played did not mate
 * @property {number} mate1Twice         (h) ... and neither did his move before, which had one too
 * @property {number} left2              (i) the same piece, capturable for a gain, left on two rival moves running
 * @property {number} left3              (i) ... on three
 * @property {number} left3plus          rival moves that lengthen such a run to three or more
 * @property {number} gifts              moves of kind chance or concession
 * @property {number} giftOver           (j) gifts that give up more than 500 cp
 * @property {number} giftMax            the largest gift, cp
 * @property {number} giftRook           (j) gifts whose line loses a rook for less than a rook
 * @property {number} recap              (k) taking back what the child just took was one of the best moves
 * @property {number} recapMiss          ... and he neither took back nor played a move as good
 * @property {number} rookBack           (k) the same, the child's piece being a rook
 * @property {number} rookBackMiss
 * @property {number} ahead              (l) rival moves made while 600 cp or more ahead
 * @property {number} aheadBack          ... that take his last move back
 * @property {number} back               moves that take his last move back, whatever the score
 * @property {number} giftTwice          104 (c): a gift right after a gift (the first game's guaranteed chance aside)
 * @property {number} giftAfterBlunder   104 (c): a gift as the answer to a blunder
 * @property {number} spareOverCap       104 (d): a spared mate beyond the level's cap
 * @property {number} pressSoft          104 (a): a move that is not proper play while the child was ahead of the band
 * @property {number} forbidden          rival moves that the repetition rule forbids (a perpetual check)
 *
 * @typedef {Object} NatCounts           per game: what was on offer for the rival and what he did with it
 * @property {number} mate1  @property {number} mate1Miss     a forced mate in one / not continued with a forced mate
 * @property {number} mate2  @property {number} mate2Miss
 * @property {number} mate3  @property {number} mate3Miss     three moves or more
 * @property {number} recap  @property {number} recapMiss     a winning recapture / not among the moves played
 * @property {number} enprise  @property {number} enpriseMiss a piece the child moved where it can be taken
 * @property {number} hang  @property {number} hangMiss       another piece that can be taken
 * @property {number} tactic  @property {number} tacticMiss   a win that is no capture
 * @property {number} backTwice                               he took his last move back twice running
 */

/** @returns {RailCounts} */
function newRailCounts() {
  return {
    moves: 0, mate1: 0, mate1Miss: 0, mate1Twice: 0, left2: 0, left3: 0, left3plus: 0, gifts: 0, giftOver: 0, giftMax: 0, giftRook: 0,
    recap: 0, recapMiss: 0, rookBack: 0, rookBackMiss: 0, ahead: 0, aheadBack: 0, back: 0,
    giftTwice: 0, giftAfterBlunder: 0, spareOverCap: 0, pressSoft: 0, forbidden: 0,
  };
}

/** @returns {NatCounts} */
function newNatCounts() {
  return {
    mate1: 0, mate1Miss: 0, mate2: 0, mate2Miss: 0, mate3: 0, mate3Miss: 0, recap: 0, recapMiss: 0, enprise: 0, enpriseMiss: 0,
    hang: 0, hangMiss: 0, tactic: 0, tacticMiss: 0, backTwice: 0,
  };
}

/** A gift never gives up more than this, cp (CONTRACT-NOTES 124 j). */
const GIFT_CAP = 500;
/** "Ahead" for rail (l), cp. */
const AHEAD = 600;
/** A capture whose static exchange value is at least this is a gain: the piece is there for the taking (rail i). */
const GAIN = 200;
/** Two moves within this many cp are equally good for the observer; also the margin of the winning group (section 4.6.4). */
const NEAR = 60;
/** The best move wins something when it beats every move outside the winning group by this much, cp (section 4.7.5, step 4). */
const SLIP = 150;
/** mateIn() of a repetition verdict is 50 or more (CONTRACT-NOTES 88). */
const VERDICT_MATE = 50;

/**
 * @typedef {Object} Watch               the observer's memory of one game
 * @property {RailCounts} rail
 * @property {NatCounts} nat
 * @property {Map<string, number>} hangRun      square -> rival moves running on which the piece there was left
 * @property {MoveRef|null} lastRival
 * @property {boolean} lastMate1Miss
 * @property {boolean} lastBack
 */

/** The observer's memory at the start of a game. @returns {Watch} */
export function newWatch() {
  return { rail: newRailCounts(), nat: newNatCounts(), hangRun: new Map(), lastRival: null, lastMate1Miss: false, lastBack: false };
}

/**
 * Looks at one rival move before it is played and counts. Returns the notes for the printed game.
 * @param {Watch} watch
 * @param {{board:Board, fen:string, full:Move, turn:RivalTurn, ctx:TeachingContext, forbidden:boolean,
 *          lastChildMove:MoveRef|null, lastChildCapture:boolean}} seen   board and fen: the position; full: the move he plays
 * @returns {{notes:string[], flags:string[]}} notes go behind the move, flags on lines of their own
 */
export function observe(watch, seen) {
  const { rail, nat } = watch;
  const { board, fen, full, ctx, lastChildMove, lastChildCapture } = seen;
  const { choice, judge, own } = seen.turn;
  const cp = scoreToCp;
  const best = judge.lines[0];
  const bestCp = cp(best.score);
  /** @param {RootLine} line */
  const valueOf = line => lineValue(judge, line);
  const chosenLine = judge.lines.find(line => sameMove(line.move, choice.move));
  if (!chosenLine) throw new Error(`the rival's move is not in the observer's table of ${fen}`);
  // On his own table the verified line is the better witness of what the move is worth.
  const chosenValue = own && choice.line.depth === judge.depth ? cp(choice.line.score) : valueOf(chosenLine);
  // With a brain path the rival chose on a table of his own (deeper than the observer's from level 5 up). His move then
  // counts as worse than another one only when his own search agrees: it put the move more than NEAR below his best.
  const agrees = own || choice.loss > NEAR;
  /** The move played is clearly worse than a move the observer values at `value`. @param {number} value */
  const worseThan = value => agrees && chosenValue < value - NEAR;
  const bestInfo = describeMove(board, best.move);
  const gift = choice.kind === 'chance' || choice.kind === 'concession';
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const flags = [];
  rail.moves += 1;
  if (seen.forbidden) {
    rail.forbidden += 1;
    flags.push('规则不许的长将');
  }

  // What was on offer: a forced mate, or a win that every other move misses.
  const winners = judge.lines.filter(line => line.depth === judge.depth && bestCp - cp(line.score) <= NEAR);
  let alt = -Infinity;
  for (const line of judge.lines) if (!winners.includes(line) && !(line.score >= WIN)) alt = Math.max(alt, valueOf(line));
  const inWinners = winners.some(line => sameMove(line.move, choice.move));
  const mate = mateIn(best.score);
  const mateAvail = best.score >= WIN && mate !== null && mate < VERDICT_MATE;
  if (mateAvail) {
    /** @type {readonly [keyof NatCounts, keyof NatCounts]} */
    const keys = mate >= 3 ? ['mate3', 'mate3Miss'] : mate === 2 ? ['mate2', 'mate2Miss'] : ['mate1', 'mate1Miss'];
    const kept = choice.line.score >= WIN;
    nat[keys[0]] += 1;
    if (!kept) nat[keys[1]] += 1;
    notes.push(`${mate} 步杀 ${bestInfo.notation}：${sameMove(best.move, choice.move) ? '走了' : kept ? '没走这一步，杀还在' : '放过'}`);
  } else if (alt > -Infinity && winners.length <= 3 && bestCp - alt >= SLIP) {
    const onLast = lastChildMove !== null && squareKey(best.move.to) === squareKey(lastChildMove.to);
    /** @type {readonly [keyof NatCounts, keyof NatCounts, string]} */
    const keys = onLast && lastChildCapture ? ['recap', 'recapMiss', '该吃回'] : onLast ? ['enprise', 'enpriseMiss', '送上门']
      : bestInfo.captured ? ['hang', 'hangMiss', '可白吃'] : ['tactic', 'tacticMiss', '有战术'];
    const missed = !inWinners && agrees;
    nat[keys[0]] += 1;
    if (missed) nat[keys[1]] += 1;
    notes.push(`${keys[2]} ${bestInfo.notation}${bestInfo.captured ? ` 吃${PIECE_WORD[bestInfo.captured]}` : ''} 赚 ${Math.round(bestCp - alt)}：`
      + `${inWinners ? '走了' : missed ? '放过' : '他算得更深，走了一步同样好的'}`);
  } else if (choice.loss >= 100) {
    notes.push(`最好是 ${bestInfo.notation}${bestInfo.captured ? ` 吃${PIECE_WORD[bestInfo.captured]}` : ''}`);
  }

  // (h) a mate in one left unplayed on two rival moves running
  const mate1 = best.score >= WIN && mate === 1;
  const mate1Miss = mate1 && getLegalMoves(applyMove(board, full), 'red').length > 0;
  if (mate1) rail.mate1 += 1;
  if (mate1Miss) rail.mate1Miss += 1;
  if (mate1Miss && watch.lastMate1Miss) {
    rail.mate1Twice += 1;
    flags.push('护栏 (h)：连续两步放过一步杀');
  }
  watch.lastMate1Miss = mate1Miss;

  // (i) the same piece of the child, capturable for a gain, neither taken nor answered by a move as good, three times running
  const pos = Position.fromFen(fen);
  const captures = new Int32Array(128);
  const count = pos.generate(captures, true);
  /** @type {Map<string, number>} */
  const gainAt = new Map();
  for (let i = 0; i < count; i++) {
    const gain = pos.see(captures[i]);
    if (!(gain >= GAIN)) continue;
    const to = mvTo(captures[i]);
    const key = squareKey({ row: rowOf(to), col: colOf(to) });
    gainAt.set(key, Math.max(gainAt.get(key) ?? 0, gain));
  }
  /** @type {Map<string, number>} */
  const runs = new Map();
  for (const [key, gain] of gainAt) {
    const fresh = lastChildMove !== null && key === squareKey(lastChildMove.to);       // a piece that has just arrived there
    const taking = judge.lines.filter(line => squareKey(line.move.to) === key);
    if (taking.length === 0) continue;
    const takingValue = Math.max(...taking.map(valueOf));
    if (squareKey(choice.move.to) === key || !worseThan(takingValue)) continue;
    const run = (fresh ? 0 : watch.hangRun.get(key) ?? 0) + 1;
    runs.set(key, run);
    if (run === 2) rail.left2 += 1;
    if (run === 3) rail.left3 += 1;
    if (run >= 3) rail.left3plus += 1;
    if (run >= 2) notes.push(`同一个子连续 ${run} 次没吃`);
    if (run >= 3) {
      const [row, col] = key.split(',').map(Number);
      const piece = board[row][col];
      flags.push(`护栏 (i)：${RED_FILES[col]}路${piece ? PIECE_WORD[piece.type] : '子'}连续 ${run} 次没吃（可赚 ${gain}）`);
    }
  }
  watch.hangRun = runs;

  // (j) a gift above 500 cp; a gift whose line loses a rook for less than a rook
  if (gift) {
    rail.gifts += 1;
    rail.giftMax = Math.max(rail.giftMax, Math.round(choice.loss));
    if (choice.loss > GIFT_CAP) {
      rail.giftOver += 1;
      flags.push(`护栏 (j)：这步让了 ${Math.round(choice.loss)} 分`);
    }
    let position = board;
    let rooks = 0, got = 0;                                // rooks the child takes along the line; what the rival takes
    for (let i = 0; i < choice.line.pv.length; i++) {
      const step = choice.line.pv[i];
      const move = getLegalMoves(position, i % 2 === 0 ? 'black' : 'red').find(m => sameMove(m, step));
      if (!move) break;
      if (move.captured && i % 2 === 0) got += PIECE_VALUE[move.captured.type];
      if (move.captured && i % 2 === 1 && move.captured.type === 'rook') rooks += 1;
      position = applyMove(position, move);
    }
    if (rooks > 0 && got < PIECE_VALUE.rook * rooks) {
      rail.giftRook += 1;
      flags.push(`护栏 (j)：这步白送一车（只换回 ${got} 分）`);
    }
    if (ctx.lastKind === 'chance' || ctx.lastKind === 'concession') {
      const guaranteed = ctx.firstGame && ctx.chances === 0 && ctx.moveNo >= 3 && ctx.moveNo <= 6;
      if (!guaranteed) rail.giftTwice += 1;
    }
    if (ctx.sinceBlunder === 0) rail.giftAfterBlunder += 1;
  }
  if (choice.overlooked?.mate && ctx.spared >= (ctx.level >= 3 ? 1 : 2)) rail.spareOverCap += 1;
  if ((choice.mode === 'press' || choice.mode === 'finish') && (gift || choice.kind === 'overlook')) rail.pressSoft += 1;

  // (k) a true recapture: the child's last move took a piece and taking back there is one of the best moves
  if (lastChildCapture && lastChildMove !== null) {
    const at = lastChildMove.to;
    const back = judge.lines.filter(line => squareKey(line.move.to) === squareKey(at));
    const backValue = back.length > 0 ? Math.max(...back.map(valueOf)) : -Infinity;
    if (backValue >= bestCp - NEAR) {
      const miss = squareKey(choice.move.to) !== squareKey(at) && worseThan(backValue);
      rail.recap += 1;
      if (miss) rail.recapMiss += 1;
      if (board[at.row][at.col]?.type === 'rook') {
        rail.rookBack += 1;
        if (miss) {
          rail.rookBackMiss += 1;
          flags.push('护栏 (k)：刚吃了子的车没被吃回');
        }
      }
    }
  }

  // (l) far ahead, he takes his last move back
  const back = watch.lastRival !== null && sameMove(choice.move, reversed(watch.lastRival));
  if (back) rail.back += 1;
  if (back && watch.lastBack) nat.backTwice += 1;
  if (bestCp >= AHEAD) {
    rail.ahead += 1;
    if (back) {
      rail.aheadBack += 1;
      flags.push(`护栏 (l)：领先 ${bestCp} 分还走回头路`);
    }
  }
  if (back) notes.push('走回头路');
  watch.lastBack = back;
  watch.lastRival = choice.move;

  if (choice.chance) {
    const offered = movesOf(choice.chance.line)[0];
    if (offered) {
      const info = describeMove(applyMove(board, full), offered);
      notes.push(`留给孩子 ${info.notation}${info.captured ? ` 吃${PIECE_WORD[info.captured]}` : ''}`);
    }
  }
  return { notes, flags };
}

/** Piece names for the printed games (one glyph per type; the side is clear from the column). */
const PIECE_WORD = Object.freeze({ king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '兵' });
/** The file of a column as red (the child) counts it. */
const RED_FILES = '九八七六五四三二一';

// ---------------------------------------------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} GameSpec
 * @property {string} pairing
 * @property {number} seed           the seed number
 * @property {PathName} path
 * @property {number} plyLimit
 * @property {boolean} print         keep the move list
 *
 * @typedef {Object} GameRecord
 * @property {string} pairing
 * @property {number} seed
 * @property {'win'|'loss'|'draw'} result          the child's result
 * @property {'mate'|'stopped'|'repetition'|'no_capture'|'no_attackers'|'move_limit'} reason     mate: the side to move has no legal move
 * @property {number} plies
 * @property {number} childMoves
 * @property {number} evalSum                      sum of the child's evaluation at its turns, cp
 * @property {number} inBand                       child turns with the evaluation within 300 cp
 * @property {number|null} firstCapture            ply of the child's first capture
 * @property {number} drift                        GameSkill.drift at the end
 * @property {number} shift
 * @property {number} level                        effective level at the end
 * @property {boolean} mateByChild                 the child won by playing the mating move
 * @property {Record<Mode, number>} modes
 * @property {Record<Kind, number>} kinds
 * @property {number} rivalMoves
 * @property {number} depthSum                     sum over the rival's moves of the depth his chosen line was searched to
 * @property {number} childLoss                    cp the child gave up (capped per move at 600)
 * @property {number} rivalLoss                    cp the rival gave up
 * @property {number} blunders                     child moves judged a blunder
 * @property {number} held                         first tries the strategist held and the bot replaced
 * @property {number} tests  @property {number} found       tactical tests the child met / found at the first try
 * @property {number} chances  @property {number} taken     chances offered / taken at once
 * @property {number} overlooked  @property {number} spared overlooks / of them forced mates
 * @property {RailCounts} rail
 * @property {NatCounts} nat
 * @property {string[]} [text]                     the game as a move list (only with `print`)
 */

/** Chinese words of the printed games. */
const RESULT_WORD = Object.freeze({ win: '孩子胜', loss: '孩子负', draw: '和棋' });
const REASON_WORD = Object.freeze({
  mate: '无子可动（将死或困毙）', stopped: '到手数上限，按最后的局面判', repetition: '三次重复局面', no_capture: '六十回合没有吃子',
  no_attackers: '双方都没有进攻的子', move_limit: '到总手数上限',
});

/**
 * Plays one game: the bot as red, the rival as black. The global clock is the virtual one for as long as the game runs.
 * @param {GameSpec} spec
 * @param {Engine} engine an engine of the spec's path (a worker keeps one per path and resets it for every game)
 * @returns {Promise<GameRecord>}
 */
function playGame(spec, engine) {
  return onVirtualClock(() => play(spec, engine));
}

/** @param {PathName} path @returns {Engine} */
function createEngine(path) {
  return path === 'table' ? createTableEngine() : createBrainEngine(path);
}

/** @param {GameSpec} spec @param {Engine} engine @returns {Promise<GameRecord>} */
async function play(spec, engine) {
  const pair = pairingOf(spec.pairing);
  const seed = gameSeed(spec.seed, pair.bot);
  const rnd = mulberry32(seed ^ BOT_STREAM);
  /** @type {SkillProfile} */
  const profile = { ...createSkillProfile(pair.level), games: pair.played };
  let skill = createGameSkill(seed);
  engine.reset();

  let board = createInitialBoard();
  /** @type {'red'|'black'} */
  let turn = 'red';
  const startKey = positionKey(board, turn);
  /** @type {PlyRecord[]} */
  const log = [];
  /** FENs of the positions since the last capture, the current one excluded. @type {string[]} */
  let history = [];
  const watch = newWatch();
  /** @type {GameRecord} */
  const record = {
    pairing: pair.name, seed: spec.seed, result: 'draw', reason: 'stopped', plies: 0, childMoves: 0, evalSum: 0, inBand: 0, firstCapture: null,
    drift: 0, shift: 0, level: pair.level, mateByChild: false,
    modes: { press: 0, spar: 0, ease: 0, finish: 0 },
    kinds: { honest: 0, variety: 0, overlook: 0, chance: 0, concession: 0, finisher: 0 },
    rivalMoves: 0, depthSum: 0, childLoss: 0, rivalLoss: 0, blunders: 0, held: 0, tests: 0, found: 0, chances: 0, taken: 0, overlooked: 0, spared: 0,
    rail: watch.rail, nat: watch.nat,
  };
  /** @type {string[]} */
  const text = [];
  let childNote = '';
  let lastEval = 0;
  /** @type {MoveRef|null} */
  let lastChildMove = null;
  let lastChildCapture = false;
  /** @type {NonNullable<TeachingChoice['chance']>|null} */
  let pendingChance = null;

  let ply = 0;
  for (;; ply++) {
    const legal = getLegalMoves(board, turn);
    if (legal.length === 0) {
      record.result = turn === 'red' ? 'loss' : 'win';
      record.reason = 'mate';
      break;
    }
    const draw = drawStatus(startKey, log, board, ply);
    if (draw.draw && draw.reason !== null) {
      record.result = 'draw';
      record.reason = draw.reason;
      break;
    }
    if (ply >= spec.plyLimit) {
      record.result = lastEval > STOPPED_MARGIN ? 'win' : lastEval < -STOPPED_MARGIN ? 'loss' : 'draw';
      record.reason = 'stopped';
      break;
    }
    const fen = boardToFen(board, turn);
    const playable = playableMoves(startKey, log, board, turn);
    /** @type {MoveRef} */
    let move;

    if (turn === 'red') {
      // ---- the child ----
      const table = await engine.childTable(fen, history);
      const allowed = table.lines.filter(line => playable.some(m => sameMove(m, line.move)));
      const pool = allowed.length > 0 ? allowed : table.lines;
      const mix = BOTS[pair.bot];
      let vision = mix[0][0];
      let r = rnd();
      for (const [depth, share] of mix) {
        if (r < share) {
          vision = depth;
          break;
        }
        r -= share;
      }
      /** The best move of a search of depth `depth` (0: the glance), as this bot sees it. @param {number} depth */
      const choose = depth => {
        let pick = pool[0], top = -Infinity;
        for (const line of pool) {
          const seen = depth === 0 ? line.naive : line.byDepth[Math.min(depth, line.byDepth.length) - 1];
          const value = seen + (rnd() - 0.5) * VISION_NOISE;
          if (value > top) {
            top = value;
            pick = line;
          }
        }
        return pick;
      };
      const level = effectiveLevel(profile, skill);
      const bestCp = scoreToCp(table.lines[0].score);
      /** One try as the game would judge it from the table (section 4.7.2). @param {RootLine} line @returns {MoveSample['first']} */
      const tryOf = line => {
        const quick = quickVerdict(table, line.move, level);
        if (quick === null) {
          // The table is deep enough, so the line is one that only lets the position come back: the quick verdict waits
          // for the assessment (CONTRACT-NOTES 150, V6), which finds at most a 缓着 and holds nothing. The game records a
          // move without a verdict as good with no loss (director.js), and so does the simulation.
          if (table.depth < 2) throw new Error(`no verdict for a move of the table of ${fen}`);
          return { move: describeMove(board, line.move), loss: 0, cat: 'good' };
        }
        return { move: describeMove(board, line.move), loss: Math.min(LOSS_CAP, quick.loss), cat: quick.cat };
      };
      const firstPick = choose(vision);
      const first = tryOf(firstPick);
      let pick = firstPick;
      let tries = 1;
      if (pair.coached && first.loss >= HELD_LOSS && rnd() < COACH_HEED) {       // the strategist holds the move; the bot looks again
        pick = choose(Math.min(table.allDepth, vision + SECOND_LOOK));
        tries = 2;
      }
      const final = pick === firstPick ? { ...first } : tryOf(pick);
      const test = tacticalTest(fen, table, positionFacts(fen, { ply }));
      /** @type {MoveSample} */
      const sample = {
        ply, first, final, tries, hint: 0, hintMax: 0, self: true, bestCp, legalCount: table.lines.length,
        test: test === null ? null : { tier: test.tier, kind: test.kind, found: test.group.some(m => sameMove(m, firstPick.move)) },
        danger: null, habit: null, avoided: null, patterns: [], captured: final.move.captured, thinkMs: 0,
      };
      skill = recordChildMove(profile, skill, sample);

      lastEval = bestCp;
      record.evalSum += bestCp;
      if (Math.abs(bestCp) <= BAND) record.inBand += 1;
      record.childMoves += 1;
      record.childLoss += final.loss;
      if (final.cat === 'blunder') record.blunders += 1;
      if (tries === 2) record.held += 1;
      if (sample.test !== null) {
        record.tests += 1;
        if (sample.test.found) record.found += 1;
      }
      if (final.move.captured && record.firstCapture === null) record.firstCapture = ply;
      if (pendingChance !== null) {
        if (final.loss <= TAKEN_SHARE * pendingChance.gain) record.taken += 1;
        pendingChance = null;
      }
      move = pick.move;
      lastChildMove = pick.move;
      lastChildCapture = final.move.captured !== null;
      if (spec.print) {
        childNote = `${String(ply / 2 + 1).padStart(3)}. ${final.move.notation}${final.move.captured ? ` 吃${PIECE_WORD[final.move.captured]}` : ''}`
          + ` (${bestCp}${final.loss >= 100 ? `, -${Math.round(final.loss)} ${final.cat}` : ''}${tries === 2 ? ', 军师提醒后改走' : ''})`;
      }
    } else {
      // ---- the rival ----
      const moveNo = (ply + 1) / 2;
      const ctx = teachingContext(profile, skill, { moveNo, lastChildMove, lastChildCapture });
      const rivalTurn = await engine.rival({ fen, history, ply, ctx, plain: !pair.teaching });
      const { choice } = rivalTurn;
      const full = legal.find(m => sameMove(m, choice.move));
      if (!full) throw new Error(`the rival chose an illegal move in ${fen}`);
      const forbidden = !playable.some(m => sameMove(m, choice.move));
      const { notes, flags } = observe(watch, { board, fen, full, turn: rivalTurn, ctx, forbidden, lastChildMove, lastChildCapture });
      skill = recordOpponentMove(skill, ply, choice);

      record.modes[choice.mode] += 1;
      record.kinds[choice.kind] += 1;
      record.rivalMoves += 1;
      record.depthSum += choice.line.depth;
      record.rivalLoss += choice.loss;
      if (choice.chance) {
        record.chances += 1;
        pendingChance = choice.chance;
      }
      if (choice.overlooked) {
        record.overlooked += 1;
        if (choice.overlooked.mate) record.spared += 1;
      }
      move = choice.move;
      if (spec.print) {
        const info = describeMove(board, choice.move);
        const tags = `${choice.mode} ${choice.kind}${choice.loss >= 1 ? ` -${Math.round(choice.loss)}` : ''}`
          + `${choice.chance ? ` 机会 ${Math.round(choice.chance.gain)} 深 ${choice.chance.revealDepth}` : ''} L${ctx.level.toFixed(1)}`;
        text.push(`${padEnd(childNote, 46)} ${info.notation}${info.captured ? ` 吃${PIECE_WORD[info.captured]}` : ''} [${tags}]${notes.map(n => ` {${n}}`).join('')}`);
        for (const flag of flags) text.push(`      ^^ ${flag}`);
        childNote = '';
      }
    }

    const full = legal.find(m => sameMove(m, move));
    if (!full) throw new Error(`an illegal move was chosen in ${fen}`);
    const played = plyRecord(board, full);
    log.push(played);
    history = played.capture ? [] : [...history, fen];
    board = applyMove(board, full);
    turn = turn === 'red' ? 'black' : 'red';
  }

  record.plies = ply;
  record.drift = skill.drift;
  record.shift = skill.shift;
  record.level = effectiveLevel(profile, skill);
  record.mateByChild = record.result === 'win' && record.reason === 'mate';
  if (spec.print) {
    if (childNote) text.push(childNote);
    record.text = [
      `=== ${pair.name} · 种子 ${spec.seed} · 走法 ${spec.path} · 起始等级 ${pair.level} · ${RESULT_WORD[record.result]}（${REASON_WORD[record.reason]}），孩子走了 ${record.childMoves} 步 ===`,
      '    左：孩子（红）的着法（走之前孩子眼里的局面分，丢分和评级，是否被军师拦过）；右：司马懿（黑）的着法 [模式 类别 -让出的分 L当时等级] {旁观者看到的}',
      ...text,
    ];
  }
  return record;
}

// ---------------------------------------------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} PairingStats
 * @property {string} name
 * @property {number} games
 * @property {number} wins  @property {number} draws  @property {number} losses
 * @property {number} score            (wins + draws / 2) / games
 * @property {number} evalMean         mean over the games of the game's mean child evaluation, cp
 * @property {number} evalPooled       mean over all child turns
 * @property {number} band             mean over the games of the share of child turns within 300 cp
 * @property {number} drift            mean final drift
 * @property {number} length           median number of child moves
 * @property {number} long             share of the games in which the child made LONG_GAME moves or more
 * @property {number} firstCapture     median ply of the child's first capture (a game without one counts as NO_CAPTURE)
 * @property {number} mates            wins in which the child played the mating move
 * @property {number} spared           spared mates per game
 * @property {number} gifts            chances and concessions per game
 * @property {number} overlooks        overlooks per game
 * @property {number} depth            mean depth of the rival's chosen line
 * @property {number} childLoss        cp the child gave up per move
 * @property {number} rivalLoss        cp the rival gave up per move
 * @property {Record<Mode, number>} modes    share of the rival's moves
 * @property {Record<Kind, number>} kinds    share of the rival's moves
 *
 * @typedef {Object} Summary
 * @property {PairingStats[]} pairings   the pairings that have at least one game, in table order
 * @property {number} games              teaching games (every pairing but the plain engine)
 * @property {number} wins               the child's wins in them
 * @property {number} mates              ... by a mate the child played
 * @property {RailCounts} rail           sums over the teaching games (giftMax: the maximum)
 * @property {NatCounts} nat
 * @property {number} mate1TwiceGames    teaching games with pattern (h)
 * @property {number} left3Games         teaching games with pattern (i)
 * @property {number} long               teaching games in which the child made LONG_GAME moves or more
 */

/** What a game without a capture by the child counts as in the median of the first capture. */
const NO_CAPTURE = 999;
/** A game is long from this many child moves on: the median does not show how many games drag on without a decision. */
const LONG_GAME = 100;

/**
 * Game records -> the numbers of the table and of the bars. The order of the records does not matter.
 * @param {GameRecord[]} records
 * @returns {Summary}
 */
export function summarize(records) {
  /** @param {number[]} values */
  const mean = values => (values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length);
  /** @param {GameRecord[]} games @param {(g:GameRecord) => number} of */
  const sum = (games, of) => games.reduce((a, g) => a + of(g), 0);
  /** @type {PairingStats[]} */
  const pairings = [];
  for (const pair of PAIRINGS) {
    const games = records.filter(g => g.pairing === pair.name);
    if (games.length === 0) continue;
    const wins = games.filter(g => g.result === 'win').length, draws = games.filter(g => g.result === 'draw').length;
    const rivalMoves = Math.max(1, sum(games, g => g.rivalMoves));
    const childMoves = Math.max(1, sum(games, g => g.childMoves));
    /** @type {Record<Mode, number>} */
    const modes = { press: 0, spar: 0, ease: 0, finish: 0 };
    for (const mode of MODES) modes[mode] = sum(games, g => g.modes[mode]) / rivalMoves;
    /** @type {Record<Kind, number>} */
    const kinds = { honest: 0, variety: 0, overlook: 0, chance: 0, concession: 0, finisher: 0 };
    for (const kind of KINDS) kinds[kind] = sum(games, g => g.kinds[kind]) / rivalMoves;
    pairings.push({
      name: pair.name,
      games: games.length,
      wins,
      draws,
      losses: games.length - wins - draws,
      score: (wins + draws / 2) / games.length,
      evalMean: mean(games.map(g => g.evalSum / Math.max(1, g.childMoves))),
      evalPooled: sum(games, g => g.evalSum) / childMoves,
      band: mean(games.map(g => g.inBand / Math.max(1, g.childMoves))),
      drift: mean(games.map(g => g.drift)),
      length: median(games.map(g => g.childMoves)),
      long: games.filter(g => g.childMoves >= LONG_GAME).length / games.length,
      firstCapture: median(games.map(g => g.firstCapture ?? NO_CAPTURE)),
      mates: games.filter(g => g.mateByChild).length,
      spared: mean(games.map(g => g.spared)),
      gifts: mean(games.map(g => g.kinds.chance + g.kinds.concession)),
      overlooks: mean(games.map(g => g.overlooked)),
      depth: sum(games, g => g.depthSum) / rivalMoves,
      childLoss: sum(games, g => g.childLoss) / childMoves,
      rivalLoss: sum(games, g => g.rivalLoss) / rivalMoves,
      modes,
      kinds,
    });
  }
  const teaching = records.filter(g => pairingOf(g.pairing).teaching);
  const rail = newRailCounts();
  const nat = newNatCounts();
  for (const game of teaching) {
    for (const key of RAIL_KEYS) rail[key] = key === 'giftMax' ? Math.max(rail[key], game.rail[key]) : rail[key] + game.rail[key];
    for (const key of NAT_KEYS) nat[key] += game.nat[key];
  }
  return {
    pairings,
    games: teaching.length,
    wins: teaching.filter(g => g.result === 'win').length,
    mates: teaching.filter(g => g.mateByChild).length,
    rail,
    nat,
    mate1TwiceGames: teaching.filter(g => g.rail.mate1Twice > 0).length,
    left3Games: teaching.filter(g => g.rail.left3 > 0).length,
    long: teaching.filter(g => g.childMoves >= LONG_GAME).length,
  };
}

/** @type {readonly Mode[]} */
const MODES = Object.freeze(['press', 'spar', 'ease', 'finish']);
/** @type {readonly Kind[]} */
const KINDS = Object.freeze(['honest', 'variety', 'overlook', 'chance', 'concession', 'finisher']);
const RAIL_KEYS = /** @type {(keyof RailCounts)[]} */ (Object.keys(newRailCounts()));
const NAT_KEYS = /** @type {(keyof NatCounts)[]} */ (Object.keys(newNatCounts()));

// ---------------------------------------------------------------------------------------------------------------
// The bars (CONTRACT-NOTES 130, with the changes of 143 d)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} BarResult
 * @property {string} id
 * @property {boolean} dagger          the bar also applies to a quick look (fewer than 64 games per pairing)
 * @property {string} subject          the pairing, or what the bar is about
 * @property {string} what             what is measured
 * @property {string} value            the reached value as printed
 * @property {string} bar              the bar as printed ('' for a number that is printed only)
 * @property {'pass'|'fail'|'info'|'quick'|'missing'} status
 *    pass / fail: the bar applies; info: printed only; quick: not applied to a quick look; missing: nothing to measure
 */

/** @param {number} x @returns {string} */
const signed = x => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${Math.round(x)}` : '-');
/** @param {number} x @returns {string} */
const percent = x => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-');
/** The finer forms of the bar lines, so that a number just beyond its bar does not print as the bar itself. @param {number} x @returns {string} */
const signedFine = x => `${x > 0 ? '+' : ''}${x.toFixed(1)}`;
/** @param {number} x @returns {string} */
const percentFine = x => `${(x * 100).toFixed(1)}%`;
/** @param {number} part @param {number} whole @returns {string} */
const ratio = (part, whole) => (whole > 0 ? `${(100 * part / whole).toFixed(1)}%（${part}/${whole}）` : `-（0/0）`);

/**
 * Applies the bars to a summary. `full` = every pairing has at least 64 games; otherwise only the bars marked † apply.
 * A pairing that was not played has no bar.
 * @param {Summary} summary
 * @param {boolean} full
 * @returns {BarResult[]}
 */
export function judgeBars(summary, full) {
  /** @type {BarResult[]} */
  const bars = [];
  /**
   * @param {string} id @param {boolean} dagger @param {string} subject @param {string} what @param {string} value @param {string} bar
   * @param {boolean|null} met null = nothing to measure
   */
  const add = (id, dagger, subject, what, value, bar, met) => {
    const status = met === null ? 'missing' : bar === '' ? 'info' : !dagger && !full ? 'quick' : met ? 'pass' : 'fail';
    bars.push({ id, dagger, subject, what, value: met === null ? '-' : value, bar, status });
  };
  /**
   * A bar on one number of one pairing.
   * @param {string} name @param {string} key @param {boolean} dagger @param {string} what @param {(s:PairingStats) => number} of
   * @param {(x:number) => string} show @param {string} bar @param {(x:number) => boolean} test
   */
  const on = (name, key, dagger, what, of, show, bar, test) => {
    const stats = summary.pairings.find(p => p.name === name);
    if (stats !== undefined) add(`${name}.${key}`, dagger, name, what, show(of(stats)), bar, test(of(stats)));
  };

  for (const bot of ALL_BOTS) on(`plain-${bot}`, 'eval', false, '平均局面', s => s.evalMean, signedFine, '低于 -400', x => x < -400);
  on('matched-A', 'eval', false, '平均局面', s => s.evalMean, signedFine, '不低于 -450', x => x >= -450);
  for (const bot of ['B', 'C', 'D']) on(`matched-${bot}`, 'eval', false, '平均局面', s => s.evalMean, signedFine, '在 -150 到 +350 之间', x => x >= -150 && x <= 350);
  for (const [bot, floor] of /** @type {const} */ ([['A', 0.45], ['B', 0.50], ['C', 0.60], ['D', 0.60]])) {
    on(`matched-${bot}`, 'band', false, '±300 以内的回合', s => s.band, percentFine, `不少于 ${percent(floor)}`, x => x >= floor);
  }
  for (const [bot, floor] of /** @type {const} */ ([['A', 0.3], ['B', 0.4], ['C', 0.4], ['D', 0.4]])) {
    on(`coached-${bot}`, 'score', false, '得分', s => s.score, x => x.toFixed(3), `不少于 ${floor.toFixed(2)}`, x => x >= floor);
  }
  for (const bot of ALL_BOTS) on(`coached-${bot}`, 'length', false, '孩子步数的中位', s => s.length, String, '不超过 85', x => x <= 85);
  on('high-A', 'drift', true, '终局时的 drift', s => s.drift, x => x.toFixed(2), '不高于 -1.50', x => x <= -1.5);
  on('firstc-B', 'score', false, '第一盘得分', s => s.score, percentFine, '不少于 60%', x => x >= 0.6);
  on('first-B', 'score', false, '第一盘得分', s => s.score, percentFine, '不少于 30%', x => x >= 0.3);
  on('firstc-A', 'score', false, '第一盘得分', s => s.score, percentFine, '不少于 45%', x => x >= 0.45);
  on('first-A', 'score', false, '第一盘得分', s => s.score, percentFine, '', () => true);
  for (const name of ['first-A', 'first-B', 'firstc-A', 'firstc-B']) {
    on(name, 'capture', true, '第一次吃子的 ply（中位）', s => s.firstCapture, x => (x >= NO_CAPTURE ? '没有吃子' : String(x)), '不晚于 14', x => x <= 14);
  }

  const { rail } = summary;
  const all = '教学对局合计';
  const some = summary.games > 0;
  add('mates', true, all, '孩子赢的棋里亲手将死的', ratio(summary.mates, summary.wins), '不少于 50%', summary.wins > 0 ? summary.mates / summary.wins >= 0.5 : null);
  add('rail.h', true, all, '(h) 连续两步放过一步杀的对局', `${summary.mate1TwiceGames} 局`, '一局也没有', some ? summary.mate1TwiceGames === 0 : null);
  add('rail.i', false, all, '(i) 同一个子连续三次没吃的对局', ratio(summary.left3Games, summary.games), '不超过 2%', some ? summary.left3Games / summary.games <= 0.02 : null);
  add('rail.j', true, all, '(j) 让出 500 分以上 / 白送一车', `${rail.giftOver} 次 / ${rail.giftRook} 次（最大一次让 ${rail.giftMax} 分）`, '都是 0 次',
    some ? rail.giftOver === 0 && rail.giftRook === 0 : null);
  add('rail.k', false, all, '(k) 该吃回的车没吃回', ratio(rail.rookBackMiss, rail.rookBack), '不超过 1%', rail.rookBack > 0 ? rail.rookBackMiss / rail.rookBack <= 0.01 : null);
  add('rail.l', false, all, '(l) 领先 600 分以上时走回头路', ratio(rail.aheadBack, rail.ahead), '不超过 4%', rail.ahead > 0 ? rail.aheadBack / rail.ahead <= 0.04 : null);
  // Long games (CONTRACT-NOTES 143 d): a game in which the child made LONG_GAME moves or more is over forty minutes at the
  // board. One bar over all games against the teaching rival, one on the pairing that has the most of them. The
  // numbers are regression guards, not targets (CONTRACT-NOTES 151): before the wrap-up 12 to 15 % of the teaching
  // games were long and 31 to 41 % in the worst pairing; with it 7 to 8 % and about 22 % (mid, 64 games per pairing).
  add('long.all', false, all, `孩子走满 ${LONG_GAME} 步的对局`, ratio(summary.long, summary.games), '不超过 10%', some ? summary.long / summary.games <= 0.1 : null);
  /** @type {PairingStats|null} */
  let worst = null;
  for (const stats of summary.pairings) if (pairingOf(stats.name).teaching && (worst === null || stats.long > worst.long)) worst = stats;
  add('long.worst', false, all, `孩子走满 ${LONG_GAME} 步的对局最多的一组`, worst === null ? '-' : `${percentFine(worst.long)}（${worst.name}）`, '不超过 33%',
    worst === null ? null : worst.long <= 0.33);
  return bars;
}

/** @param {BarResult[]} bars @returns {number} bars that apply and are not met */
export function failedBars(bars) {
  return bars.filter(bar => bar.status === 'fail').length;
}

// ---------------------------------------------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------------------------------------------

/** Width of a string on a terminal: a CJK character takes two columns. @param {string} text @returns {number} */
function widthOf(text) {
  let width = 0;
  for (const ch of text) width += /** @type {number} */ (ch.codePointAt(0)) >= 0x2E80 ? 2 : 1;
  return width;
}
/** @param {string} text @param {number} width @returns {string} */
function padEnd(text, width) {
  return text + ' '.repeat(Math.max(0, width - widthOf(text)));
}
/** @param {string} text @param {number} width @returns {string} */
function padStart(text, width) {
  return ' '.repeat(Math.max(0, width - widthOf(text))) + text;
}

const PATH_WORD = Object.freeze({
  table: '定深的表（深度 5，全部着法算到深度 3），CONTRACT-NOTES 130 的量法，最快',
  slow: '对局本身的 opponent 任务，虚拟时钟，慢速设备（slow 档）；司马懿的表按他的等级算到深度 5 或 6',
  mid: '对局本身的 opponent 任务，虚拟时钟，中速设备（mid 档）；司马懿的表按他的等级算到深度 5 至 7；发布前另用 --path fast 再量一遍',
  fast: '对局本身的 opponent 任务，虚拟时钟，快速设备（fast 档）；司马懿的表按他的等级算到深度 5 至 8',
});
const STATUS_WORD = Object.freeze({ pass: '通过', fail: '未达标', info: '只打印', quick: '不计', missing: '无数据' });

/** The columns of the table: header, width, and the cell of a pairing. @type {readonly (readonly [string, number, (s:PairingStats) => string])[]} */
const COLUMNS = Object.freeze([
  ['局数', 5, s => String(s.games)],
  ['胜/和/负', 10, s => `${s.wins}/${s.draws}/${s.losses}`],
  ['得分', 6, s => percent(s.score)],
  ['平均局面', 9, s => signed(s.evalMean)],
  ['±300内', 8, s => percent(s.band)],
  ['drift', 7, s => s.drift.toFixed(2)],
  ['步数', 6, s => String(s.length)],
  ['首吃', 5, s => (s.firstCapture >= NO_CAPTURE ? '-' : String(s.firstCapture))],
  ['绝杀/胜', 9, s => `${s.mates}/${s.wins}`],
  ['长局', 6, s => percent(s.long)],
  ['放杀/局', 9, s => s.spared.toFixed(2)],
  ['让子/局', 9, s => s.gifts.toFixed(1)],
  ['漏看/局', 9, s => s.overlooks.toFixed(1)],
  ['深度', 6, s => s.depth.toFixed(1)],
]);

/**
 * The table, one line per pairing.
 * @param {Summary} summary
 * @returns {string[]}
 */
export function tableLines(summary) {
  const head = padEnd('对局', 11) + COLUMNS.map(([title, width]) => padStart(title, width)).join('');
  const rows = summary.pairings.map(s => padEnd(s.name, 11) + COLUMNS.map(([, width, cell]) => padStart(cell(s), width)).join(''));
  return [head, ...rows];
}

/**
 * One line per bar: status, †, subject, what, the reached value and the bar.
 * @param {BarResult[]} bars
 * @returns {string[]}
 */
export function barLines(bars) {
  return bars.map(bar => `  ${padEnd(STATUS_WORD[bar.status], 7)}${bar.dagger ? '† ' : '  '}${padEnd(bar.subject, 13)}${bar.what} ${bar.value}${bar.bar ? `（线：${bar.bar}）` : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------
// The worker pool
// ---------------------------------------------------------------------------------------------------------------

/** Marks the worker threads this file starts for itself. */
const WORKER_ROLE = 'yijian-sim-worker';

/**
 * @typedef {Object} RunOptions
 * @property {number} games              games per pairing
 * @property {number} seed               the first seed number
 * @property {string[]|null} only        pairing names, or null for all
 * @property {PathName} path
 * @property {number} jobs               worker threads
 * @property {boolean} [print]           keep the move list of every game
 * @property {number} [plyLimit]         PLY_LIMIT unless a test shortens the games
 * @property {number} [gameTimeoutMs]    GAME_TIMEOUT_MS unless a test shortens it
 * @property {(done:number, total:number) => void} [onProgress]
 *
 * @typedef {{pairing:string, seed:number, error:string}} FailedGame
 * @typedef {{records:GameRecord[], failed:FailedGame[]}} RunResult      records in table order, then by seed
 */

/**
 * Plays every game of the options on worker threads. Resolves when every game has an answer: a record, or a failure
 * (the worker threw, died, or did not finish the game in time; such a worker is replaced).
 * @param {RunOptions} options
 * @returns {Promise<RunResult>}
 */
export function runSimulation(options) {
  const names = options.only ?? PAIRINGS.map(p => p.name);
  /** @type {GameSpec[]} */
  const specs = [];
  for (const pair of PAIRINGS) {
    if (!names.includes(pair.name)) continue;
    for (let i = 0; i < options.games; i++) {
      specs.push({ pairing: pair.name, seed: options.seed + i, path: options.path, plyLimit: options.plyLimit ?? PLY_LIMIT, print: options.print === true });
    }
  }
  const timeoutMs = options.gameTimeoutMs ?? GAME_TIMEOUT_MS;
  /** @type {(GameRecord|null)[]} */
  const records = new Array(specs.length).fill(null);
  /** @type {FailedGame[]} */
  const failed = [];
  let next = 0, done = 0;
  /** @type {Set<Worker>} */
  const workers = new Set();

  return new Promise(resolveRun => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const worker of workers) void worker.terminate();
      resolveRun({ records: /** @type {GameRecord[]} */ (records.filter(r => r !== null)), failed });
    };

    const spawn = () => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { role: WORKER_ROLE }, resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: WORKER_YOUNG_MB } });
      workers.add(worker);
      let index = -1;                                      // the game this worker is playing
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let timer;
      let retired = false;

      /** The game in hand has its answer. @param {string|null} error */
      const settle = error => {
        clearTimeout(timer);
        if (index < 0) return;
        if (error !== null) failed.push({ pairing: specs[index].pairing, seed: specs[index].seed, error });
        index = -1;
        done += 1;
        options.onProgress?.(done, specs.length);
      };
      const give = () => {
        if (settled) return;
        if (next >= specs.length) {
          retire();
          if (done >= specs.length) finish();
          return;
        }
        index = next++;
        timer = setTimeout(() => replace(`not finished within ${timeoutMs / 1000} s`), timeoutMs);
        worker.postMessage(specs[index]);
      };
      const retire = () => {
        if (retired) return;
        retired = true;
        workers.delete(worker);
        void worker.terminate();
      };
      /** The worker is given up: its game failed, and another worker takes its place. @param {string} error */
      const replace = error => {
        if (retired) return;
        settle(error);
        retire();
        if (settled) return;
        if (next < specs.length) spawn();
        else if (done >= specs.length) finish();
      };

      worker.on('message', (/** @type {{record?:GameRecord, error?:string}} */ answer) => {
        if (retired || index < 0) return;
        if (answer.record) {
          records[index] = answer.record;
          settle(null);
        } else {
          settle(answer.error ?? 'no record');
        }
        give();
      });
      worker.on('error', error => replace(`worker error: ${error.message}`));
      worker.on('exit', code => replace(`worker exited with code ${code}`));
      give();
    };

    if (specs.length === 0) {
      finish();
      return;
    }
    // at least one worker, whatever `jobs` holds: a run without a worker would never end
    const count = Math.max(1, Math.min(Math.floor(options.jobs) || 1, specs.length));
    for (let i = 0; i < count; i++) spawn();
  });
}

/** The loop of a worker thread: one game at a time, each answered with its record or with the error it threw. */
function serveGames() {
  const port = parentPort;
  if (port === null) return;
  /** @type {Map<PathName, Engine>} */
  const engines = new Map();
  port.on('message', (/** @type {GameSpec} */ spec) => {
    let engine = engines.get(spec.path);
    if (engine === undefined) {
      engine = createEngine(spec.path);
      engines.set(spec.path, engine);
    }
    playGame(spec, engine).then(
      record => port.postMessage({ record }),
      error => port.postMessage({ error: error instanceof Error ? error.message : String(error) }),
    );
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {number} [processors] the processor count of this machine unless given
 * @returns {number} the default number of workers: the processor count minus two, at most 8, at least 1
 */
export function defaultJobs(processors = os.availableParallelism()) {
  return Math.max(1, Math.min(MAX_DEFAULT_JOBS, processors - 2));
}

/**
 * @typedef {Object} Options
 * @property {number} games
 * @property {number} seed
 * @property {string[]|null} only        pairing names in table order, or null for all
 * @property {PathName} path
 * @property {number} jobs
 * @property {string|null} json
 * @property {string|null} print
 * @property {boolean} help
 */

/** Games that did not finish are listed one by one up to this many. */
const FAILURES_SHOWN = 10;

/** The path the script uses unless `--path` says otherwise. @type {PathName} */
export const DEFAULT_PATH = 'mid';

/**
 * @param {string[]} argv
 * @returns {Options}
 * @throws {Error} for an unknown option or a value that cannot be used
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const options = { games: FULL_GAMES, seed: DEFAULT_SEED, only: null, path: DEFAULT_PATH, jobs: defaultJobs(), json: null, print: null, help: false };
  /** @param {string} flag @param {string} value @param {number} min @param {number} max */
  const integer = (flag, value, min, max) => {
    if (!/^\d{1,9}$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${flag} must be a whole number from ${min} to ${max}`);
    return Number(value);
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if ((flag === '--help' || flag === '-h') && inline === undefined) {
      options.help = true;
      continue;
    }
    if (!['--games', '--seed', '--only', '--path', '--jobs', '--json', '--print'].includes(flag)) throw new Error(`unknown option ${argv[i]}`);
    const value = inline ?? argv[++i];
    if (value === undefined || value === '') throw new Error(`${flag} needs a value`);
    if (flag === '--games') options.games = integer(flag, value, 1, 100000);
    else if (flag === '--seed') options.seed = integer(flag, value, 0, 999999999);
    else if (flag === '--jobs') options.jobs = integer(flag, value, 1, 64);
    else if (flag === '--json') options.json = value;
    else if (flag === '--print') options.print = value;
    else if (flag === '--path') {
      if (value !== 'table' && value !== 'slow' && value !== 'mid' && value !== 'fast') throw new Error('--path must be table, slow, mid or fast');
      options.path = value;
    } else {
      /** @type {Set<string>} */
      const chosen = new Set();
      for (const part of value.split(',')) {
        const names = part === 'weak' ? WEAK : PAIRINGS.filter(p => p.name === part || p.kind === part).map(p => p.name);
        if (names.length === 0) throw new Error(`--only: unknown pairing ${part} (pairings: ${PAIRINGS.map(p => p.name).join(', ')}; a kind such as matched; weak)`);
        for (const name of names) chosen.add(name);
      }
      options.only = PAIRINGS.filter(p => chosen.has(p.name)).map(p => p.name);
    }
  }
  return options;
}

/**
 * Everything the run produced, as plain data without anything that depends on the machine or the clock: the same
 * options give the same report, byte for byte.
 * @param {Options} options @param {RunResult} run @param {Summary} summary @param {BarResult[]} bars @param {boolean} full
 */
function reportOf(options, run, summary, bars, full) {
  return {
    sim: 1,
    options: { games: options.games, seed: options.seed, path: options.path, only: options.only },
    full,
    pairings: summary.pairings,
    teaching: { games: summary.games, wins: summary.wins, mates: summary.mates, mate1TwiceGames: summary.mate1TwiceGames, left3Games: summary.left3Games, long: summary.long, rail: summary.rail, nat: summary.nat },
    bars,
    failed: run.failed,
    games: run.records.map(({ text: _text, ...numbers }) => numbers),
  };
}

/** @param {unknown} e @returns {string} */
const errorText = e => (e instanceof Error ? e.message : String(e));

/**
 * Makes sure the places of `--json` and `--print` can be written to before any game is played: a run takes minutes,
 * and a path that cannot be used must not cost it. Creates the directories; no file is written yet.
 * @param {Options} options
 * @throws {Error} with a message for the command line
 */
function prepareOutputs(options) {
  if (options.json !== null) {
    const file = resolve(options.json);
    let directory = false;
    try {
      mkdirSync(dirname(file), { recursive: true });
      directory = statSync(file, { throwIfNoEntry: false })?.isDirectory() === true;
    } catch (e) {
      throw new Error(`--json: ${options.json} cannot be written (${errorText(e)})`);
    }
    if (directory) throw new Error(`--json: ${options.json} is a directory, a file name is needed`);
  }
  if (options.print !== null) {
    try {
      mkdirSync(resolve(options.print), { recursive: true });
    } catch (e) {
      throw new Error(`--print: ${options.print} cannot be used as a directory (${errorText(e)})`);
    }
  }
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
    if (!options.help) prepareOutputs(options);
  } catch (e) {
    console.error(`${/** @type {Error} */ (e).message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const started = Date.now();
  const names = options.only ?? PAIRINGS.map(p => p.name);
  const total = names.length * options.games;
  console.log(`司马懿教学模拟：${names.length} 组对局，每组 ${options.games} 局，种子 ${options.seed} 到 ${options.seed + options.games - 1}，${Math.min(options.jobs, total)} 个线程`);
  console.log(`走法：${options.path}（${PATH_WORD[options.path]}）`);
  let shown = Date.now();
  const run = await runSimulation({
    ...options,
    print: options.print !== null,
    onProgress(done, all) {
      if (done < all && Date.now() - shown < 15000) return;
      shown = Date.now();
      console.error(`[sim] ${done}/${all} 局，${Math.round((shown - started) / 1000)} 秒`);
    },
  });

  const summary = summarize(run.records);
  const full = options.games >= FULL_GAMES;
  const bars = judgeBars(summary, full);
  console.log('');
  console.log(tableLines(summary).join('\n'));
  console.log('（平均局面、±300内：轮到孩子走棋时孩子眼里的局面分；步数、首吃：孩子步数和第一次吃子的 ply 的中位；长局：孩子走满 100 步的对局；'
    + '放杀、让子、漏看：司马懿每局放过的杀、让出的机会和缓着、漏看的次数；深度：他所选着法搜到的平均深度）');
  console.log('');
  console.log(`各条线（† 少于 ${FULL_GAMES} 局时也算）：`);
  console.log(barLines(bars).join('\n'));
  const { rail } = summary;
  console.log(`  其余护栏（只打印，都应是 0）：连续两步让子 ${rail.giftTwice} 次，漏着之后紧接着让子 ${rail.giftAfterBlunder} 次，放过的杀超过上限 ${rail.spareOverCap} 次，`
    + `孩子领先时还手软 ${rail.pressSoft} 次，走了规则不许的长将 ${rail.forbidden} 次`);
  console.log('');

  let unwritten = 0;
  /**
   * Writes result files. A failure is reported and counted; the conclusion below still comes.
   * @param {string} where @param {() => void} write @returns {boolean} written
   */
  const save = (where, write) => {
    try {
      write();
      return true;
    } catch (e) {
      unwritten += 1;
      console.error(`${where} 没有写成：${errorText(e)}`);
      return false;
    }
  };
  if (options.json !== null) {
    const file = resolve(options.json);
    const written = save(options.json, () => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(reportOf(options, run, summary, bars, full), null, 1)}\n`);
    });
    if (written) console.log(`全部数字已写入 ${options.json}`);
  }
  if (options.print !== null) {
    const dir = resolve(options.print);
    const written = save(options.print, () => {
      mkdirSync(dir, { recursive: true });
      for (const game of run.records) writeFileSync(join(dir, `${game.pairing}-${game.seed}.txt`), `${(game.text ?? []).join('\n')}\n`);
    });
    if (written) console.log(`${run.records.length} 局棋谱已写入 ${options.print}`);
  }
  for (const game of run.failed.slice(0, FAILURES_SHOWN)) console.error(`没有下完：${game.pairing} 种子 ${game.seed}（${game.error}）`);
  if (run.failed.length > FAILURES_SHOWN) console.error(`……另有 ${run.failed.length - FAILURES_SHOWN} 局没有下完`);

  const missed = failedBars(bars);
  const quick = full ? '' : `（每组少于 ${FULL_GAMES} 局：只算带 † 的线）`;
  const code = run.failed.length > 0 || missed > 0 || unwritten > 0 ? 1 : 0;
  const verdict = run.failed.length > 0 ? `有 ${run.failed.length} 局没有下完，结果不完整` : missed > 0 ? `有 ${missed} 条线未达标` : '该算的线全部达标';
  console.log(`结论：${verdict}${quick}${unwritten > 0 ? '；结果文件没有写成' : ''}，退出码 ${code}`);
  console.error(`[sim] 用时 ${Math.round((Date.now() - started) / 1000)} 秒`);
  return code;
}

/** True when this file is the program Node was started with (not when a test imports it). */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    const norm = (/** @type {string} */ p) => (process.platform === 'win32' ? realpathSync(p).toLowerCase() : realpathSync(p));
    return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (!isMainThread) {
  if (workerData !== null && typeof workerData === 'object' && /** @type {{role?:unknown}} */ (workerData).role === WORKER_ROLE) serveGames();
} else if (isMain()) {
  process.exitCode = await main(process.argv.slice(2));
}
