// Director (SPEC 4.25): the only orchestrator. Imports src/game/* and codes.js; everything else arrives through the
// three ports. No DOM, no `window`: timers are injected. State and rules: SPEC 4.25.1-4.25.7; effect scripts: SPEC 5.8.
// Owner: G4.
// F0 stub: final signatures, no behaviour yet.

/**
 * @import { GameSkill } from '../core/types.js'
 * @import { SessionEvent, SessionState, SavedGame, Settings, Profile, Notice,
 *           BrainPort, CoachPort, StagePort, StageHandlers } from './types.js'
 * @import { Session } from './session.js'
 * @import { Store } from './store.js'
 * @import { createTasks } from './tasks.js'
 */

/**
 * @param {{ session:Session, tasks:ReturnType<typeof createTasks>, store:Store, brain:BrainPort, coach:CoachPort, stage:StagePort,
 *           profile:Profile, settings:Settings, save:() => void,
 *           rng:() => number, now:() => number, setTimer:typeof setTimeout, clearTimer:typeof clearTimeout,
 *           isHidden?:() => boolean, reload?:() => void }} deps
 *        reload: the injected `location.reload()` used after a successful importBackup (SPEC 4.25.7)
 * @returns {Director}
 */
export function createDirector(deps) {
  throw new Error('not implemented');
}

/**
 * @typedef {Object} Director
 * @property {(event:SessionEvent, state:SessionState) => void} onEvent       the session subscriber (scripts of §5.4)
 * @property {() => {seed:number, skill:GameSkill, memory:object, activeMs:number}} extras       merged into the save by app.js
 * @property {(saved:SavedGame|null) => void} loadExtras                      before session.restore / newGame
 * @property {(settings:Settings) => void} applySettings
 * @property {(notices:Notice[], info:{truncatedAt:number|null}) => void} notices
 * @property {(visible:boolean) => void} visibility                           pauses the active-time clock and idle timers
 * @property {StageHandlers} actions                                          registered with stage.on(...)
 * @property {() => void} dispose
 */
