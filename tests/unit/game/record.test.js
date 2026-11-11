// Record (SPEC 4.21): 棋谱 text export, backup export file, notation rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveObjectURL } from 'node:buffer';

import { buildRecord, buildBackupFile, download, notationRows } from '../../../src/game/record.js';
import { KEYS, createStore } from '../../../src/game/store.js';
import { createMemoryStorage } from '../../helpers/memory-storage.js';

const SAVES = new URL('../../fixtures/saves/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, SAVES), 'utf8'));

/** History entries as the session keeps them; the record only reads `notation`. */
const plies = (...notations) => notations.map((notation, i) => ({ notation, color: i % 2 === 0 ? 'red' : 'black' }));

/** The part of SessionState a record is built from. */
const stateOf = (fields) => ({ history: [], humanColor: 'red', result: null, startedAt: new Date(2026, 10, 10, 9, 5, 42).getTime(), ...fields });

const teacher = {
  createSkillProfile: (seedLevel = 2) => ({ v: 1, level: seedLevel, games: 0, tactics: { seen: [0, 0, 0], found: [0, 0, 0] }, streak: 0, bandShift: 0, habits: {}, recent: [] }),
  migrateSkillProfile: (raw) => (raw && typeof raw === 'object' && raw.v === 1 ? structuredClone(raw) : teacher.createSkillProfile(2)),
  reviveGameSkill: () => {
    throw new Error('not used by the store');
  },
};

/**
 * Runs `fn` with the process in an IANA time zone (Node re-reads TZ whenever it is assigned), then puts the old zone back.
 * The machine that runs the tests may be on UTC, where the local date and the UTC date never differ.
 */
function inZone(zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('record text lists every round and uses the local date in the file name', () => {
  const history = plies('炮二平五', '马8进7', '马二进三', '车9平8', '车一平二');

  // Half an hour after local midnight east of Greenwich is still the day before in UTC; half an hour before local
  // midnight west of it is already the next day in UTC. The file name and the 开局 line must show the local day.
  inZone('Asia/Shanghai', () => {
    const start = new Date(2026, 10, 10, 0, 30, 0).getTime();
    assert.equal(new Date(start).toISOString().slice(0, 10), '2026-11-09');
    const record = buildRecord(stateOf({ history, startedAt: start }), 0);
    assert.equal(record.filename, '弈间棋谱-2026-11-10.txt');
    assert.equal(record.text.split('\n')[2], '开局：2026-11-10 00:30');
  });
  inZone('America/Los_Angeles', () => {
    const start = new Date(2026, 10, 10, 23, 30, 0).getTime();
    assert.equal(new Date(start).toISOString().slice(0, 10), '2026-11-11');
    const record = buildRecord(stateOf({ history, startedAt: start }), 0);
    assert.equal(record.filename, '弈间棋谱-2026-11-10.txt');
    assert.equal(record.text.split('\n')[2], '开局：2026-11-10 23:30');
  });

  const early = new Date(2026, 10, 10, 0, 30, 0).getTime();
  const late = new Date(2026, 10, 10, 23, 30, 0).getTime();

  const record = buildRecord(stateOf({ history, startedAt: early }), 725000);
  assert.equal(record.filename, '弈间棋谱-2026-11-10.txt');
  assert.equal(record.text, '\uFEFF' + [
    '弈间 · 中国象棋棋谱',
    '对手：司马懿（指导棋）',
    '开局：2026-11-10 00:30',
    '用时：12:05',
    '结果：进行中',
    '',
    '1. 炮二平五    马8进7',
    '2. 马二进三    车9平8',
    '3. 车一平二',
  ].join('\n'));
  assert.equal(record.text.charCodeAt(0), 0xFEFF);          // UTF-8 with BOM once the browser encodes it
  assert.equal(record.text.includes('\r'), false);

  const evening = buildRecord(stateOf({ history, startedAt: late }), 0);
  assert.equal(evening.filename, '弈间棋谱-2026-11-10.txt');
  assert.equal(evening.text.split('\n')[2], '开局：2026-11-10 23:30');
  assert.equal(evening.text.split('\n')[3], '用时：00:00');

  // single digits are padded; the date is the day the game started
  const january = buildRecord(stateOf({ history, startedAt: new Date(2027, 0, 3, 7, 4, 59).getTime() }), 61999);
  assert.equal(january.filename, '弈间棋谱-2027-01-03.txt');
  assert.equal(january.text.split('\n')[2], '开局：2027-01-03 07:04');
  assert.equal(january.text.split('\n')[3], '用时：01:01');

  // every round is listed: 40 plies give 20 numbered lines after the blank line
  const long = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? `红${i}` : `黑${i}`));
  const lines = buildRecord(stateOf({ history: plies(...long) }), 3723000).text.split('\n');
  assert.equal(lines.length, 6 + 20);
  assert.equal(lines[5], '');
  assert.deepEqual(lines.slice(6), Array.from({ length: 20 }, (_, r) => `${r + 1}. 红${2 * r}    黑${2 * r + 1}`));
  assert.equal(lines[3], '用时：62:03');                    // mm:ss: minutes keep counting past the hour

  // an empty game has the header only
  assert.equal(buildRecord(stateOf({}), 0).text.split('\n').length, 6);

  // the result line, from the child's point of view
  const result = (fields) => buildRecord(stateOf({ history, ...fields }), 0).text.split('\n')[4];
  assert.equal(result({ result: null }), '结果：进行中');
  assert.equal(result({ humanColor: 'red', result: { winner: 'red', reason: 'checkmate' } }), '结果：小主公胜');
  assert.equal(result({ humanColor: 'red', result: { winner: 'black', reason: 'resign' } }), '结果：司马懿胜');
  assert.equal(result({ humanColor: 'black', result: { winner: 'black', reason: 'stalemate' } }), '结果：小主公胜');
  assert.equal(result({ humanColor: 'black', result: { winner: 'red', reason: 'checkmate' } }), '结果：司马懿胜');
  assert.equal(result({ humanColor: 'black', result: { winner: null, reason: 'repetition' } }), '结果：和棋');
});

test('backup file round-trips through importBackup', () => {
  const at = new Date(2026, 10, 10, 23, 45, 0).getTime();
  const game = fixture('v2-midgame.json');
  const profile = fixture('backup-ok.json').profile;

  const source = createStore({ storage: createMemoryStorage(), now: () => at, teacher });
  source.load();
  source.saveGame(game);
  source.saveProfile(profile);
  const settings = source.saveSettings({ theme: 'longzhong', volume: 0.5, side: 'black', talk: 'more' });

  const backup = source.exportBackup();
  const file = buildBackupFile(backup);
  assert.equal(file.filename, '弈间存档-2026-11-10.json');           // the local date of the export
  inZone('America/Los_Angeles', () => {
    const evening = new Date(2026, 10, 10, 23, 45, 0).getTime();     // already 11 November in UTC
    assert.equal(buildBackupFile({ ...backup, at: evening }).filename, '弈间存档-2026-11-10.json');
  });
  inZone('Asia/Shanghai', () => {
    const night = new Date(2027, 0, 1, 0, 15, 0).getTime();          // still 31 December 2026 in UTC
    assert.equal(buildBackupFile({ ...backup, at: night }).filename, '弈间存档-2027-01-01.json');
  });
  assert.deepEqual(JSON.parse(file.text), { kind: 'yijian-backup', v: 1, at, game, profile, settings });
  assert.deepEqual(JSON.parse(file.text), backup);
  assert.notEqual(file.text.charCodeAt(0), 0xFEFF);                   // JSON carries no byte order mark

  // another device (another origin): empty storage, import, reload
  const storage = createMemoryStorage();
  const target = createStore({ storage, now: () => at + 60000, teacher });
  assert.equal(target.load().firstVisit, true);
  assert.deepEqual(target.importBackup(file.text), { ok: true });
  const loaded = createStore({ storage, now: () => at + 120000, teacher }).load();
  assert.deepEqual(loaded.game, game);
  assert.deepEqual(loaded.profile, profile);
  assert.deepEqual(loaded.settings, settings);
  assert.equal(loaded.firstVisit, false);
  assert.deepEqual(JSON.parse(storage.dump()[KEYS.game]), game);

  // exporting there gives the same three records again
  const again = createStore({ storage, now: () => at + 180000, teacher });
  again.load();
  assert.deepEqual(JSON.parse(buildBackupFile(again.exportBackup()).text), { ...backup, at: at + 180000 });

  // a backup without a game
  const empty = buildBackupFile({ ...backup, game: null });
  assert.equal(JSON.parse(empty.text).game, null);
  assert.deepEqual(createStore({ storage: createMemoryStorage(), now: () => at, teacher }).importBackup(empty.text), { ok: true });
});

test('notationRows pairs red and black', () => {
  assert.deepEqual(notationRows([]), []);
  assert.deepEqual(notationRows(plies('炮二平五')), [{ n: 1, red: '炮二平五' }]);
  assert.equal('black' in notationRows(plies('炮二平五'))[0], false);       // no black move yet: the key is absent
  assert.deepEqual(notationRows(plies('炮二平五', '马8进7')), [{ n: 1, red: '炮二平五', black: '马8进7' }]);
  assert.deepEqual(notationRows(plies('炮二平五', '马8进7', '马二进三', '车9平8', '车一平二')), [
    { n: 1, red: '炮二平五', black: '马8进7' },
    { n: 2, red: '马二进三', black: '车9平8' },
    { n: 3, red: '车一平二' },
  ]);
  const many = notationRows(plies(...Array.from({ length: 600 }, (_, i) => `着${i}`)));
  assert.equal(many.length, 300);
  assert.deepEqual(many[299], { n: 300, red: '着598', black: '着599' });
});

test('download saves the text through a Blob link and releases the URL afterwards', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const link = {
    href: '', download: '', rel: '', style: {},
    click() {
      events.push(['click', this.href, this.download]);
    },
    remove() {
      events.push(['remove']);
    },
  };
  const hadDocument = 'document' in globalThis;
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      events.push(['create', tag]);
      return link;
    },
    body: {
      append(node) {
        events.push(['append', node === link]);
      },
    },
  };
  const revoke = t.mock.method(URL, 'revokeObjectURL');
  try {
    const record = buildRecord(stateOf({ history: plies('炮二平五', '马8进7') }), 5000);
    download(record);
    assert.deepEqual(events.map((e) => e[0]), ['create', 'append', 'click', 'remove']);
    assert.deepEqual(events[0], ['create', 'a']);
    assert.deepEqual(events[1], ['append', true]);
    assert.equal(link.download, record.filename);
    assert.match(link.href, /^blob:/);

    // the Blob holds the text as UTF-8, starting with the byte order mark EF BB BF
    const blob = resolveObjectURL(link.href);
    assert.ok(blob, 'the URL is alive while the browser saves the file');
    assert.equal(blob.type, 'text/plain;charset=utf-8');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
    assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), record.text);

    // released later, not at once (a mobile browser may still be asking the user)
    assert.equal(revoke.mock.callCount(), 0);
    t.mock.timers.tick(60000);
    assert.equal(revoke.mock.callCount(), 1);
    assert.equal(revoke.mock.calls[0].arguments[0], link.href);

    // a backup is offered as JSON
    download({ filename: '弈间存档-2026-11-10.json', text: '{"kind":"yijian-backup"}' });
    assert.equal(link.download, '弈间存档-2026-11-10.json');
    const json = resolveObjectURL(link.href);
    assert.equal(json.type, 'application/json;charset=utf-8');
    assert.equal(await json.text(), '{"kind":"yijian-backup"}');
    t.mock.timers.tick(60000);
    assert.equal(revoke.mock.callCount(), 2);
  } finally {
    if (hadDocument) globalThis.document = previous;
    else delete globalThis.document;
  }
});
