// Board view (SPEC §4.28.1; DOM, visual states, input: §10.2; choreography: §10.3). Package X2.
//
// createBoardView(host, deps) turns `host` into the .bv element (§10.2.4) and returns the BoardView controller.
// The view holds no game rules: it draws the position it is given, shows the marks it is told to show, plays the
// choreography of a move it is handed, and reports what the child touched.
//
// Events on `host` (bubbling CustomEvents): board:pick {row, col, via:'tap'|'drag'|'key'},
// board:dragcancel {row, col}, board:cellfocus {row, col}.
//
// How the animation code is organised (§10.2.6):
//   - Movement is FLIP on two nested elements: the outer .piece owns the translation across the board, the inner
//     .piece__body owns lift, scale and rotation, .piece__shadow mirrors the lift.
//   - Every choreography writes the final position first (grid, cells, piece records) and then animates towards it.
//     Steps that must happen later are scheduled on a timeline; a step marked `keep` is a state change and still
//     runs (without animation) when the timeline is flushed, an effect step is dropped.
//   - cancelAnimations() flushes the timelines, finishes every tracked animation, removes transient nodes, calls
//     fx.clear() and resolves the pending promises, so nothing in flight can touch a newer position.
//   - Loops (ring rotation, hover bob, pulses, river drift) are CSS keyframes that run only under
//     html[data-motion="full"] (styles/board.css); the one-shot choreography here is WAAPI and follows the
//     view's own reducedMotion flag. The stage sets both together.

/** @import { Board, Color, Move, Piece, PieceType, Square } from '../core/types.js' */
/** @import { MoveFlags } from '../game/types.js' */
/** @import { Actor, Arrow, AudioEngine, BoardView, Fx, Highlight, Pt, SfxName, ThemeId } from './types.js' */

import { pieceLabel } from '../core/engine.js';
import { VIEW_W, VIEW_H, PITCH, X0, Y0, crossesRiver, fileLabels, fromView, horseLeg, pxPoint, toView, viewPoint } from './geometry.js';
import { pieceArt } from './piece-art.js';
import { tableArt } from './table-art.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The easings of styles/tokens.css, as literals for Element.animate. */
const EASE = Object.freeze({
  out: 'cubic-bezier(.2,.8,.2,1)',
  in: 'cubic-bezier(.6,0,.9,.4)',
  inout: 'cubic-bezier(.65,0,.35,1)',
  back: 'cubic-bezier(.34,1.56,.64,1)',
  slam: 'cubic-bezier(.5,0,.1,1)',
});

/**
 * Table B of §10.3. ms: duration from the travel distance d in cells; ease: easing of the outer element;
 * body: keyframes [offset, lift in c (up is positive), scale, rotation in degrees].
 * @type {Readonly<Record<PieceType, {ms:(d:number) => number, ease:string, body:number[][]}>>}
 */
const MOVE_STYLE = Object.freeze({
  rook:     { ms: (d) => 150 + 28 * d, ease: EASE.slam,  body: [[0, 0, 1.06, 0], [0.85, 0, 1.06, 0], [0.93, 0, 0.95, 0], [1, 0, 1, 0]] },
  horse:    { ms: () => 340,           ease: EASE.inout, body: [[0, 0, 1, 0], [0.55, 0.50, 1.18, 0], [0.92, 0, 0.97, 0], [1, 0, 1, 0]] },
  cannon:   { ms: (d) => 170 + 30 * d, ease: EASE.inout, body: [[0, 0, 1.04, -5], [0.4, 0, 1.04, 5], [0.8, 0, 1.02, -3], [1, 0, 1, 0]] },
  elephant: { ms: () => 320,           ease: EASE.inout, body: [[0, 0, 1, 0], [0.5, 0.35, 1.14, 0], [0.9, 0, 0.94, 0], [1, 0, 1, 0]] },
  advisor:  { ms: () => 150,           ease: EASE.out,   body: [[0, 0, 1.04, 0], [1, 0, 1, 0]] },
  king:     { ms: () => 320,           ease: EASE.inout, body: [[0, 0, 1, 0], [0.5, 0.08, 1.10, 0], [1, 0, 1, 0]] },
  pawn:     { ms: () => 210,           ease: EASE.out,   body: [[0, 0, 1, 0], [0.5, 0.18, 1.08, 0], [1, 0, 1, 0]] },
});

/** The high arc of the cannon after its shot (C-cannon, t = 260 ms). */
const CANNON_ARC = [[0, 0, 1, 0], [0.5, 0.6, 1.15, 0], [1, 0, 1, 0]];

/** Table C: `s`, the victim's scale for particles and sound. @type {Readonly<Record<PieceType, number>>} */
const VICTIM_SCALE = Object.freeze({ pawn: 0.6, advisor: 0.8, elephant: 0.8, horse: 1, cannon: 1, rook: 1.25, king: 1.4 });

/** Table C: how long the victim's own animation runs, by attacker. @type {Readonly<Record<PieceType, number>>} */
const VICTIM_MS = Object.freeze({ rook: 200, horse: 200, cannon: 120, elephant: 220, advisor: 220, king: 220, pawn: 160 });

const GOLD = '#ffd166';
const DEFAULT_GUARD_MS = 200;

/** @param {number} col */
const X = (col) => X0 + PITCH * col;
/** @param {number} row */
const Y = (row) => Y0 + PITCH * row;
/** @param {number} n */
const f1 = (n) => Math.round(n * 10) / 10;
/** @param {Square|null|undefined} a @param {Square|null|undefined} b */
const same = (a, b) => !!a && !!b && a.row === b.row && a.col === b.col;
/** @param {Square} sq */
const code2 = (sq) => `${sq.row}${sq.col}`;
/** @param {Color} color @returns {Color} */
const other = (color) => (color === 'red' ? 'black' : 'red');

/**
 * @template {keyof SVGElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string|number>} [attrs]
 * @returns {SVGElementTagNameMap[K]}
 */
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  return node;
}

/** @param {string} cls @returns {HTMLDivElement} */
function div(cls) {
  const node = document.createElement('div');
  node.className = cls;
  return node;
}

// ---- board art: the table is drawn by table-art.js and a piece by piece-art.js (the skin) ------------------------

/** Counts the views of the page; it makes the ids of masks unique. */
let instances = 0;

/**
 * @param {HTMLElement} host   empty element; becomes .bv
 * @param {{ fx:Fx, audio:AudioEngine, bottom?:Color, theme?:ThemeId, reducedMotion?:boolean }} deps
 * @returns {BoardView}
 */
export function createBoardView(host, deps) {
  /** @typedef {{id:string, type:PieceType, color:Color, row:number, col:number, el:HTMLElement, body:HTMLElement, shadow:HTMLElement, moving:Animation[]}} Rec */
  /** @typedef {{at:(ms:number, fn:(live:boolean) => void, keep?:boolean) => void, done:(ms:number) => Promise<void>, flush:() => void}} Timeline */
  /** @typedef {{promise:Promise<void>, resolve:() => void}} Deferred */
  /**
   * @typedef {{rec:Rec, move:Move, aim:boolean, built:boolean, ghost:HTMLElement|null, ring:SVGElement|null, trail:SVGPathElement|null,
   *            reticle:SVGElement|null, tag:HTMLElement|null, landAt:number, guardMs:number, tl:Timeline}} Trial
   */
  /** @typedef {{actor:Actor, mult:number, flags:MoveFlags, soft:boolean, lead:number, confirm:boolean, cap:number}} MoveOpts */

  const { fx, audio } = deps;
  const root = document.documentElement;
  const uid = `${++instances}`;

  /** @type {Color} */
  let bottom = deps.bottom ?? 'red';
  /** @type {ThemeId} */
  let theme = deps.theme ?? 'chibi';
  let reduced = !!deps.reducedMotion;
  let interactive = true;
  let destroyed = false;
  let c = 0;                                               // cell pitch in CSS px
  let tension = 0;
  let artSeq = 0;
  let labels = fileLabels(bottom);

  /** @type {Map<string, Rec>} */
  const recs = new Map();
  /** The committed position: grid[row][col]. @type {(Rec|null)[][]} */
  const grid = Array.from({ length: 10 }, () => /** @type {(Rec|null)[]} */ (Array(9).fill(null)));

  /** @type {{sq:Square, targets:Move[], forbidden:Move[]}|null} */
  let selection = null;
  /** Signature of the selection marks that are drawn (null = must redraw). @type {string|null} */
  let selSig = '';
  /** @type {Trial|null} */
  let trial = null;
  /** @type {{move:Move, actor:Actor}|null} */
  let lastMove = null;
  /** @type {{color:Color, checkers:Square[]}|null} */
  let check = null;
  /**
   * One group of arrows. timers: the intervals of the demo ghosts; ttl: the timeout that clears the group (0 = none);
   * until: when that timeout is due (performance.now() scale).
   * @typedef {{arrows:Arrow[], nodes:Element[], ghosts:HTMLElement[], timers:number[], ttl:number, until:number}} ArrowGroup
   */
  /** @type {Map<string, ArrowGroup>} */
  const arrowGroups = new Map();
  /** @type {{spec:Highlight, nodes:Element[], timer:number}|null} */
  let hl = null;
  /** @type {{restore:() => void}|null} */
  let preview = null;
  /** @type {Square|null} */
  let focusSq = null;
  let focusTouched = false;

  /** @type {Set<Animation>} */
  const anims = new Set();
  /** @type {Set<Element>} */
  const transients = new Set();
  /** @type {Set<Timeline>} */
  const timelines = new Set();
  /** @type {Set<Deferred>} */
  const deferreds = new Set();
  let busyCount = 0;

  // ---- DOM (§10.2.4) -----------------------------------------------------------------------------------------------

  /** @param {string} cls */
  const layerSvg = (cls) => svgEl('svg', { class: cls, viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, 'aria-hidden': 'true' });
  /** @param {SVGSVGElement} parent @param {string} cls */
  const group = (parent, cls) => { const g = svgEl('g', { class: cls }); parent.append(g); return g; };

  let art = layerSvg('bv-art');
  const glow = div('bv-glow');
  const deco = div('bv-deco');
  const river = div('bv-river');
  const riverInner = document.createElement('i');
  river.append(riverInner);
  const vignette = div('bv-tension');
  const edge = div('bv-edge');
  const marks = layerSvg('bv-marks');
  const piecesEl = div('bv-pieces');
  const over = layerSvg('bv-over');
  const veil = div('bv-veil');
  const fxEl = div('bv-fx');
  const hit = div('bv-hit');
  const announce = div('sr-only');

  const gLast = group(marks, 'bv-g-last');
  const gSel = group(marks, 'bv-g-sel');
  const gTrial = group(marks, 'bv-g-trial');
  const gMisc = group(marks, 'bv-g-misc');
  const gSelOver = group(over, 'bv-g-sel');
  const gTrialOver = group(over, 'bv-g-trial');
  const gCheck = group(over, 'bv-g-check');
  const gHl = group(over, 'bv-g-hl');
  const gArrows = group(over, 'bv-g-arrows');
  const gTop = group(over, 'bv-g-top');

  for (const node of [glow, deco, river, vignette, edge, piecesEl, veil, fxEl]) node.setAttribute('aria-hidden', 'true');
  hit.setAttribute('role', 'group');
  hit.setAttribute('aria-label', '棋盘');
  announce.id = 'board-announcement';
  announce.setAttribute('role', 'status');
  announce.setAttribute('aria-live', 'polite');

  /** The 90 hit cells in view order (top-left to bottom-right). @type {HTMLButtonElement[]} */
  const cellEls = [];
  for (let vy = 0; vy < 10; vy++) {
    for (let vx = 0; vx < 9; vx++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'board-cell';
      cell.tabIndex = -1;
      cell.style.setProperty('--vx', String(vx));
      cell.style.setProperty('--vy', String(vy));
      cell.dataset.piece = '';
      hit.append(cell);
      cellEls.push(cell);
    }
  }

  host.classList.add('bv', 'is-interactive');
  host.dataset.bottom = bottom;
  host.dataset.theme = theme;
  host.replaceChildren(art, glow, deco, river, vignette, edge, marks, piecesEl, over, veil, fxEl, hit, announce);

  // ---- small helpers -------------------------------------------------------------------------------------------------

  /** Centre of a square in CSS px relative to the host. @param {Square} sq @returns {Pt} */
  const px = (sq) => pxPoint(sq, bottom, c);
  /** Centre of a square in viewBox units. @param {Square} sq */
  const pt = (sq) => viewPoint(sq, bottom);
  /** @param {Square} sq */
  const cellAt = (sq) => { const { vx, vy } = toView(sq, bottom); return cellEls[vy * 9 + vx]; };
  /** @param {string} name */
  const token = (name) => getComputedStyle(host).getPropertyValue(name).trim();
  /**
   * Body and rim colour of a side, for the particles of its captured piece. Black gives the light stop of its body
   * (--blk-a): the middle stop --blk-b is as dark as the 赤壁 field, where its debris could not be seen.
   * @param {Color} color
   */
  const sideColors = (color) => (color === 'red' ? [token('--red-b'), token('--red-rim')] : [token('--blk-a'), token('--blk-rim')]);
  /** @param {SfxName} name @param {{when?:number, ms?:number, scale?:number, gain?:number, step?:number}} [opts] */
  const play = (name, opts) => audio.play(name, opts);
  /** @param {PieceType} type */
  const moveSound = (type) => /** @type {SfxName} */ (`move.${type}`);
  /** @param {{from:Square, to:Square}} move */
  const dist = (move) => Math.hypot(move.to.row - move.from.row, move.to.col - move.from.col);
  /** The factor by which an ancestor transform scales the board on screen (compact sheet, the mate zoom). */
  const screenScale = () => (host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth : 1) || 1;

  /** @param {string} type @param {{row:number, col:number, via?:'tap'|'drag'|'key'}} detail */
  function emit(type, detail) {
    host.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  }

  function measure() {
    const w = parseFloat(getComputedStyle(host).width) || host.clientWidth;      // fractional, and not changed by a transform
    const next = Math.round(w / 9.2 * 100) / 100;
    if (next !== c) {
      c = next;
      host.style.setProperty('--c', `${c}px`);
    }
    fx.resize(w, host.clientHeight, c);
  }

  // ---- animation bookkeeping (§10.2.6) -----------------------------------------------------------------------------------

  /**
   * Element.animate, registered for cancelAnimations() (and visible to fx.hitStop through getAnimations()).
   * @param {Element} node @param {Keyframe[]|PropertyIndexedKeyframes} frames @param {KeyframeAnimationOptions} opts
   */
  function anim(node, frames, opts) {
    const a = node.animate(frames, opts);
    anims.add(a);
    const forget = () => { anims.delete(a); };
    a.finished.then(forget, forget);
    return a;
  }

  /** Resolves when every animation of the list has finished or was cancelled. @param {Animation[]} list @returns {Promise<void>} */
  function settled(list) {
    return Promise.allSettled(list.map((a) => a.finished)).then(() => {});
  }

  /** @param {Element} node */
  function removeNode(node) {
    transients.delete(node);
    node.remove();
  }

  /**
   * Plays an exit animation on a node and removes the node when it ends (at once under cancelAnimations()).
   * @param {Element} node @param {Keyframe[]|PropertyIndexedKeyframes} frames @param {KeyframeAnimationOptions} opts
   */
  function exit(node, frames, opts) {
    transients.add(node);
    const a = anim(node, frames, { ...opts, fill: 'forwards' });
    const done = () => removeNode(node);
    a.finished.then(done, done);
    return a;
  }

  /** Fades a node out and removes it; with ms = 0 it is removed at once (callers pass 0 under reduced motion). @param {Element} node @param {number} ms */
  function fadeOut(node, ms) {
    if (ms <= 0 || !node.isConnected) { removeNode(node); return; }
    exit(node, { opacity: [getComputedStyle(node).opacity, '0'] }, { duration: ms, easing: EASE.out });
  }

  /** @returns {Deferred} */
  function deferred() {
    /** @type {() => void} */
    let release = () => {};
    /** @type {Promise<void>} */
    const promise = new Promise((resolve) => { release = resolve; });
    /** @type {Deferred} */
    const d = { promise, resolve: () => { deferreds.delete(d); release(); } };
    deferreds.add(d);
    return d;
  }

  /**
   * A list of timed steps. `keep` steps are state changes: when the timeline is flushed they still run, with
   * live = false (no animation, no sound). Effect steps are dropped by a flush.
   * @returns {Timeline}
   */
  function timeline() {
    /** @type {{timer:number, fn:(live:boolean) => void, keep:boolean, ran:boolean}[]} */
    const items = [];
    let dead = false;
    /** @type {Timeline} */
    const tl = {
      at(ms, fn, keep = false) {
        if (dead) { if (keep) fn(false); return; }
        const item = { timer: 0, fn, keep, ran: false };
        item.timer = window.setTimeout(() => {
          item.ran = true;
          fn(true);
          if (items.every((it) => it.ran)) timelines.delete(tl);
        }, Math.max(0, ms));
        items.push(item);
        timelines.add(tl);
      },
      done(ms) {
        return new Promise((resolve) => { tl.at(ms, () => resolve(), true); });
      },
      flush() {
        if (dead) return;
        dead = true;
        timelines.delete(tl);
        for (const item of items) {
          window.clearTimeout(item.timer);
          if (!item.ran) {
            item.ran = true;
            if (item.keep) item.fn(false);
          }
        }
      },
    };
    return tl;
  }

  /** html[data-ui-busy="1"] while the promise is pending. @param {Promise<void>} promise @returns {Promise<void>} */
  function busy(promise) {
    busyCount++;
    root.dataset.uiBusy = '1';
    const end = () => { if (--busyCount <= 0) { busyCount = 0; delete root.dataset.uiBusy; } };
    return promise.then(end, end);
  }

  function cancelAnimations() {
    if (drag) endDrag(false, true);
    if (preview) preview.restore();
    for (const tl of [...timelines]) tl.flush();
    for (const a of [...anims]) {
      try { a.finish(); } catch { a.cancel(); }
    }
    anims.clear();
    for (const rec of recs.values()) if (rec.moving.length) stopMoving(rec);
    for (const node of [...transients]) node.remove();
    transients.clear();
    for (const d of [...deferreds]) d.resolve();
    if (trial) trial.landAt = Math.min(trial.landAt, performance.now());
    host.style.transformOrigin = '';
    fx.clear();
  }

  // ---- pieces --------------------------------------------------------------------------------------------------------

  /** @param {Piece} piece @returns {Rec} */
  function createRec(piece) {
    const el = div(`piece ${piece.color}`);
    el.dataset.id = piece.id;
    el.dataset.type = piece.type;
    el.dataset.color = piece.color;
    const shadow = div('piece__shadow');
    const body = div('piece__body');
    body.innerHTML = pieceArt(piece.color, piece.type);     // the soldier, a static template: no external data
    const glyph = document.createElement('span');
    glyph.className = 'piece__glyph';
    glyph.textContent = pieceLabel(piece);                  // the character stays HTML text on the shield's plate
    body.append(glyph);
    el.append(shadow, body);
    piecesEl.append(el);
    /** @type {Rec} */
    const rec = { id: piece.id, type: piece.type, color: piece.color, row: 0, col: 0, el, body, shadow, moving: [] };
    recs.set(piece.id, rec);
    return rec;
  }

  /** WRITE: --vx / --vy and data-row / data-col of a piece element. @param {{row:number, col:number, el:HTMLElement}} rec @param {Square} sq */
  function seat(rec, sq) {
    const { vx, vy } = toView(sq, bottom);
    rec.row = sq.row;
    rec.col = sq.col;
    rec.el.style.setProperty('--vx', String(vx));
    rec.el.style.setProperty('--vy', String(vy));
    rec.el.dataset.row = String(sq.row);
    rec.el.dataset.col = String(sq.col);
  }

  /** @param {Rec} rec */
  function stopMoving(rec) {
    const list = rec.moving;
    rec.moving = [];
    for (const a of list) a.cancel();
    rec.el.style.zIndex = '';
    rec.el.style.willChange = '';
    rec.el.classList.remove('is-moving');
  }

  /** Puts a piece on a square with no animation. @param {Rec} rec @param {Square} sq @param {() => void} [restyle] */
  function snap(rec, sq, restyle) {
    stopMoving(rec);
    rec.el.style.translate = '';
    rec.el.classList.remove('is-dragging');
    restyle?.();
    seat(rec, sq);
  }

  /** Back to a plain resting piece (classes, inline styles, the 试 tag). @param {Rec} rec */
  function resetRec(rec) {
    stopMoving(rec);
    rec.el.className = `piece ${rec.color}`;
    rec.el.style.translate = '';
    rec.el.style.removeProperty('--hover-delay');
    rec.el.style.removeProperty('--lean');
    rec.body.querySelector('.piece__tag')?.remove();
  }

  /** @param {Color} color @returns {Rec|null} */
  function findKing(color) {
    for (const rec of recs.values()) if (rec.type === 'king' && rec.color === color) return rec;
    return null;
  }

  /** A ghost copy of a piece on a square: no data-id, never part of the position. @param {Rec} rec @param {Square} sq @param {string} cls */
  function makeGhost(rec, sq, cls) {
    const el = /** @type {HTMLElement} */ (rec.el.cloneNode(true));
    el.className = `piece ${rec.color} is-ghost ${cls}`.trim();
    el.removeAttribute('data-id');
    el.removeAttribute('style');
    el.querySelector('.piece__tag')?.remove();
    seat({ row: 0, col: 0, el }, sq);
    return el;
  }

  /** Diffs the pieces by id against a board and snaps them (the hard sync of setPosition, also the end of an undo). @param {Board} board */
  function sync(board) {
    const seen = new Set();
    for (const row of grid) row.fill(null);
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 9; col++) {
        const piece = board[row]?.[col];
        if (!piece) continue;
        let rec = recs.get(piece.id);
        if (rec && (rec.type !== piece.type || rec.color !== piece.color)) {
          rec.el.remove();
          recs.delete(piece.id);
          rec = undefined;
        }
        rec ??= createRec(piece);
        resetRec(rec);
        if (!rec.el.isConnected) piecesEl.append(rec.el);
        seat(rec, { row, col });
        grid[row][col] = rec;
        seen.add(piece.id);
      }
    }
    for (const [id, rec] of [...recs]) {
      if (!seen.has(id)) { rec.el.remove(); recs.delete(id); }
    }
    for (const node of [...piecesEl.children]) {
      const id = /** @type {HTMLElement} */ (node).dataset.id;
      if (!id || recs.get(id)?.el !== node) node.remove();          // ghosts, victims in mid-fade
    }
    refreshCells();
  }

  // ---- hit cells ---------------------------------------------------------------------------------------------------------

  function mapCells() {
    for (let vy = 0; vy < 10; vy++) {
      for (let vx = 0; vx < 9; vx++) {
        const sq = fromView(vx, vy, bottom);
        const cell = cellEls[vy * 9 + vx];
        cell.dataset.row = String(sq.row);
        cell.dataset.col = String(sq.col);
      }
    }
  }

  /** @param {HTMLElement} cell @returns {Square} */
  const cellSquare = (cell) => ({ row: Number(cell.dataset.row), col: Number(cell.dataset.col) });

  /** aria-label of a cell, e.g. 红方炮，二路，第8行，可走. @param {Square} sq @param {boolean} legal */
  function cellLabel(sq, legal) {
    const rec = grid[sq.row][sq.col];
    const { vx } = toView(sq, bottom);
    // The file is named as the piece's own side counts it; an empty point as the child's side (the bottom) counts it.
    const file = ((rec ? rec.color : bottom) === bottom ? labels.bottom : labels.top)[vx];
    const what = rec ? `${rec.color === 'red' ? '红方' : '黑方'}${pieceLabel(rec)}` : '空位';
    return `${what}，${file}路，第${sq.row + 1}行${legal ? '，可走' : ''}`;
  }

  /** Keeps data-piece, the own-piece mark, aria-label, aria-pressed and the roving tabindex of every cell in step. */
  function refreshCells() {
    if (!focusTouched || !focusSq) {
      const king = findKing(bottom);
      focusSq = king ? { row: king.row, col: king.col } : focusSq ?? fromView(4, 9, bottom);
    }
    const legal = new Set(selection ? selection.targets.map((m) => code2(m.to)) : []);
    for (const cell of cellEls) {
      const sq = cellSquare(cell);
      const rec = grid[sq.row][sq.col];
      const id = rec ? rec.id : '';
      if (cell.dataset.piece !== id) cell.dataset.piece = id;
      cell.classList.toggle('is-mine', !!rec && rec.color === bottom);
      const label = cellLabel(sq, legal.has(code2(sq)));
      if (cell.getAttribute('aria-label') !== label) cell.setAttribute('aria-label', label);
      const pressed = !!selection && same(selection.sq, sq);
      if (pressed) cell.setAttribute('aria-pressed', 'true'); else cell.removeAttribute('aria-pressed');
      cell.tabIndex = same(focusSq, sq) ? 0 : -1;
      if (interactive) cell.removeAttribute('aria-disabled'); else cell.setAttribute('aria-disabled', 'true');
    }
  }

  /** @param {string[]} names */
  function clearCellClasses(...names) {
    for (const cell of cellEls) cell.classList.remove(...names);
  }

  // ---- marks: shapes -----------------------------------------------------------------------------------------------------

  /** Four corner brackets around a point, as path data. @param {{x:number, y:number}} p @param {number} half @param {number} arm */
  function bracketPath(p, half, arm) {
    let d = '';
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) d += `M${p.x + half * sx} ${p.y + (half - arm) * sy}V${p.y + half * sy}H${p.x + (half - arm) * sx}`;
    }
    return d;
  }

  /** g.bv-reticle: the capture brackets at +-46 units, arm 16 (§10.2.4). @param {Square} sq @param {string} cls */
  function reticle(sq, cls) {
    const g = svgEl('g', { class: cls });
    g.append(svgEl('path', { d: bracketPath(pt(sq), 46, 16) }));
    return g;
  }

  /**
   * The drawn path of a move in viewBox units: straight, through the leg square with a rounded corner, or a
   * quadratic arc. startGap / endGap are the distances kept from the two square centres.
   * @param {Square} from @param {Square} to @param {'line'|'leg'|'arc'} kind @param {number} startGap @param {number} endGap @param {number} bulge
   * @returns {{d:(endCut?:number) => string, tip:{x:number, y:number}, ux:number, uy:number}}
   *   d(endCut): the path, optionally ending endCut units before the tip; (ux, uy): unit direction at the tip
   */
  function movePath(from, to, kind, startGap, endGap, bulge) {
    const a = pt(from), b = pt(to);
    /** @param {number} x @param {number} y */
    const unit = (x, y) => { const len = Math.hypot(x, y) || 1; return { x: x / len, y: y / len }; };
    const leg = kind === 'leg' ? horseLeg(from, to) : null;
    if (leg) {
      const l = pt(leg);
      const u1 = unit(l.x - a.x, l.y - a.y), u2 = unit(b.x - l.x, b.y - l.y);
      const tip = { x: b.x - endGap * u2.x, y: b.y - endGap * u2.y };
      return {
        d: (cut = 0) => `M${f1(a.x + startGap * u1.x)} ${f1(a.y + startGap * u1.y)}L${f1(l.x - 25 * u1.x)} ${f1(l.y - 25 * u1.y)}`
          + `Q${l.x} ${l.y} ${f1(l.x + 25 * u2.x)} ${f1(l.y + 25 * u2.y)}L${f1(tip.x - cut * u2.x)} ${f1(tip.y - cut * u2.y)}`,
        tip, ux: u2.x, uy: u2.y,
      };
    }
    const u = unit(b.x - a.x, b.y - a.y);
    if (kind === 'arc') {
      // The control point is the midpoint pushed out perpendicular to the shot: upwards on screen, or towards the middle for a vertical shot.
      let n = { x: u.y, y: -u.x };
      if (Math.abs(n.y) < 0.01 ? (n.x > 0) === (a.x >= VIEW_W / 2) : n.y > 0) n = { x: -n.x, y: -n.y };
      const ctrl = { x: (a.x + b.x) / 2 + bulge * n.x, y: (a.y + b.y) / 2 + bulge * n.y };
      const t0 = unit(ctrl.x - a.x, ctrl.y - a.y), t1 = unit(b.x - ctrl.x, b.y - ctrl.y);
      const tip = { x: b.x - endGap * t1.x, y: b.y - endGap * t1.y };
      return {
        d: (cut = 0) => `M${f1(a.x + startGap * t0.x)} ${f1(a.y + startGap * t0.y)}Q${f1(ctrl.x)} ${f1(ctrl.y)} ${f1(tip.x - cut * t1.x)} ${f1(tip.y - cut * t1.y)}`,
        tip, ux: t1.x, uy: t1.y,
      };
    }
    const tip = { x: b.x - endGap * u.x, y: b.y - endGap * u.y };
    return {
      d: (cut = 0) => `M${f1(a.x + startGap * u.x)} ${f1(a.y + startGap * u.y)}L${f1(tip.x - cut * u.x)} ${f1(tip.y - cut * u.y)}`,
      tip, ux: u.x, uy: u.y,
    };
  }

  /**
   * Gives a path the dotted look (dash 2 12) in a way that can be drawn from its start with stroke-dashoffset:
   * n dots followed by one long gap; shifting the pattern by n periods hides them all.
   * @param {SVGPathElement} path @returns {number} the offset at which nothing shows
   */
  function dotted(path) {
    const len = Math.ceil(path.getTotalLength()) + 16;
    const n = Math.max(1, Math.ceil(len / 14));
    path.style.strokeDasharray = `${'2 12 '.repeat(n - 1)}2 ${12 + len}`;
    return n * 14;
  }

  // ---- marks: selection (A1 - A4) ------------------------------------------------------------------------------------------

  /** @param {boolean} animate  false = old marks vanish at once */
  function renderSelection(animate) {
    for (const rec of recs.values()) {
      rec.el.classList.toggle('is-selected', !!selection && !trial && rec.row === selection.sq.row && rec.col === selection.sq.col);
    }
    const sig = selection
      ? `${bottom}${code2(selection.sq)}|${selection.targets.map((m) => code2(m.to) + (m.captured ? 'x' : '')).join()}|${selection.forbidden.map((m) => code2(m.to)).join()}`
      : '';
    if (sig === selSig) return;
    selSig = sig;
    for (const g of [gSel, gSelOver]) {
      for (const node of [...g.children]) {
        if (animate && !reduced) fadeOut(node, 100); else removeNode(node);
      }
    }
    clearCellClasses('is-selected', 'is-legal', 'is-capture', 'is-forbidden');
    if (selection) {
      const { sq, targets, forbidden } = selection;
      const o = pt(sq);
      gSel.append(svgEl('circle', { class: 'bv-selring', cx: o.x, cy: o.y, r: 51 }));
      cellAt(sq).classList.add('is-selected');
      /** @param {Square} to  A3: the delay grows with the Chebyshev distance from the origin, capped at 144 ms */
      const order = (to) => `--i:${Math.min(9, Math.max(Math.abs(to.row - sq.row), Math.abs(to.col - sq.col)))}`;
      for (const move of targets) {
        const p = pt(move.to);
        const cell = cellAt(move.to);
        cell.classList.add('is-legal');
        if (move.captured) {
          cell.classList.add('is-capture');
          gSelOver.append(reticle(move.to, 'bv-reticle'));
        } else {
          gSel.append(svgEl('circle', { class: 'bv-dot', cx: p.x, cy: p.y, r: 13, style: order(move.to) }));
        }
      }
      for (const move of forbidden) {
        const p = pt(move.to);
        cellAt(move.to).classList.add('is-forbidden');
        const g = svgEl('g', { class: 'bv-forbid', style: order(move.to) });
        g.append(svgEl('circle', { class: 'bv-dot', cx: p.x, cy: p.y, r: 13 }), svgEl('line', { class: 'bv-bar', x1: p.x - 19, y1: p.y + 19, x2: p.x + 19, y2: p.y - 19 }));
        (move.captured ? gSelOver : gSel).append(g);
      }
    }
    refreshCells();
  }

  /** @param {Square|null} sq @param {Move[]} [targets] @param {Move[]} [forbidden] */
  function setSelection(sq, targets = [], forbidden = []) {
    if (trial && (!sq || !same(sq, trial.move.from))) dropTrial();      // the stage retracts first; this is only a safety net
    const prev = selection;
    selection = sq ? { sq: { row: sq.row, col: sq.col }, targets, forbidden } : null;
    renderSelection(true);
    if (sq && !same(prev?.sq, sq)) {
      play('select');
      fx.haptic('tap');
    } else if (!sq && prev) {
      play('deselect');
    }
  }

  /** Drops the selection without the deselect sound (a move was committed, the position was replaced). */
  function clearSelection() {
    selection = null;
    renderSelection(false);
  }

  // ---- marks: last move (E3), check (E4) -----------------------------------------------------------------------------------

  function renderLastMove() {
    gLast.replaceChildren();
    clearCellClasses('is-last-from', 'is-last-to');
    if (!lastMove) return;
    const { move, actor } = lastMove;
    const a = pt(move.from);
    const brackets = bracketPath(pt(move.to), 47, 15);
    gLast.append(
      svgEl('circle', { class: 'bv-lastfrom', cx: a.x, cy: a.y, r: 12 }),
      svgEl('path', { class: 'bv-lastto-edge', d: brackets }),
      svgEl('path', { class: 'bv-lastto', 'data-by': actor === 'me' ? 'me' : move.piece.color, d: brackets }),
    );
    cellAt(move.from).classList.add('is-last-from');
    cellAt(move.to).classList.add('is-last-to');
  }

  /** @param {Move|null} move @param {Actor} [actor] */
  function setLastMove(move, actor) {
    lastMove = move ? { move, actor: actor ?? (move.piece.color === bottom ? 'me' : 'rival') } : null;
    renderLastMove();
  }

  /** @param {boolean} flash  the threat lines flash twice before they settle at 60 % */
  function renderCheck(flash) {
    gCheck.replaceChildren();
    clearCellClasses('is-check');
    if (!check) return;
    const king = findKing(check.color);
    if (!king) return;
    const k = pt(king);
    for (const sq of check.checkers) {
      const a = pt(sq);
      const len = Math.hypot(k.x - a.x, k.y - a.y) || 1;
      const ux = (k.x - a.x) / len, uy = (k.y - a.y) / len;
      gCheck.append(svgEl('line', {
        class: flash ? 'bv-threat is-flash' : 'bv-threat',
        x1: f1(a.x + 46 * ux), y1: f1(a.y + 46 * uy), x2: f1(k.x - 54 * ux), y2: f1(k.y - 54 * uy),
      }));
    }
    gCheck.append(svgEl('circle', { class: 'bv-checkring', cx: k.x, cy: k.y, r: 50 }));
    cellAt(king).classList.add('is-check');
  }

  /** @param {Color|null} color @param {Square[]} [checkers] */
  function setCheck(color, checkers = []) {
    check = color ? { color, checkers } : null;
    renderCheck(false);
  }

  // ---- movement (table B, §10.2.6) -----------------------------------------------------------------------------------------

  /** @param {number} lift  in c, up is positive @param {number} scale @param {number} rot */
  const pose = (lift, scale, rot) => `translateY(${f1(-lift * c)}px) scale(${scale}) rotate(${rot}deg)`;
  /** The shadow mirrors the body: at lift L it is translateY(.6 L) scale(1 + .5 L), opacity 1 - L. @param {number} lift */
  const shade = (lift) => ({ transform: `translateY(${f1(0.6 * lift * c)}px) scale(${1 + 0.5 * lift})`, opacity: String(1 - lift) });

  /**
   * Body and shadow keyframes of a travel. The first keyframe is the pose the piece has right now; a trial ends
   * hovering, so its touch-down keyframes are left out and the last keyframe is the class's hover pose.
   * @param {{body:string, shadow:string, shadowOpacity:string}} now @param {number[][]|null} table @param {boolean} hover
   * @returns {{body:Keyframe[], shadow:Keyframe[]}}
   */
  function liftFrames(now, table, hover) {
    /** @type {Keyframe[]} */
    const body = [{ offset: 0, transform: now.body === 'none' ? pose(0, 1, 0) : now.body }];
    /** @type {Keyframe[]} */
    const shadow = [{ offset: 0, transform: now.shadow === 'none' ? 'translateY(0px) scale(1)' : now.shadow, opacity: now.shadowOpacity }];
    if (!table) return { body, shadow };                   // a glide: from the current pose to the pose of the final state
    /** @type {number[]} */
    const lifts = [];
    for (const [offset, lift, scale, rot] of table) {
      if (offset === 0 && lift === 0 && scale === 1 && rot === 0) continue;
      if (hover && offset > 0.86) continue;
      const at = offset === 0 ? 0.1 : offset;
      body.push({ offset: at, transform: pose(lift, scale, rot) });
      shadow.push({ offset: at, ...shade(lift) });
      lifts.push(lift);
    }
    // A thrown piece rises fast and falls faster: ease each segment by the direction of its lift.
    let before = 0;
    for (let i = 0; i < lifts.length; i++) {
      const easing = lifts[i] > before ? 'ease-out' : lifts[i] < before ? 'ease-in' : 'linear';
      body[i].easing = easing;
      shadow[i].easing = easing;
      before = lifts[i];
    }
    return { body, shadow };
  }

  /**
   * FLIP: moves a piece from wherever it is drawn right now (mid-drag, mid-hover, anywhere) to a square.
   * @param {Rec} rec @param {Square} to
   * @param {{ms:number, ease:string, via?:Square|null, viaAt?:number, body?:number[][]|null, hover?:boolean, restyle?:() => void}} o
   *   via: a square the path passes through (the horse's leg) at offset viaAt; body: lift keyframes (null = glide);
   *   hover: the body ends in the trial's hover pose; restyle: class changes that define the final pose
   * @returns {{anims:Animation[], ms:number}}
   */
  function travel(rec, to, o) {
    const el = rec.el;
    const before = el.getBoundingClientRect();              // READ: where it is drawn right now
    const bodyStyle = getComputedStyle(rec.body), shadowStyle = getComputedStyle(rec.shadow);
    const now = { body: bodyStyle.transform, shadow: shadowStyle.transform, shadowOpacity: shadowStyle.opacity };
    const k = screenScale();
    stopMoving(rec);
    el.style.translate = '';
    el.classList.remove('is-dragging');
    el.classList.add('is-moving');
    o.restyle?.();
    seat(rec, to);                                          // WRITE: the final square
    const after = el.getBoundingClientRect();
    const dx = (before.left - after.left) / k, dy = (before.top - after.top) / k;
    const ms = reduced ? 120 : Math.max(1, o.ms);
    el.style.zIndex = '50';                                 // above every row (a resting piece has 10 + its view row)
    el.style.willChange = 'transform';
    /** @type {Keyframe[]} */
    const path = [{ transform: `translate(${f1(dx)}px, ${f1(dy)}px)` }];
    if (!reduced && o.via) {
      const a = toView(o.via, bottom), b = toView(to, bottom);
      path.push({ offset: o.viaAt ?? 0.42, transform: `translate(${f1((a.vx - b.vx) * c)}px, ${f1((a.vy - b.vy) * c)}px)` });
    }
    path.push({ transform: 'translate(0px, 0px)' });
    const list = [anim(el, path, { duration: ms, easing: reduced ? 'linear' : o.ease })];
    if (!reduced) {
      const frames = liftFrames(now, o.body ?? null, !!o.hover);
      list.push(anim(rec.body, frames.body, { duration: ms, easing: 'linear' }), anim(rec.shadow, frames.shadow, { duration: ms, easing: 'linear' }));
    }
    rec.moving = list;
    settled(list).then(() => {
      if (rec.moving !== list) return;
      rec.moving = [];
      el.style.zIndex = '';
      el.style.willChange = '';
      el.classList.remove('is-moving');
    });
    return { anims: list, ms };
  }

  /** Landing effects of table B (a move that captures nothing). @param {Rec} rec @param {Pt} at @param {number} dir @param {number} d */
  function landingFx(rec, at, dir, d) {
    switch (rec.type) {
      case 'rook': fx.burst('dust', at, { n: 8, dir }); if (d >= 4) fx.shake(1); break;
      case 'horse': fx.burst('ring', at); break;
      case 'cannon': fx.burst('dust', at, { n: 4 }); break;
      case 'elephant': fx.burst('ring', at, { size: 1.4 }); fx.shake(1); break;
      case 'king': fx.burst('ring', at, { color: GOLD }); break;
      default: break;                                        // advisor: its trail was drawn at t = 0; pawn: nothing
    }
  }

  /**
   * Impact of table C for every attacker but the cannon.
   * @param {Rec} attacker @param {Rec} victim @param {Pt} at @param {number} dir @returns {Animation} the victim's exit
   */
  function impactFx(attacker, victim, at, dir) {
    const s = VICTIM_SCALE[victim.type];
    const colors = sideColors(victim.color);
    const el = victim.el;
    /** @param {number} n */
    const debris = (n) => fx.burst('capture', at, { n: Math.round(n * s), dir, colors, scale: s });
    const strike = () => exit(el, [
      { transform: 'scale(1) rotate(0deg)', opacity: 1 }, { offset: 0.35, transform: 'scale(1.15) rotate(8deg)', opacity: 1 }, { transform: 'scale(0) rotate(20deg)', opacity: 0 },
    ], { duration: 220, easing: 'ease-in' });
    /** @type {Animation} */
    let gone;
    switch (attacker.type) {
      case 'rook': {                                         // ram
        const push = `${f1(Math.cos(dir) * 0.6 * c)}px, ${f1(Math.sin(dir) * 0.6 * c)}px`;
        gone = exit(el, [{ transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 }, { transform: `translate(${push}) scale(.6) rotate(25deg)`, opacity: 0 }], { duration: 200, easing: EASE.out });
        debris(24);
        fx.shake(2);
        play('capture', { scale: s });
        fx.haptic('capture');
        if (victim.type === 'rook' || victim.type === 'cannon' || victim.type === 'horse') fx.hitStop(60);
        break;
      }
      case 'horse':                                          // stomp
        gone = exit(el, [{ transform: 'scale(1, 1)', opacity: 1 }, { offset: 0.3, transform: 'scale(1, .25)', opacity: 1 }, { transform: 'scale(0, 0)', opacity: 0 }], { duration: 200, easing: 'linear' });
        debris(20);
        fx.burst('ring', at);
        fx.shake(1);
        play('capture', { scale: s });
        fx.haptic('capture');
        break;
      case 'king':                                           // slash (the drum of move.king is already sounding)
        gone = strike();
        debris(18);
        fx.slash(at);
        fx.shake(2);
        play('capture', { scale: s });
        fx.haptic('capture');
        break;
      case 'pawn':                                           // poke
        gone = exit(el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], { duration: 160, easing: 'ease-in' });
        debris(12);
        play('capture', { scale: s * 0.8 });
        fx.haptic('capture');
        break;
      default:                                               // elephant / advisor: strike
        gone = strike();
        debris(18);
        fx.shake(1);
        play('capture', { scale: s });
        fx.haptic('capture');
        break;
    }
    return gone;
  }

  /** Reduced motion: one static ring marks the square of a capture, fading over 200 ms. @param {Square} sq */
  function flashRing(sq) {
    const p = pt(sq);
    const ring = svgEl('circle', { class: 'bv-flashring', cx: p.x, cy: p.y, r: 50 });
    gTop.append(ring);
    exit(ring, { opacity: [1, 0] }, { duration: 200, easing: 'linear' });
  }

  /**
   * E4, at time t on the timeline: banner, sound, king ring and threat lines; a soft check shows only ring and lines.
   * @param {Timeline} tl @param {number} t @param {Rec} mover @param {MoveOpts} o @param {Promise<void>[]} waits @returns {number} end time
   */
  function checkFx(tl, t, mover, o, waits) {
    const d = deferred();
    waits.push(d.promise);
    const mine = o.actor === 'me';
    tl.at(t, (live) => {
      check = { color: other(mover.color), checkers: o.flags.checkers ?? [] };
      renderCheck(live && !reduced);
      if (!live) { d.resolve(); return; }
      if (o.soft) { play('check.soft'); d.resolve(); return; }
      const king = o.flags.checkedKing ?? findKing(other(mover.color));
      fx.banner('check', { tone: mine ? 'mine' : 'danger', avoid: king ? px(king) : undefined }).then(d.resolve, d.resolve);
      play(mine ? 'check.give' : 'check.take');
      if (mine) fx.haptic('check'); else if (!reduced) fx.flash(token('--danger'), 120);
    }, true);
    // The child is the one in check: the board jolts as the banner slams down (180 ms after it starts).
    if (!o.soft && !mine && !reduced) tl.at(t + 180, (live) => { if (live) fx.shake(2); });
    return t + (o.soft ? 500 : 830);
  }

  /**
   * E5, at time t: the mated king topples; when the child delivered the mate also hit-stop, flash, zoom, explosion, 绝杀.
   * @param {Timeline} tl @param {number} t @param {Rec} mover @param {MoveOpts} o @param {Promise<void>[]} waits @returns {number} end time
   */
  function mateFx(tl, t, mover, o, waits) {
    const d = deferred();
    waits.push(d.promise);
    const childWins = o.actor === 'me';
    const sq = o.flags.checkedKing;
    const king = (sq ? grid[sq.row]?.[sq.col] : null) ?? findKing(other(mover.color));
    tl.at(t, (live) => {
      king?.el.classList.add('is-fallen');
      if (!live || reduced) {
        king?.el.classList.add('is-grey');
        if (live && childWins) { fx.banner('mate').then(d.resolve, d.resolve); play('win'); } else d.resolve();
        return;
      }
      if (king) anim(king.body, { rotate: ['0deg', '90deg'], opacity: [1, 0.7] }, { duration: 400, easing: EASE.in });
      if (!childWins || !king) { d.resolve(); return; }      // the child is mated: only the king tips over
      const at = px(king);
      host.style.transformOrigin = `${f1(at.x)}px ${f1(at.y)}px`;
      anim(host, [{ scale: '1', easing: EASE.out }, { offset: 0.625, scale: '1.04', easing: EASE.inout }, { scale: '1' }], { duration: 800 })
        .finished.then(() => { host.style.transformOrigin = ''; }, () => {});
      fx.burst('explosion', at, { colors: sideColors(king.color) });
      fx.banner('mate').then(d.resolve, d.resolve);
      play('win');
      fx.haptic('win');
      fx.flash('#fff', 60);
      fx.hitStop(120);                                       // last: it freezes what was just started
    }, true);
    tl.at(t + 400, () => { king?.el.classList.add('is-grey'); }, true);
    return t + (childWins && !reduced ? 1500 : 400);
  }

  /**
   * What follows the landing of every committed move: last-move markers (E3), the confirm sound of a stamped
   * trial, the river crossing (E9), check (E4) or mate (E5).
   * @param {Timeline} tl @param {number} land @param {number} end @param {Rec} rec @param {Move} move @param {MoveOpts} o
   * @param {Promise<void>[]} [waits]  what else must have ended before the move is over (the victim's exit)
   * @returns {Promise<void>}
   */
  function afterLanding(tl, land, end, rec, move, o, waits = []) {
    const mine = o.actor === 'me';
    tl.at(land, () => { renderLastMove(); }, true);
    if (o.confirm) tl.at(land, (live) => { if (live) play('trial.confirm'); });
    const checked = o.flags.check || o.flags.mate;
    if (rec.type === 'pawn' && (o.flags.crossed || crossesRiver(move, rec))) {
      const a = px(move.from), b = px(move.to);
      const d = deferred();
      waits.push(d.promise);
      tl.at(land, (live) => {
        if (!live) { d.resolve(); return; }
        if (!reduced) fx.burst('splash', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { n: 18 });
        play('river');
        if (mine && !checked) fx.banner('river').then(d.resolve, d.resolve); else d.resolve();   // 过河！ only for the child's pawns
      }, true);
      end = Math.max(end, land + (mine && !checked ? 700 : 0));
    }
    if (o.flags.mate) end = Math.max(end, mateFx(tl, land, rec, o, waits));
    else if (o.flags.check) end = Math.max(end, checkFx(tl, land, rec, o, waits));
    return Promise.all([tl.done(end), ...waits]).then(() => {});
  }

  /**
   * The choreography of one committed move: E1 for the rival, table B, table C when it captures, then
   * afterLanding. The position (grid, cells) is already the new one; `rec` is still drawn on or near move.from.
   * @param {Rec} rec @param {Rec|null} victim @param {Move} move @param {MoveOpts} o
   * @returns {Promise<void>}
   */
  function performMove(rec, victim, move, o) {
    const tl = timeline();
    const { from, to } = move;
    const pFrom = px(from), pTo = px(to);
    const dir = Math.atan2(pTo.y - pFrom.y, pTo.x - pFrom.x);
    const d = dist(move);
    const style = MOVE_STYLE[rec.type];
    const restyle = () => { rec.el.classList.remove('is-selected', 'is-lifted', 'is-trial', 'is-aim', 'is-hover', 'is-pressed'); };
    const t0 = o.lead;
    let land = t0, end = t0;
    /** @type {Promise<void>[]} */
    const waits = [];
    // the move is not over before the captured piece is gone (a hit-stop can hold its exit a little longer)
    const gone = victim ? deferred() : null;
    if (gone) waits.push(gone.promise);
    if (victim) transients.add(victim.el);

    if (o.lead > 0) {                                        // E1: the rival's piece announces itself
      const a = pt(from);
      const ring = svgEl('circle', { class: 'bv-anticipate', 'data-color': rec.color, cx: a.x, cy: a.y, r: 50 });
      gMisc.append(ring);
      transients.add(ring);
      if (!reduced) rec.el.classList.add('is-lifted');
      tl.at(o.lead, () => removeNode(ring), true);
    }

    if (reduced) {
      // Every type: a 120 ms straight translate; a victim fades in 120 ms under one static ring. Sounds are unchanged.
      tl.at(t0, (live) => {
        if (!live) { snap(rec, to, restyle); if (victim) removeNode(victim.el); gone?.resolve(); return; }
        travel(rec, to, { ms: 120, ease: 'linear', restyle });
        if (rec.type === 'cannon' && victim) { play('cannon.fire'); play('blast', { when: 0.1 }); } else play(moveSound(rec.type), { ms: 120 });
        if (victim) {
          exit(victim.el, { opacity: [1, 0] }, { duration: 120, easing: 'linear' }).finished.then(gone?.resolve, gone?.resolve);
          flashRing(to);
          if (rec.type !== 'cannon') play('capture', { scale: VICTIM_SCALE[victim.type] * (rec.type === 'pawn' ? 0.8 : 1) });
        }
      }, true);
      land = t0 + 120;
      end = victim ? t0 + 200 : land;
    } else if (rec.type === 'cannon' && victim) {
      // C-cannon, the shot: recoil and muzzle flash, the ember flies over the screen, the blast, then the cannon arcs in.
      tl.at(t0, (live) => {
        restyle();
        if (!live) return;
        anim(rec.body, { translate: ['0px 0px', `${f1(-Math.cos(dir) * 0.12 * c)}px ${f1(-Math.sin(dir) * 0.12 * c)}px`, '0px 0px'] }, { duration: 80, easing: EASE.out });
        fx.burst('sparks', pFrom, { n: 6, dir });
        play('cannon.fire');
        play('blast', { when: 0.2 });                        // scheduled, so the boom is sample-accurate on the impact
      }, true);
      tl.at(t0 + 30, (live) => { if (live) void fx.projectile(pFrom, pTo, { arc: 0.9 * c, ms: 170 }); });
      tl.at(t0 + 200, (live) => {
        if (!live) { removeNode(victim.el); gone?.resolve(); return; }
        exit(victim.el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: 120, easing: EASE.out }).finished.then(gone?.resolve, gone?.resolve);
        fx.burst('explosion', pTo, { colors: sideColors(victim.color) });
        fx.flash('#fff', 60);
        fx.shake(3);
        fx.haptic('blast');
        fx.hitStop(60);
      }, true);
      tl.at(t0 + 260, (live) => {
        if (!live) { snap(rec, to, restyle); return; }
        travel(rec, to, { ms: 300, ease: EASE.inout, body: CANNON_ARC });
      }, true);
      land = t0 + 560;
      end = t0 + 640;
      tl.at(land, (live) => {
        if (!live) return;
        play('place', { gain: 1.1 });                        // the cannon lands heavily (`scale` only shapes 'capture')
        fx.burst('dust', pTo, { n: 6 });
        fx.haptic('place');
      });
    } else {
      let ms = style.ms(d) * o.mult;
      const victimMs = victim ? VICTIM_MS[rec.type] : 0;
      if (victim && o.cap > 0 && ms - 40 + victimMs > o.cap) ms = o.cap + 40 - victimMs;      // D6: the travel is scaled down to fit
      const impact = t0 + Math.max(0, ms - 40);             // the mover's rim meets the victim
      land = t0 + ms;
      end = victim ? Math.max(land, impact + victimMs) : land;
      tl.at(t0, (live) => {
        if (!live) { snap(rec, to, restyle); return; }
        travel(rec, to, { ms, ease: style.ease, via: rec.type === 'horse' ? horseLeg(from, to) : null, body: style.body, restyle });
        play(moveSound(rec.type), { ms });
        if (rec.type === 'advisor') fx.trail(pFrom, pTo);
      }, true);
      if (victim) {
        tl.at(impact, (live) => {
          if (live) impactFx(rec, victim, pTo, dir).finished.then(gone?.resolve, gone?.resolve);
          else { removeNode(victim.el); gone?.resolve(); }
        }, true);
      } else {
        tl.at(land, (live) => { if (live) landingFx(rec, pTo, dir, d); });
      }
      tl.at(land, (live) => { if (live) fx.haptic('place'); });
    }
    return afterLanding(tl, land, end, rec, move, o, waits);
  }

  /**
   * The bookkeeping every committed move starts with: marks that belong to the old position go, the grid and
   * the cells become the new position.
   * @param {Rec} rec @param {Move} move @param {Actor} actor @returns {Rec|null} the captured piece
   */
  function commitPosition(rec, move, actor) {
    clearSelection();
    host.classList.remove('is-trialing');
    clearCellClasses('is-trial-from', 'is-trial-to');
    check = null;
    renderCheck(false);
    removeArrows(undefined, 0);
    setHighlight(null, 0);
    gLast.replaceChildren();
    clearCellClasses('is-last-from', 'is-last-to');
    lastMove = { move, actor };
    const there = grid[move.to.row][move.to.col];
    const victim = there && there !== rec ? there : null;
    if (victim) recs.delete(victim.id);
    for (const row of grid) { const i = row.indexOf(rec); if (i >= 0) row[i] = null; }
    grid[move.to.row][move.to.col] = rec;
    refreshCells();
    return victim;
  }

  /** @param {Move} move @param {{actor:Actor, flags:MoveFlags, soft?:boolean}} opts @returns {Promise<void>} */
  function playMove(move, opts) {
    abortPreview();
    if (drag) endDrag(false, true);
    if (trial) dropTrial();
    const rec = recs.get(move.piece.id) ?? grid[move.from.row]?.[move.from.col] ?? null;
    if (!rec) return Promise.resolve();
    const rival = opts.actor === 'rival';
    const victim = commitPosition(rec, move, opts.actor);
    return busy(performMove(rec, victim, move, {
      actor: opts.actor, mult: rival ? 1.15 : 1, flags: opts.flags, soft: !!opts.soft, lead: rival ? (reduced ? 200 : 260) : 0, confirm: false, cap: 0,
    }));
  }

  // ---- the tentative move (D1 - D6) ----------------------------------------------------------------------------------------

  function makeTag() {
    const tag = document.createElement('span');
    tag.className = 'piece__tag';
    tag.textContent = '试';
    return tag;
  }

  /** 6 degrees towards the target; a target straight ahead or behind has no side to lean to. @param {Move} move */
  function leanOf(move) {
    const a = toView(move.from, bottom), b = toView(move.to, bottom);
    return `${6 * Math.sign(b.vx - a.vx)}deg`;
  }

  /** @param {Move} move @param {PieceType} type @param {boolean} aim */
  function trailOf(move, type, aim) {
    /** @type {'line'|'leg'|'arc'} */
    const kind = type === 'horse' ? 'leg' : aim && type === 'cannon' ? 'arc' : 'line';
    return movePath(move.from, move.to, kind, 46, aim ? 54 : 46, 90).d();
  }

  /** Removes the marks of a trial: ring, tag, ghost and reticle fade, the trail un-draws. @param {Trial} t @param {number} ms @param {boolean} [keepRing] */
  function removeTrialMarks(t, ms, keepRing) {
    const fade = reduced ? 0 : ms;
    for (const node of [t.ghost, t.tag, t.reticle, keepRing ? null : t.ring]) if (node) fadeOut(node, fade);
    if (t.trail) {
      const trail = t.trail;
      if (fade > 0 && trail.isConnected) exit(trail, { strokeDashoffset: [0, dotted(trail)] }, { duration: fade, easing: EASE.inout });
      else removeNode(trail);
    }
    t.ghost = t.tag = t.reticle = t.trail = null;
    if (!keepRing) t.ring = null;
  }

  /**
   * Draws a trial: D1 (the piece travels and hovers), D1a (it stays, lifts and aims), or with glide the direct
   * move of D3. live = false builds the same state with no animation and no sound.
   * @param {Trial} t @param {number} step @param {boolean} live @param {boolean} glide
   * @returns {Promise<void>} resolves when the piece hovers or the reticle has locked
   */
  function buildTrial(t, step, live, glide) {
    const { rec, move, aim } = t;
    const animate = live && !reduced;
    t.built = true;
    const o = pt(move.to);
    t.ring = svgEl('circle', { class: 'bv-trialring', cx: o.x, cy: o.y, r: 52 });
    gTrial.append(t.ring);
    t.trail = svgEl('path', { class: aim ? 'bv-trail is-aim' : 'bv-trail', d: trailOf(move, rec.type, aim) });
    (aim ? gTrialOver : gTrial).append(t.trail);
    const hidden = dotted(t.trail);
    const freshTag = !t.tag;
    t.tag ??= makeTag();
    if (freshTag) rec.body.append(t.tag);
    /** @type {Animation[]} */
    const list = [];
    if (animate) {
      list.push(anim(t.trail, { strokeDashoffset: [hidden, 0] }, { duration: 200, easing: EASE.out }));
      anim(t.ring, { opacity: [0, 1] }, { duration: 160, easing: EASE.out });
    }

    if (aim) {
      const victim = grid[move.to.row][move.to.col];
      t.reticle = reticle(move.to, 'bv-reticle is-lock');
      gTrialOver.append(t.reticle);
      rec.el.style.setProperty('--lean', leanOf(move));
      rec.el.classList.remove('is-selected', 'is-hover');
      rec.el.classList.add('is-trial', 'is-aim');           // the lift and the lean are a CSS transition (140 ms)
      t.landAt = performance.now() + (animate ? 180 : 0);
      if (animate) {
        if (freshTag) anim(t.tag, { scale: ['0', '1'] }, { duration: 160, easing: EASE.back });
        if (victim) list.push(anim(victim.body, { translate: ['0px', `${f1(0.04 * c)}px`, `${f1(-0.04 * c)}px`, '0px'] }, { duration: 180, easing: 'linear' }));
      }
      if (live) t.tl.at(animate ? 180 : 0, (on) => { if (on) play('trial.lift', { step }); });
      return animate ? settled(list) : Promise.resolve();
    }

    if (!t.ghost) {
      t.ghost = makeGhost(rec, move.from, '');
      piecesEl.prepend(t.ghost);
    }
    const restyle = () => { rec.el.classList.remove('is-selected', 'is-hover', 'is-aim'); rec.el.classList.add('is-trial'); };
    if (!live) {
      rec.el.style.removeProperty('--hover-delay');
      snap(rec, move.to, restyle);
      t.landAt = performance.now();
      return Promise.resolve();
    }
    const style = MOVE_STYLE[rec.type];
    const d = dist({ from: { row: rec.row, col: rec.col }, to: move.to });
    const ms = reduced ? 120 : glide ? 160 + 20 * d : style.ms(d) * 0.85;
    rec.el.style.setProperty('--hover-delay', `${Math.round(ms)}ms`);     // the bob starts from the hover pose when the piece arrives
    const tr = glide
      ? travel(rec, move.to, { ms, ease: EASE.out, restyle })
      : travel(rec, move.to, { ms, ease: style.ease, via: rec.type === 'horse' ? horseLeg(move.from, move.to) : null, body: style.body, hover: true, restyle });
    if (animate) {
      if (freshTag) anim(t.tag, { scale: ['0', '1'] }, { duration: 160, delay: tr.ms, easing: EASE.back, fill: 'backwards' });
      if (rec.type === 'advisor' && !glide) fx.trail(px(move.from), px(move.to));
    }
    play(moveSound(rec.type), { ms: tr.ms });
    t.tl.at(tr.ms, (on) => { if (on) play('trial.lift', { step }); });
    t.landAt = performance.now() + tr.ms;
    return settled(tr.anims);
  }

  /**
   * Makes `move` the trial. The Trial exists at once (so the guard and a confirm always find it); with a delay
   * its drawing starts later (after the previous state was un-drawn, D3).
   * @param {Rec} rec @param {Move} move @param {boolean} aim @param {number} step @param {number} delay
   * @param {{ghost:HTMLElement|null, tag:HTMLElement|null}|null} carry  D3: the ghost and the tag that stay
   * @returns {Promise<void>}
   */
  function startTrial(rec, move, aim, step, delay, carry) {
    const glide = !!carry;
    /** @type {Trial} */
    const t = { rec, move, aim, built: false, ghost: carry?.ghost ?? null, ring: null, trail: null, reticle: null, tag: carry?.tag ?? null, landAt: performance.now() + delay + 400, guardMs: DEFAULT_GUARD_MS, tl: timeline() };
    trial = t;
    host.classList.add('is-trialing');
    clearCellClasses('is-trial-from', 'is-trial-to');
    cellAt(move.from).classList.add('is-trial-from');
    cellAt(move.to).classList.add('is-trial-to');
    if (delay <= 0) return buildTrial(t, step, true, glide);  // zero-wait: the lift starts in the frame of the tap
    return new Promise((resolve) => {
      t.tl.at(delay, (live) => { buildTrial(t, step, live, glide).then(resolve); }, true);
    });
  }

  /** Ends the trial with no animation and no sound; the piece is back on its origin. */
  function dropTrial() {
    if (!trial) return;
    const t = trial;
    trial = null;
    t.tl.flush();
    removeTrialMarks(t, 0);
    t.rec.el.classList.remove('is-trial', 'is-aim', 'is-pressed');
    t.rec.el.style.removeProperty('--hover-delay');
    t.rec.el.style.removeProperty('--lean');
    snap(t.rec, t.move.from);
    host.classList.remove('is-trialing');
    clearCellClasses('is-trial-from', 'is-trial-to');
    renderSelection(false);
  }

  /** @param {Move} move @param {{aim?:boolean, liftStep?:number}} [opts] @returns {Promise<void>} */
  function showTentative(move, opts = {}) {
    abortPreview();
    const step = opts.liftStep ?? 0;
    const rec = grid[move.from.row]?.[move.from.col] ?? null;
    if (!rec) return Promise.resolve();
    // A move that captures is never a hover trial (D1 item 7): with a piece on the target square it is always an aim.
    const there = grid[move.to.row]?.[move.to.col] ?? null;
    const aim = (opts.aim ?? !!move.captured) || (!!there && there !== rec);
    if (trial && trial.rec !== rec) dropTrial();
    const old = trial;
    if (!old) return busy(startTrial(rec, move, aim, step, 0, null));
    if (same(old.move.to, move.to) && old.aim === aim) return Promise.resolve();
    old.tl.flush();
    rec.el.classList.remove('is-pressed');
    if (!old.aim && !aim) {
      // D3: the piece glides directly from its hover square to the new one; the ghost stays, trail and ring re-target.
      const carry = { ghost: old.ghost, tag: old.tag };
      old.ghost = old.tag = null;
      removeTrialMarks(old, 0);
      return busy(startTrial(rec, move, false, step, 0, carry));
    }
    // Between a hover and an aim (or two aims): the current state is un-drawn in 100 ms, then D1 or D1a plays.
    const wait = reduced ? 0 : 100;
    removeTrialMarks(old, wait);
    if (old.aim) {
      rec.el.classList.remove('is-aim');
      rec.el.style.removeProperty('--lean');
    } else if (wait > 0) {
      travel(rec, move.from, { ms: wait, ease: EASE.out, restyle: () => { rec.el.style.removeProperty('--hover-delay'); } });
    } else {
      snap(rec, move.from);
    }
    return busy(startTrial(rec, move, aim, step, wait, null));
  }

  /** @param {number} ms @param {boolean} [wobble] */
  function setTrialGuard(ms, wobble) {
    if (!trial) return;
    trial.guardMs = Math.max(0, ms);
    if (wobble && !reduced) anim(trial.rec.body, { rotate: ['0deg', '-8deg', '7deg', '-4deg', '0deg'] }, { duration: 380, easing: 'ease-in-out' });
  }

  /** D4. @param {{reselect?:boolean, targets?:Move[], forbidden?:Move[]}} [opts] @returns {Promise<void>} */
  function retractTentative(opts = {}) {
    abortPreview();
    if (!trial) return Promise.resolve();
    const t = trial;
    trial = null;
    t.tl.flush();
    const { rec, move } = t;
    play('trial.retract');
    host.classList.remove('is-trialing');
    clearCellClasses('is-trial-from', 'is-trial-to');
    const ms = reduced ? 120 : t.aim ? 100 : 240;
    removeTrialMarks(t, ms);
    const reselect = !!opts.reselect;
    const restyle = () => {
      rec.el.classList.remove('is-trial', 'is-aim', 'is-pressed');
      rec.el.classList.toggle('is-selected', reselect);
      rec.el.style.removeProperty('--hover-delay');
      rec.el.style.removeProperty('--lean');
    };
    /** @type {Promise<void>} */
    let done;
    if (t.aim) {
      restyle();                                             // the piece never left: it settles back by CSS transition
      done = reduced ? Promise.resolve() : timeline().done(ms);
    } else {
      // back along the trail: a horse returns through its leg square
      done = settled(travel(rec, move.from, { ms, ease: EASE.inout, via: rec.type === 'horse' ? horseLeg(move.from, move.to) : null, viaAt: 0.58, restyle }).anims);
    }
    selection = reselect
      ? { sq: { row: move.from.row, col: move.from.col }, targets: opts.targets ?? selection?.targets ?? [], forbidden: opts.forbidden ?? selection?.forbidden ?? [] }
      : null;
    renderSelection(true);
    return done;
  }

  /** D5 / D6, then E4 / E5 if flagged. @param {{flags:MoveFlags, soft?:boolean}} opts @returns {Promise<void>} */
  function commitTentative(opts) {
    abortPreview();
    if (!trial) return Promise.resolve();
    const t = trial;
    trial = null;
    t.tl.flush();
    const { rec, move } = t;
    const victim = commitPosition(rec, move, 'me');
    /** @type {MoveOpts} */
    const o = { actor: 'me', mult: 0.85, flags: opts.flags, soft: !!opts.soft, lead: 0, confirm: true, cap: 700 };
    if (t.aim) {
      // D6: reticle, aim line and tag fade while the piece launches from its origin with the full capture choreography.
      removeTrialMarks(t, 80);
      rec.el.style.removeProperty('--lean');
      return busy(performMove(rec, victim, move, o));
    }
    // D5, the stamp: the hovering piece drops and squashes, the ring bursts, ghost, trail and tag fade.
    const tl = timeline();
    const restyle = () => {
      rec.el.classList.remove('is-trial', 'is-pressed', 'is-selected', 'is-hover');
      rec.el.style.removeProperty('--hover-delay');
    };
    const ring = t.ring;
    removeTrialMarks(t, 120, true);
    play('trial.confirm');
    fx.haptic('place');
    let land = 0;
    if (reduced) {
      snap(rec, move.to, restyle);                           // seated instantly; the ring fades over 200 ms
      if (ring) exit(ring, { opacity: [1, 0] }, { duration: 200, easing: 'linear' });
    } else {
      const bodyStyle = getComputedStyle(rec.body), shadowStyle = getComputedStyle(rec.shadow);
      const from = { body: bodyStyle.transform, shadow: shadowStyle.transform, opacity: shadowStyle.opacity };
      // a confirm before the piece has arrived: its flight across the board goes on, only the lift is replaced
      const flight = rec.moving.filter((a) => a.effect instanceof KeyframeEffect && a.effect.target === rec.el);
      for (const a of rec.moving) if (!flight.includes(a)) a.cancel();
      rec.el.classList.add('is-moving');
      restyle();
      const list = [
        ...flight,
        anim(rec.body, [{ offset: 0, transform: from.body, easing: EASE.in }, { offset: 0.55, transform: pose(0, 0.94, 0), easing: EASE.back }, { offset: 1, transform: pose(0, 1, 0) }], { duration: 180 }),
        anim(rec.shadow, [{ offset: 0, transform: from.shadow, opacity: from.opacity, easing: EASE.in }, { offset: 0.55, transform: 'translateY(0px) scale(1)', opacity: '1' }], { duration: 180 }),
      ];
      rec.moving = list;
      settled(list).then(() => {
        if (rec.moving !== list) return;
        rec.moving = [];
        rec.el.style.zIndex = '';
        rec.el.style.willChange = '';
        rec.el.classList.remove('is-moving');
      });
      // the dashed ring turns solid and bursts outwards when the piece hits the board
      tl.at(100, (live) => {
        if (ring) removeNode(ring);
        if (live) fx.burst('ring', px(move.to), { color: token('--trial') });
      }, true);
      land = 180;
    }
    o.confirm = false;                                       // already sounded with the stamp
    return busy(afterLanding(tl, land, land, rec, move, o));
  }

  // ---- arrows (F3 - F5) ---------------------------------------------------------------------------------------------------

  /**
   * @param {Arrow} arrow @param {'draw'|'fade'|'still'} mode  draw: F4 (line, then head); fade: the reduced-motion entrance; still: no entrance
   * @returns {{node:SVGGElement, ghost:HTMLElement|null, timer:number}}
   */
  function buildArrow(arrow, mode) {
    const mover = grid[arrow.from.row]?.[arrow.from.col] ?? null;
    const type = arrow.pieceType ?? mover?.type;
    const occupied = !!grid[arrow.to.row]?.[arrow.to.col];
    /** @type {'line'|'leg'|'arc'} */
    const kind = type === 'horse' && horseLeg(arrow.from, arrow.to) ? 'leg' : type === 'cannon' && occupied ? 'arc' : 'line';
    const geo = movePath(arrow.from, arrow.to, kind, 30, 34, 50);
    const g = svgEl('g', { class: 'arrow', 'data-from': code2(arrow.from), 'data-to': code2(arrow.to), 'data-style': arrow.style });
    const d = geo.d(24);
    const under = svgEl('path', { class: 'arrow__under', d });
    const line = svgEl('path', { class: 'arrow__line', d });
    // the head: an isosceles triangle 30 long and 26 wide, its tip .34 c short of the target centre
    const bx = geo.tip.x - 30 * geo.ux, by = geo.tip.y - 30 * geo.uy;
    const head = svgEl('polygon', {
      class: 'arrow__head',
      points: `${f1(geo.tip.x)},${f1(geo.tip.y)} ${f1(bx - 13 * geo.uy)},${f1(by + 13 * geo.ux)} ${f1(bx + 13 * geo.uy)},${f1(by - 13 * geo.ux)}`,
    });
    if (arrow.style === 'hint') {
      const a = pt(arrow.from), b = pt(arrow.to);
      g.append(svgEl('circle', { class: 'arrow__ring', cx: a.x, cy: a.y, r: 50 }), svgEl('circle', { class: 'arrow__ring arrow__ring--to', cx: b.x, cy: b.y, r: 30 }));
    }
    g.append(under, line, head);
    gArrows.append(g);
    if (arrow.badge) {
      const mid = line.getPointAtLength(line.getTotalLength() / 2);
      const badge = svgEl('g', { class: 'arrow__badge' });
      const text = svgEl('text', { x: f1(mid.x), y: f1(mid.y), dy: '.36em' });
      text.textContent = arrow.badge;
      badge.append(svgEl('circle', { cx: f1(mid.x), cy: f1(mid.y), r: 15 }), text);
      g.append(badge);
    }
    if (mode === 'draw') {
      const len = Math.ceil(line.getTotalLength());
      for (const path of [under, line]) {
        path.style.strokeDasharray = `${len} ${len}`;
        anim(path, { strokeDashoffset: [len, 0] }, { duration: 350, easing: EASE.out });
      }
      anim(head, { transform: ['scale(0)', 'scale(1)'] }, { duration: 120, delay: 350, easing: EASE.back, fill: 'backwards' });
    } else if (mode === 'fade') {
      anim(g, { opacity: [0, 1] }, { duration: 100, easing: 'linear' });
    }
    // F3: with demo, a half-transparent copy of the piece slides along the arrow every 1.8 s.
    /** @type {HTMLElement|null} */
    let ghost = null;
    let timer = 0;
    if (arrow.demo && mover && !reduced) {
      const el = makeGhost(mover, arrow.from, 'is-demo');
      ghost = el;
      piecesEl.append(el);
      const a = toView(arrow.from, bottom), b = toView(arrow.to, bottom);
      const leg = kind === 'leg' ? horseLeg(arrow.from, arrow.to) : null;
      const slide = () => {
        if (!el.isConnected || reduced) return;
        const end = `translate(${f1((b.vx - a.vx) * c)}px, ${f1((b.vy - a.vy) * c)}px)`;
        /** @type {Keyframe[]} */
        const frames = [{ offset: 0, transform: 'translate(0px, 0px)', opacity: 0, easing: EASE.inout }, { offset: 0.1, opacity: 0.5 }];
        if (leg) {
          const l = toView(leg, bottom);
          frames.push({ offset: 0.3, transform: `translate(${f1((l.vx - a.vx) * c)}px, ${f1((l.vy - a.vy) * c)}px)` });
        }
        frames.push({ offset: 0.72, transform: end, opacity: 0.5 }, { offset: 1, transform: end, opacity: 0 });
        anim(el, frames, { duration: 700 });
      };
      timer = window.setInterval(slide, 1800);
      window.setTimeout(slide, mode === 'draw' ? 470 : 0);
    }
    return { node: g, ghost, timer };
  }

  /** @param {string|undefined} name  undefined = every group @param {number} ms */
  function removeArrows(name, ms) {
    for (const [key, entry] of [...arrowGroups]) {
      if (name !== undefined && key !== name) continue;
      arrowGroups.delete(key);
      for (const timer of entry.timers) window.clearInterval(timer);
      window.clearTimeout(entry.ttl);
      for (const ghost of entry.ghosts) ghost.remove();
      for (const node of entry.nodes) fadeOut(node, reduced ? 0 : ms);
    }
  }

  /** Arms the timeout that clears a group of arrows `ms` from now (F5 by ttl). @param {string} name @param {ArrowGroup} entry @param {number} ms */
  function expireArrows(name, entry, ms) {
    window.clearTimeout(entry.ttl);
    entry.until = performance.now() + ms;
    entry.ttl = window.setTimeout(() => { if (arrowGroups.get(name) === entry) removeArrows(name, 160); }, ms);
  }

  /** @param {Arrow[]} arrows @param {{group?:string, replace?:boolean, ttl?:number}} [opts] */
  function showArrows(arrows, opts = {}) {
    const name = opts.group ?? 'main';
    if (opts.replace !== false) removeArrows(name, 0);
    /** @type {ArrowGroup} */
    const entry = arrowGroups.get(name) ?? { arrows: [], nodes: [], ghosts: [], timers: [], ttl: 0, until: 0 };
    arrowGroups.set(name, entry);
    for (const arrow of arrows) {
      const built = buildArrow(arrow, reduced ? 'fade' : 'draw');
      entry.arrows.push(arrow);
      entry.nodes.push(built.node);
      if (built.ghost) entry.ghosts.push(built.ghost);
      if (built.timer) entry.timers.push(built.timer);
    }
    if (opts.ttl && opts.ttl > 0) expireArrows(name, entry, opts.ttl);
    if (arrows.length) play('arrow');
  }

  /** F5. @param {string} [name] */
  function clearArrows(name) {
    removeArrows(name, 160);
  }

  // ---- the hint spotlight (F2) --------------------------------------------------------------------------------------------

  /** @param {Highlight|null} h @param {number} outMs  fade of the previous highlight @param {boolean} [still]  redraw without the entrance */
  function setHighlight(h, outMs, still) {
    if (hl) {
      window.clearTimeout(hl.timer);
      for (const node of hl.nodes) fadeOut(node, reduced ? 0 : outMs);
      hl = null;
    }
    if (!h) return;
    const pieces = h.pieces ?? [], squares = h.squares ?? [];
    /** @type {Element[]} */
    const nodes = [];
    /** @type {{x:number, y:number, width:number, height:number}|null} */
    let box = null;
    if (squares.length) {
      const points = squares.map(pt);
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      box = { x: Math.min(...xs) - 46, y: Math.min(...ys) - 46, width: Math.max(...xs) - Math.min(...xs) + 92, height: Math.max(...ys) - Math.min(...ys) + 92 };
    }
    if (h.dim) {
      // a dark rect with holes: a circle over each highlighted piece, a rounded rect around the area
      const id = `bvm${uid}-${++artSeq}`;
      const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: VIEW_W, height: VIEW_H });
      mask.append(svgEl('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: '#fff' }));
      for (const sq of pieces) { const p = pt(sq); mask.append(svgEl('circle', { cx: p.x, cy: p.y, r: 56, fill: '#000' })); }
      if (box) mask.append(svgEl('rect', { ...box, rx: 24, fill: '#000' }));
      const spot = svgEl('rect', { class: 'bv-spot', x: 0, y: 0, width: VIEW_W, height: VIEW_H, rx: 26, mask: `url(#${id})` });
      gHl.append(mask, spot);
      nodes.push(mask, spot);
      if (!reduced && !still) anim(spot, { opacity: [0, 0.45] }, { duration: 250, easing: EASE.out });
    }
    const plain = h.dim ? '' : ' is-plain';
    if (box) {
      const area = svgEl('rect', { class: `bv-hlarea${plain}`, ...box, rx: 24 });
      gHl.append(area);
      nodes.push(area);
    }
    for (const sq of pieces) {
      const p = pt(sq);
      const ring = svgEl('circle', { class: `bv-hlring${plain}`, cx: p.x, cy: p.y, r: 52 });
      gHl.append(ring);
      nodes.push(ring);
      const rec = grid[sq.row]?.[sq.col];
      // each highlighted piece hops once
      if (rec && !reduced && !still) anim(rec.body, { translate: ['0px 0px', `0px ${f1(-0.15 * c)}px`, '0px 0px'] }, { duration: 240, easing: 'ease-out' });
    }
    const entry = { spec: h, nodes, timer: 0 };
    entry.timer = window.setTimeout(() => { if (hl === entry) setHighlight(null, 200); }, h.ttl ?? 6000);
    hl = entry;
  }

  /** @param {Highlight|null} h */
  function highlight(h) {
    setHighlight(h, 200);
  }

  // ---- ghost play (F6) --------------------------------------------------------------------------------------------------------

  function abortPreview() {
    if (preview) preview.restore();
  }

  /** @param {Move[]} moves @param {{stepMs?:number, from?:'now'|'trial'}} [opts] @returns {Promise<void>} */
  function previewLine(moves, opts = {}) {
    abortPreview();
    removeArrows(undefined, 0);
    if (!moves.length) return Promise.resolve();
    const stepMs = reduced ? 900 : opts.stepMs ?? 700;
    const n = moves.length;
    const tl = timeline();
    const d = deferred();
    /** @type {HTMLElement[]} */
    const ghosts = [];
    /** @type {HTMLElement[]} */
    const dimmed = [];
    /** What stands on each square of the imagined position: a real piece or a ghost. @type {Map<string, {el:HTMLElement, rec:Rec|null}>} */
    const stand = new Map();
    for (const rec of recs.values()) if (grid[rec.row]?.[rec.col] === rec || trial?.rec === rec) stand.set(code2(rec), { el: rec.el, rec });
    /** A real piece that is not on its square in the imagined position (it moved on, or it was taken) shows at 30 %. @param {HTMLElement} el */
    const dim = (el) => { el.classList.add('is-dimmed'); dimmed.push(el); };
    /** @param {Rec} rec @param {Square} sq */
    const ghostOf = (rec, sq) => { const el = makeGhost(rec, sq, 'is-preview'); piecesEl.append(el); ghosts.push(el); return el; };

    if (trial) {
      const { rec, move, aim } = trial;
      if ((opts.from ?? 'now') === 'trial') {
        // the line starts after the trial move: for an aim the mover's ghost already stands on the victim's square
        if (aim) {
          const victim = grid[move.to.row][move.to.col];
          if (victim) dim(victim.el);
          dim(rec.el);
          stand.delete(code2(move.from));
          stand.set(code2(move.to), { el: ghostOf(rec, move.to), rec: null });
        }
      } else if (!aim) {
        // the line starts from the committed position: there the piece that hovers on its trial square stands on its origin
        dim(rec.el);
        stand.delete(code2(move.to));
        stand.set(code2(move.from), { el: ghostOf(rec, move.from), rec: null });
      }
    }

    const badge = svgEl('g', { class: 'bv-counter' });
    const badgeText = svgEl('text', { x: 110, y: 22, dy: '.36em' });
    badge.append(svgEl('rect', { x: 78, y: 4, width: 64, height: 36, rx: 18 }), badgeText);
    gTop.append(badge);
    // On a small board the corner has no room for the counter (it lay over the file labels): there the same count rides
    // on the ghost that has just moved, like the 试 tag of a trial. board.css shows one or the other (CONTRACT-NOTES 138).
    const stepTag = document.createElement('span');
    stepTag.className = 'piece__tag piece__tag--step';
    host.classList.add('is-previewing');

    let over_ = false;
    const restore = () => {
      if (over_) return;
      over_ = true;
      preview = null;
      tl.flush();
      for (const el of ghosts) el.remove();
      for (const el of dimmed) el.classList.remove('is-dimmed');
      badge.remove();
      host.classList.remove('is-previewing');
      d.resolve();
    };
    preview = { restore };

    moves.forEach((move, i) => {
      tl.at(i * stepMs, (live) => {
        if (!live) return;
        badgeText.textContent = `${i + 1}/${n}`;
        const src = stand.get(code2(move.from));
        if (!src) return;
        const target = stand.get(code2(move.to));
        if (target) {
          if (target.rec) dim(target.el);                    // a ghost capture dims the real victim to 30 %
          else if (reduced) target.el.remove(); else fadeOut(target.el, 200);
        }
        const el = src.rec ? ghostOf(src.rec, move.from) : src.el;
        if (src.rec) dim(src.el);                            // the real piece stays where it is; its ghost goes on
        stand.delete(code2(move.from));
        stand.set(code2(move.to), { el, rec: null });
        stepTag.textContent = `${i + 1}/${n}`;
        (el.querySelector('.piece__body') ?? el).append(stepTag);
        const a = toView(move.from, bottom), b = toView(move.to, bottom);
        seat({ row: 0, col: 0, el }, move.to);
        if (!reduced) {
          anim(el, [{ transform: `translate(${f1((a.vx - b.vx) * c)}px, ${f1((a.vy - b.vy) * c)}px)` }, { transform: 'translate(0px, 0px)' }], { duration: 300, easing: EASE.inout });
        }
      });
    });
    // after the last step it holds 900 ms, then everything fades back (250 ms)
    tl.at(n * stepMs + 900, (live) => {
      if (!live || reduced) return;
      for (const el of ghosts) if (el.isConnected) anim(el, { opacity: [getComputedStyle(el).opacity, '0'] }, { duration: 250, easing: EASE.out, fill: 'forwards' });
      for (const el of dimmed.splice(0)) {                   // the real pieces come back while the ghosts leave
        const from = getComputedStyle(el).opacity;
        el.classList.remove('is-dimmed');
        anim(el, { opacity: [from, '1'] }, { duration: 250, easing: EASE.out });
      }
      anim(badge, { opacity: [1, 0] }, { duration: 250, easing: EASE.out, fill: 'forwards' });
      host.classList.remove('is-previewing');
    });
    tl.at(n * stepMs + 1150, () => restore(), true);
    return busy(d.promise);
  }

  // ---- board lifecycle (G1 - G5) -----------------------------------------------------------------------------------------------

  function buildScenery() {
    // The sand table draws its own river and frame (table-art.js): the decoration layers of version 1 stay empty.
    riverInner.style.backgroundImage = '';
    deco.replaceChildren();
    applyTension();
  }

  /** Draws the art for the current theme and orientation. @param {boolean} fade  G3: the old art fades out on top (200 ms) */
  function buildArt(fade) {
    const next = layerSvg('bv-art');
    next.innerHTML = tableArt(theme, bottom, artSeq += 1);                 // a static template: no external data
    const old = art;
    art = next;
    if (fade && !reduced && old.isConnected) {
      old.before(next);                                      // the new art underneath, the old one fading on top
      old.dataset.theme = host.dataset.theme ?? theme;       // it keeps the tokens it was drawn with
      old.classList.add('is-leaving');
      exit(old, { opacity: [1, 0] }, { duration: 200, easing: 'linear' });
    } else {
      old.replaceWith(next);
    }
  }

  function applyTension() {
    host.style.setProperty('--tension', String(tension));
    host.style.setProperty('--vignette', String(Math.max(0, Math.min(0.8, (tension - 0.5) * 1.6))));
    for (const a of riverInner.getAnimations()) a.playbackRate = 0.6 + 1.4 * tension;
  }

  /** @param {number} x */
  function setTension(x) {
    tension = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
    applyTension();
  }

  /** @param {ThemeId} next */
  function setTheme(next) {
    if (next === theme) return;
    theme = next;
    buildArt(true);
    host.dataset.theme = next;
    buildScenery();
    fx.refreshPalette();
  }

  /** Redraws every mark from the state it stands for, without animation (the orientation changed). */
  function redrawMarks() {
    selSig = null;
    renderSelection(false);
    renderLastMove();
    renderCheck(false);
    clearCellClasses('is-trial-from', 'is-trial-to');         // the cells stand for other squares now
    if (trial) {
      const t = trial;
      const ghost = t.ghost;
      t.ghost = null;
      ghost?.remove();
      removeTrialMarks(t, 0);
      if (t.built) void buildTrial(t, 0, false, false);
      cellAt(t.move.from).classList.add('is-trial-from');
      cellAt(t.move.to).classList.add('is-trial-to');
    }
    const groups = [...arrowGroups];
    removeArrows(undefined, 0);
    for (const [name, entry] of groups) {
      /** @type {ArrowGroup} */
      const fresh = { arrows: entry.arrows, nodes: [], ghosts: [], timers: [], ttl: 0, until: 0 };
      for (const arrow of entry.arrows) {
        const built = buildArrow(arrow, 'still');
        fresh.nodes.push(built.node);
        if (built.ghost) fresh.ghosts.push(built.ghost);
        if (built.timer) fresh.timers.push(built.timer);
      }
      arrowGroups.set(name, fresh);
      if (entry.until > 0) expireArrows(name, fresh, Math.max(0, entry.until - performance.now()));
    }
    if (hl) setHighlight(hl.spec, 0, true);
  }

  /** @param {Color} next */
  function setOrientation(next) {
    if (next === bottom) return;
    cancelAnimations();
    bottom = next;
    labels = fileLabels(bottom);
    host.dataset.bottom = bottom;
    buildArt(false);
    buildScenery();
    mapCells();
    for (const rec of recs.values()) seat(rec, rec);
    refreshCells();
    redrawMarks();
  }

  /** @param {boolean} on */
  function setInteractive(on) {
    interactive = !!on;
    host.classList.toggle('is-interactive', interactive);
    if (!interactive) {
      if (drag) endDrag(false, true);
      down = null;
      for (const rec of recs.values()) rec.el.classList.remove('is-hover', 'is-pressed');
    }
    refreshCells();
  }

  /** G1: every piece drops into place, then 开战！ @returns {Promise<void>} */
  function deal() {
    const tl = timeline();
    const d = deferred();
    let last = 0;
    play('deal');
    if (!reduced) {
      for (const rec of recs.values()) {
        const { vx, vy } = toView(rec, bottom);
        const delay = 14 * (vx + 2 * Math.min(vy, 9 - vy));
        last = Math.max(last, delay + 220);
        anim(rec.el, [{ transform: `translateY(${f1(-0.8 * c)}px)`, opacity: 0 }, { transform: 'translateY(0px)', opacity: 1 }], { duration: 220, delay, easing: EASE.back, fill: 'backwards' });
      }
    }
    tl.at(last, (live) => { if (live) fx.banner('start').then(d.resolve, d.resolve); else d.resolve(); }, true);
    return Promise.all([tl.done(last), d.promise]).then(() => {});
  }

  /** @param {Board} board @param {{lastMove?:Move|null, lastActor?:Actor, deal?:boolean}} [opts] @returns {Promise<void>} */
  function setPosition(board, opts = {}) {
    cancelAnimations();
    if (trial) dropTrial();
    selection = null;
    selSig = null;
    check = null;
    removeArrows(undefined, 0);
    setHighlight(null, 0);
    for (const g of [gMisc, gTop]) g.replaceChildren();
    sync(board);
    renderSelection(false);
    renderCheck(false);
    setLastMove(opts.lastMove ?? null, opts.lastActor);
    return opts.deal ? deal() : Promise.resolve();
  }

  /** G2. @param {Move[]} steps  newest first @param {Board} board  the position after the undo @returns {Promise<void>} */
  function undoMoves(steps, board) {
    abortPreview();
    if (drag) endDrag(false, true);
    if (trial) dropTrial();
    clearSelection();
    check = null;
    renderCheck(false);
    removeArrows(undefined, 0);
    setHighlight(null, 0);
    lastMove = null;
    renderLastMove();
    play('undo');
    if (reduced || !steps.length) {
      sync(board);
      return Promise.resolve();
    }
    const tl = timeline();
    steps.forEach((step, i) => {
      tl.at(i * 120, (live) => {
        if (!live) return;                                   // the final sync below snaps everything
        const rec = recs.get(step.piece.id);
        if (rec) {
          if (grid[step.to.row][step.to.col] === rec) grid[step.to.row][step.to.col] = null;
          grid[step.from.row][step.from.col] = rec;
          travel(rec, step.from, { ms: 200, ease: EASE.inout, restyle: () => { rec.el.classList.remove('is-fallen', 'is-grey', 'is-selected', 'is-lifted'); } });
        }
        if (step.captured) {
          // the captured piece re-materialises
          const back = recs.get(step.captured.id) ?? createRec(step.captured);
          resetRec(back);
          seat(back, step.to);
          grid[step.to.row][step.to.col] = back;
          anim(back.el, [{ transform: 'scale(0)', opacity: 0 }, { offset: 0.7, transform: 'scale(1.1)', opacity: 1 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: EASE.out });
          fx.burst('sparks', px(step.to), { n: 6 });
        }
        const earlier = steps[i + 1];
        lastMove = earlier ? { move: earlier, actor: earlier.piece.color === bottom ? 'me' : 'rival' } : null;
        renderLastMove();
      });
    });
    const total = (steps.length - 1) * 120 + 220;
    tl.at(total, () => { lastMove = null; renderLastMove(); sync(board); }, true);
    return busy(tl.done(total));
  }

  /** A5. @param {Square} sq */
  function nudge(sq) {
    const rec = grid[sq.row]?.[sq.col] ?? (selection ? grid[selection.sq.row][selection.sq.col] : null);
    play('illegal');
    fx.haptic('illegal');
    if (!rec) return;
    if (reduced) {
      anim(rec.body, { opacity: [1, 0.5, 1] }, { duration: 120, easing: 'linear' });
      return;
    }
    const a = `${f1(0.08 * c)}px`;
    anim(rec.body, { translate: ['0px', `-${a}`, a, `-${a}`, a, `-${a}`, a, '0px'] }, { duration: 240, easing: 'linear' });
  }

  /** @param {boolean} on */
  function setReducedMotion(on) {
    const next = !!on;
    if (next === reduced) return;
    reduced = next;
    if (reduced) {
      for (const entry of arrowGroups.values()) {            // the demo ghosts are motion only; the group's ttl stays
        for (const timer of entry.timers) window.clearInterval(timer);
        for (const ghost of entry.ghosts) ghost.remove();
        entry.timers = [];
        entry.ghosts = [];
      }
    }
    applyTension();
  }

  // ---- input (§10.2.5) ---------------------------------------------------------------------------------------------------------

  /** @type {{id:number, cell:HTMLButtonElement, sq:Square, x:number, y:number, touch:boolean, pressed:HTMLElement|null}|null} */
  let down = null;
  /** @type {{id:number, rec:Rec, from:Square, x0:number, y0:number, k:number, ox:number, oy:number, x:number, y:number, frame:number, magnet:Move|null, ring:SVGElement|null}|null} */
  let drag = null;

  /** @param {EventTarget|null} target @returns {HTMLButtonElement|null} */
  const cellOf = (target) => (target instanceof Element ? /** @type {HTMLButtonElement|null} */ (target.closest('.board-cell')) : null);

  /** True while a tap on the trial's destination is still swallowed. @param {Square} sq */
  const guarded = (sq) => !!trial && same(sq, trial.move.to) && performance.now() < trial.landAt + trial.guardMs;

  /** A cell was activated. @param {Square} sq @param {'tap'|'drag'|'key'} via */
  function pick(sq, via) {
    if (!interactive || destroyed) return;
    abortPreview();                                          // any pick ends ghost play and the spotlight
    if (hl) setHighlight(null, 200);
    if (guarded(sq)) return;                                 // never reported for the trial's destination before the guard elapsed
    emit('board:pick', { row: sq.row, col: sq.col, via });
  }

  /** @param {PointerEvent} e */
  function onPointerDown(e) {
    if (!interactive || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cell = cellOf(e.target);
    if (!cell) return;
    if (drag) endDrag(false, true);
    const sq = cellSquare(cell);
    down = { id: e.pointerId, cell, sq, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', pressed: null };
    if (trial && guarded(sq)) {                              // during the guard the piece only shows that it was touched
      down.pressed = trial.rec.el;
      trial.rec.el.classList.add('is-pressed');
    }
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    if (drag && e.pointerId === drag.id) {
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.frame) drag.frame = requestAnimationFrame(dragFrame);
      return;
    }
    if (!down || e.pointerId !== down.id || !interactive) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) {     // the button was released outside the board: not a press any more
      down.pressed?.classList.remove('is-pressed');
      down = null;
      return;
    }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved <= Math.max(10, 0.3 * c)) return;
    const rec = grid[down.sq.row][down.sq.col];
    const start = down;
    down.pressed?.classList.remove('is-pressed');
    down = null;                                             // too far for a tap
    if (!rec || rec.color !== bottom || (trial && trial.rec === rec)) return;
    // A drag: the origin is picked first (unless that piece is already selected), then the piece follows the pointer.
    if (!(selection && same(selection.sq, start.sq) && !trial)) pick(start.sq, 'drag');
    if (destroyed || !rec.el.isConnected || grid[start.sq.row][start.sq.col] !== rec || (trial && trial.rec === rec)) return;
    const k = screenScale();
    const box = host.getBoundingClientRect();
    const home = px(start.sq);
    stopMoving(rec);
    rec.el.classList.add('is-dragging');
    drag = {
      id: start.id, rec, from: start.sq, x0: start.x, y0: start.y, k,
      // a mouse keeps the offset at which the piece was grabbed; under a finger the piece is centred .6 c above the
      // contact point, so the finger does not cover it
      ox: start.touch ? (start.x - box.left) / k - home.x : 0, oy: start.touch ? (start.y - box.top) / k - home.y - 0.6 * c : 0,
      x: e.clientX, y: e.clientY, frame: 0, magnet: null, ring: null,
    };
    try { hit.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    dragFrame();
  }

  /** A6: the piece tracks the pointer (coalesced to one write per frame); the nearest marked target within .6 c gets the magnet ring. */
  function dragFrame() {
    if (!drag) return;
    const g = drag;
    g.frame = 0;
    const dx = (g.x - g.x0) / g.k + g.ox, dy = (g.y - g.y0) / g.k + g.oy;
    g.rec.el.style.translate = `${f1(dx)}px ${f1(dy)}px`;
    const home = px(g.from);
    const at = { x: home.x + dx, y: home.y + dy };
    /** @type {Move|null} */
    let best = null;
    let bestD = 0.6 * c;
    if (selection && same(selection.sq, g.from)) {
      for (const move of selection.targets) {
        const p = px(move.to);
        const far = Math.hypot(p.x - at.x, p.y - at.y);
        if (far <= bestD) { best = move; bestD = far; }
      }
    }
    if (best !== g.magnet) {
      g.magnet = best;
      g.ring?.remove();
      g.ring = null;
      if (best) {
        const p = pt(best.to);
        g.ring = svgEl('circle', { class: 'bv-magnet', cx: p.x, cy: p.y, r: 56 });
        gTop.append(g.ring);
      }
    }
  }

  /** @param {boolean} drop  released (true) or cancelled @param {boolean} [silent]  no events: the view itself ended the drag */
  function endDrag(drop, silent) {
    if (!drag) return;
    const g = drag;
    drag = null;
    if (g.frame) cancelAnimationFrame(g.frame);
    g.ring?.remove();
    try { hit.releasePointerCapture(g.id); } catch { /* not captured any more */ }
    const el = g.rec.el;
    const back = () => {
      // A7: the piece returns to its square
      const from = el.style.translate || '0px 0px';
      el.style.translate = '';
      el.classList.remove('is-dragging');
      if (!reduced && !silent) anim(el, { translate: [from, '0px 0px'] }, { duration: 180, easing: EASE.out });
    };
    if (silent) { back(); return; }
    if (drop && g.magnet) {
      pick(g.magnet.to, 'drag');                             // the following showTentative animates from where the piece is now
      if (el.style.translate) back();                        // nobody took it (the pick was refused)
      return;
    }
    back();
    emit('board:dragcancel', { row: g.from.row, col: g.from.col });
  }

  /** @param {PointerEvent} e */
  function onPointerUp(e) {
    if (drag && e.pointerId === drag.id) { endDrag(true); return; }
    if (!down || e.pointerId !== down.id) return;
    const start = down;
    down = null;
    start.pressed?.classList.remove('is-pressed');
    // a tap: pointerup within 10 px of its pointerdown
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 10) pick(start.sq, 'tap');
  }

  /** @param {PointerEvent} e */
  function onPointerCancel(e) {
    if (drag && e.pointerId === drag.id) { endDrag(false); return; }
    if (down && e.pointerId === down.id) {
      down.pressed?.classList.remove('is-pressed');
      down = null;
    }
  }

  /** Keyboard and assistive activation arrive as a click without a pointer (detail 0); pointer taps were handled on pointerup. @param {MouseEvent} e */
  function onClick(e) {
    const cell = cellOf(e.target);
    if (!cell || e.detail !== 0) return;
    pick(cellSquare(cell), 'key');
  }

  /** Arrow keys move the focus in view space. @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (!interactive) return;
    const cell = cellOf(e.target);
    if (!cell) return;
    const step = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null;
    if (!step) return;
    e.preventDefault();
    const { vx, vy } = toView(cellSquare(cell), bottom);
    const nx = Math.max(0, Math.min(8, vx + step[0])), ny = Math.max(0, Math.min(9, vy + step[1]));
    cellEls[ny * 9 + nx].focus();
  }

  /** @param {FocusEvent} e */
  function onFocusIn(e) {
    const cell = cellOf(e.target);
    if (!cell) return;
    const sq = cellSquare(cell);
    focusTouched = true;
    if (!same(focusSq, sq)) {
      if (focusSq) cellAt(focusSq).tabIndex = -1;
      focusSq = sq;
      cell.tabIndex = 0;
    }
    emit('board:cellfocus', { row: sq.row, col: sq.col });
  }

  /** A8: a mouse over one of the child's pieces lifts it a little. @param {PointerEvent} e */
  function onPointerOver(e) {
    if (e.pointerType !== 'mouse' || !interactive) return;
    const cell = cellOf(e.target);
    if (!cell) return;
    const sq = cellSquare(cell);
    const rec = grid[sq.row][sq.col];
    if (rec && rec.color === bottom) rec.el.classList.add('is-hover');
  }

  /** @param {PointerEvent} e */
  function onPointerOut(e) {
    const cell = cellOf(e.target);
    if (!cell) return;
    const sq = cellSquare(cell);
    grid[sq.row][sq.col]?.el.classList.remove('is-hover');
  }

  hit.addEventListener('pointerdown', onPointerDown);
  hit.addEventListener('pointermove', onPointerMove);
  hit.addEventListener('pointerup', onPointerUp);
  hit.addEventListener('pointercancel', onPointerCancel);
  hit.addEventListener('pointerover', onPointerOver);
  hit.addEventListener('pointerout', onPointerOut);
  hit.addEventListener('click', onClick);
  hit.addEventListener('keydown', onKeyDown);
  hit.addEventListener('focusin', onFocusIn);
  // A river drift that starts later (motion switched back on, another theme) takes the current tension's speed.
  riverInner.addEventListener('animationstart', applyTension);

  // ---- start ---------------------------------------------------------------------------------------------------------------------

  const resizer = new ResizeObserver(() => { if (!destroyed) measure(); });
  buildArt(false);
  mapCells();
  buildScenery();
  refreshCells();
  measure();
  fx.mount(fxEl);
  resizer.observe(host);

  function destroy() {
    if (destroyed) return;
    cancelAnimations();
    destroyed = true;
    resizer.disconnect();
    removeArrows(undefined, 0);
    setHighlight(null, 0);
    if (busyCount > 0) { busyCount = 0; delete root.dataset.uiBusy; }
    hit.removeEventListener('pointerdown', onPointerDown);
    hit.removeEventListener('pointermove', onPointerMove);
    hit.removeEventListener('pointerup', onPointerUp);
    hit.removeEventListener('pointercancel', onPointerCancel);
    hit.removeEventListener('pointerover', onPointerOver);
    hit.removeEventListener('pointerout', onPointerOut);
    hit.removeEventListener('click', onClick);
    hit.removeEventListener('keydown', onKeyDown);
    hit.removeEventListener('focusin', onFocusIn);
    riverInner.removeEventListener('animationstart', applyTension);
    recs.clear();
    host.replaceChildren();
    host.classList.remove('bv', 'is-interactive', 'is-trialing', 'is-previewing');
    host.style.removeProperty('--c');
    host.style.removeProperty('--tension');
    host.style.removeProperty('--vignette');
    delete host.dataset.bottom;
    delete host.dataset.theme;
  }

  return {
    setPosition,
    setOrientation,
    setTheme,
    setInteractive,
    setSelection,
    showTentative,
    setTrialGuard,
    retractTentative,
    commitTentative,
    playMove,
    undoMoves,
    nudge,
    setLastMove,
    setCheck,
    showArrows,
    clearArrows,
    highlight,
    previewLine,
    setTension,
    cancelAnimations,
    squareCenter: (sq) => px(sq),
    cell: () => c,
    setReducedMotion,
    destroy,
  };
}
