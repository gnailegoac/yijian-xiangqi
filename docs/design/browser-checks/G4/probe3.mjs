// The real coach port (no proxy): the over thread, proud, then why (answered by the narrator copy).
import { createBrainPort, createCoachPort } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/game/ports.js';
import { createInitialBoard } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js';
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e); process.exitCode = 2; });
const brain = createBrainPort();
const tasks = { liveJob: () => null, job: () => { throw new Error('no job expected'); } };
const board = createInitialBoard();
const deps = { apiBase: null, forceLocal: false, tasks, brain, getSession: () => ({ phase: 'over', history: [] }) };
const coach = createCoachPort(deps);
const turn = { ply: 20, me: 'red', phase: 'middle', check: false, n: 30, back: null, eval: { b: 'even' }, mat: { me: 'R2H2C2P5A2E2', opp: 'R2H2C2P5A2E2', cp: 0 }, level: 2,
  moments: [], taught: [], mine: null, opp: null, threats: [], chance: null, known: { threats: true, chance: false } };
const over = { result: 'loss', reason: 'resign', moves: 10, stats: { good: 5, taken: 0, captures: 1, brilliant: 0 }, takeaway: { kind: 'habit', code: 'hang_piece', n: 2, ex: { n: 3, move: '车一进一', better: '马二进三' } },
  proud: { n: 1, s: 'me', move: '炮二平五', tag: 'great', k: 'check' }, goal: 'hang_piece', kept: null, rank: null };
const book = coach.createMoveBook({ board, turn: 'red' });
const thread = coach.beginOver(turn, book);
const say = async (label, start) => {
  let text = '', cue = null, ended = null;
  const reply = start({ onStart: (s) => { cue = s.cue; }, onSegment: (seg) => { text += seg.type === 'move' ? `【${seg.notation}】` : seg.text; }, onEnd: (r) => { ended = r; } });
  const r = await reply.done;
  console.log(label, '| cue', cue, '| text', JSON.stringify(text), '| source', r.aborted ? 'aborted' : r.source);
};
await say('over ', (h) => thread.open({ kind: 'over', over }, 'auto', h));
await say('proud', (h) => thread.ask('proud', undefined, h));
await say('why  ', (h) => thread.ask('why', undefined, h));
await say('next ', (h) => thread.ask('next', undefined, h));
await say('why  ', (h) => thread.ask('why', undefined, h));
await say('free ', (h) => thread.ask('free', '为什么输了', h));
await say('why  ', (h) => thread.ask('why', undefined, h));
console.log('busy', thread.busy(), 'kind', thread.kind, 'mode', coach.mode(), coach.offReason());
deps.forceLocal = true; console.log('forced', coach.offReason());
// a turn thread: start, hint 1
const t2 = coach.beginTurn({ ...turn, ply: 0 }, book);
await say('start', (h) => t2.open({ kind: 'start', first: true }, 'auto', h));
await say('good?', (h) => t2.ask('good', undefined, h));
coach.reset();
await say('reset', (h) => t2.ask('score', undefined, h));
