// Shared by the browser tests of stage.js (run through tools/shot.mjs --steps).
export const BASE = 'http://127.0.0.1:5313/dev/stage.html';

const AUDIO_SPY = `
import * as real from '/src/ui/audio.js?real=1';
export const RECIPE_SOURCES = real.RECIPE_SOURCES, PRERENDERED = real.PRERENDERED, bedVoices = real.bedVoices;
export function createAudio() {
  const a = real.createAudio();
  const log = (window.__audio = []);
  const wrap = (name) => (...args) => { log.push([name, ...args]); return a[name](...args); };
  return {
    unlock: wrap('unlock'), get unlocked() { return a.unlocked; }, play: wrap('play'), setTension: wrap('setTension'),
    music: { start: () => { log.push(['music.start']); a.music.start(); }, stop: (ms) => a.music.stop(ms), setScene: (s) => { log.push(['music.setScene', s]); a.music.setScene(s); } },
    setSuspense: wrap('setSuspense'), duck: wrap('duck'), setPalette: wrap('setPalette'), setMuted: wrap('setMuted'), applySettings: wrap('applySettings'),
    cancelScheduled: wrap('cancelScheduled'), setHidden: wrap('setHidden'), dispose: wrap('dispose'),
  };
}`;

/** Routes src/ui/audio.js to a recording wrapper: window.__audio = [[method, ...args], ...]. */
export async function spyAudio(page) {
  await page.route((url) => url.pathname.endsWith('/src/ui/audio.js') && !url.search, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: AUDIO_SPY }));
}

/** Loads the harness without the start overlay and (by default) with handlers that only record: window.__calls. */
export async function load(page, query = '', opts = {}) {
  await page.goto(`${BASE}?panel=0&start=0${query ? '&' + query : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dev && document.querySelectorAll('.piece').length === 32);
  await page.waitForLoadState('networkidle').catch(() => {});     // nothing of this page is still loading when the next one is opened
  await page.waitForTimeout(opts.settle ?? 350);
  if (opts.director) return;
  await page.evaluate(() => {
    const names = ['tap', 'confirm', 'retract', 'undo', 'hint', 'ask', 'chip', 'moveLink', 'playLine', 'newGame', 'resign', 'retryOpponent', 'retryEngine',
                   'setting', 'exportRecord', 'exportBackup', 'importBackup', 'stopCoach', 'activity'];
    window.__calls = [];
    window.__dev.stop();
    window.__dev.real.settle();
    window.__dev.real.on(Object.fromEntries(names.map((n) => [n, (...a) => { window.__calls.push([n, ...a]); }])));
  });
  await page.waitForTimeout(1300);          // the fake director's greeting has been said; nothing of it is in flight
  await page.evaluate(() => { window.__calls.length = 0; if (window.__audio) window.__audio.length = 0; });
}

export function suite() {
  const results = [];
  let current = '';
  return {
    async test(name, fn) {
      current = name;
      const fails = [];
      const t = {
        ok(cond, msg) { if (!cond) fails.push(msg); },
        eq(actual, expected, msg) { if (JSON.stringify(actual) !== JSON.stringify(expected)) fails.push(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
        near(actual, expected, tol, msg) { if (!(Math.abs(actual - expected) <= tol)) fails.push(`${msg}: expected ${expected} ± ${tol}, got ${actual}`); },
      };
      try { await fn(t); } catch (error) { fails.push(`threw: ${String(error && error.stack ? error.stack : error).slice(0, 600)}`); }
      results.push({ name, fails });
      console.error(`${fails.length ? 'FAIL' : 'ok  '} ${name}${fails.length ? '\n     - ' + fails.join('\n     - ') : ''}`);
    },
    report() {
      const failed = results.filter((r) => r.fails.length);
      console.error(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} tests`);
      if (failed.length) throw new Error(`${failed.length} test(s) failed: ${failed.map((r) => r.name).join(' | ')}`);
    },
  };
}

/** The names of the calls recorded by the handlers, without `activity`. */
export const calls = (page) => page.evaluate(() => window.__calls.filter((c) => c[0] !== 'activity'));
export const clearCalls = (page) => page.evaluate(() => { window.__calls.length = 0; });
export const sounds = (page) => page.evaluate(() => (window.__audio ?? []).filter((c) => c[0] === 'play').map((c) => c[1]));
export const audioLog = (page) => page.evaluate(() => window.__audio ?? []);
export const clearAudio = (page) => page.evaluate(() => { if (window.__audio) window.__audio.length = 0; });
export const mood = (page) => page.evaluate(() => document.querySelector('#buddy svg.buddy').dataset.mood);

export async function cellPoint(page, row, col) {
  const box = await page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
export async function tapCell(page, row, col) {
  const p = await cellPoint(page, row, col);
  await page.touchscreen.tap(p.x, p.y);
}
