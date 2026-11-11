// scripts/coach-bench.js (T2) — the live acceptance of the strategist (`npm run coach:bench`; contract section 14.8).
//
//   node scripts/coach-bench.js [--base http://127.0.0.1:5173/api] [--runs 5] [--moves 30] [--seed 1] [--pace <ms>]
//                               [--only fixtures|game] [--json <file>]
//
// It talks to a RUNNING proxy (`npm start` with the key for the real acceptance, `npm run start:mock` to try the
// tool itself) and answers one question with numbers: is 诸葛亮 quick enough, short enough and true to the board?
//
// Part 1, the fixtures: every request of tests/fixtures/coach that a proxy accepts is sent `--runs` times and its
// stream is timed. Part 2, the scripted game: the game's own modules (session, tasks, director, ports, the coach
// client, the search worker in a worker thread) play `--moves` child moves against 司马懿 with a stage that only
// records, `--runs` times. The child is a script: on fixed move numbers it tries a losing move first and takes it
// back, opens the pouches, taps a chip or types a question; otherwise it tries a good move, waits for the comment
// and confirms. When a game ends early the next one starts, and after the last move the child resigns, so every run
// holds its game-over line.
//
// Printed per event kind: time to `open`, to the first text and to `done` (median and 90th percentile), the usage
// averages and the cached share, replies over their prompt cap and over their display cap, ungrounded notations.
// It FAILS (exit code 1) unless: no ungrounded notation; no reply over its display cap and at most 20 % over the
// prompt cap; no banned word; unsolicited text of at most 1 200 characters in every scripted game; a median first
// text of at most 2.0 s for `opp` / `try` and 3.5 s for questions and pouches; a repeated identical request reports
// cached tokens (when the gateway reports them at all); and every exchange and every game ran to its end.
// Exit code 2: a usage error, or no proxy to talk to.
//
// Two things in the game are no failure: a reply the child's next action cut short, and a reply the client gave up
// because no text had come in time (the child then hears the local line). The second kind enters the first-text
// numbers with the time at which it was given up, so a slow model shows in the medians, where the bars are.
//
// The second budget of section 8.3, a spoken read on at most 40 % of the rival's moves, is checked and printed as
// 超预算 when a game is over it, but it is not among the failure conditions of section 14.8 and does not change the
// exit code: what decides it is the director's rule for speaking (policy.js), not the model.
//
// What "ungrounded" means here. In the scripted game it is the client's own count: a 【…】 of a reply that the move
// book could not resolve, not even as a legal move (src/coach/markup.js reports each one). A fixture has no board, so
// there a 【…】 is ungrounded when the notation is nowhere in the prompt the proxy built for that request; the same
// stricter count is printed for the game, for information.
//
// The request rate: the proxy's default limits are 20 requests at once and 30 a minute for one address, mock or
// live, and 600 a day. The bench therefore spends `--pace` milliseconds per request (default 2100); a full run is
// about 400 requests. `--pace 0` is for a proxy whose limits were raised (COACH_RATE_BURST, COACH_RATE_PER_MIN).
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker as WorkerThread } from 'node:worker_threads';
import { DISPLAY_CAP_FACTOR, LIMITS, capFor, plainLength } from '../src/coach/protocol.js';
import { sanitizeModelText } from '../src/coach/markup.js';
import { NOTATION_SCAN_RE } from '../src/core/codes.js';
import { boardToFen, moveToNotation } from '../src/core/engine.js';
import { normalizeNotation } from '../src/core/notation.js';
import { createSearcher } from '../src/core/search.js';
import { createSkillProfile, migrateSkillProfile, reviveGameSkill } from '../src/core/teacher.js';
import { createDirector } from '../src/game/director.js';
import { createBrainPort, createCoachPort } from '../src/game/ports.js';
import { createSession } from '../src/game/session.js';
import { createStore } from '../src/game/store.js';
import { createTasks } from '../src/game/tasks.js';
import { buildMessages, renderToolResult } from '../server/prompt.js';

/** @import { CoachEvent, CoachRequest, Segment, ToolResult } from '../src/coach/types.js' */
/** @import { ChipSpec, StageHandlers, StagePort, VerdictView } from '../src/game/types.js' */
/** @import { MoveRef } from '../src/core/types.js' */
/** @import { AskCode } from '../src/core/codes.js' */

const USAGE = 'node scripts/coach-bench.js [--base http://127.0.0.1:5173/api] [--runs 5] [--moves 30] [--seed 1] [--pace <ms>] [--only fixtures|game] [--json <file>]';

const DEFAULT_BASE = 'http://127.0.0.1:5173/api';
const DEFAULT_RUNS = 5;
const DEFAULT_MOVES = 30;
const DEFAULT_SEED = 1;
/** Milliseconds per request: 30 requests a minute is the proxy's default limit for one address. */
const DEFAULT_PACE_MS = 2100;

const FIXTURE_DIR = new URL('../tests/fixtures/coach/', import.meta.url);

/** The bars of contract sections 14.8 and 8.3. */
export const BARS = Object.freeze({
  firstAutoMs: 2000,          // median first text of `opp` and `try`
  firstAskMs: 3500,           // median first text of `ask` and `hint`
  overPromptShare: 0.2,       // replies longer than the cap the prompt states
  unsolicitedChars: 1200,     // per scripted game of 30 child moves
  spokenShare: 0.4,           // rival moves that get a spoken read
});

/** Banned in every line of the strategist (contract section 8.6); a reply that holds one fails the bench. */
export const BANNED_WORDS = Object.freeze(['白赚', '稳赚', '必胜', '引擎', '程序', '分数', '离线', '主帅', '又是', '总是', '老是']);
/** Words the system prompt tells the model not to say (section 8.1) beyond the banned list: counted and printed only. */
export const AVOIDED_WORDS = Object.freeze(['数据', '军情', '简报', '工具']);

/** The event kinds a request can end with, in table order. */
export const KINDS = /** @type {readonly Kind[]} */ (Object.freeze(['start', 'opp', 'try', 'hint', 'ask', 'over']));
const KIND_WORD = Object.freeze({ start: '开局', opp: '对手着法', try: '试走点评', hint: '锦囊', ask: '提问', over: '终局' });
/** The client gives up waiting for the first text after this long (contract section 7.5) and answers locally. */
const CLIENT_FIRST_MS = Object.freeze({ start: 2000, opp: 2000, try: 2000, hint: 3500, ask: 3500, over: 3500 });

/** @typedef {'start'|'opp'|'try'|'hint'|'ask'|'over'} Kind */
/** @typedef {'live'|'mock'} Mode */
/**
 * What is measured on one reply.
 * @typedef {Object} Judged
 * @property {number} chars            characters as the child sees them (brackets not counted)
 * @property {number} cap              the cap the prompt states for this event
 * @property {number} displayCap       ceil(1.5 * cap): the client cuts there
 * @property {boolean} overPrompt
 * @property {boolean} overDisplay
 * @property {string[]} ungrounded     the 【…】 of the reply whose notation is nowhere in the prompt
 * @property {string[]} banned         banned words found
 * @property {string[]} avoided        words of AVOIDED_WORDS found
 */
/**
 * One answered event: all the legs of one exchange with the proxy.
 * @typedef {Object} Sample
 * @property {'fixture'|'game'} source
 * @property {string} name             the fixture's file name, or `game-<run>`
 * @property {number} run              1-based
 * @property {Kind} kind
 * @property {string} detail           the ask code or the pouch number, else ''
 * @property {string} end              '' while it runs; `done`, `error:<code>`, `http:<status>[:<code>]`, `aborted`, `timeout`, `eof`, `network`
 * @property {number|null} openMs      from the first POST to its `open` event
 * @property {number|null} firstMs     from the first POST to the first `delta` or `tool` event
 * @property {number|null} doneMs      from the first POST to `done` (tool rounds included)
 * @property {number|null} endMs       from the first POST to the end, whatever it was
 * @property {number} legs
 * @property {{in:number, cached:number, out:number}|null} usage
 * @property {string} text             the signed text of `done`
 * @property {Judged|null} judged      set when the exchange ended with `done`
 */

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Options
 * @property {string} base             the proxy's API base, without a trailing slash
 * @property {number} runs
 * @property {number} moves            child moves per scripted game
 * @property {number} seed
 * @property {number|null} pace        milliseconds per request; null = the default, 2100
 * @property {'fixtures'|'game'|null} only
 * @property {string|null} json
 * @property {boolean} help
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const options = { base: DEFAULT_BASE, runs: DEFAULT_RUNS, moves: DEFAULT_MOVES, seed: DEFAULT_SEED, pace: null, only: null, json: null, help: false };
  /** @param {string} flag @param {string} value @param {number} lo @param {number} hi */
  const whole = (flag, value, lo, hi) => {
    if (!/^\d{1,9}$/.test(value) || Number(value) < lo || Number(value) > hi) throw new Error(`${flag} must be a whole number from ${lo} to ${hi}`);
    return Number(value);
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if ((flag === '--help' || flag === '-h') && inline === undefined) { options.help = true; continue; }
    if (!['--base', '--runs', '--moves', '--seed', '--pace', '--only', '--json'].includes(flag)) throw new Error(`unknown option ${argv[i]}`);
    const value = inline ?? argv[++i];
    if (value === undefined || value === '') throw new Error(`${flag} needs a value`);
    if (flag === '--base') {
      let url;
      try { url = new URL(value); } catch { url = null; }
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw new Error('--base must be an http or https URL, for example http://127.0.0.1:5173/api');
      options.base = value.replace(/\/+$/, '');
    } else if (flag === '--runs') options.runs = whole(flag, value, 1, 50);
    else if (flag === '--moves') options.moves = whole(flag, value, 1, 200);
    else if (flag === '--seed') options.seed = whole(flag, value, 0, 0xFFFFFFFF);
    else if (flag === '--pace') options.pace = whole(flag, value, 0, 600000);
    else if (flag === '--only') {
      if (value !== 'fixtures' && value !== 'game') throw new Error('--only takes fixtures or game');
      options.only = value;
    } else options.json = value;
  }
  return options;
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures: which ones replay, and as what
// ---------------------------------------------------------------------------------------------------------------

/**
 * A stored request fixture as it can be sent to a proxy, or null when it cannot be replayed there.
 *
 * - An earlier event that the model answered (`said: 'llm'`) carries the contract's placeholder signature, which no
 *   key verifies: it is sent as `said: 'none'`, without its `reply` and its `tools`. The event to answer is the
 *   same; the model just does not see its own earlier words.
 * - A fixture with `resume` is one leg of a tool exchange whose token was sealed with the mock key for exactly the
 *   stored body: it replays as stored against a mock proxy only when nothing in it had to be changed, and never
 *   against a live one.
 * @param {unknown} stored  the parsed fixture
 * @param {Mode} mode
 * @returns {{body: CoachRequest, changed: number}|null}  changed = events that lost their signed reply
 */
export function prepareFixture(stored, mode) {
  const body = /** @type {CoachRequest} */ (structuredClone(stored));
  let changed = 0;
  body.events = body.events.map((event) => {
    if (event.said !== 'llm') return event;
    changed++;
    const { reply: _reply, tools: _tools, ...rest } = event;
    return /** @type {CoachEvent} */ ({ ...rest, said: 'none' });
  });
  if (body.resume && (mode !== 'mock' || changed > 0)) return null;
  return { body, changed };
}

// ---------------------------------------------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------------------------------------------

/**
 * An incremental parser of the proxy's SSE stream: `onEvent(name, data)` for every `event:` / `data:` block, in
 * order. Comment lines (the ping) and blocks that are not JSON are dropped.
 * @param {(event: string, data: any) => void} onEvent
 * @returns {{push(chunk: Uint8Array): void, end(): void}}
 */
export function createSseParser(onEvent) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const drain = () => {
    for (let at = buffer.indexOf('\n\n'); at >= 0; at = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      let name = '', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!name || !data) continue;
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      onEvent(name, parsed);
    }
  };
  return {
    push(chunk) {
      // a line break may arrive as CR LF, and in two chunks: it is put right on the whole buffer
      buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
      drain();
    },
    end() {
      buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
      drain();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One reply against its request
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {CoachRequest} body
 * @returns {{kind: Kind, detail: string, event: CoachEvent}} the event the request asks to answer
 */
export function lastEvent(body) {
  const event = body.events[body.events.length - 1];
  const detail = event.kind === 'ask' ? event.ask : event.kind === 'hint' ? String(event.level) : '';
  return { kind: /** @type {Kind} */ (event.kind), detail, event };
}

/**
 * Every notation the model was shown for this request: whatever looks like one in the messages the proxy builds
 * (the brief, the events, the earlier answers, the child's own sentence) and in the tool results of a resumed leg.
 * The system prompt is left out: its two examples are no moves of this board.
 * @param {CoachRequest} body
 * @returns {Set<string>} normalised notations
 */
export function knownNotations(body) {
  /** @type {Set<string>} */
  const known = new Set();
  /** @param {string} text */
  const scan = (text) => {
    for (const match of text.matchAll(NOTATION_SCAN_RE)) known.add(normalizeNotation(match[0]));
  };
  const { resume, ...request } = body;
  for (const message of buildMessages(request, [])) {
    if (message.role !== 'system' && typeof message.content === 'string') scan(message.content);
  }
  for (const result of /** @type {ToolResult[]} */ (resume?.results ?? [])) scan(renderToolResult(result, body.turn.me));
  return known;
}

/**
 * The measurements of one reply. In mock mode the reply starts with the mock's own marker 〔kind=…〕, which no model
 * writes and no child sees; it is taken off first.
 * @param {CoachRequest} body  the request (of the last leg: with `resume` when there was a tool round)
 * @param {string} text        the text of `done`
 * @param {Mode} mode
 * @returns {Judged}
 */
export function judgeReply(body, text, mode) {
  const { event } = lastEvent(body);
  const shown = sanitizeModelText(mode === 'mock' ? text.replace(/^〔kind=[a-z]+〕/, '') : text);
  const cap = capFor(event);
  const displayCap = Math.ceil(DISPLAY_CAP_FACTOR * cap);
  const chars = plainLength(shown);
  const known = knownNotations(body);
  /** @type {string[]} */
  const ungrounded = [];
  for (const match of shown.matchAll(/【([^【】]*)】/g)) {
    if (!known.has(normalizeNotation(match[1]))) ungrounded.push(match[1]);
  }
  return {
    chars, cap, displayCap, overPrompt: chars > cap, overDisplay: chars > displayCap, ungrounded,
    banned: BANNED_WORDS.filter((word) => shown.includes(word)),
    avoided: AVOIDED_WORDS.filter((word) => shown.includes(word)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The observer: a fetch that times every coach exchange passing through it
// ---------------------------------------------------------------------------------------------------------------

/**
 * Wraps a fetch. Every `POST …/coach` that passes becomes (a leg of) a Sample; everything else is passed on
 * untouched. The stream is handed on chunk by chunk as it arrives, so the caller reads what it would have read.
 * The Origin header is added: a browser sends it by itself, Node does not, and the proxy answers a coach POST only
 * from its own origin.
 * @param {{fetch: typeof fetch, origin: string, mode: Mode, source: 'fixture'|'game', now?: () => number}} deps
 * @returns {{fetch: typeof fetch, samples: Sample[], label: {name: string, run: number}, inflight(): number, flush(): void}}
 */
export function createObserver(deps) {
  const now = deps.now ?? (() => performance.now());
  /** @type {Sample[]} */
  const samples = [];
  /** Exchanges whose last leg ended with `tool`, by their body without `resume`. @type {Map<string, {sample: Sample, t0: number}>} */
  const pending = new Map();
  const label = { name: '', run: 0 };
  let inflight = 0;

  /** @param {Sample} sample @param {string} end @param {number} t0 @param {CoachRequest} body */
  const finish = (sample, end, t0, body) => {
    if (sample.end !== '') return;
    sample.end = end;
    sample.endMs = now() - t0;
    if (end === 'done') sample.judged = judgeReply(body, sample.text, deps.mode);
  };

  /** @type {typeof fetch} */
  const observed = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    /** @type {CoachRequest|null} */
    let body = null;
    if (init?.method === 'POST' && /\/coach(?:\?|$)/.test(url) && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    const headers = new Headers(init?.headers);
    headers.set('origin', deps.origin);
    const request = { ...init, headers };
    if (!body || !Array.isArray(body.events) || body.events.length === 0) return deps.fetch(input, request);

    const { resume: _resume, ...rest } = body;
    const key = JSON.stringify(rest);
    const resumed = body.resume ? pending.get(key) : undefined;
    if (resumed) pending.delete(key);
    const { kind, detail } = lastEvent(body);
    /** @type {Sample} */
    const sample = resumed?.sample ?? {
      source: deps.source, name: label.name, run: label.run, kind, detail, end: '',
      openMs: null, firstMs: null, doneMs: null, endMs: null, legs: 0, usage: null, text: '', judged: null,
    };
    const t0 = resumed?.t0 ?? now();
    if (!resumed) samples.push(sample);
    sample.legs++;
    const firstLeg = sample.legs === 1;
    const gone = () => (init?.signal?.aborted ? 'aborted' : 'network');

    inflight++;
    let response;
    try {
      response = await deps.fetch(input, request);
    } catch (e) {
      inflight--;
      finish(sample, gone(), t0, body);
      throw e;
    }
    if (!response.ok || !response.body) {
      /** @type {unknown} */
      let code;
      try { code = (await response.clone().json())?.error?.code; } catch { code = undefined; }
      inflight--;
      finish(sample, `http:${response.status}${typeof code === 'string' ? `:${code}` : ''}`, t0, body);
      return response;
    }

    let ended = '';
    const parser = createSseParser((event, data) => {
      const at = now() - t0;
      if (event === 'open') {
        if (firstLeg && sample.openMs === null) sample.openMs = at;
      } else if (event === 'delta') {
        if (firstLeg && sample.firstMs === null) sample.firstMs = at;
      } else if (event === 'tool') {
        if (firstLeg && sample.firstMs === null) sample.firstMs = at;
        ended = 'tool';
      } else if (event === 'done') {
        ended = 'done';
        sample.doneMs = at;
        sample.text = typeof data?.text === 'string' ? data.text : '';
        const usage = data?.usage;
        if (usage && typeof usage === 'object') sample.usage = { in: Number(usage.in) || 0, cached: Number(usage.cached) || 0, out: Number(usage.out) || 0 };
      } else if (event === 'error') {
        ended = `error:${typeof data?.code === 'string' ? data.code : 'internal'}`;
      }
    });
    let closed = false;
    /** @param {string} how the way the stream ended when no terminal event was seen */
    const close = (how) => {
      if (closed) return;
      closed = true;
      inflight--;
      parser.end();
      if (ended === 'tool') pending.set(key, { sample, t0 });
      else finish(sample, ended || how, t0, /** @type {CoachRequest} */ (body));
    };
    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            close(init?.signal?.aborted ? 'aborted' : 'eof');      // a proxy closes the stream of a caller that left
            controller.close();
            return;
          }
          parser.push(value);
          controller.enqueue(value);
        } catch (e) {
          close(gone());
          controller.error(e);
        }
      },
      cancel(reason) {
        close('aborted');
        return reader.cancel(reason);
      },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  return {
    fetch: observed,
    samples,
    label,
    inflight: () => inflight,
    /** An exchange that stopped after a tool round was given up by its caller. */
    flush() {
      for (const { sample, t0 } of pending.values()) {
        if (sample.end === '') { sample.end = 'aborted'; sample.endMs = now() - t0; }
      }
      pending.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------------------------

/** The median: the middle value, or the mean of the two middle values. @param {number[]} values @returns {number|null} */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The p-th percentile by nearest rank (p in 0..1). @param {number[]} values @param {number} p @returns {number|null} */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/**
 * An exchange of the game that the client gave up because no text had come in time: it was aborted before any text,
 * not earlier than the client's own limit for that kind. (An abort before that is the child moving on.) The child
 * then hears the local line. It is no failure of the bench: the bars on the first text are medians, and such an
 * exchange enters them with the time at which it was given up.
 * @param {Sample} sample
 * @returns {boolean}
 */
function gaveUp(sample) {
  return sample.source === 'game' && sample.end === 'aborted' && sample.firstMs === null && sample.legs === 1
    && sample.endMs !== null && sample.endMs >= CLIENT_FIRST_MS[sample.kind] - 100;
}

/**
 * @typedef {Object} KindStats
 * @property {Kind} kind
 * @property {number} n                 exchanges that ended with `done`
 * @property {number} lateFirst         exchanges of the game given up for a late first text (counted in `first`)
 * @property {{p50:number|null, p90:number|null}} open
 * @property {{p50:number|null, p90:number|null}} first
 * @property {{p50:number|null, p90:number|null}} done
 * @property {{in:number, cached:number, out:number}|null} usage    averages
 * @property {number|null} cachedShare  cached / (in + cached)
 * @property {number} overPrompt
 * @property {number} overDisplay
 * @property {number} ungrounded        notations
 *
 * @typedef {Object} Summary
 * @property {KindStats[]} kinds
 * @property {number} replies           exchanges that ended with `done`
 * @property {number} overPrompt
 * @property {number} overDisplay
 * @property {{name:string, kind:Kind, notation:string}[]} ungroundedFixtures   not in the prompt, fixtures
 * @property {{name:string, kind:Kind, notation:string}[]} ungroundedGame       not in the prompt, the game (information)
 * @property {{name:string, kind:Kind, word:string}[]} banned
 * @property {{name:string, kind:Kind, word:string}[]} avoided
 * @property {{name:string, run:number, kind:Kind, end:string}[]} failures      exchanges that did not end as they should
 * @property {number} aborted           exchanges of the game the child's next action ended (not failures)
 * @property {number} late              exchanges of the game the client gave up for a late first text (not failures)
 * @property {boolean} cachedSeen       some reply reported cached tokens
 * @property {{name:string, repeats:number, cached:boolean}[]} repeated         per fixture: did a repeated request report cached tokens
 */

/**
 * @param {Sample[]} samples
 * @returns {Summary}
 */
export function summarize(samples) {
  /** @type {Summary} */
  const summary = {
    kinds: [], replies: 0, overPrompt: 0, overDisplay: 0, ungroundedFixtures: [], ungroundedGame: [], banned: [], avoided: [],
    failures: [], aborted: 0, late: 0, cachedSeen: false, repeated: [],
  };
  /** @param {(number|null)[]} values */
  const spread = (values) => {
    const numbers = /** @type {number[]} */ (values.filter((v) => v !== null));
    return { p50: median(numbers), p90: percentile(numbers, 0.9) };
  };
  for (const kind of KINDS) {
    const of = samples.filter((s) => s.kind === kind);
    const done = of.filter((s) => s.end === 'done');
    const late = of.filter(gaveUp);
    const usages = /** @type {{in:number, cached:number, out:number}[]} */ (done.map((s) => s.usage).filter(Boolean));
    const sum = (/** @type {'in'|'cached'|'out'} */ field) => usages.reduce((total, u) => total + u[field], 0);
    const prompt = sum('in') + sum('cached');
    summary.kinds.push({
      kind, n: done.length, lateFirst: late.length,
      open: spread(done.map((s) => s.openMs)),
      first: spread([...done.map((s) => s.firstMs), ...late.map((s) => s.endMs)]),
      done: spread(done.map((s) => s.doneMs)),
      usage: usages.length ? { in: sum('in') / usages.length, cached: sum('cached') / usages.length, out: sum('out') / usages.length } : null,
      cachedShare: prompt > 0 ? sum('cached') / prompt : null,
      overPrompt: done.filter((s) => s.judged?.overPrompt).length,
      overDisplay: done.filter((s) => s.judged?.overDisplay).length,
      ungrounded: done.reduce((total, s) => total + (s.judged?.ungrounded.length ?? 0), 0),
    });
  }
  for (const s of samples) {
    if (s.end === 'done' && s.judged) {
      summary.replies++;
      if (s.judged.overPrompt) summary.overPrompt++;
      if (s.judged.overDisplay) summary.overDisplay++;
      const list = s.source === 'fixture' ? summary.ungroundedFixtures : summary.ungroundedGame;
      for (const notation of s.judged.ungrounded) list.push({ name: s.name, kind: s.kind, notation });
      for (const word of s.judged.banned) summary.banned.push({ name: s.name, kind: s.kind, word });
      for (const word of s.judged.avoided) summary.avoided.push({ name: s.name, kind: s.kind, word });
      if (s.usage && s.usage.cached > 0) summary.cachedSeen = true;
    } else if (s.source === 'game' && s.end === 'aborted') {
      if (gaveUp(s)) summary.late++;
      else summary.aborted++;
    } else {
      summary.failures.push({ name: s.name, run: s.run, kind: s.kind, end: s.end || 'unfinished' });
    }
  }
  /** @type {Map<string, Sample[]>} */
  const byFixture = new Map();
  for (const s of samples) {
    if (s.source !== 'fixture' || s.end !== 'done') continue;
    byFixture.set(s.name, [...(byFixture.get(s.name) ?? []), s]);
  }
  for (const [name, list] of byFixture) {
    const later = list.filter((s) => s.run > 1);
    if (later.length > 0) summary.repeated.push({ name, repeats: later.length, cached: later.some((s) => (s.usage?.cached ?? 0) > 0) });
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------
// The scripted game: what the stage heard
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Line                 one thing 诸葛亮 said, as the stage was told it
 * @property {string} id
 * @property {'caption'|'start'|'opp'|'try'|'hint'|'ask'|'over'|'system'} cat   `system` = a line the director says itself
 * @property {string} cue                 the interjection shown with it
 * @property {string} text
 * @property {boolean} ended
 *
 * @typedef {Object} GameRun              one run of the scripted game
 * @property {number} run
 * @property {number} moves               child moves confirmed
 * @property {number} wanted              child moves the run was asked for
 * @property {number} games               games started (a game that ends early is followed by the next)
 * @property {number} rivalMoves
 * @property {number} spokenOpp           rival moves that got a spoken read (a line of kind `opp` with text)
 * @property {Record<Line['cat'], number>} chars     characters shown, by category (interjections included)
 * @property {number} unsolicited         captions + rival reads + trial comments and guiding questions + game-over lines
 * @property {number} cues                the part of `unsolicited` that is interjections (妙哉！ 且慢……)
 * @property {string[]} unresolved        notations the client could not resolve (its own `ungrounded` count)
 * @property {string[]} errors            what the game's modules reported with console.error, and steps that never came
 */

/** The categories of lines nobody asked for (contract section 8.3). */
const UNSOLICITED = /** @type {readonly Line['cat'][]} */ (Object.freeze(['caption', 'opp', 'try', 'over']));

/**
 * The characters the child was shown without asking: captions, rival reads, trial comments (the guiding questions
 * of held trials are among them), game-over lines (contract section 8.3), each with the interjection that opens
 * it, because the child reads the two as one sentence. Start greetings, the director's own short lines, pouches and
 * answers are counted beside it. In mock mode a reply carries the mock's marker 〔kind=…〕, which is not counted.
 * @param {Line[]} lines
 * @param {Mode} mode
 * @returns {{chars: Record<Line['cat'], number>, unsolicited: number, cues: number, spokenOpp: number}}
 */
export function countLines(lines, mode) {
  /** @type {Record<Line['cat'], number>} */
  const chars = { caption: 0, start: 0, opp: 0, try: 0, hint: 0, ask: 0, over: 0, system: 0 };
  let spokenOpp = 0, cues = 0;
  for (const line of lines) {
    const shown = plainLength(mode === 'mock' ? line.text.replace(/〔kind=[a-z]+〕/g, '') : line.text);
    const cue = plainLength(line.cue);
    chars[line.cat] += shown + cue;
    if (UNSOLICITED.includes(line.cat)) cues += cue;
    if (line.cat === 'opp' && shown > 0) spokenOpp++;
  }
  return { chars, unsolicited: UNSOLICITED.reduce((total, cat) => total + chars[cat], 0), cues, spokenOpp };
}

// ---------------------------------------------------------------------------------------------------------------
// The bars
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {{id:string, status:'pass'|'fail'|'warn'|'info'|'none', what:string, value:string, bar:string}} BarResult
 *    fail: a failure condition of section 14.8 is not met; warn: a budget outside that list is exceeded (printed,
 *    no effect on the exit code); info: printed only; none: nothing was measured */

/** @param {number} ms */
const seconds = (ms) => `${(ms / 1000).toFixed(2)} 秒`;
/** @param {number} share */
const percent = (share) => `${(share * 100).toFixed(0)}%`;

/**
 * Every bar of contract section 14.8 (and the budget of section 8.3) against what was measured. A bar whose
 * subject was not measured has the status `none`; `info` lines are printed and never fail.
 * @param {Summary} summary
 * @param {GameRun[]} games
 * @returns {BarResult[]}
 */
export function judgeBars(summary, games) {
  /** @type {BarResult[]} */
  const bars = [];
  /** @param {string} id @param {boolean|null} ok null = not measured @param {string} what @param {string} value @param {string} bar */
  const add = (id, ok, what, value, bar) => bars.push({ id, status: ok === null ? 'none' : ok ? 'pass' : 'fail', what, value, bar });
  const measured = summary.replies > 0;
  const played = games.length > 0;

  const unresolved = games.reduce((total, g) => total + g.unresolved.length, 0);
  const ungrounded = summary.ungroundedFixtures.length + unresolved;
  add('ungrounded', measured ? ungrounded === 0 : null, '回复里对不上棋盘的【】着法',
    `${ungrounded} 个（夹具 ${summary.ungroundedFixtures.length}，对局 ${played ? unresolved : '-'}）`, '0');
  bars.push({ id: 'ungrounded-game-brief', status: 'info', what: '对局里不在军情中、但棋盘上走得通的【】着法', value: `${Math.max(0, summary.ungroundedGame.length - unresolved)} 个`, bar: '' });

  add('over-display', measured ? summary.overDisplay === 0 : null, '超过显示上限（提示字数的 1.5 倍）的回复', `${summary.overDisplay} / ${summary.replies}`, '0');
  const share = summary.replies > 0 ? summary.overPrompt / summary.replies : 0;
  add('over-prompt', measured ? share <= BARS.overPromptShare : null, '超过提示字数的回复', `${summary.overPrompt} / ${summary.replies}（${percent(share)}）`, `≤ ${percent(BARS.overPromptShare)}`);
  add('banned', measured ? summary.banned.length === 0 : null, '出现禁用词的回复',
    summary.banned.length ? `${summary.banned.length} 处：${[...new Set(summary.banned.map((b) => b.word))].join('、')}` : '0', '0');
  bars.push({ id: 'avoided', status: 'info', what: '出现提示词里说“不说”的词（数据、军情、简报、工具）', value: summary.avoided.length ? `${summary.avoided.length} 处：${[...new Set(summary.avoided.map((b) => b.word))].join('、')}` : '0', bar: '' });

  const worstText = played ? Math.max(...games.map((g) => g.unsolicited)) : 0;
  add('unsolicited', played ? worstText <= BARS.unsolicitedChars : null, '一局里没人问就说的字数（最多的一局）', played ? `${worstText} 字` : '-', `≤ ${BARS.unsolicitedChars} 字`);
  const shares = games.filter((g) => g.rivalMoves > 0).map((g) => g.spokenOpp / g.rivalMoves);
  const worstShare = shares.length ? Math.max(...shares) : 0;
  // the second budget of section 8.3: checked, but not a failure condition of section 14.8
  bars.push({
    id: 'spoken-share', status: shares.length === 0 ? 'none' : worstShare <= BARS.spokenShare ? 'pass' : 'warn',
    what: '司马懿的着法里军师开口讲解的比例（最多的一局）', value: shares.length ? percent(worstShare) : '-', bar: `≤ ${percent(BARS.spokenShare)}`,
  });

  for (const stats of summary.kinds) {
    const limit = stats.kind === 'opp' || stats.kind === 'try' ? BARS.firstAutoMs : stats.kind === 'ask' || stats.kind === 'hint' ? BARS.firstAskMs : null;
    const p50 = stats.first.p50;
    const value = p50 === null ? '-' : `${seconds(p50)}${stats.lateFirst ? `（其中 ${stats.lateFirst} 次等不到、改由本地回答）` : ''}`;
    if (limit === null) bars.push({ id: `first-${stats.kind}`, status: 'info', what: `${KIND_WORD[stats.kind]}：首字时间的中位数`, value, bar: `页面等到 ${seconds(CLIENT_FIRST_MS[stats.kind])} 就改用本地的话` });
    else add(`first-${stats.kind}`, p50 === null ? null : p50 <= limit, `${KIND_WORD[stats.kind]}：首字时间的中位数`, value, `≤ ${seconds(limit)}`);
  }

  const missed = summary.repeated.filter((r) => !r.cached);
  if (!summary.cachedSeen) {
    bars.push({ id: 'cached', status: summary.repeated.length ? 'info' : 'none', what: '重复的同一请求用上了缓存', value: '网关没有报告缓存 token，这一条不算', bar: '' });
  } else {
    add('cached', summary.repeated.length ? missed.length === 0 : null, '重复的同一请求用上了缓存',
      `${summary.repeated.length - missed.length} / ${summary.repeated.length} 个夹具${missed.length ? `（没有的：${missed.map((r) => r.name).join('、')}）` : ''}`, '全部');
  }

  const errors = games.reduce((total, g) => total + g.errors.length, 0);
  const short = games.filter((g) => g.moves < g.wanted).length;
  add('complete', measured || played ? summary.failures.length === 0 && errors === 0 && short === 0 : null, '每次问答、每一局都走完了',
    `失败的问答 ${summary.failures.length} 次，对局报错 ${errors} 条，没下完的对局 ${short} 局`, '都是 0');
  return bars;
}

/** @param {BarResult[]} bars @returns {number} the bars that failed */
export function failedBars(bars) {
  return bars.filter((bar) => bar.status === 'fail').length;
}

// ---------------------------------------------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------------------------------------------

/** Width of a string on a terminal: a CJK character takes two columns. @param {string} text @returns {number} */
function widthOf(text) {
  let width = 0;
  for (const ch of text) width += /** @type {number} */ (ch.codePointAt(0)) >= 0x2E80 ? 2 : 1;
  return width;
}
/** @param {string} text @param {number} width @returns {string} */
const padEnd = (text, width) => text + ' '.repeat(Math.max(0, width - widthOf(text)));
/** @param {string} text @param {number} width @returns {string} */
const padStart = (text, width) => ' '.repeat(Math.max(0, width - widthOf(text))) + text;

const STATUS_WORD = Object.freeze({ pass: '通过', fail: '未达标', warn: '超预算', info: '只打印', none: '无数据' });

/** @param {number|null} ms @returns {string} milliseconds, whole */
const cell = (ms) => (ms === null ? '-' : String(Math.round(ms)));

/** The columns of the table: header, width, and the cell of a kind. @type {readonly (readonly [string, number, (s:KindStats) => string])[]} */
const COLUMNS = Object.freeze([
  ['回复', 6, (s) => String(s.n)],
  ['open中位', 10, (s) => cell(s.open.p50)],
  ['open九成', 10, (s) => cell(s.open.p90)],
  ['首字中位', 10, (s) => cell(s.first.p50)],
  ['首字九成', 10, (s) => cell(s.first.p90)],
  ['done中位', 10, (s) => cell(s.done.p50)],
  ['done九成', 10, (s) => cell(s.done.p90)],
  ['输入', 7, (s) => (s.usage ? s.usage.in.toFixed(0) : '-')],
  ['缓存', 7, (s) => (s.usage ? s.usage.cached.toFixed(0) : '-')],
  ['输出', 6, (s) => (s.usage ? s.usage.out.toFixed(0) : '-')],
  ['缓存占比', 10, (s) => (s.cachedShare === null ? '-' : percent(s.cachedShare))],
  ['超提示', 8, (s) => String(s.overPrompt)],
  ['超显示', 8, (s) => String(s.overDisplay)],
  ['无据', 6, (s) => String(s.ungrounded)],
]);

/**
 * The table, one line per event kind; times in milliseconds.
 * @param {Summary} summary
 * @returns {string[]}
 */
export function tableLines(summary) {
  const head = padEnd('事件', 14) + COLUMNS.map(([title, width]) => padStart(title, width)).join('');
  const rows = summary.kinds.map((s) => padEnd(`${s.kind} ${KIND_WORD[s.kind]}`, 14) + COLUMNS.map(([, width, value]) => padStart(value(s), width)).join(''));
  return [head, ...rows];
}

/**
 * One line per run of the scripted game.
 * @param {GameRun[]} games
 * @returns {string[]}
 */
export function gameLines(games) {
  return games.map((g) => `  第 ${g.run} 局：孩子 ${g.moves}/${g.wanted} 手${g.games > 1 ? `（提前终局，共开了 ${g.games} 盘）` : ''}，没人问就说的 ${g.unsolicited} 字`
    + `（着法字幕 ${g.chars.caption}，讲对手 ${g.chars.opp}，试走点评 ${g.chars.try}，终局 ${g.chars.over}；其中开口的语气词 ${g.cues} 字）；另有开局 ${g.chars.start}、军师自己的短句 ${g.chars.system}、`
    + `锦囊 ${g.chars.hint}、回答 ${g.chars.ask} 字；司马懿 ${g.rivalMoves} 手里讲了 ${g.spokenOpp} 手`
    + (g.rivalMoves ? `（${percent(g.spokenOpp / g.rivalMoves)}）` : ''));
}

/**
 * One line per bar: status, what, the reached value and the bar.
 * @param {BarResult[]} bars
 * @returns {string[]}
 */
export function barLines(bars) {
  return bars.map((bar) => `  ${padEnd(STATUS_WORD[bar.status], 8)}${bar.what}：${bar.value}${bar.bar ? `（线：${bar.bar}）` : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Part 1: the fixtures
// ---------------------------------------------------------------------------------------------------------------

const sleep = (/** @type {number} */ ms) => new Promise((done) => { setTimeout(done, ms); });

/** One leg may take this long before the bench gives it up. */
const LEG_TIMEOUT_MS = 90000;
/** A request that is refused for its rate is sent again this many times, after the wait the proxy asks for. */
const RATE_RETRIES = 3;

/**
 * Sends every replayable fixture `runs` times through the observer's fetch. A `tool` event is answered the way a
 * client without a board must: every call `busy`; the resumed leg is part of the same exchange.
 * @param {{base: string, mode: Mode, runs: number, pace: number, observer: ReturnType<typeof createObserver>,
 *          log: (line: string) => void, fixtures?: Record<string, unknown>}} ctx   fixtures: name -> parsed body (default: the files)
 * @returns {Promise<{sent: string[], skipped: string[]}>}
 */
export async function replayFixtures(ctx) {
  /** @type {Record<string, unknown>} */
  const stored = ctx.fixtures ?? Object.fromEntries(readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json')).sort()
    .map((name) => [name, JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8'))]));
  /** @type {string[]} */
  const sent = [];
  /** @type {string[]} */
  const skipped = [];
  let last = -Infinity;
  const pace = async () => {
    const wait = last + ctx.pace - performance.now();
    if (wait > 0) await sleep(wait);
    last = performance.now();
  };

  /**
   * @param {CoachRequest} body
   * @returns {Promise<{event: string, data: any, status: number}>} how the leg ended
   */
  const leg = async (body) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LEG_TIMEOUT_MS);
    /** @type {{event: string, data: any, status: number}} */
    let end = { event: 'eof', data: null, status: 0 };
    try {
      const response = await ctx.observer.fetch(`${ctx.base}/coach`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal,
      });
      end.status = response.status;
      if (!response.ok || !response.body) {
        let data = null;
        try { data = await response.json(); } catch { data = null; }
        return { event: 'http', data: data?.error ?? null, status: response.status };
      }
      const parser = createSseParser((event, data) => {
        if (event === 'done' || event === 'tool' || event === 'error') end = { event, data, status: response.status };
      });
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(value);
      }
      parser.end();
    } catch {
      end = { event: ac.signal.aborted ? 'timeout' : 'network', data: null, status: end.status };
    } finally {
      clearTimeout(timer);
    }
    return end;
  };

  for (const [name, raw] of Object.entries(stored)) {
    const prepared = prepareFixture(raw, ctx.mode);
    if (!prepared) { skipped.push(name); continue; }
    sent.push(name);
    for (let run = 1; run <= ctx.runs; run++) {
      ctx.observer.label.name = name;
      ctx.observer.label.run = run;
      for (let attempt = 0; ; attempt++) {
        /** @type {CoachRequest} */
        let body = prepared.body;
        /** @type {ToolResult[]} */
        const results = [];
        /** Seconds to wait when the proxy refused a leg for its rate. @type {number|null} */
        let retryAfter = null;
        for (let round = 0; round <= LIMITS.TOOL_ROUNDS; round++) {
          await pace();
          const end = await leg(body);
          if (end.event === 'http' && end.status === 429) retryAfter = Math.min(60, Math.max(1, Number(end.data?.retry_after) || 2));
          if (end.event !== 'tool') break;
          for (const call of /** @type {{id: string}[]} */ (end.data?.calls ?? [])) results.push({ id: call.id, ok: false, error: 'busy' });
          body = { ...prepared.body, resume: { token: String(end.data?.resume ?? ''), results: [...results] } };
        }
        ctx.observer.flush();
        if (retryAfter === null || attempt >= RATE_RETRIES) break;
        // not a measurement: the exchange is dropped and sent again from its first leg when the proxy allows it
        for (let k = ctx.observer.samples.length - 1; k >= 0; k--) {
          if (ctx.observer.samples[k].name === name && ctx.observer.samples[k].run === run) ctx.observer.samples.splice(k, 1);
        }
        ctx.log(`  ${name}：请求太密（429），等 ${retryAfter} 秒再发`);
        await sleep(retryAfter * 1000);
      }
    }
    const done = ctx.observer.samples.filter((s) => s.name === name && s.end === 'done').length;
    ctx.log(`  ${padEnd(name, 30)}${done}/${ctx.runs} 次有回复${prepared.changed ? `（去掉了 ${prepared.changed} 条带占位签名的旧回复）` : ''}`);
  }
  return { sent, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// Part 2: the scripted game
// ---------------------------------------------------------------------------------------------------------------

/** What the scripted child does on which of its moves (1-based; the numbers repeat every 30 moves). */
export const SCRIPT = Object.freeze({
  /** try a move that loses material first, look at 诸葛亮's face and words, take it back */
  weakTry: Object.freeze([4, 9, 14, 19, 24, 29]),
  /** play the second-best move instead of the best */
  second: Object.freeze([5, 10, 15, 20, 25, 30]),
  /** open the three pouches before trying */
  pouches: Object.freeze([7, 22]),
  /** tap this chip while the trial is on the board (when the chip is there) */
  trialAsk: /** @type {Readonly<Record<number, AskCode>>} */ (Object.freeze({ 3: 'good', 6: 'reply', 11: 'better', 12: 'why', 17: 'reply', 26: 'good' })),
  /** tap this chip at the start of the turn (when the chip is there) */
  turnAsk: /** @type {Readonly<Record<number, AskCode>>} */ (Object.freeze({ 2: 'intent', 8: 'danger', 13: 'last', 18: 'score', 23: 'intent', 28: 'danger' })),
  /** type a question about a move (when the input is there) */
  free: Object.freeze([16]),
});

/** A move that loses at least this much against the best one is a "weak try" (the blunder threshold of section 4.6.1). */
const WEAK_LOSS = 300;
/** The table the scripted child reads its moves from: every move exact at depth 3. */
const CHILD_DEPTH = 3;
/** The heap of the search worker thread, in MB. */
const WORKER_HEAP_MB = 512;

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

/** The search worker of the page in a Node worker thread, behind the three members of `Worker` that tasks.js uses. @returns {Worker} */
function searchWorker() {
  const thread = new WorkerThread(new URL('../src/core/search-worker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
  /** @type {{onmessage: ((e: {data: unknown}) => void)|null, onerror: ((e: {message: string}) => void)|null, onmessageerror: (() => void)|null,
   *          postMessage(message: unknown): void, terminate(): void}} */
  const shim = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage: (message) => thread.postMessage(message),
    terminate: () => { thread.terminate().catch(() => {}); },
  };
  thread.on('message', (data) => shim.onmessage?.({ data }));
  thread.on('error', (e) => shim.onerror?.({ message: String(/** @type {{message?: unknown}} */ (e)?.message ?? e) }));
  thread.on('messageerror', () => shim.onmessageerror?.());
  return /** @type {Worker} */ (/** @type {unknown} */ (shim));
}

/** A `Storage` that lives in this process: every run starts as a first visit. @returns {Storage} */
function memoryStorage() {
  /** @type {Map<string, string>} */
  const items = new Map();
  return /** @type {Storage} */ ({
    get length() { return items.size; },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: (key) => { items.delete(key); },
    clear: () => { items.clear(); },
  });
}

/** @param {Segment[]} segments @returns {string} */
const textOf = (segments) => segments.map((seg) => (seg.type === 'move' ? seg.notation : seg.text)).join('');

/**
 * A stage that shows nothing and remembers what it was told: every line of 诸葛亮, the chips, the last verdict.
 * Every animation is over at once; the resign dialog says yes and the new-game dialog picks red.
 */
function createRecordingStage() {
  /** @type {Line[]} */
  const lines = [];
  const seen = {
    lines,
    /** @type {VerdictView|null} */ verdict: null,
    verdicts: 0, tensions: 0, commits: 0, rivalMoves: 0, rejections: 0, overs: 0, retractions: 0,
    /** @type {ChipSpec[]} */ chips: [],
    input: { visible: false, enabled: false },
    /** @type {StageHandlers|null} */ handlers: null,
    blocked: false,
  };
  let localSeq = 0;
  const done = Promise.resolve();
  /** @param {string} id */
  const lineOf = (id) => lines.find((line) => line.id === id);
  /** @type {StagePort} */
  const port = {
    start: () => Promise.resolve(/** @type {const} */ ('new')),
    reset: () => done,
    phase() {},
    selected() {},
    rejected() { seen.rejections++; },
    tentative: () => done,
    verdict(v) { seen.verdict = v; seen.verdicts++; },
    retracted() { seen.retractions++; return done; },
    committed() { seen.commits++; return done; },
    rivalMoved() { seen.rivalMoves++; return done; },
    undone: () => done,
    hint() {},
    tension() { seen.tensions++; },
    rival() {},
    over() { seen.overs++; return done; },
    arrows() {},
    clearArrows() {},
    highlight() {},
    preview: () => done,
    coachBegin(msg) { lines.push({ id: msg.id, cat: msg.kind, cue: msg.cue ?? '', text: '', ended: false }); },
    coachSegment(id, seg) {
      const line = lineOf(id);
      if (line) line.text += seg.type === 'move' ? seg.notation : seg.text;
    },
    coachReset(id) {
      const line = lineOf(id);
      if (line) line.text = '';
    },
    coachEnd(id) {
      const line = lineOf(id);
      if (line) line.ended = true;
    },
    coachTool() {},
    coachLocal(segments, opts) {
      const id = `stage-${++localSeq}`;
      lines.push({ id, cat: opts?.kind ?? 'system', cue: opts?.cue ?? '', text: textOf(segments), ended: true });
      return id;
    },
    caption(segments) { lines.push({ id: `caption-${++localSeq}`, cat: 'caption', cue: '', text: textOf(segments), ended: true }); },
    childSaid() {},
    chips(chips) { seen.chips = chips; },
    input(s) { seen.input = s; },
    coachMode() {},
    beacon() {},
    toast() {},
    announce() {},
    dialog: (kind) => Promise.resolve(kind === 'resign' ? true : { humanColor: 'red' }),
    notation() {},
    blocking(n) { seen.blocked = n !== null; },
    settle() {},
    applySettings() {},
    on(h) { seen.handlers = h; },
  };
  return { port, seen };
}

/** What the client says once for every notation of a reply that it could not resolve (src/coach/markup.js). */
const UNGROUNDED_WARNING = '[coach] ungrounded notation in a reply: ';

/**
 * Plays one run of the scripted game: `moves` child moves with the game's own modules against the proxy at `base`.
 * `globalThis.fetch`, `console.warn` and `console.error` are replaced while it runs and put back afterwards.
 * Every wait has a deadline; a step that never comes is written into `errors` and the run ends there.
 * @param {{base: string, mode: Mode, run: number, moves: number, seed: number, pace: number,
 *          observer: ReturnType<typeof createObserver>, log: (line: string) => void}} ctx
 * @returns {Promise<GameRun>}
 */
export async function playScriptedGame(ctx) {
  const { port: stage, seen } = createRecordingStage();
  /** @type {string[]} */
  const unresolved = [];
  /** @type {string[]} */
  const errors = [];
  const realFetch = globalThis.fetch, realWarn = console.warn, realError = console.error;
  globalThis.fetch = ctx.observer.fetch;
  console.warn = (...args) => {
    const text = args.map(String).join(' ');
    if (text.startsWith(UNGROUNDED_WARNING)) unresolved.push(text.slice(UNGROUNDED_WARNING.length));
  };
  console.error = (...args) => {
    // the class and the first line only: an error object is not printed whole
    errors.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' ').split('\n')[0].slice(0, 200));
  };
  ctx.observer.label.name = `game-${ctx.run}`;
  ctx.observer.label.run = ctx.run;

  // the composition of src/app.js, steps 2 to 8, without a page
  const store = createStore({ storage: memoryStorage(), teacher: { createSkillProfile, migrateSkillProfile, reviveGameSkill } });
  const loaded = store.load();
  const session = createSession();
  const brain = createBrainPort();
  let dead = false;
  const tasks = createTasks({
    getScope: () => session.scope(),
    createWorker: searchWorker,
    onWorker: (e, info) => {
      if (e === 'ready' && info) brain.setSpeed(info.speedClass);
      else if (e === 'dead') dead = true;
    },
  });
  session.subscribe((e) => { if (e.type === 'scope') tasks.sync(e.scope); });
  const coach = createCoachPort({ apiBase: ctx.base, forceLocal: false, tasks, brain, getSession: () => session.getState() });
  const save = () => { store.saveGame({ ...session.serialize(), ...director.extras() }); };
  const director = createDirector({
    session, tasks, store, brain, coach, stage, profile: loaded.profile, settings: loaded.settings, save,
    rng: mulberry32(ctx.seed), now: () => Date.now(), setTimer: setTimeout, clearTimer: clearTimeout, reload: () => {},
  });
  session.subscribe((e) => { if (e.type === 'change' && e.persist) save(); });
  session.subscribe(director.onEvent);
  stage.on(director.actions);
  const act = director.actions;
  const searcher = createSearcher();

  /** Waits until `check()` is true, at most `ms`. @param {() => boolean} check @param {number} ms @returns {Promise<boolean>} */
  const until = async (check, ms) => {
    const end = performance.now() + ms;
    while (!check()) {
      if (performance.now() > end) return false;
      await sleep(15);
    }
    return true;
  };
  /** Waits until 诸葛亮 has finished: no request in flight and no line still being written, for 200 ms on end (at most `ms`). */
  const quiet = async (/** @type {number} */ ms) => {
    const end = performance.now() + ms;
    let calm = 0;
    while (performance.now() < end) {
      const last = seen.lines[seen.lines.length - 1];
      calm = ctx.observer.inflight() === 0 && (!last || last.ended) ? calm + 1 : 0;
      if (calm >= 10) return;
      await sleep(20);
    }
  };
  const state = () => session.getState();
  const childToMove = () => state().phase === 'childTurn' || state().phase === 'selected';
  let requests = 0;
  /** The pace of the proxy's rate limit: what this move sent is waited for before the next one starts. */
  const paceOut = async (/** @type {number} */ since) => {
    const sent = ctx.observer.samples.reduce((total, s) => total + s.legs, 0) - requests;
    requests += sent;
    const wait = since + sent * ctx.pace - performance.now();
    if (wait > 0) await sleep(wait);
  };

  /** The legal moves of the child, best first, with what each gives up against the best. @returns {{move: MoveRef, loss: number}[]} */
  const ranked = () => {
    const table = searcher.analyzeSync({ fen: boardToFen(state().board, state().turn), timeMs: 3600000, allDepth: CHILD_DEPTH, maxDepth: CHILD_DEPTH, minDepth: CHILD_DEPTH });
    const best = table.lines.length ? table.lines[0].score : 0;
    return table.lines.map((line) => ({ move: line.move, loss: best - line.score }));
  };
  /** Puts `move` on the board as a trial. @param {MoveRef} move @returns {Promise<boolean>} */
  const tryMove = async (move) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = state().trial?.id ?? 0;
      act.activity();
      act.tap(move.from.row, move.from.col, 'tap');
      act.tap(move.to.row, move.to.col, 'tap');
      if (await until(() => state().phase === 'tentative' && (state().trial?.id ?? 0) !== before, 400)) return true;
      if (state().phase === 'tentative') act.retract();
      await sleep(200);                                    // the board takes no tap while the pieces are dealt
    }
    return false;
  };
  /** Waits for the final verdict of the trial on the board and for the comment on it. */
  const watchTrial = async () => {
    const trial = state().trial?.id;
    await until(() => state().trial?.id !== trial || (seen.verdict !== null && seen.verdict.final), 6000);
    await quiet(8000);
  };
  /** Taps the chip that asks `code`, when it is there, and waits for the answer. @param {AskCode} code */
  const askChip = async (code) => {
    if (!seen.chips.some((chip) => chip.ask === code)) return;
    act.activity();
    act.ask({ code });
    await sleep(100);
    await quiet(12000);
    await sleep(850);                                      // the page lets a child ask again after 800 ms
  };

  const run = { moves: 0, games: 0 };
  /** @returns {Promise<boolean>} false when the game did not start */
  const startGame = async () => {
    run.games++;
    searcher.clear();
    if (run.games === 1) {
      director.loadExtras(null);
      session.newGame({ humanColor: 'red' });
      director.notices(loaded.notices, { truncatedAt: null });
    } else {
      act.newGame();                                       // the dialog of the recording stage picks red
    }
    if (!await until(() => childToMove() && state().history.length === 0, 10000)) return false;
    await until(() => seen.tensions > 0, 5000);            // the first table of the survey
    await quiet(8000);                                     // the greeting
    return true;
  };

  const started = performance.now();
  try {
    await coach.probe();
    if (coach.mode() !== 'llm') throw new Error(`the coach client is not online after its probe (${coach.offReason() ?? 'unknown'})`);
    if (!await startGame()) throw new Error('the first game did not start');

    while (run.moves < ctx.moves) {
      if (dead) throw new Error('the search worker died');
      if (state().phase === 'over') {
        await quiet(10000);                                // the game-over line
        if (!await startGame()) throw new Error('the next game did not start');
        continue;
      }
      const n = ((run.moves) % 30) + 1;
      const moveStart = performance.now();
      const plies = state().history.length;
      const tensions = seen.tensions;
      await until(() => seen.tensions > tensions || seen.tensions > 0, 3000);
      const moves = ranked();
      if (moves.length === 0) throw new Error('the child has no legal move in a game that is not over');

      if (SCRIPT.turnAsk[n]) await askChip(SCRIPT.turnAsk[n]);
      if (SCRIPT.pouches.includes(n)) {
        for (let pouch = 0; pouch < 3; pouch++) {
          act.activity();
          act.hint();
          await sleep(350);
          await quiet(12000);
        }
      }
      if (SCRIPT.free.includes(n) && seen.input.visible && seen.input.enabled) {
        // a question about a move of the board that the brief may not hold: the model can use its tool
        act.activity();
        act.ask({ text: `如果我走${moveToNotation(state().board, moves[Math.min(2, moves.length - 1)].move)}呢？` });
        await sleep(100);
        await quiet(20000);
        await sleep(850);
      }
      if (SCRIPT.weakTry.includes(n)) {
        const weak = moves.find((m) => m.loss >= WEAK_LOSS) ?? moves[moves.length - 1];
        if (moves.length > 1 && await tryMove(weak.move)) {
          await watchTrial();
          await sleep(300);
          act.activity();
          act.retract();
          await until(() => state().phase !== 'tentative', 1000);
        }
      }

      // the move the child plays: the best, on some moves the second best; a move the rules refuse is skipped
      const wanted = SCRIPT.second.includes(n) && moves.length > 1 && moves[1].loss < WEAK_LOSS ? [moves[1], moves[0], ...moves.slice(2)] : moves;
      let onBoard = false;
      for (const candidate of wanted.slice(0, 6)) {
        if (await tryMove(candidate.move)) { onBoard = true; break; }
      }
      if (!onBoard) throw new Error(`no trial could be put on the board at child move ${run.moves + 1}`);
      await watchTrial();
      if (SCRIPT.trialAsk[n]) await askChip(SCRIPT.trialAsk[n]);

      let confirmed = false;
      for (let attempt = 0; attempt < 4 && !confirmed; attempt++) {
        act.activity();
        act.confirm();
        confirmed = await until(() => state().history.length > plies || state().phase === 'over', 800);
      }
      if (!confirmed) throw new Error(`the trial of child move ${run.moves + 1} could not be confirmed`);
      run.moves++;
      let replied = await until(() => state().phase === 'over' || (state().history.length >= plies + 2 && childToMove()), 20000);
      if (!replied && state().opponentFailed) {
        act.retryOpponent();
        replied = await until(() => state().phase === 'over' || (state().history.length >= plies + 2 && childToMove()), 20000);
      }
      if (!replied) throw new Error(`司马懿 did not answer child move ${run.moves}`);
      await quiet(8000);                                   // the caption and the read of his move
      if (run.moves % 5 === 0) ctx.log(`  第 ${ctx.run} 局：第 ${run.moves} 手，用时 ${Math.round((performance.now() - started) / 1000)} 秒`);
      await paceOut(moveStart);
    }

    // the last line of every run is a game-over line: the child resigns a game that is still running
    if (state().phase !== 'over') {
      await sleep(850);
      act.activity();
      act.resign();
      if (!await until(() => state().phase === 'over', 5000)) throw new Error('the game did not end after the resignation');
    }
    await until(() => seen.overs > 0, 5000);
    await sleep(200);
    await quiet(15000);
    const overChip = seen.chips.find((chip) => chip.ask && chip.ask !== 'why');
    if (overChip?.ask) await askChip(overChip.ask);
  } catch (e) {
    errors.push(`bench: ${/** @type {Error} */ (e).message}`);
  } finally {
    try { coach.reset(); } catch { /* the run is over */ }
    try { director.dispose(); } catch { /* the run is over */ }
    try { tasks.dispose(); } catch { /* the run is over */ }
    await sleep(50);
    ctx.observer.flush();
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    console.error = realError;
  }

  const counted = countLines(seen.lines, ctx.mode);
  return {
    run: ctx.run, moves: run.moves, wanted: ctx.moves, games: run.games, rivalMoves: seen.rivalMoves,
    spokenOpp: counted.spokenOpp, chars: counted.chars, unsolicited: counted.unsolicited, cues: counted.cues, unresolved, errors,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------

/**
 * `GET <base>/health`: the mode and the model of the proxy, or the reason why there is nothing to measure.
 * @param {string} base
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{ok: true, mode: Mode, model: string}|{ok: false, why: string}>}
 */
async function health(base, fetchFn) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const response = await fetchFn(`${base}/health`, { signal: ac.signal });
    if (!response.ok) return { ok: false, why: `${base}/health 回答了 HTTP ${response.status}` };
    const data = await response.json();
    if (data?.ok !== true || (data.mode !== 'live' && data.mode !== 'mock')) {
      return { ok: false, why: `军师服务没有开（mode=${String(data?.mode)}，原因 ${String(data?.reason ?? '未知')}）：先在 .env.local 里配好 COACH_BASE_URL 和 COACH_API_KEY` };
    }
    return { ok: true, mode: data.mode, model: String(data.model ?? '') };
  } catch {
    return { ok: false, why: `连不上 ${base}/health：先在另一个窗口运行 npm start（真模型）或 npm run start:mock（模拟回复）` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The whole bench: both parts, the table, the bars. Never throws for what it measures.
 * @param {Options} options
 * @param {{log?: (line: string) => void, fetch?: typeof fetch, fixtures?: Record<string, unknown>}} [io]
 * @returns {Promise<{code: number, samples: Sample[], games: GameRun[], summary: Summary|null, bars: BarResult[]}>}
 */
export async function runBench(options, io = {}) {
  const log = io.log ?? ((line) => console.log(line));
  const fetchFn = io.fetch ?? globalThis.fetch;
  const started = Date.now();
  const proxy = await health(options.base, fetchFn);
  if (!proxy.ok) {
    log(proxy.why);
    return { code: 2, samples: [], games: [], summary: null, bars: [] };
  }
  const pace = options.pace ?? DEFAULT_PACE_MS;
  const origin = new URL(options.base).origin;
  log(`军师服务：${options.base}，模式 ${proxy.mode}，模型 ${proxy.model}；每个请求占 ${pace} 毫秒（服务器默认每分钟 30 次）`);
  if (proxy.mode === 'mock') log('注意：这是模拟回复（mock）。它只能说明这个工具本身和对局流程是通的，不能当作 14.8 的验收；验收要对着真网关跑。');

  /** @type {Sample[]} */
  const samples = [];
  /** @type {GameRun[]} */
  const games = [];
  if (options.only !== 'game') {
    log(`第一部分：回放 tests/fixtures/coach 里的请求，每个 ${options.runs} 次`);
    const observer = createObserver({ fetch: fetchFn, origin, mode: proxy.mode, source: 'fixture' });
    const { skipped } = await replayFixtures({ base: options.base, mode: proxy.mode, runs: options.runs, pace, observer, log, fixtures: io.fixtures });
    if (skipped.length) log(`  不回放：${skipped.join('、')}（工具续问的那一段，令牌只对模拟密钥和原样的请求有效）`);
    samples.push(...observer.samples);
  }
  if (options.only !== 'fixtures') {
    log(`第二部分：照脚本下 ${options.runs} 局，每局孩子走 ${options.moves} 手（真的对局模块 + 只做记录的界面）`);
    for (let run = 1; run <= options.runs; run++) {
      const observer = createObserver({ fetch: fetchFn, origin, mode: proxy.mode, source: 'game' });
      games.push(await playScriptedGame({ base: options.base, mode: proxy.mode, run, moves: options.moves, seed: (options.seed + run - 1) >>> 0, pace, observer, log }));
      samples.push(...observer.samples);
    }
  }

  const summary = summarize(samples);
  const bars = judgeBars(summary, games);
  log('');
  log('各类事件（时间单位：毫秒；首字 = 第一段文字或第一次调用推演工具）');
  for (const line of tableLines(summary)) log(line);
  if (games.length) {
    log('');
    log('照脚本下的对局');
    for (const line of gameLines(games)) log(line);
    log(`  对局里的问答：孩子接着走了、不用说完的 ${summary.aborted} 次；等不到第一个字、页面改用本地军师的 ${summary.late} 次（都不算失败）`);
  }
  /** @param {string} title @param {string[]} rows */
  const list = (title, rows) => {
    if (rows.length === 0) return;
    log('');
    log(title);
    for (const row of rows.slice(0, 12)) log(`  ${row}`);
    if (rows.length > 12) log(`  ……另有 ${rows.length - 12} 条`);
  };
  list('失败的问答', summary.failures.map((f) => `${f.name} 第 ${f.run} 次（${f.kind}）：${f.end}`));
  if (summary.failures.some((f) => f.end.startsWith('http:429'))) {
    log('  （429 是服务器在限速：用默认的 --pace，或者在 .env.local 里临时调大 COACH_RATE_BURST、COACH_RATE_PER_MIN、COACH_IP_DAILY、COACH_GLOBAL_DAILY 再跑）');
  }
  list('对局里报的错', games.flatMap((g) => g.errors.map((e) => `第 ${g.run} 局：${e}`)));
  list('对不上的【】着法', [
    ...summary.ungroundedFixtures.map((u) => `${u.name}（${u.kind}）：【${u.notation}】不在军情里`),
    ...games.flatMap((g) => g.unresolved.map((n) => `第 ${g.run} 局：【${n}】在棋盘上走不通`)),
  ]);
  list('禁用词', summary.banned.map((b) => `${b.name}（${b.kind}）：${b.word}`));
  log('');
  log('验收线（合同 14.8 和 8.3）');
  for (const line of barLines(bars)) log(line);

  if (options.json) {
    const file = resolve(options.json);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ base: options.base, mode: proxy.mode, model: proxy.model, options, samples, games, summary, bars }, null, 2)}\n`);
    log(`原始数据写到了 ${file}`);
  }
  const missed = failedBars(bars);
  const partial = options.only !== null || options.runs < DEFAULT_RUNS || options.moves < DEFAULT_MOVES;
  const over = bars.filter((bar) => bar.status === 'warn').length;
  const note = `${over > 0 ? `；另有 ${over} 条预算超出（合同 8.3 的预算，不在 14.8 的失败条件里，不影响退出码）` : ''}`
    + `${proxy.mode === 'mock' ? '（模拟回复，不算验收）' : ''}${partial ? '（不是完整的一轮：完整的是两部分都跑、各 5 次、每局 30 手）' : ''}`;
  log('');
  log(missed > 0 ? `结论：有 ${missed} 条线未达标${note}，退出码 1` : `结论：14.8 的线全部达标${note}，退出码 0`);
  log(`用时 ${Math.round((Date.now() - started) / 1000)} 秒`);
  return { code: missed > 0 ? 1 : 0, samples, games, summary, bars };
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    console.error(`${/** @type {Error} */ (e).message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  return (await runBench(options)).code;
}

/** True when this file is the program Node was started with (not when a test imports it). */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    const norm = (/** @type {string} */ p) => (process.platform === 'win32' ? realpathSync(p).toLowerCase() : realpathSync(p));
    return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// The coach client keeps timers of its own (the next probe of the proxy); the bench is over when its report is printed.
if (isMain()) process.exit(await main(process.argv.slice(2)));
