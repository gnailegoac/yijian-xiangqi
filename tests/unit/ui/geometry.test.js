import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEW_W, VIEW_H, PITCH, X0, Y0, toView, fromView, viewPoint, pxPoint, horseLeg, crossesRiver, fileLabels,
} from '../../../src/ui/geometry.js';

const COLORS = /** @type {const} */ (['red', 'black']);

test('the view box is 920 x 1060 with 100 units per cell and the first intersection at (60, 80)', () => {
  assert.deepEqual([VIEW_W, VIEW_H, PITCH, X0, Y0], [920, 1060, 100, 60, 80]);
  // 8 x 9 cells of grid plus the margins of §10.1 (0.6 c at the sides, 0.8 c at top and bottom)
  assert.equal(X0 + 8 * PITCH + X0, VIEW_W);
  assert.equal(Y0 + 9 * PITCH + Y0, VIEW_H);
});

test('toView / fromView are inverse for both orientations', () => {
  for (const bottom of COLORS) {
    const seen = new Set();
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 9; col++) {
        const { vx, vy } = toView({ row, col }, bottom);
        assert.ok(Number.isInteger(vx) && vx >= 0 && vx <= 8, `vx in range for ${row},${col} (${bottom})`);
        assert.ok(Number.isInteger(vy) && vy >= 0 && vy <= 9, `vy in range for ${row},${col} (${bottom})`);
        assert.deepEqual(fromView(vx, vy, bottom), { row, col });
        seen.add(`${vx},${vy}`);
      }
    }
    assert.equal(seen.size, 90, `every view square is hit exactly once (${bottom})`);
    for (let vy = 0; vy < 10; vy++) {
      for (let vx = 0; vx < 9; vx++) assert.deepEqual(toView(fromView(vx, vy, bottom), bottom), { vx, vy });
    }
  }
  // Red at the bottom: view coordinates are the board's. Row 9 (red's back rank) is the bottom view row.
  assert.deepEqual(toView({ row: 9, col: 0 }, 'red'), { vx: 0, vy: 9 });
  assert.deepEqual(toView({ row: 0, col: 8 }, 'red'), { vx: 8, vy: 0 });
  // Black at the bottom: the board is turned by 180 degrees, so black's back rank (row 0) is the bottom view row.
  assert.deepEqual(toView({ row: 0, col: 0 }, 'black'), { vx: 8, vy: 9 });
  assert.deepEqual(toView({ row: 9, col: 0 }, 'black'), { vx: 8, vy: 0 });
  assert.deepEqual(toView({ row: 9, col: 8 }, 'black'), { vx: 0, vy: 0 });
  assert.deepEqual(fromView(4, 9, 'black'), { row: 0, col: 4 });
});

test('viewPoint and pxPoint give the centre of a square', () => {
  assert.deepEqual(viewPoint({ row: 0, col: 0 }, 'red'), { x: 60, y: 80 });
  assert.deepEqual(viewPoint({ row: 9, col: 8 }, 'red'), { x: 860, y: 980 });
  assert.deepEqual(viewPoint({ row: 7, col: 1 }, 'red'), { x: 160, y: 780 });
  assert.deepEqual(viewPoint({ row: 9, col: 8 }, 'black'), { x: 60, y: 80 });
  assert.deepEqual(viewPoint({ row: 7, col: 1 }, 'black'), { x: 760, y: 280 });
  // CSS px: (0.6 + vx) c, (0.8 + vy) c — the same point as the view box scaled by c / 100.
  for (const bottom of COLORS) {
    for (const c of [34.4, 65.28, 84]) {
      for (const sq of [{ row: 0, col: 0 }, { row: 4, col: 4 }, { row: 9, col: 8 }, { row: 2, col: 7 }]) {
        const view = viewPoint(sq, bottom);
        const px = pxPoint(sq, bottom, c);
        assert.ok(Math.abs(px.x - view.x * c / 100) < 1e-9, `x of ${JSON.stringify(sq)} at c=${c} (${bottom})`);
        assert.ok(Math.abs(px.y - view.y * c / 100) < 1e-9, `y of ${JSON.stringify(sq)} at c=${c} (${bottom})`);
      }
    }
  }
  const p = pxPoint({ row: 9, col: 4 }, 'red', 50);
  assert.ok(Math.abs(p.x - 230) < 1e-9 && Math.abs(p.y - 490) < 1e-9, 'red king at c = 50 is at (230, 490)');
});

test('horseLeg', () => {
  const from = { row: 5, col: 4 };
  /** The eight horse moves from (5,4) with the square that blocks each. */
  const cases = [
    [{ row: 3, col: 3 }, { row: 4, col: 4 }], [{ row: 3, col: 5 }, { row: 4, col: 4 }],
    [{ row: 7, col: 3 }, { row: 6, col: 4 }], [{ row: 7, col: 5 }, { row: 6, col: 4 }],
    [{ row: 4, col: 2 }, { row: 5, col: 3 }], [{ row: 6, col: 2 }, { row: 5, col: 3 }],
    [{ row: 4, col: 6 }, { row: 5, col: 5 }], [{ row: 6, col: 6 }, { row: 5, col: 5 }],
  ];
  for (const [to, leg] of cases) assert.deepEqual(horseLeg(from, to), leg, `leg of ${JSON.stringify(to)}`);
  // The opening move 马二进三 (row 9 col 7 -> row 7 col 6) is blocked at row 8 col 7.
  assert.deepEqual(horseLeg({ row: 9, col: 7 }, { row: 7, col: 6 }), { row: 8, col: 7 });
  // Anything that is not a horse vector has no leg.
  for (const to of [{ row: 5, col: 4 }, { row: 4, col: 4 }, { row: 5, col: 6 }, { row: 3, col: 2 }, { row: 3, col: 4 }, { row: 2, col: 3 }, { row: 4, col: 5 }]) {
    assert.equal(horseLeg(from, to), null, `no leg for ${JSON.stringify(to)}`);
  }
});

test('crossesRiver', () => {
  const pawn = (/** @type {'red'|'black'} */ color) => ({ type: /** @type {const} */ ('pawn'), color });
  // Red moves up the board (towards row 0): its river step is row 5 -> row 4.
  assert.equal(crossesRiver({ from: { row: 5, col: 4 }, to: { row: 4, col: 4 } }, pawn('red')), true);
  assert.equal(crossesRiver({ from: { row: 6, col: 4 }, to: { row: 5, col: 4 } }, pawn('red')), false);
  assert.equal(crossesRiver({ from: { row: 4, col: 4 }, to: { row: 3, col: 4 } }, pawn('red')), false);
  assert.equal(crossesRiver({ from: { row: 4, col: 4 }, to: { row: 4, col: 5 } }, pawn('red')), false);
  assert.equal(crossesRiver({ from: { row: 4, col: 4 }, to: { row: 5, col: 4 } }, pawn('red')), false);
  // Black moves down the board: row 4 -> row 5.
  assert.equal(crossesRiver({ from: { row: 4, col: 2 }, to: { row: 5, col: 2 } }, pawn('black')), true);
  assert.equal(crossesRiver({ from: { row: 3, col: 2 }, to: { row: 4, col: 2 } }, pawn('black')), false);
  assert.equal(crossesRiver({ from: { row: 5, col: 2 }, to: { row: 6, col: 2 } }, pawn('black')), false);
  assert.equal(crossesRiver({ from: { row: 5, col: 2 }, to: { row: 4, col: 2 } }, pawn('black')), false);
  // Only pawns "cross the river" (the splash and the banner belong to them).
  for (const type of /** @type {const} */ (['rook', 'horse', 'cannon', 'king', 'advisor', 'elephant'])) {
    assert.equal(crossesRiver({ from: { row: 5, col: 4 }, to: { row: 4, col: 4 } }, { type, color: 'red' }), false, type);
    assert.equal(crossesRiver({ from: { row: 4, col: 4 }, to: { row: 5, col: 4 } }, { type, color: 'black' }), false, type);
  }
});

test('file labels for red at the bottom and for black at the bottom', () => {
  // SPEC §10.2.1 item 8 / CONTRACT-NOTES item 80, left to right on screen.
  assert.deepEqual(fileLabels('red'), {
    top: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    bottom: ['九', '八', '七', '六', '五', '四', '三', '二', '一'],
  });
  assert.deepEqual(fileLabels('black'), {
    top: ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
    bottom: ['9', '8', '7', '6', '5', '4', '3', '2', '1'],
  });
  // The rule behind the rows: a label names the file of the square under it, in the numbering of the side whose
  // back rank is on that edge. Red's cannon on file 二 starts at col 7; black's on file 2 starts at col 1.
  for (const bottom of COLORS) {
    const labels = fileLabels(bottom);
    const redEdge = bottom === 'red' ? labels.bottom : labels.top;
    const blackEdge = bottom === 'red' ? labels.top : labels.bottom;
    assert.equal(redEdge[toView({ row: 9, col: 7 }, bottom).vx], '二');
    assert.equal(redEdge[toView({ row: 9, col: 4 }, bottom).vx], '五');
    assert.equal(blackEdge[toView({ row: 0, col: 1 }, bottom).vx], '2');
    assert.equal(blackEdge[toView({ row: 0, col: 4 }, bottom).vx], '5');
  }
  // A fresh object every call: a caller may keep or change what it got.
  assert.notEqual(fileLabels('red').top, fileLabels('red').top);
});
