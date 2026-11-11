// Unit tests of src/core/brain.js and src/core/search-worker.js (contract sections 4.8, 4.9, 6 and 14.1).
//
// The brain runs here directly (createBrain(), no worker), on real search, facts and teacher. Nothing depends on the
// speed of the machine: the brain and the search read the time from the global `performance.now()`, and this file
// replaces that global by a virtual clock that advances by a fixed step every time it is read. The search reads it once
// per 2048 nodes, so a time budget becomes a node budget and every job gives the same result on every machine.
// The step during createBrain() decides the calibration, hence the plan row (fast / mid / slow). The clock can also
// jump ahead at a chosen read, which is how a test lets a budget run out at an exact point of a job. The real clock is
// put back when the file is done (node --test runs every test file in a process of its own, so no other file sees it).
//
// teacher.js decides which rival move is played; its overlook and gift rules are tuned separately, so these tests pin
// the plumbing around the choice (what goes in, what comes back, budgets, cancellation, determinism) and never which
// gift is chosen. Expected values come from the contract, from the rules engine, or from an independent search: for the
// search requests of a job, from a plain searcher that is asked what section 4.8.2 lists (the "twins" below).
//
// The last two tests start the real worker file in Node worker threads (real clock) and check the protocol of 4.9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createBrain, PLAN, planFor } from '../../../src/core/brain.js';
import { applyMove, boardToFen, fenToBoard, getLegalMoves, isInCheck, judgeMove, moveToNotation, plyRecord, positionKey } from '../../../src/core/engine.js';
import { assessMove, habitTraps, materialOutcome, moveFacts, positionFacts, tacticalTest, threatInfo } from '../../../src/core/facts.js';
import { MATE, WIN, createSearcher, lineOf, mateIn, scoreToCp } from '../../../src/core/search.js';
import { chooseTeachingMove, createGameSkill, createSkillProfile, recordOpponentMove, teachingContext, tension } from '../../../src/core/teacher.js';
import { mulberry32, playout } from '../../helpers/playout.js';
import { COACH_EXAMPLE_POSITIONS, REFERENCE_POSITIONS } from '../../helpers/positions.js';

// ---------------------------------------------------------------------------------------------------------------
// the virtual clock
// ---------------------------------------------------------------------------------------------------------------

/** Step per read while jobs run: 2048 nodes per 4 ms, about half a million nodes per virtual second. */
const TICK = 4;
/** Step during createBrain(): perft(3) has 79 666 leaves, so 4 ms reads as 19.9 M nodes/s, 40 ms as 2.0 M, 100 ms as 0.8 M. */
const CALIBRATION_TICK = { fast: 4, mid: 40, slow: 100 };
const realPerformance = globalThis.performance;
/** `reads` counts the reads; at read number `jumpAtRead` the clock jumps `jump` ms ahead (once). */
const clock = { now: 0, tick: TICK, reads: 0, jumpAtRead: -1, jump: 0 };
globalThis.performance = /** @type {any} */ ({
  now: () => {
    clock.now += clock.tick;
    if (++clock.reads === clock.jumpAtRead) clock.now += clock.jump;
    return clock.now;
  },
});
test.after(() => {
  globalThis.performance = realPerformance;
});

/** A fresh brain (empty transposition table) whose calibration lands in the given speed class. */
function brainOf(speedClass = 'fast') {
  clock.tick = CALIBRATION_TICK[speedClass];
  const brain = createBrain();
  clock.tick = TICK;
  assert.equal(brain.speed.speedClass, speedClass);
  return brain;
}

/**
 * Runs `job` on the clock with one jump: `jump` ms at the read number `atRead`, counted from the start of the job.
 * (Create the brain before: its calibration reads the clock too.)
 */
async function withJump(atRead, jump, job) {
  clock.reads = 0;
  clock.jumpAtRead = atRead;
  clock.jump = jump;
  try {
    return await job();
  } finally {
    clock.jumpAtRead = -1;
    clock.jump = 0;
  }
}

/** Runs one job and returns its result with the virtual time it took. */
async function timed(job) {
  const from = clock.now;
  const result = await job();
  return { result, ms: clock.now - from };
}

// ---------------------------------------------------------------------------------------------------------------
// helpers and positions
// ---------------------------------------------------------------------------------------------------------------

/** A time budget that never binds. */
const FOREVER = 3_600_000;
const ref = code => ({ from: { row: Number(code[0]), col: Number(code[1]) }, to: { row: Number(code[2]), col: Number(code[3]) } });
const codeOf = move => `${move.from.row}${move.from.col}${move.to.row}${move.to.col}`;
const other = color => (color === 'red' ? 'black' : 'red');
const sameMove = (a, b) => codeOf(a) === codeOf(b);
/** What a job rejected with (fails when it resolved). */
const rejection = promise => promise.then(() => assert.fail('the job should have rejected'), error => error);
/** A yield hook for a JobControl: a real task of the event loop. */
const nextTask = () => new Promise(resolve => setImmediate(resolve));
/** The verdict thresholds of section 4.6.1 with k = 1. */
const catOf = loss => (loss > 300 ? 'blunder' : loss > 120 ? 'mistake' : loss > 50 ? 'ok' : loss > 15 ? 'good' : 'best');
/** MoveInfo of a move, built from the rules engine alone. */
function infoOf(board, move) {
  const piece = board[move.from.row][move.from.col];
  const captured = board[move.to.row][move.to.col];
  return { from: move.from, to: move.to, notation: moveToNotation(board, move), piece: piece.type, color: piece.color, captured: captured ? captured.type : null };
}

const START = REFERENCE_POSITIONS.opening;
/** The worked example of section 9 (after 1. 炮二平五 马8进7) with black's left rook on (7,2): the red horse on (9,1) takes it for
 *  nothing (马八进七), nothing else comes near, and 炮五进四 takes a pawn that the horse on (2,6) guards. Red to move. */
const HANGING_ROOK = '1nbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1Cr1C4/9/RNBAKABNR w';
/** The start position with red's left horse already on (5,2). 马七进五 puts it on (4,4), in front of the black pawn on (3,4),
 *  where nothing of red's guards it. Red to move. */
const HORSE_OUT = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/2N6/P1P1P1P1P/1C5C1/9/R1BAKABNR w';
const HORSE_TO_PAWN = ref('5244');
/** The start position with black's right horse on (7,3), where it checks the red king and cannot be taken. Red to move. */
const IN_CHECK = 'rnbakab1r/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C1n3C1/9/RNBAKABNR w';
/** Three red rooks around the black king: 车九平五 mates at once (v1 fixture 'rook-mate'). Red to move. */
const MATE_IN_ONE = '4k4/3R1R3/R8/9/9/4P4/9/9/9/4K4 w';
/** The same picture with the colours swapped: 车1平5 mates the red king at once. Black to move. */
const RIVAL_MATES = '4k4/9/9/9/4p4/9/9/r8/3r1r3/4K4 b';
/** Black is checkmated: the rook on (8,3) gives check, the other two take the flights away. Black to move. */
const MATED = '3k5/9/9/9/9/9/9/9/3R1R3/4RK3 b';
/** The red rook on (9,3) checks the black king, which has one flight and no other move: 将4平5. Black to move. */
const ONE_ANSWER = '3k5/9/9/9/9/9/9/9/9/3R1K3 b';
/** A quiet ending (a horse and two pawns against a horse and a pawn, fifteen legal moves, no mate in sight). A search of it
 *  reaches every depth of the plan long before its budget ends, so here the depth limits decide and not the clock. Red to move. */
const ENDING = '3ak4/4a4/4b4/9/2p3n2/9/2P3P2/4B1N2/4A4/3AK4 w';
/**
 * REFERENCE_POSITIONS.middlegameA (red to move) with a game behind it: red's horse went out (马七进六, the move a short
 * search of the position likes best), black's rook stepped forward, the horse came back and so did the rook. So 马七进六
 * would bring a position of the game about for the second time.
 */
const HORSE_SHUFFLE = shuffle(REFERENCE_POSITIONS.middlegameA, 'red', '7253', ['0010', '5372', '1000']);

/**
 * A game that ends in the position `fen`: it starts in the position that the move `repeating` of `mover` would lead to
 * from `fen`, and the moves `back` lead from there to `fen`, each of them legal. `history` lists the positions before
 * each of those moves, as a payload carries them.
 */
function shuffle(fen, mover, repeating, back) {
  let board = applyMove(fenToBoard(fen).board, ref(repeating)), side = other(mover);
  const history = [];
  for (const code of back) {
    assert.ok(getLegalMoves(board, side).some(move => codeOf(move) === code), `${code} is legal`);
    history.push(boardToFen(board, side));
    board = applyMove(board, ref(code));
    side = other(side);
  }
  assert.equal(boardToFen(board, side), fen, 'the moves lead to the position');
  return { fen, history, repeating: ref(repeating) };
}

const surveyPayload = (fen, extra = {}) => ({ fen, history: [], ply: 10, level: 3, tensionPrev: 0.1, evalTwoPliesAgo: null, ...extra });

/** Runs a survey and records its progress. */
async function surveyWithProgress(brain, payload) {
  const events = [];
  const survey = await brain.survey(payload, { cancelled: false, onProgress: (stage, data) => events.push({ stage, data }) });
  return { survey, events };
}

// The twins: the searches section 4.8.2 lists for a job, asked of a plain searcher with an empty table, in the job's
// order and with the job's own reads of the clock. On the virtual clock a job on a fresh brain runs exactly these
// searches, read for read, so what the job reports must be built from exactly these results. That pins every depth,
// budget and option of the job's requests, and the history its searches are given. (One request is not pinned in that
// respect: a search that starts with a pass does not look for repetitions behind the pass, so the history of the threat
// search changes nothing that a ThreatInfo shows.)

/** Steps 2 to 4 of a survey of a position that is not in check. */
async function surveyTwin(plan, fen, history) {
  const twin = createSearcher();
  const reported = [];
  const listen = { cancelled: false, onDepth: table => reported.push(table) };        // the job's table searches report every iteration
  const started = performance.now();
  const request = { fen, history, allDepth: plan.allDepth, multiPV: 6, maxDepth: plan.allDepth, timeMs: 400 };
  const shallow = await twin.analyze(request, listen);
  const shallowTables = reported.splice(0).filter(table => table.depth >= 2);
  const pass = await twin.analyze({ fen, history, pass: true, multiPV: 1, maxDepth: plan.threatDepth, timeMs: plan.threatMs });
  const remaining = plan.surveyMs - (performance.now() - started);
  const deep = await twin.analyze({ ...request, maxDepth: plan.surveyDepth, timeMs: remaining }, listen);
  return { shallow, shallowTables, pass, deep, deepTables: reported.filter(table => table.depth > shallow.depth), table: deep.depth > shallow.depth ? deep : shallow };
}

/** Steps 1, 2 and 4 of an assessment: the comparison move, the pair and the rival's answers. */
function assessTwin(plan, { fen, history, move, table, compare }) {
  const twin = createSearcher();
  const { board, turn } = fenToBoard(fen);
  let against = compare;
  if (against === null) {
    against = table !== null && table.depth >= 2 ? table.lines[0].move : twin.analyzeSync({ fen, history, timeMs: 150 }).lines[0].move;
  }
  const D = Math.max(table === null ? 0 : table.depth, plan.assessDepth);
  const readsBefore = clock.reads;
  const pair = twin.analyzeSync({
    fen, history, rootMoves: sameMove(against, move) ? [move] : [against, move], allDepth: D, maxDepth: D, minDepth: Math.min(D, 4), timeMs: plan.assessMs,
  });
  const pairReads = clock.reads - readsBefore;
  const after = applyMove(board, move);
  const quiet = board[move.to.row][move.to.col] === null;
  const answers = twin.analyzeSync({ fen: boardToFen(after, other(turn)), history: quiet ? [...history, fen] : [], multiPV: 3, maxDepth: D - 1, timeMs: 150 });
  return { compare: against, D, pair, pairReads, answers, replies: answers.lines.filter(line => line.depth === answers.depth).slice(0, 3) };
}

/** An assessment is the one facts.js makes of the twin's pair, and its replies are the twin's answers. */
function assertAssessedLikeTwin(assessed, twin, payload, what) {
  const { fen, move, table, level, ply } = payload;
  const { board, turn } = fenToBoard(fen);
  assert.deepEqual(assessed.assessment, assessMove({ fen, move, pair: twin.pair, table, level, compare: twin.compare }), `${what}: the assessment`);
  assert.deepEqual(assessed.facts, moveFacts(fen, move, { ply }), `${what}: the facts of the move`);
  const after = applyMove(board, move);
  const fenAfter = boardToFen(after, other(turn));
  assert.deepEqual(assessed.replies.map(reply => codeOf(reply.move)), twin.replies.map(line => codeOf(line.move)), `${what}: the rival's answers`);
  assessed.replies.forEach((reply, index) => {
    assert.deepEqual(reply.move, infoOf(after, reply.move));
    assert.equal(reply.line.start, fenAfter);
    assert.deepEqual(reply.line.moves.map(codeOf), twin.replies[index].pv.map(codeOf), `${what}: the line of answer ${index + 1}`);
    assert.deepEqual(reply.outcome, materialOutcome(reply.line, turn), `${what}: the outcome of answer ${index + 1} is the mover's`);
    assert.deepEqual(reply.facts, moveFacts(fenAfter, reply.move, { ply: ply + 1 }));
    assertLineEnd(reply.line, 8, `${what}: answer ${index + 1}`);
  });
}

/**
 * What the rules engine alone says about the position at the end of a line: whether the side to move can take
 * something, and whether it can take a piece that stands where nothing can take back (a capture that wins material).
 */
function pendingAt(line) {
  let { board, turn } = fenToBoard(line.start);
  for (const move of line.moves) {
    board = applyMove(board, move);
    turn = other(turn);
  }
  const captures = getLegalMoves(board, turn).filter(move => board[move.to.row][move.to.col] !== null);
  const free = captures.some(move => {
    const after = applyMove(board, move);
    return getLegalMoves(after, other(turn)).every(reply => reply.to.row !== move.to.row || reply.to.col !== move.to.col);
  });
  return { capture: captures.length > 0, free };
}

/** How often assertLineEnd has seen a line of full length that is cut, and one that is settled with nothing left to take. */
const lineEnds = { cut: 0, settled: 0 };

/**
 * `end` of a Line made of a search PV (section 3.1): 'cut' means the PV was truncated (it has `full` moves, the length the
 * search cuts it at) while a capture was pending. So a cut line has full length and something to take at its end; a line
 * of full length that ends with a piece free to take is cut; and one with nothing to take at its end is not.
 */
function assertLineEnd(line, full, what) {
  assert.ok(['quiet', 'check', 'mate', 'cut'].includes(line.end), `${what}: end ${line.end}`);
  const at = pendingAt(line);
  if (line.end === 'cut') {
    assert.equal(line.moves.length, full, `${what}: a cut line has the full length`);
    assert.ok(at.capture, `${what}: a cut line has a capture pending`);
    lineEnds.cut++;
  } else if (line.moves.length === full && line.end !== 'mate') {
    assert.ok(!at.free, `${what}: a line of full length that ends with a piece free to take is cut`);
    if (!at.capture) lineEnds.settled++;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------------------------------------------

test('PLAN has the three rows of 4.8.1', () => {
  assert.deepEqual(PLAN, {
    fast: { allDepth: 5, surveyDepth: 9, surveyMs: 1200, threatDepth: 5, threatMs: 60, assessDepth: 7, assessMs: 300, opponentDepth: 8, thinkMs: 500, verifyMs: 250 },
    mid: { allDepth: 4, surveyDepth: 8, surveyMs: 1500, threatDepth: 4, threatMs: 100, assessDepth: 6, assessMs: 400, opponentDepth: 7, thinkMs: 700, verifyMs: 350 },
    slow: { allDepth: 3, surveyDepth: 6, surveyMs: 1800, threatDepth: 3, threatMs: 150, assessDepth: 5, assessMs: 600, opponentDepth: 6, thinkMs: 900, verifyMs: 450 },
  });
  for (const speedClass of ['fast', 'mid', 'slow']) assert.equal(planFor(speedClass), PLAN[speedClass]);
  assert.throws(() => planFor(/** @type {any} */ ('turbo')), RangeError);
});

test('createBrain: the plan row follows the calibrated speed class, and each class keeps its depths and budgets', async () => {
  for (const speedClass of ['fast', 'mid', 'slow']) {
    const brain = brainOf(speedClass);
    const plan = PLAN[speedClass];
    assert.ok(Number.isInteger(brain.speed.perftNps) && brain.speed.perftNps > 0);

    const run = await timed(() => surveyWithProgress(brain, surveyPayload(REFERENCE_POSITIONS.middlegameA)));
    const { survey, events } = run.result;
    const threatAt = events.findIndex(event => event.stage === 'threat');
    const shallow = events.slice(0, threatAt).filter(event => event.stage === 'table').map(event => event.data);
    const deep = events.slice(threatAt + 1).map(event => event.data);
    // the shallow table: every root move exact, never deeper than allDepth
    for (const table of shallow) assert.ok(table.allDepth === table.depth && table.depth <= plan.allDepth, `${speedClass}: shallow depth ${table.depth}`);
    // the deep table: at most surveyDepth, every root move exact up to allDepth only
    for (const table of deep) assert.ok(table.depth <= plan.surveyDepth && table.allDepth <= plan.allDepth, `${speedClass}: deep depth ${table.depth}`);
    assert.ok(survey.table.depth <= plan.surveyDepth);
    assert.ok(run.ms <= 2 * plan.surveyMs + 500, `${speedClass}: the survey took ${run.ms} virtual ms`);

    const assessed = await timed(() => brain.assess({ fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: null, level: 3, compare: null }));
    // D = max(table depth, assessDepth) with minDepth min(D, 4)
    assert.ok(assessed.result.assessment.depth >= 4 && assessed.result.assessment.depth <= plan.assessDepth, `${speedClass}: assess depth`);
    assert.ok(assessed.ms <= 2 * plan.assessMs + 500, `${speedClass}: the assessment took ${assessed.ms} virtual ms`);
  }
});

test('createBrain({ttBits}) sizes the transposition table and analyze is the raw search', async () => {
  clock.tick = CALIBRATION_TICK.fast;
  const small = createBrain({ ttBits: 8 });
  clock.tick = TICK;
  const request = { fen: REFERENCE_POSITIONS.middlegameA, maxDepth: 4, minDepth: 4, allDepth: 2, multiPV: 3, timeMs: FOREVER };
  const analysis = await small.analyze(request);
  assert.equal(analysis.fen, request.fen);
  assert.equal(analysis.depth, 4);
  assert.equal(analysis.allDepth, 2);
  assert.equal(analysis.stopped, 'depth');
  assert.equal(analysis.lines.length, getLegalMoves(fenToBoard(request.fen).board, 'red').length);
  assert.equal(analysis.lines.filter(line => line.depth === 4).length, 3, 'the three best moves are exact at the last depth');
  // a table of 256 entries and one of 262 144 walk different trees, and agree on the best move of this position within a tolerance
  const large = await brainOf('fast').analyze(request);
  assert.notEqual(analysis.nodes, large.nodes);
  assert.ok(Math.abs(scoreToCp(analysis.lines[0].score) - scoreToCp(large.lines[0].score)) <= 40);
  // the same request through the plain searcher gives the same answer as the brain's
  const direct = createSearcher().analyzeSync(request);
  assert.deepEqual(large.lines, direct.lines);
});

// ---------------------------------------------------------------------------------------------------------------
// survey
// ---------------------------------------------------------------------------------------------------------------

test('survey: progress order facts, table, threat, table; table depths strictly increase; threat progress is sent even when null', async () => {
  const brain = brainOf('fast');
  const fen = REFERENCE_POSITIONS.middlegameA;
  const { survey, events } = await surveyWithProgress(brain, surveyPayload(fen));
  assert.match(events.map(event => event.stage).join(' '), /^facts( table)+ threat( table)+$/);

  // facts first, and they are the facts of the position with its ply
  assert.deepEqual(events[0].data, positionFacts(fen, { ply: 10 }));
  assert.deepEqual(survey.facts, events[0].data);

  // every table from depth 2 on, each deeper than the one before, each with every legal move
  const tables = events.filter(event => event.stage === 'table').map(event => event.data);
  const legal = getLegalMoves(fenToBoard(fen).board, 'red').length;
  assert.equal(tables[0].depth, 2);
  for (let i = 1; i < tables.length; i++) assert.ok(tables[i].depth > tables[i - 1].depth, 'table depths strictly increase');
  for (const table of tables) assert.equal(table.lines.length, legal);
  // the result carries the deepest table
  const last = tables[tables.length - 1];
  assert.equal(survey.table.depth, last.depth);
  assert.deepEqual(survey.table.lines, last.lines);
  assert.equal(survey.fen, fen);

  // the threat lies between the shallow and the deep table and is the one of the result
  const threat = events.find(event => event.stage === 'threat');
  assert.notEqual(threat.data, null);
  assert.deepEqual(survey.threat, threat.data);
  assert.equal(threat.data.line.moves[0].color, 'black', 'the threat line starts with the rival\'s move');

  // in check there is no pass search, and the null threat is still reported
  const checked = await surveyWithProgress(brain, surveyPayload(IN_CHECK));
  assert.match(checked.events.map(event => event.stage).join(' '), /^facts( table)+ threat( table)*$/);
  assert.notEqual(checked.survey.facts.check, null);
  assert.equal(checked.events.find(event => event.stage === 'threat').data, null);
  assert.equal(checked.survey.threat, null);
  const depths = checked.events.filter(event => event.stage === 'table').map(event => event.data.depth);
  for (let i = 1; i < depths.length; i++) assert.ok(depths[i] > depths[i - 1]);

  // a mate on the board stops the shallow table (A3.3) and no deeper table is searched
  const mate = await surveyWithProgress(brain, surveyPayload(MATE_IN_ONE));
  assert.deepEqual(mate.events.map(event => (event.stage === 'table' ? `table ${event.data.depth}` : event.stage)), ['facts', 'table 2', 'table 3', 'threat']);
  assert.equal(mate.survey.table.stopped, 'mate');
  assert.equal(mate.survey.table.lines[0].mate, 1);
  assert.equal(mate.survey.moves[0].notation, '车九平五');
});

test('survey on a position with a hanging rook: test is tier 1; traps lists greedy when a losing capture exists', async () => {
  const brain = brainOf('fast');
  const { result: survey, ms } = await timed(() => brain.survey(surveyPayload(HANGING_ROOK, { ply: 4 })));
  // the premise, from the rules engine: the horse takes the rook, and no black piece can take back on that square
  const { board } = fenToBoard(HANGING_ROOK);
  const capture = ref('9172');
  assert.equal(infoOf(board, capture).captured, 'rook');
  assert.equal(getLegalMoves(applyMove(board, capture), 'black').filter(move => move.to.row === 7 && move.to.col === 2).length, 0);

  assert.ok(survey.table.depth >= 4);
  assert.equal(survey.test.tier, 1);
  assert.deepEqual(survey.test.group.map(codeOf), ['9172']);
  assert.equal(survey.test.group[0].notation, '马八进七');
  assert.equal(codeOf(survey.table.lines[0].move), '9172');
  // 炮五进四 takes the pawn on (3,4) and is taken by the horse: a capture that loses the exchange
  assert.equal(infoOf(board, ref('7434')).captured, 'pawn');
  assert.ok(survey.traps.includes('greedy'));
  assert.ok(ms <= 2 * PLAN.fast.surveyMs + 500, `the survey took ${ms} virtual ms`);

  // the start position has neither a test nor a losing capture that costs 150 cp
  const quiet = await brain.survey(surveyPayload(START, { ply: 0 }));
  assert.equal(quiet.test, null);
  assert.deepEqual(quiet.traps, []);
});

test('survey: moves, test, traps and tension are built from the facts, the final table and the payload', async () => {
  const brain = brainOf('fast');
  const payload = surveyPayload(HANGING_ROOK, { ply: 4, tensionPrev: 0.1, evalTwoPliesAgo: 0 });
  const survey = await brain.survey(payload);
  const { board } = fenToBoard(HANGING_ROOK);

  // moves[i] describes table.lines[i].move
  assert.equal(survey.moves.length, survey.table.lines.length);
  assert.equal(survey.moves.length, getLegalMoves(board, 'red').length);
  survey.moves.forEach((move, i) => assert.deepEqual(move, infoOf(board, survey.table.lines[i].move)));

  assert.deepEqual(survey.test, tacticalTest(HANGING_ROOK, survey.table, survey.facts));
  assert.deepEqual(survey.traps, habitTraps(HANGING_ROOK, survey.table, survey.facts, survey.threat));

  // tension: the best score of the table for the child, the payload's earlier evaluation and its previous tension
  const score = survey.table.lines[0].score;
  const expected = (prev, twoPliesAgo) => tension({ facts: survey.facts, score, evalNow: scoreToCp(score), evalTwoPliesAgo: twoPliesAgo }, prev);
  assert.equal(survey.tension, expected(0.1, 0));
  assert.ok(survey.tension > 0.1 && survey.tension <= 1, 'a hanging rook raises the tension');
  // the same position searched again by a fresh brain is the same table, so only the payload differs
  const calm = await brainOf('fast').survey({ ...payload, tensionPrev: 0.9, evalTwoPliesAgo: scoreToCp(score) });
  assert.deepEqual(calm.table.lines, survey.table.lines);
  assert.equal(calm.tension, expected(0.9, scoreToCp(score)));
  assert.notEqual(calm.tension, survey.tension);

  // plain JSON
  assert.deepEqual(JSON.parse(JSON.stringify(survey)), survey);
});

test('survey: when surveyMs is nearly used up before the deep table, the result keeps the shallow table', async () => {
  const fen = REFERENCE_POSITIONS.middlegameA;
  // First run: how many reads and how much time the job has used when it reports the threat. Its next read of the
  // clock is the one that measures what is left of surveyMs for the deep table.
  let threatAt = null;
  const first = brainOf('fast');
  clock.reads = 0;
  const started = clock.now;
  const normal = await first.survey(surveyPayload(fen), {
    cancelled: false,
    onProgress: stage => {
      if (stage === 'threat') threatAt = { reads: clock.reads, ms: clock.now - started };
    },
  });
  assert.ok(normal.table.depth > PLAN.fast.allDepth, 'with the whole budget the deep table gets deeper');

  // The same job on a fresh brain, with a jump at that read: 12 ms are left (the deep search cannot get past its first
  // two iterations), then none at all (no deep search).
  for (const left of [12, -100]) {
    const events = [];
    const brain = brainOf('fast');
    const survey = await withJump(threatAt.reads + 1, PLAN.fast.surveyMs - threatAt.ms - left, () => brain.survey(surveyPayload(fen), {
      cancelled: false, onProgress: (stage, data) => events.push({ stage, data }),
    }));
    assert.match(events.map(event => event.stage).join(' '), /^facts( table)+ threat$/, `${left} ms left: no deeper table is reported`);
    const shallow = events.filter(event => event.stage === 'table').map(event => event.data);
    const last = shallow[shallow.length - 1];
    assert.equal(last.depth, PLAN.fast.allDepth);
    assert.equal(survey.table.depth, last.depth, `${left} ms left: the result is the shallow table`);
    assert.equal(survey.table.allDepth, last.depth);
    assert.deepEqual(survey.table.lines, last.lines);
    assert.equal(survey.moves.length, last.lines.length);
    assert.deepEqual(survey.threat, normal.threat);
  }
});

test('survey: the shallow table, the threat and the deep table are the searches of 4.8.2 with the plan\'s depths and budgets, and the tables know the game history', async () => {
  // A wide middlegame on the fast plan, where the three budgets end the searches; a quiet ending, where the depth limits
  // of each plan do; and a position with a game behind it.
  const positions = [
    { name: 'middlegame', fen: REFERENCE_POSITIONS.middlegameB, history: [], ply: 20, classes: ['fast'] },
    { name: 'ending', fen: ENDING, history: [], ply: 80, classes: ['fast', 'mid', 'slow'] },
    { name: 'shuffle', fen: HORSE_SHUFFLE.fen, history: HORSE_SHUFFLE.history, ply: 10, classes: ['slow'] },
  ];
  for (const { name, fen, history, ply, classes } of positions) {
    const facts = positionFacts(fen, { ply });
    for (const speedClass of classes) {
      const plan = PLAN[speedClass];
      const what = `${name}, ${speedClass}`;
      const { survey, events } = await surveyWithProgress(brainOf(speedClass), surveyPayload(fen, { history, ply }));
      const twin = await surveyTwin(plan, fen, history);
      const threatAt = events.findIndex(event => event.stage === 'threat');
      assert.deepEqual(events.slice(1, threatAt).map(event => event.data), twin.shallowTables, `${what}: the shallow tables`);
      assert.deepEqual(survey.threat, threatInfo(fen, twin.pass, facts), `${what}: the threat`);
      assert.deepEqual(events.slice(threatAt + 1).map(event => event.data), twin.deepTables, `${what}: the deeper tables`);
      assert.deepEqual(survey.table, twin.table, `${what}: the table of the result`);
      if (name === 'middlegame') {
        // the premise: here the clock ends all three searches, short of the plan's depths
        assert.deepEqual([twin.shallow.stopped, twin.pass.stopped, twin.deep.stopped], ['time', 'time', 'time']);
        assert.ok(twin.shallow.depth < plan.allDepth && twin.pass.depth < plan.threatDepth && twin.deep.depth < plan.surveyDepth);
      } else if (name === 'ending') {
        // the premise: here nothing but the plan's depths ends them
        assert.deepEqual([twin.shallow.stopped, twin.pass.stopped, twin.deep.stopped], ['depth', 'depth', 'depth']);
        assert.deepEqual([twin.shallow.depth, twin.pass.depth, survey.table.depth], [plan.allDepth, plan.threatDepth, plan.surveyDepth]);
      } else {
        // the history reaches the search: the horse's move would repeat a position of the game, so it is counted as a
        // second occurrence and is not the best move any more (without the history it is)
        const line = lineOf(survey.table, HORSE_SHUFFLE.repeating);
        assert.equal(line.repeats, 2);
        assert.equal(survey.table.lines.filter(entry => entry.repeats !== 1).length, 1);
        assert.notEqual(survey.table.lines[0], line);
        const unseen = await surveyTwin(plan, fen, []);
        assert.equal(codeOf(unseen.table.lines[0].move), codeOf(HORSE_SHUFFLE.repeating));
        assert.equal(unseen.table.lines[0].repeats, 1);
      }
    }
  }
});

test('survey: when the 400 ms of the shallow table are used up it stops after depth 2, and the deep table takes over from there', async () => {
  const fen = REFERENCE_POSITIONS.middlegameA;
  // The job reads the clock once when it starts and its first search reads it once more; a jump of a little more than
  // 400 ms at the read after that: the shallow search may finish its second iteration (minDepth 2) and nothing more.
  const brain = brainOf('fast');
  const { survey, events } = await withJump(3, 401, () => surveyWithProgress(brain, surveyPayload(fen)));
  const stages = events.map(event => (event.stage === 'table' ? `table ${event.data.depth}` : event.stage));
  const threatAt = stages.indexOf('threat');
  assert.deepEqual(stages.slice(0, threatAt), ['facts', 'table 2'], 'the shallow table ends with its second iteration');
  assert.equal(events[1].data.allDepth, 2);
  // the deep table starts over, reports only what is deeper than the shallow one, and gets what is left of surveyMs
  assert.ok(stages.length > threatAt + 1, 'the deep table goes on');
  assert.deepEqual(stages.slice(threatAt + 1), stages.slice(threatAt + 1).map((stage, index) => `table ${3 + index}`));
  assert.equal(survey.table.depth, 2 + stages.length - threatAt - 1);
  assert.ok(survey.table.depth > PLAN.fast.allDepth && survey.table.allDepth === PLAN.fast.allDepth);
});

test('survey of a position without a legal move: an empty table, no moves, no deep search, and the tension of a lost position', async () => {
  assert.equal(getLegalMoves(fenToBoard(MATED).board, 'black').length, 0);
  const { survey, events } = await surveyWithProgress(brainOf('fast'), surveyPayload(MATED, { tensionPrev: 0.3 }));
  assert.deepEqual(events.map(event => event.stage), ['facts', 'threat']);
  assert.equal(survey.table.depth, 0);
  assert.equal(survey.table.stopped, 'no-moves');
  assert.deepEqual(survey.table.lines, []);
  assert.deepEqual(survey.moves, []);
  assert.equal(survey.test, null);
  assert.deepEqual(survey.traps, []);
  assert.equal(survey.threat, null, 'the side to move is in check: no pass search');
  assert.notEqual(survey.facts.check, null);
  assert.equal(survey.tension, tension({ facts: survey.facts, score: -MATE, evalNow: -2000, evalTwoPliesAgo: null }, 0.3));
  assert.ok(survey.tension > 0.7);
});

// ---------------------------------------------------------------------------------------------------------------
// assess
// ---------------------------------------------------------------------------------------------------------------

test('assess: a horse moved next to an enemy pawn is mistake or blunder with danger hangs_moved_piece and outcome.net <= -3', async () => {
  const brain = brainOf('fast');
  const { board } = fenToBoard(HORSE_OUT);
  // the premise, from the rules engine: the pawn takes the horse and red cannot take back
  const after = applyMove(board, HORSE_TO_PAWN);
  const pawnTakes = ref('3444');
  assert.ok(getLegalMoves(after, 'black').some(move => sameMove(move, pawnTakes)));
  assert.equal(getLegalMoves(applyMove(after, pawnTakes), 'red').filter(move => move.to.row === 4 && move.to.col === 4).length, 0);

  const survey = await brain.survey(surveyPayload(HORSE_OUT, { ply: 6 }));
  const { result: assessed, ms } = await timed(() => brain.assess({
    fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: survey.table, level: 3, compare: survey.table.lines[0].move,
  }));
  const { assessment } = assessed;
  assert.equal(assessment.move.notation, '马七进五');
  assert.ok(assessment.cat === 'mistake' || assessment.cat === 'blunder', assessment.cat);
  assert.equal(assessment.refutation.danger, 'hangs_moved_piece');
  assert.equal(assessment.refutation.reply.notation, '卒5进1');
  assert.ok(assessment.outcome.net <= -3, `net ${assessment.outcome.net}`);
  assert.ok(assessment.outcome.lost.some(item => item.piece === 'horse'));
  assert.equal(assessment.isBest, false);
  assert.ok(assessment.loss >= 250, `loss ${assessment.loss}`);
  assert.deepEqual(assessment.best, infoOf(board, survey.table.lines[0].move));
  // D = max(table.depth, assessDepth), reached unless the time ran out, and never less than min(D, 4)
  assert.ok(assessment.depth >= 4 && assessment.depth <= Math.max(survey.table.depth, PLAN.fast.assessDepth));
  assert.ok(ms <= 2 * PLAN.fast.assessMs + 500, `the assessment took ${ms} virtual ms`);

  // the facts of the move, with the ply
  assert.deepEqual(assessed.facts, moveFacts(HORSE_OUT, HORSE_TO_PAWN, { ply: 6 }));
  assert.ok(assessed.facts.exposed.some(item => item.cause === 'moved-into-attack'));

  // up to three rival answers from the position after the move, each seen from the child
  assert.ok(assessed.replies.length >= 1 && assessed.replies.length <= 3);
  const fenAfter = boardToFen(after, 'black');
  const rivalMoves = getLegalMoves(after, 'black');
  for (const reply of assessed.replies) {
    assert.ok(rivalMoves.some(move => sameMove(move, reply.move)), `${reply.move.notation} is a legal answer`);
    assert.deepEqual(reply.move, infoOf(after, reply.move));
    assert.equal(reply.line.start, fenAfter);
    assert.deepEqual(reply.line.moves[0], reply.move);
    assert.deepEqual(reply.outcome, materialOutcome(reply.line, 'red'));
    assert.deepEqual(reply.facts, moveFacts(fenAfter, reply.move, { ply: 7 }));
  }
  assert.equal(new Set(assessed.replies.map(reply => codeOf(reply.move))).size, assessed.replies.length);
  // the best answer takes the horse: the child (red) is the one who loses material in that line
  assert.equal(assessed.replies[0].move.notation, '卒5进1');
  assert.ok(assessed.replies[0].outcome.net <= -3);
  assert.ok(assessed.replies[0].outcome.lost.some(item => item.piece === 'horse'));

  assert.deepEqual(JSON.parse(JSON.stringify(assessed)), assessed);
});

test('assess with table null supplies its own comparison move', async () => {
  const brain = brainOf('fast');
  const { board } = fenToBoard(HORSE_OUT);
  const assessed = await brain.assess({ fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: null, level: 3, compare: null });
  const { assessment } = assessed;
  // a legal move that is not the tried one, and that an independent search finds good as well
  assert.ok(getLegalMoves(board, 'red').some(move => sameMove(move, assessment.best)));
  assert.notEqual(codeOf(assessment.best), codeOf(HORSE_TO_PAWN));
  assert.deepEqual(assessment.best, infoOf(board, assessment.best));
  const table = createSearcher().analyzeSync({ fen: HORSE_OUT, allDepth: 4, maxDepth: 4, minDepth: 4, timeMs: FOREVER });
  assert.ok(scoreToCp(table.lines[0].score) - scoreToCp(lineOf(table, assessment.best).score) <= 60, 'the comparison move is among the best');
  assert.equal(assessment.isBest, false);
  assert.ok(assessment.cat === 'mistake' || assessment.cat === 'blunder');
  assert.equal(assessment.refutation.danger, 'hangs_moved_piece');
  // without a table there is nothing to list as alternatives
  assert.deepEqual(assessment.alternatives, []);

  // A table of depth 1 does not supply the comparison move either (4.8.2), but still lists the alternatives. Its first
  // line is put there by hand (an edge pawn's move), so that it is not the move the job's own search finds.
  const real = createSearcher().analyzeSync({ fen: HORSE_OUT, allDepth: 1, maxDepth: 1, minDepth: 1, timeMs: FOREVER });
  assert.equal(real.depth, 1);
  const edgePawn = ref('6050');                                          // 兵九进一
  const rest = real.lines.filter(line => !sameMove(line.move, edgePawn));
  const first = real.lines.find(line => sameMove(line.move, edgePawn));
  const glance = { ...real, lines: [{ ...first, score: rest[0].score + 1, byDepth: [rest[0].score + 1] }, ...rest] };
  assert.notEqual(codeOf(assessment.best), codeOf(edgePawn));
  const shallow = await brainOf('fast').assess({ fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: glance, level: 3, compare: null });
  assert.deepEqual(shallow.assessment.best, assessment.best, 'the job\'s own comparison move, not the first line of the depth-1 table');
  assert.equal(shallow.assessment.alternatives.length, 3);
  assert.equal(codeOf(shallow.assessment.alternatives[0].move), codeOf(edgePawn), 'the alternatives are the table\'s');
});

test('assess: the comparison move is the payload\'s, else the first line of the payload\'s table; a table of another position is ignored', async () => {
  const { board } = fenToBoard(HORSE_OUT);
  const base = { fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, level: 3 };
  const edgePawn = ref('6050'), otherEdgePawn = ref('6858');           // 兵九进一, 兵一进一: quiet moves, far better than losing a horse

  // compare given: that move is the one compared against, whatever the table says
  const real = createSearcher().analyzeSync({ fen: HORSE_OUT, allDepth: 2, maxDepth: 2, minDepth: 2, timeMs: FOREVER });
  const pinned = await brainOf('fast').assess({ ...base, table: real, compare: edgePawn });
  assert.equal(pinned.assessment.best.notation, '兵九进一');
  assert.equal(pinned.assessment.isBest, false);

  // compare null: the first line of the table. The table is hand-made: the other edge pawn is put in front.
  const lines = real.lines.slice();
  const at = lines.findIndex(line => sameMove(line.move, otherEdgePawn));
  const [moved] = lines.splice(at, 1);
  const made = { ...real, lines: [{ ...moved, score: lines[0].score + 1, byDepth: [moved.byDepth[0], lines[0].score + 1] }, ...lines] };
  const fromTable = await brainOf('fast').assess({ ...base, table: made, compare: null });
  assert.equal(fromTable.assessment.best.notation, '兵一进一');
  // the table also supplies the alternatives: its best lines other than the tried move
  assert.deepEqual(fromTable.assessment.alternatives.map(item => codeOf(item.move)), made.lines.filter(line => !sameMove(line.move, HORSE_TO_PAWN)).slice(0, 3).map(line => codeOf(line.move)));

  // the tried move compared with itself
  const self = await brainOf('fast').assess({ ...base, move: edgePawn, table: null, compare: edgePawn });
  assert.equal(self.assessment.isBest, true);
  assert.equal(self.assessment.loss, 0);
  assert.deepEqual(self.assessment.best, infoOf(board, edgePawn));
  assert.equal(self.assessment.refutation, null);

  // a table that belongs to another position is not used: no alternatives, and the job finds its own comparison move
  const foreign = createSearcher().analyzeSync({ fen: START, allDepth: 2, maxDepth: 2, minDepth: 2, timeMs: FOREVER });
  const ignored = await brainOf('fast').assess({ ...base, table: foreign, compare: null });
  assert.deepEqual(ignored.assessment.alternatives, []);
  assert.ok(getLegalMoves(board, 'red').some(move => sameMove(move, ignored.assessment.best)));
  // the same pieces with the other side to move are another position too
  const turned = createSearcher().analyzeSync({ fen: boardToFen(board, 'black'), allDepth: 2, maxDepth: 2, minDepth: 2, timeMs: FOREVER });
  assert.equal(turned.fen.split(' ')[0], HORSE_OUT.split(' ')[0]);
  const otherSide = await brainOf('fast').assess({ ...base, table: turned, compare: null });
  assert.deepEqual(otherSide.assessment, ignored.assessment);
  // while the same position written with `r` for red and with move counters is the same position
  const again = await brainOf('fast').assess({ ...base, table: { ...real, fen: `${HORSE_OUT.split(' ')[0]} r - - 0 1` }, compare: null });
  assert.equal(again.assessment.alternatives.length, 3);

  // an illegal move is an error, not a cancellation, and the brain goes on
  const brain = brainOf('fast');
  const failure = await rejection(brain.assess({ ...base, move: ref('6061'), table: null, compare: null }));
  assert.ok(failure instanceof RangeError);
  assert.equal((await brain.analyze({ fen: START, maxDepth: 2, timeMs: FOREVER })).depth, 2);
});

test('assess: the comparison move, the pair and the rival\'s answers are the searches of 4.8.2 with the plan\'s depths and budgets; the verdict is the level\'s', async t => {
  const seen = [];
  // 1. A middlegame with a game behind it; no table and no comparison move, so a short search supplies one. It gets the
  //    history: the horse's move, which it likes best otherwise, would repeat a position of the game.
  for (const speedClass of ['fast', 'mid', 'slow']) {
    const plan = PLAN[speedClass];
    const payload = { fen: HORSE_SHUFFLE.fen, history: HORSE_SHUFFLE.history, ply: 10, move: ref('7131'), table: null, level: 3, compare: null };   // 炮八进四
    const assessed = await brainOf(speedClass).assess(payload);
    const twin = assessTwin(plan, payload);
    assertAssessedLikeTwin(assessed, twin, payload, `middlegame, ${speedClass}`);
    assert.equal(assessed.replies.length, 3, 'three answers where the rival has that many');
    assert.equal(codeOf(createSearcher().analyzeSync({ fen: payload.fen, history: [], timeMs: 150 }).lines[0].move), codeOf(HORSE_SHUFFLE.repeating));
    assert.notEqual(codeOf(twin.compare), codeOf(HORSE_SHUFFLE.repeating), 'the search for the comparison move knows the game history');
    assert.notEqual(codeOf(assessed.assessment.best), codeOf(HORSE_SHUFFLE.repeating));
    seen.push(`${speedClass} middlegame: pair ${twin.pair.depth} ${twin.pair.stopped}, answers ${twin.answers.depth} ${twin.answers.stopped}`);
  }

  // 2. The quiet ending with a table that is one ply deeper than assessDepth: D is the table's depth, the pair reaches it,
  //    the answers are searched to D - 1, and the comparison move is the table's first line.
  const { board: ending } = fenToBoard(ENDING);
  for (const speedClass of ['fast', 'mid', 'slow']) {
    const plan = PLAN[speedClass];
    const table = createSearcher().analyzeSync({ fen: ENDING, allDepth: 2, multiPV: 6, maxDepth: plan.assessDepth + 1, minDepth: plan.assessDepth + 1, timeMs: FOREVER });
    const payload = { fen: ENDING, history: [], ply: 80, move: table.lines[3].move, table, level: 3, compare: null };
    const assessed = await brainOf(speedClass).assess(payload);
    const twin = assessTwin(plan, payload);
    assertAssessedLikeTwin(assessed, twin, payload, `ending, ${speedClass}`);
    assert.equal(twin.D, plan.assessDepth + 1);
    assert.equal(assessed.assessment.depth, twin.D, `${speedClass}: both moves are searched to the depth of the table`);
    assert.deepEqual([twin.pair.stopped, twin.answers.stopped, twin.answers.depth], ['depth', 'depth', twin.D - 1], `${speedClass}: nothing but the depth limits ends these searches`);
    assert.deepEqual(assessed.assessment.best, infoOf(ending, table.lines[0].move));
    assert.equal(assessed.replies.length, 3);
  }

  // 3. The level decides the verdict: a move that costs about a pawn and a half is 缓着 for a beginner and 失误 for a strong child.
  const best = createSearcher().analyzeSync({ fen: HORSE_OUT, allDepth: 5, maxDepth: 5, minDepth: 5, timeMs: FOREVER }).lines[0].move;
  const cats = [];
  for (const level of [1, 9]) {
    const payload = { fen: HORSE_OUT, history: [], ply: 6, move: ref('7151'), table: null, level, compare: best };                            // 炮八进二
    const assessed = await brainOf('fast').assess(payload);
    assertAssessedLikeTwin(assessed, assessTwin(PLAN.fast, payload), payload, `level ${level}`);
    cats.push(assessed.assessment.cat);
    seen.push(`level ${level}: loss ${assessed.assessment.loss}`);
  }
  assert.deepEqual(cats, ['ok', 'mistake']);

  // 4. The clock and the pair. With a comparison move given, the first read of the clock is the start of the pair search;
  //    a jump of a little more than assessMs at the next read: the iterations up to min(D, 4) are finished all the same,
  //    and none is started after them.
  const payload = { fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: null, level: 3, compare: best };
  const brain = brainOf('fast');
  const hurried = await withJump(2, PLAN.fast.assessMs + 1, () => brain.assess(payload));
  assert.equal(hurried.assessment.depth, 4);
  assert.equal(hurried.assessment.refutation.danger, 'hangs_moved_piece');

  // 5. The clock and the answers: their search has 150 ms. The twin tells how many reads the pair takes; the next read
  //    starts the answers' search, and a jump of a little more than 150 ms at the read after that ends it early.
  const undisturbed = assessTwin(PLAN.fast, payload);
  const at = undisturbed.pairReads + 2;
  const late = brainOf('fast');
  const cut = await withJump(at, 151, () => late.assess(payload));
  const cutTwin = await withJump(at, 151, async () => assessTwin(PLAN.fast, payload));
  assertAssessedLikeTwin(cut, cutTwin, payload, 'answers out of time');
  assert.deepEqual(cutTwin.pair, undisturbed.pair, 'the pair search is over before the jump');
  assert.equal(cutTwin.answers.stopped, 'time');
  assert.ok(cutTwin.answers.depth < undisturbed.answers.depth, `answers of depth ${cutTwin.answers.depth} instead of ${undisturbed.answers.depth}`);
  t.diagnostic(seen.join('; '));
});

/**
 * A position from a seeded random playout in which black, to move, mates in two with 车9进7. 象3进1 instead lets red
 * mate in three checks. The root loop of the search stops at depth 3 as soon as its best line is a mate (A3.3), so the
 * pair search of the assess job looks at 象3进1 only three plies deep, where that mate is out of sight.
 */
const MATE_BEHIND_STOP = {
  fen: '2b2kb1r/9/1R1ana1c1/2P1Nn3/p3P4/P1B1P1R2/7c1/B3K3C/5r3/3A1A3 b',
  move: '0220',          // 象3进1
  compare: '0878',       // 车9进7
};

test('assess: a mate in three that the pair search stops short of (its other move mates) is reported from the checks-only mate search', async () => {
  const { fen } = MATE_BEHIND_STOP;
  const move = ref(MATE_BEHIND_STOP.move), compare = ref(MATE_BEHIND_STOP.compare);
  const { board } = fenToBoard(fen);

  // The premise, from an independent search. The move alone, searched six plies deep, is mated in three ...
  const alone = createSearcher().analyzeSync({ fen, rootMoves: [move], maxDepth: 6, minDepth: 6, timeMs: FOREVER });
  assert.equal(mateIn(alone.lines[0].score), -3);
  // ... but the pair search the job asks for (4.8.2 step 2) stops at depth 3 on the mate of the comparison move, and
  // there the tried move looks harmless.
  const D = PLAN.fast.assessDepth;
  const pair = createSearcher().analyzeSync({ fen, rootMoves: [compare, move], allDepth: D, maxDepth: D, minDepth: 4, timeMs: FOREVER });
  assert.equal(pair.depth, 3);
  assert.equal(pair.stopped, 'mate');
  assert.equal(pair.lines[0].mate, 2);
  assert.equal(codeOf(pair.lines[0].move), MATE_BEHIND_STOP.compare);
  assert.equal(mateIn(lineOf(pair, move).score), null);
  assert.ok(scoreToCp(lineOf(pair, move).score) > -100, 'at depth 3 the search takes the move for a quiet one');

  const assessed = await brainOf('fast').assess({ fen, history: [], ply: 60, move, table: null, level: 3, compare });
  const { assessment } = assessed;
  assert.equal(assessment.depth, 3);
  assert.equal(assessment.move.notation, '象3进1');
  assert.equal(assessment.best.notation, '车9进7');
  assert.equal(assessment.bestCp, 2000);
  assert.equal(assessment.moveCp, -2000);
  assert.equal(assessment.flags.allowsMate, true);
  assert.equal(assessment.flags.missedMate, true);
  assert.equal(assessment.cat, 'blunder');
  assert.equal(assessment.refutation.danger, 'allows_mate');
  assert.equal(assessed.facts.allowsMate.in, 3);
  // the line is the move and the mate: three checks of red, each answered, replayed here by the rules engine
  assert.equal(assessment.line.end, 'mate');
  assert.equal(assessment.line.moves.length, 6);
  assert.equal(codeOf(assessment.line.moves[0]), MATE_BEHIND_STOP.move);
  let position = board, side = 'black';
  for (const [index, step] of assessment.line.moves.entries()) {
    assert.ok(getLegalMoves(position, side).some(legal => sameMove(legal, step)), `${step.notation} is legal`);
    position = applyMove(position, step);
    side = other(side);
    if (index % 2 === 1) assert.ok(isInCheck(position, 'black'), `${step.notation} gives check`);
  }
  assert.equal(getLegalMoves(position, 'black').length, 0);
  assert.equal(assessment.outcome.mate, 'suffers');
  // and the rival's first answer mates too (the search of the answers has no mate of the child's to stop at: it may
  // show a mating line of its own)
  const after = applyMove(board, move);
  assert.ok(getLegalMoves(after, 'red').some(legal => sameMove(legal, assessed.replies[0].move)));
  assert.deepEqual(assessed.replies[0].line.moves[0], assessed.replies[0].move);
  assert.equal(assessed.replies[0].line.start, boardToFen(after, 'red'));
  assert.equal(assessed.replies[0].line.end, 'mate');
  assert.equal(assessed.replies[0].outcome.mate, 'suffers');
  assert.equal(new Set(assessed.replies.map(reply => codeOf(reply.move))).size, assessed.replies.length);

  // the mating move itself: nothing is made up for a move that allows no mate
  const mating = await brainOf('fast').assess({ fen, history: [], ply: 60, move: compare, table: null, level: 3, compare });
  assert.equal(mating.assessment.flags.allowsMate, false);
  assert.equal(mating.assessment.flags.givesMate, 2);
  assert.equal(mating.assessment.isBest, true);
  assert.equal(mating.assessment.refutation, null);
  assert.ok(mating.replies.length >= 1 && mating.replies.every(reply => reply.outcome.mate !== 'suffers'), 'the child is not the one who is mated');
});

/**
 * A position from a seeded random playout (seed 190, ply 149) in which black is to move. 卒5平4 steps the pawn out of
 * the file of the red rook; 车三平五 then checks, the only answer that matters is 卒4平5, and 车五进一 takes the pawn
 * and mates. The history says that this has happened once before: red checked, black interposed, and red withdrew the
 * rook instead of mating (a teaching rival may spare a mate). The search treats the second occurrence of a game
 * position as a draw (A3.4), so with this history it does not see the mate; the checks-only mate search of facts.js does.
 */
const SPARED = {
  fen: '5ab2/9/nr1ak3b/PC1n5/3N4P/2p1p1p2/6R2/2N2K3/4A4/2BA2B2 b',
  history: [
    '5ab2/9/nr1ak3b/PC1n5/3N4P/2pp2p2/4R4/2N2K3/4A4/2BA2B2 b',         // after 车三平五: black is in check
    '5ab2/9/nr1ak3b/PC1n5/3N4P/2p1p1p2/4R4/2N2K3/4A4/2BA2B2 w',        // after 卒4平5; red then played 车五平三
  ],
  move: '5453',          // 卒5平4
  compare: '5666',       // 卒7进1, which takes the rook
};

test('assess: a forced mate that the search cannot see behind a repeated position is reported from the checks-only mate search', async () => {
  const { fen, history } = SPARED;
  const move = ref(SPARED.move), compare = ref(SPARED.compare);
  const { board } = fenToBoard(fen);

  // The premise, from the rules engine alone: the history is the game that led here, and after the move red mates in two.
  const z = fenToBoard(history[0]).board, q = fenToBoard(history[1]).board;
  assert.equal(boardToFen(applyMove(z, ref('5354')), 'red'), history[1]);              // 卒4平5
  assert.equal(boardToFen(applyMove(q, ref('6466')), 'black'), fen);                   // 车五平三
  const after = applyMove(board, move);
  const check = ref('6664'), mate = ref('6454');
  const checked = applyMove(after, check);
  assert.equal(boardToFen(checked, 'black'), history[0], 'the check repeats a position of the game');
  assert.ok(isInCheck(checked, 'black'));
  /** red has a move after which black has no legal move */
  const redMatesAtOnce = position => getLegalMoves(position, 'red').some(m => getLegalMoves(applyMove(position, m), 'black').length === 0);
  const answers = getLegalMoves(checked, 'black');
  assert.ok(answers.length > 0 && answers.every(answer => redMatesAtOnce(applyMove(checked, answer))), 'every answer to the check is mated');
  assert.equal(getLegalMoves(applyMove(applyMove(checked, ref('5354')), mate), 'black').length, 0);

  // The search: without the history it sees the mate, with it it does not.
  const single = { fen, rootMoves: [move], maxDepth: 6, minDepth: 6, timeMs: FOREVER };
  assert.equal(mateIn(createSearcher().analyzeSync(single).lines[0].score), -2);
  assert.equal(mateIn(createSearcher().analyzeSync({ ...single, history }).lines[0].score), null);

  const assessed = await brainOf('fast').assess({ fen, history, ply: 149, move, table: null, level: 3, compare });
  const { assessment } = assessed;
  assert.equal(assessment.move.notation, '卒5平4');
  assert.equal(assessment.flags.allowsMate, true);
  assert.equal(assessment.moveCp, -2000);
  assert.equal(assessment.cat, 'blunder');
  assert.equal(assessment.refutation.danger, 'allows_mate');
  assert.deepEqual(assessment.line.moves.map(codeOf), [SPARED.move, '6664', '5354', '6454']);
  assert.equal(assessment.line.end, 'mate');
  assert.equal(assessment.outcome.mate, 'suffers');
  // the comparison move is untouched: it allows no mate, and it is the better move
  assert.equal(codeOf(assessment.best), SPARED.compare);
  assert.ok(assessment.bestCp > -1900);
  assert.equal(assessed.facts.allowsMate.in, 2);
  // The rival's answers tell the same story: the mating check comes first, with the whole mating line, seen from the
  // child. (The search of the answers gets the game history too, so it takes that check for a repetition.)
  assert.ok(assessed.replies.length >= 1 && assessed.replies.length <= 3);
  assert.deepEqual(assessed.replies[0].move, infoOf(after, check));
  assert.deepEqual(assessed.replies[0].line.moves.map(codeOf), ['6664', '5354', '6454']);
  assert.equal(assessed.replies[0].line.start, boardToFen(after, 'red'));
  assert.equal(assessed.replies[0].line.end, 'mate');
  assert.equal(assessed.replies[0].outcome.mate, 'suffers');
  assert.deepEqual(assessed.replies[0].facts, moveFacts(boardToFen(after, 'red'), check, { ply: 150 }));
  assert.equal(new Set(assessed.replies.map(reply => codeOf(reply.move))).size, assessed.replies.length);
  assert.deepEqual(JSON.parse(JSON.stringify(assessed)), assessed);

  // The comparison move is judged in the same way. Asked about a dull rook move (车2进1) with the pawn's move as the
  // comparison move, the job knows that the pawn's move is mated: the rook move is the better of the two, although the
  // pair search, which takes the check for a repetition, scores the pawn's move well above it.
  const dull = ref('2131');
  const blind = createSearcher().analyzeSync({ fen, history, rootMoves: [move, dull], allDepth: 7, maxDepth: 7, minDepth: 4, timeMs: PLAN.fast.assessMs });
  assert.ok(lineOf(blind, move).score > lineOf(blind, dull).score + 100, 'the search alone prefers the move that is mated');
  const swapped = await brainOf('fast').assess({ fen, history, ply: 149, move: dull, table: null, level: 3, compare: move });
  assert.equal(swapped.assessment.move.notation, '车2进1');
  assert.equal(swapped.assessment.isBest, true);
  assert.equal(codeOf(swapped.assessment.best), '2131');
  assert.equal(swapped.assessment.loss, 0);
  assert.equal(swapped.assessment.flags.allowsMate, false);
  assert.equal(swapped.assessment.moveCp, scoreToCp(lineOf(blind, dull).score));

  // The same move when the cycle has been played twice already. The rules engine: the move would bring its position
  // about for the third time, which ends the game in a draw. The mate cannot be played, so it is not reported.
  const cycle = [ref('6664'), ref('5354'), ref('6466'), move];                  // 车三平五, 卒4平5, 车五平三, 卒5平4
  const log = [];
  const twice = [];
  let position = after, side = 'red';                                          // the position after 卒5平4, red to move
  const startKey = positionKey(position, side);
  for (const step of [...cycle, ...cycle.slice(0, 3)]) {
    twice.push(boardToFen(position, side));
    log.push(plyRecord(position, step));
    position = applyMove(position, step);
    side = other(side);
  }
  assert.equal(boardToFen(position, side), fen, 'the cycle leads back to the position of the payload');
  assert.equal(judgeMove(startKey, log, position, move), 'draw');
  const drawn = await brainOf('fast').assess({ fen, history: twice, ply: 153, move, table: null, level: 3, compare });
  assert.equal(drawn.facts.allowsMate.in, 2, 'the facts of the move do not know the history');
  assert.equal(drawn.assessment.flags.allowsMate, false);
  assert.ok(drawn.assessment.moveCp > -1900, `moveCp ${drawn.assessment.moveCp}`);
  assert.notEqual(drawn.assessment.line.end, 'mate');
  assert.notEqual(drawn.assessment.refutation?.danger, 'allows_mate');
  assert.ok(drawn.replies.every(reply => reply.line.end !== 'mate'), 'no mating answer is made up either');
});

test('assess: the rival\'s answers are searched with the game history, the position of the payload included', async () => {
  // Red has a rook against a bare king. Both sides have stepped forward and back once, so the position has occurred
  // before: 车九进一 and then 将5平6 would bring about a position of the game again.
  const fen = '4k4/9/9/9/9/9/9/9/9/R2K5 w';
  const { board } = fenToBoard(fen);
  const rookUp = ref('9080'), rookBack = ref('8090'), kingAside = ref('0405'), kingBack = ref('0504');
  const history = [];
  let position = board, side = 'red';
  for (const step of [rookUp, kingAside, rookBack, kingBack]) {
    history.push(boardToFen(position, side));
    position = applyMove(position, step);
    side = other(side);
  }
  assert.equal(boardToFen(position, side), fen, 'the four moves lead back to the position of the payload');
  const afterRook = applyMove(board, rookUp);
  assert.ok(history.includes(boardToFen(applyMove(afterRook, kingAside), 'red')), 'the king\'s answer repeats a position of the game');

  // With the history the search takes that answer for a repetition: a draw, which a side that is a rook down likes
  // best, and its line ends there. Without the history the same answer is one losing move among others.
  const payload = { fen, ply: 84, move: rookUp, table: null, level: 3, compare: null };
  const known = await brainOf('fast').assess({ ...payload, history });
  assert.deepEqual(known.replies[0].move, infoOf(afterRook, kingAside));
  assert.deepEqual(known.replies[0].line.moves.map(codeOf), [codeOf(kingAside)]);
  const blank = await brainOf('fast').assess({ ...payload, history: [] });
  const sameAnswer = blank.replies.find(reply => codeOf(reply.move) === codeOf(kingAside));
  assert.ok(sameAnswer === undefined || sameAnswer.line.moves.length > 1, 'without the history the answer is no repetition');
  // the tried move itself: with the history its position has occurred before, without it the move simply keeps the rook
  assert.ok(known.assessment.moveCp < blank.assessment.moveCp);
});

test('Line.end: a line that the search cut at its full length is cut exactly when something is left to take at its end', async () => {
  // Rival answers of four assessments (no teacher involved). In the first position a black rook stays en prise whatever
  // red does with an edge pawn, so the long answers end with things to take; the second is a quiet opening.
  const scenarios = [
    [HANGING_ROOK, '6858'], [HANGING_ROOK, '6050'],                                                  // 兵一进一, 兵九进一
    [COACH_EXAMPLE_POSITIONS.horseReply.fen, '7173'], [COACH_EXAMPLE_POSITIONS.horseReply.fen, '7141'],   // 炮八平六, 炮八进三
  ];
  lineEnds.cut = 0;
  lineEnds.settled = 0;
  const seen = [];
  for (const [fen, code] of scenarios) {
    const assessed = await brainOf('fast').assess({ fen, history: [], ply: 20, move: ref(code), table: null, level: 3, compare: null });
    assert.equal(assessed.replies.length, 3);
    // assertLineEnd judges each line by the rules engine: cut => full length and a capture at its end; full length and
    // a piece free to take => cut; nothing to take => not cut
    assessed.replies.forEach((reply, index) => assertLineEnd(reply.line, 8, `${code}, answer ${index + 1}`));
    seen.push(assessed.replies.map(reply => `${reply.line.moves.length} ${reply.line.end}`).join(', '));
  }
  // both kinds occur, or the judgement above was never put to the test
  assert.ok(lineEnds.cut >= 2 && lineEnds.settled >= 2, `${JSON.stringify(lineEnds)}: ${seen.join(' | ')}`);
});

// ---------------------------------------------------------------------------------------------------------------
// opponent
// ---------------------------------------------------------------------------------------------------------------

/** A teaching context as the director builds it. */
function contextOf(profile, game, moveNo, lastChild) {
  return teachingContext(profile, game, {
    moveNo, lastChildMove: lastChild ? { from: lastChild.from, to: lastChild.to } : null, lastChildCapture: lastChild ? lastChild.captured !== null : false,
  });
}

/** Everything of an OpponentTurn that follows from its choice and from the payload. */
function checkOpponentTurn(turn, payload) {
  const { fen, ply } = payload;
  const { board, turn: rival } = fenToBoard(fen);
  const child = other(rival);
  const move = turn.choice.move;
  assert.ok(getLegalMoves(board, rival).some(legal => sameMove(legal, move)), `${codeOf(move)} is a legal move`);
  assert.deepEqual(turn.move, infoOf(board, move));
  assert.deepEqual(turn.facts, moveFacts(fen, move, { ply }));

  // the chosen root line and the Line made of its PV
  const root = turn.choice.line;
  assert.deepEqual(root.move, move);
  assert.deepEqual(root.pv[0], move);
  assert.equal(turn.line.start, boardToFen(board, rival));
  assert.deepEqual(turn.line.moves[0], turn.move);
  assert.ok(turn.line.moves.length <= root.pv.length);
  assertLineEnd(turn.line, 8, 'the line of the rival');

  // numbers
  assert.ok(['honest', 'variety', 'overlook', 'chance', 'concession', 'finisher'].includes(turn.choice.kind));
  assert.ok(['press', 'spar', 'ease', 'finish'].includes(turn.choice.mode));
  assert.deepEqual(turn.quality, { loss: turn.choice.loss, cat: catOf(turn.choice.loss) });
  assert.equal(turn.evalAfter, turn.choice.evalAfter);
  assert.ok(Number.isInteger(turn.childMoveCp) && Math.abs(turn.childMoveCp) <= 2000);
  const fenAfter = boardToFen(applyMove(board, move), child);
  const rivalScore = root.upper === null ? root.score : Math.min(root.score, root.upper);
  assert.equal(turn.tension, tension({
    facts: positionFacts(fenAfter, { ply: ply + 1 }), score: -rivalScore, evalNow: turn.evalAfter, evalTwoPliesAgo: payload.evalTwoPliesAgo,
  }, payload.tensionPrev));

  // a gift is a move whose exact score is known: a table line exact at the table's depth or a finished verification
  if (['overlook', 'chance', 'concession', 'finisher'].includes(turn.choice.kind)) {
    assert.equal(root.upper, null);
    assert.equal(root.byDepth.length, root.depth);
    assert.equal(root.byDepth[root.depth - 1], root.score);
  }
  // the two continuations are Lines (the teacher hands PVs over): the chance starts after the rival's move with the
  // child's reply, the overlooked line starts in this position with another move of the rival
  if (turn.choice.chance !== null) {
    const { line } = turn.choice.chance;
    assert.equal(line.start, fenAfter);
    assert.ok(line.moves.length >= 1);
    assert.equal(line.moves[0].color, child);
    assert.deepEqual(line.moves, turn.line.moves.slice(1, 1 + line.moves.length));
    // the PV of the chance is the PV of the rival without its first move (4.7.5), so the search cut it one move earlier,
    // and the two Lines end in the same position
    assertLineEnd(line, 7, 'the chance');
    if (line.moves.length === turn.line.moves.length - 1) assert.equal(line.end, turn.line.end, 'the chance ends as the line of the rival does');
  }
  if (turn.choice.overlooked !== null) {
    const { line } = turn.choice.overlooked;
    assert.equal(line.start, boardToFen(board, rival));
    assert.ok(line.moves.length >= 1);
    assert.equal(line.moves[0].color, rival);
    assert.notEqual(codeOf(line.moves[0]), codeOf(move));
    assert.deepEqual(line.moves[0], infoOf(board, line.moves[0]));
    assertLineEnd(line, 8, 'the overlooked line');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(turn)), turn);
}

test('opponent: returns a legal move; childMoveCp matches an independent search within 40 cp; never repeats while a non-repeating move within 200 cp exists (60-ply bot game)', async t => {
  // 1. Fixed positions, first rival move of a game: the chosen line is exact at the table's depth, so that depth is known
  //    and an independent searcher (best move only, empty table) can be asked for the same position at the same depth.
  const profile = createSkillProfile(2);
  let compared = 0;
  for (const fen of [START, REFERENCE_POSITIONS.middlegameA, REFERENCE_POSITIONS.middlegameB, COACH_EXAMPLE_POSITIONS.sameCannons.fen, COACH_EXAMPLE_POSITIONS.horseReply.fen]) {
    const payload = { fen, history: [], ply: 1, ctx: contextOf(profile, createGameSkill(7), 1, null), tensionPrev: 0.1, evalTwoPliesAgo: null };
    const { result: turn, ms } = await timed(() => brainOf('fast').opponent(payload));
    checkOpponentTurn(turn, payload);
    assert.ok(ms <= 2 * (PLAN.fast.thinkMs + PLAN.fast.verifyMs) + 500, `the rival took ${ms} virtual ms`);
    const root = turn.choice.line;
    if ((turn.choice.kind === 'variety' || turn.choice.kind === 'honest') && root.upper === null) {
      const independent = createSearcher().analyzeSync({ fen, maxDepth: root.depth, minDepth: root.depth, timeMs: FOREVER });
      assert.equal(independent.depth, root.depth);
      const expected = -scoreToCp(independent.lines[0].score);
      assert.ok(Math.abs(turn.childMoveCp - expected) <= 40, `childMoveCp ${turn.childMoveCp}, independent search ${expected} at depth ${root.depth}`);
      compared++;
    }
  }
  assert.ok(compared >= 3, `childMoveCp was compared on ${compared} positions`);

  // 2. A bot game of 60 plies: a child (red) that moves at random and often steps back to where it came from, against
  //    the rival (black). When a game ends early the next one starts, until 30 rival moves are played.
  const brain = brainOf('fast');
  const kinds = {};
  let rivalMoves = 0, repeated = 0, chances = 0, overlooks = 0;
  lineEnds.cut = 0;
  lineEnds.settled = 0;                       // counted by checkOpponentTurn, for the diagnostic line below
  for (let seed = 1; rivalMoves < 30; seed++) {
    const random = mulberry32(seed);
    let board = fenToBoard(START).board;
    let game = createGameSkill(seed);
    let since = [];                           // FENs since the last capture, oldest first, without the current position
    let seen = new Map();                     // how often each position has occurred since the last capture
    let lastChild = null, tensionPrev = 0.1;
    const evals = [];                         // the child's evaluation after each rival move
    seen.set(positionKey(board, 'red'), 1);
    /** Play a move of `side` and keep the history. */
    const play = (move, side) => {
      const captured = board[move.to.row][move.to.col] !== null;
      const before = boardToFen(board, side);
      board = applyMove(board, move);
      if (captured) {
        since = [];
        seen = new Map();
      } else {
        since.push(before);
      }
      const key = positionKey(board, other(side));
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      return count;
    };
    for (let ply = 0; rivalMoves < 30; ply += 2) {
      // the child
      const legal = getLegalMoves(board, 'red');
      if (legal.length === 0) break;
      const back = lastChild && legal.find(move => sameMove(move, { from: lastChild.to, to: lastChild.from }));
      const childMove = back && random() < 0.4 ? back : legal[Math.floor(random() * legal.length)];
      lastChild = childMove;
      play(childMove, 'red');
      if (getLegalMoves(board, 'black').length === 0) break;

      // the rival
      const fen = boardToFen(board, 'black');
      const history = since.slice();
      const payload = {
        fen, history, ply: ply + 1, ctx: contextOf(profile, game, ply / 2 + 1, childMove), tensionPrev,
        evalTwoPliesAgo: evals.length > 0 ? evals[evals.length - 1] : null,
      };
      const { result: turn, ms } = await timed(() => brain.opponent(payload));
      checkOpponentTurn(turn, payload);
      assert.ok(ms <= 2 * (PLAN.fast.thinkMs + PLAN.fast.verifyMs) + 500, `the rival took ${ms} virtual ms`);
      kinds[turn.choice.kind] = (kinds[turn.choice.kind] ?? 0) + 1;
      if (turn.choice.chance !== null) chances++;
      if (turn.choice.overlooked !== null) overlooks++;

      const count = play(turn.choice.move, 'black');
      assert.equal(turn.choice.line.repeats, count, 'the search counts the occurrences in the payload\'s history');
      if (count >= 2) {
        // The rival repeated a position. That is allowed only when every move that does not repeat is 200 cp or more
        // worse than the best repeating one; an independent table of the same position must agree (40 cp of tolerance).
        repeated++;
        const table = createSearcher().analyzeSync({ fen, history, allDepth: 4, maxDepth: 4, minDepth: 4, timeMs: FOREVER });
        const fresh = table.lines.filter(line => line.repeats < 2);
        const twice = Math.max(...table.lines.filter(line => line.repeats === 2).map(line => scoreToCp(line.score)));
        for (const line of fresh) assert.ok(twice - scoreToCp(line.score) >= 160, `${codeOf(line.move)} does not repeat and is within 200 cp`);
      }
      game = recordOpponentMove(game, ply + 1, turn.choice);
      tensionPrev = turn.tension;
      evals.push(turn.evalAfter);
      rivalMoves++;
    }
  }
  assert.equal(rivalMoves, 30);
  // against a child that gives pieces away the rival does not only play its honest move
  assert.ok(Object.keys(kinds).length >= 2, JSON.stringify(kinds));
  t.diagnostic(`bot game: kinds ${JSON.stringify(kinds)}; chance lines ${chances}, overlooked lines ${overlooks}, repeated positions ${repeated}; lines of full length: ${lineEnds.cut} cut, ${lineEnds.settled} with nothing to take`);

  // 3. The repetition rule itself, on a history made for it: every position the rival can reach but one has occurred
  //    before. Those moves are searched as repetitions (a draw), the remaining quiet move is within 200 cp of them, so
  //    it is the only playable move.
  const fen = boardToFen(fenToBoard(START).board, 'black');
  const { board } = fenToBoard(fen);
  const only = ref('3040');                    // 卒1进1
  const reached = getLegalMoves(board, 'black').filter(move => !sameMove(move, only)).map(move => boardToFen(applyMove(board, move), 'red'));
  const payload = { fen, history: reached, ply: 9, ctx: contextOf(profile, createGameSkill(3), 5, null), tensionPrev: 0.1, evalTwoPliesAgo: null };
  for (const tries of [1, 2, 3]) {
    const turn = await brainOf('fast').opponent({ ...payload, ctx: { ...payload.ctx, seed: tries } });
    checkOpponentTurn(turn, payload);
    assert.equal(turn.move.notation, '卒1进1');
    assert.equal(turn.choice.line.repeats, 1);
  }
  // without that history nothing repeats
  const free = await brainOf('fast').opponent({ ...payload, history: [] });
  assert.equal(free.choice.line.repeats, 1);
});

test('opponent: the same payload gives the same result on two fresh brains, and the context is handed to the teacher as it is', async () => {
  const fen = boardToFen(fenToBoard(HANGING_ROOK).board, 'black');       // the same board with black to move: the rook is not lost yet
  const profile = createSkillProfile(2);
  const ctx = { ...contextOf(profile, createGameSkill(99), 7, { from: { row: 9, col: 1 }, to: { row: 7, col: 0 }, captured: null }), lastChildCapture: false };
  const payload = { fen, history: [], ply: 13, ctx, tensionPrev: 0.3, evalTwoPliesAgo: -200 };
  const frozen = JSON.stringify(payload);
  const first = await brainOf('fast').opponent(payload);
  const second = await brainOf('fast').opponent(JSON.parse(frozen));
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(payload), frozen, 'the payload is not changed');
  checkOpponentTurn(first, payload);
  // childMoveCp is the value of the child's last move: minus the best score of the rival's table
  assert.ok(first.childMoveCp < 0, 'the child left a rook where it can be attacked for nothing: the rival is ahead');
  assert.equal(first.choice.evalBest, first.childMoveCp);

  // Level 9 in press mode plays the best move of its table, so the choice shows what the context does: the same
  // position with a context that says "the child is far ahead of the band" must not be answered with a gift.
  const strong = { ...ctx, level: 9, bandShift: -2000 };
  const pressed = await brainOf('fast').opponent({ ...payload, ctx: strong });
  assert.equal(pressed.choice.mode, 'press');
  assert.equal(pressed.choice.kind, 'honest');
  assert.equal(pressed.choice.loss, 0);
  assert.equal(pressed.choice.chance, null);
  assert.equal(pressed.choice.overlooked, null);
  // In the quiet ending the rival's table reaches the depth of the plan long before thinkMs is over, in every speed
  // class: the best line, which this rival plays, is exact at opponentDepth.
  const ending = { fen: boardToFen(fenToBoard(ENDING).board, 'black'), history: [], ply: 81, ctx: strong, tensionPrev: 0.1, evalTwoPliesAgo: null };
  for (const speedClass of ['fast', 'mid', 'slow']) {
    const deep = await brainOf(speedClass).opponent(ending);
    checkOpponentTurn(deep, ending);
    assert.equal(deep.choice.kind, 'honest');
    assert.equal(deep.choice.line.depth, PLAN[speedClass].opponentDepth, `${speedClass}: the depth of the rival's table`);
    assert.equal(deep.choice.line.upper, null);
  }
  // a position with no legal move is an error of the caller, not a result
  const stuck = await rejection(brainOf('fast').opponent({ ...payload, fen: MATED }));
  assert.ok(stuck instanceof RangeError);
});

test('opponent: a single legal move is played as it is; a move that mates ends its line in mate, with the tension of the mated position', async () => {
  const profile = { ...createSkillProfile(2), games: 3 };
  const ctx = contextOf(profile, createGameSkill(11), 30, null);

  // One legal move: whatever the teacher would like to do, this is the move.
  const { board } = fenToBoard(ONE_ANSWER);
  assert.deepEqual(getLegalMoves(board, 'black').map(codeOf), ['0304']);
  const forced = { fen: ONE_ANSWER, history: [], ply: 61, ctx, tensionPrev: 0.3, evalTwoPliesAgo: 900 };
  const only = await brainOf('fast').opponent(forced);
  checkOpponentTurn(only, forced);
  assert.equal(only.move.notation, '将4平5');
  assert.equal(only.choice.kind, 'honest');
  assert.equal(only.choice.loss, 0);
  assert.deepEqual(only.quality, { loss: 0, cat: 'best' });
  assert.equal(only.choice.chance, null);
  assert.equal(only.choice.overlooked, null);
  // the rook mates next move: the child is winning, before and after
  assert.equal(only.childMoveCp, 2000);
  assert.equal(only.evalAfter, 2000);
  assert.equal(only.line.end, 'mate');
  assert.deepEqual(only.line.moves.map(codeOf), ['0304', '9313']);       // 车六进八 leaves the king without a move

  // A mate in one for the rival. Every other move leads to a position that has occurred before (the history says so),
  // so by the repetition rule of 4.7.5 the mating move is the only playable one, whatever the level thinks of sparing mates.
  const { board: before } = fenToBoard(RIVAL_MATES);
  const mate = ref('7074');                    // 车1平5
  const mated = applyMove(before, mate);
  assert.ok(isInCheck(mated, 'red'));
  assert.equal(getLegalMoves(mated, 'red').length, 0);
  const others = getLegalMoves(before, 'black').filter(move => !sameMove(move, mate));
  const payload = {
    fen: RIVAL_MATES, history: others.map(move => boardToFen(applyMove(before, move), 'red')), ply: 61, ctx: { ...ctx, level: 1 }, tensionPrev: 0.3, evalTwoPliesAgo: -900,
  };
  const turn = await brainOf('fast').opponent(payload);
  checkOpponentTurn(turn, payload);
  assert.equal(turn.move.notation, '车1平5');
  assert.equal(turn.choice.kind, 'honest');
  assert.equal(turn.facts.check.mate, true);
  assert.deepEqual(turn.line.moves.map(codeOf), ['7074']);
  assert.equal(turn.line.end, 'mate');
  assert.equal(turn.choice.line.mate, 1);
  assert.equal(turn.childMoveCp, -2000);
  assert.equal(turn.evalAfter, -2000);
  assert.deepEqual(turn.quality, { loss: 0, cat: 'best' });
  // checkOpponentTurn has compared the tension with the formula on the facts of the mated position; it is high
  assert.ok(turn.tension > 0.7, `tension ${turn.tension}`);
});

/**
 * Rival decisions (black to move) taken from seeded bot games against a child that moves at random, with the teaching
 * context the game had reached. In each of them the child has just left something to be taken, the child is behind and
 * the rival is weak: the kind of position in which the teacher looks for a move to overlook or to give, and has it verified.
 */
const VERIFY_SCENARIOS = [
  {
    fen: 'rnbakabnr/9/6c2/p1p1p3p/1c7/P8/2P1P1p1P/3CB2CR/9/RNBAKA1N1 b',
    history: ['rnbakabnr/9/6c2/p1p1p3p/1c7/P8/2P1P1p1P/1C2B2CR/9/RNBAKA1N1 w'],
    ply: 11,
    ctx: { level: 1, reveal: 2, bandShift: 0, sinceChance: 104, sinceBlunder: 104, lastKind: 'overlook', spared: 0, aheadRun: 0, chances: 0, moveNo: 6, seed: 1,
      lastChildMove: ref('7173'), lastChildCapture: false, firstGame: false },
  },
  {
    fen: 'r1bakabnr/2n6/9/p3p3p/1c7/P8/2P5P/4B4/4cR3/RNBAK2p1 b',
    history: ['r1bakabnr/2n6/9/p3p3p/1c7/P8/2P5P/4B4/4c3R/RNBAK2p1 w'],
    ply: 33,
    ctx: { level: 1, reveal: 2, bandShift: 0, sinceChance: 1, sinceBlunder: 115, lastKind: 'honest', spared: 0, aheadRun: 0, chances: 3, moveNo: 17, seed: 1,
      lastChildMove: ref('8885'), lastChildCapture: false, firstGame: false },
  },
  {
    fen: '3aka3/8r/2n1b2c1/C1p5p/2b1n4/P1P4r1/3p2p2/3RB4/RC2N4/3AKA3 b',
    history: [],
    ply: 45,
    ctx: { level: 1.5, reveal: 2, bandShift: 0, sinceChance: 4, sinceBlunder: 121, lastKind: 'overlook', spared: 0, aheadRun: 0, chances: 3, moveNo: 23, seed: 2,
      lastChildMove: ref('7030'), lastChildCapture: true, firstGame: false },
  },
  {
    fen: '3aka3/8r/4b2c1/n1p5p/2b1n4/P1P4r1/3p2p2/1R2B4/RC2N4/3AKA3 b',
    history: ['3aka3/8r/4b2c1/n1p5p/2b1n4/P1P4r1/3p2p2/3RB4/RC2N4/3AKA3 w'],
    ply: 47,
    ctx: { level: 1, reveal: 2, bandShift: 0, sinceChance: 5, sinceBlunder: 122, lastKind: 'overlook', spared: 0, aheadRun: 0, chances: 3, moveNo: 24, seed: 2,
      lastChildMove: ref('7371'), lastChildCapture: false, firstGame: false },
  },
  {
    // here the rival has a forced mate, so its table stops at depth 3 (A3.3) and a verify search is complete at once
    fen: 'r1bakab1r/9/n5n2/p3p3p/4c4/P1P6/8P/4B4/1c3R3/RNBA1K1p1 b',
    history: [
      'r1bakabnr/2n6/9/p3p3p/1c7/P8/2P5P/4B4/4c3R/RNBAK2p1 w', 'r1bakabnr/2n6/9/p3p3p/1c7/P8/2P5P/4B4/4cR3/RNBAK2p1 b',
      'r1bakabnr/9/n8/p3p3p/1c7/P8/2P5P/4B4/4cR3/RNBAK2p1 w', 'r1bakabnr/9/n8/p3p3p/1c7/P1P6/8P/4B4/4cR3/RNBAK2p1 b',
      'r1bakabnr/9/n8/p3p3p/4c4/P1P6/8P/4B4/4cR3/RNBAK2p1 w', 'r1bakabnr/5R3/n8/p3p3p/4c4/P1P6/8P/4B4/4c4/RNBAK2p1 b',
      'r1bakabnr/5R3/n8/p3p3p/4c4/P1P6/8P/4B4/1c7/RNBAK2p1 w', 'r1bakabnr/5R3/n8/p3p3p/4c4/P1P6/8P/4B4/1c7/RNBA1K1p1 b',
      'r1bakab1r/5R3/n5n2/p3p3p/4c4/P1P6/8P/4B4/1c7/RNBA1K1p1 w',
    ],
    ply: 41,
    ctx: { level: 1, reveal: 2, bandShift: 0, sinceChance: 5, sinceBlunder: 119, lastKind: 'honest', spared: 0, aheadRun: 0, chances: 3, moveNo: 21, seed: 1,
      lastChildMove: ref('1585'), lastChildCapture: false, firstGame: false },
  },
];

/** The choice of an OpponentTurn is the teacher's own choice; only its two continuations became Lines. */
function assertSameChoice(actual, expected, what) {
  assert.equal(codeOf(actual.move), codeOf(expected.move), `${what}: move`);
  assert.equal(actual.kind, expected.kind, `${what}: kind`);
  assert.deepEqual(actual.line, expected.line, `${what}: the chosen root line`);
  for (const key of ['mode', 'loss', 'evalAfter', 'evalBest']) assert.equal(actual[key], expected[key], `${what}: ${key}`);
  for (const key of ['chance', 'overlooked']) {
    if (expected[key] === null) {
      assert.equal(actual[key], null, `${what}: ${key}`);
      continue;
    }
    const { line: pv, ...numbers } = expected[key];                    // the teacher's PV stands in the place of the Line
    const { line, ...own } = actual[key];
    assert.deepEqual(own, numbers, `${what}: ${key}`);
    assert.deepEqual(line.moves.map(codeOf), pv.map(codeOf), `${what}: every move of the ${key} PV is in the Line`);
  }
}

/**
 * More rival decisions of the same kind, made on the spot: the position after 15 plies of a seeded random playout
 * (black to move) with the context of a weak rival. The teacher's gift rules are tuned separately, so which of the
 * decisions above still make it verify a move is not for this file to pin: when too few of them do, these are tried.
 */
function* generatedVerifyScenarios() {
  for (let seed = 1; seed <= 40; seed++) {
    const game = playout({ seed: 4100 + seed, plies: 15 });
    const last = game[game.length - 1];
    if (last.turn !== 'black' || last.moves.length === 0) continue;
    let history = [];
    for (let i = 1; i < game.length; i++) history = game[i].move.captured ? [] : [...history, boardToFen(game[i - 1].board, game[i - 1].turn)];
    yield {
      fen: boardToFen(last.board, 'black'),
      history,
      ply: last.ply,
      ctx: { level: 1, reveal: 2, bandShift: 0, sinceChance: 99, sinceBlunder: 99, lastKind: 'honest', spared: 0, aheadRun: 0, chances: 3, moveNo: 8, seed,
        lastChildMove: { from: last.move.from, to: last.move.to }, lastChildCapture: last.move.captured !== null, firstGame: false },
    };
  }
}

test('opponent: the teacher gets the table and the verify lines of the search unchanged; a used-up verification budget ends the selection', async t => {
  const plan = PLAN.fast;
  let decisive = 0;
  const seen = [];
  /** Checks one rival decision. With `onlyDecisive` a decision in which verification does not decide the move is skipped. */
  const check = async (scenario, label, onlyDecisive) => {
    const { fen, history, ply, ctx } = scenario;
    const payload = { fen, history, ply, ctx, tensionPrev: 0.2, evalTwoPliesAgo: null };

    // The twin: a plain searcher that is asked what the job asks (4.8.2 step 1), and the real teacher on its table with
    // a verify that is the single-move search of 4.8.1 with no deadline. On this clock the job's own searches are the
    // same searches, read for read, so the job must come to the same choice with the same root line.
    const twin = createSearcher();
    const before = clock.reads;
    const table = twin.analyzeSync({ fen, history, allDepth: plan.allDepth, multiPV: 6, maxDepth: plan.opponentDepth, timeMs: plan.thinkMs });
    const tableReads = clock.reads - before;
    const asked = [];
    const unlimited = await chooseTeachingMove(table, ctx, async move => {
      const line = twin.analyzeSync({ fen, history, rootMoves: [move], maxDepth: table.depth, minDepth: Math.min(table.depth, 4), timeMs: FOREVER }).lines[0];
      asked.push(line);
      return line;
    });
    // What the teacher does when its first verify call finds the budget used up.
    const exhausted = await chooseTeachingMove(table, ctx, async () => null);
    const decides = asked.length > 0 && table.depth >= 5 && codeOf(unlimited.move) !== codeOf(exhausted.move);
    if (onlyDecisive && !decides) return;

    // The job reads the clock tableReads times for its table, once for the verification deadline, then once in every
    // verify call before it searches. A jump back at that read: the deadline never comes, as for the twin.
    // (Each run is on a fresh brain, created before the reads of its job are counted.)
    const frozen = JSON.stringify(ctx);
    const free = brainOf('fast');
    const turn = await withJump(tableReads + 2, -FOREVER, () => free.opponent(payload));
    checkOpponentTurn(turn, payload);
    assertSameChoice(turn.choice, unlimited, label);
    assert.equal(turn.childMoveCp, -scoreToCp(table.lines[0].score));
    assert.equal(JSON.stringify(ctx), frozen, 'the context is not changed');

    // A jump of more than verifyMs at that read: the first call comes too late and is answered without a search.
    const late = brainOf('fast');
    const tooLate = await withJump(tableReads + 2, plan.verifyMs + 10, () => late.opponent(payload));
    checkOpponentTurn(tooLate, payload);
    assertSameChoice(tooLate.choice, exhausted, `${label}, the deadline passes before the first verify call`);

    // A jump that leaves 1 ms of the budget: the first verify search stops at once, with the iterations up to minDepth 4
    // done, which is shallower than a table of depth 5 or more. The job hands that line to the teacher as it is, and
    // the teacher reads "budget used up" from it, unless the line is decisive already (a mate or a repetition verdict).
    const early = asked.length > 0 ? asked[0].byDepth[Math.min(asked[0].byDepth.length, 4) - 1] : 0;
    if (table.depth >= 5 && Math.abs(early) < WIN) {
      const cut = brainOf('fast');
      const stopped = await withJump(tableReads + 2, plan.verifyMs - TICK - 1, () => cut.opponent(payload));
      checkOpponentTurn(stopped, payload);
      assertSameChoice(stopped.choice, exhausted, `${label}, the deadline passes inside the first verify search`);
    }
    if (decides) decisive++;
    seen.push(`depth ${table.depth}, ${asked.length} verify, ${unlimited.kind} / ${exhausted.kind}`);
  };

  for (const [index, scenario] of VERIFY_SCENARIOS.entries()) await check(scenario, `scenario ${index}`, false);
  // In at least two decisions with a table of depth 5 or more the verification must decide the move, or the three runs
  // above were three times the same game. Further decisions are tried until there are two.
  let generated = 0;
  for (const scenario of generatedVerifyScenarios()) {
    if (decisive >= 2) break;
    generated++;
    await check(scenario, `generated scenario ${generated}`, true);
  }
  t.diagnostic(`verify scenarios (table depth, verify calls, kind with budget / kind without): ${seen.join('; ')}; generated decisions tried: ${generated}`);
  assert.ok(decisive >= 2, `the teacher needed verify in ${decisive} scenarios`);
});

test('opponent: a cancel or a newer job that arrives inside a verification search ends the job with {cancelled: true}', async t => {
  const plan = PLAN.fast;
  // Find a rival decision in which a verification search yields. A plain searcher that is asked for the job's table with
  // a yield hook is, read for read, the table search of the job, so it tells how many yields belong to the table. The
  // job yields once more between the table and the selection; every later yield lies inside a verification search.
  let found = null, tried = 0;
  for (const scenario of [...VERIFY_SCENARIOS, ...generatedVerifyScenarios()]) {
    const { fen, history, ply, ctx } = scenario;
    const payload = { fen, history, ply, ctx, tensionPrev: 0.2, evalTwoPliesAgo: null };
    tried++;
    let tableYields = 0;
    await createSearcher().analyze({ fen, history, allDepth: plan.allDepth, multiPV: 6, maxDepth: plan.opponentDepth, timeMs: plan.thinkMs }, {
      cancelled: false, yield: async () => { tableYields++; },
    });
    let total = 0;
    await brainOf('fast').opponent(payload, { cancelled: false, yield: async () => { total++; } });
    assert.ok(total >= tableYields + 1, 'the job yields in its table search and once after it');
    if (total >= tableYields + 3) {
      found = { payload, first: tableYields + 2, total };
      break;
    }
  }
  assert.ok(found !== null, `none of ${tried} rival decisions has a verification search that yields`);
  const { payload, first, total } = found;
  t.diagnostic(`rival decision ${tried}: ${total} yields, ${total - first + 1} of them inside verification searches`);

  // A cancel at each of those yields. Every run is on a fresh brain: the same job, read for read, up to the cancel.
  for (let at = first; at <= total; at++) {
    let yields = 0;
    const ctl = {
      cancelled: false,
      yield: async () => {
        if (++yields >= at) ctl.cancelled = true;
      },
    };
    assert.deepEqual(await rejection(brainOf('fast').opponent(payload, ctl)), { cancelled: true }, `cancelled at yield ${at} of ${total}`);
    assert.equal(yields, at, 'the job stops at the yield that cancelled it: the teacher gets no "budget used up" to go on with');
  }

  // A newer job that starts while the older one is parked at such a yield takes the searcher over.
  const brain = brainOf('fast');
  let yields = 0, newer = null;
  const older = brain.opponent(payload, {
    cancelled: false,
    yield: async () => {
      if (++yields === first) newer = brain.analyze({ fen: START, timeMs: FOREVER, maxDepth: 3 });
    },
  });
  assert.deepEqual(await rejection(older), { cancelled: true });
  assert.equal(yields, first);
  const analysis = await newer;
  assert.equal(analysis.depth, 3);
  assert.equal(analysis.stopped, 'depth');
  assert.equal(analysis.lines.length, 44);
  // and the brain goes on: the same decision once more, undisturbed
  checkOpponentTurn(await brain.opponent(payload), payload);
});

// ---------------------------------------------------------------------------------------------------------------
// cancellation
// ---------------------------------------------------------------------------------------------------------------

test('cancelling each job rejects with {cancelled: true} and leaves the brain usable', async () => {
  const brain = brainOf('fast');
  const profile = createSkillProfile(2);
  const jobs = {
    survey: ctl => brain.survey(surveyPayload(REFERENCE_POSITIONS.middlegameA), ctl),
    assess: ctl => brain.assess({ fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: null, level: 3, compare: null }, ctl),
    opponent: ctl => brain.opponent({
      fen: REFERENCE_POSITIONS.middlegameB, history: [], ply: 21, ctx: contextOf(profile, createGameSkill(5), 11, null), tensionPrev: 0.1, evalTwoPliesAgo: null,
    }, ctl),
    analyze: ctl => brain.analyze({ fen: START, timeMs: FOREVER, maxDepth: 30 }, ctl),
  };
  for (const [kind, start] of Object.entries(jobs)) {
    // cancelled at the n-th yield: between two steps of the job, or between two root moves of a search
    for (const at of [1, 2, 5, 15]) {
      let yields = 0;
      const progress = [];
      const ctl = {
        cancelled: false,
        onProgress: stage => progress.push({ stage, afterCancel: ctl.cancelled }),
        yield: async () => {
          if (++yields >= at) ctl.cancelled = true;
        },
      };
      assert.deepEqual(await rejection(start(ctl)), { cancelled: true }, `${kind}, cancelled at yield ${at}`);
      assert.equal(yields, at, `${kind}: the job stops at the yield that cancelled it`);
      assert.ok(progress.every(event => !event.afterCancel), `${kind}: no progress after the cancel`);
    }
    // cancelled before it starts
    let touched = false;
    const dead = { cancelled: true, onProgress: () => { touched = true; }, yield: async () => { touched = true; } };
    assert.deepEqual(await rejection(start(dead)), { cancelled: true });
    assert.equal(touched, false, `${kind}: a job that is cancelled from the start does nothing`);
  }

  // Cancelled at its very last yield, when all that is left is to put the result together: still a cancellation.
  // (Two fresh brains run the same job read for read; the first run counts the yields.)
  const short = {
    survey: (engine, ctl) => engine.survey(surveyPayload(ENDING, { ply: 80 }), ctl),
    assess: (engine, ctl) => engine.assess({ fen: ENDING, history: [], ply: 80, move: ref('6252'), table: null, level: 3, compare: null }, ctl),
    opponent: (engine, ctl) => engine.opponent({
      fen: boardToFen(fenToBoard(ENDING).board, 'black'), history: [], ply: 81, ctx: contextOf(profile, createGameSkill(5), 11, null), tensionPrev: 0.1, evalTwoPliesAgo: null,
    }, ctl),
    analyze: (engine, ctl) => engine.analyze({ fen: ENDING, timeMs: FOREVER, maxDepth: 6 }, ctl),
  };
  for (const [kind, start] of Object.entries(short)) {
    let total = 0;
    await start(brainOf('fast'), { cancelled: false, yield: async () => { total++; } });
    assert.ok(total >= 2, `${kind}: ${total} yields`);
    let yields = 0;
    const ctl = {
      cancelled: false,
      yield: async () => {
        if (++yields === total) ctl.cancelled = true;
      },
    };
    assert.deepEqual(await rejection(start(brainOf('fast'), ctl)), { cancelled: true }, `${kind}, cancelled at its last yield (${total})`);
    assert.equal(yields, total);
  }

  // the brain is still usable: every kind of job runs to its end
  const survey = await jobs.survey({ cancelled: false, yield: nextTask });
  assert.equal(survey.moves.length, getLegalMoves(fenToBoard(REFERENCE_POSITIONS.middlegameA).board, 'red').length);
  assert.ok(survey.table.depth >= 2);
  const assessed = await jobs.assess({ cancelled: false, yield: nextTask });
  assert.equal(assessed.assessment.refutation.danger, 'hangs_moved_piece');
  const turn = await jobs.opponent({ cancelled: false, yield: nextTask });
  assert.ok(getLegalMoves(fenToBoard(REFERENCE_POSITIONS.middlegameB).board, 'red').some(move => sameMove(move, turn.move)));
  const depths = [];
  const analysis = await brain.analyze({ fen: START, timeMs: FOREVER, maxDepth: 3 }, { cancelled: false, yield: nextTask, onProgress: (stage, data) => depths.push(`${stage} ${data.depth}`) });
  assert.equal(analysis.depth, 3);
  assert.equal(analysis.stopped, 'depth');
  assert.equal(analysis.lines.length, 44);
  assert.deepEqual(depths, ['table 1', 'table 2', 'table 3'], 'analyze reports every finished iteration');
});

test('a job that is started while another one runs takes the searcher over: the older job rejects with {cancelled: true}', async () => {
  const brain = brainOf('fast');
  const progress = [];
  const older = brain.survey(surveyPayload(REFERENCE_POSITIONS.middlegameA), { cancelled: false, yield: nextTask, onProgress: stage => progress.push(stage) });
  // the older job is parked at its first yield; the newer one has no yield hook and runs to its end at once
  const newer = await brain.analyze({ fen: START, timeMs: FOREVER, maxDepth: 3 });
  assert.equal(newer.depth, 3);
  assert.equal(newer.stopped, 'depth');
  assert.deepEqual(await rejection(older), { cancelled: true });
  assert.deepEqual(progress, ['facts'], 'the superseded job reports nothing after it lost the searcher');
  // and the next job runs as usual
  const again = await brain.survey(surveyPayload(MATE_IN_ONE));
  assert.equal(again.table.lines[0].mate, 1);

  // the same when the older job is parked between two root moves of a search, and the newer job is of another kind
  for (const at of [3, 9]) {
    let yields = 0, started = null;
    const reported = [];
    const parked = brain.survey(surveyPayload(REFERENCE_POSITIONS.middlegameA), {
      cancelled: false,
      onProgress: stage => reported.push({ stage, afterNewer: started !== null }),
      yield: async () => {
        if (++yields === at) started = brain.assess({ fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: null, level: 3, compare: null });
      },
    });
    assert.deepEqual(await rejection(parked), { cancelled: true });
    assert.equal(yields, at, 'the superseded job does not go on to its next yield');
    assert.ok(reported.every(event => !event.afterNewer), 'and reports nothing more');
    assert.equal((await started).assessment.refutation.danger, 'hangs_moved_piece');
  }
});

// ---------------------------------------------------------------------------------------------------------------
// the worker (contract section 4.9), in a Node worker thread with the real clock
// ---------------------------------------------------------------------------------------------------------------

/** Starts src/core/search-worker.js in a worker thread and records every message it sends. */
function startWorker() {
  const worker = new Worker(new URL('../../../src/core/search-worker.js', import.meta.url));
  const log = [];
  let waiters = [];
  let failure = null;
  const wake = () => {
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) waiter();
  };
  worker.on('message', message => {
    log.push(message);
    wake();
  });
  worker.on('error', error => {
    failure = error;
    wake();
  });
  /** Resolves with the first message (from index `from` on) that satisfies `test`; rejects after 30 s or when the worker fails. */
  const until = (testMessage, from = 0) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no such message within 30 s; got ${JSON.stringify(log.map(m => [m.t, m.id]))}`)), 30000);
    const look = () => {
      if (failure !== null) {
        clearTimeout(timer);
        reject(failure);
        return;
      }
      const found = log.slice(from).find(testMessage);
      if (found !== undefined) {
        clearTimeout(timer);
        resolve(found);
      } else {
        waiters.push(look);
      }
    };
    look();
  });
  const terminal = id => until(message => message.id === id && ['done', 'cancelled', 'error'].includes(message.t));
  return { worker, log, until, terminal, post: message => worker.postMessage(message) };
}

test('search-worker in worker_threads: hello and ready, queued jobs, progress and done, latest wins, cancel, errors, one terminal message per job', async () => {
  const { worker, log, until, terminal, post } = startWorker();
  try {
    const quick = { fen: START, timeMs: 60000, maxDepth: 2 };
    const long = { fen: START, timeMs: 600000, maxDepth: 40 };

    // Jobs posted before `ready` are queued and the last one wins: job 1 never starts.
    post({ t: 'job', id: 1, kind: 'analyze', payload: quick });
    post({ t: 'job', id: 2, kind: 'analyze', payload: quick });
    post({ t: 'hello' });
    const done2 = await terminal(2);
    const ready = log.find(message => message.t === 'ready');
    assert.deepEqual(Object.keys(ready).sort(), ['protocol', 'speed', 't']);
    assert.equal(ready.protocol, 1);
    assert.ok(Number.isInteger(ready.speed.perftNps) && ready.speed.perftNps > 0);
    assert.ok(['fast', 'mid', 'slow'].includes(ready.speed.speedClass));
    assert.deepEqual(log[0], { t: 'cancelled', id: 1 });
    assert.equal(log[1], ready, 'ready comes before anything of the queued job');
    assert.deepEqual(log.slice(2).map(message => [message.t, message.id, message.kind, message.stage]), [
      ['progress', 2, 'analyze', 'table'], ['progress', 2, 'analyze', 'table'], ['done', 2, 'analyze', undefined],
    ]);
    assert.equal(done2.data.depth, 2);
    assert.equal(done2.data.lines.length, 44);
    assert.deepEqual(log[3].data.lines, done2.data.lines);

    // A survey: facts, tables, threat, and a result that crossed the thread as plain JSON.
    post({ t: 'job', id: 3, kind: 'survey', payload: surveyPayload(MATE_IN_ONE) });
    const done3 = await terminal(3);
    assert.equal(done3.t, 'done');
    assert.equal(done3.kind, 'survey');
    assert.deepEqual(log.filter(message => message.id === 3).map(message => message.stage ?? message.t), ['facts', 'table', 'table', 'threat', 'done']);
    assert.equal(done3.data.fen, MATE_IN_ONE);
    assert.equal(done3.data.moves[0].notation, '车九平五');
    assert.equal(done3.data.table.lines[0].mate, 1);
    assert.deepEqual(done3.data.facts, positionFacts(MATE_IN_ONE, { ply: 10 }));

    // Latest wins: a job that arrives while another runs cancels it and starts when it has unwound.
    post({ t: 'job', id: 4, kind: 'analyze', payload: long });
    await until(message => message.t === 'progress' && message.id === 4);
    post({ t: 'job', id: 5, kind: 'analyze', payload: quick });
    assert.equal((await terminal(5)).t, 'done');
    const cancelled4 = log.findIndex(message => message.id === 4 && message.t === 'cancelled');
    assert.ok(cancelled4 >= 0, 'the superseded job is cancelled');
    assert.ok(log.findIndex(message => message.id === 5) > cancelled4, 'the new job starts after the old one has unwound');

    // A cancel for an id that is not running is ignored; a cancel for the running job stops it. The worker takes its
    // messages in order, so when it answers the hello that follows the two cancels it has dealt with them: progress of
    // job 6 that arrives after that answer shows that the job is still running.
    post({ t: 'job', id: 6, kind: 'analyze', payload: long });
    await until(message => message.t === 'progress' && message.id === 6);
    post({ t: 'cancel', id: 999 });
    post({ t: 'cancel', id: 5 });
    post({ t: 'hello' });
    const marker = await until(message => message.t === 'ready', log.indexOf(ready) + 1);
    await until(message => message.t === 'progress' && message.id === 6, log.indexOf(marker) + 1);
    post({ t: 'cancel', id: 6 });
    assert.deepEqual(await terminal(6), { t: 'cancelled', id: 6 });

    // A cancel without an id stops whatever is running, and the job that waits behind it.
    post({ t: 'job', id: 7, kind: 'analyze', payload: long });
    await until(message => message.t === 'progress' && message.id === 7);
    post({ t: 'job', id: 8, kind: 'analyze', payload: quick });
    post({ t: 'cancel' });
    assert.deepEqual(await terminal(7), { t: 'cancelled', id: 7 });
    assert.deepEqual(await terminal(8), { t: 'cancelled', id: 8 });

    // A job that waits is cancelled by its id, and replaced by a later one, without ever starting.
    post({ t: 'job', id: 9, kind: 'analyze', payload: long });
    await until(message => message.t === 'progress' && message.id === 9);
    post({ t: 'job', id: 10, kind: 'analyze', payload: quick });
    post({ t: 'job', id: 11, kind: 'analyze', payload: quick });
    post({ t: 'cancel', id: 11 });
    post({ t: 'job', id: 12, kind: 'analyze', payload: quick });
    assert.equal((await terminal(12)).t, 'done');
    for (const id of [9, 10, 11]) assert.deepEqual(log.filter(message => message.id === id && message.t !== 'progress'), [{ t: 'cancelled', id }]);
    for (const id of [10, 11]) assert.equal(log.filter(message => message.id === id).length, 1, 'a job that never started sends nothing but its terminal message');

    // Errors fail the job and keep the worker.
    post({ t: 'job', id: 13, kind: 'explore', payload: {} });
    const error13 = await terminal(13);
    assert.equal(error13.t, 'error');
    assert.match(error13.message, /explore/);
    post({ t: 'job', id: 14, kind: 'assess', payload: { fen: START, history: [], ply: 0, move: ref('6061'), table: null, level: 3, compare: null } });
    const error14 = await terminal(14);
    assert.equal(error14.t, 'error');
    assert.equal(typeof error14.message, 'string');
    assert.ok(error14.message.length > 0);

    // The other two kinds of job run in the worker as well.
    post({ t: 'job', id: 15, kind: 'assess', payload: { fen: HORSE_OUT, history: [], ply: 6, move: HORSE_TO_PAWN, table: null, level: 3, compare: null } });
    const done15 = await terminal(15);
    assert.equal(done15.t, 'done');
    assert.equal(done15.data.assessment.refutation.danger, 'hangs_moved_piece');
    const fen = boardToFen(fenToBoard(START).board, 'black');
    post({ t: 'job', id: 16, kind: 'opponent', payload: { fen, history: [], ply: 1, ctx: contextOf(createSkillProfile(2), createGameSkill(1), 1, null), tensionPrev: 0.1, evalTwoPliesAgo: null } });
    const done16 = await terminal(16);
    assert.equal(done16.t, 'done');
    assert.ok(getLegalMoves(fenToBoard(fen).board, 'black').some(move => sameMove(move, done16.data.move)));

    // A further hello answers ready again and keeps the worker as it is (so did the one above, while a job was running).
    post({ t: 'hello' });
    const again = await until(message => message.t === 'ready', log.indexOf(marker) + 1);
    assert.deepEqual(again, ready);
    assert.deepEqual(marker, ready);
    assert.equal(log.filter(message => message.t === 'ready').length, 3);

    // Every job id has exactly one terminal message, and nothing follows it.
    for (let id = 1; id <= 16; id++) {
      const own = log.filter(message => message.id === id);
      const ends = own.filter(message => ['done', 'cancelled', 'error'].includes(message.t));
      assert.equal(ends.length, 1, `job ${id} has ${ends.length} terminal messages`);
      assert.equal(own[own.length - 1], ends[0], `job ${id}: nothing follows the terminal message`);
    }
    assert.ok(log.every(message => message.id !== 999), 'an unknown id is never answered');
  } finally {
    await worker.terminate();
  }
});

test('search-worker in worker_threads: a cancel before ready, ttBits of hello, messages that are not jobs, a repeated id, a burst of jobs for different positions', async () => {
  const small = startWorker(), plain = startWorker();
  try {
    const quick = { fen: START, timeMs: 60000, maxDepth: 2 };
    const long = { fen: START, timeMs: 600000, maxDepth: 40 };
    // bounded by its depth alone (minDepth = maxDepth), so the number of nodes depends on nothing but the transposition table
    const fixed = { fen: REFERENCE_POSITIONS.middlegameA, maxDepth: 4, minDepth: 4, allDepth: 2, multiPV: 3, timeMs: 600000 };

    // Before ready a job only waits: a cancel without an id, or with its id, gives it up, and nothing of it ever runs.
    small.post({ t: 'job', id: 1, kind: 'analyze', payload: quick });
    small.post({ t: 'cancel' });
    small.post({ t: 'job', id: 2, kind: 'analyze', payload: quick });
    small.post({ t: 'cancel', id: 2 });
    small.post({ t: 'hello', ttBits: 8 });
    small.post({ t: 'job', id: 3, kind: 'analyze', payload: fixed });
    plain.post({ t: 'hello' });
    plain.post({ t: 'job', id: 3, kind: 'analyze', payload: fixed });
    const [tiny, usual] = await Promise.all([small.terminal(3), plain.terminal(3)]);
    assert.deepEqual(small.log.slice(0, 3).map(message => [message.t, message.id]), [['cancelled', 1], ['cancelled', 2], ['ready', undefined]]);
    assert.ok(small.log.slice(3).every(message => message.id === 3));

    // hello's ttBits reaches the brain: each worker walks exactly the tree of a plain searcher with a table of that size
    assert.equal(tiny.t, 'done');
    assert.equal(usual.t, 'done');
    assert.equal(tiny.data.depth, 4);
    assert.equal(tiny.data.nodes, createSearcher({ ttBits: 8 }).analyzeSync(fixed).nodes);
    assert.equal(usual.data.nodes, createSearcher().analyzeSync(fixed).nodes);
    assert.notEqual(tiny.data.nodes, usual.data.nodes);

    // Messages that are not jobs are ignored; a job without a numeric id is answered with an error that carries the id
    // as it came, and disturbs nothing.
    for (const junk of [null, 'job', 42, [], {}, { t: 'nonsense', id: 4 }, { id: 4, kind: 'analyze', payload: quick }]) plain.post(junk);
    plain.post({ t: 'job', kind: 'analyze', payload: quick });
    plain.post({ t: 'job', id: 'seven', kind: 'analyze', payload: quick });
    plain.post({ t: 'job', id: 5, kind: 'analyze', payload: quick });
    const done5 = await plain.terminal(5);
    assert.equal(done5.t, 'done');
    const since = plain.log.slice(plain.log.indexOf(usual) + 1);
    assert.deepEqual(since.slice(0, 2).map(message => [message.t, message.id, typeof message.message]), [['error', undefined, 'string'], ['error', 'seven', 'string']]);
    assert.deepEqual(Object.keys(since[1]).sort(), ['id', 'message', 't']);
    assert.ok(since.slice(2).every(message => message.id === 5), 'nothing else is answered');

    // A job message with the id of the running job is ignored: the job goes on, and ends once. The hello behind it is
    // answered when the worker has dealt with it; progress of a third iteration or more that arrives after that answer
    // comes from the first job (the second would end after two iterations).
    plain.post({ t: 'job', id: 6, kind: 'analyze', payload: long });
    await plain.until(message => message.t === 'progress' && message.id === 6);
    plain.post({ t: 'job', id: 6, kind: 'analyze', payload: quick });
    plain.post({ t: 'hello' });
    const marker = await plain.until(message => message.t === 'ready', plain.log.findIndex(message => message.t === 'ready') + 1);
    await plain.until(message => message.t === 'progress' && message.id === 6 && message.data.depth >= 3, plain.log.indexOf(marker) + 1);
    plain.post({ t: 'cancel', id: 6 });
    assert.deepEqual(await plain.terminal(6), { t: 'cancelled', id: 6 });

    // A burst of surveys for different positions (a child that taps quickly): only the last one is answered with a
    // result, every message is about the position of its own job, and once a job has started nothing of an older one arrives.
    const fens = [START, REFERENCE_POSITIONS.middlegameA, REFERENCE_POSITIONS.middlegameB, HORSE_OUT, HANGING_ROOK, MATE_IN_ONE];
    const from = plain.log.length;
    fens.forEach((fen, index) => plain.post({ t: 'job', id: 10 + index, kind: 'survey', payload: surveyPayload(fen) }));
    const last = await plain.terminal(15);
    assert.equal(last.t, 'done');
    assert.equal(last.data.fen, MATE_IN_ONE);
    assert.equal(last.data.table.fen, MATE_IN_ONE);
    assert.equal(last.data.moves[0].notation, '车九平五');
    const burst = plain.log.slice(from);
    for (let id = 10; id < 15; id++) {
      assert.deepEqual(burst.filter(message => message.id === id && message.t !== 'progress'), [{ t: 'cancelled', id }]);
    }
    let started = 0;
    for (const message of burst) {
      assert.ok(message.id >= started, `a message of job ${message.id} after job ${started} had started`);
      if (message.t !== 'cancelled') started = message.id;
      if (message.t !== 'progress') continue;
      const fen = fens[message.id - 10];
      if (message.stage === 'threat') assert.ok(message.data === null || message.data.line.start.split(' ')[0] === fen.split(' ')[0]);
      else assert.equal(message.data.fen, fen, `${message.stage} of job ${message.id} is about its own position`);
    }

    // Every job of both workers has exactly one terminal message, and nothing follows it. (The burst is over, so every
    // earlier job has unwound: a second terminal message of the repeated id 6 would be here by now.)
    for (const { log } of [small, plain]) {
      const ids = new Set(log.map(message => message.id).filter(id => typeof id === 'number'));
      assert.ok(ids.size >= 3);
      for (const id of ids) {
        const own = log.filter(message => message.id === id);
        const ends = own.filter(message => ['done', 'cancelled', 'error'].includes(message.t));
        assert.equal(ends.length, 1, `job ${id} has ${ends.length} terminal messages`);
        assert.equal(own[own.length - 1], ends[0], `job ${id}: nothing follows the terminal message`);
      }
    }
  } finally {
    await Promise.all([small.worker.terminate(), plain.worker.terminate()]);
  }
});
