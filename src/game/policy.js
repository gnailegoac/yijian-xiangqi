// Policy (SPEC 4.22): pure budget rules; every number of D-30..D-45 lives here. Owner: G5.
//
// No DOM, no clock, no timer, no randomness of its own (rivalThinkMs takes the director's seeded generator).
//
// A Budgets record is one plain object per game, owned by the director. Who changes which counter:
//   - afterHeld, praiseFor and stampFor update the record they are given (ignored / silentUntil / ownWayTold;
//     streak / lastPopupAt / brilliantPopups; stamps), because their results carry no room for the new values.
//     afterHeld returns that same record as `b`.
//   - every other function only reads. The counters the director's scripts change themselves (SPEC 5.8) are
//     questions, lastQuestionAt, takebacks, idleOffers, idleDeclined, lastCheckPly, firstTrialTold, rivalLineAt.

import { TACTIC_MOTIFS, STAMP_PATTERNS, PATTERN_NAME } from '../core/codes.js';

/**
 * @import { TeachingChoice } from '../core/types.js'
 * @import { Cat, MotifCode, PatternCode } from '../core/codes.js'
 * @import { TurnBrief, TryPacket } from '../coach/types.js'
 * @import { Phase, Settings, Praise, CommitView } from './types.js'
 */

/**
 * @typedef {Object} Budgets                     per game, in memory only (reset on new game and on reload)
 * @property {number} questions                  voiced guiding questions so far (max 6)
 * @property {number} lastQuestionAt             child move number of the last one (-99 at start)
 * @property {number} ignored                    voiced questions the child confirmed through, in a row
 * @property {number} silentUntil                child move number from which questions may be voiced again
 * @property {boolean} ownWayTold
 * @property {number} lastPopupAt                child move number of the last praise popup (-99)
 * @property {number} brilliantPopups            max 2
 * @property {number} streak                     consecutive earned child moves
 * @property {number} takebacks                  悔一步重想 offers made (max 3)
 * @property {number} idleOffers                 max 2
 * @property {boolean} idleDeclined
 * @property {string[]} stamps                   pattern codes already stamped at full size
 * @property {number} lastCheckPly               ply of the last check on the board (-99)
 * @property {boolean} firstTrialTold
 * @property {number} rivalLineAt                rival move number of his last spoken line (-99)
 */

/** @returns {Budgets} */
export function createBudgets() {
  return {
    questions: 0,
    lastQuestionAt: -99,
    ignored: 0,
    silentUntil: 0,
    ownWayTold: false,
    lastPopupAt: -99,
    brilliantPopups: 0,
    streak: 0,
    takebacks: 0,
    idleOffers: 0,
    idleDeclined: false,
    stamps: [],
    lastCheckPly: -99,
    firstTrialTold: false,
    rivalLineAt: -99,
  };
}

/**
 * K1. A spoken sentence about the rival's move only when it matters (always when talk === 'more').
 * With no rival move in the brief (the child opens, or the brief was rebuilt without one) only the talk setting,
 * the first plies, an announced chance and a threat of a piece or more can ask for a sentence.
 * @param {TurnBrief} turn
 * @param {Settings['talk']} talk
 * @returns {boolean}
 */
export function shouldSpeakOpp(turn, talk) {
  const opp = turn.opp;
  return talk === 'more' || turn.ply < 4
      || (opp !== null && (!!opp.captured || opp.check || !!opp.punishes || !!opp.name || !!opp.overlooked))
      || turn.chance !== null || turn.threats.some(t => t.sev !== 'pawn');
}

/**
 * M4. Announce a chance only to a child who would not find it alone.
 * @param {TeachingChoice['chance']} chance
 * @param {number} findRateOfTier
 * @returns {boolean}
 */
export function announceChance(chance, findRateOfTier) {
  return chance !== null && findRateOfTier < 0.35;
}

/**
 * M1. Whether a held trial gets the spoken guiding question.
 * A mate against the child or a loss of 800 cp or more is always voiced; anything else at most once per four
 * child moves, six times a game, and not before `silentUntil`. Reads the budgets only: the director counts the
 * question (questions += 1, lastQuestionAt = childMoveNo) when it voices one.
 * @param {TryPacket} packet
 * @param {Budgets} b
 * @param {number} childMoveNo
 * @returns {boolean}
 */
export function voiceHeld(packet, b, childMoveNo) {
  const severe = (packet.eval.mate ?? 0) < 0 || (packet.cost !== null && packet.cost.cp <= -800);
  if (severe) return true;
  return b.questions < 6 && childMoveNo - b.lastQuestionAt >= 4 && childMoveNo >= b.silentUntil;
}

/**
 * After a held trial ended.
 *  confirmed after a voiced question: ignored += 1; at 2: sayOwnWay (once per game), silentUntil = childMoveNo + 4, ignored = 0.
 *  retracted: ignored = 0.
 * Updates `b` in place and returns it.
 * @param {Budgets} b
 * @param {'confirmed'|'retracted'} how
 * @param {boolean} voiced
 * @param {number} childMoveNo
 * @returns {{b:Budgets, sayOwnWay:boolean}}
 */
export function afterHeld(b, how, voiced, childMoveNo) {
  let sayOwnWay = false;
  if (how === 'retracted') {
    b.ignored = 0;
  } else if (voiced) {
    b.ignored += 1;
    if (b.ignored >= 2) {
      sayOwnWay = !b.ownWayTold;
      b.ownWayTold = true;
      b.silentUntil = childMoveNo + 4;
      b.ignored = 0;
    }
  }
  return { b, sayOwnWay };
}

/**
 * M2.
 *  not earned -> null (and streak = 0). earned -> streak += 1; popup only if childMoveNo - lastPopupAt >= 4.
 *  tier: cat 'brilliant' and brilliantPopups < 2 -> 'brilliant'; else found && hintMax === 0 -> 'lord';
 *        else does[0] in TACTIC_MOTIFS -> 'great'; else 'good'.
 * Updates `b`: streak always; lastPopupAt (and brilliantPopups for the 'brilliant' tier) when a popup is returned.
 * @param {{earned:boolean, cat:Cat|null, found:boolean, hintMax:0|1|2|3, lead:MotifCode|undefined}} info
 * @param {Budgets} b
 * @param {number} childMoveNo
 * @returns {Praise|null}
 */
export function praiseFor(info, b, childMoveNo) {
  if (!info.earned) {
    b.streak = 0;
    return null;
  }
  b.streak += 1;
  if (childMoveNo - b.lastPopupAt < 4) return null;

  /** @type {Praise['tier']} */
  let tier;
  if (info.cat === 'brilliant' && b.brilliantPopups < 2) {
    tier = 'brilliant';
    b.brilliantPopups += 1;
  } else if (info.found && info.hintMax === 0) {
    tier = 'lord';
  } else if (info.lead !== undefined && TACTIC_MOTIFS.includes(info.lead)) {
    tier = 'great';
  } else {
    tier = 'good';
  }
  b.lastPopupAt = childMoveNo;
  return { tier, streak: b.streak };
}

/**
 * M14. First of [openingChange, ...patterns] that is in STAMP_PATTERNS -> {text: PATTERN_NAME + '！', size: stamps.includes(code) ? 'small' : 'full'}.
 * Nothing to stamp -> null. A pattern stamped at full size is added to `b.stamps`.
 * @param {PatternCode[]} patterns
 * @param {PatternCode|null} openingChange
 * @param {Budgets} b
 * @returns {CommitView['stamp']}
 */
export function stampFor(patterns, openingChange, b) {
  const candidates = openingChange === null ? patterns : [openingChange, ...patterns];
  const code = candidates.find(c => STAMP_PATTERNS.includes(c));
  if (code === undefined) return null;
  const stamped = b.stamps.includes(code);
  if (!stamped) b.stamps.push(code);
  return { text: PATTERN_NAME[code] + '！', size: stamped ? 'small' : 'full' };
}

/**
 * m9. forced reply or recapture: 300 + 150·rnd; in trouble (child >= +400): 1400; else 600 + 300·rnd; reduced motion: 300.
 * Reduced motion wins over everything; a forced reply or a recapture wins over trouble. `rnd` is called only where
 * the result uses it.
 * @param {{forced:boolean, recapture:boolean, trouble:boolean, reduced:boolean}} info
 * @param {() => number} rnd
 * @returns {number}
 */
export function rivalThinkMs(info, rnd) {
  if (info.reduced) return 300;
  if (info.forced || info.recapture) return 300 + 150 * rnd();
  if (info.trouble) return 1400;
  return 600 + 300 * rnd();
}

/**
 * M13. The spoken offer after 90 000 ms without input: only in phase childTurn (no piece selected), idleOffers < 2, !idleDeclined, once per position.
 *  (The silent peek at 45 000 ms is the stage's own: buddy.react('peek') + hud.nudgeHint(), once per position.)
 *  idleDeclined becomes true when the child, after an offer, confirms a move without opening a pouch.
 * The 90 000 ms timer is the director's (SPEC 5.8, E-turn); this is the question it asks when that timer fires.
 * @param {{phase:Phase, offeredHere:boolean}} s
 * @param {Budgets} b
 * @returns {boolean}
 */
export function idleOffer(s, b) {
  return s.phase === 'childTurn' && !s.offeredHere && b.idleOffers < 2 && !b.idleDeclined;
}

/**
 * m7. takebacks < 3 && punishes && the child lost >= 300 cp by it && the punished move was confirmed before any comment.
 * @param {{punishes:boolean, loss:number, waited:boolean}} info
 *        punishes = the rival's move punishes the child's previous move (OppMove.punishes); loss = cp the child lost by it;
 *        waited = false: the punished move was confirmed before any comment (TurnBrief.mine.waited)
 * @param {Budgets} b
 * @returns {boolean}
 */
export function offerTakeback(info, b) {
  return b.takebacks < 3 && info.punishes && info.loss >= 300 && !info.waited;
}

/**
 * m2. A check within four plies of the previous check is "soft" (ring and quiet gong only).
 * @param {number} ply
 * @param {Budgets} b
 * @returns {boolean}
 */
export function softCheck(ply, b) {
  return ply - b.lastCheckPly <= 4;
}
