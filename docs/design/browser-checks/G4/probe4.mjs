// End to end, without a network: the real coach port and client, a scripted proxy (the fake fetch of C4, strict), the real brain behind a
// fake worker. Checks the tool executor of ports.js: payload, lifetime, verdict, busy, game_over, a notation that does not parse.
import assert from 'node:assert/strict';

const ROOT = 'file:///C:/Users/USERNAME/git/yijian-xiangqi/';
const { createBrainPort, createCoachPort } = await import(ROOT + 'src/game/ports.js');
const { createFakeFetch } = await import(ROOT + 'tests/helpers/fake-fetch.js');
const { createFakeWorkers } = await import(ROOT + 'tests/helpers/fake-worker.js');
const { createSession } = await import(ROOT + 'src/game/session.js');
const { createTasks } = await import(ROOT + 'src/game/tasks.js');
const { createBrain } = await import(ROOT + 'src/core/brain.js');

process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e); process.exitCode = 2; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = createFakeFetch();
globalThis.fetch = fake.fetch;
const realBrain = createBrain();
const jobs = [];
let answer = true;
const host = createFakeWorkers({ autoReady: true, autoAck: true, respond: (job, worker) => {
  jobs.push(job);
  if (answer && job.kind === 'assess') {
    realBrain.assess(job.payload).then((data) => worker.done(job.id, JSON.parse(JSON.stringify(data))), (e) => worker.error(job.id, String(e)));
  }
  return undefined;
} });
const session = createSession();
const tasks = createTasks({ getScope: () => session.scope(), createWorker: () => host.createWorker() });
host.current.ready();
session.subscribe((e) => { if (e.type === 'scope') tasks.sync(e.scope); });
session.newGame({ humanColor: 'red' });
const state = session.getState();
const brain = createBrainPort();
const deps = { apiBase: 'http://proxy.test/api', forceLocal: false, tasks, brain, getSession: () => state };
const coach = createCoachPort(deps);
await coach.probe();
assert.equal(coach.status(), 'online');
assert.deepEqual(coach.capabilities(), { freeText: true });

const turn = { ply: 0, me: 'red', phase: 'opening', check: false, n: 44, back: null, eval: { b: 'even' }, mat: { me: 'R2H2C2P5A2E2', opp: 'R2H2C2P5A2E2', cp: 0 }, level: 3,
  moments: [], taught: [], mine: null, opp: null, threats: [], chance: null, known: { threats: true, chance: false } };
const book = coach.createMoveBook({ board: state.board, turn: 'red' });
const thread = coach.beginTurn(turn, book);
await thread.open({ kind: 'start' }, 'silent', {}).done;

const TOOL = { id: 'call_1', name: 'analyze_move', input: { notation: '炮2平5', after: ['马二进三'] } };
const toolLeg = (calls) => (call) => ({ steps: [fake.OPEN, { event: 'tool', data: fake.toolData(call, calls) }] });
const posts = () => fake.calls.filter((c) => c.method === 'POST');
async function ask(text) {
  const seen = { tools: [], text: '' };
  const reply = thread.ask('free', text, { onTool: (t) => seen.tools.push(t), onSegment: (s) => { seen.text += s.type === 'move' ? `【${s.notation}】` : s.text; } });
  const result = await reply.done;
  return { seen, result };
}

// 1. the happy path
fake.enqueue(toolLeg([TOOL]), fake.say('对方架起中炮，【炮2平5】是常见的应法。'));
let out = await ask('如果我走马二进三，对方走炮2平5呢？');
assert.equal(out.result.source, 'llm');
assert.deepEqual(fake.violations, [], 'the proxy accepts every request, the resumed one with the verdict included');
assert.equal(jobs.length, 1);
const p = jobs[0].payload;
assert.deepEqual([jobs[0].kind, p.ply, p.level, p.table, p.compare, p.history.length], ['assess', 1, 3, null, null, 0]);
assert.deepEqual(p.move, { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } });
assert.equal(p.fen, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C4NC1/9/RNBAKAB1R b');
const resumed = posts().at(-1).json.resume;
assert.equal(resumed.results.length, 1);
assert.equal(resumed.results[0].ok, true);
const verdict = resumed.results[0].verdict;
assert.deepEqual([verdict.seq, verdict.who], [['马二进三', '炮2平5'], 'opp']);
assert.ok(book.lookup('炮2平5'), 'the analysed line is in the book');
assert.equal(book.lookup('炮2平5').src, 'tool');
assert.equal(out.seen.tools[0].phase, 'start');
assert.ok(out.seen.tools[0].link, 'the client hands the link for ghost play');
console.log('1 ok: verdict', JSON.stringify(verdict).slice(0, 260));
assert.equal(tasks.liveJob(), null);

// 2. a UI job is live: busy, and the tool posts no job
answer = false;
const ui = tasks.job({ kind: 'assess', payload: { fen: p.fen }, lifetime: 'position', timeoutMs: 5000 });
fake.enqueue(toolLeg([{ ...TOOL, id: 'call_2' }]), fake.say('亮这会儿腾不出手，稍后再摆。'));
let before = jobs.length;
out = await ask('再问一次呢');
assert.deepEqual(fake.violations, []);
let res = posts().at(-1).json.resume.results;
assert.deepEqual(res.at(-1), { id: 'call_2', ok: false, error: 'busy' });
assert.equal(jobs.filter((j) => j.payload.move).length, 1, 'the tool posted no job of its own');
ui.cancel();
console.log('2 ok: busy while a UI job runs');

// 3. a notation that does not parse: the error goes back with its index and candidates
answer = true;
fake.enqueue(toolLeg([{ id: 'call_3', name: 'analyze_move', input: { notation: '车九平五', after: ['马二进三'] } }]), fake.say('那一步走不了。'));
out = await ask('那车九平五呢');
res = posts().at(-1).json.resume.results;
console.log('3 result:', JSON.stringify(res.at(-1)));
assert.equal(res.at(-1).ok, false);
assert.ok(['no_such_move', 'syntax', 'ambiguous'].includes(res.at(-1).error));
assert.equal(res.at(-1).at, 1);
assert.deepEqual(fake.violations, []);

// 4. the tool job is superseded by a UI job that arrives meanwhile: busy
answer = false;
fake.enqueue(toolLeg([{ ...TOOL, id: 'call_4' }]), fake.say('刚才被打断了。'));
const waiting = ask('再摆一次');
await sleep(60);
assert.deepEqual(tasks.liveJob(), { kind: 'assess', lifetime: 'position', tool: true });
const ui2 = tasks.job({ kind: 'assess', payload: { fen: p.fen }, lifetime: 'position', timeoutMs: 5000 });
out = await waiting;
res = posts().at(-1).json.resume.results;
assert.deepEqual(res.at(-1), { id: 'call_4', ok: false, error: 'busy' });
ui2.cancel();
console.log('4 ok: a UI job that arrives meanwhile wins');

// 5. the reply is aborted while the tool job runs: the job is cancelled
fake.enqueue(toolLeg([{ ...TOOL, id: 'call_5' }]));
const flying = thread.ask('free', '最后一次', {});
await sleep(60);
assert.equal(tasks.liveJob() && tasks.liveJob().tool, true);
thread.interrupt();
const r5 = await flying.done;
await sleep(10);
assert.equal(r5.aborted, true);
assert.equal(tasks.liveJob(), null, 'the tool job went with the reply');
console.log('5 ok: abort cancels the tool job');

// 6. a trial on the board: the tool job has the lifetime of the trial
session.tryMove({ from: { row: 9, col: 7 }, to: { row: 7, col: 6 } });
fake.enqueue(toolLeg([{ ...TOOL, id: 'call_6' }]), fake.say('好。'));
const p6 = thread.ask('free', '试走的时候问', {});
await sleep(60);
assert.deepEqual(tasks.liveJob(), { kind: 'assess', lifetime: 'trial', tool: true });
session.retract();
await p6.done;
await sleep(10);
assert.equal(tasks.liveJob(), null, 'retract cancels trial-lifetime work');
console.log('6 ok: trial lifetime');

// 7. an over thread: game_over without a job; why after the game never reaches the proxy
const overThread = coach.beginOver({ ...turn, ply: 10 }, book);
const over = { result: 'loss', reason: 'resign', moves: 5, stats: { good: 3, taken: 0, captures: 0, brilliant: 0 }, takeaway: null, proud: null, goal: null, kept: null, rank: null };
fake.enqueue(fake.say('这盘惜败。'));
await overThread.open({ kind: 'over', over }, 'auto', {}).done;
before = jobs.length;
fake.enqueue(toolLeg([{ ...TOOL, id: 'call_7' }]), fake.say('棋已经下完了。'));
await overThread.ask('free', '如果刚才走炮呢', {}).done;
res = posts().at(-1).json.resume.results;
assert.deepEqual(res.at(-1), { id: 'call_7', ok: false, error: 'game_over' });
assert.equal(jobs.length, before);
const postsBefore = posts().length;
let whyText = '';
const r8 = await overThread.ask('why', undefined, { onSegment: (s) => { whyText += s.type === 'text' ? s.text : s.notation; } }).done;
assert.equal(posts().length, postsBefore, 'no request for why after the game');
assert.equal(r8.source, 'local');
assert.ok(whyText.length > 0);
console.log('7 ok: game_over; why after the game is local:', whyText);
assert.deepEqual(fake.violations, []);
console.log('ALL OK; requests', fake.calls.length, 'assess jobs', jobs.length);
tasks.dispose();
setTimeout(() => process.exit(process.exitCode ?? 0), 50);
