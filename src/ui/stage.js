// The stage: a presentational facade that implements StagePort over layout, board-view, fx, audio, speech,
// buddy, rival-view, chat-panel and hud (SPEC §4.28.9, StagePort in §3.10). Package X8.
// "The director says what happened; the stage decides how it looks and sounds."
//
// What lives here and nowhere else:
//   - the verdict -> face / guard / sound table of §11.5 (verdict(), committed(), rivalMoved(), over());
//   - the sounds of the stage's row in §10.5.4 (turn.yours, fan.sweep, hint.1-3, stamp, praise.*, warn, lose,
//     draw, win for a win that is not a mate, chat.send, chat.receive);
//   - the cue queue: board moments that the child did not start with a tap (commit after-effects, the rival's
//     move, undo, reset, game over) play one after another; what the child's finger starts (select, trial,
//     retract, ghost play) never waits. settle() finishes everything at once;
//   - the pacing of 诸葛亮's lines (CONTRACT-NOTES K-101): one bubble, one line, and time to read it;
//   - his mouth and the read-aloud feed (CONTRACT-NOTES 77 / 86);
//   - when 司马懿's reactions show: a `rattled` face fires with the stamp or popup of the move that punished him and
//     stays long enough to be seen; his thinking dots never outlive his turn;
//   - what a finger that taps in bursts may reach: nothing under the start overlay or the game-over card while they
//     leave or come up, and no new game between the end of a game and its card (CONTRACT-NOTES 146, 150);
//   - when the move links of the strategist's lines stop being buttons: whenever the position changes;
//   - layout, keyboard shortcuts, the URL switches, the audio unlock, the silent idle peek, the ?test=1 hooks.
// It holds no game state beyond what it was last told (the last StageView, the phase, the trial on the board).
//
// DOM the stage adds itself (the package owns no stylesheet, so both are styled inline):
//   div.stage-rays    in #app, behind every region: the gold rays of a win (E6); full motion only
//   div.stage-ribbon  in #stage, on the board's top edge: 本局最佳 during the replay of the child's best move (§12.6)

/** @import { Board, Move, MoveRef, PieceType, Square } from '../core/types.js' */
/** @import { AskCode, Mood } from '../core/codes.js' */
/** @import { MoveLink, Segment } from '../coach/types.js' */
/** @import { ChipSpec, CoachKind, CoachOffReason, OverView, Phase, Praise, RivalMood, Settings, StageHandlers, StagePort, StageView, VerdictView } from '../game/types.js' */
/** @import { Actor, SfxName, ThemeId } from './types.js' */

import { moodOfVerdict } from '../core/codes.js';
import { createAudio } from './audio.js';
import { createBoardView } from './board-view.js';
import { createBuddy } from './buddy.js';
import { createChatPanel } from './chat-panel.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { applyLayout, computeLayout } from './layout.js';
import { createRivalView } from './rival-view.js';
import { createScene } from './scene.js';
import { createSpeech } from './speech.js';
import { TXT } from './texts.js';

/** @type {readonly ThemeId[]} */
const THEMES = ['chibi', 'longzhong', 'shachang'];

// ---- §11.5: guard, held moods ----------------------------------------------------------------------------------------

const GUARD_MS = 200;                 // the trial guard of every verdict ...
const GUARD_BLUNDER_MS = 700;         // ... but a blunder, which also wobbles the piece once
const ALARM_MS = 1200;                // `alarmed` before it settles into `worried`
const SLIP_MS = 1200;                 // a committed mistake / blunder: `worried`, nothing else
const CHECK_MS = 1200;                // the child's own check: `pleased`
const MATE_CHEER_MS = 8000;           // the child's mate: `cheering` until the game-over view makes it the base mood
const CURIOUS_MS = 2600;              // a pouch question

/** `praise` set on a committed move: the popup's sound and the mood that is held with it. */
/** @type {Readonly<Record<Praise['tier'], {mood:Mood, hold:number, sfx:SfxName}>>} */
const PRAISE = Object.freeze({
  good:      { mood: 'pleased',   hold: 1200, sfx: 'praise.good' },
  great:     { mood: 'impressed', hold: 1600, sfx: 'praise.great' },
  brilliant: { mood: 'impressed', hold: 2000, sfx: 'praise.brilliant' },
  lord:      { mood: 'cheering',  hold: 1500, sfx: 'praise.brilliant' },
});
const STREAK_FROM = 3;                // the streak text replaces 妙计！ from the third earned move in a row (§10.4.4, tone `great`)
/** The stage's own text for it (CONTRACT-NOTES 114; src/ui may not import the strings of src/game). @param {number} n */
const streakText = (n) => `${n}连好棋！`;
const POPUP_READ_MS = 600;            // a praise popup is given this long before the next cue may start

// ---- pacing of the strategist's lines (CONTRACT-NOTES K-101) ----------------------------------------------------------

const READ_BASE_MS = 700, READ_PER_CHAR_MS = 60, READ_MIN_MS = 1200, READ_MAX_MS = 3200;
const READ_TEST_MS = 300;             // with ?test=1
const LINE_WATCHDOG_MS = 25000;       // a reply that was aborted without a handler call stops blocking the bubble after this
const MOUTH_RELEASE_MS = 200;         // the mouth closes this long after a line is complete and on screen
const MOUTH_POLL_MS = 80;
const MOUTH_MAX_MS = 5000;
const POINT_GAP_MS = 6000;            // the "explaining" gesture, at most once in this time

// ---- timers ------------------------------------------------------------------------------------------------------------

const YOURS_MS = 3000;                // turn.yours: the board untouched this long after the rival's piece landed
const PEEK_MS = 45000;                // the silent idle peek
const RATTLED_MS = 1600;              // 司马懿's rattled face is seen at least this long ...
const RATTLED_LINE_MS = 2400;         // ... and for as long as the line he says with it is up (§11.7)
const UNLOCK_WAIT_MS = 500;           // start(): how long the first deal waits for the audio context
const REVIEW_ARROW_MS = 2600;
// Children double-tap (CONTRACT-NOTES 138): the second or third tap on 开战！ must not land on the board under the button.
const TAP_GUARD_MS = 350;             // the board takes no tap this long after the start overlay has left the screen ...
const DEAL_LAND_MS = 450;             // ... nor before the pieces of a deal have landed (G1: 14 ms x 16 + 220 ms)
const TAP_BURST_MS = 500;             // a tap that arrives while the board is held holds it this much longer (a child's triple
                                      // tap has gaps of 250 to 400 ms: with 350 the third tap of 300 + 300 still landed) ...
const TAP_BURST_MAX_MS = 1000;        // ... but never past this long after the overlay left or the deal began: a child who
                                      // keeps tapping a piece that does not answer must not be kept out for good
const START_LEAVE_MAX_MS = 600;       // the start overlay is gone 200 ms after the choice; never waited for longer than this
// A game that is over shows its card after the celebration, and children tap on where 确定落子 was meanwhile: until the
// card is up nothing starts a new game (CONTRACT-NOTES 150). The wait has an end when no card will come.
const CARD_IDLE_MS = 3000;            // the game is over, no cue is in flight and no card has come up: after this long none will
const CARD_WAIT_MAX_MS = 15000;       // ... and whatever the cues do, the card is never waited for longer than this
const CARD_BURST_MAX_MS = 4000;       // taps that keep coming while the card comes up hold what lies around it at most this long
                                      // (after his mate the card is up two seconds after the move, and a finger that has
                                      // been tapping since then is not asking for a new game yet)

// ---- game over (§12.6) ---------------------------------------------------------------------------------------------------

const PROUD_MS = 3000;                // 「本局最佳」, in total
const PROUD_LEAD_MS = 450;            // the old position is shown this long before the move is replayed
const PROUD_MOVE_MS = 900;            // the replayed move is given this long at most before its popup
const WIN_PAUSE_MS = 900;             // a win: the celebration is seen this long before the card comes up
const CONFETTI_MS = 2400;             // ... and its confetti is allowed to fall before the board is used for the replay
const CARD_MS = 300;                  // the card's slide

const E_BACK = 'cubic-bezier(.34,1.56,.64,1)';
const E_OUT = 'cubic-bezier(.2,.8,.2,1)';

/** One whole sentence, with the closing marks that follow its end. */
const SENTENCE_RE = /[^。！？!?…\n]*[。！？!?…\n]+[」』”’）》]*/g;

/** @param {number} lo @param {number} x @param {number} hi */
const clamp = (lo, x, hi) => Math.max(lo, Math.min(hi, x));

/** @param {{from:Square, to:Square}} a @param {{from:Square, to:Square}} b */
const sameMove = (a, b) => a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;

/** What a segment shows. @param {Segment} seg @returns {string} */
const textOf = (seg) => (seg.type === 'move' ? seg.notation : seg.text);

/** Characters a reader has to read (white space does not count). @param {string} text @returns {number} */
const visibleCount = (text) => Array.from(text.replace(/\s+/g, '')).length;

/** 'child' -> 'me', 'opponent' -> 'rival'. @param {'child'|'opponent'|null} by @returns {Actor|undefined} */
const actorOf = (by) => (by === 'child' ? 'me' : by === 'opponent' ? 'rival' : undefined);

/**
 * One line of the strategist as the stage follows it.
 * @typedef {Object} Line
 * @property {string} id                          the id the director uses
 * @property {string} chatId                      the id chat-panel knows it by
 * @property {CoachKind} kind
 * @property {boolean} bubble                     shown in the bubble (false: in the game-over card)
 * @property {'waiting'|'streaming'|'ended'} state       waiting = begun, no text yet
 * @property {number} chars                       visible characters so far
 * @property {number} endedAt
 * @property {number} touchedAt                   the last sign of life
 * @property {number} trial                       the trial that was on the board when it began (0 = none)
 * @property {boolean} cut                        settle() stopped it in mid-flight
 * @property {boolean} chimed                     chat.receive has sounded for it
 * @property {string} pending                     text not yet handed to read-aloud (an unfinished sentence)
 */

/**
 * @typedef {Object} Cue
 * @property {(live:() => boolean) => Promise<void>} run       the choreography; after every await it asks live()
 * @property {(started:boolean) => void} snap                   settle(): the final state, now, without animation
 * @property {boolean} started
 * @property {boolean} done
 * @property {() => void} resolve
 */

/**
 * @param {HTMLElement} app  the #app element
 * @param {{ settings:Settings, url:Location, rank?:string }} deps  rank: the profile's current rank name, '' or absent when there is none (CONTRACT-NOTES item 82)
 * @returns {StagePort}
 */
export function createStage(app, deps) {
  const doc = app.ownerDocument;
  const win = doc.defaultView ?? window;
  const html = doc.documentElement;
  const now = () => win.performance.now();

  /** @param {string} id @returns {HTMLElement} */
  function region(id) {
    const node = app.querySelector(`#${id}`);
    if (!(node instanceof HTMLElement)) throw new Error(`stage: #${id} is missing from the shell`);
    return node;
  }
  const topbarEl = region('topbar'), stageEl = region('stage'), boardEl = region('board'), underbarEl = region('underbar');
  const coachEl = region('coach'), buddyEl = region('buddy'), chatEl = region('chat'), actionsEl = region('actions'), overlaysEl = region('overlays');

  // ---- URL switches (read once) ------------------------------------------------------------------------------------------

  const query = new URLSearchParams(deps.url ? deps.url.search : '');
  const TEST = query.get('test') === '1';
  const FORCE_REDUCED = query.get('motion') === 'reduced';
  let forcedMute = query.get('mute') === '1';
  const urlTheme = THEMES.find((id) => id === query.get('theme')) ?? null;

  // ---- what the stage was last told ----------------------------------------------------------------------------------------

  /** @type {Settings} */ let settings = { ...deps.settings };
  /** @type {ThemeId} */ let theme = urlTheme ?? settings.theme;
  let rank = deps.rank ?? '';
  /** @type {{mode:'llm'|'local', reason:CoachOffReason|null}} */ let coach = { mode: 'local', reason: null };
  /** @type {Partial<StageHandlers>} */ let handlers = {};

  /** @type {Phase|'boot'} */ let phase = 'boot';
  let ply = 0;
  let canUndo = false;
  /** @type {0|1|2|3} */ let hintLevel = 0;
  let canAsk = false;
  /** @type {StageView|null} */ let view = null;
  /** @type {Square|null} */ let selection = null;
  /** The trial on the board. @type {{move:Move, seq:number, verdict:VerdictView|null, wobbled:boolean, warned:boolean}|null} */
  let trial = null;
  let trialSeq = 0;
  let inputVisible = false;
  let sheet = false;

  // ---- motion and theme: written before any module draws ----------------------------------------------------------------

  const prefersReduced = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  /** @returns {'full'|'reduced'} */
  function motionNow() {
    if (FORCE_REDUCED) return 'reduced';
    if (settings.motion === 'auto') return prefersReduced && prefersReduced.matches ? 'reduced' : 'full';
    return settings.motion;
  }
  let reduced = motionNow() === 'reduced';
  html.dataset.motion = reduced ? 'reduced' : 'full';
  html.dataset.theme = theme;

  function paintThemeColor() {
    const meta = doc.querySelector('meta[name="theme-color"]');
    const page = win.getComputedStyle(html).getPropertyValue('--page').trim();
    if (meta && page) meta.setAttribute('content', page);
  }
  paintThemeColor();

  // ---- layout: the first inline style on #app (styles/layout.css keys its CSS-only defaults on #app:not([style])) ------

  function measureLayout() {
    const vv = win.visualViewport ?? null;
    // times the scale, so a pinch zoom is not taken for the on-screen keyboard
    const visibleH = vv ? vv.height * vv.scale : win.innerHeight;
    return computeLayout({ W: win.innerWidth, H: win.innerHeight, visibleH, sheet });
  }
  let layout = measureLayout();
  applyLayout(app, layout, win.visualViewport ?? null);
  app.dataset.sheet = '0';

  // ---- the modules -----------------------------------------------------------------------------------------------------------

  const audio = createAudio();
  audio.applySettings({ sfx: settings.sfx, music: settings.music, volume: settings.volume });
  audio.setPalette(theme);
  audio.music.start();
  const speech = createSpeech({ audio });
  speech.setEnabled(settings.readAloud);

  const fx = createFx({ reducedMotion: reduced, haptics: settings.haptics });
  const scene = createScene(doc.body, { theme, reducedMotion: reduced });     // the camp behind everything (decoration only)
  const board = createBoardView(boardEl, { fx, audio, bottom: settings.side, theme, reducedMotion: reduced });
  board.setInteractive(false);                             // nothing to touch before the first position
  const buddy = createBuddy(buddyEl, { variant: layout.buddy, reducedMotion: reduced });

  const rivalHost = doc.createElement('div');              // the hud moves what is already in #topbar into its plate slot
  topbarEl.append(rivalHost);
  const rival = createRivalView(rivalHost);
  rival.setReducedMotion(reduced);
  const hud = createHud(
    { topbar: topbarEl, underbar: underbarEl, actions: actionsEl, overlays: overlaysEl },
    { audio, rival, support: { tts: speech.supported, haptics: typeof win.navigator.vibrate === 'function' } },
  );
  const chat = createChatPanel(chatEl, { bubble: buddy.bubble, speech, audio, typeTicks: settings.typeTicks, reducedMotion: reduced });

  // =========================================================================================================================
  // Small helpers
  // =========================================================================================================================

  /** @type {Set<() => void>} */
  const sleepers = new Set();
  /** Resolves after `ms`, or at once when the cue queue is flushed. @param {number} ms @returns {Promise<void>} */
  function sleep(ms) {
    return new Promise((resolve) => {
      const done = () => { win.clearTimeout(timer); sleepers.delete(done); resolve(); };
      const timer = win.setTimeout(done, Math.max(0, ms));
      sleepers.add(done);
    });
  }

  /** @param {unknown} error */
  const report = (error) => { console.error('[stage]', error); };

  /** @param {Event} event @returns {Record<string, unknown>} */
  function detailOf(event) {
    const detail = event instanceof CustomEvent ? event.detail : null;
    return detail && typeof detail === 'object' ? detail : {};
  }

  const overlayOpen = () => overlaysEl.querySelector('.hud-layer:not(.is-closing) > dialog[open]') !== null;

  /** @param {Square} sq @returns {PieceType|undefined} */
  const pieceTypeAt = (sq) => view?.board[sq.row]?.[sq.col]?.type;

  // =========================================================================================================================
  // Mute, motion, theme, settings
  // =========================================================================================================================

  const isMuted = () => forcedMute || (!settings.sfx && !settings.music);

  function syncMute() {
    const muted = isMuted();
    audio.setMuted(muted);
    hud.setMuted(muted);
    speech.setEnabled(settings.readAloud && !muted);         // mute silences the read-aloud voice as well (it stops at once)
  }

  /** The top-bar button toggles settings.sfx and settings.music together (§10.1). */
  function toggleMute() {
    if (isMuted()) {
      forcedMute = false;
      if (!settings.sfx || !settings.music) {
        handlers.setting?.('sfx', true);
        handlers.setting?.('music', true);
      }
    } else {
      handlers.setting?.('sfx', false);
      handlers.setting?.('music', false);
    }
    syncMute();
  }

  function pushSettings() {
    hud.openSettings({ ...settings, theme }, { mode: coach.mode, reason: coach.reason, rank });
  }

  function applyMotion() {
    const next = motionNow() === 'reduced';
    html.dataset.motion = next ? 'reduced' : 'full';
    if (next === reduced) return;
    reduced = next;
    board.setReducedMotion(next);
    fx.setReducedMotion(next);
    buddy.setReducedMotion(next);
    chat.setReducedMotion(next);
    rival.setReducedMotion(next);
    if (next) raysOff();
  }

  /** @param {ThemeId} next */
  function applyTheme(next) {
    theme = next;
    html.dataset.theme = next;
    paintThemeColor();
    scene.setTheme(next);
    board.setTheme(next);
    fx.refreshPalette();
    audio.setPalette(next);
  }

  // =========================================================================================================================
  // Layout, the conversation sheet
  // =========================================================================================================================

  /** The start overlay is on its way out: its fade still takes the taps, and what follows them must not reach the board. */
  let startLeaving = false;
  /** The board takes no tap before this moment (the start overlay has just left, a deal is still landing). */
  let boardFreeAt = 0;
  let boardFreeTimer = 0;
  /** Taps that arrive while the board is held hold it longer, but not past this moment (TAP_BURST_MAX_MS). */
  let burstEndsAt = 0;
  /** The game is over and its card is still to come: nothing starts a new game (the card has its own 再来一局). */
  let cardDue = false;
  let cardDueAt = 0;
  let cardTimer = 0;
  /** When the cue queue last fell empty. */
  let cuesIdleAt = 0;

  /** A position is on the board and nothing forbids touching it. */
  function syncInteractive() {
    const held = startLeaving || now() < boardFreeAt;
    board.setInteractive(view !== null && !replaying && !(sheet && layout.layout === 'compact') && !held);
    // What lies under the buttons of the start overlay is not the board in every layout: on a phone 继续上一局 covers the
    // pouches button, and the third tap of a triple tap opened a pouch. While the board is held, the controls around it
    // take no tap either. `inert` (not a swallowed click), so that a scripted click waits for the control like a finger.
    for (const el of [topbarEl, underbarEl, coachEl, actionsEl]) el.inert = held;
  }

  /** The board takes no tap until `until` (a later moment that was asked for before stands). @param {number} until */
  function holdBoard(until) {
    boardFreeAt = Math.max(boardFreeAt, until);
    win.clearTimeout(boardFreeTimer);
    boardFreeTimer = win.setTimeout(syncInteractive, Math.max(0, boardFreeAt - now()) + 1);
    syncInteractive();
  }

  /**
   * The choice on the start overlay was a tap, and children tap twice or three times: until the overlay has left the
   * screen and TAP_GUARD_MS more have passed, the board takes no tap (CONTRACT-NOTES 138).
   */
  function guardStartTaps() {
    const gone = () => overlaysEl.querySelector('dialog[data-dialog="start"]') === null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      watcher.disconnect();
      win.clearTimeout(backstop);
      startLeaving = false;
      burstEndsAt = Math.max(burstEndsAt, now() + TAP_BURST_MAX_MS);
      holdBoard(now() + TAP_GUARD_MS);
    };
    const watcher = new MutationObserver(() => { if (gone()) release(); });
    startLeaving = true;
    syncInteractive();
    watcher.observe(overlaysEl, { childList: true });
    const backstop = win.setTimeout(release, START_LEAVE_MAX_MS);
    if (gone()) release();
  }

  /**
   * The wait for the game-over card ends without one when none will come (the director is gone, a cue failed): once
   * the cue queue has been empty for CARD_IDLE_MS since the game was over, and CARD_WAIT_MAX_MS after it at the latest.
   * The game is never left without a way to start the next one.
   */
  function watchCard() {
    win.clearTimeout(cardTimer);
    cardTimer = 0;
    if (!cardDue) return;
    const idleSince = cues.length ? now() : Math.max(cardDueAt, cuesIdleAt);
    const left = Math.min(idleSince + CARD_IDLE_MS, cardDueAt + CARD_WAIT_MAX_MS) - now();
    if (left > 0) { cardTimer = win.setTimeout(watchCard, left + 1); return; }
    cardDue = false;
    hud.holdNewGame(false);
  }

  /**
   * The game has just ended: from here until its card is on screen no tap starts a new game. 再来一局 comes into the
   * action slot where 确定落子 has just been pressed, seconds before the card: the hud shows it (and 新对局 of the menu)
   * as not yet available, and the `hud:action` listener below takes no 'new-game' meanwhile.
   */
  function awaitCard() {
    cardDue = true;
    cardDueAt = now();
    hud.holdNewGame(true);
    watchCard();
  }

  /** The card is up, or the game is no longer over. */
  function cardSettled() {
    if (!cardDue) return;
    cardDue = false;
    win.clearTimeout(cardTimer);
    cardTimer = 0;
    hud.holdNewGame(false);
  }

  /**
   * A button of the game-over card was a tap, and children tap twice: until the card has left the screen and
   * TAP_GUARD_MS more have passed, what lies under it takes no tap, exactly as after the start overlay (the board and
   * the controls around it, the burst rule included). In the upright layout 回看棋局 lies over 再来一局 of the action bar.
   */
  function guardCardTaps() {
    // Under reduced motion the card is gone at once, but the finger is no faster for that, and what it would press
    // there starts a new game over the one the child asked to look at: the hold lasts the card's 300 ms all the same.
    burstEndsAt = Math.max(burstEndsAt, now() + CARD_MS + TAP_BURST_MAX_MS);
    holdBoard(now() + CARD_MS + TAP_GUARD_MS);
  }

  /** Portrait: the sheet never covers the square the child is looking at (§12.4); minimum sheet height 280 px. */
  function fitSheet() {
    chatEl.style.maxHeight = '';
    if (!sheet || layout.layout !== 'portrait') return;
    const sq = trial ? trial.move.to : view && view.lastMove ? view.lastMove.to : null;
    if (!sq) return;
    const squareBottom = boardEl.getBoundingClientRect().top + board.squareCenter(sq).y + board.cell() / 2 + 4;
    // the sheet's layout box inside #coach: its slide-in animation must not be measured
    const top = coachEl.getBoundingClientRect().top + coachEl.clientTop + chatEl.offsetTop;
    const bottom = top + chatEl.offsetHeight;
    if (top >= squareBottom) return;
    chatEl.style.maxHeight = `${Math.max(280, Math.floor(bottom - squareBottom))}px`;
  }

  function relayout() {
    layout = measureLayout();
    applyLayout(app, layout, win.visualViewport ?? null);
    app.dataset.sheet = sheet ? '1' : '0';
    buddy.setVariant(layout.buddy);
    chat.setLayout({ mode: layout.layout, showChips: layout.showChips, chipRows: layout.chipRows, kb: layout.kb });
    syncInteractive();
    fitSheet();
    placeRays();
    placeRibbon();
  }

  // =========================================================================================================================
  // 诸葛亮's face (§11.3, §11.5): a base mood, moods held for a while on top of it, `thinking` while a reply is awaited
  // =========================================================================================================================

  /** The mood of the position when no trial is on the board: `worried` in check or after a heavy loss, the result's
   *  mood at game over, else `idle`. @type {Mood} */
  let restMood = 'idle';
  /** @type {Mood} */ let baseMood = 'idle';
  let holdUntil = 0;                     // a held reaction is on his face until then
  /** The line he covers his mouth for. @type {string|null} */ let thinkingFor = null;
  let listening = false;
  let lastPointAt = -Infinity;

  /** @param {Mood} mood */
  function showMood(mood) {
    buddy.setMood(mood);
    holdUntil = 0;
    thinkingFor = null;
  }
  /** @param {Mood} mood @param {number} ms */
  function holdMood(mood, ms) {
    buddy.setMood(mood, { hold: ms });
    holdUntil = now() + ms;
    thinkingFor = null;
  }
  /** Shown at once unless a held mood is running; a held mood returns to it. @param {Mood} mood */
  function setBase(mood) {
    baseMood = mood;
    buddy.setBaseMood(mood);
  }

  /** `thinking` while the first text of a reply (or a tool round) is awaited, unless a reaction owns his face. @param {string} id */
  function startThinking(id) {
    if (trial || phase === 'over' || listening || now() < holdUntil) return;
    buddy.setMood('thinking');
    thinkingFor = id;
  }
  /** @param {string} id */
  function endThinking(id) {
    if (thinkingFor !== id) return;
    thinkingFor = null;
    if (buddy.getMood() === 'thinking' && baseMood !== 'thinking') buddy.setMood(listening ? 'listening' : baseMood);
  }

  /** The fan points at the board when he starts to explain (§11.4). @param {CoachKind} kind */
  function maybePoint(kind) {
    if (kind !== 'hint' && kind !== 'try' && kind !== 'ask') return;
    const t = now();
    if (t - lastPointAt < POINT_GAP_MS) return;
    lastPointAt = t;
    buddy.react('point');
  }

  /** @param {StageView} v @returns {Mood} */
  const restOf = (v) => (v.check !== null && v.check === v.bottom ? 'worried' : 'idle');

  // ---- his mouth (CONTRACT-NOTES 77 / 86: the stage moves it) ---------------------------------------------------------------

  let mouthSeq = 0;
  let mouthTimer = 0;
  function mouthOn() {
    mouthSeq += 1;
    win.clearTimeout(mouthTimer);
    buddy.setSpeaking(true);
  }
  function mouthShut() {
    mouthSeq += 1;
    win.clearTimeout(mouthTimer);
    buddy.setSpeaking(false);
  }
  /** The line has ended: the mouth closes 200 ms after its last character is on screen. @param {string} chatId */
  function mouthRelease(chatId) {
    const seq = ++mouthSeq;
    const from = now();
    win.clearTimeout(mouthTimer);
    const poll = () => {
      if (seq !== mouthSeq) return;
      const entry = chatEl.querySelector(`.msg[data-id="${CSS.escape(chatId)}"]`);
      const typing = entry instanceof HTMLElement && entry.dataset.state === 'streaming' && now() - from < MOUTH_MAX_MS;
      if (typing) { mouthTimer = win.setTimeout(poll, MOUTH_POLL_MS); return; }
      mouthTimer = win.setTimeout(() => { if (seq === mouthSeq) buddy.setSpeaking(false); }, MOUTH_RELEASE_MS);
    };
    poll();
  }

  // =========================================================================================================================
  // The strategist's lines: routing, pacing (K-101), read-aloud
  // =========================================================================================================================

  /** Replies that are open (between coachBegin and coachEnd), by the director's id. @type {Map<string, Line>} */
  const lines = new Map();
  /** The line the bubble shows, or showed last. @type {Line|null} */
  let bubbleLine = null;
  /** coachLocal id -> chat-panel id. @type {Map<string, string>} */
  const alias = new Map();
  let localSeq = 0;
  /** The bubble still carries the caption of the rival's last move (chat-panel keeps it beside `opp` and `system` lines). */
  let captionLive = false;
  /** Local lines waiting for the bubble, in order; `turn` = the synchronous run of calls a line was told in.
   *  @type {{id:string, segments:Segment[], kind:CoachKind, cue:string|null, turn:number}[]} */
  const held = [];
  let heldTimer = 0;
  let turnSeq = 0;
  let turnOpen = false;

  /** The synchronous run of calls the stage is in (one step of a director script). */
  function turnNow() {
    if (!turnOpen) {
      turnOpen = true;
      win.queueMicrotask(() => { turnOpen = false; turnSeq += 1; });
    }
    return turnSeq;
  }

  /** @param {number} chars @returns {number} */
  function readingTime(chars) {
    if (chars <= 0) return 0;
    return TEST ? READ_TEST_MS : clamp(READ_MIN_MS, READ_BASE_MS + READ_PER_CHAR_MS * chars, READ_MAX_MS);
  }

  /** When the bubble may take a local line: its line has ended and has been on screen long enough to be read. */
  function bubbleFreeAt() {
    const line = bubbleLine;
    if (!line) return 0;
    if (line.state !== 'ended') {
      const limit = line.touchedAt + LINE_WATCHDOG_MS;
      if (now() < limit) return limit;
      line.state = 'ended';                                  // a reply that never reported its end
      line.endedAt = now();
      line.chars = 0;
      lines.delete(line.id);
      return 0;
    }
    return line.endedAt + readingTime(line.chars);
  }

  /**
   * Held lines are dropped, never shown late, when the position or the trial changes (K-101). A line the director
   * told in the same run of calls, just before the change it comes with (我看出来了 before the retract, 就走这步
   * before the commit: §4.25.7, §5.8), is not a late line: with `keepThisTurn` it stays and follows the change.
   * @param {boolean} [keepThisTurn]
   */
  function dropHeld(keepThisTurn) {
    const turn = keepThisTurn ? turnNow() : -1;
    const kept = held.filter((item) => item.turn === turn);
    held.length = 0;
    held.push(...kept);
    win.clearTimeout(heldTimer);
    heldTimer = 0;
  }

  function pumpHeld() {
    win.clearTimeout(heldTimer);
    heldTimer = 0;
    while (held.length) {
      const wait = bubbleFreeAt() - now();
      if (wait > 0) { heldTimer = win.setTimeout(pumpHeld, wait + 1); return; }
      const next = held.shift();
      if (next) showLocal(next);
    }
  }

  /** Hands the whole sentences of `text` to read-aloud; what is left of an unfinished sentence comes back. @param {string} id @param {string} text */
  function feedSentences(id, text) {
    let used = 0;
    for (const match of text.matchAll(SENTENCE_RE)) {
      speech.feed(id, match[0]);
      used = match.index + match[0].length;
    }
    return text.slice(used);
  }

  /** @param {string} id @param {string} chatId */
  function remember(id, chatId) {
    alias.set(id, chatId);
    if (alias.size > 48) {
      const first = alias.keys().next();
      if (!first.done) alias.delete(first.value);
    }
  }

  /** The takeaway area of the game-over card, while the card is up. @returns {HTMLElement|null} */
  const cardTarget = () => (overCard && overCard.takeaway.isConnected ? overCard.takeaway : null);

  /** @param {{id:string, segments:Segment[], kind:CoachKind, cue:string|null}} item */
  function showLocal(item) {
    const chatId = chat.local(item.segments, { kind: item.kind, cue: item.cue });
    remember(item.id, chatId);
    const text = item.segments.map(textOf).join('');
    const chars = visibleCount(text) + (item.cue ? visibleCount(item.cue) : 0);
    if (!chars) return;
    clearStatus();
    if (item.kind !== 'opp' && item.kind !== 'system') captionLive = false;
    bubbleLine = { id: item.id, chatId, kind: item.kind, bubble: true, state: 'ended', chars, endedAt: now(), touchedAt: now(),
                   trial: trial ? trial.seq : 0, cut: false, chimed: true, pending: '' };
    audio.play('chat.receive');
    mouthOn();
    mouthRelease(chatId);
    maybePoint(item.kind);
    const rest = feedSentences(item.id, text);               // after chat.local(): the panel cancels read-aloud when a line is replaced
    if (rest.trim()) speech.feed(item.id, rest);
    speech.flush(item.id);
  }

  /** Every open reply is over (settle, a new trial, a retract): nothing will arrive for it any more. @param {boolean} cut */
  function closeLines(cut) {
    let talking = false;
    for (const line of lines.values()) {
      if (line.state === 'streaming') talking = true;
      line.state = 'ended';
      line.endedAt = now();
      line.chars = 0;
      line.cut = cut;
    }
    lines.clear();
    thinkingFor = null;
    if (talking) mouthShut();                                // a reply that is cut off reports no end: he stops talking here
  }

  /** The bubble's open replies are dead: the panel closes them when a new reply begins and at a caption (one at a time). */
  function closeBubbleReplies() {
    let talking = false;
    for (const line of [...lines.values()]) {
      if (!line.bubble) continue;
      if (line.state === 'streaming') talking = true;
      line.state = 'ended';
      line.endedAt = now();
      line.chars = 0;
      lines.delete(line.id);
    }
    if (talking) mouthShut();
  }

  /**
   * The bubble's line belongs to the trial that is being taken back, switched or played: it is marked stale.
   * A local `system` line is never marked (it is not a comment on the trial).
   * @param {string} label @param {boolean} onlyRunning  only a line that was still coming in (§12.7: "a streaming line stops and is marked 已落子")
   */
  function staleTrialLine(label, onlyRunning) {
    const line = bubbleLine;
    if (!line || !trial || line.trial !== trial.seq || line.kind === 'system') return;
    if (onlyRunning && line.state === 'ended' && !line.cut) return;
    chat.end(line.chatId, { reason: 'aborted', source: 'none', stale: label });
    if (line.state === 'streaming') mouthShut();             // cut off in mid-sentence
    line.state = 'ended';
    line.endedAt = now();
    line.chars = 0;
    line.cut = false;
    lines.delete(line.id);
  }

  /**
   * The position has changed: the move links written so far point at squares of an earlier board (a tap would draw
   * an arrow where the piece no longer stands, or try whatever can make that move now). They become plain words, and
   * the arrow of one that was active goes. What is written from here on is about the new position and stays live.
   */
  function retireLinks() {
    chat.retireLinks();
    board.clearArrows('chat');
  }

  /** The moment the bubble speaks about is gone (an undo; the child has moved on): caption, question and line leave. */
  function clearBubble() {
    chat.caption([]);
    captionLive = false;
    bubbleLine = null;
  }

  /** 对方正在想…: shown only while the bubble is stale or empty (§11.6), and taken away when it no longer holds. */
  function clearStatus() {
    const box = buddyEl.querySelector('.bubble');
    if (box instanceof HTMLElement && box.dataset.state === 'status') buddy.bubble.clear();
  }

  // =========================================================================================================================
  // The cue queue (§4.28.9)
  // =========================================================================================================================

  /** In flight, oldest first; only the first one is running. @type {Cue[]} */
  const cues = [];
  let cueGen = 0;

  /** @param {Cue} entry */
  function startCue(entry) {
    entry.started = true;
    const gen = cueGen;
    const live = () => gen === cueGen && !entry.done;
    /** @type {Promise<void>} */ let running;
    try { running = entry.run(live); } catch (error) { report(error); running = Promise.resolve(); }
    running.catch(report).then(() => finishCue(entry));
  }

  /** @param {Cue} entry */
  function finishCue(entry) {
    if (entry.done) return;
    entry.done = true;
    const at = cues.indexOf(entry);
    if (at >= 0) cues.splice(at, 1);
    if (cues.length === 0) cuesIdleAt = now();
    entry.resolve();
    const next = cues[0];
    if (next && !next.started) startCue(next);
  }

  /**
   * @param {(live:() => boolean) => Promise<void>} run
   * @param {(started:boolean) => void} snap
   * @returns {Promise<void>} resolves when the cue has played, or at settle()
   */
  function cue(run, snap) {
    return new Promise((resolve) => {
      /** @type {Cue} */
      const entry = { run, snap, started: false, done: false, resolve };
      cues.push(entry);
      if (cues.length === 1) startCue(entry);
    });
  }

  /** Every cue reaches its final state now: what is running is finished, what was waiting is applied without animation. */
  function flushCues() {
    cueGen += 1;
    const pending = cues.splice(0);
    cuesIdleAt = now();
    for (const entry of pending) entry.done = true;
    board.cancelAnimations();
    fx.clear();
    for (const wake of [...sleepers]) wake();
    for (const entry of pending) {
      try { entry.snap(entry.started); } catch (error) { report(error); }
      entry.resolve();
    }
  }

  /** What the child's finger starts never waits; a cue that has not begun yet is applied first so the board is current. */
  function syncPending() {
    if (cues.some((entry) => !entry.started)) flushCues();
  }

  /** The hard sync of the board to a view. @param {StageView} v */
  function syncBoard(v) {
    board.setOrientation(v.bottom);
    void board.setPosition(v.board, { lastMove: v.lastMove, lastActor: actorOf(v.lastBy) });
    board.setCheck(v.check, v.checkers);
  }

  /** @param {StageView} v */
  function syncHud(v) {
    hud.setTrophies(v.trophies.mine, v.trophies.lost);
    hud.setRound(v.round);
  }

  // =========================================================================================================================
  // Timers: turn.yours (E10) and the silent idle peek (D-43)
  // =========================================================================================================================

  let yoursTimer = 0;
  function cancelYours() {
    win.clearTimeout(yoursTimer);
    yoursTimer = 0;
  }
  function armYours() {
    cancelYours();
    yoursTimer = win.setTimeout(() => {
      yoursTimer = 0;
      if (phase === 'childTurn' && !doc.hidden) audio.play('turn.yours');
    }, YOURS_MS);
  }

  let peekTimer = 0;
  let peekedPly = -1;
  function armPeek() {
    win.clearTimeout(peekTimer);
    peekTimer = 0;
    if ((phase === 'childTurn' || phase === 'selected') && peekedPly !== ply) peekTimer = win.setTimeout(peek, PEEK_MS);
  }
  function peek() {
    peekTimer = 0;
    if (phase !== 'childTurn' && phase !== 'selected') return;
    if (doc.hidden || sheet || overlayOpen()) { armPeek(); return; }
    peekedPly = ply;                                         // once per position
    buddy.react('peek');
    hud.nudgeHint();
  }

  // =========================================================================================================================
  // 司马懿 (§11.7): the director says how he reacts; the stage makes sure the reaction is seen
  // =========================================================================================================================
  //
  // `rattled` is told in the same breath as the commit that punished him, and `thinking` follows in the same batch
  // (§5.8 E-commit, E-rival): shown as told, the rattled face would not last one frame. So it waits for the pay-off of
  // the child's move (the piece has landed, the 招式 stamp or the praise popup is next: they fire together), it stays
  // on his face for a moment, and the thinking face that was told meanwhile follows it.

  /** @type {RivalMood} */ let rivalMood = 'calm';
  /** Committed moves whose pay-off is still to come. */
  let payoffsDue = 0;
  /** `rattled`, told and waiting for the pay-off. @type {{mood:RivalMood, line?:string}|null} */ let rattleDue = null;
  /** Told while he was rattled: shown after it. @type {{mood:RivalMood, line?:string}|null} */ let rivalNext = null;
  let rattledUntil = 0;
  let rivalTimer = 0;

  /** @param {{mood:RivalMood, line?:string}} r */
  function showRival(r) {
    rivalMood = r.mood;
    rival.set(r);
  }

  function showRattled() {
    const r = rattleDue;
    if (!r) return;
    rattleDue = null;
    showRival(r);
    const stay = r.line ? RATTLED_LINE_MS : RATTLED_MS;
    rattledUntil = now() + stay;
    win.clearTimeout(rivalTimer);
    rivalTimer = win.setTimeout(() => {
      rivalTimer = 0;
      const next = rivalNext;
      rivalNext = null;
      if (next) showRival(next);
    }, stay);
  }

  function dropRivalWaits() {
    rattleDue = null;
    rivalNext = null;
    rattledUntil = 0;
    win.clearTimeout(rivalTimer);
    rivalTimer = 0;
  }

  /** The move he reacted to is gone (an undo, a new game): no old reaction, no thinking dots. */
  function restRival() {
    dropRivalWaits();
    if (rivalMood !== 'calm') showRival({ mood: 'calm' });
  }

  /** His turn ended without a move of his (the game is over, his search failed): the thinking dots go (E11). */
  function stopRivalThinking() {
    if (rivalNext && rivalNext.mood === 'thinking') rivalNext = null;
    if (rivalMood === 'thinking') showRival({ mood: 'calm' });
  }

  // =========================================================================================================================
  // The trial
  // =========================================================================================================================

  function endTrial() {
    trial = null;
    audio.setSuspense(false);
  }

  /** The trial went away without a retract or a commit (resign, new game): the board forgets it without a sound. */
  function dropTrialQuietly() {
    if (!trial) return;
    endTrial();
    if (view) syncBoard(view);
  }

  // =========================================================================================================================
  // Game over: the gold rays (E6), the 本局最佳 ribbon and replay, the card (§12.6)
  // =========================================================================================================================

  /** @type {{takeaway:HTMLElement, close:() => void}|null} */ let overCard = null;
  /** @type {OverView|null} */ let overInfo = null;
  let overSeq = 0;
  let replaying = false;
  let tensionNow = 0;
  /** A mate is on the board: the frame's red glow rests from that moment on, whoever was mated. */
  let decided = false;
  /** @type {HTMLElement|null} */ let rays = null;
  /** @type {HTMLElement|null} */ let ribbon = null;

  function placeRays() {
    if (!rays) return;
    const a = app.getBoundingClientRect(), b = boardEl.getBoundingClientRect();
    const size = Math.round(Math.max(b.width, b.height) * 1.7);
    rays.style.width = rays.style.height = `${size}px`;
    rays.style.left = `${Math.round(b.left - a.left + b.width / 2 - size / 2)}px`;
    rays.style.top = `${Math.round(b.top - a.top + b.height / 2 - size / 2)}px`;
  }

  /** E6: a conic-gradient disc behind the board, turning once in 40 s at 25 % opacity. Full motion only. */
  function raysOn() {
    if (reduced || rays) return;
    const el = doc.createElement('div');
    el.className = 'stage-rays';
    el.setAttribute('aria-hidden', 'true');
    const fade = 'radial-gradient(closest-side, #000 28%, transparent 100%)';
    Object.assign(el.style, {
      position: 'absolute', zIndex: '-1', pointerEvents: 'none', borderRadius: '50%', opacity: '0.25',
      background: 'repeating-conic-gradient(from 0deg, var(--fx-spark) 0deg 7deg, transparent 7deg 20deg)',
    });
    el.style.setProperty('-webkit-mask-image', fade);
    el.style.setProperty('mask-image', fade);
    app.append(el);
    rays = el;
    placeRays();
    el.animate([{ opacity: 0 }, { opacity: 0.25 }], { duration: 600, easing: E_OUT });
    el.animate([{ rotate: '0turn' }, { rotate: '1turn' }], { duration: 40000, iterations: Infinity, easing: 'linear' });
  }

  function raysOff() {
    if (!rays) return;
    rays.remove();
    rays = null;
  }

  function placeRibbon() {
    if (!ribbon) return;
    const s = stageEl.getBoundingClientRect(), b = boardEl.getBoundingClientRect();
    ribbon.style.left = `${Math.round(b.left - s.left + b.width / 2)}px`;
    ribbon.style.top = `${Math.round(b.top - s.top + 1)}px`;
  }

  /** @param {string} text */
  function showRibbon(text) {
    hideRibbon();
    const el = doc.createElement('div');
    el.className = 'stage-ribbon';
    el.textContent = text;
    Object.assign(el.style, {
      position: 'absolute', zIndex: '3', translate: '-50% 0', pointerEvents: 'none', whiteSpace: 'nowrap',
      // small enough to stay on the frame's label band: the pieces of the top rank begin .36 c below the edge
      padding: '.06em .9em .1em 1.1em', borderRadius: '999px', letterSpacing: '.2em',
      font: '700 clamp(12px, calc(.27 * var(--c, 40px)), 20px)/1.2 var(--font-kai)',
      background: 'var(--accent)', color: 'var(--accent-ink)',
      boxShadow: '0 3px 0 color-mix(in srgb, var(--accent) 55%, #000), 0 8px 18px #0006',
    });
    stageEl.append(el);
    ribbon = el;
    placeRibbon();
    if (!reduced) el.animate([{ opacity: 0, transform: 'translateY(-70%) scale(.8)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 220, easing: E_BACK });
  }

  function hideRibbon() {
    if (!ribbon) return;
    ribbon.remove();
    ribbon = null;
  }

  /**
   * The final position of a game that is over, without check marks. A mated king lies toppled, as the mate left it
   * (E5): the mating move is seated once more and its animations are cancelled in the same breath, so board-view
   * runs the state changes of the move (the fallen, grey king; the last-move marks) with no motion and no sound.
   */
  function seatFinal() {
    if (!view) return;
    const last = view.lastMove;
    const actor = actorOf(view.lastBy);
    if (!(overInfo && overInfo.reason === 'checkmate' && last && actor)) {
      void board.setPosition(view.board, { lastMove: last, lastActor: actor });
      return;
    }
    const before = view.board.map((row) => row.slice());
    before[last.from.row][last.from.col] = view.board[last.to.row]?.[last.to.col] ?? last.piece;
    before[last.to.row][last.to.col] = last.captured;
    void board.setPosition(before, { lastMove: null });
    void board.playMove(last, { actor, flags: { check: true, mate: true, checkedKing: null, checkers: [], crossed: false } });
    board.cancelAnimations();
  }

  /** The board goes back to the final position after 本局最佳. */
  function endReplay() {
    if (!replaying) return;
    replaying = false;
    hideRibbon();
    seatFinal();
    if (overInfo && overInfo.result === 'loss') boardEl.classList.add('is-lost');
    syncInteractive();
  }

  /**
   * §12.6 step 2: the board shows the position before the child's best move and replays it with its full
   * choreography, 妙计！ and the 自己想的 mark; 3 s in total.
   * @param {NonNullable<OverView['proud']>} proud @param {() => boolean} live
   */
  async function replayProud(proud, live) {
    const from = now();
    replaying = true;
    syncInteractive();
    boardEl.classList.remove('is-lost');                     // a loss ends on the child's best moment, undimmed
    showRibbon(TXT.over.best);
    void board.setPosition(proud.before, { lastMove: null });
    await sleep(PROUD_LEAD_MS);
    if (!live()) return;
    const moved = board.playMove(proud.move, { actor: 'me', flags: { check: false, mate: false, checkedKing: null, checkers: [], crossed: false } });
    await Promise.race([moved, sleep(PROUD_MOVE_MS)]);
    if (!live()) return;
    const at = board.squareCenter(proud.move.to);
    fx.popup(TXT.popup.great, at, { tone: 'great' });
    audio.play(PRAISE.great.sfx);
    if (proud.self) fx.popup(TXT.popup.mark, at, { tone: 'mark' });
    await sleep(PROUD_MS - (now() - from));
    if (!live()) return;
    endReplay();
  }

  /** The chips as last told. @type {ChipSpec[]} */
  let chipList = [];
  let chipsShown = true;

  /** The game-over card is on screen (one that is fading out no longer counts). */
  const cardUp = () => overlaysEl.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]') !== null;

  /**
   * While the game-over card is up the chips stay in the wings: in landscape the card lies over the coach column
   * and would leave half a chip showing under its edge. They come out when the card goes (回看棋局, Esc).
   */
  function syncChips() {
    chipsShown = !cardUp();
    chat.setChips(chipsShown ? chipList : []);
  }

  /** §12.6 step 3. @param {OverView} info */
  function showCard(info) {
    if (overCard) overCard.close();
    overCard = hud.showOver(info);
    syncChips();
    cardSettled();
    // The card may have come up under a finger that is still tapping where 确定落子 was. What lies around it (in
    // landscape 再来一局 of the action bar stays in view under the card) takes no tap until the card is in place and
    // TAP_GUARD_MS more have passed, and a burst of taps that is still going on holds it longer (the hud holds the
    // card's own buttons by the same rule): a new game is started by a tap that was meant.
    burstEndsAt = Math.max(burstEndsAt, now() + CARD_BURST_MAX_MS);
    holdBoard(now() + (reduced ? 0 : CARD_MS) + TAP_GUARD_MS);
  }

  /** The game is no longer over (undo, a new game): everything of the ending goes. */
  function leaveOver() {
    overSeq += 1;
    overInfo = null;
    decided = false;
    if (overCard) { overCard.close(); overCard = null; }
    boardEl.classList.remove('is-lost');
    raysOff();
    hideRibbon();
    if (replaying) {                                         // cut off in mid-replay: the board shows the game again
      replaying = false;
      if (view) syncBoard(view);
      syncInteractive();
    }
    board.setTension(tensionNow);
    audio.music.setScene('game');
  }

  /** What a game-over view changes at once. @param {OverView} info */
  function overState(info) {
    overSeq += 1;
    overInfo = info;
    if (info.rank) { rank = info.rank.name; pushSettings(); }
    dropHeld();
    chat.endAll('aborted');
    closeLines(false);
    retireLinks();                                           // what the card and the questions after it say is about the final board
    dropTrialQuietly();
    cancelYours();
    stopRivalThinking();
    selection = null;
    board.setTension(0);
    board.setCheck(null);                                    // the game is decided: no ring pulses around a king any more
    restMood = info.result === 'win' ? 'cheering' : info.result === 'loss' ? 'consoling' : 'pleased';
  }

  // =========================================================================================================================
  // Tool rounds: the move the strategist is trying on his sand table is played by ghosts (D-38)
  // =========================================================================================================================

  /** @param {Board} b @param {MoveRef} ref @returns {{move:Move, board:Board}|null} */
  function stepOn(b, ref) {
    const piece = b[ref.from.row]?.[ref.from.col] ?? null;
    if (!piece) return null;
    const captured = b[ref.to.row]?.[ref.to.col] ?? null;
    const next = b.map((row) => row.slice());
    next[ref.to.row][ref.to.col] = piece;
    next[ref.from.row][ref.from.col] = null;
    return { move: { from: ref.from, to: ref.to, piece, captured }, board: next };
  }

  /** @param {MoveLink} link */
  function ghostLink(link) {
    if (!view) return;
    /** @type {MoveRef[]} */ let chain = [...link.pre, { from: link.from, to: link.to }];
    let b = view.board;
    /** @type {'now'|'trial'} */ let from = 'now';
    if (trial) {
      const first = chain[0];
      if (first && sameMove(first, trial.move)) {
        const after = stepOn(b, trial.move);
        if (!after) return;
        b = after.board;
        chain = chain.slice(1);
        from = 'trial';
      }
    }
    /** @type {Move[]} */ const moves = [];
    for (const ref of chain) {
      const step = stepOn(b, ref);
      if (!step) return;
      moves.push(step.move);
      b = step.board;
    }
    if (moves.length) void board.previewLine(moves, { from });
  }

  // =========================================================================================================================
  // StagePort
  // =========================================================================================================================

  /** @type {StagePort} */
  const stage = {
    // ---- lifecycle ---------------------------------------------------------------------------------------------------------

    async start(info) {
      const choice = await hud.showStart(info);
      guardStartTaps();                                      // the taps that follow the choice never reach the board
      // The choice was a tap, so the audio context is on its way up: the first deal waits a moment for it.
      if (choice !== 'import') await Promise.race([audio.unlock(), new Promise((resolve) => { win.setTimeout(resolve, UNLOCK_WAIT_MS); })]);
      return choice;
    },

    reset(v, opts) {
      /** @param {boolean} deal @returns {Promise<void>} */
      const apply = (deal) => {
        leaveOver();
        dropHeld();
        closeLines(false);
        endTrial();
        mouthShut();
        speech.cancel();
        chat.clear();
        bubbleLine = null;
        captionLive = false;
        view = v;
        selection = null;
        peekedPly = -1;
        cancelYours();
        restRival();
        tensionNow = 0;                                      // the glow of the game before; the director tells this one's
        board.setTension(0);
        restMood = restOf(v);
        buddy.setMood(restMood, { instant: true });
        holdUntil = 0;
        setBase(restMood);
        syncHud(v);
        board.setOrientation(v.bottom);
        const dealt = board.setPosition(v.board, { lastMove: v.lastMove, lastActor: actorOf(v.lastBy), deal });
        board.setCheck(v.check, v.checkers);
        // the board takes no tap until the pieces of the deal have landed (they are shown at once under reduced motion)
        if (deal && !reduced) {
          burstEndsAt = Math.max(burstEndsAt, now() + TAP_BURST_MAX_MS);
          holdBoard(now() + DEAL_LAND_MS);
        }
        syncInteractive();
        return dealt;
      };
      return cue(() => apply(opts.deal), (started) => { if (!started) void apply(false); });
    },

    phase(p) {
      if (p.phase !== 'over') cardSettled();
      else if (phase !== 'over') awaitCard();                // the game has just ended: its card comes after the celebration
      phase = p.phase;
      ply = p.ply;
      canUndo = p.canUndo;
      hintLevel = p.hintLevel;
      canAsk = p.canAsk;
      app.dataset.phase = p.phase;
      app.dataset.ply = String(p.ply);
      hud.setPhase({ phase: p.phase, canUndo: p.canUndo, hintLevel: p.hintLevel, failed: p.failed });
      // A game that is over shows the last round that was played, not the round that will never be (CONTRACT-NOTES 138).
      // The view of the move that ended the game says the same; a resignation ends it with no move, so it is told here.
      if (p.phase === 'over' && p.ply > 0) hud.setRound(Math.ceil(p.ply / 2));
      if (p.phase !== 'selected' && p.phase !== 'tentative') selection = null;
      if (p.phase !== 'childTurn') cancelYours();
      if (p.phase === 'opponentTurn' && !p.failed) buddy.bubble.status(TXT.status.rivalThinking);
      else clearStatus();
      if (p.phase === 'opponentTurn' && p.failed) stopRivalThinking();
      if (p.phase !== 'over' && overInfo) leaveOver();
      // A trial that neither retracted() nor committed() ended (resign, new game) is gone once this batch of calls is over.
      if (trial && p.phase !== 'tentative') win.queueMicrotask(() => { if (trial && phase !== 'tentative') dropTrialQuietly(); });
      armPeek();
    },

    // ---- board moments -------------------------------------------------------------------------------------------------------

    selected(sq, targets, forbidden) {
      syncPending();
      cancelYours();
      selection = sq;
      if (!trial) board.setSelection(sq, targets, forbidden);
    },

    rejected(sq, reason, streak) {
      if (reason === 'over' || reason === 'stale' || reason === 'nothing-to-undo') return;
      board.nudge(sq);                                       // A5: the shake, the soft `illegal`, the haptic
      if (streak === 3) buddy.react('shake');
    },

    tentative(move, info) {
      syncPending();
      dropHeld();
      cancelYours();
      if (trial) staleTrialLine(TXT.stale.retract, false);   // a switch: the comment on the old square is 已换一步
      chat.endAll('aborted');                                // the reply that was interrupted reports nothing itself
      closeLines(false);
      board.clearArrows();
      board.highlight(null);
      audio.setSuspense(false);
      trial = { move, seq: ++trialSeq, verdict: null, wobbled: false, warned: false };
      selection = move.from;
      const landed = board.showTentative(move, { aim: info.aim, liftStep: Math.floor(ply / 2) });
      fitSheet();
      return landed;
    },

    verdict(v) {
      if (!trial) return;
      // CONTRACT-NOTES 65: a held blunder is `alarmed` only when its question is voiced.
      const mood = moodOfVerdict(v.cat, { held: v.held && (v.cat !== 'blunder' || v.voiced), earned: v.earned });
      trial.verdict = v;
      if (!v.final) {                                        // a provisional verdict changes only the mood
        showMood(mood);
        setBase(mood);
        return;
      }
      if (v.cat === 'good' || v.cat === 'ok' || (v.cat === 'best' && !v.earned)) buddy.react('nod');
      if (mood === 'alarmed') {
        holdMood('alarmed', ALARM_MS);
        setBase('worried');
      } else {
        showMood(mood);
        setBase(mood);
      }
      const blunder = v.cat === 'blunder';
      board.setTrialGuard(blunder ? GUARD_BLUNDER_MS : GUARD_MS, blunder && !trial.wobbled);
      if (blunder) trial.wobbled = true;
      audio.setSuspense(v.held);
      if (v.held && v.voiced && !trial.warned) {
        trial.warned = true;
        audio.play('warn');
      }
    },

    retracted(info) {
      syncPending();
      dropHeld(true);
      staleTrialLine(TXT.stale.retract, false);
      chat.endAll('aborted');
      closeLines(false);
      const origin = trial ? trial.move.from : null;
      endTrial();
      showMood(restMood);
      setBase(restMood);
      selection = info.reselect ? origin : null;
      const back = board.retractTentative({ reselect: info.reselect, targets: info.targets, forbidden: info.forbidden });
      fitSheet();
      pumpHeld();                                            // a line told together with the retract (K-101)
      return back;
    },

    committed(info) {
      /** What the move changes at once. @returns {boolean} the piece is hovering on the board as a trial */
      const state = () => {
        const hovering = info.fromTrial && trial !== null && sameMove(trial.move, info.move);
        staleTrialLine(TXT.stale.commit, true);
        chat.endAll('aborted');
        closeLines(false);
        retireLinks();
        dropHeld(true);
        // Nothing was said about this move: what the bubble still shows is about the rival's move before it.
        if (captionLive && !(trial && bubbleLine && bubbleLine.trial === trial.seq)) clearBubble();
        endTrial();
        cancelYours();
        view = info.view;
        selection = null;
        restMood = restOf(info.view);
        hud.setRound(info.view.round);
        if (info.flags.mate) { decided = true; board.setTension(0); }
        return hovering;
      };
      // The pay-off of the move: it has landed, the stamp or the popup is next. A rattled 司马懿 waits for it.
      payoffsDue += 1;
      let paid = false;
      const payoff = () => {
        if (paid) return;
        paid = true;
        payoffsDue -= 1;
        if (payoffsDue === 0) showRattled();
      };
      return cue(async (live) => {
        try {
          const hovering = state();
          // §11.5: no red flash, no buzzer, no "bad move" popup; praise waits for the popup below.
          if (info.flags.mate) holdMood('cheering', MATE_CHEER_MS);        // 绝杀: he cheers before the card says so
          else if (info.praise) buddy.setMood(buddy.getMood(), { hold: 6000 });
          else if (info.cat === 'mistake' || info.cat === 'blunder') holdMood('worried', SLIP_MS);
          else if (info.flags.check && !info.flags.mate) holdMood('pleased', CHECK_MS);
          else showMood(restMood);
          setBase(restMood);
          pumpHeld();                                        // a line told together with the commit (K-101)
          const landed = hovering
            ? board.commitTentative({ flags: info.flags, soft: info.softCheck })
            : board.playMove(info.move, { actor: 'me', flags: info.flags, soft: info.softCheck });
          if (info.move.captured) await Promise.race([landed, sleep(700)]);    // the trophy pops when the piece falls
          hud.setTrophies(info.view.trophies.mine, info.view.trophies.lost);
          await landed;
        } finally {
          payoff();
        }
        if (!live()) return;
        fitSheet();
        const at = board.squareCenter(info.move.to);
        if (info.stamp) {                                    // the 招式 seal first, then the praise (§10.4.4)
          audio.play('stamp', info.stamp.size === 'small' ? { gain: 0.5 } : undefined);
          await fx.stamp(info.stamp.text, { size: info.stamp.size, at });
          if (!live()) return;
        }
        if (info.praise) {
          const { tier, streak } = info.praise;
          const spec = PRAISE[tier];
          fx.popup(tier === 'great' && streak >= STREAK_FROM ? streakText(streak) : TXT.popup[tier], at, { tone: tier });
          audio.play(spec.sfx);
          if (tier === 'brilliant') fx.haptic('capture');
          if (!info.flags.mate) holdMood(spec.mood, spec.hold);
          if (info.self) fx.popup(TXT.popup.mark, at, { tone: 'mark' });
          await sleep(POPUP_READ_MS);
        } else if (info.self) {
          fx.popup(TXT.popup.mark, at, { tone: 'mark' });
        }
      }, (started) => {
        if (!started) { state(); syncBoard(info.view); }
        hud.setTrophies(info.view.trophies.mine, info.view.trophies.lost);
        showMood(restMood);
        setBase(restMood);
        payoff();
      });
    },

    rivalMoved(info) {
      const round = Math.floor(ply / 2) + 1;                 // the round the move belongs to, from the plies played before it
      const state = () => {
        dropHeld();
        dropTrialQuietly();
        cancelYours();
        view = info.view;
        selection = null;
        retireLinks();                                       // before the caption of this move: that one is about the board of now
        chat.addEvent(`第 ${round} 回合 · 对方 ${info.notation}`);       // the divider of the 回看 log (§4.28.6)
        if (info.caption.length) stage.caption(info.caption);
        hud.setRound(info.view.round);
        // §11.5: check -> worried; a big piece fell -> alarmed, then worried; else idle
        const check = info.flags.check || info.flags.mate;
        if (info.flags.mate) { decided = true; board.setTension(0); }
        restMood = check || info.lostBig ? 'worried' : 'idle';
        if (info.lostBig) holdMood('alarmed', ALARM_MS);
        else if (check) showMood('worried');
        setBase(restMood);
      };
      return cue(async (live) => {
        state();
        const landed = board.playMove(info.move, { actor: 'rival', flags: info.flags, soft: info.softCheck });
        if (info.move.captured) await Promise.race([landed, sleep(reduced ? 350 : 900)]);
        hud.setTrophies(info.view.trophies.mine, info.view.trophies.lost);
        await landed;
        if (!live()) return;
        fitSheet();
        armYours();
      }, (started) => {
        if (!started) { state(); syncBoard(info.view); }
        hud.setTrophies(info.view.trophies.mine, info.view.trophies.lost);
      });
    },

    undone(info) {
      const state = () => {
        leaveOver();
        dropHeld();
        chat.endAll('aborted');
        closeLines(false);
        retireLinks();
        clearBubble();
        endTrial();
        cancelYours();
        restRival();
        view = info.view;
        selection = null;
        peekedPly = -1;
        restMood = restOf(info.view);
        showMood(restMood);
        setBase(restMood);
        syncHud(info.view);
      };
      const marks = () => {
        board.setLastMove(info.view.lastMove, actorOf(info.view.lastBy));
        board.setCheck(info.view.check, info.view.checkers);
        syncInteractive();
        fitSheet();
      };
      return cue(async (live) => {
        state();
        await board.undoMoves(info.steps, info.view.board);
        if (!live()) return;
        marks();
      }, (started) => {
        if (!started) state();
        syncBoard(info.view);
        marks();
      });
    },

    hint(step, focus) {
      syncPending();
      audio.play('fan.sweep');
      audio.play(step === 1 ? 'hint.1' : step === 2 ? 'hint.2' : 'hint.3');
      fx.wind();
      if (step === 1) {                                      // F1: a question
        holdMood('curious', CURIOUS_MS);
      } else if (step === 2) {                               // F2: the piece or the area
        const pieces = focus.pieces ?? [], squares = focus.squares ?? [];
        if (pieces.length || squares.length) board.highlight({ pieces, squares, dim: true });
        lastPointAt = now();
        buddy.react('point');
      } else if (focus.move) {                               // F3: the move; the spotlight of pouch 2 gives way to the arrow
        const { from, to } = focus.move;
        board.highlight(null);
        board.showArrows([{ from, to, style: 'hint', demo: true, pieceType: pieceTypeAt(from) }], { group: 'hint' });
      }
    },

    tension(x) {
      tensionNow = x;
      if (!overInfo && !decided) board.setTension(x);        // the frame's red glow rests once the game is decided
      audio.setTension(x);
    },

    rival(r) {
      if (r.mood === 'rattled') {                            // fires with the pay-off of the move that punished him
        rivalNext = null;
        rattleDue = r;
        if (payoffsDue === 0) showRattled();
        return;
      }
      if ((r.mood === 'thinking' || r.mood === 'frown') && (rattleDue || now() < rattledUntil)) {
        rivalNext = r;                                       // what he does next waits until his fright has been seen
        return;
      }
      dropRivalWaits();
      showRival(r);
    },

    over(info) {
      return cue(async (running) => {
        const seq = (overState(info), overSeq);
        const live = () => running() && seq === overSeq;     // also over when the game goes on (an undo) without a settle()
        if (info.quiet) {                                    // a finished game was restored: the card only, no celebration
          buddy.setMood(restMood, { instant: true });
          holdUntil = 0;
          setBase(restMood);
          seatFinal();                                       // ... on the position as the game left it
          showCard(info);
          return;
        }
        showMood(restMood);
        setBase(restMood);
        if (info.result === 'win') {                         // E6
          audio.music.setScene('victory');
          fx.confetti();
          raysOn();
          if (!(info.byChildMate && info.reason === 'checkmate')) {      // a mate has already shown 绝杀 and sounded `win`
            audio.play('win');
            fx.haptic('win');
          }
          if (info.reason === 'stalemate') await fx.banner('stalemate');
          await sleep(reduced ? 0 : info.proud ? CONFETTI_MS : WIN_PAUSE_MS);
        } else if (info.result === 'loss') {                 // E7: never a slam, never red
          audio.music.setScene('defeat');
          boardEl.classList.add('is-lost');
          audio.play('lose');
          await fx.banner('lose');
        } else {                                             // E8
          audio.play('draw');
          await fx.banner('draw');
        }
        if (!live()) return;
        if (info.proud) {
          await replayProud(info.proud, live);
          if (!live()) return;
        }
        showCard(info);
        await sleep(reduced ? 0 : CARD_MS);
      }, (started) => {
        const seq = started ? overSeq : (overState(info), overSeq);
        endReplay();
        if (info.quiet && !started) seatFinal();
        showMood(restMood);
        setBase(restMood);
        if (!info.quiet) {
          audio.music.setScene(info.result === 'win' ? 'victory' : info.result === 'loss' ? 'defeat' : 'game');
          if (info.result === 'loss') boardEl.classList.add('is-lost');
        }
        // settle() comes before something else happens (an undo, a new game): the card is put up only if the game is
        // still over once that has been said.
        win.setTimeout(() => { if (seq === overSeq && overInfo === info && !cardTarget()) showCard(info); }, 0);
      });
    },

    // ---- see-first helpers -----------------------------------------------------------------------------------------------------

    arrows(list, opts) {
      syncPending();
      board.showArrows(list, { group: opts?.group, ttl: opts?.ttl });
    },

    clearArrows(group) {
      board.clearArrows(group);
    },

    highlight(h) {
      syncPending();
      board.highlight(h);
    },

    preview(moves, opts) {
      syncPending();
      return board.previewLine(moves, { from: opts.from });
    },

    // ---- strategist text ---------------------------------------------------------------------------------------------------------

    coachBegin(msg) {
      const card = msg.target === 'card' ? cardTarget() : null;
      chat.begin({ id: msg.id, kind: msg.kind, cue: msg.cue ?? null, target: card ?? 'bubble' });
      /** @type {Line} */
      const line = { id: msg.id, chatId: msg.id, kind: msg.kind, bubble: !card, state: 'waiting', chars: 0, endedAt: 0, touchedAt: now(),
                     trial: trial ? trial.seq : 0, cut: false, chimed: false, pending: '' };
      if (line.bubble) closeBubbleReplies();                 // the reply it replaces was aborted without a call
      lines.set(msg.id, line);
      if (!line.bubble) return;
      bubbleLine = line;                                     // a reply takes the bubble at once (K-101)
      if (msg.kind !== 'opp' && msg.kind !== 'system') captionLive = false;
      startThinking(msg.id);
      pumpHeld();                                            // re-times what is waiting behind it
    },

    coachSegment(id, seg) {
      chat.segment(id, seg);
      const line = lines.get(id);
      const text = textOf(seg);
      if (!line || !text) return;
      line.touchedAt = now();
      if (line.state === 'waiting') {
        line.state = 'streaming';
        endThinking(id);
        mouthOn();
        if (!line.chimed) {
          line.chimed = true;
          audio.play('chat.receive');
          if (line.bubble) maybePoint(line.kind);
        }
      }
      line.chars += visibleCount(text);
      line.pending = feedSentences(id, line.pending + text);
    },

    coachReset(id) {
      chat.reset(id);                                        // also cancels read-aloud
      const line = lines.get(id);
      if (!line) return;
      line.state = 'waiting';
      line.chars = 0;
      line.pending = '';
      line.touchedAt = now();
    },

    coachEnd(id, end) {
      const waiting = held.findIndex((item) => item.id === id);
      if (waiting >= 0) { held.splice(waiting, 1); return; }  // a local line that was never shown
      const chatId = alias.get(id) ?? id;
      chat.end(chatId, end);
      const line = lines.get(id);
      if (!line) return;                                     // a local line: only its label was added
      lines.delete(id);
      if (end.reason === 'aborted') {
        line.chars = 0;                                      // nothing is left to read
      } else {
        if (line.pending.trim()) speech.feed(id, line.pending);
        speech.flush(id);
      }
      line.pending = '';
      line.state = 'ended';
      line.endedAt = now();
      endThinking(id);
      mouthRelease(chatId);
      if (line === bubbleLine) pumpHeld();
    },

    coachTool(id, t) {
      chat.tool(alias.get(id) ?? id, { phase: t.phase, notation: t.notation });
      const line = lines.get(id);
      if (line) line.touchedAt = now();
      if (t.phase === 'start') {
        if (line && line.bubble) startThinking(id);
        if (t.link) ghostLink(t.link);
      } else {
        endThinking(id);
      }
    },

    coachLocal(segments, opts) {
      const id = `stage-${++localSeq}`;
      const kind = opts?.kind ?? 'system';
      const cue = opts?.cue ?? null;
      const card = opts?.target === 'card' ? cardTarget() : null;
      if (card) {                                            // the card has its own line: nothing to pace
        const chatId = chat.local(segments, { kind, cue, target: card });
        remember(id, chatId);
        const text = segments.map(textOf).join('');
        if (visibleCount(text)) {
          mouthOn();
          mouthRelease(chatId);
          const rest = feedSentences(id, text);
          if (rest.trim()) speech.feed(id, rest);
          speech.flush(id);
        }
        return id;
      }
      const item = { id, segments, kind, cue, turn: turnNow() };
      if (held.length || bubbleFreeAt() > now()) {           // K-101: the line on screen is read first
        held.push(item);
        pumpHeld();
      } else {
        showLocal(item);
      }
      return id;
    },

    caption(segments) {
      chat.caption(segments);                                // ends every reply the bubble was waiting for
      closeBubbleReplies();
      bubbleLine = null;                                     // a caption is not a line to wait for
      captionLive = segments.some((seg) => textOf(seg).length > 0);
      pumpHeld();
    },

    childSaid(text) {
      chat.addChild(text);
      audio.play('chat.send');
    },

    chips(list) {
      chipList = list;
      syncChips();
    },

    input(s) {
      inputVisible = s.visible;
      chat.setInput(s);
    },

    coachMode(m) {
      coach = { mode: m.mode, reason: m.reason };
      app.dataset.coach = m.mode;
      pushSettings();
    },

    beacon() {
      hud.beaconConfirm();
    },

    // ---- misc ----------------------------------------------------------------------------------------------------------------------

    toast(text) {
      hud.toast(text);
    },

    announce(text) {
      const live = boardEl.querySelector('#board-announcement');
      if (live) live.textContent = text;
    },

    dialog(kind) {
      return kind === 'resign' ? hud.confirm('resign') : hud.newGameDialog();
    },

    notation(rows, current) {
      hud.setNotation(rows, current);
    },

    blocking(n) {
      hud.blocking(n);
    },

    settle() {
      dropHeld();
      flushCues();                                           // board.cancelAnimations(), fx.clear(), then every waiting cue's final state
      audio.cancelScheduled();
      speech.cancel();
      // Every line that is still coming in is cut to its whole sentences, but the one about the trial on the board: what
      // follows in this run of calls (a retract, a commit) marks it 已换一步 / 已落子 and keeps its text as it stands
      // (SPEC 7.7, 12.7). When nothing takes it up, it is cut like the others once the run is over.
      const kept = trial && bubbleLine && bubbleLine.state !== 'ended' && bubbleLine.trial === trial.seq && bubbleLine.kind !== 'system'
        ? bubbleLine.chatId : undefined;
      chat.endAll('aborted', kept);
      if (kept !== undefined) win.queueMicrotask(() => chat.end(kept, { reason: 'aborted', source: 'none' }));
      closeLines(true);
      if (bubbleLine && bubbleLine.state !== 'ended') {
        bubbleLine.state = 'ended';
        bubbleLine.endedAt = now();
        bubbleLine.chars = 0;
        bubbleLine.cut = true;
      }
      mouthShut();
    },

    applySettings(s) {
      const before = settings;
      settings = { ...s };
      if (s.theme !== before.theme && s.theme !== theme) applyTheme(s.theme);      // ?theme= holds until the setting changes
      applyMotion();
      audio.applySettings({ sfx: s.sfx, music: s.music, volume: s.volume });
      syncMute();                                            // also switches read-aloud (settings.readAloud, unless muted)
      fx.setHaptics(s.haptics);
      chat.setTypeTicks(s.typeTicks);
      pushSettings();
    },

    on(h) {
      handlers = h;
    },
  };

  // =========================================================================================================================
  // The modules' events -> StageHandlers (the stage never decides what an intent means)
  // =========================================================================================================================

  app.addEventListener('hud:action', (event) => {
    const detail = detailOf(event);
    const fromCard = detail.card === true;                   // a button of the game-over card (the hud has closed the card)
    switch (detail.action) {
      case 'undo': handlers.undo?.(); break;
      case 'hint': handlers.hint?.(); break;
      case 'confirm': handlers.confirm?.(); break;
      case 'retract': handlers.retract?.(); break;
      case 'new-game':
        // The game is over and its card is still to come: the hud shows 再来一局 and 新对局 as not available meanwhile
        // (holdNewGame), and whatever still sends the action is not taken. The card brings its own 再来一局.
        if (cardDue) break;
        handlers.newGame?.();
        if (fromCard) guardCardTaps();                       // the second tap of a double tap reaches nothing under the card
        break;
      case 'resign': handlers.resign?.(); break;
      case 'retry-opponent': handlers.retryOpponent?.(); break;
      case 'retry-engine': handlers.retryEngine?.(); break;
      case 'export': handlers.exportRecord?.(); break;
      case 'export-backup': handlers.exportBackup?.(); break;
      case 'mute': toggleMute(); break;
      case 'review': {                                       // "show me the board and the last move again"
        if (overCard) overCard.close();
        if (fromCard) guardCardTaps();                       // 回看棋局: what the card covered takes no tap while it leaves
        if (!chipsShown) syncChips();                        // the card is going: the chips it covered come out
        const last = view ? view.lastMove : null;
        if (last && !replaying) {
          // The mover stands on the target now, which board-view would take for a cannon's screen-jump: a cannon
          // that did not capture went straight.
          const pieceType = last.piece.type === 'cannon' && !last.captured ? undefined : last.piece.type;
          board.showArrows([{ from: last.from, to: last.to, style: 'last', pieceType }], { group: 'review', ttl: REVIEW_ARROW_MS });
        }
        break;
      }
      default: break;
    }
  });

  app.addEventListener('hud:setting', (event) => {
    const { key, value } = detailOf(event);
    if (typeof key === 'string' && key in settings) handlers.setting?.(/** @type {keyof Settings} */ (key), value);
  });

  app.addEventListener('hud:import', (event) => {
    const { text } = detailOf(event);
    handlers.importBackup?.(typeof text === 'string' ? text : '');
  });

  boardEl.addEventListener('board:pick', (event) => {
    const { row, col, via } = detailOf(event);
    if (typeof row !== 'number' || typeof col !== 'number') return;
    cancelYours();
    board.clearArrows('chat');                               // the active move link was deactivated without an event
    handlers.tap?.(row, col, via === 'drag' || via === 'key' ? via : 'tap');
  });
  boardEl.addEventListener('pointerdown', cancelYours, true);

  app.addEventListener('chat:ask', (event) => {
    const { code, text } = detailOf(event);
    handlers.ask?.({
      code: typeof code === 'string' ? /** @type {AskCode} */ (code) : undefined,
      text: typeof text === 'string' ? text : undefined,
    });
  });
  app.addEventListener('chat:chip', (event) => {
    const { chip } = detailOf(event);
    if (chip && typeof chip === 'object') handlers.chip?.(/** @type {ChipSpec} */ (chip));
  });
  app.addEventListener('chat:movelink', (event) => {
    const { link, active } = detailOf(event);
    if (link && typeof link === 'object') handlers.moveLink?.(/** @type {MoveLink} */ (link), active === true);
  });
  app.addEventListener('chat:playline', (event) => {
    const { links } = detailOf(event);
    if (Array.isArray(links)) handlers.playLine?.(/** @type {MoveLink[]} */ (links));
  });
  app.addEventListener('chat:stop', () => {
    handlers.stopCoach?.();
    closeLines(false);                                       // the panel has ended its lines; nothing more will arrive
    if (bubbleLine && bubbleLine.state !== 'ended') {
      bubbleLine.state = 'ended';
      bubbleLine.endedAt = now();
      bubbleLine.chars = 0;
    }
    mouthShut();
    if (buddy.getMood() === 'thinking' && baseMood !== 'thinking') buddy.setMood(baseMood);
    pumpHeld();
  });
  app.addEventListener('chat:sheet', (event) => {
    sheet = detailOf(event).open === true;
    relayout();                                              // sets #app[data-sheet], applies the layout, then chat.setLayout
  });

  // The game-over card can also leave by itself (Esc inside it): the chips follow when the hud takes it away.
  new MutationObserver(() => { if (chipsShown === cardUp()) syncChips(); }).observe(overlaysEl, { childList: true });

  buddyEl.addEventListener('bubble:expand', () => chat.setSheet(true));
  buddyEl.addEventListener('buddy:tap', () => buddy.react('hop'));

  // Typing: he listens (§12.4).
  chatEl.addEventListener('focusin', (event) => {
    if (!(event.target instanceof HTMLElement) || event.target.id !== 'chat-input') return;
    listening = true;
    buddy.setMood('listening');
  });
  chatEl.addEventListener('focusout', (event) => {
    if (!(event.target instanceof HTMLElement) || event.target.id !== 'chat-input') return;
    listening = false;
    if (buddy.getMood() === 'listening') buddy.setMood(baseMood);
  });

  // "A tap outside" closes the sheet (§12.4): the compact miniature, or the empty parts of the shell. The board stays
  // a board in landscape and portrait, and every button keeps its own meaning.
  app.addEventListener('click', (event) => {
    if (!sheet) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || coachEl.contains(target) || overlaysEl.contains(target)) return;
    if (layout.layout === 'compact' && stageEl.contains(target)) { chat.setSheet(false); return; }
    if (target.closest('button, a, input, textarea, select, .bv')) return;
    chat.setSheet(false);
  });

  // ---- keyboard shortcuts (§4.28.9). While a modal overlay of the hud is open its own handler stops the event. -------------

  doc.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const inText = !!target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (event.key === 'Escape') {
      // retract, else deselect, else close the top sheet; a sheet that holds the keyboard focus closes first
      if (sheet && target && chatEl.contains(target)) chat.setSheet(false);
      else if (phase === 'tentative') handlers.retract?.();
      else if (phase === 'selected' && selection) handlers.tap?.(selection.row, selection.col, 'key');
      else if (sheet) chat.setSheet(false);
      else return;
      event.preventDefault();
      return;
    }
    if (inText || event.repeat) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'u') {
      if (phase !== 'boot' && canUndo) handlers.undo?.();
    } else if (key === 'h') {
      if ((phase === 'childTurn' || phase === 'selected') && hintLevel < 3) handlers.hint?.();
    } else if (key === 'Enter') {
      // a focused button (a board cell, 换一步, a chip) takes its own Enter
      if (phase === 'tentative' && !(target && target.closest('button, a[href], summary, [role="button"]'))) handlers.confirm?.();
    } else if (key === '/') {
      if (!inputVisible || !canAsk) return;                  // no free text, or nothing may be asked right now
      event.preventDefault();
      chat.setSheet(true, { focusInput: true });
    }
  });

  // ---- every gesture: audio unlock (iOS re-suspends after interruptions), idle timers -------------------------------------

  const onGesture = () => {
    void audio.unlock();
    handlers.activity?.();
    armPeek();
  };
  win.addEventListener('pointerdown', onGesture, true);
  win.addEventListener('keydown', onGesture, true);
  // A burst of taps is not over while taps keep coming: a tap that arrives while the board is held after the start
  // overlay or during a deal holds it TAP_BURST_MS longer, so the third tap of a slow triple tap does not land either.
  // The burst has an end (burstEndsAt): taps that keep coming after it are meant, and the first of them is taken.
  win.addEventListener('pointerdown', () => {
    if (startLeaving) holdBoard(now() + TAP_BURST_MS);
    else if (now() < boardFreeAt) holdBoard(Math.min(now() + TAP_BURST_MS, burstEndsAt));
  }, true);
  // A finger's pointerdown is not a user activation (for touch the activating events are pointerup and touchend), so
  // the context is asked again when the finger lifts; unlock() is idempotent.
  win.addEventListener('pointerup', () => { void audio.unlock(); }, true);

  doc.addEventListener('visibilitychange', () => {
    audio.setHidden(doc.hidden);
    if (doc.hidden) speech.cancel();
    else armPeek();
  });

  // ---- layout events (§12.2) ---------------------------------------------------------------------------------------------------

  win.addEventListener('resize', relayout);
  win.addEventListener('orientationchange', relayout);
  if (win.visualViewport) {
    win.visualViewport.addEventListener('resize', relayout);
    win.visualViewport.addEventListener('scroll', relayout);
  }
  if (prefersReduced) prefersReduced.addEventListener('change', applyMotion);

  // ---- first paint ---------------------------------------------------------------------------------------------------------------

  relayout();
  syncMute();
  pushSettings();
  buddy.setMood('idle', { instant: true });

  if (TEST) {
    const isIdle = () => cues.length === 0 && held.length === 0 && html.dataset.uiBusy !== '1';
    Object.assign(win, {
      __ui: {
        /** Resolves when no cue is in flight, no line is waiting for the bubble and the board is not animating. @returns {Promise<void>} */
        idle: () => new Promise((resolve) => {
          const check = () => { if (isIdle()) resolve(undefined); else win.setTimeout(check, 30); };
          check();
        }),
        fxLive: () => fx.live,
      },
    });
  }

  return stage;
}
