// XD (c): setPalette() and dispose() in the middle of a staggered render, in a real browser, on dev/audio.html.
// A steps file for tools/shot.mjs. Every run loads a fresh page, taps a pad once (real touch) and, when the engine
// has built its third OfflineAudioContext (so: two stingers rendering, the third half set up), does one of
//   palette   audio.setPalette('shachang')
//   dispose   audio.dispose()
//   rebuild   a click on 拆台重搭 (dispose + a new engine), then a second tap that unlocks the new engine
// from a microtask, i.e. right after that timer task and before the next one.
// Checked afterwards: which buffer each stinger plays (old run or new run), OfflineAudioContexts built after the
// change, unhandled rejections, page errors, and the engine's timers that are still pending (a timer counts as the
// engine's when setTimeout was called from src/ui/audio.js).
//   XD_RUNS  fresh pages per scenario (default 3)     XD_OUT  where the JSON goes
import { writeFileSync } from 'node:fs';

const RUNS = Number(process.env.XD_RUNS ?? 3);
const OUT = process.env.XD_OUT;
const AT = Number(process.env.XD_AT ?? 3);
const STINGERS = ['win', 'deal', 'check.give', 'check.take', 'blast', 'stamp'];

const INSTRUMENT = () => {
  const now = () => performance.now();
  const M = (window.__c = { epoch: 0, offline: [], renders: [], timers: new Map(), errors: [], starts: [], hook: null, marks: {} });
  window.addEventListener('unhandledrejection', e => M.errors.push('unhandled rejection: ' + String(e.reason)));
  window.addEventListener('error', e => M.errors.push('error: ' + e.message));

  const Native = window.OfflineAudioContext;
  window.OfflineAudioContext = new Proxy(Native, {
    construct(target, args, newTarget) {
      const obj = Reflect.construct(target, args, newTarget);
      M.offline.push({ t: now(), epoch: M.epoch });
      if (M.hook) M.hook(M.offline.length);
      return obj;
    },
  });
  const nativeRender = Native.prototype.startRendering;
  Native.prototype.startRendering = function () {
    const rec = { t: now(), epoch: M.epoch, done: null, buffer: null };
    M.renders.push(rec);
    const p = nativeRender.apply(this, arguments);
    p.then(buffer => { rec.done = now(); rec.buffer = buffer; }, () => { rec.done = -1; });
    return p;
  };
  const wrapStart = (proto, kindOf) => {
    const native = proto.start;
    proto.start = function () {
      if (!(this.context instanceof Native)) {
        const kind = kindOf(this);
        const render = kind === 'buffer' ? M.renders.findIndex(r => r.buffer === this.buffer) : -1;
        M.starts.push({ t: now(), kind, render, epoch: render >= 0 ? M.renders[render].epoch : null });
      }
      return native.apply(this, arguments);
    };
  };
  wrapStart(AudioScheduledSourceNode.prototype, () => 'osc');
  if (Object.hasOwn(AudioBufferSourceNode.prototype, 'start')) wrapStart(AudioBufferSourceNode.prototype, node => (node.loop ? 'noise' : 'buffer'));

  const nativeSet = window.setTimeout;
  const nativeClear = window.clearTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    const engine = /\/src\/ui\/audio\.js/.test(new Error().stack || '');
    let id = 0;
    const wrapped = typeof fn === 'function' ? function () { const rec = M.timers.get(id); if (rec) rec.state = 'fired'; return fn.apply(this, args); } : fn;
    id = nativeSet.call(window, wrapped, ms);
    if (engine) M.timers.set(id, { ms: ms ?? 0, t: now(), state: 'pending' });
    return id;
  };
  window.clearTimeout = function (id) {
    const rec = M.timers.get(id);
    if (rec && rec.state === 'pending') rec.state = 'cleared';
    return nativeClear.call(window, id);
  };
  M.pendingTimers = () => [...M.timers.values()].filter(rec => rec.state === 'pending').map(rec => rec.ms);
};

const r1 = x => Math.round(x * 10) / 10;

export default async ({ page, shot, context }) => {
  await context.addInitScript(INSTRUMENT);
  const url = page.url();
  const runs = [];
  for (const scenario of ['palette', 'dispose', 'rebuild']) {
    for (let run = 0; run < RUNS; run++) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      const pad = page.locator('[data-sfx="place"]').first();
      await pad.waitFor({ state: 'visible', timeout: 5000 });
      const box = await pad.boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;

      await page.evaluate(({ scenario, AT }) => {
        const M = window.__c;
        M.marks.timersBeforeTap = M.pendingTimers();
        M.hook = n => {
          if (n !== AT || M.marks.actAt !== undefined) return;
          M.marks.actAt = -1;
          Promise.resolve().then(() => {
            const engine = window.__desk.audio();
            M.marks.offlineAtAct = M.offline.length;
            M.marks.rendersAtAct = M.renders.length;
            M.marks.rendersDoneAtAct = M.renders.filter(r => r.done > 0).length;
            M.marks.timersAtAct = M.pendingTimers();
            M.epoch = 1;
            M.marks.actAt = performance.now();
            if (scenario === 'palette') engine.setPalette('shachang');
            else if (scenario === 'dispose') engine.dispose();
            else document.querySelector('#rebuild').click();
            M.marks.timersRightAfter = M.pendingTimers();
            M.marks.offlineRightAfter = M.offline.length;
            M.marks.oldEngine = engine;
          });
        };
      }, { scenario, AT });

      const tapAt = await page.evaluate(() => performance.now());
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(scenario === 'palette' ? 1500 : 900);

      const mid = await page.evaluate(() => {
        const M = window.__c;
        return { offline: M.offline.length, timers: M.pendingTimers(), contexts: window.__desk.contexts(), state: window.__desk.contextState(), unlocked: window.__desk.audio().unlocked };
      });
      if (scenario === 'rebuild') {
        // the new engine: a second gesture unlocks it and it renders its own six stingers
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(1500);
      }

      const result = await page.evaluate(async ({ STINGERS, scenario }) => {
        const M = window.__c;
        const engine = window.__desk.audio();
        const played = {};
        for (const name of STINGERS) {
          const n = M.starts.length;
          engine.play(name);
          const made = M.starts.slice(n);
          played[name] = { sources: made.length, kinds: [...new Set(made.map(s => s.kind))].join('+'), epochs: [...new Set(made.map(s => s.epoch))] };
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        // the engine that was disposed stays silent
        let oldSilent = null;
        if (scenario !== 'palette') { const n = M.starts.length; M.marks.oldEngine.play('win'); oldSilent = M.starts.length === n; }
        return {
          marks: { actAt: M.marks.actAt, offlineAtAct: M.marks.offlineAtAct, rendersAtAct: M.marks.rendersAtAct, rendersDoneAtAct: M.marks.rendersDoneAtAct,
            timersBeforeTap: M.marks.timersBeforeTap, timersAtAct: M.marks.timersAtAct, timersRightAfter: M.marks.timersRightAfter, offlineRightAfter: M.marks.offlineRightAfter },
          offline: M.offline.map(o => o.epoch), renders: M.renders.map(r => ({ epoch: r.epoch, ok: r.done > 0 })),
          played, oldSilent, errors: M.errors, timersAtEnd: M.pendingTimers(),
          timerStates: [...M.timers.values()].map(rec => rec.ms + ':' + rec.state).join(' '),
          contexts: window.__desk.contexts(), state: window.__desk.contextState(),
        };
      }, { STINGERS, scenario });
      await page.waitForTimeout(400);
      const late = await page.evaluate(() => ({ timers: window.__c.pendingTimers(), errors: window.__c.errors, offline: window.__c.offline.length }));
      if (run === 0) await shot(`cancel-${scenario}`);

      const oldOffline = result.offline.filter(e => e === 0).length;
      const newOffline = result.offline.filter(e => e === 1).length;
      const verdict = [];
      const expect = (ok, text) => { if (!ok) verdict.push(text); };
      expect(result.marks.actAt > 0, 'the change was made in the middle of the run');
      expect(result.marks.offlineAtAct === AT && result.marks.rendersAtAct === AT - 1, `at the change: ${AT} contexts, ${AT - 1} renders started`);
      expect(oldOffline === AT, `the old run built no further context (old ${oldOffline})`);
      expect(result.errors.length === 0 && late.errors.length === 0, 'no unhandled rejection, no page error');
      expect(late.timers.length === 0, `no engine timer pending at the end (${JSON.stringify(late.timers)})`);
      if (scenario === 'palette') {
        expect(newOffline === 6, `the new run built six contexts (${newOffline})`);
        expect(result.marks.offlineRightAfter === AT, 'nothing was set up inside setPalette()');
        for (const name of STINGERS) expect(result.played[name].sources === 1 && result.played[name].kinds === 'buffer' && result.played[name].epochs.join() === '1', `${name} plays one buffer of the new palette (${JSON.stringify(result.played[name])})`);
      } else if (scenario === 'dispose') {
        expect(newOffline === 0, `no context after dispose() (${newOffline})`);
        expect(mid.offline === AT, 'none 0.9 s later either');
        expect(result.oldSilent === true, 'the disposed engine plays nothing');
        for (const name of STINGERS) expect(result.played[name].sources === 0, `${name} is silent`);
        expect(result.state === 'closed', `the context is closed (${result.state})`);
      } else {
        expect(mid.offline === AT, `between dispose and the next gesture: no context (${mid.offline})`);
        expect(mid.timers.length === 0, `between dispose and the next gesture: no engine timer left once the samples are prepared (${JSON.stringify(mid.timers)})`);
        expect(newOffline === 6, `the new engine rendered its own six (${newOffline})`);
        expect(result.oldSilent === true, 'the disposed engine plays nothing');
        for (const name of STINGERS) expect(result.played[name].sources === 1 && result.played[name].kinds === 'buffer' && result.played[name].epochs.join() === '1', `${name} plays one buffer of the new engine (${JSON.stringify(result.played[name])})`);
      }
      runs.push({ scenario, run, ok: verdict.length === 0, failed: verdict, actAfterTapMs: r1(result.marks.actAt - tapAt), mid, late, ...result });
    }
  }
  if (OUT) writeFileSync(OUT, JSON.stringify({ at: AT, runs }, null, 1));
  for (const r of runs) console.log(`XDCANCEL ${r.scenario} run ${r.run}: ${r.ok ? 'ok' : 'FAILED ' + JSON.stringify(r.failed)}  change ${r.actAfterTapMs} ms after the tap; contexts old/new ${r.offline.filter(e => e === 0).length}/${r.offline.filter(e => e === 1).length}; timers at change ${JSON.stringify(r.marks.timersAtAct)} right after ${JSON.stringify(r.marks.timersRightAfter)} end ${JSON.stringify(r.late.timers)}; errors ${r.errors.length + r.late.errors.length}; every engine timer: ${r.timerStates}`);
  if (runs.some(r => !r.ok)) throw new Error('XD cancel check failed: ' + JSON.stringify(runs.filter(r => !r.ok).map(r => [r.scenario, r.run, r.failed])));
};
