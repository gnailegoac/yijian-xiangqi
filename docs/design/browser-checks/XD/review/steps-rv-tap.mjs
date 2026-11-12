// XD review: the reviewer's own measurement of the first tap (CONTRACT-NOTES M-121). A steps file for tools/shot.mjs.
// Independent of the engineer's steps-tap.mjs: its own wrappers, and the handler time is cross-checked with the
// browser's own 'first-input' / 'event' performance entries (processingEnd - processingStart).
//
//   RV_PAGE    stage | audio
//   RV_INPUT   touch | mouse
//   RV_RUNS    fresh pages per variant (default 6)
//   RV_BEFORE  path of the reviewed audio.js (the "before" variant); empty: only the repo's file is measured
//   RV_OUT     JSON file
//   RV_THROTTLE  CPU throttling rate (1 = none)
//   RV_DELAY   ms between load and the tap (default 1500)
import { writeFileSync } from 'node:fs';

const PAGE = process.env.RV_PAGE ?? 'stage';
const INPUT = process.env.RV_INPUT ?? 'touch';
const RUNS = Number(process.env.RV_RUNS ?? 6);
const BEFORE = process.env.RV_BEFORE ?? '';
const OUT = process.env.RV_OUT;
const THROTTLE = Number(process.env.RV_THROTTLE ?? 1);
const DELAY = Number(process.env.RV_DELAY ?? 1500);

const INIT = () => {
  const now = () => performance.now();
  const R = (window.__rv = { spans: [], calls: [], timers: [], long: [], entries: [], starts: [], marks: {}, rejections: [] });
  window.addEventListener('unhandledrejection', e => R.rejections.push(String(e.reason)));
  // 1. every listener of the gesture's events: [type, start, end]
  const WATCH = new Set(['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'mousedown', 'mouseup']);
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const map = new WeakMap();
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (!WATCH.has(type) || typeof fn !== 'function') return add.call(this, type, fn, opts);
    let per = map.get(fn);
    if (!per) map.set(fn, (per = {}));
    per[type] ??= function (...args) {
      const t = now();
      try { return fn.apply(this, args); } finally { R.spans.push({ type, t, e: now(), stamp: args[0]?.timeStamp }); }
    };
    return add.call(this, type, per[type], opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    return remove.call(this, type, (typeof fn === 'function' && map.get(fn)?.[type]) || fn, opts);
  };
  // 2. the audio set-up calls
  const call = (what, t, extra) => { const rec = { what, t, e: now(), ...extra }; R.calls.push(rec); return rec; };
  for (const name of ['AudioContext', 'OfflineAudioContext']) {
    const Native = window[name];
    window[name] = new Proxy(Native, {
      construct(target, args, nt) { const t = now(); const o = Reflect.construct(target, args, nt); call(name, t, { state: o.state, rate: o.sampleRate }); return o; },
    });
  }
  const d = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
  Object.defineProperty(ConvolverNode.prototype, 'buffer', {
    configurable: true, enumerable: d.enumerable, get: d.get,
    set(v) { const t = now(); d.set.call(this, v); call('convolver', t, { offline: this.context instanceof OfflineAudioContext }); },
  });
  const render = OfflineAudioContext.prototype.startRendering;
  OfflineAudioContext.prototype.startRendering = function (...args) {
    const t = now();
    const p = render.apply(this, args);
    const rec = call('render', t, { done: null, seconds: this.length / this.sampleRate });
    p.then(() => { rec.done = now(); }, () => { rec.done = -1; });
    return p;
  };
  const resume = AudioContext.prototype.resume;
  AudioContext.prototype.resume = function (...args) {
    const t = now();
    const before = this.state;
    const p = resume.apply(this, args);
    const rec = call('resume', t, { before, done: null });
    p.then(() => { rec.done = now(); }, () => { rec.done = -1; });
    return p;
  };
  // 3. every timer callback: its own time, and the time to the end of the microtasks it left
  const st = window.setTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    if (typeof fn !== 'function') return st.call(window, fn, ms, ...args);
    return st.call(window, function () {
      const rec = { t: now(), e: 0, m: 0, delay: ms ?? 0 };
      const n = R.calls.length;
      try { return fn.apply(this, args); } finally {
        rec.e = now();
        rec.audio = R.calls.slice(n).map(c => c.what).join('+');
        Promise.resolve().then(() => { rec.m = now(); });
        if (rec.audio || rec.e - rec.t >= 1) R.timers.push(rec);
      }
    }, ms);
  };
  // 4. sources started on the live context
  const wrap = (proto, kind) => {
    const native = proto.start;
    proto.start = function (...args) {
      if (!(this.context instanceof OfflineAudioContext)) R.starts.push({ t: now(), kind: kind(this) });
      return native.apply(this, args);
    };
  };
  wrap(AudioScheduledSourceNode.prototype, () => 'osc');
  if (Object.hasOwn(AudioBufferSourceNode.prototype, 'start')) wrap(AudioBufferSourceNode.prototype, n => (n.loop ? 'noise' : 'buffer'));
  // 5. what the browser itself says
  const watch = (type, extra) => {
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) R[type === 'longtask' ? 'long' : 'entries'].push({ type, name: e.name, t: e.startTime, ms: e.duration, ps: e.processingStart, pe: e.processingEnd });
      }).observe({ type, buffered: true, ...extra });
    } catch { /* not supported */ }
  };
  watch('longtask');
  watch('first-input');
  watch('event', { durationThreshold: 16 });
  window.addEventListener('audio:unlocked', () => { R.marks.unlocked = now(); });
};


// RV_GATE=1: the context behaves as on an iPad whose finger is still down: created 'suspended', resume() pending,
// until the first pointerup / touchend / click / keyup of the page; then it runs and says so in a statechange event.
const GATE = delay => {
  const Native = window.AudioContext;
  const later = window.setTimeout.bind(window);
  let open = false;
  const waiting = [];
  let lifting = false;
  const openNow = () => { open = true; window.__gateAt = performance.now(); for (const fn of waiting.splice(0)) fn(); };
  const lift = () => { if (open || lifting) return; lifting = true; if (delay > 0) later(openNow, delay); else openNow(); };
  for (const type of ['pointerup', 'touchend', 'mouseup', 'keyup', 'click']) window.addEventListener(type, lift, true);
  const nativeResume = Native.prototype.resume;
  const stateDesc = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state');
  window.AudioContext = class GatedContext extends Native {
    constructor(...args) {
      super(...args);
      if (!open) {
        let gated = true;
        Object.defineProperty(this, 'state', { configurable: true, get: () => (gated ? 'suspended' : stateDesc.get.call(this)) });
        waiting.push(() => { gated = false; this.dispatchEvent(new Event('statechange')); });
      }
    }
    resume() {
      if (open) return nativeResume.call(this);
      return new Promise((resolve, reject) => { waiting.push(() => nativeResume.call(this).then(resolve, reject)); });
    }
  };
};

const r1 = x => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);
const median = list => { const a = list.filter(v => typeof v === 'number').sort((p, q) => p - q); return a.length ? r1(a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const worst = list => { const a = list.filter(v => typeof v === 'number'); return a.length ? r1(Math.max(...a)) : null; };

export default async ({ page, shot, context }) => {
  if (process.env.RV_GATE === '1') await context.addInitScript(GATE, Number(process.env.RV_GATE_DELAY ?? 0));   // GATE_DELAY: ms between the lifted finger and the running context
  await context.addInitScript(INIT);
  const variants = BEFORE ? [{ name: 'before', path: BEFORE }, { name: 'after', path: '' }] : [{ name: 'after', path: '' }];
  let variant = variants[0];
  await page.route('**/src/ui/audio.js', route => (variant.path ? route.fulfill({ path: variant.path, contentType: 'text/javascript; charset=utf-8' }) : route.continue()));
  const cdp = await context.newCDPSession(page);
  const url = page.url();
  const runs = [];
  for (let i = 0; i < RUNS * variants.length; i++) {
    variant = variants[i % variants.length];
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(DELAY);
    const target = PAGE === 'stage' ? page.locator('[data-dialog="start"] button[data-choice="new"]').first() : page.locator('[data-sfx="deal"]').first();
    await target.waitFor({ state: 'visible', timeout: 5000 });
    if (PAGE === 'audio') await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await page.evaluate(PAGE => {
      const R = window.__rv;
      if (PAGE === 'stage') {
        const real = window.__dev.real;
        const reset = real.reset;
        real.reset = function (...args) { R.marks.reset ??= performance.now(); return reset.apply(this, args); };
      }
    }, PAGE);
    if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    const t0 = await page.evaluate(() => performance.now());
    const INPUT_ = INPUT;
    if (INPUT === 'touch') await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(PAGE === 'audio' ? 1300 : 2600);
    let secondTapAt = null;
    if (PAGE === 'audio') {
      // a second tap on the same pad, after the stingers are ready: one buffer source
      secondTapAt = await page.evaluate(() => performance.now());
      if (INPUT === 'touch') await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(900);
    }
    if (i < variants.length) await shot(`${PAGE}-${variant.name}-after-tap`);
    const R = await page.evaluate(() => JSON.parse(JSON.stringify(window.__rv)));

    // the dispatch that created the AudioContext: all listeners of that event (same type and timeStamp)
    const ctor = R.calls.find(c => c.what === 'AudioContext' && c.t >= t0);
    const host = ctor && R.spans.find(s => s.t <= ctor.t && s.e >= ctor.e);
    const same = host ? R.spans.filter(s => s.type === host.type && s.stamp === host.stamp) : [];
    const from = same.length ? Math.min(...same.map(s => s.t)) : null;
    const to = same.length ? Math.max(...same.map(s => s.e)) : null;
    const inside = c => from !== null && c.t >= from && c.e <= to + 0.01;
    const inHandler = R.calls.filter(inside);
    const sum = list => list.reduce((s, c) => s + (c.e - c.t), 0);
    const handlerMs = same.reduce((s, x) => s + (x.e - x.t), 0);
    const ctorMs = ctor ? ctor.e - ctor.t : null;
    // the browser's own account of that event
    const entry = R.entries.find(e => host && e.name === host.type && Math.abs(e.t - host.stamp) < 1.5) ?? null;
    const firstInput = R.entries.find(e => e.type === 'first-input') ?? null;
    const renders = R.calls.filter(c => c.what === 'render' && c.t >= t0);
    const dones = renders.map(c => c.done).filter(v => v > 0);
    const timers = R.timers.filter(k => k.t >= t0 && k.audio && /Offline|render|convolver/.test(k.audio));
    const afterGesture = R.calls.filter(c => c.t >= t0 && !inside(c) && ['OfflineAudioContext', 'convolver', 'render'].includes(c.what));
    // was any audio set-up done in a microtask or event listener rather than a timer task?
    const notInTimer = afterGesture.filter(c => !R.timers.some(k => c.t >= k.t && c.e <= k.e + 0.01));
    // the deal of the first game (stage) / the tapped pad (audio): the burst of sources that starts first
    const starts = R.starts.filter(s => s.t >= t0);
    const bursts = [];
    for (const s of starts) {
      const last = bursts.at(-1);
      if (last && s.t - last.e < 3) { last.e = s.t; last[s.kind]++; } else bursts.push({ t: s.t, e: s.t, osc: 0, noise: 0, buffer: 0, [s.kind]: 1 });
    }
    const base = from ?? t0;
    const bigBurst = bursts.find(b => b.buffer >= 1 && b.osc + b.noise === 0) ?? null;
    const liveBurst = bursts.find(b => b.osc + b.noise >= 40) ?? null;
    runs.push({
      variant: variant.name,
      hostEvent: host?.type ?? null, ctxStateAfterCtor: ctor?.state ?? null, sampleRate: ctor?.rate ?? null,
      handlerMs: r1(handlerMs), ctorMs: r1(ctorMs), handlerMinusCtorMs: ctorMs === null ? null : r1(handlerMs - ctorMs),
      browserProcessingMs: entry ? r1(entry.pe - entry.ps) : null,
      firstInput: firstInput ? { name: firstInput.name, processingMs: r1(firstInput.pe - firstInput.ps), delayMs: r1(firstInput.ps - firstInput.t) } : null,
      convolverSetsInHandler: inHandler.filter(c => c.what === 'convolver').length,
      convolverMsInHandler: r1(sum(inHandler.filter(c => c.what === 'convolver'))),
      offlineCtorsInHandler: inHandler.filter(c => c.what === 'OfflineAudioContext').length,
      rendersStartedInHandler: inHandler.filter(c => c.what === 'render').length,
      resumesInHandler: inHandler.filter(c => c.what === 'resume').map(c => c.before),
      unlockedEventAt: R.marks.unlocked ? r1(R.marks.unlocked - base) : null,
      unlockedIn: (R.spans.find(sp => R.marks.unlocked >= sp.t && R.marks.unlocked <= sp.e) ?? {}).type ?? null,
      setupNotInTimerIn: [...new Set(notInTimer.map(c => (R.spans.find(sp => c.t >= sp.t && c.e <= sp.e + 0.01) ?? {}).type ?? 'no listener'))].join(','),
      spansMs: Object.fromEntries(['pointerdown', 'pointerup', 'click', 'touchend'].map(type => [type, r1(R.spans.filter(sp => sp.type === type && sp.t >= t0).reduce((a, sp) => a + (sp.e - sp.t), 0))])),
      setupCallsAfterGesture: afterGesture.length, setupCallsNotInATimerTask: notInTimer.length,
      timerTasks: timers.length,
      timerTaskMs: timers.map(k => r1(k.e - k.t)),
      timerTaskWithMicrotasksMs: timers.map(k => r1(Math.max(k.m, k.e) - k.t)),
      timerTaskWhat: timers.map(k => k.audio),
      firstTimerAt: timers.length ? r1(timers[0].t - base) : null,
      longestTimerTaskMs: worst(timers.map(k => Math.max(k.m, k.e) - k.t)) ?? 0,
      rendersStartedAt: renders.map(c => r1(c.t - base)),
      renderMs: renders.map(c => (c.done > 0 ? r1(c.done - c.t) : null)),
      allBuffersAt: dones.length === 6 ? r1(Math.max(...dones) - base) : null,
      resetAt: R.marks.reset ? r1(R.marks.reset - base) : null,
      longtasks: R.long.filter(k => k.t + k.ms >= t0 && k.t <= base + 2000).map(k => ({ at: r1(k.t - base), ms: r1(k.ms) })),
      eventEntries: R.entries.filter(e => e.type === 'event' && e.t >= t0 - 1).map(e => ({ name: e.name, duration: e.ms, processingMs: r1(e.pe - e.ps) })),
      firstBurst: bursts[0] ? { at: r1(bursts[0].t - base), osc: bursts[0].osc, noise: bursts[0].noise, buffer: bursts[0].buffer } : null,
      bufferOnlyBurstAt: bigBurst ? r1(bigBurst.t - base) : null,
      liveStingerBurstAt: liveBurst ? r1(liveBurst.t - base) : null,
      secondTap: secondTapAt === null ? null : bursts.filter(b => b.t >= secondTapAt).map(b => ({ osc: b.osc, noise: b.noise, buffer: b.buffer })),
      rejections: R.rejections,
    });
  }
  const summary = variants.map(v => {
    const rs = runs.filter(r => r.variant === v.name);
    const both = key => ({ median: median(rs.map(r => r[key])), worst: worst(rs.map(r => r[key])) });
    return {
      variant: v.name, page: PAGE, input: INPUT, throttle: THROTTLE, runs: rs.length,
      hostEvent: [...new Set(rs.map(r => r.hostEvent))].join(','), ctxStateAfterCtor: [...new Set(rs.map(r => r.ctxStateAfterCtor))].join(','),
      sampleRate: [...new Set(rs.map(r => r.sampleRate))].join(','),
      handlerMs: both('handlerMs'), ctorMs: both('ctorMs'), handlerMinusCtorMs: both('handlerMinusCtorMs'), browserProcessingMs: both('browserProcessingMs'),
      convolverSetsInHandler: both('convolverSetsInHandler'), convolverMsInHandler: both('convolverMsInHandler'),
      offlineCtorsInHandler: both('offlineCtorsInHandler'), rendersStartedInHandler: both('rendersStartedInHandler'),
      setupCallsNotInATimerTask: both('setupCallsNotInATimerTask'),
      timerTasks: both('timerTasks'), longestTimerTaskMs: both('longestTimerTaskMs'), firstTimerAt: both('firstTimerAt'),
      longtaskCount: { median: median(rs.map(r => r.longtasks.length)), worst: worst(rs.map(r => r.longtasks.length)) },
      longtaskWorstMs: worst(rs.flatMap(r => r.longtasks.map(k => k.ms))),
      allBuffersAt: both('allBuffersAt'), resetAt: both('resetAt'),
      firstBurst: rs.map(r => (r.firstBurst ? `${r.firstBurst.osc + r.firstBurst.noise}live+${r.firstBurst.buffer}buf@${r.firstBurst.at}` : '-')),
      rejections: rs.flatMap(r => r.rejections),
    };
  });
  if (OUT) writeFileSync(OUT, JSON.stringify({ summary, runs }, null, 1));
};
