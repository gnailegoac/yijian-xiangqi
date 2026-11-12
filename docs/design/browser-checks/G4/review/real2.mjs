// Reviewer's real-module run: the director on real session / tasks / store / BrainPort / CoachPort (local narrator), the real
// brain in this process behind the fake worker, real timers; only the stage is the fake. Scenarios the engineer's real1 did not
// cover: mate by the child, mate by the rival, a black child, undo out of a finished game, reload of finished games.
const ROOT = 'file:///C:/Users/USERNAME/git/yijian-xiangqi/';
const { createFakePorts } = await import(ROOT + 'tests/helpers/fake-ports.js');
const { createFakeWorkers } = await import(ROOT + 'tests/helpers/fake-worker.js');
const { createMemoryStorage } = await import(ROOT + 'tests/helpers/memory-storage.js');
const { createBrainPort, createCoachPort } = await import(ROOT + 'src/game/ports.js');
const { createDirector } = await import(ROOT + 'src/game/director.js');
const { createSession } = await import(ROOT + 'src/game/session.js');
const { createTasks } = await import(ROOT + 'src/game/tasks.js');
const { createStore } = await import(ROOT + 'src/game/store.js');
const { createBrain } = await import(ROOT + 'src/core/brain.js');
const teacher = await import(ROOT + 'src/core/teacher.js');

let unhandled = 0, errors = 0, timeouts = 0;
process.on('unhandledRejection', (e) => { unhandled += 1; console.log('UNHANDLED', e); });
const realError = console.error;
console.error = (...args) => { errors += 1; console.log('CONSOLE.ERROR', ...args.map((a) => (a && a.stack ? a.stack : a))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms, what) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) { timeouts += 1; console.log(`TIMEOUT waiting for ${what}`); return false; }
    await sleep(20);
  }
  return true;
}

const MATE_FOR_RED = ['7774', '0010', '7434', '1000', '7151', '0010'];
const MATE_FOR_BLACK = ['9888', '2124', '8898', '2464', '9888', '2747', '8898'];
const savedGame = (moves, extra = {}) => ({ schema: 2, id: 'g-matetest01', humanColor: 'red', moves, result: null, startedAt: 1, endedAt: null, activeMs: 0,
                                            counted: false, drawFrom: 0, seed: 7, skill: null, memory: null, start: null, ...extra });

/** One "page": everything real but the stage. `tweak` may change an opponent payload before the real brain sees it. */
function page(storageInit, tweak) {
  const fakes = createFakePorts();
  const stage = fakes.stage;
  const realBrain = createBrain();
  const host = createFakeWorkers({ autoReady: true, autoAck: true, respond: (job, worker) => {
    const ctl = { cancelled: false, onProgress: (step, data) => { if (worker.running === job.id) worker.progress(job.id, step, JSON.parse(JSON.stringify(data))); } };
    const payload = tweak ? tweak(job.kind, JSON.parse(JSON.stringify(job.payload))) : job.payload;
    realBrain[job.kind](payload, ctl).then(
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
  const coach = createCoachPort({ apiBase: null, forceLocal: false, tasks, brain, getSession: () => session.getState() });
  const save = () => { store.saveGame({ ...session.serialize(), ...director.extras() }); };
  const director = createDirector({ session, tasks, store, brain, coach, stage, profile: loaded.profile, settings: loaded.settings, save,
    rng: Math.random, now: () => Date.now(), setTimer: setTimeout, clearTimer: clearTimeout, reload: () => {} });
  session.subscribe((e) => { if (e.type === 'scope') tasks.sync(e.scope); });
  session.subscribe((e) => { if (e.type === 'change' && e.persist) save(); });
  session.subscribe(director.onEvent);
  stage.on(director.actions);
  const state = session.getState();
  let shown = 0;
  function show(label) {
    console.log(`\n=== ${label}  [phase ${state.phase}, plies ${state.history.map((p) => p.notation).join(' ')}]`);
    for (const entry of fakes.log.slice(shown)) {
      if (entry.op === 'stage.coachLocal') console.log('  local   :', entry.args[0]);
      else if (entry.op === 'stage.caption') console.log('  caption :', entry.args[0]);
      else if (entry.op === 'stage.coachBegin') console.log('  begin   :', entry.args[0].kind, entry.args[0].cue ?? '', entry.args[0].target);
      else if (entry.op === 'stage.coachEnd') { const line = stage.model.lines.find((l) => l.id === entry.args[0]); console.log('  line    :', line ? line.text : '?', `(${entry.args[1].source}/${entry.args[1].reason})`); }
      else if (entry.op === 'stage.verdict') console.log('  verdict :', JSON.stringify({ ...entry.args[0], focus: entry.args[0].focus.length }));
      else if (entry.op === 'stage.chips') console.log('  chips   :', entry.args[0].map((c) => c.label).join(' | '));
      else if (entry.op === 'stage.rival') console.log('  rival   :', JSON.stringify(entry.args[0]));
      else if (entry.op === 'stage.hint') console.log('  hint    :', entry.args[0], JSON.stringify(entry.args[1]).slice(0, 120));
      else if (entry.op === 'stage.committed') console.log('  commit  :', entry.args[0].notation, 'cat', entry.args[0].cat, 'praise', JSON.stringify(entry.args[0].praise), 'stamp', JSON.stringify(entry.args[0].stamp), 'self', entry.args[0].self);
      else if (entry.op === 'stage.rivalMoved') console.log('  rival mv:', entry.args[0].notation, 'lostBig', entry.args[0].lostBig);
      else if (entry.op === 'stage.over') console.log('  over    :', JSON.stringify({ ...entry.args[0], proud: entry.args[0].proud && entry.args[0].proud.notation }));
      else if (entry.op === 'stage.toast') console.log('  toast   :', entry.args[0]);
      else if (entry.op === 'stage.phase') console.log('  phase   :', JSON.stringify(entry.args[0]));
      else if (entry.op === 'stage.arrows' || entry.op === 'stage.preview' || entry.op === 'stage.highlight') console.log(`  ${entry.op.slice(6).padEnd(8)}:`, JSON.stringify(entry.args[0]).slice(0, 110));
    }
    shown = fakes.log.length;
  }
  const finals = () => fakes.calls('stage.verdict').filter((e) => e.args[0].final).length;
  const a = director.actions;
  return {
    fakes, stage, session, state, director, tasks, store, storage, a, show, coach,
    async tryMove(fr, fc, tr, tc, wait = true) {
      const n = finals();
      a.tap(fr, fc, 'tap');
      a.tap(tr, tc, 'tap');
      if (wait) { await until(() => finals() > n, 6000, 'the final verdict'); await sleep(120); }
    },
    async overCard() {
      await until(() => stage.model.over !== null && fakes.calls('coach.beginOver').length + fakes.calls('stage.coachBegin').filter((e) => e.args[0].target === 'card').length > 0, 8000, 'the over card line');
      await sleep(200);
    },
    saved: () => ({ ...session.serialize(), ...director.extras() }),
    close() { director.dispose(); tasks.dispose(); },
    faults: () => stage.model.faults,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// A. the child mates (after the assessment), asks after the game, undoes out of the finished game, mates again at once
// ---------------------------------------------------------------------------------------------------------------------
{
  const p = page();
  const saved = savedGame(MATE_FOR_RED);
  p.director.loadExtras(saved);
  p.session.restore(saved);
  await sleep(600);
  p.show('A: restored one before mate');
  await p.tryMove(5, 1, 5, 4);
  p.show('A: trial of the mating move');
  p.a.ask({ code: 'good' }); await sleep(900);
  p.a.confirm();
  await p.overCard();
  p.show('A: mate by the child');
  p.a.ask({ code: 'proud' }); await sleep(900);
  p.a.ask({ code: 'why' }); await sleep(900);
  p.a.ask({ code: 'next' }); await sleep(900);
  p.a.ask({ code: 'improve' }); await sleep(900);
  p.show('A: questions after the game');
  const finished = p.saved();
  console.log('A saved: counted', finished.counted, 'result', finished.result, 'samples', finished.skill.samples.map((s) => `${s.ply}:${s.final.cat}`).join(' '));
  p.a.undo(); await sleep(500);
  p.show('A: undo out of the finished game');
  await p.tryMove(5, 1, 5, 4, false);
  p.a.confirm();                                   // at once: before the verdict
  await p.overCard();
  p.show('A: mate again, confirmed at once');
  console.log('A faults', p.faults(), 'profile', p.storage.getItem('yijian.xiangqi.v2.profile').slice(0, 200));
  p.close();

  // D1. reload of that finished game
  const q = page({ 'yijian.xiangqi.v2.profile': p.storage.getItem('yijian.xiangqi.v2.profile') });
  q.director.loadExtras(finished);
  q.session.restore(finished);
  await q.overCard();
  q.show('D1: reload of the game the child won');
  q.a.ask({ code: 'proud' }); await sleep(900);
  q.a.ask({ code: 'why' }); await sleep(300);
  q.show('D1: questions');
  console.log('D1 faults', q.faults());
  q.close();
}

// ---------------------------------------------------------------------------------------------------------------------
// B. the rival mates (a strong rival: level 9 in the payload), then reload
// ---------------------------------------------------------------------------------------------------------------------
{
  const p = page(undefined, (kind, payload) => { if (kind === 'opponent') { payload.ctx.level = 9; payload.ctx.firstGame = false; payload.ctx.bandShift = 0; } return payload; });
  const saved = savedGame(MATE_FOR_BLACK);
  p.director.loadExtras(saved);
  p.session.restore(saved);
  await until(() => p.state.phase !== 'opponentTurn', 8000, 'the rival');
  if (p.state.phase === 'over') {
    await p.overCard();
    p.show('B: mate by the rival');
    p.a.ask({ code: 'next' }); await sleep(900);
    p.a.ask({ code: 'why' }); await sleep(900);
    p.show('B: questions');
    const finished = p.saved();
    p.a.undo(); await sleep(600);
    p.show('B: undo out of the lost game (two plies)');
    console.log('B faults', p.faults());
    p.close();
    const q = page();
    q.director.loadExtras(finished);
    q.session.restore(finished);
    await q.overCard();
    q.show('D2: reload of the lost game');
    console.log('D2 faults', q.faults());
    q.close();
  } else {
    p.show('B: the rival did NOT mate (spared)');
    p.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// C. a black child: the rival opens; trial, pouches, questions, confirm, undo, resign during the rival's turn
// ---------------------------------------------------------------------------------------------------------------------
{
  const p = page();
  p.session.newGame({ humanColor: 'black' });
  await until(() => p.state.phase === 'childTurn' && p.stage.model.chips.length > 0, 8000, 'the rival\'s first move');
  await sleep(300);
  p.show('C: black child, the rival opened');
  await p.tryMove(0, 1, 2, 2);                     // 马2进3
  p.show('C: trial');
  p.a.ask({ code: 'reply' }); await sleep(900);
  p.a.retract(); await sleep(100);
  p.a.tap(0, 1, 'tap');
  p.a.hint(); await sleep(300); p.a.hint(); await sleep(300); p.a.hint(); await sleep(300);
  p.show('C: three pouches');
  const chip = p.stage.model.chips.find((c) => c.action === 'pouch');
  if (chip) { p.a.chip(chip); await sleep(600); }
  p.show('C: the pouch chip tried the move');
  const plies = p.state.history.length;
  p.a.confirm();
  await until(() => p.state.history.length === plies + 2 && p.state.phase === 'childTurn' && p.stage.model.chips.length > 0, 12000, 'the rival');
  await sleep(300);
  p.show('C: confirmed; the rival moved');
  p.a.ask({ code: 'intent' }); await sleep(900);
  p.a.ask({ code: 'last' }); await sleep(900);
  p.a.ask({ code: 'score' }); await sleep(300);
  p.show('C: turn questions');
  p.a.undo(); await sleep(500);
  p.show('C: undo');
  await p.tryMove(2, 1, 2, 4);                     // 炮2平5
  p.a.confirm();
  await sleep(50);
  p.stage.script.dialog.resign = true;
  p.a.resign();                                    // while the rival thinks
  await p.overCard();
  p.show('C: resigned during the rival\'s turn');
  p.a.undo(); await sleep(600);
  p.show('C: undo of the resignation (rival was to move: pop 1)');
  console.log('C faults', p.faults(), 'skill marks', p.director.extras().skill.marks.map((m) => m.ply).join(','), 'samples', p.director.extras().skill.samples.map((s) => s.ply).join(','));
  p.close();
}

console.log('\nRESULT unhandled', unhandled, 'console.error', errors, 'timeouts', timeouts);
setTimeout(() => process.exit(unhandled || errors || timeouts ? 1 : 0), 200);
