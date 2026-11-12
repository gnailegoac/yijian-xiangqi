// FA scratch, third file: 司马懿 mates the child while the finger keeps tapping where the action bar's button is.
// usage: node browser3.mjs <before|after>
// The position is one move before his mate (tests/unit/game/director.test.js MATE_FOR_BLACK); the real engine decides
// whether he plays it, so seeds are tried until he does.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';

const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(`${REPO}/package.json`);
const { chromium } = require('@playwright/test');
const BASE = 'http://127.0.0.1:5173';
const [label = 'after'] = process.argv.slice(2);
const OUT = new URL(`./shots/${label}/`, import.meta.url);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hardLimit = setTimeout(() => { console.log('TIME LIMIT'); process.exit(3); }, 400000);
const KEYS = { game: 'yijian.xiangqi.v2.game', migrated: 'yijian.xiangqi.v2.migrated', profile: 'yijian.xiangqi.v2.profile' };
const LAYOUTS = { landscape: [1180, 820], portrait: [820, 1180], phone: [360, 740] };
const saved = { schema: 2, id: 'g-rivalmate1', humanColor: 'red', moves: ['9888', '2124', '8898', '2464', '9888', '2747', '8898'], result: null, startedAt: 1790000000000,
                endedAt: null, activeMs: 60000, counted: false, drawFrom: 0, seed: 7, skill: null, memory: null, start: null };
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });

function record() {
  window.__ev = [];
  window.__marks = {};
  for (const type of ['pointerdown', 'click']) {
    window.addEventListener(type, (e) => {
      const b = e.target.closest ? e.target.closest('button') : null;
      window.__ev.push({ type, t: Math.round(performance.now()), hit: b ? `${b.id ? `#${b.id} ` : ''}"${b.textContent.trim().slice(0, 10)}"${b.closest('#overlays') ? ' on the card' : ''}` : e.target.id || e.target.tagName });
    }, true);
  }
  new MutationObserver(() => {
    const m = window.__marks;
    if (!m.over && document.querySelector('#app[data-phase="over"]')) m.over = Math.round(performance.now());
    if (!m.card && document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]')) m.card = Math.round(performance.now());
  }).observe(document, { subtree: true, childList: true, attributes: true });
}

let found = 0;
for (const layout of ['landscape', 'portrait', 'phone']) {
  for (const reduced of [false, true]) {
    let done = false;
    for (let seed = 1; seed <= 2 && !done; seed++) {
      const [width, height] = LAYOUTS[layout];
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN',
                                                 reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      await page.addInitScript((content) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(content)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } },
                               { [KEYS.game]: JSON.stringify(saved), [KEYS.migrated]: '1' });
      await page.addInitScript(record);
      await page.addInitScript(() => {
        const Real = window.Worker;
        class Double {
          constructor(url, options) {
            this.onmessage = null; this.onerror = null; this.onmessageerror = null;
            this.opp = new Set();
            this.real = new Real(url, options);
            this.real.onmessage = (event) => {
              const d = event.data;
              if (d && d.t === 'done' && this.opp.has(d.id) && d.data && d.data.move) {
                const from = { row: 4, col: 7 }, to = { row: 4, col: 4 };
                d.data.move = { ...d.data.move, from, to, captured: null };
                if (d.data.choice) d.data.choice.move = { from, to };
              }
              if (this.onmessage) this.onmessage({ data: d });
            };
            this.real.onerror = (event) => { if (this.onerror) this.onerror(event); };
          }
          postMessage(message) {
            if (message && message.t === 'job' && message.kind === 'opponent' && message.payload && message.payload.ply === 7) this.opp.add(message.id);
            this.real.postMessage(message);
          }
          terminate() { this.real.terminate(); }
          addEventListener() {}
          removeEventListener() {}
        }
        window.Worker = Double;
      });
      await page.goto(`${BASE}/?test=1&coach=off&seed=${seed}`, { waitUntil: 'load', timeout: 20000 });
      await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
      // the finger taps where the action bar's button is, every 150 ms, from now on for six seconds after his move
      const box = await page.locator('#actions').boundingBox();
      const spot = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      let overAt = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 16000) {
        await page.touchscreen.tap(spot.x, spot.y);
        await sleep(150);
        const s = await page.evaluate(() => ({ phase: document.querySelector('#app').dataset.phase, ply: document.querySelector('#app').dataset.ply, over: !!window.__marks.over }));
        if (!overAt && s.over) overAt = Date.now();
        if (!overAt && s.phase === 'childTurn' && s.ply === '8') break;       // he did not play the mate
        if (overAt && Date.now() - overAt > Number(process.env.TAPS_MS ?? 5000)) break;
      }
      if (!overAt) { await context.close(); continue; }
      done = true;
      found += 1;
      await page.waitForSelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]', { timeout: 12000 }).catch(() => null);
      await sleep(600);
      const r = await page.evaluate(([kg, kp]) => {
        const g = JSON.parse(localStorage.getItem(kg) ?? 'null'); const p = JSON.parse(localStorage.getItem(kp) ?? 'null'); const app = document.querySelector('#app');
        return { id: g ? g.id : null, moves: g ? g.moves.length : null, phase: app.dataset.phase, ply: app.dataset.ply, games: p ? p.games : null,
                 card: !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]'), ev: window.__ev, marks: window.__marks };
      }, [KEYS.game, KEYS.profile]);
      const clicks = r.ev.filter((e) => e.type === 'click' && e.t >= r.marks.over).map((e) => `+${e.t - r.marks.over} ${e.hit}`);
      const taps = r.ev.filter((e) => e.type === 'pointerdown' && e.t >= r.marks.over).length;
      console.log(`RIVALMATE ${label} ${layout}-${reduced ? 'reduced' : 'full'} (seed ${seed}): ${taps} taps after his mating move; card ${r.marks.card ? `at +${r.marks.card - r.marks.over} ms` : 'NEVER'}; clicks on controls after it: ${clicks.join(' | ') || '(none)'}`);
      console.log(`   => phase ${r.phase} ply ${r.ply}, card up ${r.card}, saved game ${r.id === saved.id ? 'the lost one' : `A NEW ONE (${r.moves} moves)`}, profile: ${r.games ? `played ${r.games.played} won ${r.games.won} lost ${r.games.lost}` : 'none'}`);
      await page.screenshot({ path: new URL(`rivalmate-${layout}-${reduced ? 'reduced' : 'full'}.png`, OUT).pathname.slice(1) });
      await context.close();
    }
    if (!done) console.log(`RIVALMATE ${label} ${layout}-${reduced ? 'reduced' : 'full'}: he did not play the mate with seeds 1..12`);
  }
}
console.log(`scenarios in which he mated: ${found} of 6`);
await browser.close();
clearTimeout(hardLimit);
process.exit(0);
