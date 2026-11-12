// Drives dev/audio.html in headless Chrome with a real AudioContext and checks the lifecycle the contract describes.
import { writeFileSync } from 'node:fs';

const NAMES = ['ui.tap', 'ui.open', 'ui.close', 'chat.send', 'chat.receive', 'chat.tick', 'select', 'deselect', 'illegal', 'place',
  'trial.lift', 'trial.retract', 'trial.confirm', 'move.rook', 'move.horse', 'move.cannon', 'move.elephant', 'move.advisor', 'move.king', 'move.pawn', 'river',
  'capture', 'cannon.fire', 'blast', 'check.give', 'check.take', 'check.soft', 'win', 'lose', 'draw', 'deal', 'undo',
  'hint.1', 'hint.2', 'hint.3', 'fan.sweep', 'stamp', 'praise.good', 'praise.great', 'praise.brilliant', 'warn', 'arrow', 'turn.yours'];
const LONG = { win: 2400, deal: 1900, lose: 2100, 'check.give': 1500, 'check.take': 1500, 'check.soft': 1400, draw: 1400, 'praise.brilliant': 1400, 'chat.tick': 1200 };

export default async ({ page, shot }) => {
  const out = { checks: {}, levels: {} };
  const snap = () => page.evaluate(() => ({
    contexts: window.__desk.contexts(), unlocked: window.__desk.audio().unlocked, state: window.__desk.contextState(),
    pill: document.querySelector('#state').dataset.state, wake: !document.querySelector('#wake').hidden,
    peak: window.__desk.peakDb(), max: window.__desk.maxDb(), live: window.__desk.live(), most: window.__desk.max(), pending: window.__desk.pending(),
  }));
  const reset = () => page.evaluate(() => window.__desk.resetMax());

  // 0. before any gesture: no context, and play() does nothing and queues nothing
  out.checks.beforeGesture = await snap();
  await page.evaluate(() => { const a = window.__desk.audio(); a.play('place'); a.play('win', { when: 0.2 }); a.setTension(0.4); a.setPalette('chibi'); a.applySettings({ sfx: true, music: true, volume: 1 }); });
  await page.waitForTimeout(400);
  out.checks.afterPlayWithoutGesture = await snap();
  await shot('1-locked');

  // 1. the first tap unlocks, and the pad it hit is heard
  await page.click('[data-sfx="trial.confirm"]');
  await page.waitForTimeout(900);
  out.checks.afterFirstTap = await snap();
  await page.waitForTimeout(1500);
  await reset();
  await page.waitForTimeout(300);
  out.checks.silenceAfterFirstSound = await snap();      // the `win` asked for before unlock was not queued

  // 2. every pad is audible on the live output
  for (const name of NAMES) {
    await reset();
    await page.click(`[data-sfx="${name}"]`);
    await page.waitForTimeout(LONG[name] ?? 900);
    const s = await snap();
    out.levels[name] = Number.isFinite(s.max) ? +s.max.toFixed(1) : null;
  }
  // a stinger caught mid-flight, for the meter
  await page.click('[data-sfx="win"]');
  await page.waitForTimeout(750);
  await shot('2-win');
  await page.waitForTimeout(2200);

  // 3. mute
  await page.click('#mute');
  await page.waitForTimeout(150);
  await reset();
  await page.click('[data-sfx="place"]');
  await page.click('[data-sfx="check.give"]');
  await page.waitForTimeout(700);
  out.checks.muted = await snap();
  await shot('3-muted');
  await page.click('#mute');
  await page.waitForTimeout(300);
  await reset();
  await page.click('[data-sfx="place"]');
  await page.waitForTimeout(500);
  out.checks.unmuted = await snap();

  // 4. cancelScheduled
  await page.click('#book');
  await page.waitForTimeout(150);
  out.checks.booked = await snap();
  await page.click('#cancel');
  await reset();
  await page.waitForTimeout(3200);
  out.checks.cancelled = await snap();
  await page.click('#book');                              // the control: without cancel the six are heard
  await reset();
  await page.waitForTimeout(3600);
  out.checks.bookedAndHeard = await snap();

  // 5. the cap under a burst of forty sounds
  await reset();
  await page.click('[data-combo="连珠四十响"]');
  await page.waitForTimeout(2500);
  out.checks.burst = await snap();

  // 6. music at full tension, then the scenes and switches
  await reset();
  await page.click('#musicToggle');
  await page.click('#anchors [data-tension="0.95"]');
  await page.waitForTimeout(9000);
  out.checks.musicFull = await snap();
  await shot('4-music');
  await page.click('#suspense');
  await page.click('#duck');
  await page.click('#palette [data-palette="shachang"]');
  await page.waitForTimeout(2500);
  out.checks.musicSwitches = await snap();
  await page.click('#suspense');
  await page.click('#duck');
  await page.click('#scene [data-scene="victory"]');
  await page.waitForTimeout(3000);
  await page.click('#scene [data-scene="defeat"]');
  await page.waitForTimeout(3000);
  await page.click('#scene [data-scene="game"]');
  await page.waitForTimeout(1500);
  out.checks.musicScenes = await snap();

  // 7. hidden
  await page.click('#hidden');
  await page.waitForTimeout(500);
  out.checks.hidden = await snap();
  await page.click('#hidden');
  await page.waitForTimeout(500);
  out.checks.visibleAgain = await snap();
  await page.click('#musicFade');
  await page.waitForTimeout(2600);
  await reset();
  await page.waitForTimeout(600);
  out.checks.musicStopped = await snap();

  // 8. read-aloud
  await page.click('#readAloud');
  await page.click('#say3');
  await page.waitForTimeout(600);
  out.checks.speech = await page.evaluate(() => ({ supported: window.__desk.speech().supported, voices: speechSynthesis.getVoices().map(v => v.lang), speaking: speechSynthesis.speaking, dot: document.querySelector('#speaking').dataset.state, log: [...document.querySelectorAll('#log li')].map(li => li.textContent) }));
  await page.click('#hush');
  await page.click('#readAloud');

  // 9. dispose and rebuild
  await page.click('#rebuild');
  await page.waitForTimeout(300);
  out.checks.rebuilt = await snap();
  await page.click('[data-sfx="place"]');
  await page.waitForTimeout(700);
  out.checks.rebuiltAndTapped = await snap();

  writeFileSync(process.env.X4_OUT, JSON.stringify(out, null, 1));
};
