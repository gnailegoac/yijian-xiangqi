# Wave 4 notes — readings and requests reported by the packages of this wave

Generated from the workflow journals. Part 1: how each package read an unclear point of SPEC.md (the reviewer's final list). Part 2: what each package asks of a package that comes later, grouped by the file named. Part 3: what each package left unverified. A later package reads Part 1 for the packages it builds on and every entry of Part 2 that names one of its files. Where an entry here contradicts CONTRACT-NOTES.md section I or the "Owner decisions" section at the end of this file, the owner decision wins.

## Part 1. Readings by package

### A1

- **4.27 steps 9 and 10 vs CONTRACT-NOTES 121 and 127, TASK-NOTES point 6** — The contract runs step 10 directly after `await stage.start()`. The stage resolves that promise inside the tap's own task whenever the audio context is already running, so the game would be built inside the tap. **Reading:** One zero-delay timer between the start-card loop and step 10, only on the path with a start card. The order of 4.27 is unchanged; `?test=1` has no tap and no timer.
- **4.26 step 4 (strip a trailing '/')** — For apiBase "/" the stripped value is the empty string, which could be read as 'no endpoint'. **Reading:** Left as the engineer built it and now pinned by a test: "/" gives apiBase '' with mode live, so the endpoints are /coach and /health (a handler mounted at the root). The coach client treats '' the same way. An empty string in the file still means no endpoint.
- **4.27 step 13 (data-ready) with step 9** — Without ?test=1, html[data-ready] is set only after the child's choice on the start card, so a page waiting on the start card is not 'ready'. **Reading:** Kept literal, as the engineer built it. Reported to E1 under needsFromOthers.
- **The engineer's eleven readings (fault toast wording, apiBase returned as written, no_key reason handed to the settings sheet, start card shown again after a failed import, settings followed through onSettings, quarantine on a failed restore, markCounted when the record has no game-skill, migration notices only when the game is continued, tasks copy with speedClass under ?test=1, the reduced-motion listener, no dev page)** — Each is a point the contract leaves open; I checked every one against the contract, the notes and the running game. **Reading:** All left as built; I found none that contradicts a typedef, a signature or a note. The fault toast text 「出了点小状况。要是棋局不动了，刷新一下页面，棋局还在。」 remains a private constant of app.js because neither STR nor TXT has a fitting key.

### CL

- **TASK-NOTES item 4 ('use the reply and cost sentence when there is one')** — The engineer read 'there is one' as a balance with cp < 0; the lexicon words anything inside 150 cp as 大致相当, which is no reason for a mistake. **Reading:** The reply sentence and the cost sentence are a reason only when their words say a loss: pieces lost for nothing, or cp <= -150 when something is also won, or the line ends in the child's mate. Otherwise the bare verdict. The same measure in the verdict sentence of good / last / tool reply, where the flaw clause then takes over.
- **TASK-NOTES item 2; CONTRACT-NOTES 131 (b); SPEC 4.14.1 threats (c)** — Not said how a fork of the pass search is told when the move does not create the double attack: the forking piece stays put and attacks both already, or two different pieces attack the two targets and the move also gives check. **Reading:** A fork is put on the wire as a fork only when the move brings the double attack about. A piece that stays put and attacks both targets already: the attack on the first target (就能吃掉). No single forking piece: the attack on the first target; when the move gives check and the rival's line does not go on to take that target, the check.
- **TASK-NOTES item 2, last sentence; engineer's reading 'else not listed'** — A quiet move that threatens mate while its line wins material, with no other threat effect and no new attack shown by the line, is dropped from the list; with an otherwise empty list the narrators would report no danger. **Reading:** Left as the engineer built it (0 of 590 positions left the list empty). Owner to decide whether such a move should be listed, for example as a threat without a target, which both narrators already word as 对方想走【M】.
- **SPEC 8.6 rows opp.threat.q and opp.threat** — A threat without a target (a threatened check) of severity rook or piece has no unsolicited row below level 4. **Reading:** Left as the contract rows have it; reported for the owner.
- **The engineer's contractIssues (prep on a threatened check; taken needs a good verdict under both clauses; quality thresholds 15 / 50 / 150; takeawayClause dash; king clauses for fork / walk_fork and name check_fork on a Threat; save_piece default theme defend; 就能吃掉 wording; only a rook-sized threat ahead of opp.captured; local intent note and quiet-row filter; no section 15 row for CL)** — Each is a choice where the task notes or the contract are silent. **Reading:** Checked against the code, the tests and the boards and kept as reported. The two with the widest effect remain the quality thresholds (overlooks of 150 cp or more are now slip, about a fifth of rival moves at low levels in my B runs) and 'taken' needing a good verdict under both clauses.

### G4

- **4.25.6 (`trial` set vs `after` set; where the primary chips go)** — The table lists the trial set as good · reply · better · why and the after set as why + the rest. It does not say where 为什么？ goes relative to the primary chips (悔一步重想 / 试试这步) of the hint3 and takeback sets. **Reading:** After a spoken trial comment: good · reply · better · why. After an answer: why first. Primary chips (takeback, try) stay in front of why, and the list is cut to four, as the engineer had it.
- **5.8 E-over ('turn of the final position') vs 3.6 TurnBrief (always the position the child faces) and 8.4 renderTurn** — A TurnBrief has no way to say that the game ended on the child's move. `opp` means 'the rival just moved', and the proxy always prints 轮到小主公走. **Reading:** The over brief is built for the final board with the child as `me`. `opp` is the rival's last move only when it is the last ply, else null; `mine` is the child's last move. The fixed 轮到小主公走 line of the prompt is left to S2 / the owner.
- **TASK-NOTES 17c / CONTRACT-NOTES 113 vs 4.22 rivalReact('moved')** — 17c allows showing only the mood of `rivalReact({kind:'moved'})` on a game-ending move. That mood can be `smug` when his mate lands on a child move that was not judged a slip. **Reading:** Kept the engineer's literal reading: mood only, no line. If the owner wants no smirk at the win, the director should show `calm` whenever the rival's move ends the game.
- **The engineer's contractIssues (coachBegin deferral, truth depth, `waited`, `found` per trial, extra stage.phase / selected / notation calls, quiet over thread 'local', budget marks after undo, evals indexing, preview of 2 plies, 'checked' mood only when the child's move ends the game, goal recall for black, retry rewind, tool executor level / ply / lifetime, the second proxy-less client for 为什么？ after the game)** — Each is a place where the contract is silent or contradicts itself. **Reading:** Reviewed against the contract text and the real modules; all kept as the engineer chose them. I ran real modules and a soak on the paths that could show a difference and found none.

## Part 2. Requests to other packages, by file

### src/app.js  [A1]

- (from G4 review) No new request. The engineer's instructions for A1 are correct as checked against the code: deps and return shape of createDirector; subscribe order tasks.sync, save, director.onEvent, then stage.on(director.actions); loadExtras before restore / newGame; markCounted synchronously after restore for a finished v1 game; a live coachDeps.forceLocal. The director's storage notice on `change` relies on the save subscriber being registered before director.onEvent. For information: the rival's think time uses `settings.motion === 'reduced'` only, so an OS reduced-motion preference under motion 'auto' does not shorten it.
- (from G4 impl) Create `const coachDeps = {apiBase: config.apiBase, forceLocal: settings.coach === 'local' || config.coach.reason === 'setting', tasks, brain, getSession: () => session.getState()}` and keep it. Register `store.onSettings(s => { coachDeps.forceLocal = s.coach === 'local' || config.coach.reason === 'setting'; })`. The director calls `coach.probe()` itself after a change of the `coach` setting, and the store notifies listeners inside `saveSettings`, so the order is right.
- (from G4 impl) Call `createDirector({session, tasks, store, brain, coach, stage, profile: loaded.profile, settings: loaded.settings, save, rng, now: () => Date.now(), setTimer: setTimeout, clearTimer: clearTimeout, isHidden: () => document.hidden, reload: () => location.reload()})`. Subscribe in this order: tasks.sync on `scope`, save on `change(persist)`, `director.onEvent`; then `stage.on(director.actions)`. `save` is `() => store.saveGame({...session.serialize(), ...director.extras()})`.
- (from G4 impl) Boot: call `director.loadExtras(choice === 'continue' ? loaded.game : null)` before `session.restore` / `session.newGame({humanColor: loaded.settings.side})`. `session.restore` throws TypeError without a moves array; the director does not catch it. After a v1 import of a finished game call `session.markCounted()` synchronously right after `session.restore()`, otherwise that game is counted. Then `director.notices(loaded.notices, {truncatedAt})`.
- (from G4 impl) Wiring the director does not do: `onWorker('ready')` → `brain.setSpeed(info.speedClass)`; `onWorker('dead')` → `stage.blocking({kind:'engine-dead'})` (the director's `retryEngine` clears it); `visibilitychange` → `director.visibility(!document.hidden)`; `coach.probe()` at boot and on 'online'. The director owns the profile after creation and draws the game seed from `rng`. `director.applySettings` needs the current Settings; take them from a `store.onSettings` listener.

### src/core/facts.js  [B3]

- (from A1 impl) A forced reply is praised as 妙手. In game B the weak child, in check with 2 legal moves, played 马八进六 and gave the horse away. It was labelled 弃子, counted among 妙手 2 and chosen as 本局最佳. Screenshot: work/A1/gB/p-B-90-over-card.png. A move forced by check should not be brilliant (CONTRACT-NOTES 106).

### src/core/facts.js, src/coach/fallback.js, src/ui/board-view.js, README.md, src/game/strings.js  [C2, G5, B3, X2, T2]

- (from A1 review) The engineer's requests for these files stand as written in their report. I did not re-derive them, except that I saw the caption and the spoken line repeat each other (「炮8进4 架炮」 then 「这步的用意：架炮。」, work\A1\review\L-6-rival-b.png).

### src/coach/brief.js  [C3]

- (from A1 review) In a lost game the proud move was the forced king step one move before the mate (「第14回合的帅五进一最漂亮」, work\A1\review\gB\p-B-90-over-card.png). A move forced by check should not be 本局最佳. I also confirm the engineer's point that the goal sentence appears twice on the card, once in the takeaway text and once in the goal row (same screenshot; work\A1\review\sc\draw-live-b-card.png).

### src/coach/brief.js, src/coach/fallback.js  [C3, C2]

- (from A1 impl) Three wording points seen in play. (1) The caption and the spoken line repeat each other: 「炮8进4 架炮」 then 「这步的用意：架炮。」 (work/A1/s02-f-rival2.png, work/A1/gC/c-C-06-ask-score.png). (2) A trial line read 「兵三进一没危险，可己方九宫有个机会。」, which tells the child their own palace holds a chance (gB/run.log, move 11). (3) The over line ends with 「下一盘小目标——…」 while the card prints the same goal again below (work/A1/gB/p-B-90-over-card.png).

### tests/e2e/*.spec.js  [E1]

- (from CL review) E1: the local game-over line and the 下一盘注意什么？ answer read 「下一盘小目标——…。」 and 「下一盘记住一件事——…。」; the local 对方想干什么？ answer can end with 「不过这步有漏洞。」 / 「不过这步走得偏软。」 / 「不过对方刚才漏看了一步。」; 为什么？ on a mistake can be the bare verdict 「【M】是失误。」.
- (from G4 review) For information: after 诸葛亮 has commented on a trial the chips read 这步好不好？ · 对方会怎么应？ · 有更好的吗？ · 为什么？ (why last). After an answer to a chip, 为什么？ comes first, followed by the chips not used yet. The engineer's other notes for E1 stand.
- (from G4 impl) For information: a new game's first event is `start` with mode 'auto' (one request when the proxy is on); a restored or undone position opens its thread 'silent' (no request). A trial confirmed before its assessment has no packet, so the 「我上一步怎么样？」 chip is absent on the next turn. 为什么？ after the game never produces a request.

### tests/e2e/helpers.js, tests/e2e/*.spec.js  [E1]

- (from A1 review) For information. (1) Between the tap on the start card and the first position there is now one zero-delay timer in app.js; a test that pauses a fake clock before that tap must advance it (runFor), as it already must for the stage's 500 ms wait. (2) Without ?test=1, html[data-ready] appears only after the start choice. (3) Playwright lists every answered POST /api/coach as requestfailed net::ERR_ABORTED; assert on /api/mock/stats instead. (4) My scenario files in work\A1\review (rv-scenarios.mjs, rv-mock.mjs, rv-tap.mjs, rv-dead.mjs) can serve as a base next to the engineer's.
- (from A1 impl) For information. (1) Without ?test=1, html[data-ready] is set only after the start choice; with it, about 320 ms after navigation. (2) Playwright reports every answered POST /api/coach as requestfailed net::ERR_ABORTED because the client cancels the reader after `done`; assert on /api/mock/stats instead. (3) window.__yijian.tasks is a copy whose stats() adds speedClass and perftNps. (4) The chip row of the phone layout scrolls sideways; scroll a chip into view before tapping. (5) Three paced local lines need up to about 8 s to all appear. (6) Scripts that can serve as a base are in work/A1: lib.mjs, bot.mjs, scenarios.mjs, scenarios-mock.mjs.

### src/game/director.js  [G4]

- (from A1 review) I confirm the engineer's point: after game over the top bar shows the round that will not be played (第 15 回合 beside 共 14 回合 in work\A1\review\gB\p-B-90-over-card.png; 第 61 beside 共 60 in work\A1\review\sc\draw-live-b-card.png).
- (from A1 impl) After game over the top bar shows the round that will never be played: 第 22 回合 while the card says 共 21 回合 (work/A1/gB/p-B-90-over-card.png). Also, for information: after a win with no goal the over chip set holds only 「我哪步下得最好？」 (work/A1/gA/a-A-91-after-card.png).
- (from CL review) For information (G4), unchanged from the engineer's report: TryPacket.chance is 'taken' only for a move judged good or better; a Threat may carry prep: true and name 'check_fork'; opp.quality is slip for any rival move that gave up 150 cp or more and soft above 50. After the review a threatened check without a target is slightly more frequent among severity-rook threats. No call or signature changed.
- (from CL impl) For information (G4): TryPacket.chance is 'taken' only for a move judged good or better now; Threat may carry prep: true and name 'check_fork'; opp.quality is slip for any rival move that gave up 150 cp or more (overlooks included) and soft above 50. No call or signature changed.

### src/game/strings.js  [G5]

- (from A1 impl) If the owner wants the fault toast in the strings table, add a key and tell A1; today the text is a private constant in app.js (see contractIssues).

### server/prompt.js  [S2]

- (from G4 review) Low priority, for S2 / CL or the owner: renderTurn prints 轮到小主公走 also in a game-over thread. The director no longer sends a rival move as 对方刚走 when the child moved last, but the 'child to move' sentence is still printed for a finished game. Consider leaving it out when the thread's first event is `over`.

### README.md  [T2]

- (from A1 impl) The hand check of 14.9 reads window.__yijian.tasks.stats().speedClass under ?test=1. A plain static host without config.json logs one 404 in the console and plays with the local strategist. When the server has no key, the settings sheet says 服务器没有配置密钥.

### scripts/coach-bench.js  [T2]

- (from CL review) TR: the prompt's threat line has a second form for a threat that does not stand yet (对方想走【M】，走完之后…（这个威胁现在还没有形成，要等这步走完才有）); a grounding check that parses the threat line should accept both.
- (from CL impl) T2: the prompt's threat line has a second form for a threat that does not stand yet (对方想走【M】，走完之后…（这个威胁现在还没有形成，要等这步走完才有）); a grounding check that parses the threat line should accept both.

### src/ui/board-view.js  [X2]

- (from A1 impl) Minor: in the phone layout the step badge of ghost play (「2/2」) lies over the file labels at the top-left corner (work/A1/gC/c-C-09-ask-reply-b.png).

### src/ui/stage.js, src/ui/hud.js  [X8, X7]

- (from A1 review) A double or triple tap on 开战 falls through to the board once the start card is gone and selects the centre pawn under the button. Ignore board taps for a moment after the start overlay closes (the hud already has TAP_GUARD_MS = 350), or keep the board non-interactive until the deal has landed. Screenshot: work\A1\review\sc\double-tap-start-ERROR.png.

### scratchpad/design/CONTRACT-NOTES.md

- (from CL review) Owner: rule on the engineer's readings (above all the quality thresholds 15 / 50 / 150 and 'taken' under both clauses) and on my two: a balance that reads 大致相当 is never the reason of a bad verdict; a fork of the pass search is told as a fork only when the move creates the double attack. Also decide whether a quiet move that threatens mate at a price should be listed when nothing new is attacked, and record the final wording of the changed sentences (sections 4.11 and 8.6 no longer match the code).
- (from CL impl) Owner: please rule on the readings listed under contractIssues, above all the quality thresholds 15 / 50 / 150, 'taken' needing a good verdict under both clauses, and prep on a threatened check; and record the final wording of the changed sentences (sections 4.11 and 8.6 no longer match the code).

### src/core/codes.js

- (from A1 review) For the owner: HABIT_FIX.miss_threat reads 「对方走完，先问自己：它想干什么」. CONTRACT-NOTES 113 says the rival is never 它; 他 would fit. The file is frozen, so this is the owner's call.
- (from CL review) Owner (F0), already reported by CF, GS and the engineer: HABIT_FIX.miss_threat says 它 for the rival and holds the colon the dash now precedes; HABIT_FIX.miss_mate says 对方的将 for a black child.
- (from CL impl) Owner (F0), already reported by CF and GS: HABIT_FIX.miss_threat still says 它 for the rival and holds the colon that the dash now follows; HABIT_FIX.miss_mate says 对方的将 for a black child. Unchanged here.

### tests/fixtures/coach/opp.json

- (from CL review) Optional (C1 / owner): no fixture carries a Threat with prep: true; validator, narrator and renderer are tested with hand-built packets and real positions instead.
- (from CL impl) Optional (C1 / owner): no fixture carries a Threat with prep: true; the validator, the narrator and the renderer are tested with hand-built packets instead.

## Part 3. Left unverified or not done, by package

### A1  (impl: done; review: done)

- Nothing was run on a real iPad or in Safari; every browser check is headless Chrome on the build machine. Whether the start tap on an iPad hits the case the fix addresses could not be observed, only reasoned from CONTRACT-NOTES 127.
- No real LLM call was made; the live coach path was exercised only against the mock proxy. Sound was not heard.
- A game as black was played for 7 plies with a reload and an undo, not to the end.
- The whole-game runs and the timing run on the mock were not repeated after the final comment-only edit of app.js; the type check and a syntax check were.
- `npm run build` and `npm run check` were not run in the repo, by rule; the build script was run on a scratch copy only.
- [minor, not fixed] src/ui/stage.js, src/ui/hud.js (not A1's files): Three quick taps on 开战 start one game, but the last tap falls through to the board once the card is gone and selects the centre pawn that lies under the button (phase 'selected' at ply 0). Harmless, but a child who double-taps starts with a piece lifted. Screenshot: work\A1\review\sc\double-tap-start-ERROR.png.
- [minor, not fixed] src/coach/brief.js (not A1's file): In a lost game the card named the forced king step one move before the mate as 本局最佳: 「第14回合的帅五进一最漂亮」. Screenshot: work\A1\review\gB\p-B-90-over-card.png.
- [minor, not fixed] src/core/codes.js HABIT_FIX.miss_threat (frozen F0 file): The goal text 「对方走完，先问自己：它想干什么」 calls the rival 它, which CONTRACT-NOTES 113 rules out. It is the contract's literal string. Seen on the draw card: work\A1\review\sc\draw-live-b-card.png.
- [minor, not fixed] work\A1\steps-gameC.mjs (the engineer's scratch script, not the package): Its retract stage hard-codes the trial 马八进七; when the scripted child's first move is 炮二平七 the trial is illegal and the stage reports a failure. Not a fault of the app; retract was checked in the mock scenarios before and after the fix.

### CL  (impl: done; review: done)

- Nothing of the eight items is open.
- Not verified outside Node: no browser, no director, no real model; the simulation uses stand-ins for the brain's jobs (depth 4), not brain.js.
- Owner rulings pending on the readings listed under contractIssues.
- Not fixed, outside the eight items: no unsolicited row below level 4 for a threatened check of severity rook or piece; 我上一步怎么样？ on a mistake with a flaw still appends the move's effect; the odd contract rows the engineer listed (pouch 1 for chance/attack, pouch 2 for improve/quiet, opp.effect variant 5, opp.chance for the own palace, a pawn capture read before a piece-sized threat).
- Cost of item 1, as the engineer reported: the rank sentence of the local game-over line is dropped in 99 of 20,160 combinations that were exactly 80 characters with the colon.
- npm run build and npm run check were not run (not allowed for this package); nothing was committed.
- [minor, not fixed] src/coach/brief.js threatsOf: a quiet first move that threatens mate while its line wins material, with no new attack to show: Such a threat is not listed at all (the engineer's reading of 'map it to what the line shows'). If no other threat stood, the narrators would say 眼下没有直接的危险. Measured on 590 positions: 10 such moves, 5 not listed, 0 with an otherwise empty list (the capture was listed as a hanging piece each time). Left as built; needs an owner ruling if it should be listed.
- [minor, not fixed] src/coach/fallback.js planOpp, rows opp.threat.q / opp.threat (SPEC 8.6, not in the eight items): A threatened check of severity rook or piece has no target, so below level 4 neither threat row applies and the unsolicited line falls through to captured / effect / quiet while the cue is 「看！」. This was already so before the package; my check fix adds a few such threats (about 1 in 600 turns). The danger and intent answers are correct.
- [minor, not fixed] src/coach/fallback.js rows outside the eight items: Odd lines confirmed while reading, all contract rows the task list does not cover: 「我上一步怎么样？」 on a mistake with a flaw still appends the move's effect (「【马八退九】是漏着：这步没有实际作用，白让对方走一步。这步调整了一下阵形。」); pouch 3 on a move that stops a mate says 「调整了一下阵形」; the intent row gives 「…大致相当」 for a threat that nets a pawn; 「留神{by}的去向」 when the named piece is not the one that moves; plus the engineer's own list (pouch 1 for chance/attack, pouch 2 for improve/quiet, opp.effect variant 5, opp.chance for the own palace).

### G4  (impl: done; review: done)

- Not run in a browser and not against the real stage (src/ui/stage.js); the order of stage calls is checked against the fake stage and, in scratch, with real ports, brain and client. A1 and E1 cover the rest.
- exportRecord / exportBackup were not executed (record.download needs a DOM); they are three-line adapters.
- No real LLM call was made; the live path was exercised against C4's strict fake proxy only.
- A confirm inside the 400 ms brief wait skips memory.noteOpp for that rival move (practically unreachable; see found).
- After a failed assess job the trial chips stay visible but inert until the child moves on or retryEngine runs.
- The rival's mood on his own mating move can be `smug` (no line) when the child's previous move was not judged a slip; owner's call (see contractIssues).
- actions.ask does not refuse proud / improve / next when the over packet has no data for them; the chips are not offered, so the stage cannot send them.
- A child sample that is still pending when the page is reloaded during the rival's thinking is lost (that move has no sample); MoveSample.test stays null when no survey finished (CONTRACT-NOTES 85).
- [minor, not fixed] src/game/director.js onChildCommit / E-turn: A confirm inside the 400 ms the brief waits behind the rival's move leaves that turn's brief unbuilt, so `memory.noteOpp` is not called for that rival move and a 'punished' moment can be lost. Needs select, target and confirm within 400 ms of the rival's move, which the tap guard practically excludes. Left as is.
- [minor, not fixed] src/game/director.js trialScript (assess job failed): After a failed assess job (error or timeout) the trial chips stay up but are inert until the child moves on or the engine is retried. The contract only says the provisional face stays and nothing is said. Left as is.
- [minor, not fixed] src/game/director.js onRivalCommit (TASK-NOTES 17c): On the rival's game-ending move only his mood is shown, as 17c allows. That mood can be `smug` when his mate lands on a child move that was not judged a slip. No line is said. Left for the owner.
