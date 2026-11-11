// Ports (SPEC 4.24): adapters from the real modules to BrainPort / CoachPort. Adapters only; no logic beyond shape
// conversion (plus the LLM tool executor `analyzeMove` described in SPEC 4.24). Owner: G4.
// F0 stub: final signatures, no behaviour yet.

/**
 * @import { BrainPort, CoachPort, SessionState } from './types.js'
 * @import { createTasks } from './tasks.js'
 */

/**
 * facts.js, teacher.js, notation.js, engine.js, brain.js (PLAN) behind the BrainPort of §3.10
 * @returns {BrainPort}
 */
export function createBrainPort() {
  throw new Error('not implemented');
}

/**
 * client.js + brief.js + book.js + memory.js + fallback/lexicon cue text + the tool executor
 * @param {{apiBase:string|null, forceLocal:boolean, tasks:ReturnType<typeof createTasks>, brain:BrainPort, getSession:() => SessionState}} deps
 * @returns {CoachPort}
 */
export function createCoachPort(deps) {
  throw new Error('not implemented');
}
