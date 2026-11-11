// Rival (SPEC 4.22): 司马懿's canned lines (never LLM output) and his mood rule. Owner: G5.
//
// Pure: no DOM, no clock, no state. The only randomness is the generator passed in. The director keeps the rival move
// number of his last spoken line (Budgets.rivalLineAt) and hands it in as `s.lineAt`.
//
// The lines are SPEC 4.22 as the owner corrected them (CONTRACT-NOTES 113). He is a proud but worthy rival: no line
// names or judges the child (no 你, no 小主公), none belittles a move of the child's, and he never gloats after winning.
// A `check` line is also what he says with the mating move (the event carries no mate flag), so it never asks for an answer.

/** @import { RivalMood } from './types.js' */

export const RIVAL_NAME = '司马懿', RIVAL_TITLE = '魏 · 大都督', CHILD_TITLE = '蜀 · 小主公';
export const RIVAL_LINES = {
  start:    ['请。', '开局吧。', '请出招。'],
  check:    ['将军。', '兵临城下。'],
  smug:     ['此计已成。', '早有防备。', '看我这一手。', '正合我意。'],
  quiet:    ['稳扎稳打。', '不急。', '步步为营。', '再布一子。', '且看后手。'],
  rattled:  ['竟有此着！', '失算了……', '好生厉害。', '这一手厉害。', '这倒没料到。'],
  frown:    ['容我三思……', '局势不妙。', '须得小心。', '此局难解。'],
  checked:  ['不慌。', '来得好。', '有点意思。'],
  win:      ['承让。', '承让，改日再战。'],
  lose:     ['此局是我输了。', '心服口服。', '来日再战。'],
  draw:     ['平分秋色。', '不分胜负。'],
};

/** Rival moves that must lie between two of his spoken lines (start and over lines are outside this rule). */
const LINE_GAP = 5;
/** Chance that a calm move carries a `quiet` line when a line is allowed at all. */
const QUIET_CHANCE = 0.3;

/**
 * One line of a pool, chosen with the generator.
 * @param {string[]} pool
 * @param {() => number} rnd
 * @returns {string}
 */
function pick(pool, rnd) {
  const i = Math.floor(rnd() * pool.length);
  return pool[Math.min(pool.length - 1, Math.max(0, i))];
}

/**
 * @param {{kind:'start'|'thinking'|'moved'|'punished'|'checked'|'over', trouble?:boolean, gaveCheck?:boolean, tacticLanded?:boolean,
 *          punishesChild?:boolean, result?:'win'|'loss'|'draw'}} ev      result is the CHILD's result
 * @param {{rivalMoveNo:number, lineAt:number}} s  @param {() => number} rnd
 * @returns {{mood:RivalMood, line?:string}}
 */
export function rivalReact(ev, s, rnd) {
  const mayTalk = s.rivalMoveNo - s.lineAt >= LINE_GAP;
  /**
   * The mood, with a line of the pool when one is allowed now.
   * @param {RivalMood} mood
   * @param {string[]} pool
   * @returns {{mood:RivalMood, line?:string}}
   */
  const react = (mood, pool) => (mayTalk ? { mood, line: pick(pool, rnd) } : { mood });

  switch (ev.kind) {
    case 'start':
      return { mood: 'calm', line: pick(RIVAL_LINES.start, rnd) };

    case 'thinking':
      // The frown is his tell: only when the child is clearly ahead.
      return ev.trouble ? react('frown', RIVAL_LINES.frown) : { mood: 'thinking' };

    case 'moved':
      // Smug only after his own tactic landed, never when the move punishes a slip of the child.
      if (ev.tacticLanded && !ev.punishesChild) return react('smug', RIVAL_LINES.smug);
      if (ev.gaveCheck) return react('calm', RIVAL_LINES.check);
      if (mayTalk && rnd() < QUIET_CHANCE) return { mood: 'calm', line: pick(RIVAL_LINES.quiet, rnd) };
      return { mood: 'calm' };

    case 'punished':
      // The only reaction to being punished.
      return react('rattled', RIVAL_LINES.rattled);

    case 'checked':
      return react('calm', RIVAL_LINES.checked);

    case 'over': {
      // ev.result is the child's result: the child's loss is his win.
      const pool = ev.result === 'loss' ? RIVAL_LINES.win
                 : ev.result === 'win' ? RIVAL_LINES.lose
                 : ev.result === 'draw' ? RIVAL_LINES.draw
                 : null;
      return pool ? { mood: 'calm', line: pick(pool, rnd) } : { mood: 'calm' };
    }
  }
}
