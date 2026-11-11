// server/guard.js (S1) — origin check, peer check, rate limits (contract sections 4.29, 7.10, 7.13).
//
// Three independent gates in front of the paid provider call:
//   origin   a browser page may call the proxy only from the proxy's own origin (Origin host === Host header,
//            whatever the address: this is what makes the LAN deployment work) or from an allowlisted origin
//   peer     only loopback and private-range addresses, unless COACH_PUBLIC=1
//   rate     a token bucket per address, a daily count per address and a daily count in total (UTC days)

import { isIPv4, isIPv6 } from 'node:net';

/** @import { CoachConfig } from './config.js' */

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
/** The rate key of a caller whose address is missing or is not an IP address: they all share one bucket. */
const UNKNOWN_PEER = 'unknown';
/** What a cross-origin page may do: the health probe, the coach POST with a JSON body, the mock helpers. */
const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
const CORS_ALLOW_HEADERS = 'content-type';
/** Seconds a browser may reuse a preflight answer. */
const CORS_MAX_AGE = '600';

/**
 * The guard reads the config once, when it is created, and throws a TypeError when one of the four rate limits is
 * not a number >= 0 (a limit of 0 refuses every request): a guard without limits must not come into being.
 * `take(ip)` asks the store with the current time (`Date.now()`); a store that fails makes `take` reject.
 * @param {CoachConfig} config
 * @param {Pick<ReturnType<typeof memoryStore>, 'take'>} [store]  default memoryStore()
 * @returns {{ corsHeaders(origin:string|null, host:string|null): Record<string,string>,
 *             checkOrigin(origin:string|null, host:string|null): boolean,
 *             checkPeer(ip:string|undefined): boolean,
 *             take(ip:string): Promise<{ok:true}|{ok:false, retryAfter:number}> }}
 */
export function createGuard(config, store = memoryStore()) {
  const allowedOrigins = new Set(config.allowedOrigins);
  const allowNoOrigin = config.allowNoOrigin === true;
  const isPublic = config.isPublic === true;
  const limits = Object.freeze({
    burst: config.rateBurst,
    perMin: config.ratePerMin,
    ipDaily: config.ipDaily,
    globalDaily: config.globalDaily,
  });
  for (const [name, value] of Object.entries(limits)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`createGuard: the rate limit "${name}" must be a number >= 0`);
    }
  }

  /**
   * @param {string|null} origin
   * @param {string|null} host
   * @returns {boolean}
   */
  function checkOrigin(origin, host) {
    if (origin === null || origin === undefined) return allowNoOrigin;
    if (typeof origin !== 'string' || origin === '') return false;
    if (allowedOrigins.has(origin)) return true;
    if (typeof host !== 'string' || host === '') return false;
    try {
      return new URL(origin).host === host.toLowerCase();      // URL.host is lower case; host names are case-insensitive
    } catch {
      return false;                                            // not a URL (for example the opaque origin `null`)
    }
  }

  return {
    corsHeaders(origin, host) {
      /** @type {Record<string, string>} */
      const headers = { vary: 'Origin' };
      if (typeof origin === 'string' && origin !== '' && checkOrigin(origin, host)) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-methods'] = CORS_ALLOW_METHODS;
        headers['access-control-allow-headers'] = CORS_ALLOW_HEADERS;
        headers['access-control-max-age'] = CORS_MAX_AGE;
      }
      return headers;
    },

    checkOrigin,

    checkPeer(ip) {
      return isPublic || ip === undefined || isPrivateAddress(ip);
    },

    async take(ip) {
      return store.take(rateKey(ip), Date.now(), limits);
    },
  };
}

/**
 * The in-memory rate-limit store (per-IP token buckets and the daily counters).
 *
 * `take(key, now, limits)` decides one request and, when it is accepted, counts it:
 *   1. the total of this UTC day has reached `globalDaily`, or this key's count has reached `ipDaily`
 *      -> refused, `retryAfter` = seconds until the next UTC midnight
 *   2. the key's bucket (capacity `burst`, refilled at `perMin` tokens a minute, full at first sight) holds less than
 *      one token -> refused, `retryAfter` = seconds until one token is there
 *   3. otherwise one token is taken and both daily counts go up by one.
 * A refused request costs nothing and is never recorded, so the store holds one entry for each address that was
 * served on the current day (at most `globalDaily` of them), plus the addresses whose bucket was not yet full again
 * at midnight. `size` is the number of entries held at the moment. A limit that is not a number refuses. `now` is
 * epoch milliseconds; `retryAfter` is a whole number of seconds, at least 1. A store backed by something slower may
 * return a promise instead (createGuard uses `take` only).
 * @returns {{ readonly size:number,
 *             take(key:string, now:number, limits:{burst:number, perMin:number, ipDaily:number, globalDaily:number}):
 *             {ok:true}|{ok:false, retryAfter:number}|Promise<{ok:true}|{ok:false, retryAfter:number}> }}
 */
export function memoryStore() {
  // `credit` is the bucket level in units of 1/60000 token, so that refilling stays in whole numbers:
  // one millisecond adds `perMin` units and one request costs 60000 units.
  /** @type {Map<string, {credit:number, at:number, count:number}>} */
  const clients = new Map();
  let day = Number.NaN;
  let total = 0;

  /**
   * @param {{credit:number, at:number}} client
   * @param {number} now
   * @param {{burst:number, perMin:number}} limits
   */
  function refill(client, now, limits) {
    const elapsed = Math.max(0, now - client.at);              // a clock that went backwards adds nothing
    client.credit = Math.min(limits.burst * MINUTE_MS, client.credit + elapsed * limits.perMin);
    client.at = now;
  }

  return {
    get size() {
      return clients.size;
    },

    take(key, now, limits) {
      const today = Math.floor(now / DAY_MS);
      if (today !== day) {
        // A new UTC day: the daily counts start again. Buckets are kept unless they are full again, so midnight
        // gives nobody an extra burst; a full bucket carries no information and its entry is dropped.
        day = today;
        total = 0;
        for (const [name, client] of clients) {
          refill(client, now, limits);
          if (client.credit >= limits.burst * MINUTE_MS) clients.delete(name);
          else client.count = 0;
        }
      }
      // Every test below is written so that a limit that is not a number refuses the request.
      const untilMidnight = Math.max(1, Math.ceil(((today + 1) * DAY_MS - now) / 1000));
      const known = clients.get(key);
      if (!(total < limits.globalDaily) || !((known ? known.count : 0) < limits.ipDaily)) {
        return { ok: false, retryAfter: untilMidnight };
      }
      const client = known ?? { credit: limits.burst * MINUTE_MS, at: now, count: 0 };
      refill(client, now, limits);
      if (!(client.credit >= MINUTE_MS)) {
        const wait = Math.ceil((MINUTE_MS - client.credit) / limits.perMin / 1000);
        // A bucket that never refills (perMin <= 0) has nothing to offer before the day ends.
        return { ok: false, retryAfter: Number.isFinite(wait) ? Math.max(1, wait) : untilMidnight };
      }
      client.credit -= MINUTE_MS;
      client.count += 1;
      total += 1;
      if (!known) clients.set(key, client);
      return { ok: true };
    },
  };
}

/**
 * loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10, IPv4-mapped forms.
 * Anything that is not a literal IP address (a host name, a bracketed or padded address, a number) is not private.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateAddress(ip) {
  const bytes = parseAddress(ip);
  if (bytes === null) return false;
  if (bytes.length === 4) return isPrivateV4(bytes[0], bytes[1]);
  if (isLoopbackV6(bytes)) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true;                          // fc00::/7  unique local
  return bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;               // fe80::/10 link local
}

/**
 * @param {number} a  first octet
 * @param {number} b  second octet
 * @returns {boolean}
 */
function isPrivateV4(a, b) {
  return a === 127                                  // 127.0.0.0/8    loopback
    || a === 10                                     // 10.0.0.0/8
    || (a === 172 && b >= 16 && b <= 31)            // 172.16.0.0/12
    || (a === 192 && b === 168)                     // 192.168.0.0/16
    || (a === 169 && b === 254);                    // 169.254.0.0/16 link local
}

/** @param {number[]} bytes  16 bytes @returns {boolean} */
function isLoopbackV6(bytes) {
  return bytes[15] === 1 && bytes.slice(0, 15).every((byte) => byte === 0);
}

/**
 * The bytes of a literal address: 4 for IPv4 (also for an IPv4-mapped IPv6 address, `::ffff:a.b.c.d` in any
 * spelling), 16 for any other IPv6 address, null for everything else. A zone id (`%eth0`) is ignored.
 * @param {unknown} ip
 * @returns {number[]|null}
 */
function parseAddress(ip) {
  if (typeof ip !== 'string') return null;
  if (isIPv4(ip)) return ip.split('.').map(Number);
  if (!isIPv6(ip)) return null;
  const zone = ip.indexOf('%');
  let text = zone < 0 ? ip : ip.slice(0, zone);

  if (text.includes('.')) {                                             // dotted IPv4 tail -> two hex groups
    const start = text.lastIndexOf(':') + 1;
    const tail = text.slice(start);
    if (!isIPv4(tail)) return null;
    const [a, b, c, d] = tail.split('.').map(Number);
    text = text.slice(0, start) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

  /** @type {number[]} */
  const bytes = [];
  for (const group of [...left, ...new Array(missing).fill('0'), ...right]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  const mapped = bytes[10] === 0xff && bytes[11] === 0xff && bytes.slice(0, 10).every((byte) => byte === 0);
  return mapped ? bytes.slice(12) : bytes;
}

/**
 * The rate-limit key of a caller: the address in one canonical spelling, so that `192.168.1.5`,
 * `::ffff:192.168.1.5` and `::ffff:c0a8:105` are one caller, and so are the spellings of one IPv6 address.
 * @param {unknown} ip
 * @returns {string}
 */
function rateKey(ip) {
  const bytes = parseAddress(ip);
  if (bytes === null) return UNKNOWN_PEER;
  if (bytes.length === 4) return bytes.join('.');
  const groups = [];
  for (let k = 0; k < 16; k += 2) groups.push(((bytes[k] << 8) | bytes[k + 1]).toString(16));
  return groups.join(':');
}
