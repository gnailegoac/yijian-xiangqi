// The built copy (scratch build of the current tree): boots, reads config.json from the root, loads the worker from the hashed folder.
import { sleep, phase, ply, waitFor, start } from '../lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from '../bot.mjs';
export default async ({ page, shot }) => {
  const log = (...a) => console.log('[dist]', ...a);
  const seen = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (/config\.json|search-worker|app\.js/.test(u.pathname)) seen.push(`${r.status()} ${u.pathname}`); });
  await page.reload({ waitUntil: 'load' });
  await start(page);
  await waitTurn(page, 0, 15000);
  const bot = createBot({ style: 'strong' });
  for (let n = 0; n < 2; n++) {
    const before = await ply(page);
    await sleep(300);
    await playMove(page, bot.choose(await readBoard(page)), {});
    await waitTurn(page, before + 2, 30000);
  }
  await sleep(600);
  await shot('two-pairs');
  log('ply', await ply(page), 'ready', await page.evaluate(() => document.documentElement.dataset.ready), 'coach', await page.evaluate(() => document.querySelector('#app').dataset.coach));
  log('requests', JSON.stringify(seen));
};
