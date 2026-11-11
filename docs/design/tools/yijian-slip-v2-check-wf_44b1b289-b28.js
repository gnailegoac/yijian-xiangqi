export const meta = {
  name: 'yijian-slip-v2-check',
  description: 'One sceptical reviewer checks the second version of the slip rule (spacing rules) in the private copy: the delta, its tests, and what printed games show',
  phases: [
    { title: 'Check', detail: 'the delta, the tests, printed games of both seed sets' },
  ],
}

const W = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad'

const REPORT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pass', 'partial', 'fail'] },
    summary: { type: 'string', description: 'The whole report in plain text: what you checked, numbers, quoted passages, your verdict. The only thing the owner reads.' },
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
      items: { type: 'object', properties: { command: { type: 'string' }, outcome: { type: 'string' } }, required: ['command', 'outcome'] },
    },
    forOwner: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'found', 'checks', 'forOwner'],
}

const PROMPT = `You are the last independent check of a small, late change to the teaching rival (司马懿) of a xiangqi game for children of 9 to 12 ("弈间"). The rival must never read as "he lets me win". The owner wrote the change himself today, in answer to two reviews of its first version; nobody else has looked at the second version. Be sceptical: try to show it is wrong, or that it reads badly in real games, and say plainly what you find. If it is sound, say so briefly.

Read first, completely: ${W}\\work\\RT\\slip\\V2-NOTES.md, then what it tells you to read (SLIP-NOTES.md with the house rules, which bind you; the two earlier reviews), then the two diffs it names. Your folder for scripts and notes: ${W}\\work\\RT\\slip\\v2-check (keep a PROGRESS.md there, one line per step with numbers).

1. The delta in ${W}\\work\\RT\\tree\\src\\core\\teacher.js (read the whole finish step and recordOpponentMove, and where ctx.sinceBlunder and ctx.sinceChance come from: teachingContext, recordChildMove or whatever resets sinceBlunder, recordOpponentMove). Questions, each with evidence:
   - Do sinceBlunder and sinceChance mean at his decision what the four rules assume? At his decision right after a child's blunder, is sinceBlunder 0? After his own chance, is sinceChance 0 on his next decision and 1 on the one after? Which verdicts of the child reset sinceBlunder (only 'blunder', or 'mistake' too)? What are the values at the start of a game?
   - wrapUp = !(eBest >= 600 && ctx.aheadRun >= 1): is there a decision before move 60 on which the new lines change anything (there must be none)? From move 60 on with the child at +600 and aheadRun 0: what happens now and what happened in the first version?
   - Can the hold or the settle make him play something worse-looking than before: for example an honest move that walks into the same mate anyway, or a press-like honest move on a child who was just given a piece (he gives a horse, then wins it back at once by honest play)?
   - The sort: Math.min(rd, 2). Is rd always a number of 1 or more here? Could the preference make him choose a slip that the child cannot see (rd beyond ctx.reveal is already excluded: check)?
   - Anything in the tests of the new test that asserts a wrong behaviour, or a rule of the notes that no assertion pins (the owner's mutants are listed in the notes; think of two or three more and try them in a scratch copy under your folder, never in the tree).
   Run: node --test tests/unit/core/teacher.test.js tests/unit/core/brain.test.js tests/unit/scripts/sim.test.js and both type checks (node node_modules/typescript/bin/tsc -p tsconfig.json; -p tsconfig.node.json) in the tree, under the memory guard with a timeout.
2. Printed games (no new simulation: the two runs are there). In ${W}\\work\\RT\\slip\\print-v2-s1 and print-v2-s1001 (the second line of each file explains the rows):
   - With a script: every finisher move from his move 60 on; for each game the sequence of his kinds after a slip. Verify on the printed games that after a finisher move with a chance his next two moves are never finisher moves unless the child stood at +600 on two decisions running, that no finisher within five of his moves after a slip gives more than 500 cp or allows a mate unless that same +600 rule applies, and that no finisher move from move 60 on is the answer to a child's move marked blunder (level below 5) or comes within two of his moves of one (level 5 and up) unless the +600 rule applies. List every exception with the passage; decide for each whether it is the +600 rule or a defect.
   - Read at least fifteen games with a slip (five at levels 1 to 2.9, five at 3 to 5.9, five at 6 and up if there are that many), from the slip to the end, in the second version, and for five of them the same game in the first version (print-s1, code-review\\print-s1001). One line each: what the slip gives, what he does on the two held moves, how the game ends, and whether a child of ten would think "he is tired" or "he lets me win".
   - The cost: which games became long that were not long in the first version (same seeds, compare the two JSON reports game by game), and what happens in three of them.
   - Passages where the child hangs a piece in a level game after move 60: does he take it now (the first version passed)? Quote two.
3. Your verdict: ship the second version, go back to the first, or change something (name the rule precisely; do not retune numbers yourself). Rate each problem blocker, major or minor. Say whether the two bars the notes intend are sound for the second version on the runs you can see.

You may fix a defect of the delta in the tree's two files if you find one (keep it small, re-run the tests, say exactly what you changed). Otherwise change nothing in the tree.`

phase('Check')
const check = await agent(PROMPT, { label: 'slip v2: sceptical check', phase: 'Check', schema: REPORT })
return { check }
