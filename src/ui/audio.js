// Sound: Web Audio graph, synthesis recipes, adaptive music (SPEC §4.28.3, §10.5). Package X4.
//
// Every sound is synthesised; there are no audio files. The module has three layers:
//
//   1. Tables (pure, no Web Audio). The primitives of §10.5.2 are written as "ops": plain descriptions of one
//      synth voice. A recipe of §10.5.3 is a function that lists ops; the music bed of §10.5.5 is a function that
//      lists the notes of one 16th-note step. RECIPE_SOURCES and bedVoices() are computed from these same tables,
//      so the numbers the tests read cannot drift from what is played.
//   2. The builder. buildOp() turns one op into nodes on any BaseAudioContext: the live context, or the
//      OfflineAudioContext that renders the long stingers once.
//   3. The engine, createAudio(): graph, lifecycle (unlock / mute / hidden), voice caps, ducking, the pre-rendered
//      stingers and the music scheduler.
//
// Clock: everything is timed on the context clock (ctx.currentTime); timers (setTimeout) only wake the scheduler.
//
// `window` events from audio: audio:unlocked (once), audio:state {state:'running'|'suspended'|'muted'}.

/** @import { AudioEngine, SfxName, ThemeId } from './types.js' */

// ---------------------------------------------------------------------------------------------------------------------
// Constants of the graph (§10.5.1)
// ---------------------------------------------------------------------------------------------------------------------

const SFX_BUS = 0.8;
const MUSIC_BUS = 0.5;
const REVERB_OUT = 0.5;
const MASTER = 0.9;
const SFX_CAP = 48;            // live source nodes, effects
const MUSIC_CAP = 20;          // live source nodes, music
const IR_SECONDS = 1.1;        // length of the generated reverb impulse
const LOOKAHEAD = 0.005;       // a sound asked for "now" starts this much later, so its attack is never cut off
const SAME_NAME_GAP = 0.03;    // the same name within 30 ms is dropped
const TICK_GAP = 0.07;         // chat.tick: one per 70 ms
const DUCK_DB = -8;            // check.give, check.take, win, lose, blast duck the music by 8 dB ...
const DUCK_SECONDS = 1.2;      // ... for 1.2 s (tau 50 ms down, 400 ms up)
const SCHED_MS = 50;           // the music scheduler wakes every 50 ms ...
const SCHED_AHEAD = 0.2;       // ... and schedules every step of the next 200 ms
const PAD_SOURCES = 5;         // the pad: two drone notes x two oscillators, and one LFO
const PAD_GAIN = 0.05;
const AUDIBLE = 0.02;          // a layer below this gain creates no voices
const WIN_SECONDS = 2.4;       // the victory scene starts after the `win` stinger
const LOSE_SECONDS = 2.0;      // the defeat scene starts after `lose`
// The soft limiter after the compressor (CONTRACT-NOTES K-98): the output never exceeds 0 dBFS, whatever is stacked.
const LIMIT_KNEE = 10 ** (-2 / 20);        // linear, sample for sample, up to -2 dBFS; no single effect reaches that
const LIMIT_CEILING = 10 ** (-0.3 / 20);   // the knee bends towards -0.3 dBFS and never reaches it
const LIMIT_RANGE = 2;         // the curve covers inputs up to +6 dBFS; beyond that it is flat at the ceiling
const LIMIT_POINTS = 4097;     // one curve point every 1/1024 of full scale
// The first gesture of a visit (CONTRACT-NOTES M-121): the noise and the impulse are computed ahead of it ...
const PREPARE_RATES = [48000, 44100];      // ... for the sample rates an iPad and most computers run at ...
const PREPARE_MS = 250;        // ... starting this long after createAudio(), one table per timer task

// ---------------------------------------------------------------------------------------------------------------------
// Pitch helpers (§10.5.2): D major pentatonic
// ---------------------------------------------------------------------------------------------------------------------

/** @param {number} semi @param {number} oct */
const NOTE = (semi, oct) => 293.6648 * 2 ** (oct - 4) * 2 ** (semi / 12);
const PENTA = [0, 2, 4, 7, 9];
/** Scale degree: deg(0) = D4, deg(3) = A4, deg(5) = D5, deg(8) = A5, deg(10) = D6. @param {number} i */
const deg = i => NOTE(PENTA[((i % 5) + 5) % 5], 4 + Math.floor(i / 5));
/** Smoothstep. @param {number} a @param {number} b @param {number} x */
const ss = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
/** @param {number} x */
const clamp01 = x => Math.min(1, Math.max(0, x));
/** @param {number} db */
const dbToGain = db => 10 ** (db / 20);

// ---------------------------------------------------------------------------------------------------------------------
// Theme palettes (§10.5.6)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Palette
 * @property {number} bright                     pluck brightness multiplier
 * @property {number} decay                      pluck decay multiplier
 * @property {[OscillatorType, OscillatorType]} pad   the two oscillators of each drone note (the second is +4 cents)
 * @property {number} reverb                     reverb return multiplier
 * @property {number} drum                       drum gain multiplier
 * @property {[number, number]} horn             the horn enters over ss(horn[0], horn[1], T)
 */

/** @type {Record<ThemeId, Palette>} */
const PALETTES = {
  chibi:     { bright: 1.0,  decay: 1.0,  pad: ['triangle', 'sine'], reverb: 1.0, drum: 1.0,  horn: [0.65, 0.85] },
  longzhong: { bright: 0.75, decay: 0.85, pad: ['sine', 'sine'],     reverb: 0.8, drum: 0.8,  horn: [0.65, 0.85] },
  shachang:  { bright: 1.15, decay: 1.0,  pad: ['triangle', 'sine'], reverb: 0.9, drum: 1.25, horn: [0.55, 0.75] },
};

// ---------------------------------------------------------------------------------------------------------------------
// Ops: the synthesis primitives of §10.5.2 as data. `t` is seconds from the start of the recipe.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{k:'tone', t:number, type:OscillatorType, f0:number, f1:number, glide:number, a:number, d:number, gain:number, wet:number, lp:number}} ToneOp
 *   Oscillator at f0, exponential ramp to f1 at t+glide; optional lowpass at `lp` Hz; env(gain, a, d). One source.
 * @typedef {{k:'noise', t:number, filter:BiquadFilterType, f0:number, f1:number, q:number, a:number, hold:number, d:number, gain:number, wet:number, am:number}} NoiseOp
 *   Shared noise through a biquad sweeping f0 -> f1; attack, hold, exponential decay. One source; two with `am` (the square LFO).
 * @typedef {{k:'pluck', t:number, f:number, gain:number, decay:number, cut:number, wet:number}} PluckOp
 *   The string of a guzheng-like pluck: sawtooth + triangle through a closing lowpass. Two sources. (The pick click is a NoiseOp.)
 * @typedef {{k:'swell', t:number, type:OscillatorType, f:number, a:number, hold:number, r:number, gain:number, wet:number}} SwellOp
 *   Oscillator with a linear attack, a hold and a linear release (the beating pair of check.take). One source.
 * @typedef {{k:'erhu', t:number, notes:[number, number][], glide:number, vib:number, depth:number, lp:number, q:number, a:number, gain:number, hold:number, out:number, wet:number}} ErhuOp
 *   The bowed voice of `lose`: sawtooth through a lowpass, vibrato LFO, notes as [seconds, Hz] joined by glides. Two sources.
 * @typedef {{k:'horn', t:number, f:number, gain:number, dur:number, wet:number}} HornOp
 *   号角: two detuned sawtooths through an opening lowpass. Two sources.
 * @typedef {ToneOp|NoiseOp|PluckOp|SwellOp|ErhuOp|HornOp} Op
 */

/**
 * Lifetimes of the source nodes of one op, relative to the start of the recipe: one [start, stop] pair per source.
 * buildOp() stops its sources at exactly these times, so this is also the single definition of how long a voice lives.
 * @param {Op} op
 * @returns {[number, number][]}
 */
function opSpans(op) {
  switch (op.k) {
    case 'tone': return [[op.t, op.t + op.a + op.d + 0.02]];
    case 'noise': {
      const stop = op.t + op.a + op.hold + op.d + 0.02;
      return op.am > 0 ? [[op.t, stop], [op.t, stop]] : [[op.t, stop]];
    }
    case 'pluck': { const stop = op.t + op.decay + 0.05; return [[op.t, stop], [op.t, stop]]; }
    case 'swell': return [[op.t, op.t + op.a + op.hold + op.r + 0.04]];
    case 'erhu': { const stop = op.t + op.out + 0.05; return [[op.t, stop], [op.t, stop]]; }
    case 'horn': { const stop = op.t + op.dur + 0.02; return [[op.t, stop], [op.t, stop]]; }
  }
}

/** Source lifetimes of a list of ops on an absolute clock. @param {Op[]} ops @param {number} t0 @returns {[number, number][]} */
function spansOf(ops, t0) {
  /** @type {[number, number][]} */
  const spans = [];
  for (const op of ops) for (const [s, e] of opSpans(op)) spans.push([t0 + s, t0 + e]);
  return spans;
}

/** @param {Op[]} ops */
const countSources = ops => ops.reduce((n, op) => n + opSpans(op).length, 0);

/**
 * A score collects the ops of one sound. Its methods are the primitives of §10.5.2 with the defaults given there.
 * @typedef {Object} Score
 * @property {Op[]} ops
 * @property {(t:number, o:{f0:number, type?:OscillatorType, f1?:number, glide?:number, a?:number, d?:number, gain?:number, wet?:number, lp?:number}) => void} tone
 * @property {(t:number, o:{f0:number, filter?:BiquadFilterType, f1?:number, q?:number, a?:number, hold?:number, d?:number, gain?:number, wet?:number, am?:number}) => void} noise
 * @property {(t:number, f:number, o?:{gain?:number, decay?:number, bright?:number, wet?:number}) => void} pluck
 * @property {(t:number, f:number, o?:{gain?:number}) => void} chime
 * @property {(t:number, f:number, o?:{gain?:number, dark?:boolean}) => void} gong
 * @property {(t:number, f:number, o?:{gain?:number, d?:number}) => void} drum
 * @property {(t:number, w?:number, o?:{gain?:number}) => void} place
 * @property {(t:number, f:number, o?:{gain?:number, dur?:number}) => void} horn
 */

/**
 * @param {Palette} pal  the palette multiplies pluck brightness and decay and drum gains (§10.5.6)
 * @returns {Score}
 */
function makeScore(pal) {
  /** @type {Op[]} */
  const ops = [];

  /** @type {Score['tone']} */
  const tone = (t, o) => {
    ops.push({
      k: 'tone', t, type: o.type ?? 'sine', f0: o.f0, f1: o.f1 ?? o.f0, glide: o.glide ?? 0.05,
      a: o.a ?? 0.002, d: o.d ?? 0.1, gain: o.gain ?? 0.2, wet: o.wet ?? 0, lp: o.lp ?? 0,
    });
  };

  /** @type {Score['noise']} */
  const noise = (t, o) => {
    ops.push({
      k: 'noise', t, filter: o.filter ?? 'bandpass', f0: o.f0, f1: o.f1 ?? o.f0, q: o.q ?? 1,
      a: o.a ?? 0.002, hold: o.hold ?? 0, d: o.d ?? 0.1, gain: o.gain ?? 0.2, wet: o.wet ?? 0, am: o.am ?? 0,
    });
  };

  /** @type {Score['pluck']} */
  const pluck = (t, f, o = {}) => {
    const gain = o.gain ?? 0.2;
    const bright = o.bright ?? 1;
    ops.push({
      k: 'pluck', t, f, gain, decay: (o.decay ?? 1.2) * pal.decay,
      cut: Math.min(10 * f * bright * pal.bright, 9000), wet: o.wet ?? 0.25,
    });
    // The pick click; omitted when the recipe asks for bright < 1, i.e. for bass and qin plucks. The rule reads the
    // recipe's own `bright`, not the palette's, so a recipe has the same number of sources in every theme.
    if (bright >= 1) noise(t, { filter: 'highpass', f0: 3500, d: 0.012, gain: 0.25 * gain });
  };

  /** @type {Score['chime']} */
  const chime = (t, f, o = {}) => {
    const gain = o.gain ?? 1;
    tone(t, { f0: f, d: 0.9, gain: 0.14 * gain, wet: 0.35 });
    tone(t, { f0: f * 2.76, d: 0.45, gain: 0.05 * gain, wet: 0.35 });
    tone(t, { f0: f * 5.4, d: 0.25, gain: 0.02 * gain, wet: 0.35 });
  };

  /** @type {Score['gong']} */
  const gong = (t, f, o = {}) => {
    const gain = o.gain ?? 1;
    const lp = o.dark ? 1800 : 0;
    tone(t, { f0: f, a: 0.004, d: 1.6, gain: 0.30 * gain, wet: 0.4, lp });
    tone(t, { f0: f * 1.48, a: 0.004, d: 1.3, gain: 0.18 * gain, wet: 0.4, lp });
    tone(t, { f0: f * 2.02, a: 0.004, d: 1.0, gain: 0.12 * gain, wet: 0.4, lp });
    tone(t, { f0: f * 2.74, a: 0.004, d: 0.7, gain: 0.08 * gain, wet: 0.4, lp });
    tone(t, { f0: f * 3.76, a: 0.004, d: 0.5, gain: 0.05 * gain, wet: 0.4, lp });
    noise(t, { f0: f * 6, q: 0.8, d: 0.25, gain: 0.10 * gain, wet: 0.3 });
  };

  /** @type {Score['drum']} */
  const drum = (t, f, o = {}) => {
    const gain = (o.gain ?? 0.5) * pal.drum;
    tone(t, { f0: f * 2, f1: f, glide: 0.05, a: 0.002, d: o.d ?? 0.26, gain, wet: 0.12 });
    noise(t, { filter: 'lowpass', f0: 500, d: 0.05, gain: 0.3 * gain });
  };

  /** @type {Score['place']} */
  const place = (t, w = 1, o = {}) => {
    const gain = o.gain ?? 1;
    const k = 1 / Math.sqrt(w);                 // heavier piece = lower and fuller
    noise(t, { f0: 1150 * k, q: 7, a: 0.001, d: 0.055, gain: 0.50 * gain, wet: 0.1 });
    noise(t, { f0: 2600 * k, q: 9, a: 0.001, d: 0.030, gain: 0.22 * gain });
    tone(t, { f0: 190 * k, f1: 120 * k, glide: 0.04, a: 0.001, d: 0.07, gain: 0.35 * w * gain });
  };

  /** @type {Score['horn']} */
  const horn = (t, f, o = {}) => {
    ops.push({ k: 'horn', t, f, gain: o.gain ?? 0.05, dur: o.dur ?? 1.6, wet: 0.35 });
  };

  return { ops, tone, noise, pluck, chime, gong, drum, place, horn };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sound effects (§10.5.3)
// ---------------------------------------------------------------------------------------------------------------------

/** @typedef {{ms?:number, scale?:number, step?:number}} RecipeOpts   the options of play() that shape a recipe */

/** Travel time of a move.* sound in seconds. @param {RecipeOpts} o @param {number} fallbackMs */
const travel = (o, fallbackMs) => {
  const ms = typeof o.ms === 'number' && Number.isFinite(o.ms) ? o.ms : fallbackMs;
  return Math.min(5000, Math.max(0, ms)) / 1000;
};

/** @type {Record<SfxName, (s:Score, o:RecipeOpts) => void>} */
const RECIPES = {
  'ui.tap': s => { s.tone(0, { f0: 900, f1: 700, glide: 0.03, d: 0.04, gain: 0.07 }); },
  'ui.open': s => { s.noise(0, { f0: 1200, f1: 3000, q: 1.2, a: 0.01, d: 0.14, gain: 0.10 }); },
  'ui.close': s => { s.noise(0, { f0: 3000, f1: 1200, q: 1.2, a: 0.01, d: 0.12, gain: 0.09 }); },
  'chat.tick': s => { s.tone(0, { type: 'triangle', f0: 1400 * (0.92 + 0.16 * Math.random()), a: 0.001, d: 0.014, gain: 0.018 }); },
  'chat.send': s => { s.tone(0, { f0: 600, f1: 900, glide: 0.06, d: 0.07, gain: 0.07 }); },
  'chat.receive': s => {
    s.tone(0, { f0: 520, f1: 780, glide: 0.06, d: 0.08, gain: 0.08 });
    s.tone(0.05, { f0: 1040, d: 0.05, gain: 0.03 });
  },
  'select': s => {
    s.noise(0, { f0: 2100, q: 8, a: 0.001, d: 0.025, gain: 0.18 });
    s.tone(0, { f0: 520, f1: 780, glide: 0.06, d: 0.08, gain: 0.10 });
  },
  'deselect': s => { s.tone(0, { f0: 700, f1: 480, glide: 0.06, d: 0.07, gain: 0.07 }); },
  'illegal': s => {
    s.tone(0, { type: 'triangle', f0: 170, f1: 110, glide: 0.09, d: 0.11, gain: 0.22 });
    s.noise(0, { filter: 'lowpass', f0: 400, d: 0.06, gain: 0.12 });
  },
  'place': s => { s.place(0, 1); },
  'move.rook': (s, o) => {
    const ms = travel(o, 300);                  // a rumble for the whole travel, then a heavy place
    s.noise(0, { filter: 'lowpass', f0: 250, f1: 1100, q: 0.7, a: 0.02, hold: Math.max(0, ms - 0.08), d: 0.06, gain: 0.16 });
    s.place(ms, 1.3);
  },
  'move.horse': (s, o) => {
    const ms = travel(o, 340);                  // two clops
    s.noise(0, { f0: 1300, q: 10, d: 0.035, gain: 0.32 });
    s.tone(0, { f0: 300, f1: 200, glide: 0.03, d: 0.04, gain: 0.12 });
    s.noise(0.085, { f0: 980, q: 10, d: 0.035, gain: 0.32 });
    s.tone(0.085, { f0: 300, f1: 200, glide: 0.03, d: 0.04, gain: 0.12 });
    s.place(ms, 0.9);
  },
  'move.cannon': (s, o) => {
    const ms = travel(o, 300);                  // a 28 Hz rattle
    s.noise(0, { f0: 520, q: 2, a: 0.01, hold: Math.max(0, ms - 0.07), d: 0.06, gain: 0.14, am: 28 });
    s.place(ms, 1.1);
  },
  'move.elephant': (s, o) => {
    const ms = travel(o, 320);                  // a thud on landing
    s.tone(ms, { f0: 78, f1: 52, glide: 0.12, d: 0.22, gain: 0.38 });
    s.noise(ms, { filter: 'lowpass', f0: 220, d: 0.09, gain: 0.25 });
    s.place(ms, 1.2, { gain: 0.6 });
  },
  'move.advisor': (s, o) => {
    const ms = travel(o, 150);                  // a silk swish
    s.noise(0, { f0: 2400, f1: 5200, q: 1.5, a: 0.015, d: 0.11, gain: 0.12 });
    s.place(ms, 0.8);
  },
  'move.king': (s, o) => {
    const ms = travel(o, 320);                  // a deep drum on landing
    s.tone(ms, { f0: 110, f1: 62, glide: 0.09, d: 0.38, gain: 0.42, wet: 0.15 });
    s.noise(ms, { f0: 1800, q: 4, d: 0.012, gain: 0.15 });
    s.place(ms, 1.3, { gain: 0.5 });
  },
  'move.pawn': (s, o) => { s.place(travel(o, 210), 0.6); },
  'river': s => {
    s.noise(0, { f0: 1300, f1: 500, q: 1.2, a: 0.005, d: 0.26, gain: 0.2, wet: 0.2 });
    s.tone(0.06, { f0: 1500, f1: 2250, glide: 0.04, d: 0.06, gain: 0.08 });
    s.tone(0.12, { f0: 1900, f1: 2850, glide: 0.04, d: 0.06, gain: 0.08 });
    s.tone(0.17, { f0: 2300, f1: 3450, glide: 0.04, d: 0.06, gain: 0.08 });
  },
  'capture': (s, o) => {
    const k = typeof o.scale === 'number' && Number.isFinite(o.scale) ? Math.min(2, Math.max(0.3, o.scale)) : 1;
    s.noise(0, { filter: 'highpass', f0: 1800, a: 0.001, d: 0.16 * k, gain: 0.30 * k });
    for (let i = 0; i < 6; i++) s.tone(0.025 * i, { f0: 1500 + ((977 * i) % 2700), d: 0.025, gain: 0.06 });
    s.tone(0, { f0: 140, f1: 60, glide: 0.08, d: 0.14, gain: 0.45 * k });
  },
  'cannon.fire': s => {
    s.noise(0, { filter: 'highpass', f0: 5000, d: 0.07, gain: 0.10 });         // fuse hiss
    s.tone(0.03, { f0: 280, f1: 920, glide: 0.11, d: 0.12, gain: 0.12 });      // launch chirp
  },
  'blast': s => {
    s.noise(0, { filter: 'lowpass', f0: 2600, f1: 180, q: 0.8, a: 0.002, d: 0.48, gain: 0.60, wet: 0.25 });
    s.tone(0, { f0: 120, f1: 38, glide: 0.26, d: 0.42, gain: 0.65 });
    for (let i = 0; i < 5; i++) s.noise(0.06 + 0.04 * i, { f0: 3000, q: 3, d: 0.018, gain: 0.10 });
  },
  'trial.lift': (s, o) => {
    // An unresolved interval that walks up the scale move by move, so a game plays a melody.
    const step = typeof o.step === 'number' && Number.isFinite(o.step) ? Math.floor(o.step) : 0;
    const k = ((step % 5) + 5) % 5;
    s.pluck(0, deg(k + 3), { gain: 0.14, decay: 0.9 });
    s.pluck(0.06, deg(k + 5), { gain: 0.10, decay: 0.9 });
  },
  'trial.retract': s => {
    s.tone(0, { f0: 640, f1: 320, glide: 0.16, d: 0.18, gain: 0.08 });
    s.noise(0, { f0: 3000, f1: 900, q: 1.5, a: 0.01, d: 0.16, gain: 0.08 });
  },
  'trial.confirm': s => {
    s.place(0, 1.3);
    s.drum(0, 82, { gain: 0.38 });
    s.pluck(0.02, deg(0), { gain: 0.16, decay: 1.0 });     // the interval resolves to the tonic
  },
  'check.give': s => {
    s.gong(0, NOTE(0, 3));
    s.pluck(0, deg(3), { gain: 0.16 });
    s.pluck(0.06, deg(5), { gain: 0.16 });
    s.pluck(0.12, deg(7), { gain: 0.16 });
  },
  'check.take': s => {
    s.gong(0, NOTE(7, 2), { dark: true });
    // a minor second that beats
    s.ops.push({ k: 'swell', t: 0, type: 'triangle', f: 246.94, a: 0.01, hold: 0.35, r: 0.15, gain: 0.07, wet: 0.2 });
    s.ops.push({ k: 'swell', t: 0, type: 'triangle', f: 261.63, a: 0.01, hold: 0.35, r: 0.15, gain: 0.07, wet: 0.2 });
  },
  'check.soft': s => { s.gong(0, NOTE(7, 2), { gain: 0.35, dark: true }); },
  'win': s => {
    for (let i = 0; i <= 5; i++) s.pluck(0.085 * i, deg(i), { gain: 0.2 });
    const u = 0.6;
    s.pluck(u, deg(5), { gain: 0.16, decay: 1.8 });
    s.pluck(u, deg(7), { gain: 0.16, decay: 1.8 });
    s.pluck(u, deg(8), { gain: 0.16, decay: 1.8 });
    s.gong(u, NOTE(0, 3), { gain: 1.2 });
    s.drum(u, 73.4, { gain: 0.30 });
    s.drum(u + 0.3, 73.4, { gain: 0.36 });
    s.drum(u + 0.5, 73.4, { gain: 0.42 });
    s.drum(u + 0.65, 73.4, { gain: 0.48 });
    s.drum(u + 0.76, 73.4, { gain: 0.55 });
  },
  'lose': s => {
    s.drum(0, 73.4, { gain: 0.25, d: 0.4 });
    s.ops.push({
      k: 'erhu', t: 0, notes: [[0, deg(4)], [0.5, deg(3)], [1.0, deg(2)]], glide: 0.06, vib: 5.5, depth: 5,
      lp: 1400, q: 1, a: 0.08, gain: 0.10, hold: 1.3, out: 1.9, wet: 0.4,
    });
  },
  'draw': s => {
    s.pluck(0, deg(3), { gain: 0.14 });
    s.pluck(0, deg(5), { gain: 0.14 });
    s.gong(0, NOTE(0, 3), { gain: 0.5 });
  },
  'hint.1': s => { s.chime(0, deg(8)); },
  'hint.2': s => { s.chime(0, deg(8)); s.chime(0.09, deg(9)); },
  'hint.3': s => { s.chime(0, deg(8)); s.chime(0.09, deg(9)); s.chime(0.18, deg(10)); },
  'fan.sweep': s => { s.noise(0, { f0: 800, f1: 2400, q: 1.2, a: 0.03, d: 0.19, gain: 0.12, wet: 0.2 }); },
  'stamp': s => {
    s.place(0, 1.4);
    s.drum(0, 98, { gain: 0.40 });
    s.pluck(0.03, deg(0), { gain: 0.14, decay: 0.8 });
    s.pluck(0.03, deg(3), { gain: 0.12, decay: 0.8 });
  },
  'praise.good': s => {
    s.pluck(0, deg(7), { gain: 0.12, decay: 0.8 });
    s.pluck(0.07, deg(8), { gain: 0.12, decay: 0.8 });
  },
  'praise.great': s => { for (let i = 0; i < 4; i++) s.pluck(0.06 * i, deg(7 + i), { gain: 0.12, decay: 0.9 }); },
  'praise.brilliant': s => {
    // The contract's row gives no decay for these plucks. Its measured length (1155 ms) and peak (-8.9 dBFS) are
    // those of decay 1.0, which also continues praise.good (.8) and praise.great (.9); the default 1.2 gives 1283 ms.
    [5, 7, 8, 9, 10, 12].forEach((d, i) => s.pluck(0.05 * i, deg(d), { gain: 0.12, decay: 1.0 }));
    s.chime(0.3, deg(10));
    s.noise(0.25, { filter: 'highpass', f0: 6000, a: 0.02, d: 0.3, gain: 0.05, wet: 0.3 });
  },
  'warn': s => {
    // a soft falling third, a "hm?", not an alarm
    s.pluck(0, deg(3), { gain: 0.12, bright: 0.5, decay: 0.6 });
    s.pluck(0.11, deg(2), { gain: 0.12, bright: 0.5, decay: 0.8 });
  },
  'arrow': s => { s.tone(0, { f0: 500, f1: 1500, glide: 0.11, d: 0.12, gain: 0.05 }); },
  'undo': s => {
    s.tone(0, { type: 'sawtooth', f0: 520, f1: 180, glide: 0.2, d: 0.22, gain: 0.07, lp: 1200 });
    s.noise(0, { f0: 3000, q: 4, d: 0.01, gain: 0.1 });
    s.noise(0.09, { f0: 3000, q: 4, d: 0.01, gain: 0.1 });
  },
  'deal': s => {
    // twelve pieces drop with a little jitter; the first offset of the formula is -15 ms and is taken as 0
    for (let i = 0; i < 12; i++) {
      s.place(Math.max(0, 55 * i + (((37 * i) % 30) - 15)) / 1000, 0.6 + ((53 * i) % 40) / 100, { gain: 0.5 });
    }
    s.drum(0.78, 73.4, { gain: 0.45 });
    s.pluck(0.78, deg(0), { gain: 0.14 });
    s.pluck(0.78, deg(3), { gain: 0.12 });
  },
  'turn.yours': s => { s.chime(0, deg(10), { gain: 0.6 }); s.chime(0.1, deg(8), { gain: 0.6 }); },
};

/**
 * Priority of each recipe when a cap is reached: 2 = stingers and piece sounds, 1 = UI, 0 = chat ticks
 * (and every music voice).
 * @type {Record<SfxName, 0|1|2>}
 */
const PRIORITY = {
  'ui.tap': 1, 'ui.open': 1, 'ui.close': 1, 'chat.tick': 0, 'chat.send': 1, 'chat.receive': 1,
  'select': 2, 'deselect': 2, 'illegal': 2, 'place': 2,
  'move.rook': 2, 'move.horse': 2, 'move.cannon': 2, 'move.elephant': 2, 'move.advisor': 2, 'move.king': 2, 'move.pawn': 2,
  'river': 2, 'capture': 2, 'cannon.fire': 2, 'blast': 2,
  'trial.lift': 2, 'trial.retract': 2, 'trial.confirm': 2,
  'check.give': 2, 'check.take': 2, 'check.soft': 2, 'win': 2, 'lose': 2, 'draw': 2,
  'hint.1': 2, 'hint.2': 2, 'hint.3': 2, 'fan.sweep': 1, 'stamp': 2,
  'praise.good': 2, 'praise.great': 2, 'praise.brilliant': 2, 'warn': 2, 'arrow': 1, 'undo': 2, 'deal': 2, 'turn.yours': 2,
};

const SFX_NAMES = /** @type {SfxName[]} */ (Object.keys(RECIPES));

/** The ops of one effect. @param {SfxName} name @param {RecipeOpts} o @param {Palette} pal @returns {Op[]} */
function recipeOps(name, o, pal) {
  const score = makeScore(pal);
  RECIPES[name](score, o);
  return score.ops;
}

/**
 * Exported for the recipe test: number of source nodes each recipe creates (SfxName -> number). Derived from the
 * recipes above, so it is what play() really builds; it does not depend on the options or on the palette.
 * A pre-rendered stinger creates this many sources once, inside the OfflineAudioContext, and one source per play.
 * @type {Record<SfxName, number>}
 */
export const RECIPE_SOURCES = Object.freeze(/** @type {Record<SfxName, number>} */ (
  Object.fromEntries(SFX_NAMES.map(name => [name, countSources(recipeOps(name, {}, PALETTES.chibi))]))
));

/**
 * Exported for the recipe test: the effects that are rendered once into a buffer (the long stingers of SPEC §10.5.1)
 * instead of being synthesised live on every play (CONTRACT-NOTES item 81).
 * @type {readonly SfxName[]}
 */
export const PRERENDERED = Object.freeze(/** @type {SfxName[]} */ (['win', 'deal', 'check.give', 'check.take', 'blast', 'stamp']));

/** Effects that duck the music (§10.5.1). @type {ReadonlySet<SfxName>} */
const DUCKERS = new Set(/** @type {SfxName[]} */ (['check.give', 'check.take', 'win', 'lose', 'blast']));

// ---------------------------------------------------------------------------------------------------------------------
// Adaptive music: the layer tables (§10.5.5)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {'melody'|'bass'|'wood'|'drum'|'drive'|'horn'} LayerId
 * @typedef {Record<Exclude<LayerId, 'melody'>, number>} LayerLevels     the melody is always on
 * @typedef {{layer:LayerId, poly:number, ops:Op[]}} BedNote
 *   One note of the bed. `poly` = how many notes of this layer may ring at once: when one more starts, the oldest is
 *   released at that moment. The limits keep the bed inside the 20-source budget where it is dense (from T = .6 the
 *   bass is a single string; from T = .8 the melody rings two notes deep).
 */

/** The steps of the melody's random walk. */
const WALK = [-2, -1, -1, 0, 1, 1, 2];

// Tension is not volume (§10.5.5; CONTRACT-NOTES K-98). With the layer table's literal war drum (.16, step 0: .22)
// and horn (.05, x 1.6 at full tension) the bed at T = .95 measured 1.0 dB above the loudness §10.5.5 states for it
// (-25.6 against -26.6 dBFS by the contract's method: the energy of four bars in a 16 s buffer); the drum cost 0.3 dB
// and the horn 0.8 dB. These two gains, and nothing else, are trimmed until the bed is within 0.5 dB of the stated
// figures at every tension (measured after the trim: +0.2 at .05, +0.3 at .3 and .5, +0.1 at .7, +0.3 at .95, +0.2 at 1).
const BED_DRUM = 0.11;         // L3b war drum (the contract's table: .16)
const BED_DRUM_DOWNBEAT = 0.15;    // ... on step 0 (the contract's table: .22)
const BED_HORN = 0.03;         // L4 horn (the contract's table: .05, growing to .08 at T = 1; it no longer grows with tension)

/** Layer gains for a tension (the "Enters" column). @param {number} T @param {Palette} pal @returns {LayerLevels} */
function layerTargets(T, pal) {
  return {
    bass: ss(0.20, 0.32, T),
    wood: ss(0.35, 0.45, T),
    drum: ss(0.60, 0.70, T),
    drive: ss(0.80, 0.90, T),
    horn: ss(pal.horn[0], pal.horn[1], T),
  };
}

/**
 * The notes of one 16th-note step of the bed (everything but the pad). Pure: the scheduler plays what this returns
 * and bedVoices() counts it.
 * @param {number} st      step in the bar, 0..15
 * @param {number} bar     bar index; four bars are a phrase
 * @param {number} T       smoothed tension
 * @param {boolean} yu     羽 mode (tonic B) instead of 宫 mode (tonic D)
 * @param {Palette} pal
 * @param {(layer:keyof LayerLevels) => number} level   current gain of a layer
 * @param {{idx:number, run:number}} mel                melody state, updated in place
 * @param {() => number} rnd
 * @returns {BedNote[]}
 */
function bedStep(st, bar, T, yu, pal, level, mel, rnd) {
  /** @type {BedNote[]} */
  const notes = [];
  const tonicLow = yu ? NOTE(9, 1) : NOTE(0, 2);     // B1 / D2: the low drone note
  const fifthLow = yu ? NOTE(4, 2) : NOTE(7, 2);     // F#2 / A2

  // L1 melody: a random walk over deg(0..9) on the even steps
  if (st % 2 === 0) {
    const last = bar % 4 === 3 && st === 12;          // the last slot of a phrase always plays and lands on a tonic
    if (last || (rnd() < 0.16 + 0.30 * T && !(mel.run >= 2 && T < 0.7))) {
      mel.idx += WALK[Math.floor(rnd() * 7) % 7];
      if (mel.idx < 0) mel.idx = -mel.idx;
      if (mel.idx > 9) mel.idx = 18 - mel.idx;
      if (last) {
        const tonics = yu ? [4, 9] : [0, 5];
        mel.idx = Math.abs(tonics[1] - mel.idx) < Math.abs(tonics[0] - mel.idx) ? tonics[1] : tonics[0];
      }
      const s = makeScore(pal);
      const gain = 0.09 + 0.05 * rnd();
      // while the position is calm 诸葛亮 plays the qin: an octave lower, darker, longer
      if (T < 0.35) s.pluck(0, deg(mel.idx) / 2, { gain, decay: 2.0, bright: 0.6, wet: 0.35 });
      else s.pluck(0, deg(mel.idx), { gain, decay: 1.4 - 0.6 * T, wet: 0.35 });
      notes.push({ layer: 'melody', poly: T >= 0.8 ? 2 : 4, ops: s.ops });
      mel.run++;
    } else {
      mel.run = 0;
    }
  }

  // L2 bass on the low tonic
  const g2 = level('bass');
  if (g2 > AUDIBLE) {
    let f = 0;
    if (T >= 0.8) { if (st % 2 === 0) f = st % 4 === 0 ? tonicLow : tonicLow * 2; }             // tonic and octave
    else if (T >= 0.6) { if (st === 0 || st === 4 || st === 12) f = tonicLow; else if (st === 8) f = fifthLow; }
    else if (st === 0) f = tonicLow;
    else if (st === 8) f = fifthLow;
    if (f > 0) {
      const s = makeScore(pal);
      s.pluck(0, f, { gain: 0.16 * g2, decay: 0.7, bright: 0.5, wet: 0.1 });
      notes.push({ layer: 'bass', poly: T >= 0.6 ? 1 : 2, ops: s.ops });
    }
  }

  // L3a wood block
  const g3a = level('wood');
  if (g3a > AUDIBLE && (st === 4 || st === 12)) {
    const s = makeScore(pal);
    s.noise(0, { f0: 1700, q: 9, d: 0.04, gain: 0.05 * g3a, wet: 0.2 });
    notes.push({ layer: 'wood', poly: 2, ops: s.ops });
  }

  // L3b war drum
  const g3b = level('drum');
  if (g3b > AUDIBLE && (st === 0 || st === 3 || st === 6 || st === 10)) {
    const s = makeScore(pal);
    s.drum(0, 73.4, { gain: (st === 0 ? BED_DRUM_DOWNBEAT : BED_DRUM) * g3b, d: 0.22 });
    notes.push({ layer: 'drum', poly: 2, ops: s.ops });
  }

  // L3c drive
  const g3c = level('drive');
  if (g3c > AUDIBLE) {
    const s = makeScore(pal);
    s.noise(0, { filter: 'highpass', f0: 6000, d: 0.022, gain: 0.025 * g3c * (st % 2 === 1 ? 0.6 : 1) });
    if (st === 0) s.tone(0, { f0: 110, f1: 55, glide: 0.06, d: 0.3, gain: 0.22 * g3c });
    notes.push({ layer: 'drive', poly: 4, ops: s.ops });
  }

  // L4 horn: step 0 of every second bar; at T >= .85 a second horn a fifth above on step 8
  const g4 = level('horn');
  if (g4 > AUDIBLE && bar % 2 === 0 && (st === 0 || (st === 8 && T >= 0.85))) {
    const s = makeScore(pal);
    const base = yu ? NOTE(9, 2) : NOTE(0, 3);        // B2 / D3
    s.horn(0, st === 0 ? base : base * 1.5, { gain: BED_HORN * g4, dur: 1.6 });
    notes.push({ layer: 'horn', poly: 2, ops: s.ops });
  }

  return notes;
}

/** Cuts source lifetimes at `at`. @param {[number, number][]} spans @param {number} at @returns {[number, number][]} */
function clipSpans(spans, at) {
  /** @type {[number, number][]} */
  const out = [];
  for (const [s, e] of spans) if (s < at) out.push([s, Math.min(e, at)]);
  return out;
}

/** The largest number of lifetimes that overlap at one moment. @param {[number, number][]} spans */
function peakOverlap(spans) {
  /** @type {[number, number][]} */
  const events = [];
  for (const [s, e] of spans) { events.push([s, 1]); events.push([e, -1]); }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);      // at the same instant a stop comes before a start
  let n = 0;
  let peak = 0;
  for (const [, d] of events) { n += d; if (n > peak) peak = n; }
  return peak;
}

/**
 * Plays two phrases of the bed at a fixed tension on paper, with the densest melody the rules allow, and counts
 * the sources that sound at once (the pad included).
 * @param {number} T @param {Palette} pal
 */
function simulateBed(T, pal) {
  const stepDur = 60 / (66 + 30 * T) / 4;
  const levels = layerTargets(T, pal);
  const mel = { idx: 5, run: 0 };
  /** @type {{layer:LayerId, spans:[number, number][]}[]} */
  const notes = [];
  for (let bar = 0; bar < 8; bar++) {
    for (let st = 0; st < 16; st++) {
      const t = (bar * 16 + st) * stepDur;
      for (const note of bedStep(st, bar, T, T >= 0.55, pal, layer => levels[layer], mel, () => 0)) {
        const ringing = notes.filter(n => n.layer === note.layer && n.spans.some(s => s[1] > t));
        while (ringing.length >= note.poly) {
          const oldest = ringing.shift();
          if (oldest) oldest.spans = clipSpans(oldest.spans, t);
        }
        notes.push({ layer: note.layer, spans: spansOf(note.ops, t) });
      }
    }
  }
  return PAD_SOURCES + peakOverlap(notes.flatMap(n => n.spans));
}

/**
 * Exported for the recipe test: the largest number of music-bed voices (source nodes) that sound at the same time at
 * tension `x` (SPEC §10.5.5; CONTRACT-NOTES item 81). Pure: computed from the bed's layer tables, no AudioContext.
 * The largest of the three palettes is returned (the 沙场 horn enters earlier).
 * @param {number} x  tension 0..1
 * @returns {number}
 */
export function bedVoices(x) {
  const T = clamp01(Number.isFinite(x) ? x : 0);
  return Math.max(simulateBed(T, PALETTES.chibi), simulateBed(T, PALETTES.longzhong), simulateBed(T, PALETTES.shachang));
}

// ---------------------------------------------------------------------------------------------------------------------
// The builder: ops -> Web Audio nodes
// ---------------------------------------------------------------------------------------------------------------------

/** env(param, t, a, peak, d): 0.0001 at t -> linear to `peak` at t+a -> exponential to 0.0001 at t+a+d. @param {AudioParam} param @param {number} t @param {number} a @param {number} peak @param {number} d */
function env(param, t, a, peak, d) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  param.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/**
 * The gain node of an envelope: closed (0.0001) from the moment it exists. A GainNode is born at 1, and a source
 * that starts a sample before the envelope's first scheduled value would get through at full level for that
 * sample: a click at the onset of every sound that is scheduled ahead.
 * @param {BaseAudioContext} ac
 */
function envGain(ac) {
  const g = ac.createGain();
  g.gain.value = 0.0001;
  return g;
}

/**
 * Builds the nodes of one op and schedules them.
 * @param {BaseAudioContext} ac
 * @param {AudioBuffer} noiseBuf        the shared white noise
 * @param {Op} op
 * @param {number} t0                   context time of the recipe's start
 * @param {AudioNode} dry               where the voice goes
 * @param {AudioNode|null} wet          where its reverb send goes (null: the sound has no send)
 * @param {AudioScheduledSourceNode[]} sources   receives every source node created
 */
function buildOp(ac, noiseBuf, op, t0, dry, wet, sources) {
  const t = t0 + op.t;
  const stop = t0 + opSpans(op)[0][1];
  /** @param {AudioNode} node */
  const route = node => {
    node.connect(dry);
    if (op.wet > 0 && wet) {
      const send = ac.createGain();
      send.gain.value = op.wet;
      node.connect(send);
      send.connect(wet);
    }
  };
  /** @param {OscillatorNode} osc */
  const run = osc => { osc.start(t); osc.stop(stop); sources.push(osc); };

  switch (op.k) {
    case 'tone': {
      const osc = ac.createOscillator();
      osc.type = op.type;
      osc.frequency.setValueAtTime(op.f0, t);
      if (op.f1 !== op.f0) osc.frequency.exponentialRampToValueAtTime(op.f1, t + op.glide);
      const g = envGain(ac);
      env(g.gain, t, op.a, op.gain, op.d);
      if (op.lp > 0) {
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = op.lp;
        osc.connect(lp);
        lp.connect(g);
      } else {
        osc.connect(g);
      }
      route(g);
      run(osc);
      break;
    }
    case 'noise': {
      const len = op.a + op.hold + op.d;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = ac.createBiquadFilter();
      filter.type = op.filter;
      filter.Q.value = op.q;
      filter.frequency.setValueAtTime(op.f0, t);
      if (op.f1 !== op.f0) filter.frequency.exponentialRampToValueAtTime(op.f1, t + len);
      const g = envGain(ac);
      const peak = Math.max(op.gain, 0.0002);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + op.a);
      g.gain.setValueAtTime(peak, t + op.a + op.hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(filter);
      filter.connect(g);
      if (op.am > 0) {
        // multiplied by a square LFO, depth 50 %: the gain swings between 0 and 1 around 0.5
        const lfo = ac.createOscillator();
        const depth = ac.createGain();
        const vca = ac.createGain();
        lfo.type = 'square';
        lfo.frequency.value = op.am;
        depth.gain.value = 0.5;
        vca.gain.value = 0.5;
        lfo.connect(depth);
        depth.connect(vca.gain);
        g.connect(vca);
        route(vca);
        run(lfo);
      } else {
        route(g);
      }
      src.start(t, (t * 0.37) % 1.5);             // the shared noise starts at a varying offset
      src.stop(stop);
      sources.push(src);
      break;
    }
    case 'pluck': {
      const saw = ac.createOscillator();
      const tri = ac.createOscillator();
      const triGain = ac.createGain();
      const lp = ac.createBiquadFilter();
      const g = envGain(ac);
      saw.type = 'sawtooth';
      tri.type = 'triangle';
      saw.frequency.setValueAtTime(op.f * 1.012, t);
      saw.frequency.exponentialRampToValueAtTime(op.f, t + 0.045);
      tri.frequency.value = op.f * 2.006;
      triGain.gain.value = 0.25;
      lp.type = 'lowpass';
      lp.Q.value = 1.5;
      lp.frequency.setValueAtTime(op.cut, t);
      lp.frequency.exponentialRampToValueAtTime(op.f * 2.2, t + 0.14);
      env(g.gain, t, 0.003, op.gain, op.decay);
      saw.connect(lp);
      tri.connect(triGain);
      triGain.connect(lp);
      lp.connect(g);
      route(g);
      run(saw);
      run(tri);
      break;
    }
    case 'swell': {
      const osc = ac.createOscillator();
      const g = envGain(ac);
      osc.type = op.type;
      osc.frequency.value = op.f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(op.gain, t + op.a);
      g.gain.setValueAtTime(op.gain, t + op.a + op.hold);
      g.gain.linearRampToValueAtTime(0.0001, t + op.a + op.hold + op.r);
      osc.connect(g);
      route(g);
      run(osc);
      break;
    }
    case 'erhu': {
      const osc = ac.createOscillator();
      const vib = ac.createOscillator();
      const vibDepth = ac.createGain();
      const lp = ac.createBiquadFilter();
      const g = envGain(ac);
      osc.type = 'sawtooth';
      lp.type = 'lowpass';
      lp.frequency.value = op.lp;
      lp.Q.value = op.q;
      vib.frequency.value = op.vib;
      vibDepth.gain.value = op.depth;
      osc.frequency.setValueAtTime(op.notes[0][1], t);
      for (let i = 1; i < op.notes.length; i++) {
        // hold the previous note until `glide` before the next one, then slide into it
        osc.frequency.setValueAtTime(op.notes[i - 1][1], t + op.notes[i][0] - op.glide);
        osc.frequency.exponentialRampToValueAtTime(op.notes[i][1], t + op.notes[i][0]);
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(op.gain, t + op.a);
      g.gain.setValueAtTime(op.gain, t + op.hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + op.out);
      vib.connect(vibDepth);
      vibDepth.connect(osc.frequency);
      osc.connect(lp);
      lp.connect(g);
      route(g);
      run(osc);
      run(vib);
      break;
    }
    case 'horn': {
      const lp = ac.createBiquadFilter();
      const g = envGain(ac);
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(1300, t + 0.18);
      lp.frequency.linearRampToValueAtTime(700, t + op.dur);
      const peak = Math.max(op.gain, 0.0002);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.18);
      g.gain.setValueAtTime(peak, t + op.dur - 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + op.dur);
      for (const cents of [-5, 5]) {
        const saw = ac.createOscillator();
        saw.type = 'sawtooth';
        saw.frequency.value = op.f * 2 ** (cents / 1200);
        saw.connect(lp);
        run(saw);
      }
      lp.connect(g);
      route(g);
      break;
    }
  }
}

/** A deterministic generator for the noise and the impulse (so every render of a stinger is identical). @param {number} seed */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** The samples of the shared noise: 2 s of mono white noise. Needs no context. @param {number} sampleRate */
function noiseSamples(sampleRate) {
  const data = new Float32Array(Math.floor(sampleRate * 2));
  const rnd = lcg(99);
  for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
  return data;
}

/**
 * The samples of the reverb impulse, left and right: 1.1 s of low-passed white noise (one-pole, coefficient
 * 0.55 - 0.4·t/len) multiplied by (1 - t/len)^2.6. Needs no context.
 * @param {number} sampleRate
 * @returns {[Float32Array, Float32Array]}
 */
function impulseSamples(sampleRate) {
  const len = Math.floor(sampleRate * IR_SECONDS);
  const rnd = lcg(12345);
  /** @type {[Float32Array, Float32Array]} */
  const channels = [new Float32Array(len), new Float32Array(len)];
  for (const data of channels) {
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      lp += (rnd() * 2 - 1 - lp) * (0.55 - 0.4 * x);
      data[i] = lp * (1 - x) ** 2.6;
    }
  }
  return channels;
}

/** An AudioBuffer of the context's sample rate holding these samples. @param {BaseAudioContext} ac @param {Float32Array[]} channels */
function bufferOf(ac, channels) {
  const buffer = ac.createBuffer(channels.length, channels[0].length, ac.sampleRate);
  channels.forEach((data, ch) => buffer.getChannelData(ch).set(data));
  return buffer;
}

/**
 * The transfer curve of the soft limiter, for a WaveShaperNode whose input was scaled by 1 / LIMIT_RANGE.
 * y = x up to the knee (-2 dBFS); above it y = knee + (ceiling - knee) · tanh((x - knee) / (ceiling - knee)): the slope
 * leaves the knee at exactly 1 and the curve closes in on the ceiling without a corner. A WaveShaper interpolates
 * linearly between the points, so the straight part passes the signal unchanged; with oversampling off the node has
 * no latency and no filter of its own.
 * @returns {Float32Array<ArrayBuffer>}
 */
function limiterCurve() {
  const curve = new Float32Array(LIMIT_POINTS);
  const mid = (LIMIT_POINTS - 1) / 2;
  const room = LIMIT_CEILING - LIMIT_KNEE;
  for (let i = 0; i < LIMIT_POINTS; i++) {
    const x = (i - mid) / mid * LIMIT_RANGE;
    const a = Math.abs(x);
    curve[i] = a <= LIMIT_KNEE ? x : Math.sign(x) * (LIMIT_KNEE + room * Math.tanh((a - LIMIT_KNEE) / room));
  }
  return curve;
}

/**
 * A stinger is rendered into a buffer: the dry sum plus its reverb return, scaled so that playing the buffer through
 * the effects bus gives exactly what the live voices would have given. Setting the render up is main-thread work and
 * is done in two halves, so that each fits a task of its own (the engine's renderStingers()).
 *
 * The first half: the OfflineAudioContext with its two ways out, dry and through the reverb. Nearly all of its time
 * is the ConvolverNode taking the impulse.
 * @param {SfxName} name @param {Palette} pal @param {number} sampleRate @param {AudioBuffer} impulse
 * @returns {{off:OfflineAudioContext, ops:Op[], dry:GainNode, reverb:ConvolverNode}}
 */
function stingerSetup(name, pal, sampleRate, impulse) {
  const ops = recipeOps(name, {}, pal);
  const seconds = Math.max(...spansOf(ops, 0).map(s => s[1])) + IR_SECONDS + 0.1;
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const dry = off.createGain();
  dry.connect(off.destination);
  const reverb = off.createConvolver();
  reverb.buffer = impulse;
  const back = off.createGain();
  back.gain.value = REVERB_OUT * pal.reverb / SFX_BUS;      // live, the return joins the master after the bus
  reverb.connect(back);
  back.connect(off.destination);
  return { off, ops, dry, reverb };
}

/**
 * The second half: the voices of the stinger, and the render (which runs off the main thread).
 * @param {ReturnType<typeof stingerSetup>} setup @param {AudioBuffer} noiseBuf
 * @returns {Promise<AudioBuffer>}
 */
function renderStinger(setup, noiseBuf) {
  /** @type {AudioScheduledSourceNode[]} */
  const sources = [];
  for (const op of setup.ops) buildOp(setup.off, noiseBuf, op, 0, setup.dry, setup.reverb, sources);
  return setup.off.startRendering();
}

// ---------------------------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Rig                       the graph of §10.5.1
 * @property {AudioContext} ctx
 * @property {GainNode} master                 0.9 · volume², 0 while muted or hidden
 * @property {GainNode} sfxBus
 * @property {GainNode} musicBus
 * @property {GainNode} duck                   between the music bus and its lowpass: the ducking of §10.5.1
 * @property {BiquadFilterNode} lowpass        musicLowpass: 18 kHz, 1.6 kHz in suspense
 * @property {ConvolverNode} reverb
 * @property {GainNode} reverbOut
 * @property {AudioBuffer} noise
 * @property {AudioBuffer} impulse
 *
 * @typedef {Object} Voice                     one sounding thing: an effect, a note of the bed, the pad
 * @property {string} name
 * @property {0|1|2} prio
 * @property {'sfx'|'music'} bus
 * @property {string} layer                    bed layer, '' for effects
 * @property {number} start                    context time its first source starts
 * @property {number} end                      context time its last source stops
 * @property {boolean} timed                   scheduled with `when`
 * @property {boolean} ducks
 * @property {[number, number][]} spans        the lifetime of each of its sources, context time
 * @property {AudioScheduledSourceNode[]} sources
 * @property {GainNode} dry
 * @property {GainNode|null} wet
 * @property {number} level                    the gain of `dry` and `wet`
 * @property {[number, number]|null} fade      a fade-out already scheduled on `dry` and `wet`: `level` at fade[0], silent at fade[1]
 *
 * @typedef {{voice:Voice, oscs:OscillatorNode[], filters:BiquadFilterNode[], gain:GainNode}} Pad
 */

const noop = () => {};

/** The AudioContext constructor of this browser, looked up when it is needed (never at load). @returns {(new () => AudioContext)|null} */
function contextCtor() {
  const g = /** @type {{AudioContext?: new () => AudioContext, webkitAudioContext?: new () => AudioContext}} */ (/** @type {unknown} */ (globalThis));
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** @param {string} type @param {object} [detail] */
function fire(type, detail) {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(type, detail ? { detail } : undefined));
}

/** @returns {AudioEngine} */
export function createAudio() {
  /** @type {Rig|null} */
  let rig = null;
  let unlocked = false;
  let disposed = false;
  let muted = false;
  let hidden = false;
  let sfxOn = true;
  let musicOn = true;
  let volume = 1;
  let suspense = false;
  let pal = PALETTES.chibi;
  let parkTimer = 0;                           // suspends the context a moment after mute / hide
  /** @type {'running'|'suspended'|'muted'} */
  let lastState = 'suspended';

  /** @type {Voice[]} */
  let voices = [];
  /** @type {Map<SfxName, number>} */
  const lastStart = new Map();

  // pre-rendered stingers: name -> buffer, once its render has finished
  /** @type {Map<SfxName, AudioBuffer>} */
  const stingers = new Map();
  let renderGen = 0;
  /** Ends the run of renderStingers() that is under way: its timer is cleared and its promise resolves. */
  let stopRender = noop;
  /** Resolves when the first render of the stingers is over. @type {Promise<boolean>|null} */
  let ready = null;

  // The noise and the reverb impulse are the same samples on every visit, and computing them takes about 10 ms.
  // No context is needed for that, so it is done before the first gesture, while the page is idle, for the usual
  // sample rates; buildRig() then only copies the samples in. A rig that is built earlier than that, or at another
  // rate, computes what it misses, as before.
  /** @type {{rate:number, impulse:[Float32Array, Float32Array]|null, noise:Float32Array|null}[]} */
  let prepared = PREPARE_RATES.map(rate => ({ rate, impulse: null, noise: null }));
  let prepareTimer = contextCtor() ? setTimeout(prepare, PREPARE_MS) : 0;

  // ducking
  let duckHeld = 0;                            // dB, <= 0: held by duck(db, true)
  let duckFrom = 0;
  let duckUntil = -1;                          // the automatic duck window, context time

  // music
  let wanted = false;                          // music.start() was called and music.stop() was not
  let winAt = -Infinity;
  let loseAt = -Infinity;
  const bed = {
    on: false,                                 // the scheduler runs
    paused: false,                             // stopped by mute / hide / settings: the next start continues the piece
    snap: true,                                // the next bar takes tension and layer gains as they are, unsmoothed
    timer: 0,
    next: 0,                                   // context time of the next step
    step: 0,
    bar: 0,
    T: 0.15,                                   // smoothed tension
    target: 0.15,                              // the value of setTension
    yu: false,
    /** @type {'game'|'victory'|'defeat'} */
    scene: 'game',
    idx: 5,
    run: 0,
    stepDur: 60 / 70.5 / 4,
    barAt: 0,
    from: layerTargets(0.15, PALETTES.chibi),
    to: layerTargets(0.15, PALETTES.chibi),
    /** @type {Pad|null} */
    pad: null,
  };

  // ---- small helpers -------------------------------------------------------------------------------------------------

  const masterLevel = () => (muted || hidden ? 0 : MASTER * volume * volume);
  const running = () => !!rig && rig.ctx.state === 'running';
  let masterAim = masterLevel();               // where the master gain is heading

  /**
   * Sends the master gain to where it belongs (0.9 · volume², 0 while muted or hidden), once per change.
   * Mute and volume: setTargetAtTime, tau 20 ms. Hidden: a 150 ms ramp.
   * @param {Rig} r
   */
  function aimMaster(r) {
    const level = masterLevel();
    if (level === masterAim) return;
    masterAim = level;
    const now = r.ctx.currentTime;
    const g = r.master.gain;
    g.cancelScheduledValues(now);
    if (hidden && !muted) {
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.15);
    } else {
      g.setTargetAtTime(level, now, 0.02);
    }
  }

  function emitState() {
    /** @type {'running'|'suspended'|'muted'} */
    const state = muted ? 'muted' : running() && !hidden ? 'running' : 'suspended';
    if (state === lastState) return;
    lastState = state;
    fire('audio:state', { state });
  }

  /** Drops what has ended. @param {number} now */
  function prune(now) {
    if (voices.some(v => v.end <= now)) voices = voices.filter(v => v.end > now);
  }

  /**
   * The largest number of sources of one bus alive at once while a new sound with these lifetimes plays.
   * @param {'sfx'|'music'} bus @param {[number, number][]} spans
   */
  function peakWith(bus, spans) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [s, e] of spans) { if (s < lo) lo = s; if (e > hi) hi = e; }
    /** @type {[number, number][]} */
    const others = [];
    for (const v of voices) if (v.bus === bus) for (const span of v.spans) if (span[1] > lo && span[0] < hi) others.push(span);
    const points = spans.map(s => s[0]);
    for (const [s] of others) if (s > lo) points.push(s);
    let peak = 0;
    for (const p of points) {
      let n = 0;
      for (const [s, e] of spans) if (s <= p && p < e) n++;
      for (const [s, e] of others) if (s <= p && p < e) n++;
      if (n > peak) peak = n;
    }
    return peak;
  }

  /**
   * Fades a voice out so that it is silent and stopped at `at`.
   * @param {Rig} r @param {Voice} v @param {number} at @param {number} [fade]
   */
  function release(r, v, at, fade = 0.012) {
    const now = r.ctx.currentTime;
    const end = Math.max(at, now + 0.002);
    if (end >= v.end) return;                                   // it ends by itself before that
    const from = Math.max(now, end - Math.max(fade, 0.002));
    // a voice that is already fading goes on from the level it has reached: a fade is never turned back up
    const level = v.fade ? v.level * Math.min(1, Math.max(0, (v.fade[1] - from) / (v.fade[1] - v.fade[0]))) : v.level;
    for (const node of [v.dry, v.wet]) {
      if (!node) continue;
      node.gain.cancelScheduledValues(from);
      node.gain.setValueAtTime(level, from);
      node.gain.linearRampToValueAtTime(0, end);
    }
    v.fade = level > 0 ? [end - (end - from) * (v.level / level), end] : [from - 1, from];
    // spans[i] is the lifetime of sources[i]; a source that stops by itself before `end` keeps its own stop time
    v.sources.forEach((src, i) => {
      const [s, e] = v.spans[i];
      if (e <= end) return;
      try { src.stop(end); } catch { /* already stopped */ }
      v.spans[i] = [s, Math.max(s, end)];
    });
    v.end = end;
  }

  /** Silences a voice at once, started or not. @param {Voice} v */
  function kill(v) {
    try { v.dry.disconnect(); } catch { /* not connected */ }
    if (v.wet) { try { v.wet.disconnect(); } catch { /* not connected */ } }
    for (const src of v.sources) { try { src.stop(0); } catch { /* already stopped */ } }
    v.spans = [];
    v.end = -Infinity;
  }

  /**
   * May a new sound with these source lifetimes start? Enforces the caps of §10.5.1: when a cap is reached,
   * priority-0 then priority-1 sounds are dropped (a new one is not started; older ones make room for a more
   * important sound).
   * @param {Rig} r @param {'sfx'|'music'} bus @param {0|1|2} prio @param {[number, number][]} spans
   */
  function admit(r, bus, prio, spans) {
    const cap = bus === 'sfx' ? SFX_CAP : MUSIC_CAP;
    if (spans.length > cap) return false;
    if (peakWith(bus, spans) <= cap) return true;
    const start = Math.min(...spans.map(s => s[0]));
    for (let p = 0; p < prio; p++) {
      const victims = voices.filter(v => v.bus === bus && v.prio === p && v.end > start).sort((a, b) => a.start - b.start);
      for (const v of victims) {
        if (v.start >= start) kill(v); else release(r, v, start);
        if (peakWith(bus, spans) <= cap) return true;
      }
    }
    return false;
  }

  /**
   * Starts the voices of a list of ops.
   * @param {Rig} r @param {Op[]} ops @param {number} t0
   * @param {{name:string, prio:0|1|2, bus:'sfx'|'music', gain:number, timed:boolean, layer:string}} info
   * @returns {Voice|null}  null when the cap refused it
   */
  function spawn(r, ops, t0, info) {
    const spans = spansOf(ops, t0);
    if (spans.length === 0 || !admit(r, info.bus, info.prio, spans)) return null;
    const dry = r.ctx.createGain();
    dry.gain.value = info.gain;
    dry.connect(info.bus === 'sfx' ? r.sfxBus : r.musicBus);
    /** @type {GainNode|null} */
    let wet = null;
    if (ops.some(op => op.wet > 0)) {
      wet = r.ctx.createGain();
      wet.gain.value = info.gain;
      wet.connect(r.reverb);
    }
    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];
    for (const op of ops) buildOp(r.ctx, r.noise, op, t0, dry, wet, sources);
    /** @type {Voice} */
    const voice = {
      name: info.name, prio: info.prio, bus: info.bus, layer: info.layer,
      start: Math.min(...spans.map(s => s[0])), end: Math.max(...spans.map(s => s[1])),
      timed: info.timed, ducks: false, spans, sources, dry, wet, level: info.gain, fade: null,
    };
    voices.push(voice);
    return voice;
  }

  // ---- ducking -------------------------------------------------------------------------------------------------------

  /** Re-writes the automation of the duck gain from now on. @param {Rig} r */
  function applyDuck(r) {
    const now = r.ctx.currentTime;
    const held = dbToGain(duckHeld);
    const g = r.duck.gain;
    g.cancelScheduledValues(now);
    if (duckUntil > now) {
      if (duckFrom > now) g.setTargetAtTime(held, now, 0.05);
      g.setTargetAtTime(Math.min(held, dbToGain(DUCK_DB)), Math.max(now, duckFrom), 0.05);
      g.setTargetAtTime(held, duckUntil, 0.4);
    } else {
      g.setTargetAtTime(held, now, held < 1 ? 0.05 : 0.4);
    }
  }

  /** @param {Rig} r @param {number} t */
  function duckFor(r, t) {
    if (duckUntil > r.ctx.currentTime) {
      duckFrom = Math.min(duckFrom, t);
      duckUntil = Math.max(duckUntil, t + DUCK_SECONDS);
    } else {
      duckFrom = t;
      duckUntil = t + DUCK_SECONDS;
    }
    applyDuck(r);
  }

  // ---- music ---------------------------------------------------------------------------------------------------------

  /** Gain of a layer at time t: re-targeted once per bar, tau 0.6 s. @param {keyof LayerLevels} layer @param {number} t */
  const levelAt = (layer, t) => bed.to[layer] + (bed.from[layer] - bed.to[layer]) * Math.exp(-Math.max(0, t - bed.barAt) / 0.6);

  /** The drone of the mode: tonic and fifth, each on two oscillators (the second +4 cents). @param {boolean} yu */
  const droneOf = yu => {
    const [lo, hi] = yu ? [NOTE(9, 1), NOTE(4, 2)] : [NOTE(0, 2), NOTE(7, 2)];        // B1 + F#2 / D2 + A2
    const sharp = 2 ** (4 / 1200);
    return [lo, lo * sharp, hi, hi * sharp];
  };

  /** L0: the pad. Starts at `at`. @param {Rig} r @param {number} at @returns {Pad} */
  function buildPad(r, at) {
    const { ctx } = r;
    const dry = ctx.createGain();
    dry.connect(r.musicBus);
    const wet = ctx.createGain();
    wet.connect(r.reverb);
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.setTargetAtTime(PAD_GAIN, at, 0.4);
    const send = ctx.createGain();
    send.gain.value = 0.3;
    gain.connect(dry);
    gain.connect(send);
    send.connect(wet);
    // a 0.08 Hz LFO moves the cutoff by ±120 Hz
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoDepth.gain.value = 120;
    lfo.connect(lfoDepth);
    /** @type {OscillatorNode[]} */
    const oscs = [];
    /** @type {BiquadFilterNode[]} */
    const filters = [];
    droneOf(bed.yu).forEach((f, i) => {
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      osc.type = pal.pad[i % 2];
      osc.frequency.value = f;
      lp.type = 'lowpass';
      lp.frequency.value = 400 + 900 * bed.T;
      lfoDepth.connect(lp.frequency);
      osc.connect(lp);
      lp.connect(gain);
      osc.start(at);
      oscs.push(osc);
      filters.push(lp);
    });
    lfo.start(at);
    /** @type {[number, number][]} */
    const spans = [];
    for (let i = 0; i < PAD_SOURCES; i++) spans.push([at, Infinity]);
    /** @type {Voice} */
    const voice = {
      name: 'pad', prio: 0, bus: 'music', layer: 'pad', start: at, end: Infinity, timed: false, ducks: false,
      spans, sources: [...oscs, lfo], dry, wet, level: 1, fade: null,
    };
    voices.push(voice);
    return { voice, oscs, filters, gain };
  }

  /** The pad moves to the drone of the new mode: a short breath, never a slide. @param {number} t */
  function retunePad(t) {
    const pad = bed.pad;
    if (!pad) return;
    pad.gain.gain.setTargetAtTime(0.0001, t, 0.08);
    droneOf(bed.yu).forEach((f, i) => pad.oscs[i].frequency.setValueAtTime(f, t + 0.3));
    pad.gain.gain.setTargetAtTime(PAD_GAIN, t + 0.3, 0.5);
  }

  /** Once per bar: tension, tempo, mode, layer gains. @param {number} t */
  function startBar(t) {
    const game = bed.scene === 'game';
    const first = bed.snap;
    bed.snap = false;
    if (!game) bed.T = bed.scene === 'victory' ? 0.4 : 0.05;
    else if (!first) bed.T += (bed.target - bed.T) * (bed.target > bed.T ? 0.5 : 0.25);
    const bpm = game ? 66 + 30 * bed.T : bed.scene === 'victory' ? 88 : 60;
    bed.stepDur = 60 / bpm / 4;
    // 羽 above .55, back to 宫 below .45; on a phrase boundary, or on the next bar when T >= .9
    const want = game && (bed.T >= 0.55 || (bed.yu && bed.T > 0.45));
    if (want !== bed.yu && (bed.bar % 4 === 0 || bed.T >= 0.9 || !game)) {
      bed.yu = want;
      retunePad(t);
    }
    const to = layerTargets(bed.T, pal);
    bed.from = first ? to : {
      bass: levelAt('bass', t), wood: levelAt('wood', t), drum: levelAt('drum', t), drive: levelAt('drive', t), horn: levelAt('horn', t),
    };
    bed.to = to;
    bed.barAt = t;
    if (bed.pad) for (const lp of bed.pad.filters) lp.frequency.setTargetAtTime(400 + 900 * bed.T, t, 0.6);
  }

  /** @param {Rig} r @param {number} t */
  function scheduleStep(r, t) {
    if (bed.step === 0) startBar(t);
    const notes = bedStep(bed.step, bed.bar, bed.T, bed.yu, pal, layer => levelAt(layer, t), bed, () => Math.random());
    for (const note of notes) {
      const ringing = voices.filter(v => v.layer === note.layer && v.end > t).sort((a, b) => a.start - b.start);
      while (ringing.length >= note.poly) {
        const oldest = ringing.shift();
        if (oldest) release(r, oldest, t);
      }
      spawn(r, note.ops, t, { name: note.layer, prio: 0, bus: 'music', gain: 1, timed: false, layer: note.layer });
    }
  }

  function tick() {
    clearTimeout(bed.timer);
    bed.timer = 0;
    const r = rig;
    if (!r || !bed.on) return;
    const now = r.ctx.currentTime;
    prune(now);
    if (bed.next < now - 0.1) {                  // the timer was held back (a throttled tab): pick up at a fresh bar
      bed.next = now + 0.05;
      if (bed.step !== 0) { bed.step = 0; bed.bar++; }
    }
    while (bed.next < now + SCHED_AHEAD) {
      scheduleStep(r, bed.next);
      bed.next += bed.stepDur;
      bed.step = (bed.step + 1) % 16;
      if (bed.step === 0) bed.bar++;
    }
    bed.timer = setTimeout(tick, SCHED_MS);
  }

  /** Fades every music voice out. @param {Rig} r @param {number} fade seconds */
  function hushMusic(r, fade) {
    const at = r.ctx.currentTime + fade;
    for (const v of voices) {
      if (v.bus !== 'music') continue;
      if (v.start >= at) kill(v); else release(r, v, at, fade);
    }
    bed.pad = null;
  }

  /** Starts the scheduler at `at`. fresh: a new piece; otherwise it continues at the next bar. @param {Rig} r @param {number} at @param {boolean} fresh */
  function beginBed(r, at, fresh) {
    if (fresh) {
      bed.T = bed.scene === 'game' ? bed.target : bed.scene === 'victory' ? 0.4 : 0.05;
      bed.yu = bed.scene === 'game' && bed.T >= 0.55;
      bed.bar = 0;
      bed.idx = bed.yu ? 4 : 5;
      bed.run = 0;
    } else if (bed.step !== 0) {
      bed.bar++;
    }
    bed.step = 0;
    bed.next = at;
    bed.snap = true;
    bed.on = true;
    bed.paused = false;
    bed.pad = buildPad(r, at);
    tick();
  }

  /** The earliest moment the piece of the current scene may begin: victory and defeat wait for their stinger to end. */
  const sceneStart = () => (bed.scene === 'victory' ? winAt + WIN_SECONDS : bed.scene === 'defeat' ? loseAt + LOSE_SECONDS : -Infinity);

  /** Starts or stops the scheduler so that it runs exactly when it should. */
  function syncBed() {
    const r = rig;
    const should = !!r && wanted && musicOn && !muted && !hidden && !disposed && r.ctx.state === 'running';
    if (should && r && !bed.on) {
      const fresh = !bed.paused;
      const at = Math.max(r.ctx.currentTime + 0.06, fresh ? sceneStart() : 0);
      // what an earlier piece has left (a long music.stop() fade) ends where this one begins: never two pads
      hushMusic(r, Math.min(0.3, at - r.ctx.currentTime));
      beginBed(r, at, fresh);
    } else if (!should && bed.on) {
      bed.on = false;
      bed.paused = wanted;
      clearTimeout(bed.timer);
      bed.timer = 0;
      if (r) hushMusic(r, 0.08);
    }
  }

  /** The piece starts again at `at` (a scene change, or a stinger the scene waits for). @param {Rig} r @param {number} at */
  function restartBed(r, at) {
    hushMusic(r, Math.min(0.3, Math.max(0.05, at - r.ctx.currentTime)));
    beginBed(r, at, true);
  }

  // ---- stingers ------------------------------------------------------------------------------------------------------

  /**
   * Starts one effect at context time t.
   * @param {Rig} r @param {SfxName} name @param {number} t @param {number} gain @param {boolean} timed @param {RecipeOpts} o
   */
  function launch(r, name, t, gain, timed, o) {
    /** @type {Voice|null} */
    let voice = null;
    const buffer = stingers.get(name);
    if (buffer) {
      /** @type {[number, number][]} */
      const spans = [[t, t + buffer.duration]];
      if (!admit(r, 'sfx', PRIORITY[name], spans)) return;
      const dry = r.ctx.createGain();
      dry.gain.value = gain;
      dry.connect(r.sfxBus);
      const src = r.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(dry);
      src.start(t);
      voice = {
        name, prio: PRIORITY[name], bus: 'sfx', layer: '', start: t, end: t + buffer.duration,
        timed, ducks: false, spans, sources: [src], dry, wet: null, level: gain, fade: null,
      };
      voices.push(voice);
    } else {
      voice = spawn(r, recipeOps(name, o, pal), t, { name, prio: PRIORITY[name], bus: 'sfx', gain, timed, layer: '' });
    }
    if (!voice) return;
    lastStart.set(name, t);
    if (DUCKERS.has(name)) { voice.ducks = true; duckFor(r, t); }
    if (name === 'win') winAt = t;
    if (name === 'lose') loseAt = t;
    // the victory / defeat scene begins when its stinger is over, whichever of the two calls came first
    if (bed.on && name === 'win' && bed.scene === 'victory') restartBed(r, t + WIN_SECONDS);
    if (bed.on && name === 'lose' && bed.scene === 'defeat') restartBed(r, t + LOSE_SECONDS);
  }

  /**
   * Renders the long stingers into buffers (after the first unlock and after setPalette). A stinger is played from
   * its buffer, as one source, as soon as the buffer exists; old buffers stay in use until the new ones are ready.
   * Until its first render has finished (a moment after the first unlock), and where it cannot be rendered at all,
   * a stinger is synthesised live, inside the cap like every other sound: it is never late and never lost.
   *
   * Nothing is set up inside the call (CONTRACT-NOTES M-121): the caller is a gesture (the first tap of a visit,
   * a tap on a theme), and setting up one render keeps the main thread for 10 to 20 ms. The renders are set up
   * after the gesture, in timer tasks, in the order of PRERENDERED: never more than one stinger in a task, and each
   * stinger in two (stingerSetup, then renderStinger), so that no task is longer than a frame. The rendering itself
   * runs off the main thread. The promise resolves when all six are over.
   * A new call (a new palette) and dispose() end a run that is under way: it starts no further stinger, what it has
   * started is ignored when it arrives, and its promise resolves at once.
   * @param {Rig} r @returns {Promise<boolean>}
   */
  function renderStingers(r) {
    const gen = ++renderGen;
    stopRender();
    if (typeof OfflineAudioContext !== 'function') return Promise.resolve(true);
    const palette = pal;
    return new Promise(resolve => {
      /** @type {Promise<void>[]} */
      const jobs = [];
      let timer = 0;
      const stop = () => {
        clearTimeout(timer);
        if (stopRender === stop) stopRender = noop;
        resolve(true);
      };
      /** The stinger whose first half is done. @type {ReturnType<typeof stingerSetup>|null} */
      let setup = null;
      const step = () => {
        timer = 0;
        const name = PRERENDERED[jobs.length];
        /** @type {Promise<AudioBuffer>|null} */
        let job = null;
        try {
          if (setup) job = renderStinger(setup, r.noise);
          else setup = stingerSetup(name, palette, r.ctx.sampleRate, r.impulse);
        } catch (error) {
          job = Promise.reject(error);
        }
        if (job) {
          setup = null;
          jobs.push(job.then(
            buffer => { if (gen === renderGen && rig === r) stingers.set(name, buffer); },
            () => { if (gen === renderGen) stingers.delete(name); },
          ));
        }
        if (jobs.length < PRERENDERED.length) timer = setTimeout(step, 0);
        else Promise.all(jobs).then(stop);
      };
      stopRender = stop;
      timer = setTimeout(step, 0);
    });
  }

  // ---- lifecycle -----------------------------------------------------------------------------------------------------

  /** @param {AudioContext} ctx @returns {Rig} */
  function buildRig(ctx) {
    const master = ctx.createGain();
    masterAim = masterLevel();
    master.gain.value = masterAim;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    master.connect(comp);
    // The compressor is not a brick wall (its attack lets the first 3 ms of a stack through), so a soft limiter follows
    // it: comp -> gain 1 / LIMIT_RANGE -> WaveShaper (limiterCurve) -> destination. Transparent below -2 dBFS.
    const limitIn = ctx.createGain();
    limitIn.gain.value = 1 / LIMIT_RANGE;
    const limiter = ctx.createWaveShaper();
    limiter.curve = limiterCurve();
    limiter.oversample = 'none';
    comp.connect(limitIn);
    limitIn.connect(limiter);
    limiter.connect(ctx.destination);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxOn ? SFX_BUS : 0;
    sfxBus.connect(master);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = suspense ? 1600 : 18000;
    lowpass.connect(master);
    const duck = ctx.createGain();
    duck.gain.value = dbToGain(duckHeld);
    duck.connect(lowpass);
    const musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? MUSIC_BUS : 0;
    musicBus.connect(duck);

    const ahead = prepared.find(p => p.rate === ctx.sampleRate);
    const impulse = bufferOf(ctx, ahead?.impulse ?? impulseSamples(ctx.sampleRate));
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = REVERB_OUT * pal.reverb;
    reverb.connect(reverbOut);
    reverbOut.connect(master);
    const noise = bufferOf(ctx, [ahead?.noise ?? noiseSamples(ctx.sampleRate)]);
    dropPrepared();                              // the samples live in the rig's buffers now

    return { ctx, master, sfxBus, musicBus, duck, lowpass, reverb, reverbOut, noise, impulse };
  }

  /** One table of samples per timer task, until every rate of PREPARE_RATES has its impulse and its noise. */
  function prepare() {
    prepareTimer = 0;
    const next = prepared.find(p => !p.impulse || !p.noise);
    if (!next) return;
    if (!next.impulse) next.impulse = impulseSamples(next.rate);
    else next.noise = noiseSamples(next.rate);
    if (prepared.some(p => !p.impulse || !p.noise)) prepareTimer = setTimeout(prepare, 0);
  }

  /** Ends the preparation and frees its tables. */
  function dropPrepared() {
    clearTimeout(prepareTimer);
    prepareTimer = 0;
    prepared = [];
  }

  /**
   * Ends every voice for good. Called when the output is silent because the context is about to stop or has stopped
   * (mute, hidden, an interruption): a suspended context freezes whatever was sounding or scheduled, and it would all
   * come back when the context runs again, minutes later: the rest of a fanfare, a blast that was scheduled ahead.
   * @param {Rig} r
   */
  function silence(r) {
    for (const v of voices) kill(v);
    voices = [];
    bed.pad = null;
    lastStart.clear();
    duckUntil = -1;
    applyDuck(r);
  }

  /** The context suspends a moment after mute / hide (the master has ramped to 0 by then). @param {number} ms */
  function parkAfter(ms) {
    clearTimeout(parkTimer);
    parkTimer = setTimeout(() => {
      parkTimer = 0;
      const r = rig;
      if (!r || !(muted || hidden) || r.ctx.state !== 'running') return;
      silence(r);
      r.ctx.suspend().then(() => {
        if (rig !== r) return;                   // disposed meanwhile
        // unmuted or shown again while the suspension was on its way: the suspension must not win
        if (!muted && !hidden) wake(r); else emitState();
      }, noop);
    }, ms);
  }

  /** The context runs: first time -> unlocked. */
  function onRunning() {
    const r = rig;
    if (!r) return;
    if (!unlocked) {
      unlocked = true;
      fire('audio:unlocked');
      if (rig !== r) return;                     // a listener of the event disposed the engine: nothing is started for it
      const rendered = renderStingers(r);        // set up after this gesture, in timer tasks
      // never keep unlock() waiting on a render that hangs
      ready = new Promise(resolve => {
        const timer = setTimeout(() => resolve(true), 1500);
        rendered.then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(true); });
      });
    }
    if (muted || hidden) {
      if (!parkTimer) parkAfter(0);              // it was started only to unlock it; it stays parked
    } else {
      aimMaster(r);                              // an unmute that could not resume the context then is completed now
      syncBed();
    }
    emitState();
  }

  function onStateChange() {
    if (disposed || !rig) return;
    if (rig.ctx.state === 'running') {
      onRunning();
    } else {
      // suspended by us (mute, hidden) or by the system (iOS interrupts audio for a call): nothing may be left over
      syncBed();
      silence(rig);
      emitState();
    }
  }

  /** Mute or hide ended: the context resumes and the master comes back. @param {Rig} r */
  function wake(r) {
    clearTimeout(parkTimer);
    parkTimer = 0;
    const back = () => {
      if (rig !== r || muted || hidden || r.ctx.state !== 'running') return;
      aimMaster(r);
      syncBed();                                 // the scheduler restarts at the next bar
      emitState();
    };
    if (r.ctx.state === 'running') back();
    else r.ctx.resume().then(back, noop);
  }

  /** @returns {Promise<boolean>} */
  function unlock() {
    if (disposed) return Promise.resolve(false);
    if (!rig) {
      const Ctor = contextCtor();
      if (!Ctor) return Promise.resolve(false);
      try {
        const ctx = new Ctor();
        rig = buildRig(ctx);
        ctx.addEventListener('statechange', onStateChange);
      } catch {
        rig = null;
        return Promise.resolve(false);
      }
    }
    const r = rig;
    if (r.ctx.state === 'running') {
      onRunning();
      return ready ?? Promise.resolve(true);
    }
    if (unlocked && (muted || hidden)) return Promise.resolve(true);     // parked on purpose
    /** @type {Promise<void>} */
    let resumed;
    try { resumed = r.ctx.resume(); } catch { return Promise.resolve(false); }
    return new Promise(resolve => {
      let settled = false;
      /** @param {boolean} ok */
      const finish = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      // outside a user gesture a browser may leave resume() pending for ever
      const timer = setTimeout(() => finish(unlocked), 1000);
      resumed.then(() => {
        if (rig !== r || r.ctx.state !== 'running') { finish(unlocked); return; }
        onRunning();
        (ready ?? Promise.resolve(true)).then(finish, () => finish(true));
      }, () => finish(false));
    });
  }

  /** @type {AudioEngine['play']} */
  function play(name, opts) {
    const r = rig;
    if (!r || muted || hidden || !sfxOn || r.ctx.state !== 'running') return;
    if (!Object.hasOwn(RECIPES, name)) return;
    const now = r.ctx.currentTime;
    const when = opts && typeof opts.when === 'number' && Number.isFinite(opts.when) && opts.when > 0 ? opts.when : 0;
    const t = now + LOOKAHEAD + when;
    const last = lastStart.get(name);
    if (last !== undefined && Math.abs(t - last) < (name === 'chat.tick' ? TICK_GAP : SAME_NAME_GAP)) return;
    const gain = opts && typeof opts.gain === 'number' && Number.isFinite(opts.gain) ? Math.min(2, Math.max(0, opts.gain)) : 1;
    prune(now);
    launch(r, name, t, gain, when > 0, opts ?? {});
  }

  /** @param {number} x */
  function setTension(x) {
    if (typeof x === 'number' && Number.isFinite(x)) bed.target = clamp01(x);
  }

  const music = {
    start() {
      if (disposed) return;
      wanted = true;
      syncBed();
    },
    /** @param {number} [fadeMs] */
    stop(fadeMs) {
      wanted = false;
      bed.paused = false;
      const r = rig;
      if (!bed.on) return;
      bed.on = false;
      clearTimeout(bed.timer);
      bed.timer = 0;
      const ms = typeof fadeMs === 'number' && Number.isFinite(fadeMs) ? fadeMs : 600;
      if (r) hushMusic(r, Math.min(5, Math.max(0.02, ms / 1000)));
    },
    /** @param {'game'|'victory'|'defeat'} scene */
    setScene(scene) {
      if ((scene !== 'game' && scene !== 'victory' && scene !== 'defeat') || scene === bed.scene) return;
      bed.scene = scene;
      bed.paused = false;                        // a new scene is a new piece
      const r = rig;
      if (!r || !bed.on) return;
      restartBed(r, Math.max(r.ctx.currentTime + 0.3, sceneStart()));
    },
  };

  /** @param {boolean} on */
  function setSuspense(on) {
    suspense = !!on;
    if (rig) rig.lowpass.frequency.setTargetAtTime(suspense ? 1600 : 18000, rig.ctx.currentTime, 0.12);
  }

  /** Holds the music `db` dB down while on (read-aloud). @param {number} db @param {boolean} on */
  function duck(db, on) {
    duckHeld = on && Number.isFinite(db) ? -Math.abs(db) : 0;
    if (rig) applyDuck(rig);
  }

  /** @param {ThemeId} theme */
  function setPalette(theme) {
    if (!Object.hasOwn(PALETTES, theme) || PALETTES[theme] === pal) return;
    pal = PALETTES[theme];
    const r = rig;
    if (!r) return;
    const now = r.ctx.currentTime;
    r.reverbOut.gain.setTargetAtTime(REVERB_OUT * pal.reverb, now, 0.05);
    if (bed.on && bed.pad) {
      // the pad changes its oscillators: the old one ends where the new one begins, so there are never two
      const at = now + 0.25;
      release(r, bed.pad.voice, at, 0.25);
      bed.pad = buildPad(r, at);
    }
    if (unlocked) renderStingers(r);
  }

  /** @param {boolean} on */
  function setMuted(on) {
    const next = !!on;
    if (next === muted) return;
    muted = next;
    const r = rig;
    if (r) {
      if (muted) {
        aimMaster(r);                            // to 0, tau 20 ms
        syncBed();                               // stops the scheduler
        parkAfter(300);
      } else if (!hidden) {
        wake(r);
      }
    }
    emitState();
  }

  /** @param {{sfx:boolean, music:boolean, volume:number}} s */
  function applySettings(s) {
    if (!s) return;
    sfxOn = !!s.sfx;
    musicOn = !!s.music;
    volume = typeof s.volume === 'number' && Number.isFinite(s.volume) ? clamp01(s.volume) : 1;
    const r = rig;
    if (r) {
      const now = r.ctx.currentTime;
      r.sfxBus.gain.setTargetAtTime(sfxOn ? SFX_BUS : 0, now, 0.02);
      r.musicBus.gain.setTargetAtTime(musicOn ? MUSIC_BUS : 0, now, 0.02);
      aimMaster(r);
    }
    syncBed();
  }

  function cancelScheduled() {
    const r = rig;
    if (!r) return;
    const now = r.ctx.currentTime;
    let unduck = false;
    for (const v of voices) {
      if (!v.timed || v.start <= now) continue;
      if (v.ducks) unduck = true;
      lastStart.delete(/** @type {SfxName} */ (v.name));
      kill(v);
    }
    prune(now);
    if (unduck) {
      // the duck of a dropped stinger goes with it; one that already sounds keeps its own
      const sounding = voices.filter(v => v.ducks).map(v => v.start + DUCK_SECONDS);
      duckUntil = sounding.length ? Math.max(...sounding) : -1;
      applyDuck(r);
    }
  }

  /** @param {boolean} on */
  function setHidden(on) {
    const next = !!on;
    if (next === hidden) return;
    hidden = next;
    const r = rig;
    if (r) {
      if (hidden) {
        syncBed();                               // stops the scheduler
        aimMaster(r);                            // to 0 in 150 ms
        parkAfter(160);
      } else if (!muted) {
        wake(r);
      }
    }
    emitState();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    wanted = false;
    clearTimeout(parkTimer);
    clearTimeout(bed.timer);
    parkTimer = 0;
    bed.timer = 0;
    bed.on = false;
    bed.pad = null;
    for (const v of voices) kill(v);
    voices = [];
    stingers.clear();
    renderGen++;
    stopRender();
    dropPrepared();
    const r = rig;
    rig = null;
    unlocked = false;
    if (r) {
      r.ctx.removeEventListener('statechange', onStateChange);
      try { r.ctx.close().then(noop, noop); } catch { /* already closed */ }
    }
  }

  return {
    unlock,
    get unlocked() { return unlocked; },
    play,
    setTension,
    music,
    setSuspense,
    duck,
    setPalette,
    setMuted,
    applySettings,
    cancelScheduled,
    setHidden,
    dispose,
  };
}
