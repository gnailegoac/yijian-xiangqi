// Director (SPEC 4.25): the only orchestrator. Imports src/game/* and codes.js; everything else arrives through the
// three ports. No DOM, no `window`: timers are injected. State and rules: SPEC 4.25.1-4.25.7; effect scripts: SPEC 5.8.
// Owner: G4.
//
// "The director says what happened; the stage decides how it looks and sounds." This file knows the order of things in
// a game and nothing else: every chess fact comes from the BrainPort, every packet and sentence from the CoachPort.
//
// How the invariant of section 6 is kept here (layer 3, the continuation gate): every `await` of a script goes through
// `ctx.wait()`, which re-reads the session scope and throws the private STALE token when the script's lifetime ended;
// every callback of a brain job checks that its position book is still the current one; every coach handler is wrapped
// in the gate of its `tasks.run` task.
//
// Readings of points the contract leaves open (each is reported with the package):
// - `stage.phase` is told at the places section 5.8 prints and, in addition, at the end of every session batch when what
//   it would say changed (select, trial, retract, pouch, failed rival). `stage.selected` follows every `selection` event,
//   except the one that comes with a retract (`stage.retracted` carries the same data). `stage.notation` is also told when
//   a game starts.
// - `stage.coachBegin` is called at the first thing there is to show (an interjection, a segment, a tool round) or, when
//   the thread method returned with the reply still in flight, right then (the dots). A local answer that turns out
//   empty therefore never opens a bubble (CONTRACT-NOTES 110 e).
// - The pinned truth (4.25.3): `bestCp` follows every table; `depth` moves only when the table's best move is the pinned
//   move. With the letter ("depth refreshed by every table") a table could never be "two plies deeper", because the
//   survey reports every depth.
// - `last.evals[k]` is the child's-view evaluation of the position after k plies (survey: the best line; rival job:
//   `childMoveCp` for its own position and `evalAfter` for the next).
// - `found` of a trial: the move is in the tactical test's group and it is the first move tried this turn.
// - A restored finished game opens its over thread 'local': the card gets its line and no request leaves on reload.
// - The 20 s / 90 s idle timers, the 400 ms threat wait and the beacon delays have no name in policy.js; they are
//   constants here.

/**
 * @import { Board, Color, Square, Move, MoveRef, MoveCode, MoveInfo, Analysis, RootLine, PositionFacts, Quick, ThreatInfo, Survey, Assessed,
 *           OpponentTurn, TurnTruth, MoveSample, GameSkill, TeachingChoice, FinishResult } from '../core/types.js'
 * @import { Cat, AskCode, HabitCode, PatternCode } from '../core/codes.js'
 * @import { TurnBrief, TryPacket, MorePacket, OverPacket, MoveLink, StartEvent, OppEvent } from '../coach/types.js'
 * @import { MoveBook } from '../coach/book.js'
 * @import { GameMemory } from '../coach/memory.js'
 * @import { TurnReport } from '../coach/brief.js'
 * @import { SessionEvent, SessionState, SavedGame, Settings, Profile, Notice, Ply, Trial, Scope, Lifetime, TaskHandle,
 *           BrainPort, CoachPort, StagePort, StageHandlers, StageView, ChipSpec, CoachKind, Thread, Handlers, Reply, ReplyOpts, ReplyResult,
 *           SayMode } from './types.js'
 * @import { Session } from './session.js'
 * @import { Store } from './store.js'
 * @import { createTasks } from './tasks.js'
 * @import { Budgets } from './policy.js'
 */

import { ASK_CODES, ASK_LABEL, HABIT_FIX, HABIT_OF_DANGER, PIECE_VALUE, RANK_NAMES, TACTIC_MOTIFS } from '../core/codes.js';
import { canAsk, canUndo, capturedPieces, displayBoard, fenOf, historyFens } from './session.js';
import { createBudgets, shouldSpeakOpp, announceChance, voiceHeld, afterHeld, praiseFor, stampFor, rivalThinkMs, idleOffer, offerTakeback,
         softCheck } from './policy.js';
import { rivalReact } from './rival.js';
import { STR } from './strings.js';
import { notationRows, buildRecord, buildBackupFile, download } from './record.js';
import { recordResult } from './store.js';

/** The private token of a script whose lifetime ended (SPEC 4.25.2). */
const STALE = Symbol('stale');

const COACH_TIMEOUT_MS = 21000;       // 6.7: the task timeout of one coach reply (the client's own deadline is 20 s)
const ASK_GAP_MS = 800;               // D-21: the shortest time between two questions
const SAY_MAX = 120;                  // D-21: a typed question, in code points
const THREAT_WAIT_MS = 400;           // E-turn: how long the brief waits for the pass search behind the rival's move
const HINT_SAY_MS = 300;              // D-16: a pouch says that it is still looking after this long ...
const HINT_WAIT_MS = 2000;            // ... and gives up after this long
const BEACON_SILENT_MS = 600;         // E-trial: the confirm beacon after a nod, counted from the landing
const BEACON_SPOKEN_MS = 1500;        // ... and after a spoken comment that has not finished its first sentence
const NUDGE_MS = 20000;               // D-36: an unannounced chance is nudged after this long without input
const IDLE_MS = 90000;                // D-43: the spoken offer of a pouch
const TROUBLE_CP = 400;               // 4.22: 司马懿 is in trouble when the child is this far ahead
const LOSS_CAP = 600;                 // 4.7.2: the loss of a sample is capped
const TRUTH_GAIN_CP = 60;             // 4.25.3
const TRUTH_DEPTH_STEP = 2;           // 4.25.3
const OPENING_PLIES = 8;              // E-commit: an opening name can still change up to this ply
const PREVIEW_PLIES = 2;              // E-ask `reply`: how many plies of the answer are ghost-played
const MAX_CHIPS = 4;                  // 4.25.6
const FORCED_MOVES = 2;               // CONTRACT-NOTES 138: a move made with at most this many legal moves is forced

/** Ask codes that are about the trial on the board: they need its try event in the thread first (4.10 rule 5). */
const TRY_ASKS = /** @type {readonly string[]} */ (['good', 'reply', 'better', 'show']);
/** Ask codes that may carry the withheld `more` packet, and with it the pinned better move (4.25.3). */
const MORE_ASKS = /** @type {readonly string[]} */ (['reply', 'better', 'why', 'show', 'free']);
/** Ask codes of a game-over thread. */
const OVER_ASKS = /** @type {readonly string[]} */ (['proud', 'improve', 'next', 'why', 'free']);

/**
 * One tried move of a position (SPEC 4.25.1, `book.trials`). It stays after a retract, so trying the move again is instant,
 * as long as the pinned truth is still the move its assessment was measured against.
 * @typedef {Object} TrialEntry
 * @property {MoveInfo} info
 * @property {Quick|null} quick
 * @property {Assessed|null} assessed
 * @property {MoveRef|null} pin                       the pinned best move `assessed` was compared with (null: none was pinned yet)
 * @property {{packet:TryPacket, more:MorePacket}|null} built
 * @property {boolean} earned
 * @property {boolean} voiced
 * @property {boolean} held
 * @property {boolean} found
 *
 * The trial on the board.
 * @typedef {Object} TrialNow
 * @property {number} id
 * @property {TrialEntry} entry
 * @property {{tries:number, first:MoveRef|null, hintAtFirst:0|1|2|3}} attempt      copied at trial:start
 * @property {0|1|2|3} hintLevel                     copied at trial:start
 * @property {Promise<void>} landed                   stage.tentative()
 * @property {TryPacket|null} prev                    the packet of the try before this one (book.lastPacket at trial:start)
 * @property {MoveRef|null} pin                       the pinned best move its assess job in flight was given to compare with
 * @property {boolean} commented                      its final verdict reached the stage
 * @property {Cat|null} cat                           ... and the category that verdict had
 * @property {boolean} resync                         the thread's try event is older than entry.built (the pin moved, the verdict did not)
 * @property {boolean} tried                          thread.tryMove was called for it (and no new assessment of it is under way)
 * @property {boolean} failed                         its assess job failed
 * @property {boolean} voiced                         its guiding question is showing
 * @property {boolean} spoke                          a sentence about it was said (the child "waited" for the comment)
 * @property {((ok:boolean) => void)[]} waiters       questions waiting for the try event
 *
 * One per committed position; replaced on every positionId change.
 * @typedef {Object} PositionBook
 * @property {number} gameId
 * @property {number} positionId
 * @property {string} fen
 * @property {number} ply
 * @property {PositionFacts|null} facts
 * @property {{handle:TaskHandle<Survey>|null, table:Analysis|null, threat:ThreatInfo|null|undefined, final:Survey|null, failed:boolean}} survey
 * @property {TurnTruth|null} truth
 * @property {Map<MoveCode, TrialEntry>} trials
 * @property {TurnReport|null} report
 * @property {TurnBrief|null} turn
 * @property {MoveBook|null} moveBook
 * @property {Thread|null} thread
 * @property {TrialNow|null} trial
 * @property {TryPacket|null} lastPacket              the packet of the try before the one on the board
 * @property {(() => void)[]} tableWaiters
 * @property {(() => void)[]} threatWaiters
 * @property {(() => void)[]} briefWaiters
 * @property {number} activeAtStart                   active play time when the position was entered
 * @property {boolean} nudged
 * @property {boolean} idleOffered
 * @property {boolean} takeback                       the take-back chip is on offer
 *
 * A child move whose verdict was not known at confirm (SPEC 4.25.5, CONTRACT-NOTES 69 c).
 * @typedef {{sample:MoveSample, cat:Cat|null}} PendingSample      cat = quickVerdict on the survey table as it stood at confirm
 *
 * @typedef {{seed:number, skill:GameSkill, memory:GameMemory, budgets:Budgets, pendingSample:PendingSample|null, pendingSelect:Square|null,
 *            activeMs:number, visibleSince:number|null, goalPrev:HabitCode|null}} GameState
 *    goalPrev = the small goal that was in force when this game began: what `kept` is judged against, also when the game is
 *    finished a second time after an undo
 */

/** scoreToCp of the section 3 conventions (CONTRACT-NOTES 69 a). @param {number} score @returns {number} */
function scoreToCp(score) {
  if (score >= 29800) return 2000;
  if (score <= -29800) return -2000;
  return Math.max(-1900, Math.min(1900, score));
}

/** The search score of a table line that may not be exact at the table's depth. @param {RootLine} line @returns {number} */
function lineScore(line) {
  return line.upper === null || line.upper === undefined ? line.score : Math.min(line.score, line.upper);
}

/** The value of a table line that may not be exact at the table's depth. @param {RootLine} line @returns {number} */
function lineCp(line) {
  return scoreToCp(lineScore(line));
}

/**
 * How much better the search score `a` is than `b`: the difference of the scores themselves, which does not vanish where
 * scoreToCp has run out of scale (beyond +-1900 every score reads the same; CONTRACT-NOTES 147); with a mate score on
 * either side, the difference of their centipawn values.
 * @param {number} a @param {number} b @returns {number}
 */
function scoreGap(a, b) {
  return Math.abs(a) >= 29800 || Math.abs(b) >= 29800 ? scoreToCp(a) - scoreToCp(b) : a - b;
}

/** @param {Square} a @param {Square} b @returns {boolean} */
function sameSquare(a, b) {
  return a.row === b.row && a.col === b.col;
}

/** @param {MoveRef} a @param {MoveRef} b @returns {boolean} */
function sameMove(a, b) {
  return sameSquare(a.from, b.from) && sameSquare(a.to, b.to);
}

/** @param {MoveRef} move @returns {MoveRef} a plain reference (JSON, fresh objects) */
function refOf(move) {
  return { from: { row: move.from.row, col: move.from.col }, to: { row: move.to.row, col: move.to.col } };
}

/** The MoveCode of a move: its four digits (CONTRACT-NOTES 69 e). @param {MoveRef} move @returns {MoveCode} */
function codeOf(move) {
  return `${move.from.row}${move.from.col}${move.to.row}${move.to.col}`;
}

/** @param {Move} move @param {string} notation @returns {MoveInfo} */
function infoOf(move, notation) {
  return { ...refOf(move), notation, piece: move.piece.type, color: move.piece.color, captured: move.captured ? move.captured.type : null };
}

/** The move number of the move played after `ply` plies (both sides: 1, 1, 2, 2, ...). @param {number} ply @returns {number} */
function moveNo(ply) {
  return Math.floor(ply / 2) + 1;
}

/** @param {Cat|null} cat @returns {boolean} */
function isSlip(cat) {
  return cat === 'mistake' || cat === 'blunder';
}

/** @param {unknown} error */
function reportError(error) {
  console.error('[director]', error);
}

/**
 * @param {{ session:Session, tasks:ReturnType<typeof createTasks>, store:Store, brain:BrainPort, coach:CoachPort, stage:StagePort,
 *           profile:Profile, settings:Settings, save:() => void,
 *           rng:() => number, now:() => number, setTimer:typeof setTimeout, clearTimer:typeof clearTimeout,
 *           isHidden?:() => boolean, reload?:() => void }} deps
 *        reload: the injected `location.reload()` used after a successful importBackup (SPEC 4.25.7)
 * @returns {Director}
 */
export function createDirector(deps) {
  const { session, tasks, store, brain, coach, stage, save, rng, now, setTimer, clearTimer } = deps;
  /** One live object for the whole session: read at the moment it is needed, never kept across an await. */
  const state = session.getState();

  let profile = deps.profile;
  let settings = deps.settings;
  let disposed = false;
  let hidden = deps.isHidden ? deps.isHidden() === true : false;

  /** @returns {number} a fresh uint32 for a game seed */
  const drawSeed = () => Math.floor(rng() * 0x100000000) >>> 0;

  /** @param {number} seed @param {GameSkill} skill @param {GameMemory} memory @param {number} activeMs @returns {GameState} */
  const gameOf = (seed, skill, memory, activeMs) =>
    ({ seed, skill, memory, budgets: createBudgets(), pendingSample: null, pendingSelect: null, activeMs, visibleSince: null, goalPrev: null });

  /** @type {GameState} */
  let game = gameOf(0, brain.createGameSkill(0), coach.createGameMemory(null), 0);
  /** What loadExtras() read from the save, until the restore that belongs to it arrives. @type {{seed:number, skill:GameSkill, memory:GameMemory, activeMs:number}|null} */
  let loaded = null;
  /** @type {{opp:OpponentTurn|null, prev:TurnReport['prev'], tension:number, evals:number[]}} */
  let last = { opp: null, prev: null, tension: 0.1, evals: [] };
  /** @type {PositionBook|null} */
  let book = null;
  /** The game-over conversation. @type {{positionId:number, thread:Thread|null, moveBook:MoveBook|null, packet:OverPacket|null, ready:boolean}|null} */
  let over = null;
  /** The promise of the most recent board animation. @type {Promise<void>} */
  let lastAnim = Promise.resolve();

  /** The voiced guiding question that is showing: the squares that answer it (4.25.7 tap). @type {{trialId:number, focus:Square[]}|null} */
  let question = null;
  /** Consecutive refused taps. */
  let refusals = 0;
  let tapOverTold = false;
  let storageTold = false;
  let lastAskAt = -Infinity;
  let seenCount = 0;
  let coachSeq = 0;
  /** What stage.phase was last told. */
  let toldPhase = '';
  /** The `selection` event of a retract batch is told through stage.retracted(). */
  let skipSelection = false;
  /**
   * The chip set that is showing: its context, the chips used in it, whether 为什么？ has something to explain, and whether a
   * question was answered in it (the `after` set of 4.25.6 leads with 为什么？; the `trial` set ends with it).
   * @type {{key:string, used:Set<string>, why:boolean, answered:boolean}}
   */
  let chipCtx = { key: '', used: new Set(), why: false, answered: false };
  /** @type {ChipSpec[]} */
  let shownChips = [];
  /** A book for local lines told while no brief exists. @type {{positionId:number, book:MoveBook}|null} */
  let plain = null;
  /** @type {ReturnType<typeof setTimeout>[]} */
  let idleTimers = [];

  // ---------------------------------------------------------------------------------------------------------------
  // Script primitive (SPEC 4.25.2)
  // ---------------------------------------------------------------------------------------------------------------

  /** @param {number} ms @returns {Promise<void>} */
  const sleepRaw = (ms) => new Promise((resolve) => { setTimer(() => resolve(undefined), Math.max(0, ms)); });

  /**
   * @typedef {{alive:() => boolean, scope:Scope, wait:<T>(p:Promise<T>|T) => Promise<T>, sleep:(ms:number) => Promise<void>}} ScriptContext
   * @param {Lifetime} lifetime
   * @param {(ctx:ScriptContext) => Promise<void>} body
   */
  function run(lifetime, body) {
    const born = session.scope();
    const alive = () => {
      if (disposed) return false;
      const s = session.scope();
      return s.game === born.game && (lifetime === 'game' || (s.position === born.position && (lifetime === 'position' || s.trial === born.trial)));
    };
    /** @type {ScriptContext} */
    const ctx = {
      alive,
      scope: born,
      wait: async (p) => {                                 // every await of a script goes through wait
        const v = await p;
        if (!alive()) throw STALE;
        return v;
      },
      sleep: (ms) => ctx.wait(sleepRaw(ms)),
    };
    body(ctx).catch((e) => { if (e !== STALE) reportError(e); });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Small readers of the live state
  // ---------------------------------------------------------------------------------------------------------------

  const levelNow = () => brain.effectiveLevel(profile.skill, game.skill);
  const childPhase = () => state.phase === 'childTurn' || state.phase === 'selected' || state.phase === 'tentative';
  /** @param {PositionBook} b @returns {boolean} the book of the position the game stands at */
  const current = (b) => !disposed && book === b && b.positionId === state.positionId && b.gameId === state.gameId;
  /** @param {number} k @returns {number|null} the child's-view evaluation of the position after k plies, when known */
  const evalAt = (k) => (typeof last.evals[k] === 'number' ? last.evals[k] : null);

  /**
   * The round the top bar shows: the round of the next move while the game runs; once it is over, the last round that was
   * played (the round after it will never be played, and the card says 共 N 回合; CONTRACT-NOTES 138).
   * @returns {number}
   */
  function roundNow() {
    const plies = state.history.length;
    return state.result !== null && plies > 0 ? moveNo(plies - 1) : moveNo(plies);
  }

  /** @returns {StageView} */
  function viewNow() {
    const lastPly = state.history.length > 0 ? state.history[state.history.length - 1] : null;
    const taken = capturedPieces(state);
    const red = state.humanColor === 'red';
    return {
      board: state.board,
      bottom: state.humanColor,
      lastMove: lastPly ? lastPly.move : null,
      lastBy: lastPly ? lastPly.by : null,
      check: state.check ? state.turn : null,
      checkers: state.checkers,
      round: roundNow(),
      trophies: { mine: red ? taken.byRed : taken.byBlack, lost: red ? taken.byBlack : taken.byRed },
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The active-time clock (SPEC 5.8, other duties)
  // ---------------------------------------------------------------------------------------------------------------

  const activeNow = () => game.activeMs + (game.visibleSince !== null ? Math.max(0, now() - game.visibleSince) : 0);

  function closeClock() {
    if (game.visibleSince === null) return;
    game.activeMs += Math.max(0, now() - game.visibleSince);
    game.visibleSince = null;
  }

  /** Runs only while the page is visible and the game is not over. */
  function openClock() {
    if (game.visibleSince !== null || hidden || state.gameId === 0 || state.result !== null) return;
    game.visibleSince = now();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // What the stage is told about the phase, the input and the chips
  // ---------------------------------------------------------------------------------------------------------------

  /** stage.phase, when it would say something new. Before the first game the session's 'over' means "boot": nothing is told. */
  function tellPhase() {
    if (state.gameId === 0) return;
    const p = { phase: state.phase, canUndo: canUndo(state), hintLevel: state.hint.level, canAsk: canAsk(state),
                failed: state.opponentFailed, ply: state.history.length };
    const key = `${state.gameId}|${state.positionId}|${p.phase}|${p.canUndo}|${p.hintLevel}|${p.canAsk}|${p.failed}|${p.ply}`;
    if (key === toldPhase) return;
    toldPhase = key;
    stage.phase(p);
  }

  /** The ✎ input: offered when the coach side can take free text and the setting allows it (CONTRACT-NOTES 83 b). */
  const freeTextOn = () => coach.mode() === 'llm' && coach.capabilities().freeText && settings.freeText !== false;
  /** A question can be put to a thread now. */
  const askable = () => canAsk(state) && (state.phase === 'over' ? over !== null && over.ready : book !== null && current(book) && book.thread !== null);
  /** @param {boolean} enabled */
  const tellInput = (enabled) => stage.input({ visible: freeTextOn(), enabled });

  /** @param {Square} sq @returns {string} the board character of the piece on `sq` in the current position, '' when unknown */
  function labelAt(sq) {
    const pieces = book && book.facts ? book.facts.pieces : [];
    const found = pieces.find((p) => sameSquare(p.piece.at, sq));
    return found ? found.piece.label : '';
  }

  /** @param {AskCode} code @param {string} [label] @returns {ChipSpec} */
  const askChip = (code, label) => ({ id: code, label: label ?? ASK_LABEL[code] ?? '', ask: code });

  /** The `turn` set of 4.25.6; a chip is offered only when its directive has data. @param {PositionBook} b @returns {ChipSpec[]} */
  function turnChips(b) {
    const turn = b.turn;
    if (!turn) return [];
    /** @type {ChipSpec[]} */
    const chips = [];
    if (turn.opp !== null || turn.threats.length > 0) {
      const lastPly = state.history.length > 0 ? state.history[state.history.length - 1] : null;
      const char = lastPly && lastPly.by === 'opponent' ? labelAt(lastPly.move.to) : '';
      chips.push(askChip('intent', char ? STR.intentLabel(char) : undefined));
    }
    const hanging = b.facts ? b.facts.hanging.find((h) => h.piece.color === state.humanColor) : undefined;
    chips.push(askChip('danger', hanging && hanging.piece.label ? STR.dangerLabel(hanging.piece.label) : undefined));
    if (turn.mine && turn.mine.try) chips.push(askChip('last'));
    chips.push(askChip('score'));
    return chips;
  }

  /** The chip set of the moment (4.25.6), before used chips are taken out. @returns {ChipSpec[]} */
  function buildChips() {
    if (state.gameId === 0) return [];
    if (state.phase === 'over') {
      if (!over || !over.ready || !over.packet) return [];
      const packet = over.packet;
      /** @type {ChipSpec[]} */
      const chips = [];
      if (chipCtx.why) chips.push(askChip('why'));
      if (packet.proud) chips.push(askChip('proud'));
      if (packet.takeaway && packet.takeaway.ex && packet.takeaway.ex.better) chips.push(askChip('improve'));
      if (packet.goal) chips.push(askChip('next'));
      return chips;
    }
    const b = book;
    if (!b || !current(b) || state.phase === 'opponentTurn') return [];
    if (state.phase === 'tentative') {
      const tn = b.trial;
      // a trial that could not be assessed (the job failed or timed out) has no answers: its chips would do nothing
      if (tn && tn.failed) return [];
      /** @type {ChipSpec[]} */
      const chips = tn && tn.voiced
        ? [{ id: 'seen', label: STR.chips.seenIt, action: 'retract' }, askChip('show'), { id: 'go', label: STR.chips.goThisWay, action: 'confirm' }]
        : [askChip('good'), askChip('reply'), askChip('better')];
      if (!chipCtx.why) return chips;
      // trial set: good · reply · better · why (the chips under the finger stay where they are when the comment has been
      // said); after an answer: why + the chips not used yet
      return chipCtx.answered ? [askChip('why'), ...chips] : [...chips, askChip('why')];
    }
    /** @type {ChipSpec[]} */
    const chips = [];
    if (b.takeback && canUndo(state)) chips.push({ id: 'takeback', label: STR.chips.takeback, action: 'takeback', primary: true });
    if (state.hint.level === 3 && b.truth && b.turn) chips.push({ id: 'try', label: STR.chips.tryIt, action: 'pouch', primary: true });
    if (chipCtx.why && b.turn) chips.push(askChip('why'));
    return chips.concat(turnChips(b));
  }

  /** The context a chip set belongs to: a used chip is not offered again until it changes. @returns {string} */
  function chipKey() {
    if (state.phase === 'over') return `over:${state.positionId}`;
    if (state.phase === 'tentative') {
      const tn = book ? book.trial : null;
      return `${tn && tn.voiced ? 'held' : 'trial'}:${state.trialId}`;
    }
    if (state.phase === 'opponentTurn') return 'none';
    return `turn:${state.positionId}`;
  }

  function pushChips() {
    const key = chipKey();
    if (key !== chipCtx.key) chipCtx = { key, used: new Set(), why: false, answered: false };
    const list = buildChips().filter((chip) => !chipCtx.used.has(chip.id)).slice(0, MAX_CHIPS);
    shownChips = list;
    stage.chips(list);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Local lines and coach replies
  // ---------------------------------------------------------------------------------------------------------------

  /** @returns {MoveBook} the book local lines are parsed against */
  function parseBook() {
    if (state.phase === 'over' && over && over.moveBook) return over.moveBook;
    if (book && current(book) && book.moveBook) return book.moveBook;
    if (!plain || plain.positionId !== state.positionId) {
      plain = { positionId: state.positionId, book: coach.createMoveBook({ board: state.board, turn: state.turn }) };
    }
    return plain.book;
  }

  /** A director-originated local line (STR). @param {string} text @returns {string} the stage's message id */
  const say = (text) => stage.coachLocal(coach.parse(text, parseBook()));

  /** STR.storageOff, once (SPEC 5.8 notices; a write that first fails after boot is noticed here too). */
  function storageNotice() {
    if (storageTold) return;
    storageTold = true;
    stage.toast(STR.storageOff);
  }

  function saveProfile() {
    if (!store.saveProfile(profile)) storageNotice();
  }

  /**
   * One coach reply (SPEC 5.8 legend, 6.7): a `tasks.run` task on the `coach` channel whose handlers are wired to the
   * stage, each wrapped in the task's gate. `start` calls the thread method with those handlers.
   * @param {Lifetime} lifetime
   * @param {CoachKind} kind
   * @param {(h:Handlers, opts:ReplyOpts) => Reply} start
   * @param {{target?:'bubble'|'card', flags?:ReplyOpts['flags'], onSentence?:() => void,
   *          onEnd?:(r:Extract<ReplyResult, {aborted:false}>) => void}} [extra]
   * @returns {TaskHandle<ReplyResult>}
   */
  function speak(lifetime, kind, start, extra) {
    const id = `coach-${++coachSeq}`;
    const born = session.scope();
    /** The moment this reply belongs to is still on the board (as `run` decides it for a script). */
    const inScope = () => {
      if (disposed) return false;
      const s = session.scope();
      return s.game === born.game && (lifetime === 'game' || (s.position === born.position && (lifetime === 'position' || s.trial === born.trial)));
    };
    return tasks.run({ lifetime, channel: 'coach', timeoutMs: COACH_TIMEOUT_MS }, (c) => {
      let sync = true;
      let started = false;
      let begun = false;
      let ended = false;
      /** @type {string|null} */
      let cue = null;
      // A line that was begun is always ended. A task that is stopped while its moment is still on the board (a newer
      // reply took the coach channel, the task timed out, its thread method threw) gets no handler call, and what
      // follows may show nothing (a silent try, an empty answer): the line is closed here, before the successor starts.
      // A task stopped because the position or the trial changed tells nothing: the stage has closed that moment's lines.
      c.signal.addEventListener('abort', () => {
        if (!begun || ended || c.alive() || !inScope()) return;
        ended = true;
        stage.coachEnd(id, { reason: 'aborted', source: 'none' });
      }, { once: true });
      const begin = () => {
        if (begun) return;
        begun = true;
        stage.coachBegin({ id, kind, cue, target: extra && extra.target ? extra.target : 'bubble' });
      };
      /** @type {Handlers} */
      const handlers = {
        onStart: c.gate((/** @type {{cue:string|null}} */ s) => {
          started = true;
          cue = s.cue;
          if (cue !== null || !sync) begin();
        }),
        onSegment: c.gate((/** @type {import('../coach/types.js').Segment} */ seg) => {
          begin();
          stage.coachSegment(id, seg);
        }),
        onSentence: c.gate(() => {
          if (extra && extra.onSentence) extra.onSentence();
        }),
        onReset: c.gate(() => {
          if (begun) stage.coachReset(id);
        }),
        onTool: c.gate((/** @type {{phase:'start'|'end', notation?:string, link?:MoveLink}} */ t) => {
          begin();
          stage.coachTool(id, t);
        }),
        onEnd: c.gate((/** @type {ReplyResult} */ r) => {
          if (ended || r.aborted) return;
          ended = true;
          if (begun) stage.coachEnd(id, { reason: r.cut ? 'cut' : 'done', source: r.source });
          if (extra && extra.onEnd) extra.onEnd(r);
          ensureSurvey();                                  // a tool round may have taken the worker from the survey
        }),
      };
      const reply = start(handlers, { signal: c.signal, flags: extra ? extra.flags : undefined });
      sync = false;
      if (started && !begun && !ended) begin();            // the answer is on its way: the bubble shows the dots
      return reply.done.then((r) => {
        // An aborted reply gets no handler call: the message is closed from here, unless the task itself was stopped
        // (the stage has then heard what replaced it).
        if (r.aborted && begun && !ended && c.alive()) {
          ended = true;
          stage.coachEnd(id, { reason: 'aborted', source: 'none' });
        }
        if (r.aborted) ensureSurvey();                     // its tool job, if it had one, went with it
        return r;
      });
    });
  }

  /** `taught` receives the leading effect and flaw of every event that got a spoken reply (4.16). @param {(string|undefined)[]} codes */
  function noteTaught(codes) {
    const list = /** @type {string[]} */ (codes.filter((code) => typeof code === 'string' && code !== ''));
    if (list.length > 0) game.memory.noteTaught(list);
  }

  /**
   * 司马懿 reacts (4.22): always three arguments; one line per rival move at most.
   * @param {Parameters<typeof rivalReact>[0]} ev @param {number} rivalMoveNo
   * @param {boolean|'calm'} [moodOnly] true: his mood without a line; 'calm': no line and a calm face, whatever the mood would be
   */
  function rivalSay(ev, rivalMoveNo, moodOnly) {
    const r = rivalReact(ev, { rivalMoveNo, lineAt: game.budgets.rivalLineAt }, rng);
    if (moodOnly) {
      stage.rival({ mood: moodOnly === 'calm' ? 'calm' : r.mood });
      return;
    }
    if (r.line !== undefined && ev.kind !== 'start' && ev.kind !== 'over') game.budgets.rivalLineAt = rivalMoveNo;
    stage.rival(r);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Idle timers (SPEC 5.8 E-turn)
  // ---------------------------------------------------------------------------------------------------------------

  function clearIdle() {
    for (const timer of idleTimers) clearTimer(timer);
    idleTimers = [];
  }

  /** Cleared by any activity, by leaving the position and while the page is hidden; armed again when the child idles. */
  function armIdle() {
    clearIdle();
    const b = book;
    if (!b || !current(b) || hidden || !b.turn || !childPhase()) return;
    idleTimers = [setTimer(() => nudge(b), NUDGE_MS), setTimer(() => offerPouch(b), IDLE_MS)];
  }

  /** The chance lands on the child's own palace or back two rows: "己方九宫好像有破绽" would point at the wrong side. @param {Square} to */
  function ownGround(to) {
    const red = state.humanColor === 'red';
    const depth = red ? 9 - to.row : to.row;               // 0 = the child's back rank
    return depth <= 1 || (depth <= 2 && to.col >= 3 && to.col <= 5);
  }

  /** @param {PositionBook} b */
  function nudge(b) {
    if (!current(b) || hidden || b.nudged || !b.report || b.report.announceChance) return;
    if (state.phase !== 'childTurn' && state.phase !== 'selected') return;
    const chance = last.opp && last.opp.choice ? last.opp.choice.chance : null;
    if (!chance) return;
    b.nudged = true;                                       // once
    const first = chance.line && Array.isArray(chance.line.moves) ? chance.line.moves[0] : undefined;
    if (first && ownGround(first.to)) return;              // CONTRACT-NOTES 110 c
    const word = coach.brief.chanceAreaWord(b.report);
    if (word) say(STR.chanceNudge(word));
  }

  /** @param {PositionBook} b */
  function offerPouch(b) {
    if (!current(b) || hidden) return;
    // no pouch is left, or none can be given for this position (its survey failed before any table came): nothing to
    // offer, and the offer is not spent
    if (state.hint.level >= 3 || !b.facts || (b.survey.failed && !b.truth)) return;
    if (!idleOffer({ phase: state.phase, offeredHere: b.idleOffered }, game.budgets)) return;
    b.idleOffered = true;
    game.budgets.idleOffers += 1;
    say(STR.idleOffer);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The position book, the survey and the pinned truth (SPEC 4.25.1, 4.25.3)
  // ---------------------------------------------------------------------------------------------------------------

  /** @param {boolean} withFacts position facts are computed for the child's positions (and the final one) @returns {PositionBook} */
  function newBook(withFacts) {
    clearIdle();
    const fen = fenOf(state);
    const ply = state.history.length;
    /** @type {PositionFacts|null} */
    let facts = null;
    if (withFacts) {
      try {
        facts = brain.positionFacts(fen, { ply });
      } catch (error) {
        reportError(error);                                // the brief then says known.threats = false
      }
    }
    /** @type {PositionBook} */
    const b = {
      gameId: state.gameId, positionId: state.positionId, fen, ply, facts,
      survey: { handle: null, table: null, threat: undefined, final: null, failed: false },
      truth: null, trials: new Map(), report: null, turn: null, moveBook: null, thread: null,
      trial: null, lastPacket: null, tableWaiters: [], threatWaiters: [], briefWaiters: [],
      activeAtStart: activeNow(), nudged: false, idleOffered: false, takeback: false,
    };
    book = b;
    question = null;
    return b;
  }

  /** @param {(() => void)[]} waiters */
  function wake(waiters) {
    for (const waiter of waiters.splice(0)) waiter();
  }

  /** Resolves at the next table (or at once when a truth is pinned, or the survey has failed). @param {PositionBook} b @returns {Promise<void>} */
  const tableKnown = (b) => (b.truth || b.survey.failed ? Promise.resolve() : new Promise((resolve) => { b.tableWaiters.push(() => resolve(undefined)); }));
  /** @param {PositionBook} b @returns {Promise<void>} */
  const threatKnown = (b) => (b.survey.threat !== undefined || b.survey.failed ? Promise.resolve() : new Promise((resolve) => { b.threatWaiters.push(() => resolve(undefined)); }));
  /** @param {PositionBook} b @returns {Promise<void>} */
  const briefed = (b) => (b.thread ? Promise.resolve() : new Promise((resolve) => { b.briefWaiters.push(() => resolve(undefined)); }));

  /** 4.25.3. @param {PositionBook} b @param {Analysis} table */
  function updateTruth(b, table) {
    const best = table.lines[0];
    if (!b.truth) {
      b.truth = { bestMove: refOf(best.move), bestCp: scoreToCp(best.score), depth: table.depth, shown: false };
      return;
    }
    const truth = b.truth;
    const pinned = table.lines.find((line) => sameMove(line.move, truth.bestMove));
    if (sameMove(best.move, truth.bestMove)) {             // confirmed at this depth
      truth.bestCp = scoreToCp(best.score);
      truth.depth = Math.max(truth.depth, table.depth);
      return;
    }
    // "beats the pinned move by 60 cp" is measured on the search scores: where both read -1900 (or +1900) a pin that the
    // deeper table refutes would otherwise stay, and every trial would be measured against it (CONTRACT-NOTES 147)
    const gain = pinned ? scoreGap(best.score, lineScore(pinned)) : Infinity;
    if (!truth.shown && table.depth >= truth.depth + TRUTH_DEPTH_STEP && gain >= TRUTH_GAIN_CP) {
      b.truth = { bestMove: refOf(best.move), bestCp: scoreToCp(best.score), depth: table.depth, shown: false };
      reassess(b);                                         // a trial that stands on the board was measured against the old pin
    } else if (pinned) {
      truth.bestCp = lineCp(pinned);                       // the pin stays; its value follows the deeper table
    }
  }

  /** A `table` progress or the table of the survey's result. @param {PositionBook} b @param {Analysis|null|undefined} table */
  function onTable(b, table) {
    if (!table || !Array.isArray(table.lines) || table.lines.length === 0 || !(table.depth >= 2)) return;
    if (b.survey.table && table.depth < b.survey.table.depth) return;      // a restarted survey reports its shallow iterations again
    b.survey.table = table;
    updateTruth(b, table);
    wake(b.tableWaiters);
  }

  /** @param {PositionBook} b */
  function startSurvey(b) {
    /** @type {TaskHandle<Survey>} */
    const handle = tasks.job({
      ...brain.surveyJob({ fen: b.fen, history: historyFens(state), ply: b.ply, level: levelNow(), tensionPrev: last.tension,
                           evalTwoPliesAgo: evalAt(b.ply - 2) }),
      lifetime: 'position',
      onProgress: (step, data) => {
        if (!current(b) || b.survey.handle !== handle) return;
        if (step === 'table') {
          onTable(b, data);
        } else if (step === 'threat') {
          b.survey.threat = data ?? null;
          wake(b.threatWaiters);
        }
      },
    });
    b.survey.handle = handle;
    handle.done.then((out) => {
      if (b.survey.handle === handle) b.survey.handle = null;
      if (!current(b)) return;
      if (out.ok) {
        const survey = out.value;
        b.survey.final = survey;
        onTable(b, survey.table);
        if (b.survey.threat === undefined) b.survey.threat = survey.threat ?? null;
        wake(b.threatWaiters);
        if (typeof survey.tension === 'number' && Number.isFinite(survey.tension)) {
          last.tension = survey.tension;
          stage.tension(survey.tension);
        }
        if (b.survey.table) last.evals[b.ply] = scoreToCp(b.survey.table.lines[0].score);
      } else if (out.reason === 'error' || out.reason === 'timeout') {
        b.survey.failed = true;                            // never restarted for this position: the pouches say so instead
        wake(b.tableWaiters);
        wake(b.threatWaiters);
      }
    }).catch(reportError);
  }

  /** Whenever the worker is idle during the child's turn and the survey had not finished, it is started again (5.8). */
  function ensureSurvey() {
    const b = book;
    if (!b || !current(b) || !childPhase() || b.survey.final !== null || b.survey.failed) return;
    if (b.survey.handle && b.survey.handle.alive()) return;
    if (tasks.liveJob() !== null) return;
    startSurvey(b);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The turn report (SPEC 5.8 makeReport)
  // ---------------------------------------------------------------------------------------------------------------

  /** After an undo or a restore: the rival's last move, rebuilt from the last ply (CONTRACT-NOTES 28 / 84). @returns {OpponentTurn|null} */
  function rebuiltOpp() {
    const index = state.history.length - 1;
    const ply = index >= 0 ? state.history[index] : null;
    if (!ply || ply.by !== 'opponent') return null;
    try {
      const move = infoOf(ply.move, ply.notation);
      const facts = brain.moveFacts(brain.boardToFen(ply.before, ply.color), refOf(ply.move), { ply: index });
      return /** @type {OpponentTurn} */ (/** @type {unknown} */ ({ move, facts, choice: null }));
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  /** After an undo or a restore: the child's previous move, from the history and its sample. @returns {TurnReport['prev']} */
  function rebuiltPrev() {
    const end = state.history.length - 1;
    const index = end >= 0 && state.history[end].by === 'child' ? end : end - 1;      // a finished game can end on the child's move
    const ply = index >= 0 ? state.history[index] : null;
    if (!ply || ply.by !== 'child') return null;
    const sample = game.skill.samples.find((s) => s.ply === index);
    if (!sample) return null;
    const mine = game.memory.snapshot().mine;
    const waited = mine && mine.move === ply.notation ? mine.waited : true;
    return { move: infoOf(ply.move, ply.notation), cat: sample.final.cat, waited, self: sample.self, packet: null, more: null, assessed: null };
  }

  /** @param {PositionBook} b @param {'new'|'restore'|'opponent-move'|'undo'|'over'} cause @returns {TurnReport} */
  function makeReport(b, cause) {
    const table = b.survey.table;
    const best = table ? table.lines[0] : null;
    // The rival's move is "his last move" only while nothing was played after it: a game can end on the child's move (a mate,
    // a draw, a resignation while he thinks), and the brief of that final position must not present his earlier move as the
    // answer to the child's last one.
    const lastPly = state.history.length > 0 ? state.history[state.history.length - 1] : null;
    const lastOpp = lastPly && lastPly.by === 'opponent' ? last.opp ?? rebuiltOpp() : null;
    const chance = lastOpp && lastOpp.choice ? lastOpp.choice.chance : null;
    const mate = best && typeof best.mate === 'number' && Math.abs(best.mate) <= 9 ? best.mate : null;      // CONTRACT-NOTES 88
    return {
      ply: b.ply,
      me: state.humanColor,
      board: state.board,
      facts: /** @type {PositionFacts} */ (b.facts),       // null only when positionFacts threw: a degraded report
      legalCount: table ? table.lines.length : 0,          // 0 = not known yet (CONTRACT-NOTES 69 d)
      threat: b.survey.threat,
      evalCp: best ? scoreToCp(best.score) : last.opp && typeof last.opp.evalAfter === 'number' ? last.opp.evalAfter : null,
      mate,
      lastOpp,
      prev: last.prev ?? rebuiltPrev(),
      level: levelNow(),
      announceChance: chance ? announceChance(chance, brain.findRate(profile.skill, chance.tier)) : false,
      back: cause === 'undo' ? 'undo' : cause === 'restore' ? 'reload' : null,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-start (game:start)
  // ---------------------------------------------------------------------------------------------------------------

  /** @param {Extract<SessionEvent, {type:'game:start'}>} event */
  function onGameStart(event) {
    if (event.reason === 'restore' && event.truncatedAt !== null) store.quarantine('game', 'truncated');      // before the batch's `change` rewrites it
    stage.settle();
    coach.reset();
    clearIdle();
    book = null;
    over = null;
    question = null;
    plain = null;
    refusals = 0;
    tapOverTold = false;
    lastAskAt = -Infinity;
    toldPhase = '';
    chipCtx = { key: '', used: new Set(), why: false, answered: false };
    hidden = deps.isHidden ? deps.isHidden() === true : hidden;
    if (event.reason === 'new') {
      const seed = drawSeed();
      game = gameOf(seed, brain.createGameSkill(seed), coach.createGameMemory(null), 0);
    } else {
      const plies = state.history.length;
      const seed = loaded ? loaded.seed : drawSeed();
      const memory = loaded ? loaded.memory : coach.createGameMemory(null);
      memory.rewind(plies);                                // a truncated restore stands before the plies the save still knew
      game = gameOf(seed, brain.rewindGameSkill(loaded ? loaded.skill : brain.createGameSkill(seed), plies), memory, loaded ? loaded.activeMs : 0);
    }
    loaded = null;
    // A game that was counted already has replaced the goal it was played under: `kept` is then not reported.
    game.goalPrev = !state.counted && profile.goal ? profile.goal.code : null;
    last = { opp: null, prev: null, tension: 0.1, evals: [] };
    openClock();
    lastAnim = stage.reset(viewNow(), { deal: event.reason === 'new' });
    if (event.reason === 'new') {
      rivalSay({ kind: 'start' }, 0);
      stage.notation(notationRows(state.history), state.history.length);
      return;
    }
    stage.notation(notationRows(state.history), state.history.length);
    if (state.result) onGameOver(true);
    else if (state.phase === 'opponentTurn') say(STR.welcomeBackRival);      // E-rival follows in the same batch
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-turn (child:turn)
  // ---------------------------------------------------------------------------------------------------------------

  /** cp the child lost by the previous move, as far as it is known. @returns {number} */
  function prevLoss() {
    const prev = last.prev;
    if (prev && prev.assessed) return prev.assessed.assessment.loss;
    const index = state.history.length - 2;
    const sample = game.skill.samples.find((s) => s.ply === index);
    return sample ? sample.final.loss : 0;
  }

  /** @param {'new'|'restore'|'opponent-move'|'undo'} cause */
  function onChildTurn(cause) {
    const b = newBook(true);
    tellPhase();
    pushChips();
    tellInput(false);
    startSurvey(b);
    if (game.pendingSelect) {                              // a tap on an own piece during the rival's turn (D-43)
      const sq = game.pendingSelect;
      game.pendingSelect = null;
      session.select(sq.row, sq.col);                      // queued behind this batch
    }
    run('position', async (ctx) => {
      if (cause === 'opponent-move') await ctx.wait(Promise.race([threatKnown(b), sleepRaw(THREAT_WAIT_MS)]));      // hidden behind the rival's move animation
      const report = makeReport(b, cause);
      const moveBook = coach.createMoveBook({ board: state.board, turn: state.turn });
      const turn = coach.brief.buildTurnBrief(report, game.memory, moveBook);
      const thread = coach.beginTurn(turn, moveBook);
      b.report = report;
      b.turn = turn;
      b.moveBook = moveBook;
      b.thread = thread;
      if (last.opp && turn.opp) game.memory.noteOpp(b.ply - 1, turn.opp);

      /** @type {TaskHandle<ReplyResult>|null} */
      let greeting = null;
      /** @param {StartEvent|OppEvent} ev @param {SayMode} mode @param {CoachKind} kind */
      const open = (ev, mode, kind) => speak('position', kind, (h, opts) => thread.open(ev, mode, h, opts), {
        onEnd: (r) => {
          if (r.text !== '' && turn.opp) noteTaught([turn.opp.does[0] ? turn.opp.does[0].k : undefined]);
        },
      });
      if (cause === 'opponent-move') {
        const caption = coach.brief.oppCaption(turn);
        if (caption) stage.caption(coach.parse(caption, moveBook));
        // A trial that is already on the board (a piece picked up during his turn, its target tapped before this brief
        // existed) gets the next word: the comment on it takes the coach channel within the assess time, so the read of
        // his move is not requested at all. The caption has said what he did.
        greeting = open({ kind: 'opp' }, shouldSpeakOpp(turn, settings.talk) && !b.trial ? 'auto' : 'silent', 'opp');
        const choice = last.opp ? last.opp.choice : null;
        if (choice && choice.overlooked && choice.overlooked.mate) {
          say(STR.sparedMate);
          b.takeback = true;
        } else if (offerTakeback({ punishes: !!(turn.opp && turn.opp.punishes), loss: prevLoss(),
                                   waited: turn.mine ? turn.mine.waited : last.prev ? last.prev.waited : true }, game.budgets)) {
          say(STR.takebackOffer);
          b.takeback = true;
          game.budgets.takebacks += 1;
        }
      } else if (cause === 'new') {
        const first = !profile.introSeen;
        greeting = open({ kind: 'start', first }, 'auto', 'start');
        if (first) {
          profile = { ...profile, introSeen: true };
          saveProfile();
        }
      } else {
        if (cause === 'restore') say(STR.welcomeBack);
        open({ kind: turn.opp ? 'opp' : 'start' }, 'silent', turn.opp ? 'opp' : 'start');      // turn.back is set; no request leaves
      }
      pushChips();
      tellInput(askable());
      armIdle();
      wake(b.briefWaiters);                                // the thread is open: a trial, a pouch or a question that waited for it goes on

      // The small goal agreed at the end of the last game is recalled when this game's first line has ended.
      if (greeting && profile.goal && b.ply <= 1) {
        const code = profile.goal.code;
        await ctx.wait(greeting.done);
        say(STR.goalRecall(HABIT_FIX[code]));
      }
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-trial (trial:start) and E-retract (trial:end)
  // ---------------------------------------------------------------------------------------------------------------

  /** @param {TrialNow} tn @param {boolean} ok the try event is in the thread */
  function settleTried(tn, ok) {
    for (const waiter of tn.waiters.splice(0)) waiter(ok);
  }

  /** @param {TrialEntry} entry @returns {Cat|null} */
  const catOf = (entry) => (entry.assessed ? entry.assessed.assessment.cat : entry.quick ? entry.quick.cat : null);

  /** The habit a slip stands for (4.25.5). @param {Assessed|null} assessed @param {MoveInfo} move @param {Cat|null} cat @returns {HabitCode|null} */
  function habitOf(assessed, move, cat) {
    const danger = assessed && assessed.assessment.refutation ? assessed.assessment.refutation.danger : null;
    if (!isSlip(cat) || !danger) return null;
    return danger === 'hangs_moved_piece' && move.captured !== null ? 'greedy' : HABIT_OF_DANGER[danger];
  }

  /** @param {HabitCode|null} code @returns {boolean} a habit the profile knows (4.25.5: count of one or more) */
  const knownHabit = (code) => code !== null && ((profile.skill.habits ?? {})[code] ?? 0) >= 1;

  /**
   * An assessment is valid for the pin it was measured against (4.25.3): `entry.assessed` was compared with another
   * move than the truth of now, or with none while one is pinned now.
   * @param {PositionBook} b @param {TrialEntry} entry @returns {boolean}
   */
  const outdated = (b, entry) => entry.assessed !== null && b.truth !== null && !(entry.pin !== null && sameMove(entry.pin, b.truth.bestMove));
  /** ... and more than that: the truth has replaced the very move it was compared with. @param {PositionBook} b @param {TrialEntry} entry @returns {boolean} */
  const overtaken = (b, entry) => entry.pin !== null && outdated(b, entry);

  /** The assess job of the trial on the board; `tn.pin` keeps what it is compared with until its result is stored. */
  /** @param {PositionBook} b @param {TrialNow} tn @param {Trial} trial @returns {TaskHandle<Assessed>} */
  function startAssess(b, tn, trial) {
    tn.pin = b.truth ? refOf(b.truth.bestMove) : null;
    return tasks.job({
      ...brain.assessJob({ fen: b.fen, history: historyFens(state), ply: b.ply, move: refOf(trial.move), table: b.survey.table,
                           level: levelNow(), compare: b.truth ? refOf(b.truth.bestMove) : null }),
      lifetime: 'trial',
    });
  }

  /**
   * The survey has replaced the pin. A trial that stands on the board with its verdict told was measured against the old
   * pin: it is assessed again, as after an engine restart, and trialScript tells the new verdict only when it differs.
   * Until the result is in the trial counts as not tried, so a question about it waits for the try event that is right.
   * @param {PositionBook} b
   */
  function reassess(b) {
    const tn = b.trial;
    const trial = state.trial;
    if (!current(b) || state.phase !== 'tentative' || !tn || !trial || tn.id !== trial.id) return;
    if (!tn.commented || !tn.tried || tn.failed || !overtaken(b, tn.entry)) return;
    tn.tried = false;
    const job = startAssess(b, tn, trial);
    run('trial', (ctx) => trialScript(ctx, b, tn, trial, job));
  }

  /** @param {Extract<SessionEvent, {type:'trial:start'}>} event */
  function onTrialStart(event) {
    const trial = event.trial;
    const b = book;
    if (!b || !current(b)) return;
    if (b.trial) settleTried(b.trial, false);
    if (event.replaced) b.thread?.retract();
    else b.thread?.interrupt();
    question = null;
    const landed = stage.tentative(trial.move, { notation: trial.notation, aim: !!trial.move.captured });
    lastAnim = landed;
    const code = codeOf(trial.move);
    let entry = b.trials.get(code);
    // A kept assessment is served again only under the pin it was measured against: when the survey has replaced the pin
    // since (or has pinned one where there was none), the move gets a fresh entry and a fresh assess job.
    if (entry && outdated(b, entry)) entry = undefined;
    if (!entry) {
      entry = { info: infoOf(trial.move, trial.notation), quick: null, assessed: null, pin: null, built: null, earned: false, voiced: false,
                held: false, found: false };
      b.trials.set(code, entry);
    }
    entry.quick = brain.quickVerdict(b.survey.table, refOf(trial.move), levelNow());
    /** @type {TrialNow} */
    const tn = { id: trial.id, entry, attempt: { ...state.attempt }, hintLevel: state.hint.level, landed, prev: b.lastPacket, pin: null,
                 commented: false, cat: null, resync: false, tried: false, failed: false, voiced: false, spoke: false, waiters: [] };
    b.trial = tn;
    // the face reacts within one frame, from local data only
    stage.verdict({ cat: entry.assessed ? entry.assessed.assessment.cat : entry.quick ? entry.quick.cat : 'pending',
                    final: false, held: false, voiced: false, earned: false, focus: [] });
    const job = entry.assessed ? null : startAssess(b, tn, trial);
    pushChips();
    stage.announce(STR.announce.trial(trial.notation));
    run('trial', (ctx) => trialScript(ctx, b, tn, trial, job));
  }

  /**
   * The [A] part of E-trial.
   * @param {ScriptContext} ctx @param {PositionBook} b @param {TrialNow} tn @param {Trial} trial @param {TaskHandle<Assessed>|null} job
   */
  async function trialScript(ctx, b, tn, trial, job) {
    const entry = tn.entry;
    // A second run, for a trial whose verdict has been told already: the pin was replaced under it (see reassess).
    const told = tn.commented ? { cat: tn.cat, held: entry.held } : null;
    if (job) {
      const out = await ctx.wait(job.done);
      if (!out.ok) {
        if (told) {                                        // the verdict that was told stands; its try event is still in the thread
          tn.tried = true;
          settleTried(tn, true);
          ensureSurvey();
          return;
        }
        tn.failed = true;                                  // the provisional face stays; nothing is said
        settleTried(tn, false);
        pushChips();                                       // the trial chips are withdrawn: no answer will come for them
        ensureSurvey();
        return;
      }
      entry.assessed = out.value;
      entry.pin = tn.pin;
      ensureSurvey();
    }
    if (!b.thread) await ctx.wait(briefed(b));
    if (!told && overtaken(b, entry)) {                    // the survey replaced the pin while the brief was awaited: once more
      const again = await ctx.wait(startAssess(b, tn, trial).done);
      if (again.ok) {
        entry.assessed = again.value;
        entry.pin = tn.pin;
      }
      ensureSurvey();
    }
    const assessed = entry.assessed;
    const thread = b.thread;
    if (!assessed || !thread || !b.turn || !b.report || !b.moveBook) return;
    const a = assessed.assessment;

    // found / avoided / habit as in 4.25.5, for this trial
    const first = tn.attempt.first;
    const isFirst = first !== null && sameMove(first, trial.move);
    const firstEntry = first ? b.trials.get(codeOf(first)) ?? entry : entry;
    const firstCat = catOf(firstEntry);
    const test = b.survey.final ? b.survey.final.test : null;
    const found = isFirst && test !== null && test.group.some((m) => sameMove(m, trial.move));
    const trap = (b.survey.final ? b.survey.final.traps : []).find((t) => knownHabit(t)) ?? null;
    const avoided = trap !== null && !isSlip(a.cat) && firstCat !== null && !isSlip(firstCat) ? trap : null;
    const slip = habitOf(assessed, a.move, a.cat);
    const habit = knownHabit(slip) && slip !== null && !game.memory.habitMentioned(slip) ? slip : null;      // mentioned at most once per game (D-41)

    const built = coach.brief.buildTryPacket(assessed, { turn: b.turn, report: b.report, prev: tn.prev, self: tn.hintLevel <= 1, habit,
                                                         avoided, repeat: trial.repeat === 'repeat' }, b.moveBook);
    const earned = coach.brief.isEarned(assessed, { found, avoided });
    const held = built.packet.held;                        // from the assess result: the authority, also for a mate the table scores as a repetition
    const n = moveNo(b.ply);
    entry.built = built;
    entry.earned = earned;
    entry.held = held;
    entry.found = found;
    if (told && told.cat === a.cat && told.held === held) {
      // The pin moved, the verdict did not: the face and the comment stay as they are. What the thread holds of this try
      // is brought up to date with the next question (askTurn), so that a comment that is still coming in is not cut off.
      tn.resync = true;
      tn.tried = true;
      b.lastPacket = built.packet;
      settleTried(tn, true);
      return;
    }
    if (told) thread.retract();                            // the try event of the older verdict is withdrawn; the new one follows
    const voiced = held && (tn.voiced || voiceHeld(built.packet, game.budgets, n));      // a question that is showing stays inside its budget
    entry.voiced = voiced;
    const rival = state.humanColor === 'red' ? 'black' : 'red';
    const focus = voiced && a.refutation
      ? a.refutation.focus.filter((sq) => { const piece = trial.board[sq.row] ? trial.board[sq.row][sq.col] : null; return !!piece && piece.color === rival; })
      : [];
    stage.verdict({ cat: a.cat, final: true, held, voiced, earned, focus });
    tn.commented = true;
    tn.cat = a.cat;
    if (!told && trial.repeat === 'repeat') say(STR.repeatWarn);
    if (profile.skill.games === 0 && !game.budgets.firstTrialTold) {
      say(STR.firstTrial);
      game.budgets.firstTrialTold = true;
    }

    /** @type {SayMode} */
    const mode = held ? (voiced ? 'local' : 'silent') : settings.talk === 'more' || coach.brief.worthSpeaking(built.packet, earned) ? 'auto' : 'silent';
    let beaconed = held || told !== null;                  // never on a held trial, and once per trial
    const beacon = () => {
      if (beaconed || !ctx.alive()) return;
      beaconed = true;
      stage.beacon();
    };
    speak('trial', 'try', (h, opts) => thread.tryMove(built.packet, built.more, mode, h, opts), {
      flags: { earned, voiced, lord: earned && found && tn.hintLevel === 0 },      // the interjection (8.7) reaches the bubble through coachBegin
      onSentence: () => {
        tn.spoke = true;
        beacon();
      },
      onEnd: (r) => {
        if (r.text === '') return;
        tn.spoke = true;
        noteTaught([built.packet.does[0] ? built.packet.does[0].k : undefined, built.packet.flaws[0] ? built.packet.flaws[0].k : undefined]);
        if (habit) game.memory.noteHabit(habit);
        chipCtx.why = true;
        if (!voiced) pushChips();                          // trial set + why
      },
    });
    tn.tried = true;
    tn.resync = false;
    b.lastPacket = built.packet;
    settleTried(tn, true);
    if (voiced) {
      if (!tn.voiced) {
        game.budgets.questions += 1;
        game.budgets.lastQuestionAt = n;
      }
      tn.voiced = true;
      question = { trialId: tn.id, focus };
      pushChips();                                         // held set
    } else if (tn.voiced) {                                // the new verdict asks no question: the held chips give way to the trial set
      tn.voiced = false;
      question = null;
      pushChips();
    }
    if (!held && !told) {
      await ctx.wait(tn.landed);
      await ctx.sleep(mode === 'silent' ? BEACON_SILENT_MS : BEACON_SPOKEN_MS);
      beacon();
    }
  }

  /** @param {Extract<SessionEvent, {type:'trial:end'}>} event */
  function onTrialEnd(event) {
    const b = book;
    const tn = b && b.trial && b.trial.id === event.trial.id ? b.trial : null;
    if (tn) settleTried(tn, false);
    if (event.reason === 'replaced') return;               // E-trial of the new trial follows in the same batch
    question = null;
    if (event.reason === 'retract') {
      if (b) b.thread?.retract();
      skipSelection = true;
      lastAnim = stage.retracted({ reselect: state.phase === 'selected', targets: state.targets, forbidden: state.forbidden });
      // only a held trial ends a run of ignored questions (CONTRACT-NOTES 110 a)
      if (b && tn && tn.commented && tn.entry.held) afterHeld(game.budgets, 'retracted', tn.entry.voiced, moveNo(b.ply));
      if (b) b.trial = null;
      pushChips();
      stage.announce(STR.announce.retract);
      ensureSurvey();
      armIdle();
      return;
    }
    if (b) {                                               // 'newgame' | 'resign'
      b.thread?.end();
      b.trial = null;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-commit (move:committed)
  // ---------------------------------------------------------------------------------------------------------------

  /** The child's opening name, when this move changed it (while ply <= 8). @param {number} index @param {Ply} ply @returns {PatternCode|null} */
  function openingChange(index, ply) {
    if (index > OPENING_PLIES || state.history.length <= index) return null;
    try {
      const firstPly = state.history[0];
      const startFen = brain.boardToFen(firstPly.before, firstPly.color);
      const refs = state.history.slice(0, index + 1).map((p) => refOf(p.move));
      const after = brain.openingName(startFen, refs)[ply.color];
      if (!after) return null;
      const before = index > 0 ? brain.openingName(startFen, refs.slice(0, index))[ply.color] : null;
      return after !== before ? after : null;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  /** {loss, cat} of a tried move: the assess result if it arrived, else the quick verdict at the moment of the try. @param {TrialEntry} entry */
  function partOf(entry) {
    if (entry.assessed) return { loss: Math.min(LOSS_CAP, Math.max(0, entry.assessed.assessment.loss)), cat: entry.assessed.assessment.cat };
    if (entry.quick) return { loss: Math.min(LOSS_CAP, Math.max(0, entry.quick.loss)), cat: entry.quick.cat };
    return null;
  }

  /**
   * 4.25.5. `pending` is set when the confirmed move has neither an assessment nor a quick verdict.
   * @param {PositionBook|null} b @param {Ply} ply @param {number} index @param {TrialEntry} entry
   * @param {{tries:number, first:MoveRef|null, hintAtFirst:0|1|2|3}} attempt @param {0|1|2|3} hintMax
   * @returns {{sample:MoveSample, pending:PendingSample|null}}
   */
  function buildSample(b, ply, index, entry, attempt, hintMax) {
    const table = b ? b.survey.table : null;
    const level = levelNow();
    const sameFirst = attempt.first === null || sameMove(attempt.first, ply.move);
    const firstEntry = !sameFirst && b && attempt.first ? b.trials.get(codeOf(attempt.first)) ?? entry : entry;
    // A move that mates needs no search to be judged: it is the best move, also when it was confirmed before any verdict.
    const finalPart = partOf(entry) ?? (ply.flags.mate ? { loss: 0, cat: /** @type {Cat} */ ('best') } : null);
    let firstPart = firstEntry === entry ? finalPart : partOf(firstEntry);
    if (!firstPart && firstEntry !== entry) {              // a first try that was taken back at once: the table as it stands now
      const late = brain.quickVerdict(table, refOf(firstEntry.info), level);
      firstPart = late ? { loss: Math.min(LOSS_CAP, Math.max(0, late.loss)), cat: late.cat } : { loss: 0, cat: 'good' };
    }
    /** @type {PendingSample|null} */
    let pending = null;
    /** @type {Cat|null} */
    let lateCat = null;
    if (!finalPart) {
      const late = brain.quickVerdict(table, refOf(ply.move), level);
      lateCat = late ? late.cat : null;
    }
    const firstCat = firstPart ? firstPart.cat : null;
    const danger = firstEntry.assessed && firstEntry.assessed.assessment.refutation ? firstEntry.assessed.assessment.refutation.danger : null;
    const survey = b ? b.survey.final : null;
    const trap = (survey ? survey.traps : []).find((t) => knownHabit(t)) ?? null;
    /** @type {MoveSample['patterns']} */
    let patterns = [];
    try {
      const played = entry.assessed ? entry.assessed.assessment.patterns : b ? brain.moveFacts(b.fen, refOf(ply.move), { ply: index }).patterns : [];
      patterns = played.filter((p) => p.stage === 'played').map((p) => p.id);
    } catch (error) {
      reportError(error);
    }
    const placeholder = { loss: 0, cat: /** @type {Cat} */ ('good') };
    /** @type {MoveSample} */
    const sample = {
      ply: index,
      first: { move: firstEntry.info, ...(firstPart ?? placeholder) },
      final: { move: entry.info, ...(finalPart ?? placeholder) },
      tries: Math.max(1, attempt.tries),
      hint: attempt.hintAtFirst,
      hintMax,
      self: hintMax <= 1,
      bestCp: b && b.truth ? b.truth.bestCp : 0,
      legalCount: table ? table.lines.length : 0,          // 0 = no table: the sample then has weight 0 (CONTRACT-NOTES 69 d)
      test: survey && survey.test ? { tier: survey.test.tier, kind: survey.test.kind, found: survey.test.group.some((m) => sameMove(m, firstEntry.info)) } : null,
      danger,
      habit: habitOf(firstEntry.assessed, firstEntry.info, firstCat),
      avoided: trap !== null && firstCat !== null && !isSlip(firstCat) ? trap : null,
      patterns,
      captured: ply.move.captured ? ply.move.captured.type : null,
      thinkMs: Math.max(0, Math.round(activeNow() - (b ? b.activeAtStart : activeNow()))),
    };
    if (!finalPart) pending = { sample, cat: lateCat };
    return { sample, pending };
  }

  /**
   * The verdict of a pending sample has arrived (or never will): it is completed and recorded, exactly once.
   * @param {PendingSample} pending @param {number|null} childMoveCp OpponentTurn.childMoveCp; null = the move ended the game (loss 0)
   */
  function completeSample(pending, childMoveCp) {
    const sample = pending.sample;
    const cat = pending.cat ?? 'good';                     // no table at all: loss 0, 'good', weight 0
    const loss = pending.cat === null || childMoveCp === null ? 0 : Math.min(LOSS_CAP, Math.max(0, sample.bestCp - childMoveCp));
    const same = sameMove(sample.first.move, sample.final.move);
    sample.final = { move: sample.final.move, loss, cat };
    if (same) sample.first = { move: sample.first.move, loss, cat };
    game.skill = brain.recordChildMove(profile.skill, game.skill, sample);
    // the memory hears of the move again, now with its verdict (CONTRACT-NOTES 110 d)
    game.memory.noteMine(sample.ply, { move: sample.final.move.notation, cat, waited: false, self: sample.self, packet: null, more: null });
    if (last.prev && sameMove(last.prev.move, sample.final.move)) last.prev = { ...last.prev, cat };
  }

  /** @param {Extract<SessionEvent, {type:'move:committed'}>} event */
  function onChildCommit(event) {
    const { ply, index } = event;
    const b = book && book.gameId === state.gameId ? book : null;
    if (b) b.thread?.end();                                // tasks.sync has already cancelled the assess job and the coach reply
    question = null;
    clearIdle();
    const tn = b && b.trial && b.trial.id === event.trialId ? b.trial : null;
    if (tn) settleTried(tn, false);
    const info = infoOf(ply.move, ply.notation);
    /** @type {TrialEntry} */
    const entry = (b ? b.trials.get(codeOf(ply.move)) : undefined)
      ?? { info, quick: null, assessed: null, pin: null, built: null, earned: false, voiced: false, held: false, found: false };
    const attempt = tn ? tn.attempt : { tries: 1, first: refOf(ply.move), hintAtFirst: /** @type {0} */ (0) };
    const hintMax = tn ? tn.hintLevel : 0;
    const n = moveNo(index);
    const commented = tn !== null && tn.commented;         // the verdict of this trial reached the stage before the child confirmed
    const waited = tn !== null && tn.spoke;                // ... and a sentence about it was said: not "confirmed before any comment"

    const { sample, pending } = buildSample(b, ply, index, entry, attempt, hintMax);
    if (pending) game.pendingSample = pending;
    else game.skill = brain.recordChildMove(profile.skill, game.skill, sample);
    const cat = pending ? null : sample.final.cat;
    const built = commented ? entry.built : null;
    const packet = built ? built.packet : null;
    const more = built ? built.more : null;
    // A forced move (at most two legal moves) leaves no 'great' moment (CONTRACT-NOTES 138). The brief holds the true count;
    // without a brief the table's count stands in (0 = not known, which is not taken for forced).
    const legal = b && b.turn ? b.turn.n : sample.legalCount;
    const forced = legal >= 1 && legal <= FORCED_MOVES;
    game.memory.noteMine(index, { move: ply.notation, cat: /** @type {Cat} */ (cat), waited, self: sample.self, packet, more,
                                  ...(forced ? { forced: true } : {}) });
    last.prev = { move: info, cat: /** @type {Cat} */ (cat), waited, self: sample.self, packet, more, assessed: entry.assessed };

    if (commented && entry.held) {
      const r = afterHeld(game.budgets, 'confirmed', entry.voiced, n);
      if (r.sayOwnWay) say(STR.ownWay);
    }
    const earned = commented && entry.earned;
    const lead = packet && packet.does[0] ? packet.does[0].k : undefined;
    const praise = praiseFor({ earned, cat, found: earned && entry.found, hintMax, lead }, game.budgets, n);
    const stamp = stampFor(sample.patterns, openingChange(index, ply), game.budgets);
    const soft = ply.flags.check && softCheck(index, game.budgets);
    if (ply.flags.check) game.budgets.lastCheckPly = index;
    if (b && b.idleOffered && hintMax === 0) game.budgets.idleDeclined = true;      // an offered pouch was not opened (M13)
    lastAnim = stage.committed({ move: ply.move, notation: ply.notation, flags: ply.flags, fromTrial: true, cat, praise, stamp,
                                 self: sample.self && earned, softCheck: soft, view: viewNow() });
    if (sample.avoided && !game.memory.habitMentioned(sample.avoided)) {
      const line = sample.avoided === 'greedy' ? STR.avoided.greedy : sample.avoided === 'miss_threat' ? STR.avoided.miss_threat : null;
      if (line) say(line);
      game.memory.noteHabit(sample.avoided);
    }

    // 司马懿: rattled when he was punished, composed when merely checked
    const rivalMoveNo = moveNo(index + 1);
    const tactic = earned && lead !== undefined && TACTIC_MOTIFS.includes(lead);
    const taken = packet !== null && packet.chance === 'taken';
    const free = (entry.assessed && entry.assessed.facts.capture ? entry.assessed.facts.capture.free === true : false) || lead === 'capture_free';
    const freeBig = ply.move.captured !== null && PIECE_VALUE[ply.move.captured.type] >= 300 && free;
    if (tactic || taken || freeBig) rivalSay({ kind: 'punished' }, rivalMoveNo);
    else if (ply.flags.check) rivalSay({ kind: 'checked' }, rivalMoveNo, state.phase === 'over');      // mated: no "不慌。" before he concedes
    stage.notation(notationRows(state.history), state.history.length);
    stage.announce(STR.announce.mine(ply.notation));
  }

  /** @param {Extract<SessionEvent, {type:'move:committed'}>} event */
  function onRivalCommit(event) {
    const { ply, index } = event;
    const move = ply.move;
    const soft = ply.flags.check && softCheck(index, game.budgets);
    if (ply.flags.check) game.budgets.lastCheckPly = index;
    const lostBig = move.captured !== null && (move.captured.type === 'rook' || move.captured.type === 'cannon' || move.captured.type === 'horse');
    lastAnim = stage.rivalMoved({ move, notation: ply.notation, flags: ply.flags, caption: [], lostBig, softCheck: soft, view: viewNow() });

    const facts = last.opp && sameMove(last.opp.move, move) ? last.opp.facts : null;
    const tacticLanded = facts !== null && ((facts.capture !== null && facts.capture.exchange === 'wins') || facts.fork !== null
      || (facts.check !== null && facts.check.mate) || facts.mateThreat !== null);
    const prev = last.prev;
    const before = prev && prev.assessed ? prev.assessed : null;
    const reply = before && before.assessment.refutation ? before.assessment.refutation.reply : null;
    const punishesChild = prev !== null && isSlip(prev.cat)
      ? tacticLanded || (reply !== null && sameMove(reply, move))
      : before !== null && before.assessment.cat === 'ok'
        && ((reply !== null && sameMove(reply, move)) || (move.captured !== null && before.facts.exposed.some((e) => sameSquare(e.piece.at, move.to))));
    // He never gloats (CONTRACT-NOTES 113, 138): on the move of his that ends the game he is calm, whatever rivalReact would
    // show for it (a mate that lands is a tactic that landed: `smug`), and says nothing; his over line follows as always.
    // rivalReact is still asked, so that the random stream of a game does not depend on how it ends.
    rivalSay({ kind: 'moved', gaveCheck: ply.flags.check, tacticLanded, punishesChild }, moveNo(index), state.phase === 'over' ? 'calm' : undefined);
    stage.tension(last.tension);
    stage.notation(notationRows(state.history), state.history.length);
    stage.announce(STR.announce.rival(ply.notation, ply.flags.check));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-rival (opponent:turn)
  // ---------------------------------------------------------------------------------------------------------------

  /** @param {boolean} retry */
  function onOpponentTurn(retry) {
    const b = newBook(false);
    tellPhase();
    pushChips();
    tellInput(false);
    const known = last.evals.length > 0 ? last.evals[last.evals.length - 1] : undefined;
    const trouble = (typeof known === 'number' ? known : 0) >= TROUBLE_CP;
    const rivalMoveNo = moveNo(b.ply);
    rivalSay({ kind: 'thinking', trouble }, rivalMoveNo);
    const t0 = now();
    // a rival move that was recorded and then refused (an illegal answer) is taken out again before the second attempt
    if (retry) game.skill = brain.rewindGameSkill(game.skill, b.ply);
    const lastPly = state.history.length > 0 ? state.history[state.history.length - 1] : null;
    const childPly = lastPly && lastPly.by === 'child' ? lastPly : null;
    const teaching = brain.teachingContext(profile.skill, game.skill, {
      moveNo: rivalMoveNo,
      lastChildMove: childPly ? refOf(childPly.move) : null,
      lastChildCapture: childPly !== null && childPly.move.captured !== null,
    });
    const payload = { fen: b.fen, history: historyFens(state), ply: b.ply, ctx: teaching, tensionPrev: last.tension, evalTwoPliesAgo: evalAt(b.ply - 2) };
    /** @returns {TaskHandle<OpponentTurn>} */
    const startJob = () => tasks.job({ ...brain.opponentJob(payload), lifetime: 'position' });
    const job = startJob();
    const positionId = state.positionId;
    const forced = state.check;
    run('position', async (ctx) => {
      let out = await ctx.wait(job.done);
      if (!out.ok && (out.reason === 'error' || out.reason === 'timeout')) out = await ctx.wait(startJob().done);
      if (!out.ok) {                                       // the retry control sits where the child is looking
        session.opponentFailed(positionId);
        tellPhase();
        return;
      }
      const answer = out.value;
      if (game.pendingSample) {
        const pending = game.pendingSample;
        game.pendingSample = null;
        completeSample(pending, typeof answer.childMoveCp === 'number' ? answer.childMoveCp : null);
      }
      game.skill = brain.recordOpponentMove(game.skill, b.ply, answer.choice);      // the choice exactly as the brain returned it
      last.opp = answer;
      if (typeof answer.tension === 'number' && Number.isFinite(answer.tension)) last.tension = answer.tension;
      if (typeof answer.childMoveCp === 'number') last.evals[b.ply] = answer.childMoveCp;
      if (typeof answer.evalAfter === 'number') last.evals[b.ply + 1] = answer.evalAfter;
      const recapture = childPly !== null && answer.move.captured !== null && sameSquare(answer.move.to, childPly.move.to);
      const think = rivalThinkMs({ forced, recapture, trouble, reduced: settings.motion === 'reduced' }, rng);
      const rest = t0 + Math.round(think) - now();
      await ctx.wait(Promise.all([rest > 0 ? sleepRaw(rest) : Promise.resolve(), lastAnim]));
      // A refusal is the session's last word: 'stale' means the game has moved on, 'illegal' has already set the failed flag.
      session.opponentMove(positionId, refOf(answer.move));
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-hint (hint)
  // ---------------------------------------------------------------------------------------------------------------

  /** The squares of a pouch-2 area, as the child sees the board. @param {{side:'left'|'center'|'right', zone:'home'|'river'|'enemy'}} area @returns {Square[]} */
  function areaSquares(area) {
    const red = state.humanColor === 'red';
    const cols = area.side === 'left' ? [0, 1, 2] : area.side === 'center' ? [3, 4, 5] : [6, 7, 8];
    const depths = area.zone === 'home' ? [0, 1, 2] : area.zone === 'enemy' ? [7, 8, 9] : [3, 4, 5, 6];
    /** @type {Square[]} */
    const squares = [];
    for (const depth of depths) {
      for (const col of cols) squares.push({ row: red ? 9 - depth : depth, col: red ? col : 8 - col });
    }
    return squares;
  }

  /** @param {1|2|3} level */
  function onHint(level) {
    const b = book;
    if (!b || !current(b)) return;
    tellPhase();
    ensureSurvey();
    run('position', async (ctx) => {
      if (!b.truth && !b.survey.failed) {
        const table = tableKnown(b);
        await ctx.wait(Promise.race([table, sleepRaw(HINT_SAY_MS)]));
        if (!b.truth && !b.survey.failed) {
          say(STR.hintWait);
          await ctx.wait(Promise.race([table, sleepRaw(HINT_WAIT_MS - HINT_SAY_MS)]));
        }
      }
      if (!b.truth || !b.survey.table || !b.facts) {
        say(STR.hintUnavailable);
        return;
      }
      if (!b.thread) await ctx.wait(briefed(b));
      const thread = b.thread;
      if (!thread || !b.turn || !b.report || !b.moveBook || !b.truth || !b.survey.table) return;
      let hint;
      try {
        hint = brain.hintFor({ fen: b.fen, ply: b.ply, table: b.survey.table, move: refOf(b.truth.bestMove), facts: b.facts,
                               threat: b.survey.threat ?? null });
      } catch (error) {
        reportError(error);
        say(STR.hintUnavailable);
        return;
      }
      // visuals at once, from local data; the text is the caption of what is already on the board
      if (level === 1) {
        stage.hint(1, {});
      } else if (level === 2) {
        stage.hint(2, { pieces: [hint.piece.at], squares: areaSquares(hint.area) });
      } else {
        b.truth.shown = true;
        stage.hint(3, { move: refOf(hint.move) });
        session.select(hint.move.from.row, hint.move.from.col);      // refused during a trial: a late pouch never discards it
        pushChips();                                       // hint3 set
      }
      const packet = coach.brief.buildHintPacket(level, hint, { turn: b.turn, report: b.report }, b.moveBook);
      speak('position', 'hint', (h, opts) => thread.hint(level, packet, 'auto', h, opts), {
        onEnd: (r) => {
          if (r.text === '') return;
          if ('does' in packet) noteTaught([packet.does[0] ? packet.does[0].k : undefined]);
          else noteTaught([packet.theme]);
        },
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-ask (actions.ask)
  // ---------------------------------------------------------------------------------------------------------------

  /** Ghost play needs real `Move`s: they are built by walking a copy of the board the preview starts from (CONTRACT-NOTES 72). */
  /** @param {MoveRef[]} refs @param {'now'|'trial'} from */
  function preview(refs, from) {
    if (from === 'trial' && !state.trial) return;
    const start = from === 'trial' ? displayBoard(state) : state.board;
    const grid = start.map((row) => row.slice());
    /** @type {Move[]} */
    const moves = [];
    for (const ref of refs) {
      const piece = grid[ref.from.row] ? grid[ref.from.row][ref.from.col] : null;
      if (!piece || !grid[ref.to.row]) break;
      const captured = grid[ref.to.row][ref.to.col] ?? null;
      moves.push({ from: { row: ref.from.row, col: ref.from.col }, to: { row: ref.to.row, col: ref.to.col }, piece, captured });
      grid[ref.to.row][ref.to.col] = piece;
      grid[ref.from.row][ref.from.col] = null;
    }
    if (moves.length > 0) stage.preview(moves, { from }).catch(reportError);
  }

  /** The arrow of the last move of one side; a horse goes round its leg, a cannon jumps only when it captured. @param {'child'|'opponent'} by */
  function lastArrow(by) {
    for (let i = state.history.length - 1; i >= 0 && i >= state.history.length - 2; i--) {
      const ply = state.history[i];
      if (ply.by !== by) continue;
      const type = ply.move.piece.type;
      const pieceType = type === 'horse' || (type === 'cannon' && ply.move.captured) ? type : undefined;
      stage.arrows([{ from: ply.move.from, to: ply.move.to, style: 'last', pieceType }], { group: 'ask' });
      return;
    }
  }

  /** A `better` answer (or any `more.better`) is about to travel: the truth is pinned to the move it names (4.25.3). @param {PositionBook} b @param {TrialEntry} entry */
  function pinShown(b, entry) {
    if (!entry.assessed || !entry.built) return;
    const a = entry.assessed.assessment;
    const better = entry.built.more.better ?? [];
    // ... but never back to a move that the truth of now has replaced (an assessment whose renewal has not arrived yet)
    if (!a.isBest && better.length > 0 && better[0].move === a.best.notation && !overtaken(b, entry)
        && (!b.truth || !sameMove(b.truth.bestMove, a.best))) {
      b.truth = { bestMove: refOf(a.best), bestCp: a.bestCp, depth: a.depth, shown: true };
    }
    if (b.truth) b.truth.shown = true;
  }

  /** The board acts first, from local data (D-38). @param {PositionBook} b @param {TrialNow|null} tn @param {AskCode} code */
  function seeFirst(b, tn, code) {
    const assessed = tn ? tn.entry.assessed : null;
    if (code === 'reply') {
      const answer = assessed && assessed.replies.length > 0 ? assessed.replies[0] : null;
      if (answer) preview(answer.line.moves.slice(0, PREVIEW_PLIES), 'trial');
    } else if (code === 'better') {
      const built = tn ? tn.entry.built : null;
      if (tn && assessed && built && !assessed.assessment.isBest && (built.more.better ?? []).length > 0 && b.truth) {
        stage.arrows([{ from: b.truth.bestMove.from, to: b.truth.bestMove.to, style: 'idea' }], { group: 'ask' });
      }
    } else if (code === 'show') {
      const refutation = assessed ? assessed.assessment.refutation : null;
      if (refutation) {
        stage.highlight({ pieces: refutation.focus });
        preview(refutation.line.moves.slice(1, 3), 'trial');
      }
    } else if (code === 'intent') {
      const threat = b.turn && b.turn.threats.length > 0 ? b.turn.threats[0] : null;
      const link = threat && b.moveBook ? b.moveBook.lookup(threat.move) : null;
      if (link) stage.arrows([{ from: link.from, to: link.to, style: 'threat' }], { group: 'ask' });
      else lastArrow('opponent');
    } else if (code === 'danger') {
      const mine = b.facts ? b.facts.hanging.filter((h) => h.piece.color === state.humanColor) : [];
      if (mine.length > 0) stage.highlight({ pieces: [...mine.map((h) => h.piece.at), ...mine.map((h) => h.by.at)] });
    } else if (code === 'last') {
      lastArrow('child');
    }
  }

  /** What the child "said": the label of the chip they tapped, else the label of the code, else their own sentence. @param {AskCode} code @param {string|undefined} text */
  function childLine(code, text) {
    const chip = shownChips.find((c) => c.ask === code);
    return chip ? chip.label : ASK_LABEL[code] ?? text ?? '';
  }

  /** @param {AskCode} code */
  function useChip(code) {
    chipCtx.used.add(code);
    if (code !== 'why') chipCtx.used.delete('why');        // a new answer can be asked about again
  }

  /** @param {Extract<ReplyResult, {aborted:false}>} r */
  function afterAnswer(r) {
    chipCtx.answered = true;
    chipCtx.why = r.text !== '';                           // 为什么？ is offered only after an answer that said something
    pushChips();                                           // after set: 为什么？ + the chips of the set not used yet
  }

  /** @param {PositionBook} b @param {AskCode} code @param {string|undefined} text */
  function askTurn(b, code, text) {
    const thread = b.thread;
    if (!thread || !current(b) || !canAsk(state)) return;
    const tn = state.phase === 'tentative' ? b.trial : null;
    if (TRY_ASKS.includes(code) && (!tn || !tn.tried)) return;      // never before the try event of that move is in the thread
    if (tn && tn.tried && tn.resync && tn.entry.built) {
      // The trial was assessed again under a new pin with the same verdict (trialScript): the thread still holds the try
      // event of the old one, and with it a `more` that names the replaced move. This question takes the coach channel
      // anyway, so the try event is renewed now, without a word.
      const fresh = tn.entry.built;
      tn.resync = false;
      thread.retract();
      thread.tryMove(fresh.packet, fresh.more, 'silent', {}, {});
    }
    if (tn && tn.tried && MORE_ASKS.includes(code)) pinShown(b, tn.entry);
    seeFirst(b, tn, code);
    stage.childSaid(childLine(code, text));
    useChip(code);
    ensureSurvey();
    speak(tn ? 'trial' : 'position', 'ask', (h, opts) => thread.ask(code, code === 'free' ? text : undefined, h, opts), { onEnd: afterAnswer });
  }

  /** @param {{code?:AskCode, text?:string}} q */
  function onAsk(q) {
    if (disposed || !q || !canAsk(state)) return;
    const at = now();
    if (at - lastAskAt < ASK_GAP_MS) return;
    /** @type {AskCode} */
    const code = q.code ?? 'free';
    if (!ASK_CODES.includes(code)) return;
    /** @type {string|undefined} */
    let text;
    if (code === 'free') {
      text = typeof q.text === 'string' ? q.text.trim() : '';
      const length = Array.from(text).length;              // code points (CONTRACT-NOTES 70)
      if (length < 1 || length > SAY_MAX) return;
    }
    if (code === 'why' && !chipCtx.why) return;            // no sentence to explain: the model is never asked for a reason it was not given

    if (state.phase === 'over') {
      const o = over;
      if (!o || !o.ready || !o.thread || !OVER_ASKS.includes(code)) return;
      const thread = o.thread;
      lastAskAt = at;
      stage.childSaid(childLine(code, text));
      useChip(code);
      speak('game', 'ask', (h, opts) => thread.ask(code, code === 'free' ? text : undefined, h, opts), { onEnd: afterAnswer });
      return;
    }

    const b = book;
    if (!b || !current(b) || OVER_ASKS.includes(code) && code !== 'why' && code !== 'free') return;
    if (TRY_ASKS.includes(code)) {
      const tn = state.phase === 'tentative' ? b.trial : null;
      if (!tn || tn.failed) return;                        // no trial on the board, or one that could not be assessed
      lastAskAt = at;
      if (tn.tried) askTurn(b, code, text);
      else tn.waiters.push((ok) => { if (ok && current(b) && b.trial === tn) askTurn(b, code, text); });      // held until thread.tryMove was called
      return;
    }
    lastAskAt = at;
    // A trial that is still being assessed will take the coach channel for its try event the moment the verdict is in,
    // and a question sent before that would be thrown away unanswered: it waits for the try event (or for the failure
    // of the assessment) and is sent after it. A trial that is taken back, replaced or played meanwhile takes the
    // question with it, as it would abort an answer in flight.
    const assessing = state.phase === 'tentative' && b.trial && !b.trial.tried && !b.trial.failed ? b.trial : null;
    const send = () => {
      if (!current(b)) return;
      if (b.thread) askTurn(b, code, text);
      else b.briefWaiters.push(() => { if (current(b)) askTurn(b, code, text); });
    };
    if (assessing) assessing.waiters.push((ok) => { if ((ok || assessing.failed) && b.trial === assessing) send(); });
    else send();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-undo (undo)
  // ---------------------------------------------------------------------------------------------------------------

  /** Budget marks that lie ahead of the game are brought back to where it stands (CONTRACT-NOTES 110 b). @param {number} ply */
  function rewindBudgets(ply) {
    const budgets = game.budgets;
    const n = moveNo(ply);
    budgets.lastQuestionAt = Math.min(budgets.lastQuestionAt, n);
    budgets.silentUntil = Math.min(budgets.silentUntil, n);
    budgets.lastPopupAt = Math.min(budgets.lastPopupAt, n);
    budgets.lastCheckPly = Math.min(budgets.lastCheckPly, ply);
    budgets.rivalLineAt = Math.min(budgets.rivalLineAt, moveNo(ply + 1));
  }

  /** @param {Extract<SessionEvent, {type:'undo'}>} event */
  function onUndo(event) {
    const ply = state.history.length;
    coach.reset();
    game.memory.rewind(ply);
    game.skill = brain.rewindGameSkill(game.skill, ply);
    game.pendingSample = null;
    game.pendingSelect = null;
    last = { opp: null, prev: null, tension: last.tension, evals: last.evals.slice(0, ply) };
    rewindBudgets(ply);
    clearIdle();
    book = null;
    over = null;
    question = null;
    tapOverTold = false;
    openClock();                                           // an undo out of a finished game: the game runs again
    stage.settle();
    lastAnim = stage.undone({ steps: event.steps, view: viewNow() });
    say(event.plies > 0 ? STR.undoDone : STR.undoResign);      // a resignation taken back pops nothing: no move went back
    stage.notation(notationRows(state.history), ply);
    save();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E-over (game:over, and a finished game that was restored)
  // ---------------------------------------------------------------------------------------------------------------

  /** @param {boolean} quiet a finished game was restored: the card only, no celebration, no request */
  function onGameOver(quiet) {
    const before = book;
    if (before && before.gameId === state.gameId) before.thread?.end();
    question = null;
    game.pendingSelect = null;
    closeClock();                                          // the active-time clock stops
    const b = newBook(true);
    /** @type {NonNullable<typeof over>} */
    const o = { positionId: state.positionId, thread: null, moveBook: null, packet: null, ready: false };
    over = o;
    tellPhase();
    pushChips();
    tellInput(false);
    run('position', async (ctx) => {
      // A game that ends is counted at once, in the task of the event that ended it: 再来一局 pressed while the last move
      // still animates must not lose the result. A restored game keeps its order: app.js may still mark a migrated game
      // as counted right after session.restore(), before anything is counted here.
      if (quiet) await ctx.wait(lastAnim);
      if (game.pendingSample) {                            // the move ended the game: no rival answer will value it
        const pending = game.pendingSample;
        game.pendingSample = null;
        completeSample(pending, null);
      }
      const result = state.result;
      if (!result) return;
      /** @type {'win'|'loss'|'draw'} */
      const outcome = result.winner === null ? 'draw' : result.winner === state.humanColor ? 'win' : 'loss';
      const counting = !state.counted;                     // once per game, also across undo-and-finish-again and a reload
      let rankBefore = profile.rank;
      /** @type {FinishResult} */
      let fin;
      if (counting) {
        fin = brain.finishGame(profile.skill, game.skill, outcome);
        profile = recordResult({ ...profile, skill: fin.profile }, outcome);
        rankBefore = profile.rank;
        profile = { ...profile, rank: Math.max(profile.rank, Math.max(1, Math.min(9, Math.round(profile.skill.level)))) };      // a high-water mark
      } else {
        fin = { profile: profile.skill, delta: 0, takeaways: brain.gameTakeaways(game.skill, outcome, profile.skill) };
      }
      const report = makeReport(b, 'over');
      // the book stands on the board and the side of the report (the child's), also when the game ended with the rival to move
      const moveBook = coach.createMoveBook({ board: state.board, turn: state.humanColor });
      const turn = coach.brief.buildTurnBrief(report, game.memory, moveBook);
      const built = coach.brief.buildOverPacket({ result: outcome, reason: result.reason, finish: fin, game: game.skill, rankBefore,
                                                  rankAfter: profile.rank, goalPrev: game.goalPrev,
                                                  history: state.history, humanColor: state.humanColor }, moveBook);
      if (counting) {
        profile = { ...profile, goal: built.goal ? { code: built.goal, setAt: now() } : null };
        saveProfile();
        session.markCounted();
      }
      if (!quiet) await ctx.wait(lastAnim);                // the card waits for the cue of the last move; the count did not
      const proudPly = built.proudPly !== null ? state.history[built.proudPly] : undefined;
      const proudSample = built.proudPly !== null ? game.skill.samples.find((s) => s.ply === built.proudPly) : undefined;
      const rank = built.packet.rank ? { to: built.packet.rank.to, name: RANK_NAMES[built.packet.rank.to - 1] ?? '' } : null;
      await ctx.wait(stage.over({
        result: outcome,
        reason: result.reason,
        byChildMate: result.reason === 'checkmate' && result.winner === state.humanColor,
        stats: { rounds: Math.ceil(state.history.length / 2), captures: built.packet.stats.captures, brilliant: built.packet.stats.brilliant },
        proud: proudPly && proudPly.by === 'child'
          ? { before: proudPly.before, move: proudPly.move, notation: proudPly.notation, self: proudSample ? proudSample.self : false }
          : null,
        rank,
        goal: built.goal ? STR.goalNext(HABIT_FIX[built.goal]) : null,
        kept: built.kept,
        quiet,
      }));
      if (!quiet) rivalSay({ kind: 'over', result: outcome }, moveNo(state.history.length));
      const thread = coach.beginOver(turn, moveBook);
      b.report = report;
      b.turn = turn;
      b.moveBook = moveBook;
      o.thread = thread;
      o.moveBook = moveBook;
      o.packet = built.packet;
      const takeaway = speak('position', 'over', (h, opts) => thread.open({ kind: 'over', over: built.packet }, quiet ? 'local' : 'auto', h, opts),
                             { target: 'card' });
      // The questions open when the takeaway has ended (or was stopped, or timed out): asked earlier, a question would take
      // the coach channel and cut the takeaway off in the card.
      await ctx.wait(takeaway.done);
      o.ready = true;
      pushChips();                                         // over set
      tellInput(askable());
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The session subscriber
  // ---------------------------------------------------------------------------------------------------------------

  /** @param {SessionEvent} event */
  function onEvent(event) {
    if (disposed) return;
    switch (event.type) {
      case 'scope':
        break;                                             // tasks.sync is the first subscriber (app.js); nothing to do here
      case 'game:start':
        onGameStart(event);
        break;
      case 'child:turn':
        onChildTurn(event.cause);
        break;
      case 'opponent:turn':
        onOpponentTurn(event.retry);
        break;
      case 'opponent:failed':
        tellPhase();
        break;
      case 'selection':
        if (skipSelection) skipSelection = false;
        else stage.selected(state.selected, state.targets, state.forbidden);
        break;
      case 'trial:start':
        onTrialStart(event);
        break;
      case 'trial:end':
        onTrialEnd(event);
        break;
      case 'move:committed':
        if (event.by === 'child') onChildCommit(event);
        else onRivalCommit(event);
        break;
      case 'hint':
        onHint(event.level);
        break;
      case 'undo':
        onUndo(event);
        break;
      case 'game:over':
        onGameOver(false);
        break;
      case 'change':
        skipSelection = false;
        tellPhase();
        if (event.persist && !store.available()) storageNotice();      // the save subscriber ran before this one
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // actions (SPEC 4.25.7)
  // ---------------------------------------------------------------------------------------------------------------

  /** After the engine came back: the script of the current phase runs again (CONTRACT-NOTES 44). */
  function rerunPhase() {
    if (state.gameId === 0) return;
    if (state.phase === 'opponentTurn') {
      if (state.opponentFailed) session.retryOpponent();
      return;
    }
    const b = book;
    if (!b || !current(b) || !childPhase()) return;
    b.survey.failed = false;
    const tn = b.trial;
    const trial = state.trial;
    if (state.phase === 'tentative' && tn && trial && tn.id === trial.id && tn.failed && !tn.entry.assessed) {
      tn.failed = false;
      pushChips();                                         // the trial chips are back with the second attempt
      const job = startAssess(b, tn, trial);
      run('trial', (ctx) => trialScript(ctx, b, tn, trial, job));
    } else {
      ensureSurvey();
    }
  }

  /** @param {Settings} next */
  function applySettings(next) {
    const before = settings;
    settings = next;
    stage.applySettings(next);
    // app.js has set the coach port's forceLocal by now (store.onSettings): the probe pushes the change of mode at once
    if (next.coach !== before.coach) coach.probe().catch(reportError);
    tellInput(askable());
  }

  /** @type {StageHandlers} */
  const actions = {
    tap(row, col) {
      if (disposed || !Number.isInteger(row) || !Number.isInteger(col)) return;
      const sq = { row, col };
      if (state.phase === 'opponentTurn') {                // becomes the selection when the turn starts (D-43)
        const piece = state.board[row] ? state.board[row][col] : null;
        if (piece && piece.color === state.humanColor) {
          game.pendingSelect = sq;
          refusals = 0;
          return;
        }
      }
      const q = question;
      if (q && state.phase === 'tentative' && state.trial && state.trial.id === q.trialId && q.focus.some((f) => sameSquare(f, sq))) {
        say(STR.rightPiece);                               // the child answered the guiding question on the board
        stage.highlight({ pieces: [sq] });
        return;
      }
      const r = session.tapSquare(row, col);
      if (r.ok) {
        refusals = 0;
        return;
      }
      refusals += 1;
      stage.rejected(sq, r.reason, refusals);
      if (r.reason === 'perpetual-check') say(STR.perpetual);
      else if (r.reason === 'no-moves' && refusals === 3) stage.toast(STR.noMoves);
      else if (r.reason === 'over' && state.result !== null && !tapOverTold) {
        tapOverTold = true;                                // once per game over
        stage.toast(STR.tapOver);
      }
    },

    confirm() {
      if (disposed || state.phase !== 'tentative') return;
      stage.settle();
      session.confirm();
    },

    retract() {
      if (disposed || state.phase !== 'tentative') return;
      stage.settle();
      session.retract();
    },

    undo() {
      if (disposed || state.gameId === 0) return;
      if (canUndo(state)) stage.settle();
      const r = session.undo();
      if (!r.ok && r.reason === 'nothing-to-undo') {
        const opening = state.history.length === 1 && state.history[0].by === 'opponent';
        stage.toast(opening ? STR.undoOpening : STR.undoNone);
      }
    },

    hint() {
      if (disposed) return;
      session.requestHint();                               // script E-hint
    },

    ask(q) {
      onAsk(q);
    },

    chip(spec) {
      if (disposed || !spec) return;
      if (spec.action === 'retract') {
        if (state.phase !== 'tentative') return;
        stage.settle();
        say(STR.seenIt[seenCount++ % STR.seenIt.length]);
        session.retract();
      } else if (spec.action === 'confirm') {
        if (state.phase !== 'tentative') return;
        stage.settle();
        session.confirm();
      } else if (spec.action === 'takeback') {
        if (book) book.takeback = false;
        chipCtx.used.add('takeback');
        if (!canUndo(state)) return;
        stage.settle();
        session.undo();
      } else if (spec.action === 'pouch') {
        const b = book;
        if (!b || !current(b) || !b.truth) return;
        chipCtx.used.add('try');
        if (!session.tryMove(refOf(b.truth.bestMove)).ok) pushChips();
      }
      // 'write': nothing (the panel opens its input)
    },

    moveLink(link, active) {
      if (disposed || !link) return;
      if (active) {
        const badge = Array.isArray(link.pre) && link.pre.length >= 2 ? String(link.pre.length + 1) : undefined;
        stage.arrows([{ from: link.from, to: link.to, style: link.color === state.humanColor ? 'idea' : 'threat', badge }], { group: 'chat' });
        return;
      }
      stage.clearArrows('chat');
      // a second tap on an active playable link, while no reply is in flight, tries the move
      const busy = book && book.thread ? book.thread.busy() : false;
      if (link.playable && !busy && childPhase()) session.tryMove({ from: link.from, to: link.to });
    },

    playLine(links) {
      if (disposed || !Array.isArray(links) || links.length === 0) return;
      const head = links[0];
      const lead = Array.isArray(head.pre) ? head.pre : [];      // the moves before the run, when it does not start its line
      preview([...lead, ...links].map((l) => ({ from: l.from, to: l.to })), head.src === 'reply' ? 'trial' : 'now');
    },

    newGame() {
      if (disposed) return;
      /** @param {Color} humanColor */
      const start = (humanColor) => {
        coach.reset();
        session.newGame({ humanColor });
      };
      if (state.gameId === 0 || state.phase === 'over') {
        start(settings.side);
        return;
      }
      const gameId = state.gameId;
      stage.dialog('new-game').then((choice) => {
        if (disposed || !choice || state.gameId !== gameId) return;
        start(choice.humanColor === 'red' || choice.humanColor === 'black' ? choice.humanColor : settings.side);
      }).catch(reportError);
    },

    resign() {
      if (disposed || state.gameId === 0 || state.phase === 'over') return;
      const gameId = state.gameId;
      stage.dialog('resign').then((yes) => {
        if (disposed || yes !== true || state.gameId !== gameId || state.phase === 'over') return;
        stage.settle();
        session.resign();
      }).catch(reportError);
    },

    retryOpponent() {
      if (disposed) return;
      session.retryOpponent();
    },

    retryEngine() {
      if (disposed) return;
      tasks.restart();
      stage.blocking(null);
      rerunPhase();                                        // jobs posted before `ready` are held (6.5)
    },

    setting(key, value) {
      if (disposed) return;
      applySettings(store.saveSettings(/** @type {Partial<Settings>} */ ({ [key]: value })));
    },

    exportRecord() {
      try {
        download(buildRecord(state, activeNow()));
      } catch (error) {
        reportError(error);
      }
    },

    exportBackup() {
      try {
        if (state.gameId !== 0) save();
        download(buildBackupFile(store.exportBackup()));
      } catch (error) {
        reportError(error);
      }
    },

    importBackup(text) {
      if (disposed) return;
      const r = store.importBackup(text);
      if (r.ok) {
        if (deps.reload) deps.reload();
      } else {
        stage.toast(r.why === 'storage' ? STR.importFull : STR.importFailed);
      }
    },

    stopCoach() {
      if (book) book.thread?.interrupt();
      if (over) over.thread?.interrupt();
    },

    activity() {
      if (disposed) return;
      armIdle();                                           // any input: the idle timers start over
    },
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The coach's mode, and the rest of the Director
  // ---------------------------------------------------------------------------------------------------------------

  const offMode = coach.onMode((m) => {
    if (disposed) return;
    stage.coachMode(m);
    tellInput(askable());
  });
  stage.coachMode({ mode: coach.mode(), reason: coach.offReason() });

  return {
    onEvent,

    extras: () => ({ seed: game.seed, skill: game.skill, memory: game.memory.toJSON(), activeMs: Math.round(activeNow()) }),

    loadExtras(saved) {
      if (saved === null || typeof saved !== 'object') {
        loaded = null;
        return;
      }
      const seed = typeof saved.seed === 'number' && Number.isFinite(saved.seed) ? saved.seed >>> 0 : drawSeed();
      const plies = Array.isArray(saved.moves) ? saved.moves.length : 0;
      const skill = brain.rewindGameSkill(brain.reviveGameSkill(saved.skill, seed), plies);
      const memory = coach.createGameMemory(saved.memory);
      memory.rewind(plies);
      const activeMs = typeof saved.activeMs === 'number' && Number.isFinite(saved.activeMs) && saved.activeMs > 0 ? saved.activeMs : 0;
      loaded = { seed, skill, memory, activeMs };
    },

    applySettings,

    notices(list, info) {
      const all = Array.isArray(list) ? list : [];
      for (const notice of all) {
        if (notice === 'storage-unavailable') storageNotice();
        else if (notice === 'game-corrupt') say(STR.saveCorrupt);
        else if (notice === 'game-newer') say(STR.saveNewer);
        else if (notice === 'migrated-v1') say(STR.migrated);
        else if (notice === 'migrated-v1-local') say(STR.migratedLocal);
        else if (notice === 'imported') say(STR.imported);
        else if (notice === 'import-failed') stage.toast(STR.importFailed);
      }
      // store.load() never reports a truncation: it comes from session.restore's truncatedAt
      const truncatedAt = info && typeof info.truncatedAt === 'number' ? info.truncatedAt : null;
      if (truncatedAt !== null) say(STR.saveTruncated(truncatedAt));
      else if (all.includes('game-truncated')) say(STR.saveTruncated(state.history.length));
    },

    visibility(visible) {
      hidden = !visible;
      if (hidden) {
        closeClock();
        clearIdle();
      } else {
        openClock();
        armIdle();
      }
    },

    actions,

    dispose() {
      if (disposed) return;
      disposed = true;
      clearIdle();
      offMode();
      if (book) book.thread?.interrupt();
      if (over) over.thread?.interrupt();
    },
  };
}

/**
 * @typedef {Object} Director
 * @property {(event:SessionEvent, state:SessionState) => void} onEvent       the session subscriber (scripts of §5.4)
 * @property {() => {seed:number, skill:GameSkill, memory:object, activeMs:number}} extras       merged into the save by app.js
 * @property {(saved:SavedGame|null) => void} loadExtras                      before session.restore / newGame
 * @property {(settings:Settings) => void} applySettings
 * @property {(notices:Notice[], info:{truncatedAt:number|null}) => void} notices
 * @property {(visible:boolean) => void} visibility                           pauses the active-time clock and idle timers
 * @property {StageHandlers} actions                                          registered with stage.on(...)
 * @property {() => void} dispose
 */
