// Game C: undo, retract, the three pouches, questions, a reload in the middle, then played to the end.
import { sleep, phase, ply, waitFor, waitPhase, tapSel, tapCell, bubble, chips, pieces, start } from './lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from './bot.mjs';

const env = process.env;
export default async ({ page, shot }) => {
  const tag = env.A1_TAG ?? 'C';
  const max = Number(env.A1_MAX ?? 150);
  const bot = createBot({ style: 'strong', timeMs: Number(env.A1_BOT_MS ?? 250) });
  const log = (...a) => console.log(`[${tag}]`, ...a);
  const problems = [];
  const check = (ok, what) => { if (!ok) { problems.push(what); log('PROBLEM:', what); } else log('ok:', what); };
  const stage = async (name, fn) => {
    try { await fn(); } catch (e) { problems.push(`${name}: ${e}`); log('STAGE FAILED', name, String(e)); await shot(`${tag}-FAILED-${name}`); }
  };
  const visible = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((c) => c.getBoundingClientRect().width > 0), sel);
  const pad = (n) => String(n).padStart(3, '0');
  const turnMove = async (n, opts) => {
    const st = await waitTurn(page, 0, 40000);
    if (st === 'over') return 'over';
    await sleep(380);
    const before = await ply(page);
    const move = bot.choose(await readBoard(page));
    await playMove(page, move, { how: n % 2 ? 'button' : 'second-tap', think: 480, ...opts });
    if ((await phase(page)) === 'over') return 'over';
    const after = await waitTurn(page, before + 2, 40000);
    return after === 'over' ? 'over' : move;
  };

  await page.evaluate(() => {
    window.__lt = [];
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] });
    } catch {}
  });
  await shot(`${tag}-00-start`);
  await start(page);
  await waitTurn(page, 0);
  await sleep(1300); await shot(`${tag}-01-first-turn`);
  log('layout', await page.evaluate(() => document.querySelector('#app').dataset.layout), 'coach', await page.evaluate(() => document.querySelector('#app').dataset.coach));

  await stage('move1', async () => { await turnMove(1); await sleep(1000); await shot(`${tag}-02-after-move1`); });

  // ---- retract -----------------------------------------------------------------------------------------------------
  await stage('retract', async () => {
    await waitTurn(page, 2); await sleep(400);
    const before = await pieces(page);
    await tapCell(page, 9, 1);                             // the left horse
    await waitPhase(page, 'selected', 4000); await sleep(250); await shot(`${tag}-03-selected`);
    await tapCell(page, 7, 2);
    await waitPhase(page, 'tentative', 4000); await sleep(900); await shot(`${tag}-04-trial`);
    log('trial bubble', JSON.stringify(await bubble(page)), 'chips', JSON.stringify(await chips(page)));
    await tapSel(page, '#retract-button');
    await waitPhase(page, 'selected', 4000); await sleep(500); await shot(`${tag}-05-retracted`);
    check((await pieces(page)) === before, 'retract puts the piece back');
    check((await ply(page)) === 2, 'retract keeps the ply');
    await tapCell(page, 9, 1);                             // deselect
    await sleep(300);
    log('after deselect phase', await phase(page));
  });

  // ---- a question without a trial ------------------------------------------------------------------------------------
  await stage('ask', async () => {
    if ((await phase(page)) === 'selected') { await tapCell(page, 9, 1); await sleep(200); }
    log('turn chips', JSON.stringify(await chips(page)));
    await tapSel(page, '.chip[data-ask="score"]');
    await sleep(1500); await shot(`${tag}-06-ask-score`);
    const b = await bubble(page);
    log('answer to score', JSON.stringify(b));
    check(!!b && b.text.length > 0, 'a chip question gets an answer');
  });

  // ---- the three pouches -----------------------------------------------------------------------------------------------
  await stage('pouches', async () => {
    for (let level = 1; level <= 3; level++) {
      await tapSel(page, '#hint-button');
      await waitFor(page, (l) => document.querySelector('#hint-button')?.dataset.level === String(l), level, 5000, `hint level ${level}`);
      await sleep(350); await shot(`${tag}-07-pouch${level}-a`);
      await sleep(1400); await shot(`${tag}-07-pouch${level}-b`);
      log(`pouch ${level}`, JSON.stringify(await bubble(page)), 'chips', JSON.stringify(await chips(page)),
          'arrows', await page.evaluate(() => [...document.querySelectorAll('.arrow')].map((a) => `${a.dataset.style}:${a.dataset.from}-${a.dataset.to}`).join(',')));
      await sleep(500);
    }
    check(await visible('.chip[data-action="pouch"]'), 'the chip 试试这步 is offered after pouch 3');
    await tapSel(page, '.chip[data-action="pouch"]');
    await waitPhase(page, 'tentative', 4000); await sleep(900); await shot(`${tag}-08-pouch-trial`);
    log('pouch trial', JSON.stringify(await bubble(page)), 'chips', JSON.stringify(await chips(page)));
    if (await visible('.chip[data-ask="reply"]')) {       // a question about the trial: what will the rival answer?
      await tapSel(page, '.chip[data-ask="reply"]');
      await sleep(500); await shot(`${tag}-09-ask-reply-a`);
      await sleep(1600); await shot(`${tag}-09-ask-reply-b`);
      log('answer to reply', JSON.stringify(await bubble(page)), 'chips', JSON.stringify(await chips(page)));
    } else {
      log('no reply chip');
    }
    const before = await ply(page);
    await tapSel(page, '#confirm-button');
    await sleep(300);
    if ((await phase(page)) === 'tentative') { await sleep(600); await tapSel(page, '#confirm-button'); }
    await waitTurn(page, before + 2, 40000);
    await sleep(900); await shot(`${tag}-10-after-pouch-move`);
  });

  // ---- one more pair, then undo ------------------------------------------------------------------------------------------
  await stage('undo', async () => {
    await waitTurn(page, 0); await sleep(400);
    const snapshot = await pieces(page);
    const at = await ply(page);
    await turnMove(3);
    await sleep(600);
    check((await ply(page)) === at + 2, 'a move pair adds two plies');
    await shot(`${tag}-11-before-undo`);
    await tapSel(page, '#undo-button');
    await waitFor(page, (n) => Number(document.querySelector('#app').dataset.ply) === n && document.querySelector('#app').dataset.phase === 'childTurn', at, 8000, 'undo');
    await sleep(1200); await shot(`${tag}-12-after-undo`);
    check((await pieces(page)) === snapshot, 'undo restores the position before the pair');
    log('after undo', JSON.stringify(await bubble(page)), 'chips', JSON.stringify(await chips(page)));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yijian.xiangqi.v2.game')).moves.length);
    check(saved === at, `the save has ${at} moves after undo (has ${saved})`);
  });

  // ---- three more moves, then a reload during a trial ------------------------------------------------------------------------
  await stage('reload', async () => {
    for (let n = 4; n <= 6; n++) await turnMove(n);
    await waitTurn(page, 0); await sleep(500);
    const snapshot = await pieces(page);
    const at = await ply(page);
    const savedBefore = await page.evaluate(() => localStorage.getItem('yijian.xiangqi.v2.game'));
    const move = bot.choose(await readBoard(page));
    await tapCell(page, move.from.row, move.from.col); await waitPhase(page, 'selected', 4000);
    await tapCell(page, move.to.row, move.to.col); await waitPhase(page, 'tentative', 4000);
    await sleep(500); await shot(`${tag}-13-trial-before-reload`);
    await page.reload({ waitUntil: 'load' });
    await sleep(900); await shot(`${tag}-14-reloaded-start-card`);
    check(await page.evaluate(() => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]')), 'the start card offers 继续上一局');
    await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
    await waitTurn(page, 0, 15000);
    await sleep(1500); await shot(`${tag}-15-restored`);
    check((await ply(page)) === at, `the restored game stands at ply ${at} (is ${await ply(page)})`);
    check((await pieces(page)) === snapshot, 'the restored position is the committed position before the reload');
    check((await phase(page)) === 'childTurn', 'the trial is gone after the reload');
    const savedAfter = await page.evaluate(() => localStorage.getItem('yijian.xiangqi.v2.game'));
    const a = JSON.parse(savedBefore), b = JSON.parse(savedAfter);
    check(JSON.stringify(a.moves) === JSON.stringify(b.moves) && a.id === b.id && a.seed === b.seed, 'the save keeps id, seed and moves across the reload');
    log('restored bubble', JSON.stringify(await bubble(page)), 'chips', JSON.stringify(await chips(page)), 'hint level',
        await page.evaluate(() => document.querySelector('#hint-button')?.dataset.level));
  });

  // ---- play to the end -----------------------------------------------------------------------------------------------------
  let n = 7;
  await stage('finish', async () => {
    for (; n <= max; n++) {
      const r = await turnMove(n, n % 10 === 0 ? { onTrial: async () => { await sleep(600); await shot(`${tag}-m${pad(n)}-trial`); } } : undefined);
      if (r === 'over') break;
      if (n % 5 === 0) log(`move ${n} ply ${await ply(page)} [${r.note}] ${JSON.stringify(await bubble(page))}`);
    }
    log('moves', n, 'phase', await phase(page));
    if ((await phase(page)) === 'over') {
      for (let k = 0; k < 12; k++) { await sleep(500); await shot(`${tag}-end${String(k).padStart(2, '0')}`); }
      await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 25000, 'the game-over card');
      await sleep(2500); await shot(`${tag}-90-over-card`);
      log('card', await page.evaluate(() => document.querySelector('dialog[data-dialog="over"]')?.innerText.replace(/\s+/g, ' ').slice(0, 400) ?? null));
      log('saved', await page.evaluate(() => {
        const g = JSON.parse(localStorage.getItem('yijian.xiangqi.v2.game') ?? 'null');
        const p = JSON.parse(localStorage.getItem('yijian.xiangqi.v2.profile') ?? 'null');
        return JSON.stringify({ moves: g?.moves.length, counted: g?.counted, games: p?.games, rank: p?.rank, level: p?.skill?.level, goal: p?.goal });
      }));
      await tapSel(page, 'dialog[data-dialog="over"] [data-choice="again"]');
      await waitFor(page, () => Number(document.querySelector('#app').dataset.ply) === 0 && document.querySelector('#app').dataset.phase === 'childTurn', null, 15000, 'a new game');
      await sleep(1800); await shot(`${tag}-95-new-game`);
      check((await pieces(page)).split(' ').length === 32, 'a new game has 32 pieces');
      log('new game bubble', JSON.stringify(await bubble(page)));
    }
  });
  log('PROBLEMS', problems.length, JSON.stringify(problems));
  log('long tasks', await page.evaluate(() => JSON.stringify(window.__lt ?? [])));
};
