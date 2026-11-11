// server/provider.js (S2) — the provider call (contract sections 4.29, 7.11).
// The only file that imports `openai`, and it does so lazily, on the first live request (`await import('openai')`),
// so mock mode and the type check of every other file never need the package.
//
// The gateway is OpenAI-compatible and is called through chat completions with streaming. Nothing here depends on
// a behaviour of one model family beyond the parameters below; `parallel_tool_calls` is not sent.
// Nothing in this file writes to the console, and no error message is ever passed on: `mapError` turns an error
// into a protocol code, so a gateway that echoes the key in its error text cannot make it travel any further.

/**
 * @import { OpenAI } from 'openai'
 * @import { CoachConfig } from './config.js'
 */

/**
 * The SDK's default export, kept once it has been imported: `mapError` needs its error classes.
 * @type {typeof OpenAI|null}
 */
let sdk = null;

/**
 * One SDK client per config. The handler keeps one config per environment, so this is one client per process in
 * production; a second config (another gateway, another key) gets its own client instead of the first one's.
 * @type {WeakMap<CoachConfig, OpenAI>}
 */
const clients = new WeakMap();

/** Models that rejected `reasoning_effort`: it is never sent to them again. Remembered for the process lifetime. */
const noEffort = new Set();

/** The finish reasons a caller sees. Anything else a gateway reports reads as `stop`. */
const FINISH = /** @type {const} */ (['stop', 'tool_calls', 'length', 'content_filter']);

/** Most tool calls kept from one answer (the proxy forwards two per round). A fragment for a later call is dropped. */
const MAX_CALLS = 8;

/**
 * The place of a tool-call fragment in the list of calls. A fragment names its call by `index`. Some gateways leave
 * the index out; then a fragment that brings a new id (or, without ids, a function name when the last call already
 * has one) starts the next call, and any other fragment continues the last call. The caller drops a fragment whose
 * place is MAX_CALLS or more, so a gateway that numbers its calls wildly cannot make the list grow without bound.
 * @param {{id:string, name:string, arguments:string}[]} calls
 * @param {{index?:unknown, id?:unknown, function?:{name?:unknown}}} fragment
 * @returns {number}
 */
function slotOf(calls, fragment) {
  const { index } = fragment;
  const given = typeof index === 'string' && /^[0-9]{1,3}$/.test(index) ? Number(index) : index;
  if (typeof given === 'number' && Number.isInteger(given) && given >= 0) return given;
  const last = calls.length - 1;
  const open = calls[last];
  if (!open) return last + 1;
  const id = typeof fragment.id === 'string' ? fragment.id : '';
  const name = typeof fragment.function?.name === 'string' ? fragment.function.name : '';
  const next = id !== '' ? open.id !== '' && open.id !== id : name !== '' && open.name !== '';
  return next ? last + 1 : last;
}

/** @returns {Error} what `streamChat` throws when the caller's signal fired: `mapError` reads it as "the client went away" */
function abortError() {
  const err = new Error('the request was aborted');
  err.name = 'AbortError';
  return err;
}

/** @param {unknown} n @returns {number} a token count; 0 for anything that is not a number */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * One streamed chat completion. Yields the visible text as it arrives, then exactly one `end` part.
 *
 * A model that rejects `reasoning_effort` is asked once more without it, and the parameter is not sent to that
 * model again. Tool-call arguments arrive as string fragments per index and are joined here. A refusal reads as
 * finish `content_filter`. Usage comes from the last chunk (`stream_options.include_usage`).
 * Throws the SDK's error on failure and an `AbortError` when `signal` fired; `mapError` turns either into a code.
 * @param {CoachConfig} config
 * @param {{ model:string,
 *           messages:OpenAI.ChatCompletionMessageParam[],
 *           tools:OpenAI.ChatCompletionTool[],
 *           toolChoice:'auto'|'none',
 *           maxTokens:number,
 *           signal:AbortSignal }} request
 * @returns {AsyncGenerator<{type:'text', text:string} | {type:'end', finish:'stop'|'tool_calls'|'length'|'content_filter',
 *           toolCalls:{id:string, name:string, arguments:string}[], model:string, usage:{in:number, cached:number, out:number}}>}
 */
export async function* streamChat(config, { model, messages, tools, toolChoice, maxTokens, signal }) {
  const { default: Sdk } = await import('openai');
  sdk = Sdk;
  if (signal?.aborted) throw abortError();                       // the request is already gone: nothing is sent
  // Without both, the SDK would fall back to its own default endpoint and credentials: the key must go to the
  // configured gateway or nowhere. (loadConfig never gives mode `live` without them; a hand-made config could.)
  if (!config.baseUrl || !config.apiKey) throw new Error('the provider is not configured');
  let client = clients.get(config);
  if (!client) {
    // Only the COACH_* variables configure the proxy. Left to itself the SDK would also read OPENAI_ORG_ID and
    // OPENAI_PROJECT_ID (sent to the gateway as headers) and OPENAI_LOG (its own console logging) from the
    // environment of the machine, so those three are fixed here: no such header, and nothing on the console.
    // The SDK also adds the headers of OPENAI_CUSTOM_HEADERS, after its own Authorization header: a machine on which
    // that variable holds an Authorization line (set for another tool) would send that credential to the gateway in
    // the place of the coach's key. A default header given here wins over the variable, so the key of the config is
    // the one that is sent, whatever the machine has set (CONTRACT-NOTES 150). Other headers of the variable still
    // travel, as the README says.
    client = new Sdk({
      apiKey: config.apiKey, baseURL: config.baseUrl, maxRetries: 1, timeout: config.upstreamTimeoutMs,
      organization: null, project: null, logLevel: 'off',
      defaultHeaders: { Authorization: `Bearer ${config.apiKey}` },
    });
    clients.set(config, client);
  }

  /** @type {OpenAI.ChatCompletionCreateParamsStreaming} */
  const params = {
    model, stream: true, stream_options: { include_usage: true }, max_completion_tokens: maxTokens, messages, tools, tool_choice: toolChoice,
  };
  if (config.reasoningEffort && !noEffort.has(model)) {
    params.reasoning_effort = /** @type {OpenAI.ReasoningEffort} */ (config.reasoningEffort);
  }

  let stream;
  try {
    stream = await client.chat.completions.create(params, { signal });
  } catch (err) {
    // a model that rejects reasoning_effort: retry once without it and remember
    if (err instanceof Sdk.BadRequestError && params.reasoning_effort && /reasoning[_ ]?effort/i.test(String(err.message))) {
      noEffort.add(model);
      delete params.reasoning_effort;
      stream = await client.chat.completions.create(params, { signal });
    } else {
      throw err;
    }
  }

  /** @type {{id:string, name:string, arguments:string}[]} */
  const calls = [];
  /** @type {typeof FINISH[number]} */
  let finish = 'stop';
  let usage = { in: 0, cached: 0, out: 0 };
  let served = model;
  let refused = false;
  try {
    for await (const chunk of stream) {
      if (chunk.usage) {
        const cached = count(chunk.usage.prompt_tokens_details?.cached_tokens);
        usage = { in: Math.max(0, count(chunk.usage.prompt_tokens) - cached), cached, out: count(chunk.usage.completion_tokens) };
      }
      if (typeof chunk.model === 'string' && chunk.model) served = chunk.model;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      if (d.refusal) refused = true;
      // Only a string is reply text: whatever else a gateway puts there must not reach the child as "[object Object]".
      if (typeof d.content === 'string' && d.content) yield { type: 'text', text: d.content };
      for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {      // arguments arrive as string fragments per index
        if (tc === null || typeof tc !== 'object') continue;
        const at = slotOf(calls, tc);
        if (at >= MAX_CALLS) continue;
        const slot = calls[at] ??= { id: '', name: '', arguments: '' };
        if (typeof tc.id === 'string' && tc.id) slot.id = tc.id;
        if (typeof tc.function?.name === 'string' && tc.function.name) slot.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') slot.arguments += tc.function.arguments;
      }
      const reason = choice.finish_reason;
      if (reason) finish = reason === 'function_call' ? 'tool_calls' : FINISH.includes(reason) ? reason : 'stop';
    }
  } catch (err) {
    throw signal?.aborted ? abortError() : err;
  }
  // The SDK ends the iteration quietly when the request is aborted: what was read so far is not an answer.
  if (signal?.aborted) throw abortError();
  yield { type: 'end', finish: refused ? 'content_filter' : finish, toolCalls: calls.filter(Boolean), model: served, usage };
}

/**
 * @param {unknown} err
 * @param {'APIUserAbortError'|'APIConnectionTimeoutError'|'APIConnectionError'|'AuthenticationError'|'PermissionDeniedError'
 *         |'NotFoundError'|'RateLimitError'|'BadRequestError'|'InternalServerError'|'APIError'} name
 * @returns {boolean} `err instanceof OpenAI[name]`; false while the SDK has never been loaded (no SDK error can exist then)
 */
function is(err, name) {
  return sdk !== null && err instanceof sdk[name];
}

/**
 * Maps a provider error to a protocol error code, most specific first.
 * @param {any} err
 * @returns {{code:string, retry_after?:number}|null}  null = the client went away
 */
export function mapError(err) {
  // The SDK's error classes do not set `name`, so its abort error is recognised by class as well as by name.
  if (is(err, 'APIUserAbortError') || err?.name === 'APIUserAbortError' || err?.name === 'AbortError') return null;
  if (is(err, 'APIConnectionTimeoutError') || is(err, 'APIConnectionError')) return { code: 'upstream_unreachable' };
  if (is(err, 'AuthenticationError') || is(err, 'PermissionDeniedError')) return { code: 'upstream_auth' };
  if (is(err, 'NotFoundError')) return { code: 'upstream_model' };
  if (is(err, 'RateLimitError')) {
    const seconds = Number(err.headers?.get?.('retry-after'));          // a date form or a missing header gives NaN
    return { code: 'upstream_busy', retry_after: seconds > 0 ? Math.ceil(seconds) : 20 };
  }
  if (is(err, 'BadRequestError')) {
    return /content[_ ]?(filter|policy|management)|safety/i.test(`${err.code} ${err.message}`)
      ? { code: 'refused' } : { code: 'upstream_rejected' };
  }
  if (is(err, 'InternalServerError')) return { code: 'upstream_busy', retry_after: 10 };
  if (is(err, 'APIError')) return { code: 'upstream_error' };
  return { code: 'internal' };
}
