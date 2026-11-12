// PF: tests of items 1, 2, 3 and 12 in tests/unit/game/director.test.js (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/game/director.test.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 70)); s = s.replace(a, b); };

// ---- item 2 (calm on his game-ending move) and item 3 (the round of the last move) in the existing test
rep(`  const calls = rig.calls('stage.rival').map((entry) => entry.args[0]);
  assert.deepEqual(Object.keys(calls.at(-2)), ['mood'], 'the mating move: his mood only, no line');`,
`  const calls = rig.calls('stage.rival').map((entry) => entry.args[0]);
  assert.deepEqual(Object.keys(calls.at(-2)), ['mood'], 'the mating move: his mood only, no line');
  // ... and that mood is calm, although a tactic of his landed with it and the child's move before was no slip (\`smug\` by 4.22)
  assert.equal(calls.at(-2).mood, 'calm', 'he does not smirk at his own win');
  // the top bar: eight plies were played, the last of them in round 4; round 5 will never be played
  assert.equal(rig.last('stage.rivalMoved').args[0].view.round, 4);
  assert.equal(rig.stage.model.over.stats.rounds, 4);`);
rep(`  const committed = win.last('stage.committed').args[0];
  assert.equal(committed.flags.mate, true);`,
`  const committed = win.last('stage.committed').args[0];
  assert.equal(committed.flags.mate, true);
  assert.equal(committed.view.round, 4, 'seven plies: the child mated in round 4');
  assert.equal(win.stage.model.over.stats.rounds, 4);`);
rep(`  assert.deepEqual([again.stage.model.over.quiet, again.stage.model.over.result, again.stage.model.over.byChildMate], [true, 'win', true]);`,
`  assert.deepEqual([again.stage.model.over.quiet, again.stage.model.over.result, again.stage.model.over.byChildMate], [true, 'win', true]);
  assert.equal(again.last('stage.reset').args[0].round, 4, 'a finished game that is restored shows its last round too');`);

// ---- item 12 in the existing engine-dead test
rep(`  assert.equal(verdicts(rig).at(-1).final, false, 'the provisional face stays; nothing is said');
  assert.equal(rig.calls('thread.tryMove').length, 0);`,
`  assert.equal(verdicts(rig).at(-1).final, false, 'the provisional face stays; nothing is said');
  assert.equal(rig.calls('thread.tryMove').length, 0);
  assert.deepEqual(chipIds(rig), [], 'the chips of a trial that could not be assessed are withdrawn');
  assert.equal(localTexts(rig).length, 0, 'and nothing is said about it');`);
rep(`  const job = rig.job('assess');
  assert.ok(job, 'the trial is assessed after all');`,
`  assert.deepEqual(chipIds(rig), ['good', 'reply', 'better'], 'the chips are back with the second attempt');
  const job = rig.job('assess');
  assert.ok(job, 'the trial is assessed after all');`);

// ---- new tests at the end of the file
s += `
// =====================================================================================================================
// What real play showed (CONTRACT-NOTES 138)
// =====================================================================================================================

// After these six moves red is in check from the cannon on b1 and has two legal moves: 车九平八 (takes it) and 相七退九.
const TWO_LEGAL = ['9584', '2797', '9897', '0728', '9270', '2191'];

test('a forced move: the memory is told so, and of no other move', T, async () => {
  const rig = createDirectorRig();
  const saved = savedGame(TWO_LEGAL);
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(getLegalMoves(rig.state.board, 'red').length, 2);
  rig.script.assess = () => ({ cat: 'best', flags: { onlyMove: true } });
  await tryMove(rig, ref(9, 0, 9, 1));
  assert.equal(verdicts(rig).at(-1).final, true);
  await confirm(rig);
  const forcedNote = rig.calls('memory.noteMine').at(-1).args;
  assert.deepEqual([forcedNote[0], forcedNote[1].move, forcedNote[1].cat, forcedNote[1].forced], [6, '车九平八', 'best', true]);
  assert.ok(forcedNote[1].packet, 'its packet is remembered as always');
  // the next move of the child has a choice again: no flag at all
  assert.ok(getLegalMoves(rig.state.board, 'red').length > 2);
  const next = getLegalMoves(rig.state.board, 'red')[0];
  await tryMove(rig, next);
  await confirm(rig);
  const freeNote = rig.calls('memory.noteMine').at(-1).args;
  assert.equal(freeNote[0], 8);
  assert.ok(!('forced' in freeNote[1]));
  stop(rig);

  // a forced move that was confirmed before its comment: the count comes from the brief all the same
  const quick = createDirectorRig({ brain: 'manual' });
  quick.director.loadExtras(saved);
  quick.session.restore(saved);
  await quick.settle();
  answerSurvey(quick, {});
  await quick.settle();
  quick.actions.tap(9, 0, 'tap');
  quick.actions.tap(9, 1, 'tap');
  quick.actions.confirm();
  await quick.settle();
  const quickNote = quick.calls('memory.noteMine').at(-1).args;
  assert.deepEqual([quickNote[0], quickNote[1].forced, quickNote[1].packet], [6, true, null]);
  stop(quick);
});

test('the round of the top bar: the next round while the game runs, the last round played once it is over', T, async () => {
  const rig = await start();
  assert.equal(rig.last('stage.reset').args[0].round, 1);
  await play(rig, ROOK);                                                 // two plies: round 1 is complete
  assert.equal(rig.state.history.length, 2);
  assert.equal(rig.last('stage.rivalMoved').args[0].view.round, 2, 'the child is to move in round 2');
  await resign(rig);                                                     // no move ends this game
  assert.equal(rig.state.phase, 'over');
  const over = rig.stage.model.over;
  assert.deepEqual([over.result, over.reason, over.stats.rounds], ['loss', 'resign', 1]);
  assert.deepEqual([rig.last('stage.phase').args[0].phase, rig.last('stage.phase').args[0].ply], ['over', 2], 'the stage reads the last round from the plies');
  // taking the last moves back: the game runs again and the view shows the round to be played
  rig.actions.undo();
  await rig.settle();
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.last('stage.undone').args[0].view.round, 1);
  stop(rig);

  // the reload of a resigned game shows the last round played, not the round that will never be played
  const done = await start();
  await play(done, ROOK);
  await play(done, HORSE);
  await resign(done);
  const saved = done.saved();
  stop(done);
  const again = createDirectorRig();
  again.director.loadExtras(saved);
  again.session.restore(saved);
  await again.settle();
  await again.settle();
  assert.equal(again.state.history.length, 4);
  assert.equal(again.last('stage.reset').args[0].round, 2);
  assert.equal(again.stage.model.over.stats.rounds, 2);
  stop(again);
});

test('trial chips after a failed assessment: withdrawn without a word; a trial that is assessed keeps them', T, async () => {
  const rig = await start({ brain: 'manual' });
  answerSurvey(rig, {});
  await rig.settle();
  await tryMove(rig, ROOK);
  assert.deepEqual(chipIds(rig), ['good', 'reply', 'better'], 'the trial set, while the assessment is on its way');
  const said = localTexts(rig).length;
  rig.fail('the assess job broke');
  await rig.settle();
  assert.equal(rig.state.phase, 'tentative');
  assert.deepEqual(chipIds(rig), [], 'withdrawn');
  assert.equal(localTexts(rig).length, said, 'nothing is said');
  assert.equal(rig.calls('thread.tryMove').length, 0);
  assert.equal(verdicts(rig).at(-1).final, false, 'the provisional face stays');
  // a question about that trial goes nowhere
  rig.actions.ask({ code: 'good' });
  await rig.settle();
  assert.equal(rig.calls('thread.ask').length, 0);
  // the child takes the move back: the chips of the turn are there again
  rig.actions.retract();
  await rig.settle();
  assert.ok(chipIds(rig).includes('score'));
  // another trial is assessed and keeps its chips
  await tryMove(rig, HORSE);
  answerAssess(rig, { cat: 'good' });
  await rig.settle();
  assert.deepEqual(chipIds(rig).slice(0, 3), ['good', 'reply', 'better']);
  stop(rig);
});
`;
fs.writeFileSync(p, s);
console.log('ok');
