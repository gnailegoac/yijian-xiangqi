// Config (SPEC 4.26): loads ./config.json. Nothing can set an endpoint from the URL; `?coach=off` and the setting
// coach: 'local' can only disable it. Owner: A1.
//
// This module has no runtime import (CONTRACT-NOTES 2). Everything it touches arrives through `env`, so the tests run it
// in Node with a scripted fetch.
//
// Readings of points the contract leaves open (reported with the package):
// - `apiBase` is returned as the file gives it, with trailing slashes removed (`/api` stays `/api`); the resolved URL is
//   used only to decide whether the endpoint is allowed. An empty string means "no endpoint".
// - `coach` always agrees with `apiBase`: with an endpoint the mode is the file's `mock`, else `live`, and the reason is
//   null; without one the mode is `off` and the reason is the file's (`no_key` from a proxy without a key), else
//   `no_proxy`. An endpoint that was refused counts as none.
// - The 1500 ms limit covers the request and the reading of its body, and it ends the wait even when the fetch ignores
//   the abort signal.

/** @import { CoachOffReason } from './game/types.js' */

/** @typedef {{ apiBase:string|null, build:string, coach:{mode:'live'|'mock'|'off', reason:CoachOffReason|null} }} AppConfig */

/** The manual abort timer of step 2 (`AbortSignal.timeout` is not allowed in src/). */
const TIMEOUT_MS = 1500;
/** `build` when the file gives none (CONTRACT-NOTES 45: the field is always present). */
const NO_BUILD = 'unknown';
/** @type {readonly CoachOffReason[]} */
const OFF_REASONS = ['no_proxy', 'no_key', 'origin', 'unreachable', 'setting', 'paused', 'version'];

/** @param {CoachOffReason} reason @param {string} [build] @returns {AppConfig} */
function off(reason, build) {
  return { apiBase: null, build: build ?? NO_BUILD, coach: { mode: 'off', reason } };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {CoachOffReason|null} */
function offReason(v) {
  return OFF_REASONS.find((reason) => reason === v) ?? null;
}

/**
 * Step 3: the endpoint must resolve to the page's own origin, to https, or to http on this machine.
 * @param {unknown} raw the file's `apiBase`
 * @param {string} baseURI
 * @returns {string|null} the endpoint without a trailing '/', or null
 */
function checkApiBase(raw, baseURI) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    console.warn('[config] apiBase is not a string; the strategist stays on this device');
    return null;
  }
  const text = raw.trim();
  if (text === '') return null;
  let allowed = false;
  try {
    const base = new URL(baseURI);
    const url = new URL(text, base);
    const sameOrigin = url.origin !== 'null' && url.origin === base.origin;
    const thisMachine = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    allowed = sameOrigin || url.protocol === 'https:' || thisMachine;
  } catch {
    allowed = false;                                         // not a URL at all
  }
  if (!allowed) {
    console.warn(`[config] apiBase ${JSON.stringify(text)} is not allowed (same origin, https, or http on localhost / 127.0.0.1 only)`);
    return null;
  }
  return text.replace(/\/+$/, '');                           // step 4
}

/**
 * Step 2: `./config.json` next to the page. Null when it does not answer 200 with a JSON object within the time limit.
 * @param {typeof fetch} fetchFn
 * @param {string} baseURI
 * @returns {Promise<Record<string, unknown>|null>} never rejects
 */
async function readFile(fetchFn, baseURI) {
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  /** @type {Promise<null>} */
  const timeUp = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, TIMEOUT_MS);
  });
  const read = (async () => {
    const response = await fetchFn(new URL('./config.json', baseURI), { cache: 'no-store', signal: controller.signal });
    if (response.status !== 200) return null;
    /** @type {unknown} */
    const body = await response.json();
    return isRecord(body) ? body : null;
  })().catch(() => null);                                    // network error, abort, not JSON
  try {
    return await Promise.race([read, timeUp]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * never rejects
 * @param {{ fetch?:typeof fetch, location?:Location, baseURI?:string }} [env]
 * @returns {Promise<AppConfig>}
 */
export async function loadConfig(env) {
  try {
    // 1. `?coach=off`: no request at all
    const where = env?.location ?? globalThis.location;
    const search = where && typeof where.search === 'string' ? where.search : '';
    if (new URLSearchParams(search).getAll('coach').includes('off')) return off('setting');

    // 2. the file
    const fetchFn = env?.fetch ?? globalThis.fetch;
    const baseURI = env?.baseURI ?? globalThis.document?.baseURI;
    if (typeof fetchFn !== 'function' || typeof baseURI !== 'string') return off('no_proxy');
    const file = await readFile(fetchFn, baseURI);
    if (file === null) return off('no_proxy');
    const build = typeof file.build === 'string' && file.build !== '' ? file.build : NO_BUILD;

    // 3 and 4. the endpoint, and a coach block that agrees with it
    const apiBase = checkApiBase(file.apiBase, baseURI);
    const told = isRecord(file.coach) ? file.coach : {};
    if (apiBase === null) return off(offReason(told.reason) ?? 'no_proxy', build);
    return { apiBase, build, coach: { mode: told.mode === 'mock' ? 'mock' : 'live', reason: null } };
  } catch (error) {
    console.warn('[config] config.json could not be used', error);
    return off('no_proxy');
  }
}
