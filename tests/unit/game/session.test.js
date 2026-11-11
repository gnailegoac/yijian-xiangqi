// Session tests (SPEC 14.4; the state machine of section 5; restore of 5.6 / 13.4). Real engine, fake clock.
// The first sixteen tests carry the titles of 14.4. The rest prove what the tables imply but 14.4 does not name:
// the state before the first game, the ids, the selectors, select / deselect, markCounted, restore over a trial,
// the trial of a forbidden move that is the only move left, the limits of a save, commands issued from inside
// subscribers, and a random walk that checks the invariants of section 5 after every command.
//
// Expected values come from the contract or are computed here with the rules engine alone (never by the session).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSession, canUndo, canHint, canAsk, displayBoard, capturedPieces, fenOf, historyFens } from '../../../src/game/session.js';
import * as engine from '../../../src/core/engine.js';
import { moveCode, fromMoveCode } from '../../../src/core/notation.js';
import { migrateV1 } from '../../../src/game/store.js';
import { mulberry32 } from '../../helpers/playout.js';

// ---------------------------------------------------------------------------------------------------------------
// fixtures and helpers
// ---------------------------------------------------------------------------------------------------------------

const SAVES = new URL('../../fixtures/saves/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, SAVES), 'utf8'));

const T0 = 1790000000000;                       // startedAt of the fixtures
const NOW = T0 + 100000000;                     // the clock of the tests: 100 000 s later
const START = engine.START_FEN;

const REFUSALS = ['over', 'not-your-turn', 'wrong-phase', 'not-yours', 'no-moves', 'not-a-target', 'empty', 'perpetual-check', 'trial-active',
                  'illegal', 'stale', 'nothing-to-undo'];
const SAVE_KEYS = ['schema', 'id', 'humanColor', 'moves', 'result', 'startedAt', 'endedAt', 'counted', 'drawFrom', 'start'];
const FRESH_ATTEMPT = { tries: 0, first: null, hintAtFirst: 0 };

// 1. 炮二平五 马8进7
const OPENING = ['7774', '0726'];
// 重炮: 炮二平五, 炮五进四 (takes the centre pawn), 炮八进二, 炮八平五 mates while black shuffles a rook. The first six
// plies are tests/fixtures/saves/v2-one-before-mate.json.
const MATE = ['7774', '0010', '7434', '1000', '7151', '0010', '5154'];
// A red rook chases the black king between (1,4) and (2,4), checking with every move. After these twelve plies red is
// to move and 车四退一 (2515) would bring the position after ply 5 back for the third time: forbidden (Appendix A4 rule 2).
const PERPETUAL = ['9888', '0414', '8885', '3040', '8515', '1424', '1525', '2414', '2515', '1424', '1525', '2414'];
// Both rooks step out and back: the start position returns after ply 4 and, for the third time, after ply 8.
const SHUFFLE = ['9080', '0010', '8090', '1000', '9080', '0010', '8090', '1000'];

const ref = (code) => {
  const move = fromMoveCode(code);
  assert.ok(move, `bad move code ${code}`);
  return move;
};
const at = (row, col) => ({ row, col });

function label(event) {
  if (event.type === 'trial:end') return `trial:end(${event.reason})`;
  if (event.type === 'opponent:turn') return event.retry ? 'opponent:turn(retry)' : 'opponent:turn';
  if (event.type === 'change') return event.persist ? 'change(persist)' : 'change';
  return event.type;
}

/**
 * A session on a fake clock with deterministic ids and one recording subscriber.
 * take() returns the events since the last take(); labels() the same as one line in the notation of 5.7.
 */
function rig({ humanColor = null, deps = {} } = {}) {
  const clock = { t: NOW };
  let ids = 0;
  const session = createSession({ now: () => clock.t, makeId: () => `g-test${String(++ids).padStart(4, '0')}`, ...deps });
  const events = [];
  let strayStates = 0;
  session.subscribe((event, state) => {
    events.push(event);
    if (state !== session.getState()) strayStates++;
  });
  const take = () => {
    assert.equal(strayStates, 0, 'every subscriber call carries the live state');
    return events.splice(0);
  };
  const labels = () => take().map(label).join(' ');
  if (humanColor) {
    assert.deepEqual(session.newGame({ humanColor }), { ok: true });
    take();
  }
  return { session, clock, take, labels, state: () => session.getState() };
}

function child(session, code) {
  assert.deepEqual(session.tryMove(ref(code)), { ok: true }, `tryMove ${code}`);
  assert.deepEqual(session.confirm(), { ok: true }, `confirm ${code}`);
}
function rival(session, code) {
  assert.deepEqual(session.opponentMove(session.getState().positionId, ref(code)), { ok: true }, `opponentMove ${code}`);
}
/** Plays the codes in order; who plays each one follows from the phase. */
function play(session, codes) {
  for (const code of codes) {
    if (session.getState().phase === 'opponentTurn') rival(session, code);
    else child(session, code);
  }
}

function saved(over = {}) {
  return { schema: 2, id: 'g-saved001', humanColor: 'red', moves: [], result: null, startedAt: T0, endedAt: null, activeMs: 0, counted: false,
           drawFrom: 0, seed: 7, skill: null, memory: null, start: null, ...over };
}

/** Everything a refused command must leave alone, as one comparable string. */
function view(s) {
  return JSON.stringify({
    id: s.id, ids: [s.gameId, s.positionId, s.trialId], phase: s.phase, fen: engine.boardToFen(s.board, s.turn), human: s.humanColor,
    moves: s.history.map(ply => moveCode(ply.move)), drawFrom: s.drawFrom, selected: s.selected,
    targets: s.targets.map(moveCode), forbidden: s.forbidden.map(moveCode), trial: s.trial && [s.trial.id, moveCode(s.trial.move)],
    hint: s.hint, attempt: s.attempt, result: s.result, check: s.check, checkers: s.checkers, failed: s.opponentFailed, counted: s.counted,
    times: [s.startedAt, s.endedAt, s.turnStartedAt],
  });
}

/** The command is refused with `reason`, emits nothing and changes nothing. */
function refused(r, command, reason, note = '') {
  const before = view(r.state());
  const scope = r.session.scope();
  const result = command();
  assert.deepEqual(result, { ok: false, reason }, note);
  assert.equal(view(r.state()), before, `${note} a refusal changes nothing`);
  assert.deepEqual(r.session.scope(), scope);
  assert.deepEqual(r.take(), [], `${note} a refusal emits nothing`);
}

/** The board, the side to move and the records after playing `codes` from the start, by the rules engine alone. */
function replay(codes) {
  let board = engine.createInitialBoard();
  let turn = 'red';
  const records = [];
  for (const code of codes) {
    const move = ref(code);
    assert.ok(engine.getLegalMoves(board, turn).some(m => moveCode(m) === code), `${code} is legal`);
    records.push(engine.plyRecord(board, move));
    board = engine.applyMove(board, move);
    turn = engine.opposite(turn);
  }
  return { board, turn, records, fen: engine.boardToFen(board, turn) };
}

/** flagsOf of 5.4, written from the contract. */
function flagsByTheBook(before, move) {
  const after = engine.applyMove(before, move);
  const piece = before[move.from.row][move.from.col];
  const enemy = engine.opposite(piece.color);
  const st = engine.getGameStatus(after, enemy);
  let king = null;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (after[row][col]?.type === 'king' && after[row][col].color === enemy) king = { row, col };
    }
  }
  const crossed = piece.type === 'pawn' && (piece.color === 'red' ? move.from.row >= 5 && move.to.row <= 4 : move.from.row <= 4 && move.to.row >= 5);
  return { check: st.check, mate: st.over && st.reason === 'checkmate', checkedKing: st.check ? king : null,
           checkers: st.check ? engine.checkers(after, enemy) : [], crossed };
}

/** The draw-rule inputs of 4.2 for a state. */
function drawWindow(s) {
  return {
    startKey: s.drawFrom === 0 ? s.startKey : s.history[s.drawFrom - 1].record.key,
    log: s.history.slice(s.drawFrom).map(ply => ply.record),
  };
}

/** adjudicate of 5.4 for the committed position of a state, written from the contract (draw rules count from drawFrom). */
function naturalResult(s) {
  const st = engine.getGameStatus(s.board, s.turn);
  if (st.over) return { winner: st.winner, reason: st.reason === 'king-captured' ? 'checkmate' : st.reason };
  const { startKey, log } = drawWindow(s);
  const draw = engine.drawStatus(startKey, log, s.board, s.history.length - s.drawFrom);
  if (draw.draw) return { winner: null, reason: draw.reason };
  if (s.history.length >= 2000) return { winner: null, reason: 'move_limit' };      // a save holds at most 2000 moves (3.9)
  return null;
}

/** What a save must bring back: the committed game, without the trial, the selection, the pouches and the ids. */
function truth(s) {
  return {
    id: s.id,
    humanColor: s.humanColor,
    phase: s.phase === 'selected' || s.phase === 'tentative' ? 'childTurn' : s.phase,
    board: s.board,
    turn: s.turn,
    startKey: s.startKey,
    drawFrom: s.drawFrom,
    history: s.history.map(ply => ({ ...ply, before: engine.boardToFen(ply.before, ply.color) })),
    result: s.result,
    check: s.check,
    checkers: s.checkers,
    counted: s.counted,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
  };
}

/** serialize, through JSON, into a fresh session: the restored session. */
function reload(session) {
  const record = JSON.parse(JSON.stringify(session.serialize()));
  const copy = createSession({ now: () => NOW + 5, makeId: () => 'g-reloaded' });
  const result = copy.restore({ ...record, activeMs: 0, seed: 1, skill: null, memory: null });
  return { record, copy, result };
}

/**
 * A legal game of `plies` plies from the start position, by the rules engine alone (seeded, deterministic).
 * No ply ends the game by mate or stalemate. With `drawFree`, no draw rule of Appendix A4 holds after any ply either:
 * no position occurs twice between captures and a capture comes before the 120th quiet ply. With `quiet`, nothing is
 * captured as long as a quiet move exists, so both sides keep their attackers.
 */
function longGame(plies, { seed = 1, drawFree = true, quiet: keep = false } = {}) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = mulberry32(seed + attempt);
    let board = engine.createInitialBoard();
    let turn = 'red';
    const startKey = engine.positionKey(board, turn);
    const log = [];
    const codes = [];
    let legal = engine.getLegalMoves(board, turn);
    let quiet = 0;
    while (codes.length < plies) {
      const captures = legal.filter(m => m.captured);
      const quietMoves = legal.filter(m => !m.captured);
      let pool = legal;
      if (drawFree && quiet >= 80 && captures.length > 0) pool = captures;                // a capture restarts the 120-ply count
      else if ((keep || (drawFree && quiet < 80)) && quietMoves.length > 0) pool = quietMoves;      // keep the material
      let chosen = null;
      let replies = null;
      for (let tries = 0; tries < 40 && !chosen; tries++) {
        const move = pool[Math.floor(rng() * pool.length)];
        if (drawFree && engine.judgeMove(startKey, log, board, move) !== 'ok') continue;
        if (drawFree && !move.captured && quiet + 1 >= 120) continue;
        const next = engine.getLegalMoves(engine.applyMove(board, move), engine.opposite(turn));
        if (next.length === 0) continue;                                                  // would end the game
        chosen = move;
        replies = next;
      }
      if (!chosen) break;
      log.push(engine.plyRecord(board, chosen));
      codes.push(moveCode(chosen));
      quiet = chosen.captured ? 0 : quiet + 1;
      board = engine.applyMove(board, chosen);
      turn = engine.opposite(turn);
      legal = replies;
    }
    if (codes.length === plies) return codes;
  }
  throw new Error(`no legal game of ${plies} plies found`);
}

/** A session in the given phase, two plies into a game as red (1. 炮二平五 马8进7), with the events so far discarded. */
function inPhase(phase) {
  const r = rig({ humanColor: 'red' });
  play(r.session, OPENING);
  if (phase === 'selected' || phase === 'tentative' || phase === 'opponentTurn') r.session.select(9, 7);
  if (phase === 'tentative' || phase === 'opponentTurn') r.session.tryMove(ref('9776'));
  if (phase === 'opponentTurn') r.session.confirm();
  if (phase === 'over') r.session.resign();
  r.take();
  assert.equal(r.state().phase, phase);
  return r;
}
const PHASES = ['childTurn', 'selected', 'tentative', 'opponentTurn', 'over'];

/** Red to move with the rook on (2,5); its move to (1,5) is forbidden by the perpetual-check rule. */
function perpetualRig() {
  const r = rig({ humanColor: 'red' });
  play(r.session, PERPETUAL);
  r.take();
  assert.equal(r.state().phase, 'childTurn');
  return r;
}

/** Red to move after 1. 帅五进一 马8进7: the advisors on (9,3) and (9,5) have no legal move. */
function stuckAdvisorRig() {
  const r = rig({ humanColor: 'red' });
  play(r.session, ['9484', '0726']);
  r.take();
  assert.deepEqual(engine.getPieceLegalMoves(r.state().board, 9, 3), []);
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// 14.4
// ---------------------------------------------------------------------------------------------------------------

test('the batches of 5.7 verbatim', () => {
  // newGame (red)        scope  game:start  child:turn  change(persist)
  let r = rig();
  assert.deepEqual(r.session.newGame({ humanColor: 'red' }), { ok: true });
  let events = r.take();
  assert.equal(events.map(label).join(' '), 'scope game:start child:turn change(persist)');
  assert.deepEqual(events[0], { type: 'scope', scope: { game: 1, position: 1, trial: 0 } });
  assert.deepEqual(events[1], { type: 'game:start', reason: 'new', truncatedAt: null });
  assert.deepEqual(events[2], { type: 'child:turn', cause: 'new' });
  assert.equal(typeof events[3].cause, 'string');

  // newGame (black)      scope  game:start  opponent:turn  change(persist)
  r = rig();
  r.session.newGame({ humanColor: 'black' });
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope game:start opponent:turn change(persist)');
  assert.deepEqual(events[2], { type: 'opponent:turn', retry: false });

  // restore              scope  game:start  [child:turn | opponent:turn]  change(persist iff truncated)
  r = rig();
  r.session.restore(saved({ moves: OPENING }));
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope game:start child:turn change');
  assert.deepEqual(events[1], { type: 'game:start', reason: 'restore', truncatedAt: null });
  assert.deepEqual(events[2], { type: 'child:turn', cause: 'restore' });
  r.session.restore(saved({ moves: ['7774'] }));
  assert.equal(r.labels(), 'scope game:start opponent:turn change');
  r.session.restore(saved({ moves: MATE }));
  assert.equal(r.labels(), 'scope game:start change', 'a finished game: no turn and no game:over');
  r.session.restore(saved({ moves: ['7774', '0726', '0000'] }));
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope game:start child:turn change(persist)', 'a truncated save is rewritten');
  assert.equal(events[1].truncatedAt, 2);

  // select / deselect    selection  change
  r = rig({ humanColor: 'red' });
  r.session.select(7, 7);
  assert.equal(r.labels(), 'selection change');
  r.session.deselect();
  assert.equal(r.labels(), 'selection change');

  // tryMove              scope  trial:start  change
  r.session.tryMove(ref('7774'));
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:start change');
  const first = r.state().trial;
  assert.deepEqual(events[0].scope, { game: 1, position: 1, trial: first.id });
  assert.equal(events[1].trial, first);
  assert.equal(events[1].replaced, false);

  // tryMove (replace)    scope  trial:end(replaced)  trial:start  change
  r.session.tryMove(ref('7775'));
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:end(replaced) trial:start change');
  assert.equal(events[1].trial, first);
  assert.equal(events[2].trial, r.state().trial);
  assert.equal(events[2].replaced, true);

  // retract              scope  trial:end(retract)  selection  change
  const second = r.state().trial;
  r.session.retract();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:end(retract) selection change');
  assert.equal(events[0].scope.trial, 0);
  assert.equal(events[1].trial, second);

  // confirm              scope  move:committed  opponent:turn  change(persist)
  r.session.tryMove(ref('7774'));
  const trialId = r.state().trial.id;
  r.take();
  r.session.confirm();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope move:committed opponent:turn change(persist)');
  assert.deepEqual(events[0].scope, { game: 1, position: 2, trial: 0 });
  assert.equal(events[1].ply, r.state().history[0]);
  assert.deepEqual({ index: events[1].index, by: events[1].by, trialId: events[1].trialId }, { index: 0, by: 'child', trialId });
  assert.deepEqual(events[2], { type: 'opponent:turn', retry: false });

  // opponentFailed       opponent:failed  change
  r.session.opponentFailed(r.state().positionId);
  assert.equal(r.labels(), 'opponent:failed change');

  // retryOpponent        opponent:turn(retry)  change
  r.session.retryOpponent();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'opponent:turn(retry) change');
  assert.deepEqual(events[0], { type: 'opponent:turn', retry: true });

  // opponentMove         scope  move:committed  child:turn | game:over  change(persist)
  r.session.opponentMove(r.state().positionId, ref('0726'));
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope move:committed child:turn change(persist)');
  assert.deepEqual({ index: events[1].index, by: events[1].by, trialId: events[1].trialId }, { index: 1, by: 'opponent', trialId: 0 });
  assert.deepEqual(events[2], { type: 'child:turn', cause: 'opponent-move' });

  // requestHint          hint  change
  r.session.requestHint();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'hint change');
  assert.deepEqual(events[0], { type: 'hint', level: 1 });

  // undo                 scope  undo  child:turn  change(persist)
  r.session.undo();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope undo child:turn change(persist)');
  assert.deepEqual(events[2], { type: 'child:turn', cause: 'undo' });

  // resign               scope  [trial:end(resign)]  game:over  change(persist)
  r.session.resign();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope game:over change(persist)');
  assert.deepEqual(events[1], { type: 'game:over', result: { winner: 'black', reason: 'resign' } });
  r = inPhase('tentative');
  const dropped = r.state().trial;
  r.session.resign();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:end(resign) game:over change(persist)');
  assert.equal(events[1].trial, dropped);

  // confirm (ends game)  scope  move:committed  game:over  change(persist)
  r = rig();
  r.session.restore(saved({ moves: MATE.slice(0, 6) }));
  r.session.tryMove(ref(MATE[6]));
  r.take();
  r.session.confirm();
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope move:committed game:over change(persist)');
  assert.deepEqual(events[2], { type: 'game:over', result: { winner: 'red', reason: 'checkmate' } });

  // opponentMove that ends the game
  r = rig();
  r.session.restore(saved({ humanColor: 'black', moves: MATE.slice(0, 6) }));
  r.take();
  r.session.opponentMove(r.state().positionId, ref(MATE[6]));
  assert.equal(r.labels(), 'scope move:committed game:over change(persist)');

  // newGame with a trial on the board (CONTRACT-NOTES item 74): the trial ends first, as in the resign row
  r = inPhase('tentative');
  const open = r.state().trial;
  r.session.newGame({ humanColor: 'red' });
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:end(newgame) game:start child:turn change(persist)');
  assert.equal(events[1].trial, open);
  r = inPhase('tentative');
  r.session.newGame({ humanColor: 'black' });
  assert.equal(r.labels(), 'scope trial:end(newgame) game:start opponent:turn change(persist)');
});

test('every row of the tapSquare table', () => {
  // childTurn | own piece with playable or forbidden moves | select -> selected
  let r = inPhase('childTurn');
  assert.deepEqual(r.session.tapSquare(9, 7), { ok: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.state().selected, at(9, 7));
  assert.deepEqual(r.state().targets, engine.getPieceLegalMoves(r.state().board, 9, 7));
  assert.deepEqual(r.state().targets.map(moveCode).sort(), ['9776', '9778']);
  assert.deepEqual(r.state().forbidden, []);
  assert.equal(r.labels(), 'selection change');

  // childTurn | own piece with no legal move at all | refuse no-moves
  r = stuckAdvisorRig();
  refused(r, () => r.session.tapSquare(9, 3), 'no-moves');

  // childTurn | enemy piece / empty | refuse not-yours / empty
  r = inPhase('childTurn');
  refused(r, () => r.session.tapSquare(0, 0), 'not-yours');
  refused(r, () => r.session.tapSquare(5, 5), 'empty');

  // selected | the selected piece | deselect -> childTurn
  r = inPhase('selected');
  assert.deepEqual(r.session.tapSquare(9, 7), { ok: true });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual([r.state().selected, r.state().targets, r.state().forbidden], [null, [], []]);
  assert.equal(r.labels(), 'selection change');

  // selected | another own piece | select it (stay selected)
  r = inPhase('selected');
  assert.deepEqual(r.session.tapSquare(9, 1), { ok: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.state().selected, at(9, 1));
  assert.deepEqual(r.state().targets, engine.getPieceLegalMoves(r.state().board, 9, 1));
  assert.equal(r.labels(), 'selection change');
  // ... and when that piece cannot move, the refusal keeps the selection
  r = stuckAdvisorRig();
  r.session.select(9, 7);
  r.take();
  refused(r, () => r.session.tapSquare(9, 3), 'no-moves');
  assert.deepEqual(r.state().selected, at(9, 7));

  // selected | a playable target | tryMove -> tentative
  r = inPhase('selected');
  assert.deepEqual(r.session.tapSquare(7, 6), { ok: true });
  assert.equal(r.state().phase, 'tentative');
  assert.equal(moveCode(r.state().trial.move), '9776');
  assert.equal(r.labels(), 'scope trial:start change');

  // selected | a forbidden target (perpetual check) | refuse perpetual-check (stay)
  r = perpetualRig();
  r.session.tapSquare(2, 5);
  r.take();
  refused(r, () => r.session.tapSquare(1, 5), 'perpetual-check');
  assert.equal(r.state().phase, 'selected');

  // selected | anything else | refuse not-a-target (stay)
  r = inPhase('selected');
  refused(r, () => r.session.tapSquare(5, 5), 'not-a-target', 'an empty point');
  refused(r, () => r.session.tapSquare(0, 0), 'not-a-target', 'an enemy piece out of reach');
  assert.equal(r.state().phase, 'selected');

  // tentative | the trial's destination square | confirm()
  r = inPhase('tentative');
  assert.deepEqual(r.session.tapSquare(7, 6), { ok: true });
  assert.equal(r.state().phase, 'opponentTurn');
  assert.equal(r.state().history.length, 3);
  assert.equal(r.labels(), 'scope move:committed opponent:turn change(persist)');

  // tentative | the trial's origin square | retract() -> selected (same piece)
  r = inPhase('tentative');
  assert.deepEqual(r.session.tapSquare(9, 7), { ok: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.state().selected, at(9, 7));
  assert.equal(r.state().trial, null);
  assert.equal(r.labels(), 'scope trial:end(retract) selection change');

  // tentative | another playable target of the same piece | tryMove (replace): new trialId
  r = inPhase('tentative');
  const oldId = r.state().trial.id;
  assert.deepEqual(r.session.tapSquare(7, 8), { ok: true });
  assert.equal(r.state().phase, 'tentative');
  assert.equal(moveCode(r.state().trial.move), '9778');
  assert.equal(r.state().trial.id, oldId + 1);
  assert.equal(r.state().trialId, oldId + 1);
  assert.equal(r.labels(), 'scope trial:end(replaced) trial:start change');

  // tentative | a forbidden target of the same piece | refuse perpetual-check (the trial stays)
  r = perpetualRig();
  r.session.tryMove(ref('2535'));
  r.take();
  refused(r, () => r.session.tapSquare(1, 5), 'perpetual-check');
  assert.equal(moveCode(r.state().trial.move), '2535');

  // tentative | another own piece with moves | retract({keepSelection:false}) then select -> selected
  r = inPhase('tentative');
  assert.deepEqual(r.session.tapSquare(9, 1), { ok: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.state().selected, at(9, 1));
  assert.deepEqual(r.state().targets, engine.getPieceLegalMoves(r.state().board, 9, 1));
  assert.equal(r.state().trial, null);
  assert.equal(r.labels(), 'scope trial:end(retract) selection change selection change', 'the retract batch, then the select batch');

  // tentative | anything else | refuse not-a-target (a stray tap never discards the trial)
  r = inPhase('tentative');
  refused(r, () => r.session.tapSquare(5, 5), 'not-a-target', 'an empty point');
  refused(r, () => r.session.tapSquare(0, 0), 'not-a-target', 'an enemy piece');
  assert.equal(moveCode(r.state().trial.move), '9776');
  r = stuckAdvisorRig();
  r.session.tryMove(ref('9776'));
  r.take();
  refused(r, () => r.session.tapSquare(9, 3), 'not-a-target', 'an own piece that cannot move');

  // opponentTurn | any | refuse not-your-turn
  r = inPhase('opponentTurn');
  for (const [row, col] of [[9, 1], [0, 0], [5, 5], [7, 6]]) refused(r, () => r.session.tapSquare(row, col), 'not-your-turn');

  // over | any | refuse over
  r = inPhase('over');
  for (const [row, col] of [[9, 1], [0, 0], [5, 5]]) refused(r, () => r.session.tapSquare(row, col), 'over');
});

test('every row of the command table', () => {
  let r;

  // tryMove(m)                 -> tentative | -> tentative | replace -> tentative | wrong-phase | wrong-phase
  r = inPhase('childTurn');
  assert.deepEqual(r.session.tryMove(ref('9172')), { ok: true });
  assert.equal(r.state().phase, 'tentative');
  assert.deepEqual(r.state().selected, at(9, 1));
  assert.deepEqual(r.state().targets, engine.getPieceLegalMoves(r.state().board, 9, 1));
  assert.equal(r.labels(), 'scope trial:start change');
  r = inPhase('selected');
  assert.deepEqual(r.session.tryMove(ref('9172')), { ok: true });
  assert.equal(r.state().phase, 'tentative');
  assert.deepEqual(r.state().selected, at(9, 1), 'the selection follows the trial piece');
  assert.equal(r.labels(), 'scope trial:start change');
  r = inPhase('tentative');
  assert.deepEqual(r.session.tryMove(ref('9172')), { ok: true });
  assert.equal(r.state().phase, 'tentative');
  assert.equal(moveCode(r.state().trial.move), '9172');
  assert.equal(r.labels(), 'scope trial:end(replaced) trial:start change');
  for (const phase of ['opponentTurn', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.tryMove(ref('9172')), 'wrong-phase', phase);
  }
  // a move that is not a playable move of the child
  r = inPhase('childTurn');
  refused(r, () => r.session.tryMove(ref('9171')), 'illegal', 'not a horse move');
  refused(r, () => r.session.tryMove(ref('2627')), 'illegal', 'a move of the rival');
  refused(r, () => r.session.tryMove(ref('5545')), 'illegal', 'from an empty point');
  refused(r, () => r.session.tryMove({ from: at(9, 1) }), 'illegal', 'not a move reference');
  refused(r, () => r.session.tryMove(null), 'illegal', 'not a move reference');

  // retract()                  wrong-phase | wrong-phase | -> selected, or childTurn | wrong-phase | wrong-phase
  for (const phase of ['childTurn', 'selected', 'opponentTurn', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.retract(), 'wrong-phase', phase);
  }
  r = inPhase('tentative');
  const targets = r.state().targets;
  assert.deepEqual(r.session.retract(), { ok: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.state().selected, at(9, 7));
  assert.deepEqual(r.state().targets, targets);
  assert.equal(r.state().trial, null);
  r = inPhase('tentative');
  assert.deepEqual(r.session.retract({ keepSelection: false }), { ok: true });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual([r.state().selected, r.state().targets, r.state().forbidden, r.state().trial], [null, [], [], null]);
  assert.equal(r.labels(), 'scope trial:end(retract) selection change');

  // confirm()                  wrong-phase | wrong-phase | -> opponentTurn, or over | wrong-phase | wrong-phase
  for (const phase of ['childTurn', 'selected', 'opponentTurn', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.confirm(), 'wrong-phase', phase);
  }
  r = inPhase('tentative');
  assert.deepEqual(r.session.confirm(), { ok: true });
  assert.equal(r.state().phase, 'opponentTurn');
  r = rig();
  r.session.restore(saved({ moves: MATE.slice(0, 6) }));
  r.session.tryMove(ref(MATE[6]));
  assert.deepEqual(r.session.confirm(), { ok: true });
  assert.equal(r.state().phase, 'over');

  // requestHint()              level+1 (wrong-phase at 3) | level+1 | trial-active | wrong-phase | wrong-phase
  for (const phase of ['childTurn', 'selected']) {
    r = inPhase(phase);
    for (const level of [1, 2, 3]) {
      assert.deepEqual(r.session.requestHint(), { ok: true, level }, phase);
      assert.deepEqual(r.state().hint, { level });
      assert.equal(r.state().phase, phase);
      assert.equal(r.labels(), 'hint change');
    }
    refused(r, () => r.session.requestHint(), 'wrong-phase', `${phase} at level 3`);
  }
  r = inPhase('tentative');
  refused(r, () => r.session.requestHint(), 'trial-active');
  for (const phase of ['opponentTurn', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.requestHint(), 'wrong-phase', phase);
  }

  // opponentMove(pos, m)       wrong-phase x3 | -> childTurn or over (stale on a position mismatch) | wrong-phase
  for (const phase of ['childTurn', 'selected', 'tentative', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.opponentMove(r.state().positionId, ref('0010')), 'wrong-phase', phase);
  }
  r = inPhase('opponentTurn');
  refused(r, () => r.session.opponentMove(r.state().positionId - 1, ref('0010')), 'stale');
  assert.deepEqual(r.session.opponentMove(r.state().positionId, ref('0010')), { ok: true });
  assert.equal(r.state().phase, 'childTurn');
  assert.equal(r.state().history.length, 4);
  r = rig();
  r.session.restore(saved({ humanColor: 'black', moves: MATE.slice(0, 6) }));
  assert.deepEqual(r.session.opponentMove(r.state().positionId, ref(MATE[6])), { ok: true });
  assert.equal(r.state().phase, 'over');
  assert.deepEqual(r.state().result, { winner: 'red', reason: 'checkmate' });

  // opponentFailed(pos)        wrong-phase x3 | flag set, stay | wrong-phase
  for (const phase of ['childTurn', 'selected', 'tentative', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.opponentFailed(r.state().positionId), 'wrong-phase', phase);
  }
  r = inPhase('opponentTurn');
  refused(r, () => r.session.opponentFailed(r.state().positionId + 1), 'stale');
  const positionId = r.state().positionId;
  assert.deepEqual(r.session.opponentFailed(positionId), { ok: true });
  assert.equal(r.state().opponentFailed, true);
  assert.equal(r.state().phase, 'opponentTurn');
  assert.equal(r.state().positionId, positionId);
  assert.equal(r.labels(), 'opponent:failed change');

  // retryOpponent()            wrong-phase x3 | (only if flagged) clear the flag, re-emit opponent:turn {retry:true} | wrong-phase
  assert.deepEqual(r.session.retryOpponent(), { ok: true });
  assert.equal(r.state().opponentFailed, false);
  assert.equal(r.state().phase, 'opponentTurn');
  assert.equal(r.labels(), 'opponent:turn(retry) change');
  refused(r, () => r.session.retryOpponent(), 'wrong-phase', 'not flagged');
  for (const phase of ['childTurn', 'selected', 'tentative', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.retryOpponent(), 'wrong-phase', phase);
  }

  // undo()                     5.5 | 5.5 | = retract() | pop 1 | 5.5
  r = inPhase('tentative');
  assert.deepEqual(r.session.undo(), { ok: true, retracted: true });
  assert.equal(r.state().phase, 'selected');
  r = inPhase('opponentTurn');
  assert.deepEqual(r.session.undo(), { ok: true, plies: 1 });
  assert.equal(r.state().phase, 'childTurn');
  assert.equal(r.state().history.length, 2);
  for (const phase of ['childTurn', 'selected']) {
    r = inPhase(phase);
    assert.deepEqual(r.session.undo(), { ok: true, plies: 2 }, phase);
    assert.equal(r.state().history.length, 0);
  }
  r = inPhase('over');
  assert.deepEqual(r.session.undo(), { ok: true, plies: 0 });
  assert.equal(r.state().phase, 'childTurn');

  // resign()                   -> over | -> over | drop trial -> over | -> over | refuse over
  for (const phase of ['childTurn', 'selected', 'tentative', 'opponentTurn']) {
    r = inPhase(phase);
    const before = r.state().positionId;
    r.clock.t = NOW + 777;
    assert.deepEqual(r.session.resign(), { ok: true }, phase);
    const s = r.state();
    assert.equal(s.phase, 'over');
    assert.deepEqual(s.result, { winner: 'black', reason: 'resign' }, 'resignation is always the child\'s');
    assert.equal(s.endedAt, NOW + 777);
    assert.equal(s.positionId, before + 1, 'the result changed');
    assert.deepEqual([s.trial, s.selected, s.targets, s.forbidden, s.opponentFailed], [null, null, [], [], false]);
    assert.equal(r.labels(), phase === 'tentative' ? 'scope trial:end(resign) game:over change(persist)' : 'scope game:over change(persist)');
  }
  r = inPhase('over');
  refused(r, () => r.session.resign(), 'over');
  r = rig({ humanColor: 'black' });
  r.session.resign();
  assert.deepEqual(r.state().result, { winner: 'red', reason: 'resign' });

  // newGame(opts)              new game | new game | drop trial, new game | new game | new game
  for (const phase of PHASES) {
    r = inPhase(phase);
    r.session.requestHint();
    r.session.markCounted();
    r.take();
    const old = { ...r.state() };
    r.clock.t = NOW + 999;
    assert.deepEqual(r.session.newGame({ humanColor: 'black' }), { ok: true }, phase);
    const s = r.state();
    assert.equal(s.phase, 'opponentTurn', 'black: the rival opens');
    assert.equal(s.humanColor, 'black');
    assert.equal(fenOf(s), START);
    assert.equal(s.startKey, START);
    assert.deepEqual([s.history, s.drawFrom, s.selected, s.targets, s.forbidden, s.trial, s.result], [[], 0, null, [], [], null, null]);
    assert.deepEqual([s.hint, s.attempt, s.check, s.checkers, s.opponentFailed, s.counted], [{ level: 0 }, FRESH_ATTEMPT, false, [], false, false]);
    assert.deepEqual([s.startedAt, s.endedAt, s.turnStartedAt], [NOW + 999, null, NOW + 999]);
    assert.deepEqual([s.gameId, s.positionId, s.trialId], [old.gameId + 1, old.positionId + 1, old.trialId], 'ids never go back');
    assert.notEqual(s.id, old.id);
    assert.match(s.id, /^g-[a-z0-9]{6,16}$/);
    assert.equal(r.labels(), phase === 'tentative' ? 'scope trial:end(newgame) game:start opponent:turn change(persist)'
      : 'scope game:start opponent:turn change(persist)');
    // without a side the child keeps the side of the last game
    r.session.newGame();
    assert.equal(r.state().humanColor, 'black');
    r.session.newGame({ humanColor: 'red' });
    assert.equal(r.state().phase, 'childTurn');
  }
  // a game left in check starts clean, and a side that is no side changes nothing
  r = rig({ humanColor: 'black' });
  play(r.session, PERPETUAL.slice(0, 5));
  assert.equal(r.state().check, true);
  r.session.newGame({ humanColor: 'green' });
  assert.deepEqual([r.state().humanColor, r.state().check, r.state().checkers, r.state().phase], ['black', false, [], 'opponentTurn']);
});

test('every row of the undo table', () => {
  // tentative | identical to retract(): {ok:true, retracted:true}, no ply removed, no undo event
  let r = inPhase('tentative');
  const positionId = r.state().positionId;
  assert.deepEqual(r.session.undo(), { ok: true, retracted: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.state().selected, at(9, 7));
  assert.equal(r.state().history.length, 2);
  assert.equal(r.state().positionId, positionId);
  assert.equal(r.labels(), 'scope trial:end(retract) selection change');

  // childTurn / selected, last ply by the rival, history.length >= 2 | pop 2 plies
  for (const phase of ['childTurn', 'selected']) {
    r = rig({ humanColor: 'red' });
    play(r.session, [...OPENING, '9776', '0010']);
    if (phase === 'selected') r.session.select(9, 1);
    r.session.requestHint();
    r.take();
    const before = r.state().positionId;
    r.clock.t = NOW + 50;
    assert.deepEqual(r.session.undo(), { ok: true, plies: 2 }, phase);
    const s = r.state();
    assert.equal(s.phase, 'childTurn');
    assert.deepEqual(s.history.map(ply => moveCode(ply.move)), OPENING);
    assert.equal(fenOf(s), replay(OPENING).fen);
    assert.equal(s.positionId, before + 1);
    assert.deepEqual([s.selected, s.targets, s.forbidden, s.hint, s.attempt], [null, [], [], { level: 0 }, FRESH_ATTEMPT]);
    assert.deepEqual([s.result, s.endedAt, s.turnStartedAt], [null, null, NOW + 50]);
    const events = r.take();
    assert.equal(events.map(label).join(' '), 'scope undo child:turn change(persist)');
    assert.deepEqual({ plies: events[1].plies, unresigned: events[1].unresigned }, { plies: 2, unresigned: false });
    assert.deepEqual(events[1].steps.map(moveCode), ['0010', '9776'], 'the popped moves, newest first');
  }

  // childTurn / selected, history.length === 0, or === 1 with the rival's opening move (child plays black) | refuse nothing-to-undo
  r = rig({ humanColor: 'red' });
  refused(r, () => r.session.undo(), 'nothing-to-undo', 'no move yet');
  r.session.select(7, 7);
  r.take();
  refused(r, () => r.session.undo(), 'nothing-to-undo', 'no move yet, a piece picked up');
  r = rig({ humanColor: 'black' });
  rival(r.session, '7774');
  r.take();
  refused(r, () => r.session.undo(), 'nothing-to-undo', 'only the rival\'s opening move');

  // opponentTurn | pop 1 ply (the child's just-committed move)
  r = inPhase('opponentTurn');
  assert.deepEqual(r.session.undo(), { ok: true, plies: 1 });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual(r.state().history.map(ply => moveCode(ply.move)), OPENING);
  let events = r.take();
  assert.equal(events.map(label).join(' '), 'scope undo child:turn change(persist)');
  assert.deepEqual(events[1].steps.map(moveCode), ['9776']);
  // ... also when the retry control is showing; the flag does not survive
  r = inPhase('opponentTurn');
  r.session.opponentFailed(r.state().positionId);
  assert.deepEqual(r.session.undo(), { ok: true, plies: 1 });
  assert.equal(r.state().opponentFailed, false);
  // ... but the rival's first move of a game as black has nothing before it
  r = rig({ humanColor: 'black' });
  refused(r, () => r.session.undo(), 'nothing-to-undo', 'the rival is about to open');

  // over, result resign, child was to move | clear the result, pop nothing
  r = inPhase('childTurn');
  r.session.resign();
  r.take();
  let before = r.state().positionId;
  assert.deepEqual(r.session.undo(), { ok: true, plies: 0 });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual([r.state().result, r.state().endedAt, r.state().history.length], [null, null, 2]);
  assert.equal(r.state().positionId, before + 1, 'the result changed');
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope undo child:turn change(persist)');
  assert.deepEqual(events[1], { type: 'undo', plies: 0, unresigned: true, steps: [] });

  // over, result resign, rival was to move | clear the result, pop 1
  r = inPhase('opponentTurn');
  r.session.resign();
  r.take();
  before = r.state().positionId;
  assert.deepEqual(r.session.undo(), { ok: true, plies: 1 });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual([r.state().result, r.state().endedAt, r.state().history.length], [null, null, 2]);
  assert.equal(r.state().positionId, before + 1);
  events = r.take();
  assert.deepEqual({ plies: events[1].plies, unresigned: events[1].unresigned }, { plies: 1, unresigned: true });
  assert.deepEqual(events[1].steps.map(moveCode), ['9776']);
  // ... and when there is no child move to go back to (black resigned before the rival opened), nothing can be undone
  r = rig({ humanColor: 'black' });
  r.session.resign();
  r.take();
  refused(r, () => r.session.undo(), 'nothing-to-undo', 'undo always lands on the child\'s turn');
  assert.equal(canUndo(r.state()), false);

  // over, natural end, last ply by the child | pop 1
  r = rig();
  r.session.restore(saved({ moves: MATE.slice(0, 6) }));
  child(r.session, MATE[6]);
  r.session.markCounted();
  r.take();
  assert.equal(r.state().phase, 'over');
  assert.deepEqual(r.session.undo(), { ok: true, plies: 1 });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual([r.state().result, r.state().endedAt, r.state().history.length], [null, null, 6]);
  assert.deepEqual([r.state().check, r.state().checkers], [false, []]);
  assert.equal(r.state().counted, true, 'counted is not reset');
  events = r.take();
  assert.deepEqual({ plies: events[1].plies, unresigned: events[1].unresigned }, { plies: 1, unresigned: false });
  assert.deepEqual(events[1].steps.map(moveCode), ['5154']);

  // over, natural end, last ply by the rival | pop 2
  r = rig();
  r.session.restore(saved({ humanColor: 'black', moves: MATE.slice(0, 6) }));
  rival(r.session, MATE[6]);
  r.take();
  assert.deepEqual(r.state().result, { winner: 'red', reason: 'checkmate' });
  assert.deepEqual(r.session.undo(), { ok: true, plies: 2 });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual(r.state().history.map(ply => moveCode(ply.move)), MATE.slice(0, 5));
  assert.equal(fenOf(r.state()), replay(MATE.slice(0, 5)).fen);
  events = r.take();
  assert.deepEqual(events[1].steps.map(moveCode), ['5154', '0010']);

  // the position undo lands on can be a check: check and checkers follow the board
  r = rig({ humanColor: 'black' });
  play(r.session, [...PERPETUAL.slice(0, 5), '1424', '1525']);          // black is in check from (2,5), plays, is checked again
  r.take();
  assert.deepEqual([r.state().check, r.state().checkers], [true, [at(2, 5)]]);
  child(r.session, '2414');
  rival(r.session, '2515');
  assert.deepEqual(r.state().checkers, [at(1, 5)]);
  r.session.undo();
  assert.deepEqual([r.state().check, r.state().checkers], [true, [at(2, 5)]]);

  // drawFrom = min(drawFrom, history.length)
  r = rig();
  r.session.restore(migrateV1(fixture('v1-ai-black-hard.json'), NOW).game);
  assert.deepEqual([r.state().history.length, r.state().drawFrom, r.state().phase], [3, 3, 'childTurn']);
  assert.deepEqual(r.session.undo(), { ok: true, plies: 2 });
  assert.deepEqual([r.state().history.length, r.state().drawFrom], [1, 1]);
  r = inPhase('opponentTurn');
  r.session.undo();
  assert.equal(r.state().drawFrom, 0);
});

test('tapping the trial\'s destination confirms; tapping its origin retracts', () => {
  const r = rig({ humanColor: 'red' });
  r.session.tapSquare(7, 7);
  r.clock.t = NOW + 321;
  r.session.tapSquare(7, 4);                                     // 炮二平五 on trial
  const trial = r.state().trial;
  assert.equal(r.state().phase, 'tentative');
  assert.equal(trial.notation, '炮二平五');
  assert.equal(trial.startedAt, NOW + 321);
  assert.deepEqual(trial.board, engine.applyMove(r.state().board, trial.move));
  assert.equal(fenOf(r.state()), START, 'the committed board is untouched');
  assert.equal(displayBoard(r.state())[7][4].type, 'cannon');
  r.take();

  // origin: back in the hand, the same piece, the same targets
  assert.deepEqual(r.session.tapSquare(7, 7), { ok: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.state().selected, at(7, 7));
  assert.deepEqual(r.state().targets, engine.getPieceLegalMoves(r.state().board, 7, 7));
  assert.equal(r.state().trial, null);
  assert.equal(r.state().history.length, 0);
  let events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:end(retract) selection change');
  assert.equal(events[1].trial, trial);

  // destination: committed
  r.session.tapSquare(7, 4);
  const again = r.state().trial;
  assert.equal(again.id, trial.id + 1);
  r.take();
  assert.deepEqual(r.session.tapSquare(7, 4), { ok: true });
  assert.equal(r.state().phase, 'opponentTurn');
  assert.equal(r.state().trial, null);
  assert.equal(r.state().history.length, 1);
  assert.equal(r.state().history[0].notation, '炮二平五');
  assert.equal(fenOf(r.state()), replay(['7774']).fen);
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope move:committed opponent:turn change(persist)');
  assert.equal(events[1].trialId, again.id);
  assert.equal(events[1].ply.move, again.move);
});

test('a forbidden target is refused with perpetual-check and listed in state.forbidden', () => {
  const r = rig({ humanColor: 'red' });
  play(r.session, PERPETUAL.slice(0, 8));
  // the second occurrence is allowed and marked
  r.session.tryMove(ref('2515'));
  assert.equal(r.state().trial.repeat, 'repeat');
  r.session.confirm();
  play(r.session, PERPETUAL.slice(9));
  r.take();

  // the rules engine agrees that the third occurrence is the checking side's doing
  const s = r.state();
  const { startKey, log } = drawWindow(s);
  assert.equal(engine.judgeMove(startKey, log, s.board, ref('2515')), 'forbidden');

  assert.deepEqual(r.session.select(2, 5), { ok: true });
  assert.deepEqual(s.forbidden.map(moveCode), ['2515']);
  assert.ok(!s.targets.some(move => moveCode(move) === '2515'));
  assert.deepEqual([...s.targets, ...s.forbidden].map(moveCode).sort(), engine.getPieceLegalMoves(s.board, 2, 5).map(moveCode).sort());
  r.take();

  refused(r, () => r.session.tapSquare(1, 5), 'perpetual-check');
  refused(r, () => r.session.tryMove(ref('2515')), 'perpetual-check');
  assert.equal(s.phase, 'selected');

  // with another move of the rook on trial the forbidden target stays listed and refused
  assert.deepEqual(r.session.tapSquare(3, 5), { ok: true });
  assert.equal(s.trial.repeat, 'ok');
  assert.deepEqual(s.forbidden.map(moveCode), ['2515']);
  r.take();
  refused(r, () => r.session.tapSquare(1, 5), 'perpetual-check');
  refused(r, () => r.session.tryMove(ref('2515')), 'perpetual-check');
  assert.equal(moveCode(s.trial.move), '2535');

  // the rival is not held to the rule by the session: it may take any legal move
  const b = rig({ humanColor: 'black' });
  play(b.session, PERPETUAL);
  assert.deepEqual(b.session.opponentMove(b.state().positionId, ref('2515')), { ok: true });
  assert.deepEqual(b.state().result, { winner: null, reason: 'repetition' });
});

test('attempt records the first trial and the pouch level at that moment; it resets on a new turn, not on retract', () => {
  const r = inPhase('childTurn');
  const s = r.state();
  assert.deepEqual(s.attempt, FRESH_ATTEMPT);
  r.session.requestHint();                                       // pouch 1 before the first trial
  r.session.tryMove(ref('9776'));
  assert.deepEqual(s.attempt, { tries: 1, first: ref('9776'), hintAtFirst: 1 });
  r.session.retract();
  assert.deepEqual(s.attempt, { tries: 1, first: ref('9776'), hintAtFirst: 1 }, 'a retract keeps it');
  r.session.deselect();
  r.session.requestHint();                                       // pouch 2 after the first trial
  r.session.tryMove(ref('9172'));
  assert.deepEqual(s.attempt, { tries: 2, first: ref('9776'), hintAtFirst: 1 }, 'the first trial and its pouch level stay');
  r.session.tryMove(ref('9170'));                                // a replacement is a trial too
  assert.deepEqual(s.attempt, { tries: 3, first: ref('9776'), hintAtFirst: 1 });
  r.session.undo();                                              // = retract
  assert.equal(s.attempt.tries, 3);

  r.session.tryMove(ref('9172'));
  r.session.confirm();
  assert.deepEqual(s.attempt, FRESH_ATTEMPT, 'the rival\'s turn');
  rival(r.session, '0010');
  assert.deepEqual(s.attempt, FRESH_ATTEMPT, 'a new turn of the child');

  r.session.tryMove(ref('7170'));
  assert.deepEqual(s.attempt, { tries: 1, first: ref('7170'), hintAtFirst: 0 });
  r.session.retract();
  r.session.undo();                                              // pops two plies: a new turn
  assert.deepEqual(s.attempt, FRESH_ATTEMPT);

  r.session.tryMove(ref('9172'));
  r.session.resign();
  assert.deepEqual(s.attempt, FRESH_ATTEMPT);
  r.session.undo();
  r.session.tryMove(ref('9172'));
  r.session.newGame();
  assert.deepEqual(s.attempt, FRESH_ATTEMPT);
});

test('hint level resets on a position change but not on select or retract; requestHint is refused during a trial', () => {
  const r = inPhase('childTurn');
  const s = r.state();
  r.session.requestHint();
  r.session.requestHint();
  assert.equal(s.hint.level, 2);
  r.session.select(9, 7);
  assert.equal(s.hint.level, 2, 'select');
  r.session.deselect();
  assert.equal(s.hint.level, 2, 'deselect');
  r.session.tryMove(ref('9776'));
  assert.equal(s.hint.level, 2, 'trial');
  r.take();
  refused(r, () => r.session.requestHint(), 'trial-active');
  r.session.tryMove(ref('9778'));
  assert.equal(s.hint.level, 2, 'trial replaced');
  r.session.retract();
  assert.equal(s.hint.level, 2, 'retract');
  assert.deepEqual(r.session.requestHint(), { ok: true, level: 3 });
  r.take();
  refused(r, () => r.session.requestHint(), 'wrong-phase', 'all three pouches are open');

  // every change of the committed position or of the result starts at zero again
  r.session.tryMove(ref('9776'));
  r.session.confirm();
  assert.equal(s.hint.level, 0, 'confirm');
  rival(r.session, '0010');
  assert.equal(s.hint.level, 0, 'rival move');
  r.session.requestHint();
  r.session.undo();
  assert.equal(s.hint.level, 0, 'undo');
  r.session.requestHint();
  r.session.resign();
  assert.equal(s.hint.level, 0, 'resign');
  r.session.undo();
  assert.equal(s.hint.level, 0, 'resignation taken back');
  r.session.requestHint();
  r.session.newGame();
  assert.equal(s.hint.level, 0, 'new game');
  r.session.requestHint();
  r.session.restore(saved({ moves: OPENING }));
  assert.equal(s.hint.level, 0, 'restore');
});

test('opponentMove refuses a stale positionId and an illegal move', () => {
  let r = inPhase('opponentTurn');
  const positionId = r.state().positionId;

  // stale: nothing happens, in whatever phase the late result arrives
  refused(r, () => r.session.opponentMove(positionId - 1, ref('0010')), 'stale');
  refused(r, () => r.session.opponentMove(positionId + 1, ref('0010')), 'stale');
  refused(r, () => r.session.opponentFailed(positionId - 1), 'stale');
  assert.equal(r.state().opponentFailed, false);

  // illegal: the failed flag is set and announced, the position stays
  const before = fenOf(r.state());
  assert.deepEqual(r.session.opponentMove(positionId, ref('0040')), { ok: false, reason: 'illegal' }, 'a rook cannot jump its pawn');
  assert.equal(r.state().opponentFailed, true);
  assert.equal(r.state().phase, 'opponentTurn');
  assert.equal(r.state().positionId, positionId);
  assert.equal(fenOf(r.state()), before);
  assert.equal(r.state().history.length, 3);
  assert.equal(r.labels(), 'opponent:failed change');
  for (const bad of [ref('9172'), ref('5545'), null, { from: at(0, 0) }, { from: at(0, 0), to: { row: 1.5, col: 0 } }]) {
    assert.deepEqual(r.session.opponentMove(positionId, bad), { ok: false, reason: 'illegal' }, 'a move of the child, an empty origin, no move at all');
    assert.equal(r.labels(), 'opponent:failed change');
  }

  // a legal move is still accepted afterwards and clears the flag
  assert.deepEqual(r.session.opponentMove(positionId, ref('0010')), { ok: true });
  assert.equal(r.state().opponentFailed, false);
  assert.equal(r.state().phase, 'childTurn');
  r.take();
  // ... and the same result delivered twice is stale the second time
  refused(r, () => r.session.opponentMove(positionId, ref('0010')), 'stale');

  // undo while the rival thinks: its answer for the old position is stale
  r = inPhase('opponentTurn');
  const thinking = r.state().positionId;
  r.session.undo();
  r.take();
  refused(r, () => r.session.opponentMove(thinking, ref('0010')), 'stale');
  refused(r, () => r.session.opponentFailed(thinking), 'stale');
  // ... also after the child has moved again and the rival is to move in a new position
  child(r.session, '9776');
  r.take();
  refused(r, () => r.session.opponentMove(thinking, ref('0010')), 'stale');
  // resign and new game: the same
  r.session.resign();
  r.take();
  refused(r, () => r.session.opponentMove(thinking + 2, ref('0010')), 'stale');
});

test('confirm goes straight to opponentTurn; a mating confirm goes to over', () => {
  let r = inPhase('tentative');
  const trial = r.state().trial;
  const positionId = r.state().positionId;
  r.clock.t = NOW + 4000;
  assert.deepEqual(r.session.confirm(), { ok: true });
  let s = r.state();
  assert.equal(s.phase, 'opponentTurn', 'no confirming phase');
  assert.equal(s.positionId, positionId + 1);
  assert.deepEqual(r.session.scope(), { game: 1, position: positionId + 1, trial: 0 });
  assert.equal(s.turn, 'black');
  assert.equal(s.board, trial.board, 'the trial board becomes the committed board');
  assert.deepEqual([s.trial, s.selected, s.targets, s.forbidden, s.result, s.opponentFailed], [null, null, [], [], null, false]);
  assert.equal(s.turnStartedAt, NOW + 4000);
  const ply = s.history[2];
  assert.equal(ply.move, trial.move);
  assert.deepEqual({ color: ply.color, by: ply.by, notation: ply.notation }, { color: 'red', by: 'child', notation: '马二进三' });
  assert.equal(engine.boardToFen(ply.before, 'red'), replay(OPENING).fen);
  assert.deepEqual(ply.record, engine.plyRecord(ply.before, ply.move));
  assert.deepEqual(ply.flags, flagsByTheBook(ply.before, ply.move));
  // the rival can answer at once
  assert.deepEqual(r.session.opponentMove(s.positionId, ref('0010')), { ok: true });

  // 重炮: the confirm ends the game
  r = rig();
  r.session.restore(saved({ moves: MATE.slice(0, 6) }));
  r.session.tryMove(ref(MATE[6]));
  s = r.state();
  assert.deepEqual(s.trial.status, { over: true, winner: 'red', reason: 'checkmate', check: true });
  assert.equal(s.trial.flags.mate, true);
  r.take();
  r.clock.t = NOW + 9000;
  assert.deepEqual(r.session.confirm(), { ok: true });
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winner: 'red', reason: 'checkmate' });
  assert.equal(s.endedAt, NOW + 9000);
  assert.equal(s.turn, 'black');
  assert.deepEqual([s.check, s.checkers], [true, [at(5, 4)]]);
  assert.equal(s.history[6].flags.mate, true);
  assert.equal(r.labels(), 'scope move:committed game:over change(persist)');
  refused(r, () => r.session.opponentMove(s.positionId, ref('0414')), 'wrong-phase', 'nobody moves in a finished game');
  assert.deepEqual(r.session.serialize().result, null, 'a natural result is not stored');
});

test('flags carry checkers and the checked king', () => {
  const r = rig({ humanColor: 'red' });
  const s = r.state();
  play(r.session, PERPETUAL.slice(0, 4));

  // 车四进七: check from (1,5) on the king on (1,4)
  r.session.tryMove(ref('8515'));
  assert.deepEqual(s.trial.flags, { check: true, mate: false, checkedKing: at(1, 4), checkers: [at(1, 5)], crossed: false });
  assert.deepEqual(s.trial.flags, flagsByTheBook(s.board, s.trial.move));
  assert.deepEqual(s.trial.status, { over: false, winner: null, reason: null, check: true });
  assert.deepEqual([s.check, s.checkers], [false, []], 'a trial does not touch the committed position');
  r.take();
  r.session.confirm();
  const events = r.take();
  assert.deepEqual(events[1].ply.flags, { check: true, mate: false, checkedKing: at(1, 4), checkers: [at(1, 5)], crossed: false });
  assert.deepEqual([s.check, s.checkers], [true, [at(1, 5)]], 'the side to move is in check, and by whom');

  // a quiet rival move: no check, nothing to list
  rival(r.session, '1424');
  assert.deepEqual(s.history[5].flags, { check: false, mate: false, checkedKing: null, checkers: [], crossed: false });
  assert.deepEqual([s.check, s.checkers], [false, []]);

  // the rival's checks carry the same flags
  const b = rig({ humanColor: 'black' });
  play(b.session, PERPETUAL.slice(0, 5));
  assert.deepEqual(b.state().history[4].flags, { check: true, mate: false, checkedKing: at(1, 4), checkers: [at(1, 5)], crossed: false });
  assert.deepEqual([b.state().check, b.state().checkers], [true, [at(1, 5)]]);

  // mate: 重炮, the cannon on (5,4) checks over the cannon on (3,4)
  const m = rig();
  m.session.restore(saved({ moves: MATE.slice(0, 6) }));
  m.session.tryMove(ref(MATE[6]));
  assert.deepEqual(m.state().trial.flags, { check: true, mate: true, checkedKing: at(0, 4), checkers: [at(5, 4)], crossed: false });

  // crossed: a pawn steps from its own half onto the enemy half, for either side
  const p = rig({ humanColor: 'red' });
  play(p.session, ['6454', '3040']);
  assert.equal(p.state().history[0].flags.crossed, false, 'a red pawn still on its own half');
  assert.equal(p.state().history[1].flags.crossed, false, 'a black pawn still on its own half');
  play(p.session, ['5444', '4050']);
  assert.equal(p.state().history[2].flags.crossed, true, 'a red pawn crosses the river');
  assert.equal(p.state().history[3].flags.crossed, true, 'a black pawn crosses the river');
  play(p.session, ['4434', '5060']);
  assert.equal(p.state().history[4].flags.crossed, false, 'a pawn already across');
  assert.equal(p.state().history[5].flags.crossed, false);
  p.session.tryMove(ref('9080'));
  assert.equal(p.state().trial.flags.crossed, false, 'not a pawn');
});

test('repetition, no_capture and move_limit draws end the game', () => {
  // ---- repetition: the third occurrence of a position, here reached by the rival's move ----
  let r = rig({ humanColor: 'red' });
  play(r.session, SHUFFLE.slice(0, 4));
  r.session.tryMove(ref(SHUFFLE[4]));
  assert.equal(r.state().trial.repeat, 'repeat', 'the second occurrence is legal and marked');
  r.session.confirm();
  play(r.session, SHUFFLE.slice(5, 7));
  assert.equal(r.state().phase, 'opponentTurn');
  r.take();
  r.clock.t = NOW + 123;
  rival(r.session, SHUFFLE[7]);
  assert.equal(r.state().phase, 'over');
  assert.deepEqual(r.state().result, { winner: null, reason: 'repetition' });
  assert.equal(r.state().endedAt, NOW + 123);
  assert.equal(fenOf(r.state()), START);
  let events = r.take();
  assert.equal(events.map(label).join(' '), 'scope move:committed game:over change(persist)');
  assert.deepEqual(events[2], { type: 'game:over', result: { winner: null, reason: 'repetition' } });
  refused(r, () => r.session.tapSquare(9, 0), 'over');
  assert.equal(r.session.serialize().result, null);

  // ... and by the child's confirm; the trial says so beforehand
  r = rig({ humanColor: 'black' });
  play(r.session, SHUFFLE.slice(0, 7));
  r.session.tryMove(ref(SHUFFLE[7]));
  assert.equal(r.state().trial.repeat, 'draw');
  r.take();
  r.session.confirm();
  assert.deepEqual(r.state().result, { winner: null, reason: 'repetition' });
  assert.equal(r.labels(), 'scope move:committed game:over change(persist)');

  // ---- no_capture: 120 plies without a capture ----
  // The red rook tours five points of row 8 and the black rook seven points of row 1, so no position comes a third time.
  const quiet = ['9080', '0010'];
  for (let k = 1; k <= 59; k++) {
    quiet.push(`8${(k - 1) % 5}8${k % 5}`, `1${(k - 1) % 7}1${k % 7}`);
  }
  assert.equal(quiet.length, 120);
  r = rig({ humanColor: 'red' });
  play(r.session, quiet.slice(0, 119));
  assert.equal(r.state().phase, 'opponentTurn', 'still playing after 119 quiet plies');
  assert.equal(r.state().result, null);
  rival(r.session, quiet[119]);
  assert.equal(r.state().phase, 'over');
  assert.deepEqual(r.state().result, { winner: null, reason: 'no_capture' });
  assert.equal(r.state().history.length, 120);
  // ... the 120th quiet ply can be the child's
  r = rig({ humanColor: 'black' });
  play(r.session, quiet.slice(0, 119));
  assert.equal(r.state().phase, 'childTurn');
  r.session.tryMove(ref(quiet[119]));
  assert.notEqual(r.state().trial.repeat, 'draw', 'not a third occurrence: the game ends by the quiet count');
  r.session.confirm();
  assert.deepEqual(r.state().result, { winner: null, reason: 'no_capture' });

  // ---- move_limit: 600 plies ----
  const long = longGame(600, { seed: 11 });
  r = rig();
  assert.deepEqual(r.session.restore(saved({ moves: long.slice(0, 598) })), { ok: true, applied: 598, truncatedAt: null });
  assert.equal(r.state().phase, 'childTurn');
  child(r.session, long[598]);
  assert.equal(r.state().phase, 'opponentTurn', '599 plies: still playing');
  r.take();
  rival(r.session, long[599]);
  assert.equal(r.state().phase, 'over');
  assert.deepEqual(r.state().result, { winner: null, reason: 'move_limit' });
  assert.equal(r.state().history.length, 600);
  assert.equal(r.labels(), 'scope move:committed game:over change(persist)');
  assert.equal(r.session.serialize().moves.length, 600);
  // taking the last moves back reopens the game
  assert.deepEqual(r.session.undo(), { ok: true, plies: 2 });
  assert.equal(r.state().phase, 'childTurn');
  assert.equal(r.state().result, null);
});

test('restore: empty, mid-game on each side\'s turn, finished by mate, resigned, illegal move at index k keeps the prefix, move after mate, 2000 legal plies', () => {
  // ---- empty ----
  let r = rig();
  r.clock.t = NOW + 10;
  assert.deepEqual(r.session.restore(saved({ id: 'g-empty001', counted: false })), { ok: true, applied: 0, truncatedAt: null });
  let s = r.state();
  assert.equal(s.phase, 'childTurn');
  assert.deepEqual([s.id, s.gameId, s.positionId, s.humanColor, s.turn, fenOf(s), s.startKey], ['g-empty001', 1, 1, 'red', 'red', START, START]);
  assert.deepEqual([s.history, s.drawFrom, s.result, s.counted, s.startedAt, s.endedAt, s.turnStartedAt], [[], 0, null, false, T0, null, NOW + 10]);
  assert.equal(r.labels(), 'scope game:start child:turn change');
  assert.deepEqual(r.session.restore(saved({ humanColor: 'black' })), { ok: true, applied: 0, truncatedAt: null });
  assert.equal(s.phase, 'opponentTurn');
  assert.deepEqual([s.gameId, s.positionId, s.humanColor], [2, 2, 'black']);
  assert.equal(r.labels(), 'scope game:start opponent:turn change');

  // ---- mid-game, the child to move (red) ----
  const mid = fixture('v2-midgame.json');
  r = rig();
  assert.deepEqual(r.session.restore(mid), { ok: true, applied: 8, truncatedAt: null });
  s = r.state();
  const midgame = replay(mid.moves);
  assert.equal(s.phase, 'childTurn');
  assert.equal(fenOf(s), midgame.fen);
  assert.deepEqual(s.board, midgame.board);
  assert.deepEqual(s.history.map(ply => moveCode(ply.move)), mid.moves);
  assert.deepEqual(s.history.map(ply => ply.by), ['child', 'opponent', 'child', 'opponent', 'child', 'opponent', 'child', 'opponent']);
  assert.deepEqual(s.history.map(ply => ply.color), ['red', 'black', 'red', 'black', 'red', 'black', 'red', 'black']);
  assert.deepEqual(s.history.map(ply => ply.record), midgame.records);
  for (const ply of s.history) {
    assert.equal(ply.notation, engine.moveToNotation(ply.before, ply.move));
    assert.deepEqual(ply.flags, flagsByTheBook(ply.before, ply.move));
  }
  assert.deepEqual(capturedPieces(s).byRed.map(piece => piece.type), ['pawn']);
  assert.deepEqual(capturedPieces(s).byBlack.map(piece => piece.type), ['cannon']);
  assert.deepEqual([s.id, s.startedAt, s.endedAt, s.counted, s.drawFrom], ['g-m3k09x2a', T0, null, false, 0]);
  assert.equal(r.labels(), 'scope game:start child:turn change');
  assert.deepEqual(r.session.tapSquare(9, 1), { ok: true }, 'the game goes on');

  // ---- mid-game, the rival to move ----
  r = rig();
  assert.deepEqual(r.session.restore(saved({ moves: mid.moves.slice(0, 7) })), { ok: true, applied: 7, truncatedAt: null });
  assert.equal(r.state().phase, 'opponentTurn');
  assert.equal(r.labels(), 'scope game:start opponent:turn change');
  rival(r.session, mid.moves[7]);
  assert.equal(fenOf(r.state()), midgame.fen);

  // ---- mid-game as black: the child to move after three plies (a migrated v1 game) ----
  r = rig();
  const black = migrateV1(fixture('v1-ai-black-hard.json'), NOW).game;
  assert.deepEqual(r.session.restore(black), { ok: true, applied: 3, truncatedAt: null });
  s = r.state();
  assert.deepEqual([s.phase, s.humanColor, s.turn, s.drawFrom], ['childTurn', 'black', 'black', 3]);
  assert.deepEqual(s.history.map(ply => ply.by), ['opponent', 'child', 'opponent']);
  assert.equal(s.id, black.id);

  // ---- a record with checks in it: every ply carries the flags a live game would have given it ----
  r = rig();
  r.session.restore(saved({ humanColor: 'black', moves: PERPETUAL }));
  s = r.state();
  for (const ply of s.history) assert.deepEqual(ply.flags, flagsByTheBook(ply.before, ply.move));
  assert.deepEqual(s.history.map(ply => ply.flags.check), [false, false, false, false, true, false, true, false, true, false, true, false]);
  assert.deepEqual([s.phase, s.check], ['opponentTurn', false]);

  // ---- fields a save should never have wrong are still not taken on trust ----
  r = rig();
  r.clock.t = NOW + 30;
  r.session.restore(saved({ id: 'no id at all', startedAt: 'yesterday', endedAt: 'never', drawFrom: -3, counted: 'yes', humanColor: 'green' }));
  s = r.state();
  assert.equal(s.id, 'g-test0001', 'a fresh id');
  assert.deepEqual([s.startedAt, s.endedAt, s.drawFrom, s.counted, s.humanColor], [NOW + 30, null, 0, false, 'red']);
  r.session.restore(saved({ id: 42, moves: OPENING, drawFrom: 99 }));
  assert.equal(s.id, 'g-test0002');
  assert.equal(s.drawFrom, 2, 'clamped to the plies there are');

  // ---- finished by mate ----
  r = rig();
  r.clock.t = NOW + 20;
  assert.deepEqual(r.session.restore(saved({ moves: MATE })), { ok: true, applied: 7, truncatedAt: null });
  s = r.state();
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winner: 'red', reason: 'checkmate' });
  assert.deepEqual([s.check, s.checkers], [true, [at(5, 4)]]);
  assert.equal(s.endedAt, NOW + 20, 'a finished game without an end time ends now');
  assert.equal(s.history[6].flags.mate, true);
  assert.deepEqual(s.history.slice(0, 6).map(ply => ply.flags.mate), [false, false, false, false, false, false]);
  assert.deepEqual([s.selected, s.targets, s.trial, s.opponentFailed], [null, [], null, false]);
  assert.equal(r.labels(), 'scope game:start change', 'game:over is not emitted by restore');
  r.session.restore(saved({ moves: MATE, endedAt: T0 + 5000, counted: true }));
  assert.deepEqual([s.endedAt, s.counted], [T0 + 5000, true]);
  r.session.restore(saved({ humanColor: 'black', moves: MATE }));
  assert.deepEqual([s.phase, s.result], ['over', { winner: 'red', reason: 'checkmate' }]);

  // ---- resigned ----
  r = rig();
  const resigned = migrateV1(fixture('v1-resigned.json'), NOW).game;
  assert.deepEqual(resigned.result, { winner: 'black', reason: 'resign' });
  assert.deepEqual(r.session.restore(resigned), { ok: true, applied: 4, truncatedAt: null });
  s = r.state();
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winner: 'black', reason: 'resign' });
  assert.equal(s.endedAt, T0 + 600000);
  assert.equal(s.history.length, 4);
  assert.equal(r.labels(), 'scope game:start change');
  assert.deepEqual(r.session.serialize().result, { winner: 'black', reason: 'resign' });
  assert.deepEqual(r.session.undo(), { ok: true, plies: 0 }, 'the resignation can be taken back');
  // a stored resignation without an end time ends now; with the rival to move it is still the child's resignation
  r = rig();
  r.clock.t = NOW + 40;
  r.session.restore(saved({ moves: ['7774'], result: { winner: 'black', reason: 'resign' }, endedAt: null }));
  s = r.state();
  assert.deepEqual([s.phase, s.result, s.endedAt, s.turn], ['over', { winner: 'black', reason: 'resign' }, NOW + 40, 'black']);
  assert.deepEqual([s.selected, s.targets, s.forbidden, s.trial, s.opponentFailed], [null, [], [], null, false]);
  assert.equal(r.labels(), 'scope game:start change');
  assert.deepEqual(r.session.undo(), { ok: true, plies: 1 }, 'taking it back lands on the child\'s turn');
  // only a resignation is believed: any other stored result is recomputed, and a winner that is no side is no result
  r.session.restore(saved({ moves: OPENING, result: { winner: 'black', reason: 'checkmate' }, endedAt: T0 + 7 }));
  assert.deepEqual([s.phase, s.result, s.endedAt], ['childTurn', null, null]);
  r.session.restore(saved({ moves: OPENING, result: { winner: 'green', reason: 'resign' } }));
  assert.deepEqual([s.phase, s.result], ['childTurn', null]);
  r.session.restore(saved({ moves: OPENING, result: 'resign' }));
  assert.deepEqual([s.phase, s.result], ['childTurn', null]);
  // a natural end wins over a stored resignation
  r.session.restore(saved({ moves: MATE, result: { winner: 'black', reason: 'resign' } }));
  assert.deepEqual(s.result, { winner: 'red', reason: 'checkmate' });

  // ---- illegal move at index k keeps the prefix ----
  r = rig();
  const broken = migrateV1(fixture('v1-illegal-third-move.json'), NOW).game;
  assert.deepEqual(broken.moves, ['7774', '0726', '9050', '0807']);
  assert.deepEqual(r.session.restore(broken), { ok: true, applied: 2, truncatedAt: 2 });
  s = r.state();
  assert.equal(s.phase, 'childTurn');
  assert.deepEqual(s.history.map(ply => moveCode(ply.move)), ['7774', '0726']);
  assert.equal(fenOf(s), replay(OPENING).fen);
  assert.equal(s.drawFrom, 2, 'min(saved.drawFrom, history.length)');
  let events = r.take();
  assert.equal(events.map(label).join(' '), 'scope game:start child:turn change(persist)');
  assert.deepEqual(events[1], { type: 'game:start', reason: 'restore', truncatedAt: 2 });
  assert.deepEqual(r.session.serialize().moves, ['7774', '0726'], 'the rewritten save has no bad tail');
  // the first move can be the bad one; a code that is not a move code counts as illegal; a resignation after a bad tail is not believed
  assert.deepEqual(r.session.restore(saved({ moves: ['9050', '0726'] })), { ok: true, applied: 0, truncatedAt: 0 });
  assert.equal(r.state().phase, 'childTurn');
  assert.deepEqual(r.session.restore(saved({ moves: ['7774', '07x6', '9776'] })), { ok: true, applied: 1, truncatedAt: 1 });
  assert.equal(r.state().phase, 'opponentTurn');
  assert.deepEqual(r.session.restore(saved({ moves: ['7774', '9776'] })), { ok: true, applied: 1, truncatedAt: 1 }, 'red cannot move twice');
  r.take();
  assert.deepEqual(r.session.restore(saved({ moves: ['7774', '0726', '9050'], result: { winner: 'black', reason: 'resign' }, endedAt: T0 + 9 })),
    { ok: true, applied: 2, truncatedAt: 2 });
  assert.deepEqual([r.state().phase, r.state().result, r.state().endedAt], ['childTurn', null, null]);
  assert.equal(r.labels(), 'scope game:start child:turn change(persist)');

  // ---- move after mate ----
  r = rig();
  assert.deepEqual(r.session.restore(saved({ moves: [...MATE, '0414'] })), { ok: true, applied: 7, truncatedAt: 7 });
  assert.equal(r.state().phase, 'over');
  assert.deepEqual(r.state().result, { winner: 'red', reason: 'checkmate' });
  assert.equal(r.labels(), 'scope game:start change(persist)');
  assert.deepEqual(r.session.serialize().moves, MATE);

  // ---- 2000 legal plies ----
  const marathon = longGame(2000, { seed: 3, drawFree: false });
  const end = replay(marathon);
  const expected = engine.drawStatus(START, end.records, end.board, 2000);
  assert.equal(expected.draw, true, 'a game of 2000 plies is drawn by one rule or another');
  r = rig();
  assert.deepEqual(r.session.restore(saved({ moves: marathon })), { ok: true, applied: 2000, truncatedAt: null });
  s = r.state();
  assert.equal(s.history.length, 2000);
  assert.equal(fenOf(s), end.fen);
  assert.deepEqual(s.board, end.board);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winner: null, reason: expected.reason });
  assert.deepEqual(s.history.map(ply => ply.record), end.records);
  assert.equal(r.labels(), 'scope game:start change');
  assert.deepEqual(r.session.serialize().moves, marathon);
});

test('restore does not apply draw rules while replaying: v1-repetition, v1-121-quiet-plies and v1-700-plies load in progress at their last ply', () => {
  const cases = [
    { name: 'v1-repetition.json', plies: 13, human: 'black' },
    { name: 'v1-121-quiet-plies.json', plies: 121, human: 'black' },
    { name: 'v1-700-plies.json', plies: 700, human: 'red' },
  ];
  for (const { name, plies, human } of cases) {
    const game = migrateV1(fixture(name), NOW).game;
    assert.equal(game.moves.length, plies, name);
    assert.equal(game.drawFrom, plies, name);
    const end = replay(game.moves);

    const r = rig();
    assert.deepEqual(r.session.restore(game), { ok: true, applied: plies, truncatedAt: null }, name);
    const s = r.state();
    assert.equal(s.phase, 'childTurn', `${name}: in progress, the child to move`);
    assert.deepEqual([s.result, s.endedAt, s.humanColor, s.turn, s.drawFrom], [null, null, human, human, plies], name);
    assert.equal(s.history.length, plies, name);
    assert.equal(fenOf(s), end.fen, name);
    assert.equal(r.labels(), 'scope game:start child:turn change', name);
    assert.deepEqual(historyFens(s), [], `${name}: nothing before the migration counts as history`);
  }

  // What the fixtures hold, by the rules engine alone: each would be a draw if the rules had applied.
  const shuffle = migrateV1(fixture('v1-repetition.json'), NOW).game.moves;
  const eight = replay(shuffle.slice(0, 8));
  assert.deepEqual(engine.drawStatus(START, eight.records, eight.board, 8), { draw: true, reason: 'repetition' });
  const quiet = migrateV1(fixture('v1-121-quiet-plies.json'), NOW).game.moves;
  const quietEnd = replay(quiet);
  assert.equal(quietEnd.records.some(record => record.capture), false);
  assert.equal(engine.drawStatus(START, quietEnd.records, quietEnd.board, 121).draw, true);
  const long = migrateV1(fixture('v1-700-plies.json'), NOW).game.moves;
  const longEnd = replay(long);
  assert.equal(engine.drawStatus(START, longEnd.records, longEnd.board, 700).draw, true);

  // A repetition in the middle of a v2 record is not applied while replaying either: only the final position is judged.
  let r = rig();
  assert.deepEqual(r.session.restore(saved({ moves: shuffle })), { ok: true, applied: 13, truncatedAt: null });
  assert.equal(r.state().phase, 'opponentTurn');
  assert.equal(r.state().result, null);
  // ... while the final position is judged, counting plies from drawFrom
  assert.deepEqual(r.session.restore(saved({ moves: shuffle.slice(0, 8) })), { ok: true, applied: 8, truncatedAt: null });
  assert.deepEqual([r.state().phase, r.state().result], ['over', { winner: null, reason: 'repetition' }]);
  r.session.restore(saved({ moves: shuffle.slice(0, 8), drawFrom: 8 }));
  assert.deepEqual([r.state().phase, r.state().result], ['childTurn', null]);
  r.session.restore(saved({ moves: quiet.slice(0, 120) }));
  assert.deepEqual(r.state().result, naturalResult(r.state()));
  assert.equal(r.state().phase, 'over');

  // The migrated games continue; draw rules count only the plies played from now on (13.3), the move limit included.
  r = rig();
  r.session.restore(migrateV1(fixture('v1-700-plies.json'), NOW).game);
  const s = r.state();
  const mine = engine.getLegalMoves(s.board, 'red').find(move => !move.captured);
  child(r.session, moveCode(mine));
  assert.equal(s.phase, 'opponentTurn', '701 plies and still playing');
  const reply = engine.getLegalMoves(s.board, 'black').find(move => !move.captured
    && engine.getLegalMoves(engine.applyMove(s.board, move), 'red').length > 0);
  rival(r.session, moveCode(reply));
  assert.deepEqual([s.phase, s.result, s.history.length, s.drawFrom], ['childTurn', null, 702, 700]);
  assert.equal(historyFens(s).length, 2);
});

test('serialize then restore is identity', () => {
  const cases = [];
  const add = (name, build) => cases.push({ name, build });

  add('a fresh game as red', () => rig({ humanColor: 'red' }));
  add('a fresh game as black', () => rig({ humanColor: 'black' }));
  add('the child to move after captures', () => {
    const r = rig({ humanColor: 'red' });
    play(r.session, fixture('v2-midgame.json').moves);
    return r;
  });
  add('a piece picked up', () => inPhase('selected'));
  add('a trial on the board', () => inPhase('tentative'));
  add('the rival to move', () => inPhase('opponentTurn'));
  add('the rival failed', () => {
    const r = inPhase('opponentTurn');
    r.session.opponentFailed(r.state().positionId);
    return r;
  });
  add('the child in check', () => {
    const r = rig({ humanColor: 'black' });
    play(r.session, PERPETUAL.slice(0, 5));
    return r;
  });
  add('won by mate', () => {
    const r = rig({ humanColor: 'red' });
    play(r.session, MATE);
    r.session.markCounted();
    return r;
  });
  add('lost by mate', () => {
    const r = rig({ humanColor: 'black' });
    play(r.session, MATE);
    return r;
  });
  add('drawn by repetition', () => {
    const r = rig({ humanColor: 'red' });
    play(r.session, SHUFFLE);
    return r;
  });
  add('resigned on the child\'s turn', () => inPhase('over'));
  add('resigned on the rival\'s turn', () => {
    const r = inPhase('opponentTurn');
    r.session.resign();
    return r;
  });
  add('after an undo', () => {
    const r = rig({ humanColor: 'red' });
    play(r.session, [...OPENING, '9776', '0010']);
    r.session.undo();
    return r;
  });
  add('a mate taken back', () => {
    const r = rig({ humanColor: 'red' });
    play(r.session, MATE);
    r.session.undo();
    return r;
  });
  add('a migrated game that went on', () => {
    const r = rig();
    r.session.restore(migrateV1(fixture('v1-repetition.json'), NOW).game);
    child(r.session, '0010');
    rival(r.session, '9080');
    return r;
  });
  add('a migrated game taken back past the migration', () => {
    const r = rig();
    r.session.restore(migrateV1(fixture('v1-ai-black-hard.json'), NOW).game);
    r.session.undo();
    return r;
  });

  for (const { name, build } of cases) {
    const r = build();
    const live = r.state();
    const { record, copy, result } = reload(r.session);
    assert.deepEqual(Object.keys(record), SAVE_KEYS, name);
    assert.deepEqual([record.schema, record.start], [2, null], name);
    assert.deepEqual(record.moves, live.history.map(ply => moveCode(ply.move)), name);
    assert.deepEqual(result, { ok: true, applied: live.history.length, truncatedAt: null }, name);
    assert.deepEqual(truth(copy.getState()), truth(live), name);
    assert.deepEqual(copy.serialize(), r.session.serialize(), `${name}: the save of the restored game is the same save`);
    // what a save does not carry starts fresh
    const s = copy.getState();
    assert.deepEqual([s.selected, s.targets, s.forbidden, s.trial, s.hint, s.attempt, s.opponentFailed], [null, [], [], null, { level: 0 }, FRESH_ATTEMPT, false], name);
    assert.equal(canUndo(s), live.phase === 'selected' || live.phase === 'tentative' ? canUndo({ ...live, phase: 'childTurn', trial: null }) : canUndo(live), name);
  }

  // only a resignation is stored
  const won = rig({ humanColor: 'red' });
  play(won.session, MATE);
  assert.equal(won.session.serialize().result, null);
  const lost = inPhase('over');
  assert.deepEqual(lost.session.serialize().result, { winner: 'black', reason: 'resign' });
  lost.session.undo();
  assert.equal(lost.session.serialize().result, null);
  assert.equal(lost.session.serialize().endedAt, null);
});

test('a re-entrant command inside a subscriber keeps event order; a throwing subscriber does not stop later ones', () => {
  // ---- re-entrancy ----
  const session = createSession({ now: () => NOW, makeId: () => 'g-reentrant' });
  const log = [];
  const phases = [];
  session.subscribe((event) => log.push(`a:${label(event)}`));
  session.subscribe((event, state) => {
    log.push(`b:${label(event)}`);
    // what a director does with a piece the child tapped during the rival's turn: a command from inside the handler
    if (event.type === 'child:turn') {
      assert.deepEqual(session.select(7, 7), { ok: true });
      phases.push(state.phase);
    }
    if (event.type === 'selection' && state.hint.level === 0) assert.deepEqual(session.requestHint(), { ok: true, level: 1 });
  });
  session.subscribe((event, state) => {
    log.push(`c:${label(event)}`);
    if (event.type === 'change' && event.persist) phases.push(state.phase);
  });
  assert.deepEqual(session.newGame({ humanColor: 'red' }), { ok: true });
  const batches = ['scope', 'game:start', 'child:turn', 'change(persist)', 'selection', 'change', 'hint', 'change'];
  assert.deepEqual(log, batches.flatMap(name => [`a:${name}`, `b:${name}`, `c:${name}`]),
    'the batch in delivery is finished for every subscriber before the queued batches, which follow in the order they were made');
  assert.deepEqual(phases, ['selected', 'selected'], 'the command ran at once; the rest of the first batch is delivered with the live state');
  assert.equal(session.getState().phase, 'selected');
  assert.equal(session.getState().hint.level, 1);

  // ---- a throwing subscriber ----
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const noisy = createSession({ now: () => NOW, makeId: () => 'g-throwing' });
    const before = [];
    const after = [];
    noisy.subscribe((event) => before.push(label(event)));
    const off = noisy.subscribe((event) => {
      throw new Error(`boom on ${event.type}`);
    });
    noisy.subscribe((event) => after.push(label(event)));
    assert.deepEqual(noisy.newGame({ humanColor: 'red' }), { ok: true }, 'the command still succeeds');
    assert.deepEqual(noisy.tryMove(ref('7774')), { ok: true });
    assert.deepEqual(noisy.confirm(), { ok: true });
    const expected = ['scope', 'game:start', 'child:turn', 'change(persist)', 'scope', 'trial:start', 'change',
                      'scope', 'move:committed', 'opponent:turn', 'change(persist)'];
    assert.deepEqual(before, expected);
    assert.deepEqual(after, expected, 'the subscriber after the throwing one saw every event');
    assert.equal(errors.length, expected.length, 'each failure is logged');
    assert.match(String(errors[0][1]), /boom on scope/);

    // unsubscribe: the returned function removes exactly that subscriber
    off();
    off();
    noisy.opponentMove(noisy.getState().positionId, ref('0726'));
    assert.equal(errors.length, expected.length);
    assert.equal(after.length, expected.length + 4);
  } finally {
    console.error = original;
  }

  // a subscriber that unsubscribes itself, and one that subscribes another, do not disturb the delivery
  const quiet = createSession({ now: () => NOW, makeId: () => 'g-quietone' });
  const seen = [];
  const late = [];
  const once = quiet.subscribe((event) => {
    seen.push(`once:${label(event)}`);
    once();
    quiet.subscribe((e) => late.push(label(e)));
  });
  quiet.subscribe((event) => seen.push(`two:${label(event)}`));
  quiet.newGame();
  assert.deepEqual(seen, ['once:scope', 'two:scope', 'two:game:start', 'two:child:turn', 'two:change(persist)']);
  assert.deepEqual(late, ['game:start', 'child:turn', 'change(persist)'], 'a new subscriber hears the events after the one it was added in');
  assert.throws(() => quiet.subscribe(null), TypeError);
});

// ---------------------------------------------------------------------------------------------------------------
// beyond the titles of 14.4
// ---------------------------------------------------------------------------------------------------------------

test('before the first game every command but newGame and restore is refused', () => {
  const r = rig();
  const s = r.state();
  assert.deepEqual([s.gameId, s.positionId, s.trialId, s.phase, s.result], [0, 0, 0, 'over', null]);
  assert.deepEqual(r.session.scope(), { game: 0, position: 0, trial: 0 });
  assert.equal(fenOf(s), START);
  assert.deepEqual([canUndo(s), canHint(s), canAsk(s)], [false, false, false]);
  refused(r, () => r.session.tapSquare(7, 7), 'over');
  refused(r, () => r.session.select(7, 7), 'wrong-phase');
  refused(r, () => r.session.deselect(), 'wrong-phase');
  refused(r, () => r.session.tryMove(ref('7774')), 'wrong-phase');
  refused(r, () => r.session.retract(), 'wrong-phase');
  refused(r, () => r.session.confirm(), 'wrong-phase');
  refused(r, () => r.session.requestHint(), 'wrong-phase');
  refused(r, () => r.session.undo(), 'nothing-to-undo');
  refused(r, () => r.session.resign(), 'over');
  refused(r, () => r.session.opponentMove(0, ref('7774')), 'wrong-phase');
  refused(r, () => r.session.opponentFailed(0), 'wrong-phase');
  refused(r, () => r.session.retryOpponent(), 'wrong-phase');
  refused(r, () => r.session.markCounted(), 'wrong-phase');
  const record = r.session.serialize();
  assert.deepEqual(Object.keys(record), SAVE_KEYS);
  assert.match(record.id, /^g-[a-z0-9]{6,16}$/);
  assert.deepEqual(record.moves, []);

  // the default dependencies: the real engine, the wall clock, a random id
  const plain = createSession();
  const t = Date.now();
  assert.deepEqual(plain.newGame(), { ok: true });
  assert.match(plain.getState().id, /^g-[a-z0-9]{8}$/);
  assert.ok(plain.getState().startedAt >= t && plain.getState().startedAt <= Date.now());
  assert.deepEqual([plain.getState().phase, plain.getState().humanColor], ['childTurn', 'red']);
  const first = plain.getState().id;
  plain.newGame();
  assert.notEqual(plain.getState().id, first);
});

test('the three ids only grow, each on its own occasions, and scope() mirrors them', () => {
  const r = rig();
  const s = r.state();
  const ids = () => [s.gameId, s.positionId, s.trialId];
  const step = (command, expected, note) => {
    command();
    assert.deepEqual(ids(), expected, note);
    assert.deepEqual(r.session.scope(), { game: s.gameId, position: s.positionId, trial: s.trial ? s.trial.id : 0 }, note);
    const scopes = r.take().filter(event => event.type === 'scope');
    if (scopes.length > 0) assert.deepEqual(scopes.at(-1).scope, r.session.scope(), `${note}: the scope event carries the new scope`);
    return scopes.length;
  };
  assert.equal(step(() => r.session.newGame(), [1, 1, 0], 'newGame'), 1);
  assert.equal(step(() => r.session.select(7, 7), [1, 1, 0], 'select'), 0);
  assert.equal(step(() => r.session.requestHint(), [1, 1, 0], 'hint'), 0);
  assert.equal(step(() => r.session.deselect(), [1, 1, 0], 'deselect'), 0);
  assert.equal(step(() => r.session.tryMove(ref('7774')), [1, 1, 1], 'trial'), 1);
  assert.equal(r.session.scope().trial, 1);
  assert.equal(step(() => r.session.tryMove(ref('7775')), [1, 1, 2], 'trial replaced'), 1);
  assert.equal(step(() => r.session.retract(), [1, 1, 2], 'retract'), 1);
  assert.equal(r.session.scope().trial, 0, 'no trial: 0');
  assert.equal(step(() => r.session.tryMove(ref('7774')), [1, 1, 3], 'a new trial of the same move is a new trial'), 1);
  assert.equal(step(() => r.session.confirm(), [1, 2, 3], 'confirm'), 1);
  assert.equal(step(() => r.session.opponentFailed(2), [1, 2, 3], 'opponentFailed'), 0);
  assert.equal(step(() => r.session.retryOpponent(), [1, 2, 3], 'retryOpponent'), 0);
  assert.equal(step(() => r.session.opponentMove(2, ref('0040')), [1, 2, 3], 'an illegal rival move'), 0);
  assert.equal(step(() => r.session.opponentMove(2, ref('0726')), [1, 3, 3], 'opponentMove'), 1);
  assert.equal(step(() => r.session.undo(), [1, 4, 3], 'undo'), 1);
  assert.equal(step(() => r.session.resign(), [1, 5, 3], 'resign'), 1);
  assert.equal(step(() => r.session.undo(), [1, 6, 3], 'a resignation taken back changes the result'), 1);
  assert.equal(step(() => r.session.markCounted(), [1, 6, 3], 'markCounted'), 0);
  assert.equal(step(() => r.session.newGame(), [2, 7, 3], 'newGame: the position and trial counters are never reset'), 1);
  assert.equal(step(() => r.session.restore(saved({ moves: OPENING })), [3, 8, 3], 'restore'), 1);
  assert.equal(step(() => r.session.tryMove(ref('9776')), [3, 8, 4], 'trial'), 1);
  assert.equal(step(() => r.session.restore(saved({ moves: OPENING })), [4, 9, 4], 'restore over a trial'), 1);
  // the scope is a fresh object each time
  const scope = r.session.scope();
  scope.game = 99;
  assert.equal(r.session.scope().game, 4);
  // ... and so is the scope an event carries: a subscriber that writes to it does not disturb the next batch
  r.session.newGame();
  const carried = r.take()[0];
  assert.deepEqual(carried, { type: 'scope', scope: { game: 5, position: 10, trial: 0 } });
  carried.scope.position = 99;
  carried.scope.trial = 99;
  r.session.select(7, 7);
  assert.equal(r.labels(), 'selection change', 'no scope event: no scope number changed');
  assert.deepEqual(r.session.scope(), { game: 5, position: 10, trial: 0 });
});

test('select and deselect by phase', () => {
  // select: childTurn | selected only
  let r = inPhase('childTurn');
  assert.deepEqual(r.session.select(9, 1), { ok: true });
  assert.equal(r.state().phase, 'selected');
  assert.deepEqual(r.session.select(9, 1), { ok: true }, 'the same piece again');
  assert.deepEqual(r.state().selected, at(9, 1));
  assert.deepEqual(r.session.select(9, 7), { ok: true }, 'another piece');
  assert.deepEqual(r.state().selected, at(9, 7));
  r.take();
  refused(r, () => r.session.select(5, 5), 'empty');
  refused(r, () => r.session.select(0, 0), 'not-yours');
  assert.deepEqual(r.state().selected, at(9, 7), 'a refused select keeps the piece in the hand');
  r = stuckAdvisorRig();
  refused(r, () => r.session.select(9, 3), 'no-moves');
  for (const phase of ['tentative', 'opponentTurn', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.select(9, 1), 'wrong-phase', phase);
  }

  // deselect: selected only
  for (const phase of ['childTurn', 'tentative', 'opponentTurn', 'over']) {
    r = inPhase(phase);
    refused(r, () => r.session.deselect(), 'wrong-phase', phase);
  }
  r = inPhase('selected');
  assert.deepEqual(r.session.deselect(), { ok: true });
  assert.equal(r.state().phase, 'childTurn');

  // a piece whose legal moves answer a check: only those are targets
  r = rig({ humanColor: 'black' });
  play(r.session, PERPETUAL.slice(0, 5));                        // the black king on (1,4) is checked from (1,5)
  r.session.select(1, 4);
  assert.deepEqual(r.state().targets, engine.getPieceLegalMoves(r.state().board, 1, 4));
  assert.ok(r.state().targets.length > 0);
  r.take();
  refused(r, () => r.session.tapSquare(3, 2), 'no-moves', 'a pawn cannot answer the check');
});

test('coordinates that are not integers throw; points off the board are simply not there', () => {
  const r = inPhase('childTurn');
  const before = view(r.state());
  for (const [row, col] of [[1.5, 2], ['7', 7], [7, null], [NaN, 0], [undefined, undefined]]) {
    assert.throws(() => r.session.tapSquare(row, col), TypeError);
    assert.throws(() => r.session.select(row, col), TypeError);
  }
  assert.equal(view(r.state()), before);
  assert.deepEqual(r.take(), []);
  refused(r, () => r.session.tapSquare(10, 0), 'empty');
  refused(r, () => r.session.tapSquare(-1, 3), 'empty');
  refused(r, () => r.session.select(0, 9), 'empty');
  r.session.select(9, 7);
  r.take();
  refused(r, () => r.session.tapSquare(10, 0), 'not-a-target');
  // a save that is no save is a programmer error as well, and leaves the game alone
  const held = view(r.state());
  assert.throws(() => r.session.restore(null), TypeError);
  assert.throws(() => r.session.restore({ humanColor: 'red' }), TypeError);
  assert.throws(() => r.session.restore({ ...saved(), moves: '7774' }), TypeError);
  assert.equal(view(r.state()), held);
  assert.deepEqual(r.take(), []);
});

test('markCounted is saved at once and survives undo and reload', () => {
  const r = rig({ humanColor: 'red' });
  play(r.session, MATE);
  r.take();
  assert.equal(r.state().counted, false);
  const positionId = r.state().positionId;
  assert.deepEqual(r.session.markCounted(), { ok: true });
  assert.equal(r.state().counted, true);
  const events = r.take();
  assert.equal(events.map(label).join(' '), 'change(persist)', 'so that a reload never counts the game twice');
  assert.equal(r.state().positionId, positionId);
  assert.equal(r.session.serialize().counted, true);
  assert.deepEqual(r.session.markCounted(), { ok: true });
  assert.deepEqual(r.take(), [], 'nothing changes the second time');

  r.session.undo();
  assert.equal(r.state().counted, true, 'the game is counted once even if it is finished again');
  child(r.session, MATE[6]);
  assert.equal(r.state().counted, true);
  assert.equal(reload(r.session).copy.getState().counted, true);
  r.session.newGame();
  assert.equal(r.state().counted, false, 'a new game is a new count');
});

test('selectors', () => {
  // canHint, canAsk and canUndo by phase
  const expected = {
    childTurn: { hint: true, ask: true, undo: true },
    selected: { hint: true, ask: true, undo: true },
    tentative: { hint: false, ask: true, undo: true },
    opponentTurn: { hint: false, ask: false, undo: true },
    over: { hint: false, ask: true, undo: true },
  };
  for (const phase of PHASES) {
    const s = inPhase(phase).state();
    assert.deepEqual({ hint: canHint(s), ask: canAsk(s), undo: canUndo(s) }, expected[phase], phase);
  }
  let r = inPhase('childTurn');
  r.session.requestHint();
  r.session.requestHint();
  assert.equal(canHint(r.state()), true);
  r.session.requestHint();
  assert.equal(canHint(r.state()), false, 'all three pouches are open');

  // canUndo is true exactly when undo() would do something
  r = rig({ humanColor: 'red' });
  assert.equal(canUndo(r.state()), false, 'no move yet');
  r.session.select(7, 7);
  assert.equal(canUndo(r.state()), false);
  r.session.tryMove(ref('7774'));
  assert.equal(canUndo(r.state()), true, 'a trial can be taken back');
  r.session.confirm();
  assert.equal(canUndo(r.state()), true, 'the rival is thinking');
  r = rig({ humanColor: 'black' });
  assert.equal(canUndo(r.state()), false, 'the rival opens');
  rival(r.session, '7774');
  assert.equal(canUndo(r.state()), false, 'only the rival\'s opening move');
  child(r.session, '0726');
  rival(r.session, '9776');
  assert.equal(canUndo(r.state()), true);

  // displayBoard follows the trial; the committed board does not
  r = inPhase('selected');
  assert.equal(displayBoard(r.state()), r.state().board);
  r.session.tryMove(ref('9776'));
  assert.equal(displayBoard(r.state()), r.state().trial.board);
  assert.equal(displayBoard(r.state())[7][6].type, 'horse');
  assert.equal(displayBoard(r.state())[9][7], null);
  assert.equal(r.state().board[9][7].type, 'horse');

  // fenOf and historyFens
  r = rig({ humanColor: 'red' });
  assert.equal(fenOf(r.state()), START);
  assert.deepEqual(historyFens(r.state()), []);
  play(r.session, OPENING);
  assert.equal(fenOf(r.state()), replay(OPENING).fen);
  assert.deepEqual(historyFens(r.state()), [START, replay(['7774']).fen], 'oldest first, without the current position');
  r.session.tryMove(ref('7434'));
  assert.equal(fenOf(r.state()), replay(OPENING).fen, 'a trial is not the position');
  assert.deepEqual(capturedPieces(r.state()), { byRed: [], byBlack: [] }, 'nor a capture');
  r.session.confirm();                                           // 炮五进四 takes the centre pawn
  assert.deepEqual(historyFens(r.state()), [], 'nothing since the capture but the position itself');
  rival(r.session, '2634');                                      // 马7进5 takes the cannon
  assert.deepEqual(historyFens(r.state()), []);
  child(r.session, '9776');
  rival(r.session, '0010');
  const line = [...OPENING, '7434', '2634', '9776', '0010'];
  assert.deepEqual(historyFens(r.state()), [replay(line.slice(0, 4)).fen, replay(line.slice(0, 5)).fen]);

  // capturedPieces: who took what, in order
  const taken = capturedPieces(r.state());
  assert.deepEqual(taken.byRed, [{ id: 'black-pawn-4', type: 'pawn', color: 'black' }]);
  assert.deepEqual(taken.byBlack, [{ id: 'red-cannon-7', type: 'cannon', color: 'red' }]);
  r.session.undo();
  r.session.undo();
  assert.deepEqual(capturedPieces(r.state()), { byRed: [], byBlack: [] }, 'taken back');
});

test('results the engine reports are mapped as 5.4 says', () => {
  // king-captured reads as checkmate; stalemate and the draw reasons pass through
  let forced = null;
  let draw = null;
  const wrapped = {
    ...engine,
    getGameStatus: (board, turn) => forced ?? engine.getGameStatus(board, turn),
    drawStatus: (...args) => draw ?? engine.drawStatus(...args),
  };
  const make = () => {
    forced = null;
    draw = null;
    const r = rig({ humanColor: 'red', deps: { engine: wrapped } });
    r.session.tryMove(ref('7774'));
    return r;
  };

  let r = make();
  r.session.retract();
  forced = { over: true, winner: 'red', reason: 'king-captured', check: true };
  r.session.tryMove(ref('7774'));
  r.session.confirm();
  assert.deepEqual([r.state().phase, r.state().result], ['over', { winner: 'red', reason: 'checkmate' }]);

  r = make();
  r.session.confirm();
  forced = { over: true, winner: 'red', reason: 'stalemate', check: false };
  r.session.opponentMove(r.state().positionId, ref('0726'));
  assert.deepEqual([r.state().phase, r.state().result], ['over', { winner: 'red', reason: 'stalemate' }]);
  assert.equal(r.state().history[1].flags.mate, false, 'a stalemate is not a mate');

  r = make();
  draw = { draw: true, reason: 'no_attackers' };
  r.session.confirm();
  assert.deepEqual([r.state().phase, r.state().result], ['over', { winner: null, reason: 'no_attackers' }]);
  forced = null;
  draw = null;
});

test('a capture is tried like any other move: the piece stays on the committed board until the second tap on it', () => {
  const r = inPhase('childTurn');                                // 1. 炮二平五 马8进7: the cannon on (7,4) can take the centre pawn
  const s = r.state();
  const pawn = s.board[3][4];
  assert.deepEqual(pawn, { id: 'black-pawn-4', type: 'pawn', color: 'black' });
  r.session.tapSquare(7, 4);
  assert.ok(s.targets.some(move => moveCode(move) === '7434' && move.captured === pawn), 'the pawn is a target');
  r.take();

  // first tap on the pawn: a trial (the view shows it as an aim), nothing is taken yet
  assert.deepEqual(r.session.tapSquare(3, 4), { ok: true });
  const trial = s.trial;
  assert.equal(s.phase, 'tentative');
  assert.equal(trial.move.captured, pawn);
  assert.equal(trial.notation, '炮五进四');
  assert.deepEqual(trial.flags, flagsByTheBook(s.board, trial.move));
  assert.equal(s.board[3][4], pawn, 'the committed board keeps the pawn');
  assert.equal(s.board[7][4].type, 'cannon');
  assert.deepEqual([displayBoard(s)[3][4].type, displayBoard(s)[7][4]], ['cannon', null]);
  assert.deepEqual(capturedPieces(s), { byRed: [], byBlack: [] });
  assert.equal(s.history.length, 2);
  assert.equal(r.labels(), 'scope trial:start change');
  refused(r, () => r.session.tapSquare(0, 0), 'not-a-target', 'another piece of the rival, out of reach: the aim stays');

  // the origin takes the aim back
  assert.deepEqual(r.session.tapSquare(7, 4), { ok: true });
  assert.deepEqual([s.phase, s.trial, s.board[3][4]], ['selected', null, pawn]);
  r.take();

  // aim again, then the second tap on the pawn commits the capture
  r.session.tapSquare(3, 4);
  const aim = s.trial;
  r.take();
  assert.deepEqual(r.session.tapSquare(3, 4), { ok: true });
  assert.equal(s.phase, 'opponentTurn');
  assert.deepEqual([s.board[3][4].type, s.board[3][4].color, s.board[7][4]], ['cannon', 'red', null]);
  const events = r.take();
  assert.equal(events.map(label).join(' '), 'scope move:committed opponent:turn change(persist)');
  assert.equal(events[1].trialId, aim.id);
  assert.equal(events[1].ply.move.captured, pawn);
  assert.equal(events[1].ply.record.capture, true);
  assert.equal(events[1].ply.before[3][4], pawn, 'the ply remembers the board it was played on');
  assert.deepEqual(capturedPieces(s), { byRed: [pawn], byBlack: [] });
  assert.deepEqual(historyFens(s), [], 'a capture starts the repetition history again');

  // taking the move back puts the very same piece back
  assert.deepEqual(r.session.undo(), { ok: true, plies: 1 });
  assert.equal(s.board[3][4], pawn);
  assert.deepEqual(capturedPieces(s), { byRed: [], byBlack: [] });
  assert.equal(fenOf(s), replay(OPENING).fen);
});

test('restore with a trial on the board ends that trial first, as newGame does', () => {
  // in progress: scope  trial:end(newgame)  game:start  child:turn  change
  let r = inPhase('childTurn');
  r.session.requestHint();
  r.session.tryMove(ref('9776'));
  r.take();
  const open = r.state().trial;
  const before = r.session.scope();
  assert.deepEqual([r.state().hint.level, r.state().attempt.tries, before.trial], [1, 1, open.id]);
  assert.deepEqual(r.session.restore(saved({ moves: OPENING })), { ok: true, applied: 2, truncatedAt: null });
  let events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:end(newgame) game:start child:turn change');
  assert.deepEqual(events[0].scope, { game: before.game + 1, position: before.position + 1, trial: 0 });
  assert.equal(events[1].trial, open, 'the trial that was on the board');
  const s = r.state();
  assert.deepEqual([s.phase, s.trial, s.selected, s.targets, s.forbidden, s.attempt, s.hint], ['childTurn', null, null, [], [], FRESH_ATTEMPT, { level: 0 }]);
  assert.equal(s.trialId, open.id, 'the trial counter is not reset');

  // a finished save and a truncated save: the same, with their own endings
  r = inPhase('tentative');
  r.session.restore(saved({ moves: MATE }));
  assert.equal(r.labels(), 'scope trial:end(newgame) game:start change');
  assert.deepEqual([r.state().phase, r.state().trial], ['over', null]);
  r = inPhase('tentative');
  r.session.restore(saved({ humanColor: 'black', moves: ['7774', '0726', '0000'] }));
  events = r.take();
  assert.equal(events.map(label).join(' '), 'scope trial:end(newgame) game:start opponent:turn change(persist)');
  assert.equal(events[2].truncatedAt, 2);

  // a piece in the hand is simply put back: no trial, no trial:end
  r = inPhase('selected');
  r.session.restore(saved({ moves: OPENING }));
  assert.equal(r.labels(), 'scope game:start child:turn change');
  assert.deepEqual([r.state().selected, r.state().targets], [null, []]);
});

test('a forbidden move that is the only move left can be tried, and the trial says it draws', () => {
  // engine.playableMoves gives the forbidden moves back when the side has nothing else (4.2), so such a move can become a
  // trial although Trial.repeat has no 'forbidden' (3.7). Committed, it is the third occurrence: the trial carries 'draw'.
  let verdict = null;
  const wrapped = { ...engine, judgeMove: (...args) => verdict ?? engine.judgeMove(...args) };
  const r = rig({ humanColor: 'red', deps: { engine: wrapped } });
  r.session.tryMove(ref('7774'));
  assert.equal(r.state().trial.repeat, 'ok');
  for (const [judged, repeat] of [['repeat', 'repeat'], ['draw', 'draw'], ['forbidden', 'draw']]) {
    verdict = judged;
    assert.deepEqual(r.session.tryMove(ref('7775')), { ok: true });
    assert.equal(r.state().trial.repeat, repeat, judged);
    assert.deepEqual(r.session.retract(), { ok: true });
  }
});

test('a game never outgrows what a save can hold', () => {
  // SavedGame.moves: at most 2000 are accepted on load (3.9). A migrated game counts its move limit from drawFrom (13.3),
  // so the session ends it at 2000 plies whatever drawFrom says, and replays at most 2000 moves.
  const marathon = longGame(2001, { seed: 5, drawFree: false, quiet: true });
  const r = rig();
  assert.deepEqual(r.session.restore(saved({ moves: marathon.slice(0, 1999), drawFrom: 1999 })), { ok: true, applied: 1999, truncatedAt: null });
  assert.equal(r.state().phase, 'opponentTurn', '1999 plies, none of them counted: still playing');
  rival(r.session, marathon[1999]);
  assert.equal(r.state().phase, 'over');
  assert.deepEqual(r.state().result, { winner: null, reason: 'move_limit' });
  assert.equal(r.session.serialize().moves.length, 2000);
  const { copy } = reload(r.session);
  assert.deepEqual(truth(copy.getState()), truth(r.state()));

  r.take();
  assert.deepEqual(r.session.restore(saved({ moves: marathon, drawFrom: 2001 })), { ok: true, applied: 2000, truncatedAt: 2000 });
  assert.equal(r.state().history.length, 2000);
  assert.equal(r.labels(), 'scope game:start change(persist)');
});

test('session.js is pure logic: it imports only what section 2 allows and touches no DOM, timer or worker', () => {
  const source = readFileSync(new URL('../../../src/game/session.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specifiers = [...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g), ...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) {
    assert.ok(['../core/engine.js', '../core/notation.js', '../core/codes.js'].includes(specifier), `unexpected import ${specifier}`);
  }
  for (const name of ['document', 'window', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'Worker', 'localStorage', 'fetch', 'postMessage']) {
    assert.equal(new RegExp(`\\b${name}\\b`).test(code), false, `${name} appears in session.js`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// random walk
// ---------------------------------------------------------------------------------------------------------------

const BATCH = {
  select: /^selection change$/,
  tryMove: /^scope (trial:end\(replaced\) )?trial:start change$/,
  retract: /^scope trial:end\(retract\) selection change$/,
  confirm: /^scope move:committed (opponent:turn|game:over) change\(persist\)$/,
  requestHint: /^hint change$/,
  undo: /^scope undo child:turn change\(persist\)$/,
  resign: /^scope (trial:end\(resign\) )?game:over change\(persist\)$/,
  newGame: /^scope (trial:end\(newgame\) )?game:start (child:turn|opponent:turn) change\(persist\)$/,
  restore: /^scope (trial:end\(newgame\) )?game:start( child:turn| opponent:turn)? change(\(persist\))?$/,
  markCounted: /^change\(persist\)$/,
  opponentMove: /^scope move:committed (child:turn|game:over) change\(persist\)$/,
  opponentFailed: /^opponent:failed change$/,
  retryOpponent: /^opponent:turn\(retry\) change$/,
};
/** The batches a successful command may produce, in the notation of 5.7. */
const ALLOWED = {
  select: [[BATCH.select]],
  deselect: [[BATCH.select]],
  tryMove: [[BATCH.tryMove]],
  retract: [[BATCH.retract]],
  confirm: [[BATCH.confirm]],
  requestHint: [[BATCH.requestHint]],
  undo: [[BATCH.undo], [BATCH.retract]],
  resign: [[BATCH.resign]],
  newGame: [[BATCH.newGame]],
  restore: [[BATCH.restore]],
  markCounted: [[BATCH.markCounted], []],
  opponentMove: [[BATCH.opponentMove]],
  opponentFailed: [[BATCH.opponentFailed]],
  retryOpponent: [[BATCH.retryOpponent]],
  tapSquare: [[BATCH.select], [BATCH.tryMove], [BATCH.retract], [BATCH.confirm], [BATCH.retract, BATCH.select]],
};

test('commands issued from inside subscribers: every event reaches every subscriber in order and no batch is torn', () => {
  // What a director does all day: react to an event with another command. Three subscribers, each of which may issue
  // random commands from inside its handler; one of them also throws now and then.
  const shapes = Object.values(BATCH);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  let nested = 0;
  let thrown = 0;
  try {
    for (const seed of [1, 2, 3]) {
      const rng = mulberry32(seed);
      const chance = (p) => rng() < p;
      const pick = (list) => list[Math.floor(rng() * list.length)];
      let ids = 0;
      const session = createSession({ now: () => NOW, makeId: () => `g-nest${String(++ids).padStart(4, '0')}` });
      const s = session.getState();
      const stream = [];                                           // [subscriber, event] in call order
      let budget = 0;                                              // commands the subscribers may still issue in this step
      const command = () => {
        const x = rng();
        if (x < 0.10) { const move = pick(s.targets); return () => session.tapSquare(move?.to.row ?? 4, move?.to.col ?? 4); }
        if (x < 0.25) { const move = pick(engine.getLegalMoves(s.board, s.humanColor)); return () => session.tapSquare(move?.from.row ?? 0, move?.from.col ?? 0); }
        if (x < 0.40) { const move = pick(engine.getLegalMoves(s.board, s.humanColor)); return () => session.tryMove(move ?? null); }
        if (x < 0.52) return () => session.confirm();
        if (x < 0.68) { const move = pick(engine.getLegalMoves(s.board, s.turn)); return () => session.opponentMove(s.positionId, move ?? null); }
        if (x < 0.74) return () => session.undo();
        if (x < 0.79) return () => session.requestHint();
        if (x < 0.83) return () => session.retract();
        if (x < 0.85) return () => session.resign();
        if (x < 0.88) return () => session.newGame({ humanColor: chance(0.5) ? 'red' : 'black' });
        if (x < 0.91) { const game = saved({ ...session.serialize() }); return () => session.restore(game); }
        if (x < 0.94) return () => session.opponentFailed(s.positionId);
        if (x < 0.97) return () => session.retryOpponent();
        return () => session.tapSquare(1.5, 2);                    // a programmer error: it throws, here or inside a subscriber
      };
      for (const who of ['a', 'b', 'c']) {
        session.subscribe((event, state) => {
          assert.equal(state, s);
          stream.push([who, event]);
          if (budget > 0 && chance(0.3)) {
            budget--;
            nested++;
            command()();
          }
          if (who === 'b' && chance(0.05)) {
            thrown++;
            throw new Error('boom');
          }
        });
      }
      session.newGame();
      let told = null;                                             // the scope of the last scope event
      let cursor = 0;
      for (let step = 0; step < 400; step++) {
        budget = Math.floor(rng() * 4);
        const run = command();
        try {
          run();
        } catch (error) {
          assert.ok(error instanceof TypeError, `step ${step}: ${error && error.stack}`);
        }
        const part = stream.slice(cursor);
        cursor = stream.length;
        assert.equal(part.length % 3, 0);
        let batch = [];
        for (let i = 0; i < part.length; i += 3) {
          const event = part[i][1];
          assert.deepEqual([part[i][0], part[i + 1][0], part[i + 2][0]], ['a', 'b', 'c'], 'registration order, one event at a time');
          assert.ok(part[i + 1][1] === event && part[i + 2][1] === event);
          batch.push(event);
          if (event.type === 'scope') {
            assert.equal(batch.length, 1, 'scope opens its batch');
            assert.notDeepEqual(event.scope, told, 'a scope event only when a scope number changed');
            told = event.scope;
          }
          if (event.type !== 'change') continue;
          const line = batch.map(label).join(' ');
          assert.ok(shapes.some(shape => shape.test(line)), `seed ${seed}, step ${step}: a batch that is no row of 5.7: ${line}`);
          batch = [];
        }
        assert.deepEqual(batch, [], 'the last batch is complete');
        assert.deepEqual(told, session.scope(), 'the last scope told is the scope');
        // nothing is left in the queue: a refused command delivers nothing
        budget = 0;
        assert.deepEqual(session.opponentMove(-1, null), { ok: false, reason: 'stale' });
        assert.equal(stream.length, cursor);
      }
    }
  } finally {
    console.error = original;
  }
  assert.ok(nested > 300, 'subscribers issued commands');
  assert.ok(thrown > 20, 'subscribers threw');
  assert.ok(errors.length >= thrown, 'every failure was logged');
});

/**
 * Drives one session with `steps` random commands and checks the invariants of section 5 after every one.
 * `wild` is the share of commands drawn blindly from the whole command set; the others are what a player or the
 * director would most likely do in the phase, so that games reach captures, checks, mates and draws.
 * `fixtures` is the weight of "restore a prepared save" among the blind commands.
 */
function walk({ seed, steps, wild, fixtures: fixtureWeight = 0.25 }) {
  const rng = mulberry32(seed);
  const chance = (p) => rng() < p;
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const clock = { t: NOW };
  let ids = 0;
  const session = createSession({ now: () => clock.t, makeId: () => `g-walk${(++ids).toString(36).padStart(4, '0')}` });
  const s = session.getState();
  const stats = { commands: {}, refusals: {}, phases: {}, results: {}, plies: 0, longest: 0, reloads: 0, forbiddenSeen: 0 };
  const count = (bag, key) => { bag[key] = (bag[key] ?? 0) + 1; };

  let batches = [];
  let current = [];
  let strayStates = 0;
  session.subscribe((event, state) => {
    if (state !== s) strayStates++;
    current.push(event);
    if (event.type === 'change') {
      batches.push(current);
      current = [];
    }
  });

  const fixtures = [
    () => fixture('v2-midgame.json'),
    () => fixture('v2-one-before-mate.json'),
    () => migrateV1(fixture('v1-repetition.json'), NOW).game,
    () => migrateV1(fixture('v1-illegal-third-move.json'), NOW).game,
    () => migrateV1(fixture('v1-resigned.json'), NOW).game,
    () => migrateV1(fixture('v1-121-quiet-plies.json'), NOW).game,
    () => saved({ moves: MATE }),
    () => saved({ humanColor: 'black', moves: PERPETUAL }),
    () => saved({ moves: PERPETUAL }),
    () => saved({ humanColor: 'black', moves: SHUFFLE.slice(0, 7) }),
  ];
  const older = [];                                              // saves of earlier moments, to go back to

  // ---- what the checks remember between commands ----
  const verified = new WeakMap();                                // ply -> {index, prev}: plies already checked in this place
  let last = { ids: [0, 0, 0], history: s.history, board: s.board, record: '', selection: '', trial: 0 };
  let mirror = '';                                               // persisted() of the last reload

  const ownSquares = () => {
    const list = [];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 9; col++) {
        if (s.board[row][col]?.color === s.humanColor) list.push([row, col]);
      }
    }
    return list;
  };
  /** A move for the side to move: sometimes a mate, often a capture, else anything legal. */
  const someMove = (color) => {
    const legal = engine.getLegalMoves(s.board, color);
    if (legal.length === 0) return null;
    if (chance(0.06)) {
      const mate = legal.find(move => engine.getLegalMoves(engine.applyMove(s.board, move), engine.opposite(color)).length === 0);
      if (mate) return mate;
    }
    const captures = legal.filter(move => move.captured);
    if (captures.length > 0 && chance(0.4)) return pick(captures);
    return pick(legal);
  };
  const randomRef = () => ({ from: at(Math.floor(rng() * 10), Math.floor(rng() * 9)), to: at(Math.floor(rng() * 10), Math.floor(rng() * 9)) });
  const tap = (row, col) => ({ name: 'tapSquare', run: () => session.tapSquare(row, col) });
  const restoreOf = (game) => ({ name: 'restore', run: () => session.restore(game) });
  const currentSave = () => ({ ...JSON.parse(JSON.stringify(session.serialize())), activeMs: 0, seed: 1, skill: null, memory: null });

  const blind = [
    [10, () => tap(Math.floor(rng() * 10), Math.floor(rng() * 9))],
    [8, () => tap(...(pick(ownSquares()) ?? [0, 0]))],
    [8, () => { const move = pick(s.targets); return move ? tap(move.to.row, move.to.col) : tap(4, 4); }],
    [3, () => (s.forbidden.length > 0 ? tap(s.forbidden[0].to.row, s.forbidden[0].to.col) : tap(5, 4))],
    [6, () => (s.trial ? tap(s.trial.move.to.row, s.trial.move.to.col) : tap(0, 4))],
    [3, () => (s.trial ? tap(s.trial.move.from.row, s.trial.move.from.col) : tap(9, 4))],
    [3, () => { const [row, col] = chance(0.7) ? (pick(ownSquares()) ?? [0, 0]) : [Math.floor(rng() * 10), Math.floor(rng() * 9)]; return { name: 'select', run: () => session.select(row, col) }; }],
    [2, () => ({ name: 'deselect', run: () => session.deselect() })],
    [6, () => { const move = chance(0.75) ? someMove(s.humanColor) : chance(0.5) ? someMove(s.turn) : randomRef(); return { name: 'tryMove', run: () => session.tryMove(move ?? randomRef()) }; }],
    [1, () => ({ name: 'tryMove', run: () => session.tryMove(s.forbidden[0] ?? randomRef()) })],
    [2, () => ({ name: 'retract', run: () => session.retract() })],
    [1, () => ({ name: 'retract', run: () => session.retract({ keepSelection: false }) })],
    [4, () => ({ name: 'confirm', run: () => session.confirm() })],
    [4, () => ({ name: 'requestHint', run: () => session.requestHint() })],
    [4, () => ({ name: 'undo', run: () => session.undo() })],
    [1, () => ({ name: 'resign', run: () => session.resign() })],
    [0.4, () => { const opts = chance(0.3) ? undefined : { humanColor: chance(0.5) ? 'red' : 'black' }; return { name: 'newGame', run: () => session.newGame(opts) }; }],
    [1.5, () => restoreOf(currentSave())],
    [0.4, () => restoreOf(older.length > 0 ? pick(older) : currentSave())],
    [0.4, () => { const game = currentSave(); game.moves = [...game.moves, chance(0.5) ? '0000' : 'zz']; return restoreOf(game); }],
    [0.3, () => { const game = currentSave(); game.moves = game.moves.slice(0, Math.floor(rng() * (game.moves.length + 1))); return restoreOf(game); }],
    [fixtureWeight, () => restoreOf(pick(fixtures)())],
    [0.6, () => ({ name: 'markCounted', run: () => session.markCounted() })],
    [8, () => { const move = someMove(s.turn); return { name: 'opponentMove', run: () => session.opponentMove(s.positionId, move ?? randomRef()) }; }],
    [1, () => { const move = someMove(s.turn); return { name: 'opponentMove', run: () => session.opponentMove(s.positionId - 1 - Math.floor(rng() * 3), move ?? randomRef()) }; }],
    [1, () => ({ name: 'opponentMove', run: () => session.opponentMove(s.positionId, chance(0.5) ? randomRef() : null) })],
    [1.5, () => ({ name: 'opponentFailed', run: () => session.opponentFailed(s.positionId) })],
    [0.5, () => ({ name: 'opponentFailed', run: () => session.opponentFailed(s.positionId + 1) })],
    [1.5, () => ({ name: 'retryOpponent', run: () => session.retryOpponent() })],
  ];
  const blindTotal = blind.reduce((sum, [weight]) => sum + weight, 0);
  const blindCommand = () => {
    let x = rng() * blindTotal;
    for (const [weight, make] of blind) {
      x -= weight;
      if (x < 0) return make();
    }
    return blind[0][1]();
  };
  const likelyCommand = () => {
    if (s.gameId === 0) return { name: 'newGame', run: () => session.newGame({ humanColor: chance(0.5) ? 'red' : 'black' }) };
    if (s.phase === 'childTurn') return tap(...(pick(ownSquares()) ?? [0, 0]));
    if (s.phase === 'selected') {
      if (s.targets.length === 0) return tap(...(pick(ownSquares()) ?? [0, 0]));
      const captures = s.targets.filter(move => move.captured);
      const move = captures.length > 0 && chance(0.5) ? pick(captures) : pick(s.targets);
      return tap(move.to.row, move.to.col);
    }
    if (s.phase === 'tentative' && s.trial) {
      if (chance(0.85)) return tap(s.trial.move.to.row, s.trial.move.to.col);
      const other = pick(s.targets);
      return tap(other.to.row, other.to.col);
    }
    if (s.phase === 'opponentTurn') {
      if (s.opponentFailed && chance(0.5)) return { name: 'retryOpponent', run: () => session.retryOpponent() };
      const move = someMove(s.turn);
      return { name: 'opponentMove', run: () => session.opponentMove(s.positionId, move ?? randomRef()) };
    }
    if (chance(0.55)) return { name: 'undo', run: () => session.undo() };
    if (chance(0.5)) return restoreOf(currentSave());
    return { name: 'newGame', run: () => session.newGame(chance(0.5) ? undefined : { humanColor: chance(0.5) ? 'red' : 'black' }) };
  };

  // ---- the checks ----

  function checkPlies() {
    const history = s.history;
    for (let i = 0; i < history.length; i++) {
      const ply = history[i];
      const prev = i === 0 ? null : history[i - 1];
      const seen = verified.get(ply);
      if (seen && seen.index === i && seen.prev === prev) continue;
      const color = i % 2 === 0 ? 'red' : 'black';
      assert.equal(ply.color, color);
      assert.equal(ply.by, color === s.humanColor ? 'child' : 'opponent');
      assert.equal(engine.boardToFen(ply.before, color), prev ? prev.record.key : START, 'each ply starts where the last one ended');
      assert.equal(ply.move.piece, ply.before[ply.move.from.row][ply.move.from.col]);
      assert.equal(ply.move.captured, ply.before[ply.move.to.row][ply.move.to.col]);
      assert.ok(engine.getPieceLegalMoves(ply.before, ply.move.from.row, ply.move.from.col).some(move => moveCode(move) === moveCode(ply.move)), 'a legal move');
      assert.equal(ply.notation, engine.moveToNotation(ply.before, ply.move));
      assert.deepEqual(ply.record, engine.plyRecord(ply.before, ply.move));
      assert.deepEqual(ply.flags, flagsByTheBook(ply.before, ply.move));
      verified.set(ply, { index: i, prev });
    }
  }

  function checkPosition() {
    // the board is the replay of the move list
    let board = engine.createInitialBoard();
    for (const ply of s.history) board = engine.applyMove(board, ply.move);
    assert.deepEqual(s.board, board, 'board = replay of the moves');
    assert.equal(s.turn, s.history.length % 2 === 0 ? 'red' : 'black');
    assert.equal(s.startKey, START);
    checkPlies();
    assert.equal(s.check, engine.isInCheck(s.board, s.turn));
    assert.deepEqual(s.checkers, s.check ? engine.checkers(s.board, s.turn) : []);
    assert.ok(Number.isInteger(s.drawFrom) && s.drawFrom >= 0 && s.drawFrom <= s.history.length);
    assert.ok(s.history.length <= 2000);
    // the result is what the rules say, or a resignation in a game the rules have not ended
    const natural = naturalResult(s);
    if (s.result && s.result.reason !== 'resign') assert.deepEqual(s.result, natural);
    else assert.equal(natural, null, 'a game that goes on (or was resigned) is not over by the rules');
  }

  function checkSelection() {
    if (s.phase !== 'selected' && s.phase !== 'tentative') {
      assert.deepEqual([s.selected, s.targets, s.forbidden], [null, [], []]);
      last.selection = '';
      return;
    }
    assert.ok(s.selected);
    const key = `${s.positionId}:${s.selected.row},${s.selected.col}`;
    if (key === last.selection) return;
    last.selection = key;
    const { row, col } = s.selected;
    assert.equal(s.board[row][col]?.color, s.humanColor, 'the picked piece is the child\'s');
    const { startKey, log } = drawWindow(s);
    const all = engine.getPieceLegalMoves(s.board, row, col);
    const playable = engine.playableMoves(startKey, log, s.board, s.turn).filter(move => move.from.row === row && move.from.col === col);
    assert.deepEqual(s.targets, playable);
    assert.deepEqual(s.forbidden, all.filter(move => !playable.some(other => moveCode(other) === moveCode(move))));
    assert.ok(all.length > 0);
    if (s.forbidden.length > 0) stats.forbiddenSeen++;
  }

  function checkTrial() {
    if (s.phase !== 'tentative') {
      assert.equal(s.trial, null);
      return;
    }
    const trial = s.trial;
    assert.ok(trial);
    assert.equal(trial.id, s.trialId);
    assert.deepEqual(s.selected, trial.move.from);
    if (trial.id === last.trial) return;
    last.trial = trial.id;
    assert.ok(s.targets.some(move => moveCode(move) === moveCode(trial.move)), 'the trial is one of the targets');
    assert.deepEqual(trial.board, engine.applyMove(s.board, trial.move));
    assert.equal(trial.notation, engine.moveToNotation(s.board, trial.move));
    assert.deepEqual(trial.status, engine.getGameStatus(trial.board, engine.opposite(s.turn)));
    assert.deepEqual(trial.flags, flagsByTheBook(s.board, trial.move));
    const { startKey, log } = drawWindow(s);
    const judged = engine.judgeMove(startKey, log, s.board, trial.move);
    assert.equal(trial.repeat, judged === 'forbidden' ? 'draw' : judged);
    assert.equal(trial.startedAt, clock.t);
  }

  function checkPhase() {
    assert.ok(PHASES.includes(s.phase));
    assert.deepEqual(session.scope(), { game: s.gameId, position: s.positionId, trial: s.trial ? s.trial.id : 0 });
    assert.equal(session.getState(), s, 'one state object for the life of the session');
    const childToMove = s.turn === s.humanColor;
    if (s.phase === 'over') {
      if (s.gameId > 0) {
        assert.ok(s.result);
        assert.equal(typeof s.endedAt, 'number');
      }
    } else {
      assert.equal(s.result, null);
      assert.equal(s.endedAt, null);
      assert.equal(childToMove, s.phase !== 'opponentTurn', 'the phase follows the side to move');
    }
    if (s.phase !== 'opponentTurn') assert.equal(s.opponentFailed, false);
    assert.ok([0, 1, 2, 3].includes(s.hint.level));
    assert.equal(s.attempt.first === null, s.attempt.tries === 0);
    assert.ok(s.attempt.hintAtFirst <= s.hint.level);
    if (s.phase === 'opponentTurn' || s.phase === 'over') assert.deepEqual([s.hint, s.attempt], [{ level: 0 }, FRESH_ATTEMPT]);
    if (s.phase === 'tentative') assert.ok(s.attempt.tries >= 1);
    // selectors agree with the tables
    assert.equal(canHint(s), (s.phase === 'childTurn' || s.phase === 'selected') && s.hint.level < 3);
    assert.equal(canAsk(s), s.gameId > 0 && s.phase !== 'opponentTurn');
    assert.equal(displayBoard(s), s.trial ? s.trial.board : s.board);
  }

  /** truth() without the board and the plies: those cannot change while positionId stands still (checkIds). */
  const persisted = (state) => JSON.stringify({ ...truth(state), board: null, history: state.history.length });

  function checkSave() {
    const record = session.serialize();
    assert.deepEqual(Object.keys(record), SAVE_KEYS);
    assert.ok(record.moves.length <= 2000);
    const text = JSON.stringify(record);
    if (text !== last.record) {
      // a new save: load it into a fresh session and compare everything a save must bring back
      last.record = text;
      const { copy, result } = reload(session);
      assert.deepEqual(result, { ok: true, applied: s.history.length, truncatedAt: null });
      assert.deepEqual(copy.serialize(), record);
      if (s.gameId > 0) assert.equal(JSON.stringify(truth(copy.getState())), JSON.stringify(truth(s)), 'serialize then restore gives an equal state');
      mirror = persisted(copy.getState());
      stats.reloads++;
      if (s.gameId > 0 && older.length < 40 && chance(0.05)) older.push({ ...JSON.parse(text), activeMs: 0, seed: 1, skill: null, memory: null });
    }
    if (s.gameId > 0) assert.equal(persisted(s), mirror, 'serialize then restore gives an equal state');
  }

  function checkCommand(command, result, before) {
    assert.equal(strayStates, 0);
    assert.equal(current.length, 0, 'every batch ends with change');
    assert.equal(typeof result, 'object');
    const lines = batches.map(batch => batch.map(label).join(' '));
    for (const batch of batches) {
      // scope first and only when a scope number changed; change last
      assert.equal(batch.filter(event => event.type === 'scope').length <= 1 && batch.findIndex(event => event.type === 'scope') <= 0, true);
      assert.equal(batch.at(-1).type, 'change');
    }
    const scoped = batches.flat().filter(event => event.type === 'scope');
    const scopeNow = session.scope();
    if (scoped.length > 0) assert.deepEqual(scoped.at(-1).scope, scopeNow);
    else assert.deepEqual(scopeNow, before.scope, 'no scope event: the scope did not change');
    if (scoped.length > 0) assert.notDeepEqual(scopeNow, before.scope, 'a scope event only when a scope number changed');

    if (result.ok === false) {
      assert.ok(REFUSALS.includes(result.reason), `refusal ${result.reason}`);
      count(stats.refusals, `${command.name}:${result.reason}`);
      if (command.name === 'opponentMove' && result.reason === 'illegal') {
        assert.deepEqual(lines, ['opponent:failed change']);
        assert.equal(s.opponentFailed, true);
        assert.equal(view({ ...s, opponentFailed: before.failed }), before.view);
      } else {
        assert.deepEqual(lines, [], `${command.name} refused with ${result.reason} emits nothing`);
        assert.equal(view(s), before.view, 'a refusal changes nothing');
      }
      if (command.name === 'undo') assert.equal(before.canUndo, false, 'canUndo was true but undo was refused');
      return;
    }
    assert.equal(result.ok, true);
    if (command.name === 'undo') assert.equal(before.canUndo, true, 'undo worked although canUndo was false');
    const shapes = ALLOWED[command.name];
    assert.ok(shapes.some(shape => shape.length === lines.length && shape.every((pattern, i) => pattern.test(lines[i]))),
      `${command.name} produced [${lines.join(' | ')}]`);
    for (const event of batches.flat()) {
      if (event.type === 'move:committed') {
        stats.plies++;
        assert.equal(event.ply, s.history[event.index]);
        assert.equal(event.index, s.history.length - 1);
      }
      if (event.type === 'game:over') count(stats.results, event.result.reason);
    }
  }

  function checkIds(before) {
    const now = [s.gameId, s.positionId, s.trialId];
    for (let i = 0; i < 3; i++) assert.ok(now[i] >= before.ids[i], 'ids never go back');
    assert.ok(now[2] - before.ids[2] <= 1, 'one trial at a time');
    if (s.positionId === before.ids[1]) {
      assert.equal(s.history, last.history, 'the committed position is touched only together with positionId');
      assert.equal(s.board, last.board);
      assert.equal(s.gameId, before.ids[0]);
    }
  }

  for (let step = 0; step < steps; step++) {
    clock.t += Math.floor(rng() * 4000);
    const before = { ids: [s.gameId, s.positionId, s.trialId], scope: session.scope(), view: view(s), canUndo: canUndo(s), failed: s.opponentFailed };
    const command = chance(wild) ? blindCommand() : likelyCommand();
    count(stats.commands, command.name);
    batches = [];
    let result;
    try {
      result = command.run();
    } catch (error) {
      assert.fail(`step ${step}: ${command.name} threw ${error && error.stack}`);
    }
    try {
      checkCommand(command, result, before);
      checkIds(before);
      checkPhase();
      if (s.positionId !== last.ids[1] || s.history !== last.history) checkPosition();
      checkSelection();
      checkTrial();
      checkSave();
    } catch (error) {
      error.message = `walk seed ${seed}, step ${step}, after ${command.name} -> ${JSON.stringify(result)} in phase ${s.phase}: ${error.message}`;
      throw error;
    }
    last.ids = [s.gameId, s.positionId, s.trialId];
    last.history = s.history;
    last.board = s.board;
    count(stats.phases, s.phase);
    stats.longest = Math.max(stats.longest, s.history.length);
  }
  return stats;
}

// SESSION_WALK_STEPS (commands per seed) and SESSION_WALK_SEEDS scale the walk; the defaults keep the unit run short.
// SESSION_WALK_REPORT=1 prints what the walk met.
const WALK_STEPS = Number(process.env.SESSION_WALK_STEPS) || 2000;
const WALK_SEEDS = (process.env.SESSION_WALK_SEEDS ?? '1').split(',').map(Number);

test('random walk: the invariants of section 5 hold after every command', () => {
  const total = { commands: {}, refusals: {}, phases: {}, results: {}, plies: 0, longest: 0, reloads: 0, forbiddenSeen: 0 };
  const merge = (stats) => {
    for (const bag of ['commands', 'refusals', 'phases', 'results']) {
      for (const [key, n] of Object.entries(stats[bag])) total[bag][key] = (total[bag][key] ?? 0) + n;
    }
    total.plies += stats.plies;
    total.reloads += stats.reloads;
    total.forbiddenSeen += stats.forbiddenSeen;
    total.longest = Math.max(total.longest, stats.longest);
  };
  const share = (part) => Math.ceil(WALK_STEPS * part);
  for (const seed of WALK_SEEDS) {
    merge(walk({ seed, steps: share(0.2), wild: 1 }));                                // every command blind: all the refusals, many resets
    merge(walk({ seed: seed + 1000, steps: share(0.2), wild: 0.3 }));
    merge(walk({ seed: seed + 2000, steps: share(0.5), wild: 0.08 }));               // long games: endgames, mates, draws
    merge(walk({ seed: seed + 3000, steps: share(0.1), wild: 1, fixtures: 8 }));      // prepared saves: migrated, truncated, finished, perpetual check
  }
  if (process.env.SESSION_WALK_REPORT) console.log(JSON.stringify(total, null, 1));

  // the walk went where it should
  for (const phase of PHASES) assert.ok(total.phases[phase] > 0, `phase ${phase} was visited`);
  for (const name of Object.keys(ALLOWED)) assert.ok(total.commands[name] > 0, `${name} was called`);
  const reasons = new Set(Object.keys(total.refusals).map(key => key.split(':')[1]));
  for (const reason of ['over', 'not-your-turn', 'wrong-phase', 'not-yours', 'no-moves', 'not-a-target', 'empty', 'trial-active', 'illegal', 'stale',
                        'nothing-to-undo']) {
    assert.ok(reasons.has(reason), `the refusal ${reason} was met`);
  }
  assert.ok(total.plies > WALK_STEPS / 10, 'games were played');
  assert.ok(total.reloads > WALK_STEPS / 10, 'saves were reloaded');
});
