// Session (SPEC 4.18): synchronous, DOM-free, timer-free state machine. Owns the only game truth and the three ids
// (gameId, positionId, trialId). Transition table: SPEC section 5. Owner: G1.
//
// How this file keeps the tables of section 5:
// - One command produces one event batch (5.7): `scope` first when any of the three scope numbers changed, then the
//   semantic events in causal order, then `change` last. A refused command changes nothing and emits nothing; the one
//   exception is the one the contract names (an illegal opponentMove sets the failed flag and says so).
// - Every change of the committed position or of the result bumps positionId and goes through enterTurn() or settle(),
//   which reset the selection, the pouch level, the attempt and the failed flag. Nothing survives a position change.
// - getState() returns the same object for the whole life of the session; only this file writes it. The values inside it
//   (board, history, targets, trial, hint, attempt, result, ...) are replaced, never mutated, so a value handed out in an
//   event stays what it was.
// - Before the first newGame() / restore() no game exists: gameId is 0, the phase is 'over' with a null result, and
//   every command except newGame and restore is refused.

/**
 * @import { Color, Square, Piece, Board, Move, MoveRef, GameStatus, PlyRecord } from '../core/types.js'
 * @import { GameResult, MoveFlags, Ply, Trial, SessionState, Scope, SessionEvent, Result, Refusal, SavedGame } from './types.js'
 */

import * as coreEngine from '../core/engine.js';
import * as coreNotation from '../core/notation.js';

/** SavedGame.moves: at most 2000 are accepted on load (3.9). The session never holds more, so every save it produces loads again. */
const LOAD_MAX_PLIES = 2000;
/** SavedGame.id (3.9). */
const GAME_ID_RE = /^g-[a-z0-9]{6,16}$/;
/** The id of the state before the first game exists. */
const NO_GAME_ID = 'g-00000000';

/** "g-" + 8 base36 characters. @returns {string} */
function randomGameId() {
  const bytes = new Uint8Array(8);
  const source = globalThis.crypto;
  if (source && typeof source.getRandomValues === 'function') source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = 'g-';
  for (const byte of bytes) id += (byte % 36).toString(36);
  return id;
}

/** @param {Square} a @param {Square} b @returns {boolean} */
function sameSquare(a, b) {
  return a.row === b.row && a.col === b.col;
}

/** A point of the board as a fresh object; null for anything else. @param {unknown} sq @returns {Square|null} */
function cleanSquare(sq) {
  if (typeof sq !== 'object' || sq === null) return null;
  const { row, col } = /** @type {{row?:unknown, col?:unknown}} */ (sq);
  if (typeof row !== 'number' || typeof col !== 'number' || !Number.isInteger(row) || !Number.isInteger(col)) return null;
  if (row < 0 || row > 9 || col < 0 || col > 8) return null;
  return { row, col };
}

/** A move reference between two points of the board as a fresh object; null for anything else. @param {unknown} ref @returns {MoveRef|null} */
function cleanRef(ref) {
  if (typeof ref !== 'object' || ref === null) return null;
  const { from, to } = /** @type {{from?:unknown, to?:unknown}} */ (ref);
  const a = cleanSquare(from);
  const b = cleanSquare(to);
  return a && b ? { from: a, to: b } : null;
}

/** Board taps are integers; anything else is a programmer error (4.18). @param {number} row @param {number} col */
function requireIntegers(row, col) {
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new TypeError(`session: board coordinates must be integers, got (${String(row)}, ${String(col)})`);
  }
}

/** @param {Board} board @param {Color} color @returns {Square|null} */
function kingSquare(board, color) {
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (piece && piece.type === 'king' && piece.color === color) return { row, col };
    }
  }
  return null;
}

/** A pawn moved from its own half to the enemy half. @param {Move} move @returns {boolean} */
function crossedRiver(move) {
  if (move.piece.type !== 'pawn') return false;
  return move.piece.color === 'red' ? move.from.row >= 5 && move.to.row <= 4 : move.from.row <= 4 && move.to.row >= 5;
}

/** @param {unknown} v @param {number|null} fallback @returns {number|null} */
function finiteOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * The undo table of 5.5 for every phase but `tentative` (which is a retract): the number of plies undo() pops
 * (0 = only a resignation is taken back), or -1 when there is nothing to undo. undo() always lands on the child's turn,
 * so it pops two plies when the child is to move and one when the rival is; when the game has fewer plies than that
 * (no move yet, only the rival's opening move, black resigned before the rival opened) there is nothing to undo.
 * @param {SessionState} state
 * @returns {number}
 */
function undoCount(state) {
  const childToMove = state.turn === state.humanColor;
  if (state.phase === 'over') {
    if (!state.result) return -1;                                             // no game exists yet
    if (state.result.reason === 'resign' && childToMove) return 0;
  }
  const plies = childToMove ? 2 : 1;
  return state.history.length >= plies ? plies : -1;
}

/**
 * @param {{ engine?: typeof import('../core/engine.js'), notation?: typeof import('../core/notation.js'),
 *           now?: () => number, makeId?: () => string }} [deps]      makeId uses crypto.getRandomValues
 * @returns {Session}
 */
export function createSession(deps) {
  const engine = deps?.engine ?? coreEngine;
  const notation = deps?.notation ?? coreNotation;
  const now = deps?.now ?? (() => Date.now());
  const makeId = deps?.makeId ?? randomGameId;

  const firstBoard = engine.createInitialBoard();
  /** @type {SessionState} */
  const state = {
    id: NO_GAME_ID,
    gameId: 0,
    positionId: 0,
    trialId: 0,
    phase: 'over',
    board: firstBoard,
    turn: 'red',
    humanColor: 'red',
    history: [],
    startKey: engine.positionKey(firstBoard, 'red'),
    drawFrom: 0,
    selected: null,
    targets: [],
    forbidden: [],
    trial: null,
    hint: { level: 0 },
    attempt: { tries: 0, first: null, hintAtFirst: 0 },
    result: null,
    check: false,
    checkers: [],
    opponentFailed: false,
    counted: false,
    startedAt: 0,
    endedAt: null,
    turnStartedAt: 0,
  };

  // ---- events -------------------------------------------------------------------------------------------------

  /** Replaced, never mutated, so a delivery in progress walks the list it started with. */
  /** @type {{fn:(event:SessionEvent, state:SessionState) => void, active:boolean}[]} */
  let subscribers = [];
  /** @type {SessionEvent[]} */
  const queue = [];
  let delivering = false;
  /** The scope the subscribers were last told. @type {Scope} */
  let announced = { game: 0, position: 0, trial: 0 };

  /** @returns {Scope} */
  function currentScope() {
    return { game: state.gameId, position: state.positionId, trial: state.trial ? state.trial.id : 0 };
  }

  /** Subscribers in registration order, one event at a time. A batch queued by a subscriber is delivered after the current one. */
  function deliver() {
    if (delivering) return;
    delivering = true;
    try {
      for (let event = queue.shift(); event !== undefined; event = queue.shift()) {
        for (const entry of subscribers) {
          if (!entry.active) continue;
          try {
            entry.fn(event, state);
          } catch (error) {
            console.error(`session: a subscriber threw while handling "${event.type}"`, error);      // log and continue
          }
        }
      }
    } finally {
      delivering = false;
    }
  }

  /**
   * Closes the batch of one command: `scope` first when a scope number changed, the semantic events, `change` last.
   * @param {SessionEvent[]} events
   * @param {string} cause
   * @param {boolean} persist
   */
  function publish(events, cause, persist) {
    const scope = currentScope();
    if (scope.game !== announced.game || scope.position !== announced.position || scope.trial !== announced.trial) {
      announced = scope;
      queue.push({ type: 'scope', scope: { ...scope } });
    }
    for (const event of events) queue.push(event);
    queue.push({ type: 'change', cause, persist });
    deliver();
  }

  /** @param {Refusal} reason @returns {{ok:false, reason:Refusal}} */
  function refuse(reason) {
    return { ok: false, reason };
  }

  // ---- the committed position ---------------------------------------------------------------------------------

  /**
   * What the draw rules read (4.2): the key of the position at index drawFrom and the records from there on, plus the
   * playable moves of the side to move. Dropped whenever the committed position changes.
   * @type {{startKey:string, log:PlyRecord[], playable:Move[]|null}|null}
   */
  let rulesMemo = null;

  /** The only writer of the committed position. @param {Board} board @param {Color} turn @param {Ply[]} history @param {number} drawFrom */
  function setPosition(board, turn, history, drawFrom) {
    state.board = board;
    state.turn = turn;
    state.history = history;
    state.drawFrom = drawFrom;
    rulesMemo = null;
  }

  function rules() {
    if (!rulesMemo) {
      const from = state.drawFrom;
      rulesMemo = {
        startKey: from === 0 ? state.startKey : state.history[from - 1].record.key,
        log: state.history.slice(from).map(ply => ply.record),
        playable: null,
      };
    }
    return rulesMemo;
  }

  /** engine.playableMoves for the side to move in the committed position. @returns {Move[]} */
  function playableMoves() {
    const memo = rules();
    memo.playable ??= engine.playableMoves(memo.startKey, memo.log, state.board, state.turn);
    return memo.playable;
  }

  /** @param {number} row @param {number} col @returns {Piece|null} */
  function pieceAt(row, col) {
    return state.board[row]?.[col] ?? null;
  }

  /**
   * flagsOf of 5.4. `status` is engine.getGameStatus(boardAfter, the side that did not move) when the caller has it.
   * @param {Board} boardAfter @param {Move} move @param {GameStatus} [status]
   * @returns {MoveFlags}
   */
  function flagsOf(boardAfter, move, status) {
    const enemy = engine.opposite(move.piece.color);
    const st = status ?? engine.getGameStatus(boardAfter, enemy);
    return {
      check: st.check,
      mate: st.over && st.reason === 'checkmate',
      checkedKing: st.check ? kingSquare(boardAfter, enemy) : null,
      checkers: st.check ? engine.checkers(boardAfter, enemy) : [],
      crossed: crossedRiver(move),
    };
  }

  /**
   * adjudicate of 5.4 on the committed position. `status` is engine.getGameStatus(board, turn) when the caller has it.
   * Draw rules count only the plies from drawFrom on (D-15, 13.3), the move limit included.
   * @param {GameStatus} [status]
   * @returns {GameResult|null}
   */
  function adjudicate(status) {
    const st = status ?? engine.getGameStatus(state.board, state.turn);
    state.check = st.check;
    state.checkers = st.check ? engine.checkers(state.board, state.turn) : [];
    if (st.over) return { winner: st.winner, reason: st.reason === 'stalemate' ? 'stalemate' : 'checkmate' };     // 'king-captured' reads as checkmate
    const { startKey, log } = rules();
    const draw = engine.drawStatus(startKey, log, state.board, state.history.length - state.drawFrom);
    if (draw.draw && draw.reason) return { winner: null, reason: draw.reason };
    // A migrated game counts its move limit from drawFrom; it still may not outgrow what a save can hold.
    if (state.history.length >= LOAD_MAX_PLIES) return { winner: null, reason: 'move_limit' };
    return null;
  }

  // ---- turn bookkeeping ---------------------------------------------------------------------------------------

  function clearSelection() {
    state.selected = null;
    state.targets = [];
    state.forbidden = [];
  }

  /** Everything that belongs to one committed position and one turn. */
  function resetTurn() {
    clearSelection();
    state.hint = { level: 0 };
    state.attempt = { tries: 0, first: null, hintAtFirst: 0 };
    state.opponentFailed = false;
  }

  /**
   * The committed position changed and the game is not over.
   * @param {'new'|'restore'|'opponent-move'|'undo'|'confirm'} cause
   * @param {SessionEvent[]} events
   * @param {number} t
   */
  function enterTurn(cause, events, t) {
    resetTurn();
    state.turnStartedAt = t;
    if (state.turn === state.humanColor && cause !== 'confirm') {
      state.phase = 'childTurn';
      events.push({ type: 'child:turn', cause });
    } else {
      state.phase = 'opponentTurn';
      events.push({ type: 'opponent:turn', retry: false });
    }
  }

  /** The game is over with `result`; no event. @param {GameResult} result */
  function settle(result) {
    resetTurn();
    state.result = result;
    state.phase = 'over';
  }

  /** @param {GameResult} result @param {SessionEvent[]} events @param {number} t */
  function finish(result, events, t) {
    settle(result);
    state.endedAt = t;
    events.push({ type: 'game:over', result });
  }

  /**
   * targets / forbidden of 5.4 `select` for the child's piece on (row, col).
   * @param {number} row @param {number} col
   * @param {Move[]} all engine.getPieceLegalMoves(board, row, col)
   */
  function pickUp(row, col, all) {
    const playable = playableMoves().filter(move => move.from.row === row && move.from.col === col);
    state.targets = playable;
    state.forbidden = all.filter(move => !playable.some(other => sameSquare(other.to, move.to)));
    state.selected = { row, col };
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------

  /** @param {{humanColor?:Color}} [opts] @returns {Result} */
  function newGame(opts) {
    /** @type {SessionEvent[]} */
    const events = [];
    if (state.trial) events.push({ type: 'trial:end', trial: state.trial, reason: 'newgame' });
    const t = now();
    const board = engine.createInitialBoard();
    state.id = makeId();
    state.gameId += 1;
    if (opts?.humanColor === 'red' || opts?.humanColor === 'black') state.humanColor = opts.humanColor;
    state.counted = false;
    state.startKey = engine.positionKey(board, 'red');
    setPosition(board, 'red', [], 0);
    state.trial = null;
    state.result = null;
    state.check = false;
    state.checkers = [];
    state.startedAt = t;
    state.endedAt = null;
    state.positionId += 1;
    events.push({ type: 'game:start', reason: 'new', truncatedAt: null });
    enterTurn('new', events, t);
    publish(events, 'newGame', true);
    return { ok: true };
  }

  /**
   * Replays a saved game with natural rules only (5.6); draw rules are applied to the final position alone.
   * @param {SavedGame} saved
   * @returns {Result & {applied:number, truncatedAt:number|null}}
   */
  function restore(saved) {
    if (typeof saved !== 'object' || saved === null || !Array.isArray(saved.moves)) {
      throw new TypeError('session.restore needs a SavedGame with a moves array');
    }
    /** @type {SessionEvent[]} */
    const events = [];
    if (state.trial) events.push({ type: 'trial:end', trial: state.trial, reason: 'newgame' });      // as newGame does
    const t = now();
    /** @type {Color} */
    const humanColor = saved.humanColor === 'black' ? 'black' : 'red';
    const childParity = humanColor === 'red' ? 0 : 1;

    let board = engine.createInitialBoard();
    /** @type {Color} */
    let turn = 'red';
    const startKey = engine.positionKey(board, turn);
    /** @type {Ply[]} */
    const history = [];
    /** @type {number|null} */
    let truncatedAt = null;
    for (let i = 0; i < saved.moves.length; i++) {
      const ref = i < LOAD_MAX_PLIES ? notation.fromMoveCode(saved.moves[i]) : null;
      // The legal move matching ref. A game that is already naturally over has no legal move, so it stops here as well.
      const mover = ref ? board[ref.from.row][ref.from.col] : null;
      const move = ref && mover && mover.color === turn
        ? engine.getPieceLegalMoves(board, ref.from.row, ref.from.col).find(legal => sameSquare(legal.to, ref.to))
        : undefined;
      if (!move) {
        truncatedAt = i;
        break;
      }
      const after = engine.applyMove(board, move);
      const record = engine.plyRecord(board, move);
      const enemy = engine.opposite(turn);
      // flagsOf without its move generation: a ply that is followed by a legal move is not a mate; the last ply is settled below.
      /** @type {MoveFlags} */
      const flags = {
        check: record.check,
        mate: false,
        checkedKing: record.check ? kingSquare(after, enemy) : null,
        checkers: record.check ? engine.checkers(after, enemy) : [],
        crossed: crossedRiver(move),
      };
      history.push({ move, color: turn, by: i % 2 === childParity ? 'child' : 'opponent', notation: notation.moveToNotation(board, move),
                     before: board, record, flags });
      board = after;
      turn = enemy;
    }
    const status = engine.getGameStatus(board, turn);
    const last = history[history.length - 1];
    if (last) last.flags = { ...last.flags, mate: status.over && status.reason === 'checkmate' };

    const savedFrom = typeof saved.drawFrom === 'number' && Number.isInteger(saved.drawFrom) ? saved.drawFrom : 0;
    state.id = typeof saved.id === 'string' && GAME_ID_RE.test(saved.id) ? saved.id : makeId();
    state.gameId += 1;
    state.humanColor = humanColor;
    state.counted = saved.counted === true;
    state.startKey = startKey;
    setPosition(board, turn, history, Math.min(Math.max(savedFrom, 0), history.length));
    state.trial = null;
    state.result = null;
    state.startedAt = finiteOr(saved.startedAt, null) ?? t;
    state.endedAt = finiteOr(saved.endedAt, null);
    state.turnStartedAt = t;
    state.positionId += 1;
    events.push({ type: 'game:start', reason: 'restore', truncatedAt });

    const natural = adjudicate(status);
    const stored = saved.result;
    const resigned = truncatedAt === null && typeof stored === 'object' && stored !== null && stored.reason === 'resign'
      && (stored.winner === 'red' || stored.winner === 'black');
    if (natural) {
      settle(natural);
      state.endedAt ??= t;
    } else if (resigned) {
      settle({ winner: stored.winner, reason: 'resign' });
      state.endedAt ??= t;
    } else {
      state.endedAt = null;
      enterTurn('restore', events, t);
    }
    publish(events, 'restore', truncatedAt !== null);             // a truncated save is rewritten without the bad tail
    return { ok: true, applied: history.length, truncatedAt };
  }

  /** @returns {Pick<SavedGame,'schema'|'id'|'humanColor'|'moves'|'result'|'startedAt'|'endedAt'|'counted'|'drawFrom'|'start'>} */
  function serialize() {
    const result = state.result;
    return {
      schema: 2,
      id: state.id,
      humanColor: state.humanColor,
      moves: state.history.map(ply => notation.moveCode(ply.move)),
      // only a resignation is stored; every other result is recomputed by replay
      result: result && result.reason === 'resign' && result.winner ? { winner: result.winner, reason: 'resign' } : null,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      counted: state.counted,
      drawFrom: state.drawFrom,
      start: null,
    };
  }

  /** The statistics of this game were updated; saved at once so that a reload never counts the game again. @returns {Result} */
  function markCounted() {
    if (state.gameId === 0) return refuse('wrong-phase');
    if (!state.counted) {
      state.counted = true;
      publish([], 'markCounted', true);
    }
    return { ok: true };
  }

  // ---- child intents ------------------------------------------------------------------------------------------

  /** @param {number} row @param {number} col @returns {Result} */
  function select(row, col) {
    requireIntegers(row, col);
    if (state.phase !== 'childTurn' && state.phase !== 'selected') return refuse('wrong-phase');
    const piece = pieceAt(row, col);
    if (!piece) return refuse('empty');
    if (piece.color !== state.humanColor) return refuse('not-yours');
    const all = engine.getPieceLegalMoves(state.board, row, col);
    if (all.length === 0) return refuse('no-moves');
    pickUp(row, col, all);
    state.phase = 'selected';
    publish([{ type: 'selection' }], 'select', false);
    return { ok: true };
  }

  /** @returns {Result} */
  function deselect() {
    if (state.phase !== 'selected') return refuse('wrong-phase');
    clearSelection();
    state.phase = 'childTurn';
    publish([{ type: 'selection' }], 'deselect', false);
    return { ok: true };
  }

  /** @param {MoveRef} move @returns {Result} */
  function tryMove(move) {
    if (state.phase !== 'childTurn' && state.phase !== 'selected' && state.phase !== 'tentative') return refuse('wrong-phase');
    const ref = cleanRef(move);
    if (!ref) return refuse('illegal');
    const chosen = playableMoves().find(playable => sameSquare(playable.from, ref.from) && sameSquare(playable.to, ref.to));
    if (!chosen) {
      const own = pieceAt(ref.from.row, ref.from.col)?.color === state.humanColor;
      const legal = own && engine.getPieceLegalMoves(state.board, ref.from.row, ref.from.col).some(other => sameSquare(other.to, ref.to));
      return refuse(legal ? 'perpetual-check' : 'illegal');
    }
    /** @type {SessionEvent[]} */
    const events = [];
    const replaced = state.trial !== null;
    if (state.trial) events.push({ type: 'trial:end', trial: state.trial, reason: 'replaced' });
    state.trialId += 1;
    state.attempt = state.attempt.first === null
      ? { tries: state.attempt.tries + 1, first: ref, hintAtFirst: state.hint.level }
      : { ...state.attempt, tries: state.attempt.tries + 1 };
    const after = engine.applyMove(state.board, chosen);
    const status = engine.getGameStatus(after, engine.opposite(state.turn));
    const { startKey, log } = rules();
    const judged = engine.judgeMove(startKey, log, state.board, chosen);
    /** @type {Trial} */
    const trial = {
      id: state.trialId,
      move: chosen,
      board: after,
      notation: notation.moveToNotation(state.board, chosen),
      status,
      flags: flagsOf(after, chosen, status),
      // 'forbidden' is playable only when the side has nothing else; committed, it is the third occurrence: a draw
      repeat: judged === 'forbidden' ? 'draw' : judged,
      startedAt: now(),
    };
    state.trial = trial;
    pickUp(chosen.from.row, chosen.from.col, engine.getPieceLegalMoves(state.board, chosen.from.row, chosen.from.col));
    state.phase = 'tentative';
    events.push({ type: 'trial:start', trial, replaced });
    publish(events, 'tryMove', false);
    return { ok: true };
  }

  /** @param {{keepSelection?:boolean}} [opts] @returns {Result} */
  function retract(opts) {
    const trial = state.trial;
    if (state.phase !== 'tentative' || !trial) return refuse('wrong-phase');
    state.trial = null;
    if (opts?.keepSelection === false) {
      clearSelection();
      state.phase = 'childTurn';
    } else {
      state.phase = 'selected';                                  // the trial piece stays picked up, with its targets
    }
    publish([{ type: 'trial:end', trial, reason: 'retract' }, { type: 'selection' }], 'retract', false);
    return { ok: true };
  }

  /** @returns {Result} */
  function confirm() {
    const trial = state.trial;
    if (state.phase !== 'tentative' || !trial) return refuse('wrong-phase');
    const t = now();
    const index = state.history.length;
    /** @type {Ply} */
    const ply = { move: trial.move, color: state.turn, by: 'child', notation: trial.notation, before: state.board,
                  record: engine.plyRecord(state.board, trial.move), flags: trial.flags };
    setPosition(trial.board, engine.opposite(state.turn), [...state.history, ply], state.drawFrom);
    state.positionId += 1;
    state.trial = null;
    /** @type {SessionEvent[]} */
    const events = [{ type: 'move:committed', ply, index, by: 'child', trialId: trial.id }];
    const result = adjudicate(trial.status);
    if (result) finish(result, events, t);
    else enterTurn('confirm', events, t);                        // straight to opponentTurn: there is no confirming phase
    publish(events, 'confirm', true);
    return { ok: true };
  }

  /** @returns {Result & {level?:1|2|3}} */
  function requestHint() {
    if (state.phase === 'tentative') return refuse('trial-active');
    if (state.phase !== 'childTurn' && state.phase !== 'selected') return refuse('wrong-phase');
    if (state.hint.level >= 3) return refuse('wrong-phase');
    const level = state.hint.level === 0 ? 1 : state.hint.level === 1 ? 2 : 3;
    state.hint = { level };
    publish([{ type: 'hint', level }], 'requestHint', false);
    return { ok: true, level };
  }

  /** @returns {Result & {plies?:number, retracted?:boolean}} */
  function undo() {
    if (state.phase === 'tentative') {
      const taken = retract();
      return taken.ok ? { ok: true, retracted: true } : taken;
    }
    const plies = undoCount(state);
    if (plies < 0) return refuse('nothing-to-undo');
    const t = now();
    const unresigned = state.result?.reason === 'resign';
    const keep = state.history.length - plies;
    const popped = state.history.slice(keep);
    if (plies > 0) {
      setPosition(popped[0].before, popped[0].color, state.history.slice(0, keep), Math.min(state.drawFrom, keep));
      state.check = engine.isInCheck(state.board, state.turn);
      state.checkers = state.check ? engine.checkers(state.board, state.turn) : [];
    }
    state.result = null;
    state.endedAt = null;
    state.positionId += 1;
    /** @type {SessionEvent[]} */
    const events = [{ type: 'undo', plies, unresigned, steps: popped.reverse().map(ply => ply.move) }];
    enterTurn('undo', events, t);
    publish(events, 'undo', true);
    return { ok: true, plies };
  }

  /** @returns {Result} */
  function resign() {
    if (state.phase === 'over') return refuse('over');
    const t = now();
    /** @type {SessionEvent[]} */
    const events = [];
    if (state.trial) {
      events.push({ type: 'trial:end', trial: state.trial, reason: 'resign' });
      state.trial = null;
    }
    state.positionId += 1;
    finish({ winner: engine.opposite(state.humanColor), reason: 'resign' }, events, t);      // resignation is always the child's
    publish(events, 'resign', true);
    return { ok: true };
  }

  /** The single entry point for board taps (5.2). @param {number} row @param {number} col @returns {Result} */
  function tapSquare(row, col) {
    requireIntegers(row, col);
    if (state.phase === 'over') return refuse('over');
    if (state.phase === 'opponentTurn') return refuse('not-your-turn');
    const at = { row, col };
    const piece = pieceAt(row, col);
    const own = piece !== null && piece.color === state.humanColor;

    if (state.phase === 'childTurn') {
      if (!piece) return refuse('empty');
      if (!own) return refuse('not-yours');
      return select(row, col);                                   // refuses 'no-moves' itself
    }

    const trial = state.trial;
    if (state.phase === 'tentative' && trial) {
      if (sameSquare(trial.move.to, at)) return confirm();
      if (sameSquare(trial.move.from, at)) return retract();
    } else if (state.selected && sameSquare(state.selected, at)) {
      return deselect();
    } else if (own) {
      return select(row, col);                                   // another own piece; 'no-moves' keeps the current selection
    }

    const target = state.targets.find(move => sameSquare(move.to, at));
    if (target) return tryMove(target);
    if (state.forbidden.some(move => sameSquare(move.to, at))) return refuse('perpetual-check');
    if (state.phase === 'tentative' && own && engine.getPieceLegalMoves(state.board, row, col).length > 0) {
      retract({ keepSelection: false });
      return select(row, col);
    }
    return refuse('not-a-target');                               // a stray tap never discards the selection or the trial
  }

  // ---- async results, called only by the director -------------------------------------------------------------

  /**
   * The apply gate of 6.4: a result for another position is 'stale' whatever the phase is by now; a result for the
   * current position while the rival is not to move is 'wrong-phase' (the blank cells of 5.3).
   * @param {number} positionId @param {MoveRef} move @returns {Result}
   */
  function opponentMove(positionId, move) {
    if (positionId !== state.positionId) return refuse('stale');
    if (state.phase !== 'opponentTurn') return refuse('wrong-phase');
    const ref = cleanRef(move);
    const chosen = ref
      ? engine.getLegalMoves(state.board, state.turn).find(legal => sameSquare(legal.from, ref.from) && sameSquare(legal.to, ref.to))
      : undefined;
    if (!chosen) {
      state.opponentFailed = true;
      publish([{ type: 'opponent:failed' }], 'opponentFailed', false);
      return refuse('illegal');
    }
    const t = now();
    const index = state.history.length;
    const after = engine.applyMove(state.board, chosen);
    const status = engine.getGameStatus(after, engine.opposite(state.turn));
    /** @type {Ply} */
    const ply = { move: chosen, color: state.turn, by: 'opponent', notation: notation.moveToNotation(state.board, chosen), before: state.board,
                  record: engine.plyRecord(state.board, chosen), flags: flagsOf(after, chosen, status) };
    setPosition(after, engine.opposite(state.turn), [...state.history, ply], state.drawFrom);
    state.positionId += 1;
    /** @type {SessionEvent[]} */
    const events = [{ type: 'move:committed', ply, index, by: 'opponent', trialId: 0 }];
    const result = adjudicate(status);
    if (result) finish(result, events, t);
    else enterTurn('opponent-move', events, t);
    publish(events, 'opponentMove', true);
    return { ok: true };
  }

  /** @param {number} positionId @returns {Result} */
  function opponentFailed(positionId) {
    if (positionId !== state.positionId) return refuse('stale');
    if (state.phase !== 'opponentTurn') return refuse('wrong-phase');
    state.opponentFailed = true;
    publish([{ type: 'opponent:failed' }], 'opponentFailed', false);
    return { ok: true };
  }

  /** @returns {Result} */
  function retryOpponent() {
    if (state.phase !== 'opponentTurn' || !state.opponentFailed) return refuse('wrong-phase');
    state.opponentFailed = false;
    publish([{ type: 'opponent:turn', retry: true }], 'retryOpponent', false);
    return { ok: true };
  }

  return {
    getState: () => state,
    scope: currentScope,
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('session.subscribe needs a function');
      const entry = { fn, active: true };
      subscribers = [...subscribers, entry];
      return () => {
        if (!entry.active) return;
        entry.active = false;
        subscribers = subscribers.filter(other => other !== entry);
      };
    },
    newGame,
    restore,
    serialize,
    markCounted,
    tapSquare,
    select,
    deselect,
    tryMove,
    retract,
    confirm,
    requestHint,
    undo,
    resign,
    opponentMove,
    opponentFailed,
    retryOpponent,
  };
}

/**
 * @typedef {Object} Session
 * @property {() => SessionState} getState
 * @property {() => Scope} scope
 * @property {(fn:(event:SessionEvent, state:SessionState) => void) => (() => void)} subscribe     subscribers run in registration order
 * -- lifecycle --
 * @property {(opts?:{humanColor?:Color}) => Result} newGame                 any phase
 * @property {(saved:SavedGame) => Result & {applied:number, truncatedAt:number|null}} restore
 * @property {() => Pick<SavedGame,'schema'|'id'|'humanColor'|'moves'|'result'|'startedAt'|'endedAt'|'counted'|'drawFrom'|'start'>} serialize
 * @property {() => Result} markCounted
 * -- child intents --
 * @property {(row:number, col:number) => Result} tapSquare                  the single entry point for board taps (§5.2)
 * @property {(row:number, col:number) => Result} select
 * @property {() => Result} deselect
 * @property {(move:MoveRef) => Result} tryMove                              childTurn | selected | tentative -> tentative
 * @property {(opts?:{keepSelection?:boolean}) => Result} retract            tentative -> selected (default) | childTurn
 * @property {() => Result} confirm
 * @property {() => Result & {level?:1|2|3}} requestHint
 * @property {() => Result & {plies?:number, retracted?:boolean}} undo
 * @property {() => Result} resign
 * -- async results, called only by the director --
 * @property {(positionId:number, move:MoveRef) => Result} opponentMove
 * @property {(positionId:number) => Result} opponentFailed
 * @property {() => Result} retryOpponent
 */

// pure selectors

/**
 * tentative, or the undo table yields a target
 * @param {SessionState} state
 * @returns {boolean}
 */
export function canUndo(state) {
  return state.phase === 'tentative' || undoCount(state) >= 0;
}

/**
 * phase childTurn | selected, and hint.level < 3
 * @param {SessionState} state
 * @returns {boolean}
 */
export function canHint(state) {
  return (state.phase === 'childTurn' || state.phase === 'selected') && state.hint.level < 3;
}

/**
 * phase childTurn | selected | tentative | over
 * @param {SessionState} state
 * @returns {boolean}
 */
export function canAsk(state) {
  if (state.phase === 'over') return state.result !== null;      // 'over' without a result: no game exists yet
  return state.phase === 'childTurn' || state.phase === 'selected' || state.phase === 'tentative';
}

/**
 * state.trial ? state.trial.board : state.board
 * @param {SessionState} state
 * @returns {Board}
 */
export function displayBoard(state) {
  return state.trial ? state.trial.board : state.board;
}

/**
 * { byRed: Piece[], byBlack: Piece[] }: the pieces each side has captured in the committed game, in the order they fell.
 * @param {SessionState} state
 * @returns {{ byRed: Piece[], byBlack: Piece[] }}
 */
export function capturedPieces(state) {
  /** @type {Piece[]} */
  const byRed = [];
  /** @type {Piece[]} */
  const byBlack = [];
  for (const ply of state.history) {
    const taken = ply.move.captured;
    if (taken) (ply.color === 'red' ? byRed : byBlack).push(taken);
  }
  return { byRed, byBlack };
}

/**
 * boardToFen(state.board, state.turn)
 * @param {SessionState} state
 * @returns {string}
 */
export function fenOf(state) {
  return coreEngine.boardToFen(state.board, state.turn);
}

/**
 * FENs since the last capture, oldest first, excluding the current position.
 * Positions before drawFrom are left out: the draw rules ignore them (3.7), so the search must not count them either.
 * @param {SessionState} state
 * @returns {string[]}
 */
export function historyFens(state) {
  const history = state.history;
  let first = Math.min(Math.max(state.drawFrom, 0), history.length);
  for (let i = history.length - 1; i >= first; i--) {
    if (history[i].record.capture) {
      first = i + 1;
      break;
    }
  }
  /** @type {string[]} */
  const fens = [];
  for (let i = first; i < history.length; i++) fens.push(coreEngine.boardToFen(history[i].before, history[i].color));
  return fens;
}
