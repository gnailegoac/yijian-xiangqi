// 司马懿's portrait and name plate in the top bar (SPEC §4.28.4, §11.7). Package X5.
//
// createRivalView(host) appends
//   <div class="rival" data-mood data-say="none|line|dots">
//     <span class="rival__disc"> <svg class="rival__face"> … </svg> <span class="rival__ring"> <span class="rival__flash"> </span>
//     <span class="rival__plate"> 司马懿 / 魏 · 大都督 </span>
//     <span class="rival__say"> his spoken line (2.4 s) · three dots while he thinks </span>
//   </div>
// to `host`. The look is in styles/buddy.css. The bust is drawn in the style of 诸葛亮 (§11.2) with a cooler
// palette, an official's cap, a thin moustache and a chin tuft. He is a worthy rival, never a frightening one.
//
// Motion: the one-shot shake, tilt and ring flash play only while html[data-motion="full"] and setReducedMotion(true)
// was not called, so the plate is still even if the stage only switches the attribute (§10.1: still is the default).

/** @import { RivalMood } from '../game/types.js' */

/** @typedef {'narrow'|'side'|'wide'|'happy'} RivalEyes */
/** @typedef {'flat'|'hmm'|'frown'|'o'|'smirk'} RivalMouth */

const SVG_NS = 'http://www.w3.org/2000/svg';

const INK = '#1d2433', SKIN = '#f3dcc6', SKIN_EDGE = '#d9b08c', ROBE = '#2a2f4a', TRIM = '#8a94b8';
const CAP = '#1a1d2b', CAP_BAND = '#3a4266', PIN = '#9cc4a8';

/** How long a spoken line stays (§11.7). */
const SAY_MS = 2400;

/** §11.7: the face of each mood. @type {Readonly<Record<RivalMood, {eyes:RivalEyes, mouth:RivalMouth}>>} */
const MOOD = Object.freeze({
  calm:     { eyes: 'narrow', mouth: 'flat' },
  thinking: { eyes: 'side',   mouth: 'hmm' },
  frown:    { eyes: 'narrow', mouth: 'frown' },
  rattled:  { eyes: 'wide',   mouth: 'o' },
  smug:     { eyes: 'happy',  mouth: 'smirk' },
});

/** @param {number} x */
const n2 = (x) => String(Math.round(x * 100) / 100);
/** Both eyes of one variant: left eye centre x = 47, right x = 73. @param {(cx:number) => string} one */
const eyes = (one) => one(47) + one(73);

/** @type {Readonly<Record<RivalEyes, string>>} */
const EYES = Object.freeze({
  narrow: eyes((cx) => `<path d="M${cx - 5} 52 Q${cx} 49 ${cx + 5} 52" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/><circle cx="${cx + 1}" cy="52.2" r="1.6" fill="${INK}"/>`),
  side: eyes((cx) => `<ellipse cx="${n2(cx + 1.8)}" cy="52.5" rx="3.6" ry="4.8" fill="${INK}"/><circle cx="${n2(cx + 0.8)}" cy="50.8" r="1.3" fill="#fff"/>`),
  wide: eyes((cx) => `<ellipse cx="${cx}" cy="52" rx="5.4" ry="6.8" fill="#fff" stroke="${INK}" stroke-width="1.6"/><circle cx="${cx}" cy="52.5" r="3" fill="${INK}"/><circle cx="${cx - 1}" cy="51.2" r="1" fill="#fff"/>`),
  happy: eyes((cx) => `<path d="M${cx - 5} 54 Q${cx} 46.5 ${cx + 5} 54" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`),
});

const LINE = `fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

/** @type {Readonly<Record<RivalMouth, string>>} */
const MOUTHS = Object.freeze({
  flat: `<path d="M55 67 H65" ${LINE}/>`,
  hmm: `<path d="M56.5 66.2 Q59.5 68 62.5 66.2 T67 65" ${LINE}/>`,
  frown: `<path d="M54 68 Q60 64 66 68" ${LINE}/>`,
  o: `<ellipse cx="60" cy="67" rx="3.2" ry="4.2" fill="#7a2e2a" stroke="${INK}" stroke-width="1.4"/>`,
  smirk: `<path d="M54.5 65.2 Q60.5 69.8 66.5 63.4" ${LINE}/>`,
});

/** @param {string} cls @param {Readonly<Record<string, string>>} table */
function variants(cls, table) {
  return `<g class="${cls}">${Object.keys(table).map((v) => `<g data-v="${v}">${table[v]}</g>`).join('')}</g>`;
}

const FACE = `
<g class="r-bust">
  <path d="M30 133 Q24 98 40 84 Q60 74 80 84 Q96 98 90 133 Z" fill="${ROBE}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M40 84 Q34 104 33 133" fill="none" stroke="${TRIM}" stroke-width="3" stroke-linecap="round"/>
  <path d="M80 84 Q86 104 87 133" fill="none" stroke="${TRIM}" stroke-width="3" stroke-linecap="round"/>
  <path d="M36 133 Q33 100 43 85 Q60 77 77 85 Q87 100 84 133 Z" fill="${ROBE}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M49 82 L62.5 106 L58 108 L45 85.5 Z" fill="${TRIM}"/>
  <path d="M71 82 L55 109 L59.5 111 L75 85.5 Z" fill="${TRIM}"/>
</g>
<g class="r-head">
  <ellipse cx="60" cy="50" rx="32.5" ry="31.5" fill="${INK}"/>
  <circle cx="31.5" cy="56" r="4.6" fill="${SKIN}" stroke="${SKIN_EDGE}"/><circle cx="88.5" cy="56" r="4.6" fill="${SKIN}" stroke="${SKIN_EDGE}"/>
  <circle cx="60" cy="52" r="29" fill="${SKIN}" stroke="${SKIN_EDGE}"/>
  <path d="M34 30 Q36 6 60 4 Q84 6 86 30 Q72 24 60 24 Q48 24 34 30 Z" fill="${CAP}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M34 30 Q60 20 86 30 L86 35 Q60 25 34 35 Z" fill="${CAP_BAND}" stroke="${INK}"/>
  <path d="M30 22 H90" fill="none" stroke="${PIN}" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="30" cy="22" r="2.4" fill="${PIN}"/><circle cx="90" cy="22" r="2.4" fill="${PIN}"/>
  <ellipse cx="40" cy="61" rx="5.2" ry="3.1" fill="#ff9d8a" opacity=".3"/><ellipse cx="80" cy="61" rx="5.2" ry="3.1" fill="#ff9d8a" opacity=".3"/>
  <path class="r-brow-l" d="M42 40.5 L51 38.6" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
  <path class="r-brow-r" d="M69 38.6 L78 40.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
  ${variants('r-eyes', EYES)}
  <path d="M53 62 Q57 64 59.5 62.5" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M60.5 62.5 Q63 64 67 62" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
  ${variants('r-mouth', MOUTHS)}
  <path d="M58.5 76 L60 82 L61.5 76 Z" fill="${INK}"/>
  <path class="r-sweat" d="M90 33 Q94.5 40 90 43.5 Q85.5 40 90 33 Z" fill="#8fd3ff" stroke="#3b8fc4" stroke-width="1"/>
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
  face.setAttribute('viewBox', '10 2 100 100');
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
