// One-off: applies the chat-panel edits of items 9 and 10 to the repository file (anchors must match exactly once).
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'C:/Users/USERNAME/git/yijian-xiangqi/src/ui/chat-panel.js';
let s = readFileSync(f, 'utf8');
const rep = (a, b) => {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`anchor ${JSON.stringify(a.slice(0, 70))} found ${n} times`);
  s = s.replace(a, () => b);
};

// header comment
rep(`//   line is trimmed to its whole sentences (§7.7). Under reduced motion, or while the page is hidden, text appears
//   at once.
`, `//   line is trimmed to its whole sentences (§7.7). Under reduced motion, or while the page is hidden, text appears
//   at once.
// - A line that is cut while it is still coming in (endAll(), or end() with reason 'aborted' and no stale label: a
//   first trial, an undo, a newer reply, the task's timeout) keeps the whole sentences of what the child has seen and
//   leaves when none is complete (shownSentences): half a sentence never stays behind as a finished line. A line that
//   gets a stale label keeps its text as it stands; the label says why it stopped.
// - Links. The stage calls retireLinks() when the position changes: the move links (and ▶ 演示) written so far belong
//   to an earlier board and stop being buttons (styles/chat.css draws a disabled link as a word of its sentence).
`);

// the pure helper
rep(`/**
 * One line of the strategist.
 * @typedef {Object} Entry`, `/**
 * What stays of a line that is cut while it is still coming in: the whole sentences among the first \`shown\`
 * characters of its segments (characters as stream-text counts them: a move counts as its notation and is shown whole
 * or not at all). Empty when no sentence is complete: the line then leaves without a trace.
 * @param {Segment[]} segments
 * @param {number} shown   characters the child has seen
 * @returns {Segment[]}
 */
export function shownSentences(segments, shown) {
  /** @type {Segment[]} */
  const seen = [];
  let left = Number.isFinite(shown) ? Math.floor(shown) : 0;
  for (const seg of segments) {
    if (left <= 0) break;
    const size = sizeOf(seg);
    if (!size) continue;
    if (size > left) {
      if (seg.type === 'text') seen.push({ type: 'text', text: Array.from(seg.text).slice(0, left).join('') });
      break;
    }
    seen.push(seg);
    left -= size;
  }
  for (let i = seen.length - 1; i >= 0; i--) {
    const seg = seen[i];
    if (seg.type !== 'text') continue;
    let cut = -1;
    for (const match of seg.text.matchAll(/[。！？][」』”’）》]*/g)) cut = match.index + match[0].length;
    if (cut < 0) continue;
    const kept = seen.slice(0, i);
    kept.push(cut === seg.text.length ? seg : { type: 'text', text: seg.text.slice(0, cut) });
    return kept;
  }
  return [];
}

/**
 * One line of the strategist.
 * @typedef {Object} Entry`);

// return type
rep(` *  @param {{ bubble:Bubble, speech:Speech, audio:AudioEngine, typeTicks:boolean, reducedMotion?:boolean }} deps @returns {ChatPanel} */
export function createChatPanel(host, deps) {`, ` *  @param {{ bubble:Bubble, speech:Speech, audio:AudioEngine, typeTicks:boolean, reducedMotion?:boolean }} deps
 *  @returns {ChatPanel & {retireLinks:() => void}}   retireLinks is not in the frozen typedef of src/ui/types.js */
export function createChatPanel(host, deps) {`);

// caption host
rep(`  /** @type {StreamText|null} */
  let captionStream = null;
`, `  /** @type {StreamText|null} */
  let captionStream = null;
  /** @type {HTMLElement|null} */
  let captionHost = null;          // where the bubble shows the caption: its links are retired with the others
`);
rep(`    captionStream = createStreamText(bubble.captionEl(), { reducedMotion: true });`,
    `    captionHost = bubble.captionEl();
    captionStream = createStreamText(captionHost, { reducedMotion: true });`);

// cutOff + finish
rep(`  /** end() of a line: an abort settles at once, a finished line lets the typewriter catch up first. */`,
    `  /**
   * The line is cut while it is still coming in: it keeps the whole sentences of what has been shown, and leaves when
   * none is complete (finalize removes a line without text).
   * @param {Entry} entry
   */
  function cutOff(entry) {
    const kept = shownSentences(entry.segments, entry.shown);
    entry.log.reset();
    if (entry.out) entry.out.reset();
    entry.segments = [];
    entry.pushed = 0;
    entry.shown = 0;
    for (const seg of kept) pushSegment(entry, seg);
    finalize(entry, { reason: kept.length ? 'cut' : 'aborted', source: 'none' });
    speech.cancel();                               // also when sentences stay: nothing more of this line is read aloud
  }

  /** end() of a line: an abort settles at once, a finished line lets the typewriter catch up first. */`);
rep(`    close(entry);
    if (info.reason === 'aborted') {
      finalize(entry, info);
      return;
    }`, `    close(entry);
    if (info.reason === 'aborted') {
      // with a stale label the text stays as it stands; a line that had ended already only loses its backlog
      if (info.stale || entry.ending) finalize(entry, info);
      else cutOff(entry);
      return;
    }`);

// endAll
rep(`      // A line that had already ended is complete: it is shown in full. A line still coming in is cut off.
      finalize(entry, entry.ending ?? { reason, source: 'none' });`,
    `      // A line that had already ended is complete: it is shown in full. A line still coming in is cut off.
      if (entry.ending) finalize(entry, entry.ending);
      else if (reason === 'aborted') cutOff(entry);
      else finalize(entry, { reason, source: 'none' });`);

// retireLinks
rep(`  /** @param {ChipSpec[]} chips */
  function setChips(chips) {`, `  /**
   * The position has changed. Every move link and ▶ 演示 written so far (in the log, the bubble, its caption, the
   * game-over card) was made for an earlier board: its squares may hold other pieces by now, and a tap would draw an
   * arrow or try a move there. They stop being buttons (a disabled button sends no event) and stay as words of their
   * sentences. Text that is written after this call has live links.
   */
  function retireLinks() {
    /** @type {Set<Element>} */
    const places = new Set([log]);
    if (captionHost) places.add(captionHost);
    for (const entry of byElement.values()) if (entry.outEl) places.add(entry.outEl);
    if (current && current.outEl) places.add(current.outEl);
    for (const place of places) {
      for (const button of place.querySelectorAll('button.move-link')) {
        if (!(button instanceof HTMLButtonElement) || button.disabled) continue;
        button.disabled = true;
        button.classList.remove('is-active');
        if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', 'false');
      }
    }
  }

  /** @param {ChipSpec[]} chips */
  function setChips(chips) {`);

// the returned object
rep(`    begin, segment, reset, end, tool, local, caption, addChild, addEvent, endAll, setChips, setInput, setSheet, setLayout,`,
    `    begin, segment, reset, end, tool, local, caption, addChild, addEvent, endAll, retireLinks, setChips, setInput, setSheet, setLayout,`);

writeFileSync(f, s);
console.log('chat-panel.js patched');
