// Store (SPEC 4.20, section 13): persistence, v1 migration, settings, profile. In-memory Storage, fake teacher, fixed clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { KEYS, SCHEMA, createStore, sanitizeGame, sanitizeSettings, sanitizeProfile, migrateV1, recordResult } from '../../../src/game/store.js';
import { createMemoryStorage } from '../../helpers/memory-storage.js';

const SAVES = new URL('../../fixtures/saves/', import.meta.url);
/** @param {string} name */
const fixtureText = (name) => readFileSync(new URL(name, SAVES), 'utf8');
/** @param {string} name */
const fixture = (name) => JSON.parse(fixtureText(name));

const T0 = 1790000000000;             // startedAt of the fixtures
const NOW = T0 + 100000000;           // the injected clock: 100 000 s after the fixtures were "played"
const GAME_ID = /^g-[a-z0-9]{6,16}$/;
const GAME_KEYS = ['schema', 'id', 'humanColor', 'moves', 'result', 'startedAt', 'endedAt', 'activeMs', 'counted', 'drawFrom', 'seed', 'skill', 'memory', 'start'];
const DEFAULT_SETTINGS = { schema: 2, theme: 'chibi', sfx: true, music: true, volume: 1, motion: 'auto', haptics: true, typeTicks: false, readAloud: false,
                           side: 'red', coach: 'auto', freeText: true, talk: 'smart' };

/** A stand-in for src/core/teacher.js: only the three functions the store may call. */
function fakeTeacher() {
  const calls = [];
  const create = (seedLevel = 2) => ({ v: 1, level: seedLevel, games: 0, tactics: { seen: [0, 0, 0], found: [0, 0, 0] }, streak: 0, bandShift: 0, habits: {}, recent: [] });
  return {
    calls,
    createSkillProfile(seedLevel = 2) {
      calls.push(['create', seedLevel]);
      return create(seedLevel);
    },
    migrateSkillProfile(raw) {
      calls.push(['migrate', raw]);
      const ok = raw && typeof raw === 'object' && raw.v === 1 && typeof raw.level === 'number';
      return ok ? structuredClone(raw) : create(2);
    },
    reviveGameSkill() {
      throw new Error('the store never revives a GameSkill: director.loadExtras does');
    },
  };
}

/** @param {Record<string, string>} [initial] */
function setup(initial = {}) {
  const storage = createMemoryStorage(initial);
  const teacher = fakeTeacher();
  const clock = { now: NOW };
  const open = () => createStore({ storage, now: () => clock.now, teacher });
  return { storage, teacher, clock, open, store: open() };
}

/** setItem / removeItem calls on one key. @param {ReturnType<typeof createMemoryStorage>} storage @param {string} key */
const writesTo = (storage, key) => storage.log.filter((entry) => entry.key === key);

const sampleGame = () => fixture('v2-midgame.json');
const sampleProfile = () => fixture('backup-ok.json').profile;

// ---------------------------------------------------------------------------------------------------------------

test('KEYS and SCHEMA are the literal table of 4.20', () => {
  assert.deepEqual(KEYS, {
    game: 'yijian.xiangqi.v2.game', settings: 'yijian.xiangqi.v2.settings', profile: 'yijian.xiangqi.v2.profile',
    migrated: 'yijian.xiangqi.v2.migrated', quarantine: 'yijian.xiangqi.quarantine', v1: 'yijian.xiangqi.v1',
  });
  assert.equal(SCHEMA, 2);
});

test('load on empty storage: defaults, a fresh profile at level 2, no game, first visit', () => {
  const { store, storage } = setup();
  const loaded = store.load();
  assert.equal(loaded.game, null);
  assert.deepEqual(loaded.settings, DEFAULT_SETTINGS);
  assert.deepEqual(loaded.profile, {
    schema: 2, skill: { v: 1, level: 2, games: 0, tactics: { seen: [0, 0, 0], found: [0, 0, 0] }, streak: 0, bandShift: 0, habits: {}, recent: [] },
    games: { played: 0, won: 0, lost: 0, drawn: 0 }, rank: 2, goal: null, introSeen: false, createdAt: NOW,
  });
  assert.deepEqual(loaded.notices, []);
  assert.equal(loaded.firstVisit, true);
  assert.equal(store.available(), true);
  // nothing about the child is written before there is something to save
  assert.deepEqual(Object.keys(storage.dump()), [KEYS.migrated]);
  // the profile is not stored yet, so the next page load is still a first visit
  assert.equal(setup(storage.dump()).store.load().firstVisit, true);
});

test('round trip of the three records', () => {
  const { store, storage, open } = setup();
  store.load();
  const game = sampleGame();
  const profile = sampleProfile();
  assert.equal(store.saveGame(game), true);
  assert.equal(store.saveProfile(profile), true);
  const saved = store.saveSettings({ theme: 'shachang', volume: 0.4, talk: 'more', side: 'black' });
  const settings = { ...DEFAULT_SETTINGS, theme: 'shachang', volume: 0.4, talk: 'more', side: 'black' };
  assert.deepEqual(saved, settings);

  // three independent records, each with its own schema 2
  const dump = storage.dump();
  assert.deepEqual(JSON.parse(dump[KEYS.game]), game);
  assert.deepEqual(JSON.parse(dump[KEYS.profile]), profile);
  assert.deepEqual(JSON.parse(dump[KEYS.settings]), settings);
  for (const key of [KEYS.game, KEYS.profile, KEYS.settings]) assert.equal(JSON.parse(dump[key]).schema, 2);

  // a new page load reads them back unchanged; skill and memory travel as raw objects
  const loaded = open().load();
  assert.deepEqual(loaded.game, game);
  assert.deepEqual(loaded.game.skill, game.skill);
  assert.deepEqual(loaded.game.memory, game.memory);
  assert.deepEqual(loaded.profile, profile);
  assert.deepEqual(loaded.settings, settings);
  assert.deepEqual(loaded.notices, []);
  assert.equal(loaded.firstVisit, false);

  // and the backup is the same three records
  assert.deepEqual(store.exportBackup(), { kind: 'yijian-backup', v: 1, at: NOW, game, profile, settings });
  assert.deepEqual(open().exportBackup(), { kind: 'yijian-backup', v: 1, at: NOW, game, profile, settings });

  // only the keys of 4.20 are ever written, and never the v1 key
  const allowed = new Set([KEYS.game, KEYS.settings, KEYS.profile, KEYS.migrated, KEYS.quarantine]);
  for (const entry of storage.log) assert.ok(allowed.has(String(entry.key)), `unexpected key ${entry.key}`);
});

test('every row of the 13.3 migration table from the v1 fixtures', () => {
  const red = migrateV1(fixture('v1-ai-red.json'), NOW);
  const black = migrateV1(fixture('v1-ai-black-hard.json'), NOW);
  const local = migrateV1(fixture('v1-local.json'), NOW);
  const resigned = migrateV1(fixture('v1-resigned.json'), NOW);
  const extra = migrateV1(fixture('v1-extra-move-fields.json'), NOW);
  const nullEntry = migrateV1(fixture('v1-null-entry.json'), NOW);
  const future = migrateV1(fixture('v1-future-startedAt.json'), NOW);
  for (const m of [red, black, local, resigned, extra, nullEntry, future]) assert.ok(m, 'a v1 save must be imported');

  // version -> schema 2; only version === 1 (number) is a v1 save
  assert.equal(red.game.schema, 2);
  assert.equal(migrateV1(fixture('v1-version-2-under-v1-key.json'), NOW), null);
  assert.equal(migrateV1({ ...fixture('v1-ai-red.json'), version: '1' }, NOW), null);
  assert.equal(migrateV1({ ...fixture('v1-ai-red.json'), version: undefined }, NOW), null);
  for (const junk of [null, undefined, 'x', 1, [], [fixture('v1-ai-red.json')]]) assert.equal(migrateV1(junk, NOW), null);

  // mode: dropped; "local" keeps the position and the move list and is reported
  assert.equal(red.wasLocal, false);
  assert.equal(local.wasLocal, true);
  assert.deepEqual(local.game.moves, ['7774', '0726', '9776', '0807', '9897']);
  assert.equal(local.game.humanColor, 'red');
  // the migrated game has exactly the fields of SavedGame: no mode, difficulty, flipped, sound, or anything else from the old save
  for (const m of [red, black, local, resigned, extra]) assert.deepEqual(Object.keys(m.game).sort(), [...GAME_KEYS].sort());

  // difficulty -> seed level: easy 2, normal 4, hard 6, unknown 4
  assert.equal(red.seedLevel, 2);
  assert.equal(local.seedLevel, 4);
  assert.equal(black.seedLevel, 6);
  assert.equal(extra.seedLevel, 4);
  assert.equal(migrateV1({ ...fixture('v1-ai-red.json'), difficulty: undefined }, NOW).seedLevel, 4);

  // humanColor: 'black' stays black, everything else red
  assert.equal(black.game.humanColor, 'black');
  assert.equal(red.game.humanColor, 'red');
  assert.equal(extra.game.humanColor, 'red');          // the fixture says "blue"

  // flipped: read and ignored; sound: ignored
  const unflipped = migrateV1({ ...fixture('v1-ai-black-hard.json'), flipped: false, sound: true }, NOW);
  assert.deepEqual({ ...unflipped.game, id: '', seed: 0 }, { ...black.game, id: '', seed: 0 });

  // moves[i] -> MoveCode; integers or numeric strings; extra fields ignored; stop at the first bad entry; at most 2000
  assert.deepEqual(red.game.moves, ['7774', '0726', '9776', '0807']);
  assert.deepEqual(black.game.moves, ['7774', '0726', '9776']);
  assert.deepEqual(migrateV1(fixture('v1-string-coordinates.json'), NOW).game.moves, ['7774', '0726', '9776', '0807']);
  assert.deepEqual(extra.game.moves, ['7774', '0726', '9776', '0807']);
  assert.deepEqual(nullEntry.game.moves, ['7774', '0726']);
  assert.deepEqual(migrateV1(fixture('v1-illegal-third-move.json'), NOW).game.moves, ['7774', '0726', '9050', '0807']);   // legality is session.restore's job
  const move = (fr, fc, tr, tc) => ({ from: { row: fr, col: fc }, to: { row: tr, col: tc } });
  const good = move(7, 7, 7, 4);
  for (const bad of [move(10, 0, 9, 0), move(0, 9, 0, 8), move(-1, 0, 0, 0), move(1.5, 0, 2, 0), move('07', 0, 6, 0), move(' 7', 0, 6, 0), move(true, 0, 6, 0),
                     move(null, 0, 6, 0), { from: { row: 7, col: 7 } }, { from: [7, 7], to: [7, 4] }, '7774', 7774, undefined]) {
    const m = migrateV1({ ...fixture('v1-ai-red.json'), moves: [good, bad, good] }, NOW);
    assert.deepEqual(m.game.moves, ['7774'], `stops at ${JSON.stringify(bad)}`);
    assert.equal(m.game.drawFrom, 1);
  }
  const edges = migrateV1({ ...fixture('v1-ai-red.json'), moves: [move(9, 8, 0, 0), move('9', '8', '0', '0')] }, NOW);
  assert.deepEqual(edges.game.moves, ['9800', '9800']);          // 0..9 and 0..8 inclusive
  const tooMany = fixture('v1-2001-moves.json');
  assert.equal(tooMany.moves.length, 2001);
  assert.equal(migrateV1(tooMany, NOW), null);
  assert.equal(migrateV1({ ...tooMany, moves: tooMany.moves.slice(0, 2000) }, NOW).game.moves.length, 2000);
  assert.equal(migrateV1({ ...fixture('v1-ai-red.json'), moves: 'none' }, NOW), null);
  assert.equal(migrateV1({ ...fixture('v1-ai-red.json'), moves: undefined }, NOW), null);

  // startedAt: finite and positive, clamped to now, else now; endedAt kept only if startedAt <= endedAt <= now
  assert.equal(red.game.startedAt, T0);
  assert.equal(red.game.endedAt, null);
  assert.equal(future.game.startedAt, NOW);
  assert.equal(future.game.endedAt, null);
  assert.equal(nullEntry.game.startedAt, NOW);         // the fixture has startedAt 0
  assert.equal(migrateV1({ ...fixture('v1-ai-red.json'), startedAt: String(T0) }, NOW).game.startedAt, NOW);
  assert.equal(migrateV1({ ...fixture('v1-ai-red.json'), startedAt: -5 }, NOW).game.startedAt, NOW);
  assert.equal(resigned.game.startedAt, T0);
  assert.equal(resigned.game.endedAt, T0 + 600000);
  assert.equal(extra.game.endedAt, null);              // the fixture ends before it starts
  assert.equal(migrateV1({ ...fixture('v1-resigned.json'), endedAt: NOW + 1 }, NOW).game.endedAt, null);
  assert.equal(migrateV1({ ...fixture('v1-resigned.json'), endedAt: NOW }, NOW).game.endedAt, NOW);
  assert.equal(migrateV1({ ...fixture('v1-resigned.json'), endedAt: String(T0 + 600000) }, NOW).game.endedAt, null);

  // result: only a resignation with a red / black winner is honoured
  assert.deepEqual(resigned.game.result, { winner: 'black', reason: 'resign' });
  assert.equal(red.game.result, null);
  assert.equal(extra.game.result, null);               // the fixture claims a checkmate: natural results are recomputed
  const resign = (winner) => migrateV1({ ...fixture('v1-resigned.json'), result: { over: true, winner, reason: 'resign', check: false } }, NOW).game.result;
  assert.deepEqual(resign('red'), { winner: 'red', reason: 'resign' });
  assert.equal(resign('green'), null);
  assert.equal(resign(undefined), null);

  // (none) -> drawFrom = moves.length
  assert.equal(red.game.drawFrom, 4);
  assert.equal(black.game.drawFrom, 3);
  assert.equal(nullEntry.game.drawFrom, 2);

  // (none) -> fresh id, fresh seed, skill null, memory null, start null, activeMs = max(0, (endedAt ?? now) - startedAt) capped at 3 h
  for (const m of [red, black, local, resigned, extra, nullEntry, future]) {
    assert.match(m.game.id, GAME_ID);
    assert.ok(Number.isInteger(m.game.seed) && m.game.seed >= 0 && m.game.seed <= 0xFFFFFFFF, 'seed is a uint32');
    assert.equal(m.game.skill, null);
    assert.equal(m.game.memory, null);
    assert.equal(m.game.start, null);
    assert.equal(m.game.counted, false);             // app.js sets it after session.restore
  }
  const ids = new Set(Array.from({ length: 20 }, () => migrateV1(fixture('v1-ai-red.json'), NOW).game.id));
  assert.ok(ids.size >= 19, 'ids are fresh');
  const seeds = new Set(Array.from({ length: 20 }, () => migrateV1(fixture('v1-ai-red.json'), NOW).game.seed));
  assert.ok(seeds.size >= 19, 'seeds are fresh');
  assert.equal(resigned.game.activeMs, 600000);                                            // endedAt - startedAt
  assert.equal(migrateV1(fixture('v1-ai-red.json'), T0 + 90000).game.activeMs, 90000);     // now - startedAt while unfinished
  assert.equal(red.game.activeMs, 3 * 60 * 60 * 1000);                                     // 100 000 s, capped at 3 h
  assert.equal(future.game.activeMs, 0);

  // difficulty -> profile.skill = createSkillProfile(seedLevel), through load()
  for (const [name, level, notice] of [['v1-ai-red.json', 2, 'migrated-v1'], ['v1-ai-black-hard.json', 6, 'migrated-v1'],
                                       ['v1-extra-move-fields.json', 4, 'migrated-v1'], ['v1-local.json', 4, 'migrated-v1-local']]) {
    const { store, teacher } = setup({ [KEYS.v1]: fixtureText(name) });
    const loaded = store.load();
    assert.equal(loaded.profile.skill.level, level, name);
    assert.equal(loaded.profile.rank, level, name);
    assert.ok(teacher.calls.some((c) => c[0] === 'create' && c[1] === level), name);
    assert.deepEqual(loaded.notices, [notice], name);
    assert.equal(loaded.game.moves.length, fixture(name).moves.length, name);
    // v1 defaulted to sound off, so its flag is not a choice: v2 starts with sound on
    assert.equal(loaded.settings.sfx, true);
    assert.equal(loaded.settings.music, true);
  }
});

test('migration happens once, never writes or deletes the v1 key, and does not replace an existing v2 profile', () => {
  const v1Text = fixtureText('v1-ai-black-hard.json');
  const { store, storage, open } = setup({ [KEYS.v1]: v1Text });
  const first = store.load();
  assert.deepEqual(first.game.moves, ['7774', '0726', '9776']);
  assert.equal(first.game.humanColor, 'black');
  assert.deepEqual(first.notices, ['migrated-v1']);
  assert.equal(first.firstVisit, true);
  // the imported game is written at once, the attempt is recorded, the seeded profile is kept for the next load
  assert.deepEqual(JSON.parse(storage.dump()[KEYS.game]), first.game);
  assert.equal(storage.dump()[KEYS.migrated], '1');
  assert.deepEqual(JSON.parse(storage.dump()[KEYS.profile]), first.profile);
  assert.equal(first.profile.skill.level, 6);
  // the v1 key: byte-identical, no call ever touched it
  assert.equal(storage.dump()[KEYS.v1], v1Text);
  assert.deepEqual(writesTo(storage, KEYS.v1), []);

  // second load: the v2 game, no second import, no second notice
  const second = open().load();
  assert.deepEqual(second.game, first.game);
  assert.deepEqual(second.notices, []);
  assert.equal(second.profile.skill.level, 6);
  assert.equal(second.firstVisit, false);

  // even with the v2 game gone the import does not run again
  storage.removeItem(KEYS.game);
  const third = open().load();
  assert.equal(third.game, null);
  assert.deepEqual(third.notices, []);
  assert.equal(storage.dump()[KEYS.v1], v1Text);
  assert.deepEqual(writesTo(storage, KEYS.v1), []);

  // "read once": the v1 key is read by the load that imports it and by no later call
  const inner = createMemoryStorage({ [KEYS.v1]: v1Text });
  const reads = [];
  const counting = {
    getItem: (key) => {
      reads.push(key);
      return inner.getItem(key);
    },
    setItem: (key, value) => inner.setItem(key, value),
    removeItem: (key) => inner.removeItem(key),
  };
  const reopen = () => createStore({ storage: counting, now: () => NOW, teacher: fakeTeacher() });
  const imported = reopen().load();
  assert.deepEqual(imported.notices, ['migrated-v1']);
  const later = reopen();
  later.load();
  later.saveGame(imported.game);
  later.saveSettings({ volume: 0.5 });
  later.quarantine('game', 'truncated');
  later.exportBackup();
  reopen().load();
  assert.equal(reads.filter((key) => key === KEYS.v1).length, 1);
  assert.equal(inner.dump()[KEYS.v1], v1Text);
  assert.deepEqual(writesTo(inner, KEYS.v1), []);

  // an existing v2 profile is not replaced by the old difficulty
  const profileText = JSON.stringify(sampleProfile());
  const kept = setup({ [KEYS.v1]: v1Text, [KEYS.profile]: profileText });
  const loaded = kept.store.load();
  assert.deepEqual(loaded.game.moves, ['7774', '0726', '9776']);
  assert.deepEqual(loaded.profile, sampleProfile());
  assert.equal(loaded.profile.skill.level, 3.4);
  assert.equal(loaded.firstVisit, false);
  assert.equal(kept.storage.dump()[KEYS.profile], profileText);
  assert.deepEqual(writesTo(kept.storage, KEYS.profile), []);

  // an existing v2 game wins over the v1 save: no import
  const gameText = JSON.stringify(sampleGame());
  const both = setup({ [KEYS.v1]: v1Text, [KEYS.game]: gameText });
  const withGame = both.store.load();
  assert.deepEqual(withGame.game, sampleGame());
  assert.deepEqual(withGame.notices, []);
  assert.equal(both.storage.dump()[KEYS.game], gameText);
  assert.equal(both.storage.dump()[KEYS.v1], v1Text);

  // a save that cannot be imported is tried once too: the flag is written whether or not the import succeeded
  for (const text of [fixtureText('v1-version-2-under-v1-key.json'), fixtureText('v1-2001-moves.json'), '{"version":1,"moves":[', 'null', '']) {
    const failed = setup({ [KEYS.v1]: text });
    const result = failed.store.load();
    assert.equal(result.game, null);
    assert.deepEqual(result.notices, []);
    assert.equal(failed.storage.dump()[KEYS.migrated], '1');
    assert.equal(failed.storage.dump()[KEYS.v1], text);
    assert.equal(failed.storage.dump()[KEYS.game], undefined);
    assert.deepEqual(writesTo(failed.storage, KEYS.v1), []);
  }
});

test('a migrated game has drawFrom = moves.length', () => {
  for (const [name, plies] of [['v1-repetition.json', 13], ['v1-121-quiet-plies.json', 121], ['v1-700-plies.json', 700], ['v1-ai-black-hard.json', 3],
                               ['v1-null-entry.json', 2], ['v1-illegal-third-move.json', 4]]) {
    const migrated = migrateV1(fixture(name), NOW);
    assert.equal(migrated.game.moves.length, plies, name);
    assert.equal(migrated.game.drawFrom, plies, name);
    // and that is what reaches storage and the next load
    const { store, storage, open } = setup({ [KEYS.v1]: fixtureText(name) });
    const loaded = store.load();
    assert.equal(loaded.game.drawFrom, plies, name);
    assert.equal(JSON.parse(storage.dump()[KEYS.game]).drawFrom, plies, name);
    assert.equal(open().load().game.drawFrom, plies, name);
  }
});

test('corrupt JSON and schema 3 are quarantined with the right notice and never overwritten', () => {
  const slot = (storage) => JSON.parse(storage.dump()[KEYS.quarantine]);

  // corrupt JSON
  const corruptText = fixtureText('v2-corrupt.txt');
  const corrupt = setup({ [KEYS.game]: corruptText });
  const a = corrupt.store.load();
  assert.equal(a.game, null);
  assert.deepEqual(a.notices, ['game-corrupt']);
  assert.deepEqual(slot(corrupt.storage), { kind: 'game', at: NOW, why: 'corrupt', raw: corruptText });
  assert.equal(corrupt.storage.dump()[KEYS.game], undefined);                        // removed: the app cannot loop on it
  assert.deepEqual(writesTo(corrupt.storage, KEYS.game).map((e) => e.op), ['remove']);   // never rewritten in place
  // the next save cannot destroy the only copy
  assert.equal(corrupt.store.saveGame(sampleGame()), true);
  assert.equal(slot(corrupt.storage).raw, corruptText);
  assert.deepEqual(corrupt.open().load().notices, []);

  // valid JSON that is not a usable game
  for (const text of ['{"schema":2,"id":"g-m3k09x2a","moves":"7774"}', '[]', '"7774"', 'null', '{"schema":2}']) {
    const bad = setup({ [KEYS.game]: text });
    const loaded = bad.store.load();
    assert.equal(loaded.game, null, text);
    assert.deepEqual(loaded.notices, ['game-corrupt'], text);
    assert.deepEqual(slot(bad.storage), { kind: 'game', at: NOW, why: 'corrupt', raw: text });
    assert.equal(bad.storage.dump()[KEYS.game], undefined);
  }

  // schema 3
  const newerText = fixtureText('v2-schema-3.json');
  const newer = setup({ [KEYS.game]: newerText });
  const b = newer.store.load();
  assert.equal(b.game, null);
  assert.deepEqual(b.notices, ['game-newer']);
  assert.deepEqual(slot(newer.storage), { kind: 'game', at: NOW, why: 'newer', raw: newerText });
  assert.equal(newer.storage.dump()[KEYS.game], undefined);
  assert.deepEqual(writesTo(newer.storage, KEYS.game).map((e) => e.op), ['remove']);

  // a schema 3 record is "newer" even when this version could read its fields; so is a game with the reserved `start`
  for (const record of [{ ...sampleGame(), schema: 3 }, { ...sampleGame(), start: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w' }]) {
    const text = JSON.stringify(record);
    const reserved = setup({ [KEYS.game]: text });
    const loaded = reserved.store.load();
    assert.equal(loaded.game, null);
    assert.deepEqual(loaded.notices, ['game-newer']);
    assert.deepEqual(slot(reserved.storage), { kind: 'game', at: NOW, why: 'newer', raw: text });
  }

  // a profile of a newer version: quarantined, a fresh profile, not a first visit, no notice
  const profileText = JSON.stringify({ ...sampleProfile(), schema: 3 });
  const prof = setup({ [KEYS.profile]: profileText, [KEYS.game]: JSON.stringify(sampleGame()) });
  const c = prof.store.load();
  assert.equal(c.profile.skill.level, 2);
  assert.deepEqual(c.profile.games, { played: 0, won: 0, lost: 0, drawn: 0 });
  assert.equal(c.firstVisit, false);
  assert.deepEqual(c.notices, []);
  assert.deepEqual(c.game, sampleGame());
  assert.deepEqual(slot(prof.storage), { kind: 'profile', at: NOW, why: 'newer', raw: profileText });
  assert.equal(prof.storage.dump()[KEYS.profile], undefined);

  // the copy keeps the first 200 000 characters
  const longText = '{"schema":2,"moves":["' + '7'.repeat(250000);
  const long = setup({ [KEYS.game]: longText });
  assert.deepEqual(long.store.load().notices, ['game-corrupt']);
  assert.equal(slot(long.storage).raw.length, 200000);
  assert.equal(slot(long.storage).raw, longText.slice(0, 200000));

  // when the copy cannot be stored the bad record stays where it is and is not overwritten by a later save
  const stuck = setup({ [KEYS.game]: corruptText });
  stuck.storage.failSet = true;
  const d = stuck.store.load();
  assert.equal(d.game, null);
  assert.deepEqual([...d.notices].sort(), ['game-corrupt', 'storage-unavailable']);
  stuck.storage.failSet = false;
  assert.equal(stuck.store.saveGame(sampleGame()), false);
  assert.equal(stuck.storage.dump()[KEYS.game], corruptText);
  // nor is it removed by importing a backup that has no game: the record has no copy anywhere else
  const stuckBefore = stuck.storage.dump();
  assert.deepEqual(stuck.store.importBackup(JSON.stringify({ ...fixture('backup-ok.json'), game: null })), { ok: false, why: 'storage' });
  assert.deepEqual(stuck.storage.dump(), stuckBefore);
  assert.deepEqual(stuck.store.importBackup(fixtureText('backup-ok.json')), { ok: false, why: 'storage' });
  assert.deepEqual(stuck.storage.dump(), stuckBefore);
});

test('damaged records never make load() throw or stall, and an unusable game is never dropped without a copy and a notice', () => {
  // a schema number far below zero: there is no upgrade step down there, so nothing may count its way up to schema 2
  // (the first value is small enough for this test to fail, not hang, if something ever does)
  for (const schema of [-3000000, -9007199254740991, -1, 0, 1]) {
    const old = setup({ [KEYS.game]: JSON.stringify({ ...sampleGame(), schema }), [KEYS.profile]: JSON.stringify({ ...sampleProfile(), schema }),
                        [KEYS.settings]: JSON.stringify({ ...DEFAULT_SETTINGS, schema, theme: 'longzhong' }), [KEYS.migrated]: '1' });
    const started = Date.now();
    const loaded = old.store.load();
    assert.ok(Date.now() - started < 2000, `schema ${schema} loads at once`);
    assert.deepEqual(loaded.game, sampleGame(), `schema ${schema}`);
    assert.deepEqual(loaded.profile, sampleProfile(), `schema ${schema}`);
    assert.equal(loaded.settings.theme, 'longzhong');
    assert.deepEqual(loaded.notices, []);
    // and the same number inside a backup file does not freeze the import
    const backup = { ...fixture('backup-ok.json') };
    backup.game = { ...backup.game, schema };
    backup.profile = { ...backup.profile, schema };
    backup.settings = { ...backup.settings, schema };
    assert.deepEqual(old.store.importBackup(JSON.stringify(backup)), { ok: true });
    assert.ok(Date.now() - started < 2000, `schema ${schema} imports at once`);
  }

  // every key holding every kind of odd text: load() returns, the v1 key is untouched, and a game record that was
  // not loaded sits in the quarantine slot, byte for byte, with its notice
  const odd = ['', ' ', 'null', 'true', '0', '-1', '"x"', '[]', '[null]', '{}', '{', '}{', 'undefined', 'NaN', '{"schema":null}', '{"schema":"2"}',
               '{"schema":2,"moves":null}', '{"schema":2,"moves":{}}', '{"schema":2,"moves":[null]}', '{"schema":2.5,"moves":[]}', '{"schema":1e400,"moves":[]}',
               '{"moves":[],"start":0}', '{"moves":[],"start":""}', '{"__proto__":{"moves":[]}}', '{"version":1,"moves":[{"from":null}]}',
               '{"version":1,"moves":[{"from":{"row":"__proto__","col":0},"to":{"row":0,"col":0}}]}', '﻿{"schema":2,"moves":[]}', '1', 'imported'];
  const keys = [KEYS.game, KEYS.profile, KEYS.settings, KEYS.migrated, KEYS.quarantine, KEYS.v1];
  let seen = 0;
  for (const key of keys) {
    for (const text of odd) {
      for (const withGame of key === KEYS.game ? [false] : [false, true]) {
        const initial = { [key]: text };
        if (withGame) initial[KEYS.game] = JSON.stringify(sampleGame());
        const { store, storage } = setup(initial);
        const label = `${key} = ${JSON.stringify(text)}${withGame ? ' beside a game' : ''}`;
        let loaded;
        assert.doesNotThrow(() => {
          loaded = store.load();
          store.exportBackup();
          store.saveSettings({});
        }, label);
        assert.equal(storage.dump()[KEYS.v1], initial[KEYS.v1], label);
        assert.deepEqual(writesTo(storage, KEYS.v1), [], label);
        if (loaded.game !== null) assert.match(loaded.game.id, GAME_ID, label);
        if (KEYS.game in initial && loaded.game === null) {
          assert.deepEqual(JSON.parse(storage.dump()[KEYS.quarantine]), { kind: 'game', at: NOW, why: loaded.notices.includes('game-newer') ? 'newer' : 'corrupt',
                                                                         raw: initial[KEYS.game] }, label);
          assert.equal(loaded.notices.filter((n) => n === 'game-corrupt' || n === 'game-newer').length, 1, label);
          seen += 1;
        } else if (withGame) {
          assert.deepEqual(loaded.game, sampleGame(), label);            // a bad neighbour never costs the game
        }
      }
    }
  }
  assert.ok(seen >= 20, 'the sweep met unusable game records');

  // a stand-in for Storage that answers undefined (not null) for a missing key
  const items = new Map();
  const loose = {
    getItem: (key) => items.get(key),
    setItem: (key, value) => {
      if (loose.full && key === KEYS.settings) throw new Error('quota');
      items.set(key, String(value));
    },
    removeItem: (key) => items.delete(key),
    full: false,
  };
  const open = () => createStore({ storage: loose, now: () => NOW, teacher: fakeTeacher() });
  const first = open().load();
  assert.equal(first.game, null);
  assert.equal(first.firstVisit, true);
  assert.deepEqual(first.notices, []);
  assert.deepEqual([...items.keys()], [KEYS.migrated]);
  // the v1 import runs on it too
  items.clear();
  items.set(KEYS.v1, fixtureText('v1-ai-black-hard.json'));
  const imported = open().load();
  assert.deepEqual(imported.game.moves, ['7774', '0726', '9776']);
  assert.deepEqual(imported.notices, ['migrated-v1']);
  // and a failed import puts back exactly what was there: a key that did not exist is not left holding "undefined"
  items.clear();
  loose.full = true;
  const store = open();
  store.load();
  const before = new Map(items);
  assert.deepEqual(store.importBackup(fixtureText('backup-ok.json')), { ok: false, why: 'storage' });
  assert.deepEqual([...items], [...before]);
});

test('setItem throwing flips available() and yields one notice', () => {
  const v1Text = fixtureText('v1-ai-red.json');
  const { store, storage } = setup({ [KEYS.v1]: v1Text });
  storage.failSet = true;
  assert.equal(store.available(), true);
  const loaded = store.load();
  // the game continues in memory
  assert.deepEqual(loaded.game.moves, ['7774', '0726', '9776', '0807']);
  assert.equal(loaded.profile.skill.level, 2);
  assert.deepEqual([...loaded.notices].sort(), ['migrated-v1', 'storage-unavailable']);
  assert.equal(loaded.notices.filter((n) => n === 'storage-unavailable').length, 1);
  assert.equal(store.available(), false);

  // every later write fails quietly; nothing reached storage; no second notice
  assert.equal(store.saveGame(loaded.game), false);
  assert.equal(store.saveProfile(loaded.profile), false);
  const seen = [];
  store.onSettings((s) => seen.push(s.theme));
  assert.equal(store.saveSettings({ theme: 'longzhong' }).theme, 'longzhong');      // settings still change in memory
  assert.deepEqual(seen, ['longzhong']);
  assert.deepEqual(storage.dump(), { [KEYS.v1]: v1Text });
  assert.ok(storage.log.length > 0 && storage.log.every((entry) => entry.ok === false && entry.key !== KEYS.v1));

  // what could not be saved is still in the backup the child can export
  const backup = store.exportBackup();
  assert.deepEqual(backup.game, loaded.game);
  assert.deepEqual(backup.profile, loaded.profile);
  assert.equal(backup.settings.theme, 'longzhong');

  // one notice for the whole life of the store
  assert.equal(store.load().notices.includes('storage-unavailable'), false);

  // the import was not marked as done while the game could not be stored: a later load imports it again
  storage.failSet = false;
  const retried = setup(storage.dump());
  assert.deepEqual(retried.store.load().game.moves, ['7774', '0726', '9776', '0807']);
  assert.equal(retried.storage.dump()[KEYS.migrated], '1');

  // storage that works again is used again
  assert.equal(store.saveGame(loaded.game), true);
  assert.equal(store.available(), true);

  // a failure after a clean load: the save reports it and available() flips
  const late = setup({ [KEYS.game]: JSON.stringify(sampleGame()) });
  assert.deepEqual(late.store.load().notices, []);
  late.storage.failSet = true;
  assert.equal(late.store.saveGame(sampleGame()), false);
  assert.equal(late.store.available(), false);
});

test('storage unreachable: defaults, no game, one notice, first visit, and nothing is written over what could not be read', () => {
  const { store, storage } = setup({ [KEYS.game]: JSON.stringify(sampleGame()), [KEYS.settings]: JSON.stringify({ schema: 2, theme: 'shachang' }) });
  storage.failGet = true;
  const loaded = store.load();
  assert.equal(loaded.game, null);
  assert.deepEqual(loaded.settings, DEFAULT_SETTINGS);
  assert.equal(loaded.profile.skill.level, 2);
  assert.deepEqual(loaded.notices, ['storage-unavailable']);
  assert.equal(loaded.firstVisit, true);
  assert.equal(store.available(), false);
  // the records that could not be read are not replaced by this session
  storage.failGet = false;
  assert.equal(store.saveGame({ ...sampleGame(), moves: [] }), false);
  assert.equal(store.saveProfile(loaded.profile), false);
  store.saveSettings({ theme: 'longzhong' });
  store.quarantine('game', 'truncated');
  assert.deepEqual(storage.log, []);
  assert.equal(store.importBackup(fixtureText('backup-ok.json')).ok, false);
  assert.deepEqual(storage.log, []);

  // no Storage object at all (storage: null) behaves the same
  const none = createStore({ storage: null, now: () => NOW, teacher: fakeTeacher() });
  assert.equal(none.available(), false);
  const empty = none.load();
  assert.equal(empty.game, null);
  assert.deepEqual(empty.settings, DEFAULT_SETTINGS);
  assert.deepEqual(empty.notices, ['storage-unavailable']);
  assert.equal(empty.firstVisit, true);
  assert.equal(none.saveGame(sampleGame()), false);
  assert.equal(none.saveSettings({ volume: 0.2 }).volume, 0.2);
  assert.deepEqual(none.exportBackup().game, sampleGame());
});

test('without injected dependencies the store uses the page localStorage and the real clock, and survives a browser that refuses access', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const restore = () => {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  };
  try {
    // the page's own storage
    const memory = createMemoryStorage({ [KEYS.game]: JSON.stringify(sampleGame()) });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => memory });
    const before = Date.now();
    const store = createStore({ teacher: fakeTeacher() });
    const loaded = store.load();
    const after = Date.now();
    assert.deepEqual(loaded.game, sampleGame());
    assert.ok(loaded.profile.createdAt >= before && loaded.profile.createdAt <= after);
    assert.equal(store.saveGame({ ...sampleGame(), moves: ['7774'] }), true);
    assert.deepEqual(JSON.parse(memory.dump()[KEYS.game]).moves, ['7774']);

    // a browser that throws on the very access to localStorage (all site data blocked)
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    const blocked = createStore({ teacher: fakeTeacher() });
    assert.equal(blocked.available(), false);
    const empty = blocked.load();
    assert.equal(empty.game, null);
    assert.deepEqual(empty.notices, ['storage-unavailable']);
    assert.equal(empty.firstVisit, true);
    assert.equal(blocked.saveGame(sampleGame()), false);

    // no localStorage at all
    delete globalThis.localStorage;
    const none = createStore({ teacher: fakeTeacher() });
    assert.equal(none.available(), false);
    assert.deepEqual(none.load().notices, ['storage-unavailable']);
  } finally {
    restore();
  }
});

test('settings with unknown keys or bad values fall back per key', () => {
  assert.deepEqual(sanitizeSettings({
    schema: 9, theme: 'longzhong', sfx: 'yes', music: false, volume: 7, motion: 'fast', haptics: 0, typeTicks: true, readAloud: null, side: 'black',
    coach: 'cloud', freeText: false, talk: 'more', nickname: '小明', age: 10,
  }), {
    schema: 2, theme: 'longzhong', sfx: true, music: false, volume: 1, motion: 'auto', haptics: true, typeTicks: true, readAloud: false, side: 'black',
    coach: 'auto', freeText: false, talk: 'more',
  });
  // every documented value is accepted
  for (const [key, values] of Object.entries({ theme: ['chibi', 'longzhong', 'shachang'], motion: ['auto', 'full', 'reduced'], side: ['red', 'black'],
                                               coach: ['auto', 'local'], talk: ['smart', 'more'], sfx: [true, false], music: [true, false],
                                               haptics: [true, false], typeTicks: [true, false], readAloud: [true, false], freeText: [true, false],
                                               volume: [0, 0.35, 1] })) {
    for (const value of values) assert.deepEqual(sanitizeSettings({ [key]: value }), { ...DEFAULT_SETTINGS, [key]: value }, `${key}=${value}`);
  }
  // volume is clamped to 0..1; anything that is not a finite number is the default
  assert.equal(sanitizeSettings({ volume: -3 }).volume, 0);
  assert.equal(sanitizeSettings({ volume: 1.01 }).volume, 1);
  for (const bad of [NaN, Infinity, '0.5', null, true]) assert.equal(sanitizeSettings({ volume: bad }).volume, 1);
  // never null
  for (const junk of [null, undefined, 'x', 3, [], true]) assert.deepEqual(sanitizeSettings(junk), DEFAULT_SETTINGS);

  // through load(): bad JSON gives the defaults, a bad key gives the default for that key only, unknown keys are not kept
  assert.deepEqual(setup({ [KEYS.settings]: '{"theme":' }).store.load().settings, DEFAULT_SETTINGS);
  const mixed = setup({ [KEYS.settings]: JSON.stringify({ schema: 2, theme: 'shachang', volume: 'loud', side: 'black', coach: 5, nickname: '小明' }) });
  assert.deepEqual(mixed.store.load().settings, { ...DEFAULT_SETTINGS, theme: 'shachang', side: 'black' });
  mixed.store.saveSettings({});
  assert.deepEqual(JSON.parse(mixed.storage.dump()[KEYS.settings]), { ...DEFAULT_SETTINGS, theme: 'shachang', side: 'black' });
});

test('saveSettings validates, persists and notifies; onSettings returns an unsubscribe', () => {
  const { store, storage, open } = setup({ [KEYS.settings]: JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'longzhong' }) });
  store.load();
  const seen = [];
  const off = store.onSettings((s) => seen.push(s));
  store.onSettings(() => {
    throw new Error('a broken listener');
  });
  const second = [];
  store.onSettings((s) => second.push(s.volume));

  const original = console.error;
  console.error = () => {};
  try {
    const a = store.saveSettings({ volume: 0.25, coach: 'local' });
    assert.deepEqual(a, { ...DEFAULT_SETTINGS, theme: 'longzhong', volume: 0.25, coach: 'local' });
    assert.deepEqual(JSON.parse(storage.dump()[KEYS.settings]), a);
    assert.deepEqual(seen, [a]);
    assert.deepEqual(second, [0.25]);          // a throwing listener does not stop the others

    // a refused value keeps the current one; unknown keys and `schema` are ignored; volume is clamped
    const b = store.saveSettings({ theme: 'neon', volume: 4, side: 'black', schema: 7, nickname: '小明' });
    assert.deepEqual(b, { ...DEFAULT_SETTINGS, theme: 'longzhong', volume: 1, coach: 'local', side: 'black' });
    assert.deepEqual(JSON.parse(storage.dump()[KEYS.settings]), b);
    assert.deepEqual(seen[1], b);

    // the returned object is a copy
    b.theme = 'shachang';
    assert.equal(store.saveSettings({}).theme, 'longzhong');

    off();
    store.saveSettings({ music: false });
    assert.equal(seen.length, 3);
    assert.deepEqual(second, [0.25, 1, 1, 1]);
  } finally {
    console.error = original;
  }
  assert.equal(open().load().settings.music, false);

  // saving a setting before load() starts from what is stored, not from the defaults
  const early = setup({ [KEYS.settings]: JSON.stringify({ ...DEFAULT_SETTINGS, talk: 'more' }) });
  assert.deepEqual(early.store.saveSettings({ sfx: false }), { ...DEFAULT_SETTINGS, talk: 'more', sfx: false });
});

test('sanitizeGame: the rules of 13.4', () => {
  const base = sampleGame();
  // a valid record is unchanged
  assert.deepEqual(sanitizeGame(base, NOW), base);
  assert.deepEqual(sanitizeGame(fixture('v2-one-before-mate.json'), NOW), fixture('v2-one-before-mate.json'));

  // null = corrupt: not an object, moves not an array, more than 2000 items
  for (const junk of [null, undefined, 'x', 7, [], { ...base, moves: '7774' }, { ...base, moves: undefined }, { ...base, moves: { 0: '7774' } },
                      { ...base, moves: Array(2001).fill('9080') }]) {
    assert.equal(sanitizeGame(junk, NOW), null);
  }
  assert.equal(sanitizeGame({ ...base, moves: Array(2000).fill('9080') }, NOW).moves.length, 2000);

  // entries are kept up to the first one failing the MoveCode regex; drawFrom <= moves.length
  for (const bad of ['777', '77744', '7974', '7779', '9774x', 'a774', ' 7774', 7774, null, { from: '77', to: '74' }]) {
    const game = sanitizeGame({ ...base, moves: ['7774', '0726', bad, '0807'], drawFrom: 4 }, NOW);
    assert.deepEqual(game.moves, ['7774', '0726'], `stops at ${JSON.stringify(bad)}`);
    assert.equal(game.drawFrom, 2);
  }
  assert.deepEqual(sanitizeGame({ ...base, moves: ['0000', '9898', '9050'] }, NOW).moves, ['0000', '9898', '9050']);      // legality is not checked here

  // humanColor, result, startedAt, endedAt follow the rules of 13.3
  assert.equal(sanitizeGame({ ...base, humanColor: 'black' }, NOW).humanColor, 'black');
  assert.equal(sanitizeGame({ ...base, humanColor: 'white' }, NOW).humanColor, 'red');
  assert.deepEqual(sanitizeGame({ ...base, result: { winner: 'red', reason: 'resign', over: true } }, NOW).result, { winner: 'red', reason: 'resign' });
  assert.equal(sanitizeGame({ ...base, result: { winner: 'red', reason: 'checkmate' } }, NOW).result, null);
  assert.equal(sanitizeGame({ ...base, result: { winner: null, reason: 'resign' } }, NOW).result, null);
  assert.equal(sanitizeGame({ ...base, result: 'resign' }, NOW).result, null);
  assert.equal(sanitizeGame({ ...base, startedAt: NOW + 5000 }, NOW).startedAt, NOW);
  assert.equal(sanitizeGame({ ...base, startedAt: 'yesterday' }, NOW).startedAt, NOW);
  assert.equal(sanitizeGame({ ...base, startedAt: 0 }, NOW).startedAt, NOW);
  assert.equal(sanitizeGame({ ...base, endedAt: T0 + 1 }, NOW).endedAt, T0 + 1);
  assert.equal(sanitizeGame({ ...base, endedAt: T0 - 1 }, NOW).endedAt, null);
  assert.equal(sanitizeGame({ ...base, endedAt: NOW + 1 }, NOW).endedAt, null);
  assert.equal(sanitizeGame({ ...base, endedAt: 'later' }, NOW).endedAt, null);

  // activeMs, drawFrom, seed are coerced to non-negative integers
  const odd = sanitizeGame({ ...base, activeMs: 48200.9, drawFrom: 3.7, seed: 12.5 }, NOW);
  assert.deepEqual([odd.activeMs, odd.drawFrom, odd.seed], [48200, 3, 12]);
  const negative = sanitizeGame({ ...base, activeMs: -1, drawFrom: -2, seed: -3 }, NOW);
  assert.deepEqual([negative.activeMs, negative.drawFrom, negative.seed], [0, 0, 0]);
  const missing = sanitizeGame({ moves: ['7774'] }, NOW);
  assert.deepEqual([missing.activeMs, missing.drawFrom, missing.seed], [0, 0, 0]);
  assert.equal(sanitizeGame({ ...base, drawFrom: 99 }, NOW).drawFrom, base.moves.length);
  assert.equal(sanitizeGame({ ...base, seed: 4294967295 }, NOW).seed, 4294967295);
  const bigSeed = sanitizeGame({ ...base, seed: 2 ** 40 + 5 }, NOW).seed;
  assert.ok(Number.isInteger(bigSeed) && bigSeed >= 0 && bigSeed <= 0xFFFFFFFF);

  // id regenerated if malformed; counted coerced to boolean; skill and memory passed on as raw objects or null; start null
  assert.equal(sanitizeGame(base, NOW).id, 'g-m3k09x2a');
  for (const id of ['g-abc', 'G-M3K09X2A', 'm3k09x2a', 'g-' + 'a'.repeat(17), 42, undefined]) {
    const fresh = sanitizeGame({ ...base, id }, NOW).id;
    assert.match(fresh, GAME_ID);
    assert.notEqual(fresh, id);
  }
  assert.equal(sanitizeGame({ ...base, counted: 1 }, NOW).counted, true);
  assert.equal(sanitizeGame({ ...base, counted: undefined }, NOW).counted, false);
  for (const raw of ['skill', 7, [1, 2], undefined]) {
    assert.equal(sanitizeGame({ ...base, skill: raw, memory: raw }, NOW).skill, null);
    assert.equal(sanitizeGame({ ...base, skill: raw, memory: raw }, NOW).memory, null);
  }
  const garbage = { anything: [1, 2, 3] };
  assert.deepEqual(sanitizeGame({ ...base, skill: garbage, memory: garbage }, NOW).skill, garbage);      // reviveGameSkill sanitises it later
  assert.deepEqual(Object.keys(sanitizeGame({ ...base, nickname: '小明', chat: ['你好'] }, NOW)).sort(), [...GAME_KEYS].sort());
  assert.deepEqual(missing, { schema: 2, id: missing.id, humanColor: 'red', moves: ['7774'], result: null, startedAt: NOW, endedAt: null, activeMs: 0,
                              counted: false, drawFrom: 0, seed: 0, skill: null, memory: null, start: null });
});

test('a stored game with a malformed entry loads its prefix and its raw text is copied aside first', () => {
  const text = JSON.stringify({ ...sampleGame(), moves: ['7774', '0726', 'oops', '0807'], skill: null, memory: null });
  const { store, storage } = setup({ [KEYS.game]: text });
  const loaded = store.load();
  assert.deepEqual(loaded.game.moves, ['7774', '0726']);
  assert.deepEqual(loaded.notices, []);
  assert.equal(storage.dump()[KEYS.game], text);                                      // the record itself stays until the next save
  assert.deepEqual(JSON.parse(storage.dump()[KEYS.quarantine]), { kind: 'game', at: NOW, why: 'truncated', raw: text });
});

test('sanitizeProfile keeps what is valid and repairs the rest', () => {
  const teacher = fakeTeacher();
  const good = sampleProfile();
  assert.deepEqual(sanitizeProfile(good, teacher, NOW), good);
  // the skill goes through migrateSkillProfile
  assert.deepEqual(teacher.calls, [['migrate', good.skill]]);

  // garbage -> a usable profile at the teacher's default level
  for (const junk of [null, undefined, 'x', 5, [], {}]) {
    assert.deepEqual(sanitizeProfile(junk, fakeTeacher(), NOW), {
      schema: 2, skill: fakeTeacher().createSkillProfile(2), games: { played: 0, won: 0, lost: 0, drawn: 0 }, rank: 2, goal: null, introSeen: false, createdAt: NOW,
    });
  }

  // per-field repair
  const fix = (patch) => sanitizeProfile({ ...good, ...patch }, fakeTeacher(), NOW);
  assert.deepEqual(fix({ games: { played: 3.9, won: -1, lost: '2', drawn: null } }).games, { played: 3, won: 0, lost: 0, drawn: 0 });
  assert.deepEqual(fix({ games: 'many' }).games, { played: 0, won: 0, lost: 0, drawn: 0 });
  // rank: 1..9, a high-water mark of round(skill.level): never below the rank of the level (3.4 -> 3)
  assert.equal(fix({ rank: 4 }).rank, 4);
  assert.equal(fix({ rank: 9 }).rank, 9);
  assert.equal(fix({ rank: 1 }).rank, 3);
  for (const bad of [0, 10, 4.5, '4', null, undefined]) assert.equal(fix({ rank: bad }).rank, 3, `rank ${bad}`);
  assert.equal(fix({ rank: 2, skill: { ...good.skill, level: 8.5 } }).rank, 9);
  // goal: a habit code of codes.js and a time, else null
  assert.deepEqual(fix({ goal: { code: 'miss_threat', setAt: T0 } }).goal, { code: 'miss_threat', setAt: T0 });
  assert.deepEqual(fix({ goal: { code: 'greedy', setAt: NOW + 99 } }).goal, { code: 'greedy', setAt: NOW });
  assert.deepEqual(fix({ goal: { code: 'greedy' } }).goal, { code: 'greedy', setAt: NOW });
  for (const bad of [{ code: 'be_nice', setAt: T0 }, { setAt: T0 }, 'greedy', null, undefined, ['greedy']]) assert.equal(fix({ goal: bad }).goal, null);
  assert.equal(fix({ introSeen: 'yes' }).introSeen, false);
  assert.equal(fix({ introSeen: true }).introSeen, true);
  assert.equal(fix({ createdAt: NOW + 1 }).createdAt, NOW);
  assert.equal(fix({ createdAt: 'long ago' }).createdAt, NOW);
  assert.equal(fix({ createdAt: T0 }).createdAt, T0);
  // nothing else is kept: no name, no free text
  assert.deepEqual(Object.keys(fix({ name: '小明', note: 'hi' })).sort(), ['createdAt', 'games', 'goal', 'introSeen', 'rank', 'schema', 'skill']);
});

test('recordResult counts one finished game and returns a new profile', () => {
  const profile = sampleProfile();          // played 9, won 4, lost 4, drawn 1
  const frozen = structuredClone(profile);
  const won = recordResult(profile, 'win');
  assert.deepEqual(won.games, { played: 10, won: 5, lost: 4, drawn: 1 });
  assert.deepEqual(recordResult(profile, 'loss').games, { played: 10, won: 4, lost: 5, drawn: 1 });
  assert.deepEqual(recordResult(profile, 'draw').games, { played: 10, won: 4, lost: 4, drawn: 2 });
  assert.deepEqual(recordResult(won, 'draw').games, { played: 11, won: 5, lost: 4, drawn: 2 });
  // pure: the input is untouched, every other field is carried over, the rank is the director's business
  assert.deepEqual(profile, frozen);
  assert.notEqual(won, profile);
  assert.notEqual(won.games, profile.games);
  assert.deepEqual({ ...won, games: profile.games }, profile);
});

test('importBackup validates everything before writing; a bad file changes nothing', () => {
  const stored = { [KEYS.game]: JSON.stringify(sampleGame()), [KEYS.profile]: JSON.stringify({ ...sampleProfile(), rank: 5 }),
                   [KEYS.settings]: JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'chibi', volume: 0.9 }), [KEYS.migrated]: '1' };
  const { store, storage, open } = setup(stored);
  store.load();
  const ok = fixture('backup-ok.json');

  // the fixture: a usable profile and usable settings, but the game's move list is not a list
  const bad = store.importBackup(fixtureText('backup-bad.json'));
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.why, 'string');
  assert.deepEqual(storage.dump(), stored);
  assert.deepEqual(storage.log, []);

  const variants = [
    '', 'not json', '{"kind":"yijian-backup","v":1,', 'null', '[]', '"yijian-backup"',
    JSON.stringify({ ...ok, kind: 'backup' }),
    JSON.stringify({ ...ok, kind: undefined }),
    JSON.stringify({ ...ok, v: 2 }),
    JSON.stringify({ ...ok, v: '1' }),
    JSON.stringify({ ...ok, game: undefined }),                                    // the game must be a record or null
    JSON.stringify({ ...ok, game: 'none' }),
    JSON.stringify({ ...ok, game: { ...ok.game, moves: Array(2001).fill('9080') } }),
    JSON.stringify({ ...ok, game: { ...ok.game, schema: 3 } }),
    JSON.stringify({ ...ok, game: { ...ok.game, start: 'rnbakabnr/9 w' } }),
    JSON.stringify({ ...ok, profile: undefined }),
    JSON.stringify({ ...ok, profile: null }),
    JSON.stringify({ ...ok, profile: [] }),
    JSON.stringify({ ...ok, profile: { ...ok.profile, schema: 3 } }),
    JSON.stringify({ ...ok, settings: undefined }),
    JSON.stringify({ ...ok, settings: 'loud' }),
    JSON.stringify({ ...ok, settings: { ...ok.settings, schema: 3 } }),
  ];
  for (const text of variants) {
    const result = store.importBackup(text);
    assert.equal(result.ok, false, text.slice(0, 60));
    assert.equal(typeof result.why, 'string');
    assert.deepEqual(storage.dump(), stored, text.slice(0, 60));
    assert.deepEqual(storage.log, []);
  }
  assert.equal(store.importBackup(undefined).ok, false);
  // and the store itself still holds the old state
  assert.deepEqual(store.exportBackup().game, sampleGame());
  assert.equal(store.saveSettings({}).volume, 0.9);
  storage.log.length = 0;

  // a good file: all three records are written, sanitised
  const noisy = { ...ok, settings: { ...ok.settings, coach: 'cloud', nickname: '小明' }, game: { ...ok.game, nickname: '小明' } };
  assert.deepEqual(store.importBackup(JSON.stringify(noisy)), { ok: true });
  const dump = storage.dump();
  assert.deepEqual(JSON.parse(dump[KEYS.game]), ok.game);
  assert.deepEqual(JSON.parse(dump[KEYS.profile]), ok.profile);
  assert.deepEqual(JSON.parse(dump[KEYS.settings]), { ...ok.settings, coach: 'auto' });
  assert.deepEqual(writesTo(storage, KEYS.v1), []);

  // after the reload the imported state is what loads, and the import is announced exactly once
  const next = open().load();
  assert.deepEqual(next.game, ok.game);
  assert.deepEqual(next.profile, ok.profile);
  assert.deepEqual(next.settings, { ...ok.settings, coach: 'auto' });
  assert.deepEqual(next.notices, ['imported']);
  assert.equal(next.firstVisit, false);
  assert.deepEqual(open().load().notices, []);
  assert.equal(storage.dump()[KEYS.migrated], '1');

  // the fixture file as it is on disk, with a byte order mark as a text editor may add
  const fresh = setup();
  fresh.store.load();
  assert.deepEqual(fresh.store.importBackup('\uFEFF' + fixtureText('backup-ok.json')), { ok: true });
  assert.deepEqual(fresh.open().load().game, ok.game);

  // a backup without a game removes the stored game
  const empty = setup(stored);
  empty.store.load();
  assert.deepEqual(empty.store.importBackup(JSON.stringify({ ...ok, game: null })), { ok: true });
  assert.equal(empty.storage.dump()[KEYS.game], undefined);
  const reloaded = empty.open().load();
  assert.equal(reloaded.game, null);
  assert.deepEqual(reloaded.profile, ok.profile);

  // a v1 save on this device is not imported over an imported state
  const withV1 = setup({ [KEYS.v1]: fixtureText('v1-ai-red.json'), [KEYS.game]: JSON.stringify(sampleGame()) });
  withV1.store.load();
  assert.deepEqual(withV1.store.importBackup(JSON.stringify({ ...ok, game: null })), { ok: true });
  assert.equal(withV1.open().load().game, null);

  // a write that fails half-way puts the old records back
  const inner = createMemoryStorage(stored);
  const flaky = {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      if (key === KEYS.settings) throw new Error('quota');
      inner.setItem(key, value);
    },
    removeItem: (key) => inner.removeItem(key),
  };
  const half = createStore({ storage: flaky, now: () => NOW, teacher: fakeTeacher() });
  half.load();
  const failed = half.importBackup(JSON.stringify(ok));
  assert.equal(failed.ok, false);
  assert.deepEqual(inner.dump(), stored);
});

test('quarantine keeps the raw text of a truncated game', () => {
  // a stored game whose third move is illegal, written with spaces a re-serialisation would not reproduce
  const game = { ...sampleGame(), moves: ['7774', '0726', '9050', '0807'], skill: null, memory: null };
  const raw = JSON.stringify(game, null, 3) + '\n';
  const { store, storage } = setup({ [KEYS.game]: raw });
  const loaded = store.load();
  assert.deepEqual(loaded.game.moves, ['7774', '0726', '9050', '0807']);       // the store does not judge legality
  assert.deepEqual(loaded.notices, []);
  assert.equal(storage.dump()[KEYS.quarantine], undefined);

  // the director calls this in its game:start handler, before the session's `change` rewrites the record
  store.quarantine('game', 'truncated');
  assert.deepEqual(JSON.parse(storage.dump()[KEYS.quarantine]), { kind: 'game', at: NOW, why: 'truncated', raw });
  assert.equal(storage.dump()[KEYS.game], raw);                                // keeps the record itself
  assert.deepEqual(writesTo(storage, KEYS.game), []);

  // the rewrite without the bad tail does not touch the copy
  assert.equal(store.saveGame({ ...loaded.game, moves: ['7774', '0726'] }), true);
  assert.deepEqual(JSON.parse(storage.dump()[KEYS.game]).moves, ['7774', '0726']);
  assert.equal(JSON.parse(storage.dump()[KEYS.quarantine]).raw, raw);

  // one slot: a later quarantine replaces it; the profile can be copied too
  const profileText = JSON.stringify(sampleProfile());
  storage.setItem(KEYS.profile, profileText);
  store.quarantine('profile', 'checked');
  assert.deepEqual(JSON.parse(storage.dump()[KEYS.quarantine]), { kind: 'profile', at: NOW, why: 'checked', raw: profileText });
  assert.equal(storage.dump()[KEYS.profile], profileText);

  // nothing stored, or not a record kind: the slot is left alone
  const before = storage.dump()[KEYS.quarantine];
  storage.removeItem(KEYS.game);
  store.quarantine('game', 'truncated');
  store.quarantine('settings', 'x');
  assert.equal(storage.dump()[KEYS.quarantine], before);

  // the migrated v1 game with the illegal third move: what is copied is the record the session is about to shorten
  const v1 = setup({ [KEYS.v1]: fixtureText('v1-illegal-third-move.json') });
  const migrated = v1.store.load();
  v1.store.quarantine('game', 'truncated');
  const slot = JSON.parse(v1.storage.dump()[KEYS.quarantine]);
  assert.equal(slot.why, 'truncated');
  assert.deepEqual(JSON.parse(slot.raw), migrated.game);
  assert.deepEqual(JSON.parse(slot.raw).moves, ['7774', '0726', '9050', '0807']);
  assert.equal(v1.storage.dump()[KEYS.v1], fixtureText('v1-illegal-third-move.json'));
});

test('the fixtures of 13.6 are all there and are the games their names describe', async () => {
  const expected = ['v1-ai-red.json', 'v1-ai-black-hard.json', 'v1-local.json', 'v1-resigned.json', 'v1-string-coordinates.json', 'v1-extra-move-fields.json',
                    'v1-null-entry.json', 'v1-future-startedAt.json', 'v1-2001-moves.json', 'v1-version-2-under-v1-key.json', 'v1-illegal-third-move.json',
                    'v1-repetition.json', 'v1-121-quiet-plies.json', 'v1-700-plies.json', 'v2-midgame.json', 'v2-one-before-mate.json', 'v2-schema-3.json',
                    'v2-corrupt.txt', 'backup-ok.json', 'backup-bad.json'];
  assert.deepEqual(readdirSync(SAVES).sort(), [...expected].sort());
  for (const name of expected) {
    const text = fixtureText(name);
    // line endings are not checked: git may hand the files out with CRLF (core.autocrlf), and no test depends on them
    assert.notEqual(text.charCodeAt(0), 0xFEFF, `${name} has no byte order mark`);
    if (name === 'v2-corrupt.txt') assert.throws(() => JSON.parse(text), SyntaxError);
    else assert.doesNotThrow(() => JSON.parse(text), name);
  }
  // v1 saves have exactly the fields the v1 writer wrote (the "extra fields" fixture has more, on purpose)
  const v1Keys = ['version', 'mode', 'difficulty', 'humanColor', 'flipped', 'sound', 'moves', 'startedAt', 'endedAt', 'result'];
  for (const name of expected.filter((n) => n.startsWith('v1-') && n !== 'v1-extra-move-fields.json')) assert.deepEqual(Object.keys(fixture(name)), v1Keys, name);
  assert.equal(fixture('v1-version-2-under-v1-key.json').version, 2);
  assert.equal(fixture('v1-local.json').mode, 'local');
  assert.ok(fixture('v1-future-startedAt.json').startedAt > Date.now());
  assert.ok(fixture('v1-string-coordinates.json').moves.some((m) => typeof m.from.row === 'string'));
  assert.ok(fixture('v1-extra-move-fields.json').moves.every((m) => Object.keys(m).length > 2 || Object.keys(m.from).length > 2));
  assert.equal(fixture('v1-null-entry.json').moves[2], null);

  // replay with the rules engine (v1 API only): natural rules, no draw rules, as session.restore replays
  const { createInitialBoard, getLegalMoves, applyMove, getGameStatus, isInCheck } = await import('../../../src/core/engine.js');
  /** @param {string[]} codes */
  const replay = (codes) => {
    let board = createInitialBoard();
    let turn = 'red';
    const keys = [JSON.stringify(board) + turn];
    const captures = [];
    let illegalAt = null;
    for (let i = 0; i < codes.length; i++) {
      const move = getGameStatus(board, turn).over ? undefined
        : getLegalMoves(board, turn).find((m) => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}` === codes[i]);
      if (!move) {
        illegalAt = i;
        break;
      }
      if (move.captured) captures.push(i);
      board = applyMove(board, move);
      turn = turn === 'red' ? 'black' : 'red';
      keys.push(JSON.stringify(board) + turn);
    }
    return { board, turn, keys, captures, illegalAt, status: getGameStatus(board, turn) };
  };
  const v1Codes = (name) => migrateV1(fixture(name), NOW).game.moves;
  /** A game in progress after `plies` legal plies, with `turn` to move. */
  const inProgress = (name, codes, plies, turn) => {
    const end = replay(codes);
    assert.equal(end.illegalAt, null, `${name}: every move is legal`);
    assert.equal(codes.length, plies, name);
    assert.equal(end.status.over, false, `${name}: not over`);
    assert.equal(end.turn, turn, name);
    return end;
  };
  inProgress('v1-ai-red.json', v1Codes('v1-ai-red.json'), 4, 'red');
  inProgress('v1-ai-black-hard.json', v1Codes('v1-ai-black-hard.json'), 3, 'black');
  assert.equal(fixture('v1-ai-black-hard.json').humanColor, 'black');
  assert.equal(fixture('v1-ai-black-hard.json').difficulty, 'hard');
  inProgress('v1-local.json', v1Codes('v1-local.json'), 5, 'black');
  inProgress('v1-resigned.json', v1Codes('v1-resigned.json'), 4, 'red');
  inProgress('v1-string-coordinates.json', v1Codes('v1-string-coordinates.json'), 4, 'red');
  inProgress('v1-extra-move-fields.json', v1Codes('v1-extra-move-fields.json'), 4, 'red');
  inProgress('v1-future-startedAt.json', v1Codes('v1-future-startedAt.json'), 4, 'red');

  // the illegal third move: two legal plies, then one no rule allows
  assert.equal(replay(v1Codes('v1-illegal-third-move.json')).illegalAt, 2);

  // 13 plies whose first 8 shuffle rooks: the start position three times, which the v2 repetition rule would call a draw
  const repetition = inProgress('v1-repetition.json', v1Codes('v1-repetition.json'), 13, 'black');
  assert.equal(repetition.keys[4], repetition.keys[0]);
  assert.equal(repetition.keys[8], repetition.keys[0]);
  assert.equal(fixture('v1-repetition.json').humanColor, 'black');

  // 121 plies without a capture (more than the 120 of the no-capture rule), without a check and without any repeated position
  const quiet = inProgress('v1-121-quiet-plies.json', v1Codes('v1-121-quiet-plies.json'), 121, 'black');
  assert.deepEqual(quiet.captures, []);
  assert.equal(new Set(quiet.keys).size, 122);
  assert.equal(isInCheck(quiet.board, 'black'), false);

  // 700 legal plies (more than the move limit of 600)
  inProgress('v1-700-plies.json', v1Codes('v1-700-plies.json'), 700, 'red');

  // v2 games
  const midgame = inProgress('v2-midgame.json', fixture('v2-midgame.json').moves, 8, 'red');
  assert.deepEqual(midgame.captures, [6, 7]);
  assert.equal(fixture('v2-midgame.json').skill.marks.length, 8);              // one snapshot after every ply
  assert.deepEqual(fixture('v2-midgame.json').skill.samples.map((s) => s.ply), [0, 2, 4, 6]);
  inProgress('backup-ok.json', fixture('backup-ok.json').game.moves, 6, 'red');

  // one before mate: red (the child) to move, and exactly one of its moves ends the game by checkmate
  const before = fixture('v2-one-before-mate.json');
  assert.equal(before.humanColor, 'red');
  const position = inProgress('v2-one-before-mate.json', before.moves, 6, 'red');
  const mates = getLegalMoves(position.board, 'red').filter((m) => {
    const status = getGameStatus(applyMove(position.board, m), 'black');
    return status.over && status.winner === 'red' && status.reason === 'checkmate';
  });
  assert.deepEqual(mates.map((m) => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}`), ['5154']);
});
