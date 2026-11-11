// Search benchmark (contract section 14.9, `npm run bench`). Informational: it prints numbers and always exits 0.
//
// For the three reference positions of Appendix A1 (opening, middlegame A, middlegame B) and the three root modes
// (best move only; every root move exact; every root move exact to depth 4, then the top 6 exact) it prints
//   1. the depth reached and the nodes per second inside a 300 ms and a 1 s budget,
//   2. the time to a fixed depth,
// next to the v1 numbers and the prototype rows of Appendix A1, which are the targets on the dev machine
// (>= 1.0 M nodes/s and the prototype's depths).
//
// Options: --runs N (default 3: each budget row is the median of N runs), --max-depth N (default 8: deepest time-to-depth column).
import os from 'node:os';
import { createSearcher, perft } from '../src/core/search.js';
import { REFERENCE_POSITIONS } from '../tests/helpers/positions.js';

/** @import { AnalyzeRequest } from '../src/core/types.js' */

/** @param {string} name @param {number} fallback @returns {number} */
function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? Number(process.argv[at + 1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
const RUNS = option('runs', 3);
const MAX_DEPTH = Math.max(4, Math.min(12, option('max-depth', 8)));

/** @type {{key: 'opening'|'middlegameA'|'middlegameB', label: string}[]} */
const POSITIONS = [
  { key: 'opening', label: 'opening' },
  { key: 'middlegameA', label: 'middlegame A' },
  { key: 'middlegameB', label: 'middlegame B' },
];
/** @type {{key: 'best'|'all'|'table', label: string, request: Partial<AnalyzeRequest>}[]} */
const MODES = [
  { key: 'best', label: 'best move only', request: {} },
  { key: 'all', label: 'every root move exact', request: { allDepth: 99 } },
  { key: 'table', label: 'all exact to depth 4, then top 6', request: { allDepth: 4, multiPV: 6 } },
];
const BUDGETS = [300, 1000];

// Appendix A1, measured on the dev machine (Xeon Platinum 8488C, Node 24, one thread).
/** v1 (`legacy/src/ai.js`): [depth, nodes per second] per position. */
const V1 = {
  'chooseMove, 300 ms': { opening: [2, 10600], middlegameA: [2, 12000], middlegameB: [2, 9900] },
  'chooseMove, 1 s': { opening: [2, 12300], middlegameA: [3, 12900], middlegameB: [2, 10900] },
  'analyzePosition (all roots), 1 s': { opening: [2, 10500], middlegameA: [2, 10400], middlegameB: [2, 9900] },
};
/** Depths of the prototype rows: the targets for this build on the dev machine. */
const TARGET_DEPTH = {
  best: { 300: { opening: 7, middlegameA: 9, middlegameB: 7 }, 1000: { opening: 9, middlegameA: 10, middlegameB: 8 } },
  all: { 300: { opening: 5, middlegameA: 6, middlegameB: 5 }, 1000: { opening: 6, middlegameA: 7, middlegameB: 6 } },
};
const TARGET_NPS = 1.0e6;
/** Column widths of the printed tables. */
const LABEL = 36, COLUMN = 11;
/** Prototype time to a fixed depth in ms (range over the three positions), depths 4..8. */
const PROTOTYPE_MS = {
  best: ['3-12', '4-42', '24-103', '95-233', '147-758'],
  all: ['22-49', '73-161', '147-433', '378-1338', '988-3589'],
};

/** @param {number[]} values @returns {number} */
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}
/** @param {string|number} text @param {number} width @returns {string} */
const left = (text, width) => String(text).padEnd(width);
/** @param {string|number} text @param {number} width @returns {string} */
const right = (text, width) => String(text).padStart(width);
/** @param {number} nps @returns {string} */
const mega = nps => `${(nps / 1e6).toFixed(2)} M`;

const searcher = createSearcher();

console.log('弈间 search benchmark (contract section 14.9)');
console.log(`machine: ${os.cpus()[0]?.model ?? 'unknown'}, ${os.platform()} ${os.arch()}, Node ${process.version}`);
console.log(`runs per budget row: ${RUNS}; time-to-depth columns: 4..${MAX_DEPTH}`);

// ---- warm-up and self-calibration ----
searcher.analyzeSync({ fen: REFERENCE_POSITIONS.opening, timeMs: 600 });
searcher.analyzeSync({ fen: REFERENCE_POSITIONS.middlegameA, timeMs: 400, allDepth: 4, multiPV: 6 });
const speed = searcher.calibrate();
const perftStart = performance.now();
const perftLeaves = perft(REFERENCE_POSITIONS.opening, 4);
const perftMs = performance.now() - perftStart;
console.log('');
console.log(`calibrate(): ${mega(speed.perftNps)} perft leaf nodes/s -> speedClass '${speed.speedClass}'`);
console.log(`perft(start, 4) = ${perftLeaves} in ${perftMs.toFixed(0)} ms (${mega(perftLeaves / perftMs * 1000)} leaf nodes/s)`);

// ---- 1. fixed budgets ----
console.log('');
console.log('1. Depth and speed inside a time budget (median of the runs; transposition table cleared before each run)');
console.log(`${left('mode', LABEL)}${left('budget', 9)}${POSITIONS.map(p => left(p.label, 28)).join('')}`);
/** Lowest median nodes/s over all rows, per position. @type {Record<string, number>} */
const slowest = {};
/** @type {string[]} */
const misses = [];
for (const mode of MODES) {
  for (const budget of BUDGETS) {
    let row = `${left(mode.label, LABEL)}${left(`${budget} ms`, 9)}`;
    for (const position of POSITIONS) {
      const depths = [], rates = [];
      for (let run = 0; run < RUNS; run++) {
        searcher.clear();
        const result = searcher.analyzeSync({ fen: REFERENCE_POSITIONS[position.key], timeMs: budget, maxDepth: 30, ...mode.request });
        depths.push(result.depth);
        rates.push(result.nodes / result.timeMs * 1000);
      }
      const depth = median(depths), nps = median(rates);
      slowest[position.key] = Math.min(slowest[position.key] ?? Infinity, nps);
      let cell = `depth ${right(depth, 2)}, ${mega(nps)} nodes/s`;
      if (mode.key !== 'table') {
        const target = TARGET_DEPTH[mode.key][budget === 300 ? 300 : 1000][position.key];
        if (depth < target) {
          cell += ' !';
          misses.push(`${mode.label}, ${budget} ms, ${position.label}: depth ${depth}, target ${target}`);
        }
      }
      row += left(cell, 28);
    }
    console.log(row);
  }
}

// ---- 2. time to a fixed depth ----
console.log('');
console.log('2. Time to a fixed depth in ms (one run each; transposition table cleared before each run)');
const depthList = [];
for (let depth = 4; depth <= MAX_DEPTH; depth++) depthList.push(depth);
console.log(`${left('mode', LABEL)}${left('position', 15)}${depthList.map(d => right(`d${d}`, COLUMN)).join('')}`);
for (const mode of MODES) {
  for (const position of POSITIONS) {
    let row = `${left(mode.label, LABEL)}${left(position.label, 15)}`;
    for (const depth of depthList) {
      searcher.clear();
      const result = searcher.analyzeSync({ fen: REFERENCE_POSITIONS[position.key], timeMs: 3_600_000, maxDepth: depth, ...mode.request });
      row += right(result.depth === depth ? result.timeMs.toFixed(0) : `(d${result.depth})`, COLUMN);
    }
    console.log(row);
  }
  if (mode.key !== 'table') {
    console.log(`${left('  prototype, Appendix A1', LABEL)}${left('(range)', 15)}${PROTOTYPE_MS[mode.key].slice(0, depthList.length).map(v => right(v, COLUMN)).join('')}`);
  }
}

// ---- comparison ----
console.log('');
console.log('v1 engine for comparison (Appendix A1, measured on the dev machine):');
for (const [name, row] of Object.entries(V1)) {
  console.log(`${left(`  ${name}`, LABEL + 9)}${POSITIONS.map(p => left(`depth ${row[p.key][0]}, ${(row[p.key][1] / 1000).toFixed(1)} k nodes/s`, 28)).join('')}`);
}
console.log('');
console.log('Targets on the dev machine (Appendix A1): >= 1.0 M nodes/s and the depths of the prototype rows');
console.log(`${left('  prototype, best move only', LABEL)}${left('300 ms', 9)}${POSITIONS.map(p => left(`depth ${TARGET_DEPTH.best[300][p.key]}`, 28)).join('')}`);
console.log(`${left('  prototype, best move only', LABEL)}${left('1000 ms', 9)}${POSITIONS.map(p => left(`depth ${TARGET_DEPTH.best[1000][p.key]}`, 28)).join('')}`);
console.log(`${left('  prototype, every root move exact', LABEL)}${left('300 ms', 9)}${POSITIONS.map(p => left(`depth ${TARGET_DEPTH.all[300][p.key]}`, 28)).join('')}`);
console.log(`${left('  prototype, every root move exact', LABEL)}${left('1000 ms', 9)}${POSITIONS.map(p => left(`depth ${TARGET_DEPTH.all[1000][p.key]}`, 28)).join('')}`);
console.log('');
for (const position of POSITIONS) {
  const nps = slowest[position.key];
  console.log(`nodes/s, slowest row, ${left(position.label, 13)}: ${mega(nps)}  ${nps >= TARGET_NPS ? 'meets the 1.0 M target' : 'BELOW the 1.0 M target'}`);
}
if (misses.length === 0) console.log('depths: every budget row reaches the depth of its prototype row');
else {
  console.log('depths: rows below their prototype row (marked "!" above):');
  for (const miss of misses) console.log(`  ${miss}`);
}
