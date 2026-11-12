// Shared scratch lab: runs audio.js on an OfflineAudioContext inside the page. Used by experiment step files.
export const LAB = `
window.lab = async () => {
  const { createAudio } = await import('/src/ui/audio.js?x=' + Date.now());
  const SR = 44100;
  const dB = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const realTimeout = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window), Native = window.AudioContext;
  const clock = { now: 0, seq: 1, timers: new Map() };
  const virtual = on => {
    if (on) { window.setTimeout = (fn, ms = 0) => { const id = -(clock.seq++); clock.timers.set(id, { at: clock.now + Math.max(0, ms), fn }); return id; }; window.clearTimeout = id => { if (!clock.timers.delete(id)) realClear(id); }; }
    else { window.setTimeout = realTimeout; window.clearTimeout = realClear; }
  };
  const advance = ms => { for (;;) { let next = null; for (const [id, t] of clock.timers) if (t.at <= ms && (!next || t.at < next[1].at)) next = [id, t]; if (!next) break; clock.timers.delete(next[0]); clock.now = next[1].at; next[1].fn(); } clock.now = ms; };
  const stats = (buffer, from = 0, to = buffer.duration) => {
    const a = buffer.getChannelData(0), b = buffer.getChannelData(1);
    const i0 = Math.floor(from * SR), i1 = Math.min(a.length, Math.ceil(to * SR));
    let peak = 0, sum = 0, first = -1, last = -1, at = 0;
    for (let i = i0; i < i1; i++) { const v = Math.max(Math.abs(a[i]), Math.abs(b[i])); if (v > peak) { peak = v; at = i; } sum += a[i] * a[i]; if (v > 0.001) { last = i; if (first < 0) first = i; } }
    return { peak: +dB(peak).toFixed(2), rms: +dB(Math.sqrt(sum / (i1 - i0))).toFixed(2), ms: first < 0 ? 0 : Math.round((last - first) / SR * 1000), peakAt: +(at / SR).toFixed(4) };
  };
  const render = async ({ seconds, palette = 'chibi', stepped = false, seed = 7, job }) => {
    const off = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
    const facade = new Proxy(off, { get(target, prop) {
      if (prop === 'state') return 'running';
      if (prop === 'resume' || prop === 'suspend' || prop === 'close') return () => Promise.resolve();
      if (prop === 'addEventListener' || prop === 'removeEventListener') return () => {};
      const v = Reflect.get(target, prop, target); return typeof v === 'function' ? v.bind(target) : v; } });
    window.AudioContext = function () { return facade; };
    virtual(true); clock.now = 0; clock.timers.clear();
    const realRandom = Math.random; let s = seed >>> 0; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const audio = createAudio(); audio.setPalette(palette);
    const t0 = performance.now(); await audio.unlock(); const unlockMs = performance.now() - t0;
    job(audio);
    if (stepped) { const step = 0.1; const stopAt = t => off.suspend(t).then(() => { advance(t * 1000); if (t + step < seconds - 0.05) stopAt(t + step); return off.resume(); }); stopAt(step); }
    const buffer = await off.startRendering();
    audio.dispose(); Math.random = realRandom; window.AudioContext = Native; virtual(false);
    return { buffer, unlockMs };
  };
  return { render, stats, SR, dB };
};
`;
