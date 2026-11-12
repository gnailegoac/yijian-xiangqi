// XD: fingerprints of the noise and the impulse as the engine made them BEFORE this package (makeNoise and makeImpulse
// copied verbatim from audio.before.js), for the unit test that proves the samples did not change.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./audio.before.js', import.meta.url), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error(from); return src.slice(a, b); };
const code = `const IR_SECONDS = 1.1;\n${cut('function lcg(seed)', '/** The shared noise')}\n${cut('function makeNoise(ac)', '/**\n * The reverb impulse')}\n${cut('function makeImpulse(ac)', '/**\n * The transfer curve')}\nreturn { makeNoise, makeImpulse };`;
const { makeNoise, makeImpulse } = new Function(code)();
const ac = rate => ({ sampleRate: rate, createBuffer: (channels, length) => { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, getChannelData: ch => data[ch] }; } });
/** FNV-1a over the bytes of the samples. */
export const fnv = data => { const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
for (const rate of [44100, 48000, 96000]) {
  const noise = makeNoise(ac(rate)), impulse = makeImpulse(ac(rate));
  console.log(rate, 'noise', noise.length, fnv(noise.getChannelData(0)), 'impulse', impulse.length, fnv(impulse.getChannelData(0)), fnv(impulse.getChannelData(1)));
}
