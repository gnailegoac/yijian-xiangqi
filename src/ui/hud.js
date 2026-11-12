// Everything around the board: top bar, under-bar, action buttons, the three pouches, start overlay, game-over
// card, menu and its sheets, dialogs, toast, blocking notice (SPEC §4.28.7; regions §12.3, overlays §12.5 - §12.6).
// Package X7. Styles: styles/hud.css. Strings: ./texts.js.
//
// Events, dispatched on #app (bubbling CustomEvents):
//   hud:action  {action, card?} card: true when a button of the game-over card sent it (the stage then holds what lies
//                               under the card while it leaves; CONTRACT-NOTES 150)
//                               'undo'            #undo-button, in every phase. It reads 悔棋 in every phase, also at game
//                                                 over, where it still takes the last move back (§5.5; CONTRACT-NOTES
//                                                 116). 回看 is the name of the conversation history only (chat-panel.js)
//                               'hint'            #hint-button
//                               'confirm' 'retract'   #confirm-button, #retract-button
//                               'new-game'        #newgame-button, the card's 再来一局, the menu's 新对局
//                               'resign'          the menu's 认输 (the dialog is asked for through confirm('resign'))
//                               'review'          "show me the board and the last move again": the last-move line of the
//                                                 under-bar, and the card's 回看棋局 (the hud has closed the card by then)
//                               'mute'            #mute-button (the stage answers with setMuted)
//                               'retry-opponent'  #retry-opponent and the retry button of the action slot
//                               'retry-engine'    the blocking notice
//                               'export'          下载棋谱 in the notation sheet
//                               'export-backup'   导出存档 in the settings sheet
//   hud:setting {key, value}    one control of the settings sheet changed (key of Settings); also the side picked in
//                               the new-game dialog when it differs from settings.side
//   hud:import  {text}          the text of the file picked with 导入存档 (settings sheet or start overlay)
//
// How the hud is wired (for stage.js):
//   - The rival's plate: createHud keeps every node that is already inside hosts.topbar and moves it into its
//     .hud-top__rival slot. So the stage appends the host element of createRivalView to #topbar first, then
//     creates the hud. (A host appended to .hud-top__rival afterwards works as well.)
//   - openSettings(settings, status) only hands over data (CONTRACT-NOTES 71, 82). The sheet opens when the child
//     taps 设置 in the menu or on the start overlay, and is re-drawn in place when new data arrives while it shows.
//   - setNotation(rows, current): `current` is the number of plies played (the latest ply, 1-based; 0 = none). The
//     last-move line under the board shows the last cell of `rows`.
//   - The action slot follows setPhase. With `failed` in opponentTurn the pouches stay disabled but no longer say
//     对方正在想…; in the compact layout, where the under-bar has no room for #retry-opponent and its status line,
//     a retry button takes the place of the pouches instead.
//   - Overlays are <dialog open> elements inside #overlays (never the top layer, so the toast stays above them);
//     `#overlays .hud-layer:not(.is-closing) > dialog[open]` tells whether one is showing (one that is fading out
//     keeps its node for up to 300 ms with .is-closing; under reduced motion it is removed at once). While a modal
//     one is open, keydown events stop at the document (Esc closes the top one, Tab is trapped in the one that is
//     drawn on top), so game shortcuts do not reach the board behind it.
//   - Double taps (TAP_GUARD_MS = 350): a slot of the action bar that has just come in (the pouches, 再来一局) is
//     inert for that long, a tap on the dimmed area around a menu, sheet or dialog is ignored for that long after
//     it opened, and an overlay that is fading out still takes the taps. A scripted click on #hint-button or
//     #newgame-button right after a phase change therefore waits a moment (the element cannot be hit while inert).
//     The buttons of the game-over card are held the same way when the card comes up, and longer while a burst of
//     taps goes on (showOver). While a game is over and its card is still to come, the stage calls holdNewGame(true):
//     再来一局 of the action bar and 新对局 of the menu are disabled until the card is up (or will not come), and
//     新对局 of the menu then stays disabled for as long as the card's own buttons are held.
//   - Trophies: six discs and +n (§12.3). A phone narrower than 416 px shows the newest four, or the newest three
//     and the counter, because the plate's thinking dots need the room beside it; while 司马懿 speaks a line there,
//     the round and the trophies are hidden for those 2.4 s (hud.css reads the plate's .rival[data-say]).
//   - The landscape-phone card (TXT.rotate, §12.2) is shown by the hud itself from a media query.
//   - Motion follows html[data-motion]: transitions and loops run only with "full".
//
// DOM hooks (§4.28.9): #menu-button #mute-button #undo-button #retry-opponent #hint-button[data-level]
//   #retract-button #confirm-button #newgame-button #toast
//   dialog[data-dialog="start|new-game|resign|settings|notation|rules|about|over|blocking"]
//   [data-choice]: start "continue" | "new" | "import"; resign and new-game "keep" | "go"; new-game side
//   "red" | "black"; over "again" | "review"; blocking "retry".
//   Inside the hud's own overlays (not part of the contract's table, kept stable for tests):
//   .hud-menu__item[data-menu="new-game|notation|settings|rules|resign|about"];
//   settings: .hud-switch[aria-label], .hud-seg__opt[data-value], .hud-theme[data-value], .hud-range,
//   [data-action="export-backup"|"import-backup"]; notation: [data-action="export"]; start: [data-action="settings"];
//   the one <input type="file"> in #overlays takes the backup file (hud:import).

import { END_WORD } from '../core/codes.js';
import { pieceLabel } from '../core/engine.js';
import { createBuddy } from './buddy.js';
import { TXT } from './texts.js';

/** @import { Color, Piece } from '../core/types.js' */
/** @import { CoachOffReason, OverView, Phase, Settings } from '../game/types.js' */
/** @import { AudioEngine, Buddy, Hud } from './types.js' */
/** @import { createRivalView } from './rival-view.js' */

/** @typedef {'undo'|'hint'|'confirm'|'retract'|'new-game'|'resign'|'review'|'mute'|'retry-opponent'|'retry-engine'|'export'|'export-backup'} HudAction */
/** @typedef {{mode:'llm'|'local', reason:CoachOffReason|null, rank:string}} CoachInfo */
/** @typedef {'settings'|'notation'|'rules'|'about'} SheetKind */
/** @typedef {'hint'|'trial'|'over'} SlotName */
/**
 * One modal overlay.
 * @typedef {Object} Layer
 * @property {HTMLElement} root            the full-size wrapper inside #overlays
 * @property {HTMLElement} panel           the dialog (or the menu) inside it
 * @property {number} rank                 stacking rank (LAYER_RANK): the keyboard belongs to the highest open one
 * @property {(() => void)|null} dismiss   Esc and a tap outside; null = cannot be dismissed
 * @property {boolean} menu                arrow keys move between its items
 * @property {Element|null} returnFocus
 * @property {number} closeMs
 * @property {boolean} closed
 */

// ---------------------------------------------------------------------------------------------------------------------
// Strings the contract gives outside TXT, and screen-reader names of the icon-only buttons
// ---------------------------------------------------------------------------------------------------------------------

const WORDMARK = '弈间';                       // §12.5
const ROUND_PARTS = ['第 ', ' 回合'];          // §12.3 「第 N 回合」
const LAST_PREFIX = '上一步：';                // §12.3 「上一步：马8进7」
/** Accessible names of buttons that show an icon only (never visible text). */
const ARIA = { menu: '菜单', mute: '静音', close: '关闭' };

const TOAST_MS = 2600;
const TROPHY_MAX = 6;                          // §12.3: at most six discs, then +n
const TROPHY_NARROW = 4;                       // a narrow phone has room for four discs, or three and the counter (hud.css)
/** The stacking order of the modal overlays, as hud.css draws them (z-index); equal ranks stack in opening order. */
const LAYER_RANK = { start: 1, menu: 2, sheet: 2, dialog: 3, blocking: 4 };
/** Children double-tap. A control that has just appeared under the finger does not take the second tap: 再来一局
 *  and the pouches that replace another button in the action slot, and the "tap outside" of a fresh overlay. */
const TAP_GUARD_MS = 350;
/** The buttons of the game-over card when it comes up: a tap that arrives while they are held holds them this much
 *  longer, but never past CARD_BURST_MAX_MS after the card came up (the stage holds what lies around the card alike). */
const TAP_BURST_MS = 500;
const CARD_BURST_MAX_MS = 4000;
const IMPORT_MAX_BYTES = 4 * 1024 * 1024;      // a backup is a few kilobytes; anything huge is not one

/** What the settings sheet shows before the stage has handed over real data (the defaults of §3.9). @type {Settings} */
const DEFAULT_SETTINGS = { schema: 2, theme: 'shachang', look: 2, sfx: true, music: true, volume: 1, motion: 'auto', haptics: true,
                           typeTicks: false, readAloud: false, side: 'red', coach: 'auto', freeText: true, talk: 'smart' };

// ---------------------------------------------------------------------------------------------------------------------
// Static SVG templates (no external data)
// ---------------------------------------------------------------------------------------------------------------------

/** 24 x 24 line icons; stroke = currentColor. */
const ICON = {
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  note: '<path d="M9.5 17.2V6.6l8.8-2v10.6"/><ellipse cx="7.2" cy="17.4" rx="2.4" ry="2"/><ellipse cx="16" cy="15.4" rx="2.4" ry="2"/>'
      + '<path class="hud-ico__slash" d="M4.5 4.5l15 15"/>',
  undo: '<path d="M8.5 5.5 4 10l4.5 4.5"/><path d="M4.5 10H14a5 5 0 0 1 0 10h-3.5"/>',
  swap: '<path d="M6 8h12.5l-3-3"/><path d="M18 16H5.5l3 3"/>',
  check: '<path d="M5 12.6l4.6 4.6L19 7.6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  plus: '<circle cx="12" cy="12" r="8.4"/><path d="M12 8.2v7.6M8.2 12h7.6"/>',
  scroll: '<path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 12.5h6M9 16h3.5"/>',
  sliders: '<path d="M5 7h7M16.5 7H19M5 12h1.5M11 12h8M5 17h8M17.5 17H19"/><circle cx="14.2" cy="7" r="2.1"/><circle cx="8.8" cy="12" r="2.1"/><circle cx="15.2" cy="17" r="2.1"/>',
  book: '<path d="M12 6.6C9.6 5.1 6.6 5 4 6v12c2.6-1 5.6-.9 8 .6 2.4-1.5 5.4-1.6 8-.6V6c-2.6-1-5.6-.9-8 .6z"/><path d="M12 6.6v12"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5.2c4-2 6.5 1.8 12 0v8c-5.5 1.8-8-2-12 0"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.4"/><path d="M12 7.7v.2"/>',
  retry: '<path d="M19 12a7 7 0 1 1-2.3-5.2"/><path d="M19.2 4.2v4h-4"/>',
  download: '<path d="M12 4.5v10M7.6 10.4 12 14.8l4.4-4.4M5 19.2h14"/>',
  upload: '<path d="M12 15V5M7.6 9.2 12 4.8l4.4 4.4M5 19.2h14"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 11.9v.2"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  play: '<path fill="currentColor" d="M8.5 5.6v12.8L19 12z"/>',
};

/** One 锦囊 (28 x 28): the tied pouch and, hidden until it is opened, the untied one with its slip of paper. */
const POUCH = '<svg viewBox="0 0 28 28" focusable="false">'
  + '<g class="hud-pouch__tied">'
  + '<path class="p-bag" d="M9.6 9.8 7.5 4.4c2.2 1.3 4.3 1.3 6.5 0 2.2 1.3 4.3 1.3 6.5 0l-2.1 5.4z"/>'
  + '<path class="p-bag" d="M7.2 12.4C3.5 15.8 3.2 25 14 25s10.5-9.2 6.8-12.6c-1.2-1.1-2.2-1.7-2.5-2.6H9.7c-.3.9-1.3 1.5-2.5 2.6z"/>'
  + '<path class="p-mark" d="M14 15.4l2.9 2.9-2.9 2.9-2.9-2.9z"/>'
  + '<path class="p-cord" d="M9.2 10.4h9.6"/><path class="p-tassel" d="M12.8 11.4 11.2 15M15.2 11.4l1.6 3.6"/><circle class="p-knot" cx="14" cy="10.4" r="1.7"/>'
  + '</g>'
  + '<g class="hud-pouch__open">'
  + '<ellipse class="p-in" cx="14" cy="13.6" rx="8" ry="2.7"/>'
  + '<path class="p-slip" d="M10.4 13.6 11.5 2.8l6.6.9-1.1 9.9z"/><path class="p-ink" d="M13 5.8l3.2.4M12.8 8.4l3.2.4"/>'
  + '<path class="p-bag" d="M6 13.6c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7c2.9 3.9 2.6 11.4-8 11.4S3.1 17.5 6 13.6z"/>'
  + '<path class="p-mark" d="M14 17.6l2.5 2.5-2.5 2.5-2.5-2.5z"/>'
  + '<path class="p-tassel" d="M5.4 15.6c-1.5 1.2-1.9 2.8-1.3 4.6M22.6 15.6c1.5 1.2 1.9 2.8 1.3 4.6"/>'
  + '</g></svg>';

/** A brush stroke stretched behind the wordmark (the stroke of the banners, §10.4.4). */
const BRUSH = '<svg class="hud-brush" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
  + '<path d="M4 30C20 8 60 6 110 10S230 4 300 9S380 12 396 28C392 46 350 54 290 51S150 57 90 52S14 50 4 30Z"/></svg>';

/** The crest of the game-over card, by result (120 x 84). */
const CREST = { win: laurel(), loss: pennant(), draw: rings() };

/** A laurel wreath around a star (also the static laurel of E6 under reduced motion). */
function laurel() {
  const cx = 60, cy = 40, r = 30;
  let leaves = '';
  for (let i = 0; i < 6; i++) {
    const a = 112 + i * 22;                                    // degrees, clockwise from +x in SVG space: up the left side
    const rad = a * Math.PI / 180;
    const x = cx + r * Math.cos(rad), y = cy + r * Math.sin(rad);
    for (const lean of [-38, 38]) {
      const leaf = `<path d="M0 0Q6.5 -5 14 0Q6.5 5 0 0Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a + 90 + lean})"/>`;
      leaves += leaf;
    }
  }
  let star = '';
  for (let i = 0; i < 10; i++) {
    const rad = (i * 36 - 90) * Math.PI / 180, len = i % 2 ? 7.4 : 17;
    star += `${i ? 'L' : 'M'}${(cx + len * Math.cos(rad)).toFixed(1)} ${(cy - 1 + len * Math.sin(rad)).toFixed(1)}`;
  }
  return '<svg viewBox="0 0 120 84" focusable="false">'
    + `<g class="c-leaf">${leaves}</g><g class="c-leaf" transform="translate(120 0) scale(-1 1)">${leaves}</g>`
    + `<path class="c-stem" d="M49 70q11 5 22 0"/><path class="c-star" d="${star}Z"/></svg>`;
}

/** A pennant that still flies: the crest of a lost game. */
function pennant() {
  return '<svg viewBox="0 0 120 84" focusable="false">'
    + '<path class="c-ground" d="M30 74q30-13 60 0z"/>'
    + '<path class="c-pole" d="M48 72V12"/><circle class="c-knob" cx="48" cy="10" r="3.4"/>'
    + '<path class="c-flag" d="M48 15c14-5 21 6 36 1l-7 13 7 13c-15 5-22-6-36-1z"/>'
    + '<path class="c-fold" d="M56 24c8-2 13 3 20 2M56 33c8-2 13 3 20 2"/></svg>';
}

/** Two linked rings in the two camps' colours: the crest of a draw. */
function rings() {
  return '<svg viewBox="0 0 120 84" focusable="false">'
    + '<circle class="c-ring c-ring--shu" cx="47" cy="42" r="20"/><circle class="c-ring c-ring--wei" cx="73" cy="42" r="20"/>'
    + '<path class="c-ring c-ring--shu" d="M60 26.8A20 20 0 0 1 67 42"/></svg>';        // over the other ring at the upper crossing
}

// ---------------------------------------------------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {Document} doc
 * @param {K} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {Document} doc @param {keyof typeof ICON} name @returns {HTMLSpanElement} */
function icon(doc, name) {
  const span = make(doc, 'span', 'hud-ico');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${ICON[name]}</svg>`;      // static template
  return span;
}

/**
 * @param {Document} doc
 * @param {{ id?:string, cls:string, label?:string, ico?:keyof typeof ICON, choice?:string, aria?:string }} o
 * @returns {HTMLButtonElement}
 */
function button(doc, o) {
  const b = make(doc, 'button', o.cls);
  b.type = 'button';
  if (o.id) b.id = o.id;
  if (o.choice) b.dataset.choice = o.choice;
  if (o.aria) b.setAttribute('aria-label', o.aria);
  if (o.ico) b.append(icon(doc, o.ico));
  if (o.label !== undefined) b.append(make(doc, 'span', 'hud-btn__label', o.label));
  return b;
}

/** A piece as a micro-disc. @param {Document} doc @param {{type:Piece['type'], color:Color}} piece @returns {HTMLSpanElement} */
function disc(doc, piece) {
  const d = make(doc, 'span', 'hud-disc', pieceLabel(piece));
  d.dataset.color = piece.color;
  d.dataset.type = piece.type;
  return d;
}

/** Elements inside `rootEl` that Tab can reach, in order. @param {HTMLElement} rootEl @returns {HTMLElement[]} */
function tabbable(rootEl) {
  /** @type {HTMLElement[]} */
  const out = [];
  for (const node of rootEl.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')) {
    const e = /** @type {HTMLElement & {disabled?:boolean}} */ (node);
    if (e.disabled || e.tabIndex < 0 || e.closest('[hidden], [inert]') || e.getClientRects().length === 0) continue;
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// createHud
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {{ topbar:HTMLElement, underbar:HTMLElement, actions:HTMLElement, overlays:HTMLElement }} hosts
 * @param {{ audio:AudioEngine, rival:ReturnType<typeof createRivalView>, support:{tts:boolean, haptics:boolean} }} deps
 * @returns {Hud & {holdNewGame:(held:boolean) => void}}   holdNewGame is not in the frozen typedef of src/ui/types.js
 */
export function createHud(hosts, deps) {
  const doc = hosts.topbar.ownerDocument;
  const html = doc.documentElement;
  const { audio, support } = deps;
  const app = /** @type {HTMLElement} */ (hosts.topbar.closest('#app') ?? hosts.overlays.parentElement ?? hosts.overlays);

  const motionFull = () => html.dataset.motion === 'full';
  /** @param {string} type @param {object} detail */
  const emit = (type, detail) => { app.dispatchEvent(new CustomEvent(type, { bubbles: true, detail })); };
  /** @param {HudAction} action */
  const act = (action) => emit('hud:action', { action });
  /** Runs `fn` after `ms` with full motion, at once without. @param {number} ms @param {() => void} fn */
  const afterMotion = (ms, fn) => { if (motionFull() && ms > 0) setTimeout(fn, ms); else fn(); };

  // ---- state ----

  /** @type {Phase|'boot'} */ let phase = 'boot';
  let hintLevel = 0;
  let failed = false;
  /** @type {Settings} */ let settings = DEFAULT_SETTINGS;
  /** @type {CoachInfo} */ let coachInfo = { mode: 'local', reason: null, rank: '' };
  /** @type {{rows:{n:number, red:string, black?:string}[], current:number}} */
  let notation = { rows: [], current: 0 };
  let mineCount = 0;

  /** Open modal overlays, bottom to top. @type {Layer[]} */
  const layers = [];

  // =====================================================================================================================
  // Top bar: ≡ · the rival's plate · 第 N 回合 · trophies · ♪
  // =====================================================================================================================

  hosts.topbar.classList.add('hud-top');
  const rivalSlot = make(doc, 'div', 'hud-top__rival');
  rivalSlot.append(...Array.from(hosts.topbar.childNodes));          // the plate's host, when the stage put it there first

  const menuBtn = button(doc, { id: 'menu-button', cls: 'hud-iconbtn', ico: 'menu', aria: ARIA.menu });
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');

  const roundEl = make(doc, 'span', 'hud-round');
  const roundNo = make(doc, 'b');
  roundEl.append(ROUND_PARTS[0], roundNo, ROUND_PARTS[1]);
  roundEl.hidden = true;
  const trayMine = make(doc, 'span', 'hud-tray hud-tray--mine');
  const trayLost = make(doc, 'span', 'hud-tray hud-tray--lost');
  trayMine.hidden = trayLost.hidden = true;
  const info = make(doc, 'div', 'hud-top__info');
  info.append(roundEl, trayMine, trayLost);

  const muteBtn = button(doc, { id: 'mute-button', cls: 'hud-iconbtn', ico: 'note', aria: ARIA.mute });
  muteBtn.setAttribute('aria-pressed', 'false');

  hosts.topbar.append(menuBtn, rivalSlot, info, muteBtn);

  menuBtn.addEventListener('click', () => { if (menu) closeMenu(true); else openMenu(); });
  muteBtn.addEventListener('click', () => act('mute'));

  /** @param {HTMLElement} tray @param {Piece[]} pieces @param {boolean} pop */
  function fillTray(tray, pieces, pop) {
    tray.replaceChildren();
    tray.hidden = pieces.length === 0;
    const shown = pieces.slice(-TROPHY_MAX);                          // newest on the right
    // Both forms are in the DOM and hud.css picks one, so a rotation needs no re-draw: the usual six discs and
    // their counter, and for a narrow phone the newest four, or the newest three and a counter of the rest.
    const narrow = pieces.length > TROPHY_NARROW ? TROPHY_NARROW - 1 : TROPHY_NARROW;
    shown.forEach((piece, i) => {
      const d = disc(doc, piece);
      if (i < shown.length - narrow) d.classList.add('is-extra');
      if (pop && i === shown.length - 1) d.classList.add('is-new');
      tray.append(d);
    });
    if (pieces.length > TROPHY_MAX) tray.append(make(doc, 'span', 'hud-tray__more hud-tray__more--wide', `+${pieces.length - TROPHY_MAX}`));
    if (pieces.length > TROPHY_NARROW) tray.append(make(doc, 'span', 'hud-tray__more hud-tray__more--narrow', `+${pieces.length - narrow}`));
  }

  // =====================================================================================================================
  // Under-bar: 悔棋 · (rival failed: 让他再想想 + the status line) · the last move
  // =====================================================================================================================

  hosts.underbar.classList.add('hud-under');
  const undoBtn = button(doc, { id: 'undo-button', cls: 'hud-btn hud-btn--secondary hud-undo', ico: 'undo', label: TXT.bar.undo });
  undoBtn.disabled = true;
  const retryBtn = button(doc, { id: 'retry-opponent', cls: 'hud-btn hud-btn--primary hud-retry', ico: 'retry', label: TXT.bar.retry });
  retryBtn.hidden = true;
  const statusEl = make(doc, 'p', 'hud-status', TXT.status.rivalFailed);
  statusEl.setAttribute('role', 'status');
  statusEl.hidden = true;
  const lastBtn = make(doc, 'button', 'hud-last');
  lastBtn.type = 'button';
  const lastMove = make(doc, 'b');
  lastBtn.append(make(doc, 'span', '', LAST_PREFIX), lastMove);
  lastBtn.hidden = true;
  hosts.underbar.append(undoBtn, retryBtn, statusEl, lastBtn);

  undoBtn.addEventListener('click', () => act('undo'));
  retryBtn.addEventListener('click', () => act('retry-opponent'));
  lastBtn.addEventListener('click', () => act('review'));

  function syncLastMove() {
    const row = notation.rows[notation.rows.length - 1];
    const text = row ? (row.black ?? row.red) : '';
    lastMove.textContent = text;
    lastBtn.hidden = !text || failed;
  }

  // =====================================================================================================================
  // Actions: the slots share one grid cell and cross-fade (D7); the hidden ones are `hidden` + `inert`
  // =====================================================================================================================

  hosts.actions.classList.add('hud-actions');

  const hintBtn = make(doc, 'button', 'hud-btn hud-btn--primary hud-hint');
  hintBtn.type = 'button';
  hintBtn.id = 'hint-button';
  const pouchBox = make(doc, 'span', 'hud-pouches');
  pouchBox.setAttribute('aria-hidden', 'true');
  /** @type {HTMLSpanElement[]} */
  const pouches = [];
  for (let i = 0; i < 3; i++) {
    const p = make(doc, 'span', 'hud-pouch');
    p.innerHTML = POUCH;                                             // static template
    p.dataset.open = '0';
    pouches.push(p);
    pouchBox.append(p);
  }
  const hintLabel = make(doc, 'span', 'hud-btn__label');
  hintBtn.append(pouchBox, hintLabel);

  const retractBtn = button(doc, { id: 'retract-button', cls: 'hud-btn hud-btn--secondary hud-retract', ico: 'swap', label: TXT.bar.retract });
  const confirmBtn = button(doc, { id: 'confirm-button', cls: 'hud-btn hud-btn--primary hud-confirm', ico: 'check', label: TXT.bar.confirm });
  const newGameBtn = button(doc, { id: 'newgame-button', cls: 'hud-btn hud-btn--primary hud-again', ico: 'play', label: TXT.bar.again });
  const slotRetryBtn = button(doc, { cls: 'hud-btn hud-btn--primary hud-retry', ico: 'retry', label: TXT.bar.retry });
  slotRetryBtn.dataset.action = 'retry-opponent';

  /** timer: hides the slot after its fade-out; guard: ends the tap guard of a slot that has just come in.
   *  @type {Record<SlotName, {el:HTMLElement, timer:ReturnType<typeof setTimeout>|null, guard:ReturnType<typeof setTimeout>|null}>} */
  const slots = {
    hint: { el: make(doc, 'div', 'hud-slot hud-slot--hint'), timer: null, guard: null },
    trial: { el: make(doc, 'div', 'hud-slot hud-slot--trial'), timer: null, guard: null },
    over: { el: make(doc, 'div', 'hud-slot hud-slot--over'), timer: null, guard: null },
  };
  slots.hint.el.append(hintBtn, slotRetryBtn);      // the retry button replaces the pouches only where hud.css says so (compact + failed)
  slots.trial.el.append(retractBtn, confirmBtn);
  slots.over.el.append(newGameBtn);
  for (const slot of Object.values(slots)) {
    slot.el.hidden = true;
    slot.el.inert = true;
    hosts.actions.append(slot.el);
  }
  /** @type {SlotName|null} */ let activeSlot = null;
  /** A game is over and its card is still to come (holdNewGame): nothing starts a new game yet. */
  let newGameHeld = false;
  /** The game-over card whose buttons are still held (showOver): 新对局 of the menu is held with them. @type {object|null} */
  let cardGuard = null;

  hintBtn.addEventListener('click', () => act('hint'));
  retractBtn.addEventListener('click', () => act('retract'));
  confirmBtn.addEventListener('click', () => act('confirm'));
  newGameBtn.addEventListener('click', () => act('new-game'));
  slotRetryBtn.addEventListener('click', () => act('retry-opponent'));

  /** @param {SlotName|null} name */
  function showSlot(name) {
    if (name === activeSlot) return;
    activeSlot = name;
    for (const key of /** @type {SlotName[]} */ (Object.keys(slots))) {
      const slot = slots[key];
      if (slot.timer !== null) { clearTimeout(slot.timer); slot.timer = null; }
      if (slot.guard !== null) { clearTimeout(slot.guard); slot.guard = null; }
      if (key === name) {
        slot.el.hidden = false;
        // 确定落子 is live at once (§12.3). The pouches and 再来一局 come in where 换一步 / 确定落子 / 再来一局 have
        // just been pressed, so they stay inert for a moment: the second tap of a double tap opens no pouch and
        // starts no new game. (An inert slot is not hit, so a scripted click simply waits for it.)
        const guarded = key !== 'trial';
        slot.el.inert = guarded;
        if (guarded) slot.guard = setTimeout(() => { slot.guard = null; slot.el.inert = false; }, TAP_GUARD_MS);
        void slot.el.offsetWidth;                                    // start the fade from opacity 0
        slot.el.classList.add('is-on');
      } else if (!slot.el.hidden) {
        slot.el.inert = true;
        slot.el.classList.remove('is-on');
        if (motionFull()) slot.timer = setTimeout(() => { slot.el.hidden = true; slot.timer = null; }, 130);
        else slot.el.hidden = true;
      }
    }
  }

  /** @type {WeakMap<HTMLElement, ReturnType<typeof setTimeout>>} */
  const pulses = new WeakMap();
  /** Runs a one-shot CSS animation class. @param {HTMLElement} target @param {string} cls @param {number} ms */
  function pulse(target, cls, ms) {
    if (!motionFull()) return;                                       // D8 and the nudge have no reduced-motion variant
    clearTimeout(pulses.get(target));
    target.classList.remove(cls);
    void target.offsetWidth;                                         // restart the animation when it is already running
    target.classList.add(cls);
    pulses.set(target, setTimeout(() => target.classList.remove(cls), ms));
  }

  // =====================================================================================================================
  // Overlays: toast, file input, layer bookkeeping
  // =====================================================================================================================

  const toastEl = make(doc, 'div', 'hud-toast');
  toastEl.id = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.hidden = true;
  /** @type {ReturnType<typeof setTimeout>|null} */ let toastTimer = null;

  const fileInput = make(doc, 'input', 'hud-file');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fileInput.tabIndex = -1;
  fileInput.setAttribute('aria-hidden', 'true');
  hosts.overlays.append(toastEl, fileInput);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const deliver = (/** @type {string} */ text) => {
      fileInput.value = '';                                          // the same file can be picked again
      emit('hud:import', { text });
      if (start) finishStart('import');
    };
    if (file.size > IMPORT_MAX_BYTES) deliver('');                   // not a backup: the director reports the failure
    else file.text().then(deliver, () => deliver(''));
  });
  function pickImportFile() {
    fileInput.value = '';
    fileInput.click();
  }

  /**
   * @param {{ type:keyof typeof LAYER_RANK, panel:HTMLElement, dismiss?:(() => void)|null, scrim?:boolean, menu?:boolean, closeMs?:number }} o
   * @returns {Layer}
   */
  function openLayer(o) {
    const root = make(doc, 'div', `hud-layer hud-layer--${o.type}`);
    /** @type {Layer} */
    const layer = { root, panel: o.panel, rank: LAYER_RANK[o.type], dismiss: o.dismiss ?? null, menu: !!o.menu,
                    returnFocus: doc.activeElement, closeMs: o.closeMs ?? 240, closed: false };
    if (o.scrim !== false) {
      const scrim = make(doc, 'div', 'hud-layer__scrim');
      const openedAt = Date.now();
      // not the second tap of the double tap that opened it (the menu button and the menu items lie under the scrim)
      scrim.addEventListener('click', () => { if (Date.now() - openedAt >= TAP_GUARD_MS) layer.dismiss?.(); });
      root.append(scrim);
    }
    root.append(o.panel);
    hosts.overlays.append(root);
    // `layers` is kept in drawing order, so its last entry is the one the child sees on top: a start overlay that
    // opens while the blocking notice is up goes under it and must not take the keyboard away from it.
    let at = layers.length;
    while (at > 0 && layers[at - 1].rank > layer.rank) at--;
    layers.splice(at, 0, layer);
    void root.offsetWidth;                                           // start the transition from the closed state
    root.classList.add('is-open');
    o.panel.tabIndex = -1;
    if (at === layers.length - 1) o.panel.focus({ preventScroll: true });
    return layer;
  }

  /**
   * A panel that is on its way out: nothing in it can be used any more, but the panel itself still takes the taps
   * until it is gone, so the second tap of a double tap on one of its buttons never reaches what lies behind it.
   * @param {HTMLElement} panel
   */
  function freeze(panel) {
    for (const child of panel.children) if (child instanceof HTMLElement) child.inert = true;
  }

  /** @param {Layer} layer */
  function closeLayer(layer) {
    if (layer.closed) return;
    layer.closed = true;
    const at = layers.indexOf(layer);
    const wasTop = at === layers.length - 1;
    if (at >= 0) layers.splice(at, 1);
    layer.root.classList.remove('is-open');
    layer.root.classList.add('is-closing');
    freeze(layer.panel);
    afterMotion(layer.closeMs, () => layer.root.remove());
    if (!wasTop) return;                                             // the focus is in an overlay above this one
    const back = layer.returnFocus;
    const below = layers[layers.length - 1];
    const usable = back instanceof HTMLElement && back.isConnected && !back.closest('[inert]');
    if (usable && (!below || below.panel.contains(back))) back.focus({ preventScroll: true });
    else if (below) below.panel.focus({ preventScroll: true });      // never leave the focus behind a modal overlay
  }

  // While a modal overlay is open: Esc closes the top one, Tab stays inside it, arrows walk the menu, and nothing
  // reaches the game's own shortcuts.
  doc.addEventListener('keydown', (event) => {
    const layer = layers[layers.length - 1];
    if (!layer) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      layer.dismiss?.();
    } else if (event.key === 'Tab') {
      const items = tabbable(layer.panel);
      const first = items[0], last = items[items.length - 1];
      const active = doc.activeElement;
      const inside = active instanceof Node && layer.panel.contains(active) && active !== layer.panel;
      if (!first || !last) { event.preventDefault(); layer.panel.focus({ preventScroll: true }); }
      else if (!inside) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    } else if (layer.menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = tabbable(layer.panel);
      if (items.length) {
        const i = items.indexOf(/** @type {HTMLElement} */ (doc.activeElement));
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
        items[next].focus();
      }
    }
    event.stopPropagation();
  }, true);

  // Every button plays ui.tap on press (pointer), or on activation when it is pressed with the keyboard.
  for (const host of [hosts.topbar, hosts.underbar, hosts.actions, hosts.overlays]) {
    host.addEventListener('pointerdown', (event) => {
      const b = event.target instanceof Element ? event.target.closest('button') : null;
      if (b && !b.disabled) audio.play('ui.tap');
    }, true);
    host.addEventListener('click', (event) => {
      const b = event.target instanceof Element ? event.target.closest('button') : null;
      if (b && !b.disabled && /** @type {MouseEvent} */ (event).detail === 0) audio.play('ui.tap');
    }, true);
  }

  // =====================================================================================================================
  // Menu
  // =====================================================================================================================

  /** @type {Layer|null} */ let menu = null;

  /** @type {[string, string, keyof typeof ICON, () => void][]} */
  const MENU_ITEMS = [
    ['new-game', TXT.menu.newGame, 'plus', () => act('new-game')],
    ['notation', TXT.menu.notation, 'scroll', () => openSheet('notation')],
    ['settings', TXT.menu.settings, 'sliders', () => openSheet('settings')],
    ['rules', TXT.menu.rules, 'book', () => openSheet('rules')],
    ['resign', TXT.menu.resign, 'flag', () => act('resign')],
    ['about', TXT.menu.about, 'info', () => openSheet('about')],
  ];

  function openMenu() {
    closeSheet(false);
    const panel = make(doc, 'div', 'hud-menu');
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', ARIA.menu);
    for (const [id, label, ico, run] of MENU_ITEMS) {
      const item = button(doc, { cls: 'hud-menu__item', ico, label });
      item.setAttribute('role', 'menuitem');
      item.dataset.menu = id;
      if (id === 'resign') item.disabled = phase === 'boot' || phase === 'over';      // nothing to resign from
      if (id === 'new-game') item.disabled = newGameHeld || cardGuard !== null;       // a game has just ended: its card comes first
      item.addEventListener('click', () => { closeMenu(false); run(); });
      panel.append(item);
    }
    const box = hosts.overlays.getBoundingClientRect(), at = menuBtn.getBoundingClientRect();
    panel.style.setProperty('--menu-x', `${Math.max(8, Math.round(at.left - box.left))}px`);
    panel.style.setProperty('--menu-y', `${Math.round(at.bottom - box.top + 4)}px`);
    menu = openLayer({ type: 'menu', panel, menu: true, closeMs: 140, dismiss: () => closeMenu(true) });
    menuBtn.setAttribute('aria-expanded', 'true');
    audio.play('ui.open');
  }

  /** 新对局 of an open menu follows what holds a new game back: the wait for the card, and the card's own tap guard. */
  function syncMenuNewGame() {
    const item = menu ? menu.panel.querySelector('.hud-menu__item[data-menu="new-game"]') : null;
    if (item instanceof HTMLButtonElement) item.disabled = newGameHeld || cardGuard !== null;
  }

  /** @param {boolean} sound */
  function closeMenu(sound) {
    if (!menu) return;
    closeLayer(menu);
    menu = null;
    menuBtn.setAttribute('aria-expanded', 'false');
    if (sound) audio.play('ui.close');
  }

  // =====================================================================================================================
  // Sheets: settings, notation, rules, about
  // =====================================================================================================================

  /** @type {{kind:SheetKind, layer:Layer, sync:() => void}|null} */ let sheet = null;

  /** @type {Record<SheetKind, string>} */
  const SHEET_TITLE = { settings: TXT.menu.settings, notation: TXT.menu.notation, rules: TXT.menu.rules, about: TXT.menu.about };

  /** @param {SheetKind} kind */
  function openSheet(kind) {
    closeMenu(false);
    closeSheet(false);
    const panel = make(doc, 'dialog', `hud-sheet hud-sheet--${kind}`);
    panel.setAttribute('open', '');
    panel.dataset.dialog = kind;
    panel.setAttribute('aria-modal', 'true');
    const title = make(doc, 'h2', 'hud-sheet__title', SHEET_TITLE[kind]);
    title.id = `hud-title-${kind}`;
    panel.setAttribute('aria-labelledby', title.id);
    const close = button(doc, { cls: 'hud-iconbtn hud-sheet__close', ico: 'close', aria: ARIA.close });
    close.addEventListener('click', () => closeSheet(true));
    const head = make(doc, 'header', 'hud-sheet__head');
    head.append(title, close);
    const body = make(doc, 'div', 'hud-sheet__body');
    panel.append(head, body);
    const sync = kind === 'settings' ? buildSettings(body) : kind === 'notation' ? buildNotation(panel, body)
      : kind === 'rules' ? buildRules(body) : buildAbout(body);
    const layer = openLayer({ type: 'sheet', panel, dismiss: () => closeSheet(true) });
    sheet = { kind, layer, sync };
    sync();
    audio.play('ui.open');
  }

  /** @param {boolean} sound */
  function closeSheet(sound) {
    if (!sheet) return;
    closeLayer(sheet.layer);
    sheet = null;
    if (sound) audio.play('ui.close');
  }

  /**
   * A row of choices; exactly one is pressed.
   * @template {string} V
   * @param {string} label
   * @param {[V, string][]} options
   * @param {(value:V) => void} onPick
   * @returns {{ el:HTMLElement, set:(value:V) => void }}
   */
  function segmented(label, options, onPick) {
    const box = make(doc, 'div', 'hud-seg');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', label);
    /** @type {Map<V, HTMLButtonElement>} */
    const byValue = new Map();
    for (const [value, text] of options) {
      const b = make(doc, 'button', 'hud-seg__opt', text);
      b.type = 'button';
      b.dataset.value = value;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => onPick(value));
      byValue.set(value, b);
      box.append(b);
    }
    return { el: box, set(value) { for (const [v, b] of byValue) b.setAttribute('aria-pressed', String(v === value)); } };
  }

  /** @param {keyof Settings} key @param {Settings[keyof Settings]} value */
  function changeSetting(key, value) {
    settings = /** @type {Settings} */ ({ ...settings, [key]: value });      // shown at once; the stage confirms with openSettings
    emit('hud:setting', { key, value });
    sheet?.sync();
  }

  /** @param {HTMLElement} body @returns {() => void} */
  function buildSettings(body) {
    const T = TXT.settings;
    /** @type {(() => void)[]} */
    const syncs = [];
    const group = () => { const g = make(doc, 'div', 'hud-set__group'); body.append(g); return g; };
    /** @param {HTMLElement} parent @param {string} label @param {HTMLElement} control @param {string} [note] */
    const row = (parent, label, control, note) => {
      const r = make(doc, 'div', 'hud-set__row');
      const l = make(doc, 'span', 'hud-set__label', label);
      if (note) l.append(make(doc, 'small', 'hud-set__note', note));
      r.append(l, control);
      parent.append(r);
      return r;
    };
    /** @param {HTMLElement} parent @param {string} label @param {(s:Settings) => boolean} read @param {(on:boolean) => void} write */
    const toggle = (parent, label, read, write) => {
      const b = make(doc, 'button', 'hud-switch');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-label', label);
      b.append(make(doc, 'span', 'hud-switch__knob'));
      b.addEventListener('click', () => write(b.getAttribute('aria-checked') !== 'true'));
      syncs.push(() => b.setAttribute('aria-checked', String(read(settings))));
      const r = row(parent, label, b);
      r.classList.add('hud-set__row--tap');                          // the whole row is the target, not only the switch
      r.addEventListener('click', (event) => { if (event.target instanceof Node && !b.contains(event.target)) b.click(); });
    };

    // -- the rank, when there is one --
    const rank = make(doc, 'div', 'hud-rank');
    const rankName = make(doc, 'strong', 'hud-rank__name');
    rank.append(icon(doc, 'star'), make(doc, 'span', 'hud-rank__label', T.rank), rankName);
    body.append(rank);
    syncs.push(() => { rank.hidden = !coachInfo.rank; rankName.textContent = coachInfo.rank; });

    // -- board theme --
    const look = group();
    const themeRow = make(doc, 'div', 'hud-set__row hud-set__row--stack');
    themeRow.append(make(doc, 'span', 'hud-set__label', T.theme));
    const themes = make(doc, 'div', 'hud-themes');
    themes.setAttribute('role', 'group');
    themes.setAttribute('aria-label', T.theme);
    for (const id of /** @type {Settings['theme'][]} */ (['chibi', 'longzhong', 'shachang'])) {
      const b = make(doc, 'button', 'hud-theme');
      b.type = 'button';
      b.dataset.value = id;
      const art = make(doc, 'span', 'hud-theme__art');
      art.dataset.theme = id;                                        // themes.css re-colours the subtree
      art.setAttribute('aria-hidden', 'true');
      art.append(disc(doc, { type: 'king', color: 'black' }), disc(doc, { type: 'king', color: 'red' }));
      b.append(art, make(doc, 'span', 'hud-theme__name', T.themes[id]));
      b.addEventListener('click', () => changeSetting('theme', id));
      syncs.push(() => b.setAttribute('aria-pressed', String(settings.theme === id)));
      themes.append(b);
    }
    themeRow.append(themes);
    look.append(themeRow);
    const motion = segmented(T.motion, [['auto', T.motions.auto], ['full', T.motions.full], ['reduced', T.motions.reduced]],
      (v) => changeSetting('motion', v));
    row(look, T.motion, motion.el);
    syncs.push(() => motion.set(settings.motion));

    // -- sound and touch --
    const sound = group();
    toggle(sound, T.sfx, (s) => s.sfx, (on) => changeSetting('sfx', on));
    toggle(sound, T.music, (s) => s.music, (on) => changeSetting('music', on));
    const volume = make(doc, 'input', 'hud-range');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.step = '5';
    volume.setAttribute('aria-label', T.volume);
    volume.addEventListener('change', () => changeSetting('volume', Number(volume.value) / 100));
    row(sound, T.volume, volume);
    syncs.push(() => {
      if (doc.activeElement !== volume) volume.value = String(Math.round(settings.volume * 100));
      volume.style.setProperty('--fill', `${Math.round(settings.volume * 100)}%`);
    });
    volume.addEventListener('input', () => volume.style.setProperty('--fill', `${volume.value}%`));
    toggle(sound, T.typeTicks, (s) => s.typeTicks, (on) => changeSetting('typeTicks', on));
    if (support.tts) toggle(sound, T.readAloud, (s) => s.readAloud, (on) => changeSetting('readAloud', on));
    if (support.haptics) toggle(sound, T.haptics, (s) => s.haptics, (on) => changeSetting('haptics', on));

    // -- the strategist --
    const coach = group();
    const status = make(doc, 'div', 'hud-coach');
    const statusLine = make(doc, 'p', 'hud-coach__line');
    const statusWhy = make(doc, 'p', 'hud-coach__why');
    status.append(statusLine, statusWhy);
    coach.append(status);
    syncs.push(() => {
      status.dataset.mode = coachInfo.mode;
      statusLine.textContent = TXT.coachStatus[coachInfo.mode];
      const why = coachInfo.mode === 'local' && coachInfo.reason ? TXT.coachStatus.reason[coachInfo.reason] : '';
      statusWhy.textContent = why;
      statusWhy.hidden = !why;
    });
    const mode = segmented(T.coach, [['auto', T.coaches.auto], ['local', T.coaches.local]], (v) => changeSetting('coach', v));
    row(coach, T.coach, mode.el);
    syncs.push(() => mode.set(settings.coach));
    toggle(coach, T.freeText, (s) => s.freeText, (on) => changeSetting('freeText', on));
    toggle(coach, T.talk, (s) => s.talk === 'more', (on) => changeSetting('talk', on ? 'more' : 'smart'));

    // -- the side, from the next game --
    const game = group();
    const side = segmented(T.side, [['red', T.sides.red], ['black', T.sides.black]], (v) => changeSetting('side', v));
    row(game, T.side, side.el, T.sideNote).classList.add('hud-set__row--wrap');
    syncs.push(() => side.set(settings.side));

    // -- backup --
    const backup = group();
    const tools = make(doc, 'div', 'hud-set__tools');
    const out = button(doc, { cls: 'hud-btn hud-btn--secondary', ico: 'download', label: T.exportBackup });
    out.dataset.action = 'export-backup';
    out.addEventListener('click', () => act('export-backup'));
    const inn = button(doc, { cls: 'hud-btn hud-btn--secondary', ico: 'upload', label: T.importBackup });
    inn.dataset.action = 'import-backup';
    inn.addEventListener('click', pickImportFile);
    tools.append(out, inn);
    row(backup, T.backup, tools).classList.add('hud-set__row--wrap');

    return () => { for (const s of syncs) s(); };
  }

  /** @param {HTMLElement} panel @param {HTMLElement} body @returns {() => void} */
  function buildNotation(panel, body) {
    const head = make(doc, 'div', 'hud-moves__head');
    head.setAttribute('aria-hidden', 'true');
    head.append(make(doc, 'span'), disc(doc, { type: 'king', color: 'red' }), disc(doc, { type: 'king', color: 'black' }));
    const list = make(doc, 'ol', 'hud-moves');
    body.append(head, list);
    const foot = make(doc, 'footer', 'hud-sheet__foot');
    const save = button(doc, { cls: 'hud-btn hud-btn--secondary', ico: 'download', label: TXT.menu.download });
    save.dataset.action = 'export';
    save.addEventListener('click', () => act('export'));
    foot.append(save);
    panel.append(foot);
    return () => {
      list.replaceChildren();
      const { rows, current } = notation;
      /** @type {HTMLElement|null} */ let mark = null;
      rows.forEach((r, i) => {
        const li = make(doc, 'li', 'hud-moves__row');
        const red = make(doc, 'span', 'hud-moves__move', r.red);
        const black = make(doc, 'span', 'hud-moves__move', r.black ?? '');
        if (current === 2 * i + 1) mark = red;
        if (current === 2 * i + 2 && r.black) mark = black;
        li.append(make(doc, 'span', 'hud-moves__no', `${r.n}.`), red, black);
        list.append(li);
      });
      save.disabled = rows.length === 0;
      if (mark) {
        const cell = /** @type {HTMLElement} */ (mark);
        cell.classList.add('is-current');
        cell.setAttribute('aria-current', 'true');
        body.scrollTop = Math.max(0, cell.offsetTop - body.clientHeight / 2);
      }
    };
  }

  /** @param {HTMLElement} body @returns {() => void} */
  function buildRules(body) {
    const list = make(doc, 'ol', 'hud-rules');
    TXT.rules.forEach((text, i) => {
      const li = make(doc, 'li', 'hud-rules__item');
      const no = make(doc, 'span', 'hud-rules__no', String(i + 1));
      no.setAttribute('aria-hidden', 'true');
      li.append(no, make(doc, 'span', 'hud-rules__text', text));
      list.append(li);
    });
    body.append(list);
    return () => {};
  }

  /** @param {HTMLElement} body @returns {() => void} */
  function buildAbout(body) {
    const mark = make(doc, 'p', 'hud-about__mark', WORDMARK);
    mark.setAttribute('aria-hidden', 'true');
    body.append(mark);
    for (const text of TXT.about) body.append(make(doc, 'p', 'hud-about__text', text));
    body.append(make(doc, 'p', 'hud-about__privacy', TXT.privacy));
    return () => {};
  }

  // =====================================================================================================================
  // Dialogs: resign, new game
  // =====================================================================================================================

  /** @type {{layer:Layer, settle:(go:boolean) => void}|null} */ let dialog = null;

  /**
   * @param {{ kind:'resign'|'new-game', title:string, body:string, keep:string, go:string, danger:boolean, extra?:HTMLElement }} o
   * @returns {Promise<boolean>} true = the child chose `go`
   */
  function openDialog(o) {
    dialog?.settle(false);
    closeMenu(false);
    return new Promise((resolve) => {
      const panel = make(doc, 'dialog', 'hud-dialog');
      panel.setAttribute('open', '');
      panel.dataset.dialog = o.kind;
      panel.setAttribute('role', 'alertdialog');
      panel.setAttribute('aria-modal', 'true');
      const title = make(doc, 'h2', 'hud-dialog__title', o.title);
      title.id = `hud-title-${o.kind}`;
      const body = make(doc, 'p', 'hud-dialog__body', o.body);
      body.id = `hud-body-${o.kind}`;
      panel.setAttribute('aria-labelledby', title.id);
      panel.setAttribute('aria-describedby', body.id);
      const keep = button(doc, { cls: 'hud-btn hud-btn--secondary', label: o.keep, choice: 'keep' });
      const go = button(doc, { cls: `hud-btn ${o.danger ? 'hud-btn--danger' : 'hud-btn--primary'}`, label: o.go, choice: 'go' });
      const buttons = make(doc, 'div', 'hud-dialog__buttons');
      buttons.append(keep, go);
      panel.append(title, body);
      if (o.extra) panel.append(o.extra);
      panel.append(buttons);
      const settle = (/** @type {boolean} */ answer) => {
        if (dialog?.layer !== layer) return;
        dialog = null;
        closeLayer(layer);
        audio.play('ui.close');
        resolve(answer);
      };
      const layer = openLayer({ type: 'dialog', panel, closeMs: 160, dismiss: () => settle(false) });
      dialog = { layer, settle };
      keep.addEventListener('click', () => settle(false));
      go.addEventListener('click', () => settle(true));
      audio.play('ui.open');
    });
  }

  // =====================================================================================================================
  // Start overlay (§12.5)
  // =====================================================================================================================

  /** @type {{layer:Layer, buddy:Buddy|null}|null} */ let start = null;
  /** @type {((choice:'continue'|'new'|'import') => void)[]} */
  const startWaiters = [];

  /** @param {{hasSave:boolean, firstVisit:boolean, canImport:boolean}} opts */
  function renderStart(opts) {
    if (start) { start.buddy?.destroy(); closeLayer(start.layer); start.layer.root.remove(); start = null; }
    const T = TXT.start;
    const panel = make(doc, 'dialog', 'hud-start');
    panel.setAttribute('open', '');
    panel.dataset.dialog = 'start';
    panel.setAttribute('aria-modal', 'true');

    const mark = make(doc, 'h1', 'hud-start__mark');
    mark.id = 'hud-title-start';
    const word = make(doc, 'span', 'hud-start__word');
    word.innerHTML = BRUSH;                                          // static template
    word.append(WORDMARK);
    const shu = disc(doc, { type: 'king', color: 'red' }), wei = disc(doc, { type: 'king', color: 'black' });
    shu.setAttribute('aria-hidden', 'true');
    wei.setAttribute('aria-hidden', 'true');
    mark.append(shu, word, wei);
    panel.setAttribute('aria-labelledby', mark.id);

    const figure = make(doc, 'div', 'hud-start__figure');
    const line = make(doc, 'p', 'hud-start__line', opts.hasSave ? T.resume : opts.firstVisit ? T.first : T.again);

    const buttons = make(doc, 'div', 'hud-start__buttons');
    if (opts.hasSave) {
      buttons.append(button(doc, { cls: 'hud-btn hud-btn--primary hud-start__go', label: T.cont, choice: 'continue' }),
                     button(doc, { cls: 'hud-btn hud-btn--secondary', label: T.fresh, choice: 'new' }));
    } else {
      buttons.append(button(doc, { cls: 'hud-btn hud-btn--primary hud-start__go', label: T.go, choice: 'new' }));
    }
    const links = make(doc, 'div', 'hud-start__links');
    if (opts.canImport) links.append(button(doc, { cls: 'hud-btn hud-btn--text', ico: 'upload', label: T.import, choice: 'import' }));
    const toSettings = button(doc, { cls: 'hud-btn hud-btn--text', ico: 'sliders', label: T.settings });
    toSettings.dataset.action = 'settings';
    links.append(toSettings);

    const text = make(doc, 'div', 'hud-start__text');
    text.append(mark, line, buttons, links);
    const card = make(doc, 'div', 'hud-start__card');
    card.append(text, figure);
    panel.append(card);

    panel.addEventListener('click', (event) => {
      const b = event.target instanceof Element ? event.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.choice === 'continue' || b.dataset.choice === 'new') finishStart(b.dataset.choice);
      else if (b.dataset.choice === 'import') pickImportFile();
      else if (b.dataset.action === 'settings') openSheet('settings');
    });

    const layer = openLayer({ type: 'start', panel, scrim: false, closeMs: 200 });

    // 诸葛亮 greets: cheering for 1.2 s, then idle. The figure is decoration here, so its own events stay inside.
    /** @type {Buddy|null} */ let buddy = null;
    try {
      buddy = createBuddy(figure, { variant: 'full', reducedMotion: !motionFull() });
      buddy.setMood('cheering', { hold: 1200 });
    } catch (error) {
      console.warn('[hud] the start figure could not be drawn', error);
    }
    const greeter = buddy;
    figure.addEventListener('buddy:tap', (event) => { event.stopPropagation(); greeter?.react('hop'); });
    figure.addEventListener('bubble:expand', (event) => event.stopPropagation());
    panel.classList.toggle('has-figure', figure.childElementCount > 0);
    start = { layer, buddy };
  }

  /** @param {'continue'|'new'|'import'} choice */
  function finishStart(choice) {
    if (!start) return;
    const s = start;
    start = null;
    closeSheet(false);
    closeLayer(s.layer);                                             // fades 200 ms
    afterMotion(220, () => s.buddy?.destroy());
    for (const resolve of startWaiters.splice(0)) resolve(choice);
  }

  // =====================================================================================================================
  // Game-over card (§12.6, step 3)
  // =====================================================================================================================

  /** @type {{root:HTMLElement, close:() => void}|null} */ let over = null;

  /** @param {OverView} view @returns {{ takeaway:HTMLElement, close:() => void }} */
  function showOver(view) {
    over?.close();
    const T = TXT.over;
    const root = make(doc, 'div', 'hud-layer hud-layer--over');
    const card = make(doc, 'dialog', 'hud-over');
    card.setAttribute('open', '');
    card.dataset.dialog = 'over';
    card.dataset.result = view.result;

    const crest = make(doc, 'div', 'hud-over__crest');
    crest.setAttribute('aria-hidden', 'true');
    crest.innerHTML = CREST[view.result];                            // static template
    const title = make(doc, 'h2', 'hud-over__title', T[view.result]);
    title.id = 'hud-title-over';
    card.setAttribute('aria-labelledby', title.id);
    const head = make(doc, 'div', 'hud-over__head');
    head.append(crest, title);

    const named = view.result === 'win' && view.reason === 'stalemate' ? T.sub['win.stalemate']
      : view.result === 'win' && view.reason === 'checkmate' ? T.sub['win.checkmate']
      : view.result === 'win' ? '' : T.sub[view.result];
    if (named) head.append(make(doc, 'p', 'hud-over__sub', named));
    // how the game ended, in words: for a draw (§12.6), and for a win the two subtitles do not describe
    if (view.result === 'draw' || !named) head.append(make(doc, 'p', 'hud-over__reason', END_WORD[view.reason]));

    const body = make(doc, 'div', 'hud-over__body');
    if (view.proud) {
      const best = make(doc, 'p', 'hud-over__best');
      best.append(make(doc, 'span', 'hud-over__tag', T.best), make(doc, 'b', 'hud-over__move', view.proud.notation));
      if (view.proud.self) best.append(make(doc, 'span', 'hud-over__self', TXT.popup.mark));
      body.append(best);
    }
    const takeaway = make(doc, 'div', 'hud-over__takeaway');
    takeaway.setAttribute('aria-live', 'polite');
    const gains = make(doc, 'section', 'hud-over__gains');
    gains.append(make(doc, 'h3', 'hud-over__heading', T.gains), takeaway);
    body.append(gains);

    const facts = make(doc, 'div', 'hud-over__facts');
    facts.append(make(doc, 'p', 'hud-over__stats', T.stats(view.stats.rounds, view.stats.captures, view.stats.brilliant)));
    if (view.goal) {
      const goal = make(doc, 'p', 'hud-over__goal');
      goal.append(icon(doc, 'target'), make(doc, 'span', '', view.goal));
      facts.append(goal);
    }
    if (view.rank) {
      const rank = make(doc, 'p', 'hud-over__rank');
      rank.append(icon(doc, 'star'), make(doc, 'span', '', TXT.settings.rank), make(doc, 'strong', '', view.rank.name));
      facts.append(rank);
    }
    body.append(facts);

    const again = button(doc, { cls: 'hud-btn hud-btn--primary', ico: 'play', label: T.again, choice: 'again' });
    const review = button(doc, { cls: 'hud-btn hud-btn--secondary', label: T.review, choice: 'review' });
    const buttons = make(doc, 'div', 'hud-over__buttons');
    buttons.append(review, again);
    card.append(head, body, buttons);
    root.append(card);
    hosts.overlays.append(root);
    void root.offsetWidth;
    root.classList.add('is-open');

    // The card comes up seconds after the last move, perhaps under a finger that is still tapping where 确定落子 was (in
    // the upright layout its buttons lie over the action bar). Its buttons take no tap until the card is in place and
    // TAP_GUARD_MS more have passed; a tap that arrives meanwhile holds them TAP_BURST_MS longer, but never past
    // CARD_BURST_MAX_MS after the card came up: a child who keeps tapping 再来一局 is not kept out.
    // 新对局 of a menu that the same finger has opened meanwhile is held with them: it was not available while the card
    // was awaited (holdNewGame), and a tap of that burst must not start a new game the moment the card shows.
    const shownAt = Date.now();
    let freeAt = shownAt;
    /** @type {ReturnType<typeof setTimeout>|null} */ let guard = null;
    const held = {};
    const release = () => {
      if (guard !== null) clearTimeout(guard);
      guard = null;
      buttons.inert = false;
      doc.removeEventListener('pointerdown', burst, true);
      if (cardGuard === held) {
        cardGuard = null;
        syncMenuNewGame();
      }
    };
    /** The buttons stay held until `until` (a later moment that was asked for before stands). @param {number} until */
    const hold = (until) => {
      freeAt = Math.max(freeAt, until);
      if (guard !== null) clearTimeout(guard);
      guard = setTimeout(release, Math.max(0, freeAt - Date.now()));
    };
    function burst() {
      if (guard !== null) hold(Math.min(Date.now() + TAP_BURST_MS, shownAt + CARD_BURST_MAX_MS));
    }
    buttons.inert = true;
    cardGuard = held;
    syncMenuNewGame();
    doc.addEventListener('pointerdown', burst, true);
    hold(shownAt + (motionFull() ? 300 : 0) + TAP_GUARD_MS);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      release();
      if (over?.root === root) over = null;
      root.classList.remove('is-open');
      root.classList.add('is-closing');
      freeze(card);
      afterMotion(300, () => root.remove());
    };
    // `card: true` tells the stage that the action came from the card: what lies under the card is held while it leaves
    again.addEventListener('click', () => { close(); emit('hud:action', { action: 'new-game', card: true }); });
    review.addEventListener('click', () => { close(); emit('hud:action', { action: 'review', card: true }); });
    card.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    over = { root, close };
    return { takeaway, close };
  }

  // =====================================================================================================================
  // Blocking notice, landscape-phone card
  // =====================================================================================================================

  /** @type {Layer|null} */ let blocker = null;

  /** @param {{kind:'engine-dead'}|null} n */
  function blocking(n) {
    if (!n) {
      if (blocker) { closeLayer(blocker); blocker = null; }
      return;
    }
    if (blocker) return;
    const panel = make(doc, 'dialog', 'hud-blocking');
    panel.setAttribute('open', '');
    panel.dataset.dialog = 'blocking';
    panel.dataset.kind = n.kind;
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    const retry = button(doc, { cls: 'hud-blocking__retry', ico: 'retry', label: TXT.status.engineDead, choice: 'retry' });
    retry.addEventListener('click', () => { pulse(retry, 'is-busy', 700); act('retry-engine'); });
    panel.append(retry);
    blocker = openLayer({ type: 'blocking', panel, closeMs: 160 });
    retry.focus({ preventScroll: true });
  }

  const rotate = make(doc, 'div', 'hud-rotate');
  rotate.hidden = true;
  const rotateKeep = button(doc, { cls: 'hud-btn hud-btn--secondary', label: TXT.rotate.keep });
  rotate.append(make(doc, 'p', 'hud-rotate__text', TXT.rotate.text), rotateKeep);
  hosts.overlays.append(rotate);
  let rotateDismissed = false;
  const smallLandscape = doc.defaultView?.matchMedia?.('(max-height: 479.98px) and (orientation: landscape)') ?? null;
  const syncRotate = () => { rotate.hidden = rotateDismissed || !smallLandscape?.matches; };
  smallLandscape?.addEventListener('change', syncRotate);
  rotateKeep.addEventListener('click', () => { rotateDismissed = true; syncRotate(); });
  syncRotate();

  // =====================================================================================================================
  // Controller
  // =====================================================================================================================

  /** @type {Hud & {holdNewGame:(held:boolean) => void}} */
  const hud = {
    /**
     * A game has just ended and its card is still to come (the stage says when, and when no longer): 再来一局 of the
     * action bar and 新对局 of the menu are shown as not available yet, so that a finger that keeps tapping where
     * 确定落子 was starts no new game before the card has been seen. The card brings its own 再来一局.
     */
    holdNewGame(held) {
      newGameHeld = held;
      newGameBtn.disabled = held;
      syncMenuNewGame();
    },

    setPhase(p) {
      const opened = p.hintLevel > hintLevel;
      phase = p.phase;
      hintLevel = p.hintLevel;
      failed = p.phase === 'opponentTurn' && p.failed;

      // under-bar: 悔棋 keeps its name in every phase, also at game over (CONTRACT-NOTES 116)
      undoBtn.disabled = phase === 'boot' || !p.canUndo;
      retryBtn.hidden = !failed;
      statusEl.hidden = !failed;
      syncLastMove();

      // the pouches; while the rival thinks the button carries the status instead (not when he has failed)
      const thinking = phase === 'opponentTurn' && !failed;
      hosts.actions.dataset.failed = failed ? '1' : '0';
      hintBtn.dataset.level = String(hintLevel);
      hintBtn.disabled = phase === 'opponentTurn' || hintLevel >= 3 || phase === 'boot';
      hintBtn.classList.toggle('is-waiting', thinking);
      hintLabel.textContent = thinking ? TXT.status.rivalThinking : TXT.pouch.label[hintLevel];
      hintBtn.setAttribute('aria-label', thinking ? TXT.status.rivalThinking : TXT.pouch.aria[hintLevel]);
      pouches.forEach((pouch, i) => {
        const open = i < hintLevel;
        if (open && pouch.dataset.open !== '1' && opened) pulse(pouch, 'is-pop', 200);       // F7
        pouch.dataset.open = open ? '1' : '0';
      });

      showSlot(phase === 'boot' ? null : phase === 'tentative' ? 'trial' : phase === 'over' ? 'over' : 'hint');
      if (phase !== 'over') over?.close();
    },

    setTrophies(mine, lost) {
      fillTray(trayMine, mine, mine.length > mineCount);
      fillTray(trayLost, lost, false);
      mineCount = mine.length;
    },

    setRound(round) {
      roundNo.textContent = String(round);
      roundEl.hidden = !(round >= 1);
    },

    setMuted(muted) {
      muteBtn.setAttribute('aria-pressed', String(muted));
    },

    beaconConfirm() { pulse(confirmBtn, 'is-beacon', 320); },
    nudgeHint() { pulse(hintBtn, 'is-nudge', 620); },

    showStart(opts) {
      return new Promise((resolve) => {
        startWaiters.push(resolve);
        renderStart(opts);
      });
    },

    showOver,

    openSettings(next, status) {
      settings = next;
      coachInfo = status;
      if (sheet?.kind === 'settings') sheet.sync();
    },

    setNotation(rows, current) {
      notation = { rows, current };
      syncLastMove();
      if (sheet?.kind === 'notation') sheet.sync();
    },

    confirm(kind) {
      const T = TXT.dialog.resign;
      return openDialog({ kind, title: T.title, body: T.body, keep: T.keep, go: T.go, danger: true });
    },

    newGameDialog() {
      const T = TXT.dialog.newGame;
      /** @type {Color} */ let color = settings.side;
      const pick = make(doc, 'div', 'hud-dialog__side');
      pick.setAttribute('role', 'group');
      pick.setAttribute('aria-label', TXT.settings.side);
      pick.append(make(doc, 'span', 'hud-dialog__sidelabel', TXT.settings.side));
      /** @type {HTMLButtonElement[]} */
      const sides = [];
      for (const c of /** @type {Color[]} */ (['red', 'black'])) {
        const b = make(doc, 'button', 'hud-side');
        b.type = 'button';
        b.dataset.choice = c;
        const d = disc(doc, { type: 'king', color: c });
        d.setAttribute('aria-hidden', 'true');
        b.append(d, make(doc, 'span', '', TXT.settings.sides[c]));
        b.addEventListener('click', () => { color = c; paint(); });
        sides.push(b);
        pick.append(b);
      }
      const paint = () => { for (const b of sides) b.setAttribute('aria-pressed', String(b.dataset.choice === color)); };
      paint();
      return openDialog({ kind: 'new-game', title: T.title, body: T.body, keep: T.keep, go: T.go, danger: false, extra: pick })
        .then((go) => {
          if (!go) return null;
          if (color !== settings.side) changeSetting('side', color);         // the next 再来一局 keeps the side just chosen
          return { humanColor: color };
        });
    },

    toast(text, opts) {
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastTimer = null;
      if (!text) {                                                   // nothing to say: no empty bubble, and a showing one leaves
        toastEl.classList.remove('is-on');
        toastEl.hidden = true;
        toastEl.textContent = '';
        return;
      }
      toastEl.textContent = text;
      toastEl.hidden = false;
      void toastEl.offsetWidth;
      toastEl.classList.add('is-on');
      toastTimer = setTimeout(() => {
        toastTimer = null;
        toastEl.classList.remove('is-on');
        afterMotion(200, () => { if (toastTimer === null) { toastEl.hidden = true; toastEl.textContent = ''; } });
      }, opts?.ms ?? TOAST_MS);
    },

    blocking,

    closeAll() {
      closeMenu(false);
      closeSheet(false);
      dialog?.settle(false);
      over?.close();
    },
  };

  hud.setPhase({ phase: 'boot', canUndo: false, hintLevel: 0, failed: false });
  return hud;
}
