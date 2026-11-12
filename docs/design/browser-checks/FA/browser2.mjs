// FA scratch, second file: the edges of item 2 against the repository server on 127.0.0.1:5173.
//   node browser2.mjs long      taps every 150 ms that go on for 2.5 s after the card has come up (three layouts, both motions)
//   node browser2.mjs nocard    hud.showOver throws (the card never comes): is there a way out, and when?
//   node browser2.mjs disposed  the director is disposed right after the mate: when does the action bar come back?
//   node browser2.mjs perf      how long the task of the mating confirm takes (the bookkeeping now runs inside it)
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(`${REPO}/package.json`);
const { chromium } = require('@playwright/test');
const BASE = 'http://127.0.0.1:5173';
const [which = 'long', filter = ''] = process.argv.slice(2);
const OUT = new URL('./shots/after/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hardLimit = setTimeout(() => { console.log('TIME LIMIT'); process.exit(3); }, 540000);
const KEYS = { game: 'yijian.xiangqi.v2.game', migrated: 'yijian.xiangqi.v2.migrated', profile: 'yijian.xiangqi.v2.profile' };
const LAYOUTS = { landscape: [1180, 820], portrait: [820, 1180], phone: [360, 740] };
const mate = readFileSync(`${REPO}/tests/fixtures/saves/v2-one-before-mate.json`, 'utf8');
const savedId = JSON.parse(mate).id;
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });

function record() {
  window.__ev = [];
  window.__marks = {};
  const name = (el) => {
    if (!el || !el.closest) return '?';
    const b = el.closest('button');
    return (el.id ? `#${el.id}` : el.tagName.toLowerCase()) + (b ? ` [button ${b.id ? `#${b.id}` : ''} "${b.textContent.trim().slice(0, 12)}"${b.closest('#overlays') ? ' on the card' : ''}]` : '');
  };
  for (const type of ['pointerdown', 'click']) window.addEventListener(type, (e) => window.__ev.push({ type, t: Math.round(performance.now()), hit: name(e.target) }), true);
  const watch = () => {
    const m = window.__marks;
    if (!m.over && document.querySelector('#app[data-phase="over"]')) m.over = Math.round(performance.now());
    if (!m.card && document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]')) m.card = Math.round(performance.now());
    const actions = document.querySelector('#actions');
    if (m.over && actions) {
      if (actions.inert && !m.held) m.held = Math.round(performance.now());
      if (!actions.inert && m.held && !m.freed) m.freed = Math.round(performance.now());
    }
  };
  new MutationObserver(watch).observe(document, { subtree: true, childList: true, attributes: true });
}

async function open(layout, reduced, routes) {
  const [width, height] = LAYOUTS[layout];
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN',
                                             reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 140)}`));
  if (routes) await routes(page);
  await page.addInitScript((content) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(content)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } },
                           { [KEYS.game]: mate, [KEYS.migrated]: '1' });
  await page.addInitScript(record);
  await page.goto(`${BASE}/?test=1&coach=off`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
  await page.evaluate(() => window.__ui.idle());
  return { context, page, errors };
}
const centre = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`not visible: ${sel}`);
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
};
const state = (page) => page.evaluate(([kg, kp]) => {
  const g = JSON.parse(localStorage.getItem(kg) ?? 'null');
  const p = JSON.parse(localStorage.getItem(kp) ?? 'null');
  const app = document.querySelector('#app');
  return { id: g ? g.id : null, moves: g ? g.moves.length : null, phase: app.dataset.phase, ply: app.dataset.ply,
           card: !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]'), games: p ? p.games : null,
           actionsInert: document.querySelector('#actions').inert, ev: window.__ev, marks: window.__marks };
}, [KEYS.game, KEYS.profile]);
const games = (g) => (g ? `played ${g.played} won ${g.won} lost ${g.lost}` : 'no profile');
/** Plays the mating move up to the tap on 确定落子; returns where that button is. */
async function toMate(page) {
  const a = await centre(page, '.board-cell[data-row="5"][data-col="1"]'); await page.touchscreen.tap(a.x, a.y); await sleep(300);
  const b = await centre(page, '.board-cell[data-row="5"][data-col="4"]'); await page.touchscreen.tap(b.x, b.y); await sleep(900);
  const conf = await centre(page, '#confirm-button');
  await page.evaluate(() => { window.__ev.length = 0; });
  return conf;
}

if (which === 'long') {
  for (const layout of ['landscape', 'portrait', 'phone']) {
    for (const reduced of [true, false]) {
      const tag = `${layout}-${reduced ? 'reduced' : 'full'}`;
      if (filter && !tag.includes(filter)) continue;
      const { context, page, errors } = await open(layout, reduced);
      const conf = await toMate(page);
      await page.touchscreen.tap(conf.x, conf.y);
      // taps where 确定落子 was, every 150 ms, until the card has been up for 2.5 s
      let cardAt = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 16000) {
        await sleep(150);
        await page.touchscreen.tap(conf.x, conf.y);
        if (!cardAt && await page.evaluate(() => !!window.__marks.card)) cardAt = Date.now();
        if (cardAt && Date.now() - cardAt > 2500) break;
      }
      await sleep(300);
      const r = await state(page);
      await page.screenshot({ path: new URL(`item2-long-${tag}.png`, OUT).pathname.slice(1) });
      const downs = r.ev.filter((e) => e.type === 'pointerdown');
      const first = downs[0].t;
      const afterCard = downs.filter((d) => r.marks.card && d.t > r.marks.card);
      const clicks = r.ev.filter((e) => e.type === 'click' && /button/.test(e.hit)).map((e) => `+${e.t - first}${r.marks.card ? ` (card ${e.t - r.marks.card >= 0 ? '+' : ''}${e.t - r.marks.card})` : ''} ${e.hit}`);
      console.log(`LONG ${tag}: ${downs.length} taps, the last +${downs[downs.length - 1].t - first} ms; card at +${r.marks.card - first} ms; ${afterCard.length} taps after the card, hits: ${[...new Set(afterCard.map((d) => d.hit))].join(' ; ')}`);
      console.log(`   clicks on a control: ${clicks.join(' | ')}`);
      console.log(`   => phase ${r.phase} ply ${r.ply}, card up ${r.card}, saved game ${r.id === savedId ? 'the won one' : `A NEW ONE (${r.moves} moves)`}, profile: ${games(r.games)}; errors ${errors.length}`);
      // then a pause, and one tap that is meant
      await sleep(700);
      if (r.card) {
        const again = await centre(page, 'dialog[data-dialog="over"] [data-choice="again"]');
        await page.touchscreen.tap(again.x, again.y);
        await sleep(1500);
        const n = await state(page);
        console.log(`   after a pause of 1 s, one tap on the card's 再来一局 => phase ${n.phase} ply ${n.ply}, saved game ${n.id === savedId ? 'STILL THE WON ONE' : `a new one (${n.moves} moves)`}, profile: ${games(n.games)}`);
      }
      await context.close();
    }
  }
}

if (which === 'nocard' || which === 'disposed') {
  const hud = readFileSync(`${REPO}/src/ui/hud.js`, 'utf8');
  const anchor = '  function showOver(view) {\n';
  if (!hud.includes(anchor)) throw new Error('hud.js: showOver not found');
  const broken = hud.replace(anchor, `${anchor}    throw new Error('scratch: the card cannot be built');\n`);
  for (const layout of ['landscape', 'portrait', 'phone']) {
    for (const reduced of [true, false]) {
      const tag = `${layout}-${reduced ? 'reduced' : 'full'}`;
      if (filter && !tag.includes(filter)) continue;
      const { context, page, errors } = await open(layout, reduced, which === 'nocard'
        ? (p) => p.route('**/src/ui/hud.js', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: broken }))
        : null);
      const conf = await toMate(page);
      await page.touchscreen.tap(conf.x, conf.y);
      if (which === 'disposed') await page.evaluate(() => window.__yijian.director.dispose());
      // taps every 300 ms on 再来一局 of the action bar until something happens, at most 20 s
      const t0 = Date.now();
      let started = 0;
      while (Date.now() - t0 < 20000) {
        await sleep(300);
        await page.touchscreen.tap(conf.x, conf.y);
        const s = await page.evaluate(() => ({ ply: document.querySelector('#app').dataset.ply, inert: document.querySelector('#actions').inert }));
        if (s.ply === '0') { started = Date.now() - t0; break; }
        if (which === 'disposed' && !s.inert) { started = Date.now() - t0; break; }
      }
      await sleep(800);
      const r = await state(page);
      const first = r.ev.filter((e) => e.type === 'pointerdown')[0].t;
      console.log(`${which.toUpperCase()} ${tag}: game over at +${r.marks.over - first} ms; the action bar was inert from +${r.marks.held - first} to ${r.marks.freed ? `+${r.marks.freed - first}` : 'THE END'} ms; `
        + `${which === 'nocard' ? `a new game started ${started ? `after ${started} ms of tapping` : 'NEVER'}` : `the action bar took taps again ${started ? `after ${started} ms` : 'NEVER'}`}`);
      console.log(`   => phase ${r.phase} ply ${r.ply}, card up ${r.card}, saved game ${r.id === savedId ? 'the won one' : `a new one (${r.moves} moves)`}, profile: ${games(r.games)}; errors ${errors.length}${errors.length ? `: ${errors[0]}` : ''}`);
      await context.close();
    }
  }
}

// cut2: the greeting is typed at 250 ms per four characters; the child puts a move on trial when its first sentence is
// on screen and more is still coming: the whole sentence stays, the rest goes.
if (which === 'cut2') {
  for (const layout of ['landscape', 'portrait', 'phone']) {
    if (filter && !layout.includes(filter)) continue;
    const [width, height] = LAYOUTS[layout];
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.route('**/api/coach', (route) => route.continue({ url: `${route.request().url()}?chunkMs=250` }));
    await page.goto(`${BASE}/?test=1`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
    const read = () => page.evaluate(() => {
      const b = document.querySelector('.bubble'); const t = b ? b.querySelector('.bubble__text') : null;
      return { bubble: b ? `${b.dataset.state}:"${t ? t.textContent : ''}"` : null,
               log: [...document.querySelectorAll('.chat__log .msg[data-role="buddy"]')].map((m) => `${m.dataset.kind}:${m.dataset.state}:"${m.querySelector('.msg__text').textContent}"`) };
    });
    // wait until a sentence end is on screen while the line is still streaming
    let seen = null;
    for (let i = 0; i < 200; i++) {
      seen = await read();
      if (seen.bubble && /^streaming:.*[。！？]/.test(seen.bubble)) break;
      if (seen.bubble && seen.bubble.startsWith('done')) break;
      await sleep(40);
    }
    console.log(`CUT2 ${layout}: before the trial: ${JSON.stringify(seen)}`);
    const a = await centre(page, '.board-cell[data-row="7"][data-col="7"]'); await page.touchscreen.tap(a.x, a.y); await sleep(150);
    const b = await centre(page, '.board-cell[data-row="7"][data-col="4"]'); await page.touchscreen.tap(b.x, b.y); await sleep(300);
    console.log(`   +0.3 s after the trial: ${JSON.stringify(await read())}`);
    await page.screenshot({ path: new URL(`item9-cut2-${layout}.png`, OUT).pathname.slice(1) });
    await context.close();
  }
}

if (which === 'perf') {
  for (const layout of ['landscape', 'phone']) {
    const { context, page } = await open(layout, false);
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: false });
      window.__clicks = [];
      document.querySelector('#confirm-button').addEventListener('click', () => {
        const t = performance.now();
        Promise.resolve().then(() => window.__clicks.push({ at: Math.round(t) }));
        requestAnimationFrame(() => window.__clicks.push({ frameAfter: Math.round(performance.now() - t) }));
      }, true);
    });
    const conf = await toMate(page);
    await page.touchscreen.tap(conf.x, conf.y);
    await sleep(1500);
    const r = await page.evaluate(() => ({ long: window.__long, clicks: window.__clicks, phase: document.querySelector('#app').dataset.phase }));
    console.log(`PERF ${layout}: phase ${r.phase}; the tap on 确定落子: ${JSON.stringify(r.clicks)}; long tasks (>50 ms) since: ${JSON.stringify(r.long)}`);
    await context.close();
  }
}

await browser.close();
clearTimeout(hardLimit);
process.exit(0);
