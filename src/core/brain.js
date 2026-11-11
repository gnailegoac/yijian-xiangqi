/**
 * The jobs survey / assess / opponent / analyze and the plan table (contract section 4.8).
 * createBrain() has no worker-specific code: it runs in Node tests and inside search-worker.js.
 * A cancelled job rejects with { cancelled: true }.
 *
 * The brain composes search.js, facts.js and teacher.js and is the only door the game layer has to them. Every result
 * is plain JSON. The brain keeps no game state: what survives between jobs is the transposition table of its searcher.
 *
 * Points the contract leaves open, as implemented here:
 * - One job at a time. A job that is started while another job of the same brain is still running takes the searcher
 *   over (search.js runs one analysis at a time), and the older job rejects with { cancelled: true } at its next step,
 *   exactly as if its own control had been cancelled.
 * - Cancellation is cooperative: the control's `cancelled` flag is read by the search (between root moves and at its
 *   clock check) and by the job between its steps. Between its steps a job also awaits `ctl.yield()` once, so that a
 *   worker can take a `cancel` or a new `job` message there too.
 * - Progress is never sent for a cancelled job. `analyze` sends every completed iteration as progress ('table', result).
 * - survey: the deep table (step 4) is skipped when the shallow one already stopped on a mate score (the root loop of
 *   A3.3 would stop at the same iteration again) or when no time of surveyMs is left; the result's table is the deep
 *   one only when it got deeper than the shallow one. With no legal move the table has no lines, the search score fed
 *   to the tension is -MATE (the side to move has lost) and `moves` is empty.
 * - assess: the payload's table is used only when it is the table of the payload's position. The facts of the tried
 *   move are computed first, so an illegal move fails before any search.
 * - assess, forced mates (WAVE1-NOTES, "src/core/brain.js"): the search does not see every forced mate a move
 *   allows. When the checks-only mate search of facts.js (MoveFacts.allowsMate, each line replayed by the rules
 *   engine) proves that the opponent mates after the tried move or after the comparison move and the pair search
 *   does not report a mate for that move, its line is handed to assessMove with the proven mate:
 *   score -(MATE - 2 * in), pv = the move followed by the mating line; depth and byDepth stay the search's, so the
 *   refutation's revealDepth says "deeper than the search looked". Nothing else of the pair is touched. This
 *   catches two cases. A mate in three behind the early stop of the pair search: the root loop stops at depth 3
 *   as soon as its best line is a mate score (A3.3), whatever minDepth says, so when the comparison move mates
 *   (or every move is lost) the tried move is searched to depth 3 only, one move short of a mate in three.
 *   (Measured on 1,887 moves that allow a checks-only mate: 9 of 311 mates in three were not reported, all of them
 *   behind this stop; none of 1,576 mates in one or two; a pair that reaches depth 4 missed none.) And a mate
 *   behind a repeated position: the search takes the second occurrence of a game position for a draw (A3.4)
 *   while the game needs three, so a mate that the rival spared once is still there when the child repeats the
 *   move. A mate that the repetition rule of the game itself rules out is not reported:
 *   when the move, or a move of the mating line, would bring a position about for the third time since the last
 *   capture, the game is drawn there or the check is forbidden (Appendix A4), and the search's score stands.
 * - assess, replies: the position after the move is searched with the game history extended by the payload's
 *   position (a capture starts a new history); the answers are the lines exact at the final depth, at most three.
 *   When a mate is proven as above and the first answer of that search does not end in mate, the mating answer
 *   comes first, so that the assessment and the replies tell the same story.
 * - opponent: the rival thinks as deep as his level, not as deep as the device allows (CONTRACT-NOTES 143 a; this departs
 *   from step 1 of section 4.8.2). His table is searched to min(plan.opponentDepth, d) with every move exact to
 *   min(plan.allDepth, a), d and a by the level of the payload's context (RIVAL_DEPTHS: 5 and 3 below level 5, 6 and 4
 *   below level 7, 7 and 4 below level 9, the plan row at level 9). The low levels were tuned on a table of depth 5
 *   with every move exact to depth 3; a deeper table sees the child's distant mates and tactics and rejects the soft
 *   moves that would allow them, so the same rival was harder on a faster device. thinkMs and verifyMs stay: a search
 *   that reaches its depth early ends early. The verify searches follow the table's depth, as before. survey, assess
 *   and analyze keep the plan row.
 * - opponent: all verify calls of one selection share one deadline, verifyMs after the selection starts. A call
 *   made after the deadline returns null without searching; any other call returns the single-move RootLine of the
 *   search unchanged, with the time left as its `timeMs` (so the search's hard deadline is the shared one) and
 *   minDepth min(table.depth, 4). The teacher reads "budget used up" from null or from a shallower line.
 * - opponent: `quality` applies the thresholds of section 4.6.1 with k = 1 to choice.loss as it is (no compression);
 *   the tension is computed on the position after the rival's move (the child to move), with the child's score of the
 *   chosen line as the latest search score.
 * - Search principal variations become Lines with toLine; `end` is 'cut' when the PV has the full pvLength and a
 *   capture is pending in its last position (the rule facts.js applies to the lines of assessMove and hintFor).
 * - The time is read from the global `performance.now()` at every use, as search.js reads it.
 * - planFor throws a RangeError for anything but 'fast', 'mid' and 'slow'.
 */

import { applyMove, boardToFen, fenToBoard, opposite } from './engine.js';
import { assessMove, habitTraps, materialOutcome, moveFacts, positionFacts, tacticalTest, threatInfo } from './facts.js';
import { describeMove, toLine } from './notation.js';
import { MATE, createSearcher, mateIn, scoreToCp } from './search.js';
import { chooseTeachingMove, tension } from './teacher.js';

/** @import { Cat } from './codes.js' */
/** @import { SearchControl } from './search.js' */
/** @import { Analysis, AnalyzeRequest, Assessed, AssessPayload, Board, Color, Line, MateThreat, MoveFacts, MoveRef, OpponentPayload, OpponentTurn, RootLine, Survey, SurveyPayload, TeachingChoice, ThreatInfo } from './types.js' */

/** Root moves that stay exact in the deep iterations of the survey table and of the rival's table (section 4.8.2). */
const TABLE_MULTI_PV = 6;
/** Budget of the survey's shallow table, ms (section 4.8.2, survey step 2). */
const SHALLOW_MS = 400;
/** Budget of the best-only search that supplies a comparison move when the assess payload has none, ms (assess step 1). */
const COMPARE_MS = 150;
/** Rival answers reported by the assess job, and the budget of their search, ms (assess step 4). */
const REPLY_COUNT = 3, REPLIES_MS = 150;
/** Default `pvLength` of an AnalyzeRequest (section 3.2); no request of this module overrides it. A PV of this length may be truncated. */
const PV_LENGTH = 8;
/** mateIn() of a repetition-ban score is 50 or more: such a score is a verdict, not a mate (CONTRACT-NOTES item 88). */
const REPETITION_MATE = 50;
/**
 * How deep the rival's table is searched at most, by his level (CONTRACT-NOTES 143 a): below `below`, the table goes to
 * `maxDepth` with every move exact to `allDepth`; the plan row caps both. From the last row's level on (level 9) the plan
 * row alone decides. The first row is the instrument the low levels were tuned on. In the third row every move is exact
 * to depth 4, not 5 as the owner's starting table had it: with 5, on a fast device, a fifth of the simulated games of
 * a level-6.5 child went on for a hundred moves (in a long game he found a move to crack with less often); with 4 the
 * fast and the mid device send the same request up to level 9.
 */
const RIVAL_DEPTHS = Object.freeze([
  Object.freeze({ below: 5, maxDepth: 5, allDepth: 3 }),
  Object.freeze({ below: 7, maxDepth: 6, allDepth: 4 }),
  Object.freeze({ below: 9, maxDepth: 7, allDepth: 4 }),
]);

const now = () => performance.now();

/** What a cancelled job rejects with. @returns {{cancelled:true}} */
const cancellation = () => ({ cancelled: true });

/** @param {MoveRef} a @param {MoveRef} b @returns {boolean} */
const sameMove = (a, b) => a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;

/** Placement and side of a FEN, the side letter as `w` or `b` (`r` means red, Appendix A4). @param {string} fen @returns {string} */
function positionOf(fen) {
  const fields = String(fen).trim().split(/\s+/);
  return `${fields[0]} ${fields[1] === 'b' ? 'b' : 'w'}`;
}

/** The game positions since the last capture, oldest first (never undefined). @param {{history?:string[]}} payload @returns {string[]} */
function historyOf(payload) {
  return Array.isArray(payload.history) ? payload.history : [];
}

/**
 * A search PV as a Line. `end` is 'cut' when the PV may have been truncated (it has `full` moves or more) and a capture
 * is pending in its last position; materialOutcome then settles that exchange.
 * @param {Board} board @param {Color} turn the side that plays pv[0]
 * @param {MoveRef[]} pv
 * @param {number} [full] the length at which the search cuts this PV
 * @returns {Line}
 */
function searchLine(board, turn, pv, full = PV_LENGTH) {
  const line = toLine(board, turn, pv);
  if (line.end === 'mate' || pv.length < full || line.moves.length !== pv.length) return line;
  let last = board;
  for (const move of line.moves) last = applyMove(last, move);
  const side = line.moves.length % 2 === 0 ? turn : opposite(turn);
  // materialOutcome settles a 'cut' line that has no move left by the best pending capture of the side to move:
  // it reports captured material exactly when there is one worth a pawn or more.
  if (materialOutcome({ start: boardToFen(last, side), moves: [], end: 'cut' }, side).kind !== 'none') line.end = 'cut';
  return line;
}

/**
 * The root line of a move that provably allows a forced mate (checks-only mate search of facts.js) although the search
 * did not report one: the mover is mated on the opponent's move number `mate.in`, 2 * in plies from the root.
 * @param {RootLine} line @param {MateThreat} mate the opponent's mate after the move
 * @returns {RootLine}
 */
function matedLine(line, mate) {
  const score = 2 * mate.in - MATE;
  return {
    ...line,
    score,
    upper: null,
    mate: mateIn(score),
    pv: [line.move, ...mate.line.moves.map(move => ({ from: { row: move.from.row, col: move.from.col }, to: { row: move.to.row, col: move.to.col } }))],
  };
}

/**
 * Whether the forced mate that follows `move` can be played out in the game. A position that has occurred twice since
 * the last capture ends the game in a draw when it occurs again, or the move that repeats it is a forbidden perpetual
 * check (Appendix A4): a mating line that passes through such a position does not mate.
 * @param {Board} board @param {Color} turn the mover
 * @param {MoveRef} move
 * @param {MateThreat} mate the opponent's mate after the move
 * @param {string[]} earlier the game positions since the last capture, the current one included, as positionOf() gives them
 * @returns {boolean}
 */
function mateStands(board, turn, move, mate, earlier) {
  let position = board;
  let side = turn;
  for (const step of [move, ...mate.line.moves]) {
    position = applyMove(position, step);
    side = opposite(side);
    const key = positionOf(boardToFen(position, side));
    let count = 0;
    for (const seen of earlier) if (seen === key) count++;
    if (count >= 2) return false;
  }
  return true;
}

/** @param {number} score @returns {boolean} the score is a real mate for one of the sides (not a repetition verdict) */
function isMateScore(score) {
  const moves = mateIn(score);
  return moves !== null && Math.abs(moves) < REPETITION_MATE;
}

/** The verdict thresholds of section 4.6.1 with k = 1 (no brilliant test). @param {number} loss cp @returns {{loss:number, cat:Cat}} */
function qualityOf(loss) {
  /** @type {Cat} */
  const cat = loss > 300 ? 'blunder' : loss > 120 ? 'mistake' : loss > 50 ? 'ok' : loss > 15 ? 'good' : 'best';
  return { loss, cat };
}

/** @param {{ttBits?:number}} [opts] @returns {Brain} */
export function createBrain(opts) {
  /**
   * What a running job uses (local to this function: the module's type names are those of section 4.8).
   * @typedef {Object} Job
   * @property {() => void} check                      throws the cancellation when the job was cancelled or superseded
   * @property {(stage:'facts'|'table'|'threat', data:unknown) => void} progress
   * @property {() => Promise<void>} pause             lets the caller's event loop run once (ctl.yield), then check()
   * @property {(req:AnalyzeRequest, onDepth?:(r:Analysis) => void) => Promise<Analysis>} search
   */
  const searcher = createSearcher({ ttBits: opts?.ttBits });
  const speed = searcher.calibrate();
  const plan = planFor(speed.speedClass);
  /** Number of the job that owns the searcher; a job that finds another number here has been superseded. */
  let current = 0;

  /** @param {JobControl|undefined} ctl @returns {Job} */
  function begin(ctl) {
    const id = ++current;
    const cancelled = () => id !== current || (ctl !== undefined && ctl.cancelled === true);
    const check = () => {
      if (cancelled()) throw cancellation();
    };
    return {
      check,
      progress(stage, data) {
        if (ctl !== undefined && ctl.onProgress !== undefined && !cancelled()) ctl.onProgress(stage, data);
      },
      async pause() {
        check();
        if (ctl !== undefined && ctl.yield !== undefined) {
          await ctl.yield();
          check();
        }
      },
      async search(req, onDepth) {
        check();
        /** @type {SearchControl} */
        const control = {
          get cancelled() {
            return cancelled();
          },
          onDepth,
          yield: ctl === undefined ? undefined : ctl.yield,
        };
        const result = await searcher.analyze(req, control);
        check();
        return result;
      },
    };
  }

  /** @param {SurveyPayload} p @param {JobControl} [ctl] @returns {Promise<Survey>} */
  async function survey(p, ctl) {
    const job = begin(ctl);
    const started = now();
    const fen = p.fen;
    const history = historyOf(p);

    // 1. Facts.
    const facts = positionFacts(fen, { ply: p.ply });
    job.progress('facts', facts);
    await job.pause();

    // 2. Shallow table: every root move exact.
    /** @type {AnalyzeRequest} */
    const request = { fen, history, allDepth: plan.allDepth, multiPV: TABLE_MULTI_PV, maxDepth: plan.allDepth, timeMs: SHALLOW_MS };
    let table = await job.search(request, result => {
      if (result.depth >= 2) job.progress('table', result);
    });
    await job.pause();

    // 3. Threat: what the rival does if the child passes. Skipped when the child is in check; always reported.
    /** @type {ThreatInfo|null} */
    let threat = null;
    if (facts.check === null) {
      const pass = await job.search({ fen, history, pass: true, multiPV: 1, maxDepth: plan.threatDepth, timeMs: plan.threatMs });
      threat = threatInfo(fen, pass, facts);
    }
    job.progress('threat', threat);
    await job.pause();

    // 4. Deep table: the same request, deeper, in the time that is left.
    const shallowDepth = table.depth;
    const remaining = plan.surveyMs - (now() - started);
    if (table.lines.length > 0 && table.stopped !== 'mate' && plan.surveyDepth > shallowDepth && remaining > 0) {
      const deep = await job.search({ ...request, maxDepth: plan.surveyDepth, timeMs: remaining }, result => {
        if (result.depth > shallowDepth) job.progress('table', result);
      });
      if (deep.depth > shallowDepth) table = deep;
      await job.pause();
    }

    // 5. Result.
    const { board } = fenToBoard(fen);
    const score = table.lines.length > 0 ? table.lines[0].score : -MATE;
    return {
      fen,
      facts,
      threat,
      table,
      moves: table.lines.map(line => describeMove(board, line.move)),
      test: tacticalTest(fen, table, facts),
      traps: habitTraps(fen, table, facts, threat),
      tension: tension({ facts, score, evalNow: scoreToCp(score), evalTwoPliesAgo: p.evalTwoPliesAgo ?? null }, p.tensionPrev),
    };
  }

  /** @param {AssessPayload} p @param {JobControl} [ctl] @returns {Promise<Assessed>} */
  async function assess(p, ctl) {
    const job = begin(ctl);
    const { fen, move, ply } = p;
    const history = historyOf(p);
    const table = p.table !== null && p.table !== undefined && positionOf(p.table.fen) === positionOf(fen) ? p.table : null;
    const { board, turn } = fenToBoard(fen);

    // The facts of the move (step 3) come first: an illegal move fails here, before any search.
    const facts = moveFacts(fen, move, { ply });
    await job.pause();

    // 1. The comparison move: the pinned one, else the table's best, else the best of a short search.
    let compare = p.compare ?? null;
    if (compare === null) {
      if (table !== null && table.depth >= 2 && table.lines.length > 0) {
        compare = table.lines[0].move;
      } else {
        const glance = await job.search({ fen, history, timeMs: COMPARE_MS });
        compare = glance.lines[0].move;                        // the tried move is legal, so there is a line
      }
    }

    // 2. Both moves, exact at the same depth.
    const same = sameMove(compare, move);
    const D = Math.max(table === null ? 0 : table.depth, plan.assessDepth);
    const searched = await job.search({
      fen, history, rootMoves: same ? [move] : [compare, move], allDepth: D, maxDepth: D, minDepth: Math.min(D, 4), timeMs: plan.assessMs,
    });

    // A forced mate that the checks-only mate search proves and this search did not see.
    const compareFacts = same ? facts : moveFacts(fen, compare, { ply });
    const earlier = [...history, fen].map(positionOf);
    /** The opponent's mate after a move, when it is proven and the game's repetition rule lets it be played. @param {MoveFacts} of */
    const provenMate = of => (of.allowsMate !== null && mateStands(board, turn, of.move, of.allowsMate, earlier) ? of.allowsMate : null);
    const mateAfterMove = provenMate(facts);
    const mateAfterCompare = same ? mateAfterMove : provenMate(compareFacts);
    const lines = searched.lines.map(line => {
      const mate = sameMove(line.move, move) ? mateAfterMove : mateAfterCompare;
      return mate !== null && !isMateScore(line.score) ? matedLine(line, mate) : line;
    });
    lines.sort((a, b) => b.score - a.score);
    /** @type {Analysis} */
    const pair = { ...searched, lines };

    // 3. The assessment.
    const assessment = assessMove({ fen, move, pair, table, level: p.level, compare });
    await job.pause();

    // 4. Up to three rival answers.
    const fenAfter = facts.fenAfter;
    const boardAfter = applyMove(board, move);
    const rival = opposite(turn);
    const plyAfter = typeof ply === 'number' ? ply + 1 : undefined;
    const answers = await job.search({
      fen: fenAfter, history: facts.move.captured === null ? [...history, fen] : [], multiPV: REPLY_COUNT, maxDepth: Math.max(1, D - 1), timeMs: REPLIES_MS,
    });
    let replies = answers.lines.filter(root => root.depth === answers.depth).slice(0, REPLY_COUNT).map(root => {
      const line = searchLine(boardAfter, rival, root.pv);
      return {
        move: describeMove(boardAfter, root.move),
        line,
        outcome: materialOutcome(line, turn),                   // the child's view
        facts: moveFacts(fenAfter, root.move, { ply: plyAfter }),
      };
    });
    // The proven mate is the rival's answer: it comes first when this search does not show a mate itself.
    if (mateAfterMove !== null && mateAfterMove.line.moves.length > 0 && !(replies.length > 0 && replies[0].line.end === 'mate')) {
      const mating = mateAfterMove.line.moves[0];
      replies = [{
        move: describeMove(boardAfter, mating),
        line: mateAfterMove.line,
        outcome: materialOutcome(mateAfterMove.line, turn),
        facts: moveFacts(fenAfter, mating, { ply: plyAfter }),
      }, ...replies.filter(reply => !sameMove(reply.move, mating))].slice(0, REPLY_COUNT);
    }
    job.check();
    return { assessment, facts, replies };
  }

  /** @param {OpponentPayload} p @param {JobControl} [ctl] @returns {Promise<OpponentTurn>} */
  async function opponent(p, ctl) {
    const job = begin(ctl);
    const { fen, ply } = p;
    const history = historyOf(p);
    const { board, turn } = fenToBoard(fen);
    const child = opposite(turn);

    // 1. The rival's table, as deep as his level thinks and no deeper than the plan row (a level that is no number counts as the lowest).
    const level = p.ctx.level;
    const depths = RIVAL_DEPTHS.find(row => !(level >= row.below));
    const maxDepth = depths === undefined ? plan.opponentDepth : Math.min(plan.opponentDepth, depths.maxDepth);
    const allDepth = depths === undefined ? plan.allDepth : Math.min(plan.allDepth, depths.allDepth);
    const table = await job.search({ fen, history, allDepth, multiPV: TABLE_MULTI_PV, maxDepth, timeMs: plan.thinkMs });
    await job.pause();

    // 2. The teaching choice. All verify calls share one deadline.
    const deadline = now() + plan.verifyMs;
    /** @param {MoveRef} move @returns {Promise<RootLine|null>} null = the budget is used up */
    const verify = async move => {
      job.check();
      const left = deadline - now();
      if (left <= 0) return null;
      const result = await job.search({ fen, history, rootMoves: [move], maxDepth: table.depth, minDepth: Math.min(table.depth, 4), timeMs: left });
      return result.lines.length > 0 ? result.lines[0] : null;
    };
    // The teacher reads "the budget is used up" from null (teacher.js); its parameter type names the line only.
    const chosen = await chooseTeachingMove(table, p.ctx, /** @type {(move:MoveRef) => Promise<RootLine>} */ (verify));
    job.check();

    // The teacher hands the two continuations over as PVs in the place of Lines (CONTRACT-NOTES item 17).
    const pvOf = /** @param {Line} line @returns {MoveRef[]} */ line => /** @type {MoveRef[]} */ (/** @type {unknown} */ (line));
    /** @type {TeachingChoice} */
    const choice = {
      ...chosen,
      // the child's winning continuation: it starts after the rival's move, which is not part of it
      chance: chosen.chance === null ? null
        : { ...chosen.chance, line: searchLine(applyMove(board, chosen.move), child, pvOf(chosen.chance.line), PV_LENGTH - 1) },
      // what the rival could have played: it starts in this position
      overlooked: chosen.overlooked === null ? null
        : { ...chosen.overlooked, line: searchLine(board, turn, pvOf(chosen.overlooked.line)) },
    };

    // 3. The move, its line, its quality, and the tension after it.
    const facts = moveFacts(fen, choice.move, { ply });
    const line = searchLine(board, turn, choice.line.pv);
    const rivalScore = choice.line.upper === null || choice.line.upper === undefined ? choice.line.score : Math.min(choice.line.score, choice.line.upper);
    const after = positionFacts(facts.fenAfter, { ply: typeof ply === 'number' ? ply + 1 : undefined });
    return {
      move: facts.move,
      facts,
      line,
      choice,
      quality: qualityOf(choice.loss),
      childMoveCp: 0 - scoreToCp(table.lines[0].score),
      evalAfter: choice.evalAfter,
      tension: tension({ facts: after, score: 0 - rivalScore, evalNow: choice.evalAfter, evalTwoPliesAgo: p.evalTwoPliesAgo ?? null }, p.tensionPrev),
    };
  }

  /** @param {AnalyzeRequest} req @param {JobControl} [ctl] @returns {Promise<Analysis>} */
  async function analyze(req, ctl) {
    const job = begin(ctl);
    return job.search(req, result => job.progress('table', result));
  }

  return { speed, survey, assess, opponent, analyze };
}

/** @typedef {{cancelled:boolean, onProgress?:(stage:'facts'|'table'|'threat', data:any) => void, yield?:() => Promise<void>}} JobControl
 *  @typedef {Object} Brain
 *  @property {{perftNps:number, speedClass:'fast'|'mid'|'slow'}} speed
 *  @property {(p:SurveyPayload,   ctl?:JobControl) => Promise<Survey>}       survey
 *  @property {(p:AssessPayload,   ctl?:JobControl) => Promise<Assessed>}     assess
 *  @property {(p:OpponentPayload, ctl?:JobControl) => Promise<OpponentTurn>} opponent
 *  @property {(req:AnalyzeRequest, ctl?:JobControl) => Promise<Analysis>}    analyze */

/**
 * Depth and time plan, the single source of budgets (section 4.8.1). Chosen once from speed.speedClass:
 * fast >= 3 M perft leaf nodes/s, mid >= 1 M, slow below. Depths in plies, budgets in ms.
 * verifyMs covers all `verify` calls of one move (hard deadline).
 */
export const PLAN = {
  fast: { allDepth: 5, surveyDepth: 9, surveyMs: 1200, threatDepth: 5, threatMs: 60, assessDepth: 7, assessMs: 300, opponentDepth: 8, thinkMs: 500, verifyMs: 250 },
  mid: { allDepth: 4, surveyDepth: 8, surveyMs: 1500, threatDepth: 4, threatMs: 100, assessDepth: 6, assessMs: 400, opponentDepth: 7, thinkMs: 700, verifyMs: 350 },
  slow: { allDepth: 3, surveyDepth: 6, surveyMs: 1800, threatDepth: 3, threatMs: 150, assessDepth: 5, assessMs: 600, opponentDepth: 6, thinkMs: 900, verifyMs: 450 },
};

/** The plan row of a speed class. @param {'fast'|'mid'|'slow'} speedClass @returns {typeof PLAN.fast} */
export function planFor(speedClass) {
  if (speedClass === 'fast' || speedClass === 'mid' || speedClass === 'slow') return PLAN[speedClass];
  throw new RangeError(`planFor: unknown speed class ${String(speedClass)}`);
}
