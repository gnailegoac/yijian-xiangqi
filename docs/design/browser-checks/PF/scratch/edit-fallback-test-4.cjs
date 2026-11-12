// PF: tests/unit/coach/fallback.test.js, part 4 (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/coach/fallback.test.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 80)); s = s.replace(a, b); };

// ---- the game-over line and its cap: no goal sentence any more, so nothing has to be dropped
rep(`  // over: sentences are dropped from the end to fit 80
  const full = overEvent({ result: 'loss', kept: true, goal: 'hang_piece', rank: { to: 4 }, proud: { n: 118, s: 'me', move: '马三进四', tag: 'great', k: 'bad_trade' } }, 'lose');
  const whole = '这盘惜败，不过有几步走得真不错。上盘说好的，做到了！第118回合的【马三进四】最漂亮：亏本兑子。下一盘小目标——走完先看一眼，这个子有没有人保护。兵法升到「初露锋芒」！';
  assert.equal(plainLength(whole), 82);
  assert.equal(composeLocal(overTurn(), [full]), whole.replace('兵法升到「初露锋芒」！', ''));
  // The dash is one character longer than the colon it replaced (CONTRACT-NOTES 133). With the longest of everything (a
  // loss, the kept goal, a move number of three digits, a five-character notation, a four-character term) the goal sentence
  // still fits for every goal; only the rank line gives way, as it did before.
  const longest = (goal, rank) => composeLocal(overTurn(), [overEvent({ result: 'loss', kept: true, goal, rank,
    proud: { n: 301, s: 'me', move: '前兵七进一', tag: 'great', k: 'bad_trade' } }, 'lose')]);
  for (const goal of HABIT_CODES) {
    for (const rank of [null, { to: 1 }, { to: 9 }]) {
      const text = longest(goal, rank);
      assert.ok(plainLength(text) <= CAPS.over, \`\${goal}: \${plainLength(text)}\`);
      assert.ok(text.endsWith(\`下一盘小目标——\${HABIT_FIX[goal]}。\`) || text.endsWith('」！'), \`\${goal}: the goal sentence is whole: \${text}\`);
      assert.ok(text.includes(\`下一盘小目标——\${HABIT_FIX[goal]}。\`), \`\${goal}: the goal is never the sentence that is dropped\`);
    }
  }
  assert.equal(Math.max(...HABIT_CODES.map((goal) => plainLength(longest(goal, null)))), 72, 'the longest line that ends with a goal');
`,
`  // over: the goal is not part of the line (the card shows it in a row of its own, CONTRACT-NOTES 138), so even with the
  // longest of everything (a loss, the kept goal, a move number of three digits, a five-character notation, a
  // four-character term, the rank) the line is whole and nothing has to be dropped
  const full = overEvent({ result: 'loss', kept: true, goal: 'hang_piece', rank: { to: 4 }, proud: { n: 118, s: 'me', move: '马三进四', tag: 'great', k: 'bad_trade' } }, 'lose');
  const whole = '这盘惜败，不过有几步走得真不错。上盘说好的，做到了！第118回合的【马三进四】最漂亮：亏本兑子。兵法升到「初露锋芒」！';
  assert.equal(plainLength(whole), 59);
  assert.equal(composeLocal(overTurn(), [full]), whole);
  const longest = (goal, rank) => composeLocal(overTurn(), [overEvent({ result: 'loss', kept: true, goal, rank,
    proud: { n: 301, s: 'me', move: '前兵七进一', tag: 'great', k: 'bad_trade' } }, 'lose')]);
  for (const goal of HABIT_CODES) {
    for (const rank of [null, { to: 1 }, { to: 9 }]) {
      const text = longest(goal, rank);
      assert.ok(plainLength(text) <= CAPS.over, \`\${goal}: \${plainLength(text)}\`);
      assert.ok(!text.includes('小目标') && !text.includes(HABIT_FIX[goal]), \`\${goal}: the goal is left to the card: \${text}\`);
      assert.equal(text.endsWith('」！'), rank !== null, \`\${goal}: the rank sentence is never dropped: \${text}\`);
    }
  }
  assert.equal(Math.max(...HABIT_CODES.map((goal) => plainLength(longest(goal, { to: 9 })))), 61, 'the longest game-over line');
`);

// ---- last on a blunder with a flaw: what the move did is not added
rep(`    '【车二进五】是漏着：错过了一步杀棋。你的二路车吃掉对方的2路车。');`,
    `    '【车二进五】是漏着：错过了一步杀棋。', 'what a blunder did is not added: the piece may be gone by now');`);

// ---- the corrected sentences: the rival voice
rep(`  assert.equal(read({ k: 'open_rook', on: P('opp', 'R', 9) }), '这步给对方的9路车亮出了通道。');
  assert.equal(read({ k: 'restrict_king', on: P('me', 'K', 5) }), '这步封住了你的帅的一条退路。');
  assert.equal(read({ k: 'sacrifice', by: P('opp', 'R', 2) }), '这步弃掉对方的2路车换取攻势。');
  assert.equal(read({ k: 'attack', by: P('opp', 'C', 2), on: P('me', 'P', 7) }), '对方的2路炮捉你的七路兵。');
  // the same clauses keep their wording where another sentence gives them their subject
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'defend', on: P('opp', 'P', 5) }] }), [OPP_SILENT, ask('intent')]), '对方这步的用意：给对方的5路卒补上保护。');`,
`  assert.equal(read({ k: 'open_rook', on: P('opp', 'R', 9) }), '这步给自己的9路车亮出了通道。');
  assert.equal(read({ k: 'restrict_king', on: P('me', 'K', 5) }), '这步封住了你的帅的一条退路。');
  assert.equal(read({ k: 'sacrifice', by: P('opp', 'R', 2) }), '', 'no piece besides the one that moved: the caption says 弃子 already');
  // a clause that starts with his piece: the sentence of the intent answer when it fits the cap, the clause by itself as variant 1
  assert.equal(read({ k: 'attack', by: P('opp', 'C', 2), on: P('me', 'P', 7) }), '对方这步的用意：2路炮捉你的七路兵。');
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'attack', by: P('opp', 'C', 2), on: P('me', 'P', 7) }] }), OPP_LAST, 1), '对方的2路炮捉你的七路兵。');
  // the same clauses where another sentence gives them their subject: the rival is that subject, so his pieces are 自己的
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'defend', on: P('opp', 'P', 5) }] }), [OPP_SILENT, ask('intent')]), '对方这步的用意：给自己的5路卒补上保护。');`);

fs.writeFileSync(p, s);
console.log('ok');
