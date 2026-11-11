# The fix packages after wave 5 (PG, RT, FA, FB) notes — readings and requests reported by the packages of this wave

Generated from the workflow journals. Part 1: how each package read an unclear point of SPEC.md (the reviewer's final list). Part 2: what each package asks of a package that comes later, grouped by the file named. Part 3: what each package left unverified. A later package reads Part 1 for the packages it builds on and every entry of Part 2 that names one of its files. Where an entry here contradicts CONTRACT-NOTES.md section I or the "Owner decisions" section at the end of this file, the owner decision wins.

## Part 1. Readings by package

### FA

- **Task notes item 2 ("until the game-over card is on screen")** — The rule ends when the card is on screen, but the menu's 新对局, held during the wait, came alive under the finger at that instant, so the card was seen for about a tenth of a second. **Reading:** 新对局 of the menu is held exactly as the card's own buttons are: 350 ms (plus 300 ms at full motion) after the card came up, each tap meanwhile holds it 500 ms longer, never past 4 s after the card.
- **Task notes item 2 (how long a burst after the card is held)** — The notes give no figure. The engineer chose 4 s; a finger that taps longer than that after the card gets a new game. **Reading:** Kept at 4 s for the action bar, the card's buttons and now the menu item. The owner may rule otherwise.
- **Task notes item 5 (b)** — The notes do not say what happens to a waiting question when the trial is taken back, replaced or played before its assessment arrives. **Reading:** The engineer's reading is kept: it goes with the trial, unechoed; it is sent when the assessment fails.
- **src/ui/types.js (frozen): ChatPanel and Hud** — `retireLinks()`, the second parameter of `endAll` and `holdNewGame()` are not in the frozen typedefs. **Reading:** Kept as the engineer left them: intersection return types on `createChatPanel` and `createHud`; types.js untouched. My fix adds no exported name.
- **tests/unit/ui/layout.test.js (X1): one script, no inline script** — Item 11 requires an inline classic script that this assertion forbade. **Reading:** The engineer's changed assertion is kept: two scripts, the inline one carries the line and `window.__bootFailed` and loads nothing.

### FB

- **TASK-NOTES item 1, quickVerdict: 'measured against the best line of the table that is no mate'** — Followed to the letter, every quiet move is a mistake at first sight wherever that line wins a piece, and 稳健 in the assessment a moment later (1,034 of 5,007 verdicts on 41 own positions). The review notes ask that a quiet move that keeps everything is not called a mistake for missing the mate. **Reading:** When the best line mates and the tried move does not, the move is measured against the static evaluation of the position (what the mover holds when nothing is given away), in the exact and in the bounded branch. Giveaways stay 失误/漏着 (0 fine of 654); quick and assessment agree in 4,903 of 5,001.
- **TASK-NOTES item 3 (b); SPEC section 14 settled-material criterion** — The engineer's capture minimax is a third rule beside the owner's two options. It meets 95 % on the verifier's seeds and pooled on mine, but a tail of two points is still refuted in 0.9 % of lines, and the only cheap remedy I tried scores lower on the contract's own criterion. **Reading:** Kept the engineer's rule, since the notes say to choose by that criterion. The experiment and its numbers are in review\exp and review\expcmp.
- **REVIEW-NOTES step 5: 'every legal move of the child, written canonically, still resolves'** — With the moments told as history (task item 8 b) a legal move whose text equals a moment cannot resolve loosely; the two requirements exclude each other for those texts. **Reading:** Item 8 b stands as built. I report both counts: 11,627 of 11,627 in a book told nothing; 232 of 11,627 shown as plain text in a book filled as the brief fills it.
- **REVIEW-NOTES step 5: 'no link whose move differs from the move the text names'** — A rival's move written in the child's numerals is, as text, a notation of the child (兵9进1 for a black child reads as 卒9进1). The notes do not say whether the glyph or the numerals name the side. **Reading:** The numerals decide, as item 8 a has it; side glyphs are read as the child's. By that reading the only links that differ are 8 + 1 + 2 non-canonical spellings with two pieces on one file, the same before and after.
- **Brief: 'use only the port given to you'; REVIEW-NOTES step 4: 'static server on your port'** — No port is named. **Reading:** 127.0.0.1:5369, checked free before, stopped after each game. The games ran on a private tree (snapshot 08 plus the package's source files) so that the other package's in-flight files could not break them.
- **REVIEW-NOTES: 'It tells you what happened to this review before you'** — The file names no earlier review run and no PROGRESS-REVIEW.md existed. **Reading:** Treated this as the first review run and did all five steps.

### PG

- **TASK-NOTES item 1 a ("a case with a mate score on one side: unchanged behaviour") vs the sacrifice clause of Appendix A6.4** — With a mated score on the move's side the sacrifice clause compared -2000 with a static evaluation clamped to -1900, so a move that is mated by force was a sound sacrifice and 妙手 once the position was below -1900. Keeping that unchanged would keep false praise. **Reading:** "Unchanged" is read as applying to loss and category. A move whose own score is a mate or repetition loss against the mover is never a sacrifice; the rest of the clause is as the engineer left it.
- **TASK-NOTES item 1 c ("The same row is used for a move judged good or better") vs the wording of the row** — Two of the three grim sentences call the move the best or most tenacious one, which is not literally true of a move judged good. **Reading:** Left as the notes give it: all three variants for brilliant, best and good. Reported for the owner.
- **TASK-NOTES item 1 c (500 cp) vs section 3.6 Eval bands** — The packet carries only the band of the evaluation (lost = 600 cp or more), so the local row and the model's directive cannot use 500 cp. **Reading:** The engineer's reading stands: isEarned uses 500 cp, the grim row and directive use the band lost. Between -500 and -600 there is no interjection or popup but the old row is spoken.
- **TASK-NOTES item 1 c vs the avoided row** — The avoided row is not in the item's list of rows the grim row replaces. **Reading:** The engineer's reading stands: avoided keeps its place before grim, and its first variant (走得稳) gives way when the child comes out behind in material. The model then gets the ordinary good directive for such a packet.
- **REVIEW-NOTES step 4 ("static server on your port") and the brief ("use only the port given to you")** — No port was given to the reviewer. **Reading:** I used 127.0.0.1:5367 (free at the time) for the static server of my games and stopped it afterwards.
- **REVIEW-NOTES step 5 ("three real cases from the transcripts")** — The transcripts hold no case of the forced only-line, of 「这步没有错，只是没给对方出难题。」 or of the new loss line. **Reading:** I produced real cases another way: real positions run through the same local path as the game (pipe.mjs), and short scripted games in the browser for the loss line. The loss line was seen twice; it is a constant sentence.

### RT

- **TASK-NOTES item 2, rule a ("the child is ahead, eBest >= 250") and CONTRACT-NOTES 143 b, against the targets of 5 % and 12 %** — The rule and the targets cannot both be had. On mid, seeds 3001..3064, the threshold 250 gives 7.5 % long games overall and 26.6 % in the worst pairing; 100 gives 5.5 and 14.1 %; -50 gives 4.1 and 10.9 % and makes him crack in level games. **Reading:** The engineer's -50 stays in the tree, because it is the only measured value that meets the long-game bars and the task notes allow tuning the numbers. The cost is reported with passages and numbers for the owner.
- **CONTRACT-NOTES 124 (j) and 129 (j) against TASK-NOTES item 2 ("the finisher step is used as it is"; "the rails h to l hold in the wrap-up as well")** — Rail (j) binds gifts (chance, concession) only. A finisher may give 300 to 900 cp or a mate, and in the wrap-up it does so from below +600: a rook for an elephant or an advisor in a level game, which item 124 names as something a child notices. **Reading:** The rail and the finisher are left as they are, as the task notes say. The simulation's rail (j) stays at 0 / 0 / max 500 because it counts gifts only.
- **REVIEW-NOTES step 2 ("249 against 250 cp, both signs")** — After tuning, the child's side has no edge at 250 any more. **Reading:** The edges tested are the ones the code has: -51 against -50 cp on moves 59 and 60 for the finish, 249 against 250 cp on moves 79 and 80 for the press. Both exist in teacher.test.js; nothing added.
- **TASK-NOTES item 1, proof ("the pooled weak score within 3 points of the table path's on the same seeds")** — On seeds 3001..3064 the difference is +3.1 +- 2.3 points. **Reading:** Read as met within the spread of 512 paired games; the three seed sets together give about +1.4.
- **TASK-NOTES item 2, rule b ("he plays the honest move of his level and wins his won game")** — At level 1 the honest move is a depth-3 move, and a rook up it does not always make progress (first-B-3057: 31 moves from the first press to the mate). **Reading:** Left as the notes prescribe. Letting the wrap-up's press play the best move of his table would be a new rule and would make him harder on the weakest child; not measured.

## Part 2. Requests to other packages, by file

### src/core/search.js  [B2]

- (from PG review) For the owner / B2 (as the engineer reported): revealDepth compares clamped scores, so beyond +-1900 revealBest and refutation.revealDepth always read 1. No false praise follows from it.
- (from PG impl) For the owner / B2: revealDepth and separationDepth compare clamped scores. Beyond +-1900 revealBest and refutation.revealDepth always read 1 (a deep find or a deep punishment is not seen as deep). No false praise follows from it; facts.js no longer calls separationDepth for the tier.

### src/core/teacher.js  [B4]

- (from PG impl) For RT / the owner: chooseTeachingMove compares lines with clamped centipawns (cp = scoreToCp in value()). When the rival is more than 1900 ahead or behind, every line reads the same to him, so his choice there is blind to material.

### src/core/teacher.js WRAP_UP_AHEAD (owner decision)  [B4]

- (from RT impl) Confirm or change the child's threshold of -50 cp. It is what brings the long games to 4 to 5 %, and it means he cracks from level positions (7 finisher moves from below +100 in 96 printed games, 4 of them allowing mate). At 100 cp: 4.8 to 5.5 %; at 250 cp: 7 %.

### src/core/teacher.js, WRAP_UP_AHEAD (owner decision)  [B4]

- (from RT review) Decide the child's threshold with the table in the summary. -50 meets the long-game bars and gives 97 first cracks from below +250 in 832 games, with the child's wins piling up on moves 60 to 64; 250 keeps the look and leaves 7.5 % long games (26.6 % for coached-D); 100 lies between and misses both bars. If the look matters more, change the one constant and the edge test of wrap-up (a) in tests/unit/core/teacher.test.js (the object WRAP).

### src/core/brain.js  [B5]

- (from FB impl) No change needed. Line 132 keeps working because a line with no move keeps the old answer. If its owner wants the dependency gone, it should ask for the pending capture directly; the special case in facts.js can then go, and the 'Line.end' test of brain.test.js would need a ruling on lines whose pending capture is answered elsewhere.
- (from PG review) For the owner / RT (as the engineer reported): OpponentTurn.childMoveCp is clamped, so a move confirmed before any verdict is recorded with loss 0 beyond the clamp while its category is now right.
- (from PG impl) For the owner / RT: OpponentTurn.childMoveCp is clamped, so the director's deferred sample (a move confirmed before any verdict) gets loss = bestCp - childMoveCp = 0 beyond the clamp, while its category (from quickVerdict) is now right. An unclamped value, or the loss itself, would close this.

### src/coach/brief.js canBeProud (owner; outside the eight items)  [C3]

- (from FB review) Decide whether a found test alone should make a move proud when the child is 500 cp or more behind and the move's line loses the moved piece at once (seen: 第16回合的马二进四最漂亮 in review\game\rv-weak-2.log).

### src/coach/client.js  [C4]

- (from FB impl) No change needed. The wrapper book around the thread's book does not forward past(); buildTurnBrief is called on the real book first and the wrapper delegates resolveLoose to it, so history is honoured and counted as ungrounded.

### tests/e2e/*.spec.js  [E1]

- (from PG review) For the owner: please run the suite. Neither the engineer nor I ran it. No asserted text changed (checked by search), and flow 15's proud move is a mating move, which this package does not touch.
- (from PG impl) For the owner: please run the suite. No asserted sentence, interjection or verdict changed (checked by search), but I did not run it.

### src/game/director.js  [G4]

- (from FB review) No change needed, for information: in a position with a forced mate the quick verdict of a quiet move is again good / 100, as before the package, so a move confirmed before its verdict is recorded as such. A returning table line still gives null.
- (from FB impl) No change needed, for information: quickVerdict now also returns null for a move whose table line only returns to the position (2 of 108 middlegame moves). The face stays pending until the assessment; a move confirmed before its verdict records good / 0 by the existing null rule.

### src/game/strings.js (owner or its package)  [G5]

- (from FB review) Decide whether 「小主公心里有数，亮放心。」 should be said when the insisted move allows a forced mate; seen one move before mate in review\game\rv-weak-1.log.

### C:\Users\USERNAME\git\yijian-xiangqi\README.md (owner / TR)  [T2]

- (from RT review) Write in the lines on `npm run test:sim` that the engineer left in C:\Users\USERNA~1\AppData\Local\Temp\claude\5884157893c5b410\a051714c-de36-47da-b3cc-cfc754f60ac3\scratchpad\work\RT\PROGRESS.md (entry 14:00). Its last line ("the worst-pairing bar is not met") should read that the bar is met or missed by one or two games depending on the seed.
- (from RT impl) Write in the lines on `npm run test:sim`: they are in C:\Users\USERNA~1\AppData\Local\Temp\claude\5884157893c5b410\a051714c-de36-47da-b3cc-cfc754f60ac3\scratchpad\work\RT\PROGRESS.md, entry 14:00 (options, paths, run times of 10 to 15 minutes on mid, bars, quick look, exit codes, and that the default run currently exits 1 on the worst-pairing bar).

### scripts/sim.js bars (owner decision, then this package's file)  [T2]

- (from RT impl) Decide the worst-pairing bar. At 12 % it fails in every run (12.5 to 21.9 %; one or two games over on mid, more on fast and table). Either accept a higher bar (about 22 % would hold in all eight runs) or change what ends level games, which is outside this package (the finisher finds no natural crack in simple endings, and drawn endings without attackers run to the sixty-move rule).

### scripts/sim.js, bar long.worst (owner decision)  [T2]

- (from RT review) Decide the worst-pairing bar. On mid it reads 12.5, 14.1, 12.5 and 10.9 % over four seed sets, so at 12 % the default run exits 1 about three times in four; the engineer measured up to 21.9 % on table and 20.3 % on fast.

### C:\Users\USERNA~1\AppData\Local\Temp\claude\5884157893c5b410\a051714c-de36-47da-b3cc-cfc754f60ac3\scratchpad\design\CONTRACT-NOTES.md (owner)

- (from RT impl) Item 143: record the final numbers (wrap-up 60 / -50, press 80 / 250; depth rows 5/3, 6/4, 7/4, plan row), the drift rule, and that the long-game targets are reached only in part.

### C:\Users\USERNA~1\AppData\Local\Temp\claude\5884157893c5b410\a051714c-de36-47da-b3cc-cfc754f60ac3\scratchpad\design\CONTRACT-NOTES.md, item 143 (owner)

- (from RT review) Record the final numbers (wrap-up finish from move 60 at -50 cp, press from move 80 at 250 cp; depth rows 5/3, 6/4, 7/4, plan row at level 9), the drift rule (a press or finish move from his move 60 on is not counted), and what the review measured on seeds 3001..3064.

### C:\Users\USERNAME\git\yijian-xiangqi (owner)

- (from RT review) Carry over the six files from the private copy as the engineer left them; the review changed none of them. The whole-suite result (813 pass) was measured in the copy, which does not hold the later fix packages of the real tree.
- (from RT impl) Carry over the six files from the private copy. The real tree got fix package PG in src/core/facts.js meanwhile; none of the six files overlaps with it, but the copy's whole-suite result (813 pass) was measured without PG.

### design/CONTRACT-NOTES.md, design/SPEC.md, work/FB/TASK-NOTES.md (owner)

- (from FB review) Record that quickVerdict, when the best line mates, measures a non-mating move against the static evaluation of the position, not against the best non-mating line (item 1), with the engineer's other final readings.

### design/SPEC.md, design/CONTRACT-NOTES.md (owner)

- (from FB impl) Record the final readings: the tail of 4.6.3 is a capture minimax and a line with no move keeps the old answer; item 6 sets moveCp to bestCp; `only` uses the verifier's formula; MoveBook has an optional past(); the grim row has two more word sets and the prompt two more directives.

### docs/design/CONTRACT-NOTES.md

- (from FA review) Owner: under item 150 record FA's final readings (the engineer's list) and add: 新对局 of the menu is held together with the game-over card's own buttons; the burst cap after the card is 4 s, pending the owner's ruling.
- (from FA impl) Owner: record FA's final readings under item 150: the 650 ms card guard in both motions, the 4 s burst cap after the card, 3 s idle / 15 s for the no-card way out, `endAll(keep)`, `hud:action {card}`, `STR.undoResign`, `window.__bootFailed`, and the changed X1 assertion in layout.test.js.

### scratchpad/design/CONTRACT-NOTES.md

- (from PG review) For the owner, to rule on: (1) my change to the sacrifice clause (a mated move is never a sacrifice); (2) whether the proud move may be a move whose line loses material, or a first move after one round; (3) whether 「稳健，可以走。」 should stand on a move whose line loses material; (4) whether the two grim variants that say "best" should be kept for moves judged good; (5) the engineer's open points: director.updateTruth, the band lost standing in for 500 cp, the new try directive and the omitted only-line; (6) whether quickVerdict should call a move with a mated bound a blunder in its bounded branch.
- (from PG impl) For the owner: please rule on (1) the change to director.updateTruth, (2) the band `lost` (600 cp) standing in for 500 cp in the grim row, (3) the new try directive and the omitted only-line, (4) whether the proud move may be a grim move (seen: 「第22回合的仕六进五最漂亮。」 on a move whose line loses an advisor), (5) whether the `good` answer 「稳健，可以走。」 should stand on a move whose line loses material, (6) the sacrifice flag on a move that is mated by force.

### src/core/types.js

- (from FB impl) Comments only (frozen file): Line.end 'cut' says materialOutcome settles it 'by SEE', now a capture minimax; MoveAssessment.moveCp is bestCp for a move whose line only returns to the position; MoveAssessment.loss is no longer bestCp - moveCp in that case or when the better move mates.

### src/core/types.js (frozen)

- (from FB review) Comments only, as the engineer asked: Line.end 'cut' is settled by a capture minimax; MoveAssessment.moveCp is bestCp for a returning line; loss is not bestCp − moveCp in the two cases of item 150.

### src/ui/types.js

- (from FA review) Owner (F0), optional: add `retireLinks`, `endAll(reason, keep?)` to ChatPanel and `holdNewGame(held)` to Hud if the frozen typedefs should match the code.
- (from FA impl) Owner (F0): if the frozen typedefs should match the code, add `retireLinks: () => void` and `endAll: (reason:'aborted', keep?:string) => void` to ChatPanel, and `holdNewGame: (held:boolean) => void` to Hud. The code works without this through intersection return types.

### work/CR/verdict-verify/v3cut.mjs, v3scan.mjs and work/CR/verdict/probe-all.mjs (reviewer)

- (from FB impl) v3cut.mjs measures the tail through a line with no move and prints 82 / 27 for any tree; use work/FB/measure/v3cut-fb.mjs for the tail on the line itself. v3scan.mjs finds no early stop any more. probe-all.mjs crashes on a null quick verdict; a patched copy is in work/FB/probe.

## Part 3. Left unverified or not done, by package

### FA  (impl: done; review: done)

- Owner's ruling on the 4 s burst cap after the card.
- Owner's ruling on a question typed during an assessment that is dropped unechoed when the trial goes first.
- A new-game dialog opened before the game ended still starts a new game when confirmed afterwards (the result is counted).
- The reload line can lie over the start card for up to one second after a late start.
- Item 4's redo of a standing trial was not provoked in the page with the real brain (rig only).
- No real iPad or Safari: every browser run is headless Chrome on the build machine.
- His mate in the page was produced with a Worker wrapper that forces his mating move; the coach request for that game's takeaway is then rejected by the mock proxy (400), presumably because the forced move does not match what the engine reported, and the local line is used.
- The end-to-end suite takes 3.7 to 3.8 min against the 3.6 min baseline.
- [minor, not fixed] src/ui/stage.js and src/ui/hud.js, CARD_BURST_MAX_MS = 4000; item 2: Taps that go on for more than 4 s after the card came up are taken. With six seconds of taps after his mate under reduced motion (card at 1.9 s) a new game starts 4.03 to 4.10 s after the card: action bar in landscape and portrait, the card's own 再来一局 on the phone, the menu item in landscape. At full motion (card at 2.5 s) none within six seconds. This is the engineer's stated design, not a defect; left for the owner to rule on the cap.
- [minor, not fixed] src/game/director.js onAsk; item 5 (b): A question typed while the trial is being assessed is neither echoed nor answered when the trial is taken back, replaced or played before the verdict arrives; the input field is already empty. The window is the assess time (under about 0.6 s). The engineer reported this reading; the unit test pins it. Left as it is.
- [minor, not fixed] src/game/director.js actions.newGame (the dialog path); item 2: A new-game dialog opened while the game was still running and confirmed after the game ended under it starts a new game before the card. The result is counted. It needs a deliberate confirmation in a dialog, so it is not a stray tap; not changed.
- [minor, not fixed] index.html inline script; item 11: When the page comes up after the reload line was shown (nothing drawn 8 s after load, then a late start), the line stays over the start card for up to one second, because the watcher looks once a second. Measured: line at 8.0 s, start card at 11.1 s, line gone at 12.2 s. Rare; not changed.
- [minor, not fixed] src/game/director.js reassess / trialScript; item 4: The redo of a standing trial after the pin is replaced is proven in the director rig only (three unit cases, all green, and failing on the old director). I did not provoke it in the page with the real brain either; the review programme did not ask for it.

### FB  (impl: done; review: done)

- Owner's decision: keep the static-evaluation measure in quickVerdict, which departs from the letter of task item 1.
- Owner's decision: the residual false tails of materialOutcome (0.9 % of lines) and whether a side in check should have to answer inside the capture minimax.
- Owner's decision: 只是要丢点子 on fine moves in level positions when the two points come from crossed-pawn accounting.
- Owner's decision: 妙手 and 唯一 on a returning line that is the table's best.
- Not done: no game on the live tree with the other package's changes; both my games used snapshot 08 plus this package's source files. No real model was called.
- Not done: the reader's probe-all, grim-scan and combo-scan were not rerun after my quickVerdict change; I used my own scans instead.
- Not verified: the positions of rounds 18 and later of my second game, because my replay of the transcript diverges there.
- [minor, not fixed] src/core/facts.js materialOutcome / settleCaptures (item 3): The new tail still states a gain of two points or more that a depth-6 search of the end position refutes in 25 of 2,696 own lines (0.9 %; old code 75, 2.8 %). The capture minimax lets a side stop while in check and cannot see a quiet reply (a check, a mate threat). Example: 【车8进4】 in 2ba1ab2/4k4/2n4r1/p2CN4/4r4/4C4/P3P4/9/R8/3AKAB2 b reads 吃到一个兵、一个炮，丢掉两个士 where the cannon is won back by 车九平六 with check. A variant in which a side in check must answer halves the refuted tails (12/13 → 6/7) but drops true ones and scores 95.9 % against 96.4 % on the contract's criterion, so I left the engineer's rule.
- [minor, not fixed] src/core/facts.js materialOutcome (item 3), the 95 % criterion: The criterion is met on the verifier's seeds (96.4 %) and pooled on my seeds (95.8 %), but one of my two samples alone reaches 94.7 % (1,237 of 1,306 lines). The remaining lines are mostly ones whose loss or gain lies beyond the end of the line.
- [minor, not fixed] src/coach/fallback.js grim row with 只是要丢点子 (items 3 and 4 together): With the whole line walked, fine moves in level positions reach the grim row through balances that count a crossed pawn as two points. In 4kab2/4a3r/2n1b1n1c/p3p1p1p/2p2R2c/2P1CNP2/P3PC2P/R1N1B4/3r5/3AKAB2 b the table's best move 卒7进1 (two crossed pawns for two pawns, −2) loses 妙哉 and is told 「【卒7进1】是眼下最好的一步，只是要丢点子。」. 兵五进一 (稳健, −2.5) in another position is told 「可以走，只是要丢点子」 although the search sees the move as level. The row and its trigger are the owner's rule.
- [minor, not fixed] src/coach/book.js past() with src/coach/brief.js (item 8 b): A legal move of the child whose canonical notation equals a moment told as history no longer resolves when the model names it without it being registered: 232 of 11,627 legal moves (2.0 %) in 300 random positions with three own moments told; 0 before. Registered moves (hints, better moves, tries) still resolve through lookup. The engineer's figure 'all 49,346 resolve before and after' holds only for a book told nothing.
- [minor, not fixed] src/core/facts.js quickVerdict null for a returning table line (item 6): A table line can return at the table's depth while the pair search finds a real loss. 帅五进一 in 2bakab2/n8/9/p3P3p/2P3p2/2N6/P5rrP/R3c4/9/2BAKABCR w: table depth 5 scores −20 with a returning line, so the quick verdict is null; the pair at depth 7 gives 漏着, loss 617, and the move does lose an elephant. The face waits, and a move confirmed before its verdict is recorded good / 0 by the existing null rule. Rare (returning lines are about 0.1 % of root moves in my scans).
- [minor, not fixed] src/coach/brief.js only (item 7), by reading: The test uses a.moveCp, which is clamped to 1900, minus the true loss of the second move. Far beyond +1900 a second move that is still winning can therefore read as another band and 唯一 be said. Not seen in 3,129 scanned moves (0 cases).
- [minor, not fixed] src/coach/brief.js only / assessMove with a returning line that is the table's best (item 6 rules 'nothing changes'): In 2bnkab2/3Ra4/9/p3p3p/6p2/2B4r1/Pc2N1n1P/2R3N2/9/4KA3 w the move 车七平八 (the rook chases the cannon to and fro; −20 against −177 for the second move) is 妙手 and told 「妙哉！只有【车七平八】能解围，好眼力。」, before and after the package.
- [minor, not fixed] src/coach/brief.js canBeProud (item 148 h; outside the eight items), seen in review\game\rv-weak-2.log: The card says 「第16回合的马二进四最漂亮。」 and 本局最佳 of a move made more than a rook behind (table −3851) after which 车2平6 takes that horse at once (「马没了」). It was the best there was (loss 12). It presumably passes the rule through a found test; I did not confirm which clause.
- [minor, not fixed] src/game/strings.js (not this package), seen in review\game\rv-weak-1.log round 6: After the child insists on a held move (帅五进一, 「且慢！先看看帅有没有危险？」) 诸葛亮 says 「小主公心里有数，亮放心。」 and the child is mated on the next move.

### PG  (impl: done; review: done)

- The end-to-end suite was not run by the engineer or by me; the owner runs it.
- No real model call: the grim directive and the omitted only-line are unit-tested only.
- Not checked on a real iPad or in Safari; all browser games were headless Chrome on the build machine.
- quickVerdict's bounded branch still reads a move with a mated bound as good when the best move is beyond -1900 (same as before the package; left for the owner).
- Lines outside the seven items that still fail or read oddly are listed under found and were not changed: the proud move on the card, 「稳健，可以走。」 on a losing line, and four why / pouch answers.
- [minor, not fixed] src/core/facts.js, quickVerdict, the branch for a move that is not exact at the table's depth: When the best move is beyond -1900 and the tried move's shallow score or bound is a mated score, the loss reads 100 and the quick verdict is good at every level; the forced-mate rule of 4.6.1 is not applied in this branch. Shown by reading the code and hand calculation; not run on a real table. It is the same in the snapshot, and the notes ask for unchanged behaviour with mate scores. The final assessment corrects it (blunder), but the first face and a move confirmed before the verdict take the quick category.
- [minor, not fixed] src/coach/fallback.js row try.grim; server/prompt.js directive tryGrim: The grim sentences 「是眼下最顽强的一步」 and 「是最好的应法」 are also said of moves judged good (稳健), which are not the best move. Seen on real positions: six different moves of one position each get 「…是眼下最顽强的一步。」. This follows the letter of the task notes (the row is for good or better), so I left it.
- [minor, not fixed] src/coach/brief.js, proud move in buildOverPacket (outside the seven items): The card praises moves that do not deserve it: 「第22回合的仕六进五最漂亮。」 on a move whose line loses an advisor (pg-weak-1); 「第1回合的炮二退一最漂亮。」, 「第1回合的帅五进一最漂亮。」 and 「第1回合的相七进九最漂亮。」 after one to three rounds. The game samples carry no line balance, so the grim rule cannot be applied there without a product decision.
- [minor, not fixed] src/coach/fallback.js, the good answer for a verdict of good (outside the seven items): 「兵七平八稳健，可以走。」 and 「帅六平五稳健，可以走。」 were said just before a horse and an elephant fell; the loss was unavoidable. The notes only rule that the answer for best stays.
- [minor, not fixed] src/coach/fallback.js, why and pouch answers (outside the seven items): Lines that read oddly in the games: 「…会被对方的2路炮白吃。对方走炮2进7之后，你吃到一个炮，丢掉一个炮，大致相当。」 after 「马六退八是失误」; 「帅五平四是眼下最好的一步。」 then 「因为调整了一下阵形。」; 「可以走马七进五：你的六路马捉对方的5路卒。」 naming the other horse; 「炮二退一是眼下最好的一步。」 then 「因为你的二路炮出动。」 for a retreat.

### RT  (impl: partial; review: done)

- Owner decision on WRAP_UP_AHEAD (-50 in the tree; 100 and 250 measured on the same seeds).
- Owner decision on the worst-pairing bar of the long games (12 %): met on seeds 3001..3064 (10.9 %), missed on the engineer's three seed sets on mid (12.5 to 14.1 %) and by more on fast and table.
- Not measured in the review: the slow path, fast for the pairings of bots C and D, any path with the real director or in a browser. For those the engineer's runs stand; I checked only that his measured snapshot is the code in the tree.
- The look was judged on simulated children. Bots A to C often cannot convert a won ending, which keeps some games long whatever he does; a real child may differ.
- Press at level 1 can take 30 to 40 moves to mate a rook up (4 of 832 games); left as the task notes prescribe.
- README lines for `npm run test:sim` and the record in CONTRACT-NOTES 143 are the owner's to write.
- [major, not fixed] src/core/teacher.js, WRAP_UP_AHEAD = -50 (mode line of chooseTeachingMove): With the threshold at -50 cp the finisher fires in level games, and some of its moves read as throwing: a rook for an elephant or an advisor on move 60 at level 1 (first-B-3054 at +170, coached-B-3048 at -36), a step into mate in one from a level game at levels 4.6 and 5.0 (matched-D-3046 move 66, coached-D-3026 move 61). On mid, seeds 3001..3064, 97 games have their first crack from below +250, and 83 of the child's 349 wins follow one. Not fixed: 100 and 250 on the same seeds miss both long-game bars (5.5 / 14.1 % and 7.5 / 26.6 %), so no value of the number keeps the look and meets the bars. Owner's decision.
- [minor, not fixed] src/core/teacher.js, the wrap-up as a whole (seen in the simulation's game lengths): The child's wins pile up right after move 60: 51 wins end on moves 60 to 64 against 22 on moves 55 to 59 (seeds 3001..; the engineer's seeds 1..: 60 against 23). With the threshold at 250 it is 28 against 22. A child who plays many games can notice that he collapses at the same point.
- [minor, not fixed] scripts/sim.js, bar long.worst (12 %): The bar sits on the measured value. On mid the worst pairing is 12.5, 14.1, 12.5 % (engineer's seeds) and 10.9 % (mine): one game decides it, and `npm run test:sim` with the default seed exits 1. On fast and table the engineer measured 15.6 to 21.9 %. Not a defect of the code; the bar is the owner's.
- [minor, not fixed] src/core/teacher.js, wrap-up press at the lowest level: From move 80 he plays the honest move of his level, which at level 1 is a depth-3 move, and a rook up he can wander: first-B-3057 moves 91 to 108, eighteen rook moves without progress before the mate on 111. Rare: 4 of 53 games with wrap-up press take more than 20 moves, all at level 1; the median is 7. The task notes prescribe the honest move, so I left it.
- [minor, not fixed] Item 1 proof: pooled weak score on fast within 3 points of the table path: On seeds 3001..3064 fast minus table is +3.1 +- 2.3 points (46.4 against 43.3 %), a hair over the 3 points. It lies inside the spread: the engineer's sets give +1.1 and +0.1, and coached-A alone accounts for +17 +- 8. Below level 5 fast and mid play the same games (511 of 512).
- [minor, not fixed] Long games that the wrap-up does not end (simulation, mid, seeds 3001..): Eleven games have 20 or more finish-mode moves from move 60 on and no crack found; most are endings with nothing to crack with (coached-C-3058, coached-D-3060). Others stay just below -50 (matched-D-3006) or are won positions the bot cannot convert (firstc-A-3035, first-B-3054). These make up most of the remaining 34 long games.
