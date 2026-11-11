// src/coach/fallback.js (C2) — the local narrator (contract sections 4.15, 8.6, 8.7).
// Pure, deterministic. The proxy loads it, so it may import only codes.js, lexicon.js and protocol.js
// (import rule of contract section 2; the caps of section 8.3 come from CAPS / capFor / plainLength in protocol.js).
//
// What the child hears whenever the language model is off, slow or failing, and every voiced guiding question.
// The sentence tables below are the templates of section 8.6; `{…}` and 【M】 are filled from the packet. Where a sentence of
// the contract was ungrammatical, said more than its packet supports or confused who is meant, it is worded as the owner
// decided (CONTRACT-NOTES items 111 to 113, 131, 133 and 138); the row names are 8.6's, and so are the number of variants and
// what each variant index means, except in the two rows item 138 rebuilt (opp.name, opp.effect). A variant whose wording
// would not be true of the packet at hand gives way to the next one.
// Item 147 (fix package PG) added one row, `try.grim` (a good verdict with nothing to praise), the bare form of `try.only`
// for a forced move, and the rule that a praising interjection goes only with a sentence from a praising row (cueFor).
// Item 150 (fix package FB): a move after which the child is mated has nothing to praise, whatever it does; the words of the
// grim row follow the evaluation after the move (最顽强 / 局面吃紧 / 难是难 only where the child is in trouble, 只是要丢点子
// elsewhere); 为什么？ says 没有明显更好的走法 of a 稳健 move only when no better move is listed.

/**
 * @import { Color } from '../core/types.js'
 * @import { AskCode, Cat, CueCode, MotifCode } from '../core/codes.js'
 * @import { TurnBrief, CoachEvent, ToolVerdict, TryPacket, MorePacket, OverPacket, Effect, Net, WLine, WPiece, Moment, PT,
 *           Hint1, Hint2, Hint3, Eval } from './types.js'
 */

import {
  CAT_LABEL, HABIT_FIX, HABIT_WORD, MOTIF_TERM, NOTABLE_MOTIFS, PATTERN_NAME, PIECE_VALUE, RANK_NAMES, TACTIC_MOTIFS, TYPE_OF_PT,
} from '../core/codes.js';
import { AREA, PIECE, balanceWords, effectClause, evalWords, motifTerm, netClause, pieceName, threatClause } from './lexicon.js';
import { CAPS, capFor, plainLength } from './protocol.js';

// ---------------------------------------------------------------------------------------------------------------------
// The templates of section 8.6
// ---------------------------------------------------------------------------------------------------------------------

const START = ['小主公，红先黑后，请落第一子。', '新的一局，小主公请先行。', '出师顺利！小主公请。'];

/** Rival-move rows (one sentence, cap 18). */
const OPP = {
  mate: ['对方下一步有杀棋，先护{K}！', '不可大意，对方要杀棋了！', '{K}有危险，先解围！', '先别进攻，对方有杀着。', '要紧！先给{K}找条活路。',
    '对方亮出杀招，快护{K}！'],
  // 先解围, not 先躲一躲: the packet does not say that the king has to move (a check can also be blocked or its piece taken)
  check: ['对方将军，先把{K}护好。', '被将军了，先应将。', '先解将军，别的后说。', '{K}被盯上了，先解围。', '将军！先看怎么应。',
    '应将要紧，看看有几条路。'],
  // 钻了空子, not 吃到了空子: a move that punishes need not capture
  punished: ['上一步留了空子，被抓住了。', '这是上一步的漏洞，别急。', '对方抓住了刚才的破绽。', '刚才那步留了后患。', '空子被钻了，下回先看一眼。',
    '对方不客气，钻了空子。'],
  captured: ['对方吃掉了你的{char}。', '丢了一个{char}，稳住。', '{char}被吃了，别慌。', '对方得了一个{char}。', '少了一个{char}，慢慢扳回来。',
    '{char}没了，先看眼前。'],
  threatQ: ['看看{by}，它瞄着谁？', '{by}在打什么主意？', '留神{by}的去向。'],
  // the rival is 对方 or 司马懿, never 它 (它 is only ever a piece)
  threat: ['对方盯上了{on}。', '{on}被盯上了。', '小心，{on}有危险。', '对方想吃{on}。', '{on}要当心。', '不可不防：{on}被瞄上了。'],
  overlooked: ['好险，对方漏看了一步。', '对方刚才错过了机会。', '司马懿也有走眼的时候。'],
  chance: ['{area}好像露了破绽。', '{area}有文章可做。', '看看{area}，有机会。'],
  // the same when the chance lies in the child's own palace or back rows: the area is not named (己方九宫有文章可做 would
  // tell the child that their own palace holds a chance; CONTRACT-NOTES 138)
  chancePlain: ['对方好像露了破绽。', '眼下有文章可做。', '找一找，有机会。'],
  // The caption above the bubble already carries the notation and one word: the name of the formation, or the term of the
  // move's leading effect. A sentence is said after it only when it tells more than that (CONTRACT-NOTES 138).
  // A formation: what kind of formation it is ({kind}: an opening, an attack or a weakness, NAME_WORDS).
  name: ['{PATTERN_NAME}，{kind}。'],
  // An effect: what the move is aimed at, the sentence of the `intent` answer first, then the clause as a sentence of its
  // own, then the clause without its second piece. In the rival voice: his own pieces are 自己的.
  effect: ['对方这步的用意：{clause}。', '{sentence}。', '{shorter}。'],
  // a move with nothing to tell of: the caption reads 调整, so no variant says that word again (调了一步, 在调整阵形)
  quiet: ['对方稳稳地走了一步。', '对方没有急着进攻。', '这步不急不躁。', '司马懿在布阵。', '对方先把阵脚站稳。', '平平常常的一步。'],
};
/** How a named formation of the rival is spoken of: an opening is 常见的阵势, 空头炮 is an attack, 窝心马 is a weakness. */
const NAME_WORDS = {
  opening: { kind: '常见的阵势' },
  empty_cannon: { kind: '厉害的攻势' },
  heart_horse: { kind: '是个弱点' },
};

/** Pouch 1, first match from the top. */
const HINT1 = {
  danger: '先别急着进攻：对方想干什么？',
  unguarded: '找一找：对方哪个子没人保护？',
  fork: '有没有一步，能同时捉两个子？',
  king: '对方的老将，身边还安全吗？',
  develop: '你还有哪个大子没出动？',
  finish: '怎么把对方的老将逼到没路走？',
  // a chance that is none of the above (a piece to attack, a pin, a discovered attack): 待的位置最别扭 would send the child
  // looking at their own pieces
  chance: '找一找：对方哪里有破绽？',
  other: '哪个子待的位置最别扭？',
};
/**
 * Pouch 2. `danger` is said when the piece to move is itself the piece in danger; `helper` when the danger is another
 * piece's and this one deals with it (it stands in the way, guards, or takes the attacker): 该照顾一下… would name the
 * wrong piece there.
 */
const HINT2 = {
  danger: '该照顾一下{piece}了。', helper: '看看{piece}，它能帮上忙。', other: '看看{piece}，机会在{area}。',
  // the piece is headed for the child's own palace or back rows: 机会在己方九宫 is not said (CONTRACT-NOTES 138)
  plain: '看看{piece}，它有更好的去处。',
};

/** Guiding questions for a held trial (cap 20). */
const HELD = {
  mate: ['这步走完，{K}身边还安全吗？', '先看看{K}有没有危险？', '对方的子离{K}有多近？', '{K}还有路可走吗？', '走完这步，对方能将军吗？',
    '不可不防：{K}那边稳不稳？'],
  hang: ['走完这步，{on}还有人保护吗？', '{on}走到那儿，谁来保它？', '且看：{on}会不会被白吃？', '这一步之后，{on}安全吗？', '{on}站稳了吗？谁盯着它？',
    '落子前想想：{on}有靠山吗？'],
  unguard: ['{by}一走，谁来保护{on}？', '{by}离开后，{on}怎么办？', '{on}原本靠谁保着？', '走了{by}，{on}就孤单了吧？', '{by}是不是还有别的差事？',
    '想一想：{on}靠的是谁？'],
  threat: ['先看看{by}正盯着谁？', '{by}刚才想干什么？', '{on}现在安全吗？', '对方上一步的用意是什么？', '有没有哪个子正被瞄着？', '落子前，先数数对方的威胁。'],
  greedy: ['{on}背后有没有保镖？', '吃完，{by}回得来吗？', '{on}是白给的吗？再看看。', '这个子，真的没人管吗？', '吃它之前，看看谁在撑腰。', '吃完这一口，接下来呢？'],
  fork: ['{by}下一步能跳到哪儿？', '{on}和{on2}，是不是站得太近？', '对方有没有一步捉两个？'],
  // variant 1 when the packet does not show that the two pieces stand close (a rook or a cannon reaches along a whole line,
  // and two pieces may be attacked by different pieces)
  forkApart: '{on}和{on2}，会同时被捉吗？',
  // variant 1 when the second piece is the king: the fork is a check that also attacks the other piece
  forkCheck: '对方将军的时候，{on}怎么办？',
  pin: ['{on}后面站着谁？', '{on}还能自由走动吗？', '{by}和{on}在不在一条线上？'],
  cost: ['走完这步，你的{char}有危险吗？', '想想：{char}还安全吗？', '这步之后，{char}站得稳吗？'],
  other: ['这步走完，对方最想走哪一步？', '对方会怎么回敬这一步？', '落子前，替对方想一步。', '如果你是司马懿，会怎么应？', '这步有没有留下空子？', '再看一眼对方的子力。'],
};

/** Comments on a trial that is not held (cap 24). */
const TRY = {
  only: ['【M】是眼下唯一的解法，走得对。', '只有【M】能解围，好眼力。', '此计可行：【M】是唯一的路。'],
  // the same about a forced move (at most two legal moves): nothing was found, so nothing is praised (CONTRACT-NOTES 147)
  onlyForced: ['【M】是眼下唯一的解法。'],
  // The best there was, yet nothing to praise (CONTRACT-NOTES 147): the move's own line still costs the child two points
  // or more, or the child stays far behind after it and the line wins nothing. Said instead of only, taken, praise, steady.
  grim: ['【M】是眼下最顽强的一步。', '局面吃紧，【M】是最好的应法。', '难是难，【M】没有走错。'],
  // the same about a move judged 稳健: it is not the best one, so 最顽强 and 最好的 are not said of it (CONTRACT-NOTES 148)
  grimGood: ['难是难，【M】没有走错。', '局面吃紧，【M】可以走。'],
  // The two rows where the child is not in trouble after the move (走后形势 is 均势, 占优 or 胜势): 最顽强, 局面吃紧 and 难是难
  // all say that the position is bad. There the row is reached by a line that gives two points back, and that is what is
  // said (CONTRACT-NOTES 150). `costly` for a move judged 好棋 or 妙手, `costlyGood` for one judged 稳健.
  costly: ['【M】是眼下最好的一步，只是要丢点子。', '【M】没有走错，只是要丢点子。'],
  costlyGood: ['【M】可以走，只是要丢点子。', '【M】没有走错，只是要丢点子。'],
  avoided: ['这回没踩坑，【M】走得稳。', '躲开了以前的坑，【M】可行。'],
  taken: ['【M】抓住了对方的破绽！', '【M】正中对方的破绽。', '对方的漏洞被【M】抓个正着。'],
  // {：effectClause}: a clause that starts with its piece follows a colon (【马三进四】：你的四路马…, not two subjects side by side)
  praise: ['【M】{：effectClause}。', '{effectClause}，【M】走得好。', '好一步【M】：{term}。', '【M】这步{term}，漂亮。', '此计可行：【M】{term}。',
    '【M】{term}，对方难受了。'],
  steady: ['【M】走得稳，没有毛病。', '【M】可行。', '稳当的一步。', '【M】，不急不躁。', '这步扎实。', '【M】没问题。'],
  missed: ['【M】没危险，可{area}有个机会。', '别急，{area}还有便宜没占。', '【M】稳，但错过了{area}的机会。'],
  // the same when the area is the child's own palace or back rows: it is not named (CONTRACT-NOTES 138)
  missedPlain: ['【M】没危险，可还有个机会没抓。', '别急，还有便宜没占。', '【M】稳，但错过了一个机会。'],
  ok: ['【M】可以走，不吃亏。', '【M】稳，但略慢。', '可行，只是不够紧。', '【M】不坏，{area}还有更积极的走法。', '能走。不过{area}更有戏。',
    '【M】平平，再看看{area}？'],
  slow: ['【M】慢了一点：{effectClause(flaws[0])}。', '【M】有点可惜：{term}。', '这步{term}，再想想？', '【M】不够好：{term}。',
    '{effectClause(flaws[0])}，换一步看看？', '【M】错过了更好的。'],
};

/** The `good` sentence after 【M】: whole for the four verdicts without a reason, the head for the two that give one. */
const GOOD_TAIL = { brilliant: '是妙手，难得一见。', best: '是眼下最好的一步。', good: '稳健，可以走。', ok: '稍慢，但不算错。', mistake: '是失误', blunder: '是漏着' };
/**
 * The `good` sentence for a move judged 稳健 that has nothing to praise (nothingToPraise): 稳健，可以走 is not said of a move
 * after which a piece falls, or in a position that stays 很危险 (CONTRACT-NOTES 148).
 */
const GOOD_GRIM = '没有走错，只是局面吃紧。';
/** The same where the child is not in trouble after the move: the line gives material back, the position is not 吃紧 (CONTRACT-NOTES 150). */
const GOOD_COSTLY = '没有走错，只是要丢点子。';
/** The same about a move of the rival (对方这步【M】…): a statement about his move. 可以走 would be advice to the child. */
const RIVAL_TAIL = { ...GOOD_TAIL, good: '走得稳。' };
/**
 * The two flaw clauses of the lexicon that name a side (这步走完，对方就有杀棋 / …白让对方走一步 are about a move of the child),
 * turned round for a move of the rival; they follow 对方这步【M】是失误：, so 这步 is not said again.
 * @type {Partial<Record<MotifCode, string>>}
 */
const RIVAL_FLAW = { allow_mate: '走完之后，你就有杀棋', waste: '没有实际作用，白让你走一步' };

/**
 * What stands once the rival has played the move of a threat that does not stand yet (`prep`, CONTRACT-NOTES 131 b). Said
 * after 要当心：对方想走【M】，走完…: the attack is told as what that move brings about, never as something on the board now.
 * An attack is told as a capture that then pays (就能吃掉), not as a line of fire that then exists (就捉住 / 就瞄着): the piece
 * may aim at its target already, and the move only makes the capture worth it (it adds an attacker or takes a guard away).
 * The sentence is about the rival (对方想走…), so his piece that acts is 他的…, not 对方的 a second time: 走完他的5路炮就能吃掉…
 * @type {Partial<Record<MotifCode, string>>}
 */
const PREP = {
  attack: '{by}就能吃掉{on}了',
  cannon_mount: '{by}就能吃掉{on}了',
  check: '就是将军',
  fork: '{by}就同时捉住{on}和另一个子了',
  discovered: '后面的子就打到{on}了',
  pin: '{by}就牵住{on}了',
};
/** The same for a fork named `check_fork`: the other target is the king, so it is told as a check that also attacks `on`. */
const PREP_CHECK_FORK = '{by}就将军，同时捉住{on}';
/**
 * What is added about a rival move that gave something up when the child asks what the rival is up to (CONTRACT-NOTES
 * 131 c): a statement about his move, never advice. `after`: the sentence before it was about his next move, so 这步
 * alone would point at the wrong move.
 */
const GAVE_UP = {
  soft: { own: '不过这步走得偏软。', after: '不过对方刚走的这步偏软。' },
  slip: { own: '不过这步有漏洞。', after: '不过对方刚走的这步有漏洞。' },
  overlooked: '不过对方刚才漏看了一步。',
};

const ASK = {
  noReply: '对方没有特别厉害的应对。',
  noBetter: '亮没找到更好的了，就它。',
  // 为什么？ about a slow move (缓着) that does nothing in particular, when no better move with an effect is known:
  // 因为调整了一下阵形 is no reason for 稍慢，但不算错 (CONTRACT-NOTES 147)
  slowWhy: '这步没有错，只是没给对方出难题。',
  // 为什么？ about a move judged good or better that has nothing to praise and does nothing in particular: 因为调整了一下阵形
  // is no reason for 是眼下最好的一步 in a position that is 很危险 (CONTRACT-NOTES 148)
  grimWhy: '因为眼下没有明显更好的走法。',
  quietRival: '对方眼下没有直接的威胁，是在调整阵形。',
  noThreat: '对方眼下没有直接的威胁。',                      // quietRival without its second half: said before the rival has moved
  stillLooking: '亮还在沙盘上摆，眼下没看到直接的威胁。',
  safe: '眼下没有直接的危险，可以放心走。',
  stillWatching: '亮还在看，眼下没发现直接的危险。',
  inCheck: '被将军了，先应将。',                              // the sentence of opp.check: in check, 没有直接的危险 would be wrong
  opening: '这才刚开局呢。',
  noProud: '这盘每一步都走得很稳。',
  noProudYet: '这盘还没走出最漂亮的一步，下一盘咱们一起找。',    // no highlight, and not every move was steady
  noImprove: '这盘没什么大毛病。',
  noGoal: '下一盘照这样下就行。',
  overWhy: '这一步的道理，下一局亮在棋盘上指给小主公看。',      // 为什么？ after the game when the packet holds nothing concrete
};
/**
 * What the highlighted move of a finished game achieved, by its motif: the clause of the lexicon (section 4.11) with the move as
 * its subject and without piece names (the game-over packet carries the motif, not the pieces). Said after 因为【M】.
 * @type {Partial<Record<MotifCode, string>>}
 */
const ACHIEVED = {
  capture: '吃掉了对方的一个子',
  capture_free: '白吃了对方的一个子，没有被吃回',
  trade: '和对方兑掉了一个子',
  check: '将了对方一军',
  mate: '把对方将死了',
  mate_threat: '下一步就要将死，对方必须先解围',
  fork: '同时捉住了对方的两个子，对方只能救一个',
  discovered: '一闪开，后面的子就打到了对方的子',
  pin: '牵住了对方的子，它一动后面的子就丢',
  attack: '捉住了对方的一个子',
  defend: '给自己的子补上了保护',
  escape: '躲开了对方的攻击',
  block: '垫在中间，挡住了对方的攻击',
  block_leg: '蹩住了对方的马腿',
  block_eye: '塞住了对方的象眼',
  open_rook: '给车亮出了通道',
  develop: '出动了一个大子',
  cannon_mount: '架好了炮，瞄着对方的子',
  restrict_king: '封住了对方老将的一条退路',
  cross_river: '过了河，之后可以横走',
  sacrifice: '弃子换来了攻势',
  quiet: '把阵形调整好了',
};
/** v 0: the model failed; v 1: the question was refused or filtered. */
const FREE = ['这个亮一时答不上来。小主公在棋盘上试走一下，亮就能看明白。', '这件事亮帮不上忙。要是心里有事，记得找爸爸妈妈或老师说说。咱们接着看棋？'];

const OVER = { win: '这盘赢得漂亮！', loss: '这盘惜败，不过有几步走得真不错。', draw: '握手言和，旗鼓相当。', kept: '上盘说好的，做到了！',
  // a lost game without a few good moves to point at; `lossAlone` when nothing else follows it either (no proud move, no
  // kept goal, no new rank): the takeaway box of the card would hold 这盘惜败。 and nothing more (CONTRACT-NOTES 147).
  // 胜败乃兵家常事 is the card's own line under the title and is not said twice.
  lossPlain: '这盘惜败。', lossAlone: '这盘惜败。每一盘都是练兵，下一盘再战。' };
/**
 * 这样走比你正在试的那步{更好|更差}。 The sentence names its subject (这样走): after a sentence about the answer, or about a move of
 * the rival, a bare 比…更好 would not say what is compared. `same` is not spoken: 比…差不多 is not a sentence.
 */
const VS_TRY = { better: '更好', worse: '更差' };
/** How a line that ends in mate ends, by the side that is mated: the child (被将死) or the rival (将死对方). Said after 最后. */
const MATE_END = { me: '被将死', opp: '将死对方' };
/** The child as the subject of a clause in the child's voice (lexicon.netClause, lexicon.balanceWords). */
const YOU = '你';
/** A balance within this many centipawns is 大致相当 in the words of lexicon.netClause; beyond it 算下来亏了 / 赚了. */
const EVEN_BAND = 150;
/** Effects that press the rival: a check, a threat, a piece won for nothing. */
const PRESSING = ['capture_free', 'check', 'mate', 'mate_threat', 'fork', 'discovered', 'pin', 'attack', 'cannon_mount'];
/** A move made when the side to move had at most this many legal moves is forced (CONTRACT-NOTES 138). */
const FORCED_MOVES = 2;
/** A settled balance of this many centipawns or worse: the move's own line leaves the child two points or more down. */
const GRIM_COST = -200;
/**
 * The rows of a trial that praise the move. A praising interjection (主公英明！ 妙哉！ 好棋！) goes only with a sentence from
 * one of them (CONTRACT-NOTES 147): 主公英明！…不急不躁。 says two things at once.
 */
const PRAISING_ROWS = ['try.only', 'try.avoided', 'try.taken', 'try.praise'];

/** Cap of a local guiding question (section 8.3, "local guiding question (held trial)"). */
const HELD_CAP = 20;
/** Shown after a sentence that had to be cut at its cap. */
const CUT_MARK = '……';

/** Openings and formations: the patterns of which 摆出了… / 走成了… and their kind (NAME_WORDS) can be said. The other patterns are tactics. */
const FORMATIONS = ['central_cannon', 'screen_horses', 'same_cannons', 'opposite_cannons', 'pawn_lead', 'elephant_open', 'horse_open',
  'palace_cannon', 'corner_cannon', 'empty_cannon', 'heart_horse'];
/** Pieces that reach only the points next to them: the two pieces one of them attacks at once stand close together. */
const SHORT_STEPPERS = ['H', 'P', 'A', 'E', 'K'];
/** Themes of a pouch whose direction is "see the rival's threat first" (section 4.14.4: the themes that come with focus danger). */
const DANGER_THEMES = ['check', 'mate_threat', 'escape', 'defend'];

// ---------------------------------------------------------------------------------------------------------------------
// Plans: the row that answers an event, with every variant composed
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A plan: the first applicable row for an event, with every variant composed. `variants[v]` is null when variant `v` cannot be
 * said about this packet (a piece or an area it names is not in the packet); otherwise it lists the ways to say it, the fullest
 * first: variant rows have one, the single-sentence rows fall back to a shorter rendering (a trailing sentence dropped, a clause
 * replaced by its term) before anything is cut. `fixed`: `v` selects the sentence by meaning, so `localLine` does not rotate it.
 * @param {string} row @param {number} cap @param {(string[]|null)[]} variants @param {boolean} [fixed]
 * @returns {{row:string, cap:number, variants:(string[]|null)[], fixed?:boolean}}
 */
const planOf = (row, cap, variants, fixed) => (fixed ? { row, cap, variants, fixed } : { row, cap, variants });

/**
 * Fills `{name}` placeholders and 【M】; null when a value is missing.
 * @param {string} template @param {Record<string, string|null|undefined>} slots @returns {string|null}
 */
function fill(template, slots) {
  let complete = true;
  const text = template.replace(/【M】|\{([^{}]+)\}/g, (whole, key) => {
    const value = whole === '【M】' ? slots.M : slots[key];
    if (typeof value !== 'string' || value === '') {
      complete = false;
      return '';
    }
    return whole === '【M】' ? `【${value}】` : value;
  });
  return complete ? text : null;
}

/**
 * A row of variants. Null when none of its variants can be said, so that the next row is tried.
 * @param {string} id @param {number} cap @param {readonly string[]} templates
 * @param {Record<string, string|null|undefined>} [slots]
 * @param {(v:number) => boolean} [usable]  false for a variant whose wording does not suit this packet
 * @returns {ReturnType<typeof planOf>|null}
 */
function variantRow(id, cap, templates, slots = {}, usable) {
  const variants = templates.map((template, v) => {
    if (usable && !usable(v)) return null;
    const text = fill(template, slots);
    return text === null ? null : [text];
  });
  return variants.some((variant) => variant !== null) ? planOf(id, cap, variants) : null;
}

/**
 * A row with one sentence (or one short paragraph) and its shorter renderings.
 * @param {string} id @param {number} cap @param {(string|null|undefined)[]} ladder @returns {ReturnType<typeof planOf>|null}
 */
function singleRow(id, cap, ladder) {
  /** @type {string[]} */
  const renderings = [];
  for (const text of ladder) {
    if (typeof text === 'string' && text !== '' && !renderings.includes(text)) renderings.push(text);
  }
  return renderings.length > 0 ? planOf(id, cap, [renderings]) : null;
}

/** @param {readonly string[]} list @param {string|undefined} code @returns {boolean} */
const has = (list, code) => code !== undefined && list.includes(code);

/** @param {Net} net @returns {boolean} something changes hands */
const changesHands = (net) => net.gain.length > 0 || net.lose.length > 0;

/**
 * The clause of an effect in the child's voice (lexicon.effectClause; the bare term when a piece it names is not in the packet).
 * One clause is not used as it stands: 下一步就要将死，必须先解围 is advice to the side under threat, so about the child's own
 * mating threat it would read as advice to the child. There the term (叫杀) is said instead.
 * @param {Effect} effect @param {Color} me @returns {string}
 */
function clauseOf(effect, me) {
  if (effect.k === 'mate_threat' && effect.by?.s === 'me') return MOTIF_TERM.mate_threat;
  return effectClause(effect, me, 'child');
}

/**
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

/** @param {string} clause @returns {boolean} the clause starts with the piece that acts (你的… / 对方的…) */
const startsWithPiece = (clause) => /^(?:你的|对方的)/.test(clause);

/**
 * A clause as a sentence of its own. A clause without a subject (给…补上保护, 封住了…, a bare term) would not say who acts,
 * or would read as an order to the child: 这步 is its subject.
 * @param {string} clause @returns {string}
 */
const ownSentence = (clause) => (startsWithPiece(clause) || clause.startsWith('这步') ? clause : `这步${clause}`);

/**
 * Who is mated at the end of a line that ends in mate: the side that did not make the last move. When the evaluation of the
 * position the line starts from carries a mate distance, its sign decides instead (a packet may list fewer moves than the line has).
 * @param {WLine} line @param {Eval|null} [ev] child's view, best play, of the position the line starts from
 * @returns {'me'|'opp'} the side that is mated
 */
function matedSide(line, ev) {
  const mate = ev?.mate ?? 0;
  if (mate !== 0) return mate > 0 ? 'opp' : 'me';
  const firstMovesLast = line.moves.length % 2 === 1;
  return (line.first === 'me') === firstMovesLast ? 'opp' : 'me';
}

/**
 * What a line leads to, in the child's words: the settled balance, and when the line ends in mate who is mated
 * (最后将死对方 / 最后被将死; a balance with nothing in it is then left out). `bare`: the sentence already has 你 as its
 * subject (你多半走【X】，…), so the outcome does not repeat it.
 * @param {WLine} line @param {Color} me @param {Eval|null} [ev] see matedSide @param {boolean} [bare]
 * @returns {string}
 */
function outcome(line, me, ev, bare = false) {
  let net = netClause(line.net, me, 'child');
  if (bare && net.startsWith(YOU)) net = net.slice(YOU.length);
  if (line.end !== 'mate') return net;
  const mate = MATE_END[matedSide(line, ev)];
  if (changesHands(line.net)) return `${net}，最后${mate}`;
  return bare ? `最后${mate}` : `最后${YOU}${mate}`;
}

/**
 * The outcome of a line told as what follows a move that somebody else makes (对方多半走【X】，… / 它会走【X】，… / 对方走【X】
 * 之后，…; CONTRACT-NOTES 147). 对方多半走【马8进7】，你白吃一个卒 reads as if his move gave the pawn away: it is the child who
 * can take it afterwards, …，之后你能白吃一个卒. An outcome that begins 最后… stands as it is (之后 and 最后 do not go together).
 * @param {string} result what `outcome` returned @param {boolean} [said] 之后 stands before it already (对方走【X】之后，…)
 * @returns {string}
 */
function afterwards(result, said = false) {
  if (result.startsWith('最后')) return result;
  const able = result.startsWith(`${YOU}白吃`) ? `${YOU}能${result.slice(YOU.length)}` : result;
  return said ? able : `之后${able}`;
}

/**
 * Whether a balance, in the words lexicon.netClause gives it, says that the mover comes out behind: pieces lost for nothing
 * (白丢…), or more lost than won (…算下来亏了; for a move of the rival, in the child's view: 白吃… / …算下来赚了). A balance
 * that reads 大致相当 says no such thing.
 * @param {Net} net child's view @param {'me'|'opp'} [mover] @returns {boolean}
 */
function saysLoss(net, mover = 'me') {
  const [lost, won, cp] = mover === 'me' ? [net.lose, net.gain, net.cp] : [net.gain, net.lose, -net.cp];
  return lost.length > 0 && (won.length === 0 ? cp < 0 : cp <= -EVEN_BAND);
}

/**
 * Why a move is a mistake, the most telling reason first: what it costs, when the mover comes out behind in that balance,
 * then its first flaw. A balance in which the mover loses nothing, or comes out ahead or level, is never given as the reason
 * (是失误：…算下来赚了 and 是失误：…大致相当 would contradict themselves): then the flaw alone explains it.
 * @param {{cost:Net|null, flaws:Effect[]}} facts @param {Color} me @param {'me'|'opp'} mover
 * @returns {string[]}
 */
function reasons(facts, me, mover) {
  const { cost } = facts;
  const hurts = cost !== null && saysLoss(cost, mover);
  /** @type {string[]} */
  const list = [];
  if (cost !== null && hurts) list.push(netClause(cost, me, 'child'));
  const flaw = facts.flaws[0];
  // about a move of the rival the sentence has him as its subject (对方这步【M】是失误：…): his own pieces are 自己的
  if (flaw) list.push(mover === 'opp' ? RIVAL_FLAW[flaw.k] ?? rivalClause(flaw, me) : clauseOf(flaw, me));
  return list;
}

/**
 * The `good` sentence of section 8.6 for a move, with its shorter renderings. About a move of the rival it is a statement about
 * his move (对方这步【M】走得稳。), never advice to the child.
 * @param {string} move @param {Cat} cat @param {{cost:Net|null, flaws:Effect[]}|null} facts @param {Color} me
 * @param {'me'|'opp'} [mover]
 * @param {string|null} [steady] what is said of a move of the child judged 稳健 in the place of 稳健，可以走, when the move
 *        has nothing to praise (grimTail): 没有走错，只是局面吃紧 / 没有走错，只是要丢点子
 * @returns {string[]}
 */
function verdictLadder(move, cat, facts, me, mover = 'me', steady = null) {
  const head = mover === 'opp' ? `对方这步【${move}】${RIVAL_TAIL[cat]}` : `【${move}】${steady !== null && cat === 'good' ? steady : GOOD_TAIL[cat]}`;
  if (cat !== 'mistake' && cat !== 'blunder') return [head];
  const ladder = (facts ? reasons(facts, me, mover) : []).map((reason) => `${head}：${reason}。`);
  ladder.push(`${head}。`);
  return ladder;
}

/** @param {Moment} proud @returns {string[]} */
function proudLadder(proud) {
  const head = `第${proud.n}回合的【${proud.move}】最漂亮`;
  const term = proud.k ? motifTerm(proud.k) : '';
  return term ? [`${head}：${term}。`, `${head}。`] : [`${head}。`];
}

// ---- start, opp ----

/** @param {TurnBrief} turn @returns {ReturnType<typeof planOf>|null} */
function planOpp(turn) {
  const { me, opp } = turn;
  const cap = CAPS.opp;
  const K = PIECE[me].K;
  /** @param {WPiece} ref */
  const name = (ref) => pieceName(ref, me, 'child');
  const mate = turn.threats.find((t) => t.sev === 'mate');
  const big = turn.threats.find((t) => t.sev === 'rook' || t.sev === 'piece');
  const lead = opp?.does[0];

  if (mate) return variantRow('opp.mate', cap, OPP.mate, { K });
  // 慢慢扳回来 is said only when the child is behind in material after the capture (an even trade leaves nothing to win back)
  const captured = () => (opp?.captured ? variantRow('opp.captured', cap, OPP.captured, { char: PIECE[me][opp.captured] },
    (v) => v !== 4 || turn.mat.cp < 0) : null);
  // a threat that does not stand yet (`prep`) is not told as an aim that is there: 它瞄着谁？ and 被瞄上了 give way.
  // A threat without a target (a threatened check) has no other row: the question is asked at every level then.
  const threatRows = [
    () => (big && (turn.level >= 4 || !big.on) ? variantRow('opp.threat.q', cap, OPP.threatQ, { by: name(big.by) }, (v) => v !== 0 || !big.prep) : null),
    () => (big?.on ? variantRow('opp.threat', cap, OPP.threat, { on: name(big.on) }, (v) => v !== 5 || !big.prep) : null),
  ];
  // what was taken is on the board for the child to see; a piece that can be taken next and is worth more than what was
  // taken is the news, and comes first: a rook, or a horse or cannon after a pawn, an advisor or an elephant fell
  const urgent = big !== undefined && (big.sev === 'rook' || opp?.captured === 'P' || opp?.captured === 'A' || opp?.captured === 'E');
  // a move that gave something up (soft, slip) is not called steady or ordinary
  const gaveUp = opp?.quality === 'soft' || opp?.quality === 'slip';
  /** @type {(() => ReturnType<typeof planOf>|null)[]} */
  const rows = [
    () => (opp?.check ? variantRow('opp.check', cap, OPP.check, { K }) : null),
    () => (opp?.punishes ? variantRow('opp.punished', cap, OPP.punished) : null),
    ...(urgent ? [...threatRows, captured] : [captured, ...threatRows]),
    () => (opp?.overlooked ? variantRow('opp.overlooked', cap, OPP.overlooked) : null),
    // a chance in the child's own palace or back rows is told without its area
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
      const own = (text) => (lead.by?.s === 'opp' && text.startsWith(actorName(lead.by, me)) ? `对方的${text}` : ownSentence(text));
      const { on2, ...single } = lead;
      const shorter = on2 ? rivalClause(single, me) : null;
      const row = variantRow('opp.effect', cap, OPP.effect,
        { clause, sentence: own(clause), shorter: shorter && shorter !== MOTIF_TERM[lead.k] ? own(shorter) : null });
      // a sentence that does not fit its cap is not cut: the caption stands alone then
      if (!row) return null;
      const fitting = row.variants.map((variant) => (variant && plainLength(variant[0]) <= cap ? variant : null));
      return fitting.some((variant) => variant !== null) ? planOf('opp.effect', cap, fitting) : null;
    },
    // a move that does nothing in particular; a move with an effect that was not told above gets no line (it is not 平平常常)
    () => (opp && (!lead || lead.k === 'quiet') ? variantRow('opp.quiet', cap, OPP.quiet, {}, (v) => !gaveUp || (v !== 0 && v !== 4 && v !== 5)) : null),
  ];
  for (const row of rows) {
    const plan = row();
    if (plan) return plan;
  }
  return null;                                           // nothing to add to the caption
}

// ---- hint ----

/**
 * Whether a pouch points at a danger: the focus of the first pouch when it is in the thread, else by the theme.
 * @param {CoachEvent[]} events @param {MotifCode} theme @returns {boolean}
 */
function dangerFocus(events, theme) {
  for (let k = events.length - 1; k >= 0; k--) {
    const ev = events[k];
    if (ev.kind === 'hint' && 'focus' in ev.hint) return ev.hint.focus === 'danger';
  }
  return has(DANGER_THEMES, theme);
}

/** @param {Hint1} hint @returns {string} */
function hint1Sentence(hint) {
  const { focus, theme } = hint;
  if (focus === 'danger') return HINT1.danger;
  if (theme === 'capture_free' || theme === 'miss_capture') return HINT1.unguarded;
  if (theme === 'fork') return HINT1.fork;
  if (theme === 'check' || theme === 'mate' || theme === 'mate_threat') return HINT1.king;
  if (focus === 'develop') return HINT1.develop;
  if (focus === 'finish') return HINT1.finish;
  if (focus === 'chance') return HINT1.chance;
  return HINT1.other;
}

/** @param {TurnBrief} turn @param {CoachEvent[]} events @param {Hint1|Hint2|Hint3} hint @returns {ReturnType<typeof planOf>|null} */
function planHint(turn, events, hint) {
  const { me } = turn;
  if ('move' in hint) {
    const head = `可以走【${hint.move}】`;
    const lead = hint.does[0];
    const why = lead ? `${head}：${clauseOf(lead, me)}。` : null;
    const reply = hint.line && hint.line.first === 'opp' && hint.line.moves.length > 0 ? `对方多半走【${hint.line.moves[0]}】。` : null;
    const brief = lead ? `${head}：${MOTIF_TERM[lead.k]}。` : null;
    return singleRow('hint3', CAPS.hint3, [
      why && reply ? why + reply : null,
      why,
      brief && reply ? brief + reply : null,
      brief,
      `${head}。`,
    ]);
  }
  if ('piece' in hint) {
    const slots = { piece: pieceName(hint.piece, me, 'child'), area: AREA[hint.area] };
    // The piece to move is the piece in danger when it steps away itself (theme escape), or is the king under a check or a
    // mate threat. Otherwise the pouch points at a helper: the piece in danger is another one, which the packet does not name.
    const own = hint.theme === 'escape' || (hint.piece.t === 'K' && (hint.theme === 'check' || hint.theme === 'mate_threat'));
    const template = !dangerFocus(events, hint.theme) ? (ownGround(hint.area) ? HINT2.plain : HINT2.other) : own ? HINT2.danger : HINT2.helper;
    return singleRow('hint2', CAPS.hint2, [fill(template, slots)]);
  }
  if ('focus' in hint) return singleRow('hint1', CAPS.hint1, [hint1Sentence(hint)]);
  return null;
}

// ---- try ----

/** The most valuable piece of a list. @param {PT[]} pieces @returns {PT|undefined} */
function dearest(pieces) {
  /** @type {PT|undefined} */
  let best;
  for (const t of pieces) {
    if (best === undefined || PIECE_VALUE[TYPE_OF_PT[t]] > PIECE_VALUE[TYPE_OF_PT[best]]) best = t;
  }
  return best;
}

/**
 * Whether a trial shows a gain, a threat or a check for the child: one of its effects presses the rival, it leads to a mate,
 * or the child comes out ahead in its settled balance (something won for nothing, or 算下来赚了 by the measure of
 * lexicon.netClause). Only then is 对方难受了 said of it (not of an even trade or of a pawn that merely crosses the river).
 * @param {TryPacket} packet @returns {boolean}
 */
function presses(packet) {
  if (packet.does.some((effect) => has(PRESSING, effect.k))) return true;
  if ((packet.eval.mate ?? 0) > 0) return true;
  const { cost } = packet;
  return cost !== null && cost.gain.length > 0 && (cost.lose.length === 0 ? cost.cp > 0 : cost.cp >= 150);
}

/**
 * Whether a trial judged good or better has nothing to praise (CONTRACT-NOTES 147): its own main line leaves the child two
 * points of material or more down (the best there was, and it still costs a piece), or the child stays far behind after it
 * (走后形势 reads 很危险) and the line wins nothing. A move that mates or is a sound sacrifice keeps its praise, and so does,
 * however far behind the child is, a move that wins material back or is a tactic (TACTIC_MOTIFS).
 * The packet carries the band of the evaluation, not its centipawns: "far behind" is the band `lost` (600 cp and more).
 * A move after which the child is mated by force has nothing to praise either, whatever tactic it shows and whatever it
 * takes (CONTRACT-NOTES 150): where every move is mated all moves are judged 好棋.
 * @param {TryPacket} packet @returns {boolean}
 */
function nothingToPraise(packet) {
  const lead = packet.does[0]?.k;
  if (packet.sac || (packet.eval.mate ?? 0) > 0 || lead === 'mate') return false;
  if (beingMated(packet)) return true;
  const { cost } = packet;
  if (cost !== null && cost.cp <= GRIM_COST && !pawnsForPawns(cost)) return true;
  return packet.eval.b === 'lost' && !(cost !== null && cost.cp > 0) && !has(TACTIC_MOTIFS, lead);
}

/**
 * Pawns given for as many pawns or more, and nothing else given. A pawn that has crossed the river counts double in the
 * balance, so such an exchange can read as two points down; it is not what a child would call losing material, and
 * 只是要丢点子 was said of the best move of a level position (CONTRACT-NOTES 152).
 * @param {NonNullable<TryPacket['cost']>} cost @returns {boolean}
 */
const pawnsForPawns = (cost) => cost.lose.length > 0 && cost.lose.every((t) => t === 'P') && cost.gain.filter((t) => t === 'P').length >= cost.lose.length;

/** @param {TryPacket} packet @returns {boolean} after the move the child is mated by force */
const beingMated = (packet) => (packet.eval.mate ?? 0) < 0;

/**
 * Whether the child is in trouble after a trial: 走后形势 reads 落了下风 or 很危险, or the child is being mated (a bad
 * position whatever the band says). Only then are 局面吃紧, 难是难 and 最顽强 said of a move that has nothing to praise;
 * elsewhere the same row says what is true there, that the move's line gives material back (CONTRACT-NOTES 150).
 * @param {TryPacket} packet @returns {boolean}
 */
const inTrouble = (packet) => packet.eval.b === 'worse' || packet.eval.b === 'lost' || beingMated(packet);

/**
 * What the `good` sentence says of a move judged 稳健 that has nothing to praise, in the place of 稳健，可以走; null for a
 * move that has something to praise.
 * @param {TryPacket} packet @returns {string|null}
 */
const grimTail = (packet) => (!nothingToPraise(packet) ? null : inTrouble(packet) ? GOOD_GRIM : GOOD_COSTLY);

/** @param {TurnBrief} turn @param {TryPacket} packet @returns {ReturnType<typeof planOf>|null} */
function planTry(turn, packet) {
  const { me } = turn;
  const M = packet.move;
  const K = PIECE[me].K;
  /** @param {WPiece|undefined} ref */
  const name = (ref) => (ref ? pieceName(ref, me, 'child') : null);
  const flaw = packet.flaws[0];
  const lead = packet.does[0];
  const fine = packet.cat === 'brilliant' || packet.cat === 'best' || packet.cat === 'good';
  const bad = packet.cat === 'mistake' || packet.cat === 'blunder';

  /** @type {(() => ReturnType<typeof planOf>|null)[]} */
  let rows;
  if (packet.held) {
    const cap = HELD_CAP;
    const pieces = { by: name(flaw?.by), on: name(flaw?.on), on2: name(flaw?.on2) };
    const lost = packet.cost ? dearest(packet.cost.lose) : undefined;
    rows = [
      () => (flaw?.k === 'allow_mate' || (packet.eval.mate ?? 0) < 0 ? variantRow('held.mate', cap, HELD.mate, { K }) : null),
      () => (flaw?.k === 'hang' ? variantRow('held.hang', cap, HELD.hang, pieces) : null),
      () => (flaw?.k === 'unguard' ? variantRow('held.unguard', cap, HELD.unguard, pieces) : null),
      () => (flaw?.k === 'ignore_threat' ? variantRow('held.threat', cap, HELD.threat, pieces) : null),
      () => (flaw?.k === 'greedy' || flaw?.k === 'bad_trade' ? variantRow('held.greedy', cap, HELD.greedy, pieces) : null),
      // 跳 is said of a horse only; 站得太近 only when one short-stepping piece (not a rook or a cannon) attacks both, and not
      // of a piece and the king (a check that also attacks the piece)
      () => (flaw?.k === 'walk_fork' ? variantRow('held.fork', cap,
        [HELD.fork[0], flaw.on2?.t === 'K' ? HELD.forkCheck : has(SHORT_STEPPERS, flaw.by?.t) ? HELD.fork[1] : HELD.forkApart, HELD.fork[2]],
        pieces, (v) => v !== 0 || flaw.by?.t === 'H') : null),
      () => (flaw?.k === 'walk_pin' ? variantRow('held.pin', cap, HELD.pin, pieces) : null),
      () => (lost ? variantRow('held.cost', cap, HELD.cost, { char: PIECE[me][lost] }) : null),
      () => variantRow('held.other', cap, HELD.other),
    ];
  } else {
    const cap = CAPS.try;
    const area = packet.toward?.area;
    const missedArea = area ?? turn.chance?.area;
    // 没危险 / 稳 are not said of a missed chance whose best answer takes something, 不吃亏 / 稳 not of a slow move that
    // comes out behind in material: the packet says otherwise
    const loses = packet.cost !== null && packet.cost.lose.length > 0;
    const behind = loses && packet.cost !== null && packet.cost.cp < 0;
    // the best there was, and nothing to praise: the grim row takes the place of only, taken, praise and steady
    const grim = fine && nothingToPraise(packet);
    // its words follow the evaluation after the move: 最顽强 / 局面吃紧 / 难是难 where the child is in trouble, 只是要丢点子
    // where the child is not (CONTRACT-NOTES 150)
    const steady = packet.cat === 'good';
    const grimWords = inTrouble(packet) ? (steady ? TRY.grimGood : TRY.grim) : (steady ? TRY.costlyGood : TRY.costly);
    // a forced move was not found: of it only 是眼下唯一的解法 is said
    const forced = turn.n >= 1 && turn.n <= FORCED_MOVES;
    rows = [
      () => (packet.only && !bad && !grim ? variantRow('try.only', cap, forced ? TRY.onlyForced : TRY.only, { M }) : null),
      // 走得稳 is not said of a move after which the child comes out behind in material; and of a move after which the
      // child is mated neither 走得稳 nor 可行 is said: the grim row follows (CONTRACT-NOTES 150)
      () => (packet.avoided && !bad && !beingMated(packet) ? variantRow('try.avoided', cap, TRY.avoided, { M }, (v) => v !== 0 || !behind) : null),
      () => (grim ? variantRow('try.grim', cap, grimWords, { M }) : null),
      () => (packet.chance === 'taken' && !bad ? variantRow('try.taken', cap, TRY.taken, { M }) : null),
      () => {
        if (!fine || !lead || !has(NOTABLE_MOTIFS, lead.k)) return null;
        const clause = clauseOf(lead, me);
        // 对方难受了 (variant 5) needs a gain, a threat or a check in the packet
        return variantRow('try.praise', cap, TRY.praise,
          { M, effectClause: clause, '：effectClause': startsWithPiece(clause) ? `：${clause}` : clause, term: MOTIF_TERM[lead.k] },
          (v) => v !== 5 || presses(packet));
      },
      // 走得稳，没有毛病 / 稳当 / 扎实 / 没问题 are not said of a move after which the child still comes out behind in material
      // (the best there was, but not safe): 可行 and 不急不躁 remain
      () => (fine ? variantRow('try.steady', cap, TRY.steady, { M }, (v) => v === 1 || v === 3 || !behind) : null),
      () => (packet.chance === 'missed' ? variantRow('try.missed', cap, missedArea && ownGround(missedArea) ? TRY.missedPlain : TRY.missed,
        { M, area: missedArea ? AREA[missedArea] : null }, (v) => v === 1 || !loses) : null),
      () => (packet.cat === 'ok' ? variantRow('try.ok', cap, TRY.ok, { M, area: area ? AREA[area] : null }, (v) => v > 1 || !behind) : null),
      () => variantRow('try.slow', cap, TRY.slow, {
        M,
        'effectClause(flaws[0])': flaw ? clauseOf(flaw, me) : null,
        term: flaw ? MOTIF_TERM[flaw.k] : null,
      }),
    ];
  }
  for (const row of rows) {
    const plan = row();
    if (plan) return plan;
  }
  return null;
}

// ---- ask ----

/**
 * The trial a question is about: the most recent try before the last event (a recap's `cur` stands for it), with the details
 * that were withheld until the first follow-up (`more`). `replyKnown` is false while the rival's reply is still withheld.
 * @param {CoachEvent[]} events
 * @returns {{packet:TryPacket, reply:WLine|null, replyKnown:boolean, better:MorePacket['better']}|null}
 */
function subjectOf(events) {
  const last = events.length - 1;
  for (let k = last - 1; k >= 0; k--) {
    const ev = events[k];
    /** @type {TryPacket|undefined} */
    let packet;
    if (ev.kind === 'try') packet = ev.try;
    else if (ev.kind === 'recap') packet = ev.recap.cur;
    else continue;
    if (!packet) return null;
    /** @type {MorePacket|undefined} */
    let more;
    for (let j = k + 1; j <= last && !more; j++) {
      const follow = events[j];
      if (follow.kind === 'ask' && follow.more) more = follow.more;
    }
    const reply = packet.reply ?? more?.reply ?? null;
    return { packet, reply, replyKnown: reply !== null || !packet.held, better: more?.better };
  }
  return null;
}

/** @param {CoachEvent[]} events @returns {OverPacket|null} the packet of a game-over thread */
function overOf(events) {
  const first = events[0];
  return first.kind === 'over' ? first.over : null;
}

/** @param {TurnBrief} turn @returns {string[]} the `intent` sentence */
function intentLadder(turn) {
  const { me, opp } = turn;
  const mate = turn.threats.find((t) => t.sev === 'mate');
  if (mate) return [`对方下一步想走【${mate.move}】，那就是杀棋。`];
  // A move that gave something up is told as such when the child asks (CONTRACT-NOTES 131 c): a second sentence, dropped
  // before anything else when the answer would pass its cap. Not after a mate warning: nothing may distract from that.
  const gave = opp && (opp.quality === 'soft' || opp.quality === 'slip') ? GAVE_UP[opp.quality] : null;
  /** @param {string[]} ladder @param {'own'|'after'} place @returns {string[]} */
  const noted = (ladder, place) => (gave ? [ladder[0] + (opp?.overlooked ? GAVE_UP.overlooked : gave[place]), ...ladder] : ladder);
  const threat = turn.threats[0];
  if (threat) {
    const head = `对方下一步想走【${threat.move}】`;
    return noted(changesHands(threat.net) ? [`${head}，那样${netClause(threat.net, me, 'child')}。`, `${head}。`] : [`${head}。`], 'after');
  }
  const lead = opp?.does[0];
  // the sentence is about the rival: his own pieces are 自己的 (CONTRACT-NOTES 138)
  if (lead) return noted([`对方这步的用意：${rivalClause(lead, me)}。`, `对方这步的用意：${MOTIF_TERM[lead.k]}。`], 'own');
  // 是在调整阵形 is about a move the rival made: at the first move of the game there is none
  if (turn.known.threats) return opp ? noted([ASK.quietRival], 'own') : [ASK.noThreat];
  return [ASK.stillLooking];
}

/** @param {NonNullable<ReturnType<typeof subjectOf>>} subject @param {Color} me @returns {string[]} the `reply` sentence */
function replyLadder(subject, me) {
  const { reply } = subject;
  // first his reply, then what follows it: 对方多半走【马8进7】，之后你能白吃一个卒。
  if (reply) return [`对方多半走【${reply.moves[0]}】，${afterwards(outcome(reply, me, subject.packet.eval))}。`, `对方多半走【${reply.moves[0]}】。`];
  return subject.replyKnown ? [ASK.noReply] : [];
}

/**
 * 为什么？ about a mistake or a blunder for which the packet names no flaw: the rival's answer and what it costs the child
 * (因为对方走【X】之后，你白丢一个马。), else what the move costs, else the verdict alone. Never the move's own effect, and
 * never a balance that does not say a loss (因为…大致相当 is no reason for a mistake).
 * @param {NonNullable<ReturnType<typeof subjectOf>>} subject @param {Color} me @returns {string[]}
 */
function unexplainedLadder(subject, me) {
  const { packet, reply } = subject;
  /** @type {string[]} */
  const ladder = [];
  if (reply) {
    const mated = reply.end === 'mate' && matedSide(reply, packet.eval) === 'me';
    if (mated || saysLoss(reply.net)) {
      const result = outcome(reply, me, packet.eval);
      ladder.push(`因为对方走【${reply.moves[0]}】${result.startsWith('最后') ? '' : '之后'}，${afterwards(result, true)}。`);
    }
  }
  const { cost } = packet;
  if (cost !== null && saysLoss(cost)) ladder.push(`因为${netClause(cost, me, 'child')}。`);
  ladder.push(`【${packet.move}】${GOOD_TAIL[packet.cat]}。`);
  return ladder;
}

/**
 * 为什么？ in a game-over thread (CONTRACT-NOTES item 112): the answer is built from the takeaway the line before it was about.
 * After 「我哪步下得最好？」: what the highlighted move achieved. After 「哪里还能更好？」 / 「下一盘注意什么？」: the habit, and its fix
 * unless the line itself was the fix. After the game-over line: its highlighted move, else the habit behind the small goal.
 * When the packet holds nothing concrete, the fixed sentence. Never empty.
 * @param {CoachEvent[]} events @param {OverPacket} over @returns {string[]}
 */
function overWhyLadder(events, over) {
  // the line the question is about: the event before it; an earlier 为什么？ was about the same line
  let k = events.length - 2;
  while (k > 0 && events[k].kind === 'ask' && /** @type {Extract<CoachEvent, {kind:'ask'}>} */ (events[k]).ask === 'why') k--;
  const before = events[k];
  // the game-over line speaks of the highlighted move; without one, the goal of the card under it is what there is to explain
  const about = before.kind === 'ask' ? before.ask : before.kind === 'over' ? (over.proud || !over.goal ? 'proud' : 'next') : null;

  if (about === 'proud') {
    const achieved = over.proud?.k ? ACHIEVED[over.proud.k] : undefined;
    return over.proud && achieved ? [`因为【${over.proud.move}】${achieved}。`] : [ASK.overWhy];
  }
  if (about === 'improve' || about === 'next') {
    const lesson = over.takeaway?.kind === 'habit' ? over.takeaway : null;
    // what the line said: 「哪里还能更好？」 quotes the lesson's example, 「下一盘注意什么？」 and the game-over line give the goal
    const code = about === 'improve' ? (lesson?.ex ? lesson.code : null) : over.goal;
    const word = code !== null && Object.hasOwn(HABIT_WORD, code) ? HABIT_WORD[/** @type {keyof typeof HABIT_WORD} */ (code)] : null;
    if (code === null || word === null) return [ASK.overWhy];
    const ex = lesson !== null && lesson.code === code ? lesson.ex : undefined;
    const habit = ex ? `因为第${ex.n}回合的【${ex.move}】，${word}。` : `因为这盘有一步，${word}。`;
    return about === 'improve' ? [`${habit}下一盘${HABIT_FIX[/** @type {keyof typeof HABIT_FIX} */ (code)]}。`, habit] : [habit];
  }
  return [ASK.overWhy];
}

/**
 * @param {TurnBrief} turn @param {CoachEvent[]} events @param {Exclude<AskCode, 'free'>} code
 * @returns {(string|null)[]} the sentence for a chip, fullest rendering first; empty when the packets hold no answer
 */
function askLadder(turn, events, code) {
  const { me } = turn;
  const subject = subjectOf(events);
  const over = overOf(events);
  switch (code) {
    case 'good':
      return subject ? verdictLadder(subject.packet.move, subject.packet.cat, subject.packet, me, 'me', grimTail(subject.packet)) : [];
    case 'reply':
      return subject ? replyLadder(subject, me) : [];
    case 'better': {
      if (!subject || subject.better === undefined) return [];
      const alt = subject.better[0];
      if (!alt) return [ASK.noBetter];
      const head = `更好的是【${alt.move}】`;
      const lead = alt.does[0];
      const first = lead ? `${head}：${clauseOf(lead, me)}。` : `${head}。`;
      // what follows the better move: 之后你能白吃一个车。 / 之后双方都没有丢子。 / 最后你将死对方。
      const then = !alt.line ? null : `${afterwards(outcome(alt.line, me))}。`;
      return [then ? first + then : null, first, lead ? `${head}：${MOTIF_TERM[lead.k]}。` : null, `${head}。`];
    }
    case 'why': {
      if (subject) {
        const flaw = subject.packet.flaws[0];
        if (flaw) {
          const first = `因为${clauseOf(flaw, me)}。`;
          const { reply } = subject;
          const result = reply ? outcome(reply, me, subject.packet.eval) : '';
          // …之后，你白丢一个马。 but 对方走【X】，最后你被将死。 (之后 and 最后 do not go together)
          const then = reply ? `对方走【${reply.moves[0]}】${result.startsWith('最后') ? '' : '之后'}，${afterwards(result, true)}。` : null;
          return [then ? first + then : null, first, `因为${MOTIF_TERM[flaw.k]}。`];
        }
        // A mistake or a blunder without a named flaw (the loss lies deeper than the facts name): what the move does is no
        // reason for the verdict. The rival's answer and what it costs is, when it costs something; else the bare verdict.
        if (subject.packet.cat === 'mistake' || subject.packet.cat === 'blunder') return unexplainedLadder(subject, me);
        const lead = subject.packet.does[0];
        // A slow move (缓着: 稍慢，但不算错) that does nothing in particular: 因为调整了一下阵形 is no reason. The reason is
        // what the better move would have done, when one is known with an effect of its own; else that the move asks the
        // rival no question (CONTRACT-NOTES 147).
        /** @returns {string[]} what the better move would have done, or that this one asks the rival no question */
        const slower = () => {
          const alt = subject.better?.[0];
          const does = alt?.does[0];
          return alt && does && does.k !== 'quiet'
            ? [`因为【${alt.move}】更紧：${clauseOf(does, me)}。`, `因为【${alt.move}】更紧：${MOTIF_TERM[does.k]}。`, ASK.slowWhy]
            : [ASK.slowWhy];
        };
        if (subject.packet.cat === 'ok' && (!lead || lead.k === 'quiet')) return slower();
        // A move judged good or better that has nothing to praise and does nothing in particular (CONTRACT-NOTES 148), or
        // after which the child is mated, whatever it does (item 150: its tactic is no reason for anything). 没有明显更好的
        // 走法 is said of the best move, and of a 稳健 one only when the thread knows that nothing better is listed: the next
        // chip must not name a better move right after it. A 稳健 move with a better move listed, or with none known yet,
        // is answered as a slow move is (item 150).
        const { cat } = subject.packet;
        const fine = cat === 'brilliant' || cat === 'best' || cat === 'good';
        if (fine && (!lead || lead.k === 'quiet' || beingMated(subject.packet)) && nothingToPraise(subject.packet)) {
          return cat !== 'good' || (subject.better !== undefined && subject.better.length === 0) ? [ASK.grimWhy] : slower();
        }
        return lead ? [`因为${clauseOf(lead, me)}。`, `因为${MOTIF_TERM[lead.k]}。`] : [];
      }
      // After the game there is no rival intent left to explain: the answer comes from the game-over packet.
      return over ? overWhyLadder(events, over) : intentLadder(turn);
    }
    case 'show': {
      if (!subject) return [];
      const flaw = subject.packet.flaws[0];
      // The piece that threatens is the rival's: the flaw's `by`, or for a greedy capture its guard (`on2`).
      const attacker = flaw ? [flaw.by, flaw.on2].find((ref) => ref?.s === 'opp') : undefined;
      const { reply } = subject;
      if (!attacker || !reply) return replyLadder(subject, me);
      const first = `是${pieceName(attacker, me, 'child')}在威胁。`;
      return [`${first}它会走【${reply.moves[0]}】，${afterwards(outcome(reply, me, subject.packet.eval))}。`, `${first}它会走【${reply.moves[0]}】。`];
    }
    case 'intent':
      return over ? [] : intentLadder(turn);
    case 'score': {
      const first = `现在${evalWords(turn.eval)}。`;
      // 你大约多一个兵, not the 你多大约一个兵 of lexicon.balanceWords: 大约 stands before 多 / 少
      return [first + balanceWords(turn.mat.cp, 'child').replace(/^你([多少])大约/, '你大约$1'), first];
    }
    case 'danger': {
      const threat = turn.threats[0];
      if (!threat) {
        // with no threat listed, 没有直接的危险，可以放心走 is still not said while the child is in check, or when the
        // evaluation of the position has found a forced mate against the child
        if (turn.check) return [ASK.inCheck];
        if ((turn.eval.mate ?? 0) < 0) return [`要当心：${evalWords(turn.eval)}。`];
        return [turn.known.threats ? ASK.safe : ASK.stillWatching];
      }
      // a threat that does not stand yet (`prep`): the move is named, and the attack is what stands once it is played
      if (threat.prep) {
        const head = `要当心：对方想走【${threat.move}】`;
        const template = threat.k === 'fork' && threat.name === 'check_fork' ? PREP_CHECK_FORK : PREP[threat.k];
        const by = threat.by.s === 'opp' ? `他的${actorName(threat.by, me)}` : pieceName(threat.by, me, 'child');
        const after = template ? fill(template, { by, on: threat.on ? pieceName(threat.on, me, 'child') : null }) : null;
        return [after ? `${head}，走完${after}。` : null, `${head}。`];
      }
      // a check that is only threatened is not on the board yet: …下一步要将军 (the clause of the lexicon, …将军, is about a check given)
      const clause = threat.k === 'check' ? `${pieceName(threat.by, me, 'child')}下一步要将军` : threatClause(threat, me, 'child');
      return [`要当心：${clause}。`, `要当心：${MOTIF_TERM[threat.k]}。`];
    }
    case 'last': {
      const { mine } = turn;
      if (!mine) return [ASK.opening];
      // 是稳健 is not a sentence (the one label that is not a noun): a steady move gets the `good` sentence, 稳健，可以走
      if (!mine.try) return mine.cat === 'good' ? verdictLadder(mine.move, mine.cat, null, me) : [`【${mine.move}】是${CAT_LABEL[mine.cat]}。`];
      const ladder = verdictLadder(mine.move, mine.cat, mine.try, me, 'me', grimTail(mine.try));
      const lead = mine.try.does[0];
      // What a mistake or a blunder did is not added. After the bare verdict it would read as its reason; after the reason
      // it tells of a piece that may be gone by now (是漏着：你白丢一个车。你的五路车将军。). Nor is the tactic of a move after
      // which the child is mated (CONTRACT-NOTES 150).
      const bad = mine.cat === 'mistake' || mine.cat === 'blunder';
      return lead && !bad && !beingMated(mine.try) ? [`${ladder[0]}${ownSentence(clauseOf(lead, me))}。`, ...ladder] : ladder;
    }
    case 'proud':
      if (!over) return [];
      if (over.proud) return proudLadder(over.proud);
      // 每一步都走得很稳 is said only of a game in which every move the child played was steady or better
      return [over.moves > 0 && over.stats.good >= over.moves ? ASK.noProud : ASK.noProudYet];
    case 'improve': {
      if (!over) return [];
      const ex = over.takeaway?.kind === 'habit' ? over.takeaway.ex : undefined;
      if (!ex) return [ASK.noImprove];
      const head = `第${ex.n}回合的【${ex.move}】可以更好`;
      return [ex.better ? `${head}，换成【${ex.better}】就对了。` : `${head}。`, `${head}。`];
    }
    case 'next':
      if (!over) return [];
      return [over.goal ? `下一盘记住一件事——${HABIT_FIX[over.goal]}。` : ASK.noGoal];
    default:
      return [];
  }
}

// ---- over ----

/** @param {Extract<CoachEvent, {kind:'over'}>} event @returns {ReturnType<typeof planOf>|null} */
function planOver(event) {
  const over = event.over;
  /** @type {string} */
  let head = OVER[over.result];
  // 有几步走得真不错 needs a few good moves to point at
  const plainLoss = over.result === 'loss' && over.stats.good < 2;
  if (plainLoss) head = OVER.lossPlain;
  // the interjection 握手言和。 was already called out by the interface: the sentence goes on from it
  if (over.result === 'draw' && event.cue === 'draw') head = '旗鼓相当。';
  const parts = [head];
  if (over.kept === true) parts.push(OVER.kept);
  if (over.proud) parts.push(proudLadder(over.proud)[0]);
  // The small goal of the next game is not said here: the card shows it in a row of its own, right under this line
  // (CONTRACT-NOTES 138). 「下一盘注意什么？」 still answers with it.
  const rank = over.rank ? RANK_NAMES[over.rank.to - 1] : undefined;
  if (rank) parts.push(`兵法升到「${rank}」！`);
  // a lost game with nothing to point at: 这盘惜败。 does not stand alone in the takeaway box (CONTRACT-NOTES 147)
  if (plainLoss && parts.length === 1) parts[0] = OVER.lossAlone;
  /** @type {string[]} */
  const ladder = [];
  for (let n = parts.length; n >= 1; n--) ladder.push(parts.slice(0, n).join(''));     // sentences are dropped from the end to fit
  return singleRow('over', CAPS.over, ladder);
}

/** @param {TurnBrief} turn @param {CoachEvent[]} events @returns {ReturnType<typeof planOf>|null} the row that answers the last event */
function planFor(turn, events) {
  if (!turn || !Array.isArray(events) || events.length === 0) return null;
  const event = events[events.length - 1];
  switch (event.kind) {
    case 'start':
      return variantRow('start', CAPS.start, START);
    case 'opp':
      return planOpp(turn);
    case 'hint':
      return planHint(turn, events, event.hint);
    case 'try':
      return planTry(turn, event.try);
    case 'ask':
      if (event.ask === 'free') return planOf('ask.free', CAPS.free, FREE.map((text) => [text]), true);
      return singleRow(`ask.${event.ask}`, capFor(event), askLadder(turn, events, event.ask));
    case 'over':
      return planOver(event);
    default:
      return null;                                       // a recap is never the event to answer
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Choosing a variant under the cap
// ---------------------------------------------------------------------------------------------------------------------

/** @param {ReturnType<typeof planOf>} row @param {number} v @returns {string|null} the fullest rendering of variant `v` that fits the cap */
function fitting(row, v) {
  const renderings = row.variants[v];
  if (!renderings) return null;
  for (const text of renderings) {
    if (plainLength(text) <= row.cap) return text;
  }
  return null;
}

/**
 * Cuts a sentence at the cap: whole characters and whole 【notations】 only, followed by ……, the mark included in the cap.
 * @param {string} text @param {number} cap @returns {string}
 */
function cutAtCap(text, cap) {
  const room = Math.max(0, cap - plainLength(CUT_MARK));
  let out = '';
  let length = 0;
  for (const token of text.match(/【[^】]*】|[^]/gu) ?? []) {
    const size = plainLength(token);
    if (length + size > room) break;
    out += token;
    length += size;
  }
  return out + CUT_MARK;
}

/**
 * Variant `v` of a plan, or the next one that can be said within the cap. If none fits, the shortest is cut at the cap.
 * @param {ReturnType<typeof planOf>} row @param {number} v @returns {{text:string, v:number}} the text and the variant it is
 */
function pick(row, v) {
  const count = row.variants.length;
  const start = Number.isInteger(v) && v > 0 ? v % count : 0;
  for (let step = 0; step < count; step++) {
    const k = (start + step) % count;
    const text = fitting(row, k);
    if (text !== null) return { text, v: k };
  }
  /** @type {{text:string, v:number}|null} */
  let shortest = null;
  for (let k = 0; k < count; k++) {
    for (const text of row.variants[k] ?? []) {
      if (shortest === null || plainLength(text) < plainLength(shortest.text)) shortest = { text, v: k };
    }
  }
  return shortest === null ? { text: '', v: 0 } : { text: cutAtCap(shortest.text, row.cap), v: shortest.v };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The local reply for the last event of `events`, variant `v` (default 0). Uses 【】 like the model.
 * May return '' (nothing worth saying).
 *
 * `v` counts the variants of the row as section 8.6 lists them (`v mod count`). A variant that cannot be said about this packet,
 * or that would pass its cap, gives way to the next one, so the same arguments always give the same sentence (the proxy
 * re-creates a local line from `v`). The cue is shown by the interface and is not part of the text.
 * @param {TurnBrief} turn
 * @param {CoachEvent[]} events
 * @param {number} [v]
 * @returns {string}
 */
export function composeLocal(turn, events, v) {
  const plan = planFor(turn, events);
  return plan ? pick(plan, v ?? 0).text : '';
}

/**
 * Chooses a variant that is not among the last three local rows spoken, then composes.
 * The search starts at `(floor(turn.ply / 2) + events.length) mod count` (CONTRACT-NOTES item 111: the move number, not the
 * ply, so that the start does not keep the parity of the child's colour and a child of either colour hears every variant).
 * `v` is the variant the text really is, so `composeLocal(turn, events, v)` gives the same text. When every variant that can
 * be said was spoken recently (a row of three or fewer), the one spoken longest ago is taken. With nothing to say:
 * `{text: '', row: '', v: 0}`.
 * @param {TurnBrief} turn
 * @param {CoachEvent[]} events
 * @param {string[]} recent  keys "row:v" of the last three local lines
 * @returns {{text:string, row:string, v:number}}
 */
export function localLine(turn, events, recent) {
  const plan = planFor(turn, events);
  if (!plan) return { text: '', row: '', v: 0 };
  if (plan.fixed) return { ...pick(plan, 0), row: plan.row };
  const count = plan.variants.length;
  const spoken = Array.isArray(recent) ? recent.slice(-3) : [];
  const start = Math.abs(Math.floor(turn.ply / 2) + events.length || 0) % count;
  /** @type {{text:string, v:number, age:number}|null} */
  let oldest = null;
  for (let step = 0; step < count; step++) {
    const k = (start + step) % count;
    const text = fitting(plan, k);
    if (text === null) continue;
    const age = spoken.lastIndexOf(`${plan.row}:${k}`);
    if (age === -1) return { text, row: plan.row, v: k };
    if (oldest === null || age < oldest.age) oldest = { text, v: k, age };
  }
  if (oldest !== null) return { text: oldest.text, row: plan.row, v: oldest.v };
  return { ...pick(plan, start), row: plan.row };
}

/**
 * Local answer to a "what if" once the tool verdict is known: 【the move】 and its verdict (about a move of the rival: 对方这步
 * 【the move】 and a statement about it), the likely answer to it, and how playing this way compares with the move the child
 * is trying. Sentences are dropped from the end to stay within the cap of a free answer.
 * @param {TurnBrief} turn
 * @param {ToolVerdict} verdict
 * @returns {string}
 */
export function composeToolReply(turn, verdict) {
  const { me } = turn;
  const move = verdict.seq[verdict.seq.length - 1];
  if (!move) return '';
  const heads = verdictLadder(move, verdict.cat, verdict, me, verdict.who);
  const { reply } = verdict;
  let answer = '';
  if (reply && reply.moves.length > 0) {
    const mine = reply.first !== 'opp';                    // the child answers: 你 is the subject of the whole sentence
    const lead = `${mine ? YOU : '对方'}多半走【${reply.moves[0]}】`;
    // the cost of a move is what its best answer leads to: when the verdict sentence has just said that balance, it is not
    // said twice (only that the line ends in mate is still added)
    const told = changesHands(reply.net) && heads[0].endsWith(`：${netClause(reply.net, me, 'child')}。`);
    const result = outcome(told ? { ...reply, net: { gain: [], lose: [], cp: 0 } } : reply, me, verdict.eval, mine);
    // when the rival answers, what follows his answer is told as a sequence (…，之后你能白吃一个卒)
    answer = told && reply.end !== 'mate' ? `${lead}。` : `${lead}，${mine ? result : afterwards(result)}。`;
  }
  const versus = verdict.vsTry === 'better' || verdict.vsTry === 'worse' ? `这样走比你正在试的那步${VS_TRY[verdict.vsTry]}。` : '';
  const plan = singleRow('tool', CAPS.free, [heads[0] + answer + versus, heads[0] + answer, ...heads]);
  return plan ? pick(plan, 0).text : '';
}

/**
 * The interjection for an event (the only interjection rule, contract section 8.7).
 * @param {TurnBrief} turn
 * @param {CoachEvent} event
 * @param {{earned?:boolean, voiced?:boolean, lord?:boolean}} flags
 * @returns {CueCode|null}
 */
export function cueFor(turn, event, flags) {
  switch (event.kind) {
    case 'start':
      return 'go';
    case 'opp':
      if (turn.threats.some((t) => t.sev === 'mate') || turn.opp?.check) return 'alert';
      if (turn.threats.some((t) => t.sev === 'rook' || t.sev === 'piece') || turn.opp?.captured) return 'look';
      return turn.chance ? 'oh' : null;
    case 'try': {
      const packet = event.try;
      // A praising interjection goes only with a praising sentence (CONTRACT-NOTES 147): when the row of this trial is
      // steady or grim (earned praise for the only good move of a difficult position, say) there is none.
      if ((flags?.lord || flags?.earned) && has(PRAISING_ROWS, planTry(turn, packet)?.row)) {
        if (flags.lord) return 'lord';
        return packet.cat === 'brilliant' || has(TACTIC_MOTIFS, packet.does[0]?.k) ? 'wow' : 'nice';
      }
      if (flags?.voiced) return packet.cat === 'blunder' ? 'stop' : 'wait';
      return null;
    }
    case 'over':
      return event.over.result === 'win' ? 'win' : event.over.result === 'loss' ? 'lose' : 'draw';
    default:
      return null;                                       // hint, ask, recap
  }
}
