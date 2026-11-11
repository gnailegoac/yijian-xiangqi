// src/coach/markup.js (C1) — the only parser of 【…】 in coach text: stream -> Segment[] (contract section 4.12).
// Pure apart from one console.warn per ungrounded notation. Has no runtime import, so it loads wherever its siblings load.

/**
 * @import { Segment, MoveLink } from './types.js'
 * @import { MoveBook } from './book.js'
 */

/** From an unmatched 【 the stream holds back until 】 arrives or this many further characters pass. */
const HOLD_CHARS = 10;
/** Shown after a reply that had to be cut in the middle of its first sentence. */
const CUT_MARK = '……';
const SENTENCE_END = '。！？';
/** Closing marks that still belong to the sentence that just ended. */
const CLOSERS = '”’」』）)》';

/** @param {string} s @returns {number} characters as the child counts them */
function charCount(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** @type {Record<string, string>} */
const VARIANT_GLYPH = { 車: '车', 俥: '车', 馬: '马', 傌: '马', 砲: '炮', 包: '炮', 帥: '帅', 將: '将', 進: '进', 後: '后' };

/**
 * The normalisation step of the notation parser (Appendix A5.2; the same text `normalizeNotation` of core/notation.js produces):
 * whitespace, brackets and quotes removed, trailing punctuation removed, full-width digits to ASCII, variant glyphs to the
 * standard ones. The numeral script is not changed.
 * @param {string} text
 * @returns {string}
 */
function normalizeBracket(text) {
  return text
    .replace(/[\s【】\[\]()（）「」『』“”‘’"']/g, '')
    .replace(/[。，！？!?.,;；:：]+$/, '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[車俥馬傌砲包帥將進後]/g, (c) => VARIANT_GLYPH[c]);
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
/** A URL that reaches the end of the text received so far: the next delta may continue it. */
const URL_OPEN_RE = /(?:https?:\/\/|www\.)\S*$/i;
/** The first characters of `http://`, `https://` or `www.` at the end of the text: the next delta may turn them into a URL. */
const URL_HEAD_RE = /(?:h|ht|htt|https?(?::\/?)?|w{1,3})$/i;

/**
 * Removes control characters (the line break stays), `*`, `#`, backticks and `_` used as markup. Works character by character,
 * so it gives the same result on a text and on its pieces (but for an underscore right at the seam of two pieces).
 * @param {string} text @returns {string}
 */
function stripMarks(text) {
  return text
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[*#`]/g, '')
    .replace(/(^|[^A-Za-z0-9])_+/g, '$1')
    .replace(/_+(?![A-Za-z0-9])/g, '');
}

/**
 * How much of the text received so far is settled, i.e. reads the same whatever arrives next. What is not: a URL that is still
 * being written (a model streams `https`, `://`, `example.com` as separate deltas, and what was shown cannot be taken back)
 * and the first half of a surrogate pair.
 * @param {string} text @returns {number} length of the settled prefix
 */
function settledLength(text) {
  let n = text.search(URL_OPEN_RE);
  if (n === -1) n = text.search(URL_HEAD_RE);
  if (n !== -1) return n;
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length;
}

/**
 * Where the authoritative text continues after what was already consumed from the accumulated deltas.
 * Normally the consumed text is a prefix of the authoritative one. It is not when the legs of a tool exchange were joined with a
 * line break (section 7.3) or an underscore sat at the seam of two deltas: white space is skipped on either side, and what still
 * cannot be matched is skipped one character for one.
 * @param {string} consumed @param {string} full @returns {number} index into `full`
 */
function resumeIndex(consumed, full) {
  if (full.startsWith(consumed)) return consumed.length;
  let i = 0;
  let j = 0;
  while (i < consumed.length && j < full.length) {
    if (consumed[i] === full[j]) { i++; j++; }
    else if (/\s/.test(full[j])) j++;
    else if (/\s/.test(consumed[i])) i++;
    else break;
  }
  return Math.min(full.length, j + (consumed.length - i));
}

/**
 * A streaming parser. A notation inside 【】 is resolved through the book (`lookup`, then `resolveLoose`) and becomes a `move`
 * segment; an unresolved one is emitted as plain text without brackets and reported with console.warn. Which entry wins when a
 * notation occurs in several lines (a playable one, else the most recent packet) is decided by `book.lookup`.
 *
 * Emission:
 * - Without a cap, text is emitted as it arrives (an unmatched 【 is held back until 】 arrives or 10 further characters pass,
 *   then flushed as plain text without the bracket).
 * - With a cap the same holds for the first sentence. A later sentence is emitted when its end (。！？) arrives, or at finish(),
 *   and only if it still fits: this is what lets the stream stop "at the last sentence end before the cap" although nothing that
 *   was emitted can be taken back. A first sentence that alone passes the cap is cut at the cap and followed by ……. Once the
 *   stream has stopped it emits nothing more.
 *
 * `push(delta)` feeds a delta. Every delta is sanitised before it is parsed (sanitizeModelText); so that a URL written across
 * several deltas is removed all the same, a tail that may still become one waits for the next delta or for finish().
 * `finish(fullText)` ends the stream; with an argument it replaces the accumulated text by the authoritative one and emits what
 * is still due. `shown()` is the text emitted so far in coach markup (a move segment reads 【notation】), so
 * `plainLength(shown())` is what the child sees. `sentences()` counts the sentences emitted in full: one per `onSentence` call
 * (a sentence ends at 。！？, at the end of the text, or at the cap cut). `onSentence` fires after the segments of its sentence.
 *
 * A reply that fails or is aborted is simply dropped without finish(): with a cap, `shown()` then holds whole sentences only as
 * soon as `sentences() >= 1` (finish() would emit the unfinished last sentence).
 *
 * @param {MoveBook} book
 * @param {(seg:Segment) => void} onSegment
 * @param {(text:string) => void} [onSentence]   fires at each 。！？ (brackets stripped)
 * @param {{cap?:number}} [opts]                 cap = display cap in characters (plainLength)
 * @returns {{ push(delta:string):void, finish(fullText?:string):void, shown():string, sentences():number }}
 */
export function createMarkupStream(book, onSegment, onSentence, opts) {
  const capOpt = opts?.cap;
  const cap = typeof capOpt === 'number' && capOpt > 0 ? capOpt : Infinity;

  let pending = '';         // received text that is not settled yet (see settledLength); marks stripped, URLs not yet
  let buf = '';             // sanitised text received so far
  let pos = 0;              // buf[0..pos) has been consumed
  let finished = false;
  let stopped = false;      // the cap was reached: nothing more is emitted

  let shownText = '';       // everything emitted, in coach markup
  let shownLen = 0;         // its length as the child sees it
  let count = 0;            // sentences emitted in full
  let sentence = '';        // plain text of the sentence in progress
  /** @type {Segment[]} */
  let held = [];            // the sentence in progress while it is held back (cap set, a sentence already shown)
  let heldLen = 0;
  let run = '';             // emitted text not yet handed to onSegment (one text segment per run)
  /** @type {Map<string, MoveLink>} */
  const resolved = new Map();
  /**
   * Unresolved notations already reported. They are looked up again at every occurrence: the book grows during a tool round.
   * @type {Set<string>}
   */
  const warned = new Set();

  function flushRun() {
    if (run === '') return;
    const text = run;
    run = '';
    onSegment({ type: 'text', text });
  }

  /** @param {Segment} seg */
  function emit(seg) {
    if (seg.type === 'text') {
      run += seg.text;
      shownText += seg.text;
      shownLen += charCount(seg.text);
    } else {
      flushRun();
      shownText += '【' + seg.notation + '】';
      shownLen += charCount(seg.notation);
      onSegment(seg);
    }
  }

  /** The sentence in progress is complete: count it and hand it to onSentence. */
  function endSentence() {
    const text = sentence.trim();
    sentence = '';
    if (!/[^\s。！？]/.test(text)) return;
    count++;
    if (onSentence) {
      flushRun();                                      // the listener hears of a sentence after its text has been handed over
      onSentence(text);
    }
  }

  function releaseHeld() {
    for (const seg of held) emit(seg);
    held = [];
    heldLen = 0;
  }

  /** The cap falls inside the first sentence: cut here. */
  function cutHere() {
    emit({ type: 'text', text: CUT_MARK });
    stopped = true;
    endSentence();
  }

  /** The sentence in progress cannot be shown in full any more: the stream ends at the last sentence end. */
  function stopAtSentenceEnd() {
    stopped = true;
    held = [];
    heldLen = 0;
    sentence = '';
  }

  /** @param {string} ch one character @returns {boolean} false once the stream has stopped */
  function feedChar(ch) {
    const ends = SENTENCE_END.includes(ch);
    // Punctuation right after a sentence end still belongs to that sentence.
    if (count > 0 && sentence === '' && (ends || CLOSERS.includes(ch))) {
      if (shownLen + 1 <= cap) emit({ type: 'text', text: ch });
      return true;
    }
    if (shownLen === 0 && sentence === '' && /\s/.test(ch)) return true;        // nothing to show yet: skip leading white space
    if (cap !== Infinity && count > 0) {
      sentence += ch;
      const last = held[held.length - 1];
      if (last && last.type === 'text') last.text += ch;
      else held.push({ type: 'text', text: ch });
      heldLen += 1;
      if (shownLen + heldLen > cap) { stopAtSentenceEnd(); return false; }
      if (ends) { releaseHeld(); endSentence(); }
      return true;
    }
    if (shownLen + 1 > cap) { cutHere(); return false; }
    sentence += ch;
    emit({ type: 'text', text: ch });
    if (ends) endSentence();
    return true;
  }

  /** @param {string} text plain text (no brackets) */
  function feedText(text) {
    for (const ch of text) {
      if (stopped || !feedChar(ch)) return;
    }
  }

  /** @param {string} notation @param {MoveLink} link */
  function feedMove(notation, link) {
    if (stopped) return;
    /** @type {Segment} */
    const seg = { type: 'move', notation, link };
    const len = charCount(notation);
    if (cap !== Infinity && count > 0) {
      sentence += notation;
      held.push(seg);
      heldLen += len;
      if (shownLen + heldLen > cap) stopAtSentenceEnd();
      return;
    }
    if (shownLen + len > cap) { cutHere(); return; }
    sentence += notation;
    emit(seg);
  }

  /** @param {string} inner the text between 【 and 】 */
  function feedBracket(inner) {
    const notation = normalizeBracket(inner);
    if (notation === '') return;
    let link = resolved.get(notation) ?? null;
    if (link === null) {
      link = book.lookup(notation) ?? book.resolveLoose(notation) ?? null;
      if (link !== null) resolved.set(notation, link);
    }
    if (link !== null) {
      feedMove(notation, link);
      return;
    }
    // An invented move is never drawn on the board: it is shown as plain text and reported.
    if (!warned.has(notation)) {
      warned.add(notation);
      console.warn('[coach] ungrounded notation in a reply: ' + notation);
    }
    feedText(inner.replace(/[【】]/g, ''));
  }

  /** @param {boolean} final no more text will arrive */
  function drain(final) {
    while (pos < buf.length && !stopped) {
      const open = buf.indexOf('【', pos);
      if (open !== pos) {
        const end = open === -1 ? buf.length : open;
        const text = buf.slice(pos, end);
        pos = end;
        feedText(text.replace(/】/g, ''));          // a 】 with no 【 before it is dropped
        continue;
      }
      const close = buf.indexOf('】', pos + 1);
      const next = buf.indexOf('【', pos + 1);
      const matched = close !== -1 && close - pos <= HOLD_CHARS && (next === -1 || close < next);
      if (matched) {
        const inner = buf.slice(pos + 1, close);
        pos = close + 1;
        feedBracket(inner);
        continue;
      }
      const unmatched = close !== -1 || next !== -1 || buf.length - pos > HOLD_CHARS || final;
      if (!unmatched) break;                          // hold back: the closing bracket may still arrive
      pos += 1;                                       // the held text is flushed as plain text without the bracket
    }
  }

  function settle() {
    if (!stopped) {
      if (held.length > 0) releaseHeld();              // the last sentence had no end mark; it fits (checked while it was held)
      endSentence();
    }
    flushRun();
  }

  return {
    push(delta) {
      if (finished || stopped) return;
      pending += stripMarks(String(delta ?? ''));
      const settled = settledLength(pending);
      buf += pending.slice(0, settled).replace(URL_RE, '');
      pending = pending.slice(settled);
      drain(false);
      flushRun();
    },
    finish(fullText) {
      if (finished) return;
      finished = true;
      if (typeof fullText === 'string') {
        const full = sanitizeModelText(fullText);
        pos = resumeIndex(buf.slice(0, pos), full);
        buf = full;
      } else {
        buf += pending.replace(URL_RE, '');
      }
      pending = '';
      drain(true);
      settle();
    },
    shown() {
      return shownText;
    },
    sentences() {
      return count;
    },
  };
}

/**
 * Whole string at once.
 * @param {string} text
 * @param {MoveBook} book
 * @returns {Segment[]}
 */
export function parseCoachText(text, book) {
  /** @type {Segment[]} */
  const segments = [];
  const stream = createMarkupStream(book, (seg) => { segments.push(seg); });
  stream.push(text);
  stream.finish();
  return segments;
}

/**
 * Text without brackets (speech, aria-live, length checks).
 * @param {Segment[]} segments
 * @returns {string}
 */
export function plainText(segments) {
  return segments.map((seg) => (seg.type === 'move' ? seg.notation : seg.text)).join('');
}

/**
 * Removes `*`, `#`, backticks, `_` used as markup, URLs (https?://\S+, www.\S+) and control characters.
 * `_` counts as markup unless it joins two ASCII letters or digits (analyze_move stays). The line break is kept: it is the one
 * control character a reply may carry (the legs of a tool exchange are joined with it, and stream-text renders it as <br>).
 * URLs are removed last, so one that only appears once a mark or a control character inside it is gone (`ht*tp://…`) goes too.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeModelText(text) {
  return stripMarks(String(text ?? '')).replace(URL_RE, '');
}
