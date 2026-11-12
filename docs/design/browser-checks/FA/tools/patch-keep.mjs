// One-off: endAll(reason, keep) in chat-panel.js and its use in stage.settle() (flow 4: a line that gets a stale label keeps its text).
import { readFileSync, writeFileSync } from 'node:fs';
const patch = (f, pairs) => {
  let s = readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${f}: anchor ${JSON.stringify(a.slice(0, 70))} found ${n} times`);
    s = s.replace(a, () => b);
  }
  writeFileSync(f, s);
  console.log(`${f} patched`);
};
const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
patch(`${REPO}/src/ui/chat-panel.js`, [
  [`  /** @param {'aborted'} reason */
  function endAll(reason) {
    for (const entry of [...entries.values()]) {
      if (entry.state !== 'streaming') continue;`,
   `  /**
   * @param {'aborted'} reason
   * @param {string} [keep]  the id of one line that is left as it is: the caller ends it itself in the same run of calls,
   *                         with a stale label (which keeps its text as it stands) or without one
   */
  function endAll(reason, keep) {
    for (const entry of [...entries.values()]) {
      if (entry.state !== 'streaming' || (keep !== undefined && entry.id === keep)) continue;`],
  [` *  @returns {ChatPanel & {retireLinks:() => void}}   retireLinks is not in the frozen typedef of src/ui/types.js */`,
   ` *  @returns {ChatPanel & {retireLinks:() => void, endAll:(reason:'aborted', keep?:string) => void}}
 *           retireLinks and the second parameter of endAll are not in the frozen typedef of src/ui/types.js */`],
]);
patch(`${REPO}/src/ui/stage.js`, [
  [`      audio.cancelScheduled();
      speech.cancel();
      chat.endAll('aborted');
      closeLines(true);
      if (bubbleLine && bubbleLine.state !== 'ended') {`,
   `      audio.cancelScheduled();
      speech.cancel();
      // Every line that is still coming in is cut to its whole sentences, but the one about the trial on the board: what
      // follows in this run of calls (a retract, a commit) marks it 已换一步 / 已落子 and keeps its text as it stands
      // (SPEC 7.7, 12.7). When nothing takes it up, it is cut like the others once the run is over.
      const kept = trial && bubbleLine && bubbleLine.state !== 'ended' && bubbleLine.trial === trial.seq && bubbleLine.kind !== 'system'
        ? bubbleLine.chatId : undefined;
      chat.endAll('aborted', kept);
      if (kept !== undefined) win.queueMicrotask(() => chat.end(kept, { reason: 'aborted', source: 'none' }));
      closeLines(true);
      if (bubbleLine && bubbleLine.state !== 'ended') {`],
]);
