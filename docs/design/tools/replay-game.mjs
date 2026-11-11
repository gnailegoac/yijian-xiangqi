// Rebuilds the scripted game of work/PF/game-local-1.out from its log (the child's trial squares, the rival's notations)
// and looks at one position with the engine: what the table says about every move, and what the brain's assess job says
// about the move that was praised.
// usage: node replay-pf-game.mjs <repo> <game .out file> <ply to stop at> <from rc> <to rc>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [, , repo, outFile, stopArg, fromArg, toArg] = process.argv;
const load = rel => import(pathToFileURL(join(repo, rel)).href);
const { createInitialBoard, applyMove, boardToFen, getLegalMoves, moveToNotation, isInCheck } = await load('src/core/engine.js');
const { parseNotation } = await load('src/core/notation.js');
const { createSearcher, scoreToCp } = await load('src/core/search.js');
const { createBrain } = await load('src/core/brain.js');

const stop = Number(stopArg);
let board = createInitialBoard();
let ply = 0;
/** @type {string[]} */
const fens = [];
const lines = readFileSync(outFile, 'utf8').split('\n');
let pendingTrial = null;
for (const line of lines) {
  if (ply >= stop) break;
  const trial = /^\s+试走 \S+ (\d)(\d)-(\d)(\d)/.exec(line);
  if (trial) { pendingTrial = { from: { row: +trial[1], col: +trial[2] }, to: { row: +trial[3], col: +trial[4] } }; continue; }
  const round = /^-- 第(\d+)回合 \(ply (\d+)\)/.exec(line);
  if (round) continue;
  const rival = /\[对方走后\] 诸葛亮 \[local\] (?:主公请看——|不可不防！)?(.{4})/.exec(line);
  if (rival && ply % 2 === 0 && pendingTrial) {
    // the child's confirmed move comes before the rival's reply
    fens.push(boardToFen(board, 'red'));
    board = applyMove(board, pendingTrial); ply += 1; pendingTrial = null;
  }
  if (rival && ply % 2 === 1) {
    const parsed = parseNotation(rival[1], board, 'black');
    const move = parsed && (parsed.move ?? parsed);
    if (!move || !move.from) { console.log(`cannot parse rival move "${rival[1]}" at ply ${ply}:`, JSON.stringify(parsed)); process.exit(1); }
    fens.push(boardToFen(board, 'black'));
    board = applyMove(board, move); ply += 1;
  }
}
const turn = ply % 2 === 0 ? 'red' : 'black';
const fen = boardToFen(board, turn);
console.log(`ply ${ply}, ${turn} to move, in check: ${isInCheck(board, turn)}`);
console.log(fen);
for (const row of board) console.log(row.map(p => (p ? (p.color === 'red' ? p.type[0].toUpperCase() : p.type[0]) : '.')).join(' ').replace(/H/g, 'N').replace(/h/g, 'n'));

const legal = getLegalMoves(board, turn);
console.log(`legal moves: ${legal.length}`);
const searcher = createSearcher();
for (const depth of [4, 6, 8]) {
  const table = searcher.analyzeSync({ fen, allDepth: Math.min(depth, 5), multiPV: 6, maxDepth: depth, minDepth: depth, timeMs: 60000 });
  console.log(`\ndepth ${depth} (reached ${table.depth}, all moves exact to ${table.allDepth}):`);
  for (const l of table.lines.slice(0, 8)) {
    console.log(`  ${moveToNotation(board, l.move)}  ${scoreToCp(l.score)}  depth ${l.depth}  shallow ${l.byDepth.map(scoreToCp).join(',')}`);
  }
  if (fromArg) {
    const from = { row: +fromArg[0], col: +fromArg[1] }, to = { row: +toArg[0], col: +toArg[1] };
    const line = table.lines.find(l => l.move.from.row === from.row && l.move.from.col === from.col && l.move.to.row === to.row && l.move.to.col === to.col);
    console.log(`  the praised move ${line ? moveToNotation(board, line.move) : '?'}: ${line ? `${scoreToCp(line.score)} at depth ${line.depth}, upper ${line.upper === null ? '-' : scoreToCp(line.upper)}, by depth ${line.byDepth.map(scoreToCp).join(',')}, rank ${table.lines.indexOf(line) + 1} of ${table.lines.length}` : 'not in the table'}`);
  }
}

if (fromArg) {
  const brain = createBrain();
  const move = { from: { row: +fromArg[0], col: +fromArg[1] }, to: { row: +toArg[0], col: +toArg[1] } };
  const survey = await brain.survey({ fen, history: fens.slice(-8), ply, level: 2 });
  const res = await brain.assess({ fen, history: fens.slice(-8), ply, move, level: 2, table: survey.table, reveal: 2 });
  const a = res.assessment;
  console.log(`\nbrain (${brain.speed.speedClass}): survey best ${moveToNotation(board, survey.table.lines[0].move)} ${scoreToCp(survey.table.lines[0].score)}`);
  console.log('assessment:', JSON.stringify({ cat: a.cat, loss: a.loss, bestCp: a.bestCp, moveCp: a.moveCp, flags: a.flags, patterns: a.patterns, outcome: a.outcome, danger: a.danger && a.danger.code }, null, 1));
  console.log('replies:', res.replies.map(r => `${r.move.notation ?? JSON.stringify(r.move)} ${JSON.stringify(r.outcome)}`).join(' | '));
}
