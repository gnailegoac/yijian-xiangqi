// tests/unit/server/sign.test.js (S1) — contract sections 7.4 and 14.3.
// Expected signatures are computed here with node:crypto from the formulas of section 7.4, not with server/sign.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

import { createSigner, sha256Hex } from '../../../server/sign.js';

const SECRET = 'unit-test-signing-key-0123456789abcdef';
const OTHER_SECRET = 'another-signing-key-fedcba9876543210';
const TURN_HASH = createHash('sha256').update('{"me":"red","ply":4}', 'utf8').digest('hex');
const OTHER_TURN_HASH = createHash('sha256').update('{"me":"red","ply":6}', 'utf8').digest('hex');
const TEXT = '中卒看着好吃，其实【马八进七】守着呢。';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** @param {string} secret @param {string} message */
const hmac = (secret, message) => createHmac('sha256', Buffer.from(secret, 'utf8')).update(message, 'utf8').digest('base64url');

/** A token built by hand from the formula of section 7.4. @param {string} secret @param {string} json */
const tokenOf = (secret, json) => Buffer.from(json, 'utf8').toString('base64url') + '.' + hmac(secret, 'resume:v1:' + json);

/** @param {string} text @param {number} at  replaces the character at `at` by a different base64url character */
const flip = (text, at) => text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1);

const PAYLOAD = Object.freeze({
  v: 1,
  h: createHash('sha256').update('{"events":[],"turn":{},"v":1}', 'utf8').digest('hex'),
  legs: [{
    text: '让亮先摆一摆这步。',
    calls: [{ id: 'call_ab12', name: 'analyze_move', arguments: '{"notation":"马八进七","after":[]}' }],
    x: [{ id: 'call_cd34', error: 'limit' }],
  }],
});

test('sha256Hex is the lowercase hex SHA-256 of the UTF-8 text', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('小主公'), createHash('sha256').update(Buffer.from('小主公', 'utf8')).digest('hex'));
  assert.match(sha256Hex('小主公'), /^[0-9a-f]{64}$/);
  assert.notEqual(sha256Hex('小主公'), sha256Hex('小主公 '));
});

test('a reply signature is base64url(HMAC-SHA256(key, "reply:v2:" + turnHash + ":" + i + ":" + kind + ":" + text)), 43 characters', () => {
  const signer = createSigner(SECRET);
  const sig = signer.signReply({ turnHash: TURN_HASH, i: 3, kind: 'try' }, TEXT);
  assert.match(sig, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sig, hmac(SECRET, 'reply:v2:' + TURN_HASH + ':3:try:' + TEXT).slice(0, 43));
  // Deterministic, and the empty reply and index 0 are signed like any other.
  assert.equal(signer.signReply({ turnHash: TURN_HASH, i: 3, kind: 'try' }, TEXT), sig);
  assert.equal(signer.signReply({ turnHash: TURN_HASH, i: 0, kind: 'start' }, ''), hmac(SECRET, 'reply:v2:' + TURN_HASH + ':0:start:').slice(0, 43));
  // Another key gives another signature.
  assert.notEqual(createSigner(OTHER_SECRET).signReply({ turnHash: TURN_HASH, i: 3, kind: 'try' }, TEXT), sig);
});

test('a reply signature verifies only for the same turn, index and kind', () => {
  const signer = createSigner(SECRET);
  const ctx = { turnHash: TURN_HASH, i: 3, kind: 'try' };
  const sig = signer.signReply(ctx, TEXT);

  assert.equal(signer.verifyReply(ctx, TEXT, sig), true);
  assert.equal(signer.verifyReply({ turnHash: TURN_HASH, i: 3, kind: 'try' }, TEXT, sig), true, 'an equal context verifies');

  assert.equal(signer.verifyReply({ ...ctx, turnHash: OTHER_TURN_HASH }, TEXT, sig), false, 'another turn');
  assert.equal(signer.verifyReply({ ...ctx, i: 4 }, TEXT, sig), false, 'another index');
  assert.equal(signer.verifyReply({ ...ctx, i: 2 }, TEXT, sig), false, 'another index');
  assert.equal(signer.verifyReply({ ...ctx, kind: 'ask' }, TEXT, sig), false, 'another kind');
  assert.equal(signer.verifyReply(ctx, TEXT + '。', sig), false, 'another text');
  assert.equal(signer.verifyReply(ctx, TEXT.slice(1), sig), false, 'another text');
  assert.equal(signer.verifyReply(ctx, '', sig), false, 'another text');
  assert.equal(createSigner(OTHER_SECRET).verifyReply(ctx, TEXT, sig), false, 'another key');

  // Every single-character change of the signature is rejected, and so is any other length.
  for (let at = 0; at < sig.length; at++) assert.equal(signer.verifyReply(ctx, TEXT, flip(sig, at)), false, `flipped at ${at}`);
  assert.equal(signer.verifyReply(ctx, TEXT, sig.slice(0, 42)), false);
  assert.equal(signer.verifyReply(ctx, TEXT, sig + 'A'), false);
  assert.equal(signer.verifyReply(ctx, TEXT, sig + '='), false);
  assert.equal(signer.verifyReply(ctx, TEXT, ''), false);

  // The four contexts of one text give four different signatures, each valid only in its own place.
  const contexts = [ctx, { ...ctx, turnHash: OTHER_TURN_HASH }, { ...ctx, i: 4 }, { ...ctx, kind: 'ask' }];
  const sigs = contexts.map((c) => signer.signReply(c, TEXT));
  assert.equal(new Set(sigs).size, 4);
  contexts.forEach((c, a) => sigs.forEach((s, b) => assert.equal(signer.verifyReply(c, TEXT, s), a === b)));
});

test('the parts of a reply context cannot run into each other', () => {
  const signer = createSigner(SECRET);
  // Without a check, kind 'ask' + text 'why:好' and kind 'ask:why' + text '好' would be the same signed string.
  const sig = signer.signReply({ turnHash: TURN_HASH, i: 1, kind: 'ask' }, 'why:好');
  assert.equal(signer.verifyReply({ turnHash: TURN_HASH, i: 1, kind: 'ask:why' }, '好', sig), false);
  assert.equal(signer.verifyReply({ turnHash: TURN_HASH + ':1', i: 1, kind: 'ask' }, 'why:好', sig), false);
  assert.throws(() => signer.signReply({ turnHash: TURN_HASH, i: 1, kind: 'ask:why' }, '好'), TypeError);
  assert.throws(() => signer.signReply({ turnHash: 'ab:cd', i: 1, kind: 'ask' }, '好'), TypeError);
  assert.throws(() => signer.signReply({ turnHash: '', i: 1, kind: 'ask' }, '好'), TypeError);
  assert.throws(() => signer.signReply({ turnHash: TURN_HASH, i: 1, kind: '' }, '好'), TypeError);
  for (const i of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => signer.signReply({ turnHash: TURN_HASH, i, kind: 'ask' }, '好'), TypeError);
    assert.equal(signer.verifyReply({ turnHash: TURN_HASH, i, kind: 'ask' }, '好', sig), false);
  }
});

test('verifyReply answers false, and never throws, for malformed input', () => {
  const signer = createSigner(SECRET);
  const ctx = { turnHash: TURN_HASH, i: 3, kind: 'try' };
  const sig = signer.signReply(ctx, TEXT);
  const badSigs = [undefined, null, 43, {}, [sig], '小'.repeat(43), sig + '\n', ' ' + sig];
  for (const bad of badSigs) assert.equal(signer.verifyReply(ctx, TEXT, bad), false);
  const badContexts = [undefined, null, 'ctx', {}, { turnHash: TURN_HASH, i: '3', kind: 'try' }, { turnHash: 7, i: 3, kind: 'try' }];
  for (const bad of badContexts) assert.equal(signer.verifyReply(bad, TEXT, sig), false);
  const badTexts = [undefined, null, 5, [TEXT]];
  for (const bad of badTexts) assert.equal(signer.verifyReply(ctx, bad, sig), false);
});

test('seal / open round trip; a tampered token is rejected', () => {
  const signer = createSigner(SECRET);
  const token = signer.seal(PAYLOAD);

  // Round trip.
  assert.deepEqual(signer.open(token), PAYLOAD);
  assert.equal(signer.seal(PAYLOAD), token, 'sealing is deterministic');

  // The format of section 7.4: base64url(JSON) + '.' + base64url(HMAC-SHA256(key, 'resume:v1:' + JSON)).
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  const [body, sig] = token.split('.');
  const json = Buffer.from(body, 'base64url').toString('utf8');
  assert.deepEqual(JSON.parse(json), PAYLOAD);
  assert.equal(sig, hmac(SECRET, 'resume:v1:' + json));
  assert.deepEqual(signer.open(tokenOf(SECRET, json)), PAYLOAD, 'a token built from the formula opens');

  // Tampering: any single character, in the payload or in the signature.
  for (let at = 0; at < token.length; at++) {
    if (token[at] === '.') continue;
    assert.equal(signer.open(flip(token, at)), null, `flipped at ${at}`);
  }
  // Tampering: a different payload under the old signature.
  const forged = { ...PAYLOAD, legs: [] };
  assert.equal(signer.open(Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url') + '.' + sig), null);
  const otherHash = { ...PAYLOAD, h: 'f'.repeat(64) };
  assert.equal(signer.open(Buffer.from(JSON.stringify(otherHash), 'utf8').toString('base64url') + '.' + sig), null);
  // Tampering: cut, extended, or put together differently.
  assert.equal(signer.open(token.slice(0, -1)), null);
  assert.equal(signer.open(token + 'A'), null);
  assert.equal(signer.open(body), null);
  assert.equal(signer.open(body + '.'), null);
  assert.equal(signer.open('.' + sig), null);
  assert.equal(signer.open(body + '.' + sig + '.' + sig), null);
  assert.equal(signer.open(sig + '.' + body), null);
  assert.equal(signer.open(body + '=.' + sig), null);
  assert.equal(signer.open(' ' + token), null);

  // A token sealed with another key, and a signature made without the 'resume:v1:' prefix or with the reply prefix.
  assert.equal(signer.open(createSigner(OTHER_SECRET).seal(PAYLOAD)), null);
  assert.equal(createSigner(OTHER_SECRET).open(token), null);
  assert.equal(signer.open(body + '.' + hmac(SECRET, json)), null);
  assert.equal(signer.open(body + '.' + hmac(SECRET, 'reply:v2:' + json)), null);
  assert.equal(signer.open(body + '.' + signer.signReply({ turnHash: TURN_HASH, i: 0, kind: 'ask' }, json)), null);
});

test('a resume token is at most 4096 bytes', () => {
  const signer = createSigner(SECRET);
  /** @param {number} n  a payload whose JSON text has exactly n bytes (ASCII) */
  const payloadOfJsonLength = (n) => ({ t: 'x'.repeat(n - '{"t":""}'.length) });

  // base64url(3036 bytes) = 4048 characters, + '.' + 43 = 4092 <= 4096; one more block of 3 bytes is 4096.
  const fits = payloadOfJsonLength(3039);
  assert.equal(JSON.stringify(fits).length, 3039);
  const token = signer.seal(fits);
  assert.equal(token.length, 4096);
  assert.deepEqual(signer.open(token), fits);

  const tooBig = payloadOfJsonLength(3040);
  assert.throws(() => signer.seal(tooBig), RangeError);
  // A correctly signed token above the limit is not opened either.
  const oversized = tokenOf(SECRET, JSON.stringify(tooBig));
  assert.ok(oversized.length > 4096);
  assert.equal(signer.open(oversized), null);
  assert.deepEqual(signer.open(tokenOf(SECRET, JSON.stringify(fits))), fits, 'the same construction opens at the limit');
});

test('open returns only plain objects and never throws; seal takes only plain objects', () => {
  const signer = createSigner(SECRET);
  // Correctly signed, but the content is not a JSON object.
  for (const json of ['[1,2]', '"text"', 'null', '12', 'true', '{', '', '{"a":1}x']) {
    assert.equal(signer.open(tokenOf(SECRET, json)), null, json);
  }
  assert.deepEqual(signer.open(tokenOf(SECRET, '{"a":1}')), { a: 1 });
  // Correctly signed bytes that are not UTF-8, and a second spelling of the same payload bytes.
  const invalidUtf8 = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d]);
  const lossy = invalidUtf8.toString('utf8');
  assert.equal(signer.open(invalidUtf8.toString('base64url') + '.' + hmac(SECRET, 'resume:v1:' + lossy)), null);
  const [body, sig] = tokenOf(SECRET, '{"a":1}').split('.');             // 7 bytes: the last character carries 4 unused bits
  const lastIndex = BASE64URL.indexOf(body[body.length - 1]);
  const respelled = body.slice(0, -1) + BASE64URL[lastIndex + 1];
  assert.deepEqual(Buffer.from(respelled, 'base64url'), Buffer.from(body, 'base64url'), 'same bytes, other spelling');
  assert.equal(signer.open(respelled + '.' + sig), null);

  const notTokens = [undefined, null, 0, {}, [], '', '.', '..', 'a.b', '小.主', 'x'.repeat(5000)];
  for (const bad of notTokens) assert.equal(signer.open(bad), null);

  const notPayloads = [null, undefined, 'text', 5, [1, 2], true];
  for (const bad of notPayloads) assert.throws(() => signer.seal(bad), TypeError);
});

test('createSigner needs a non-empty string secret', () => {
  const bad = ['', undefined, null, 42, {}, Buffer.from('key')];
  for (const secret of bad) assert.throws(() => createSigner(secret), TypeError);
  // The mock-mode key of section 7.4 is a valid secret.
  const mock = createSigner('mock');
  const sig = mock.signReply({ turnHash: TURN_HASH, i: 0, kind: 'opp' }, '嗯。');
  assert.equal(sig, hmac('mock', 'reply:v2:' + TURN_HASH + ':0:opp:嗯。').slice(0, 43));
  assert.equal(mock.verifyReply({ turnHash: TURN_HASH, i: 0, kind: 'opp' }, '嗯。', sig), true);
});
