// src/coach/lexicon.js (C1) — Chinese term tables and clause builders (contract section 4.11).
// Shared by the proxy renderer and the local narrator. Pure. Imports codes.js only.
//
// Voices: in `brief` voice the sides are 我方 / 对方, in `child` voice 你 / 对方.

/**
 * @import { Color } from '../core/types.js'
 * @import { MotifCode } from '../core/codes.js'
 * @import { WPiece, PT, Net, WLine, Eval, Effect, Threat, WTakeaway } from './types.js'
 */

import { HABIT_FIX, HABIT_WORD, MOTIF_TERM, PATTERN_NAME, STRENGTH_WORD } from '../core/codes.js';

export const STRATEGIST = '诸葛亮', SELF = '亮', CHILD = '小主公', RIVAL = '司马懿';
export const PIECE = { red:   { K: '帅', A: '仕', E: '相', H: '马', R: '车', C: '炮', P: '兵' },
                       black: { K: '将', A: '士', E: '象', H: '马', R: '车', C: '炮', P: '卒' } };
export const EVAL = { won: '胜势', better: '占优', even: '均势', worse: '落了下风', lost: '很危险' };
export const AREA = { left: '左翼', center: '中路', right: '右翼', river: '河口', their_palace: '对方九宫', my_palace: '己方九宫',
                      their_back: '对方底线', my_back: '己方底线' };
export const SIZE = { pawn: '一个兵', piece: '一个马或炮', rook: '一个车', mate: '一盘棋的胜负', position: '一点阵形上的便宜' };
export const TAG = { great: '好棋', slip: '失误', missed: '错过机会', punished: '被对方抓住了疏漏' };
export const FOCUS = { danger: '先看对方的威胁', chance: '找对方的破绽', develop: '出动还没出来的子', improve: '把位置别扭的子调好', finish: '把优势变成杀棋' };
export const QUALITY_NOTE = { strong: '这是一步强手。', normal: '', soft: '这步走得偏软。', slip: '这步有漏洞。' };

// ---- private tables ----

/** File numerals of the red side, file 1..9. */
const HANZI = '一二三四五六七八九';
/** 前 / 中 / 后 for a piece that shares its file with another of its kind. */
const RANK_WORD = { front: '前', mid: '中', back: '后' };
/** Counting words for a list of pieces: 一个炮、两个兵. */
const COUNT_WORD = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九'];

/**
 * The clause template of every motif (contract section 4.11). {by}, {on}, {on2} are piece names.
 * @type {Readonly<Record<MotifCode, string>>}
 */
const CLAUSE = Object.freeze({
  capture: '{by}吃掉{on}',
  capture_free: '{by}白吃{on}，吃完不会被吃回',
  trade: '{by}吃{on}，自己也会被吃回，等于兑子',
  check: '{by}将军',
  mate: '{by}形成绝杀',
  mate_threat: '{by}下一步就要将死，必须先解围',
  fork: '{by}同时捉住{on}和{on2}，只能救一个',
  discovered: '{by}一闪开，后面的{on2}就打到了{on}',
  pin: '{by}牵住了{on}，它一动后面的{on2}就丢',
  attack: '{by}捉{on}',
  defend: '给{on}补上保护',
  escape: '{by}躲开了攻击',
  block: '{by}垫在中间，挡住了对{on}的攻击',
  block_leg: '{by}蹩住了{on}的马腿',
  block_eye: '{by}塞住了{on}的象眼',
  open_rook: '给{on}亮出了通道',
  develop: '{by}出动',
  cannon_mount: '{by}借{on2}当炮架，瞄着{on}',
  restrict_king: '封住了{on}的一条退路',
  cross_river: '{by}过了河，之后可以横走',
  sacrifice: '弃掉{by}换取攻势',
  quiet: '调整了一下阵形',
  hang: '{on}没有保护，会被{by}白吃',
  unguard: '{by}一走，{on}就没人保护了',
  ignore_threat: '没有理会{by}对{on}的威胁',
  greedy: '{on}有{on2}保护，{by}吃了它会被吃回',
  bad_trade: '用{by}去换{on}，换亏了',
  miss_capture: '错过了白吃{on}的机会',
  miss_mate: '错过了一步杀棋',
  allow_mate: '这步走完，对方就有杀棋',
  walk_fork: '{by}一步就能同时捉住{on}和{on2}',
  walk_pin: '{on}会被{by}牵住，动不了',
  waste: '这步没有实际作用，白让对方走一步',
});
/**
 * The cannon template without its screen clause. A Threat has no `on2` (section 3.6), yet a cannon aiming through a screen is a
 * threat kind (section 4.14.1), so threatClause meets `cannon_mount` without the screen.
 */
const CANNON_NO_SCREEN = '{by}瞄着{on}';

/** @param {Color} color @returns {Color} */
const other = (color) => (color === 'red' ? 'black' : 'red');

/**
 * The entry of a codes.js table for a code that may not be one of its keys.
 * @param {Readonly<Record<string, string>>} table @param {string} code @returns {string|undefined}
 */
const entry = (table, code) => (Object.hasOwn(table, code) ? table[code] : undefined);

/**
 * 一个炮、两个兵: pieces of one type are counted together, in the order they first appear; the characters are the owner's.
 * @param {PT[]} pieces @param {Color} owner @returns {string}
 */
function pieceList(pieces, owner) {
  /** @type {Map<PT, number>} */
  const counts = new Map();
  for (const t of pieces) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => (COUNT_WORD[n] ?? String(n)) + '个' + PIECE[owner][t]).join('、');
}

// ---- helpers ----

/**
 * Side word + file numeral (汉字 for red, Arabic for black) + 路 + 前/中/后 when `q` + piece character; kings have no file.
 * `{s:'opp',t:'H',f:7}` with `me:'red'` -> brief 对方7路马, child 对方的7路马.
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

/**
 * "R2H2C2P5A2E2" -> 车2 马2 炮2 兵5 仕2 相2 (the piece characters of `color`).
 * @param {string} str
 * @param {Color} color
 * @returns {string}
 */
export function matWords(str, color) {
  const words = [];
  for (const m of str.matchAll(/([KRHCPAE])([0-9])/g)) words.push(PIECE[color][/** @type {PT} */ (m[1])] + m[2]);
  return words.join(' ');
}

/**
 * |cp| < 60 双方子力相当。 else {我方|你}多{amountWords}。 / {我方|你}少{amountWords}。
 * @param {number} cp
 * @param {'brief'|'child'} voice
 * @returns {string}
 */
export function balanceWords(cp, voice) {
  if (Math.abs(cp) < 60) return '双方子力相当。';
  return (voice === 'child' ? '你' : '我方') + (cp > 0 ? '多' : '少') + amountWords(cp) + '。';
}

/**
 * 60–199 大约一个兵; 200–349 大约一个士或象; 350–599 大约一个马或炮; 600–1199 大约一个车; >= 1200 一个车以上.
 * The sign is ignored. The contract names no band below 60 (its callers never ask for one); such an amount reads as the lowest band.
 * @param {number} cp
 * @returns {string}
 */
export function amountWords(cp) {
  const a = Math.abs(cp);
  if (a >= 1200) return '一个车以上';
  if (a >= 600) return '大约一个车';
  if (a >= 350) return '大约一个马或炮';
  if (a >= 200) return '大约一个士或象';
  return '大约一个兵';
}

/**
 * < 30 和最好的走法几乎一样; 30–59 只差一点点; >= 60 比最好的走法亏了{amountWords}.
 * @param {number} loss
 * @returns {string}
 */
export function lossWords(loss) {
  if (loss < 30) return '和最好的走法几乎一样';
  if (loss < 60) return '只差一点点';
  return '比最好的走法亏了' + amountWords(loss);
}

/**
 * 比试走的这步好{amountWords}.
 * @param {number} gain
 * @returns {string}
 */
export function gainWords(gain) {
  return '比试走的这步好' + amountWords(gain);
}

/**
 * EVAL[b], or with mate: {n}步之内可以将死对方 / {n}步之内有被将死的危险.
 * @param {Eval} ev
 * @returns {string}
 */
export function evalWords(ev) {
  const mate = ev.mate ?? 0;
  if (mate > 0) return mate + '步之内可以将死对方';
  if (mate < 0) return -mate + '步之内有被将死的危险';
  return EVAL[ev.b];
}

/**
 * The balance of a line in words; subject 我方 (brief) or 你 (child). Lists use the owner's piece characters.
 * @param {Net} net
 * @param {Color} me
 * @param {'brief'|'child'} voice
 * @returns {string}
 */
export function netClause(net, me, voice) {
  const subject = voice === 'child' ? '你' : '我方';
  const gain = pieceList(net.gain, other(me));
  const lose = pieceList(net.lose, me);
  if (!gain && !lose) return '双方都没有丢子';
  if (!lose) return subject + '白吃' + gain;
  if (!gain) return subject + '白丢' + lose;
  const sum = net.cp >= 150 ? '，算下来赚了' : net.cp <= -150 ? '，算下来亏了' : '，大致相当';
  return subject + '吃到' + gain + '，丢掉' + lose + sum;
}

/**
 * 对方【马7进5】→我方【马八进七】→对方【马2进3】，结果：{netClause}{，并将军|，最后将死}. Every ply is listed in order.
 * @param {WLine} line
 * @param {Color} me
 * @returns {string}
 */
export function lineText(line, me) {
  const sides = line.first === 'me' ? ['我方', '对方'] : ['对方', '我方'];
  const plies = line.moves.map((move, k) => sides[k % 2] + '【' + move + '】').join('→');
  const end = line.end === 'check' ? '，并将军' : line.end === 'mate' ? '，最后将死' : '';
  return plies + '，结果：' + netClause(line.net, me, 'brief') + end;
}

/**
 * The per-motif clause template of contract section 4.11 filled with piece names.
 * When a piece the template names is absent the clause falls back to the motif's term (MOTIF_TERM), except that a `cannon_mount`
 * without its screen reads {by}瞄着{on}.
 * @param {Effect} effect
 * @param {Color} me
 * @param {'brief'|'child'} voice
 * @returns {string}
 */
export function effectClause(effect, me, voice) {
  let template = entry(CLAUSE, effect.k);
  if (template === undefined) return motifTerm(effect.k);
  if (effect.k === 'cannon_mount' && !effect.on2) template = CANNON_NO_SCREEN;
  let complete = true;
  const clause = template.replace(/\{(by|on2|on)\}/g, (_, key) => {
    const ref = effect[/** @type {'by'|'on'|'on2'} */ (key)];
    if (!ref) complete = false;
    return ref ? pieceName(ref, me, voice) : '';
  });
  return complete ? clause : motifTerm(effect.k);
}

/**
 * effectClause({k, by, on}, me, voice) of a threat.
 * @param {Threat} threat
 * @param {Color} me
 * @param {'brief'|'child'} voice
 * @returns {string}
 */
export function threatClause(threat, me, voice) {
  return effectClause({ k: threat.k, by: threat.by, on: threat.on }, me, voice);
}

/**
 * strength 长处：…; habit 下一盘的小目标：…; idea 可以学的一招：…; each followed by its example when `ex` exists.
 * @param {WTakeaway} t
 * @param {Color} me
 * @returns {string}
 */
export function takeawayClause(t, me) {
  const head = t.kind === 'strength' ? '长处：' + (entry(STRENGTH_WORD, t.code) ?? motifTerm(t.code))
    : t.kind === 'habit' ? '下一盘的小目标：' + (entry(HABIT_FIX, t.code) ?? motifTerm(t.code))
    : '可以学的一招：' + (entry(PATTERN_NAME, t.code) ?? motifTerm(t.code));
  if (!t.ex) return head;
  return head + '，例如第' + t.ex.n + '回合【' + t.ex.move + '】' + (t.ex.better ? '，换成【' + t.ex.better + '】更好' : '');
}

/**
 * MOTIF_TERM[code] ?? PATTERN_NAME[code] ?? STRENGTH_WORD[code] ?? HABIT_WORD[code]; '' for a code none of the four tables has.
 * @param {string} code
 * @returns {string}
 */
export function motifTerm(code) {
  return entry(MOTIF_TERM, code) ?? entry(PATTERN_NAME, code) ?? entry(STRENGTH_WORD, code) ?? entry(HABIT_WORD, code) ?? '';
}
