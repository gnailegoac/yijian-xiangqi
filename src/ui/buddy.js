// The strategist 诸葛亮 and his speech bubble (SPEC §4.28.4; construction, moods, motion: §11). Package X5.
//
// createBuddy(host, opts) fills `host` (#buddy) with
//   <button class="buddy-fig"> <svg class="buddy" data-mood data-eyes data-mouth data-fan data-extras> … </svg> </button>
//   <div class="bubble" data-state data-source> question · tag · caption · text </div>
// and returns the Buddy controller. Everything visual is in styles/buddy.css; this file owns the drawing
// (one inline SVG built from the coordinates of §11.2), the mood table of §11.3, the timers and one-shot
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
// Drawing space: he gestures toward +x (side glance, pointing fan, peek). styles/buddy.css mirrors the figure
// where the board lies on the other side (landscape) and un-mirrors the collar and the glyphs.
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
/** @typedef {'gathered'|'spread'} FanVariant */
/** @typedef {'sweat'|'bang'|'dots'|'q'|'spark'|'blush'|'note'} ExtraVariant */
/** @typedef {'nod'|'hop'|'shake'|'peek'|'point'} Gesture */
/**
 * One row of the mood table (§11.3). Angles in degrees, offsets in viewBox units.
 * @typedef {Object} MoodSpec
 * @property {EyeVariant} eyes
 * @property {MouthVariant} mouth
 * @property {FanVariant} fan
 * @property {number} armR
 * @property {number} armL
 * @property {number} fanRot
 * @property {number} tilt
 * @property {number} browL
 * @property {number} browR
 * @property {number} browY
 * @property {number} headY
 * @property {readonly ExtraVariant[]} extras
 */

// ---------------------------------------------------------------------------------------------------------------------
// §11.3 the mood table
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {EyeVariant} eyes @param {MouthVariant} mouth @param {FanVariant} fan
 * @param {number} armR @param {number} armL @param {number} fanRot @param {number} tilt
 * @param {number} browL @param {number} browR @param {number} browY @param {number} headY
 * @param {ExtraVariant[]} extras
 * @returns {MoodSpec}
 */
function row(eyes, mouth, fan, armR, armL, fanRot, tilt, browL, browR, browY, headY, extras) {
  return Object.freeze({ eyes, mouth, fan, armR, armL, fanRot, tilt, browL, browR, browY, headY, extras: Object.freeze(extras) });
}

// The rows are the contract's, tuned on the rendered sheet (dev/buddy.html) at 290 px and 56 px.
// Within the ±6° / ±2 units of §11.3: armL 14 -> 20 wherever the free arm hangs (the sleeve shows beside the body
// instead of hiding behind it); listening browY -1.5 -> -3.5; worried armR -6 -> -12; alarmed fanRot 148 -> 142 (the
// fan stays inside the bust frame); cheering armR -150 -> -144.
// Beyond it, because the contract's value does not give the pose its row "reads as" with the feather fan:
//   thinking  fanRot 28 -> 8     the fan's upper edge passes under both eyes instead of across them
//   worried   fanRot 172 -> 122  the drooping fan stays above the ground line instead of piercing it by 15 units
//   cheering  fanRot 175 -> 198  the open fan is beside his head instead of over his right eye
//   listening tilt -5 -> -11     the only cue that tells listening from idle on the 56 px bust
/** @type {Readonly<Record<Mood, MoodSpec>>} */
const MOOD = Object.freeze({
  //               eyes     mouth    fan         armR  armL fanRot tilt browL browR browY headY extras
  idle:      row('open',  'smirk', 'gathered',  -18,   20,   40,    0,    7,   -7,    0,    0, []),
  listening: row('up',    'soft',  'gathered',  -18,   20,   40,  -11,    0,    0, -3.5,    0, []),
  thinking:  row('side',  'hmm',   'spread',   -148,   20,    8,    5,   -8,   10,    0,    0, ['dots']),
  curious:   row('open',  'o',     'gathered',  -75,   20,   85,   -8,   -6,  -14,   -2,    0, ['q']),
  pleased:   row('happy', 'smile', 'spread',    -40,   20,   15,    0,    0,    0,    0,    0, ['blush']),
  impressed: row('star',  'grin',  'spread',    -70,  150,   60,    0,    0,    0,   -3,    0, ['spark']),
  worried:   row('side',  'wavy',  'gathered',  -12,   20,  122,    4,   16,  -16,   -1,    1, ['sweat']),
  alarmed:   row('wide',  'bigo',  'gathered', -128,  128,  142,    0,   12,  -12,   -4,   -2, ['bang']),
  cheering:  row('happy', 'cheer', 'spread',   -144,  150,  198,    0,    0,    0,   -3,   -2, ['blush', 'note']),
  consoling: row('soft',  'soft',  'gathered',  -18,   78,   40,    6,   10,  -10,    0,    0, []),
});

// ---------------------------------------------------------------------------------------------------------------------
// §11.2 construction: one static SVG template (numbers only, no external data)
// ---------------------------------------------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
let figures = 0;                                          // for unique ids inside each drawing
const VIEW_FULL = '0 0 120 140';
const VIEW_BUST = '10 2 100 100';

const INK = '#1d2433', SKIN = '#ffe3c4', SKIN_EDGE = '#e6b58c', ROBE = '#f4f1e6', CLOAK = '#e9eef2', TRIM = '#27344d';
const CLOTH = '#2f4a6b', FOLD = '#3d5f87', BAND = '#c9a260', JADE = '#7fd6b8', JADE_EDGE = '#2b7a64';
const FEATHER = '#ffffff', QUILL = '#b9c4d2', HANDLE = '#8a6a3a';
// Not in the colour list of §11.2: "gold" (star eyes and glyphs), the down between the feathers, a brow seen through the fringe.
const GOLD = '#ffc83d', DOWN = '#e8eef6', BROW_ON_HAIR = '#6f84ad';

/** @param {number} x */
const n2 = (x) => String(Math.round(x * 100) / 100);

/** A point on the fan, in the arm's frame: pivot (76,116), angle in degrees. @param {number} a @param {number} r */
function fanPoint(a, r) {
  const t = (a * Math.PI) / 180;
  return `${n2(76 + r * Math.cos(t))} ${n2(116 + r * Math.sin(t))}`;
}

/** The outline of one feather on axis `a` with half-spread `w` and tip radius `R` (§11.2). @param {number} a @param {number} w @param {number} R */
function featherPath(a, w, R) {
  const mid = (12 + R) / 2 + 3;
  return `M${fanPoint(a, 12)} Q${fanPoint(a - w, mid)} ${fanPoint(a, R)} Q${fanPoint(a + w, mid)} ${fanPoint(a, 12)} Z`;
}

/**
 * The feather fan. The feathers and their quills are the ones of §11.2; behind them lie the down that fills the
 * gaps between the quills (it follows the two outer feathers and ends `tip` units below the feather tips) and one
 * ink outline around the whole silhouette, so the white fan reads as one solid prop on a pale robe and on a pale
 * page alike. The feathers are drawn from the outside in, so the middle one lies on top.
 * @param {number[]} axes @param {number} w @param {number} R @param {number} tip
 */
function fan(axes, w, R, tip) {
  const mid = (axes.length - 1) / 2;
  const order = axes.map((a, i) => ({ a, d: Math.abs(i - mid) })).sort((p, q) => q.d - p.d);
  const a0 = axes[0], a1 = axes[axes.length - 1], r = R - tip, bulge = (12 + R) / 2 + 3;
  const down = `M${fanPoint(a0, 12)} Q${fanPoint(a0 - w, bulge)} ${fanPoint(a0, r)} A${r} ${r} 0 0 1 ${fanPoint(a1, r)} Q${fanPoint(a1 + w, bulge)} ${fanPoint(a1, 12)} Z`;
  const shapes = order.map((f) => featherPath(f.a, w, R));
  return `<path d="${down} ${shapes.join(' ')}" fill="${INK}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`
    + `<path d="${down}" fill="${DOWN}"/>`
    + order.map((f, i) => `<path d="${shapes[i]}" fill="${FEATHER}" stroke="${QUILL}" stroke-width=".8" stroke-linejoin="round"/>`
      + `<path d="M${fanPoint(f.a, 12)} L${fanPoint(f.a, R - 2)}" fill="none" stroke="${QUILL}" stroke-width=".6" stroke-linecap="round"/>`).join('')
    + `<rect x="74.6" y="104" width="2.8" height="16" rx="1.4" fill="${HANDLE}" stroke="${INK}" stroke-width=".8"/>`
    + `<circle cx="76" cy="104" r="2.4" fill="${JADE}" stroke="${JADE_EDGE}" stroke-width=".8"/>`;
}

/** Both eyes of one variant: left eye centre x = 47, right x = 73. @param {(cx:number) => string} one */
const eyes = (one) => one(47) + one(73);

/** @type {Readonly<Record<EyeVariant, string>>} */
const EYES = Object.freeze({
  open: eyes((cx) => `<ellipse cx="${cx}" cy="52" rx="4.3" ry="5.8" fill="${INK}"/><circle cx="${n2(cx - 1.4)}" cy="49.8" r="1.6" fill="#fff"/>`),
  wide: eyes((cx) => `<ellipse cx="${cx}" cy="52" rx="5.4" ry="6.8" fill="#fff" stroke="${INK}" stroke-width="1.6"/><circle cx="${cx}" cy="52.5" r="3" fill="${INK}"/><circle cx="${cx - 1}" cy="51.2" r="1" fill="#fff"/>`),
  happy: eyes((cx) => `<path d="M${cx - 5} 54 Q${cx} 46.5 ${cx + 5} 54" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`),
  soft: eyes((cx) => `<path d="M${cx - 5} 51 Q${cx} 56 ${cx + 5} 51" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`),
  star: eyes((cx) => `<path d="M${cx} 44.5 L${cx + 2} 50 L${n2(cx + 7.5)} 52 L${cx + 2} 54 L${cx} 59.5 L${cx - 2} 54 L${n2(cx - 7.5)} 52 L${cx - 2} 50 Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>`),
  side: eyes((cx) => `<ellipse cx="${n2(cx + 1.8)}" cy="52.5" rx="3.6" ry="4.8" fill="${INK}"/><circle cx="${n2(cx + 0.8)}" cy="50.8" r="1.3" fill="#fff"/>`),
  up: eyes((cx) => `<ellipse cx="${cx + 1}" cy="50.6" rx="4" ry="5.4" fill="${INK}"/><circle cx="${n2(cx + 0.2)}" cy="48.2" r="1.5" fill="#fff"/>`),
});

const LINE = `fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

/** @type {Readonly<Record<MouthVariant, string>>} */
const MOUTHS = Object.freeze({
  smirk: `<path d="M54.5 65.2 Q60.5 69.8 66.5 63.4" ${LINE}/>`,
  smile: `<path d="M54 64.5 Q60 70.5 66 64.5" ${LINE}/>`,
  grin: `<path d="M52.5 63 Q60 74.5 67.5 63 Z" fill="#b5433a" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`,
  cheer: `<path d="M51 61.5 Q60 79 69 61.5 Z" fill="#b5433a" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`
    + `<path d="M55.5 70.5 Q60 67 64.5 70.5 Q60 75.5 55.5 70.5 Z" fill="#ff8f86"/>`,
  o: `<ellipse cx="60" cy="67" rx="3.2" ry="4.2" fill="#7a2e2a" stroke="${INK}" stroke-width="1.4"/>`,
  bigo: `<ellipse cx="60" cy="68" rx="5" ry="6.4" fill="#7a2e2a" stroke="${INK}" stroke-width="1.6"/>`,
  wavy: `<path d="M53 67.5 Q56.5 63.5 60 67.5 T67 67.5" ${LINE}/>`,
  hmm: `<path d="M56.5 66.2 Q59.5 68 62.5 66.2 T67 65" ${LINE}/>`,
  soft: `<path d="M55.5 65 Q60 68.6 64.5 65" ${LINE}/>`,
});

// The glyphs and the thought dots carry a thin outline: they float over the page, which is pale in one theme.
const GLYPH = `fill="${GOLD}" stroke="${INK}" stroke-width=".7" stroke-linejoin="round" paint-order="stroke"`;
const DOT = 'fill="#cfe0ff" stroke="#7f95c2" stroke-width=".8"';

/** @type {Readonly<Record<ExtraVariant, string>>} */
const EXTRAS = Object.freeze({
  sweat: `<path d="M90 33 Q94.5 40 90 43.5 Q85.5 40 90 33 Z" fill="#8fd3ff" stroke="#3b8fc4" stroke-width="1"/>`,
  bang: `<g transform="translate(101 6) rotate(12)"><rect x="-2.6" y="0" width="5.2" height="13" rx="2.4" fill="#ff5a4a"/><circle cx="0" cy="18" r="2.8" fill="#ff5a4a"/></g>`,
  dots: `<circle cx="27" cy="30" r="2.2" ${DOT}/><circle cx="20" cy="22" r="3" ${DOT}/><circle cx="12" cy="12" r="4" ${DOT}/>`,
  q: `<g class="b-glyph b-glyph--q"><text x="100" y="24" font-size="22" font-weight="800" text-anchor="middle" dominant-baseline="central" ${GLYPH}>?</text></g>`,
  spark: `<path d="M20 26 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" ${GLYPH}/><path d="M103 16 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 Z" ${GLYPH}/>`,
  blush: `<ellipse cx="40" cy="61" rx="6" ry="3.6" fill="#ff8f7a" opacity=".75"/><ellipse cx="80" cy="61" rx="6" ry="3.6" fill="#ff8f7a" opacity=".75"/>`,
  note: `<g class="b-glyph b-glyph--note"><circle cx="16" cy="40" r="3" ${GLYPH}/><rect x="18" y="26" width="1.8" height="14" ${GLYPH}/><path d="M18 26 q6 1 7 6 q-3 -3 -7 -2 Z" ${GLYPH}/></g>`,
});

/** @param {string} cls @param {Readonly<Record<string, string>>} table */
function variants(cls, table) {
  return `<g class="${cls}">${Object.keys(table).map((v) => `<g data-v="${v}">${table[v]}</g>`).join('')}</g>`;
}

const FRINGE = 'M30.6 52 Q28.5 21 60 20 Q91.5 21 89.4 52 Q85 39.5 75 36.5 Q70.5 44.5 61 38 Q52.5 46.5 44.5 37.5 Q36 41 30.6 52 Z';
const BROW_L = 'M42 40.5 L51 38.6', BROW_R = 'M69 38.6 L78 40.5';

/** The drawing, back to front (§11.2). `uid` keeps the clip-path id unique when several figures share a page. @param {string} uid */
const figureMarkup = (uid) => `
<defs><clipPath id="${uid}-fringe"><path d="${FRINGE}"/></clipPath></defs>
<ellipse class="b-shadow" cx="60" cy="134" rx="30" ry="4.5" fill="#000" opacity=".18"/>
<g class="b-fig">
  <g class="b-cloak">
    <path d="M30 133 Q24 98 40 84 Q60 74 80 84 Q96 98 90 133 Z" fill="${CLOAK}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M40 84 Q34 104 33 133" fill="none" stroke="${TRIM}" stroke-width="3" stroke-linecap="round"/>
    <path d="M80 84 Q86 104 87 133" fill="none" stroke="${TRIM}" stroke-width="3" stroke-linecap="round"/>
  </g>
  <g class="b-arm-l">
    <path d="M38 88 H50 L52 112 Q44 119 36 112 Z" fill="${ROBE}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M36.5 108 Q44 114 51.5 108" fill="none" stroke="${TRIM}" stroke-width="2.2"/>
    <circle cx="44" cy="116" r="5" fill="${SKIN}" stroke="${SKIN_EDGE}"/>
  </g>
  <g class="b-body">
    <path d="M36 133 Q33 100 43 85 Q60 77 77 85 Q87 100 84 133 Z" fill="${ROBE}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <g class="b-collar">
      <path d="M49 82 L62.5 106 L58 108 L45 85.5 Z" fill="${TRIM}"/>
      <path d="M71 82 L55 109 L59.5 111 L75 85.5 Z" fill="${TRIM}"/>
    </g>
    <rect x="38.5" y="109" width="43" height="7.5" rx="2.5" fill="${TRIM}" stroke="${INK}" stroke-width="1.1"/>
    <circle cx="60" cy="112.8" r="4.4" fill="${JADE}" stroke="${JADE_EDGE}" stroke-width="1.2"/>
  </g>
  <g class="b-head-act">
    <g class="b-head">
      <g class="b-ribbon">
        <path d="M84 34 Q96 40 94 58 Q90 50 86 48 Q90 42 84 38 Z" fill="${CLOTH}" stroke="${INK}"/>
        <path d="M86 36 Q102 46 99 66 Q95 56 90 54 Q94 46 86 40 Z" fill="${CLOTH}" stroke="${INK}"/>
      </g>
      <ellipse cx="60" cy="50" rx="32.5" ry="31.5" fill="${INK}"/>
      <circle cx="31.5" cy="56" r="4.6" fill="${SKIN}" stroke="${SKIN_EDGE}"/><circle cx="88.5" cy="56" r="4.6" fill="${SKIN}" stroke="${SKIN_EDGE}"/>
      <circle cx="60" cy="52" r="29" fill="${SKIN}" stroke="${SKIN_EDGE}"/>
      <path class="b-brow-l" d="${BROW_L}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
      <path class="b-brow-r" d="${BROW_R}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="${FRINGE}" fill="${INK}"/>
      <g clip-path="url(#${uid}-fringe)">
        <path class="b-brow-l" d="${BROW_L}" stroke="${BROW_ON_HAIR}" stroke-width="2.4" stroke-linecap="round"/>
        <path class="b-brow-r" d="${BROW_R}" stroke="${BROW_ON_HAIR}" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <path d="M33 34 Q34 8 60 6 Q86 8 87 34 Q74 26 60 26 Q46 26 33 34 Z" fill="${CLOTH}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M36.5 27.5 Q60 17.5 83.5 27.5 M55 11 Q46.5 13.5 41 21.5" fill="none" stroke="${FOLD}" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M52 8 Q60 0 68 8 Q60 12 52 8 Z" fill="${FOLD}" stroke="${INK}"/>
      <path d="M33 33 Q60 23 87 33 L87 38 Q60 28 33 38 Z" fill="${BAND}" stroke="${INK}"/>
      <ellipse cx="40" cy="61" rx="5.2" ry="3.1" fill="#ff9d8a" opacity=".5"/><ellipse cx="80" cy="61" rx="5.2" ry="3.1" fill="#ff9d8a" opacity=".5"/>
      ${variants('b-eyes', EYES)}
      ${variants('b-mouth', MOUTHS)}
      ${variants('b-extras', EXTRAS)}
    </g>
  </g>
  <g class="b-arm-r">
    <path d="M70 88 H82 L84 112 Q76 119 68 112 Z" fill="${ROBE}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M68.5 108 Q76 114 83.5 108" fill="none" stroke="${TRIM}" stroke-width="2.2"/>
    <g class="b-fan">
      <g data-v="gathered">${fan([-104, -97, -90, -83, -76], 7, 40, 3)}</g>
      <g data-v="spread">${fan([-150, -130, -110, -90, -70, -50, -30], 9, 42, 9)}</g>
    </g>
    <circle cx="76" cy="116" r="5" fill="${SKIN}" stroke="${SKIN_EDGE}"/>
  </g>
</g>`;

// ---------------------------------------------------------------------------------------------------------------------
// §11.4 timing
// ---------------------------------------------------------------------------------------------------------------------

const BLINK_MIN = 2600, BLINK_MAX = 6000, BLINK_MS = 110, BLINK_AGAIN_MS = 140, BLINK_AGAIN_CHANCE = 0.15;
const GLANCE_MIN = 8000, GLANCE_MAX = 14000, GLANCE_MS = 900;
const FLAP_MS = 120;
const POINT_MS = 800, POINT_ARM = -95, POINT_FAN = 170;
// As a bust the stretched arm would leave the frame, and the board is above him: there the fan goes up beside his head.
const POINT_ARM_BUST = -150, POINT_FAN_BUST = 158;
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

  const svg = /** @type {SVGSVGElement} */ (doc.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('class', 'buddy');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '军师诸葛亮');
  svg.innerHTML = figureMarkup(`buddy${++figures}`);        // static template, numbers only
  figure.append(svg);

  /** @param {string} sel */
  const part = (sel) => /** @type {SVGGElement} */ (svg.querySelector(sel));
  const figG = part('.b-fig'), headAct = part('.b-head-act'), shadow = part('.b-shadow');

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
    svg.dataset.mood = mood;
    svg.dataset.eyes = face.eyes ?? spec.eyes;
    svg.dataset.mouth = mouthNow();
    svg.dataset.fan = spec.fan;
    svg.dataset.extras = spec.extras.join(' ');
  }

  function paintRig() {
    const spec = MOOD[mood];
    const s = svg.style;
    s.setProperty('--arm-r', `${pose.armR ?? spec.armR}deg`);
    s.setProperty('--arm-l', `${spec.armL}deg`);
    s.setProperty('--fan-rot', `${pose.fanRot ?? spec.fanRot}deg`);
    s.setProperty('--tilt', `${spec.tilt}deg`);
    s.setProperty('--brow-l', `${spec.browL}deg`);
    s.setProperty('--brow-r', `${spec.browR}deg`);
    s.setProperty('--brow-y', `${spec.browY}px`);
    s.setProperty('--head-y', `${spec.headY}px`);
  }

  /** Paint without the 260 ms tween. @param {() => void} fn */
  function snap(fn) {
    svg.classList.add('is-snap');
    fn();
    void svg.getBoundingClientRect();                       // flush, so that removing the class starts no transition
    svg.classList.remove('is-snap');
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
      play(figG, [{ transform: 'translateX(0)' }, { transform: 'translateX(-2.4px)' }, { transform: 'translateX(2.4px)' },
        { transform: 'translateX(-1.6px)' }, { transform: 'translateX(1.6px)' }, { transform: 'translateX(0)' }], { duration: 240, easing: 'linear' });
    }
    if (next === 'cheering') hop(-6, 500, 3);
  }

  /** The whole figure leaves the ground and lands; its shadow shrinks meanwhile. @param {number} dy @param {number} ms @param {number} times */
  function hop(dy, ms, times) {
    const up = 'cubic-bezier(.2,.8,.2,1)', down = 'cubic-bezier(.6,0,.9,.4)';
    play(figG, [{ transform: 'translateY(0)', easing: up }, { transform: `translateY(${dy}px)`, easing: down }, { transform: 'translateY(0)' }],
      { duration: ms, iterations: times });
    play(shadow, [{ transform: 'scale(1)', opacity: 0.18, easing: up }, { transform: 'scale(.82)', opacity: 0.11, easing: down },
      { transform: 'scale(1)', opacity: 0.18 }], { duration: ms, iterations: times });
  }

  // ---- idle timers (blink, glance) and the speaking mouth; all stopped under reduced motion and while hidden ----

  const live = () => !destroyed && !reduced && !doc.hidden;

  function blinkOnce() {
    svg.classList.add('is-blink');
    later(() => svg.classList.remove('is-blink'), BLINK_MS);
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
        svg.classList.add('is-glance');
        later(() => svg.classList.remove('is-glance'), GLANCE_MS);
      }
      scheduleGlance();
    }, between(GLANCE_MIN, GLANCE_MAX));
  }
  function syncFlap() {
    const on = speaking && live() && !NO_FLAP.includes(MOOD[mood].mouth);
    if (on && flapTimer === null) {
      flapTimer = setInterval(() => { flap = !flap; svg.dataset.mouth = mouthNow(); }, FLAP_MS);
    } else if (!on && flapTimer !== null) {
      clearInterval(flapTimer);
      flapTimer = null;
    }
    if (!on && flap) { flap = false; svg.dataset.mouth = mouthNow(); }
  }
  function syncTimers() {
    if (live()) {
      if (blinkTimer === null) scheduleBlink();
      if (glanceTimer === null) scheduleGlance();
    } else {
      blinkTimer = drop(blinkTimer);
      glanceTimer = drop(glanceTimer);
      svg.classList.remove('is-blink', 'is-glance');
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
    svg.setAttribute('viewBox', variant === 'bust' ? VIEW_BUST : VIEW_FULL);
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
          else play(headAct, [0, 2, 0, 2, 0].map((y) => ({ transform: `translateY(${y}px)` })), { duration: 400, easing: 'ease-in-out' });
          break;
        case 'hop':
          if (reduced) flashFace({ eyes: 'happy' }, 500);
          else hop(-5, 300, 1);
          break;
        case 'shake':
          if (reduced) flashFace({ mouth: 'wavy' }, 500);
          else play(headAct, [0, -6, 6, -4, 4, 0].map((a) => ({ transform: `rotate(${a}deg)` })), { duration: 400, easing: 'ease-in-out' });
          break;
        case 'peek':
          if (reduced) flashFace({ eyes: 'side' }, 700);
          else play(figG, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(6deg)', offset: 0.4 }, { transform: 'rotate(6deg)', offset: 0.6 },
            { transform: 'rotate(0deg)' }], { duration: 700, easing: 'ease-in-out' });
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
      svg.classList.toggle('is-still', reduced);
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

  svg.classList.toggle('is-still', reduced);
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
