// Records the live output while a pad plays, to see where a loud transient comes from.
export default async ({ page }) => {
  await page.evaluate(() => {
    const Tap = window.AudioContext;
    const nativeConnect = AudioNode.prototype.connect;
    window.__rec = { ctx: null, chunks: [], on: false, t0: 0 };
    window.AudioContext = class extends Tap {
      constructor(...a) {
        super(...a);
        const rec = window.__rec;
        rec.ctx = this;
        rec.sp = this.createScriptProcessor(1024, 2, 2);
        rec.sp.onaudioprocess = e => {
          if (!rec.on) return;
          rec.chunks.push({ t: e.playbackTime, l: new Float32Array(e.inputBuffer.getChannelData(0)), r: new Float32Array(e.inputBuffer.getChannelData(1)) });
        };
        const mute = this.createGain();
        mute.gain.value = 0;
        nativeConnect.call(rec.sp, mute);
        nativeConnect.call(mute, this.destination);
      }
    };
    const patched = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args) {
      const out = patched.apply(this, args);
      const rec = window.__rec;
      if (rec.ctx && args[0] === rec.ctx.destination && this !== rec.sp && !(this instanceof GainNode && this.gain.value === 0)) nativeConnect.call(this, rec.sp);
      return out;
    };
  });
  await page.click('[data-sfx="ui.tap"]');
  await page.waitForTimeout(1200);
  const names = (process.env.X4_NAMES ?? 'praise.great').split(',');
  for (let k = 0; k < Number(process.env.X4_REPEAT ?? 6); k++) {
    const name = names[k % names.length];
    await page.evaluate(() => { const rec = window.__rec; rec.chunks = []; rec.on = true; rec.t0 = rec.ctx.currentTime; });
    await page.click(`[data-sfx="${name}"]`);
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const rec = window.__rec; rec.on = false;
      const sr = rec.ctx.sampleRate;
      let peak = 0, at = 0, n = 0, first = -1;
      const all = [];
      for (const c of rec.chunks) for (let i = 0; i < c.l.length; i++) { const v = Math.max(Math.abs(c.l[i]), Math.abs(c.r[i])); all.push(v); if (v > 0.001 && first < 0) first = n; if (v > peak) { peak = v; at = n; } n++; }
      const bins = [];
      const from = Math.max(0, first - 96);
      for (let b = 0; b < 160; b++) { let m = 0; for (let i = from + b * 96; i < from + (b + 1) * 96 && i < all.length; i++) m = Math.max(m, all[i]); bins.push(+(m > 0 ? 20 * Math.log10(m) : -120).toFixed(0)); }
      const around = []; for (let i = Math.max(0, at - 12); i < Math.min(all.length, at + 12); i++) around.push(+all[i].toFixed(3));
      return { sr, base: rec.ctx.baseLatency, peakDb: +(20 * Math.log10(peak)).toFixed(1), peakAfterStartMs: +(((at - first) / sr) * 1000).toFixed(1), bins2ms: bins.join(' '), around: around.join(' ') };
    });
    console.log(name, JSON.stringify(info));
  }
};
