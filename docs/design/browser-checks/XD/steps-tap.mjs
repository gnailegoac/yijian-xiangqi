// XD: what the first tap of a visit costs (CONTRACT-NOTES M-121).
// A steps file for tools/shot.mjs. Every run loads a fresh page, taps once and listens for two seconds.
//
//   XD_PAGE   stage | audio            which dev page (the --url given to shot.mjs must be the same page)
//   XD_INPUT  touch | mouse            a real touch tap (touchscreen.tap) or a mouse click
//   XD_RUNS   number of fresh pages    (default 7)
//   XD_OUT    where the JSON goes
//   XD_PLAY   1: play 'deal' the moment audio:unlocked fires and again after 1.2 s (audio page only): is a stinger
//             live before its buffer exists and one buffer source afterwards?
//
// Measured in the page (wrappers installed before any page script runs): the time of every listener of the gesture's
// events, the AudioContext / OfflineAudioContext constructors, every ConvolverNode.buffer set, startRendering and
// when its buffer arrives, resume(), every timer callback, every source started on the live context; the
// PerformanceObserver entries for 'longtask' and 'event' (durationThreshold 16).
// Measured from outside: a Chrome trace of the renderer's main thread, so every task has its true length.
import { writeFileSync } from 'node:fs';

const PAGE = process.env.XD_PAGE ?? 'stage';
const INPUT = process.env.XD_INPUT ?? 'touch';
const RUNS = Number(process.env.XD_RUNS ?? 7);
const OUT = process.env.XD_OUT;
const PLAY = process.env.XD_PLAY === '1';
// XD_VARIANTS  name=path,name=path,...   each run serves the next file in place of src/ui/audio.js (an empty path:
//              the repo's own file), so the variants are measured interleaved, under the same machine load
const VARIANTS = (process.env.XD_VARIANTS ?? 'repo=').split(',').map(v => { const i = v.indexOf('='); return { name: v.slice(0, i), path: v.slice(i + 1) }; });
// XD_DELAY     ms between the page's load and the tap (default 1500)
const DELAY = Number(process.env.XD_DELAY ?? 1500);

const INSTRUMENT = () => {
  const now = () => performance.now();
  const M = (window.__m = { handlers: [], calls: [], timers: [], longtasks: [], events: [], starts: [], marks: {}, errors: [] });
  /** The listener or timer callback that is running. */
  let current = null;
  const note = (what, t, extra) => {
    const rec = { what, t, ms: now() - t, in: current ? current.label : null, ...extra };
    M.calls.push(rec);
    if (current) current.audio = true;
    return rec;
  };
  window.addEventListener('unhandledrejection', e => M.errors.push(String(e.reason)));

  const TYPES = new Set(['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'keydown']);
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
  const wraps = new WeakMap();
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (!TYPES.has(type) || typeof fn !== 'function') return nativeAdd.call(this, type, fn, opts);
    let byType = wraps.get(fn);
    if (!byType) { byType = {}; wraps.set(fn, byType); }
    if (!byType[type]) {
      byType[type] = function (event) {
        const outer = current;
        const rec = { label: type, t: now(), ms: 0, stamp: event.timeStamp, audio: false };
        current = rec;
        try { return fn.apply(this, arguments); } finally { rec.ms = now() - rec.t; current = outer; M.handlers.push(rec); }
      };
    }
    return nativeAdd.call(this, type, byType[type], opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const w = typeof fn === 'function' ? wraps.get(fn)?.[type] : null;
    return nativeRemove.call(this, type, w || fn, opts);
  };

  const nativeSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    if (typeof fn !== 'function') return nativeSetTimeout.call(window, fn, ms, ...args);
    return nativeSetTimeout.call(window, function () {
      const outer = current;
      const rec = { label: 'timer', t: now(), ms: 0, delay: ms ?? 0, audio: false };
      current = rec;
      try { return fn.apply(this, args); } finally { rec.ms = now() - rec.t; current = outer; if (rec.audio || rec.ms >= 1) M.timers.push(rec); }
    }, ms);
  };

  for (const name of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
    const Native = window[name];
    if (typeof Native !== 'function') continue;
    window[name] = new Proxy(Native, {
      construct(target, args, newTarget) {
        const t = now();
        const obj = Reflect.construct(target, args, newTarget);
        note(name, t, name === 'OfflineAudioContext' ? { length: obj.length } : { state: obj.state, sampleRate: obj.sampleRate });
        return obj;
      },
    });
  }
  const desc = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
  Object.defineProperty(ConvolverNode.prototype, 'buffer', {
    configurable: true, enumerable: desc.enumerable, get: desc.get,
    set(value) { const t = now(); desc.set.call(this, value); note('convolver.buffer', t, { offline: this.context instanceof OfflineAudioContext }); },
  });
  // marks inside buildRig: the limiter curve is computed between createWaveShaper and the curve setter, the impulse
  // between createBuffer(2 channels) and createConvolver, the noise after createBuffer(1 channel)
  for (const name of ['createBuffer', 'createConvolver', 'createWaveShaper']) {
    const native = BaseAudioContext.prototype[name];
    BaseAudioContext.prototype[name] = function () {
      const t = now();
      const out = native.apply(this, arguments);
      if (!(this instanceof OfflineAudioContext)) note(name === 'createBuffer' ? `createBuffer:${arguments[0]}` : name, t, {});
      return out;
    };
  }
  const curveDesc = Object.getOwnPropertyDescriptor(WaveShaperNode.prototype, 'curve');
  Object.defineProperty(WaveShaperNode.prototype, 'curve', {
    configurable: true, enumerable: curveDesc.enumerable, get: curveDesc.get,
    set(value) { const t = now(); curveDesc.set.call(this, value); note('shaper.curve', t, {}); },
  });
  const nativeRender = OfflineAudioContext.prototype.startRendering;
  OfflineAudioContext.prototype.startRendering = function () {
    const t = now();
    const p = nativeRender.apply(this, arguments);
    const rec = note('startRendering', t, { done: null });
    p.then(() => { rec.done = now(); }, () => { rec.done = -1; });
    return p;
  };
  const nativeResume = AudioContext.prototype.resume;
  AudioContext.prototype.resume = function () {
    const t = now();
    const before = this.state;
    const p = nativeResume.apply(this, arguments);
    const rec = note('resume', t, { before, done: null });
    p.then(() => { rec.done = now(); }, () => { rec.done = -1; });
    return p;
  };
  const wrapStart = (proto, kindOf) => {
    const native = proto.start;
    proto.start = function () {
      if (!(this.context instanceof OfflineAudioContext)) M.starts.push({ t: now(), kind: kindOf(this) });
      return native.apply(this, arguments);
    };
  };
  wrapStart(AudioScheduledSourceNode.prototype, () => 'osc');
  if (Object.hasOwn(AudioBufferSourceNode.prototype, 'start')) wrapStart(AudioBufferSourceNode.prototype, node => (node.loop ? 'noise' : 'buffer'));

  try { new PerformanceObserver(list => { for (const e of list.getEntries()) M.longtasks.push({ t: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) M.events.push({ name: e.name, t: e.startTime, ms: e.duration, ps: e.processingStart, pe: e.processingEnd });
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch { /* not supported */ }
  window.addEventListener('audio:unlocked', () => { M.marks.unlockedEvent = now(); });
};

const r1 = x => Math.round(x * 10) / 10;

/** The tasks of the page's main thread from a Chrome trace, on the page's own clock (ms). */
function mainThreadTasks(traceBuffer, markName, markPerfNow) {
  const trace = JSON.parse(traceBuffer.toString('utf8'));
  const events = Array.isArray(trace) ? trace : trace.traceEvents;
  const mark = events.find(e => e.name === markName && (e.cat ?? '').includes('blink.user_timing'));
  if (!mark) return { tasks: null, why: 'no mark in the trace' };
  const toPage = ts => (ts - mark.ts) / 1000 + markPerfNow;
  let tasks = events.filter(e => e.pid === mark.pid && e.tid === mark.tid && e.ph === 'X' && e.name === 'RunTask');
  if (tasks.length === 0) tasks = events.filter(e => e.pid === mark.pid && e.tid === mark.tid && e.ph === 'X' && /RunTask/.test(e.name));
  return { tasks: tasks.map(e => ({ t: toPage(e.ts), ms: (e.dur ?? 0) / 1000 })).sort((a, b) => a.t - b.t), why: null };
}

export default async ({ page, shot, context }) => {
  const browser = context.browser();
  await context.addInitScript(INSTRUMENT);
  const url = page.url();
  const runs = [];
  let variant = VARIANTS[0];
  await page.route('**/src/ui/audio.js', route => (variant.path ? route.fulfill({ path: variant.path, contentType: 'text/javascript; charset=utf-8' }) : route.continue()));
  for (let run = 0; run < RUNS * VARIANTS.length; run++) {
    variant = VARIANTS[run % VARIANTS.length];
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(DELAY);                      // fonts, first paint, idle
    // where to tap
    const target = PAGE === 'stage'
      ? page.locator('dialog[data-dialog="start"] button[data-choice="new"], [data-dialog="start"] button[data-choice="new"]').first()
      : page.locator('[data-sfx="place"]').first();
    await target.waitFor({ state: 'visible', timeout: 5000 });
    const box = await target.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (run === 0) await shot(`${PAGE}-before-tap`);

    // page-side hooks that need the page's own objects
    await page.evaluate(({ PAGE, PLAY }) => {
      const M = window.__m;
      if (PAGE === 'stage' && window.__dev) {
        const real = window.__dev.real;
        const nativeReset = real.reset;
        real.reset = function (...args) { if (M.marks.reset === undefined) M.marks.reset = performance.now(); return nativeReset.apply(this, args); };
      }
      if (PAGE === 'audio' && window.__desk) {
        // the promise of unlock(), as a second caller in the same gesture sees it
        window.addEventListener('pointerdown', () => {
          if (M.marks.unlockCalled !== undefined) return;
          M.marks.unlockCalled = performance.now();
          window.__desk.audio().unlock().then(ok => { M.marks.unlockResolved = performance.now(); M.marks.unlockValue = ok; });
        }, true);
        if (PLAY) {
          const count = fn => { const n = M.starts.length; fn(); return M.starts.slice(n).reduce((acc, s) => { acc[s.kind] = (acc[s.kind] ?? 0) + 1; return acc; }, {}); };
          window.addEventListener('audio:unlocked', () => {
            M.marks.dealAtUnlock = count(() => window.__desk.audio().play('deal'));
            M.marks.dealAtUnlockT = performance.now();
            window.setTimeout(() => { M.marks.dealLater = count(() => window.__desk.audio().play('deal')); M.marks.dealLaterT = performance.now(); }, 1200);
          });
        }
      }
    }, { PAGE, PLAY });

    await browser.startTracing(page, { categories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'] });
    const markPerfNow = await page.evaluate(() => { const t = performance.now(); performance.mark('xd-tap'); return t; });
    if (INPUT === 'touch') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await page.waitForTimeout(2300);
    const traceBuffer = await browser.stopTracing();
    if (run === 0) await shot(`${PAGE}-after-tap`);

    const M = await page.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
    const { tasks, why } = mainThreadTasks(traceBuffer, 'xd-tap', markPerfNow);

    // ---- the gesture: every dispatch of its events, by (type, timeStamp) ----
    const dispatches = new Map();
    for (const h of M.handlers) {
      if (h.t < markPerfNow) continue;
      const key = `${h.label}@${h.stamp}`;
      const d = dispatches.get(key) ?? { type: h.label, t: h.t, end: h.t + h.ms, ms: 0, listeners: 0 };
      d.ms += h.ms; d.listeners++; d.end = Math.max(d.end, h.t + h.ms);
      dispatches.set(key, d);
    }
    const within = (c, d) => c.t >= d.t - 0.01 && c.t <= d.end + 0.01;
    const gesture = [...dispatches.values()].sort((a, b) => a.t - b.t).map(d => {
      const inside = M.calls.filter(c => within(c, d));
      const sum = what => inside.filter(c => c.what === what).reduce((s, c) => s + c.ms, 0);
      const n = what => inside.filter(c => c.what === what).length;
      const ctor = sum('AudioContext') + sum('webkitAudioContext');
      return {
        type: d.type, at: r1(d.t - markPerfNow), handlerMs: r1(d.ms), listeners: d.listeners,
        ctorMs: r1(ctor), ctxState: inside.find(c => c.what === 'AudioContext')?.state ?? null,
        handlerMinusCtorMs: r1(d.ms - ctor),
        convolverSets: n('convolver.buffer'), convolverMs: r1(sum('convolver.buffer')),
        offlineCtors: n('OfflineAudioContext'), offlineCtorMs: r1(sum('OfflineAudioContext')),
        startRenderings: n('startRendering'), resumes: n('resume'),
      };
    });
    const firstDown = gesture.find(g => g.type === 'pointerdown');
    const t0 = firstDown ? firstDown.at + markPerfNow : markPerfNow;
    const downDispatch = [...dispatches.values()].filter(d => d.type === 'pointerdown').sort((a, b) => a.t - b.t)[0];
    const timeline = downDispatch ? M.calls.filter(c => within(c, downDispatch)).map(c => ({ what: c.what + (c.offline ? ':offline' : ''), at: r1(c.t - t0), ms: r1(c.ms) })) : [];
    // the parts of buildRig (see the wrappers)
    const at = what => M.calls.find(c => c.what === what && downDispatch && within(c, downDispatch));
    const parts = {};
    if (at('createWaveShaper') && at('shaper.curve')) parts.limiterCurveMs = r1(at('shaper.curve').t - (at('createWaveShaper').t + at('createWaveShaper').ms));
    const liveConv = M.calls.find(c => c.what === 'convolver.buffer' && !c.offline && downDispatch && within(c, downDispatch));
    // from the limiter's curve to the convolver: computing (or copying) the impulse, and four small nodes
    if (at('shaper.curve') && at('createConvolver')) parts.impulseMs = r1(at('createConvolver').t - (at('shaper.curve').t + at('shaper.curve').ms));
    if (liveConv) parts.liveConvolverMs = r1(liveConv.ms);
    // from the convolver's buffer to the end of buildRig: computing (or copying) the noise
    const rigEnd = Math.min(M.marks.unlockedEvent ?? Infinity, downDispatch ? downDispatch.end : Infinity,
      ...M.calls.filter(c => downDispatch && within(c, downDispatch) && at('createBuffer:1') && c.t > at('createBuffer:1').t + 0.001).map(c => c.t));
    if (liveConv && Number.isFinite(rigEnd)) parts.noiseMs = r1(rigEnd - (liveConv.t + liveConv.ms));
    const ctorRec = M.calls.find(c => (c.what === 'AudioContext' || c.what === 'webkitAudioContext') && downDispatch && within(c, downDispatch));
    if (ctorRec && Number.isFinite(rigEnd)) parts.buildRigMs = r1(rigEnd - (ctorRec.t + ctorRec.ms));

    // ---- audio set-up outside the gesture's listeners: by main-thread task ----
    const audioCalls = M.calls.filter(c => c.t >= markPerfNow && ['OfflineAudioContext', 'convolver.buffer', 'startRendering', 'AudioContext'].includes(c.what));
    const tasksAfter = (tasks ?? []).filter(k => k.t + k.ms >= markPerfNow && k.t <= t0 + 2000);
    const tasksOver = min => tasksAfter.filter(k => k.ms >= min).map(k => {
      const calls = audioCalls.filter(c => c.t >= k.t - 0.05 && c.t <= k.t + k.ms + 0.05);
      const types = [...dispatches.values()].filter(d => d.t >= k.t - 0.05 && d.t <= k.t + k.ms + 0.05).map(d => d.type);
      return { at: r1(k.t - t0), ms: r1(k.ms), audio: calls.length > 0, what: [...new Set(calls.map(c => c.what))].join('+') || null, events: [...new Set(types)].join('+') || null };
    });
    const audioTimers = M.timers.filter(k => k.audio && k.t >= markPerfNow).map(k => ({ at: r1(k.t - t0), ms: r1(k.ms) }));
    const renders = M.calls.filter(c => c.what === 'startRendering' && c.t >= markPerfNow);
    const done = renders.map(c => c.done).filter(v => typeof v === 'number' && v > 0);
    const resumes = M.calls.filter(c => c.what === 'resume' && c.t >= markPerfNow).map(c => ({ at: r1(c.t - t0), in: c.in, before: c.before, doneAt: c.done > 0 ? r1(c.done - t0) : c.done }));
    const liveStarts = M.starts.filter(s => s.t >= markPerfNow);
    const bursts = [];
    for (const s of liveStarts) {
      const last = bursts.at(-1);
      if (last && s.t - last.t1 < 3) { last.t1 = s.t; last[s.kind] = (last[s.kind] ?? 0) + 1; } else bursts.push({ t0: s.t, t1: s.t, [s.kind]: 1 });
    }

    runs.push({
      run, variant: variant.name, gesture,
      pointerdown: firstDown ?? null, parts, timeline: timeline.length > 40 ? [...timeline.slice(0, 14), { what: '...', n: timeline.length - 14 }] : timeline,
      unlockedEventAt: M.marks.unlockedEvent !== undefined ? r1(M.marks.unlockedEvent - t0) : null,
      resumes,
      rendersStarted: renders.length,
      rendersStartedAt: renders.map(c => r1(c.t - t0)),
      renderMs: renders.map(c => (c.done > 0 ? r1(c.done - c.t) : null)),          // in the order win, deal, check.give, check.take, blast, stamp
      buffersReadyAt: done.map(v => r1(v - t0)).sort((a, b) => a - b),
      allBuffersAt: done.length === 6 ? r1(Math.max(...done) - t0) : null,
      audioTimers,
      audioTasks: tasksOver(0).filter(k => k.audio),
      tasksOver8: tasksOver(8),
      longtasks: M.longtasks.filter(k => k.t + k.ms >= markPerfNow && k.t <= t0 + 2000).map(k => ({ at: r1(k.t - t0), ms: r1(k.ms) })),
      eventEntries: M.events.filter(e => e.t >= markPerfNow - 1).map(e => ({ name: e.name, at: r1(e.t - t0), duration: e.ms, processingMs: r1(e.pe - e.ps), inputDelayMs: r1(e.ps - e.t) })),
      unlockResolvedAt: M.marks.unlockResolved !== undefined ? r1(M.marks.unlockResolved - t0) : null,
      resetAt: M.marks.reset !== undefined ? r1(M.marks.reset - t0) : null,
      sourceBursts: bursts.slice(0, 6).map(b => ({ at: r1(b.t0 - t0), osc: b.osc ?? 0, noise: b.noise ?? 0, buffer: b.buffer ?? 0 })),
      play: PLAY ? { atUnlock: M.marks.dealAtUnlock ?? null, atUnlockT: M.marks.dealAtUnlockT !== undefined ? r1(M.marks.dealAtUnlockT - t0) : null, later: M.marks.dealLater ?? null, laterT: M.marks.dealLaterT !== undefined ? r1(M.marks.dealLaterT - t0) : null } : undefined,
      errors: M.errors, traceNote: why,
    });
  }

  // ---- summary: median and worst over the runs ----
  const med = list => { const a = list.filter(v => typeof v === 'number').sort((p, q) => p - q); return a.length ? r1(a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
  const worst = list => { const a = list.filter(v => typeof v === 'number'); return a.length ? r1(Math.max(...a)) : null; };
  const both = list => ({ median: med(list), worst: worst(list), all: list });
  const summarise = (runs, name) => {
  const down = runs.map(r => r.pointerdown);
  const sumOf = (r, type, key) => r.gesture.filter(g => g.type === type).reduce((s, g) => s + g[key], 0);
  return {
    variant: name, page: PAGE, input: INPUT, runs: runs.length,
    pointerdownHandlerMs: both(down.map(d => d?.handlerMs)),
    pointerdownCtorMs: both(down.map(d => d?.ctorMs)),
    pointerdownMinusCtorMs: both(down.map(d => d?.handlerMinusCtorMs)),
    pointerdownConvolverSets: both(down.map(d => d?.convolverSets)),
    pointerdownConvolverMs: both(down.map(d => d?.convolverMs)),
    pointerdownOfflineCtors: both(down.map(d => d?.offlineCtors)),
    buildRigMs: both(runs.map(r => r.parts.buildRigMs)),
    impulseMs: both(runs.map(r => r.parts.impulseMs)),
    noiseMs: both(runs.map(r => r.parts.noiseMs)),
    limiterCurveMs: both(runs.map(r => r.parts.limiterCurveMs)),
    liveConvolverMs: both(runs.map(r => r.parts.liveConvolverMs)),
    ctxStateAfterCtor: runs.map(r => r.pointerdown?.ctxState),
    pointerupHandlerMs: both(runs.map(r => r1(sumOf(r, 'pointerup', 'handlerMs')))),
    clickHandlerMs: both(runs.map(r => r1(sumOf(r, 'click', 'handlerMs')))),
    longestAudioTaskAfterGestureMs: both(runs.map(r => worst(r.audioTasks.filter(k => !k.events || !/pointerdown/.test(k.events)).map(k => k.ms)) ?? 0)),
    longestTaskWithin2sMs: both(runs.map(r => worst(r.tasksOver8.map(k => k.ms)) ?? 0)),
    longtaskEntries: both(runs.map(r => r.longtasks.length)),
    longtaskTotalMs: both(runs.map(r => r1(r.longtasks.reduce((s, k) => s + k.ms, 0)))),
    allBuffersAtMs: both(runs.map(r => r.allBuffersAt)),
    firstBufferAtMs: both(runs.map(r => r.buffersReadyAt[0])),
    slowestRenderMs: both(runs.map(r => worst(r.renderMs))),
    audioTimerTasks: both(runs.map(r => r.audioTimers.length)),
    longestAudioTimerMs: both(runs.map(r => worst(r.audioTimers.map(k => k.ms)) ?? 0)),
    unlockResolvedAtMs: both(runs.map(r => r.unlockResolvedAt)),
    resetAtMs: both(runs.map(r => r.resetAt)),
    errors: runs.flatMap(r => r.errors),
  };
  };
  const summaries = VARIANTS.map(v => summarise(runs.filter(r => r.variant === v.name), v.name));
  const summary = summaries[0];
  if (OUT) writeFileSync(OUT, JSON.stringify({ summary, summaries, runs }, null, 1));
};
