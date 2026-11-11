// The single entry point for text on screen: history log, chips, input, conversation sheet; mirrors the
// current line into buddy.bubble (SPEC §4.28.6, placement §12.3 / §12.4). Package X6.
//
// Events on `host` (bubbling CustomEvents): chat:ask {code?:AskCode, text?:string}, chat:chip {chip:ChipSpec},
// chat:movelink {link, active}, chat:playline {links}, chat:stop {}, chat:sheet {open}.
//
// What the host looks like (`host` becomes .chat; the hooks of §4.28.9 are the ids and classes below):
//   .chat[data-sheet="0|1"][data-mode][data-kb][data-rows][data-input]
//     button.chat__head                      sheet only: its title 回看 and ▾; a tap closes the sheet
//     .chat__log[role=log]                   sheet only: p.chat__event, .msg[data-role][data-kind][data-state][data-source]
//                                            (.msg > .msg__cue? + .msg__text + .msg__tag?; a caption is .msg[data-kind="caption"])
//     .chat__chips[role=group]               button.chip[data-ask] / button.chip[data-action]
//     .chat__tools                           #chat-toggle (✎, only while free text is available), #history-button (回看)
//     form.chat__input                       #chat-input, #chat-send; in the DOM only while free text is available
//
// How the pieces work together (for the stage, package X8):
// - Sheet. setSheet() is the only place the sheet opens or closes, whoever asks (回看, ✎, the `write` chip, ▾, the
//   browser's back button, or the stage after `bubble:expand`, `/`, Esc or a tap outside). Every change is reported once
//   with chat:sheet {open}; the stage answers by setting #app[data-sheet] and applying the layout. Calling
//   setSheet() with the state it already has does nothing, so the stage may echo the event back.
//   This module owns ▾ and the history entry that makes the back button close the sheet; Esc and "a tap outside"
//   involve elements of other modules and belong to the stage.
// - Lines. begin() / segment() / end() render one line twice: in the log, and in its target (the bubble, or an element
//   such as the game-over card's takeaway). `.bubble[data-state]` and `.bubble[data-source]` are written here (through
//   the text container the bubble hands out), because only this module knows when a line is complete and where it
//   came from. A line whose reply was aborted without a call of end() (the coach client calls no handler then) is
//   closed here when the next reply begins (begin), at the next caption, when chat:stop is sent and by endAll().
// - Two lines at once. The bubble shows one line. local() takes it over at once: a reply that is in mid-sentence is
//   closed, but a reply that has not said anything yet (begin() was called, no segment has arrived) is kept: it
//   waits in the log and takes the bubble back when its first text arrives. This is the script of a rival move
//   (§5.8): the reply is opened and, in the same turn, 悔一步重想 is offered with a local line.
// - Typing. A line that has ended keeps typing until its text is on screen (well under a second: the rate grows
//   with the backlog); only then its state becomes `done`. An aborted line drops what was not typed yet. A `cut`
//   line is trimmed to its whole sentences (§7.7). Under reduced motion, or while the page is hidden, text appears
//   at once.
// - Mouth and read-aloud are not driven from here (CONTRACT-NOTES item 86): the stage calls buddy.setSpeaking and
//   feeds speech. This module only cancels read-aloud when a line is aborted or reset, and keeps chat.tick silent
//   while speech reports that it is speaking.

/** @import { Segment } from '../coach/types.js' */
/** @import { ChipSpec, CoachKind } from '../game/types.js' */
/** @import { AudioEngine, Bubble, ChatPanel, LayoutMode, Speech, StreamText } from './types.js' */

import { CUE } from '../core/codes.js';
import { createStreamText } from './stream-text.js';
import { TXT } from './texts.js';

const MAX_MESSAGES = 60;         // messages kept in the log
const STICK_PX = 40;             // the log follows new text while the reader is this close to its bottom
const TICK_GAP_MS = 70;          // chat.tick at most once per 70 ms
const TYPING_DELAY_MS = 300;     // the three dots appear when nothing has arrived for this long
const INPUT_MAX = 120;           // characters of a typed question

const LABEL_CHIPS = '快捷提问';
const LABEL_TOGGLE = '打字问军师';
const LABEL_SEND = '发送';
const LABEL_STOP = '停止';
const PLACEHOLDER = '问问军师……（别写个人信息）';
const GLYPH_TOGGLE = '✎';
const GLYPH_STOP = '■';
const GLYPH_CLOSE = '▾';
/** The tool indicator (the text of STR.toolBusy, which the UI may not import). @param {string} [notation] */
const toolLine = (notation) => (notation ? `亮在沙盘上摆一摆【${notation}】……` : '亮在沙盘上摆一摆……');

/** Interjections by tone (§11.6): the bubble tag and the log tag take their fill from it. */
/** @type {string[]} */
const GOOD_CUES = [CUE.wow, CUE.nice, CUE.lord, CUE.win, CUE.go];
/** @type {string[]} */
const WARN_CUES = [CUE.wait, CUE.stop, CUE.alert];

/** @param {string|null} cue @returns {'good'|'warn'|'neutral'} */
function toneOf(cue) {
  if (cue === null) return 'neutral';
  if (GOOD_CUES.includes(cue)) return 'good';
  if (WARN_CUES.includes(cue)) return 'warn';
  return 'neutral';
}

/** Characters of a segment as stream-text counts them. @param {Segment} seg @returns {number} */
function sizeOf(seg) {
  if (seg.type === 'move') return Array.from(seg.notation).length;
  return seg.type === 'text' && seg.text ? Array.from(seg.text).length : 0;
}

/**
 * The segments up to the end of the last whole sentence (。！？ and the closing marks right after it).
 * Returns the same array when nothing has to go, or when there is no sentence end at all.
 * @param {Segment[]} segments
 * @returns {Segment[]}
 */
function wholeSentences(segments) {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.type !== 'text') continue;
    let cut = -1;
    for (const match of seg.text.matchAll(/[。！？][」』”’）》]*/g)) cut = match.index + match[0].length;
    if (cut < 0) continue;
    if (i === segments.length - 1 && cut === seg.text.length) return segments;
    const kept = segments.slice(0, i);
    kept.push({ type: 'text', text: seg.text.slice(0, cut) });
    return kept;
  }
  return segments;
}

/**
 * One line of the strategist.
 * @typedef {Object} Entry
 * @property {string} id
 * @property {string} kind                          CoachKind, or 'caption'
 * @property {string|null} cue
 * @property {'bubble'|HTMLElement} target
 * @property {HTMLElement} el                       its .msg in the log
 * @property {HTMLElement} textEl                   .msg__text
 * @property {StreamText} log                       the copy in the log
 * @property {StreamText|null} out                  the copy in the bubble or in the target element
 * @property {HTMLElement|null} outEl               the container of `out`
 * @property {'streaming'|'done'|'stale'} state
 * @property {boolean} open                         between begin() and end(): text may still arrive
 * @property {EndInfo|null} ending                  end() was called; the typewriter is still catching up
 * @property {number} pushed                        characters handed to the streams
 * @property {number} shown                         characters the leading stream has shown
 * @property {Segment[]} segments
 * @property {number} timer                         the 300 ms timer of the typing dots, 0 = none
 * @property {HTMLElement[]} tool                   the tool indicator's elements (one per copy) while it is showing
 * @property {boolean} gone                         removed from the log
 * @property {string|null} question                 the child's question an `ask` line answers (shown above it in the bubble)
 */
/** @typedef {{reason:'done'|'cut'|'aborted', source:'llm'|'local'|'mixed'|'none', stale?:string}} EndInfo */

/** @param {HTMLElement} host
 *  @param {{ bubble:Bubble, speech:Speech, audio:AudioEngine, typeTicks:boolean, reducedMotion?:boolean }} deps @returns {ChatPanel} */
export function createChatPanel(host, deps) {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  const { bubble, speech, audio } = deps;

  let typeTicks = !!deps.typeTicks;
  let reduced = !!deps.reducedMotion;
  let speaking = false;
  let lastTick = -Infinity;

  let sheet = false;
  let inputOpen = false;           // the ✎ field is expanded (only inside the sheet)
  let inputVisible = false;        // free text is available at all
  let inputEnabled = false;        // a question may be sent right now
  let historyPushed = false;       // the sheet's history entry is on the stack
  let historyUnwinding = false;    // history.back() is under way for that entry; its popstate has not arrived yet
  let stick = true;                // the log follows its bottom edge
  /** @type {{mode:LayoutMode, showChips:boolean, chipRows:number, kb:boolean}} */
  let layout = { mode: 'landscape', showChips: true, chipRows: 2, kb: false };

  /** @type {Map<string, Entry>} */
  const entries = new Map();
  /** @type {Map<Node, Entry>} */
  const byElement = new Map();
  /** @type {Entry|null} */
  let current = null;              // the line the bubble is showing
  let openCount = 0;               // lines between begin() and end()
  let messageCount = 0;            // .msg elements in the log
  let localSeq = 0;
  /** @type {Segment[]|null} */
  let captionSegments = null;      // the caption the bubble carries (kept next to a spoken `opp` / `system` line)
  /** @type {StreamText|null} */
  let captionStream = null;
  /** @type {string|null} */
  let question = null;             // the child's last question, shown above its answer

  /** @type {Map<Element, ChipSpec>} */
  const chipSpecs = new Map();
  /** @type {Set<string>} */
  let chipIds = new Set();

  // ---- DOM ---------------------------------------------------------------------------------------------------------------

  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {string} [className]
   * @returns {HTMLElementTagNameMap[K]}
   */
  function make(tag, className) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  host.classList.add('chat');

  const head = make('button', 'chat__head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'true');
  const title = make('span', 'chat__title');
  title.textContent = TXT.bar.history;
  const arrow = make('span', 'chat__arrow');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = GLYPH_CLOSE;
  head.append(title, arrow);

  const log = make('div', 'chat__log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions');

  const chipsEl = make('div', 'chat__chips');
  chipsEl.setAttribute('role', 'group');
  chipsEl.setAttribute('aria-label', LABEL_CHIPS);

  const tools = make('div', 'chat__tools');
  const toggle = make('button');
  toggle.type = 'button';
  toggle.id = 'chat-toggle';
  toggle.setAttribute('aria-label', LABEL_TOGGLE);
  toggle.textContent = GLYPH_TOGGLE;
  const historyButton = make('button');
  historyButton.type = 'button';
  historyButton.id = 'history-button';
  historyButton.textContent = TXT.bar.history;
  tools.append(historyButton);

  const form = make('form', 'chat__input');
  form.hidden = true;
  form.noValidate = true;
  const input = make('textarea');
  input.id = 'chat-input';
  input.rows = 1;
  input.maxLength = INPUT_MAX;
  input.setAttribute('enterkeyhint', 'send');
  input.placeholder = PLACEHOLDER;
  input.setAttribute('aria-label', LABEL_TOGGLE);
  input.title = TXT.privacy;
  const send = make('button');
  send.type = 'submit';
  send.id = 'chat-send';
  send.setAttribute('aria-label', LABEL_SEND);
  form.append(input, send);

  const note = make('p', 'chat__note');           // the privacy sentence, under the field while it is open (§7.13)
  note.hidden = true;
  note.textContent = TXT.privacy;

  host.append(head, log, chipsEl, tools);

  // ---- helpers ------------------------------------------------------------------------------------------------------------

  /** @param {string} type @param {object} detail */
  function emit(type, detail) {
    const Ctor = (view && view.CustomEvent) || CustomEvent;
    host.dispatchEvent(new Ctor(type, { bubbles: true, detail }));
  }

  const now = () => (view && view.performance ? view.performance.now() : Date.now());

  function follow() {
    if (sheet && stick) log.scrollTop = log.scrollHeight;
  }

  function tick() {
    if (!typeTicks || speaking) return;
    const t = now();
    if (t - lastTick < TICK_GAP_MS) return;
    lastTick = t;
    audio.play('chat.tick');
  }

  function syncSend() {
    const stop = openCount > 0;                    // while a reply is coming in, the button stops it
    send.dataset.mode = stop ? 'stop' : 'send';
    send.textContent = stop ? GLYPH_STOP : '';
    send.setAttribute('aria-label', stop ? LABEL_STOP : LABEL_SEND);
    send.disabled = !stop && (!inputEnabled || input.value.trim() === '');
  }

  function sync() {
    const formOn = sheet && inputOpen && inputVisible;
    host.dataset.sheet = sheet ? '1' : '0';
    host.dataset.mode = layout.mode;
    host.dataset.kb = layout.kb ? '1' : '0';
    host.dataset.rows = layout.chipRows >= 2 ? '2' : '1';
    host.dataset.input = formOn ? '1' : '0';
    host.dataset.free = inputVisible ? '1' : '0';
    // Chips: where the layout has room for them, and always inside the sheet; with the keyboard up in portrait
    // they give way to the field (§12.4).
    chipsEl.hidden = !(layout.showChips || sheet) || (layout.kb && layout.mode === 'portrait');
    form.hidden = !formOn;
    note.hidden = !formOn;
    toggle.setAttribute('aria-expanded', formOn ? 'true' : 'false');
    historyButton.setAttribute('aria-expanded', sheet ? 'true' : 'false');
    syncSend();
    follow();                                      // the log may just have become shorter
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
    follow();
  }

  // ---- the sheet -----------------------------------------------------------------------------------------------------------

  function pushHistory() {
    if (!view || !view.history || typeof view.history.pushState !== 'function') return;
    if (historyUnwinding) return;                  // closed and opened again at once: onPopState adds the entry
    try {
      const state = view.history.state;
      view.history.pushState({ ...(state && typeof state === 'object' ? state : {}), chatSheet: true }, '');
      historyPushed = true;
    } catch {
      historyPushed = false;                       // a sandboxed document: the back button simply does not close the sheet
    }
  }

  function popHistory() {
    if (!historyPushed || !view) return;
    historyPushed = false;
    try {
      const state = view.history.state;
      if (state && typeof state === 'object' && state.chatSheet) {
        historyUnwinding = true;
        view.history.back();                       // asynchronous: answered by one popstate
      }
    } catch {
      historyUnwinding = false;
    }
  }

  /** @param {PopStateEvent} event */
  function onPopState(event) {
    if (historyUnwinding) {                        // our own history.back(), not the back button
      historyUnwinding = false;
      if (sheet) pushHistory();
      return;
    }
    const state = event.state;
    if (!sheet || (state && typeof state === 'object' && state.chatSheet)) return;
    historyPushed = false;                         // the back button has already removed the entry
    setSheet(false);
  }

  /** @param {boolean} open @param {{focusInput?:boolean}} [opts] */
  function setSheet(open, opts) {
    const want = !!open;
    const focusInput = !!(opts && opts.focusInput) && want && inputVisible;
    const focused = doc.activeElement;
    const hadFocus = !!focused && host.contains(focused);
    const changed = want !== sheet;
    sheet = want;
    if (focusInput) inputOpen = true;
    if (!sheet) inputOpen = false;
    sync();
    if (changed) {
      if (sheet) pushHistory();
      else popHistory();
      emit('chat:sheet', { open: sheet });         // the stage places the sheet (#app[data-sheet]) in its handler
      if (sheet) {
        stick = true;
        follow();
      }
    }
    if (focusInput) {
      autosize();
      input.focus({ preventScroll: true });
    } else if (changed && hadFocus) {
      // Keyboard users keep their place: 回看 hands the focus to the title bar and gets it back from there.
      if (sheet) head.focus({ preventScroll: true });
      else if (focused === head && layout.mode !== 'compact') historyButton.focus({ preventScroll: true });
      else if (doc.activeElement instanceof HTMLElement && host.contains(doc.activeElement)) doc.activeElement.blur();
    }
  }

  // ---- lines ---------------------------------------------------------------------------------------------------------------

  /** @param {Entry} entry @param {string} state @param {string|null} source */
  function markBubble(entry, state, source) {
    if (entry.target !== 'bubble' || !entry.outEl) return;
    const box = entry.outEl.closest('.bubble');
    if (!box) return;
    box.setAttribute('data-state', state);
    if (source) box.setAttribute('data-source', source);
    else box.removeAttribute('data-source');
  }

  /** @param {string} text */
  function questionElement(text) {
    const element = make('span');
    element.textContent = text;
    return element;
  }

  function dropCaptionStream() {
    if (!captionStream) return;
    captionStream.reset();
    captionStream.dispose();
    captionStream = null;
  }

  /** Draws the kept caption into the bubble's caption line (links included, no typewriter). */
  function renderCaption() {
    dropCaptionStream();
    if (!captionSegments || !captionSegments.length) return;
    captionStream = createStreamText(bubble.captionEl(), { reducedMotion: true });
    for (const seg of captionSegments) captionStream.push(seg);
    captionStream.end('done');
  }

  /** @param {Node} node @param {boolean} isMessage */
  function appendToLog(node, isMessage) {
    log.appendChild(node);
    if (isMessage) {
      messageCount += 1;
      while (messageCount > MAX_MESSAGES && log.firstChild) {
        const first = log.firstChild;
        const entry = byElement.get(first);
        if (entry) {
          if (entry.state === 'streaming') finalize(entry, { reason: 'aborted', source: 'none' });
          if (!entry.gone) removeFromLog(entry);
        } else {
          if (first instanceof Element && first.classList.contains('msg')) messageCount -= 1;
          log.removeChild(first);
        }
      }
    }
    follow();
  }

  /** @param {Entry} entry */
  function removeFromLog(entry) {
    if (entry.gone) return;
    entry.gone = true;
    if (entry.el.parentNode === log) {
      log.removeChild(entry.el);
      messageCount -= 1;
    }
    byElement.delete(entry.el);
    entry.log.dispose();
    if (entries.get(entry.id) === entry && entry !== current) entries.delete(entry.id);
  }

  /**
   * @param {string} id
   * @param {string} kind
   * @param {string|null} cue
   * @param {'bubble'|HTMLElement} target
   * @returns {Entry}
   */
  function createEntry(id, kind, cue, target) {
    const el = make('div', 'msg');
    el.dataset.id = id;
    el.dataset.role = 'buddy';
    el.dataset.kind = kind;
    el.dataset.state = 'streaming';
    el.setAttribute('aria-busy', 'true');          // read once, when the line is complete (§10.6)
    if (cue) {
      const tag = make('span', 'msg__cue');
      tag.dataset.tone = toneOf(cue);
      tag.textContent = cue;
      el.appendChild(tag);
    }
    const textEl = make('div', 'msg__text');
    el.appendChild(textEl);
    /** @type {Entry} */
    const entry = {
      id, kind, cue, target, el, textEl,
      log: createStreamText(textEl, { reducedMotion: reduced, onTick: (n) => onLogTick(entry, n) }),
      out: null, outEl: null, state: 'streaming', open: false, ending: null, pushed: 0, shown: 0, segments: [],
      timer: 0, tool: [], gone: false, question: null,
    };
    byElement.set(el, entry);
    appendToLog(el, true);
    return entry;
  }

  /** The leading stream (the bubble's or the target's copy; the log's when there is no other) has shown `n` characters. */
  /** @param {Entry} entry @param {number} n */
  function onLeadTick(entry, n) {
    entry.shown = n;
    tick();
    if (entry.ending && n >= entry.pushed) finalize(entry, entry.ending);
  }

  /** @param {Entry} entry @param {number} n */
  function onLogTick(entry, n) {
    follow();
    if (!entry.out) onLeadTick(entry, n);
  }

  /**
   * Detaches the line the bubble is showing; a line that is still running is closed first. With `keepWaiting`, a
   * reply that has not said anything yet stays open instead: it goes on in the log and takes the bubble back when
   * its text arrives (see showAgain).
   * @param {boolean} [keepWaiting]
   */
  function releaseBubble(keepWaiting) {
    const previous = current;
    if (!previous) return;
    current = null;                                // from here on nothing of `previous` touches the bubble
    const waiting = !!keepWaiting && previous.open && previous.pushed === 0;
    if (previous.state === 'streaming' && !waiting) finalize(previous, previous.ending ?? { reason: 'aborted', source: 'none' });
    if (previous.out) {
      const container = previous.outEl;
      previous.tool = previous.tool.filter((element) => {      // the bubble's copy of the tool indicator goes with it
        if (!container || !container.contains(element)) return true;
        element.remove();
        return false;
      });
      previous.out.reset();
      previous.out.dispose();
      previous.out = null;
      previous.outEl = null;
    }
    if (previous.gone && entries.get(previous.id) === previous) entries.delete(previous.id);
  }

  /**
   * One reply at a time (the coach client aborts the one in flight when it sends the next and calls no handler): a
   * new reply, or a new caption, ends every other reply the bubble was still waiting for.
   * @param {Entry|null} keep
   */
  function closeOpenReplies(keep) {
    for (const other of [...entries.values()]) {
      if (other !== keep && other.open && other.target === 'bubble') finalize(other, { reason: 'aborted', source: 'none' });
    }
  }

  /**
   * Connects a line to its target. A local line (`keepWaiting`) may arrive right after a reply has begun, before the
   * reply has said a word (SPEC §5.8, a rival move: the reply is opened, then 悔一步重想 is offered): the reply is
   * not dropped then, it waits.
   * @param {Entry} entry
   * @param {boolean} [keepWaiting]
   */
  function attach(entry, keepWaiting) {
    const kind = entry.kind;
    if (entry.target === 'bubble') {
      releaseBubble(keepWaiting);
      const container = bubble.begin({ id: entry.id, cue: entry.cue });
      bubble.setTag(entry.cue, toneOf(entry.cue));
      // The child's question stays above its answer; the caption of the rival's move stays with the line about it.
      if (kind === 'ask' && entry.question === null) entry.question = question;
      question = entry.question;
      bubble.setQuestion(question !== null ? questionElement(question) : null);
      if ((kind === 'opp' || kind === 'system') && captionSegments) renderCaption();
      else {
        dropCaptionStream();
        captionSegments = null;
      }
      entry.outEl = container;
      entry.out = createStreamText(container, { reducedMotion: reduced, onTick: (n) => onLeadTick(entry, n) });
      current = entry;
      markBubble(entry, 'streaming', null);
      return;
    }
    const container = entry.target;
    for (const other of entries.values()) {         // one line per element: the newer one replaces the older
      if (other === entry || other.outEl !== container || !other.out) continue;
      if (other.state === 'streaming') finalize(other, other.ending ?? { reason: 'aborted', source: 'none' });
      if (other.out) {
        other.out.reset();
        other.out.dispose();
      }
      other.out = null;
      other.outEl = null;
    }
    entry.outEl = container;
    entry.out = createStreamText(container, { reducedMotion: reduced, onTick: (n) => onLeadTick(entry, n) });
  }

  /** A reply that a local line pushed out of the bubble before it had spoken takes the bubble back. @param {Entry} entry */
  function showAgain(entry) {
    if (entry.target === 'bubble' && entry !== current && !entry.out) attach(entry);
  }

  /** @param {Entry} entry */
  function clearTool(entry) {
    for (const element of entry.tool) element.remove();
    entry.tool = [];
  }

  /**
   * Shows the tool indicator at the end of both copies of the line. Text that was still queued is shown first, so
   * the indicator never ends up in the middle of a sentence.
   * @param {Entry} entry
   * @param {string} label
   */
  function showTool(entry, label) {
    clearTool(entry);
    if (entry.out) entry.out.end('done');
    entry.log.end('done');
    for (const container of [entry.outEl, entry.textEl]) {
      if (!container) continue;
      const element = make('span', 'chat-tool');
      element.textContent = label;
      container.appendChild(element);
      entry.tool.push(element);
    }
  }

  /** @param {Entry} entry */
  function showTyping(entry) {
    entry.timer = 0;
    if (!entry.open || entry.pushed > 0 || entry.tool.length) return;
    entry.el.dataset.typing = '1';
    if (entry === current) bubble.setTyping(true);
    follow();
  }

  /** @param {Entry} entry */
  function hideTyping(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = 0;
    delete entry.el.dataset.typing;
    if (entry === current) bubble.setTyping(false);
  }

  /** @param {Entry} entry @param {Segment} seg */
  function pushSegment(entry, seg) {
    const size = sizeOf(seg);
    if (!size) return;
    if (entry.pushed === 0) hideTyping(entry);
    entry.segments.push(seg);
    entry.pushed += size;
    if (entry.out) entry.out.push(seg);
    entry.log.push(seg);
  }

  /** @param {Entry} entry @param {string} label */
  function markStale(entry, label) {
    if (entry.state === 'stale' || entry.gone) return;
    entry.state = 'stale';
    entry.el.dataset.state = 'stale';
    const tag = make('span', 'msg__tag');
    tag.textContent = label;
    entry.el.appendChild(tag);
    if (entry === current) {
      bubble.markStale(label);
      const box = entry.outEl ? entry.outEl.closest('.bubble') : null;
      if (box) box.setAttribute('data-state', 'stale');
    }
    follow();
  }

  /** Stops waiting for more text. @param {Entry} entry */
  function close(entry) {
    if (entry.open) {
      entry.open = false;
      openCount -= 1;
    }
    hideTyping(entry);
    clearTool(entry);
  }

  /** Ends the line for good: flushes or drops what is queued and settles its state. @param {Entry} entry @param {EndInfo} info */
  function finalize(entry, info) {
    if (entry.state !== 'streaming') return;
    close(entry);
    entry.ending = null;
    const aborted = info.reason === 'aborted';
    entry.log.end(info.reason);
    if (entry.out) entry.out.end(info.reason);
    const source = info.source === 'none' ? null : info.source;
    const empty = (entry.out ?? entry.log).text() === '';
    entry.state = 'done';
    entry.el.dataset.state = 'done';
    entry.el.removeAttribute('aria-busy');
    if (source) entry.el.dataset.source = source;

    if (empty && (aborted || !entry.cue)) {
      // Nothing was said: the line leaves no trace (§7.7). A caption that shares the bubble stays.
      removeFromLog(entry);
      if (entry.out && entry.target !== 'bubble') {
        entry.out.reset();
        entry.out.dispose();
        entry.out = null;
        entry.outEl = null;
      }
      if (entry === current) {
        if (captionSegments) {
          bubble.setTag(null, 'neutral');
          markBubble(entry, 'done', null);
        } else {
          current = null;
          if (entry.out) entry.out.dispose();
          entry.out = null;
          entry.outEl = null;
          entries.delete(entry.id);
          bubble.clear();
        }
      }
    } else {
      markBubble(entry, 'done', source);
      if (info.stale) markStale(entry, info.stale);
    }
    if (aborted) speech.cancel();
    syncSend();
    follow();
  }

  /** end() of a line: an abort settles at once, a finished line lets the typewriter catch up first. */
  /** @param {Entry} entry @param {EndInfo} info */
  function finish(entry, info) {
    if (entry.state !== 'streaming') {
      if (info.stale) markStale(entry, info.stale);
      return;
    }
    if (entry.ending && info.reason !== 'aborted' && !info.stale) return;      // it has ended already and is typing out
    close(entry);
    if (info.reason === 'aborted') {
      finalize(entry, info);
      return;
    }
    if (info.reason === 'cut') {
      const kept = wholeSentences(entry.segments);
      if (kept !== entry.segments) {
        entry.log.reset();
        if (entry.out) entry.out.reset();
        entry.segments = [];
        entry.pushed = 0;
        entry.shown = 0;
        for (const seg of kept) pushSegment(entry, seg);
      }
    }
    if (info.source !== 'none') {
      entry.el.dataset.source = info.source;
      if (entry === current && entry.outEl) {
        const box = entry.outEl.closest('.bubble');
        if (box) box.setAttribute('data-source', info.source);
      }
    }
    const typing = info.reason === 'done' && !info.stale && !reduced && !doc.hidden && entry.shown < entry.pushed;
    if (typing) {
      entry.ending = info;
      syncSend();
      return;
    }
    finalize(entry, info);
  }

  // ---- ChatPanel -------------------------------------------------------------------------------------------------------------

  /** @param {{id:string, kind:CoachKind, cue?:string|null, target?:'bubble'|HTMLElement}} msg */
  function begin(msg) {
    const previous = entries.get(msg.id);
    if (previous) {                                  // the same id again: the earlier line is closed and forgotten
      if (previous.state === 'streaming') finalize(previous, previous.ending ?? { reason: 'aborted', source: 'none' });
      if (entries.get(msg.id) === previous) entries.delete(msg.id);
    }
    const entry = createEntry(msg.id, msg.kind, msg.cue ?? null, msg.target ?? 'bubble');
    entries.set(entry.id, entry);
    entry.open = true;
    openCount += 1;
    if (entry.target === 'bubble') closeOpenReplies(entry);
    attach(entry);
    entry.timer = Number(setTimeout(() => showTyping(entry), TYPING_DELAY_MS));
    syncSend();
  }

  /** @param {string} id @param {Segment} seg */
  function segment(id, seg) {
    const entry = entries.get(id);
    if (!entry || !entry.open || entry.state !== 'streaming' || !sizeOf(seg)) return;
    showAgain(entry);
    pushSegment(entry, seg);
  }

  /** @param {string} id */
  function reset(id) {
    const entry = entries.get(id);
    if (!entry || !entry.open || entry.state !== 'streaming') return;
    entry.log.reset();
    if (entry.out) entry.out.reset();
    entry.segments = [];
    entry.pushed = 0;
    entry.shown = 0;
    clearTool(entry);
    speech.cancel();
    if (entry.timer) clearTimeout(entry.timer);
    showTyping(entry);                               // the replacement is on its way: dots at once
  }

  /** @param {string} id @param {EndInfo} info */
  function end(id, info) {
    const entry = entries.get(id);
    if (entry) finish(entry, info);
  }

  /** @param {string} id @param {{phase:'start'|'end', notation?:string}} t */
  function tool(id, t) {
    const entry = entries.get(id);
    if (!entry || !entry.open || entry.state !== 'streaming') return;
    if (t.phase === 'start') {
      showAgain(entry);
      hideTyping(entry);
      showTool(entry, toolLine(t.notation));
    } else {
      clearTool(entry);
      if (entry.pushed === 0) showTyping(entry);
    }
    follow();
  }

  /** @param {Segment[]} segments @param {{kind?:CoachKind, cue?:string|null, target?:'bubble'|HTMLElement}} [opts] @returns {string} */
  function local(segments, opts) {
    localSeq += 1;
    const id = `local-${localSeq}`;
    const cue = (opts && opts.cue) ?? null;
    const list = segments.filter((seg) => sizeOf(seg) > 0);
    if (!list.length && !cue) return id;
    const kind = (opts && opts.kind) || 'system';
    const entry = createEntry(id, kind, cue, (opts && opts.target) || 'bubble');
    entries.set(id, entry);
    attach(entry, true);
    for (const seg of list) pushSegment(entry, seg);
    finish(entry, { reason: 'done', source: 'local' });
    return id;
  }

  /** @param {Segment[]} segments */
  function caption(segments) {
    closeOpenReplies(null);
    releaseBubble();
    bubble.clear();
    question = null;
    const list = segments.filter((seg) => sizeOf(seg) > 0);
    captionSegments = list.length ? list : null;
    renderCaption();
    if (!list.length) return;
    localSeq += 1;
    const entry = createEntry(`caption-${localSeq}`, 'caption', null, 'bubble');   // in the log: one quiet line
    entry.el.dataset.source = 'local';
    for (const seg of list) entry.log.push(seg);
    entry.log.end('done');
    entry.state = 'done';
    entry.el.dataset.state = 'done';
    entry.el.removeAttribute('aria-busy');
    follow();
  }

  /** @param {string} text */
  function addChild(text) {
    const el = make('div', 'msg');
    el.dataset.role = 'me';
    const textEl = make('div', 'msg__text');
    textEl.textContent = text;
    el.appendChild(textEl);
    stick = true;                                    // the child just spoke: show it
    appendToLog(el, true);
    question = text;
    bubble.setQuestion(questionElement(text));
  }

  /** @param {string} text */
  function addEvent(text) {
    const el = make('p', 'chat__event');
    el.textContent = text;
    appendToLog(el, false);
  }

  /** @param {'aborted'} reason */
  function endAll(reason) {
    for (const entry of [...entries.values()]) {
      if (entry.state !== 'streaming') continue;
      // A line that had already ended is complete: it is shown in full. A line still coming in is cut off.
      finalize(entry, entry.ending ?? { reason, source: 'none' });
    }
  }

  /** @param {ChipSpec[]} chips */
  function setChips(chips) {
    const before = chipIds;
    chipIds = new Set();
    chipSpecs.clear();
    chipsEl.textContent = '';
    chips.forEach((spec, index) => {
      const button = make('button', 'chip');
      button.type = 'button';
      if (spec.ask) button.dataset.ask = spec.ask;
      if (spec.action) button.dataset.action = spec.action;
      if (spec.primary) button.classList.add('chip--primary');
      if (!before.has(spec.id)) {                    // only a chip that was not there before pops in
        button.classList.add('is-new');
        button.style.setProperty('--i', String(index));
      }
      const label = make('span', 'chip__label');
      label.textContent = spec.label;
      button.appendChild(label);
      chipsEl.appendChild(button);
      chipSpecs.set(button, spec);
      chipIds.add(spec.id);
    });
    host.dataset.chips = String(chips.length);
    follow();
  }

  /** @param {{visible:boolean, enabled:boolean}} s */
  function setInput(s) {
    inputVisible = !!s.visible;
    inputEnabled = !!s.enabled;
    if (inputVisible) {
      if (toggle.parentNode !== tools) tools.insertBefore(toggle, tools.firstChild);
      if (form.parentNode !== host) host.append(form, note);
    } else {                                         // no proxy or free text off: the field is simply absent (D-40)
      inputOpen = false;
      toggle.remove();
      form.remove();
      note.remove();
    }
    sync();
  }

  /** @param {{mode:LayoutMode, showChips:boolean, chipRows:number, kb:boolean}} l */
  function setLayout(l) {
    layout = { mode: l.mode, showChips: !!l.showChips, chipRows: l.chipRows, kb: !!l.kb };
    sync();
    follow();
  }

  function clear() {
    for (const entry of [...byElement.values()]) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.log.dispose();
      if (entry.out) {
        if (entry.target !== 'bubble') entry.out.reset();
        entry.out.dispose();
      }
    }
    if (current && current.out) current.out.dispose();
    entries.clear();
    byElement.clear();
    current = null;
    openCount = 0;
    messageCount = 0;
    log.textContent = '';
    dropCaptionStream();
    captionSegments = null;
    question = null;
    stick = true;
    bubble.clear();
    syncSend();
  }

  // ---- input from the child --------------------------------------------------------------------------------------------------

  function submit() {
    const text = input.value.trim();
    if (!text || !inputEnabled) return;
    emit('chat:ask', { text });
    input.value = '';
    autosize();
    syncSend();
    input.focus({ preventScroll: true });
  }

  head.addEventListener('click', () => setSheet(false));
  historyButton.addEventListener('click', () => setSheet(!sheet));
  toggle.addEventListener('click', () => setSheet(true, { focusInput: true }));

  chipsEl.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.chip') : null;
    const spec = button ? chipSpecs.get(button) : undefined;
    if (!(button instanceof HTMLButtonElement) || !spec || button.disabled) return;
    if (spec.action) {
      emit('chat:chip', { chip: spec });
      if (spec.action === 'write') {                 // opens the field; it can be tapped again later
        setSheet(true, { focusInput: true });
        return;
      }
    } else if (spec.ask) {
      emit('chat:ask', { code: spec.ask });
    } else {
      return;
    }
    button.classList.add('is-used');                 // until the next setChips
    button.disabled = true;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (openCount > 0) {                             // the button is ■ right now
      emit('chat:stop', {});
      endAll('aborted');
    } else {
      submit();
    }
  });

  input.addEventListener('keydown', (event) => {
    // Enter sends; Shift+Enter is a new line; an Enter that confirms an input-method composition is left alone.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  });

  input.addEventListener('input', () => {
    autosize();
    syncSend();
  });

  log.addEventListener('scroll', () => {
    stick = log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_PX;
  }, { passive: true });

  if (view) view.addEventListener('popstate', onPopState);
  speech.onSpeaking((on) => { speaking = on; });

  setChips([]);
  sync();

  return {
    begin, segment, reset, end, tool, local, caption, addChild, addEvent, endAll, setChips, setInput, setSheet, setLayout,
    setTypeTicks: (on) => { typeTicks = !!on; },
    clear,
    setReducedMotion: (on) => { reduced = !!on; },
  };
}
