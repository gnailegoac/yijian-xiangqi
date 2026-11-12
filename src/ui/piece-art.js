// @ts-check
/**
 * The 14 soldiers of the sand table (look v2, concept C).
 *
 * A piece is a little figure that holds a big shield; the shield's plate carries the character. The character itself
 * is NOT drawn here: board-view puts it in span.piece__glyph over the plate, whose centre is exactly (50, 72).
 *
 *   pieceArt(color, type) -> '<svg class="piece__art" viewBox="0 0 100 128" aria-hidden="true">…</svg>'
 *
 * The two armies differ by more than hue:
 *   red   (蜀): ROUND shield, light plate, spear / cannon on the right, round caps
 *   black (魏): OCTAGONAL shield, dark plate, spear / cannon on the left, pointed helmets
 *
 * Rules the drawing keeps (dev/pieces.html measures them):
 *   - everything stays inside the 100 x 128 box and nothing is drawn above y = 12, so a piece (also a lifted one)
 *     never hides the character of the piece on the point above it;
 *   - at most 30 elements per piece: the four faces are single paths, pairs of shapes share one path;
 *   - no colour is written here: every shape carries a class (pf-* fill, ps-* stroke, po outline) and
 *     styles/pieces.css maps the classes to custom properties declared on .piece.red / .piece.black.
 */

/** The art box in its own units: 100 units = one cell pitch; the grid point is at (ax, ay). */
export const PIECE_BOX = Object.freeze({ w: 100, h: 128, ax: 50, ay: 72 });

/** @typedef {'red'|'black'} Side */
/** @typedef {'king'|'advisor'|'elephant'|'horse'|'rook'|'cannon'|'pawn'} Kind */
/** @typedef {{ back: string, head: string, front: string, headTf?: string }} Unit */

/** Where the head group's origin sits in the box. Head shapes keep y >= -23.5 there (y >= 13.5 in the box). */
const HEAD_Y = 37;

/** @param {number} x */
const n = (x) => String(Math.round(x * 10) / 10);

/**
 * A closed ellipse as a sub-path, so that two of them can share one element.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} [ry]
 */
function E(cx, cy, rx, ry = rx) {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
}

/**
 * A filled, outlined path.
 * @param {string} d @param {string} fill colour class suffix @param {number} [sw] @param {string} [cls]
 */
const P = (d, fill, sw = 2.6, cls = '') => `<path class="${cls}pf-${fill} po" d="${d}" stroke-width="${sw}"/>`;

/**
 * A filled path without outline.
 * @param {string} d @param {string} fill @param {string} [cls]
 */
const F = (d, fill, cls = '') => `<path class="${cls}pf-${fill}" d="${d}"/>`;

/**
 * A stroked line.
 * @param {string} d @param {string} stroke colour class suffix @param {number} sw @param {string} [cls]
 */
const L = (d, stroke, sw, cls = '') =>
  `<path class="${cls}ps-${stroke}" d="${d}" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * The four faces (six elements). CSS shows one: ev-n unless the piece carries is-scared / is-dizzy / is-happy.
 * @param {number} xl @param {number} xr @param {number} y
 * @param {boolean} [onDark] eyes on the cannon's barrel: white eyeballs, white marks
 */
function eyes(xl, xr, y, onDark = false) {
  /** @param {(cx: number) => string} one */
  const both = (one) => one(xl) + one(xr);
  const mark = onDark ? 'white' : 'out';
  const normal = onDark
    ? P(both((cx) => E(cx, y, 3.2, 3.9)), 'white', 1.2, 'ev ev-n ') + F(both((cx) => E(cx + .9, y + .4, 1.8)), 'out', 'ev ev-n ')
    : F(both((cx) => E(cx, y, 3, 3.7)), 'out', 'ev ev-n ') + F(both((cx) => E(cx - 1, y - 1.4, 1.1)), 'white', 'ev ev-n ');
  return normal
    + P(both((cx) => E(cx, y - .3, 4.1)), 'white', onDark ? 1.2 : 1.5, 'ev ev-s ')
    + F(both((cx) => E(cx, y, onDark ? 1.3 : 1.6)), 'out', 'ev ev-s ')
    + L(both((cx) => `M${n(cx - 3)} ${n(y - 3)}l6 6M${n(cx + 3)} ${n(y - 3)}l-6 6`), mark, 2.2, 'ev ev-d ')
    + L(both((cx) => `M${n(cx - 3.6)} ${n(y + 1.8)}Q${n(cx)} ${n(y - 4.6)} ${n(cx + 3.6)} ${n(y + 1.8)}`), mark, 2.4, 'ev ev-h ');
}

/** A human head that peeks over the shield, in head space. @param {number} [eyeY] */
function human(eyeY = -10.3) {
  return P('M-21 8Q-23.5 -22 0 -22Q23.5 -22 21 8Z', 'skin')
    + F(E(-15.5, -6.2, 4.2, 2.4) + E(15.5, -6.2, 4.2, 2.4), 'blush')
    + eyes(-8, 8, eyeY);
}

const HANDS = P(E(9.5, 76, 5.8) + E(90.5, 76, 5.8), 'skin', 2.4);

/** @param {number} x1 @param {number} x2 @param {string} [fill] */
const feet = (x1, x2, fill = 'shoe') => P(E(x1, 119.5, 9.5, 5.6) + E(x2, 119.5, 9.5, 5.6), fill, 2.2);

/**
 * Two wheels in four elements.
 * @param {number} x1 @param {number} x2 @param {number} y @param {number} r
 */
function wheels(x1, x2, y, r) {
  const d = r * .66, q = d * .7;
  /** @param {(x: number) => string} one */
  const both = (one) => one(x1) + one(x2);
  return P(both((x) => E(x, y, r)), 'woodlo')
    + F(both((x) => E(x, y, r * .7)), 'wood')
    + L(both((x) => `M${n(x - d)} ${n(y)}h${n(2 * d)}M${n(x)} ${n(y - d)}v${n(2 * d)}M${n(x - q)} ${n(y - q)}l${n(2 * q)} ${n(2 * q)}M${n(x + q)} ${n(y - q)}l${n(-2 * q)} ${n(2 * q)}`), 'woodlo', 2)
    + P(both((x) => E(x, y, r * .26)), 'metal', 1.6);
}

/** @param {number} cx @param {number} cy @param {number} R */
function octagon(cx, cy, R) {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = (22.5 + 45 * k) * Math.PI / 180;
    pts.push(`${n(cx + R * Math.cos(a))},${n(cy + R * Math.sin(a))}`);
  }
  return pts.join(' ');
}

/**
 * The shield: edge (its thickness), rim, shine, plate, plate shade, inner ring. Six elements; the plate is empty.
 * @param {Side} color @param {boolean} king the general's rim is gold (red) or silver (black)
 */
function shield(color, king) {
  const rim = king ? 'krim' : 'rim', hi = king ? 'khi' : 'rimhi', edge = king ? 'kedge' : 'edge', ring = king ? 'kring' : 'ring';
  if (color === 'red') {
    return `<circle class="pf-${edge} po" cx="50" cy="79.5" r="40" stroke-width="3"/>`
      + `<circle class="pf-${rim} po" cx="50" cy="72" r="40" stroke-width="3"/>`
      + L('M17.5 59A35.5 35.5 0 0 1 41 37.7', hi, 3.6)
      + `<circle class="pf-plate po" cx="50" cy="72" r="32.5" stroke-width="2"/>`
      + F('M19.5 83A32.5 32.5 0 0 0 80.5 83A48 48 0 0 1 19.5 83Z', 'platelo')
      + `<circle class="ps-${ring}" cx="50" cy="72" r="28" fill="none" stroke-width="1.6"/>`;
  }
  return `<polygon class="pf-${edge} po" points="${octagon(50, 79.5, 43)}" stroke-width="3"/>`
    + `<polygon class="pf-${rim} po" points="${octagon(50, 72, 43)}" stroke-width="3"/>`
    + L('M13.5 62V56.5L33 37', hi, 3.4)
    + `<polygon class="pf-plate po" points="${octagon(50, 72, 35)}" stroke-width="2"/>`
    + F('M18.6 86L35.8 103.3H64.2L81.4 86Z', 'platelo')
    + `<polygon class="ps-${ring}" points="${octagon(50, 72, 30)}" fill="none" stroke-width="1.6" stroke-linejoin="round"/>`;
}

// ---- the seven units: { back (behind the head), head (head space), front (over the shield) } -------------------------

/** @type {Record<Kind, (color: Side) => Unit>} */
const UNIT = {
  /** Foot soldier: a cap (red, round with a knob) or a helmet (black, pointed) and a short spear. */
  pawn(color) {
    const x = color === 'red' ? 91 : 9;
    const back = P(`M${x - 1.6} 119V25h3.2V119Z`, 'wood', 2)
      + P(`M${x} 13.3L${x + 5} 23.5L${x} 27.5L${x - 5} 23.5Z`, 'steel', 2)
      + P(`M${n(x - 4.6)} 29Q${x} 39 ${n(x + 4.6)} 29Z`, 'cloth', 1.8)
      + feet(37, 63);
    const helmet = color === 'red'
      ? P('M-22 -12Q-22 -23.5 0 -23.5Q22 -23.5 22 -12Q0 -18 -22 -12Z', 'cloth')
        + L('M-20 -13.3Q0 -19 20 -13.3', 'metal', 2.4) + P(E(0, -20.6, 2.3), 'metal', 1.6)
      : P('M-22 -12Q-20 -18.5 0 -23.5Q20 -18.5 22 -12Q0 -18 -22 -12Z', 'metallo')
        + L('M-20 -13.3Q0 -19 20 -13.3', 'metal', 2.4) + P('M-3.4 -18.6L0 -23.4L3.4 -18.6Z', 'metal', 1.6);
    return { back, head: human() + helmet, front: HANDS };
  },

  /** Chariot: two big wheels and a low parasol. */
  rook() {
    const canopy = P('M-31 -12.5Q-30 -23.5 0 -23.5Q30 -23.5 31 -12.5Q20.5 -17.5 10.3 -12.5Q0 -17.5 -10.3 -12.5Q-20.5 -17.5 -31 -12.5Z', 'cloth')
      + L('M0 -23Q-6 -18 -10.3 -13.8M0 -23Q6 -18 10.3 -13.8', 'clothlo', 1.6)
      + L('M-30 -13.1Q-20.5 -18.1 -10.3 -13.1Q0 -18.1 10.3 -13.1Q20.5 -18.1 30 -13.1', 'metal', 2.2)
      + P(E(0, -20.6, 2.3), 'metal', 1.6);
    return { back: wheels(16.5, 83.5, 104, 15), head: human(-9.8) + canopy, front: '' };
  },

  /** Horse: ears, forelock, blaze, bridle, tail, hooves. */
  horse() {
    const head = P('M-19 -11L-20.5 -23.3L-8 -17.5ZM19 -11L20.5 -23.3L8 -17.5Z', 'coat')
      + F('M-17.4 -14.5L-18.2 -20L-12.6 -17.2ZM17.4 -14.5L18.2 -20L12.6 -17.2Z', 'earin')
      + P('M-20 8Q-24 -15 -12 -19Q0 -21.5 12 -19Q24 -15 20 8Z', 'coat')
      + F('M-3.4 -19.6Q0 -20.6 3.4 -19.6L2.6 8L-2.6 8Z', 'blaze')
      + L('M-21 -13.6Q0 -19.6 21 -13.6', 'cloth', 3)
      + P(E(0, -16.6, 2.3), 'metal', 1.4)
      + P('M-7.5 -19Q0 -26 8.5 -21Q5 -19 6.2 -13.4Q0 -16.6 -7.5 -19Z', 'mane', 2)
      + eyes(-10, 10, -9.8);
    const back = P('M85 88Q99.5 82 97.5 105Q93.5 97 87 101Z', 'mane', 2.2) + feet(36, 64, 'mane');
    return { back, head, front: '' };
  },

  /** Elephant: big ears, a short trunk over the rim, tusks. */
  elephant() {
    const head = P(E(-28, -8.5, 14.5, 13.5) + E(28, -8.5, 14.5, 13.5), 'hide')
      + F(E(-28.5, -8, 8.2, 8.6) + E(28.5, -8, 8.2, 8.6), 'earin')
      + P('M-19.5 8Q-22 -21 0 -22.3Q22 -21 19.5 8Z', 'hide')
      + P('M-9 -21Q0 -24.4 9 -21L0 -13.6Z', 'cloth', 1.8)
      + F(E(0, -19.3, 2.1), 'metal')
      + eyes(-9.5, 9.5, -10.3);
    const front = P('M36.5 31.5Q34 40.5 39.5 43Q40 36.5 41.4 31.5ZM63.5 31.5Q66 40.5 60.5 43Q60 36.5 58.6 31.5Z', 'ivory', 1.8)
      + P('M44.2 29.5Q43.2 39.5 45 42.7Q50 46.9 55 42.7Q56.8 39.5 55.8 29.5Z', 'hide', 2.2)
      + L('M46.4 34.5h7.2M46.6 39.1h6.8', 'hidelo', 1.3);
    return { back: feet(34, 66, 'hidelo'), head, front };
  },

  /** Guard: the official's hat with two long wings. */
  advisor() {
    const head = human()
      + P('M-18 -15.5Q-33 -22.5 -47 -16Q-33 -9.5 -18 -15.5ZM18 -15.5Q33 -22.5 47 -16Q33 -9.5 18 -15.5Z', 'clothlo', 2.2)
      + L('M-24 -15.6Q-33 -18.6 -42 -16M24 -15.6Q33 -18.6 42 -16', 'metal', 1.6)
      + P('M-10.5 -17Q-10.5 -23.5 0 -23.5Q10.5 -23.5 10.5 -17Z', 'clothlo', 2.4)
      + P('M-20.5 -12Q-20.5 -20 -7 -20.6L7 -20.6Q20.5 -20 20.5 -12Q0 -18 -20.5 -12Z', 'cloth')
      + L('M-19 -13.3Q0 -19 19 -13.3', 'metal', 2.2)
      + P(E(0, -16.4, 2.3), 'metal', 1.5);
    return { back: feet(37, 63), head, front: HANDS };
  },

  /** General: gold (or silver) rim, a cape, a grand helmet. 帥 has a red tuft, 將 two pheasant feathers. */
  king(color) {
    const back = P('M16 62Q-5 92 5 121L33 113ZM84 62Q105 92 95 121L67 113Z', 'cape')
      + L('M6.5 119L31.5 112M93.5 119L68.5 112', 'metal', 2.4)
      + feet(37, 63);
    const dome = 'M-24 -11.5Q-25 -21.3 0 -21.3Q25 -21.3 24 -11.5Q0 -18 -24 -11.5Z';
    const top = color === 'red'
      ? P('M-4 -19.6Q-9.5 -21.6 -3.6 -23.2Q0 -24 3.6 -23.2Q9.5 -21.6 4 -19.6Z', 'cloth', 2)
        + P(dome, 'metal')
        + P('M-27 -9.6Q0 -17.4 27 -9.6L25.5 -13.6Q0 -21 -25.5 -13.6Z', 'cloth', 2)
        + P(E(0, -18.4, 2.4), 'gem', 1.6)
      : P('M-10 -18Q-16 -24.6 -40 -22Q-24 -19.5 -6 -14.5ZM10 -18Q16 -24.6 40 -22Q24 -19.5 6 -14.5Z', 'steel', 2.2)
        + L('M-20 -20.8l-2.4 2.8M-28 -21.8l-2.2 2.6M20 -20.8l2.4 2.8M28 -21.8l2.2 2.6', 'cloth', 2)
        + P(dome, 'cloth')
        + L('M-21.5 -12.9Q0 -19.2 21.5 -12.9', 'metal', 2.4)
        + P('M-4.2 -20.2L0 -23.6L4.2 -20.2Z', 'metal', 1.6)
        + P(E(0, -17.6, 2.5), 'gem', 1.6);
    return { back, head: human() + top, front: HANDS };
  },

  /** Cannon: a chubby barrel with eyes and a lit fuse on small wheels. Red aims right, black aims left. */
  cannon(color) {
    const head = L('M-25 -15Q-31.5 -18 -30 -22', 'woodlo', 2.2)
      + P(E(-24, -9, 5, 7.5), 'ironlo')
      + P('M-24 -16.5H18V-1.5H-24Z', 'iron')
      + P('M-22 -17.1h5v16.2h-5Z', 'band', 1.6)
      + L('M-14 -13.9H11', 'shine', 2)
      + P(E(18, -9, 6.5, 9.2), 'band')
      + F(E(19.2, -9, 3.6, 6.2), 'bore')
      + eyes(-10, 3.5, -11.3, true)
      + P('M-30 -28L-28.6 -24.4L-25 -23L-28.6 -21.6L-30 -18L-31.4 -21.6L-35 -23L-31.4 -24.4Z', 'spark', 1.4)
      + F(E(-30, -23, 1.7), 'white');
    const headTf = `translate(50 ${HEAD_Y})${color === 'black' ? ' scale(-1 1)' : ''} rotate(-12 0 -9)`;
    return { back: wheels(15, 85, 110, 10.5), head, front: '', headTf };
  },
};

/**
 * The picture of one piece, without its character.
 * @param {Side} color
 * @param {Kind} type
 * @returns {string} one root <svg class="piece__art" viewBox="0 0 100 128" aria-hidden="true">
 */
export function pieceArt(color, type) {
  const u = UNIT[type](color);
  return `<svg class="piece__art" viewBox="0 0 ${PIECE_BOX.w} ${PIECE_BOX.h}" aria-hidden="true">${u.back}`
    + `<g transform="${u.headTf ?? `translate(50 ${HEAD_Y})`}">${u.head}</g>${shield(color, type === 'king')}${u.front}</svg>`;
}
