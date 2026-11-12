// PF items 1, 2, 3, 12 in src/game/director.js (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/game/director.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 70)); s = s.replace(a, b); };

// ---- constants
rep(`const MAX_CHIPS = 4;                  // 4.25.6
`,
`const MAX_CHIPS = 4;                  // 4.25.6
const FORCED_MOVES = 2;               // CONTRACT-NOTES 138: a move made with at most this many legal moves is forced
`);

// ---- item 3: the round of the top bar
rep(`  /** @returns {StageView} */
  function viewNow() {
    const lastPly = state.history.length > 0 ? state.history[state.history.length - 1] : null;
    const taken = capturedPieces(state);
    const red = state.humanColor === 'red';
    return {`,
`  /**
   * The round the top bar shows: the round of the next move while the game runs; once it is over, the last round that was
   * played (the round after it will never be played, and the card says 共 N 回合; CONTRACT-NOTES 138).
   * @returns {number}
   */
  function roundNow() {
    const plies = state.history.length;
    return state.result !== null && plies > 0 ? moveNo(plies - 1) : moveNo(plies);
  }

  /** @returns {StageView} */
  function viewNow() {
    const lastPly = state.history.length > 0 ? state.history[state.history.length - 1] : null;
    const taken = capturedPieces(state);
    const red = state.humanColor === 'red';
    return {`);
rep(`      round: moveNo(state.history.length),
      trophies:`,
`      round: roundNow(),
      trophies:`);

// ---- item 12: the chips of a trial whose assessment failed
rep(`    if (state.phase === 'tentative') {
      const tn = b.trial;
      /** @type {ChipSpec[]} */
      const chips = tn && tn.voiced`,
`    if (state.phase === 'tentative') {
      const tn = b.trial;
      // a trial that could not be assessed (the job failed or timed out) has no answers: its chips would do nothing
      if (tn && tn.failed) return [];
      /** @type {ChipSpec[]} */
      const chips = tn && tn.voiced`);
rep(`      if (!out.ok) {                                       // the provisional face stays; nothing is said
        tn.failed = true;
        settleTried(tn, false);
        ensureSurvey();
        return;
      }`,
`      if (!out.ok) {                                       // the provisional face stays; nothing is said
        tn.failed = true;
        settleTried(tn, false);
        pushChips();                                       // the trial chips are withdrawn: no answer will come for them
        ensureSurvey();
        return;
      }`);
rep(`      tn.failed = false;
      const job = startAssess(b, trial);`,
`      tn.failed = false;
      pushChips();                                         // the trial chips are back with the second attempt
      const job = startAssess(b, trial);`);

// ---- item 1: a forced move leaves no great moment
rep(`    const cat = pending ? null : sample.final.cat;
    const built = commented ? entry.built : null;
    const packet = built ? built.packet : null;
    const more = built ? built.more : null;
    game.memory.noteMine(index, { move: ply.notation, cat: /** @type {Cat} */ (cat), waited, self: sample.self, packet, more });`,
`    const cat = pending ? null : sample.final.cat;
    const built = commented ? entry.built : null;
    const packet = built ? built.packet : null;
    const more = built ? built.more : null;
    // A forced move (at most two legal moves) leaves no 'great' moment (CONTRACT-NOTES 138). The brief holds the true count;
    // without a brief the table's count stands in (0 = not known, which is not taken for forced).
    const legal = b && b.turn ? b.turn.n : sample.legalCount;
    const forced = legal >= 1 && legal <= FORCED_MOVES;
    game.memory.noteMine(index, { move: ply.notation, cat: /** @type {Cat} */ (cat), waited, self: sample.self, packet, more,
                                  ...(forced ? { forced: true } : {}) });`);

// ---- item 2: no smirk at his own win
rep(`    // He never gloats (CONTRACT-NOTES 113): a move that ends the game shows his mood only; the over line follows anyway.
    rivalSay({ kind: 'moved', gaveCheck: ply.flags.check, tacticLanded, punishesChild }, moveNo(index), state.phase === 'over');`,
`    // He never gloats (CONTRACT-NOTES 113, 138): on the move of his that ends the game he is calm, whatever rivalReact would
    // show for it (a mate that lands is a tactic that landed: \`smug\`), and says nothing; his over line follows as always.
    // rivalReact is still asked, so that the random stream of a game does not depend on how it ends.
    rivalSay({ kind: 'moved', gaveCheck: ply.flags.check, tacticLanded, punishesChild }, moveNo(index), state.phase === 'over' ? 'calm' : undefined);`);


// ---- rivalSay: a fixed mood
rep(`   * @param {Parameters<typeof rivalReact>[0]} ev @param {number} rivalMoveNo @param {boolean} [moodOnly]
   */
  function rivalSay(ev, rivalMoveNo, moodOnly) {
    const r = rivalReact(ev, { rivalMoveNo, lineAt: game.budgets.rivalLineAt }, rng);
    if (moodOnly) {
      stage.rival({ mood: r.mood });
      return;
    }`,
`   * @param {Parameters<typeof rivalReact>[0]} ev @param {number} rivalMoveNo
   * @param {boolean|'calm'} [moodOnly] true: his mood without a line; 'calm': no line and a calm face, whatever the mood would be
   */
  function rivalSay(ev, rivalMoveNo, moodOnly) {
    const r = rivalReact(ev, { rivalMoveNo, lineAt: game.budgets.rivalLineAt }, rng);
    if (moodOnly) {
      stage.rival({ mood: moodOnly === 'calm' ? 'calm' : r.mood });
      return;
    }`);
fs.writeFileSync(p, s);
console.log('ok 2');
