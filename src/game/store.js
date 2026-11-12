// Store (SPEC 4.20): persistence, v1 migration, settings, profile. Schema and migration: SPEC section 13.
// Writes are synchronous. Events: onSettings callbacks. Owner: G3.
//
// Three independent localStorage records (game, settings, profile), each JSON with its own `schema: 2`.
// The v1 key is read once, never written, never deleted. One quarantine slot keeps the raw text of a record that could
// not be used. No name, age, free text or chat transcript is ever stored.
//
// Readings chosen where SPEC 13 leaves a case open:
// - KEYS.migrated is written by the first load() that finds no v2 game, whether or not a v1 save exists. It is not
//   written while an imported game could not be stored, so that the import is tried again on the next load.
// - The profile seeded from the old difficulty is stored together with the migrated game (a reload must not lose the seed).
// - After a successful importBackup() KEYS.migrated holds 'imported' until the next load(), which returns the notice
//   'imported' once and resets the value to "1".
// - A profile record that is not JSON is quarantined like a newer one (no notice exists for it).
// - A game record with a malformed entry is loaded up to that entry; its raw text is copied to the quarantine slot first.
// - A game record without a `start` field is read as `start: null`.
// - When load() cannot read the storage, nothing is written during that page session (what could not be read is not replaced).
// - 'storage-unavailable' is produced once per store; load() is the only call that can return it, so a write that
//   first fails after load() is visible through available() and the boolean results only.

/**
 * @import { SkillProfile, GameSkill } from '../core/types.js'
 * @import { HabitCode } from '../core/codes.js'
 * @import { Settings, Profile, SavedGame, Backup, Notice } from './types.js'
 */

import { HABIT_CODES } from '../core/codes.js';

export const KEYS = {
  game: 'yijian.xiangqi.v2.game', settings: 'yijian.xiangqi.v2.settings', profile: 'yijian.xiangqi.v2.profile',
  migrated: 'yijian.xiangqi.v2.migrated',        // "1" once the v1 import was attempted
  quarantine: 'yijian.xiangqi.quarantine',       // single slot {kind, at, why, raw}: the backup copy of a record that could not be used
  v1: 'yijian.xiangqi.v1',                       // read-only
};
export const SCHEMA = 2;

const MAX_MOVES = 2000;                          // moves accepted on load (13.3, 13.4)
const MOVE_CODE_RE = /^[0-9][0-8][0-9][0-8]$/;   // MoveCode (3.1)
const GAME_ID_RE = /^g-[a-z0-9]{6,16}$/;         // SavedGame.id (3.9)
const QUARANTINE_MAX_CHARS = 200000;             // 13.4
const V1_ACTIVE_CAP_MS = 3 * 60 * 60 * 1000;     // 13.3: activeMs of a migrated game is capped at 3 h
const UINT32_RANGE = 4294967296;
const RANK_MIN = 1, RANK_MAX = 9;
// Value of KEYS.migrated between a successful importBackup and the next load(), which reports 'imported' and resets it to "1".
const IMPORTED_MARK = 'imported';

// ---------------------------------------------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------------------------------------------

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON text -> value; `undefined` when there is no text or it does not parse. @param {string|null|undefined} text @returns {unknown} */
function parseValue(text) {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** What getItem returned, as Storage defines it: the string, else null (a stand-in may return undefined for a missing key). @param {unknown} v @returns {string|null} */
function textOrNull(v) {
  return typeof v === 'string' ? v : null;
}

/** JSON text -> plain object, or null. @param {string|null|undefined} text @returns {Record<string, unknown>|null} */
function parseRecord(text) {
  const value = parseValue(text);
  return isRecord(value) ? value : null;
}

/** A finite number, else null. @param {unknown} v @returns {number|null} */
function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Coerce to a non-negative integer (anything that is not a finite number counts as 0). @param {unknown} v @returns {number} */
function count(v) {
  const n = finite(v);
  return n !== null && n > 0 ? Math.trunc(n) : 0;
}

/** 13.3: finite and positive, clamped to now, else now. @param {unknown} v @param {number} now @returns {number} */
function stamp(v, now) {
  const n = finite(v);
  return n !== null && n > 0 ? Math.min(now, n) : now;
}

/** 13.3: kept only if startedAt <= endedAt <= now. @param {unknown} v @param {number} startedAt @param {number} now @returns {number|null} */
function endStamp(v, startedAt, now) {
  const n = finite(v);
  return n !== null && n >= startedAt && n <= now ? n : null;
}

/** 13.3: only a resignation with a red / black winner is stored. @param {unknown} v @returns {SavedGame['result']} */
function resignResult(v) {
  if (!isRecord(v) || v.reason !== 'resign') return null;
  if (v.winner !== 'red' && v.winner !== 'black') return null;
  return { winner: v.winner, reason: 'resign' };
}

/** @returns {number} uint32 */
function randomUint32() {
  const source = globalThis.crypto;
  if (source && typeof source.getRandomValues === 'function') return source.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * UINT32_RANGE);
}

/** "g-" + 8 base36 characters, the shape session.js gives its ids. @returns {string} */
function freshGameId() {
  let id = 'g-';
  for (let i = 0; i < 8; i++) id += (randomUint32() % 36).toString(36);
  return id;
}

/** The rank that belongs to a level: round(level) within 1..9. @param {unknown} level @returns {number} */
function rankOfLevel(level) {
  const n = finite(level);
  return n === null ? RANK_MIN : Math.min(RANK_MAX, Math.max(RANK_MIN, Math.round(n)));
}

/** @param {unknown} v @returns {v is HabitCode} */
function isHabitCode(v) {
  return typeof v === 'string' && /** @type {readonly string[]} */ (HABIT_CODES).includes(v);
}

/** The record was written by a newer version of the app. @param {Record<string, unknown>} rec @returns {boolean} */
function isNewer(rec) {
  const schema = finite(rec.schema);
  return schema !== null && schema > SCHEMA;
}

/** SavedGame.start is reserved: anything but null (or an absent field) is treated as "newer". @param {Record<string, unknown>} rec @returns {boolean} */
function hasStart(rec) {
  return rec.start !== null && rec.start !== undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// future versions (13.4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Upgrade steps per record kind: UPGRADERS[kind][n] turns a schema-n record into a schema-(n+1) record.
 * Empty for schema 2 (the first schema that has upgraders at all). New optional fields need no step.
 * @type {Record<'game'|'settings'|'profile', Record<number, (rec:Record<string, unknown>) => Record<string, unknown>>>}
 */
const UPGRADERS = { game: {}, settings: {}, profile: {} };

/**
 * Applies the steps from rec.schema up to SCHEMA. A record without a usable schema number is taken as current.
 * @param {'game'|'settings'|'profile'} kind
 * @param {Record<string, unknown>} rec
 * @returns {Record<string, unknown>}
 */
function upgrade(kind, rec) {
  const from = finite(rec.schema);
  if (from === null || !Number.isInteger(from)) return rec;
  let out = rec;
  // no step exists below 0: a damaged record with a huge negative schema must not keep the page busy counting up to it
  for (let v = Math.max(0, from); v < SCHEMA; v++) {
    const step = UPGRADERS[kind][v];
    if (step) out = step(out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {Exclude<keyof Settings, 'schema'>} SettingKey */

/**
 * @template {string} T
 * @param {readonly T[]} allowed
 * @returns {(v:unknown) => T|undefined}
 */
function oneOf(allowed) {
  return (v) => allowed.find((a) => a === v);
}

/** @param {unknown} v @returns {boolean|undefined} */
function flag(v) {
  return typeof v === 'boolean' ? v : undefined;
}

/** A finite number clamped to 0..1. @param {unknown} v @returns {number|undefined} */
function unit(v) {
  const n = finite(v);
  return n === null ? undefined : Math.min(1, Math.max(0, n));
}

/** The look the settings were saved under: 2 is the sand table (the first look had no number). */
const LOOK = 2;

/**
 * One row per setting: [default, validate]. validate returns the accepted (possibly clamped) value, or undefined to refuse.
 * Adding a setting is one row here and one property in the Settings typedef; no schema bump.
 * @type {{ readonly [K in SettingKey]: readonly [Settings[K], (v:unknown) => Settings[K]|undefined] }}
 */
const SETTINGS_SPEC = {
  theme: ['shachang', oneOf(['chibi', 'longzhong', 'shachang'])],
  look: [LOOK, (v) => (v === LOOK ? LOOK : undefined)],
  sfx: [true, flag],
  music: [true, flag],
  volume: [1.0, unit],
  motion: ['auto', oneOf(['auto', 'full', 'reduced'])],
  haptics: [true, flag],
  typeTicks: [false, flag],
  readAloud: [false, flag],
  side: ['red', oneOf(['red', 'black'])],
  coach: ['auto', oneOf(['auto', 'local'])],
  freeText: [true, flag],
  talk: ['smart', oneOf(['smart', 'more'])],
};
const SETTING_KEYS = /** @type {SettingKey[]} */ (Object.keys(SETTINGS_SPEC));

/**
 * @template {SettingKey} K
 * @param {Settings} target
 * @param {K} key
 */
function resetSetting(target, key) {
  target[key] = SETTINGS_SPEC[key][0];
}

/**
 * Stores `value` under `key` when its validator accepts it; otherwise the target keeps what it has.
 * @template {SettingKey} K
 * @param {Settings} target
 * @param {K} key
 * @param {unknown} value
 */
function applySetting(target, key, value) {
  const checked = SETTINGS_SPEC[key][1](value);
  if (checked !== undefined) target[key] = checked;
}

/** @returns {Settings} */
function defaultSettings() {
  const out = /** @type {Settings} */ ({ schema: SCHEMA });
  for (const key of SETTING_KEYS) resetSetting(out, key);
  return out;
}

/**
 * per-key fallback to default; never null
 * @param {unknown} raw
 * @returns {Settings}
 */
export function sanitizeSettings(raw) {
  const out = defaultSettings();
  if (isRecord(raw)) {
    for (const key of SETTING_KEYS) applySetting(out, key, raw[key]);
    // A record saved under an older look chose its theme among pictures that no longer exist: it gets the new
    // default once. The record is written back with the current `look`, so a theme picked after that stays.
    if (raw.look !== LOOK) resetSetting(out, 'theme');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// game
// ---------------------------------------------------------------------------------------------------------------

/**
 * null = corrupt
 * @param {unknown} raw
 * @param {number} now      epoch ms
 * @returns {SavedGame|null}
 */
export function sanitizeGame(raw, now) {
  if (!isRecord(raw)) return null;
  const list = raw.moves;
  if (!Array.isArray(list) || list.length > MAX_MOVES) return null;
  /** @type {string[]} */
  const moves = [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !MOVE_CODE_RE.test(entry)) break;      // legality is session.restore's job
    moves.push(entry);
  }
  const startedAt = stamp(raw.startedAt, now);
  return {
    schema: SCHEMA,
    id: typeof raw.id === 'string' && GAME_ID_RE.test(raw.id) ? raw.id : freshGameId(),
    humanColor: raw.humanColor === 'black' ? 'black' : 'red',
    moves,
    result: resignResult(raw.result),
    startedAt,
    endedAt: endStamp(raw.endedAt, startedAt, now),
    activeMs: count(raw.activeMs),
    counted: Boolean(raw.counted),
    drawFrom: Math.min(count(raw.drawFrom), moves.length),
    seed: count(raw.seed) % UINT32_RANGE,
    skill: isRecord(raw.skill) ? raw.skill : null,          // sanitised by teacher.reviveGameSkill in director.loadExtras
    memory: isRecord(raw.memory) ? raw.memory : null,       // sanitised by memory.createGameMemory in director.loadExtras
    start: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {Parameters<typeof createStore>[0]['teacher']} teacher
 * @param {number} now
 * @param {number} seedLevel
 * @returns {Profile}
 */
function freshProfile(teacher, now, seedLevel) {
  const skill = teacher.createSkillProfile(seedLevel);
  return { schema: SCHEMA, skill, games: { played: 0, won: 0, lost: 0, drawn: 0 }, rank: rankOfLevel(skill.level), goal: null, introSeen: false,
           createdAt: now };
}

/**
 * @param {unknown} raw
 * @param {Parameters<typeof createStore>[0]['teacher']} teacher
 * @param {number} now      epoch ms
 * @returns {Profile}
 */
export function sanitizeProfile(raw, teacher, now) {
  const src = isRecord(raw) ? raw : {};
  const skill = teacher.migrateSkillProfile(src.skill);
  const games = isRecord(src.games) ? src.games : {};
  // rank is a high-water mark of round(skill.level): never below the rank of the current level, never outside 1..9
  const levelRank = rankOfLevel(skill.level);
  const stored = finite(src.rank);
  const rank = stored !== null && Number.isInteger(stored) && stored >= RANK_MIN && stored <= RANK_MAX ? Math.max(stored, levelRank) : levelRank;
  const goal = isRecord(src.goal) && isHabitCode(src.goal.code) ? { code: src.goal.code, setAt: stamp(src.goal.setAt, now) } : null;
  return {
    schema: SCHEMA,
    skill,
    games: { played: count(games.played), won: count(games.won), lost: count(games.lost), drawn: count(games.drawn) },
    rank,
    goal,
    introSeen: src.introSeen === true,
    createdAt: stamp(src.createdAt, now),
  };
}

/**
 * @param {Profile} profile
 * @param {'win'|'loss'|'draw'} result
 * @returns {Profile}
 */
export function recordResult(profile, result) {
  const games = { ...profile.games };
  if (result === 'win') games.won += 1;
  else if (result === 'loss') games.lost += 1;
  else if (result === 'draw') games.drawn += 1;
  else return { ...profile, games };      // not a result: nothing is counted
  games.played += 1;
  return { ...profile, games };
}

// ---------------------------------------------------------------------------------------------------------------
// v1 migration (13.2, 13.3)
// ---------------------------------------------------------------------------------------------------------------

/**
 * A v1 coordinate: an integer, or the decimal string of one (v1 compared coordinates as text), within 0..max.
 * @param {unknown} v
 * @param {number} max
 * @returns {number|null}
 */
function v1Coordinate(v, max) {
  /** @type {number} */
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^[0-9]$/.test(v)) n = Number(v);
  else return null;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/** One v1 move entry {from:{row,col}, to:{row,col}} -> MoveCode, or null when it is not four in-range integers. @param {unknown} entry @returns {string|null} */
function v1MoveCode(entry) {
  if (!isRecord(entry) || !isRecord(entry.from) || !isRecord(entry.to)) return null;
  const fr = v1Coordinate(entry.from.row, 9), fc = v1Coordinate(entry.from.col, 8);
  const tr = v1Coordinate(entry.to.row, 9), tc = v1Coordinate(entry.to.col, 8);
  if (fr === null || fc === null || tr === null || tc === null) return null;
  return `${fr}${fc}${tr}${tc}`;
}

/**
 * @param {unknown} raw
 * @param {number} now      epoch ms
 * @returns {{ game:SavedGame, seedLevel:2|4|6, wasLocal:boolean } | null}
 */
export function migrateV1(raw, now) {
  if (!isRecord(raw) || raw.version !== 1) return null;                    // only version === 1 (number) is a v1 save
  const list = raw.moves;
  if (!Array.isArray(list) || list.length > MAX_MOVES) return null;        // v1 itself ignored such a save
  /** @type {string[]} */
  const moves = [];
  for (const entry of list) {
    const code = v1MoveCode(entry);
    if (code === null) break;                                              // legality is checked later by session.restore
    moves.push(code);
  }
  const startedAt = stamp(raw.startedAt, now);
  const endedAt = endStamp(raw.endedAt, startedAt, now);
  /** @type {SavedGame} */
  const game = {
    schema: SCHEMA,
    id: freshGameId(),
    humanColor: raw.humanColor === 'black' ? 'black' : 'red',
    moves,
    result: resignResult(raw.result),                                      // natural results are recomputed
    startedAt,
    endedAt,
    activeMs: Math.min(V1_ACTIVE_CAP_MS, Math.max(0, Math.trunc((endedAt ?? now) - startedAt))),
    counted: false,                                                        // set by app.js after session.restore
    drawFrom: moves.length,                                                // v1 had no draw rules: they count only plies played from now on
    seed: randomUint32(),
    skill: null,
    memory: null,
    start: null,
  };
  const seedLevel = raw.difficulty === 'easy' ? 2 : raw.difficulty === 'hard' ? 6 : 4;
  return { game, seedLevel, wasLocal: raw.mode === 'local' };
}

// ---------------------------------------------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {{ storage?: Storage|null, now?: () => number,
 *           teacher: { createSkillProfile(seedLevel?:number): SkillProfile, migrateSkillProfile(raw:unknown): SkillProfile,
 *                      reviveGameSkill(raw:unknown, seed:number): GameSkill } }} deps
 * @returns {Store}
 */
export function createStore(deps) {
  const teacher = deps.teacher;
  const now = deps.now ?? Date.now;

  /** @type {Storage|null} */
  let storage = null;
  if (deps.storage === undefined) {
    try {
      storage = globalThis.localStorage ?? null;      // the getter itself can throw (blocked site data)
    } catch {
      storage = null;
    }
  } else {
    storage = deps.storage;
  }

  let usable = storage !== null;        // what available() reports
  let unread = false;                   // load() could not read the storage: nothing is written over what was not read
  let noticed = false;                  // 'storage-unavailable' is produced once
  /** @type {Notice[]} */
  const pending = [];                   // notices waiting for load()
  /** @type {Settings|null} */
  let settings = null;                  // the settings in force; null until first needed
  /** @type {Set<(s:Settings) => void>} */
  const listeners = new Set();
  /** The JSON this tab last loaded or tried to save (kept when a write fails, so a backup can still be exported):
   *  undefined = not known yet, null = no record. @type {{game:string|null|undefined, profile:string|null|undefined}} */
  const shadow = { game: undefined, profile: undefined };
  /** Keys whose unusable record could not be copied to the quarantine slot: never overwritten in this session. @type {Set<string>} */
  const locked = new Set();

  function failed() {
    usable = false;
    if (!noticed) {
      noticed = true;
      pending.push('storage-unavailable');
    }
  }

  /** @param {string} key @returns {string|null} */
  function read(key) {
    if (storage === null || unread) return null;
    try {
      return textOrNull(storage.getItem(key));
    } catch {
      return null;
    }
  }

  /** @param {string} key @param {string} value @returns {boolean} */
  function write(key, value) {
    if (storage === null || unread || locked.has(key)) {
      failed();
      return false;
    }
    try {
      storage.setItem(key, value);
      usable = true;
      return true;
    } catch {
      failed();
      return false;
    }
  }

  /** @param {string} key @returns {boolean} */
  function remove(key) {
    if (storage === null || unread || locked.has(key)) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  /** Copies raw text into the single quarantine slot. @param {'game'|'profile'} kind @param {string} why @param {string} raw @returns {boolean} */
  function copyAside(kind, why, raw) {
    return write(KEYS.quarantine, JSON.stringify({ kind, at: now(), why, raw: raw.slice(0, QUARANTINE_MAX_CHARS) }));
  }

  /**
   * load() only: quarantine an unusable record and remove it, so the next save cannot destroy the only copy and the
   * app cannot loop on the same bad data. When the copy cannot be stored the record stays and its key is locked.
   * @param {'game'|'profile'} kind @param {string} why @param {string} raw
   */
  function setAside(kind, why, raw) {
    if (copyAside(kind, why, raw) && remove(KEYS[kind])) return;
    locked.add(KEYS[kind]);
  }

  /** @returns {Settings} */
  function currentSettings() {
    if (settings === null) {
      const rec = parseRecord(read(KEYS.settings));
      settings = sanitizeSettings(rec === null ? null : upgrade('settings', rec));
    }
    return settings;
  }

  /** @returns {ReturnType<Store['load']>} */
  function load() {
    const at = now();
    /** @type {Notice[]} */
    const notices = [];
    /** @type {string|null} */
    let rawSettings = null;
    /** @type {string|null} */
    let rawProfile = null;
    /** @type {string|null} */
    let rawGame = null;
    /** @type {string|null} */
    let rawMigrated = null;
    /** @type {string|null} */
    let rawV1 = null;
    let reachable = storage !== null;
    if (storage !== null) {
      try {
        rawSettings = textOrNull(storage.getItem(KEYS.settings));
        rawProfile = textOrNull(storage.getItem(KEYS.profile));
        rawGame = textOrNull(storage.getItem(KEYS.game));
        rawMigrated = textOrNull(storage.getItem(KEYS.migrated));
        if (rawGame === null && rawMigrated === null) rawV1 = textOrNull(storage.getItem(KEYS.v1));      // read once: only when the import runs
      } catch {
        reachable = false;
      }
    }

    if (!reachable) {
      // storage unreachable: defaults, no game, one notice; the game continues in memory
      unread = true;
      failed();
      settings = defaultSettings();
      shadow.game = null;
      shadow.profile = null;
      notices.push(...pending.splice(0));
      return { game: null, settings: { ...settings }, profile: freshProfile(teacher, at, 2), notices, firstVisit: true };
    }

    const settingsRec = parseRecord(rawSettings);
    settings = sanitizeSettings(settingsRec === null ? null : upgrade('settings', settingsRec));   // bad JSON or bad keys -> defaults

    let firstVisit = false;
    /** @type {string|null} */
    let profileText = null;               // the profile record this tab knows of (null: none, the profile in use is a fresh one)
    /** @type {Profile|null} */
    let profile = null;
    if (rawProfile === null) {
      firstVisit = true;
    } else {
      const rec = parseRecord(rawProfile);
      if (rec === null) {
        setAside('profile', 'corrupt', rawProfile);
      } else if (isNewer(rec)) {
        setAside('profile', 'newer', rawProfile);
      } else {
        try {
          profile = sanitizeProfile(upgrade('profile', rec), teacher, at);      // skill through migrateSkillProfile
          profileText = JSON.stringify(profile);
        } catch {
          setAside('profile', 'corrupt', rawProfile);
        }
      }
    }
    if (profile === null) profile = freshProfile(teacher, at, 2);

    /** @type {SavedGame|null} */
    let game = null;
    if (rawGame !== null) {
      const rec = parseRecord(rawGame);
      if (rec === null) {
        setAside('game', 'corrupt', rawGame);
        notices.push('game-corrupt');
      } else if (isNewer(rec) || hasStart(rec)) {
        setAside('game', 'newer', rawGame);
        notices.push('game-newer');
      } else {
        game = sanitizeGame(upgrade('game', rec), at);
        if (game === null) {
          setAside('game', 'corrupt', rawGame);
          notices.push('game-corrupt');
        } else if (Array.isArray(rec.moves) && game.moves.length < rec.moves.length) {
          copyAside('game', 'truncated', rawGame);      // entries after a malformed one are dropped: keep the raw text before a save shortens it
        }
      }
    } else if (rawMigrated === null) {
      // the v1 import (13.3): once, when there is no v2 game and no import was attempted yet; the v1 key is only read
      const migrated = rawV1 === null ? null : migrateV1(parseValue(rawV1), at);
      let gameStored = true;
      if (migrated !== null) {
        game = migrated.game;
        gameStored = write(KEYS.game, JSON.stringify(game));
        if (rawProfile === null) {
          // only when no v2 profile exists yet: the old difficulty seeds the level; stored now so that a reload keeps it
          profile = freshProfile(teacher, at, migrated.seedLevel);
          profileText = JSON.stringify(profile);
          write(KEYS.profile, profileText);
        }
        notices.push(migrated.wasLocal ? 'migrated-v1-local' : 'migrated-v1');
      }
      // while the imported game could not be stored the import stays pending, so the next load tries again
      if (gameStored) write(KEYS.migrated, '1');
    }

    if (rawMigrated === IMPORTED_MARK) {
      notices.push('imported');
      write(KEYS.migrated, '1');
    }

    shadow.game = game === null ? null : JSON.stringify(game);
    shadow.profile = profileText;
    notices.push(...pending.splice(0));
    return { game, settings: { ...settings }, profile, notices, firstVisit };
  }

  /** @param {SavedGame} game @returns {boolean} */
  function saveGame(game) {
    /** @type {string|undefined} */
    let text;
    try {
      text = JSON.stringify(game);
    } catch {
      return false;
    }
    if (typeof text !== 'string') return false;
    shadow.game = text;
    return write(KEYS.game, text);
  }

  /** @param {Profile} profile @returns {boolean} */
  function saveProfile(profile) {
    /** @type {string|undefined} */
    let text;
    try {
      text = JSON.stringify(profile);
    } catch {
      return false;
    }
    if (typeof text !== 'string') return false;
    shadow.profile = text;
    return write(KEYS.profile, text);
  }

  /** @param {Partial<Settings>} patch @returns {Settings} */
  function saveSettings(patch) {
    /** @type {Settings} */
    const next = { ...currentSettings() };
    if (isRecord(patch)) {
      for (const key of SETTING_KEYS) if (key in patch) applySetting(next, key, patch[key]);      // a refused value keeps the current one
    }
    settings = next;
    write(KEYS.settings, JSON.stringify(next));
    for (const fn of [...listeners]) {
      try {
        fn({ ...next });
      } catch (error) {
        console.error(error);       // a throwing listener never stops the others
      }
    }
    return { ...next };
  }

  /** @param {(s:Settings) => void} fn @returns {() => void} */
  function onSettings(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  /** @param {'game'|'profile'} kind @param {string} why */
  function quarantine(kind, why) {
    if (kind !== 'game' && kind !== 'profile') return;
    const raw = read(KEYS[kind]);
    if (raw !== null) copyAside(kind, String(why), raw);      // the record itself stays
  }

  /** @returns {Backup} */
  function exportBackup() {
    const at = now();
    const gameRec = parseRecord(shadow.game !== undefined ? shadow.game : read(KEYS.game));
    const game = gameRec !== null && !isNewer(gameRec) && !hasStart(gameRec) ? sanitizeGame(upgrade('game', gameRec), at) : null;
    const profileRec = parseRecord(shadow.profile !== undefined ? shadow.profile : read(KEYS.profile));
    /** @type {Profile|null} */
    let profile = null;
    if (profileRec !== null && !isNewer(profileRec)) {
      try {
        profile = sanitizeProfile(upgrade('profile', profileRec), teacher, at);
      } catch {
        profile = null;
      }
    }
    return { kind: 'yijian-backup', v: 1, at, game, profile: profile ?? freshProfile(teacher, at, 2), settings: { ...currentSettings() } };
  }

  /** @param {string} text @returns {{ok:true}|{ok:false, why:string}} */
  function importBackup(text) {
    const at = now();
    if (typeof text !== 'string') return { ok: false, why: 'json' };
    const backup = parseRecord(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
    if (backup === null) return { ok: false, why: 'json' };
    if (backup.kind !== 'yijian-backup') return { ok: false, why: 'kind' };
    if (backup.v !== 1) return { ok: false, why: 'version' };

    // validate every record with the sanitizers before anything is written
    /** @type {SavedGame|null} */
    let game = null;
    if (backup.game !== null) {
      if (!isRecord(backup.game)) return { ok: false, why: 'game' };
      if (isNewer(backup.game) || hasStart(backup.game)) return { ok: false, why: 'newer' };
      game = sanitizeGame(upgrade('game', backup.game), at);
      if (game === null) return { ok: false, why: 'game' };
    }
    if (!isRecord(backup.profile)) return { ok: false, why: 'profile' };
    if (isNewer(backup.profile)) return { ok: false, why: 'newer' };
    /** @type {Profile} */
    let profile;
    try {
      profile = sanitizeProfile(upgrade('profile', backup.profile), teacher, at);
    } catch {
      return { ok: false, why: 'profile' };
    }
    if (!isRecord(backup.settings)) return { ok: false, why: 'settings' };
    if (isNewer(backup.settings)) return { ok: false, why: 'newer' };
    const nextSettings = sanitizeSettings(upgrade('settings', backup.settings));

    // write all three; when a write fails the previous records are put back
    if (storage === null || unread) return { ok: false, why: 'storage' };
    const target = storage;
    const keys = [KEYS.game, KEYS.profile, KEYS.settings];
    /** @type {(string|null)[]} */
    let before;
    try {
      before = keys.map((key) => textOrNull(target.getItem(key)));
    } catch {
      return { ok: false, why: 'storage' };
    }
    const gameText = game === null ? null : JSON.stringify(game);
    const profileText = JSON.stringify(profile);
    const written = (gameText === null ? remove(KEYS.game) : write(KEYS.game, gameText))
      && write(KEYS.profile, profileText)
      && write(KEYS.settings, JSON.stringify(nextSettings));
    if (!written) {
      keys.forEach((key, i) => {
        const old = before[i];
        try {
          if (old === null) target.removeItem(key);
          else target.setItem(key, old);
        } catch {
          // nothing more can be done for this key
        }
      });
      return { ok: false, why: 'storage' };
    }
    write(KEYS.migrated, IMPORTED_MARK);       // the next load() reports 'imported'; the v1 import never runs over an imported state
    shadow.game = gameText;
    shadow.profile = profileText;
    settings = nextSettings;
    return { ok: true };
  }

  return { load, saveGame, saveSettings, saveProfile, available: () => usable, onSettings, quarantine, exportBackup, importBackup };
}

/**
 * @typedef {Object} Store
 * @property {() => {game:SavedGame|null, settings:Settings, profile:Profile, notices:Notice[], firstVisit:boolean}} load     boot only; never throws
 * @property {(game:SavedGame) => boolean} saveGame              synchronous; false when storage is unavailable
 * @property {(patch:Partial<Settings>) => Settings} saveSettings     validates, persists, notifies
 * @property {(profile:Profile) => boolean} saveProfile
 * @property {() => boolean} available
 * @property {(fn:(s:Settings) => void) => () => void} onSettings
 * @property {(kind:'game'|'profile', why:string) => void} quarantine      copy the stored raw record into the quarantine slot (keeps the record itself)
 * @property {() => Backup} exportBackup
 * @property {(text:string) => {ok:true}|{ok:false, why:string}} importBackup       validates every record with the sanitizers, then writes all three
 */
