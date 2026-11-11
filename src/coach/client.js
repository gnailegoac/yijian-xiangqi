// src/coach/client.js (C4) — the stateful thread client: threads, SSE, tool loop, breaker (contract sections 4.17, 7.5–7.7).
// The client emits no DOM events and holds no reference to the session; every output goes through `Handlers`,
// each wrapped so that nothing is delivered after an abort.
//
// What the child experiences when 诸葛亮 is asked something is decided here: a streamed answer of the language model, or,
// when the model is off, slow, refusing or failing, the local narrator at once. One event gets one visible reply: there is
// no retry, no spinner that hangs and no half sentence.
//
// The thread (`events`) is the wire form of the conversation. Every request carries all of it, so it is kept valid for
// `validateCoachRequest` at all times: optional fields are left out, never null; an event that the wire rules cannot carry
// is answered locally and not recorded; a long thread is compacted in place (section 7.2).
//
// Readings chosen where sections 7.2–7.7 leave room:
// - The recap of a compacted thread is built here (`recapOf`), not by brief.js: of src/coach this module imports protocol,
//   markup and fallback only. A game-over thread keeps its `over` event instead of getting a recap.
// - A local sentence goes through the same handlers as a streamed one, onSentence included. A reply with nothing in it has
//   source 'none'.
// - Retraction has no form on the wire, so the client keeps it: once a try is withdrawn the local narrator is no longer
//   shown it (a 为什么？ after 换一步 is not about the move that was taken back), a recap does not carry it as `cur`, and a
//   question about "this move" neither travels nor joins the thread until the next try is on the board.
// - An event is recorded as said 'local' only while the proxy can re-create that very sentence from the thread as it
//   travels (section 7.2); a local sentence it could not re-create is recorded as said 'none'.
// - onEnd is called after the reply is settled, so a handler may send the next event from it.
// - A tool indicator carries the link of the move being analysed (ghost pieces), read the way the executor reads the call.
// - The results of both tool rounds travel with the last leg: the proxy is stateless and matches them by call id.
// - onMode listeners are also told when only capabilities().freeText changed (mode and reason as they are).

/**
 * @import { CoachPort, CoachStatus, CoachOffReason, Thread, Reply, ReplyResult, ReplyOpts, Handlers, SayMode } from '../game/types.js'
 * @import { CueCode } from '../core/codes.js'
 * @import { MoveRef, Color } from '../core/types.js'
 * @import { CoachEvent, MorePacket, RecapPacket, Segment, MoveLink, ToolRecord, ToolResult, ToolVerdict, TryPacket, TurnBrief } from './types.js'
 * @import { MoveBook } from './book.js'
 */

import { ASK_CODES, CUE, NOTATION_RE } from '../core/codes.js';
import { applyMove, opposite } from '../core/engine.js';
import { moveCode, normalizeNotation, parseNotation } from '../core/notation.js';
import { composeLocal, composeToolReply, cueFor, localLine } from './fallback.js';
import { createMarkupStream, sanitizeModelText } from './markup.js';
import { DISPLAY_CAP_FACTOR, LIMITS, PROTOCOL_VERSION, capFor, plainLength, sanitizeSay, validateToolInput } from './protocol.js';

/** @typedef {{probeMs:2500, openMs:4000, firstTextAutoMs:2000, firstTextAskMs:3500, stallMs:4000, legMs:12000, eventMs:20000, toolMs:2000}} Timeouts */

/**
 * What createCoachClient returns: the CoachPort members status, mode, offReason, onMode, probe, capabilities, beginTurn,
 * beginOver and reset (contract section 3.10), plus stats().
 * @typedef {Pick<CoachPort, 'status'|'mode'|'offReason'|'onMode'|'probe'|'capabilities'|'beginTurn'|'beginOver'|'reset'>
 *           & {stats: () => {requests:number, llm:number, local:number, ungrounded:number, overCap:number, refused:number, failures:number}}} CoachClient
 */

// ---------------------------------------------------------------------------------------------------------------------
// Numbers of sections 7.2, 7.5 and 7.6
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Readonly<Record<keyof Timeouts, number>>} */
const DEFAULT_TIMEOUTS = Object.freeze({
  probeMs: 2500, openMs: 4000, firstTextAutoMs: 2000, firstTextAskMs: 3500, stallMs: 4000, legMs: 12000, eventMs: 20000, toolMs: 2000,
});
/** An event that starts while the status is `unknown` waits at most this long for the probe. */
const PROBE_WAIT_MS = 800;
/** Unreachable: local for 60 s, doubling to at most 600 s, then `unknown`. */
const OFFLINE_MS = 60_000;
const OFFLINE_MAX_MS = 600_000;
/** Paused: until `retry_after`, by default 60 s; a busy gateway pauses for at most 60 s. */
const PAUSE_MS = 60_000;
const BUSY_PAUSE_MAX_MS = 60_000;
/** A `retry_after` is never trusted beyond one day. */
const PAUSE_MAX_MS = 86_400_000;
/** Not configured: probed again every 10 minutes. */
const REPROBE_MS = 600_000;
/** Consecutive counted failures that switch to `offline`. */
const BREAKER_FAILURES = 2;
/** A thread that reaches 11 events is compacted to a recap plus its last 6. */
const COMPACT_AT = 11;
const COMPACT_KEEP = 6;
/** Keys `row:v` of the last three local lines. */
const RECENT_ROWS = 3;
/** The attempt number of a try is clamped (section 3.6: n = 1..40). */
const TRY_NUMBER_MAX = 40;
/** Past tool exchanges kept on one event (section 3.6), results one resume may carry (two rounds of two calls). */
const EVENT_TOOLS = 3;
const RESUME_RESULTS = LIMITS.TOOL_ROUNDS * LIMITS.TOOL_CALLS_PER_ROUND;
/** A stream that sends this much without a line break is not a coach stream. */
const SSE_BUFFER_MAX = 262_144;

/** Events whose first text is due within `firstTextAutoMs`; the others (and every resumed leg) get `firstTextAskMs`. */
const AUTO_KINDS = /** @type {readonly string[]} */ (['start', 'opp', 'try']);
/** Ask codes that may carry the withheld `more` packet (section 4.10 rule 6). */
const MORE_ASKS = /** @type {readonly string[]} */ (['reply', 'better', 'why', 'show', 'free']);
/** Ask codes that need an earlier try in a turn thread (rule 5). */
const TRY_ASKS = /** @type {readonly string[]} */ (['good', 'reply', 'better', 'show']);
/** Ask codes allowed after `over` (rule 5). */
const OVER_ASKS = /** @type {readonly string[]} */ (['proud', 'improve', 'next', 'why', 'free']);
/** Error codes of a tool result (section 3.6). */
const TOOL_ERRORS = /** @type {readonly string[]} */ (['syntax', 'no_such_move', 'ambiguous', 'game_over', 'busy', 'limit']);
/** Error codes the proxy sends with an HTTP status (section 7.3). */
const HTTP_CODES = /** @type {readonly string[]} */ (['invalid', 'bad_signature', 'bad_version', 'origin', 'peer', 'free_text_off', 'too_large',
  'rate', 'no_key']);

/** Shapes the validator requires of what the proxy hands back for later requests (section 4.10, C1's readings). */
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CALL_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

const noop = () => {};

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A failure of one exchange. `code` is a code of the table of section 7.3, or one of the client's own:
 * `eof` (the stream closed without a terminal event), `timeout` (a timer fired), `network` (the request failed),
 * `bad_stream` (malformed SSE), `http` (an HTTP status without a known code), `loop` (a third tool round),
 * `bad_resume` (the proxy called a resumed leg invalid), `aborted` (the reply was aborted; never reported).
 */
class CoachError extends Error {
  /** @param {string} code @param {number} [retryAfter] seconds */
  constructor(code, retryAfter) {
    super(code);
    this.name = 'CoachError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** @param {unknown} x @returns {number|undefined} a positive number of seconds */
function seconds(x) {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** @param {string} s @returns {number} */
function codePoints(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** @param {unknown} x @returns {x is Record<string, unknown>} */
function isRecord(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Calls `fn` when `signal` aborts (at once when it already has). Listeners are linked by hand: no AbortSignal helper is used.
 * @param {AbortSignal|undefined} signal @param {() => void} fn
 * @returns {() => void} removes the listener
 */
function link(signal, fn) {
  if (!signal) return noop;
  if (signal.aborted) {
    fn();
    return noop;
  }
  signal.addEventListener('abort', fn, { once: true });
  return () => signal.removeEventListener('abort', fn);
}

/**
 * `work`, or a rejection with CoachError('aborted') as soon as `signal` aborts, whichever comes first. The client therefore
 * never waits on a request, a stream or a tool that ignores its signal. A value that arrives after the abort goes to `discard`.
 * @template T
 * @param {Promise<T>} work @param {AbortSignal} signal @param {(value:T) => void} [discard]
 * @returns {Promise<T>}
 */
function untilAbort(work, signal, discard) {
  return new Promise((resolve, reject) => {
    let over = false;
    const unlink = link(signal, () => {
      if (over) return;
      over = true;
      reject(new CoachError('aborted'));
    });
    work.then((value) => {
      if (over) {
        if (discard) discard(value);
        return;
      }
      over = true;
      unlink();
      resolve(value);
    }, (err) => {
      if (over) return;
      over = true;
      unlink();
      reject(err);
    });
  });
}

/** Releases a response nobody will read. @param {Response} res */
function discardResponse(res) {
  try {
    const cancelled = res.body?.cancel();
    if (cancelled) cancelled.catch(noop);
  } catch { /* already released */ }
}

/**
 * An incremental parser of a `text/event-stream` body (section 7.3). Bytes may be cut anywhere, also inside a character.
 * A comment line (the proxy's `: ping`) yields nothing. `data` is parsed as JSON; an event without data has `data: null`.
 * @returns {{feed(bytes:Uint8Array): {event:string, data:unknown}[]}}
 * @throws {CoachError} `bad_stream` for data that is not JSON or a line that never ends
 */
function createSseParser() {
  const decoder = new TextDecoder();
  /** The line in progress, in the pieces it arrived in (joined once, when its end arrives). @type {string[]} */
  let pieces = [];
  let pending = 0;
  let name = '';
  /** @type {string[]} */
  let data = [];
  /** @type {{event:string, data:unknown}[]} */
  let out = [];

  /** @param {string} raw one line without its line feed */
  function takeLine(raw) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') {                                     // a blank line ends the event
      if (name !== '' || data.length > 0) {
        /** @type {unknown} */
        let value = null;
        if (data.length > 0) {
          try {
            value = JSON.parse(data.join('\n'));
          } catch {
            throw new CoachError('bad_stream');
          }
        }
        out.push({ event: name === '' ? 'message' : name, data: value });
      }
      name = '';
      data = [];
      return;
    }
    if (line.startsWith(':')) return;                      // a comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') name = value;
    else if (field === 'data') data.push(value);
  }

  return {
    feed(bytes) {
      const text = decoder.decode(bytes, { stream: true });
      out = [];
      let from = 0;
      for (;;) {
        const end = text.indexOf('\n', from);
        if (end === -1) break;
        const head = text.slice(from, end);
        from = end + 1;
        if (pieces.length > 0) {
          pieces.push(head);
          takeLine(pieces.join(''));
          pieces = [];
          pending = 0;
        } else {
          takeLine(head);
        }
      }
      if (from < text.length) {
        pieces.push(text.slice(from));
        pending += text.length - from;
        if (pending > SSE_BUFFER_MAX) throw new CoachError('bad_stream');
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The thread as the wire sees it
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One event as it travels (section 3.6): `i`, `kind`, its own fields, then `cue`, `said`, `reply`, `v`, `tools`. Optional fields
 * are left out, never null. An earlier free question travels without its `say`; the last event says nothing about its answer.
 * @param {CoachEvent} ev @param {boolean} last the event to answer
 * @returns {Record<string, unknown>}
 */
function wireEvent(ev, last) {
  /** @type {Record<string, unknown>} */
  const out = { i: ev.i, kind: ev.kind };
  switch (ev.kind) {
    case 'start':
      if (typeof ev.first === 'boolean') out.first = ev.first;
      break;
    case 'hint':
      out.level = ev.level;
      out.hint = ev.hint;
      break;
    case 'try':
      out.n = ev.n;
      out.try = ev.try;
      break;
    case 'ask':
      out.ask = ev.ask;
      if (last && typeof ev.say === 'string') out.say = ev.say;
      if (ev.more) out.more = ev.more;
      break;
    case 'over':
      out.over = ev.over;
      break;
    case 'recap':
      out.recap = ev.recap;
      break;
    default:
      break;
  }
  if (ev.cue) out.cue = ev.cue;
  if (!last) {
    const said = ev.said === 'llm' && ev.reply ? 'llm' : ev.said === 'local' && typeof ev.v === 'number' ? 'local' : 'none';
    out.said = said;
    if (said === 'llm') out.reply = ev.reply;
    if (said === 'local') out.v = ev.v;
  }
  if (ev.tools && ev.tools.length > 0) out.tools = ev.tools;
  return out;
}

/**
 * The request body without `resume`. The turn is serialised once per thread, so it is byte-identical in every request.
 * @param {string} turnJson @param {CoachEvent[]} events
 * @returns {string}
 */
function bodyOf(turnJson, events) {
  const last = events.length - 1;
  return `{"v":${PROTOCOL_VERSION},"turn":${turnJson},"events":${JSON.stringify(events.map((ev, k) => wireEvent(ev, k === last)))}}`;
}

/** @param {CoachEvent[]} events @returns {boolean} the thread holds a try that `good / reply / better / show` can be about (rule 5) */
function hasTry(events) {
  let found = false;
  for (const ev of events) {
    if (ev.kind === 'try') found = true;
    else if (ev.kind === 'recap') found = ev.recap.cur !== undefined || ev.recap.tries.length > 0;
  }
  return found;
}

/** @param {CoachEvent} event @returns {boolean} the event has the parts of its kind (a code that exists, a packet that is one) */
function wellFormed(event) {
  switch (event.kind) {
    case 'hint': return (event.level === 1 || event.level === 2 || event.level === 3) && isRecord(event.hint);
    case 'try': return isRecord(event.try);
    case 'ask': return ASK_CODES.includes(event.ask);
    case 'over': return isRecord(event.over);
    default: return true;
  }
}

/**
 * Whether the thread stays valid (section 4.10 rule 5) when `event` is appended. An event that would break the thread for the
 * rest of its life is answered locally and not recorded. Nor is a question about the try (好不好 / 怎么应 / 更好的 / 指给我看)
 * while no try is on the board: on the wire it would read as a question about a move that was taken back.
 * @param {CoachEvent[]} events @param {CoachEvent} event @param {TryPacket|null} active the try on the board
 * @returns {boolean}
 */
function admissible(events, event, active) {
  if (!wellFormed(event)) return false;
  const first = events[0];
  if (first) {
    if (event.kind === 'start' || event.kind === 'opp' || event.kind === 'over' || event.kind === 'recap') return false;
    if (first.kind === 'over') return event.kind === 'ask' && OVER_ASKS.includes(event.ask);
  }
  if (event.kind === 'hint') return !events.some((ev) => ev.kind === 'hint' && ev.level > event.level);
  if (event.kind === 'ask' && TRY_ASKS.includes(event.ask)) return active !== null && hasTry(events);
  return true;
}

/**
 * The thread without its tries, as the local narrator reads it while no try is on the board: a try that was withdrawn is
 * not the subject of any later sentence. The same array when there is nothing to leave out.
 * @param {CoachEvent[]} events
 * @returns {CoachEvent[]}
 */
function withoutTries(events) {
  if (!events.some((ev) => ev.kind === 'try' || (ev.kind === 'recap' && ev.recap.cur !== undefined))) return events;
  return events.filter((ev) => ev.kind !== 'try')
    .map((ev) => (ev.kind === 'recap' && ev.recap.cur !== undefined ? { ...ev, recap: { tries: ev.recap.tries, hint: ev.recap.hint } } : ev));
}

/**
 * The packet of a recap event (section 7.2): the tries so far with their verdicts (the eight most recent), the highest pouch
 * opened, and the current try when it fell out of the window, so that a later question still has its subject.
 * @param {CoachEvent[]} replaced the events the recap stands for
 * @param {CoachEvent[]} kept the events that stay
 * @param {TryPacket|null} active the try on the board; a try that was withdrawn is listed, but is not the current one
 * @returns {RecapPacket}
 */
function recapOf(replaced, kept, active) {
  /** @type {RecapPacket['tries']} */
  const tries = [];
  let hint = 0;
  /** @type {TryPacket|undefined} */
  let cur;
  for (const ev of replaced) {
    if (ev.kind === 'recap') {
      tries.push(...ev.recap.tries);
      hint = Math.max(hint, ev.recap.hint);
      if (ev.recap.cur) cur = ev.recap.cur;
    } else if (ev.kind === 'try') {
      tries.push({ move: ev.try.move, cat: ev.try.cat });
      cur = ev.try;
    } else if (ev.kind === 'hint') {
      hint = Math.max(hint, ev.level);
    }
  }
  /** @type {RecapPacket} */
  const recap = { tries: tries.slice(-LIMITS.RECAP_TRIES), hint: /** @type {0|1|2|3} */ (Math.min(3, Math.max(0, Math.trunc(hint) || 0))) };
  if (cur && cur === active && !kept.some((ev) => ev.kind === 'try')) recap.cur = cur;
  return recap;
}

/**
 * The withheld packet of a try as it may travel: only `reply` and `better`, neither null.
 * @param {MorePacket|null|undefined} more
 * @returns {MorePacket|null} null when there is nothing to add
 */
function cleanMore(more) {
  if (!isRecord(more)) return null;
  /** @type {MorePacket} */
  const out = {};
  if (isRecord(more.reply)) out.reply = more.reply;
  if (Array.isArray(more.better)) out.better = more.better.slice(0, LIMITS.ALTS);
  return out.reply || out.better ? out : null;
}

/**
 * What the tool executor returned, as a wire-valid result of call `id`. Anything unusable reads as `busy`.
 * @param {string} id @param {unknown} out
 * @returns {ToolResult}
 */
function toolResultOf(id, out) {
  if (isRecord(out)) {
    if (out.ok === true && isRecord(out.verdict)) return { id, ok: true, verdict: /** @type {ToolVerdict} */ (out.verdict) };
    if (out.ok === false && typeof out.error === 'string' && TOOL_ERRORS.includes(out.error)) {
      /** @type {Extract<ToolResult, {ok:false}>} */
      const result = { id, ok: false, error: /** @type {Extract<ToolResult, {ok:false}>['error']} */ (out.error) };
      if (typeof out.at === 'number' && Number.isInteger(out.at) && out.at >= 0 && out.at <= LIMITS.TOOL_AFTER) result.at = out.at;
      if (Array.isArray(out.candidates)) {
        const candidates = out.candidates.filter((n) => typeof n === 'string' && NOTATION_RE.test(n)).slice(0, LIMITS.CANDIDATES);
        if (candidates.length > 0) result.candidates = candidates;
      }
      return result;
    }
  }
  return { id, ok: false, error: 'busy' };
}

/**
 * The record of one tool exchange for later requests. The model's arguments are only loosely checked, so the strings are
 * normalised, and an exchange whose notation or `after` item is not a notation is left out (CONTRACT-NOTES item 73).
 * @param {{notation:string, after:string[]}} input @param {ToolResult} result
 * @returns {ToolRecord|null}
 */
function toolRecordOf(input, result) {
  const notation = normalizeNotation(input.notation);
  const after = input.after.map((text) => normalizeNotation(text));
  if (!NOTATION_RE.test(notation) || after.some((text) => !NOTATION_RE.test(text))) return null;
  return { notation, after, result };
}

/**
 * Where a tool call's move is on the board, read the way the executor reads it: `after` and then `notation`, played from the
 * base position. The stage shows it with ghost pieces while the sandbox works.
 * @param {MoveBook} book @param {{notation:string, after:string[]}} input
 * @returns {MoveLink|null} null when a move does not parse
 */
function toolLink(book, input) {
  try {
    let board = book.base.board;
    /** @type {Color} */
    let turn = book.base.turn;
    /** @type {(MoveRef & {color:Color})[]} */
    const pre = [];
    const texts = [...input.after, input.notation];
    for (let k = 0; k < texts.length; k++) {
      const parsed = parseNotation(texts[k], board, turn);
      if (!parsed.ok) return null;
      const from = { row: parsed.move.from.row, col: parsed.move.from.col };
      const to = { row: parsed.move.to.row, col: parsed.move.to.col };
      if (k === texts.length - 1) return { from, to, color: turn, code: moveCode(parsed.move), pre, playable: k === 0, src: 'tool' };
      pre.push({ from, to, color: turn });
      board = applyMove(board, parsed.move);
      turn = opposite(turn);
    }
  } catch { /* a book without a usable base position: no link */ }
  return null;
}

/** @param {Handlers[keyof Handlers]} fn @param {unknown} [arg] */
function callHandler(fn, arg) {
  if (typeof fn !== 'function') return;
  try {
    /** @type {(arg:unknown) => void} */ (fn)(arg);
  } catch (err) {
    console.error('[coach] a reply handler failed', err);
  }
}

/** @returns {ReplyResult} a reply with nothing in it */
const nothingSaid = () => ({ aborted: false, text: '', segments: [], source: 'none', cut: false, refused: false });

/**
 * @typedef {Object} ThreadState
 * @property {TurnBrief} turn
 * @property {string} turnJson                 the turn exactly as every request of this thread carries it
 * @property {MoveBook} book
 * @property {AbortSignal|undefined} signal    from beginTurn / beginOver
 * @property {number} epoch                    client.epoch when the thread began
 * @property {CoachEvent[]} events             the thread in wire order; compacted in place
 * @property {number} nextIndex                the stable index `i` of the next recorded event
 * @property {number} replySeq
 * @property {boolean} closed                  end() was called
 * @property {boolean} localOnly               the thread can no longer travel (index past 63, too large, rejected twice)
 * @property {number} invalids                 requests of this thread the proxy rejected as invalid
 * @property {number} attempt                  tries of this turn so far
 * @property {TryPacket|null} active           the try on the board (null once withdrawn)
 * @property {MorePacket|null} more            what the active try's first packet withheld
 * @property {number|null} moreAt              index `i` of the question that carries `more`; null while it still has to travel
 * @property {(() => void)|null} abortCurrent  aborts the reply in flight
 * @property {Thread} api
 */

// ---------------------------------------------------------------------------------------------------------------------
// createCoachClient
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Options:
 *   apiBase      from config.js; null = never touch the network
 *   forceLocal   settings.coach === 'local'; read at the start of every event, never copied (CONTRACT-NOTES item 83)
 *   tools        the tool executor (ports.js); calls of one round run sequentially
 * @param {{
 *   apiBase: string|null,
 *   forceLocal?: boolean,
 *   fetch?: typeof fetch,
 *   tools: { analyzeMove(input:{notation:string, after:string[]}, ctx:{thread:Thread, book:MoveBook, signal:AbortSignal}): Promise<ToolResult> },
 *   timeouts?: Partial<Timeouts>, now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout
 * }} options
 * @returns {CoachClient}
 */
export function createCoachClient(options) {
  const apiBase = typeof options.apiBase === 'string' ? options.apiBase.replace(/\/+$/, '') : null;
  const customFetch = options.fetch;
  /** @type {(url:string, init:RequestInit) => Promise<Response>} */
  const request = (url, init) => Promise.resolve().then(() => (customFetch ? customFetch(url, init) : fetch(url, init)));
  const customNow = options.now;
  const now = () => (customNow ? customNow() : Date.now());
  const customSet = options.setTimer;
  const customClear = options.clearTimer;
  /** @typedef {ReturnType<typeof setTimeout>} TimerId */
  /** @type {(fn:() => void, ms:number) => TimerId} */
  const startTimer = (fn, ms) => (customSet ? customSet(fn, ms) : setTimeout(fn, ms));
  /** @type {(id:TimerId|null) => void} */
  const stopTimer = (id) => {
    if (id === null) return;
    if (customClear) customClear(id);
    else clearTimeout(id);
  };

  /** @type {Record<keyof Timeouts, number>} */
  const T = { ...DEFAULT_TIMEOUTS };
  for (const key of /** @type {(keyof Timeouts)[]} */ (Object.keys(DEFAULT_TIMEOUTS))) {
    const value = /** @type {unknown} */ (options.timeouts?.[key]);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) T[key] = value;
  }

  const stats = { requests: 0, llm: 0, local: 0, ungrounded: 0, overCap: 0, refused: 0, failures: 0 };
  /** Keys `row:v` of the last three local lines, oldest first (for localLine). @type {string[]} */
  const recentRows = [];
  /** The local sentence of every event recorded as said 'local', in coach markup: what the proxy must re-create. @type {WeakMap<CoachEvent, string>} */
  const spoken = new WeakMap();
  /** Bumped by reset(): a thread of an earlier epoch is dead. */
  let epoch = 0;
  /** The abort functions of the replies in flight. @type {Set<() => void>} */
  const live = new Set();

  // ---- availability (section 7.6) ----

  /** The state behind status(); `forceLocal` and a null apiBase are laid over it. @type {CoachStatus} */
  let state = apiBase === null ? 'offline' : 'unknown';
  /** @type {CoachOffReason|null} */
  let reason = apiBase === null ? 'no_proxy' : null;
  /** Consecutive counted failures. */
  let failures = 0;
  /** Length of the next offline period. */
  let offlineMs = OFFLINE_MS;
  /** The timer that ends an offline or paused period, or starts the next probe of an unconfigured proxy. @type {TimerId|null} */
  let availTimer = null;
  /** @type {Promise<void>|null} */
  let probing = null;
  /** The proxy reported `freeText: true` (and has not refused a free question since). */
  let freeText = false;
  /** @type {Set<(s:{mode:'llm'|'local', reason:CoachOffReason|null}) => void>} */
  const listeners = new Set();

  const forced = () => options.forceLocal === true;
  /** @returns {CoachStatus} */
  const status = () => (apiBase === null || forced() ? 'offline' : state);
  /** @returns {CoachOffReason|null} */
  const offReason = () => (forced() ? 'setting' : apiBase === null ? 'no_proxy' : reason);
  /** @returns {'llm'|'local'} */
  const mode = () => {
    const s = status();
    return s === 'online' || s === 'unknown' ? 'llm' : 'local';
  };
  const capabilities = () => ({ freeText: mode() === 'llm' && freeText });
  const snapshot = () => `${mode()}|${offReason()}|${capabilities().freeText}`;
  let told = snapshot();

  /** Pushes a change of mode, reason or capability to the listeners. Also catches a change of the live `forceLocal`. */
  function syncMode() {
    const next = snapshot();
    if (next === told) return;
    told = next;
    const change = { mode: mode(), reason: offReason() };
    for (const fn of [...listeners]) {
      try {
        fn(change);
      } catch (err) {
        console.error('[coach] a mode listener failed', err);
      }
    }
  }

  /**
   * @param {CoachStatus} next @param {CoachOffReason|null} why
   * @param {number} [ms] with `then`: what happens when the period ends
   * @param {() => void} [then]
   */
  function setState(next, why, ms, then) {
    // Off for the session stays off: the late answer of another request (a pause, a missing key) does not bring it back.
    if (state === 'offline' && (reason === 'origin' || reason === 'version')) return;
    stopTimer(availTimer);
    availTimer = null;
    state = next;
    reason = why;
    if (ms !== undefined && then) {
      availTimer = startTimer(() => {
        availTimer = null;
        then();
      }, ms);
    }
    syncMode();
  }

  const goOnline = () => setState('online', null);
  /** Off for the session. @param {'origin'|'version'} why */
  const goOff = (why) => setState('offline', why);
  /**
   * Not configured: off, and asked again every 10 minutes without leaving the state meanwhile. While `forceLocal` keeps the
   * client off the network the question is put off by another 10 minutes, so it is still asked after the setting changed back.
   */
  const goNoKey = () => setState('offline', 'no_key', REPROBE_MS, () => {
    if (forced()) goNoKey();
    else void probe();
  });
  /** @param {number} ms */
  const goPaused = (ms) => setState('paused', 'paused', Math.min(Math.max(ms, 0), PAUSE_MAX_MS), goOnline);
  function goOffline() {
    const period = offlineMs;
    offlineMs = Math.min(offlineMs * 2, OFFLINE_MAX_MS);
    failures = 0;
    setState('offline', 'unreachable', period, () => {
      setState('unknown', null);
      void probe();
    });
  }

  function noteSuccess() {
    failures = 0;
    offlineMs = OFFLINE_MS;
  }

  /** One counted failure; the second in a row trips the breaker. @returns {boolean} the breaker tripped */
  function countFailure() {
    failures += 1;
    if (failures < BREAKER_FAILURES) return false;
    if (state === 'online' || state === 'unknown') goOffline();
    else failures = 0;
    return true;
  }

  /** `GET /health` once, 2500 ms. @returns {Promise<'online'|'no_key'|'origin'|'version'|'fail'>} */
  async function askHealth() {
    const ctl = new AbortController();
    /** @type {TimerId|null} */
    let timer = startTimer(() => {
      timer = null;
      ctl.abort();
    }, T.probeMs);
    try {
      const res = await untilAbort(request(`${apiBase}/health`, { method: 'GET', cache: 'no-store', signal: ctl.signal }), ctl.signal, discardResponse);
      if (res.status === 403) {
        discardResponse(res);
        return 'origin';
      }
      if (!res.ok) {
        discardResponse(res);
        return 'fail';
      }
      /** @type {unknown} */
      const health = await untilAbort(res.json(), ctl.signal);
      if (!isRecord(health)) return 'fail';
      if (health.v !== undefined && health.v !== PROTOCOL_VERSION) return 'version';
      if (health.ok === true) {
        freeText = health.freeText === true;
        return 'online';
      }
      return health.mode === 'off' || health.reason === 'no_key' ? 'no_key' : 'fail';
    } catch {
      return 'fail';
    } finally {
      stopTimer(timer);
    }
  }

  /**
   * Asks the proxy whether it is there. Never touches the network without an apiBase, while `forceLocal` is on, or once the
   * proxy is off for the session; a paused client stays paused. From `offline (unreachable)` the status becomes `unknown`
   * for the time of the probe.
   * @returns {Promise<void>}
   */
  function probe() {
    syncMode();
    if (apiBase === null || forced()) return Promise.resolve();
    if (state === 'paused' || (state === 'offline' && (reason === 'origin' || reason === 'version'))) return Promise.resolve();
    if (probing) return probing;
    if (state === 'offline' && reason === 'unreachable') setState('unknown', null);
    const run = askHealth().then((answer) => {
      probing = null;
      if (state === 'paused' || (state === 'offline' && (reason === 'origin' || reason === 'version'))) return;
      if (answer === 'online') {
        if (state === 'online') syncMode();
        else goOnline();
      } else if (answer === 'no_key') {
        goNoKey();
      } else if (answer === 'origin' || answer === 'version') {
        goOff(answer);
      } else {
        goOffline();
      }
    });
    probing = run;
    return run;
  }

  /**
   * `useLlm()` of section 7.5 for an event that starts while the status is `unknown`: the probe's answer, waited for at most
   * 800 ms.
   * @param {AbortSignal} signal the reply's
   * @returns {Promise<boolean>}
   */
  function awaitOnline(signal) {
    if (state === 'online') return Promise.resolve(!forced());
    if (state !== 'unknown') return Promise.resolve(false);
    const answer = probe();
    return new Promise((resolve) => {
      let over = false;
      /** @type {TimerId|null} */
      let timer = null;
      /** @type {() => void} */
      let unlink = noop;
      const finish = () => {
        if (over) return;
        over = true;
        stopTimer(timer);
        timer = null;
        unlink();
        resolve(state === 'online' && !forced());
      };
      timer = startTimer(() => {
        timer = null;
        finish();
      }, PROBE_WAIT_MS);
      unlink = link(signal, finish);
      answer.then(finish, finish);
    });
  }

  // ---- thread upkeep ----

  /** @param {string} key `row:v` of a local line just spoken */
  function remember(key) {
    recentRows.push(key);
    while (recentRows.length > RECENT_ROWS) recentRows.shift();
  }

  /**
   * Compaction (section 7.2): all but the last `keep` events are replaced by one recap event, which takes the index of the
   * first replaced event and is recorded as said 'none'. A game-over thread keeps its `over` event instead: that packet is what
   * every later question is about, and a recap describes a turn.
   *
   * What the proxy re-creates from the thread must stay what the child saw. When the question that carried `more` is replaced,
   * the packet moves to the first question left that may carry it (the answers after it were given with it in view), or
   * travels again with the next one. A local sentence that the shortened thread no longer yields is recorded as said 'none'.
   * @param {ThreadState} t @param {number} keep
   * @returns {boolean} the thread was compacted
   */
  function compact(t, keep) {
    const { events } = t;
    const cut = events.length - keep;
    const first = events[0];
    if (!first) return false;
    if (first.kind === 'over') {
      if (cut <= 1) return false;
      events.splice(1, cut - 1);
    } else {
      if (cut < 1 || (cut === 1 && first.kind === 'recap')) return false;
      const replaced = events.slice(0, cut);
      /** @type {CoachEvent} */
      const recap = { i: first.i, kind: 'recap', recap: recapOf(replaced, events.slice(cut), t.active), said: 'none' };
      events.splice(0, cut, recap);
    }
    if (t.moreAt !== null && !events.some((ev) => ev.i === t.moreAt)) {
      t.moreAt = null;
      // (the active try is in the recap now: a try left in the thread has its first follow-up, the carrier, behind it)
      const more = t.active ? t.more : null;
      const next = more ? events.find((ev) => ev.kind === 'ask' && MORE_ASKS.includes(ev.ask)) : undefined;
      if (more && next && next.kind === 'ask') {
        next.more = more;
        t.moreAt = next.i;
      }
    }
    for (let k = 1; k < events.length; k++) {
      const ev = events[k];
      if (ev.said !== 'local') continue;
      let same = false;
      try {
        same = composeLocal(t.turn, events.slice(0, k + 1), ev.v) === spoken.get(ev);
      } catch { /* a sentence that cannot be composed again was not re-created */ }
      if (same) continue;
      ev.said = 'none';
      delete ev.v;
    }
    return true;
  }

  /** The proxy rejected the thread: its signed history is dropped (earlier model replies become said 'none'). @param {ThreadState} t */
  function dropHistory(t) {
    for (const ev of t.events) {
      if (ev.said !== 'llm') continue;
      ev.said = 'none';
      delete ev.reply;
      delete ev.tools;
    }
  }

  /**
   * The reaction to a failed exchange, by the table of section 7.3. The event itself is then answered by `degrade`.
   * @param {CoachError} e @param {ThreadState} t
   */
  function noteFailure(e, t) {
    if (e.code === 'refused') {
      stats.refused += 1;                                  // not counted by the breaker: a filtered sentence must not switch him off
      return;
    }
    stats.failures += 1;
    switch (e.code) {
      case 'invalid':
      case 'bad_signature':
        console.error(`[coach] the proxy rejected the request (${e.code})`);
        dropHistory(t);
        t.invalids += 1;
        if (t.invalids >= 2) t.localOnly = true;           // a structural fault keeps failing for the rest of the thread
        break;
      case 'bad_version':
        goOff('version');
        break;
      case 'origin':
      case 'peer':
        goOff('origin');
        break;
      case 'free_text_off':
        freeText = false;                                  // the input is hidden: capabilities().freeText is false from now on
        syncMode();
        break;
      case 'too_large':
        if (!compact(t, Math.max(1, Math.min(COMPACT_KEEP, t.events.length >> 1)))) t.localOnly = true;
        break;
      case 'rate':
        goPaused(e.retryAfter === undefined ? PAUSE_MS : e.retryAfter * 1000);
        break;
      case 'no_key':
      case 'upstream_auth':
      case 'upstream_model':
        goNoKey();
        break;
      case 'bad_resume':
        console.error('[coach] the proxy rejected the resumed request');
        break;
      case 'upstream_rejected':
      case 'truncated':
      case 'empty':
        break;
      case 'upstream_busy':
        if (!countFailure() && e.retryAfter !== undefined && state === 'online') goPaused(Math.min(e.retryAfter * 1000, BUSY_PAUSE_MAX_MS));
        break;
      default:                                             // upstream_unreachable, upstream_error, internal, eof, timeout, …
        countFailure();
        break;
    }
  }

  /**
   * The error of a response that is not 2xx: `{"error":{"code", "retry_after"?}}` with a known code, else by status.
   * @param {Response} res @param {AbortSignal} signal
   * @returns {Promise<CoachError>}
   */
  async function httpError(res, signal) {
    let code = '';
    /** @type {unknown} */
    let retryAfter;
    try {
      /** @type {unknown} */
      const body = await untilAbort(res.json(), signal);
      const error = isRecord(body) ? body.error : null;
      if (isRecord(error)) {
        if (typeof error.code === 'string' && HTTP_CODES.includes(error.code)) code = error.code;
        retryAfter = error.retry_after;
      }
    } catch (err) {
      if (err instanceof CoachError && err.code === 'aborted') throw err;
      discardResponse(res);
    }
    if (code === '') code = res.status === 403 ? 'origin' : res.status === 413 ? 'too_large' : res.status === 429 ? 'rate' : 'http';
    return new CoachError(code, seconds(retryAfter) ?? seconds(res.headers.get('retry-after')));
  }

  // ---- sending one event (section 7.5) ----

  /**
   * @param {ThreadState} t @param {CoachEvent} event @param {SayMode} sayMode @param {Handlers} handlers
   * @param {ReplyOpts} [opts] @param {MorePacket|null} [more] with a try: what its packet withholds
   * @returns {Reply}
   */
  function send(t, event, sayMode, handlers, opts, more) {
    syncMode();
    if (t.abortCurrent) t.abortCurrent();                  // one reply at a time
    const id = ++t.replySeq;
    if (t.closed || t.epoch !== epoch || t.signal?.aborted) return { id, done: Promise.resolve({ aborted: true }), abort: noop };

    // The event joins the thread, unless the wire rules could never carry it there.
    const recorded = admissible(t.events, event, t.active);
    event.i = t.nextIndex;
    /** @type {CueCode|null} */
    let cue = null;
    try {
      cue = cueFor(t.turn, event, opts?.flags ?? {});
    } catch (err) {
      console.error('[coach] the cue rule failed', err);
    }
    if (cue) event.cue = cue;
    if (recorded) {
      t.nextIndex += 1;
      t.events.push(event);
      if (event.i > LIMITS.EVENT_INDEX_MAX) t.localOnly = true;
      if (event.kind === 'try') {
        t.attempt += 1;
        t.active = event.try;
        t.more = cleanMore(more);
        t.moreAt = null;
      }
      if (t.events.length >= COMPACT_AT) compact(t, COMPACT_KEEP);
      if (event.kind === 'ask' && MORE_ASKS.includes(event.ask) && t.more && t.active && t.moreAt === null && t.events[0].kind !== 'over') {
        event.more = t.more;                               // withheld until the first follow-up; again after a compaction dropped it
        t.moreAt = event.i;
      }
    }
    /**
     * The events the local narrator answers from: the thread, plus the event when it is not part of it. While no try is on the
     * board (换一步) the tries are left out: the sentence is never about a move that was taken back.
     */
    const story = () => {
      const events = t.active ? t.events : withoutTries(t.events);
      return recorded ? events : [...events, event];
    };
    /**
     * Whether the proxy re-creates `line` from this event's variant `v` (section 7.2): it composes from the thread as it travels,
     * which differs from what the narrator was shown when a withdrawn try was left out.
     * @param {number} v @param {string} line
     */
    const recreated = (v, line) => {
      if (!recorded) return false;
      if (story() === t.events) return true;
      try {
        return composeLocal(t.turn, t.events, v) === line;
      } catch {
        return false;
      }
    };

    const ctl = new AbortController();
    let settled = false;
    /** @type {(result:ReplyResult) => void} */
    let resolve = noop;
    /** @type {Promise<ReplyResult>} */
    const done = new Promise((r) => { resolve = r; });
    /** @type {(() => void)[]} */
    const unlinks = [];
    const alive = () => !settled && !ctl.signal.aborted && t.epoch === epoch && t.replySeq === id;

    /** @param {ReplyResult} result */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      for (const unlink of unlinks) unlink();
      if (t.abortCurrent === abortNow) t.abortCurrent = null;
      live.delete(abortNow);
      resolve(result);
    };
    /** aborted() of section 7.5, synchronous: the event stays, said 'none' unless its text completed; no handler is called. */
    function abortNow() {
      if (settled) return;
      if (event.said === undefined) event.said = 'none';
      settle({ aborted: true });
      ctl.abort();                                         // the fetch rejects, the reader is cancelled, the tool's signal fires
    }
    t.abortCurrent = abortNow;
    live.add(abortNow);
    /** @type {Reply} */
    const reply = { id, done, abort: abortNow };
    unlinks.push(link(t.signal, abortNow));
    unlinks.push(link(opts?.signal, abortNow));
    if (settled) return reply;

    // Every handler call is dropped unless the reply is alive.
    const h = {
      /** @param {{cue:string|null}} s */
      onStart: (s) => { if (alive()) callHandler(handlers?.onStart, s); },
      /** @param {Segment} seg */
      onSegment: (seg) => { if (alive()) callHandler(handlers?.onSegment, seg); },
      /** @param {string} text */
      onSentence: (text) => { if (alive()) callHandler(handlers?.onSentence, text); },
      onReset: () => { if (alive()) callHandler(handlers?.onReset); },
      /** @param {{phase:'start'|'end', notation?:string, link?:MoveLink}} tool */
      onTool: (tool) => { if (alive()) callHandler(handlers?.onTool, tool); },
    };
    /** finish() of section 7.5. The reply is settled first, so a handler that sends the next event finds the thread free. */
    const finish = (/** @type {ReplyResult} */ result) => {
      if (!alive()) {
        abortNow();
        return;
      }
      settle(result);
      callHandler(handlers?.onEnd, result);
    };

    if (sayMode === 'silent') {                            // recorded, nothing said, no handler called
      event.said = 'none';
      settle(nothingSaid());
      return reply;
    }
    h.onStart({ cue: cue ? CUE[cue] : null });             // T+0, before any network
    if (!alive()) return reply;

    /**
     * Hands a local sentence to the handlers (unmetered: only the stream text paces) and ends the reply.
     * @param {string} line in coach markup
     * @param {{row:string, v:number}|null} key the template row and variant of the line, when it is a row of the narrator
     * @param {boolean} refused
     */
    const sayLocal = (line, key, refused) => {
      /** @type {Segment[]} */
      const segments = [];
      let text = '';
      if (line !== '') {
        try {
          const stream = createMarkupStream(t.book, (seg) => { segments.push(seg); h.onSegment(seg); }, (sentence) => h.onSentence(sentence));
          stream.push(line);
          stream.finish();
          text = stream.shown();
        } catch (err) {                                    // a book that cannot be read: nothing is said rather than half a line
          console.error('[coach] a local line could not be shown', err);
          h.onReset();
          segments.length = 0;
        }
      }
      if (!alive()) return;
      event.said = 'none';                                 // nothing to say, or nothing the proxy could re-create: no v
      if (text !== '' && key && Number.isInteger(key.v) && key.v >= 0 && key.v < LIMITS.VARIANTS) {
        remember(`${key.row}:${key.v}`);
        if (recreated(key.v, line)) {
          event.said = 'local';
          event.v = key.v;
          spoken.set(event, line);
        }
      }
      if (text !== '') stats.local += 1;
      finish({ aborted: false, text, segments, source: text === '' ? 'none' : 'local', cut: false, refused });
    };
    /** local() of section 7.5. @param {boolean} [refused] */
    const local = (refused = false) => {
      let line = { text: '', row: '', v: 0 };
      try {
        line = localLine(t.turn, story(), recentRows);
      } catch (err) {
        console.error('[coach] the local narrator failed', err);
      }
      sayLocal(line.text, line.text === '' ? null : line, refused);
    };

    const free = event.kind === 'ask' && event.ask === 'free';
    /** A free question whose sentence is empty after sanitizeSay is not sent (CONTRACT-NOTES item 70). */
    const unsaid = event.kind === 'ask' && event.ask === 'free' && event.say === undefined;
    const canTravel = recorded && !unsaid && !t.localOnly && apiBase !== null && !forced() && (state === 'online' || state === 'unknown');
    if (sayMode === 'local' || !canTravel) {
      local();
      return reply;
    }

    /**
     * degrade() of section 7.5: what the child gets when the exchange failed.
     * @param {CoachError} e @param {{shown():string, sentences():number}} markup @param {Segment[]} segments
     * @param {ToolVerdict|null} verdict the last verdict the sandbox produced for this event
     */
    const degrade = (e, markup, segments, verdict) => {
      if (e.code === 'refused') {
        h.onReset();
        if (!free) {
          local(true);
          return;
        }
        let line = '';
        let row = '';
        try {
          line = composeLocal(t.turn, story(), 1);         // the kind fixed line: variant 1 of the row of a free question
          row = localLine(t.turn, story(), recentRows).row;
        } catch (err) {
          console.error('[coach] the local narrator failed', err);
        }
        sayLocal(line, line === '' ? null : { row, v: 1 }, true);
        return;
      }
      if (verdict) {
        let line = '';
        try {
          line = composeToolReply(t.turn, verdict);
        } catch (err) {
          console.error('[coach] the local narrator failed', err);
        }
        if (line !== '') {
          h.onReset();
          sayLocal(line, null, false);                     // said 'none': no template row re-creates it
          return;
        }
      }
      if (markup.sentences() >= 1) {                       // whole sentences stay, the tail was never shown; nothing is appended
        event.said = 'none';
        finish({ aborted: false, text: markup.shown(), segments, source: 'mixed', cut: true, refused: false });
        return;
      }
      h.onReset();
      local();
    };

    /**
     * One leg: POST, then the stream up to its terminal event. Deltas go to `markup` as they arrive.
     * @param {string} body @param {number} firstMs @param {number} deadline @param {{push(delta:string):void}} markup
     * @returns {Promise<{event:'done', text:string, sig:string, stop:string, usage:unknown} | {event:'tool', calls:unknown[], token:string}>}
     */
    const runLeg = async (body, firstMs, deadline, markup) => {
      const legCtl = new AbortController();
      const unlink = link(ctl.signal, () => legCtl.abort());
      const start = now();
      let opened = false;
      let started = false;
      let lastAt = start;
      let timedOut = false;
      /** @type {TimerId|null} */
      let timer = null;
      /** Arms the one timer of the leg for whichever limit of section 7.5 falls due first. */
      const arm = () => {
        stopTimer(timer);
        const due = Math.min(deadline, start + T.legMs, opened ? Infinity : start + T.openMs, started ? lastAt + T.stallMs : start + firstMs);
        timer = startTimer(() => {
          timer = null;
          timedOut = true;
          legCtl.abort();
        }, Math.max(0, due - now()));
      };
      /** @type {ReadableStreamDefaultReader<Uint8Array>|null} */
      let reader = null;
      try {
        if (now() >= deadline) throw new CoachError('timeout');
        arm();
        stats.requests += 1;
        /** @type {Response} */
        let res;
        try {
          res = await untilAbort(request(`${apiBase}/coach`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: legCtl.signal,
          }), legCtl.signal, discardResponse);
        } catch (err) {
          throw err instanceof CoachError ? err : new CoachError('network');
        }
        if (!res.ok) throw await httpError(res, legCtl.signal);
        if (!res.body) throw new CoachError('eof');
        reader = res.body.getReader();
        const parser = createSseParser();
        for (;;) {
          let chunk;
          try {
            chunk = await untilAbort(reader.read(), legCtl.signal);
          } catch (err) {
            throw err instanceof CoachError ? err : new CoachError('eof');
          }
          if (!alive()) throw new CoachError('aborted');
          if (chunk.done) throw new CoachError('eof');     // closed without a terminal event
          for (const ev of parser.feed(chunk.value)) {
            const data = isRecord(ev.data) ? ev.data : {};
            if (ev.event === 'open') {
              opened = true;
              arm();
            } else if (ev.event === 'delta') {
              if (typeof data.t !== 'string') throw new CoachError('bad_stream');
              opened = true;
              started = true;
              lastAt = now();
              arm();
              markup.push(data.t);
              if (!alive()) throw new CoachError('aborted');
            } else if (ev.event === 'done') {
              if (typeof data.text !== 'string') throw new CoachError('bad_stream');
              return { event: 'done', text: data.text, sig: typeof data.sig === 'string' ? data.sig : '', stop: String(data.stop ?? 'end'), usage: data.usage };
            } else if (ev.event === 'tool') {
              const token = data.resume;
              if (!Array.isArray(data.calls) || typeof token !== 'string' || token.length > LIMITS.RESUME_TOKEN_BYTES || !TOKEN_RE.test(token)) {
                throw new CoachError('bad_stream');
              }
              return { event: 'tool', calls: data.calls, token };
            } else if (ev.event === 'error') {
              throw new CoachError(typeof data.code === 'string' && data.code !== '' ? data.code : 'internal', seconds(data.retry_after));
            }
          }
        }
      } catch (err) {
        if (timedOut) throw new CoachError('timeout');
        throw err;
      } finally {
        stopTimer(timer);
        timer = null;
        unlink();
        if (reader) reader.cancel().catch(noop);
      }
    };

    /**
     * One call of the sandbox: `toolMs`, then `busy`. The executor's signal fires when the reply is aborted or the time is up.
     * @param {unknown} call @param {number} deadline
     * @returns {Promise<{input:{notation:string, after:string[]}|null, result:ToolResult}|null>} null: a call that cannot be answered
     */
    const runTool = async (call, deadline) => {
      if (!isRecord(call) || typeof call.id !== 'string' || !CALL_ID_RE.test(call.id)) return null;
      const callId = call.id;
      const input = validateToolInput(String(call.name), call.input);
      if (!input) return { input: null, result: { id: callId, ok: false, error: 'syntax' } };
      const toolCtl = new AbortController();
      const unlink = link(ctl.signal, () => toolCtl.abort());
      /** @type {TimerId|null} */
      let timer = null;
      try {
        /** @type {Promise<unknown>} */
        const work = Promise.resolve().then(() => options.tools.analyzeMove(input, { thread: t.api, book: t.book, signal: toolCtl.signal }));
        work.catch(noop);
        /** @type {Promise<null>} */
        const timeUp = new Promise((r) => {
          timer = startTimer(() => {
            timer = null;
            r(null);
          }, Math.max(0, Math.min(T.toolMs, deadline - now())));
        });
        const out = await untilAbort(Promise.race([work, timeUp]), ctl.signal);
        if (out === null) {
          toolCtl.abort();
          return { input, result: { id: callId, ok: false, error: 'busy' } };
        }
        return { input, result: toolResultOf(callId, out) };
      } catch (err) {
        if (err instanceof CoachError && err.code === 'aborted') throw err;
        console.error('[coach] the tool executor failed', err);
        return { input, result: { id: callId, ok: false, error: 'busy' } };
      } finally {
        stopTimer(timer);
        timer = null;
        unlink();
      }
    };

    /** The exchange with the model: up to three legs with two tool rounds between them, inside the event deadline. */
    const converse = async () => {
      const cap = Math.ceil(DISPLAY_CAP_FACTOR * capFor(event));
      /** @type {Segment[]} */
      const segments = [];
      /** The thread's book, counting the notations of the reply that resolve to no move. @type {MoveBook} */
      const book = {
        base: t.book.base,
        add: (src, line) => t.book.add(src, line),
        lookup: (notation) => t.book.lookup(notation),
        resolveLoose: (notation, tryMove) => {
          const found = t.book.resolveLoose(notation, tryMove);
          if (found === null) stats.ungrounded += 1;
          return found;
        },
        size: () => t.book.size(),
      };
      const markup = createMarkupStream(book, (seg) => { segments.push(seg); h.onSegment(seg); }, (sentence) => h.onSentence(sentence), { cap });
      const deadline = now() + T.eventMs;
      /** @type {ToolResult[]} */
      const results = [];
      /** @type {ToolRecord[]} */
      const records = [];
      /** @type {ToolVerdict|null} */
      let verdict = null;
      /** The leg in flight carries `resume`. */
      let resumed = false;
      try {
        // The body of every leg is this string; a resumed leg only adds `resume`, so it hashes like the first (D-11).
        const base = bodyOf(t.turnJson, t.events);
        if (new TextEncoder().encode(base).length > LIMITS.BODY_BYTES) throw new CoachError('too_large');
        let body = base;
        for (let leg = 0; leg <= LIMITS.TOOL_ROUNDS; leg++) {
          const firstMs = leg === 0 && AUTO_KINDS.includes(event.kind) ? T.firstTextAutoMs : T.firstTextAskMs;
          const end = await runLeg(body, firstMs, deadline, markup);
          if (!alive()) return;

          if (end.event === 'done') {
            markup.finish(end.text);                       // authoritative text; emits what is still due under the display cap
            if (!alive()) return;
            const text = markup.shown();
            if (plainLength(text) === 0) throw new CoachError('empty');
            const over = plainLength(sanitizeModelText(end.text)) > cap;
            if (over) stats.overCap += 1;
            if (end.text !== '' && codePoints(end.text) <= LIMITS.REPLY_CHARS && SIG_RE.test(end.sig)) {
              event.said = 'llm';
              event.reply = { text: end.text, sig: end.sig };
              if (records.length > 0) event.tools = records.slice(-EVENT_TOOLS);
            } else {
              event.said = 'none';                         // shown, but not a reply a later request could carry
            }
            stats.llm += 1;
            noteSuccess();
            /** @type {ReplyResult} */
            const result = { aborted: false, text, segments, source: 'llm', cut: over || end.stop === 'length', refused: false };
            const usage = end.usage;
            if (isRecord(usage) && typeof usage.in === 'number' && typeof usage.cached === 'number' && typeof usage.out === 'number') {
              result.usage = { in: usage.in, cached: usage.cached, out: usage.out };
            }
            finish(result);
            return;
          }

          // A tool round: the calls run one after another, then the same body travels again with `resume`.
          if (leg === LIMITS.TOOL_ROUNDS) break;           // a third round is not part of the protocol
          const calls = end.calls.slice(0, LIMITS.TOOL_CALLS_PER_ROUND);
          const firstCall = calls[0];
          const firstInput = isRecord(firstCall) ? validateToolInput(String(firstCall.name), firstCall.input) : null;
          if (calls.length > 0) {
            /** @type {{phase:'start', notation?:string, link?:MoveLink}} */
            const shown = { phase: 'start' };
            if (firstInput) {
              shown.notation = normalizeNotation(firstInput.notation);
              const where = toolLink(t.book, firstInput);
              if (where) shown.link = where;
            }
            h.onTool(shown);
            if (!alive()) return;
          }
          for (const call of calls) {
            const ran = await runTool(call, deadline);
            if (!alive()) return;
            if (!ran) continue;
            const { result } = ran;
            const at = results.findIndex((r) => r.id === result.id);
            if (at === -1) results.push(result);
            else results[at] = result;
            if (result.ok) verdict = result.verdict;
            const record = ran.input ? toolRecordOf(ran.input, result) : null;
            if (record) records.push(record);
          }
          if (calls.length > 0) h.onTool({ phase: 'end' });
          if (!alive()) return;
          // event.tools is not assigned yet: the resume body must hash like the first leg
          resumed = true;
          body = `${base.slice(0, -1)},"resume":${JSON.stringify({ token: end.token, results: results.slice(-RESUME_RESULTS) })}}`;
        }
        throw new CoachError('loop');
      } catch (err) {
        if (!alive()) return;
        if (!(err instanceof CoachError)) throw err;
        // The proxy took this thread on the first leg: a resumed leg it calls invalid failed on its token or its results.
        const failure = resumed && err.code === 'invalid' ? new CoachError('bad_resume') : err;
        noteFailure(failure, t);
        degrade(failure, markup, segments, verdict);
      }
    };

    const run = async () => {
      if (state !== 'online') {                            // `unknown`: the probe's answer, for at most 800 ms
        const online = await awaitOnline(ctl.signal);
        if (!alive()) return;
        if (!online) {
          local();
          return;
        }
      }
      if (free && !freeText) {                             // the deployer turned free text off: no request
        local();
        return;
      }
      await converse();
    };
    run().catch((err) => {                                 // `done` never rejects
      console.error('[coach] a reply failed', err);
      if (settled) return;
      try {
        h.onReset();
        local();
      } catch (again) {
        console.error('[coach] the local narrator failed', again);
      }
      if (!settled) {                                      // a reply always ends: with nothing, when even that failed
        if (event.said === undefined) event.said = 'none';
        finish(nothingSaid());
      }
    });
    return reply;
  }

  // ---- threads ----

  /**
   * @param {'turn'|'over'} kind @param {TurnBrief} turn @param {MoveBook} book @param {{signal?:AbortSignal}} [opts]
   * @returns {Thread}
   */
  function begin(kind, turn, book, opts) {
    const turnJson = JSON.stringify(turn) ?? 'null';
    /** @type {ThreadState} */
    const t = {
      turn: JSON.parse(turnJson),                          // a snapshot: the brief is identical in every request of the thread
      turnJson,
      book,
      signal: opts?.signal,
      epoch,
      events: [],
      nextIndex: 0,
      replySeq: 0,
      closed: false,
      localOnly: false,
      invalids: 0,
      attempt: 0,
      active: null,
      more: null,
      moreAt: null,
      abortCurrent: null,
      api: /** @type {Thread} */ ({}),
    };
    const interrupt = () => {
      if (t.abortCurrent) t.abortCurrent();
    };
    /** @type {Thread} */
    const api = {
      kind,
      open(ev, sayMode, h, replyOpts) {
        /** @type {CoachEvent} */
        let event = { i: 0, kind: 'opp' };
        if (ev.kind === 'start') event = typeof ev.first === 'boolean' ? { i: 0, kind: 'start', first: ev.first } : { i: 0, kind: 'start' };
        else if (ev.kind === 'over') event = { i: 0, kind: 'over', over: ev.over };
        return send(t, event, sayMode, h, replyOpts);
      },
      hint(level, packet, sayMode, h, replyOpts) {
        return send(t, { i: 0, kind: 'hint', level, hint: packet }, sayMode, h, replyOpts);
      },
      tryMove(packet, more, sayMode, h, replyOpts) {
        return send(t, { i: 0, kind: 'try', n: Math.min(t.attempt + 1, TRY_NUMBER_MAX), try: packet }, sayMode, h, replyOpts, more);
      },
      ask(code, say, h, replyOpts) {
        /** @type {Extract<CoachEvent, {kind:'ask'}>} */
        const event = { i: 0, kind: 'ask', ask: code };
        if (code === 'free') {                             // the child's own sentence: sanitised before it is stored or sent
          const text = typeof say === 'string' ? sanitizeSay(say) : '';
          if (text !== '') event.say = text;
        }
        return send(t, event, 'auto', h, replyOpts);
      },
      interrupt,
      retract() {
        interrupt();
        t.active = null;                                   // withdrawn: nothing more is told about it
        t.more = null;
        t.moreAt = null;
      },
      end() {
        interrupt();
        t.closed = true;
      },
      activeTry: () => t.active,
      busy: () => t.abortCurrent !== null,
    };
    t.api = api;
    return api;
  }

  return {
    status,
    mode,
    offReason,
    onMode(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    probe,
    capabilities,
    beginTurn: (turn, book, opts) => begin('turn', turn, book, opts),
    beginOver: (turn, book, opts) => begin('over', turn, book, opts),
    reset() {
      epoch += 1;
      for (const abort of [...live]) abort();
    },
    stats: () => ({ ...stats }),
  };
}
