// 司马懿's portrait and name plate in the top bar (SPEC §4.28.4, §11.7). Package X5; the sand-table look (V2).
//
// createRivalView(host) appends
//   <div class="rival" data-mood data-say="none|line|dots">
//     <span class="rival__disc"> <svg class="rival__face"> … </svg> <span class="rival__ring"> <span class="rival__flash"> </span>
//     <span class="rival__plate"> 司马懿 / 魏 · 大都督 </span>
//     <span class="rival__say"> his spoken line (2.4 s) · three dots while he thinks </span>
//   </div>
// to `host`. The look is in styles/rival.css. The bust is the head and shoulders of the sand-table cartoon figure:
// a purple robe under a dark mantle, a tall hat with a gold pin, half-lidded eyes, a thin moustache and beard.
// He is a worthy rival: sly and proud, never frightening, never humiliated.
//
// Faces: the mood picks the eyes and the mouth (data-eyes / data-mouth on the <svg>); the brows, the ring and the
// small badge on the disc follow data-mood in the stylesheet. While a line shows (data-say="line") the stylesheet
// swaps the mouth for the open one: he talks without a script timer.
//
// Motion: the one-shot shake, tilt and ring flash play only while html[data-motion="full"] and setReducedMotion(true)
// was not called, so the plate is still even if the stage only switches the attribute (§10.1: still is the default).

/** @import { RivalMood } from '../game/types.js' */

/** @typedef {'sly'|'up'|'away'|'wide'|'shut'} RivalEyes */
/** @typedef {'soft'|'flat'|'wavy'|'o'|'smirk'|'talk'} RivalMouth */

const SVG_NS = 'http://www.w3.org/2000/svg';

const INK = '#2a1f3d', SKIN = '#fbe0c6', SKIN_EDGE = '#dfa888', HAIR = '#1f1c30';
const ROBE = '#6d4dc8', ROBE_HI = '#8f72e6', MANTLE = '#2a2750', SILVER = '#dfe6fa', GOLD = '#ffc93c', IRIS = '#8a6be0';

/** How long a spoken line stays (§11.7). */
const SAY_MS = 2400;

/** §11.7: the face of each mood, in the faces of the sand-table figure:
 *  calm = his resting sly look, thinking = "think", frown = "sulk", rattled = "shock", smug = "smug".
 *  @type {Readonly<Record<RivalMood, {eyes:RivalEyes, mouth:RivalMouth}>>} */
const MOOD = Object.freeze({
  calm:     { eyes: 'sly',  mouth: 'soft' },
  thinking: { eyes: 'up',   mouth: 'flat' },
  frown:    { eyes: 'away', mouth: 'wavy' },
  rattled:  { eyes: 'wide', mouth: 'o' },
  smug:     { eyes: 'sly',  mouth: 'smirk' },
});

/** A filled shape with the ink outline. @param {string} d @param {string} fill @param {number} [sw] */
const P = (d, fill, sw = 6) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
/** A line. @param {string} d @param {string} stroke @param {number} sw @param {string} [cls] */
const L = (d, stroke, sw, cls) => `<path${cls ? ` class="${cls}"` : ''} d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** Both eyes of one variant: the eye centres are x = 114 and x = 170. @param {(cx:number) => string} one */
const eyes = (one) => one(114) + one(170);

/** @type {Readonly<Record<RivalEyes, string>>} */
const EYES = Object.freeze({
  // half-lidded: the upper lid cuts the eye flat (sly, not scary)
  sly: eyes((cx) => `<path d="M${cx - 13} 159 H${cx + 13} Q${cx + 14} 181 ${cx} 181 Q${cx - 14} 181 ${cx - 13} 159 Z" fill="${INK}"/><ellipse cx="${cx + 1.5}" cy="173" rx="7.5" ry="6" fill="${IRIS}"/>`
    + `<circle cx="${cx + 5}" cy="166" r="3.8" fill="#fff"/>` + L(`M${cx - 17} 158.5 H${cx + 17}`, INK, 7)),
  up: eyes((cx) => `<ellipse cx="${cx}" cy="166" rx="12.5" ry="15.5" fill="${INK}"/><ellipse cx="${cx - 2}" cy="160" rx="7.5" ry="6.5" fill="${IRIS}"/><circle cx="${cx - 5}" cy="157" r="3.8" fill="#fff"/>`),
  away: eyes((cx) => `<path d="M${cx - 13} 162 H${cx + 13} Q${cx + 14} 180 ${cx} 180 Q${cx - 14} 180 ${cx - 13} 162 Z" fill="${INK}"/><circle cx="${cx - 7}" cy="169" r="3.6" fill="#fff"/>`
    + L(`M${cx - 17} 161.5 H${cx + 17}`, INK, 7)),
  wide: eyes((cx) => `<circle cx="${cx}" cy="164" r="15.5" fill="#fff" stroke="${INK}" stroke-width="4.6"/><circle cx="${cx + 2}" cy="165" r="5.6" fill="${INK}"/>`),
  shut: eyes((cx) => L(`M${cx - 16} 166 Q${cx} 176 ${cx + 16} 166`, INK, 6.4)),          // the bow: no mood asks for it yet
});

/** @type {Readonly<Record<RivalMouth, string>>} */
const MOUTHS = Object.freeze({
  soft: L('M130 211 Q142 219 154 211', INK, 5.6),
  flat: L('M130 213 H156', INK, 5.6),
  wavy: L('M126 214 Q134 207 142 214 T158 214', INK, 5.6),
  o: `<ellipse cx="142" cy="215" rx="7.5" ry="9" fill="#7a2e2a" stroke="${INK}" stroke-width="4.4"/>`,
  smirk: L('M130 214 Q144 222 158 212', INK, 5.6),
  // open while he speaks (the stylesheet shows it for data-say="line")
  talk: `<path d="M128 209 Q142 205 156 209 Q155 227 142 227 Q129 227 128 209 Z" fill="#7a2e2a" stroke="${INK}" stroke-width="4.4" stroke-linejoin="round"/><ellipse cx="142" cy="222.5" rx="6.5" ry="3.2" fill="#ff8f8f"/>`,
});

/** @param {string} cls @param {Readonly<Record<string, string>>} table */
function variants(cls, table) {
  return `<g class="${cls}">${Object.keys(table).map((v) => `<g data-v="${v}">${table[v]}</g>`).join('')}</g>`;
}

// The figure's own coordinates (its full drawing is 330 x 384); the portrait shows the square 2 8 280 280, so the
// hat, its pin and the shoulders stay inside the ring. The beard is shortened to end above the rim. The shoulders
// are drawn for the crop: the robe's purple reaches up beside the collar (the full figure has its sleeves there),
// and the dark shoulder cape is left out, because in so small a crop it would hide the purple robe.
const FACE = `
<g class="r-bust">
  ${P('M30 310 Q36 242 104 234 Q142 226 180 234 Q248 242 254 310 Z', ROBE)}
  ${L('M62 262 Q74 250 90 246 M222 262 Q210 250 194 246', ROBE_HI, 5)}
  ${P('M110 238 L142 300 L174 238 Q142 228 110 238 Z', '#fffdf4', 5)}
  ${P('M106 236 L140 312 L130 318 L93 244 Z', MANTLE, 5)}${P('M178 236 L144 312 L154 318 L191 244 Z', MANTLE, 5)}
  ${L('M100 242 L135 314 M184 242 L149 314', SILVER, 3.4)}
</g>
<g class="r-head">
  <ellipse cx="142" cy="160" rx="77" ry="74" fill="${HAIR}" stroke="${INK}" stroke-width="6"/>
  <circle cx="70" cy="172" r="12" fill="${SKIN}" stroke="${INK}" stroke-width="5"/><circle cx="214" cy="172" r="12" fill="${SKIN}" stroke="${INK}" stroke-width="5"/>
  ${P('M72 162 Q72 104 142 104 Q212 104 212 162 Q212 204 182 224 Q162 236 142 236 Q122 236 102 224 Q72 204 72 162 Z', SKIN, 5.4)}
  <ellipse cx="96" cy="197" rx="11" ry="6.5" fill="#ff9d8a" opacity=".5"/><ellipse cx="188" cy="197" rx="11" ry="6.5" fill="#ff9d8a" opacity=".5"/>
  ${variants('r-eyes', EYES)}
  ${L('M95 141 Q112 141 130 149', INK, 7, 'r-brow-l')}${L('M153 146 Q170 130 190 135', INK, 7, 'r-brow-r')}
  ${L('M141 186 q-3.4 5 .6 8', SKIN_EDGE, 3.6)}
  ${L('M136 201 Q124 207 113 202 Q107 199 106 192', INK, 5.6)}${L('M148 201 Q160 207 171 202 Q177 199 178 192', INK, 5.6)}
  ${variants('r-mouth', MOUTHS)}
  ${P('M125 231 Q134 252 143 266 Q151 252 159 231 Q142 243 125 231 Z', HAIR, 4)}
  ${P('M72 164 Q66 98 142 96 Q218 98 212 164 Q207 132 184 121 Q160 114 142 132 Q124 114 100 121 Q77 132 72 164 Z', HAIR, 5)}
  ${P('M74 158 Q68 190 80 206 Q82 182 87 166 Z', HAIR, 4)}${P('M210 158 Q216 190 204 206 Q202 182 197 166 Z', HAIR, 4)}
  ${L('M82 102 Q70 132 76 160', ROBE_HI, 7)}${L('M202 102 Q214 132 208 160', ROBE_HI, 7)}
  ${P('M86 110 L96 38 Q142 20 188 38 L198 110 Q142 88 86 110 Z', MANTLE)}
  ${L('M104 46 Q120 38 136 36', '#4a4680', 5)}
  ${P('M120 100 L127 52 H157 L164 100 Q142 93 120 100 Z', ROBE, 5)}${L('M127 96 L132 58 H152 L157 96', GOLD, 3.4)}
  <circle cx="142" cy="74" r="8" fill="#7fe0b8" stroke="#1d7a5c" stroke-width="3.4"/>
  ${L('M70 60 H214', INK, 13)}${L('M70 60 H214', GOLD, 6.5)}<circle cx="69" cy="60" r="7.5" fill="${GOLD}" stroke="${INK}" stroke-width="4"/><circle cx="215" cy="60" r="7.5" fill="${GOLD}" stroke="${INK}" stroke-width="4"/>
  ${P('M82 106 Q142 80 202 106 L203 122 Q142 96 81 122 Z', SILVER, 5)}
</g>`;

/** 司马懿's portrait and name plate. @param {HTMLElement} host @returns {{ set(r:{mood:RivalMood, line?:string}):void, setReducedMotion(on:boolean):void }} */
export function createRivalView(host) {
  const doc = host.ownerDocument;
  let reduced = false;
  /** @type {RivalMood} */ let mood = 'calm';
  /** @type {ReturnType<typeof setTimeout>|null} */ let sayTimer = null;

  const root = doc.createElement('div');
  root.className = 'rival';

  const disc = doc.createElement('span');
  disc.className = 'rival__disc';
  const face = /** @type {SVGSVGElement} */ (doc.createElementNS(SVG_NS, 'svg'));
  face.setAttribute('class', 'rival__face');
  face.setAttribute('viewBox', '2 8 280 280');
  face.setAttribute('role', 'img');
  face.setAttribute('aria-label', '司马懿');
  face.innerHTML = FACE;                                    // static template, numbers only
  const ring = doc.createElement('span');
  ring.className = 'rival__ring';
  const flash = doc.createElement('span');
  flash.className = 'rival__flash';
  disc.append(face, ring, flash);

  const plate = doc.createElement('span');
  plate.className = 'rival__plate';
  const name = doc.createElement('span');
  name.className = 'rival__name';
  name.textContent = '司马懿';
  const title = doc.createElement('span');
  title.className = 'rival__title';
  title.textContent = '魏 · 大都督';
  plate.append(name, title);

  const say = doc.createElement('span');
  say.className = 'rival__say';
  say.hidden = true;
  const line = doc.createElement('span');
  line.className = 'rival__line';
  const dots = doc.createElement('span');
  dots.className = 'rival__dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.hidden = true;
  dots.append(doc.createElement('i'), doc.createElement('i'), doc.createElement('i'));
  say.append(line, dots);

  root.append(disc, plate, say);
  host.append(root);

  const head = /** @type {SVGGElement} */ (face.querySelector('.r-head'));

  /** One-shot motion plays only with full motion: html[data-motion="full"] (as the CSS loops do) and no setReducedMotion(true).
   *  @param {Element} el @param {Keyframe[]} frames @param {KeyframeAnimationOptions} timing */
  function play(el, frames, timing) {
    if (reduced || doc.documentElement.dataset.motion !== 'full' || typeof el.animate !== 'function') return;
    el.animate(frames, timing);
  }

  function paint() {
    root.dataset.mood = mood;
    face.dataset.eyes = MOOD[mood].eyes;
    face.dataset.mouth = MOOD[mood].mouth;
    dots.hidden = mood !== 'thinking';
    say.hidden = line.textContent === '' && dots.hidden;
    root.dataset.say = line.textContent !== '' ? 'line' : dots.hidden ? 'none' : 'dots';       // what the speech tag holds
  }

  function clearLine() {
    if (sayTimer !== null) { clearTimeout(sayTimer); sayTimer = null; }
    line.textContent = '';
  }

  paint();

  return {
    set(r) {
      if (!MOOD[r.mood]) return;
      mood = r.mood;
      if (r.line) {
        clearLine();
        line.textContent = r.line;
        sayTimer = setTimeout(() => { sayTimer = null; line.textContent = ''; paint(); }, SAY_MS);
      }
      paint();
      if (r.line) play(say, [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      if (mood === 'rattled') {
        play(face, [0, -3, 3, -2, 2, 0].map((x) => ({ transform: `translateX(${x}%)` })), { duration: 240, easing: 'linear' });
        play(flash, [{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' });
      } else if (mood === 'smug') {
        play(head, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(0deg)' }], { duration: 400, easing: 'ease-in-out' });
      }
    },
    setReducedMotion(on) {
      reduced = !!on;
      root.classList.toggle('is-still', reduced);
    },
  };
}
