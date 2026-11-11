import test from 'node:test';
import assert from 'node:assert/strict';

import * as codes from '../../../src/core/codes.js';

const {
  CATS, CAT_LABEL, MOODS, moodOfVerdict, CUE_CODES, CUE, ASK_CODES, ASK_LABEL, END_REASONS, END_WORD,
  MOTIF_CODES, FLAW_CODES, MOTIF_TERM, TACTIC_MOTIFS, NOTABLE_MOTIFS, PATTERN_CODES, PATTERN_NAME, STAMP_PATTERNS,
  DANGER_CODES, HABIT_CODES, HABIT_WORD, HABIT_FIX, HABIT_OF_DANGER, STRENGTH_CODES, STRENGTH_WORD, HINT_THEMES,
  LEVEL_MIN, LEVEL_MAX, RANK_NAMES, PIECE_VALUE, CROSSED_PAWN_VALUE, PIECE_POINTS, PT_OF, TYPE_OF_PT,
  NOTATION_RE, NOTATION_SCAN_RE,
} = codes;

const PIECE_TYPES = ['king', 'advisor', 'elephant', 'horse', 'rook', 'cannon', 'pawn'];

/** Every array the module must export, with its size in the contract (section 4.1). */
const ARRAYS = {
  CATS: 6, MOODS: 10, CUE_CODES: 12, ASK_CODES: 13, END_REASONS: 7, MOTIF_CODES: 33, FLAW_CODES: 11, TACTIC_MOTIFS: 6,
  NOTABLE_MOTIFS: 13, PATTERN_CODES: 26, STAMP_PATTERNS: 24, DANGER_CODES: 10, HABIT_CODES: 6, STRENGTH_CODES: 4,
  HINT_THEMES: 11, RANK_NAMES: 9,
};

/** Every table the module must export. */
const TABLES = ['CAT_LABEL', 'CUE', 'ASK_LABEL', 'END_WORD', 'MOTIF_TERM', 'PATTERN_NAME', 'HABIT_WORD', 'HABIT_FIX', 'HABIT_OF_DANGER',
  'STRENGTH_WORD', 'PIECE_VALUE', 'PIECE_POINTS', 'PT_OF', 'TYPE_OF_PT'];

const sorted = list => [...list].sort();

/** The table has exactly the keys of the array, and every value is a non-empty string. */
function assertLabels(name, table, keys) {
  assert.ok(Object.isFrozen(table), `${name} is frozen`);
  assert.deepEqual(sorted(Object.keys(table)), sorted(keys), `${name} has exactly the keys of its array`);
  for (const key of keys) {
    assert.equal(typeof table[key], 'string', `${name}.${key} is a string`);
    assert.ok(table[key].trim().length > 0, `${name}.${key} is not empty`);
  }
}

test('every array is frozen and has unique members', () => {
  const exported = Object.keys(codes).filter(name => Array.isArray(codes[name]));
  assert.deepEqual(sorted(exported), sorted(Object.keys(ARRAYS)), 'the exported arrays are the ones of section 4.1');

  for (const name of exported) {
    const list = codes[name];
    assert.ok(Object.isFrozen(list), `${name} is frozen`);
    assert.equal(new Set(list).size, list.length, `${name} has unique members`);
    assert.equal(list.length, ARRAYS[name], `${name} has ${ARRAYS[name]} members`);
    for (const member of list) {
      assert.equal(typeof member, 'string', `${name} holds strings`);
      assert.ok(member.length > 0, `${name} holds no empty string`);
    }
    assert.throws(() => { list.push('x'); }, TypeError, `${name} cannot grow`);
  }

  // Sub-vocabularies stay inside their parent vocabulary.
  assert.deepEqual(CATS, ['brilliant', 'best', 'good', 'ok', 'mistake', 'blunder'], 'CATS is ordered best first');
  assert.deepEqual(FLAW_CODES, MOTIF_CODES.slice(MOTIF_CODES.indexOf('hang')), 'FLAW_CODES is the flaw tail of MOTIF_CODES');
  assert.equal(MOTIF_CODES[MOTIF_CODES.indexOf('hang') - 1], 'quiet', 'the effects end with quiet');
  for (const code of TACTIC_MOTIFS) assert.ok(MOTIF_CODES.includes(code), `TACTIC_MOTIFS: ${code} is a motif`);
  for (const code of NOTABLE_MOTIFS) assert.ok(MOTIF_CODES.includes(code), `NOTABLE_MOTIFS: ${code} is a motif`);
  for (const code of [...TACTIC_MOTIFS, ...NOTABLE_MOTIFS]) assert.ok(!FLAW_CODES.includes(code), `${code} is not a flaw`);
  assert.deepEqual(STAMP_PATTERNS, PATTERN_CODES.filter(code => code !== 'heart_horse' && code !== 'sacrifice_play'),
    'STAMP_PATTERNS is PATTERN_CODES without heart_horse and sacrifice_play');

  // Scalars of the same section.
  assert.equal(LEVEL_MIN, 1);
  assert.equal(LEVEL_MAX, 9);
  assert.equal(CROSSED_PAWN_VALUE, 200);
});

test('every code has its label: CAT_LABEL, CUE, ASK_LABEL, END_WORD, MOTIF_TERM, PATTERN_NAME, HABIT_WORD, HABIT_FIX, STRENGTH_WORD, RANK_NAMES', () => {
  assertLabels('CAT_LABEL', CAT_LABEL, CATS);
  assertLabels('CUE', CUE, CUE_CODES);
  assertLabels('ASK_LABEL', ASK_LABEL, ASK_CODES.filter(code => code !== 'free'));   // 'free' has no label
  assert.ok(ASK_CODES.includes('free'));
  assert.equal(ASK_LABEL.free, undefined);
  assertLabels('END_WORD', END_WORD, END_REASONS);
  assertLabels('MOTIF_TERM', MOTIF_TERM, MOTIF_CODES);
  assertLabels('PATTERN_NAME', PATTERN_NAME, PATTERN_CODES);
  assertLabels('HABIT_WORD', HABIT_WORD, HABIT_CODES);
  assertLabels('HABIT_FIX', HABIT_FIX, HABIT_CODES);
  assertLabels('STRENGTH_WORD', STRENGTH_WORD, STRENGTH_CODES);

  // RANK_NAMES: one name per level, index = rank - 1.
  assert.equal(RANK_NAMES.length, LEVEL_MAX - LEVEL_MIN + 1);
  for (const name of RANK_NAMES) assert.equal([...name].length, 4, `rank name ${name} has four characters`);
  assert.equal(RANK_NAMES[LEVEL_MIN - 1], '初出茅庐');
  assert.equal(RANK_NAMES[LEVEL_MAX - 1], '天下无双');

  // Every table of the module is one of the known ones, and frozen.
  const exported = Object.keys(codes).filter(name => {
    const value = codes[name];
    return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp);
  });
  assert.deepEqual(sorted(exported), sorted(TABLES), 'the exported tables are the ones of section 4.1');
  for (const name of exported) assert.ok(Object.isFrozen(codes[name]), `${name} is frozen`);

  // Labels the contract pins by name elsewhere (D-41: the worst verdict reads 漏着; the cues of section 8.7).
  assert.equal(CAT_LABEL.blunder, '漏着');
  assert.equal(CAT_LABEL.brilliant, '妙手');
  assert.equal(CUE.lord, '主公英明！');
  assert.equal(CUE.go, '出师！');
  assert.equal(END_WORD.no_capture, '六十回合没有吃子');

  // Material and piece letters cover exactly the seven piece types.
  assert.deepEqual(sorted(Object.keys(PIECE_VALUE)), sorted(PIECE_TYPES));
  assert.deepEqual({ ...PIECE_VALUE }, { king: 10000, rook: 900, cannon: 450, horse: 400, advisor: 200, elephant: 200, pawn: 100 });
  assert.deepEqual(sorted(Object.keys(PIECE_POINTS)), sorted(PIECE_TYPES));
  for (const type of PIECE_TYPES) assert.equal(PIECE_POINTS[type], PIECE_VALUE[type] / 100, `PIECE_POINTS.${type} = value / 100`);
  assert.deepEqual(sorted(Object.keys(PT_OF)), sorted(PIECE_TYPES));
  assert.deepEqual(sorted(Object.values(PT_OF)), sorted(['K', 'A', 'E', 'H', 'R', 'C', 'P']));
  for (const type of PIECE_TYPES) assert.equal(TYPE_OF_PT[PT_OF[type]], type, `TYPE_OF_PT inverts PT_OF for ${type}`);
  assert.equal(Object.keys(TYPE_OF_PT).length, PIECE_TYPES.length);
});

test('moodOfVerdict covers every UiVerdict and returns a member of MOODS', () => {
  const verdicts = [...CATS, 'pending'];
  const flagSets = [
    { held: false, earned: false }, { held: true, earned: false }, { held: false, earned: true }, { held: true, earned: true },
  ];
  for (const cat of verdicts) {
    for (const flags of flagSets) {
      const mood = moodOfVerdict(cat, flags);
      assert.ok(MOODS.includes(mood), `${cat} ${JSON.stringify(flags)} -> ${mood} is a member of MOODS`);
      assert.equal(moodOfVerdict(cat, { ...flags }), mood, `${cat} has exactly one mood for the same flags`);
    }
  }

  // The rule of section 4.1, row by row.
  const plain = { held: false, earned: false };
  assert.equal(moodOfVerdict('pending', plain), 'thinking');
  assert.equal(moodOfVerdict('pending', { held: true, earned: true }), 'thinking');   // nothing known: never praise, never alarm
  assert.equal(moodOfVerdict('brilliant', plain), 'impressed');
  assert.equal(moodOfVerdict('best', plain), 'pleased');
  assert.equal(moodOfVerdict('best', { held: false, earned: true }), 'impressed');
  assert.equal(moodOfVerdict('good', plain), 'pleased');
  assert.equal(moodOfVerdict('good', { held: false, earned: true }), 'pleased');
  assert.equal(moodOfVerdict('ok', plain), 'idle');
  assert.equal(moodOfVerdict('mistake', plain), 'curious');
  assert.equal(moodOfVerdict('mistake', { held: true, earned: false }), 'worried');
  assert.equal(moodOfVerdict('blunder', plain), 'worried');
  assert.equal(moodOfVerdict('blunder', { held: true, earned: false }), 'alarmed');
});

test('HABIT_OF_DANGER maps every danger to a habit code or null', () => {
  assert.ok(Object.isFrozen(HABIT_OF_DANGER));
  assert.deepEqual(sorted(Object.keys(HABIT_OF_DANGER)), sorted(DANGER_CODES), 'HABIT_OF_DANGER has exactly the keys of DANGER_CODES');
  for (const danger of DANGER_CODES) {
    const habit = HABIT_OF_DANGER[danger];
    assert.ok(habit === null || HABIT_CODES.includes(habit), `${danger} -> ${habit} is a habit code or null`);
  }
  assert.equal(HABIT_OF_DANGER.slow, null, 'a slow move is not a habit');
  assert.equal(HABIT_OF_DANGER.hangs_moved_piece, 'hang_piece');

  // Every habit but 'greedy' is reachable through the table; 'greedy' is the capture case of hangs_moved_piece.
  const reached = new Set(Object.values(HABIT_OF_DANGER).filter(habit => habit !== null));
  assert.deepEqual(sorted([...reached, 'greedy']), sorted(HABIT_CODES));
});

test('NOTATION_RE accepts the 14 valid samples and rejects the 6 invalid ones', () => {
  const valid = '炮二平五 马8进7 前车进一 后炮平4 中兵平四 二兵平五 前兵七进一 前卒3进1 后卒3平4 仕四进五 象7进5 帅五平四 前马退二 四兵进一'.split(' ');
  const invalid = '炮二平 炮十平五 前仕进五 马8进0 五兵进一 車二平五'.split(' ');
  assert.equal(valid.length, 14);
  assert.equal(invalid.length, 6);
  for (const text of valid) assert.ok(NOTATION_RE.test(text), `accepts ${text}`);
  for (const text of invalid) assert.ok(!NOTATION_RE.test(text), `rejects ${text}`);

  // Anchored: a notation inside other text is not a notation.
  assert.ok(!NOTATION_RE.test('走炮二平五'));
  assert.ok(!NOTATION_RE.test('炮二平五！'));
  assert.ok(!NOTATION_RE.global, 'NOTATION_RE is stateless');

  // NOTATION_SCAN_RE is the same grammar, unanchored and global.
  assert.ok(NOTATION_SCAN_RE.global);
  assert.equal(`^${NOTATION_SCAN_RE.source}$`, NOTATION_RE.source);
  for (const text of valid) assert.deepEqual(text.match(NOTATION_SCAN_RE), [text], `scans ${text}`);
  assert.deepEqual('先走炮二平五，等对方马8进7，再前兵七进一。'.match(NOTATION_SCAN_RE), ['炮二平五', '马8进7', '前兵七进一']);
  assert.equal('军师，这步棋好不好？'.match(NOTATION_SCAN_RE), null);
});
