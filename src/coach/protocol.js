// src/coach/protocol.js (C1) — protocol constants, validators, sanitizeSay, canonicalJson (contract section 4.10).
// Pure; loaded by the browser and by the proxy. Imports nothing but codes.js and its coach siblings lexicon.js / fallback.js.

/**
 * @import { Color } from '../core/types.js'
 * @import { Alt, Area, CoachEvent, CoachRequest, Effect, Eval, Hint1, Hint2, Hint3, Moment, MorePacket, Net, OppMove, OverPacket,
 *           PT, RecapPacket, Threat, ToolRecord, ToolResult, ToolVerdict, TryPacket, TurnBrief, WLine, WPiece, WTakeaway,
 *           StartEvent, OppEvent, HintEvent, TryEvent, AskEvent, OverEvent, RecapEvent } from './types.js'
 */

import {
  ASK_CODES, CATS, CUE_CODES, END_REASONS, HABIT_CODES, MOTIF_CODES, NOTATION_RE, PATTERN_CODES, STRENGTH_CODES,
} from '../core/codes.js';

export const PROTOCOL_VERSION = 1;
export const LIMITS = Object.freeze({
  BODY_BYTES: 65536, EVENTS: 16, EVENT_INDEX_MAX: 63, SAY_CHARS: 120, REPLY_CHARS: 400, RESUME_TOKEN_BYTES: 4096, PROMPT_CHARS: 12000,
  TOOL_ROUNDS: 2, TOOL_CALLS_PER_ROUND: 2, TOOL_AFTER: 3, LINE_MOVES: 6, EFFECTS: 3, FLAWS: 2, THREATS: 4, ALTS: 2, MOMENTS: 6,
  TAUGHT: 8, RECAP_TRIES: 8, CANDIDATES: 5, VARIANTS: 16,
});
/** Length caps in characters (brackets not counted). The prompt states them; the client cuts at 1.5x at a sentence end. */
export const CAPS = Object.freeze({ start: 20, opp: 18, try: 24, hint1: 20, hint2: 20, hint3: 36, ask: 50, why: 90, free: 70, over: 80 });
export const DISPLAY_CAP_FACTOR = 1.5;

/**
 * CAPS entry for this event (ask -> why / free / ask by code; hint -> by level).
 * A `recap` event is never the event to answer and has no entry of its own: it stands for the tries of the turn and gets the `try` cap.
 * @param {CoachEvent} event
 * @returns {number}
 */
export function capFor(event) {
  switch (event.kind) {
    case 'start': return CAPS.start;
    case 'opp':   return CAPS.opp;
    case 'hint':  return event.level === 1 ? CAPS.hint1 : event.level === 2 ? CAPS.hint2 : CAPS.hint3;
    case 'ask':   return event.ask === 'why' ? CAPS.why : event.ask === 'free' ? CAPS.free : CAPS.ask;
    case 'over':  return CAPS.over;
    case 'try':
    default:      return CAPS.try;
  }
}

/**
 * Characters of a reply as the child sees it: 【】 removed.
 * @param {string} text
 * @returns {number}
 */
export function plainLength(text) {
  return codePoints(String(text ?? '').replace(/[【】]/g, ''));
}

// ---------------------------------------------------------------------------------------------------------------------
// validateCoachRequest
// ---------------------------------------------------------------------------------------------------------------------

/** Thrown inside the validator and turned into `{ok:false, path, why}` at the top; never leaves this module. */
class Reject {
  /** @param {string} path @param {string} why */
  constructor(path, why) {
    this.path = path;
    this.why = why;
  }
}

/**
 * Reasons (`why`): version | type | missing | unknown_key | enum | notation | pattern | range | too_long | too_many | empty |
 * forbidden | order | no_try | held.
 * @param {string} path @param {string} why @returns {never}
 */
function fail(path, why) {
  throw new Reject(path, why);
}

/** @param {string} path @param {string|number} key @returns {string} */
function at(path, key) {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

/** @param {string} s @returns {number} */
function codePoints(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const SIDES = /** @type {const} */ (['me', 'opp']);
const COLORS = /** @type {const} */ (['red', 'black']);
const PTS = /** @type {const} */ (['K', 'A', 'E', 'H', 'R', 'C', 'P']);
const RANKS = /** @type {const} */ (['front', 'mid', 'back']);
const LINE_ENDS = /** @type {const} */ (['quiet', 'check', 'mate']);
const EVAL_BANDS = /** @type {const} */ (['won', 'better', 'even', 'worse', 'lost']);
const AREAS = /** @type {const} */ (['left', 'center', 'right', 'river', 'their_palace', 'my_palace', 'their_back', 'my_back']);
const MOMENT_TAGS = /** @type {const} */ (['great', 'slip', 'missed', 'punished']);
const QUALITIES = /** @type {const} */ (['strong', 'normal', 'soft', 'slip']);
const SEVERITIES = /** @type {const} */ (['pawn', 'piece', 'rook', 'mate']);
const CHANCE_SIZES = /** @type {const} */ (['pawn', 'piece', 'rook', 'mate', 'position']);
const PHASES = /** @type {const} */ (['opening', 'middle', 'endgame']);
const BACKS = /** @type {const} */ (['undo', 'reload']);
const TRY_CHANCES = /** @type {const} */ (['taken', 'missed', 'none']);
const COMPARISONS = /** @type {const} */ (['better', 'same', 'worse']);
const FOCUSES = /** @type {const} */ (['danger', 'chance', 'develop', 'improve', 'finish']);
const RESULTS = /** @type {const} */ (['win', 'loss', 'draw']);
const TAKEAWAY_KINDS = /** @type {const} */ (['strength', 'habit', 'idea']);
const TOOL_ERRORS = /** @type {const} */ (['syntax', 'no_such_move', 'ambiguous', 'game_over', 'busy', 'limit']);
const EVENT_KINDS = /** @type {const} */ (['start', 'opp', 'hint', 'try', 'ask', 'over', 'recap']);
const SAID = /** @type {const} */ (['llm', 'local', 'none']);
/** Codes `TurnBrief.taught` may carry: motif and pattern codes. */
const TAUGHT_CODES = Object.freeze([...MOTIF_CODES, ...PATTERN_CODES]);

/** Ask codes that may carry the withheld `more` packet (rule 6). */
const MORE_ASKS = /** @type {readonly string[]} */ (['reply', 'better', 'why', 'show', 'free']);
/** Ask codes that need an active try in a turn thread (rule 5). */
const TRY_ASKS = /** @type {readonly string[]} */ (['good', 'reply', 'better', 'show']);
/** Ask codes allowed after `over` (rule 5). */
const OVER_ASKS = /** @type {readonly string[]} */ (['proud', 'improve', 'next', 'why', 'free']);

const MAT_RE = /^(?:[RHCPAE][0-9]){0,6}$/;
/** base64url(HMAC-SHA256) without padding (section 7.4). */
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;
/** base64url(JSON) + '.' + base64url(HMAC) (section 7.4). */
const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** A provider's tool-call id. */
const CALL_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
/** An unknown key that may be named in the `path` of a rejection. */
const PLAIN_KEY_RE = /^[A-Za-z0-9_]{1,32}$/;

/** Largest move number: floor(600 / 2) + 1. */
const MOVE_NO_MAX = 301;
/** Largest number of moves the child can play in one game, and so the largest count of anything per game. */
const CHILD_MOVES_MAX = 300;
const CP_MAX = 9999;
/** Most pieces one line can take from one side (Net: "each <= 6"). */
const NET_PIECES = 6;
/** Past tool exchanges kept on one event (section 3.6: "<= 3"). */
const EVENT_TOOLS = 3;
/** Most tool results one event can collect: two rounds of two calls. */
const RESUME_RESULTS = LIMITS.TOOL_ROUNDS * LIMITS.TOOL_CALLS_PER_ROUND;

/**
 * A plain JSON object whose keys are all in `keys`.
 * @param {unknown} x @param {string} path @param {readonly string[]} keys
 * @returns {Record<string, unknown>}
 */
function record(x, path, keys) {
  if (x === undefined) return fail(path, 'missing');
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return fail(path, 'type');
  const o = /** @type {Record<string, unknown>} */ (x);
  for (const key of Object.keys(o)) {
    // A path never echoes content: a key that is not a plain identifier is reported as `?`.
    if (!keys.includes(key)) return fail(at(path, PLAIN_KEY_RE.test(key) ? key : '?'), 'unknown_key');
  }
  return o;
}

/**
 * Drops the members that are undefined (optional fields that were absent), keeping the order of the others.
 * @template {object} T
 * @param {T} o
 * @returns {T}
 */
function compact(o) {
  const members = /** @type {Record<string, unknown>} */ (o);
  for (const key of Object.keys(members)) {
    if (members[key] === undefined) delete members[key];
  }
  return o;
}

/** @param {unknown} x @param {string} path @param {number} min @param {number} max @returns {number} */
function int(x, path, min, max) {
  if (x === undefined) return fail(path, 'missing');
  if (typeof x !== 'number' || !Number.isInteger(x)) return fail(path, 'type');
  if (x < min || x > max) return fail(path, 'range');
  return x;
}

/** @param {unknown} x @param {string} path @returns {boolean} */
function bool(x, path) {
  if (x === undefined) return fail(path, 'missing');
  if (typeof x !== 'boolean') return fail(path, 'type');
  return x;
}

/**
 * @template {string} T
 * @param {unknown} x @param {string} path @param {readonly T[]} members
 * @returns {T}
 */
function oneOf(x, path, members) {
  if (x === undefined) return fail(path, 'missing');
  if (typeof x !== 'string') return fail(path, 'type');
  const k = /** @type {readonly string[]} */ (members).indexOf(x);
  if (k < 0) return fail(path, 'enum');
  return members[k];
}

/** A move exactly as notation.js emits it. @param {unknown} x @param {string} path @returns {string} */
function notation(x, path) {
  if (x === undefined) return fail(path, 'missing');
  if (typeof x !== 'string') return fail(path, 'type');
  if (!NOTATION_RE.test(x)) return fail(path, 'notation');
  return x;
}

/** @param {unknown} x @param {string} path @param {RegExp} re @returns {string} */
function pattern(x, path, re) {
  if (x === undefined) return fail(path, 'missing');
  if (typeof x !== 'string') return fail(path, 'type');
  if (!re.test(x)) return fail(path, 'pattern');
  return x;
}

/**
 * @template T
 * @param {unknown} x @param {string} path @param {number} max @param {(item:unknown, path:string) => T} item @param {number} [min]
 * @returns {T[]}
 */
function list(x, path, max, item, min = 0) {
  if (x === undefined) return fail(path, 'missing');
  if (!Array.isArray(x)) return fail(path, 'type');
  if (x.length > max) return fail(path, 'too_many');
  if (x.length < min) return fail(path, 'empty');
  return x.map((value, k) => item(value, at(path, k)));
}

/**
 * A required member that may be null.
 * @template T
 * @param {unknown} x @param {string} path @param {(value:unknown, path:string) => T} item
 * @returns {T|null}
 */
function nullable(x, path, item) {
  if (x === undefined) return fail(path, 'missing');
  return x === null ? null : item(x, path);
}

/**
 * A member that may be absent.
 * @template T
 * @param {unknown} x @param {string} path @param {(value:unknown, path:string) => T} item
 * @returns {T|undefined}
 */
function optional(x, path, item) {
  return x === undefined ? undefined : item(x, path);
}

/** @param {unknown} x @param {string} path @returns {PT} */
const pt = (x, path) => oneOf(x, path, PTS);
/** @param {unknown} x @param {string} path @returns {Area} */
const area = (x, path) => oneOf(x, path, AREAS);
/** @param {unknown} x @param {string} path */
const motif = (x, path) => oneOf(x, path, MOTIF_CODES);
/** @param {unknown} x @param {string} path */
const patternCode = (x, path) => oneOf(x, path, PATTERN_CODES);
/** @param {unknown} x @param {string} path */
const habit = (x, path) => oneOf(x, path, HABIT_CODES);
/** @param {unknown} x @param {string} path */
const cat = (x, path) => oneOf(x, path, CATS);
/** @param {unknown} x @param {string} path */
const comparison = (x, path) => oneOf(x, path, COMPARISONS);

/** @param {unknown} x @param {string} path @returns {WPiece} */
function wpiece(x, path) {
  const o = record(x, path, ['s', 't', 'f', 'q']);
  return compact({
    s: oneOf(o.s, at(path, 's'), SIDES),
    t: pt(o.t, at(path, 't')),
    f: int(o.f, at(path, 'f'), 1, 9),
    q: optional(o.q, at(path, 'q'), (v, p) => oneOf(v, p, RANKS)),
  });
}

/** @param {unknown} x @param {string} path @returns {Net} */
function net(x, path) {
  const o = record(x, path, ['gain', 'lose', 'cp']);
  return {
    gain: list(o.gain, at(path, 'gain'), NET_PIECES, pt),
    lose: list(o.lose, at(path, 'lose'), NET_PIECES, pt),
    cp: int(o.cp, at(path, 'cp'), -CP_MAX, CP_MAX),
  };
}

/** @param {unknown} x @param {string} path @returns {WLine} */
function wline(x, path) {
  const o = record(x, path, ['first', 'moves', 'net', 'end']);
  return {
    first: oneOf(o.first, at(path, 'first'), SIDES),
    moves: list(o.moves, at(path, 'moves'), LIMITS.LINE_MOVES, notation, 1),
    net: net(o.net, at(path, 'net')),
    end: oneOf(o.end, at(path, 'end'), LINE_ENDS),
  };
}

/** @param {unknown} x @param {string} path @returns {Eval} */
function evaluation(x, path) {
  const o = record(x, path, ['b', 'mate']);
  return compact({
    b: oneOf(o.b, at(path, 'b'), EVAL_BANDS),
    mate: optional(o.mate, at(path, 'mate'), (v, p) => int(v, p, -9, 9)),
  });
}

/** @param {unknown} x @param {string} path @returns {Effect} */
function effect(x, path) {
  const o = record(x, path, ['k', 'by', 'on', 'on2', 'name']);
  return compact({
    k: motif(o.k, at(path, 'k')),
    by: optional(o.by, at(path, 'by'), wpiece),
    on: optional(o.on, at(path, 'on'), wpiece),
    on2: optional(o.on2, at(path, 'on2'), wpiece),
    name: optional(o.name, at(path, 'name'), patternCode),
  });
}

/** @param {unknown} x @param {string} path @returns {Effect[]} */
const effects = (x, path) => list(x, path, LIMITS.EFFECTS, effect);
/** @param {unknown} x @param {string} path @returns {Effect[]} */
const flaws = (x, path) => list(x, path, LIMITS.FLAWS, effect);

/** @param {unknown} x @param {string} path @returns {Moment} */
function moment(x, path) {
  const o = record(x, path, ['n', 's', 'move', 'tag', 'k']);
  return compact({
    n: int(o.n, at(path, 'n'), 1, MOVE_NO_MAX),
    s: oneOf(o.s, at(path, 's'), SIDES),
    move: notation(o.move, at(path, 'move')),
    tag: oneOf(o.tag, at(path, 'tag'), MOMENT_TAGS),
    k: optional(o.k, at(path, 'k'), motif),
  });
}

/** @param {unknown} x @param {string} path @returns {OppMove} */
function oppMove(x, path) {
  const o = record(x, path, ['move', 'check', 'captured', 'does', 'name', 'quality', 'punishes', 'overlooked']);
  return compact({
    move: notation(o.move, at(path, 'move')),
    check: bool(o.check, at(path, 'check')),
    captured: optional(o.captured, at(path, 'captured'), pt),
    does: effects(o.does, at(path, 'does')),
    name: optional(o.name, at(path, 'name'), patternCode),
    quality: oneOf(o.quality, at(path, 'quality'), QUALITIES),
    punishes: optional(o.punishes, at(path, 'punishes'), bool),
    overlooked: optional(o.overlooked, at(path, 'overlooked'), (v, p) => {
      const r = record(v, p, ['on', 'move']);
      return { on: wpiece(r.on, at(p, 'on')), move: notation(r.move, at(p, 'move')) };
    }),
  });
}

/**
 * A flag that travels only when it holds: `true`. An absent member says "no"; `false` is not a value of the wire.
 * @param {unknown} x @param {string} path @returns {true}
 */
function onlyTrue(x, path) {
  if (typeof x !== 'boolean') return fail(path, 'type');
  if (!x) return fail(path, 'enum');
  return true;
}

/**
 * `prep` (CONTRACT-NOTES 131): the threat's move takes nothing and `k` / `by` / `on` describe the attack that stands after it.
 * @param {unknown} x @param {string} path @returns {Threat}
 */
function threat(x, path) {
  const o = record(x, path, ['k', 'by', 'on', 'move', 'net', 'sev', 'name', 'prep']);
  return compact({
    k: motif(o.k, at(path, 'k')),
    by: wpiece(o.by, at(path, 'by')),
    on: optional(o.on, at(path, 'on'), wpiece),
    move: notation(o.move, at(path, 'move')),
    net: net(o.net, at(path, 'net')),
    sev: oneOf(o.sev, at(path, 'sev'), SEVERITIES),
    name: optional(o.name, at(path, 'name'), patternCode),
    prep: optional(o.prep, at(path, 'prep'), onlyTrue),
  });
}

/** @param {unknown} x @param {string} path @returns {NonNullable<TryPacket['toward']>} */
function toward(x, path) {
  const o = record(x, path, ['area', 'theme']);
  return compact({
    area: optional(o.area, at(path, 'area'), area),
    theme: optional(o.theme, at(path, 'theme'), motif),
  });
}

/** @param {unknown} x @param {string} path @returns {TryPacket} */
function tryPacket(x, path) {
  const o = record(x, path, ['move', 'cat', 'loss', 'held', 'only', 'sac', 'self', 'repeat', 'eval', 'does', 'flaws', 'cost', 'reply',
    'toward', 'chance', 'habit', 'avoided', 'vsPrev']);
  const out = compact({
    move: notation(o.move, at(path, 'move')),
    cat: cat(o.cat, at(path, 'cat')),
    loss: int(o.loss, at(path, 'loss'), 0, CP_MAX),
    held: bool(o.held, at(path, 'held')),
    only: optional(o.only, at(path, 'only'), bool),
    sac: optional(o.sac, at(path, 'sac'), bool),
    self: optional(o.self, at(path, 'self'), bool),
    repeat: optional(o.repeat, at(path, 'repeat'), bool),
    eval: evaluation(o.eval, at(path, 'eval')),
    does: effects(o.does, at(path, 'does')),
    flaws: flaws(o.flaws, at(path, 'flaws')),
    cost: nullable(o.cost, at(path, 'cost'), net),
    reply: nullable(o.reply, at(path, 'reply'), wline),
    toward: nullable(o.toward, at(path, 'toward'), toward),
    chance: oneOf(o.chance, at(path, 'chance'), TRY_CHANCES),
    habit: optional(o.habit, at(path, 'habit'), habit),
    avoided: optional(o.avoided, at(path, 'avoided'), habit),
    vsPrev: optional(o.vsPrev, at(path, 'vsPrev'), comparison),
  });
  // The reply to a held try is withheld until the first follow-up (section 3.6: "ALWAYS null when held").
  if (out.held && out.reply !== null) return fail(at(path, 'reply'), 'held');
  return out;
}

/** @param {unknown} x @param {string} path @returns {Alt} */
function alt(x, path) {
  const o = record(x, path, ['move', 'gain', 'does', 'line']);
  return {
    move: notation(o.move, at(path, 'move')),
    gain: int(o.gain, at(path, 'gain'), 1, CP_MAX),
    does: effects(o.does, at(path, 'does')),
    line: nullable(o.line, at(path, 'line'), wline),
  };
}

/** @param {unknown} x @param {string} path @returns {MorePacket} */
function morePacket(x, path) {
  const o = record(x, path, ['reply', 'better']);
  return compact({
    reply: optional(o.reply, at(path, 'reply'), wline),
    better: optional(o.better, at(path, 'better'), (v, p) => list(v, p, LIMITS.ALTS, alt)),
  });
}

/** @param {unknown} x @param {string} path @param {1|2|3} level @returns {Hint1|Hint2|Hint3} */
function hintPacket(x, path, level) {
  if (level === 1) {
    const o = record(x, path, ['focus', 'theme']);
    return { focus: oneOf(o.focus, at(path, 'focus'), FOCUSES), theme: motif(o.theme, at(path, 'theme')) };
  }
  if (level === 2) {
    const o = record(x, path, ['piece', 'area', 'theme']);
    return { piece: wpiece(o.piece, at(path, 'piece')), area: area(o.area, at(path, 'area')), theme: motif(o.theme, at(path, 'theme')) };
  }
  const o = record(x, path, ['move', 'does', 'line', 'alt']);
  return compact({
    move: notation(o.move, at(path, 'move')),
    does: effects(o.does, at(path, 'does')),
    line: nullable(o.line, at(path, 'line'), wline),
    alt: optional(o.alt, at(path, 'alt'), notation),
  });
}

/** @param {unknown} x @param {string} path @returns {WTakeaway} */
function takeaway(x, path) {
  const o = record(x, path, ['kind', 'code', 'n', 'ex']);
  const kind = oneOf(o.kind, at(path, 'kind'), TAKEAWAY_KINDS);
  /** @type {string} */
  const code = kind === 'strength' ? oneOf(o.code, at(path, 'code'), STRENGTH_CODES)
    : kind === 'habit' ? habit(o.code, at(path, 'code'))
    : patternCode(o.code, at(path, 'code'));
  return compact({
    kind,
    code,
    n: optional(o.n, at(path, 'n'), count),
    ex: optional(o.ex, at(path, 'ex'), (v, p) => {
      const e = record(v, p, ['n', 'move', 'better']);
      return compact({
        n: int(e.n, at(p, 'n'), 1, MOVE_NO_MAX),
        move: notation(e.move, at(p, 'move')),
        better: optional(e.better, at(p, 'better'), notation),
      });
    }),
  });
}

/** A count of something that happens at most once per move of the child. @param {unknown} x @param {string} path @returns {number} */
const count = (x, path) => int(x, path, 0, CHILD_MOVES_MAX);

/** @param {unknown} x @param {string} path @returns {OverPacket['stats']} */
function overStats(x, path) {
  const o = record(x, path, ['good', 'taken', 'captures', 'brilliant']);
  return {
    good: count(o.good, at(path, 'good')),
    taken: count(o.taken, at(path, 'taken')),
    captures: count(o.captures, at(path, 'captures')),
    brilliant: count(o.brilliant, at(path, 'brilliant')),
  };
}

/** @param {unknown} x @param {string} path @returns {OverPacket} */
function overPacket(x, path) {
  const o = record(x, path, ['result', 'reason', 'moves', 'stats', 'takeaway', 'proud', 'goal', 'kept', 'rank']);
  return {
    result: oneOf(o.result, at(path, 'result'), RESULTS),
    reason: oneOf(o.reason, at(path, 'reason'), END_REASONS),
    moves: count(o.moves, at(path, 'moves')),
    stats: overStats(o.stats, at(path, 'stats')),
    takeaway: nullable(o.takeaway, at(path, 'takeaway'), takeaway),
    proud: nullable(o.proud, at(path, 'proud'), moment),
    goal: nullable(o.goal, at(path, 'goal'), habit),
    kept: nullable(o.kept, at(path, 'kept'), bool),
    rank: nullable(o.rank, at(path, 'rank'), (v, p) => ({ to: int(record(v, p, ['to']).to, at(p, 'to'), 1, 9) })),
  };
}

/** @param {unknown} x @param {string} path @returns {RecapPacket} */
function recapPacket(x, path) {
  const o = record(x, path, ['tries', 'hint', 'cur']);
  return compact({
    tries: list(o.tries, at(path, 'tries'), LIMITS.RECAP_TRIES, (v, p) => {
      const t = record(v, p, ['move', 'cat']);
      return { move: notation(t.move, at(p, 'move')), cat: cat(t.cat, at(p, 'cat')) };
    }),
    hint: /** @type {0|1|2|3} */ (int(o.hint, at(path, 'hint'), 0, 3)),
    cur: optional(o.cur, at(path, 'cur'), tryPacket),
  });
}

/** @param {unknown} x @param {string} path @returns {ToolVerdict} */
function toolVerdict(x, path) {
  const o = record(x, path, ['seq', 'who', 'cat', 'loss', 'eval', 'does', 'flaws', 'cost', 'reply', 'vsTry']);
  return compact({
    seq: list(o.seq, at(path, 'seq'), LIMITS.TOOL_AFTER + 1, notation, 1),
    who: oneOf(o.who, at(path, 'who'), SIDES),
    cat: cat(o.cat, at(path, 'cat')),
    loss: int(o.loss, at(path, 'loss'), 0, CP_MAX),
    eval: evaluation(o.eval, at(path, 'eval')),
    does: effects(o.does, at(path, 'does')),
    flaws: flaws(o.flaws, at(path, 'flaws')),
    cost: nullable(o.cost, at(path, 'cost'), net),
    reply: nullable(o.reply, at(path, 'reply'), wline),
    vsTry: optional(o.vsTry, at(path, 'vsTry'), comparison),
  });
}

/** @param {unknown} x @param {string} path @returns {ToolResult} */
function toolResult(x, path) {
  const shape = record(x, path, ['id', 'ok', 'verdict', 'error', 'at', 'candidates']);
  const id = pattern(shape.id, at(path, 'id'), CALL_ID_RE);
  if (bool(shape.ok, at(path, 'ok'))) {
    const o = record(x, path, ['id', 'ok', 'verdict']);
    return { id, ok: true, verdict: toolVerdict(o.verdict, at(path, 'verdict')) };
  }
  const o = record(x, path, ['id', 'ok', 'error', 'at', 'candidates']);
  return compact({
    id,
    ok: /** @type {false} */ (false),
    error: oneOf(o.error, at(path, 'error'), TOOL_ERRORS),
    at: optional(o.at, at(path, 'at'), (v, p) => int(v, p, 0, LIMITS.TOOL_AFTER)),
    candidates: optional(o.candidates, at(path, 'candidates'), (v, p) => list(v, p, LIMITS.CANDIDATES, notation)),
  });
}

/** @param {unknown} x @param {string} path @returns {ToolRecord} */
function toolRecord(x, path) {
  const o = record(x, path, ['notation', 'after', 'result']);
  return {
    notation: notation(o.notation, at(path, 'notation')),
    after: list(o.after, at(path, 'after'), LIMITS.TOOL_AFTER, notation),
    result: toolResult(o.result, at(path, 'result')),
  };
}

/** @param {unknown} x @param {string} path @returns {TurnBrief['mat']} */
function material(x, path) {
  const o = record(x, path, ['me', 'opp', 'cp']);
  return {
    me: pattern(o.me, at(path, 'me'), MAT_RE),
    opp: pattern(o.opp, at(path, 'opp'), MAT_RE),
    cp: int(o.cp, at(path, 'cp'), -CP_MAX, CP_MAX),
  };
}

/** @param {unknown} x @param {string} path @returns {TurnBrief['known']} */
function knownFlags(x, path) {
  const o = record(x, path, ['threats', 'chance']);
  return { threats: bool(o.threats, at(path, 'threats')), chance: bool(o.chance, at(path, 'chance')) };
}

/** @param {unknown} x @param {string} path @returns {TurnBrief} */
function turnBrief(x, path) {
  const o = record(x, path, ['ply', 'me', 'phase', 'check', 'n', 'back', 'eval', 'mat', 'level', 'moments', 'taught', 'mine', 'opp',
    'threats', 'chance', 'known']);
  return {
    ply: int(o.ply, at(path, 'ply'), 0, 600),
    me: /** @type {Color} */ (oneOf(o.me, at(path, 'me'), COLORS)),
    phase: oneOf(o.phase, at(path, 'phase'), PHASES),
    check: bool(o.check, at(path, 'check')),
    n: int(o.n, at(path, 'n'), 0, 120),
    back: nullable(o.back, at(path, 'back'), (v, p) => oneOf(v, p, BACKS)),
    eval: evaluation(o.eval, at(path, 'eval')),
    mat: material(o.mat, at(path, 'mat')),
    level: int(o.level, at(path, 'level'), 1, 9),
    moments: list(o.moments, at(path, 'moments'), LIMITS.MOMENTS, moment),
    taught: list(o.taught, at(path, 'taught'), LIMITS.TAUGHT, (v, p) => oneOf(v, p, TAUGHT_CODES)),
    mine: nullable(o.mine, at(path, 'mine'), (v, p) => {
      const r = record(v, p, ['move', 'cat', 'waited', 'self', 'try']);
      return compact({
        move: notation(r.move, at(p, 'move')),
        cat: cat(r.cat, at(p, 'cat')),
        waited: bool(r.waited, at(p, 'waited')),
        self: bool(r.self, at(p, 'self')),
        try: optional(r.try, at(p, 'try'), tryPacket),
      });
    }),
    opp: nullable(o.opp, at(path, 'opp'), oppMove),
    threats: list(o.threats, at(path, 'threats'), LIMITS.THREATS, threat),
    chance: nullable(o.chance, at(path, 'chance'), (v, p) => {
      const r = record(v, p, ['size', 'theme', 'area']);
      return { size: oneOf(r.size, at(p, 'size'), CHANCE_SIZES), theme: motif(r.theme, at(p, 'theme')), area: area(r.area, at(p, 'area')) };
    }),
    known: knownFlags(o.known, at(path, 'known')),
  };
}

/** Keys every event may carry (section 3.6, "Every event"). */
const COMMON_KEYS = ['i', 'kind', 'cue', 'said', 'reply', 'v', 'tools'];
/** @type {Record<CoachEvent['kind'], readonly string[]>} */
const KIND_KEYS = {
  start: ['first'], opp: [], hint: ['level', 'hint'], try: ['n', 'try'], ask: ['ask', 'say', 'more'], over: ['over'], recap: ['recap'],
};
const EVENT_KEYS = [...COMMON_KEYS, ...EVENT_KINDS.flatMap((kind) => KIND_KEYS[kind])];

/**
 * The child's sentence (rule 4): only on the last event, only on a free question, 1..120 characters after sanitizeSay.
 * @param {unknown} x @param {string} path @param {boolean} allowed
 * @returns {string|undefined}
 */
function childSay(x, path, allowed) {
  if (!allowed) return x === undefined ? undefined : fail(path, 'forbidden');
  if (x === undefined) return fail(path, 'missing');
  if (typeof x !== 'string') return fail(path, 'type');
  if (codePoints(x) > LIMITS.SAY_CHARS) return fail(path, 'too_long');
  const say = sanitizeSay(x);
  return say === '' ? fail(path, 'empty') : say;
}

/**
 * The fields of an event that belong to its kind.
 * @param {Record<string, unknown>} o @param {string} path @param {CoachEvent['kind']} kind @param {boolean} last
 * @returns {StartEvent|OppEvent|HintEvent|TryEvent|AskEvent|OverEvent|RecapEvent}
 */
function eventBody(o, path, kind, last) {
  switch (kind) {
    case 'start':
      return compact({ kind, first: optional(o.first, at(path, 'first'), bool) });
    case 'opp':
      return { kind };
    case 'hint': {
      const level = /** @type {1|2|3} */ (int(o.level, at(path, 'level'), 1, 3));
      return { kind, level, hint: hintPacket(o.hint, at(path, 'hint'), level) };
    }
    case 'try':
      return { kind, n: int(o.n, at(path, 'n'), 1, 40), try: tryPacket(o.try, at(path, 'try')) };
    case 'ask': {
      const ask = oneOf(o.ask, at(path, 'ask'), ASK_CODES);
      const say = childSay(o.say, at(path, 'say'), last && ask === 'free');
      // Rule 6: the withheld packet travels only with a question it can answer.
      if (o.more !== undefined && !MORE_ASKS.includes(ask)) return fail(at(path, 'more'), 'forbidden');
      return compact({ kind, ask, say, more: optional(o.more, at(path, 'more'), morePacket) });
    }
    case 'over':
      return { kind, over: overPacket(o.over, at(path, 'over')) };
    default:
      return { kind, recap: recapPacket(o.recap, at(path, 'recap')) };
  }
}

/**
 * The signed reply of an event that the model answered (rule 3). The signature itself is verified by the proxy handler.
 * @param {unknown} x @param {string} path
 * @returns {{text:string, sig:string}}
 */
function signedReply(x, path) {
  const o = record(x, path, ['text', 'sig']);
  const p = at(path, 'text');
  if (o.text === undefined) return fail(p, 'missing');
  if (typeof o.text !== 'string') return fail(p, 'type');
  if (o.text === '') return fail(p, 'empty');
  if (codePoints(o.text) > LIMITS.REPLY_CHARS) return fail(p, 'too_long');
  return { text: o.text, sig: pattern(o.sig, at(path, 'sig'), SIG_RE) };
}

/**
 * One event: `i`, `kind`, its own fields, then the fields every event carries.
 * @param {unknown} x @param {string} path @param {boolean} last  the event to answer
 * @returns {CoachEvent}
 */
function coachEvent(x, path, last) {
  const kind = oneOf(record(x, path, EVENT_KEYS).kind, at(path, 'kind'), EVENT_KINDS);
  const o = record(x, path, [...COMMON_KEYS, ...KIND_KEYS[kind]]);
  const i = int(o.i, at(path, 'i'), 0, LIMITS.EVENT_INDEX_MAX);
  const body = eventBody(o, path, kind, last);
  const cue = optional(o.cue, at(path, 'cue'), (v, p) => oneOf(v, p, CUE_CODES));

  // Rule 3: how an earlier event was answered. The last event is the one to answer and says nothing about it.
  /** @type {CoachEvent['said']} */
  let said;
  /** @type {CoachEvent['reply']} */
  let reply;
  /** @type {number|undefined} */
  let v;
  if (last) {
    if (o.said !== undefined) return fail(at(path, 'said'), 'forbidden');
    if (o.reply !== undefined) return fail(at(path, 'reply'), 'forbidden');
    if (o.v !== undefined) return fail(at(path, 'v'), 'forbidden');
  } else {
    said = oneOf(o.said, at(path, 'said'), SAID);
    if (said === 'llm') reply = signedReply(o.reply, at(path, 'reply'));
    else if (o.reply !== undefined) return fail(at(path, 'reply'), 'forbidden');
    if (said === 'local') v = int(o.v, at(path, 'v'), 0, LIMITS.VARIANTS - 1);
    else if (o.v !== undefined) return fail(at(path, 'v'), 'forbidden');
  }
  const tools = optional(o.tools, at(path, 'tools'), (t, p) => list(t, p, EVENT_TOOLS, toolRecord));

  return compact({ i, ...body, cue, said, reply, v, tools });
}

/**
 * Rule 5: what may follow what inside one thread.
 * @param {CoachEvent[]} events @param {string} path
 */
function checkThread(events, path) {
  const over = events[0].kind === 'over';
  let activeTry = false;
  let hintLevel = 0;
  events.forEach((ev, k) => {
    const p = at(path, k);
    if (k > 0 && (ev.kind === 'start' || ev.kind === 'opp' || ev.kind === 'over' || ev.kind === 'recap')) fail(at(p, 'kind'), 'order');
    if (over && k > 0) {
      if (ev.kind !== 'ask') fail(at(p, 'kind'), 'order');
      else if (!OVER_ASKS.includes(ev.ask)) fail(at(p, 'ask'), 'order');
    }
    if (ev.kind === 'try') {
      activeTry = true;
    } else if (ev.kind === 'recap') {
      // A recap stands for the events it replaced and must never make a valid thread invalid: the tries it lists (or its `cur`)
      // count as earlier try events. Its `hint` is data, not a hint event, and sets no floor for the hint events that follow
      // (the rule compares hint events; how a client fills `recap.hint` is not the validator's business).
      activeTry = ev.recap.cur !== undefined || ev.recap.tries.length > 0;
    } else if (ev.kind === 'hint') {
      if (ev.level < hintLevel) fail(at(p, 'level'), 'order');
      hintLevel = ev.level;
    } else if (ev.kind === 'ask' && !over && TRY_ASKS.includes(ev.ask) && !activeTry) {
      fail(at(p, 'ask'), 'no_try');
    }
  });
}

/**
 * Validates a request body (rules: contract section 4.10). `value` is a normalised copy in schema key order:
 * the fields of each typedef in the order section 3.6 lists them; an event is `i, kind, <its own fields>, cue, said, reply, v, tools`.
 * The copy equals the input except that `say` has gone through `sanitizeSay`.
 *
 * Pure: the signature of an earlier reply (rule 3), the resume token (rule 7) and the rendered length (rule 8) are checked by the
 * proxy handler, which owns the signer and the renderer. A wrong protocol version is reported as `path: 'v'`, `why: 'version'`.
 * @param {unknown} body
 * @returns {{ok:true, value:CoachRequest} | {ok:false, path:string, why:string}}
 */
export function validateCoachRequest(body) {
  try {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('', 'type');
    if (/** @type {Record<string, unknown>} */ (body).v !== PROTOCOL_VERSION) return fail('v', 'version');
    const o = record(body, '', ['v', 'turn', 'events', 'resume']);
    const turn = turnBrief(o.turn, 'turn');

    if (o.events === undefined) return fail('events', 'missing');
    if (!Array.isArray(o.events)) return fail('events', 'type');
    if (o.events.length === 0) return fail('events', 'empty');
    if (o.events.length > LIMITS.EVENTS) return fail('events', 'too_many');
    const count = o.events.length;
    /** @type {CoachEvent[]} */
    const events = [];
    o.events.forEach((raw, k) => {
      const ev = coachEvent(raw, at('events', k), k === count - 1);
      // Rule 2: the index is stable in the thread and strictly increasing along the array.
      if (k > 0 && ev.i <= events[k - 1].i) fail(at(at('events', k), 'i'), 'order');
      events.push(ev);
    });
    checkThread(events, 'events');

    const resume = optional(o.resume, 'resume', (r, p) => {
      const m = record(r, p, ['token', 'results']);
      if (typeof m.token === 'string' && m.token.length > LIMITS.RESUME_TOKEN_BYTES) return fail(at(p, 'token'), 'too_long');
      return { token: pattern(m.token, at(p, 'token'), TOKEN_RE), results: list(m.results, at(p, 'results'), RESUME_RESULTS, toolResult) };
    });
    return { ok: true, value: compact({ v: /** @type {1} */ (PROTOCOL_VERSION), turn, events, resume }) };
  } catch (err) {
    if (err instanceof Reject) return { ok: false, path: err.path, why: err.why };
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The tool, the child's sentence, canonical JSON
// ---------------------------------------------------------------------------------------------------------------------

/** 2..8 CJK characters or digits, full-width digits allowed. */
const TOOL_NOTATION_RE = /^[一-鿿0-9０-９]{2,8}$/;

/**
 * Validates the arguments of a model tool call. Exact parsing needs the board and happens in the browser.
 * @param {string} name
 * @param {unknown} input
 * @returns {{notation:string, after:string[]}|null}
 */
export function validateToolInput(name, input) {
  if (name !== 'analyze_move') return null;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { notation: move, after } = /** @type {Record<string, unknown>} */ (input);
  if (typeof move !== 'string' || !TOOL_NOTATION_RE.test(move)) return null;
  if (!Array.isArray(after) || after.length > LIMITS.TOOL_AFTER) return null;
  /** @type {string[]} */
  const before = [];
  for (const item of after) {
    if (typeof item !== 'string' || !TOOL_NOTATION_RE.test(item)) return null;
    before.push(item);
  }
  return { notation: move, after: before };
}

/** @type {Record<string, string>} */
const DELIMITER = { '「': '“', '」': '”', '〔': '(', '〕': ')', '【': '[', '】': ']' };
const ELLIPSIS = '…';
const SAY_URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const SAY_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const SAY_DIGITS_RE = /\p{Nd}{7,}/gu;
/** Control characters other than the white-space ones, which are collapsed instead. */
const SAY_CONTROL_RE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;

/**
 * NFKC; strip control characters; collapse whitespace; replace 「」〔〕【】 with “”()[]; replace runs of 7+ digits, e-mail addresses
 * and URLs with …; cut to LIMITS.SAY_CHARS code points. An empty result must not be sent.
 *
 * Applying it twice gives the same text as applying it once (both sides apply it, section 7.13). Two things make that hold:
 * an ellipsis is kept as it is (NFKC alone would turn it into three dots), and the control characters are removed before the text
 * is normalised (removed afterwards, one that stood between a letter and a combining mark would leave a pair that the second
 * pass composes).
 * @param {string} s
 * @returns {string}
 */
export function sanitizeSay(s) {
  let t = String(s ?? '').replace(SAY_CONTROL_RE, '');
  t = t.split(ELLIPSIS).map((part) => part.normalize('NFKC')).join(ELLIPSIS);
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/[「」〔〕【】]/g, (c) => DELIMITER[c]);
  t = t.replace(SAY_URL_RE, ELLIPSIS).replace(SAY_EMAIL_RE, ELLIPSIS).replace(SAY_DIGITS_RE, ELLIPSIS);
  return [...t].slice(0, LIMITS.SAY_CHARS).join('').trim();
}

/**
 * Deterministic JSON: object keys sorted, no whitespace.
 * Like JSON.stringify otherwise: a member that is undefined, a function or a symbol is left out of an object and is null in an array.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const o = /** @type {Record<string, unknown>} */ (value);
    const members = [];
    for (const key of Object.keys(o).sort()) {
      const member = o[key];
      if (member === undefined || typeof member === 'function' || typeof member === 'symbol') continue;
      members.push(JSON.stringify(key) + ':' + canonicalJson(member));
    }
    return '{' + members.join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}
