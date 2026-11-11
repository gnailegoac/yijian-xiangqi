// Renders Segments with typewriter pacing; it does not parse brackets (SPEC §4.28.5). Package X6.
//
// Output nodes inside `el`: Text, <br> (for "\n", at most two in a row) and button.move-link only.
//   <button class="move-link" data-move="7434" data-color="red">炮五进四</button>
// When two or more consecutive links of one message belong to one line, one more button follows the last of
// them: <button class="move-link move-link--play">▶ 演示</button> (no data-move: it plays the whole line).
//
// The container gets the class `stream-text`, and `is-streaming` from the first push until end() / reset():
// styles/chat.css draws the caret (a 7 x 15 px block after the last character) from those two classes.
//
// Events (bubbling CustomEvents from the buttons it renders):
//   chat:movelink {link, active}   active:true when a link is tapped; active:false only when the active link
//                                  itself is tapped again. Another link becoming active, or any board pick
//                                  (`board:pick` reaching the document), takes `.is-active` away silently.
//   chat:playline {links}          the ▶ 演示 button of a line
// Every button has a 44 px-high tap area (chat.css). Where the tap areas of neighbouring lines overlap, a tap on
// the word of a link always goes to that link (see `meant` below).

/** @import { MoveLink, Segment } from '../coach/types.js' */
/** @import { StreamText } from './types.js' */

const DEFAULT_CPS = 40;          // characters per second while the backlog is short
const BACKLOG_FACTOR = 4;        // rate = max(cps, 4 * backlog) characters per second
const FIRST_FRAME_S = 1 / 60;    // time credited to the first frame after the drain was idle
const MAX_BREAKS = 2;            // line breaks in a row that are rendered
const POP_MS = 80;               // a move link pops in: scale .9 -> 1
const PLAY_LABEL = '▶ 演示';

/** @typedef {{type:'text', chars:string[], at:number} | {type:'move', notation:string, link:MoveLink, size:number}} QueueItem */

/**
 * `b` is the move that directly follows `a` inside one line: its `pre` is one longer and continues with `a`.
 * @param {MoveLink} a
 * @param {MoveLink} b
 * @returns {boolean}
 */
function follows(a, b) {
  if (b.pre.length !== a.pre.length + 1) return false;
  const step = b.pre[a.pre.length];
  return step.from.row === a.from.row && step.from.col === a.from.col && step.to.row === a.to.row && step.to.col === a.to.col;
}

/** @param {HTMLElement} el
 *  @param {{ cps?:number, reducedMotion?:boolean, onTick?:(charsShown:number) => void }} opts @returns {StreamText} */
export function createStreamText(el, opts) {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const cps = opts && typeof opts.cps === 'number' && opts.cps > 0 ? opts.cps : DEFAULT_CPS;
  const reduced = !!(opts && opts.reducedMotion);
  const onTick = opts && typeof opts.onTick === 'function' ? opts.onTick : null;

  /** @type {QueueItem[]} */
  let queue = [];
  let backlog = 0;                 // characters waiting in the queue (a move counts as its notation)
  let shown = 0;                   // characters taken from the queue since creation or the last reset()
  let credit = 0;                  // fraction of a character carried to the next frame; negative after a move
  let frame = 0;                   // pending animation frame handle, 0 = none
  /** @type {number|null} */
  let lastT = null;                // timestamp of the previous frame of this drain
  let plain = '';                  // what is on screen, as text
  /** @type {Node[]} */
  let nodes = [];                  // every node this controller added to `el`
  /** @type {Text|null} */
  let tail = null;                 // the text node new characters are appended to
  let breaks = 0;                  // line breaks rendered in a row at the end of the output
  /** @type {{link:MoveLink, button:HTMLElement}[]} */
  let run = [];                    // the links at the end of the output that follow each other inside one line
  let watching = false;            // the document listener for board picks is installed
  let disposed = false;

  /** @type {Map<EventTarget, MoveLink>} */
  const links = new Map();
  /** @type {Map<EventTarget, MoveLink[]>} */
  const plays = new Map();

  el.classList.add('stream-text');
  if (reduced) el.classList.add('is-reduced');

  /** @param {FrameRequestCallback} callback @returns {number} */
  function requestFrame(callback) {
    if (view && typeof view.requestAnimationFrame === 'function') return view.requestAnimationFrame(callback);
    return Number(setTimeout(() => callback(Date.now()), 16));
  }

  /** @param {number} handle */
  function cancelFrame(handle) {
    if (view && typeof view.cancelAnimationFrame === 'function') view.cancelAnimationFrame(handle);
    else clearTimeout(handle);
  }

  function stopDrain() {
    if (frame) cancelFrame(frame);
    frame = 0;
    lastT = null;
    credit = 0;
  }

  /** @param {Node} node @param {Node|null} [before] */
  function add(node, before) {
    if (before && before.parentNode === el) el.insertBefore(node, before);
    else el.appendChild(node);
    nodes.push(node);
  }

  /** @param {string} text */
  function appendText(text) {
    if (!text) return;
    if (!tail) {
      tail = doc.createTextNode('');
      add(tail);
    }
    tail.data += text;
    plain += text;
  }

  /** @param {string[]} chars @param {number} from @param {number} to */
  function showText(chars, from, to) {
    let buffer = '';
    for (let i = from; i < to; i++) {
      const ch = chars[i];
      if (ch !== '\n') {
        buffer += ch;
        breaks = 0;
        continue;
      }
      appendText(buffer);
      buffer = '';
      if (breaks >= MAX_BREAKS) continue;          // a third line break in a row is dropped
      add(doc.createElement('br'));
      tail = null;
      breaks += 1;
      plain += '\n';
    }
    appendText(buffer);
  }

  /** Appends the ▶ 演示 button after the last link of a finished run of two or more. */
  function closeRun() {
    if (run.length >= 2) {
      const last = run[run.length - 1].button;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'move-link move-link--play';
      button.textContent = PLAY_LABEL;
      add(button, last.nextSibling);               // text that came after the last link stays behind the button
      plays.set(button, run.map((entry) => entry.link));
    }
    run = [];
  }

  /** @param {{notation:string, link:MoveLink}} item */
  function showMove(item) {
    const { link } = item;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'move-link';
    button.dataset.move = link.code;
    button.dataset.color = link.color;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = item.notation;
    if (run.length && !follows(run[run.length - 1].link, link)) closeRun();
    add(button);
    tail = null;
    breaks = 0;
    plain += item.notation;
    links.set(button, link);
    run.push({ link, button });
    if (!reduced && typeof button.animate === 'function') {
      button.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: POP_MS, easing: 'ease-out' });
    }
  }

  /**
   * Shows up to `budget` characters from the head of the queue. A move is shown whole and may overdraw the budget.
   * @param {number} budget
   * @returns {number} characters taken from the queue
   */
  function reveal(budget) {
    let used = 0;
    while (queue.length && used < budget) {
      const item = queue[0];
      if (item.type === 'move') {
        queue.shift();
        showMove(item);
        used += item.size;
      } else {
        const take = Math.min(budget - used, item.chars.length - item.at);
        showText(item.chars, item.at, item.at + take);
        item.at += take;
        used += take;
        if (item.at >= item.chars.length) queue.shift();
      }
    }
    if (used > 0) {
      backlog = Math.max(0, backlog - used);
      shown += used;
      if (onTick) onTick(shown);
    }
    return used;
  }

  /** @param {number} t */
  function step(t) {
    frame = 0;
    const dt = lastT === null ? FIRST_FRAME_S : Math.max(0, (t - lastT) / 1000);
    lastT = t;
    credit += Math.max(cps, BACKLOG_FACTOR * backlog) * dt;
    const whole = Math.floor(credit);
    if (whole >= 1) credit -= reveal(whole);
    if (disposed) return;
    if (queue.length) {
      if (!frame) frame = requestFrame(step);
    } else {
      lastT = null;
      credit = 0;
    }
  }

  /** @param {Element} button @param {boolean} on */
  function setActive(button, on) {
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function onBoardPick() {
    for (const button of links.keys()) {
      const element = /** @type {Element} */ (button);
      if (element.classList.contains('is-active')) setActive(element, false);
    }
  }

  /** @param {EventTarget} target @param {string} type @param {object} detail */
  function fire(target, type, detail) {
    const Ctor = (view && view.CustomEvent) || globalThis.CustomEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true, detail }));
  }

  /**
   * The button a tap is meant for. Lines are closer than 44 px, so the tap area of a link reaches over the words of
   * the lines next to it, and browsers disagree on who gets such a tap (paint order, touch adjustment). The rule here:
   * a tap on the word of a link goes to that link; only a tap beside every word goes to the tap area it fell into.
   * Only links in front of the surface that was tapped count (they come first in elementsFromPoint): a link that
   * something covers, like the bubble's under the open 回看 sheet, is never meant.
   * @param {Event} event
   * @param {HTMLElement} hit   the button the browser chose
   * @returns {HTMLElement}
   */
  function meant(event, hit) {
    const { clientX: x, clientY: y, detail } = /** @type {MouseEvent} */ (event);
    if (!detail || typeof x !== 'number' || typeof y !== 'number') return hit;            // keyboard, or a scripted click
    if (typeof hit.getBoundingClientRect !== 'function' || typeof doc.elementsFromPoint !== 'function') return hit;
    /** @param {Element} element */
    const under = (element) => {
      const box = element.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    };
    if (under(hit)) return hit;
    for (const other of doc.elementsFromPoint(x, y)) {
      if (!other.classList.contains('move-link')) break;                                  // the surface: nothing behind it counts
      if (other !== hit && under(other)) return /** @type {HTMLElement} */ (other);
    }
    return hit;
  }

  /** @param {Event} event */
  function onClick(event) {
    /** @type {Node|null} */
    let node = /** @type {Node|null} */ (event.target);
    while (node && node !== el && !links.has(node) && !plays.has(node)) node = node.parentNode;
    if (!node || node === el) return;
    event.stopPropagation();                         // a tap on a link is never a tap on the bubble around it
    const button = meant(event, /** @type {HTMLElement} */ (node));
    if (!links.has(button) && !plays.has(button)) {  // the word under the finger belongs to another stream (the caption)
      button.click();
      return;
    }
    const line = plays.get(button);
    if (line) {
      fire(button, 'chat:playline', { links: line.slice() });
      return;
    }
    const link = links.get(button);
    if (!link) return;
    if (button.classList.contains('is-active')) {
      setActive(button, false);
      fire(button, 'chat:movelink', { link, active: false });
      return;
    }
    if (typeof doc.querySelectorAll === 'function') {
      for (const other of doc.querySelectorAll('.move-link.is-active')) setActive(other, false);
    }
    for (const other of links.keys()) {
      const element = /** @type {Element} */ (other);
      if (element.classList.contains('is-active')) setActive(element, false);
    }
    setActive(button, true);
    if (!watching) {
      watching = true;
      doc.addEventListener('board:pick', onBoardPick);
    }
    fire(button, 'chat:movelink', { link, active: true });
  }

  el.addEventListener('click', onClick);

  /** @param {Segment} seg */
  function push(seg) {
    if (disposed || !seg) return;
    if (seg.type === 'move') {
      const size = Array.from(seg.notation).length;
      queue.push({ type: 'move', notation: seg.notation, link: seg.link, size });
      backlog += size;
    } else if (seg.type === 'text' && seg.text) {
      const chars = Array.from(seg.text);
      queue.push({ type: 'text', chars, at: 0 });
      backlog += chars.length;
    } else {
      return;
    }
    el.classList.add('is-streaming');
    if (reduced) reveal(Infinity);
    else if (!frame) frame = requestFrame(step);
  }

  /** @param {'done'|'cut'|'aborted'} reason */
  function end(reason) {
    if (disposed) return;
    stopDrain();
    if (reason === 'aborted') {
      queue = [];
      backlog = 0;
      run = [];
    } else {
      reveal(Infinity);
      closeRun();
    }
    el.classList.remove('is-streaming');
  }

  function reset() {
    stopDrain();
    queue = [];
    backlog = 0;
    shown = 0;
    for (const node of nodes) {
      if (node.parentNode === el) el.removeChild(node);
    }
    nodes = [];
    tail = null;
    breaks = 0;
    plain = '';
    run = [];
    links.clear();
    plays.clear();
    el.classList.remove('is-streaming');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopDrain();
    queue = [];
    backlog = 0;
    el.removeEventListener('click', onClick);
    if (watching) doc.removeEventListener('board:pick', onBoardPick);
    watching = false;
    el.classList.remove('is-streaming');
  }

  return { push, end, reset, text: () => plain, dispose };
}
