// server/mock.js (S2) — mock mode: the model is replaced by the local narrator (contract sections 4.29, 7.8).
// Needs no key and never imports `openai`. Validation, signing, SSE and resume run exactly as live.
//
// `mockReply` is a script, not a clock: it yields the SSE events of one leg in order and, between them, pacing pairs
// `['wait', {ms}]` that are not sent to the client. The handler's pump does the waiting, on the request's abort
// signal, so a mock reply that stalls for ever or for a minute ends the moment the client goes away and leaves no
// timer behind. `ms` is Infinity for "never".

/**
 * @import { CoachRequest, ToolResult } from '../src/coach/types.js'
 * @import { CoachConfig } from './config.js'
 */

import { NOTATION_SCAN_RE } from '../src/core/codes.js';
import { composeLocal, composeToolReply } from '../src/coach/fallback.js';
import { canonicalJson } from '../src/coach/protocol.js';
import { sha256Hex } from './sign.js';

/** Characters per `delta` event. */
const CHUNK_CHARS = 4;
/** Deltas sent before `#refusal` refuses and before `#cut` closes the stream. */
const PARTIAL_DELTAS = 3;
/** `#slow`: no delta for this long (pings continue). */
const SLOW_MS = 60000;
/** `#long`: the length of the reply in characters. */
const LONG_CHARS = 600;
/** Largest `chunkMs` a request may ask for. */
const CHUNK_MS_MAX = 60000;

const MODEL = 'mock';
const TOOL_NAME = 'analyze_move';
const TOOL_CALL_ID = 'mock_1';
/** Said when the local narrator has nothing to say about the event. */
const NOTHING = '嗯。';
/** The resumed leg when the tool result is an error. */
const TOOL_FAILED = '这步棋亮没摆明白，小主公在棋盘上走一下？';
/** `#badmove`: a notation that is in no book. */
const BAD_MOVE = '【车五进九】';
/** `#long`: the sentence the long reply repeats. */
const LONG_SENTENCE = '亮把这一步在沙盘上又摆了一遍。';

/**
 * @param {URLSearchParams} query
 * @param {CoachConfig} config
 * @returns {number} milliseconds between two deltas: query `chunkMs`, else COACH_MOCK_CHUNK_MS (default 15)
 */
function chunkDelay(query, config) {
  const asked = query.get('chunkMs');
  if (asked !== null && /^[0-9]{1,6}$/.test(asked)) return Math.min(Number(asked), CHUNK_MS_MAX);
  return config.mockChunkMs;
}

/** @param {string} text @returns {string[]} the text in pieces of four characters */
function pieces(text) {
  const chars = Array.from(text);
  /** @type {string[]} */
  const out = [];
  for (let k = 0; k < chars.length; k += CHUNK_CHARS) out.push(chars.slice(k, k + CHUNK_CHARS).join(''));
  return out;
}

/** @param {string} head @returns {string} a reply of exactly LONG_CHARS characters that starts with `head` */
function longReply(head) {
  let text = head;
  while (Array.from(text).length < LONG_CHARS) text += LONG_SENTENCE;
  return Array.from(text).slice(0, LONG_CHARS - 1).join('') + '。';
}

/**
 * The hash a resume token carries: the request without `resume` (contract section 7.4).
 * @param {CoachRequest} req
 * @returns {string}
 */
function bodyHash(req) {
  const { resume: _resume, ...rest } = req;
  return sha256Hex(canonicalJson(rest));
}

/**
 * The mock reply of one leg. Yields [event, data] pairs: `delta`, then `tool`, `done` or `error` (or nothing more, for
 * `#cut`), with `['wait', {ms}]` pacing pairs in between (see the head of this file).
 *
 * Reply text: 〔kind=<event kind>〕 + composeLocal(turn, events, 0), or 嗯。 when that is empty, in deltas of four
 * characters. Query `stall=1`: nothing but waiting. A free question whose sentence is exactly `#error`, `#refusal`,
 * `#cut`, `#slow`, `#badmove` or `#long` triggers that failure; one that contains a notation asks for the tool
 * (`mock_1`) on the first leg and answers 〔kind=tool〕 + composeToolReply on the resumed leg. (Query `fail=<status>`
 * is answered by the handler before the stream opens.)
 * @param {CoachRequest} req
 * @param {Parameters<typeof import('./prompt.js').buildMessages>[1]} legs   the completed legs of this event
 * @param {ReturnType<typeof import('./sign.js').createSigner>} signer
 * @param {CoachConfig} config
 * @param {URLSearchParams} query   chunkMs, fail, stall
 * @returns {AsyncGenerator<[string, object]>}
 */
export async function* mockReply(req, legs, signer, config, query) {
  const { turn, events } = req;
  const last = events[events.length - 1];
  const say = last.kind === 'ask' && last.ask === 'free' ? last.say ?? '' : '';
  const chunkMs = chunkDelay(query, config);

  if (query.get('stall') === '1') {
    yield ['wait', { ms: Infinity }];
    return;
  }

  /**
   * The deltas of a reply, at most `limit` of them.
   * @param {string} text @param {number} [limit]
   * @returns {Generator<[string, object]>}
   */
  function* speak(text, limit = Infinity) {
    let sent = 0;
    for (const t of pieces(text)) {
      if (sent >= limit) return;
      if (chunkMs > 0) yield ['wait', { ms: chunkMs }];
      yield ['delta', { t }];
      sent++;
    }
  }

  /**
   * The terminal `done` event: the text of all legs of this event, signed for this thread, index and kind.
   * @param {string} legText
   * @returns {[string, object]}
   */
  const done = (legText) => {
    const text = [...legs.map((leg) => leg.text), legText].filter(Boolean).join('\n');
    const sig = signer.signReply({ turnHash: sha256Hex(canonicalJson(turn)), i: last.i, kind: last.kind }, text);
    return ['done', { text, sig, stop: 'end', model: MODEL, usage: { in: 0, cached: 0, out: Array.from(legText).length } }];
  };

  // the resumed leg of the tool loop
  if (legs.length > 0) {
    /** @type {ToolResult|undefined} */
    const result = req.resume?.results[0];
    const answer = result && result.ok ? '〔kind=tool〕' + composeToolReply(turn, result.verdict) : TOOL_FAILED;
    yield* speak(answer);
    yield done(answer);
    return;
  }

  const head = `〔kind=${last.kind}〕`;
  const reply = head + (composeLocal(turn, events, 0) || NOTHING);

  switch (say) {
    case '#error':
      yield ['error', { code: 'upstream_busy', retry_after: 1 }];
      return;
    case '#refusal':
      yield* speak(reply, PARTIAL_DELTAS);
      yield ['error', { code: 'refused' }];
      return;
    case '#cut':
      yield* speak(reply, PARTIAL_DELTAS);
      return;                                                  // the stream closes without a terminal event
    case '#slow':
      yield ['wait', { ms: SLOW_MS }];
      break;
    case '#badmove': {
      const text = head + BAD_MOVE + '可以走。';
      yield* speak(text);
      yield done(text);
      return;
    }
    case '#long': {
      const text = longReply(head);
      yield* speak(text);
      yield done(text);
      return;
    }
    default: {
      const found = say.match(NOTATION_SCAN_RE);
      if (found) {
        const input = { notation: found[0], after: [] };
        const leg = { text: '', calls: [{ id: TOOL_CALL_ID, name: TOOL_NAME, arguments: JSON.stringify(input) }], x: [] };
        const resume = signer.seal({ v: 1, h: bodyHash(req), legs: [leg] });
        yield ['tool', { calls: [{ id: TOOL_CALL_ID, name: TOOL_NAME, input }], resume, text: '' }];
        return;
      }
    }
  }

  yield* speak(reply);
  yield done(reply);
}

/** Counters served by GET /mock/stats and zeroed by POST /mock/reset. */
export const mockStats = { started: 0, completed: 0, aborted: 0 };
