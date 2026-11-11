import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PATH, DEVICES, PAIRINGS, barLines, defaultJobs, failedBars, gameSeed, judgeBars, newWatch, observe, parseArgs, runSimulation, summarize, tableLines,
} from '../../../scripts/sim.js';
import { fenToBoard, getLegalMoves } from '../../../src/core/engine.js';
import { createSearcher, scoreToCp } from '../../../src/core/search.js';
import { createGameSkill, createSkillProfile, teachingContext } from '../../../src/core/teacher.js';

// scripts/sim.js, the teaching-opponent simulation (contract section 14.1 with the bars of CONTRACT-NOTES 130).
// The pure parts are tested on hand-built data with expected values worked out here: argument parsing, the seed of a
// game, the pairings, the aggregation of game records, every bar at its edge, the printed lines. Smoke runs play real
// (shortened) games on one worker thread: a game must be the same whether it is played alone or after other games of
// its worker, the state the teacher keeps must show in the record, and the brain path must repeat itself on its
// virtual clock. The pool is tested with a game that does not finish in time, a worker that is busy when its time is
// up and a worker that dies; the command line with a full (one-game) run.
//
// Memory safety (CONTRACT-NOTES 125, 128): every test has a time limit, every wait for the worker pool is bounded, the
// games have a ply limit and a time limit of their own, and results are compared as strings with assert.ok, never
// with deepEqual on a bulky object.

const SIM = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'sim.js');

let overdue = false;
/** Waits for `promise` at most `ms`. @template T @param {Promise<T>} promise @param {number} ms @param {string} what @returns {Promise<T>} */
function within(promise, ms, what) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      overdue = true;
      reject(new Error(`${what} did not finish within ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
// A pool that never answered may still own worker threads, which would keep this process alive: end it.
after(() => {
  if (overdue) setTimeout(() => process.exit(1), 200).unref();
});

// ---------------------------------------------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------------------------------------------

test('parseArgs: the defaults are 64 games per pairing from seed 1, every pairing, no files', { timeout: 5000 }, () => {
  const options = parseArgs([]);
  assert.equal(options.games, 64);
  assert.equal(options.seed, 1);
  assert.equal(options.only, null);
  assert.equal(options.path, DEFAULT_PATH);
  assert.equal(options.jobs, defaultJobs());
  assert.equal(options.json, null);
  assert.equal(options.print, null);
  assert.equal(options.help, false);
  // the processor count minus two, at most 8, at least 1
  assert.equal(defaultJobs(), defaultJobs(os.availableParallelism()));
  for (const [processors, jobs] of [[1, 1], [2, 1], [3, 1], [4, 2], [9, 7], [10, 8], [11, 8], [16, 8], [64, 8]]) {
    assert.equal(defaultJobs(processors), jobs, `${processors} processors`);
  }
});

test('parseArgs: every option, with the value as the next argument or after =', { timeout: 5000 }, () => {
  const spaced = parseArgs(['--games', '8', '--seed', '700001', '--only', 'matched-B,plain-A', '--path', 'mid', '--jobs', '3', '--json', 'out.json', '--print', 'games']);
  assert.equal(spaced.games, 8);
  assert.equal(spaced.seed, 700001);
  assert.equal(spaced.only?.join(' '), 'plain-A matched-B');          // table order, not the order typed
  assert.equal(spaced.path, 'mid');
  assert.equal(spaced.jobs, 3);
  assert.equal(spaced.json, 'out.json');
  assert.equal(spaced.print, 'games');
  const inline = parseArgs(['--games=16', '--seed=0', '--only=high-A', '--path=table', '--jobs=1', '--json=a=b.json', '--print=dir']);
  assert.equal(inline.games, 16);
  assert.equal(inline.seed, 0);
  assert.equal(inline.only?.join(' '), 'high-A');
  assert.equal(inline.path, 'table');
  assert.equal(inline.jobs, 1);
  assert.equal(inline.json, 'a=b.json');
  assert.equal(inline.print, 'dir');
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
  for (const path of ['table', 'slow', 'mid', 'fast']) assert.equal(parseArgs(['--path', path]).path, path);
});

test('parseArgs: --only takes pairing names, kinds and weak', { timeout: 5000 }, () => {
  assert.equal(PAIRINGS.map(p => p.name).join(' '),
    'plain-A plain-B plain-C plain-D matched-A matched-B matched-C matched-D coached-A coached-B coached-C coached-D high-A first-A first-B firstc-A firstc-B');
  assert.equal(parseArgs(['--only', 'matched']).only?.join(' '), 'matched-A matched-B matched-C matched-D');
  assert.equal(parseArgs(['--only', 'first']).only?.join(' '), 'first-A first-B');
  assert.equal(parseArgs(['--only', 'firstc,high']).only?.join(' '), 'high-A firstc-A firstc-B');
  assert.equal(parseArgs(['--only', 'weak']).only?.join(' '), 'matched-A matched-B coached-A coached-B first-A first-B firstc-A firstc-B');
  assert.equal(parseArgs(['--only', 'plain-C,plain-C']).only?.join(' '), 'plain-C');
});

test('parseArgs: an unknown option, a missing value and a value out of range throw', { timeout: 5000 }, () => {
  assert.throws(() => parseArgs(['--frobnicate']), /unknown option --frobnicate/);
  assert.throws(() => parseArgs(['games']), /unknown option games/);
  assert.throws(() => parseArgs(['--help=1']), /unknown option/);
  assert.throws(() => parseArgs(['--games']), /--games needs a value/);
  assert.throws(() => parseArgs(['--json=']), /--json needs a value/);
  for (const bad of ['0', '-3', '1.5', 'many', '100001']) assert.throws(() => parseArgs(['--games', bad]), /--games must be a whole number/, bad);
  assert.throws(() => parseArgs(['--seed', '-1']), /--seed must be a whole number/);
  assert.throws(() => parseArgs(['--jobs', '0']), /--jobs must be a whole number/);
  assert.throws(() => parseArgs(['--jobs', '65']), /--jobs must be a whole number/);
  assert.throws(() => parseArgs(['--path', 'brain']), /--path must be table, slow, mid or fast/);
  assert.throws(() => parseArgs(['--only', 'matched-E']), /unknown pairing matched-E/);
  assert.throws(() => parseArgs(['--only', 'matched-A,,plain-A']), /unknown pairing/);
});

test('the command line: an unknown option prints the usage line and exits with 2; --help exits with 0', { timeout: 20000 }, () => {
  const bad = spawnSync(process.execPath, [SIM, '--frobnicate'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option --frobnicate/);
  assert.match(bad.stderr, /node scripts\/sim\.js \[--games 64\] \[--seed 1\] \[--only <pairing,\.\.\.>\]/);
  assert.equal(bad.stdout, '');
  const help = spawnSync(process.execPath, [SIM, '--help'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^node scripts\/sim\.js \[--games 64\]/);
});

test('the command line: a run prints the table, the bars and the conclusion and writes its files; a path that cannot be written is refused before any game', { timeout: 30000 }, () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'yijian-sim-'));
  try {
    // --json names a directory, --print a place below a file: usage errors, and nothing is played
    const dirAsFile = spawnSync(process.execPath, [SIM, '--games', '1', '--only', 'plain-A', '--path', 'table', '--jobs', '1', '--json', tmp], { encoding: 'utf8', timeout: 15000 });
    assert.equal(dirAsFile.status, 2);
    assert.match(dirAsFile.stderr, /--json: .* is a directory, a file name is needed\nnode scripts\/sim\.js \[--games 64\]/);
    assert.equal(dirAsFile.stdout, '');
    writeFileSync(join(tmp, 'a-file'), '');
    const fileAsDir = spawnSync(process.execPath, [SIM, '--games', '1', '--only', 'plain-A', '--path', 'table', '--jobs', '1', '--print', join(tmp, 'a-file', 'games')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(fileAsDir.status, 2);
    assert.match(fileAsDir.stderr, /--print: .* cannot be used as a directory/);
    assert.equal(fileAsDir.stdout, '');

    // One game of the plain engine against bot A. The report is written; one printed game cannot be (a directory has
    // its name): that is reported, the conclusion still comes, and the exit code is 1.
    const report = join(tmp, 'out', 'report.json');
    const games = join(tmp, 'games');
    mkdirSync(join(games, 'plain-A-3.txt'), { recursive: true });
    const run = spawnSync(process.execPath, [SIM, '--games', '1', '--seed', '3', '--only', 'plain-A', '--path', 'table', '--jobs', '1', '--json', report, '--print', games],
      { encoding: 'utf8', timeout: 25000 });
    assert.equal(run.status, 1, run.stderr.slice(-400));
    const lines = run.stdout.split('\n');
    assert.match(lines[0], /^司马懿教学模拟：1 组对局，每组 1 局，种子 3 到 3，1 个线程$/);
    assert.match(lines[1], /^走法：table（/);
    assert.ok(lines.some(line => /^对局 +局数 +胜\/和\/负 /.test(line)), 'the table header');
    assert.ok(lines.some(line => /^plain-A +1 +0\/0\/1 +0% +-\d+ /.test(line)), 'the row of the pairing');
    assert.ok(lines.some(line => /^ {2}不计 +plain-A +平均局面 -\d+\.\d（线：低于 -400）$/.test(line)), 'the line of its bar: printed, not judged from one game');
    assert.ok(lines.some(line => /^ {2}无数据 +† 教学对局合计 +\(h\) /.test(line)), 'the rails have nothing to measure');
    assert.ok(lines.includes(`全部数字已写入 ${report}`));
    assert.match(run.stderr, /没有写成：EISDIR/);
    assert.ok(!run.stdout.includes('局棋谱已写入'));
    assert.equal(lines.filter(line => line.startsWith('结论：')).join('|'), '结论：该算的线全部达标（每组少于 64 局：只算带 † 的线）；结果文件没有写成，退出码 1');
    const written = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(written.sim, 1);
    assert.equal(JSON.stringify(written.options), JSON.stringify({ games: 1, seed: 3, path: 'table', only: ['plain-A'] }));
    assert.equal(written.full, false);
    assert.equal(written.games.length, 1);
    assert.equal(written.games[0].text, undefined);                    // the move lists are not part of the numbers
    assert.equal(written.pairings.length, 1);
    assert.equal(written.failed.length, 0);
    assert.equal(written.bars.map((/** @type {{id:string}} */ bar) => bar.id).join(' '), 'plain-A.eval mates rail.h rail.i rail.j rail.k rail.l long.all long.worst');
    assert.equal(readdirSync(games).join(' '), 'plain-A-3.txt');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('gameSeed: 0x9E3779B9 times the seed number plus the letter of the bot, as an unsigned 32-bit number', { timeout: 5000 }, () => {
  for (const [seed, bot] of /** @type {const} */ ([[1, 'A'], [64, 'B'], [700001, 'C'], [707008, 'D'], [999999999, 'A']])) {
    const expected = Number((0x9E3779B9n * BigInt(seed) + BigInt(bot.charCodeAt(0))) % (1n << 32n));
    assert.equal(gameSeed(seed, bot), expected, `${seed} ${bot}`);
  }
  assert.equal(gameSeed(5, 'A'), gameSeed(5, 'A'));
  assert.notEqual(gameSeed(5, 'A'), gameSeed(5, 'B'));
  assert.notEqual(gameSeed(5, 'A'), gameSeed(6, 'A'));
});

test('the pairings: the level the rival starts at, the games played before, who is coached and who meets the plain engine', { timeout: 5000 }, () => {
  // CONTRACT-NOTES 130 with the levels of the BT harness: bots A to D at 1.5, 3, 5 and 6.5; the rival of high-A starts
  // 3.5 levels above bot A; a first game starts at level 2 with no game played; the others have played five.
  const row = (/** @type {typeof PAIRINGS[number]} */ p) => `${p.name} ${p.kind} ${p.bot} level ${p.level} played ${p.played}${p.coached ? ' coached' : ''}${p.teaching ? '' : ' plain'}`;
  assert.equal(PAIRINGS.map(row).join('\n'), [
    'plain-A plain A level 1.5 played 0 plain',
    'plain-B plain B level 3 played 0 plain',
    'plain-C plain C level 5 played 0 plain',
    'plain-D plain D level 6.5 played 0 plain',
    'matched-A matched A level 1.5 played 5',
    'matched-B matched B level 3 played 5',
    'matched-C matched C level 5 played 5',
    'matched-D matched D level 6.5 played 5',
    'coached-A coached A level 1.5 played 5 coached',
    'coached-B coached B level 3 played 5 coached',
    'coached-C coached C level 5 played 5 coached',
    'coached-D coached D level 6.5 played 5 coached',
    'high-A high A level 5 played 5',
    'first-A first A level 2 played 0',
    'first-B first B level 2 played 0',
    'firstc-A firstc A level 2 played 0 coached',
    'firstc-B firstc B level 2 played 0 coached',
  ].join('\n'));
});

test('the devices of the brain paths land in the speed classes of section 4.8.1', { timeout: 5000 }, () => {
  assert.ok(DEVICES.fast.perftNps >= 3e6, 'fast: 3 M perft leaves per second or more');
  assert.ok(DEVICES.mid.perftNps >= 1e6 && DEVICES.mid.perftNps < 3e6, 'mid: from 1 M');
  assert.ok(DEVICES.slow.perftNps < 1e6, 'slow: below');
  assert.ok(DEVICES.fast.nps > DEVICES.mid.nps && DEVICES.mid.nps > DEVICES.slow.nps);
});

// ---------------------------------------------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------------------------------------------

const noRail = () => ({
  moves: 0, mate1: 0, mate1Miss: 0, mate1Twice: 0, left2: 0, left3: 0, left3plus: 0, gifts: 0, giftOver: 0, giftMax: 0, giftRook: 0,
  recap: 0, recapMiss: 0, rookBack: 0, rookBackMiss: 0, ahead: 0, aheadBack: 0, back: 0,
  giftTwice: 0, giftAfterBlunder: 0, spareOverCap: 0, pressSoft: 0, forbidden: 0,
});
const noNat = () => ({
  mate1: 0, mate1Miss: 0, mate2: 0, mate2Miss: 0, mate3: 0, mate3Miss: 0, recap: 0, recapMiss: 0, enprise: 0, enpriseMiss: 0,
  hang: 0, hangMiss: 0, tactic: 0, tacticMiss: 0, backTwice: 0,
});
/** A game record with everything at zero but what `over` gives. */
function game(over) {
  return {
    pairing: 'matched-B', seed: 1, result: 'draw', reason: 'repetition', plies: 0, childMoves: 0, evalSum: 0, inBand: 0, firstCapture: null,
    drift: 0, shift: 0, level: 3, mateByChild: false,
    modes: { press: 0, spar: 0, ease: 0, finish: 0, ...over.modes },
    kinds: { honest: 0, variety: 0, overlook: 0, chance: 0, concession: 0, finisher: 0, ...over.kinds },
    rivalMoves: 0, depthSum: 0, childLoss: 0, rivalLoss: 0, blunders: 0, held: 0, tests: 0, found: 0, chances: 0, taken: 0, overlooked: 0, spared: 0,
    ...Object.fromEntries(Object.entries(over).filter(([key]) => !['modes', 'kinds', 'rail', 'nat'].includes(key))),
    rail: { ...noRail(), ...over.rail },
    nat: { ...noNat(), ...over.nat },
  };
}

test('summarize: three hand-built games of one pairing give the numbers of its table row', { timeout: 5000 }, () => {
  const records = [
    game({ seed: 1, result: 'win', reason: 'mate', mateByChild: true, childMoves: 40, rivalMoves: 40, evalSum: 4000, inBand: 30, firstCapture: 6, drift: -1,
           spared: 1, overlooked: 4, kinds: { honest: 25, variety: 4, overlook: 4, chance: 3, concession: 2, finisher: 2 },
           modes: { press: 4, spar: 20, ease: 14, finish: 2 }, depthSum: 200, childLoss: 2000, rivalLoss: 4000 }),
    game({ seed: 2, result: 'loss', reason: 'mate', childMoves: 20, rivalMoves: 20, evalSum: -6000, inBand: 10, firstCapture: null, drift: -2,
           spared: 2, overlooked: 5, kinds: { honest: 11, variety: 4, overlook: 5 }, modes: { ease: 20 }, depthSum: 90, childLoss: 4000, rivalLoss: 500 }),
    game({ seed: 3, result: 'draw', reason: 'repetition', childMoves: 60, rivalMoves: 60, evalSum: 0, inBand: 60, firstCapture: 10, drift: 0,
           kinds: { honest: 55, variety: 4, concession: 1 }, modes: { spar: 60 }, depthSum: 310, childLoss: 1200, rivalLoss: 300 }),
  ];
  const summary = summarize(records);
  assert.equal(summary.pairings.length, 1);
  const row = summary.pairings[0];
  assert.equal(row.name, 'matched-B');
  assert.equal(row.games, 3);
  assert.equal(`${row.wins}/${row.draws}/${row.losses}`, '1/1/1');
  assert.equal(row.score, 0.5);                                        // (1 + 1/2) / 3
  assert.ok(Math.abs(row.evalMean - (100 - 300 + 0) / 3) < 1e-9);      // the mean of the games' means
  assert.ok(Math.abs(row.evalPooled - (4000 - 6000) / 120) < 1e-9);    // the mean over all 120 child turns
  assert.ok(Math.abs(row.band - (0.75 + 0.5 + 1) / 3) < 1e-9);
  assert.equal(row.drift, -1);
  assert.equal(row.length, 40);                                        // median of 40, 20, 60
  assert.equal(row.firstCapture, 10);                                  // median of 6, none (counts as late), 10
  assert.equal(row.mates, 1);
  assert.equal(row.spared, 1);
  assert.ok(Math.abs(row.gifts - (5 + 0 + 1) / 3) < 1e-9);             // chances and concessions per game
  assert.equal(row.overlooks, 3);
  assert.equal(row.depth, 5);                                          // 600 / 120 rival moves
  assert.equal(row.childLoss, 60);                                     // 7200 / 120
  assert.equal(row.rivalLoss, 40);                                     // 4800 / 120
  assert.equal(row.kinds.variety, 0.1);                                // 12 of 120 rival moves
  assert.equal(row.modes.ease, 34 / 120);
  assert.equal(summary.games, 3);
  assert.equal(summary.wins, 1);
  assert.equal(summary.mates, 1);
});

test('summarize: the length and the first capture are medians, also of an even number of games', { timeout: 5000 }, () => {
  // three games: the median is the middle one, not the mean (40)
  const odd = summarize([game({ seed: 1, childMoves: 90 }), game({ seed: 2, childMoves: 10 }), game({ seed: 3, childMoves: 20 })]).pairings[0];
  assert.equal(odd.length, 20);
  // four games: half-way between the two in the middle
  const even = summarize([
    game({ seed: 1, childMoves: 90, firstCapture: 4 }), game({ seed: 2, childMoves: 10, firstCapture: 8 }),
    game({ seed: 3, childMoves: 30, firstCapture: null }), game({ seed: 4, childMoves: 20, firstCapture: 2 }),
  ]).pairings[0];
  assert.equal(even.length, 25);                                       // 10, 20 | 30, 90
  assert.equal(even.firstCapture, 6);                                  // 2, 4 | 8, none
  // more than half of the games without a capture: the median says so
  const none = summarize([game({ seed: 1, firstCapture: 12 }), game({ seed: 2 }), game({ seed: 3 })]).pairings[0];
  assert.ok(none.firstCapture > 14);
});

test('summarize: pairings come in table order, the plain engine is left out of the teaching totals, the rails add up', { timeout: 5000 }, () => {
  const records = [
    game({ pairing: 'firstc-B', seed: 1, result: 'win', reason: 'stopped', childMoves: 10, rail: { moves: 10, gifts: 2, giftMax: 310, left3: 1, mate1Twice: 0, ahead: 4, aheadBack: 1 } }),
    game({ pairing: 'plain-A', seed: 1, result: 'loss', reason: 'mate', childMoves: 10, rail: { moves: 10, gifts: 9, giftMax: 900, left3: 5, mate1Twice: 5, ahead: 9, aheadBack: 9 } }),
    game({ pairing: 'matched-A', seed: 2, result: 'win', reason: 'mate', mateByChild: true, childMoves: 30,
           rail: { moves: 30, gifts: 3, giftMax: 480, left3: 2, mate1Twice: 1, rookBack: 2, rookBackMiss: 1, ahead: 6, aheadBack: 0 }, nat: { mate2: 3, mate2Miss: 1 } }),
    game({ pairing: 'matched-A', seed: 1, result: 'loss', reason: 'mate', childMoves: 20, firstCapture: 0, rail: { moves: 20, gifts: 1, giftMax: 120, giftOver: 0 }, nat: { mate2: 1 } }),
  ];
  const summary = summarize(records);
  assert.equal(summary.pairings.map(p => `${p.name}:${p.games}`).join(' '), 'plain-A:1 matched-A:2 firstc-B:1');
  assert.equal(summary.games, 3);                                      // the plain game does not count
  assert.equal(summary.wins, 2);
  assert.equal(summary.mates, 1);                                      // the stopped game is a win without a mate
  assert.equal(summary.rail.moves, 60);
  assert.equal(summary.rail.gifts, 6);
  assert.equal(summary.rail.giftMax, 480);                             // the largest, not the sum
  assert.equal(summary.rail.left3, 3);
  assert.equal(summary.left3Games, 2);                                 // games with the pattern, however often
  assert.equal(summary.mate1TwiceGames, 1);
  assert.equal(summary.rail.rookBack, 2);
  assert.equal(summary.rail.rookBackMiss, 1);
  assert.equal(summary.rail.ahead, 10);
  assert.equal(summary.rail.aheadBack, 1);
  assert.equal(summary.nat.mate2, 4);
  assert.equal(summary.nat.mate2Miss, 1);
  assert.equal(summarize([]).pairings.length, 0);
  // a long game: the child made 100 moves or more
  assert.equal(summary.pairings[1].long, 0);
  assert.equal(summary.long, 0);
  const long = summarize([
    game({ seed: 1, childMoves: 100 }), game({ seed: 2, childMoves: 99 }), game({ seed: 3, childMoves: 120 }), game({ seed: 4 }),
    game({ pairing: 'plain-D', seed: 1, childMoves: 109 }), game({ pairing: 'coached-D', seed: 1, childMoves: 100 }),
  ]);
  assert.equal(long.pairings.map(p => `${p.name}:${p.long}`).join(' '), 'plain-D:1 matched-B:0.5 coached-D:1');
  assert.equal(long.long, 3);                                          // of the five teaching games; the plain engine's game does not count
  assert.equal(long.games, 5);
  // the order of the records does not matter
  assert.ok(JSON.stringify(summarize(records.slice().reverse())) === JSON.stringify(summary));
});

// ---------------------------------------------------------------------------------------------------------------
// the bars of CONTRACT-NOTES 130 with the changes of 143 (d): the rails given as a share and the plain-rival bar are judged
// from 64 games per pairing only, firstc-A is 45 %, and two bars limit the games that reach 100 child moves (10 % of all
// teaching games, 33 % of the pairing that has the most: regression guards, CONTRACT-NOTES 151)
// ---------------------------------------------------------------------------------------------------------------

/** A table row with every number where its bar is just met. */
function row(name, over = {}) {
  return {
    name, games: 64, wins: 20, draws: 10, losses: 34, score: 0.4, evalMean: 0, evalPooled: 0, band: 0.6, drift: -1.5, length: 85, long: 0.33, firstCapture: 14,
    mates: 10, spared: 0, gifts: 0, overlooks: 0, depth: 5, childLoss: 0, rivalLoss: 0,
    modes: { press: 0, spar: 1, ease: 0, finish: 0 }, kinds: { honest: 1, variety: 0, overlook: 0, chance: 0, concession: 0, finisher: 0 }, ...over,
  };
}
/** A summary in which every bar is met exactly at its edge. */
function atTheEdge() {
  return {
    pairings: [
      row('plain-A', { evalMean: -400.5 }), row('plain-B', { evalMean: -401 }), row('plain-C', { evalMean: -1900 }), row('plain-D', { evalMean: -400.01, long: 0.5 }),
      row('matched-A', { evalMean: -450, band: 0.45, long: 0 }), row('matched-B', { evalMean: -150, band: 0.5 }),
      row('matched-C', { evalMean: 350, band: 0.6 }), row('matched-D', { evalMean: 0, band: 0.6 }),
      row('coached-A', { score: 0.3 }), row('coached-B', { score: 0.4 }), row('coached-C', { score: 0.4 }), row('coached-D', { score: 0.4 }),
      row('high-A', { drift: -1.5 }),
      row('first-A', { score: 0 }), row('first-B', { score: 0.3 }), row('firstc-A', { score: 0.45 }), row('firstc-B', { score: 0.6 }),
    ],
    games: 100, wins: 10, mates: 5, long: 10,
    rail: { ...noRail(), giftMax: 500, rookBack: 100, rookBackMiss: 1, ahead: 100, aheadBack: 4 },
    nat: noNat(), mate1TwiceGames: 0, left3Games: 2,
  };
}
const statusOf = (bars, id) => bars.find(bar => bar.id === id)?.status;
const pairingRow = (summary, name) => summary.pairings.find(p => p.name === name);

/** Every bar with the smallest change that misses it: [bar id, marked †, the change]. */
const BEYOND = [
  ['plain-A.eval', false, s => { pairingRow(s, 'plain-A').evalMean = -400; }],
  ['plain-B.eval', false, s => { pairingRow(s, 'plain-B').evalMean = -399; }],
  ['plain-C.eval', false, s => { pairingRow(s, 'plain-C').evalMean = 0; }],
  ['plain-D.eval', false, s => { pairingRow(s, 'plain-D').evalMean = -400; }],
  ['matched-A.eval', false, s => { pairingRow(s, 'matched-A').evalMean = -450.5; }],
  ['matched-B.eval', false, s => { pairingRow(s, 'matched-B').evalMean = -150.5; }],
  ['matched-C.eval', false, s => { pairingRow(s, 'matched-C').evalMean = 350.5; }],
  ['matched-D.eval', false, s => { pairingRow(s, 'matched-D').evalMean = -151; }],
  ['matched-A.band', false, s => { pairingRow(s, 'matched-A').band = 0.449; }],
  ['matched-B.band', false, s => { pairingRow(s, 'matched-B').band = 0.499; }],
  ['matched-C.band', false, s => { pairingRow(s, 'matched-C').band = 0.599; }],
  ['matched-D.band', false, s => { pairingRow(s, 'matched-D').band = 0.599; }],
  ['coached-A.score', false, s => { pairingRow(s, 'coached-A').score = 0.299; }],
  ['coached-B.score', false, s => { pairingRow(s, 'coached-B').score = 0.399; }],
  ['coached-C.score', false, s => { pairingRow(s, 'coached-C').score = 0.399; }],
  ['coached-D.score', false, s => { pairingRow(s, 'coached-D').score = 0.399; }],
  ['coached-A.length', false, s => { pairingRow(s, 'coached-A').length = 85.5; }],
  ['coached-B.length', false, s => { pairingRow(s, 'coached-B').length = 86; }],
  ['coached-C.length', false, s => { pairingRow(s, 'coached-C').length = 85.5; }],
  ['coached-D.length', false, s => { pairingRow(s, 'coached-D').length = 120; }],
  ['high-A.drift', true, s => { pairingRow(s, 'high-A').drift = -1.49; }],
  ['firstc-B.score', false, s => { pairingRow(s, 'firstc-B').score = 0.599; }],
  ['first-B.score', false, s => { pairingRow(s, 'first-B').score = 0.299; }],
  ['firstc-A.score', false, s => { pairingRow(s, 'firstc-A').score = 0.449; }],
  ['first-A.capture', true, s => { pairingRow(s, 'first-A').firstCapture = 15; }],
  ['first-B.capture', true, s => { pairingRow(s, 'first-B').firstCapture = 14.5; }],
  ['firstc-A.capture', true, s => { pairingRow(s, 'firstc-A').firstCapture = 16; }],
  ['firstc-B.capture', true, s => { pairingRow(s, 'firstc-B').firstCapture = 999; }],
  ['mates', true, s => { s.mates = 4; }],
  ['rail.h', true, s => { s.mate1TwiceGames = 1; }],
  ['rail.i', false, s => { s.left3Games = 3; }],
  ['rail.j', true, s => { s.rail.giftOver = 1; }],
  ['rail.j', true, s => { s.rail.giftRook = 1; }],
  ['rail.k', false, s => { s.rail.rookBackMiss = 2; }],
  ['rail.l', false, s => { s.rail.aheadBack = 5; }],
  ['long.all', false, s => { s.long = 11; }],
  ['long.worst', false, s => { pairingRow(s, 'coached-D').long = 0.34; }],
];

test('judgeBars: every bar of CONTRACT-NOTES 130 and 143 (d) is met at its edge and missed just beyond it', { timeout: 5000 }, () => {
  const bars = judgeBars(atTheEdge(), true);
  assert.equal(bars.length, 37);
  assert.equal(new Set(bars.map(bar => bar.id)).size, 37);
  assert.equal(bars.filter(bar => bar.dagger).map(bar => bar.id).join(' '),          // drift 1, first capture 4, mates 1, the rails (h) and (j)
    'high-A.drift first-A.capture first-B.capture firstc-A.capture firstc-B.capture mates rail.h rail.j');
  assert.equal(statusOf(bars, 'first-A.score'), 'info');               // the uncoached first game of bot A is printed only
  assert.equal(bars.filter(bar => bar.status === 'pass').length, 36);
  assert.equal(failedBars(bars), 0);
  // every bar is in the list of changes, with its † mark
  assert.equal(new Set(BEYOND.map(([id]) => id)).size, 36);
  for (const [id, dagger] of BEYOND) assert.equal(bars.find(bar => bar.id === id)?.dagger, dagger, id);

  for (const [id, , change] of BEYOND) {
    const summary = atTheEdge();
    change(summary);
    const judged = judgeBars(summary, true);
    assert.equal(statusOf(judged, id), 'fail', id);
    assert.equal(failedBars(judged), 1, `${id}: no other bar moves`);
  }
  // the bar of the worst pairing looks at the games against the teaching rival only: plain-D has half of its games long
  // in every summary above. And it names the pairing it found.
  const worst = atTheEdge();
  pairingRow(worst, 'first-B').long = 0.4;
  pairingRow(worst, 'coached-D').long = 0.35;
  const named = judgeBars(worst, true).find(bar => bar.id === 'long.worst');
  assert.deepEqual([named?.status, named?.value], ['fail', '40.0%（first-B）']);
});

test('judgeBars: the second edge of the matched band, and numbers far inside every bar', { timeout: 5000 }, () => {
  const summary = atTheEdge();
  pairingRow(summary, 'matched-B').evalMean = 350;
  pairingRow(summary, 'matched-C').evalMean = -150;
  assert.equal(failedBars(judgeBars(summary, true)), 0);
  pairingRow(summary, 'matched-B').evalMean = 351;
  assert.equal(statusOf(judgeBars(summary, true), 'matched-B.eval'), 'fail');
  // the uncoached first game of bot A has no bar, whatever it scores
  pairingRow(summary, 'first-A').score = 0;
  assert.equal(statusOf(judgeBars(summary, true), 'first-A.score'), 'info');
});

test('judgeBars: a quick look applies only the bars marked †', { timeout: 5000 }, () => {
  const summary = atTheEdge();
  for (const [, , change] of BEYOND) change(summary);                  // everything is missed
  const full = judgeBars(summary, true);
  assert.equal(failedBars(full), 36);
  const quick = judgeBars(summary, false);
  assert.equal(failedBars(quick), 8);
  for (const bar of quick) {
    if (bar.id === 'first-A.score') assert.equal(bar.status, 'info');
    else assert.equal(bar.status, bar.dagger ? 'fail' : 'quick', bar.id);
  }
  // met bars: a † bar passes in a quick look, the others are not counted either way
  const met = judgeBars(atTheEdge(), false);
  assert.equal(failedBars(met), 0);
  assert.equal(met.filter(bar => bar.status === 'pass').length, 8);
  assert.equal(met.filter(bar => bar.status === 'quick').length, 28);
});

test('judgeBars: the rails given as a share, the plain-rival bar and the long games are judged from 64 games per pairing only; a quick look prints them with their numbers, marked 不计', { timeout: 5000 }, () => {
  // one case decides a share in a quick look: one game in eight with pattern (i), one missed rook recapture in three,
  // one move back in ten, one lucky game of the plain engine, one long game
  const summary = atTheEdge();
  summary.games = 8;
  summary.left3Games = 1;
  summary.rail.rookBack = 3;
  summary.rail.rookBackMiss = 1;
  summary.rail.ahead = 10;
  summary.rail.aheadBack = 1;
  summary.long = 1;
  pairingRow(summary, 'plain-C').evalMean = -340;
  pairingRow(summary, 'coached-D').long = 1;
  const SHARES = ['plain-A.eval', 'plain-B.eval', 'plain-C.eval', 'plain-D.eval', 'rail.i', 'rail.k', 'rail.l', 'long.all', 'long.worst'];
  const quick = judgeBars(summary, false);
  for (const id of SHARES) {
    assert.equal(statusOf(quick, id), 'quick', id);
    assert.equal(quick.find(bar => bar.id === id)?.dagger, false, id);
  }
  assert.equal(failedBars(quick), 0);
  const lines = barLines(quick);
  assert.match(lines.find(line => line.includes('plain-C')) ?? '', /^ {2}不计 +plain-C +平均局面 -340\.0（线：低于 -400）$/);
  assert.match(lines.find(line => line.includes('(i)')) ?? '', /^ {2}不计 +教学对局合计 +\(i\) 同一个子连续三次没吃的对局 12\.5%（1\/8）（线：不超过 2%）$/);
  assert.match(lines.find(line => line.includes('(k)')) ?? '', /^ {2}不计 +教学对局合计 +\(k\) 该吃回的车没吃回 33\.3%（1\/3）（线：不超过 1%）$/);
  assert.match(lines.find(line => line.includes('(l)')) ?? '', /^ {2}不计 +教学对局合计 +\(l\) 领先 600 分以上时走回头路 10\.0%（1\/10）（线：不超过 4%）$/);
  assert.match(lines.find(line => line.includes('步的对局 ')) ?? '', /^ {2}不计 +教学对局合计 +孩子走满 100 步的对局 12\.5%（1\/8）（线：不超过 10%）$/);
  assert.match(lines.find(line => line.includes('最多的一组')) ?? '', /^ {2}不计 +教学对局合计 +孩子走满 100 步的对局最多的一组 100\.0%（coached-D）（线：不超过 33%）$/);
  // the same numbers from 64 games per pairing: every one of them is a miss
  const full = judgeBars(summary, true);
  assert.deepEqual(full.filter(bar => bar.status === 'fail').map(bar => bar.id), ['plain-C.eval', 'rail.i', 'rail.k', 'rail.l', 'long.all', 'long.worst']);
  // what a quick look still judges: the rails (h) and (j), the mates, the drift, the first capture
  summary.mate1TwiceGames = 1;
  summary.rail.giftOver = 1;
  summary.mates = 4;
  pairingRow(summary, 'high-A').drift = -1.4;
  pairingRow(summary, 'first-B').firstCapture = 16;
  assert.deepEqual(judgeBars(summary, false).filter(bar => bar.status === 'fail').map(bar => bar.id), ['high-A.drift', 'first-B.capture', 'mates', 'rail.h', 'rail.j']);
});

test('judgeBars: a pairing that was not played has no bar; a share of nothing is not judged', { timeout: 5000 }, () => {
  const summary = atTheEdge();
  summary.pairings = summary.pairings.filter(p => p.name === 'matched-B' || p.name === 'first-A');
  summary.wins = 0;
  summary.mates = 0;
  summary.rail.rookBack = 0;
  summary.rail.rookBackMiss = 0;
  summary.rail.ahead = 0;
  summary.rail.aheadBack = 0;
  const bars = judgeBars(summary, true);
  assert.equal(bars.map(bar => bar.id).join(' '), 'matched-B.eval matched-B.band first-A.score first-A.capture mates rail.h rail.i rail.j rail.k rail.l long.all long.worst');
  assert.equal(statusOf(bars, 'mates'), 'missing');                    // no win: nothing to take a share of
  assert.equal(statusOf(bars, 'rail.k'), 'missing');
  assert.equal(statusOf(bars, 'rail.l'), 'missing');
  assert.equal(statusOf(bars, 'rail.h'), 'pass');
  assert.equal(failedBars(bars), 0);
  // no teaching game at all: the rails have nothing to measure
  const plainOnly = { ...atTheEdge(), pairings: [row('plain-A', { evalMean: -500 })], games: 0, wins: 0, mates: 0, rail: noRail(), left3Games: 0 };
  const judged = judgeBars(plainOnly, true);
  assert.equal(judged.filter(bar => bar.status === 'missing').map(bar => bar.id).join(' '), 'mates rail.h rail.i rail.j rail.k rail.l long.all long.worst');
  assert.equal(statusOf(judged, 'plain-A.eval'), 'pass');
});

test('tableLines and barLines: a header and one line per pairing; one line per bar with value, bar and 通过 / 未达标', { timeout: 5000 }, () => {
  const summary = atTheEdge();
  pairingRow(summary, 'matched-B').band = 0.47;
  const table = tableLines(summary);
  assert.equal(table.length, 18);
  assert.match(table[0], /^对局 +局数 +胜\/和\/负 +得分 +平均局面 +±300内 +drift +步数 +首吃 +绝杀\/胜 +长局 +放杀\/局 +让子\/局 +漏看\/局 +深度$/);
  assert.match(table[2], /^plain-B +64 +20\/10\/34 +40% +-401 /);
  assert.match(table[6], /^matched-B +64 +20\/10\/34 +40% +-150 +47% +-1\.50 +85 +14 +10\/20 +33% +0\.00 +0\.0 +0\.0 +5\.0$/);
  const bars = judgeBars(summary, true);
  const lines = barLines(bars);
  assert.equal(lines.length, bars.length);
  const band = lines.find(line => line.includes('matched-B') && line.includes('±300'));
  assert.match(band ?? '', /未达标 +matched-B +±300 以内的回合 47\.0%（线：不少于 50%）/);
  const plain = lines.find(line => line.includes('plain-B'));
  assert.match(plain ?? '', /^ {2}通过 +plain-B +平均局面 -401\.0（线：低于 -400）$/);
  // a number just beyond its bar never prints as the bar itself
  assert.match(lines.find(line => line.includes('plain-A')) ?? '', /通过 +plain-A +平均局面 -400\.5（线：低于 -400）/);
  const info = lines.find(line => line.includes('first-A') && line.includes('得分'));
  assert.match(info ?? '', /只打印 +first-A +第一盘得分 0\.0%$/);
  const rookBack = lines.find(line => line.includes('(k)'));
  assert.match(rookBack ?? '', /^ {2}通过 +教学对局合计 +\(k\) 该吃回的车没吃回 1\.0%（1\/100）（线：不超过 1%）$/);
  // a bar that a quick look judges too carries the mark
  assert.match(lines.find(line => line.includes('(h)')) ?? '', /^ {2}通过 +† 教学对局合计 +\(h\) 连续两步放过一步杀的对局 0 局（线：一局也没有）$/);
  // the long games: over all teaching games, and the pairing that has the most of them (the first one of several)
  assert.match(lines.find(line => line.includes('步的对局 ')) ?? '', /^ {2}通过 +教学对局合计 +孩子走满 100 步的对局 10\.0%（10\/100）（线：不超过 10%）$/);
  assert.match(lines.find(line => line.includes('最多的一组')) ?? '', /^ {2}通过 +教学对局合计 +孩子走满 100 步的对局最多的一组 33\.0%（matched-B）（线：不超过 33%）$/);
  assert.match(barLines(judgeBars(summary, false)).find(line => line.includes('matched-B') && line.includes('±300')) ?? '', /不计 +matched-B/);
});

// ---------------------------------------------------------------------------------------------------------------
// the observer: the patterns (h) to (l) of CONTRACT-NOTES 124 and the guards of item 104, on hand-built positions
// ---------------------------------------------------------------------------------------------------------------

// The rival is black and to move in all of them.
/** Two black rooks against the bare red king: 车9进9 mates at once; black is 2000 cp ahead. */
const MATE_IN_ONE = '3k4r/9/9/9/9/9/9/9/r8/4K4 b';
/** The same after the black king stepped down (将6进1) and the red king aside: the mate in one is still there. */
const MATE_IN_ONE_LATER = '8r/3k5/9/9/9/9/9/9/r8/5K3 b';
/** A red rook stands on the fifth file of black's third rank, where the black rook can take it (车1平5). */
const ROOK_TO_TAKE = '3k5/9/r3R4/9/9/9/9/9/9/4K4 b';

const at = (row, col) => ({ row, col });
const step = (r1, c1, r2, c2) => ({ from: at(r1, c1), to: at(r2, c2) });
const KING_DOWN = step(0, 3, 1, 3), KING_UP = step(1, 3, 0, 3), ROOK_MATES = step(0, 8, 9, 8), TAKE_ROOK = step(2, 0, 2, 4);
/** The child's last move in ROOK_TO_TAKE: the rook came from the edge of that rank. */
const ROOK_CAME = step(2, 8, 2, 4);
const sameStep = (a, b) => a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
/** The context of a rival move in the middle of a game of a level-3 child who has played before. */
const MIDGAME = teachingContext({ ...createSkillProfile(3), games: 5 }, createGameSkill(1), { moveNo: 10, lastChildMove: null });
const judgeSearcher = createSearcher();

/**
 * Lets the observer look at one rival move: `move` in the position `fen`, judged on a table as the simulation builds it
 * (depth 5, every move exact to depth 3). `over.choice` changes the teaching choice (kind, mode, loss, line, overlooked),
 * `over.own: false` makes it a move of the brain path, whose loss is the rival's own deeper search's.
 */
function look(watch, fen, move, over = {}) {
  const { board, turn } = fenToBoard(fen);
  const judge = judgeSearcher.analyzeSync({ fen, history: [], allDepth: 3, multiPV: 6, maxDepth: 5, timeMs: 3_600_000 });
  const full = getLegalMoves(board, turn).find(m => sameStep(m, move));
  const line = judge.lines.find(l => sameStep(l.move, move));
  assert.ok(full && line, 'the move is legal');
  const best = judge.lines[0];
  const choice = {
    move, line, mode: 'ease', kind: 'honest', loss: Math.max(0, scoreToCp(best.score) - scoreToCp(line.score)),
    evalAfter: 0 - scoreToCp(line.score), evalBest: 0 - scoreToCp(best.score), chance: null, overlooked: null, ...over.choice,
  };
  return observe(watch, {
    board, fen, full, turn: { choice, judge, own: over.own ?? true }, ctx: over.ctx ?? MIDGAME, forbidden: over.forbidden ?? false,
    lastChildMove: over.lastChildMove ?? null, lastChildCapture: over.lastChildCapture ?? false,
  });
}
/** The counters of a watch that are not zero, in the order of the record. */
const counted = watch => Object.entries(watch.rail).filter(([, value]) => value !== 0).map(([key, value]) => `${key}:${value}`).join(' ');

test('the observer, (h) and (l): a mate in one left twice running; far ahead, his last move taken back', { timeout: 20000 }, () => {
  const watch = newWatch();
  const first = look(watch, MATE_IN_ONE, KING_DOWN);
  assert.equal(counted(watch), 'moves:1 mate1:1 mate1Miss:1 ahead:1');
  assert.equal(first.flags.length, 0);                                 // once is not the pattern
  const second = look(watch, MATE_IN_ONE_LATER, KING_UP);
  assert.equal(counted(watch), 'moves:2 mate1:2 mate1Miss:2 mate1Twice:1 ahead:2 aheadBack:1 back:1');
  assert.equal(second.flags.join('|'), '护栏 (h)：连续两步放过一步杀|护栏 (l)：领先 2000 分还走回头路');
  assert.ok(second.notes.includes('走回头路'));
  assert.ok(first.notes.some(note => /^1 步杀 .*没走这一步，杀还在$/.test(note)), first.notes.join('|'));

  // the second move mates: no pattern, and a mate that is played is no miss
  const mates = newWatch();
  look(mates, MATE_IN_ONE, KING_DOWN);
  const played = look(mates, MATE_IN_ONE_LATER, ROOK_MATES);
  assert.equal(counted(mates), 'moves:2 mate1:2 mate1Miss:1 ahead:2');
  assert.equal(played.flags.length, 0);
  assert.ok(played.notes.some(note => /^1 步杀 .*：走了$/.test(note)), played.notes.join('|'));
  // a miss, a mating move, a miss: never twice running
  look(mates, MATE_IN_ONE, KING_DOWN);
  assert.equal(mates.rail.mate1Twice, 0);

  // a move back that is not his last move reversed is no move back; a rule the move breaks is counted
  const other = newWatch();
  look(other, MATE_IN_ONE, step(8, 0, 7, 0));
  const flagged = look(other, MATE_IN_ONE_LATER, KING_UP, { forbidden: true });
  assert.equal(counted(other), 'moves:2 mate1:2 mate1Miss:2 mate1Twice:1 ahead:2 forbidden:1');
  assert.ok(flagged.flags.includes('规则不许的长将'));
});

test('the observer, (k): a rook that has just captured is taken back, or the move played is as good by his own search', { timeout: 20000 }, () => {
  const justTook = { lastChildMove: ROOK_CAME, lastChildCapture: true };
  const missed = newWatch();
  const miss = look(missed, ROOK_TO_TAKE, KING_DOWN, justTook);
  assert.equal(counted(missed), 'moves:1 recap:1 recapMiss:1 rookBack:1 rookBackMiss:1 ahead:1');
  assert.equal(miss.flags.join('|'), '护栏 (k)：刚吃了子的车没被吃回');

  const taken = newWatch();
  const took = look(taken, ROOK_TO_TAKE, TAKE_ROOK, justTook);
  assert.equal(counted(taken), 'moves:1 recap:1 rookBack:1 ahead:1');
  assert.equal(took.flags.length, 0);

  // The brain path: his table is deeper than the observer's. A move that his own search puts within 60 cp of his best
  // is a move as good; one that it puts further below is a miss.
  const deeper = newWatch();
  look(deeper, ROOK_TO_TAKE, KING_DOWN, { ...justTook, own: false, choice: { loss: 60 } });
  assert.equal(counted(deeper), 'moves:1 recap:1 rookBack:1 ahead:1');
  look(deeper, ROOK_TO_TAKE, KING_DOWN, { ...justTook, own: false, choice: { loss: 61 } });
  assert.equal(counted(deeper), 'moves:2 recap:2 recapMiss:1 rookBack:2 rookBackMiss:1 ahead:2');

  // a rook that only moved there is no recapture: the level's full overlook probability applies, rail (k) does not
  const moved = newWatch();
  look(moved, ROOK_TO_TAKE, KING_DOWN, { lastChildMove: ROOK_CAME, lastChildCapture: false });
  assert.equal(counted(moved), 'moves:1 ahead:1');
  assert.equal(moved.nat.enprise, 0);                                  // a forced mate is on: counted as that, not as a piece en prise
  assert.equal(`${moved.nat.mate2} ${moved.nat.mate2Miss}`, '1 1');
});

test('the observer, (i): the same piece left where it can be taken, three rival moves running', { timeout: 20000 }, () => {
  const watch = newWatch();
  assert.equal(look(watch, ROOK_TO_TAKE, KING_DOWN).flags.length, 0);
  const twice = look(watch, ROOK_TO_TAKE, KING_DOWN);
  assert.equal(counted(watch), 'moves:2 left2:1 ahead:2');
  assert.equal(twice.flags.length, 0);
  assert.ok(twice.notes.includes('同一个子连续 2 次没吃'));
  const thrice = look(watch, ROOK_TO_TAKE, KING_DOWN);
  assert.equal(counted(watch), 'moves:3 left2:1 left3:1 left3plus:1 ahead:3');
  assert.equal(thrice.flags.join('|'), '护栏 (i)：五路车连续 3 次没吃（可赚 900）');
  look(watch, ROOK_TO_TAKE, KING_DOWN);
  assert.equal(counted(watch), 'moves:4 left2:1 left3:1 left3plus:2 ahead:4');       // one pattern, however long the run
  // taking it ends the run
  look(watch, ROOK_TO_TAKE, TAKE_ROOK);
  look(watch, ROOK_TO_TAKE, KING_DOWN);
  assert.equal(counted(watch), 'moves:6 left2:1 left3:1 left3plus:2 ahead:6');

  // a piece that has just arrived on the square starts a new run
  const arrived = newWatch();
  look(arrived, ROOK_TO_TAKE, KING_DOWN);
  look(arrived, ROOK_TO_TAKE, KING_DOWN);
  look(arrived, ROOK_TO_TAKE, KING_DOWN, { lastChildMove: ROOK_CAME });
  assert.equal(counted(arrived), 'moves:3 left2:1 ahead:3');
  // the brain path: a move as good by his own deeper search does not leave the piece
  const deeper = newWatch();
  for (let i = 0; i < 3; i++) look(deeper, ROOK_TO_TAKE, KING_DOWN, { own: false, choice: { loss: 0 } });
  assert.equal(counted(deeper), 'moves:3 ahead:3');
});

test('the observer, (j) and the guards of item 104: what a gift gives up, when it comes, and soft play that must not be', { timeout: 20000 }, () => {
  const gift = (kind, loss, more = {}) => ({ choice: { kind, loss, ...more } });
  // (j) a gift of 500 cp is the largest allowed; 501 is over
  const sized = newWatch();
  assert.equal(look(sized, MATE_IN_ONE, KING_DOWN, gift('chance', 500)).flags.length, 0);
  assert.equal(counted(sized), 'moves:1 mate1:1 mate1Miss:1 gifts:1 giftMax:500 ahead:1');
  const over = look(newWatch(), MATE_IN_ONE, KING_DOWN, gift('concession', 501));
  assert.equal(over.flags.join('|'), '护栏 (j)：这步让了 501 分');
  look(sized, MATE_IN_ONE, step(8, 0, 7, 0), gift('concession', 501));
  assert.equal(`${sized.rail.gifts} ${sized.rail.giftOver} ${sized.rail.giftMax} ${sized.rail.giftRook}`, '2 1 501 0');
  // moves that are no gift are not measured as gifts, whatever they lose
  const none = newWatch();
  look(none, MATE_IN_ONE, KING_DOWN, gift('overlook', 900));
  look(none, MATE_IN_ONE, KING_DOWN, gift('honest', 900));
  assert.equal(`${none.rail.gifts} ${none.rail.giftOver} ${none.rail.giftMax}`, '0 0 0');

  // (j) a rook for less than a rook: along the line of the gift the child takes a rook and he takes nothing
  const rook = newWatch();
  const lost = step(8, 0, 8, 4), takes = step(9, 4, 8, 4);            // 车1平5 next to the king, 帅五进一 takes it
  const lineOf = (move, reply) => ({ move, score: 0, depth: 5, upper: null, mate: null, pv: [move, reply], byDepth: [0, 0, 0, 0, 0], naive: 0, repeats: 1 });
  const given = look(rook, MATE_IN_ONE, lost, gift('chance', 300, { line: lineOf(lost, takes) }));
  assert.equal(given.flags.join('|'), '护栏 (j)：这步白送一车（只换回 0 分）');
  assert.equal(`${rook.rail.gifts} ${rook.rail.giftOver} ${rook.rail.giftRook}`, '1 0 1');
  // the same line played as an overlook is no gift
  look(rook, MATE_IN_ONE, lost, gift('overlook', 300, { line: lineOf(lost, takes) }));
  assert.equal(`${rook.rail.gifts} ${rook.rail.giftRook}`, '1 1');
  // a rook for a rook is a trade: he takes the rook, a second red rook takes back
  const trade = newWatch();
  const traded = look(trade, '3k5/9/r3R4/9/9/4R4/9/9/9/4K4 b', TAKE_ROOK, gift('concession', 100, { line: lineOf(TAKE_ROOK, step(5, 4, 2, 4)) }));
  assert.equal(traded.flags.length, 0);
  assert.equal(`${trade.rail.gifts} ${trade.rail.giftRook}`, '1 0');

  // 104 (c): never two gifts in a row; the guaranteed chance of the first game (rival moves 3 to 6, none given yet) is exempt
  const twice = newWatch();
  look(twice, ROOK_TO_TAKE, KING_DOWN, { ...gift('chance', 200), ctx: { ...MIDGAME, lastKind: 'concession' } });
  assert.equal(twice.rail.giftTwice, 1);
  look(twice, ROOK_TO_TAKE, KING_DOWN, { ...gift('chance', 200), ctx: { ...MIDGAME, lastKind: 'chance', firstGame: true, chances: 0, moveNo: 4 } });
  assert.equal(twice.rail.giftTwice, 1);
  look(twice, ROOK_TO_TAKE, KING_DOWN, { ...gift('chance', 200), ctx: { ...MIDGAME, lastKind: 'chance', firstGame: true, chances: 1, moveNo: 4 } });
  assert.equal(twice.rail.giftTwice, 2);
  look(twice, ROOK_TO_TAKE, KING_DOWN, { ...gift('honest', 200), ctx: { ...MIDGAME, lastKind: 'chance' } });
  assert.equal(twice.rail.giftTwice, 2);
  // 104 (c): the move that answers a blunder is never a gift
  assert.equal(twice.rail.giftAfterBlunder, 0);
  look(twice, ROOK_TO_TAKE, KING_DOWN, { ...gift('concession', 100), ctx: { ...MIDGAME, sinceBlunder: 0 } });
  look(twice, ROOK_TO_TAKE, KING_DOWN, { ...gift('concession', 100), ctx: { ...MIDGAME, sinceBlunder: 1 } });
  look(twice, ROOK_TO_TAKE, KING_DOWN, { ...gift('overlook', 100), ctx: { ...MIDGAME, sinceBlunder: 0 } });
  assert.equal(twice.rail.giftAfterBlunder, 1);

  // 104 (d): spared mates are capped, at one from level 3 up and at two below
  const spared = newWatch();
  const sparing = { kind: 'overlook', loss: 900, overlooked: { gain: 900, mate: true, line: [] } };
  look(spared, MATE_IN_ONE, KING_DOWN, { choice: sparing, ctx: { ...MIDGAME, level: 3, spared: 0 } });
  look(spared, MATE_IN_ONE, KING_DOWN, { choice: sparing, ctx: { ...MIDGAME, level: 2.9, spared: 1 } });
  assert.equal(spared.rail.spareOverCap, 0);
  look(spared, MATE_IN_ONE, KING_DOWN, { choice: sparing, ctx: { ...MIDGAME, level: 3, spared: 1 } });
  look(spared, MATE_IN_ONE, KING_DOWN, { choice: sparing, ctx: { ...MIDGAME, level: 2.9, spared: 2 } });
  assert.equal(spared.rail.spareOverCap, 2);
  look(spared, MATE_IN_ONE, KING_DOWN, { choice: { ...sparing, overlooked: { gain: 300, mate: false, line: [] } }, ctx: { ...MIDGAME, level: 3, spared: 5 } });
  assert.equal(spared.rail.spareOverCap, 2);

  // 104 (a): while the child is ahead of the band (press, finish) he neither gives nor overlooks; the finisher is his move there
  const pressed = newWatch();
  for (const [mode, kind] of [['press', 'honest'], ['finish', 'finisher'], ['spar', 'overlook'], ['ease', 'chance'], ['press', 'variety']]) {
    look(pressed, ROOK_TO_TAKE, KING_DOWN, { choice: { mode, kind, loss: 100 } });
  }
  assert.equal(pressed.rail.pressSoft, 0);
  for (const [mode, kind] of [['press', 'overlook'], ['press', 'chance'], ['finish', 'concession']]) {
    look(pressed, ROOK_TO_TAKE, KING_DOWN, { choice: { mode, kind, loss: 100 } });
  }
  assert.equal(pressed.rail.pressSoft, 3);
});

// ---------------------------------------------------------------------------------------------------------------
// real games on one worker thread
// ---------------------------------------------------------------------------------------------------------------

test('smoke: two shortened games on one worker give the same records twice (depth-bound table); a game is the same played alone, and the state the teacher keeps shows in it', { timeout: 30000 }, async () => {
  const options = { games: 1, seed: 3, only: ['coached-A', 'first-A'], path: 'table', jobs: 1, plyLimit: 24, gameTimeoutMs: 20000 };
  const first = await within(runSimulation(options), 25000, 'the first run');
  const second = await within(runSimulation({ ...options, print: true }), 25000, 'the second run');
  assert.equal(first.failed.length, 0, first.failed.map(f => f.error).join('; '));
  assert.equal(first.records.map(r => `${r.pairing}:${r.seed}`).join(' '), 'coached-A:3 first-A:3');
  // the second run keeps the move lists; nothing else differs
  const numbersOf = records => JSON.stringify(records.map(({ text: _text, ...numbers }) => numbers));
  assert.ok(numbersOf(second.records) === JSON.stringify(first.records), 'the two runs differ');
  for (const record of first.records) {
    assert.equal(record.plies, 24, 'the game is stopped at the ply limit');
    assert.equal(record.reason, 'stopped');
    assert.equal(record.childMoves, 12);
    assert.equal(record.rivalMoves, 12);
    assert.equal(Object.values(record.kinds).reduce((a, b) => a + b, 0), record.rivalMoves);
    assert.equal(Object.values(record.modes).reduce((a, b) => a + b, 0), record.rivalMoves);
    assert.equal(record.rail.moves, record.rivalMoves);
    assert.ok(record.inBand <= record.childMoves);
    assert.equal(record.text, undefined);
  }
  const [coached, firstGame] = first.records;
  // Section 4.7.5, step 1: the rival's first moves are opening variety, four of them for a child who has played
  // before and two in the very first game.
  assert.equal(coached.kinds.variety, 4);
  assert.equal(firstGame.kinds.variety, 2);
  // 诸葛亮 holds a move only in a coached pairing: there the bot took at least one of its first tries back
  assert.equal(firstGame.held, 0);
  assert.ok(coached.held >= 1, 'the coached bot looked again at least once');

  // The second game again, alone on a fresh worker: nothing of the game that the first worker played before it may
  // show in it. (With several workers, which worker plays which game depends on the load of the machine.)
  const alone = await within(runSimulation({ ...options, only: ['first-A'] }), 25000, 'the run of one game');
  assert.equal(alone.failed.length, 0, alone.failed.map(f => f.error).join('; '));
  assert.equal(alone.records.length, 1);
  assert.ok(JSON.stringify(alone.records[0]) === JSON.stringify(firstGame), 'the game differs when it is played alone');

  const text = second.records[1].text;
  assert.match(text?.[0] ?? '', /^=== first-A · 种子 3 · 走法 table · 起始等级 2 · /);
  assert.equal(text?.length, 2 + 12);                                  // two header lines, then one line per move pair

  // The state of the game (section 4.7.2) is kept with recordChildMove and recordOpponentMove. The drift follows from
  // the modes of the rival's moves, which the printed game shows: half a level down for every sixth eased move in a
  // row, half a level up for every tenth pressed one.
  const modes = (text ?? []).slice(2).map(line => /\[(press|spar|ease|finish) (?:honest|variety|overlook|chance|concession|finisher)[ \]]/.exec(line)?.[1]);
  assert.equal(modes.length, 12);
  let ease = 0, press = 0, drift = 0;
  for (const mode of modes) {
    assert.ok(mode !== undefined, 'every move pair shows the mode of the rival\'s move');
    ease = mode === 'ease' ? ease + 1 : 0;
    press = mode === 'press' || mode === 'finish' ? press + 1 : 0;
    if (mode === 'ease' && ease % 6 === 0) drift = Math.max(-3, drift - 0.5);
    if (press > 0 && press % 10 === 0) drift = Math.min(2, drift + 0.5);
  }
  assert.notEqual(drift, 0, 'the game has six eased moves in a row');
  assert.equal(firstGame.drift, drift);
  for (const mode of /** @type {const} */ (['press', 'spar', 'ease', 'finish'])) assert.equal(firstGame.modes[mode], modes.filter(m => m === mode).length, mode);
  // twelve moves of a bot that does not play like level 2 have moved the accuracy shift, and the level is the sum
  assert.notEqual(firstGame.shift, 0);
  assert.ok(Math.abs(firstGame.level - Math.max(1, Math.min(9, 2 + firstGame.shift + firstGame.drift))) < 1e-9);
});

test('smoke: the opponent job on the virtual clock (brain path, slow device): the second game of a worker is the same played alone', { timeout: 30000 }, async () => {
  const options = { games: 2, seed: 9, only: ['matched-B'], path: 'slow', jobs: 1, plyLimit: 12, gameTimeoutMs: 20000 };
  const pair = await within(runSimulation(options), 25000, 'the run of two games');
  assert.equal(pair.failed.length, 0, pair.failed.map(f => f.error).join('; '));
  assert.equal(pair.records.map(r => `${r.pairing}:${r.seed}`).join(' '), 'matched-B:9 matched-B:10');
  for (const record of pair.records) {
    assert.equal(record.plies, 12);
    assert.equal(record.rivalMoves, 6);
    assert.equal(record.kinds.variety, 4);
    // the plan row of the slow class looks at most six plies deep (section 4.8.1)
    assert.ok(record.depthSum <= 6 * record.rivalMoves && record.depthSum >= record.rivalMoves);
  }
  assert.ok(JSON.stringify(pair.records[0]) !== JSON.stringify({ ...pair.records[1], seed: 9 }), 'two seed numbers, two games');
  // seed 10 again, alone on a fresh worker: no time is measured, and nothing is left of the game played before it
  const alone = await within(runSimulation({ ...options, games: 1, seed: 10 }), 25000, 'the run of one game');
  assert.equal(alone.failed.length, 0, alone.failed.map(f => f.error).join('; '));
  assert.equal(alone.records.length, 1);
  assert.ok(JSON.stringify(alone.records[0]) === JSON.stringify(pair.records[1]), 'the game differs when it is played alone');
});

test('the default path: the mid device calibrates as its class and its rival searches as deep as his level, within the plan row', { timeout: 30000 }, async () => {
  // The path `npm run test:sim` measures is a decision (the brain's own opponent job on the mid device): the numbers of
  // two paths are not comparable, so a change of the default is made here too.
  assert.equal(DEFAULT_PATH, 'mid');
  // a device that calibrated as another class would fail every game it is given
  const run = await within(runSimulation({ games: 1, seed: 3, only: ['matched-B', 'matched-D'], path: 'mid', jobs: 1, plyLimit: 2, gameTimeoutMs: 20000 }), 25000, 'the run');
  assert.equal(run.failed.length, 0, run.failed.map(f => f.error).join('; '));
  assert.equal(run.records.map(r => r.pairing).join(' '), 'matched-B matched-D');
  for (const record of run.records) {
    assert.equal(record.rivalMoves, 1);
    assert.equal(record.kinds.variety, 1);
  }
  // The plan row of the mid class would look seven plies deep. The rival thinks as deep as his level (CONTRACT-NOTES
  // 143 a): his first move, one of the lines that are exact at his table's depth, is searched to depth 5 at level 3
  // and to depth 6 at level 6.5, on every device.
  assert.deepEqual(run.records.map(r => r.depthSum), [5, 6]);
  for (const path of /** @type {const} */ (['slow', 'fast'])) {
    const other = await within(runSimulation({ games: 1, seed: 3, only: ['matched-B', 'matched-D'], path, jobs: 1, plyLimit: 2, gameTimeoutMs: 20000 }), 25000, `the ${path} run`);
    assert.deepEqual(other.records.map(r => r.depthSum), [5, 6], path);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// the worker pool
// ---------------------------------------------------------------------------------------------------------------

test('a game that does not finish in time is reported as not finished, and the run still ends', { timeout: 30000 }, async () => {
  const started = Date.now();
  const run = await within(runSimulation({ games: 2, seed: 1, only: ['matched-D'], path: 'table', jobs: 1, gameTimeoutMs: 1 }), 25000, 'the run');
  assert.equal(run.records.length, 0);
  assert.equal(run.failed.length, 2);
  assert.equal(run.failed.map(f => `${f.pairing}:${f.seed}`).join(' '), 'matched-D:1 matched-D:2');
  for (const failure of run.failed) assert.match(failure.error, /not finished within 0\.001 s/);
  // A worker that is in the middle of a game when its time is up (this game runs to the ply limit, several seconds)
  // is stopped all the same.
  const busy = await within(runSimulation({ games: 1, seed: 1, only: ['matched-D'], path: 'table', jobs: 1, gameTimeoutMs: 400 }), 25000, 'the busy run');
  assert.equal(busy.records.length, 0);
  assert.equal(busy.failed.map(f => `${f.pairing}:${f.seed} ${f.error}`).join('|'), 'matched-D:1 not finished within 0.4 s');
  assert.ok(Date.now() - started >= 400, 'the busy worker had its time');
  assert.ok(Date.now() - started < 20000);
});

test('a worker that dies is replaced, its game is reported, and the run still ends', { timeout: 30000 }, async () => {
  // A path that does not exist makes the worker throw outside the game: the thread dies with every game it is given.
  const run = await within(runSimulation({ games: 3, seed: 1, only: ['matched-A'], path: 'no-such-path', jobs: 2, gameTimeoutMs: 20000 }), 25000, 'the run');
  assert.equal(run.records.length, 0);
  assert.equal(run.failed.map(f => `${f.pairing}:${f.seed}`).sort().join(' '), 'matched-A:1 matched-A:2 matched-A:3');
  for (const failure of run.failed) assert.match(failure.error, /^worker (error|exited)/);
});

test('a run always has a worker, whatever the number of jobs', { timeout: 30000 }, async () => {
  const run = await within(runSimulation({ games: 1, seed: 1, only: ['plain-A'], path: 'table', jobs: NaN, plyLimit: 2, gameTimeoutMs: 20000 }), 25000, 'the run');
  assert.equal(run.failed.length, 0, run.failed.map(f => f.error).join('; '));
  assert.equal(run.records.length, 1);
  assert.equal(run.records[0].plies, 2);
  // no game to play: the run ends at once, with nothing
  const none = await within(runSimulation({ games: 1, seed: 1, only: [], path: 'table', jobs: 2 }), 5000, 'the empty run');
  assert.equal(none.records.length + none.failed.length, 0);
});
