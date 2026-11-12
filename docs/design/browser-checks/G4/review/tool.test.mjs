// Scratch: the tool executor of ports.js as a unit test (no real brain, no real time): real coach port + real client + C4's strict
// fake fetch + the task manager on the fake worker; assess jobs are answered with fakeAssessed.
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = 'file:///C:/Users/USERNAME/git/yijian-xiangqi/';
const { createDirectorRig, fakeAssessed } = await import(ROOT + 'tests/helpers/fake-ports.js');
const { createFakeFetch } = await import(ROOT + 'tests/helpers/fake-fetch.js');
const { tick } = await import(ROOT + 'tests/helpers/fake-worker.js');
const { createBrainPort, createCoachPort } = await import(ROOT + 'src/game/ports.js');

const T = { timeout: 30000 };

/** Waits (bounded) until `cond` holds, letting promise callbacks and the fake worker run. */
async function until(cond, what, turns = 400) {
  for (let i = 0; i < turns; i++) {
    if (cond()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('ports: the tool executor (4.24)', T, async () => {
  const realFetch = globalThis.fetch;
  const fake = createFakeFetch();
  globalThis.fetch = fake.fetch;
  const rig = createDirectorRig({ brain: 'manual' });
  try {
    rig.session.newGame({ humanColor: 'red' });
    await rig.settle();
    const brain = createBrainPort();
    const coach = createCoachPort({ apiBase: 'http://proxy.test/api', forceLocal: false, tasks: rig.tasks, brain, getSession: () => rig.state });
    await coach.probe();
    assert.equal(coach.status(), 'online');

    const turn = { ply: 0, me: 'red', phase: 'opening', check: false, n: 44, back: null, eval: { b: 'even' }, mat: { me: 'R2H2C2P5A2E2', opp: 'R2H2C2P5A2E2', cp: 0 },
                   level: 3, moments: [], taught: [], mine: null, opp: null, threats: [], chance: null, known: { threats: true, chance: false } };
    const book = coach.createMoveBook({ board: rig.state.board, turn: 'red' });
    const thread = coach.beginTurn(turn, book);
    await thread.open({ kind: 'start' }, 'silent', {}).done;

    const TOOL = { id: 'call_1', name: 'analyze_move', input: { notation: '炮2平5', after: ['马二进三'] } };
    const toolLeg = (calls) => (call) => ({ steps: [fake.OPEN, { event: 'tool', data: fake.toolData(call, calls) }] });
    const posts = () => fake.calls.filter((c) => c.method === 'POST');
    const lastResult = () => posts().at(-1).json.resume.results.at(-1);
    const toolJob = () => { const job = rig.job('assess'); return job && rig.tasks.liveJob() && rig.tasks.liveJob().tool ? job : null; };

    // 1. the moves are parsed from the thread's base position; one assess job on the position reached; the verdict travels
    fake.enqueue(toolLeg([TOOL]), fake.say('【炮2平5】是常见的应法。'));
    let reply = thread.ask('free', '如果我走马二进三，对方走炮2平5呢？', {});
    await until(() => toolJob() !== null, 'the tool job');
    assert.deepEqual(rig.tasks.liveJob(), { kind: 'assess', lifetime: 'position', tool: true });
    const p = toolJob().payload;
    assert.deepEqual([p.ply, p.level, p.table, p.compare, p.history], [1, 3, null, null, []]);
    assert.deepEqual(p.move, { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } });
    assert.equal(p.fen, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C4NC1/9/RNBAKAB1R b');
    rig.done(fakeAssessed(p, {}));
    let result = await reply.done;
    assert.equal(result.aborted, false);
    assert.deepEqual(fake.violations, [], 'the proxy accepts the resumed request with the verdict');
    assert.equal(lastResult().ok, true);
    assert.deepEqual([lastResult().verdict.seq, lastResult().verdict.who], [['马二进三', '炮2平5'], 'opp']);
    assert.equal(book.lookup('炮2平5').src, 'tool', 'the analysed line is in the book');
    assert.equal(rig.tasks.liveJob(), null);

    // 2. a UI job is running: busy, and no job of the tool's own
    const ui = rig.tasks.job({ kind: 'assess', payload: { fen: p.fen }, lifetime: 'position', timeoutMs: 5000 });
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_2' }]), fake.say('稍后再摆。'));
    await thread.ask('free', '再问一次呢', {}).done;
    assert.deepEqual(lastResult(), { id: 'call_2', ok: false, error: 'busy' });
    assert.deepEqual(rig.tasks.liveJob(), { kind: 'assess', lifetime: 'position', tool: false }, 'the UI job was not superseded');
    ui.cancel();
    await rig.settle();

    // 3. a move that cannot be played: the error with the index of the text and candidates
    fake.enqueue(toolLeg([{ id: 'call_3', name: 'analyze_move', input: { notation: '车九平五', after: ['马二进三'] } }]), fake.say('那一步走不了。'));
    await thread.ask('free', '那车九平五呢', {}).done;
    assert.equal(lastResult().ok, false);
    assert.equal(lastResult().error, 'no_such_move');
    assert.equal(lastResult().at, 1);
    assert.ok(lastResult().candidates.length >= 1 && lastResult().candidates.length <= 5);
    assert.equal(rig.tasks.liveJob(), null, 'no job for a line that does not parse');

    // 4. a UI job that arrives while the tool job runs wins: busy
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_4' }]), fake.say('刚才被打断了。'));
    reply = thread.ask('free', '再摆一次', {});
    await until(() => toolJob() !== null, 'the tool job');
    const ui2 = rig.tasks.job({ kind: 'assess', payload: { fen: p.fen }, lifetime: 'position', timeoutMs: 5000 });
    await reply.done;
    assert.deepEqual(lastResult(), { id: 'call_4', ok: false, error: 'busy' });
    ui2.cancel();
    await rig.settle();

    // 5. the reply is aborted while the tool job runs: the job goes with it
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_5' }]));
    reply = thread.ask('free', '最后一次', {});
    await until(() => toolJob() !== null, 'the tool job');
    thread.interrupt();
    result = await reply.done;
    await rig.settle();
    assert.equal(result.aborted, true);
    assert.equal(rig.tasks.liveJob(), null);

    // 6. with a trial on the board the job has the lifetime of the trial: a retract cancels it
    rig.session.tryMove({ from: { row: 9, col: 7 }, to: { row: 7, col: 6 } });
    await rig.settle();
    if (rig.job('assess')) { rig.worker().cancelled(rig.job('assess').id); }
    fake.enqueue(toolLeg([{ ...TOOL, id: 'call_6' }]), fake.say('好。'));
    reply = thread.ask('free', '试走的时候问', {});
    await until(() => rig.tasks.liveJob() !== null && rig.tasks.liveJob().tool === true, 'the tool job');
    assert.deepEqual(rig.tasks.liveJob(), { kind: 'assess', lifetime: 'trial', tool: true });
    rig.session.retract();
    await reply.done;
    await rig.settle();
    assert.equal(rig.tasks.liveJob() === null || rig.tasks.liveJob().tool === false, true);
    assert.equal(lastResult().error, 'busy');

    // 7. an over thread: game_over, no job; why after the game never reaches the proxy
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
    assert.equal(answer.aborted === false && answer.source, 'local');
    assert.ok(why.length > 0);
    assert.deepEqual(fake.violations, []);
  } finally {
    globalThis.fetch = realFetch;
    rig.director.dispose();
    rig.tasks.dispose();
  }
});
