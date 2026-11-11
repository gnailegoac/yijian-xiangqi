// Ports (SPEC 4.24): adapters from the real modules to BrainPort / CoachPort. Adapters only; no logic beyond shape
// conversion, plus the LLM tool executor `analyzeMove` described in SPEC 4.24. Owner: G4.
//
// Readings of points the contract leaves open (reported with the package):
// - The tool executor needs the `level` and the `ply` of the assess payload, but `createCoachPort` receives neither the
//   profile nor the game-skill record. The port remembers the TurnBrief every thread was begun with (beginTurn /
//   beginOver are adapters over the client's): `level` is the brief's (the effective level, rounded) and `ply` is the
//   brief's ply plus the number of moves that lead to the assessed position.
// - "lifetime: the reply's lifetime" (SPEC 4.24, 5.8 E-ask): `trial` while a trial is on the board, else `position`. An
//   over thread never reaches the job (`game_over`).
// - `forceLocal` (CONTRACT-NOTES 83): the client gets an options object whose `forceLocal` is a getter over the live
//   `deps.forceLocal`; app.js assigns `deps.forceLocal` whenever the setting changes.
// - 为什么？ after the game is over is answered by the local narrator (CONTRACT-NOTES 112; WAVE3-NOTES, requests to the
//   director). `Thread.ask` has no say-mode, so the port keeps a second client that has no proxy (it can only narrate
//   locally). An over thread is begun on both; the narrator's copy is told every event silently, and a `why` is asked of it
//   alone. The proxy never sees that question, and the model is never asked for a line the over packet does not carry.

/**
 * @import { Board, Color, MoveInfo, Assessed } from '../core/types.js'
 * @import { ToolResult, TurnBrief } from '../coach/types.js'
 * @import { MoveBook } from '../coach/book.js'
 * @import { BrainPort, CoachPort, SessionState, Thread, TaskHandle, Lifetime } from './types.js'
 * @import { createTasks } from './tasks.js'
 */

import { applyMove, boardToFen, opposite } from '../core/engine.js';
import { parseNotation } from '../core/notation.js';
import { positionFacts, moveFacts, quickVerdict, hintFor, openingName } from '../core/facts.js';
import { createSkillProfile, migrateSkillProfile, createGameSkill, reviveGameSkill, recordChildMove, recordOpponentMove, rewindGameSkill,
         effectiveLevel, findRate, teachingContext, finishGame, gameTakeaways } from '../core/teacher.js';
import { planFor } from '../core/brain.js';
import * as brief from '../coach/brief.js';
import { createMoveBook } from '../coach/book.js';
import { createGameMemory } from '../coach/memory.js';
import { parseCoachText } from '../coach/markup.js';
import { createCoachClient } from '../coach/client.js';

/** One tool call waits this long for its assess job (SPEC 4.24). */
const TOOL_MS = 2000;
/** The level a tool job runs at when its thread is not one of this port's (never the case in the app). */
const TOOL_LEVEL = 5;
/** `candidates` of a failed parse that go back to the model (SPEC 4.24). */
const TOOL_CANDIDATES = 5;

/**
 * facts.js, teacher.js, notation.js, engine.js, brain.js (PLAN) behind the BrainPort of §3.10
 * @returns {BrainPort}
 */
export function createBrainPort() {
  /** The plan row the job timeouts come from: `mid` until the worker's `ready` arrives (SPEC 4.24). */
  let plan = planFor('mid');
  return {
    // -- synchronous, main thread --
    positionFacts: (fen, opts) => positionFacts(fen, opts),
    moveFacts: (fen, move, opts) => moveFacts(fen, move, opts),
    quickVerdict: (table, move, level) => quickVerdict(table, move, level),
    hintFor: (input) => hintFor(input),
    openingName: (startFen, moves) => openingName(startFen, moves),
    boardToFen: (board, turn) => boardToFen(board, turn),
    // -- teacher, pure --
    createSkillProfile: (seedLevel) => createSkillProfile(seedLevel),
    migrateSkillProfile: (raw) => migrateSkillProfile(raw),
    createGameSkill: (seed) => createGameSkill(seed),
    reviveGameSkill: (raw, seed) => reviveGameSkill(raw, seed),
    recordChildMove: (profile, game, sample) => recordChildMove(profile, game, sample),
    recordOpponentMove: (game, ply, choice) => recordOpponentMove(game, ply, choice),
    rewindGameSkill: (game, ply) => rewindGameSkill(game, ply),
    effectiveLevel: (profile, game) => effectiveLevel(profile, game),
    findRate: (profile, tier) => findRate(profile, tier),
    teachingContext: (profile, game, extra) => teachingContext(profile, game, extra),
    finishGame: (profile, game, result) => finishGame(profile, game, result),
    gameTakeaways: (game, result, profile) => gameTakeaways(game, result, profile),
    // -- worker jobs: timeoutMs = 2 * budget + 500 (SPEC 4.8.1) --
    surveyJob: (p) => ({ kind: 'survey', payload: p, timeoutMs: 2 * plan.surveyMs + 500 }),
    assessJob: (p) => ({ kind: 'assess', payload: p, timeoutMs: 2 * plan.assessMs + 500 }),
    opponentJob: (p) => ({ kind: 'opponent', payload: p, timeoutMs: 2 * (plan.thinkMs + plan.verifyMs) + 500 }),
    setSpeed(speedClass) {
      plan = planFor(speedClass);
    },
  };
}

/**
 * client.js + brief.js + book.js + memory.js + fallback/lexicon cue text + the tool executor
 * @param {{apiBase:string|null, forceLocal:boolean, tasks:ReturnType<typeof createTasks>, brain:BrainPort, getSession:() => SessionState}} deps
 * @returns {CoachPort}
 */
export function createCoachPort(deps) {
  /** The brief each thread of this port was begun with (the tool executor reads its level and ply). @type {WeakMap<Thread, TurnBrief>} */
  const turns = new WeakMap();

  /** @param {'game_over'|'busy'} error @returns {ToolResult} the client stamps the call id */
  const fail = (error) => ({ id: '', ok: false, error });

  /**
   * The executor of `analyze_move` (SPEC 4.24): the moves are parsed on the main thread, then one assess job runs on the
   * position reached. A UI job that is live, or that arrives meanwhile, wins and the result is `busy`.
   * @param {{notation:string, after:string[]}} input
   * @param {{thread:Thread, book:MoveBook, signal:AbortSignal}} ctx
   * @returns {Promise<ToolResult>}
   */
  async function analyzeMove(input, ctx) {
    const { thread, book, signal } = ctx;
    if (thread.kind === 'over') return fail('game_over');
    const running = deps.tasks.liveJob();
    if (running && !running.tool && (running.kind === 'assess' || running.kind === 'opponent')) return fail('busy');      // a UI job is running

    /** @type {{board:Board, turn:Color}} */
    let pos = book.base;
    /** @type {MoveInfo[]} */
    const moves = [];
    const texts = [...input.after, input.notation];
    for (let i = 0; i < texts.length; i++) {
      const parsed = parseNotation(texts[i], pos.board, pos.turn);
      if (!parsed.ok) {
        return { id: '', ok: false, error: parsed.reason, at: i, candidates: parsed.candidates.slice(0, TOOL_CANDIDATES).map((c) => c.notation) };
      }
      moves.push(parsed.move);
      if (i < texts.length - 1) pos = { board: applyMove(pos.board, parsed.move), turn: opposite(pos.turn) };
    }
    const last = moves[moves.length - 1];
    if (signal.aborted) return fail('busy');

    const state = deps.getSession();
    const turn = turns.get(thread);
    /** @type {Lifetime} */
    const lifetime = state.phase === 'tentative' ? 'trial' : 'position';
    /** @type {TaskHandle<Assessed>} */
    const job = deps.tasks.job({
      ...deps.brain.assessJob({
        fen: boardToFen(pos.board, pos.turn),
        history: [],
        ply: (turn ? turn.ply : state.history.length) + moves.length - 1,      // plies played before the assessed move
        move: { from: last.from, to: last.to },
        table: null,                                                           // a table is only ever one of the base position
        level: turn ? turn.level : TOOL_LEVEL,
        compare: null,
      }),
      lifetime,
      tool: true,
    });
    const cancel = () => job.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    /** @type {Promise<null>} */
    const timeUp = new Promise((resolve) => { timer = setTimeout(() => resolve(null), TOOL_MS); });
    const out = await Promise.race([job.done, timeUp]);
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    if (out === null) {
      job.cancel();
      return fail('busy');
    }
    if (!out.ok) return fail('busy');                                          // superseded by a UI job, cancelled, timeout, error
    try {
      const verdict = brief.buildToolVerdict(out.value, {
        seq: moves.map((move) => move.notation),
        who: last.color === book.base.turn ? 'me' : 'opp',
        activeTry: thread.activeTry(),
        base: book.base,
      }, book);
      return { id: '', ok: true, verdict };
    } catch (error) {
      console.error('[ports] the tool verdict could not be built', error);
      return fail('busy');
    }
  }

  const tools = { analyzeMove };
  const client = createCoachClient({
    apiBase: deps.apiBase,
    get forceLocal() {                                                         // read live, never copied (CONTRACT-NOTES 83)
      return deps.forceLocal === true;
    },
    tools,
  });
  /** The local narrator alone: no proxy, so every event it is told is answered locally. Used for 为什么？ after the game. */
  const narrator = createCoachClient({ apiBase: null, tools });

  return {
    status: () => client.status(),
    mode: () => client.mode(),
    offReason: () => client.offReason(),
    onMode: (fn) => client.onMode(fn),
    probe: () => client.probe(),
    capabilities: () => client.capabilities(),

    beginTurn(turn, book, opts) {
      const thread = client.beginTurn(turn, book, opts);
      turns.set(thread, turn);
      return thread;
    },

    beginOver(turn, book, opts) {
      const live = client.beginOver(turn, book, opts);
      const quiet = narrator.beginOver(turn, book, opts);
      /** @type {Thread} */
      const thread = {
        kind: 'over',
        open(ev, mode, h, replyOpts) {
          quiet.open(ev, 'silent', {});
          return live.open(ev, mode, h, replyOpts);
        },
        hint: (level, packet, mode, h, replyOpts) => live.hint(level, packet, mode, h, replyOpts),
        tryMove: (packet, more, mode, h, replyOpts) => live.tryMove(packet, more, mode, h, replyOpts),
        ask(code, say, h, replyOpts) {
          if (code === 'why') {                                                // answered locally, from the line before it
            live.interrupt();
            return quiet.ask(code, say, h, replyOpts);
          }
          quiet.ask(code, say, {});                                            // keeps the narrator's copy in step; nothing is shown
          return live.ask(code, say, h, replyOpts);
        },
        interrupt() {
          live.interrupt();
          quiet.interrupt();
        },
        retract() {
          live.retract();
          quiet.retract();
        },
        end() {
          live.end();
          quiet.end();
        },
        activeTry: () => live.activeTry(),
        busy: () => live.busy() || quiet.busy(),
      };
      turns.set(thread, turn);
      return thread;
    },

    reset() {
      client.reset();
      narrator.reset();
    },

    brief,
    createMoveBook: (base) => createMoveBook(base),
    createGameMemory: (saved) => createGameMemory(saved),
    parse: (text, book) => parseCoachText(text, book),
  };
}
