// tests/unit/server/config.test.js (S1) — contract sections 4.29, 7.4, 7.9 and 14.3.
// Every environment here is a fake object; the real environment and .env.local are never read.

import test from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';

import { loadConfig } from '../../../server/config.js';

const KEY = 'sk-unit-test-9f3c1a7e5b2d4c6f8a0b';
const BASE_URL = 'https://gateway.example/v1';
const LIVE = Object.freeze({ COACH_API_KEY: KEY, COACH_BASE_URL: BASE_URL });
/** The default signing key of section 7.4. @param {string} apiKey */
const derivedKey = (apiKey) => createHash('sha256').update('yijian-coach:' + apiKey, 'utf8').digest('hex');

/** The twenty fields of the CoachConfig typedef (section 4.29). */
const FIELDS = ['mode', 'baseUrl', 'apiKey', 'model', 'quickModel', 'reasoningEffort', 'maxTokens', 'maxTokensOver', 'upstreamTimeoutMs',
  'allowedOrigins', 'allowNoOrigin', 'rateBurst', 'ratePerMin', 'ipDaily', 'globalDaily', 'trustProxy', 'isPublic', 'signingKey', 'freeText',
  'mockChunkMs'];

/**
 * All twenty fields as a plain object (the secrets are read by name).
 * @param {import('../../../server/config.js').CoachConfig} config
 */
const plain = (config) => Object.fromEntries(FIELDS.map((name) => [name, /** @type {Record<string, unknown>} */ (config)[name]]));

/**
 * Everything a console writes for these calls, as one string (a Console of its own: nothing reaches the terminal).
 * @param {(c: Console) => void} use
 */
function printed(use) {
  let out = '';
  const sink = new Writable({ write(chunk, _encoding, done) { out += String(chunk); done(); } });
  use(new Console({ stdout: sink, stderr: sink }));
  return out;
}

test('defaults', () => {
  // The table of section 7.9, with nothing set.
  assert.deepEqual(plain(loadConfig({})), {
    mode: 'off',
    baseUrl: '',
    apiKey: '',
    model: 'openai/openai/gpt-6-sol',
    quickModel: 'openai/openai/gpt-6-sol',
    reasoningEffort: 'low',
    maxTokens: 1200,
    maxTokensOver: 1600,
    upstreamTimeoutMs: 60000,
    allowedOrigins: [],
    allowNoOrigin: false,
    rateBurst: 20,
    ratePerMin: 30,
    ipDaily: 600,
    globalDaily: 2000,
    trustProxy: false,
    isPublic: false,
    signingKey: derivedKey(''),
    freeText: true,
    mockChunkMs: 15,
  });

  // With a key and a gateway only: everything else keeps its default, the signing key is derived from the key.
  assert.deepEqual(plain(loadConfig({ ...LIVE })), {
    mode: 'live',
    baseUrl: BASE_URL,
    apiKey: KEY,
    model: 'openai/openai/gpt-6-sol',
    quickModel: 'openai/openai/gpt-6-sol',
    reasoningEffort: 'low',
    maxTokens: 1200,
    maxTokensOver: 1600,
    upstreamTimeoutMs: 60000,
    allowedOrigins: [],
    allowNoOrigin: false,
    rateBurst: 20,
    ratePerMin: 30,
    ipDaily: 600,
    globalDaily: 2000,
    trustProxy: false,
    isPublic: false,
    signingKey: derivedKey(KEY),
    freeText: true,
    mockChunkMs: 15,
  });

  // An empty variable is an unset variable (except COACH_REASONING_EFFORT, tested below).
  const empties = Object.fromEntries(['COACH_BASE_URL', 'COACH_API_KEY', 'COACH_MODEL', 'COACH_QUICK_MODEL', 'COACH_MAX_TOKENS',
    'COACH_MAX_TOKENS_OVER', 'COACH_UPSTREAM_TIMEOUT_MS', 'COACH_MOCK', 'COACH_MOCK_CHUNK_MS', 'COACH_ALLOWED_ORIGINS', 'COACH_ALLOW_NO_ORIGIN',
    'COACH_PUBLIC', 'COACH_RATE_BURST', 'COACH_RATE_PER_MIN', 'COACH_IP_DAILY', 'COACH_GLOBAL_DAILY', 'COACH_TRUST_PROXY', 'COACH_SIGNING_KEY',
    'COACH_FREE_TEXT'].map((name) => [name, '']));
  assert.deepEqual(plain(loadConfig(empties)), plain(loadConfig({})));

  // Two calls give independent objects.
  const a = loadConfig({}), b = loadConfig({});
  assert.notEqual(a, b);
  assert.notEqual(a.allowedOrigins, b.allowedOrigins);
});

test('every variable of the table is read', () => {
  const config = loadConfig({
    COACH_BASE_URL: ' https://gw.example/v1 ',
    COACH_API_KEY: ` ${KEY} `,
    COACH_MODEL: 'vendor/model-a',
    COACH_QUICK_MODEL: 'vendor/model-quick',
    COACH_REASONING_EFFORT: 'medium',
    COACH_MAX_TOKENS: '900',
    COACH_MAX_TOKENS_OVER: '2400',
    COACH_UPSTREAM_TIMEOUT_MS: '45000',
    COACH_MOCK: '0',
    COACH_MOCK_CHUNK_MS: '0',
    COACH_ALLOWED_ORIGINS: 'https://yijian.example, https://pages.example:8443 ,,',
    COACH_ALLOW_NO_ORIGIN: '1',
    COACH_PUBLIC: '1',
    COACH_RATE_BURST: '5',
    COACH_RATE_PER_MIN: '12',
    COACH_IP_DAILY: '100',
    COACH_GLOBAL_DAILY: '300',
    COACH_TRUST_PROXY: '1',
    COACH_SIGNING_KEY: 'k'.repeat(32),
    COACH_FREE_TEXT: '0',
  });
  assert.deepEqual(plain(config), {
    mode: 'live',
    baseUrl: 'https://gw.example/v1',
    apiKey: KEY,
    model: 'vendor/model-a',
    quickModel: 'vendor/model-quick',
    reasoningEffort: 'medium',
    maxTokens: 900,
    maxTokensOver: 2400,
    upstreamTimeoutMs: 45000,
    allowedOrigins: ['https://yijian.example', 'https://pages.example:8443'],
    allowNoOrigin: true,
    rateBurst: 5,
    ratePerMin: 12,
    ipDaily: 100,
    globalDaily: 300,
    trustProxy: true,
    isPublic: true,
    signingKey: 'k'.repeat(32),
    freeText: false,
    mockChunkMs: 0,
  });
  // COACH_QUICK_MODEL defaults to COACH_MODEL, not to the default model.
  assert.equal(loadConfig({ COACH_MODEL: 'vendor/model-a' }).quickModel, 'vendor/model-a');
});

test('mode: mock, live, off', () => {
  // off: no key (or no gateway) and mock off.
  assert.equal(loadConfig({}).mode, 'off');
  assert.equal(loadConfig({ COACH_BASE_URL: BASE_URL }).mode, 'off');
  assert.equal(loadConfig({ COACH_BASE_URL: BASE_URL, COACH_API_KEY: '' }).mode, 'off');
  assert.equal(loadConfig({ COACH_BASE_URL: BASE_URL, COACH_API_KEY: '   ' }).mode, 'off');
  assert.equal(loadConfig({ COACH_BASE_URL: BASE_URL, COACH_MOCK: '0' }).mode, 'off');
  assert.equal(loadConfig({ COACH_API_KEY: KEY }).mode, 'off', 'the live path needs the key and the base URL');

  // live: key and gateway, mock off.
  assert.equal(loadConfig({ ...LIVE }).mode, 'live');
  assert.equal(loadConfig({ ...LIVE, COACH_MOCK: '0' }).mode, 'live');
  assert.equal(loadConfig({ ...LIVE, COACH_MOCK: '' }).mode, 'live');

  // mock: COACH_MOCK=1, with or without a key.
  assert.equal(loadConfig({ COACH_MOCK: '1' }).mode, 'mock');
  assert.equal(loadConfig({ ...LIVE, COACH_MOCK: '1' }).mode, 'mock');
  assert.equal(loadConfig({ COACH_MOCK: '1' }).apiKey, '', 'mock needs no key');
  assert.equal(loadConfig({ COACH_MOCK: '1', COACH_MOCK_CHUNK_MS: '400' }).mockChunkMs, 400);
});

test("empty or 'none' reasoning effort is omitted", () => {
  assert.equal(loadConfig({ ...LIVE }).reasoningEffort, 'low', 'unset: the default');
  assert.equal(loadConfig({ ...LIVE, COACH_REASONING_EFFORT: '' }).reasoningEffort, null);
  assert.equal(loadConfig({ ...LIVE, COACH_REASONING_EFFORT: 'none' }).reasoningEffort, null);
  assert.equal(loadConfig({ ...LIVE, COACH_REASONING_EFFORT: 'low' }).reasoningEffort, 'low');
  assert.equal(loadConfig({ ...LIVE, COACH_REASONING_EFFORT: 'high' }).reasoningEffort, 'high');
  // Spelling variants of the two "omit" values.
  assert.equal(loadConfig({ ...LIVE, COACH_REASONING_EFFORT: '  ' }).reasoningEffort, null);
  assert.equal(loadConfig({ ...LIVE, COACH_REASONING_EFFORT: ' none ' }).reasoningEffort, null);
  assert.equal(loadConfig({ ...LIVE, COACH_REASONING_EFFORT: 'NONE' }).reasoningEffort, null);
  // What provider.js does with it: `if (cfg.reasoningEffort && !noEffort) params.reasoning_effort = …`.
  assert.ok(!loadConfig({ ...LIVE, COACH_REASONING_EFFORT: 'none' }).reasoningEffort);
});

test('loadConfig never includes the key in its string form', (t) => {
  const signing = 'S1gn1ng-K3y-' + 'z'.repeat(28);
  const spies = /** @type {const} */ (['log', 'info', 'warn', 'error', 'debug']).map((name) => t.mock.method(console, name, () => {}));
  const configs = [
    loadConfig({ ...LIVE }),                                            // derived signing key
    loadConfig({ ...LIVE, COACH_SIGNING_KEY: signing }),                // explicit signing key
    loadConfig({ ...LIVE, COACH_MOCK: '1' }),                           // mock mode keeps the key it was given
    loadConfig({ COACH_API_KEY: KEY }),                                 // off
    loadConfig({}, { apiKey: KEY, baseUrl: BASE_URL, signingKey: signing }),   // through overrides
  ];
  const logged = spies.reduce((n, spy) => n + spy.mock.callCount(), 0);
  t.mock.restoreAll();
  assert.equal(logged, 0, 'loadConfig logs nothing');

  const secrets = [KEY, signing, derivedKey(KEY)];
  for (const config of configs) {
    // The key is there for the provider call …
    assert.equal(config.apiKey, KEY);
    assert.ok(config.signingKey.length > 0);
    // … and in none of the forms a log line, an error message or a response could be built from.
    const forms = [
      String(config),
      `${config}`,
      '' + config,
      JSON.stringify(config),
      JSON.stringify(config, null, 2),
      JSON.stringify({ config }),
      JSON.stringify({ ...config }),
      JSON.stringify(Object.assign({}, config)),
      JSON.stringify(Object.entries(config)),
      JSON.stringify(Object.values(config)),
      JSON.stringify(structuredClone({ ...config })),
      util.inspect(config),
      util.inspect(config, { showHidden: true, depth: null }),
      util.inspect({ nested: { config } }, { showHidden: true, depth: null }),
      // The inspection hook bypassed (console.dir does that), with and without the hidden properties listed.
      util.inspect(config, { customInspect: false, depth: null }),
      util.inspect(config, { customInspect: false, showHidden: true, depth: null }),
      util.inspect({ nested: { config } }, { customInspect: false, showHidden: true, depth: null }),
      util.inspect(config, { getters: true, showHidden: true, depth: null }),
      JSON.stringify(Object.getOwnPropertyDescriptors(config)),
      printed((c) => {
        c.log(config);
        c.log('config: %o / %O / %s / %j', config, config, config, config);
        c.error(config);
        c.dir(config);
        c.dir(config, { showHidden: true, depth: null });
        c.dir({ nested: { config } }, { showHidden: true, depth: null });
        c.table([config]);
      }),
      util.format('%s', config),
      util.format('%o', config),
      util.format('%O', config),
      util.format('%j', config),
      util.format(config),
      new Error(`config: ${util.inspect(config)}`).stack ?? '',
    ];
    let keys = '';
    for (const name in config) keys += name + '=' + /** @type {Record<string, unknown>} */ (config)[name] + ';';
    forms.push(keys);
    for (const form of forms) {
      for (const secret of secrets) assert.ok(!form.includes(secret), `a secret appears in: ${form.slice(0, 80)}`);
    }
    assert.ok(!Object.keys(config).includes('apiKey'));
    assert.ok(!Object.keys(config).includes('signingKey'));
  }
  // The same holds for the mock signing key's neighbours: nothing else was hidden by accident.
  assert.deepEqual(Object.keys(loadConfig({})).sort(), FIELDS.filter((name) => name !== 'apiKey' && name !== 'signingKey').sort());

  // A secret assigned later is read back by name and stays hidden like the first one.
  const rotated = loadConfig({ ...LIVE });
  const nextKey = 'sk-rotated-0f1e2d3c4b5a69788796a5b4';
  rotated.apiKey = nextKey;
  rotated.signingKey = signing;
  assert.equal(rotated.apiKey, nextKey);
  assert.equal(rotated.signingKey, signing);
  const after = [JSON.stringify(rotated), JSON.stringify({ ...rotated }), util.inspect(rotated, { showHidden: true, depth: null }),
    util.inspect(rotated, { customInspect: false, showHidden: true, depth: null }), printed((c) => c.dir(rotated, { showHidden: true }))];
  for (const form of after) {
    for (const secret of [KEY, nextKey, signing]) assert.ok(!form.includes(secret), `a secret appears in: ${form.slice(0, 80)}`);
  }
  // The printed form still says that a key is there, without saying which.
  assert.match(util.inspect(rotated), /apiKey: '\[redacted\]'/);
  assert.match(util.inspect(loadConfig({})), /apiKey: ''/);
});

test('the signing key: COACH_SIGNING_KEY, else derived from the API key; mock in mock mode', () => {
  assert.equal(loadConfig({ ...LIVE }).signingKey, derivedKey(KEY));
  assert.equal(loadConfig({ COACH_API_KEY: 'another-key', COACH_BASE_URL: BASE_URL }).signingKey, derivedKey('another-key'));
  assert.equal(loadConfig({ ...LIVE, COACH_SIGNING_KEY: 'x'.repeat(32) }).signingKey, 'x'.repeat(32));
  assert.equal(loadConfig({ ...LIVE, COACH_SIGNING_KEY: 'y'.repeat(64) }).signingKey, 'y'.repeat(64));
  // Shorter than 32 characters: not usable, the derived key stands.
  assert.equal(loadConfig({ ...LIVE, COACH_SIGNING_KEY: 'x'.repeat(31) }).signingKey, derivedKey(KEY));
  assert.equal(loadConfig({ ...LIVE, COACH_SIGNING_KEY: 'short' }).signingKey, derivedKey(KEY));
  // Mock mode.
  assert.equal(loadConfig({ COACH_MOCK: '1' }).signingKey, 'mock');
  assert.equal(loadConfig({ ...LIVE, COACH_MOCK: '1' }).signingKey, 'mock');
  assert.equal(loadConfig({ ...LIVE, COACH_MOCK: '1', COACH_SIGNING_KEY: 'x'.repeat(32) }).signingKey, 'mock');
});

test('a flag is on only for the value 1; COACH_FREE_TEXT stays on only when unset or 1', () => {
  for (const name of ['COACH_ALLOW_NO_ORIGIN', 'COACH_PUBLIC', 'COACH_TRUST_PROXY']) {
    const field = { COACH_ALLOW_NO_ORIGIN: 'allowNoOrigin', COACH_PUBLIC: 'isPublic', COACH_TRUST_PROXY: 'trustProxy' }[name] ?? '';
    assert.equal(plain(loadConfig({ [name]: '1' }))[field], true, name);
    assert.equal(plain(loadConfig({ [name]: ' 1 ' }))[field], true, name);
    for (const value of ['0', '', 'true', 'yes', 'on', '2', '01', '1.0', 'TRUE']) {
      assert.equal(plain(loadConfig({ [name]: value }))[field], false, `${name}=${value}`);
    }
  }
  for (const value of ['true', 'yes', '2', '0']) assert.notEqual(loadConfig({ COACH_MOCK: value }).mode, 'mock', `COACH_MOCK=${value}`);

  // Free text is on by default, so this switch is read the other way round: on when unset, empty or 1 …
  assert.equal(loadConfig({}).freeText, true);
  assert.equal(loadConfig({ COACH_FREE_TEXT: undefined }).freeText, true);
  assert.equal(loadConfig({ COACH_FREE_TEXT: '' }).freeText, true);
  assert.equal(loadConfig({ COACH_FREE_TEXT: '  ' }).freeText, true);
  assert.equal(loadConfig({ COACH_FREE_TEXT: '1' }).freeText, true);
  assert.equal(loadConfig({ COACH_FREE_TEXT: ' 1 ' }).freeText, true);
  // … and off for 0 and for every other way a deployer may spell "off" (or anything else).
  for (const value of ['0', ' 0 ', 'false', 'FALSE', 'off', 'no', 'disabled', '00', '-1', 'true', 'yes', 'on', '2']) {
    assert.equal(loadConfig({ COACH_FREE_TEXT: value }).freeText, false, `COACH_FREE_TEXT=${value}`);
  }
  assert.equal(loadConfig({ COACH_FREE_TEXT: 0 }).freeText, false, 'a number is read as text');
});

test('a number that is not a whole number in range takes the default', () => {
  /** @type {[string, string, number][]} */
  const numbers = [
    ['COACH_MAX_TOKENS', 'maxTokens', 1200], ['COACH_MAX_TOKENS_OVER', 'maxTokensOver', 1600],
    ['COACH_UPSTREAM_TIMEOUT_MS', 'upstreamTimeoutMs', 60000], ['COACH_RATE_BURST', 'rateBurst', 20],
    ['COACH_RATE_PER_MIN', 'ratePerMin', 30], ['COACH_IP_DAILY', 'ipDaily', 600], ['COACH_GLOBAL_DAILY', 'globalDaily', 2000],
    ['COACH_MOCK_CHUNK_MS', 'mockChunkMs', 15],
  ];
  for (const [name, field, fallback] of numbers) {
    assert.equal(plain(loadConfig({ [name]: '77' }))[field], 77, name);
    assert.equal(plain(loadConfig({ [name]: ' 77 ' }))[field], 77, name);
    for (const value of ['abc', '-5', '1.5', '1e3', '0x10', '12px', 'NaN', 'Infinity', '9'.repeat(40), '+7', '７７']) {
      assert.equal(plain(loadConfig({ [name]: value }))[field], fallback, `${name}=${value}`);
    }
  }
  // Zero would switch a limit, a token budget or the timeout off: not accepted. A mock chunk delay of 0 is.
  for (const [name, field, fallback] of numbers.filter(([name]) => name !== 'COACH_MOCK_CHUNK_MS')) {
    assert.equal(plain(loadConfig({ [name]: '0' }))[field], fallback, `${name}=0`);
  }
  assert.equal(loadConfig({ COACH_MOCK_CHUNK_MS: '0' }).mockChunkMs, 0);
  // A delay no timer can hold.
  assert.equal(loadConfig({ COACH_UPSTREAM_TIMEOUT_MS: '2147483647' }).upstreamTimeoutMs, 2147483647);
  assert.equal(loadConfig({ COACH_UPSTREAM_TIMEOUT_MS: '2147483648' }).upstreamTimeoutMs, 60000);
  assert.equal(loadConfig({ COACH_MOCK_CHUNK_MS: '2147483648' }).mockChunkMs, 15);
});

test('COACH_ALLOWED_ORIGINS is a comma-separated list of exact origins', () => {
  assert.deepEqual(loadConfig({ COACH_ALLOWED_ORIGINS: 'https://yijian.example' }).allowedOrigins, ['https://yijian.example']);
  assert.deepEqual(loadConfig({ COACH_ALLOWED_ORIGINS: ' https://a.example ,https://b.example:8443,, ' }).allowedOrigins,
    ['https://a.example', 'https://b.example:8443']);
  // Entries are kept as written: matching is exact, nothing is normalised.
  assert.deepEqual(loadConfig({ COACH_ALLOWED_ORIGINS: 'https://A.example/' }).allowedOrigins, ['https://A.example/']);
  assert.deepEqual(loadConfig({ COACH_ALLOWED_ORIGINS: ' , ' }).allowedOrigins, []);
});

test('overrides win, and the derived fields follow them', () => {
  // The test helper of section 4.29 (`createCoachHandler(overrides)`) fixes a config this way.
  const mock = loadConfig({}, { mode: 'mock', allowNoOrigin: true, mockChunkMs: 0 });
  assert.equal(mock.mode, 'mock');
  assert.equal(mock.allowNoOrigin, true);
  assert.equal(mock.mockChunkMs, 0);
  assert.equal(mock.signingKey, 'mock', 'the mock signing key follows the overridden mode');
  assert.equal(mock.rateBurst, 20, 'other fields keep their value');

  const live = loadConfig({}, { apiKey: KEY, baseUrl: BASE_URL, model: 'vendor/model-b' });
  assert.equal(live.mode, 'live');
  assert.equal(live.apiKey, KEY);
  assert.equal(live.signingKey, derivedKey(KEY));
  assert.equal(live.quickModel, 'vendor/model-b');

  // An override beats the environment; an explicit derived field beats the derivation.
  const both = loadConfig({ ...LIVE, COACH_RATE_BURST: '5', COACH_MOCK: '1', COACH_ALLOWED_ORIGINS: 'https://a.example' },
    { rateBurst: 9, mode: 'live', signingKey: 'q'.repeat(40), quickModel: 'vendor/quick', reasoningEffort: null,
      allowedOrigins: ['https://b.example'], freeText: false, isPublic: true });
  assert.equal(both.rateBurst, 9);
  assert.equal(both.mode, 'live');
  assert.equal(both.signingKey, 'q'.repeat(40));
  assert.equal(both.quickModel, 'vendor/quick');
  assert.equal(both.reasoningEffort, null);
  assert.deepEqual(both.allowedOrigins, ['https://b.example']);
  assert.equal(both.freeText, false);
  assert.equal(both.isPublic, true);

  // undefined is "not given"; the caller's array is copied; an earlier config can be passed on with its secrets.
  assert.equal(loadConfig({ ...LIVE }, { rateBurst: undefined, apiKey: undefined }).rateBurst, 20);
  assert.equal(loadConfig({ ...LIVE }, { apiKey: undefined }).apiKey, KEY);
  const origins = ['https://b.example'];
  const copied = loadConfig({}, { allowedOrigins: origins });
  assert.notEqual(copied.allowedOrigins, origins);
  const again = loadConfig({}, loadConfig({ ...LIVE, COACH_SIGNING_KEY: 'x'.repeat(32) }));
  assert.equal(again.apiKey, KEY);
  assert.equal(again.signingKey, 'x'.repeat(32));
  assert.equal(again.mode, 'live');
});

test('loadConfig never throws', () => {
  const hostile = new Proxy({}, { get() { throw new Error('boom'); }, has() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
  const environments = [undefined, null, 'COACH_MOCK=1', 42, [], hostile,
    { COACH_MAX_TOKENS: 900, COACH_MOCK: 1, COACH_API_KEY: { toString() { throw new Error('boom'); } }, COACH_ALLOWED_ORIGINS: ['a', 'b'] }];
  const overrideSets = [undefined, null, 'x', 7, { allowedOrigins: 'https://a.example' }, { allowedOrigins: null }];
  for (const env of environments) {
    for (const overrides of overrideSets) {
      const config = loadConfig(env, overrides);
      assert.ok(['live', 'mock', 'off'].includes(config.mode));
      assert.ok(Array.isArray(config.allowedOrigins));
      assert.equal(typeof config.signingKey, 'string');
    }
  }
  // Nothing usable in the environment: the defaults.
  assert.deepEqual(plain(loadConfig(hostile)), plain(loadConfig({})));
  assert.deepEqual(plain(loadConfig(undefined)), plain(loadConfig({})));
  // Overrides that cannot be read: the defaults again, not an exception.
  const badOverrides = { get mode() { throw new Error('boom'); } };
  assert.deepEqual(plain(loadConfig({ COACH_MOCK: '1' }, badOverrides)), plain(loadConfig({})));
  assert.deepEqual(plain(loadConfig({}, hostile)), plain(loadConfig({})));
  // Values of another type are read as text.
  assert.equal(loadConfig({ COACH_MAX_TOKENS: 900 }).maxTokens, 900);
  assert.equal(loadConfig({ COACH_MOCK: 1 }).mode, 'mock');
});
