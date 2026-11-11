export const meta = {
  name: 'yijian-closing-review',
  description: 'Closing review of the xiangqi rebuild: read-only reviewers on the seams of the last packages, then an independent verifier per dimension tries to refute every finding',
  phases: [
    { title: 'Review', detail: 'one reader per seam, read-only' },
    { title: 'Verify', detail: 'an independent engineer tries to refute each finding' },
  ],
}

const SCRATCH = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad'
const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi'
const NOTES = SCRATCH + '\\work\\CR\\NOTES.md'

const DIMENSIONS = [
  {
    key: 'turn',
    port: 5341,
    title: 'The turn machine and the engine tasks',
    files: 'src/game/director.js, src/game/tasks.js, src/game/ports.js, src/core/brain.js (every job except `opponent`), src/game/policy.js, src/game/record.js',
    read: 'SPEC sections 5.1 to 5.8 (the director, its phases and the trial flow), 4.25 (the brain jobs and the pinned truth), 4.27 (start-up steps); CONTRACT-NOTES items 135, 146, 147 and 148',
    ask: `Read the director as a state machine driven by events that arrive in any order: the child taps, a worker result comes late, the rival's move arrives, an undo, a resign, a new game, a page that goes to the background and comes back. Questions:
- Can a result of an earlier position (a survey, an assessment, a rival move, a hint) be applied to the current one? Check every place a job result is consumed: is it tied to the ply or an epoch, and what happens to results of a cancelled job?
- Undo, new game, resign and "continue the saved game" while each kind of job is in flight, and while a trial is open, while a pouch is open, while the rival's move is being animated: is any state left behind (a held trial, a pinned truth of the old position, chips of the old turn, a busy flag that never clears)?
- A job that fails or times out (the worker throws, never answers, answers twice): does the turn end in a state the child can leave, and is the failure told once?
- The pinned truth (director.updateTruth) after the PG fix: can the comparison move of a trial be a move that is not legal in the current position, or belong to another ply?
- The sample that is recorded for a confirmed move (the first try, the final move, tries, hint, self): right for a move confirmed before any verdict, after an undo, after a held trial that the child insisted on?
- Timers: is every timer cleared on dispose, undo and new game; can a timer fire after the game is over and speak or move?`,
  },
  {
    key: 'coach',
    port: 5342,
    title: 'The live coach path in the page',
    files: 'src/coach/client.js, src/coach/protocol.js, src/coach/markup.js, src/coach/memory.js, src/coach/book.js, the parts of src/game/director.js and src/game/ports.js that call the client, src/ui/stage.js only where it shows what the coach streams',
    read: 'SPEC sections 4.16 to 4.21 (client, protocol, markup, memory), 6 (the wire: requests, SSE events, errors), 8.3 (caps), 8.7 (cues); CONTRACT-NOTES items 135, 136, 139',
    ask: `Read the path from a coach event in the director to text in the bubble, with the proxy answering well, badly, slowly or not at all. Questions:
- A reply that arrives after the thing it speaks about is gone (the trial was taken back, the rival has moved, the game is over, a new game started): is it dropped, and is the request aborted? Can two replies interleave in one bubble?
- Fallback: for each failure (network error, 4xx with each error code, 5xx, a stream that stops in the middle, a stream with malformed events, a reply that fails validation, a reply over its cap, a reply that names an illegal move) does the child get the local strategist's line exactly once, with no half sentence left from the stream? After failures, when and how does the client try the proxy again?
- Validation of what comes back (protocol.js, markup.js): can text from the model reach the page as HTML, a link, or a move marker that points to a move that is not in the book of this turn? Is every length capped before it is shown or stored?
- What leaves the page: can anything but the turn brief, the events and the typed question be sent (the save, the child's name or age, earlier free text beyond the thread)? Is the typed question capped and is it sent only to the configured base?
- The thread of a turn: after an undo or a second trial, does the model get events in an order that makes sense, and can the thread grow without bound in a long turn or a long game?
- Memory (memory.js): what is kept between games, is it bounded, and can a corrupted stored value break start-up?`,
  },
  {
    key: 'proxy',
    port: 5343,
    title: 'The proxy and the local server (security and robustness)',
    files: 'server/coach-handler.js, server/guard.js, server/prompt.js, server/provider.js, server/sign.js, server/config.js, server/mock.js, scripts/serve.js, scripts/build.js (the secret scan and what goes into dist)',
    read: 'SPEC section 6 (the wire), 7 (the proxy: limits, errors, the tool loop), 13 (the server and the build); CONTRACT-NOTES items 140, 145',
    ask: `This server runs on a family PC, reachable from the home network when started with --host 0.0.0.0, and holds an API key. Read it as an attacker on the same network, as a hostile web page open in a browser on the PC, and as a child typing anything into the question box. Questions:
- The key: can any response, error text, log line, header or built file contain the key, the gateway address or the signing key? What is logged about a request, and can a typed question end up in a log?
- Host and origin checks (the Host allowlist of item 145, the origin rule, CORS): can a page of another site make the browser call /api and read the answer (DNS rebinding included)? Which Host values pass that should not (ports, trailing dots, upper case, IPv6 forms, a missing header)?
- Static files: path traversal, encoded separators, dot segments, Windows device names, alternate data streams, a symlink out of the root, a request for .env.local, server/, scripts/, tests/, node_modules/ in any spelling and case.
- Limits: body size, JSON depth, number of events, length of every string, time limits for the upstream call, the tool loop's maximum, the rate guard (per address and global; what is "the address" behind --host 0.0.0.0, and can a caller pick its own bucket with a header?). Can one caller make the server hold many open upstream calls or grow memory?
- The prompt: what from the request reaches the model as instruction rather than data (the typed question, move notations, any string field)? Can a typed question make the model reveal the system prompt, or produce text that the page then treats as markup? What does the proxy do with a refusal or a filtered reply?
- The upstream stream: a slow, stalled, huge or malformed upstream reply; a client that disconnects mid-stream (is the upstream call aborted?); errors after the first byte was sent.
- The mock mode and the test hooks: is anything of them reachable in a normal start?`,
  },
  {
    key: 'entry',
    port: 5344,
    title: 'The app entry, the saves and the stage glue',
    files: 'src/app.js, src/config.js, src/game/session.js, src/game/store.js, src/game/ports.js, index.html, the glue in src/ui/stage.js (start card, tap guard, game-over card, fault toast)',
    read: 'SPEC sections 4.27 (start-up), 5.9 to 5.12 (session, store, migration, backup), 10 (layout and stage); CONTRACT-NOTES items 135, 144, 146',
    ask: `Read start-up and persistence as they meet real devices: an iPad that puts the tab to sleep, storage that is full or refused (private mode), two tabs open, an old save, a save from a newer version, a corrupted save. Questions:
- Start-up order: can anything use the engine, the store or the stage before it is ready; what does the child see when the worker cannot start, when storage throws, when a module fails to load? Is there any state in which the start card cannot be left?
- Saves: when is the game written, and can a tab that is killed lose more than the last move? Can a write of one tab overwrite a newer game of another tab? Is a save that fails validation kept aside or silently destroyed? Does migration from the old version (v1) keep what it promises and can it run twice?
- Continue: after 继续上一局 is every piece of turn state rebuilt (whose turn, the rival thinking, a trial that was open, the skill estimate, the pouches used, the goal of the last game)? What if the saved game was already over?
- Backup and restore (export and import of the save): is an imported file validated as strictly as a stored one, and can it carry markup into the page?
- The tap guard after the start card and the game-over card: can a tap fall through to the board or to a button under an overlay in any layout; can the guard leave the board inert for good (for example when the deal animation is skipped, or reduced motion is on, or the tab was hidden during the hold)?
- The page going to the background and coming back (visibilitychange, pagehide, bfcache restore): timers, audio, a rival move in flight, a stream in flight.
- The test hooks (?test=1, window.__yijian): are they unreachable without the query, and harmless with it?`,
  },
  {
    key: 'verdict',
    port: 5345,
    title: 'The assessment after the PG fix and the owner\'s five changes',
    files: 'src/core/facts.js (scoreGap, verdictOf, quickVerdict, assessMove, tacticalTest, habitTraps, hintFor), src/coach/brief.js (isEarned, canBeProud, buildTryPacket only where `only` and `chance` are set, buildOverPacket), src/coach/fallback.js (planTry, nothingToPraise, verdictLadder, the why answers, cueFor, planOver), server/prompt.js (the try directives), src/game/director.js (updateTruth), and their unit tests',
    read: 'SPEC sections 4.5.1 (scores), 4.6.1 (assessMove, thresholds), 4.6.4, 4.14.5 (isEarned), 8.4 and 8.6; CONTRACT-NOTES items 106, 138, 146, 147 and 148 (148 lists what the owner added after the review of PG: these five changes have had no second reader). The snapshot of the tree before PG is ' + SCRATCH + '\\snapshots\\07-post-wave5 ; reports: work\\reports\\impl-PG.txt and review-PG.txt',
    ask: `The rule of this part of the product: 诸葛亮 never praises a move that loses material, never calls a move the best when it is not, and never calls a good move a mistake. Try to break it. Questions:
- The owner's five changes of item 148 (e) to (i): read each in the code and in its test. Is each one right in every case it can meet, and does it have an effect its author did not see (for example: the forced-mate rule in quickVerdict's bounded branch when the bound is a mate score that came from a shallower search than the best move's; canBeProud when bestCp is missing or the sample is from an old save; the grim answer for a move of a held trial; GOOD_GRIM said of a move that was judged good in a position the child is winning by a mile but whose line gives two points back)?
- nothingToPraise and isEarned use different measures (the band 'lost' against 500 cp; the packet's cost against outcome.net). List the packets for which the two disagree and say what the child then sees and hears together (popup, interjection, sentence, answer to 这步好不好？, answer to 为什么？). Is any combination false or self-contradictory?
- scoreGap: mate scores, repetition verdicts (the BAN range), bounds (upper) that are not exact, scores of different depths. Find inputs for which the new difference is wrong in sign or absurd in size, and say whether a real search can produce them.
- Far ahead: the child is 2000 cp or more up. Which moves are now called mistakes or blunders that a human coach would not mind (a move that wins more slowly), and does the compression of verdictOf still protect them? Use real positions: play out a few games with the engine from tests/helpers/positions.js or from the transcripts under ` + SCRATCH + `\\work\\PG\\game and ` + SCRATCH + `\\work\\PF, and run assessMove and quickVerdict on every legal move of five far-ahead and five far-behind positions; report every verdict that a strong player would call wrong.
- The same sentence families through the model's path: read what tryLines prints for a grim packet, a packet with only: true and a cost, a held trial. Does any line of the packet contradict its directive?`,
  },
]

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short id, unique in this report, e.g. T1' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'integer' },
          summary: { type: 'string', description: 'one or two sentences: the defect' },
          scenario: { type: 'string', description: 'what the user does or which inputs arrive in which order, and what then goes wrong' },
          evidence: { type: 'string', description: 'the script you ran and what it printed, or "from reading" with the lines that show it' },
          suggestedFix: { type: 'string' },
        },
        required: ['id', 'severity', 'file', 'summary', 'scenario', 'evidence'],
      },
    },
    checkedAndFine: { type: 'array', items: { type: 'string' }, description: 'questions of the brief that you checked and found in order, one line each with how you checked' },
    notChecked: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'checkedAndFine', 'notChecked'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'intended', 'uncertain'] },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'none'] },
          reason: { type: 'string', description: 'why: the code path, the test or script you ran and its output' },
          fix: { type: 'string', description: 'for a confirmed finding: the smallest correct change, with file and function, and the unit test that would show it' },
        },
        required: ['id', 'verdict', 'severity', 'reason'],
      },
    },
    missed: { type: 'array', items: { type: 'string' }, description: 'defects you came across while verifying that the reviewer did not report (same standard: scenario, place, evidence)' },
  },
  required: ['verdicts', 'missed'],
}

const reviewPrompt = d => `You are a senior engineer doing the closing review of one seam of a finished product. You read and probe; you change nothing.

FIRST read the rules and the background: ${NOTES}
They are binding. The repository is ${REPO}. Your scratch folder is ${SCRATCH}\\work\\CR\\${d.key} (create it). If you need a port, yours is ${d.port} on 127.0.0.1.

YOUR SEAM: ${d.title}
Files: ${d.files}
Read from the contract and the decisions: ${d.read}

WHAT TO LOOK FOR
${d.ask}

HOW
- Read the files of your seam completely before you judge. Follow calls into other files as far as you need to be sure.
- For every suspicion, try to prove it with a short script in your scratch folder or an existing test, under the memory guard. A suspicion you could not prove is reported only if the code path is clear from reading, and you say so.
- Keep a log of what you did in PROGRESS.md in your scratch folder, so that another engineer could continue.
- Report at most the twelve findings that matter most, most severe first. Fewer is fine; none is a valid result if the seam is sound. List what you checked and found in order, and what you did not get to.`

const verifyPrompt = (review, d) => `You are a senior engineer. A colleague reviewed one seam of a finished product and reported the findings below. Your job is to find out which of them are real. Assume each one is wrong until you have seen the defect yourself: reviewers often misread a guard that exists elsewhere, report what the owner decided on purpose, or describe a sequence of events that cannot happen. A finding that survives your attempt to refute it is confirmed.

FIRST read the rules and the background: ${NOTES}
They are binding: you change nothing in the repository. The repository is ${REPO}. Your scratch folder is ${SCRATCH}\\work\\CR\\${d.key}-verify (create it); the reviewer's scripts are in ${SCRATCH}\\work\\CR\\${d.key} (you may read and rerun them, but write your own check for anything that matters). If you need a port, yours is ${d.port + 5} on 127.0.0.1.

THE SEAM: ${d.title}
Files: ${d.files}
Contract and decisions: ${d.read}

THE FINDINGS
${JSON.stringify(review.findings, null, 2)}

FOR EACH FINDING
- Read the code path yourself. Look for the guard, the validation or the decision that would make it harmless (CONTRACT-NOTES items overrule the contract; a comment that says a behaviour is intended, with an item number, makes it "intended").
- Reproduce it: a short Node script against the real modules (tests/helpers has fakes for the ports, the clock and the worker), or an existing test. State what you ran and what it printed. "confirmed" needs either a reproduction or a code path with no way around it; say which.
- Judge the severity yourself: critical = a secret leaks, a save is lost, the game cannot be continued; major = a child or parent meets a wrong statement about the board or a stuck state in ordinary play; minor = rare or cosmetic.
- For a confirmed finding give the smallest correct fix (file, function, what changes) and the unit test that would have caught it. Do not apply it.
Use "uncertain" only when you could neither reproduce nor exclude it, and say what would decide it.
Also report under "missed" any defect you came across that the reviewer did not list, with the same standard of evidence.`

const results = await pipeline(
  DIMENSIONS,
  d => agent(reviewPrompt(d), { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  (review, d) => {
    if (!review || !Array.isArray(review.findings) || review.findings.length === 0) {
      return { key: d.key, review, verify: { verdicts: [], missed: [] } }
    }
    return agent(verifyPrompt(review, d), { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICTS })
      .then(verify => ({ key: d.key, review, verify }))
  },
)

const out = results.map((r, i) => r ?? { key: DIMENSIONS[i].key, review: null, verify: null })
log(out.map(r => `${r.key}: ${r.review ? r.review.findings.length : 'no report'} findings, ${r.verify ? r.verify.verdicts.filter(v => v.verdict === 'confirmed').length : '?'} confirmed`).join(' | '))
return out
