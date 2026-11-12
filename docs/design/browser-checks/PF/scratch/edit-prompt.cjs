// PF items 8, 9, 10 in server/prompt.js (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/server/prompt.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 80)); s = s.replace(a, b); };

// ---- item 9: the over directive; item 8: the chance directive without an area
rep(`  oppChance: '提醒小主公那一带有机会，让小主公自己找。',`,
`  oppChance: '提醒小主公那一带有机会，让小主公自己找。',
  oppChancePlain: '提醒小主公眼下有机会，让小主公自己找。',`);
rep(`  over: '先用半句回应胜负（赢了一起高兴，输了先安慰），再讲「要点」里的那一条，引用本局那一步，这一句不超过30字；有「下一盘小目标」就用它收尾。一共80字以内。',`,
`  // The card shows the small goal of the next game in a row of its own, right under this reply (CONTRACT-NOTES 138): the
  // reply does not say it a second time. A habit takeaway is worded as that goal, so of it only the quoted move is told.
  over: '先用半句回应胜负（赢了一起高兴，输了先安慰），再讲「要点」里的那一条，引用本局那一步，这一句不超过30字。「下一盘小目标」界面已经单独显示给小主公了，回复里不要再说一遍；要点就是这个小目标时，只讲它引用的那一步。一共80字以内。',`);

// ---- item 10: the turn of a finished game
rep(`/**
 * The 〔军情〕 block of a thread: one line per row of the table of contract section 8.4; a row is omitted when its data
 * is empty. A negative sentence (no threat, no chance) is printed only when its \`known\` flag is true.
 * @param {TurnBrief} turn
 * @returns {string}
 */
export function renderTurn(turn) {
  const { me } = turn;
  const lines = ['〔军情〕'];

  let position = \`局面：第\${Math.floor(turn.ply / 2) + 1}回合，小主公执\${COLOR_WORD[me]}，轮到小主公走。\${PHASE_WORD[turn.phase]}阶段。\`;
  if (turn.check) position += \`小主公正被将军，必须应将，共有\${turn.n}种应法。\`;
  lines.push(position);
`,
`/**
 * The 〔军情〕 block of a thread: one line per row of the table of contract section 8.4; a row is omitted when its data
 * is empty. A negative sentence (no threat, no chance) is printed only when its \`known\` flag is true.
 * @param {TurnBrief} turn
 * @param {boolean} [over] the thread of a finished game (its first event is \`over\`): nobody is to move any more, so the
 *        position line says neither 轮到小主公走 nor that a check must be answered (CONTRACT-NOTES 138)
 * @returns {string}
 */
export function renderTurn(turn, over = false) {
  const { me } = turn;
  const lines = ['〔军情〕'];

  let position = \`局面：第\${Math.floor(turn.ply / 2) + 1}回合，小主公执\${COLOR_WORD[me]}，\${over ? '' : '轮到小主公走。'}\${PHASE_WORD[turn.phase]}阶段。\`;
  if (turn.check && !over) position += \`小主公正被将军，必须应将，共有\${turn.n}种应法。\`;
  lines.push(position);
`);

// ---- item 8: a chance in the child's own palace or back rows is told without its area
rep(`  if (turn.chance) {
    const { chance } = turn;
    lines.push(\`机会：对方阵中有破绽，在\${AREA[chance.area]}，和「\${motifTerm(chance.theme)}」有关，分量约\${SIZE[chance.size]}。具体着法没有提供。\`);
  } else if (turn.known.chance) {`,
`  if (turn.chance) {
    const { chance } = turn;
    // the area is the square the child's move lands on: in the child's own palace or back rows it is not named (对方阵中有
    // 破绽，在己方九宫 would have the model tell the child that their own palace holds a chance; CONTRACT-NOTES 138)
    const where = ownGround(chance.area) ? '' : \`在\${AREA[chance.area]}，\`;
    lines.push(\`机会：对方阵中有破绽，\${where}和「\${motifTerm(chance.theme)}」有关，分量约\${SIZE[chance.size]}。具体着法没有提供。\`);
  } else if (turn.known.chance) {`);
rep(`/** @param {Color} color @returns {Color} */
const otherColor = (color) => (color === 'red' ? 'black' : 'red');
`,
`/** @param {Color} color @returns {Color} */
const otherColor = (color) => (color === 'red' ? 'black' : 'red');

/** @param {string} area @returns {boolean} the child's own palace or back rows */
const ownGround = (area) => area.startsWith('my_');
`);
rep(`        : turn.chance ? DIRECTIVE.oppChance`,
    `        : turn.chance ? (ownGround(turn.chance.area) ? DIRECTIVE.oppChancePlain : DIRECTIVE.oppChance)`);

// ---- buildMessages: the turn of an over thread
rep(`  let pending = renderTurn(turn);
  events.forEach((event, k) => {`,
`  let pending = renderTurn(turn, events[0]?.kind === 'over');
  events.forEach((event, k) => {`);

fs.writeFileSync(p, s);
console.log('ok');
