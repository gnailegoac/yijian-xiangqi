// tests/unit/coach/memory.test.js (C2) — contract section 4.16 (and what section 4.14.1 takes from `snapshot`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createGameMemory } from '../../../src/coach/memory.js';
import { validateCoachRequest } from '../../../src/coach/protocol.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/coach/${name}`, import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** The held try of contract section 9.5 and the details that were withheld from it. */
const HELD = fixture('try-held-ask.json').events[1].try;
const MORE = fixture('try-held-ask.json').events[2].more;
const TURN = fixture('try-held-ask.json').turn;

const P = (s, t, f) => ({ s, t, f });
/** A try packet: an ordinary developing move unless patched. */
const packet = (patch = {}) => ({
  move: '马二进三', cat: 'best', loss: 0, held: false, eval: { b: 'even' },
  does: [{ k: 'develop', by: P('me', 'H', 3) }], flaws: [], cost: null, reply: null, toward: null, chance: 'none', ...patch,
});
/** What the director passes at a commit. */
const info = (move, cat, pk = null, more = null) => ({ move, cat, waited: true, self: true, packet: pk, more });
const EMPTY = { moments: [], taught: [], mine: null };

/** Eight different red moves, used as the child's moves at plies 0, 2, 4, ... */
const MOVES = ['炮二平五', '马二进三', '车一平二', '兵三进一', '马八进七', '炮八平九', '车九平八', '兵七进一'];

/** A snapshot must be usable in a brief as it is: it validates inside the turn of a fixture. */
function assertWireValid(snapshot) {
  const result = validateCoachRequest({ v: 1, turn: { ...clone(TURN), ...snapshot }, events: [{ i: 0, kind: 'opp' }] });
  assert.deepEqual(result.ok ? null : [result.path, result.why], null);
}

test('moments keep the six most recent', () => {
  const memory = createGameMemory(null);
  assert.deepEqual(memory.snapshot(), EMPTY);

  MOVES.forEach((move, k) => memory.noteMine(2 * k, info(move, 'mistake')));
  const { moments } = memory.snapshot();
  assert.equal(moments.length, 6);
  assert.deepEqual(moments.map((m) => m.move), MOVES.slice(2), 'the two oldest are gone, the order is the order of play');
  // n is the move number: floor(ply / 2) + 1
  assert.deepEqual(moments[0], { n: 3, s: 'me', move: '车一平二', tag: 'slip' });
  assert.deepEqual(moments[5], { n: 8, s: 'me', move: '兵七进一', tag: 'slip' });
  assertWireValid(memory.snapshot());

  // a snapshot is a copy
  moments[0].move = '帅五进一';
  assert.equal(memory.snapshot().moments[0].move, '车一平二');
});

test('a moment is recorded for a slip, an earned or chance-taking move, a missed chance and a punishing rival move', () => {
  const tagOf = (cat, pk) => {
    const memory = createGameMemory(null);
    memory.noteMine(6, info('马二进三', cat, pk));
    return memory.snapshot().moments[0] ?? null;
  };
  const fork = [{ k: 'fork', by: P('me', 'H', 4), on: P('opp', 'R', 3), on2: P('opp', 'C', 7) }];

  // slips: a confirmed mistake or blunder, with or without a packet (confirmed before any comment)
  assert.deepEqual(tagOf('mistake', null), { n: 4, s: 'me', move: '马二进三', tag: 'slip' });
  assert.deepEqual(tagOf('blunder', null), { n: 4, s: 'me', move: '马二进三', tag: 'slip' });
  assert.deepEqual(tagOf('mistake', clone(HELD)), { n: 4, s: 'me', move: '马二进三', tag: 'slip', k: 'greedy' }, 'k is the first flaw');

  // great: an earned best / brilliant (the only move, a trap stepped around, a tactic motif) or a taken chance
  assert.deepEqual(tagOf('best', packet({ does: fork })), { n: 4, s: 'me', move: '马二进三', tag: 'great', k: 'fork' });
  assert.equal(tagOf('brilliant', packet({ cat: 'brilliant', does: fork })).tag, 'great');
  assert.equal(tagOf('best', packet({ only: true })).tag, 'great');
  assert.equal(tagOf('best', packet({ avoided: 'greedy' })).tag, 'great');
  assert.deepEqual(tagOf('good', packet({ cat: 'good', chance: 'taken' })), { n: 4, s: 'me', move: '马二进三', tag: 'great', k: 'develop' });

  // a routine move leaves nothing behind, however good
  assert.equal(tagOf('best', packet()), null);
  assert.equal(tagOf('good', packet({ cat: 'good' })), null);
  assert.equal(tagOf('ok', packet({ cat: 'ok' })), null);
  assert.equal(tagOf('best', null), null);
  assert.equal(tagOf('good', packet({ cat: 'good', does: fork })), null, 'a tactic motif earns nothing below best');

  // a missed chance that cost nothing concrete is 'missed', also when the verdict is mistake; with a concrete loss it is a slip
  const missed = { chance: 'missed', loss: 200, toward: { area: 'left', theme: 'fork' } };
  assert.deepEqual(tagOf('ok', packet({ cat: 'ok', ...missed })), { n: 4, s: 'me', move: '马二进三', tag: 'missed', k: 'fork' });
  assert.deepEqual(tagOf('mistake', packet({ cat: 'mistake', ...missed, flaws: [{ k: 'miss_capture', on: P('opp', 'H', 3) }] })),
    { n: 4, s: 'me', move: '马二进三', tag: 'missed', k: 'miss_capture' });
  assert.equal(tagOf('mistake', { ...clone(HELD), chance: 'missed' }).tag, 'slip');

  // the rival: only a move that punishes the child's last one
  const memory = createGameMemory(null);
  memory.noteOpp(1, { move: '马8进7', check: false, quality: 'normal', does: [{ k: 'develop', by: P('opp', 'H', 7) }] });
  assert.deepEqual(memory.snapshot().moments, []);
  memory.noteOpp(3, { move: '马7进5', check: false, captured: 'C', quality: 'strong', punishes: true,
    does: [{ k: 'capture', by: P('opp', 'H', 5), on: P('me', 'C', 5) }] });
  assert.deepEqual(memory.snapshot().moments, [{ n: 2, s: 'opp', move: '马7进5', tag: 'punished', k: 'capture' }]);
  assertWireValid(memory.snapshot());
});

test('mine is the previous move of the child with nothing withheld', () => {
  const memory = createGameMemory(null);
  memory.noteMine(0, info('炮二平五', 'best', packet({ move: '炮二平五' })));
  memory.noteOpp(1, TURN.opp);
  memory.noteMine(2, { move: '炮五进四', cat: 'mistake', waited: false, self: true, packet: clone(HELD), more: clone(MORE) });

  const { mine } = memory.snapshot();
  // the packet of a move that was played: held false, the rival's reply filled in from the withheld packet (section 4.14.1)
  assert.deepEqual(mine, { move: '炮五进四', cat: 'mistake', waited: false, self: true, try: { ...clone(HELD), held: false, reply: clone(MORE.reply) } });
  // the better move stays out of the brief: `turn` names no good move for the child
  assert.equal(JSON.stringify(mine).includes('马二进三'), false);
  assertWireValid(memory.snapshot());
  // the director's objects were not changed, and later changes to them do not reach the memory
  assert.equal(HELD.held, true);
  assert.equal(HELD.reply, null);

  // a move confirmed before any assessment has no packet
  memory.noteOpp(3, { move: '马7进5', check: false, quality: 'strong', does: [] });
  memory.noteMine(4, info('马八进七', 'good'));
  assert.deepEqual(memory.snapshot().mine, { move: '马八进七', cat: 'good', waited: true, self: true });

  // a call that names no ply of the game, or carries nothing, is ignored, and nothing throws
  memory.noteMine(-1, info('马二进三', 'good'));
  memory.noteMine(8, null);
  memory.noteMine(1.5, info('马二进三', 'good'));
  memory.noteOpp(7, null);
  assert.equal(memory.snapshot().mine.move, '马八进七');
  // a packet the wire would reject is dropped; the move itself is kept
  memory.noteMine(6, info('马二进三', 'good', { ...packet(), cat: 'superb' }));
  assert.deepEqual(memory.snapshot().mine, { move: '马二进三', cat: 'good', waited: true, self: true });
});

test('a move that cannot be reported hides the move before it instead of standing in for it', () => {
  const memory = createGameMemory(null);
  memory.noteMine(0, info('炮二平五', 'best'));
  memory.noteOpp(1, TURN.opp);
  // confirmed before any verdict existed: the director has no cat yet
  memory.noteMine(2, info('马二进三', null));
  assert.equal(memory.snapshot().mine, null, 'not 炮二平五: that is no longer the previous move');
  assert.deepEqual(memory.snapshot().moments, []);
  assertWireValid(memory.snapshot());
  // the same for a move that is not a notation
  const other = createGameMemory(null);
  other.noteMine(0, info('炮二平五', 'mistake'));
  other.noteMine(2, info('not a move', 'blunder'));
  assert.equal(other.snapshot().mine, null);
  assert.deepEqual(other.snapshot().moments.map((m) => m.move), ['炮二平五'], 'and it leaves no moment');

  // the gap is part of the save, and an undo brings the older move back
  const restored = createGameMemory(clone(memory.toJSON()));
  assert.equal(restored.snapshot().mine, null);
  assert.deepEqual(restored.toJSON(), memory.toJSON());
  restored.rewind(2);
  assert.equal(restored.snapshot().mine.move, '炮二平五');

  // noted again once the verdict is known (the same ply), the move takes its place and leaves its moment
  memory.noteMine(2, info('马二进三', 'mistake'));
  assert.deepEqual(memory.snapshot().mine, { move: '马二进三', cat: 'mistake', waited: true, self: true });
  assert.deepEqual(memory.snapshot().moments, [{ n: 2, s: 'me', move: '马二进三', tag: 'slip' }]);
  // a late completion does not move the position back: what is explained now belongs to the turn the game stands at
  memory.noteOpp(3, { move: '车9平8', check: false, quality: 'normal', does: [] });
  memory.noteMine(2, info('马二进三', 'blunder'));
  memory.noteTaught(['fork']);
  memory.rewind(4);
  assert.deepEqual(memory.snapshot().taught, [], 'fork was explained at ply 4');
});

test('a memory loaded at a ply stamps what is explained next with that ply', () => {
  // The save written after the rival's move still stands one ply behind (the rival's move is noted only when the child's
  // turn starts). The director truncates a loaded memory at the number of moves played (contract section 13.4): after
  // that the memory stands at that ply, so an undo back to this turn drops what was explained in it.
  const memory = createGameMemory(null);
  memory.noteMine(0, info('炮二平五', 'best'));
  const saved = clone(memory.toJSON());                                        // the rival's move at ply 1 is not noted yet
  const loaded = createGameMemory(saved);
  loaded.rewind(2);                                                            // two moves were played
  assert.equal(loaded.snapshot().mine.move, '炮二平五', 'nothing is dropped');
  loaded.noteTaught(['develop']);                                              // explained while the child faces ply 2
  loaded.noteMine(2, info('马二进三', 'good'));
  loaded.noteOpp(3, { move: '车9平8', check: false, quality: 'normal', does: [] });
  loaded.noteTaught(['attack']);
  loaded.rewind(4);
  assert.deepEqual(loaded.snapshot().taught, ['develop']);
  loaded.rewind(2);
  assert.deepEqual(loaded.snapshot().taught, [], 'the turn at ply 2 is replayed: its explanations are gone');
});

test('taught keeps the eight most recently explained codes', () => {
  const memory = createGameMemory(null);
  const codes = ['develop', 'capture', 'fork', 'pin', 'check', 'greedy', 'hang', 'attack', 'defend', 'trade'];
  memory.noteTaught(codes.slice(0, 2));
  for (const code of codes.slice(2)) memory.noteTaught([code]);
  assert.deepEqual(memory.snapshot().taught, codes.slice(2));

  // explained again: once in the list, at its newest place; pattern codes count, anything else does not
  memory.noteTaught(['fork', undefined, 'not_a_code', 'same_cannons', 7]);
  assert.deepEqual(memory.snapshot().taught, ['check', 'greedy', 'hang', 'attack', 'defend', 'trade', 'fork', 'same_cannons']);
  memory.noteTaught('fork');
  memory.noteTaught([]);
  assert.equal(memory.snapshot().taught.length, 8);
  assertWireValid(memory.snapshot());
});

test('rewind drops everything at or after the ply', () => {
  const memory = createGameMemory(null);
  memory.noteTaught(['develop']);                                              // explained while the child faced ply 0
  memory.noteMine(0, info('炮二平五', 'mistake'));                              // ply 0
  memory.noteOpp(1, { move: '马8进7', check: false, quality: 'strong', punishes: true, does: [{ k: 'attack', by: P('opp', 'H', 7), on: P('me', 'P', 5) }] });
  memory.noteTaught(['attack']);                                               // at ply 2
  memory.noteMine(2, info('马二进三', 'best', packet({ only: true })));          // ply 2
  memory.noteOpp(3, { move: '车9平8', check: false, quality: 'normal', does: [] });
  memory.noteTaught(['fork', 'pin']);                                          // at ply 4
  memory.noteMine(4, info('车一平二', 'blunder'));                              // ply 4
  assert.deepEqual(memory.snapshot().moments.map((m) => m.tag), ['slip', 'punished', 'great', 'slip']);
  assert.deepEqual(memory.snapshot().taught, ['develop', 'attack', 'fork', 'pin']);
  assert.equal(memory.snapshot().mine.move, '车一平二');

  // undo back to ply 4: the child's move at ply 4 and what was explained while it was thought about are gone
  memory.rewind(4);
  assert.deepEqual(memory.snapshot().moments.map((m) => m.tag), ['slip', 'punished', 'great']);
  assert.deepEqual(memory.snapshot().taught, ['develop', 'attack']);
  assert.equal(memory.snapshot().mine.move, '马二进三', 'the previous move is now the one before');
  assert.equal(memory.snapshot().mine.try.only, true, 'with its packet');

  // back to ply 2
  memory.rewind(2);
  assert.deepEqual(memory.snapshot().moments, [
    { n: 1, s: 'me', move: '炮二平五', tag: 'slip' },
    { n: 1, s: 'opp', move: '马8进7', tag: 'punished', k: 'attack' },
  ]);
  assert.deepEqual(memory.snapshot().taught, ['develop']);
  assert.deepEqual(memory.snapshot().mine, { move: '炮二平五', cat: 'mistake', waited: true, self: true });

  // what is noted after an undo is stamped with the ply the game stands at again
  memory.noteTaught(['check']);                                                // at ply 2
  memory.rewind(3);
  assert.deepEqual(memory.snapshot().taught, ['develop', 'check']);
  memory.rewind(2);
  assert.deepEqual(memory.snapshot().taught, ['develop']);

  // rewinding to a ply that was never reached changes nothing; rewinding to the start empties the memory
  memory.rewind(40);
  assert.equal(memory.snapshot().moments.length, 2);
  memory.rewind(0);
  assert.deepEqual(memory.snapshot(), EMPTY);
  memory.rewind(Number.NaN);
  assert.deepEqual(memory.snapshot(), EMPTY);
});

test('rewind is exact: older moments come back when newer ones are dropped', () => {
  const memory = createGameMemory(null);
  MOVES.forEach((move, k) => memory.noteMine(2 * k, info(move, 'mistake')));
  assert.deepEqual(memory.snapshot().moments.map((m) => m.move), MOVES.slice(2));
  memory.rewind(12);                                                           // the moves at plies 12 and 14 are taken back
  assert.deepEqual(memory.snapshot().moments.map((m) => m.move), MOVES.slice(0, 6));
  assert.equal(memory.snapshot().mine.move, MOVES[5]);
  // and a save made now restores to the same state
  assert.deepEqual(createGameMemory(clone(memory.toJSON())).snapshot(), memory.snapshot());
});

test('what is kept behind the snapshot is bounded', () => {
  const memory = createGameMemory(null);
  // a game of 300 moves in which every move of the child is a slip with a packet and something is explained every turn
  const codes = ['develop', 'capture', 'fork', 'pin', 'check', 'greedy', 'hang', 'attack', 'defend', 'trade'];
  for (let k = 0; k < 300; k++) {
    memory.noteMine(2 * k, info(MOVES[k % MOVES.length], 'mistake', packet({ move: MOVES[k % MOVES.length], cat: 'mistake' })));
    memory.noteOpp(2 * k + 1, { move: '马8进7', check: false, quality: 'strong', punishes: true, does: [] });
    memory.noteTaught([codes[k % codes.length], codes[(k + 3) % codes.length]]);
  }
  const saved = memory.toJSON();
  assert.ok(JSON.stringify(saved).length < 20000, `the save stays small: ${JSON.stringify(saved).length}`);
  assert.ok(saved.moments.length <= 64 && saved.taught.length <= 64 && saved.mine.length <= 64);
  assert.equal(memory.snapshot().moments.length, 6);
  assert.equal(memory.snapshot().taught.length, 8);
  assert.deepEqual(memory.snapshot().moments.at(-1), { n: 300, s: 'opp', move: '马8进7', tag: 'punished' });

  // only the most recent moves keep their packet: after a few undos the previous move is still known, its packet no longer
  assert.ok(memory.snapshot().mine.try);
  memory.rewind(596);                                                           // two moves of the child taken back
  assert.equal(memory.snapshot().mine.move, MOVES[297 % MOVES.length]);
  assert.ok(memory.snapshot().mine.try, 'the move before still has its packet');
  memory.rewind(580);
  assert.deepEqual(memory.snapshot().mine, { move: MOVES[289 % MOVES.length], cat: 'mistake', waited: true, self: true });
  assert.equal(memory.snapshot().moments.length, 6);
});

test('toJSON / createGameMemory round trip; garbage gives an empty memory', () => {
  const memory = createGameMemory(null);
  memory.noteMine(0, info('炮二平五', 'best', packet({ move: '炮二平五', only: true })));
  memory.noteOpp(1, { move: '马8进7', check: false, quality: 'strong', punishes: true, does: [{ k: 'develop', by: P('opp', 'H', 7) }] });
  memory.noteTaught(['develop', 'greedy']);
  memory.noteMine(2, { move: '炮五进四', cat: 'mistake', waited: false, self: true, packet: clone(HELD), more: clone(MORE) });
  memory.noteHabit('greedy');

  const saved = memory.toJSON();
  assert.deepEqual(clone(saved), saved, 'toJSON is plain JSON');
  assert.equal(JSON.stringify(saved).includes('马二进三'), false, 'no better move is stored');
  const restored = createGameMemory(clone(saved));
  assert.deepEqual(restored.snapshot(), memory.snapshot());
  assert.deepEqual(restored.toJSON(), saved);
  assert.equal(restored.habitMentioned('greedy'), true);
  assert.equal(restored.snapshot().moments.length, 3);
  assert.deepEqual(restored.snapshot().taught, ['develop', 'greedy']);
  assert.equal(restored.snapshot().mine.try.reply.moves[0], '马7进5');
  assertWireValid(restored.snapshot());

  // the two go on identically: plies are part of the save
  for (const m of [memory, restored]) {
    m.noteTaught(['fork']);
    m.rewind(2);
  }
  assert.deepEqual(restored.snapshot(), memory.snapshot());
  assert.deepEqual(restored.toJSON(), memory.toJSON());
  assert.deepEqual(memory.snapshot().taught, [], 'everything explained from ply 2 on is dropped');
  assert.equal(memory.snapshot().mine.move, '炮二平五');

  // the save is a copy: changing it does not change the memory
  const copy = memory.toJSON();
  copy.moments.length = 0;
  copy.mine[0].mine.move = '帅五进一';
  assert.equal(memory.snapshot().moments.length, 2);
  assert.equal(memory.snapshot().mine.move, '炮二平五');

  // garbage of every kind gives an empty memory, and none of it throws
  const garbage = [null, undefined, 0, 42, 'memory', true, [], [saved], {}, { ...clone(saved), v: 2 },
    { v: 1, moments: 'no', taught: { a: 1 }, mine: 7, habits: 'greedy', at: 'x' },
    { v: 1, moments: [null, 5, { ply: 0 }, { ply: -1, moment: { n: 1, s: 'me', move: '炮二平五', tag: 'slip' } }, { ply: 0, moment: { n: 1, s: 'me', move: '炮二平', tag: 'slip' } },
      { ply: 0, moment: { n: 1, s: 'me', move: '炮二平五', tag: 'bogus' } }, { ply: 0, moment: { n: 0, s: 'me', move: '炮二平五', tag: 'slip' } },
      { ply: 0, moment: { n: 1, s: 'me', move: '炮二平五', tag: 'slip', note: '小明' } }],
      taught: [{ ply: 0, code: 'nonsense' }, { ply: 0 }, { ply: 1.5, code: 'fork' }, 'fork'],
      mine: [{ ply: 0, mine: { move: '炮二平五' } }, { ply: 0, mine: { move: '炮二平五', cat: 'great', waited: true, self: true } }, { ply: 700, mine: { move: '炮二平五', cat: 'best', waited: true, self: true } }],
      habits: ['always_late', 3, null], at: -4 }];
  for (const junk of garbage) {
    const empty = createGameMemory(junk);
    assert.deepEqual(empty.snapshot(), EMPTY, JSON.stringify(junk)?.slice(0, 60));
    assert.equal(empty.habitMentioned('greedy'), false);
    assert.deepEqual(empty.toJSON(), createGameMemory(null).toJSON());
  }

  // a save that is partly damaged keeps what is sound
  const partial = createGameMemory({
    v: 1, at: 5,
    moments: [{ ply: 2, moment: { n: 2, s: 'me', move: '炮五进四', tag: 'slip', k: 'greedy' } }, { ply: 0, moment: { n: 1, s: 'me', move: '走得好', tag: 'great' } }],
    taught: [{ ply: 2, code: 'greedy' }, { ply: 2, code: 'chat: 你好' }],
    mine: [{ ply: 2, mine: { move: '炮五进四', cat: 'mistake', waited: false, self: true, try: { move: '炮五进四', said: '小明说……' } } }],
    habits: ['greedy', 'greedy', 'nope'],
  });
  assert.deepEqual(partial.snapshot(), {
    moments: [{ n: 2, s: 'me', move: '炮五进四', tag: 'slip', k: 'greedy' }],
    taught: ['greedy'],
    mine: { move: '炮五进四', cat: 'mistake', waited: false, self: true },
  });
  assert.equal(partial.habitMentioned('greedy'), true);
  assert.deepEqual(partial.toJSON().habits, ['greedy']);
  assert.equal(JSON.stringify(partial.toJSON()).includes('小明'), false, 'no free text survives a load');
});

test('a habit is reported as mentioned only once', () => {
  const memory = createGameMemory(null);
  assert.equal(memory.habitMentioned('greedy'), false);
  memory.noteHabit('greedy');
  assert.equal(memory.habitMentioned('greedy'), true);
  assert.equal(memory.habitMentioned('miss_threat'), false, 'another habit is still unmentioned');

  // noting it again changes nothing
  memory.noteHabit('greedy');
  assert.deepEqual(memory.toJSON().habits, ['greedy']);
  // what is not a habit code is ignored
  memory.noteHabit('fork');
  memory.noteHabit(undefined);
  assert.equal(memory.habitMentioned('fork'), false);
  assert.deepEqual(memory.toJSON().habits, ['greedy']);

  // a mention is about what the child heard in this game: an undo does not take it back (D-41: at most once per game) ...
  memory.noteMine(0, info('炮二平五', 'best'));
  memory.noteHabit('miss_threat');
  memory.rewind(0);
  assert.equal(memory.habitMentioned('greedy'), true);
  assert.equal(memory.habitMentioned('miss_threat'), true);
  // ... and it is saved with the game; a new game starts with none
  assert.equal(createGameMemory(clone(memory.toJSON())).habitMentioned('greedy'), true);
  assert.equal(createGameMemory(null).habitMentioned('greedy'), false);
});
