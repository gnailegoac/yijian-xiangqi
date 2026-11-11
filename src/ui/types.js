// UI typedefs (SPEC §3.11) and the controller typedefs of the UI modules (SPEC §4.28.1 - §4.28.7).
// No runtime code. Frozen after wave 0: a change here is a change to the build contract.
//
// `Mood` and `UiVerdict = Cat | 'pending'` are defined in ../core/codes.js, not here.
// The value returned by createRivalView (rival-view.js) and the result of computeLayout (layout.js)
// have no type name in the contract; refer to them with ReturnType<typeof ...>.

/** @import { Board, Color, Move, Piece, PieceType, Square } from '../core/types.js' */
/** @import { Mood } from '../core/codes.js' */
/** @import { Segment } from '../coach/types.js' */
/** @import { ChipSpec, CoachKind, CoachOffReason, MoveFlags, OverView, Phase, Settings } from '../game/types.js' */

// ---------------------------------------------------------------------------------------------------------------------
// §3.11 UI types
// ---------------------------------------------------------------------------------------------------------------------

/** @typedef {'chibi'|'longzhong'|'shachang'} ThemeId */
/** @typedef {'me'|'rival'} Actor */
/** @typedef {{from:Square, to:Square, style:'hint'|'idea'|'threat'|'reply'|'last', badge?:string, pieceType?:PieceType, demo?:boolean}} Arrow */
/** @typedef {{pieces?:Square[], squares?:Square[], dim?:boolean, ttl?:number}} Highlight */
/** @typedef {'landscape'|'portrait'|'compact'} LayoutMode */

// ---------------------------------------------------------------------------------------------------------------------
// §4.28.1 board-view.js
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} BoardView
 * @property {(board:Board, opts?:{lastMove?:Move|null, lastActor?:Actor, deal?:boolean}) => Promise<void>} setPosition
 *   Hard sync: cancels every animation, clears selection / trial / arrows / highlight / check, diffs pieces by id, snaps them.
 *   deal:true plays G1 and resolves when it ends.
 * @property {(bottom:Color) => void} setOrientation        re-labels files and re-seats pieces (no animation)
 * @property {(theme:ThemeId) => void} setTheme
 * @property {(on:boolean) => void} setInteractive
 * @property {(sq:Square|null, targets?:Move[], forbidden?:Move[]) => void} setSelection
 * @property {(move:Move, opts?:{aim?:boolean, liftStep?:number}) => Promise<void>} showTentative
 *   Starts or switches the trial (D1 / D1a / D3). aim = capturing trial. liftStep = how many child moves were played (pitch of trial.lift).
 *   Resolves when the piece hovers (or the reticle has locked).
 * @property {(ms:number, wobble?:boolean) => void} setTrialGuard      taps on the trial's destination are swallowed until `ms` after landing (default 200)
 * @property {(opts?:{reselect?:boolean, targets?:Move[], forbidden?:Move[]}) => Promise<void>} retractTentative     D4
 * @property {(opts:{flags:MoveFlags, soft?:boolean}) => Promise<void>} commitTentative                              D5 / D6, then E4 / E5 if flagged
 * @property {(move:Move, opts:{actor:Actor, flags:MoveFlags, soft?:boolean}) => Promise<void>} playMove             B + C, E1–E5
 * @property {(steps:Move[], board:Board) => Promise<void>} undoMoves     G2; steps newest first
 * @property {(sq:Square) => void} nudge                     A5
 * @property {(move:Move|null, actor?:Actor) => void} setLastMove
 * @property {(color:Color|null, checkers?:Square[]) => void} setCheck
 * @property {(arrows:Arrow[], opts?:{group?:string, replace?:boolean, ttl?:number}) => void} showArrows
 * @property {(group?:string) => void} clearArrows
 * @property {(h:Highlight|null) => void} highlight
 * @property {(moves:Move[], opts?:{stepMs?:number, from?:'now'|'trial'}) => Promise<void>} previewLine    F6
 * @property {(x:number) => void} setTension
 * @property {() => void} cancelAnimations
 * @property {(sq:Square) => {x:number, y:number}} squareCenter   CSS px relative to host
 * @property {() => number} cell
 * @property {(on:boolean) => void} setReducedMotion
 * @property {() => void} destroy
 */

// ---------------------------------------------------------------------------------------------------------------------
// §4.28.2 fx.js
// ---------------------------------------------------------------------------------------------------------------------

/** @typedef {{x:number, y:number}} Pt                 CSS px relative to .bv */
/** @typedef {'dust'|'ring'|'capture'|'explosion'|'sparks'|'splash'|'stars'|'trail'} BurstKind */
/** @typedef {'start'|'check'|'mate'|'stalemate'|'lose'|'draw'|'river'} BannerKind */

/**
 * @typedef {Object} Fx
 * @property {(el:HTMLElement) => void} mount                 called once by board-view with its .bv-fx element
 * @property {(kind:BurstKind, at:Pt, opts?:{n?:number, dir?:number, size?:number, color?:string, colors?:string[], scale?:number}) => void} burst
 * @property {(from:Pt, to:Pt) => void} trail
 * @property {(at:Pt) => void} slash
 * @property {(from:Pt, to:Pt, opts:{arc:number, ms:number}) => Promise<void>} projectile
 * @property {(opts?:{n?:number}) => void} confetti
 * @property {() => void} wind                                 fan-sweep streaks across the board (hint reveals)
 * @property {(level:1|2|3) => void} shake
 * @property {(ms:number) => void} hitStop
 * @property {(color:string, ms:number) => void} flash
 * @property {(kind:BannerKind, opts?:{tone?:'mine'|'danger'|'calm', avoid?:Pt}) => Promise<void>} banner     avoid = a point the band must not cover (the checked king)
 * @property {(text:string, at:Pt, opts?:{tone?:'good'|'great'|'brilliant'|'lord'|'mark'}) => void} popup
 * @property {(text:string, opts:{size:'full'|'small', at?:Pt}) => Promise<void>} stamp
 * @property {(kind:'tap'|'place'|'capture'|'blast'|'check'|'win'|'illegal') => void} haptic
 * @property {(cssW:number, cssH:number, c:number) => void} resize
 * @property {() => void} refreshPalette
 * @property {(on:boolean) => void} setReducedMotion
 * @property {(on:boolean) => void} setHaptics
 * @property {() => void} clear                                kills particles, projectile, banner, popup, stamp, shake; resolves pending promises
 * @property {number} live                                     live particle count (test hook)
 */

// ---------------------------------------------------------------------------------------------------------------------
// §4.28.3 audio.js, speech.js
// ---------------------------------------------------------------------------------------------------------------------

/** @typedef {'ui.tap'|'ui.open'|'ui.close'|'chat.tick'|'chat.send'|'chat.receive'|'select'|'deselect'|'illegal'|'place'
 *  |'move.rook'|'move.horse'|'move.cannon'|'move.elephant'|'move.advisor'|'move.king'|'move.pawn'|'river'|'capture'|'cannon.fire'|'blast'
 *  |'trial.lift'|'trial.retract'|'trial.confirm'|'check.give'|'check.take'|'check.soft'|'win'|'lose'|'draw'|'hint.1'|'hint.2'|'hint.3'
 *  |'fan.sweep'|'stamp'|'praise.good'|'praise.great'|'praise.brilliant'|'warn'|'arrow'|'undo'|'deal'|'turn.yours'} SfxName */

/**
 * @typedef {Object} AudioEngine
 * @property {() => Promise<boolean>} unlock            call inside a user gesture; idempotent; creates / resumes the AudioContext
 * @property {boolean} unlocked
 * @property {(name:SfxName, opts?:{when?:number, ms?:number, scale?:number, gain?:number, step?:number}) => void} play
 *   when: seconds from now; ms: travel time for move.*; scale: victim scale for 'capture'; step: scale degree for 'trial.lift'
 * @property {(x:number) => void} setTension
 * @property {{ start:() => void, stop:(fadeMs?:number) => void, setScene:(scene:'game'|'victory'|'defeat') => void }} music
 * @property {(on:boolean) => void} setSuspense         music low-passed to 1.6 kHz (only on held trials)
 * @property {(db:number, on:boolean) => void} duck
 * @property {(theme:ThemeId) => void} setPalette
 * @property {(muted:boolean) => void} setMuted
 * @property {(s:{sfx:boolean, music:boolean, volume:number}) => void} applySettings
 * @property {() => void} cancelScheduled               drops sounds scheduled with `when` that have not started
 * @property {(hidden:boolean) => void} setHidden       visibilitychange: suspend / resume
 * @property {() => void} dispose
 */

/** @typedef {{ supported:boolean, setEnabled:(on:boolean) => void, feed:(id:string, text:string) => void, flush:(id:string) => void,
 *              cancel:() => void, onSpeaking:(cb:(on:boolean) => void) => void }} Speech */

// ---------------------------------------------------------------------------------------------------------------------
// §4.28.4 buddy.js
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Buddy
 * @property {(mood:Mood, opts?:{hold?:number, instant?:boolean}) => void} setMood      hold: return to the base mood after `hold` ms
 * @property {(mood:Mood) => void} setBaseMood
 * @property {() => Mood} getMood
 * @property {(gesture:'nod'|'hop'|'shake'|'peek'|'point') => void} react
 * @property {(on:boolean) => void} setSpeaking
 * @property {(variant:'bust'|'full') => void} setVariant
 * @property {(on:boolean) => void} setReducedMotion
 * @property {Bubble} bubble
 * @property {() => void} destroy
 *
 * @typedef {Object} Bubble
 * @property {(msg:{id:string, cue?:string|null}) => HTMLElement} begin      clears the bubble; returns the text container for stream-text
 * @property {(cue:string|null, tone:'good'|'warn'|'neutral') => void} setTag
 * @property {(el:HTMLElement|null) => void} setQuestion                     the child's last question, shown small above the line
 * @property {() => HTMLElement} captionEl                                   container of the quiet caption line (a rival move's notation + motif word)
 * @property {(text:string) => void} status                                  one muted line, no tag (e.g. 对方正在想…)
 * @property {(label:string) => void} markStale                              dims the line and appends a tag (已换一步 / 已落子)
 * @property {(on:boolean) => void} setTyping                                three dots (shown 300 ms after begin if nothing arrived)
 * @property {() => void} clear
 */

// ---------------------------------------------------------------------------------------------------------------------
// §4.28.5 stream-text.js
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} StreamText
 * @property {(seg:Segment) => void} push
 * @property {(reason:'done'|'cut'|'aborted') => void} end      done / cut: flush the queue at once; aborted: DROP the queue; all remove the caret
 * @property {() => void} reset                                 remove everything shown and queued (refusal / replaced by local text)
 * @property {() => string} text
 * @property {() => void} dispose
 */

// ---------------------------------------------------------------------------------------------------------------------
// §4.28.6 chat-panel.js
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} ChatPanel
 * @property {(msg:{id:string, kind:CoachKind, cue?:string|null, target?:'bubble'|HTMLElement}) => void} begin
 * @property {(id:string, seg:Segment) => void} segment
 * @property {(id:string) => void} reset
 * @property {(id:string, end:{reason:'done'|'cut'|'aborted', source:'llm'|'local'|'mixed'|'none', stale?:string}) => void} end
 * @property {(id:string, t:{phase:'start'|'end', notation?:string}) => void} tool         shows / hides 亮在沙盘上摆一摆【…】……
 * @property {(segments:Segment[], opts?:{kind?:CoachKind, cue?:string|null, target?:'bubble'|HTMLElement}) => string} local
 * @property {(segments:Segment[]) => void} caption
 * @property {(text:string) => void} addChild
 * @property {(text:string) => void} addEvent                    a divider in the history log only (第 N 回合 · 对方 马8进7)
 * @property {(reason:'aborted') => void} endAll
 * @property {(chips:ChipSpec[]) => void} setChips
 * @property {(s:{visible:boolean, enabled:boolean}) => void} setInput
 * @property {(open:boolean, opts?:{focusInput?:boolean}) => void} setSheet       history / conversation sheet
 * @property {(l:{mode:LayoutMode, showChips:boolean, chipRows:number, kb:boolean}) => void} setLayout
 * @property {(on:boolean) => void} setTypeTicks
 * @property {() => void} clear
 * @property {(on:boolean) => void} setReducedMotion
 */

// ---------------------------------------------------------------------------------------------------------------------
// §4.28.7 hud.js
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Hud
 * @property {(p:{phase:Phase|'boot', canUndo:boolean, hintLevel:0|1|2|3, failed:boolean}) => void} setPhase
 * @property {(mine:Piece[], lost:Piece[]) => void} setTrophies
 * @property {(round:number) => void} setRound
 * @property {(muted:boolean) => void} setMuted
 * @property {() => void} beaconConfirm                 D8
 * @property {() => void} nudgeHint                     the 锦囊 control pulses once
 * @property {(opts:{hasSave:boolean, firstVisit:boolean, canImport:boolean}) => Promise<'continue'|'new'|'import'>} showStart
 * @property {(view:OverView) => { takeaway:HTMLElement, close:() => void }} showOver
 * @property {(settings:Settings, status:{mode:'llm'|'local', reason:CoachOffReason|null, rank:string}) => void} openSettings
 * @property {(rows:{n:number, red:string, black?:string}[], current:number) => void} setNotation
 * @property {(kind:'resign') => Promise<boolean>} confirm
 * @property {() => Promise<{humanColor:Color}|null>} newGameDialog
 * @property {(text:string, opts?:{ms?:number}) => void} toast
 * @property {(n:{kind:'engine-dead'}|null) => void} blocking
 * @property {() => void} closeAll
 */

export {};
