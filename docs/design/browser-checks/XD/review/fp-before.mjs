// The fingerprints of the noise and the impulse of the REVIEWED engine (snapshot 04), computed from its own source text.
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8');
const grab = name => { const i = src.indexOf(`function ${name}(`); if (i < 0) throw new Error('no ' + name); let depth = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); } } throw new Error('unbalanced'); };
const code = `const IR_SECONDS = 1.1;\n${grab('lcg')}\n${grab('makeNoise')}\n${grab('makeImpulse')}\nreturn { makeNoise, makeImpulse };`;
const { makeNoise, makeImpulse } = new Function(code)();
const fp = data => { const b = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
for (const rate of [44100, 48000, 96000]) {
  const ac = { sampleRate: rate, createBuffer(ch, len, sr) { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: c => data[c] }; } };
  const n = makeNoise(ac), ir = makeImpulse(ac);
  console.log(rate, JSON.stringify([fp(n.getChannelData(0)), fp(ir.getChannelData(0)), fp(ir.getChannelData(1))]), n.length, ir.length);
}
