export const meta = {
  name: 'yijian-build-wave',
  description: 'Build one wave of work packages of the xiangqi rebuild: an engineer implements each package against the frozen contract, then an independent reviewer checks it and fixes what it finds',
  phases: [
    { title: 'Implement', detail: 'one engineer per work package' },
    { title: 'Review', detail: 'one independent reviewer per package, who also fixes' },
    { title: 'Integrate', detail: 'optional whole-tree check after the wave' },
  ],
}

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi'
const SCRATCH = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad'
const SPEC = SCRATCH + '\\design\\SPEC.md'
const TOC = SCRATCH + '\\design\\SPEC-TOC.txt'
const NOTES = SCRATCH + '\\design\\CONTRACT-NOTES.md'

const COMMON = `PROJECT
You are one of several engineers rebuilding 弈间, a Chinese chess (xiangqi) web game, into a game that teaches 9 to 12 year old children. The child (小主公) plays against a teaching opponent (司马懿) with a strategist companion (诸葛亮) who comments on tentative moves, answers questions and gives hints. Static frontend in vanilla ES modules (no framework, no bundler, JSDoc types checked by tsc), search engine in a Web Worker, a small Node proxy for the LLM. The goal of the whole product: make children fall in love with xiangqi.

THE CONTRACT
- Build contract: ${SPEC} (about 6,450 lines, too large for one Read call; use offset and limit). Table of contents with line numbers: ${TOC}. Read the TOC first.
- Always read lines 1-248 (reading rules, vocabulary, decisions log, file tree and owners, import rule) and lines 5816-5898 (work packages).
- Readings already chosen for ambiguities, and owner decisions: ${NOTES}. Read its sections A, I, J, K, L, M, N and O and every item its "Index by package" lists for your package. They are binding.
- What the finished packages of earlier waves decided and what they ask of later packages: the WAVE*-NOTES.md files in the same folder as CONTRACT-NOTES.md (Part 1 readings by package, Part 2 requests grouped by the file they concern, Part 3 what was left unverified). Read Part 1 for every package you build on and every Part 2 entry that names one of your files; they are long, so search them for your file names.
- The contract is frozen. Names, signatures, numbers and Chinese strings come from it literally. Do not invent exported names. Where the contract is ambiguous or contradicts itself and the notes do not settle it, choose the reading most consistent with the typedefs of section 3 and the signatures of section 4, and report it under contractIssues. Never improvise silently.

REPO AND RULES
- Repo: ${REPO} (Windows 11, Node 24, npm 11, branch kids-coach). Work directly in this tree. Other engineers are editing other files in it at the same time.
- Edit only the files of your package. If a file that is not yours needs a change, report it under needsFromOthers instead of editing it.
- Never run git commit, push, stash, reset, checkout, restore, clean, add, or switch branches.
- Never open, print, copy or modify the file .env.local, and never read anything under C:\\Users\\USERNAME\\Downloads. No network calls, no npm install, no new dependencies, no real LLM calls.
- Do not run "npm run build" or "npm run check" (they rewrite dist/ while others work); only the tooling package T1 and the integrator do.
- Temporary files and experiments go under ${SCRATCH}\\work\\<your package id>\\ and never into the repo.
- If you start a server or a browser, bind to 127.0.0.1, use only the port given to you, and stop it before you finish. Leave no background process running.
- Identifiers and code comments in English. Child-facing text in Chinese exactly as the contract gives it. Source files are UTF-8 without BOM with LF line endings (the Write tool may produce CRLF on this machine: check your files and convert).
- Because others are mid-edit, a whole-project type check or test run can fail in files that are not yours. Judge your work by your own files and tests.
- MEMORY SAFETY (three runs of this build were lost to it). A scratch script once started a test process that grew by 1.5 GB per second; at 50 GB Windows ran out of memory and every engineer's session died. So: every node process you start for anything that is not a plain, known-good run (a scratch script, a simulation, a soak, a mutation or fuzz run, a test file you or a colleague are in the middle of changing, a loop "until ...") runs under the memory guard: put   NODE_OPTIONS="--import file:///C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/tools/memguard.mjs" MEM_LIMIT_MB=3000   in front of the command (the variables reach every node process the command starts, also the ones behind node --test and spawnSync; choose a lower limit when you can), and give the whole command a timeout. The guard kills a process that passes the limit and prints a line starting with MEMGUARD. If that happens to you, it is a finding of the highest importance: write the exact command and the state of the files into your progress file at once, then find the cause (usually a loop or a test that never ends when the code under test misbehaves; a test must fail, never hang and never allocate without bound). A machine-wide watchdog also kills any node process above 8 GB; if one of your processes dies without a message, suspect that. A timeout on spawnSync or on node --test kills only the runner, not the test process behind it.
- Your run can be cut off without warning (it has happened three times). Keep a progress file so that a colleague can continue where you stopped: ${SCRATCH}\\work\\<your package id>\\PROGRESS.md for an engineer, PROGRESS-REVIEW.md in the same folder for a reviewer. Append a few lines after every milestone and at least every fifteen minutes of work: what you finished, what you verified and with which result (numbers, test counts), what you decided and why, and what you were about to do next. If such a file from an earlier run is there, read it first and continue from it.
- If the port given to you is already taken, it is a static server left behind by a colleague whose run was cut off: find the process that listens on that port, check that it answers like the static server (it serves the repo's files), stop it, and start your own.
- On this machine tasklist, taskkill, Get-CimInstance and Get-NetTCPConnection can hang for minutes. Do not use them. Find a listener with: netstat -ano | grep LISTENING | grep :<port>   and stop a process with: node -e "process.kill(<pid>)"   Give every shell command that could hang a timeout.`

function stateBlock(p) {
  const own = p.fix
    ? `Your files are NOT stubs: they hold finished, reviewed implementations written by colleagues in an earlier wave. This is a fix package: change only what the task list in your notes requires, keep every exported name, signature, DOM hook, class name and behaviour that the list does not mention, and keep the existing unit tests of those files green (extend them where a task changes a tested value).`
    : `Your own source files currently hold such stubs: replace the bodies with the real implementation and keep the exported names and signatures exactly. Constants the contract gives literally are already final in the stubs; check them against the contract anyway.`
  return `STATE OF THE TREE
- Wave 0 is finished and frozen: src/core/codes.js (complete), the typedef files src/core/types.js, src/coach/types.js, src/game/types.js, src/ui/types.js, and a stub of every module with its final exported names and signatures (bodies throw 'not implemented'; UI factories return inert objects). ${own} If you are convinced a frozen name, type or signature is wrong, do not change it: work with it and report it under contractIssues.
- Finished and usable packages: ${args.finished}. Every other module may still be a stub or may be half-written by a colleague right now: do not depend on it at run time, and in tests use fakes for it.
- The old v1 code is in legacy/ for reference only (never imported, never edited).`
}

function uiBlock(p, port) {
  return `SEEING YOUR WORK (required: this is a visual package)
You cannot judge a visual component from its code. Use these two helpers:
- Serve the repo: node "${SCRATCH}\\tools\\static.mjs" --root "${REPO}" --port ${port}   (start it in the background; it binds 127.0.0.1 and refuses dot-files; stop it before you finish)
- Capture: node "${SCRATCH}\\tools\\shot.mjs" --url http://127.0.0.1:${port}/${p.page} --out "${SCRATCH}\\work\\${p.id}\\<name>.png" --w 1180 --h 820 --touch [--reduced] [--wait <ms>] [--steps <file.mjs>]
  A steps file default-exports: async ({ page, shot }) => { ... } where page is a Playwright page and shot('name') saves another PNG, so you can click, wait for animations and capture several states in one run. The helper prints console errors, page errors, failed requests and horizontal overflow as JSON, and exits 1 if the page threw.
- Then open each PNG with the Read tool and look at it critically. Do this repeatedly while you iterate, not once at the end.
Check every size your component appears at: 1180x820 (iPad landscape, the primary target), 820x1180 (iPad portrait), 360x740 (phone); the three themes; reduced motion. Touch targets at least 44 px.
The players are 9 to 12 year old children on an iPad. The result must look polished, warm and exciting, like a finished game, not like a developer demo. If a screenshot looks wrong, cramped, misaligned, clipped or dull next to what the contract describes, fix it and look again. For animation, capture several frames in sequence (wait 80 to 150 ms between shots) and check the motion reads well.
A dev harness page (dev/*.html) must exercise every state and method of the component with buttons, load ../styles/tokens.css and ../styles/themes.css (written by package X1) plus your own stylesheet, and have a theme switch and a reduced-motion switch.`
}

const REPORT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, outcome: { type: 'string' } }, required: ['command', 'outcome'] } },
    contractIssues: { type: 'array', items: { type: 'object', properties: { specRef: { type: 'string' }, problem: { type: 'string' }, readingChosen: { type: 'string' } }, required: ['specRef', 'problem', 'readingChosen'] } },
    needsFromOthers: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, request: { type: 'string' } }, required: ['file', 'request'] } },
    notDone: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'files', 'checks', 'contractIssues', 'needsFromOthers', 'notDone'],
}

const REVIEW = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    summary: { type: 'string' },
    found: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
      where: { type: 'string' }, problem: { type: 'string' }, fixed: { type: 'boolean' },
    }, required: ['severity', 'where', 'problem', 'fixed'] } },
    checks: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, outcome: { type: 'string' } }, required: ['command', 'outcome'] } },
    contractIssues: { type: 'array', items: { type: 'object', properties: { specRef: { type: 'string' }, problem: { type: 'string' }, readingChosen: { type: 'string' } }, required: ['specRef', 'problem', 'readingChosen'] } },
    needsFromOthers: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, request: { type: 'string' } }, required: ['file', 'request'] } },
    remaining: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'found', 'checks', 'contractIssues', 'needsFromOthers', 'remaining'],
}

// notesFile / reviewNoteFile: long task notes kept in a file, so that a relaunch does not have to resend them
function notesOf(p) {
  const file = p.notesFile ? `YOUR TASK NOTES are in this file: ${p.notesFile}\nRead it completely before anything else. It is part of this brief and as binding as the text here.` : ''
  return [file, p.notes || ''].filter(Boolean).join('\n')
}

function reviewNoteOf(p) {
  const file = p.reviewNoteFile ? `Read this file first, completely: ${p.reviewNoteFile}\nIt tells you what happened to this review before you and what you are expected to do about it.` : ''
  return [file, p.reviewNote || ''].filter(Boolean).join('\n')
}

function implPrompt(p) {
  return `${COMMON}

YOUR PACKAGE: ${p.id}, ${p.title} (wave ${args.wave}). Find its row in section 15: it lists your files, what it depends on and its done-criteria.
Files you own and may edit or create: ${p.files}
Read these contract sections completely before writing code (find the line numbers in the TOC): ${p.read}
${notesOf(p)}

${stateBlock(p)}

HOW TO WORK
${p.fix ? `- Do every item of the task list in your notes, completely. For each item: read the code involved and the contract passage it refers to, make the smallest change that fully solves it, and prove it (a unit test where the thing is testable in Node, otherwise screenshots or measurements in the browser, before and after).
- Do not refactor, rename or restyle anything the list does not ask for. If an item turns out to be wrong or impossible as stated, do the closest thing that serves its stated purpose and report it under contractIssues.
- Run the existing unit tests of every package whose file you touched (node --test tests/unit/ui/*.test.js and any other that covers your files) and both type checks; they must stay green for your files.
- You are done when every item is solved and verified and nothing else changed.` : `- Implement everything your contract sections describe for your files: every function, every table row, every number, every Chinese string, every edge case. No TODO, no placeholder, no "simplified for now".
- Write the unit tests that section 14 lists for your package, with the test names it gives, plus any test needed to prove your done-criteria. A test must check behaviour the contract describes, with expected values taken from the contract or computed independently; it must not copy the implementation's output.
- Check with: node --test <your test files> ; npx tsc -p tsconfig.json ; npx tsc -p tsconfig.node.json. In the type check only errors located in your files count, and there must be none. Do not use any, ts-ignore, ts-expect-error or ts-nocheck to get there.
- You are done when the done-criteria of your row are met and you have verified each of them, your tests pass, your files type-check, and the import rule of section 2 holds for your files.`}
${p.ui ? '\n' + uiBlock(p, p.port) + '\n' : ''}
FINAL REPORT
status (done, partial, blocked), summary (what works, what you verified and how, anything you are unsure about), files, checks with outcomes (include test counts), contractIssues, needsFromOthers, notDone. Be factual: if something is not verified, say so.`
}

function reviewPrompt(p, impl) {
  return `${COMMON}

YOUR ROLE: independent reviewer of work package ${p.id}, ${p.title} (wave ${args.wave}). An engineer has just implemented it; their report is at the end. Treat the report as claims to check, not as facts. You have the same ownership as the engineer: you may edit the package's files and no others.
The package's files: ${p.files}
Read these contract sections completely (line numbers in the TOC): ${p.read} ; also the package's row in section 15 and the tests section 14 lists for it.
${notesOf(p)}

${stateBlock(p)}
(For you, "your own files" means the files of package ${p.id}, which now hold the engineer's ${p.fix ? 'changes on top of the earlier implementation' : 'implementation instead of stubs'}.)
${p.fix ? `
This is a fix package: judge it against the task list in the notes above. For every item decide independently whether it is really solved (look at it yourself: run it, screenshot it, measure it), whether the change broke anything next to it, and whether anything outside the list was changed without need (check with: git diff --stat and git diff on the package's files; git diff is read-only and allowed). Then fix what falls short.
` : ''}
REVIEW, THEN FIX
1. Read every file of the package in full${p.fix ? ' (for large files: every part the engineer touched, with enough of its surroundings to judge it)' : ''}. Run its tests and the type check yourself (node --test <files>; npx tsc -p tsconfig.json; npx tsc -p tsconfig.node.json; only errors in the package's files count).
2. Compare with the contract item by item, and look specifically for:
   - behaviour that differs from the contract: numbers, names, Chinese strings, table rows, order of effects, edge cases, and things the contract requires that are simply absent;
   - done-criteria of the section 15 row that are claimed but not actually met;
   - tests that section 14 lists and are missing, and tests that pass without proving their claim (assert too little, compare the code with itself, skip the hard case);
   - real bugs: wrong side or colour, mirrored coordinates, off-by-one, state not reset, unhandled promise rejections, timers or listeners that leak, races on cancel or abort, wrong behaviour on empty or extreme input;
   - import-rule violations, leftovers (TODO, console.log, dead code, commented-out code), any, ts-ignore.
   Write a few adversarial tests of your own for the riskiest behaviour and keep the valuable ones.
3. Fix everything you find, in the package's files only, then re-run the tests and the type check. Do not rewrite working code for taste.
${p.ui ? '\n' + uiBlock(p, p.port + 20) + '\nLook with fresh eyes: compare what you see with what sections 10 to 12 describe, at all three sizes and in all three themes, and fix what falls short.\n' : ''}
FINAL REPORT
status (done = you consider the package finished to the contract; partial = known gaps remain), summary, found (one entry per problem: severity critical, major or minor; where; what; whether you fixed it), checks with outcomes and test counts, contractIssues, needsFromOthers, remaining.

${reviewNoteOf(p) ? `
BEFORE YOU START
${reviewNoteOf(p)}
` : ''}
THE ENGINEER'S REPORT
${p.implReportFile ? `The engineer finished in an earlier run. Read the full report first, from this file: ${p.implReportFile}` : impl ? JSON.stringify(impl, null, 1) : 'The engineer run failed and left no report. The files may be partial or still stubs. Complete the package yourself first (same instructions as the engineer: implement everything, write the section 14 tests), then review it.'}`
}

const pkgs = args.packages
log(`wave ${args.wave}: ${pkgs.map(p => p.id).join(', ')}`)
const implDone = {}
const runs = pkgs.map(p => {
  const deps = (p.after || []).map(id => implDone[id]).filter(Boolean)
  // implReportFile: the engineer finished in an earlier run (its report is in that file); only the review runs now
  const impl = p.implReportFile
    ? Promise.all(deps).then(() => null)
    : Promise.all(deps)
      // a package that waits for others gets their engineers' reports at the end of its brief
      .then(reports => agent(implPrompt(p) + (reports.some(Boolean) ? `

REPORTS OF THE PACKAGES YOU BUILD ON (${(p.after || []).join(', ')}): their engineers finished just now; their reviewers are at work at this moment and may still change details in those files, so read the files themselves too.
${JSON.stringify(reports.filter(Boolean), null, 1)}` : ''), { label: `impl:${p.id}`, phase: 'Implement', schema: REPORT }))
      .catch(() => null)
  implDone[p.id] = impl
  return impl.then(r =>
    agent(reviewPrompt(p, r), { label: `review:${p.id}`, phase: 'Review', schema: REVIEW })
      .catch(() => null)
      .then(rev => ({ id: p.id, impl: r, review: rev })))
})
const results = await Promise.all(runs)

let integration = null
if (args.integrate) {
  phase('Integrate')
  integration = await agent(`${COMMON}

YOUR ROLE: integrator of wave ${args.wave}. All packages of this wave (${pkgs.map(p => p.id).join(', ')}) have been implemented and reviewed. For this task only, the rule against "npm run check" does not apply to you, and you may edit any file owned by a package of this wave.
${stateBlock({ fix: true })}
Do:
1. Run "npm run check" (type check on both tsconfigs, all unit tests, the build). Make it green. Fix causes, not symptoms: when two packages disagree, the contract decides. Never weaken a type, never delete or skip a test to get green, never touch frozen wave 0 files (codes.js, the types.js files) or files of packages outside this wave; report those under needsFromOthers.
2. ${args.integrate}
3. Confirm no commit was made (git log -1) and that .env.local is still ignored and untouched (git check-ignore .env.local; do not open it).
Report: status, summary, files changed, checks with outcomes (final "npm run check" with test counts), contractIssues, needsFromOthers, notDone.

PACKAGE REPORTS (reviewers' findings and what remains)
${JSON.stringify(results.map(r => ({ id: r.id, implStatus: r.impl && r.impl.status, implNotDone: r.impl && r.impl.notDone, implNeeds: r.impl && r.impl.needsFromOthers, reviewStatus: r.review && r.review.status, remaining: r.review && r.review.remaining, reviewNeeds: r.review && r.review.needsFromOthers })), null, 1)}`,
    { label: 'integrate', phase: 'Integrate', schema: REPORT }).catch(() => null)
}

return { wave: args.wave, results, integration }
