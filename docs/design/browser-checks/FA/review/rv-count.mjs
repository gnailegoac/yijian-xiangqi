// Review of FA item 1, step 4: can a game be counted twice, or not at all? The repo's director on the repo's rig
// (tests/helpers/fake-ports.js). Every wait is bounded by the rig's virtual clock.
import { pathToFileURL } from 'node:url';

const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const { createDirectorRig } = await import(pathToFileURL(`${REPO}/tests/helpers/fake-ports.js`).href);
const { KEYS } = await import(pathToFileURL(`${REPO}/src/game/store.js`).href);

const sq = (row, col) => ({ row, col });
const ref = (a, b, c, d) => ({ from: sq(a, b), to: sq(c, d) });
const CANNON = ref(7, 7, 7, 4);
const MATE_FOR_RED = ['7774', '0010', '7434', '1000', '7151', '0010'];
const savedGame = (moves, extra = {}) => ({ schema: 2, id: 'g-rvcount001', humanColor: 'red', moves, result: null, startedAt: 1, endedAt: null, activeMs: 0,
                                            counted: false, drawFrom: 0, seed: 7, skill: null, memory: null, start: null, ...extra });
const games = (rig) => JSON.stringify((JSON.parse(rig.storage.getItem(KEYS.profile) ?? 'null') ?? { games: null }).games);
const finishes = (rig) => rig.calls('brain.finishGame').map((e) => e.args[0]).join(',');
const stop = (rig) => { rig.director.dispose(); rig.tasks.dispose(); };
async function tryMove(rig, move) { rig.actions.tap(move.from.row, move.from.col, 'tap'); rig.actions.tap(move.to.row, move.to.col, 'tap'); await rig.settle(); }
async function resign(rig) { rig.actions.resign(); await rig.settle(); await rig.settle(); }
const out = [];
const check = (name, ok, detail) => { out.push(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`); };

// A. resign (counted at once), un-resign, play on, resign again: one loss
{
  const rig = createDirectorRig();
  rig.session.newGame({ humanColor: 'red' });
  await rig.settle();
  await tryMove(rig, CANNON);
  rig.actions.confirm(); await rig.settle(); await rig.advance(1600);
  await resign(rig);
  const first = `${finishes(rig)} ${games(rig)} counted ${rig.state.counted}`;
  rig.actions.undo(); await rig.settle();
  const mid = `${rig.state.phase} counted ${rig.state.counted}`;
  await resign(rig);
  await rig.advance(3000);
  check('A resign, un-resign, resign again', finishes(rig) === 'loss' && games(rig) === '{"played":1,"won":0,"lost":1,"drawn":0}' && rig.calls('stage.over').length === 2,
        `after the first: ${first}; after the undo: ${mid}; in the end: finishGame [${finishes(rig)}] ${games(rig)}, cards ${rig.calls('stage.over').length}`);
  stop(rig);
}

// B. the child mates with the animation held, undoes during the celebration, mates again: one win, one card
{
  const rig = createDirectorRig();
  const saved = savedGame(MATE_FOR_RED);
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await tryMove(rig, ref(5, 1, 5, 4));
  rig.stage.script.hold = true;
  rig.actions.confirm();
  const atMate = `${finishes(rig)} ${games(rig)} cards ${rig.calls('stage.over').length}`;
  rig.actions.undo();                                       // 悔棋 during the celebration
  await rig.settle();
  rig.stage.script.hold = false;
  rig.stage.release();
  await rig.settle();
  await rig.advance(3000);
  const afterUndo = `${rig.state.phase} plies ${rig.state.history.length} counted ${rig.state.counted} cards ${rig.calls('stage.over').length}`;
  await tryMove(rig, ref(5, 1, 5, 4));
  rig.actions.confirm();
  await rig.settle();
  await rig.advance(3000);
  check('B mate, undo during the celebration, mate again', finishes(rig) === 'win' && games(rig) === '{"played":1,"won":1,"lost":0,"drawn":0}' && rig.calls('stage.over').length === 1 && rig.state.phase === 'over',
        `at the mate: ${atMate}; after the undo: ${afterUndo}; in the end: finishGame [${finishes(rig)}] ${games(rig)}, cards ${rig.calls('stage.over').length}, faults ${JSON.stringify(rig.stage.model.faults)}`);
  // C. the page is closed now and opened again twice: counted stays once
  const record = rig.saved();
  const profile = rig.last('store.saveProfile').args[0];
  stop(rig);
  let line = '';
  let ok = true;
  for (let i = 0; i < 2; i++) {
    const again = createDirectorRig({ profile });
    again.director.loadExtras(record);
    again.session.restore(record);
    await again.settle(); await again.settle();
    ok = ok && again.calls('brain.finishGame').length === 0 && again.calls('store.saveProfile').length === 0 && again.state.phase === 'over' && again.calls('stage.over').length === 1;
    line += ` reload ${i + 1}: finishGame ${again.calls('brain.finishGame').length}, saveProfile ${again.calls('store.saveProfile').length}, card ${again.calls('stage.over').length} (quiet ${again.stage.model.over && again.stage.model.over.quiet});`;
    stop(again);
  }
  check('C reload twice after a counted game over', ok, line);
}

// D. a finished game restored uncounted (older build), app.js marks a migrated game as counted right after restore: not counted
{
  const done = savedGame(MATE_FOR_RED.slice(0, 4), { result: { winner: 'black', reason: 'resign' }, endedAt: 5, counted: false });
  const rig = createDirectorRig();
  rig.director.loadExtras(done);
  rig.session.restore(done);
  rig.session.markCounted();                                // app.js step 10, synchronously after restore
  await rig.settle(); await rig.settle();
  check('D markCounted right after restore (v1 game)', rig.calls('brain.finishGame').length === 0 && games(rig) === 'null' && rig.calls('stage.over').length === 1,
        `finishGame ${rig.calls('brain.finishGame').length}, profile games ${games(rig)}, card ${rig.calls('stage.over').length}`);
  stop(rig);
  // ... and without markCounted the same record is counted once (a v2 game that an older build left uncounted)
  const rig2 = createDirectorRig();
  rig2.director.loadExtras(done);
  rig2.session.restore(done);
  await rig2.settle(); await rig2.settle();
  check('D2 an uncounted finished v2 game is counted once at restore', finishes(rig2) === 'loss' && games(rig2) === '{"played":1,"won":0,"lost":1,"drawn":0}', `finishGame [${finishes(rig2)}] ${games(rig2)}`);
  stop(rig2);
}

// E. a new game right in the task of the mating confirm (the double tap that got through): the win stays, one count
{
  const rig = createDirectorRig();
  const saved = savedGame(MATE_FOR_RED);
  rig.director.loadExtras(saved);
  rig.session.restore(saved);
  await rig.settle();
  await tryMove(rig, ref(5, 1, 5, 4));
  rig.stage.script.hold = true;
  rig.actions.confirm();
  rig.actions.newGame();
  rig.actions.newGame();
  await rig.settle();
  rig.stage.script.hold = false; rig.stage.release();
  await rig.settle(); await rig.advance(3000);
  check('E two new games in the task of the mate', finishes(rig) === 'win' && games(rig) === '{"played":1,"won":1,"lost":0,"drawn":0}' && rig.state.history.length === 0,
        `finishGame [${finishes(rig)}] ${games(rig)}, phase ${rig.state.phase}, cards ${rig.calls('stage.over').length}, faults ${JSON.stringify(rig.stage.model.faults)}`);
  stop(rig);
}

console.log(out.join('\n'));
