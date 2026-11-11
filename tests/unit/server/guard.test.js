// tests/unit/server/guard.test.js (S1) — contract sections 4.29, 7.9, 7.10, 7.13 and 14.3.
// Time is the test runner's mocked Date, so the rate-limit tests are exact and take no real time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockList, isIP } from 'node:net';

import { createGuard, memoryStore, isPrivateAddress } from '../../../server/guard.js';
import { loadConfig } from '../../../server/config.js';

const LAN_HOST = '192.168.1.50:5173';
const LAN_ORIGIN = 'http://192.168.1.50:5173';
/** 2026-01-15 10:00:00 UTC */
const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);
const NEXT_MIDNIGHT = Date.UTC(2026, 0, 16, 0, 0, 0);
const DAY_MS = 86400000;

/** A small seeded generator (mulberry32), so the generated cases are the same on every run. @param {number} seed */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {Record<string, string>} [env] */
const guardFor = (env = {}) => createGuard(loadConfig(env));

/**
 * Calls take(ip) `times` times and returns how many were accepted.
 * @param {ReturnType<typeof createGuard>} guard @param {string} ip @param {number} times
 */
async function accepted(guard, ip, times) {
  let ok = 0;
  for (let k = 0; k < times; k++) if ((await guard.take(ip)).ok) ok++;
  return ok;
}

test('same-origin by host is accepted for a LAN address', () => {
  const guard = guardFor();                          // no allowlist, no COACH_ALLOW_NO_ORIGIN
  assert.equal(guard.checkOrigin(LAN_ORIGIN, LAN_HOST), true);
  // Whatever the address: another private range, a host name, an IPv6 literal, the default port, https.
  assert.equal(guard.checkOrigin('http://10.0.0.7:5173', '10.0.0.7:5173'), true);
  assert.equal(guard.checkOrigin('http://desktop-pc:5173', 'desktop-pc:5173'), true);
  assert.equal(guard.checkOrigin('http://[fe80::1c2d:3e4f:5a6b:7c8d]:5173', '[fe80::1c2d:3e4f:5a6b:7c8d]:5173'), true);
  assert.equal(guard.checkOrigin('http://192.168.1.50', '192.168.1.50'), true);
  assert.equal(guard.checkOrigin('https://chess.example', 'chess.example'), true);
  assert.equal(guard.checkOrigin('http://127.0.0.1:5173', '127.0.0.1:5173'), true);

  // The same machine under another port or another name is another origin.
  assert.equal(guard.checkOrigin('http://192.168.1.50:8080', LAN_HOST), false);
  assert.equal(guard.checkOrigin('http://192.168.1.50', LAN_HOST), false);
  assert.equal(guard.checkOrigin('http://192.168.1.51:5173', LAN_HOST), false);
  assert.equal(guard.checkOrigin('http://localhost:5173', '127.0.0.1:5173'), false);
  // Without a Host header nothing is same-origin.
  assert.equal(guard.checkOrigin(LAN_ORIGIN, null), false);
  assert.equal(guard.checkOrigin(LAN_ORIGIN, ''), false);
  // Not even an origin that has no host itself: its empty host must not equal an empty Host header.
  for (const hostless of ['file:///C:/chess/index.html', 'about:blank', 'data:text/html,x', 'x:y']) {
    assert.equal(new URL(hostless).host, '', hostless);
    assert.equal(guard.checkOrigin(hostless, ''), false, hostless);
    assert.equal(guard.checkOrigin(hostless, null), false, hostless);
  }
});

test('the Origin and Host headers of a fetch Request go through the guard as the handler reads them', () => {
  const guard = guardFor();
  /** @param {Record<string, string>} headers  the two arguments of checkOrigin / corsHeaders, read as section 7.10 does */
  const read = (headers) => {
    const request = new Request('http://192.168.1.50:5173/api/coach', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    return /** @type {[string|null, string|null]} */ ([request.headers.get('origin'), request.headers.get('host')]);
  };
  assert.deepEqual(read({ Origin: LAN_ORIGIN, Host: LAN_HOST }), [LAN_ORIGIN, LAN_HOST]);
  assert.equal(guard.checkOrigin(...read({ Origin: LAN_ORIGIN, Host: LAN_HOST })), true);
  assert.equal(guard.checkOrigin(...read({ Origin: 'https://evil.example', Host: LAN_HOST })), false);
  assert.equal(guard.checkOrigin(...read({ Origin: 'null', Host: LAN_HOST })), false);
  // A missing header reads as null, which is "absent" for the guard.
  assert.deepEqual(read({ Host: LAN_HOST }), [null, LAN_HOST]);
  assert.equal(guard.checkOrigin(...read({ Host: LAN_HOST })), false);
  assert.equal(guardFor({ COACH_ALLOW_NO_ORIGIN: '1' }).checkOrigin(...read({ Host: LAN_HOST })), true);
  assert.equal(guard.checkOrigin(...read({ Origin: LAN_ORIGIN })), false, 'no Host header');
  // The CORS headers of an accepted and of a refused origin both make a valid Response.
  /** @type {Record<string, string>[]} */
  const cases = [{ Origin: LAN_ORIGIN, Host: LAN_HOST }, { Origin: 'https://evil.example', Host: LAN_HOST }, { Host: LAN_HOST }];
  for (const headers of cases) {
    const response = new Response(null, { status: 204, headers: guard.corsHeaders(...read(headers)) });
    assert.equal(response.headers.get('vary'), 'Origin');
    assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin === LAN_ORIGIN ? LAN_ORIGIN : null);
  }
});

test('the Host header is compared without regard to letter case', () => {
  const guard = guardFor();
  assert.equal(guard.checkOrigin('http://desktop-pc:5173', 'DESKTOP-PC:5173'), true);
  assert.equal(guard.checkOrigin('http://DESKTOP-PC:5173', 'desktop-pc:5173'), true);
  assert.equal(guard.checkOrigin('http://desktop-pc:5173', 'OTHER-PC:5173'), false);
});

test('a foreign origin is rejected unless allowlisted', () => {
  const plain = guardFor();
  assert.equal(plain.checkOrigin('https://evil.example', LAN_HOST), false);
  assert.equal(plain.checkOrigin('http://evil.example:5173', LAN_HOST), false);
  // Strings that only contain the host, or are not origins at all.
  assert.equal(plain.checkOrigin('http://192.168.1.50:5173.evil.example', LAN_HOST), false);
  assert.equal(plain.checkOrigin('http://evil.example/192.168.1.50:5173', LAN_HOST), false);
  assert.equal(plain.checkOrigin('http://evil.example?h=192.168.1.50:5173', LAN_HOST), false);
  assert.equal(plain.checkOrigin('http://evil.example#192.168.1.50:5173', LAN_HOST), false);
  assert.equal(plain.checkOrigin('http://192.168.1.50:5173@evil.example', LAN_HOST), false);
  assert.equal(plain.checkOrigin('null', LAN_HOST), false);
  assert.equal(plain.checkOrigin('', LAN_HOST), false);
  assert.equal(plain.checkOrigin(LAN_HOST, LAN_HOST), false, 'a bare host is not an origin');
  assert.equal(plain.checkOrigin('*', LAN_HOST), false);

  const listed = guardFor({ COACH_ALLOWED_ORIGINS: 'https://yijian.example, https://pages.example:8443' });
  assert.equal(listed.checkOrigin('https://yijian.example', 'proxy.example'), true);
  assert.equal(listed.checkOrigin('https://pages.example:8443', 'proxy.example'), true);
  assert.equal(listed.checkOrigin('https://yijian.example', null), true, 'an allowlisted origin needs no Host header');
  // Exact match only.
  assert.equal(listed.checkOrigin('https://yijian.example/', 'proxy.example'), false);
  assert.equal(listed.checkOrigin('http://yijian.example', 'proxy.example'), false);
  assert.equal(listed.checkOrigin('https://yijian.example:444', 'proxy.example'), false);
  assert.equal(listed.checkOrigin('https://sub.yijian.example', 'proxy.example'), false);
  assert.equal(listed.checkOrigin('https://yijian.example.evil.example', 'proxy.example'), false);
  assert.equal(listed.checkOrigin('https://pages.example', 'proxy.example'), false);
  assert.equal(listed.checkOrigin('https://evil.example', 'proxy.example'), false);
  // The allowlist adds origins; same-origin requests still need no entry.
  assert.equal(listed.checkOrigin(LAN_ORIGIN, LAN_HOST), true);
});

test('a request without an Origin header is rejected unless COACH_ALLOW_NO_ORIGIN=1', () => {
  assert.equal(guardFor().checkOrigin(null, LAN_HOST), false);
  assert.equal(guardFor({ COACH_ALLOW_NO_ORIGIN: '0' }).checkOrigin(null, LAN_HOST), false);
  const lenient = guardFor({ COACH_ALLOW_NO_ORIGIN: '1' });
  assert.equal(lenient.checkOrigin(null, LAN_HOST), true);
  assert.equal(lenient.checkOrigin(null, null), true);
  // The switch is about a missing header only: a foreign origin stays foreign.
  assert.equal(lenient.checkOrigin('https://evil.example', LAN_HOST), false);
  assert.equal(lenient.checkOrigin('null', LAN_HOST), false);
  assert.equal(lenient.checkOrigin('', LAN_HOST), false);
});

test('corsHeaders: Allow-Origin only for allowed origins, Vary: Origin always', () => {
  const guard = guardFor({ COACH_ALLOWED_ORIGINS: 'https://yijian.example', COACH_ALLOW_NO_ORIGIN: '1' });
  /** @param {Record<string, string>} headers */
  const read = (headers) => new Response(null, { status: 204, headers }).headers;      // as the handler uses them

  const same = read(guard.corsHeaders(LAN_ORIGIN, LAN_HOST));
  assert.equal(same.get('access-control-allow-origin'), LAN_ORIGIN);
  assert.equal(same.get('vary'), 'Origin');

  const listed = read(guard.corsHeaders('https://yijian.example', 'proxy.example'));
  assert.equal(listed.get('access-control-allow-origin'), 'https://yijian.example');
  assert.equal(listed.get('vary'), 'Origin');
  // What the preflight of a JSON POST needs.
  assert.ok(listed.get('access-control-allow-methods')?.split(/,\s*/).includes('POST'));
  assert.ok(listed.get('access-control-allow-methods')?.split(/,\s*/).includes('GET'));
  assert.equal(listed.get('access-control-allow-headers')?.toLowerCase(), 'content-type');
  assert.equal(listed.get('access-control-allow-credentials'), null);

  for (const [origin, host] of [['https://evil.example', LAN_HOST], ['null', LAN_HOST], ['', LAN_HOST], [null, LAN_HOST], [LAN_ORIGIN, null]]) {
    const refused = read(guard.corsHeaders(origin, host));
    assert.equal(refused.get('access-control-allow-origin'), null, `origin ${origin}`);
    assert.equal(refused.get('access-control-allow-methods'), null);
    assert.equal(refused.get('access-control-allow-headers'), null);
    assert.equal(refused.get('vary'), 'Origin');
  }
  // Never a wildcard.
  assert.notEqual(same.get('access-control-allow-origin'), '*');
  assert.notEqual(listed.get('access-control-allow-origin'), '*');
});

test('private and loopback peers pass; a public peer is rejected unless COACH_PUBLIC=1', () => {
  const guard = guardFor();
  for (const ip of ['127.0.0.1', '::1', '192.168.1.23', '10.1.2.3', '172.20.0.9', '169.254.10.20',
    '::ffff:192.168.1.23', '::ffff:127.0.0.1', 'fe80::1c2d:3e4f:5a6b:7c8d', 'fd12:3456:789a::1']) {
    assert.equal(guard.checkPeer(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '203.0.113.7', '172.32.0.1', '192.169.1.1', '::ffff:8.8.8.8', '2001:4860:4860::8888', '', 'localhost']) {
    assert.equal(guard.checkPeer(ip), false, ip);
  }
  assert.equal(guard.checkPeer(undefined), true, 'no peer address (serverless)');
  assert.equal(guardFor({ COACH_PUBLIC: '0' }).checkPeer('8.8.8.8'), false);

  const open = guardFor({ COACH_PUBLIC: '1' });
  for (const ip of ['8.8.8.8', '203.0.113.7', '2001:4860:4860::8888', '192.168.1.23', '127.0.0.1']) {
    assert.equal(open.checkPeer(ip), true, ip);
  }
  assert.equal(open.checkPeer(undefined), true);
});

test('token bucket and daily limits', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const tick = (/** @type {number} */ ms) => t.mock.timers.tick(ms);

  await t.test('the default bucket: a burst of 20, then 30 a minute', async () => {
    const guard = guardFor();
    const ip = '192.168.1.23';
    for (let k = 1; k <= 20; k++) assert.deepEqual(await guard.take(ip), { ok: true }, `request ${k}`);
    // Empty. One token takes 60 / 30 = 2 seconds.
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: 2 });
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: 2 }, 'a refused request costs nothing');
    // Another address has its own bucket.
    assert.deepEqual(await guard.take('192.168.1.24'), { ok: true });

    // retryAfter is whole seconds, rounded up: whoever waits that long is served.
    tick(500);
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: 2 }, '1.5 s to go');
    tick(500);
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: 1 });
    tick(999);
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: 1 }, '1 ms to go');
    tick(1);
    assert.deepEqual(await guard.take(ip), { ok: true }, 'exactly two seconds after the bucket ran empty');
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: 2 });

    // 30 requests a minute: asking twice a second for one minute, exactly 30 are served.
    tick(2000);
    let served = 0;
    for (let second = 0; second < 60; second++) {
      served += await accepted(guard, ip, 2);
      tick(1000);
    }
    assert.equal(served, 30);

    // A long pause refills the bucket to the burst and no further.
    tick(10 * 60 * 1000);
    assert.equal(await accepted(guard, ip, 50), 20);
  });

  await t.test('the default daily limits: 600 an address, 2000 in total, until the next UTC midnight', async () => {
    t.mock.timers.setTime(T0);
    const guard = guardFor();
    const ip = '192.168.1.23';
    // One request every 2 seconds never empties the bucket: the 600 are served in 20 minutes.
    for (let k = 1; k <= 600; k++) {
      assert.equal((await guard.take(ip)).ok, true, `request ${k}`);
      tick(2000);
    }
    const afterIp = Date.now();
    assert.equal(afterIp, T0 + 600 * 2000);
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: (NEXT_MIDNIGHT - afterIp) / 1000 });
    tick(60 * 60 * 1000);                              // the bucket is full again, the day is not over
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: (NEXT_MIDNIGHT - Date.now()) / 1000 });

    // 70 other addresses use their burst of 20: 600 + 1400 = 2000.
    for (let n = 1; n <= 70; n++) assert.equal(await accepted(guard, `10.0.1.${n}`, 20), 20, `address ${n}`);
    const afterAll = Date.now();
    // The total is used up: a new address and a known one with requests left are both refused.
    assert.deepEqual(await guard.take('10.0.2.1'), { ok: false, retryAfter: (NEXT_MIDNIGHT - afterAll) / 1000 });
    tick(60 * 1000);
    assert.deepEqual(await guard.take('10.0.1.1'), { ok: false, retryAfter: (NEXT_MIDNIGHT - Date.now()) / 1000 });

    // One millisecond before midnight: still refused, retryAfter rounds up to 1. At midnight both counts start again.
    t.mock.timers.setTime(NEXT_MIDNIGHT - 1);
    assert.deepEqual(await guard.take(ip), { ok: false, retryAfter: 1 });
    t.mock.timers.setTime(NEXT_MIDNIGHT);
    assert.deepEqual(await guard.take(ip), { ok: true });
    assert.deepEqual(await guard.take('10.0.2.1'), { ok: true });
  });

  await t.test('limits from the environment', async () => {
    t.mock.timers.setTime(T0);
    const guard = guardFor({ COACH_RATE_BURST: '3', COACH_RATE_PER_MIN: '6', COACH_IP_DAILY: '5', COACH_GLOBAL_DAILY: '7' });
    assert.equal(await accepted(guard, '10.0.0.1', 4), 3);                          // burst 3
    assert.deepEqual(await guard.take('10.0.0.1'), { ok: false, retryAfter: 10 });  // 60 / 6 = 10 s a token
    tick(20000);
    assert.equal(await accepted(guard, '10.0.0.1', 3), 2);                          // two tokens came back: 5 today
    tick(60000);
    assert.deepEqual(await guard.take('10.0.0.1'), { ok: false, retryAfter: (NEXT_MIDNIGHT - Date.now()) / 1000 }, 'address limit 5');
    assert.equal(await accepted(guard, '10.0.0.2', 3), 2, 'total limit 7');
    assert.deepEqual(await guard.take('10.0.0.3'), { ok: false, retryAfter: (NEXT_MIDNIGHT - Date.now()) / 1000 });
  });

  await t.test('midnight starts the counts again but does not refill a bucket', async () => {
    t.mock.timers.setTime(NEXT_MIDNIGHT - 1000);
    const guard = guardFor();
    assert.equal(await accepted(guard, '10.0.0.1', 25), 20);
    t.mock.timers.setTime(NEXT_MIDNIGHT);
    assert.deepEqual(await guard.take('10.0.0.1'), { ok: false, retryAfter: 1 });   // half a token after one second
    tick(1000);
    assert.deepEqual(await guard.take('10.0.0.1'), { ok: true });
  });

  await t.test('a clock that is set back does not refill a bucket', async () => {
    t.mock.timers.setTime(T0 + 2 * 3600 * 1000);
    const guard = guardFor();
    assert.equal(await accepted(guard, '10.0.0.1', 25), 20);
    t.mock.timers.setTime(T0 + 3600 * 1000);                                        // one hour back, same UTC day
    assert.deepEqual(await guard.take('10.0.0.1'), { ok: false, retryAfter: 2 });
    tick(2000);                                                                     // from there on time counts again
    assert.deepEqual(await guard.take('10.0.0.1'), { ok: true });
    assert.deepEqual(await guard.take('10.0.0.1'), { ok: false, retryAfter: 2 });
  });

  await t.test('one address in several spellings is one caller; a missing address shares one bucket', async () => {
    t.mock.timers.setTime(T0);
    const guard = guardFor({ COACH_RATE_BURST: '2' });
    assert.deepEqual(await guard.take('192.168.1.23'), { ok: true });
    assert.deepEqual(await guard.take('::ffff:192.168.1.23'), { ok: true });
    assert.equal((await guard.take('::ffff:c0a8:117')).ok, false);                  // 192.168.1.23 again
    assert.equal((await guard.take('192.168.1.23')).ok, false);

    assert.deepEqual(await guard.take('fe80::1'), { ok: true });
    assert.deepEqual(await guard.take('FE80:0:0:0:0:0:0:1'), { ok: true });
    assert.equal((await guard.take('fe80::1%eth0')).ok, false);

    const unknown = [undefined, '', 'not-an-address', null];
    assert.deepEqual(await guard.take(unknown[0]), { ok: true });
    assert.deepEqual(await guard.take(unknown[1]), { ok: true });
    assert.equal((await guard.take(unknown[2])).ok, false);
    assert.equal((await guard.take(unknown[3])).ok, false);
  });

  await t.test('two guards do not share a default store; a store handed to both is shared', async () => {
    t.mock.timers.setTime(T0);
    const config = loadConfig({ COACH_RATE_BURST: '1' });
    const a = createGuard(config), b = createGuard(config);
    assert.deepEqual(await a.take('10.0.0.1'), { ok: true });
    assert.deepEqual(await b.take('10.0.0.1'), { ok: true });

    const store = memoryStore();
    const c = createGuard(config, store), d = createGuard(config, store);
    assert.deepEqual(await c.take('10.0.0.1'), { ok: true });
    assert.equal((await d.take('10.0.0.1')).ok, false);
  });
});

test('random traffic over several days is served exactly as an independent model of the limits allows', () => {
  // The model keeps no bucket. It decides from the list of served requests alone:
  //   tokens = min over j of (burst - j) + perMin * (minutes since the j-th most recent served request), at most burst;
  //   served when tokens >= 1 and both counts of the request's UTC day are below their limit.
  /** @param {{burst:number, perMin:number, ipDaily:number, globalDaily:number}} limits */
  const model = (limits) => {
    /** @type {Map<string, number[]>} */
    const servedAt = new Map();
    /** @type {number[]} */
    const allServed = [];
    return (/** @type {string} */ key, /** @type {number} */ now) => {
      const sameDay = (/** @type {number} */ at) => Math.floor(at / DAY_MS) === Math.floor(now / DAY_MS);
      const mine = servedAt.get(key) ?? [];
      let credit = limits.burst * 60000;                              // in units of 1/60000 token, to stay in whole numbers
      for (let j = 1; j <= mine.length; j++) {
        credit = Math.min(credit, (limits.burst - j) * 60000 + limits.perMin * (now - mine[mine.length - j]));
      }
      const daily = !(allServed.filter(sameDay).length < limits.globalDaily && mine.filter(sameDay).length < limits.ipDaily);
      const ok = !daily && credit >= 60000;
      if (ok) {
        servedAt.set(key, [...mine, now]);
        allServed.push(now);
      }
      return { ok, daily };
    };
  };

  let served = 0, refusedByBucket = 0, refusedByDay = 0, retryChecks = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = seeded(seed);
    const whole = (/** @type {number} */ below) => Math.floor(rnd() * below);
    const limits = { burst: 1 + whole(6), perMin: 1 + whole(40), ipDaily: 5 + whole(60), globalDaily: 20 + whole(120) };
    const keys = Array.from({ length: 1 + whole(5) }, (_, k) => `10.0.0.${k + 1}`);
    // Bursts, pauses of seconds and minutes, and now and then a jump of up to 30 hours; the start is close to midnight.
    /** @type {{key:string, now:number}[]} */
    const schedule = [];
    let now = Date.UTC(2026, 0, 15, 23, 50) + whole(600000);
    for (let k = 0; k < 300; k++) {
      const r = rnd();
      now += r < 0.5 ? whole(400) : r < 0.85 ? whole(5000) : r < 0.97 ? whole(120000) : whole(30 * 3600000);
      schedule.push({ key: keys[whole(keys.length)], now });
    }

    const store = memoryStore(), expect = model(limits);
    const results = schedule.map(({ key, now: at }, k) => {
      const got = /** @type {{ok:boolean, retryAfter?:number}} */ (store.take(key, at, limits));
      const want = expect(key, at);
      assert.equal(got.ok, want.ok, `seed ${seed}, request ${k} (${key} at ${new Date(at).toISOString()}, limits ${JSON.stringify(limits)})`);
      if (got.ok) served++;
      else {
        assert.ok(Number.isInteger(got.retryAfter) && Number(got.retryAfter) >= 1, `seed ${seed}, request ${k}: retryAfter ${got.retryAfter}`);
        if (want.daily) refusedByDay++; else refusedByBucket++;
        // A daily refusal points at the next UTC midnight.
        if (want.daily) assert.equal(got.retryAfter, Math.ceil(((Math.floor(at / DAY_MS) + 1) * DAY_MS - at) / 1000) || 1);
      }
      return { got, want };
    });

    // retryAfter of a bucket refusal is exact: the same caller is served that many seconds later (when the day's
    // counts allow) and not one second earlier. Checked on a replay of the traffic up to the refused request.
    for (let k = 0; k < schedule.length; k += 9) {
      const { got, want } = results[k];
      if (got.ok || want.daily) continue;
      const waits = /** @type {[number, boolean][]} */ ([[Number(got.retryAfter), true], [Number(got.retryAfter) - 1, false]]);
      for (const [seconds, servedThen] of waits) {
        if (seconds === 0) continue;
        const replay = memoryStore(), replayModel = model(limits);
        for (const past of schedule.slice(0, k + 1)) {
          replay.take(past.key, past.now, limits);
          replayModel(past.key, past.now);
        }
        const at = schedule[k].now + seconds * 1000;
        const probe = /** @type {{ok:boolean}} */ (replay.take(schedule[k].key, at, limits));
        const wanted = replayModel(schedule[k].key, at);
        assert.equal(probe.ok, wanted.ok, `seed ${seed}, request ${k}, ${seconds} s later`);
        if (!wanted.daily) assert.equal(probe.ok, servedThen, `seed ${seed}, request ${k}: retryAfter ${got.retryAfter}, asked ${seconds} s later`);
        retryChecks++;
      }
    }
  }
  // The generated traffic really exercised every outcome.
  assert.ok(served > 2000 && refusedByBucket > 1000 && refusedByDay > 1000 && retryChecks > 200,
    JSON.stringify({ served, refusedByBucket, refusedByDay, retryChecks }));
});

test('the store keeps an entry only for an address it served; idle ones are dropped at midnight', () => {
  const limits = { burst: 20, perMin: 30, ipDaily: 600, globalDaily: 100 };
  const store = memoryStore();
  assert.equal(store.size, 0);

  // 100 addresses use up the day's total: one entry each.
  for (let n = 0; n < 100; n++) assert.deepEqual(store.take(`10.0.${n >> 8}.${n & 255}`, T0 + n, limits), { ok: true });
  assert.equal(store.size, 100);
  // Refused callers leave no trace, however many addresses they come from.
  for (let n = 0; n < 5000; n++) assert.equal(/** @type {{ok:boolean}} */ (store.take(`172.16.${n >> 8}.${n & 255}`, T0 + 1000 + n, limits)).ok, false);
  assert.equal(store.size, 100);

  // One of them is busy right up to midnight: its bucket is not full again when the day turns.
  const busy = '10.0.0.7';
  const day2 = memoryStore();
  for (let n = 0; n < 50; n++) day2.take(`10.0.0.${n}`, T0 + n, limits);
  for (let k = 0; k < 20; k++) assert.deepEqual(day2.take(busy, NEXT_MIDNIGHT - 1000, limits), { ok: true });
  assert.equal(day2.size, 50);
  // The first request of the new day (from a new address) drops the 49 idle ones and keeps the busy one.
  assert.deepEqual(day2.take('192.168.1.23', NEXT_MIDNIGHT, limits), { ok: true });
  assert.equal(day2.size, 2);
  // The kept bucket was not refilled by the turn of the day: it was emptied one second ago and holds half a token.
  assert.deepEqual(day2.take(busy, NEXT_MIDNIGHT, limits), { ok: false, retryAfter: 1 });
  // A whole idle day later nothing of yesterday is left.
  assert.deepEqual(day2.take('192.168.1.24', NEXT_MIDNIGHT + DAY_MS, limits), { ok: true });
  assert.equal(day2.size, 1);
});

test('a limit that is zero or unusable never lets a request through', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const untilMidnight = (NEXT_MIDNIGHT - T0) / 1000;

  // Zero means "no request": refused from the first one on (the environment cannot set it, an override can).
  assert.deepEqual(await createGuard(loadConfig({}, { rateBurst: 0 })).take('10.0.0.1'), { ok: false, retryAfter: 2 });
  assert.deepEqual(await createGuard(loadConfig({}, { ipDaily: 0 })).take('10.0.0.1'), { ok: false, retryAfter: untilMidnight });
  assert.deepEqual(await createGuard(loadConfig({}, { globalDaily: 0 })).take('10.0.0.1'), { ok: false, retryAfter: untilMidnight });
  const noRefill = createGuard(loadConfig({}, { rateBurst: 2, ratePerMin: 0 }));
  assert.equal(await accepted(noRefill, '10.0.0.1', 3), 2);
  t.mock.timers.tick(3600 * 1000);
  assert.deepEqual(await noRefill.take('10.0.0.1'), { ok: false, retryAfter: untilMidnight - 3600 });
  t.mock.timers.setTime(T0);

  // A config whose limits are not numbers >= 0 does not give a guard at all.
  const good = loadConfig({});
  for (const field of ['rateBurst', 'ratePerMin', 'ipDaily', 'globalDaily']) {
    for (const value of [undefined, null, Number.NaN, -1, Number.POSITIVE_INFINITY, '20']) {
      const broken = { ...good, apiKey: '', signingKey: 'k', [field]: value };
      assert.throws(() => createGuard(broken), TypeError, `${field}=${String(value)}`);
    }
  }
  assert.throws(() => createGuard({ allowedOrigins: [], allowNoOrigin: true }), TypeError);

  // The store itself refuses when it is asked with limits that are not numbers.
  for (const field of ['burst', 'perMin', 'ipDaily', 'globalDaily']) {
    for (const value of [undefined, Number.NaN]) {
      const limits = { burst: 20, perMin: 30, ipDaily: 600, globalDaily: 2000, [field]: value };
      const store = memoryStore();
      const results = [await store.take('10.0.0.1', T0, limits), await store.take('10.0.0.1', T0 + 1000, limits)];
      if (field === 'perMin') {
        // The first sight of an address uses the burst; without a refill rate nothing comes back.
        assert.equal((await store.take('10.0.0.1', T0 + 5000, limits)).ok, false, `${field}=${String(value)}`);
      } else {
        assert.deepEqual(results.map((r) => r.ok), [false, false], `${field}=${String(value)}`);
      }
    }
  }
});

test('take asks the store with the canonical address, the time and the four limits', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  /** @type {{key:string, now:number, limits:object}[]} */
  const calls = [];
  const store = {
    /** @param {string} key @param {number} now @param {{burst:number, perMin:number, ipDaily:number, globalDaily:number}} limits */
    async take(key, now, limits) {
      calls.push({ key, now, limits: { ...limits } });
      return /** @type {{ok:false, retryAfter:number}} */ ({ ok: false, retryAfter: 7 });
    },
  };
  const guard = createGuard(loadConfig({}), store);
  assert.deepEqual(await guard.take('::ffff:192.168.1.23'), { ok: false, retryAfter: 7 });
  assert.deepEqual(calls, [{ key: '192.168.1.23', now: T0, limits: { burst: 20, perMin: 30, ipDaily: 600, globalDaily: 2000 } }]);

  // A store that fails makes take reject: the handler must not reach the provider.
  const broken = createGuard(loadConfig({}), { take() { throw new Error('store down'); } });
  await assert.rejects(broken.take('192.168.1.23'), /store down/);
});

test('isPrivateAddress table', () => {
  /** @type {[string, boolean][]} */
  const table = [
    // loopback
    ['127.0.0.1', true], ['127.255.255.254', true], ['127.0.0.53', true],
    // 10/8
    ['10.0.0.0', true], ['10.255.255.255', true], ['9.255.255.255', false], ['11.0.0.0', false],
    // 172.16/12
    ['172.16.0.0', true], ['172.31.255.255', true], ['172.15.255.255', false], ['172.32.0.0', false],
    // 192.168/16
    ['192.168.0.0', true], ['192.168.255.255', true], ['192.167.255.255', false], ['192.169.0.0', false], ['193.168.1.1', false],
    // 169.254/16
    ['169.254.0.0', true], ['169.254.255.255', true], ['169.253.255.255', false], ['169.255.0.0', false],
    // public IPv4
    ['8.8.8.8', false], ['1.1.1.1', false], ['203.0.113.7', false], ['100.64.0.1', false], ['0.0.0.0', false], ['255.255.255.255', false],
    // ::1 in its spellings
    ['::1', true], ['0:0:0:0:0:0:0:1', true], ['0000:0000:0000:0000:0000:0000:0000:0001', true], ['::2', false], ['::', false], ['1::1', false],
    // fc00::/7
    ['fc00::', true], ['fc00::1', true], ['fd12:3456:789a::1', true], ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true], ['FD00::1', true],
    ['fbff::1', false], ['fe00::1', false],
    // fe80::/10
    ['fe80::', true], ['fe80::1c2d:3e4f:5a6b:7c8d', true], ['febf:ffff::1', true], ['FE80::1', true], ['fe80::1%eth0', true], ['fe80::1%12', true], ['fe80::1%eth0.100', true],
    ['fe7f::1', false], ['fec0::1', false], ['ff02::1', false],
    // public IPv6
    ['2001:4860:4860::8888', false], ['2606:4700:4700::1111', false], ['2001:db8::1', false],
    // IPv4-mapped forms
    ['::ffff:192.168.1.5', true], ['::ffff:10.0.0.1', true], ['::ffff:172.16.5.4', true], ['::ffff:169.254.1.1', true], ['::ffff:127.0.0.1', true],
    ['::FFFF:192.168.1.5', true], ['::ffff:c0a8:105', true], ['::ffff:7f00:1', true], ['0:0:0:0:0:ffff:192.168.1.5', true],
    ['0000:0000:0000:0000:0000:ffff:0a00:0001', true],
    ['::ffff:8.8.8.8', false], ['::ffff:808:808', false], ['::ffff:172.32.0.1', false], ['::ffff:1.2.3.4', false],
    // look-alikes that are not IPv4-mapped
    ['::192.168.1.5', false], ['::ffff:0:192.168.1.5', false], ['64:ff9b::192.168.1.5', false], ['::fffe:192.168.1.5', false],
    // not literal addresses
    ['', false], ['localhost', false], ['10.0.0.1 ', false], [' 10.0.0.1', false], ['10.0.0.1:5173', false], ['[::1]', false], ['[::1]:5173', false],
    ['10.0.0', false], ['10.0.0.1.5', false], ['010.0.0.1', false], ['10.0.0.256', false], ['127.1', false], ['2130706433', false], ['0x7f.0.0.1', false],
    ['192.168.1.5.evil.example', false], ['10.evil.example', false], ['fe80', false], ['fe80::1%', false], ['::ffff:192.168.1', false], ['fc00:::1', false],
  ];
  for (const [ip, expected] of table) assert.equal(isPrivateAddress(ip), expected, JSON.stringify(ip));

  const notStrings = [undefined, null, 0, 2130706433, {}, ['127.0.0.1'], true];
  for (const value of notStrings) assert.equal(isPrivateAddress(value), false);
});

test('isPrivateAddress agrees with net.BlockList on generated addresses', () => {
  // The ranges of section 4.29 in Node's own matcher, which also reads an IPv4-mapped IPv6 address as IPv4.
  const ranges = new BlockList();
  ranges.addSubnet('127.0.0.0', 8, 'ipv4');
  ranges.addSubnet('10.0.0.0', 8, 'ipv4');
  ranges.addSubnet('172.16.0.0', 12, 'ipv4');
  ranges.addSubnet('192.168.0.0', 16, 'ipv4');
  ranges.addSubnet('169.254.0.0', 16, 'ipv4');
  ranges.addAddress('::1', 'ipv6');
  ranges.addSubnet('fc00::', 7, 'ipv6');
  ranges.addSubnet('fe80::', 10, 'ipv6');

  const rnd = seeded(20260115);
  const pick = (/** @type {(string|number)[]} */ list) => list[Math.floor(rnd() * list.length)];
  const byte = () => Math.floor(rnd() * 256);
  // Octets and groups on and around every range boundary, mixed with random ones.
  const octets = [0, 1, 9, 10, 11, 15, 16, 17, 31, 32, 100, 126, 127, 128, 168, 169, 170, 171, 172, 173, 191, 192, 193, 253, 254, 255];
  const groups = ['0', '1', 'fbff', 'fc00', 'fcff', 'fd00', 'fdff', 'fe00', 'fe7f', 'fe80', 'febf', 'fec0', 'ffff', 'c0a8', '7f00', 'a00'];
  let checked = 0, privateSeen = 0;

  for (let k = 0; k < 6000; k++) {
    const v4 = [pick(octets), rnd() < 0.7 ? pick(octets) : byte(), byte(), byte()].join('.');
    const expected = ranges.check(v4, 'ipv4');
    const mappedHex = '::ffff:' + v4.split('.').map(Number).reduce((hex, n, at) => hex + (at === 2 ? ':' : '') + n.toString(16).padStart(2, '0'), '');
    for (const spelling of [v4, `::ffff:${v4}`, `::FFFF:${v4}`, `0:0:0:0:0:ffff:${v4}`, mappedHex]) {
      assert.equal(isPrivateAddress(spelling), expected, spelling);
      checked++;
    }
    if (expected) privateSeen++;
  }
  for (let k = 0; k < 12000; k++) {
    const parts = Array.from({ length: 8 }, () => (rnd() < 0.8 ? String(pick(groups)) : Math.floor(rnd() * 65536).toString(16)));
    let address = parts.join(':');
    if (rnd() < 0.5) {                                                  // the same address with one run written as `::`
      const at = Math.floor(rnd() * 8), length = 1 + Math.floor(rnd() * (8 - at));
      address = parts.slice(0, at).join(':') + '::' + parts.slice(at + length).join(':');
    }
    if (rnd() < 0.2) address = address.toUpperCase();
    if (isIP(address) !== 6) continue;
    const expected = ranges.check(address, 'ipv6');
    assert.equal(isPrivateAddress(address), expected, address);
    checked++;
    if (expected) privateSeen++;
  }
  assert.ok(checked > 35000 && privateSeen > 3000 && privateSeen < checked - 3000, JSON.stringify({ checked, privateSeen }));
});
