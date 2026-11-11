// Shared typedefs of the game layer: session (SPEC 3.7), tasks (3.8), persistence (3.9) and the three ports
// the director depends on (3.10). JSDoc only, no runtime code. Owner: F0 (frozen after wave 0).

/**
 * @import { Color, Square, Piece, Board, Move, MoveRef, MoveCode, GameStatus, PlyRecord,
 *           Analysis, PositionFacts, MoveFacts, Quick, ThreatInfo, Hint,
 *           SurveyPayload, AssessPayload, OpponentPayload,
 *           MoveSample, GameSkill, SkillProfile, TeachingContext, TeachingChoice, Takeaway, FinishResult } from '../core/types.js'
 * @import { Cat, EndReason, AskCode, HabitCode, PatternCode } from '../core/codes.js'
 * @import { Segment, MoveLink, TurnBrief, StartEvent, OppEvent, OverEvent, Hint1, Hint2, Hint3,
 *           TryPacket, MorePacket } from '../coach/types.js'
 * @import { MoveBook } from '../coach/book.js'
 * @import { GameMemory } from '../coach/memory.js'
 * @import { Arrow, Highlight } from '../ui/types.js'
 */

// ---------------------------------------------------------------------------------------------------------------
// 3.7 Session
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {'childTurn'|'selected'|'tentative'|'opponentTurn'|'over'} Phase */
/** @typedef {{winner:Color|null, reason:EndReason}} GameResult                winner null = draw */
/** @typedef {{check:boolean, mate:boolean, checkedKing:Square|null, checkers:Square[], crossed:boolean}} MoveFlags */
/**
 * @typedef {Object} Ply
 * @property {Move} move  @property {Color} color  @property {'child'|'opponent'} by
 * @property {string} notation                    computed at commit
 * @property {Board} before                       board before the move
 * @property {PlyRecord} record
 * @property {MoveFlags} flags
 *
 * @typedef {Object} Trial
 * @property {number} id                          trialId
 * @property {Move} move
 * @property {Board} board                        board after the trial move (the committed board is untouched)
 * @property {string} notation
 * @property {GameStatus} status                  status after the trial
 * @property {MoveFlags} flags
 * @property {'ok'|'repeat'|'draw'} repeat        engine.judgeMove result ('forbidden' moves cannot become trials)
 * @property {number} startedAt
 *
 * @typedef {Object} SessionState                 read-only for everyone but session.js
 * @property {string} id                          "g-" + 8 base36 chars
 * @property {number} gameId                      +1 on newGame() and restore()
 * @property {number} positionId                  +1 on every change of the committed position or of the result; never reset
 * @property {number} trialId                     +1 for every trial created; never reset
 * @property {Phase} phase
 * @property {Board} board  @property {Color} turn  @property {Color} humanColor
 * @property {Ply[]} history
 * @property {string} startKey                    positionKey of the start position
 * @property {number} drawFrom                    plies before this index are ignored by draw rules (migrated v1 games)
 * @property {Square|null} selected
 * @property {Move[]} targets                     playable moves of the selected (or trial) piece from its origin
 * @property {Move[]} forbidden                   moves of that piece refused by the perpetual-check rule
 * @property {Trial|null} trial
 * @property {{level:0|1|2|3}} hint               pouches opened on this position
 * @property {{tries:number, first:MoveRef|null, hintAtFirst:0|1|2|3}} attempt      this turn's trial bookkeeping
 * @property {GameResult|null} result
 * @property {boolean} check  @property {Square[]} checkers       side to move is in check, and by whom
 * @property {boolean} opponentFailed
 * @property {boolean} counted                    statistics already updated for this game
 * @property {number} startedAt  @property {number|null} endedAt  @property {number} turnStartedAt
 */
/** @typedef {{game:number, position:number, trial:number}} Scope             trial = active trial id, or 0 */
/** @typedef {{ok:true} | {ok:false, reason:Refusal}} Result */
/** @typedef {'over'|'not-your-turn'|'wrong-phase'|'not-yours'|'no-moves'|'not-a-target'|'empty'|'perpetual-check'|'trial-active'
 *           |'illegal'|'stale'|'nothing-to-undo'} Refusal */
/** @typedef {{type:'scope', scope:Scope}
 *   | {type:'game:start', reason:'new'|'restore', truncatedAt:number|null}
 *   | {type:'child:turn', cause:'new'|'restore'|'opponent-move'|'undo'}
 *   | {type:'opponent:turn', retry:boolean}
 *   | {type:'opponent:failed'}
 *   | {type:'selection'}
 *   | {type:'trial:start', trial:Trial, replaced:boolean}
 *   | {type:'trial:end', trial:Trial, reason:'retract'|'replaced'|'newgame'|'resign'}
 *   | {type:'move:committed', ply:Ply, index:number, by:'child'|'opponent', trialId:number}
 *   | {type:'hint', level:1|2|3}
 *   | {type:'undo', plies:number, unresigned:boolean, steps:Move[]}
 *   | {type:'game:over', result:GameResult}
 *   | {type:'change', cause:string, persist:boolean}} SessionEvent */

// ---------------------------------------------------------------------------------------------------------------
// 3.8 Tasks
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {'game'|'position'|'trial'} Lifetime */
/** @typedef {'cancelled'|'superseded'|'timeout'|'error'} FailReason */
/** @template T @typedef {{ok:true, value:T} | {ok:false, reason:FailReason, error?:Error}} Outcome */
/** @template T @typedef {{id:number, done:Promise<Outcome<T>>, cancel:() => void, alive:() => boolean, signal?:AbortSignal}} TaskHandle
 *    done never rejects; alive() is false as soon as the task is cancelled or settled (synchronously) */
/** @typedef {{kind:'survey'|'assess'|'opponent'|'analyze', payload:any, lifetime:Lifetime, timeoutMs:number, tool?:boolean,
 *             onProgress?:(stage:'facts'|'table'|'threat', data:any) => void}} JobSpec       tool = started by the LLM tool executor */
/** @typedef {{lifetime:Lifetime, channel?:string, timeoutMs?:number, idleMs?:number}} RunSpec */
/** @typedef {{signal:AbortSignal, alive:() => boolean, gate:<F extends Function>(fn:F) => F, touch:() => void}} RunContext */

// ---------------------------------------------------------------------------------------------------------------
// 3.9 Persistence
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Settings                     key 'yijian.xiangqi.v2.settings'
 * @property {2} schema
 * @property {'chibi'|'longzhong'|'shachang'} theme      default 'chibi'
 * @property {boolean} sfx                        default true
 * @property {boolean} music                      default true
 * @property {number}  volume                     default 1.0, clamped 0..1
 * @property {'auto'|'full'|'reduced'} motion     default 'auto' (follow prefers-reduced-motion)
 * @property {boolean} haptics                    default true
 * @property {boolean} typeTicks                  default false
 * @property {boolean} readAloud                  default false
 * @property {'red'|'black'} side                 default 'red'; applies from the next game
 * @property {'auto'|'local'} coach               default 'auto'; 'local' never touches the network
 * @property {boolean} freeText                   default true
 * @property {'smart'|'more'} talk                default 'smart'; 'more' = a spoken line on every rival move and every trial
 *
 * @typedef {Object} Profile                      key 'yijian.xiangqi.v2.profile'
 * @property {2} schema
 * @property {SkillProfile} skill
 * @property {{played:number, won:number, lost:number, drawn:number}} games
 * @property {number} rank                        high-water mark of round(skill.level), 1..9; never decreases
 * @property {{code:HabitCode, setAt:number}|null} goal       the small goal agreed at the end of the last game
 * @property {boolean} introSeen
 * @property {number} createdAt
 *
 * @typedef {Object} SavedGame                    key 'yijian.xiangqi.v2.game'
 * @property {2} schema
 * @property {string} id                          /^g-[a-z0-9]{6,16}$/
 * @property {Color} humanColor
 * @property {MoveCode[]} moves                   at most 2000 accepted on load, at most 600 produced by play
 * @property {{winner:Color, reason:'resign'}|null} result       only a resignation is stored; natural results are recomputed
 * @property {number} startedAt  @property {number|null} endedAt     epoch ms
 * @property {number} activeMs                    visible play time
 * @property {boolean} counted
 * @property {number} drawFrom                    0 for games started in v2; moves.length at migration for v1 games
 * @property {number} seed                        uint32
 * @property {object|null} skill                  GameSkill (sanitised by teacher.reviveGameSkill)
 * @property {object|null} memory                 GameMemory.toJSON() (sanitised by memory.createGameMemory)
 * @property {null} start                         reserved; anything but null is treated as "newer"
 */
/** @typedef {{kind:'yijian-backup', v:1, at:number, game:SavedGame|null, profile:Profile, settings:Settings}} Backup */
/** @typedef {'storage-unavailable'|'game-corrupt'|'game-newer'|'game-truncated'|'migrated-v1'|'migrated-v1-local'|'imported'|'import-failed'} Notice */

// ---------------------------------------------------------------------------------------------------------------
// 3.10 Ports (what the director depends on)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} BrainPort                    adapter over src/core/* (built by ports.js)
 * -- synchronous, main thread --
 * @property {(fen:string, opts?:{ply?:number}) => PositionFacts} positionFacts
 * @property {(fen:string, move:MoveRef, opts?:{ply?:number, before?:PositionFacts}) => MoveFacts} moveFacts
 * @property {(table:Analysis|null, move:MoveRef, level:number) => Quick|null} quickVerdict
 * @property {(input:{fen:string, ply:number, table:Analysis, move:MoveRef, facts:PositionFacts, threat:ThreatInfo|null}) => Hint} hintFor
 * @property {(startFen:string, moves:MoveRef[]) => {red:PatternCode|null, black:PatternCode|null}} openingName
 * @property {(board:Board, turn:Color) => string} boardToFen
 * -- teacher, pure --
 * @property {(seedLevel?:number) => SkillProfile} createSkillProfile
 * @property {(raw:unknown) => SkillProfile} migrateSkillProfile
 * @property {(seed:number) => GameSkill} createGameSkill
 * @property {(raw:unknown, seed:number) => GameSkill} reviveGameSkill
 * @property {(profile:SkillProfile, game:GameSkill, sample:MoveSample) => GameSkill} recordChildMove
 * @property {(game:GameSkill, ply:number, choice:TeachingChoice) => GameSkill} recordOpponentMove
 * @property {(game:GameSkill, ply:number) => GameSkill} rewindGameSkill
 * @property {(profile:SkillProfile, game:GameSkill) => number} effectiveLevel
 * @property {(profile:SkillProfile, tier:1|2|3) => number} findRate
 * @property {(profile:SkillProfile, game:GameSkill, extra:{moveNo:number, lastChildMove:MoveRef|null, lastChildCapture?:boolean}) => TeachingContext} teachingContext
 * @property {(profile:SkillProfile, game:GameSkill, result:'win'|'loss'|'draw') => FinishResult} finishGame
 * @property {(game:GameSkill, result:'win'|'loss'|'draw', profile:SkillProfile) => Takeaway[]} gameTakeaways
 * -- worker jobs: each returns a JobSpec without lifetime; the director adds the lifetime --
 * @property {(p:SurveyPayload) => Omit<JobSpec,'lifetime'>} surveyJob
 * @property {(p:AssessPayload) => Omit<JobSpec,'lifetime'>} assessJob
 * @property {(p:OpponentPayload) => Omit<JobSpec,'lifetime'>} opponentJob
 * @property {(speedClass:'fast'|'mid'|'slow') => void} setSpeed       selects the plan row used for timeoutMs
 */

/** @typedef {'auto'|'local'|'silent'} SayMode       auto = LLM when online, else local; silent = record the event, say nothing */
/** @typedef {{onStart?:(s:{cue:string|null}) => void, onSegment?:(seg:Segment) => void, onSentence?:(text:string) => void,
 *             onReset?:() => void, onTool?:(t:{phase:'start'|'end', notation?:string, link?:MoveLink}) => void,
 *             onEnd?:(r:ReplyResult) => void}} Handlers */
/** @typedef {{aborted:true} | {aborted:false, text:string, segments:Segment[], source:'llm'|'local'|'mixed'|'none',
 *             cut:boolean, refused:boolean, usage?:{in:number, cached:number, out:number}}} ReplyResult */
/** @typedef {{id:number, done:Promise<ReplyResult>, abort:() => void}} Reply          done never rejects */
/** @typedef {{signal?:AbortSignal, flags?:{earned?:boolean, voiced?:boolean, lord?:boolean}}} ReplyOpts      flags feed cueFor (§8.7) */
/**
 * @typedef {Object} Thread
 * @property {'turn'|'over'} kind
 * @property {(ev:StartEvent|OppEvent|OverEvent, mode:SayMode, h:Handlers, opts?:ReplyOpts) => Reply} open      the thread's first event
 * @property {(level:1|2|3, packet:Hint1|Hint2|Hint3, mode:SayMode, h:Handlers, opts?:ReplyOpts) => Reply} hint
 * @property {(packet:TryPacket, more:MorePacket, mode:SayMode, h:Handlers, opts?:ReplyOpts) => Reply} tryMove
 * @property {(code:AskCode, say:string|undefined, h:Handlers, opts?:ReplyOpts) => Reply} ask
 * @property {() => void} interrupt               abort the in-flight reply; the event stays (said 'none' unless its text completed)
 * @property {() => void} retract                 换一步: interrupt + mark the active try withdrawn
 * @property {() => void} end                     确定落子: interrupt + close
 * @property {() => TryPacket|null} activeTry
 * @property {() => boolean} busy
 *
 * @typedef {'unknown'|'online'|'offline'|'paused'} CoachStatus
 * @typedef {'no_proxy'|'no_key'|'origin'|'unreachable'|'setting'|'paused'|'version'} CoachOffReason
 *
 * @typedef {Object} CoachPort                    adapter over src/coach/* (built by ports.js)
 * @property {() => CoachStatus} status
 * @property {() => 'llm'|'local'} mode           'llm' while status is 'online' or 'unknown' with an apiBase, else 'local'
 * @property {() => CoachOffReason|null} offReason
 * @property {(fn:(s:{mode:'llm'|'local', reason:CoachOffReason|null}) => void) => () => void} onMode
 * @property {() => Promise<void>} probe
 * @property {() => {freeText:boolean}} capabilities
 * @property {(turn:TurnBrief, book:MoveBook, opts?:{signal?:AbortSignal}) => Thread} beginTurn        no request is sent
 * @property {(turn:TurnBrief, book:MoveBook, opts?:{signal?:AbortSignal}) => Thread} beginOver
 * @property {() => void} reset                   abort everything, bump the epoch; called on undo / restart / load
 * @property {typeof import('../coach/brief.js')} brief           buildTurnBrief, oppCaption, buildTryPacket, buildHintPacket, buildOverPacket, isEarned, worthSpeaking, chanceAreaWord
 * @property {(base:{board:Board, turn:Color}) => MoveBook} createMoveBook
 * @property {(saved:unknown) => GameMemory} createGameMemory
 * @property {(text:string, book:MoveBook) => Segment[]} parse       markup.parseCoachText, for director-originated local lines
 */

/** @typedef {{board:Board, bottom:Color, lastMove:Move|null, lastBy:'child'|'opponent'|null, check:Color|null, checkers:Square[],
 *             round:number, trophies:{mine:Piece[], lost:Piece[]}}} StageView */
/** @typedef {{cat:Cat|'pending', final:boolean, held:boolean, voiced:boolean, earned:boolean, focus:Square[]}} VerdictView
 *    focus = the attacker square(s) the child may tap to answer a voiced guiding question */
/** @typedef {{tier:'good'|'great'|'brilliant'|'lord', streak:number}} Praise */
/** @typedef {{move:Move, notation:string, flags:MoveFlags, fromTrial:boolean, cat:Cat|null, praise:Praise|null,
 *             stamp:{text:string, size:'full'|'small'}|null, self:boolean, softCheck:boolean, view:StageView}} CommitView */
/** @typedef {{move:Move, notation:string, flags:MoveFlags, caption:Segment[], lostBig:boolean, softCheck:boolean, view:StageView}} RivalMoveView */
/** @typedef {{result:'win'|'loss'|'draw', reason:EndReason, byChildMate:boolean, stats:{rounds:number, captures:number, brilliant:number},
 *             proud:{before:Board, move:Move, notation:string, self:boolean}|null, rank:{to:number, name:string}|null,
 *             goal:string|null, kept:boolean|null, quiet:boolean}} OverView      quiet = a finished game was restored: the card only, no celebration */
/** @typedef {{pieces?:Square[], squares?:Square[], move?:MoveRef}} HintFocus */
/** @typedef {{id:string, label:string, ask?:AskCode, action?:'retract'|'confirm'|'takeback'|'write'|'pouch', primary?:boolean}} ChipSpec */
/** @typedef {'calm'|'thinking'|'frown'|'rattled'|'smug'} RivalMood */
/** @typedef {'start'|'opp'|'hint'|'try'|'ask'|'over'|'system'} CoachKind */

/**
 * @typedef {Object} StagePort                    implemented by src/ui/stage.js; every Promise always resolves
 * -- lifecycle --
 * @property {(info:{hasSave:boolean, firstVisit:boolean, canImport:boolean}) => Promise<'continue'|'new'|'import'>} start     the start overlay
 * @property {(view:StageView, opts:{deal:boolean}) => Promise<void>} reset
 * @property {(p:{phase:Phase, canUndo:boolean, hintLevel:0|1|2|3, canAsk:boolean, failed:boolean, ply:number}) => void} phase
 * -- board moments --
 * @property {(sq:Square|null, targets:Move[], forbidden:Move[]) => void} selected
 * @property {(sq:Square, reason:Refusal, streak:number) => void} rejected            streak = consecutive refusals
 * @property {(move:Move, info:{notation:string, aim:boolean}) => Promise<void>} tentative
 * @property {(v:VerdictView) => void} verdict
 * @property {(info:{reselect:boolean, targets:Move[], forbidden:Move[]}) => Promise<void>} retracted
 * @property {(info:CommitView) => Promise<void>} committed
 * @property {(info:RivalMoveView) => Promise<void>} rivalMoved
 * @property {(info:{steps:Move[], view:StageView}) => Promise<void>} undone
 * @property {(step:1|2|3, focus:HintFocus) => void} hint
 * @property {(x:number) => void} tension
 * @property {(r:{mood:RivalMood, line?:string}) => void} rival
 * @property {(info:OverView) => Promise<void>} over                                 resolves when the card is up
 * -- see-first helpers --
 * @property {(arrows:Arrow[], opts?:{group?:string, ttl?:number}) => void} arrows
 * @property {(group?:string) => void} clearArrows
 * @property {(h:Highlight|null) => void} highlight
 * @property {(moves:Move[], opts:{from:'now'|'trial'}) => Promise<void>} preview     ghost play (F6)
 * -- strategist text --
 * @property {(msg:{id:string, kind:CoachKind, cue?:string|null, target?:'bubble'|'card'}) => void} coachBegin
 * @property {(id:string, seg:Segment) => void} coachSegment
 * @property {(id:string) => void} coachReset
 * @property {(id:string, end:{reason:'done'|'cut'|'aborted', source:'llm'|'local'|'mixed'|'none', stale?:string}) => void} coachEnd
 * @property {(id:string, t:{phase:'start'|'end', notation?:string, link?:MoveLink}) => void} coachTool
 * @property {(segments:Segment[], opts?:{kind?:CoachKind, cue?:string|null, target?:'bubble'|'card'}) => string} coachLocal     returns the message id
 * @property {(segments:Segment[]) => void} caption                                  one quiet line with no cue (rival move caption, status)
 * @property {(text:string) => void} childSaid
 * @property {(chips:ChipSpec[]) => void} chips
 * @property {(s:{visible:boolean, enabled:boolean}) => void} input
 * @property {(m:{mode:'llm'|'local', reason:CoachOffReason|null}) => void} coachMode
 * @property {() => void} beacon                                                    pulse 确定落子 once
 * -- misc --
 * @property {(text:string) => void} toast
 * @property {(text:string) => void} announce                                       aria-live
 * @property {(kind:'resign'|'new-game') => Promise<any>} dialog                    resign -> boolean; new-game -> {humanColor:Color}|null
 * @property {(rows:{n:number, red:string, black?:string}[], current:number) => void} notation
 * @property {(n:{kind:'engine-dead'}|null) => void} blocking
 * @property {() => void} settle                                                    finish every animation now, drop scheduled sounds, cancel speech
 * @property {(s:Settings) => void} applySettings
 * @property {(h:StageHandlers) => void} on
 *
 * @typedef {Object} StageHandlers                 user intents; the stage never decides what they mean
 * @property {(row:number, col:number, via:'tap'|'drag'|'key') => void} tap
 * @property {() => void} confirm  @property {() => void} retract  @property {() => void} undo  @property {() => void} hint
 * @property {(q:{code?:AskCode, text?:string}) => void} ask
 * @property {(chip:ChipSpec) => void} chip                         chips with an `action`
 * @property {(link:MoveLink, active:boolean) => void} moveLink
 * @property {(links:MoveLink[]) => void} playLine
 * @property {() => void} newGame  @property {() => void} resign  @property {() => void} retryOpponent  @property {() => void} retryEngine
 * @property {(key:keyof Settings, value:any) => void} setting
 * @property {() => void} exportRecord  @property {() => void} exportBackup  @property {(text:string) => void} importBackup
 * @property {() => void} stopCoach
 * @property {() => void} activity                                  any pointer or key input (idle timers)
 */

export {};
