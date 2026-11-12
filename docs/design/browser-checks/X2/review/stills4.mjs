import { boardShot, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 300);
  await ev(page, () => { window.demo.previewNow(); });
  await sleep(page, 1700);
  await boardShot(page, 'previewNow');
  await sleep(page, 2200);
  const left = await ev(page, () => ({ ghosts: document.querySelectorAll('#board .piece.is-ghost').length, dimmed: document.querySelectorAll('#board .piece.is-dimmed').length, busy: document.documentElement.dataset.uiBusy ?? null }));
  console.log('after previewNow', JSON.stringify(left));
  await ev(page, () => window.view.retractTentative());
  await ev(page, () => window.demo.rivalCapture('rook'));
  await sleep(page, 400);
  await boardShot(page, 'rival-rook');
};
