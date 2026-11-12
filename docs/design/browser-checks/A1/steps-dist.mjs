import { sleep, ply, waitFor, bubble, start } from './lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from './bot.mjs';
export default async ({ page, shot }) => {
  const urls = [];
  page.on('request', (r) => urls.push(new URL(r.url()).pathname));
  await start(page);
  const bot = createBot({ style: 'strong' });
  for (let n = 1; n <= 2; n++) {
    await waitTurn(page, 0); await sleep(350);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), { think: 500 });
    await waitTurn(page, before + 2);
  }
  await sleep(800); await shot('two-pairs');
  console.log('ply', await ply(page), 'coach', await page.evaluate(() => document.querySelector('#app').dataset.coach), 'ready', await page.evaluate(() => document.documentElement.dataset.ready),
              'bubble', JSON.stringify(await bubble(page)));
  console.log('scripts from', await page.evaluate(() => [...new Set(performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname).filter((p) => p.endsWith('.js')).map((p) => p.split('/').slice(0, 4).join('/')))].join(' ')));
  console.log('worker + config', await page.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname).filter((p) => /search-worker|config\.json/.test(p)).join(' ')));
};
