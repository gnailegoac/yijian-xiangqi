// The strategist 诸葛亮 and his speech bubble (SPEC §4.28.4; construction, moods, motion: §11). Package X5.
//
// createBuddy(host, opts) fills `host` (#buddy) with
//   <button class="buddy-fig">
//     <span class="buddy" data-mood data-eyes data-mouth data-extras>          the drawing: ONE element
//       <span class="b-stage"> <svg class="b-layer b-layer--main"/> <svg class="b-layer b-layer--arm"/> </span>
//     </span>
//   </button>
//   <div class="bubble" data-state data-source> question · tag · caption · text </div>
// and returns the Buddy controller. Everything visual is in styles/buddy.css; this file owns the drawing (the
// sand-table half figure: big head, hat, green-trimmed robe, feather fan), the mood table, the timers and one-shot
// animations of §11.4 and the bubble of §11.6.
//
// Events on the host (bubbling CustomEvents): buddy:tap {}, bubble:expand {id}. Move-link events (chat:movelink)
// bubble through the bubble untouched: a tap on a button inside the bubble never becomes bubble:expand.
//
// How the bubble is meant to be driven (the `Bubble` typedef has no method for the end of a line):
//   - begin() returns a fresh text container each time, a direct child of .bubble. The caller (chat-panel) writes
//     data-state="done" and data-source on `container.parentElement` when the line ends; the bubble watches that
//     attribute and drops its typing dots as soon as the state leaves "streaming". The dots show by themselves
//     300 ms after begin() while nothing has arrived, and never for more than 3.5 s of one wait. setTyping(true)
//     while no dots are showing or due starts a new wait (a resumed leg after a tool round, a reset line);
//     setTyping(false) ends the wait.
//   - A question (setQuestion) or a caption (captionEl) that was set since the previous begin() belongs to the
//     next line and survives that begin(); an older one is removed by it. Setting them right after begin(), in
//     the same synchronous turn, works as well. setQuestion shows a copy: the caller's element stays where it is.
//   - captionEl() starts a new caption: the first request of a turn empties the container, and, unless a line was
//     begun in that same turn, drops the previous line and its question (state "done", source "local").
//   - status() and a caption set data-source="local"; begin() removes data-source until the caller writes it.
//
// Drawing space: he leans and gestures toward -x, his fan side (side glance, pointing fan, peek): that is where the
// table lies. A host that sets --buddy-face: 1 gets him mirrored, fan arm on the right (styles/buddy.css).
//
// Reduced motion (opts.reducedMotion / setReducedMotion, on top of html[data-motion]): no tween, no loop, no timer.
// A gesture is then a brief swap with nothing moving: nod and hop close the eyes in a smile, shake shows the wavy
// mouth, peek the side glance, point the pointing pose. A mood that arrives in a later turn ends such a swap, so
// the face of the new mood is never mixed with the stand-in of an older gesture.

import { CUE } from '../core/codes.js';

/** @import { Buddy, Bubble } from './types.js' */
/** @import { Mood } from '../core/codes.js' */

/** @typedef {'open'|'wide'|'happy'|'soft'|'star'|'side'|'up'} EyeVariant */
/** @typedef {'smirk'|'smile'|'grin'|'cheer'|'o'|'bigo'|'wavy'|'hmm'|'soft'} MouthVariant */
/** @typedef {'sweat'|'bang'|'dots'|'q'|'spark'|'blush'} ExtraVariant */
/** @typedef {'nod'|'hop'|'shake'|'peek'|'point'} Gesture */
/**
 * One row of the mood table. Angles in degrees (positive = clockwise as drawn), offsets in viewBox units.
 * @typedef {Object} MoodSpec
 * @property {EyeVariant} eyes
 * @property {MouthVariant} mouth
 * @property {number} arm      the fan arm about the shoulder: 16 = pointing at the table beside him, 58 = raised, negative = lowered
 * @property {number} fanRot   the fan about the hand, in the arm's frame: 0 = continuing the arm
 * @property {number} tilt
 * @property {number} browL
 * @property {number} browR
 * @property {number} browLY
 * @property {number} browRY
 * @property {number} headY
 * @property {readonly ExtraVariant[]} extras
 */

// ---------------------------------------------------------------------------------------------------------------------
// the mood table: ten moods on the six faces of the sand-table figure (calm, talk, happy, wow, worry, cheer)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {EyeVariant} eyes @param {MouthVariant} mouth
 * @param {number} arm @param {number} fanRot @param {number} tilt
 * @param {number} browL @param {number} browR @param {number} browLY @param {number} browRY @param {number} headY
 * @param {ExtraVariant[]} extras
 * @returns {MoodSpec}
 */
function row(eyes, mouth, arm, fanRot, tilt, browL, browR, browLY, browRY, headY, extras) {
  return Object.freeze({ eyes, mouth, arm, fanRot, tilt, browL, browR, browLY, browRY, headY, extras: Object.freeze(extras) });
}

// idle = the mock's "calm", pleased = "happy", impressed = "wow", alarmed = "worry", cheering = "cheer"; the mock's
// "talk" is the speaking mouth (setSpeaking). Drawn for this table: listening (head tilted, one brow lower than the
// other), thinking (eyes up, the fan held up in front of him), curious (wide eyes, a small "o"), worried (side
// glance, wavy mouth, a drop of sweat), consoling (closed soft eyes, soft smile, lowered brows).
/** @type {Readonly<Record<Mood, MoodSpec>>} */
const MOOD = Object.freeze({
  //               eyes     mouth    arm fanRot tilt browL browR browLY browRY headY extras
  idle:      row('open',  'smirk',  16,    0,   0,    0,    0,    0,    0,    0, []),
  listening: row('open',  'soft',   10,    0,   8,    6,  -10,    6,   -1,    0, []),
  thinking:  row('up',    'hmm',   -58,  160,  -4,    8,   -6,    3,    0,    0, ['dots']),
  curious:   row('wide',  'o',      26,    0,  -7,    0,    0,   -2,   -2,    0, ['q']),
  pleased:   row('happy', 'grin',   16,    0,   0,    0,    0,    0,    0,    0, ['blush']),
  impressed: row('star',  'cheer',  36,    0,   0,    0,    0,   -1,   -1,   -3, ['spark', 'blush']),
  worried:   row('side',  'wavy',    6,    0,   3,  -14,   14,    4,    4,    2, ['sweat']),
  alarmed:   row('wide',  'bigo',   46,    0,   0,   -8,    8,   -1,   -1,   -4, ['sweat', 'bang']),
  cheering:  row('happy', 'cheer',  58,    0,   0,    0,    0,    0,    0,   -3, ['spark', 'blush']),
  consoling: row('soft',  'soft',   10,    0,   6,  -12,   12,    5,    5,    2, []),
});

// ---------------------------------------------------------------------------------------------------------------------
// construction: the sand-table half figure (big head, hat with the gold band, green-trimmed robe, feather fan).
// Two root <svg> layers with the same viewBox lie on top of each other: the body and head, and the fan arm. A root
// <svg> can breathe or sway on the compositor; nothing inside an <svg> ever loops.
// ---------------------------------------------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
// The figure's box is 120 : 140 (styles/buddy.css). Full: the body fills the box and the fan reaches out of it on
// his fan side (overflow is visible). Bust: head and shoulders in a square.
const VIEW_FULL = '-26 0 346 404';
const VIEW_BUST = '76 6 240 240';

const INK = '#2a1f3d', SKIN = '#ffe2c4', SKIN_EDGE = '#e7b08a', HAIR = '#262238';
const ROBE = '#fffdf4', ROBE_LO = '#e3dfcf', CLOAK = '#d6ecf6', CLOAK_LO = '#a9cfe2', TEAL = '#1fa6a0', TEAL_LO = '#13777c';
const CLOTH = '#2f7fd0', CLOTH_HI = '#6cb2f5', CLOTH_LO = '#2260a8', GOLD = '#ffc93c', JADE = '#7fe0b8', JADE_EDGE = '#1d7a5c';
const FEATHER = '#ffffff', QUILL = '#b4c6de', DOWN = '#dfeaf6', HANDLE = '#9a7440', IRIS = '#5a78c8';

/** @param {number} x */
const n1 = (x) => String(Math.round(x * 10) / 10);

/** A filled shape with the ink outline. @param {string} d @param {string} fill @param {number} [sw] */
const shape = (d, fill, sw = 4) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
/** An open line. @param {string} d @param {string} stroke @param {number} sw @param {string} [cls] */
const line = (d, stroke, sw, cls) => `<path${cls ? ` class="${cls}"` : ''} d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The feather fan: seven feathers around the pivot (px, py), drawn from the outside in. @param {number} px @param {number} py */
function fan(px, py) {
  const axes = [130, 144, 158, 172, 186, 200, 214];
  /** @param {number} a @param {number} r @returns {[number, number]} */
  const pt = (a, r) => { const t = (a * Math.PI) / 180; return [px + r * Math.cos(t), py + r * Math.sin(t)]; };
  /** @param {number} a @param {number} len @param {number} w */
  const feather = (a, len, w) => {
    const t = (a * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const b = pt(a, 12), tip = pt(a, len), m = pt(a, 12 + (len - 12) * 0.58), q = pt(a, len - 8);
    return {
      d: `M${n1(b[0])} ${n1(b[1])} Q${n1(m[0] - s * w)} ${n1(m[1] + c * w)} ${n1(tip[0])} ${n1(tip[1])} Q${n1(m[0] + s * w)} ${n1(m[1] - c * w)} ${n1(b[0])} ${n1(b[1])} Z`,
      q: `M${n1(b[0])} ${n1(b[1])} L${n1(q[0])} ${n1(q[1])}`,
    };
  };
  const order = axes.map((a, i) => ({ a, k: Math.abs(i - 3) })).sort((p, q) => q.k - p.k);
  const a0 = pt(axes[0], 70), a1 = pt(axes[6], 70);
  let out = shape(`M${px} ${py} L${n1(a0[0])} ${n1(a0[1])} A70 70 0 0 1 ${n1(a1[0])} ${n1(a1[1])} Z`, DOWN);
  for (const f of order) {
    const ft = feather(f.a, 102 - f.k * 6, 14.5);
    out += shape(ft.d, FEATHER, 3.4) + line(ft.q, QUILL, 2.2);
  }
  return out;
}

/** One open eye; the iris looks (dx, dy) away from straight ahead. @param {number} cx @param {number} dx @param {number} dy */
const eye = (cx, dx, dy) => `<ellipse cx="${cx}" cy="160" rx="13" ry="17.5" fill="${INK}"/>`
  + `<ellipse cx="${cx + dx}" cy="${167 + dy}" rx="8.5" ry="8" fill="${IRIS}"/>`
  + `<circle cx="${cx - 5 + dx}" cy="${152 + dy / 2}" r="5.4" fill="#fff"/><circle cx="${cx + 4.5 + dx}" cy="${169 + dy}" r="2.6" fill="#fff"/>`
  + line(`M${cx - 16} 148 Q${cx - 2} 136 ${cx + 15} 147`, INK, 4.4);
/** @param {number} cx */
const star = (cx) => shape(`M${cx} 140 L${cx + 5.5} 154.5 L${cx + 20} 160 L${cx + 5.5} 165.5 L${cx} 180 L${cx - 5.5} 165.5 L${cx - 20} 160 L${cx - 5.5} 154.5 Z`, GOLD, 3);
/** @param {number} cx */
const wide = (cx) => `<circle cx="${cx}" cy="160" r="16" fill="#fff" stroke="${INK}" stroke-width="3.6"/><circle cx="${cx - 3}" cy="162" r="6.5" fill="${INK}"/>`;

/** Left eye centre x = 164, right x = 226. He looks toward his fan side (-x), where the table is. @type {Readonly<Record<EyeVariant, string>>} */
const EYES = Object.freeze({
  open: eye(164, 0, 0) + eye(226, 0, 0),
  side: eye(164, -3.5, -1) + eye(226, -3.5, -1),
  up: eye(164, 1.5, -8) + eye(226, 1.5, -8),
  wide: wide(164) + wide(226),
  happy: line('M149 166 Q164 144 180 166 M211 166 Q226 144 242 166', INK, 6.4),
  soft: line('M150 158 Q164 171 179 158 M212 158 Q226 171 241 158', INK, 5.6),
  star: star(164) + star(226),
});

/** @type {Readonly<Record<MouthVariant, string>>} */
const MOUTHS = Object.freeze({
  smirk: line('M181 199 Q195 212 211 198', INK, 4.2),
  smile: line('M180 198 Q196 214 212 198', INK, 4.2),
  grin: shape('M179 196 Q196 224 213 196 Z', '#b5433a', 3.6) + '<path d="M188 209 Q196 203 204 209 Q196 217 188 209 Z" fill="#ff8f86"/>',
  cheer: shape('M174 194 Q196 232 218 194 Z', '#b5433a', 3.6) + '<path d="M185 211 Q196 203 207 211 Q196 222 185 211 Z" fill="#ff8f86"/>',
  o: `<ellipse cx="196" cy="203" rx="6" ry="7.5" fill="#7a2e2a" stroke="${INK}" stroke-width="3.2"/>`,
  bigo: `<ellipse cx="196" cy="205" rx="9.5" ry="12" fill="#7a2e2a" stroke="${INK}" stroke-width="3.4"/>`,
  wavy: line('M179 204 Q187.5 196 196 204 T213 204', INK, 4.2),
  hmm: line('M184 203 Q191 207 198 203 T211 200', INK, 4.2),
  soft: line('M184 199 Q196 209 208 199', INK, 4.2),
});

const DOT = `fill="#fff" stroke="${INK}" stroke-width="2.4"`;

/** @type {Readonly<Record<ExtraVariant, string>>} */
const EXTRAS = Object.freeze({
  blush: '<ellipse cx="146" cy="191" rx="14" ry="8.5" fill="#ff7f6e" opacity=".7"/><ellipse cx="246" cy="191" rx="14" ry="8.5" fill="#ff7f6e" opacity=".7"/>',
  sweat: '<path d="M284 108 Q294 126 284 134 Q274 126 284 108 Z" fill="#8fd3ff" stroke="#2f86c0" stroke-width="2.6" stroke-linejoin="round"/>',
  spark: shape('M100 60 l5 13 l13 5 l-13 5 l-5 13 l-5 -13 l-13 -5 l13 -5 Z', GOLD, 2.6) + shape('M292 40 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z', GOLD, 2.6),
  bang: `<g transform="translate(296 44) rotate(14)"><rect x="-5.5" y="0" width="11" height="30" rx="5" fill="#ffb000" stroke="${INK}" stroke-width="3"/><circle cx="0" cy="42" r="6" fill="#ffb000" stroke="${INK}" stroke-width="3"/></g>`,
  dots: `<circle cx="280" cy="98" r="4.5" ${DOT}/><circle cx="291" cy="80" r="6.5" ${DOT}/><circle cx="304" cy="57" r="9.5" ${DOT}/>`,
  q: `<g class="b-glyph">${line('M287 44 Q287 28 300 28 Q313 28 313 42 Q313 51 304 56 Q300 59 300 67', INK, 12)}${line('M287 44 Q287 28 300 28 Q313 28 313 42 Q313 51 304 56 Q300 59 300 67', GOLD, 6.5)}`
    + `<circle cx="300" cy="83" r="5.4" fill="${GOLD}" stroke="${INK}" stroke-width="2.8"/></g>`,
});

/** @param {string} cls @param {Readonly<Record<string, string>>} table */
function variants(cls, table) {
  return `<g class="${cls}">${Object.keys(table).map((v) => `<g data-v="${v}">${table[v]}</g>`).join('')}</g>`;
}

/** The body and the head, back to front. The robe runs on below the viewBox, so a hop never shows its lower edge. */
const MAIN_MARKUP = `
<g class="b-lean">
  <g class="b-body">
    ${shape('M90 452 L90 408 Q76 300 122 244 Q160 220 196 220 Q232 220 270 244 Q316 300 302 408 L302 452 Z', CLOAK)}
    ${line('M106 330 q9 9 18 0 M104 366 q10 9 20 0 M270 330 q9 9 18 0 M270 366 q10 9 20 0', CLOAK_LO, 3)}
    ${shape('M124 452 L124 408 Q118 312 142 248 Q170 228 196 228 Q222 228 250 248 Q274 312 268 408 L268 452 Z', ROBE)}
    ${line('M168 372 Q172 396 170 440 M226 374 Q222 396 224 440', ROBE_LO, 3)}
    ${shape('M168 230 L200 296 L190 303 L155 241 Z', TEAL, 3.4)}${shape('M224 230 L186 306 L197 313 L237 241 Z', TEAL, 3.4)}
    ${shape('M129 332 Q196 348 263 332 L265 355 Q196 371 127 355 Z', TEAL_LO, 3.4)}
    <circle cx="196" cy="353" r="13.5" fill="${JADE}" stroke="${JADE_EDGE}" stroke-width="3.4"/><circle cx="192" cy="349" r="4.4" fill="#fff" opacity=".7"/>
    ${shape('M248 248 Q294 268 290 338 Q272 358 244 344 Q252 296 238 266 Z', ROBE)}${line('M247 344 Q270 356 289 337', TEAL, 7)}
  </g>
  <g class="b-head-act">
    <g class="b-head">
      ${shape('M256 98 Q300 102 310 168 Q294 150 280 150 Q288 124 256 114 Z', CLOTH_LO)}${shape('M262 106 Q324 124 320 202 Q304 178 290 174 Q300 140 262 122 Z', CLOTH)}
      <ellipse cx="196" cy="150" rx="80" ry="77" fill="${HAIR}" stroke="${INK}" stroke-width="4"/>
      <circle cx="121" cy="164" r="12.5" fill="${SKIN}" stroke="${INK}" stroke-width="3.4"/><circle cx="271" cy="164" r="12.5" fill="${SKIN}" stroke="${INK}" stroke-width="3.4"/>
      ${shape('M124 154 Q124 96 196 96 Q268 96 268 154 Q268 198 236 216 Q216 227 196 227 Q176 227 156 216 Q124 198 124 154 Z', SKIN, 3.6)}
      <ellipse cx="146" cy="191" rx="12.5" ry="7.5" fill="#ff9d8a" opacity=".6"/><ellipse cx="246" cy="191" rx="12.5" ry="7.5" fill="#ff9d8a" opacity=".6"/>
      ${variants('b-eyes', EYES)}
      ${line('M146 131 Q163 122 180 129', INK, 4.6, 'b-brow-l')}${line('M210 129 Q227 122 244 131', INK, 4.6, 'b-brow-r')}
      ${line('M194 182 q-3.4 4 0 6.4', SKIN_EDGE, 3)}
      ${variants('b-mouth', MOUTHS)}
      ${shape('M124 156 Q118 86 196 84 Q274 86 268 156 Q262 126 240 116 Q226 132 204 118 Q186 136 160 118 Q138 126 124 156 Z', HAIR, 3.6)}
      ${shape('M126 150 Q121 178 131 194 Q133 172 138 158 Z', HAIR, 3)}${shape('M266 150 Q271 178 261 194 Q259 172 254 158 Z', HAIR, 3)}
      ${shape('M127 114 Q121 62 138 42 Q164 22 196 22 Q228 22 254 42 Q271 62 265 114 Q232 94 196 94 Q160 94 127 114 Z', CLOTH)}
      ${line('M165 31 Q157 62 160 100 M196 24 V92 M227 31 Q235 62 232 100', CLOTH_LO, 3.4)}
      ${line('M140 58 Q146 44 158 37', CLOTH_HI, 5)}${line('M178 44 Q180 34 186 30', CLOTH_HI, 4)}
      ${shape('M124 110 Q196 76 268 110 L268 127 Q196 93 124 127 Z', GOLD, 3.6)}
      <ellipse cx="196" cy="101.5" rx="8" ry="6.5" fill="${JADE}" stroke="${JADE_EDGE}" stroke-width="2.6"/>
      ${variants('b-extras', EXTRAS)}
    </g>
  </g>
</g>`;

/** The fan arm: sleeve, fan, hand. It lies over the body and the head. */
const ARM_MARKUP = `
<g class="b-lean">
  <g class="b-arm">
    ${shape('M163 238 Q112 242 58 284 Q50 304 66 328 Q120 320 170 290 Z', ROBE)}${line('M120 270 Q104 284 96 302', ROBE_LO, 3)}${line('M58 285 Q50 305 66 327', TEAL, 8)}
    <g class="b-fan">${fan(44, 312)}${line('M70 298 L40 314', INK, 12)}${line('M70 298 L40 314', HANDLE, 6.5)}<circle cx="44" cy="312" r="11" fill="${JADE}" stroke="${JADE_EDGE}" stroke-width="3.4"/><circle cx="44" cy="312" r="4.4" fill="${GOLD}"/></g>
    <circle cx="60" cy="305" r="14.5" fill="${SKIN}" stroke="${INK}" stroke-width="3.6"/>${line('M53 300 q6 5 5 12 M62 298 q4 6 2 13', SKIN_EDGE, 2.4)}
  </g>
</g>`;

// ---------------------------------------------------------------------------------------------------------------------
// §11.4 timing
// ---------------------------------------------------------------------------------------------------------------------

const BLINK_MIN = 2600, BLINK_MAX = 6000, BLINK_MS = 110, BLINK_AGAIN_MS = 140, BLINK_AGAIN_CHANCE = 0.15;
const GLANCE_MIN = 8000, GLANCE_MAX = 14000, GLANCE_MS = 900;
const FLAP_MS = 120;
const POINT_MS = 800, POINT_ARM = 42, POINT_FAN = 0;
// As a bust the stretched arm is outside the frame, and the board is above him: there the fan goes up beside his head.
const POINT_ARM_BUST = 74, POINT_FAN_BUST = 24;
const TYPING_DELAY_MS = 300, TYPING_MAX_MS = 3500;       // the dots never outlive the longest first-text cap (§7.5)

/** Eyes that are already closed or decorative never blink. @type {readonly EyeVariant[]} */
const NO_BLINK = Object.freeze(['happy', 'soft', 'star']);
/** Mouths that are too big to flap. @type {readonly MouthVariant[]} */
const NO_FLAP = Object.freeze(['cheer', 'bigo']);

/** Tone of the interjection tag by cue (§11.6). @type {Readonly<Record<string, 'good'|'warn'>>} */
const CUE_TONE = Object.freeze({ wow: 'good', nice: 'good', lord: 'good', win: 'good', go: 'good', wait: 'warn', stop: 'warn', alert: 'warn' });

/** The label of a cue and its tone. `cue` is the interjection text (§7.5: CUE[code]); a bare code is accepted too.
 *  @param {string} cue @returns {{text:string, tone:'good'|'warn'|'neutral'}} */
function readCue(cue) {
  const table = /** @type {Readonly<Record<string, string>>} */ (CUE);
  const code = Object.hasOwn(table, cue) ? cue : Object.keys(table).find((k) => table[k] === cue);
  return { text: code && code === cue ? table[code] : cue, tone: (code && CUE_TONE[code]) || 'neutral' };
}

/** @param {number} lo @param {number} hi */
const between = (lo, hi) => lo + Math.random() * (hi - lo);

// ---------------------------------------------------------------------------------------------------------------------
// the factory
// ---------------------------------------------------------------------------------------------------------------------

/** @param {HTMLElement} host @param {{ variant:'bust'|'full', reducedMotion?:boolean }} opts @returns {Buddy} */
export function createBuddy(host, opts) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;

  /** @type {Mood} */ let mood = 'idle';
  /** @type {Mood} */ let baseMood = 'idle';
  /** @type {'bust'|'full'} */ let variant = opts.variant === 'bust' ? 'bust' : 'full';
  let reduced = !!opts.reducedMotion;
  let speaking = false;
  let flap = false;
  let destroyed = false;
  /** Rig values a gesture puts on top of the mood for a while. @type {{armR?:number, fanRot?:number}} */
  let pose = {};
  /** Face parts a reduced-motion gesture swaps in for a while. @type {{eyes?:EyeVariant, mouth?:MouthVariant}} */
  let face = {};
  let faceFresh = false;              // true during the synchronous turn of that gesture

  // ---- DOM ----

  const figure = doc.createElement('button');
  figure.type = 'button';
  figure.className = 'buddy-fig';

  // The drawing is one HTML element: data-mood and the rig's custom properties live on it. Inside it a stage (the
  // one-shot gestures of the whole figure act on it) holds the two root <svg> layers.
  const fig = doc.createElement('span');
  fig.className = 'buddy';
  fig.setAttribute('role', 'img');
  fig.setAttribute('aria-label', '军师诸葛亮');
  const stage = doc.createElement('span');
  stage.className = 'b-stage';
  /** @param {string} cls @param {string} markup */
  const layer = (cls, markup) => {
    const el = /** @type {SVGSVGElement} */ (doc.createElementNS(SVG_NS, 'svg'));
    el.setAttribute('class', `b-layer ${cls}`);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = markup;                                  // static template, numbers only
    stage.append(el);
    return el;
  };
  const layers = [layer('b-layer--main', MAIN_MARKUP), layer('b-layer--arm', ARM_MARKUP)];
  fig.append(stage);
  figure.append(fig);

  const headAct = /** @type {SVGGElement} */ (fig.querySelector('.b-head-act'));

  host.classList.add('buddy-box');
  host.append(figure);

  // ---- timers and one-shot animations ----

  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  /** @param {() => void} fn @param {number} ms */
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  /** @param {ReturnType<typeof setTimeout>|null} id */
  function drop(id) {
    if (id !== null) { clearTimeout(id); timers.delete(id); }
    return null;
  }

  /** @type {Set<Animation>} */
  const running = new Set();
  /** @param {Element} el @param {Keyframe[]} frames @param {KeyframeAnimationOptions} timing */
  function play(el, frames, timing) {
    if (reduced || destroyed || typeof el.animate !== 'function') return;
    const a = el.animate(frames, timing);
    running.add(a);
    const done = () => { running.delete(a); };
    a.addEventListener('finish', done);
    a.addEventListener('cancel', done);
  }
  function stopAnimations() {
    for (const a of [...running]) a.cancel();
    running.clear();
  }

  /** @type {ReturnType<typeof setTimeout>|null} */ let holdTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */ let blinkTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */ let glanceTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */ let poseTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */ let faceTimer = null;
  /** @type {ReturnType<typeof setInterval>|null} */ let flapTimer = null;

  // ---- drawing state ----

  /** @returns {MouthVariant} */
  function mouthNow() {
    const m = face.mouth ?? MOOD[mood].mouth;
    if (!flap) return m;
    return m === 'o' ? 'soft' : 'o';                        // a mood whose mouth is already `o` closes it instead
  }

  function paintFace() {
    const spec = MOOD[mood];
    fig.dataset.mood = mood;
    fig.dataset.eyes = face.eyes ?? spec.eyes;
    fig.dataset.mouth = mouthNow();
    fig.dataset.extras = spec.extras.join(' ');
  }

  function paintRig() {
    const spec = MOOD[mood];
    const s = fig.style;
    s.setProperty('--arm-r', `${pose.armR ?? spec.arm}deg`);
    s.setProperty('--fan-rot', `${pose.fanRot ?? spec.fanRot}deg`);
    s.setProperty('--tilt', `${spec.tilt}deg`);
    s.setProperty('--brow-l', `${spec.browL}deg`);
    s.setProperty('--brow-r', `${spec.browR}deg`);
    s.setProperty('--brow-ly', `${spec.browLY}px`);
    s.setProperty('--brow-ry', `${spec.browRY}px`);
    s.setProperty('--head-y', `${spec.headY}px`);
  }

  /** Paint without the 260 ms tween. @param {() => void} fn */
  function snap(fn) {
    fig.classList.add('is-snap');
    fn();
    void fig.getBoundingClientRect();                       // flush, so that removing the class starts no transition
    fig.classList.remove('is-snap');
  }

  /** @param {Mood} next @param {boolean} instant */
  function show(next, instant) {
    const changed = next !== mood;
    mood = next;
    // A new mood ends the stand-in of an earlier gesture; a gesture of this same turn (nod + its mood) keeps it.
    if (changed && faceTimer !== null && !faceFresh) { faceTimer = drop(faceTimer); face = {}; }
    if (instant || reduced) { snap(() => { paintFace(); paintRig(); }); return; }
    paintFace();
    paintRig();
    if (!changed) return;
    play(headAct, [{ transform: 'scaleY(.96)' }, { transform: 'scaleY(1)' }], { duration: 90, easing: 'ease-out' });
    if (next === 'alarmed') {
      play(stage, [{ transform: 'translateX(0)' }, { transform: 'translateX(-1.6%)' }, { transform: 'translateX(1.6%)' },
        { transform: 'translateX(-1%)' }, { transform: 'translateX(1%)' }, { transform: 'translateX(0)' }], { duration: 240, easing: 'linear' });
    }
    if (next === 'cheering') hop(-4, 500, 3);
  }

  /** The whole figure jumps up and lands. @param {number} dy percent of the figure's height @param {number} ms @param {number} times */
  function hop(dy, ms, times) {
    const up = 'cubic-bezier(.2,.8,.2,1)', down = 'cubic-bezier(.6,0,.9,.4)';
    play(stage, [{ transform: 'translateY(0)', easing: up }, { transform: `translateY(${dy}%)`, easing: down }, { transform: 'translateY(0)' }],
      { duration: ms, iterations: times });
  }

  // ---- idle timers (blink, glance) and the speaking mouth; all stopped under reduced motion and while hidden ----

  const live = () => !destroyed && !reduced && !doc.hidden;

  function blinkOnce() {
    fig.classList.add('is-blink');
    later(() => fig.classList.remove('is-blink'), BLINK_MS);
  }
  function scheduleBlink() {
    blinkTimer = drop(blinkTimer);
    if (!live()) return;
    blinkTimer = later(() => {
      blinkTimer = null;
      if (live() && !NO_BLINK.includes(MOOD[mood].eyes)) {
        blinkOnce();
        if (Math.random() < BLINK_AGAIN_CHANCE) later(() => { if (live()) blinkOnce(); }, BLINK_MS + BLINK_AGAIN_MS);
      }
      scheduleBlink();
    }, between(BLINK_MIN, BLINK_MAX));
  }
  function scheduleGlance() {
    glanceTimer = drop(glanceTimer);
    if (!live()) return;
    glanceTimer = later(() => {
      glanceTimer = null;
      if (live() && mood === 'idle') {
        fig.classList.add('is-glance');
        later(() => fig.classList.remove('is-glance'), GLANCE_MS);
      }
      scheduleGlance();
    }, between(GLANCE_MIN, GLANCE_MAX));
  }
  function syncFlap() {
    const on = speaking && live() && !NO_FLAP.includes(MOOD[mood].mouth);
    if (on && flapTimer === null) {
      flapTimer = setInterval(() => { flap = !flap; fig.dataset.mouth = mouthNow(); }, FLAP_MS);
    } else if (!on && flapTimer !== null) {
      clearInterval(flapTimer);
      flapTimer = null;
    }
    if (!on && flap) { flap = false; fig.dataset.mouth = mouthNow(); }
  }
  function syncTimers() {
    if (live()) {
      if (blinkTimer === null) scheduleBlink();
      if (glanceTimer === null) scheduleGlance();
    } else {
      blinkTimer = drop(blinkTimer);
      glanceTimer = drop(glanceTimer);
      fig.classList.remove('is-blink', 'is-glance');
    }
    syncFlap();
  }
  const onVisibility = () => syncTimers();
  doc.addEventListener('visibilitychange', onVisibility);

  // ---- figure events ----

  const onFigureClick = () => {
    host.dispatchEvent(new CustomEvent('buddy:tap', { bubbles: true, detail: {} }));
  };
  figure.addEventListener('click', onFigureClick);

  // ---- bubble ----

  const bubble = createBubble(host, () => reduced);

  // ---- controller ----

  /** @param {'bust'|'full'} v */
  function paintVariant(v) {
    variant = v === 'bust' ? 'bust' : 'full';
    host.dataset.variant = variant;
    for (const el of layers) el.setAttribute('viewBox', variant === 'bust' ? VIEW_BUST : VIEW_FULL);
  }

  /** A brief static stand-in for a gesture under reduced motion (nothing moves; a part is swapped and swapped back).
   *  @param {{eyes?:EyeVariant, mouth?:MouthVariant}} f @param {number} ms */
  function flashFace(f, ms) {
    faceTimer = drop(faceTimer);
    face = f;
    faceFresh = true;
    queueMicrotask(() => { faceFresh = false; });
    paintFace();
    faceTimer = later(() => { faceTimer = null; face = {}; paintFace(); }, ms);
  }

  /** @type {Buddy} */
  const api = {
    setMood(next, o) {
      if (destroyed || !MOOD[next]) return;
      holdTimer = drop(holdTimer);
      show(next, !!o?.instant);
      syncFlap();
      const hold = o?.hold;
      if (typeof hold === 'number' && hold > 0) {
        holdTimer = later(() => { holdTimer = null; show(baseMood, false); syncFlap(); }, hold);
      }
    },
    setBaseMood(next) {
      if (destroyed || !MOOD[next]) return;
      baseMood = next;
      if (holdTimer === null) { show(next, false); syncFlap(); }       // a held mood returns to the new base when it ends
    },
    getMood: () => mood,
    react(gesture) {
      if (destroyed) return;
      switch (gesture) {
        case 'nod':
          if (reduced) flashFace({ eyes: 'happy' }, 500);
          else play(headAct, [0, 7, 0, 7, 0].map((y) => ({ transform: `translateY(${y}px)` })), { duration: 400, easing: 'ease-in-out' });
          break;
        case 'hop':
          if (reduced) flashFace({ eyes: 'happy' }, 500);
          else hop(-3.5, 300, 1);
          break;
        case 'shake':
          if (reduced) flashFace({ mouth: 'wavy' }, 500);
          else play(headAct, [0, -6, 6, -4, 4, 0].map((a) => ({ transform: `rotate(${a}deg)` })), { duration: 400, easing: 'ease-in-out' });
          break;
        case 'peek':
          if (reduced) flashFace({ eyes: 'side' }, 700);
          else play(stage, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-5deg)', offset: 0.4 }, { transform: 'rotate(-5deg)', offset: 0.6 },
            { transform: 'rotate(0deg)' }], { duration: 700, easing: 'ease-in-out' });      // he leans toward his fan side, where the table is
          break;
        case 'point':
          poseTimer = drop(poseTimer);
          pose = variant === 'bust' ? { armR: POINT_ARM_BUST, fanRot: POINT_FAN_BUST } : { armR: POINT_ARM, fanRot: POINT_FAN };
          if (reduced) snap(paintRig); else paintRig();
          poseTimer = later(() => { poseTimer = null; pose = {}; if (reduced) snap(paintRig); else paintRig(); }, POINT_MS);
          break;
        default:
          break;
      }
    },
    setSpeaking(on) {
      speaking = !!on;
      syncFlap();
    },
    setVariant(v) {
      if (destroyed) return;
      paintVariant(v);
    },
    setReducedMotion(on) {
      reduced = !!on;
      fig.classList.toggle('is-still', reduced);
      if (reduced) {
        stopAnimations();
        snap(() => { paintFace(); paintRig(); });
      }
      syncTimers();
    },
    bubble: bubble.api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      if (flapTimer !== null) clearInterval(flapTimer);
      flapTimer = null;
      stopAnimations();
      doc.removeEventListener('visibilitychange', onVisibility);
      figure.removeEventListener('click', onFigureClick);
      bubble.destroy();
      figure.remove();
      host.classList.remove('buddy-box');
      delete host.dataset.variant;
    },
  };

  // ---- first paint ----

  fig.classList.toggle('is-still', reduced);
  paintVariant(variant);
  snap(() => { paintFace(); paintRig(); });
  if (win) syncTimers();
  return api;
}

// ---------------------------------------------------------------------------------------------------------------------
// §11.6 the speech bubble
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {HTMLElement} host
 * @param {() => boolean} isReduced
 * @returns {{ api:Bubble, destroy:() => void }}
 */
function createBubble(host, isReduced) {
  const doc = host.ownerDocument;

  const root = doc.createElement('div');
  root.className = 'bubble';
  const question = doc.createElement('p');
  question.className = 'bubble__question';
  question.hidden = true;
  const tag = doc.createElement('span');
  tag.className = 'bubble__tag';
  tag.hidden = true;
  const caption = doc.createElement('span');
  caption.className = 'bubble__caption';
  let text = doc.createElement('span');
  text.className = 'bubble__text';
  const dots = doc.createElement('span');
  dots.className = 'bubble__dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.hidden = true;
  dots.append(doc.createElement('i'), doc.createElement('i'), doc.createElement('i'));
  const stale = doc.createElement('span');
  stale.className = 'bubble__stale';
  stale.hidden = true;
  root.append(question, tag, caption, text, dots, stale);
  root.dataset.empty = '1';
  host.dataset.bubble = '0';
  host.append(root);

  /** @type {string|null} */ let id = null;
  let questionFresh = false;          // set since the previous begin(): it belongs to the next line
  let captionFresh = false;
  let justBegan = false;              // true during the synchronous turn of begin()
  let captionTurn = false;            // true during the synchronous turn of the first captionEl()
  let typingWanted = false;
  let begunAt = 0;                    // begin(): no dots in its first 300 ms
  let waitFrom = 0;                   // start of the current wait for text: its dots end 3.5 s later at the latest
  /** @type {ReturnType<typeof setTimeout>|null} */ let typingTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */ let typingStop = null;
  let destroyed = false;

  const hasText = () => (text.textContent ?? '').length > 0 || text.childElementCount > 0;
  const hasCaption = () => (caption.textContent ?? '').length > 0 || caption.childElementCount > 0;

  /** A new, empty text container: a line that is still being written into the old one can no longer show up. */
  function freshText() {
    const next = doc.createElement('span');
    next.className = 'bubble__text';
    text.replaceWith(next);
    text = next;
  }

  function stopTyping() {
    if (typingTimer !== null) { clearTimeout(typingTimer); typingTimer = null; }
    if (typingStop !== null) { clearTimeout(typingStop); typingStop = null; }
    dots.hidden = true;
  }

  /** Dots show while a line is streaming and nothing has arrived: not in the first 300 ms after begin(), and for
   *  at most 3.5 s of one wait (`waitFrom`). */
  function armTyping() {
    stopTyping();
    if (destroyed || !typingWanted || root.dataset.state !== 'streaming' || hasText()) return;
    const now = Date.now();
    const showAt = begunAt + TYPING_DELAY_MS, hideAt = waitFrom + TYPING_MAX_MS;
    if (now >= hideAt) return;
    const showDots = () => {
      typingTimer = null;
      if (destroyed || !typingWanted || root.dataset.state !== 'streaming' || hasText()) return;
      dots.hidden = false;
      refresh();
    };
    typingStop = setTimeout(() => { typingStop = null; stopTyping(); refresh(); }, hideAt - now);
    if (now >= showAt) showDots(); else typingTimer = setTimeout(showDots, showAt - now);
  }

  /** Keeps data-empty, data-more and the dots in step with what is inside the bubble. */
  function refresh() {
    if (destroyed) return;
    if (!dots.hidden && (hasText() || root.dataset.state !== 'streaming')) stopTyping();
    caption.hidden = !hasCaption();
    const empty = question.hidden && tag.hidden && caption.hidden && !hasText() && dots.hidden && stale.hidden;
    if (empty) root.dataset.empty = '1'; else delete root.dataset.empty;
    host.dataset.bubble = empty ? '0' : '1';               // the host draws the tail
    const more = !empty && root.scrollHeight > root.clientHeight + 1;
    if (more) root.dataset.more = '1'; else delete root.dataset.more;
  }

  // Text arrives from outside (stream-text writes into the container; chat-panel sets data-state / data-source).
  const Observer = doc.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(() => refresh()) : null;
  observer?.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
  const Resize = doc.defaultView?.ResizeObserver;
  const resize = Resize ? new Resize(() => refresh()) : null;
  resize?.observe(root);

  function dropQuestion() {
    question.replaceChildren();
    question.hidden = true;
    questionFresh = false;
  }
  function dropCaption() {
    caption.replaceChildren();
    captionFresh = false;
  }
  /** Removes the line: tag, text, stale label, dots. */
  function dropLine() {
    stopTyping();
    typingWanted = false;
    tag.hidden = true;
    tag.textContent = '';
    delete tag.dataset.tone;
    stale.hidden = true;
    stale.textContent = '';
    delete root.dataset.staleCorner;
    freshText();
  }

  /** @param {string|null} cue @param {'good'|'warn'|'neutral'} tone */
  function paintTag(cue, tone) {
    if (!cue) {
      tag.hidden = true;
      tag.textContent = '';
      delete tag.dataset.tone;
      return;
    }
    tag.textContent = readCue(cue).text;
    tag.dataset.tone = tone;
    tag.hidden = false;
    if (!isReduced() && typeof tag.animate === 'function') {
      tag.animate([{ transform: 'scale(.6) rotate(-8deg)', opacity: 0 }, { transform: 'scale(1) rotate(-2deg)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }
  }

  const onClick = (/** @type {MouseEvent} */ event) => {
    const target = /** @type {Element|null} */ (event.target instanceof Element ? event.target : null);
    if (target && target.closest('button, a, input, textarea, select')) return;     // move links and the like keep their tap
    if (root.dataset.empty === '1') return;
    host.dispatchEvent(new CustomEvent('bubble:expand', { bubbles: true, detail: { id } }));
  };
  root.addEventListener('click', onClick);

  /** @type {Bubble} */
  const api = {
    begin(msg) {
      id = msg.id;
      if (questionFresh) questionFresh = false; else dropQuestion();
      if (captionFresh) captionFresh = false; else dropCaption();
      dropLine();
      root.dataset.state = 'streaming';
      delete root.dataset.source;
      const cue = msg.cue ?? null;
      paintTag(cue, cue ? readCue(cue).tone : 'neutral');
      begunAt = waitFrom = Date.now();
      typingWanted = true;
      armTyping();
      justBegan = true;
      queueMicrotask(() => { justBegan = false; });
      refresh();
      return text;
    },
    setTag(cue, tone) {
      paintTag(cue, tone === 'good' || tone === 'warn' ? tone : 'neutral');
      refresh();
    },
    setQuestion(el) {
      if (!el) { dropQuestion(); refresh(); return; }
      const copy = /** @type {HTMLElement} */ (el.cloneNode(true));          // never re-parent the caller's element
      copy.removeAttribute('id');
      for (const d of copy.querySelectorAll('[id]')) d.removeAttribute('id');
      question.replaceChildren(copy);
      question.hidden = false;
      questionFresh = !justBegan;
      refresh();
    },
    captionEl() {
      if (!captionTurn) {
        // first request of this turn: a new caption is about to be written
        captionTurn = true;
        queueMicrotask(() => { captionTurn = false; });
        if (!justBegan) {
          // ... and it opens a new moment: the previous line, its question and the old caption go
          dropLine();
          dropQuestion();
          caption.replaceChildren();
          id = null;
          root.dataset.state = 'done';
          root.dataset.source = 'local';
          captionFresh = true;
        }
      }
      refresh();
      return caption;
    },
    status(line) {
      const state = root.dataset.state;
      if (state === 'streaming' || (state === 'done' && hasText())) return;     // only when the line is stale or empty
      dropLine();
      dropQuestion();
      dropCaption();
      id = null;
      text.textContent = line;
      root.dataset.state = 'status';
      root.dataset.source = 'local';
      refresh();
    },
    markStale(label) {
      stopTyping();
      typingWanted = false;
      if (root.dataset.state === 'status') return;
      if (!hasText() && tag.hidden && !hasCaption()) { api.clear(); return; }     // nothing to dim
      stale.hidden = true;
      delete root.dataset.staleCorner;
      const height = root.offsetHeight;
      root.dataset.state = 'stale';
      stale.textContent = label;
      stale.hidden = !label;
      // "Nothing jumps" (§11.6): the label follows the line where it fits; where it would start a new line, or where
      // the line is longer than the bubble, it rests in the bubble's corner instead (styles/buddy.css).
      if (label && (root.offsetHeight > height || root.scrollHeight > root.clientHeight + 1)) root.dataset.staleCorner = '1';
      refresh();
    },
    setTyping(on) {
      if (!on) {
        typingWanted = false;
        stopTyping();
      } else if (!typingWanted || (typingTimer === null && dots.hidden)) {
        // a new wait; while dots are showing or due, asking again changes nothing (no flicker, the same cap)
        typingWanted = true;
        waitFrom = Date.now();
        armTyping();
      }
      refresh();
    },
    clear() {
      dropLine();
      dropQuestion();
      dropCaption();
      id = null;
      delete root.dataset.state;
      delete root.dataset.source;
      refresh();
    },
  };

  return {
    api,
    destroy() {
      destroyed = true;
      stopTyping();
      observer?.disconnect();
      resize?.disconnect();
      root.removeEventListener('click', onClick);
      root.remove();
      delete host.dataset.bubble;
    },
  };
}
