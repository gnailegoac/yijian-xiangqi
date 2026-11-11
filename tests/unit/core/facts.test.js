// Unit tests of src/core/facts.js (contract section 14.1; rules in sections 4.6.1 to 4.6.4 and Appendix A6; suite in A7).
// Expected values come from the contract, from the v1 rules engine (engine.js, which shares no code with position.js),
// or from an independent recount in this file. Searches are bounded by maxDepth; nothing depends on the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fenToBoard, boardToFen, applyMove, getLegalMoves, getPieceLegalMoves, isInCheck, getGameStatus, checkers, moveToNotation,
} from '../../../src/core/engine.js';
import { toLine, describeMove } from '../../../src/core/notation.js';
import { Position, sqOf } from '../../../src/core/position.js';
import { MATE, WIN, scoreToCp, createSearcher, lineOf } from '../../../src/core/search.js';
import { DANGER_CODES, HINT_THEMES, PATTERN_CODES, PATTERN_NAME } from '../../../src/core/codes.js';
import {
  positionFacts, moveFacts, materialOutcome, verdictScale, quickVerdict, assessMove, hintFor, threatInfo, tacticalTest, habitTraps, openingName,
} from '../../../src/core/facts.js';
import { playoutPositions } from '../../helpers/playout.js';
import { TACTICAL_SUITE, PATTERN_EXAMPLES, V1_COACH_FIXTURES, REFERENCE_POSITIONS } from '../../helpers/positions.js';

const START = REFERENCE_POSITIONS.opening;
/** A time budget that never binds. */
const FOREVER = 3_600_000;
const code = m => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}`;
const ref = c => ({ from: { row: Number(c[0]), col: Number(c[1]) }, to: { row: Number(c[2]), col: Number(c[3]) } });
const other = color => (color === 'red' ? 'black' : 'red');
const key = s => s.row * 9 + s.col;
const sq = text => ({ row: Number(text[0]), col: Number(text[1]) });
const squares = list => list.map(s => `${s.row}${s.col}`);
/** The entry of a list of facts whose piece (or whose `field`) stands on the square "rc". */
const on = (list, at, field = 'piece') => list.find(item => `${item[field].at.row}${item[field].at.col}` === at);
const notations = line => line.moves.map(m => m.notation).join(' ');

// ---- independent recounts on the v1 rules engine ----

const VALUE = { king: 10000, rook: 900, cannon: 450, horse: 400, advisor: 200, elephant: 200, pawn: 100 };
/** Material of a piece in cp; a pawn across the river counts 200. */
const valueOf = (piece, row) => (piece.type === 'pawn' ? ((piece.color === 'red' ? row <= 4 : row >= 5) ? 200 : 100) : VALUE[piece.type]);

/** Legal captures of `color` on a square (a king is never captured). */
function capturesOn(board, color, at) {
  const victim = board[at.row][at.col];
  if (!victim || victim.type === 'king' || victim.color === color) return [];
  return getLegalMoves(board, color).filter(m => m.to.row === at.row && m.to.col === at.col);
}

/** The exact value of the captures on one square for the side to move: it may take with any legal capturer or stop. */
function exchangeBest(board, color, at) {
  const victim = board[at.row][at.col];
  let best = 0;
  for (const m of capturesOn(board, color, at)) best = Math.max(best, valueOf(victim, at.row) - exchangeBest(applyMove(board, m), other(color), at));
  return best;
}

/** The same with the rule of Appendix A2.4 as Position.see applies it: only the least valuable legal attacker recaptures. */
function exchangeLeast(board, color, at) {
  const caps = capturesOn(board, color, at);
  if (caps.length === 0) return 0;
  const victim = board[at.row][at.col];
  const least = caps.reduce((a, m) => (valueOf(m.piece, m.from.row) < valueOf(a.piece, a.from.row) ? m : a));
  return Math.max(0, valueOf(victim, at.row) - exchangeLeast(applyMove(board, least), other(color), at));
}

/** Value for the mover of a move and the best sequence of captures on its destination that follows. */
function exchangeValue(board, move) {
  const mover = board[move.from.row][move.from.col];
  const victim = board[move.to.row][move.to.col];
  return (victim ? valueOf(victim, move.to.row) : 0) - exchangeBest(applyMove(board, move), other(mover.color), move.to);
}

/** Value of the best capture of `color` on a square; -Infinity when there is none. */
function bestExchange(board, color, at) {
  return Math.max(-Infinity, ...capturesOn(board, color, at).map(m => exchangeValue(board, m)));
}

/** The pieces of `color` that attack a square, as a sorted key (Position.attackers, which position.test.js checks against brute force). */
function attackersOf(board, color, at) {
  return Position.fromBoard(board, 'red').attackers(sqOf(at.row, at.col), color === 'red' ? 0 : 1).sort((a, b) => a - b).join();
}

/**
 * What the other side wins on a piece of the side to move while that side is in check: the least it wins over every
 * answer to the check when that is a profit, else the least it wins over the answers that leave the piece where it is
 * with the same attackers and defenders (-Infinity when nothing attacks the piece or there is no such answer).
 */
function enPriseInCheck(board, turn, at) {
  const taker = other(turn);
  const attacking = attackersOf(board, taker, at), guarding = attackersOf(board, turn, at);
  if (attacking === '') return -Infinity;
  let worst = Infinity, calm = Infinity;
  for (const answer of getLegalMoves(board, turn)) {
    const moved = answer.from.row === at.row && answer.from.col === at.col;
    const next = applyMove(board, answer);
    const gain = bestExchange(next, taker, moved ? answer.to : at);
    worst = Math.min(worst, gain);
    if (!moved && attackersOf(next, taker, at) === attacking && attackersOf(next, turn, at) === guarding) calm = Math.min(calm, gain);
  }
  return worst >= 100 ? worst : calm === Infinity ? -Infinity : calm;
}

/** Checks-only forced checkmate for `color` within n of its moves, by the rules engine. */
function matesWithin(board, color, n) {
  const foe = other(color);
  for (const m of getLegalMoves(board, color)) {
    if (m.captured && m.captured.type === 'king') continue;
    const next = applyMove(board, m);
    if (!isInCheck(next, foe)) continue;
    const replies = getLegalMoves(next, foe);
    if (replies.length === 0) return true;
    if (n > 1 && replies.every(r => matesWithin(applyMove(next, r), color, n - 1))) return true;
  }
  return false;
}

/** Replay a line with the rules engine: every move legal, and the final position a checkmate won by `color`. */
function assertMatingLine(line, color, label) {
  let { board, turn } = fenToBoard(line.start);
  assert.equal(turn, color, label);
  for (const move of line.moves) {
    const legal = getLegalMoves(board, turn).find(m => code(m) === code(move));
    assert.ok(legal, `${label}: ${move.notation} is not legal`);
    assert.equal(move.notation, moveToNotation(board, legal), label);
    board = applyMove(board, legal);
    turn = other(turn);
  }
  const status = getGameStatus(board, turn);
  assert.deepEqual([status.over, status.reason, status.winner], [true, 'checkmate', color], label);
}

// ---- searches and hand-built tables ----

const searcher = createSearcher();
const analyze = (fen, options = {}) => searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 4, ...options });
/** The table of all moves and the pair analysis the `assess` job would hand to assessMove. */
function assess(fen, moveCode, { level = 5, depth = 4, compare } = {}) {
  const table = analyze(fen, { maxDepth: depth, allDepth: depth });
  const move = ref(moveCode);
  const compared = compare ? ref(compare) : table.lines[0].move;
  const rootMoves = code(compared) === moveCode ? [move] : [compared, move];
  const pair = analyze(fen, { maxDepth: depth, allDepth: depth, rootMoves });
  return { table, pair, assessment: assessMove({ fen, move, pair, table, level, compare: compared }) };
}

/** A RootLine with the given score; `pv` defaults to the move alone. */
function rootLine(moveCode, score, extra = {}) {
  const depth = extra.depth ?? 3;
  return {
    move: ref(moveCode), score, depth, upper: null, mate: null, pv: [ref(moveCode)], byDepth: Array(depth).fill(score), naive: score, repeats: 1,
    ...extra,
  };
}
/** An Analysis around hand-built lines (best first). */
function tableOf(fen, lines, extra = {}) {
  const depth = extra.depth ?? Math.max(...lines.map(l => l.depth));
  return { fen, turn: fenToBoard(fen).turn, depth, allDepth: depth, lines, nodes: 0, timeMs: 0, stopped: 'depth', ...extra };
}

// ---------------------------------------------------------------------------------------------------------------

test('status: hanging / guarded / loose / safe on constructed boards; free and now flags', () => {
  // Red to move. Black: king e10, cannon e9 (next to its king), rook a8, pawn e7. Red: cannon a5, rook e3, rook a1, elephant c1, king d1.
  const fen = '4k4/4c4/r8/4p4/9/C8/9/4R4/9/R1BK5 w';
  const facts = positionFacts(fen);
  assert.equal(facts.fen, fen);
  assert.equal(facts.turn, 'red');
  assert.equal(facts.check, null);
  const status = at => on(facts.pieces, at).status;
  assert.equal(facts.pieces.length, 9, 'every piece on the board is listed');
  // hanging: the pawn e7 can be taken by the rook for nothing; the rook e3 by the cannon over the pawn, at the price of the cannon
  assert.equal(status('34'), 'hanging');
  assert.equal(status('74'), 'hanging');
  // guarded: the cannon a5 is attacked by the rook a8 and defended by the rook a1 (rook for cannon does not pay)
  assert.equal(status('50'), 'guarded');
  assert.deepEqual(squares(on(facts.pieces, '50').attackers.map(p => p.at)), ['20']);
  assert.deepEqual(squares(on(facts.pieces, '50').defenders.map(p => p.at)), ['90']);
  // loose: a rook with neither attacker nor defender
  assert.equal(status('20'), 'loose');
  assert.equal(status('90'), 'loose');
  // safe: the cannon e9 is guarded by its king and not attacked; an elephant is never "loose"; kings
  assert.equal(status('14'), 'safe');
  assert.deepEqual(squares(on(facts.pieces, '14').defenders.map(p => p.at)), ['04']);
  assert.equal(status('92'), 'safe');
  assert.equal(status('04'), 'safe');
  assert.equal(status('93'), 'safe');

  // biggest gain first
  assert.deepEqual(facts.hanging.map(h => [h.piece.name, h.by.name, h.capture.notation, h.gain, h.points, h.free, h.now]), [
    ['五路车', '炮', '炮5进6', 450, 4.5, false, false],      // rook for cannon: not free; black is not on move
    ['卒', '五路车', '车五进四', 100, 1, true, true],          // nothing recaptures: free; red is on move
  ]);
  // the same board with black to move: the flags turn round, the facts do not
  const flipped = positionFacts(fen.replace(' w', ' b'));
  assert.deepEqual(flipped.hanging.map(h => [h.piece.name, h.gain, h.free, h.now]), [['五路车', 450, false, true], ['卒', 100, true, false]]);

  // material in points and the phase: R + R + C = 2250 and r + c = 1350 of rook / cannon / horse value
  assert.deepEqual(facts.material, { red: 9 + 9 + 4.5 + 2, black: 9 + 4.5 + 1, phase: 1 - (3600 - 1500) / 5500 });
  const start = positionFacts(START);
  assert.deepEqual(start.material, { red: 48, black: 48, phase: 0 });
  assert.deepEqual(start.hanging, []);
  // the aim of a cannon that does not win: the start cannons look at the guarded horses (400 - 450)
  assert.deepEqual(start.cannons.map(c => [c.cannon.name, c.screen.name, c.target.name, c.gain]), [
    ['八路炮', '2路炮', '2路马', -50], ['二路炮', '8路炮', '8路马', -50], ['2路炮', '八路炮', '八路马', -50], ['8路炮', '二路炮', '二路马', -50],
  ]);
  // a pawn across the river counts two points
  assert.equal(positionFacts('3k5/9/9/9/P8/9/9/9/9/4K4 w').material.red, 2);
  // a FEN with counters or the side letter r is normalised to "placement w|b"
  assert.equal(positionFacts(`${START.slice(0, -2)} r - - 0 1`).fen, START);
  // the side that is not on move must not be in check
  assert.throws(() => positionFacts('4k4/9/9/9/9/4R4/9/9/9/3K5 w'), RangeError);
});

test('a piece attacked together with the king is hanging even though it has a defender', () => {
  // The fork: the horse d3 checks the king and attacks the rook e5, which the pawn e4 defends. Red must answer the
  // check, the horse takes the rook and the pawn takes back: a rook for a horse, whatever red plays.
  const fork = '5k3/9/9/9/9/4R4/4P4/3n5/9/4K4 w';
  const forked = positionFacts(fork);
  assert.deepEqual(squares(forked.check.checkers.map(p => p.at)), ['73']);
  assert.deepEqual(squares(on(forked.pieces, '54').defenders.map(p => p.at)), ['64'], 'the rook has a defender: the pawn');
  assert.equal(on(forked.pieces, '54').status, 'hanging');
  assert.deepEqual(forked.hanging.map(h => [h.piece.name, h.by.name, h.capture.notation, h.gain, h.free, h.now]), [['车', '马', '马4退5', 500, false, false]]);
  const forkBoard = fenToBoard(fork).board;
  for (const answer of getLegalMoves(forkBoard, 'red')) assert.equal(bestExchange(applyMove(forkBoard, answer), 'black', sq('54')), 500, code(answer));

  // Attacked together with the king, but one answer saves it: the rook a3 is attacked by the rook a7 while the horse f3
  // gives check. Any king move loses the rook; taking the checking horse with it saves it. It is en prise all the same
  // (it is listed, with what is lost unless the answer helps), and the saving answer is credited with the parry.
  const savable = '5k3/9/9/r8/9/9/9/R4n3/9/4K4 w';
  const enPrise = positionFacts(savable);
  assert.deepEqual(enPrise.hanging.filter(h => h.piece.color === 'red').map(h => [h.piece.name, h.by.name, h.capture.notation, h.gain, h.free, h.now]),
    [['车', '车', '车1进4', 900, true, false]]);
  const savableBoard = fenToBoard(savable).board;
  const outcomes = getLegalMoves(savableBoard, 'red').map(answer => [code(answer), bestExchange(applyMove(savableBoard, answer), 'black', code(answer).startsWith('70') ? answer.to : sq('70'))]);
  assert.deepEqual(outcomes.sort(), [['7075', -Infinity], ['9484', 900], ['9493', 900], ['9495', 900]], 'lost after every king move, safe after 车九平四');
  assert.deepEqual(moveFacts(savable, ref('7075')).parried.map(p => [p.piece.name, p.how]), [['车', 'moved']]);
  assert.deepEqual(moveFacts(savable, ref('9493')).exposed.map(e => [e.piece.name, e.gain, e.cause]), [['车', 900, 'left-hanging']]);

  // Red is in check from the horse f3. The rook d5 attacks the horse d1, whose only defender is the king. Both answers to
  // the check are king moves that leave the horse alone: it is lost whatever red does.
  const lost = '3k5/9/9/9/9/3r5/9/5n3/9/3NK4 w';
  const facts = positionFacts(lost);
  assert.deepEqual(squares(facts.check.checkers.map(p => p.at)), ['75']);
  const horse = on(facts.pieces, '93');
  assert.deepEqual(squares(horse.defenders.map(p => p.at)), ['94'], 'the horse has a defender: its king');
  assert.equal(horse.status, 'hanging');
  assert.deepEqual(facts.hanging.map(h => [h.piece.name, h.by.name, h.capture.notation, h.gain, h.free, h.now]), [['马', '车', '车4进4', 400, true, false]]);
  // the independent recount: after every legal answer the rook takes the horse and nothing takes back
  const { board } = fenToBoard(lost);
  const answers = getLegalMoves(board, 'red');
  assert.deepEqual(answers.map(code).sort(), ['9484', '9495']);
  for (const answer of answers) assert.equal(bestExchange(applyMove(board, answer), 'black', sq('93')), 400);

  // The counterpart: the horse c3 is attacked by the rook c7 and guarded by the rook a3 while the king is in check.
  // Once the check is answered the recapture is legal again, so the horse is not hanging.
  const held = '3k5/9/9/2r6/9/9/9/R1N2n3/9/4K4 w';
  const guarded = positionFacts(held);
  assert.notEqual(guarded.check, null);
  assert.deepEqual(guarded.hanging, []);
  assert.equal(on(guarded.pieces, '72').status, 'guarded');
  assert.deepEqual(squares(on(guarded.pieces, '72').defenders.map(p => p.at)), ['70']);
  const heldBoard = fenToBoard(held).board;
  for (const answer of getLegalMoves(heldBoard, 'red')) {
    const afterAnswer = applyMove(heldBoard, answer);
    const horseAt = code(answer).startsWith('72') ? answer.to : sq('72');
    assert.ok(bestExchange(afterAnswer, 'black', horseAt) < 100, `after ${code(answer)} the horse cannot be won`);
  }
  // the mate of the side that is not on move is not searched while the side on move is in check
  assert.equal(guarded.mates.black, null);
});

test('pins: rook file pin, cannon two-men pin, facing kings, horse-leg block, relative pin; a pawn with no sideways move is not pinned', () => {
  const pinsOf = fen => positionFacts(fen).pins.map(p => [`${p.pinned.at.row}${p.pinned.at.col}`, `${p.by.at.row}${p.by.at.col}`, `${p.shield.at.row}${p.shield.at.col}`, p.absolute, p.kind]);
  // rook file pin: the red rook e5 stands between the black rook e10 and its king
  assert.deepEqual(pinsOf('3kr4/9/9/9/9/4R4/9/1C7/9/4K4 w'), [['54', '04', '94', true, 'rook']]);
  // cannon: the horse and the advisor are the two men between the cannon and the king; neither may leave the file
  assert.deepEqual(pinsOf('3k5/4c4/9/9/9/4N4/9/9/4A4/4K4 w'), [['54', '14', '94', true, 'cannon'], ['84', '14', '94', true, 'cannon']]);
  // facing kings: the cannon is the only man between the two kings
  assert.deepEqual(pinsOf('4k4/9/9/9/9/4C4/9/9/9/4K4 w'), [['54', '04', '94', true, 'kings']]);
  // horse leg: the cannon d2 blocks the leg of the horse d3, which would otherwise check the king
  assert.deepEqual(pinsOf('5k3/9/9/9/9/9/9/3n5/3C5/4K4 w'), [['83', '73', '94', true, 'horse']]);
  // relative pin: if the horse leaves the rank the rook takes the unguarded rook behind it
  assert.deepEqual(pinsOf('3k5/9/9/r3N3R/9/9/9/9/9/4K4 b'), [['34', '30', '38', false, 'rook']]);
  // relative cannon pin: pawn and horse are the two men between the cannon and the rook
  assert.deepEqual(pinsOf('4k4/9/9/9/c1P1N3R/4P4/9/9/9/4K4 b'), [['42', '40', '48', false, 'cannon'], ['44', '40', '48', false, 'cannon']]);
  // a guarded piece behind that is worth no more than the attacker is no pin: the pawn i6 guards the rook i7
  assert.deepEqual(pinsOf('3k5/9/9/r3N3R/8P/9/9/9/9/4K4 b'), []);
  // a pawn that has not crossed can only step forward, which keeps it on the file: lifting it would expose the king,
  // but no move of it is illegal, so it is not pinned (a rook on the same square is)
  assert.deepEqual(pinsOf('3kr4/9/9/9/9/9/4P4/9/9/4K4 w'), []);
  assert.deepEqual(pinsOf('3kr4/9/9/9/9/9/4R4/9/9/4K4 w'), [['64', '04', '94', true, 'rook']]);
  // every absolutely pinned piece has an illegal pseudo-move by the rules engine: the rook cannot leave the file
  const { board } = fenToBoard('3kr4/9/9/9/9/4R4/9/1C7/9/4K4 w');
  assert.ok(getPieceLegalMoves(board, 5, 4).every(m => m.to.col === 4));
  // nothing is pinned in the start position
  assert.deepEqual(pinsOf(START), []);
});

test('king flights: each state once, including facing', () => {
  // Red king e2: e3 is free, d2 would face the black king on the d-file, f2 is covered by the rook f8, e1 holds its own rook.
  const facts = positionFacts('3k5/9/5r3/9/9/9/9/9/4K4/4R4 w');
  const red = facts.kings.red;
  assert.deepEqual(red.at, { row: 8, col: 4 });
  assert.deepEqual(red.flights.map(f => [`${f.to.row}${f.to.col}`, f.state, f.by ? f.by.name : null]).sort(), [
    ['74', 'free', null], ['83', 'facing', '将'], ['85', 'attacked', '车'], ['94', 'own', null],
  ]);
  assert.equal(red.free, 1);
  // the engine agrees on which king moves are legal
  const { board } = fenToBoard(facts.fen);
  assert.deepEqual(getPieceLegalMoves(board, 8, 4).map(m => code(m).slice(2)), ['74']);
  // black king d10: e10 would face the red king on the e-file, d9 is free; c10 is outside the palace and not listed
  assert.deepEqual(facts.kings.black.flights.map(f => [`${f.to.row}${f.to.col}`, f.state]).sort(), [['04', 'facing'], ['13', 'free']]);
  assert.equal(facts.kings.black.free, 1);
  // a flight that is attacked by several pieces names the least valuable one (d1: the pawn c1, not the rook d8);
  // taking a guarded piece is not a flight (f1: the horse is guarded by the rook f7)
  const crowded = positionFacts('3k5/9/3r5/5r3/9/9/9/9/9/2p1Kn3 w');
  assert.deepEqual(crowded.kings.red.flights.map(f => [`${f.to.row}${f.to.col}`, f.state, f.by ? f.by.name : null]).sort(), [
    ['84', 'free', null], ['93', 'attacked', '卒'], ['95', 'attacked', '6路车'],
  ]);
  // pressure: enemy pieces in columns c..g of the four rows nearest the back rank, (2R + C + H + P) / 6, at most 1
  assert.equal(positionFacts(START).kings.red.pressure, 0);
  assert.equal(positionFacts('4k4/9/9/9/9/9/2r3c2/4n4/p3p4/3K5 w').kings.red.pressure, (2 + 1 + 1 + 1) / 6);
  assert.equal(positionFacts('4k4/9/9/9/9/9/2r1r1c2/2r1n4/4p4/3K5 w').kings.red.pressure, 1);
  assert.equal(positionFacts('3k5/2R1P4/9/2N6/2C6/9/9/9/9/4K4 w').kings.black.pressure, (2 + 1 + 1) / 6);
});

test('mateSearch: mate in one, two, three; respects the node cap', () => {
  // mate in one: the positions of the tactical suite, each with the move the suite names
  for (const t of TACTICAL_SUITE.filter(t => t.mateIn === 1)) {
    const facts = positionFacts(t.fen);
    const mate = facts.mates[facts.turn];
    assert.equal(mate.in, 1, t.name);
    assert.deepEqual(mate.line.moves.map(code), [t.move], t.name);
    assert.equal(mate.line.moves[0].notation, t.first, t.name);
    assert.equal(mate.line.start, t.fen, t.name);
    assert.equal(mate.line.end, 'mate', t.name);
    assertMatingLine(mate.line, facts.turn, t.name);
  }
  // a mate "if it were on move": the same mate is reported for the side that is not on move, from the flipped position
  const waiting = positionFacts(TACTICAL_SUITE[0].fen.replace(' w', ' b'));
  assert.equal(waiting.turn, 'black');
  assert.equal(waiting.mates.red.in, 1);
  assert.equal(waiting.mates.red.line.start, TACTICAL_SUITE[0].fen);
  assert.equal(waiting.mates.black, null);

  // mate in two: the double rooks of the suite; the line keeps the defender's longest defence and ends in mate
  const two = positionFacts('9/4k4/9/9/9/R8/8R/9/9/3K5 w').mates.red;
  assert.equal(two.in, 2);
  assert.equal(two.line.moves.length, 3);
  assert.equal(two.pattern, null);
  assertMatingLine(two.line, 'red', 'mate in two');
  let { board } = fenToBoard('9/4k4/9/9/9/R8/8R/9/9/3K5 w');
  assert.equal(matesWithin(board, 'red', 1), false);
  assert.equal(matesWithin(board, 'red', 2), true);

  // mate in three: two rooks and a king that is driven back rank by rank
  const threeFen = '5a3/9/3k5/9/9/9/6N2/9/5R3/2C2K1R1 w';
  const three = positionFacts(threeFen).mates.red;
  assert.equal(three.in, 3);
  assert.equal(three.line.moves.length, 5);
  assertMatingLine(three.line, 'red', 'mate in three');
  board = fenToBoard(threeFen).board;
  assert.equal(matesWithin(board, 'red', 2), false, 'no shorter mate by checks exists');
  // forced: after the first move every reply runs into a mate in two
  const afterFirst = applyMove(board, three.line.moves[0]);
  assert.ok(getLegalMoves(afterFirst, 'black').every(reply => matesWithin(applyMove(afterFirst, reply), 'red', 2)));

  // A6.1 counts checkmates only: the 抽将 position is won by 困毙 on move two (search.js calls that mate in 2), and the
  // checks-only search reports nothing (CONTRACT-NOTES item 79). No mate is invented where none exists either.
  assert.equal(positionFacts(TACTICAL_SUITE.find(t => t.name === '抽将').fen).mates.red, null);
  assert.deepEqual(positionFacts(START).mates, { red: null, black: null });

  // the node cap: the same mate in three (it starts with 炮七平六) stands on this board, but red has so many other checks
  // to try first that the checks-only tree passes 4000 nodes before the search reaches it. Nothing is reported then.
  const crowdedFen = '1NrP1a1rc/9/3kCR3/3n2N2/9/9/6N2/9/5R3/2C2K1R1 w';
  const crowded = positionFacts(crowdedFen);
  assert.equal(crowded.mates.red, null);
  board = fenToBoard(crowdedFen).board;
  assert.equal(matesWithin(board, 'red', 2), false);
  const cannonCheck = applyMove(board, ref('9293'));
  assert.equal(isInCheck(cannonCheck, 'black'), true);
  assert.ok(getLegalMoves(cannonCheck, 'black').every(reply => matesWithin(applyMove(cannonCheck, reply), 'red', 2)), 'the mate in three is there');
});

test('patterns: every PATTERN_CODES detector has its positive example and one near miss', () => {
  /** ids of the patterns a move plays (stage 'played') */
  const played = (fen, moveCode) => moveFacts(fen, ref(moveCode)).patterns.filter(p => p.stage === 'played').map(p => p.id);
  /** ids of the formations of a position for one side */
  const formations = (fen, side, ply = 10) => positionFacts(fen, { ply }).patterns.filter(p => p.side === side).map(p => p.id);
  const opening = (codes, side) => openingName(START, codes.map(ref))[side];
  /** ids of the patterns of an assessment with a real search */
  const assessed = (fen, moveCode) => assess(fen, moveCode, { depth: 5 }).assessment.patterns.filter(p => p.stage === 'played').map(p => p.id);
  const mateExample = id => PATTERN_EXAMPLES.find(e => e.id === id);
  /**
   * The assessment of the best move in a position where the rook e5 attacks horse and cannon at once, so that one of
   * them must be lost. `takesMoved` says whether the reply is expected to take the moved piece itself.
   */
  const forcedLoss = (fen, takesMoved) => {
    const { assessment } = assess(fen, code(analyze(fen, { allDepth: 4 }).lines[0].move));
    const afterReply = materialOutcome({ start: assessment.line.start, moves: assessment.line.moves.slice(0, 2), end: 'quiet' }, 'red', 2);
    assert.deepEqual([assessment.isBest, assessment.loss, afterReply.net <= -2, assessment.cat], [true, 0, true, 'best']);
    assert.equal(code(assessment.line.moves[1]).slice(2) === code(assessment.move).slice(2), takesMoved);
    return assessment;
  };

  /** @type {Record<string, {positive: () => boolean, nearMiss: () => boolean}>} */
  const cases = {
    // openings (the rows of openingName)
    central_cannon: { positive: () => opening(['7774'], 'red') === 'central_cannon', nearMiss: () => opening(['7773'], 'red') !== 'central_cannon' },
    screen_horses: {
      positive: () => opening(['7774', '0726', '9776', '0122'], 'black') === 'screen_horses',
      nearMiss: () => opening(['7774', '0726', '9776', '0120'], 'black') !== 'screen_horses',
    },
    same_cannons: { positive: () => opening(['7774', '2724'], 'black') === 'same_cannons', nearMiss: () => opening(['7774', '2124'], 'black') !== 'same_cannons' },
    opposite_cannons: { positive: () => opening(['7774', '2124'], 'black') === 'opposite_cannons', nearMiss: () => opening(['7774', '2724'], 'black') !== 'opposite_cannons' },
    pawn_lead: { positive: () => opening(['6252'], 'red') === 'pawn_lead', nearMiss: () => opening(['6050'], 'red') !== 'pawn_lead' },
    elephant_open: { positive: () => opening(['9674'], 'red') === 'elephant_open', nearMiss: () => opening(['9678'], 'red') !== 'elephant_open' },
    horse_open: { positive: () => opening(['9172'], 'red') === 'horse_open', nearMiss: () => opening(['9170'], 'red') !== 'horse_open' },
    palace_cannon: { positive: () => opening(['7773'], 'red') === 'palace_cannon', nearMiss: () => opening(['7775'], 'red') !== 'palace_cannon' },
    corner_cannon: { positive: () => opening(['7775'], 'red') === 'corner_cannon', nearMiss: () => opening(['7776'], 'red') !== 'corner_cannon' },
    // checking shapes
    double_cannon: {
      positive: () => played(mateExample('double_cannon').fen, mateExample('double_cannon').move).includes('double_cannon'),
      // the rear cannon checks through a pawn, not through a cannon
      nearMiss: () => played('3aka3/9/9/4P4/9/9/9/1C7/9/4K4 w', '7174').length === 0,
    },
    horse_cannon: {
      positive: () => played(mateExample('horse_cannon').fen, mateExample('horse_cannon').move).includes('horse_cannon'),
      // the horse lands three points from the king, not two
      nearMiss: () => !played('4k4/9/9/9/9/3N5/4C4/9/r8/4K4 w', '5334').includes('horse_cannon'),
    },
    trough_horse: {
      positive: () => played(mateExample('trough_horse').fen, mateExample('trough_horse').move).includes('trough_horse'),
      // the horse reaches the trough square but its leg is blocked: no check
      nearMiss: () => !played('r1bakab2/3c5/9/3N5/9/9/9/9/9/5K3 w', '3312').includes('trough_horse'),
    },
    corner_horse: {
      positive: () => played('4k4/9/9/9/2N6/9/9/9/9/3K5 w', '4223').includes('corner_horse'),
      nearMiss: () => !played('4k4/3p5/9/9/2N6/9/9/9/9/3K5 w', '4223').includes('corner_horse'),
    },
    discovered_check: {
      // the horse steps aside and the rook behind it checks; nothing is won by it
      positive: () => played('4k4/9/9/4N4/9/9/4R4/9/9/3K5 w', '3453').join() === 'discovered_check',
      // a check by the piece that moved
      nearMiss: () => !played('4k4/9/9/9/R8/4P4/9/9/9/4K4 w', '4000').includes('discovered_check'),
    },
    discovered_win: {
      positive: () => played(mateExample('discovered_win').fen, mateExample('discovered_win').move).includes('discovered_win'),
      nearMiss: () => !played('4k4/9/9/4N4/9/9/4R4/9/9/3K5 w', '3453').includes('discovered_win'),
    },
    double_check: {
      positive: () => played(mateExample('discovered_win').fen, mateExample('discovered_win').move).includes('double_check'),
      nearMiss: () => !played('4k4/9/9/4N4/9/9/4R4/9/9/3K5 w', '3453').includes('double_check'),
    },
    check_fork: {
      positive: () => played(mateExample('trough_horse').fen, mateExample('trough_horse').move).includes('check_fork'),
      // the horse checks and attacks a horse that a rook guards: nothing is won, so it is no fork
      nearMiss: () => !played('nrbakab2/9/9/3N5/9/9/9/9/9/5K3 w', '3312').includes('check_fork'),
    },
    fork_two: {
      positive: () => played(mateExample('fork_two').fen, mateExample('fork_two').move).includes('fork_two'),
      nearMiss: () => played('4k4/9/3r5/9/9/9/3NP4/9/9/4K4 w', '6344').length === 0,
    },
    // mating patterns
    iron_bolt: {
      positive: () => played(mateExample('iron_bolt').fen, mateExample('iron_bolt').move)[0] === 'iron_bolt',
      // without the cannon on the centre file the advisor simply takes the rook
      nearMiss: () => played('2bak1b2/4a4/9/4p4/9/5R3/9/9/9/5K3 w', '5505').length === 0,
    },
    smother: {
      positive: () => played(mateExample('smother').fen, mateExample('smother').move).includes('smother'),
      // the centre point is free: check, but the king steps out
      nearMiss: () => played('4ka3/9/9/9/9/9/9/9/7C1/3K5 w', '8707').length === 0,
    },
    double_rooks: {
      positive: () => played(mateExample('double_rooks').fen, mateExample('double_rooks').move).includes('double_rooks')
        && assessed('9/4k4/9/9/9/R8/8R/9/9/3K5 w', '5010').includes('double_rooks'),
      // the second rook is two rows away: the king steps forward
      nearMiss: () => played('4k4/9/R8/9/9/8R/9/9/9/3K5 w', '5808').length === 0,
    },
    face_off: {
      positive: () => played(mateExample('face_off').fen, mateExample('face_off').move).includes('face_off')
        && formations('3k5/9/9/9/9/9/9/9/9/4K4 w', 'red').includes('face_off'),
      // the red king stands one file further away: the black king has the e-file
      nearMiss: () => played('3k5/9/9/9/9/9/9/9/R8/5K3 w', '8083').length === 0 && !formations('3k5/9/9/9/9/9/9/9/9/5K3 w', 'red').includes('face_off'),
    },
    // search-backed
    heart_strike: {
      positive: () => assessed('3akn3/4a4/9/4R4/4P4/R8/9/4C4/9/3K5 w', '3414').includes('heart_strike'),
      // without the second rook the capture is no mate
      nearMiss: () => !assessed('3akn3/4a4/9/4R4/4P4/9/9/4C4/9/3K5 w', '3414').includes('heart_strike'),
    },
    sacrifice_play: {
      positive: () => assessed('3akn3/4a4/9/4R4/4P4/R8/9/4C4/9/3K5 w', '3414').includes('sacrifice_play'),
      // the same capture without the mate behind it is a blunder. And material that is lost whatever the mover plays is
      // not given up for anything, although the best move leaves the mover two points or more down after the reply:
      // neither when the reply takes another piece, nor when the doomed horse first takes a guarded pawn (no compensation)
      nearMiss: () => !assessed('3akn3/4a4/9/4R4/4P4/9/9/4C4/9/3K5 w', '3414').includes('sacrifice_play')
        && !forcedLoss('2bakab2/9/9/9/9/N3r3C/9/9/9/5K3 w', false).flags.sacrifice
        && !forcedLoss('2bak4/9/4b4/9/2p6/N3r3C/9/9/9/5K3 w', true).flags.sacrifice,
    },
    // formations
    empty_cannon: {
      positive: () => formations('4k4/9/9/9/9/9/4C4/9/9/3K5 w', 'red').includes('empty_cannon'),
      // two men stand between; and a cannon that can be taken with profit does not count
      nearMiss: () => !formations('4k4/9/4p4/4p4/9/9/4C4/9/9/3K5 w', 'red').includes('empty_cannon')
        && !formations('4k4/9/9/9/9/9/r3C4/9/9/3K5 w', 'red').includes('empty_cannon'),
    },
    heart_horse: {
      // a weakness: the side of the pattern is the opponent of the horse's owner
      positive: () => formations('4k4/9/9/9/9/9/9/9/4N4/3K5 w', 'black').join() === 'heart_horse',
      nearMiss: () => !formations('4k4/9/9/9/9/9/9/9/3N5/3K5 w', 'black').includes('heart_horse'),
    },
  };
  assert.deepEqual(Object.keys(cases).sort(), [...PATTERN_CODES].sort(), 'one case per pattern code');
  for (const id of PATTERN_CODES) {
    assert.equal(cases[id].positive(), true, `${id}: positive example`);
    assert.equal(cases[id].nearMiss(), true, `${id}: near miss`);
  }

  // every verified example of Appendix A6.4: id, name, mate flag, side, stage
  for (const example of PATTERN_EXAMPLES) {
    const facts = moveFacts(example.fen, ref(example.move));
    const pattern = facts.patterns.find(p => p.id === example.id);
    assert.ok(pattern, `${example.name}: ${example.id}`);
    assert.deepEqual([pattern.name, pattern.side, pattern.stage, pattern.mate], [PATTERN_NAME[example.id], 'red', 'played', example.mate], example.name);
    assert.equal(facts.move.notation, example.first);
    assert.equal(facts.check !== null && facts.check.mate, example.mate, example.name);
    assert.ok(pattern.squares.length >= 2 && pattern.squares.every(s => s.row >= 0 && s.row <= 9 && s.col >= 0 && s.col <= 8));
  }
  // 双车错 by search needs a checkmate at the end of its line. Here the rook checks, the king must step aside and the
  // other rook's quiet move leaves it without a legal move (困毙): a win, and toLine calls that end 'mate' as well, but
  // it is not the pattern. (The pair is hand-built so that the line is exactly this one.)
  const stalemateFen = '4k4/8R/9/9/9/R8/9/9/9/5K3 w';
  const stalemateLine = ['5054', '0403', '1817'];
  const stalemated = assessMove({
    fen: stalemateFen, move: ref('5054'), table: null, level: 5, compare: ref('5054'),
    pair: tableOf(stalemateFen, [rootLine('5054', MATE - 3, { depth: 4, mate: 2, pv: stalemateLine.map(ref) })]),
  });
  const stalemateBoard = stalemateLine.reduce((board, c) => applyMove(board, ref(c)), fenToBoard(stalemateFen).board);
  assert.deepEqual([getGameStatus(stalemateBoard, 'black').reason, stalemated.line.end, stalemated.line.moves.length, stalemated.flags.givesMate],
    ['stalemate', 'mate', 3, 2]);
  assert.deepEqual(stalemated.line.moves.map(m => m.piece), ['rook', 'king', 'rook']);
  assert.ok(!stalemated.patterns.some(p => p.id === 'double_rooks'), '困毙 is not 双车错');
  // mirrored for black: 重炮 by black, as a move and as a threatened mate in one
  const blackCannons = TACTICAL_SUITE.find(t => t.name === '重炮 (black)');
  const blackMate = moveFacts(blackCannons.fen, ref(blackCannons.move)).patterns[0];
  assert.deepEqual([blackMate.id, blackMate.side, blackMate.stage, blackMate.mate], ['double_cannon', 'black', 'played', true]);
  const threat = positionFacts(blackCannons.fen).mates.black.pattern;
  assert.deepEqual([threat.id, threat.name, threat.side, threat.stage, threat.mate], ['double_cannon', '重炮', 'black', 'threat', true]);
  // 卧槽马 and 挂角马 by black stand on rows 8 and 7
  assert.ok(played('5k3/9/9/9/9/9/3n5/9/9/RNBAKAB2 b', '6382').includes('trough_horse'));
  assert.ok(played('3k5/9/9/9/9/2n6/9/9/9/4K4 b', '5273').includes('corner_horse'));
  // the centre cannon as a formation: only while ply <= 30
  const cannonFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b';
  assert.deepEqual(formations(cannonFen, 'red', 1), ['central_cannon']);
  assert.deepEqual(formations(cannonFen, 'red', 30), ['central_cannon']);
  assert.deepEqual(formations(cannonFen, 'red', 31), []);
  assert.deepEqual(positionFacts(cannonFen).patterns, [], 'without a ply the opening formation is not reported');
  assert.deepEqual(positionFacts(START, { ply: 0 }).patterns, []);
});

test('moveFacts: one position per tag and per field; exposed.cause and parried.how each value', () => {
  const facts = (fen, moveCode, opts) => moveFacts(fen, ref(moveCode), opts);

  // 将: check, not mate
  let f = facts('4k4/9/9/9/R8/4P4/9/9/9/4K4 w', '4000');
  assert.deepEqual(f.tags, ['将']);
  assert.deepEqual([squares(f.check.checkers.map(p => p.at)), f.check.discovered, f.check.double, f.check.replies, f.check.mate], [['00'], false, false, 1, false]);
  assert.deepEqual([f.move.notation, f.move.piece, f.move.color, f.move.captured], ['车九进四', 'rook', 'red', null]);
  assert.equal(f.fenBefore, '4k4/9/9/9/R8/4P4/9/9/9/4K4 w');
  assert.equal(f.fenAfter, 'R3k4/9/9/9/9/4P4/9/9/9/4K4 b');
  assert.deepEqual(f.kingSqueeze, { before: 3, after: 1 });

  // 杀 by mate: no reply; a move that ends the game threatens nothing
  f = facts('4k4/3R1R3/R8/9/9/4P4/9/9/9/4K4 w', '2024');
  assert.deepEqual(f.tags, ['将', '杀']);
  assert.deepEqual([f.check.replies, f.check.mate], [0, true]);
  assert.deepEqual([f.threats, f.exposed, f.fork, f.mateThreat, f.allowsMate], [[], [], null, null, null]);

  // 杀 by a threatened mate: 炮九平五 sets up 重炮; the pattern of the threat comes with stage 'threat'
  f = facts('3aka3/9/9/C8/9/9/9/1C7/9/3K5 w', '3034');
  assert.deepEqual(f.tags, ['杀']);
  assert.equal(f.check, null);
  assert.deepEqual([f.mateThreat.in, notations(f.mateThreat.line), f.mateThreat.pattern.id], [1, '炮八平五', 'double_cannon']);
  assert.deepEqual(f.patterns.map(p => [p.id, p.stage, p.mate]), [['double_cannon', 'threat', true]]);
  assertMatingLine(f.mateThreat.line, 'red', 'mateThreat');
  // ... and the same position from black's side: a pawn move allows that mate
  f = facts('3aka3/9/9/4C4/p8/9/9/1C7/9/4K4 b', '4050');
  assert.deepEqual(f.tags, ['闲']);
  assert.deepEqual([f.allowsMate.in, notations(f.allowsMate.line)], [1, '炮八平五']);
  assert.equal(f.mateThreat, null);
  assert.equal(f.pawnCrossed, true);

  // 吃: a free capture
  f = facts('4k4/9/9/r8/9/R3P4/9/9/9/4K4 w', '5030');
  assert.deepEqual(f.tags, ['吃']);
  assert.deepEqual([f.capture.piece.name, f.capture.piece.color, f.capture.see, f.capture.exchange, f.capture.free, f.capture.recapture], ['车', 'black', 900, 'wins', true, null]);
  assert.deepEqual(f.parried.map(p => [p.piece.name, `${p.piece.at.row}${p.piece.at.col}`, p.how]), [['车', '30', 'moved']]);
  // 吃 + 兑: rook takes a rook that the other rook guards
  f = facts('4k4/9/9/r7r/9/R3P4/9/9/9/4K4 w', '5030');
  assert.deepEqual([f.capture.see, f.capture.exchange, f.capture.free, f.capture.recapture.notation], [0, 'even', false, '车9平1']);
  assert.ok(f.tags.includes('吃') && f.tags.includes('兑'));
  // a losing capture: cannon takes the horse that a rook guards (400 - 450)
  f = facts(START, '7101');
  assert.deepEqual([f.capture.see, f.capture.exchange, f.capture.free, f.capture.recapture.notation], [-50, 'loses', false, '车1平2']);
  // a capture that wins although the piece is guarded: retaking would cost the rook
  f = facts('rnbakabnr/9/1c5c1/2p1p1p1p/p8/P8/2P1P1P1P/1C5C1/9/RNBAKABNR w', '5040');
  assert.deepEqual([f.capture.see, f.capture.exchange, f.capture.free, f.capture.recapture.notation], [100, 'wins', false, '车1进4']);

  // 兑 without a capture: the rook offers itself to the black rook, guarded by the horse
  f = facts('4k4/9/r8/9/5N3/9/6R2/9/9/3K5 w', '6626');
  assert.equal(f.capture, null);
  assert.deepEqual(f.tags, ['捉', '兑']);
  assert.deepEqual(f.exposed, []);
  assert.deepEqual(f.threats.map(t => [t.by.name, t.target.name, t.capture.notation, t.gain, t.discovered, t.viaScreen]), [['车', '车', '车三平九', 900, false, null]]);

  // 献 and exposed 'moved-into-attack': the rook steps where the black rook takes it
  f = facts('4k4/9/9/r8/9/1R2P4/9/9/9/4K4 w', '5150');
  assert.deepEqual(f.tags, ['捉', '献']);
  assert.deepEqual(f.exposed.map(e => [e.piece.name, e.by.name, e.capture.notation, e.gain, e.cause]), [['车', '车', '车1进2', 900, 'moved-into-attack']]);
  // exposed 'left-hanging': the rook was attacked and stays where it is
  f = facts('4k4/9/9/r8/9/R3P4/9/9/9/4K4 w', '5444');
  assert.deepEqual(f.exposed.map(e => [e.piece.name, e.cause]), [['车', 'left-hanging']]);
  assert.deepEqual(f.parried, []);
  // exposed 'unguarded': the rook that guarded the horse leaves
  f = facts('3k5/9/9/r8/9/9/N8/9/9/R4K3 w', '9091');
  assert.deepEqual(f.exposed.map(e => [e.piece.name, e.by.name, e.gain, e.cause]), [['马', '车', 400, 'unguarded']]);
  // exposed 'uncovered': the cannon stood between the rook and the horse without guarding it
  f = facts('3k5/9/9/r8/9/C8/9/N8/9/5K3 w', '5051');
  assert.deepEqual(f.exposed.map(e => [e.piece.name, e.cause]), [['马', 'uncovered']]);
  assert.deepEqual(f.parried.map(p => [p.piece.name, p.how]), [['炮', 'moved']]);

  // parried 'captured-attacker' (and 保: the rook now also guards the horse)
  f = facts('3k5/9/9/r7R/9/9/N8/9/9/5K3 w', '3830');
  assert.deepEqual(f.parried.map(p => [p.piece.name, p.how]), [['车', 'moved'], ['马', 'captured-attacker']]);
  // parried 'defended' and 保: the rook comes to guard the attacked horse
  f = facts('4k4/9/9/r8/9/9/N8/9/9/3R1K3 w', '9390');
  assert.deepEqual(f.parried.map(p => [p.piece.name, p.how]), [['马', 'defended']]);
  assert.deepEqual(f.tags, ['保']);
  // parried 'blocked', 拦 and a line block: the rook steps between the black rook and the horse (and can be taken itself)
  f = facts('4k4/9/9/r8/9/2R1P4/9/N8/9/4K4 w', '5250');
  assert.deepEqual(f.parried.map(p => [p.piece.name, p.how]), [['马', 'blocked']]);
  assert.deepEqual(f.blocks.map(b => [b.kind, b.piece.name, b.piece.color]), [['line', '车', 'black']]);
  assert.deepEqual(f.tags, ['捉', '献', '保', '拦']);
  // a piece whose attacker lost its screen is safe, but nothing was put in between: 'defended', and no block
  f = facts('3k5/4c4/9/9/9/4N4/9/4R4/9/5K3 w', '5466');
  assert.deepEqual(f.parried.map(p => [p.piece.name, p.how]), [['车', 'defended']]);
  assert.deepEqual(f.blocks, []);
  // ... that move is also 闪: the horse uncovers the rook's attack on the cannon
  assert.deepEqual(f.threats.map(t => [t.by.name, t.target.name, t.gain, t.discovered]), [['车', '炮', 450, true]]);
  assert.ok(f.tags.includes('闪') && f.tags.includes('捉'));
  assert.deepEqual(f.opens.map(o => [o.piece.name, o.kind, o.gained]), [['车', 'line', 5]]);
  // a check does not parry: the rook a5 cannot be taken while black is in check, but it is still attacked once the
  // check is answered, so nothing is claimed
  f = facts('4k4/9/9/r8/6N2/R8/9/9/9/3K5 w', '4625');
  assert.notEqual(f.check, null);
  assert.equal(on(positionFacts(f.fenBefore).hanging, '50').piece.color, 'red');
  assert.deepEqual([f.parried, f.exposed], [[], []]);

  // escapesCheck, a line block against the checker, and a pin suffered: the horse interposes and is now pinned
  f = facts('3k5/4r4/9/9/9/9/2N6/9/9/4K4 w', '6254');
  assert.equal(f.escapesCheck, true);
  assert.deepEqual(f.blocks.map(b => [b.kind, b.piece.name]), [['line', '车']]);
  assert.deepEqual(f.pins.suffered.map(p => [p.pinned.name, p.by.name, p.absolute, p.kind]), [['马', '车', true, 'rook']]);
  assert.deepEqual([f.pins.created, f.pins.released], [[], []]);
  // pins created: the rook pins the horse against its king (and attacks it)
  f = facts('4k4/9/4n4/9/9/9/R8/9/9/3K5 w', '6064');
  assert.deepEqual(f.pins.created.map(p => [p.pinned.name, p.by.name, p.absolute, p.kind]), [['马', '车', true, 'rook']]);
  assert.deepEqual(f.tags, ['捉']);
  // pins released: the advisor interposes and frees the rook; the rook's new moves are no "open line"
  f = facts('3kr4/9/9/9/9/4R4/9/9/9/3AK4 w', '9384');
  assert.deepEqual(f.pins.released.map(p => [p.pinned.name, p.by.name, p.absolute, p.kind]), [['车', '车', true, 'rook']]);
  assert.deepEqual([f.pins.created, f.pins.suffered, f.opens], [[], [], []]);
  // an interposing piece that nothing guards changes the pin instead of releasing it: the rook may move now, but
  // leaving the file would lose the cannon (see the v1 fixture cannon-unpins-rook below)
  f = facts('3kr4/9/9/9/9/4R4/9/1C7/9/4K4 w', '7174');
  assert.deepEqual([f.pins.released, f.pins.suffered, f.opens], [[], [], []]);

  // blocks: horse leg and elephant eye
  f = facts('3k5/9/2n6/9/9/9/2R6/9/9/4K4 w', '6232');
  assert.deepEqual(f.blocks.map(b => [b.kind, b.piece.name, `${b.piece.at.row}${b.piece.at.col}`]), [['horse-leg', '马', '22']]);
  assert.ok(f.tags.includes('拦'));
  f = facts('2b1k4/9/9/9/9/9/3R5/9/9/3K5 w', '6313');
  assert.deepEqual(f.blocks.map(b => [b.kind, b.piece.name]), [['elephant-eye', '象']]);
  assert.deepEqual(f.tags, ['拦']);
  assert.deepEqual(f.kingSqueeze, { before: 2, after: 1 });

  // opens: line (two or more new moves), leg, eye
  f = facts('4k4/9/9/9/9/4P4/9/RC7/9/4K4 w', '7161');
  assert.deepEqual(f.opens.map(o => [o.piece.name, o.kind, o.gained]), [['车', 'line', 8]]);
  f = facts('3k5/9/9/9/9/9/9/9/1R7/1N2K4 w', '8188');
  assert.deepEqual(f.opens.map(o => [o.piece.name, o.kind, o.gained]), [['马', 'leg', 2]]);
  f = facts('4k4/9/9/9/9/9/9/9/3R5/2B2K3 w', '8388');
  assert.deepEqual(f.opens.map(o => [o.piece.name, o.kind, o.gained]), [['相', 'eye', 1]]);
  // one new square for a rook is not an open line (the threshold is two)
  assert.deepEqual(facts(START, '9172').opens, []);

  // fork without check, and with check; 捉
  f = facts('4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w', '6344');
  assert.deepEqual([f.fork.by.name, f.fork.targets.map(t => t.name), f.fork.withCheck], ['马', ['4路车', '6路车'], false]);
  assert.deepEqual(f.threats.map(t => [t.capture.notation, t.gain]), [['马五进六', 500], ['马五进四', 500]]);
  assert.deepEqual(f.tags, ['捉']);
  f = facts('r1bakab2/9/9/3N5/9/9/9/9/9/5K3 w', '3312');
  assert.deepEqual([f.fork.by.name, f.fork.targets.map(t => t.name), f.fork.withCheck], ['马', ['车', '将'], true]);
  assert.deepEqual(f.tags, ['将', '捉']);
  // a threat through a screen names the screen
  f = facts('4k4/9/r8/9/9/P3P4/9/1C7/9/4K4 w', '7170');
  assert.deepEqual(f.threats.map(t => [t.by.name, t.target.name, t.capture.notation, t.gain, t.viaScreen.name]), [['炮', '车', '炮九进五', 900, '九路兵']]);
  // the horse steps in as the cannon's screen: the cannon's new threat is not "discovered" (nothing moved out of its way)
  f = facts('3k5/9/r8/9/9/1N7/9/C8/9/4K4 w', '5130');
  assert.deepEqual(f.threats.map(t => [t.by.name, t.target.name, t.gain, t.discovered, t.viaScreen.name]), [['炮', '车', 900, false, '马']]);
  assert.ok(!f.tags.includes('闪'));

  // discovered and double check
  f = facts('4k4/9/5r3/9/4N4/9/4R4/9/9/3K5 w', '4425');
  assert.deepEqual([squares(f.check.checkers.map(p => p.at)), f.check.discovered, f.check.double, f.check.mate], [['25', '64'], true, true, false]);
  assert.deepEqual(f.tags, ['将', '吃', '闪']);

  // pawnCrossed for both colours, 闲 when nothing else applies, and nothing invented for a quiet move
  assert.equal(facts('4k4/9/9/9/9/P3P4/9/9/9/4K4 w', '5040').pawnCrossed, true);
  assert.equal(facts('4k4/9/9/9/p8/4P4/9/9/9/4K4 b', '4050').pawnCrossed, true);
  assert.equal(facts('4k4/9/9/9/P8/4P4/9/9/9/4K4 w', '4030').pawnCrossed, false);
  f = facts(START, '9384', { ply: 0 });
  assert.deepEqual(f, {
    move: { from: { row: 9, col: 3 }, to: { row: 8, col: 4 }, notation: '仕六进五', piece: 'advisor', color: 'red', captured: null },
    fenBefore: START,
    fenAfter: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4A4/RNB1KABNR b',
    tags: ['闲'], capture: null, check: null, escapesCheck: false, threats: [], parried: [], exposed: [], fork: null,
    pins: { created: [], released: [], suffered: [] }, blocks: [], opens: [], kingSqueeze: { before: 1, after: 1 },
    mateThreat: null, allowsMate: null, patterns: [], pawnCrossed: false,
  });

  // opts.before is used when it belongs to the position (same result), and an illegal move is rejected
  const before = positionFacts('4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w');
  assert.deepEqual(moveFacts(before.fen, ref('6344'), { before }), moveFacts(before.fen, ref('6344')));
  assert.deepEqual(moveFacts(before.fen, ref('6344'), { before: positionFacts(START) }), moveFacts(before.fen, ref('6344')));
  assert.throws(() => moveFacts(START, ref('6061')), RangeError);
  assert.throws(() => moveFacts(START, { from: { row: 9, col: 9 }, to: { row: 8, col: 4 } }), RangeError);
});

test('moves around a check: an answer is not credited with what stood before it, what it leaves to be taken is left-hanging, and a check releases no pin that still stands', () => {
  const facts = (fen, moveCode) => moveFacts(fen, ref(moveCode));
  const pinsOf = list => list.map(p => [p.pinned.name, `${p.pinned.at.row}${p.pinned.at.col}`, p.by.name, p.shield.name, p.absolute]);
  const hangingOf = (fen, color) => positionFacts(fen).hanging.filter(h => h.piece.color === color).map(h => [h.piece.name, h.capture.notation, h.gain]);

  // ---- threats ----
  // The red horse attacks both black rooks; red is in check from the horse d3 and may not take either. Stepping out of the
  // check does not make that fork: it stood before. (While in check the captures are not legal, so the facts of the
  // position before do not list the rooks; the same position without the checking horse does.)
  const forked = '3k5/9/3r1r3/9/4N4/9/9/3n5/9/4K4 w';
  assert.deepEqual(hangingOf(forked, 'black'), []);
  assert.deepEqual(hangingOf('3k5/9/3r1r3/9/4N4/9/9/9/9/4K4 w', 'black'), [['4路车', '马五进六', 500], ['6路车', '马五进四', 500]]);
  for (const answer of ['9484', '9493']) {
    const f = facts(forked, answer);
    assert.equal(f.escapesCheck, true);
    assert.deepEqual([f.threats, f.fork, f.patterns, f.tags], [[], null, [], ['闲']], `${answer}: the king step forks nothing`);
    // ... although the rooks do hang in the position after it
    assert.deepEqual(hangingOf(f.fenAfter, 'black').map(h => h[0]), ['4路车', '6路车']);
  }
  // An answer that does make a threat keeps it: the rook takes the checking horse and now looks at the other horse.
  let f = facts('4k4/9/9/9/4N4/9/9/R2n3n1/9/4K4 w', '7073');
  assert.deepEqual([f.escapesCheck, f.threats.map(t => [t.by.name, t.target.name, t.capture.notation, t.gain]), f.tags], [true, [['车', '马', '车六平二', 400]], ['吃', '捉']]);
  // A move that gives check and attacks a piece threatens that piece, also when one answer still saves it. 挂角马: the
  // horse checks from d8 and attacks the rook b9; black keeps the rook only by 车2平4, which blocks the horse's leg.
  const cornerFen = '4k4/1r7/9/9/2N6/9/9/9/9/5K3 w';
  f = facts(cornerFen, '4223');
  assert.deepEqual(f.threats.map(t => [t.by.name, t.target.name, t.capture.notation, t.gain, t.discovered]), [['马', '车', '马六进八', 900, false]]);
  assert.deepEqual([f.fork.by.name, f.fork.targets.map(t => t.name), f.fork.withCheck], ['马', ['车', '将'], true]);
  assert.deepEqual(f.patterns.map(p => p.id), ['corner_horse', 'check_fork']);
  const cornerBoard = applyMove(fenToBoard(cornerFen).board, ref('4223'));
  const saved = getLegalMoves(cornerBoard, 'black').filter(reply => bestExchange(applyMove(cornerBoard, reply), 'red', code(reply).startsWith('11') ? reply.to : sq('11')) < 100);
  assert.deepEqual(saved.map(code), ['1113'], 'one answer saves the rook; after every other one the horse takes it');

  // ---- exposed ----
  // Red is in check from the rook e6, and its rook a6 is attacked by the horse b8 (and by that rook). Taking the
  // checking rook would save it. An advisor that interposes leaves it to be taken: left hanging, not uncovered (the
  // advisor never guarded or covered it), and the danger is that of an ignored threat.
  const ignored = '2bakab2/9/1n7/9/R3r4/9/9/9/9/2BAKAB2 w';
  assert.deepEqual(hangingOf(ignored, 'red'), [['车', '马2进1', 900]]);
  assert.ok(capturesOn(fenToBoard(ignored).board, 'black', sq('40')).some(m => m.piece.type === 'horse'), 'the horse attacked the rook before the move');
  f = facts(ignored, '9584');
  assert.deepEqual(f.exposed.map(e => [e.piece.name, e.by.name, e.capture.notation, e.gain, e.cause]), [['车', '马', '马2进1', 900, 'left-hanging']]);
  assert.deepEqual(f.parried, []);
  f = facts(ignored, '4044');
  assert.deepEqual([f.exposed, f.parried.map(p => [p.piece.name, p.how])], [[], [['车', 'moved']]], 'the answer that takes the checking rook saves the rook');
  const careless = assess(ignored, '9584').assessment;
  assert.deepEqual([careless.cat, careless.refutation.danger, careless.refutation.reply.notation, squares(careless.refutation.focus)], ['blunder', 'leaves_hanging', '马2进1', ['40', '21']]);
  // The other causes stay what they are. The rook c2 guards the horse c3 and is the piece that answers the check
  // (it blocks the leg of the checking horse): the horse is unguarded by the move.
  f = facts('3k5/9/9/2r6/9/9/9/2N2n3/2R6/4K4 w', '8285');
  assert.deepEqual(f.exposed.map(e => [e.piece.name, e.capture.notation, e.gain, e.cause]), [['马', '车3进4', 400, 'unguarded']]);
  // A piece that is lost whatever is played was hanging before and is left hanging (the first test's position).
  f = facts('3k5/9/9/9/9/3r5/9/5n3/9/3NK4 w', '9484');
  assert.deepEqual(f.exposed.map(e => [e.piece.name, e.cause]), [['马', 'left-hanging']]);

  // ---- pins created and suffered by an answer to a check ----
  // The black rook a7 pins the red horse e7 against the red rook i7 before and after black's king steps out of check.
  // The position in check cannot show the pin (black may not take anything), but the king did not create it.
  const pinned = '5k3/9/9/r3N3R/9/5R3/9/9/9/3K5 b';
  f = facts(pinned, '0504');
  assert.equal(f.escapesCheck, true);
  assert.deepEqual(pinsOf(positionFacts(pinned).pins), []);
  assert.deepEqual(pinsOf(positionFacts(f.fenAfter).pins), [['马', '34', '车', '一路车', false]]);
  assert.deepEqual([f.pins.created, f.pins.suffered, f.pins.released], [[], [], []]);
  // An answer that does create a pin keeps it: the rook takes the checking horse and pins the other horse against the rook.
  f = facts('4k4/9/r2N2N1R/9/9/9/9/9/9/5K3 b', '2023');
  assert.deepEqual([f.escapesCheck, pinsOf(f.pins.created)], [true, [['马', '26', '车', '车', false]]]);
  // suffered: the red rook e5 is pinned on the file by the rook e10 before and after the king's step up the same file
  const filePin = '3kr4/9/9/9/9/4R4/9/5n3/9/4K4 w';
  f = facts(filePin, '9484');
  assert.deepEqual(pinsOf(positionFacts(f.fenAfter).pins), [['车', '54', '车', '帅', true]]);
  assert.deepEqual([f.pins.suffered, f.pins.created], [[], []], 'the pin is not new');
  // ... while a piece that interposes and is pinned by that is newly pinned (see the moveFacts test: 马七进五)
  assert.equal(facts('3k5/4r4/9/9/9/9/2N6/9/9/4K4 w', '6254').pins.suffered.length, 1);

  // ---- pins released by a move that gives check ----
  // The same relative pin, held by black against red. Red checks with the other rook: black cannot use the pin while
  // it is in check and the position after the move does not list it, but the check did not release it (the horse is
  // pinned again as soon as the black king steps out of the check).
  const held = '3k5/9/9/r3N3R/9/5R3/9/9/9/4K4 w';
  assert.deepEqual(pinsOf(positionFacts(held).pins), [['马', '34', '车', '一路车', false]]);
  f = facts(held, '5553');
  assert.notEqual(f.check, null);
  assert.deepEqual(pinsOf(positionFacts(f.fenAfter).pins), []);
  assert.deepEqual(f.pins.released, []);
  const { board: checked } = fenToBoard(f.fenAfter);
  const answers = getLegalMoves(checked, 'black').filter(m => m.piece.type === 'king');
  assert.ok(answers.length >= 1);
  for (const reply of answers) {
    const again = pinsOf(positionFacts(boardToFen(applyMove(checked, reply), 'red')).pins);
    assert.ok(again.some(p => p[0] === '马' && p[1] === '34'), `after ${code(reply)} the horse is pinned again`);
  }
  // ... but the pinned horse that leaves with a check of its own is no longer pinned
  f = facts(held, '3415');
  assert.notEqual(f.check, null);
  assert.deepEqual(pinsOf(f.pins.released), [['马', '15', '车', '一路车', false]]);
});

test('dangers: one constructed position per DANGER_CODES entry with its focus', () => {
  /** [fen, move, level, expected reply, expected focus squares] per danger; every search is four plies deep */
  const cases = {
    // black ignores 重炮: mated at once; the focus is the mating move
    allows_mate: ['3aka3/9/9/4C4/p8/9/9/1C7/9/4K4 b', '4050', 5, '炮八平五', ['71', '74']],
    // red has 炮八平五 mate and plays the king instead; the focus is the mating move
    misses_mate: ['3aka3/9/9/4C4/9/9/9/1C7/9/4K4 w', '9484', 5, null, ['71', '74']],
    // the rook steps onto a square the black rook attacks
    hangs_moved_piece: ['4k4/9/9/r8/9/1R2P4/9/9/9/4K4 w', '5150', 5, '车1进2', ['50', '30']],
    // the rook was attacked already and red pushes a pawn
    leaves_hanging: ['4k4/9/9/r8/9/R3P4/9/9/9/4K4 w', '5444', 5, '车1进2', ['50', '30']],
    // the rook that guarded the horse leaves it
    unguards: ['3k5/9/9/r8/9/9/N8/9/9/R4K3 w', '9091', 5, '车1进3', ['60', '30', '90']],
    // the horse takes a pawn on the edge, where every leg is blocked; a horse comes to collect it
    bad_trade: ['3nk4/9/n8/pp7/p8/1N7/9/9/9/3K5 w', '5130', 5, '马4进3', ['30', '03']],
    // black pushes a pawn and allows the horse check that also hits the rook
    walks_into_fork: ['r1bakab2/9/9/3N4p/9/9/9/9/9/5K3 b', '3848', 5, '马六进七', ['12', '00', '04']],
    // the horse goes to the back rank, where the rook pins it against the king and wins it
    walks_into_pin: ['4k4/9/5n3/9/9/8R/9/9/9/3K5 b', '2506', 5, '车一进五', ['06', '08']],
    // the cannon gives up its attack on the rook: the focus is the capture it could have played
    misses_win: ['4k4/9/1r7/9/1p7/4P4/9/1C7/9/4K4 w', '7172', 5, null, ['71', '21']],
    // a free pawn is left alone and the rook comes to guard it: nothing concrete goes wrong. (The king step 帅六进一 was
    // the case here until its line, which only returns to this position, stopped being a mistake: CONTRACT-NOTES 150.)
    slow: ['4k3r/9/9/1p7/9/1R2P4/9/9/9/3K5 w', '5152', 9, null, []],
  };
  assert.deepEqual(Object.keys(cases).sort(), [...DANGER_CODES].sort(), 'one case per danger code');
  for (const danger of DANGER_CODES) {
    const [fen, moveCode, level, reply, focus] = cases[danger];
    const { assessment } = assess(fen, moveCode, { level });
    assert.ok(assessment.cat === 'mistake' || assessment.cat === 'blunder', `${danger}: ${assessment.cat}`);
    const refutation = assessment.refutation;
    assert.equal(refutation.danger, danger, danger);
    assert.deepEqual(squares(refutation.focus), focus, danger);
    assert.equal(refutation.line, assessment.line, danger);
    assert.equal(refutation.outcome, assessment.outcome, danger);
    assert.equal(refutation.reply, assessment.line.moves[1], danger);
    if (reply !== null) assert.equal(refutation.reply.notation, reply, danger);
    assert.ok(refutation.revealDepth >= 1 && refutation.revealDepth <= assessment.depth + 1, danger);
    assert.equal(assessment.isBest, false, danger);
    assert.ok(assessment.loss > 0, danger);
  }
  // what the cases rest on
  const net = (danger, level = 5) => assess(cases[danger][0], cases[danger][1], { level }).assessment;
  assert.equal(net('allows_mate').flags.allowsMate, true);
  assert.equal(net('allows_mate').outcome.mate, 'suffers');
  assert.equal(net('misses_mate').flags.missedMate, true);
  assert.equal(net('misses_mate').bestOutcome.mate, 'gives');
  assert.deepEqual([net('hangs_moved_piece').outcome.kind, net('hangs_moved_piece').outcome.lost[0]], ['loses', { piece: 'rook', points: 9 }]);
  assert.deepEqual([net('bad_trade').outcome.kind, net('bad_trade').outcome.net], ['bad-trade', 1 - 4]);
  assert.ok(net('walks_into_fork').outcome.net <= -1 && net('walks_into_pin').outcome.net <= -1);
  assert.equal(net('misses_win').flags.missedWin, true);
  assert.ok(net('misses_win').bestOutcome.net >= 2);
  assert.ok(net('slow', 9).bestOutcome.net < 2, 'the best line of the "slow" case wins less than two points');
  // a move that is not bad has no refutation
  const opening = analyze(START, { allDepth: 4 });
  const fine = assess(START, code(opening.lines[0].move)).assessment;
  assert.deepEqual([fine.cat, fine.refutation, fine.isBest, fine.loss], ['best', null, true, 0]);
});

test('materialOutcome: every kind; an exchange is never cut in the middle; crossed pawn counts 2', () => {
  const lineOfCodes = (fen, codes) => {
    const { board, turn } = fenToBoard(fen);
    const line = toLine(board, turn, codes.map(ref));
    assert.equal(line.moves.length, codes.length, 'every move of the test line is legal');
    return line;
  };
  // Red rook a5, pawn e5; black rooks a7 and i7 (i7 guards a7), black cannon i10.
  const fen = '4k3c/9/9/r7r/9/R3P4/9/9/9/4K4 w';
  // none
  assert.deepEqual(materialOutcome(lineOfCodes(fen, ['5444', '0403']), 'red'), { net: 0, won: [], lost: [], kind: 'none', mate: null, plies: 2, settled: true });
  // wins / loses: the same line from both sides (a rook taken and nothing given)
  const free = lineOfCodes('4k4/9/9/r8/9/R3P4/9/9/9/4K4 w', ['5030', '0403']);
  assert.deepEqual(materialOutcome(free, 'red'), { net: 9, won: [{ piece: 'rook', points: 9 }], lost: [], kind: 'wins', mate: null, plies: 2, settled: true });
  assert.deepEqual(materialOutcome(free, 'black'), { net: -9, won: [], lost: [{ piece: 'rook', points: 9 }], kind: 'loses', mate: null, plies: 2, settled: true });
  // even-trade: rook for rook
  const even = lineOfCodes(fen, ['5030', '3830']);
  assert.deepEqual(materialOutcome(even, 'red'), { net: 0, won: [{ piece: 'rook', points: 9 }], lost: [{ piece: 'rook', points: 9 }], kind: 'even-trade', mate: null, plies: 2, settled: true });
  // good-trade / bad-trade: cannon for rook, seen from both sides; horse for cannon is half a point: an even trade
  const cannonFen = '5k3/9/9/c1P1R4/4P4/9/9/9/9/3K5 b';
  const trade = lineOfCodes(cannonFen, ['3034', '4434']);                 // the cannon takes the rook over the pawn c7, the pawn e6 retakes
  assert.deepEqual(materialOutcome(trade, 'black').kind, 'good-trade');
  assert.deepEqual([materialOutcome(trade, 'black').net, materialOutcome(trade, 'red').net, materialOutcome(trade, 'red').kind], [4.5, -4.5, 'bad-trade']);
  const half = lineOfCodes(START, ['7101', '0001']);
  assert.deepEqual([materialOutcome(half, 'red').net, materialOutcome(half, 'red').kind, materialOutcome(half, 'black').kind], [-0.5, 'even-trade', 'even-trade']);

  // an exchange is never cut in the middle: with maxPlies 1 the recapture is still walked
  assert.deepEqual(materialOutcome(even, 'red', 1), materialOutcome(even, 'red'));
  assert.equal(materialOutcome(even, 'red', 1).plies, 2);
  // ... but only while the plies are captures, and for at most four more plies
  const quietThenTake = lineOfCodes(fen, ['5444', '0403', '5030', '3830']);
  assert.deepEqual([materialOutcome(quietThenTake, 'red', 1).plies, materialOutcome(quietThenTake, 'red', 3).plies], [1, 4]);
  // six captures in a row on d5 (horse, horse, horse, horse, rook, rook): from maxPlies 1 the walk goes on for four
  // more plies; the sixth capture is then the pending capture that the tail settles, so the balance is that of the whole line
  const chainFen = '4k4/3r5/9/2n1n4/9/3p5/9/2N1N4/3R5/3K5 w';
  const chain = lineOfCodes(chainFen, ['7253', '3253', '7453', '3453', '8353', '1353']);
  const whole = materialOutcome(chain, 'red');
  assert.deepEqual([whole.plies, whole.net, whole.kind, whole.won.map(w => w.points), whole.lost.map(l => l.points)], [6, 2 + 4 + 4 - 4 - 4 - 9, 'bad-trade', [2, 4, 4], [4, 4, 9]]);
  const stopped = materialOutcome(chain, 'red', 1);
  assert.equal(stopped.plies, 5);
  assert.deepEqual([stopped.net, stopped.kind, stopped.won, stopped.lost], [whole.net, whole.kind, whole.won, whole.lost]);
  // the first five captures as a line of their own: taken at its word when it says quiet, settled when it was cut
  const five = { ...chain, moves: chain.moves.slice(0, 5), end: 'quiet' };
  assert.deepEqual([materialOutcome(five, 'red').net, materialOutcome(five, 'red').kind], [2, 'good-trade']);
  assert.deepEqual([materialOutcome({ ...five, end: 'cut' }, 'red').net, materialOutcome({ ...five, end: 'cut' }, 'red').plies], [-7, 5]);

  // crossed pawn counts 2: the red pawn has crossed the river when the black rook takes it on a6
  const pawns = lineOfCodes('rnbakabnr/9/1c5c1/2p1p1p1p/p8/P8/2P1P1P1P/1C5C1/9/RNBAKABNR w', ['5040', '0040', '9040']);
  assert.deepEqual(materialOutcome(pawns, 'red'), {
    net: 1 + 9 - 2, won: [{ piece: 'pawn', points: 1 }, { piece: 'rook', points: 9 }], lost: [{ piece: 'pawn', points: 2 }], kind: 'good-trade', mate: null, plies: 3, settled: true,
  });

  // the tail: a line that was cut while a capture is pending is settled by the whole exchange on that square.
  // After 兵五进一 the black cannon can take the rook e7 over the pawn c7; the pawn retakes: rook for cannon.
  const cut = { ...lineOfCodes('5k3/9/9/c1P1R4/9/4P4/9/9/9/3K5 w', ['5444']), end: 'cut' };
  assert.deepEqual(materialOutcome(cut, 'red'), {
    net: 4.5 - 9, won: [{ piece: 'cannon', points: 4.5 }], lost: [{ piece: 'rook', points: 9 }], kind: 'bad-trade', mate: null, plies: 1, settled: true,
  });
  // the same line marked quiet is taken at its word: nothing is added
  assert.equal(materialOutcome({ ...cut, end: 'quiet' }, 'red').kind, 'none');
  // a line that is longer than maxPlies is settled where the walk stops, whatever its end says
  const long = lineOfCodes('5k3/9/9/c1P1R4/9/4P4/9/9/9/3K5 w', ['5444', '0515', '9394']);
  assert.deepEqual([materialOutcome(long, 'red', 1).net, materialOutcome(long, 'red', 1).plies, materialOutcome(long, 'red').net], [-4.5, 1, 0]);
  // a pending capture that does not pay is not counted: the cannon would take a horse that the rook guards
  assert.equal(materialOutcome({ start: START, moves: [], end: 'cut' }, 'red').kind, 'none');
  // every result is settled and plain data
  for (const line of [free, even, trade, chain, pawns, cut]) {
    const out = materialOutcome(line, 'red');
    assert.equal(out.settled, true);
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
    const sum = list => list.reduce((total, item) => total + item.points, 0);
    assert.equal(out.net, sum(out.won) - sum(out.lost));
  }
});

test('materialOutcome is settled: for 500 searched lines net*100 is within 150 cp of the score change in at least 95 % (no mate involved)', () => {
  // 500 positions of seeded playouts (the first 40 plies of each, every second ply), each searched four plies deep.
  // The line is the principal variation of the best move; the score change is the search score minus the static
  // evaluation before the move, both for the side to move.
  const lines = createSearcher();
  let counted = 0, within = 0;
  for (const p of playoutPositions(1200, { seed: 7, stride: 2, plies: 40 })) {
    if (counted === 500) break;
    if (p.moves.length < 2) continue;
    const fen = boardToFen(p.board, p.turn);
    const table = lines.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 4 });
    const best = table.lines[0];
    if (Math.abs(best.score) >= WIN) continue;
    const hint = hintFor({ fen, ply: p.ply, table, move: best.move, facts: positionFacts(fen), threat: null });
    const outcome = hint.outcome;
    assert.equal(outcome.settled, true);
    assert.deepEqual(outcome, materialOutcome(hint.line, p.turn));
    if (outcome.mate !== null) continue;
    counted++;
    const change = scoreToCp(best.score) - Position.fromFen(fen).evaluate();
    if (Math.abs(outcome.net * 100 - change) <= 150) within++;
  }
  assert.equal(counted, 500);
  assert.ok(within / counted >= 0.95, `${within} of ${counted} lines are within 150 cp`);
});

test('materialOutcome: the balance of a line is what the line does: the whole line is walked, and the tail never counts what the other side takes back (CONTRACT-NOTES 150)', () => {
  const lineOfCodes = (fen, codes) => {
    const { board, turn } = fenToBoard(fen);
    const line = toLine(board, turn, codes.map(ref));
    assert.equal(line.moves.length, codes.length, 'every move of the test line is legal');
    return line;
  };
  const brief = out => [out.net, out.kind, out.won.map(p => p.piece), out.lost.map(p => p.piece), out.plies];

  // (a) Without maxPlies the whole line is walked. A searched line of eight plies (炮二平一 车7平1 仕四进五 车1进1 帅六进一
  // 炮2退1 车一退一 车1退1): after six of them the red cannon could take the rook on the edge, but the line goes on 车一退一
  // and takes nothing. The balance read "red wins a rook".
  const eight = lineOfCodes('2bakab1r/9/2n3nc1/p1p1p1p1p/9/7C1/P3P1P1P/6r2/3K4R/1c3A3 w', ['5758', '7670', '9584', '7080', '8373', '9181', '8898', '8070']);
  assert.deepEqual(brief(materialOutcome(eight, 'red')), [0, 'none', [], [], 8]);
  // an explicit maxPlies keeps its meaning: the walk stops there and the position reached is settled, now by the same
  // rule as a cut line. The cannon takes the rook and the red rook falls in return: nothing is counted there either.
  assert.deepEqual(brief(materialOutcome(eight, 'red', 6)), [0, 'none', [], [], 6]);
  assert.equal(materialOutcome(eight, 'red', 8).net, 0);

  // (b) A line that really ends cut. At the end of this one black can take a cannon with the elephant, and red then
  // takes a horse with the rook: half a point, not a cannon. The tail claimed the cannon (net 4 with the line's own -0.5).
  const cutLine = { ...lineOfCodes('rn1akab1r/9/4b1nc1/p3pC2p/2p3C2/P8/4P1P1P/N1c1B4/5N3/R1BAKA2R b', ['0010', '7051', '1015', '9897', '1535', '9727', '3585', '5172']), end: 'cut' };
  assert.deepEqual(brief(materialOutcome(cutLine, 'black')), [-0.5, 'even-trade', ['cannon', 'horse'], ['cannon', 'cannon'], 8]);
  assert.deepEqual(materialOutcome(cutLine, 'black'), materialOutcome({ ...cutLine, end: 'quiet' }, 'black'), 'nothing is added to the line');
  assert.equal(materialOutcome(cutLine, 'red').net, 0.5);

  // The three cases on small boards. Black has just played the horse to h6, where it attacks the piece on i4; the red
  // horse c3 can take the piece on b5, which nothing guards. Every line is one ply long and marked cut.
  const tail = (fen, pov = 'red') => brief(materialOutcome({ ...lineOfCodes(fen, ['2647']), end: 'cut' }, pov));
  // ... a cannon to take, but then the horse takes the rook: red would rather not. Nothing is counted (it read +4.5).
  assert.deepEqual(tail('3k5/9/6n2/9/9/1c7/8R/2N6/9/4K4 b'), [0, 'none', [], [], 1]);
  // ... a rook to take, and the horse takes a cannon in return: both are counted (it read "wins a rook", +9).
  assert.deepEqual(tail('3k5/9/6n2/9/9/1r7/8C/2N6/9/4K4 b'), [4.5, 'good-trade', ['rook'], ['cannon'], 1]);
  assert.deepEqual(tail('3k5/9/6n2/9/9/1r7/8C/2N6/9/4K4 b', 'black'), [-4.5, 'bad-trade', ['cannon'], ['rook'], 1]);
  // ... a cannon to take, and the horse takes a horse in return: less than a pawn is left, nothing is counted.
  assert.deepEqual(tail('3k5/9/6n2/9/9/1c6P/8N/2N6/9/4K4 b'), [0, 'none', [], [], 1]);
  // ... and a piece that is simply en prise is counted as before
  assert.deepEqual(tail('3k5/9/6n2/9/9/1c7/9/2N6/9/4K4 b'), [4.5, 'wins', ['cannon'], [], 1]);

  // A line with no move at all is the question brain.js asks to mark a principal variation as cut ("is a capture
  // pending here?"): the answer stays the best pending capture and the exchange on its square.
  const pending = fen => brief(materialOutcome({ start: fen, moves: [], end: 'cut' }, 'red'));
  assert.deepEqual(pending('3k5/9/9/9/7n1/1c7/8R/2N6/9/4K4 w'), [4.5, 'wins', ['cannon'], [], 0]);
  assert.deepEqual(pending('3k5/9/9/9/7n1/1c6P/8N/2N6/9/4K4 w'), [4.5, 'wins', ['cannon'], [], 0]);
});

test('materialOutcome is settled at the depth the assess job uses: for 150 lines of pair depth 7 net*100 is within 150 cp of the score change in at least 95 % (CONTRACT-NOTES 150)', () => {
  // The criterion of the test above on lines as long as the game's own (seven plies and the quiescence behind them): the
  // same playouts, the best move and the second line of a four-ply table, each assessed with a pair of depth 7.
  // Six plies and a static capture gave 124 of these 150 (82.7 %).
  const lines = createSearcher();
  let counted = 0, within = 0;
  for (const p of playoutPositions(4000, { seed: 7, stride: 2, plies: 40 })) {
    if (counted >= 150) break;
    if (p.moves.length < 2 || p.ply < 6) continue;
    const fen = boardToFen(p.board, p.turn);
    const table = lines.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 4, allDepth: 4 });
    const best = table.lines[0];
    if (Math.abs(best.score) >= WIN) continue;
    for (const line of [best, table.lines[1]]) {
      const pair = lines.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 7, allDepth: 7, minDepth: 4, rootMoves: line === best ? [best.move] : [best.move, line.move] });
      const score = lineOf(pair, line.move).score;
      if (Math.abs(score) >= WIN) continue;
      const assessment = assessMove({ fen, move: line.move, pair, table, level: 5, compare: best.move });
      assert.equal(assessment.outcome.plies, assessment.line.moves.length, 'the whole line is walked');
      if (assessment.outcome.mate !== null) continue;
      counted++;
      if (Math.abs(assessment.outcome.net * 100 - (score - Position.fromFen(fen).evaluate())) <= 150) within++;
    }
  }
  assert.equal(counted, 150);
  assert.ok(within / counted >= 0.95, `${within} of ${counted} lines are within 150 cp`);
});

test('a line that ends in checkmate reports the mate, not the pawn won on the way', () => {
  // Red takes the pawn i9 with the rook, black steps aside, and the other rook mates on the back rank.
  const fen = '4k4/8p/R8/9/9/8R/9/9/9/5K3 w';
  const { board, turn } = fenToBoard(fen);
  const line = toLine(board, turn, ['5818', '0403', '2000'].map(ref));
  assert.equal(line.end, 'mate');
  const red = materialOutcome(line, 'red');
  assert.equal(red.mate, 'gives');
  assert.deepEqual([red.won, red.lost, red.plies], [[{ piece: 'pawn', points: 1 }], [], 3]);
  const black = materialOutcome(line, 'black');
  assert.deepEqual([black.mate, black.kind], ['suffers', 'loses']);
  // the mate must lie inside the walked part: cut after two plies there is no mate to report
  assert.equal(materialOutcome(line, 'red', 2).mate, null);
  // a line that is labelled mate but does not end without a legal move is not believed
  const { board: quietBoard, turn: quietTurn } = fenToBoard(fen);
  assert.equal(materialOutcome({ ...toLine(quietBoard, quietTurn, [ref('5818')]), end: 'mate' }, 'red').mate, null);

  // the same for the facts built on searched lines: the threat is a mate, the hint is a mate, and the assessment says so
  const blackToMove = fen.replace(' w', ' b');
  const facts = positionFacts(blackToMove);
  const pass = analyze(blackToMove, { pass: true, maxDepth: 4 });
  const threat = threatInfo(blackToMove, pass, facts);
  assert.equal(threat.kind, 'mate');
  assert.equal(threat.mate, 2);
  assert.equal(threat.outcome.mate, 'gives');
  assertMatingLine(threat.line, 'red', 'threat line');
  const { assessment } = assess(fen, '5818');
  assert.equal(assessment.flags.givesMate, 2);
  assert.equal(assessment.outcome.mate, 'gives');
  assert.equal(assessment.cat, 'brilliant');
  const table = analyze(fen, { allDepth: 4 });
  assert.equal(hintFor({ fen, ply: 40, table, move: ref('5818'), facts: positionFacts(fen), threat: null }).theme, 'mate');
});

test('verdict thresholds: every edge at levels 1, 5, 9; compression in won and lost positions; allows-mate forces blunder', () => {
  // verdictScale: the anchors, linear in between, clamped outside
  assert.deepEqual([1, 3, 5, 7, 9].map(verdictScale), [1.5, 1.25, 1.0, 0.9, 0.8]);
  assert.ok(Math.abs(verdictScale(2) - 1.375) < 1e-12 && Math.abs(verdictScale(4) - 1.125) < 1e-12);
  assert.ok(Math.abs(verdictScale(6) - 0.95) < 1e-12 && Math.abs(verdictScale(8) - 0.85) < 1e-12 && Math.abs(verdictScale(5.5) - 0.975) < 1e-12);
  assert.deepEqual([verdictScale(0), verdictScale(-3), verdictScale(12)], [1.5, 1.5, 0.8]);

  // A quiet position; the tried move and the comparison move get hand-made scores.
  const tried = '6252', best = '7774', reply = '3040';
  const cat = (bestScore, moveScore, level) => {
    const pair = tableOf(START, [
      rootLine(best, bestScore, { pv: [ref(best), ref(reply)] }),
      rootLine(tried, moveScore, { pv: [ref(tried), ref(reply)] }),
    ]);
    const assessment = assessMove({ fen: START, move: ref(tried), pair, table: null, level, compare: ref(best) });
    const quick = quickVerdict(pair, ref(tried), level);
    assert.equal(quick.cat, assessment.cat === 'brilliant' ? 'best' : assessment.cat, `quickVerdict agrees at ${bestScore} / ${moveScore} / level ${level}`);
    assert.equal(assessment.loss, Math.max(0, scoreToCp(bestScore) - scoreToCp(moveScore)));
    assert.equal(assessment.refutation !== null, assessment.cat === 'mistake' || assessment.cat === 'blunder');
    return assessment.cat;
  };
  // every edge: the first value is still the milder verdict, the next centipawn tips it
  for (const [level, k] of [[1, 1.5], [5, 1.0], [9, 0.8]]) {
    const at = loss => cat(0, -loss, level);
    assert.deepEqual([at(300 * k), at(300 * k + 1)], ['mistake', 'blunder'], `blunder edge at level ${level}`);
    assert.deepEqual([at(120 * k), at(120 * k + 1)], ['ok', 'mistake'], `mistake edge at level ${level}`);
    assert.deepEqual([at(50 * k), at(50 * k + 1)], ['good', 'ok'], `ok edge at level ${level}`);
    assert.deepEqual([at(15), at(16)], ['best', 'good'], `good edge at level ${level} does not scale`);
    assert.equal(at(0), 'best');
  }
  // the tried move being the better one is never a loss
  assert.equal(cat(-40, 0, 5), 'best');

  // compression: both scores >= +500 count 0.4, both <= -500 count 0.5, otherwise in full
  assert.equal(cat(1300, 500, 5), 'blunder');         // 0.4 * 800 = 320
  assert.equal(cat(1250, 500, 5), 'mistake');         // 0.4 * 750 = 300
  assert.equal(cat(1250, 499, 5), 'blunder');         // not compressed: 751
  assert.equal(cat(800, 500, 5), 'ok');               // 0.4 * 300 = 120
  assert.equal(cat(-500, -1100, 5), 'mistake');       // 0.5 * 600 = 300
  assert.equal(cat(-500, -1102, 5), 'blunder');       // 0.5 * 602 = 301
  assert.equal(cat(-499, -1099, 5), 'blunder');       // not compressed: 600
  assert.equal(cat(-500, -600, 5), 'good');           // 0.5 * 100 = 50
  assert.equal(cat(-400, -500, 5), 'ok');             // not compressed: 100

  // allows-mate forces blunder: in a lost position the loss alone would be mild (0.5 * 100 = 50)
  const matedInOne = -(MATE - 2);
  assert.equal(cat(-1950, matedInOne, 5), 'blunder');
  assert.equal(cat(-1950, -1900, 5), 'best');
  // ... but not when the best move is mated as well
  assert.equal(cat(-(MATE - 4), matedInOne, 5), 'best');
  // ... and a repetition verdict (|mate| >= 50) is not a mate: same centipawns, no forced blunder, no allows-mate flag
  const banned = -(MATE - 100 - 3);
  assert.equal(scoreToCp(banned), -2000);
  assert.equal(cat(-1950, banned, 5), 'good');
  const flagsOf = moveScore => assessMove({
    fen: START, move: ref(tried), table: null, level: 5, compare: ref(best),
    pair: tableOf(START, [rootLine(best, -1950, { pv: [ref(best), ref(reply)] }), rootLine(tried, moveScore, { pv: [ref(tried), ref(reply)] })]),
  });
  assert.deepEqual([flagsOf(matedInOne).flags.allowsMate, flagsOf(matedInOne).refutation.danger], [true, 'allows_mate']);
  assert.deepEqual([flagsOf(banned).flags.allowsMate, flagsOf(banned).refutation], [false, null]);
  // the same for a win: MATE - 3 is a mate in two, a ban score in the opponent's disfavour is not a mate
  const winning = score => assessMove({
    fen: START, move: ref(tried), table: null, level: 5, compare: ref(tried),
    pair: tableOf(START, [rootLine(tried, score, { pv: [ref(tried), ref(reply)] })]),
  });
  assert.deepEqual([winning(MATE - 3).flags.givesMate, winning(MATE - 3).cat], [2, 'brilliant']);
  assert.deepEqual([winning(MATE - 1).flags.givesMate, winning(MATE - 1).cat], [1, 'best']);
  assert.deepEqual([winning(MATE - 100 - 3).flags.givesMate, winning(MATE - 100 - 3).cat, winning(MATE - 100 - 3).moveCp], [null, 'best', 2000]);
});

test('a move is not best because the scale has run out: beyond +-1900 the loss is the difference of the search scores (CONTRACT-NOTES 147)', () => {
  // scoreToCp clamps every score that is no mate to +-1900. The loss that decides the category is taken from the search
  // scores themselves, so a move that gives a rook away far behind (or far ahead) is no longer "as good as the best".
  const tried = '6252', best = '7774', reply = '3040';
  const verdict = (bestScore, moveScore, level = 5) => {
    const pair = tableOf(START, [
      rootLine(best, bestScore, { pv: [ref(best), ref(reply)] }),
      rootLine(tried, moveScore, { pv: [ref(tried), ref(reply)] }),
    ].sort((a, b) => b.score - a.score));
    const a = assessMove({ fen: START, move: ref(tried), pair, table: null, level, compare: ref(best) });
    const q = quickVerdict(pair, ref(tried), level);
    assert.equal(q.cat, a.cat === 'brilliant' ? 'best' : a.cat, `quickVerdict agrees at ${bestScore} / ${moveScore} / level ${level}`);
    assert.deepEqual([q.loss, q.isBest], [a.loss, a.isBest], `quickVerdict agrees at ${bestScore} / ${moveScore}`);
    // what is stored and shown stays clamped; other code reads -2000 as "mated"
    assert.deepEqual([a.bestCp, a.moveCp], [Math.max(scoreToCp(bestScore), scoreToCp(moveScore)), scoreToCp(moveScore)]);
    assert.equal(a.refutation !== null, a.cat === 'mistake' || a.cat === 'blunder');
    return [a.cat, a.loss, a.isBest];
  };

  // far behind: both moves read -1900, the tried one is 900 worse. In a lost position the loss counts half (450).
  assert.deepEqual(verdict(-2000, -2900, 1), ['mistake', 900, false]);       // 450 is not above 300 * 1.5
  assert.deepEqual(verdict(-2000, -2900, 5), ['blunder', 900, false]);
  assert.deepEqual(verdict(-2000, -2900, 9), ['blunder', 900, false]);
  assert.deepEqual(verdict(-2000, -2902, 1), ['blunder', 902, false]);       // 451
  // far ahead (the mirror case): both read +1900; in a won position the loss counts 0.4 (360)
  assert.deepEqual(verdict(2900, 2000, 1), ['mistake', 900, false]);         // 360 is above 120 * 1.5, not above 450
  assert.deepEqual(verdict(2900, 2000, 5), ['blunder', 900, false]);
  assert.deepEqual(verdict(2900, 2000, 9), ['blunder', 900, false]);
  // the thresholds and the compression are those of 4.6.1, applied to the true difference
  assert.deepEqual(verdict(-2500, -2500), ['best', 0, true]);
  assert.deepEqual(verdict(-2500, -2530), ['best', 30, false]);              // 0.5 * 30 = 15
  assert.deepEqual(verdict(-2500, -2532), ['good', 32, false]);              // 16
  assert.deepEqual(verdict(-2500, -2600), ['good', 100, false]);             // 50
  assert.deepEqual(verdict(-2500, -2602), ['ok', 102, false]);               // 51
  assert.deepEqual(verdict(-2500, -2740), ['ok', 240, false]);               // 120
  assert.deepEqual(verdict(-2500, -2742), ['mistake', 242, false]);          // 121
  assert.deepEqual(verdict(-2500, -3100), ['mistake', 600, false]);          // 300
  assert.deepEqual(verdict(-2500, -3102), ['blunder', 602, false]);          // 301
  assert.deepEqual(verdict(3000, 2700), ['ok', 300, false]);                 // 0.4 * 300 = 120
  assert.deepEqual(verdict(3000, 2699), ['mistake', 301, false]);
  // across the clamp: one score inside the scale, the other beyond it
  assert.deepEqual(verdict(-1800, -2900), ['blunder', 1100, false]);         // read as 100 before: 'good'
  assert.deepEqual(verdict(2900, 1800), ['blunder', 1100, false]);
  // the better move is the better move also where both read the same: the tried move 900 above the comparison move
  assert.deepEqual(verdict(-2900, -2000), ['best', 0, true]);
  assert.deepEqual(verdict(2000, 2900), ['best', 0, true]);
  const worse = assessMove({ fen: START, move: ref(tried), table: null, level: 5, compare: ref(best),
    pair: tableOf(START, [rootLine(best, -2000, { pv: [ref(best), ref(reply)] }), rootLine(tried, -2001, { pv: [ref(tried), ref(reply)] })]) });
  assert.deepEqual([worse.isBest, worse.best.notation, worse.loss, worse.cat], [false, '炮二平五', 1, 'best'], 'one centipawn behind is not "at least as good"');
  // the stored loss is the true difference, capped as before
  assert.deepEqual(verdict(5200, -5200), ['blunder', 9999, false]);

  // A mate score on either side: nothing changes. The difference is that of the centipawn values (2000 against 1900).
  const matedInOne = -(MATE - 2), mateInTwo = MATE - 3, banned = -(MATE - 100 - 3);
  assert.deepEqual(verdict(-2500, matedInOne), ['blunder', 100, false]);     // forced: the move allows a mate and the best did not
  assert.deepEqual(verdict(-2500, banned), ['good', 100, false]);            // a repetition verdict: 0.5 * 100, no forced blunder
  assert.deepEqual(verdict(mateInTwo, 2500), ['good', 100, false]);          // 0.4 * 100 = 40
  assert.deepEqual(verdict(mateInTwo, 400), ['blunder', 1600, false]);
  assert.deepEqual(verdict(matedInOne, -2500), ['best', 0, true]);
  // two mates of different length read the same, as before
  assert.deepEqual(verdict(MATE - 3, MATE - 7), ['brilliant', 0, true]);
  assert.deepEqual(verdict(-(MATE - 8), matedInOne), ['best', 0, true]);

  // quickVerdict for a move that is not exact at the table's depth: the last all-exact iteration and the proven bound,
  // whichever is worse, both as differences of search scores
  const bounded = (upper, byDepth = [-2100, -2200, -2300, -2400]) => tableOf(START, [
    rootLine('7774', -2000, { depth: 6, byDepth: Array(6).fill(-2000) }),
    rootLine('6252', byDepth[3], { depth: 4, upper, byDepth }),
  ], { depth: 6, allDepth: 4 });
  assert.deepEqual(quickVerdict(bounded(-2600), ref('6252'), 5), { cat: 'mistake', loss: 600, depth: 4, isBest: false });      // bound: 0.5 * 600 = 300
  assert.deepEqual(quickVerdict(bounded(-2602), ref('6252'), 5), { cat: 'blunder', loss: 602, depth: 4, isBest: false });
  assert.deepEqual(quickVerdict(bounded(-2100), ref('6252'), 5), { cat: 'mistake', loss: 400, depth: 4, isBest: false });      // iteration 4: 400
  assert.deepEqual(quickVerdict(bounded(-2100, [-2000, -2000, -2000, -2000]), ref('6252'), 5), { cat: 'good', loss: 100, depth: 4, isBest: false });
  // ... a bound that is a mate score counts as centipawns (-1900 against -2000), so iteration 4 decides the loss; the
  // category is that of a move that allows a forced mate when the best move does not (CONTRACT-NOTES 148)
  assert.deepEqual(quickVerdict(bounded(matedInOne), ref('6252'), 5), { cat: 'blunder', loss: 400, depth: 4, isBest: false });
  assert.deepEqual(quickVerdict(bounded(matedInOne, [-2000, -2000, -2000, -2000]), ref('6252'), 1), { cat: 'blunder', loss: 100, depth: 4, isBest: false });
  assert.deepEqual(quickVerdict(bounded(null, [-2000, -2000, -2000, matedInOne]), ref('6252'), 1), { cat: 'blunder', loss: 100, depth: 4, isBest: false });
  // a repetition verdict is no forced mate, and a best move that is mated itself leaves nothing to blunder
  assert.deepEqual(quickVerdict(bounded(banned, [-2000, -2000, -2000, -2000]), ref('6252'), 5), { cat: 'good', loss: 100, depth: 4, isBest: false });
  const allMated = tableOf(START, [
    rootLine('7774', -(MATE - 8), { depth: 6, byDepth: Array(6).fill(-(MATE - 8)) }),
    rootLine('6252', matedInOne, { depth: 4, upper: matedInOne, byDepth: Array(4).fill(matedInOne) }),
  ], { depth: 6, allDepth: 4 });
  assert.equal(quickVerdict(allMated, ref('6252'), 5).cat, 'best');
  // ... and far ahead: the compression of a won position needs both moves above +500
  const ahead = (upper) => tableOf(START, [
    rootLine('7774', 3000, { depth: 6, byDepth: Array(6).fill(3000) }),
    rootLine('6252', 2900, { depth: 4, upper, byDepth: [3000, 3000, 2950, 2900] }),
  ], { depth: 6, allDepth: 4 });
  assert.deepEqual(quickVerdict(ahead(2250), ref('6252'), 5), { cat: 'mistake', loss: 750, depth: 4, isBest: false });         // 0.4 * 750 = 300
  assert.deepEqual(quickVerdict(ahead(2248), ref('6252'), 5), { cat: 'blunder', loss: 752, depth: 4, isBest: false });
  assert.deepEqual(quickVerdict(ahead(400), ref('6252'), 5), { cat: 'blunder', loss: 2600, depth: 4, isBest: false });         // not compressed

  // The other comparisons of two scores that decide what the child is told.
  // onlyMove and the alternatives of an assessment (from the table; losses against its first line):
  const others = getLegalMoves(fenToBoard(START).board, 'red').map(code).filter(c => c !== best && c !== tried).slice(0, 3);
  const table = (second) => tableOf(START, [rootLine(best, -2000), rootLine(others[0], second), rootLine(others[1], -2700), rootLine(tried, -2900), rootLine(others[2], -3500)]);
  const withTable = (second) => assessMove({ fen: START, move: ref(tried), table: table(second), level: 5, compare: ref(best),
    pair: tableOf(START, [rootLine(best, -2000, { pv: [ref(best), ref(reply)] }), rootLine(tried, -2900, { pv: [ref(tried), ref(reply)] })]) });
  assert.equal(withTable(-2150).flags.onlyMove, true, 'the second-best move is 150 below the best, though both read -1900');
  assert.equal(withTable(-2149).flags.onlyMove, false);
  assert.deepEqual(withTable(-2150).alternatives.map(x => [code(x.move), x.loss]), [[best, 0], [others[0], 150], [others[1], 700]]);
  // missedWin needs a loss of 200 against a best move that wins: far ahead it is seen again
  const winsRook = { pv: [ref('5030'), ref('0001')] }, quiet = { pv: [ref('5051'), ref('0001')] };
  const hangingRook = '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w';
  const missed = assessMove({ fen: hangingRook, move: ref('5051'), table: null, level: 5, compare: ref('5030'),
    pair: tableOf(hangingRook, [rootLine('5030', 2900, winsRook), rootLine('5051', 2000, quiet)]) });
  assert.deepEqual([missed.flags.missedWin, missed.loss, missed.cat, missed.refutation.danger], [true, 900, 'blunder', 'misses_win']);

  // The position of the task notes, searched for real (red, far behind, to move): 车一平三 puts the rook in front of a pawn
  // that takes it. It was `best` with loss 0 at every level. 帅五退一 is one of the best moves there are.
  const fen = '4kab2/9/b8/2p1p3p/p8/6p1P/1r2n3R/3c5/4K1c2/N2A1A3 w';
  const far = analyze(fen, { maxDepth: 4, allDepth: 4 });
  assert.ok(scoreToCp(far.lines[0].score) < -1500 && far.lines.filter(l => l.score < -1900).length >= 5, 'the scale has run out for most moves');
  const rook = ref('6866'), king = ref('8494'), top = far.lines[0].move;
  const pairOf = (move) => analyze(fen, { maxDepth: 4, allDepth: 4, rootMoves: code(move) === code(top) ? [move] : [top, move] });
  const rookPair = pairOf(rook), kingPair = pairOf(king);
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const a = assessMove({ fen, move: rook, pair: rookPair, table: far, level, compare: top });
    assert.equal(a.move.notation, '车一平三');
    assert.ok(a.cat === 'mistake' || a.cat === 'blunder', `车一平三 at level ${level}: ${a.cat}`);
    assert.ok(a.loss >= 600 && !a.isBest, `the loss is the true one: ${a.loss}`);
    assert.ok(a.moveCp >= -2000 && a.bestCp <= 2000 && a.moveCp === -1900, 'what is stored stays clamped');
    assert.ok(a.outcome.net <= -4 && a.outcome.lost.some(p => p.piece === 'rook'), 'its own line loses the rook');
    assert.notEqual(a.refutation, null);
    const q = quickVerdict(far, rook, level);
    assert.ok(q.cat === 'mistake' || q.cat === 'blunder', `quickVerdict of 车一平三 at level ${level}: ${q.cat}`);
    assert.deepEqual([q.loss, q.isBest], [a.loss, false]);
    const k = assessMove({ fen, move: king, pair: kingPair, table: far, level, compare: top });
    assert.equal(k.move.notation, '帅五退一');
    assert.ok(['brilliant', 'best', 'good'].includes(k.cat), `帅五退一 at level ${level}: ${k.cat}`);
    assert.ok(['best', 'good'].includes(quickVerdict(far, king, level).cat), `quickVerdict of 帅五退一 at level ${level}`);
    // the engine's best move is never a mistake
    assert.equal(quickVerdict(far, top, level).cat, 'best');
  }

  // The mirror case, searched for real: red is far ahead (two rooks, two cannons and two horses against a rook) and
  // 车一进五 puts a rook where the black rook takes it for nothing. It was 妙手 (a "sacrifice" that kept the evaluation at
  // +1900) at every level.
  const won = '3aka3/9/9/9/r8/9/P1P1P1P2/1C5C1/9/RNBAKABNR w';
  const rich = analyze(won, { maxDepth: 4, allDepth: 4 });
  assert.ok(rich.lines.every(l => l.score > 1900), 'every move reads +1900');
  const give = ref('9848'), first = rich.lines[0].move;
  const givePair = analyze(won, { maxDepth: 4, allDepth: 4, rootMoves: [first, give] });
  for (const level of [1, 5, 9]) {
    const a = assessMove({ fen: won, move: give, pair: givePair, table: rich, level, compare: first });
    assert.equal(a.move.notation, '车一进五');
    assert.deepEqual([a.cat, a.isBest, a.flags.sacrifice, a.moveCp, a.bestCp], ['blunder', false, false, 1900, 1900], `level ${level}`);
    assert.ok(a.loss >= 900 && a.outcome.net <= -7, `loss ${a.loss}, net ${a.outcome.net}`);
    assert.equal(a.patterns.some(p => p.id === 'sacrifice_play'), false);
    assert.equal(quickVerdict(rich, give, level).cat, 'blunder');
    const b = assessMove({ fen: won, move: first, pair: analyze(won, { maxDepth: 4, allDepth: 4, rootMoves: [first] }), table: rich, level, compare: first });
    assert.ok(b.cat === 'best' || b.cat === 'brilliant', b.cat);
    assert.equal(quickVerdict(rich, first, level).cat, 'best');
  }
  // the sacrifice clause on its own, with hand-made scores: the rook is given (the reply takes it) and both scores read
  // +1900; only a move that keeps the true evaluation within a pawn of the static one is a sacrifice
  const staticEval = Position.fromFen(won).evaluate();
  assert.ok(staticEval > 2500);
  const given = (score) => assessMove({ fen: won, move: give, table: null, level: 5, compare: give,
    pair: tableOf(won, [rootLine('9848', score, { pv: [ref('9848'), ref('4048')] })]) });
  assert.equal(given(staticEval - 100).flags.sacrifice, true);
  assert.equal(given(staticEval - 101).flags.sacrifice, false);
  assert.equal(scoreToCp(staticEval - 101), 1900, 'which the clamped scores could not tell apart');
});

test('a move after which the mover is mated is no sacrifice, however far behind the mover is (CONTRACT-NOTES 147)', () => {
  // The last position of a scripted game: red is far beyond -1900 and every one of its three moves is mated. 马九进七 puts
  // the horse where the rook takes it and is mated one move later than the others. Mated (-2000) read as "within a pawn"
  // of a static evaluation that reads -1900, so the horse was a sound sacrifice and the move 妙手.
  const fen = '2bakab2/9/2n3n2/p1p1p2rp/c8/9/P1P5P/Br3Kc2/N8/3A1AB2 w';
  assert.ok(Position.fromFen(fen).evaluate() < -1900);
  const table = analyze(fen, { maxDepth: 4, allDepth: 4 });
  assert.equal(table.lines.length, 3);
  assert.ok(table.lines.every(l => l.mate !== null && l.mate < 0), 'every move is mated');
  const horse = ref('8072'), top = table.lines[0].move;
  const pair = analyze(fen, { maxDepth: 4, allDepth: 4, rootMoves: code(top) === code(horse) ? [horse] : [top, horse] });
  for (const level of [1, 5, 9]) {
    const a = assessMove({ fen, move: horse, pair, table, level, compare: top });
    assert.equal(a.move.notation, '马九进七');
    assert.ok(a.outcome.net <= -4 && a.flags.allowsMate, 'the horse is taken and red is mated');
    assert.deepEqual([a.cat, a.flags.sacrifice, a.moveCp], ['best', false, -2000], `level ${level}`);
    assert.equal(a.patterns.some(p => p.id === 'sacrifice_play'), false);
  }
  // the clause on its own, with hand-made scores: the same piece given for a score that is no mate keeps the flag when
  // the evaluation stays within a pawn of the static one; a mated score and a repetition loss never do
  const staticEval = Position.fromFen(fen).evaluate();
  const given = (score) => assessMove({ fen, move: horse, table: null, level: 5, compare: horse,
    pair: tableOf(fen, [rootLine('8072', score, { pv: [ref('8072'), ref('7172')] })]) });
  assert.equal(given(staticEval - 100).flags.sacrifice, true);
  assert.equal(given(staticEval - 101).flags.sacrifice, false);
  assert.equal(given(-(MATE - 4)).flags.sacrifice, false, 'mated in two');
  assert.equal(given(-(MATE - 100 - 3)).flags.sacrifice, false, 'a repetition verdict against the mover');
});

test('a move that gives material away is not steady because the better move mates: the loss is at least what its own line gives away (CONTRACT-NOTES 150)', () => {
  // The end of a won game. Red mates in two with 车一平六; the black rook attacks the rook on the 1 file. 马二进一 (and 23
  // other moves) leaves that rook to be taken. The move stays above +1900 and the best move reads 2000, so its loss was
  // 100 and the move 稳健 at every level, not held.
  const fen = '9/3k5/R2a5/p8/8p/9/P1P1P1P1P/2N1C2NB/3r4R/2BAKA3 w';
  const table = analyze(fen, { maxDepth: 5, allDepth: 5 });
  const [mate, slower] = table.lines;
  assert.deepEqual([moveToNotation(fenToBoard(fen).board, mate.move), mate.mate], ['车一平六', 2]);
  assert.ok(slower.mate !== null && slower.mate > mate.mate, 'a second mating move, one move longer');
  const horse = ref('7758'), keeps = ref('9584');
  const pairOf = move => analyze(fen, { maxDepth: 5, allDepth: 5, rootMoves: [mate.move, move] });
  const horsePair = pairOf(horse), keepsPair = pairOf(keeps);
  const horseScore = lineOf(horsePair, horse).score;
  assert.ok(horseScore > 1900 && horseScore < WIN, `the move stays far ahead: ${horseScore}`);
  for (const level of [1, 5, 9]) {
    const a = assessMove({ fen, move: horse, pair: horsePair, table, level, compare: mate.move });
    assert.equal(a.move.notation, '马二进一');
    assert.ok(a.cat === 'mistake' || a.cat === 'blunder', `马二进一 at level ${level}: ${a.cat}`);
    assert.ok(a.loss >= 800, `the loss is what the line gives away: ${a.loss}`);
    assert.deepEqual([a.moveCp, a.bestCp, a.isBest, a.best.notation, a.flags.missedMate], [1900, 2000, false, '车一平六', true]);
    assert.ok(a.outcome.net <= -8 && a.outcome.lost.some(p => p.piece === 'rook'), 'its own line loses the rook');
    assert.deepEqual([a.refutation.danger, a.refutation.reply.notation], ['misses_mate', '车4平9']);
    // the first face, from the table alone: measured against the best line that is no mate
    const q = quickVerdict(table, horse, level);
    assert.ok(q.cat === 'mistake' || q.cat === 'blunder', `quickVerdict of 马二进一 at level ${level}: ${q.cat}`);
    assert.ok(q.loss >= 800 && !q.isBest, `quick loss ${q.loss}`);
    // the mating move stays best, and so does the mate that takes a move longer
    assert.deepEqual([quickVerdict(table, mate.move, level).cat, quickVerdict(table, slower.move, level).cat], ['best', 'best']);
    const second = assessMove({ fen, move: slower.move, pair: pairOf(slower.move), table, level, compare: mate.move });
    assert.ok(second.cat === 'best' || second.cat === 'brilliant', second.cat);
    // a move that keeps everything misses the mate and nothing else: it loses the 100 it lost before
    const k = assessMove({ fen, move: keeps, pair: keepsPair, table, level, compare: mate.move });
    assert.deepEqual([k.move.notation, k.cat, k.loss, k.outcome.net, k.flags.missedMate], ['仕四进五', 'good', 100, 0, true]);
    assert.equal(quickVerdict(table, keeps, level).cat, 'good');
  }

  // The first face agrees with the assessment for the moves that keep everything as well. Black mates in one with 车9平7;
  // 车2进5 wins a rook without mating, 卒9进1 and 炮5平9 keep everything, 车9退2 leaves the rook to the elephant. Measured
  // against 车2进5 the two quiet moves were 失误 or 漏着 at first sight and 稳健 in the assessment.
  const second = '2bakab2/9/2n6/p1p1p3p/1r4p2/2Pnc1B1P/P3N1P2/9/4A4/R2AK1B1r b';
  const board2 = fenToBoard(second).board;
  const table2 = analyze(second, { maxDepth: 4, allDepth: 4 });
  assert.deepEqual([moveToNotation(board2, table2.lines[0].move), table2.lines[0].mate], ['车9平7', 1]);
  const winsRook = table2.lines.find(l => l.mate === null);
  assert.equal(moveToNotation(board2, winsRook.move), '车2进5', 'the best line that is no mate');
  for (const [code, notation, fine] of [['3848', '卒9进1', true], ['5458', '炮5平9', true], ['9878', '车9退2', false]]) {
    const move = ref(code);
    assert.equal(moveToNotation(board2, move), notation);
    assert.ok(winsRook.score - lineOf(table2, move).score > 600, `${notation} is far behind the line that wins the rook`);
    const pair2 = analyze(second, { maxDepth: 5, allDepth: 5, rootMoves: [table2.lines[0].move, move] });
    for (const level of [1, 5, 9]) {
      const a = assessMove({ fen: second, move, pair: pair2, table: table2, level, compare: table2.lines[0].move });
      const q = quickVerdict(table2, move, level);
      if (fine) assert.deepEqual([a.cat, a.loss, q.cat, q.loss], ['good', 100, 'good', 100], `${notation} at level ${level}`);
      else assert.ok((a.cat === 'mistake' || a.cat === 'blunder') && (q.cat === 'mistake' || q.cat === 'blunder'), `${notation} at level ${level}: ${a.cat}, ${q.cat}`);
    }
  }

  // The rule on its own, with hand-made scores. Red's rook a5 and the black rook a7 attack each other; 兵五进一 leaves the
  // rook to be taken, 车九平八 steps aside. The comparison move mates in two.
  const hanging = '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w';
  const gives = { pv: [ref('5444'), ref('3050')] }, steps = { pv: [ref('5051'), ref('0403')] };
  const verdict = (bestScore, moveCode, moveScore, extra, level = 5) => {
    const a = assessMove({ fen: hanging, move: ref(moveCode), table: null, level, compare: ref('5030'),
      pair: tableOf(hanging, [rootLine('5030', bestScore), rootLine(moveCode, moveScore, extra)]) });
    return [a.cat, a.loss, a.outcome.net];
  };
  const mateInTwo = MATE - 3;
  assert.deepEqual(verdict(mateInTwo, '5444', 2277, gives, 1), ['mistake', 900, -9]);          // 0.4 * 900 = 360: above 180, not above 450
  assert.deepEqual(verdict(mateInTwo, '5444', 2277, gives, 5), ['blunder', 900, -9]);
  assert.deepEqual(verdict(mateInTwo, '5444', 2277, gives, 9), ['blunder', 900, -9]);
  assert.deepEqual(verdict(mateInTwo, '5051', 2277, steps), ['good', 100, 0], 'a move whose line loses nothing keeps the difference of the centipawn values');
  assert.deepEqual(verdict(mateInTwo, '5444', 400, gives), ['blunder', 1600, -9], 'a larger difference stands');
  assert.deepEqual(verdict(mateInTwo, '5444', MATE - 7, gives), ['brilliant', 0, -9], 'a slower mate is no loss');
  assert.deepEqual(verdict(2900, '5444', 2800, gives), ['good', 100, -9], 'without a mate on the better side the scores decide, as before');

  // quickVerdict has no line: when the best line mates, a move that does not mate is measured against what the mover
  // holds when nothing is given away, the static evaluation of the position. The same two rooks with red's whole army
  // behind them: 前车进二 mates (by hand), 炮二平三 wins a piece, 前车平八 keeps everything, 兵五进一 leaves the rook.
  const far = '4k4/9/9/r8/9/R3P4/9/1C5C1/9/RNBAKABNR w';
  const held = Position.fromFen(far).evaluate();
  assert.ok(held > 3000, `red is far ahead: ${held}`);
  const quick = (lines, moveCode, level = 5, extra = {}) => quickVerdict(tableOf(far, lines, extra), ref(moveCode), level);
  const four = [rootLine('5030', mateInTwo), rootLine('7776', held + 900), rootLine('5051', held + 20), rootLine('5444', held - 900)];
  assert.deepEqual(quick(four, '5444', 1), { cat: 'mistake', loss: 900, depth: 3, isBest: false });    // 0.4 * 900 = 360
  assert.deepEqual(quick(four, '5444', 5), { cat: 'blunder', loss: 900, depth: 3, isBest: false });
  assert.deepEqual(quick(four, '5444', 9), { cat: 'blunder', loss: 900, depth: 3, isBest: false });
  // A move that keeps everything misses the mate and nothing else, as in the assessment: it is not a mistake because
  // another move that does not mate would have won a piece (880 behind that line: 失误 at first sight, 稳健 a moment later).
  for (const level of [1, 5, 9]) {
    assert.deepEqual(quick(four, '5051', level), { cat: 'good', loss: 100, depth: 3, isBest: false }, `the quiet move at level ${level}`);
    assert.deepEqual(quick(four, '7776', level), { cat: 'good', loss: 100, depth: 3, isBest: false });
    assert.deepEqual(quick(four, '5030', level), { cat: 'best', loss: 0, depth: 3, isBest: true });
  }
  assert.deepEqual(quick([rootLine('5030', mateInTwo), rootLine('5444', held - 900)], '5444'), { cat: 'blunder', loss: 900, depth: 3, isBest: false },
    'no other line is needed to measure against');
  assert.deepEqual(quick([rootLine('5030', mateInTwo), rootLine('5051', MATE - 5), rootLine('5444', held - 900)], '5051'), { cat: 'best', loss: 0, depth: 3, isBest: true },
    'a mate that takes a move longer is no loss');
  assert.deepEqual(quick([rootLine('5030', mateInTwo), rootLine('5444', held - 450)], '5444', 1), { cat: 'ok', loss: 450, depth: 3, isBest: false }, 'a cannon: 0.4 * 450 = 180');
  assert.deepEqual(quick([rootLine('5030', mateInTwo), rootLine('5444', held - 450)], '5444', 5), { cat: 'mistake', loss: 450, depth: 3, isBest: false });
  assert.deepEqual(quick([rootLine('5030', mateInTwo), rootLine('5444', 400)], '5444'), { cat: 'blunder', loss: held - 400, depth: 3, isBest: false }, 'a larger difference stands');
  assert.deepEqual(quick([rootLine('5030', held + 1000), rootLine('5051', held + 900), rootLine('5444', held - 900)], '5051'), { cat: 'good', loss: 100, depth: 3, isBest: false },
    'without a mate nothing changes');
  assert.deepEqual(quick([rootLine('5030', held + 1000), rootLine('5051', held + 900), rootLine('5444', held - 900)], '5444', 1), { cat: 'blunder', loss: 1900, depth: 3, isBest: false },
    'without a mate the best line is the measure, as before');
  // ... also for a move that is not exact at the table's depth: by the last all-exact iteration and by the proven bound
  const deep = (upper, byDepth) => [
    rootLine('5030', mateInTwo, { depth: 6, byDepth: [held, held + 100, mateInTwo, mateInTwo, mateInTwo, mateInTwo] }),
    rootLine('5051', held + 20, { depth: 6, byDepth: Array(6).fill(held + 20) }),
    rootLine('5444', byDepth[3], { depth: 4, upper, byDepth }),
  ];
  const partly = { depth: 6, allDepth: 4 };
  const flat = Array(4).fill(held);
  assert.deepEqual(quick(deep(held - 900, flat), '5444', 5, partly), { cat: 'blunder', loss: 900, depth: 4, isBest: false }, 'the bound against what red holds');
  assert.deepEqual(quick(deep(held - 10, [held, held, held - 900, held - 900]), '5444', 5, partly), { cat: 'blunder', loss: 900, depth: 4, isBest: false }, 'iteration 4 against what red holds');
  assert.deepEqual(quick(deep(held - 10, [held, held, held + 50, held + 50]), '5444', 5, partly), { cat: 'good', loss: 100, depth: 4, isBest: false });
});

test('a move whose line only re-creates the position before it is at most 缓着: a turn is lost and nothing else (CONTRACT-NOTES 150)', () => {
  // Red is far ahead. After 帅五进一 the black rook checks, the king steps back and the rook returns: the position of the
  // move, with red to move again. The search scores that first return as a repetition (-20), on purpose; taken as the
  // worth of the move it made the king step a 漏着 with the whole advantage as its loss, and 走后形势 均势.
  const fen = '3akab2/1C2n4/1C7/p1P1p2rp/6p2/9/P3N1P2/R1N1B3R/9/3AKAB2 w';
  const table = analyze(fen, { maxDepth: 4, allDepth: 4 });
  const top = table.lines[0], king = ref('9484');
  assert.ok(top.score > 2000, `red is far ahead: ${top.score}`);
  const pair = analyze(fen, { maxDepth: 4, allDepth: 4, rootMoves: [top.move, king] });
  assert.equal(lineOf(pair, king).score, -20, 'the search scores the return as a repetition');
  // the smallest loss that is 缓着 where both moves stand above +500: 0.4 * loss > 50 * k
  const smallest = { 1: 188, 2: 172, 5: 126, 9: 101 };
  for (const level of [1, 2, 5, 9]) {
    const a = assessMove({ fen, move: king, pair, table, level, compare: top.move });
    assert.equal(a.move.notation, '帅五进一');
    assert.deepEqual(notations(a.line), '帅五进一 车8进5 帅五退一 车8退5');
    assert.deepEqual([a.cat, a.loss, a.isBest, a.refutation], ['ok', smallest[level], false, null], `level ${level}`);
    assert.deepEqual([a.moveCp, a.bestCp], [1900, 1900], 'red stands as before');
    assert.deepEqual([a.outcome.kind, a.flags.missedWin, a.flags.allowsMate], ['none', false, false]);
    assert.equal(quickVerdict(table, king, level), null, 'the face waits for the assessment');
    // the other moves of the table are judged as before
    assert.equal(quickVerdict(table, top.move, level).cat, 'best');
  }

  // The rule on its own, with hand-made scores, in a level position (the pawn-and-rook position of the dangers test): the
  // king steps up, the black rook checks from the back rank, the king returns and so does the rook.
  const quiet = '4k3r/9/9/1p7/9/1R2P4/9/9/9/3K5 w';
  const back = [ref('9383'), ref('0888'), ref('8393'), ref('8808')], away = [ref('9383'), ref('0888'), ref('8393'), ref('8858')];
  const verdict = (bestScore, moveScore, pv, level = 5) => {
    const lines = [rootLine('5131', bestScore), rootLine('9383', moveScore, { pv })].sort((x, y) => y.score - x.score);
    const a = assessMove({ fen: quiet, move: ref('9383'), table: null, level, compare: ref('5131'), pair: tableOf(quiet, lines) });
    const q = quickVerdict(tableOf(quiet, lines), ref('9383'), level);
    return [a.cat, a.loss, a.moveCp, q === null ? null : q.cat];
  };
  assert.deepEqual(verdict(600, -20, back), ['ok', 126, 600, null], 'far ahead: the loss counts 0.4');
  assert.deepEqual(verdict(90, -20, back), ['ok', 51, 90, null], 'a level position: 51 is the smallest loss above 50');
  assert.deepEqual(verdict(90, -20, back, 9), ['ok', 41, 90, null]);
  assert.deepEqual(verdict(10, -20, back), ['good', 30, 10, null], 'a smaller loss is not raised');
  // a line that does not return is judged by its score, as before
  assert.deepEqual(verdict(600, -20, away), ['blunder', 620, -20, 'blunder']);
  assert.deepEqual(verdict(600, -20, back.slice(0, 2)), ['blunder', 620, -20, 'blunder']);
  // the return that is the best there is (a side that is behind and finds the repetition): nothing changes
  assert.deepEqual(verdict(-700, -20, back), ['best', 0, -20, 'best']);
  // a mate score is never softened: the line returns, but the move is mated
  assert.deepEqual(verdict(600, -(MATE - 6), back), ['blunder', 2600, -2000, 'blunder']);
});

test('quickVerdict returns null for a null or depth-1 table and equals assessMove\'s cat (ignoring brilliant) when the move is exact', () => {
  assert.equal(quickVerdict(null, ref('7774'), 5), null);
  assert.equal(quickVerdict(analyze(START, { maxDepth: 1, minDepth: 1 }), ref('7774'), 5), null);
  // a move that is not in the table has no verdict
  assert.equal(quickVerdict(analyze(START, { maxDepth: 2 }), ref('6061'), 5), null);

  // every move of three all-exact tables, at three levels: the same category as the full assessment
  const fens = [START, REFERENCE_POSITIONS.middlegameA, '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w'];
  const seen = new Set();
  for (const fen of fens) {
    const table = analyze(fen, { maxDepth: 3, allDepth: 3 });
    assert.equal(table.allDepth, 3);
    const best = table.lines[0];
    for (const line of table.lines) {
      for (const level of [1, 5, 9]) {
        const quick = quickVerdict(table, line.move, level);
        const pair = { ...table, lines: line === best ? [best] : [best, line] };
        const full = assessMove({ fen, move: line.move, pair, table, level, compare: best.move });
        assert.equal(quick.cat, full.cat === 'brilliant' ? 'best' : full.cat, `${fen} ${code(line.move)} level ${level}`);
        assert.notEqual(quick.cat, 'brilliant');
        assert.equal(quick.loss, full.loss);
        assert.equal(quick.depth, 3);
        assert.equal(quick.isBest, full.isBest);
        seen.add(quick.cat);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['best', 'blunder', 'good', 'mistake', 'ok'], 'the sample covers every category');

  // a line that is not exact at the table's depth: the worse of the last all-exact iteration and the proven upper bound
  const bounded = upper => tableOf(START, [
    rootLine('7774', 100, { depth: 6, byDepth: [60, 70, 80, 90, 95, 100] }),
    rootLine('6252', 40, { depth: 4, upper, byDepth: [50, 45, 42, 40] }),
  ], { depth: 6, allDepth: 4 });
  // iteration 4: 90 - 40 = 50; bound: 100 - (-30) = 130
  assert.deepEqual(quickVerdict(bounded(-30), ref('6252'), 5), { cat: 'mistake', loss: 130, depth: 4, isBest: false });
  // bound 100 - 60 = 40 is the smaller one: the loss of iteration 4 stands
  assert.deepEqual(quickVerdict(bounded(60), ref('6252'), 5), { cat: 'good', loss: 50, depth: 4, isBest: false });
  assert.deepEqual(quickVerdict(bounded(60), ref('7774'), 5), { cat: 'best', loss: 0, depth: 6, isBest: true });
});

test('assessMove compares against the given compare move, also when it is not the table\'s first line', () => {
  // Black rook a7 attacks the red rook a5 and is attacked by it. The table's first line is the capture 车九进二.
  const fen = '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w';
  const table = analyze(fen, { allDepth: 4 });
  assert.equal(code(table.lines[0].move), '5030');
  const move = ref('5444'), compare = ref('5051');                      // tried: 兵五进一 (loses the rook); pinned: 车九平八 (saves it)
  assert.notEqual(code(table.lines[0].move), code(compare));
  const pair = analyze(fen, { allDepth: 4, rootMoves: [compare, move] });
  const a = assessMove({ fen, move, pair, table, level: 5, compare });
  // measured against the pinned move, not against the table's best
  assert.equal(a.best.notation, '车九平八');
  assert.equal(a.bestCp, scoreToCp(lineOf(pair, compare).score));
  assert.equal(a.moveCp, scoreToCp(lineOf(pair, move).score));
  assert.equal(a.loss, a.bestCp - a.moveCp);
  assert.equal(a.depth, pair.depth);
  assert.equal(a.isBest, false);
  assert.equal(a.bestLine.moves[0].notation, '车九平八');
  assert.equal(a.line.moves[0].notation, '兵五进一');
  assert.equal(a.revealBest >= 1, true);
  // the alternatives come from the table, best first, without the tried move, with losses against the table's first line
  assert.deepEqual(a.alternatives.map(x => x.move.notation), table.lines.filter(l => code(l.move) !== '5444').slice(0, 3).map(l => moveToNotation(fenToBoard(fen).board, l.move)));
  assert.equal(a.alternatives[0].move.notation, '车九进二');
  assert.equal(a.alternatives[0].loss, 0);
  assert.ok(a.alternatives.every((x, i, all) => i === 0 || x.loss >= all[i - 1].loss));
  assert.ok(a.bestCp < scoreToCp(table.lines[0].score), 'the pinned move is not the table\'s best, and bestCp follows the pinned move');

  // the tried move itself is the comparison when it is at least as good: here it is the capture
  const better = analyze(fen, { allDepth: 4, rootMoves: [compare, ref('5030')] });
  const b = assessMove({ fen, move: ref('5030'), pair: better, table, level: 5, compare });
  assert.deepEqual([b.best.notation, b.isBest, b.loss, b.refutation], ['车九进二', true, 0, null]);
  // best: it takes a rook that hangs. A capture that wins at once is never brilliant for being the only good move,
  // however deep its full value shows (CONTRACT-NOTES item 106; the test after this one)
  assert.equal(b.cat, 'best');
  assert.equal(b.bestLine, b.line);
  assert.equal(b.bestOutcome, b.outcome);
  // one root move when they are equal; and with no table there are no alternatives and no only-move flag
  const same = analyze(fen, { allDepth: 4, rootMoves: [compare] });
  const c = assessMove({ fen, move: compare, pair: same, table: null, level: 5, compare });
  assert.deepEqual([c.isBest, c.loss, c.alternatives, c.flags.onlyMove], [true, 0, [], false]);
  // onlyMove: the second-best root move is 150 cp or more below the best
  assert.equal(a.flags.onlyMove, scoreToCp(table.lines[0].score) - scoreToCp(table.lines[1].score) >= 150);
  assert.equal(a.flags.onlyMove, true);
  // a pair that lacks the move is an error
  assert.throws(() => assessMove({ fen, move: ref('9484'), pair, table, level: 5, compare }), RangeError);
});

test('brilliant is not for a plain winning capture: the only-move clause skips a capture that wins at once; sacrifice and forced mate still count', () => {
  // CONTRACT-NOTES item 106 on section 4.6.1. First with hand-made scores, so that only the kind of move differs: the
  // tried move stands alone at the top of the table (the second line is 400 cp below) and its value shows at the third
  // ply (revealBest 3). Returned: the verdict, the exchange class of the capture, and what the three clauses look at.
  const verdict = (fen, moveCode, { score = 300, byDepth = [0, 0, score, score], second = score - 400, pv = [moveCode], table = true } = {}) => {
    const move = ref(moveCode);
    const { board, turn } = fenToBoard(fen);
    const rest = getLegalMoves(board, turn).find(m => code(m) !== moveCode);
    const line = rootLine(moveCode, score, { depth: byDepth.length, byDepth, pv: pv.map(ref) });
    const all = tableOf(fen, [line, rootLine(code(rest), second, { depth: byDepth.length })]);
    const a = assessMove({ fen, move, pair: tableOf(fen, [line]), table: table ? all : null, level: 5, compare: move });
    const capture = moveFacts(fen, move).capture;
    return [a.cat, capture === null ? null : capture.exchange, a.flags.onlyMove, a.revealBest, a.flags.sacrifice, a.flags.givesMate];
  };
  const hangingRook = '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w';       // the rooks face each other; nothing guards the black one
  const guardedRook = 'r3k4/9/9/r8/9/R3P4/9/9/9/4K4 w';      // ... a second black rook guards it: an even trade
  const guardedPawn = '4k4/9/r8/p8/9/R3P4/9/9/9/4K4 w';      // a pawn guarded by a rook: taking it loses the rook

  // the rule: the only good move, deep, but it simply takes a piece with profit -> best
  assert.deepEqual(verdict(hangingRook, '5030'), ['best', 'wins', true, 3, false, null]);
  // the other side: the same table and scores for a move that takes nothing -> brilliant, as before
  assert.deepEqual(verdict(hangingRook, '5051'), ['brilliant', null, true, 3, false, null]);
  // ... and for a capture that does not win at once (an even trade, a capture that loses on the square)
  assert.deepEqual(verdict(guardedRook, '5030'), ['brilliant', 'even', true, 3, false, null]);
  assert.deepEqual(verdict(guardedPawn, '5030'), ['brilliant', 'loses', true, 3, false, null]);
  // where "wins at once" begins: 'wins' is every exchange value from +50 on the square (A6.2 as facts.js reads it). A pawn
  // taken for nothing (+1) and a horse that takes a guarded cannon (+0.5) are winning captures, however small: best.
  // A cannon that takes a guarded horse (-0.5) is not one
  const freePawn = '4k4/9/9/p8/9/R3P4/9/9/9/4K4 w';
  const horseForCannon = '3k5/9/9/4c3r/9/3N5/9/9/9/5K3 w';
  const cannonForHorse = '3k5/9/9/4n3r/9/4P4/9/4C4/9/5K3 w';
  assert.deepEqual([[freePawn, '5030'], [horseForCannon, '5334'], [cannonForHorse, '7434']].map(([fen, c]) => moveFacts(fen, ref(c)).capture.see), [100, 50, -50]);
  assert.deepEqual(verdict(freePawn, '5030'), ['best', 'wins', true, 3, false, null]);
  assert.deepEqual(verdict(horseForCannon, '5334'), ['best', 'wins', true, 3, false, null]);
  assert.deepEqual(verdict(cannonForHorse, '7434'), ['brilliant', 'loses', true, 3, false, null]);
  // the same for black
  const hangingRookBlack = '4k4/9/9/9/r3p4/9/R8/9/9/4K4 b';
  assert.deepEqual(verdict(hangingRookBlack, '4060'), ['best', 'wins', true, 3, false, null]);
  assert.deepEqual(verdict(hangingRookBlack, '4041'), ['brilliant', null, true, 3, false, null]);
  // it is the tried move that counts, not the comparison move: the winning capture, 10 cp behind a quiet comparison move
  // that stands alone at the top of the table and shows its value at the third ply, is best
  const behind = [rootLine('5051', 300, { depth: 4, byDepth: [0, 0, 300, 300] }), rootLine('5030', 290, { depth: 4, byDepth: [0, 0, 290, 290] })];
  const tried = assessMove({
    fen: hangingRook, move: ref('5030'), pair: tableOf(hangingRook, behind), level: 5, compare: ref('5051'),
    table: tableOf(hangingRook, [behind[0], rootLine('5030', 100, { depth: 4 })]),
  });
  assert.deepEqual([tried.cat, tried.isBest, tried.loss, tried.flags.onlyMove, tried.revealBest], ['best', false, 10, true, 3]);
  // the only-move clause itself is unchanged: it needs both the 150 cp gap and a reveal depth of three
  assert.deepEqual(verdict(hangingRook, '5051', { second: 150 }), ['brilliant', null, true, 3, false, null]);
  assert.deepEqual(verdict(hangingRook, '5051', { second: 151 }), ['best', null, false, 3, false, null]);
  assert.deepEqual(verdict(hangingRook, '5051', { byDepth: [0, 300, 300, 300] }), ['best', null, true, 2, false, null]);
  assert.deepEqual(verdict(hangingRook, '5051', { table: false }), ['best', null, false, 3, false, null]);
  // and none of it makes the winning capture brilliant
  assert.deepEqual(verdict(hangingRook, '5030', { second: -1900, byDepth: [-500, -500, -500, 300] }), ['best', 'wins', true, 4, false, null]);

  // the forced-mate clause is unchanged: a winning capture that starts a mate in two is brilliant, with or without the table
  assert.deepEqual(verdict(hangingRook, '5030', { score: MATE - 3, second: 0 }), ['brilliant', 'wins', true, 3, false, 2]);
  assert.deepEqual(verdict(hangingRook, '5030', { score: MATE - 3, table: false }), ['brilliant', 'wins', false, 3, false, 2]);
  // the sacrifice clause is unchanged: the rook takes a cannon that a rook guards and is taken; the horse behind it takes
  // back. The exchange on the square wins (+4.5), yet after the reply red is 4.5 points down, which is the rule of
  // sacrifice_play; the same capture with a line in which the rook is not taken is a plain winning capture
  const backedRook = '3k5/9/9/4c3r/9/3N5/4R4/9/9/5K3 w';
  assert.deepEqual(verdict(backedRook, '6434', { score: 400, byDepth: [400, 400, 400, 400], pv: ['6434', '3834', '5334'], table: false }),
    ['brilliant', 'wins', false, 1, true, null]);
  assert.deepEqual(verdict(backedRook, '6434', { score: 400, pv: ['6434', '0313'] }), ['best', 'wins', true, 3, false, null]);

  // The same with real searches (a searcher of its own, so that no earlier search of this file has a say).
  const own = createSearcher();
  const searched = (fen, moveCode) => {
    const table = own.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 4, allDepth: 4 });
    const move = ref(moveCode), best = table.lines[0].move;
    const pair = own.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 4, allDepth: 4, rootMoves: code(best) === moveCode ? [move] : [best, move] });
    return { a: assessMove({ fen, move, pair, table, level: 5, compare: best }), capture: moveFacts(fen, move).capture, best: code(best) };
  };
  // 车九进二 takes the rook that hangs. Every other move loses the rook, and the score still climbs with the depth
  // (the reveal depth is 3): by the letter of 4.6.1 that was 妙手. It is 好棋.
  const plain = searched(hangingRook, '5030');
  assert.deepEqual([plain.best, plain.capture.exchange, plain.capture.free, plain.a.flags.onlyMove, plain.a.revealBest >= 3], ['5030', 'wins', true, true, true]);
  assert.deepEqual([plain.a.flags.sacrifice, plain.a.flags.givesMate, plain.a.isBest, plain.a.loss], [false, null, true, 0]);
  assert.equal(plain.a.cat, 'best');
  // 车九进四 takes nothing: it checks on the back rank, the king must step up, a second check drives it off the rank
  // again and only then the rook on the far side falls. The only good move, three plies deep, and not a capture: 妙手.
  const deep = searched('4k4/8r/9/9/R8/9/9/9/9/3K5 w', '4000');
  assert.deepEqual([deep.best, deep.capture, deep.a.flags.onlyMove, deep.a.revealBest >= 3, deep.a.flags.sacrifice, deep.a.flags.givesMate], ['4000', null, true, true, false, null]);
  assert.equal(notations(deep.a.line).startsWith('车九进四 将5进1 车九退一'), true);
  assert.deepEqual([deep.a.outcome.kind, deep.a.outcome.net], ['wins', 9]);
  assert.equal(deep.a.cat, 'brilliant');
  // 车一进四 takes a pawn for nothing and mates on the next move: the capture wins at once, the forced mate makes it 妙手
  const mating = searched('4k4/8p/R8/9/9/8R/9/9/9/5K3 w', '5818');
  assert.deepEqual([mating.capture.exchange, mating.a.flags.givesMate, mating.a.cat], ['wins', 2, 'brilliant']);
});

test('a forced move is never brilliant and never a sacrifice: with at most two legal moves every clause of 4.6.1 gives best', () => {
  // CONTRACT-NOTES item 138. Red is in check on the e-file and both flights of the king are covered: the horse can step in
  // on e3 or on e2, and that is all (two legal moves). With an advisor on f1 that can step in as well, there are three.
  const two = '3k5/9/5r3/3r5/9/4r4/9/2N6/9/4K4 w';
  const three = '3k5/9/5r3/3r5/9/4r4/9/2N6/9/4KA3 w';
  const legal = (fen) => { const { board, turn } = fenToBoard(fen); return getLegalMoves(board, turn).map(code); };
  assert.deepEqual([legal(two), legal(three)], [['7264', '7284'], ['7264', '7284', '9584']]);
  /** The verdict on 马七进五 (the horse steps in on e2) with hand-made scores, and what the three clauses look at. */
  const verdict = (fen, { score = 300, byDepth = [0, 0, score, score], pv = ['7284'], table = true } = {}) => {
    const move = ref('7284');
    const line = rootLine('7284', score, { depth: byDepth.length, byDepth, pv: pv.map(ref) });
    const all = tableOf(fen, [line, rootLine('7264', score - 400, { depth: byDepth.length })]);
    const a = assessMove({ fen, move, pair: tableOf(fen, [line]), table: table ? all : null, level: 5, compare: move });
    return [a.cat, a.flags.onlyMove, a.revealBest, a.flags.sacrifice, a.flags.givesMate, a.patterns.some(p => p.id === 'sacrifice_play')];
  };
  // the only-move clause: alone at the top of the table, its value shows at the third ply
  assert.deepEqual(verdict(three), ['brilliant', true, 3, false, null, false]);
  assert.deepEqual(verdict(two), ['best', true, 3, false, null, false]);
  // the sacrifice clause: the rook takes the horse and the king takes the rook. Of the forced move it is not said that it
  // gave the horse up: no flag, no 弃子 pattern
  const given = { byDepth: [300, 300, 300, 300], pv: ['7284', '5484', '9484'], table: false };
  assert.deepEqual(verdict(three, given), ['brilliant', false, 1, true, null, true]);
  assert.deepEqual(verdict(two, given), ['best', false, 1, false, null, false]);
  // the forced-mate clause: the move starts a mate in two
  assert.deepEqual(verdict(three, { score: MATE - 3, table: false }), ['brilliant', false, 3, false, 2, false]);
  assert.deepEqual(verdict(two, { score: MATE - 3, table: false }), ['best', false, 3, false, 2, false]);
  // one legal move: the same
  const one = '3k5/9/5r3/3r5/9/4r4/9/9/9/4KA3 w';
  assert.deepEqual(legal(one), ['9584']);
  const only = assessMove({ fen: one, move: ref('9584'), pair: tableOf(one, [rootLine('9584', MATE - 3, { depth: 4 })]), table: null, level: 5, compare: ref('9584') });
  assert.deepEqual([only.cat, only.flags.givesMate], ['best', 2]);
  // a real search of the forced position agrees with itself: whatever the horse move is worth, it is never 妙手
  const table = analyze(two, { maxDepth: 4, allDepth: 4 });
  for (const line of table.lines) {
    const pair = analyze(two, { maxDepth: 4, allDepth: 4, rootMoves: [table.lines[0].move, line.move].filter((m, i, list) => i === 0 || code(m) !== code(list[0])) });
    const a = assessMove({ fen: two, move: line.move, pair, table, level: 5, compare: table.lines[0].move });
    assert.notEqual(a.cat, 'brilliant', code(line.move));
    assert.equal(a.flags.sacrifice, false, code(line.move));
  }
});

test('hintFor: each theme row; area for red and for black', () => {
  /** The hint for a move with a real table of the position (and, where given, the real threat). */
  const hint = (fen, moveCode, { ply = 40, withThreat = false } = {}) => {
    const facts = positionFacts(fen, { ply });
    const table = analyze(fen, { maxDepth: 3, allDepth: 3 });
    const threat = withThreat ? threatInfo(fen, analyze(fen, { pass: true, maxDepth: 3 }), facts) : null;
    return hintFor({ fen, ply, table, move: ref(moveCode), facts, threat });
  };
  const themes = {
    // 重炮: the move mates
    mate: hint(TACTICAL_SUITE[0].fen, TACTICAL_SUITE[0].move),
    // red is in check and interposes
    escape_check: hint('4k4/9/9/9/4r4/9/9/R8/9/4K4 w', '7074'),
    // black threatens 重炮; red is not in check
    stop_mate: hint('4k4/9/1c7/9/9/9/4c4/9/9/3AKA3 w', '9484', { withThreat: true }),
    // a free rook
    win_material: hint('2bakab2/9/9/r8/9/R3P4/9/9/9/4K4 w', '5030'),
    // the horse forks two rooks and wins one
    tactic: hint('4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w', '6344'),
    // the attacked rook steps away
    save_piece: hint('2bakab2/9/9/r8/9/R3P4/9/9/9/4K4 w', '5051'),
    // the rook offers an exchange of rooks, guarded by the horse
    trade: hint('4k4/9/r8/9/5N3/9/6R2/9/9/3K5 w', '6626'),
    // a check that wins nothing
    attack: hint('4k4/9/9/9/R8/4P4/9/9/9/4K4 w', '4000'),
    // the horse leaves its starting square in the opening
    develop: hint(START, '9172', { ply: 0 }),
    // the rook blocks the elephant's eye
    defend: hint('2b1k4/9/9/9/9/9/3R5/9/9/3K5 w', '6313'),
    // nothing of the above
    improve: hint(START, '9384', { ply: 30 }),
  };
  assert.deepEqual(Object.keys(themes).sort(), [...HINT_THEMES].sort(), 'one case per theme');
  for (const theme of HINT_THEMES) assert.equal(themes[theme].theme, theme, theme);
  // the order of the rows: the same developing move after ply 24 is no longer "develop", and a capture in check is "escape_check"
  assert.equal(hint(START, '9172', { ply: 25 }).theme, 'improve');
  assert.equal(hint('2bakab2/9/9/9/R3r4/9/9/9/9/4K4 w', '4044').theme, 'escape_check');
  assert.equal(hint('3k5/9/9/9/4r4/9/9/R8/9/4K4 w', '7074').theme, 'escape_check');

  // the parts of a hint
  const fork = themes.tactic;
  assert.deepEqual([fork.piece.name, fork.piece.at, fork.move.notation], ['马', { row: 6, col: 3 }, '马六进五']);
  assert.equal(fork.line.moves[0].notation, '马六进五');
  assert.ok(fork.outcome.net >= 1 && fork.outcome.settled);
  assert.deepEqual(fork.facts, moveFacts('4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w', ref('6344'), { ply: 40 }));
  // alternatives: up to two other table moves within 30 cp of the hinted one
  const table = analyze(START, { maxDepth: 3, allDepth: 3 });
  const opening = hintFor({ fen: START, ply: 0, table, move: table.lines[0].move, facts: positionFacts(START, { ply: 0 }), threat: null });
  const near = table.lines.slice(1).filter(l => Math.abs(scoreToCp(l.score) - scoreToCp(table.lines[0].score)) <= 30).slice(0, 2);
  assert.deepEqual(opening.alternatives.map(code), near.map(l => code(l.move)));
  assert.ok(opening.alternatives.every(m => typeof m.notation === 'string' && m.notation.length >= 4));
  assert.deepEqual(themes.mate.alternatives, [], 'nothing comes within 30 cp of a mate');
  assert.throws(() => hintFor({ fen: START, ply: 0, table, move: ref('6061'), facts: positionFacts(START), threat: null }), RangeError);

  // area, as the child sees the board: red lands on c3 (left, home), a10 (left, enemy), e5 (center, river)
  assert.deepEqual(themes.develop.area, { side: 'left', zone: 'home' });
  assert.deepEqual(themes.attack.area, { side: 'left', zone: 'enemy' });
  assert.deepEqual(themes.tactic.area, { side: 'center', zone: 'river' });
  assert.deepEqual(hint(START, '9776', { ply: 0 }).area, { side: 'right', zone: 'home' });
  // black sees the board from the other side: column a is on its right, rows 0..2 are home, rows 7..9 the enemy's
  const blackStart = START.replace(' w', ' b');
  assert.deepEqual(hint(blackStart, '3040', { ply: 1 }).area, { side: 'right', zone: 'river' });
  assert.deepEqual(hint(blackStart, '0122', { ply: 1 }).area, { side: 'right', zone: 'home' });
  assert.deepEqual(hint(blackStart, '0726', { ply: 1 }).area, { side: 'left', zone: 'home' });
  assert.deepEqual(hint('4k4/9/9/9/9/9/9/9/r8/5K3 b', '8090').area, { side: 'right', zone: 'enemy' });
});

test('tacticalTest and habitTraps on constructed tables', () => {
  const facts = positionFacts(START);
  // five root moves: two within 60 cp of the best, the rest 150 or more below
  const lines = (scores, depth = 5) => ['7774', '9776', '9172', '6252', '6050'].slice(0, scores.length).map((c, i) => rootLine(c, scores[i], { depth }));
  const found = tacticalTest(START, tableOf(START, lines([300, 250, 150, 100, 90])), facts);
  assert.deepEqual([found.tier, found.kind, found.group.map(m => m.notation)], [1, 'win', ['炮二平五', '马二进三']]);
  assert.deepEqual(found.group.map(code), ['7774', '9776']);
  // the best line outside the group must be 150 cp below the best: 149 is no test
  assert.equal(tacticalTest(START, tableOf(START, lines([300, 250, 151, 100, 90])), facts), null);
  // the group is "within 60 cp": 240 is in, 239 is out, and being out so close to the best it spoils the test
  assert.equal(tacticalTest(START, tableOf(START, lines([300, 240, 100, 90, 80])), facts).group.length, 2);
  assert.equal(tacticalTest(START, tableOf(START, lines([300, 239, 100, 90, 80])), facts), null);
  // more than three winning moves is no test; neither is a table without a move outside the group
  assert.equal(tacticalTest(START, tableOf(START, lines([300, 290, 280, 270, 100])), facts), null);
  assert.notEqual(tacticalTest(START, tableOf(START, lines([300, 290, 280, 100, 90])), facts), null);
  assert.equal(tacticalTest(START, tableOf(START, lines([300, 290, 280])), facts), null);
  // needs depth 4
  assert.equal(tacticalTest(START, tableOf(START, lines([300, 240, 100, 90, 80], 3)), facts), null);
  assert.notEqual(tacticalTest(START, tableOf(START, lines([300, 240, 100, 90, 80], 4)), facts), null);
  // a line that is not exact at the table's depth is outside the group and counts with min(score, upper)
  const stale = lines([300, 280, 100, 90, 80]);
  stale[1] = rootLine('9776', 280, { depth: 3, upper: 200 });
  assert.equal(tacticalTest(START, tableOf(START, stale, { depth: 5, allDepth: 3 }), facts), null, 'the bound 200 is within 150 cp');
  stale[1] = rootLine('9776', 280, { depth: 3, upper: 150 });
  assert.equal(tacticalTest(START, tableOf(START, stale, { depth: 5, allDepth: 3 }), facts).group.length, 1);
  // the tier is how deep one must look until the group stands out by 100 cp: depth 1-2 tier 1, 3-4 tier 2, deeper 3
  const tierOf = separatedAt => {
    const byDepth = score => Array.from({ length: 5 }, (_, i) => (i + 1 >= separatedAt ? score : 0));
    const table = tableOf(START, [rootLine('7774', 300, { depth: 5, byDepth: byDepth(300) }), rootLine('9776', 100, { depth: 5, byDepth: byDepth(100) }),
      rootLine('9172', 90, { depth: 5, byDepth: byDepth(90) })]);
    return tacticalTest(START, table, facts).tier;
  };
  assert.deepEqual([1, 2, 3, 4, 5].map(tierOf), [1, 1, 2, 2, 3]);

  // kind 'save': the child is in check ...
  const checkFen = '4k4/9/9/9/4r4/9/9/R8/9/4K4 w';
  const inCheck = tableOf(checkFen, [rootLine('7074', 100, { depth: 4 }), rootLine('9493', -200, { depth: 4 }), rootLine('9495', -210, { depth: 4 })]);
  assert.equal(tacticalTest(checkFen, inCheck, positionFacts(checkFen)).kind, 'save');
  // ... or has a piece hanging for 300 or more that the rival is about to take ...
  const hangFen = '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w';
  const hang = tableOf(hangFen, [rootLine('5030', 900, { depth: 4 }), rootLine('5051', 0, { depth: 4 }), rootLine('5444', -900, { depth: 4 })]);
  assert.equal(tacticalTest(hangFen, hang, positionFacts(hangFen)).kind, 'save');
  // ... or the rival has a forced mate
  const mateFen = '3aka3/9/9/4C4/p8/9/9/1C7/9/4K4 b';
  const mated = tableOf(mateFen, [rootLine('0414', -400, { depth: 4 }), rootLine('4050', -(MATE - 2), { depth: 4 })]);
  assert.equal(tacticalTest(mateFen, mated, positionFacts(mateFen)).kind, 'save');
  // a hanging pawn is no reason to call it 'save'
  const pawnFen = '3k5/9/9/9/r8/9/P8/9/9/4K4 w';
  const pawn = tableOf(pawnFen, [rootLine('9484', 100, { depth: 4 }), rootLine('9495', -100, { depth: 4 })]);
  assert.equal(tacticalTest(pawnFen, pawn, positionFacts(pawnFen)).kind, 'win');

  // habitTraps: 'greedy' when a root move is a losing capture (炮八进七 takes the guarded horse) that costs 150 cp or more
  const greedy = loss => tableOf(START, [rootLine('7774', 30, { depth: 4 }), rootLine('7101', 30 - loss, { depth: 4 })]);
  assert.deepEqual(habitTraps(START, greedy(150), facts, null), ['greedy']);
  assert.deepEqual(habitTraps(START, greedy(149), facts, null), []);
  // a capture that wins is no trap however badly it scores; a quiet move neither
  const winning = tableOf(hangFen, [rootLine('5051', 500, { depth: 4 }), rootLine('5030', 0, { depth: 4 }), rootLine('5444', -900, { depth: 4 })]);
  assert.deepEqual(habitTraps(hangFen, winning, positionFacts(hangFen), null), []);
  // 'miss_threat' when the rival threatens mate or material
  const threat = kind => ({ kind });
  assert.deepEqual(habitTraps(START, greedy(0), facts, threat('mate')), ['miss_threat']);
  assert.deepEqual(habitTraps(START, greedy(0), facts, threat('wins-material')), ['miss_threat']);
  assert.deepEqual(habitTraps(START, greedy(0), facts, threat('check')), []);
  assert.deepEqual(habitTraps(START, greedy(0), facts, threat('plan')), []);
  assert.deepEqual(habitTraps(START, greedy(200), facts, threat('mate')), ['greedy', 'miss_threat']);

  // threatInfo, which feeds both: what the rival does if the child passes
  const rookFen = '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w';
  const material = threatInfo(rookFen, analyze(rookFen, { pass: true }), positionFacts(rookFen));
  assert.deepEqual([material.kind, material.mate, material.line.moves[0].notation, material.facts.move.notation, material.facts.move.color],
    ['wins-material', null, '车1进2', '车1进2', 'black']);
  // the outcome is the rival's: it wins the rook (and whatever the line picks up after it)
  assert.deepEqual([material.outcome.won[0], material.outcome.lost, material.outcome.net >= 9], [{ piece: 'rook', points: 9 }, [], true]);
  assert.equal(material.line.start, rookFen.replace(' w', ' b'), 'the line starts with the rival to move');
  const quiet = threatInfo(START, analyze(START, { pass: true, maxDepth: 3 }), facts);
  assert.equal(quiet.kind, 'plan');
  assert.equal(quiet.facts.move.color, 'black');
  // a pass line that starts with a check and wins nothing (a hand-built line: the rook checks on the file, the king steps aside)
  const checking = '3k5/9/9/9/r8/9/9/9/9/4K4 w';
  const checkLine = tableOf(checking, [rootLine('4044', 10, { depth: 2, pv: [ref('4044'), ref('9495')] })], { turn: 'black' });
  const check = threatInfo(checking, checkLine, positionFacts(checking));
  assert.deepEqual([check.kind, check.mate, notations(check.line), check.outcome.kind, check.facts.check !== null], ['check', null, '车1平5 帅五平四', 'none', true]);
  // a mate that only the checks-only scan knows still makes the threat a mate, with the mating line
  const mateThreatFen = '4k4/9/1c7/9/9/9/4c4/9/9/3AKA3 w';
  const shallow = { ...analyze(mateThreatFen, { pass: true, maxDepth: 3 }) };
  shallow.lines = shallow.lines.filter(l => code(l.move) !== '2124').map(l => ({ ...l, score: Math.min(l.score, 50), mate: null }));
  const known = threatInfo(mateThreatFen, shallow, positionFacts(mateThreatFen));
  assert.deepEqual([known.kind, known.mate, notations(known.line), known.outcome.mate], ['mate', 1, '炮2平5', 'gives']);
  // in check there is no pass, hence no threat
  assert.equal(threatInfo(checkFen, analyze(checkFen, { pass: true }), positionFacts(checkFen)), null);
});

test('the tactical test, the greedy trap and a hint\'s alternatives are measured on the search scores, also beyond +-1900 (CONTRACT-NOTES 147)', () => {
  const facts = positionFacts(START);
  const lines = (scores, depth = 5) => ['7774', '9776', '9172', '6252', '6050'].slice(0, scores.length).map((c, i) => rootLine(c, scores[i], { depth }));
  const test = scores => tacticalTest(START, tableOf(START, lines(scores)), facts);
  // far behind: every score reads -1900. Two moves stand 150 or more above the rest: a test (it was none: "five moves within 60 cp")
  assert.deepEqual(test([-2000, -2050, -2200, -2300, -2400]).group.map(code), ['7774', '9776']);
  assert.equal(test([-2000, -2050, -2149, -2300, -2400]), null, 'the best line outside the group is 149 below the best');
  assert.equal(test([-2000, -2061, -2300, -2400, -2500]), null, '61 below the best is outside the group and spoils the test');
  // far ahead: the same
  assert.deepEqual(test([2900, 2850, 2700, 2600, 2500]).group.map(code), ['7774', '9776']);
  assert.equal(test([2900, 2850, 2751, 2600, 2500]), null);
  // across the clamp: 1880 read as "20 below +1900" and joined the group of a move that is worth 2400
  assert.deepEqual(test([2400, 1880, 1700, 1600, 1500]).group.map(code), ['7774']);
  assert.deepEqual(test([-1700, -1750, -2400, -2500, -2600]).group.map(code), ['7774', '9776']);
  // a mate score in the table is compared as centipawns, as before
  assert.equal(test([MATE - 3, 2500, 2400, 2300, 2200]), null, '+2000 against +1900: not within 60, and not 150 apart');
  assert.equal(test([-2500, -(MATE - 2), -(MATE - 2)]), null, '-1900 against -2000');
  assert.deepEqual(test([-400, -(MATE - 2), -(MATE - 2)]).group.map(code), ['7774']);
  // the tier: how deep one must look until the group stands out by 100 cp, on the same scores (it was always the deepest tier)
  const tierOf = (separatedAt, high, low) => {
    const byDepth = score => Array.from({ length: 5 }, (_, i) => (i + 1 >= separatedAt ? score : low));
    return tacticalTest(START, tableOf(START, [rootLine('7774', high, { depth: 5, byDepth: byDepth(high) }), rootLine('9776', low, { depth: 5, byDepth: byDepth(low) }),
      rootLine('9172', low - 10, { depth: 5, byDepth: byDepth(low - 10) })]), facts).tier;
  };
  assert.deepEqual([1, 2, 3, 4, 5].map(d => tierOf(d, -2000, -2600)), [1, 1, 2, 2, 3]);
  assert.deepEqual([1, 2, 3, 4, 5].map(d => tierOf(d, 3200, 2600)), [1, 1, 2, 2, 3]);
  assert.deepEqual([1, 2, 3, 4, 5].map(d => tierOf(d, 300, 100)), [1, 1, 2, 2, 3], 'inside the scale nothing changes');

  // habitTraps: a losing capture (炮八进七 takes the guarded horse) that costs 150 cp or more, also where both scores read -1900
  const greedy = (top, loss) => tableOf(START, [rootLine('7774', top, { depth: 4 }), rootLine('7101', top - loss, { depth: 4 })]);
  assert.deepEqual(habitTraps(START, greedy(-2000, 150), facts, null), ['greedy']);
  assert.deepEqual(habitTraps(START, greedy(-2000, 149), facts, null), []);
  assert.deepEqual(habitTraps(START, greedy(3000, 150), facts, null), ['greedy']);
  assert.deepEqual(habitTraps(START, greedy(3000, 149), facts, null), []);

  // hintFor: the alternatives are the other moves within 30 cp of the hinted one (every move was "within 30" at -1900)
  const hint = scores => hintFor({ fen: START, ply: 0, table: tableOf(START, lines(scores)), move: ref('7774'), facts: positionFacts(START, { ply: 0 }), threat: null });
  assert.deepEqual(hint([-2500, -2520, -2531, -2900, -2900]).alternatives.map(code), ['9776']);
  assert.deepEqual(hint([-2500, -2530, -2530, -2530, -2900]).alternatives.map(code), ['9776', '9172'], 'up to two');
  assert.deepEqual(hint([2500, 2469, 2400, 2300, 2200]).alternatives.map(code), []);
  assert.deepEqual(hint([40, 20, 10, 9, -30]).alternatives.map(code), ['9776', '9172'], 'inside the scale nothing changes');
});

test('openingName: each row of the table returns its PatternCode', () => {
  const name = (...codes) => openingName(START, codes.map(ref));
  assert.deepEqual(name(), { red: null, black: null });
  // 当头炮, then black's answers
  assert.deepEqual(name('7774'), { red: 'central_cannon', black: null });
  assert.deepEqual(name('7774', '2724'), { red: 'central_cannon', black: 'same_cannons' });             // 炮二平五 炮8平5: both from the h-file
  assert.deepEqual(name('7174', '2124'), { red: 'central_cannon', black: 'same_cannons' });             // both from the b-file
  assert.deepEqual(name('7774', '2124'), { red: 'central_cannon', black: 'opposite_cannons' });         // 炮二平五 炮2平5
  assert.deepEqual(name('7174', '2724'), { red: 'central_cannon', black: 'opposite_cannons' });
  assert.deepEqual(name('7774', '0726', '9776', '0122'), { red: 'central_cannon', black: 'screen_horses' });
  // black's centre cannon alone is 当头炮 (顺炮 and 列炮 need red's as well)
  assert.deepEqual(name('9776', '2724'), { red: 'horse_open', black: 'central_cannon' });
  // 屏风马 for red, which beats the first-move rows
  assert.deepEqual(name('9776', '3646', '9172', '3242'), { red: 'screen_horses', black: 'pawn_lead' });
  // the first-move rows
  assert.deepEqual(name('9674'), { red: 'elephant_open', black: null });
  assert.deepEqual(name('9274'), { red: 'elephant_open', black: null });
  assert.deepEqual(name('6252'), { red: 'pawn_lead', black: null });
  assert.deepEqual(name('6656'), { red: 'pawn_lead', black: null });
  assert.deepEqual(name('9172'), { red: 'horse_open', black: null });
  assert.deepEqual(name('9776', '0726'), { red: 'horse_open', black: 'horse_open' });
  assert.deepEqual(name('7773'), { red: 'palace_cannon', black: null });                               // 炮二平六 crosses the centre file
  assert.deepEqual(name('7175'), { red: 'palace_cannon', black: null });
  assert.deepEqual(name('7775'), { red: 'corner_cannon', black: null });                               // 炮二平四 stays on its side
  assert.deepEqual(name('7173'), { red: 'corner_cannon', black: null });
  assert.deepEqual(name('7774', '2723'), { red: 'central_cannon', black: 'palace_cannon' });
  assert.deepEqual(name('7774', '2725'), { red: 'central_cannon', black: 'corner_cannon' });
  assert.deepEqual(name('9776', '0224'), { red: 'horse_open', black: 'elephant_open' });               // 象3进5
  // moves that have no name: edge pawn, edge horse, a cannon to another file
  assert.deepEqual(name('6050'), { red: null, black: null });
  assert.deepEqual(name('9170', '3040'), { red: null, black: null });
  assert.deepEqual(name('7776'), { red: null, black: null });
  // only the first eight plies are looked at: a centre cannon played on ply nine is not an opening name
  const quiet = ['6050', '3040', '6858', '3848', '9384', '0314', '8493', '1403'];
  assert.deepEqual(openingName(START, [...quiet, '7774'].map(ref)), { red: null, black: null });
  assert.deepEqual(openingName(START, [...quiet.slice(0, 6), '7774'].map(ref)), { red: 'central_cannon', black: null });
  // every name is a pattern code
  for (const code of ['central_cannon', 'same_cannons', 'opposite_cannons', 'screen_horses', 'elephant_open', 'pawn_lead', 'horse_open', 'palace_cannon', 'corner_cannon']) {
    assert.ok(PATTERN_CODES.includes(code));
  }
  // black to move first: the sides' first moves are still told apart
  assert.deepEqual(openingName(START.replace(' w', ' b'), ['2724', '7774'].map(ref)), { red: 'central_cannon', black: 'same_cannons' });
});

test('the 22 v1 coach fixtures: structured facts match the old tests\' intent (attack on a defended piece of equal value is not a threat)', () => {
  assert.equal(V1_COACH_FIXTURES.length, 22);
  const fixture = name => V1_COACH_FIXTURES.find(f => f.name === name);
  const factsOf = (name, opts) => moveFacts(fixture(name).fen, ref(fixture(name).move), opts);
  /** The move followed by the continuation the old test supplied, as a line. */
  const fixtureLine = (name, which = 'line') => {
    const f = fixture(name);
    const { board, turn } = fenToBoard(f.fen);
    const codes = which === 'alt' ? f.alt : [f.move, ...f.line];
    const line = toLine(board, turn, codes.map(ref));
    assert.equal(line.moves.length, codes.length, `${name}: the supplied line is legal`);
    return line;
  };
  // every legal fixture: the facts describe the fixture's move, and the position is left as it was
  for (const f of V1_COACH_FIXTURES) {
    if (!f.legal) continue;
    const before = positionFacts(f.fen);
    const snapshot = JSON.stringify(before);
    const facts = moveFacts(f.fen, ref(f.move), { before });
    assert.equal(facts.move.notation, f.notation, f.name);
    assert.equal(facts.fenBefore, f.fen, f.name);
    assert.equal(JSON.stringify(before), snapshot, `${f.name}: the facts given in are not changed`);
    assert.deepEqual(JSON.parse(JSON.stringify(facts)), facts, `${f.name}: plain JSON`);
  }

  // open-horse-left / -right: a developing move without capture, check, threat or weakness. 车九平八 (车一平二) is legal
  // after it and was not before; the rook gains that one square, which is below the two-move threshold of an "open line".
  for (const [name, rookMove] of [['open-horse-left', '9091'], ['open-horse-right', '9897']]) {
    const facts = factsOf(name, { ply: 0 });
    assert.deepEqual([facts.tags, facts.capture, facts.check, facts.threats, facts.exposed, facts.opens], [['闲'], null, null, [], [], []], name);
    const { board } = fenToBoard(fixture(name).fen);
    assert.equal(getLegalMoves(board, 'red').some(m => code(m) === rookMove), false, name);
    assert.equal(getLegalMoves(applyMove(board, ref(fixture(name).move)), 'red').some(m => code(m) === rookMove), true, name);
  }

  // cannon-shift-with-line: the move itself mounts the cannon behind the pawn (threat 炮七进四); the exchange of the
  // supplied line (a cannon won, a horse given) belongs to the line, not to the move
  let facts = factsOf('cannon-shift-with-line');
  assert.equal(facts.capture, null);
  assert.deepEqual(facts.threats.map(t => [t.by.name, t.viaScreen.name, t.target.name, t.capture.notation, t.gain]), [['七路炮', '七路兵', '3路卒', '炮七进四', 100]]);
  assert.deepEqual(facts.exposed, []);
  let outcome = materialOutcome(fixtureLine('cannon-shift-with-line'), 'red');
  assert.deepEqual([outcome.won, outcome.lost, outcome.kind], [[{ piece: 'cannon', points: 4.5 }], [{ piece: 'horse', points: 4 }], 'even-trade']);

  // cannon-takes-guarded-horse: a losing trade, never a free capture; before the move the horse is not hanging
  // (an attack on a defended piece that is worth no more than the attacker is not a threat)
  facts = factsOf('cannon-takes-guarded-horse');
  assert.deepEqual([facts.capture.exchange, facts.capture.free, facts.capture.see, facts.capture.recapture.notation], ['loses', false, -50, '车1平2']);
  assert.deepEqual(positionFacts(fixture('cannon-takes-guarded-horse').fen).hanging, []);
  assert.equal(on(positionFacts(fixture('cannon-takes-guarded-horse').fen).pieces, '01').status, 'guarded');
  outcome = materialOutcome(fixtureLine('cannon-takes-guarded-horse'), 'red');
  assert.deepEqual([outcome.won, outcome.lost, outcome.net], [[{ piece: 'horse', points: 4 }], [{ piece: 'cannon', points: 4.5 }], -0.5]);

  // edge-pawn-capture: judged on the whole three-ply line (pawn, rook takes pawn, rook takes rook), not as pawn for pawn
  facts = factsOf('edge-pawn-capture');
  assert.deepEqual([facts.capture.exchange, facts.capture.free, facts.capture.recapture.notation], ['wins', false, '车1进4']);
  outcome = materialOutcome(fixtureLine('edge-pawn-capture'), 'red');
  assert.deepEqual([outcome.net, outcome.kind, outcome.won.map(w => w.piece), outcome.lost.map(l => l.piece)], [8, 'good-trade', ['pawn', 'rook'], ['pawn']]);

  // rook-steps-into-capture: the moved piece hangs; nothing was captured first
  facts = factsOf('rook-steps-into-capture');
  assert.equal(facts.capture, null);
  assert.deepEqual(facts.exposed.map(e => [e.piece.name, e.cause, e.capture.notation, e.gain]), [['车', 'moved-into-attack', '车1进2', 900]]);
  assert.ok(facts.tags.includes('献') && !facts.tags.includes('吃'));
  outcome = materialOutcome(fixtureLine('rook-steps-into-capture'), 'red');
  assert.deepEqual([outcome.kind, outcome.won, outcome.lost], ['loses', [], [{ piece: 'rook', points: 9 }]]);

  // block-check: red was in check and interposes
  facts = factsOf('block-check');
  assert.equal(facts.escapesCheck, true);
  assert.deepEqual(facts.blocks.map(b => [b.kind, b.piece.name, b.piece.color]), [['line', '车', 'black']]);
  assert.equal(facts.check, null);

  // rook-check: check, not mate, and no promise of a win
  facts = factsOf('rook-check');
  assert.deepEqual([facts.check.mate, facts.check.replies > 0, facts.tags, facts.mateThreat], [false, true, ['将'], null]);

  // rook-mate: not in check before, checkmate after; a mate carries no flaw
  facts = factsOf('rook-mate');
  assert.deepEqual([facts.escapesCheck, facts.check.mate, facts.check.replies, facts.exposed, facts.allowsMate], [false, true, 0, [], null]);
  assert.deepEqual(facts.tags, ['将', '杀']);
  const { board: mateBoard } = fenToBoard(facts.fenAfter);
  assert.equal(getGameStatus(mateBoard, 'black').reason, 'checkmate');

  // rook-retreats-from-attack: the rook was hanging and is safe after the move; the alternative leaves it to be taken
  const retreat = fixture('rook-retreats-from-attack');
  assert.deepEqual(positionFacts(retreat.fen).hanging.filter(h => h.piece.color === 'red').map(h => [h.piece.name, h.capture.notation, h.gain]), [['车', '车1进2', 900]]);
  facts = factsOf('rook-retreats-from-attack');
  assert.deepEqual(facts.parried.map(p => [p.piece.name, p.how]), [['车', 'moved']]);
  assert.deepEqual(facts.exposed, []);
  assert.equal(materialOutcome(fixtureLine('rook-retreats-from-attack'), 'red').net, 0);
  assert.equal(materialOutcome(fixtureLine('rook-retreats-from-attack', 'alt'), 'red').net, -9, 'a whole rook worse');
  // ... and the search-backed assessment of that alternative says the same: it leaves the rook hanging
  const left = assess(retreat.fen, retreat.alt[0]).assessment;
  assert.deepEqual([left.cat, left.refutation.danger, left.refutation.reply.notation, left.outcome.net], ['blunder', 'leaves_hanging', '车1进2', -9]);

  // rook-shields-horse: the rook interposes for the horse; the blocker itself can be taken
  facts = factsOf('rook-shields-horse');
  assert.deepEqual(facts.parried.map(p => [p.piece.name, p.how]), [['马', 'blocked']]);
  assert.deepEqual(facts.exposed.map(e => [e.piece.name, e.cause, e.gain]), [['车', 'moved-into-attack', 900]]);

  // horse-attacks-rook: a new attack (threat 马六进五), not a capture already won
  facts = factsOf('horse-attacks-rook');
  assert.equal(facts.capture, null);
  assert.deepEqual(facts.threats.map(t => [t.by.name, t.target.name, t.capture.notation, t.gain]), [['马', '车', '马六进五', 900]]);
  assert.deepEqual(facts.tags, ['捉']);

  // red-pawn-crosses / black-pawn-crosses: the pawn crosses the river; black's piece is a 卒 moving toward row 9
  assert.equal(factsOf('red-pawn-crosses').pawnCrossed, true);
  facts = factsOf('black-pawn-crosses');
  assert.deepEqual([facts.pawnCrossed, facts.move.color, facts.move.notation, facts.move.to], [true, 'black', '卒1进1', { row: 5, col: 0 }]);

  // quiet-advisor: no identified benefit and nothing invented
  facts = factsOf('quiet-advisor');
  assert.deepEqual([facts.tags, facts.threats, facts.parried, facts.exposed, facts.blocks, facts.opens, facts.patterns], [['闲'], [], [], [], [], [], []]);

  // cannon-clears-rook-rank: the rook gains its rank
  facts = factsOf('cannon-clears-rook-rank');
  assert.deepEqual(facts.opens.map(o => [o.piece.name, o.kind, o.gained]), [['车', 'line', 8]]);

  // cannon-mounts-on-pawn: the cannon lines up on the rook with the pawn as its screen (threat 炮九进五)
  facts = factsOf('cannon-mounts-on-pawn');
  assert.deepEqual(facts.threats.map(t => [t.by.name, t.viaScreen.name, t.target.name, t.capture.notation]), [['炮', '九路兵', '车', '炮九进五']]);

  // cannon-unpins-rook: before the move the rook is pinned against its king and may not leave the file; after it the
  // rook may move sideways, at the price of the unguarded cannon behind it. The new moves are not an opened route.
  const unpin = fixture('cannon-unpins-rook');
  const pinOf = position => positionFacts(position).pins.map(p => [p.pinned.name, p.by.name, p.shield.name, p.absolute]);
  facts = factsOf('cannon-unpins-rook');
  assert.deepEqual(pinOf(unpin.fen), [['车', '车', '帅', true]]);
  assert.deepEqual(pinOf(facts.fenAfter), [['车', '车', '炮', false]]);
  assert.deepEqual(facts.opens, []);
  const sideways = position => getPieceLegalMoves(fenToBoard(position).board, 5, 4).filter(m => m.to.row === 5).length;
  assert.deepEqual([sideways(unpin.fen), sideways(facts.fenAfter)], [0, 8]);

  // cannon-drops-attack: before the move the cannon attacks the rook over the pawn; the move gives that up, which is a
  // flaw of the move (the assessment calls it a missed win) and not an achievement
  const drop = fixture('cannon-drops-attack');
  assert.deepEqual(positionFacts(drop.fen).hanging.map(h => [h.piece.name, h.capture.notation, h.gain, h.now]), [['车', '炮八进五', 900, true]]);
  facts = factsOf('cannon-drops-attack');
  assert.deepEqual([facts.tags, facts.threats], [['闲'], []]);
  const dropped = assess(drop.fen, drop.move).assessment;
  assert.deepEqual([dropped.cat, dropped.refutation.danger, dropped.best.notation, dropped.flags.missedWin], ['blunder', 'misses_win', '炮八进五', true]);

  // edge-pawn-push: a quiet move; the alternative is materially equal
  facts = factsOf('edge-pawn-push');
  assert.deepEqual(facts.tags, ['闲']);
  assert.deepEqual(materialOutcome(fixtureLine('edge-pawn-push'), 'red'), materialOutcome(fixtureLine('edge-pawn-push', 'alt'), 'red'));
  assert.equal(materialOutcome(fixtureLine('edge-pawn-push'), 'red').kind, 'none');
  // a line that contains an illegal move stops there: the illegal move and what follows are not counted
  const { board, turn } = fenToBoard(START);
  const broken = { start: START, moves: [describeMove(board, ref('6050')), { ...describeMove(board, ref('7101')), from: { row: 7, col: 1 }, to: { row: 0, col: 0 } }], end: 'quiet' };
  assert.deepEqual([materialOutcome(broken, turn).plies, materialOutcome(broken, turn).kind], [1, 'none']);

  // illegal-sideways-pawn: rejected, never described
  assert.throws(() => factsOf('illegal-sideways-pawn'), RangeError);

  // black-edge-pawn-push: the mover is black
  facts = factsOf('black-edge-pawn-push');
  assert.deepEqual([facts.move.color, facts.move.notation, facts.fenAfter.endsWith(' w')], ['black', '卒1进1', true]);

  // the rule in the title, on its own: equal value and defended is no threat; unguarded, or worth more, is
  assert.deepEqual(positionFacts('4k4/9/9/r7r/9/R3P4/9/9/9/4K4 w').hanging.filter(h => h.piece.color === 'black'), [], 'rook attacks a guarded rook');
  assert.deepEqual(moveFacts('3k5/9/9/n3p4/9/9/9/9/R8/5K3 b', ref('3444')).threats, []);
  assert.deepEqual(moveFacts('3k5/9/9/n3p4/9/9/9/9/8R/5K3 w', ref('8880')).threats.map(t => [t.target.name, t.gain]), [['马', 400]], 'an unguarded horse is a threat');
  assert.deepEqual(moveFacts('3k5/9/p8/n8/9/9/9/9/8R/5K3 w', ref('8880')).threats, [], 'a rook lining up on a pawn-guarded horse threatens nothing');
});

test('hanging pieces, exchange values and mates agree with an independent recount on 300 playout positions', () => {
  let hanging = 0, mates = 0, inCheck = 0, inCheckHanging = 0, corrected = 0;
  for (const p of playoutPositions(300, { seed: 20261110, stride: 5, plies: 150, pawnBias: 0.2 })) {
    if (p.moves.length === 0) continue;
    const fen = boardToFen(p.board, p.turn);
    const facts = positionFacts(fen, { ply: p.ply });
    const checked = isInCheck(p.board, p.turn);
    if (checked) inCheck++;
    assert.equal(facts.check !== null, checked, fen);
    if (checked) assert.deepEqual(facts.check.checkers.map(c => key(c.at)).sort((a, b) => a - b), checkers(p.board, p.turn).map(key).sort((a, b) => a - b), fen);
    const listed = new Map(facts.hanging.map(h => [key(h.piece.at), h]));
    assert.equal(listed.size, facts.hanging.length, fen);
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 9; col++) {
        const piece = p.board[row][col];
        if (!piece || piece.type === 'king') continue;
        const at = { row, col };
        const taker = other(piece.color);
        // what the other side can win on this square: at once, or (for the side in check) once the check is answered
        const delayed = checked && piece.color === p.turn;
        const winnable = delayed ? enPriseInCheck(p.board, p.turn, at) : bestExchange(p.board, taker, at);
        const h = listed.get(key(at));
        const label = `${fen} ${row}${col}`;
        if (h === undefined) {
          assert.ok(winnable < 100, `${label}: a piece that can be won for ${winnable} is not listed`);
          continue;
        }
        if (delayed) inCheckHanging++;
        hanging++;
        assert.equal(h.gain, winnable, `${label}: gain`);
        assert.ok(h.gain >= 100, label);
        assert.deepEqual([h.points, h.free, h.now], [h.gain / 100, h.gain === valueOf(piece, row), taker === p.turn], label);
        if (!delayed) {
          // the reported capture is legal and wins exactly what is reported, whatever the order of the recaptures
          const capture = capturesOn(p.board, taker, at).find(m => code(m) === code(h.capture));
          assert.ok(capture, `${label}: the capture is legal`);
          assert.equal(h.capture.notation, moveToNotation(p.board, capture), label);
          assert.equal(exchangeValue(p.board, capture), h.gain, `${label}: the piece really can be won`);
          // where the least-valuable-attacker rule of Position.see would have said something else, count it
          if (valueOf(piece, row) - exchangeLeast(applyMove(p.board, capture), piece.color, at) !== h.gain) corrected++;
        }
      }
    }
    for (const color of ['red', 'black']) {
      const mate = facts.mates[color];
      if (mate === null) continue;
      mates++;
      assert.ok(!(checked && color !== p.turn), fen);
      assert.equal(mate.line.start, boardToFen(p.board, color), fen);
      assert.equal(mate.line.moves.length, 2 * mate.in - 1, fen);
      assertMatingLine(mate.line, color, fen);
      if (mate.in > 1) {
        assert.equal(matesWithin(p.board, color, mate.in - 1), false, `${fen}: not the shortest mate`);
        const next = applyMove(p.board, mate.line.moves[0]);
        assert.ok(getLegalMoves(next, other(color)).every(reply => matesWithin(applyMove(next, reply), color, mate.in - 1)), `${fen}: the mate is forced`);
      }
    }
  }
  assert.ok(hanging > 500 && mates > 10 && inCheck > 3 && inCheckHanging > 3,
    `the sample is not empty: ${hanging} hanging, ${mates} mates, ${inCheck} checks, ${inCheckHanging} hanging pieces of a side in check`);
  assert.ok(corrected <= hanging / 100, `the exact exchange value differs from the least-valuable-attacker value only rarely: ${corrected} of ${hanging}`);
});

test('moveFacts describes every legal move of 40 playout positions truthfully and as plain JSON', () => {
  let moves = 0, threats = 0, exposed = 0, parried = 0;
  for (const p of playoutPositions(40, { seed: 99, stride: 9, plies: 150, pawnBias: 0.15 })) {
    if (p.moves.length === 0) continue;
    const fen = boardToFen(p.board, p.turn);
    const before = positionFacts(fen, { ply: p.ply });
    const foe = other(p.turn);
    for (const m of p.moves) {
      moves++;
      const label = `${fen} ${code(m)}`;
      const facts = moveFacts(fen, m, { ply: p.ply, before });
      const json = JSON.stringify(facts);
      assert.deepEqual(JSON.parse(json), facts, label);
      assert.ok(!json.includes('null,null,null'), label);
      const after = applyMove(p.board, m);
      assert.deepEqual([facts.fenBefore, facts.fenAfter, facts.move.notation], [fen, boardToFen(after, foe), moveToNotation(p.board, m)], label);
      // capture: value, class, recapture
      assert.equal(facts.capture !== null, m.captured !== null, label);
      if (facts.capture !== null) {
        assert.equal(facts.capture.see, exchangeValue(p.board, m), `${label}: see`);
        assert.equal(facts.capture.exchange, facts.capture.see >= 50 ? 'wins' : facts.capture.see <= -50 ? 'loses' : 'even', label);
        const recaptures = capturesOn(after, foe, m.to);
        assert.equal(facts.capture.free, recaptures.length === 0, label);
        if (recaptures.length > 0) {
          const taken = recaptures.find(r => code(r) === code(facts.capture.recapture));
          assert.ok(taken && valueOf(taken.piece, taken.from.row) === Math.min(...recaptures.map(r => valueOf(r.piece, r.from.row))), label);
        }
      }
      // check
      const replies = getLegalMoves(after, foe);
      const check = isInCheck(after, foe);
      assert.equal(facts.check !== null, check, label);
      if (facts.check !== null) assert.deepEqual([facts.check.replies, facts.check.mate, facts.check.double], [replies.length, replies.length === 0, checkers(after, foe).length >= 2], label);
      assert.equal(facts.escapesCheck, isInCheck(p.board, p.turn), label);
      // threats: the capture is there next turn and wins what is reported; after a check, once the check is answered
      for (const t of facts.threats) {
        threats++;
        assert.ok(replies.length > 0 && t.gain >= 100, label);
        if (check) {
          assert.equal(enPriseInCheck(after, foe, t.target.at), t.gain, `${label}: the threat behind the check`);
        } else {
          const capture = capturesOn(after, p.turn, t.target.at).find(c => code(c) === code(t.capture));
          assert.ok(capture && exchangeValue(after, capture) === t.gain, `${label}: threat ${t.capture.notation}`);
        }
        const prev = before.hanging.find(h => key(h.piece.at) === key(t.target.at) && h.piece.color === foe);
        assert.ok(prev === undefined || t.gain - prev.gain >= 200, `${label}: the threat is new`);
      }
      // exposed and parried
      for (const e of facts.exposed) {
        exposed++;
        const capture = capturesOn(after, foe, e.piece.at).find(c => code(c) === code(e.capture));
        assert.ok(capture && exchangeValue(after, capture) === e.gain && e.gain >= 100, `${label}: exposed ${e.capture.notation}`);
      }
      for (const parry of facts.parried) {
        parried++;
        assert.ok(bestExchange(after, foe, parry.piece.at) < 100, `${label}: a parried piece cannot be won`);
      }
      // tags follow the fields
      assert.deepEqual([facts.tags.includes('将'), facts.tags.includes('吃'), facts.tags.includes('捉')], [check, m.captured !== null, facts.threats.length > 0], label);
      assert.ok(facts.tags.length >= 1 && (!facts.tags.includes('闲') || facts.tags.length === 1), label);
    }
  }
  assert.ok(moves > 1000 && threats > 100 && exposed > 100 && parried > 50, `the sample is not empty: ${moves} ${threats} ${exposed} ${parried}`);
});
