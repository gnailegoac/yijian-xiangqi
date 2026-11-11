# Wave 5 (E1, TR, PF) and the simulation (TS) notes — readings and requests reported by the packages of this wave

Generated from the workflow journals. Part 1: how each package read an unclear point of SPEC.md (the reviewer's final list). Part 2: what each package asks of a package that comes later, grouped by the file named. Part 3: what each package left unverified. A later package reads Part 1 for the packages it builds on and every entry of Part 2 that names one of its files. Where an entry here contradicts CONTRACT-NOTES.md section I or the "Owner decisions" section at the end of this file, the owner decision wins.

## Part 1. Readings by package

### E1

- **§14.7 flow 13 ("every chip set ... work with zero requests to /api")** — It is not said whether every chip of every set must be tapped. Two over chips (`improve`, `next`) depend on a game history the fixtures do not provide. **Reading:** Every set is shown and at least its distinctive chips are tapped: turn (danger, score, intent, last), trial (good, reply, better, why), after (why), held (all three since my edit), hint3 (试试这步), takeback (悔一步重想), over (every chip offered, which is `proud` in the fixture game, plus 为什么？).
- **§14.7 flow 3 ("after 250 ms", "a tap at 50 ms") vs D-32 (guard 200 ms from landing)** — The reference point of the two times is not given; a tap 250 ms after the trial tap would still be inside the guard (120 ms travel plus 200 ms). **Reading:** The engineer's reading is kept: the early tap comes 50 ms after the trial tap and must do nothing; the confirming tap comes at least 250 ms after landing. `data-ply` must change exactly to 1 and then 2.
- **§14.7 flows 6, 7, 8, 9, 10, 11 (d), 12, 15, 16, 19, 20, 21 as listed in the engineer's report** — The points the engineer reported (Worker double semantics, the inline held-trial save, hooks not in the §4.28.9 table, keyboard emulation through visualViewport, the corrupt v1 record, the choice of moves in flow 12, the worker job kind in flow 21). **Reading:** Checked each against the contract text and the notes; I found no reading that asserts less than the row states and changed none of them.
- **§15 E1 done-criterion ("pass locally and in CI") and §4.30.5 type checking** — CI cannot be run from here, and the two frozen tsconfig files do not include `tests/e2e`. **Reading:** Judged by six local whole runs and a scratch type check with the same compiler options; the frozen configs were not touched.

### PF

- **TASK-NOTES item 4 / CONTRACT-NOTES 138 (4): 'The board takes no tap until the deal has landed'** — The rule names only the board, but what lies under the start card's buttons is not the board in every layout: on the phone 继续上一局 covers the pouches button. **Reading:** While the board is held, #topbar, #underbar, #coach and #actions are inert as well. #overlays is never inert. Chosen over swallowing clicks so that a scripted click waits for the control instead of doing nothing.
- **TASK-NOTES item 4 (350 ms) vs the engineer's burst extension** — 350 ms as the burst extension does not absorb a child's triple tap with gaps of 300 to 400 ms, and an extension without an end can keep a persistent tapper out for good. **Reading:** The owner's numbers stand for the base hold (350 ms after the overlay left, 450 ms from a full-motion deal). A tap during the hold extends it by 500 ms (TAP_BURST_MS), but never past 1000 ms after the overlay left or the deal began (TAP_BURST_MAX_MS). The board and the controls are free at the latest about 1.2 s after the choice.
- **Brief: the row of PF in section 15, the tests section 14 lists for it, a dev harness page** — Section 15 and section 14 have no entry for PF, and no dev page is among PF's files. **Reading:** Judged against TASK-NOTES and CONTRACT-NOTES 138, as the engineer did. No dev page was written or changed.
- **The engineer's readings under contractIssues (isEarned and the sacrifice flag false for a forced move, no proud move when mate was unavoidable, opp.effect only when it fits 18 characters, the rival voice, step tag on the ghost in compact, renderTurn's second parameter, the over directive)** — These go beyond the letter of the items and await the owner's ruling. **Reading:** Left as built: each is unit-tested and consistent with the title or intent of its item. I changed none of them.

### TR (implementer report only)

- **§8.3 budget vs §14.8 failure list (spoken read on at most 40 % of rival moves)** — §8.3 says the budget is checked by coach:bench, but §14.8's list of failure conditions does not include it. In 9 scripted mock games the director's shouldSpeakOpp rule (the contract's printed body) spoke on 40 to 57 % of rival moves, 7 games over 40 %. **Reading:** The bench checks it and prints 超预算 when a game is over 40 %, with no effect on the exit code. Reported as a finding for the owner; README lists it under known limits.
- **§14.8 / §4.12 'ungrounded 【】 notations'** — §4.12 defines ungrounded as unresolvable by the move book even as a legal move, which needs a board. The request fixtures carry no board. **Reading:** Scripted game: the client's own count (the console.warn of markup.js per unresolved notation). Fixtures: a 【…】 whose notation is nowhere in the prompt the proxy builds (buildMessages without the system prompt, plus tool results); this is stricter. The stricter count is also printed for the game, for information only.
- **§14.8 'median first text ≤ 2.0 s for opp / try and ≤ 3.5 s for asks'** — 'asks' is not defined; start, hint and over are not named. **Reading:** 2.0 s bar for opp and try; 3.5 s bar for ask and hint (D-31 calls both questions); start and over are printed with the client's own timer and never fail.
- **§14.8 'the second identical request reports usage.cached > 0'** — With 5 runs per fixture it is unclear whether exactly run 2 must hit the cache; gateways do not guarantee a hit. **Reading:** Per fixture, at least one run after the first must report cached > 0. The bar is skipped when no reply at all reports cached tokens.
- **§8.3 / §14.8 'unsolicited text ≤ 1 200 characters'** — It is not stated whether the interjection (cue) counts, nor whether start greetings and the director's own lines count. **Reading:** Counted: captions, opp lines, try lines (guiding questions included) and over lines as the stage was told them, each with its cue (107 to 151 characters per game). Start, system, hint and ask lines are printed beside it and not counted. The worst of the runs decides. A game that ends early is followed by the next until 30 child moves; the child then resigns so each run has a game-over line.
- **§14.8 'no banned word'** — The contract has two lists: §8.6 (banned in local lines) and the system prompt's 不说 words. **Reading:** The §8.6 list fails the bench. The prompt's four extra words (数据, 军情, 简报, 工具) are counted and printed only.
- **§14.8 with §7.5 client timers** — In the scripted game the client gives up a slow reply at 2.0 / 3.5 s and answers locally; the contract does not say how the bench treats that. **Reading:** Not a failure. Such an exchange enters the first-text numbers with its give-up time, so slowness shows in the medians. Real failures (HTTP refusals, SSE errors, cut streams, module errors, unfinished games) fail a separate 'everything ran to its end' line.
- **§14.8 with §7.9 rate limits** — A full run is about 356 to 400 requests; the default limits are 30 per minute and 600 per day per address, for mock and live alike. **Reading:** Default --pace 2100 ms per request; fixtures wait and resend on 429. A second full run on the same UTC day needs COACH_IP_DAILY raised (documented in the README).
- **§14.8 fixture replay, tool calls** — A live model may call analyze_move on a fixture, but fixtures have no board to analyse. **Reading:** The bench answers every call with error 'busy' and resumes; the whole exchange is one sample. Real tool rounds happen only in the scripted game.
- **TASK-NOTES item 6 (Host allowlist), 'the machine's own host name'** — An iPad usually reaches a Windows PC by name as <name>.local, which is not literally the host name. The refusal's error code and any logging are not specified. **Reading:** <hostname>.local is accepted too (when the host name has no dot). The refusal is 403 {"error":{"code":"origin"}}, an existing code the client already maps. The first three refused Host values of a server run are logged once each on stderr with a pointer to COACH_ALLOWED_HOSTS. A public address literal must be listed.
- **TASK-NOTES item 7 (secret scan)** — Not stated what happens when an env file exists but cannot be read, nor the minimum value length. **Reading:** An unreadable .env / .env.local fails the build, naming the file and the error code. Values under 8 characters are not looked for (same as the environment rule). A leading BOM is stripped. A value present in both environment and file is reported once, under the environment's name.
- **TASK-NOTES item 5 (log lines)** — Three other lines of serve.js still print e.message: '[http]', '[coach] the proxy is not available…' and the CLI's start-failure line. **Reading:** Left as they are, since the item names only [api] and [unhandledRejection]; these three carry static-file, module-import and listen errors, not SDK errors.
- **TASK-NOTES item 3 ('no personal name may appear anywhere')** — The old README linked the GitHub Pages site by a URL that contains a personal GitHub handle. **Reading:** Replaced by the placeholder https://<你的 GitHub 用户名>.github.io/yijian-xiangqi/. The owner can restore the link.
- **D-27 / §7.10 checkOrigin (observation, nothing changed)** — An Origin of https://192.168.1.50:5173 with Host 192.168.1.50:5173 is accepted, because only host and port are compared. **Reading:** Contract behaviour; serve-coach.test.js does not assert the opposite.

### TS

- **CONTRACT-NOTES 59 (sim.js has no contract exports) against TASK-NOTES requirement 5** — The pure parts and the observer cannot be unit-tested without exports, and the contract names none. **Reading:** scripts/sim.js exports only what its test imports: PAIRINGS, DEVICES, DEFAULT_PATH, gameSeed, parseArgs, defaultJobs(processors?), summarize, judgeBars, failedBars, tableLines, barLines, runSimulation, and since the review newWatch and observe. Nothing else in the repo uses them.
- **SPEC section 15, row T2 ("npm run test:sim meets the simulation thresholds") against CONTRACT-NOTES 130, last sentence** — The done-criterion asks for the thresholds to be met; item 130 says that when a bar fails with the real brain's depths the numbers are reported and teacher.js is not touched. **Reading:** Item 130 governs what the package does: the script and its report are complete. The status is reported as partial because the bars are not all met; nothing remains to do in the package's files.
- **CONTRACT-NOTES 130, "--games n gives a quick look ... applies only the bars marked †"** — It is not said from which n every bar applies. The percentage rails are †, so in a quick look one case decides them: 1 of 8 games is 12.5 % against 2 % for rail (i), and one lucky win in 8 plain-C games gave eval -340 against -400. **Reading:** Fewer than 64 games per pairing is a quick look; from 64 on every bar applies; the † bars are applied literally. A quick look therefore often exits 1. The owner may want a minimum sample for (i), (k), (l) and the plain bar.
- **CONTRACT-NOTES 130, "at least half of the child's wins end in a mate the child played †" and the rails (h) to (l)** — It is not said whether these are judged per pairing or over all games. The harness's agg.mjs flagged the mate share per pairing; the BT reports give the rails pooled. **Reading:** One bar each over all games against the teaching rival (plain pairings excluded): (i) as a share of games, (k) of rook recaptures, (l) of rival moves made while 600 cp or more ahead. A pairing not played has no bar; a share of nothing prints 无数据 and does not fail.
- **CONTRACT-NOTES 130, "the child's first capture comes at or before ply 14 at the median †"** — It is not said for which pairings, what a game without a capture counts as, or whether the ply is counted from 0 or 1. **Reading:** Each of the four first-game pairings, as agg.mjs did; a game without a capture counts as later than 14; ply counted from 0, as the harness that produced the reached numbers.
- **TASK-NOTES requirement 3 (list of options) against requirement 1 (compare the two ways of finding the rival's move)** — The option list has no way to choose the rival's path, and item 130's "the real brain's depths" does not name a device class. **Reading:** One more option, --path table|slow|mid|fast, default mid (the real opponent job, about 15 minutes). The unit test pins the default so a change is deliberate. Whether the default should be fast (about 30 minutes, clearly lower scores) is the owner's call.
- **CONTRACT-NOTES 124 (h) to (l) as counted by work/BT/review/sim.mjs, when the rival is the brain** — The harness judged the rival's move on a depth-5 table. The brain looks deeper (6 to 8), so a move the observer's table calls worse may be as good by his own search. **Reading:** With a brain path a move counts as worse than an alternative only when the rival's own search agrees (choice.loss above 60 cp); the table path counts exactly as the harness. Rails (h), (j) and (l) do not depend on this. The reading is now pinned by unit tests at 60 and 61 cp.
- **TASK-NOTES ("the same simulated children R, A, B, C, D, E")** — The pairings of item 130 use bots A to D only. **Reading:** Bots R and E are not in the script. In the brain paths the bot and the observer search with the simulation's own searcher, so the bot does not pick up entries of the rival's deeper table.
- **CONTRACT-NOTES 130 (coached length bar of 85) and 129 ruling 2 (rail (k) binds spar and ease only)** — Coached-D's median length is 87 and 68 on mid, 72.5 and 64.5 on table, 65 on fast: the bar lies inside the spread of one 64-game set. The observer counts (k) in every mode, as the harness did, so a finisher move can count against the 1 % bar. **Reading:** Both applied as item 130 states them; reported, not adjusted.
- **TASK-NOTES requirement 3 and CONTRACT-NOTES 130 (exit code rule)** — Only "non-zero unless the bars are met" and "unknown options are an error with the usage line" are defined. Nothing is said about a result file that cannot be written. **Reading:** An output path that cannot be used is refused before any game with a message and the usage line, exit 2. A write that fails after the run is reported, the conclusion still comes, exit 1.
- **SPEC 4.7.5 (honestDepth row) against 4.8.1 (allDepth 5 / 4 / 3) — for information, not a file of this package** — teacher.js takes the honest move at min(honestDepth, table.allDepth), so the honestDepth of levels 5 to 8 is never reached on a mid device (depth 4) or a slow one (depth 3). **Reading:** Nothing done; the simulation shows the rival as he is. For the owner.

## Part 2. Requests to other packages, by file

### src/core/search.js (B2, for information)  [B2]

- (from TS review) scripts/sim.js builds its virtual devices on two private facts of the search: the clock is read once per 2048 nodes (A3.2 item 2), and calibrate() reads the clock exactly twice per perft run. If either changes, the devices shift. A changed calibration is caught: every game fails with "the virtual device calibrated as ...", and the unit test's slow and mid games fail. A changed poll interval is not caught.

### src/core/search.js, src/core/position.js (B2, for information)  [B2]

- (from TS impl) Every analyze call builds a Position (13 typed arrays) per history FEN twice, once in search.js run() and once in Position.seedHistory. In long games that is several MB of short-lived buffers per search; it is what made a simulation worker hold 150 MB until I limited its young generation. Harmless in the game, a cheap saving if anyone touches that code.

### src/core/facts.js or src/core/teacher.js (owner / BT)  [B3, B4]

- (from PF review) Please look at the case in work/PF/game-local-1.out lines 155 to 161: 车一平三 was judged the best move and praised as 「这步捉子，漂亮」, and the next rival move 卒7进1 took that rook. If the position was already lost and every move counted as best, the praise rows of the local narrator should be off there, as the proud move now is; if not, the assessment is wrong. I did not reproduce the position.

### src/core/teacher.js  [B4]

- (from PF impl) For the owner / BT: gameTakeaways still picks as highlight a forced move or the last 'best' move before an unavoidable mate; brief.js now corrects this for the card. If the highlight is used elsewhere, the same eligibility belongs in bestMoment: not forced (legalCount 1..2), final.cat good or better, bestCp above -2000.

### src/core/teacher.js (owner; I must not change it)  [B4]

- (from TS impl) Decisions needed on what the simulation shows: (1) on the fast plan the weak bots score about 7 points less than item 130's instrument and coached bot A's first game is at 32 to 38 % against the 50 % bar; (2) 12 to 15 % of teaching games (up to 41 % at level 6.5) reach 100 child moves, with the rival shuffling in ease mode while ahead; (3) gifts of 400 to 500 cp, a whole piece, are common at levels 1 to 3; (4) honest depth is capped by the plan's allDepth. The bars for coached-D length (85), coached-A (.30), firstc-A (50 %) and first-B (30 %) lie inside the run-to-run spread of 64 games.

### src/core/teacher.js (owner; not to be changed by this package)  [B4]

- (from TS review) Decisions on what the simulation shows. (1) On the fast plan the weak bots score about 7 points less than item 130's instrument, and coached bot A's first game is at 32 to 38 % against the 50 % bar. (2) 12 to 15 % of teaching games reach 100 child moves. (3) Honest depth is capped by the plan's allDepth. (4) The bars for coached-D length (85), coached-A (.30), firstc-A (50 %) and first-B (30 %) lie inside the run-to-run spread of 64 games; with the default settings (mid, seed 1) the script exits 1 on coached-D length 87 alone.

### tests/e2e/helpers.js, tests/e2e/*.spec.js  [E1]

- (from PF review) For E1, in addition to the engineer's list: after the choice on the start card and during a full-motion deal (also under ?test=1), #topbar, #underbar, #coach and #actions are inert together with the board. Playwright's click and tap wait for an inert control, but a tap on the board during the hold is silently ignored and extends the hold by 500 ms. The hold ends at the latest about 1.2 s after the choice or 1 s after a deal began. Wait for window.__ui.idle() or about 1.3 s before the first board tap.
- (from PF impl) For E1. (1) The board ignores taps until 350 ms after the start overlay has left and, with full motion, 450 ms after a deal begins (also under ?test=1); a tap during that time extends the hold by 350 ms. Wait for window.__ui.idle() or about a second before the first board tap. (2) The local game-over line no longer contains 「下一盘小目标——…」; the goal is only in .hud-over__goal. (3) After a rival move the local line can be absent: a developing, escaping or river-crossing move and the name of a tactic give the caption only; lines such as 「这步的用意：…」, 「对方摆出了…」, 「这是…」 no longer exist. (4) After game over the top bar shows the last round played (equal to 共 N 回合). (5) On his game-ending move .rival[data-mood] is calm. (6) Trial chips disappear when the assess job fails. (7) In the compact layout ghost play shows .piece__tag--step on the ghost and .bv-counter is hidden.

### .env.example  [T1]

- (from TR impl) Add the new optional variable (T1's file). Suggested lines, after COACH_ALLOWED_ORIGINS: # 额外允许用来访问 /api 的主机名，逗号分隔、必须完全一致，不写端口（默认空）。 # localhost、电脑名（含 电脑名.local）、本机和内网的 IP 本来就允许；只有给电脑另起了名字（如 chess.lan）才需要填 # COACH_ALLOWED_HOSTS=

### README.md  [T2]

- (from E1 review) TR: in the section on running tests, say that `npm run test:e2e` reuses a server already listening on 5173, that such a server must be started with `--mock` and the two placeholder variables, and that a kept server hits the daily cap (stop it and let Playwright start its own).
- (from TR impl) Owner: restore the real GitHub Pages link in section 七 if you want it; I replaced it with a placeholder because it contained a personal GitHub handle.

### README.md (package TR, the rest of T2)  [T2]

- (from TS impl) Document npm run test:sim: the options (--games, --seed, --only with pairing names, kinds and weak, --path table|slow|mid|fast, --jobs, --json, --print), the run times on the dev machine (table about 5 minutes, mid about 15, fast about 30 to 35 with 6 workers), the exit codes (0 / 1 / 2), that fewer than 64 games applies only the † bars, and that --path fast should be run as well before a release.

### README.md (package TR)  [T2]

- (from TS review) Document npm run test:sim: the options (--games, --seed, --only with pairing names, kinds and weak, --path table|slow|mid|fast, --jobs, --json, --print); run times on the dev machine (table about 5 minutes, mid about 15, fast about 30 to 35 with 6 workers); exit codes (0 every applicable bar met; 1 a bar missed, a game not finished or a result file not written; 2 usage error, including an output path that cannot be used, which is checked before any game); fewer than 64 games applies only the † bars and often exits 1 because the percentage rails are decided by one case; run --path fast as well before a release.

### scripts/coach-bench.js  [T2]

- (from PF impl) For TR: the over directive changed (it tells the model not to repeat the goal), and the 机会 line has no 在{area} when the area is the child's own palace or back rows. A check that the model's over reply ends with the goal no longer applies; one that it does not contain the HABIT_FIX text would fit.
- (from TR impl) Owner: run the live acceptance. Window 1: npm start (with .env.local, 军师模式 live). Window 2: npm run coach:bench. Estimated half an hour and about 400 requests; use -- --runs 1 for a first look, and -- --json <file> to keep the raw data.

### scripts/sim.js (whoever continues it, optional)  [T2]

- (from TS impl) A coach model for the brain paths that uses the brain's assess job instead of the bot's depth-4 table would make the coached pairings comparable across device classes. I left it out because the task asks for the same simulated children as item 130.

### styles/buddy.css, src/ui/buddy.js  [X5]

- (from E1 impl) Optional, minor: on the phone layout a finger tap on the bubble's left padding beside a caption that starts with a move link is taken by the link (the browser's touch adjustment), so the sheet does not open there.

### dev/chat.html, dev/hud.html  [X6, X7]

- (from PF review) For the owner (repeats the engineer's request, not checked by me): the sample takeaway texts still end with 「下一盘小目标——…」, so the harness card shows the goal twice.
- (from PF impl) For the owner: the sample takeaway texts (dev/chat.html line 194, dev/hud.html line 205) still end with 「下一盘小目标——…」, so the harness card shows the goal twice. Drop the goal sentence from those samples.

### src/ui/stage.js  [X8]

- (from E1 review) PF's reviewer, for information: the file changed at 10:15:47 during my runs; four whole runs after that passed 27/27. Please run `npx playwright test` again after any further change to the board-hold logic.
- (from E1 impl) For information to PF's reviewer, who changed this file at 10:01 (controls inert while the board is held, TAP_BURST_MS 500): the whole suite passed against that state. With ?test=1 and reduced motion nothing is held, and flow 1 waits for #board.is-interactive after 开战！. Please run `npx playwright test` again after any further change to the hold logic.

### legacy/

- (from TR impl) Owner: the folder can be deleted. Nothing in scripts, tests, README, build or type checks needs it (proven in a scratch copy without it).

### playwright.config.js

- (from E1 review) TR / integrator: add `COACH_IP_DAILY`, `COACH_GLOBAL_DAILY`, `COACH_RATE_BURST` and `COACH_RATE_PER_MIN` with large values to `webServer.env` (for example 1000000, 1000000, 1000, 6000). Today a mock server that is kept running answers 429 after about eight suite runs in one UTC day. WAVE3-NOTES (S2 review) asked for the same.
- (from E1 impl) TR / integrator: add to webServer.env COACH_IP_DAILY, COACH_GLOBAL_DAILY, COACH_RATE_BURST and COACH_RATE_PER_MIN with large values (for example 1000000, 1000000, 1000, 6000). Today a kept test server refuses coach requests after about 8 suite runs per UTC day (72 requests per run against a cap of 600) and every LLM-mode flow then fails. A fresh server per run is fine, and the bucket has headroom within one run.

### scratchpad/design/CONTRACT-NOTES.md

- (from PF review) For the owner: please rule on the two readings above (controls around the board held with it; burst extension 500 ms capped at 1 s) together with the engineer's open readings, and decide whether a lost game with no proud move and no goal should say more than 「这盘惜败。」 in the takeaway box.
- (from PF impl) For the owner: please rule on the readings under contractIssues, above all: isEarned and the sacrifice flag false for a forced move; no proud move when mate was already unavoidable; opp.effect spoken only for an effect with a target that fits 18 characters; the `rival` voice with 他的 in the 'not yet' danger sentence; the tap-burst extension of the guard; the step tag on the ghost in the compact layout.

### src/game/policy.js

- (from TR impl) Owner decision: shouldSpeakOpp (the contract's printed rule) makes the strategist speak on 40 to 57 % of rival moves in the scripted 30-move games (9 mock games, 7 over 40 %), against the 40 % budget of §8.3. Either the rule or the budget has to move; coach:bench prints the line as 超预算 and does not fail on it.

### tests/fixtures/saves/

- (from E1 review) G3 / owner, optional: a v2 save of a game one move before its end in which the child made a recorded mistake, so that the over chips `improve` and `next` are offered and flow 13 can tap them. Also optional: a named fixture for the held trial (moves `7774`, `0726`), which flows 7 and 13 build inline.
- (from E1 impl) Optional (G3 / owner): a named fixture for "one move before a hanging piece" (moves 7774 0726, red to move). Flows 7 and 13 build this record inline today.

### tsconfig.node.json

- (from E1 review) Owner (F0 file), optional: add `tests/e2e/**/*.js` to `include` so that `npm run typecheck` covers the end-to-end tests. They are clean today under the same options.
- (from E1 impl) Owner (F0 file), optional: add "tests/e2e/**/*.js" to include so that `npm run typecheck` covers the end-to-end tests. They are clean today under the same options.

## Part 3. Left unverified or not done, by package

### E1  (impl: done; review: done)

- CI: the suite was not run in the GitHub workflow or on Linux with Playwright's bundled Chromium; the in-page time bounds and the fixed-seed recapture of flow 13 are verified on the build machine only.
- Flow 13: the over chips `improve` and `next` are not exercised (never offered in the fixture game).
- Every flow runs with reduced motion; full-motion variants are not exercised (§14.7 allows this).
- Real Safari, a real iPad and sound by ear are the owner's manual check.
- [minor, not fixed] tests/e2e/noproxy.spec.js, flow 13, game-over step: The over chips `improve` and `next` are never offered in the fixture game (`v2-one-before-mate.json`, a seven-ply win with no habit and no goal), so only `proud` and 为什么？ are tapped after the game. Covering them needs a save of a finished or nearly finished game with a recorded mistake; that fixture folder belongs to G3.
- [major, not fixed] playwright.config.js (not an E1 file), `webServer.env`: The proxy's rate limits also count in mock mode (burst 20, 30 per minute, 600 per day per address). The engineer measured 72 coach requests per suite run, so a mock server kept running refuses requests (HTTP 429) after about eight runs in one UTC day and every LLM-mode flow fails. A server started by Playwright per invocation is fresh; my six runs were not affected. `helpers.js` prints this cause after a failed test.
- [minor, not fixed] tests/e2e/*.js vs tsconfig.json and tsconfig.node.json: Neither project config includes `tests/e2e`, so `npm run typecheck` does not cover the end-to-end tests. They are clean under a scratch config with the same options (`work/E1/tsconfig.e2e.json`).
- [minor, not fixed] flows 2, 3, 7, 13, 21 on a slower machine: Unverified outside this machine: the in-page time bounds (150 ms face, 300 ms guiding question, 150 ms cancel acknowledgement), the 250 ms window of flow 3's early tap (it includes the runner's round trip), and the takeback step of flow 13, which relies on the rival recapturing the cannon from a fixed seed. All passed in every run here; a different speed class in CI could change the rival's table.

### PF  (impl: done; review: done)

- Not run on a real iPad or in Safari; every browser check is headless Chrome on the build machine. Sound was not heard and the real model was not called.
- The tap guard of item 4 has no Node unit test (the stage has none); it is verified only by the browser probes work/PF/pf-browser.mjs and work/PF/review/rv-hint-tap.mjs.
- Run 2's non-tap scenarios ran while I made the last edit to stage.js; only run 3 is a full run on the final code. I did not add a fourth run.
- A triple tap with gaps above about 450 ms, or a tap more than about 1.2 s after the choice, counts as a tap of its own and lands.
- Not fixed, outside the items: the odd lines the engineer listed; 「这盘惜败。」 alone in the takeaway box; 「好眼力」 for a two-move choice; the praise of a move that loses the rook in a lost position.
- The whole-game script and the mock-proxy run were not repeated by me; I read the engineer's transcript of the local game instead.
- [minor, not fixed] src/coach/fallback.js over line, hud card: A lost game with no proud move and no goal shows only 「这盘惜败。」 in the box titled 这一局的收获. The engineer listed it too. A warmer sentence needs wording from the owner, so I did not invent one.
- [minor, not fixed] src/coach/fallback.js try rows, seen in the engineer's game-local-1.out lines 157 to 161: 「车一平三这步捉子，漂亮。」 and 「是眼下最好的一步」 were said of a move after which a pawn took the rook (「卒7进1 白吃 对方得了一个车」). Either the position was already lost and every move counted as best, or the assessment was wrong; I did not reproduce the position. Outside the thirteen items.
- [minor, not fixed] src/coach/fallback.js TRY.only: With exactly two legal moves, one of them losing, the local line can still read 「只有【M】能解围，好眼力。」. The popup, interjection, 妙手, great moment and 本局最佳 are all off for such a move; only this sentence remains. Left as the engineer's reading; the owner may want the neutral variant for forced moves.

### TR  (impl: done; review: missing)

- npm run coach:bench against the real gateway: not possible here (no key, no network). Only mock runs were made, so real latency, cached tokens, client give-ups and real tool rounds were never exercised by a run.
- Checks on a real iPad (Safari, both orientations, sound by ear, the first-touch readout of dev/audio.html): the owner's; README section 五 is the checklist.
- npm run build and npm run check in the repository: not run. The build was proven in scratch copies and by build.test.js.
- npm run test:e2e: not run (E1's package).
- legacy/ was not deleted or moved (the owner does that).
- .env.example was not edited (not my file); the line to add is under needsFromOthers.

### TS  (impl: partial; review: done)

- Owner decision on the bars the rival misses on the real path: default mid seeds 1..64 coached-D median length 87 against 85 (exit 1; seeds 1001..1064 meet every bar); fast: firstc-A 38.3 % and 32.0 % against 50 %, matched-A eval -450.9 against -450, matched-B eval -185.8 against -150; slow: firstc-A 45.3 %. Nothing in the package's files can change this.
- Owner decision on the default path (mid, about 15 minutes, against fast, about 30 minutes and what this machine and probably a recent iPad get) and on a minimum sample for the percentage rails in quick looks.
- Not measured by anyone: determinism on a second machine; the fast path on seeds 1001..1064 for the nine non-weak pairings; the slow path beyond the weak pairings of seeds 1..64.
- The full 64-game runs were not repeated in the review, so run time (866 s with 6 workers on mid) and peak memory (384 MB) are the engineer's measurements. My check is 77 sample games identical to the stored runs, and all tables recomputed from the stored JSON.
- Three mutants of scripts/sim.js still survive the unit test: lastChildCapture not passed to teachingContext (covered only by the scratch replay of the BT harness, work/TS/review/cmp-bt.mjs), POLL_NODES, and one near-equivalent case of rail (i).
- Limits of the model, reported and not removed: the simulated coach sees depth 4 on every device (the real assess job looks to depth 7 on fast); the brain's transposition table is not warmed by survey and assess jobs; the virtual device has a constant node rate, and each clock read outside the node search also costs one tick (a few percent of a budget).
- README section for test:sim (package TR).
- [minor, not fixed] tests/unit/scripts/sim.test.js: three mutants still survive: (1) lastChildCapture not passed to teachingContext: not reachable through the exports, covered only by the game-by-game replay of the BT harness. (2) POLL_NODES times four: the script mirrors search.js's private poll interval (Appendix A3.2 item 2); only a golden search depth could pin it. (3) Observer rail (i), "taking does not end the run": differs only when he takes the piece with a capture worth 60 cp less than another capture of it.
- [major, not fixed] src/core/teacher.js as measured by scripts/sim.js (not a file of this package): The rival does not meet every bar of item 130 on the game's real path. Default mid, seeds 1..64: coached-D median length 87 against 85, so `npm run test:sim` exits 1 (seeds 1001..1064 meet every bar). Fast: firstc-A 38.3 % and 32.0 % against 50 %, matched-A eval -450.9 against -450, matched-B eval -185.8 against -150. Slow: firstc-A 45.3 %. I confirmed the numbers from the stored runs.
