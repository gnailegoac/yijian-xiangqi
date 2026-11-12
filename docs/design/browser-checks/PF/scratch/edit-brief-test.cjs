// Adds the PF tests of item 1 to tests/unit/coach/brief.test.js (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/coach/brief.test.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };

rep(`  const good = clone(only);
  good.assessment.cat = 'good';
  assert.equal(isEarned(good, { found: true, avoided: null }), false);
});
`,
`  const good = clone(only);
  good.assessment.cat = 'good';
  assert.equal(isEarned(good, { found: true, avoided: null }), false);
});

test('isEarned: a forced move earns no praise, whatever the search found in it (CONTRACT-NOTES 138)', () => {
  // Red is in check on the e-file and both flights of the king are covered: the horse steps in on e3 or on e2 (two legal
  // moves). With an advisor on f1 that can step in too, there are three.
  const two = survey('3k5/9/5r3/3r5/9/4r4/9/2N6/9/4K4 w', 40, 3);
  const three = survey('3k5/9/5r3/3r5/9/4r4/9/2N6/9/4KA3 w', 40, 3);
  assert.deepEqual([two.table.lines.length, three.table.lines.length], [2, 3]);
  const every = { found: true, avoided: 'greedy' };
  for (const [sv, forced] of [[two, true], [three, false]]) {
    const best = assess(sv, sv.table.lines[0].move);
    // every clause of the rule at once: a found test, the only move, a deep reveal, an avoided trap
    const lifted = clone(best);
    lifted.assessment.cat = 'best';
    lifted.assessment.flags.onlyMove = true;
    lifted.assessment.revealBest = 4;
    assert.equal(isEarned(lifted, every), !forced, forced ? 'two legal moves' : 'three legal moves');
    lifted.assessment.cat = 'brilliant';                               // facts.js never says so of a forced move; the rule holds anyway
    assert.equal(isEarned(lifted, every), !forced);
  }
  // one legal move
  const one = survey('3k5/9/5r3/3r5/9/4r4/9/9/9/4KA3 w', 40, 3);
  assert.equal(one.table.lines.length, 1);
  const sole = clone(assess(one, one.table.lines[0].move));
  sole.assessment.cat = 'best';
  assert.equal(isEarned(sole, every), false);
});
`);

rep(`// ---------------------------------------------------------------------------------------------------------------------
// oppCaption, buildRecap
// ---------------------------------------------------------------------------------------------------------------------
`,
`test('buildOverPacket: the proud move was judged good or better and was not forced; a game without one has none (CONTRACT-NOTES 138)', () => {
  const sv = worked.sv;
  const bestMove = worked.fine.assessment.move;                       // 马二进三
  const kingStep = describeMove(fenToBoard('3k5/9/9/9/9/9/9/9/4r4/3K5 w').board, mv('9383'));
  const other = describeMove(START, mv('7774'));                      // 炮二平五
  const best = { move: bestMove, loss: 0, cat: 'best' };
  const forcedBest = { move: kingStep, loss: 0, cat: 'best' };
  const proudOf = (samples, takeaways) => {
    const out = buildOverPacket(overInput(samples, takeaways, { result: 'loss', reason: 'checkmate' }), bookOf(sv));
    if (out.packet.proud) assertValid(worked.turn, [{ i: 0, kind: 'over', over: out.packet }], 'over');
    return out.packet.proud ? [out.packet.proud.move, out.packet.proud.n, out.proudPly] : [null, null, out.proudPly];
  };
  const highlight = (ply, move, more = {}) => [{ kind: 'highlight', ply, move, self: true, ...more }];

  // the case of the lost game: the brain's highlight is the king's forced step out of check, one move before the mate
  const lost = [sample(0), sample(2), sample(26, { first: forcedBest, final: forcedBest, legalCount: 1 })];
  assert.deepEqual(proudOf(lost, highlight(26, kingStep)), [null, null, null], 'only steady moves besides: no proud move');
  // ... and with two legal moves (in check, the horse given away): the same
  assert.deepEqual(proudOf(lost.map((x) => (x.ply === 26 ? { ...x, legalCount: 2 } : x)), highlight(26, kingStep)), [null, null, null]);
  // three legal moves are a choice: the highlight stands
  assert.deepEqual(proudOf(lost.map((x) => (x.ply === 26 ? { ...x, legalCount: 3 } : x)), highlight(26, kingStep)), [kingStep.notation, 14, 26]);
  // a count of 0 means "not known" (confirmed before any table): not taken for forced
  assert.deepEqual(proudOf(lost.map((x) => (x.ply === 26 ? { ...x, legalCount: 0 } : x)), highlight(26, kingStep)), [kingStep.notation, 14, 26]);

  // the same rule then picks among the moves that may be proud: a 好棋 the child found, the latest of those confirmed at once
  const withBest = [sample(0, { first: best, final: best }), sample(2, { first: { ...best, move: other }, final: { ...best, move: other }, tries: 2 }),
    sample(26, { first: forcedBest, final: forcedBest, legalCount: 2 })];
  assert.deepEqual(proudOf(withBest, highlight(26, kingStep)), ['马二进三', 1, 0]);
  // a found test comes before a 好棋, a 妙手 before a 好棋; moves the child found before moves found with a pouch
  const found = sample(4, { first: best, final: best, test: { tier: 1, kind: 'win', found: true } });
  assert.deepEqual(proudOf([...withBest, found], highlight(26, kingStep)), ['马二进三', 3, 4]);
  const brilliant = sample(6, { first: { ...best, cat: 'brilliant', move: other }, final: { ...best, cat: 'brilliant', move: other }, self: false });
  assert.deepEqual(proudOf([...withBest, brilliant], highlight(26, kingStep)), ['马二进三', 1, 0], 'self first');
  assert.deepEqual(proudOf([sample(0, { self: false }), brilliant, lost[2]], highlight(26, kingStep)), ['炮二平五', 4, 6], 'then all');
  // a forced move with a found test (the tactical test of a position in check) is not proud either
  const forcedFind = sample(26, { first: forcedBest, final: forcedBest, legalCount: 2, test: { tier: 2, kind: 'save', found: true } });
  assert.deepEqual(proudOf([sample(0), forcedFind], highlight(26, kingStep)), [null, null, null]);

  // judged good or better: a highlight chosen for the pattern it played, on a move that was only 缓着, is not proud
  const slow = sample(8, { first: { ...best, cat: 'ok' }, final: { ...best, cat: 'ok' }, patterns: ['fork_two'] });
  assert.deepEqual(proudOf([sample(0), slow], highlight(8, bestMove, { pattern: 'fork_two' })), [null, null, null]);
  // ... the first sound move that played a pattern is
  const sound = sample(10, { patterns: ['central_cannon'] });
  assert.deepEqual(proudOf([sample(0), slow, sound], highlight(8, bestMove, { pattern: 'fork_two' })), [sound.final.move.notation, 6, 10]);
  // a highlight that is good and not forced is left alone, whatever else there is
  assert.deepEqual(proudOf([sample(0, { first: best, final: best }), found, brilliant], highlight(0, bestMove)), ['马二进三', 1, 0]);

  // the packet of the lost game: no proud move; the forced step still counts among the good moves
  const none = buildOverPacket(overInput(lost, highlight(26, kingStep), { result: 'loss', reason: 'checkmate' }), bookOf(sv)).packet;
  assert.equal(none.proud, null);
  assert.equal(none.stats.good, 3);
  assertValid(worked.turn, [{ i: 0, kind: 'over', over: none }], 'over without proud');
});

// ---------------------------------------------------------------------------------------------------------------------
// oppCaption, buildRecap
// ---------------------------------------------------------------------------------------------------------------------
`);
fs.writeFileSync(p, s);
console.log('ok');
