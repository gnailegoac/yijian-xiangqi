// XD: the cause of the 50 GB test process, in isolation. RUN ONLY UNDER THE MEMORY GUARD (MEM_LIMIT_MB <= 600).
// A failing assert.equal() on an object that holds large typed arrays builds its message with
// util.inspect(..., { maxArrayLength: Infinity, depth: 1000 }) and then diffs the two texts line by line.
import assert from 'node:assert/strict';

const n = Number(process.argv[2] || 1000);
const mode = process.argv[3] || 'equal-undefined';
const fake = () => ({ numberOfChannels: 2, length: n, sampleRate: 44100, data: [new Float32Array(n), new Float32Array(n)] });
const t0 = performance.now();
let message = '';
try {
  if (mode === 'equal-undefined') assert.equal(fake(), undefined);
  else if (mode === 'equal-other') assert.equal(fake(), fake());
  else if (mode === 'ok-identity') assert.ok(fake() === undefined, 'not the same object');
} catch (error) {
  message = String(error.message);
}
console.log(`${mode} n=${n}: message ${message.length} chars, ${(performance.now() - t0).toFixed(0)} ms, rss ${(process.memoryUsage.rss() / 1048576).toFixed(0)} MB`);
