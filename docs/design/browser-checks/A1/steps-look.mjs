import { sleep, ply, tapSel, start } from './lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from './bot.mjs';
export default async ({ page, shot }) => {
  const bot = createBot({ style: 'strong' });
  await sleep(300); await shot('start');
  await start(page);
  for (let n = 1; n <= 4; n++) {
    await waitTurn(page, 0); await sleep(350);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), { think: 500, onTrial: n === 4 ? async () => { await sleep(900); await shot('trial'); } : undefined });
    await waitTurn(page, before + 2);
  }
  await sleep(1500); await shot('turn');
  await tapSel(page, '#hint-button'); await sleep(1500); await shot('pouch1');
  console.log('motion', await page.evaluate(() => document.documentElement.dataset.motion), 'theme', await page.evaluate(() => document.documentElement.dataset.theme),
              'layout', await page.evaluate(() => document.querySelector('#app').dataset.layout),
              'scroll', await page.evaluate(() => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight} in ${innerWidth}x${innerHeight}`));
};
