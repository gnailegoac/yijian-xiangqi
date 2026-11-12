// Reviewer's independent measurement of src/ui/audio.js: the real engine rendered through an OfflineAudioContext.
// Run with shot.mjs --url http://127.0.0.1:5234/dev/audio.html --steps <this>; result JSON goes to X4R_OUT.
import { writeFileSync } from 'node:fs';

export default async ({ page }) => {
  const mode = process.env.X4R_MODE ?? 'all';
  const result = await page.evaluate(async mode => {
    const { createAudio, RECIPE_SOURCES, PRERENDERED } = await import('/src/ui/audio.js');
    const SR = 48000;
    const Native = window.AudioContext;
    const realST = window.setTimeout;
    const realCT = window.clearTimeout;
    const realRandom = Math.random;
    const timers = new Map();
    let seq = 1;
    let nowMs = 0;
    const runTimers = toMs => {
      for (;;) {
        let best = null;
        for (const [id, t] of timers) if (t.at <= toMs && (!best || t.at < best[1].at)) best = [id, t];
        if (!best) break;
        timers.delete(best[0]);
        nowMs = best[1].at;
        best[1].fn();
      }
      nowMs = toMs;
    };
    const dB = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    const r1 = x => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

    async function render({ seconds, palette = 'chibi', seed = 1, job, during }) {
      const off = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
      let made = 0;
      const proxy = new Proxy(off, {
        get(target, prop) {
          if (prop === 'state') return 'running';
          if (prop === 'resume' || prop === 'suspend' || prop === 'close') return () => Promise.resolve();
          if (prop === 'addEventListener' || prop === 'removeEventListener') return () => {};
          if (prop === 'createOscillator' || prop === 'createBufferSource') return () => { made++; return target[prop](); };
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      window.AudioContext = function () { return proxy; };
      timers.clear();
      nowMs = 0;
      let s = seed >>> 0;
      Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      window.setTimeout = (fn, ms = 0) => { const id = 1e9 + seq++; timers.set(id, { at: nowMs + (Number(ms) || 0), fn }); return id; };
      window.clearTimeout = id => { if (!timers.delete(id)) realCT(id); };
      let buffer;
      let created = 0;
      try {
        const audio = createAudio();
        audio.setPalette(palette);
        const ok = await audio.unlock();
        if (!ok) throw new Error('unlock failed');
        const before = made;
        job(audio);
        created = made - before;
        const step = 0.05;
        for (let t = step; t < seconds - 0.02; t += step) {
          const at = t;
          off.suspend(at).then(() => { runTimers(at * 1000); if (during) during(audio, at); off.resume(); });
        }
        buffer = await off.startRendering();
        audio.dispose();
      } finally {
        window.setTimeout = realST;
        window.clearTimeout = realCT;
        Math.random = realRandom;
        window.AudioContext = Native;
      }
      return { buffer, created };
    }

    function stats(buffer, from = 0, to = buffer.duration) {
      const a = buffer.getChannelData(0);
      const b = buffer.getChannelData(1);
      const i0 = Math.max(0, Math.floor(from * SR));
      const i1 = Math.min(a.length, Math.ceil(to * SR));
      let peak = 0, sum = 0, first = -1, last = -1, over = 0, bad = 0, hf = 0;
      for (let i = i0; i < i1; i++) {
        const x = a[i], y = b[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) { bad++; continue; }
        const v = Math.max(Math.abs(x), Math.abs(y));
        if (v > peak) peak = v;
        if (v >= 1) over++;
        sum += (x * x + y * y) / 2;
        if (i > i0) { const d = x - a[i - 1]; hf += d * d; }
        if (v > 0.001) { last = i; if (first < 0) first = i; }
      }
      return {
        peak: r1(dB(peak)), rms: r1(dB(Math.sqrt(sum / Math.max(1, i1 - i0)))), hf: r1(dB(Math.sqrt(hf / Math.max(1, i1 - i0)))), over, bad,
        ms: first < 0 ? 0 : Math.round(((last - first) / SR) * 1000), firstMs: first < 0 ? null : Math.round((first / SR) * 1000),
      };
    }

    const out = { sr: SR, sfx: [], bed: [], mix: [], life: {} };
    const TRAVEL = { 'move.rook': 300, 'move.horse': 340, 'move.cannon': 300, 'move.elephant': 300, 'move.advisor': 150, 'move.king': 320, 'move.pawn': 200 };

    if (mode === 'all' || mode === 'sfx') {
      const rows = [];
      for (const name of Object.keys(RECIPE_SOURCES)) {
        rows.push({ label: name, plays: [[name, TRAVEL[name] ? { ms: TRAVEL[name] } : {}]] });
        if (name === 'capture') for (const scale of [0.6, 1.25, 1.4]) rows.push({ label: `capture x${scale}`, plays: [['capture', { scale }]] });
        if (name === 'blast') rows.push({ label: 'cannon.fire + blast@200', plays: [['cannon.fire', {}], ['blast', { when: 0.2 }]] });
        if (name === 'trial.lift') rows.push({ label: 'trial.lift step 4', plays: [['trial.lift', { step: 4 }]] });
      }
      for (const row of rows) {
        const one = async (start, palette) => {
          const r = await render({ seconds: start + 4.5, palette, job: audio => { for (const [n, o] of row.plays) audio.play(n, { ...o, when: start + (o.when ?? 0) }); } });
          return { ...stats(r.buffer), created: r.created };
        };
        const cold = await one(0.045, 'chibi');
        const warm = await one(1.0, 'chibi');
        const lz = await one(1.0, 'longzhong');
        const sc = await one(1.0, 'shachang');
        const single = row.plays.length === 1 ? row.plays[0][0] : null;
        out.sfx.push({
          name: row.label, created: warm.created, table: single ? RECIPE_SOURCES[single] : null, pre: single ? PRERENDERED.includes(single) : null,
          coldPeak: cold.peak, coldMs: cold.ms, warmPeak: warm.peak, warmMs: warm.ms, warmFirst: warm.firstMs, lzPeak: lz.peak, scPeak: sc.peak,
          over: cold.over + warm.over + lz.over + sc.over, bad: cold.bad + warm.bad + lz.bad + sc.bad,
        });
      }
    }

    if (mode === 'all' || mode === 'bed') {
      for (const T of [0.05, 0.3, 0.5, 0.7, 0.95, 1]) {
        const bar = 16 * (60 / (66 + 30 * T) / 4);
        const row = { T, bar: r1(bar) };
        for (const palette of ['chibi', 'longzhong', 'shachang']) {
          const seeds = palette === 'chibi' ? [1, 7, 42] : [7];
          const per = [];
          for (const seed of seeds) {
            const r = await render({ seconds: 0.06 + 8 * bar + 1.5, palette, seed, job: audio => { audio.setTension(T); audio.music.start(); } });
            const firstFour = stats(r.buffer, 0.06, 0.06 + 4 * bar);
            const nextFour = stats(r.buffer, 0.06 + 4 * bar, 0.06 + 8 * bar);
            per.push({ seed, rms4: firstFour.rms, peak4: firstFour.peak, rmsNext4: nextFour.rms, peakNext4: nextFour.peak, over: firstFour.over + nextFour.over, bad: firstFour.bad + nextFour.bad });
          }
          row[palette] = per;
        }
        out.bed.push(row);
      }
      for (const scene of ['victory', 'defeat']) {
        const bpm = scene === 'victory' ? 88 : 60;
        const bar = 16 * (60 / bpm / 4);
        const r = await render({ seconds: 0.4 + 4 * bar + 1.5, seed: 7, job: audio => { audio.music.setScene(scene); audio.music.start(); } });
        const st = stats(r.buffer, 0.06, 0.06 + 4 * bar);
        out.bed.push({ scene, rms4: st.rms, peak4: st.peak });
      }
    }

    if (mode === 'all' || mode === 'mix') {
      const stack = (audio, list, at) => { for (const [n, o] of list) audio.play(n, { ...o, when: at + (o.when ?? 0) }); };
      const mixes = [
        ['contract A: music .95 + cannon.fire + blast@.2 + place@.2 + check.give@.25', 0.95, [['cannon.fire', {}], ['blast', { when: 0.2 }], ['place', { when: 0.2 }], ['check.give', { when: 0.25 }]]],
        ['contract B: music .95 + win', 0.95, [['win', {}]]],
        ['music 1 + capture1.4 + move.king(ms 0) + check.give', 1, [['capture', { scale: 1.4 }], ['move.king', { ms: 0 }], ['check.give', { when: 0.05 }]]],
        ['music 1 + trial.confirm + capture1.25 + place + check.give@.2 + stamp@.4 + praise.brilliant@.4', 1, [['trial.confirm', {}], ['capture', { scale: 1.25 }], ['place', {}], ['check.give', { when: 0.2 }], ['stamp', { when: 0.4 }], ['praise.brilliant', { when: 0.4 }]]],
        ['music 1 + cannon mate: fire, blast@.2, capture1.4@.2, win@.5', 1, [['cannon.fire', {}], ['blast', { when: 0.2 }], ['capture', { scale: 1.4, when: 0.2 }], ['win', { when: 0.5 }]]],
        ['music 1 + deal + turn.yours (game start)', 1, [['deal', {}], ['turn.yours', { when: 0.3 }]]],
        ['music .95 + move.elephant(ms 0) + capture 1.25 + check.take', 0.95, [['move.elephant', { ms: 0 }], ['capture', { scale: 1.25 }], ['check.take', { when: 0.03 }]]],
        ['no music: win + blast + move.king + capture1.4 + trial.confirm same instant (artificial)', -1, [['win', {}], ['blast', {}], ['move.king', { ms: 0 }], ['capture', { scale: 1.4 }], ['trial.confirm', {}]]],
      ];
      for (const [label, T, list] of mixes) {
        const row = { label };
        for (const palette of ['chibi', 'longzhong', 'shachang']) {
          let worst = -Infinity, over = 0;
          for (const at of [2.0, 2.0041, 3.37]) {
            const r = await render({ seconds: at + 4.5, palette, seed: 7, job: audio => { if (T >= 0) { audio.setTension(T); audio.music.start(); } stack(audio, list, at); } });
            const st = stats(r.buffer);
            if (st.peak > worst) worst = st.peak;
            over += st.over;
          }
          row[palette] = worst;
          row[`${palette}Over`] = over;
        }
        out.mix.push(row);
      }
      // a child hammering the board: select / illegal / place every 35 ms for 1.5 s over music at T = 1
      {
        const r = await render({ seconds: 6, seed: 7, job: audio => { audio.setTension(1); audio.music.start(); },
          during: (audio, at) => { if (at > 2 && at < 3.5) { audio.play('select'); audio.play('illegal'); audio.play('place'); audio.play('trial.lift', { step: Math.round(at * 20) }); } } });
        const st = stats(r.buffer);
        out.mix.push({ label: 'music 1 + select/illegal/place/trial.lift every 50 ms for 1.5 s', chibi: st.peak, chibiOver: st.over });
      }
    }

    if (mode === 'all' || mode === 'life') {
      // mute silences the output; cancelScheduled drops pending sounds; sfx off; volume
      const win = (buffer, a, b) => stats(buffer, a, b).peak;
      {
        const r = await render({ seconds: 4, job: audio => { audio.play('check.soft', { when: 0.3 }); },
          during: (audio, at) => { if (Math.abs(at - 1.0) < 0.001) audio.setMuted(true); if (Math.abs(at - 2.0) < 0.001) audio.play('win'); } });
        out.life.mute = { before: win(r.buffer, 0.3, 1.0), after100ms: win(r.buffer, 1.15, 4) };
      }
      {
        const r = await render({ seconds: 5, job: audio => { audio.play('place', { when: 0.2 }); audio.play('blast', { when: 1.5 }); audio.play('move.rook', { when: 1.6, ms: 300 }); audio.play('win', { when: 2.0 }); audio.play('capture', { when: 1.0 }); },
          during: (audio, at) => { if (Math.abs(at - 1.2) < 0.001) audio.cancelScheduled(); } });
        out.life.cancel = { placeAt02: win(r.buffer, 0.2, 0.5), captureStartedAt1: win(r.buffer, 1.0, 1.2), afterCancel: win(r.buffer, 1.45, 5) };
        const c = await render({ seconds: 5, job: audio => { audio.play('place', { when: 0.2 }); audio.play('blast', { when: 1.5 }); audio.play('move.rook', { when: 1.6, ms: 300 }); audio.play('win', { when: 2.0 }); audio.play('capture', { when: 1.0 }); } });
        out.life.cancelControl = { afterNoCancel: win(c.buffer, 1.45, 5) };
      }
      {
        const r = await render({ seconds: 3, job: audio => { audio.applySettings({ sfx: false, music: true, volume: 1 }); audio.play('win', { when: 0.3 }); } });
        out.life.sfxOff = { peak: win(r.buffer, 0, 3) };
        const v = await render({ seconds: 3, job: audio => { audio.applySettings({ sfx: true, music: true, volume: 0.5 }); audio.play('ui.tap', { when: 1 }); } });
        const f = await render({ seconds: 3, job: audio => { audio.play('ui.tap', { when: 1 }); } });
        out.life.volume = { half: win(v.buffer, 0, 3), full: win(f.buffer, 0, 3) };
      }
      {
        // suspense: the bed's high end goes; duck: the bed is 10 dB down
        const bedRms = async fn => { const r = await render({ seconds: 9, seed: 7, job: audio => { audio.setTension(0.95); audio.music.start(); fn(audio); } }); const st = stats(r.buffer, 3, 8.5); return { rms: st.rms, hf: st.hf }; };
        out.life.bedPlain = await bedRms(() => {});
        out.life.bedDucked10 = await bedRms(audio => audio.duck(10, true));
        out.life.bedSuspense = await bedRms(audio => audio.setSuspense(true));
        out.life.bedMusicOff = await bedRms(audio => audio.applySettings({ sfx: true, music: false, volume: 1 }));
      }
      {
        // music.stop(fade) leaves silence; setHidden leaves silence
        const r = await render({ seconds: 8, seed: 7, job: audio => { audio.setTension(0.95); audio.music.start(); }, during: (audio, at) => { if (Math.abs(at - 3) < 0.001) audio.music.stop(500); } });
        out.life.stop = { playing: win(r.buffer, 1, 3), afterFade: win(r.buffer, 3.6 + 1.2, 8) };
        const h = await render({ seconds: 8, seed: 7, job: audio => { audio.setTension(0.95); audio.music.start(); }, during: (audio, at) => { if (Math.abs(at - 3) < 0.001) audio.setHidden(true); } });
        out.life.hidden = { playing: win(h.buffer, 1, 3), after200ms: win(h.buffer, 3.25, 8) };
      }
    }
    return out;
  }, mode);
  writeFileSync(process.env.X4R_OUT, JSON.stringify(result, null, 1));
};
