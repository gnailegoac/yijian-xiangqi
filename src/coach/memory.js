// src/coach/memory.js (C2) — GameMemory: what the strategist remembers of one game (contract section 4.16).
// Each record carries its ply so `rewind` is exact. No chat text is stored.

/**
 * @import { Cat, HabitCode, MotifCode } from '../core/codes.js'
 * @import { N, TryPacket, MorePacket, OppMove, Moment, TurnBrief } from './types.js'
 */

import { HABIT_CODES, MOTIF_CODES, PATTERN_CODES, TACTIC_MOTIFS } from '../core/codes.js';
import { LIMITS, PROTOCOL_VERSION, validateCoachRequest } from './protocol.js';

/**
 * @typedef {Object} GameMemory
 * @property {(ply:number, info:{move:N, cat:Cat, waited:boolean, self:boolean, packet:TryPacket|null, more:MorePacket|null, forced?:boolean}) => void} noteMine
 *           forced (optional, CONTRACT-NOTES 138): the move was made with at most two legal moves; it leaves no 'great' moment
 * @property {(ply:number, opp:OppMove) => void} noteOpp
 * @property {(codes:string[]) => void} noteTaught
 * @property {(code:HabitCode) => void} noteHabit           the habit was mentioned this game
 * @property {(code:HabitCode) => boolean} habitMentioned
 * @property {(ply:number) => void} rewind                   drops everything recorded at or after `ply`
 * @property {() => {moments:Moment[], taught:string[], mine:TurnBrief['mine']}} snapshot
 * @property {() => object} toJSON
 */

/** Version of the saved shape (`toJSON`). */
const MEMORY_VERSION = 1;
const PLY_MAX = 600;
/**
 * How much is kept behind what `snapshot` reports, so that an undo brings back what the strategist knew before:
 * records older than the six moments / eight codes / one previous move of the snapshot.
 */
const MOMENT_HISTORY = 48;
const TAUGHT_HISTORY = 64;
const MINE_HISTORY = 24;
/** The most recent moves of the child that keep their packet (`mine.try`); older ones keep move and verdict only. */
const MINE_PACKETS = 4;

/** A brief that validates and says nothing: the frame in which one remembered item is checked against the wire rules. */
const PROBE_TURN = Object.freeze({
  ply: 0, me: 'red', phase: 'opening', check: false, n: 0, back: null, eval: { b: 'even' }, mat: { me: '', opp: '', cp: 0 }, level: 1,
  moments: [], taught: [], mine: null, opp: null, threats: [], chance: null, known: { threats: false, chance: false },
});

/**
 * The brief `validateCoachRequest` returns for the probe brief with `part` filled in, or null when the wire rules reject it.
 * Whatever passes here can be sent in a `TurnBrief` later without making the request invalid.
 * @param {Partial<Record<'moments'|'mine', unknown>>} part
 * @returns {TurnBrief|null}
 */
function probe(part) {
  try {
    const result = validateCoachRequest({ v: PROTOCOL_VERSION, turn: { ...PROBE_TURN, ...part }, events: [{ i: 0, kind: 'start' }] });
    return result.ok ? result.value.turn : null;
  } catch {
    return null;
  }
}

/** @param {unknown} x @returns {Moment|null} a wire-valid copy, or null */
const cleanMoment = (x) => probe({ moments: [x] })?.moments[0] ?? null;

/**
 * A wire-valid copy of a `mine` record. A packet that the wire rules reject is dropped and the move is kept without it.
 * @param {unknown} x @returns {NonNullable<TurnBrief['mine']>|null}
 */
function cleanMine(x) {
  if (typeof x !== 'object' || x === null) return null;
  const whole = probe({ mine: x })?.mine ?? null;
  if (whole !== null || !('try' in x)) return whole;
  const { try: _dropped, ...bare } = /** @type {Record<string, unknown>} */ (x);
  return probe({ mine: bare })?.mine ?? null;
}

/** @param {unknown} code @returns {code is string} a motif or pattern code (what `TurnBrief.taught` may carry) */
function isTaughtCode(code) {
  return typeof code === 'string' && (/** @type {readonly string[]} */ (MOTIF_CODES).includes(code)
    || /** @type {readonly string[]} */ (PATTERN_CODES).includes(code));
}

/** @param {unknown} code @returns {code is HabitCode} */
const isHabit = (code) => typeof code === 'string' && /** @type {readonly string[]} */ (HABIT_CODES).includes(code);

/** @param {unknown} ply @returns {ply is number} */
const isPly = (ply) => typeof ply === 'number' && Number.isInteger(ply) && ply >= 0 && ply <= PLY_MAX;

/** @param {number} ply @returns {number} move number of the move played at `ply` */
const moveNumber = (ply) => Math.floor(ply / 2) + 1;

/** @template T @param {T} value @returns {T} a deep copy of plain JSON data */
const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * Appends a record keeping the list ordered by ply (a record of the same ply is replaced when `unique`), then cuts the list to
 * its most recent `keep` records.
 * @template {{ply:number}} R
 * @param {R[]} list @param {R} record @param {number} keep @param {boolean} unique
 */
function put(list, record, keep, unique) {
  if (unique) {
    for (let k = list.length - 1; k >= 0; k--) if (list[k].ply === record.ply) list.splice(k, 1);
  }
  list.push(record);
  list.sort((a, b) => a.ply - b.ply);                       // stable: records of one ply keep their order
  if (list.length > keep) list.splice(0, list.length - keep);
}

/** Only the most recent MINE_PACKETS moves keep their packet. @param {{ply:number, mine:TurnBrief['mine']}[]} mines */
function thinPackets(mines) {
  for (let k = 0; k < mines.length - MINE_PACKETS; k++) delete mines[k].mine?.try;
}

/**
 * The packet of a move that was played, with nothing withheld (contract section 4.14.1): `held` false and the rival's reply
 * filled in from the withheld `more` packet.
 * @param {TryPacket} packet @param {MorePacket|null|undefined} more
 * @returns {TryPacket}
 */
function unwithheld(packet, more) {
  return { ...packet, held: false, reply: packet.reply ?? more?.reply ?? null };
}

/**
 * What a confirmed move of the child leaves behind, if anything (contract section 4.16), first match:
 * - a taken chance, or an earned `best` / `brilliant` -> 'great'. `noteMine` is not told whether the praise was earned, so the
 *   clauses of `isEarned` (section 4.14.5) that a packet shows are used: the only move, a trap stepped around, a tactic motif;
 * - a missed chance that cost nothing concrete (the try was not held) -> 'missed';
 * - a `mistake` / `blunder` -> 'slip'.
 * A forced move (made with at most two legal moves, CONTRACT-NOTES 138) is never 'great': there was nothing to find.
 * @param {NonNullable<TurnBrief['mine']>} mine @param {boolean} held  the try was held (it loses something concrete)
 * @param {boolean} forced
 * @returns {{tag:Moment['tag'], k:MotifCode|undefined}|null}
 */
function momentOfMine(mine, held, forced) {
  const packet = mine.try;
  const lead = packet?.does[0]?.k;
  const flaw = packet?.flaws[0]?.k;
  if (packet) {
    if (packet.chance === 'taken' && !forced) return { tag: 'great', k: lead };
    const earned = packet.only === true || packet.avoided !== undefined
      || (lead !== undefined && /** @type {readonly string[]} */ (TACTIC_MOTIFS).includes(lead));
    if ((mine.cat === 'best' || mine.cat === 'brilliant') && earned && !forced) return { tag: 'great', k: lead };
    if (packet.chance === 'missed' && !held) return { tag: 'missed', k: flaw ?? packet.toward?.theme };
  }
  if (mine.cat === 'mistake' || mine.cat === 'blunder') return { tag: 'slip', k: flaw };
  if (packet?.chance === 'missed') return { tag: 'missed', k: flaw ?? packet.toward?.theme };
  return null;
}

/**
 * The memory of one game.
 *
 * Plies: a move is recorded under its index in the game (the ply of the position it was played in), as the director passes it
 * to `noteMine` / `noteOpp`. `noteTaught` has no ply argument: a code is recorded under the ply of the position the child is
 * facing, which the memory tracks itself: one past the last move noted, and `ply` after `rewind(ply)` (the director rewinds to
 * the position the game stands at, after an undo and after loading a save).
 *
 * `snapshot()` reports the six most recent moments, the eight most recently explained codes (each once, oldest first) and the
 * child's previous move. `mine.try` is that move's packet with nothing withheld (section 4.14.1). More than that is kept
 * behind the snapshot (bounded), so that after `rewind` the snapshot is what it was when the game first stood at that ply.
 * A move that was noted but cannot be reported (no verdict yet, or not a notation) is remembered as unknown: `mine` is then
 * null, never the move before it, until the move is noted again with what was missing.
 *
 * `noteHabit` / `habitMentioned` are about what the child has heard in this game: a mention is not taken back by `rewind`
 * (a habit is mentioned at most once per game, D-41, also when the child undoes and walks into the same trap again).
 *
 * Everything that is noted is checked against the wire rules of the coach protocol first; what would make a `TurnBrief`
 * invalid is not recorded. No method throws on bad input.
 *
 * @param {unknown} saved  GameMemory.toJSON() from a save, or null; anything else, and every item in it that does not validate,
 *                         is ignored
 * @returns {GameMemory}
 */
export function createGameMemory(saved) {
  /** @type {{ply:number, moment:Moment}[]}  ply = index of the move in the game */
  const moments = [];
  /** @type {{ply:number, code:string}[]}  ply = the position the child faced when the code was explained */
  const taught = [];
  /** @type {{ply:number, mine:TurnBrief['mine']}[]}  ply = index of the child's move in the game; mine null = played, not reportable */
  const mines = [];
  /** @type {HabitCode[]} */
  const habits = [];
  /** Ply of the position the game stands at, as far as the memory was told. */
  let at = 0;

  /** @param {number} ply @param {Moment['tag']} tag @param {Moment['s']} s @param {unknown} move @param {unknown} k */
  function putMoment(ply, tag, s, move, k) {
    const moment = cleanMoment(k === undefined ? { n: moveNumber(ply), s, move, tag } : { n: moveNumber(ply), s, move, tag, k })
      ?? cleanMoment({ n: moveNumber(ply), s, move, tag });
    if (moment !== null) put(moments, { ply, moment }, MOMENT_HISTORY, true);
  }

  /** @param {number} ply */
  function dropMoment(ply) {
    for (let k = moments.length - 1; k >= 0; k--) if (moments[k].ply === ply) moments.splice(k, 1);
  }

  if (typeof saved === 'object' && saved !== null && !Array.isArray(saved)
    && /** @type {Record<string, unknown>} */ (saved).v === MEMORY_VERSION) {
    const o = /** @type {Record<string, unknown>} */ (saved);
    /** @param {unknown} x @returns {Record<string, unknown>[]} */
    const records = (x) => (Array.isArray(x) ? x.filter((r) => typeof r === 'object' && r !== null && isPly(r.ply)) : []);
    for (const r of records(o.moments)) {
      const moment = cleanMoment(r.moment);
      if (moment !== null) put(moments, { ply: /** @type {number} */ (r.ply), moment }, MOMENT_HISTORY, true);
    }
    for (const r of records(o.taught)) {
      if (isTaughtCode(r.code)) put(taught, { ply: /** @type {number} */ (r.ply), code: r.code }, TAUGHT_HISTORY, false);
    }
    for (const r of records(o.mine)) {
      const mine = r.mine === null ? null : cleanMine(r.mine);
      if (mine !== null || r.mine === null) put(mines, { ply: /** @type {number} */ (r.ply), mine }, MINE_HISTORY, true);
    }
    thinPackets(mines);
    if (Array.isArray(o.habits)) {
      for (const code of o.habits) if (isHabit(code) && !habits.includes(code)) habits.push(code);
    }
    // The position the game stands at: never before a remembered move or explanation.
    at = isPly(o.at) ? o.at : 0;
    for (const r of [...moments, ...mines]) at = Math.max(at, r.ply + 1);
    for (const r of taught) at = Math.max(at, r.ply);
  }

  return {
    noteMine(ply, info) {
      if (!isPly(ply) || typeof info !== 'object' || info === null) return;
      const bare = { move: info.move, cat: info.cat, waited: info.waited === true, self: info.self === true };
      const packet = typeof info.packet === 'object' && info.packet !== null ? info.packet : null;
      const mine = cleanMine(packet ? { ...bare, try: unwithheld(packet, info.more) } : bare);
      // a move the wire rules reject (its verdict is still pending, say) was played all the same: it is kept as unknown, so
      // that the move before it is not reported as the child's previous move
      put(mines, { ply, mine }, MINE_HISTORY, true);
      thinPackets(mines);
      at = Math.max(at, ply + 1);

      dropMoment(ply);
      if (mine === null) return;
      const found = momentOfMine(mine, mine.try !== undefined && packet?.held === true, info.forced === true);
      if (found !== null) putMoment(ply, found.tag, 'me', mine.move, found.k);
    },

    noteOpp(ply, opp) {
      if (!isPly(ply) || typeof opp !== 'object' || opp === null) return;
      at = Math.max(at, ply + 1);
      dropMoment(ply);
      if (opp.punishes === true) putMoment(ply, 'punished', 'opp', opp.move, Array.isArray(opp.does) ? opp.does[0]?.k : undefined);
    },

    noteTaught(codes) {
      if (!Array.isArray(codes)) return;
      for (const code of codes) {
        if (isTaughtCode(code)) put(taught, { ply: at, code }, TAUGHT_HISTORY, false);
      }
    },

    noteHabit(code) {
      if (isHabit(code) && !habits.includes(code)) habits.push(code);
    },

    habitMentioned(code) {
      return habits.includes(code);
    },

    rewind(ply) {
      if (typeof ply !== 'number' || Number.isNaN(ply)) return;
      for (const list of [moments, taught, mines]) {
        for (let k = list.length - 1; k >= 0; k--) if (list[k].ply >= ply) list.splice(k, 1);
      }
      // the game now stands at `ply` (an undo, or a save loaded at that ply): what is explained next is stamped with it
      at = Math.min(PLY_MAX, Math.max(0, Math.ceil(ply)));
    },

    snapshot() {
      /** @type {string[]} */
      const codes = [];
      for (let k = taught.length - 1; k >= 0 && codes.length < LIMITS.TAUGHT; k--) {
        if (!codes.includes(taught[k].code)) codes.push(taught[k].code);
      }
      return {
        moments: moments.slice(-LIMITS.MOMENTS).map((r) => copy(r.moment)),
        taught: codes.reverse(),
        mine: mines.length > 0 ? copy(mines[mines.length - 1].mine) : null,
      };
    },

    toJSON() {
      return copy({ v: MEMORY_VERSION, at, moments, taught, mine: mines, habits });
    },
  };
}
