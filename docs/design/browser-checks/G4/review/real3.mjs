// Reviewer's run of the LIVE coach path without a network: the director on real session / tasks / store / BrainPort / CoachPort with
// an apiBase, the real client talking to C4's strict fake fetch (every POST is checked the way the proxy checks it), the real brain
// in this process behind the fake worker, real timers; only the stage is the fake.
// What is checked: every request the director causes is one the proxy would accept (no violation), and no reply is lost.
const ROOT = 'file:///C:/Users/USERNAME/git/yijian-xiangqi/';
const { createFakePorts } = await import(ROOT + 'tests/helpers/fake-ports.js');
const { createFakeWorkers } = await import(ROOT + 'tests/helpers/fake-worker.js');
const { createFakeFetch } = await import(ROOT + 'tests/helpers/fake-fetch.js');
const { createMemoryStorage } = await import(ROOT + 'tests/helpers/memory-storage.js');
const { createBrainPort, createCoachPort } = await import(ROOT + 'src/game/ports.js');
const { createDirector } = await import(ROOT + 'src/game/director.js');
const { createSession } = await import(ROOT + 'src/game/session.js');
const { createTasks } = await import(ROOT + 'src/game/tasks.js');
const { createStore } = await import(ROOT + 'src/game/store.js');
const { createBrain } = await import(ROOT + 'src/core/brain.js');
const { getLegalMoves, applyMove } = await import(ROOT + 'src/core/engine.js');
const teacher = await import(ROOT + 'src/core/teacher.js');

let unhandled = 0, errors = 0, timeouts = 0;
process.on('unhandledRejection', (e) => { unhandled += 1; console.log('UNHANDLED', e); });
console.error = (...args) => { errors += 1; console.log('CONSOLE.ERROR', ...args.map((a) => (a && a.stack ? a.stack : a))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms, what) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) { timeouts += 1; console.log(`TIMEOUT waiting for ${what}`); return false; }
    await sleep(15);
  }
  return true;
}

const fake = createFakeFetch();
globalThis.fetch = fake.fetch;
fake.coach = fake.say('亮看这一步，稳。');

function page(storageInit) {
  const fakes = createFakePorts();
  const stage = fakes.stage;
  const realBrain = createBrain();
  const host = createFakeWorkers({ autoReady: true, autoAck: true, respond: (job, worker) => {
    const ctl = { cancelled: false, onProgress: (step, data) => { if (worker.running === job.id) worker.progress(job.id, step, JSON.parse(JSON.stringify(data))); } };
    realBrain[job.kind](job.payload, ctl).then(
      (data) => { if (worker.running === job.id) worker.done(job.id, JSON.parse(JSON.stringify(data))); },
      (e) => { if (!(e && e.cancelled)) worker.error(job.id, String(e && e.stack ? e.stack : e)); },
    );
    return undefined;
  } });
  const session = createSession();
  const brain = createBrainPort();
  const tasks = createTasks({ getScope: () => session.scope(), createWorker: () => host.createWorker(),
    onWorker: (e, info) => { if (e === 'ready' && info) brain.setSpeed(info.speedClass); } });
  host.current.ready();
  const storage = createMemoryStorage(storageInit ?? {});
  const store = createStore({ storage, teacher });
  const loaded = store.load();
  const coach = createCoachPort({ apiBase: 'http://proxy.test/api', forceLocal: false, tasks, brain, getSession: () => session.getState() });
  const save = () => { store.saveGame({ ...session.serialize(), ...director.extras() }); };
  const director = createDirector({ session, tasks, store, brain, coach, stage, profile: loaded.profile, settings: { ...loaded.settings, talk: 'more' }, save,
    rng: Math.random, now: () => Date.now(), setTimer: setTimeout, clearTimer: clearTimeout, reload: () => {} });
  session.subscribe((e) => { if (e.type === 'scope') tasks.sync(e.scope); });
  session.subscribe((e) => { if (e.type === 'change' && e.persist) save(); });
  session.subscribe(director.onEvent);
  stage.on(director.actions);
  const state = session.getState();
  const finals = () => fakes.calls('stage.verdict').filter((e) => e.args[0].final).length;
  const a = director.actions;
  const ended = () => stage.model.lines.filter((l) => l.end !== null).length;
  return {
    fakes, stage, session, state, director, tasks, store, storage, a, coach,
    async tryMove(fr, fc, tr, tc, wait = true) {
      const n = finals();
      a.tap(fr, fc, 'tap');
      a.tap(tr, tc, 'tap');
      if (wait) { await until(() => finals() > n, 6000, 'the final verdict'); await sleep(150); }
    },
    async ask(q) {
      const n = ended();
      const posts = fake.coachCalls().length;
      a.ask(q);
      await until(() => ended() > n || fake.coachCalls().length === posts, 4000, `the answer to ${JSON.stringify(q)}`);
      await sleep(820);
    },
    async confirm() {
      const plies = state.history.length;
      a.confirm();
      await until(() => state.phase === 'over' || (state.history.length === plies + 2 && state.phase !== 'opponentTurn'), 12000, 'the rival');
      await until(() => stage.model.chips.length > 0 || state.phase === 'over', 3000, 'the turn chips');
      await sleep(200);
    },
    async overCard() {
      await until(() => stage.model.over !== null && stage.model.chips !== null && fakes.calls('coach.beginOver').length + stage.model.lines.filter((l) => l.target === 'card' && l.end).length > 0, 8000, 'the over card line');
      await sleep(250);
    },
    saved: () => ({ ...session.serialize(), ...director.extras() }),
    close() { director.dispose(); tasks.dispose(); },
  };
}

function report(label, p, from) {
  const posts = fake.coachCalls().slice(from);
  const kinds = posts.map((c) => { const ev = c.json.events.at(-1); return ev.kind === 'ask' ? `ask:${ev.ask}` : ev.kind === 'hint' ? `hint${ev.level}` : ev.kind; });
  console.log(`\n== ${label}: ${posts.length} requests [${kinds.join(' ')}]`);
  console.log('   lines:', p.stage.model.lines.map((l) => `${l.kind}/${l.end ? l.end.source + '/' + l.end.reason : 'OPEN'}`).join(' '));
  console.log('   violations so far:', fake.violations.length, 'faults:', JSON.stringify(p.stage.model.faults));
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. red: start, trial with questions, retract, pouches, confirm, turn questions, a typed question, undo, a second move, resign, over
// ---------------------------------------------------------------------------------------------------------------------
{
  const p = page();
  await p.coach.probe();
  let from = fake.coachCalls().length;
  p.session.newGame({ humanColor: 'red' });
  await until(() => p.stage.model.lines.some((l) => l.kind === 'start' && l.end), 5000, 'the greeting');
  await until(() => p.fakes.calls('stage.tension').length > 0, 8000, 'the first survey');
  await p.tryMove(7, 7, 7, 4);
  await sleep(300);
  await p.ask({ code: 'good' });
  await p.ask({ code: 'reply' });
  await p.ask({ code: 'better' });
  await p.ask({ code: 'why' });
  p.a.retract(); await sleep(100);
  p.a.tap(7, 7, 'tap');
  p.a.hint(); await sleep(400); p.a.hint(); await sleep(400); p.a.hint(); await sleep(400);
  const chip = p.stage.model.chips.find((c) => c.action === 'pouch');
  if (chip) { p.a.chip(chip); await sleep(700); }
  await p.ask({ code: 'good' });
  await p.confirm();
  await sleep(400);
  report('1a first move', p, from); from = fake.coachCalls().length;
  await p.ask({ code: 'intent' });
  await p.ask({ code: 'danger' });
  await p.ask({ code: 'last' });
  await p.ask({ code: 'score' });
  await p.ask({ text: '我的炮安全吗？' });
  await p.ask({ code: 'why' });
  report('1b turn questions', p, from); from = fake.coachCalls().length;
  p.a.undo(); await sleep(500);
  await p.tryMove(9, 7, 7, 6);
  await p.confirm();
  // a trial that loses something: the rook steps in front of a pawn / into the cannon's line if one is found
  const moves = getLegalMoves(p.state.board, 'red').filter((m) => m.piece.type === 'cannon' && m.captured && m.captured.type === 'horse');
  if (moves.length) {
    await p.tryMove(moves[0].from.row, moves[0].from.col, moves[0].to.row, moves[0].to.col);
    await sleep(300);
    const show = p.stage.model.chips.find((c) => c.ask === 'show');
    if (show) await p.ask({ code: 'show' });
    await p.ask({ code: 'reply' });
    await p.ask({ code: 'better' });
    await p.confirm();
    await sleep(300);
    const takeback = p.stage.model.chips.find((c) => c.action === 'takeback');
    console.log('   takeback offered:', !!takeback, 'locals:', p.stage.model.locals.slice(-3).map((l) => l.text).join(' | '));
  }
  report('1c second and third move', p, from); from = fake.coachCalls().length;
  p.a.resign();
  await p.overCard();
  for (const chipNow of [...p.stage.model.chips]) { if (chipNow.ask) await p.ask({ code: chipNow.ask }); }
  await p.ask({ code: 'why' });
  await p.ask({ text: '下一盘我先走什么好？' });
  report('1d over', p, from); from = fake.coachCalls().length;
  console.log('   over chips at the end:', p.stage.model.chips.map((c) => c.label).join(' | '));
  const saved = p.saved();
  p.close();

  // reload of the finished game: no request
  const q = page({ 'yijian.xiangqi.v2.profile': p.storage.getItem('yijian.xiangqi.v2.profile') });
  await q.coach.probe();
  q.director.loadExtras(saved);
  q.session.restore(saved);
  await q.overCard();
  report('1e reload of the finished game (expect 0 requests)', q, from); from = fake.coachCalls().length;
  q.close();
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. black: the rival opens; trial, question, confirm; then a mate fixture where the child mates
// ---------------------------------------------------------------------------------------------------------------------
{
  const p = page();
  await p.coach.probe();
  let from = fake.coachCalls().length;
  p.session.newGame({ humanColor: 'black' });
  await until(() => p.state.phase === 'childTurn' && p.stage.model.chips.length > 0, 8000, 'the rival\'s first move');
  await sleep(400);
  await p.tryMove(0, 1, 2, 2);
  await p.ask({ code: 'reply' });
  await p.confirm();
  await p.ask({ code: 'intent' });
  report('2a black', p, from); from = fake.coachCalls().length;
  p.close();

  const MATE_FOR_RED = ['7774', '0010', '7434', '1000', '7151', '0010'];
  const saved = { schema: 2, id: 'g-matetest01', humanColor: 'red', moves: MATE_FOR_RED, result: null, startedAt: 1, endedAt: null, activeMs: 0,
                  counted: false, drawFrom: 0, seed: 7, skill: null, memory: null, start: null };
  const q = page();
  await q.coach.probe();
  q.director.loadExtras(saved);
  q.session.restore(saved);
  await sleep(600);
  await q.tryMove(5, 1, 5, 4);
  await sleep(300);
  q.a.confirm();
  await q.overCard();
  for (const chipNow of [...q.stage.model.chips]) { if (chipNow.ask) await q.ask({ code: chipNow.ask }); }
  report('2b the child mates', q, from); from = fake.coachCalls().length;
  q.close();
}

console.log('\nVIOLATIONS', fake.violations.length);
for (const v of fake.violations.slice(0, 20)) console.log('  ', v);
console.log('RESULT unhandled', unhandled, 'console.error', errors, 'timeouts', timeouts, 'requests', fake.coachCalls().length, 'open streams', fake.openStreams());
setTimeout(() => process.exit(unhandled || errors || fake.violations.length ? 1 : 0), 200);
