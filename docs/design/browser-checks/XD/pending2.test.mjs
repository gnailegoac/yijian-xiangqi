// XD: what does node:test do with a test that awaits a promise that never settles? (run with a wall-clock limit)
import test from 'node:test';

const mode = process.env.XD_MODE || 'plain';
test('first passes', () => {});
test('awaits for ever', { timeout: 1500 }, async t => {
  if (mode === 'mock') t.mock.timers.enable({ apis: ['setTimeout'] });
  if (mode === 'listener') { const l = () => {}; process.on('unhandledRejection', l); t.after(() => process.off('unhandledRejection', l)); }
  await new Promise(() => {});
});
test('a later test', () => {});
