// src/coach/types.js (F0, frozen) — coach wire types, browser <-> proxy (contract section 3.6).
// JSDoc typedefs only: this module has no runtime code.
//
// Perspective is fixed: `me` = the child, `opp` = the rival. `cp` and `Net` are the child's view.
// Everything here is plain JSON.

/**
 * @import { Color, Square, MoveRef, MoveCode } from '../core/types.js'
 * @import { Cat, MotifCode, PatternCode, HabitCode, EndReason, AskCode, CueCode } from '../core/codes.js'
 */

/** @typedef {'me'|'opp'} Side */
/** @typedef {'K'|'A'|'E'|'H'|'R'|'C'|'P'} PT                 帅将 仕士 相象 马 车 炮 兵卒 */
/** @typedef {string} N                                       a move exactly as notation.js emits it; matches NOTATION_RE */
/** @typedef {{s:Side, t:PT, f:number, q?:'front'|'mid'|'back'}} WPiece
 *    f: file 1..9 in the owner's numbering (red 9 - col, black col + 1). q only when that side has two or more of this type on that file. */
/** @typedef {{gain:PT[], lose:PT[], cp:number}} Net          settled balance of a line measured from the thread's base position;
 *    gain = rival pieces the child takes, lose = child pieces taken (each <= 6); cp -9999..9999 */
/** @typedef {{first:Side, moves:N[], net:Net, end:'quiet'|'check'|'mate'}} WLine      1..6 moves, sides alternate starting with first */
/** @typedef {{b:'won'|'better'|'even'|'worse'|'lost', mate?:number}} Eval
 *    child's view with best play: won >= +600, better >= +150, even > -150, worse > -600, lost otherwise.
 *    mate > 0: the child mates in that many of their own moves; < 0: the child is mated; |mate| <= 9 */
/** @typedef {{k:MotifCode, by?:WPiece, on?:WPiece, on2?:WPiece, name?:PatternCode}} Effect
 *    by = acting piece; on = target; on2 = second target (fork), screen (cannon), guard (greedy), piece behind (pin) */
/** @typedef {'left'|'center'|'right'|'river'|'their_palace'|'my_palace'|'their_back'|'my_back'} Area      child's view */

/** @typedef {{n:number, s:Side, move:N, tag:'great'|'slip'|'missed'|'punished', k?:MotifCode}} Moment      n = move number floor(ply/2)+1 */
/** @typedef {{move:N, check:boolean, captured?:PT, does:Effect[], name?:PatternCode,
 *             quality:'strong'|'normal'|'soft'|'slip', punishes?:boolean, overlooked?:{on:WPiece, move:N}}} OppMove
 *    does <= 3, most important first. overlooked: the rival could have taken `on` with `move` and did not. */
/** @typedef {{k:MotifCode, by:WPiece, on?:WPiece, move:N, net:Net, sev:'pawn'|'piece'|'rook'|'mate', name?:PatternCode, prep?:true}} Threat
 *    move = the rival's move that carries the threat out. sev by gain: >= 800 rook, >= 300 piece, >= 100 pawn.
 *    prep (CONTRACT-NOTES 131): present, and true, only when `move` takes nothing and k / by / on describe the attack
 *    that stands after it, not one that stands now; a narrator then names the move and never says the attack is there. */

/**
 * @typedef {Object} TurnBrief                    the base brief of a thread; identical in every request of that thread
 * @property {number} ply                         0..600
 * @property {Color} me
 * @property {'opening'|'middle'|'endgame'} phase
 * @property {boolean} check                      the child is in check
 * @property {number} n                           legal moves of the child, 0..120
 * @property {null|'undo'|'reload'} back
 * @property {Eval} eval
 * @property {{me:string, opp:string, cp:number}} mat          e.g. "R2H2C2P5A2E2", /^(?:[RHCPAE][0-9]){0,6}$/
 * @property {number} level                       integer 1..9
 * @property {Moment[]} moments                   <= 6
 * @property {string[]} taught                    <= 8 motif / pattern codes already explained this game
 * @property {null|{move:N, cat:Cat, waited:boolean, self:boolean, try?:TryPacket}} mine
 *           the child's previous move; waited = false: confirmed before any comment; try = its packet with nothing withheld
 * @property {null|OppMove} opp
 * @property {Threat[]} threats                   <= 4, most severe first
 * @property {null|{size:'pawn'|'piece'|'rook'|'mate'|'position', theme:MotifCode, area:Area}} chance
 * @property {{threats:boolean, chance:boolean}} known
 *           threats: the list is complete for direct captures and mates in <= 3 by checks; chance: `chance === null` really means "none"
 */

/**
 * Events. The seven typedefs below carry the kind-specific fields of an event: they are what the director hands
 * to `Thread.open` and what the client builds for a hint, a try or an ask.
 *
 * Every event on the wire (`CoachEvent`, the element type of `CoachRequest.events`) carries in addition:
 *   i: number                             stable index in the thread, 0..63, strictly increasing
 *   cue?: CueCode                         the interjection already shown locally
 *   said?: 'llm'|'local'|'none'           how this event was answered; absent on the last event of a request
 *   reply?: {text:string, sig:string}     iff said === 'llm'
 *   v?: number                            0..15, iff said === 'local': the template variant, so the proxy can re-create the local line
 *   tools?: ToolRecord[]                  <= 3 past tool exchanges of this event
 *
 * @typedef {{kind:'start', first?:boolean}} StartEvent                    the child opens the game
 * @typedef {{kind:'opp'}} OppEvent                                          facts are in turn.opp / threats / chance
 * @typedef {{kind:'hint', level:1|2|3, hint:Hint1|Hint2|Hint3}} HintEvent
 * @typedef {{kind:'try', n:number, try:TryPacket}} TryEvent                 n = attempt number this turn, 1..40
 * @typedef {{kind:'ask', ask:AskCode, say?:string, more?:MorePacket}} AskEvent
 * @typedef {{kind:'over', over:OverPacket}} OverEvent
 * @typedef {{kind:'recap', recap:RecapPacket}} RecapEvent
 * @typedef {(StartEvent|OppEvent|HintEvent|TryEvent|AskEvent|OverEvent|RecapEvent)
 *           & {i:number, cue?:CueCode, said?:'llm'|'local'|'none', reply?:{text:string, sig:string}, v?:number, tools?:ToolRecord[]}} CoachEvent
 */

/** @typedef {{focus:'danger'|'chance'|'develop'|'improve'|'finish', theme:MotifCode}} Hint1
 *  @typedef {{piece:WPiece, area:Area, theme:MotifCode}} Hint2
 *  @typedef {{move:N, does:Effect[], line:WLine|null, alt?:N}} Hint3 */

/**
 * @typedef {Object} TryPacket
 * @property {N} move
 * @property {Cat} cat
 * @property {number} loss                        0..9999
 * @property {boolean} held                       concrete loss against the best reply; reply is withheld
 * @property {boolean} [only]                     the only move that avoids a serious loss
 * @property {boolean} [sac]                      a sound sacrifice
 * @property {boolean} [self]                     found with no pouch beyond the first
 * @property {boolean} [repeat]                   this move brings the position back a second time
 * @property {Eval} eval                          after this move, best play
 * @property {Effect[]} does                      <= 3
 * @property {Effect[]} flaws                     <= 2
 * @property {Net|null} cost                      settled outcome of the rival's best reply line; null when nothing changes hands
 * @property {WLine|null} reply                   rival's best reply line (first: 'opp'); ALWAYS null when held
 * @property {{area?:Area, theme?:MotifCode}|null} toward       abstract pointer to the better idea
 * @property {'taken'|'missed'|'none'} chance
 * @property {HabitCode} [habit]                  this slip matches a known habit (sent at most once per game)
 * @property {HabitCode} [avoided]                a known habit's trap was on the board and the child stepped around it
 * @property {'better'|'same'|'worse'} [vsPrev]
 */
/** @typedef {{reply?:WLine, better?:Alt[]}} MorePacket          withheld until the first follow-up; better: [] = nothing better found
 *  @typedef {{move:N, gain:number, does:Effect[], line:WLine|null}} Alt      gain 1..9999 */

/**
 * @typedef {Object} OverPacket
 * @property {'win'|'loss'|'draw'} result
 * @property {EndReason} reason
 * @property {number} moves                       moves the child played, 0..300
 * @property {{good:number, taken:number, captures:number, brilliant:number}} stats     only good things
 * @property {WTakeaway|null} takeaway            exactly one
 * @property {Moment|null} proud
 * @property {HabitCode|null} goal                the small goal for the next game
 * @property {boolean|null} kept                  last game's goal was kept (null = there was none)
 * @property {{to:number}|null} rank              only when the high-water rank rose; to 1..9
 * @typedef {{kind:'strength'|'habit'|'idea', code:string, n?:number, ex?:{n:number, move:N, better?:N}}} WTakeaway
 */
/** @typedef {{tries:{move:N, cat:Cat}[], hint:0|1|2|3, cur?:TryPacket}} RecapPacket       tries <= 8
 *  @typedef {{notation:N, after:N[], result:ToolResult}} ToolRecord
 *  @typedef {{id:string, ok:true, verdict:ToolVerdict}
 *          | {id:string, ok:false, error:'syntax'|'no_such_move'|'ambiguous'|'game_over'|'busy'|'limit', at?:number, candidates?:N[]}} ToolResult
 *  @typedef {{seq:N[], who:Side, cat:Cat, loss:number, eval:Eval, does:Effect[], flaws:Effect[], cost:Net|null,
 *             reply:WLine|null, vsTry?:'better'|'same'|'worse'}} ToolVerdict       seq = [...after, notation], 1..4 */
/** @typedef {{v:1, turn:TurnBrief, events:CoachEvent[], resume?:{token:string, results:ToolResult[]}}} CoachRequest */

/** @typedef {{type:'text', text:string} | {type:'move', notation:string, link:MoveLink}} Segment */
/** @typedef {{from:Square, to:Square, color:Color, code:MoveCode, pre:(MoveRef & {color:Color})[], playable:boolean,
 *             src:'opp'|'threat'|'try'|'reply'|'better'|'hint'|'tool'|'moment'|'mine'}} MoveLink
 *    pre = moves that lead to it inside its line (for numbered arrows and ghost play);
 *    playable = legal for the child in the base position */

export {};
