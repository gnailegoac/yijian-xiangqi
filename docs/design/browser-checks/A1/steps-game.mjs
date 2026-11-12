// One whole game played by the scripted child. Configured through A1_* environment variables.
import { sleep, phase, ply, waitFor, tapSel, bubble, chips, start } from './lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from './bot.mjs';

const env = process.env;
export default async ({ page, shot }) => {
  const style = env.A1_STYLE ?? 'strong';
  const max = Number(env.A1_MAX ?? 150);
  const tag = env.A1_TAG ?? 'g';
  const every = Number(env.A1_EVERY ?? 6);
  const bot = createBot({ style, timeMs: Number(env.A1_BOT_MS ?? 250), seed: Number(env.A1_SEED ?? 1) });
  const log = (...a) => console.log(`[${tag}]`, ...a);
  const t0 = Date.now();
  const longTasks = () => page.evaluate(() => (window.__lt ?? []).slice());

  await page.evaluate(() => {
    window.__lt = [];
    try { new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch {}
  });
  await shot(`${tag}-00-start`);
  await start(page);
  await sleep(500); await shot(`${tag}-01-deal`);
  let st = await waitTurn(page, 0);
  await sleep(1200); await shot(`${tag}-02-first-turn`);
  log('first turn', JSON.stringify(await bubble(page)), JSON.stringify(await chips(page)), 'coach', await page.evaluate(() => document.querySelector('#app').dataset.coach),
      'layout', await page.evaluate(() => document.querySelector('#app').dataset.layout));

  let n = 0;
  let lastNote = '';
  for (n = 1; n <= max; n++) {
    st = await waitTurn(page, 0, 40000);
    if (st === 'over') break;
    await sleep(380);                                    // the rival's piece has landed
    const before = await ply(page);
    const move = bot.choose(await readBoard(page));
    if (!move) { log('no legal move'); break; }
    lastNote = move.note;
    const wantShot = n <= 2 || n % every === 0 || move.capture || /mate1\b/.test(move.note);
    const how = n % 3 === 0 ? 'second-tap' : 'button';
    try {
      await playMove(page, move, {
        how, think: style === 'weak' ? 950 : 480,
        onTrial: wantShot ? async () => { await sleep(700); await shot(`${tag}-m${String(n).padStart(3, '0')}-a-trial`); } : undefined,
      });
    } catch (error) {
      log('move failed', JSON.stringify(move), String(error), 'phase', await phase(page), JSON.stringify(await bubble(page)));
      await shot(`${tag}-m${String(n).padStart(3, '0')}-FAILED`);
      throw error;
    }
    if (/mate1\b/.test(move.note) || (await phase(page)) === 'over') {
      for (let k = 0; k < 14; k++) { await sleep(450); await shot(`${tag}-m${String(n).padStart(3, '0')}-end${String(k).padStart(2, '0')}`); }
      break;
    }
    if (wantShot) { await sleep(250); await shot(`${tag}-m${String(n).padStart(3, '0')}-b-commit`); }
    st = await waitTurn(page, before + 2, 40000);
    if (st === 'over') {
      log(`move ${n}: the rival ended the game`);
      for (let k = 0; k < 14; k++) { await sleep(450); await shot(`${tag}-m${String(n).padStart(3, '0')}-end${String(k).padStart(2, '0')}`); }
      break;
    }
    if (wantShot) { await sleep(900); await shot(`${tag}-m${String(n).padStart(3, '0')}-c-rival`); }
    const b = await bubble(page);
    log(`move ${n} ply ${await ply(page)} ${JSON.stringify(move.from)}->${JSON.stringify(move.to)}${move.capture ? ' x' : ''} [${move.note}] bubble=${b ? `${b.state}/${b.source}: ${b.text}` : '-'}`);
  }
  log('moves played', n, 'phase', await phase(page), 'last note', lastNote, 'seconds', Math.round((Date.now() - t0) / 1000));
  if ((await phase(page)) === 'over') {
    await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 25000, 'the game-over card').catch((e) => log(String(e)));
    await sleep(2500); await shot(`${tag}-90-over-card`);
    log('card', await page.evaluate(() => document.querySelector('dialog[data-dialog="over"]')?.innerText.replace(/\s+/g, ' ').slice(0, 400) ?? null));
    if (env.A1_AFTER === 'review') {
      await tapSel(page, 'dialog[data-dialog="over"] [data-choice="review"], dialog[data-dialog="over"] .hud-over__review').catch((e) => log('review button', String(e)));
      await sleep(1200); await shot(`${tag}-91-after-card`);
      log('over chips', JSON.stringify(await chips(page)));
    }
  }
  const lt = await longTasks();
  log('long tasks (start, ms):', lt.length, 'max', lt.reduce((m, e) => Math.max(m, e[1]), 0), JSON.stringify(lt.slice(0, 40)));
  log('saved', await page.evaluate(() => { const g = JSON.parse(localStorage.getItem('yijian.xiangqi.v2.game') ?? 'null'); const p = JSON.parse(localStorage.getItem('yijian.xiangqi.v2.profile') ?? 'null'); return JSON.stringify({ moves: g?.moves.length, counted: g?.counted, result: g?.result, games: p?.games, rank: p?.rank, level: p?.skill?.level, goal: p?.goal }); }));
};
