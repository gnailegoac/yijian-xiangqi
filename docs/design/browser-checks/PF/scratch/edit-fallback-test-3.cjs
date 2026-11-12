// PF: tests/unit/coach/fallback.test.js, part 3: the remaining expectations (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/coach/fallback.test.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b, all = false) => {
  if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80));
  if (!all && s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 80));
  s = s.split(a).join(b);
};

// ---- golden: intent after a move that gave something up (the rival voice)
rep(`对方这步的用意：对方的7路马出动。不过这步有漏洞。`, `对方这步的用意：7路马出动。不过这步有漏洞。`, true);
rep(`对方这步的用意：对方的7路马出动。不过这步走得偏软。`, `对方这步的用意：7路马出动。不过这步走得偏软。`, true);

// ---- golden: the game-over line no longer carries the goal (the card shows it in a row of its own)
rep(`    expect: ['这盘赢得漂亮！第18回合的【马三进四】最漂亮：捉双。下一盘小目标——吃子之前，先看它有没有保镖。兵法升到「初露锋芒」！'] },`,
    `    expect: ['这盘赢得漂亮！第18回合的【马三进四】最漂亮：捉双。兵法升到「初露锋芒」！'] },`);
rep(`    expect: ['这盘赢得漂亮！上盘说好的，做到了！第18回合的【马三进四】最漂亮：捉双。下一盘小目标——吃子之前，先看它有没有保镖。兵法升到「初露锋芒」！'] },`,
    `    expect: ['这盘赢得漂亮！上盘说好的，做到了！第18回合的【马三进四】最漂亮：捉双。兵法升到「初露锋芒」！'] },`);
rep(`    expect: ['这盘惜败，不过有几步走得真不错。第18回合的【马三进四】最漂亮：捉双。下一盘小目标——对方走完，先问自己：他想干什么。'] },`,
    `    expect: ['这盘惜败，不过有几步走得真不错。第18回合的【马三进四】最漂亮：捉双。'] },
  // a lost game without a proud move (CONTRACT-NOTES 138): the line does not invent one, and the goal is left to the card
  { name: 'over: loss, no proud move', row: 'over', turn: overTurn(), events: [overEvent({ result: 'loss', kept: null, proud: null, goal: 'miss_threat', rank: null }, 'lose')],
    expect: ['这盘惜败，不过有几步走得真不错。'] },`);

// ---- the first applicable row: a pawn that was taken does not come before a piece-sized threat any more
rep(`  assert.equal(rowOf(oppTurn({ ...everything, check: false, punishes: false }, { threats: [PIECE_THREAT], ...chance })), 'opp.captured');`,
    `  assert.equal(rowOf(oppTurn({ ...everything, check: false, punishes: false }, { threats: [PIECE_THREAT], ...chance })), 'opp.captured');      // a horse fell: the news`);
rep(`  assert.equal(rowOf(oppTurn(tookPawn, { threats: [PIECE_THREAT], level: 3 })), 'opp.captured', 'a smaller threat keeps the order of section 8.6');`,
    `  // ... and so does a horse or a cannon after a pawn, an advisor or an elephant was taken (CONTRACT-NOTES 138); after a
  // piece of its own size was taken the order of section 8.6 stands, and a threat to a pawn never makes a threat row
  assert.equal(rowOf(oppTurn(tookPawn, { threats: [PIECE_THREAT], level: 3 })), 'opp.threat');
  assert.equal(composeLocal(oppTurn(tookPawn, { threats: [PIECE_THREAT], level: 3 }), OPP_LAST, 0), '对方盯上了你的五路炮。');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'A' }, { threats: [PIECE_THREAT], level: 3 })), 'opp.threat');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'E' }, { threats: [PIECE_THREAT], level: 5 })), 'opp.threat.q');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'H' }, { threats: [PIECE_THREAT], level: 3 })), 'opp.captured', 'a threat of the same size keeps the order of section 8.6');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'C' }, { threats: [PIECE_THREAT], level: 3 })), 'opp.captured');
  assert.equal(rowOf(oppTurn(tookPawn, { threats: [{ ...PIECE_THREAT, sev: 'pawn' }], level: 3 })), 'opp.captured');`);
rep(`  assert.equal(rowOf(oppTurn({ ...rest, overlooked: undefined })), 'opp.name');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: rest.does })), 'opp.effect');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: [] })), 'opp.quiet');`,
`  assert.equal(rowOf(oppTurn({ ...rest, overlooked: undefined })), 'opp.name');
  // the name of a tactic is all the caption says: the row of the effect follows, and it speaks only of an effect with a target
  const protects = [{ k: 'defend', on: P('opp', 'P', 5) }];
  assert.equal(rowOf(oppTurn({ move: '炮8进1', name: 'fork_two', does: protects })), 'opp.effect');
  assert.equal(rowOf(oppTurn({ move: '炮8进1', does: protects })), 'opp.effect');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: rest.does })), '', 'a developing move: the caption alone');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: [{ k: 'quiet' }] })), 'opp.quiet');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: [] })), 'opp.quiet');
  // a threat without a target (a threatened check) has only the question row: it is asked below level 4 too
  const CHECK_THREAT = { k: 'check', by: P('opp', 'R', 8), move: '车8进6', net: NET0, sev: 'piece', prep: true };
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: rest.does }, { threats: [CHECK_THREAT], level: 2 })), 'opp.threat.q');
  assert.equal(composeLocal(oppTurn({ move: '卒3进1', does: rest.does }, { threats: [CHECK_THREAT], level: 2 }), OPP_LAST, 0), '对方的8路车在打什么主意？');`);

// ---- the cap test: a sentence that would pass its cap gives way; when none fits, nothing is said (never cut)
rep(`  assert.equal(plainLength('对方的5路炮借对方的5路卒当炮架，瞄着你的五路兵。') > CAPS.opp, true);
  assert.equal(composeLocal(long.turn, long.events, 0), '对方这步在架炮。');
  assert.equal(localLine(long.turn, long.events, ['opp.effect:1', 'opp.effect:2']).v, 3, 'and it is never offered by localLine either');`,
`  assert.equal(plainLength('对方的5路炮借自己的5路卒当炮架，瞄着你的五路兵。') > CAPS.opp, true);
  assert.equal(composeLocal(long.turn, long.events, 0), '对方的5路炮瞄着你的五路兵。');
  assert.deepEqual(localLine(long.turn, long.events, []), { text: '对方的5路炮瞄着你的五路兵。', row: 'opp.effect', v: 2 }, 'and it is never offered by localLine either');
  // the rival's line after his move is never cut: when no sentence about the effect fits, the caption stands alone
  const pinned = { turn: oppTurn({ move: '炮2进4', does: [{ k: 'pin', by: P('opp', 'C', 2), on: P('me', 'H', 8), on2: P('me', 'R', 9) }] }), events: OPP_LAST };
  assert.deepEqual([0, 1, 2].map((v) => composeLocal(pinned.turn, pinned.events, v)), ['', '', '']);
  assert.deepEqual(localLine(pinned.turn, pinned.events, []), { text: '', row: '', v: 0 });`);

// ---- the frequent rows: opp.effect is no longer one of the six-variant rows
rep(`test('the eight frequent rows have at least six variants', () => {
  // The rows a child hears most: every rival move (effect, quiet, captured, threat) and every trial (praise, steady, ok, slow) ...
  const frequent = ['opp.effect', 'opp.quiet', 'opp.captured', 'opp.threat', 'try.praise', 'try.steady', 'try.ok', 'try.slow'];
  // ... and the other rows that section 8.6 gives six variants (D-40)
  const six = [...frequent, 'opp.mate', 'opp.check', 'opp.punished', 'held.mate', 'held.hang', 'held.unguard', 'held.threat', 'held.greedy', 'held.other'];
  assert.equal(six.length, 17);`,
`test('the frequent rows have at least six variants', () => {
  // The rows a child hears most: a rival move (quiet, captured, threat) and every trial (praise, steady, ok, slow) ...
  // (opp.effect left this list with CONTRACT-NOTES 138: it says one thing, what the move is aimed at, or nothing)
  const frequent = ['opp.quiet', 'opp.captured', 'opp.threat', 'try.praise', 'try.steady', 'try.ok', 'try.slow'];
  // ... and the other rows that section 8.6 gives six variants (D-40)
  const six = [...frequent, 'opp.mate', 'opp.check', 'opp.punished', 'held.mate', 'held.hang', 'held.unguard', 'held.threat', 'held.greedy', 'held.other'];
  assert.equal(six.length, 16);`);

// ---- what a sentence says is in the packet: the goal is not in the game-over line; the next answer keeps it
rep(`  for (const goal of HABIT_CODES) {
    assert.equal(composeLocal(overTurn(), [overEvent({ goal, proud: null, rank: null })]), \`这盘赢得漂亮！下一盘小目标——\${HABIT_FIX[goal]}。\`);
    // one dash, and at most the colon the goal itself holds: never two colons in one sentence
    for (const text of [composeLocal(overTurn(), [overEvent({ goal })]), composeLocal(overTurn(), overThread('next', { goal }))]) {
      for (const sentence of text.split(/[。！？]/)) assert.ok((sentence.match(/：/g) ?? []).length <= 1, sentence);
      assert.ok(text.includes(\`——\${HABIT_FIX[goal]}。\`), text);
    }
  }`,
`  for (const goal of HABIT_CODES) {
    // the goal is said once on the card, in its own row (CONTRACT-NOTES 138): the game-over line does not carry it ...
    assert.equal(composeLocal(overTurn(), [overEvent({ goal, proud: null, rank: null })]), '这盘赢得漂亮！');
    assert.ok(!composeLocal(overTurn(), [overEvent({ goal })]).includes(HABIT_FIX[goal]), goal);
    assert.ok(!composeLocal(overTurn(), [overEvent({ goal })]).includes('小目标'), goal);
    // ... and 「下一盘注意什么？」 still answers with it: one dash, and at most the colon the goal itself holds
    const next = composeLocal(overTurn(), overThread('next', { goal }));
    for (const sentence of next.split(/[。！？]/)) assert.ok((sentence.match(/：/g) ?? []).length <= 1, sentence);
    assert.equal(next, \`下一盘记住一件事——\${HABIT_FIX[goal]}。\`);
  }`);

// ---- the corrected sentences
rep(`  assert.equal(composeLocal(oppTurn({ does: [{ k: 'develop', by: P('opp', 'H', 7) }] }), OPP_LAST, 4), '对方在出子。');`,
    `  assert.equal(composeLocal(oppTurn({ does: [{ k: 'develop', by: P('opp', 'H', 7) }] }), OPP_LAST, 4), '', 'the caption says 出子 already');`);
rep(`  assert.equal(read({ k: 'defend', on: P('opp', 'P', 5) }), '这步给对方的5路卒补上保护。');`,
    `  assert.equal(read({ k: 'defend', on: P('opp', 'P', 5) }), '这步给自己的5路卒补上保护。');`);

// ---- 为什么？ straight after the game-over line: the line speaks of the highlighted move
rep(`  // straight after the game-over line: the habit behind its small goal; without a goal its highlighted move; else the fixed sentence
  assert.equal(why([]), '因为第2回合的【炮五进四】，吃子前没看对方能不能吃回。');
  assert.equal(why([], { goal: null, takeaway: { kind: 'strength', code: 'S_tactics' } }), '因为【马三进四】同时捉住了对方的两个子，对方只能救一个。');`,
`  // straight after the game-over line: its highlighted move (the line no longer carries the goal); without a highlighted
  // move the habit behind the goal the card shows; else the fixed sentence
  assert.equal(why([]), '因为【马三进四】同时捉住了对方的两个子，对方只能救一个。');
  assert.equal(why([], { goal: null, takeaway: { kind: 'strength', code: 'S_tactics' } }), '因为【马三进四】同时捉住了对方的两个子，对方只能救一个。');
  assert.equal(why([], { proud: null }), '因为第2回合的【炮五进四】，吃子前没看对方能不能吃回。');`);

fs.writeFileSync(p, s);
console.log('ok');
