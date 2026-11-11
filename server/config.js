// server/config.js (S1) — proxy configuration from the environment (contract sections 4.29, 7.9).
// The key is never logged and never served.
//
// How a value is read (the table of section 7.9 gives the names and the defaults):
//   text      trimmed; an unset or empty variable takes the default
//   flag      on only when the value is exactly `1`. COACH_FREE_TEXT, whose default is on, stays on when it is unset,
//             empty or exactly `1`; any other value (`0`, but also `false`, `off`, `no`) turns free text off, so a
//             misspelt "off" never leaves the child's free-text input open
//   number    a plain decimal integer inside its range; anything else takes the default
// loadConfig never throws and never writes to the console.
//
// `apiKey` and `signingKey` are read and assigned by name like any property (`config.apiKey`), but they are
// non-enumerable accessors: JSON.stringify, Object.keys / entries, for-in, console.log, console.dir and util.inspect
// (also with `showHidden`) do not show their values, and neither does a spread copy. So `{ ...config }` loses both
// secrets: to change a field, pass `overrides` to loadConfig instead.

import { sha256Hex } from './sign.js';

/** @typedef {{ mode:'live'|'mock'|'off', baseUrl:string, apiKey:string, model:string, quickModel:string, reasoningEffort:string|null,
 *              maxTokens:number, maxTokensOver:number, upstreamTimeoutMs:number, allowedOrigins:string[], allowNoOrigin:boolean,
 *              rateBurst:number, ratePerMin:number, ipDaily:number, globalDaily:number, trustProxy:boolean, isPublic:boolean,
 *              signingKey:string, freeText:boolean, mockChunkMs:number }} CoachConfig */

const DEFAULT_MODEL = 'openai/openai/gpt-6-sol';
const DEFAULT_REASONING_EFFORT = 'low';
const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_MAX_TOKENS_OVER = 1600;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60000;
const DEFAULT_MOCK_CHUNK_MS = 15;
const DEFAULT_RATE_BURST = 20;
const DEFAULT_RATE_PER_MIN = 30;
const DEFAULT_IP_DAILY = 600;
const DEFAULT_GLOBAL_DAILY = 2000;
/** COACH_SIGNING_KEY must have at least this many characters; a shorter value is ignored. */
const SIGNING_KEY_MIN_CHARS = 32;
const SIGNING_KEY_PREFIX = 'yijian-coach:';
const MOCK_SIGNING_KEY = 'mock';
/** Largest delay a Node timer accepts; a longer one would fire at once. */
const TIMER_MAX_MS = 2147483647;
const REDACTED = '[redacted]';

/**
 * Reads the COACH_* variables (table: contract section 7.9). Never throws; never logs values.
 *
 * `overrides` replace what the environment gives before the derived values are worked out: `mode` (mock when
 * COACH_MOCK=1, else live when both the key and the base URL are present, else off), `quickModel` (= `model`) and
 * `signingKey` ('mock' in mock mode, else COACH_SIGNING_KEY when it has 32 characters or more, else
 * sha256Hex('yijian-coach:' + apiKey)) follow the overridden values unless they are overridden themselves.
 * @param {Record<string, string|undefined>} env
 * @param {Partial<CoachConfig>} [overrides]
 * @returns {CoachConfig}
 */
export function loadConfig(env, overrides) {
  try {
    return readConfig(env, overrides);
  } catch {
    return readConfig({}, undefined);         // the defaults; reading an empty environment cannot fail
  }
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {Partial<CoachConfig>|undefined} overrides
 * @returns {CoachConfig}
 */
function readConfig(env, overrides) {
  /** @type {Record<string, string|undefined>} */
  const source = env !== null && typeof env === 'object' ? env : {};
  /** @type {Partial<CoachConfig>} */
  const over = overrides !== null && typeof overrides === 'object' ? overrides : {};

  /** @param {string} name @returns {string|undefined} trimmed text; undefined when the variable is not set */
  const raw = (name) => {
    try {
      const value = source[name];
      return value === undefined || value === null ? undefined : String(value).trim();
    } catch {
      return undefined;
    }
  };
  /** @param {string} name @param {string} fallback */
  const text = (name, fallback) => raw(name) || fallback;
  /** @param {string} name */
  const flag = (name) => raw(name) === '1';
  /** @param {string} name @param {number} fallback @param {number} min @param {number} max */
  const integer = (name, fallback, min, max) => {
    const value = raw(name);
    if (value === undefined || !/^[0-9]{1,15}$/.test(value)) return fallback;
    const n = Number(value);
    return n >= min && n <= max ? n : fallback;
  };
  /**
   * An override wins when it is present (undefined counts as absent).
   * @template {keyof CoachConfig} K
   * @param {K} field
   * @param {CoachConfig[K]} value
   * @returns {CoachConfig[K]}
   */
  const pick = (field, value) => {
    const given = over[field];
    return given === undefined ? value : /** @type {CoachConfig[K]} */ (given);
  };

  const apiKey = pick('apiKey', text('COACH_API_KEY', ''));
  const baseUrl = pick('baseUrl', text('COACH_BASE_URL', ''));
  const mode = pick('mode', flag('COACH_MOCK') ? 'mock' : apiKey && baseUrl ? 'live' : 'off');
  const model = pick('model', text('COACH_MODEL', DEFAULT_MODEL));

  const effort = raw('COACH_REASONING_EFFORT');
  const reasoningEffort = effort === undefined ? DEFAULT_REASONING_EFFORT
    : effort === '' || effort.toLowerCase() === 'none' ? null : effort;

  const envSigningKey = raw('COACH_SIGNING_KEY') ?? '';
  const signingKey = mode === 'mock' ? MOCK_SIGNING_KEY
    : envSigningKey.length >= SIGNING_KEY_MIN_CHARS ? envSigningKey
    : sha256Hex(SIGNING_KEY_PREFIX + apiKey);

  const origins = pick('allowedOrigins', originList(raw('COACH_ALLOWED_ORIGINS')));

  // The default is on, so the switch is read the careful way round: only "unset" and `1` keep free text on.
  const freeTextValue = raw('COACH_FREE_TEXT');
  const freeText = !freeTextValue || freeTextValue === '1';

  /** @type {CoachConfig} */
  const config = {
    mode,
    baseUrl,
    apiKey,
    model,
    quickModel: pick('quickModel', text('COACH_QUICK_MODEL', model)),
    reasoningEffort: pick('reasoningEffort', reasoningEffort),
    maxTokens: pick('maxTokens', integer('COACH_MAX_TOKENS', DEFAULT_MAX_TOKENS, 1, Number.MAX_SAFE_INTEGER)),
    maxTokensOver: pick('maxTokensOver', integer('COACH_MAX_TOKENS_OVER', DEFAULT_MAX_TOKENS_OVER, 1, Number.MAX_SAFE_INTEGER)),
    upstreamTimeoutMs: pick('upstreamTimeoutMs', integer('COACH_UPSTREAM_TIMEOUT_MS', DEFAULT_UPSTREAM_TIMEOUT_MS, 1, TIMER_MAX_MS)),
    allowedOrigins: Array.isArray(origins) ? [...origins] : [],
    allowNoOrigin: pick('allowNoOrigin', flag('COACH_ALLOW_NO_ORIGIN')),
    rateBurst: pick('rateBurst', integer('COACH_RATE_BURST', DEFAULT_RATE_BURST, 1, Number.MAX_SAFE_INTEGER)),
    ratePerMin: pick('ratePerMin', integer('COACH_RATE_PER_MIN', DEFAULT_RATE_PER_MIN, 1, Number.MAX_SAFE_INTEGER)),
    ipDaily: pick('ipDaily', integer('COACH_IP_DAILY', DEFAULT_IP_DAILY, 1, Number.MAX_SAFE_INTEGER)),
    globalDaily: pick('globalDaily', integer('COACH_GLOBAL_DAILY', DEFAULT_GLOBAL_DAILY, 1, Number.MAX_SAFE_INTEGER)),
    trustProxy: pick('trustProxy', flag('COACH_TRUST_PROXY')),
    isPublic: pick('isPublic', flag('COACH_PUBLIC')),
    signingKey: pick('signingKey', signingKey),
    freeText: pick('freeText', freeText),
    mockChunkMs: pick('mockChunkMs', integer('COACH_MOCK_CHUNK_MS', DEFAULT_MOCK_CHUNK_MS, 0, TIMER_MAX_MS)),
  };
  return hideSecrets(config);
}

/**
 * COACH_ALLOWED_ORIGINS: comma-separated, each entry trimmed, empty entries dropped. Matching is exact.
 * @param {string|undefined} value
 * @returns {string[]}
 */
function originList(value) {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
}

/**
 * Keeps both secrets out of every string form of the config. They stay readable and assignable by name, but each
 * is a non-enumerable accessor over a value held here: a listing of hidden properties shows `[Getter/Setter]`, not
 * the value, also when the inspection hook is bypassed (`console.dir`, `customInspect: false`). The hook answers
 * for the ordinary forms (`console.log`, `%o`, `showHidden`). What is left is an inspection that asks for hidden
 * properties, evaluates getters and bypasses the hook, all three at once.
 * @param {CoachConfig} config
 * @returns {CoachConfig}
 */
function hideSecrets(config) {
  for (const name of /** @type {const} */ (['apiKey', 'signingKey'])) {
    let secret = config[name];
    Object.defineProperty(config, name, {
      get: () => secret,
      set: (/** @type {string} */ value) => { secret = value; },
      enumerable: false,
      configurable: true,
    });
  }
  Object.defineProperty(config, Symbol.for('nodejs.util.inspect.custom'), {
    /** @this {CoachConfig} */
    value() {
      return { ...this, apiKey: this.apiKey ? REDACTED : '', signingKey: this.signingKey ? REDACTED : '' };
    },
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return config;
}
