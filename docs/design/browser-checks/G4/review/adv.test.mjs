// Reviewer's adversarial tests of the director (scratch; the valuable ones move into tests/unit/game/director.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = 'file:///C:/Users/USERNAME/git/yijian-xiangqi/';
const { createDirectorRig, fakeTable, fakeSurvey, fakeAssessed, fakeOpponentTurn } = await import(ROOT + 'tests/helpers/fake-ports.js');
const { STR } = await import(ROOT + 'src/game/strings.js');
const { getLegalMoves } = await import(ROOT + 'src/core/engine.js');

const T = { timeout: 30000 };
const sq = (row, col) => ({ row, col });
const ref = (a, b, c, d) => ({ from: sq(a, b), to: sq(c, d) });
const same = (m, n) => m.from.row === n.from.row && m.from.col === n.from.col && m.to.row === n.to.row && m.to.col === n.to.col;
const CANNON = ref(7, 7, 7, 4);
const HORSE = ref(9, 7, 7, 6);
const ROOK = ref(9, 8, 8, 8);
const PAWN = ref(6, 6, 5, 6);

function assertOrder(ops, names) {
  let at = -1;
  for (const name of names) {
    const next = ops.indexOf(name, at + 1);
    assert.ok(next > at, `"${name}" does not follow position ${at}; calls there: ${ops.slice(Math.max(0, at), at + 14).join(' ')}`);
    at = next;
  }
}
async function start(options = {}, humanColor = 'red') {
  const rig = createDirectorRig(options);
  rig.session.newGame({ humanColor });
  await rig.settle();
  return rig;
}
function stop(rig) { rig.director.dispose(); rig.tasks.dispose(); }
async function tryMove(rig, move) {
  rig.actions.tap(move.from.row, move.from.col, 'tap');
  rig.actions.tap(move.to.row, move.to.col, 'tap');
  await rig.settle();
}
async function confirm(rig, ms = 1600) { rig.actions.confirm(); await rig.settle(); await rig.advance(ms); }
async function play(rig, move) { await tryMove(rig, move); await confirm(rig); }
async function resign(rig) { rig.actions.resign(); await rig.settle(); await rig.settle(); }
const localTexts = (rig) => rig.stage.model.locals.map((line) => line.text);
const verdicts = (rig) => rig.calls('stage.verdict').map((entry) => entry.args[0]);
const chipIds = (rig) => rig.stage.model.chips.map((chip) => chip.id);
function answerSurvey(rig, opts) {
  const job = rig.job('survey');
  assert.ok(job, 'a survey job is running');
  const survey = fakeSurvey(job.payload, opts);
  rig.progress('table', survey.table);
  rig.progress('threat', survey.threat);
  rig.done(survey);
}
function answerAssess(rig, opts) {
  const job = rig.job('assess');
  assert.ok(job, 'an assess job is running');
  rig.done(fakeAssessed(job.payload, opts));
}
function answerOpponent(rig, opts) {
  const job = rig.job('opponent');
  assert.ok(job, 'an opponent job is running');
  rig.done(fakeOpponentTurn(job.payload, opts));
}

test('ADV1 a black child: move numbers, the held question, pouch-2 squares and the view are the child\'s', T, async () => {
  const rig = await start({}, 'black');
  await rig.advance(1600);
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.last('stage.phase').args[0].ply, 1);
  rig.script.survey = () => ({ depth: 5, best: ref(0, 1, 2, 2), bestScore: 50 });
  rig.script.assess = () => ({ cat: 'blunder', lose: 'horse' });
  await tryMove(rig, ref(0, 1, 2, 2));                                    // 马2进3
  assert.equal(rig.last('thread.tryMove').args[1], 'local', 'voiced: the first question of the game');
  const focus = verdicts(rig).at(-1).focus;
  assert.equal(focus.length, 1);
  assert.equal(rig.state.trial.board[focus[0].row][focus[0].col].color, 'red', 'the attacker is a rival (red) piece');
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(0, 1, 'tap');
  await rig.settle();
  rig.session.newGame({ humanColor: 'black' });
  await rig.settle();
  await rig.advance(1600);
  rig.script.assess = () => ({});
  rig.actions.hint();
  rig.actions.hint();
  await rig.settle();
  const focus2 = rig.calls('stage.hint').at(-1).args[1];
  assert.deepEqual(focus2.pieces, [sq(0, 1)]);
  assert.ok(focus2.squares.some((s) => s.row === 2 && s.col === 2), 'the area holds the landing square');
  assert.ok(focus2.squares.every((s) => s.row <= 2 && s.col <= 2), 'black\'s home rows, black\'s right wing');
  await play(rig, ref(0, 1, 2, 2));
  const committed = rig.last('stage.committed').args[0];
  assert.equal(committed.view.bottom, 'black');
  assert.equal(committed.view.round, 2);
  const sample = rig.calls('brain.recordChildMove').at(-1).args[0];
  assert.deepEqual([sample.ply, sample.hintMax, sample.self], [1, 2, false]);
  const ctx = rig.last('brain.teachingContext').args[0];
  assert.equal(ctx.moveNo, 2, 'his second move');
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('ADV2 a question after the game survives nothing: undo while its reply streams', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'best', loss: 0 });
  await play(rig, CANNON);
  rig.coach.setMode('llm');
  await resign(rig);
  const over = rig.coach.replies.at(-1);
  assert.ok(over && over.kind === 'over');
  over.push('这盘下完了。');
  over.finish();
  await rig.settle();
  rig.actions.ask({ code: 'proud' });
  const reply = rig.coach.replies.at(-1);
  assert.ok(reply && reply.ask === 'proud');
  reply.push('最好的一步');
  const mark = rig.mark();
  rig.actions.undo();
  await rig.settle();
  reply.push('是炮。');
  reply.finish();
  await rig.settle();
  const after = rig.since(mark);
  assert.equal(after.includes('stage.coachSegment'), false);
  assert.equal(rig.state.phase, 'childTurn');
  assert.deepEqual(rig.stage.model.faults, []);
  assert.deepEqual(rig.coach.violations, []);
  // the chips are the turn's again
  assert.ok(chipIds(rig).includes('score'));
  stop(rig);
});

test('ADV3 a trial and a confirm inside the 400 ms the brief waits behind the rival\'s move', T, async () => {
  const rig = await start({ brain: 'manual' });
  answerSurvey(rig, { depth: 4 });
  await rig.settle();
  await tryMove(rig, ROOK);
  answerAssess(rig, {});
  await rig.settle();
  rig.actions.confirm();
  await rig.settle();
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1000);
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.state.history.length, 2);
  // the survey has not said anything about the threat: the brief waits
  const briefs = rig.calls('coach.beginTurn').length;
  await tryMove(rig, HORSE);                                              // the child is faster than the brief
  assert.equal(rig.calls('coach.beginTurn').length, briefs, 'no brief yet');
  answerAssess(rig, { cat: 'mistake' });
  await rig.settle();
  assert.equal(rig.calls('thread.tryMove').length, 1, 'the comment waits for the thread');
  await rig.advance(400);
  assert.equal(rig.calls('coach.beginTurn').length, briefs + 1);
  assertOrder(rig.ops().slice(rig.ops().lastIndexOf('coach.beginTurn')), ['coach.beginTurn', 'thread.open', 'thread.tryMove']);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['why', 'good', 'reply', 'better']);

  // and a confirm before the brief was ever built
  rig.actions.confirm();
  await rig.settle();
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1000);
  assert.equal(rig.state.history.length, 4);
  rig.actions.tap(PAWN.from.row, PAWN.from.col, 'tap');
  rig.actions.tap(PAWN.to.row, PAWN.to.col, 'tap');
  rig.actions.confirm();
  await rig.settle();
  assert.equal(rig.state.phase, 'opponentTurn');
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(2000);
  assert.equal(rig.state.history.length, 6);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('ADV4 pouches tapped before any table: one wait line each at most, then the hints in order; a hint never goes down', T, async () => {
  const rig = await start({ brain: 'manual' });
  rig.actions.hint();
  rig.actions.hint();
  rig.actions.hint();
  await rig.advance(350);
  const waits = localTexts(rig).filter((t) => t === STR.hintWait).length;
  assert.ok(waits >= 1 && waits <= 3);
  const job = rig.job('survey');
  rig.progress('table', fakeTable(job.payload.fen, { depth: 4, best: HORSE, bestScore: 50 }));
  await rig.settle();
  assert.deepEqual(rig.calls('thread.hint').map((e) => e.args[0].level), [1, 2, 3]);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  assert.equal(rig.state.phase, 'selected');
  stop(rig);
});

test('ADV5 stopCoach closes the streaming line once; a failed reply that degrades to nothing leaves no open line', T, async () => {
  const rig = await start();
  rig.coach.setMode('llm');
  rig.actions.ask({ code: 'score' });
  const reply = rig.coach.replies.at(-1);
  reply.push('现在');
  const line = rig.stage.model.lines.at(-1);
  assert.equal(line.end, null);
  rig.actions.stopCoach();
  await rig.settle();
  assert.deepEqual(line.end, { reason: 'aborted', source: 'none' });
  assert.deepEqual(rig.stage.model.faults, []);

  await rig.advance(900);
  rig.actions.ask({ code: 'danger' });
  const second = rig.coach.replies.at(-1);
  second.push('有');
  second.reset();
  second.finish({ source: 'none' });
  await rig.settle();
  const last = rig.stage.model.lines.at(-1);
  assert.equal(last.resets, 1);
  assert.deepEqual(last.end, { reason: 'done', source: 'none' });
  assert.equal(rig.stage.model.chips.some((c) => c.ask === 'why'), false, 'nothing was said: nothing to ask why about');
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('ADV6 an answer that is empty opens no bubble; a silent rival move opens none either', T, async () => {
  const rig = await start();
  rig.coach.script.text = () => '';
  const lines = rig.stage.model.lines.length;
  rig.actions.ask({ code: 'score' });
  await rig.settle();
  assert.equal(rig.stage.model.lines.length, lines);
  assert.equal(rig.calls('stage.coachEnd').length, rig.stage.model.lines.filter((l) => l.end).length);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('ADV7 the over brief: when the child moved last, the rival\'s earlier move is not reported as his last move', T, async () => {
  const rig = await start();
  await play(rig, ROOK);
  await tryMove(rig, HORSE);
  rig.actions.confirm();                                                  // the rival is thinking
  await rig.settle();
  assert.equal(rig.state.phase, 'opponentTurn');
  rig.actions.resign();
  await rig.settle();
  await rig.settle();
  assert.equal(rig.state.phase, 'over');
  const report = rig.last('brief.buildTurnBrief').args[0];
  assert.equal(report.ply, 3);
  assert.equal(report.prev.move.notation, '马二进三');
  assert.equal(report.lastOpp, null, 'the last ply is the child\'s: no rival move "just played"');
  stop(rig);
});

test('ADV8 undo brings the budget marks back: the rival may speak again, a check is not soft, a question can be voiced', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'blunder', lose: 'horse' });
  for (const move of [ROOK, HORSE, PAWN, ref(9, 1, 7, 2), ref(9, 0, 8, 0)]) await play(rig, move);
  assert.equal(rig.state.history.length, 10);
  const extrasBefore = JSON.stringify(rig.director.extras().skill.marks.map((m) => m.ply));
  assert.equal(extrasBefore, '[0,1,2,3,4,5,6,7,8,9]');
  for (let i = 0; i < 5; i++) { rig.actions.undo(); await rig.settle(); }
  assert.equal(rig.state.history.length, 0);
  // the first held trial after going all the way back is voiced again (lastQuestionAt was brought back to move 1 and
  // that was 4 or more moves before... no: it is move 1 again, so the ordinary budget says no; a new game says yes)
  await tryMove(rig, ROOK);
  const mode = rig.last('thread.tryMove').args[1];
  assert.ok(mode === 'silent' || mode === 'local');
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('ADV9 retryOpponent after an illegal answer while a sample is pending: the sample is recorded once', T, async () => {
  const rig = await start({ brain: 'manual' });
  await tryMove(rig, ROOK);
  rig.actions.confirm();                                                  // no table, no verdict: pending
  await rig.settle();
  const job = rig.job('opponent');
  const answer = fakeOpponentTurn(job.payload, { childMoveCp: -40 });
  answer.move = { ...answer.move, from: sq(5, 4), to: sq(5, 5) };
  rig.done(answer);
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.opponentFailed, true);
  assert.equal(rig.calls('brain.recordChildMove').length, 1);
  rig.actions.retryOpponent();
  await rig.settle();
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.history.length, 2);
  assert.equal(rig.calls('brain.recordChildMove').length, 1, 'once');
  const skill = rig.director.extras().skill;
  assert.deepEqual(skill.marks.map((m) => m.ply), [0, 1]);
  assert.deepEqual(skill.samples.map((s) => s.ply), [0], 'the child\'s sample survived the rewind of the refused rival move');
  stop(rig);
});

test('ADV10 dialogs that answer after the game moved on do nothing; a declined dialog does nothing', T, async () => {
  const rig = await start();
  rig.stage.script.dialog.resign = false;
  rig.actions.resign();
  await rig.settle();
  assert.equal(rig.state.phase, 'childTurn');
  rig.stage.script.dialog['new-game'] = null;
  const gameId = rig.state.gameId;
  rig.actions.newGame();
  await rig.settle();
  assert.equal(rig.state.gameId, gameId);
  stop(rig);
});

test('ADV11 a late survey result of the old position after a confirm touches nothing; evals feed evalTwoPliesAgo', T, async () => {
  const rig = await start({ brain: 'manual' });
  const first = rig.job('survey');
  rig.progress('table', fakeTable(first.payload.fen, { depth: 4, best: CANNON, bestScore: 70 }));
  rig.done(fakeSurvey(first.payload, { depth: 4, best: CANNON, bestScore: 70, tension: 0.33 }));
  await rig.settle();
  assert.equal(rig.last('stage.tension').args[0], 0.33);
  await tryMove(rig, ROOK);
  answerAssess(rig, {});
  await rig.settle();
  rig.actions.confirm();
  await rig.settle();
  const tensions = rig.calls('stage.tension').length;
  rig.worker().emit({ t: 'done', id: first.id, kind: 'survey', data: fakeSurvey(first.payload, { tension: 0.9 }) });
  await rig.settle();
  assert.equal(rig.calls('stage.tension').length, tensions);
  const opp = rig.job('opponent').payload;
  assert.deepEqual([opp.ply, opp.tensionPrev, opp.evalTwoPliesAgo], [1, 0.33, null]);
  answerOpponent(rig, { childMoveCp: 10, evalAfter: -25, tension: 0.5 });
  await rig.settle();
  await rig.advance(1600);
  const next = rig.job('survey').payload;
  assert.deepEqual([next.ply, next.tensionPrev, next.evalTwoPliesAgo], [2, 0.5, 70]);
  stop(rig);
});

test('ADV12 the same game is not counted when the page is reloaded during the over card of a counted game', T, async () => {
  const first = await start();
  await play(first, ROOK);
  await resign(first);
  const saved = first.saved();
  assert.equal(saved.counted, true);
  const profile = first.last('store.saveProfile').args[0];
  stop(first);
  const rig = createDirectorRig({ profile });
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await rig.settle();
  assert.equal(rig.calls('brain.finishGame').length, 0);
  // undo out of the restored finished game and resign again: still not counted
  rig.actions.undo();
  await rig.settle();
  await resign(rig);
  assert.equal(rig.calls('brain.finishGame').length, 0);
  assert.equal(rig.calls('store.saveProfile').length, 0);
  assert.equal(rig.stage.model.over.quiet, false);
  stop(rig);
});
