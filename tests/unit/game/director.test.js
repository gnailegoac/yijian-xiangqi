// Director tests (SPEC 14.4; scripts in 5.8, rules in 4.25 and section 6). Real session, real task manager on the fake
// worker with virtual timers, real store on memory storage; fake ports writing one call log (tests/helpers/fake-ports.js).
// The first block carries the titles of 14.4, in its order; the second proves the rest of the director's duties.
//
// Every test has a time limit and compares small values only (names of calls, single fields): a failing comparison of a
// board or a table would print megabytes (CONTRACT-NOTES 128).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirectorRig, fakeTable, fakeSurvey, fakeAssessed, fakeOpponentTurn } from '../../helpers/fake-ports.js';
import { mulberry32 } from '../../helpers/playout.js';
import { getLegalMoves } from '../../../src/core/engine.js';
import { scoreToCp } from '../../../src/core/search.js';
import { STR } from '../../../src/game/strings.js';
import { KEYS } from '../../../src/game/store.js';

const T = { timeout: 30000 };

const sq = (row, col) => ({ row, col });
const ref = (a, b, c, d) => ({ from: sq(a, b), to: sq(c, d) });
const same = (m, n) => m.from.row === n.from.row && m.from.col === n.from.col && m.to.row === n.to.row && m.to.col === n.to.col;

// Red's first moves, as squares (rows 0 = black's back rank .. 9 = red's).
const CANNON = ref(7, 7, 7, 4);       // 炮二平五
const HORSE = ref(9, 7, 7, 6);        // 马二进三
const ROOK = ref(9, 8, 8, 8);         // 车一进一
const PAWN = ref(6, 6, 5, 6);         // 兵三进一

/** `names` occur in `ops` in this order (as a subsequence). */
function assertOrder(ops, names) {
  let at = -1;
  for (const name of names) {
    const next = ops.indexOf(name, at + 1);
    assert.ok(next > at, `"${name}" does not follow position ${at}; calls there: ${ops.slice(Math.max(0, at), at + 14).join(' ')}`);
    at = next;
  }
}

/** A rig with a new game on the board. */
async function start(options = {}, humanColor = 'red') {
  const rig = createDirectorRig(options);
  rig.session.newGame({ humanColor });
  await rig.settle();
  return rig;
}

function stop(rig) {
  rig.director.dispose();
  rig.tasks.dispose();
}

async function tryMove(rig, move) {
  rig.actions.tap(move.from.row, move.from.col, 'tap');
  rig.actions.tap(move.to.row, move.to.col, 'tap');
  await rig.settle();
}

/** Confirms the trial and lets the rival answer (automatic brain) and his piece land. */
async function confirm(rig, ms = 1600) {
  rig.actions.confirm();
  await rig.settle();
  await rig.advance(ms);
}

async function play(rig, move) {
  await tryMove(rig, move);
  await confirm(rig);
}

async function resign(rig) {
  rig.actions.resign();
  await rig.settle();
  await rig.settle();
}

const surveyJob = (rig) => rig.job('survey');
function table(rig, opts) {
  const job = rig.job('survey');
  assert.ok(job, 'a survey job is running');
  rig.progress('table', fakeTable(job.payload.fen, opts));
}
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

const verdicts = (rig) => rig.calls('stage.verdict').map((entry) => entry.args[0]);
const chipIds = (rig) => rig.stage.model.chips.map((chip) => chip.id);
const localTexts = (rig) => rig.stage.model.locals.map((line) => line.text);
const samples = (rig) => rig.calls('brain.recordChildMove').map((entry) => entry.args[0]);

// =====================================================================================================================
// SPEC 14.4
// =====================================================================================================================

test('trial: stage.tentative < stage.verdict(provisional) < assess job < stage.verdict(final) < thread.tryMove', T, async () => {
  const rig = await start({ brain: 'manual' });
  table(rig, { depth: 4 });
  const mark = rig.mark();
  await tryMove(rig, CANNON);
  // the synchronous part: the face reacts from the table alone, then the job leaves
  assertOrder(rig.since(mark), ['thread.interrupt', 'stage.tentative', 'brain.quickVerdict', 'stage.verdict', 'brain.assessJob', 'stage.chips', 'stage.announce']);
  assert.equal(rig.since(mark).includes('thread.tryMove'), false, 'nothing is said before the assessment');
  const provisional = verdicts(rig).at(-1);
  assert.equal(provisional.final, false);
  assert.notEqual(provisional.cat, 'pending', 'the table already knows the move');
  assert.deepEqual([provisional.held, provisional.voiced, provisional.earned], [false, false, false]);
  const job = rig.job('assess');
  assert.ok(job, 'the assess job runs in the worker');
  assert.equal(same(job.payload.move, CANNON), true);
  assert.equal(job.payload.ply, 0);
  assert.equal(job.payload.table.depth, 4, 'the table of the same position travels with the job');
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['good', 'reply', 'better']);

  answerAssess(rig, { cat: 'good' });
  await rig.settle();
  assertOrder(rig.since(mark), ['stage.tentative', 'stage.verdict', 'brain.assessJob', 'brief.buildTryPacket', 'stage.verdict', 'thread.tryMove']);
  const final = verdicts(rig).at(-1);
  assert.deepEqual([final.final, final.cat, final.held], [true, 'good', false]);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('a held trial inside the budget is answered \'local\' at once and shows the held chips; outside the budget it is \'silent\'', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'blunder', lose: 'horse' });       // loses a piece against the best reply: held
  await tryMove(rig, HORSE);
  let tryCall = rig.last('thread.tryMove');
  assert.equal(tryCall.args[1], 'local', 'the guiding question is the local template');
  assert.equal(tryCall.args[0].try.held, true);
  assert.equal(tryCall.args[0].try.reply, null, 'the reply is withheld');
  assert.deepEqual(tryCall.args[2].flags, { earned: false, voiced: true, lord: false });
  let final = verdicts(rig).at(-1);
  assert.deepEqual([final.final, final.held, final.voiced], [true, true, true]);
  assert.equal(final.focus.length, 1, 'the attacker can be tapped');
  assert.deepEqual(chipIds(rig), ['seen', 'show', 'go']);
  const question = rig.stage.model.lines.at(-1);
  assert.equal(question.kind, 'try');
  assert.equal(question.end.source, 'local');
  assert.ok(question.text.length > 0, 'shown at once');
  assert.equal(rig.coach.counters.fetches, 0);

  // a second held trial of the same turn is outside the budget (one question per four child moves): the worried face only
  rig.actions.retract();
  await rig.settle();
  const lines = rig.stage.model.lines.length;
  await tryMove(rig, ROOK);
  tryCall = rig.last('thread.tryMove');
  assert.equal(tryCall.args[1], 'silent');
  final = verdicts(rig).at(-1);
  assert.deepEqual([final.held, final.voiced, final.focus.length], [true, false, 0]);
  assert.equal(rig.stage.model.lines.length, lines, 'no bubble');
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['good', 'reply', 'better']);
  assert.equal(rig.calls('stage.beacon').length, 0, 'never a beacon on a held trial');
  stop(rig);
});

test('a plain good move is \'silent\' under talk smart and \'auto\' under talk more', T, async () => {
  const smart = await start();
  await tryMove(smart, ROOK);
  assert.equal(smart.last('thread.tryMove').args[1], 'silent');
  assert.equal(smart.stage.model.lines.some((line) => line.kind === 'try'), false, 'a nod and no text');
  assert.equal(smart.calls('stage.beacon').length, 0);
  await smart.advance(600);                                              // 600 ms after the piece landed
  assert.equal(smart.calls('stage.beacon').length, 1);
  stop(smart);

  const more = await start({ settings: { talk: 'more' } });
  await tryMove(more, ROOK);
  assert.equal(more.last('thread.tryMove').args[1], 'auto');
  assert.equal(more.stage.model.lines.at(-1).kind, 'try');
  assert.equal(more.calls('stage.beacon').length, 1, 'the beacon fires with the first sentence');
  assert.deepEqual(more.stage.model.chips.map((c) => c.ask), ['good', 'reply', 'better', 'why'], 'the trial set, with why after a spoken reply (4.25.6)');
  // after an answer the set leads with why: why + the chips not used yet
  more.actions.ask({ code: 'good' });
  assert.deepEqual(more.stage.model.chips.map((c) => c.ask), ['why', 'reply', 'better']);
  stop(more);
});

test('confirm before the assessment arrived: the sample is completed from OpponentTurn.childMoveCp and recorded exactly once', T, async () => {
  // (a) a table arrived after the try began (the assess job failed and the survey ran again): loss = bestCp - childMoveCp
  const rig = await start({ brain: 'manual' });
  await tryMove(rig, ROOK);
  assert.equal(verdicts(rig).at(-1).cat, 'pending', 'nothing is known: never praise');
  rig.fail('assess broke');
  await rig.settle();
  assert.ok(surveyJob(rig), 'the survey runs again');
  table(rig, { depth: 4, scoreOf: (move) => (same(move, CANNON) ? 40 : 0) });      // best 40, the tried move 0
  rig.actions.confirm();
  await rig.settle();
  assert.equal(samples(rig).length, 0, 'not recorded at confirm');
  assert.equal(rig.calls('stage.committed').at(-1).args[0].cat, null);
  answerOpponent(rig, { childMoveCp: -110 });
  await rig.settle();
  assert.equal(samples(rig).length, 1);
  const sample = samples(rig)[0];
  assert.equal(sample.bestCp, 40);
  assert.deepEqual([sample.final.loss, sample.final.cat], [150, 'good'], 'max(0, 40 - (-110)); the category from the table as it stood at confirm');
  assert.deepEqual([sample.first.loss, sample.first.cat, sample.tries], [150, 'good', 1]);
  assert.equal(sample.ply, 0);
  const notes = rig.calls('memory.noteMine');
  assert.equal(notes.length, 2, 'the memory hears of the move again when its verdict arrives');
  assert.equal(notes[1].args[1].cat, 'good');
  await rig.advance(1600);
  assert.equal(rig.state.history.length, 2);
  assert.equal(samples(rig).length, 1, 'exactly once');
  stop(rig);

  // (b) no table at all: loss 0, 'good', and the sample carries no weight (legalCount 0)
  const bare = await start({ brain: 'manual' });
  await tryMove(bare, ROOK);
  bare.actions.confirm();
  await bare.settle();
  answerOpponent(bare, { childMoveCp: -300 });
  await bare.settle();
  assert.equal(samples(bare).length, 1);
  assert.deepEqual([samples(bare)[0].final.loss, samples(bare)[0].final.cat, samples(bare)[0].legalCount], [0, 'good', 0]);

  stop(bare);

  // (c) the loss is capped at 600
  const capped = await start({ brain: 'manual' });
  await tryMove(capped, ROOK);
  capped.fail();
  await capped.settle();
  table(capped, { depth: 4, scoreOf: (move) => (same(move, CANNON) ? 1000 : 0) });
  capped.actions.confirm();
  await capped.settle();
  answerOpponent(capped, { childMoveCp: -1500 });
  await capped.settle();
  assert.deepEqual([samples(capped)[0].bestCp, samples(capped)[0].final.loss, samples(capped)[0].final.cat], [1000, 600, 'blunder']);
  stop(capped);
});

test('confirm while a reply is streaming: its signal is aborted, coachEnd is not called afterwards, thread.end is called', T, async () => {
  const rig = await start();
  rig.coach.setMode('llm');
  rig.script.assess = () => ({ cat: 'mistake' });                        // a slip that loses nothing concrete: spoken, not held
  await tryMove(rig, ROOK);
  assert.equal(rig.last('thread.tryMove').args[1], 'auto');
  const reply = rig.coach.replies.at(-1);
  assert.ok(reply && reply.kind === 'try', 'the reply is on its way');
  reply.push('这步');
  assert.equal(rig.stage.model.lines.at(-1).text, '这步');
  const signal = rig.last('thread.tryMove').args[2].signal;
  assert.equal(signal.aborted, false);

  const mark = rig.mark();
  rig.actions.confirm();
  await rig.settle();
  assert.equal(signal.aborted, true);
  assert.equal(reply.alive(), false);
  reply.push('有点慢。');
  reply.finish();
  await rig.settle();
  const after = rig.since(mark);
  assert.ok(after.includes('thread.end'));
  assertOrder(after, ['thread.end', 'stage.committed']);
  assert.equal(after.includes('stage.coachEnd'), false);
  assert.equal(after.includes('stage.coachSegment'), false);
  assert.equal(rig.stage.model.lines.at(-1).text, '这步', 'nothing arrived after the confirm');
  stop(rig);
});

test('retract then the same move again: no second assess job', T, async () => {
  const rig = await start();
  await tryMove(rig, ROOK);
  assert.equal(rig.calls('brain.assessJob').length, 1);
  rig.actions.retract();
  await rig.settle();
  assert.equal(rig.state.phase, 'selected');
  const mark = rig.mark();
  rig.actions.tap(ROOK.to.row, ROOK.to.col, 'tap');
  await rig.settle();
  assert.equal(rig.calls('brain.assessJob').length, 1);
  const after = rig.since(mark);
  assertOrder(after, ['stage.tentative', 'stage.verdict', 'brief.buildTryPacket', 'stage.verdict', 'thread.tryMove']);
  const again = verdicts(rig).slice(-2);
  assert.deepEqual(again.map((v) => [v.final, v.cat]), [[false, 'good'], [true, 'good']], 'instant, from the kept assessment');
  // a different move still gets its own job
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(8, 8, 'tap');
  rig.actions.tap(ROOK.from.row, ROOK.from.col, 'tap');
  await tryMove(rig, HORSE);
  assert.equal(rig.calls('brain.assessJob').length, 2);
  stop(rig);
});

test('the survey is restarted when the worker falls idle after an assess and the survey had not finished', T, async () => {
  const rig = await start({ brain: 'manual' });
  const first = surveyJob(rig);
  assert.ok(first);
  await tryMove(rig, ROOK);
  assert.equal(rig.job('survey'), null, 'the assess job supersedes the survey');
  assert.equal(rig.calls('brain.surveyJob').length, 1);
  answerAssess(rig, {});
  await rig.settle();
  const second = surveyJob(rig);
  assert.ok(second, 'started again');
  assert.notEqual(second.id, first.id);
  assert.equal(second.payload.fen, first.payload.fen);
  assert.equal(rig.calls('brain.surveyJob').length, 2);

  // once it has finished it is not started again
  answerSurvey(rig, { depth: 6 });
  await rig.settle();
  rig.actions.retract();
  await rig.settle();
  await tryMove(rig, ROOK);
  rig.actions.retract();
  await rig.settle();
  assert.equal(rig.calls('brain.surveyJob').length, 2);

  // a survey that failed is never restarted for that position: the pouch says so instead
  const broken = await start({ brain: 'manual' });
  broken.fail('survey broke');
  await broken.settle();
  await tryMove(broken, ROOK);
  answerAssess(broken, {});
  await broken.settle();
  broken.actions.retract();
  await broken.settle();
  assert.equal(broken.calls('brain.surveyJob').length, 1);
  broken.actions.hint();
  await broken.settle();
  assert.equal(localTexts(broken).at(-1), STR.hintUnavailable);
  stop(rig);
  stop(broken);
});

test('undo while the rival thinks: nothing after stage.undone belongs to the old position, even when the fake worker answers afterwards', T, async () => {
  const rig = await start({ brain: 'manual' });
  answerSurvey(rig, { depth: 4 });
  await rig.settle();
  await tryMove(rig, ROOK);
  answerAssess(rig, {});
  await rig.settle();
  rig.actions.confirm();
  await rig.settle();
  const rival = rig.job('opponent');
  assert.ok(rival, 'the rival is thinking');
  assert.equal(rig.state.phase, 'opponentTurn');

  const mark = rig.mark();
  rig.actions.undo();
  await rig.settle();
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.state.history.length, 0);
  // the worker answers the old job late, and a late progress of it too
  rig.worker().emit({ t: 'done', id: rival.id, kind: 'opponent', data: fakeOpponentTurn(rival.payload, {}) });
  await rig.settle();
  await rig.advance(3000);
  const after = rig.since(mark);
  const undone = after.indexOf('stage.undone');
  assert.ok(undone >= 0);
  for (const op of ['stage.rivalMoved', 'brain.recordOpponentMove', 'stage.committed', 'stage.rival']) {
    assert.equal(after.indexOf(op, undone), -1, `${op} after stage.undone`);
  }
  assert.equal(rig.state.history.length, 0);
  assert.equal(rig.stage.model.board, rig.state.board, 'the stage shows the restored position');
  assert.equal(rig.stage.model.phase, 'childTurn');
  assert.ok(rig.tasks.stats().lateDrops > 0, 'the late answer was dropped by the task manager');
  assert.ok(surveyJob(rig), 'the survey of the restored position runs');
  stop(rig);
});

test('undo after a confirmed mistake: the next brief has no mine for the undone move and no moment at or after the restored ply', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'mistake' });
  await play(rig, ROOK);
  const turn = rig.last('coach.beginTurn').args[0];
  assert.equal(turn.ply, 2);
  assert.equal(turn.mine.cat, 'mistake');
  assert.equal(turn.opp.punishes, true, 'the rival answered with the refutation');
  assert.deepEqual(turn.moments.map((m) => m.tag), ['slip'], 'the slip of ply 0; the punishing move itself is turn.opp');
  assertOrder(rig.ops(), ['brief.buildTurnBrief', 'coach.beginTurn', 'memory.noteOpp']);
  assert.deepEqual([rig.last('memory.noteOpp').args[0], rig.last('memory.noteOpp').args[1].punishes], [1, true], 'noted after the brief was built');

  rig.actions.undo();
  await rig.settle();
  assert.equal(rig.state.history.length, 0);
  const back = rig.last('coach.beginTurn').args[0];
  assert.equal(back.ply, 0);
  assert.equal(back.back, 'undo');
  assert.equal(back.mine, null);
  assert.equal(back.opp, null);
  assert.deepEqual(back.moments, []);
  const report = rig.last('brief.buildTurnBrief').args[0];
  assert.equal(report.prev, null);
  assert.equal(report.lastOpp, null);
  assert.equal(rig.last('thread.open').args[1], 'silent', 'no request after an undo');
  assert.equal(localTexts(rig).at(-1), STR.undoDone);
  stop(rig);
});

test('undo restores GameSkill counters bit-exactly and calls coach.reset < memory.rewind < rewindGameSkill < save', T, async () => {
  const rig = await start();
  rig.script.opponent = (payload) => ({ mode: payload.ply === 1 ? 'ease' : 'press', evalBest: 700, kind: 'overlook' });
  await play(rig, ROOK);
  const before = JSON.stringify(rig.director.extras().skill);
  const savedBefore = JSON.stringify(rig.saved().skill);
  assert.equal(before, savedBefore);
  await play(rig, HORSE);
  assert.notEqual(JSON.stringify(rig.director.extras().skill), before);
  assert.equal(rig.director.extras().skill.samples.length, 2);

  const mark = rig.mark();
  rig.actions.undo();
  await rig.settle();
  assert.equal(rig.state.history.length, 2);
  assert.equal(JSON.stringify(rig.director.extras().skill), before);
  const after = rig.since(mark);
  assertOrder(after, ['coach.reset', 'memory.rewind', 'brain.rewindGameSkill', 'stage.settle', 'stage.undone', 'stage.coachLocal', 'stage.notation', 'save']);
  assert.deepEqual(rig.last('memory.rewind').args, [2]);
  assert.deepEqual(rig.last('brain.rewindGameSkill').args, [2]);
  assert.equal(JSON.stringify(JSON.parse(rig.storage.getItem(KEYS.game)).skill), before, 'and that is what was saved');

  // all the way back: a fresh record
  rig.actions.undo();
  await rig.settle();
  const fresh = rig.director.extras().skill;
  assert.deepEqual([fresh.samples.length, fresh.marks.length, fresh.n, fresh.sinceChance, fresh.lastKind], [0, 0, 0, 99, null]);
  stop(rig);
});

test('new game mid-everything; resign during a trial', T, async () => {
  const rig = await start({ brain: 'manual' });
  rig.coach.setMode('llm');
  answerSurvey(rig, { depth: 4 });
  await rig.settle();
  await tryMove(rig, ROOK);
  answerAssess(rig, { cat: 'mistake' });
  await rig.settle();
  const reply = rig.coach.replies.at(-1);
  assert.ok(reply, 'a reply is streaming');
  reply.push('这');
  const oldGame = rig.state.gameId;
  const oldSeed = rig.director.extras().seed;

  // a new game as black, in the middle of a trial with a reply in flight
  rig.stage.script.dialog['new-game'] = { humanColor: 'black' };
  const mark = rig.mark();
  rig.actions.newGame();
  await rig.settle();
  const after = rig.since(mark);
  assertOrder(after, ['stage.dialog', 'coach.reset', 'thread.end', 'stage.settle', 'coach.reset', 'stage.reset', 'stage.rival', 'stage.phase', 'brain.opponentJob']);
  assert.equal(rig.state.gameId, oldGame + 1);
  assert.equal(rig.state.humanColor, 'black');
  assert.equal(rig.state.phase, 'opponentTurn');
  assert.equal(reply.alive(), false);
  reply.push('晚了。');
  assert.notEqual(rig.director.extras().seed, oldSeed, 'a new seed');
  assert.deepEqual([rig.director.extras().skill.samples.length, rig.director.extras().activeMs], [0, 0]);
  assert.equal(rig.last('stage.reset').args[1].deal, true);
  assert.equal(rig.stage.model.trial, null);
  assert.equal(rig.stage.model.board, rig.state.board);
  assert.deepEqual(rig.stage.model.chips, []);
  const lines = rig.stage.model.lines.length;
  await rig.advance(3000);
  assert.equal(rig.stage.model.lines.length, lines, 'nothing of the old game arrives');
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);

  // resign during a trial
  const other = await start();
  await tryMove(other, ROOK);
  const at = other.mark();
  await resign(other);
  const ops = other.since(at);
  assertOrder(ops, ['stage.dialog', 'stage.settle', 'thread.end', 'stage.phase', 'stage.chips', 'store.saveProfile', 'stage.over', 'stage.rival', 'coach.beginOver', 'thread.open']);
  assert.equal(other.state.phase, 'over');
  assert.equal(other.stage.model.phase, 'over');
  assert.deepEqual([other.stage.model.over.result, other.stage.model.over.reason, other.stage.model.over.quiet], ['loss', 'resign', false]);
  assert.equal(other.state.counted, true);
  assert.equal(other.stage.model.lines.at(-1).target, 'card');
  assert.deepEqual(other.coach.violations, []);
  stop(other);
});

test('opponent job fails twice: session.opponentFailed and the failed phase; retryOpponent restarts it', T, async () => {
  const rig = await start({ brain: 'manual' });
  await tryMove(rig, ROOK);
  rig.actions.confirm();
  await rig.settle();
  const first = rig.job('opponent');
  assert.ok(first);
  rig.fail('broke');
  await rig.settle();
  const second = rig.job('opponent');
  assert.ok(second && second.id !== first.id, 'tried once more');
  assert.equal(rig.state.opponentFailed, false);
  rig.fail('broke again');
  await rig.settle();
  assert.equal(rig.state.opponentFailed, true);
  assert.equal(rig.job('opponent'), null, 'no third attempt by itself');
  const told = rig.last('stage.phase').args[0];
  assert.deepEqual([told.phase, told.failed], ['opponentTurn', true]);
  assert.equal(rig.calls('brain.recordOpponentMove').length, 0);

  rig.actions.retryOpponent();
  await rig.settle();
  assert.equal(rig.state.opponentFailed, false);
  assert.equal(rig.last('stage.phase').args[0].failed, false);
  assert.ok(rig.job('opponent'), 'the rival thinks again');
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.history.length, 2);
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.calls('brain.recordOpponentMove').length, 1);

  // an illegal answer: the session has set the flag itself; the retry records the rival's move once
  await tryMove(rig, HORSE);
  rig.actions.confirm();
  await rig.settle();
  const job = rig.job('opponent');
  const answer = fakeOpponentTurn(job.payload, {});
  answer.move = { ...answer.move, to: { row: 5, col: 5 }, from: { row: 5, col: 4 } };      // no piece there
  rig.done(answer);
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.opponentFailed, true);
  assert.equal(rig.last('stage.phase').args[0].failed, true);
  rig.actions.retryOpponent();
  await rig.settle();
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.history.length, 4);
  const marks = rig.director.extras().skill.marks.map((mark) => mark.ply);
  assert.deepEqual(marks, [0, 1, 2, 3], 'one mark per ply');
  stop(rig);
});

test('pouches 1-3: visuals are pushed before the coach reply starts; pouch 3 selects the piece and pins the truth', T, async () => {
  const rig = await start();
  rig.script.survey = () => ({ depth: 5, best: HORSE, bestScore: 60 });
  rig.actions.undo();                                                    // nothing to undo: a toast, no change
  rig.session.newGame({ humanColor: 'red' });
  await rig.settle();

  for (const level of [1, 2, 3]) {
    const mark = rig.mark();
    rig.actions.hint();
    await rig.settle();
    const ops = rig.since(mark);
    assertOrder(ops, ['brain.hintFor', 'stage.hint', 'brief.buildHintPacket', 'thread.hint', 'stage.coachBegin']);
    assert.equal(rig.last('stage.hint').args[0], level);
    assert.equal(rig.last('thread.hint').args[0].level, level);
    assert.equal(rig.last('thread.hint').args[1], 'auto');
    assert.equal(rig.last('stage.phase').args[0].hintLevel, level);
  }
  const focus2 = rig.calls('stage.hint')[1].args[1];
  assert.deepEqual(focus2.pieces, [HORSE.from]);
  assert.equal(focus2.squares.length, 9, 'the squares of the area');
  assert.ok(focus2.squares.some((s) => s.row === HORSE.to.row && s.col === HORSE.to.col));
  const focus3 = rig.calls('stage.hint')[2].args[1];
  assert.equal(same(focus3.move, HORSE), true);
  assert.deepEqual(rig.state.selected, HORSE.from, 'pouch 3 picks the piece up');
  assert.equal(rig.state.phase, 'selected');
  assert.deepEqual(chipIds(rig), ['try', 'danger', 'score'], 'the hint3 set: the try chip in front of the turn set');
  assert.deepEqual([rig.stage.model.chips[0].action, rig.stage.model.chips[0].primary, rig.stage.model.chips[0].label], ['pouch', true, '试试这步']);
  assert.equal(rig.last('thread.hint').args[0].hint.move, '马二进三');

  // a fourth pouch does not exist
  const calls = rig.calls('stage.hint').length;
  rig.actions.hint();
  await rig.settle();
  assert.equal(rig.calls('stage.hint').length, calls);

  // the chip tries the pinned move
  rig.actions.chip(rig.stage.model.chips[0]);
  await rig.settle();
  assert.equal(rig.state.phase, 'tentative');
  assert.equal(same(rig.state.trial.move, HORSE), true);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('one truth: after a \'better\' answer and a retract, pouch 3 names the same move', T, async () => {
  const rig = await start({ brain: 'manual' });
  table(rig, { depth: 4, best: CANNON, bestScore: 40 });
  await tryMove(rig, ROOK);
  assert.equal(same(rig.job('assess').payload.compare, CANNON), true, 'the pinned move is the comparison move');
  answerAssess(rig, { cat: 'ok', loss: 80, best: CANNON });
  await rig.settle();
  const more = rig.last('thread.tryMove').args[0].more;
  assert.equal(more.better[0].move, '炮二平五');

  rig.actions.ask({ code: 'better' });
  await rig.settle();
  const arrow = rig.last('stage.arrows').args[0][0];
  assert.deepEqual([arrow.style, same(arrow, CANNON)], ['idea', true]);
  assert.equal(rig.last('thread.ask').args[0].ask, 'better');

  // a deeper table with another best move arrives: the truth was shown, it stays
  assert.ok(surveyJob(rig), 'the survey runs again after the assess job');
  table(rig, { depth: 8, scoreOf: (move) => (same(move, HORSE) ? 300 : same(move, CANNON) ? 40 : 0) });
  rig.actions.retract();
  await rig.settle();
  for (let i = 0; i < 3; i++) {
    rig.actions.hint();
    await rig.settle();
  }
  assert.equal(same(rig.last('stage.hint').args[1].move, CANNON), true);
  assert.equal(rig.last('thread.hint').args[0].hint.move, more.better[0].move);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('the truth is replaced only by a table two plies deeper with a 60 cp better move, and never after it was shown', T, async () => {
  const rig = await start({ brain: 'manual' });
  /** The comparison move the next trial is given: the pinned truth. */
  const pinned = async () => {
    await tryMove(rig, ROOK);
    const compare = rig.job('assess').payload.compare;
    rig.actions.retract();
    await rig.settle();
    rig.actions.tap(ROOK.from.row, ROOK.from.col, 'tap');                // put the rook down again
    await rig.settle();
    assert.equal(rig.state.phase, 'childTurn');
    assert.ok(surveyJob(rig), 'the survey runs again');
    return compare;
  };
  const scores = (horse) => (move) => (same(move, HORSE) ? horse : same(move, CANNON) ? 40 : 0);

  assert.equal(await (async () => { await tryMove(rig, ROOK); const c = rig.job('assess').payload.compare; rig.actions.retract(); await rig.settle();
                                    rig.actions.tap(ROOK.from.row, ROOK.from.col, 'tap'); await rig.settle(); return c; })(), null, 'no table yet: no truth');
  table(rig, { depth: 4, scoreOf: scores(0) });
  assert.equal(same(await pinned(), CANNON), true, 'set from the first table');
  table(rig, { depth: 5, scoreOf: scores(140) });
  assert.equal(same(await pinned(), CANNON), true, 'one ply deeper is not enough');
  table(rig, { depth: 6, scoreOf: scores(90) });
  assert.equal(same(await pinned(), CANNON), true, '50 cp better is not enough');
  table(rig, { depth: 6, scoreOf: scores(140) });
  assert.equal(same(await pinned(), HORSE), true, 'two plies deeper and 100 cp better: replaced');

  // shown (pouch 3): a much better move in a much deeper table no longer replaces it
  for (let i = 0; i < 3; i++) {
    rig.actions.hint();
    await rig.settle();
  }
  assert.equal(same(rig.last('stage.hint').args[1].move, HORSE), true);
  rig.actions.tap(HORSE.from.row, HORSE.from.col, 'tap');                // put the horse down
  await rig.settle();
  table(rig, { depth: 9, scoreOf: (move) => (same(move, PAWN) ? 900 : same(move, HORSE) ? 140 : 0) });
  assert.equal(same(await pinned(), HORSE), true);
  stop(rig);
});

test('the truth is replaced by a 60 cp better move also where both scores lie beyond the clamp of scoreToCp (CONTRACT-NOTES 147)', T, async () => {
  // Far behind (and far ahead) every score that is no mate reads -1900 (+1900). The pinned move of the first table must
  // not stay when a deeper table refutes it: every trial is measured against it, and pouch 3 would recommend it.
  for (const [label, base] of [['far behind', -4000], ['far ahead', 2600]]) {
    const rig = await start({ brain: 'manual' });
    const pinned = async () => {
      await tryMove(rig, ROOK);
      const compare = rig.job('assess').payload.compare;
      rig.actions.retract();
      await rig.settle();
      rig.actions.tap(ROOK.from.row, ROOK.from.col, 'tap');              // put the rook down again
      await rig.settle();
      assert.ok(surveyJob(rig), 'the survey runs again');
      return compare;
    };
    // the first table: the cannon move is best; all moves read the same in centipawns
    const scores = (cannon, horse) => (move) => base + (same(move, CANNON) ? cannon : same(move, HORSE) ? horse : 0);
    table(rig, { depth: 4, scoreOf: scores(300, 0) });
    assert.equal(scoreToCp(base + 300), scoreToCp(base), `${label}: the scale has run out`);
    assert.equal(same(await pinned(), CANNON), true, `${label}: set from the first table`);
    table(rig, { depth: 6, scoreOf: scores(300, 350) });
    assert.equal(same(await pinned(), CANNON), true, `${label}: 50 cp better is not enough`);
    // two plies deeper the cannon move turns out to lose 900 and the horse move is the best by far
    table(rig, { depth: 6, scoreOf: scores(-900, 100) });
    assert.equal(same(await pinned(), HORSE), true, `${label}: the refuted pin is replaced`);
    // a mate score against a clamped score is compared as before: 2000 against 1900 is 100 cp, enough
    table(rig, { depth: 8, scoreOf: (move) => (same(move, PAWN) ? 29990 : scores(-900, 100)(move)) });
    assert.equal(same(await pinned(), PAWN), true, `${label}: a mate replaces it`);
    stop(rig);
  }
});

test('a rival move always gets a caption; a sentence only when policy says so', T, async () => {
  const rig = await start();
  await play(rig, ROOK);                                                 // the rival's first move: ply < 4, spoken
  assert.equal(rig.stage.model.captions.length, 1);
  assert.match(rig.stage.model.captions[0], /^【.+】/);
  assert.equal(rig.last('thread.open').args[0].kind, 'opp');
  assert.equal(rig.last('thread.open').args[1], 'auto');
  assert.equal(rig.stage.model.lines.at(-1).kind, 'opp');

  const lines = rig.stage.model.lines.length;
  let mark = rig.mark();
  await play(rig, HORSE);                                                // a quiet move later on: caption only
  assert.equal(rig.stage.model.captions.length, 2);
  assert.equal(rig.last('thread.open').args[1], 'silent');
  assert.equal(rig.stage.model.lines.length, lines, 'no sentence');
  assertOrder(rig.since(mark), ['stage.rivalMoved', 'stage.rival', 'stage.tension', 'stage.notation', 'stage.announce', 'brain.positionFacts', 'stage.phase',
                                'brain.surveyJob', 'brief.buildTurnBrief', 'coach.beginTurn', 'memory.noteOpp', 'stage.caption', 'thread.open', 'stage.chips']);
  assert.deepEqual(rig.last('stage.rivalMoved').args[0].caption, [], 'the caption follows with the brief');

  // a capture is worth a sentence, also late in the game
  rig.script.opponent = () => {
    const capture = getLegalMoves(rig.state.board, 'black').find((m) => m.captured);      // 炮2进7 takes the horse behind red's cannon
    return capture ? { move: { from: capture.from, to: capture.to } } : {};
  };
  mark = rig.mark();
  await play(rig, PAWN);
  const turn = rig.last('coach.beginTurn').args[0];
  assert.equal(turn.ply, 6);
  assert.ok(turn.opp.captured, 'he took a piece');
  assert.equal(rig.last('stage.rivalMoved').args[0].lostBig, turn.opp.captured !== 'P' && turn.opp.captured !== 'A' && turn.opp.captured !== 'E');
  assert.equal(rig.last('thread.open').args[1], 'auto');
  assert.equal(rig.stage.model.lines.at(-1).kind, 'opp');
  assert.equal(rig.stage.model.captions.length, 3, 'always a caption');

  // talk: 'more' speaks on every rival move
  const more = await start({ settings: { talk: 'more' } });
  await play(more, ROOK);
  await play(more, HORSE);
  assert.equal(more.last('thread.open').args[1], 'auto');
  stop(rig);
  stop(more);
});

test('see-first: the reply chip previews the line on the stage before thread.ask is called', T, async () => {
  const rig = await start();
  await tryMove(rig, ROOK);
  const mark = rig.mark();
  rig.actions.ask({ code: 'reply' });
  await rig.settle();
  assertOrder(rig.since(mark), ['stage.preview', 'stage.childSaid', 'thread.ask']);
  const [moves, opts] = rig.last('stage.preview').args;
  assert.equal(opts.from, 'trial');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].piece.color, 'black', 'a real Move: the rival\'s piece with its id');
  assert.equal(typeof moves[0].piece.id, 'string');
  assert.equal(rig.last('stage.childSaid').args[0], '对方会怎么应？');
  assert.equal(rig.last('thread.ask').args[0].ask, 'reply');
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['why', 'good', 'better'], 'after set: why and the chips not used yet');

  // asks are at least 800 ms apart
  rig.actions.ask({ code: 'good' });
  assert.equal(rig.calls('thread.ask').length, 1);
  await rig.advance(800);
  rig.actions.ask({ code: 'good' });
  assert.equal(rig.calls('thread.ask').length, 2);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('a tap on an own piece during the rival\'s turn becomes the selection when the turn starts', T, async () => {
  const rig = await start({ brain: 'manual' });
  await tryMove(rig, ROOK);
  rig.actions.confirm();
  await rig.settle();
  assert.equal(rig.state.phase, 'opponentTurn');
  const rejected = rig.calls('stage.rejected').length;
  rig.actions.tap(9, 7, 'tap');                                          // an own horse
  assert.equal(rig.calls('stage.rejected').length, rejected, 'not refused');
  assert.equal(rig.state.selected, null);
  rig.actions.tap(0, 0, 'tap');                                          // a rival piece: refused as usual
  assert.equal(rig.last('stage.rejected').args[1], 'not-your-turn');
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.phase, 'selected');
  assert.deepEqual(rig.state.selected, sq(9, 7));
  assert.deepEqual(rig.last('stage.selected').args[0], sq(9, 7));
  assert.equal(rig.last('stage.phase').args[0].phase, 'selected');
  stop(rig);
});

test('tapping the focused attacker after a guiding question answers 对，就是它！', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'blunder', lose: 'horse' });
  await tryMove(rig, HORSE);
  const focus = verdicts(rig).at(-1).focus;
  assert.equal(focus.length, 1);
  const trialId = rig.state.trialId;
  rig.actions.tap(focus[0].row, focus[0].col, 'tap');
  assert.equal(localTexts(rig).at(-1), STR.rightPiece);
  assert.deepEqual(rig.last('stage.highlight').args[0], { pieces: [focus[0]] });
  assert.equal(rig.state.phase, 'tentative');
  assert.equal(rig.state.trialId, trialId, 'no session command');
  assert.equal(rig.calls('stage.rejected').length, 0);

  // 我看出来了: a kind word, then the trial is taken back
  const mark = rig.mark();
  rig.actions.chip(rig.stage.model.chips.find((chip) => chip.id === 'seen'));
  await rig.settle();
  assertOrder(rig.since(mark), ['stage.coachLocal', 'thread.retract', 'stage.retracted']);
  assert.ok(STR.seenIt.includes(localTexts(rig).at(-1)));
  assert.equal(rig.state.phase, 'selected');
  // after the retract the square is an ordinary one again
  rig.actions.tap(focus[0].row, focus[0].col, 'tap');
  assert.equal(rig.calls('stage.rejected').length, 1);
  stop(rig);
});

test('the take-back chip undoes two plies; it is offered at most three times', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'blunder', lose: 'horse', loss: 400 });
  // the first held trial is voiced; a second one in the same turn only gets the worried face
  await tryMove(rig, HORSE);
  assert.equal(rig.last('thread.tryMove').args[1], 'local');
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(HORSE.from.row, HORSE.from.col, 'tap');

  const offers = () => localTexts(rig).filter((text) => text === STR.takebackOffer).length;
  for (let round = 1; round <= 4; round++) {
    await tryMove(rig, ROOK);
    assert.equal(rig.last('thread.tryMove').args[1], 'silent', `round ${round}: no comment`);
    await confirm(rig);
    assert.equal(rig.state.history.length, 2);
    const turn = rig.last('coach.beginTurn').args[0];
    assert.equal(turn.opp.punishes, true);
    assert.equal(turn.mine.waited, false, 'confirmed before any comment');
    if (round <= 3) {
      assert.equal(offers(), round);
      assert.equal(rig.stage.model.chips[0].id, 'takeback');
      assert.equal(rig.stage.model.chips[0].primary, true);
      rig.actions.chip(rig.stage.model.chips[0]);
      await rig.settle();
      assert.equal(rig.state.history.length, 0, 'two plies undone');
      assert.equal(rig.state.phase, 'childTurn');
    } else {
      assert.equal(offers(), 3, 'not a fourth time');
      assert.equal(chipIds(rig).includes('takeback'), false);
    }
  }
  stop(rig);
});

test('a spared mate is explained afterwards', T, async () => {
  const rig = await start();
  rig.script.opponent = (payload) => ({ kind: 'overlook', overlooked: { gain: 2000, mate: true, line: { start: payload.fen, moves: [], end: 'mate' } } });
  await play(rig, ROOK);
  assert.ok(localTexts(rig).includes(STR.sparedMate));
  assert.equal(rig.stage.model.chips[0].id, 'takeback', 'and the child may take the move back');
  assert.equal(localTexts(rig).includes(STR.takebackOffer), false);
  assertOrder(rig.ops(), ['stage.rivalMoved', 'stage.caption', 'thread.open', 'stage.coachLocal', 'stage.chips']);
  // the spared mate is counted by the skill record through the choice as the brain returned it
  assert.equal(rig.director.extras().skill.spared, 1);
  stop(rig);
});

test('a chance inside the child\'s horizon is not announced; it is nudged after 20 s', T, async () => {
  const chance = (to) => (payload) => ({
    kind: 'chance',
    chance: { gain: 400, points: 4, tier: 1, revealDepth: 2,
              line: { start: payload.fen, moves: [{ from: sq(7, 1), to, notation: '炮八进七', piece: 'cannon', color: 'red', captured: 'horse' }], end: 'quiet' } },
  });
  const rig = await start();
  rig.script.opponent = chance(sq(0, 1));
  await play(rig, ROOK);
  const report = rig.last('brief.buildTurnBrief').args[0];
  assert.equal(report.announceChance, false, 'a tier-1 chance is inside the horizon of a level-2 child');
  assert.equal(rig.last('coach.beginTurn').args[0].chance, null);
  assert.equal(rig.director.extras().skill.chances, 1);
  const nudge = STR.chanceNudge('右翼');
  await rig.advance(19000);
  assert.equal(localTexts(rig).includes(nudge), false);
  await rig.advance(1500);
  assert.equal(localTexts(rig).filter((text) => text === nudge).length, 1);
  await rig.advance(30000);
  assert.equal(localTexts(rig).filter((text) => text === nudge).length, 1, 'once');
  stop(rig);

  // any input starts the 20 s again; a hidden page does not count
  const busy = await start();
  busy.script.opponent = chance(sq(0, 1));
  await play(busy, ROOK);
  await busy.advance(15000);
  busy.actions.activity();
  await busy.advance(15000);
  assert.equal(localTexts(busy).includes(nudge), false);
  busy.director.visibility(false);
  await busy.advance(60000);
  assert.equal(localTexts(busy).includes(nudge), false);
  busy.director.visibility(true);
  await busy.advance(20500);
  assert.equal(localTexts(busy).includes(nudge), true);
  stop(busy);

  // a chance on the child's own back rank is not nudged: "己方底线好像有破绽" would point at the wrong side
  const own = await start();
  own.script.opponent = chance(sq(9, 1));
  await play(own, ROOK);
  await own.advance(30000);
  assert.equal(localTexts(own).some((text) => text.includes('破绽')), false);
  stop(own);
});

test('repeat warning on a trial that repeats the position', T, async () => {
  const rig = await start();
  const answers = [ref(0, 1, 2, 2), ref(2, 2, 0, 1)];
  rig.script.opponent = (payload) => ({ move: answers[((payload.ply - 1) / 2) % 2] });
  await play(rig, HORSE);
  await play(rig, ref(7, 6, 9, 7));
  assert.equal(localTexts(rig).includes(STR.repeatWarn), false);
  await tryMove(rig, HORSE);
  assert.equal(rig.state.trial.repeat, 'repeat');
  assert.equal(localTexts(rig).filter((text) => text === STR.repeatWarn).length, 1);
  assert.equal(rig.last('brief.buildTryPacket').args[1].repeat, true);
  assert.equal(rig.last('thread.tryMove').args[0].try.repeat, true);
  assert.equal(rig.last('thread.tryMove').args[1], 'auto', 'a repetition is worth a sentence');
  assertOrder(rig.ops().slice(rig.ops().lastIndexOf('stage.tentative')), ['stage.tentative', 'stage.verdict', 'stage.verdict', 'stage.coachLocal', 'thread.tryMove']);
  stop(rig);
});

test('game over: statistics counted once across undo-and-finish-again; rank never decreases; goal stored; kept reported', T, async () => {
  const base = createDirectorRig();
  const profile = { ...base.store.load().profile, rank: 5, goal: { code: 'greedy', setAt: 1 } };
  stop(base);
  const rig = await start({ profile });
  assert.ok(localTexts(rig).some((text) => text.startsWith('上盘说好的小目标')), 'the goal is recalled at the start');
  const rnd = mulberry32(7);
  rig.script.opponent = (payload) => ({ index: payload.ply * 7 + 3 });
  rig.script.assess = (payload) => (payload.ply === 8 ? { cat: 'blunder', danger: 'hangs_moved_piece' } : {});
  for (let i = 0; i < 11 && rig.state.phase !== 'over'; i++) {
    const legal = getLegalMoves(rig.state.board, 'red').filter((m) => !m.captured);
    for (let attempt = 0; attempt < 20 && rig.state.phase !== 'tentative'; attempt++) rig.session.tryMove(legal[Math.floor(rnd() * legal.length)]);
    await rig.settle();
    await confirm(rig);
  }
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.director.extras().skill.samples.length, 11);

  await resign(rig);
  assert.equal(rig.calls('brain.finishGame').length, 1);
  assert.deepEqual(rig.last('brain.finishGame').args, ['loss']);
  let saved = rig.last('store.saveProfile').args[0];
  assert.deepEqual(saved.games, { played: 1, won: 0, lost: 1, drawn: 0 });
  assert.equal(saved.skill.games, 1);
  assert.equal(saved.rank, 5, 'a high-water mark: the level is 2, the rank stays');
  assert.equal(saved.goal.code, 'hang_piece', 'the lesson of this game is the next small goal');
  assert.equal(JSON.parse(rig.storage.getItem(KEYS.profile)).goal.code, 'hang_piece');
  assert.equal(rig.state.counted, true);
  let view = rig.stage.model.over;
  assert.deepEqual([view.result, view.reason, view.byChildMate, view.quiet], ['loss', 'resign', false, false]);
  assert.equal(view.kept, true, 'last game\'s goal (greedy) was kept');
  assert.equal(view.goal, STR.goalNext('走完先看一眼，这个子有没有人保护'));
  assert.equal(view.rank, null, 'the rank did not rise');
  assert.equal(view.stats.rounds, 11);
  assertOrder(rig.ops(), ['brain.finishGame', 'brief.buildOverPacket', 'store.saveProfile', 'stage.over', 'stage.rival', 'coach.beginOver', 'thread.open']);
  assert.equal(rig.last('thread.open').args[0].kind, 'over');
  assert.equal(rig.last('thread.open').args[1], 'auto');
  assert.deepEqual(chipIds(rig), ['next'], 'only the chips whose directive has data');

  // undo the resignation and finish again: nothing is counted twice
  const saves = rig.calls('store.saveProfile').length;
  rig.actions.undo();
  await rig.settle();
  assert.equal(rig.state.phase, 'childTurn');
  await resign(rig);
  assert.equal(rig.calls('brain.finishGame').length, 1);
  assert.equal(rig.calls('brain.gameTakeaways').length, 1);
  assert.equal(rig.calls('store.saveProfile').length, saves);
  saved = JSON.parse(rig.storage.getItem(KEYS.profile));
  assert.deepEqual(saved.games, { played: 1, won: 0, lost: 1, drawn: 0 });
  view = rig.stage.model.over;
  assert.equal(view.kept, true, 'still judged against the goal the game began with');
  assert.equal(rig.calls('stage.over').length, 2);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('game over after a loss still replays the child\'s best move', T, async () => {
  const rig = await start();
  rig.script.assess = (payload) => (payload.ply === 0 ? { cat: 'best', loss: 0 } : { cat: 'ok' });
  await play(rig, CANNON);
  await play(rig, ROOK);
  await resign(rig);
  const view = rig.stage.model.over;
  assert.equal(view.result, 'loss');
  assert.ok(view.proud, 'the replay of the best move');
  assert.equal(view.proud.notation, '炮二平五');
  assert.equal(same(view.proud.move, CANNON), true);
  assert.equal(view.proud.before, rig.state.history[0].before, 'the board before that move');
  assert.equal(view.proud.self, true);
  assert.deepEqual(chipIds(rig), ['proud']);
  // 司马懿's last word comes after the card and is never smug
  assert.equal(rig.last('stage.rival').args[0].mood, 'calm');
  assert.ok(['承让。', '承让，改日再战。'].includes(rig.last('stage.rival').args[0].line));
  stop(rig);
});

test('restore of a finished game shows the card quietly and updates nothing', T, async () => {
  const first = await start();
  first.script.assess = () => ({ cat: 'best', loss: 0 });
  await play(first, CANNON);
  await resign(first);
  const saved = first.saved();
  const profile = first.last('store.saveProfile').args[0];
  assert.equal(saved.counted, true);
  assert.equal(saved.result.reason, 'resign');
  stop(first);

  const rig = createDirectorRig({ profile });
  rig.coach.setMode('llm');
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await rig.settle();
  assert.equal(rig.state.phase, 'over');
  assertOrder(rig.ops(), ['stage.settle', 'coach.reset', 'stage.reset', 'stage.phase', 'stage.over', 'coach.beginOver', 'thread.open', 'stage.chips']);
  assert.equal(rig.last('stage.reset').args[1].deal, false);
  const view = rig.stage.model.over;
  assert.deepEqual([view.quiet, view.result, view.reason], [true, 'loss', 'resign']);
  assert.ok(view.proud);
  assert.equal(view.kept, null);
  assert.equal(rig.calls('brain.finishGame').length, 0);
  assert.equal(rig.calls('store.saveProfile').length, 0);
  assert.equal(rig.calls('store.quarantine').length, 0);
  assert.equal(rig.calls('save').length, 0, 'nothing is written');
  assert.equal(rig.last('thread.open').args[1], 'local', 'the card gets its line; no request leaves on reload');
  assert.equal(rig.coach.counters.fetches, 0);
  assert.equal(rig.stage.model.lines.at(-1).target, 'card');
  assert.equal(rig.calls('stage.rival').length, 0, 'no celebration, no last word');
  assert.equal(rig.director.extras().activeMs, saved.activeMs);
  await rig.advance(60000);
  assert.equal(rig.director.extras().activeMs, saved.activeMs, 'the clock of a finished game stands still');
  stop(rig);
});

test('a truncated restore quarantines the raw save before the rewrite', T, async () => {
  const first = await start();
  await play(first, CANNON);
  const good = first.saved();
  stop(first);
  const bad = { ...good, moves: [good.moves[0], '4041', good.moves[1]] };      // a well-formed move from an empty point
  const raw = JSON.stringify(bad);

  const rig = createDirectorRig({ storage: { [KEYS.game]: raw } });
  const loaded = rig.store.load();
  assert.equal(loaded.game.moves.length, 3);
  rig.director.loadExtras(loaded.game);
  const result = rig.session.restore(loaded.game);
  assert.equal(result.truncatedAt, 1);
  await rig.settle();
  assertOrder(rig.ops(), ['store.quarantine', 'stage.settle', 'stage.reset', 'save']);
  assert.deepEqual(rig.last('store.quarantine').args, ['game', 'truncated']);
  const slot = JSON.parse(rig.storage.getItem(KEYS.quarantine));
  assert.deepEqual([slot.kind, slot.why], ['game', 'truncated']);
  assert.equal(slot.raw, raw, 'the raw text, copied before the batch rewrote the save');
  assert.equal(JSON.parse(rig.storage.getItem(KEYS.game)).moves.length, 1, 'rewritten without the bad tail');
  // the extras are cut back to the position the game stands at
  assert.deepEqual(rig.last('memory.rewind').args, [1]);
  assert.deepEqual(rig.director.extras().skill.samples.map((s) => s.ply), [0]);
  assert.equal(rig.state.phase, 'opponentTurn');
  rig.director.notices(loaded.notices, { truncatedAt: result.truncatedAt });
  assert.equal(localTexts(rig).at(-1), STR.saveTruncated(1));
  stop(rig);
});

test('local mode: the same order of effects with source \'local\' and zero fetches', T, async () => {
  /** One scripted stretch of play; returns the names of the stage and thread calls and the sources of the lines. */
  const run = async (mode) => {
    const rig = createDirectorRig();
    if (mode === 'llm') {
      rig.coach.script.llm = 'sync';
      rig.coach.setMode('llm');
    }
    rig.script.assess = (payload) => (same(payload.move, ROOK) ? { cat: 'mistake' } : {});
    const mark = rig.mark();
    rig.session.newGame({ humanColor: 'red' });
    await rig.settle();
    await tryMove(rig, ROOK);
    rig.actions.ask({ code: 'reply' });
    await rig.settle();
    rig.actions.retract();
    await rig.settle();
    rig.actions.hint();
    await rig.settle();
    await tryMove(rig, HORSE);
    await confirm(rig);
    await rig.advance(900);
    rig.actions.ask({ code: 'score' });
    await rig.settle();
    const ops = rig.since(mark).filter((op) => op.startsWith('stage.') || op.startsWith('thread.'));
    const out = { ops, sources: rig.stage.model.lines.map((line) => line.end && line.end.source), fetches: rig.coach.counters.fetches,
                  violations: rig.coach.violations, kinds: rig.stage.model.lines.map((line) => line.kind) };
    stop(rig);
    return out;
  };
  const local = await run('local');
  const llm = await run('llm');
  assert.equal(local.fetches, 0);
  assert.ok(llm.fetches >= 5, 'the same events travel when the proxy is there');
  assert.deepEqual(local.kinds, ['start', 'try', 'ask', 'hint', 'opp', 'ask']);
  assert.ok(local.sources.every((source) => source === 'local'), 'every line is the local narrator\'s');
  assert.ok(llm.sources.every((source) => source === 'llm'));
  assert.equal(local.ops.join(' '), llm.ops.join(' '));
  assert.deepEqual(local.violations, []);
  assert.deepEqual(llm.violations, []);
});

test('active time stops while hidden and at game over', T, async () => {
  const rig = await start();
  const active = () => rig.director.extras().activeMs;
  assert.equal(active(), 0);
  await rig.advance(5000);
  assert.equal(active(), 5000);
  rig.director.visibility(false);
  await rig.advance(7000);
  assert.equal(active(), 5000, 'hidden');
  rig.director.visibility(true);
  await rig.advance(2000);
  assert.equal(active(), 7000);
  await tryMove(rig, ROOK);
  await rig.advance(1000);
  rig.actions.confirm();
  await rig.settle();
  assert.equal(samples(rig)[0].thinkMs, 8000, 'the think time of a move is measured the same way');
  await rig.advance(2000);
  assert.equal(active(), 10000);
  await resign(rig);
  const final = active();
  await rig.advance(9000);
  assert.equal(active(), final, 'game over');
  assert.equal(rig.saved().activeMs, final);
  // an undo out of the finished game starts the clock again
  rig.actions.undo();
  await rig.settle();
  await rig.advance(1000);
  assert.equal(active(), final + 1000);

  // a game that starts on a hidden page does not count until the page shows
  const dark = await start({ hidden: () => true });
  await dark.advance(4000);
  assert.equal(dark.director.extras().activeMs, 0);
  dark.director.visibility(true);
  await dark.advance(500);
  assert.equal(dark.director.extras().activeMs, 500);
  stop(rig);
  stop(dark);
});

// =====================================================================================================================
// The rest of the director's duties
// =====================================================================================================================

test('a new game: the order of E-start and E-turn; the child plays black: the rival opens', T, async () => {
  const rig = createDirectorRig();
  rig.session.newGame({ humanColor: 'red' });
  assertOrder(rig.ops(), ['stage.settle', 'coach.reset', 'stage.reset', 'stage.rival', 'brain.positionFacts', 'stage.phase', 'stage.chips', 'stage.input',
                          'brain.surveyJob', 'brief.buildTurnBrief', 'coach.beginTurn', 'thread.open', 'stage.chips', 'stage.input', 'save']);
  assert.equal(rig.last('stage.reset').args[1].deal, true);
  assert.equal(rig.last('stage.reset').args[0].bottom, 'red');
  assert.ok(STR && rig.calls('stage.rival')[0].args[0].line, 'his opening line');
  const told = rig.calls('stage.phase')[0].args[0];
  assert.deepEqual(told, { phase: 'childTurn', canUndo: false, hintLevel: 0, canAsk: true, failed: false, ply: 0 });
  assert.deepEqual(rig.calls('thread.open')[0].args.slice(0, 2), [{ kind: 'start', first: true }, 'auto']);
  assert.equal(rig.last('store.saveProfile').args[0].introSeen, true);
  const survey = rig.last('brain.surveyJob').args[0];
  assert.deepEqual([survey.ply, survey.history.length, survey.tensionPrev, survey.evalTwoPliesAgo], [0, 0, 0.1, null]);
  await rig.settle();
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['danger', 'score'], 'no rival move and no previous move yet');
  assert.deepEqual(rig.stage.model.input, { visible: false, enabled: true });

  // the second game of the profile is not greeted as the first
  rig.session.newGame({ humanColor: 'red' });
  assert.deepEqual(rig.last('thread.open').args[0], { kind: 'start', first: false });
  stop(rig);

  const black = await start({}, 'black');
  assert.equal(black.last('stage.reset').args[0].bottom, 'black');
  assert.equal(black.calls('brain.opponentJob').length, 1);
  const job = black.last('brain.opponentJob').args[0];
  assert.deepEqual([job.ply, job.ctx.moveNo, job.ctx.lastChildMove, job.ctx.lastChildCapture], [0, 1, null, false]);
  await black.advance(1600);
  assert.equal(black.state.phase, 'childTurn');
  assert.equal(black.state.history.length, 1);
  assert.equal(black.last('thread.open').args[0].kind, 'opp');
  black.actions.undo();
  assert.equal(black.stage.model.toasts.at(-1), STR.undoOpening);
  stop(black);
});

test('the rival\'s job: the context comes from teachingContext with the child\'s last move; the choice is recorded as returned', T, async () => {
  const rig = await start({ brain: 'manual' });
  await tryMove(rig, CANNON);
  rig.actions.confirm();
  await rig.settle();
  const extra = rig.last('brain.teachingContext').args[0];
  assert.deepEqual(extra, { moveNo: 1, lastChildMove: CANNON, lastChildCapture: false });
  const payload = rig.job('opponent').payload;
  assert.equal(payload.ply, 1);
  assert.equal(payload.history.length, 1, 'the FENs since the last capture, without the position itself');
  assert.equal(payload.ctx.missRun, 0, 'the guard-rail counters travel with the context');
  assert.equal(payload.ctx.lastRival, 0);
  const answer = fakeOpponentTurn(payload, { kind: 'overlook', mode: 'ease', evalAfter: 55, childMoveCp: 20, tension: 0.4 });
  rig.done(answer);
  await rig.settle();
  const [ply, choice] = rig.last('brain.recordOpponentMove').args;
  assert.equal(ply, 1);
  assert.equal(choice.kind, 'overlook');
  const skill = rig.director.extras().skill;
  assert.deepEqual([skill.missRun, skill.lastKind, skill.easeRun], [1, 'overlook', 1]);
  assert.ok(skill.lastRival > 0);
  // his move waits for its think time, counted from the start of his turn
  assert.equal(rig.state.history.length, 1);
  await rig.advance(550);
  assert.equal(rig.state.history.length, 1);
  await rig.advance(400);
  assert.equal(rig.state.history.length, 2);
  assert.equal(rig.last('stage.tension').args[0], 0.4);
  const next = rig.last('brain.surveyJob').args[0];
  assert.deepEqual([next.ply, next.tensionPrev, next.evalTwoPliesAgo], [2, 0.4, null]);

  // a capture by the child is told to the teacher
  stop(rig);
  const taker = await start();
  await play(taker, ROOK);
  await play(taker, ref(7, 1, 0, 1));                                    // 炮八进七: the cannon takes the horse over black's cannon
  assert.equal(taker.state.history[2].move.captured.type, 'horse');
  const second = taker.calls('brain.teachingContext')[1].args[0];
  assert.deepEqual([second.moveNo, second.lastChildCapture, same(second.lastChildMove, ref(7, 1, 0, 1))], [2, true, true]);
  assert.equal(taker.last('stage.committed').args[0].view.trophies.mine.length, 1);
  stop(taker);
});

test('tapping another own piece during a trial arrives as two batches and is told in order', T, async () => {
  const rig = await start();
  await tryMove(rig, ROOK);
  const mark = rig.mark();
  rig.actions.tap(9, 7, 'tap');                                          // another own piece that can move
  await rig.settle();
  const ops = rig.since(mark);
  assertOrder(ops, ['thread.retract', 'stage.retracted', 'stage.chips', 'stage.announce', 'stage.phase', 'stage.selected', 'stage.phase']);
  assert.equal(ops.filter((op) => op === 'stage.selected').length, 1, 'the selection of the retract batch is told through retracted()');
  assert.deepEqual(rig.last('stage.retracted').args[0], { reselect: false, targets: [], forbidden: [] });
  assert.deepEqual(rig.last('stage.selected').args[0], sq(9, 7));
  assert.equal(rig.state.phase, 'selected');
  assert.equal(rig.stage.model.trial, null);
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['danger', 'score']);

  // the origin square takes the trial back and keeps the piece in hand
  rig.actions.tap(9, 8, 'tap');
  rig.actions.tap(8, 8, 'tap');
  await rig.settle();
  rig.actions.tap(9, 8, 'tap');
  await rig.settle();
  assert.equal(rig.last('stage.retracted').args[0].reselect, true);
  assert.equal(rig.last('stage.retracted').args[0].targets.length > 0, true);
  assert.equal(rig.state.phase, 'selected');
  // a second tap on the destination confirms
  rig.actions.tap(8, 8, 'tap');
  rig.actions.tap(8, 8, 'tap');
  await rig.settle();
  assert.equal(rig.state.history.length, 1);
  stop(rig);
});

test('restore: child to move, rival to move', T, async () => {
  const first = await start();
  first.script.assess = () => ({ cat: 'mistake' });
  await play(first, ROOK);
  await first.advance(4000);
  const childToMove = first.saved();
  await tryMove(first, HORSE);                                           // a trial is never persisted
  first.actions.confirm();
  const rivalToMove = first.saved();
  assert.equal(rivalToMove.moves.length, 3);
  const skillText = JSON.stringify(childToMove.skill);
  stop(first);

  const rig = createDirectorRig();
  rig.coach.setMode('llm');
  rig.director.loadExtras(childToMove);
  rig.session.restore(childToMove);
  await rig.settle();
  assertOrder(rig.ops(), ['brain.reviveGameSkill', 'brain.rewindGameSkill', 'memory.rewind', 'stage.settle', 'coach.reset', 'stage.reset', 'stage.notation',
                          'brain.positionFacts', 'stage.phase', 'brain.surveyJob', 'brief.buildTurnBrief', 'coach.beginTurn', 'stage.coachLocal', 'thread.open',
                          'stage.chips']);
  assert.equal(rig.last('stage.reset').args[1].deal, false);
  assert.deepEqual(rig.last('stage.notation').args[1], 2, 'current = plies played');
  assert.equal(localTexts(rig).at(-1), STR.welcomeBack);
  const turn = rig.last('coach.beginTurn').args[0];
  assert.deepEqual([turn.ply, turn.back], [2, 'reload']);
  assert.equal(turn.mine.cat, 'mistake', 'the memory came back with the save');
  assert.ok(turn.opp, 'the rival\'s last move is rebuilt from the history');
  const report = rig.last('brief.buildTurnBrief').args[0];
  assert.equal(report.lastOpp.choice, null);
  assert.equal(report.prev.move.notation, '车一进一');
  assert.deepEqual(rig.last('thread.open').args.slice(0, 2), [{ kind: 'opp' }, 'silent']);
  assert.equal(rig.coach.counters.fetches, 0, 'no request on reload');
  assert.equal(JSON.stringify(rig.director.extras().skill), skillText);
  assert.equal(rig.director.extras().seed, childToMove.seed);
  assert.equal(rig.director.extras().activeMs, childToMove.activeMs);
  assert.equal(rig.calls('save').length, 0);
  stop(rig);

  const other = createDirectorRig();
  other.director.loadExtras(rivalToMove);
  other.session.restore(rivalToMove);
  assertOrder(other.ops(), ['stage.reset', 'stage.coachLocal', 'stage.phase', 'stage.rival', 'brain.opponentJob']);
  assert.equal(localTexts(other).at(-1), STR.welcomeBackRival);
  assert.equal(other.state.phase, 'opponentTurn');
  await other.settle();
  await other.advance(1600);
  assert.equal(other.state.history.length, 4);
  assert.equal(other.state.phase, 'childTurn');
  // the sample of the child's last move was saved with the game: it is not recorded again
  assert.equal(other.calls('brain.recordChildMove').length, 0);
  assert.deepEqual(other.director.extras().skill.samples.map((s) => s.ply), [0, 2]);
  stop(other);

  // restore without a moves array is a programmer error and is not hidden
  const broken = createDirectorRig();
  assert.throws(() => broken.session.restore({}), TypeError);
  stop(broken);
});

test('a late coach reply after an undo and after a new game reaches nothing', T, async () => {
  const rig = await start();
  rig.coach.setMode('llm');
  await play(rig, ROOK);
  const opp = rig.coach.replies.at(-1);
  assert.ok(opp && opp.kind === 'opp', 'the sentence about the rival\'s move is on its way');
  opp.push('对方');
  let mark = rig.mark();
  rig.actions.undo();
  await rig.settle();
  opp.push('出车了。');
  opp.finish();
  await rig.settle();
  let after = rig.since(mark);
  assert.equal(after.includes('stage.coachSegment'), false);
  assert.equal(after.includes('stage.coachEnd'), false);
  assert.equal(after.includes('memory.noteTaught'), false);

  await tryMove(rig, HORSE);
  rig.actions.ask({ code: 'good' });
  await rig.settle();
  const ask = rig.coach.replies.at(-1);
  assert.ok(ask && ask.kind === 'ask');
  mark = rig.mark();
  rig.stage.script.dialog['new-game'] = { humanColor: 'red' };
  rig.actions.newGame();
  await rig.settle();
  ask.push('好棋。');
  ask.finish();
  await rig.settle();
  after = rig.since(mark);
  assert.equal(after.includes('stage.coachSegment') && rig.stage.model.lines.at(-1).kind === 'ask', false);
  assert.equal(rig.stage.model.lines.at(-1).kind, 'start', 'only the new game speaks');

  // Even a client that called its handlers after the abort would reach nothing: the gate of the reply's task is closed.
  const segments = rig.calls('stage.coachSegment').length;
  const ends = rig.calls('stage.coachEnd').length;
  opp.rogue('迟到的一句。');
  ask.rogue('又迟到一句。');
  await rig.settle();
  assert.equal(rig.calls('stage.coachSegment').length, segments);
  assert.equal(rig.calls('stage.coachEnd').length, ends);
  assert.equal(rig.calls('stage.coachTool').length, 0);
  assert.equal(rig.calls('stage.coachReset').length, 0);
  assert.deepEqual(rig.stage.model.faults, []);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('a question about the trial is held until its try event is in the thread; no try, no question', T, async () => {
  const rig = await start({ brain: 'manual' });
  answerSurvey(rig, { depth: 4 });
  await rig.settle();
  await tryMove(rig, ROOK);
  rig.actions.ask({ code: 'reply' });                                    // the chips are up, the assessment is not in yet
  await rig.settle();
  assert.equal(rig.calls('thread.ask').length, 0);
  assert.equal(rig.calls('stage.childSaid').length, 0);
  answerAssess(rig, {});
  await rig.settle();
  assertOrder(rig.ops(), ['thread.tryMove', 'stage.preview', 'stage.childSaid', 'thread.ask']);
  assert.deepEqual(rig.coach.violations, []);

  // the trial was taken back before its assessment: the question is dropped
  rig.actions.retract();
  await rig.settle();
  await tryMove(rig, HORSE);
  await rig.advance(900);
  rig.actions.ask({ code: 'good' });
  rig.actions.retract();
  await rig.settle();
  assert.equal(rig.calls('thread.ask').length, 1);
  // without a trial on the board such a question is not asked at all
  await rig.advance(900);
  rig.actions.ask({ code: 'better' });
  assert.equal(rig.calls('thread.ask').length, 1);
  // other questions go to the thread
  rig.actions.ask({ code: 'score' });
  assert.equal(rig.last('thread.ask').args[0].ask, 'score');
  assert.equal(rig.last('thread.ask').args[2].signal instanceof AbortSignal, true);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('typed questions: 1 to 120 characters; the input follows the mode, the proxy\'s capability and the setting', T, async () => {
  const rig = await start();
  assert.deepEqual(rig.stage.model.input, { visible: false, enabled: true });
  assert.deepEqual(rig.stage.model.coachMode, { mode: 'local', reason: 'no_proxy' });
  rig.coach.setMode('llm', null, true);
  assert.deepEqual(rig.stage.model.coachMode, { mode: 'llm', reason: null });
  assert.deepEqual(rig.stage.model.input, { visible: true, enabled: true });
  rig.coach.script.llm = 'sync';

  rig.actions.ask({ text: '   ' });
  rig.actions.ask({ text: '字'.repeat(121) });
  assert.equal(rig.calls('thread.ask').length, 0);
  rig.actions.ask({ text: '  我的马安全吗？ ' });
  assert.deepEqual(rig.last('thread.ask').args[0], { kind: 'ask', ask: 'free', say: '我的马安全吗？' });
  assert.equal(rig.last('stage.childSaid').args[0], '我的马安全吗？');
  await rig.advance(900);
  rig.actions.ask({ text: '😀'.repeat(120) });                           // code points, not UTF-16 units
  assert.equal(rig.calls('thread.ask').length, 2);

  // the setting switches the input off; the coach setting is followed by a probe
  const probes = rig.coach.counters.probes;
  rig.actions.setting('freeText', false);
  assert.equal(rig.last('stage.applySettings').args[0].freeText, false);
  assert.deepEqual(rig.stage.model.input, { visible: false, enabled: true });
  assert.equal(rig.coach.counters.probes, probes);
  rig.actions.setting('coach', 'local');
  assert.equal(rig.coach.counters.probes, probes + 1);
  assert.equal(JSON.parse(rig.storage.getItem(KEYS.settings)).coach, 'local');
  rig.actions.setting('freeText', true);
  assert.deepEqual(rig.stage.model.input, { visible: true, enabled: true });
  // a mute tap arrives as two settings; the stage is told through applySettings
  rig.actions.setting('sfx', false);
  rig.actions.setting('music', false);
  assert.deepEqual([rig.last('stage.applySettings').args[0].sfx, rig.last('stage.applySettings').args[0].music], [false, false]);
  // talk: 'more' is read live
  rig.actions.setting('talk', 'more');
  await tryMove(rig, ROOK);
  assert.equal(rig.last('thread.tryMove').args[1], 'auto');
  // during the rival's turn the input is disabled
  rig.actions.confirm();
  assert.deepEqual(rig.stage.model.input, { visible: true, enabled: false });
  stop(rig);
});

test('chips: a chip is offered only when its directive has data; the first labels are built from facts', T, async () => {
  const rig = await start();
  assert.deepEqual(chipIds(rig), ['danger', 'score']);
  rig.script.assess = () => null;                                        // the assessment never arrives: the move has no packet
  await play(rig, ROOK);
  const chips = rig.stage.model.chips;
  assert.deepEqual(chips.map((c) => c.ask), ['intent', 'danger', 'score'], 'no packet of the previous move: no "last" chip');
  assert.equal(chips[0].label, '他的车想干什么？');
  assert.equal(chips[1].label, '我有危险吗？');

  // a previous move that got a packet with a comment, and a hanging piece
  rig.script.assess = () => ({ cat: 'mistake' });
  rig.brain.script.hanging = (fen) => {
    const piece = { type: 'horse', color: 'red', at: sq(9, 1), label: '马', name: '马' };
    const by = { type: 'cannon', color: 'black', at: sq(2, 1), label: '炮', name: '炮' };
    return [{ piece, by, capture: { from: by.at, to: piece.at, notation: '炮2进7', piece: 'cannon', color: 'black', captured: 'horse' }, gain: 400, points: 4, free: true, now: true }];
  };
  await play(rig, HORSE);
  assert.deepEqual(rig.stage.model.chips.map((c) => [c.ask, c.label]),
                   [['intent', '他的马想干什么？'], ['danger', '我的马危险吗？'], ['last', '我上一步怎么样？'], ['score', '现在谁占上风？']]);
  assert.equal(rig.state.history.at(-1).move.piece.type, 'horse', 'his last move was a horse move');

  // intent: the threat's arrow; danger: the pieces and their attackers; last: the child's last move, round the horse's leg
  rig.actions.ask({ code: 'intent' });
  assert.deepEqual(rig.last('stage.arrows').args[0][0], { from: sq(2, 1), to: sq(9, 1), style: 'threat' });
  assert.equal(rig.last('stage.childSaid').args[0], '他的马想干什么？', 'the child said what the chip says');
  await rig.advance(900);
  rig.actions.ask({ code: 'danger' });
  assert.deepEqual(rig.last('stage.highlight').args[0], { pieces: [sq(9, 1), sq(2, 1)] });
  await rig.advance(900);
  rig.actions.ask({ code: 'last' });
  const arrow = rig.last('stage.arrows').args[0][0];
  assert.deepEqual([arrow.style, arrow.pieceType, same(arrow, HORSE)], ['last', 'horse', true]);
  assert.deepEqual(rig.last('stage.arrows').args[1], { group: 'ask' });
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['why', 'score'], 'used chips are not offered again; why follows an answer');
  // the set changes: every chip is back
  await tryMove(rig, PAWN);
  rig.actions.retract();
  await rig.settle();
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['intent', 'danger', 'last', 'score']);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('questions after the game: the over chips, then why; nothing before the card is up', T, async () => {
  const rig = await start();
  rig.script.assess = (payload) => (same(payload.move, CANNON) ? { cat: 'best', loss: 0 } : same(payload.move, ROOK) ? { cat: 'blunder', danger: 'unguards' } : {});
  await play(rig, CANNON);
  await tryMove(rig, ROOK);                                              // a slip that was taken back for a sound move: the lesson has a better move
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(ROOK.from.row, ROOK.from.col, 'tap');
  await play(rig, HORSE);
  rig.stage.script.hold = true;                                          // the card takes its time
  rig.actions.resign();
  await rig.settle();
  await rig.settle();
  assert.equal(rig.state.phase, 'over');
  assert.equal(rig.calls('coach.beginOver').length, 0, 'the celebration is still running');
  rig.actions.ask({ code: 'proud' });
  assert.equal(rig.calls('thread.ask').length, 0);
  assert.deepEqual(rig.stage.model.chips, []);
  rig.stage.release();
  await rig.settle();
  rig.stage.release();
  await rig.settle();
  assert.equal(rig.calls('coach.beginOver').length, 1);
  assert.deepEqual(chipIds(rig), ['proud', 'improve', 'next']);
  rig.actions.ask({ code: 'proud' });
  assert.equal(rig.last('thread.ask').args[0].ask, 'proud');
  assert.deepEqual(chipIds(rig), ['why', 'improve', 'next']);
  await rig.advance(900);
  rig.actions.ask({ code: 'why' });
  assert.deepEqual(chipIds(rig), ['improve', 'next']);
  await rig.advance(900);
  rig.actions.ask({ code: 'good' });                                     // not a question of a finished game
  assert.equal(rig.calls('thread.ask').length, 2);
  // a tap on the board of a finished game: one toast per game over
  rig.actions.tap(9, 8, 'tap');
  rig.actions.tap(9, 7, 'tap');
  assert.deepEqual(rig.stage.model.toasts.filter((text) => text === STR.tapOver).length, 1);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('refused taps shake the piece and count; perpetual check and an empty undo get their words', T, async () => {
  const rig = createDirectorRig();
  rig.actions.tap(9, 8, 'tap');                                          // before the first game: refused, and no toast
  rig.actions.undo();
  rig.actions.confirm();
  rig.actions.resign();
  assert.deepEqual(rig.stage.model.toasts, []);
  assert.equal(rig.calls('stage.phase').length, 0, 'the boot state is not a phase of a game');
  rig.session.newGame({ humanColor: 'red' });
  await rig.settle();
  rig.actions.tap(4, 4, 'tap');
  rig.actions.tap(0, 0, 'tap');
  assert.deepEqual(rig.calls('stage.rejected').slice(-2).map((entry) => entry.args.slice(1)), [['empty', 1], ['not-yours', 2]], 'a new game starts the count');
  rig.actions.tap(9, 8, 'tap');
  rig.actions.tap(5, 5, 'tap');
  assert.deepEqual(rig.last('stage.rejected').args.slice(1), ['not-a-target', 1], 'a success in between starts the count again');
  rig.actions.undo();
  assert.equal(rig.stage.model.toasts.at(-1), STR.undoNone);
  // non-integer coordinates never reach the session
  rig.actions.tap(1.5, 2, 'tap');
  rig.actions.tap(NaN, 2, 'tap');
  assert.equal(rig.calls('stage.rejected').length, 4);
  stop(rig);
});

test('move links: an arrow while active; a second tap on a playable link tries the move; a line is ghost-played', T, async () => {
  const rig = await start();
  const link = { from: HORSE.from, to: HORSE.to, color: 'red', code: '9776', pre: [], playable: true, src: 'better' };
  rig.actions.moveLink(link, true);
  assert.deepEqual(rig.last('stage.arrows').args, [[{ from: HORSE.from, to: HORSE.to, style: 'idea', badge: undefined }], { group: 'chat' }]);
  rig.actions.moveLink({ ...link, color: 'black', pre: [ROOK, HORSE].map((m) => ({ ...m, color: 'red' })) }, true);
  assert.deepEqual([rig.last('stage.arrows').args[0][0].style, rig.last('stage.arrows').args[0][0].badge], ['threat', '3']);
  rig.actions.moveLink(link, false);
  await rig.settle();
  assert.deepEqual(rig.last('stage.clearArrows').args, ['chat']);
  assert.equal(rig.state.phase, 'tentative');
  assert.equal(same(rig.state.trial.move, HORSE), true);

  // a run that does not start its line: the moves before it are prepended
  rig.actions.retract();
  await rig.settle();
  const second = { from: sq(0, 1), to: sq(2, 2), color: 'black', code: '0122', pre: [{ ...HORSE, color: 'red' }], playable: false, src: 'better' };
  rig.actions.playLine([second]);
  const [moves, opts] = rig.last('stage.preview').args;
  assert.equal(opts.from, 'now');
  assert.deepEqual(moves.map((m) => [m.piece.color, m.piece.type]), [['red', 'horse'], ['black', 'horse']]);
  // a reply line starts from the trial; without a trial there is nothing to play it on
  const previews = rig.calls('stage.preview').length;
  rig.actions.playLine([{ ...second, pre: [], src: 'reply' }]);
  assert.equal(rig.calls('stage.preview').length, previews);
  stop(rig);
});

test('notices, backup import, and a save that fails after boot', T, async () => {
  const rig = await start();
  rig.director.notices(['storage-unavailable', 'game-corrupt', 'migrated-v1', 'imported'], { truncatedAt: null });
  assert.deepEqual(rig.stage.model.toasts, [STR.storageOff]);
  assert.deepEqual(localTexts(rig).slice(-3), [STR.saveCorrupt, STR.migrated, STR.imported]);
  rig.director.notices(['game-newer', 'migrated-v1-local', 'storage-unavailable'], { truncatedAt: 7 });
  assert.deepEqual(localTexts(rig).slice(-3), [STR.saveNewer, STR.migratedLocal, STR.saveTruncated(7)]);
  assert.deepEqual(rig.stage.model.toasts, [STR.storageOff], 'once');

  rig.actions.importBackup('not json');
  assert.equal(rig.stage.model.toasts.at(-1), STR.importFailed);
  assert.equal(rig.reloads(), 0);
  const backup = JSON.stringify(rig.store.exportBackup());
  rig.storage.failSet = true;
  rig.actions.importBackup(backup);
  assert.equal(rig.stage.model.toasts.at(-1), STR.importFull);
  rig.storage.failSet = false;
  rig.actions.importBackup(backup);
  assert.equal(rig.reloads(), 1);
  stop(rig);

  // storage that stops working in mid-game is told once, when the first save fails
  const full = await start();
  assert.deepEqual(full.stage.model.toasts, []);
  full.storage.failSet = true;
  await play(full, ROOK);
  assert.deepEqual(full.stage.model.toasts, [STR.storageOff]);
  stop(full);
});

test('budgets: two ignored questions say the own-way line once; a punished child sees 司马懿 rattled only when he is punished', T, async () => {
  const rig = await start();
  // a move that allows a mate is always voiced, whatever the budget says; the child confirms through two such questions
  rig.script.assess = () => ({ cat: 'blunder', lose: 'rook', loss: 900, flags: { allowsMate: true } });
  rig.script.opponent = (payload) => ({ facts: { capture: { piece: fakeAssessed({ fen: payload.fen, move: fakeOpponentTurn(payload, {}).move, compare: null }, {}).facts.move, see: 400, exchange: 'wins', free: true, recapture: null } } });
  await tryMove(rig, ROOK);
  assert.equal(rig.last('thread.tryMove').args[1], 'local');
  assert.equal(rig.last('thread.tryMove').args[0].try.eval.mate, -1);
  await confirm(rig);
  assert.equal(localTexts(rig).includes(STR.ownWay), false);
  await tryMove(rig, HORSE);
  assert.equal(rig.last('thread.tryMove').args[1], 'local', 'voiced again one move later: a mate is always voiced');
  const mark = rig.mark();
  rig.actions.confirm();
  await rig.settle();
  assert.equal(localTexts(rig).filter((text) => text === STR.ownWay).length, 1, 'the second ignored question');
  assertOrder(rig.since(mark), ['thread.end', 'stage.coachLocal', 'stage.committed'], 'told in the same run, just before the commit');
  await rig.advance(1600);
  // a held trial that is taken back ends the run of ignored questions; an ordinary retract does not touch it
  await tryMove(rig, PAWN);
  rig.actions.retract();
  await rig.settle();
  // the rival's tactic landed on a child's blunder: he is never smug then, and never rattled
  assert.equal(rig.calls('stage.rival').some((entry) => entry.args[0].mood === 'smug'), false);
  assert.equal(rig.calls('stage.rival').some((entry) => entry.args[0].mood === 'rattled'), false);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);

  // his own tactic, on a sound move of the child: smug is allowed
  const calm = await start();
  calm.script.opponent = (payload) => ({ facts: { fork: { by: null, targets: [], withCheck: false } } });
  await play(calm, ROOK);
  const moved = calm.calls('stage.rival').map((entry) => entry.args[0].mood);
  assert.deepEqual(moved, ['calm', 'thinking', 'smug']);
  stop(calm);

  // an earned tactic: the popup, the mark and a rattled rival, in this order of calls
  const good = await start();
  good.script.assess = () => ({ cat: 'best', loss: 0, flags: { onlyMove: true }, facts: { fork: { by: null, targets: [], withCheck: false } } });
  good.script.survey = () => ({ depth: 5, best: CANNON, bestScore: 80, test: { tier: 1, kind: 'win', group: [{ ...CANNON, notation: '炮二平五', piece: 'cannon', color: 'red', captured: null }] } });
  good.session.newGame({ humanColor: 'red' });
  await good.settle();
  await tryMove(good, CANNON);
  const flags = good.last('thread.tryMove').args[2].flags;
  assert.deepEqual(flags, { earned: true, voiced: false, lord: true }, 'found at once, with no pouch');
  assert.equal(good.stage.model.lines.at(-1).cue, '主公英明！');
  const from = good.mark();
  good.actions.confirm();
  await good.settle();
  const committed = good.last('stage.committed').args[0];
  assert.deepEqual([committed.cat, committed.praise.tier, committed.praise.streak, committed.self, committed.fromTrial], ['best', 'lord', 1, true, true]);
  const ops = good.since(from);
  assertOrder(ops, ['thread.end', 'brain.recordChildMove', 'memory.noteMine', 'stage.committed', 'stage.rival', 'stage.notation', 'stage.announce', 'stage.phase',
                    'stage.rival', 'brain.teachingContext', 'brain.opponentJob']);
  const moods = good.calls('stage.rival').slice(-2).map((entry) => entry.args[0].mood);
  assert.deepEqual(moods, ['rattled', 'thinking'], 'punished right after committed, then thinking');
  const sample = samples(good).at(-1);
  assert.deepEqual([sample.test.found, sample.self, sample.hint, sample.hintMax, sample.tries, sample.bestCp, sample.legalCount > 30], [true, true, 0, 0, 1, 80, true]);
  stop(good);
});

test('the sample: first try and confirmed move, pouches, habit and avoided', T, async () => {
  const base = createDirectorRig();
  const loaded = base.store.load().profile;
  const profile = { ...loaded, skill: { ...loaded.skill, habits: { greedy: 2, hang_piece: 1.5 } } };
  stop(base);
  const rig = await start({ profile });
  rig.script.survey = () => ({ depth: 5, traps: ['greedy'] });
  rig.session.newGame({ humanColor: 'red' });
  await rig.settle();
  rig.script.assess = (payload) => (same(payload.move, ROOK) ? { cat: 'blunder', danger: 'hangs_moved_piece', loss: 700 } : { cat: 'good', loss: 20 });
  await tryMove(rig, ROOK);                                              // the first idea: a slip that matches a known habit
  assert.equal(rig.last('brief.buildTryPacket').args[1].habit, 'hang_piece');
  assert.equal(rig.last('brief.buildTryPacket').args[1].avoided, null);
  assert.deepEqual(rig.last('memory.noteHabit').args, ['hang_piece'], 'mentioned: not sent again this game');
  rig.actions.retract();
  await rig.settle();
  rig.actions.hint();
  rig.actions.hint();
  await rig.settle();
  rig.actions.tap(ROOK.from.row, ROOK.from.col, 'tap');
  await tryMove(rig, HORSE);
  const ctx = rig.last('brief.buildTryPacket').args[1];
  assert.deepEqual([ctx.self, ctx.habit, ctx.avoided, ctx.prev.move], [false, null, null, '车一进一'], 'two pouches were opened; the first try fell into the trap');
  await confirm(rig);
  const sample = samples(rig)[0];
  assert.deepEqual([sample.first.move.notation, sample.first.loss, sample.first.cat], ['车一进一', 600, 'blunder'], 'the first try, its loss capped');
  assert.deepEqual([sample.final.move.notation, sample.final.loss, sample.final.cat], ['马二进三', 20, 'good']);
  assert.deepEqual([sample.tries, sample.hint, sample.hintMax, sample.self, sample.danger, sample.habit, sample.avoided],
                   [2, 0, 2, false, 'hangs_moved_piece', 'hang_piece', null]);
  // the same slip again: the habit is not sent a second time
  rig.script.assess = () => ({ cat: 'blunder', danger: 'unguards' });
  await tryMove(rig, PAWN);
  assert.equal(rig.last('brief.buildTryPacket').args[1].habit, null);
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(PAWN.from.row, PAWN.from.col, 'tap');

  // a trap of a known habit that the child steps around: said once when the move is played
  rig.script.assess = () => ({ cat: 'good', loss: 10 });
  await play(rig, ref(7, 1, 7, 4));                                      // 炮八平五
  const second = samples(rig)[1];
  assert.equal(second.avoided, null, 'the first try of this turn was a slip');
  await play(rig, ref(9, 0, 8, 0));
  const third = samples(rig)[2];
  assert.equal(third.avoided, 'greedy');
  assert.equal(localTexts(rig).filter((text) => text === STR.avoided.greedy).length, 1);
  await play(rig, ref(8, 0, 9, 0));
  assert.equal(samples(rig)[3].avoided, 'greedy');
  assert.equal(localTexts(rig).filter((text) => text === STR.avoided.greedy).length, 1, 'a habit is mentioned once per game');
  stop(rig);
});

test('the director\'s score arithmetic is scoreToCp of the search', T, async () => {
  for (const score of [0, 37, -412, 1900, 1901, 2500, -2500, 29799, 29800, 29990, -29800, -30000]) {
    const rig = await start({ brain: 'manual' });
    table(rig, { depth: 4, scoreOf: (move) => (same(move, CANNON) ? score : score - 10) });
    await tryMove(rig, CANNON);
    rig.actions.confirm();
    await rig.settle();
    assert.equal(samples(rig)[0].bestCp, scoreToCp(score), `score ${score}`);
    stop(rig);
  }
});

test('idle: the pouch is offered after 90 s, at most twice a game, not with a piece in hand, not after a decline', T, async () => {
  const rig = await start();
  await rig.advance(89000);
  assert.equal(localTexts(rig).includes(STR.idleOffer), false);
  await rig.advance(1500);
  assert.equal(localTexts(rig).filter((text) => text === STR.idleOffer).length, 1);
  await rig.advance(200000);
  assert.equal(localTexts(rig).filter((text) => text === STR.idleOffer).length, 1, 'once per position');
  // the child moves without opening a pouch: declined, no further offer this game
  await play(rig, ROOK);
  await rig.advance(100000);
  assert.equal(localTexts(rig).filter((text) => text === STR.idleOffer).length, 1);
  stop(rig);

  const hand = await start();
  hand.actions.tap(9, 8, 'tap');
  await hand.advance(95000);
  assert.equal(localTexts(hand).includes(STR.idleOffer), false, 'never with a piece selected');
  stop(hand);
});

test('ports: the job specs follow the plan row; the coach port reads forceLocal live', T, async () => {
  const { createBrainPort, createCoachPort } = await import('../../../src/game/ports.js');
  const brain = createBrainPort();
  const timeouts = () => [brain.surveyJob({}).timeoutMs, brain.assessJob({}).timeoutMs, brain.opponentJob({}).timeoutMs];
  assert.deepEqual(timeouts(), [2 * 1500 + 500, 2 * 400 + 500, 2 * (700 + 350) + 500], 'mid until the worker is ready');
  brain.setSpeed('fast');
  assert.deepEqual(timeouts(), [2 * 1200 + 500, 2 * 300 + 500, 2 * (500 + 250) + 500]);
  brain.setSpeed('slow');
  assert.deepEqual(timeouts(), [2 * 1800 + 500, 2 * 600 + 500, 2 * (900 + 450) + 500]);
  const spec = brain.assessJob({ fen: 'x' });
  assert.deepEqual([spec.kind, spec.payload.fen, 'lifetime' in spec], ['assess', 'x', false]);
  assert.equal(brain.boardToFen(createDirectorRig().state.board, 'red'), 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w');
  const skill = brain.createGameSkill(7);
  assert.deepEqual([skill.seed, skill.samples.length], [7, 0]);

  const rig = createDirectorRig();
  const deps = { apiBase: null, forceLocal: false, tasks: rig.tasks, brain, getSession: () => rig.state };
  const coach = createCoachPort(deps);
  assert.deepEqual([coach.mode(), coach.offReason(), coach.capabilities().freeText], ['local', 'no_proxy', false]);
  deps.forceLocal = true;
  assert.equal(coach.offReason(), 'setting', 'the setting is read from the live deps object');
  assert.equal(typeof coach.brief.buildTurnBrief, 'function');
  assert.equal(typeof coach.brief.chanceAreaWord, 'function');
  const book = coach.createMoveBook({ board: rig.state.board, turn: 'red' });
  assert.deepEqual(coach.parse('好。', book), [{ type: 'text', text: '好。' }]);
  assert.deepEqual(coach.createGameMemory(null).snapshot(), { moments: [], taught: [], mine: null });
  stop(rig);
});

// A position one move before a mate (the fixture v2-one-before-mate): red mates with 5154; mirrored, black mates with 4744.
const MATE_FOR_RED = ['7774', '0010', '7434', '1000', '7151', '0010'];
const MATE_FOR_BLACK = ['9888', '2124', '8898', '2464', '9888', '2747', '8898'];
const savedGame = (moves, extra = {}) => ({ schema: 2, id: 'g-matetest01', humanColor: 'red', moves, result: null, startedAt: 1, endedAt: null, activeMs: 0,
                                            counted: false, drawFrom: 0, seed: 7, skill: null, memory: null, start: null, ...extra });

test('司马懿 never gloats: the move that ends the game carries no line of his; his last word follows the card', T, async () => {
  // he mates
  const rig = createDirectorRig();
  rig.script.opponent = () => ({ move: ref(4, 7, 4, 4), facts: { fork: { by: null, targets: [], withCheck: true } } });      // his tactic landed, with check
  const saved = savedGame(MATE_FOR_BLACK);
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await rig.advance(1600);
  await rig.settle();
  assert.equal(rig.state.phase, 'over');
  assert.deepEqual([rig.state.result.reason, rig.state.result.winner], ['checkmate', 'black']);
  const calls = rig.calls('stage.rival').map((entry) => entry.args[0]);
  assert.deepEqual(Object.keys(calls.at(-2)), ['mood'], 'the mating move: his mood only, no line');
  // ... and that mood is calm, although a tactic of his landed with it and the child's move before was no slip (`smug` by 4.22)
  assert.equal(calls.at(-2).mood, 'calm', 'he does not smirk at his own win');
  // the top bar: eight plies were played, the last of them in round 4; round 5 will never be played
  assert.equal(rig.last('stage.rivalMoved').args[0].view.round, 4);
  assert.equal(rig.stage.model.over.stats.rounds, 4);
  assert.ok(['承让。', '承让，改日再战。'].includes(calls.at(-1).line), 'the over line');
  assertOrder(rig.ops(), ['stage.rivalMoved', 'stage.rival', 'stage.phase', 'brain.finishGame', 'stage.over', 'stage.rival', 'coach.beginOver', 'thread.open']);
  const view = rig.stage.model.over;
  assert.deepEqual([view.result, view.reason, view.byChildMate, view.quiet], ['loss', 'checkmate', false, false]);
  assert.equal(rig.last('stage.rivalMoved').args[0].flags.mate, true);
  assert.equal(rig.last('stage.phase').args[0].phase, 'over');
  assert.equal(rig.stage.model.lines.at(-1).cue, '惜哉……');
  stop(rig);

  // the child mates: a mated rival does not say "不慌。"; he concedes after the card
  const win = createDirectorRig();
  const start = savedGame(MATE_FOR_RED);
  win.director.loadExtras(start);
  win.session.restore(start);
  await win.settle();
  await tryMove(win, ref(5, 1, 5, 4));
  win.actions.confirm();
  await win.settle();
  await win.settle();
  assert.equal(win.state.phase, 'over');
  const committed = win.last('stage.committed').args[0];
  assert.equal(committed.flags.mate, true);
  assert.equal(committed.view.round, 4, 'seven plies: the child mated in round 4');
  assert.equal(win.stage.model.over.stats.rounds, 4);
  const reactions = win.calls('stage.rival').map((entry) => entry.args[0]);
  assert.deepEqual(Object.keys(reactions.at(-2)), ['mood']);
  assert.ok(['此局是我输了。', '心服口服。', '来日再战。'].includes(reactions.at(-1).line));
  const card = win.stage.model.over;
  assert.deepEqual([card.result, card.reason, card.byChildMate], ['win', 'checkmate', true]);
  assert.equal(win.calls('brain.opponentJob').length, 0, 'no rival job after the mate');
  assert.equal(win.last('store.saveProfile').args[0].games.won, 1);
  assert.equal(win.stage.model.lines.at(-1).cue, '大捷！');

  // reload of that finished game: recomputed by replay, shown quietly, counted already
  const again = createDirectorRig({ profile: win.last('store.saveProfile').args[0] });
  const finished = win.saved();
  assert.deepEqual([finished.result, finished.counted, finished.moves.length], [null, true, 7], 'a natural result is not stored');
  again.director.loadExtras(finished);
  again.session.restore(finished);
  await again.settle();
  await again.settle();
  assert.deepEqual([again.stage.model.over.quiet, again.stage.model.over.result, again.stage.model.over.byChildMate], [true, 'win', true]);
  assert.equal(again.last('stage.reset').args[0].round, 4, 'a finished game that is restored shows its last round too');
  assert.equal(again.calls('brain.finishGame').length, 0);
  assert.equal(again.calls('store.saveProfile').length, 0);
  stop(win);
  stop(again);
});

test('a finished game that was never counted is counted once when it is restored; markCounted right after restore prevents it', T, async () => {
  const first = await start();
  await play(first, ROOK);
  await tryMove(first, HORSE);
  await resign(first);
  // A game that ends is counted in the task of the event that ends it, so no way of leaving the page produces a finished
  // game that is not counted any more. Such a record can still arrive (written by an earlier build, or edited): the flag
  // is taken off by hand.
  const saved = { ...first.saved(), counted: false };
  assert.equal(saved.result.reason, 'resign');
  stop(first);

  const rig = createDirectorRig();
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await rig.settle();
  assert.equal(rig.calls('brain.finishGame').length, 1);
  assert.equal(rig.state.counted, true);
  assert.equal(rig.last('store.saveProfile').args[0].games.lost, 1);
  assert.equal(rig.stage.model.over.quiet, true);
  assert.equal(JSON.parse(rig.storage.getItem(KEYS.game)).counted, true, 'saved through markCounted');
  stop(rig);

  // a migrated v1 game that is over: app.js marks it counted right after the restore, so nothing is counted for it
  const v1 = createDirectorRig();
  v1.director.loadExtras(saved);
  v1.session.restore(saved);
  v1.session.markCounted();
  await v1.settle();
  await v1.settle();
  assert.equal(v1.calls('brain.finishGame').length, 0);
  assert.equal(v1.calls('store.saveProfile').length, 0);
  assert.equal(v1.stage.model.over.quiet, true);
  stop(v1);
});

test('engine dead: jobs fail at once and nothing spins; retryEngine clears the notice and runs the script of the phase again', T, async () => {
  const rig = await start({ brain: 'manual' });
  assert.ok(surveyJob(rig));
  rig.host.failSpawns = 3;
  rig.worker().crash('the worker broke');                                // the survey fails; three spawns fail: the engine is dead
  await rig.advance(2000);
  assert.equal(rig.tasks.stats().dead, true);
  assert.deepEqual(rig.last('stage.blocking').args, [{ kind: 'engine-dead' }]);
  const surveys = rig.calls('brain.surveyJob').length;
  await tryMove(rig, ROOK);                                              // the assess job resolves with an error at once
  await rig.advance(1000);
  assert.equal(verdicts(rig).at(-1).final, false, 'the provisional face stays; nothing is said');
  assert.equal(rig.calls('thread.tryMove').length, 0);
  assert.deepEqual(chipIds(rig), [], 'the chips of a trial that could not be assessed are withdrawn');
  assert.equal(localTexts(rig).length, 0, 'and nothing is said about it');
  assert.equal(rig.calls('brain.surveyJob').length, surveys, 'a failed survey is not started again and again');
  assert.equal(rig.state.phase, 'tentative', 'the child can still play');

  rig.script.assess = () => ({ cat: 'good' });
  rig.actions.retryEngine();
  assert.deepEqual(rig.last('stage.blocking').args, [null]);
  await rig.settle();
  assert.equal(rig.tasks.stats().dead, false);
  assert.deepEqual(chipIds(rig), ['good', 'reply', 'better'], 'the chips are back with the second attempt');
  const job = rig.job('assess');
  assert.ok(job, 'the trial is assessed after all');
  rig.done(fakeAssessed(job.payload, { cat: 'good' }));
  await rig.settle();
  assert.deepEqual([verdicts(rig).at(-1).final, verdicts(rig).at(-1).cat], [true, 'good']);
  assert.equal(rig.calls('thread.tryMove').length, 1);
  assert.ok(surveyJob(rig), 'and the survey of the position runs again');

  // dead while the rival is to move: the failed phase, then the retry control brings him back
  rig.actions.confirm();
  await rig.settle();
  rig.host.failSpawns = 3;
  rig.worker().crash('again');
  await rig.advance(2000);
  assert.equal(rig.state.opponentFailed, true);
  assert.equal(rig.last('stage.phase').args[0].failed, true);
  rig.actions.retryEngine();
  await rig.settle();
  assert.equal(rig.state.opponentFailed, false);
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.history.length, 2);
  stop(rig);
});

test('idle offers: at most twice a game; dispose silences the director', T, async () => {
  const rig = await start();
  const offers = () => localTexts(rig).filter((text) => text === STR.idleOffer).length;
  for (const [round, move] of [[1, ROOK], [2, HORSE], [3, PAWN]]) {
    await rig.advance(91000);
    assert.equal(offers(), Math.min(round, 2), `position ${round}`);
    rig.actions.hint();                                                  // the offer is taken: not a decline
    await rig.settle();
    rig.actions.tap(move.from.row, move.from.col, 'tap');
    rig.actions.tap(move.to.row, move.to.col, 'tap');
    await rig.settle();
    await confirm(rig);
  }
  assert.equal(offers(), 2);

  const mark = rig.mark();
  rig.director.dispose();
  rig.actions.tap(9, 0, 'tap');
  rig.actions.hint();
  rig.actions.ask({ code: 'score' });
  rig.actions.undo();
  rig.actions.newGame();
  rig.coach.setMode('llm');
  rig.director.onEvent({ type: 'child:turn', cause: 'undo' }, rig.state);
  await rig.advance(100000);
  assert.deepEqual(rig.since(mark).filter((op) => op.startsWith('stage.')), []);
  rig.tasks.dispose();
});

test('a mating move that was confirmed before any verdict is still the best move of the game', T, async () => {
  const rig = createDirectorRig({ brain: 'manual' });
  const saved = savedGame(MATE_FOR_RED);
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await tryMove(rig, ref(5, 1, 5, 4));                                   // no table, no assessment: the face is 'pending'
  assert.equal(verdicts(rig).at(-1).cat, 'pending');
  rig.actions.confirm();
  await rig.settle();
  await rig.settle();
  assert.equal(rig.state.phase, 'over');
  assert.equal(samples(rig).length, 1, 'recorded at the commit: nothing is left pending');
  assert.deepEqual([samples(rig)[0].final.cat, samples(rig)[0].final.loss, samples(rig)[0].ply], ['best', 0, 6]);
  const view = rig.stage.model.over;
  assert.deepEqual([view.result, view.byChildMate], ['win', true]);
  assert.ok(view.proud, 'the replay of the mating move');
  assert.equal(same(view.proud.move, ref(5, 1, 5, 4)), true);
  stop(rig);
});

// =====================================================================================================================
// Harder cases: the other colour, the brief that arrives late, replies that end badly, the final position
// =====================================================================================================================

test('a black child: plies, move numbers, the guiding question, the pouch-2 area and the view are the child\'s', T, async () => {
  const rig = await start({}, 'black');
  await rig.advance(1600);
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.last('stage.phase').args[0].ply, 1, 'plies played');
  rig.script.assess = () => ({ cat: 'blunder', lose: 'horse' });
  await tryMove(rig, ref(0, 1, 2, 2));                                   // 马2进3
  assert.equal(rig.last('thread.tryMove').args[1], 'local', 'his first move is move 1: the question is inside the budget');
  const focus = verdicts(rig).at(-1).focus;
  assert.equal(focus.length, 1);
  assert.equal(rig.state.trial.board[focus[0].row][focus[0].col].color, 'red', 'the attacker to tap is a piece of the rival');
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(0, 1, 'tap');
  await rig.settle();

  rig.script.assess = () => ({});
  rig.script.survey = () => ({ depth: 5, best: ref(0, 1, 2, 2), bestScore: 50 });
  rig.session.newGame({ humanColor: 'black' });
  await rig.settle();
  await rig.advance(1600);
  rig.actions.hint();
  rig.actions.hint();
  await rig.settle();
  const area = rig.calls('stage.hint').at(-1).args[1];
  assert.deepEqual(area.pieces, [sq(0, 1)]);
  assert.equal(area.squares.length, 9);
  assert.ok(area.squares.some((s) => s.row === 2 && s.col === 2), 'the area holds the square the move lands on');
  assert.ok(area.squares.every((s) => s.row <= 2 && s.col <= 2), 'black\'s home rows and black\'s right wing, in board coordinates');
  await play(rig, ref(0, 1, 2, 2));
  const committed = rig.last('stage.committed').args[0];
  assert.deepEqual([committed.view.bottom, committed.view.round], ['black', 2]);
  const sample = samples(rig).at(-1);
  assert.deepEqual([sample.ply, sample.hintMax, sample.self], [1, 2, false]);
  assert.equal(rig.last('brain.teachingContext').args[0].moveNo, 2, 'the rival\'s second move');
  assert.deepEqual(rig.last('stage.notation').args[1], 3);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('a trial, its comment and a confirm inside the 400 ms the brief waits behind the rival\'s move', T, async () => {
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
  // the pass search has said nothing yet: the brief of this turn waits, and the child is faster
  const briefs = rig.calls('coach.beginTurn').length;
  const tries = rig.calls('thread.tryMove').length;
  await tryMove(rig, HORSE);
  assert.equal(rig.calls('coach.beginTurn').length, briefs, 'no brief yet');
  assert.deepEqual(rig.stage.model.input, { visible: false, enabled: false });
  answerAssess(rig, { cat: 'mistake' });
  await rig.settle();
  assert.equal(verdicts(rig).at(-1).final, false, 'the provisional face stays until the thread exists');
  assert.equal(rig.calls('thread.tryMove').length, tries, 'the comment waits for the thread');
  await rig.advance(400);
  assert.equal(rig.calls('coach.beginTurn').length, briefs + 1);
  assertOrder(rig.ops().slice(rig.ops().lastIndexOf('coach.beginTurn')), ['coach.beginTurn', 'stage.caption', 'thread.open', 'stage.verdict', 'thread.tryMove']);
  assert.equal(rig.last('brief.buildTurnBrief').args[0].threat, undefined, 'the pass search had not answered');
  assert.deepEqual(rig.stage.model.chips.map((c) => c.ask), ['good', 'reply', 'better', 'why']);
  assert.deepEqual(rig.stage.model.input, { visible: false, enabled: true });

  // a confirm before the brief of the turn was ever built: the game goes on and nothing of that turn arrives later
  rig.actions.confirm();
  await rig.settle();
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1000);
  assert.equal(rig.state.history.length, 4);
  const before = rig.calls('coach.beginTurn').length;
  rig.actions.tap(PAWN.from.row, PAWN.from.col, 'tap');
  rig.actions.tap(PAWN.to.row, PAWN.to.col, 'tap');
  rig.actions.confirm();
  await rig.settle();
  assert.equal(rig.state.phase, 'opponentTurn');
  await rig.advance(600);
  assert.equal(rig.calls('coach.beginTurn').length, before, 'the brief of the turn the child left is never built');
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(2000);
  assert.equal(rig.state.history.length, 6);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('pouches tapped before any table: they wait, then arrive in order; a late pouch never discards a trial', T, async () => {
  const rig = await start({ brain: 'manual' });
  rig.actions.hint();
  rig.actions.hint();
  rig.actions.hint();
  await rig.advance(350);
  assert.ok(localTexts(rig).includes(STR.hintWait), 'said after 300 ms without a table');
  assert.equal(rig.calls('stage.hint').length, 0);
  table(rig, { depth: 4, best: HORSE, bestScore: 50 });
  await rig.settle();
  assert.deepEqual(rig.calls('stage.hint').map((entry) => entry.args[0]), [1, 2, 3]);
  assert.deepEqual(rig.calls('thread.hint').map((entry) => entry.args[0].level), [1, 2, 3]);
  assert.equal(rig.state.phase, 'selected');
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);

  // no table within two seconds: the pouch says so and the child plays on
  const slow = await start({ brain: 'manual' });
  slow.actions.hint();
  await slow.advance(2100);
  assert.deepEqual(localTexts(slow).slice(-2), [STR.hintWait, STR.hintUnavailable]);
  assert.equal(slow.calls('thread.hint').length, 0);
  stop(slow);

  // the pouches wait for the table; the child tries a move meanwhile: the trial stays on the board
  const late = await start({ brain: 'manual' });
  late.actions.hint();
  late.actions.hint();
  late.actions.hint();
  await tryMove(late, ROOK);
  const trialId = late.state.trialId;
  answerAssess(late, {});
  await late.settle();
  assert.ok(surveyJob(late), 'the survey runs again');
  table(late, { depth: 4, best: HORSE, bestScore: 50 });
  await late.settle();
  assert.equal(late.state.phase, 'tentative');
  assert.equal(late.state.trialId, trialId);
  assert.deepEqual(late.coach.violations, []);
  assert.deepEqual(late.stage.model.faults, []);
  stop(late);
});

test('replies that end badly: stopCoach closes the line once; a reply that was withdrawn and ends with nothing leaves no why', T, async () => {
  const rig = await start();
  rig.coach.setMode('llm');
  rig.actions.ask({ code: 'score' });
  const reply = rig.coach.replies.at(-1);
  assert.ok(reply && reply.ask === 'score');
  const line = rig.stage.model.lines.at(-1);
  assert.deepEqual([line.kind, line.text, line.end], ['ask', '', null], 'the dots: the answer is on its way');
  reply.push('现在');
  rig.actions.stopCoach();
  await rig.settle();
  assert.deepEqual(line.end, { reason: 'aborted', source: 'none' });
  reply.push('均势。');
  assert.equal(line.text, '现在');

  await rig.advance(900);
  rig.actions.ask({ code: 'danger' });
  const second = rig.coach.replies.at(-1);
  second.push('有');
  second.reset();                                                        // the request failed before a whole sentence: the text is withdrawn
  second.finish({ source: 'none' });
  await rig.settle();
  const last = rig.stage.model.lines.at(-1);
  assert.deepEqual([last.resets, last.text, last.end.source], [1, '', 'none']);
  assert.equal(rig.stage.model.chips.some((chip) => chip.ask === 'why'), false, 'nothing was said: nothing to ask why about');
  await rig.advance(900);
  rig.actions.ask({ code: 'why' });
  assert.equal(rig.last('thread.ask').args[0].ask, 'danger', 'a why without a sentence before it is never sent');

  // an answer that is empty from the start opens no bubble at all
  rig.coach.setMode('local', 'unreachable');
  rig.coach.script.text = () => '';
  const lines = rig.stage.model.lines.length;
  await rig.advance(900);
  rig.actions.ask({ code: 'score' });
  await rig.settle();
  assert.equal(rig.last('thread.ask').args[0].ask, 'score');
  assert.equal(rig.stage.model.lines.length, lines);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('a question after the game whose reply is still streaming when the child takes the last move back', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'best', loss: 0 });
  await play(rig, CANNON);
  rig.coach.setMode('llm');
  await resign(rig);
  const card = rig.coach.replies.at(-1);
  assert.ok(card && card.kind === 'over');
  card.push('这盘下完了。');
  card.finish();
  await rig.settle();
  rig.actions.ask({ code: 'proud' });
  const reply = rig.coach.replies.at(-1);
  assert.ok(reply && reply.ask === 'proud');
  reply.push('最好的一步');
  const mark = rig.mark();
  rig.actions.undo();
  await rig.settle();
  assert.equal(reply.alive(), false, 'coach.reset() ended it');
  reply.push('是炮。');
  reply.finish();
  await rig.settle();
  assert.equal(rig.since(mark).includes('stage.coachSegment'), false);
  assert.equal(rig.state.phase, 'childTurn');
  assert.ok(chipIds(rig).includes('score'), 'the chips are the turn\'s again');
  assert.deepEqual(rig.stage.model.faults, []);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('the brief of a final position: the rival\'s earlier move is not his answer when the child moved last', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'mistake' });
  await play(rig, ROOK);
  await tryMove(rig, HORSE);
  rig.actions.confirm();
  await rig.settle();
  assert.equal(rig.state.phase, 'opponentTurn');
  rig.actions.resign();                                                  // while the rival thinks
  await rig.settle();
  await rig.settle();
  assert.equal(rig.state.phase, 'over');
  const report = rig.last('brief.buildTurnBrief').args[0];
  assert.equal(report.ply, 3);
  assert.equal(report.prev.move.notation, '马二进三', 'the child\'s last move');
  assert.equal(report.lastOpp, null, 'nothing was played after it');
  const turn = rig.last('coach.beginOver').args[0];
  assert.equal(turn.opp, null);
  assert.equal(turn.mine.move, '马二进三');
  assert.equal(rig.last('coach.beginOver').args[1].base.turn, 'red', 'the book stands on the side of the report');
  const saved = rig.saved();
  stop(rig);

  // the same position after a reload: the same brief
  const again = createDirectorRig();
  again.director.loadExtras(saved);
  again.session.restore(saved);
  await again.settle();
  await again.settle();
  const reloaded = again.last('brief.buildTurnBrief').args[0];
  assert.deepEqual([reloaded.lastOpp, reloaded.prev.move.notation, reloaded.prev.cat], [null, '马二进三', 'mistake']);
  stop(again);

  // a game that ended on the rival's move keeps his move as the last one
  const lost = createDirectorRig();
  lost.script.opponent = () => ({ move: ref(4, 7, 4, 4) });
  const oneBefore = savedGame(MATE_FOR_BLACK);
  lost.director.loadExtras(oneBefore);
  lost.session.restore(oneBefore);
  await lost.settle();
  await lost.advance(1600);
  await lost.settle();
  assert.equal(lost.state.phase, 'over');
  assert.equal(lost.last('brief.buildTurnBrief').args[0].lastOpp.move.notation, lost.state.history.at(-1).notation);
  stop(lost);
});

test('an illegal answer of the rival while the child\'s sample is pending: the sample is recorded once and survives the retry', T, async () => {
  const rig = await start({ brain: 'manual' });
  await tryMove(rig, ROOK);
  rig.actions.confirm();                                                 // no table, no verdict: the sample is pending
  await rig.settle();
  assert.equal(samples(rig).length, 0);
  const job = rig.job('opponent');
  const answer = fakeOpponentTurn(job.payload, { childMoveCp: -40 });
  answer.move = { ...answer.move, from: sq(5, 4), to: sq(5, 5) };        // no piece there
  rig.done(answer);
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.opponentFailed, true);
  assert.equal(samples(rig).length, 1);
  rig.actions.retryOpponent();
  await rig.settle();
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rig.state.history.length, 2);
  assert.equal(samples(rig).length, 1, 'once');
  const skill = rig.director.extras().skill;
  assert.deepEqual(skill.marks.map((mark) => mark.ply), [0, 1]);
  assert.deepEqual(skill.samples.map((s) => s.ply), [0]);
  stop(rig);
});

test('a late survey result of a position the child has left touches nothing; the evaluations feed the next jobs', T, async () => {
  const rig = await start({ brain: 'manual' });
  const first = surveyJob(rig);
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
  const rival = rig.job('opponent').payload;
  assert.deepEqual([rival.ply, rival.tensionPrev, rival.evalTwoPliesAgo], [1, 0.33, null]);
  answerOpponent(rig, { childMoveCp: 10, evalAfter: -25, tension: 0.5 });
  await rig.settle();
  await rig.advance(1600);
  const next = surveyJob(rig).payload;
  assert.deepEqual([next.ply, next.tensionPrev, next.evalTwoPliesAgo], [2, 0.5, 70], 'the child\'s view two plies ago: the survey of ply 0');
  stop(rig);
});

// The tool executor of ports.js (SPEC 4.24) end to end, without a network, a real brain or real time: the real coach port and
// client, a scripted proxy that checks every request the way the real one does (tests/helpers/fake-fetch.js, strict), the task
// manager of the rig on its fake worker; the assess job of a tool call is answered with a fake result.
test('ports: the tool executor parses from the base position, runs one assess job and answers busy, game_over and parse errors', T, async () => {
  const { createBrainPort, createCoachPort } = await import('../../../src/game/ports.js');
  const { createFakeFetch } = await import('../../helpers/fake-fetch.js');
  const { tick } = await import('../../helpers/fake-worker.js');
  /** A bounded wait: promise callbacks and the fake worker run between the checks. */
  const until = async (cond, what) => {
    for (let i = 0; i < 400; i++) {
      if (cond()) return;
      await tick();
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  const realFetch = globalThis.fetch;
  const fake = createFakeFetch();
  globalThis.fetch = fake.fetch;
  const rig = createDirectorRig({ brain: 'manual' });
  try {
    rig.session.newGame({ humanColor: 'red' });
    await rig.settle();
    const coach = createCoachPort({ apiBase: 'http://proxy.test/api', forceLocal: false, tasks: rig.tasks, brain: createBrainPort(), getSession: () => rig.state });
    await coach.probe();
    assert.equal(coach.status(), 'online');

    const turn = { ply: 0, me: 'red', phase: 'opening', check: false, n: 44, back: null, eval: { b: 'even' }, mat: { me: 'R2H2C2P5A2E2', opp: 'R2H2C2P5A2E2', cp: 0 },
                   level: 3, moments: [], taught: [], mine: null, opp: null, threats: [], chance: null, known: { threats: true, chance: false } };
    const book = coach.createMoveBook({ board: rig.state.board, turn: 'red' });
    const thread = coach.beginTurn(turn, book);
    await thread.open({ kind: 'start' }, 'silent', {}).done;

    const TOOL = { id: 'call_1', name: 'analyze_move', input: { notation: '炮2平5', after: ['马二进三'] } };
    const toolLeg = (calls) => (call) => ({ steps: [fake.OPEN, { event: 'tool', data: fake.toolData(call, calls) }] });
    const posts = () => fake.calls.filter((call) => call.method === 'POST');
    const lastResult = () => posts().at(-1).json.resume.results.at(-1);
    const toolIsLive = () => { const live = rig.tasks.liveJob(); return live !== null && live.tool === true; };

    // 1. the texts are parsed from the thread's base position; one assess job on the position reached; the verdict travels
    fake.enqueue(toolLeg([TOOL]), fake.say('【炮2平5】是常见的应法。'));
    let reply = thread.ask('free', '如果我走马二进三，对方走炮2平5呢？', {});
    await until(toolIsLive, 'the tool job');
    assert.deepEqual(rig.tasks.liveJob(), { kind: 'assess', lifetime: 'position', tool: true });
    const p = rig.job('assess').payload;
    assert.deepEqual([p.ply, p.level, p.table, p.compare, p.history], [1, 3, null, null, []], 'plies played before the move; the level of the brief; no table');
    assert.deepEqual(p.move, { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } });
    assert.equal(p.fen, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C4NC1/9/RNBAKAB1R b');
    rig.done(fakeAssessed(p, {}));
    let result = await reply.done;
    assert.equal(result.aborted, false);
    assert.deepEqual(fake.violations, [], 'the proxy accepts the resumed request, verdict included');
    assert.equal(lastResult().ok, true);
    assert.deepEqual([lastResult().verdict.seq, lastResult().verdict.who], [['马二进三', '炮2平5'], 'opp']);
    assert.equal(book.lookup('炮2平5').src, 'tool', 'the analysed line is in the book');
    assert.equal(rig.tasks.liveJob(), null);

    // 2. a UI job is running: busy, and the tool posts no job of its own
    const ui = rig.tasks.job({ kind: 'assess', payload: { fen: p.fen }, lifetime: 'position', timeoutMs: 5000 });
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_2' }]), fake.say('稍后再摆。'));
    await thread.ask('free', '再问一次呢', {}).done;
    assert.deepEqual(lastResult(), { id: 'call_2', ok: false, error: 'busy' });
    assert.deepEqual(rig.tasks.liveJob(), { kind: 'assess', lifetime: 'position', tool: false }, 'the UI job was not superseded');
    ui.cancel();
    await rig.settle();

    // 3. a move that cannot be played: the error carries the index of the text and candidates
    fake.enqueue(toolLeg([{ id: 'call_3', name: 'analyze_move', input: { notation: '车九平五', after: ['马二进三'] } }]), fake.say('那一步走不了。'));
    await thread.ask('free', '那车九平五呢', {}).done;
    assert.deepEqual([lastResult().ok, lastResult().error, lastResult().at], [false, 'no_such_move', 1]);
    assert.ok(lastResult().candidates.length >= 1 && lastResult().candidates.length <= 5);
    assert.equal(rig.tasks.liveJob(), null, 'no job for a line that does not parse');

    // 4. a UI job that arrives while the tool job runs wins: busy
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_4' }]), fake.say('刚才被打断了。'));
    reply = thread.ask('free', '再摆一次', {});
    await until(toolIsLive, 'the tool job');
    const later = rig.tasks.job({ kind: 'assess', payload: { fen: p.fen }, lifetime: 'position', timeoutMs: 5000 });
    await reply.done;
    assert.deepEqual(lastResult(), { id: 'call_4', ok: false, error: 'busy' });
    later.cancel();
    await rig.settle();

    // 5. the reply is aborted while the tool job runs: the job goes with it
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_5' }]));
    reply = thread.ask('free', '最后一次', {});
    await until(toolIsLive, 'the tool job');
    thread.interrupt();
    result = await reply.done;
    await rig.settle();
    assert.equal(result.aborted, true);
    assert.equal(rig.tasks.liveJob(), null);

    // 6. with a trial on the board the job has the lifetime of the trial: taking the move back cancels it
    rig.session.tryMove(HORSE);
    await rig.settle();
    answerAssess(rig, {});                                               // the trial's own assessment
    await rig.settle();
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_6' }]), fake.say('好。'));
    reply = thread.ask('free', '试走的时候问', {});
    await until(toolIsLive, 'the tool job');
    assert.deepEqual(rig.tasks.liveJob(), { kind: 'assess', lifetime: 'trial', tool: true });
    rig.session.retract();
    await reply.done;
    await rig.settle();
    assert.equal(toolIsLive(), false);
    assert.deepEqual(lastResult(), { id: 'call_6', ok: false, error: 'busy' });

    // 7. after the game: game_over without a job; 为什么？ is answered locally and never reaches the proxy
    const overThread = coach.beginOver({ ...turn, ply: 10 }, book);
    const over = { result: 'loss', reason: 'resign', moves: 5, stats: { good: 3, taken: 0, captures: 0, brilliant: 0 }, takeaway: null, proud: null, goal: null, kept: null, rank: null };
    fake.enqueue(fake.say('这盘惜败。'));
    await overThread.open({ kind: 'over', over }, 'auto', {}).done;
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_7' }]), fake.say('棋已经下完了。'));
    await overThread.ask('free', '如果刚才走炮呢', {}).done;
    assert.deepEqual(lastResult(), { id: 'call_7', ok: false, error: 'game_over' });
    const before = posts().length;
    let why = '';
    const answer = await overThread.ask('why', undefined, { onSegment: (seg) => { why += seg.type === 'text' ? seg.text : seg.notation; } }).done;
    assert.equal(posts().length, before, 'no request for 为什么？ after the game');
    assert.deepEqual([answer.aborted, answer.aborted === false && answer.source], [false, 'local']);
    assert.ok(why.length > 0, 'and it is never empty');
    assert.deepEqual(fake.violations, []);
  } finally {
    globalThis.fetch = realFetch;
    stop(rig);
  }
});

test('undo after the rival has answered but before his piece moves: the script stops at its own gate and his move is taken out again', T, async () => {
  const rig = await start({ brain: 'manual' });
  let rivalCalls = 0;
  const opponentMove = rig.session.opponentMove;
  rig.session.opponentMove = (...args) => {                              // every call the director makes for the rival
    rivalCalls += 1;
    return opponentMove(...args);
  };
  answerSurvey(rig, { depth: 4 });
  await rig.settle();
  await tryMove(rig, ROOK);
  answerAssess(rig, {});
  await rig.settle();
  rig.actions.confirm();
  await rig.settle();
  answerOpponent(rig, { kind: 'overlook', evalAfter: 120, tension: 0.6 });
  await rig.settle();
  assert.equal(rig.calls('brain.recordOpponentMove').length, 1, 'his answer is in and recorded');
  assert.equal(rig.state.phase, 'opponentTurn', 'he is still "thinking": the move waits for its think time');
  assert.deepEqual(rig.director.extras().skill.marks.map((m) => m.ply), [0, 1]);

  const mark = rig.mark();
  rig.actions.undo();
  await rig.settle();
  await rig.advance(3000);                                               // the think time passes: the old script must not go on
  assert.equal(rivalCalls, 0, 'the continuation gate stopped the script: the session was never asked to play the stale move');
  assert.equal(rig.state.history.length, 0);
  assert.equal(rig.state.phase, 'childTurn');
  assert.equal(rig.since(mark).includes('stage.rivalMoved'), false);
  const skill = rig.director.extras().skill;
  assert.deepEqual([skill.marks.length, skill.samples.length, skill.lastKind], [0, 0, null], 'his recorded move and the child\'s sample are gone');
  const report = rig.last('brief.buildTurnBrief').args[0];
  assert.deepEqual([report.ply, report.lastOpp, report.prev, report.back], [0, null, null, 'undo']);
  const survey = rig.last('brain.surveyJob').args[0];
  assert.equal(survey.evalTwoPliesAgo, null, 'the evaluations of the undone plies are forgotten');

  // the game goes on from there, and the rival's next answer is played
  await tryMove(rig, HORSE);
  answerAssess(rig, {});
  await rig.settle();
  rig.actions.confirm();
  await rig.settle();
  answerOpponent(rig, {});
  await rig.settle();
  await rig.advance(1600);
  assert.equal(rivalCalls, 1);
  assert.equal(rig.state.history.length, 2);
  assert.deepEqual(rig.director.extras().skill.marks.map((m) => m.ply), [0, 1]);
  stop(rig);
});

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
  assert.equal(rig.last('stage.undone').args[0].view.round, Math.floor(rig.state.history.length / 2) + 1, 'the round of the next move again');
  assert.equal(rig.state.result, null);
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

// =====================================================================================================================
// After the closing review (CONTRACT-NOTES 150): the game flow
// =====================================================================================================================

const storedGames = (rig) => (JSON.parse(rig.storage.getItem(KEYS.profile) ?? 'null') ?? { games: null }).games;
const openLines = (rig) => rig.stage.model.lines.filter((line) => line.end === null).map((line) => `${line.id}:${line.kind}`);
/** A table two plies deeper than the first in which the cannon move is the best by far (the pin moves to it). */
const DEEP = (move) => (same(move, CANNON) ? 80 : same(move, HORSE) ? -220 : same(move, PAWN) ? -230 : -20);

test('a game that ends is counted at once: 再来一局 while the last move still animates keeps the result', T, async () => {
  // the child mates
  const rig = createDirectorRig();
  const saved = savedGame(MATE_FOR_RED);
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await tryMove(rig, ref(5, 1, 5, 4));
  rig.stage.script.hold = true;                                          // the 绝杀 cue of the move is running
  rig.actions.confirm();
  // in the task of the confirm, before anything is awaited
  assert.equal(rig.state.phase, 'over');
  assert.deepEqual(rig.calls('brain.finishGame').map((entry) => entry.args[0]), ['win']);
  assert.equal(rig.state.counted, true);
  assert.deepEqual(storedGames(rig), { played: 1, won: 1, lost: 0, drawn: 0 });
  assert.equal(JSON.parse(rig.storage.getItem(KEYS.game)).counted, true, 'the save of the mating move carries the flag');
  assert.equal(rig.calls('stage.over').length, 0, 'the card waits for the cue of the move');
  await rig.settle();
  const finished = rig.saved();
  const profile = rig.last('store.saveProfile').args[0];
  rig.actions.newGame();                                                 // 再来一局, pressed during the celebration
  await rig.settle();
  rig.stage.script.hold = false;
  rig.stage.release();
  await rig.settle();
  await rig.advance(3000);
  assert.deepEqual([rig.state.phase, rig.state.history.length], ['childTurn', 0], 'the new game runs');
  assert.equal(rig.calls('brain.finishGame').length, 1);
  assert.deepEqual(storedGames(rig), { played: 1, won: 1, lost: 0, drawn: 0 });
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);

  // the page is closed during the celebration instead: the game comes back as counted, and is not counted twice
  const again = createDirectorRig({ profile });
  again.director.loadExtras(finished);
  again.session.restore(finished);
  await again.settle();
  await again.settle();
  assert.deepEqual([again.state.phase, again.state.counted, again.stage.model.over.quiet], ['over', true, true]);
  assert.equal(again.calls('brain.finishGame').length, 0);
  assert.equal(again.calls('store.saveProfile').length, 0);
  stop(again);

  // 司马懿 mates: the loss counts as well
  const lost = createDirectorRig();
  lost.script.opponent = () => ({ move: ref(4, 7, 4, 4) });
  const before = savedGame(MATE_FOR_BLACK);
  lost.director.loadExtras(before);
  lost.session.restore(before);
  await lost.settle();
  lost.stage.script.hold = true;                                         // his mating move will still be travelling
  await lost.advance(1600);
  await lost.settle();
  assert.equal(lost.state.phase, 'over');
  assert.deepEqual([lost.state.result.reason, lost.state.result.winner], ['checkmate', 'black']);
  assert.deepEqual(lost.calls('brain.finishGame').map((entry) => entry.args[0]), ['loss']);
  assert.equal(lost.calls('stage.over').length, 0);
  lost.actions.newGame();
  await lost.settle();
  lost.stage.script.hold = false;
  lost.stage.release();
  await lost.settle();
  await lost.advance(3000);
  assert.equal(lost.state.history.length, 0);
  assert.deepEqual(storedGames(lost), { played: 1, won: 0, lost: 1, drawn: 0 });
  stop(lost);
});

test('an assessment is valid for the pin it was measured against: under the same pin a retry is instant, under another it is assessed again', T, async () => {
  const rig = await start({ brain: 'manual' });
  table(rig, { depth: 4, best: HORSE, bestScore: 60 });
  await tryMove(rig, PAWN);
  assert.equal(same(rig.job('assess').payload.compare, HORSE), true);
  answerAssess(rig, { cat: 'best', loss: 0, isBest: true });
  await rig.settle();
  assert.deepEqual([verdicts(rig).at(-1).final, verdicts(rig).at(-1).cat], [true, 'best']);
  rig.actions.retract();
  await rig.settle();
  // the same pin: instant, from the kept assessment
  rig.actions.tap(PAWN.to.row, PAWN.to.col, 'tap');
  await rig.settle();
  assert.equal(rig.calls('brain.assessJob').length, 1);
  assert.deepEqual(verdicts(rig).slice(-2).map((v) => [v.final, v.cat]), [[false, 'best'], [true, 'best']]);
  rig.actions.retract();
  await rig.settle();

  // the survey, running again, refutes the pin two plies deeper: the cannon move is 300 better than horse and pawn
  assert.ok(surveyJob(rig), 'the survey runs again');
  table(rig, { depth: 8, scoreOf: DEEP });
  assert.equal(rig.job('assess'), null, 'no trial stands on the board: nothing is assessed for it');
  const mark = rig.mark();
  rig.actions.tap(PAWN.to.row, PAWN.to.col, 'tap');
  await rig.settle();
  const job = rig.job('assess');
  assert.ok(job, 'a fresh assess job');
  assert.equal(same(job.payload.compare, CANNON), true, 'against the pin of now');
  const provisional = rig.log.slice(mark).find((entry) => entry.op === 'stage.verdict').args[0];
  assert.deepEqual([provisional.final, provisional.cat], [false, 'blunder'], 'the face does not repeat the verdict against the old pin');
  assert.equal(rig.since(mark).includes('thread.tryMove'), false);
  answerAssess(rig, { cat: 'mistake', loss: 310 });
  await rig.settle();
  assert.deepEqual([verdicts(rig).at(-1).final, verdicts(rig).at(-1).cat], [true, 'mistake']);
  assert.equal(rig.last('thread.tryMove').args[0].more.better[0].move, '炮二平五');

  // what is recorded at confirm is the verdict against the pin of now
  rig.actions.confirm();
  await rig.settle();
  const sample = samples(rig).at(-1);
  assert.deepEqual([sample.final.cat, sample.final.loss, sample.first.cat, sample.tries], ['mistake', 310, 'mistake', 3]);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);
});

test('the pin is replaced under a trial whose verdict was told: it is assessed again; face and comment follow only a new verdict', T, async () => {
  // (a) the verdict changes: the face, the comment and the try event in the thread are renewed
  const rig = await start({ brain: 'manual' });
  table(rig, { depth: 4, best: HORSE, bestScore: 60 });
  await tryMove(rig, PAWN);
  answerAssess(rig, { cat: 'best', loss: 0, isBest: true });
  await rig.settle();
  assert.deepEqual([verdicts(rig).at(-1).final, verdicts(rig).at(-1).cat], [true, 'best']);
  let mark = rig.mark();
  assert.ok(surveyJob(rig), 'the survey runs again behind the trial');
  table(rig, { depth: 8, scoreOf: DEEP });                               // the pin moves to the cannon move
  let job = rig.job('assess');
  assert.ok(job, 'the trial on the board is assessed again');
  assert.equal(same(job.payload.move, PAWN), true);
  assert.equal(same(job.payload.compare, CANNON), true);
  assert.equal(rig.since(mark).includes('stage.verdict'), false, 'nothing is told before the new assessment is in');
  rig.actions.ask({ code: 'better' });                                   // a question about the trial waits for the try event that is right
  assert.equal(rig.calls('thread.ask').length, 0);
  answerAssess(rig, { cat: 'mistake', loss: 310 });
  await rig.settle();
  assertOrder(rig.since(mark), ['brain.assessJob', 'brief.buildTryPacket', 'thread.retract', 'stage.verdict', 'thread.tryMove', 'stage.arrows', 'thread.ask']);
  assert.deepEqual([verdicts(rig).at(-1).final, verdicts(rig).at(-1).cat], [true, 'mistake']);
  assert.equal(rig.last('thread.tryMove').args[0].try.cat, 'mistake');
  assert.equal(rig.last('thread.tryMove').args[0].more.better[0].move, '炮二平五');
  assert.equal(same(rig.last('stage.arrows').args[0][0], CANNON), true, 'the better arrow goes to the pin of now');
  assert.equal(rig.last('thread.ask').args[0].ask, 'better');
  assert.ok(surveyJob(rig), 'and the survey goes on');
  rig.actions.confirm();
  await rig.settle();
  assert.deepEqual([samples(rig).at(-1).final.cat, samples(rig).at(-1).final.loss], ['mistake', 310]);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);

  // (b) the verdict stays: nothing is told again; the next question renews the try event in the thread without a word,
  //     and the truth is never pinned back to the move it has replaced
  const same2 = await start({ brain: 'manual' });
  table(same2, { depth: 4, best: HORSE, bestScore: 60 });
  await tryMove(same2, PAWN);
  answerAssess(same2, { cat: 'ok', loss: 80 });
  await same2.settle();
  assert.equal(same2.last('thread.tryMove').args[0].more.better[0].move, '马二进三');
  mark = same2.mark();
  table(same2, { depth: 8, scoreOf: DEEP });
  job = same2.job('assess');
  assert.ok(job && same(job.payload.compare, CANNON), 'assessed again, against the cannon move');
  answerAssess(same2, { cat: 'ok', loss: 100 });
  await same2.settle();
  const quiet = same2.since(mark);
  assert.deepEqual(['stage.verdict', 'thread.tryMove', 'thread.retract', 'stage.coachBegin', 'stage.coachLocal'].filter((op) => quiet.includes(op)), [],
                   'the same verdict: no face, no comment, the thread untouched');
  mark = same2.mark();
  same2.actions.ask({ code: 'better' });
  await same2.settle();
  assertOrder(same2.since(mark), ['thread.retract', 'thread.tryMove', 'stage.arrows', 'thread.ask']);
  const renewed = same2.last('thread.tryMove');
  assert.deepEqual([renewed.args[1], renewed.args[0].more.better[0].move], ['silent', '炮二平五']);
  assert.equal(same(same2.last('stage.arrows').args[0][0], CANNON), true);
  same2.actions.retract();
  await same2.settle();
  same2.actions.tap(PAWN.from.row, PAWN.from.col, 'tap');                // put the pawn down
  await same2.settle();
  for (let i = 0; i < 3; i++) {
    same2.actions.hint();
    await same2.settle();
  }
  assert.equal(same(same2.last('stage.hint').args[1].move, CANNON), true, 'pouch 3 names the pin of now');
  same2.actions.tap(CANNON.from.row, CANNON.from.col, 'tap');            // put the cannon down
  await same2.settle();
  same2.actions.tap(PAWN.from.row, PAWN.from.col, 'tap');
  same2.actions.tap(PAWN.to.row, PAWN.to.col, 'tap');
  await same2.settle();
  assert.equal(same2.job('assess'), null, 'the renewed assessment is the kept one: the retry is instant');
  same2.actions.confirm();
  await same2.settle();
  assert.deepEqual([samples(same2).at(-1).final.cat, samples(same2).at(-1).final.loss], ['ok', 100]);
  assert.deepEqual(same2.coach.violations, []);
  assert.deepEqual(same2.stage.model.faults, []);
  stop(same2);

  // (c) the new assessment fails: the verdict that was told stands, questions go on, and a better answer does not pin the
  //     truth back to the replaced move
  const broken = await start({ brain: 'manual' });
  table(broken, { depth: 4, best: HORSE, bestScore: 60 });
  await tryMove(broken, PAWN);
  answerAssess(broken, { cat: 'ok', loss: 80 });
  await broken.settle();
  table(broken, { depth: 8, scoreOf: DEEP });
  assert.ok(broken.job('assess'));
  broken.fail('the assess job broke');
  await broken.settle();
  assert.deepEqual(chipIds(broken), ['good', 'reply', 'better'], 'the chips of the verdict that was told stay');
  broken.actions.ask({ code: 'better' });
  await broken.settle();
  assert.equal(broken.last('thread.ask').args[0].ask, 'better');
  broken.actions.retract();
  await broken.settle();
  broken.actions.tap(PAWN.from.row, PAWN.from.col, 'tap');
  await broken.settle();
  for (let i = 0; i < 3; i++) {
    broken.actions.hint();
    await broken.settle();
  }
  assert.equal(same(broken.last('stage.hint').args[1].move, CANNON), true, 'not pinned back to the horse move');
  assert.deepEqual(broken.coach.violations, []);
  stop(broken);
});

test('a line that was begun is always ended: a reply that a newer reply or a timeout takes the channel from is closed on the stage', T, async () => {
  // a comment that is still coming in when the child asks a question
  const rig = await start();
  rig.coach.setMode('llm');
  rig.script.assess = () => ({ cat: 'mistake' });                        // spoken, not held
  await tryMove(rig, ROOK);
  const comment = rig.coach.replies.at(-1);
  assert.ok(comment && comment.kind === 'try');
  comment.push('这步');
  const line = rig.stage.model.lines.at(-1);
  assert.deepEqual([line.kind, line.text, line.end], ['try', '这步', null]);
  const mark = rig.mark();
  rig.actions.ask({ code: 'reply' });
  assert.deepEqual(line.end, { reason: 'aborted', source: 'none' }, 'closed by the director: what follows may show nothing');
  assertOrder(rig.since(mark), ['stage.childSaid', 'stage.coachEnd', 'thread.ask', 'stage.coachBegin']);
  const answer = rig.coach.replies.at(-1);
  assert.equal(answer.ask, 'reply');
  answer.push('他会吃回来。');
  answer.finish();
  await rig.settle();
  assert.deepEqual(openLines(rig), []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);

  // a reply that never ends: the task's timeout closes its line
  const slow = await start();
  slow.coach.setMode('llm');
  slow.actions.ask({ code: 'score' });
  const dots = slow.stage.model.lines.at(-1);
  assert.deepEqual([dots.kind, dots.end], ['ask', null]);
  await slow.advance(21000);
  assert.deepEqual(dots.end, { reason: 'aborted', source: 'none' });
  assert.deepEqual(openLines(slow), []);
  assert.deepEqual(slow.stage.model.faults, []);
  stop(slow);

  // a task that the position leaves behind tells nothing (the stage has closed that moment's lines itself)
  const gone = await start();
  gone.coach.setMode('llm');
  gone.actions.ask({ code: 'score' });
  await tryMove(gone, ROOK);
  const before = gone.mark();
  gone.actions.confirm();
  await gone.settle();
  assert.equal(gone.since(before).includes('stage.coachEnd'), false);
  stop(gone);
});

test('the takeaway is not cut by a question: the over chips and the input open when it has ended, also when it never ends by itself', T, async () => {
  const rig = await start();
  rig.script.assess = () => ({ cat: 'best', loss: 0 });
  await play(rig, CANNON);
  rig.coach.setMode('llm', null, true);
  await resign(rig);
  const over = rig.coach.replies.at(-1);
  assert.ok(over && over.kind === 'over', 'the takeaway is on its way');
  over.push('这盘小主公');
  const card = rig.stage.model.lines.at(-1);
  assert.deepEqual([card.target, card.text, card.end], ['card', '这盘小主公', null]);
  assert.deepEqual(chipIds(rig), [], 'no chip while the takeaway is written');
  assert.deepEqual(rig.stage.model.input, { visible: true, enabled: false });
  const asks = rig.calls('thread.ask').length;
  rig.actions.ask({ text: '我哪里下得不好？' });
  rig.actions.ask({ code: 'proud' });
  await rig.settle();
  assert.equal(rig.calls('thread.ask').length, asks, 'a question is not taken yet');
  assert.equal(over.alive(), true);
  over.push('下得很顽强。');
  over.finish();
  await rig.settle();
  assert.equal(card.text, '这盘小主公下得很顽强。');
  assert.deepEqual(card.end, { reason: 'done', source: 'llm' });
  assert.deepEqual(chipIds(rig), ['proud']);
  assert.deepEqual(rig.stage.model.input, { visible: true, enabled: true });
  rig.actions.ask({ code: 'proud' });
  assert.equal(rig.last('thread.ask').args[0].ask, 'proud');
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);

  // the proxy never finishes: the task's timeout ends the card's line and the questions open after all
  const stalled = await start();
  stalled.script.assess = () => ({ cat: 'best', loss: 0 });
  await play(stalled, CANNON);
  stalled.coach.setMode('llm', null, true);
  await resign(stalled);
  const line = stalled.stage.model.lines.at(-1);
  assert.deepEqual([line.target, line.end], ['card', null]);
  assert.deepEqual(chipIds(stalled), []);
  await stalled.advance(21000);
  assert.deepEqual(line.end, { reason: 'aborted', source: 'none' }, 'the game-over line is ended too');
  assert.deepEqual(chipIds(stalled), ['proud']);
  assert.deepEqual(stalled.stage.model.input, { visible: true, enabled: true });
  assert.deepEqual(openLines(stalled), []);
  stop(stalled);

  // the child stops the takeaway (■): it ends, and the questions open
  const stopped = await start();
  stopped.script.assess = () => ({ cat: 'best', loss: 0 });
  await play(stopped, CANNON);
  stopped.coach.setMode('llm', null, true);
  await resign(stopped);
  stopped.coach.replies.at(-1).push('这盘');
  stopped.actions.stopCoach();
  await stopped.settle();
  assert.deepEqual(stopped.stage.model.lines.at(-1).end, { reason: 'aborted', source: 'none' });
  assert.deepEqual(chipIds(stopped), ['proud']);
  assert.deepEqual(stopped.stage.model.faults, []);
  stop(stopped);
});

test('a question asked while the trial on the board is still being assessed is sent after the try event', T, async () => {
  const rig = await start({ brain: 'manual' });
  rig.coach.setMode('llm', null, true);
  answerSurvey(rig, { depth: 6 });
  await rig.settle();
  for (const reply of [...rig.coach.replies]) reply.finish();           // the greeting
  await rig.settle();
  await tryMove(rig, ROOK);
  assert.ok(rig.job('assess'), 'the assessment is on its way');
  const mark = rig.mark();
  rig.actions.ask({ text: '这步会丢车吗？' });
  assert.equal(rig.calls('thread.ask').length, 0, 'held back: the try event would throw it away');
  assert.deepEqual(rig.stage.model.said, []);
  answerAssess(rig, { cat: 'good' });
  await rig.settle();
  assertOrder(rig.since(mark), ['thread.tryMove', 'stage.childSaid', 'thread.ask']);
  assert.equal(rig.last('thread.tryMove').args[1], 'silent', 'a plain move: the try has nothing to say');
  assert.deepEqual(rig.stage.model.said, ['这步会丢车吗？']);
  const answer = rig.coach.replies.at(-1);
  assert.ok(answer && answer.ask === 'free' && answer.alive(), 'the question is in flight');
  answer.push('不会。');
  answer.finish();
  await rig.settle();
  assert.deepEqual([rig.stage.model.lines.at(-1).kind, rig.stage.model.lines.at(-1).text], ['ask', '不会。']);
  assert.deepEqual(openLines(rig), []);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);

  // the assessment fails: the question is not about the verdict, it is sent all the same
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(ROOK.from.row, ROOK.from.col, 'tap');                  // put the rook down
  await tryMove(rig, HORSE);
  await rig.advance(900);
  rig.actions.ask({ code: 'score' });
  assert.equal(rig.last('thread.ask').args[0].ask, 'free', 'waiting');
  rig.fail('the assess job broke');
  await rig.settle();
  assert.equal(rig.last('thread.ask').args[0].ask, 'score');

  // the trial is taken back while the question waits: it goes with the trial, as an answer in flight would
  for (const reply of [...rig.coach.replies]) reply.finish();
  rig.actions.retract();
  await rig.settle();
  rig.actions.tap(HORSE.from.row, HORSE.from.col, 'tap');
  await tryMove(rig, PAWN);
  await rig.advance(900);
  const sent = rig.calls('thread.ask').length;
  rig.actions.ask({ code: 'danger' });
  rig.actions.retract();
  await rig.settle();
  assert.equal(rig.calls('thread.ask').length, sent);
  assert.deepEqual(rig.coach.violations, []);
  stop(rig);
});

test('a trial that is on the board before the brief exists: the read of the rival\'s move is not requested, the caption is shown', T, async () => {
  const rig = await start({ brain: 'manual' });
  rig.coach.setMode('llm', null, true);
  answerSurvey(rig, { depth: 6 });
  await rig.settle();
  await tryMove(rig, CANNON);
  answerAssess(rig, { cat: 'good' });
  await rig.settle();
  for (const reply of [...rig.coach.replies]) reply.finish();
  rig.actions.confirm();
  await rig.settle();
  rig.actions.tap(HORSE.from.row, HORSE.from.col, 'tap');               // picked up while he thinks (D-43)
  answerOpponent(rig, { index: 3 });
  await rig.settle();
  await rig.advance(1000);
  assert.equal(rig.state.phase, 'selected');
  const briefs = rig.calls('coach.beginTurn').length;
  const fetches = rig.coach.counters.fetches;
  const captions = rig.stage.model.captions.length;
  rig.actions.tap(HORSE.to.row, HORSE.to.col, 'tap');                    // inside the 400 ms the brief waits for the threat
  await rig.settle();
  assert.equal(rig.calls('coach.beginTurn').length, briefs, 'no brief yet');
  answerAssess(rig, { cat: 'good' });
  await rig.settle();
  await rig.advance(401);
  assert.equal(rig.calls('coach.beginTurn').length, briefs + 1);
  assert.equal(rig.stage.model.captions.length, captions + 1, 'the caption of his move is shown');
  const open = rig.last('thread.open');
  assert.deepEqual([open.args[0].kind, open.args[1]], ['opp', 'silent'], 'a second move of a game is read aloud otherwise (policy.shouldSpeakOpp)');
  assert.equal(rig.coach.counters.fetches, fetches, 'no request leaves for it');
  assert.equal(rig.last('thread.tryMove').args[1], 'silent');
  assert.deepEqual(openLines(rig), [], 'and no line is left open');
  await rig.advance(24000);
  assert.deepEqual(openLines(rig), []);
  assert.deepEqual(rig.coach.violations, []);
  assert.deepEqual(rig.stage.model.faults, []);
  stop(rig);

  // without a trial on the board his move is read as before
  const plain = await start({ brain: 'manual' });
  plain.coach.setMode('llm', null, true);
  answerSurvey(plain, { depth: 6 });
  await plain.settle();
  await tryMove(plain, CANNON);
  answerAssess(plain, { cat: 'good' });
  await plain.settle();
  plain.actions.confirm();
  await plain.settle();
  answerOpponent(plain, { index: 3 });
  await plain.settle();
  await plain.advance(1500);
  assert.deepEqual([plain.last('thread.open').args[0].kind, plain.last('thread.open').args[1]], ['opp', 'auto']);
  stop(plain);
});

test('undo of a resignation says that the game goes on; an undo that takes a move back says so', T, async () => {
  const rig = await start();
  await play(rig, CANNON);
  await resign(rig);
  await rig.advance(3000);
  let said = localTexts(rig).length;
  rig.actions.undo();
  await rig.settle();
  assert.deepEqual([rig.state.phase, rig.state.history.length], ['childTurn', 2]);
  assert.equal(rig.last('stage.undone').args[0].steps.length, 0, 'no move went back');
  assert.deepEqual(localTexts(rig).slice(said), [STR.undoResign]);
  assert.equal(STR.undoResign, '好，这盘接着下！');

  said = localTexts(rig).length;
  rig.actions.undo();
  await rig.settle();
  assert.equal(rig.state.history.length, 0);
  assert.deepEqual(localTexts(rig).slice(said), [STR.undoDone]);

  // resigned while the rival was to move: the child's move goes back with the resignation
  await tryMove(rig, ROOK);
  rig.script.opponent = () => null;                                      // he is still thinking
  rig.actions.confirm();
  await rig.settle();
  await resign(rig);
  assert.equal(rig.state.phase, 'over');
  said = localTexts(rig).length;
  rig.actions.undo();
  await rig.settle();
  assert.deepEqual([rig.state.phase, rig.state.history.length], ['childTurn', 0]);
  assert.deepEqual(localTexts(rig).slice(said), [STR.undoDone]);
  stop(rig);
});

test('no offer of a pouch that cannot be given: all three are open, or the survey of the position failed; the offer is not spent', T, async () => {
  const offers = (rig) => localTexts(rig).filter((text) => text === STR.idleOffer).length;
  const rig = await start();
  for (let i = 0; i < 3; i++) {
    rig.actions.hint();
    await rig.settle();
    await rig.advance(700);
  }
  const held = rig.state.selected;                                       // pouch 3 picked the piece up
  rig.actions.tap(held.row, held.col, 'tap');
  await rig.settle();
  assert.deepEqual([rig.state.phase, rig.state.hint.level], ['childTurn', 3]);
  rig.actions.activity();
  await rig.advance(90500);
  assert.equal(offers(rig), 0, 'three pouches are open: there is none to offer');
  // ... and that offer was not spent: the two of a game are still to come
  await play(rig, ROOK);
  for (const [count, move] of [[1, HORSE], [2, PAWN]]) {
    await rig.advance(91000);
    assert.equal(offers(rig), count);
    rig.actions.hint();                                                  // the offer is taken: not a decline
    await rig.settle();
    await play(rig, move);
  }
  stop(rig);

  // the survey failed before any table came: the pouches answer hintUnavailable, so none is offered
  const dead = await start({ brain: 'manual' });
  await dead.advance(3600);                                              // the survey job times out
  dead.actions.activity();
  await dead.advance(90500);
  assert.equal(offers(dead), 0);
  dead.actions.hint();
  await dead.settle();
  assert.equal(localTexts(dead).at(-1), STR.hintUnavailable);
  stop(dead);

  // the survey failed after a table came: a pouch can still be given, and is offered
  const half = await start({ brain: 'manual' });
  table(half, { depth: 4, best: HORSE, bestScore: 50 });
  half.fail('the survey broke');
  await half.settle();
  half.actions.activity();
  await half.advance(90500);
  assert.equal(offers(half), 1);
  stop(half);
});
