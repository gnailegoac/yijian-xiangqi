// PF: tests/unit/server/prompt.test.js for items 8, 9, 10 (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/server/prompt.test.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 80)); s = s.replace(a, b); };

const OLD = '先用半句回应胜负（赢了一起高兴，输了先安慰），再讲「要点」里的那一条，引用本局那一步，这一句不超过30字；有「下一盘小目标」就用它收尾。一共80字以内。';

// ---- the golden turn of the over fixture: by itself, and as the turn of its thread
rep(`/** 9.8: the game is over. */
const TURN_OVER = \`〔军情〕
局面：第34回合，小主公执红，轮到小主公走。残局阶段。`,
`/** The directive of the game-over event: the goal is on the card already and is not repeated (CONTRACT-NOTES 138). */
const OVER_DIRECTIVE = '先用半句回应胜负（赢了一起高兴，输了先安慰），再讲「要点」里的那一条，引用本局那一步，这一句不超过30字。'
  + '「下一盘小目标」界面已经单独显示给小主公了，回复里不要再说一遍；要点就是这个小目标时，只讲它引用的那一步。一共80字以内。';

/** 9.8: the game is over. In its thread (the first event is \`over\`) the position line does not say 轮到小主公走. */
const TURN_OVER_THREAD = \`〔军情〕
局面：第34回合，小主公执红，残局阶段。
形势：胜势。子力：我方 车1 马1 炮1 兵2 仕2 相2；对方 马1 卒1 士1 象1。我方多大约一个车。
小主公水平：3/9（多用大白话）。
本局回顾：第18回合我方【马三进四】好棋（捉双）。
本局已讲过：捉双、贪吃。
小主公上一步：【车二进七】（好棋，是自己想出来的）。
对方的威胁（清单完整）：眼下没有直接威胁。\`;
/** The same brief rendered as the turn of a running game (renderTurn with one argument). */
const TURN_OVER = \`〔军情〕
局面：第34回合，小主公执红，轮到小主公走。残局阶段。`);

rep(`〔已喊〕「大捷！」
〔要求〕${OLD}\`;`,
`〔已喊〕「大捷！」
〔要求〕\${OVER_DIRECTIVE}\`;`);

rep(`  'over.json': { turn: TURN_OVER, events: [EV_OVER] },`,
    `  'over.json': { turn: TURN_OVER, thread: TURN_OVER_THREAD, events: [EV_OVER] },`);
rep(`    assert.deepEqual(buildMessages(req, req.resume ? LEGS_97 : []), expectedMessages(req, golden.turn, golden.events, legMessages),
      \`\${name}: messages\`);`,
`    // the turn as the first user message carries it: in a game-over thread nobody is to move
    assert.equal(renderTurn(req.turn, req.events[0].kind === 'over'), golden.thread ?? golden.turn, \`\${name}: turn of the thread\`);
    assert.deepEqual(buildMessages(req, req.resume ? LEGS_97 : []), expectedMessages(req, golden.thread ?? golden.turn, golden.events, legMessages),
      \`\${name}: messages\`);`);

rep(`    + '〔要求〕${OLD}');`,
    `    + \`〔要求〕\${OVER_DIRECTIVE}\`);
  // the goal is said once on the card: the directive tells the model not to say it again, and never to end on it
  assert.ok(OVER_DIRECTIVE.includes('「下一盘小目标」界面已经单独显示给小主公了，回复里不要再说一遍'));
  assert.ok(!OVER_DIRECTIVE.includes('收尾'));
  // 「下一盘注意什么？」 keeps it: its directive asks for the goal, and the block still carries the line it speaks of
  const asked = clone(stored('over.json'));
  asked.events[0].said = 'none';
  asked.events.push({ i: 1, kind: 'ask', ask: 'next' });
  const r5 = request(asked);
  assert.ok(renderEvent(r5.events[1], r5.turn).endsWith('〔要求〕小主公问下一盘注意什么：把「下一盘小目标」说成一个开局就能用上的小办法。最多两句，50字以内。'));
  assert.ok(renderEvent(r5.events[0], r5.turn).includes('\\n下一盘小目标——吃子之前，先看它有没有保镖。\\n'));
  // a finished game is not "your move" (CONTRACT-NOTES 138): the turn of a thread that starts with \`over\` says neither
  // 轮到小主公走 nor, after a mate, that the check must be answered
  for (const built of [buildMessages(req, []), buildMessages(r2, []), buildMessages(r5, [])]) {
    assert.ok(built[1].content.startsWith('〔军情〕\\n局面：第34回合，小主公执红，残局阶段。\\n'), built[1].content.slice(0, 60));
    assert.ok(!built[1].content.includes('轮到小主公走'));
  }
  const mated = clone(stored('over.json'));
  mated.turn.check = true;
  mated.turn.n = 0;
  mated.events[0].over = { ...mated.events[0].over, result: 'loss', reason: 'checkmate' };
  mated.events[0].cue = 'lose';
  const r6 = request(mated);
  assert.ok(!buildMessages(r6, [])[1].content.includes('必须应将'));
  assert.ok(renderTurn(r6.turn).includes('轮到小主公走。残局阶段。小主公正被将军，必须应将，共有0种应法。'), 'renderTurn by itself is unchanged');
  // a thread of a running game keeps the sentence
  assert.ok(buildMessages(fixture('opp.json'), [])[1].content.includes('，轮到小主公走。'));`);

// ---- item 8: a chance in the child's own palace or back rows is told without its area
rep(`  assert.ok(lines(t).includes('机会：对方阵中有破绽，在对方九宫，和「捉双」有关，分量约一个马或炮。具体着法没有提供。'));`,
`  assert.ok(lines(t).includes('机会：对方阵中有破绽，在对方九宫，和「捉双」有关，分量约一个马或炮。具体着法没有提供。'));
  // a chance whose move lands in the child's own palace or back rows: the area is not named (在己方九宫 would have the
  // model tell the child that their own palace holds a chance; CONTRACT-NOTES 138)
  for (const area of ['my_palace', 'my_back']) {
    const own = lines({ ...t, chance: { ...t.chance, area } });
    assert.ok(own.includes('机会：对方阵中有破绽，和「捉双」有关，分量约一个马或炮。具体着法没有提供。'), area);
    assert.ok(!own.join('\\n').includes('己方'), area);
  }`);
rep(`  assert.equal(directive({ ...everything, threats: [], opp: turn.opp }), OPP + '提醒小主公那一带有机会，让小主公自己找。');`,
`  assert.equal(directive({ ...everything, threats: [], opp: turn.opp }), OPP + '提醒小主公那一带有机会，让小主公自己找。');
  // ... without 那一带 when the area is not named (the child's own palace or back rows)
  assert.equal(directive({ ...everything, threats: [], opp: turn.opp, chance: { ...everything.chance, area: 'my_palace' } }), OPP + '提醒小主公眼下有机会，让小主公自己找。');`);

fs.writeFileSync(p, s);
console.log('ok');
