// server/sign.js (S1) — HMAC signer for replies and resume tokens (contract sections 4.29, 7.4).
// node:crypto HMAC-SHA256; works on Node 22.
//
// Two things are signed, each under its own prefix so that one can never stand in for the other:
//   reply signature  base64url(HMAC-SHA256(key, 'reply:v2:' + turnHash + ':' + i + ':' + kind + ':' + text)).slice(0, 43)
//   resume token     base64url(JSON) + '.' + base64url(HMAC-SHA256(key, 'resume:v1:' + JSON)), at most 4096 bytes
// Every comparison of a signature is constant-time.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const REPLY_PREFIX = 'reply:v2:';
const RESUME_PREFIX = 'resume:v1:';
/** Length of base64url(32 bytes) without padding. */
const SIG_CHARS = 43;
/** Largest resume token (section 7.4; the same number as LIMITS.RESUME_TOKEN_BYTES of src/coach/protocol.js). */
const TOKEN_MAX_BYTES = 4096;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * signReply: base64url, 43 chars. verifyReply: constant-time. seal / open: the resume token.
 *
 * signReply throws a TypeError when the context could make the signed string ambiguous (turnHash or kind empty or
 * containing ':', i not a non-negative integer, text not a string); verifyReply answers false for the same input.
 * seal throws a TypeError for a payload that is not a plain object and a RangeError when the token would be longer
 * than 4096 bytes. verifyReply and open never throw.
 * @param {string} secret
 * @returns {{ signReply(ctx:{turnHash:string, i:number, kind:string}, text:string): string,
 *             verifyReply(ctx:{turnHash:string, i:number, kind:string}, text:string, sig:string): boolean,
 *             seal(payload:object): string, open(token:string): object|null }}
 */
export function createSigner(secret) {
  if (typeof secret !== 'string' || secret.length === 0) throw new TypeError('createSigner: the secret must be a non-empty string');
  const key = Buffer.from(secret, 'utf8');

  /** @param {string} message @returns {string} base64url, 43 characters */
  const mac = (message) => createHmac('sha256', key).update(message, 'utf8').digest('base64url');

  /**
   * The string a reply signature covers, or null when the context is not usable.
   * turnHash and kind must not contain the separator, otherwise two different contexts could give the same string.
   * @param {{turnHash:string, i:number, kind:string}} ctx
   * @param {string} text
   * @returns {string|null}
   */
  function replyInput(ctx, text) {
    if (ctx === null || typeof ctx !== 'object' || typeof text !== 'string') return null;
    const { turnHash, i, kind } = ctx;
    if (typeof turnHash !== 'string' || turnHash.length === 0 || turnHash.includes(':')) return null;
    if (typeof kind !== 'string' || kind.length === 0 || kind.includes(':')) return null;
    if (!Number.isSafeInteger(i) || i < 0) return null;
    return REPLY_PREFIX + turnHash + ':' + i + ':' + kind + ':' + text;
  }

  return {
    signReply(ctx, text) {
      const input = replyInput(ctx, text);
      if (input === null) throw new TypeError('signReply: invalid context or text');
      return mac(input).slice(0, SIG_CHARS);
    },

    verifyReply(ctx, text, sig) {
      const input = replyInput(ctx, text);
      if (input === null || typeof sig !== 'string') return false;
      return constantTimeEqual(sig, mac(input).slice(0, SIG_CHARS));
    },

    seal(payload) {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('seal: the payload must be a plain object');
      }
      const json = JSON.stringify(payload);
      const token = Buffer.from(json, 'utf8').toString('base64url') + '.' + mac(RESUME_PREFIX + json);
      if (token.length > TOKEN_MAX_BYTES) throw new RangeError('seal: the resume token exceeds 4096 bytes');
      return token;
    },

    open(token) {
      try {
        if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX_BYTES) return null;
        const dot = token.indexOf('.');
        if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
        const body = token.slice(0, dot);
        const sig = token.slice(dot + 1);
        if (!BASE64URL_RE.test(body) || sig.length !== SIG_CHARS) return null;
        const json = Buffer.from(body, 'base64url').toString('utf8');
        // Only the canonical encoding of well-formed UTF-8 is accepted, so one payload has exactly one token.
        if (Buffer.from(json, 'utf8').toString('base64url') !== body) return null;
        if (!constantTimeEqual(sig, mac(RESUME_PREFIX + json))) return null;
        const value = JSON.parse(json);
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Compares two strings without leaking, through timing, where they differ. (Their lengths are public.)
 * @param {string} given
 * @param {string} expected
 * @returns {boolean}
 */
function constantTimeEqual(given, expected) {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
