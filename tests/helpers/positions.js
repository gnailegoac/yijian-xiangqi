// Named test positions (F0, frozen). Data only: this module imports nothing and calls no engine function.
//
// FEN: contract Appendix A4 — "placement w|b", rows from row 0 (black back rank) to row 9, letters K A B N R C P
// for red king, advisor, elephant, horse, rook, cannon, pawn, lower case for black, w = red to move.
// Moves are MoveCodes (four digits "frfctrtc", contract section 3.1); a Chinese notation is always relative to the
// position it is played in. Every FEN, move, line and win distance below was checked with the v1 rules engine
// (a win distance counts a side with no legal move as lost, in check or not: see `mateIn`).

/** @typedef {import('../../src/core/types.js').MoveCode} MoveCode */
/** @typedef {import('../../src/core/codes.js').PatternCode} PatternCode */

/**
 * @typedef {Object} TacticalPosition      one row of the tactical suite, Appendix A7
 * @property {string} name                 the row's name, as printed in A7
 * @property {string} fen
 * @property {string|null} first           expected first move in notation; null = A7 says "any" (only the mate distance is expected)
 * @property {MoveCode|null} move          the same move as a MoveCode; null when first is null
 * @property {number|null} mateIn          win distance in moves of the side to move as search.js scores it (A3.2 item 13: a side with
 *                                         no legal move has lost, in check or not; 抽将 is won on move 2 by 困毙, a checkmate takes 3);
 *                                         null = A7 gives none (the move wins material)
 *
 * @typedef {Object} PatternExample        one verified example of Appendix A6.4
 * @property {PatternCode} id              the code the rule of A6.4 yields for the move
 * @property {string} name                 the pattern's name, as printed in A6.4
 * @property {string} fen
 * @property {string} first                the move that plays the pattern, in notation
 * @property {MoveCode} move               the same move as a MoveCode
 * @property {boolean} mate                true when the move is checkmate
 * @property {string} note
 *
 * @typedef {Object} V1CoachFixture        one position + move of the v1 coach tests (legacy/tests/coach.test.js)
 * @property {string} name
 * @property {string} fen                  the position before the move
 * @property {MoveCode} move               the move the old test described
 * @property {string|null} notation        its notation; null when the move is not legal
 * @property {boolean} legal               false only for the fixture whose point is that the move must be rejected
 * @property {MoveCode[]} line             the continuation after `move` that the old test supplied as the searched line (may be empty)
 * @property {MoveCode[]|null} alt         another variation from the same position that the old test compared against, or null
 * @property {string} intent               what the old test asserted, as a fact about the position (not about wording)
 * @property {string[]} v1                 titles of the v1 tests that used this position and move
 *
 * @typedef {Object} CoachExamplePosition  a position of the packet examples of contract section 9
 * @property {string} fen
 * @property {MoveCode[]} moves            the moves that reach it from the start position
 * @property {MoveCode} [trial]            the held trial of the worked example
 * @property {MoveCode} [refutation]       the rival's reply that punishes the trial
 * @property {MoveCode} [best]             the pinned best move
 */

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * The tactical suite of Appendix A7, in table order (eleven positions).
 * Used by search.test.js (maxDepth 6) and facts.test.js.
 * @type {ReadonlyArray<Readonly<TacticalPosition>>}
 */
export const TACTICAL_SUITE = deepFreeze([
  { name: '重炮', fen: '3aka3/9/9/4C4/9/9/9/1C7/9/4K4 w', first: '炮八平五', move: '7174', mateIn: 1 },
  { name: '马后炮', fen: '4k4/9/9/9/3N5/9/4C4/9/r8/4K4 w', first: '马六进五', move: '4324', mateIn: 1 },
  { name: '铁门栓', fen: '2bak1b2/4a4/9/4p4/9/5R3/9/4C4/9/5K3 w', first: '车四进五', move: '5505', mateIn: 1 },
  { name: '双车错', fen: '4k4/R8/9/9/9/8R/9/9/9/3K5 w', first: '车一进五', move: '5808', mateIn: 1 },
  { name: '闷宫', fen: '4ka3/4a4/9/9/9/9/9/9/7C1/4K4 w', first: '炮二进八', move: '8707', mateIn: 1 },
  { name: '白脸将', fen: '3k5/9/9/9/9/9/9/9/R8/4K4 w', first: '车九平六', move: '8083', mateIn: 1 },
  { name: '重炮 (black)', fen: '4k4/9/1c7/9/9/9/4c4/9/9/3AKA3 b', first: '炮2平5', move: '2124', mateIn: 1 },
  { name: '抽将', fen: '4k4/9/5r3/9/4N4/9/4R4/9/9/3K5 w', first: '马五进四', move: '4425', mateIn: 2 },
  { name: '双车错, two moves', fen: '9/4k4/9/9/9/R8/8R/9/9/3K5 w', first: null, move: null, mateIn: 2 },
  { name: '卧槽马', fen: 'r1bakab2/9/9/3N5/9/9/9/9/9/5K3 w', first: '马六进七', move: '3312', mateIn: null },
  { name: '捉双', fen: '4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w', first: '马六进五', move: '6344', mateIn: null },
]);

/**
 * The verified pattern examples of Appendix A6.4 (nine positions; the FENs are those of the tactical suite).
 * `name` equals PATTERN_NAME[id] except for 抽将: its example takes a rook with the discovered check, so the rule of
 * A6.4 yields `discovered_win` (抽将得子) for it.
 * @type {ReadonlyArray<Readonly<PatternExample>>}
 */
export const PATTERN_EXAMPLES = deepFreeze([
  { id: 'double_cannon', name: '重炮', fen: '3aka3/9/9/4C4/9/9/9/1C7/9/4K4 w', first: '炮八平五', move: '7174', mate: true,
    note: 'the rear cannon checks through the front cannon; mate in one' },
  { id: 'horse_cannon', name: '马后炮', fen: '4k4/9/9/9/3N5/9/4C4/9/r8/4K4 w', first: '马六进五', move: '4324', mate: true,
    note: 'the horse lands two points from the king on the cannon file; mate in one' },
  { id: 'trough_horse', name: '卧槽马', fen: 'r1bakab2/9/9/3N5/9/9/9/9/9/5K3 w', first: '马六进七', move: '3312', mate: false,
    note: 'check from row 1, column 2, and the horse also attacks the rook in the corner (check and wins the rook)' },
  { id: 'iron_bolt', name: '铁门栓', fen: '2bak1b2/4a4/9/4p4/9/5R3/9/4C4/9/5K3 w', first: '车四进五', move: '5505', mate: true,
    note: 'the rook mates on row 0, column 5; the central cannon pins the advisor on row 1, column 4' },
  { id: 'double_rooks', name: '双车错', fen: '4k4/R8/9/9/9/8R/9/9/9/3K5 w', first: '车一进五', move: '5808', mate: true,
    note: 'one rook checks on the back rank while the other holds row 1; mate in one' },
  { id: 'smother', name: '闷宫', fen: '4ka3/4a4/9/9/9/9/9/9/7C1/4K4 w', first: '炮二进八', move: '8707', mate: true,
    note: 'the cannon checks along the back rank with the defender\'s own advisor as its screen; mate in one' },
  { id: 'face_off', name: '白脸将', fen: '3k5/9/9/9/9/9/9/9/R8/4K4 w', first: '车九平六', move: '8083', mate: true,
    note: 'the rook checks on the king file and the red king denies column 4 (a facing flight); mate in one' },
  { id: 'discovered_win', name: '抽将', fen: '4k4/9/5r3/9/4N4/9/4R4/9/9/3K5 w', first: '马五进四', move: '4425', mate: false,
    note: 'the horse takes the rook and uncovers the rook check on column 4; after 将5平6 the quiet 车五进五 leaves black '
      + 'without a legal move (困毙), which the search reports as mate in 2' },
  { id: 'fork_two', name: '捉双', fen: '4k4/9/3r1r3/9/9/9/3NP4/9/9/4K4 w', first: '马六进五', move: '6344', mate: false,
    note: 'the horse attacks both rooks without giving check' },
]);

/**
 * The positions of the v1 coach tests, converted to FEN: 22 distinct (position, move) pairs.
 * The 27 v1 tests reduce to 22 because five of them reuse the position and move of another test (`v1` lists the titles).
 * The boards are the constructed boards of the old tests, unchanged: `rook-mate` has three red rooks and
 * `cannon-drops-attack` has an uncrossed black pawn on column 1; neither can arise in a real game.
 * @type {ReadonlyArray<Readonly<V1CoachFixture>>}
 */
export const V1_COACH_FIXTURES = deepFreeze([
  { name: 'open-horse-left', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '9172', notation: '马八进七', legal: true, line: [], alt: null,
    intent: 'the horse develops and opens the left rook: 车九平八 is legal after the move and was blocked before it; '
      + 'describing the move does not mutate the board',
    v1: ['opening horse development explains the exact rook route it opens',
      'describing a move preserves the historical board and caps reasons'] },
  { name: 'open-horse-right', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '9776', notation: '马二进三', legal: true, line: [], alt: null,
    intent: 'the mirrored development opens the right rook: 车一平二 becomes legal',
    v1: ['the mirrored opening horse also opens the rook route toward the left'] },
  { name: 'cannon-shift-with-line', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '7172', notation: '炮八平七', legal: true, line: ['2797', '9897'], alt: null,   // 炮8进7, 车一平二
    intent: 'the move itself mounts the cannon behind the red pawn on file 七 (threat 炮七进四); the exchange in the '
      + 'supplied line (red wins a cannon and gives a horse) belongs to the line, not to the effects of the move',
    v1: ['unrelated variation exchanges stay outside the explanation of the selected move'] },
  { name: 'cannon-takes-guarded-horse', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '7101', notation: '炮八进七', legal: true, line: ['0001'], alt: null,           // 车1平2
    intent: 'the cannon takes a horse that the rook guards: after the recapture red has given a cannon for a horse, '
      + 'a losing trade for red and never a free capture',
    v1: ['coach explains a capture and warns about a legal recapture',
      'a protected horse exchange is explained as cannon for horse using the whole legal line'] },
  { name: 'edge-pawn-capture', fen: 'rnbakabnr/9/1c5c1/2p1p1p1p/p8/P8/2P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '5040', notation: '兵九进一', legal: true, line: ['0040', '9040'], alt: null,   // 车1进4, 车九进五
    intent: 'the pawn capture is judged on the whole three-ply line: the black rook retakes the pawn and the red rook '
      + 'then takes that rook; it is not reported as a plain pawn-for-pawn trade',
    v1: ['the opening pawn capture explains the third-move rook recapture instead of stopping at pawn for pawn'] },
  { name: 'rook-steps-into-capture', fen: '4k4/9/9/r8/9/1R2P4/9/9/9/4K4 w',
    move: '5150', notation: '车八平九', legal: true, line: ['3050'], alt: null,           // 车1进2
    intent: 'a quiet move puts the rook where the black rook takes it: the moved piece hangs; nothing was captured '
      + 'first, so the loss is a capture and not a recapture',
    v1: ['losing a piece after a quiet move is called being captured, not being recaptured'] },
  { name: 'block-check', fen: '4k4/9/9/9/4r4/9/9/R8/9/4K4 w',
    move: '7074', notation: '车九平五', legal: true, line: [], alt: null,
    intent: 'red is in check from the black rook and the move interposes: answering the check comes before any other effect',
    v1: ['coach gives evading check priority over positional explanations'] },
  { name: 'rook-check', fen: '4k4/9/9/9/R8/4P4/9/9/9/4K4 w',
    move: '4000', notation: '车九进四', legal: true, line: [], alt: null,
    intent: 'the move gives check and is not checkmate',
    v1: ['coach identifies a check without promising a win'] },
  { name: 'rook-mate', fen: '4k4/3R1R3/R8/9/9/4P4/9/9/9/4K4 w',
    move: '2024', notation: '车九平五', legal: true, line: [], alt: null,
    intent: 'black is not in check before the move and is checkmated by it; a mate carries no flaw',
    v1: ['coach only announces checkmate when the rules engine verifies it'] },
  { name: 'rook-retreats-from-attack', fen: '4k4/9/9/r8/9/R3P4/9/9/9/4K4 w',
    move: '5051', notation: '车九平八', legal: true, line: ['3031'], alt: ['5444', '3050'],   // 车1平2 | 兵五进一, 车1进2
    intent: 'the red rook is attacked by the black rook (车1进2 would take it) and steps away: no capture of it remains; '
      + 'the alternative 兵五进一 leaves it to be taken, a whole rook worse',
    v1: ['coach explains a threatened piece retreat using legal reply analysis',
      'same-depth alternatives compare the actual rook loss, including a completed iteration before timeout'] },
  { name: 'rook-shields-horse', fen: '4k4/9/9/r8/9/2R1P4/9/N8/9/4K4 w',
    move: '5250', notation: '车七平九', legal: true, line: [], alt: null,
    intent: 'the rook interposes between the black rook and the red horse it attacked; the blocker itself can be taken',
    v1: ['coach notices protection of another piece and warns if the blocker can be taken'] },
  { name: 'horse-attacks-rook', fen: '4k4/9/4r4/9/9/4P4/2N6/9/9/4K4 w',
    move: '6243', notation: '马七进六', legal: true, line: [], alt: null,
    intent: 'the horse now attacks the black rook (threat 马六进五); it is an attack, not a capture already won',
    v1: ['coach describes new attacks without claiming a free capture'] },
  { name: 'red-pawn-crosses', fen: '4k4/9/9/9/9/P3P4/9/9/9/4K4 w',
    move: '5040', notation: '兵九进一', legal: true, line: [], alt: null,
    intent: 'a red pawn crosses the river: it can now move sideways and can never retreat',
    v1: ['red pawn crossing explanation identifies its new sideways ability'] },
  { name: 'black-pawn-crosses', fen: '4k4/9/9/9/p8/4P4/9/9/9/4K4 b',
    move: '4050', notation: '卒1进1', legal: true, line: [], alt: null,
    intent: 'a black pawn crosses the river in black\'s direction (toward row 9); the piece is a 卒',
    v1: ['black pawn explanations use the black side direction and piece label'] },
  { name: 'quiet-advisor', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '9384', notation: '仕六进五', legal: true, line: [], alt: null,
    intent: 'a move with no identified benefit: no effect is reported and nothing is invented',
    v1: ['a move without identified benefits gets no filler explanation'] },
  { name: 'cannon-clears-rook-rank', fen: '4k4/9/9/9/9/4P4/9/RC7/9/4K4 w',
    move: '7161', notation: '炮八进一', legal: true, line: [], alt: null,
    intent: 'the cannon leaves the point next to the rook, so the rook gains its rank: 车九平八 becomes legal',
    v1: ['a quiet cannon move explains the exact horizontal rook route it vacates'] },
  { name: 'cannon-mounts-on-pawn', fen: '4k4/9/r8/9/9/P3P4/9/1C7/9/4K4 w',
    move: '7170', notation: '炮八平九', legal: true, line: [], alt: null,
    intent: 'the cannon lines up on the black rook with the red pawn as its screen: threat 炮九进五',
    v1: ['cannon alignment names the actual screen and the legal threat'] },
  { name: 'cannon-unpins-rook', fen: '3kr4/9/9/9/9/4R4/9/1C7/9/4K4 w',
    move: '7174', notation: '炮八平五', legal: true, line: [], alt: null,
    intent: 'the red rook was pinned on column 4 by the black rook; the cannon interposes and frees it. The rook\'s new '
      + 'sideways moves come from the released pin, not from a vacated route',
    v1: ['new legal rook moves from releasing a pin are not falsely described as vacating its route'] },
  { name: 'cannon-drops-attack', fen: '4k4/9/1r7/9/1p7/4P4/9/1C7/9/4K4 w',
    move: '7172', notation: '炮八平七', legal: true, line: [], alt: null,
    intent: 'before the move the cannon attacks the black rook over the black pawn (炮八进五 takes it); the move gives '
      + 'that capture up, which is a flaw and not an achievement',
    v1: ['a quiet cannon retreat can withdraw a real attack rather than earn praise'] },
  { name: 'edge-pawn-push', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '6050', notation: '兵九进一', legal: true, line: [], alt: ['6252'],             // 兵七进一
    intent: 'a quiet pawn move; the alternative 兵七进一 is materially equal, so no comparison is reported. A line '
      + 'that contains an illegal move is rejected whole, and a line that starts with another move is not attached',
    v1: ['an illegal continuation is rejected as a whole instead of narrated as evidence',
      'a variation starting with another move is not attached to the requested explanation',
      'equivalent material variations do not receive a fabricated score-based explanation'] },
  { name: 'illegal-sideways-pawn', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    move: '6061', notation: null, legal: false, line: [], alt: null,
    intent: 'an uncrossed pawn cannot move sideways: the move is not legal and must be rejected, never described',
    v1: ['invalid moves are rejected instead of receiving a plausible explanation'] },
  { name: 'black-edge-pawn-push', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b',
    move: '3040', notation: '卒1进1', legal: true, line: [], alt: null,
    intent: 'black moves in the start placement: the facts name the mover as black, so the perspective cannot be reversed',
    v1: ['explanations name red and black explicitly so opponent commentary cannot reverse the player perspective'] },
]);

/**
 * The three reference positions of Appendix A1 (benchmarks of section 14.9; perft and search checks).
 * `opening` is the start position; all three are red to move.
 */
export const REFERENCE_POSITIONS = deepFreeze({
  opening: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
  middlegameA: 'r1bakab1r/9/1cn3n1c/p1p1p3p/6p2/2P6/P3P1P1P/1CN1C1N2/9/R1BAKAB1R w',
  middlegameB: '2bakab2/9/2n1c1n2/p1p1p1r1p/1r4p2/2P1P4/P3N1P1P/2N1C2C1/9/R1BAKAB1R w',
});

/**
 * The positions of the packet examples of contract section 9 (both red to move, 35 legal moves).
 * - `sameCannons`: section 9.3, after 1. 炮二平五 炮8平5.
 * - `horseReply`: sections 9.4 to 9.6 (the worked example), after 1. 炮二平五 马8进7. The held trial is 炮五进四,
 *   which loses the cannon to 马7进5; the pinned best move is 马二进三.
 * @type {Readonly<{sameCannons: Readonly<CoachExamplePosition>, horseReply: Readonly<CoachExamplePosition>}>}
 */
export const COACH_EXAMPLE_POSITIONS = deepFreeze({
  sameCannons: { fen: 'rnbakabnr/9/1c2c4/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w', moves: ['7774', '2724'] },
  horseReply: { fen: 'rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w', moves: ['7774', '0726'],
    trial: '7434', refutation: '2634', best: '9776' },
});
