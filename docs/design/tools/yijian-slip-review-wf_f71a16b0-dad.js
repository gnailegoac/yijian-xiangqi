export const meta = {
  name: 'yijian-slip-review',
  description: 'Independent review of the owner\'s slip rule for the teaching rival: one reviewer checks code, tests and measures on fresh seeds; one reads printed games for the look',
  phases: [
    { title: 'Review', detail: 'code + tests + measurement, and the look of printed games, in parallel' },
  ],
}

const W = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad'
const NOTES = `${W}\\work\\RT\\slip\\SLIP-NOTES.md`

const REPORT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pass', 'partial', 'fail'] },
    summary: { type: 'string', description: 'The whole report in plain text: what you checked, the numbers as tables, the passages you quote, your verdict. This is the only thing the owner reads.' },
    found: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string' },
          problem: { type: 'string' },
          fixed: { type: 'boolean' },
        },
        required: ['severity', 'where', 'problem', 'fixed'],
      },
    },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { command: { type: 'string' }, outcome: { type: 'string' } },
        required: ['command', 'outcome'],
      },
    },
    forOwner: { type: 'array', items: { type: 'string' }, description: 'Decisions that remain with the owner, each with what you recommend and why.' },
  },
  required: ['status', 'summary', 'found', 'checks', 'forOwner'],
}

const COMMON = `You are reviewing one small, late change to the teaching rival (司马懿) of a xiangqi game for children of 9 to 12 ("弈间"). The rival is meant to make a child love the game: he adapts to the child, and nothing he does may read as "he lets me win". The owner made this change himself after the last package's review, so nobody independent has looked at it yet. You are that independent look: be sceptical, try to show that the change is wrong or reads badly, and say plainly what you find.

Read first, completely: ${NOTES} (what changed, why, the owner's measurement, the house rules: they bind you). Then the two diffs it names. The earlier review that led to the change is ${W}\\work\\reports\\review-RT.txt.

Write your working notes to a PROGRESS.md in your own folder as you go (one line per step, with numbers), so that the work can be picked up if you are interrupted. Your final answer is the structured report; put everything the owner needs into its summary.`

const CODE = `${COMMON}

YOUR PART: the code, the tests, and a measurement on seeds nobody has used for this variant. Your folder: ${W}\\work\\RT\\slip\\code-review.

1. The code (src/core/teacher.js in the private copy ${W}\\work\\RT\\tree). Read the whole of chooseTeachingMove and recordOpponentMove, not only the diff. Questions to answer, each with the evidence:
   - Is the slip exactly what the notes say (no mate at any distance, 300 to 500 cp, no rook for less than a rook, candidates filtered at 500 cp before the five are taken)? Is there a path on which a slip gives more than 500 cp or lets the child mate: a line whose provisional loss is 500 or less and whose verified loss is larger; a line with an upper bound; a repetition verdict; a table whose position cannot be read (board null); verification budget used up; reveal horizons?
   - Moving \`board\` and \`losesRook\` above the finish step: is every later use unchanged (childAt, takes, gains, the plain move, rails i to k)? Does anything now run on the press and finish paths that can throw or cost time (fenToBoard on every call)?
   - Can the mode be 'finish' with eBest below 250 by any road other than the wrap-up (the comment says it cannot)? What about eBest of 250 or more reached through the +600 rule: unchanged?
   - recordOpponentMove: a slip is mode finish, kind finisher. Is the drift rule of the wrap-up still right for it, and aheadRun, sinceChance, chances, missRun, lastKind? Does a slip count as a chance for the coach (choice.chance is set): follow where chance is read in the copy (src/game, src/coach) and say what the child would hear after a slip, without changing those files.
   - The typedefs and exported names: nothing changed?
2. The tests (tests/unit/core/teacher.test.js). Run the three test files of the package (teacher, brain, sim) and both type checks (node node_modules/typescript/bin/tsc -p tsconfig.json and -p tsconfig.node.json). Then test the tests: copy the tree's teacher.js to your folder, and for each of the four conditions of the slip (mate skipped; cap 500; losesRook; the candidate filter at 500) make a mutant in a scratch copy of the whole tree's src and tests (never in the tree itself), run the teacher tests against it and say which test kills it. A mutant that survives is a missing test: add the test to the tree's teacher.test.js. Also check the edges 249/250 for the child's stand and 299/300/500/501 for the size are each pinned by an assertion.
3. The measurement. Run in the private copy, under the memory guard, in the background with a timeout, --jobs 4:
   node scripts/sim.js --path mid --seed 1001 --jobs 4 --json <your folder>\\slip-mid-s1001.json --print <your folder>\\print-s1001
   (about 12 to 15 minutes). The same seeds with RT's final code are in ${W}\\work\\RT\\runs\\f2-mid-s1001.json (RT final: long 4.9 % overall, 14.1 % worst pairing). Then:
   - every bar of the run (the tail of its output), the 长局 share overall and per pairing, child wins, and the pairing table (node ${W}\\work\\RT\\review\\tab.mjs <json> <RT's json>);
   - node ${W}\\work\\RT\\review\\wrapstats.mjs <print dir> <json> and hist.mjs for both runs: finisher moves from move 60 on by the child's stand, how many allow a mate or give a rook from below +250 (for each such move, open the printed game and say what the child's stand was at his decision: the script buckets by the stand before the child's own move), wins by length around move 60;
   - the score of the children, slip against RT final, paired over the same seeds per pairing (${W}\\work\\RT\\review\\paired.mjs shows how the RT reviewer did it; read its head for the usage), with its spread;
   - whether the weak pairings (matched-A, matched-B, coached-A, coached-B, first-*, firstc-*) keep every bar, and firstc-A in particular (bar: 45 % or more).
   If you have time left after that, run --path fast --only weak --seed 1001 --jobs 4 as well and compare with the mid run's weak games (below level 5 fast and mid should play the same games).
4. The bars the owner intends (long.all 7 %, long.worst 20 %): with the owner's run (seeds 3001: 4.9 / 15.6), yours and RT's runs under ${W}\\work\\RT\\runs for the spread between seed sets and paths, say whether these two numbers are sound regression guards (met with a margin of at least two games in 64 on every set you can see, yet tight enough to catch the state before RT: 12 to 15 % overall), or what numbers you would set.

Fix a defect of the change in the two files of the tree if you find one, keep the fix small, re-run the tests, and say exactly what you changed. Do not retune numbers; report instead.`

const LOOK = `${COMMON}

YOUR PART: the look. You run no simulation and change no file of the tree. Your folder: ${W}\\work\\RT\\slip\\look-review. You read printed games and judge them as a chess teacher of children would: does this rival, late in a long game, look like a tired player who slips, or like one who throws the game?

The material:
- ${W}\\work\\RT\\slip\\print-s3001: 1088 printed games of the slip variant (mid, seeds 3001..3064). The second line of each file explains the row format: the child's move (the child's stand in cp before its own move, its loss and verdict) and the rival's move [mode kind -loss given 机会 gain 深 depth L level] {what an onlooker sees}.
- ${W}\\work\\RT\\review\\print\\rv1-mid-s3001: the same seeds with RT's final code (the finisher in full from a level game). The games are identical up to his move 60 or to the first wrap-up decision that differs.
- node ${W}\\work\\RT\\review\\wrapstats.mjs ${W}\\work\\RT\\slip\\print-s3001 ${W}\\work\\RT\\slip\\slip-mid-s3001.json lists the games by their first finisher move from move 60 on, the child's wins after a first crack from below +250 (with game, move, stand, loss, level), the games with a long press, and the games with 20 or more finish-mode moves and no finisher. Use it to pick games; write small node scripts of your own in your folder if you want other selections (for example: every finisher move with the child below +250 at his decision, with the piece it gives; slips on two of his moves running; a slip on the move after a blunder of the child; the number of his moves from the first slip to the end).

What to read (say in the report which games you read; one line per game):
1. At least twenty-five games in which he slips from below +250, spread over the levels (1 to 2, 3 to 5, 6 and up) and the pairings, from his move 55 to the end. For each: what the slip gives (which piece, for what), whether the move itself looks like a move (a retreat into a fork, a capture that loses the piece, a piece left hanging by a quiet move with no point at all?), what he does next, and how the game ends.
2. The seven passages the RT reviewer quoted as throws (first-B-3054 move 60, coached-B-3048 move 60, first-B-3010 and first-B-3017 move 60, matched-C-3024 moves 56 to 60, matched-D-3046 move 66, coached-D-3026 move 61): what does the slip variant do in the same games at the same point?
3. Ten of the games with 20 or more finish-mode moves and no finisher, and ten games that are still long (100 child moves): does he shuffle, repeat, give check after check; would a child be bored; is there anything a rival could decently do there (the owner is thinking of a draw offer by the rival in a later version; say whether these games are the place for it).
4. Count over all 832 teaching games, with a script: slips (finisher moves with the child below +250 at his decision) by what they give; slips on two of his moves running; a slip followed within three moves by a finisher that allows a mate or gives a rook (the collapse after the slip) and how that reads; games in which he slips three times or more; the first slip by move number (is move 60 itself a cliff: how many first slips fall on move 60 exactly, 61 to 64, 65 to 69, later).

Your verdict, in the summary: (a) is the worst of the old look gone (the rook for nothing, the step into mate from a level game); (b) what is the worst passage that remains, quoted; (c) does a child who plays twenty games notice a pattern at move 60, and what would soften it at small cost (name the rule precisely, do not implement it); (d) would you ship this, the RT final, or the plain 250 variant, for a child of 9 to 12, and why. Rate each problem you find as blocker, major or minor.`

phase('Review')
const [code, look] = await parallel([
  () => agent(CODE, { label: 'slip: code, tests, measurement', phase: 'Review', schema: REPORT }),
  () => agent(LOOK, { label: 'slip: the look of printed games', phase: 'Review', schema: REPORT }),
])
return { code, look }
