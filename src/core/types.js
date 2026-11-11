/**
 * Shared typedefs of the chess core: contract sections 3.1 to 3.5, copied verbatim. JSDoc only, no runtime code.
 *
 * Conventions (section 3):
 * - Rows 0 (black back rank) .. 9 (red back rank); cols 0..8 left to right as red sees the board.
 * - Scores are integer centipawns from the point of view of the side to move in the position the score belongs to,
 *   unless a field name says otherwise ("child's view"). Mate scores are +-(MATE - plies), MATE = 30000, WIN = 29800.
 *   scoreToCp (search.js) is the only way to do arithmetic on scores.
 * - Everything that crosses a thread, the network or storage is plain JSON.
 *
 * The enumerations (Cat, PatternCode, HabitCode, DangerCode, HintTheme) are the frozen arrays of codes.js.
 * Frozen after wave 0: a change to this file is a change to the build contract.
 */

/** @import { Cat, PatternCode, HabitCode, DangerCode, HintTheme } from './codes.js' */

// ---- 3.1 Board and moves ----

/** @typedef {'red'|'black'} Color */
/** @typedef {'king'|'advisor'|'elephant'|'horse'|'rook'|'cannon'|'pawn'} PieceType */
/** @typedef {{row:number, col:number}} Square */
/** @typedef {{id:string, type:PieceType, color:Color}} Piece            unchanged from v1; ids are stable for a whole game */
/** @typedef {(Piece|null)[][]} Board                                    10 rows x 9 cols, immutable by convention */
/** @typedef {{from:Square, to:Square, piece:Piece, captured:Piece|null}} Move      the object getLegalMoves returns */
/** @typedef {{from:Square, to:Square}} MoveRef                         the only move shape accepted inwards across a module or thread boundary */
/** @typedef {string} MoveCode                                           4 digits "frfctrtc", /^[0-9][0-8][0-9][0-8]$/ ; 炮二平五 from the start = "7774" */
/** @typedef {MoveRef & {notation:string, piece:PieceType, color:Color, captured:PieceType|null}} MoveInfo     outward shape, always with notation */
/** @typedef {{start:string, moves:MoveInfo[], end:'quiet'|'check'|'mate'|'cut'}} Line
 *    start = FEN before moves[0]; each notation is relative to the position it is played in.
 *    end: 'mate' the last move mates; 'check' it gives check; 'quiet' the final position is settled (quiescence stood pat);
 *    'cut' the line was truncated at pvLength while captures were pending (materialOutcome then settles it by SEE). */
/** @typedef {{type:PieceType, color:Color, at:Square, label:string, name:string}} PieceRef
 *    label = board character (车 马 炮 相/象 仕/士 帅/将 兵/卒). name is unique within its side: the label alone when the side has one
 *    piece of that type, else "<file>路<label>" (七路马, 2路车), and 前/后 + label when two share a file. */
/** @typedef {{over:boolean, winner:Color|null, reason:'checkmate'|'stalemate'|'king-captured'|null, check:boolean}} GameStatus   engine.getGameStatus */
/** @typedef {{key:string, mover:Color, check:boolean, capture:boolean}} PlyRecord    key = positionKey AFTER the move */

// ---- 3.2 Search: Analysis ----

/**
 * @typedef {Object} AnalyzeRequest
 * @property {string}    fen
 * @property {string[]} [history]      FENs of the game positions since the last capture, oldest first, excluding `fen`
 * @property {number}    timeMs        soft budget for the whole call
 * @property {number}   [maxNodes]     stop like the hard deadline once this many nodes were visited (tests use it instead of the clock)
 * @property {number}   [maxDepth=12]
 * @property {number}   [minDepth=2]   iterations up to this depth always complete (safety stop at max(4*timeMs, 1000 ms))
 * @property {number}   [allDepth=0]   iterations <= allDepth give EVERY root move an exact score
 * @property {number}   [multiPV=1]    K: at deeper iterations the best K root moves are exact, the rest get an upper bound
 * @property {MoveRef[]} [rootMoves]   restrict the root to these moves
 * @property {boolean}  [pass=false]   let the side to move pass first and analyse the opponent's best continuation (threat search)
 * @property {number}   [pvLength=8]
 *
 * @typedef {Object} RootLine
 * @property {MoveRef}   move
 * @property {number}    score     exact score of this move at iteration `depth`, for the side to move at the root
 * @property {number}    depth     last iteration in which this move was searched exactly
 * @property {number|null} upper   set when depth < result.depth: at result.depth this move is proven <= upper
 * @property {number|null} mate    mateIn(score)
 * @property {MoveRef[]} pv        legal continuation starting with `move`
 * @property {number[]}  byDepth   exact score at iteration d = 1..(number of exact iterations), index d-1
 * @property {number}    naive     static evaluation right after the move, no search ("glance" score)
 * @property {number}    repeats   how many times the position after this move has occurred in history + this one (1 = new)
 *
 * @typedef {Object} Analysis
 * @property {string} fen
 * @property {Color}  turn
 * @property {number} depth      deepest fully completed iteration (0 only when there are no legal moves)
 * @property {number} allDepth   deepest iteration in which every root move was exact
 * @property {RootLine[]} lines  every root move; lines exact at `depth` first (best first), then the rest by min(score, upper)
 * @property {number} nodes
 * @property {number} timeMs
 * @property {'depth'|'time'|'nodes'|'cancel'|'mate'|'no-moves'|'in-check'} stopped   'in-check' only for pass requests
 */

// ---- 3.3 Facts ----

/**
 * @typedef {Object} PositionFacts
 * @property {string} fen
 * @property {Color}  turn
 * @property {{checkers:PieceRef[]}|null} check      the side to move is in check
 * @property {{red:number, black:number, phase:number}} material   points per side; phase 0 = full board .. 1 = bare
 * @property {PieceStatus[]} pieces                  every piece on the board
 * @property {Hanging[]} hanging                     pieces of either colour the other side could take with profit, biggest gain first
 * @property {Pin[]} pins
 * @property {CannonAim[]} cannons
 * @property {{red:KingFacts, black:KingFacts}} kings
 * @property {{red:MateThreat|null, black:MateThreat|null}} mates   forced mate each side has if it is (or were) on move
 * @property {Pattern[]} patterns                    formations standing on the board (Appendix A6.4)
 *
 * @typedef {{piece:PieceRef, attackers:PieceRef[], defenders:PieceRef[], status:'safe'|'guarded'|'loose'|'hanging'}} PieceStatus
 * @typedef {{piece:PieceRef, by:PieceRef, capture:MoveInfo, gain:number, points:number, free:boolean, now:boolean}} Hanging
 * @typedef {{pinned:PieceRef, by:PieceRef, shield:PieceRef, absolute:boolean, kind:'rook'|'cannon'|'horse'|'kings'}} Pin
 * @typedef {{cannon:PieceRef, screen:PieceRef, target:PieceRef, gain:number}} CannonAim
 * @typedef {{to:Square, state:'free'|'own'|'attacked'|'facing', by:PieceRef|null}} Flight
 * @typedef {{at:Square, flights:Flight[], free:number, pressure:number}} KingFacts
 * @typedef {{in:1|2|3, line:Line, pattern:Pattern|null}} MateThreat
 * @typedef {{id:PatternCode, name:string, side:Color, squares:Square[], stage:'formation'|'threat'|'played', mate:boolean}} Pattern
 */

/**
 * @typedef {Object} MoveFacts
 * @property {MoveInfo} move
 * @property {string} fenBefore
 * @property {string} fenAfter
 * @property {MoveTag[]} tags
 * @property {{piece:PieceRef, see:number, exchange:'wins'|'even'|'loses', free:boolean, recapture:MoveInfo|null}|null} capture
 * @property {{checkers:PieceRef[], discovered:boolean, double:boolean, replies:number, mate:boolean}|null} check
 * @property {boolean} escapesCheck
 * @property {NewThreat[]} threats        profitable captures the mover will have next turn that it did not have before
 * @property {Parry[]} parried         mover's pieces that were hanging before and are not after
 * @property {Exposed[]} exposed       mover's pieces that are hanging after the move
 * @property {{by:PieceRef|null, targets:PieceRef[], withCheck:boolean}|null} fork
 * @property {{created:Pin[], released:Pin[], suffered:Pin[]}} pins   created on the enemy / removed from own pieces / own pieces newly pinned
 * @property {Block[]} blocks
 * @property {Open[]} opens
 * @property {{before:number, after:number}} kingSqueeze    free flights of the enemy king
 * @property {MateThreat|null} mateThreat   the mover would mate if allowed to move again (叫杀)
 * @property {MateThreat|null} allowsMate   the opponent has a forced mate after this move
 * @property {Pattern[]} patterns
 * @property {boolean} pawnCrossed
 *
 * @typedef {'将'|'杀'|'吃'|'捉'|'兑'|'献'|'保'|'拦'|'闪'|'闲'} MoveTag
 * @typedef {{target:PieceRef, by:PieceRef, capture:MoveInfo, gain:number, discovered:boolean, viaScreen:PieceRef|null}} NewThreat
 * @typedef {{piece:PieceRef, how:'moved'|'captured-attacker'|'blocked'|'defended'}} Parry
 * @typedef {{piece:PieceRef, by:PieceRef, capture:MoveInfo, gain:number, cause:'moved-into-attack'|'left-hanging'|'unguarded'|'uncovered'}} Exposed
 * @typedef {{kind:'horse-leg'|'elephant-eye'|'line', piece:PieceRef}} Block
 * @typedef {{piece:PieceRef, kind:'line'|'leg'|'eye', gained:number}} Open
 */

/** @typedef {{net:number, won:{piece:PieceType, points:number}[], lost:{piece:PieceType, points:number}[],
 *             kind:'none'|'wins'|'loses'|'even-trade'|'good-trade'|'bad-trade', mate:'gives'|'suffers'|null,
 *             plies:number, settled:boolean}} MaterialOutcome
 *    net in points (分) for `pov`; settled is always true in results that leave facts.js (§4.6.3). */

// ---- 3.4 Assessment, hints and job results ----

/** @typedef {{cat:Cat, loss:number, depth:number, isBest:boolean}} Quick           provisional verdict from the table (never 'brilliant') */

/** @typedef {{reply:MoveInfo, line:Line, outcome:MaterialOutcome, revealDepth:number, danger:DangerCode, focus:Square[]}} Refutation */

/**
 * @typedef {Object} MoveAssessment
 * @property {MoveInfo} move
 * @property {number}  depth          search depth both scores come from
 * @property {number}  moveCp         scoreToCp of the move, mover's view
 * @property {number}  bestCp         scoreToCp of the better of {comparison move, this move}
 * @property {number}  loss           max(0, bestCp - moveCp), capped at 9999
 * @property {Cat}     cat
 * @property {MoveInfo} best          the comparison move; the tried move itself when it is at least as good
 * @property {boolean} isBest
 * @property {{move:MoveInfo, loss:number}[]} alternatives     up to three other root moves from the table, best first
 * @property {{onlyMove:boolean, missedWin:boolean, missedMate:boolean, allowsMate:boolean, givesMate:number|null, sacrifice:boolean}} flags
 * @property {Line} line              the move followed by the expected continuation (settled)
 * @property {MaterialOutcome} outcome
 * @property {Refutation|null} refutation      filled exactly when cat is 'mistake' or 'blunder'
 * @property {Line} bestLine
 * @property {MaterialOutcome} bestOutcome
 * @property {number} revealBest      revealDepth of the best move in the 'good' sense
 * @property {Pattern[]} patterns
 */

/** @typedef {{kind:'mate'|'wins-material'|'check'|'plan', line:Line, outcome:MaterialOutcome, mate:number|null, facts:MoveFacts}} ThreatInfo
 *    what the rival does if the child passes; line.moves[0] is the rival's move */

/** @typedef {{theme:HintTheme, piece:PieceRef, area:{side:'left'|'center'|'right', zone:'home'|'river'|'enemy'},
 *             move:MoveInfo, line:Line, outcome:MaterialOutcome, facts:MoveFacts, alternatives:MoveInfo[]}} Hint */

/** @typedef {{tier:1|2|3, kind:'win'|'save', group:MoveInfo[]}} TacticalTest */

/**
 * @typedef {Object} Survey                       result of the `survey` job (child to move)
 * @property {string} fen
 * @property {PositionFacts} facts
 * @property {ThreatInfo|null} threat             null when the child is in check
 * @property {Analysis} table                     every legal child move
 * @property {MoveInfo[]} moves                   moves[i] describes table.lines[i].move
 * @property {TacticalTest|null} test
 * @property {HabitCode[]} traps                  habit traps standing on the board: 'greedy' and / or 'miss_threat' (§4.6.4)
 * @property {number} tension                     0..1
 *
 * @typedef {{assessment:MoveAssessment, facts:MoveFacts,
 *            replies:{move:MoveInfo, line:Line, outcome:MaterialOutcome, facts:MoveFacts}[]}} Assessed      result of the `assess` job
 *
 * @typedef {Object} OpponentTurn                 result of the `opponent` job
 * @property {MoveInfo} move
 * @property {MoveFacts} facts
 * @property {Line} line                          the rival's move and the continuation it expects
 * @property {TeachingChoice} choice
 * @property {{loss:number, cat:Cat}} quality     thresholds with k = 1
 * @property {number} childMoveCp                 value of the child's previous move, child's view: -scoreToCp(table.lines[0].score)
 * @property {number} evalAfter                   child's evaluation after the rival's move
 * @property {number} tension
 */

/** @typedef {{fen:string, history:string[], ply:number}} PositionPayload
 *    history = FENs of the game positions since the last capture, oldest first, excluding fen; ply = plies played */
/** @typedef {PositionPayload & {level:number, tensionPrev:number, evalTwoPliesAgo:number|null}} SurveyPayload */
/** @typedef {PositionPayload & {move:MoveRef, table:Analysis|null, level:number, compare:MoveRef|null}} AssessPayload     compare = TurnTruth.bestMove */
/** @typedef {PositionPayload & {ctx:TeachingContext, tensionPrev:number, evalTwoPliesAgo:number|null}} OpponentPayload */

/** @typedef {{bestMove:MoveRef, bestCp:number, depth:number, shown:boolean}} TurnTruth      pinned recommendation of one position (§5.3) */

// ---- 3.5 Teacher ----

/**
 * @typedef {Object} MoveSample                   one per confirmed child move; built by the director
 * @property {number} ply
 * @property {{move:MoveInfo, loss:number, cat:Cat}} first     the FIRST move tried this turn (the unassisted attempt)
 * @property {{move:MoveInfo, loss:number, cat:Cat}} final     the confirmed move
 * @property {number} tries                       tentative moves this turn (1 = confirmed the first idea)
 * @property {0|1|2|3} hint                       highest pouch opened BEFORE the first try
 * @property {0|1|2|3} hintMax                    highest pouch opened this turn
 * @property {boolean} self                       hintMax <= 1 (「自己想的」)
 * @property {number} bestCp                      scoreToCp of the best move, child's view
 * @property {number} legalCount
 * @property {{tier:1|2|3, kind:'win'|'save', found:boolean}|null} test
 * @property {DangerCode|null} danger             refutation.danger of the first try
 * @property {HabitCode|null} habit               HABIT_OF_DANGER of that danger (§4.1), when the first try was 'mistake' or 'blunder'
 * @property {HabitCode|null} avoided             a trap in Survey.traps the child did not fall into (§4.25.5)
 * @property {PatternCode[]} patterns             named patterns the confirmed move played
 * @property {PieceType|null} captured
 * @property {number} thinkMs                     active time
 */

/**
 * @typedef {Object} GameSkill                    per game; persisted in the save
 * @property {number} seed                        uint32
 * @property {MoveSample[]} samples               at most 300 kept
 * @property {number} n                           sum of sample weights
 * @property {number} accSum                      sum of w * acc
 * @property {number} shift                       -1.5..+1.5
 * @property {number} drift                       -3..+2
 * @property {number} easeRun  @property {number} pressRun
 * @property {number} aheadRun                    consecutive rival decisions with the child >= +600 before the move
 * @property {number} sinceChance                 rival moves since the last chance (99 at start)
 * @property {number} sinceBlunder                rival moves since the child's last confirmed 'blunder' (99 at start)
 * @property {'honest'|'variety'|'overlook'|'chance'|'concession'|'finisher'|null} lastKind
 * @property {number} spared                      forced mates the rival declined this game
 * @property {number} chances                     chances offered this game
 * @property {GameMark[]} marks                   one snapshot after every ply; undo restores the snapshot of the target ply
 * @property {number} [missRun]                   rival overlooks since his last proper move (CONTRACT-NOTES 124); absent = 0
 * @property {number} [lastRival]                 his last move as 1 + 90 * from + to, a square = row * 9 + col; absent or 0 = none
 * @typedef {{ply:number, n:number, accSum:number, shift:number, drift:number, easeRun:number, pressRun:number, aheadRun:number,
 *            sinceChance:number, sinceBlunder:number, lastKind:string|null, spared:number, chances:number, samples:number,
 *            missRun?:number, lastRival?:number}} GameMark
 */

/**
 * @typedef {Object} SkillProfile                 persisted in the profile
 * @property {1} v
 * @property {number} level                       1..9 (real)
 * @property {number} games                       finished games that counted
 * @property {{seen:number[], found:number[]}} tactics       three entries each (tiers 1..3), decayed
 * @property {number} streak                      +n wins in a row, -n losses in a row
 * @property {number} bandShift                   -60..+120 cp
 * @property {Record<string, number>} habits      HabitCode -> decayed count (x0.9 at each finished game, +1 per occurrence, capped 9)
 * @property {{at:number, result:'win'|'loss'|'draw', acc:number, n:number, level:number}[]} recent     last 10 games
 */

/**
 * @typedef {Object} TeachingContext
 * @property {number} level                       effectiveLevel
 * @property {2|4|6} reveal
 * @property {number} bandShift                   profile.bandShift + first-games bonus
 * @property {number} sinceChance  @property {number} sinceBlunder  @property {string|null} lastKind
 * @property {number} spared  @property {number} aheadRun  @property {number} chances
 * @property {number} moveNo                      1-based index of this rival move
 * @property {number} seed
 * @property {MoveRef|null} lastChildMove
 * @property {boolean} [lastChildCapture]         true when the child's last move captured a piece (CONTRACT-NOTES 104); absent = false
 * @property {number} [missRun]                   copied from the game record by teachingContext() (CONTRACT-NOTES 124); absent = 0
 * @property {number} [lastRival]                 copied from the game record by teachingContext(); absent or 0 = none
 * @property {boolean} firstGame                  profile.games === 0
 *
 * @typedef {Object} TeachingChoice
 * @property {MoveRef} move
 * @property {RootLine} line
 * @property {'press'|'spar'|'ease'|'finish'} mode
 * @property {'honest'|'variety'|'overlook'|'chance'|'concession'|'finisher'} kind
 * @property {number} loss                        cp given up against the true best move
 * @property {number} evalAfter                   child's evaluation after this move
 * @property {number} evalBest                    child's evaluation had the rival played its best move
 * @property {{gain:number, points:number, tier:1|2|3, revealDepth:number, line:Line}|null} chance        line = the child's winning continuation
 * @property {{gain:number, mate:boolean, line:Line}|null} overlooked                                  line = what the rival could have played
 */

/** @typedef {{kind:'highlight'|'lesson'|'pattern'|'progress', ply?:number, move?:MoveInfo, danger?:DangerCode, count?:number,
 *             pattern?:PatternCode, acc?:number, usual?:number, self?:boolean}} Takeaway */
/** @typedef {{profile:SkillProfile, delta:number, takeaways:Takeaway[]}} FinishResult */

export {};
