// Slow tests of src/core/position.js (contract section 14.1, Appendix A3.11), run by `npm run test:slow`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isInCheck } from '../../src/core/engine.js';
import { Position, RED, PAWN } from '../../src/core/position.js';
import { perft } from '../../src/core/search.js';
import { playout } from '../helpers/playout.js';
import { REFERENCE_POSITIONS } from '../helpers/positions.js';

const code = ref => `${ref.from.row}${ref.from.col}${ref.to.row}${ref.to.col}`;

test('perft depth 5 = 133312995', () => {
  assert.equal(perft(REFERENCE_POSITIONS.opening, 5), 133312995);
});

test('differential on 300 playouts with 35 % forced pawn moves', () => {
  let positions = 0, checks = 0, ended = 0, pawnBesideKing = 0;
  for (let seed = 1001; seed <= 1300; seed++) {
    // `game` plays the whole playout with make(), so every position is also checked after incremental updates.
    const game = Position.fromFen(REFERENCE_POSITIONS.opening);
    for (const p of playout({ seed, plies: 200, pawnBias: 0.35 })) {
      const pos = Position.fromBoard(p.board, p.turn);
      const fen = pos.toFen();
      const expected = p.moves.map(code).sort();
      assert.deepEqual(pos.legalMoves().map(m => code(pos.toRef(m))).sort(), expected, `legal moves differ at ${fen}`);
      const inCheck = isInCheck(p.board, p.turn);
      assert.equal(pos.inCheck(), inCheck, `inCheck differs at ${fen}`);
      if (p.move) assert.equal(game.make(game.fromRef(p.move)), true, `make refused a legal move before ${fen}`);
      assert.equal(game.toFen(), fen);
      assert.equal(game.key, pos.key);
      assert.equal(game.lock, pos.lock);
      assert.deepEqual(game.legalMoves().map(m => code(game.toRef(m))).sort(), expected, `legal moves differ after make at ${fen}`);
      assert.equal(game.inCheck(), inCheck, `inCheck differs after make at ${fen}`);
      assert.equal(game.evaluate(), pos.evaluate(), `evaluate differs after make at ${fen}`);
      positions++;
      if (inCheck) checks++;
      if (expected.length === 0) ended++;
      // The case that perft from the start position never reaches: an enemy pawn beside the king.
      const king = pos.kingSq[pos.side];
      const enemyPawn = (pos.side === RED ? 16 : 8) + PAWN;
      if (pos.squares[king - 1] === enemyPawn || pos.squares[king + 1] === enemyPawn) pawnBesideKing++;
    }
  }
  assert.ok(positions > 40000, `only ${positions} positions`);
  assert.ok(checks > 500, `only ${checks} positions in check`);
  assert.ok(ended > 20, `only ${ended} playouts ended by mate or stalemate`);
  assert.ok(pawnBesideKing > 100, `only ${pawnBesideKing} positions with an enemy pawn beside the king`);
});
