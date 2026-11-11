// Config (SPEC 4.26): loads ./config.json. Nothing can set an endpoint from the URL; `?coach=off` and the setting
// coach: 'local' can only disable it. Owner: A1.
// F0 stub: final signature, no behaviour yet.

/** @import { CoachOffReason } from './game/types.js' */

/** @typedef {{ apiBase:string|null, build:string, coach:{mode:'live'|'mock'|'off', reason:CoachOffReason|null} }} AppConfig */

/**
 * never rejects
 * @param {{ fetch?:typeof fetch, location?:Location, baseURI?:string }} [env]
 * @returns {Promise<AppConfig>}
 */
export async function loadConfig(env) {
  throw new Error('not implemented');
}
