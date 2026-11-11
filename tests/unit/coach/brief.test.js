// tests/unit/coach/brief.test.js (C3) — the packet builders: contract sections 4.14, 9 and 14.2.
//
// Inputs are real: positions are analysed with core/search.js and described with core/facts.js, the way the brain's jobs of
// section 4.8.2 do it (brain.js is not used: it belongs to another package). Where a test needs a fact the engine does not
// produce on demand (a sound sacrifice, a deep reveal, a given teaching choice), a real result is copied and that one field is
// set by hand; such places say so. Expected values are those of the contract (the tables of 4.14, the examples of section 9,
// CONTRACT-NOTES 28, 69 d, 88, 105, 107, 108) or are read off the board by hand in the comments next to them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildTurnBrief, oppCaption, buildTryPacket, buildHintPacket, buildOverPacket, buildToolVerdict, buildRecap, isEarned, worthSpeaking, chanceAreaWord,
} from '../../../src/coach/brief.js';
import { createMoveBook } from '../../../src/coach/book.js';
import { createGameMemory } from '../../../src/coach/memory.js';
import { LIMITS, validateCoachRequest } from '../../../src/coach/protocol.js';
import { composeLocal } from '../../../src/coach/fallback.js';
import { AREA } from '../../../src/coach/lexicon.js';
import { MOTIF_CODES, MOTIF_TERM, NOTATION_RE, PATTERN_NAME, TACTIC_MOTIFS } from '../../../src/core/codes.js';
import { START_FEN, applyMove, boardToFen, fenToBoard, getLegalMoves, opposite, plyRecord } from '../../../src/core/engine.js';
import { describeMove, fromMoveCode, pieceRef, toLine } from '../../../src/core/notation.js';
import { assessMove, hintFor, materialOutcome, moveFacts, positionFacts, threatInfo } from '../../../src/core/facts.js';
import { createSearcher } from '../../../src/core/search.js';
import { COACH_EXAMPLE_POSITIONS, V1_COACH_FIXTURES } from '../../helpers/positions.js';

// ---------------------------------------------------------------------------------------------------------------------
// The brain's jobs, rebuilt from search.js and facts.js (contract section 4.8.2), depth-limited so that they are repeatable
// ---------------------------------------------------------------------------------------------------------------------

const searcher = createSearcher();
const NO_CLOCK = 600000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);
const sameMove = (a, b) => a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
const fixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/coach/${name}`, import.meta.url), 'utf8'));

/** The survey of a position: facts, the table of every move, the threat of the pass search. */
function survey(fen, ply, depth = 4) {
  const { board, turn } = fenToBoard(fen);
  const facts = positionFacts(fen, { ply });
  const table = searcher.analyzeSync({ fen, allDepth: Math.min(depth, 4), multiPV: 6, maxDepth: depth, timeMs: NO_CLOCK });
  let threat = null;
  if (facts.check === null && table.lines.length > 0) {
    threat = threatInfo(fen, searcher.analyzeSync({ fen, pass: true, multiPV: 1, maxDepth: Math.min(depth, 4), timeMs: NO_CLOCK }), facts);
  }
  return { fen, ply, board, turn, facts, table, threat };
}

/** The assess job: the tried move against the comparison move (default: the table's best move). */
function assess(sv, move, opts = {}) {
  const { fen, ply, board, turn, table } = sv;
  const compare = opts.compare ?? table.lines[0].move;
  const D = table.depth;
  const pair = searcher.analyzeSync({ fen, rootMoves: sameMove(compare, move) ? [move] : [compare, move], allDepth: D, maxDepth: D,
    minDepth: Math.min(D, 4), timeMs: NO_CLOCK });
  const assessment = assessMove({ fen, move, pair, table, level: opts.level ?? 3, compare });
  const after = applyMove(board, move);
  const rival = opposite(turn);
  const fenAfter = boardToFen(after, rival);
  const replies = [];
  if (getLegalMoves(after, rival).length > 0) {
    const rt = searcher.analyzeSync({ fen: fenAfter, multiPV: 3, maxDepth: Math.max(1, D - 1), timeMs: NO_CLOCK });
    for (const l of rt.lines.slice(0, 3)) {
      const line = toLine(after, rival, l.pv);
      replies.push({ move: describeMove(after, l.move), line, outcome: materialOutcome(line, turn), facts: moveFacts(fenAfter, l.move) });
    }
  }
  return { assessment, facts: moveFacts(fen, move, { ply }), replies };
}

/** The rival's move as an OpponentTurn. The teaching choice is given: its kind and loss are what the tests are about. */
function rivalTurn(fenBefore, move, ply, choice = {}) {
  const { board, turn } = fenToBoard(fenBefore);
  const loss = choice?.loss ?? 0;
  return {
    move: describeMove(board, move),
    facts: moveFacts(fenBefore, move, { ply }),
    line: toLine(board, turn, [move]),
    choice: choice === null ? null
      : { move, line: null, mode: 'spar', kind: 'honest', loss, evalAfter: 0, evalBest: 0, chance: null, overlooked: null, ...choice },
    quality: { loss, cat: 'best' },
    childMoveCp: 0,
    evalAfter: 0,
    tension: 0.1,
  };
}

/** A TurnReport for a surveyed position. */
function reportOf(sv, more = {}) {
  return { ply: sv.ply, me: sv.turn, board: sv.board, facts: sv.facts, legalCount: sv.table.lines.length, threat: sv.threat, evalCp: 0, mate: null,
    lastOpp: null, prev: null, level: 3, announceChance: false, back: null, ...more };
}

const tryCtx = (turn, report, more = {}) => ({ turn, report, prev: null, self: false, habit: null, avoided: null, repeat: false, ...more });
const bookOf = (sv) => createMoveBook({ board: sv.board, turn: sv.turn });
const mv = (code) => fromMoveCode(code);

/** Every notation a packet carries. */
function notationsOf(value, out = []) {
  if (typeof value === 'string') {
    if (NOTATION_RE.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) notationsOf(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) notationsOf(v, out);
  }
  return out;
}

function assertValid(turn, events, label) {
  const result = validateCoachRequest({ v: 1, turn, events });
  assert.ok(result.ok, `${label}: ${J(result)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------------------------------------------------

const START = fenToBoard(START_FEN).board;
/** After 1. 炮二平五, black to move (the position the rival moves in for sections 9.3 and 9.5). */
const AFTER_CENTRAL_CANNON = boardToFen(applyMove(START, mv('7774')), 'black');
const SAME_CANNONS = COACH_EXAMPLE_POSITIONS.sameCannons;      // 1. 炮二平五 炮8平5
const HORSE_REPLY = COACH_EXAMPLE_POSITIONS.horseReply;        // 1. 炮二平五 马8进7; trial 炮五进四, refutation 马7进5, pinned best 马二进三

/** The worked example of sections 9.4 to 9.6, analysed once (depth 6: the assess depth of the plan's middle row). */
const worked = (() => {
  const sv = survey(HORSE_REPLY.fen, 2, 6);
  const best = mv(HORSE_REPLY.best);
  const memory = createGameMemory(null);
  memory.noteMine(0, { move: '炮二平五', cat: 'best', waited: true, self: true, packet: null, more: null });
  const lastOpp = rivalTurn(AFTER_CENTRAL_CANNON, mv('0726'), 1, { kind: 'variety', loss: 20 });
  // the child's first move, as the director hands it on (it was confirmed before any verdict was built: no packet)
  const prev = { move: describeMove(START, mv('7774')), cat: 'best', waited: true, self: true, packet: null, more: null, assessed: null };
  const report = reportOf(sv, { lastOpp, prev });
  const book = bookOf(sv);
  const turn = buildTurnBrief(report, memory, book);
  const held = assess(sv, mv(HORSE_REPLY.trial), { compare: best });
  const fine = assess(sv, best, { compare: best });
  const hint = hintFor({ fen: sv.fen, ply: 2, table: sv.table, move: best, facts: sv.facts, threat: sv.threat });
  return { sv, best, memory, report, book, turn, held, fine, hint };
})();

/** After 1. 车一进一 (the rook leaves the horse on 二 without a guard): the child is black. 炮8进7 takes the horse for nothing. */
const ROOK_LIFT = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/8R/RNBAKABN1 b';

// ---------------------------------------------------------------------------------------------------------------------
// 4.14.3 Facts -> codes
// ---------------------------------------------------------------------------------------------------------------------

test('effects are ordered: mate, mate threat, sacrifice, capture, fork, discovered, pin, check, …', () => {
  // The facts of a quiet move, with one fact per row of the table added by hand. The leading effect is read, its fact is
  // removed, and so on: the order in which the codes appear is the order of the table. The move is 帅五进一 in a position
  // where the black rook attacks the red rook on 五 and the horse on 六 guards it (the row `defended` is said of a piece
  // that a guard keeps safe: the black rook can still take it).
  const sv = survey(START_FEN, 0, 2);
  const base = survey('4k4/4a4/9/1n7/9/r3R4/9/3N5/1N7/4K4 w', 30, 2);
  const move = mv('9484');
  const real = assess(base, move);
  assert.deepEqual(real.facts.tags, ['闲']);
  const ref = (color, type, row, col) => ({ type, color, at: { row, col }, label: '', name: `${col}路` });
  const info = describeMove(sv.board, mv('7774'));
  const threat = (row, col, discovered, screen) => ({ target: ref('black', 'horse', row, col), by: ref('red', 'cannon', 7, 1), capture: info, gain: 400,
    discovered, viaScreen: screen ? ref('red', 'pawn', 6, 2) : null });
  const facts = {
    ...clone(real.facts),
    tags: ['保'],
    capture: { piece: ref('black', 'pawn', 3, 0), see: 100, exchange: 'wins', free: true, recapture: null },
    check: { checkers: [ref('red', 'rook', 9, 0)], discovered: false, double: false, replies: 3, mate: false },
    threats: [threat(0, 1, true, false), threat(0, 7, false, true), threat(2, 2, false, false)],
    parried: [{ piece: ref('red', 'horse', 9, 1), how: 'moved' }, { piece: ref('red', 'cannon', 7, 7), how: 'blocked' },
      { piece: ref('red', 'rook', 5, 4), how: 'defended' }],
    fork: { by: ref('red', 'rook', 9, 0), targets: [ref('black', 'rook', 0, 0), ref('black', 'cannon', 2, 7)], withCheck: false },
    pins: { created: [{ pinned: ref('black', 'elephant', 0, 2), by: ref('red', 'cannon', 7, 1), shield: ref('black', 'king', 0, 4), absolute: true, kind: 'cannon' }],
      released: [], suffered: [] },
    blocks: [{ kind: 'horse-leg', piece: ref('black', 'horse', 0, 1) }, { kind: 'elephant-eye', piece: ref('black', 'elephant', 0, 6) }],
    opens: [{ piece: ref('red', 'rook', 9, 0), kind: 'line', gained: 3 }],
    kingSqueeze: { before: 2, after: 1 },
    pawnCrossed: true,
  };
  const assessment = { ...clone(real.assessment), cat: 'best', loss: 0, isBest: true, refutation: null,
    flags: { ...real.assessment.flags, givesMate: 2, sacrifice: true } };
  /** What to take away so that the row of a code no longer applies. */
  const remove = {
    mate_threat: () => { assessment.flags.givesMate = null; },
    sacrifice: () => { assessment.flags.sacrifice = false; },
    capture_free: () => { facts.capture = null; },
    fork: () => { facts.fork = null; },
    discovered: () => { facts.threats = facts.threats.filter((t) => !t.discovered); },
    pin: () => { facts.pins.created = []; },
    check: () => { facts.check = null; },
    cannon_mount: () => { facts.threats = facts.threats.filter((t) => t.viaScreen === null); },
    attack: () => { facts.threats = []; },
    escape: () => { facts.parried = facts.parried.filter((p) => p.how !== 'moved'); },
    block: () => { facts.parried = facts.parried.filter((p) => p.how !== 'blocked'); },
    defend: () => { facts.parried = []; facts.tags = []; },
    block_leg: () => { facts.blocks = facts.blocks.filter((b) => b.kind !== 'horse-leg'); },
    block_eye: () => { facts.blocks = []; },
    restrict_king: () => { facts.kingSqueeze = { before: 1, after: 1 }; },
    open_rook: () => { facts.opens = []; },
    cross_river: () => { facts.pawnCrossed = false; },
  };
  const baseReport = reportOf(base);
  const baseTurn = buildTurnBrief(baseReport, createGameMemory(null), bookOf(base));
  const report = reportOf(sv);
  const turn = buildTurnBrief(report, createGameMemory(null), bookOf(sv));
  const order = [];
  for (let guard = 0; guard < 30; guard++) {
    const { packet } = buildTryPacket({ assessment, facts, replies: [] }, tryCtx(baseTurn, baseReport), bookOf(base));
    assert.ok(packet.does.length >= 1 && packet.does.length <= LIMITS.EFFECTS);
    const lead = packet.does[0].k;
    order.push(lead);
    if (lead === 'quiet') break;
    remove[lead]();
  }
  assert.deepEqual(order, ['mate_threat', 'sacrifice', 'capture_free', 'fork', 'discovered', 'pin', 'check', 'cannon_mount', 'attack',
    'escape', 'block', 'defend', 'block_leg', 'block_eye', 'restrict_king', 'open_rook', 'cross_river', 'quiet']);

  // Row 1 on real facts: 重炮. The mating cannon gives the effect, the pattern its name, and a mate has no mate threat.
  const suite = survey('3aka3/9/9/4C4/9/9/9/1C7/9/4K4 w', 40, 3);
  const mate = assess(suite, mv('7174'));
  const mated = buildTryPacket(mate, tryCtx(buildTurnBrief(reportOf(suite), createGameMemory(null), bookOf(suite)), reportOf(suite)), bookOf(suite)).packet;
  assert.deepEqual(mated.does[0], { k: 'mate', by: { s: 'me', t: 'C', f: 5, q: 'back' }, name: 'double_cannon' });
  assert.ok(!mated.does.some((e) => e.k === 'mate_threat'));

  // Row 5 before row 8 on real facts: 卧槽马 gives check and attacks the rook in the corner (将军捉子).
  const trough = survey('r1bakab2/9/9/3N5/9/9/9/9/9/5K3 w', 40, 3);
  const fork = buildTryPacket(assess(trough, mv('3312')), tryCtx(buildTurnBrief(reportOf(trough), createGameMemory(null), bookOf(trough)), reportOf(trough)),
    bookOf(trough)).packet;
  const codes = fork.does.map((e) => e.k);
  assert.ok(codes.includes('fork') && codes.includes('check') && codes.indexOf('fork') < codes.indexOf('check'), J(fork.does));
  assert.equal(fork.does.find((e) => e.k === 'fork').name, 'check_fork');
  assert.equal(fork.does.find((e) => e.k === 'check').name, 'trough_horse');

  // Row 16 and row 17: a developing move in the opening, and the two moves of the v1 fixtures that have no effect at all.
  assert.deepEqual(worked.turn.me, 'red');
  const develop = buildTryPacket(worked.fine, tryCtx(worked.turn, worked.report), bookOf(worked.sv)).packet;
  assert.deepEqual(develop.does, [{ k: 'develop', by: { s: 'me', t: 'H', f: 3 } }]);
  for (const name of ['quiet-advisor', 'edge-pawn-push']) {
    const fx = V1_COACH_FIXTURES.find((f) => f.name === name);
    const quiet = buildTryPacket(assess(sv, mv(fx.move)), tryCtx(turn, report), bookOf(sv)).packet;
    assert.deepEqual(quiet.does, [{ k: 'quiet' }], name);
  }
  for (const e of [...mated.does, ...fork.does]) assert.ok(MOTIF_CODES.includes(e.k));
});

test('row 10 for the king: a move that answers a check by stepping away or standing in between says so', () => {
  // The v1 fixture "block-check": red is in check from the rook on the king's file and 车九平五 interposes.
  const fx = V1_COACH_FIXTURES.find((f) => f.name === 'block-check');
  const sv = survey(fx.fen, 30, 3);
  const report = reportOf(sv);
  const turn = buildTurnBrief(report, createGameMemory(null), bookOf(sv));
  assert.equal(turn.check, true);
  const blocked = buildTryPacket(assess(sv, mv(fx.move)), tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(blocked.does.find((e) => e.k === 'block'), { k: 'block', by: { s: 'me', t: 'R', f: 5 }, on: { s: 'me', t: 'K', f: 5 } });
  // The king steps off the file: 帅五平六.
  const stepped = buildTryPacket(assess(sv, mv('9493')), tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(stepped.does.find((e) => e.k === 'escape'), { k: 'escape', by: { s: 'me', t: 'K', f: 6 } });
});

test('defend {on} names the attacked piece that gained the moved piece as a guard, from a parry or from the tag 保', () => {
  // Parry (row 10): 马8进7 guards the central pawn that 炮五进四 could take for nothing.
  assert.deepEqual(worked.turn.opp.does[0], { k: 'defend', on: { s: 'opp', t: 'P', f: 5 } });

  // Tag 保 without a parry (row 11, CONTRACT-NOTES 108). The red rook on 五 is attacked by the black rook and guarded once, so it
  // is not hanging. 马八进七 (b1 to c3 in the red camp: row 8, col 1 -> row 6, col 2) adds a second guard: the horse on (6,2)
  // reaches (5,4) over the empty leg (6,3). From (6,2) it also attacks the black rook on (5,0), which only a horse guards.
  const sv = survey('4k4/4a4/9/1n7/9/r3R4/9/3N5/1N7/4K4 w', 30, 3);
  const assessed = assess(sv, mv('8162'));
  assert.ok(assessed.facts.tags.includes('保'));
  assert.deepEqual(assessed.facts.parried, []);
  const report = reportOf(sv);
  const packet = buildTryPacket(assessed, tryCtx(buildTurnBrief(report, createGameMemory(null), bookOf(sv)), report), bookOf(sv)).packet;
  const codes = packet.does.map((e) => e.k);
  assert.deepEqual(packet.does.find((e) => e.k === 'defend'), { k: 'defend', on: { s: 'me', t: 'R', f: 5 } });
  assert.deepEqual(packet.does.find((e) => e.k === 'attack'), { k: 'attack', by: { s: 'me', t: 'H', f: 7 }, on: { s: 'opp', t: 'R', f: 1 } });
  assert.ok(codes.indexOf('attack') < codes.indexOf('defend'));
  // never a defend without `on`
  for (const e of packet.does) if (e.k === 'defend') assert.ok(e.on);
});

test('补上保护 is not said of a piece that is safe because the attack on it is gone', () => {
  // The black cannon takes the red pawn on 七 over the pawn on 五. 兵五进一 takes the screen away: the pawn on 七 is safe, and
  // the facts list it as parried (`defended` covers every way a piece becomes safe), but nothing guards it.
  const sv = survey('4k4/9/9/9/9/9/2P1P2c1/9/9/3K5 w', 30, 3);
  assert.ok(sv.facts.hanging.some((h) => h.piece.color === 'red' && h.piece.at.col === 2));
  const assessed = assess(sv, mv('6454'));
  assert.deepEqual(assessed.facts.parried.map((p) => [p.piece.at.col, p.how]), [[2, 'defended']]);
  const report = reportOf(sv);
  const turn = buildTurnBrief(report, createGameMemory(null), bookOf(sv));
  const packet = buildTryPacket(assessed, tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(packet.does, [{ k: 'quiet' }]);
  // the pouch of the same move says no more than the facts hold either
  const hint = hintFor({ fen: sv.fen, ply: 30, table: sv.table, move: mv('6454'), facts: sv.facts, threat: sv.threat });
  assert.ok(!buildHintPacket(3, hint, { turn, report }, bookOf(sv)).does.some((e) => e.k === 'defend'));

  // A real guard is said. The red rook on 五 can be taken for nothing by the black rook; 马八进七 guards it: the black rook
  // can still take it, but would be taken back. The same parry `defended`, and this time 补上保护 is what happened.
  const loose = survey('4k4/4a4/9/1n7/9/r3R4/9/9/1N7/4K4 w', 30, 3);
  assert.ok(loose.facts.hanging.some((h) => h.piece.type === 'rook' && h.piece.color === 'red'));
  const guard = assess(loose, mv('8162'));
  assert.deepEqual(guard.facts.parried.map((p) => [p.piece.type, p.how]), [['rook', 'defended']]);
  const looseReport = reportOf(loose);
  const guarded = buildTryPacket(guard, tryCtx(buildTurnBrief(looseReport, createGameMemory(null), bookOf(loose)), looseReport), bookOf(loose)).packet;
  assert.deepEqual(guarded.does.find((e) => e.k === 'defend'), { k: 'defend', on: { s: 'me', t: 'R', f: 5 } });
});

test('a pin on a pawn that cannot leave its file is not put into words', () => {
  // 炮二平一 from the start position: the cannon stands behind its own pawn on the edge file, with the black pawn and the black
  // rook in front. The facts call the pawn pinned (lifted, the rook would hang), but that pawn can only walk down the file.
  const sv = survey(START_FEN, 0, 2);
  const assessed = assess(sv, mv('7778'));
  const pin = assessed.facts.pins.created[0];
  assert.ok(pin && pin.pinned.type === 'pawn' && pin.pinned.at.col === 8 && pin.by.at.col === 8, J(assessed.facts.pins));
  const report = reportOf(sv);
  const packet = buildTryPacket(assessed, tryCtx(buildTurnBrief(report, createGameMemory(null), bookOf(sv)), report), bookOf(sv)).packet;
  assert.deepEqual(packet.does, [{ k: 'develop', by: { s: 'me', t: 'C', f: 1 } }]);
});

test('a move that exposes a rook leads its flaws with the rook', () => {
  // The red rook on 五 is attacked by the black rook and guarded by the horse on 六. The horse walks away (马六退八):
  // 车1平5 takes the rook for nothing.
  const guarded = survey('4k4/4a4/9/1n7/9/r3R4/9/3N5/9/4K4 w', 30, 3);
  const report = reportOf(guarded);
  const turn = buildTurnBrief(report, createGameMemory(null), bookOf(guarded));
  const assessed = assess(guarded, mv('7381'));
  assert.equal(assessed.assessment.refutation.danger, 'unguards');
  const { packet, more } = buildTryPacket(assessed, tryCtx(turn, report), bookOf(guarded));
  assert.equal(packet.cat, 'blunder');
  assert.deepEqual(packet.flaws[0], { k: 'unguard', by: { s: 'me', t: 'H', f: 8 }, on: { s: 'me', t: 'R', f: 5 } });
  assert.deepEqual(packet.cost.lose, ['R']);
  assert.equal(more.reply.moves[0], '车1平5');

  // The same loss by uncovering: the horse on the edge file stands between the black rook and the red rook. When it leaves,
  // nothing was guarding the rook before either: the flaw says that the rook can be taken, not that the horse was its guard.
  const covered = survey('4k3r/4a4/9/8N/9/8R/9/9/9/4K4 w', 30, 3);
  const report2 = reportOf(covered);
  const uncovered = assess(covered, mv('3857'));
  assert.equal(uncovered.assessment.refutation.danger, 'unguards');
  const packet2 = buildTryPacket(uncovered, tryCtx(buildTurnBrief(report2, createGameMemory(null), bookOf(covered)), report2), bookOf(covered)).packet;
  assert.deepEqual(packet2.flaws[0], { k: 'hang', by: { s: 'opp', t: 'R', f: 9 }, on: { s: 'me', t: 'R', f: 1 } });

  // Flaws are cut at two and every flaw is a flaw code.
  for (const p of [packet, packet2]) assert.ok(p.flaws.length <= LIMITS.FLAWS);
});

test('a flaw row is used only where its sentence is true', () => {
  const { sv, turn, report, held, fine } = worked;
  // 贪吃: the capture loses the exchange. The packet of section 9.5.
  const greedy = buildTryPacket(held, tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(greedy.flaws, [{ k: 'greedy', by: { s: 'me', t: 'C', f: 5 }, on: { s: 'opp', t: 'P', f: 5 }, on2: { s: 'opp', t: 'H', f: 7 } }]);

  // 空着 (这步没有实际作用) is said of a mistake with no effect at all, and not of a move that does something.
  // Hand-set: the verdict of the real assessment is changed to a mistake of the kind `slow`.
  const slow = (assessed) => {
    const copy = clone(assessed);
    copy.assessment.cat = 'mistake';
    copy.assessment.loss = 200;
    copy.assessment.isBest = false;
    copy.assessment.refutation = { reply: copy.assessment.line.moves[1], line: copy.assessment.line, outcome: copy.assessment.outcome, revealDepth: 3,
      danger: 'slow', focus: [] };
    return copy;
  };
  const start = survey(START_FEN, 0, 2);
  const startReport = reportOf(start);
  const startTurn = buildTurnBrief(startReport, createGameMemory(null), bookOf(start));
  const idle = buildTryPacket(slow(assess(start, mv('9384'))), tryCtx(startTurn, startReport), bookOf(start)).packet;      // 仕六进五
  assert.deepEqual(idle.does, [{ k: 'quiet' }]);
  assert.deepEqual(idle.flaws, [{ k: 'waste' }]);
  const busy = buildTryPacket(slow(fine), tryCtx(turn, report), bookOf(sv)).packet;                                        // 马二进三 develops
  assert.deepEqual(busy.flaws, []);

  // A line that loses a piece which could already be taken before the move: the flaw is the ignored threat, whatever the
  // first move of the punishment is. Section 9.3: the central pawn can be taken by 炮5进4; red plays 兵九进一 instead.
  const same = survey(SAME_CANNONS.fen, 2, 4);
  const sameReport = reportOf(same);
  const ignoring = slow(assess(same, mv('6050')));
  const taking = describeMove(applyMove(same.board, mv('6050')), mv('2464'));                                              // 炮5进4
  assert.equal(taking.notation, '炮5进4');
  ignoring.assessment.line = { ...ignoring.assessment.line, moves: [ignoring.assessment.line.moves[0], taking] };
  const ignored = buildTryPacket(ignoring, tryCtx(buildTurnBrief(sameReport, createGameMemory(null), bookOf(same)), sameReport), bookOf(same)).packet;
  assert.deepEqual(ignored.flaws, [{ k: 'ignore_threat', by: { s: 'opp', t: 'C', f: 5 }, on: { s: 'me', t: 'P', f: 5 } }]);
  // When the reply is played by another piece and the pawn falls later, the flaw names the pawn only: the rival piece of a
  // flaw is always the piece that plays the reply.
  const later = clone(ignoring);
  let board = applyMove(same.board, mv('6050'));
  const moves = [later.assessment.line.moves[0]];
  for (const code of ['0726', '6858', '2464']) {                     // 马8进7, 兵一进一, 炮5进4
    moves.push(describeMove(board, mv(code)));
    board = applyMove(board, mv(code));
  }
  assert.deepEqual(moves.map((m) => m.notation).slice(1), ['马8进7', '兵一进一', '炮5进4']);
  later.assessment.line = { ...later.assessment.line, moves };
  later.assessment.refutation.reply = moves[1];
  assert.deepEqual(buildTryPacket(later, tryCtx(buildTurnBrief(sameReport, createGameMemory(null), bookOf(same)), sameReport), bookOf(same)).packet.flaws,
    [{ k: 'ignore_threat', on: { s: 'me', t: 'P', f: 5 } }]);

  // 亏本兑子 (用X去换Y) needs the capturing piece to be taken back. Hand-set: the danger of the real 炮五进四 is renamed.
  const trade = clone(held);
  trade.assessment.refutation.danger = 'bad_trade';
  assert.deepEqual(buildTryPacket(trade, tryCtx(turn, report), bookOf(sv)).packet.flaws[0],
    { k: 'bad_trade', by: { s: 'me', t: 'C', f: 5 }, on: { s: 'opp', t: 'P', f: 5 } });
  const kept = clone(trade);                                       // ... and a line in which the cannon is not taken
  kept.assessment.line.moves = [kept.assessment.line.moves[0]];
  assert.ok(!buildTryPacket(kept, tryCtx(turn, report), bookOf(sv)).packet.flaws.some((f) => f.k === 'bad_trade'));
});

test('a move that is judged sound carries no flaw, although its capture loses the exchange on that square', () => {
  // The capture of 炮五进四 loses the exchange (a cannon for a pawn). Hand-set: the verdict of the real assessment. A move the
  // search judges best, brilliant or good in spite of that (the piece is won back elsewhere, or everything else is worse)
  // has no 贪吃 among its flaws: 「为什么？」 after a good verdict is answered from `does`, and a flaw would contradict it.
  const { sv, turn, report, held } = worked;
  assert.equal(held.facts.capture.exchange, 'loses');
  const judged = (cat) => {
    const copy = clone(held);
    Object.assign(copy.assessment, { cat, loss: cat === 'ok' ? 80 : 0, isBest: cat === 'best' || cat === 'brilliant', refutation: null });
    return buildTryPacket(copy, tryCtx(turn, report), bookOf(sv)).packet;
  };
  for (const cat of ['brilliant', 'best', 'good']) assert.deepEqual(judged(cat).flaws, [], cat);
  // a slow move keeps it, with the guard that takes back in the line
  assert.deepEqual(judged('ok').flaws, [{ k: 'greedy', by: { s: 'me', t: 'C', f: 5 }, on: { s: 'opp', t: 'P', f: 5 }, on2: { s: 'opp', t: 'H', f: 7 } }]);
});

test('a missed win names the piece the best line wins, not a piece it only trades', () => {
  // Red can trade rooks (车五平九, the pawn takes back) and then take the horse with the other rook. What that line wins is
  // the horse. Hand-set: the best line and the danger of a real assessment of 帅五进一.
  const sv = survey('3k5/9/p8/r3R3n/9/9/9/9/9/4K3R w', 40, 3);
  const report = reportOf(sv);
  const turn = buildTurnBrief(report, createGameMemory(null), bookOf(sv));
  const missed = clone(assess(sv, mv('9484')));
  const bestLine = toLine(sv.board, 'red', [mv('3430'), mv('2030'), mv('9838')]);
  assert.deepEqual(bestLine.moves.map((m) => m.captured), ['rook', 'rook', 'horse']);
  Object.assign(missed.assessment, { cat: 'mistake', loss: 400, isBest: false, bestLine,
    refutation: { reply: missed.assessment.line.moves[1], line: missed.assessment.line, outcome: missed.assessment.outcome, revealDepth: 3,
      danger: 'misses_win', focus: [] } });
  const packet = buildTryPacket(missed, tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(packet.flaws[0], { k: 'miss_capture', on: { s: 'opp', t: 'H', f: 9 } });
  // a best line that only trades wins nothing that could be named
  missed.assessment.bestLine = toLine(sv.board, 'red', [mv('3430'), mv('2030')]);
  assert.ok(!buildTryPacket(missed, tryCtx(turn, report), bookOf(sv)).packet.flaws.some((f) => f.k === 'miss_capture'));
});

test('the first flaw names a rival piece only when that piece plays the reply', () => {
  // A position of a playout. The red pawn on 七 can take the black cannon beside it for nothing (兵七平六). It takes the pawn in
  // front of it instead (兵七进一), which the horse on 1 guards: the capture loses the exchange on that square. The rival does
  // not take back: 炮4平1 saves the cannon and goes on to win a rook. The facts call the danger bad_trade, but nothing is
  // traded: what the move did wrong is the cannon it did not take (the rule of the danger misses_win, which bad_trade
  // stands in front of), and the greedy capture comes second, with its guard.
  const sv = survey('r1baka2r/7C1/n7b/2p5n/2Pcp1p1p/p8/4P1P1P/2NAB1Nc1/R8/R2AK1B2 w', 30, 3);
  const report = reportOf(sv);
  const turn = buildTurnBrief(report, createGameMemory(null), bookOf(sv));
  const assessed = assess(sv, mv('4232'), { compare: mv('4243') });
  const a = assessed.assessment;
  assert.equal(a.refutation.danger, 'bad_trade');
  assert.equal(assessed.facts.capture.exchange, 'loses');
  assert.equal(assessed.facts.capture.recapture.notation, '马1进3');
  assert.equal(a.line.moves[1].notation, '炮4平1');
  assert.equal(a.best.notation, '兵七平六');
  assert.ok(!a.isBest && a.loss >= 200 && a.bestOutcome.net >= 2);
  const guardless = { k: 'greedy', by: { s: 'me', t: 'P', f: 7 }, on: { s: 'opp', t: 'P', f: 3 } };
  const guarded = { ...guardless, on2: { s: 'opp', t: 'H', f: 1 } };
  const built = buildTryPacket(assessed, tryCtx(turn, report), bookOf(sv));
  assert.equal(built.packet.held, true);
  assert.deepEqual(built.packet.flaws, [{ k: 'miss_capture', on: { s: 'opp', t: 'C', f: 4 } }, guarded]);
  const show = (b) => composeLocal(turn, [{ i: 0, kind: 'start', said: 'none' }, { i: 1, kind: 'try', n: 1, try: b.packet, said: 'none' },
    { i: 2, kind: 'ask', ask: 'show', more: b.more }], 0);
  assert.ok(show(built).startsWith('对方多半走【炮4平1】'), show(built));

  // Hand-set: the best line wins less than two points, so no win was passed over and 贪吃 leads. The horse that guards the
  // pawn does not play the reply: it is not named (指给我看 would say 是对方的1路马在威胁。它会走【炮4平1】 of it).
  const modest = clone(assessed);
  modest.assessment.bestOutcome.net = 1;
  const led = buildTryPacket(modest, tryCtx(turn, report), bookOf(sv));
  assert.deepEqual(led.packet.flaws, [guardless]);
  assert.ok(show(led).startsWith('对方多半走【炮4平1】'), show(led));
  // Hand-set: the line in which the horse does take back, under a danger that has no flaw of its own. The guard plays the
  // reply and is named.
  const retake = describeMove(applyMove(sv.board, mv('4232')), mv('2032'));
  assert.equal(retake.notation, '马1进3');
  const taken = clone(assessed);
  taken.assessment.line.moves = [taken.assessment.line.moves[0], retake];
  Object.assign(taken.assessment.refutation, { reply: retake, danger: 'slow' });
  const back = buildTryPacket(taken, tryCtx(turn, report), bookOf(sv));
  assert.deepEqual(back.packet.flaws, [guarded]);
  assert.ok(show(back).startsWith('是对方的1路马在威胁。它会走【马1进3】'), show(back));
});

test('送双 names the forking piece only when one piece attacks both targets after the reply', () => {
  // One horse forks two rooks. Black plays 车6进1 next to the other rook; 马六进五 then attacks both, and no rook can take it.
  const sv = survey('4k4/5r3/3r5/9/9/9/3NP4/9/9/4K4 b', 41, 3);
  const report = reportOf(sv);
  const turn = buildTurnBrief(report, createGameMemory(null), bookOf(sv));
  const assessed = assess(sv, mv('1525'));
  assert.equal(assessed.assessment.refutation.danger, 'walks_into_fork');
  assert.equal(assessed.assessment.refutation.reply.notation, '马六进五');
  const forked = buildTryPacket(assessed, tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(forked.flaws[0].by, { s: 'opp', t: 'H', f: 6 });   // named where it stands before it jumps
  assert.deepEqual([forked.flaws[0].k, forked.flaws[0].on.t, forked.flaws[0].on2.t], ['walk_fork', 'R', 'R']);

  // A position of a playout: after 兵五进一 the cannon checks on the centre file (炮1平5), and the horse and the elephant are
  // left to the two rooks. The facts report a fork without a single forking piece and point at the piece of the reply; the
  // cannon attacks neither the horse nor the elephant, so 对方的1路炮一步就能同时捉住… is not said.
  const loose = survey('3aka3/9/4b4/p3p1r1p/9/c3P1N2/P8/4B4/9/1rBAKA3 w', 38, 3);
  const looseReport = reportOf(loose);
  const pushed = assess(loose, mv('5444'));
  assert.equal(pushed.assessment.refutation.danger, 'walks_into_fork');
  assert.equal(pushed.assessment.refutation.reply.notation, '炮1平5');
  const packet = buildTryPacket(pushed, tryCtx(buildTurnBrief(looseReport, createGameMemory(null), bookOf(loose)), looseReport), bookOf(loose)).packet;
  assert.deepEqual(packet.flaws[0], { k: 'walk_fork', on: { s: 'me', t: 'H', f: 3 }, on2: { s: 'me', t: 'E', f: 7 } });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4.14.2 buildTryPacket
// ---------------------------------------------------------------------------------------------------------------------

test('held is true exactly for mistake / blunder with a concrete loss; a missed win is not held; a sound sacrifice is not held', () => {
  const { sv, turn, report, held, fine } = worked;
  // 炮五进四 gives a cannon for a pawn: cost.cp <= -150.
  const lost = buildTryPacket(held, tryCtx(turn, report), bookOf(sv)).packet;
  assert.ok(lost.cat === 'mistake' || lost.cat === 'blunder');
  assert.deepEqual(lost.cost, { gain: ['P'], lose: ['C'], cp: -350 });
  assert.equal(lost.held, true);
  // the best move is not held
  assert.equal(buildTryPacket(fine, tryCtx(turn, report), bookOf(sv)).packet.held, false);

  // A missed win: black can take the unguarded horse (炮8进7) and plays 炮2平1 instead. Nothing is lost: not held.
  const lift = survey(ROOK_LIFT, 1, 4);
  const liftReport = reportOf(lift);
  const liftTurn = buildTurnBrief(liftReport, createGameMemory(null), bookOf(lift));
  const missed = buildTryPacket(assess(lift, mv('2120')), tryCtx(liftTurn, liftReport), bookOf(lift)).packet;
  assert.ok(missed.cat === 'mistake' || missed.cat === 'blunder', missed.cat);
  assert.equal(missed.cost, null);
  assert.equal(missed.held, false);
  assert.deepEqual(missed.flaws, [{ k: 'miss_capture', on: { s: 'opp', t: 'H', f: 2 } }]);
  assert.notEqual(missed.reply, null);

  // A mistake that costs less than 150 cp in material is not held (hand-set: the settled outcome of the real 炮五进四).
  const cheap = clone(held);
  cheap.assessment.outcome = { net: -1, won: [], lost: [{ piece: 'pawn', points: 1 }], kind: 'loses', mate: null, plies: 6, settled: true };
  const light = buildTryPacket(cheap, tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(light.cost, { gain: [], lose: ['P'], cp: -100 });
  assert.equal(light.held, false);

  // A sound sacrifice is not held although its line gives material (hand-set: verdict and flag of the real 炮五进四).
  const sac = clone(held);
  Object.assign(sac.assessment, { cat: 'brilliant', loss: 0, isBest: true, refutation: null });
  sac.assessment.flags.sacrifice = true;
  const offered = buildTryPacket(sac, tryCtx(turn, report), bookOf(sv)).packet;
  assert.equal(offered.held, false);
  assert.equal(offered.sac, true);
  assert.equal(offered.does[0].k, 'sacrifice');
  assert.deepEqual(offered.flaws, []);

  // A mistake that allows a forced mate is held whatever the material says (hand-set: flag and line).
  const mated = clone(fine);
  Object.assign(mated.assessment, { cat: 'blunder', loss: 2000, moveCp: -2000, isBest: false });
  mated.assessment.flags.allowsMate = true;
  mated.assessment.line = { ...mated.assessment.line, moves: mated.assessment.line.moves.slice(0, 4), end: 'mate' };
  mated.assessment.refutation = { reply: mated.assessment.line.moves[1], line: mated.assessment.line, outcome: mated.assessment.outcome, revealDepth: 3,
    danger: 'allows_mate', focus: [] };
  const doomed = buildTryPacket(mated, tryCtx(turn, report), bookOf(sv)).packet;
  assert.equal(doomed.held, true);
  assert.deepEqual(doomed.eval, { b: 'lost', mate: -2 });           // the rival's second move of the line mates
  assert.deepEqual(doomed.flaws, [{ k: 'allow_mate' }]);
});

test('a held packet contains no rival move and no better move; more carries both', () => {
  const { sv, turn, report, held } = worked;
  const { packet, more } = buildTryPacket(held, tryCtx(turn, report, { self: true, habit: 'greedy' }), bookOf(sv));
  assert.equal(packet.held, true);
  assert.equal(packet.reply, null);
  assert.deepEqual(notationsOf(packet), ['炮五进四']);              // the tried move and nothing else
  assert.ok(!('better' in packet));
  assert.equal(more.reply.first, 'opp');
  assert.equal(more.reply.moves[0], '马7进5');
  assert.deepEqual(more.reply.net, { gain: ['P'], lose: ['C'], cp: -350 });
  assert.equal(more.better[0].move, '马二进三');

  // Section 9.5, field by field. Verdict and loss depend on the search depth (the contract prints mistake / 350; this search
  // says blunder / 389 at depth 6), the rest is the contract's packet.
  const example = fixture('try-held-ask.json').events[1].try;
  for (const key of ['move', 'held', 'self', 'eval', 'does', 'flaws', 'cost', 'reply', 'toward', 'chance', 'habit']) {
    assert.deepEqual(packet[key], example[key], key);
  }
  assert.ok(packet.loss >= 300 && packet.loss <= 450, String(packet.loss));
  assertValid(turn, [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'try', n: 1, try: packet, said: 'none' },
    { i: 2, kind: 'ask', ask: 'reply', more }], 'held try and its follow-up');

  // A trial that is not held shows the reply at once, and `more` has only `better`.
  const open = buildTryPacket(worked.fine, tryCtx(turn, report, { self: true }), bookOf(sv));
  assert.equal(open.packet.reply.first, 'opp');
  assert.ok(open.packet.reply.moves.length >= 1 && open.packet.reply.moves.length <= LIMITS.LINE_MOVES);
  assert.deepEqual(open.more, { better: [] });
  // Section 9.6 (the contract also lists open_rook, which the facts do not report for this move: the rook gains one point).
  const plain = fixture('try.json').events.find((e) => e.kind === 'try').try;
  for (const key of ['move', 'cat', 'loss', 'held', 'self', 'eval', 'flaws', 'cost', 'toward', 'chance']) assert.deepEqual(open.packet[key], plain[key], key);
  assert.deepEqual(open.packet.does[0], plain.does[0]);
  assert.deepEqual(open.packet.reply.net, plain.reply.net);
});

test('better is never in the first packet; better[0] is the assessment\'s comparison move', () => {
  const { sv, turn, report, held, fine } = worked;
  const { packet, more } = buildTryPacket(held, tryCtx(turn, report), bookOf(sv));
  assert.ok(!J(packet).includes('马二进三'));
  assert.equal(held.assessment.best.notation, '马二进三');           // the pinned move of the position
  const first = more.better[0];
  assert.equal(first.move, '马二进三');
  assert.equal(first.gain, packet.loss);
  assert.deepEqual(first.does, [{ k: 'develop', by: { s: 'me', t: 'H', f: 3 } }]);
  assert.equal(first.line.first, 'opp');
  assert.deepEqual(first.line.net, { gain: [], lose: [], cp: 0 });
  assert.ok(more.better.length <= LIMITS.ALTS);
  for (const alt of more.better) {
    assert.ok(alt.gain >= 60 && alt.does.length >= 1 && alt.does.length <= LIMITS.EFFECTS);
    assert.notEqual(alt.move, packet.move);
  }
  // toward points where better[0] lands and names its leading effect, never the move
  assert.deepEqual(packet.toward, { area: 'right', theme: 'develop' });
  // nothing better than the best move; a move within 60 cp of it has no pointer either
  const best = buildTryPacket(fine, tryCtx(turn, report), bookOf(sv));
  assert.deepEqual(best.more.better, []);
  assert.equal(best.packet.toward, null);
  const close = clone(held);
  Object.assign(close.assessment, { cat: 'good', loss: 40, moveCp: close.assessment.bestCp - 40, refutation: null });
  const near = buildTryPacket(close, tryCtx(turn, report), bookOf(sv));
  assert.deepEqual(near.more.better, []);
  assert.equal(near.packet.toward, null);

  // The effects of an alternative come without move facts (an assessment carries the facts of the tried move only). They must
  // be what the real facts of that move give: pouch 3 is built on the real facts of the same move.
  const lift = survey(ROOK_LIFT, 1, 4);
  const liftReport = reportOf(lift);
  const liftTurn = buildTurnBrief(liftReport, createGameMemory(null), bookOf(lift));
  const capture = mv('2797');                                       // 炮8进7 takes the horse; nothing can take back
  const other = buildTryPacket(assess(lift, mv('2120'), { compare: capture }), tryCtx(liftTurn, liftReport), bookOf(lift));
  assert.equal(other.more.better[0].move, '炮8进7');
  assert.deepEqual(other.more.better[0].does[0], { k: 'capture_free', by: { s: 'me', t: 'C', f: 8 }, on: { s: 'opp', t: 'H', f: 2 } });
  assert.deepEqual(other.packet.toward, { area: 'their_back', theme: 'capture_free' });
  const hint = hintFor({ fen: lift.fen, ply: 1, table: lift.table, move: capture, facts: lift.facts, threat: lift.threat });
  const pouch = buildHintPacket(3, hint, { turn: liftTurn, report: liftReport }, bookOf(lift));
  assert.deepEqual(other.more.better[0].does[0], pouch.does[0]);
});

test('the flags of a trial: only, self, repeat, habit, avoided, vsPrev, chance, and the mate distance after the move', () => {
  const { sv, turn, report, held, fine } = worked;
  const plain = buildTryPacket(fine, tryCtx(turn, report), bookOf(sv)).packet;
  for (const key of ['only', 'sac', 'self', 'repeat', 'habit', 'avoided', 'vsPrev']) assert.ok(!(key in plain), key);
  const marked = buildTryPacket(fine, tryCtx(turn, report, { self: true, repeat: true, avoided: 'greedy' }), bookOf(sv)).packet;
  assert.equal(marked.self, true);
  assert.equal(marked.repeat, true);
  assert.equal(marked.avoided, 'greedy');
  assert.equal(buildTryPacket(held, tryCtx(turn, report, { habit: 'greedy' }), bookOf(sv)).packet.habit, 'greedy');

  // only: the tried move is the one move that avoids a serious loss (hand-set flag)
  const sole = clone(fine);
  sole.assessment.flags.onlyMove = true;
  assert.equal(buildTryPacket(sole, tryCtx(turn, report), bookOf(sv)).packet.only, true);
  const wrong = clone(held);                                         // another move of a position that has an only move
  wrong.assessment.flags.onlyMove = true;
  assert.ok(!('only' in buildTryPacket(wrong, tryCtx(turn, report), bookOf(sv)).packet));

  // vsPrev: against the previous try of the turn, 30 cp or less is the same
  const prevOf = (loss) => ({ ...plain, loss });
  const vs = (assessed, prev) => buildTryPacket(assessed, tryCtx(turn, report, { prev }), bookOf(sv)).packet.vsPrev;
  assert.equal(vs(fine, prevOf(200)), 'better');
  assert.equal(vs(fine, prevOf(30)), 'same');
  assert.equal(vs(held, prevOf(0)), 'worse');

  // chance: the rival's pending chance is taken by its first move (or a move within 60 cp), missed from a loss of 150 on
  const chance = { gain: 400, points: 4, tier: 1, revealDepth: 2, line: toLine(sv.board, 'red', [worked.best]) };
  const withChance = { ...report, lastOpp: { ...report.lastOpp, choice: { ...report.lastOpp.choice, kind: 'chance', chance } } };
  assert.equal(buildTryPacket(fine, tryCtx(turn, withChance), bookOf(sv)).packet.chance, 'taken');
  assert.equal(buildTryPacket(held, tryCtx(turn, withChance), bookOf(sv)).packet.chance, 'missed');
  assert.equal(buildTryPacket(held, tryCtx(turn, report), bookOf(sv)).packet.chance, 'none');

  // eval.mate is the distance after the move: a move that starts a mate in three leaves two moves to play (hand-set flag);
  // distances beyond nine moves are left out (CONTRACT-NOTES 88)
  const mating = clone(fine);
  Object.assign(mating.assessment, { moveCp: 2000, bestCp: 2000, cat: 'brilliant' });
  mating.assessment.flags.givesMate = 3;
  const m = buildTryPacket(mating, tryCtx(turn, report), bookOf(sv)).packet;
  assert.deepEqual(m.eval, { b: 'won', mate: 2 });
  assert.equal(m.does[0].k, 'mate_threat');
  mating.assessment.flags.givesMate = 12;
  assert.deepEqual(buildTryPacket(mating, tryCtx(turn, report), bookOf(sv)).packet.eval, { b: 'won' });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4.14.1 buildTurnBrief
// ---------------------------------------------------------------------------------------------------------------------

test('the brief of the worked position is the turn of section 9 wherever the engine agrees with it', () => {
  const example = fixture('try-held-ask.json').turn;
  const { turn } = worked;
  for (const key of ['ply', 'me', 'phase', 'check', 'n', 'back', 'eval', 'mat', 'level', 'moments', 'taught', 'mine', 'threats', 'chance', 'known']) {
    assert.deepEqual(turn[key], example[key], key);
  }
  assert.equal(turn.opp.move, example.opp.move);
  assert.equal(turn.opp.check, false);
  assert.equal(turn.opp.quality, 'normal');                          // a variety move that gives up 20 cp
  assert.equal(turn.opp.name, 'horse_open');
  // the two effects of the contract's example, in the order of the table of 4.14.3 (the parry before the development)
  assert.deepEqual(turn.opp.does, [{ k: 'defend', on: { s: 'opp', t: 'P', f: 5 } }, { k: 'develop', by: { s: 'opp', t: 'H', f: 7 } }]);
  assertValid(turn, [{ i: 0, kind: 'opp' }], 'worked turn');

  // Section 9.3: 1. 炮二平五 炮8平5.
  const sv = survey(SAME_CANNONS.fen, 2, 4);
  const memory = createGameMemory(null);
  memory.noteMine(0, { move: '炮二平五', cat: 'best', waited: true, self: true, packet: null, more: null });
  const same = buildTurnBrief(reportOf(sv, { lastOpp: rivalTurn(AFTER_CENTRAL_CANNON, mv('2724'), 1, { kind: 'honest', loss: 0 }) }), memory, bookOf(sv));
  const printed = fixture('opp.json').turn;
  for (const key of ['ply', 'me', 'phase', 'check', 'n', 'back', 'eval', 'mat', 'level', 'moments', 'taught', 'mine', 'threats', 'chance', 'known']) {
    assert.deepEqual(same[key], printed[key], key);
  }
  assert.deepEqual({ ...same.opp, does: [same.opp.does[0]] }, printed.opp);
  assert.deepEqual(same.opp.does.slice(1), [{ k: 'develop', by: { s: 'opp', t: 'C', f: 5 } }]);       // the cannon also left its starting point
  assertValid(same, [{ i: 0, kind: 'opp' }], 'same cannons');
});

test('turn.threats come from SEE-based hanging pieces, mates and the pass search, most severe first', () => {
  // Black threatens 重炮 (炮2平5 mates), and the black pawn on the edge can take the red horse in front of it for nothing.
  const sv = survey('4k4/9/1c7/p8/N8/9/4c4/9/9/3AKA3 w', 40, 3);
  assert.equal(sv.facts.mates.black.in, 1);
  assert.ok(sv.facts.hanging.some((h) => h.piece.color === 'red' && h.piece.type === 'horse'));
  const book = bookOf(sv);
  const turn = buildTurnBrief(reportOf(sv), createGameMemory(null), book);
  assert.deepEqual(turn.threats, [
    { k: 'mate_threat', by: { s: 'opp', t: 'C', f: 2 }, move: '炮2平5', net: { gain: [], lose: [], cp: 0 }, sev: 'mate', name: 'double_cannon' },
    { k: 'attack', by: { s: 'opp', t: 'P', f: 1 }, on: { s: 'me', t: 'H', f: 9 }, move: '卒1进1', net: { gain: [], lose: ['H'], cp: -400 }, sev: 'piece' },
  ]);
  // the pass search found the same mate: it is listed once
  assert.equal(sv.threat.kind, 'mate');
  assert.equal(sv.threat.line.moves[0].notation, '炮2平5');
  // every threat move is in the book, as a move of the rival that the child cannot play
  for (const t of turn.threats) {
    const link = book.lookup(t.move);
    assert.ok(link && link.src === 'threat' && link.playable === false && link.color === 'black', t.move);
    assert.ok(!('on2' in t));
  }
  assertValid(turn, [{ i: 0, kind: 'start' }], 'threats');

  // A cannon's capture is worded with its mount; a pass-search line that starts with the same move adds nothing (section 9.3).
  const same = survey(SAME_CANNONS.fen, 2, 4);
  assert.equal(same.threat.line.moves[0].notation, '炮5进4');
  assert.deepEqual(buildTurnBrief(reportOf(same), createGameMemory(null), bookOf(same)).threats,
    [{ k: 'cannon_mount', by: { s: 'opp', t: 'C', f: 5 }, on: { s: 'me', t: 'P', f: 5 }, move: '炮5进4', net: { gain: [], lose: ['P'], cp: -100 }, sev: 'pawn' }]);

  // The pass search alone: a check that takes nothing (车1进4 along the bottom rank). Its facts are real; that the pass search
  // chose this move is given. A plan (kind 'plan') is not a threat.
  const lone = survey('3k5/9/9/9/9/r8/9/9/9/4K4 w', 60, 3);
  const check = mv('5090');
  const line = toLine(lone.board, 'black', [check]);
  const info = { kind: 'check', line, outcome: materialOutcome(line, 'black'), mate: null, facts: moveFacts(boardToFen(lone.board, 'black'), check) };
  assert.ok(info.facts.check !== null);
  assert.deepEqual(buildTurnBrief(reportOf(lone, { threat: info }), createGameMemory(null), bookOf(lone)).threats,
    [{ k: 'check', by: { s: 'opp', t: 'R', f: 1 }, move: '车1进4', net: { gain: [], lose: [], cp: 0 }, sev: 'pawn' }]);
  assert.deepEqual(buildTurnBrief(reportOf(lone, { threat: { ...info, kind: 'plan' } }), createGameMemory(null), bookOf(lone)).threats, []);
  // A check whose line goes on to lose material for the rival threatens no more than the check: what the child would take
  // is not reported as the rival's intent. Hand-set: the outcome of the line (the rival's view).
  const losing = { ...info, outcome: { net: -2, won: [], lost: [{ piece: 'elephant', points: 2 }], kind: 'loses', mate: null, plies: 3, settled: true } };
  assert.deepEqual(buildTurnBrief(reportOf(lone, { threat: losing }), createGameMemory(null), bookOf(lone)).threats[0].net, { gain: [], lose: [], cp: 0 });
  // ... and neither is what the rival takes in it: a line that wins a point or more is `wins-material`, so the threat of a
  // `check` is the check alone and its balance stays empty (the narrators then add no "and after that …" clause).
  const winning = { ...info, outcome: { net: 0.5, won: [{ piece: 'pawn', points: 1 }], lost: [], kind: 'wins', mate: null, plies: 3, settled: true } };
  assert.deepEqual(buildTurnBrief(reportOf(lone, { threat: winning }), createGameMemory(null), bookOf(lone)).threats[0].net, { gain: [], lose: [], cp: 0 });

  // A mate carries no balance either, whatever the mating move takes. 铁门栓: 车四进五 takes the black horse and mates
  // (the king cannot take back: the kings would face each other; the advisor cannot: it is the cannon's second screen).
  // The horse is also a hanging piece of the child, taken by the same move: the threat is listed once, as the mate.
  const bolt = survey('2baknb2/4a4/9/4p4/9/5R3/9/4C4/9/5K3 b', 41, 3);
  assert.equal(bolt.facts.mates.red.line.moves[0].captured, 'horse');
  assert.ok(bolt.facts.hanging.some((h) => h.piece.color === 'black' && h.piece.type === 'horse' && h.capture.notation === '车四进五'));
  const bolted = buildTurnBrief(reportOf(bolt), createGameMemory(null), bookOf(bolt));
  assert.deepEqual(bolted.threats, [{ k: 'mate_threat', by: { s: 'opp', t: 'R', f: 4 }, move: '车四进五', net: { gain: [], lose: [], cp: 0 }, sev: 'mate',
    name: 'iron_bolt' }]);
  assert.equal(composeLocal(bolted, [{ i: 0, kind: 'ask', ask: 'intent' }], 0), '对方下一步想走【车四进五】，那就是杀棋。');
  // the mate the pass search finds (kind 'mate') is treated alike. Hand-set: the first move of the same real threat is
  // taken out of the facts' mate, so that only the pass search reports it.
  assert.equal(bolt.threat.kind, 'mate');
  const passOnly = { ...reportOf(bolt), facts: { ...bolt.facts, mates: { red: null, black: null }, hanging: [] } };
  const passed = buildTurnBrief(passOnly, createGameMemory(null), bookOf(bolt)).threats;
  assert.equal(passed.length, 1);
  assert.deepEqual([passed[0].k, passed[0].sev, passed[0].net], ['mate_threat', 'mate', { gain: [], lose: [], cp: 0 }]);
  assertValid(bolted, [{ i: 0, kind: 'start' }], 'mate threat');

  // A guarded piece that can still be taken with profit: the balance is the exchange, not the piece alone. The red rook on 五
  // is attacked by the black cannon over its pawn and guarded by the horse: cannon takes rook, horse takes cannon.
  const guarded = survey('3k5/9/4c4/4p4/9/4R4/9/3N5/9/4K4 w', 40, 3);
  const exchange = buildTurnBrief(reportOf(guarded, { threat: null }), createGameMemory(null), bookOf(guarded)).threats;
  assert.deepEqual(exchange, [{ k: 'cannon_mount', by: { s: 'opp', t: 'C', f: 5 }, on: { s: 'me', t: 'R', f: 5 }, move: '炮5进3',
    net: { gain: ['C'], lose: ['R'], cp: -450 }, sev: 'piece' }]);

  // At most four, the most severe first.
  const many = survey('3k5/9/9/r1r1r1r1r/9/P1P1P1P1P/9/9/9/4K4 w', 60, 2);
  const listed = buildTurnBrief(reportOf(many, { threat: null }), createGameMemory(null), bookOf(many)).threats;
  assert.equal(listed.length, LIMITS.THREATS);
  const rank = { mate: 4, rook: 3, piece: 2, pawn: 1 };
  for (let k = 1; k < listed.length; k++) assert.ok(rank[listed[k - 1].sev] >= rank[listed[k].sev]);
});

test('a threat of the pass search names the piece that acts, where it stands now', () => {
  // The red pawn steps aside (兵三平二) and becomes the screen of the cannon on 二, which then aims at the black horse. The
  // facts of that move are real; that the pass search chose it is given. The piece that threatens is the cannon, not the pawn.
  const sv = survey('4k2n1/9/9/9/6P2/9/9/7C1/9/3K5 b', 41, 3);
  const step = mv('4647');
  const line = toLine(sv.board, 'red', [step]);
  const info = { kind: 'wins-material', line, outcome: materialOutcome(line, 'red'), mate: null, facts: moveFacts(boardToFen(sv.board, 'red'), step) };
  assert.equal(line.moves[0].notation, '兵三平二');
  assert.equal(info.facts.threats[0].by.type, 'cannon');
  const book = bookOf(sv);
  const turn = buildTurnBrief(reportOf(sv, { threat: info }), createGameMemory(null), book);
  assert.deepEqual(turn.threats, [{ k: 'cannon_mount', by: { s: 'opp', t: 'C', f: 2 }, on: { s: 'me', t: 'H', f: 8 }, move: '兵三平二',
    net: { gain: [], lose: [], cp: 0 }, sev: 'pawn' }]);
  assert.equal(composeLocal(turn, [{ i: 0, kind: 'ask', ask: 'danger' }], 0), '要当心：对方的二路炮瞄着你的8路马。');
  assert.equal(book.lookup('兵三平二').src, 'threat');
  assertValid(turn, [{ i: 0, kind: 'start' }], 'pass-search threat');

  // A Threat has no `on2`, so a pin would read as its bare term. When the same move also attacks a piece outright, that
  // attack is what is told. Hand-set: a pin is added in front of the real cannon mount.
  const pinned = clone(info);
  const after = applyMove(sv.board, step);
  const ref = (row, col) => pieceRef(after, { row, col });
  pinned.facts.pins.created = [{ pinned: ref(0, 7), by: ref(7, 7), shield: ref(0, 4), absolute: false, kind: 'cannon' }];
  const told = buildTurnBrief(reportOf(sv, { threat: pinned }), createGameMemory(null), bookOf(sv)).threats;
  assert.equal(told.length, 1);
  assert.equal(told[0].k, 'cannon_mount');
  // with nothing but the pin, the pin is the threat
  pinned.facts.threats = [];
  pinned.facts.fork = null;
  assert.equal(buildTurnBrief(reportOf(sv, { threat: pinned }), createGameMemory(null), bookOf(sv)).threats[0].k, 'pin');
});

test('a hanging piece of a child in check is worded as attacked, and a finished game lists no threat', () => {
  // Red is in check from the rook on the king's file; the black pawn can take the red horse beside it. Whatever red answers,
  // the horse stays en prise: the threat says 捉, with the capture as the rival's move.
  const sv = survey('3k5/9/9/9/4r4/9/n8/p8/N8/4K4 w', 40, 3);
  assert.notEqual(sv.facts.check, null);
  const turn = buildTurnBrief(reportOf(sv), createGameMemory(null), bookOf(sv));
  assert.equal(turn.check, true);
  const threat = turn.threats.find((t) => t.on && t.on.t === 'H');
  assert.ok(threat, J(turn.threats));
  assert.equal(threat.k, 'attack');
  assert.deepEqual(threat.on, { s: 'me', t: 'H', f: 9 });
  assert.equal(composeLocal(turn, [{ i: 0, kind: 'ask', ask: 'danger' }], 0), '要当心：对方的1路卒捉你的九路马。');

  // 重炮 on the board: red is mated. The move that ended the game has no threat behind it, and the child has no move.
  const before = '4k4/9/1c7/9/9/9/4c4/9/9/3AKA3 b';
  const mating = mv('2124');
  const after = boardToFen(applyMove(fenToBoard(before).board, mating), 'red');
  const facts = positionFacts(after, { ply: 41 });
  const report = { ply: 41, me: 'red', board: fenToBoard(after).board, facts, legalCount: 0, threat: undefined, evalCp: -2000, mate: null,
    lastOpp: rivalTurn(before, mating, 40), prev: null, level: 3, announceChance: false, back: null };
  const over = buildTurnBrief(report, createGameMemory(null), createMoveBook({ board: report.board, turn: 'red' }));
  assert.equal(over.n, 0);
  assert.equal(over.check, true);
  assert.deepEqual(over.threats, []);
  assert.deepEqual(over.opp.does[0], { k: 'mate', by: { s: 'opp', t: 'C', f: 5, q: 'back' }, name: 'double_cannon' });
  assert.ok(!over.opp.does.some((e) => e.k === 'attack' || e.k === 'cannon_mount' || e.k === 'fork'));
  assertValid(over, [{ i: 0, kind: 'opp' }], 'mated');
});

test('a brief built before the threat search answered still has known.threats true from facts and no chance sentence', () => {
  const sv = survey(SAME_CANNONS.fen, 2, 4);
  const early = buildTurnBrief(reportOf(sv, { threat: undefined, evalCp: null }), createGameMemory(null), bookOf(sv));
  assert.deepEqual(early.known, { threats: true, chance: false });
  assert.equal(early.chance, null);
  assert.equal(early.threats.length, 1);                             // the hanging pawn is known from the facts alone
  assert.deepEqual(early.eval, { b: 'even' });                       // no table yet
  // the number of legal moves is the true count even when the report has none yet (CONTRACT-NOTES 69 d)
  assert.equal(buildTurnBrief(reportOf(sv, { legalCount: 0 }), createGameMemory(null), bookOf(sv)).n, 35);
  assert.equal(buildTurnBrief(reportOf(survey(START_FEN, 0, 2), { legalCount: 0 }), createGameMemory(null), createMoveBook({ board: START, turn: 'red' })).n, 44);
});

test('the fields of the brief: phase, eval, material, level, back', () => {
  const sv = worked.sv;
  const brief = (more) => buildTurnBrief(reportOf(sv, more), createGameMemory(null), bookOf(sv));
  // eval bands of section 3.6 and the mate distance (left out beyond nine moves and for a repetition verdict)
  for (const [cp, b] of [[600, 'won'], [599, 'better'], [150, 'better'], [149, 'even'], [-149, 'even'], [-150, 'worse'], [-599, 'worse'], [-600, 'lost']]) {
    assert.deepEqual(brief({ evalCp: cp }).eval, { b }, String(cp));
  }
  assert.deepEqual(brief({ evalCp: 2000, mate: 3 }).eval, { b: 'won', mate: 3 });
  assert.deepEqual(brief({ evalCp: -2000, mate: -2 }).eval, { b: 'lost', mate: -2 });
  assert.deepEqual(brief({ evalCp: 2000, mate: 51 }).eval, { b: 'won' });
  assert.deepEqual(brief({ evalCp: 2000, mate: 10 }).eval, { b: 'won' });
  // level: rounded and clamped; back: passed on
  assert.equal(brief({ level: 3.6 }).level, 4);
  assert.equal(brief({ level: 0.2 }).level, 1);
  assert.equal(brief({ level: 12 }).level, 9);
  assert.equal(brief({ back: 'undo' }).back, 'undo');
  assert.equal(brief({ back: 'reload' }).back, 'reload');
  // phase: opening while ply < 20 and the heavy pieces are nearly all there; endgame from material.phase 0.6
  assert.equal(brief({}).phase, 'opening');
  assert.equal(brief({ ply: 20 }).phase, 'middle');
  const bare = survey('3k5/9/9/9/9/9/9/9/R8/4K4 w', 80, 2);
  assert.equal(buildTurnBrief(reportOf(bare), createGameMemory(null), bookOf(bare)).phase, 'endgame');

  // material after the rival's move: 1. 炮二平五 炮8平5 2. 马二进三 炮5进4 takes the central pawn with check
  let board = START;
  for (const code of ['7774', '2724', '9776']) board = applyMove(board, mv(code));
  const fenBefore = boardToFen(board, 'black');
  const taken = survey(boardToFen(applyMove(board, mv('2464')), 'red'), 4, 3);
  const turn = buildTurnBrief(reportOf(taken, { lastOpp: rivalTurn(fenBefore, mv('2464'), 3) }), createGameMemory(null), bookOf(taken));
  assert.deepEqual(turn.mat, { me: 'R2H2C2P4A2E2', opp: 'R2H2C2P5A2E2', cp: -100 });
  assert.equal(turn.opp.captured, 'P');
  assert.equal(turn.opp.check, true);
  assert.equal(turn.check, true);
  assert.deepEqual(turn.opp.does[0], { k: 'capture', by: { s: 'opp', t: 'C', f: 5 }, on: { s: 'me', t: 'P', f: 5 } });   // the horse can take back
  // a pawn across the river counts as a pawn: equal piece counts read as an equal balance
  const crossed = survey('3k5/9/9/P8/9/9/8p/9/9/4K4 w', 80, 2);
  assert.deepEqual(buildTurnBrief(reportOf(crossed), createGameMemory(null), bookOf(crossed)).mat, { me: 'P1', opp: 'P1', cp: 0 });
});

test('chance appears only when announceChance is set and never names a move or a piece', () => {
  // After 1. 车一进一 the horse on 二 can be taken for nothing by 炮8进7: the rival's move gave a chance of four points.
  const sv = survey(ROOK_LIFT, 1, 4);
  const capture = mv('2797');
  const chance = { gain: 400, points: 4, tier: 1, revealDepth: 2, line: toLine(sv.board, 'black', [capture]) };
  const lastOpp = rivalTurn(START_FEN, mv('9888'), 0, { kind: 'chance', loss: 400, chance });
  const quiet = buildTurnBrief(reportOf(sv, { lastOpp, announceChance: false }), createGameMemory(null), bookOf(sv));
  assert.equal(quiet.chance, null);
  assert.deepEqual(quiet.known, { threats: true, chance: false });

  const book = bookOf(sv);
  const told = buildTurnBrief(reportOf(sv, { lastOpp, announceChance: true }), createGameMemory(null), book);
  assert.deepEqual(told.chance, { size: 'piece', theme: 'capture_free', area: 'their_back' });
  assert.deepEqual(told.known, { threats: true, chance: true });
  assert.deepEqual(Object.keys(told.chance), ['size', 'theme', 'area']);
  assert.ok(!J(told).includes('炮8进7'));
  assert.equal(book.lookup('炮8进7'), null);                         // the winning move is not on the wire, so not in the book
  assert.equal(told.opp.quality, 'slip');
  assertValid(told, [{ i: 0, kind: 'opp' }], 'chance');

  // size by gain; `mate` when the line mates
  const sized = (gain) => buildTurnBrief(reportOf(sv, { lastOpp: rivalTurn(START_FEN, mv('9888'), 0, { kind: 'chance', chance: { ...chance, gain } }),
    announceChance: true }), createGameMemory(null), bookOf(sv)).chance.size;
  assert.deepEqual([800, 799, 300, 299, 100, 99].map(sized), ['rook', 'piece', 'piece', 'pawn', 'pawn', 'position']);
  const suite = survey('3aka3/9/9/4C4/9/9/9/1C7/9/4K4 w', 41, 3);
  const mate = { gain: 2000, points: 20, tier: 1, revealDepth: 2, line: toLine(suite.board, 'red', [mv('7174')]) };
  const lost = buildTurnBrief(reportOf(suite, { lastOpp: rivalTurn('3a1a3/4k4/9/4C4/9/9/9/1C7/9/4K4 b', mv('1404'), 40, { kind: 'finisher', chance: mate }),
    announceChance: true }), createGameMemory(null), bookOf(suite));
  assert.deepEqual(lost.chance, { size: 'mate', theme: 'mate', area: 'my_palace' });      // 炮八平五 lands on (7,4), inside the child's palace

  // the area word of the pending chance, for the director's nudge (announced or not)
  assert.equal(chanceAreaWord(reportOf(sv, { lastOpp, announceChance: false })), AREA.their_back);
  assert.equal(chanceAreaWord(reportOf(sv, { lastOpp: rivalTurn(START_FEN, mv('9888'), 0) })), null);
  assert.equal(chanceAreaWord(reportOf(sv)), null);
});

test('quality and overlooked are derived from the teaching choice', () => {
  const sv = worked.sv;
  const quality = (choice) => buildTurnBrief(reportOf(sv, { lastOpp: rivalTurn(AFTER_CENTRAL_CANNON, mv('0726'), 1, choice) }), createGameMemory(null),
    bookOf(sv)).opp.quality;
  assert.equal(quality({ kind: 'chance', loss: 200 }), 'slip');
  assert.equal(quality({ kind: 'finisher', loss: 400 }), 'slip');
  assert.equal(quality({ kind: 'concession', loss: 60 }), 'soft');
  assert.equal(quality({ kind: 'concession', loss: 16 }), 'soft');
  assert.equal(quality({ kind: 'concession', loss: 15 }), 'strong');  // CONTRACT-NOTES 107: reported as an honest move
  assert.equal(quality({ kind: 'honest', loss: 0 }), 'strong');
  assert.equal(quality({ kind: 'honest', loss: 15 }), 'strong');
  assert.equal(quality({ kind: 'honest', loss: 16 }), 'normal');
  assert.equal(quality({ kind: 'variety', loss: 0 }), 'strong');
  assert.equal(quality({ kind: 'variety', loss: 25 }), 'normal');
  assert.equal(quality({ kind: 'overlook', loss: 300 }), 'normal');
  // after an undo or a reload the last rival move comes without a choice (CONTRACT-NOTES 28)
  const bare = buildTurnBrief(reportOf(sv, { lastOpp: rivalTurn(AFTER_CENTRAL_CANNON, mv('0726'), 1, null), back: 'undo' }), createGameMemory(null), bookOf(sv));
  assert.equal(bare.opp.quality, 'normal');
  assert.equal(bare.opp.move, '马8进7');
  assert.ok(!('overlooked' in bare.opp) && !('punishes' in bare.opp));

  // overlooked: the black rook could have taken the horse on the river (车1平5) and the king stepped aside instead
  const before = '4k4/9/9/9/9/r3N4/9/9/9/4K4 b';
  const boardBefore = fenToBoard(before).board;
  const stepped = mv('0403');
  const after = survey(boardToFen(applyMove(boardBefore, stepped), 'red'), 41, 3);
  const line = toLine(boardBefore, 'black', [mv('5054')]);
  const book = bookOf(after);
  const turn = buildTurnBrief(reportOf(after, { lastOpp: rivalTurn(before, stepped, 40, { kind: 'overlook', loss: 400, overlooked: { gain: 400, mate: false, line } }) }),
    createGameMemory(null), book);
  assert.deepEqual(turn.opp.overlooked, { on: { s: 'me', t: 'H', f: 5 }, move: '车1平5' });
  assert.ok(book.lookup('车1平5'));
  assertValid(turn, [{ i: 0, kind: 'opp' }], 'overlooked');
  // a mate he spared is not reported as an overlooked capture
  const spared = buildTurnBrief(reportOf(after, { lastOpp: rivalTurn(before, stepped, 40, { kind: 'overlook', loss: 2000, overlooked: { gain: 2000, mate: true, line } }) }),
    createGameMemory(null), bookOf(after));
  assert.ok(!('overlooked' in spared.opp));
});

test('punishes: the rival plays the refutation of the previous move or takes a piece it exposed; mine carries the played packet', () => {
  // The child played 炮五进四 (section 9.5) and the rival answered 马7进5.
  const { sv, turn, report, held } = worked;
  const built = buildTryPacket(held, tryCtx(turn, report, { self: true }), bookOf(sv));
  const prev = { move: held.assessment.move, cat: held.assessment.cat, waited: true, self: true, packet: built.packet, more: built.more, assessed: held };
  const afterTry = applyMove(sv.board, mv(HORSE_REPLY.trial));
  const fenAfterTry = boardToFen(afterTry, 'black');
  const refutation = mv(HORSE_REPLY.refutation);
  const next = survey(boardToFen(applyMove(afterTry, refutation), 'red'), 4, 4);
  const memory = createGameMemory(null);
  memory.noteMine(2, { move: '炮五进四', cat: prev.cat, waited: true, self: true, packet: built.packet, more: built.more });
  const book = bookOf(next);
  const after = buildTurnBrief(reportOf(next, { lastOpp: rivalTurn(fenAfterTry, refutation, 3), prev }), memory, book);
  assert.equal(after.opp.punishes, true);
  assert.equal(after.opp.captured, 'C');
  assert.deepEqual(after.mat, { me: 'R2H2C1P5A2E2', opp: 'R2H2C2P4A2E2', cp: -350 });
  // mine: the packet of the move with nothing withheld
  assert.equal(after.mine.move, '炮五进四');
  assert.equal(after.mine.try.held, false);
  assert.deepEqual(after.mine.try.reply, built.more.reply);
  // the price of the move is what the two moves took: the cannon took a pawn, the horse took the cannon (nothing can take back)
  assert.deepEqual(after.mine.try.cost, { gain: ['P'], lose: ['C'], cp: -350 });
  // the previous move, the rival's move and the line of the previous packet are in the book; none is playable now
  for (const [notation, src] of [['炮五进四', 'mine'], ['马7进5', 'opp']]) {
    const link = book.lookup(notation);
    assert.ok(link && link.playable === false, notation);
    assert.equal(link.src, src);
  }
  for (const n of notationsOf(after)) assert.ok(book.lookup(n), n);
  assert.equal(memory.snapshot().moments.length, 1);
  assertValid(after, [{ i: 0, kind: 'opp' }], 'punished');

  // The one notation of a brief that is not in the book (reported with the package): a moment that is older than the child's
  // previous move. The memory keeps notations only, so there are no squares to register it with; the markup then resolves it
  // loosely or prints it as plain text. Here the first move of the game is remembered as a slip (hand-set verdict).
  const older = createGameMemory(null);
  older.noteMine(0, { move: '炮二平五', cat: 'mistake', waited: true, self: true, packet: null, more: null });
  older.noteMine(2, { move: '炮五进四', cat: prev.cat, waited: true, self: true, packet: built.packet, more: built.more });
  const olderBook = bookOf(next);
  const remembered = buildTurnBrief(reportOf(next, { lastOpp: rivalTurn(fenAfterTry, refutation, 3), prev }), older, olderBook);
  assert.deepEqual(remembered.moments.map((m) => [m.n, m.move, m.tag]), [[1, '炮二平五', 'slip'], [2, '炮五进四', 'slip']]);
  assert.deepEqual([...new Set(notationsOf(remembered))].filter((n) => olderBook.lookup(n) === null), ['炮二平五']);
  assertValid(remembered, [{ i: 0, kind: 'opp' }], 'older moment');

  // Only a move that had something wrong with it left a hole. Hand-set: the verdict of the same real assessment. Had 炮五进四
  // been the best move there was (or a sound one), the capture of the cannon is not "上一步留了空子"; a slow move is blamed
  // for the piece it exposed even without a refutation.
  const verdict = (cat) => {
    const copy = clone(held);
    Object.assign(copy.assessment, { cat, isBest: cat === 'best', refutation: null });
    return buildTurnBrief(reportOf(next, { lastOpp: rivalTurn(fenAfterTry, refutation, 3), prev: { ...prev, cat, assessed: copy } }),
      createGameMemory(null), bookOf(next)).opp;
  };
  assert.ok(held.facts.exposed.some((e) => e.piece.type === 'cannon'));
  for (const cat of ['brilliant', 'best', 'good']) assert.ok(!('punishes' in verdict(cat)), cat);
  assert.equal(verdict('ok').punishes, true);

  // Had the rival played something else, the loss the packet predicted did not happen: so far the move took a pawn, no more.
  const other = mv('0010');                                           // 车1进1
  const spared = survey(boardToFen(applyMove(afterTry, other), 'red'), 4, 4);
  const calm = buildTurnBrief(reportOf(spared, { lastOpp: rivalTurn(fenAfterTry, other, 3), prev }), memory, bookOf(spared));
  assert.ok(!('punishes' in calm.opp));
  assert.deepEqual(calm.mine.try.cost, { gain: ['P'], lose: [], cp: 100 });
  assert.ok(calm.threats.some((t) => t.on && t.on.t === 'C' && t.move === '马7进5'));      // the cannon is still en prise
  assert.deepEqual(calm.mine.try.reply, built.more.reply);
  assert.deepEqual(calm.mine.try.flaws, built.packet.flaws);
});

// ---------------------------------------------------------------------------------------------------------------------
// 4.14.4 buildHintPacket
// ---------------------------------------------------------------------------------------------------------------------

test('hint packets: levels 1 and 2 contain no notation; level 3 registers its move as playable', () => {
  const { sv, turn, report, hint } = worked;
  const printed = fixture('hint.json').events;
  const book = bookOf(sv);
  const one = buildHintPacket(1, hint, { turn, report }, book);
  const two = buildHintPacket(2, hint, { turn, report }, book);
  assert.deepEqual(one, printed[1].hint);                            // section 9.4: { focus: develop, theme: develop }
  assert.deepEqual(two, printed[2].hint);                            // the horse still stands on file 二
  assert.deepEqual(notationsOf(one), []);
  assert.deepEqual(notationsOf(two), []);
  assert.equal(book.size(), 0);

  const three = buildHintPacket(3, hint, { turn, report }, book);
  assert.equal(three.move, '马二进三');
  assert.deepEqual(three.does[0], printed[3].hint.does[0]);          // named after the move, on file 三
  assert.equal(three.line.first, 'opp');
  assert.deepEqual(three.line.net, { gain: [], lose: [], cp: 0 });
  assert.equal(three.line.end, 'quiet');
  assert.ok(three.line.moves.length >= 1 && three.line.moves.length <= LIMITS.LINE_MOVES);
  const link = book.lookup('马二进三');
  assert.ok(link && link.playable === true && link.src === 'hint');
  for (const n of notationsOf(three)) assert.ok(book.lookup(n), n);
  const reply = book.lookup(three.line.moves[0]);
  assert.equal(reply.playable, false);
  assert.equal(reply.pre.length, 1);                                 // it follows the hinted move
  if (hint.alternatives[0]) assert.equal(three.alt, hint.alternatives[0].notation);
  assertValid(turn, [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'hint', level: 1, hint: one, said: 'none' },
    { i: 2, kind: 'hint', level: 2, hint: two, said: 'none' }, { i: 3, kind: 'hint', level: 3, hint: three }], 'pouches');

  // The table of 4.14.4, on the real hints of real positions.
  const themeOf = (fen, ply, move, depth = 3) => {
    const s = survey(fen, ply, depth);
    const h = hintFor({ fen: s.fen, ply, table: s.table, move, facts: s.facts, threat: s.threat });
    const r = reportOf(s);
    const t = buildTurnBrief(r, createGameMemory(null), bookOf(s));
    return { theme: h.theme, one: buildHintPacket(1, h, { turn: t, report: r }, bookOf(s)), two: buildHintPacket(2, h, { turn: t, report: r }, bookOf(s)) };
  };
  const mate = themeOf('3aka3/9/9/4C4/9/9/9/1C7/9/4K4 w', 40, mv('7174'));
  assert.equal(mate.theme, 'mate');
  assert.deepEqual(mate.one, { focus: 'finish', theme: 'mate' });
  const win = themeOf(ROOK_LIFT, 1, mv('2797'), 4);
  assert.equal(win.theme, 'win_material');
  assert.deepEqual(win.one, { focus: 'chance', theme: 'capture_free' });
  assert.deepEqual(win.two, { piece: { s: 'me', t: 'C', f: 8 }, area: 'their_back', theme: 'capture_free' });
  const fx = V1_COACH_FIXTURES.find((f) => f.name === 'block-check');
  const escape = themeOf(fx.fen, 30, mv(fx.move));
  assert.equal(escape.theme, 'escape_check');
  assert.deepEqual(escape.one, { focus: 'danger', theme: 'check' });
  const fork = themeOf('4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w', 40, mv('6344'));
  assert.equal(fork.theme, 'tactic');
  assert.deepEqual(fork.one, { focus: 'chance', theme: 'fork' });
  // save_piece: the theme says how the piece is saved. The rook that is attacked steps away ...
  const away = V1_COACH_FIXTURES.find((f) => f.name === 'rook-retreats-from-attack');
  const stepped = themeOf(away.fen, 30, mv(away.move));
  assert.equal(stepped.theme, 'save_piece');
  assert.deepEqual(stepped.one, { focus: 'danger', theme: 'escape' });
  // ... or another piece stands in the way: the rook shields the horse (v1 fixture "rook-shields-horse")
  const shield = V1_COACH_FIXTURES.find((f) => f.name === 'rook-shields-horse');
  const shielded = themeOf(shield.fen, 30, mv(shield.move));
  assert.equal(shielded.theme, 'save_piece');
  assert.deepEqual(shielded.one, { focus: 'danger', theme: 'block' });
  assert.deepEqual(shielded.two.piece, { s: 'me', t: 'R', f: 7 });
});

// ---------------------------------------------------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------------------------------------------------

test('every notation in every packet is registered in the book', () => {
  const { sv, report, memory, held, fine, hint } = worked;
  const book = bookOf(sv);
  const turn = buildTurnBrief(report, memory, book);
  const packets = [turn];
  const first = buildTryPacket(held, tryCtx(turn, report), book);
  const second = buildTryPacket(fine, tryCtx(turn, report, { prev: first.packet }), book);
  packets.push(first.packet, first.more, second.packet, second.more, buildHintPacket(3, hint, { turn, report }, book));
  // a tool verdict: 马二进三 and then the rival's 炮2平5 (section 9.7)
  const afterBest = applyMove(sv.board, worked.best);
  const reply = mv('2124');
  const tool = survey(boardToFen(afterBest, 'black'), 3, 4);
  const verdict = buildToolVerdict(assess(tool, reply), { seq: ['马二进三', '炮2平5'], who: 'opp', activeTry: first.packet, base: { board: sv.board, turn: 'red' } }, book);
  packets.push(verdict);
  const all = packets.flatMap((p) => notationsOf(p));
  assert.ok(all.length >= 12);
  for (const n of all) assert.ok(book.lookup(n) !== null, n);

  // The try is the first move of a line from the base position; its reply line starts after it; alternatives are playable.
  const tried = book.lookup('炮五进四');
  assert.deepEqual([tried.src, tried.playable, tried.pre.length], ['try', true, 0]);
  const answer = book.lookup('马7进5');
  assert.deepEqual([answer.src, answer.playable, answer.color, answer.pre.length], ['reply', false, 'black', 0]);
  assert.equal(book.lookup(first.more.reply.moves[1]).pre.length, 1);
  for (const alt of first.more.better) assert.equal(book.lookup(alt.move).playable, true, alt.move);
  assert.equal(book.lookup('马8进7').src, 'opp');
  // the rival's answer to the active try resolves loosely against the position after it (the book knows the try)
  assert.equal(book.resolveLoose('车9平8').color, 'black');

  // The verdict of section 9.7.
  const printed = fixture('ask-tools.json').events[2].tools[0].result.verdict;
  assert.deepEqual(verdict.seq, printed.seq);
  assert.equal(verdict.who, 'opp');
  // The contract prints cannon_mount for this move. On the board the central pawn is guarded by the horse that just went to 三
  // (it reaches (6,4) over the empty leg (7,5)), so taking it loses the cannon: the facts report no attack, and without a
  // ply (a tool verdict has none) there is no development either.
  assert.equal(printed.does[0].k, 'cannon_mount');
  assert.deepEqual(verdict.does, [{ k: 'quiet' }]);
  assert.deepEqual(verdict.flaws, []);
  assert.equal(verdict.reply.first, 'me');
  assert.ok(!('vsTry' in verdict));
  const toolLink = book.lookup('炮2平5');
  assert.deepEqual([toolLink.src, toolLink.playable, toolLink.pre.length], ['tool', false, 1]);
  assertValid(turn, [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'try', n: 1, try: first.packet, said: 'none' },
    { i: 2, kind: 'ask', ask: 'free', say: '如果我走马二进三，对方走炮2平5呢？',
      tools: [{ notation: '炮2平5', after: ['马二进三'], result: { id: 'call_7Qm2', ok: true, verdict } }] }], 'tool verdict');

  // The balance of a what-if is measured from the base position (section 3.6): "if I take the pawn with the cannon and the
  // horse takes back" is a pawn for a cannon, as in the packet of section 9.5, not a cannon lost for nothing.
  const afterTry = applyMove(sv.board, mv(HORSE_REPLY.trial));
  const taken = survey(boardToFen(afterTry, 'black'), 3, 4);
  const retake = assess(taken, mv(HORSE_REPLY.refutation));
  const alone = Math.round(-retake.assessment.outcome.net * 100);     // the balance of the horse's line alone, child's view
  assert.ok(alone <= -450);
  const whatIf = buildToolVerdict(retake, { seq: ['炮五进四', '马7进5'], who: 'opp', activeTry: null, base: { board: sv.board, turn: 'red' } }, bookOf(sv));
  assert.equal(whatIf.cost.gain[0], 'P');
  assert.ok(whatIf.cost.lose.includes('C'));
  assert.equal(whatIf.cost.cp, alone + 100);
  if (whatIf.reply) assert.deepEqual(whatIf.reply.net, whatIf.cost);
  assertValid(turn, [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'try', n: 1, try: first.packet, said: 'none' },
    { i: 2, kind: 'ask', ask: 'free', say: '然后呢', tools: [{ notation: '马7进5', after: ['炮五进四'], result: { id: 'call_1', ok: true, verdict: whatIf } }] }],
  'what-if from the base');

  // A what-if about a move of the child in the base position is compared with the trial on the board.
  const own = buildToolVerdict(fine, { seq: ['马二进三'], who: 'me', activeTry: first.packet, base: { board: sv.board, turn: 'red' } }, bookOf(sv));
  assert.equal(own.who, 'me');
  assert.equal(own.vsTry, 'better');
  assert.equal(own.reply.first, 'opp');
  assert.deepEqual(own.seq, ['马二进三']);
  // loose spellings are rewritten as the engine writes them
  assert.deepEqual(buildToolVerdict(fine, { seq: ['马２进３'], who: 'me', activeTry: null, base: { board: sv.board, turn: 'red' } }, bookOf(sv)).seq, ['马二进三']);

  // A sequence that does not lead from the base position to the assessed move never reaches the wire: the verdict names the
  // assessed move alone, which is in the book, and is not compared with the trial.
  for (const seq of [['车九进九'], ['炮五进四', '马7进5'], ['马八进七', '炮2平5', '马二进三'], [], undefined]) {
    const stray = bookOf(sv);
    const odd = buildToolVerdict(fine, { seq, who: 'me', activeTry: first.packet, base: { board: sv.board, turn: 'red' } }, stray);
    assert.deepEqual(odd.seq, ['马二进三'], J(seq));
    assert.ok(!('vsTry' in odd), J(seq));
    for (const n of notationsOf(odd)) assert.ok(stray.lookup(n) !== null, n);
    assertValid(turn, [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'try', n: 1, try: first.packet, said: 'none' },
      { i: 2, kind: 'ask', ask: 'free', say: '然后呢', tools: [{ notation: '马二进三', after: [], result: { id: 'call_2', ok: true, verdict: odd } }] }], 'stray seq');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 4.14.5 isEarned, worthSpeaking
// ---------------------------------------------------------------------------------------------------------------------

test('isEarned: tactical find, only move, tactic motif, deep reveal, avoided trap; a routine best move is not earned', () => {
  const { fine, held } = worked;
  const none = { found: false, avoided: null };
  assert.equal(fine.assessment.cat, 'best');
  assert.equal(isEarned(fine, none), false);                         // 马二进三: a developing move, nothing more
  assert.equal(isEarned(fine, { found: true, avoided: null }), true);
  assert.equal(isEarned(fine, { found: false, avoided: 'greedy' }), true);
  const only = clone(fine);
  only.assessment.flags.onlyMove = true;                             // hand-set flag
  assert.equal(isEarned(only, none), true);
  const deep = clone(fine);
  deep.assessment.revealBest = 3;                                    // hand-set reveal depth
  assert.equal(isEarned(deep, none), true);
  deep.assessment.revealBest = 2;
  assert.equal(isEarned(deep, none), false);
  // a tactic motif leads the effects: the free capture of the horse (real)
  const lift = survey(ROOK_LIFT, 1, 4);
  const capture = assess(lift, mv('2797'));
  assert.ok(capture.assessment.cat === 'best' || capture.assessment.cat === 'brilliant');
  assert.equal(isEarned(capture, none), true);
  assert.ok(TACTIC_MOTIFS.includes('capture_free'));
  // never for a move that is not best or brilliant
  assert.equal(isEarned(held, { found: true, avoided: 'greedy' }), false);
  const good = clone(only);
  good.assessment.cat = 'good';
  assert.equal(isEarned(good, { found: true, avoided: null }), false);
});

test('worthSpeaking: a good move with an empty does is not worth a sentence', () => {
  const base = { move: '马二进三', cat: 'good', loss: 20, held: false, eval: { b: 'even' }, does: [], flaws: [], cost: null, reply: null, toward: null, chance: 'none' };
  assert.equal(worthSpeaking(base, false), false);
  assert.equal(worthSpeaking({ ...base, does: [{ k: 'develop' }] }, false), false);
  assert.equal(worthSpeaking({ ...base, does: [{ k: 'quiet' }] }, false), false);
  assert.equal(worthSpeaking(base, true), true);
  assert.equal(worthSpeaking({ ...base, only: true }, false), true);
  assert.equal(worthSpeaking({ ...base, sac: true }, false), true);
  assert.equal(worthSpeaking({ ...base, repeat: true }, false), true);
  assert.equal(worthSpeaking({ ...base, chance: 'taken' }, false), true);
  assert.equal(worthSpeaking({ ...base, chance: 'missed' }, false), true);
  assert.equal(worthSpeaking({ ...base, avoided: 'greedy' }, false), true);
  for (const k of ['capture', 'capture_free', 'trade', 'check', 'mate', 'mate_threat', 'fork', 'discovered', 'pin', 'attack', 'cannon_mount', 'sacrifice',
    'cross_river']) {
    assert.equal(worthSpeaking({ ...base, does: [{ k }] }, false), true, k);
  }
  assert.equal(worthSpeaking({ ...base, cat: 'mistake' }, false), true);
  assert.equal(worthSpeaking({ ...base, cat: 'blunder', held: true }, false), false);     // a held trial gets its question, not a comment
  // the worked example of section 9.6: the event is recorded silently
  const { sv, turn, report, fine } = worked;
  assert.equal(worthSpeaking(buildTryPacket(fine, tryCtx(turn, report, { self: true }), bookOf(sv)).packet, isEarned(fine, { found: false, avoided: null })), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// 4.14.6 buildOverPacket
// ---------------------------------------------------------------------------------------------------------------------

/** A sample of the game skill; `first` and `final` default to one sound move. */
function sample(ply, more = {}) {
  const move = describeMove(START, mv('9776'));
  const one = { move, loss: 0, cat: 'good' };
  return { ply, first: one, final: one, tries: 1, hint: 0, hintMax: 0, self: true, bestCp: 0, legalCount: 40, test: null, danger: null, habit: null,
    avoided: null, patterns: [], captured: null, thinkMs: 1000, ...more };
}

function overInput(samples, takeaways, more = {}) {
  return { result: 'draw', reason: 'move_limit', finish: { profile: null, delta: 0, takeaways }, game: { samples }, rankBefore: 3, rankAfter: 3,
    goalPrev: null, history: [], humanColor: 'red', ...more };
}

test('buildOverPacket: lesson -> habit takeaway and goal; pattern -> idea; strength rules; kept; rank only on a rise; stats count only good things', () => {
  const sv = worked.sv;
  const greedyMove = worked.held.assessment.move;                     // 炮五进四, a capture
  const bestMove = worked.fine.assessment.move;                       // 马二进三
  const forkMove = describeMove(fenToBoard('4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w').board, mv('6344'));
  const tried = { move: greedyMove, loss: 350, cat: 'mistake' };
  const played = { move: bestMove, loss: 0, cat: 'best' };
  const samples = [
    sample(0, { final: { ...played, cat: 'brilliant' }, first: { ...played, cat: 'brilliant' }, captured: 'pawn' }),
    sample(2, { first: tried, final: played, tries: 2, danger: 'hangs_moved_piece', habit: 'greedy' }),
    sample(4, { first: { ...played, cat: 'ok' }, final: { ...played, cat: 'ok' } }),
    sample(6, { first: { ...played, cat: 'blunder' }, final: { ...played, cat: 'blunder' }, danger: 'slow', captured: 'horse' }),
    sample(34, { test: { tier: 2, kind: 'win', found: true }, patterns: ['fork_two'], final: played, first: played }),
    sample(36, { test: { tier: 1, kind: 'win', found: false } }),
    sample(38, { test: { tier: 1, kind: 'save', found: true } }),
  ];
  const takeaways = [
    { kind: 'highlight', ply: 34, move: forkMove, self: true },
    { kind: 'lesson', danger: 'hangs_moved_piece', count: 2, ply: 2, move: greedyMove },
    { kind: 'pattern', pattern: 'fork_two', ply: 34, move: forkMove },
  ];
  const history = [];
  history[2] = { move: null, color: 'red', by: 'child', notation: '马二进三', before: sv.board, record: plyRecord(sv.board, worked.best),
    flags: { check: false, mate: false, checkedKing: null, checkers: [], crossed: false } };
  const book = bookOf(sv);
  const out = buildOverPacket(overInput(samples, takeaways, { result: 'win', reason: 'resign', rankBefore: 3, rankAfter: 4, history }), book);

  // The packet of section 9.8, with the numbers of these samples.
  assert.deepEqual(out.packet, {
    result: 'win', reason: 'resign', moves: 7,
    stats: { good: 5, taken: 1, captures: 2, brilliant: 1 },         // good: brilliant + best + good; taken: found `win` tests
    takeaway: { kind: 'habit', code: 'greedy', n: 2, ex: { n: 2, move: '炮五进四', better: '马二进三' } },
    proud: { n: 18, s: 'me', move: '马六进五', tag: 'great', k: 'fork' },
    goal: 'greedy', kept: null, rank: { to: 4 },
  });
  assert.equal(out.goal, 'greedy');
  assert.equal(out.kept, null);
  assert.equal(out.proudPly, 34);
  for (const n of notationsOf(out.packet)) assert.ok(book.lookup(n), n);
  assert.equal(book.lookup('炮五进四').src, 'moment');
  assertValid(worked.turn, [{ i: 0, kind: 'over', over: out.packet }], 'over');

  // lesson: the habit of the danger (HABIT_OF_DANGER); `greedy` only for a capture that hung the capturing piece
  const habitOf = (danger, move) => buildOverPacket(overInput(samples, [{ kind: 'lesson', danger, count: 1, ply: 2, move }]), bookOf(sv)).packet.takeaway;
  assert.equal(habitOf('hangs_moved_piece', bestMove).code, 'hang_piece');
  assert.equal(habitOf('leaves_hanging', bestMove).code, 'miss_threat');
  assert.equal(habitOf('misses_win', bestMove).code, 'miss_capture');
  assert.equal(habitOf('misses_mate', bestMove).code, 'miss_mate');
  assert.equal(habitOf('bad_trade', greedyMove).code, 'bad_trade');
  // a lesson without a habit (slow) gives way to the next takeaway
  const slow = buildOverPacket(overInput(samples, [{ kind: 'lesson', danger: 'slow', count: 3, ply: 6, move: bestMove },
    { kind: 'pattern', pattern: 'fork_two', ply: 34, move: forkMove }]), bookOf(sv));
  assert.deepEqual(slow.packet.takeaway, { kind: 'idea', code: 'fork_two' });
  assert.equal(slow.goal, null);
  assert.equal(slow.packet.proud, null);
  assert.equal(slow.proudPly, null);
  // `better` only when the child went on to play a sound move
  const stubborn = samples.map((s) => (s.ply === 2 ? { ...s, final: tried } : s));
  assert.deepEqual(buildOverPacket(overInput(stubborn, takeaways), bookOf(sv)).packet.takeaway.ex, { n: 2, move: '炮五进四' });

  // strengths, first that applies: a mate the child played, two found chances, two saves, a steady game
  const quiet = Array.from({ length: 15 }, (_, k) => sample(2 * k));
  const strength = (list, more) => buildOverPacket(overInput(list, [], more), bookOf(sv)).packet.takeaway;
  assert.deepEqual(strength(quiet, { result: 'win', reason: 'checkmate' }), { kind: 'strength', code: 'S_finish' });
  const found = (kind) => ({ test: { tier: 1, kind, found: true } });
  assert.deepEqual(strength([sample(0, found('win')), sample(2, found('win')), sample(4, found('save')), sample(6, found('save'))]),
    { kind: 'strength', code: 'S_tactics' });
  assert.deepEqual(strength([sample(0, found('win')), sample(2, found('save')), sample(4, found('save'))]), { kind: 'strength', code: 'S_defense' });
  assert.deepEqual(strength(quiet), { kind: 'strength', code: 'S_steady' });
  assert.equal(strength(quiet.slice(0, 14)), null);
  assert.equal(strength(quiet.map((s, k) => (k === 3 ? { ...s, final: { ...s.final, cat: 'blunder' } } : s))), null);
  assert.equal(strength(quiet, { result: 'loss', reason: 'checkmate' }).code, 'S_steady');   // the mate was not the child's

  // kept: null without a goal or with fewer than ten samples; else whether the habit stayed away
  const kept = (list, goalPrev) => buildOverPacket(overInput(list, [], { goalPrev }), bookOf(sv)).kept;
  assert.equal(kept(quiet, null), null);
  assert.equal(kept(quiet.slice(0, 9), 'greedy'), null);
  assert.equal(kept(quiet, 'greedy'), true);
  assert.equal(kept(quiet.map((s, k) => (k === 5 ? { ...s, habit: 'greedy' } : s)), 'greedy'), false);
  assert.equal(kept(quiet.map((s, k) => (k === 5 ? { ...s, habit: 'miss_threat' } : s)), 'greedy'), true);

  // rank only on a rise
  const rank = (before, after) => buildOverPacket(overInput(quiet, [], { rankBefore: before, rankAfter: after }), bookOf(sv)).packet.rank;
  assert.equal(rank(3, 3), null);
  assert.equal(rank(4, 3), null);
  assert.deepEqual(rank(3, 5), { to: 5 });

  // nothing at all: a game with no move
  const empty = buildOverPacket(overInput([], []), bookOf(sv));
  assert.deepEqual(empty.packet, { result: 'draw', reason: 'move_limit', moves: 0, stats: { good: 0, taken: 0, captures: 0, brilliant: 0 },
    takeaway: null, proud: null, goal: null, kept: null, rank: null });
  assertValid(worked.turn, [{ i: 0, kind: 'over', over: empty.packet }], 'empty over');
});

// ---------------------------------------------------------------------------------------------------------------------
// oppCaption, buildRecap
// ---------------------------------------------------------------------------------------------------------------------

test('oppCaption is the notation plus a term of at most four characters', () => {
  // section 9.3: the name of the opening
  const sv = survey(SAME_CANNONS.fen, 2, 4);
  const same = buildTurnBrief(reportOf(sv, { lastOpp: rivalTurn(AFTER_CENTRAL_CANNON, mv('2724'), 1) }), createGameMemory(null), bookOf(sv));
  assert.equal(oppCaption(same), '【炮8平5】顺炮');
  assert.equal(oppCaption(worked.turn), '【马8进7】起马局');
  // no name: the term of the leading effect. 车9平8 on the third move develops the rook.
  let board = START;
  for (const code of ['7774', '0726', '9776']) board = applyMove(board, mv(code));
  const before = boardToFen(board, 'black');
  const rook = mv('0807');
  const next = survey(boardToFen(applyMove(board, rook), 'red'), 4, 3);
  const turn = buildTurnBrief(reportOf(next, { lastOpp: rivalTurn(before, rook, 3) }), createGameMemory(null), bookOf(next));
  assert.ok(!('name' in turn.opp));
  assert.equal(turn.opp.does[0].k, 'develop');
  assert.equal(oppCaption(turn), '【车9平8】出子');
  // every caption: 【notation】 and at most four characters
  for (const t of [same, worked.turn, turn]) {
    const m = /^【([^】]+)】(.*)$/u.exec(oppCaption(t));
    assert.ok(m && NOTATION_RE.test(m[1]) && [...m[2]].length >= 1 && [...m[2]].length <= 4, oppCaption(t));
  }
  for (const term of [...Object.values(MOTIF_TERM), ...Object.values(PATTERN_NAME)]) assert.ok([...term].length <= 4, term);
  // no rival move, no caption
  assert.equal(oppCaption(buildTurnBrief(reportOf(survey(START_FEN, 0, 2)), createGameMemory(null), createMoveBook({ board: START, turn: 'red' }))), '');
});

test('the opening name is reported on the move that changes it', () => {
  // 1. 炮二平五 马8进7 2. 马二进三 马2进3: the second horse makes 屏风马; the move after it changes nothing.
  let board = START;
  for (const code of ['7774', '0726', '9776']) board = applyMove(board, mv(code));
  const second = mv('0122');
  const sv = survey(boardToFen(applyMove(board, second), 'red'), 4, 3);
  const turn = buildTurnBrief(reportOf(sv, { lastOpp: rivalTurn(boardToFen(board, 'black'), second, 3) }), createGameMemory(null), bookOf(sv));
  assert.equal(turn.opp.name, 'screen_horses');
  board = applyMove(applyMove(board, second), mv('9897'));          // 3. 车一平二
  const third = mv('0010');                                           // 车1进1
  const later = survey(boardToFen(applyMove(board, third), 'red'), 6, 3);
  const quiet = buildTurnBrief(reportOf(later, { lastOpp: rivalTurn(boardToFen(board, 'black'), third, 5) }), createGameMemory(null), bookOf(later));
  assert.ok(!('name' in quiet.opp));
  // red as the rival: 1. 炮二平五 is 当头炮 for a child who plays black
  const first = survey(AFTER_CENTRAL_CANNON, 1, 3);
  const black = buildTurnBrief(reportOf(first, { lastOpp: rivalTurn(START_FEN, mv('7774'), 0) }), createGameMemory(null), bookOf(first));
  assert.equal(black.me, 'black');
  assert.equal(black.opp.name, 'central_cannon');
  assert.deepEqual(black.opp.does[0], { k: 'cannon_mount', by: { s: 'opp', t: 'C', f: 5 }, on: { s: 'me', t: 'P', f: 5 }, on2: { s: 'opp', t: 'P', f: 5 } });
  // not an opening name: the pattern the move played (捉双)
  const forkBefore = '4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w';
  const forked = survey(boardToFen(applyMove(fenToBoard(forkBefore).board, mv('6344')), 'black'), 41, 3);
  const child = buildTurnBrief(reportOf(forked, { lastOpp: rivalTurn(forkBefore, mv('6344'), 40) }), createGameMemory(null), bookOf(forked));
  assert.equal(child.opp.name, 'fork_two');
  assert.equal(oppCaption(child), '【马六进五】捉双');
  assert.deepEqual(child.opp.does[0], { k: 'fork', by: { s: 'opp', t: 'H', f: 5 }, on: { s: 'me', t: 'R', f: 4 }, on2: { s: 'me', t: 'R', f: 6 }, name: 'fork_two' });
});

test('buildRecap lists the tries of the turn, the highest pouch and the current trial', () => {
  const { sv, turn, report, held, fine, hint } = worked;
  const first = buildTryPacket(held, tryCtx(turn, report), bookOf(sv)).packet;
  const last = buildTryPacket(fine, tryCtx(turn, report, { prev: first }), bookOf(sv)).packet;
  const events = [
    { i: 0, kind: 'opp', said: 'none' },
    { i: 1, kind: 'hint', level: 1, hint: buildHintPacket(1, hint, { turn, report }, bookOf(sv)), said: 'local', v: 0 },
    { i: 2, kind: 'try', n: 1, try: first, said: 'local', v: 3 },
    { i: 3, kind: 'ask', ask: 'reply', said: 'local', v: 0 },
    { i: 4, kind: 'try', n: 2, try: last, said: 'none' },
  ];
  const recap = buildRecap(events);
  assert.deepEqual(recap.tries, [{ move: '炮五进四', cat: first.cat }, { move: '马二进三', cat: 'best' }]);
  assert.equal(recap.hint, 1);
  assert.deepEqual(recap.cur, last);
  assert.notEqual(recap.cur, last);                                  // a copy
  assertValid(turn, [{ i: 0, kind: 'recap', recap, said: 'none' }, { i: 5, kind: 'ask', ask: 'good' }], 'recap');
  // an earlier recap is folded in; at most eight tries, the most recent ones
  const many = Array.from({ length: 9 }, (_, k) => ({ i: k + 1, kind: 'try', n: k + 1, try: k % 2 ? last : first, said: 'none' }));
  const again = buildRecap([{ i: 0, kind: 'recap', recap, said: 'none' }, { i: 1, kind: 'hint', level: 3, hint: {}, said: 'none' }, ...many]);
  assert.equal(again.tries.length, LIMITS.RECAP_TRIES);
  assert.equal(again.hint, 3);
  assert.deepEqual(again.cur, first);
  assert.deepEqual(again.tries[again.tries.length - 1], { move: first.move, cat: first.cat });
  assert.deepEqual(buildRecap([]), { tries: [], hint: 0 });
  // the move of `cur` is the last entry of the tries also when an earlier recap (built elsewhere) did not list it there:
  // the rendered block of the current trial does not name its move
  const foreign = { tries: [{ move: '兵三进一', cat: 'ok' }], hint: 2, cur: first };
  const folded = buildRecap([{ i: 0, kind: 'recap', recap: foreign, said: 'none' }, { i: 1, kind: 'ask', ask: 'good', said: 'none' }]);
  assert.deepEqual(folded.tries, [{ move: '兵三进一', cat: 'ok' }, { move: first.move, cat: first.cat }]);
  assert.equal(folded.hint, 2);
  assert.deepEqual(folded.cur, first);
});
