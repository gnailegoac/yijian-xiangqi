// 弈间: the sand table (look v2, "concept C"). The board art of one theme, drawn on the game's own geometry.
//
// tableArt() returns the children of svg.bv-art (viewBox 0 0 920 1060, 100 units per cell). Every colour comes
// from a class of styles/table.css, so one markup serves the three themes. Nothing stands on the playing field
// but the grid: the frame, the sand, the palace floors and the river are flat, and no element is animated.

import { VIEW_W, VIEW_H, PITCH, X0, Y0, fileLabels } from './geometry.js';

/** @param {number} vx  view column 0..8 */
const X = (vx) => X0 + PITCH * vx;
/** @param {number} vy  view row 0..9 */
const Y = (vy) => Y0 + PITCH * vy;
/** @param {number} n  a coordinate, written with at most two decimals */
const f = (n) => String(Math.round(n * 100) / 100);

// The sand box inside the wooden frame: the rails are 16 units at the sides and 27 at the top and bottom (the file
// labels sit in those). EDGE is half of the sand's outline, so the visible sand starts at IN_X / IN_Y.
const SAND_X = 16, SAND_Y = 27, SAND_W = VIEW_W - 2 * SAND_X, SAND_H = VIEW_H - 2 * SAND_Y;
const EDGE = 2.5;
const IN_X = SAND_X + EDGE, IN_Y = SAND_Y + EDGE, IN_W = SAND_W - 2 * EDGE, IN_H = SAND_H - 2 * EDGE;
// The river leaves 11 units of sand between itself and the two rows it separates.
const RIVER_T = Y(4) + 11, RIVER_B = Y(5) - 11, RIVER_MID = (RIVER_T + RIVER_B) / 2;

/** The carved grid: ten rows, nine files (only the edge files cross the river) and the palace diagonals. */
const GRID_D = (() => {
  let d = '';
  for (let r = 0; r < 10; r++) d += `M${X(0)} ${Y(r)}H${X(8)}`;
  for (let c = 0; c < 9; c++) d += c === 0 || c === 8 ? `M${X(c)} ${Y(0)}V${Y(9)}` : `M${X(c)} ${Y(0)}V${Y(4)}M${X(c)} ${Y(5)}V${Y(9)}`;
  for (const r of [0, 7]) d += `M${X(3)} ${Y(r)}L${X(5)} ${Y(r + 2)}M${X(5)} ${Y(r)}L${X(3)} ${Y(r + 2)}`;
  return d;
})();

/** The corner ticks at the starting points of the cannons and the soldiers. */
const MARKS_D = (() => {
  let d = '';
  for (const [c, r] of [[1, 2], [7, 2], [1, 7], [7, 7], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue;
      d += `M${X(c) + sx * 9} ${Y(r) + sy * 24}V${Y(r) + sy * 9}H${X(c) + sx * 24}`;
    }
  }
  return d;
})();

/** Ripples in the middle of some cells (never on a line, the river or a palace floor): a dark and a light stroke. */
const RIPPLES = (() => {
  let lo = '', hi = '';
  for (let r = 0; r < 9; r++) for (let c = 0; c < 8; c++) {
    if (r === 4 || (c * 3 + r * 5) % 4 !== 0) continue;
    if (c >= 2 && c <= 5 && (r <= 2 || r >= 6)) continue;                       // a palace floor reaches into these cells
    const x = X(c) + 50 + ((c * 7 + r * 3) % 5 - 2) * 3, y = Y(r) + 50 + ((c * 5 + r * 11) % 5 - 2) * 3;
    lo += `M${x - 22} ${y + 4}q11 -7 22 0t22 0`;
    hi += `M${x - 22} ${y}q11 -7 22 0t22 0`;
  }
  return { lo, hi };
})();

/** The river of blue sand: a band with wavy banks from one side of the sand box to the other, foam and small waves. */
const RIVER = (() => {
  const x0 = SAND_X + 2, x1 = VIEW_W - SAND_X - 2, amp = 4.5;
  const n = Math.round((x1 - x0) / 46), step = (x1 - x0) / (2 * n), h = f(step / 2), s = f(step);
  const fwd = `q${h} ${-amp} ${s} 0q${h} ${amp} ${s} 0`.repeat(n);
  const back = `q-${h} ${amp} -${s} 0q-${h} ${-amp} -${s} 0`.repeat(n);
  let waves = '';
  for (const [x, y] of [[95, 23], [143, 57], [257, 69], [395, 21], [373, 61], [520, 65], [541, 21], [665, 71], [785, 25], [817, 59], [872, 39], [22, 47]]) {
    waves += `M${x} ${RIVER_T + y}q7 -6 14 0q7 6 14 0`;
  }
  return { body: `M${x0} ${RIVER_T}${fwd}L${x1} ${RIVER_B}${back}Z`, foam: `M${x0} ${RIVER_T + 8}${fwd}`, waves };
})();

/** The four gold corner fittings of the frame as one shape, its highlight and its rivets. */
const FITTINGS = (() => {
  let body = '', shine = '', rivets = '';
  for (const mx of [false, true]) for (const my of [false, true]) {
    /** @param {number} x @param {number} y  a point of the top-left fitting, mirrored into this corner */
    const p = (x, y) => `${mx ? VIEW_W - x : x} ${my ? VIEW_H - y : y}`;
    body += `M${p(3, 66)}L${p(3, 33)}Q${p(3, 3)} ${p(33, 3)}L${p(44, 3)}L${p(44, 27)}L${p(34, 27)}Q${p(16, 27)} ${p(16, 45)}L${p(16, 66)}Z`;
    shine += `M${p(8.5, 60)}L${p(8.5, 34)}Q${p(8.5, 8.5)} ${p(34, 8.5)}L${p(39, 8.5)}`;
    rivets += `M${p(9.5, 57)}h.01M${p(37, 16)}h.01`;
  }
  return { body, shine, rivets };
})();

/** The joints of the frame's rails (the knots of the bamboo in 隆中): short strokes between the files and rows. */
const JOINTS_D = (() => {
  let d = '';
  for (let c = 0; c < 8; c++) d += `M${X(c) + 50} 7V23M${X(c) + 50} ${VIEW_H - 23}V${VIEW_H - 7}`;
  for (let r = 0; r < 9; r++) d += `M6.5 ${Y(r) + 50}H13M${VIEW_W - 13} ${Y(r) + 50}H${VIEW_W - 6.5}`;
  return d;
})();

/** Pebbles in the side margins, outside the grid: [cx, cy, rx, ry]. */
const PEBBLES = (() => {
  /** @param {number} cx @param {number} cy @param {number} rx @param {number} ry */
  const oval = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
  let lo = '', hi = '';
  for (const [cx, cy, rx, ry] of [[36, 330, 7, 5], [886, 230, 8, 5.5], [34, 882, 6, 4.5], [888, 742, 7, 5]]) {
    lo += oval(cx, cy, rx, ry);
    hi += oval(cx - 2, cy - 2, rx * .65, ry * .6);
  }
  return { lo, hi };
})();

/**
 * One palace: the floor (half a cell around its nine points, out to the edge of the sand) and the joints of its tiles.
 * @param {boolean} top  the palace at the top edge
 * @param {'red'|'black'} color  the side that owns it
 */
function palace(top, color) {
  const x = X(3) - 50, y0 = top ? IN_Y : Y(7) - 50, y1 = top ? Y(2) + 50 : IN_Y + IN_H;
  const rows = top ? [Y(0) + 50, Y(1) + 50] : [Y(7) + 50, Y(8) + 50];
  // tiles one cell wide, laid like bricks; the joints of the middle band would lie under the files, so it has none
  const d = `M${x} ${rows[0]}h300M${x} ${rows[1]}h300`
    + `M${X(3) + 50} ${y0}V${rows[0]}M${X(4) + 50} ${y0}V${rows[0]}M${X(3) + 50} ${rows[1]}V${y1}M${X(4) + 50} ${rows[1]}V${y1}`;
  return `<rect class="tb-floor tb-floor--${color}" x="${x}" y="${y0}" width="300" height="${y1 - y0}"/>`
    + `<path class="tb-tiles tb-tiles--${color}" d="${d}"/>`;
}

/** @param {number} x  the plank bridge that carries an edge file over the river */
const bridge = (x) => `<rect class="tb-plank" x="${x - 15}" y="${Y(4) + 1}" width="30" height="98" rx="5"/>`;

/**
 * The board art of the sand table.
 * @param {'chibi'|'longzhong'|'shachang'} theme
 * @param {'red'|'black'} bottom  the side at the bottom
 * @param {number} id  unique number for ids inside <defs>
 * @returns {string} the CHILDREN of the board's <svg class="bv-art" viewBox="0 0 920 1060"> (no <svg> wrapper)
 */
export function tableArt(theme, bottom, id) {
  const labels = fileLabels(bottom);                       // the only source of file labels
  const top = bottom === 'red' ? 'black' : 'red';
  const xs = Array.from({ length: 9 }, (_, vx) => X(vx)).join(' ');
  const dots = 'stroke-linecap="round" fill="none"';

  let s = '<defs>'
    + `<linearGradient id="tbw${id}" x1="0" y1="0" x2="0" y2="1"><stop class="tb-stop-wa" offset="0"/><stop class="tb-stop-wb" offset="1"/></linearGradient>`
    + `<linearGradient id="tbs${id}" x1="0" y1="0" x2="1" y2="1"><stop class="tb-stop-sa" offset="0"/><stop class="tb-stop-sb" offset=".55"/><stop class="tb-stop-sc" offset="1"/></linearGradient>`
    + `<linearGradient id="tbr${id}" x1="0" y1="0" x2="0" y2="1"><stop class="tb-stop-ra" offset="0"/><stop class="tb-stop-rb" offset="1"/></linearGradient>`
    + `<linearGradient id="tbt${id}" x1="0" y1="0" x2="0" y2="1"><stop class="tb-stop-sh" offset="0" stop-opacity=".42"/><stop class="tb-stop-sh" offset="1" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="tbl${id}" x1="0" y1="0" x2="1" y2="0"><stop class="tb-stop-sh" offset="0" stop-opacity=".32"/><stop class="tb-stop-sh" offset="1" stop-opacity="0"/></linearGradient>`
    + `<pattern id="tbg${id}" width="58" height="58" patternUnits="userSpaceOnUse">`
    + `<path class="tb-grain-lo" ${dots} d="M8 11h.01M47 27h.01M39 49h.01M54 8h.01"/><path class="tb-grain-hi" ${dots} d="M33 6h.01M20 34h.01M9 50h.01"/></pattern>`
    + '</defs>';

  // the table: the frame, its inner light edge, the gold fittings, the file labels in the rails
  s += `<rect class="tb-frame" x="3" y="3" width="${VIEW_W - 6}" height="${VIEW_H - 6}" rx="30" fill="url(#tbw${id})"/>`;
  s += `<rect class="tb-frame-hi" x="8.5" y="8.5" width="${VIEW_W - 17}" height="${VIEW_H - 17}" rx="25"/>`;
  if (theme === 'longzhong') s += `<path class="tb-joints" d="${JOINTS_D}"/>`;
  s += `<path class="tb-fit" d="${FITTINGS.body}"/><path class="tb-fit-hi" d="${FITTINGS.shine}"/><path class="tb-fit-dot" ${dots} d="${FITTINGS.rivets}"/>`;
  // one <text> per edge: the list of x values places each label on its own file; dy centres the glyphs on y
  s += `<text class="bv-label" x="${xs}" y="15" dy=".36em">${labels.top.join('')}</text><text class="bv-label" x="${xs}" y="1044" dy=".36em">${labels.bottom.join('')}</text>`;

  // the sand: its box, the grain, the shade of the rails at the top and left, ripples
  s += `<rect class="tb-sand" x="${SAND_X}" y="${SAND_Y}" width="${SAND_W}" height="${SAND_H}" rx="14" fill="url(#tbs${id})"/>`;
  s += `<rect x="${IN_X}" y="${IN_Y}" width="${IN_W}" height="${IN_H}" rx="11" fill="url(#tbg${id})"/>`;
  s += `<rect x="${IN_X}" y="${IN_Y}" width="${IN_W}" height="34" rx="11" fill="url(#tbt${id})"/>`;
  s += `<rect x="${IN_X}" y="${IN_Y}" width="26" height="${IN_H}" rx="11" fill="url(#tbl${id})"/>`;
  s += `<path class="tb-ripple-lo" d="${RIPPLES.lo}"/><path class="tb-ripple-hi" d="${RIPPLES.hi}"/>`;
  s += `<path class="tb-pebble-lo" d="${PEBBLES.lo}"/><path class="tb-pebble-hi" d="${PEBBLES.hi}"/>`;

  // the palace floors, coloured by their side
  s += palace(true, top) + palace(false, bottom);

  // the river
  s += `<path class="tb-river" d="${RIVER.body}" fill="url(#tbr${id})"/>`;
  s += `<path class="tb-foam" d="${RIVER.foam}"/><path class="tb-waves" d="${RIVER.waves}"/>`;
  if (theme === 'chibi') {
    // the moon on the water: a ladder of light between 楚河 and 汉界, where no file crosses
    s += `<path class="tb-moon" d="M436 ${RIVER_MID - 21}h44M428 ${RIVER_MID - 11}h30m12 0h26M444 ${RIVER_MID - 1}h40M438 ${RIVER_MID + 9}h14m10 0h22M452 ${RIVER_MID + 19}h20"/>`;
  }
  s += bridge(X(0)) + bridge(X(8));
  s += `<path class="tb-plank-line" d="${[X(0), X(8)].map((x) => [17, 33, 50, 67, 83].map((dy) => `M${x - 15} ${Y(4) + dy}h30`).join('')).join('')}"/>`;
  s += `<text class="bv-rivertext" x="${X(1) + 50} ${X(2) + 50}" y="${RIVER_MID}" dy=".36em">楚河</text>`
    + `<text class="bv-rivertext" x="${X(5) + 50} ${X(6) + 50}" y="${RIVER_MID}" dy=".36em">汉界</text>`;

  // the carved grid: a lit lower lip, then the groove, the thick outer border and the starting marks
  if (theme === 'chibi') s += `<path class="tb-glow" d="${GRID_D}"/>`;
  s += `<path class="tb-grid-hi" d="${GRID_D}" transform="translate(0 3)"/>`;
  s += `<path class="tb-grid" d="${GRID_D}"/>`;
  s += `<rect class="tb-border" x="${X(0)}" y="${Y(0)}" width="${8 * PITCH}" height="${9 * PITCH}"/>`;
  s += `<path class="tb-marks" d="${MARKS_D}"/>`;
  return s;
}
