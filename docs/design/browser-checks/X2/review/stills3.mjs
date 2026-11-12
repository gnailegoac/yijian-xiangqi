import { boardShot, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 300);
  await ev(page, () => { window.demo.preview(); });
  await sleep(page, 2300);
  await boardShot(page, 'preview');
  await sleep(page, 1600);
  await ev(page, () => { window.demo.previewTrial(); });
  await sleep(page, 2400);
  await boardShot(page, 'previewT');
  await sleep(page, 1800);
  // "better move" while a trial hovers: preview from the committed position
  await ev(page, async () => {
    const L = window.lab, v = window.view;
    const b = L.createInitialBoard();
    await v.setPosition(b);
    const moves = L.getPieceLegalMoves(b, 7, 7);
    v.setSelection({ row: 7, col: 7 }, moves, []);
    await v.showTentative(moves.find((x) => x.to.row === 7 && x.to.col === 4));
    await new Promise((r) => setTimeout(r, 300));
    const m1 = moves.find((x) => x.to.row === 7 && x.to.col === 5);
    v.previewLine([m1, L.mv(L.applyMove(b, m1), 0, 7, 2, 6)], { from: 'now' });
  });
  await sleep(page, 1500);
  await boardShot(page, 'previewNow');
};
