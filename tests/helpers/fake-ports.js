// Test doubles for the director (SPEC 14.4): BrainPort / CoachPort / StagePort fakes writing one call log. Owner: G4.
//
//   createFakePorts()        the three ports; every call is appended to one `log` as {op, args}
//   fakeTable / fakeSurvey / fakeAssessed / fakeOpponentTurn
//                            plain-JSON job results built from a job payload with the rules engine: what the fake
//                            worker answers with (every legal move, real notations, values chosen by the test)
//   createDirectorRig()      a real session, a real task manager on a fake worker with virtual timers, a real store on
//                            memory storage and the fake ports, subscribed in the order of app.js (SPEC 4.27)
//
// What the fakes keep of the real modules, so that the order of effects can be tested without them:
// - the stage keeps what it was last told (the board, the trial, the phase, the chips, every line of the strategist);
// - a coach thread calls its handlers the way the client does (onStart inside the call; a local answer completes inside the
//   call; 'silent' calls nothing; an aborted reply gets no handler call and resolves {aborted:true}), counts the requests
//   that would have left for the proxy (`fetches`) and records every use the wire rules would reject (`violations`);
// - the brief applies the rules of SPEC 4.14 that the director's decisions hang on (`held`, `isEarned`, `worthSpeaking`,
//   `punishes`, the over packet) to the fake results; everything else is a fixed, valid shape;
// - the teacher functions are the real ones (pure, final), wrapped so that their calls show in the log.
// Large values (boards, tables) appear in the log by reference: tests compare them by identity or read single fields,
// never with deepEqual (CONTRACT-NOTES 128).

/**
 * @import { Board, Color, Square, Move, MoveRef, MoveInfo, Piece, PieceRef, Line, Analysis, RootLine, PositionFacts, MoveFacts, MaterialOutcome,
 *           Quick, Hint, Survey, Assessed, OpponentTurn, SurveyPayload, AssessPayload, OpponentPayload, TeachingChoice, TacticalTest, ThreatInfo,
 *           Hanging, Pattern, GameSkill, Takeaway } from '../../src/core/types.js'
 * @import { Cat, HabitCode, DangerCode, MotifCode, PatternCode } from '../../src/core/codes.js'
 * @import { TurnBrief, TryPacket, MorePacket, OverPacket, Segment, MoveLink, WPiece, Net, WLine, Moment, OppMove, Threat, CoachEvent,
 *           Hint1, Hint2, Hint3 } from '../../src/coach/types.js'
 * @import { MoveBook } from '../../src/coach/book.js'
 * @import { GameMemory } from '../../src/coach/memory.js'
 * @import { TurnReport } from '../../src/coach/brief.js'
 * @import { BrainPort, CoachPort, StagePort, StageHandlers, StageView, ChipSpec, Thread, Handlers, Reply, ReplyOpts, ReplyResult, SayMode,
 *           CoachOffReason, Settings, Profile, SavedGame, Phase, OverView } from '../../src/game/types.js'
 * @import { FakeJobMessage, FakeWorker } from './fake-worker.js'
 */

import { applyMove, boardToFen, fenToBoard, getLegalMoves, isInCheck, opposite, pieceLabel } from '../../src/core/engine.js';
import { describeMove } from '../../src/core/notation.js';
import { CUE, HABIT_OF_DANGER, NOTABLE_MOTIFS, PT_OF, TACTIC_MOTIFS } from '../../src/core/codes.js';
import * as teacher from '../../src/core/teacher.js';
import { createSession } from '../../src/game/session.js';
import { createTasks } from '../../src/game/tasks.js';
import { createStore } from '../../src/game/store.js';
import { createDirector } from '../../src/game/director.js';
import { createFakeWorkers, createVirtualTimers, tick } from './fake-worker.js';
import { createMemoryStorage } from './memory-storage.js';
import { mulberry32 } from './playout.js';

/** @typedef {{op:string, args:unknown[]}} LogEntry */

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

/** @param {MoveRef} a @param {MoveRef} b */
const sameMove = (a, b) => a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
/** @param {MoveRef} m @returns {MoveRef} */
const refOf = (m) => ({ from: { row: m.from.row, col: m.from.col }, to: { row: m.to.row, col: m.to.col } });
/** @param {MoveRef} m */
const codeOf = (m) => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}`;
/** @param {number} score */
const cp = (score) => (score >= 29800 ? 2000 : score <= -29800 ? -2000 : Math.max(-1900, Math.min(1900, score)));
/** @returns {MaterialOutcome} */
const noOutcome = () => ({ net: 0, won: [], lost: [], kind: 'none', mate: null, plies: 1, settled: true });

/** @param {Board} board @param {Square} at @returns {PieceRef} */
function pieceRefAt(board, at) {
  const piece = /** @type {Piece} */ (board[at.row][at.col]);
  const label = pieceLabel(piece);
  return { type: piece.type, color: piece.color, at: { row: at.row, col: at.col }, label, name: label };
}

/** @param {PieceRef|{type:Piece['type'], color:Color, at:Square}} ref @param {Color} me @returns {WPiece} */
function wpiece(ref, me) {
  return { s: ref.color === me ? 'me' : 'opp', t: PT_OF[ref.type], f: ref.color === 'red' ? 9 - ref.at.col : ref.at.col + 1 };
}

/** Text of a list of segments. @param {Segment[]} segments @returns {string} */
export function segmentsText(segments) {
  return segments.map((seg) => (seg.type === 'move' ? `【${seg.notation}】` : seg.text)).join('');
}

// ---------------------------------------------------------------------------------------------------------------------
// Job results (plain JSON, as the worker would send them)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A table of every legal move of `fen`. Scores are `-index` in the engine's move order unless `scoreOf` gives them;
 * `best` (with `bestScore`, default 40) puts one move in front.
 * @param {string} fen
 * @param {{depth?:number, best?:MoveRef, bestScore?:number, scoreOf?:(move:MoveRef, index:number) => number}} [opts]
 * @returns {Analysis}
 */
export function fakeTable(fen, opts = {}) {
  const { board, turn } = fenToBoard(fen);
  const depth = opts.depth ?? 4;
  /** @type {RootLine[]} */
  const lines = getLegalMoves(board, turn).map((m, index) => {
    const move = refOf(m);
    let score = opts.scoreOf ? opts.scoreOf(move, index) : -index;
    if (opts.best && sameMove(opts.best, move)) score = opts.bestScore ?? 40;
    return { move, score, depth, upper: null, mate: null, pv: [move], byDepth: Array.from({ length: depth }, () => score), naive: score, repeats: 1 };
  });
  lines.sort((a, b) => b.score - a.score);
  return { fen, turn, depth, allDepth: Math.min(depth, 4), lines, nodes: 1000, timeMs: 5, stopped: 'depth' };
}

/**
 * Position facts with every piece listed and nothing else known.
 * @param {string} fen @param {{hanging?:Hanging[], patterns?:Pattern[]}} [opts]
 * @returns {PositionFacts}
 */
export function fakeFacts(fen, opts = {}) {
  const { board, turn } = fenToBoard(fen);
  /** @type {PositionFacts['pieces']} */
  const pieces = [];
  /** @type {Record<Color, Square>} */
  const kings = { red: { row: 9, col: 4 }, black: { row: 0, col: 4 } };
  let red = 0, black = 0;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      pieces.push({ piece: pieceRefAt(board, { row, col }), attackers: [], defenders: [], status: 'safe' });
      if (piece.type === 'king') kings[piece.color] = { row, col };
      else if (piece.color === 'red') red += 1;
      else black += 1;
    }
  }
  return {
    fen, turn,
    check: isInCheck(board, turn) ? { checkers: [] } : null,
    material: { red, black, phase: 0 },
    pieces,
    hanging: opts.hanging ?? [],
    pins: [],
    cannons: [],
    kings: { red: { at: kings.red, flights: [], free: 0, pressure: 0 }, black: { at: kings.black, flights: [], free: 0, pressure: 0 } },
    mates: { red: null, black: null },
    patterns: opts.patterns ?? [],
  };
}

/**
 * Move facts with the capture and the check the rules engine sees, and nothing else.
 * @param {string} fen @param {MoveRef} move @param {Partial<MoveFacts>} [over]
 * @returns {MoveFacts}
 */
export function fakeMoveFacts(fen, move, over = {}) {
  const { board, turn } = fenToBoard(fen);
  const info = describeMove(board, move);
  const after = applyMove(board, move);
  const victim = board[move.to.row][move.to.col];
  const gives = isInCheck(after, opposite(turn));
  return {
    move: info,
    fenBefore: fen,
    fenAfter: boardToFen(after, opposite(turn)),
    tags: [],
    capture: victim ? { piece: pieceRefAt(board, move.to), see: 0, exchange: 'even', free: false, recapture: null } : null,
    check: gives ? { checkers: [], discovered: false, double: false, replies: getLegalMoves(after, opposite(turn)).length, mate: getLegalMoves(after, opposite(turn)).length === 0 } : null,
    escapesCheck: false,
    threats: [], parried: [], exposed: [], fork: null,
    pins: { created: [], released: [], suffered: [] },
    blocks: [], opens: [],
    kingSqueeze: { before: 0, after: 0 },
    mateThreat: null, allowsMate: null,
    patterns: [],
    pawnCrossed: false,
    ...over,
  };
}

/**
 * @param {SurveyPayload} payload
 * @param {{table?:Analysis, depth?:number, best?:MoveRef, bestScore?:number, scoreOf?:(move:MoveRef, index:number) => number, threat?:ThreatInfo|null,
 *          test?:TacticalTest|null, traps?:HabitCode[], tension?:number, hanging?:Hanging[]}} [opts]
 * @returns {Survey}
 */
export function fakeSurvey(payload, opts = {}) {
  const { board } = fenToBoard(payload.fen);
  const table = opts.table ?? fakeTable(payload.fen, opts);
  return {
    fen: payload.fen,
    facts: fakeFacts(payload.fen, { hanging: opts.hanging }),
    threat: opts.threat ?? null,
    table,
    moves: table.lines.map((line) => describeMove(board, line.move)),
    test: opts.test ?? null,
    traps: opts.traps ?? [],
    tension: opts.tension ?? 0.2,
  };
}

/**
 * The result of an assess job. `cat` and `loss` are what the test says they are; a mistake or blunder gets a refutation
 * (the rival's first legal answer, unless `reply` names one) and, with `lose`, the settled loss of that piece.
 * @param {AssessPayload} payload
 * @param {{cat?:Cat, loss?:number, moveCp?:number, best?:MoveRef, isBest?:boolean, reply?:MoveRef, lose?:Piece['type'], win?:Piece['type'],
 *          danger?:DangerCode, focus?:Square[], flags?:Partial<Assessed['assessment']['flags']>, revealBest?:number, patterns?:Pattern[],
 *          facts?:Partial<MoveFacts>, depth?:number}} [opts]
 * @returns {Assessed}
 */
export function fakeAssessed(payload, opts = {}) {
  const { board, turn } = fenToBoard(payload.fen);
  const move = describeMove(board, payload.move);
  const cat = opts.cat ?? 'good';
  const loss = opts.loss ?? (cat === 'blunder' ? 400 : cat === 'mistake' ? 200 : cat === 'ok' ? 80 : cat === 'good' ? 30 : 0);
  const moveCp = opts.moveCp ?? -loss;
  const bestRef = opts.best ?? payload.compare ?? payload.move;
  const isBest = opts.isBest ?? (loss === 0 || sameMove(bestRef, payload.move));
  const best = isBest ? move : describeMove(board, bestRef);
  const after = applyMove(board, payload.move);
  const answers = getLegalMoves(after, opposite(turn));
  const answer = opts.reply ? answers.find((m) => sameMove(m, /** @type {MoveRef} */ (opts.reply))) : answers[0];
  const reply = answer ? describeMove(after, answer) : null;
  const fenAfter = boardToFen(after, opposite(turn));
  /** @type {Line} */
  const line = { start: payload.fen, moves: reply ? [move, reply] : [move], end: 'quiet' };
  /** @type {MaterialOutcome} */
  const outcome = {
    net: (opts.win ? 4 : 0) - (opts.lose ? 4 : 0),
    won: opts.win ? [{ piece: opts.win, points: 4 }] : [],
    lost: opts.lose ? [{ piece: opts.lose, points: 4 }] : [],
    kind: opts.lose ? 'loses' : opts.win ? 'wins' : 'none',
    mate: null, plies: line.moves.length, settled: true,
  };
  const bad = cat === 'mistake' || cat === 'blunder';
  return {
    assessment: {
      move,
      depth: opts.depth ?? 6,
      moveCp,
      bestCp: moveCp + loss,
      loss,
      cat,
      best,
      isBest,
      alternatives: [],
      flags: { onlyMove: false, missedWin: false, missedMate: false, allowsMate: false, givesMate: null, sacrifice: false, ...opts.flags },
      line,
      outcome,
      refutation: bad && reply
        ? { reply, line, outcome, revealDepth: 2, danger: opts.danger ?? 'hangs_moved_piece', focus: opts.focus ?? [{ row: reply.from.row, col: reply.from.col }] }
        : null,
      bestLine: { start: payload.fen, moves: [best], end: 'quiet' },
      bestOutcome: noOutcome(),
      revealBest: opts.revealBest ?? 1,
      patterns: opts.patterns ?? [],
    },
    facts: fakeMoveFacts(payload.fen, payload.move, opts.facts),
    replies: reply ? [{ move: reply, line: { start: fenAfter, moves: [reply], end: 'quiet' }, outcome: noOutcome(), facts: fakeMoveFacts(fenAfter, reply) }] : [],
  };
}

/**
 * The result of an opponent job: the rival plays `move`, or the legal move number `index` (default 0).
 * @param {OpponentPayload} payload
 * @param {{move?:MoveRef, index?:number, childMoveCp?:number, evalAfter?:number, evalBest?:number, tension?:number, loss?:number,
 *          mode?:TeachingChoice['mode'], kind?:TeachingChoice['kind'], chance?:TeachingChoice['chance'], overlooked?:TeachingChoice['overlooked'],
 *          facts?:Partial<MoveFacts>}} [opts]
 * @returns {OpponentTurn}
 */
export function fakeOpponentTurn(payload, opts = {}) {
  const { board, turn } = fenToBoard(payload.fen);
  const legal = getLegalMoves(board, turn);
  const picked = opts.move ? legal.find((m) => sameMove(m, /** @type {MoveRef} */ (opts.move))) : legal[(opts.index ?? 0) % Math.max(1, legal.length)];
  if (!picked) throw new RangeError('fakeOpponentTurn: no such legal move');
  const ref = refOf(picked);
  const move = describeMove(board, ref);
  /** @type {RootLine} */
  const root = { move: ref, score: 0, depth: 6, upper: null, mate: null, pv: [ref], byDepth: [0, 0, 0, 0, 0, 0], naive: 0, repeats: 1 };
  const loss = opts.loss ?? 0;
  return {
    move,
    facts: fakeMoveFacts(payload.fen, ref, opts.facts),
    line: { start: payload.fen, moves: [move], end: 'quiet' },
    choice: { move: ref, line: root, mode: opts.mode ?? 'spar', kind: opts.kind ?? 'honest', loss, evalAfter: opts.evalAfter ?? 0,
              evalBest: opts.evalBest ?? 0, chance: opts.chance ?? null, overlooked: opts.overlooked ?? null },
    quality: { loss, cat: loss <= 15 ? 'best' : 'good' },
    childMoveCp: opts.childMoveCp ?? 0,
    evalAfter: opts.evalAfter ?? 0,
    tension: opts.tension ?? 0.2,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The fake brain
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} BrainScript
 * @property {((fen:string) => Hanging[])|null} hanging                 pieces `positionFacts` reports as hanging
 * @property {((moves:MoveRef[]) => {red:PatternCode|null, black:PatternCode|null})|null} opening
 * @property {((fen:string, move:MoveRef) => Partial<MoveFacts>)|null} moveFacts
 * @property {boolean} factsThrow                                       positionFacts throws
 */

/** @param {LogEntry[]} log @returns {BrainPort & {script:BrainScript}} */
function createFakeBrain(log) {
  /** @type {BrainScript} */
  const script = { hanging: null, opening: null, moveFacts: null, factsThrow: false };
  /** @param {string} op @param {unknown[]} args */
  const note = (op, args) => { log.push({ op: `brain.${op}`, args }); };
  const plan = { survey: 2 * 1500 + 500, assess: 2 * 400 + 500, opponent: 2 * (700 + 350) + 500 };      // the `mid` row of SPEC 4.8.1
  return {
    script,
    positionFacts(fen, opts) {
      note('positionFacts', [fen, opts]);
      if (script.factsThrow) throw new RangeError('fake: positionFacts failed');
      return fakeFacts(fen, { hanging: script.hanging ? script.hanging(fen) : [] });
    },
    moveFacts(fen, move, opts) {
      note('moveFacts', [fen, move, opts]);
      return fakeMoveFacts(fen, move, script.moveFacts ? script.moveFacts(fen, move) : {});
    },
    quickVerdict(table, move, level) {
      note('quickVerdict', [table, move, level]);
      if (!table || table.depth < 2 || table.lines.length === 0) return null;
      const line = table.lines.find((l) => sameMove(l.move, move));
      if (!line) return null;
      const loss = Math.max(0, cp(table.lines[0].score) - cp(line.score));
      /** @type {Cat} */
      const cat = loss <= 15 ? 'best' : loss <= 50 ? 'good' : loss <= 120 ? 'ok' : loss <= 300 ? 'mistake' : 'blunder';
      return { cat, loss, depth: table.depth, isBest: loss === 0 };
    },
    hintFor(input) {
      note('hintFor', [input]);
      if (!input.table.lines.some((l) => sameMove(l.move, input.move))) throw new RangeError('hintFor needs a table that contains the move');
      const { board, turn } = fenToBoard(input.fen);
      const move = describeMove(board, input.move);
      const col = turn === 'red' ? move.to.col : 8 - move.to.col;
      const depth = turn === 'red' ? 9 - move.to.row : move.to.row;
      return {
        theme: 'improve',
        piece: pieceRefAt(board, move.from),
        area: { side: col <= 2 ? 'left' : col <= 5 ? 'center' : 'right', zone: depth <= 2 ? 'home' : depth >= 7 ? 'enemy' : 'river' },
        move,
        line: { start: input.fen, moves: [move], end: 'quiet' },
        outcome: noOutcome(),
        facts: fakeMoveFacts(input.fen, input.move),
        alternatives: [],
      };
    },
    openingName(startFen, moves) {
      note('openingName', [startFen, moves]);
      return script.opening ? script.opening(moves) : { red: null, black: null };
    },
    boardToFen: (board, turn) => boardToFen(board, turn),
    createSkillProfile: (seedLevel) => teacher.createSkillProfile(seedLevel),
    migrateSkillProfile: (raw) => teacher.migrateSkillProfile(raw),
    createGameSkill: (seed) => teacher.createGameSkill(seed),
    reviveGameSkill(raw, seed) {
      note('reviveGameSkill', [raw, seed]);
      return teacher.reviveGameSkill(raw, seed);
    },
    recordChildMove(profile, game, sample) {
      note('recordChildMove', [sample]);
      return teacher.recordChildMove(profile, game, sample);
    },
    recordOpponentMove(game, ply, choice) {
      note('recordOpponentMove', [ply, choice]);
      return teacher.recordOpponentMove(game, ply, choice);
    },
    rewindGameSkill(game, ply) {
      note('rewindGameSkill', [ply]);
      return teacher.rewindGameSkill(game, ply);
    },
    effectiveLevel: (profile, game) => teacher.effectiveLevel(profile, game),
    findRate: (profile, tier) => teacher.findRate(profile, tier),
    teachingContext(profile, game, extra) {
      note('teachingContext', [extra]);
      return teacher.teachingContext(profile, game, extra);
    },
    finishGame(profile, game, result) {
      note('finishGame', [result]);
      return teacher.finishGame(profile, game, result);
    },
    gameTakeaways(game, result, profile) {
      note('gameTakeaways', [result]);
      return teacher.gameTakeaways(game, result, profile);
    },
    surveyJob(p) {
      note('surveyJob', [p]);
      return { kind: 'survey', payload: p, timeoutMs: plan.survey };
    },
    assessJob(p) {
      note('assessJob', [p]);
      return { kind: 'assess', payload: p, timeoutMs: plan.assess };
    },
    opponentJob(p) {
      note('opponentJob', [p]);
      return { kind: 'opponent', payload: p, timeoutMs: plan.opponent };
    },
    setSpeed(speedClass) {
      note('setSpeed', [speedClass]);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The fake coach: book, memory, brief, threads
// ---------------------------------------------------------------------------------------------------------------------

/** A MoveBook that knows the moves it was given, by notation. @param {{board:Board, turn:Color}} base @returns {MoveBook} */
function fakeMoveBook(base) {
  /** @type {Map<string, MoveLink>} */
  const links = new Map();
  return {
    base,
    add(src, line) {
      /** @type {string[]} */
      const out = [];
      /** @type {(MoveRef & {color:Color})[]} */
      const pre = [];
      const fromBase = typeof line.start === 'object' ? line.start.board === base.board : line.start === boardToFen(base.board, base.turn);
      for (const move of line.moves) {
        const playable = pre.length === 0 && fromBase && move.color === base.turn;
        if (!links.has(move.notation) || playable) {
          links.set(move.notation, { from: move.from, to: move.to, color: move.color, code: codeOf(move), pre: pre.slice(), playable, src });
        }
        pre.push({ from: move.from, to: move.to, color: move.color });
        out.push(move.notation);
      }
      return out;
    },
    lookup: (notation) => links.get(notation) ?? null,
    resolveLoose: (notation) => links.get(notation) ?? null,
    size: () => links.size,
  };
}

/** `【notation】` becomes a move segment when the book knows it. @param {string} text @param {MoveBook} book @returns {Segment[]} */
function fakeParse(text, book) {
  /** @type {Segment[]} */
  const segments = [];
  for (const part of text.split(/(【[^【】]*】)/)) {
    if (part === '') continue;
    const inner = part.startsWith('【') && part.endsWith('】') ? part.slice(1, -1) : null;
    const link = inner !== null ? book.lookup(inner) : null;
    if (inner !== null && link) segments.push({ type: 'move', notation: inner, link });
    else segments.push({ type: 'text', text: part });
  }
  return segments;
}

/**
 * A GameMemory with the rules the director's tests read: the child's moves by ply, a `slip` moment for a confirmed mistake
 * or blunder, a `punished` moment for a rival move that punishes, exact rewind. Calls go to the log.
 * @param {unknown} saved @param {LogEntry[]} log
 * @returns {GameMemory}
 */
function fakeMemory(saved, log) {
  /** @type {{ply:number, mine:TurnBrief['mine']}[]} */
  let mines = [];
  /** @type {{ply:number, moment:Moment}[]} */
  let moments = [];
  /** @type {{ply:number, code:string}[]} */
  let taught = [];
  /** @type {HabitCode[]} */
  const habits = [];
  let at = 0;
  if (typeof saved === 'object' && saved !== null) {
    const o = /** @type {{mines?:typeof mines, moments?:typeof moments, taught?:typeof taught, habits?:HabitCode[], at?:number}} */ (saved);
    if (Array.isArray(o.mines)) mines = structuredClone(o.mines);
    if (Array.isArray(o.moments)) moments = structuredClone(o.moments);
    if (Array.isArray(o.taught)) taught = structuredClone(o.taught);
    if (Array.isArray(o.habits)) habits.push(...o.habits);
    if (typeof o.at === 'number') at = o.at;
  }
  /** @param {number} ply */
  const dropMoment = (ply) => { moments = moments.filter((m) => m.ply !== ply); };
  const cats = ['brilliant', 'best', 'good', 'ok', 'mistake', 'blunder'];
  return {
    noteMine(ply, info) {
      log.push({ op: 'memory.noteMine', args: [ply, info] });
      mines = mines.filter((m) => m.ply !== ply);
      const known = cats.includes(info.cat);
      /** @type {TurnBrief['mine']} */
      const mine = known ? { move: info.move, cat: info.cat, waited: info.waited === true, self: info.self === true } : null;
      if (mine && info.packet) mine.try = { ...info.packet, held: false, reply: info.packet.reply ?? info.more?.reply ?? null };
      mines.push({ ply, mine });
      mines.sort((a, b) => a.ply - b.ply);
      at = Math.max(at, ply + 1);
      dropMoment(ply);
      if (mine && (mine.cat === 'mistake' || mine.cat === 'blunder')) {
        moments.push({ ply, moment: { n: Math.floor(ply / 2) + 1, s: 'me', move: mine.move, tag: 'slip' } });
      }
    },
    noteOpp(ply, opp) {
      log.push({ op: 'memory.noteOpp', args: [ply, opp] });
      at = Math.max(at, ply + 1);
      dropMoment(ply);
      if (opp.punishes === true) moments.push({ ply, moment: { n: Math.floor(ply / 2) + 1, s: 'opp', move: opp.move, tag: 'punished' } });
    },
    noteTaught(codes) {
      log.push({ op: 'memory.noteTaught', args: [codes] });
      for (const code of codes) taught.push({ ply: at, code });
    },
    noteHabit(code) {
      log.push({ op: 'memory.noteHabit', args: [code] });
      if (!habits.includes(code)) habits.push(code);
    },
    habitMentioned: (code) => habits.includes(code),
    rewind(ply) {
      log.push({ op: 'memory.rewind', args: [ply] });
      mines = mines.filter((m) => m.ply < ply);
      moments = moments.filter((m) => m.ply < ply);
      taught = taught.filter((t) => t.ply < ply);
      at = ply;
    },
    snapshot() {
      const lastMine = mines.length > 0 ? mines[mines.length - 1].mine : null;
      return {
        moments: moments.slice(-6).map((m) => ({ ...m.moment })),
        taught: [...new Set(taught.map((t) => t.code))].slice(-8),
        mine: lastMine ? structuredClone(lastMine) : null,
      };
    },
    toJSON: () => structuredClone({ mines, moments, taught, habits, at }),
  };
}

/** The leading effect of an assessed move, as far as the fake results show one. @param {Assessed} assessed @returns {MotifCode} */
function leadOf(assessed) {
  const { assessment: a, facts } = assessed;
  if (facts.check && facts.check.mate) return 'mate';
  if (a.flags.givesMate !== null && a.flags.givesMate >= 2) return 'mate_threat';
  if (a.flags.sacrifice) return 'sacrifice';
  if (facts.capture) return facts.capture.free ? 'capture_free' : facts.capture.exchange === 'even' ? 'trade' : 'capture';
  if (facts.fork) return 'fork';
  if (facts.check) return 'check';
  return 'quiet';
}

/**
 * @typedef {Object} BriefScript
 * @property {Threat[]} threats                 what buildTurnBrief lists as threats (besides the child's hanging pieces)
 * @property {string|null} chanceWord           what chanceAreaWord answers when a chance is pending (default '右翼')
 */

/** The packet builders of SPEC 4.14, reduced to the rules the director's decisions hang on. @param {LogEntry[]} log @param {BriefScript} script */
function fakeBrief(log, script) {
  /** @param {string} op @param {unknown[]} args */
  const note = (op, args) => { log.push({ op: `brief.${op}`, args }); };

  /** @param {TurnReport} report @returns {OppMove|null} */
  function oppOf(report) {
    const lastOpp = report.lastOpp;
    if (!lastOpp || !lastOpp.move) return null;
    const prev = report.prev ? report.prev.assessed : null;
    const reply = prev && prev.assessment.refutation ? prev.assessment.refutation.reply : null;
    const punishes = !!prev && ['ok', 'mistake', 'blunder'].includes(prev.assessment.cat) && reply !== null && sameMove(reply, lastOpp.move);
    /** @type {OppMove} */
    const opp = { move: lastOpp.move.notation, check: !!(lastOpp.facts && lastOpp.facts.check), does: [{ k: lastOpp.move.captured ? 'capture' : 'quiet' }], quality: 'normal' };
    if (lastOpp.move.captured) opp.captured = PT_OF[lastOpp.move.captured];
    if (punishes) opp.punishes = true;
    return opp;
  }

  return {
    /** @param {TurnReport} report @param {GameMemory} memory @param {MoveBook} book @returns {TurnBrief} */
    buildTurnBrief(report, memory, book) {
      note('buildTurnBrief', [report]);
      const snapshot = memory.snapshot();
      let mine = snapshot.mine;
      const prev = report.prev;
      if (prev && prev.move && typeof prev.cat === 'string') {
        if (mine === null || mine.move !== prev.move.notation) mine = { move: prev.move.notation, cat: prev.cat, waited: prev.waited, self: prev.self };
        if (prev.packet) mine = { ...mine, try: { ...prev.packet, held: false, reply: prev.packet.reply ?? prev.more?.reply ?? null } };
        book.add('mine', { start: '', moves: [prev.move], end: 'quiet' });
      }
      const opp = oppOf(report);
      if (opp && report.lastOpp) book.add('opp', { start: '', moves: [report.lastOpp.move], end: 'quiet' });
      /** @type {Threat[]} */
      const threats = [];
      for (const h of report.facts ? report.facts.hanging : []) {
        if (h.piece.color !== report.me) continue;
        threats.push({ k: 'attack', by: wpiece(h.by, report.me), on: wpiece(h.piece, report.me), move: h.capture.notation,
                       net: { gain: [], lose: [PT_OF[h.piece.type]], cp: -h.gain }, sev: h.gain >= 800 ? 'rook' : h.gain >= 300 ? 'piece' : 'pawn' });
        book.add('threat', { start: { board: report.board, turn: opposite(report.me) }, moves: [h.capture] });
      }
      threats.push(...script.threats);
      const pending = report.lastOpp && report.lastOpp.choice ? report.lastOpp.choice.chance : null;
      return {
        ply: report.ply,
        me: report.me,
        phase: 'middle',
        check: isInCheck(report.board, report.me),
        n: report.legalCount > 0 ? report.legalCount : getLegalMoves(report.board, report.me).length,
        back: report.back,
        eval: { b: 'even' },
        mat: { me: '', opp: '', cp: 0 },
        level: Math.max(1, Math.min(9, Math.round(report.level))),
        moments: snapshot.moments,
        taught: snapshot.taught,
        mine,
        opp,
        threats: threats.slice(0, 4),
        chance: report.announceChance && pending ? { size: 'piece', theme: 'capture_free', area: 'right' } : null,
        known: { threats: !!report.facts, chance: report.announceChance === true },
      };
    },

    /** @param {TurnBrief} turn */
    oppCaption(turn) {
      return turn.opp ? `【${turn.opp.move}】${turn.opp.captured ? '吃子' : '出子'}` : '';
    },

    /**
     * @param {Assessed} assessed
     * @param {{turn:TurnBrief, report:TurnReport, prev:TryPacket|null, self:boolean, habit:HabitCode|null, avoided:HabitCode|null, repeat:boolean}} ctx
     * @param {MoveBook} book
     * @returns {{packet:TryPacket, more:MorePacket}}
     */
    buildTryPacket(assessed, ctx, book) {
      note('buildTryPacket', [assessed, ctx]);
      const a = assessed.assessment;
      const bad = a.cat === 'mistake' || a.cat === 'blunder';
      /** @type {Net|null} */
      const cost = a.outcome.won.length > 0 || a.outcome.lost.length > 0
        ? { gain: a.outcome.won.map((w) => PT_OF[w.piece]), lose: a.outcome.lost.map((l) => PT_OF[l.piece]), cp: Math.round(a.outcome.net * 100) }
        : null;
      const held = bad && ((cost !== null && cost.cp <= -150) || a.flags.allowsMate === true);
      /** @type {WLine|null} */
      const reply = a.line.moves.length > 1
        ? { first: 'opp', moves: a.line.moves.slice(1, 7).map((m) => m.notation), net: cost ?? { gain: [], lose: [], cp: 0 }, end: 'quiet' }
        : null;
      const better = !a.isBest && a.loss >= 60 ? [{ move: a.best.notation, gain: Math.round(a.loss), does: [{ k: /** @type {MotifCode} */ ('quiet') }], line: null }] : [];
      const pending = ctx.report.lastOpp && ctx.report.lastOpp.choice ? ctx.report.lastOpp.choice.chance : null;
      const first = pending && pending.line && pending.line.moves ? pending.line.moves[0] : null;
      /** @type {TryPacket} */
      const packet = {
        move: a.move.notation,
        cat: a.cat,
        loss: Math.round(a.loss),
        held,
        eval: a.flags.allowsMate ? { b: 'lost', mate: -1 } : { b: 'even' },
        does: [{ k: leadOf(assessed) }],
        flaws: bad ? [{ k: 'hang' }] : [],
        cost,
        reply: held ? null : reply,
        toward: null,
        chance: pending ? ((first && sameMove(first, a.move)) || a.loss <= 60 ? 'taken' : a.loss >= 150 ? 'missed' : 'none') : 'none',
      };
      if (a.flags.onlyMove && a.isBest) packet.only = true;
      if (a.flags.sacrifice) packet.sac = true;
      if (ctx.self) packet.self = true;
      if (ctx.repeat) packet.repeat = true;
      if (ctx.habit) packet.habit = ctx.habit;
      if (ctx.avoided) packet.avoided = ctx.avoided;
      if (ctx.prev) packet.vsPrev = ctx.prev.loss - packet.loss > 30 ? 'better' : ctx.prev.loss - packet.loss < -30 ? 'worse' : 'same';
      book.add('try', { start: book.base, moves: [a.move] });
      if (a.line.moves.length > 1) book.add('reply', { start: assessed.facts.fenAfter, moves: a.line.moves.slice(1), end: 'quiet' });
      if (better.length > 0) book.add('better', { start: book.base, moves: [a.best] });
      return { packet, more: held && reply ? { reply, better } : { better } };
    },

    buildToolVerdict() {
      throw new Error('fake brief: buildToolVerdict is the port\'s business, not the director\'s');
    },

    /** @param {1|2|3} level @param {Hint} hint @param {{turn:TurnBrief, report:TurnReport}} ctx @param {MoveBook} book @returns {Hint1|Hint2|Hint3} */
    buildHintPacket(level, hint, ctx, book) {
      note('buildHintPacket', [level, hint, ctx]);
      if (level === 1) return { focus: 'improve', theme: 'quiet' };
      if (level === 2) return { piece: wpiece(hint.piece, ctx.turn.me), area: 'center', theme: 'quiet' };
      book.add('hint', { start: book.base, moves: [hint.move] });
      return { move: hint.move.notation, does: [{ k: 'quiet' }], line: null };
    },

    /**
     * @param {{result:'win'|'loss'|'draw', reason:OverPacket['reason'], finish:{takeaways:Takeaway[]}, game:GameSkill, rankBefore:number, rankAfter:number,
     *          goalPrev:HabitCode|null, history:unknown[], humanColor:Color}} input
     * @returns {{packet:OverPacket, goal:HabitCode|null, kept:boolean|null, proudPly:number|null}}
     */
    buildOverPacket(input) {
      note('buildOverPacket', [input]);
      const samples = input.game.samples;
      const takeaways = input.finish.takeaways;
      const highlight = takeaways.find((t) => t.kind === 'highlight');
      const lesson = takeaways.find((t) => t.kind === 'lesson');
      /** @type {OverPacket['proud']} */
      const proud = highlight && highlight.move && typeof highlight.ply === 'number'
        ? { n: Math.floor(highlight.ply / 2) + 1, s: 'me', move: highlight.move.notation, tag: 'great' }
        : null;
      /** @type {HabitCode|null} */
      let goal = null;
      /** @type {OverPacket['takeaway']} */
      let takeaway = null;
      if (lesson && lesson.danger) {
        goal = lesson.danger === 'hangs_moved_piece' && lesson.move && lesson.move.captured !== null ? 'greedy' : HABIT_OF_DANGER[lesson.danger];
        if (goal) {
          takeaway = { kind: 'habit', code: goal, n: lesson.count ?? 1 };
          if (lesson.move && typeof lesson.ply === 'number') {
            const ply = lesson.ply;
            const final = samples.find((s) => s.ply === ply)?.final;
            takeaway.ex = { n: Math.floor(ply / 2) + 1, move: lesson.move.notation };
            if (final && !sameMove(final.move, lesson.move) && ['brilliant', 'best', 'good'].includes(final.cat)) takeaway.ex.better = final.move.notation;
          }
        }
      }
      const kept = !input.goalPrev || samples.length < 10 ? null : !samples.some((s) => s.habit === input.goalPrev);
      /** @type {OverPacket} */
      const packet = {
        result: input.result,
        reason: input.reason,
        moves: samples.length,
        stats: {
          good: samples.filter((s) => ['brilliant', 'best', 'good'].includes(s.final.cat)).length,
          taken: samples.filter((s) => s.test !== null && s.test.found && s.test.kind === 'win').length,
          captures: samples.filter((s) => s.captured !== null).length,
          brilliant: samples.filter((s) => s.final.cat === 'brilliant').length,
        },
        takeaway,
        proud,
        goal,
        kept,
        rank: input.rankAfter > input.rankBefore ? { to: input.rankAfter } : null,
      };
      return { packet, goal, kept, proudPly: proud && highlight && typeof highlight.ply === 'number' ? highlight.ply : null };
    },

    buildRecap() {
      throw new Error('fake brief: buildRecap is the client\'s business, not the director\'s');
    },

    /** @param {Assessed} assessed @param {{found:boolean, avoided:HabitCode|null}} info */
    isEarned(assessed, info) {
      const a = assessed.assessment;
      if (a.cat !== 'brilliant' && a.cat !== 'best') return false;
      return info.found === true || a.flags.onlyMove === true || TACTIC_MOTIFS.includes(leadOf(assessed)) || a.revealBest >= 3 || info.avoided !== null;
    },

    /** @param {TryPacket} packet @param {boolean} earned */
    worthSpeaking(packet, earned) {
      return earned === true || packet.only === true || packet.sac === true || packet.repeat === true || packet.chance !== 'none'
        || packet.avoided !== undefined || (packet.does[0] !== undefined && NOTABLE_MOTIFS.includes(packet.does[0].k))
        || ((packet.cat === 'mistake' || packet.cat === 'blunder') && !packet.held);
    },

    /** @param {TurnReport} report */
    chanceAreaWord(report) {
      note('chanceAreaWord', [report]);
      const pending = report.lastOpp && report.lastOpp.choice ? report.lastOpp.choice.chance : null;
      return pending ? script.chanceWord : null;
    },
  };
}

const TRY_ASKS = ['good', 'reply', 'better', 'show'];
const OVER_ASKS = ['proud', 'improve', 'next', 'why', 'free'];

/**
 * One reply of a fake thread that is "on its way from the proxy": the test decides what arrives and when.
 * @typedef {Object} FakeReply
 * @property {number} id
 * @property {'turn'|'over'} thread
 * @property {string} kind                     the event's kind
 * @property {string} [ask]                    the code of an ask
 * @property {(text:string) => void} push      text arrives (segments, and a sentence at every 。！？)
 * @property {(t:{phase:'start'|'end', notation?:string, link?:MoveLink}) => void} tool
 * @property {() => void} reset                the text so far is withdrawn (a failure before the local line)
 * @property {(extra?:{cut?:boolean, source?:'llm'|'local'|'mixed'|'none'}) => void} finish
 * @property {() => boolean} alive
 * @property {(text:string) => void} rogue     calls the handlers although the reply may be dead, as a broken client would: the
 *                                             director's own gate (the task's) must drop it once the position has changed
 *
 * @typedef {Object} CoachScript
 * @property {'llm'|'local'} mode              what `mode()` answers
 * @property {CoachOffReason|null} reason
 * @property {boolean} freeText                what `capabilities()` answers while the mode is 'llm'
 * @property {'manual'|'sync'} llm             how a reply that goes to the proxy ends: by the test (`replies`), or inside the call
 * @property {((event:{kind:string, [key:string]:unknown}, thread:'turn'|'over') => string|undefined)|null} text
 *                                             the sentence of an answer ('' = nothing to say); undefined keeps the default
 */

/** @param {LogEntry[]} log */
function createFakeCoach(log) {
  /** @type {CoachScript} */
  const script = { mode: 'local', reason: 'no_proxy', freeText: false, llm: 'manual', text: null };
  /** @type {BriefScript} */
  const briefScript = { threats: [], chanceWord: '右翼' };
  /** @type {Set<(s:{mode:'llm'|'local', reason:CoachOffReason|null}) => void>} */
  const listeners = new Set();
  /** Replies that left for the proxy and have not ended. @type {FakeReply[]} */
  const replies = [];
  /** Uses of a thread the wire rules or the client would not take. @type {string[]} */
  const violations = [];
  const counters = { fetches: 0, threads: 0, probes: 0, resets: 0 };
  let epoch = 0;
  let replySeq = 0;
  /** Every abort function of a reply in flight. @type {Set<() => void>} */
  const live = new Set();

  /** @param {{kind:string, [key:string]:unknown}} event @param {'turn'|'over'} kind @param {TurnBrief} turn @returns {string} */
  function defaultText(event, kind, turn) {
    if (event.kind === 'start') return '小主公，请出招。';
    if (event.kind === 'opp') return turn.opp ? `对方走了【${turn.opp.move}】。` : '对方落子了。';
    if (event.kind === 'try') {
      const packet = /** @type {TryPacket} */ (event.try);
      return packet.held ? `【${packet.move}】有危险。看看是谁在盯着它？` : `【${packet.move}】可以走。`;
    }
    if (event.kind === 'hint') return `第${String(event.level)}个锦囊。`;
    if (event.kind === 'ask') return `回答${String(event.ask)}。`;
    if (event.kind === 'over') return kind === 'over' ? '这盘下完了。' : '';
    return '';
  }

  /** @param {{kind:string, [key:string]:unknown}} event @param {ReplyOpts|undefined} opts @param {TurnBrief} turn @returns {string|null} */
  function cueOf(event, opts, turn) {
    const flags = opts && opts.flags ? opts.flags : {};
    if (event.kind === 'start') return CUE.go;
    if (event.kind === 'opp') return turn.opp && turn.opp.check ? CUE.alert : null;
    if (event.kind === 'over') {
      const result = /** @type {OverPacket} */ (event.over).result;
      return result === 'win' ? CUE.win : result === 'loss' ? CUE.lose : CUE.draw;
    }
    if (event.kind !== 'try') return null;
    if (flags.lord) return CUE.lord;
    if (flags.earned) return CUE.nice;
    if (flags.voiced) return /** @type {TryPacket} */ (event.try).cat === 'blunder' ? CUE.stop : CUE.wait;
    return null;
  }

  /** @param {'turn'|'over'} kind @param {TurnBrief} turn @param {MoveBook} book @param {{signal?:AbortSignal}} [threadOpts] @returns {Thread} */
  function begin(kind, turn, book, threadOpts) {
    counters.threads += 1;
    log.push({ op: kind === 'turn' ? 'coach.beginTurn' : 'coach.beginOver', args: [turn, book] });
    const t = {
      /** @type {{kind:string, [key:string]:unknown}[]} */ events: [],
      closed: false,
      /** @type {TryPacket|null} */ active: null,
      epoch,
      /** @type {(() => void)|null} */ abortCurrent: null,
    };

    /**
     * @param {string} op @param {{kind:string, [key:string]:unknown}} event @param {SayMode} mode @param {Handlers} h @param {ReplyOpts} [opts]
     * @returns {Reply}
     */
    function send(op, event, mode, h, opts) {
      log.push({ op: `thread.${op}`, args: [event, mode, opts] });
      if (t.abortCurrent) t.abortCurrent();                // one reply at a time
      const id = ++replySeq;
      if (t.closed || t.epoch !== epoch) {
        violations.push(`thread.${op} on a ${t.closed ? 'closed' : 'reset'} thread`);
        return { id, done: Promise.resolve({ aborted: true }), abort() {} };
      }
      if ((threadOpts && threadOpts.signal && threadOpts.signal.aborted) || (opts && opts.signal && opts.signal.aborted)) {
        return { id, done: Promise.resolve({ aborted: true }), abort() {} };
      }
      // the rules of a thread (SPEC 4.10 rule 5, as the client applies them)
      if (op === 'open' && t.events.length > 0) violations.push('thread.open twice');
      if (op !== 'open' && t.events.length === 0) violations.push(`thread.${op} before thread.open`);
      if (kind === 'over' && (op === 'hint' || op === 'tryMove')) violations.push(`thread.${op} in an over thread`);
      if (kind === 'over' && op === 'ask' && !OVER_ASKS.includes(String(event.ask))) violations.push(`ask ${String(event.ask)} in an over thread`);
      if (kind === 'turn' && op === 'ask' && TRY_ASKS.includes(String(event.ask)) && (t.active === null || !t.events.some((e) => e.kind === 'try'))) {
        violations.push(`ask ${String(event.ask)} before the try event`);
      }
      if (op === 'hint' && t.events.some((e) => e.kind === 'hint' && Number(e.level) > Number(event.level))) violations.push('hint level went down');
      t.events.push(event);
      if (event.kind === 'try') t.active = /** @type {TryPacket} */ (event.try);

      /** @type {ReplyResult} */
      const nothing = { aborted: false, text: '', segments: [], source: 'none', cut: false, refused: false };
      if (mode === 'silent') return { id, done: Promise.resolve(nothing), abort() {} };

      let settled = false;
      /** @type {(r:ReplyResult) => void} */
      let resolve = () => {};
      /** @type {Promise<ReplyResult>} */
      const done = new Promise((r) => { resolve = r; });
      /** @type {Segment[]} */
      const segments = [];
      let text = '';
      /** @type {'llm'|'local'} */
      let source = 'llm';
      const alive = () => !settled && t.epoch === epoch && !(opts && opts.signal && opts.signal.aborted);
      const abort = () => {                                // no handler is called (SPEC 7.5 aborted())
        if (settled) return;
        settled = true;
        if (t.abortCurrent === abort) t.abortCurrent = null;
        live.delete(abort);
        const at = replies.indexOf(control);
        if (at >= 0) replies.splice(at, 1);
        resolve({ aborted: true });
      };
      /** @type {FakeReply} */
      const control = {
        id,
        thread: kind,
        kind: event.kind,
        ask: typeof event.ask === 'string' ? event.ask : undefined,
        push(more) {
          if (!alive() || more === '') return;
          text += more;
          for (const seg of fakeParse(more, book)) {
            segments.push(seg);
            if (h.onSegment) h.onSegment(seg);
            if (!alive()) return;
          }
          for (const sentence of more.match(/[^。！？]*[。！？]/g) ?? []) {
            if (h.onSentence) h.onSentence(sentence);
            if (!alive()) return;
          }
        },
        tool(tool) {
          if (alive() && h.onTool) h.onTool(tool);
        },
        reset() {
          if (!alive()) return;
          text = '';
          segments.length = 0;
          if (h.onReset) h.onReset();
        },
        finish(extra) {
          if (!alive()) return;
          settled = true;
          if (t.abortCurrent === abort) t.abortCurrent = null;
          live.delete(abort);
          const at = replies.indexOf(control);
          if (at >= 0) replies.splice(at, 1);
          /** @type {ReplyResult} */
          const result = { aborted: false, text, segments, source: extra && extra.source ? extra.source : text === '' ? 'none' : source,
                           cut: !!(extra && extra.cut), refused: false };
          resolve(result);                                 // the reply is settled first, then onEnd is called (C4's reading)
          if (h.onEnd) h.onEnd(result);
        },
        alive,
        rogue(more) {
          for (const seg of fakeParse(more, book)) if (h.onSegment) h.onSegment(seg);
          if (h.onSentence) h.onSentence(more);
          if (h.onTool) h.onTool({ phase: 'start' });
          if (h.onReset) h.onReset();
          if (h.onEnd) h.onEnd({ aborted: false, text: more, segments: [], source: 'llm', cut: false, refused: false });
        },
      };
      t.abortCurrent = abort;
      live.add(abort);
      if (opts && opts.signal) opts.signal.addEventListener('abort', abort, { once: true });
      if (threadOpts && threadOpts.signal) threadOpts.signal.addEventListener('abort', abort, { once: true });

      if (h.onStart) h.onStart({ cue: cueOf(event, opts, turn) });
      if (!alive()) return { id, done, abort };

      const scripted = script.text ? script.text(event, kind) : undefined;
      const line = scripted !== undefined ? scripted : defaultText(event, kind, turn);
      const whyAfterGame = kind === 'over' && event.kind === 'ask' && event.ask === 'why';      // always answered locally (CONTRACT-NOTES 112)
      if (mode === 'local' || script.mode !== 'llm' || whyAfterGame) {
        source = 'local';
        control.push(line);
        control.finish();
      } else {
        counters.fetches += 1;
        replies.push(control);
        if (script.llm === 'sync') {
          control.push(line);
          control.finish();
        }
      }
      return { id, done, abort };
    }

    return {
      kind,
      open: (ev, mode, h, opts) => send('open', { ...ev }, mode, h, opts),
      hint: (level, packet, mode, h, opts) => send('hint', { kind: 'hint', level, hint: packet }, mode, h, opts),
      tryMove: (packet, more, mode, h, opts) => send('tryMove', { kind: 'try', try: packet, more }, mode, h, opts),
      ask: (code, say, h, opts) => send('ask', { kind: 'ask', ask: code, say }, 'auto', h, opts),
      interrupt() {
        log.push({ op: 'thread.interrupt', args: [] });
        if (t.abortCurrent) t.abortCurrent();
      },
      retract() {
        log.push({ op: 'thread.retract', args: [] });
        if (t.abortCurrent) t.abortCurrent();
        t.active = null;
      },
      end() {
        log.push({ op: 'thread.end', args: [] });
        if (t.abortCurrent) t.abortCurrent();
        t.closed = true;
      },
      activeTry: () => t.active,
      busy: () => t.abortCurrent !== null,
    };
  }

  const brief = /** @type {CoachPort['brief']} */ (/** @type {unknown} */ (fakeBrief(log, briefScript)));

  /** @type {CoachPort} */
  const port = {
    status: () => (script.mode === 'llm' ? 'online' : 'offline'),
    mode: () => script.mode,
    offReason: () => (script.mode === 'llm' ? null : script.reason),
    onMode(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    probe() {
      counters.probes += 1;
      log.push({ op: 'coach.probe', args: [] });
      return Promise.resolve();
    },
    capabilities: () => ({ freeText: script.mode === 'llm' && script.freeText }),
    beginTurn: (turn, book, opts) => begin('turn', turn, book, opts),
    beginOver: (turn, book, opts) => begin('over', turn, book, opts),
    reset() {
      counters.resets += 1;
      log.push({ op: 'coach.reset', args: [] });
      epoch += 1;
      for (const abort of [...live]) abort();
    },
    brief,
    createMoveBook: (base) => fakeMoveBook(base),
    createGameMemory: (saved) => fakeMemory(saved, log),
    parse: (text, book) => fakeParse(text, book),
  };

  return Object.assign(port, {
    script,
    briefScript,
    replies,
    violations,
    counters,
    /** Changes the mode and tells the listeners, as the client does. @param {'llm'|'local'} mode @param {CoachOffReason|null} [reason] @param {boolean} [freeText] */
    setMode(mode, reason = null, freeText = script.freeText) {
      script.mode = mode;
      script.reason = mode === 'llm' ? null : reason ?? 'unreachable';
      script.freeText = freeText;
      for (const fn of [...listeners]) fn({ mode, reason: script.reason });
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The fake stage
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} StageModel                    what the stage was last told
 * @property {Board|null} board                    the committed position it shows
 * @property {Move|null} trial                     the trial on the board
 * @property {Phase|'boot'} phase
 * @property {number} ply
 * @property {boolean} failed
 * @property {Square|null} selected
 * @property {ChipSpec[]} chips
 * @property {{visible:boolean, enabled:boolean}|null} input
 * @property {{id:string, kind:string, cue:string|null, target:string, text:string, resets:number, tools:number,
 *             end:{reason:string, source:string, stale?:string}|null}[]} lines          every coachBegin, in order
 * @property {{id:string, text:string}[]} locals   every coachLocal line
 * @property {string[]} captions
 * @property {string[]} toasts
 * @property {string[]} said                       childSaid
 * @property {OverView|null} over
 * @property {{mode:'llm'|'local', reason:CoachOffReason|null}|null} coachMode
 * @property {StageHandlers|null} handlers
 * @property {string[]} faults                     calls a real stage could not place: text for a line that was never begun or has ended
 *
 * @typedef {Object} StageScript
 * @property {boolean} hold                        board animations stay pending until release()
 * @property {{resign:boolean, 'new-game':{humanColor:Color}|null}} dialog       what the dialogs answer
 */

/** @param {LogEntry[]} log */
function createFakeStage(log) {
  /** @type {StageModel} */
  const model = { board: null, trial: null, phase: 'boot', ply: 0, failed: false, selected: null, chips: [], input: null, lines: [], locals: [],
                  captions: [], toasts: [], said: [], over: null, coachMode: null, handlers: null, faults: [] };
  /** @type {StageScript} */
  const script = { hold: false, dialog: { resign: true, 'new-game': { humanColor: 'red' } } };
  /** @type {(() => void)[]} */
  const held = [];
  let localSeq = 0;
  /** @param {string} op @param {unknown[]} args */
  const note = (op, args) => { log.push({ op: `stage.${op}`, args }); };
  /** @returns {Promise<void>} a board animation: over at once, or when the test releases it */
  const animation = () => (script.hold ? new Promise((resolve) => { held.push(() => resolve(undefined)); }) : Promise.resolve());
  /** @param {string} id */
  const lineOf = (id) => model.lines.find((line) => line.id === id && line.end === null) ?? model.lines.find((line) => line.id === id);

  /** @type {StagePort} */
  const port = {
    start(info) {
      note('start', [info]);
      return Promise.resolve('new');
    },
    reset(view, opts) {
      note('reset', [view, opts]);
      model.board = view.board;
      model.trial = null;
      model.selected = null;
      model.over = null;
      return animation();
    },
    phase(p) {
      note('phase', [p]);
      model.phase = p.phase;
      model.ply = p.ply;
      model.failed = p.failed;
      if (p.phase !== 'over') model.over = null;
      if (p.phase !== 'tentative') model.trial = null;       // a trial that neither retracted() nor committed() ended (resign) is gone, as on the real stage
    },
    selected(sq, targets, forbidden) {
      note('selected', [sq, targets, forbidden]);
      model.selected = sq;
    },
    rejected(sq, reason, streak) {
      note('rejected', [sq, reason, streak]);
    },
    tentative(move, info) {
      note('tentative', [move, info]);
      model.trial = move;
      return animation();
    },
    verdict(v) {
      note('verdict', [v]);
    },
    retracted(info) {
      note('retracted', [info]);
      model.trial = null;
      return animation();
    },
    committed(info) {
      note('committed', [info]);
      model.board = info.view.board;
      model.trial = null;
      model.selected = null;
      return animation();
    },
    rivalMoved(info) {
      note('rivalMoved', [info]);
      model.board = info.view.board;
      return animation();
    },
    undone(info) {
      note('undone', [info]);
      model.board = info.view.board;
      model.trial = null;
      model.selected = null;
      model.over = null;
      return animation();
    },
    hint(step, focus) {
      note('hint', [step, focus]);
    },
    tension(x) {
      note('tension', [x]);
    },
    rival(r) {
      note('rival', [r]);
    },
    over(info) {
      note('over', [info]);
      model.over = info;
      return animation();
    },
    arrows(arrows, opts) {
      note('arrows', [arrows, opts]);
    },
    clearArrows(group) {
      note('clearArrows', [group]);
    },
    highlight(h) {
      note('highlight', [h]);
    },
    preview(moves, opts) {
      note('preview', [moves, opts]);
      return Promise.resolve();
    },
    coachBegin(msg) {
      note('coachBegin', [msg]);
      if (model.lines.some((line) => line.id === msg.id)) model.faults.push(`coachBegin twice for ${msg.id}`);
      model.lines.push({ id: msg.id, kind: msg.kind, cue: msg.cue ?? null, target: msg.target ?? 'bubble', text: '', resets: 0, tools: 0, end: null });
    },
    coachSegment(id, seg) {
      note('coachSegment', [id, seg]);
      const line = lineOf(id);
      if (!line || line.end !== null) model.faults.push(`coachSegment for ${line ? 'an ended' : 'an unknown'} line ${id}`);
      if (line) line.text += seg.type === 'move' ? `【${seg.notation}】` : seg.text;
    },
    coachReset(id) {
      note('coachReset', [id]);
      const line = lineOf(id);
      if (!line || line.end !== null) model.faults.push(`coachReset for ${line ? 'an ended' : 'an unknown'} line ${id}`);
      if (line) {
        line.text = '';
        line.resets += 1;
      }
    },
    coachEnd(id, end) {
      note('coachEnd', [id, end]);
      const line = lineOf(id);
      if (!line) model.faults.push(`coachEnd for an unknown line ${id}`);
      else if (line.end !== null) model.faults.push(`coachEnd twice for ${id}`);
      if (line && line.end === null) line.end = end;
    },
    coachTool(id, t) {
      note('coachTool', [id, t]);
      const line = lineOf(id);
      if (!line || line.end !== null) model.faults.push(`coachTool for ${line ? 'an ended' : 'an unknown'} line ${id}`);
      if (line) line.tools += 1;
    },
    coachLocal(segments, opts) {
      const id = `stage-${++localSeq}`;
      const text = segmentsText(segments);
      note('coachLocal', [text, opts]);
      model.locals.push({ id, text });
      return id;
    },
    caption(segments) {
      const text = segmentsText(segments);
      note('caption', [text]);
      model.captions.push(text);
    },
    childSaid(text) {
      note('childSaid', [text]);
      model.said.push(text);
    },
    chips(chips) {
      note('chips', [chips]);
      model.chips = chips;
    },
    input(s) {
      note('input', [s]);
      model.input = s;
    },
    coachMode(m) {
      note('coachMode', [m]);
      model.coachMode = m;
    },
    beacon() {
      note('beacon', []);
    },
    toast(text) {
      note('toast', [text]);
      model.toasts.push(text);
    },
    announce(text) {
      note('announce', [text]);
    },
    dialog(kind) {
      note('dialog', [kind]);
      return Promise.resolve(script.dialog[kind]);
    },
    notation(rows, current) {
      note('notation', [rows, current]);
    },
    blocking(n) {
      note('blocking', [n]);
    },
    settle() {
      note('settle', []);
    },
    applySettings(s) {
      note('applySettings', [s]);
    },
    on(h) {
      model.handlers = h;
    },
  };

  return Object.assign(port, {
    model,
    script,
    /** Ends every board animation that is pending (script.hold). */
    release() {
      for (const done of held.splice(0)) done();
    },
    /** @returns {number} board animations still pending */
    pending: () => held.length,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// createFakePorts
// ---------------------------------------------------------------------------------------------------------------------

/** The three fake ports and their one call log. */
export function createFakePorts() {
  /** @type {LogEntry[]} */
  const log = [];
  const brain = createFakeBrain(log);
  const coach = createFakeCoach(log);
  const stage = createFakeStage(log);
  return {
    log,
    brain,
    coach,
    stage,
    /** @returns {string[]} the names of the calls, in order */
    ops: () => log.map((entry) => entry.op),
    /** @param {string} op @param {number} [from] @returns {number} index of the first call of `op` at or after `from`, or -1 */
    indexOf: (op, from = 0) => log.findIndex((entry, index) => index >= from && entry.op === op),
    /** @param {string} op @returns {LogEntry[]} */
    calls: (op) => log.filter((entry) => entry.op === op),
    /** @param {string} op @returns {LogEntry|undefined} the last call of `op` */
    last: (op) => log.filter((entry) => entry.op === op).pop(),
    /** @returns {number} the length of the log now: a mark for "what happened after this" */
    mark: () => log.length,
    /** @param {number} mark @returns {string[]} the names of the calls made after `mark` */
    since: (mark) => log.slice(mark).map((entry) => entry.op),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// createDirectorRig
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} RigScript                     what the automatic brain answers; a function returning null leaves the job unanswered
 * @property {((payload:SurveyPayload) => Parameters<typeof fakeSurvey>[1]|null)|null} survey
 * @property {((payload:AssessPayload) => Parameters<typeof fakeAssessed>[1]|null)|null} assess
 * @property {((payload:OpponentPayload) => Parameters<typeof fakeOpponentTurn>[1]|null)|null} opponent
 */

/**
 * A director on a real session, a real task manager (fake worker, virtual timers), a real store (memory storage) and the
 * fake ports, wired in the order of app.js: tasks.sync, save, director.
 *
 * `brain: 'auto'` (default): the fake worker answers every job with a fake result built from its payload (after
 * `await rig.settle()`), shaped by `rig.script`. `brain: 'manual'`: the test answers (`rig.job()`, `rig.progress()`,
 * `rig.done()`, `rig.fail()`), or uses the worker (`rig.worker()`) directly.
 *
 * @param {{brain?:'auto'|'manual', seed?:number, settings?:Partial<Settings>, profile?:Profile, storage?:Record<string, string>, hidden?:() => boolean,
 *          defer?:(deliver:() => void) => void, start?:number}} [options]
 */
export function createDirectorRig(options = {}) {
  const ports = createFakePorts();
  const clock = createVirtualTimers(options.start ?? 1_700_000_000_000);
  /** @type {RigScript} */
  const script = { survey: null, assess: null, opponent: null };

  /** @param {FakeJobMessage} job @param {FakeWorker} worker @returns {unknown} */
  function respond(job, worker) {
    if (job.kind === 'survey') {
      const payload = /** @type {SurveyPayload} */ (job.payload);
      const opts = script.survey ? script.survey(payload) : {};
      if (opts === null) return undefined;
      const survey = fakeSurvey(payload, opts);
      worker.progress(job.id, 'table', survey.table);
      worker.progress(job.id, 'threat', survey.threat);
      return worker.running === job.id ? survey : undefined;
    }
    if (job.kind === 'assess') {
      const payload = /** @type {AssessPayload} */ (job.payload);
      const opts = script.assess ? script.assess(payload) : {};
      return opts === null ? undefined : fakeAssessed(payload, opts);
    }
    if (job.kind === 'opponent') {
      const payload = /** @type {OpponentPayload} */ (job.payload);
      const opts = script.opponent ? script.opponent(payload) : {};
      return opts === null ? undefined : fakeOpponentTurn(payload, opts);
    }
    return undefined;
  }

  const host = createFakeWorkers({ autoReady: true, autoAck: true, respond: options.brain === 'manual' ? undefined : respond, defer: options.defer });
  const session = createSession({ now: clock.now });
  const tasks = createTasks({
    getScope: () => session.scope(),
    createWorker: () => /** @type {Worker} */ (/** @type {unknown} */ (host.createWorker())),
    setTimer: /** @type {typeof setTimeout} */ (/** @type {unknown} */ (clock.setTimer)),
    clearTimer: /** @type {typeof clearTimeout} */ (/** @type {unknown} */ (clock.clearTimer)),
    now: clock.now,
    onWorker: (e, info) => {
      ports.log.push({ op: `worker.${e}`, args: [info] });
      if (e === 'dead') ports.stage.blocking({ kind: 'engine-dead' });
    },
  });
  if (host.current) host.current.ready();

  const storage = createMemoryStorage(options.storage ?? {});
  const realStore = createStore({ storage, now: clock.now, teacher });
  const loaded = realStore.load();
  /** The store, with the calls the director's scripts are judged by in the log. */
  const store = {
    ...realStore,
    /** @param {'game'|'profile'} kind @param {string} why */
    quarantine(kind, why) {
      ports.log.push({ op: 'store.quarantine', args: [kind, why] });
      realStore.quarantine(kind, why);
    },
    /** @param {Profile} profile */
    saveProfile(profile) {
      ports.log.push({ op: 'store.saveProfile', args: [profile] });
      return realStore.saveProfile(profile);
    },
  };
  /** @type {Settings} */
  const settings = { ...loaded.settings, ...options.settings };
  let reloads = 0;

  const save = () => {
    ports.log.push({ op: 'save', args: [] });
    store.saveGame({ ...session.serialize(), ...director.extras() });
  };
  const director = createDirector({
    session, tasks, store, brain: ports.brain, coach: ports.coach, stage: ports.stage,
    profile: options.profile ?? loaded.profile,
    settings,
    save,
    rng: mulberry32(options.seed ?? 1),
    now: clock.now,
    setTimer: /** @type {typeof setTimeout} */ (/** @type {unknown} */ (clock.setTimer)),
    clearTimer: /** @type {typeof clearTimeout} */ (/** @type {unknown} */ (clock.clearTimer)),
    isHidden: options.hidden,
    reload: () => { reloads += 1; },
  });
  session.subscribe((event) => { if (event.type === 'scope') tasks.sync(event.scope); });      // always first
  session.subscribe((event) => { if (event.type === 'change' && event.persist) save(); });
  session.subscribe(director.onEvent);
  ports.stage.on(director.actions);

  /** @returns {FakeWorker} */
  const worker = () => {
    const current = host.current;
    if (!current) throw new Error('rig: no live worker');
    return current;
  };
  /** The job the worker is running, when it is of `kind` (any kind when omitted). @param {string} [kind] @returns {FakeJobMessage|null} */
  const job = (kind) => {
    const current = host.current;
    if (!current || current.running === null) return null;
    const running = current.jobs.find((j) => j.id === current.running) ?? null;
    return running && (kind === undefined || running.kind === kind) ? running : null;
  };

  return {
    ...ports,
    clock, host, session, tasks, store, storage, director, script,
    state: session.getState(),
    actions: director.actions,
    worker,
    job,
    /** @returns {number} how often the injected `reload` ran */
    reloads: () => reloads,
    /** Lets every pending promise callback (and automatic worker answer) run. */
    settle: async () => {
      await tick();
      await tick();
    },
    /** Moves the virtual clock, letting promise callbacks run after every timer. @param {number} ms */
    advance: (ms) => clock.advanceAsync(ms),
    /** @param {'facts'|'table'|'threat'} stage @param {unknown} data */
    progress(stage, data) {
      const running = job();
      if (!running) throw new Error('rig.progress: no running job');
      worker().progress(running.id, stage, data);
    },
    /** Answers the running job. @param {unknown} data */
    done(data) {
      const running = job();
      if (!running) throw new Error('rig.done: no running job');
      worker().done(running.id, data);
    },
    /** The running job fails inside the worker. @param {string} [message] */
    fail(message) {
      const running = job();
      if (!running) throw new Error('rig.fail: no running job');
      worker().error(running.id, message);
    },
    /** The game as app.js would save it now. @returns {SavedGame} */
    saved: () => ({ ...session.serialize(), ...director.extras() }),
  };
}
