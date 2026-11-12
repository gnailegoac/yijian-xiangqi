import { sleep, phase, ply, waitPhase, tapCell, pieces, pieceEls, start, tapSel } from './lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from './bot.mjs';
export default async ({ page, shot }) => {
  const bot = createBot({ style: 'strong' });
  await start(page);
  for (let n = 1; n <= 5; n++) {
    await waitTurn(page, 0); await sleep(380);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), {});
    await waitTurn(page, before + 2);
  }
  await sleep(600);
  const a = await pieces(page), ae = await pieceEls(page), at = await ply(page);
  const saved = await page.evaluate(() => localStorage.getItem('yijian.xiangqi.v2.game'));
  const move = bot.choose(await readBoard(page));
  await tapCell(page, move.from.row, move.from.col); await waitPhase(page, 'selected', 4000);
  await tapCell(page, move.to.row, move.to.col); await waitPhase(page, 'tentative', 4000);
  await sleep(400);
  await page.reload({ waitUntil: 'load' });
  await sleep(700);
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitTurn(page, 0); await sleep(1500);
  const b = await pieces(page), be = await pieceEls(page);
  console.log('ply', at, await ply(page), 'cells equal', a === b, 'els equal', ae === be);
  const sa = new Set(a.split(' ')), sb = new Set(b.split(' '));
  console.log('only before:', [...sa].filter((x) => !sb.has(x)).join(' '), '| only after:', [...sb].filter((x) => !sa.has(x)).join(' '));
  const ea = new Set(ae.split(' ')), eb = new Set(be.split(' '));
  console.log('els only before:', [...ea].filter((x) => !eb.has(x)).join(' '), '| els only after:', [...eb].filter((x) => !ea.has(x)).join(' '));
  console.log('moves', JSON.parse(saved).moves.join(','));
  await shot('restored');
};
