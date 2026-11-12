// G4 soak: scripted games of random legal taps, undos, hints, questions, new games, resignations and reloads against a fake
// brain that answers in random order and sometimes late (also after its job was cancelled), sometimes fails, sometimes never.
// After every batch the session and the stage fake must agree on the position; no unhandled rejection, no console error,
// no thread use the wire rules would refuse, no refused opponentMove / opponentFailed.
//
//   node soak.mjs [games=320] [seed=1]

import { createDirectorRig, fakeTable, fakeSurvey, fakeAssessed, fakeOpponentTurn } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/tests/helpers/fake-ports.js';
import { mulberry32 } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/tests/helpers/playout.js';
import { getLegalMoves, applyMove, fenToBoard } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js';
import { describeMove } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/notation.js';
import { ASK_CODES } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/codes.js';

const GAMES = Number(process.argv[2] ?? 320);
const SEED = Number(process.argv[3] ?? 1);
const MAX_STEPS = 140;                     // per game
const started = Date.now();

const stats = { games: 0, steps: 0, childMoves: 0, rivalMoves: 0, undos: 0, newGames: 0, resigns: 0, reloads: 0, hints: 0, asks: 0, trials: 0, retracts: 0,
                naturalEnds: 0, rivalMates: 0, childMates: 0, mateFixtures: 0, jobs: 0, lateAnswers: 0, jobErrors: 0, jobSilences: 0, lateDrops: 0, respawns: 0, replies: 0, lateReplies: 0, overCards: 0,
                failedRival: 0, retries: 0 };
const problems = [];
const problem = (text) => { if (problems.length < 40) problems.push(text); };

let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled += 1; problem(`unhandled rejection: ${String(e && e.stack ? e.stack : e).slice(0, 400)}`); });
let errors = 0;
const realError = console.error;
console.error = (...args) => { errors += 1; problem(`console.error: ${args.map((a) => String(a && a.stack ? a.stack : a)).join(' ').slice(0, 500)}`); };

const rnd = mulberry32(SEED);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const sq = (row, col) => ({ row, col });
const same = (a, b) => a.row === b.row && a.col === b.col;

/** One rig per "page load"; a reload makes a new one from the stored game. */
function makeRig(storage) {
  const rig = createDirectorRig({ brain: 'manual', seed: Math.floor(rnd() * 1e9), storage });
  rig.seen = new Set();                    // `${workerIndex}:${jobId}` already scheduled
  rig.refused = [];
  // the director's own async session calls must never be refused
  for (const name of ['opponentMove', 'opponentFailed']) {
    const real = rig.session[name];
    rig.session[name] = (...args) => {
      const r = real(...args);
      if (!r.ok) rig.refused.push(`${name}: ${r.reason}`);
      return r;
    };
  }
  const mode = rnd();
  if (mode < 0.35) { rig.coach.script.llm = 'sync'; rig.coach.setMode('llm', null, true); }
  else if (mode < 0.7) { rig.coach.script.llm = 'manual'; rig.coach.setMode('llm', null, chance(0.5)); }
  rig.coach.script.text = (event) => (chance(0.08) ? '' : undefined);      // sometimes there is nothing to say
  return rig;
}

/** Schedules an answer for every job message the fake workers have not been answered for yet. */
function scheduleAnswers(rig) {
  rig.host.workers.forEach((worker, index) => {
    for (const job of worker.jobs) {
      const key = `${index}:${job.id}`;
      if (rig.seen.has(key)) continue;
      rig.seen.add(key);
      stats.jobs += 1;
      const fate = rnd();
      if (fate < 0.03) { stats.jobSilences += 1; continue; }                 // never answered: the job's timeout must clean up
      const delay = fate < 0.45 ? 0 : fate < 0.85 ? Math.floor(rnd() * 400) : Math.floor(rnd() * 4000);      // sometimes late
      if (job.kind === 'survey') {
        const steps = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < steps; k++) {
          rig.clock.setTimer(() => {
            if (worker.terminated) return;
            const { board, turn } = positionOf(job.payload.fen);
            const legal = getLegalMoves(board, turn);
            if (legal.length === 0) return;
            worker.emit({ t: 'progress', id: job.id, kind: 'survey', stage: 'table', data: fakeTable(job.payload.fen, { depth: 2 + k + Math.floor(rnd() * 3), best: pick(legal), bestScore: Math.floor(rnd() * 300) }) });
            if (chance(0.6)) worker.emit({ t: 'progress', id: job.id, kind: 'survey', stage: 'threat', data: null });
          }, Math.floor(delay * (k + 1) / (steps + 1)));
        }
      }
      rig.clock.setTimer(() => {
        if (worker.terminated) return;
        if (worker.running !== job.id) stats.lateAnswers += 1;                // answered although cancelled or superseded: must be dropped
        if (chance(0.04)) { stats.jobErrors += 1; worker.error(job.id, 'soak: job failed'); return; }
        let data;
        try {
          data = answerFor(job);
        } catch (e) {
          worker.error(job.id, String(e));
          return;
        }
        worker.done(job.id, data);
      }, delay);
    }
  });
}

const positionOf = (fen) => fenToBoard(fen);

function answerFor(job) {
  const payload = job.payload;
  if (job.kind === 'survey') {
    const { board, turn } = positionOf(payload.fen);
    const legal = getLegalMoves(board, turn);
    const best = legal.length ? pick(legal) : undefined;
    const group = best && chance(0.3) ? [describeMove(board, best)] : null;
    return fakeSurvey(payload, { depth: 4 + Math.floor(rnd() * 5), best, bestScore: Math.floor(rnd() * 400) - 100, tension: rnd(),
                                 test: group ? { tier: pick([1, 2, 3]), kind: pick(['win', 'save']), group } : null,
                                 traps: chance(0.2) ? [pick(['greedy', 'miss_threat'])] : [] });
  }
  if (job.kind === 'assess') {
    const cat = pick(['brilliant', 'best', 'best', 'good', 'good', 'good', 'ok', 'mistake', 'blunder', 'blunder']);
    const bad = cat === 'mistake' || cat === 'blunder';
    return fakeAssessed(payload, {
      cat,
      lose: bad && chance(0.6) ? pick(['horse', 'rook', 'cannon', 'pawn']) : undefined,
      danger: pick(['hangs_moved_piece', 'leaves_hanging', 'unguards', 'allows_mate', 'misses_win', 'slow']),
      flags: { allowsMate: bad && chance(0.15), onlyMove: chance(0.2), sacrifice: chance(0.05) },
      revealBest: pick([1, 1, 2, 3, 4]),
    });
  }
  if (job.kind === 'opponent') {
    const { board, turn } = positionOf(payload.fen);
    const legal = getLegalMoves(board, turn);
    let index = Math.floor(rnd() * Math.max(1, legal.length));
    const mating = legal.findIndex((m) => getLegalMoves(applyMove(board, m), turn === 'red' ? 'black' : 'red').length === 0);
    if (mating >= 0 && chance(0.9)) { index = mating; stats.rivalMates += 1; }
    const extra = {};
    if (chance(0.15) && legal.length) {
      const after = applyMove(board, legal[index]);
      const replies = getLegalMoves(after, turn === 'red' ? 'black' : 'red');
      if (replies.length) extra.chance = { gain: 400, points: 4, tier: pick([1, 2, 3]), revealDepth: 2, line: { start: payload.fen, moves: [describeMove(after, pick(replies))], end: 'quiet' } };
      extra.kind = 'chance';
    } else if (chance(0.05)) {
      extra.overlooked = { gain: 2000, mate: true, line: { start: payload.fen, moves: [], end: 'mate' } };
      extra.kind = 'overlook';
    }
    return fakeOpponentTurn(payload, { index, childMoveCp: Math.floor(rnd() * 800) - 400, evalAfter: Math.floor(rnd() * 1200) - 600, tension: rnd(),
                                       mode: pick(['press', 'spar', 'ease', 'finish']), evalBest: Math.floor(rnd() * 1400) - 400, ...extra });
  }
  throw new Error(`soak: unknown job kind ${job.kind}`);
}

/** What must hold after every batch. */
function check(rig, where) {
  const state = rig.state;
  const model = rig.stage.model;
  if (rig.coach.violations.length) { problem(`${where}: thread violation ${rig.coach.violations.join(' | ')}`); rig.coach.violations.length = 0; }
  if (rig.refused.length) { problem(`${where}: refused ${rig.refused.join(' | ')}`); rig.refused.length = 0; }
  if (state.gameId === 0) return;
  if (model.board !== state.board) problem(`${where}: the stage shows another position (phase ${state.phase}, ply ${state.history.length})`);
  if ((model.trial ?? null) !== (state.trial ? state.trial.move : null)) problem(`${where}: the stage's trial differs (phase ${state.phase})`);
  if (model.phase !== state.phase) problem(`${where}: the stage's phase is ${model.phase}, the session's ${state.phase}`);
  if (model.ply !== state.history.length) problem(`${where}: the stage's ply is ${model.ply}, the session's ${state.history.length}`);
  if (model.failed !== state.opponentFailed) problem(`${where}: failed flag differs`);
  if (model.faults.length) { problem(`${where}: stage fault ${model.faults.join(' | ')}`); model.faults.length = 0; }
  if (model.chips.length > 4) problem(`${where}: ${model.chips.length} chips`);
  if (new Set(model.chips.map((c) => c.id)).size !== model.chips.length) problem(`${where}: duplicate chips`);
  if (state.phase === 'opponentTurn' && model.chips.length) problem(`${where}: chips during the rival's turn`);
  const skill = rig.director.extras().skill;
  let lastPly = -1;
  for (const mark of skill.marks) {
    if (mark.ply <= lastPly) problem(`${where}: skill marks out of order (${skill.marks.map((m) => m.ply).join(',')})`);
    lastPly = mark.ply;
  }
  if (lastPly > state.history.length) problem(`${where}: a skill mark at ply ${lastPly} with ${state.history.length} plies played`);
  for (const sample of skill.samples) {
    if (sample.ply >= state.history.length + 0 && sample.ply > state.history.length - 1) problem(`${where}: a sample at ply ${sample.ply} with ${state.history.length} plies`);
    if (!(sample.final.loss >= 0 && sample.final.loss <= 600 && sample.first.loss >= 0 && sample.first.loss <= 600)) problem(`${where}: sample loss out of range`);
    if (typeof sample.final.cat !== 'string') problem(`${where}: a recorded sample without a verdict`);
  }
  // 司马懿 never gloats: the move that ended the game carried no line
  if (state.phase === 'over' && state.history.length && state.history.at(-1).by === 'opponent' && state.result.reason !== 'resign') {
    const calls = rig.log;
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i].op === 'stage.rivalMoved') {
        const next = calls.slice(i + 1).find((entry) => entry.op === 'stage.rival');
        if (next && next.args[0].line !== undefined && rig.rivalEndChecked !== i) problem(`${where}: 司马懿 said "${next.args[0].line}" with the move that ended the game`);
        rig.rivalEndChecked = i;
        break;
      }
    }
  }
}

function randomAction(rig) {
  const state = rig.state;
  const a = rig.actions;
  const r = rnd();
  const phase = state.phase;
  // coach replies in flight: text arrives, ends, or is left hanging
  if (rig.coach.replies.length && chance(0.5)) {
    const reply = pick(rig.coach.replies);
    stats.replies += 1;
    reply.push(pick(['好。', '【炮二平五】不错', '先看这里。', '']));
    if (chance(0.7)) reply.finish(chance(0.1) ? { cut: true, source: 'mixed' } : undefined);
    return 'reply';
  }
  if (rig.stage.pending() && chance(0.6)) { rig.stage.release(); return 'release'; }
  if (r < 0.02) { rig.stage.script.hold = !rig.stage.script.hold; if (!rig.stage.script.hold) rig.stage.release(); return 'hold'; }
  if (r < 0.03) { a.setting('talk', chance(0.5) ? 'more' : 'smart'); return 'setting'; }
  if (r < 0.04) { rig.director.visibility(false); rig.director.visibility(true); return 'visibility'; }
  if (r < 0.045) { a.stopCoach(); return 'stop'; }
  if (r < 0.07) { a.activity(); return 'activity'; }
  if (r < 0.12) { stats.hints += 1; a.hint(); return 'hint'; }
  if (r < 0.22) {
    stats.asks += 1;
    if (chance(0.2)) a.ask({ text: pick(['为什么这样走？', '我的车安全吗', '  ', '下一步呢']) });
    else if (rig.stage.model.chips.length && chance(0.8)) {
      const chip = pick(rig.stage.model.chips);
      if (chip.action) a.chip(chip); else a.ask({ code: chip.ask });
    } else a.ask({ code: pick(ASK_CODES) });
    return 'ask';
  }
  if (r < 0.27) { if (phase !== 'opponentTurn' || chance(0.5)) { stats.undos += 1; a.undo(); } return 'undo'; }
  if (r < 0.275) { stats.resigns += 1; a.resign(); return 'resign'; }
  if (r < 0.28 && state.gameId) { rig.stage.script.dialog['new-game'] = chance(0.2) ? null : { humanColor: pick(['red', 'black']) }; a.newGame(); return 'newGame'; }
  if (r < 0.29) { a.retryOpponent(); a.retryEngine(); return 'retry'; }
  if (r < 0.31) {
    const link = { from: sq(7, 7), to: sq(7, 4), color: 'red', code: '7774', pre: [], playable: true, src: 'better' };
    a.moveLink(link, chance(0.5));
    if (chance(0.3)) a.playLine([link]);
    return 'link';
  }
  // the board
  if ((phase === 'childTurn' || phase === 'selected') && chance(0.5)) {
    const rival = state.humanColor === 'red' ? 'black' : 'red';
    const mate = getLegalMoves(state.board, state.humanColor).find((m) => getLegalMoves(applyMove(state.board, m), rival).length === 0);
    if (mate) {
      if (!state.selected || !same(state.selected, mate.from)) a.tap(mate.from.row, mate.from.col, 'tap');
      a.tap(mate.to.row, mate.to.col, 'tap');
      a.tap(mate.to.row, mate.to.col, 'tap');
      stats.childMates += 1;
      return 'mate';
    }
  }
  if (phase === 'tentative' && state.trial) {
    const t = state.trial.move;
    if (r < 0.62) { a.tap(t.to.row, t.to.col, 'tap'); return 'confirm'; }
    if (r < 0.70) { stats.retracts += 1; a.tap(t.from.row, t.from.col, 'tap'); return 'retract'; }
    if (r < 0.75) { a.confirm(); return 'confirm'; }
    if (r < 0.80) { a.retract(); return 'retract'; }
    if (r < 0.90 && state.targets.length) { const m = pick(state.targets); a.tap(m.to.row, m.to.col, 'tap'); return 'switch'; }
  }
  if (phase === 'selected' && state.targets.length && r < 0.85) { const m = pick(state.targets); stats.trials += 1; a.tap(m.to.row, m.to.col, 'tap'); return 'try'; }
  if (phase === 'childTurn' || phase === 'selected' || phase === 'opponentTurn' || phase === 'tentative') {
    const mine = getLegalMoves(state.board, state.humanColor);
    if (mine.length && r < 0.93) { const m = pick(mine); a.tap(m.from.row, m.from.col, 'tap'); return 'pick'; }
  }
  a.tap(Math.floor(rnd() * 10), Math.floor(rnd() * 9), 'tap');
  return 'tap';
}

async function playGames() {
  let rig = makeRig();
  let lastGame = 0, lastPlies = 0, steps = 0;
  const MATE_FOR_CHILD = ['7774', '0010', '7434', '1000', '7151', '0010'];
  const MATE_FOR_RIVAL = ['9888', '2124', '8898', '2464', '9888', '2747', '8898'];
  const begin = () => {
    const r = rnd();
    if (r < 0.2) {
      // a game one move before a mate: by the child (red to move), or by the rival (black to move)
      const saved = { schema: 2, id: 'g-soakmate01', humanColor: 'red', moves: r < 0.1 ? MATE_FOR_CHILD : MATE_FOR_RIVAL, result: null, startedAt: 1, endedAt: null,
                      activeMs: 0, counted: false, drawFrom: 0, seed: 7, skill: null, memory: null, start: null };
      rig.director.loadExtras(saved);
      const out = rig.session.restore(saved);
      if (out.truncatedAt !== null) problem('soak: the mate fixture did not replay');
      stats.mateFixtures += 1;
    } else {
      rig.session.newGame({ humanColor: chance(0.25) ? 'black' : 'red' });
    }
    stats.games += 1; steps = 0;
  };
  begin();
  while (stats.games <= GAMES) {
    scheduleAnswers(rig);
    await rig.settle();
    check(rig, `game ${stats.games} step ${steps} (start)`);
    const what = randomAction(rig);
    await rig.settle();
    scheduleAnswers(rig);
    const wait = rnd();
    await rig.advance(wait < 0.4 ? 0 : wait < 0.8 ? Math.floor(rnd() * 1200) : wait < 0.97 ? Math.floor(rnd() * 5000) : 25000 + Math.floor(rnd() * 80000));
    scheduleAnswers(rig);
    await rig.settle();
    check(rig, `game ${stats.games} step ${steps} after ${what}`);
    steps += 1;
    stats.steps += 1;

    const state = rig.state;
    if (state.gameId !== lastGame) { if (lastGame !== 0 && state.gameId > lastGame) { stats.newGames += 1; stats.games += 1; steps = 0; } lastGame = state.gameId; lastPlies = 0; }
    if (state.history.length > lastPlies) {
      for (let i = lastPlies; i < state.history.length; i++) { if (state.history[i].by === 'child') stats.childMoves += 1; else stats.rivalMoves += 1; }
    }
    lastPlies = state.history.length;
    if (state.opponentFailed) { stats.failedRival += 1; if (chance(0.7)) { stats.retries += 1; rig.actions.retryOpponent(); } }

    const over = state.phase === 'over' && state.result !== null;
    if (over || steps >= MAX_STEPS) {
      // let everything of this game finish: answers, animations, replies, timers
      for (let k = 0; k < 6; k++) {
        rig.stage.release();
        for (const reply of [...rig.coach.replies]) reply.finish();
        scheduleAnswers(rig);
        await rig.advance(4000);
        if (rig.state.opponentFailed) rig.actions.retryOpponent();
      }
      check(rig, `game ${stats.games} drained`);
      if (rig.state.phase === 'opponentTurn' && !rig.state.opponentFailed) problem(`game ${stats.games}: the rival never moved (liveness)`);
      if (rig.state.phase === 'over' && rig.state.result) {
        if (rig.state.result.reason !== 'resign') stats.naturalEnds += 1;
        if (rig.stage.model.over) stats.overCards += 1; else problem(`game ${stats.games}: the game is over and no card was shown`);
        const res = rig.state.result, view = rig.stage.model.over;
        if (view) {
          const want = res.winner === null ? 'draw' : res.winner === rig.state.humanColor ? 'win' : 'loss';
          if (view.result !== want || view.reason !== res.reason) problem(`game ${stats.games}: the card says ${view.result}/${view.reason}, the session ${want}/${res.reason}`);
          if (view.byChildMate !== (res.reason === 'checkmate' && want === 'win')) problem(`game ${stats.games}: byChildMate is wrong`);
        }
        if (!rig.state.counted) problem(`game ${stats.games}: a finished game was not counted`);
      }
      const t = rig.tasks.stats();
      const next = rnd();
      if (next < 0.25 && rig.state.gameId) {
        // a reload: a new page on the stored game
        const dump = rig.storage.dump();
        stats.lateDrops += t.lateDrops; stats.respawns += Math.max(0, t.spawned - 1);
        rig.director.dispose(); rig.tasks.dispose();
        rig = makeRig(dump);
        const loaded = rig.store.load();
        stats.reloads += 1;
        if (loaded.game) {
          rig.director.loadExtras(loaded.game);
          const result = rig.session.restore(loaded.game);
          rig.director.notices(loaded.notices, { truncatedAt: result.truncatedAt });
          stats.games += 1; steps = 0; lastGame = rig.state.gameId; lastPlies = rig.state.history.length;
          if (rig.state.phase === 'over') { rig.stage.release(); await rig.settle(); begin(); lastGame = rig.state.gameId; lastPlies = 0; }
        } else {
          begin(); lastGame = rig.state.gameId; lastPlies = 0;
        }
      } else if (next < 0.5) {
        stats.lateDrops += t.lateDrops; stats.respawns += Math.max(0, t.spawned - 1);
        rig.director.dispose(); rig.tasks.dispose();
        rig = makeRig();
        begin(); lastGame = rig.state.gameId; lastPlies = 0;
      } else {
        rig.stage.script.dialog['new-game'] = { humanColor: pick(['red', 'black']) };
        rig.actions.newGame();
        await rig.settle();
        if (rig.state.gameId === lastGame) begin();
        else { stats.games += 1; steps = 0; }
        lastGame = rig.state.gameId; lastPlies = 0;
      }
    }
    if (Date.now() - started > 8 * 60 * 1000) { problem('soak: time limit reached'); break; }
  }
  const t = rig.tasks.stats();
  stats.lateDrops += t.lateDrops; stats.respawns += Math.max(0, t.spawned - 1);
  rig.director.dispose(); rig.tasks.dispose();
}

await playGames();
await new Promise((resolve) => setImmediate(resolve));
console.error = realError;
console.log(JSON.stringify({ seed: SEED, ...stats, unhandledRejections: unhandled, consoleErrors: errors, problems: problems.length, seconds: Math.round((Date.now() - started) / 1000) }, null, 1));
for (const text of problems) console.log('PROBLEM', text);
process.exitCode = problems.length || unhandled || errors ? 1 : 0;
