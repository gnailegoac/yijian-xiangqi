// PF item 7: the `rival` voice of the lexicon (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/coach/lexicon.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 70)); s = s.replace(a, b); };

rep(`// Voices: in \`brief\` voice the sides are 我方 / 对方, in \`child\` voice 你 / 对方.
`,
`// Voices: in \`brief\` voice the sides are 我方 / 对方, in \`child\` voice 你 / 对方. The \`rival\` voice is the child voice for a
// sentence whose subject is the rival (对方这步的用意：…): there his own pieces are 自己的, not 对方的 (CONTRACT-NOTES 138).
`);

rep(`/**
 * Side word + file numeral (汉字 for red, Arabic for black) + 路 + 前/中/后 when \`q\` + piece character; kings have no file.
 * \`{s:'opp',t:'H',f:7}\` with \`me:'red'\` -> brief 对方7路马, child 对方的7路马.
 * @param {WPiece} ref
 * @param {Color} me
 * @param {'brief'|'child'} voice
 * @returns {string}
 */
export function pieceName(ref, me, voice) {
  const mine = ref.s === 'me';
  const owner = mine ? me : other(me);
  const side = voice === 'child' ? (mine ? '你的' : '对方的') : (mine ? '我方' : '对方');
  const char = PIECE[owner][ref.t];
  if (ref.t === 'K') return side + char;
  const file = owner === 'red' ? (HANZI[ref.f - 1] ?? String(ref.f)) : String(ref.f);
  return side + file + '路' + (ref.q ? RANK_WORD[ref.q] : '') + char;
}
`,
`/**
 * A piece without its side word: 7路马, 五路炮, 将.
 * @param {WPiece} ref @param {Color} me @returns {string}
 */
function bareName(ref, me) {
  const owner = ref.s === 'me' ? me : other(me);
  const char = PIECE[owner][ref.t];
  if (ref.t === 'K') return char;
  const file = owner === 'red' ? (HANZI[ref.f - 1] ?? String(ref.f)) : String(ref.f);
  return file + '路' + (ref.q ? RANK_WORD[ref.q] : '') + char;
}

/**
 * Side word + file numeral (汉字 for red, Arabic for black) + 路 + 前/中/后 when \`q\` + piece character; kings have no file.
 * \`{s:'opp',t:'H',f:7}\` with \`me:'red'\` -> brief 对方7路马, child 对方的7路马, rival 自己的7路马 (the child's pieces are 你的
 * in the rival voice too).
 * @param {WPiece} ref
 * @param {Color} me
 * @param {'brief'|'child'|'rival'} voice
 * @returns {string}
 */
export function pieceName(ref, me, voice) {
  const mine = ref.s === 'me';
  const side = voice === 'brief' ? (mine ? '我方' : '对方') : mine ? '你的' : voice === 'rival' ? '自己的' : '对方的';
  return side + bareName(ref, me);
}
`);

rep(`/**
 * A clause template filled with the piece names of an effect; null when a piece the template names is absent.
 * @param {string} template @param {Effect} effect @param {Color} me @param {'brief'|'child'} voice @returns {string|null}
 */
function filled(template, effect, me, voice) {
  let complete = true;
  const clause = template.replace(/\\{(by|on2|on)\\}/g, (_, key) => {
    const ref = effect[/** @type {'by'|'on'|'on2'} */ (key)];
    if (!ref) complete = false;
    return ref ? pieceName(ref, me, voice) : '';
  });
  return complete ? clause : null;
}
`,
`/**
 * A clause template filled with the piece names of an effect; null when a piece the template names is absent.
 * In the rival voice the clause continues a sentence about the rival: a piece of his that acts (\`by\`), or that follows
 * 后面的, is named without a side word (7路马出动, 后面的5路炮), his other pieces are 自己的.
 * @param {string} template @param {Effect} effect @param {Color} me @param {'brief'|'child'|'rival'} voice @returns {string|null}
 */
function filled(template, effect, me, voice) {
  let complete = true;
  const clause = template.replace(/\\{(by|on2|on)\\}/g, (_, key, at) => {
    const ref = effect[/** @type {'by'|'on'|'on2'} */ (key)];
    if (!ref) {
      complete = false;
      return '';
    }
    if (voice === 'rival' && ref.s === 'opp' && (key === 'by' || template.slice(0, at).endsWith('后面的'))) return bareName(ref, me);
    return pieceName(ref, me, voice);
  });
  return complete ? clause : null;
}
`);

rep(` * (MOTIF_TERM). A clause never prints a hole.
 * @param {Effect} effect
 * @param {Color} me
 * @param {'brief'|'child'} voice
 * @returns {string}
 */
export function effectClause(effect, me, voice) {`,
` * (MOTIF_TERM). A clause never prints a hole.
 * @param {Effect} effect
 * @param {Color} me
 * @param {'brief'|'child'|'rival'} voice  rival: for a sentence whose subject is the rival (see \`filled\`)
 * @returns {string}
 */
export function effectClause(effect, me, voice) {`);

rep(` * @param {Threat} threat
 * @param {Color} me
 * @param {'brief'|'child'} voice
 * @returns {string}
 */
export function threatClause(threat, me, voice) {`,
` * @param {Threat} threat
 * @param {Color} me
 * @param {'brief'|'child'|'rival'} voice
 * @returns {string}
 */
export function threatClause(threat, me, voice) {`);

fs.writeFileSync(p, s);
console.log('ok');
