// Unit tests of src/ui/audio.js and src/ui/speech.js (SPEC §14.5, §10.5; CONTRACT-NOTES item 81). Package X4.
//
// The three tests the contract names come first; they read only the pure tables. The rest drives the real engine
// against a small fake of the Web Audio API that records every node, every scheduled value and the start and stop
// time of every source, so the behaviour the contract describes (no context before unlock, the voice caps, the
// 30 ms rule, mute, cancelScheduled, pre-rendered stingers, ducking) is checked without a browser.
// How it sounds is measured separately in headless Chrome (dev/audio.html?measure=1).
//
// A test of this file fails when the engine misbehaves; it never hangs and never allocates without bound
// (CONTRACT-NOTES N-125). Four things see to that, and a new test must keep them:
//   - every test has a time limit (TEST_TIMEOUT_MS): a promise the engine never settles fails the test;
//   - a promise of the engine is awaited through within(), which gives up after a few turns of the event loop;
//   - the fake timers have a budget (TIMER_BUDGET, TASK_BUDGET): an engine that arms timers without end is stopped;
//   - a failed assertion never prints samples: node builds its message by printing both values in full and comparing
//     the lines, which for one FakeBuffer with its samples takes gigabytes. The samples of a FakeBuffer and the curve
//     of the limiter are therefore not enumerable, and objects are compared with same().

import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

import { createAudio, RECIPE_SOURCES, PRERENDERED, bedVoices } from '../../../src/ui/audio.js';
import { createSpeech } from '../../../src/ui/speech.js';

/** The time limit of every test of this file. The whole file runs in about a second. */
const TEST_TIMEOUT_MS = 20000;
/** How many timers the engine may arm in one test. The test that arms most (the 20-source budget of the music bed) arms about 3300. */
const TIMER_BUDGET = 10000;
/** How many timer tasks a test may run one by one (taskTimers). A run of stinger renders takes twelve; the longest test runs 100. */
const TASK_BUDGET = 400;
/** How many turns of the event loop within() waits for a promise of the engine. */
const WAIT_TURNS = 50;

/** A test with the time limit. @param {string} name @param {(t: import('node:test').TestContext) => void|Promise<void>} fn */
const test = (name, fn) => nodeTest(name, { timeout: TEST_TIMEOUT_MS }, fn);

/**
 * The same object (or the same primitive)? Unlike assert.equal() it never prints the two values.
 * @param {unknown} actual @param {unknown} expected @param {string} [message]
 */
function same(actual, expected, message = 'the two are the same object') {
  assert.ok(Object.is(actual, expected), message);
}

/** The 43 names of SfxName (SPEC §4.28.3), in the order the contract lists them. */
const SFX_NAMES = [
  'ui.tap', 'ui.open', 'ui.close', 'chat.tick', 'chat.send', 'chat.receive', 'select', 'deselect', 'illegal', 'place',
  'move.rook', 'move.horse', 'move.cannon', 'move.elephant', 'move.advisor', 'move.king', 'move.pawn', 'river', 'capture', 'cannon.fire', 'blast',
  'trial.lift', 'trial.retract', 'trial.confirm', 'check.give', 'check.take', 'check.soft', 'win', 'lose', 'draw', 'hint.1', 'hint.2', 'hint.3',
  'fan.sweep', 'stamp', 'praise.good', 'praise.great', 'praise.brilliant', 'warn', 'arrow', 'undo', 'deal', 'turn.yours',
];

// ---------------------------------------------------------------------------------------------------------------------
// The three tests of SPEC §14.5
// ---------------------------------------------------------------------------------------------------------------------

test('no live recipe exceeds 30 sources', () => {
  assert.deepEqual(Object.keys(RECIPE_SOURCES).sort(), [...SFX_NAMES].sort(), 'every SfxName has a count, and nothing else');
  for (const name of SFX_NAMES) {
    const n = RECIPE_SOURCES[/** @type {keyof typeof RECIPE_SOURCES} */ (name)];
    assert.ok(Number.isInteger(n) && n >= 1, `${name}: ${n} sources`);
    if (!PRERENDERED.includes(/** @type {keyof typeof RECIPE_SOURCES} */ (name))) assert.ok(n <= 30, `${name} is live and creates ${n} sources`);
  }
});

test('pre-rendered stingers are listed', () => {
  // §10.5.1: "the long stingers win, deal, check.give, check.take, blast and stamp are rendered once into AudioBuffers"
  assert.deepEqual([...PRERENDERED].sort(), ['blast', 'check.give', 'check.take', 'deal', 'stamp', 'win']);
  assert.equal(new Set(PRERENDERED).size, PRERENDERED.length);
  // the two recipes that could not be played live inside the budget are among them
  for (const name of SFX_NAMES) {
    if (RECIPE_SOURCES[/** @type {keyof typeof RECIPE_SOURCES} */ (name)] > 30) assert.ok(PRERENDERED.includes(/** @type {keyof typeof RECIPE_SOURCES} */ (name)), name);
  }
});

test('the music bed at tension 1 stays within 20 voices', () => {
  assert.ok(bedVoices(1) <= 20, `bedVoices(1) = ${bedVoices(1)}`);
  for (let i = 0; i <= 20; i++) {
    const x = i / 20;
    const n = bedVoices(x);
    assert.ok(Number.isInteger(n) && n <= 20, `bedVoices(${x}) = ${n}`);
    assert.ok(n >= 5 + 2, `bedVoices(${x}) = ${n}: at least the pad (4 oscillators and its LFO) and one melody note`);
  }
  // the bed gets denser, not just louder: the busiest moment at full tension has more voices than the calm opening
  assert.ok(bedVoices(1) > bedVoices(0.1));
  // out-of-range input is clamped
  assert.equal(bedVoices(2), bedVoices(1));
  assert.equal(bedVoices(-1), bedVoices(0));
});

// ---------------------------------------------------------------------------------------------------------------------
// The recipe table against the contract
// ---------------------------------------------------------------------------------------------------------------------

test('RECIPE_SOURCES is the table of 10.5.3 counted by hand', () => {
  // Counted from the contract text with the primitives of §10.5.2:
  // tone 1 · noise 1 (2 with `am`: the square LFO) · pluck 3 (two oscillators + the pick click; 2 when bright < 1)
  // · chime 3 · gong 6 (five partials + noise) · drum 2 · place 3 · the erhu voice of `lose` 2 (sawtooth + vibrato LFO).
  const tone = 1, noise = 1, pluck = 3, darkPluck = 2, chime = 3, gong = 6, drum = 2, place = 3;
  const expected = {
    'ui.tap': tone,
    'ui.open': noise,
    'ui.close': noise,
    'chat.tick': tone,
    'chat.send': tone,
    'chat.receive': 2 * tone,
    'select': noise + tone,
    'deselect': tone,
    'illegal': tone + noise,
    'place': place,
    'move.rook': noise + place,
    'move.horse': 2 * (noise + tone) + place,
    'move.cannon': (noise + 1) + place,
    'move.elephant': tone + noise + place,
    'move.advisor': noise + place,
    'move.king': tone + noise + place,
    'move.pawn': place,
    'river': noise + 3 * tone,
    'capture': noise + 6 * tone + tone,
    'cannon.fire': noise + tone,
    'blast': noise + tone + 5 * noise,
    'trial.lift': 2 * pluck,
    'trial.retract': tone + noise,
    'trial.confirm': place + drum + pluck,
    'check.give': gong + 3 * pluck,
    'check.take': gong + 2,
    'check.soft': gong,
    'win': 6 * pluck + 3 * pluck + gong + 5 * drum,
    'lose': drum + 2,
    'draw': 2 * pluck + gong,
    'hint.1': chime,
    'hint.2': 2 * chime,
    'hint.3': 3 * chime,
    'fan.sweep': noise,
    'stamp': place + drum + 2 * pluck,
    'praise.good': 2 * pluck,
    'praise.great': 4 * pluck,
    'praise.brilliant': 6 * pluck + chime + noise,
    'warn': 2 * darkPluck,
    'arrow': tone,
    'undo': tone + 2 * noise,
    'deal': 12 * place + drum + 2 * pluck,
    'turn.yours': 2 * chime,
  };
  assert.deepEqual({ ...RECIPE_SOURCES }, expected);
  assert.equal(expected.win, 43);
  assert.equal(expected.deal, 44);
});

// ---------------------------------------------------------------------------------------------------------------------
// A fake Web Audio API
// ---------------------------------------------------------------------------------------------------------------------

/** @param {unknown} x @param {string} what */
function finite(x, what) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${what} is not a finite number: ${x}`);
}

class FakeParam {
  /** @param {number} value */
  constructor(value) {
    this.value = value;
    /** @type {{kind:string, v?:number, t:number, tc?:number}[]} */
    this.events = [];
    /** The value the parameter holds until its first scheduled event: what `.value` was when scheduling began. @type {number|null} */
    this.before = null;
  }
  /** @param {{kind:string, v?:number, t:number, tc?:number}} event */
  add(event) {
    if (this.before === null) this.before = this.value;
    this.events.push(event);
    if (event.v !== undefined) this.value = event.v;
    return this;
  }
  /** @param {number} v @param {number} t */
  setValueAtTime(v, t) { finite(v, 'value'); finite(t, 'time'); if (t < 0) throw new RangeError('negative time'); return this.add({ kind: 'set', v, t }); }
  /** @param {number} v @param {number} t */
  linearRampToValueAtTime(v, t) { finite(v, 'value'); finite(t, 'time'); if (t < 0) throw new RangeError('negative time'); return this.add({ kind: 'linear', v, t }); }
  /** @param {number} v @param {number} t */
  exponentialRampToValueAtTime(v, t) {
    finite(v, 'value'); finite(t, 'time');
    if (!(v > 0) || t < 0) throw new RangeError('an exponential ramp needs a positive value');
    return this.add({ kind: 'exp', v, t });
  }
  /** @param {number} v @param {number} t @param {number} tc */
  setTargetAtTime(v, t, tc) { finite(v, 'value'); finite(t, 'time'); finite(tc, 'time constant'); if (t < 0 || tc < 0) throw new RangeError('negative time'); return this.add({ kind: 'target', v, t, tc }); }
  /** @param {number} t */
  cancelScheduledValues(t) { finite(t, 'time'); if (t < 0) throw new RangeError('negative time'); return this.add({ kind: 'cancel', t }); }
  /** The last scheduled event of a kind. @param {string} kind */
  last(kind) { return this.events.filter(e => e.kind === kind).at(-1); }
}

class FakeNode {
  /** @param {FakeBase} ctx @param {string} kind */
  constructor(ctx, kind) {
    this.context = ctx;
    // not enumerable: through its context a node reaches every node and buffer of a test (see the top)
    Object.defineProperty(this, 'context', { enumerable: false });
    this.kind = kind;
    /** @type {(FakeNode|FakeParam)[]} */
    this.outputs = [];
    ctx.nodes.push(this);
  }
  /** @param {FakeNode|FakeParam} target */
  connect(target) {
    if (!(target instanceof FakeNode) && !(target instanceof FakeParam)) throw new TypeError('connect() needs a node or a param');
    this.outputs.push(target);
    return target;
  }
  disconnect() { this.outputs = []; }
}

class FakeSource extends FakeNode {
  /** @param {FakeBase} ctx @param {string} kind */
  constructor(ctx, kind) {
    super(ctx, kind);
    /** @type {number|null} */
    this.startAt = null;
    this.stopAt = Infinity;
    this.bornAt = ctx.currentTime;
  }
  /** @param {number} [t] */
  start(t = 0) {
    if (this.startAt !== null) throw new Error('InvalidStateError: started twice');
    finite(t, 'start time');
    if (t < 0) throw new RangeError('negative start time');
    this.startAt = t;
    this.context.started.push(this);
  }
  /** @param {number} [t] */
  stop(t = 0) {
    if (this.startAt === null) throw new Error('InvalidStateError: stop before start');
    finite(t, 'stop time');
    if (t < 0) throw new RangeError('negative stop time');
    this.stopAt = t;
  }
}

class FakeBuffer {
  /** @param {number} channels @param {number} length @param {number} sampleRate */
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    /** The samples, one array per channel. Not enumerable: a failed assertion must never print them (see the top). @type {Float32Array[]} */
    this.data = [];
    Object.defineProperty(this, 'data', { value: Array.from({ length: channels }, () => new Float32Array(length)), enumerable: false });
  }
  /** @param {number} ch */
  getChannelData(ch) { return this.data[ch]; }
}

class FakeBase {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    /** @type {FakeNode[]} */
    this.nodes = [];
    /** @type {FakeSource[]} */
    this.started = [];
    this.destination = new FakeNode(this, 'destination');
  }
  createGain() { return Object.assign(new FakeNode(this, 'gain'), { gain: new FakeParam(1) }); }
  createBiquadFilter() { return Object.assign(new FakeNode(this, 'biquad'), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0), detune: new FakeParam(0) }); }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(this, 'compressor'), {
      threshold: new FakeParam(-24), knee: new FakeParam(30), ratio: new FakeParam(12), attack: new FakeParam(0.003), release: new FakeParam(0.25),
    });
  }
  createConvolver() { return Object.assign(new FakeNode(this, 'convolver'), { buffer: /** @type {FakeBuffer|null} */ (null), normalize: true }); }
  createWaveShaper() {
    const node = Object.assign(new FakeNode(this, 'waveshaper'), { curve: /** @type {Float32Array|null} */ (null), oversample: 'none' });
    // 4097 points: writable as before, but not enumerable, for the same reason as the samples of a FakeBuffer
    Object.defineProperty(node, 'curve', { value: null, writable: true, enumerable: false });
    return node;
  }
  createOscillator() { return Object.assign(new FakeSource(this, 'oscillator'), { type: 'sine', frequency: new FakeParam(440), detune: new FakeParam(0) }); }
  createBufferSource() { return Object.assign(new FakeSource(this, 'buffer-source'), { buffer: /** @type {FakeBuffer|null} */ (null), loop: false, playbackRate: new FakeParam(1) }); }
  /** @param {number} channels @param {number} length @param {number} sampleRate */
  createBuffer(channels, length, sampleRate) { return new FakeBuffer(channels, length, sampleRate); }
}

class FakeContext extends FakeBase {
  /** @type {FakeContext[]} */
  static instances = [];
  constructor() {
    super();
    this.state = 'suspended';
    /** Outside a user gesture a browser leaves resume() pending. */
    this.blocked = false;
    /** When set, suspend() takes effect only when the test runs the function it parks here (a real context suspends asynchronously). */
    this.slowSuspend = false;
    /** @type {(() => void)[]} */
    this.parked = [];
    /** @type {(() => void)[]} */
    this.listeners = [];
    FakeContext.instances.push(this);
  }
  /** @param {string} type @param {() => void} cb */
  addEventListener(type, cb) { if (type === 'statechange') this.listeners.push(cb); }
  /** @param {string} type @param {() => void} cb */
  removeEventListener(type, cb) { if (type === 'statechange') this.listeners = this.listeners.filter(l => l !== cb); }
  /** @param {string} state */
  to(state) { if (this.state === state) return; this.state = state; for (const cb of [...this.listeners]) cb(); }
  resume() {
    if (this.blocked) return new Promise(() => {});
    this.to('running');
    return Promise.resolve();
  }
  suspend() {
    if (!this.slowSuspend) { this.to('suspended'); return Promise.resolve(); }
    return new Promise(resolve => { this.parked.push(() => { this.to('suspended'); resolve(undefined); }); });
  }
  close() { this.to('closed'); return Promise.resolve(); }
}

class FakeOffline extends FakeBase {
  /** @type {FakeOffline[]} */
  static instances = [];
  /** When set, renders stay pending until the test calls a resolver. @type {(() => void)[]|null} */
  static held = null;
  /** How many of the next constructions throw (a browser that is out of contexts). */
  static refuse = 0;
  /** The contexts, by their index in `instances`, whose render fails. @type {Set<number>} */
  static failing = new Set();
  /** @param {number} channels @param {number} length @param {number} sampleRate */
  constructor(channels, length, sampleRate) {
    if (FakeOffline.refuse > 0) { FakeOffline.refuse--; throw new Error('NotSupportedError: no OfflineAudioContext'); }
    super();
    this.channels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.index = FakeOffline.instances.length;
    FakeOffline.instances.push(this);
  }
  startRendering() {
    if (FakeOffline.failing.has(this.index)) return Promise.reject(new Error('the render failed'));
    const buffer = new FakeBuffer(this.channels, this.length, this.sampleRate);
    this.rendered = buffer;
    const held = FakeOffline.held;
    if (!held) return Promise.resolve(buffer);
    return new Promise(resolve => { held.push(() => resolve(buffer)); });
  }
}

const G = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));

/**
 * Installs the fake API, a `window` that records the audio events, and mock timers.
 * @param {import('node:test').TestContext} t
 */
function install(t) {
  const saved = { AudioContext: G.AudioContext, OfflineAudioContext: G.OfflineAudioContext, window: G.window };
  FakeContext.instances = [];
  FakeOffline.instances = [];
  FakeOffline.held = null;
  FakeOffline.refuse = 0;
  FakeOffline.failing = new Set();
  const win = new EventTarget();
  /** @type {string[]} */
  const events = [];
  win.addEventListener('audio:unlocked', () => events.push('unlocked'));
  win.addEventListener('audio:state', e => events.push(`state:${/** @type {CustomEvent} */ (e).detail.state}`));
  G.AudioContext = FakeContext;
  G.OfflineAudioContext = FakeOffline;
  G.window = win;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The mock timers run a chain of zero-delay timers to its end inside one tick(): an engine that arms the next
  // timer for ever would keep the test inside that tick. The budget ends it (the mock restores the real timers).
  const mocked = /** @type {(...args: unknown[]) => unknown} */ (G.setTimeout);
  let armed = 0;
  G.setTimeout = (/** @type {unknown[]} */ ...args) => {
    if (++armed > TIMER_BUDGET) throw new Error(`the engine armed more than ${TIMER_BUDGET} timers in one test`);
    return mocked(...args);
  };
  t.after(() => {
    G.AudioContext = saved.AudioContext;
    G.OfflineAudioContext = saved.OfflineAudioContext;
    G.window = saved.window;
  });
  return { events };
}

/** Lets promise callbacks run. */
const settle = () => new Promise(resolve => setImmediate(resolve));

/**
 * Waits for a promise of the engine, but not for ever: with fake timers such a promise settles within a few turns of
 * the event loop or not at all, and one that does not settle fails the test here (CONTRACT-NOTES N-125).
 * @template T
 * @param {Promise<T>} promise @param {string} [what]
 * @returns {Promise<T>}
 */
async function within(promise, what = 'the promise of unlock()') {
  /** @type {{value: T}|{error: unknown}|null} */
  let outcome = null;
  promise.then(value => { outcome = { value }; }, error => { outcome = { error }; });
  for (let turn = 0; turn < WAIT_TURNS && !outcome; turn++) await settle();
  const o = /** @type {{value: T}|{error: unknown}|null} */ (outcome);
  if (!o) throw new Error(`${what} is still pending after ${WAIT_TURNS} turns of the event loop`);
  if ('error' in o) throw o.error;
  return o.value;
}

/**
 * Lets the engine set up and finish its stinger renders. They are set up after the gesture, in zero-delay timer
 * tasks (CONTRACT-NOTES M-121); the mock timers run that whole chain in one tick.
 * @param {import('node:test').TestContext} t
 */
async function renders(t) {
  t.mock.timers.tick(0);
  await settle();
}

/**
 * The first unlock() of an engine, to its end: the promise resolves when the stingers are rendered.
 * @param {import('node:test').TestContext} t @param {ReturnType<typeof createAudio>} audio
 */
async function firstUnlock(t, audio) {
  const unlocking = audio.unlock();
  await renders(t);
  return within(unlocking);
}

/** An unlocked engine on a fake context. @param {import('node:test').TestContext} t */
async function unlocked(t) {
  const { events } = install(t);
  const audio = createAudio();
  const ok = await firstUnlock(t, audio);
  assert.equal(ok, true);
  await settle();
  const ctx = FakeContext.instances[0];
  return { audio, ctx, events };
}

/**
 * Moves the fake clock and the timers forward together.
 * @param {import('node:test').TestContext} t @param {FakeBase} ctx @param {number} seconds
 */
async function advance(t, ctx, seconds) {
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) {
    ctx.currentTime = Math.round((ctx.currentTime + 0.05) * 1e6) / 1e6;
    t.mock.timers.tick(50);
    if (i % 20 === 19) await settle();
  }
  await settle();
}

/** Can the signal of this node reach the destination, or a parameter it modulates (an LFO)? @param {FakeNode} node */
function reaches(node) {
  const seen = new Set();
  /** @type {(FakeNode|FakeParam)[]} */
  const todo = [node];
  while (todo.length) {
    const n = todo.pop();
    if (!n || seen.has(n)) continue;
    if (n instanceof FakeParam) return true;
    seen.add(n);
    if (n === node.context.destination) return true;
    todo.push(...n.outputs);
  }
  return false;
}

/** The pad: the sources that never stop. @param {FakeSource[]} sources */
const padOf = sources => sources.filter(s => s.stopAt === Infinity);

/** A source makes sound if it plays for some time and is connected through to the destination. @param {FakeSource} s */
const sounds = s => s.startAt !== null && s.stopAt > s.startAt && reaches(s);

/** The largest number of sources that sound at the same moment. @param {FakeSource[]} sources */
function peak(sources) {
  /** @type {[number, number][]} */
  const events = [];
  for (const s of sources) if (sounds(s) && s.startAt !== null) { events.push([s.startAt, 1]); events.push([s.stopAt, -1]); }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let n = 0;
  let max = 0;
  for (const [, d] of events) { n += d; if (n > max) max = n; }
  return max;
}

/** The nodes of the graph of §10.5.1, found by their place in it. @param {FakeContext} ctx */
function graph(ctx) {
  const comp = ctx.nodes.find(n => n.kind === 'compressor');
  assert.ok(comp, 'a DynamicsCompressor');
  // the soft limiter of CONTRACT-NOTES K-98 stands between the compressor and the destination
  const limiter = ctx.nodes.find(n => n.kind === 'waveshaper');
  assert.ok(limiter, 'a WaveShaper');
  const feeders = ctx.nodes.filter(n => n.outputs.includes(ctx.destination));
  assert.ok(feeders.length === 1 && feeders[0] === limiter, 'only the limiter feeds the destination');
  const limitIn = ctx.nodes.find(n => n.kind === 'gain' && n.outputs.includes(limiter));
  assert.ok(limitIn, 'gain -> limiter');
  assert.ok(comp.outputs.length === 1 && comp.outputs[0] === limitIn, 'compressor -> gain -> limiter, and nowhere else');
  const master = ctx.nodes.find(n => n.kind === 'gain' && n.outputs.includes(comp));
  assert.ok(master, 'master -> compressor');
  const convolvers = ctx.nodes.filter(n => n.kind === 'convolver');
  assert.equal(convolvers.length, 1, 'one convolver');
  const reverbOut = convolvers[0].outputs[0];
  const lowpass = ctx.nodes.find(n => n.kind === 'biquad' && n.outputs.includes(master));
  assert.ok(lowpass, 'musicLowpass -> master');
  const duck = ctx.nodes.find(n => n.kind === 'gain' && n.outputs.includes(lowpass));
  assert.ok(duck, 'duck -> musicLowpass');
  const musicBus = ctx.nodes.find(n => n.kind === 'gain' && n.outputs.includes(duck));
  assert.ok(musicBus, 'musicBus -> duck');
  const sfxBus = ctx.nodes.find(n => n.kind === 'gain' && n !== reverbOut && n.outputs.includes(master));
  assert.ok(sfxBus, 'sfxBus -> master');
  const p = (/** @type {FakeNode} */ node, /** @type {string} */ name) => /** @type {FakeParam} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (node))[name]);
  return { comp, limiter, limitIn, master, reverbOut, lowpass, duck, musicBus, sfxBus, p };
}

// ---------------------------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------------------------

test('no AudioContext exists before unlock, and nothing played before it is queued', async t => {
  install(t);
  const audio = createAudio();
  assert.equal(audio.unlocked, false);
  // every method is safe before unlock and none of them creates a context
  audio.play('place');
  audio.play('win', { when: 0.5 });
  audio.setTension(0.8);
  audio.setSuspense(true);
  audio.setSuspense(false);
  audio.duck(10, true);
  audio.duck(10, false);
  audio.setPalette('shachang');
  audio.setPalette('chibi');
  audio.applySettings({ sfx: true, music: true, volume: 1 });
  audio.setMuted(true);
  audio.setMuted(false);
  audio.setHidden(true);
  audio.setHidden(false);
  audio.cancelScheduled();
  audio.music.setScene('victory');
  audio.music.setScene('game');
  audio.music.stop();
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(FakeContext.instances.length, 0, 'no AudioContext before unlock()');
  assert.equal(FakeOffline.instances.length, 0, 'no OfflineAudioContext before unlock()');
  assert.equal(audio.unlocked, false);

  assert.equal(await firstUnlock(t, audio), true);
  assert.equal(FakeContext.instances.length, 1);
  assert.equal(audio.unlocked, true);
  const ctx = FakeContext.instances[0];
  await advance(t, ctx, 2);
  assert.equal(ctx.started.length, 0, 'the sounds asked for before unlock were not queued');
});

test('unlock is idempotent: one context, one audio:unlocked event', async t => {
  const { events } = install(t);
  const audio = createAudio();
  const gesture = Promise.all([audio.unlock(), audio.unlock(), audio.unlock()]);
  await renders(t);
  const results = await within(gesture);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(await within(audio.unlock()), true);
  assert.equal(FakeContext.instances.length, 1);
  assert.equal(FakeContext.instances[0].state, 'running');
  assert.deepEqual(events, ['unlocked', 'state:running']);
});

test('unlock resolves false where there is no Web Audio, and the engine stays inert', async t => {
  install(t);
  G.AudioContext = undefined;
  const audio = createAudio();
  assert.equal(await within(audio.unlock()), false);
  assert.equal(audio.unlocked, false);
  audio.play('place');
  audio.music.start();
  audio.dispose();
});

test('the graph of 10.5.1: buses, reverb return, master and compressor', async t => {
  const { ctx } = await unlocked(t);
  const g = graph(ctx);
  assert.equal(g.p(g.sfxBus, 'gain').value, 0.8);
  assert.equal(g.p(g.musicBus, 'gain').value, 0.5);
  assert.equal(g.p(g.reverbOut, 'gain').value, 0.5);
  assert.ok(g.reverbOut.outputs.includes(g.master), 'reverbOut -> master');
  assert.ok(Math.abs(g.p(g.master, 'gain').value - 0.9) < 1e-12, 'master = 0.9 at the default volume');
  assert.equal(g.p(g.lowpass, 'frequency').value, 18000);
  assert.equal(g.p(g.comp, 'threshold').value, -14);
  assert.equal(g.p(g.comp, 'knee').value, 12);
  assert.equal(g.p(g.comp, 'ratio').value, 6);
  assert.equal(g.p(g.comp, 'attack').value, 0.003);
  assert.equal(g.p(g.comp, 'release').value, 0.18);
  // the impulse: 1.1 s, stereo; the shared noise: 2 s, mono
  const convolver = /** @type {{buffer:FakeBuffer}} */ (/** @type {unknown} */ (ctx.nodes.find(n => n.kind === 'convolver')));
  assert.equal(convolver.buffer.numberOfChannels, 2);
  assert.equal(convolver.buffer.length, Math.floor(44100 * 1.1));
});

test('the soft limiter after the compressor: unchanged below -2 dBFS, a smooth knee, never 0 dBFS (K-98)', async t => {
  const { ctx } = await unlocked(t);
  const g = graph(ctx);
  const shaper = /** @type {{curve:Float32Array|null, oversample:string}} */ (/** @type {unknown} */ (g.limiter));
  const curve = shaper.curve;
  assert.ok(curve instanceof Float32Array, 'the limiter has a curve');
  assert.equal(shaper.oversample, 'none', 'no oversampling: no latency and no filter in the straight part');
  const n = curve.length;
  assert.ok(n % 2 === 1 && n >= 1025, `${n} points: odd, so that silence maps to a point of the curve`);
  const drive = g.p(g.limitIn, 'gain').value;
  assert.ok(drive > 0 && drive <= 0.5, 'the input is scaled down so the curve also covers stacks above 0 dBFS');
  /**
   * The output for an input sample x, as a WaveShaperNode computes it (Web Audio API, WaveShaperNode.curve): the
   * scaled input is clamped to -1..1 and the curve is read by linear interpolation.
   * @param {number} x
   */
  const out = x => {
    const v = (n - 1) / 2 * (Math.min(1, Math.max(-1, x * drive)) + 1);
    const k = Math.min(n - 2, Math.floor(v));
    return curve[k] + (v - k) * (curve[k + 1] - curve[k]);
  };
  const db = (/** @type {number} */ x) => 20 * Math.log10(Math.abs(x));
  const knee = 10 ** (-2 / 20);

  // 1. transparent up to -2 dBFS: sample for sample the output is the input
  assert.equal(out(0), 0);
  for (let i = 0; i <= 4000; i++) {
    const x = knee * i / 4000;
    assert.ok(Math.abs(out(x) - x) < 1e-6 && Math.abs(out(-x) + x) < 1e-6, `linear at ${x}: ${out(x)}`);
  }
  // so no single effect is touched: the loudest in play is capture x1.4 at -2.2 dBFS (the table of §10.5.3 peaks at -2.1)
  for (const peakDb of [-2.1, -2.2, -2.5, -3.5, -5.5, -12.7, -37.9]) {
    const x = 10 ** (peakDb / 20);
    assert.ok(Math.abs(db(out(x)) - peakDb) < 0.001, `a peak of ${peakDb} dBFS stays ${peakDb} dBFS`);
  }

  // 2. above the knee: never louder than the input, never 0 dBFS, whatever comes in
  let last = -Infinity;
  for (let i = -6000; i <= 6000; i++) {
    const x = i / 1000;                                    // -6 .. +6: up to +15.6 dBFS
    const y = out(x);
    assert.ok(y >= last, `monotonic at ${x}`);
    assert.ok(Math.abs(y) <= Math.abs(x) + 1e-6, `never louder than the input at ${x}`);
    assert.ok(Math.abs(y) < 1, `below 0 dBFS at ${x}: ${y}`);
    assert.ok(Math.abs(out(-x) + y) < 1e-6, `the same for both polarities at ${x}`);
    last = y;
  }
  for (const x of [10, 100, 1e6]) assert.ok(out(x) < 1 && out(-x) > -1, `below 0 dBFS at ${x}`);
  assert.ok(db(out(1e6)) <= -0.25, `the ceiling is ${db(out(1e6)).toFixed(2)} dBFS`);
  // the stacks that reached +0.3 .. +0.6 dBFS before the limiter existed
  for (const overDb of [0, 0.3, 0.6, 3, 6]) {
    const y = db(out(10 ** (overDb / 20)));
    assert.ok(y < -0.3 && y > -2, `+${overDb} dBFS comes out at ${y.toFixed(2)} dBFS`);
  }

  // 3. a smooth knee: the slope leaves 1 gently and only ever falls; there is no corner anywhere
  const step = 1 / 4096;
  let slope = 1;
  for (let x = knee - 0.01; x < 4; x += step) {
    const s = (out(x + step) - out(x)) / step;
    assert.ok(s <= slope + 1e-3, `the slope does not rise at ${x}`);
    assert.ok(slope - s < 0.02, `no corner at ${x}: the slope falls from ${slope} to ${s}`);
    slope = s;
  }
  assert.ok(slope < 1e-3, 'flat at the ceiling');
});

test('every recipe builds exactly RECIPE_SOURCES[name] source nodes, and every one of them is stopped', async t => {
  const { audio, ctx } = await unlocked(t);
  // the six stingers were rendered once, each in its own OfflineAudioContext, in the order of PRERENDERED
  assert.equal(FakeOffline.instances.length, PRERENDERED.length);
  PRERENDERED.forEach((name, i) => {
    const off = FakeOffline.instances[i];
    assert.equal(off.started.length, RECIPE_SOURCES[name], `${name}: sources in its offline render`);
    assert.equal(off.sampleRate, ctx.sampleRate);
    assert.ok(off.started.every(s => Number.isFinite(s.stopAt)), `${name}: every offline source stops`);
    const longest = Math.max(...off.started.map(s => s.stopAt));
    assert.ok(off.length / off.sampleRate >= longest + 1.1, `${name}: the buffer holds the sound and its 1.1 s reverb tail`);
  });
  for (const name of SFX_NAMES) {
    const key = /** @type {keyof typeof RECIPE_SOURCES} */ (name);
    ctx.currentTime += 10;                       // everything before has ended
    const before = ctx.started.length;
    audio.play(key);
    const made = ctx.started.slice(before);
    if (PRERENDERED.includes(key)) {
      assert.equal(made.length, 1, `${name} is played as one source`);
      assert.equal(made[0].kind, 'buffer-source');
      const buffer = /** @type {{buffer:FakeBuffer}} */ (/** @type {unknown} */ (made[0])).buffer;
      same(buffer, FakeOffline.instances[PRERENDERED.indexOf(key)].rendered, `${name} plays its rendered buffer`);
    } else {
      assert.equal(made.length, RECIPE_SOURCES[key], `${name}: sources created by play()`);
      assert.ok(made.every(s => Number.isFinite(s.stopAt) && s.startAt !== null && s.stopAt > s.startAt), `${name}: every source has a stop time`);
    }
    assert.ok(made.every(sounds), `${name} reaches the destination`);
    assert.ok(made.every(s => s.startAt !== null && s.startAt >= ctx.currentTime), `${name} starts now or later, never in the past`);
  }
});

test('no click at the onset: every envelope is closed before its first scheduled value', async t => {
  // A GainNode is born with gain 1. A source that starts one sample before the envelope's first scheduled value
  // (start times rarely fall on a sample) would pass at full level for that sample; measured in Chrome as a
  // single-sample spike of up to -5 dBFS at the onset of sounds that are scheduled ahead.
  const { audio, ctx } = await unlocked(t);
  /** The first gain downstream of a source that has an envelope. @param {FakeNode} from */
  const envelopeOf = from => {
    const seen = new Set();
    /** @type {(FakeNode|FakeParam)[]} */
    const todo = [from];
    while (todo.length) {
      const n = todo.shift();
      if (!n || seen.has(n) || !(n instanceof FakeNode)) continue;
      seen.add(n);
      const gain = /** @type {{gain?:FakeParam}} */ (/** @type {unknown} */ (n)).gain;
      if (n.kind === 'gain' && gain && gain.events.some(e => e.kind === 'linear' || e.kind === 'exp')) return gain;
      todo.push(...n.outputs);
    }
    return null;
  };
  let checked = 0;
  /** @param {FakeSource[]} sources @param {string} what */
  const check = (sources, what) => {
    for (const s of sources) {
      if (s.outputs.every(o => o instanceof FakeNode && o.outputs.some(p => p instanceof FakeParam))) continue;      // an LFO
      const gain = envelopeOf(s);
      if (s.kind === 'buffer-source' && /** @type {{loop:boolean}} */ (/** @type {unknown} */ (s)).loop === false) continue;   // a rendered stinger
      assert.ok(gain, `${what}: a ${s.kind} without an envelope`);
      assert.ok(gain.before !== null && gain.before <= 0.0001, `${what}: the envelope of a ${s.kind} is open (${gain.before}) before it begins`);
      checked++;
    }
  };
  for (const [i, name] of PRERENDERED.entries()) check(FakeOffline.instances[i].started, `${name} (offline)`);
  for (const name of SFX_NAMES) {
    ctx.currentTime += 10;
    const n = ctx.started.length;
    audio.play(/** @type {keyof typeof RECIPE_SOURCES} */ (name), { when: 0.3 });
    check(ctx.started.slice(n), name);
  }
  // the music bed: notes are always scheduled ahead
  t.mock.method(Math, 'random', () => 0);
  ctx.currentTime += 10;
  const n = ctx.started.length;
  audio.setTension(1);
  audio.music.start();
  await advance(t, ctx, 6);
  const notes = ctx.started.slice(n).filter(s => s.stopAt !== Infinity);
  assert.ok(notes.length > 60);
  check(notes, 'music');
  assert.ok(checked > 400);
});

test('play options: when, ms, scale, step and gain', async t => {
  const { audio, ctx } = await unlocked(t);
  const made = (/** @type {() => void} */ fn) => { ctx.currentTime += 10; const n = ctx.started.length; fn(); return ctx.started.slice(n); };
  const first = (/** @type {FakeSource[]} */ list) => Math.min(...list.map(s => /** @type {number} */ (s.startAt)));
  const last = (/** @type {FakeSource[]} */ list) => Math.max(...list.map(s => /** @type {number} */ (s.startAt)));

  // when: seconds from now
  const now = made(() => audio.play('place'));
  const later = made(() => audio.play('place', { when: 0.2 }));
  assert.ok(Math.abs((first(later) - ctx.currentTime) - (first(now) - (ctx.currentTime - 10)) - 0.2) < 1e-9, 'when: 0.2 starts 200 ms later');
  assert.ok(first(now) - (ctx.currentTime - 10) <= 0.01, 'a sound without `when` starts within 10 ms');

  // ms: the travel time of move.*; the wooden place lands at +ms
  const rook = made(() => audio.play('move.rook', { ms: 430 }));
  assert.ok(Math.abs(last(rook) - first(rook) - 0.43) < 1e-9, 'move.rook: the place lands at +430 ms');
  const pawn = made(() => audio.play('move.pawn', { ms: 210, when: 0.1 }));
  assert.ok(Math.abs(first(pawn) - first(made(() => audio.play('place'))) + 10 - 0.31) < 1e-9, 'move.pawn: place at when + ms');

  // scale: the victim scale of capture stretches its noise burst (d = 160·s ms)
  const noiseLen = (/** @type {FakeSource[]} */ list) => { const n = list.find(s => s.kind === 'buffer-source'); return n && n.startAt !== null ? n.stopAt - n.startAt : NaN; };
  const small = noiseLen(made(() => audio.play('capture', { scale: 0.6 })));
  const big = noiseLen(made(() => audio.play('capture', { scale: 1.25 })));
  assert.ok(Math.abs((big - small) - 0.16 * (1.25 - 0.6)) < 1e-9);

  // step: trial.lift walks up the pentatonic scale, s = step mod 5: deg(s + 3) then deg(s + 5)
  const D4 = 293.6648;
  const PENTA = [0, 2, 4, 7, 9];
  const deg = (/** @type {number} */ i) => D4 * 2 ** Math.floor(i / 5) * 2 ** (PENTA[i % 5] / 12);
  const sawPitches = (/** @type {FakeSource[]} */ list) => list
    .filter(s => /** @type {{type?:string}} */ (/** @type {unknown} */ (s)).type === 'sawtooth')
    .map(s => /** @type {{frequency:FakeParam}} */ (/** @type {unknown} */ (s)).frequency.last('exp')?.v);
  for (const step of [0, 1, 4, 5, 7]) {
    const pitches = sawPitches(made(() => audio.play('trial.lift', { step })));
    const s = step % 5;
    assert.equal(pitches.length, 2);
    assert.ok(Math.abs(/** @type {number} */ (pitches[0]) - deg(s + 3)) < 1e-6, `step ${step}: first pluck deg(${s + 3})`);
    assert.ok(Math.abs(/** @type {number} */ (pitches[1]) - deg(s + 5)) < 1e-6, `step ${step}: second pluck deg(${s + 5})`);
  }
  assert.ok(Math.abs(deg(3) - 440) < 0.01, 'deg(3) is A4');

  // gain scales the whole sound
  const quiet = made(() => audio.play('ui.tap', { gain: 0.5 }));
  const out = quiet[0].outputs[0];
  assert.ok(out instanceof FakeNode);
  const voiceGain = /** @type {FakeNode} */ (out.outputs.find(n => n instanceof FakeNode && n.kind === 'gain'));
  assert.equal(/** @type {{gain:FakeParam}} */ (/** @type {unknown} */ (voiceGain)).gain.value, 0.5);
});

test('the same name within 30 ms is dropped; chat.tick is limited to one per 70 ms', async t => {
  const { audio, ctx } = await unlocked(t);
  const count = () => ctx.started.length;
  audio.play('place');
  assert.equal(count(), 3);
  audio.play('place');
  assert.equal(count(), 3, 'same name at the same moment');
  ctx.currentTime += 0.02;
  audio.play('place');
  assert.equal(count(), 3, 'same name 20 ms later');
  audio.play('select');
  assert.equal(count(), 5, 'another name is not affected');
  ctx.currentTime += 0.02;
  audio.play('place');
  assert.equal(count(), 8, 'same name 40 ms later plays');
  // two plays with different `when` are two sounds
  ctx.currentTime += 1;
  audio.play('place', { when: 0.3 });
  audio.play('place', { when: 0.6 });
  assert.equal(count(), 14);

  ctx.currentTime += 5;
  const before = count();
  audio.play('chat.tick');
  ctx.currentTime += 0.05;
  audio.play('chat.tick');
  assert.equal(count(), before + 1, 'a tick 50 ms after the last one is dropped');
  ctx.currentTime += 0.03;
  audio.play('chat.tick');
  assert.equal(count(), before + 2, 'a tick 80 ms after the last one plays');
});

test('at most 48 effect sources are alive at once: chat ticks are dropped first, then UI sounds', async t => {
  const { audio, ctx } = await unlocked(t);
  const made = (/** @type {() => void} */ fn) => { const n = ctx.started.length; fn(); return ctx.started.slice(n); };
  // Stingers and piece sounds (priority 2) whose sources all begin on the first sample; counted at that moment:
  // draw 12 · check.soft 6 · lose 4 · move.elephant 5 · move.king 5 · hint.1 3 · illegal 2 · trial.retract 2
  // · warn 2 (its second pluck comes later) · undo 2 (its second tick comes later) · move.pawn 3  =  46
  const big = made(() => {
    audio.play('draw'); audio.play('check.soft'); audio.play('lose');
    audio.play('move.elephant', { ms: 0 }); audio.play('move.king', { ms: 0 });
    audio.play('hint.1'); audio.play('illegal'); audio.play('trial.retract'); audio.play('warn'); audio.play('undo');
    audio.play('move.pawn', { ms: 0 });
  });
  assert.equal(peak(big), 46);
  const tick = made(() => audio.play('chat.tick'));          // priority 0
  const tap = made(() => audio.play('ui.tap'));              // priority 1
  assert.equal(tick.length + tap.length, 2);
  assert.equal(peak(ctx.started), 48);
  // full. A UI sound takes the place of the chat tick ...
  const open = made(() => audio.play('ui.open'));
  assert.equal(open.length, 1);
  assert.equal(sounds(tick[0]), false, 'the chat tick was dropped for a UI sound');
  assert.equal(peak(ctx.started), 48);
  // ... a piece sound takes the place of the UI sounds ...
  const select = made(() => audio.play('select'));
  assert.equal(select.length, 2);
  assert.equal(sounds(tap[0]), false, 'ui.tap was dropped for a piece sound');
  assert.equal(sounds(open[0]), false, 'ui.open was dropped for a piece sound');
  assert.ok(select.every(sounds));
  assert.equal(peak(ctx.started), 48);
  // ... and when only stingers and piece sounds are left, new chat ticks and UI sounds are not started
  assert.equal(made(() => audio.play('chat.tick')).length, 0);
  assert.equal(made(() => audio.play('ui.close')).length, 0);
  // a piece sound that does not fit is not started either: the cap is hard, and no sounding stinger is cut
  assert.equal(made(() => audio.play('place')).length, 0);
  assert.ok(big.every(sounds));
  assert.equal(peak(ctx.started), 48);
  // once they have rung out there is room again
  ctx.currentTime += 5;
  assert.equal(made(() => audio.play('place')).length, 3);
  assert.ok(peak(ctx.started) <= 48);
});

test('mute: the master ramps to 0, play is a no-op, the context suspends after 300 ms; unmute resumes', async t => {
  const { audio, ctx, events } = await unlocked(t);
  const g = graph(ctx);
  audio.music.start();
  await advance(t, ctx, 1);
  assert.ok(ctx.started.length >= 5, 'the bed plays');

  audio.setMuted(true);
  assert.deepEqual(g.p(g.master, 'gain').last('target'), { kind: 'target', v: 0, t: ctx.currentTime, tc: 0.02 });
  assert.equal(events.at(-1), 'state:muted');
  const n = ctx.started.length;
  audio.play('place');
  audio.play('win');
  assert.equal(ctx.started.length, n, 'no sound while muted');
  t.mock.timers.tick(250);
  assert.equal(ctx.state, 'running', 'still running 250 ms after mute');
  t.mock.timers.tick(60);
  await settle();
  assert.equal(ctx.state, 'suspended', 'suspended 300 ms after mute');
  // a gesture while muted must not wake the context
  assert.equal(await within(audio.unlock()), true);
  assert.equal(ctx.state, 'suspended');
  t.mock.timers.tick(2000);
  assert.equal(ctx.started.length, n, 'the scheduler is stopped while muted');

  audio.setMuted(false);
  await settle();
  assert.equal(ctx.state, 'running');
  assert.ok(Math.abs(/** @type {number} */ (g.p(g.master, 'gain').last('target')?.v) - 0.9) < 1e-12, 'the master is back at 0.9');
  assert.equal(events.at(-1), 'state:running');
  audio.play('place');
  assert.equal(ctx.started.length - n >= 3, true, 'sound again');
  await advance(t, ctx, 1);
  assert.equal(padOf(ctx.started.slice(n)).length, 5, 'the bed restarted: a new pad');
});

test('an unmute outside a gesture is completed by the next gesture: the master comes back', async t => {
  const { audio, ctx } = await unlocked(t);
  const g = graph(ctx);
  audio.setMuted(true);
  t.mock.timers.tick(310);
  await settle();
  assert.equal(ctx.state, 'suspended');
  ctx.blocked = true;                            // e.g. settings applied by a timer: the browser will not resume
  audio.setMuted(false);
  await settle();
  assert.equal(ctx.state, 'suspended');
  assert.equal(g.p(g.master, 'gain').last('target')?.v, 0, 'still silent');
  ctx.blocked = false;                           // the next tap: the stage calls unlock() on every gesture
  assert.equal(await within(audio.unlock()), true);
  assert.equal(ctx.state, 'running');
  assert.ok(Math.abs(/** @type {number} */ (g.p(g.master, 'gain').last('target')?.v) - 0.9) < 1e-12, 'the master is back at 0.9');
  const n = ctx.started.length;
  audio.play('place');
  assert.equal(ctx.started.length, n + 3);
  // and a gesture while everything is in order schedules nothing on the master
  const events = g.p(g.master, 'gain').events.length;
  await within(audio.unlock());
  await within(audio.unlock());
  assert.equal(g.p(g.master, 'gain').events.length, events);
});

test('muted from the start: the first gesture creates the context but leaves it parked and silent', async t => {
  const { events } = install(t);
  const audio = createAudio();
  audio.setMuted(true);
  assert.equal(FakeContext.instances.length, 0);
  assert.equal(await firstUnlock(t, audio), true);
  const ctx = FakeContext.instances[0];
  const g = graph(ctx);
  assert.equal(g.p(g.master, 'gain').value, 0, 'the master starts at 0');
  t.mock.timers.tick(10);
  await settle();
  assert.equal(ctx.state, 'suspended');
  assert.equal(audio.unlocked, true);
  audio.play('place');
  assert.equal(ctx.started.length, 0);
  assert.ok(events.includes('state:muted') && !events.includes('state:running'));
});

test('cancelScheduled drops sounds scheduled with `when` that have not started, and nothing else', async t => {
  const { audio, ctx } = await unlocked(t);
  const made = (/** @type {() => void} */ fn) => { const n = ctx.started.length; fn(); return ctx.started.slice(n); };
  const sounding = made(() => audio.play('select'));                       // no `when`
  const early = made(() => audio.play('river', { when: 0.1 }));             // will have started
  const pending = made(() => audio.play('place', { when: 0.5 }));           // live recipe, not started
  const stinger = made(() => audio.play('blast', { when: 0.7 }));           // pre-rendered, not started
  assert.equal(pending.length, 3);
  assert.equal(stinger.length, 1);
  ctx.currentTime += 0.2;
  audio.cancelScheduled();
  assert.ok(pending.every(s => !sounds(s)), 'the pending place makes no sound');
  assert.ok(stinger.every(s => !sounds(s)), 'the pending blast makes no sound');
  assert.ok(sounding.every(sounds), 'a sound without `when` is left alone');
  assert.ok(early.every(sounds), 'a `when` sound that has started is left alone');
  // the music is no longer ducked for the blast that never came
  const g = graph(ctx);
  const duckEvents = g.p(g.duck, 'gain').events;
  const lastCancel = duckEvents.findLastIndex(e => e.kind === 'cancel');
  assert.ok(duckEvents.slice(lastCancel + 1).every(e => e.v === 1), 'the duck was withdrawn');
  // a dropped sound can be asked for again at once
  assert.equal(made(() => audio.play('place', { when: 0.3 })).length, 3);
});

test('ducking: check and win duck the music 8 dB for 1.2 s; duck(10, true) holds it 10 dB down', async t => {
  const { audio, ctx } = await unlocked(t);
  const g = graph(ctx);
  const duck = g.p(g.duck, 'gain');
  const low = 10 ** (-8 / 20);
  for (const name of /** @type {const} */ (['check.give', 'check.take', 'win', 'lose', 'blast'])) {
    ctx.currentTime += 10;
    const n = duck.events.length;
    const s = ctx.started.length;
    audio.play(name);
    const at = Math.min(.../** @type {number[]} */ (ctx.started.slice(s).map(x => x.startAt)));
    const added = duck.events.slice(n).filter(e => e.kind === 'target');
    assert.deepEqual(added.filter(e => e.t >= at), [{ kind: 'target', v: low, t: at, tc: 0.05 }, { kind: 'target', v: 1, t: at + 1.2, tc: 0.4 }], name);
    assert.ok(added.filter(e => e.t < at).every(e => e.v === 1), `${name}: the music is not ducked before the sound`);
  }
  ctx.currentTime += 10;
  const n = duck.events.length;
  audio.play('place');
  audio.play('capture');
  audio.play('praise.great');
  assert.equal(duck.events.length, n, 'other sounds do not duck');

  audio.duck(10, true);
  assert.ok(Math.abs(/** @type {number} */ (duck.last('target')?.v) - 10 ** (-10 / 20)) < 1e-12);
  audio.duck(10, false);
  assert.equal(duck.last('target')?.v, 1);

  audio.setSuspense(true);
  assert.equal(g.p(g.lowpass, 'frequency').last('target')?.v, 1600);
  audio.setSuspense(false);
  assert.equal(g.p(g.lowpass, 'frequency').last('target')?.v, 18000);
});

test('applySettings: volume is v squared on the master; sfx and music switch their buses', async t => {
  const { audio, ctx } = await unlocked(t);
  const g = graph(ctx);
  audio.music.start();
  await advance(t, ctx, 1);

  audio.applySettings({ sfx: true, music: true, volume: 0.5 });
  assert.ok(Math.abs(/** @type {number} */ (g.p(g.master, 'gain').last('target')?.v) - 0.9 * 0.25) < 1e-12);
  audio.applySettings({ sfx: true, music: true, volume: 7 });
  assert.ok(Math.abs(/** @type {number} */ (g.p(g.master, 'gain').last('target')?.v) - 0.9) < 1e-12, 'volume is clamped to 0..1');

  audio.applySettings({ sfx: false, music: true, volume: 1 });
  assert.equal(g.p(g.sfxBus, 'gain').last('target')?.v, 0);
  let n = ctx.started.filter(s => s.bornAt >= ctx.currentTime).length;
  audio.play('place');
  assert.equal(ctx.started.filter(s => s.bornAt >= ctx.currentTime).length, n, 'no effect while sfx is off');

  audio.applySettings({ sfx: true, music: false, volume: 1 });
  assert.equal(g.p(g.sfxBus, 'gain').last('target')?.v, 0.8);
  assert.equal(g.p(g.musicBus, 'gain').last('target')?.v, 0);
  await advance(t, ctx, 0.5);
  n = ctx.started.length;
  await advance(t, ctx, 3);
  assert.equal(ctx.started.length, n, 'the scheduler is stopped while music is off');
  assert.equal(peak(ctx.started.filter(s => s.stopAt > ctx.currentTime)), 0, 'no music voice is left sounding');

  audio.applySettings({ sfx: true, music: true, volume: 1 });
  assert.equal(g.p(g.musicBus, 'gain').last('target')?.v, 0.5);
  await advance(t, ctx, 1);
  assert.equal(padOf(ctx.started.slice(n)).length, 5, 'the bed is back: a new pad');
});

test('setHidden: scheduler stopped, master ramped to 0 in 150 ms, context suspended; visible again resumes', async t => {
  const { audio, ctx, events } = await unlocked(t);
  const g = graph(ctx);
  audio.music.start();
  await advance(t, ctx, 1);
  audio.setHidden(true);
  assert.deepEqual(g.p(g.master, 'gain').last('linear'), { kind: 'linear', v: 0, t: ctx.currentTime + 0.15 });
  assert.equal(events.at(-1), 'state:suspended');
  const n = ctx.started.length;
  audio.play('place');
  assert.equal(ctx.started.length, n, 'no sound while hidden');
  t.mock.timers.tick(140);
  assert.equal(ctx.state, 'running');
  t.mock.timers.tick(30);
  await settle();
  assert.equal(ctx.state, 'suspended');
  t.mock.timers.tick(3000);
  assert.equal(ctx.started.length, n);

  audio.setHidden(false);
  await settle();
  assert.equal(ctx.state, 'running');
  assert.ok(Math.abs(/** @type {number} */ (g.p(g.master, 'gain').last('target')?.v) - 0.9) < 1e-12);
  assert.equal(events.at(-1), 'state:running');
  await advance(t, ctx, 1);
  assert.equal(padOf(ctx.started.slice(n)).length, 5, 'the bed restarted: a new pad');
});

test('stingers are rendered at unlock and again after setPalette; a stinger asked for before its buffer exists is never late', async t => {
  install(t);
  FakeOffline.held = [];
  const audio = createAudio();
  const unlocking = audio.unlock();
  await settle();
  const ctx = FakeContext.instances[0];
  assert.equal(audio.unlocked, true, 'unlocked as soon as the context runs');
  assert.equal(FakeOffline.instances.length, 0, 'no render is set up inside the gesture, nor in a microtask after it');
  t.mock.timers.tick(0);
  assert.equal(FakeOffline.instances.length, 6);
  // the renders are still running: the deal of the first game is synthesised live, on time, inside the 48 cap
  audio.play('deal');
  assert.equal(ctx.started.length, RECIPE_SOURCES.deal);
  assert.ok(ctx.started.every(s => s.startAt !== null && s.startAt - ctx.currentTime < 0.8 + 0.01));
  assert.ok(peak(ctx.started) <= 48);
  for (const resolve of FakeOffline.held) resolve();
  FakeOffline.held = null;
  assert.equal(await within(unlocking), true, 'unlock() resolves when the stingers are ready');
  await settle();
  // from now on: one source
  ctx.currentTime += 5;
  const n = ctx.started.length;
  audio.play('deal');
  assert.equal(ctx.started.length, n + 1);
  assert.equal(ctx.started[n].kind, 'buffer-source');

  // a new palette renders the six again; the old buffers serve until then
  audio.setPalette('longzhong');
  assert.equal(FakeOffline.instances.length, 6, 'nor inside the tap that changes the theme');
  t.mock.timers.tick(0);
  assert.equal(FakeOffline.instances.length, 12);
  await settle();
  ctx.currentTime += 5;
  audio.play('win');
  const win = /** @type {{buffer:FakeBuffer}} */ (/** @type {unknown} */ (ctx.started.at(-1)));
  same(win.buffer, FakeOffline.instances[6 + PRERENDERED.indexOf('win')].rendered, 'win plays the buffer of the new palette');
  audio.setPalette('longzhong');
  assert.equal(FakeOffline.instances.length, 12, 'the same palette again renders nothing');
  // 隆中: reverb x0.8
  assert.ok(Math.abs(/** @type {number} */ (graph(ctx).p(graph(ctx).reverbOut, 'gain').last('target')?.v) - 0.5 * 0.8) < 1e-12);
});

test('without OfflineAudioContext the stingers are synthesised live', async t => {
  install(t);
  G.OfflineAudioContext = undefined;
  const audio = createAudio();
  assert.equal(await within(audio.unlock()), true);
  const ctx = FakeContext.instances[0];
  audio.play('stamp');
  assert.equal(ctx.started.length, RECIPE_SOURCES.stamp);
  assert.ok(ctx.started.every(sounds));
});

test('the music scheduler: a 16th-note grid at 66 + 30·T bpm, scheduled at most 200 ms ahead', async t => {
  const { audio, ctx } = await unlocked(t);
  t.mock.method(Math, 'random', () => 0.99);      // the melody stays silent except for the forced phrase end
  audio.setTension(0.5);
  audio.music.start();
  await advance(t, ctx, 20);
  for (const s of ctx.started) assert.ok(s.bornAt >= /** @type {number} */ (s.startAt) - 0.2 - 0.051, 'no voice is created more than a scheduler period before its 200 ms horizon');
  // bass at T = .5: tonic on step 0, fifth on step 8 -> one bass pluck every half bar. bpm = 81, a bar = 16 steps
  const bar = 16 * 60 / (66 + 30 * 0.5) / 4;
  const D2 = 293.6648 / 4;
  const bass = ctx.started.filter(s => /** @type {{type?:string}} */ (/** @type {unknown} */ (s)).type === 'sawtooth'
    && Math.abs(/** @type {number} */ (/** @type {{frequency:FakeParam}} */ (/** @type {unknown} */ (s)).frequency.last('exp')?.v) - D2) < 0.01);
  assert.ok(bass.length >= 4);
  for (let i = 1; i < bass.length; i++) {
    assert.ok(Math.abs(/** @type {number} */ (bass[i].startAt) - /** @type {number} */ (bass[i - 1].startAt) - bar) < 1e-6, 'the tonic returns every bar');
  }
  // the pad: four oscillators and one LFO that never stop while the music plays
  const pad = ctx.started.filter(s => s.stopAt === Infinity);
  assert.equal(pad.length, 5);
});

test('the music bed never has more than 20 sources alive, whatever the tension, mode, palette or scene does', async t => {
  const { audio, ctx } = await unlocked(t);
  // the densest melody the rules allow, at full tension
  t.mock.method(Math, 'random', () => 0);
  audio.setTension(1);
  audio.music.start();
  await advance(t, ctx, 40);
  const dense = peak(ctx.started);
  assert.ok(dense <= 20, `peak ${dense} at tension 1`);
  assert.ok(dense <= bedVoices(1), `the scheduler (${dense}) stays inside what bedVoices(1) = ${bedVoices(1)} predicts`);
  assert.ok(dense >= 15, `the bed at tension 1 is dense (${dense})`);

  // a wandering game: tension up and down through both modes, palette and scene changes on the way
  let seed = 7;
  t.mock.method(Math, 'random', () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; });
  const themes = /** @type {const} */ (['shachang', 'longzhong', 'chibi']);
  for (let i = 0; i < 60; i++) {
    audio.setTension(0.5 + 0.5 * Math.sin(i / 4));
    if (i % 13 === 5) audio.setPalette(themes[(i / 13 | 0) % 3]);
    if (i === 30) audio.music.setScene('victory');
    if (i === 36) audio.music.setScene('game');
    if (i === 48) audio.music.setScene('defeat');
    if (i === 52) audio.music.setScene('game');
    await advance(t, ctx, 2);
  }
  const all = peak(ctx.started);
  assert.ok(all <= 20, `peak ${all} over a wandering game`);
  audio.music.stop(400);
  await advance(t, ctx, 3);
  assert.equal(peak(ctx.started.filter(s => s.stopAt > ctx.currentTime)), 0, 'music.stop() leaves nothing sounding');
});

test('scenes: victory waits for the win stinger (2.4 s), then plays at 88 bpm; defeat at 60 bpm', async t => {
  const { audio, ctx } = await unlocked(t);
  t.mock.method(Math, 'random', () => 0);
  audio.setTension(0.3);
  audio.music.start();
  await advance(t, ctx, 4);
  const mark = ctx.started.length;
  audio.play('win');
  const winAt = /** @type {number} */ (ctx.started[mark].startAt);
  await advance(t, ctx, 0.5);
  audio.music.setScene('victory');
  await advance(t, ctx, 12);
  const after = ctx.started.slice(mark + 1).filter(s => s.bornAt > winAt + 0.5 && sounds(s));
  const first = Math.min(...after.map(s => /** @type {number} */ (s.startAt)));
  assert.ok(Math.abs(first - (winAt + 2.4)) < 1e-6, `the victory piece starts 2.4 s after the stinger (${(first - winAt).toFixed(3)} s)`);
  // 88 bpm: melody slots (even steps) are 2 · 60 / 88 / 4 s apart; with random() = 0 every allowed slot plays
  const slot = 2 * 60 / 88 / 4;
  const clicks = after.filter(s => s.kind === 'buffer-source').map(s => /** @type {number} */ (s.startAt)).sort((a, b) => a - b);
  const gaps = clicks.slice(1).map((x, i) => (x - clicks[i]) / slot).filter(x => x > 0.01);
  assert.ok(gaps.length > 8 && gaps.every(x => Math.abs(x - Math.round(x)) < 1e-6), 'notes sit on the 88 bpm grid');

  audio.play('lose');
  const loseAt = /** @type {number} */ (ctx.started.at(-1)?.startAt);
  audio.music.setScene('defeat');
  const m2 = ctx.started.length;
  await advance(t, ctx, 12);
  const calm = ctx.started.slice(m2).filter(sounds);
  const start = Math.min(...calm.map(s => /** @type {number} */ (s.startAt)));
  assert.ok(Math.abs(start - (loseAt + 2.0)) < 0.01, 'the defeat piece starts when the lose stinger is over');
  // 60 bpm, T = .05: the qin, an octave lower, and no drums or horn (only plucks: sawtooth + triangle, and the pad)
  assert.ok(calm.every(s => s.kind === 'oscillator'), 'no noise voices in the defeat scene: calm, not sad');
});

test('dispose closes the context and stops everything', async t => {
  const { audio, ctx } = await unlocked(t);
  audio.music.start();
  await advance(t, ctx, 1);
  audio.play('place');
  audio.dispose();
  assert.equal(ctx.state, 'closed');
  assert.equal(audio.unlocked, false);
  assert.equal(peak(ctx.started.filter(s => s.stopAt > ctx.currentTime)), 0);
  const n = ctx.started.length;
  audio.play('place');
  audio.music.start();
  t.mock.timers.tick(1000);
  assert.equal(ctx.started.length, n);
  assert.equal(await within(audio.unlock()), false);
  assert.equal(FakeContext.instances.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Review tests: what a suspension leaves behind, hostile input, the palette table, the pitches of the stingers
// ---------------------------------------------------------------------------------------------------------------------

/** @param {FakeNode} n */
const typeOf = n => /** @type {{type?:string}} */ (/** @type {unknown} */ (n)).type;
/** @param {FakeNode} n @param {string} name */
const paramOf = (n, name) => /** @type {FakeParam} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (n))[name]);
/** The node a source feeds first. @param {FakeNode} n */
const out0 = n => /** @type {FakeNode} */ (n.outputs[0]);
/** Sources that would still be heard if the context ran on from now. @param {FakeBase} ctx @param {FakeSource[]} list */
const audible = (ctx, list) => list.filter(s => sounds(s) && s.stopAt > ctx.currentTime);

test('mute, hidden and an interruption end every sound for good: nothing sounding or scheduled survives the suspension', async t => {
  // A suspended context freezes what was sounding and what was scheduled. Measured in Chrome before the fix: mute
  // 0.5 s into the win fanfare, unmute two seconds later, and the rest of the fanfare played at -5 dBFS.
  const { audio, ctx } = await unlocked(t);
  const made = (/** @type {() => void} */ fn) => { const n = ctx.started.length; fn(); return ctx.started.slice(n); };
  audio.music.start();
  await advance(t, ctx, 1);

  // 1. mute
  const ringing = made(() => { audio.play('win'); audio.play('lose'); audio.play('blast', { when: 1.5 }); audio.play('place', { when: 0.6 }); });
  assert.equal(audible(ctx, ringing).length, 1 + 4 + 1 + 3, 'a fanfare, a lament, a blast and a place are sounding or scheduled');
  await advance(t, ctx, 0.2);
  audio.setMuted(true);
  await advance(t, ctx, 0.35);
  assert.equal(ctx.state, 'suspended');
  assert.equal(audible(ctx, ctx.started).length, 0, 'muted and suspended: nothing is left that could sound on resume');
  const beforeUnmute = ctx.started.length;
  audio.setMuted(false);
  await settle();
  assert.equal(ctx.state, 'running');
  assert.equal(audible(ctx, ctx.started.slice(0, beforeUnmute)).length, 0, 'unmuted: nothing from before the mute is heard');
  assert.equal(made(() => audio.play('place')).length, 3, 'and a new sound plays at once');
  await advance(t, ctx, 1);
  assert.equal(padOf(audible(ctx, ctx.started)).length, 5, 'the bed is back with one pad');

  // 2. hidden
  const fanfare = made(() => { audio.play('win'); audio.play('check.take', { when: 0.4 }); audio.play('draw'); });
  assert.ok(audible(ctx, fanfare).length >= 3);
  audio.setHidden(true);
  await advance(t, ctx, 0.2);
  assert.equal(ctx.state, 'suspended');
  assert.equal(audible(ctx, ctx.started).length, 0, 'hidden and suspended: nothing is left');
  const beforeShown = ctx.started.length;
  audio.setHidden(false);
  await settle();
  assert.equal(audible(ctx, ctx.started.slice(0, beforeShown)).length, 0, 'visible again: nothing from before is heard');
  await advance(t, ctx, 1);

  // 3. the system suspends the context (iOS interrupts audio for a call); the next gesture resumes it
  const cut = made(() => { audio.play('check.give'); audio.play('hint.3'); audio.play('deal', { when: 0.3 }); });
  assert.ok(audible(ctx, cut).length >= 3);
  ctx.to('suspended');
  assert.equal(audible(ctx, ctx.started).length, 0, 'interrupted: effects and music are dropped');
  const n = ctx.started.length;
  assert.equal(await within(audio.unlock()), true);
  assert.equal(ctx.state, 'running');
  await advance(t, ctx, 1);
  assert.equal(padOf(ctx.started.slice(n)).length, 5, 'the bed restarts with a new pad');
  assert.equal(audible(ctx, ctx.started.slice(0, n)).length, 0, 'nothing from before the interruption is heard again');
});

test('an unmute that arrives while the suspension is on its way still ends up running', async t => {
  const { audio, ctx, events } = await unlocked(t);
  const g = graph(ctx);
  ctx.slowSuspend = true;                        // a real context suspends a moment after suspend() is called
  audio.setMuted(true);
  t.mock.timers.tick(310);
  assert.equal(ctx.parked.length, 1, 'the engine asked the context to suspend');
  assert.equal(ctx.state, 'running');
  audio.setMuted(false);                         // the child changed their mind right then
  await settle();
  const land = ctx.parked.shift();
  assert.ok(land);
  land();                                        // ... and now the suspension lands
  await settle();
  assert.equal(ctx.state, 'running', 'the late suspension did not win');
  assert.equal(events.at(-1), 'state:running');
  assert.ok(Math.abs(/** @type {number} */ (g.p(g.master, 'gain').last('target')?.v) - 0.9) < 1e-12);
  const n = ctx.started.length;
  audio.play('place');
  assert.equal(ctx.started.length, n + 3);
  // muted again and left alone: this time the suspension stands
  audio.setMuted(true);
  t.mock.timers.tick(310);
  const again = ctx.parked.shift();
  assert.ok(again);
  again();
  await settle();
  assert.equal(ctx.state, 'suspended');
  assert.equal(events.at(-1), 'state:muted');
});

test('play() never throws and never schedules a non-finite time, whatever the options', async t => {
  const { audio, ctx } = await unlocked(t);
  /** @type {unknown[]} */
  const hostile = [
    undefined, null, {}, { when: Infinity }, { when: -Infinity }, { when: NaN }, { when: -3 }, { when: '1' },
    { gain: NaN }, { gain: Infinity }, { gain: -5 }, { gain: '2' },
    { ms: NaN }, { ms: -100 }, { ms: Infinity }, { ms: 1e9 }, { ms: 0 },
    { scale: 0 }, { scale: NaN }, { scale: 99 }, { scale: -1 }, { scale: Infinity },
    { step: -3 }, { step: 2.5 }, { step: NaN }, { step: 1e12 }, { step: Infinity },
  ];
  for (const name of SFX_NAMES) {
    for (const opts of hostile) {
      ctx.currentTime += 10;
      assert.doesNotThrow(() => audio.play(/** @type {keyof typeof RECIPE_SOURCES} */ (name), /** @type {undefined} */ (opts)), `${name} ${JSON.stringify(opts)}`);
    }
  }
  assert.ok(ctx.started.length > SFX_NAMES.length * hostile.length);
  const stinger = (/** @type {FakeSource} */ s) => s.kind === 'buffer-source' && /** @type {{loop:boolean}} */ (/** @type {unknown} */ (s)).loop === false;
  assert.ok(ctx.started.every(s => s.startAt !== null && Number.isFinite(s.startAt)), 'every start time is finite');
  assert.ok(ctx.started.every(s => stinger(s) || (Number.isFinite(s.stopAt) && s.stopAt >= /** @type {number} */ (s.startAt))), 'every synthesised source has a finite stop time');
  // a sound asked for with a non-finite `when` plays now
  ctx.currentTime += 10;
  const n = ctx.started.length;
  audio.play('place', { when: Infinity });
  assert.equal(ctx.started.length, n + 3);
  assert.ok(ctx.started.slice(n).every(s => /** @type {number} */ (s.startAt) - ctx.currentTime < 0.01));
  // names that are not effects, including names every object has
  for (const name of ['', 'nope', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    ctx.currentTime += 10;
    const m = ctx.started.length;
    assert.doesNotThrow(() => audio.play(/** @type {keyof typeof RECIPE_SOURCES} */ (/** @type {unknown} */ (name))));
    assert.equal(ctx.started.length, m, `'${name}' is not a sound`);
  }
  // the other entry points with hostile values
  assert.doesNotThrow(() => {
    audio.setTension(NaN); audio.setTension(Infinity); audio.setTension(-4);
    audio.duck(NaN, true); audio.duck(Infinity, true); audio.duck(10, false);
    audio.applySettings(/** @type {{sfx:boolean, music:boolean, volume:number}} */ (/** @type {unknown} */ ({ volume: NaN })));
    audio.applySettings({ sfx: true, music: true, volume: 1 });
    audio.setPalette(/** @type {'chibi'} */ (/** @type {unknown} */ ('nowhere')));
    audio.music.setScene(/** @type {'game'} */ (/** @type {unknown} */ ('party')));
    audio.music.stop(NaN);
    audio.music.stop(-1);
  });
});

test('music.stop() answered by music.start() during the fade never puts two pads over the 20-source budget', async t => {
  const { audio, ctx } = await unlocked(t);
  t.mock.method(Math, 'random', () => 0);        // the densest melody
  audio.setTension(1);
  audio.music.start();
  await advance(t, ctx, 12);
  for (let i = 0; i < 6; i++) {
    audio.music.stop(2000);
    await advance(t, ctx, 0.1 * i);
    audio.music.start();
    await advance(t, ctx, 4);
  }
  assert.ok(peak(ctx.started) <= 20, `peak ${peak(ctx.started)}`);
  assert.equal(padOf(audible(ctx, ctx.started)).length, 5, 'one pad');
  // the pads (the only sources that live for seconds) never overlap: the old one ends where the new one begins
  const pads = ctx.started.filter(s => s.stopAt - /** @type {number} */ (s.startAt) > 3);
  assert.equal(pads.length, 7 * 5);
  assert.equal(peak(pads), 5, 'never two pads at once');
});

test('a voice that is already fading out is never turned back up', async t => {
  const { audio, ctx } = await unlocked(t);
  const g = graph(ctx);
  t.mock.method(Math, 'random', () => 0.99);     // only the pad plays
  audio.music.start();
  await advance(t, ctx, 2);
  audio.music.stop(2000);                        // a two-second fade ...
  await advance(t, ctx, 1);
  audio.music.start();                           // ... answered half way: the old pad goes on down from where it is
  await advance(t, ctx, 1);
  const dries = ctx.nodes.filter(n => n.kind === 'gain' && n.outputs.includes(g.musicBus));
  let caught = 0;
  for (const dry of dries) {
    const sets = paramOf(dry, 'gain').events.filter(e => e.kind === 'set').map(e => /** @type {number} */ (e.v));
    for (let i = 1; i < sets.length; i++) assert.ok(sets[i] <= sets[i - 1] + 1e-12, `a fade restarted from ${sets[i]} after ${sets[i - 1]}`);
    if (sets.length === 2) {
      assert.ok(Math.abs(sets[1] - 0.5 * sets[0]) < 1e-9, `the second fade starts at half level (${sets[1]})`);
      caught++;
    }
  }
  assert.equal(caught, 1, 'the old pad was caught half way down');
});

test('palettes of 10.5.6: pluck brightness and decay, drum gains, reverb return, pad oscillators, horn threshold', async t => {
  install(t);
  t.mock.method(Math, 'random', () => 0.99);     // the melody stays silent except for the forced phrase end
  const D4 = 293.6648;
  const fSharp5 = D4 * 2 * 2 ** (4 / 12);        // deg(7)
  /** @type {Record<string, {bright:number, decay:number, drum:number, reverb:number, pad:string[], hornAt06:boolean}>} */
  const table = {
    chibi: { bright: 1.0, decay: 1.0, drum: 1.0, reverb: 1.0, pad: ['triangle', 'sine', 'triangle', 'sine'], hornAt06: false },
    longzhong: { bright: 0.75, decay: 0.85, drum: 0.8, reverb: 0.8, pad: ['sine', 'sine', 'sine', 'sine'], hornAt06: false },
    shachang: { bright: 1.15, decay: 1.0, drum: 1.25, reverb: 0.9, pad: ['triangle', 'sine', 'triangle', 'sine'], hornAt06: true },
  };
  for (const theme of /** @type {const} */ (['chibi', 'longzhong', 'shachang'])) {
    const row = table[theme];
    const audio = createAudio();
    audio.setPalette(theme);
    assert.equal(await firstUnlock(t, audio), true);
    await settle();
    const ctx = /** @type {FakeContext} */ (FakeContext.instances.at(-1));
    const made = (/** @type {() => void} */ fn) => { ctx.currentTime += 10; const n = ctx.started.length; fn(); return ctx.started.slice(n); };

    // pluck: praise.good = pluck(deg(7), decay .8): cutoff min(10·f·bright, 9000), life decay·x + 50 ms
    const pluck = made(() => audio.play('praise.good'));
    const saw = /** @type {FakeSource} */ (pluck.find(s => typeOf(s) === 'sawtooth'));
    const lowpass = out0(saw);
    assert.ok(Math.abs(/** @type {number} */ (paramOf(lowpass, 'frequency').events[0].v) - Math.min(10 * fSharp5 * row.bright, 9000)) < 1e-6, `${theme}: pluck cutoff`);
    assert.ok(Math.abs(saw.stopAt - /** @type {number} */ (saw.startAt) - (0.8 * row.decay + 0.05)) < 1e-9, `${theme}: pluck decay`);

    // drum: lose = drum(73.4 Hz, gain .25)
    const lose = made(() => audio.play('lose'));
    const drum = /** @type {FakeSource} */ (lose.find(s => s.kind === 'oscillator' && Math.abs(/** @type {number} */ (paramOf(s, 'frequency').last('exp')?.v) - 73.4) < 1e-9));
    const env = out0(drum);
    assert.ok(Math.abs(/** @type {number} */ (paramOf(env, 'gain').last('linear')?.v) - 0.25 * row.drum) < 1e-12, `${theme}: drum gain`);

    // reverb return
    assert.ok(Math.abs(paramOf(/** @type {FakeNode} */ (graph(ctx).reverbOut), 'gain').value - 0.5 * row.reverb) < 1e-12, `${theme}: reverb return`);

    // the bed at T = .6: the pad's oscillators, and whether the horn has entered (沙场: from .55, the others: from .65)
    const n = ctx.started.length;
    audio.setTension(0.6);
    audio.music.start();
    await advance(t, ctx, 8);
    const bedSources = ctx.started.slice(n);
    const pad = padOf(bedSources).filter(s => paramOf(s, 'frequency').value > 1);          // without the 0.08 Hz LFO
    assert.deepEqual(pad.map(typeOf), row.pad, `${theme}: pad oscillators`);
    // a horn voice is a pair of sawtooths at a fixed pitch (a pluck's sawtooth glides)
    const horns = bedSources.filter(s => typeOf(s) === 'sawtooth' && paramOf(s, 'frequency').events.length === 0);
    assert.equal(horns.length > 0, row.hornAt06, `${theme}: horn at T = .6`);
    if (horns.length) {
      const B2 = D4 / 4 * 2 ** (9 / 12);         // T = .6 is 羽 mode: the horn plays B2
      assert.ok(horns.every(s => Math.abs(1200 * Math.log2(paramOf(s, 'frequency').value / B2)) < 5.01), 'the horn is on B2, ±5 cents');
      assert.ok(horns.every(s => Math.abs(s.stopAt - /** @type {number} */ (s.startAt) - 1.62) < 1e-9), 'the horn lasts 1.6 s');
    }
    audio.dispose();
  }
});

test('tension is not volume: the war drum and the horn of the bed are trimmed, and the horn does not grow with tension (K-98)', async t => {
  install(t);
  t.mock.method(Math, 'random', () => 0.99);     // the melody stays silent except for the forced phrase end
  const round = (/** @type {number|undefined} */ v) => Math.round(/** @type {number} */ (v) * 1e9) / 1e9;
  /**
   * The peak gains of the war drum and of the horn in the bed at tension T (赤壁: drum gains x 1.0).
   * @param {number} T @param {'chibi'|'longzhong'|'shachang'} [theme]
   */
  const bedGains = async (T, theme = 'chibi') => {
    const audio = createAudio();
    audio.setPalette(theme);
    assert.equal(await firstUnlock(t, audio), true);
    await settle();
    const ctx = /** @type {FakeContext} */ (FakeContext.instances.at(-1));
    audio.setTension(T);
    audio.music.start();
    await advance(t, ctx, 12);                   // more than four bars at any tempo; bars 0 and 2 carry the horn
    // the war drum: a sine that falls from 146.8 to 73.4 Hz (the thump of the drive layer falls from 110 to 55 Hz)
    const drums = ctx.started.filter(s => typeOf(s) === 'sine' && Math.abs(/** @type {number} */ (paramOf(s, 'frequency').last('exp')?.v) - 73.4) < 1e-9);
    // the horn: a pair of sawtooths at a fixed pitch into one lowpass (a pluck's sawtooth glides); its envelope follows the lowpass
    const horns = ctx.started.filter(s => typeOf(s) === 'sawtooth' && paramOf(s, 'frequency').events.length === 0);
    const result = {
      drum: [...new Set(drums.map(s => round(paramOf(out0(s), 'gain').last('linear')?.v)))].sort(),
      horn: [...new Set(horns.map(s => round(paramOf(out0(out0(s)), 'gain').last('linear')?.v)))].sort(),
      horns: horns.length,
    };
    audio.dispose();
    return result;
  };

  // T = .95, where the bed was 1 dB too loud: both layers are fully in (drum from .70, horn from .85)
  const high = await bedGains(0.95);
  assert.deepEqual(high.drum, [0.11, 0.15], 'war drum: .11, and .15 on step 0');
  assert.deepEqual(high.horn, [0.03], 'horn: .03');
  assert.ok(high.horns >= 4, 'both horns sound (step 0 and, from T = .85, a fifth above on step 8)');
  // never louder than the table of §10.5.5 (.16 / .22 and .05), which they were trimmed from
  assert.ok(high.drum[0] < 0.16 && high.drum[1] < 0.22 && high.horn[0] < 0.05);

  // more tension makes the bed denser and faster, not louder: the same gains at T = 1 and at T = .85
  assert.deepEqual(await bedGains(1), high);
  const entering = await bedGains(0.85);
  assert.deepEqual(entering.drum, high.drum);
  assert.deepEqual(entering.horn, high.horn);
  // while the horn is still entering it is quieter: ss(.65, .85, .75) = .5
  assert.deepEqual((await bedGains(0.75)).horn, [0.015]);
  // and below T = .6 there is neither
  const calm = await bedGains(0.5);
  assert.deepEqual([calm.drum, calm.horn], [[], []]);

  // the trim left the palettes of §10.5.6 alone: drum gains x 0.8 in 隆中 and x 1.25 in 沙场, the horn the same .03,
  // and 沙场's horn still enters early (from ss(.55, .75, T): half way in at T = .65, where 赤壁 has none yet)
  const soft = await bedGains(0.95, 'longzhong');
  assert.deepEqual(soft.drum, [round(0.11 * 0.8), round(0.15 * 0.8)], '隆中: war drum x 0.8');
  assert.deepEqual(soft.horn, [0.03], '隆中: horn .03');
  const loud = await bedGains(0.95, 'shachang');
  assert.deepEqual(loud.drum, [round(0.11 * 1.25), round(0.15 * 1.25)], '沙场: war drum x 1.25');
  assert.deepEqual(loud.horn, [0.03], '沙场: horn .03');
  // even 沙场's louder drums stay under the untrimmed table of §10.5.5
  assert.ok(loud.drum[0] < 0.16 && loud.drum[1] < 0.22);
  assert.deepEqual((await bedGains(0.65, 'shachang')).horn, [0.015], '沙场: the horn is half way in at T = .65');
  assert.deepEqual((await bedGains(0.65)).horn, [], '赤壁: no horn yet at T = .65');
});

test('the stingers are in key and on time: pitches, offsets and gains of 10.5.3', async t => {
  const { audio, ctx } = await unlocked(t);
  const D4 = 293.6648;
  const PENTA = [0, 2, 4, 7, 9];
  const deg = (/** @type {number} */ i) => D4 * 2 ** Math.floor(i / 5) * 2 ** (PENTA[i % 5] / 12);
  /** The sources of one sound, live or from its offline render, with times from the start of the recipe. @param {string} name @param {object} [opts] */
  const sourcesOf = (name, opts) => {
    const key = /** @type {keyof typeof RECIPE_SOURCES} */ (name);
    if (PRERENDERED.includes(key)) return { list: FakeOffline.instances[PRERENDERED.indexOf(key)].started, t0: 0 };
    ctx.currentTime += 10;
    const n = ctx.started.length;
    audio.play(key, opts);
    const list = ctx.started.slice(n);
    return { list, t0: Math.min(...list.map(s => /** @type {number} */ (s.startAt))) };
  };
  /** [offset s, Hz] of every pluck: its sawtooth glides down to the note. @param {string} name */
  const plucks = name => {
    const { list, t0 } = sourcesOf(name);
    return list.filter(s => s.kind === 'oscillator' && typeOf(s) === 'sawtooth' && paramOf(s, 'frequency').events.length === 2 && paramOf(out0(s), 'Q')?.value === 1.5)
      .map(s => [/** @type {number} */ (s.startAt) - t0, /** @type {number} */ (paramOf(s, 'frequency').last('exp')?.v)])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  };
  /** @type {Record<string, [number, number][]>}   name -> [offset s, scale degree] */
  const expected = {
    'trial.confirm': [[0.02, 0]],
    'praise.good': [[0, 7], [0.07, 8]],
    'praise.great': [[0, 7], [0.06, 8], [0.12, 9], [0.18, 10]],
    'praise.brilliant': [[0, 5], [0.05, 7], [0.10, 8], [0.15, 9], [0.20, 10], [0.25, 12]],
    'warn': [[0, 3], [0.11, 2]],
    'draw': [[0, 3], [0, 5]],
    'check.give': [[0, 3], [0.06, 5], [0.12, 7]],
    'stamp': [[0.03, 0], [0.03, 3]],
    'win': [[0, 0], [0.085, 1], [0.17, 2], [0.255, 3], [0.34, 4], [0.425, 5], [0.6, 5], [0.6, 7], [0.6, 8]],
    'deal': [[0.78, 0], [0.78, 3]],
  };
  for (const [name, notes] of Object.entries(expected)) {
    const got = plucks(name);
    assert.equal(got.length, notes.length, `${name}: ${got.length} plucks`);
    notes.forEach(([at, d], i) => {
      assert.ok(Math.abs(got[i][0] - at) < 1e-9, `${name}: pluck ${i} at +${at} s (got ${got[i][0]})`);
      assert.ok(Math.abs(got[i][1] - deg(d)) < 1e-6, `${name}: pluck ${i} is deg(${d})`);
    });
  }

  // win: the drum roll at +600 ms: +0, +300, +500, +650, +760 ms with gains .30, .36, .42, .48, .55
  const win = sourcesOf('win');
  const roll = win.list.filter(s => s.kind === 'oscillator' && Math.abs(/** @type {number} */ (paramOf(s, 'frequency').last('exp')?.v) - 73.4) < 1e-9)
    .map(s => [/** @type {number} */ (s.startAt), /** @type {number} */ (paramOf(out0(s), 'gain').last('linear')?.v)]);
  assert.deepEqual(roll.map(([at, gain]) => [Math.round(at * 1000), Math.round(gain * 100) / 100]), [[600, 0.3], [900, 0.36], [1100, 0.42], [1250, 0.48], [1360, 0.55]]);

  // deal: twelve places at 55·i + ((37·i mod 30) − 15) ms (the first, −15 ms, at 0) with w = .6 + (53·i mod 40)/100
  const deal = sourcesOf('deal');
  const thuds = deal.list.filter(s => s.kind === 'oscillator' && typeOf(s) === 'sine' && paramOf(s, 'frequency').events.length === 2 && Math.abs(/** @type {number} */ (paramOf(s, 'frequency').last('exp')?.v) - 73.4) > 1)
    .map(s => [Math.round(/** @type {number} */ (s.startAt) * 1000), Math.round(/** @type {number} */ (paramOf(s, 'frequency').events[0].v) * 100) / 100])
    .sort((a, b) => a[0] - b[0]);
  const places = Array.from({ length: 12 }, (_, i) => [Math.max(0, 55 * i + ((37 * i) % 30) - 15), Math.round(190 / Math.sqrt(0.6 + ((53 * i) % 40) / 100) * 100) / 100]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(thuds, places);

  // capture at scale 1.25: six grains 25 ms apart at 1500 + (977·i mod 2700) Hz, gain .06; the body 140 -> 60 Hz, gain .45·s
  const capture = sourcesOf('capture', { scale: 1.25 });
  const tones = capture.list.filter(s => s.kind === 'oscillator')
    .map(s => ({ at: Math.round((/** @type {number} */ (s.startAt) - capture.t0) * 1000), f: /** @type {number} */ (paramOf(s, 'frequency').events[0].v), gain: /** @type {number} */ (paramOf(out0(s), 'gain').last('linear')?.v) }));
  const grains = tones.filter(x => x.f >= 1500).sort((a, b) => a.at - b.at);
  assert.deepEqual(grains.map(x => [x.at, x.f, x.gain]), [0, 1, 2, 3, 4, 5].map(i => [25 * i, 1500 + ((977 * i) % 2700), 0.06]));
  const body = tones.find(x => x.f === 140);
  assert.ok(body && Math.abs(body.gain - 0.45 * 1.25) < 1e-12);
});

// ---------------------------------------------------------------------------------------------------------------------
// The first gesture (CONTRACT-NOTES M-121): what the tap itself pays for, and what waits for the tasks after it
// ---------------------------------------------------------------------------------------------------------------------

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/**
 * Timers that run only when the test says so, one callback at a time, the way a browser runs one task at a time.
 * (The mock timers of node:test run a whole chain of zero-delay timers inside one tick.) Call it after install().
 * Both ends have a budget, so that `while (tasks.runTask())` ends, with a failure, also when the engine arms the
 * next timer for ever (CONTRACT-NOTES N-125).
 * @param {import('node:test').TestContext} t
 */
function taskTimers(t) {
  let now = 0;
  let seq = 0;
  let ran = 0;
  /** @type {Map<number, {at:number, fn:() => void}>} */
  const pending = new Map();
  G.setTimeout = (/** @type {() => void} */ fn, ms = 0) => {
    if (seq >= TIMER_BUDGET) throw new Error(`the engine armed more than ${TIMER_BUDGET} timers in one test`);
    pending.set(++seq, { at: now + ms, fn });
    return seq;
  };
  G.clearTimeout = (/** @type {number} */ id) => { pending.delete(id); };
  t.after(() => { G.setTimeout = realSetTimeout; G.clearTimeout = realClearTimeout; });
  return {
    pending,
    /** When the pending timers are due, in ms from now, sorted. */
    due: () => [...pending.values()].map(timer => timer.at - now).sort((a, b) => a - b),
    /** Moves the clock. @param {number} ms */
    advance(ms) { now += ms; },
    /** Runs the earliest timer that is due, as one task; false when none is due. */
    runTask() {
      /** @type {[number, {at:number, fn:() => void}]|null} */
      let next = null;
      for (const entry of pending) if (entry[1].at <= now && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) return false;
      if (++ran > TASK_BUDGET) throw new Error(`more than ${TASK_BUDGET} timer tasks in one test: the engine keeps arming timers`);
      pending.delete(next[0]);
      next[1].fn();
      return true;
    },
  };
}

/** Counts the promise rejections nobody handled while the test runs. @param {import('node:test').TestContext} t */
function unhandledRejections(t) {
  const seen = { count: 0 };
  const listener = () => { seen.count++; };
  process.on('unhandledRejection', listener);
  t.after(() => { process.off('unhandledRejection', listener); });
  return seen;
}

/**
 * Renders that arrive, or fail, when the test says so: one function per render, in the order they were started.
 * @param {import('node:test').TestContext} t
 */
function heldRenders(t) {
  /** @type {((error?:Error) => void)[]} */
  const arrive = [];
  t.mock.method(FakeOffline.prototype, 'startRendering', /** @this {FakeOffline} */ function () {
    const buffer = new FakeBuffer(this.channels, this.length, this.sampleRate);
    this.rendered = buffer;
    return new Promise((resolve, reject) => { arrive.push(error => (error ? reject(error) : resolve(buffer))); });
  });
  return arrive;
}

/** A fingerprint of samples: FNV-1a over their bytes. @param {Float32Array} data */
function fingerprint(data) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** @param {FakeBase} ctx */
const convolverOf = ctx => /** @type {FakeNode & {buffer:FakeBuffer|null}} */ (ctx.nodes.find(n => n.kind === 'convolver'));
/** The buffer a source plays. @param {FakeSource|undefined} s */
const bufferIn = s => /** @type {{buffer:FakeBuffer|null}} */ (/** @type {unknown} */ (s)).buffer;
/** The reverb return inside a stinger render: 0.5 x the palette's reverb / 0.8. @param {FakeOffline} off */
const returnOf = off => paramOf(/** @type {FakeNode} */ (convolverOf(off).outputs[0]), 'gain').value;
/** The shared noise of a rig: what a noise voice plays. @param {ReturnType<typeof createAudio>} audio @param {FakeContext} ctx */
function noiseOf(audio, ctx) {
  ctx.currentTime += 5;
  audio.play('ui.open');
  const source = ctx.started.at(-1);
  assert.equal(source?.kind, 'buffer-source');
  return /** @type {FakeBuffer} */ (bufferIn(source));
}
/** Plays an effect and returns the sources that made. @param {ReturnType<typeof createAudio>} audio @param {FakeContext} ctx @param {string} name */
function strike(audio, ctx, name) {
  ctx.currentTime += 5;
  const n = ctx.started.length;
  audio.play(/** @type {keyof typeof RECIPE_SOURCES} */ (name));
  return ctx.started.slice(n);
}

test('the first gesture creates the context, builds the whole rig and resumes it; no stinger is set up inside it (M-121)', async t => {
  const { events } = install(t);
  const tasks = taskTimers(t);
  const audio = createAudio();
  const unlocking = audio.unlock();
  // all of this is true when unlock() returns, i.e. inside the gesture handler (Safari needs resume() to be called there)
  assert.equal(FakeContext.instances.length, 1, 'the context is created in the gesture');
  const ctx = FakeContext.instances[0];
  assert.equal(ctx.state, 'running', 'resume() was called in the gesture');
  assert.equal(audio.unlocked, true);
  assert.deepEqual(events, ['unlocked', 'state:running']);
  graph(ctx);                                             // the rig of §10.5.1 is complete
  assert.ok(convolverOf(ctx).buffer, 'the live reverb has its impulse');
  assert.equal(strike(audio, ctx, 'place').length, 3, 'a sound asked for by the same gesture plays');
  assert.equal(noiseOf(audio, ctx).length, 2 * 44100, 'and the shared noise is there');
  assert.equal(FakeOffline.instances.length, 0, 'no stinger is set up inside the gesture');
  // nor in a promise callback after it: the browser cannot paint before those have run
  await settle();
  await settle();
  assert.equal(FakeOffline.instances.length, 0, 'no stinger is set up in a microtask');
  // what waits: the first step of the renders (a timer task), the guard on a resume() that hangs, the cap on unlock()
  assert.deepEqual(tasks.due(), [0, 1000, 1500]);
  // more gestures before the renders are done (the stage calls unlock() on pointerdown, pointerup and keydown)
  void audio.unlock();
  void audio.unlock();
  assert.equal(FakeContext.instances.length, 1);
  assert.deepEqual(tasks.due(), [0, 1000, 1500], 'a gesture during the renders starts nothing again');
  assert.deepEqual(events, ['unlocked', 'state:running']);

  while (tasks.runTask()) await settle();
  assert.equal(FakeOffline.instances.length, 6);
  assert.equal(await within(unlocking), true);
  await settle();
  assert.equal(tasks.pending.size, 0, 'no timer is left when the stingers are ready');
});

test('after the gesture the stingers are set up in timer tasks: never more than one in a task, each in two halves, in the order of PRERENDERED (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  const arrive = heldRenders(t);
  const audio = createAudio();
  const unlocking = audio.unlock();
  await settle();
  const ctx = FakeContext.instances[0];
  const impulse = convolverOf(ctx).buffer;
  const noise = noiseOf(audio, ctx);

  // after each task: [OfflineAudioContexts so far, renders started so far, sources in the newest context]
  /** @type {number[][]} */
  const seen = [];
  while (tasks.runTask()) {
    const newest = /** @type {FakeOffline} */ (FakeOffline.instances.at(-1));
    seen.push([FakeOffline.instances.length, arrive.length, newest.started.length]);
    // the first half gave the reverb of this render the rig's own impulse: it is not computed again
    same(convolverOf(newest).buffer, impulse, 'the reverb of a render has the impulse of the rig');
    await settle();                                       // promise callbacks between the tasks start nothing
  }
  /** @type {number[][]} */
  const expected = [];
  PRERENDERED.forEach((name, i) => {
    expected.push([i + 1, i, 0]);                         // first task: the context and its reverb, no voice yet
    expected.push([i + 1, i + 1, RECIPE_SOURCES[name]]);  // second task: the voices, and the render starts
  });
  assert.deepEqual(seen, expected);
  for (const off of FakeOffline.instances) {
    const hiss = off.started.find(s => s.kind === 'buffer-source');
    same(bufferIn(hiss), noise, 'the renders play the noise of the rig');
  }
  assert.deepEqual(tasks.due(), [1000, 1500], 'the renders leave no timer behind; unlock() still waits for them');

  // a stinger is synthesised live until its own buffer exists, and played from the buffer from then on
  assert.equal(strike(audio, ctx, 'deal').length, RECIPE_SOURCES.deal);
  arrive[PRERENDERED.indexOf('deal')]();
  await settle();
  const deal = strike(audio, ctx, 'deal');
  assert.equal(deal.length, 1);
  same(bufferIn(deal[0]), FakeOffline.instances[PRERENDERED.indexOf('deal')].rendered, 'deal plays its rendered buffer');
  assert.equal(strike(audio, ctx, 'stamp').length, RECIPE_SOURCES.stamp, 'the others are still live');
  assert.ok(peak(ctx.started) <= 48);

  arrive.forEach(resolve => resolve());
  assert.equal(await within(unlocking), true, 'unlock() resolves when all six are rendered');
  await settle();
  assert.equal(tasks.pending.size, 0);
  for (const name of PRERENDERED) {
    const made = strike(audio, ctx, name);
    assert.equal(made.length, 1, name);
    same(bufferIn(made[0]), FakeOffline.instances[PRERENDERED.indexOf(name)].rendered, `${name} plays its rendered buffer`);
  }
});

test('a new palette in the middle of a staggered render: the old run stops, and no buffer of the old palette is in use afterwards (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  const unhandled = unhandledRejections(t);
  const arrive = heldRenders(t);
  /** The reverb return inside a render: 0.5 x palette / 0.8. @param {FakeOffline} off */
  const back = off => paramOf(/** @type {FakeNode} */ (convolverOf(off).outputs[0]), 'gain').value;

  const audio = createAudio();
  const unlocking = audio.unlock();
  await settle();
  const ctx = FakeContext.instances[0];
  for (let i = 0; i < 7; i++) assert.equal(tasks.runTask(), true);
  // 赤壁: win, deal and check.give are rendering, check.take is half set up
  assert.equal(FakeOffline.instances.length, 4);
  assert.equal(arrive.length, 3);
  arrive[1]();                                            // deal arrives
  await settle();
  same(bufferIn(strike(audio, ctx, 'deal')[0]), FakeOffline.instances[1].rendered, 'deal plays the buffer that arrived');

  audio.setPalette('shachang');
  assert.equal(FakeOffline.instances.length, 4, 'nothing is set up inside the tap on the theme');
  assert.equal(await within(unlocking), true, 'the first run is over: unlock() does not wait for a run that was dropped');
  await settle();
  assert.deepEqual(tasks.due(), [0], 'one timer: the first step of the new run; the old run has none left');
  same(bufferIn(strike(audio, ctx, 'deal')[0]), FakeOffline.instances[1].rendered, 'the old buffer serves until the new one is ready');
  assert.equal(strike(audio, ctx, 'check.take').length, RECIPE_SOURCES['check.take'], 'what has no buffer yet is live');

  let n = 0;
  while (tasks.runTask()) { n++; await settle(); }
  assert.equal(n, 12, 'the new run takes its twelve tasks; the old run got no further task');
  assert.equal(FakeOffline.instances.length, 4 + 6);
  same(FakeOffline.instances[3].rendered, undefined, 'the half set up render of the old run was never started');
  assert.deepEqual(FakeOffline.instances.map(back), [0.625, 0.625, 0.625, 0.625, ...Array(6).fill(0.5 * 0.9 / 0.8)], 'four renders of 赤壁, six of 沙场');
  assert.equal(arrive.length, 3 + 6);

  // the new renders arrive; then the stragglers of the old run: its win arrives, its check.give fails
  for (let i = 3; i < 9; i++) arrive[i]();
  await settle();
  arrive[0]();
  arrive[2](new Error('too late'));
  await settle();
  PRERENDERED.forEach((name, i) => {
    const made = strike(audio, ctx, name);
    assert.equal(made.length, 1, `${name} plays from a buffer`);
    same(bufferIn(made[0]), FakeOffline.instances[4 + i].rendered, `${name}: the buffer of 沙场`);
  });
  assert.equal(tasks.pending.size, 0, 'no timer is left');
  assert.equal(unhandled.count, 0, 'no unhandled rejection');

  // the same palette again starts nothing; two changes before the first task of a run: one run, of the last palette
  audio.setPalette('shachang');
  assert.equal(tasks.pending.size, 0);
  audio.setPalette('longzhong');
  audio.setPalette('chibi');
  assert.deepEqual(tasks.due(), [0]);
  while (tasks.runTask()) await settle();
  assert.equal(FakeOffline.instances.length, 10 + 6);
  assert.deepEqual(FakeOffline.instances.slice(10).map(back), Array(6).fill(0.625));
  assert.equal(unhandled.count, 0);
});

test('a render that cannot be set up, or fails, leaves its stinger live and nothing unhandled (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  const unhandled = unhandledRejections(t);
  FakeOffline.refuse = 1;                                 // win: the OfflineAudioContext cannot be built
  FakeOffline.failing = new Set([1]);                     // check.give (the second context that does get built): its render fails
  const audio = createAudio();
  const unlocking = audio.unlock();
  await settle();
  const ctx = FakeContext.instances[0];
  let n = 0;
  while (tasks.runTask()) { n++; await settle(); }
  assert.equal(n, 1 + 5 * 2, 'win gave up in its first task; the run went on with the others');
  assert.equal(await within(unlocking), true, 'unlock() resolves all the same');
  await settle();
  assert.equal(tasks.pending.size, 0);
  assert.equal(strike(audio, ctx, 'win').length, RECIPE_SOURCES.win);
  assert.equal(strike(audio, ctx, 'check.give').length, RECIPE_SOURCES['check.give']);
  for (const name of ['deal', 'check.take', 'blast', 'stamp']) assert.equal(strike(audio, ctx, name).length, 1, name);
  assert.ok(peak(ctx.started) <= 48);
  assert.equal(unhandled.count, 0, 'no unhandled rejection');
});

test('dispose() in the middle of a staggered render: no further stinger, unlock() resolves, no timer and no rejection is left (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  const unhandled = unhandledRejections(t);
  const arrive = heldRenders(t);
  const audio = createAudio();
  const unlocking = audio.unlock();
  await settle();
  const ctx = FakeContext.instances[0];
  for (let i = 0; i < 5; i++) assert.equal(tasks.runTask(), true);
  assert.equal(FakeOffline.instances.length, 3);          // win and deal are rendering, check.give is half set up
  audio.dispose();
  assert.equal(await within(unlocking), true, 'the promise of the gesture does not hang');
  await settle();
  assert.equal(tasks.pending.size, 0, 'no timer is left');
  assert.equal(tasks.runTask(), false);
  arrive[0]();                                            // what was rendering arrives, or fails, after the engine is gone
  arrive[1](new Error('the context went away'));
  await settle();
  assert.equal(FakeOffline.instances.length, 3, 'no further stinger was set up');
  same(FakeOffline.instances[2].rendered, undefined, 'the half set up render was never started');
  assert.equal(ctx.state, 'closed');
  assert.equal(strike(audio, ctx, 'win').length, 0, 'and nothing plays');
  assert.equal(unhandled.count, 0, 'no unhandled rejection');

  // disposed before any gesture: the preparation of the samples is dropped
  const idle = createAudio();
  assert.deepEqual(tasks.due(), [250]);
  idle.dispose();
  assert.equal(tasks.pending.size, 0);
  // disposed between the gesture and the first task of the renders
  const early = createAudio();
  const gesture = early.unlock();
  early.dispose();
  assert.equal(typeof await within(gesture), 'boolean');
  await settle();
  assert.equal(tasks.pending.size, 0);
  assert.equal(FakeOffline.instances.length, 3);
  assert.equal(unhandled.count, 0);
});

test('the noise and the impulse are prepared before the first gesture, without a context, and are the samples the engine always had (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  // Fingerprints of what the engine's noise and impulse were before they were prepared ahead (taken from the engine
  // as it was then, per sample rate): [noise, impulse left, impulse right].
  /** @type {Record<number, string[]>} */
  const BEFORE = {
    44100: ['44506b0e', 'e9583d24', 'f3d97506'],
    48000: ['00286bc0', '899464ee', 'd684d83d'],
    96000: ['cb312076', '5ffc3348', '28b4f22a'],
  };
  /**
   * An engine whose context runs at `rate`, and the samples of its rig.
   * @param {number} rate @param {number} [idle]  how many tasks of preparation may run before the gesture
   */
  const rigAt = async (rate, idle = 0) => {
    G.AudioContext = class extends FakeContext { constructor() { super(); this.sampleRate = rate; } };
    const contexts = FakeContext.instances.length;
    const offline = FakeOffline.instances.length;
    const audio = createAudio();
    assert.deepEqual(tasks.due(), [250], 'the preparation waits for the page to settle');
    let prepared = 0;
    if (idle > 0) {
      tasks.advance(249);
      assert.equal(tasks.runTask(), false, 'not before 250 ms');
      tasks.advance(1);
      while (prepared < idle && tasks.runTask()) prepared++;
      assert.equal(FakeContext.instances.length, contexts, 'preparing needs no AudioContext');
      assert.equal(FakeOffline.instances.length, offline, 'and no OfflineAudioContext');
    }
    const unlocking = audio.unlock();
    await settle();
    assert.deepEqual(tasks.due(), [0, 1000, 1500], 'the gesture ends the preparation: only the timers of the renders are left');
    const ctx = /** @type {FakeContext} */ (FakeContext.instances.at(-1));
    const impulse = /** @type {FakeBuffer} */ (convolverOf(ctx).buffer);
    const noise = noiseOf(audio, ctx);
    while (tasks.runTask()) await settle();
    assert.equal(await within(unlocking), true);
    await settle();
    assert.equal(tasks.pending.size, 0);
    assert.deepEqual([impulse.sampleRate, impulse.numberOfChannels, impulse.length], [rate, 2, Math.floor(rate * 1.1)]);
    assert.deepEqual([noise.sampleRate, noise.numberOfChannels, noise.length], [rate, 1, 2 * rate]);
    audio.dispose();
    return { prepared, prints: [fingerprint(noise.data[0]), fingerprint(impulse.data[0]), fingerprint(impulse.data[1])] };
  };

  // a gesture before the preparation: the rig computes its own samples, as it always did
  assert.deepEqual((await rigAt(44100)).prints, BEFORE[44100]);
  assert.deepEqual((await rigAt(48000)).prints, BEFORE[48000]);
  // left alone, the engine prepares four tables, one per task: impulse and noise at 48 kHz, then at 44.1 kHz
  const iPad = await rigAt(48000, 99);
  assert.equal(iPad.prepared, 4, 'four tables, four tasks, and then no further timer');
  assert.deepEqual(iPad.prints, BEFORE[48000], 'the prepared samples are the same samples');
  assert.deepEqual((await rigAt(44100, 99)).prints, BEFORE[44100]);
  // a gesture in the middle of the preparation uses what is ready and computes the rest
  assert.deepEqual((await rigAt(48000, 1)).prints, BEFORE[48000]);
  assert.deepEqual((await rigAt(44100, 3)).prints, BEFORE[44100]);
  // a rate nobody prepared for
  assert.deepEqual((await rigAt(96000, 99)).prints, BEFORE[96000]);
});

test('a gesture after the preparation computes no samples: the prepared tables are copied in; without AudioContext nothing is prepared (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  /** How many tables of samples (Float32Arrays of a second of sound or more) are created while fn runs. @param {() => void} fn */
  const tablesMadeBy = fn => {
    const Native = Float32Array;
    let made = 0;
    G.Float32Array = new Proxy(Native, {
      construct(target, args, newTarget) { if (typeof args[0] === 'number' && args[0] >= 40000) made++; return Reflect.construct(target, args, newTarget); },
    });
    try { fn(); } finally { G.Float32Array = Native; }
    return made;
  };
  /**
   * The tables made inside the first gesture of an engine whose context runs at `rate`.
   * @param {number} rate @param {number} idle  how many tasks of preparation run before the gesture
   */
  const gestureAt = async (rate, idle) => {
    G.AudioContext = class extends FakeContext { constructor() { super(); this.sampleRate = rate; } };
    const audio = createAudio();
    tasks.advance(250);
    for (let i = 0; i < idle; i++) assert.equal(tasks.runTask(), true);
    let unlocking = Promise.resolve(false);
    const made = tablesMadeBy(() => { unlocking = audio.unlock(); });
    while (tasks.runTask()) await settle();
    assert.equal(await within(unlocking), true);
    audio.dispose();
    await settle();
    assert.equal(tasks.pending.size, 0);
    return made;
  };
  // the fake context keeps the samples of its buffers in tables of its own: impulse left and right, and the noise
  const OWN = 3;
  assert.equal(await gestureAt(48000, 0), OWN + 3, 'a gesture before the preparation computes the impulse (two channels) and the noise');
  assert.equal(await gestureAt(48000, 4), OWN, 'after it nothing is computed inside the gesture');
  assert.equal(await gestureAt(44100, 4), OWN, 'nor at 44.1 kHz');
  assert.equal(await gestureAt(48000, 1), OWN + 1, 'in the middle of it: the impulse is ready, the noise is computed');
  assert.equal(await gestureAt(44100, 3), OWN + 1, 'the impulse at 44.1 kHz is ready, its noise is not');
  assert.equal(await gestureAt(96000, 4), OWN + 3, 'a rate nobody prepared for computes its own');

  G.AudioContext = undefined;
  const silent = createAudio();
  assert.equal(tasks.pending.size, 0, 'a browser without AudioContext: nothing is prepared');
  silent.dispose();
});

test('a context that runs only after the gesture (an iPad lets it run when the finger lifts): the stingers still wait for a timer task (M-121)', async t => {
  const { events } = install(t);
  const tasks = taskTimers(t);
  // resume() stays pending inside the gesture; the rig runs at 48 kHz
  G.AudioContext = class extends FakeContext { constructor() { super(); this.blocked = true; this.sampleRate = 48000; } };
  const audio = createAudio();
  const first = audio.unlock();
  assert.equal(FakeContext.instances.length, 1, 'the context is created in the gesture all the same');
  const ctx = FakeContext.instances[0];
  graph(ctx);                                             // and the rig is built
  assert.equal(ctx.state, 'suspended');
  assert.equal(audio.unlocked, false);
  assert.deepEqual(events, []);
  assert.deepEqual(tasks.due(), [1000], 'only the guard on a resume() that hangs');
  audio.setPalette('shachang');                           // a theme set meanwhile renders nothing yet
  assert.deepEqual(tasks.due(), [1000]);

  ctx.to('running');                                      // the browser lets the context run and says so in a statechange event
  assert.equal(audio.unlocked, true);
  assert.deepEqual(events, ['unlocked', 'state:running']);
  assert.equal(FakeOffline.instances.length, 0, 'no stinger is set up inside the statechange callback');
  await settle();
  assert.equal(FakeOffline.instances.length, 0, 'nor in a microtask after it');
  assert.deepEqual(tasks.due(), [0, 1000, 1500]);
  const second = audio.unlock();                          // the gesture of the lifted finger (the stage: pointerup)
  assert.deepEqual(tasks.due(), [0, 1000, 1500], 'which starts nothing again');

  let n = 0;
  while (tasks.runTask()) { n++; await settle(); }
  assert.equal(n, 12);
  assert.equal(FakeOffline.instances.length, 6);
  assert.deepEqual(FakeOffline.instances.map(returnOf), Array(6).fill(0.5 * 0.9 / 0.8), 'one run, of the palette that was set last');
  for (const off of FakeOffline.instances) assert.equal(off.sampleRate, 48000, 'the renders run at the rate of the rig');
  assert.equal(await within(second), true);
  await settle();
  assert.deepEqual(tasks.due(), [1000], 'left: the guard of the first gesture, whose resume() never answered');
  tasks.advance(1000);
  assert.equal(tasks.runTask(), true);
  assert.equal(await within(first), true);
  assert.equal(tasks.pending.size, 0);
  for (const name of PRERENDERED) assert.equal(strike(audio, ctx, name).length, 1, name);
  assert.deepEqual(events, ['unlocked', 'state:running'], 'audio:unlocked fired once');
});

test('a render of a new palette that cannot be set up, or fails, takes the old buffer out of use: that stinger is live again (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  const unhandled = unhandledRejections(t);
  const audio = createAudio();
  const unlocking = audio.unlock();
  await settle();
  const ctx = FakeContext.instances[0];
  while (tasks.runTask()) await settle();
  assert.equal(await within(unlocking), true);
  await settle();
  for (const name of PRERENDERED) assert.equal(strike(audio, ctx, name).length, 1, `${name}: 赤壁, from its buffer`);

  audio.setPalette('longzhong');
  assert.equal(tasks.runTask(), true);                    // win: set up ...
  assert.equal(tasks.runTask(), true);                    // ... and rendering (context 6)
  FakeOffline.refuse = 1;                                 // deal: its context cannot be built
  FakeOffline.failing = new Set([9]);                     // blast (7 check.give, 8 check.take, 9 blast, 10 stamp): its render fails
  let n = 2;
  while (tasks.runTask()) { n++; await settle(); }
  assert.equal(n, 2 + 1 + 4 * 2);
  assert.equal(FakeOffline.instances.length, 6 + 5);
  await settle();
  assert.equal(strike(audio, ctx, 'deal').length, RECIPE_SOURCES.deal, 'deal is live: the buffer of 赤壁 is not played in 隆中');
  assert.equal(strike(audio, ctx, 'blast').length, RECIPE_SOURCES.blast, 'blast is live: the buffer of 赤壁 is not played in 隆中');
  for (const [name, index] of /** @type {[string, number][]} */ ([['win', 6], ['check.give', 7], ['check.take', 8], ['stamp', 10]])) {
    const made = strike(audio, ctx, name);
    assert.equal(made.length, 1, name);
    same(bufferIn(made[0]), FakeOffline.instances[index].rendered, `${name}: the buffer of 隆中`);
  }
  assert.ok(peak(ctx.started) <= 48);
  assert.equal(tasks.pending.size, 0);
  assert.equal(unhandled.count, 0, 'no unhandled rejection');
});

test('a listener of audio:unlocked that sets the theme, or disposes the engine: one run of renders, or none (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  const unhandled = unhandledRejections(t);
  const win = /** @type {EventTarget} */ (G.window);

  // the event fires inside unlock(), before the engine has started its renders
  const themed = createAudio();
  win.addEventListener('audio:unlocked', () => themed.setPalette('shachang'), { once: true });
  const unlocking = themed.unlock();
  await settle();
  assert.deepEqual(tasks.due(), [0, 1000, 1500], 'one run is waiting, not two');
  let n = 0;
  while (tasks.runTask()) { n++; await settle(); }
  assert.equal(n, 12);
  assert.equal(FakeOffline.instances.length, 6);
  assert.deepEqual(FakeOffline.instances.map(returnOf), Array(6).fill(0.5 * 0.9 / 0.8), 'of the palette the listener set');
  assert.equal(await within(unlocking), true);
  await settle();
  assert.equal(tasks.pending.size, 0);
  themed.dispose();

  const gone = createAudio();
  win.addEventListener('audio:unlocked', () => gone.dispose(), { once: true });
  const gesture = gone.unlock();
  assert.equal(typeof await within(gesture), 'boolean');
  await settle();
  assert.deepEqual(tasks.due(), [], 'no timer is left behind by an engine that was disposed inside its own event');
  assert.equal(FakeOffline.instances.length, 6, 'and no stinger is set up for it');
  assert.equal(/** @type {FakeContext} */ (FakeContext.instances.at(-1)).state, 'closed');
  assert.equal(gone.unlocked, false);
  assert.equal(unhandled.count, 0);
});

test('muted before the first gesture: the stingers are rendered all the same while the context is parked, and play from their buffers after the unmute (M-121)', async t => {
  install(t);
  const tasks = taskTimers(t);
  const audio = createAudio();
  audio.setMuted(true);
  const unlocking = audio.unlock();
  await settle();
  const ctx = FakeContext.instances[0];
  assert.equal(FakeOffline.instances.length, 0);
  while (tasks.runTask()) await settle();
  assert.equal(await within(unlocking), true);
  await settle();
  assert.equal(ctx.state, 'suspended', 'parked');
  assert.equal(FakeOffline.instances.length, 6);
  assert.equal(tasks.pending.size, 0);
  assert.equal(strike(audio, ctx, 'win').length, 0, 'muted: nothing plays');
  audio.setMuted(false);
  await settle();
  assert.equal(ctx.state, 'running');
  for (const name of PRERENDERED) assert.equal(strike(audio, ctx, name).length, 1, name);
});

// ---------------------------------------------------------------------------------------------------------------------
// The nets of this file (CONTRACT-NOTES N-125, see the top): they are what keeps a test that fails from hanging
// ---------------------------------------------------------------------------------------------------------------------

test('a failing test of this file ends: the fakes print small, endless timers and a promise that never settles are stopped (N-125)', async t => {
  install(t);
  const ctx = new FakeContext();
  const buffer = ctx.createBuffer(2, 1000, 44100);
  const reverb = ctx.createConvolver();
  reverb.buffer = buffer;
  const shaper = ctx.createWaveShaper();
  shaper.curve = new Float32Array(4097);
  reverb.connect(shaper);
  shaper.connect(ctx.destination);
  for (let i = 0; i < 50; i++) ctx.createOscillator().connect(shaper);
  // what node prints of a value when an assertion on it fails (every element of every array, to any depth)
  const printed = (/** @type {unknown} */ value) => inspect(value, { compact: false, customInspect: false, depth: 1000, maxArrayLength: Infinity, showHidden: false });
  for (const [name, value] of Object.entries({ buffer, reverb, shaper })) {
    const lines = printed(value).split('\n').length;
    assert.ok(lines < 60, `a ${name} prints ${lines} lines: its samples, its curve and its context must not be enumerable`);
  }
  assert.equal(buffer.getChannelData(1).length, 1000, 'the samples are there all the same');
  assert.equal(shaper.curve?.length, 4097);
  assert.ok(reverb.context === ctx);

  // an engine that arms the next timer for ever: inside one tick() of the mock timers ...
  const forEver = () => { setTimeout(forEver, 0); };
  setTimeout(forEver, 0);
  assert.throws(() => t.mock.timers.tick(0), new RegExp(`more than ${TIMER_BUDGET} timers`));
  // ... and task by task
  const tasks = taskTimers(t);
  setTimeout(forEver, 0);
  assert.throws(() => { while (tasks.runTask()) { /* the loop the tests of the first gesture run */ } }, new RegExp(`more than ${TASK_BUDGET} timer tasks`));
  // a promise of the engine that never settles
  await assert.rejects(within(new Promise(() => {}), 'a promise that never settles'), new RegExp(`still pending after ${WAIT_TURNS} turns`));
  assert.equal(await within(Promise.resolve(7)), 7);
  await assert.rejects(within(Promise.reject(new Error('refused'))), /refused/);
});

// ---------------------------------------------------------------------------------------------------------------------
// speech.js
// ---------------------------------------------------------------------------------------------------------------------

class FakeUtterance {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    this.lang = '';
    /** @type {object|null} */
    this.voice = null;
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    /** @type {(() => void)|null} */
    this.onend = null;
    /** @type {(() => void)|null} */
    this.onerror = null;
  }
}

/** @param {import('node:test').TestContext} t @param {{lang:string, name:string}[]} voices */
function installSpeech(t, voices) {
  const saved = { window: G.window, SpeechSynthesisUtterance: G.SpeechSynthesisUtterance };
  const synth = {
    /** @type {FakeUtterance[]} */ spoken: [],
    cancelled: 0,
    speaking: false,
    pending: false,
    getVoices: () => voices,
    /** @param {FakeUtterance} u */
    speak(u) { this.spoken.push(u); this.speaking = true; },
    cancel() { this.cancelled++; this.speaking = false; },
    addEventListener() {},
    /** The engine finishes the utterance it is speaking. */
    end() { this.speaking = false; const u = this.spoken.at(-1); if (u && u.onend) u.onend(); },
  };
  const win = Object.assign(new EventTarget(), { speechSynthesis: synth });
  G.window = win;
  G.SpeechSynthesisUtterance = FakeUtterance;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => { G.window = saved.window; G.SpeechSynthesisUtterance = saved.SpeechSynthesisUtterance; });
  /** @type {[number, boolean][]} */
  const ducks = [];
  const audio = /** @type {import('../../../src/ui/types.js').AudioEngine} */ (/** @type {unknown} */ ({
    unlocked: false,
    duck: (/** @type {number} */ db, /** @type {boolean} */ on) => { ducks.push([db, on]); },
  }));
  return { synth, win, audio, ducks };
}

const VOICES = [
  { lang: 'en-US', name: 'Samantha' },
  { lang: 'zh-TW', name: 'Meijia' },
  { lang: 'zh-CN', name: 'Tingting' },
  { lang: 'zh-CN', name: 'Lili' },
];

test('speech: off by default, and nothing is spoken before a user gesture', t => {
  const { synth, audio } = installSpeech(t, VOICES);
  const speech = createSpeech({ audio });
  assert.equal(speech.supported, true);
  speech.feed('m1', '主公且慢。');
  assert.equal(synth.spoken.length, 0, 'read-aloud is off by default');
  speech.setEnabled(true);
  speech.feed('m1', '主公且慢。');
  assert.equal(synth.spoken.length, 0, 'enabled, but no gesture yet (audio is not unlocked)');
  /** @type {{unlocked:boolean}} */ (audio).unlocked = true;
  speech.feed('m1', '主公且慢。');
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].text, '主公且慢。');
});

test('speech: the first zh-CN voice, rate 1.05, pitch 1.0', t => {
  const { synth, audio } = installSpeech(t, VOICES);
  /** @type {{unlocked:boolean}} */ (audio).unlocked = true;
  const speech = createSpeech({ audio });
  speech.setEnabled(true);
  speech.feed('m1', '这步【马二进三】走得稳。');
  const u = synth.spoken[0];
  assert.deepEqual(u.voice, { lang: 'zh-CN', name: 'Tingting' });
  assert.equal(u.lang, 'zh-CN');
  assert.equal(u.rate, 1.05);
  assert.equal(u.pitch, 1.0);
  assert.equal(u.text, '这步马二进三走得稳。', 'brackets never reach the voice');
});

test('speech: a device without a Chinese voice stays silent', t => {
  const { synth, audio, ducks } = installSpeech(t, [{ lang: 'en-US', name: 'Samantha' }, { lang: 'fr-FR', name: 'Thomas' }]);
  /** @type {{unlocked:boolean}} */ (audio).unlocked = true;
  const speech = createSpeech({ audio });
  speech.setEnabled(true);
  /** @type {boolean[]} */
  const seen = [];
  speech.onSpeaking(on => seen.push(on));
  speech.feed('m1', '主公英明！');
  speech.feed('m1', '这一步走得稳。');
  t.mock.timers.tick(2000);
  speech.flush('m1');
  assert.equal(synth.spoken.length, 0);
  assert.deepEqual(ducks, [], 'nothing is spoken, so the music is never ducked: no pumping at every sentence');
  assert.deepEqual(seen, [], 'and "speaking" is never reported (chat ticks stay on)');
});

test('speech: the music is ducked 10 dB while he speaks; sentences that wait are spoken together', t => {
  const { synth, audio, ducks } = installSpeech(t, VOICES);
  /** @type {{unlocked:boolean}} */ (audio).unlocked = true;
  const speech = createSpeech({ audio });
  /** @type {boolean[]} */
  const seen = [];
  speech.onSpeaking(on => seen.push(on));
  speech.setEnabled(true);
  speech.feed('m1', '第一句。');
  assert.deepEqual(ducks, [[10, true]]);
  assert.deepEqual(seen, [true]);
  speech.feed('m1', '第二句。');
  speech.feed('m1', '第三句。');
  assert.equal(synth.spoken.length, 1, 'one utterance at a time');
  synth.end();
  assert.equal(synth.spoken.length, 2);
  assert.equal(synth.spoken[1].text, '第二句。第三句。');
  synth.end();
  // the line was not flushed: "speaking" lingers so the music does not pump between sentences
  assert.deepEqual(seen, [true]);
  speech.feed('m1', '第四句。');
  assert.equal(synth.spoken.length, 3);
  speech.flush('m1');
  assert.deepEqual(seen, [true], 'flush while he still speaks changes nothing yet');
  synth.end();
  assert.deepEqual(seen, [true, false], 'the line is complete and spoken: speaking ends at once');
  assert.deepEqual(ducks, [[10, true], [10, false]]);
});

test('speech: an unflushed line releases the music after a moment; cancel() silences at once; a new line replaces the old', t => {
  const { synth, audio, ducks } = installSpeech(t, VOICES);
  /** @type {{unlocked:boolean}} */ (audio).unlocked = true;
  const speech = createSpeech({ audio });
  speech.setEnabled(true);
  speech.feed('m1', '第一句。');
  synth.end();
  assert.deepEqual(ducks, [[10, true]]);
  t.mock.timers.tick(1000);
  assert.deepEqual(ducks, [[10, true], [10, false]]);

  speech.feed('m2', '旧的一行，很长很长。');
  speech.feed('m2', '还没读到的一句。');
  speech.feed('m3', '新的一行。');
  assert.equal(synth.cancelled, 1, 'the old line is cut');
  t.mock.timers.tick(100);
  assert.equal(synth.spoken.at(-1)?.text, '新的一行。', 'the unread sentence of the old line is dropped');

  speech.feed('m3', '第二句。');
  speech.cancel();
  assert.equal(synth.cancelled, 2);
  assert.deepEqual(ducks.at(-1), [10, false]);
  const n = synth.spoken.length;
  t.mock.timers.tick(5000);
  assert.equal(synth.spoken.length, n, 'nothing that was waiting is spoken after cancel()');

  speech.feed('m4', '再来。');
  t.mock.timers.tick(100);
  speech.setEnabled(false);
  assert.equal(synth.cancelled, 3, 'switching read-aloud off silences it');
  speech.feed('m5', '不会读。');
  t.mock.timers.tick(100);
  assert.equal(synth.spoken.at(-1)?.text, '再来。');
});

test('speech: without speechSynthesis the controller is inert', t => {
  const saved = G.window;
  G.window = new EventTarget();
  t.after(() => { G.window = saved; });
  const speech = createSpeech({ audio: createAudio() });
  assert.equal(speech.supported, false);
  speech.setEnabled(true);
  speech.feed('m1', '主公');
  speech.flush('m1');
  speech.cancel();
  speech.onSpeaking(() => {});
});
