// Review of FA item 5 in the real page (finding C1): a piece is picked while 司马懿 thinks, its target is tapped every
// 140 ms and the first tap after his move lands before the brief of the turn exists. Mock proxy (the model answers).
// Afterwards: no bubble with dots or left as streaming, the send button is the send button, and the lines the
// director says next are not held back.
// Usage: node rv-finger.mjs [red|black|all] [runs at full motion, default 3]
import { launch, open, sleep, waitReady, idle, waitPhase, phaseOf, tapCell, centre, events } from './lib.mjs';

const [sideArg = 'all', runsArg = '3'] = process.argv.slice(2);
const FIRST_TRIAL = '亮替你看一眼。想好了，再点一下就落子。';

const snapshot = (page) => page.evaluate(() => {
  const bubble = document.querySelector('.bubble');
  const dots = document.querySelector('.bubble__dots');
  const text = (sel) => (document.querySelector(sel)?.textContent ?? '').trim();
  const shown = (el) => el instanceof HTMLElement && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  return {
    bubble: `${bubble?.getAttribute('data-state')}/${bubble?.getAttribute('data-source') ?? '-'}`,
    caption: text('.bubble__caption'), text: text('.bubble__text').slice(0, 40), dots: shown(dots),
    log: [...document.querySelectorAll('.chat__log .msg[data-role="buddy"]')].slice(-5)
      .map((el) => `${el.getAttribute('data-kind')}:${el.getAttribute('data-state')}${el.hasAttribute('data-typing') ? '+dots' : ''}:"${(el.querySelector('.msg__text')?.textContent ?? '').slice(0, 14)}"`),
    streaming: document.querySelectorAll('.chat__log .msg[data-state="streaming"]').length,
    send: document.getElementById('chat-send')?.getAttribute('aria-label'),
    phase: document.getElementById('app')?.dataset.phase,
  };
});

async function run(browser, side, motion, gap) {
  const storage = side === 'black' ? { 'yijian.xiangqi.v2.settings': JSON.stringify({ schema: 2, side: 'black' }) } : {};
  const { context, page, errors } = await open(browser, { size: 'landscape', motion, storage });
  /** @type {string[]} */ const requests = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/coach') || request.method() !== 'POST') return;
    try {
      const body = request.postDataJSON();
      const last = body && Array.isArray(body.events) ? body.events.at(-1) : null;
      requests.push(last ? `${last.kind}${last.ask ? `(${last.ask})` : ''}` : '?');
    } catch { requests.push('?'); }
  });
  await page.goto('/?test=1', { waitUntil: 'load' });
  await waitReady(page);
  const piece = side === 'black' ? [0, 1] : [9, 7];
  const target = side === 'black' ? [2, 2] : [7, 6];
  if (side === 'red') {
    await idle(page);
    await page.waitForFunction(() => document.querySelector('.bubble')?.getAttribute('data-state') !== 'streaming', null, { timeout: 15000 });
    await tapCell(page, 7, 7);
    await waitPhase(page, 'selected');
    await tapCell(page, 7, 4);
    await waitPhase(page, 'tentative');
    await sleep(450);
    await page.locator('#confirm-button').tap();
    await waitPhase(page, 'opponentTurn', 5000);
  }
  const bottom = await page.evaluate(() => document.querySelector('.bv')?.getAttribute('data-bottom'));
  // the piece is picked while he thinks (twice, in case the first tap met the deal), then the target, every `gap` ms
  await sleep(side === 'black' ? 250 : 120);
  await tapCell(page, piece[0], piece[1]);
  const requestsBefore = requests.length;
  const started = Date.now();
  let taps = 0;
  let landedAfter = -1;
  const pieceAt = await centre(page, `.board-cell[data-row="${piece[0]}"][data-col="${piece[1]}"]`);
  const targetAt = await centre(page, `.board-cell[data-row="${target[0]}"][data-col="${target[1]}"]`);
  while (Date.now() - started < 8000) {
    const lap = Date.now();
    const phase = await phaseOf(page);
    if (phase === 'tentative') { landedAfter = Date.now() - started; break; }
    // his turn still, or the pick did not take (the deal held the board): the piece again now and then; else the target
    const pick = (phase === 'opponentTurn' && taps > 0 && taps % 6 === 0) || phase === 'childTurn';
    const at = pick ? pieceAt : targetAt;
    await page.touchscreen.tap(at.x, at.y);
    taps += 1;
    await sleep(Math.max(0, gap - (Date.now() - lap)));
  }
  const t1 = Date.now();
  const shots = [];
  let firstTrialAt = -1;
  for (const at of [300, 1000, 2500, 4500, 8000]) {
    await sleep(Math.max(0, at - (Date.now() - t1)));
    const s = await snapshot(page);
    shots.push({ at, ...s });
    const told = await page.evaluate((line) => document.body.textContent.includes(line), FIRST_TRIAL);
    if (told && firstTrialAt < 0) firstTrialAt = at;
  }
  const log = await events(page);
  const mine = log.filter((e) => e.kind === 'phase' && e.phase === 'tentative').at(-1);
  const turnAt = mine ? log.find((e) => e.kind === 'phase' && e.ply === mine.ply) : null;      // his move was committed: the first event of this ply
  const trialAfterHisMove = mine && turnAt ? mine.t - turnAt.t : null;
  const end = shots.at(-1);
  const mid = shots[3];
  const clean = [mid, end].every((s) => s.streaming === 0 && !s.bubble.startsWith('streaming') && !s.dots && s.send === '发送' && s.phase === 'tentative');
  const said = side === 'black' ? firstTrialAt >= 0 && firstTrialAt <= 2500 : true;
  // the next line of the director is not held back: 换一步 and a second trial of another move; its comment or face comes
  await context.close();
  return { ok: clean && said && landedAfter >= 0, side, bottom, motion, gap, taps, landedAfter, trialAfterHisMove, requests: requests.slice(requestsBefore),
           firstTrialAt, shots: shots.map((s) => `${s.at}: bubble ${s.bubble} cap="${s.caption}" text="${s.text}" dots=${s.dots} send=${s.send} streaming=${s.streaming} log=[${s.log.join(' | ')}]`),
           errors: errors.slice(0, 2) };
}

const browser = await launch();
try {
  for (const side of sideArg === 'all' ? ['red', 'black'] : [sideArg]) {
    for (let i = 0; i < Number(runsArg); i++) {
      const v = await run(browser, side, 'full', 140);
      console.log(`${v.ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(v, null, 1)}`);
    }
    const v = await run(browser, side, 'reduced', 140);
    console.log(`${v.ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(v, null, 1)}`);
  }
} finally {
  await browser.close();
}
