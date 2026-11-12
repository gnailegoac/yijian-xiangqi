// PF browser proofs. Usage: node pf-browser.mjs <base url> <label: before|after> [scenario ...]
// Scenarios: taps, mate, resign, failed, ghost. Screenshots go to work/PF/shots/<label>-*.png; one line per finding.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { sleep, phase, ply, waitFor, waitPhase, tapSel, tapCell, chips, bubble } from '../A1/lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from '../A1/bot.mjs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const OUT = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad\\work\\PF\\shots';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');

const BASE = process.argv[2];
const LABEL = process.argv[3];
const wanted = process.argv.slice(4);
mkdirSync(OUT, { recursive: true });
const want = (name) => wanted.length === 0 || wanted.includes(name);

const SIZES = { L: [1180, 820], P: [820, 1180], C: [360, 740] };
const KEYS = { game: 'yijian.xiangqi.v2.game' };
const v2 = (over) => ({ schema: 2, id: 'g-pfproof001', humanColor: 'red', moves: [], result: null, startedAt: 1790000000000, endedAt: null, activeMs: 1000,
                        counted: false, drawFrom: 0, seed: 77, skill: null, memory: null, start: null, ...over });
const MATE_FOR_BLACK = ['9888', '2124', '8898', '2464', '9888', '2747', '8898'];

const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const hardLimit = setTimeout(() => { console.log('HARD LIMIT'); process.exit(3); }, 9 * 60 * 1000);

async function open(size, { reduced = false, save = null, init = null } = {}) {
  const [w, h] = SIZES[size];
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'zh-CN',
                                             reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  if (save) await page.addInitScript((g) => { if (!localStorage.getItem('yijian.xiangqi.v2.game')) localStorage.setItem('yijian.xiangqi.v2.game', g); }, JSON.stringify(save));
  if (init) await page.addInitScript(init);
  return { context, page, errors };
}
const go = (page, path) => page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 20000 });
const startCard = (page) => waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice]'), null, 10000, 'start card');
const shot = (page, name) => page.screenshot({ path: `${OUT}\\${LABEL}-${name}.png` });
const selected = (page) => page.evaluate(() => {
  const el = document.querySelector('.piece.is-selected');
  return el ? `${el.dataset.color} ${el.dataset.type} @${el.dataset.row}${el.dataset.col}` : null;
});
const topRound = (page) => page.evaluate(() => (document.querySelector('.hud-round')?.textContent ?? '').replace(/\s+/g, ' ').trim());
const cardStats = (page) => page.evaluate(() => document.querySelector('.hud-over__stats')?.textContent.trim() ?? null);

// ---------------------------------------------------------------------------------------------------------------
// Item 4: taps that fall through the start card
// ---------------------------------------------------------------------------------------------------------------
if (want('taps')) {
  console.log('\n== item 4: quick taps on the start card');
  const rhythms = { 'a 60+120': [60, 120], 'b 150+150': [150, 150], 'c 250+250': [250, 250], 'd 120+380': [120, 380] };
  for (const size of (process.env.PF_SIZES ?? 'L,P,C').split(',')) {
    for (const [mode, save, button] of [['new', null, '.hud-start__go'], ['continue', v2({ moves: ['7774', '0726'] }), '[data-choice="continue"]'], ['fresh', v2({ moves: ['7774', '0726'] }), '[data-choice="new"]']]) {
      for (const reduced of [false, true]) {
        for (const [name, gaps] of Object.entries(rhythms)) {
          if (reduced && name !== 'a 60+120' && name !== 'c 250+250') continue;
          if (process.env.PF_TAPS === 'quick' && (reduced || mode === 'fresh' || (name !== 'a 60+120' && name !== 'c 250+250'))) continue;
          const { context, page, errors } = await open(size, { reduced, save });
          try {
            await go(page, '/index.html?coach=off&seed=5');
            await startCard(page);
            await sleep(reduced ? 200 : 700);
            const box = await page.evaluate((sel) => { const b = document.querySelector(`dialog[data-dialog="start"] ${sel}`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, button);
            await page.touchscreen.tap(box.x, box.y);
            for (const gap of gaps) { await sleep(gap); await page.touchscreen.tap(box.x, box.y); }
            await waitPhase(page, ['childTurn', 'selected', 'tentative'], 15000);
            await sleep(1800);
            const ph = await phase(page);
            const sel = await selected(page);
            const plyNow = await ply(page);
            const under = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); const cell = el?.closest('.board-cell'); return cell ? `${cell.dataset.row}${cell.dataset.col}` : (el?.className || el?.tagName); }, [box.x, box.y]);
            const ok = ph === 'childTurn' && sel === null;
            console.log(`  ${ok ? 'ok  ' : 'FELL'} ${size} ${mode.padEnd(8)} ${reduced ? 'reduced' : 'full   '} taps ${name}: phase ${ph}, selected ${sel}, ply ${plyNow}, under the button: ${under}${errors.length ? ' ERRORS ' + errors.join('|') : ''}`);
            if (name === 'a 60+120' && !reduced && mode === 'new') await shot(page, `taps-${size}-${mode}`);
            if (!ok && name !== 'a 60+120') await shot(page, `taps-${size}-${mode}-${reduced ? 'r' : 'f'}-${name[0]}-FELL`);
            // a tap that is meant: the piece under the button (or the centre pawn) is selected once the guard is over
            if (ok && name === 'a 60+120') {
              await tapCell(page, 6, 4);
              await sleep(300);
              console.log(`       a deliberate tap afterwards: phase ${await phase(page)}, selected ${await selected(page)}`);
            }
          } catch (e) {
            console.log(`  ERROR ${size} ${mode} ${reduced} ${name}: ${String(e).slice(0, 200)}`);
          }
          await context.close();
        }
      }
    }
  }
  // how early a deliberate tap is taken after the choice: taps on the centre pawn every 100 ms from the tap on 开战！
  for (const reduced of [false, true]) {
    const { context, page } = await open('L', { reduced });
    await go(page, '/index.html?coach=off&seed=5');
    await startCard(page);
    await sleep(700);
    const t0 = Date.now();
    await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
    let taken = null;
    for (let i = 0; i < 12 && taken === null; i++) {
      await sleep(i === 0 ? (reduced ? 360 : 560) : 400);                 // gaps above the guard: every tap is a tap of its own
      const cell = await page.evaluate(() => { const el = document.querySelector('.board-cell[data-row="6"][data-col="4"]'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      if (!cell) continue;
      await page.touchscreen.tap(cell.x, cell.y);
      await sleep(20);
      if ((await phase(page)) === 'selected') taken = Date.now() - t0;
    }
    console.log(`  taps on the board every 400 ms from ${reduced ? 360 : 560} ms after the tap on 开战！: the first one that is taken comes after ${taken} ms (${reduced ? 'reduced' : 'full'} motion)`);
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Items 2 and 3: the rival's game-ending move; the round in the top bar
// ---------------------------------------------------------------------------------------------------------------
if (want('mate')) {
  console.log('\n== items 2 and 3: he mates (saved game one move before his mate)');
  for (const seed of [1, 2, 3]) {
    const { context, page, errors } = await open('L', { save: v2({ moves: MATE_FOR_BLACK }) });
    try {
      await go(page, `/index.html?coach=off&seed=${seed}`);
      await startCard(page);
      await sleep(600);
      await page.evaluate(() => {
        window.__moods = [];
        const note = () => { const m = document.querySelector('.rival')?.getAttribute('data-mood'); const p = document.querySelector('#app').dataset.phase; const last = window.__moods.at(-1); const key = `${p}:${m}`; if (last !== key) window.__moods.push(key); };
        setInterval(note, 30);
      });
      await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
      await waitPhase(page, ['over', 'childTurn'], 20000);
      // the teaching rival may pass the mate up once: the child shuffles the rook again and he gets his second chance
      for (let n = 0; n < 4 && (await phase(page)) !== 'over'; n++) {
        await sleep(900);
        const board = await readBoard(page);
        const from = board[9][8] && board[9][8].type === 'rook' ? { row: 9, col: 8 } : { row: 8, col: 8 };
        const to = from.row === 9 ? { row: 8, col: 8 } : { row: 9, col: 8 };
        await playMove(page, { from, to }, { think: 900 });
        await waitTurn(page, (await ply(page)) + 1, 25000);
      }
      const ph = await phase(page);
      await sleep(600);
      const roundEarly = await topRound(page);
      await shot(page, `mate-s${seed}-a-moved`);
      await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 20000, 'the card').catch(() => {});
      await sleep(1200);
      const moods = await page.evaluate(() => window.__moods);
      console.log(`  seed ${seed}: phase ${ph}, plies ${await ply(page)}; moods ${moods.join(' > ')}`);
      console.log(`           top bar right after his move: 「${roundEarly}」; with the card: 「${await topRound(page)}」; card: 「${await cardStats(page)}」; takeaway: 「${await page.evaluate(() => document.querySelector('.hud-over__takeaway')?.textContent.trim())}」; goal row: 「${await page.evaluate(() => document.querySelector('.hud-over__goal')?.textContent.trim() ?? '')}」; best: 「${await page.evaluate(() => document.querySelector('.hud-over__best')?.textContent.trim() ?? '')}」${errors.length ? ' ERRORS ' + errors.join('|') : ''}`);
      await shot(page, `mate-s${seed}-b-card`);
      if (ph === 'over') { await context.close(); break; }
    } catch (e) { console.log(`  ERROR seed ${seed}: ${String(e).slice(0, 300)}`); await shot(page, `mate-s${seed}-ERROR`).catch(() => {}); }
    await context.close();
  }
}

if (want('doomed')) {
  console.log('== item 2: he mates after a move of the child that was no slip (every move of the child allowed the mate)');
  const DOOMED = ["9070","2191","7778","0122","7161","0001","7838","0161","3848","0848","7077","4828","9484","6162","7773","6292","9778","9282","7383","9181","9674","8183","8485","8292","8575","9293","6050","2868","7585","2777","7452","0726","9897","6878","6454","9394","9777","7877","5444","7797"];
  for (const size of ['L']) {
    const { context, page, errors } = await open(size, { save: v2({ moves: DOOMED }) });
    try {
      await go(page, '/index.html?coach=off&seed=4');
      await startCard(page);
      await sleep(600);
      await page.evaluate(() => {
        window.__moods = [];
        const note = () => { const r = document.querySelector('.rival'); const m = r?.getAttribute('data-mood'); const say = r?.getAttribute('data-say') ?? ''; const p = document.querySelector('#app').dataset.phase; const key = `${p}:${m}${say ? '「' + say + '」' : ''}`; if (window.__moods.at(-1) !== key) window.__moods.push(key); };
        setInterval(note, 25);
      });
      await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
      await waitPhase(page, ['over', 'childTurn'], 20000);
      const bot = createBot({ style: 'strong' });
      for (let n = 0; n < 4 && (await phase(page)) !== 'over'; n++) {
        await sleep(1500);
        const before = await ply(page);
        await playMove(page, bot.choose(await readBoard(page)), { think: 1200 });
        await waitTurn(page, before + 2, 25000);
        if ((await phase(page)) === 'over') { await sleep(250); await shot(page, `doomed-${size}-a-mated`); }
      }
      await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 20000, 'the card').catch(() => {});
      await sleep(1500);
      const moods = await page.evaluate(() => window.__moods);
      console.log(`  ${size}: phase ${await phase(page)}, plies ${await ply(page)}`);
      console.log(`     moods: ${moods.join(' > ')}`);
      console.log(`     top bar 「${await topRound(page)}」; card 「${await cardStats(page)}」; best 「${await page.evaluate(() => document.querySelector('.hud-over__best')?.textContent.trim() ?? '')}」; takeaway 「${await page.evaluate(() => document.querySelector('.hud-over__takeaway')?.textContent.trim())}」; goal row 「${await page.evaluate(() => document.querySelector('.hud-over__goal')?.textContent.trim() ?? '')}」${errors.length ? ' ERRORS ' + errors.join('|') : ''}`);
      await shot(page, `doomed-${size}-b-card`);
    } catch (e) { console.log(`  ERROR ${size}: ${String(e).slice(0, 300)}`); await shot(page, `doomed-${size}-ERROR`).catch(() => {}); }
    await context.close();
  }
}

if (want('resign')) {
  console.log('\n== item 3: a resignation (no move ends the game)');
  for (const size of ['L', 'C']) {
    const { context, page, errors } = await open(size, { reduced: true });
    try {
      await go(page, '/index.html?coach=off&seed=9');
      await startCard(page);
      await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
      await waitTurn(page, 0, 15000);
      await sleep(700);
      const bot = createBot({ style: 'strong' });
      for (let n = 0; n < 2; n++) {
        await playMove(page, bot.choose(await readBoard(page)), {});
        await waitTurn(page, 2 * (n + 1), 25000);
        await sleep(400);
      }
      const during = await topRound(page);
      await tapSel(page, '#menu-button'); await sleep(450);
      await page.evaluate(() => { [...document.querySelectorAll('.hud-menu__item')].find((b) => b.dataset.menu === 'resign')?.click(); });
      await sleep(500);
      await tapSel(page, 'dialog[data-dialog="resign"] [data-choice="go"]');
      await waitPhase(page, 'over', 8000);
      await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 20000, 'the card');
      await sleep(1200);
      console.log(`  ${size}: plies ${await ply(page)}; top bar while playing 「${during}」, after the resignation 「${await topRound(page)}」; card 「${await cardStats(page)}」${errors.length ? ' ERRORS ' + errors.join('|') : ''}`);
      await shot(page, `resign-${size}`);
    } catch (e) { console.log(`  ERROR ${size}: ${String(e).slice(0, 300)}`); await shot(page, `resign-${size}-ERROR`).catch(() => {}); }
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Item 12: trial chips after a failed assessment (the assess job is never answered: it times out)
// ---------------------------------------------------------------------------------------------------------------
if (want('failed')) {
  console.log('\n== item 12: the assess job of a trial fails');
  const swallow = () => {
    const Real = window.Worker;
    window.__swallowAssess = false;
    window.Worker = function (...args) {
      const w = new Real(...args);
      const post = w.postMessage.bind(w);
      w.postMessage = (message, ...rest) => {
        if (window.__swallowAssess && message && message.t === 'job' && message.kind === 'assess') { window.__swallowed = (window.__swallowed ?? 0) + 1; return; }
        return post(message, ...rest);
      };
      return w;
    };
  };
  for (const size of ['L', 'C']) {
    const { context, page, errors } = await open(size, { reduced: true, init: swallow });
    try {
      await go(page, '/index.html?coach=off&seed=9');
      await startCard(page);
      await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
      await waitTurn(page, 0, 15000);
      await sleep(1500);
      await page.evaluate(() => { window.__swallowAssess = true; });
      await tapCell(page, 9, 7);
      await sleep(250);
      await tapCell(page, 7, 6);
      await waitPhase(page, 'tentative', 4000);
      await sleep(300);
      const early = await chips(page);
      await shot(page, `failed-${size}-a-trial`);
      let late = early;
      const t0 = Date.now();
      for (let i = 0; i < 80; i++) { await sleep(250); late = await chips(page); if (late.length === 0) break; }
      const waited = Date.now() - t0;
      console.log(`  ${size}: chips at the trial ${JSON.stringify(early)}; after ${waited} ms ${JSON.stringify(late)}; swallowed assess jobs ${await page.evaluate(() => window.__swallowed ?? 0)}; bubble ${JSON.stringify(await bubble(page))}; phase ${await phase(page)}`);
      await shot(page, `failed-${size}-b-after`);
      if (late.length > 0) {                                   // the chips that stayed: does one of them do anything?
        await tapSel(page, '.chip[data-ask="good"]').catch((e) => console.log('       no chip to tap: ' + String(e).slice(0, 80)));
        await sleep(1500);
        console.log(`       after a tap on 这步好不好？: bubble ${JSON.stringify(await bubble(page))}`);
        await shot(page, `failed-${size}-c-tapped`);
      }
      // the child can still play the move
      await page.evaluate(() => { window.__swallowAssess = false; });
      await tapSel(page, '#confirm-button');
      await waitTurn(page, 2, 25000);
      console.log(`       the move can still be played: ply ${await ply(page)}, phase ${await phase(page)}${errors.length ? ' ERRORS ' + errors.join('|') : ''}`);
    } catch (e) { console.log(`  ERROR ${size}: ${String(e).slice(0, 300)}`); await shot(page, `failed-${size}-ERROR`).catch(() => {}); }
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Item 11: the step badge of ghost play
// ---------------------------------------------------------------------------------------------------------------
if (want('ghost')) {
  console.log('\n== item 11: the step badge of ghost play');
  for (const size of ['C', 'L', 'P']) {
    for (const theme of size === 'C' ? ['chibi', 'longzhong', 'shachang'] : ['chibi']) {
      const { context, page, errors } = await open(size, { reduced: false });
      try {
        await go(page, `/index.html?coach=off&seed=9&theme=${theme}`);
        await startCard(page);
        await sleep(500);
        await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
        await waitTurn(page, 0, 15000);
        await sleep(2500);
        // 炮二平五, then the trial 炮五进四 (takes the pawn): 对方会怎么应？ ghost-plays the answer
        await playMove(page, { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }, {});
        await waitTurn(page, 2, 25000);
        await sleep(1200);
        const board = await readBoard(page);
        const target = board[3][4] && board[3][4].color === 'black' ? { row: 3, col: 4 } : null;
        await tapCell(page, 7, 4);
        await sleep(250);
        if (target) await tapCell(page, target.row, target.col); else await tapCell(page, 6, 4);
        await waitPhase(page, 'tentative', 4000);
        await sleep(2600);
        const asked = await page.evaluate(() => { const c = document.querySelector('.chip[data-ask="reply"]') ?? document.querySelector('.chip[data-ask="show"]'); return c ? c.dataset.ask : null; });
        await tapSel(page, `.chip[data-ask="${asked}"]`);
        const frames = [];
        for (let i = 0; i < 9; i++) {
          await sleep(i === 0 ? 150 : 300);
          const info = await page.evaluate(() => {
            const g = [...document.querySelectorAll('.bv-counter, .piece__tag--step')].find((el) => el.getBoundingClientRect().width > 0);
            if (!g) return null;
            const b = g.getBoundingClientRect();
            const host = document.querySelector('#board').getBoundingClientRect();
            const labels = [...document.querySelectorAll('.bv-label')].map((t) => t.getBoundingClientRect());
            const overlapsLabel = labels.some((l) => !(l.right <= b.left || l.left >= b.right || l.bottom <= b.top || l.top >= b.bottom));
            const pieces = [...document.querySelectorAll('.piece')].filter((p) => !p.classList.contains('is-preview')).map((p) => p.getBoundingClientRect());
            const overPiece = pieces.some((l) => !(l.right <= b.left + 1 || l.left >= b.right - 1 || l.bottom <= b.top + 1 || l.top >= b.bottom - 1));
            const text = g.textContent.trim();
            const font = parseFloat(getComputedStyle(g.querySelector('text') ?? g).fontSize) * (g.querySelector('text') ? b.height / 36 : 1);
            return { text, x: Math.round(b.left - host.left), y: Math.round(b.top - host.top), w: Math.round(b.width), h: Math.round(b.height), overlapsLabel, overPiece, opacity: getComputedStyle(g).opacity };
          });
          frames.push(info);
          if (i === 1 || i === 3) await shot(page, `ghost-${size}-${theme}-${i}`);
        }
        console.log(`  ${size} ${theme}: ${frames.map((f) => (f ? `${f.text}@${f.x},${f.y} ${f.w}x${f.h}${f.overlapsLabel ? ' OVER-LABEL-BOX' : ''}${f.overPiece ? ' over-piece-box' : ''}` : '-')).join(' | ')}${errors.length ? ' ERRORS ' + errors.join('|') : ''}`);
      } catch (e) { console.log(`  ERROR ${size} ${theme}: ${String(e).slice(0, 300)}`); await shot(page, `ghost-${size}-${theme}-ERROR`).catch(() => {}); }
      await context.close();
    }
  }
}

clearTimeout(hardLimit);
await browser.close();
