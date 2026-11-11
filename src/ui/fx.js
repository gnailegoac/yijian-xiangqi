// Effects: particles, shake, hit-stop, flash, haptics, banners, popups, stamps (SPEC §4.28.2, §10.4). Package X3.
//
// One canvas for every particle and one DOM layer for banners, popups and stamps, both inside the .bv-fx element
// that board-view hands to mount(). fx emits no events and has no audio dependency: whoever calls banner / popup /
// stamp plays the matching sound and haptic at the same moment (§10.5.4).
//
// Coordinates: every Pt is CSS px relative to .bv. The canvas bleeds 0.5 c past the board on every side; the
// context is translated by that bleed once per frame, so particles are stored in .bv coordinates as well.
// Catalogue units (§10.4.2): speeds in c per second, sizes in c (the full extent of a particle: a diameter or a
// length; only a ring's size is a radius); both are turned into px when a particle is spawned.
//
// The drawing rules are the performance contract of §10.4.1: flat fills with vertices rotated by hand, no
// shadowBlur, no per-particle gradient, no per-particle setTransform, globalAlpha touched only in the last 30 %
// of a particle's life, at most 48 soft sprites alive, composite mode left at source-over.

/** @import { BannerKind, BurstKind, Fx, Pt } from './types.js' */

import { TXT } from './texts.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ---- engine numbers (§10.4.1) ----------------------------------------------------------------------------------------

const CAPACITY = 320;                       // pool size; spawning beyond it is silently dropped
const SOFT_CAP = 48;                        // soft sprites alive at once
const MAX_BACKING_PIXELS = 1_200_000;       // never more than this to clear
const BLEED = 0.5;                          // canvas bleed past the board, in c
const MAX_DT = 0.033;                       // integration step cap, seconds
const Q_TIERS = [1, 0.6, 0.35];             // quality governor tiers
const SLOW_GAP_MS = 22;                     // a frame-gap average above this is "slow"
const SLOW_FRAMES = 20;                     // consecutive slow frames that cost one tier
const GAP_WEIGHT = 0.2;                     // weight of the newest frame gap in the moving average
const GAP_CAP_MS = 100;                     // one hiccup is not allowed to count as more than this
const GAP_BREAK_MS = 250;                   // a longer gap is a pause (hidden tab), not a slow frame

// Particle shapes (Uint8Array `shape`). ARC is the sweeping stroke of `slash`.
const DOT = 0, SHARD = 1, RECT = 2, STAR = 3, STREAK = 4, RING = 5, SOFT = 6, ARC = 7;

// Palette slots (Uint8Array `slot`). The first five are the theme's particle palette; confetti uses all five.
// WIND and WIND_B are the two streak colours of the fan-sweep (refreshPalette picks them by the field).
const SPARK = 0, EMBER = 1, COOL = 2, WHITE = 3, SEL = 4, DUST = 5, SMOKE = 6, WIND = 7, WIND_B = 8, BASE_SLOTS = 9;
const FESTIVE = [SPARK, EMBER, COOL, WHITE, SEL];
const SMOKE_COLOR = 'rgba(136, 144, 160, 0.35)';       // #8890a0 at 35 %
/** The chibi values of §10.1, used until the theme has been read (and where a token is missing). */
const DEFAULT_PALETTE = ['#ffd166', '#ff7a3d', '#58dcff', '#ffffff', '#ffd166', 'rgba(169, 141, 88, 0.6)', SMOKE_COLOR,
  'rgba(255, 255, 255, 0.55)', '#ffd166'];
const WIND_ALPHA = 0.55;                    // the catalogue's "white at 55 %" (on a dark field)
const WIND_INK_ALPHA = 0.85;                // ink on a light field: a streak then has over 4 : 1 against the field (that white on 赤壁: 5.6 : 1)
const LIGHT_FIELD = 0.3;                    // relative luminance of --field-a above which a field counts as light

// Easings of styles/tokens.css. Element.animate() cannot read a custom property, so they are repeated here.
const E_OUT = 'cubic-bezier(.2,.8,.2,1)';
const E_IN = 'cubic-bezier(.6,0,.9,.4)';
const E_INOUT = 'cubic-bezier(.65,0,.35,1)';
const E_BACK = 'cubic-bezier(.34,1.56,.64,1)';
const E_LEAVE = 'cubic-bezier(.4,0,1,1)';              // exits: start gently, leave fast

// ---- shake and haptics (§10.4.3) -------------------------------------------------------------------------------------

/** level -> [amplitude px, duration ms]. Level 3 is also capped at .18 c. */
const SHAKE = { 1: [2, 120], 2: [4, 200], 3: [7, 320] };
const SHAKE_STEPS = 8;

/** navigator.vibrate patterns, ms. */
const HAPTIC = {
  tap: 8, place: 12, capture: 25, blast: [15, 40, 35], check: [30, 40, 30], win: [20, 30, 20, 30, 60], illegal: [6, 30, 6],
};

// ---- banners, popups, stamps (§10.4.4) -------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The brush stroke behind a banner, viewBox 0 0 400 60, stretched to the box. */
const BRUSH_PATH = 'M4 30 C20 8 60 6 110 10 S230 4 300 9 S380 12 396 28 C392 46 350 54 290 51 S150 57 90 52 S14 50 4 30 Z';

/**
 * size: font size in c. enter: 'pop' = brush wipe + text scale 1.6 -> 1 (ease back); 'slam' = wipe 120 ms + text
 * scale 2.4 -> 1 (ease in), then shake(2) and 16 sparks on landing; 'rise' = fade + rise .2 c; 'slide' = slide .5 c
 * from the left + fade. Times in ms; `still` is the hold under reduced motion (fade 150 / hold / fade 150).
 * The "extras" of the table in §10.4.4 (sounds, haptics, the red flash of a check the child receives) belong to the
 * caller, like every sound that goes with fx: board-view plays them at the moment it calls banner().
 * @type {Record<BannerKind, {tone:'mine'|'danger'|'calm', size:number, enter:'pop'|'slam'|'rise'|'slide', in:number, hold:number, out:number, still:number}>}
 */
const BANNERS = {
  start:     { tone: 'mine', size: 2.0, enter: 'pop',   in: 220, hold: 600, out: 200, still: 900 },
  check:     { tone: 'mine', size: 2.0, enter: 'slam',  in: 180, hold: 450, out: 200, still: 800 },
  mate:      { tone: 'mine', size: 2.6, enter: 'slam',  in: 220, hold: 900, out: 250, still: 1200 },
  stalemate: { tone: 'mine', size: 2.0, enter: 'pop',   in: 220, hold: 800, out: 200, still: 800 },
  lose:      { tone: 'calm', size: 1.5, enter: 'rise',  in: 300, hold: 900, out: 300, still: 900 },
  draw:      { tone: 'calm', size: 1.5, enter: 'rise',  in: 300, hold: 900, out: 300, still: 900 },
  river:     { tone: 'calm', size: 1.1, enter: 'slide', in: 160, hold: 400, out: 140, still: 400 },
};
const BANNER_C_MIN = 20, BANNER_C_MAX = 48;    // "2.0 c (40–96 px)": the cell a banner is sized from is clamped to this
const BANNER_SLAM_WIPE = 120;
const BANNER_REPLACE_FADE = 80;
const BANNER_STILL_FADE = 150;
const BANNER_AVOID = 1.2;                      // c: the band keeps this far from the checked king
const FIT = 0.92;                              // a label never takes more than this share of the board width

const POPUP_RISE = 0.9;                        // c, over POPUP_MS
const POPUP_MS = 900, POPUP_FADE = 300, POPUP_SCALE_MS = 200;
const POPUP_STILL_HOLD = 900, POPUP_STILL_FADE = 200;
const MARK_MS = 700, MARK_FADE = 200;
/** Stars that go with a praise popup. */
const POPUP_STARS = { good: 0, great: 8, brilliant: 14, lord: 14 };

/** font in c; times in ms. */
const STAMPS = {
  full:  { font: 1.5, in: 160, hold: 900, out: 250 },
  small: { font: 0.7, in: 120, hold: 500, out: 200 },
};
const STAMP_STILL_FADE = 150;

// ---- small helpers ---------------------------------------------------------------------------------------------------

/** @param {number} lo @param {number} x @param {number} hi */
const clamp = (lo, x, hi) => Math.max(lo, Math.min(hi, x));
/** @param {number} a @param {number} b */
const rnd = (a, b) => a + Math.random() * (b - a);
/** @param {number} n */
const px = n => `${n.toFixed(2)}px`;
/** @template T @param {readonly T[]} list @param {number} i @returns {T} */
const cycle = (list, i) => list[i % list.length];

/**
 * A CSS colour for a DOM style: a bare custom-property name becomes var(...).
 * @param {string} color
 */
const cssColor = color => (color.startsWith('--') ? `var(${color})` : color);

/**
 * The brushed band of a banner (or of the 主公英明 popup): a shadow stroke and the band itself.
 * @param {string} className
 */
function brushBand(className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 400 60');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of ['shade', 'fill']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', `fx-brush fx-brush--${part}`);
    path.setAttribute('d', BRUSH_PATH);
    svg.append(path);
  }
  return svg;
}

/**
 * A div, or a span for the text parts. A label that ends with a full-width ！ is marked data-tail="mark": the mark
 * draws in the left third of its box, and fx.css shifts such a label so that its glyphs look centred.
 * @param {string} className
 * @param {string} [text]
 */
function make(className, text) {
  const el = document.createElement(/__(text|seal|mark)$/.test(className) ? 'span' : 'div');
  el.className = className;
  if (text !== undefined) {
    el.textContent = text;
    if (text.endsWith('！')) el.dataset.tail = 'mark';
  }
  return el;
}

// ---- the factory -----------------------------------------------------------------------------------------------------

/** @param {{ reducedMotion?:boolean, haptics?:boolean }} [opts] @returns {Fx} */
export function createFx(opts) {
  let reduced = opts?.reducedMotion === true;
  let haptics = opts?.haptics !== false;           // Settings.haptics defaults to true

  // DOM, created by mount()
  /** @type {HTMLElement|null} */ let root = null;        // .bv-fx
  /** @type {Element|null} */ let host = null;            // .bv: what shakes and what hit-stop freezes
  /** @type {HTMLCanvasElement|null} */ let canvas = null;
  /** @type {CanvasRenderingContext2D|null} */ let ctx = null;
  /** @type {CanvasRenderingContext2D|null} */ let scratch = null;   // 1 px context that normalises CSS colours
  /** @type {HTMLElement|null} */ let layer = null;       // div.fx-banners
  /** @type {HTMLElement|null} */ let flashEl = null;
  /** @type {HTMLElement|null} */ let windEl = null;

  // geometry, written by resize()
  let W = 0, H = 0, c = 0;                 // board size and cell pitch, CSS px
  let sx = 1, sy = 1;                      // backing-store pixels per CSS px

  // the pool: struct of arrays, death = swap with the last live particle
  const pX = new Float32Array(CAPACITY), pY = new Float32Array(CAPACITY);
  const pVx = new Float32Array(CAPACITY), pVy = new Float32Array(CAPACITY);
  const pLife = new Float32Array(CAPACITY), pTtl = new Float32Array(CAPACITY);      // seconds; life > ttl = not born yet
  const pSize = new Float32Array(CAPACITY);
  const pRot = new Float32Array(CAPACITY), pVr = new Float32Array(CAPACITY);        // a dot does not turn: its vr is its growth, px/s
  const pGrav = new Float32Array(CAPACITY), pDrag = new Float32Array(CAPACITY);
  const pShape = new Uint8Array(CAPACITY), pSlot = new Uint8Array(CAPACITY);
  let live = 0;
  let softLive = 0;

  // palette: slot -> fill string; slots from BASE_SLOTS up are colours handed in by callers
  /** @type {string[]} */ const palette = DEFAULT_PALETTE.slice();
  /** @type {Map<string, number>} */ const custom = new Map();
  /** @type {(HTMLCanvasElement|undefined)[]} */ const sprites = [];

  // loop and governor
  let raf = 0;
  let lastFrame = 0;
  let tier = 0;
  let q = Q_TIERS[0];
  let gapAverage = 1000 / 60;
  let slowFrames = 0;

  // hit-stop
  let freezeUntil = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */ let freezeTimer = null;
  /** @type {Set<Animation>} */ const frozen = new Set();

  /** @type {Animation|null} */ let shakeAnim = null;
  /** @type {Animation|null} */ let windAnim = null;

  /** @type {{ x0:number, y0:number, x1:number, y1:number, arc:number, ms:number, start:number, held:number, dropped:number, drops:number,
   *           done:() => void, timer:ReturnType<typeof setTimeout> }|null} */
  let shot = null;

  /** @type {{ el:HTMLElement, done:() => void }|null} */ let bannerNow = null;
  /** @type {{ el:HTMLElement, done:() => void }|null} */ let stampNow = null;
  /** @type {{ el:HTMLElement, at:Pt, mark:HTMLElement|null }|null} */ let popupNow = null;
  /** @type {{ el:HTMLElement, text:string }|null} */ let markNow = null;
  /**
   * Elements on their way out (a replaced banner, reduced-motion rings): removed by their animation or by clear().
   * @type {Set<HTMLElement>}
   */
  const leaving = new Set();

  // ---- geometry ------------------------------------------------------------------------------------------------------

  /** @param {number} cssW @param {number} cssH @param {number} cell */
  function resize(cssW, cssH, cell) {
    if (!(cssW > 0 && cssH > 0 && cell > 0)) return;
    if (c > 0 && cell !== c) {                       // particles in flight keep their place on the board
      const k = cell / c;
      for (let i = 0; i < live; i++) {
        pX[i] *= k; pY[i] *= k; pVx[i] *= k; pVy[i] *= k; pSize[i] *= k; pGrav[i] *= k;
        if (pShape[i] === DOT) pVr[i] *= k;
      }
      if (shot) { shot.x0 *= k; shot.y0 *= k; shot.x1 *= k; shot.y1 *= k; shot.arc *= k; }
    }
    W = cssW; H = cssH; c = cell;
    if (!canvas) return;
    const cw = W + 2 * BLEED * c, ch = H + 2 * BLEED * c;           // the canvas box, bleed included
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const scale = Math.min(dpr, 2, Math.sqrt(MAX_BACKING_PIXELS / (cw * ch)));
    const bw = Math.max(1, Math.floor(cw * scale)), bh = Math.max(1, Math.floor(ch * scale));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    sx = bw / cw; sy = bh / ch;
    if (live > 0 || shot) kick();
  }

  /** True when the board size is known; asks the mounted element once if resize() has not been called yet. */
  function sized() {
    if (c > 0) return true;
    if (!root) return false;
    const w = root.clientWidth, h = root.clientHeight;
    if (w > 0 && h > 0) resize(w, h, w / 9.2);
    return c > 0;
  }

  // ---- colours -------------------------------------------------------------------------------------------------------

  /**
   * `color` with its alpha multiplied by `a`, as an rgba() string the canvas accepts.
   * @param {string} color @param {number} a
   */
  function withAlpha(color, a) {
    if (!scratch) return color;
    scratch.fillStyle = '#000';
    scratch.fillStyle = color;                               // an invalid colour leaves black
    const norm = String(scratch.fillStyle);                  // '#rrggbb' or 'rgba(r, g, b, a)'
    if (norm.startsWith('#')) {
      return `rgba(${parseInt(norm.slice(1, 3), 16)}, ${parseInt(norm.slice(3, 5), 16)}, ${parseInt(norm.slice(5, 7), 16)}, ${a})`;
    }
    const m = /^rgba?\(([^)]+)\)$/.exec(norm);
    if (!m) return norm;
    const parts = m[1].split(',').map(Number);
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${(parts.length > 3 ? parts[3] : 1) * a})`;
  }

  /**
   * Relative luminance (WCAG) of a colour, 0..1; 0 when it cannot be read.
   * @param {string} color
   */
  function luminance(color) {
    if (!scratch) return 0;
    scratch.fillStyle = '#000';
    scratch.fillStyle = color;
    const norm = String(scratch.fillStyle);                  // '#rrggbb' or 'rgba(r, g, b, a)'
    const rgb = norm.startsWith('#')
      ? [1, 3, 5].map(i => parseInt(norm.slice(i, i + 2), 16))
      : (/^rgba?\(([^)]+)\)$/.exec(norm)?.[1].split(',').slice(0, 3).map(Number) ?? [0, 0, 0]);
    const [r, g, b] = rgb.map(v => { const u = v / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * A caller's colour for the canvas: `--token` and `var(--token)` are read from the theme.
   * @param {string} color
   */
  function resolveColor(color) {
    const m = /^(?:var\(\s*)?(--[\w-]+)\s*\)?$/.exec(color);
    if (!m) return color;
    const value = root ? getComputedStyle(root).getPropertyValue(m[1]).trim() : '';
    return value || palette[SPARK];
  }

  /** @param {string} color @returns {number} palette slot */
  function slotFor(color) {
    const key = color.trim();
    const known = custom.get(key);
    if (known !== undefined) return known;
    if (palette.length >= 255) return SPARK;
    const slot = palette.length;
    palette.push(resolveColor(key));
    custom.set(key, slot);
    return slot;
  }

  /** Callers' colours are forgotten whenever nothing is alive, so a theme change can never leave a stale one behind. */
  function forgetCustomColors() {
    if (palette.length === BASE_SLOTS) return;
    palette.length = BASE_SLOTS;
    sprites.length = BASE_SLOTS;
    custom.clear();
  }

  function refreshPalette() {
    if (!root) return;
    const style = getComputedStyle(root);
    /** @param {string} name @param {string} fallback */
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    palette[SPARK] = read('--fx-spark', DEFAULT_PALETTE[SPARK]);
    palette[EMBER] = read('--fx-ember', DEFAULT_PALETTE[EMBER]);
    palette[COOL] = read('--fx-cool', DEFAULT_PALETTE[COOL]);
    palette[WHITE] = read('--fx-white', DEFAULT_PALETTE[WHITE]);
    palette[SEL] = read('--sel', DEFAULT_PALETTE[SEL]);
    palette[DUST] = withAlpha(read('--label', '#a98d58'), 0.6);
    palette[SMOKE] = SMOKE_COLOR;
    // The wind of the pouches (CONTRACT-NOTES K-97). The catalogue's streaks are white at 55 % and spark: they show on
    // a dark field (赤壁). On a light field (隆中, 沙场) white cannot be seen, so the streaks take darker tones of the
    // theme, its grid ink and its hint colour, and fx.css darkens the band instead of lighting it (data-field).
    const light = luminance(read('--field-a', '#1b2440')) > LIGHT_FIELD;
    palette[WIND] = light ? withAlpha(read('--line', '#4f5f45'), WIND_INK_ALPHA) : withAlpha(palette[WHITE], WIND_ALPHA);
    palette[WIND_B] = light ? read('--arrow-hint', palette[SPARK]) : palette[SPARK];
    if (windEl) windEl.dataset.field = light ? 'light' : 'dark';
    sprites.length = 0;                                      // soft sprites are re-rendered on demand
    if (live === 0) forgetCustomColors();
    else for (const [key, slot] of custom) palette[slot] = resolveColor(key);      // tokens handed in by callers follow the theme too
  }

  /** The 32 px pre-rendered radial dot of a palette colour (the only sprite). @param {number} slot */
  function sprite(slot) {
    let s = sprites[slot];
    if (!s) {
      s = document.createElement('canvas');
      s.width = s.height = 32;
      const g = s.getContext('2d');
      if (g) {
        const col = palette[slot];
        const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, col); grad.addColorStop(0.45, col); grad.addColorStop(1, withAlpha(col, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, 32, 32);
      }
      sprites[slot] = s;
    }
    return s;
  }

  // ---- pool ----------------------------------------------------------------------------------------------------------

  /**
   * @param {number} shape @param {number} slot @param {number} x @param {number} y @param {number} vx @param {number} vy
   * @param {number} ttl seconds @param {number} size px @param {number} rot @param {number} vr @param {number} gravity px/s²
   * @param {number} drag 1/s @param {number} delay seconds before the particle is born
   */
  function spawn(shape, slot, x, y, vx, vy, ttl, size, rot, vr, gravity, drag, delay) {
    if (live >= CAPACITY) return;
    if (shape === SOFT) {
      if (softLive >= SOFT_CAP) return;
      softLive++;
    }
    const i = live++;
    pShape[i] = shape; pSlot[i] = slot;
    pX[i] = x; pY[i] = y; pVx[i] = vx; pVy[i] = vy;
    pTtl[i] = ttl; pLife[i] = ttl + delay;
    pSize[i] = size; pRot[i] = rot; pVr[i] = vr; pGrav[i] = gravity; pDrag[i] = drag;
  }

  /** @param {number} i */
  function kill(i) {
    if (pShape[i] === SOFT) softLive--;
    const last = --live;
    if (i === last) return;
    pShape[i] = pShape[last]; pSlot[i] = pSlot[last];
    pX[i] = pX[last]; pY[i] = pY[last]; pVx[i] = pVx[last]; pVy[i] = pVy[last];
    pTtl[i] = pTtl[last]; pLife[i] = pLife[last];
    pSize[i] = pSize[last]; pRot[i] = pRot[last]; pVr[i] = pVr[last]; pGrav[i] = pGrav[last]; pDrag[i] = pDrag[last];
  }

  /**
   * A catalogue count at the current quality: multiplied by q, never below 3 (single items stay single).
   * A count that is not a positive number gives 0, and no count is larger than the pool, so a caller's bad `n`
   * can never keep the main thread in a spawn loop.
   * @param {number} n
   */
  function count(n) {
    if (!(n > 0)) return 0;
    const k = Math.min(n, CAPACITY);
    return k <= 3 ? Math.round(k) : Math.max(3, Math.round(k * q));
  }

  /** True when particles may be spawned now. */
  function canSpawn() {
    if (reduced || !ctx || !sized()) return false;
    if (live === 0) forgetCustomColors();
    return true;
  }

  // ---- loop ----------------------------------------------------------------------------------------------------------

  function kick() {
    if (!raf && ctx) raf = requestAnimationFrame(frame);
  }

  /** @param {number} to tier index */
  function setTier(to) {
    tier = to;
    q = Q_TIERS[to];
    if (canvas) canvas.dataset.q = String(q);
  }

  /** The measured-frame rule: the only thing that lowers q. @param {number} gap ms */
  function govern(gap) {
    gapAverage += (Math.min(gap, GAP_CAP_MS) - gapAverage) * GAP_WEIGHT;
    if (gapAverage <= SLOW_GAP_MS) { slowFrames = 0; return; }
    if (++slowFrames < SLOW_FRAMES) return;
    slowFrames = 0;
    if (tier < Q_TIERS.length - 1) setTier(tier + 1);
  }

  /** @param {number} now */
  function frame(now) {
    raf = 0;
    const gap = lastFrame > 0 ? now - lastFrame : 0;
    lastFrame = now;
    const measured = gap > 0 && gap < GAP_BREAK_MS;
    if (measured && live > 0) govern(gap);
    const stopped = now < freezeUntil;                       // hit-stop: draw, do not integrate
    draw(stopped ? 0 : Math.min(MAX_DT, measured ? gap / 1000 : 1 / 60), stopped ? gap : 0);
    if (live > 0 || shot) raf = requestAnimationFrame(frame);
    else lastFrame = 0;
  }

  /**
   * One frame: integrate by dt seconds and draw everything.
   * @param {number} dt @param {number} heldMs time this frame spent in hit-stop
   */
  function draw(dt, heldMs) {
    const g = ctx;
    if (!g || !canvas) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(sx, 0, 0, sy, BLEED * c * sx, BLEED * c * sy);
    g.lineCap = 'round';
    let alpha = 1, fill = -1, stroke = -1;
    const streakHalf = Math.max(0.6, 0.015 * c);             // streaks are .03 c wide
    for (let i = 0; i < live; i++) {
      const life = pLife[i] - dt;
      if (life <= 0) { kill(i); i--; continue; }
      pLife[i] = life;
      const ttl = pTtl[i];
      if (life > ttl) continue;                              // delayed spawn: not born yet
      const shape = pShape[i];
      if (dt > 0) {
        const drag = pDrag[i];
        if (drag > 0) { const f = Math.max(0, 1 - drag * dt); pVx[i] *= f; pVy[i] *= f; }
        pVy[i] += pGrav[i] * dt;
        pX[i] += pVx[i] * dt; pY[i] += pVy[i] * dt;
        if (shape === DOT) { if (pVr[i] !== 0) pSize[i] = Math.max(0.5, pSize[i] + pVr[i] * dt); }
        else pRot[i] += pVr[i] * dt;
      }
      const k = life / ttl;
      const a = k < 0.3 ? k / 0.3 : 1;
      if (a !== alpha) g.globalAlpha = alpha = a;
      const slot = pSlot[i], x = pX[i], y = pY[i], s = pSize[i];

      if (shape === SOFT) { g.drawImage(sprite(slot), x - s / 2, y - s / 2, s, s); continue; }

      if (shape === RING || shape === ARC) {
        if (slot !== stroke) { g.strokeStyle = palette[slot]; stroke = slot; }
        const u = 1 - k;
        g.beginPath();
        if (shape === RING) {                                // radius .45 -> 1.0 (x size), line .06 c -> .01 c
          g.lineWidth = Math.max(0.5, c * (0.06 - 0.05 * u));
          g.arc(x, y, s * (0.45 + 0.55 * (1 - (1 - u) * (1 - u))), 0, TAU);
        } else {                                             // 100° arc: the head sweeps out, the tail follows
          const head = Math.min(1, u / 0.7), tail = u < 0.35 ? 0 : (u - 0.35) / 0.65;
          const sweep = 100 * DEG * pVr[i];
          g.lineWidth = Math.max(1, c * (0.11 - 0.07 * u));
          g.arc(x, y, s, pRot[i] + sweep * tail * tail, pRot[i] + sweep * (1 - (1 - head) * (1 - head)), pVr[i] < 0);
        }
        g.stroke();
        continue;
      }

      if (slot !== fill) { g.fillStyle = palette[slot]; fill = slot; }
      g.beginPath();
      if (shape === DOT) {
        g.arc(x, y, s / 2, 0, TAU);
      } else if (shape === STREAK) {                         // a line along the velocity, tapering to its tail
        let ux = pVx[i], uy = pVy[i];
        const speed = Math.hypot(ux, uy);
        if (speed > 1) { ux /= speed; uy /= speed; } else { ux = Math.cos(pRot[i]); uy = Math.sin(pRot[i]); }
        const nx = -uy * streakHalf, ny = ux * streakHalf, tx = x - ux * s, ty = y - uy * s;
        g.moveTo(x + nx, y + ny); g.lineTo(x - nx, y - ny);
        g.lineTo(tx - nx * 0.3, ty - ny * 0.3); g.lineTo(tx + nx * 0.3, ty + ny * 0.3);
      } else {
        const h = s / 2, cs = Math.cos(pRot[i]) * h, sn = Math.sin(pRot[i]) * h;
        if (shape === SHARD) {                               // an uneven triangle
          g.moveTo(x + cs, y + sn);
          g.lineTo(x - 0.7 * cs - 0.55 * sn, y - 0.7 * sn + 0.55 * cs);
          g.lineTo(x - 0.45 * cs + 0.6 * sn, y - 0.45 * sn - 0.6 * cs);
        } else if (shape === RECT) {                         // confetti: the short side flutters
          const w = 0.58 * Math.abs(Math.cos(life * 9 + s * 31));
          const bx = -sn * w, by = cs * w;
          g.moveTo(x + cs + bx, y + sn + by); g.lineTo(x - cs + bx, y - sn + by);
          g.lineTo(x - cs - bx, y - sn - by); g.lineTo(x + cs - bx, y + sn - by);
        } else {                                             // STAR: four points, 8 vertices, each a 45° turn of the last
          let vx = cs, vy = sn;
          g.moveTo(x + vx, y + vy);
          for (let j = 1; j < 8; j++) {
            const rx = (vx - vy) * Math.SQRT1_2, ry = (vx + vy) * Math.SQRT1_2;
            vx = rx; vy = ry;
            const r = j % 2 ? 0.38 : 1;
            g.lineTo(x + vx * r, y + vy * r);
          }
        }
      }
      g.fill();
    }
    if (alpha !== 1) g.globalAlpha = 1;

    if (shot) {                                              // the cannon's ember, over every particle
      const p = shot;
      p.held += heldMs;
      const u = clamp(0, (performance.now() - p.start - p.held) / p.ms, 1);
      while (p.dropped < p.drops && u >= (p.dropped + 0.5) / p.drops) {
        const v = (p.dropped + 0.5) / p.drops;
        spawn(DOT, p.dropped % 2 ? SPARK : WHITE, p.x0 + (p.x1 - p.x0) * v, p.y0 + (p.y1 - p.y0) * v - 4 * p.arc * v * (1 - v), 0, 0,
          rnd(0.2, 0.26), rnd(0.05, 0.10) * c, 0, 0, 0, 0, 0);
        p.dropped++;
      }
      if (u >= 1) {
        endShot();
      } else {
        const x = p.x0 + (p.x1 - p.x0) * u, y = p.y0 + (p.y1 - p.y0) * u - 4 * p.arc * u * (1 - u);
        if (tier < 2) { const halo = 0.4 * c; g.drawImage(sprite(EMBER), x - halo / 2, y - halo / 2, halo, halo); }
        g.fillStyle = palette[EMBER];
        g.beginPath(); g.arc(x, y, 0.08 * c, 0, TAU); g.fill();
      }
    }
  }

  function killParticles() {
    live = 0; softLive = 0;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lastFrame = 0;
    if (ctx && canvas) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  // ---- particle catalogue (§10.4.2) ----------------------------------------------------------------------------------

  /**
   * Sparks: streaks .15–.30 c, speed 4–8 within ±25° of dir (or radial), drag 3/s, 180–300 ms.
   * rx / ry: the streaks start on an ellipse around the point and fly outward (a DOM label covers the centre).
   * @param {number} x @param {number} y @param {number} n @param {number|undefined} dir @param {number|undefined} slot
   * @param {number} [rx] @param {number} [ry] @param {number} [delay] seconds
   */
  function sparks(x, y, n, dir, slot, rx = 0, ry = 0, delay = 0) {
    for (let i = 0; i < n; i++) {
      let angle = dir === undefined ? TAU * (i + Math.random()) / n : dir + rnd(-25, 25) * DEG;
      let px0 = x, py0 = y;
      if (rx > 0 || ry > 0) {
        px0 += Math.cos(angle) * rx; py0 += Math.sin(angle) * ry;
        angle = Math.atan2(Math.sin(angle) * rx, Math.cos(angle) * ry) + rnd(-12, 12) * DEG;      // the ellipse's normal
      }
      const speed = rnd(4, 8) * c;
      spawn(STREAK, slot ?? (i % 2 ? WHITE : SPARK), px0, py0, Math.cos(angle) * speed, Math.sin(angle) * speed,
        rnd(0.18, 0.30), rnd(0.15, 0.30) * c, angle, 0, 0, 3, delay);
    }
  }

  /**
   * Shards .10–.20 c: radial 2–6 (within ±60° of dir if given), gravity 9, drag 1.5/s, spin ±12 rad/s, 450–700 ms.
   * @param {number} x @param {number} y @param {number} n @param {number|undefined} dir @param {readonly number[]} slots
   */
  function shards(x, y, n, dir, slots) {
    for (let i = 0; i < n; i++) {
      const angle = dir === undefined ? rnd(0, TAU) : dir + rnd(-60, 60) * DEG;
      const speed = rnd(2, 6) * c;
      spawn(SHARD, Math.random() < 0.15 ? WHITE : cycle(slots, i), x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        rnd(0.45, 0.70), rnd(0.10, 0.20) * c, rnd(0, TAU), rnd(-12, 12), 9 * c, 1.5, 0);
    }
  }

  /**
   * Ten dots .05–.10 c placed evenly on the segment, no velocity, 200–260 ms, fade only.
   * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
   */
  function trailDots(x0, y0, x1, y1) {
    const n = count(10);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      spawn(DOT, i % 2 ? SPARK : WHITE, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 0, 0, rnd(0.2, 0.26), rnd(0.05, 0.10) * c, 0, 0, 0, 0, 0);
    }
  }

  /**
   * The side colours handed in by board-view (the victim's body and rim), as palette slots.
   * @param {{color?:string, colors?:string[]}|undefined} o @returns {number[]}
   */
  function sideSlots(o) {
    if (o?.colors && o.colors.length > 0) return o.colors.map(slotFor);
    if (o?.color) return [slotFor(o.color)];
    return [SPARK, EMBER];
  }

  /**
   * @param {BurstKind} kind @param {Pt} at
   * @param {{n?:number, dir?:number, size?:number, color?:string, colors?:string[], scale?:number}} [o]
   */
  function burst(kind, at, o) {
    if (reduced) {                                           // the only static stand-ins: a ring that fades
      if (kind === 'ring') stillRing(at, o?.size ?? 1, o?.color ?? '--sel');
      else if (kind === 'explosion') stillRing(at, 1.6, '--fx-spark');
      return;
    }
    if (!canSpawn()) return;
    const { x, y } = at;
    const dir = o?.dir;
    const tint = o?.color === undefined ? undefined : slotFor(o.color);
    switch (kind) {
      case 'dust': {                                         // rook / cannon landings: a puff behind the piece
        const n = count(clamp(4, o?.n ?? 8, 8));
        for (let i = 0; i < n; i++) {
          const angle = dir === undefined ? rnd(0, TAU) : dir + Math.PI + rnd(-60, 60) * DEG;
          const speed = rnd(0.6, 1.6) * c, cos = Math.cos(angle), sin = Math.sin(angle);
          spawn(DOT, tint ?? DUST, x + cos * 0.3 * c, y + sin * 0.3 * c, cos * speed, sin * speed,
            rnd(0.28, 0.42), rnd(0.08, 0.14) * c, 0, 0, -0.5 * c, 4, 0);
        }
        break;
      }
      case 'ring':
        spawn(RING, tint ?? SEL, x, y, 0, 0, 0.3, (o?.size ?? 1) * c, 0, 0, 0, 0, 0);
        break;
      case 'capture': {                                      // 60 % shards, 40 % dots
        const n = count(o?.n ?? 24 * (o?.scale ?? 1));
        const slots = sideSlots(o);
        const nShards = Math.round(n * 0.6);
        shards(x, y, nShards, dir, slots);
        for (let i = nShards; i < n; i++) {
          const angle = dir === undefined ? rnd(0, TAU) : dir + rnd(-60, 60) * DEG;
          const speed = rnd(2, 6) * c;
          spawn(DOT, Math.random() < 0.15 ? WHITE : cycle(slots, i), x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
            rnd(0.45, 0.70), rnd(0.05, 0.09) * c, 0, 0, 9 * c, 1.5, 0);
        }
        break;
      }
      case 'explosion': {                                    // cannon shot, checkmate: 48 + 8 smoke + 1 ring
        spawn(RING, SPARK, x, y, 0, 0, 0.3, 1.6 * c, 0, 0, 0, 0, 0);
        if (tier < 2) {                                      // smoke and soft sprites are dropped at q = .35
          for (let i = count(8); i > 0; i--) {               // smoke grows .25 -> .5 c while it rises
            const ttl = rnd(0.7, 0.9);
            spawn(DOT, SMOKE, x + rnd(-0.3, 0.3) * c, y + rnd(-0.2, 0.2) * c, rnd(-0.3, 0.3) * c, -rnd(0.4, 1.0) * c,
              ttl, 0.25 * c, 0, 0.25 * c / ttl, 0, 0, 0);
          }
          for (let i = count(8); i > 0; i--) {
            const angle = rnd(0, TAU), speed = rnd(0.5, 1.5) * c;
            spawn(SOFT, i % 2 ? EMBER : SPARK, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.25, rnd(0.3, 0.5) * c, 0, 0, 0, 0, 0);
          }
        }
        shards(x, y, count(16), undefined, sideSlots(o));
        for (let i = count(24); i > 0; i--) {                // embers
          const angle = rnd(0, TAU), speed = rnd(3, 9) * c;
          spawn(DOT, i % 3 ? EMBER : SPARK, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
            rnd(0.35, 0.60), rnd(0.06, 0.12) * c, 0, 0, 6 * c, 0, 0);
        }
        break;
      }
      case 'sparks':
        sparks(x, y, count(clamp(6, o?.n ?? 10, 16)), dir, tint);
        break;
      case 'splash': {                                       // a pawn crossing the river: an upward fan of ±50°
        const n = count(o?.n ?? 18);
        for (let i = 0; i < n; i++) {
          const angle = (-90 + rnd(-50, 50)) * DEG, speed = rnd(3, 6) * c;
          spawn(DOT, tint ?? (i % 3 ? COOL : WHITE), x + rnd(-0.2, 0.2) * c, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
            rnd(0.40, 0.60), rnd(0.04, 0.08) * c, 0, 0, 14 * c, 0, 0);
        }
        break;
      }
      case 'stars': {                                        // praise: radial 1.5–3.5 with an upward bias of 1.5
        const n = count(o?.n ?? 14);
        for (let i = 0; i < n; i++) {
          const angle = TAU * (i + Math.random()) / n, speed = rnd(1.5, 3.5) * c;
          spawn(STAR, tint ?? (i % 3 ? SPARK : WHITE), x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - 1.5 * c,
            rnd(0.60, 0.90), rnd(0.12, 0.22) * c, rnd(0, TAU), rnd(-6, 6), 2 * c, 0, 0);
        }
        break;
      }
      case 'trail': {                                        // a segment of `size` c that ends at the point, along dir
        const len = (o?.size ?? 1) * c, angle = dir ?? 0;
        trailDots(x - Math.cos(angle) * len, y - Math.sin(angle) * len, x, y);
        break;
      }
    }
    kick();
  }

  /** @param {Pt} from @param {Pt} to */
  function trail(from, to) {
    if (!canSpawn()) return;
    trailDots(from.x, from.y, to.x, to.y);
    kick();
  }

  /** A gold 100° arc of radius .7 c sweeping in 160 ms, and 8 sparks thrown off its end. @param {Pt} at */
  function slash(at) {
    if (!canSpawn()) return;
    const start = rnd(-175, -155) * DEG;
    spawn(ARC, SPARK, at.x, at.y, 0, 0, 0.16, 0.7 * c, start, 1, 0, 0, 0);
    const end = start + 100 * DEG;
    sparks(at.x + Math.cos(end) * 0.7 * c, at.y + Math.sin(end) * 0.7 * c, count(8), end + 90 * DEG, undefined, 0, 0, 0.09);   // when the blade gets there
    kick();
  }

  /** @param {Pt} from @param {Pt} to @param {{arc:number, ms:number}} o @returns {Promise<void>} */
  function projectile(from, to, o) {
    if (reduced) { stillRing(to, 1, '--fx-ember'); return Promise.resolve(); }      // target ring only
    if (!canSpawn()) return Promise.resolve();
    endShot();
    const ms = o?.ms > 0 ? o.ms : 170, arc = Number.isFinite(o?.arc) ? o.arc : 0;      // 170 ms is the catalogue's flight time
    return new Promise(done => {
      shot = {
        x0: from.x, y0: from.y, x1: to.x, y1: to.y, arc, ms, start: performance.now(), held: 0, dropped: 0, drops: count(10), done,
        timer: setTimeout(endShot, ms + 400),                // a frame that never comes (hidden tab) must not hold the promise
      };
      kick();
    });
  }

  function endShot() {
    const p = shot;
    if (!p) return;
    shot = null;
    clearTimeout(p.timer);
    p.done();
  }

  /** @param {{n?:number}} [o] */
  function confetti(o) {
    if (!canSpawn()) return;
    const n = count(o?.n ?? 140);
    for (let i = 0; i < n; i++) {                            // along the top edge over 600 ms
      spawn(RECT, cycle(FESTIVE, i), rnd(0, W), -0.3 * c, rnd(-1.5, 1.5) * c, rnd(2, 5) * c,
        rnd(1.8, 2.4), rnd(0.10, 0.18) * c, rnd(0, TAU), rnd(-5, 5), 3 * c, 0.8, rnd(0, 0.6));
    }
    kick();
  }

  /** Fan-sweep: 14 streaks from the left edge over a skewed band of light that crosses the board in 600 ms. */
  function wind() {
    if (!canSpawn()) return;
    const n = count(14);
    for (let i = 0; i < n; i++) {
      const angle = rnd(-8, 8) * DEG, speed = rnd(9, 14) * c;
      spawn(STREAK, i % 2 ? WIND_B : WIND, -0.3 * c, H * (i + Math.random()) / n, Math.cos(angle) * speed, Math.sin(angle) * speed,
        rnd(0.35, 0.50), rnd(0.5, 0.9) * c, angle, 0, 0, 1, rnd(0, 0.2));
    }
    kick();
    const band = windEl?.firstElementChild;
    if (band) {
      windAnim?.cancel();
      windAnim = band.animate([{ transform: 'translateX(-150%) skewX(-18deg)' }, { transform: 'translateX(490%) skewX(-18deg)' }],
        { duration: 600, easing: E_INOUT });
    }
  }

  // ---- shake, hit-stop, flash, haptics (§10.4.3) ---------------------------------------------------------------------

  /** @param {1|2|3} level */
  function shake(level) {
    const row = SHAKE[level];
    if (reduced || !host || !row) return;
    const amplitude = level === 3 && c > 0 ? Math.min(row[0], 0.18 * c) : row[0];
    /** @type {Keyframe[]} */
    const frames = [];
    for (let i = 0; i < SHAKE_STEPS; i++) {                  // decays linearly to 0, a new direction each step
      const a = amplitude * (1 - i / (SHAKE_STEPS - 1)), angle = rnd(0, TAU);
      frames.push({ translate: `${px(Math.cos(angle) * a)} ${px(Math.sin(angle) * a)}` });
    }
    shakeAnim?.cancel();                                     // a new shake replaces the running one
    shakeAnim = host.animate(frames, { duration: row[1], easing: 'linear' });
  }

  /** @param {number} ms */
  function hitStop(ms) {
    if (reduced || !host || !(ms > 0)) return;
    const now = performance.now();
    freezeUntil = Math.max(freezeUntil, now + ms);
    for (const a of host.getAnimations({ subtree: true })) {
      if (a.playState === 'running') { a.pause(); frozen.add(a); }
    }
    if (freezeTimer !== null) clearTimeout(freezeTimer);
    freezeTimer = setTimeout(thaw, freezeUntil - now);
  }

  function thaw() {
    if (freezeTimer !== null) { clearTimeout(freezeTimer); freezeTimer = null; }
    freezeUntil = 0;
    for (const a of frozen) if (a.playState === 'paused') a.play();
    frozen.clear();
  }

  /** @param {string} color @param {number} ms */
  function flash(color, ms) {
    if (reduced || !flashEl || !(ms > 0)) return;
    const s = flashEl.style;
    s.transition = 'none';
    s.backgroundColor = cssColor(color);
    s.opacity = '.35';
    void getComputedStyle(flashEl).opacity;                  // commit the start value before the transition is armed
    s.transition = `opacity ${ms}ms linear`;
    s.opacity = '0';
  }

  /** @param {'tap'|'place'|'capture'|'blast'|'check'|'win'|'illegal'} kind */
  function haptic(kind) {
    const pattern = HAPTIC[kind];
    if (!haptics || reduced || pattern === undefined) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try { navigator.vibrate(pattern); } catch { /* a blocked vibration is not an error */ }
  }

  // ---- DOM effects ---------------------------------------------------------------------------------------------------

  /**
   * Fade an element out and remove it; the pose it is in is kept while it fades.
   * @param {HTMLElement} el @param {number} ms
   */
  function fadeAway(el, ms) {
    for (const a of el.getAnimations({ subtree: true })) { a.onfinish = null; a.pause(); }
    leaving.add(el);
    const fade = el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' });
    fade.onfinish = () => { leaving.delete(el); el.remove(); };
  }

  /**
   * Stop an element's animations and take it out at once.
   * @param {HTMLElement} el
   */
  function discard(el) {
    for (const a of el.getAnimations({ subtree: true })) { a.onfinish = null; a.cancel(); }
    el.remove();
  }

  /**
   * Reduced-motion stand-in for a ring: a static circle that fades in 200 ms.
   * @param {Pt} at @param {number} size radius in c @param {string} color
   */
  function stillRing(at, size, color) {
    if (!layer || !sized()) return;
    const el = make('fx-ring');
    el.style.left = px(at.x); el.style.top = px(at.y);
    el.style.width = el.style.height = px(2 * size * c);
    el.style.borderColor = cssColor(color);
    layer.append(el);
    fadeAway(el, 200);
  }

  /**
   * @param {BannerKind} kind @param {{tone?:'mine'|'danger'|'calm', avoid?:Pt}} [o] @returns {Promise<void>}
   */
  function banner(kind, o) {
    const spec = BANNERS[kind];
    const parent = layer;
    if (!spec || !parent || !sized()) return Promise.resolve();
    if (bannerNow) {                                         // one at a time: the old one leaves in 80 ms
      const old = bannerNow;
      bannerNow = null;
      fadeAway(old.el, BANNER_REPLACE_FADE);
      old.done();
    }
    const tone = o?.tone ?? spec.tone;
    const text = TXT.banner[kind];
    const el = make('fx-banner');
    el.dataset.kind = kind;
    el.dataset.tone = tone;
    let fs = spec.size * clamp(BANNER_C_MIN, c, BANNER_C_MAX);
    el.style.setProperty('--fs', px(fs));
    const band = brushBand('fx-banner__band');
    const label = make('fx-banner__text', text);
    el.append(band, label);
    parent.append(el);
    const textW = label.offsetWidth;
    if (textW > FIT * W) {                                   // six characters on a phone: set smaller, never clipped
      fs *= FIT * W / textW;
      el.style.setProperty('--fs', px(fs));
    }
    const half = 0.8 * fs;                                   // the band is 1.6 x the font size high
    let y = H / 2;                                           // the board's centre line (also the river)
    const avoid = o?.avoid;
    if (avoid && Math.abs(avoid.y - y) <= half + BANNER_AVOID * c) y = avoid.y < H / 2 ? H * 0.75 : H * 0.25;
    el.style.top = px(y - half);

    return new Promise(done => {
      const entry = { el, done };
      bannerNow = entry;
      const total = spec.in + spec.hold + spec.out;
      const tIn = spec.in / total, tOut = (spec.in + spec.hold) / total;
      /** @type {Animation} */ let life;
      if (reduced) {
        const all = 2 * BANNER_STILL_FADE + spec.still;
        life = el.animate([{ opacity: 0 }, { opacity: 1, offset: BANNER_STILL_FADE / all }, { opacity: 1, offset: 1 - BANNER_STILL_FADE / all },
          { opacity: 0 }], { duration: all, easing: 'linear' });
      } else if (spec.enter === 'rise' || spec.enter === 'slide') {
        const from = spec.enter === 'rise' ? `translateY(${px(0.2 * c)})` : `translateX(${px(-0.5 * c)})`;
        life = el.animate([{ opacity: 0, transform: from, easing: E_OUT }, { opacity: 1, transform: 'translate(0, 0)', offset: tIn },
          { opacity: 1, transform: 'translate(0, 0)', offset: tOut }, { opacity: 0, transform: 'translate(0, 0)' }], { duration: total });
      } else {
        const slam = spec.enter === 'slam';
        life = el.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(0)', offset: tOut, easing: E_LEAVE },
          { opacity: 0, transform: `translateY(${px(-0.3 * c)})` }], { duration: total });
        band.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
          { duration: slam ? BANNER_SLAM_WIPE : spec.in, easing: E_OUT });
        const landing = label.animate([{ transform: `scale(${slam ? 2.4 : 1.6})`, opacity: 0 }, { opacity: 1, offset: 0.35 },
          { transform: 'scale(1)', opacity: 1 }], { duration: spec.in, easing: slam ? E_IN : E_BACK });
        if (slam) {
          landing.onfinish = () => {
            if (bannerNow !== entry) return;
            shake(2);
            if (canSpawn()) {                                // 16 sparks fly off the band where the text hit it
              sparks(W / 2, y, count(16), undefined, undefined, Math.min(W * 0.46, text.length * fs * 0.55), half * 0.9);
              kick();
            }
          };
        }
      }
      life.onfinish = () => {
        if (bannerNow === entry) bannerNow = null;
        discard(el);
        done();
      };
    });
  }

  /**
   * Seat the popup above its square: bottom edge .5 c over the centre, clamped inside the board with room to rise.
   * @param {{ el:HTMLElement, at:Pt, mark:HTMLElement|null }} entry
   */
  function seatPopup(entry) {
    const { el, at, mark } = entry;
    const w = el.offsetWidth, h = el.offsetHeight;
    const below = mark ? mark.offsetHeight : 0;              // the 自己想的 line hangs under the label
    const rise = reduced ? 0 : POPUP_RISE * c;
    const bottom = clamp(Math.min(h + rise + 2, H - below - 2), at.y - 0.5 * c - below, H - below - 2);
    el.style.left = px(clamp(2, at.x - w / 2, Math.max(2, W - w - 2)));
    el.style.top = px(bottom - h);
  }

  function dropPopup() {
    if (!popupNow) return;
    discard(popupNow.el);
    popupNow = null;
  }

  function dropMark() {
    if (!markNow) return;
    discard(markNow.el);
    markNow = null;
  }

  /**
   * @param {string} text @param {Pt} at @param {{tone?:'good'|'great'|'brilliant'|'lord'|'mark'}} [o]
   */
  function popup(text, at, o) {
    const parent = layer;
    if (!parent || !sized()) return;
    const tone = o?.tone ?? 'good';

    if (tone === 'mark') {                                   // under the praise popup, or alone above the piece for 700 ms
      if (popupNow) {
        popupNow.mark?.remove();
        popupNow.mark = make('fx-popup__mark', text);
        popupNow.el.append(popupNow.mark);
        seatPopup(popupNow);
        return;
      }
      dropMark();
      const el = make('fx-popup', text);
      el.dataset.tone = 'mark';
      parent.append(el);
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = px(clamp(2, at.x - w / 2, Math.max(2, W - w - 2)));
      el.style.top = px(clamp(2, at.y - 0.5 * c - h, Math.max(2, H - h - 2)));
      const entry = { el, text };
      markNow = entry;
      const life = el.animate([{ opacity: 0 }, { opacity: 1, offset: 80 / MARK_MS }, { opacity: 1, offset: 1 - MARK_FADE / MARK_MS }, { opacity: 0 }],
        { duration: MARK_MS, easing: 'linear' });
      life.onfinish = () => { if (markNow === entry) markNow = null; discard(el); };
      return;
    }

    dropPopup();                                             // one at a time
    const el = make('fx-popup');
    el.dataset.tone = tone;
    el.style.setProperty('--fs', px(Math.max(20, 0.62 * c)));
    if (tone === 'lord') el.append(brushBand('fx-popup__band'));
    const label = make('fx-popup__text', text);
    el.append(label);
    /** @type {{ el:HTMLElement, at:Pt, mark:HTMLElement|null }} */
    const entry = { el, at: { x: at.x, y: at.y }, mark: null };
    if (markNow) {                                           // a mark that came first moves under the popup
      entry.mark = make('fx-popup__mark', markNow.text);
      el.append(entry.mark);
      dropMark();
    }
    parent.append(el);
    seatPopup(entry);
    popupNow = entry;

    /** @type {Animation} */ let life;
    if (reduced) {                                           // in place: hold 900 ms, fade 200 ms, no stars
      const all = POPUP_STILL_HOLD + POPUP_STILL_FADE;
      life = el.animate([{ opacity: 1 }, { opacity: 1, offset: POPUP_STILL_HOLD / all }, { opacity: 0 }], { duration: all, easing: 'linear' });
    } else {
      life = el.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${px(-POPUP_RISE * c)})` }], { duration: POPUP_MS, easing: E_OUT });
      el.animate([{ opacity: 1 }, { opacity: 0 }], { delay: POPUP_MS - POPUP_FADE, duration: POPUP_FADE, easing: 'linear', fill: 'both' });
      label.animate([{ transform: 'scale(.6)', easing: E_BACK }, { transform: 'scale(1.1)', offset: 0.6, easing: 'ease-in-out' }, { transform: 'scale(1)' }],
        { duration: POPUP_SCALE_MS });
      const stars = POPUP_STARS[tone];
      if (stars > 0) burst('stars', at, { n: stars });
    }
    life.onfinish = () => {
      if (popupNow === entry) popupNow = null;
      discard(el);
    };
  }

  /**
   * @param {string} text @param {{size:'full'|'small', at?:Pt}} o @returns {Promise<void>}
   */
  function stamp(text, o) {
    const parent = layer;
    const spec = o ? STAMPS[o.size] : undefined;
    if (!spec || !parent || !sized()) return Promise.resolve();
    if (stampNow) {
      const old = stampNow;
      stampNow = null;
      discard(old.el);
      old.done();
    }
    const full = o.size === 'full';
    const el = make('fx-stamp');
    el.dataset.size = o.size;
    const seal = make('fx-stamp__seal', text);
    el.append(seal);
    let fs = spec.font * c;
    el.style.setProperty('--fs', px(fs));
    parent.append(el);
    let w = el.offsetWidth;
    if (w > FIT * W) {                                       // a long name is set smaller, never clipped
      fs *= FIT * W / w;
      el.style.setProperty('--fs', px(fs));
      w = el.offsetWidth;
    }
    const h = el.offsetHeight;
    const at = o.at;
    const cx = full || !at ? W / 2 : clamp(w / 2 + 2, at.x, Math.max(w / 2 + 2, W - w / 2 - 2));
    const cy = full || !at ? H * 0.34 : clamp(h / 2 + 2, at.y - 0.9 * c, Math.max(h / 2 + 2, H - h / 2 - 2));
    el.style.left = px(cx - w / 2);
    el.style.top = px(cy - h / 2);

    return new Promise(done => {
      const entry = { el, done };
      stampNow = entry;
      /** @type {Animation} */ let life;
      if (reduced) {                                         // fade in / out, no shake, no sparks
        const all = 2 * STAMP_STILL_FADE + spec.hold;
        life = el.animate([{ opacity: 0 }, { opacity: 1, offset: STAMP_STILL_FADE / all }, { opacity: 1, offset: 1 - STAMP_STILL_FADE / all },
          { opacity: 0 }], { duration: all, easing: 'linear' });
      } else {
        const total = spec.in + spec.hold + spec.out;
        life = el.animate([{ opacity: 0 }, { opacity: 1, offset: spec.in / total }, { opacity: 1, offset: 1 - spec.out / total }, { opacity: 0 }],
          { duration: total, easing: 'linear' });
        const landing = seal.animate([{ transform: 'scale(1.9)' }, { transform: 'scale(1)' }], { duration: spec.in, easing: E_IN });
        if (full) {
          landing.onfinish = () => {
            if (stampNow !== entry) return;
            shake(1);
            if (canSpawn()) { sparks(cx, cy, count(10), undefined, undefined, w * 0.5, h * 0.5); kick(); }
          };
        }
      }
      life.onfinish = () => {
        if (stampNow === entry) stampNow = null;
        discard(el);
        done();
      };
    });
  }

  // ---- lifecycle -----------------------------------------------------------------------------------------------------

  /** @param {HTMLElement} el */
  function mount(el) {
    if (root) {                                              // mounted again: start clean in the new element
      clear();
      canvas?.remove(); layer?.remove(); flashEl?.remove(); windEl?.remove();
    }
    root = el;
    host = el.closest('.bv') ?? el.parentElement ?? el;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.dataset.q = String(q);
    ctx = canvas.getContext('2d');
    const dot = document.createElement('canvas');
    dot.width = dot.height = 1;
    scratch = dot.getContext('2d');
    windEl = make('fx-wind');
    windEl.append(document.createElement('i'));
    flashEl = make('fx-flash');
    layer = make('fx-banners');
    // Decoration only: what a banner says also goes to #board-announcement (§10.6), so it is not read twice.
    for (const node of [canvas, windEl, flashEl, layer]) node.setAttribute('aria-hidden', 'true');
    el.append(canvas, windEl, flashEl, layer);
    refreshPalette();
    if (c > 0) resize(W, H, c); else sized();
  }

  /** @param {boolean} on */
  function setReducedMotion(on) {
    reduced = on === true;
    if (!reduced) return;
    killParticles();                                         // no particles, no shake, no freeze under reduced motion
    endShot();
    shakeAnim?.cancel(); shakeAnim = null;
    windAnim?.cancel(); windAnim = null;
    thaw();
  }

  /** Kills particles, projectile, banner, popup, stamp, shake; resolves pending promises. */
  function clear() {
    killParticles();
    endShot();
    if (bannerNow) { const b = bannerNow; bannerNow = null; discard(b.el); b.done(); }
    if (stampNow) { const s = stampNow; stampNow = null; discard(s.el); s.done(); }
    dropPopup();
    dropMark();
    for (const el of leaving) discard(el);
    leaving.clear();
    shakeAnim?.cancel(); shakeAnim = null;
    windAnim?.cancel(); windAnim = null;
    thaw();
    if (flashEl) { flashEl.style.transition = 'none'; flashEl.style.opacity = '0'; }
  }

  return {
    mount,
    burst,
    trail,
    slash,
    projectile,
    confetti,
    wind,
    shake,
    hitStop,
    flash,
    banner,
    popup,
    stamp,
    haptic,
    resize,
    refreshPalette,
    setReducedMotion,
    setHaptics: on => { haptics = on === true; },
    clear,
    /** Live particle count: the pool plus the projectile's ember. */
    get live() { return live + (shot ? 1 : 0); },
  };
}
