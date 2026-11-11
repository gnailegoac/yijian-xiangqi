# Wave 3 notes — readings and requests reported by the packages of this wave

Generated from the workflow journals. Part 1: how each package read an unclear point of SPEC.md (the reviewer's final list). Part 2: what each package asks of a package that comes later, grouped by the file named. Part 3: what each package left unverified. A later package reads Part 1 for the packages it builds on and every entry of Part 2 that names one of its files. Where an entry here contradicts CONTRACT-NOTES.md section I or the "Owner decisions" section at the end of this file, the owner decision wins.

> NOT FINAL: still running when this was generated: impl:BT, review:C3, review:B5

## Part 1. Readings by package

### B5 (implementer report only)

- **§4.8.2 assess, §4.6.1 (allows a forced mate); WAVE1-NOTES Part 2 'src/core/brain.js'** — §4.8 never asks itself whether a move allows a forced mate; assessMove reads it from the pair score only. From depth 4 on the search saw every mate the checks-only search finds (701 of 701), and the quiet mates the B2 review counted are not found by that search either. A real gap exists elsewhere: the search scores the second occurrence of a game position as a draw (A3.4), so a mate the rival spared once is invisible when the child repeats the move. **Reading:** assess computes moveFacts for the tried and the comparison move. Where allowsMate is proven and the pair line shows no mate, that line goes to assessMove with score -(MATE - 2*in) and the mating line as PV; depth and byDepth stay the search's. Survey and opponent tables are left as the search returns them; threat and tension already use facts.mates.
- **§4.8.1 verifyMs ('all verify calls of one move, hard deadline'), §4.7.5 last paragraph** — Not said how the shared deadline maps onto the search's time control, nor what verify returns once the deadline has passed. **Reading:** Deadline = start of the selection + verifyMs. Each verify search gets timeMs = time left, so the search's hard deadline is the shared one; iterations up to minDepth always finish and the panic extension of A3.7 still applies. A call after the deadline returns null without searching. The line is returned unchanged; verify rejects only on cancellation.
- **§4.9 ('cancel without id: cancel whatever is running'; 'jobs posted before ready are queued')** — Nothing is said about a job that waits (for ready, or for the running job to unwind) when a cancel arrives, or about malformed and duplicate job messages. **Reading:** At most one job waits. A replaced waiting job gets `cancelled` at once. `cancel` with its id removes it; `cancel` without id cancels the running job and removes the waiting one; a cancel for any other id is ignored. A cancelled running job always answers `cancelled`, even if it had just finished, and sends no progress after the cancel. A job without a numeric id is answered with `error`; a job whose id is live is ignored; an unknown kind ends with `error`; a second `hello` answers `ready` again.
- **§4.9 last bullet, A3.8 (MessageChannel yield); CONTRACT-NOTES 21 (worker_threads wiring is B5's)** — The contract names only the MessageChannel yield and the browser worker, but the smoke test must run in worker_threads, where that yield does not reliably let parent messages in, and src/ may not import node modules. **Reading:** The yield is setImmediate where it exists (Node), else one reused MessageChannel, else setTimeout. Inside a Node worker thread the file wires itself to parentPort through process.getBuiltinModule('node:worker_threads'), which is not an import. Importing the file anywhere else still has no side effect.
- **§4.8.2 survey step 4 (deep table 'with the remaining time')** — Not said what happens when no time is left, when the shallow table already stopped on a mate score, or when the deep search does not get deeper. **Reading:** The deep search is skipped when the shallow table stopped 'mate' or surveyMs is used up. The result carries the deep table only when it is deeper, and only deeper iterations are sent as progress. With no legal move the table has no lines and the tension is computed with score -MATE.
- **§4.8.2 assess steps 1–4; §3.1 Line.end 'cut'** — Open points: a payload table that belongs to another position, the history for the replies search, which reply lines count, and when a PV line is 'cut'. **Reading:** The table is used only when its fen is the payload's position. moveFacts runs first, so an illegal move fails before any search. Replies are searched with history + the payload fen (empty after a capture) and are the lines exact at the final depth, at most three. A line is 'cut' when its PV has the full pvLength and a capture worth a pawn or more is pending in its last position, the same rule facts.js applies.
- **§4.8.2 opponent step 3 ('quality = verdict thresholds with k = 1 on choice.loss', 'tension as in survey')** — Not said whether the compression of §4.6.1 applies to quality, or which position and score feed the tension. **Reading:** The thresholds 300 / 120 / 50 / 15 are applied to choice.loss as it is. The tension uses positionFacts of the position after the rival's move (ply + 1), the child's score of the chosen line (min(score, upper) negated), evalNow = choice.evalAfter, and the payload's evalTwoPliesAgo and tensionPrev.
- **§4.8 (Brain, JobControl, planFor)** — Not specified: two jobs on one brain at once, progress for `analyze`, planFor for an unknown class. **Reading:** A new job takes the searcher over and the older one rejects with {cancelled: true}. `analyze` sends every completed iteration as progress ('table', result); assess and opponent send none. planFor throws RangeError for anything but 'fast', 'mid', 'slow'. PLAN is left unfrozen, as the F0 stub had it.
- **§14 ('no unit test depends on wall-clock speed') against §4.8 createBrain({ttBits})** — The brain's jobs are time-budgeted and createBrain has no way to inject a clock, a plan row or a speed class. **Reading:** No option was added. brain.js reads the global performance.now() at every use, as search.js does, and brain.test.js replaces that global with a virtual clock. The step during createBrain() selects the speed class.
- **A3.8, §6.3 (150 ms backstop)** — Stop latency is bounded only by one root-move subtree, which the brain cannot shorten. A stop over 150 ms makes tasks.js terminate and respawn the worker (transposition table lost). **Reading:** Implemented as specified: the brain yields between its steps and the search between root moves. Measured rate of stops over 150 ms: 1 of 1,118 on this machine, 0 of 245 at an emulated mid device, 1 of 245 at an emulated slow device.
- **§4.7.5 input ('allDepth >= 3') against §4.8.2 opponent step 1** — The literal request has no minDepth, so on an extremely slow device the table could stop at allDepth 2. **Reading:** The request is literal. In every measurement the table had allDepth >= 3, and teacher.js guards the smaller case.

### BF

- **§4.6.1 verdict table, row `brilliant`; CONTRACT-NOTES item 106** — The table still prints the old condition. Item 106 defines the exception as `capture.exchange === 'wins'`, which starts at +0.5 on the square and also covers captures that come with a check or fork (37 of the 102 changed moves give check or fork). **Reading:** Item 106 literally, as the engineer implemented it: the tried move's own capture with exchange 'wins' skips the only-move clause, whatever else the move does; 'even' and 'loses' captures and non-captures stay eligible. Now pinned in the tests at +1, +0.5 and -0.5.
- **§4.6.1 flags.sacrifice / Appendix A6.4 sacrifice_play; items 105 and 106 ('the sacrifice clause is unchanged')** — In positions clamped at +-1900 the clause praises plain give-aways, including moves that allow a forced mate; it is 81 % of all remaining 妙手 in my runs. It also fires for exchange offers. **Reading:** Left unchanged as instructed. Suggested for the owner: no sacrifice when |moveCp| >= 1900 without a mate (removes 914 of 967 hits in my runs and 86 of 177 in the engineer's), and none when the mover's next move in the line retakes on the square.
- **§4.6.1 `brilliant`: 'the move starts a forced mate of two or more moves'** — All mate scores are 2000 cp, so a slower mate has loss 0 and is 妙手 while a mate in one is on the board (98 of 140 hits). **Reading:** Left unchanged. Suggested: the mate clause only when no faster mate is known from the comparison move or the table (removes 107 of 140).
- **§4.6.1 flags.onlyMove ('the second-best root move is >= 150 cp below the best')** — The flag is a property of the table's first line, not of the tried move, and uses the raw gap while the verdict compresses losses in decided positions. With a table shallower than the pair, a move that is not the table's first line can be 妙手 by this clause. **Reading:** Left unchanged; flags.onlyMove was explicitly not to be touched. Suggested: in the brilliant test require the tried move to be the table's first line, and skip the clause when the second-best move is also beyond +-500.
- **§4.6.1 compression in decided positions with the +-1900 clamp of scoreToCp** — Beyond the clamp every move has loss 0, so nearly all moves of a lost position are 好棋 (98 % in my sample). The 0.4 / 0.5 compression never gets to act there. **Reading:** Left unchanged; reported only. It is the root of the clamped-sacrifice problem and wants an owner decision together with it.

### C3 (implementer report only)

- **4.14.2 better / toward, 4.14.1 chance.theme vs 3.4 Assessed, 3.5 TeachingChoice and the import rule of section 2** — better[].does, toward.theme and chance.theme need the move facts of moves other than the tried one. Assessed carries facts for the tried move only, TeachingChoice.chance carries a line only, and src/coach may not import facts.js. **Reading:** brief.js derives those effects itself with engine.js (private sketchFacts, then the same table): mate, mate threatened in one, check, capture with the exact exchange, new attacks, parries, blocked leg / eye, king flights, opened rook, crossed pawn, develop. Pins, deeper mate threats, forks with check are not derivable and give no effect. Measured agreement with real facts: 90.6 % identical, 95.6 % same lead. Proper fix: Assessed carries MoveFacts of `best` and the chance carries the facts of its first move.
- **4.14.1 opp.name ('the rival's opening code when it changed with this move')** — TurnReport carries no opening names and no move list; 4.8.2 says the director computes them, but no field passes them to brief. **Reading:** The rows of A6.4 are applied privately to the boards before and after the rival's move (from lastOpp.facts); rows that depend on the side's first move apply only on that first move (by ply). A code that reverts is not reported.
- **4.14.1 'registers moment moves', 9.1 'every notation on the wire is registered'** — Moment and GameMemory hold notations only, so a moment older than the last two plies has no squares; the same holds for `mine` when report.prev is null (after undo or reload). **Reading:** Registered: the rival's move, the overlooked capture, threat moves, the previous move with the reply line of its packet (when report.prev is given). Older moments and a memory-only `mine` are not registered; the markup falls back to resolveLoose or plain text.
- **4.14.3 table order vs the examples of 9.3 to 9.6, D-30 and the oppCaption comment** — The examples put develop before defend and open_rook and show 【马8进7】出子; the table puts rows 10, 11 and 14 before row 16. **Reading:** The table. Real: 马8进7 -> does [defend {opp P5}, develop {opp H7}], caption 【马8进7】起马局 (name horse_open); 炮8平5 -> [cannon_mount, develop].
- **Section 9 examples vs real engine output (worked position, depth 6, level 3)** — Several printed values are not what the engine gives. **Reading:** Engine facts kept. 9.5 try: cat blunder, loss 389 (printed mistake / 350); more.reply.moves [马7进5, 马二进三, 马2进3, 马八进七, 炮8平5]; better has two entries: {马二进三, gain 389, does [develop {me H3}], line [车9进2, 炮八平七, 炮2平3, 车九进二, 车1进2]} and {炮五平七, gain 389, does [cannon_mount {me C7, on opp P3, on2 me P7}], line null}. 9.4 / 9.6: does is [develop] only: the facts report no open_rook (the rook gains one move, the rule needs two); pouch 3 has alt 炮八平七. 9.7: 炮2平5 after 马二进三 gives does [quiet], not cannon_mount: the central pawn is guarded by the horse on 三. 9.8 is not from the worked position and its mat.cp 1150 does not match its own counts. 9.9: cur is the whole packet of the last try.
- **4.14.3 row 7 (pin) and walk_pin** — The facts list a pawn that has not crossed the river as pinned on its own file (A6.1 lifts the piece); it can only walk along that file, so 它一动后面的子就丢 is false. Seen: 炮二平一 -> pin {me C1, on opp P9, on2 opp R9}. **Reading:** Such a pin is not put into words (no pin effect, no walk_pin flaw).
- **4.14.3 flaw table** — Four rows gave false sentences on real positions: unguard for a piece the move only uncovered (炮六平八: 你的八路前炮一走，你的八路后炮就没人保护了); hang for a guarded piece (炮三平五: 你的五路炮没有保护，会被对方的5路卒白吃, a pawn guards it); bad_trade when the capturing piece is not taken back (炮三进四: 用你的三路炮去换对方的7路象, the rook is lost elsewhere); waste for a move with effects (炮2进7 captures a horse: 这步没有实际作用). **Reading:** unguard only when the moved piece was the guard, else hang; hang only when nothing can take back, else ignore_threat; bad_trade only when the capturing piece is taken in the line; waste only when does is [quiet]. Where the line loses a piece that was already hanging before the move, the flaw is ignore_threat (with `by` only when that piece also plays the reply). greedy is not added to a sound sacrifice.
- **4.14.3 (no row for a move that answers a check)** — A king step or an interposition out of check came out as quiet (可以走【将4平5】：调整了一下阵形). **Reading:** Row 10 extended to the king: escape {by: king} for a king move, block {by: moved piece, on: own king} for an interposition (from facts.escapesCheck and the 'line' block).
- **4.14.2 held, eval; CONTRACT-NOTES 88** — MoveAssessment gives no mate distance for a move that allows mate; 'eval: after this move'. **Reading:** eval.mate is the distance after the move: givesMate - 1 (left out at 0), or minus the rival's moves read from the line, else from facts.allowsMate, else left out. held is also true when flags.allowsMate is set and the distance is unknown.
- **4.14.2 only ('from flags'), 3.6 'the only move that avoids a serious loss'** — flags.onlyMove describes the position, and is also true for the one winning move; the local row says 唯一的解法 / 能解围. **Reading:** only is set when the tried move is the best move, wins no material (outcome.net < 1) and gives no mate.
- **4.14.2 toward ('when not best')** — With a loss under 60 cp toward was set while better was [], so 'a more active idea over there' and 'nothing better found' were said of one trial. **Reading:** toward is set exactly when better[0] is the comparison move (not best and gain >= 60).
- **4.14.2 vsPrev ('by comparing moveCp')** — ctx.prev is a TryPacket, which has no cp. **Reading:** The losses of the two tries are compared; 30 cp or less is same.
- **4.14.1 threats (b) net {gain: [], lose: [PT]}, (c)** — For a guarded piece the literal net reads 白丢一个车 although the capturer is taken back. A pass-search line whose first move is a quiet move would become a threat with code quiet. **Reading:** (b) net is the exact exchange on that square when its value equals Hanging.gain (also tried after each answer when the child is in check), else the literal form. (c) is added only when its first move is a mate, check, capture, fork, discovered attack, pin or attack. With no legal move for the child, threats is [] and chance null. In check the code stays attack / cannon_mount (CONTRACT-NOTES 105).
- **4.14.1 mat.cp** — With the crossed-pawn value, equal piece counts gave 你大约多一个兵. **Reading:** mat.cp counts every pawn as 100.
- **4.14.1 mine.try ('prev.packet with held false and reply filled')** — The predicted cost was stated as fact by the local `last` answer when the rival had played something else (是失误：你白丢一个兵, pawn still on the board) or when the loss lay moves ahead. **Reading:** mine.try.cost is the balance of the two moves really played (the previous move's capture and the rival's capture), null when nothing was taken, while the child can still take back, or when report.prev is absent. reply is unchanged.
- **4.14.4 save_piece -> danger / escape, tactic** — The piece to move is often not the piece in danger; theme escape then says the wrong thing (马二进四 guards the pawn). **Reading:** save_piece: the first of escape / block / defend among the effects, else the capture of the attacker. tactic: first of fork / discovered / pin among the effects, discovered for a discovered check.
- **4.14.1 chance.theme** — A first move with no visible threat gave theme quiet or develop. **Reading:** When the lead is not a mate, capture, check or attack motif and the line captures later, the theme is capture.
- **4.14.6 buildOverPacket** — Not stated: where ex.better and proud.k come from; what a lesson with danger slow gives. **Reading:** ex.better is the sample's confirmed move when it differs from the first try and is brilliant / best / good. proud.k: mate (history flag), else a fixed pattern-to-motif map, else capture, else check, else absent. A lesson whose habit is null gives no habit takeaway and no goal; the next takeaway is used. history is used to register the cited moves.
- **CONTRACT-NOTES 108 (defend {on})** — 'Most valuable piece that gained the moved piece as defender' would name an unattacked piece (马8进7: the advisor on 6 instead of the pawn). **Reading:** Candidates must also have had an attacker before the move (the rule of the tag 保 itself); the most valuable of those; none found means no effect.
- **4.14 buildToolVerdict, buildRecap; 4.14.1 n** — The tool context has no ply; vsTry scope and cur are not defined; n for a position where the child is not to move. **Reading:** No develop row in a tool verdict. vsTry only for a one-move seq of the child against activeTry.loss. who is read from the move's colour; seq is rewritten as the engine's notations. buildRecap: tries in order (last eight), highest pouch, cur = full packet of the last try, an earlier recap folded in. n is 0 when facts.turn is not the child.

### C4

- **§3.10 Thread.retract ('mark the active try withdrawn') vs §3.6 (no retraction on the wire), §8.6 why, §4.10 rule 5** — The wire cannot say a try was taken back, so the narrator and the validator both treat the last try as current for the rest of the thread. **Reading:** The client keeps the retraction. With no try on the board the local narrator is given the thread without its tries; good / reply / better / show are answered with nothing and neither sent nor recorded; a recap carries `cur` only for the try on the board. The model still sees the try block without a 已收回 note until the next try event; telling it needs a wire marker.
- **§7.2 (said 'local' + v: the proxy re-creates the sentence from events[0..k]) vs compaction and the hidden try** — The events before k change at compaction, and the narrator may have been shown a different list than the wire carries, so the re-created sentence can differ from what the child saw. **Reading:** An event is recorded as said 'local' only when composeLocal on the wire events gives that very sentence, and is re-checked after every compaction; otherwise said 'none'. When the question that carried `more` is replaced, the packet moves to the first kept reply / better / why / show / free ask, else it travels with the next one.
- **§7.2 (recap built by buildRecap()) vs §15 (C4 depends on C1 and C2 only) and the wave rule** — The client cannot both call brief.buildRecap and be independent of C3 in this wave. **Reading:** client.js builds the RecapPacket itself. C3's buildRecap now exists and always sets `cur` to a clone of the last try; if the integrator swaps it in, the client must delete `cur` unless the try is on the board and no try remains in the kept window.
- **§7.6 ('off for the session') with several requests in flight** — Not said what a later rate / upstream_busy / upstream_auth answer does to a client that is already off with reason origin or version. **Reading:** Nothing: off for the session is final.
- **§7.6 no_key 're-probed every 10 min' vs forceLocal 'never touches the network'** — The two rules meet when the tick falls while forceLocal is on. **Reading:** The probe is put off by another 10 minutes each time, so it is still asked after the setting changes back.
- **§7.5 finish(s): h.onEnd(result); resolve result** — If onEnd runs before the reply is settled, a handler that sends the next event from onEnd aborts the reply that is ending. **Reading:** Engineer's reading kept: the reply is settled first, then onEnd is called. Every non-aborted, non-silent reply ends with exactly one onEnd, also on internal errors.
- **§7.5 local() (source 'local', only onSegment) vs §3.10 Handlers.onSentence and the confirm beacon** — The pseudo-code never calls onSentence for local text and ends an empty local line with source 'local'. **Reading:** Engineer's reading kept: local sentences go through the same markup stream (onSentence fires); a reply with no text has source 'none', no v and no recent key.
- **§7.2 compaction vs a game-over thread; §7.3 too_large; §7.3 invalid / bad_signature** — A recap would replace the over packet every later question is about; how far to compact on too_large, and what a second rejection means, are not given. **Reading:** Engineer's readings kept. An over thread keeps its over event and its last six events. too_large compacts to a recap plus half the events (at most 6), and the thread stays local if it cannot shrink. The first invalid / bad_signature drops the signed history, a second keeps the thread local; invalid on a resumed leg keeps the history and is answered from the tool verdict.
- **§7.5 resume = {token, results} per round vs §7.12 (stateless proxy); §7.5 onTool({phase, notation}) vs Handlers.onTool link? and D-38** — Per-round results would lose the first round on the third leg; nobody else can fill `link` for the ghost pieces. **Reading:** Engineer's readings kept. resume.results carries the results of all rounds (at most 4, one per id), which S2's openResume accepts. The client fills `link` at phase 'start' by parsing after + notation from book.base; one indicator per round.
- **§7.6 onMode / capabilities().freeText; offReason 'setting' with apiBase null; §7.3 HTTP errors without a known code; §4.17 stats()** — Several transitions, mappings and counters are not defined. **Reading:** Engineer's readings kept. onMode also fires when only freeText changed. offReason is 'setting' whenever forceLocal is true. HTTP 403 without a code is origin, 413 too_large, 429 rate (retry-after header honoured), anything else a counted failure. stats: requests = POST legs, overCap = replies over the display cap.

### CF

- **CONTRACT-NOTES L-111 / SPEC 8.6 (start index) vs the `start` row** — The formula gives variant 1 for every opening line (ply 0, one event). A black child never gets a `start` event. Nothing in the packet at ply 0 differs from game to game, so fallback.js cannot vary it. **Reading:** Formula literal for every row. Every other row reaches all its variants for both colours. Varying the opening line needs an owner decision outside this package, for example the client keeping the last `start` keys in the `recent` list.
- **CONTRACT-NOTES L-112 ("improve / next: the habit and its fix")** — After 「下一盘注意什么？」 the line itself was the fix, so the letter of item 112 would repeat it word for word. What the last line is after the game-over line, another 为什么？ or a free question is not defined. **Reading:** Engineer's reading kept. After improve: habit plus fix. After next and after the game-over line with a goal: the habit only. After the game-over line without a goal: the highlighted move. An earlier 为什么？ is skipped. After a free question or a line with nothing concrete: the fixed sentence.
- **CONTRACT-NOTES L-112 ("what the highlighted move achieved") vs SPEC 3.6 OverPacket** — The over packet carries only the motif code of the highlight, no pieces, so no lexicon clause can be built. **Reading:** Engineer's 22 fragments kept, one per effect motif, with the move as subject. brief.js sends only mate, fork, discovered, check, sacrifice and capture today. New child-facing wording for the owner.
- **CONTRACT-NOTES L-113 (b) vs SPEC 3.6 WLine** — A WLine says it ends in mate but not who is mated. **Reading:** The sign of the mate distance of the evaluation that belongs to the line decides when present; otherwise the side that makes the last listed move gives the mate. brief.js reports end 'mate' only when the last listed move is the true end of the line, so the parity rule is sound.
- **SPEC 8.6 ask `danger` ("none and known.threats: 眼下没有直接的危险，可以放心走。") vs TurnBrief.check and TurnBrief.eval** — The row ignores that the child may be in check, or that the evaluation holds a forced mate against the child, while the threat list is empty. **Reading:** In check: 「被将军了，先应将。」 (the sentence of opp.check). A forced mate in the evaluation: 「要当心：{evalWords}。」. Otherwise the contract sentence.
- **SPEC 8.6 ask `proud` ("none: 这盘每一步都走得很稳。")** — No highlight means no best or brilliant move was found, so the sentence is nearly always unsupported; it would be said after a three-move resignation. **Reading:** The contract sentence only when stats.good >= moves > 0; otherwise 「这盘还没走出最漂亮的一步，下一盘咱们一起找。」 (my wording, for the owner).
- **SPEC 8.6 ask `last` ("the good sentence + {effectClause(does[0])}。") and opp.effect variant 0** — Lexicon clauses without a subject are not sentences on their own and read as orders to the child. **Reading:** 这步 leads such a clause where it stands as its own sentence. After a colon, after 因为 or after 【M】 the clause is unchanged.
- **SPEC 8.6 `good` / `last` / composeToolReply ("netClause(cost) or effectClause(flaws[0])")** — For a move that loses material and is also mated, the material is given as the reason and the mate is not mentioned in the verdict sentence. **Reading:** Left as the contract and the C2 reading have it. Suggested for the owner: when flaws[0] is allow_mate, give the flaw first.
- **SPEC 8.6 composeToolReply, `比你正在试的那步{更好|更差}。`** — The bare sentence has no subject after a sentence about the answer. **Reading:** 「这样走比你正在试的那步更好/更差。」 brief.js sets vsTry only for a single move of the child, so the wording is unambiguous there.
- **SPEC 4.11 lexicon clauses `allow_mate`, `waste`; balanceWords; threatClause for a check** — The two clauses name the wrong side for a rival move. balanceWords gives 你多大约一个兵. A threatened check is worded as a check given. **Reading:** All three corrected inside fallback.js only (engineer); lexicon.js is untouched, so the proxy's renderToolResult and brief voice still have them.
- **SPEC 4.1 HABIT_FIX (codes.js, frozen) vs CONTRACT-NOTES L-113** — HABIT_FIX.miss_threat uses 它 for the rival; HABIT_FIX.miss_mate says 对方的将, which is 帅 for a black child. Both are spoken in the game-over line, in 「下一盘注意什么？」 and in the 为什么？ answer. **Reading:** Left as they are; the same strings appear on the card and in the prompt. Suggested: 「对方走完，先问自己：对方想干什么」 and 「对方的老将没路走时，多算一步」.
- **CONTRACT-NOTES L-113 (d) vs SPEC 4.14.1 / Appendix A6.4** — opp.name is the opening change or a pattern of stage 'played'. 空头炮 and 窝心马 are stage 'formation', so brief.js never sends them as opp.name and the corrected wording is not reached today. For 窝心马 the pattern's side is the opponent of the horse's owner. **Reading:** Wording kept as the engineer chose it (对方走成了窝心马 / 窝心马，是个弱点 / 空头炮，厉害的攻势), read as the rival's own formation.
- **SPEC 8.6 `last`, verdict good (C2's reading 「【M】稳健，可以走。」)** — 可以走 is said about a move that has already been played. **Reading:** Left as the standing C2 reading. 「【M】走得稳。」 would fit a played move if the owner wants it.

### GS

- **Section 4.22 'No line is about the child' vs CONTRACT-NOTES 113 and its suggested lines** — The suggested 「这一手厉害。」, 「来得好。」 and 「请出招。」 answer or address the child's move, which the letter of 4.22 forbids. **Reading:** Confirmed the engineer's reading: no line names or judges the child (no 你, no 小主公; tested). A line may answer the child's move when it credits it.
- **Task item (3), check pool: 'a line that fits giving check' (no wording given); section 5.8 E-commit (rival)** — rivalReact cannot tell a check from a mate, so whatever sits in the check pool is also said with the mating move. The engineer's 「请应将。」 fails there. **Reading:** 「兵临城下。」: fits giving check, is right on the mating move, does not address the child, and matches the military idioms of the quiet pool. Plainer alternative: 「看这一将。」. A test now forbids a check line that asks for an answer.
- **Task item (3), last sentence: re-read every remaining line from the seat of a losing child** — Two lines not on the owner's list fall under the same rule: checked 「无妨。」 waves the child's check away, and smug 「尽在掌握。」 tells a losing child the whole game is in his hands. **Reading:** Kept the engineer's replacements 「不慌。」 and 「看我这一手。」. Both need the owner's yes or no. Rattled 「失算了……」 is kept: it concedes being out-calculated, where 「大意了。」 made an excuse.
- **Task item (3), start pool: 「请出招。」** — When the child plays black (a setting, not the default) 司马懿 moves first, so the line is slightly off; rivalReact({kind:'start'}) does not know the side. **Reading:** Kept the owner's suggested line. In practice the tag stays up 2.4 s and he moves within about 1 s, so it reads as 'your move' when the child's turn begins. 「请赐教。」 fits both sides if the owner wants it exact.
- **Task item (3), smug pool: 「早有防备。」** — The smug pool is used when his own tactic landed; 「早有防备。」 is a remark about defending and fits that moment loosely. **Reading:** Kept as the owner suggested. 「早有准备。」 would fit the moment more closely.
- **Task item (4): goalRecall / goalNext with HABIT_FIX.miss_threat (「对方走完，先问自己：它想干什么」)** — Any template that keeps its colon gives two colons in one sentence. **Reading:** Confirmed the engineer's dash: 「上盘说好的小目标——…。」 and 「下一盘小目标——…。」. The hud prints the goal line as given and does not split on the colon (src/ui/hud.js line 1093).
- **Task item (4): avoided.greedy and the 保镖 picture** — The old line also claimed the child 'looked first', which the facts do not show. **Reading:** Confirmed 「这回没去吃有人保护的子，上次的坑躲过去了！」. It matches the trap rule of 4.6.4 (a losing capture was on the board and the first try was not a mistake) and the wording of HABIT_FIX.hang_piece.
- **Task item (4): 存档 for the saved game, 棋谱 only for the list of moves — saveTruncated** — saveTruncated is about a damaged save but describes the list of moves. **Reading:** Kept byte for byte. saveCorrupt and saveNewer say 存档; a test pins that 棋谱 occurs only in saveTruncated.
- **Task item (4): 司马懿 by name or 对方 — sparedMate and undoOpening** — Both said 对面; either replacement is allowed. **Reading:** Confirmed 司马懿 by name in both (they are 诸葛亮's statements about him). avoided.miss_threat and the screen-reader announcements keep 对方.
- **CONTRACT-NOTES 115 vs store.importBackup** — The store returns why 'storage' both when storage is full and when it is unavailable or could not be read, so 「存储空间满了，…」 can be shown when storage is merely switched off. **Reading:** Wording kept literally as item 115 gives it; item 115 itself assigns the key to both cases.

### S2

- **§7.11 `new OpenAI({ apiKey, baseURL, maxRetries: 1, timeout })` vs §7.9 (configured by COACH_* only) and §7.13 item 4 (no identifier sent, no request content logged)** — With the printed four options, the SDK (7.55.0) also reads OPENAI_ORG_ID, OPENAI_PROJECT_ID, OPENAI_LOG and OPENAI_CUSTOM_HEADERS from the environment and writes to the console itself. **Reading:** The client is built with `organization: null, project: null, logLevel: 'off'` in addition to the printed options. OPENAI_CUSTOM_HEADERS cannot be switched off through a documented option and is left.
- **§7.11 streamChat loop: `calls[tc.index] ??= …`, `if (d.content) yield …`** — Read literally, a gateway that omits `index` loses every tool call, a wild index stalls the server, and non-string content is passed on as text. ADD-A asks that any chat model the gateway lists keeps working. **Reading:** A fragment with a whole-number index of 0 or more goes to that place; without one it is placed by id, or by function name when there are no ids. At most 8 calls are kept. Only strings count as content, id, name, arguments and model.
- **§7.10 "sse() … wires request.signal and the stream's cancel() to one AbortController"** — On Node 24 `request.signal` follows the caller's signal only while the Request object is alive, so wiring the signal alone loses the abort after a garbage collection. **Reading:** sse() receives the Request and holds it until the stream closes. Behaviour is otherwise as printed.
- **§7.11 (live mode) and §4.29 createCoachHandler(overrides)** — A fixed config can be `live` with an empty base URL or key; the SDK would then use its own default endpoint. **Reading:** streamChat throws before any SDK call when `baseUrl` or `apiKey` is empty; the client sees the SSE error `internal`.
- **§8.4 row `opp`: `〔事件〕对方落子：【{turn.opp.move}】。`** — The validator accepts an `opp` event in a thread whose `turn.opp` is null; the template then has no move to print. **Reading:** The engineer's fallback `〔事件〕对方落子。` is kept and is now tested. Not listed in the engineer's report.
- **§8.4 directives and the game-over brief, read as the model (rendered literally; nothing changed)** — Beyond the engineer's list: (1) `why` in a game-over thread says 引用推演里的那条变化, but such a thread has no 推演. (2) `improve` says 引用那一步和更好的走法 even when `takeaway.ex.better` is absent. (3) For a checkmated child the brief of the over thread reads 小主公正被将军，必须应将，共有0种应法 and 对方的威胁（清单完整）：眼下没有直接威胁. (4) With a habit takeaway whose code equals `goal`, the 〔本局小结〕 block states the same sentence twice (要点 and 下一盘小目标) and the directive asks for both. (5) `why` after a silent event says 把你上一句的结论…, but there is no previous sentence. **Reading:** Implemented literally; reported for an owner decision. Suggestions: answer `why` after game over locally, or drop the clause; make `improve` conditional on `ex.better`; give renderTurn an over-aware position line; print the goal line only when it differs from the takeaway.
- **The engineer's contractIssues (§7.5 vs §7.12 results, §7.8 mock details, §7.10 clientIp and renderedLength, §7.11 abort / finish reasons / per-model noEffort / SDK warm-up on /health, §8.4 layout and omitted empty clauses, §14.3 real SDK against a fake gateway)** — Each was checked against the contract text and the code. **Reading:** All of the engineer's readings stand unchanged. In particular: results are matched by id across legs, which agrees with C1's limit of four results and with what src/coach/client.js sends today; and 〔已喊〕 is printed for every event that carries a cue.
- **Task text: "use only the port given to you"** — No port number was in my task text either. **Reading:** Every test and probe server binds 127.0.0.1 on an ephemeral port (port 0) and is closed afterwards. No process of mine is left running.

## Part 2. Requests to other packages, by file

### src/app.js  [A1]

- (from GS review) A1, item 115: if the import is wired in app.js and not in the director, the same rule applies: STR.importFull for why 'storage', STR.importFailed otherwise.
- (from GS impl) A1 (with G4), item 115: STR.importFull now exists. Use it for a storage-unavailable or quota failure of an import (store.importBackup returning {ok:false, why:'storage'}); keep STR.importFailed for a bad file.

### src/app.js (A1)  [A1]

- (from C4 review) The client does not probe at creation and listens to no DOM event: call coach.probe() at boot and on the browser's 'online' event (§4.27 steps 12 and 13). To show reason 'setting' for ?coach=off, set forceLocal true when config.coach.reason === 'setting'.
- (from C4 impl) The client does not listen to DOM events and does not probe at creation: call coach.probe() at boot and on the browser's 'online' event (§4.27 steps 12 and 13). To show reason 'setting' for ?coach=off, also set forceLocal true when config.coach.reason === 'setting'.

### src/core/search.js  [B2]

- (from B5 impl) B2, not blocking: (1) the first-recurrence-is-a-draw rule of A3.4 hides forced mates that pass through a game position; an example position with its history is SPARED in tests/unit/core/brain.test.js. (2) Stop latency is one root-move subtree; if the 150 ms backstop fires too often on real devices, the remedy is in the root loop, not in brain.js.

### src/core/facts.js  [B3]

- (from C3 impl) For information: the relative pin of A6.1 (lift the piece) lists a pawn that cannot leave its file; brief.js filters it. hangs_moved_piece and unguards also cover guarded pieces; brief.js checks with the engine whether anything can take back.

### src/core/teacher.js  [B4]

- (from B5 impl) BT: verify can return null (deadline already passed) as well as a shallower line. After the re-tune, re-run the scratch script measure_verify.mjs (work/B5): more gifts mean more verify calls, and the 0-in-1,940 result was measured on the pre-re-tune teacher. If the re-tune stops the teacher from using verify in the five VERIFY_SCENARIOS of brain.test.js, that test's last assertion (`decisive >= 2`) asks for fresh scenarios; twin2.mjs finds them.

### src/core/teacher.js (BT, for information)  [B4]

- (from BF review) No change requested. bestMoment takes the latest brilliant sample as the game's highlight, so until the owner settles the sacrifice clause a give-away in a lost position can be chosen as the replayed best move.

### src/core/brain.js  [B5]

- (from C3 impl) If the contract can change: let the assess job return MoveFacts of the comparison move (and of the listed alternatives), and let the opponent job return the facts of the first move of choice.chance.line. brief.js then drops its engine-only derivation. Also: chance.line and overlooked.line must be Lines; brief converts a bare move list itself as a safety net.

### src/core/brain.js, tests/unit/core/brain.test.js (B5)  [B5]

- (from BF impl) No change needed in brain.js. If a test expects `brilliant` for a move that takes material with profit and is neither a sacrifice nor the start of a mate in two or more, it must now expect `best`.

### src/coach/lexicon.js  [C1]

- (from C3 impl) Two clause templates overstate. pin with a king as on2 (absolute pin): 你的八路炮牵住了对方的3路象，它一动后面的对方的将就丢. defend is also the code of a parry 'defended', which covers a piece that became safe because the attacker's screen left: 给你的九路车补上保护 after 兵七进一 removed the cannon's screen.
- (from CF review) C1 / owner: `allow_mate` (这步走完，对方就有杀棋) and `waste` (白让对方走一步) name the wrong side for a rival move. balanceWords gives 你多大约一个兵 (大约 belongs before 多 / 少). A Threat has no on2, so a fork threat falls back to the bare term (「要当心：捉双。」). fallback.js corrects the first two locally.
- (from CF impl) C1 / owner: the clauses `allow_mate` (这步走完，对方就有杀棋) and `waste` (白让对方走一步) name the wrong side for a rival move; fallback.js corrects this locally for composeToolReply only. balanceWords gives 我方多大约一个兵 / 你多大约一个兵 (大约 should stand before 多 / 少); fallback.js corrects the child voice locally.
- (from GS review) C1: takeawayClause builds '下一盘的小目标：' + HABIT_FIX[code] (line 261), which has two colons for miss_threat.
- (from GS impl) C1: takeawayClause builds '下一盘的小目标：' + HABIT_FIX[code], which has two colons for miss_threat. Same remark as for fallback.js.

### src/coach/book.js (C2)  [C2]

- (from C4 review) Optional: resolveLoose(notation) falls back to the last registered try even after it was withdrawn, and its signature has no way to say there is none. If the owner wants ungrounded rival moves not resolved after 换一步, the book needs such a way (for example accepting null).

### src/coach/fallback.js  [C2]

- (from C3 impl) Lines that read false or odd with a correct packet. (1) Pouch 2 with focus danger says 该照顾一下{piece}了, but piece is the piece to move: {piece:{me,A,4}, area:my_palace, theme:check} (仕四退五 interposes) -> 该照顾一下你的四路仕了; {piece:{me,H,2}, theme:defend} -> 该照顾一下你的二路马了. (2) Pouch 1 has no row for focus chance with theme attack / discovered / pin / cannon_mount: {focus:chance, theme:attack} -> 哪个子待的位置最别扭？ (3) `last` on a mistake without flaws appends the good effect: flaws [], does [attack] -> 【兵五进一】是漏着。你的五路兵捉对方的5路卒。 (4) `reply` after a mating trial (reply null, does[0] mate) -> 对方没有特别厉害的应对。 (5) composeToolReply: cost is the balance of the whole line, the sentence reads as if the answer loses it: 你多半走【兵七进一】，白丢一个兵。 (6) held.threat variant 3 对方上一步的用意是什么？ when the ignored threat is older than his last move; held.fork variant 1 你的二路车和你的九路兵，是不是站得太近？ for a rook fork along a rank and a file. (7) Row order: opp.captured before the threat rows gives 对方得了一个兵。 while a rook is en prise (threat sev rook). (8) `show` assumes flaws[0].by plays reply.moves[0]; brief keeps that true.
- (from GS review) CF: `下一盘小目标：${HABIT_FIX[over.goal]}。` (line 720) and `下一盘记住一件事：${HABIT_FIX[over.goal]}。` (line 701) have two colons with HABIT_FIX.miss_threat. STR.goalNext, shown on the same game-over card, now reads 「下一盘小目标——…。」; a dash here keeps the two in step.
- (from GS impl) CF: the local over line `下一盘小目标：${HABIT_FIX[over.goal]}。` (line 579) and `下一盘记住一件事：${HABIT_FIX[...]}。` (line 560) have the same two colons with HABIT_FIX.miss_threat. STR.goalNext, shown on the same game-over card, now reads 「下一盘小目标——…。」; a dash there would keep the two in step.

### src/coach/fallback.js (CF) / owner  [C2]

- (from C4 impl) A local 'why' after a non-try answer still explains a withdrawn try that is in the thread, because retraction is not on the wire. Needs a decision: a wire marker, or a rule in the narrator.

### src/coach/brief.js  [C3]

- (from CF review) C3: (1) Keep reporting a WLine end 'mate' only when the last listed move is the true end of the line, and carry the mate distance in TryPacket.eval / ToolVerdict.eval whenever |mate| <= 9; fallback.js says who is mated from these. (2) TurnBrief.check must be true whenever the child is in check: 「我有危险吗？」 reads it. (3) OverPacket.moves and stats.good must count the same samples: 「我哪步下得最好？」 without a highlight reads both. (4) Fill TryPacket.cost whenever something changes hands: 对方难受了 and the 稳 sentences read it. (5) If opp.name ever carries heart_horse or empty_cannon, pass them only as the rival's own formation.
- (from CF impl) C3: (1) A WLine with end 'mate' should list the mating move as its last move, and TryPacket.eval / ToolVerdict.eval should carry the mate distance whenever |mate| <= 9; fallback.js says who is mated from that sign, else from who makes the last listed move. (2) ToolVerdict.vsTry is spoken as 「这样走比你正在试的那步更好/更差」: set it as the child's view of the whole analysed sequence against the active try, or leave it out. (3) opp.name 'empty_cannon' / 'heart_horse' are worded as the rival's own formation (对方摆出了空头炮 / 对方走成了窝心马): pass heart_horse only when the horse is the rival's. (4) 「对方难受了」 and the 稳 sentences read TryPacket.cost: fill it with the settled balance whenever something changes hands, as 4.14.2 says.
- (from S2 review) buildRecap: when `cur` is set, keep its move as the last entry of `tries`, because the rendered 〔推演〕 block of a recap does not name its move. For a mate or check threat leave `net.gain` / `net.lose` empty; the renderer then prints no `得手后` clause.
- (from S2 impl) buildRecap: when `cur` is set, keep its move as the last entry of `tries` (the rendered 〔推演〕 block of a recap does not name its move). For a mate or check threat leave `net.gain` / `net.lose` empty; the renderer then prints no `得手后` clause.

### src/coach/brief.js (C3)  [C3]

- (from C4 review) No change needed. buildRecap is not called by the client (see contractIssues); for a swap the client must drop `cur` when the try is not on the board or a try remains in the kept window.
- (from C4 impl) No change needed. buildRecap is currently not called by the client (see contractIssues). If the owner wants the single builder, the client needs cur dropped when a try remains in the kept window.

### src/coach/brief.js, tests/unit/coach/brief.test.js (C3)  [C3]

- (from BF impl) The same for fixtures built from real engine output: a winning capture that was `brilliant` only by the only-move clause is now `best`. For information: at my last type check src/coach/brief.js had two errors (lines 1121 and 1344, TS2739 / TS2740), presumably mid-edit.

### src/core/brain.js, tests/unit/core/brain.test.js (B5); src/coach/brief.js, tests/unit/coach/brief.test.js (C3)  [C3, B5]

- (from BF review) No change needed; the whole unit suite was green at review time (584 of 584). For fixtures from real engine output: a winning capture that was brilliant only by the only-move clause is now best.

### src/coach/client.js  [C4]

- (from CF review) C4: 为什么？ in a game-over thread always has a local answer (row 'ask.why', v 0). Keep the `over` event at events[0] when compacting, as the code does now; the answer is built from it. Subject to the owner: if the opening line should vary, keep the key of the last `start` line in the `recent` list; with the formula alone it is always variant 1.
- (from CF impl) C4: 为什么？ in a game-over thread now always has a local answer (row 'ask.why', v 0), so the empty-answer path no longer applies there. Subject to the owner: if the opening line should vary, keep the keys of the last two `start` lines in the `recent` list passed to localLine (it then rotates 1 -> 2 -> 0); with the formula alone it is always variant 1.
- (from S2 review) Keep sending in `resume.results` the results of every call of this event so far (both rounds, at most 4). The current file does this with `results.slice(-RESUME_RESULTS)`, de-duplicated by id; the proxy rejects an id answered twice and shows a missing one to the model as `busy`.
- (from S2 review) A `tool` event can carry `calls: []` (every call was refused by the proxy): resume with `results: []`. Call ids are opaque and may be proxy-made (`call_1_2`). `tool.text` repeats text already sent as deltas. A rejected resume is `400 {code:'invalid', path:'resume'}`. `done.text` can exceed 400 characters (`#long` is 600), and such a reply cannot be sent back as `said: 'llm'`.
- (from S2 impl) On a second tool round, send in `resume.results` the results of every call of this event so far (both rounds, at most 4), not only the latest round. Otherwise the proxy shows round-one calls to the model as `busy` on the last leg.

### tests/e2e/*.spec.js  [E1]

- (from B5 impl) E1, flow 21: check in the browser worker that a cancel and a superseding job are answered promptly, with no worker respawn in tasks.stats(). The MessageChannel yield was exercised only in a Node emulation, where it is unreliable. The owner's iPad pass should confirm the same on Safari.
- (from CF review) E1: compare mock replies against composeLocal / composeToolReply output, not the 8.6 literals; several sentences changed (see the old -> new list). 「我有危险吗？」 while in check now answers 「被将军了，先应将。」
- (from CF impl) E1: mock replies are 〔kind=…〕 + composeLocal(turn, events, 0) or composeToolReply; the wording of several sentences changed (see the old -> new list), so compare against composeLocal output or current text, not against the 8.6 literals.

### tests/e2e/*.spec.js (E1)  [E1]

- (from C4 review) tests/helpers/fake-fetch.js scripts any proxy behaviour (delays, cuts at a byte, HTTP errors, hanging streams, tool legs with real tokens) and checks requests like the proxy; its header documents the script format.
- (from C4 impl) tests/helpers/fake-fetch.js can script any proxy behaviour (delays, cuts at a byte, HTTP errors, hanging streams, tool legs with real tokens) and checks requests like the proxy; its header documents the script format.

### owner / src/coach/types.js (F0)  [F0]

- (from C4 review) Retraction is not on the wire. The client now covers the local narrator and the questions about the try; only a wire marker (a contract change) would tell the model, before the next try, that the move was taken back.

### src/game/director.js  [G4]

- (from B5 impl) G4: after the rival spared a mate and the child repeats its move, only the assess result knows the mate (flags.allowsMate, danger allows_mate). The survey table and quickVerdict score that move as a draw by repetition. Treat the assess result as the authority for `held`.
- (from C3 impl) (1) Pass report.prev with the MoveInfo of the child's previous move whenever it is known: without it `mine` is not registered and mine.try.cost is null. (2) Create the book with the same {board, turn} that report.board / report.me describe; buildTryPacket and buildHintPacket take the base from book.base. (3) Call memory.noteOpp after buildTurnBrief, as 5.8 shows. (4) buildToolVerdict needs ctx.base with the child to move; who is read from the move's colour. (5) A brief for a finished game still lists threats when the child has legal moves (resign, draw): pass legal state accordingly or ignore them. (6) worthSpeaking and isEarned are as printed; `only` and `toward` are narrower than the letter (see contractIssues).
- (from CF review) G4: the 为什么？ chip may stay in the `after` set of a game-over thread; the local answer is never empty.
- (from GS review) G4: when the rival's move ends the game (flags.mate, or any move followed by game:over), show only the mood of rivalReact({kind:'moved'}) and drop its line, or skip the reaction; the 'over' line follows anyway. Otherwise a smug line such as 「正合我意。」 with the smirk can come right before 「承让。」, which is gloating at the win.
- (from GS review) G4 (with A1, item 115): in importBackup, toast STR.importFull when store.importBackup returns {ok:false, why:'storage'}; keep STR.importFailed for every other failure.
- (from S2 review) Offer a chip only when its directive has data: `last` needs `turn.mine.try`, `proud` needs `over.proud`, `improve` needs a takeaway with `ex.better`, `next` needs a goal, `intent` needs a rival move or threats. `why` after game over, or after an event that got no sentence, should be answered locally. Otherwise the model is asked for a reason or a line the packets do not carry.
- (from S2 impl) Offer a chip only when its directive has data: `last` needs `turn.mine`, `proud` needs `over.proud`, `improve` needs a takeaway, `next` needs a goal, `intent` needs a rival move or threats. Otherwise the model is asked for a reason the packets do not carry.

### src/game/director.js (G4)  [G4]

- (from C4 review) Send good / reply / better / show only after thread.tryMove of the trial on the board was called. The trial chips appear at trial start, before the assess job answers; until tryMove, and after thread.retract(), the client answers these with nothing (source 'none') and the chip is spent. After a change of the `coach` setting call coach.probe(): it pushes the mode change to the onMode listeners at once (it does not touch the network while forceLocal is on); otherwise they hear of it at the next event.
- (from C4 review) Handlers as implemented: onStart fires synchronously inside thread.open / hint / tryMove / ask; onSentence also fires for local lines; a result with source 'none' has empty text (leave no bubble); an aborted reply gets no handler call, so close the message from done = {aborted:true}; onEnd runs with the thread already free; onMode also fires when only capabilities().freeText changed; onTool at phase 'start' carries the link for ghost play.

### src/game/ports.js  [G4]

- (from B5 impl) G4: give the assess job a `table` only for the same position as `fen` (a table of another position is ignored; pass null for the LLM tool) and always pass `ply`. `history` is the FENs since the last capture without `fen`. Job errors (illegal move, illegal compare, no legal move in an opponent job) arrive as `{t:'error'}`. `analyze` jobs send `table` progress; assess and opponent send none. Survey.fen echoes the payload's fen string.

### src/game/ports.js (G4)  [G4]

- (from C4 review) Pass the client an options object whose forceLocal is a live getter (item 83). tools.analyzeMove may return its result without id (the client stamps it), but the verdict must pass C1's validator: an invalid one makes the resumed leg a 400 and the child gets the local tool answer. Honour ctx.signal (it fires on abort and after 2 s). Register the analysed line in the book with src 'tool'.

### server/prompt.js  [S2]

- (from CF review) S2: renderToolResult for who 'opp' prints the lexicon flaw clauses, so a rival move with allow_mate or waste tells the model the wrong side profits. Local lines re-created with composeLocal(turn, events, v) changed in wording only; row:v pairs mean what they meant.
- (from CF impl) S2: renderToolResult for who 'opp' prints the flaw clauses of lexicon.js, so a rival move with the flaw allow_mate or waste tells the model 「这步走完，对方就有杀棋」 / 「白让对方走一步」 although the child is the one who profits. Needs the lexicon fix above or a local correction. The local sentences re-created with composeLocal(turn, events, v) changed in wording only; row:v pairs mean what they meant.
- (from GS review) S2: line 259 builds `下一盘小目标：${HABIT_FIX[over.goal]}。` for the model. Not child-facing, but the model tends to copy it; consider the same dash.

### server/prompt.js, server/coach-handler.js (S2)  [S2]

- (from C4 review) What the client sends: a recap has `cur` only when the try on the board fell out of the window (a withdrawn try is listed in `tries` only); a game-over thread is never recapped; after a compaction `more` may sit on an earlier, already answered reply / better / why / show / free ask; resume.results holds the results of all rounds; an earlier free ask with said 'local', v 1 is the refusal line. Your handling of a said-'local' event that re-creates '' as silent is no longer needed for this client but harmless. Checked in process against your handler in mock mode: 21 requests, all 200.
- (from C4 impl) What the client sends: a recap has cur only when the current try fell out of the window, and tries / hint may be empty / 0. A game-over thread is never recapped (events[0] stays over, events between are dropped). resume.results holds the results of all rounds (up to 4). An earlier free ask with said 'local', v 1 is the refusal line. Tool call ids must match /^[A-Za-z0-9_.:-]{1,128}$/ or the client cannot answer the call. A 400 invalid on a resumed leg is treated as a token / results failure and keeps the thread's history.

### scripts/build.js  [T1]

- (from B5 impl) T1: search-worker.js contains `scope.process.getBuiltinModule('node:worker_threads')` (a guarded call, not an import). The import crawl and the forbidden-API list do not flag it today; please keep it that way. I could not run the build.

### scripts/serve.js  [T1]

- (from S2 review) Defence in depth for the key: in the `[api]` and `[unhandledRejection]` log lines print the error's class name, not `e.message`. An SDK error message carries the bearer token when the gateway echoes it (shown in provider.test.js). The S2 handler never rejects and its stream never errors, so no such error escapes today, but these two lines would print it if one ever did.

### tests/unit/scripts/serve-coach.test.js  [T1]

- (from S2 review) Pass an explicit `env` (with the rate variables raised if the test sends more than 20 requests). In mock mode the model id is 'mock' in open / done / health. `fail=<status>` accepts 400–599 only and is answered before the rate limit.

### README.md  [T2]

- (from S2 review) Document the live smoke of S2's done-criterion: `npm start`, then `curl -N -H "content-type: application/json" -H "origin: http://127.0.0.1:5173" --data-binary @tests/fixtures/coach/try.json http://127.0.0.1:5173/api/coach`. Expect `event: open` with mode live, `event: delta` lines with Chinese text, then `event: done`. Without the Origin header the answer is 403 unless COACH_ALLOW_NO_ORIGIN=1.
- (from S2 review) Also document: the log line format `[coach] mode= status= (code=…|end=…) [in= cached= out=] ms=`; that COACH_TRUST_PROXY=1 makes the first x-forwarded-for hop the rate-limit key; that the SDK is loaded in the background at the first /health of a live proxy; that the proxy ignores OPENAI_ORG_ID, OPENAI_PROJECT_ID and OPENAI_LOG, while OPENAI_CUSTOM_HEADERS, if set on the machine, is still added to gateway requests by the SDK.
- (from S2 impl) Also document: the log line format; that COACH_TRUST_PROXY=1 makes the first x-forwarded-for hop the rate-limit key; that the SDK is loaded in the background at the first /health of a live proxy.

### scripts/coach-bench.js (T2)  [T2]

- (from C4 review) stats(): requests counts every POST leg; overCap counts replies longer than the display cap (1.5x), not the prompt cap; local counts local lines spoken, tool-verdict and refusal lines included.
- (from C4 impl) stats() meanings are in contractIssues: overCap counts replies over the display cap (1.5x), not the prompt cap; requests counts every leg.

### scripts/sim.js  [T2]

- (from B5 impl) T2: createBrain() runs in Node directly, and search-worker.js runs as `new Worker(new URL('../src/core/search-worker.js', import.meta.url))` in worker_threads. A slower device can be emulated by replacing globalThis.performance with a clock that runs k times faster before createBrain(); the calibration then lands in the slower class by itself.

### dev/fx.html  [X3]

- (from GS review) X3: the sample popup 「3连妙手！」 (line 410) is now 「3连好棋！」.
- (from GS impl) X3: the sample popup 「3连妙手！」 (line 410) is now 「3连好棋！」 (item 114).

### dev/chat.html  [X6]

- (from GS review) X6: sample copies of old STR texts: 「这一步被抓住了。要不要悔一步重想？」 (line 189) and 「它的马想干啥？」 (lines 213, 217, 218). New: 「刚才那步被抓住了。要不要悔一步重想？」 and 「他的马想干什么？」.

### dev/hud.html  [X7]

- (from GS review) X7: the sample goal 「下一盘小目标：吃子之前，先看它有没有保镖。」 (line 185) is now 「下一盘小目标——吃子之前，先看它有没有保镖。」.
- (from GS impl) X7: the sample goal 「下一盘小目标：吃子之前，先看它有没有保镖。」 (lines 184, 185) is now 「下一盘小目标——吃子之前，先看它有没有保镖。」.

### src/ui/stage.js  [X8]

- (from GS review) X8, item 114: the stage's own streak text is still `${streak}连妙手！` (line 1232, comment on line 60). It should read `${streak}连好棋！`.
- (from GS impl) X8, item 114: the stage's own streak text is still `${streak}连妙手！` (lines 60 and 1090). It should read `${streak}连好棋！`, as STR.streakPopup now does.

### C:\Users\USERNA~1\AppData\Local\Temp\claude\5884157893c5b410\a051714c-de36-47da-b3cc-cfc754f60ac3\scratchpad\design\CONTRACT-NOTES.md (owner / integrator)

- (from BF review) Decide the sacrifice clause in clamped positions first: it is what a losing child would actually see (妙手 and a 弃子 stamp for hanging the last rook). Then the mate clause when a faster mate exists, and the only-move clause for a move that is not the table's first line or in decided positions. Each is a small change in assessMove plus tests; suggested rules are under contractIssues.
- (from BF impl) Decide the three remaining over-praise points listed under contractIssues (sacrifice clause in clamped positions and for exchanges; mate clause when a faster mate exists; only-move clause in decided positions). Each is a small change in assessMove plus tests.

### dev/stage.html

- (from GS review) X8: sample copies: 「上盘说好的小目标：…」 (line 692), 「下一盘小目标：…」 (lines 535, 949), 「4连妙手！」 (line 994), and a made-up rival line 「哼，大意了。」 (line 300) that breaks item 113. New forms: 「上盘说好的小目标——…」, 「下一盘小目标——…」, 「4连好棋！」, and a real rattled line such as 「这一手厉害。」.

### playwright.config.js

- (from S2 review) Rate limits apply in mock mode too (default burst 20, 30 per minute per address, 600 per day). A fast e2e run will get 429 and the client will pause the coach. Set COACH_RATE_BURST, COACH_RATE_PER_MIN, COACH_IP_DAILY and COACH_GLOBAL_DAILY high in the web server's env.

### scratchpad/design/CONTRACT-NOTES.md

- (from GS review) Integrator / owner: record the final RIVAL_LINES and the changed STR strings (old -> new list in the summary); sections 4.22 and 4.23 no longer match the code. Three rival lines are not the owner's own wording and need a yes or no: check 「兵临城下。」 (reviewer), smug 「看我这一手。」 and checked 「不慌。」 (engineer).
- (from GS impl) Integrator / owner: record the final wording of RIVAL_LINES and of the changed STR strings (the old -> new list in my summary), since §4.22 and §4.23 no longer match the code. Two rival replacements are my own calls and need your yes or no: 「尽在掌握。」 -> 「看我这一手。」 and 「无妨。」 -> 「不慌。」.

### src/coach/memory.js

- (from C3 impl) To register moment moves the book needs their squares. Either GameMemory keeps from / to with each moment (noteMine and noteOpp would need a MoveRef), or the contract accepts that older moments are not in the book.

### src/core/codes.js

- (from CF review) Owner (F0 file): HABIT_FIX.miss_threat uses 它 for the rival and HABIT_FIX.miss_mate says 对方的将 (帅 for a black child). Suggested: 「对方走完，先问自己：对方想干什么」 and 「对方的老将没路走时，多算一步」.
- (from CF impl) Owner (F0 file): HABIT_FIX.miss_threat uses 它 for the rival (「…先问自己：它想干什么」) and HABIT_FIX.miss_mate says 「对方的将」, which is 帅 for a black child. Suggested: 「对方走完，先问自己：对方想干什么」 and 「对方的老将没路走时，多算一步」.
- (from GS review) F0 / owner: HABIT_FIX.miss_threat 「对方走完，先问自己：它想干什么」 calls the rival 它 (item 113 says never 它) and carries the colon behind every double-colon sentence. Suggested: 「对方走完，先问自己，他想干什么」. That fixes every consumer at once; the STR templates stay correct either way.

## Part 3. Left unverified or not done, by package

### B5  (impl: done; review: missing)

- The worker was not run in a real browser Worker (no port was assigned): its browser wiring and MessageChannel yield were exercised only in an emulated worker scope under Node. Prompt cancellation in Chrome and on iPad Safari is unverified until e2e flow 21 and the owner's device pass.
- The history handed to the replies search of the assess job (payload history + fen, empty after a capture) is implemented but not pinned by a unit test.
- npm run build and npm run check were not run (not allowed for this package); the import rule was checked by reading the imports.
- Speed figures come from a shared machine (17 node processes; raw search 0.56–1.05 M nodes/s, at times below the 1.0 M dev target). Mid and slow classes were emulated with a scaled clock, not measured on real devices.
- The verification-budget measurement used teacher.js as it was before BT's re-tune landed (file time 14:42).

### BF  (impl: done; review: done)

- Nothing of the BF task list is open.
- Not changed, as instructed, and waiting for the owner: the sacrifice clause in positions clamped at +-1900 and for exchange offers, the mate clause when a faster mate exists, flags.onlyMove for a move that is not the table's first line or in decided positions, and the flat verdict beyond the clamp.
- Not verified: nothing was run in a browser or worker; the populations are seeded random playouts and bot games (a weak bot against a depth-3 engine), not recorded games of children against the teaching opponent, so the share of clamped positions in real play is unknown.
- [major, not fixed] src/core/facts.js assessMove, the sacrifice clause (`flags.sacrifice`, outside the BF task list): When the score is clamped at +-1900 every move has loss 0 and the compensation test of the sacrifice rule always passes, so any piece put where it is taken is 妙手 with the 弃子 pattern. In my runs this is 914 of the 1,134 remaining 妙手; in lost positions 14 % of all legal moves. 10 of them have flags.allowsMate true (example: 3k5/4a4/4b3b/2p3p2/3rpc3/8p/p8/4BA3/4A4/1cB1K4 w, 仕五退六, in check and mated either way). The engineer reported the effect but measured it on balanced populations (86 of 445). teacher.js bestMoment takes the latest brilliant move as the game's highlight, so such a give-away can become the replayed best move. Not changed: item 106 and the task say the sacrifice clause stays.
- [minor, not fixed] src/core/facts.js assessMove, the forced-mate clause (outside the task list): A slower mate is 妙手 even when a faster one is on the board: 98 of the 140 mate-clause hits had a mate in one available, 9 more another faster mate. Example: 3akaR2/4cR3/2n6/p1p3P1p/2b6/9/4N3c/9/1r2N4/2BAKAB2 w, 兵三平四 is a mate in 3 while two moves mate at once. Reproduced; not changed.
- [minor, not fixed] src/core/facts.js assessMove, flags.sacrifice for exchange offers (outside the task list): 24 remaining 妙手 are exchange offers where the mover retakes on the same square (rook trades, pawn trades), and 8 are winning captures that are 妙手 through the sacrifice clause, against the spirit of item 106. Example: 1n1ak4/9/3a5/5r3/P8/3N5/6p2/5A2B/2R2K3/3A5 w, 车七进五. Not changed.
- [minor, not fixed] src/core/facts.js assessMove, flags.onlyMove (outside the task list): onlyMove describes the table's first line, not the tried move. When the table is shallower than the pair (table depth 4, pair depth 6), a move that is not the table's first line can be 妙手 by the only-move clause: 2 of 7 such hits in that run. Separately, of 33 moves that are 妙手 by this clause alone, 5 are in positions where the second-best move also stands at +500 or more and 8 where the best move is at -500 or worse. Not changed.
- [minor, not fixed] src/core/facts.js verdict in clamped positions (section 4.6.1 with scoreToCp; outside the task list): With the score clamped at +-1900 almost every move is at least 好棋: 98 % of all legal moves in lost positions (1,510 of 1,541 in 73 positions) and 58 % in won ones. Removing the clamped sacrifices would turn those give-aways into 好棋, not into a criticism. Reported only.

### C3  (impl: done; review: missing)

- The 12,000-character prompt limit (LIMITS.PROMPT_CHARS) was not checked: it needs S2's renderer. Only the request size in bytes was measured (largest 5.2 KB).
- Moment moves older than the last two plies, and `mine` after an undo or reload, are not registered in the book (no squares available to brief.js).
- Effects of better alternatives, toward and chance never include pin, sacrifice, a mate threat deeper than one move, or a fork that includes the check.
- The simulation did not run chooseTeachingMove or brain.js; teaching choices were built from real tables with the kind assigned by the loss of the playout move.
- The validation scripts and review sheets are in the scratch folder C:\Users\USERNA~1\AppData\Local\Temp\claude\5884157893c5b410\a051714c-de36-47da-b3cc-cfc754f60ac3\scratchpad\work\C3 (validate1.mjs, validate2.mjs, harness.mjs, review-a.txt, review-b.txt, review-c.txt); they are not part of the repo.

### C4  (impl: done; review: done)

- Not exercised in a real browser, against a real network server (no port was given), with the director or with the real tool executor. The default global fetch path ran only through an injected fetch on real timers.
- The client still builds the recap itself instead of calling brief.buildRecap; the integrator decides after wave 3.
- The model is not told about a retraction until the next try event; that needs a wire marker.
- The last-resort branch of run().catch (finish with nothing said) is defensive and is not reached by any test now that the local path guards its own failures.
- The whole unit suite was not judged: it did not finish in 10 minutes under the machine's load.
- [minor, not fixed] src/coach/client.js recapOf() vs section 7.2: The recap is built privately instead of by brief.buildRecap. Kept because of the wave rule against depending on C3 at run time; see contractIssues.
- [minor, not fixed] src/coach/client.js markup book wrapper: After 换一步, a rival move the model writes that is in no packet is still resolved against the position after the withdrawn try, because book.resolveLoose falls back to the last registered try and its signature has no way to say there is none. Rare; left as is.

### CF  (impl: done; review: done)

- The opening line always says variant 1 (「新的一局，小主公请先行。」); varying it needs an owner decision outside fallback.js.
- Owner review of the wording: the 22 fragments for 为什么？ after the game, and my new sentence 「这盘还没走出最漂亮的一步，下一盘咱们一起找。」
- Not run in a browser and not exercised against real brief.js packets; verification used the 13 fixtures, hand-built packets and random wire-valid packets in Node.
- npm run build / npm run check were not run (as instructed).
- [minor, not fixed] src/coach/fallback.js, localLine, row `start`: The opening line always starts at variant 1 (ply 0, one event), so start:0 and start:2 are never heard in either simulation. The mandated formula cannot vary it and nothing in the packet differs between games.
- [minor, not fixed] src/coach/fallback.js, ask `good` / `last` / composeToolReply, reason of a blunder: For a move that loses material and is also mated, the stated reason is the material (「是漏着：你白丢一个仕。」), because the cost comes before the first flaw (8.6 and the C2 reading). Left as it is; reported for the owner.
- [minor, not fixed] src/coach/fallback.js, ask `improve`: A habit takeaway without an example gets 「这盘没什么大毛病。」, which contradicts the habit. brief.js attaches the example whenever the lesson has a move, so this is not reached in play. Left as it is.

### GS  (impl: done; review: done)

- Owner's yes or no on the three rival lines that are not the owner's own wording: check 「兵临城下。」, smug 「看我这一手。」, checked 「不慌。」.
- Not checked in a browser: the texts were exercised in Node only, and their consumers (director, app) are not written yet.
- [minor, not fixed] engineer's report, needsFromOthers for src/ui/stage.js and src/coach/fallback.js: The line numbers quoted are stale because those files are being edited. Current positions: stage.js lines 60 and 1232 (streak text), fallback.js lines 701 and 720 (goal sentences).
- [minor, not fixed] src/game/rival.js, smug pool with a game-ending move: When the mating move also counts as his tactic, section 4.22 gives the smug mood and a smug line (for example 「正合我意。」) right before 「承让。」. That is gloating at the win, but it is the mood rule and the director's call order, not wording, so it cannot be fixed in this package. Requested from G4.

### S2  (impl: done; review: done)

- Live smoke of the done-criterion (owner's .env.local, `npm start`, one live `try` fixture) was not run: nobody in this workflow may read .env.local or call a real model. The closest check is the same path through scripts/serve.js against a fake gateway.
- README documentation of that smoke is missing; README.md is not an S2 file (request under needsFromOthers).
- Behaviour against the real gateway is unverified: its tool-call id and index format, whether it accepts `reasoning_effort` and `strict` tools, its real error bodies, time to first token.
- The whole unit suite was last run in full (624 pass) before the last provider.js changes; after them I re-ran only the server tests (87 pass) and the type checks.
- OPENAI_CUSTOM_HEADERS is still honoured by the SDK (no documented option turns it off).
- readCapped does not stop reading a never-ending body when the request signal fires; not reachable through scripts/serve.js.
- [minor, not fixed] server/coach-handler.js, readCapped: A request whose body stream neither ends nor errors keeps the handler waiting even after the request's signal fires (probed with a hand-made stream). Not reachable through scripts/serve.js, which buffers the whole body before it builds the Request. Left as it is.
- [minor, not fixed] server/provider.js (SDK behaviour): The SDK still reads OPENAI_CUSTOM_HEADERS from the environment and adds those headers to every request. No documented client option switches this off, so it stays; the README should say so.
