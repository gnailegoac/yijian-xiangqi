/**
 * Skill model, teaching opponent, tension and takeaways (contract section 4.7).
 *
 * Everything here works on plain JSON objects and returns new ones; nothing is mutated. The only impure line is the
 * Date.now() of finishGame (recent[].at). Random choices of the teaching opponent come from a generator seeded with
 * the game seed and the position, so the same position always gets the same choice.
 *
 * Points the contract leaves open, as implemented here:
 * - levelParams: the discrete parameters (honestDepth, vmax, gap) are rounded; T, W, J, C and the overlook
 *   probabilities stay linear. The level-9 anchor of honestDepth ("table depth") is the number 9 for the
 *   interpolation; chooseTeachingMove plays the table's best move at level 9 whatever the table's depth.
 * - A root line with |mate| >= 50 carries a repetition verdict, not a mate: it never counts as a mate for the
 *   overlook rule (spared mates), the finisher or the tension.
 * - "The verification budget is used up" is read from the result of verify: a line that is shallower than the table
 *   and not decisive (or no line at all) ends every loop of the selection; that result is discarded. A rejection of
 *   verify (a cancelled job) is passed on to the caller.
 * - An overlook is dropped when verify shows that the other move is itself a forced win for the rival: playing it
 *   would not be missing anything.
 * - Repetition: "the best repeating line" is the best line with repeats === 2 (the ones the rule would add).
 * - choice(): the value of a line that is not exact at the table's depth is min(score, upper) for loss and for
 *   evalAfter alike.
 * - Step 5b can settle on a move that loses nothing (the best move itself, when no small inaccuracy fits). That move
 *   is played with kind 'honest': kind 'concession' always has loss > 0.
 * - The highlight of gameTakeaways is the move that was played (final.move), so a found test counts for it only when
 *   the found first try was the move confirmed, and a move judged 'mistake' or 'blunder' is never the highlight.
 * - The ply of a sample or of a mark is the number of plies played before that move (the first move of a game is 0),
 *   so rewindGameSkill(game, ply) leaves exactly what was recorded for the first `ply` plies.
 * - gameTakeaways sees only the child's samples: the pattern item is taken from them, and a game with n = 0 has no
 *   accuracy (stored as 0 in `recent`, left out of the "usual" mean).
 *
 * Where the teaching opponent departs from the letter of section 4.7.5 (CONTRACT-NOTES 104: it must not crush a weak
 * child; each change was measured against the simulation thresholds of section 14.1):
 * - Level parameters: T at levels 1 and 3 is 300 and 150 (were 80 and 60), C at levels 1 and 3 is 500 (were 450 and 350),
 *   gap at level 1 is 1 (was 2). From level 5 up every parameter is as section 4.7.5 gives it.
 * - Ease below level 5: when the rival eases off without a gift he plays the best move of a shallower search than
 *   honestDepth (EASE_DEPTH_ANCHORS: depth 1 at level 1, 2 at level 3), among the moves that stay inside what a gift may
 *   give up (500 cp, no rook for less than a rook, no repetition, no declining of a piece that is there for the taking).
 *   Press, spar and every forced mate keep honestDepth.
 * - The recapture factor x0.3 of the overlook step applies only to a true recapture (ctx.lastChildCapture and the
 *   punishing move takes on lastChildMove.to). A piece the child simply moved en prise gets the full probability.
 * - Below level 5 a gift is withheld only on the rival move that answers a blunder (sinceBlunder === 0), not on the
 *   two moves after it. From level 5 up the wait is two moves, as written. "Never two gifts in a row" and the
 *   spared-mate cap are as written at every level.
 * - The first game's guaranteed chance is never given on the rival move that answers a blunder (as written it overrode
 *   that too); it waits for the next move of its window.
 * - A line that the search values as a plain repetition is never offered as a chance (step 5a).
 * - Opening variety (step 1; CONTRACT-NOTES 143 c): when the near-best moves of his first moves hold developing moves, the
 *   pick is uniform among those; otherwise among all of them, as written. A developing move is read on the board from
 *   his own side (developingLines): a horse from his back rank to his third rank, a cannon sideways along the rank it
 *   starts on, an elephant or an advisor from his back rank, a pawn of the third or seventh file one step forward, a
 *   rook along his back rank or second rank or one step forward from its corner, and any capture. The 25 cp margin
 *   and the move numbers of step 1 are as written, so his strength is the same; his first moves look like an opening.
 * - The wrap-up (CONTRACT-NOTES 143 b): a game that has gone on long is brought to its end. From his move 60 on
 *   (ctx.moveNo >= WRAP_UP_MOVE) the mode is 'finish' when the child is level or ahead (eBest >= WRAP_UP_AHEAD, which
 *   is -50 cp: level within half a pawn), whatever aheadRun says: he cracks, as a tired player does. A crack that the
 *   wrap-up alone asks for (section 4.7.6 does not: the child is not at +600 for the second decision running) keeps
 *   the manners of a gift (CONTRACT-NOTES 151). It is never the answer to a blunder of the child (GIFT_WAIT: he takes
 *   what is hung). After a chance of his, and a slip is one, he plays WRAP_UP_HOLD honest moves first. And while the
 *   child is not clearly ahead (eBest < WRAP_UP_CLEAR, 250 cp), or his last chance is less than WRAP_UP_SETTLE moves
 *   old, the crack is a slip, not a collapse: no mate, no more than a gift may give up (GIFT_CAP), no rook for less
 *   than a rook, and of two slips the one that does not show at a glance. The first version cracked in full from a
 *   level game: a rook for an elephant on move 60, a step into mate in one, which a child reads as throwing the game
 *   (CONTRACT-NOTES 124); the second slipped and then collapsed on the very next move. From his move 80
 *   on (WRAP_UP_PRESS_MOVE) the mode is 'press' when he is 250 cp or more ahead (eBest <= -WRAP_UP_BEHIND): he plays
 *   the honest move of his level and wins his won game, with no ease move, no overlook and no gift. In between the
 *   mode is the band's, as written. The press, the finish of section 4.7.6 and the rails below are what they are before move 60.
 *   The numbers were set with the simulation (the owner's starting point was move 60 and 250 cp for both). Games of
 *   100 child moves fell from 12 to 15 % of all teaching games to 6 to 8 % (mid, two seed sets; the strongest
 *   pairings keep about one long game in five). Cracking in full from a level game brought them to 4 to 5 % and was
 *   given up for the look; what stays long are mostly endings nobody can win (a rook each, a cannon each), which the
 *   sixty-move rule ends as a draw. He presses twenty moves later than he cracks
 *   because pressing from move 60 cost every simulated child points for no shorter games, and so a weak child who is
 *   behind at move 60 meets the same rival as on move 59.
 *   And section 4.7.2: a move of mode 'press' or 'finish' made from his move 60 on does not count towards the band
 *   drift. recordOpponentMove reads the move number from the ply (floor(ply / 2) + 1, as the game counts it) and leaves
 *   easeRun, pressRun and drift as they are for such a move: a long game says nothing about the child cruising, and a
 *   press that the wrap-up chose against a child who is behind must not raise the level. Ease and spar moves count as written.
 *
 * Naturalness rails (CONTRACT-NOTES 124: the rival must not look as if he were throwing the game):
 * - (h) A mate in one is not overlooked when his last move was an overlook: it is never left unplayed twice running.
 * - (i) A piece of the child is "there for the taking" when taking it beats the best move that takes nothing by 100 cp
 *   or more; once he has overlooked something since his last proper move, also when one of the best moves takes it and
 *   wins material on the spot. No gift and no shallower move of ease declines such a piece: it is left by an overlook
 *   (or, as in section 4.7.5, by an honest move that does not see that deep), and the overlooks are counted.
 *   After two overlooks since his last proper move he does not leave such a piece again: he plays his plain
 *   move (the honest move, or the shallower move of ease) when that takes it or is one of the best moves, else the best move.
 * - (j) No gift gives up more than 500 cp, no gift loses a rook for less than a rook, and declining to take a piece is
 *   never a gift: while a piece is there for the taking, a gift takes such a piece or is one of the best moves.
 * - (k) A rook of the child that has just taken a piece and can be taken back is always taken back (or answered by a
 *   move that is as good).
 * - (l) When he is 600 cp or more ahead he does not take his last move back while another move within 200 cp exists.
 *   A move back that wins by force (a mate) is always kept.
 * The rails read two counters of the game record, missRun and lastRival (typedef RailState below). They are optional
 * in the record, in its marks and in the context, and absent means 0, so a record saved before they existed works.
 */

import { CATS, DANGER_CODES, HABIT_CODES, LEVEL_MAX, LEVEL_MIN, PATTERN_CODES, PIECE_VALUE } from './codes.js';
import { fenToBoard } from './engine.js';
import { WIN, mateIn, revealDepth, revealTier, scoreToCp, separationDepth } from './search.js';

/** @import { Analysis, Board, FinishResult, GameMark, GameSkill, Line, MoveInfo, MoveRef, MoveSample, PieceType, PositionFacts, RootLine, SkillProfile, Square, Takeaway, TeachingChoice, TeachingContext } from './types.js' */
/** @import { DangerCode } from './codes.js' */

/**
 * The state of the naturalness rails (CONTRACT-NOTES 124) in a GameSkill, in each GameMark and in the TeachingContext.
 * The typedefs of types.js do not list these fields yet; they are optional everywhere and absent means 0.
 * @typedef {Object} RailState
 * @property {number} [missRun]      rival moves of kind 'overlook' since his last proper move ('honest', 'variety' or 'finisher'); a gift in between does not end the run
 * @property {number} [lastRival]    the rival's last move as 1 + 90 * from + to, a square being row * 9 + col; 0 = he has not moved yet
 */

// ---------------------------------------------------------------------------------------------------------------
// tables (sections 4.7.1, 4.7.3, 4.7.5)
// ---------------------------------------------------------------------------------------------------------------

/** E(level) at levels 1..9 (section 4.7.1). */
const ACCURACY_ANCHORS = Object.freeze([0.70, 0.76, 0.81, 0.87, 0.895, 0.915, 0.945, 0.96, 0.975]);

/**
 * Level parameters at levels 1, 3, 5, 7, 9 (section 4.7.5). honestDepth at level 9 is "table depth": 9 stands for it.
 * Re-tuned below level 5 (CONTRACT-NOTES 104 and 124): T at levels 1 and 3 (were 80, 60), C at levels 1 and 3 (were 450, 350), gap at level 1 (was 2).
 */
const PARAM_ANCHORS = Object.freeze({
  honestDepth: Object.freeze([3, 4, 5, 6, 9]),
  vmax: Object.freeze([1, 2, 3, 4, 4]),
  T: Object.freeze([300, 150, 40, 20, 0]),
  W: Object.freeze([120, 110, 100, 90, 80]),
  J: Object.freeze([60, 45, 30, 20, 10]),
  C: Object.freeze([500, 500, 250, 150, 80]),
  gap: Object.freeze([1, 2, 3, 3, 4]),
  overlook1: Object.freeze([0.60, 0.40, 0.20, 0.08, 0]),
  overlook2: Object.freeze([0.90, 0.70, 0.45, 0.20, 0.05]),
  overlook3: Object.freeze([1, 1, 0.90, 0.50, 0.20]),
});

/**
 * Depth of the search whose best move the rival plays while he eases off without a gift (mode 'ease'), at levels 1, 3, 5,
 * 7, 9 (CONTRACT-NOTES 124). Below level 5 it is shallower than honestDepth: a rival who is ahead of a weak child stops
 * calculating and plays the moves of a player of the child's own strength, with that player's natural mistakes. That
 * keeps a weak child in the game without a gift that looks like charity. From level 5 up it is honestDepth.
 */
const EASE_DEPTH_ANCHORS = Object.freeze([1, 2, 5, 6, 9]);

/** Prior find rate P0 per tier at levels 1, 3, 5, 7, 9 (section 4.7.3). */
const FIND_PRIOR = Object.freeze([
  Object.freeze([0.50, 0.70, 0.85, 0.95, 0.98]),
  Object.freeze([0.10, 0.25, 0.50, 0.75, 0.90]),
  Object.freeze([0.02, 0.05, 0.15, 0.40, 0.70]),
]);

/** Weight of the prior in findRate, in observations. */
const PRIOR_WEIGHT = 4;
/** A tier belongs to the child's horizon when its find rate is at least this. */
const HORIZON_RATE = 0.35;
/** Decay of the tactics counters per test. */
const TACTICS_DECAY = 0.97;
/** First-games bonus on the band, by profile.games (section 4.7.4). */
const FIRST_GAMES_BONUS = Object.freeze([100, 100, 50, 0]);
/** Samples kept in a GameSkill. */
const MAX_SAMPLES = 300;
/** Losses are capped at this many centipawns. */
const LOSS_CAP = 600;
/** Value of sinceChance and sinceBlunder at the start of a game. */
const LONG_AGO = 99;
/** A game with fewer counted moves than this leaves the profile alone (abandoned game). */
const MIN_COUNTED = 8;
/** mateIn() of a repetition-ban score is 50 or more: such a line is a repetition verdict, not a mate. */
const VERDICT_MATE = 50;
/** A move within this many centipawns of the best one belongs to a tactical test's winning group (section 4.6.4). */
const FOUND_MARGIN = 60;
/**
 * Rival moves after a child's blunder on which no gift is given: [below level 5, from level 5 up] (CONTRACT-NOTES 104).
 * A weak child blunders every few moves, so two moves of waiting left the rival almost no move to ease off on.
 * The move that answers the blunder is never a gift at any level.
 */
const GIFT_WAIT = Object.freeze([1, 2]);
/** The level from which the longer wait of GIFT_WAIT applies. */
const GIFT_WAIT_LEVEL = 5;
/**
 * The root score of a line that ends in a plain repetition (Appendix A3.4: the search treats the first recurrence as a
 * draw that the side to move at the root slightly dislikes).
 */
const REPETITION_SCORE = -20;
/** A gift (chance or concession) never gives up more than this many centipawns, at any level (CONTRACT-NOTES 124 j). */
const GIFT_CAP = 500;
/** After this many overlooks since his last proper move the rival does not leave a piece that is there for the taking (CONTRACT-NOTES 124 i). */
const MISS_RUN_MAX = 2;
/** A capture that beats the best move that takes nothing by this much (a pawn) is a gain: the piece is there for the taking. */
const TAKING_MARGIN = 100;
/** Ahead by this much, the rival does not take his last move back (CONTRACT-NOTES 124 l) ... */
const AHEAD = 600;
/** ... while another move is less than this much below it (the margin of the repetition filter). */
const BACK_MARGIN = 200;
/**
 * The wrap-up (CONTRACT-NOTES 143 b): a game that has gone on long is brought to its end. From this move of his on ...
 */
const WRAP_UP_MOVE = 60;
/** ... a child who stands at this or better (cp, after his best move: level within half a pawn, or ahead) meets a rival who cracks: mode 'finish', whatever aheadRun says. */
const WRAP_UP_AHEAD = -50;
/** ... and while the child stands below this, the crack is a slip: no mate, no more than GIFT_CAP (CONTRACT-NOTES 151). */
const WRAP_UP_CLEAR = 250;
/** After a chance of his (a slip is one) the wrap-up does not crack on his next moves: this many honest moves first ... */
const WRAP_UP_HOLD = 2;
/** ... and until his last chance is this many moves old the crack stays a slip, however far the slip put the child ahead. */
const WRAP_UP_SETTLE = 5;
/** From this later move of his on ... */
const WRAP_UP_PRESS_MOVE = 80;
/** ... a rival who is this much ahead or more plays properly and wins his won game: mode 'press'. In between nothing changes. */
const WRAP_UP_BEHIND = 250;
/** The rank cannons start on, counted from the mover's back rank (0); horses and elephants develop to it. */
const CANNON_RANK = 2;
/** Squares of the board, and the largest code of a move (RailState.lastRival). */
const SQUARES = 90;
const MOVE_CODE_MAX = SQUARES * SQUARES;

/** @type {readonly TeachingChoice['kind'][]} */
const KINDS = Object.freeze(['honest', 'variety', 'overlook', 'chance', 'concession', 'finisher']);
/** @type {readonly PieceType[]} */
const PIECE_TYPES = Object.freeze(/** @type {PieceType[]} */ (Object.keys(PIECE_VALUE)));
/** @type {readonly ('win'|'loss'|'draw')[]} */
const RESULTS = Object.freeze(['win', 'loss', 'draw']);

// ---------------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------------

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {v is number} */
function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** @template {string} T @param {readonly T[]} list @param {unknown} v @returns {v is T} */
function oneOf(list, v) {
  return typeof v === 'string' && /** @type {readonly string[]} */ (list).includes(v);
}

/** A non-negative integer, or the fallback. @param {unknown} v @param {number} fallback @returns {number} */
function countOf(v, fallback) {
  return isNumber(v) && v >= 0 ? Math.trunc(v) + 0 : fallback;        // + 0: never -0
}

/** A level as a number in [1, 9]. @param {number} level @returns {number} */
function levelOf(level) {
  return Number.isFinite(level) ? clamp(level, LEVEL_MIN, LEVEL_MAX) : LEVEL_MIN;
}

/**
 * Linear interpolation in a row of five anchors at levels 1, 3, 5, 7, 9; exact at the anchors.
 * @param {readonly number[]} row @param {number} level @returns {number}
 */
function anchored(row, level) {
  const x = (levelOf(level) - 1) / 2;
  const i = Math.min(3, Math.floor(x));
  const t = x - i;
  return row[i] * (1 - t) + row[i + 1] * t;
}

/** FNV-1a, 32 bit, over the UTF-16 code units. @param {string} text @returns {number} uint32 */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

/** @param {Square} a @param {Square} b @returns {boolean} */
function sameSquare(a, b) {
  return a.row === b.row && a.col === b.col;
}

/** A square as row * 9 + col. @param {Square} square @returns {number} 0..89 */
function squareCode(square) {
  return square.row * 9 + square.col;
}

/** A move as 1 + 90 * from + to (RailState.lastRival); 0 when it is not a move on the board. @param {MoveRef|null|undefined} move @returns {number} */
function moveCode(move) {
  if (!move || !move.from || !move.to) return 0;                      // a choice recorded without its move leaves no trace
  const from = squareCode(move.from), to = squareCode(move.to);
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < SQUARES && to >= 0 && to < SQUARES ? 1 + SQUARES * from + to : 0;
}

/** A score that is a real forced mate (for either side), not a repetition verdict. @param {number} score @returns {boolean} */
function isMateScore(score) {
  const m = mateIn(score);
  return m !== null && Math.abs(m) < VERDICT_MATE;
}

// ---------------------------------------------------------------------------------------------------------------
// level scale (4.7.1)
// ---------------------------------------------------------------------------------------------------------------

/** E(level): expected accuracy, linear between the anchors of section 4.7.1. @param {number} level @returns {number} */
export function expectedAccuracy(level) {
  const x = levelOf(level) - 1;
  const i = Math.min(ACCURACY_ANCHORS.length - 2, Math.floor(x));
  const t = x - i;
  return ACCURACY_ANCHORS[i] * (1 - t) + ACCURACY_ANCHORS[i + 1] * t;
}

/** invE(a): the piecewise-linear inverse of expectedAccuracy, clamped to [1, 9]. @param {number} acc @returns {number} */
export function levelFromAccuracy(acc) {
  const last = ACCURACY_ANCHORS.length - 1;
  if (!(acc > ACCURACY_ANCHORS[0])) return LEVEL_MIN;                 // also for NaN
  if (acc >= ACCURACY_ANCHORS[last]) return LEVEL_MAX;
  let i = 0;
  while (acc >= ACCURACY_ANCHORS[i + 1]) i++;
  return i + 1 + (acc - ACCURACY_ANCHORS[i]) / (ACCURACY_ANCHORS[i + 1] - ACCURACY_ANCHORS[i]);
}

/**
 * Level parameters of the teaching opponent (section 4.7.5): anchors at levels 1, 3, 5, 7, 9, linear in between, integers rounded.
 * overlook[tier] = probability of missing a punishment of that tier.
 * honestDepth 9 (level 9) stands for "table depth".
 * @param {number} level
 * @returns {{honestDepth:number, vmax:number, T:number, W:number, J:number, C:number, gap:number, overlook:Record<1|2|3, number>}}
 */
export function levelParams(level) {
  return {
    honestDepth: Math.round(anchored(PARAM_ANCHORS.honestDepth, level)),
    vmax: Math.round(anchored(PARAM_ANCHORS.vmax, level)),
    T: anchored(PARAM_ANCHORS.T, level),
    W: anchored(PARAM_ANCHORS.W, level),
    J: anchored(PARAM_ANCHORS.J, level),
    C: anchored(PARAM_ANCHORS.C, level),
    gap: Math.round(anchored(PARAM_ANCHORS.gap, level)),
    overlook: {
      1: anchored(PARAM_ANCHORS.overlook1, level),
      2: anchored(PARAM_ANCHORS.overlook2, level),
      3: anchored(PARAM_ANCHORS.overlook3, level),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// the profile (4.7.3, 4.7.4)
// ---------------------------------------------------------------------------------------------------------------

/** @param {number} [seedLevel=2] @returns {SkillProfile} habits {}, bandShift 0 */
export function createSkillProfile(seedLevel = 2) {
  return {
    v: 1,
    level: isNumber(seedLevel) ? clamp(seedLevel, LEVEL_MIN, LEVEL_MAX) : 2,
    games: 0,
    tactics: { seen: [0, 0, 0], found: [0, 0, 0] },
    streak: 0,
    bandShift: 0,
    habits: {},
    recent: [],
  };
}

/** Any older / invalid shape -> valid SkillProfile (never throws). @param {unknown} raw @returns {SkillProfile} */
export function migrateSkillProfile(raw) {
  const fresh = createSkillProfile(2);
  if (!isRecord(raw)) return fresh;

  /** @param {unknown} list @returns {number[]} three decayed counters */
  const counters = list => [0, 1, 2].map(i => (Array.isArray(list) && isNumber(list[i]) && list[i] >= 0 ? list[i] : 0));
  const tactics = isRecord(raw.tactics) ? raw.tactics : {};
  const seen = counters(tactics.seen);
  const found = counters(tactics.found).map((f, i) => Math.min(f, seen[i]));

  /** @type {Record<string, number>} */
  const habits = {};
  if (isRecord(raw.habits)) {
    for (const code of HABIT_CODES) {
      const count = raw.habits[code];
      if (isNumber(count) && count > 0) habits[code] = Math.min(9, count);
    }
  }

  /** @type {SkillProfile['recent']} */
  const recent = [];
  if (Array.isArray(raw.recent)) {
    for (const entry of raw.recent) {
      if (!isRecord(entry)) continue;
      const { at, result, acc, n, level } = entry;
      if (!isNumber(at) || !oneOf(RESULTS, result) || !isNumber(acc) || !isNumber(n) || n < 0 || !isNumber(level)) continue;
      recent.push({ at, result, acc: clamp(acc, 0, 1), n, level: clamp(level, LEVEL_MIN, LEVEL_MAX) });
    }
  }

  return {
    v: 1,
    level: isNumber(raw.level) ? clamp(raw.level, LEVEL_MIN, LEVEL_MAX) : fresh.level,
    games: countOf(raw.games, 0),
    tactics: { seen, found },
    streak: isNumber(raw.streak) ? Math.trunc(raw.streak) + 0 : 0,
    bandShift: isNumber(raw.bandShift) ? clamp(raw.bandShift, -60, 120) : 0,
    habits,
    recent: recent.slice(-10),
  };
}

/** @param {SkillProfile} profile @param {1|2|3} tier @returns {number} 0..1 */
export function findRate(profile, tier) {
  const i = tier - 1;
  const seen = profile.tactics.seen[i] ?? 0;
  const found = profile.tactics.found[i] ?? 0;
  return (found + PRIOR_WEIGHT * anchored(FIND_PRIOR[i], profile.level)) / (seen + PRIOR_WEIGHT);
}

/** @param {SkillProfile} profile @returns {2|4|6} */
export function revealFor(profile) {
  if (findRate(profile, 1) < HORIZON_RATE || findRate(profile, 2) < HORIZON_RATE) return 2;
  return findRate(profile, 3) < HORIZON_RATE ? 4 : 6;
}

// ---------------------------------------------------------------------------------------------------------------
// the game (4.7.2)
// ---------------------------------------------------------------------------------------------------------------

/** @param {number} seed uint32 @returns {GameSkill} */
export function createGameSkill(seed) {
  /** @type {GameSkill & RailState} */
  const game = {
    seed: isNumber(seed) ? seed >>> 0 : 0,
    samples: [],
    n: 0,
    accSum: 0,
    shift: 0,
    drift: 0,
    easeRun: 0,
    pressRun: 0,
    aheadRun: 0,
    sinceChance: LONG_AGO,
    sinceBlunder: LONG_AGO,
    lastKind: null,
    spared: 0,
    chances: 0,
    missRun: 0,
    lastRival: 0,
    marks: [],
  };
  return game;
}

/** @param {unknown} v @returns {v is Square} */
function isSquare(v) {
  return isRecord(v) && Number.isInteger(v.row) && Number.isInteger(v.col)
      && /** @type {number} */ (v.row) >= 0 && /** @type {number} */ (v.row) <= 9
      && /** @type {number} */ (v.col) >= 0 && /** @type {number} */ (v.col) <= 8;
}

/** @param {unknown} raw @returns {MoveInfo|null} */
function reviveMove(raw) {
  if (!isRecord(raw) || !isSquare(raw.from) || !isSquare(raw.to) || typeof raw.notation !== 'string') return null;
  const { piece, color } = raw;
  const captured = raw.captured ?? null;
  if (!oneOf(PIECE_TYPES, piece) || (color !== 'red' && color !== 'black')) return null;
  if (captured !== null && !oneOf(PIECE_TYPES, captured)) return null;
  return { from: { row: raw.from.row, col: raw.from.col }, to: { row: raw.to.row, col: raw.to.col }, notation: raw.notation, piece, color, captured };
}

/** One of MoveSample.first / final. @param {unknown} raw @returns {MoveSample['first']|null} */
function reviveTry(raw) {
  if (!isRecord(raw)) return null;
  const move = reviveMove(raw.move);
  if (move === null || !oneOf(CATS, raw.cat)) return null;
  return { move, loss: isNumber(raw.loss) && raw.loss > 0 ? raw.loss : 0, cat: raw.cat };
}

/** @param {unknown} v @returns {0|1|2|3} a pouch level */
function pouchOf(v) {
  return v === 1 || v === 2 || v === 3 ? v : 0;
}

/** A saved sample: null when its ply or one of its two moves is unusable; other fields fall back to neutral values. @param {unknown} raw @returns {MoveSample|null} */
function reviveSample(raw) {
  if (!isRecord(raw) || !isNumber(raw.ply) || !Number.isInteger(raw.ply) || raw.ply < 0) return null;
  const first = reviveTry(raw.first), final = reviveTry(raw.final);
  if (first === null || final === null) return null;
  const hint = pouchOf(raw.hint), hintMax = pouchOf(raw.hintMax);
  /** @type {MoveSample['test']} */
  let test = null;
  if (isRecord(raw.test)) {
    const { tier, kind, found } = raw.test;
    if ((tier === 1 || tier === 2 || tier === 3) && (kind === 'win' || kind === 'save')) test = { tier, kind, found: found === true };
  }
  return {
    ply: raw.ply,
    first,
    final,
    tries: isNumber(raw.tries) && raw.tries >= 1 ? Math.trunc(raw.tries) : 1,
    hint,
    hintMax,
    self: typeof raw.self === 'boolean' ? raw.self : hintMax <= 1,
    bestCp: isNumber(raw.bestCp) ? clamp(raw.bestCp, -2000, 2000) : 0,
    legalCount: countOf(raw.legalCount, 0),
    test,
    danger: oneOf(DANGER_CODES, raw.danger) ? raw.danger : null,
    habit: oneOf(HABIT_CODES, raw.habit) ? raw.habit : null,
    avoided: oneOf(HABIT_CODES, raw.avoided) ? raw.avoided : null,
    patterns: Array.isArray(raw.patterns) ? raw.patterns.filter(code => oneOf(PATTERN_CODES, code)) : [],
    captured: oneOf(PIECE_TYPES, raw.captured) ? raw.captured : null,
    thinkMs: isNumber(raw.thinkMs) && raw.thinkMs > 0 ? raw.thinkMs : 0,
  };
}

/**
 * The counters of a GameSkill or of a GameMark, sanitised; null when one of them is not a finite number.
 * @param {Record<string, unknown>} raw
 * @returns {(Omit<GameMark, 'ply'|'samples'> & RailState)|null}
 */
function reviveCounters(raw) {
  const { n, accSum, shift, drift, easeRun, pressRun, aheadRun, sinceChance, sinceBlunder, spared, chances } = raw;
  if (!isNumber(n) || !isNumber(accSum) || !isNumber(shift) || !isNumber(drift) || !isNumber(easeRun) || !isNumber(pressRun)
      || !isNumber(aheadRun) || !isNumber(sinceChance) || !isNumber(sinceBlunder) || !isNumber(spared) || !isNumber(chances)) return null;
  const weight = Math.max(0, n);
  return {
    n: weight,
    accSum: clamp(accSum, 0, weight),
    shift: clamp(shift, -1.5, 1.5),
    drift: clamp(drift, -3, 2),
    easeRun: countOf(easeRun, 0),
    pressRun: countOf(pressRun, 0),
    aheadRun: countOf(aheadRun, 0),
    sinceChance: countOf(sinceChance, 0),
    sinceBlunder: countOf(sinceBlunder, 0),
    lastKind: oneOf(KINDS, raw.lastKind) ? raw.lastKind : null,
    spared: countOf(spared, 0),
    chances: countOf(chances, 0),
    missRun: countOf(raw.missRun, 0),                                 // absent in a record saved before the rails: 0
    lastRival: Math.min(countOf(raw.lastRival, 0), MOVE_CODE_MAX),
  };
}

/** @param {unknown} raw @returns {(GameMark & RailState)|null} */
function reviveMark(raw) {
  if (!isRecord(raw) || !isNumber(raw.ply) || !Number.isInteger(raw.ply) || raw.ply < 0) return null;
  const counters = reviveCounters(raw);
  if (counters === null) return null;
  return { ply: raw.ply, ...counters, samples: countOf(raw.samples, 0) };
}

/**
 * Sanitise a saved GameSkill; garbage -> createGameSkill(seed).
 * Garbage = not an object, `samples` or `marks` not arrays, or a counter that is not a finite number. Otherwise every
 * value is brought into its range, unusable samples and marks are dropped, and a valid record comes back unchanged.
 * `seed` (the game's seed) always wins over the saved one. Nothing is truncated here: the caller passes the result
 * through rewindGameSkill(game, moves.length) when the save may be longer than the move list.
 * @param {unknown} raw @param {number} seed @returns {GameSkill}
 */
export function reviveGameSkill(raw, seed) {
  const fresh = createGameSkill(seed);
  if (!isRecord(raw) || !Array.isArray(raw.samples) || !Array.isArray(raw.marks)) return fresh;
  const counters = reviveCounters(raw);
  if (counters === null) return fresh;
  /** @type {MoveSample[]} */
  const samples = [];
  for (const entry of raw.samples) {
    const sample = reviveSample(entry);
    if (sample !== null) samples.push(sample);
  }
  /** @type {GameMark[]} */
  const marks = [];
  for (const entry of raw.marks) {
    const mark = reviveMark(entry);
    if (mark !== null) marks.push(mark);
  }
  const { n, accSum, shift, drift, easeRun, pressRun, aheadRun, sinceChance, sinceBlunder, lastKind, spared, chances, missRun, lastRival } = counters;
  /** @type {GameSkill & RailState} */
  const game = {
    seed: fresh.seed,
    samples: samples.slice(-MAX_SAMPLES),
    n, accSum, shift, drift, easeRun, pressRun, aheadRun, sinceChance, sinceBlunder,
    lastKind: /** @type {GameSkill['lastKind']} */ (lastKind),
    spared, chances, missRun, lastRival,
    marks,
  };
  return game;
}

/** The snapshot of the counters after the move of `ply`. @param {GameSkill & RailState} game @param {number} ply @returns {GameMark & RailState} */
function markOf(game, ply) {
  return {
    ply,
    n: game.n,
    accSum: game.accSum,
    shift: game.shift,
    drift: game.drift,
    easeRun: game.easeRun,
    pressRun: game.pressRun,
    aheadRun: game.aheadRun,
    sinceChance: game.sinceChance,
    sinceBlunder: game.sinceBlunder,
    lastKind: game.lastKind,
    spared: game.spared,
    chances: game.chances,
    missRun: game.missRun ?? 0,
    lastRival: game.lastRival ?? 0,
    samples: game.samples.length,
  };
}

/** Sample weight of section 4.7.2. @param {MoveSample} sample @returns {0|0.5|1} */
function sampleWeight(sample) {
  const decided = Math.abs(sample.bestCp);
  if (sample.legalCount <= 2 || sample.hint === 3 || decided >= 1200) return 0;
  if (sample.hint === 1 || sample.hint === 2 || decided >= 700) return 0.5;
  return 1;
}

/** acc = max(0, 1 - first.loss / 300). @param {MoveSample} sample @returns {number} 0..1 */
function sampleAccuracy(sample) {
  return clamp(1 - Math.max(0, sample.first.loss) / 300, 0, 1);
}

/**
 * New object; appends the sample (keeps the newest 300), updates n, accSum, shift, sinceBlunder, pushes a mark.
 * @param {SkillProfile} profile
 * @param {GameSkill} game
 * @param {MoveSample} sample
 * @returns {GameSkill}
 */
export function recordChildMove(profile, game, sample) {
  const w = sampleWeight(sample);
  const n = game.n + w;
  const accSum = game.accSum + w * sampleAccuracy(sample);
  let shift = game.shift;
  if (n >= 4) {
    const target = clamp((levelFromAccuracy(accSum / n) - profile.level) * n / (n + 60), -1.5, 1.5);
    shift += clamp(target - shift, -0.25, 0.25);          // one move changes the level by at most 0.25
  }
  /** @type {GameSkill} */
  const next = {
    ...game,
    samples: [...game.samples, sample].slice(-MAX_SAMPLES),
    n,
    accSum,
    shift,
    sinceBlunder: sample.final.cat === 'blunder' ? 0 : game.sinceBlunder,
  };
  next.marks = [...game.marks, markOf(next, sample.ply)];
  return next;
}

/**
 * New object; updates easeRun / pressRun / drift, aheadRun, sinceChance, sinceBlunder, lastKind, spared, chances; pushes a mark.
 * @param {GameSkill} game
 * @param {number} ply
 * @param {TeachingChoice} choice
 * @returns {GameSkill}
 */
export function recordOpponentMove(game, ply, choice) {
  let { easeRun, pressRun, drift } = game;
  // The wrap-up: from his move WRAP_UP_MOVE on (the move number of a ply as the game counts it: 1, 1, 2, 2, ...) a move
  // of mode press or finish says nothing about the child cruising. It leaves both runs and the drift as they are.
  const wrapUp = Math.floor(ply / 2) + 1 >= WRAP_UP_MOVE && (choice.mode === 'press' || choice.mode === 'finish');
  if (wrapUp) {
    // nothing to count
  } else if (choice.mode === 'ease') {                    // the child is stuck below the band
    easeRun += 1;
    pressRun = 0;
    if (easeRun % 6 === 0) drift = Math.max(-3, drift - 0.5);
  } else if (choice.mode === 'press' || choice.mode === 'finish') {      // the child is cruising above it
    pressRun += 1;
    easeRun = 0;
    if (pressRun % 10 === 0) drift = Math.min(2, drift + 0.5);
  } else {
    easeRun = 0;
    pressRun = 0;
  }
  const chance = choice.chance !== null && choice.chance !== undefined;
  const rails = /** @type {GameSkill & RailState} */ (game);
  /** @type {GameSkill & RailState} */
  const next = {
    ...game,
    drift,
    easeRun,
    pressRun,
    aheadRun: choice.evalBest >= 600 ? game.aheadRun + 1 : 0,
    sinceChance: chance ? 0 : game.sinceChance + 1,
    sinceBlunder: game.sinceBlunder + 1,
    lastKind: choice.kind,
    spared: game.spared + (choice.overlooked?.mate ? 1 : 0),
    chances: game.chances + (chance ? 1 : 0),
    // an overlook lengthens the run, a gift leaves it as it is, a proper move ends it
    missRun: choice.kind === 'overlook' ? (rails.missRun ?? 0) + 1 : choice.kind === 'chance' || choice.kind === 'concession' ? rails.missRun ?? 0 : 0,
    lastRival: moveCode(choice.move),
  };
  next.marks = [...game.marks, markOf(next, ply)];
  return next;
}

/**
 * Samples and marks truncated to plies < ply; counters restored from the last remaining mark.
 * @param {GameSkill} game
 * @param {number} ply
 * @returns {GameSkill}
 */
export function rewindGameSkill(game, ply) {
  const marks = game.marks.filter(mark => mark.ply < ply);
  const samples = game.samples.filter(sample => sample.ply < ply);
  if (marks.length === 0) return { ...createGameSkill(game.seed), samples };
  const last = /** @type {GameMark & RailState} */ (marks[marks.length - 1]);
  /** @type {GameSkill & RailState} */
  const back = {
    seed: game.seed,
    samples,
    n: last.n,
    accSum: last.accSum,
    shift: last.shift,
    drift: last.drift,
    easeRun: last.easeRun,
    pressRun: last.pressRun,
    aheadRun: last.aheadRun,
    sinceChance: last.sinceChance,
    sinceBlunder: last.sinceBlunder,
    lastKind: oneOf(KINDS, last.lastKind) ? last.lastKind : null,
    spared: last.spared,
    chances: last.chances,
    missRun: last.missRun ?? 0,
    lastRival: last.lastRival ?? 0,
    marks,
  };
  return back;
}

/** @param {SkillProfile} profile @param {GameSkill} game @returns {number} 1..9 */
export function effectiveLevel(profile, game) {
  return levelOf(profile.level + game.shift + game.drift);
}

/**
 * @param {SkillProfile} profile
 * @param {GameSkill} game
 * @param {{moveNo:number, lastChildMove:MoveRef|null, lastChildCapture?:boolean}} extra lastChildCapture: the child's last move took a piece (absent = false)
 * @returns {TeachingContext}
 */
export function teachingContext(profile, game, extra) {
  const rails = /** @type {GameSkill & RailState} */ (game);
  /** @type {TeachingContext & RailState} */
  const ctx = {
    level: effectiveLevel(profile, game),
    reveal: revealFor(profile),
    bandShift: profile.bandShift + FIRST_GAMES_BONUS[Math.min(countOf(profile.games, 0), 3)],
    sinceChance: game.sinceChance,
    sinceBlunder: game.sinceBlunder,
    lastKind: game.lastKind,
    spared: game.spared,
    aheadRun: game.aheadRun,
    chances: game.chances,
    moveNo: extra.moveNo,
    seed: game.seed,
    lastChildMove: extra.lastChildMove,
    lastChildCapture: extra.lastChildCapture === true,
    firstGame: profile.games === 0,
    missRun: countOf(rails.missRun, 0),
    lastRival: countOf(rails.lastRival, 0),
  };
  return ctx;
}

// ---------------------------------------------------------------------------------------------------------------
// the teaching opponent (4.7.5, 4.7.6)
// ---------------------------------------------------------------------------------------------------------------

/** A principal variation in the place of a Line: brain.js converts it with toLine (section 4.8.2). @param {MoveRef[]} pv @returns {Line} */
function pvAsLine(pv) {
  return /** @type {Line} */ (/** @type {unknown} */ (pv));
}

/**
 * The repetition filter of section 4.7.5: lines with repeats < 2; lines with repeats === 2 are added when every other
 * line is 200 cp or more below the best of them; lines with repeats >= 3 only when nothing else is legal. Table order is kept.
 * @param {RootLine[]} lines @param {(line:RootLine) => number} value @returns {RootLine[]}
 */
function playableLines(lines, value) {
  const fresh = lines.filter(line => line.repeats < 2);
  const twice = lines.filter(line => line.repeats === 2);
  if (twice.length === 0) return fresh.length > 0 ? fresh : lines.slice();
  if (fresh.length === 0) return twice;
  const bestTwice = Math.max(...twice.map(value));
  return fresh.every(line => bestTwice - value(line) >= 200) ? lines.filter(line => line.repeats <= 2) : fresh;
}

/**
 * The lines of `pool` whose move is a developing move, the kind a player opens with (CONTRACT-NOTES 143 c). Read on the
 * board, from the mover's own side (rank 0 is his back rank, CANNON_RANK the rank his cannons start on):
 * a horse from his back rank to the cannons' rank; a cannon moving sideways along the cannons' rank; an elephant or an
 * advisor leaving his back rank; a pawn of the third or the seventh file stepping forward; a rook moving along his
 * back rank or his second rank, or stepping forward from its corner; and any capture.
 * A table whose position cannot be read has no developing move.
 * @param {Analysis} table @param {RootLine[]} pool @returns {RootLine[]}
 */
function developingLines(table, pool) {
  /** @type {Board} */
  let board;
  try {
    board = fenToBoard(table.fen).board;
  } catch {
    return [];
  }
  /** @param {number} row */
  const rank = row => (table.turn === 'red' ? 9 - row : row);
  return pool.filter(line => {
    const { from, to } = line.move;
    const piece = board[from.row]?.[from.col] ?? null;
    const target = board[to.row]?.[to.col] ?? null;
    if (piece === null || piece.color !== table.turn || target?.color === table.turn) return false;    // not a move of this position
    if (target !== null) return true;                                                                  // any capture
    const start = rank(from.row), end = rank(to.row);
    if (piece.type === 'horse') return start === 0 && end === CANNON_RANK;
    if (piece.type === 'cannon') return start === CANNON_RANK && end === CANNON_RANK;
    if (piece.type === 'elephant' || piece.type === 'advisor') return start === 0;
    if (piece.type === 'pawn') return (from.col === 2 || from.col === 6) && to.col === from.col;       // a pawn's move along its file is one step forward
    if (piece.type === 'rook') return (start === end && start <= 1) || (start === 0 && end === 1 && (from.col === 0 || from.col === 8));
    return false;
  });
}

/**
 * The teaching opponent's selection (section 4.7.5). Lines as RootLine; brain.js converts to Line.
 * @param {Analysis} table the root table of the rival's position (allDepth >= 3, multiPV = 6)
 * @param {TeachingContext} ctx
 * @param {(move:MoveRef) => Promise<RootLine>} verify an exact single-move RootLine at the table's depth
 * @returns {Promise<TeachingChoice>}
 */
export async function chooseTeachingMove(table, ctx, verify) {
  if (table.lines.length === 0) throw new RangeError('chooseTeachingMove: the table has no legal move');
  const P = levelParams(ctx.level);
  const rnd = mulberry32((ctx.seed ^ fnv1a(table.fen)) >>> 0);      // same position, same choice
  const D = table.depth, A = table.allDepth;
  const cp = scoreToCp;

  // bestAt[v] = the best exact score of all lines at the all-exact depth v
  const bestAt = [-Infinity];
  for (let v = 1; v <= A; v++) {
    let top = -Infinity;
    for (const line of table.lines) if (line.byDepth.length >= v && line.byDepth[v - 1] > top) top = line.byDepth[v - 1];
    bestAt.push(top);
  }
  let bestNaive = -Infinity;
  for (const line of table.lines) if (line.naive > bestNaive) bestNaive = line.naive;

  /** The line's score at the deepest all-exact iteration, in cp. @param {RootLine} line */
  const shallow = line => (A >= 1 && line.byDepth.length >= A ? cp(line.byDepth[A - 1]) : cp(line.score));
  /** Comparable value of a line, in cp: exact at the table's depth, else the smaller of its shallow score and its bound. @param {RootLine} line */
  const value = line => (line.depth === D ? cp(line.score) : line.upper === null ? shallow(line) : Math.min(shallow(line), cp(line.upper)));

  const rails = /** @type {TeachingContext & RailState} */ (ctx);
  let playable = playableLines(table.lines, value);
  // Rail (l): far ahead, the rival does not take his last move back while another move within BACK_MARGIN exists. Like a
  // repeating line, the move back is left out of the playable lines, so he never shuffles a piece to and fro.
  const lastRival = countOf(rails.lastRival, 0);
  if (lastRival > 0 && playable.length > 1 && cp(playable[0].score) >= AHEAD) {
    const from = (lastRival - 1) % SQUARES, to = Math.floor((lastRival - 1) / SQUARES);      // his last move, reversed
    const back = playable.find(line => squareCode(line.move.from) === from && squareCode(line.move.to) === to);
    // A move back that wins by force (a mate, or a repetition verdict in his favour) is no shuffle: it is never left out.
    if (back !== undefined && !(back.score >= WIN)) {
      const backValue = value(back);
      const rest = playable.filter(line => line !== back);
      if (rest.some(line => backValue - value(line) < BACK_MARGIN)) playable = rest;
    }
  }
  const best = playable[0];
  const bestCp = cp(best.score);
  const eBest = 0 - bestCp;                                          // the child's evaluation if the rival plays its best move
  const band = P.T + ctx.bandShift;                                  // T'
  // The wrap-up: a game that has gone on long is brought to its end. From his move WRAP_UP_MOVE on he cracks when the child
  // is level (within half a pawn) or ahead (finish). From his move WRAP_UP_PRESS_MOVE on he plays properly and wins his
  // won game when he is WRAP_UP_BEHIND or more ahead (press: no ease move, no overlook, no gift). In between the band
  // decides, as before.
  /** @type {TeachingChoice['mode']} */
  const mode = (eBest >= 600 && ctx.aheadRun >= 1) || (ctx.moveNo >= WRAP_UP_MOVE && eBest >= WRAP_UP_AHEAD) ? 'finish'
    : ctx.moveNo >= WRAP_UP_PRESS_MOVE && eBest <= -WRAP_UP_BEHIND ? 'press'
    : eBest > band + P.W ? 'press' : eBest >= band - P.W ? 'spar' : 'ease';

  // The honest move: the best move of a search of depth honestDepth.
  let honest = best;
  if (P.honestDepth < D && ctx.level < LEVEL_MAX && A >= 1) {
    const at = Math.min(P.honestDepth, A) - 1;
    let top = -Infinity;
    for (const line of playable) {
      if (line.byDepth.length > at && line.byDepth[at] > top) {
        top = line.byDepth[at];
        honest = line;
      }
    }
  }

  /**
   * @param {RootLine} line
   * @param {TeachingChoice['kind']} kind
   * @param {{chance?:TeachingChoice['chance'], overlooked?:TeachingChoice['overlooked']}} [extra]
   * @returns {TeachingChoice}
   */
  const choice = (line, kind, extra) => {
    const lineCp = line.upper === null || line.upper === undefined ? cp(line.score) : Math.min(cp(line.score), cp(line.upper));
    return {
      move: line.move,
      line,
      mode,
      kind,
      loss: Math.max(0, bestCp - lineCp),
      evalAfter: 0 - lineCp,
      evalBest: eBest,
      chance: extra?.chance ?? null,
      overlooked: extra?.overlooked ?? null,
    };
  };

  if (playable.length === 1) return choice(honest, 'honest');

  // 1. Opening variety: the first rival moves pick uniformly among near-best moves; among the developing ones when the
  //    pool holds any, so that his first moves look like an opening.
  if (ctx.moveNo <= (ctx.firstGame ? 2 : 4)) {
    const near = playable.filter(line => line.depth === D && bestCp - cp(line.score) <= 25);
    const developing = developingLines(table, near);
    const pool = developing.length > 0 ? developing : near;
    return choice(pool.length > 0 ? pool[Math.floor(rnd() * pool.length)] : best, 'variety');
  }

  // Verification. The budget is shared by all calls of this selection; once it is used up no further call is made.
  let spent = false;
  /** @param {MoveRef} move @returns {Promise<RootLine|null>} null = the budget is used up */
  const verified = async move => {
    if (spent) return null;
    const line = await verify(move);
    if (!line || (line.depth < D && Math.abs(line.score) < WIN)) {
      spent = true;
      return null;
    }
    return line;
  };
  /** @param {RootLine} line @returns {Promise<RootLine|null>} */
  const exact = async line => (line.depth === D && line.byDepth.length >= D ? line : verified(line.move));

  /** A move a player slightly weaker than the child would actually choose. @param {RootLine} line @param {number} tol */
  const natural = (line, tol) => {
    if (line.score >= WIN) return false;
    if (ctx.level < 4 && cp(bestNaive) - cp(line.naive) <= tol) return true;       // greedy glance, low levels only
    const deepest = Math.min(P.vmax, A);
    for (let v = 1; v <= deepest; v++) {
      if (line.byDepth.length >= v && cp(bestAt[v]) - cp(line.byDepth[v - 1]) <= tol) return true;
    }
    return false;
  };
  /** Provisional loss of a line against the best move. @param {RootLine} line */
  const prov = line => {
    if (line.depth === D) return bestCp - cp(line.score);
    const byShallow = A >= 1 && line.byDepth.length >= A ? cp(bestAt[A]) - cp(line.byDepth[A - 1]) : bestCp - cp(line.score);
    return line.upper === null ? byShallow : Math.max(byShallow, bestCp - cp(line.upper));
  };
  /** @param {RootLine} line @param {number} loss @param {number} rd @returns {NonNullable<TeachingChoice['chance']>} */
  const chanceOf = (line, loss, rd) => ({ gain: loss, points: loss / 100, tier: revealTier(rd), revealDepth: rd, line: pvAsLine(line.pv.slice(1)) });

  // What his moves take (rails i, j, k of CONTRACT-NOTES 124). A table whose position cannot be read names no piece.
  /** @type {Board|null} */
  let board = null;
  try {
    board = fenToBoard(table.fen).board;
  } catch {
    board = null;
  }
  /**
   * Rail (j): the line gives a rook for less than a rook. Along its principal variation the child takes a rook and
   * everything the rival takes is worth less.
   * @param {RootLine} line
   */
  const losesRook = line => {
    if (board === null) return false;
    const grid = board.map(row => row.slice());
    let rooks = 0, got = 0;                                          // rooks the child takes; the value of what the rival takes
    for (let i = 0; i < line.pv.length; i++) {
      const { from, to } = line.pv[i];
      const mover = grid[from.row]?.[from.col] ?? null;
      if (mover === null || grid[to.row] === undefined) break;       // not a line of this position
      const victim = grid[to.row][to.col] ?? null;
      if (victim !== null && i % 2 === 0) got += PIECE_VALUE[victim.type];
      if (victim !== null && i % 2 === 1 && victim.type === 'rook') rooks += 1;
      grid[to.row][to.col] = mover;
      grid[from.row][from.col] = null;
    }
    return rooks > 0 && got < rooks * PIECE_VALUE.rook;
  };

  // 2. Finish: let the child deliver the blow (4.7.6).
  if (mode === 'finish') {
    // The mode is 'finish' through the wrap-up alone when section 4.7.6 does not ask for it. Such a crack keeps the
    // manners of a gift: never as the answer to a blunder, not on the moves after a chance of his, and a slip, not a
    // collapse, while the child is not clearly ahead or his last chance is still fresh.
    const wrapUp = !(eBest >= 600 && ctx.aheadRun >= 1);
    if (wrapUp && (ctx.sinceBlunder < GIFT_WAIT[ctx.level < GIFT_WAIT_LEVEL ? 0 : 1] || ctx.sinceChance < WRAP_UP_HOLD)) return choice(honest, 'honest');
    const slip = wrapUp && (eBest < WRAP_UP_CLEAR || ctx.sinceChance < WRAP_UP_SETTLE);
    const pool = playable.filter(line => !(line.score >= WIN) && natural(line, 200))      // a commander under pressure may crack
      .map(line => ({ line, loss: prov(line) })).filter(candidate => !slip || candidate.loss <= GIFT_CAP)
      .sort((a, b) => b.loss - a.loss).slice(0, 5);
    /** @type {{v:RootLine, m:number, rd:number}[]} */
    const mates = [];
    /** @type {{v:RootLine, loss:number, rd:number}[]} */
    const wins = [];
    for (const candidate of pool) {
      const v = await exact(candidate.line);
      if (v === null) break;
      const child = -v.score;                                        // the child's score after this rival move
      const rd = revealDepth(v.byDepth, v.score, 'bad');
      const m = mateIn(child);
      if (child >= WIN && m !== null && m < VERDICT_MATE) {
        if (slip) continue;                                          // he does not walk into a mate from a level game
        if (m <= ctx.reveal / 2) {
          mates.push({ v, m, rd });
          continue;
        }
      } else if (Math.abs(child) >= WIN) {
        continue;                                                    // a repetition verdict is never a finish
      }
      const loss = bestCp - cp(v.score);
      if (slip && losesRook(v)) continue;                            // nor does he give a rook for less than a rook (rail j)
      if (loss >= 300 && loss <= (slip ? GIFT_CAP : 900) && rd <= ctx.reveal) wins.push({ v, loss, rd });
    }
    mates.sort((a, b) => a.m - b.m);
    // The largest win; of two slips first the one that does not show at a glance (a fork or a pin, not a piece left hanging).
    wins.sort((a, b) => (slip ? Math.min(b.rd, 2) - Math.min(a.rd, 2) : 0) || b.loss - a.loss);
    const pick = mates[0] ?? wins[0];
    return pick ? choice(pick.v, 'finisher', { chance: chanceOf(pick.v, bestCp - cp(pick.v.score), pick.rd) }) : choice(honest, 'honest');
  }

  // 3. Press: play properly.
  if (mode === 'press') return choice(honest, 'honest');

  const mateAvail = best.score >= WIN && isMateScore(best.score);
  const winners = playable.filter(line => line.depth === D && bestCp - cp(line.score) <= 60);      // the punishing moves
  // The best move outside that group, mates aside: what an overlook would play.
  /** @type {RootLine|null} */
  let alt = null;
  let altValue = -Infinity;
  for (const line of playable) {
    if (winners.includes(line) || line.score >= WIN) continue;
    const lineValue = value(line);
    if (lineValue > altValue) {
      altValue = lineValue;
      alt = line;
    }
  }

  /** The child's piece on a square, if any. @param {Square} square */
  const childAt = square => {
    const piece = board === null ? null : board[square.row]?.[square.col] ?? null;
    return piece !== null && piece.color !== table.turn ? piece : null;
  };
  // A piece of the child is there for the taking when taking it beats the best move that takes nothing by TAKING_MARGIN or more.
  let quiet = -Infinity;
  for (const line of playable) if (childAt(line.move.to) === null && value(line) > quiet) quiet = value(line);
  /** @param {RootLine} line */
  const takes = line => childAt(line.move.to) !== null && value(line) - quiet >= TAKING_MARGIN;
  /**
   * The line takes a piece of the child and wins material on the spot: the piece that takes is not taken back at once, or
   * what it took is worth more by TAKING_MARGIN or more.
   * @param {RootLine} line
   */
  const gains = line => {
    const victim = childAt(line.move.to);
    const taker = board === null ? null : board[line.move.from.row]?.[line.move.from.col] ?? null;
    if (victim === null || taker === null) return false;
    const reply = line.pv[1];
    const takenBack = reply !== undefined && sameSquare(reply.to, line.move.to);
    return PIECE_VALUE[victim.type] - (takenBack ? PIECE_VALUE[taker.type] : 0) >= TAKING_MARGIN;
  };
  // Once he has overlooked something since his last proper move, a piece that one of the best moves wins on the spot is there
  // for the taking as well, although a quiet move may be nearly as good. Otherwise an overlook, a gift elsewhere and a second
  // overlook would leave the same piece three times running (rail i).
  const forTaking = playable.some(takes) || (countOf(rails.missRun, 0) >= 1 && winners.some(gains));
  /** A line that the search values as a plain repetition: it gives the child a draw, nothing to win. @param {RootLine} line */
  const repeating = line => line.depth === D && line.score === REPETITION_SCORE;

  // The plain move: what he plays when he neither overlooks nor gives. In press and spar, and whenever he has a forced
  // mate, it is the honest move. In ease below level 5 it is the best move of a shallower search (EASE_DEPTH_ANCHORS)
  // among the moves that, as far as the table knows, stay inside what a gift may give up: no more than GIFT_CAP, no rook
  // for less than a rook, no repetition. His own mistakes are those of a weaker player, never a give-away. And like a gift
  // it does not decline a piece that is there for the taking: when he eases off, such a piece is left by the overlook step
  // alone, which the run of rail (i) counts.
  let plain = honest;
  const easeDepth = Math.round(anchored(EASE_DEPTH_ANCHORS, ctx.level));
  if (mode === 'ease' && easeDepth < P.honestDepth && easeDepth < D && A >= 1 && !(best.score >= WIN)) {
    const at = Math.min(easeDepth, A) - 1;
    let top = -Infinity;
    for (const line of playable) {
      if (line.byDepth.length <= at || line.byDepth[at] <= top) continue;
      if (Math.max(prov(line), bestCp - value(line)) > GIFT_CAP || repeating(line) || losesRook(line)) continue;
      if (forTaking && !takes(line) && !winners.includes(line)) continue;
      top = line.byDepth[at];
      plain = line;
    }
  }
  // Rail (k): the child's rook has just taken a piece and can be taken back, for a gain or as one of the best moves.
  const lastChild = ctx.lastChildMove ?? null;
  const rookBack = ctx.lastChildCapture === true && lastChild !== null && childAt(lastChild.to)?.type === 'rook'
    && playable.some(line => sameSquare(line.move.to, lastChild.to) && (takes(line) || winners.includes(line)));
  // Rails (i) and (k): the rook is always taken back, and after MISS_RUN_MAX overlooks a piece that is there for the taking,
  // or that one of the best moves takes, is not left again. He plays his plain move when that takes it or is one of the best moves, else the best move.
  const worthTaking = forTaking || winners.some(line => childAt(line.move.to) !== null);      // also a capture that is one of the best moves
  if (rookBack || (worthTaking && countOf(rails.missRun, 0) >= MISS_RUN_MAX)) {
    const proper = winners.includes(plain) || (rookBack && lastChild !== null ? sameSquare(plain.move.to, lastChild.to) : takes(plain));
    return choice(proper ? plain : best, 'honest');
  }

  // 4. Overlook the child's slip (also: miss a mate).
  if (winners.length > 0) {
    if (alt !== null && (mateAvail || winners.length <= 3) && bestCp - altValue >= 150) {
      const rd = mateAvail ? [1, 3, 5][clamp(mateIn(best.score) ?? 3, 1, 3) - 1] : separationDepth(table, winners);
      let p = P.overlook[revealTier(rd)] * (mode === 'ease' ? 1.6 : 1);
      if (mateAvail) {
        p *= 0.6 ** ctx.spared;                                      // each spared mate makes the next less likely
        if (ctx.firstGame) p *= 1.5;
        if (ctx.spared >= (ctx.level >= 3 ? 1 : 2)) p = 0;           // at most one spared mate per game from level 3 up, two below
      }
      // An obvious recapture is rarely missed: the child's last move took a piece and the punishing move takes back on that
      // square. A piece the child simply moved en prise is no recapture: it keeps the level's full probability.
      if (ctx.lastChildCapture === true && lastChild !== null && sameSquare(winners[0].move.to, lastChild.to)) p *= 0.3;
      // Rail (h): a mate in one is never left unplayed on two rival moves running.
      if (mateAvail && mateIn(best.score) === 1 && ctx.lastKind === 'overlook') p = 0;
      if (rnd() < Math.min(0.95, p)) {
        const v = await verified(alt.move);
        if (v !== null && v.score > -WIN && v.score < WIN && bestCp - cp(v.score) <= (bestCp - altValue) + 150) {
          return choice(v, 'overlook', { overlooked: { gain: bestCp - cp(v.score), mate: mateAvail, line: pvAsLine(winners[0].pv) } });
        }
      }
    }
  }

  // 5. How much to give back.
  // The first game's guaranteed early chance. It is never the answer to a blunder (CONTRACT-NOTES 104 c): that move is
  // decided by the overlook step alone, and the guarantee waits for the next rival move of its window.
  const forced = ctx.firstGame && ctx.chances === 0 && ctx.moveNo >= 3 && ctx.moveNo <= 6 && ctx.sinceBlunder > 0;
  let desired = mode === 'spar' ? P.J * rnd() ** 2 : Math.min(P.C, band - eBest);
  if (forced) desired = Math.max(desired, 150);
  if (mateAvail || (desired < 12 && !forced)) return choice(plain, 'honest');
  const wait = GIFT_WAIT[ctx.level < GIFT_WAIT_LEVEL ? 0 : 1];
  const noGift = ctx.sinceBlunder < wait || ctx.lastKind === 'chance' || ctx.lastKind === 'concession';
  if (noGift && !forced) return choice(plain, 'honest');            // never right after a blunder, never twice in a row

  const natTol = 40 + Math.max(0, (band - eBest) - 300) * 0.5;      // relaxes when the child is far behind
  // Rail (j): declining to take a piece is never a gift. While one is there for the taking, a gift takes such a piece or is one of the best moves.
  const cands = playable.filter(line => natural(line, natTol) && (!forTaking || takes(line) || winners.includes(line)))
    .map(line => ({ line, loss: prov(line) }));

  // 5a. A findable chance. A line the search values as a plain repetition is none: what the child "wins" there is a
  // draw, by taking its last move back. With the larger C of the low levels the rival, far ahead, would step back and
  // forth to offer it, and the strategist would be told of a chance that wins nothing.
  if (desired >= 150 && (forced || ctx.sinceChance >= P.gap)) {
    const ceiling = Math.min(P.C, GIFT_CAP, 1.3 * desired + 30);
    const revealCap = forced ? 2 : ctx.reveal;
    const pool = cands.filter(c => c.loss >= 150 && c.loss <= ceiling && !repeating(c.line))
      .sort((a, b) => Math.abs(a.loss - desired) - Math.abs(b.loss - desired)).slice(0, 3);
    for (const candidate of pool) {
      if (spent) break;                                              // the budget went on the overlook: the loops stop
      const v = await exact(candidate.line);
      if (v === null) break;
      const loss = bestCp - cp(v.score);
      const rd = revealDepth(v.byDepth, v.score, 'bad');
      if (loss >= 150 && loss <= ceiling && rd <= revealCap && !repeating(v) && !losesRook(v)) return choice(v, 'chance', { chance: chanceOf(v, loss, rd) });
    }
  }
  if (forced) return choice(plain, 'honest');

  // 5b. A quiet concession.
  const want = Math.min(desired, 120);
  /** @type {{v:RootLine, loss:number}|null} */
  let fit = null;
  const pool = cands.filter(c => c.loss < 140).sort((a, b) => Math.abs(a.loss - want) - Math.abs(b.loss - want)).slice(0, 3);
  for (const candidate of pool) {
    if (spent) break;                                                // the budget is used up: the loops stop
    const v = await exact(candidate.line);
    if (v === null) break;
    const loss = bestCp - cp(v.score);
    if (loss < 0 || loss > Math.min(149, want + 40) || losesRook(v)) continue;       // never overshoot, never a rook for less
    if (fit === null || Math.abs(loss - want) < Math.abs(fit.loss - want)) fit = { v, loss };
    if (Math.abs(loss - want) <= Math.max(25, 0.25 * want)) break;
  }
  if (fit === null) return choice(plain, 'honest');
  // A fit that gives nothing up is no concession: the move is played, but as proper play ('honest'), so that it neither
  // blocks the next gift ("never two in a row") nor is reported as a soft move.
  return choice(fit.v, fit.loss > 0 ? 'concession' : 'honest');
}

// ---------------------------------------------------------------------------------------------------------------
// tension (4.7.7)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Section 4.7.7. evalNow and evalTwoPliesAgo are the child's view, cp; score is the latest search score.
 * @param {{facts:PositionFacts, score:number, evalNow:number, evalTwoPliesAgo:number|null}} inputs
 * @param {number} prev 0.1 at game start
 * @returns {number} 0..1
 */
export function tension(inputs, prev) {
  const { facts, score, evalNow, evalTwoPliesAgo } = inputs;
  const before = Number.isFinite(prev) ? clamp(prev, 0, 1) : 0.1;
  const cMate = isMateScore(score) || facts.mates.red || facts.mates.black ? 1 : 0;
  const cCheck = facts.check ? 1 : 0;
  let gain = 0;
  for (const hanging of facts.hanging) if (hanging.now === true && hanging.gain > gain) gain = hanging.gain;
  const cHang = Math.min(1, gain / 900);
  const cSwing = isNumber(evalTwoPliesAgo) ? Math.min(1, Math.abs(evalNow - evalTwoPliesAgo) / 500) : 0;
  const cKing = clamp(Math.max(facts.kings.red.pressure, facts.kings.black.pressure), 0, 1);
  const cClose = (1 - Math.min(1, Math.abs(evalNow) / 500)) * clamp(facts.material.phase, 0, 1);      // a close endgame is tense
  const raw = 1 - 0.90 * (1 - 0.85 * cMate) * (1 - 0.55 * cCheck) * (1 - 0.45 * cHang) * (1 - 0.45 * cSwing) * (1 - 0.40 * cKing) * (1 - 0.30 * cClose);
  return clamp(before + (raw - before) * (raw > before ? 0.7 : 0.25), 0, 1);      // fast attack, slow release
}

// ---------------------------------------------------------------------------------------------------------------
// end of game (4.7.4, 4.7.8)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The child's best moment among `samples` (section 4.7.8, item 1), or null.
 * The item shows the move that was played. `test.found` describes the first try, so a found test counts only when the
 * confirmed move kept the find (it is still within FOUND_MARGIN of the best move), and a named pattern only when the
 * move that played it was not judged a mistake: the best moment is never a move the game itself called bad.
 * @param {MoveSample[]} samples
 * @returns {{sample:MoveSample, byPattern:boolean}|null}
 */
function bestMoment(samples) {
  /** @type {MoveSample|null} */
  let pick = null;
  for (const s of samples) {                                         // a found test in the highest tier; ties: the latest
    if (s.test && s.test.found && s.final.loss <= FOUND_MARGIN && (pick === null || !pick.test || s.test.tier >= pick.test.tier)) pick = s;
  }
  if (pick !== null) return { sample: pick, byPattern: false };
  for (const s of samples) if (s.final.cat === 'brilliant') pick = s;        // the latest
  if (pick !== null) return { sample: pick, byPattern: false };
  for (const s of samples) {                                         // prefer tries === 1, then the latest
    if (s.final.cat === 'best' && (pick === null || s.tries === 1 || pick.tries !== 1)) pick = s;
  }
  if (pick !== null) return { sample: pick, byPattern: false };
  // the first sample that played a named pattern
  const first = samples.find(s => s.patterns.length > 0 && s.final.cat !== 'mistake' && s.final.cat !== 'blunder');
  return first ? { sample: first, byPattern: true } : null;
}

/**
 * At most three items, data only (section 4.7.8).
 * @param {GameSkill} game
 * @param {'win'|'loss'|'draw'} result
 * @param {SkillProfile} profile
 * @returns {Takeaway[]}
 */
export function gameTakeaways(game, result, profile) {
  const samples = game.samples;
  /** @type {Takeaway[]} */
  const out = [];

  // 1. highlight: a move the child found (self); when none qualifies, the same rule over all samples
  let self = true;
  let moment = bestMoment(samples.filter(s => s.self === true));
  if (moment === null) {
    self = false;
    moment = bestMoment(samples);
  }
  if (moment !== null) {
    const s = moment.sample;
    out.push(moment.byPattern ? { kind: 'highlight', ply: s.ply, move: s.final.move, pattern: s.patterns[0], self }
                              : { kind: 'highlight', ply: s.ply, move: s.final.move, self });
  }

  // 2. lesson: the costliest kind of mistake among the first tries
  /** @type {Map<DangerCode, {sum:number, count:number, example:MoveSample}>} */
  const groups = new Map();
  for (const s of samples) {
    if ((s.first.cat !== 'mistake' && s.first.cat !== 'blunder') || !s.danger) continue;
    const loss = Math.min(LOSS_CAP, s.first.loss);
    const group = groups.get(s.danger);
    if (group === undefined) groups.set(s.danger, { sum: loss, count: 1, example: s });
    else {
      group.sum += loss;
      group.count += 1;
      if (s.first.loss > group.example.first.loss) group.example = s;
    }
  }
  /** @type {DangerCode|null} */
  let worst = null;
  for (const [danger, group] of groups) {
    if (worst === null || group.sum > /** @type {{sum:number}} */ (groups.get(worst)).sum) worst = danger;
  }
  if (worst !== null) {
    const group = /** @type {{sum:number, count:number, example:MoveSample}} */ (groups.get(worst));
    out.push({ kind: 'lesson', danger: worst, count: group.count, ply: group.example.ply, move: group.example.first.move });
  }

  // 3. a named pattern that is not already item 1; otherwise progress against the usual accuracy
  const highlightPly = moment !== null ? moment.sample.ply : -1;
  const played = samples.find(s => s.patterns.length > 0 && s.ply !== highlightPly);
  if (played) {
    out.push({ kind: 'pattern', pattern: played.patterns[0], ply: played.ply, move: played.final.move });
  } else if (game.n > 0) {
    const usual = profile.recent.filter(entry => entry.n > 0);
    if (usual.length > 0) {
      const acc = game.accSum / game.n;
      const mean = usual.reduce((sum, entry) => sum + entry.acc, 0) / usual.length;
      if (acc - mean >= 0.05 - 1e-9) out.push({ kind: 'progress', acc, usual: mean });
    }
  }
  return out;
}

/** @param {SkillProfile} profile @param {GameSkill} game @param {'win'|'loss'|'draw'} result @returns {FinishResult} */
export function finishGame(profile, game, result) {
  const takeaways = gameTakeaways(game, result, profile);
  const at = Date.now();
  const acc = game.n > 0 ? game.accSum / game.n : 0;

  // An abandoned game: nothing but `recent` changes.
  if (!(game.n >= MIN_COUNTED)) {
    const recent = [...profile.recent, { at, result, acc, n: game.n, level: profile.level }].slice(-10);
    return { profile: { ...profile, recent }, delta: 0, takeaways };
  }

  // 1. level
  const placement = profile.games < 3;                               // placement games count double
  const target = levelFromAccuracy(acc);
  const w = Math.min(0.25, game.n / (game.n + 100)) * (placement ? 2 : 1);
  const cap = placement ? 1.0 : 0.5;
  const delta = clamp((target - profile.level) * w + 0.35 * game.drift, -cap, cap);
  const level = clamp(profile.level + delta, LEVEL_MIN, LEVEL_MAX);

  // 2. streak and band
  let { streak, bandShift } = profile;
  if (result === 'win') {
    streak = Math.max(1, streak + 1);
    bandShift -= 25;
  } else if (result === 'loss') {
    streak = Math.min(-1, streak - 1);
    bandShift += 40;
  } else {
    streak = 0;
    bandShift += 5;
  }
  bandShift = clamp(bandShift, -60, 120);

  // 3. tactics counters, in the order the tests were met
  const seen = [0, 1, 2].map(i => profile.tactics.seen[i] ?? 0);
  const found = [0, 1, 2].map(i => profile.tactics.found[i] ?? 0);
  for (const s of game.samples) {
    if (!s.test) continue;
    const i = s.test.tier - 1;
    seen[i] = TACTICS_DECAY * seen[i] + 1;
    found[i] = TACTICS_DECAY * found[i] + (s.test.found ? 1 : 0);
  }

  // 4. habits
  /** @type {Record<string, number>} */
  const habits = {};
  for (const [code, count] of Object.entries(profile.habits)) habits[code] = count * 0.9;
  for (const s of game.samples) {
    if (s.habit) habits[s.habit] = Math.min(9, (habits[s.habit] ?? 0) + 1);
  }
  for (const code of Object.keys(habits)) if (!(habits[code] >= 0.2)) delete habits[code];

  // 5. the record of the game
  const recent = [...profile.recent, { at, result, acc, n: game.n, level }].slice(-10);
  return {
    profile: { v: 1, level, games: profile.games + 1, tactics: { seen, found }, streak, bandShift, habits, recent },
    delta,
    takeaways,
  };
}
