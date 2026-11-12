// PF items 6, 7, 8, 9, 13 in src/coach/fallback.js (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/coach/fallback.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 70)); s = s.replace(a, b); };

// ---- header
rep(`// decided (CONTRACT-NOTES items 111 to 113, 131 and 133); the row names, the number of variants and what each variant index
// means are 8.6's. A variant whose wording would not be true of the packet at hand gives way to the next one.
`,
`// decided (CONTRACT-NOTES items 111 to 113, 131, 133 and 138); the row names are 8.6's, and so are the number of variants and
// what each variant index means, except in the rows item 138 changed (opp.name, opp.effect; opp.quiet is gone). A variant
// whose wording would not be true of the packet at hand gives way to the next one.
`);

// ---- the opp table
rep(`  overlooked: ['好险，对方漏看了一步。', '对方刚才错过了机会。', '司马懿也有走眼的时候。'],
  chance: ['{area}好像露了破绽。', '{area}有文章可做。', '看看{area}，有机会。'],
  // {setup} and {kind} depend on what the pattern is: an opening, an attacking formation or a weakness (NAME_WORDS)
  name: ['对方{setup}{PATTERN_NAME}。', '这是{PATTERN_NAME}。', '{PATTERN_NAME}，{kind}。'],
  effect: ['{effectClause}。', '对方这步在{term}。', '这步的用意：{term}。', '司马懿这步是{term}。', '对方在{term}。', '{term}，不可不看。'],
  quiet: ['对方稳稳地调了一步。', '对方在调整阵形。', '这步不急不躁。', '司马懿在布阵。', '对方先把阵脚站稳。', '平平常常的一步。'],
};
/** How a named formation of the rival is spoken of: an opening is 常见的阵势, 空头炮 is an attack, 窝心马 is a weakness. */
const NAME_WORDS = {
  opening: { setup: '摆出了', kind: '常见的阵势' },
  empty_cannon: { setup: '摆出了', kind: '厉害的攻势' },
  heart_horse: { setup: '走成了', kind: '是个弱点' },
};
`,
`  overlooked: ['好险，对方漏看了一步。', '对方刚才错过了机会。', '司马懿也有走眼的时候。'],
  chance: ['{area}好像露了破绽。', '{area}有文章可做。', '看看{area}，有机会。'],
  // the same when the chance lies in the child's own palace or back rows: the area is not named (己方九宫有文章可做 would
  // tell the child that their own palace holds a chance; CONTRACT-NOTES 138)
  chancePlain: ['对方好像露了破绽。', '眼下有文章可做。', '找一找，有机会。'],
  // The caption above the bubble already carries the notation and one word: the name of the formation, or the term of the
  // move's leading effect. A sentence is said after it only when it tells more than that (CONTRACT-NOTES 138).
  // A formation: what kind of formation it is ({kind}: an opening, an attack or a weakness, NAME_WORDS).
  name: ['{PATTERN_NAME}，{kind}。'],
  // An effect: what the move is aimed at, the sentence of the \`intent\` answer first, then the clause as a sentence of its
  // own, then the clause without its second piece. In the rival voice: his own pieces are 自己的.
  effect: ['对方这步的用意：{clause}。', '{sentence}。', '{shorter}。'],
};
/** How a named formation of the rival is spoken of: an opening is 常见的阵势, 空头炮 is an attack, 窝心马 is a weakness. */
const NAME_WORDS = {
  opening: { kind: '常见的阵势' },
  empty_cannon: { kind: '厉害的攻势' },
  heart_horse: { kind: '是个弱点' },
};
`);

// ---- pouch 1 and pouch 2
rep(`  finish: '怎么把对方的老将逼到没路走？',
  other: '哪个子待的位置最别扭？',
};`,
`  finish: '怎么把对方的老将逼到没路走？',
  // a chance that is none of the above (a piece to attack, a pin, a discovered attack): 待的位置最别扭 would send the child
  // looking at their own pieces
  chance: '找一找：对方哪里有破绽？',
  other: '哪个子待的位置最别扭？',
};`);
rep(`const HINT2 = { danger: '该照顾一下{piece}了。', helper: '看看{piece}，它能帮上忙。', other: '看看{piece}，机会在{area}。' };`,
`const HINT2 = {
  danger: '该照顾一下{piece}了。', helper: '看看{piece}，它能帮上忙。', other: '看看{piece}，机会在{area}。',
  // the piece is headed for the child's own palace or back rows: 机会在己方九宫 is not said (CONTRACT-NOTES 138)
  plain: '看看{piece}，它有更好的去处。',
};`);

// ---- try.missed without an area
rep(`  missed: ['【M】没危险，可{area}有个机会。', '别急，{area}还有便宜没占。', '【M】稳，但错过了{area}的机会。'],`,
`  missed: ['【M】没危险，可{area}有个机会。', '别急，{area}还有便宜没占。', '【M】稳，但错过了{area}的机会。'],
  // the same when the area is the child's own palace or back rows: it is not named (CONTRACT-NOTES 138)
  missedPlain: ['【M】没危险，可还有个机会没抓。', '别急，还有便宜没占。', '【M】稳，但错过了一个机会。'],`);

// ---- the prep table: the acting piece of the rival without a side word
rep(` * may aim at its target already, and the move only makes the capture worth it (it adds an attacker or takes a guard away).
 * @type {Partial<Record<MotifCode, string>>}
 */`,
` * may aim at its target already, and the move only makes the capture worth it (it adds an attacker or takes a guard away).
 * The sentence is about the rival (对方想走…), so his piece that acts is named without a side word: 走完5路炮就能吃掉…
 * @type {Partial<Record<MotifCode, string>>}
 */`);

// ---- helpers: the rival voice
rep(`/** @param {string} clause @returns {boolean} the clause starts with the piece that acts (你的… / 对方的…) */`,
`/**
 * The clause of an effect inside a sentence whose subject is the rival (对方这步的用意：…, 对方这步【M】是失误：…): his piece
 * that acts is named without a side word, his other pieces are 自己的, the child's 你的 (CONTRACT-NOTES 138).
 * @param {Effect} effect @param {Color} me @returns {string}
 */
const rivalClause = (effect, me) => effectClause(effect, me, 'rival');

/**
 * A piece as the one that acts in a sentence about the rival: his own without a side word, the child's as 你的….
 * @param {WPiece} ref @param {Color} me @returns {string}
 */
const actorName = (ref, me) => (ref.s === 'opp' ? pieceName(ref, me, 'rival').slice('自己的'.length) : pieceName(ref, me, 'child'));

/** @param {string} area @returns {boolean} the child's own palace or back rows */
const ownGround = (area) => area.startsWith('my_');

/** @param {string} clause @returns {boolean} the clause starts with the piece that acts (你的… / 对方的…) */`);

// ---- reasons: a flaw of a rival move in the rival voice
rep(`  if (flaw) list.push((mover === 'opp' ? RIVAL_FLAW[flaw.k] : undefined) ?? clauseOf(flaw, me));`,
`  // about a move of the rival the sentence has him as its subject (对方这步【M】是失误：…): his own pieces are 自己的
  if (flaw) list.push(mover === 'opp' ? RIVAL_FLAW[flaw.k] ?? rivalClause(flaw, me) : clauseOf(flaw, me));`);

// ---- planOpp
rep(`  // a threat that does not stand yet (\`prep\`) is not told as an aim that is there: 它瞄着谁？ and 被瞄上了 give way
  const threatRows = [
    () => (big && turn.level >= 4 ? variantRow('opp.threat.q', cap, OPP.threatQ, { by: name(big.by) }, (v) => v !== 0 || !big.prep) : null),`,
`  // a threat that does not stand yet (\`prep\`) is not told as an aim that is there: 它瞄着谁？ and 被瞄上了 give way.
  // A threat without a target (a threatened check) has no other row: the question is asked at every level then.
  const threatRows = [
    () => (big && (turn.level >= 4 || !big.on) ? variantRow('opp.threat.q', cap, OPP.threatQ, { by: name(big.by) }, (v) => v !== 0 || !big.prep) : null),`);
rep(`  // what was taken is on the board for the child to see; a rook that can be taken next is the news, and comes first
  const urgent = big?.sev === 'rook';
  // a move that gave something up (soft, slip) is not called steady or ordinary
  const gaveUp = opp?.quality === 'soft' || opp?.quality === 'slip';
`,
`  // what was taken is on the board for the child to see; a piece that can be taken next and is worth more than what was
  // taken is the news, and comes first: a rook, or a horse or cannon after a pawn, an advisor or an elephant fell
  const urgent = big !== undefined && (big.sev === 'rook' || opp?.captured === 'P' || opp?.captured === 'A' || opp?.captured === 'E');
`);
rep(`    // 露了破绽 is said of the rival's side of the board only
    () => (turn.chance ? variantRow('opp.chance', cap, OPP.chance, { area: AREA[turn.chance.area] },
      (v) => v !== 0 || !turn.chance?.area.startsWith('my_')) : null),
    // 摆出了… / 走成了… and what kind of formation it is are said of openings and formations only: a tactic is just named
    () => (opp?.name ? variantRow('opp.name', cap, OPP.name,
      { PATTERN_NAME: PATTERN_NAME[opp.name], ...(opp.name === 'empty_cannon' || opp.name === 'heart_horse' ? NAME_WORDS[opp.name] : NAME_WORDS.opening) },
      (v) => v === 1 || has(FORMATIONS, opp.name)) : null),
    () => {
      if (!lead || lead.k === 'quiet') return null;
      const term = MOTIF_TERM[lead.k];
      const clause = clauseOf(lead, me);
      // a clause whose pieces are not in the packet reads as the bare term: not a sentence of its own
      return variantRow('opp.effect', cap, OPP.effect, { effectClause: clause === term ? null : ownSentence(clause), term });
    },
    () => (opp ? variantRow('opp.quiet', cap, OPP.quiet, {}, (v) => !gaveUp || (v !== 0 && v !== 4 && v !== 5)) : null),
  ];
  for (const row of rows) {
    const plan = row();
    if (plan) return plan;
  }
  return null;
}`,
`    // a chance in the child's own palace or back rows is told without its area
    () => (turn.chance ? variantRow('opp.chance', cap, ownGround(turn.chance.area) ? OPP.chancePlain : OPP.chance, { area: AREA[turn.chance.area] }) : null),
    // What kind of formation it is, is said of openings and formations only. The name of a tactic is all the caption says
    // already: the row of its effect follows.
    () => (opp?.name && has(FORMATIONS, opp.name) ? variantRow('opp.name', cap, OPP.name,
      { PATTERN_NAME: PATTERN_NAME[opp.name], ...(opp.name === 'empty_cannon' || opp.name === 'heart_horse' ? NAME_WORDS[opp.name] : NAME_WORDS.opening) }) : null),
    () => {
      // More than the caption tells: an effect that names a piece besides the one that moved (what the move protects,
      // attacks, blocks, opens). 出子, 躲开, 过河, 调整 and a clause without its pieces say what the caption says: no line.
      if (!lead || !(lead.on || lead.on2)) return null;
      const clause = rivalClause(lead, me);
      if (clause === MOTIF_TERM[lead.k]) return null;
      /** @param {string} text @returns {string} the clause as a sentence of its own: 对方的8路车捉… / 这步给自己的…补上保护 */
      const own = (text) => (lead.by?.s === 'opp' && text.startsWith(actorName(lead.by, me)) ? \`对方的\${text}\` : ownSentence(text));
      const { on2, ...single } = lead;
      const shorter = on2 ? rivalClause(single, me) : null;
      const row = variantRow('opp.effect', cap, OPP.effect,
        { clause, sentence: own(clause), shorter: shorter && shorter !== MOTIF_TERM[lead.k] ? own(shorter) : null });
      // a sentence that does not fit its cap is not cut: the caption stands alone then
      if (!row) return null;
      const fitting = row.variants.map((variant) => (variant && plainLength(variant[0]) <= cap ? variant : null));
      return fitting.some((variant) => variant !== null) ? planOf('opp.effect', cap, fitting) : null;
    },
  ];
  for (const row of rows) {
    const plan = row();
    if (plan) return plan;
  }
  return null;                                           // nothing to add to the caption
}`);

// ---- pouch 1
rep(`  if (focus === 'finish') return HINT1.finish;
  return HINT1.other;`,
`  if (focus === 'finish') return HINT1.finish;
  if (focus === 'chance') return HINT1.chance;
  return HINT1.other;`);
// ---- pouch 2
rep(`    const template = !dangerFocus(events, hint.theme) ? HINT2.other : own ? HINT2.danger : HINT2.helper;`,
`    const template = !dangerFocus(events, hint.theme) ? (ownGround(hint.area) ? HINT2.plain : HINT2.other) : own ? HINT2.danger : HINT2.helper;`);

// ---- try.missed
rep(`      () => (packet.chance === 'missed' ? variantRow('try.missed', cap, TRY.missed, { M, area: missedArea ? AREA[missedArea] : null },
        (v) => v === 1 || !loses) : null),`,
`      () => (packet.chance === 'missed' ? variantRow('try.missed', cap, missedArea && ownGround(missedArea) ? TRY.missedPlain : TRY.missed,
        { M, area: missedArea ? AREA[missedArea] : null }, (v) => v === 1 || !loses) : null),`);

// ---- intent
rep(`  if (lead) return noted([\`对方这步的用意：\${clauseOf(lead, me)}。\`, \`对方这步的用意：\${MOTIF_TERM[lead.k]}。\`], 'own');`,
`  // the sentence is about the rival: his own pieces are 自己的 (CONTRACT-NOTES 138)
  if (lead) return noted([\`对方这步的用意：\${rivalClause(lead, me)}。\`, \`对方这步的用意：\${MOTIF_TERM[lead.k]}。\`], 'own');`);

// ---- danger, prep
rep(`        const after = template ? fill(template, { by: pieceName(threat.by, me, 'child'), on: threat.on ? pieceName(threat.on, me, 'child') : null }) : null;`,
`        const after = template ? fill(template, { by: actorName(threat.by, me), on: threat.on ? pieceName(threat.on, me, 'child') : null }) : null;`);

// ---- last
rep(`      // what a mistake without a named flaw did is not added: after the bare verdict it would read as its reason
      const unexplained = (mine.cat === 'mistake' || mine.cat === 'blunder') && mine.try.flaws.length === 0;
      return lead && !unexplained ? [\`\${ladder[0]}\${ownSentence(clauseOf(lead, me))}。\`, ...ladder] : ladder;`,
`      // What a mistake or a blunder did is not added. After the bare verdict it would read as its reason; after the reason
      // it tells of a piece that may be gone by now (是漏着：你白丢一个车。你的五路车将军。).
      const bad = mine.cat === 'mistake' || mine.cat === 'blunder';
      return lead && !bad ? [\`\${ladder[0]}\${ownSentence(clauseOf(lead, me))}。\`, ...ladder] : ladder;`);

// ---- over
rep(`  if (over.proud) parts.push(proudLadder(over.proud)[0]);
  // the goal follows a dash, as on the game-over card (STR.goalNext): a goal may hold a colon of its own
  if (over.goal) parts.push(\`下一盘小目标——\${HABIT_FIX[over.goal]}。\`);
  const rank`,
`  if (over.proud) parts.push(proudLadder(over.proud)[0]);
  // The small goal of the next game is not said here: the card shows it in a row of its own, right under this line
  // (CONTRACT-NOTES 138). 「下一盘注意什么？」 still answers with it.
  const rank`);
rep(`  const about = before.kind === 'ask' ? before.ask : before.kind === 'over' ? (over.goal ? 'next' : 'proud') : null;`,
`  // the game-over line speaks of the highlighted move; without one, the goal of the card under it is what there is to explain
  const about = before.kind === 'ask' ? before.ask : before.kind === 'over' ? (over.proud || !over.goal ? 'proud' : 'next') : null;`);
rep(` * unless the line itself was the fix. After the game-over line: the habit behind its small goal, else its highlighted move.`,
` * unless the line itself was the fix. After the game-over line: its highlighted move, else the habit behind the small goal.`);

fs.writeFileSync(p, s);
console.log('ok');
