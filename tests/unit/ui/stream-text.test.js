// stream-text.js against a minimal DOM stub (SPEC §14.5, behaviour of §4.28.5).
// The stub implements only what a renderer of Text / <br> / <button> nodes needs: a node tree, classList, dataset,
// attributes, bubbling listeners, and a window whose animation frames the test fires by hand.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStreamText } from '../../../src/ui/stream-text.js';

// ---- minimal DOM stub -------------------------------------------------------------------------------------------------

class FakeNode {
  /** @param {FakeDocument} doc */
  constructor(doc) {
    this.ownerDocument = doc;
    /** @type {FakeNode|null} */
    this.parentNode = null;
    /** @type {FakeNode[]} */
    this.childNodes = [];
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const at = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    assert.ok(at >= 0, 'insertBefore: the reference node is a child');
    this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    assert.ok(at >= 0, 'removeChild: the node is a child');
    this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  /** Bubbles from this node through its ancestors and, when the tree hangs under the body, to the document. */
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    /** @type {any} */
    let node = this;
    while (node) {
      for (const fn of node.listeners.get(event.type) ?? []) fn(event);
      if (!event.bubbles || event.stopped) break;
      node = node.parentNode ?? (node === this.ownerDocument.body ? this.ownerDocument : null);
    }
    return true;
  }
  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }
}

class FakeText extends FakeNode {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.nodeName = '#text'; this.data = data; }
  get textContent() { return this.data; }
}

class FakeElement extends FakeNode {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Record<string, string>} */
    this.attributes = {};
    this.type = '';
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, on) => { const next = on ?? !classes.has(name); if (next) classes.add(name); else classes.delete(name); return next; },
      get value() { return [...classes].join(' '); },
    };
    this.classes = classes;
  }
  get className() { return this.classList.value; }
  set className(value) { this.classes.clear(); for (const name of String(value).split(/\s+/).filter(Boolean)) this.classes.add(name); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get textContent() { return super.textContent; }
  set textContent(value) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    if (value !== '') this.appendChild(new FakeText(this.ownerDocument, String(value)));
  }
}

class FakeEvent {
  constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; this.detail = init.detail; this.target = null; this.stopped = false; }
  stopPropagation() { this.stopped = true; }
}

class FakeWindow {
  constructor() {
    /** @type {Map<number, Function>} */
    this.frames = new Map();
    this.nextHandle = 1;
    this.CustomEvent = FakeEvent;
  }
  requestAnimationFrame(callback) { const handle = this.nextHandle++; this.frames.set(handle, callback); return handle; }
  cancelAnimationFrame(handle) { this.frames.delete(handle); }
  /** Runs the animation frame callbacks that are pending right now, with timestamp `t` (ms). */
  frame(t) {
    const due = [...this.frames.values()];
    this.frames.clear();
    for (const callback of due) callback(t);
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(/** @type {any} */ (null));
    this.ownerDocument = this;
    this.defaultView = new FakeWindow();
    this.body = new FakeElement(this, 'body');
  }
  createElement(tag) { return new FakeElement(this, tag); }
  createTextNode(data) { return new FakeText(this, data); }
  /** Supports the one selector shape the renderer uses: classes only, e.g. ".move-link.is-active". */
  querySelectorAll(selector) {
    const wanted = selector.split('.').filter(Boolean);
    /** @type {FakeElement[]} */
    const found = [];
    const visit = (node) => {
      if (node.nodeType === 1 && wanted.every((name) => node.classList.contains(name))) found.push(node);
      node.childNodes.forEach(visit);
    };
    visit(this.body);
    return found;
  }
  /**
   * What lies under a point, topmost first, the way a browser reports it for links styled by chat.css: the links
   * whose word holds the point (a word lies above every tap area), then the links whose 44 px-high tap area holds
   * it (the later one on top), then the element those links sit in and its ancestors. Only links that were given a
   * box take part.
   */
  elementsFromPoint(x, y) {
    /** @type {FakeElement[]} */
    const words = [];
    /** @type {FakeElement[]} */
    const areas = [];
    const visit = (node) => {
      if (node.nodeType === 1 && node.classList.contains('move-link') && typeof node.getBoundingClientRect === 'function') {
        const box = node.getBoundingClientRect();
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) words.push(node);
        else if (x >= box.left - 3 && x <= box.right + 3 && Math.abs(y - (box.top + box.bottom) / 2) <= 22) areas.unshift(node);
      }
      node.childNodes.forEach(visit);
    };
    visit(this.body);
    const links = [...words, ...areas];
    /** @type {FakeNode[]} */
    const below = [];
    for (let node = links[0]?.parentNode ?? this.body; node && node !== this; node = node.parentNode) below.push(node);
    return [...links, ...below];
  }
}

/** A container that hangs in the document, so events from it reach document listeners. */
function mount() {
  const doc = new FakeDocument();
  const el = doc.createElement('span');
  doc.body.appendChild(el);
  return { doc, win: doc.defaultView, el: /** @type {any} */ (el) };
}

const text = (value) => /** @type {const} */ ({ type: 'text', text: value });

/** A move segment. `code` is the four digits from-row, from-col, to-row, to-col (SPEC §3.1). */
function move(notation, code, color, extra = {}) {
  const [fr, fc, tr, tc] = [...code].map(Number);
  return /** @type {const} */ ({
    type: 'move', notation,
    link: { from: { row: fr, col: fc }, to: { row: tr, col: tc }, color, code, pre: [], playable: false, src: 'reply', ...extra },
  });
}

/** The children of the container as short descriptions: "#text:…", "BR", "BUTTON.move-link:…". */
function outline(el) {
  return el.childNodes.map((node) => {
    if (node.nodeType === 3) return `#text:${node.data}`;
    if (node.tagName === 'BUTTON') return `BUTTON.${node.className.split(' ').join('.')}:${node.textContent}`;
    return node.tagName;
  });
}

const click = (target) => { const event = new FakeEvent('click', { bubbles: true }); target.dispatchEvent(event); return event; };

// ---- the four tests named in §14.5 ------------------------------------------------------------------------------------------

test('segments render as text nodes and move-link buttons only', () => {
  const segments = [text('对方会走'), move('马7进5', '2634', 'black'), text('把炮吃掉，\n咱们'), text('亏了。')];
  const expected = ['#text:对方会走', 'BUTTON.move-link:马7进5', '#text:把炮吃掉，', 'BR', '#text:咱们亏了。'];

  // shown at once (reduced motion)
  const a = mount();
  const instant = createStreamText(a.el, { reducedMotion: true });
  for (const seg of segments) instant.push(seg);
  instant.end('done');
  assert.deepEqual(outline(a.el), expected);
  assert.equal(instant.text(), '对方会走马7进5把炮吃掉，\n咱们亏了。');

  // typed out frame by frame: the same nodes, and characters of one run of text share one Text node
  const b = mount();
  const typed = createStreamText(b.el, {});
  for (const seg of segments) typed.push(seg);
  for (let t = 0; b.win.frames.size > 0 && t < 5000; t += 16) b.win.frame(t);
  typed.end('done');
  assert.deepEqual(outline(b.el), expected);
  assert.equal(typed.text(), instant.text());

  for (const { el } of [a, b]) {
    for (const node of el.childNodes) {
      const isText = node.nodeType === 3;
      const isBreak = node.nodeType === 1 && node.tagName === 'BR';
      const isLink = node.nodeType === 1 && node.tagName === 'BUTTON' && node.classList.contains('move-link');
      assert.ok(isText || isBreak || isLink, `unexpected node ${node.nodeName}`);
    }
  }
});

test("end('aborted') drops the backlog; end('done') flushes it", () => {
  const line = '一二三四五六七八九十';                    // 10 characters: rate = max(40, 4 * 10) = 40 characters per second

  const a = mount();
  const aborted = createStreamText(a.el, {});
  aborted.push(text(line));
  aborted.push(move('炮五进四', '7434', 'red'));
  assert.equal(aborted.text(), '', 'nothing is shown before the first frame');
  a.win.frame(1000);                                     // first frame: 14 backlog -> 56 /s x 1/60 s = 0.93 -> nothing yet
  a.win.frame(1100);                                     // + 56 /s x 0.1 s = 6.53 -> 6 characters
  assert.equal(aborted.text(), '一二三四五六');
  aborted.end('aborted');
  assert.equal(aborted.text(), '一二三四五六', 'what was shown stays');
  assert.equal(a.win.frames.size, 0, 'the drain has stopped');
  a.win.frame(5000);
  assert.equal(aborted.text(), '一二三四五六', 'the backlog never appears');
  assert.deepEqual(outline(a.el), ['#text:一二三四五六'], 'the queued move link was dropped too');
  assert.equal(a.el.classList.contains('is-streaming'), false, 'the caret is removed');

  const b = mount();
  const done = createStreamText(b.el, {});
  done.push(text(line));
  done.push(move('炮五进四', '7434', 'red'));
  b.win.frame(1000);
  b.win.frame(1100);
  assert.equal(done.text(), '一二三四五六');
  done.end('done');
  assert.equal(done.text(), `${line}炮五进四`, 'the whole queue is shown at once');
  assert.deepEqual(outline(b.el), [`#text:${line}`, 'BUTTON.move-link:炮五进四']);
  assert.equal(b.win.frames.size, 0);
  assert.equal(b.el.classList.contains('is-streaming'), false, 'the caret is removed');

  const c = mount();
  const cut = createStreamText(c.el, {});
  cut.push(text(line));
  cut.end('cut');
  assert.equal(cut.text(), line, "'cut' flushes like 'done'");
});

test('reset removes everything', () => {
  const { doc, win, el } = mount();
  const foreign = doc.createElement('i');                // not rendered by stream-text: must survive
  el.appendChild(foreign);
  /** @type {number[]} */
  const ticks = [];
  const stream = createStreamText(el, { onTick: (n) => ticks.push(n) });
  stream.push(text('先走'));
  stream.push(move('炮五进四', '7434', 'red'));
  stream.push(text('\n再看对方怎么应。这一句还在队列里。'));
  for (const t of [0, 100, 200]) win.frame(t);
  assert.ok(el.childNodes.length > 2, 'something was shown');
  assert.ok(win.frames.size > 0, 'and more is queued');

  stream.reset();
  assert.deepEqual(el.childNodes, [foreign], 'every node it rendered is gone');
  assert.equal(stream.text(), '');
  assert.equal(el.classList.contains('is-streaming'), false);
  assert.equal(win.frames.size, 0, 'the drain has stopped');
  win.frame(5000);
  assert.deepEqual(el.childNodes, [foreign], 'the queue was removed as well');

  ticks.length = 0;
  stream.push(text('好'));
  stream.end('done');
  assert.equal(stream.text(), '好', 'it can be used again');
  assert.deepEqual(ticks, [1], 'the character count starts again at zero');
});

test('a move link carries data-move and data-color', () => {
  const { el } = mount();
  const stream = createStreamText(el, { reducedMotion: true });
  stream.push(move('炮五进四', '7434', 'red'));
  stream.push(move('马8进7', '0726', 'black'));
  const [red, black] = el.childNodes;
  assert.equal(red.tagName, 'BUTTON');
  assert.equal(red.type, 'button');
  assert.equal(red.className, 'move-link');
  assert.deepEqual(red.dataset, { move: '7434', color: 'red' });
  assert.equal(red.textContent, '炮五进四');
  assert.deepEqual(black.dataset, { move: '0726', color: 'black' });
  assert.equal(black.textContent, '马8进7');
});

// ---- pacing --------------------------------------------------------------------------------------------------------------

test('the drain shows rate x dt characters per frame with rate = max(cps, 4 x backlog)', () => {
  const { win, el } = mount();
  /** @type {number[]} */
  const ticks = [];
  const stream = createStreamText(el, { onTick: (n) => ticks.push(n) });
  stream.push(text('字'.repeat(100)));
  // Frames 100 ms apart; the first frame of a drain counts as 1/60 s. Worked by hand from the rule:
  //   backlog 100 -> 400 /s x 1/60 s = 6.67            -> 6   (carry .67)
  //   backlog  94 -> 376 /s x .1 s  = 37.6  + .67      -> 38  (carry .27)
  //   backlog  56 -> 224 /s         = 22.4  + .27      -> 22  (carry .67)
  //   backlog  34 -> 136 /s         = 13.6  + .67      -> 14  (carry .27)
  //   backlog  20 ->  80 /s         =  8.0  + .27      ->  8  (carry .27)
  //   backlog  12 ->  48 /s         =  4.8  + .27      ->  5  (carry .07)
  //   backlog   7 ->  40 /s (cps)   =  4.0  + .07      ->  4  (carry .07)
  //   backlog   3 ->  40 /s         =  4.0  + .07      ->  the last 3
  for (let i = 0; i < 8; i++) win.frame(1000 + 100 * i);
  assert.deepEqual(ticks, [6, 44, 66, 80, 88, 93, 97, 100]);
  assert.equal(stream.text().length, 100);
  assert.equal(win.frames.size, 0, 'no frame is requested once the queue is empty');
});

test('cps sets the floor of the rate; a move counts as its notation and appears whole', () => {
  const { win, el } = mount();
  /** @type {number[]} */
  const ticks = [];
  const stream = createStreamText(el, { cps: 100, onTick: (n) => ticks.push(n) });
  stream.push(text('ab'));
  stream.push(move('炮五进四', '7434', 'red'));
  stream.push(text('cd'));
  // backlog 8 -> 4 x 8 = 32 < 100, so 100 /s: one character per 10 ms frame (the first frame: 1.67).
  win.frame(0);
  assert.equal(stream.text(), 'a');
  win.frame(10);
  assert.equal(stream.text(), 'ab');
  win.frame(20);                                         // the link appears whole and costs four characters of time
  assert.equal(stream.text(), 'ab炮五进四');
  assert.deepEqual(outline(el), ['#text:ab', 'BUTTON.move-link:炮五进四']);
  for (const t of [30, 40, 50]) win.frame(t);
  assert.equal(stream.text(), 'ab炮五进四', 'three frames pay for the rest of the notation');
  win.frame(60);
  assert.equal(stream.text(), 'ab炮五进四c');
  win.frame(70);
  assert.equal(stream.text(), 'ab炮五进四cd');
  assert.deepEqual(ticks, [1, 2, 6, 7, 8]);
});

test('reduced motion shows every push immediately', () => {
  const { win, el } = mount();
  /** @type {number[]} */
  const ticks = [];
  const stream = createStreamText(el, { reducedMotion: true, onTick: (n) => ticks.push(n) });
  stream.push(text('小主公，'));
  assert.equal(stream.text(), '小主公，');
  stream.push(move('炮二平五', '7774', 'red'));
  assert.equal(stream.text(), '小主公，炮二平五');
  assert.equal(win.frames.size, 0, 'no animation frame is used');
  assert.deepEqual(ticks, [4, 8]);
});

test('a line break renders as <br>, at most two in a row', () => {
  const { el } = mount();
  const stream = createStreamText(el, { reducedMotion: true });
  stream.push(text('a\n\n\n'));
  stream.push(text('\nb\nc'));
  assert.deepEqual(outline(el), ['#text:a', 'BR', 'BR', '#text:b', 'BR', '#text:c']);
  assert.equal(stream.text(), 'a\n\nb\nc');
});

test('the container carries is-streaming from the first push until the end', () => {
  const { win, el } = mount();
  const stream = createStreamText(el, {});
  assert.equal(el.classList.contains('stream-text'), true);
  assert.equal(el.classList.contains('is-streaming'), false, 'no caret before any text');
  stream.push(text('好棋'));
  assert.equal(el.classList.contains('is-streaming'), true);
  win.frame(0);
  win.frame(500);
  assert.equal(stream.text(), '好棋');
  assert.equal(el.classList.contains('is-streaming'), true, 'the caret stays while the line may still grow');
  stream.end('done');
  assert.equal(el.classList.contains('is-streaming'), false);
});

test('a push after end() streams again and continues the line', () => {
  // The chat panel flushes a line with end('done') before it shows the tool indicator; the rest of the reply follows.
  const { win, el } = mount();
  /** @type {number[]} */
  const ticks = [];
  const stream = createStreamText(el, { cps: 100, onTick: (n) => ticks.push(n) });
  stream.push(text('让亮摆一摆。'));
  win.frame(0);                                          // 6 queued: 100 /s x 1/60 s = 1.67 -> one character
  assert.equal(stream.text(), '让');
  stream.end('done');
  assert.equal(stream.text(), '让亮摆一摆。');
  assert.equal(el.classList.contains('is-streaming'), false);

  stream.push(text('好棋'));
  assert.equal(el.classList.contains('is-streaming'), true, 'the caret is back');
  assert.equal(stream.text(), '让亮摆一摆。', 'the new text is paced again');
  win.frame(1000);
  win.frame(1010);
  assert.equal(stream.text(), '让亮摆一摆。好棋');
  assert.deepEqual(outline(el), ['#text:让亮摆一摆。好棋'], 'it continues in the same text node');
  assert.deepEqual(ticks, [1, 6, 7, 8], 'the count of characters shown runs on');
});

test('empty segments are ignored; a character outside the BMP is never split', () => {
  const { win, el } = mount();
  /** @type {number[]} */
  const ticks = [];
  const stream = createStreamText(el, { cps: 60, onTick: (n) => ticks.push(n) });
  stream.push(text(''));
  stream.push(/** @type {any} */ (null));
  stream.push(/** @type {any} */ ({ type: 'other' }));
  assert.equal(el.classList.contains('is-streaming'), false, 'nothing to show: no caret');
  assert.equal(win.frames.size, 0, 'and no frame is requested');

  stream.push(text('𠮷好😀'));                             // three characters, two of them surrogate pairs
  win.frame(0);                                          // 60 /s x 1/60 s = one character
  assert.equal(stream.text(), '𠮷');
  win.frame(1000 / 60);
  assert.equal(stream.text(), '𠮷好');
  win.frame(2000 / 60);
  assert.equal(stream.text(), '𠮷好😀');
  assert.deepEqual(ticks, [1, 2, 3], 'each counts as one character');
});

test('end() may be called from onTick (the chat panel ends a line when its last character shows)', () => {
  const { win, el } = mount();
  /** @type {number[]} */
  const ticks = [];
  let ended = 0;
  /** @type {import('../../../src/ui/types.js').StreamText} */
  const stream = createStreamText(el, {
    onTick: (n) => {
      ticks.push(n);
      if (n >= 6 && !ended) { ended += 1; stream.end('done'); }
    },
  });
  stream.push(text('好棋'));
  stream.push(move('炮五进四', '7434', 'red'));
  for (let t = 0; win.frames.size > 0 && t < 2000; t += 16) win.frame(t);
  assert.equal(ended, 1);
  assert.equal(stream.text(), '好棋炮五进四');
  assert.equal(el.classList.contains('is-streaming'), false);
  assert.equal(win.frames.size, 0, 'the drain is idle');

  stream.push(text('。再来'));                             // the stream is still usable and paces from a clean state
  win.frame(5000);
  win.frame(5100);
  assert.equal(stream.text(), '好棋炮五进四。再来');
  assert.deepEqual(ticks.slice(-1), [9]);
});

// ---- links ---------------------------------------------------------------------------------------------------------------

test('a tap activates a link and reports it; a second tap, another link or a board pick deactivates it', () => {
  const { doc, el } = mount();
  /** @type {any[]} */
  const events = [];
  doc.addEventListener('chat:movelink', (event) => events.push([event.detail.link.code, event.detail.active, event.target.textContent]));
  let bubbleTaps = 0;
  doc.body.addEventListener('click', () => { bubbleTaps += 1; });

  const stream = createStreamText(el, { reducedMotion: true });
  const a = move('炮五进四', '7434', 'red', { playable: true });
  const b = move('马8进7', '0726', 'black');
  stream.push(a);
  stream.push(text('，'));
  stream.push(b);
  const [first, , second] = el.childNodes;

  click(first);
  assert.equal(first.classList.contains('is-active'), true);
  assert.equal(first.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(events, [['7434', true, '炮五进四']]);
  assert.equal(bubbleTaps, 0, 'the click itself does not reach the elements around the text');

  click(second);                                         // another link: the first one is switched off without an event
  assert.equal(first.classList.contains('is-active'), false);
  assert.equal(second.classList.contains('is-active'), true);
  assert.deepEqual(events.slice(1), [['0726', true, '马8进7']]);

  click(second);                                         // the active link again
  assert.equal(second.classList.contains('is-active'), false);
  assert.equal(second.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(events.slice(2), [['0726', false, '马8进7']]);

  click(first);
  assert.equal(events.length, 4);
  doc.dispatchEvent(new FakeEvent('board:pick', { bubbles: true, detail: { row: 9, col: 4, via: 'tap' } }));
  assert.equal(first.classList.contains('is-active'), false, 'a board pick deactivates the link');
  assert.equal(events.length, 4, 'and that is not reported as a tap on the link');

  // the detail carries the MoveLink object itself
  const seen = [];
  doc.addEventListener('chat:movelink', (event) => seen.push(event.detail.link));
  click(first);
  assert.equal(seen[0], a.link);
});

test('a tap on the word of a link goes to that link, whichever tap area the browser attributes it to', () => {
  // Two links on neighbouring lines, 22 px apart: the 44 px tap area of each reaches over the word of the other.
  const { doc, el } = mount();
  /** @type {string[]} */
  const events = [];
  doc.addEventListener('chat:movelink', (event) => events.push(`${event.detail.link.code}:${event.detail.active}`));
  const stream = createStreamText(el, { reducedMotion: true });
  stream.push(move('炮二平五', '7774', 'red'));
  stream.push(text('架上当头炮，对方多半'));
  stream.push(move('马8进7', '0726', 'black'));
  const [upper, , lower] = el.childNodes;
  const box = (left, top, width, height) => () => ({ left, top, right: left + width, bottom: top + height, width, height });
  upper.getBoundingClientRect = box(102, 566, 64, 22);
  lower.getBoundingClientRect = box(87, 588, 50, 22);
  const tapAt = (target, clientX, clientY) => {
    const event = new FakeEvent('click', { bubbles: true, detail: 1 });
    event.clientX = clientX;
    event.clientY = clientY;
    target.dispatchEvent(event);
  };

  tapAt(lower, 134, 577);                                // the middle of the upper word, delivered to the lower link
  assert.deepEqual(events, ['7774:true'], 'the link under the finger is activated');
  assert.equal(upper.classList.contains('is-active'), true);
  assert.equal(lower.classList.contains('is-active'), false);

  tapAt(upper, 112, 599);                                // the middle of the lower word, delivered to the upper link
  assert.deepEqual(events.slice(1), ['0726:true']);

  tapAt(lower, 150, 620);                                // beside every word, inside the lower link's tap area
  assert.deepEqual(events.slice(2), ['0726:false'], 'a tap next to the words stays with the tap area it fell into');
});

test('a link that something covers is never meant by a tap', () => {
  // The open 回看 sheet lies over the bubble. A tap in the sheet, next to the word of a link of the log, falls on
  // the spot where the covered bubble has the word of one of its own links.
  const { doc, el } = mount();                             // the log's line
  const covered = doc.createElement('span');               // the bubble's line, under the sheet
  doc.body.appendChild(covered);
  /** @type {string[]} */
  const events = [];
  doc.addEventListener('chat:movelink', (event) => events.push(`${event.detail.link.code}:${event.detail.active}`));
  const inLog = createStreamText(el, { reducedMotion: true });
  const inBubble = createStreamText(/** @type {any} */ (covered), { reducedMotion: true });
  inLog.push(move('马7进5', '2634', 'black'));
  inBubble.push(move('炮二平五', '7774', 'red'));
  const [logLink] = el.childNodes;
  const [bubbleLink] = covered.childNodes;
  const box = (left, top, width, height) => () => ({ left, top, right: left + width, bottom: top + height, width, height });
  logLink.getBoundingClientRect = box(100, 300, 50, 22);
  bubbleLink.getBoundingClientRect = box(90, 322, 64, 22);
  // Topmost first: the tap area of the log's link, the sheet it sits in, and only then what the sheet covers.
  doc.elementsFromPoint = () => [logLink, el, doc.body, bubbleLink, covered];

  const event = new FakeEvent('click', { bubbles: true, detail: 1 });
  event.clientX = 120;
  event.clientY = 330;                                     // below the log's word, inside its tap area, on the covered word
  logLink.dispatchEvent(event);
  assert.deepEqual(events, ['2634:true'], 'the tap stays with the link of the log');
  assert.equal(logLink.classList.contains('is-active'), true);
  assert.equal(bubbleLink.classList.contains('is-active'), false);
});

test('an active link in another stream is switched off', () => {
  const { doc, el } = mount();
  const other = doc.createElement('span');
  doc.body.appendChild(other);
  const one = createStreamText(el, { reducedMotion: true });
  const two = createStreamText(/** @type {any} */ (other), { reducedMotion: true });
  one.push(move('炮五进四', '7434', 'red'));
  two.push(move('马8进7', '0726', 'black'));
  click(el.childNodes[0]);
  click(other.childNodes[0]);
  assert.equal(el.childNodes[0].classList.contains('is-active'), false);
  assert.equal(other.childNodes[0].classList.contains('is-active'), true);
});

test('consecutive links of one line get a ▶ 演示 button after the last', () => {
  const { doc, el } = mount();
  /** @type {any[]} */
  const played = [];
  doc.addEventListener('chat:playline', (event) => played.push(event.detail.links));

  // 马7进5 is the first move of a line, 车一平二 the second (its `pre` holds the first), 炮8平5 the third.
  const m1 = move('马7进5', '2634', 'black');
  const m2 = move('车一平二', '9897', 'red', { pre: [{ from: { row: 2, col: 6 }, to: { row: 3, col: 4 }, color: 'black' }] });
  const m3 = move('炮8平5', '2124', 'black', {
    pre: [{ from: { row: 2, col: 6 }, to: { row: 3, col: 4 }, color: 'black' }, { from: { row: 9, col: 8 }, to: { row: 9, col: 7 }, color: 'red' }],
  });
  const lone = move('兵三进一', '6656', 'red');             // a link of another line

  const stream = createStreamText(el, { reducedMotion: true });
  stream.push(text('对方走'));
  stream.push(m1);
  stream.push(text('，咱们'));
  stream.push(m2);
  stream.push(text('，它再'));
  stream.push(m3);
  assert.equal(el.childNodes.some((node) => node.textContent === '▶ 演示'), false, 'not while the line may still grow');
  stream.push(text('。另外'));
  stream.push(lone);                                      // does not continue the line: the run of three is closed
  stream.push(text('也行。'));
  stream.end('done');

  assert.deepEqual(outline(el), [
    '#text:对方走', 'BUTTON.move-link:马7进5', '#text:，咱们', 'BUTTON.move-link:车一平二', '#text:，它再', 'BUTTON.move-link:炮8平5',
    'BUTTON.move-link.move-link--play:▶ 演示', '#text:。另外', 'BUTTON.move-link:兵三进一', '#text:也行。',
  ]);
  assert.equal(stream.text(), '对方走马7进5，咱们车一平二，它再炮8平5。另外兵三进一也行。', 'the button label is not part of the text');

  const play = el.childNodes[6];
  assert.equal(play.dataset.move, undefined);
  click(play);
  assert.equal(played.length, 1);
  assert.deepEqual(played[0], [m1.link, m2.link, m3.link]);
});

test('no ▶ 演示 for a single link, for links of different lines, or on an aborted line', () => {
  const single = mount();
  const s1 = createStreamText(single.el, { reducedMotion: true });
  s1.push(move('马7进5', '2634', 'black'));
  s1.end('done');
  assert.deepEqual(outline(single.el), ['BUTTON.move-link:马7进5']);

  const apart = mount();
  const s2 = createStreamText(apart.el, { reducedMotion: true });
  s2.push(move('马7进5', '2634', 'black'));
  s2.push(move('兵三进一', '6656', 'red'));                  // both are first moves: not one line
  // `pre` one longer, but it does not continue with the link before it
  s2.push(move('车一平二', '9897', 'red', { pre: [{ from: { row: 0, col: 0 }, to: { row: 1, col: 0 }, color: 'black' }] }));
  s2.end('done');
  assert.deepEqual(outline(apart.el), ['BUTTON.move-link:马7进5', 'BUTTON.move-link:兵三进一', 'BUTTON.move-link:车一平二']);

  const stopped = mount();
  const s3 = createStreamText(stopped.el, { reducedMotion: true });
  s3.push(move('马7进5', '2634', 'black'));
  s3.push(move('车一平二', '9897', 'red', { pre: [{ from: { row: 2, col: 6 }, to: { row: 3, col: 4 }, color: 'black' }] }));
  s3.end('aborted');
  assert.deepEqual(outline(stopped.el), ['BUTTON.move-link:马7进5', 'BUTTON.move-link:车一平二']);
});

test('dispose stops the drain and the listeners', () => {
  const { doc, win, el } = mount();
  let events = 0;
  doc.addEventListener('chat:movelink', () => { events += 1; });
  const stream = createStreamText(el, {});
  stream.push(move('炮五进四', '7434', 'red'));
  stream.push(text('再看一步，想清楚了再落子。'));
  win.frame(0);
  win.frame(100);
  const before = stream.text();
  assert.ok(before.startsWith('炮五进四'));
  stream.dispose();
  assert.equal(win.frames.size, 0);
  win.frame(5000);
  stream.push(text('不会出现'));
  assert.equal(stream.text(), before);
  click(el.childNodes[0]);
  assert.equal(events, 0, 'taps are no longer handled');
});
