// Composition root (SPEC 4.27). Owner: A1.
//
// This is the entry module of index.html. It builds the real modules, hands them to each other and starts the game;
// it decides nothing about chess, teaching or looks. The steps below keep the numbers and the order of SPEC 4.27.
//
// Readings of points the contract leaves open (reported with the package):
// - The settings in force are followed through `store.onSettings`: the side picked in the settings sheet of the start
//   card is the side of the game that starts, and the coach port's `forceLocal` is assigned on every change
//   (CONTRACT-NOTES 83; `?coach=off` keeps it on, so the settings sheet shows the reason `setting`).
// - Leaving the page for an imported save (`reload`): the director and the task manager are disposed first and the save
//   subscriber goes quiet, so nothing that is still in flight can write over the records the import just stored.
// - 导入存档 on the start card: the stage hands the file to `director.actions.importBackup`. A good file reloads the page;
//   after a bad one (the director has told the child) the start card is shown again.
// - The tap that picks 开战 / 继续 ends before step 10 runs: one zero-delay timer lies between them, so the game is never
//   built inside the tap's own task (CONTRACT-NOTES 121 and 127). `?test=1` has no tap and no timer.
// - A saved game that cannot be restored is copied to the quarantine slot and reported as `game-corrupt`; a new game
//   starts and the profile stays.
// - The notices `migrated-v1` and `migrated-v1-local` are passed on only when the migrated game is continued and is not
//   over: their lines say that the old game goes on, which is not true after 新开一局 or for a game that has ended.
// - A fault before the stage exists (step 3 threw) has no toast to go to: it is told by the page's own line with the
//   reload button, which the inline script of index.html also shows when the module graph does not load at all.
// - "After a v1 import" (step 10) also covers the load after it: a finished game whose record carries no game-skill yet
//   was written by the migration and never played here, so it is not counted either.
// - A proxy that says why it is off (`config.coach.reason`, `no_key` from the dev server) is more exact than the
//   client's `no_proxy`; the coach port handed on reports the file's reason in its place.
// - `error` / `unhandledrejection`: the contract asks for one toast and names no string; the wording is FAULT_TOAST.
// - `?test=1`: `window.__yijian.tasks.stats()` also carries the worker's speed class (SPEC 14.9).

/**
 * @import { CoachOffReason, CoachPort, Notice, StagePort } from './game/types.js'
 */

import { loadConfig } from './config.js';
import { RANK_NAMES } from './core/codes.js';
import { createSkillProfile, migrateSkillProfile, reviveGameSkill } from './core/teacher.js';
import { createDirector } from './game/director.js';
import { createBrainPort, createCoachPort } from './game/ports.js';
import { createSession } from './game/session.js';
import { createStore } from './game/store.js';
import { createTasks } from './game/tasks.js';
import { createStage } from './ui/stage.js';

/** The one toast after an uncaught error (no string of the contract fits; the save is on disk, so a reload is safe). */
const FAULT_TOAST = '出了点小状况。要是棋局不动了，刷新一下页面，棋局还在。';

/** The stage, once it exists: where a fault is told. @type {StagePort|null} */
let faultStage = null;
let faultTold = false;

/** console + one toast (SPEC 4.27 step 12). @param {unknown} error */
function fault(error) {
  console.error('[app]', error);
  if (faultTold) return;
  if (faultStage) {
    faultTold = true;
    faultStage.toast(FAULT_TOAST);
    return;
  }
  // No stage, so nothing can show a toast, and the shell would look like loading for ever: the line of index.html.
  const tell = /** @type {{__bootFailed?:unknown}} */ (/** @type {unknown} */ (window)).__bootFailed;
  if (typeof tell !== 'function') return;
  faultTold = true;
  tell();
}

/** mulberry32: a small seeded generator, uniform in [0, 1). @param {number} seed uint32 @returns {() => number} */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `?seed=<int>` when present, else from crypto.getRandomValues. @param {URLSearchParams} query @returns {number} uint32 */
function seedOf(query) {
  const text = query.get('seed');
  if (text !== null && /^-?\d+$/.test(text)) return Number.parseInt(text, 10) >>> 0;
  try {
    const cell = new Uint32Array(1);
    crypto.getRandomValues(cell);
    return cell[0];
  } catch {
    return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
  }
}

/** The page is served from this machine (the backup offer of the start card is for the LAN address, D-23). @param {Location} url */
function isLoopback(url) {
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

async function boot() {
  const query = new URLSearchParams(location.search);
  const test = query.get('test') === '1';

  //  1. the config is fetched while the page is built
  const cfgPromise = loadConfig();

  //  2. the stored records (synchronous; never throws)
  const store = createStore({ teacher: { createSkillProfile, migrateSkillProfile, reviveGameSkill } });
  const loaded = store.load();
  let settings = loaded.settings;

  //  3. the stage reads ?test=1, ?motion=, ?mute=1 and ?theme= from the URL itself (CONTRACT-NOTES 119)
  const app = document.getElementById('app');
  if (!app) throw new Error('app: #app is missing from index.html');
  const stage = createStage(app, { settings, url: location, rank: RANK_NAMES[loaded.profile.rank - 1] ?? '' });
  faultStage = stage;

  //  4. the worker starts loading now; its callbacks arrive after step 5
  /** @type {{speedClass:'fast'|'mid'|'slow', perftNps:number}|null} */
  let speed = null;
  const tasks = createTasks({
    getScope: () => session.scope(),
    createWorker: () => new Worker(new URL('./core/search-worker.js', import.meta.url), { type: 'module' }),
    onWorker: (e, info) => {
      if (e === 'ready') {
        if (!info) return;
        speed = info;
        brain.setSpeed(info.speedClass);
      } else if (e === 'dead') {
        stage.blocking({ kind: 'engine-dead' });           // the director's retryEngine clears it
      }
    },
  });

  //  5.
  const session = createSession();
  const brain = createBrainPort();

  //  6. always the first subscriber
  session.subscribe((e) => { if (e.type === 'scope') tasks.sync(e.scope); });

  //  7. the coach. `coachDeps` is read live by the port: forceLocal follows the setting (CONTRACT-NOTES 83)
  const config = await cfgPromise;
  /** @param {{coach:'auto'|'local'}} s */
  const localOnly = (s) => s.coach === 'local' || config.coach.reason === 'setting';
  const coachDeps = { apiBase: config.apiBase, forceLocal: localOnly(settings), tasks, brain, getSession: () => session.getState() };
  store.onSettings((next) => {                             // runs inside saveSettings, before the director hears of the change
    settings = next;
    coachDeps.forceLocal = localOnly(next);
  });
  const port = createCoachPort(coachDeps);
  /** Why the proxy itself says it is off, when that is more than "there is none". @type {CoachOffReason|null} */
  const fileReason = config.apiBase === null && config.coach.reason !== 'no_proxy' && config.coach.reason !== 'setting' ? config.coach.reason : null;
  /** @param {CoachOffReason|null} reason */
  const why = (reason) => (reason === 'no_proxy' && fileReason !== null ? fileReason : reason);
  /** @type {CoachPort} */
  const coach = fileReason === null ? port : {
    ...port,
    offReason: () => why(port.offReason()),
    onMode: (fn) => port.onMode((m) => fn({ mode: m.mode, reason: why(m.reason) })),
  };

  //  8. the director; then the save, then the director, in this order (SPEC 4.27, 13.4)
  let leaving = false;
  let storageTold = false;
  const save = () => {
    if (leaving) return;
    if (store.saveGame({ ...session.serialize(), ...director.extras() }) || storageTold) return;
    storageTold = true;                                    // a write that first fails after boot: told once
    director.notices(['storage-unavailable'], { truncatedAt: null });
  };
  const director = createDirector({
    session, tasks, store, brain, coach, stage,
    profile: loaded.profile,
    settings,
    save,
    rng: mulberry32(seedOf(query)),
    now: () => Date.now(),
    setTimer: window.setTimeout.bind(window),
    clearTimer: window.clearTimeout.bind(window),
    isHidden: () => document.hidden,
    reload: () => {                                        // an imported save is on disk: nothing may write over it now
      leaving = true;
      director.dispose();
      tasks.dispose();
      location.reload();
    },
  });
  session.subscribe((e) => { if (e.type === 'change' && e.persist) save(); });
  session.subscribe(director.onEvent);
  stage.on(director.actions);

  //  9. the start card (the title card and the audio-unlock gesture); ?test=1 skips it
  /** @type {'continue'|'new'|'import'} */
  let choice = loaded.game ? 'continue' : 'new';
  if (!test) {
    const info = { hasSave: loaded.game !== null, firstVisit: loaded.firstVisit, canImport: loaded.firstVisit && !isLoopback(location) };
    for (;;) {
      choice = await stage.start(info);
      if (choice !== 'import') break;
      if (leaving) return;                                 // the file was good: the page is reloading with it
    }
    // The choice was a tap. When the audio context is already running, stage.start() resolves inside that tap's own task,
    // and step 10 would run there too; the tap ends first and the game is built in a task of its own (CONTRACT-NOTES 127).
    await new Promise((resolve) => { window.setTimeout(resolve, 0); });
  }

  // 10. the game
  /** @param {Notice} n */
  const ofMigration = (n) => n === 'migrated-v1' || n === 'migrated-v1-local';
  /** @type {Notice[]} */
  let notices = loaded.notices;
  /** @type {number|null} */
  let truncatedAt = null;
  const saved = choice === 'continue' ? loaded.game : null;
  director.loadExtras(saved);
  let restored = false;
  if (saved) {
    try {
      truncatedAt = session.restore(saved).truncatedAt;
      restored = true;
    } catch (error) {
      console.error('[app] the saved game could not be restored', error);
      store.quarantine('game', 'corrupt');                 // the raw record is kept aside before a new game replaces it
      notices = [...notices, 'game-corrupt'];
      director.loadExtras(null);
    }
  }
  if (restored && saved) {
    // a game that was finished in v1 does not enter the new statistics (SPEC 13.3); synchronously, before the director counts
    const fromV1 = notices.some(ofMigration) || saved.skill === null;
    if (fromV1 && session.getState().result !== null) session.markCounted();
    // ... and a game that is over does not "go on": its card says how it ended, the two lines would say 接着下
    if (session.getState().result !== null) notices = notices.filter((n) => !ofMigration(n));
  } else {
    notices = notices.filter((n) => !ofMigration(n));      // those two lines say the old game goes on, and it does not
    session.newGame({ humanColor: settings.side });
  }

  // 11.
  director.notices(notices, { truncatedAt });

  // 12. listeners
  document.addEventListener('visibilitychange', () => director.visibility(!document.hidden));
  window.addEventListener('online', () => { coach.probe().catch(fault); });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => director.applySettings(settings));
  window.addEventListener('error', (event) => {
    if (typeof event.message === 'string' && event.message.startsWith('ResizeObserver loop')) return;      // a browser notice, not a fault
    fault(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => fault(event.reason));

  // 13.
  coach.probe().catch(fault);
  document.documentElement.dataset.ready = '1';
  if (test) {
    const stats = () => ({ ...tasks.stats(), speedClass: speed ? speed.speedClass : null, perftNps: speed ? speed.perftNps : null });
    Object.assign(window, { __yijian: { session, tasks: { ...tasks, stats }, store, director, coach } });
  }
}

boot().catch(fault);
