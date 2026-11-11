// src/coach/lexicon.js (C1) — Chinese term tables and clause builders (contract section 4.11).
// Shared by the proxy renderer and the local narrator. Pure. Imports codes.js only.
//
// Voices: in `brief` voice the sides are 我方 / 对方, in `child` voice 你 / 对方. The `rival` voice is the child voice for a
// sentence whose subject is the rival (对方这步的用意：…): there his own pieces are 自己的, not 对方的 (CONTRACT-NOTES 138).
// In the child voice a clause names 对方的 once: a rival piece named right after another one has no side word (item 147).

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
 * Clauses for an effect that leaves a piece out on purpose (CONTRACT-NOTES 133), so that the reader gets more than the bare
 * term: a Threat has no `on2` (section 3.6); the brief names no forking piece when two pieces are attacked by different
 * pieces, and in a first flaw no rival piece that does not play the reply (no guard of a greedy capture, no attacker of an
 * ignored threat, no pinner). Tried in order after the full template: the first whose pieces are all in the effect is used.
 * A clause says no more than its pieces show: without the second target of a fork, 只能救一个 is not claimed (the other may
 * be the king), and of a pin without the piece behind only that the pinned piece is not free to move.
 * @type {Readonly<Partial<Record<MotifCode, readonly string[]>>>}
 */
const PARTIAL = Object.freeze({
  fork: ['{by}同时捉住{on}和另一个子', '{on}和{on2}同时被捉，只能救一个', '{by}同时捉住两个子'],
  discovered: ['{by}一闪开，后面的子就打到了{on}'],
  pin: ['{by}牵住了{on}，它不能随便动'],
  cannon_mount: ['{by}瞄着{on}'],
  hang: ['{on}没有保护，会被白吃'],
  ignore_threat: ['没有理会对{on}的威胁'],
  greedy: ['{on}有保护，{by}吃它不划算'],
  walk_fork: ['{on}和{on2}会同时被捉'],
  walk_pin: ['{on}会被牵住，动不了'],
});
/**
 * Clauses for a second piece (`on2`) that is a king. A king is never lost and never "the one that is not saved": the piece
 * that shields it from a pin cannot step away at all, and a fork that includes it is a check that also attacks the other
 * piece. Tried before the full template, with and then without the acting piece. The first fork clause is also the one
 * of a fork named `check_fork` whose second piece is not given (a Threat).
 * @type {Readonly<Partial<Record<MotifCode, readonly string[]>>>}
 */
const KING_BEHIND = Object.freeze({
  pin: ['{by}牵住了{on}，它挡着{on2}，不能走开'],
  fork: ['{by}将军，同时捉住{on}', '将军的同时，{on}也被捉住'],
  walk_fork: ['{by}一步就能将军，同时捉住{on}', '会被将军，同时{on}也被捉住'],
});

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
 * Side word + file numeral (汉字 for red, Arabic for black) + 路 + 前/中/后 when `q` + piece character; kings have no file.
 * `{s:'opp',t:'H',f:7}` with `me:'red'` -> brief 对方7路马, child 对方的7路马, rival 自己的7路马 (the child's pieces are 你的
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
 * A clause template filled with the piece names of an effect; null when a piece the template names is absent.
 * In the rival voice the clause continues a sentence about the rival: a piece of his that acts (`by`), or that follows
 * 后面的, is named without a side word (7路马出动, 后面的5路炮), his other pieces are 自己的. Where the clause has a piece of
 * the child as its own subject (你的四路马一步就能同时捉住…), 自己的 would point at that piece: his pieces are 他的 there.
 * @param {string} template @param {Effect} effect @param {Color} me @param {'brief'|'child'|'rival'} voice @returns {string|null}
 */
function filled(template, effect, me, voice) {
  let complete = true;
  const first = /\{(by|on2|on)\}/.exec(template);
  const childLeads = first !== null && effect[/** @type {'by'|'on'|'on2'} */ (first[1])]?.s === 'me';
  /** The piece named just before the one being filled in. @type {WPiece|undefined} */
  let previous;
  const clause = template.replace(/\{(by|on2|on)\}/g, (_, key, at) => {
    const ref = effect[/** @type {'by'|'on'|'on2'} */ (key)];
    if (!ref) {
      complete = false;
      return '';
    }
    const before = previous;
    previous = ref;
    // 牵住了对方的5路马，它一动后面的对方的2路车就丢: the piece behind is of the side just named, so in the child's
    // voices it is read without a second 对方的
    if (voice !== 'brief' && ref.s === 'opp' && before?.s === 'opp' && template.slice(0, at).endsWith('后面的')) return bareName(ref, me);
    // In the child's voice a clause says 对方的 once (CONTRACT-NOTES 147): a piece of the rival that is named right after
    // another piece of his carries no second side word (你的四路马同时捉住对方的3路车和7路炮, 对方的5路卒有7路马保护).
    if (voice === 'child' && ref.s === 'opp' && before?.s === 'opp') return bareName(ref, me);
    if (voice === 'rival' && ref.s === 'opp') {
      if (key === 'by') return bareName(ref, me);
      if (childLeads) return '他的' + bareName(ref, me);
    }
    return pieceName(ref, me, voice);
  });
  return complete ? clause : null;
}

/**
 * The per-motif clause template of contract section 4.11 filled with piece names.
 * A second piece that is a king has its own wording (KING_BEHIND). When a piece the template names is absent, the clause is
 * the first of the motif's templates for fewer pieces that can be filled (PARTIAL: a `cannon_mount` without its screen reads
 * {by}瞄着{on}, a fork without a single forking piece {on}和{on2}同时被捉，只能救一个); when none can, the motif's term
 * (MOTIF_TERM). A clause never prints a hole.
 * @param {Effect} effect
 * @param {Color} me
 * @param {'brief'|'child'|'rival'} voice  rival: for a sentence whose subject is the rival (see `filled`)
 * @returns {string}
 */
export function effectClause(effect, me, voice) {
  const full = entry(CLAUSE, effect.k);
  if (full === undefined) return motifTerm(effect.k);
  const k = /** @type {MotifCode} */ (effect.k);
  const kingBehind = effect.on2?.t === 'K' && effect.on?.t !== 'K' ? KING_BEHIND[k] ?? []
    : k === 'fork' && effect.name === 'check_fork' && !effect.on2 ? KING_BEHIND.fork ?? [] : [];
  for (const template of [...kingBehind, full, ...(PARTIAL[k] ?? [])]) {
    const clause = filled(template, effect, me, voice);
    if (clause !== null) return clause;
  }
  return motifTerm(effect.k);
}

/**
 * effectClause({k, by, on}, me, voice) of a threat. Its pattern name goes along: a fork named `check_fork` is told as a
 * check that also attacks `on` (a Threat has no `on2` to show that the second target is the king).
 * @param {Threat} threat
 * @param {Color} me
 * @param {'brief'|'child'|'rival'} voice
 * @returns {string}
 */
export function threatClause(threat, me, voice) {
  return effectClause({ k: threat.k, by: threat.by, on: threat.on, ...(threat.name ? { name: threat.name } : {}) }, me, voice);
}

/**
 * strength 长处：…; habit 下一盘的小目标——…; idea 可以学的一招：…; each followed by its example when `ex` exists.
 * The goal follows a dash, as everywhere a goal is quoted (CONTRACT-NOTES 133): a goal may hold a colon of its own
 * (对方走完，先问自己：他想干什么), and the model copies what it reads.
 * @param {WTakeaway} t
 * @param {Color} me
 * @returns {string}
 */
export function takeawayClause(t, me) {
  const head = t.kind === 'strength' ? '长处：' + (entry(STRENGTH_WORD, t.code) ?? motifTerm(t.code))
    : t.kind === 'habit' ? '下一盘的小目标——' + (entry(HABIT_FIX, t.code) ?? motifTerm(t.code))
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
