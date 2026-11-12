// FA scratch: browser checks for items 2, 3, 9, 10, 11 against the server on 127.0.0.1:5173 (headless Chrome through the
// repo's Playwright; finger taps). Usage: node browser.mjs <before|after> <item2|item3|item9|item10|item11> [filter]
// "before" = the server serves snapshots/08-pre-closing-fixes, "after" = the repository.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(`${REPO}/package.json`);
const { chromium } = require('@playwright/test');
const BASE = 'http://127.0.0.1:5173';
const [label = 'after', which = 'item2', filter = ''] = process.argv.slice(2);
const OUT = new URL(`./shots/${label}/`, import.meta.url);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hardLimit = setTimeout(() => { console.log('TIME LIMIT'); process.exit(3); }, 540000);
const KEYS = { game: 'yijian.xiangqi.v2.game', migrated: 'yijian.xiangqi.v2.migrated', profile: 'yijian.xiangqi.v2.profile' };
const LAYOUTS = { landscape: [1180, 820], portrait: [820, 1180], phone: [360, 740] };
const fixture = (name) => readFileSync(`${REPO}/tests/fixtures/saves/${name}`, 'utf8');
const shot = (page, name) => page.screenshot({ path: new URL(`${name}.png`, OUT).pathname.slice(1) });

const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });

/** Every pointerdown and click as the page sees it: time and the element hit. */
function record() {
  window.__ev = [];
  const name = (el) => {
    if (!el || !el.closest) return '?';
    const b = el.closest('button');
    const own = el.id ? `#${el.id}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '');
    const where = el.closest('#actions') ? ' in #actions' : el.closest('#overlays') ? ' in #overlays' : el.closest('#coach') ? ' in #coach' : el.closest('#board') ? ' in #board' : '';
    return own + (b ? ` [button ${b.id ? `#${b.id}` : ''} "${b.textContent.trim().slice(0, 12)}"]` : '') + where;
  };
  for (const type of ['pointerdown', 'click']) window.addEventListener(type, (e) => window.__ev.push({ type, t: Math.round(performance.now()), hit: name(e.target) }), true);
  window.__marks = {};
  const watch = () => {
    if (!window.__marks.card && document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]')) window.__marks.card = Math.round(performance.now());
    if (!window.__marks.over && document.querySelector('#app[data-phase="over"]')) window.__marks.over = Math.round(performance.now());
  };
  new MutationObserver(watch).observe(document, { subtree: true, childList: true, attributes: true });
}

async function open(layout, reduced, storage, query = '') {
  const [width, height] = LAYOUTS[layout];
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN',
                                             reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 160)}`));
  await page.addInitScript((content) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(content)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, storage);
  await page.addInitScript(record);
  await page.goto(`${BASE}/?test=1${query}`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
  await page.evaluate(() => window.__ui.idle());
  return { context, page, errors };
}
const centre = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`not visible: ${sel}`);
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
};
const cell = (page, row, col) => centre(page, `.board-cell[data-row="${row}"][data-col="${col}"]`);
const state = (page) => page.evaluate(([kg, kp]) => {
  const g = JSON.parse(localStorage.getItem(kg) ?? 'null');
  const p = JSON.parse(localStorage.getItem(kp) ?? 'null');
  const app = document.querySelector('#app');
  return { id: g ? g.id : null, moves: g ? g.moves.length : null, counted: g ? g.counted : null, phase: app.dataset.phase, ply: app.dataset.ply,
           card: !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]'), games: p ? p.games : null,
           said: [...document.querySelectorAll('.msg[data-role="me"]')].map((m) => m.textContent.trim()), ev: window.__ev, marks: window.__marks };
}, [KEYS.game, KEYS.profile]);
const games = (g) => (g ? `played ${g.played} won ${g.won} lost ${g.lost}` : 'no profile');

// ---------------------------------------------------------------------------------------------------------------------
// item 2: the child mates, then taps every 150 ms for five seconds where 确定落子 was (or opens the menu: 新对局)
// ---------------------------------------------------------------------------------------------------------------------
if (which === 'item2') {
  const mate = fixture('v2-one-before-mate.json');
  const savedId = JSON.parse(mate).id;
  for (const layout of ['landscape', 'portrait', 'phone']) {
    for (const reduced of [false, true]) {
      for (const way of ['bar', 'menu']) {
        const tag = `${layout}-${reduced ? 'reduced' : 'full'}-${way}`;
        if (filter && !tag.includes(filter)) continue;
        const { context, page, errors } = await open(layout, reduced, { [KEYS.game]: mate, [KEYS.migrated]: '1' }, '&coach=off');
        const a = await cell(page, 5, 1); await page.touchscreen.tap(a.x, a.y); await sleep(300);
        const b = await cell(page, 5, 4); await page.touchscreen.tap(b.x, b.y); await sleep(900);
        const conf = await centre(page, '#confirm-button');
        await page.evaluate(() => { window.__ev.length = 0; });
        const t0 = Date.now();
        await page.touchscreen.tap(conf.x, conf.y);
        let shotDone = false;
        let menuStep = 0;
        while (Date.now() - t0 < 5000) {
          await sleep(150);
          if (way === 'menu' && Date.now() - t0 > 500) {
            // 新对局 of the menu: open the menu, tap its first item, again and again
            try {
              if (menuStep % 2 === 0) { const m = await centre(page, '#menu-button'); await page.touchscreen.tap(m.x, m.y); }
              else { const it = await centre(page, '.hud-menu__item[data-menu="new-game"]'); await page.touchscreen.tap(it.x, it.y); }
            } catch { /* the control is not there right now */ }
            menuStep += 1;
          } else {
            await page.touchscreen.tap(conf.x, conf.y);
          }
          if (!shotDone && Date.now() - t0 > 1500) { shotDone = true; await shot(page, `item2-${tag}-during`); }
        }
        // the card (at full motion it comes after the celebration)
        await page.waitForSelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]', { timeout: 15000 }).catch(() => null);
        await sleep(700);
        const r = await state(page);
        await shot(page, `item2-${tag}-after-taps`);
        const downs = r.ev.filter((e) => e.type === 'pointerdown');
        const first = downs[0] ? downs[0].t : 0;
        const clicks = r.ev.filter((e) => e.type === 'click').map((e) => `+${e.t - first} ${e.hit}`);
        console.log(`ITEM2 ${label} ${tag}: ${downs.length} taps in ${downs.length ? downs[downs.length - 1].t - first : 0} ms; over at +${r.marks.over - first} ms, card at ${r.marks.card ? `+${r.marks.card - first} ms` : 'NEVER'}`);
        console.log(`   clicks that landed on a control: ${clicks.filter((c) => /button/.test(c)).join(' | ') || '(none)'}`);
        console.log(`   => phase ${r.phase} ply ${r.ply}, card up ${r.card}, saved game ${r.id === savedId ? `the won one (counted ${r.counted})` : `A NEW ONE (${r.moves} moves)`}, profile: ${games(r.games)}`);
        // one tap on the card's 再来一局
        let after = 'no card to tap';
        if (r.card) {
          const again = await centre(page, 'dialog[data-dialog="over"] [data-choice="again"]');
          await page.touchscreen.tap(again.x, again.y);
          await sleep(1500);
          const n = await state(page);
          after = `phase ${n.phase} ply ${n.ply}, card up ${n.card}, saved game ${n.id === savedId ? 'STILL THE WON ONE' : `a new one (${n.moves} moves)`}, profile: ${games(n.games)}`;
        }
        console.log(`   one tap on the card's 再来一局 => ${after}; console errors ${errors.length}${errors.length ? `: ${errors[0]}` : ''}`);
        await context.close();
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// item 3: double and triple taps on the two buttons of the game-over card (a finished, counted game is continued)
// ---------------------------------------------------------------------------------------------------------------------
if (which === 'item3') {
  const mid = JSON.parse(fixture('v2-midgame.json'));
  const resigned = JSON.stringify({ ...mid, result: { winner: 'black', reason: 'resign' }, counted: true, endedAt: mid.startedAt + 60000 });
  for (const layout of ['portrait', 'landscape', 'phone']) {
    for (const reduced of [false, true]) {
      for (const [btn, gaps] of [['review', [200]], ['review', [150, 250]], ['review', [400]], ['again', [200]], ['again', [150, 250]]]) {
        const tag = `${layout}-${reduced ? 'reduced' : 'full'}-${btn}x${gaps.length + 1}-${gaps.join('+')}`;
        if (filter && !tag.includes(filter)) continue;
        const { context, page, errors } = await open(layout, reduced, { [KEYS.game]: resigned, [KEYS.migrated]: '1' }, '&coach=off');
        await page.waitForSelector('dialog[data-dialog="over"] [data-choice="again"]', { timeout: 10000 });
        await sleep(1500);
        if (btn === 'review' && gaps.length === 1 && gaps[0] === 200) await shot(page, `item3-${layout}-${reduced ? 'reduced' : 'full'}-card`);
        const pt = await centre(page, `dialog[data-dialog="over"] [data-choice="${btn}"]`);
        const idBefore = (await state(page)).id;
        await page.evaluate(() => { window.__ev.length = 0; });
        await page.touchscreen.tap(pt.x, pt.y);
        for (const g of gaps) { await sleep(g); await page.touchscreen.tap(pt.x, pt.y); }
        await sleep(1700);
        const r = await state(page);
        const downs = r.ev.filter((e) => e.type === 'pointerdown');
        const clicks = r.ev.filter((e) => e.type === 'click').map((e) => e.hit);
        console.log(`ITEM3 ${label} ${tag}: gaps seen ${downs.slice(1).map((d, i) => d.t - downs[i].t).join('/')} ms; clicks: ${clicks.join(' | ')}`);
        console.log(`   => phase ${r.phase} ply ${r.ply}, card up ${r.card}, saved game ${r.id === idBefore ? 'the same finished one' : `A NEW ONE (${r.moves} moves)`}, child lines ${JSON.stringify(r.said)}; console errors ${errors.length}`);
        await context.close();
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// items 9 and 10: the mock proxy slowed to 250 ms per four characters
// ---------------------------------------------------------------------------------------------------------------------
const lines = (page) => page.evaluate(() => ({
  bubble: (() => { const b = document.querySelector('.bubble'); if (!b) return null; const t = b.querySelector('.bubble__text'); return { state: b.dataset.state, text: t ? t.textContent : '' }; })(),
  log: [...document.querySelectorAll('.chat__log .msg[data-role="buddy"]')].map((m) => `${m.dataset.kind}:${m.dataset.state}:"${m.querySelector('.msg__text').textContent}"`),
  links: [...document.querySelectorAll('.chat__log .move-link')].map((l) => `${l.textContent}${l.disabled ? '(retired)' : '(live)'}`),
  arrows: [...document.querySelectorAll('#board .arrow')].map((a) => `${a.dataset.from}->${a.dataset.to} ${a.dataset.style}`),
  phase: document.querySelector('#app').dataset.phase, ply: document.querySelector('#app').dataset.ply,
}));

async function legalTrial(page) {
  // some own piece that shows a target: pawns first
  const mine = await page.evaluate(() => {
    const bottom = document.querySelector('#board').dataset.bottom;
    const list = [];
    for (const c of document.querySelectorAll('.board-cell[data-piece]')) {
      if (!c.dataset.piece) continue;
      const p = document.querySelector(`.piece[data-id="${c.dataset.piece}"]`);
      if (p && p.dataset.color === bottom) list.push([Number(c.dataset.row), Number(c.dataset.col), p.dataset.type]);
    }
    return list.sort((a, b) => Number(b[2] === 'pawn') - Number(a[2] === 'pawn'));
  });
  for (const [row, col] of mine) {
    const a = await cell(page, row, col); await page.touchscreen.tap(a.x, a.y);
    await sleep(120);
    const target = await page.evaluate(() => { const t = document.querySelector('.board-cell.is-legal, .board-cell.is-capture'); return t ? [Number(t.dataset.row), Number(t.dataset.col)] : null; });
    if (!target) continue;
    const b = await cell(page, target[0], target[1]); await page.touchscreen.tap(b.x, b.y);
    return { from: [row, col], to: target };
  }
  throw new Error('no legal move');
}

if (which === 'item9' || which === 'item10') {
  for (const layout of ['landscape', 'portrait', 'phone']) {
    if (filter && !layout.includes(filter)) continue;
    const { context, page, errors } = await open(layout, true, {}, '');
    await page.route('**/api/coach', (route) => route.continue({ url: `${route.request().url()}?chunkMs=${which === 'item9' ? 250 : 15}` }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]');
    await page.waitForSelector('.bubble[data-state="done"]', { timeout: 20000 });
    // round 1: 炮二平五, he answers; the read of his move is being typed
    let a = await cell(page, 7, 7); await page.touchscreen.tap(a.x, a.y); await sleep(250);
    let b = await cell(page, 7, 4); await page.touchscreen.tap(b.x, b.y); await sleep(500);
    await page.touchscreen.tap(b.x, b.y);
    await page.waitForSelector('#app[data-ply="2"]', { timeout: 15000 });
    if (which === 'item9') {
      await page.waitForSelector('.msg[data-kind="opp"][data-state="streaming"]', { timeout: 8000, state: 'attached' });
      await page.waitForFunction(() => { const m = document.querySelector('.msg[data-kind="opp"] .msg__text'); return !!m && m.textContent.length >= 4; }, null, { timeout: 8000 });
      console.log(`ITEM9 ${label} ${layout}: before the tap: ${JSON.stringify(await lines(page))}`);
      await legalTrial(page);                                  // a first trial while the line is typed
      await sleep(350);
      console.log(`   +0.35 s after the trial: ${JSON.stringify(await lines(page))}`);
      await shot(page, `item9-${layout}-after-first-trial`);
      await sleep(3000);
      const later = await lines(page);
      console.log(`   +3.4 s: ${JSON.stringify(later)}`);
      // second scene: the answer to a chip is typed and the child tries another move after the first sentence is on screen
    } else {
      await page.waitForSelector('.msg[data-kind="opp"][data-state="done"]', { timeout: 15000, state: 'attached' });
      const one = await lines(page);
      console.log(`ITEM10 ${label} ${layout}: round 1: links in the log ${JSON.stringify(one.links)}`);
      // round 2
      const t = await legalTrial(page); await sleep(500);
      const to = await cell(page, t.to[0], t.to[1]); await page.touchscreen.tap(to.x, to.y);
      await page.waitForSelector('#app[data-ply="4"]', { timeout: 15000 });
      await sleep(1500);
      // open 回看 and tap the link of round 1, then the newest link
      const hb = await page.locator('#history-button').boundingBox();
      if (hb) await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2);
      else await page.evaluate(() => document.querySelector('.bubble').dispatchEvent(new CustomEvent('bubble:expand', { bubbles: true })));   // the phone has no 回看 button outside the sheet
      await sleep(900);
      const two = await lines(page);
      console.log(`   round 2, 回看 open: links ${JSON.stringify(two.links)}; arrows ${JSON.stringify(two.arrows)}`);
      await shot(page, `item10-${layout}-log`);
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.chat__log .move-link')].map((l) => { const r = l.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: l.textContent, off: l.disabled }; }));
      if (boxes.length) {
        const old = boxes[0];
        await page.touchscreen.tap(old.x, old.y); await sleep(500);
        const afterOld = await lines(page);
        console.log(`   tap on the link of round 1 (${old.text}, retired ${old.off}): arrows ${JSON.stringify(afterOld.arrows)}; sheet ${await page.evaluate(() => document.querySelector('#app').dataset.sheet)}`);
        const fresh = boxes[boxes.length - 1];
        const nowBoxes = await page.evaluate(() => [...document.querySelectorAll('.chat__log .move-link')].map((l) => { const r = l.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: l.textContent, off: l.disabled }; }));
        const last = nowBoxes[nowBoxes.length - 1] ?? fresh;
        await page.touchscreen.tap(last.x, last.y); await sleep(500);
        const afterNew = await lines(page);
        console.log(`   tap on the newest link (${last.text}, retired ${last.off}): arrows ${JSON.stringify(afterNew.arrows)}`);
        await shot(page, `item10-${layout}-after-taps`);
      }
    }
    console.log(`   console errors ${errors.length}${errors.length ? `: ${errors[0]}` : ''}`);
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// item 11: a module that does not load; a start that throws before the stage exists; a slow but healthy start
// ---------------------------------------------------------------------------------------------------------------------
if (which === 'item11') {
  for (const layout of ['landscape', 'portrait', 'phone']) {
    for (const scene of ['module-fails', 'stage-throws', 'empty-app', 'healthy-slow']) {
      const tag = `${layout}-${scene}`;
      if (filter && !tag.includes(filter)) continue;
      const [width, height] = LAYOUTS[layout];
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN' });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 100)); });
      page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 100)}`));
      if (scene === 'module-fails') await page.route('**/src/ui/hud.js', (route) => route.abort('connectionfailed'));
      if (scene === 'stage-throws') await page.route('**/src/ui/stage.js', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: 'export function createStage() { throw new Error("scratch: the stage cannot be built"); }\n' }));
      if (scene === 'empty-app') await page.route('**/src/app.js', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: '// scratch: a module that loads and does nothing\n' }));
      if (scene === 'healthy-slow') await page.route('**/src/**', async (route) => { await sleep(60); await route.continue(); });
      const t0 = Date.now();
      await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
      const loadMs = Date.now() - t0;
      const read = () => page.evaluate(() => {
        const line = document.querySelector('.boot-fail');
        const button = line ? line.querySelector('button') : null;
        const box = button ? button.getBoundingClientRect() : null;
        const cs = button ? getComputedStyle(button) : null;
        return { line: !!line, text: button ? button.textContent : null, box: box ? `${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}` : null,
                 colours: cs ? `${cs.color} on ${cs.backgroundColor}, ${cs.fontSize}` : null, start: !!document.querySelector('dialog[data-dialog="start"]'),
                 ready: document.documentElement.dataset.ready ?? null, overlays: document.querySelector('#overlays').childElementCount };
      });
      const at1 = await read();
      await sleep(scene === 'empty-app' || scene === 'healthy-slow' ? 9000 : 1200);
      const at2 = await read();
      console.log(`ITEM11 ${label} ${tag}: load after ${loadMs} ms; right after load ${JSON.stringify(at1)}`);
      console.log(`   later: ${JSON.stringify(at2)}; console errors ${errors.length}${errors.length ? `: ${errors[0]}` : ''}`);
      await shot(page, `item11-${tag}`);
      if (at2.line && scene === 'module-fails') {
        for (const theme of ['longzhong', 'shachang']) {
          await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
          await sleep(150);
          const c = await read();
          console.log(`   theme ${theme}: ${c.colours}`);
          await shot(page, `item11-${layout}-module-fails-${theme}`);
        }
        await page.evaluate(() => { document.documentElement.dataset.theme = 'chibi'; });
        await page.unroute('**/src/ui/hud.js');
        const b = await centre(page, '.boot-fail button');
        await page.touchscreen.tap(b.x, b.y);
        await page.waitForSelector('dialog[data-dialog="start"]', { timeout: 15000 }).catch(() => null);
        console.log(`   after a tap on the line: ${JSON.stringify(await read())}`);
      }
      await context.close();
    }
  }
}

await browser.close();
clearTimeout(hardLimit);
process.exit(0);
