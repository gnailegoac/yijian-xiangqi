// Node checks for the parts of src/ui/fx.js that need no DOM (run from the scratch folder, not part of the repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { createFx } = await import(pathToFileURL('C:/Users/USERNAME/git/yijian-xiangqi/src/ui/fx.js').href);

test('createFx exports exactly the members of 4.28.2', () => {
  const fx = createFx();
  assert.deepEqual(Object.keys(fx).sort(), ['banner', 'burst', 'clear', 'confetti', 'flash', 'haptic', 'hitStop', 'live', 'mount', 'popup', 'projectile', 'refreshPalette',
    'resize', 'setHaptics', 'setReducedMotion', 'shake', 'slash', 'stamp', 'trail', 'wind']);
  assert.equal(fx.live, 0);
});

test('before mount every call is a no-op and every promise resolves (no DOM is touched)', async () => {
  const fx = createFx({ reducedMotion: false, haptics: true });
  const at = { x: 10, y: 10 };
  fx.resize(600, 690, 65);
  for (const kind of ['dust', 'ring', 'capture', 'explosion', 'sparks', 'splash', 'stars', 'trail']) fx.burst(kind, at, { dir: 1, n: 8 });
  fx.trail(at, at); fx.slash(at); fx.confetti(); fx.wind(); fx.shake(3); fx.hitStop(60); fx.flash('#fff', 60);
  fx.popup('好棋！', at); fx.popup('自己想的', at, { tone: 'mark' }); fx.haptic('win'); fx.refreshPalette(); fx.setHaptics(false); fx.setReducedMotion(true); fx.clear();
  assert.equal(await fx.projectile(at, at, { arc: 10, ms: 170 }), undefined);
  assert.equal(await fx.banner('check', { tone: 'danger', avoid: at }), undefined);
  assert.equal(await fx.stamp('当头炮！', { size: 'full' }), undefined);
  assert.equal(fx.live, 0);
});

test('haptic: the patterns of 10.4.3, only when haptics are on and motion is not reduced', () => {
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: p => { calls.push(p); return true; } } });
  const fx = createFx();                                    // haptics default on (Settings.haptics default true)
  for (const k of ['tap', 'place', 'capture', 'blast', 'check', 'win', 'illegal']) fx.haptic(k);
  assert.deepEqual(calls, [8, 12, 25, [15, 40, 35], [30, 40, 30], [20, 30, 20, 30, 60], [6, 30, 6]]);
  calls.length = 0;
  fx.setHaptics(false); fx.haptic('tap');
  fx.setHaptics(true); fx.setReducedMotion(true); fx.haptic('tap');
  createFx({ haptics: false }).haptic('tap');
  createFx({ reducedMotion: true }).haptic('tap');
  assert.equal(calls.length, 0);
  fx.setReducedMotion(false); fx.haptic('tap');
  assert.deepEqual(calls, [8]);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  assert.doesNotThrow(() => fx.haptic('win'));              // no vibrate API (iPadOS)
});

test('fx.js imports only what the import rule allows for src/ui', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile('C:/Users/USERNAME/git/yijian-xiangqi/src/ui/fx.js', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const imports = [...code.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.deepEqual(imports, ['./texts.js']);
  for (const banned of ['AbortSignal.any', 'AbortSignal.timeout', 'crypto.randomUUID', 'crypto.subtle', 'navigator.clipboard', 'serviceWorker', 'SpeechRecognition', 'for await', 'backdrop-filter', 'innerHTML', 'TODO']) {
    assert.ok(!code.includes(banned), banned);
  }
  assert.ok(!src.includes('\r'), 'LF line endings');
  assert.notEqual(src.charCodeAt(0), 0xfeff, 'no BOM');
});
