import { sleep, waitFor } from './lib.mjs';
export default async ({ page, shot }) => {
  await waitFor(page, () => document.documentElement.dataset.ready === '1', null, 10000, 'ready');
  const at = await page.evaluate(() => Math.round(performance.now()));
  const a = await page.evaluate(() => { const app = document.querySelector('#app'); return { phase: app.dataset.phase, coach: app.dataset.coach, ply: app.dataset.ply, layout: app.dataset.layout,
    pieces: document.querySelectorAll('.piece[data-id]').length, undoDisabled: document.querySelector('#undo-button')?.disabled ?? document.querySelector('#undo-button')?.getAttribute('aria-disabled'),
    start: !!document.querySelector('dialog[data-dialog="start"]'), y: Object.keys(window.__yijian ?? {}).join(',') }; });
  console.log('ready at', at, 'ms', JSON.stringify(a));
  await sleep(1500);
  console.log('bubble', await page.evaluate(() => document.querySelector('.bubble')?.textContent), 'stats', JSON.stringify(await page.evaluate(() => window.__yijian.tasks.stats())));
  await shot('ready');
};
