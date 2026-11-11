// Read-aloud only, on speechSynthesis (SPEC §4.28.3). Package X4.
//
// 诸葛亮's lines can be read aloud (settings.readAloud, off by default). The stage feeds whole sentences as the
// typewriter finishes them; this module queues them, picks the voice and tells the audio engine to hold the music
// down while he speaks. Nothing is spoken before a user gesture: browsers refuse it, and a game that talks before
// it was touched would be rude anyway.
//
//   feed(id, text)   one whole sentence of the line `id`, brackets already stripped. A sentence that arrives while
//                    another is being spoken waits; sentences that wait together are spoken as one utterance, so the
//                    voice does not pause between them. A new `id` replaces the line that was being read.
//   flush(id)        the line `id` is complete: "speaking" ends as soon as its last sentence has been spoken
//                    (without it, "speaking" is held for a moment in case the next sentence is on its way, so the
//                    music does not pump up and down between sentences).
//   cancel()         silence, now: on abort, new line, mute, undo / restart, page hidden.
//   onSpeaking(cb)   cb(true) when he starts to speak, cb(false) when he has finished (chat ticks are off meanwhile).

/** @import { AudioEngine, Speech } from './types.js' */

const LANG = 'zh-CN';
const RATE = 1.05;
const PITCH = 1.0;
const DUCK_DB = 10;            // while speaking the music is held 10 dB down
const LINGER_MS = 700;         // "speaking" is held this long after the last sentence of a line that was not flushed
const AFTER_CANCEL_MS = 80;    // some engines drop a speak() that follows a cancel() at once

/** Normalised language tag of a voice ('zh_CN' -> 'zh-cn'). @param {SpeechSynthesisVoice} v */
const langOf = v => v.lang.replace(/_/g, '-').toLowerCase();

/** What is left of a sentence that is worth speaking. @param {string} text */
function tidy(text) {
  const clean = String(text ?? '').replace(/[【】\[\]]/g, '').replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : '';
}

/** Read-aloud only (speechSynthesis). @param {{ audio:AudioEngine }} deps @returns {Speech} */
export function createSpeech(deps) {
  const found = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function'
    ? window.speechSynthesis
    : null;
  if (!found) {
    return { supported: false, setEnabled: () => {}, feed: () => {}, flush: () => {}, cancel: () => {}, onSpeaking: () => {} };
  }
  const synth = found;

  let enabled = false;
  let speaking = false;
  let primed = false;                // a user gesture was seen while read-aloud was on
  let armed = false;                 // the gesture listeners are registered
  /** @type {SpeechSynthesisVoice|null} */
  let voice = null;
  let voicesKnown = false;           // the browser has reported its voices
  /** @type {string|null} */
  let line = null;                   // the id of the line being read
  let flushed = false;               // flush(line) was called
  /** @type {string[]} */
  let queue = [];                    // sentences of the line not yet handed to the synthesiser
  /** @type {SpeechSynthesisUtterance|null} */
  let current = null;
  let cancelledAt = -Infinity;
  let lingerTimer = 0;
  let watchdog = 0;
  let retryTimer = 0;
  /** @type {((on:boolean) => void)[]} */
  const listeners = [];

  /** The first zh-CN voice; failing that another Chinese voice. */
  function pickVoice() {
    const list = synth.getVoices();
    voicesKnown = list.length > 0;
    voice = list.find(v => langOf(v) === 'zh-cn')
      ?? list.find(v => langOf(v).startsWith('zh-cn') || langOf(v).startsWith('zh-hans') || langOf(v).startsWith('cmn-hans'))
      ?? list.find(v => langOf(v).startsWith('zh') || langOf(v).startsWith('cmn'))
      ?? null;
  }

  // voices arrive asynchronously, with `voiceschanged`
  if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', pickVoice);
  else synth.onvoiceschanged = pickVoice;

  /** @param {boolean} on */
  function setSpeaking(on) {
    clearTimeout(lingerTimer);
    lingerTimer = 0;
    if (on === speaking) return;
    speaking = on;
    deps.audio.duck(DUCK_DB, on);
    for (const cb of listeners) cb(on);
  }

  /** Nothing is left to say. */
  function settle() {
    if (current || queue.length) return;
    clearTimeout(lingerTimer);
    lingerTimer = 0;
    if (flushed || line === null) setSpeaking(false);
    else lingerTimer = setTimeout(() => { lingerTimer = 0; if (!current && !queue.length) setSpeaking(false); }, LINGER_MS);
  }

  /** @param {SpeechSynthesisUtterance} utterance */
  function finished(utterance) {
    if (current !== utterance) return;
    current = null;
    clearTimeout(watchdog);
    watchdog = 0;
    if (queue.length) pump(); else settle();
  }

  /** Hands the waiting sentences to the synthesiser, as one utterance. */
  function pump() {
    clearTimeout(retryTimer);
    retryTimer = 0;
    if (current || !queue.length) return;
    const wait = cancelledAt + AFTER_CANCEL_MS - Date.now();
    if (wait > 0) { retryTimer = setTimeout(pump, wait); return; }
    if (!voice) pickVoice();
    const text = queue.join('');
    queue = [];
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANG;
    if (voice) utterance.voice = voice;
    utterance.rate = RATE;
    utterance.pitch = PITCH;
    utterance.volume = 1;
    utterance.onend = () => finished(utterance);
    utterance.onerror = () => finished(utterance);
    current = utterance;
    // some engines never report the end of an utterance
    watchdog = setTimeout(() => finished(utterance), 4000 + 450 * text.length);
    try { synth.speak(utterance); } catch { finished(utterance); }
  }

  /** Stops the voice and forgets what was waiting. */
  function hush() {
    queue = [];
    clearTimeout(retryTimer);
    clearTimeout(watchdog);
    retryTimer = 0;
    watchdog = 0;
    if (current) {
      current = null;
      cancelledAt = Date.now();
      try { synth.cancel(); } catch { /* nothing was speaking */ }
    }
  }

  function cancel() {
    hush();
    line = null;
    flushed = false;
    setSpeaking(false);
  }

  /** The first gesture after read-aloud was switched on: speech engines (iOS) need one utterance started by a gesture. */
  function onGesture() {
    disarm();
    if (!enabled || primed) return;
    primed = true;
    if (!voice) pickVoice();
    if (current || synth.speaking || synth.pending) return;
    try {
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      silent.lang = LANG;
      synth.speak(silent);
    } catch { /* the engine will be asked again by the first sentence */ }
  }

  function arm() {
    if (armed || primed || typeof window === 'undefined') return;
    armed = true;
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  }

  return {
    supported: true,
    setEnabled(on) {
      enabled = !!on;
      if (enabled) { pickVoice(); arm(); } else { disarm(); cancel(); }
    },
    feed(id, text) {
      if (!enabled) return;
      if (!primed && !deps.audio.unlocked) return;           // nothing is spoken before a user gesture
      const sentence = tidy(text);
      if (!sentence) return;
      if (!voice) pickVoice();
      // this device has no Chinese voice: stay silent rather than read Chinese with a foreign one, and leave the
      // music alone (nothing will be spoken, so nothing is ducked)
      if (!voice && voicesKnown) return;
      if (id !== line) {                                     // a new line replaces the one being read
        hush();
        line = id;
        flushed = false;
      }
      queue.push(sentence);
      setSpeaking(true);
      pump();
    },
    flush(id) {
      if (id !== line) return;
      flushed = true;
      settle();
    },
    cancel,
    onSpeaking(cb) {
      if (typeof cb === 'function') listeners.push(cb);
    },
  };
}
