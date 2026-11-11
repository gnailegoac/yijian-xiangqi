/**
 * The single vocabulary of the game (contract section 4.1): every enumeration, every label table and the notation grammar.
 *
 * Dependency-free. Imported by core, coach, game, ui and the proxy.
 * Every array and every table is frozen; every table has exactly the keys of its array (tests/unit/core/codes.test.js).
 * Frozen after wave 0: a change to this file is a change to the build contract.
 */

// ---- verdicts ----

/** @typedef {'brilliant'|'best'|'good'|'ok'|'mistake'|'blunder'} Cat */
/** @typedef {Cat|'pending'} UiVerdict */

/** Best first. @type {readonly Cat[]} */
export const CATS = Object.freeze(['brilliant', 'best', 'good', 'ok', 'mistake', 'blunder']);
/** @type {Readonly<Record<Cat, string>>} */
export const CAT_LABEL = Object.freeze({ brilliant: '妙手', best: '好棋', good: '稳健', ok: '缓着', mistake: '失误', blunder: '漏着' });

// ---- moods (buddy) and the trial mood rule ----

/** @typedef {'idle'|'listening'|'thinking'|'curious'|'pleased'|'impressed'|'worried'|'alarmed'|'cheering'|'consoling'} Mood */

/** @type {readonly Mood[]} */
export const MOODS = Object.freeze(['idle', 'listening', 'thinking', 'curious', 'pleased', 'impressed', 'worried', 'alarmed', 'cheering', 'consoling']);

/** The only place a trial mood is decided. @param {UiVerdict} cat @param {{held:boolean, earned:boolean}} f @returns {Mood} */
export function moodOfVerdict(cat, f) {
  switch (cat) {
    case 'pending':   return 'thinking';
    case 'brilliant': return 'impressed';
    case 'best':      return f.earned ? 'impressed' : 'pleased';
    case 'good':      return 'pleased';
    case 'ok':        return 'idle';
    case 'mistake':   return f.held ? 'worried' : 'curious';
    case 'blunder':   return f.held ? 'alarmed' : 'worried';
  }
}

// ---- interjections (the only table; shown as the bubble tag, sent to the model as 〔已喊〕) ----

/** @typedef {'go'|'wow'|'nice'|'lord'|'wait'|'stop'|'alert'|'look'|'oh'|'win'|'lose'|'draw'} CueCode */

/** @type {readonly CueCode[]} */
export const CUE_CODES = Object.freeze(['go', 'wow', 'nice', 'lord', 'wait', 'stop', 'alert', 'look', 'oh', 'win', 'lose', 'draw']);
/** @type {Readonly<Record<CueCode, string>>} */
export const CUE = Object.freeze({ go: '出师！', wow: '妙哉！', nice: '好棋！', lord: '主公英明！', wait: '且慢……', stop: '且慢！', alert: '不可不防！',
                                   look: '主公请看——', oh: '咦？', win: '大捷！', lose: '惜哉……', draw: '握手言和。' });

// ---- questions ----

/** @typedef {'good'|'reply'|'better'|'why'|'show'|'intent'|'score'|'danger'|'last'|'proud'|'improve'|'next'|'free'} AskCode */

/** @type {readonly AskCode[]} */
export const ASK_CODES = Object.freeze(['good', 'reply', 'better', 'why', 'show', 'intent', 'score', 'danger', 'last', 'proud', 'improve', 'next', 'free']);
/** 'free' has no label. @type {Readonly<Record<Exclude<AskCode, 'free'>, string>> & {readonly free?: undefined}} */
export const ASK_LABEL = Object.freeze({ good: '这步好不好？', reply: '对方会怎么应？', better: '有更好的吗？', why: '为什么？', show: '指给我看',
                                         intent: '对方想干什么？', score: '现在谁占上风？', danger: '我有危险吗？', last: '我上一步怎么样？',
                                         proud: '我哪步下得最好？', improve: '哪里还能更好？', next: '下一盘注意什么？' });

// ---- end of game ----

/** @typedef {'checkmate'|'stalemate'|'resign'|'repetition'|'no_capture'|'no_attackers'|'move_limit'} EndReason */

/** @type {readonly EndReason[]} */
export const END_REASONS = Object.freeze(['checkmate', 'stalemate', 'resign', 'repetition', 'no_capture', 'no_attackers', 'move_limit']);
/** @type {Readonly<Record<EndReason, string>>} */
export const END_WORD = Object.freeze({ checkmate: '将死', stalemate: '困毙', resign: '认输', repetition: '三次重复局面', no_capture: '六十回合没有吃子',
                                        no_attackers: '双方都没有进攻的子了', move_limit: '鏖战三百回合' });

// ---- motifs (effects and flaws) ----

/**
 * @typedef {'capture'|'capture_free'|'trade'|'check'|'mate'|'mate_threat'|'fork'|'discovered'|'pin'|'attack'|'defend'|'escape'|'block'
 *   |'block_leg'|'block_eye'|'open_rook'|'develop'|'cannon_mount'|'restrict_king'|'cross_river'|'sacrifice'|'quiet'
 *   |'hang'|'unguard'|'ignore_threat'|'greedy'|'bad_trade'|'miss_capture'|'miss_mate'|'allow_mate'|'walk_fork'|'walk_pin'|'waste'} MotifCode
 */

/** @type {readonly MotifCode[]} */
export const MOTIF_CODES = Object.freeze([
  'capture', 'capture_free', 'trade', 'check', 'mate', 'mate_threat', 'fork', 'discovered', 'pin', 'attack', 'defend', 'escape', 'block',
  'block_leg', 'block_eye', 'open_rook', 'develop', 'cannon_mount', 'restrict_king', 'cross_river', 'sacrifice', 'quiet',
  // flaws
  'hang', 'unguard', 'ignore_threat', 'greedy', 'bad_trade', 'miss_capture', 'miss_mate', 'allow_mate', 'walk_fork', 'walk_pin', 'waste']);
/** @type {readonly MotifCode[]} */
export const FLAW_CODES = Object.freeze(['hang', 'unguard', 'ignore_threat', 'greedy', 'bad_trade', 'miss_capture', 'miss_mate', 'allow_mate', 'walk_fork', 'walk_pin', 'waste']);
/** @type {Readonly<Record<MotifCode, string>>} */
export const MOTIF_TERM = Object.freeze({ capture: '吃子', capture_free: '白吃', trade: '兑子', check: '将军', mate: '将死', mate_threat: '叫杀', fork: '捉双',
  discovered: '闪击', pin: '牵制', attack: '捉子', defend: '保护', escape: '躲开', block: '垫子', block_leg: '蹩马腿', block_eye: '塞象眼',
  open_rook: '亮车', develop: '出子', cannon_mount: '架炮', restrict_king: '封退路', cross_river: '过河', sacrifice: '弃子', quiet: '调整',
  hang: '送子', unguard: '撤防', ignore_threat: '漏看威胁', greedy: '贪吃', bad_trade: '亏本兑子', miss_capture: '漏吃', miss_mate: '漏杀',
  allow_mate: '送杀', walk_fork: '送双', walk_pin: '被牵', waste: '空着' });
/** Motifs that make a rival move, a trial or a praise "notable" (used by policy.js and brief.js). @type {readonly MotifCode[]} */
export const TACTIC_MOTIFS = Object.freeze(['capture_free', 'fork', 'pin', 'discovered', 'mate', 'mate_threat']);
/** @type {readonly MotifCode[]} */
export const NOTABLE_MOTIFS = Object.freeze(['capture', 'capture_free', 'trade', 'check', 'mate', 'mate_threat', 'fork', 'discovered', 'pin', 'attack',
                                             'cannon_mount', 'sacrifice', 'cross_river']);

// ---- named patterns ----

/**
 * @typedef {'central_cannon'|'screen_horses'|'same_cannons'|'opposite_cannons'|'pawn_lead'|'elephant_open'|'horse_open'|'palace_cannon'|'corner_cannon'
 *   |'double_cannon'|'horse_cannon'|'trough_horse'|'corner_horse'|'discovered_check'|'discovered_win'|'double_check'|'check_fork'|'fork_two'
 *   |'iron_bolt'|'smother'|'double_rooks'|'face_off'|'heart_strike'|'sacrifice_play'
 *   |'empty_cannon'|'heart_horse'} PatternCode
 */

/** @type {readonly PatternCode[]} */
export const PATTERN_CODES = Object.freeze([
  'central_cannon', 'screen_horses', 'same_cannons', 'opposite_cannons', 'pawn_lead', 'elephant_open', 'horse_open', 'palace_cannon', 'corner_cannon',  // openings
  'double_cannon', 'horse_cannon', 'trough_horse', 'corner_horse', 'discovered_check', 'discovered_win', 'double_check', 'check_fork', 'fork_two',
  'iron_bolt', 'smother', 'double_rooks', 'face_off', 'heart_strike', 'sacrifice_play',                                                              // tactics and mates
  'empty_cannon', 'heart_horse']);                                                                                                                   // formations
/** @type {Readonly<Record<PatternCode, string>>} */
export const PATTERN_NAME = Object.freeze({ central_cannon: '当头炮', screen_horses: '屏风马', same_cannons: '顺炮', opposite_cannons: '列炮', pawn_lead: '仙人指路',
  elephant_open: '飞相局', horse_open: '起马局', palace_cannon: '过宫炮', corner_cannon: '士角炮', double_cannon: '重炮', horse_cannon: '马后炮',
  trough_horse: '卧槽马', corner_horse: '挂角马', discovered_check: '抽将', discovered_win: '抽将得子', double_check: '双将', check_fork: '将军捉子',
  fork_two: '捉双', iron_bolt: '铁门栓', smother: '闷宫', double_rooks: '双车错', face_off: '白脸将', heart_strike: '大胆穿心', sacrifice_play: '弃子',
  empty_cannon: '空头炮', heart_horse: '窝心马' });
/**
 * Patterns that earn a 招式 stamp when the child plays them (§4.22 policy.stampFor). heart_horse is a weakness and never stamped.
 * @type {readonly PatternCode[]}
 */
export const STAMP_PATTERNS = Object.freeze(PATTERN_CODES.filter(c => c !== 'heart_horse' && c !== 'sacrifice_play'));

// ---- dangers (why a move is bad; internal to core, mapped to flaws by brief.js) and habits ----

/**
 * @typedef {'allows_mate'|'misses_mate'|'hangs_moved_piece'|'leaves_hanging'|'unguards'|'bad_trade'|'walks_into_fork'
 *   |'walks_into_pin'|'misses_win'|'slow'} DangerCode
 */
/** @typedef {'hang_piece'|'miss_threat'|'greedy'|'miss_capture'|'bad_trade'|'miss_mate'} HabitCode */

/** @type {readonly DangerCode[]} */
export const DANGER_CODES = Object.freeze(['allows_mate', 'misses_mate', 'hangs_moved_piece', 'leaves_hanging', 'unguards', 'bad_trade', 'walks_into_fork',
                                           'walks_into_pin', 'misses_win', 'slow']);
/** @type {readonly HabitCode[]} */
export const HABIT_CODES = Object.freeze(['hang_piece', 'miss_threat', 'greedy', 'miss_capture', 'bad_trade', 'miss_mate']);
/** @type {Readonly<Record<HabitCode, string>>} */
export const HABIT_WORD = Object.freeze({ hang_piece: '走完没检查自己的子有没有保护', miss_threat: '没先看对方上一步的威胁', greedy: '吃子前没看对方能不能吃回',
                                          miss_capture: '能白吃的子没看见', bad_trade: '兑子时算亏了', miss_mate: '有杀棋没看出来' });
/** @type {Readonly<Record<HabitCode, string>>} */
export const HABIT_FIX = Object.freeze({ hang_piece: '走完先看一眼，这个子有没有人保护', miss_threat: '对方走完，先问自己：他想干什么', greedy: '吃子之前，先看它有没有保镖',
                                         miss_capture: '每一步先扫一遍，有没有白吃的子', bad_trade: '兑子之前，数一数谁亏谁赚', miss_mate: '对方的老将没路走时，多算一步' });
/**
 * danger of the first try -> habit; `hangs_moved_piece` maps to 'greedy' when the tried move was a capture.
 * @type {Readonly<Record<DangerCode, HabitCode|null>>}
 */
export const HABIT_OF_DANGER = Object.freeze({ allows_mate: 'miss_threat', misses_mate: 'miss_mate', hangs_moved_piece: 'hang_piece', leaves_hanging: 'miss_threat',
                                               unguards: 'hang_piece', bad_trade: 'bad_trade', walks_into_fork: 'miss_threat', walks_into_pin: 'miss_threat',
                                               misses_win: 'miss_capture', slow: null });
/** @type {readonly ('S_tactics'|'S_defense'|'S_finish'|'S_steady')[]} */
export const STRENGTH_CODES = Object.freeze(['S_tactics', 'S_defense', 'S_finish', 'S_steady']);
/** @type {Readonly<Record<'S_tactics'|'S_defense'|'S_finish'|'S_steady', string>>} */
export const STRENGTH_WORD = Object.freeze({ S_tactics: '抓战术机会很准', S_defense: '防守很稳', S_finish: '收尾干净利落', S_steady: '沉得住气' });

// ---- hints ----

/** @typedef {'mate'|'escape_check'|'stop_mate'|'win_material'|'tactic'|'save_piece'|'trade'|'attack'|'develop'|'defend'|'improve'} HintTheme */

/** @type {readonly HintTheme[]} */
export const HINT_THEMES = Object.freeze(['mate', 'escape_check', 'stop_mate', 'win_material', 'tactic', 'save_piece', 'trade', 'attack', 'develop', 'defend', 'improve']);

// ---- level and rank ----

export const LEVEL_MIN = 1, LEVEL_MAX = 9;
/** index = rank - 1. @type {readonly string[]} */
export const RANK_NAMES = Object.freeze(['初出茅庐', '小试牛刀', '渐入佳境', '初露锋芒', '运筹帷幄', '智勇双全', '用兵如神', '算无遗策', '天下无双']);

// ---- material and piece letters ----

/** Centipawns, 100 = one pawn = 1 分. @type {Readonly<Record<'king'|'advisor'|'elephant'|'horse'|'rook'|'cannon'|'pawn', number>>} */
export const PIECE_VALUE = Object.freeze({ king: 10000, rook: 900, cannon: 450, horse: 400, advisor: 200, elephant: 200, pawn: 100 });
/** A pawn across the river. */
export const CROSSED_PAWN_VALUE = 200;
/** Points (分) = PIECE_VALUE / 100 (section 3, conventions); a pawn across the river counts CROSSED_PAWN_VALUE / 100 = 2. @type {Readonly<Record<'king'|'advisor'|'elephant'|'horse'|'rook'|'cannon'|'pawn', number>>} */
export const PIECE_POINTS = Object.freeze({ king: 100, rook: 9, cannon: 4.5, horse: 4, advisor: 2, elephant: 2, pawn: 1 });
/** @type {Readonly<Record<'king'|'advisor'|'elephant'|'horse'|'rook'|'cannon'|'pawn', 'K'|'A'|'E'|'H'|'R'|'C'|'P'>>} */
export const PT_OF = Object.freeze({ king: 'K', advisor: 'A', elephant: 'E', horse: 'H', rook: 'R', cannon: 'C', pawn: 'P' });
/** @type {Readonly<Record<'K'|'A'|'E'|'H'|'R'|'C'|'P', 'king'|'advisor'|'elephant'|'horse'|'rook'|'cannon'|'pawn'>>} */
export const TYPE_OF_PT = Object.freeze({ K: 'king', A: 'advisor', E: 'elephant', H: 'horse', R: 'rook', C: 'cannon', P: 'pawn' });

// ---- notation ----

// Numerals are enumerated on purpose: [一-九] is not a numeral range.
/** One whole notation (anchored); accepts the five-character doubled-pawn form. */
export const NOTATION_RE = /^(?:[前中后二三四][兵卒][一二三四五六七八九1-9]?|[前后][车马炮]|[帅将仕士相象马车炮兵卒][一二三四五六七八九1-9])[进退平][一二三四五六七八九1-9]$/;
/** The same grammar unanchored and global, for scanning free text. Stateful under exec() / test() (lastIndex): prefer match(), matchAll(), replace(). */
export const NOTATION_SCAN_RE = /(?:[前中后二三四][兵卒][一二三四五六七八九1-9]?|[前后][车马炮]|[帅将仕士相象马车炮兵卒][一二三四五六七八九1-9])[进退平][一二三四五六七八九1-9]/g;
