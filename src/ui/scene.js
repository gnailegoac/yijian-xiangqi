// @ts-check
// The scene behind the whole game: sky, sun or moon, clouds, far hills, the two camps, grass.
// One <div class="scene"> of inline SVG and plain elements, styled by styles/scene.css. No bitmap, no id.
//
//   const scene = createScene(document.body, { theme: 'shachang', reducedMotion: false });
//   scene.setTheme('chibi');   scene.destroy();
//
// Three pictures: shachang = the sunny camp, chibi = the same camp at night, longzhong = a bamboo grove in mist.
// Every loop is a CSS animation on a direct HTML child or a root <svg> (never inside an <svg>), and runs only under
// html[data-motion="full"]; opts.reducedMotion puts data-still on the scene, which switches every loop off.

/** @typedef {'chibi'|'longzhong'|'shachang'} SceneTheme */

/** @type {ReadonlyArray<SceneTheme>} */
const THEMES = ['chibi', 'longzhong', 'shachang'];

/**
 * @typedef {Object} Palette
 * @property {string} cloudHi  @property {string} cloudLo
 * @property {string} far      @property {string} cap
 * @property {string} hill     @property {string} hillEdge
 * @property {string} rim
 * @property {string} tuft     @property {string} tuftEdge
 * @property {string} patch
 * @property {string} tent     @property {string} tentEdge   @property {string} door
 * @property {string} orbHi    @property {string} orbLo
 */

/** @type {Record<SceneTheme, Palette>} */
const PAL = {
  shachang: {
    cloudHi: '#ffffff', cloudLo: '#cfeaff', far: '#7cc4ea', cap: '#eaf8ff', hill: '#58c064', hillEdge: '#2f8a48',
    rim: '#86dc76', tuft: '#2f9150', tuftEdge: '#236b3c', patch: '#9be88a',
    tent: '#fff6e0', tentEdge: '#2f6a3c', door: '#2f6a3c', orbHi: '#fff3a0', orbLo: '#ffe36a',
  },
  chibi: {
    cloudHi: '#5a6cc4', cloudLo: '#4354a6', far: '#2a3f8e', cap: '#5a72c8', hill: '#1f7a62', hillEdge: '#0e4444',
    rim: '#2f8f6c', tuft: '#1a6a58', tuftEdge: '#0e4444', patch: '#3fa67a',
    tent: '#ffe9b8', tentEdge: '#1a3a4a', door: '#ffb347', orbHi: '#fff4c2', orbLo: '#f2dc8c',
  },
  longzhong: {
    cloudHi: '#ffffff', cloudLo: '#e3f3e6', far: '#a5d6c6', cap: '#c9eadc', hill: '#7fd08a', hillEdge: '#4a9e62',
    rim: '#bfeab0', tuft: '#4fb06a', tuftEdge: '#34844c', patch: '#d6f4c4',
    tent: '#fff3d6', tentEdge: '#6a4a2a', door: '#6a4a2a', orbHi: '#fff6cc', orbLo: '#ffe9a0',
  },
};

const INK = '#3a1f0c';
const BLUE = '#4a6bd0';
const RED = '#ee4a32';

const FAR_PEAKS = 'M-10 150 L50 86 L96 118 L160 62 L232 126 L300 96 L372 140 L480 120 L600 142 L720 110 L800 136 L880 78 L950 122 L1020 70 L1100 118 L1150 92 L1190 124 V176 H-10 Z';
const FAR_CAPS = 'M160 62 L182 82 L170 80 L160 90 L150 80 L138 82 Z M880 78 L900 96 L888 94 L880 104 L870 94 L858 98 Z M1020 70 L1040 88 L1028 86 L1020 96 L1010 86 L998 90 Z M50 86 L66 100 L56 99 L50 107 L43 99 L34 102 Z';
const FAR_SOFT = 'M-10 150 Q60 84 150 112 Q230 64 330 114 Q420 88 520 126 Q640 74 760 120 Q850 80 960 112 Q1060 66 1190 122 V176 H-10 Z';
const FAR_SOFT_2 = 'M-10 160 Q110 112 240 140 Q360 106 470 142 Q600 120 700 146 Q830 104 940 138 Q1060 112 1190 144 V176 H-10 Z';
const HILL_L = 'M-10 150 Q90 96 210 132 Q290 152 380 128 Q470 108 560 138 Q580 146 600 156 V182 H-10 Z';
const HILL_R = 'M580 156 Q590 147 600 142 Q720 104 840 132 Q930 150 1010 122 Q1100 96 1190 132 V182 H580 Z';
const RIM = 'M-10 147 Q90 139 210 149 Q290 153 380 146 Q470 141 560 149 Q720 141 840 148 Q930 152 1010 145 Q1100 140 1190 148';

/** @param {string} cls @param {Palette} p */
const cloud = (cls, p) => `<svg class="scene__cloud ${cls}" viewBox="-68 -48 136 64">`
  + `<path d="M-52 14 Q-66 14 -64 0 Q-62 -14 -46 -12 Q-42 -32 -20 -30 Q-8 -46 12 -36 Q32 -44 40 -24 Q62 -26 62 -6 Q64 14 46 14 Z" fill="${p.cloudHi}"/>`
  + `<path d="M-52 14 Q-66 14 -64 2 Q-40 10 0 8 Q40 6 62 -2 Q64 14 46 14 Z" fill="${p.cloudLo}"/></svg>`;

/** @param {number} x @param {number} y @param {number} s @param {string} col @param {Palette} p */
const tent = (x, y, s, col, p) => `<g transform="translate(${x} ${y}) scale(${s})">`
  + `<path d="M-16 0 Q-6 -14 0 -26 Q6 -14 16 0 Z" fill="${p.tent}" stroke="${p.tentEdge}" stroke-width="2.4" stroke-linejoin="round"/>`
  + `<path d="M-5 -15 Q-2 -21 0 -26 Q2 -21 5 -15 Q0 -12 -5 -15 Z" fill="${col}"/><path d="M-3 0 Q0 -10 3 0 Z" fill="${p.door}"/></g>`;

/** A pole; with a colour it also carries a small still pennant. dir: 1 = cloth to the right, -1 = to the left.
 *  @param {number} x @param {number} y @param {number} h @param {string} col @param {number} dir */
const pole = (x, y, h, col, dir) => `<path d="M${x} ${y} V${y - h}" stroke="#5a3a1c" stroke-width="2.4" stroke-linecap="round"/>`
  + (col ? `<path d="M${x} ${y - h} L${x + 14 * dir} ${y - h + 5} L${x} ${y - h + 10} Z" fill="${col}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` : '');

/** The waving cloth of a camp's tall flag: its own root <svg>, so it may loop. @param {string} col @param {number} dir */
const flag = (col, dir) => `<svg class="scene__flag" viewBox="${dir > 0 ? -2 : -22} -2 24 18">`
  + `<path d="M0 0 L${20 * dir} 7 L0 14 Z" fill="${col}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

/** @param {number} x @param {number} y @param {number} s @param {Palette} p */
const tuft = (x, y, s, p) => `<path transform="translate(${x} ${y}) scale(${s})" d="M-9 0 q2 -12 5 -2 q2 -16 5 -1 q3 -11 6 3 Z" fill="${p.tuft}" stroke="${p.tuftEdge}" stroke-width="1.4" stroke-linejoin="round"/>`;

/** @param {number} x @param {number} y @param {string} col */
const flower = (x, y, col) => `<g transform="translate(${x} ${y})"><circle cx="-3.4" r="2.8" fill="${col}"/><circle cx="3.4" r="2.8" fill="${col}"/>`
  + `<circle cy="-3.4" r="2.8" fill="${col}"/><circle cy="3.4" r="2.8" fill="${col}"/><circle r="2" fill="#ffd43b"/></g>`;

/** @param {number} x @param {number} y */
const firefly = (x, y) => `<circle cx="${x}" cy="${y}" r="8" fill="#ffe680" opacity=".22"/><circle cx="${x}" cy="${y}" r="2.6" fill="#fff3a0"/>`;

/** A lantern on a pole with a soft glow. @param {number} x @param {number} y @param {number} dir */
const lantern = (x, y, dir) => `<g transform="translate(${x} ${y}) scale(${dir} 1)">`
  + `<path d="M0 0 V-62 H16 V-54" fill="none" stroke="#2a1a14" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<circle cx="16" cy="-40" r="30" fill="#ffb347" opacity=".2"/><circle cx="16" cy="-40" r="19" fill="#ffc86a" opacity=".28"/>`
  + `<ellipse cx="16" cy="-40" rx="10" ry="13" fill="#ff7a3d" stroke="#5a1a10" stroke-width="2.4"/><ellipse cx="16" cy="-40" rx="4.4" ry="9" fill="#ffe08a"/>`
  + `<path d="M16 -27 V-19" stroke="#ffd43b" stroke-width="2.6" stroke-linecap="round"/></g>`;

/** A thatched cottage (longzhong). @param {number} x @param {number} y @param {number} s */
const cottage = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#6a4a2a" stroke-width="2.4" stroke-linejoin="round">`
  + `<path d="M-19 0 V-14 H19 V0 Z" fill="#fff3d6"/><path d="M-27 -11 L-13 -30 H13 L27 -11 Z" fill="#e6b864"/>`
  + `<path d="M-17 -22 H17 M-21 -16 H21" fill="none" stroke="#b98a3c" stroke-width="1.6"/><path d="M-4 0 V-9 H4 V0 Z" fill="#6a4a2a"/></g>`;

/** A small pavilion (longzhong). @param {number} x @param {number} y @param {number} s */
const pavilion = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke-linejoin="round" stroke-linecap="round">`
  + `<path d="M-11 -16 V0 M11 -16 V0" stroke="#8a4a2a" stroke-width="3"/><path d="M-16 0 H16" stroke="#6a4a2a" stroke-width="3"/>`
  + `<path d="M-24 -17 Q-11 -20 0 -34 Q11 -20 24 -17 Q10 -14 0 -14 Q-10 -14 -24 -17 Z" fill="#d8604a" stroke="#5a2a1a" stroke-width="2.4"/></g>`;

/** One bamboo leaf from (x, y), turned by rot degrees. @param {number} x @param {number} y @param {number} rot @param {number} s @param {string} col */
const leaf = (x, y, rot, s, col) => `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 0 Q15 -7 34 0 Q15 6 0 0 Z" fill="${col}" stroke="#2f7d4f" stroke-width="1.4" stroke-linejoin="round"/>`;

/** One bamboo stalk from the bottom (x0) to the top (x1) of an 820 high box, with its joints.
 *  @param {number} x0 @param {number} x1 @param {number} w @param {number} phase @param {string} col */
function stalk(x0, x1, w, phase, col) {
  let joints = '';
  for (let y = 60 + phase; y < 820; y += 132) {
    const x = x0 + (x1 - x0) * (1 - y / 820);
    joints += `M${(x - w / 2 - 1).toFixed(1)} ${y} h${w + 2} `;
  }
  return `<path d="M${x0} 830 L${x1} -10" stroke="#2f7d4f" stroke-width="${w + 4}"/><path d="M${x0} 830 L${x1} -10" stroke="${col}" stroke-width="${w}"/>`
    + `<path d="${joints}" stroke="#2f7d4f" stroke-width="2.6" stroke-linecap="round"/>`;
}

/** The decoration on the grass at one side. side: 'l' or 'r'. @param {SceneTheme} theme @param {'l'|'r'} side @param {Palette} p */
function decor(theme, side, p) {
  const left = side === 'l';
  const tufts = left
    ? [[36, 250], [150, 300], [20, 470], [178, 520], [60, 640], [160, 730], [24, 790], [250, 420], [236, 690]]
    : [[930, 300], [1150, 350], [1010, 520], [1160, 610], [905, 690], [1120, 770], [960, 250], [1060, 400]];
  const spots = left
    ? [[70, 320], [130, 460], [30, 560], [186, 610], [100, 800]]
    : [[960, 420], [1140, 480], [1060, 640], [1165, 720], [915, 790]];
  let out = left
    ? `<g opacity=".5" fill="${p.patch}"><ellipse cx="90" cy="420" rx="120" ry="30"/><ellipse cx="80" cy="720" rx="110" ry="26"/></g>`
    : `<g opacity=".5" fill="${p.patch}"><ellipse cx="1080" cy="560" rx="130" ry="34"/><ellipse cx="1090" cy="260" rx="90" ry="20"/></g>`;
  tufts.forEach(([x, y], i) => { out += tuft(x, y, 1 + (i % 3) * 0.2, p); });
  if (theme === 'chibi') {
    spots.forEach(([x, y]) => { out += firefly(x, y - 14); });
    out += left ? lantern(34, 392, 1) + lantern(206, 706, -1) : lantern(1146, 430, -1) + lantern(968, 742, 1);
  } else {
    spots.forEach(([x, y], i) => { out += flower(x, y, i % 2 ? '#ffe0ea' : '#ffffff'); });
  }
  return `<svg class="scene__decor scene__decor--${side}" viewBox="${left ? 0 : 880} 150 300 670">${out}</svg>`;
}

/** The camp on its green hill at one side. @param {SceneTheme} theme @param {'l'|'r'} side @param {Palette} p */
function camp(theme, side, p) {
  const left = side === 'l';
  let things;
  if (theme === 'longzhong') {
    things = left ? cottage(128, 127, 1) + cottage(176, 134, 0.7) : pavilion(1046, 126, 1) + cottage(996, 134, 0.7);
  } else if (left) {
    things = tent(120, 128, 0.9, BLUE, p) + tent(160, 134, 0.7, BLUE, p) + pole(88, 126, 40, '', 1) + pole(196, 132, 24, BLUE, 1);
  } else {
    things = tent(1040, 128, 0.9, RED, p) + tent(1000, 134, 0.7, RED, p) + pole(1080, 126, 40, '', -1) + pole(968, 132, 24, RED, -1);
  }
  if (theme === 'chibi') {
    const x = left ? 140 : 1020;
    things += `<circle cx="${x}" cy="124" r="30" fill="#ffb347" opacity=".14"/>`;
  }
  return `<div class="scene__camp scene__camp--${side}">`
    + `<svg class="scene__hill" viewBox="${left ? 0 : 590} 56 590 116"><path d="${left ? HILL_L : HILL_R}" fill="${p.hill}" stroke="${p.hillEdge}" stroke-width="3"/>${things}</svg>`
    + (theme === 'longzhong' ? '' : flag(left ? BLUE : RED, left ? 1 : -1))
    + '</div>';
}

/** Stars as percentages of the sky box, so they stay round at every window shape. */
function stars() {
  const at = [[4, 14, 2.2], [9, 46, 1.6], [15, 24, 2.8], [21, 62, 1.6], [27, 10, 2], [33, 38, 1.6], [39, 20, 2.6], [45, 52, 1.6], [51, 12, 2],
    [57, 34, 2.8], [63, 58, 1.6], [69, 18, 2], [75, 44, 1.6], [80, 66, 2.2], [93, 52, 2.6], [97, 16, 1.8], [12, 76, 1.8], [49, 78, 1.6], [70, 80, 2]];
  return `<svg class="scene__stars">${at.map(([x, y, r]) => `<circle cx="${x}%" cy="${y}%" r="${r + 0.6}" fill="${r > 2.4 ? '#fff3b0' : '#e6ecff'}"/>`).join('')}</svg>`;
}

/** Bamboo (longzhong): three stalks down each side and a spray of leaves hanging into each top corner. @param {'l'|'r'} side */
function bamboo(side) {
  const flip = side === 'l' ? '' : ' transform="translate(120 0) scale(-1 1)"';
  const flipTop = side === 'l' ? '' : ' transform="translate(250 0) scale(-1 1)"';
  const A = '#6cc878', B = '#4fb267';
  const stalks = stalk(18, 24, 13, 0, A) + stalk(52, 44, 9, 50, B) + stalk(80, 90, 7, 96, A)
    + leaf(24, 300, 24, 1.2, B) + leaf(24, 300, -18, 1, A) + leaf(46, 470, 150, 1.1, A) + leaf(22, 610, 30, 1.2, A) + leaf(22, 610, -12, 1, B) + leaf(86, 400, 20, 0.9, B);
  const spray = '<path d="M-6 16 Q78 22 168 54 M-6 62 Q54 70 108 100" fill="none" stroke="#3f8f50" stroke-width="3" stroke-linecap="round"/>'
    + leaf(28, 19, 62, 1.2, A) + leaf(54, 23, 98, 1.1, B) + leaf(80, 29, 54, 1.25, A) + leaf(106, 36, 102, 1.1, A) + leaf(132, 44, 66, 1.2, B)
    + leaf(166, 53, 38, 1.2, A) + leaf(166, 53, 104, 1.1, B) + leaf(22, 66, 70, 1.1, B) + leaf(48, 72, 110, 1, A) + leaf(76, 84, 58, 1.15, A)
    + leaf(106, 99, 92, 1.1, B) + leaf(106, 99, 34, 1.1, A);
  return `<svg class="scene__bamboo scene__bamboo--${side}" viewBox="0 0 120 820" preserveAspectRatio="none"><g${flip} fill="none">${stalks}</g></svg>`
    + `<svg class="scene__leaves scene__leaves--${side}" viewBox="0 0 250 150"><g${flipTop}>${spray}</g></svg>`;
}

/** The whole picture of one theme, as the scene's inner markup. @param {SceneTheme} theme */
function picture(theme) {
  const p = PAL[theme];
  const night = theme === 'chibi', grove = theme === 'longzhong';
  const orb = night
    ? `<circle r="36" fill="${p.orbHi}"/><circle cx="-12" cy="-10" r="7" fill="${p.orbLo}"/><circle cx="12" cy="8" r="9" fill="${p.orbLo}"/><circle cx="-6" cy="16" r="4.5" fill="${p.orbLo}"/><circle cx="14" cy="-16" r="3.5" fill="${p.orbLo}"/>`
    : `<circle r="38" fill="${p.orbHi}"/>`;
  const far = grove
    ? `<path d="${FAR_SOFT}" fill="${p.far}"/><path d="${FAR_SOFT_2}" fill="#8fcab0"/>`
    : `<path d="${FAR_PEAKS}" fill="${p.far}"/><path d="${FAR_CAPS}" fill="${p.cap}"/>`;
  return (night ? '<div class="scene__fire"></div>' + stars() : '')
    + '<div class="scene__halo"></div>'
    + `<svg class="scene__orb" viewBox="-40 -40 80 80">${orb}</svg>`
    + cloud('scene__cloud--a', p) + cloud('scene__cloud--b', p) + cloud('scene__cloud--c', p)
    + `<svg class="scene__far" viewBox="0 56 1180 116" preserveAspectRatio="xMidYMax slice">${far}</svg>`
    + (grove ? '<div class="scene__mist scene__mist--a"></div>' : '')
    + camp(theme, 'l', p) + camp(theme, 'r', p)
    + '<div class="scene__ground"></div>'
    + `<svg class="scene__rim" viewBox="0 138 1180 18" preserveAspectRatio="none"><path d="${RIM} V158 H-10 Z" fill="${p.rim}"/>`
    + `<path d="${RIM}" fill="none" stroke="${p.hillEdge}" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`
    + decor(theme, 'l', p) + decor(theme, 'r', p)
    + (grove ? '<div class="scene__mist scene__mist--b"></div>' + bamboo('l') + bamboo('r') : '<div class="scene__valance"></div>');
}

/** @param {unknown} theme @returns {SceneTheme} */
function known(theme) {
  return THEMES.find((t) => t === theme) || 'chibi';
}

/**
 * Builds the scene and inserts it as the first child of host.
 * @param {HTMLElement} host  the scene is inserted as the FIRST child of host
 * @param {{ theme: 'chibi'|'longzhong'|'shachang', reducedMotion: boolean }} opts
 * @returns {{ el: HTMLElement, setTheme(theme: 'chibi'|'longzhong'|'shachang'): void, destroy(): void }}
 */
export function createScene(host, opts) {
  const el = document.createElement('div');
  el.className = 'scene';
  el.setAttribute('aria-hidden', 'true');
  if (opts.reducedMotion) el.setAttribute('data-still', '');
  /** @type {SceneTheme | ''} */
  let current = '';

  /** @param {'chibi'|'longzhong'|'shachang'} theme */
  function setTheme(theme) {
    const next = known(theme);
    if (next === current) return;
    current = next;
    el.setAttribute('data-theme', next);
    el.innerHTML = picture(next);
  }

  setTheme(opts.theme);
  host.insertBefore(el, host.firstChild);
  return { el, setTheme, destroy() { el.remove(); } };
}
