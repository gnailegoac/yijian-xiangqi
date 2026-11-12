// A scripted child for the A1 browser games: reads the board from the DOM, picks a move with the repo's own search (in
// Node), and plays it with taps like a child would.
import { createSearcher } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/search.js';
import { boardToFen, applyMove, getLegalMoves } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js';
import { sleep, phase, ply, waitFor, tapCell, tapSel } from './lib.mjs';

export async function readBoard(page) {
  const cells = await page.evaluate(() => [...document.querySelectorAll('.board-cell[data-piece]')].filter((c) => c.dataset.piece).map((c) => {
    const p = document.querySelector(`.piece[data-id="${c.dataset.piece}"]`);
    return { row: +c.dataset.row, col: +c.dataset.col, id: c.dataset.piece, type: p?.dataset.type, color: p?.dataset.color };
  }));
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const c of cells) board[c.row][c.col] = { id: c.id, type: c.type, color: c.color };
  return board;
}

export function createBot({ style = 'strong', color = 'red', timeMs = 250, seed = 1 } = {}) {
  const searcher = createSearcher();
  let rnd = seed >>> 0;
  const rand = () => { rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0; return rnd / 4294967296; };
  const seen = [];                       // FENs of the positions this game went through (for the repetition rule)
  return {
    color,
    /** @returns {{from, to, note}} */
    choose(board) {
      const fen = boardToFen(board, color);
      const legal = getLegalMoves(board, color);
      if (legal.length === 0) return null;
      let pick;
      let note = '';
      if (style === 'random') {
        pick = legal[Math.floor(rand() * legal.length)];
      } else if (style === 'weak') {
        const table = searcher.analyzeSync({ fen, history: seen.slice(-12), timeMs, allDepth: 2, maxDepth: 2 });
        const lines = table.lines;
        // the worst third, at random: loses quickly without being one fixed line
        const from = Math.floor(lines.length * 2 / 3);
        pick = lines[from + Math.floor(rand() * (lines.length - from))].move;
        note = `weak ${lines.length}`;
      } else {
        const table = searcher.analyzeSync({ fen, history: seen.slice(-12), timeMs, maxDepth: 7, multiPV: 3 });
        const best = table.lines[0];
        const fresh = table.lines.find((l) => l.repeats <= 1 && l.upper === null && best.score - l.score <= 120);
        pick = (best.repeats > 1 && fresh ? fresh : best).move;
        note = `d${table.depth} s${best.score}${best.mate ? ' mate' + best.mate : ''}`;
      }
      const move = legal.find((m) => m.from.row === pick.from.row && m.from.col === pick.from.col && m.to.row === pick.to.row && m.to.col === pick.to.col);
      seen.push(fen);
      seen.push(boardToFen(applyMove(board, move), color === 'red' ? 'black' : 'red'));
      return { from: move.from, to: move.to, capture: !!move.captured, note };
    },
  };
}

/** Plays one child move with taps. `how`: 'second-tap' | 'button'. Returns when the move is committed (phase left tentative). */
export async function playMove(page, move, { how = 'button', think = 450, onTrial } = {}) {
  await tapCell(page, move.from.row, move.from.col);
  await waitFor(page, () => document.querySelector('#app').dataset.phase === 'selected', null, 4000, 'selected');
  await sleep(120);
  await tapCell(page, move.to.row, move.to.col);
  await waitFor(page, () => document.querySelector('#app').dataset.phase === 'tentative', null, 4000, 'tentative');
  if (onTrial) await onTrial();
  await sleep(think);
  for (let i = 0; i < 12; i++) {                         // a blunder's guard is 700 ms: try until the confirm is taken
    if (how === 'second-tap') await tapCell(page, move.to.row, move.to.col);
    else await tapSel(page, '#confirm-button');
    await sleep(200);
    if ((await phase(page)) !== 'tentative') return;
  }
  throw new Error('the trial was never confirmed');
}

/** Waits until it is the child's turn again or the game is over. */
export async function waitTurn(page, minPly, ms = 30000) {
  return waitFor(page, (n) => {
    const a = document.querySelector('#app');
    const p = a.dataset.phase;
    return p === 'over' ? 'over' : (p === 'childTurn' && Number(a.dataset.ply) >= n ? 'childTurn' : null);
  }, minPly, ms, `the child's turn at ply >= ${minPly}`);
}
