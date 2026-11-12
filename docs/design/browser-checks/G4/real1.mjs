// The director on the REAL modules (no proxy, no browser): real session, tasks, store, real BrainPort and CoachPort (local narrator),
// the real brain in this process behind the fake worker, real timers; only the stage is the fake. A short game by hand.
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

let unhandled = 0, errors = 0;
process.on('unhandledRejection', (e) => { unhandled += 1; console.log('UNHANDLED', e); });
const realError = console.error;
console.error = (...args) => { errors += 1; realError('CONSOLE.ERROR', ...args); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms, what) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) { console.log(`TIMEOUT waiting for ${what}`); return false; }
    await sleep(20);
  }
  return true;
}

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
const storage = createMemoryStorage();
const store = createStore({ storage, teacher });
const loaded = store.load();
const coachDeps = { apiBase: null, forceLocal: false, tasks, brain, getSession: () => session.getState() };
const coach = createCoachPort(coachDeps);
let saves = 0;
const save = () => { saves += 1; store.saveGame({ ...session.serialize(), ...director.extras() }); };
const director = createDirector({ session, tasks, store, brain, coach, stage, profile: loaded.profile, settings: loaded.settings, save,
  rng: Math.random, now: () => Date.now(), setTimer: setTimeout, clearTimer: clearTimeout, reload: () => {} });
session.subscribe((e) => { if (e.type === 'scope') tasks.sync(e.scope); });
session.subscribe((e) => { if (e.type === 'change' && e.persist) save(); });
session.subscribe(director.onEvent);
stage.on(director.actions);
const state = session.getState();
const a = director.actions;

let shown = 0;
function show(label) {
  console.log(`\n=== ${label}  [phase ${state.phase}, plies ${state.history.map((p) => p.notation).join(' ')}]`);
  for (const entry of fakes.log.slice(shown)) {
    if (entry.op === 'stage.coachLocal') console.log('  local   :', entry.args[0]);
    else if (entry.op === 'stage.caption') console.log('  caption :', entry.args[0]);
    else if (entry.op === 'stage.coachBegin') console.log('  begin   :', entry.args[0].kind, entry.args[0].cue ?? '', entry.args[0].target);
    else if (entry.op === 'stage.coachEnd') { const line = stage.model.lines.find((l) => l.id === entry.args[0]); console.log('  line    :', line ? line.text : '?', `(${entry.args[1].source})`); }
    else if (entry.op === 'stage.verdict') console.log('  verdict :', JSON.stringify({ ...entry.args[0], focus: entry.args[0].focus.length }));
    else if (entry.op === 'stage.chips') console.log('  chips   :', entry.args[0].map((c) => c.label).join(' | '));
    else if (entry.op === 'stage.rival') console.log('  rival   :', JSON.stringify(entry.args[0]));
    else if (entry.op === 'stage.hint') console.log('  hint    :', entry.args[0], JSON.stringify(entry.args[1]).slice(0, 120));
    else if (entry.op === 'stage.committed') console.log('  commit  :', entry.args[0].notation, 'cat', entry.args[0].cat, 'praise', JSON.stringify(entry.args[0].praise), 'stamp', JSON.stringify(entry.args[0].stamp));
    else if (entry.op === 'stage.rivalMoved') console.log('  rival mv:', entry.args[0].notation);
    else if (entry.op === 'stage.over') console.log('  over    :', JSON.stringify({ ...entry.args[0], proud: entry.args[0].proud && entry.args[0].proud.notation }));
    else if (entry.op === 'stage.toast') console.log('  toast   :', entry.args[0]);
    else if (entry.op === 'stage.arrows' || entry.op === 'stage.preview' || entry.op === 'stage.highlight') console.log(`  ${entry.op.slice(6).padEnd(8)}:`, JSON.stringify(entry.args[0]).slice(0, 110));
    else if (entry.op === 'stage.tension') console.log('  tension :', entry.args[0].toFixed(2));
  }
  shown = fakes.log.length;
}
const finals = () => fakes.calls('stage.verdict').filter((e) => e.args[0].final).length;
async function tryMove(fr, fc, tr, tc) {
  const n = finals();
  a.tap(fr, fc, 'tap');
  a.tap(tr, tc, 'tap');
  await until(() => finals() > n, 6000, 'the final verdict');
  await sleep(120);
}
async function confirm() {
  const plies = state.history.length;
  a.confirm();
  await until(() => state.phase === 'over' || (state.history.length === plies + 2 && state.phase !== 'opponentTurn'), 12000, 'the rival');
  await until(() => stage.model.chips.length > 0 || state.phase === 'over', 3000, 'the turn chips');
  await sleep(150);
}

session.newGame({ humanColor: 'red' });
await until(() => fakes.calls('stage.tension').length > 0, 8000, 'the first survey');
show('new game, survey done');

await tryMove(7, 7, 7, 4);
show('trial 炮二平五');
await confirm();
show('confirmed; rival moved');

a.hint(); await sleep(250);
a.hint(); await sleep(250);
a.hint(); await sleep(250);
show('three pouches');

a.tap(state.selected.row, state.selected.col, 'tap');
await tryMove(7, 4, 3, 4);                    // 炮五进四: takes the central pawn
show('trial 炮五进四');
a.ask({ code: 'good' }); await sleep(900);
a.ask({ code: 'reply' }); await sleep(900);
a.ask({ code: 'better' }); await sleep(900);
a.ask({ code: 'why' }); await sleep(300);
show('questions about the trial');
await confirm();
show('confirmed 炮五进四; rival moved');
await sleep(900);
a.ask({ code: 'intent' }); await sleep(900);
a.ask({ code: 'danger' }); await sleep(900);
a.ask({ code: 'last' }); await sleep(900);
a.ask({ code: 'score' }); await sleep(300);
show('turn questions');

await tryMove(9, 7, 7, 6);
show('trial 马二进三');
await confirm();
show('confirmed; rival moved');
a.undo(); await sleep(400);
show('undo');
await until(() => fakes.calls('stage.tension').length > 0, 3000, 'survey');
await tryMove(9, 8, 8, 8);
await confirm();
show('车一进一 instead');

a.resign();
await until(() => stage.model.over !== null && stage.model.chips.length > 0, 5000, 'the over card');
await sleep(200);
show('resigned');
a.ask({ code: 'proud' }); await sleep(900);
a.ask({ code: 'why' }); await sleep(900);
a.ask({ code: 'next' }); await sleep(900);
show('after the game');

const saved = { ...session.serialize(), ...director.extras() };
console.log('\nsaved: moves', saved.moves.join(','), 'counted', saved.counted, 'activeMs', saved.activeMs, 'samples', saved.skill.samples.map((s) => `${s.ply}:${s.first.cat}/${s.final.cat}/${s.final.loss}`).join(' '),
  'marks', saved.skill.marks.map((m) => m.ply).join(','));
console.log('profile:', JSON.stringify(JSON.parse(storage.getItem('yijian.xiangqi.v2.profile'))).slice(0, 400));
console.log('faults', stage.model.faults, 'unhandled', unhandled, 'console.error', errors, 'saves', saves, 'tasks', JSON.stringify(tasks.stats()));
director.dispose();
tasks.dispose();
setTimeout(() => process.exit(unhandled || errors ? 1 : 0), 100);
