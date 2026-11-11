// tests/unit/coach/fallback.test.js (C2) — the local narrator: contract sections 4.15, 8.3, 8.6, 8.7.
// Packets are the fixtures of section 9 (tests/fixtures/coach) and variations of them; every expected sentence is the template
// of section 8.6 filled in by hand, with the wording the owner decided where 8.6 was wrong (CONTRACT-NOTES items 111 to 113:
// the start index of localLine, 为什么？ after the game, and the corrected sentences; items 131 and 133, fix package CL: one
// dash before a goal, a threat that does not stand yet, a bad verdict without a named flaw, the three open wordings, a rival
// move that gave something up).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { composeLocal, composeToolReply, cueFor, localLine } from '../../../src/coach/fallback.js';
import { createMoveBook } from '../../../src/coach/book.js';
import { parseCoachText } from '../../../src/coach/markup.js';
import { CAPS, capFor, plainLength, validateCoachRequest } from '../../../src/coach/protocol.js';
import {
  ASK_CODES, CATS, CUE, CUE_CODES, FLAW_CODES, HABIT_CODES, HABIT_FIX, HABIT_WORD, MOTIF_CODES, NOTABLE_MOTIFS, NOTATION_RE, PATTERN_CODES, PATTERN_NAME,
  RANK_NAMES,
} from '../../../src/core/codes.js';
import { applyMove, createInitialBoard, fenToBoard } from '../../../src/core/engine.js';
import { describeMove, fromMoveCode, toLine } from '../../../src/core/notation.js';
import { COACH_EXAMPLE_POSITIONS } from '../../helpers/positions.js';
import { mulberry32 } from '../../helpers/playout.js';

// ---------------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------------

const FIXTURE_DIR = new URL('../../fixtures/coach/', import.meta.url);
const FIXTURE_NAMES = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json')).sort();
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    Object.values(x).forEach(deepFreeze);
  }
  return x;
}

const F = {
  start: fixture('start.json'), opp: fixture('opp.json'), hint: fixture('hint.json'), tryHeld: fixture('try-held.json'),
  tryHeldAsk: fixture('try-held-ask.json'), try: fixture('try.json'), askChip: fixture('ask-chip.json'),
  resume: fixture('ask-free-resume.json'), over: fixture('over.json'), recap: fixture('recap.json'),
};

/** The turn of the worked example (section 9.5): after 1. 炮二平五 马8进7, the child is red, level 3, no threats. */
const base = () => clone(F.tryHeld.turn);
const turnWith = (patch) => Object.assign(base(), patch);
/** The same turn with another rival move. */
const oppTurn = (patch, more = {}) => turnWith({ opp: { move: '马8进7', check: false, quality: 'normal', does: [], ...patch }, ...more });
const P = (s, t, f, q) => (q ? { s, t, f, q } : { s, t, f });
const NET0 = { gain: [], lose: [], cp: 0 };

const OPP_SILENT = { i: 0, kind: 'opp', said: 'none' };
const OPP_LAST = [{ i: 0, kind: 'opp' }];
/** A thread cut after an event: that event becomes the one to answer and loses the record of how it was answered. */
const asLast = (events) => clone(events).map((event, k) => {
  if (k < events.length - 1) return event;
  const { said, reply, v, ...open } = event;
  return open;
});
/** An earlier event that was answered locally. */
const spoken = (event, v = 0) => ({ ...event, said: 'local', v });
/** An ordinary trial (the developing move of section 9.6) unless patched. */
const tryEvent = (patch = {}) => ({
  i: 1, kind: 'try', n: 1,
  try: {
    move: '马二进三', cat: 'best', loss: 0, held: false, eval: { b: 'even' },
    does: [{ k: 'develop', by: P('me', 'H', 3) }], flaws: [], cost: null, reply: null, toward: null, chance: 'none', ...patch,
  },
});
/** A held trial (the greedy capture of section 9.5 unless patched). */
const heldEvent = (patch = {}) => tryEvent({
  move: '炮五进四', cat: 'mistake', loss: 350, held: true, eval: { b: 'worse' },
  does: [{ k: 'capture', by: P('me', 'C', 5), on: P('opp', 'P', 5) }], cost: { gain: ['P'], lose: ['C'], cp: -350 }, ...patch,
});
const ask = (code, extra = {}) => ({ i: 5, kind: 'ask', ask: code, ...extra });
const hintEvent = (level, hint, i = level) => ({ i, kind: 'hint', level, hint });

const HELD_TRY = clone(F.tryHeldAsk.events[1]);                       // said 'local', v 3
const MORE = clone(F.tryHeldAsk.events[2].more);
const MATE_THREAT = { k: 'mate_threat', by: P('opp', 'R', 2), move: '车2进7', net: { gain: [], lose: [], cp: -2000 }, sev: 'mate' };
const PIECE_THREAT = { k: 'attack', by: P('opp', 'H', 6), on: P('me', 'C', 5), move: '马6进5', net: { gain: [], lose: ['C'], cp: -450 }, sev: 'piece' };
const FORK = { k: 'fork', by: P('me', 'H', 4), on: P('opp', 'R', 3), on2: P('opp', 'C', 7) };

const MATE_TRY = () => heldEvent({ move: '仕四进五', cat: 'blunder', loss: 2000, eval: { b: 'lost', mate: -1 }, does: [{ k: 'quiet' }], flaws: [{ k: 'allow_mate' }], cost: null });
const HANG_TRY = () => heldEvent({ move: '马三进四', does: [{ k: 'cross_river', by: P('me', 'H', 4) }], flaws: [{ k: 'hang', on: P('me', 'H', 4), by: P('opp', 'C', 2) }], cost: { gain: [], lose: ['H'], cp: -400 } });
const UNGUARD_TRY = () => heldEvent({ move: '炮五平六', does: [{ k: 'quiet' }], flaws: [{ k: 'unguard', by: P('me', 'C', 6), on: P('me', 'H', 3) }], cost: { gain: [], lose: ['H'], cp: -400 } });
const THREAT_TRY = () => heldEvent({ move: '兵三进一', does: [{ k: 'quiet' }], flaws: [{ k: 'ignore_threat', by: P('opp', 'C', 2), on: P('me', 'H', 8) }], cost: { gain: [], lose: ['H'], cp: -400 } });
/** `by` undefined: no single piece forks (the brief then names none). */
const FORK_TRY = (...args) => {
  const by = args.length === 0 ? P('opp', 'H', 4) : args[0];
  return heldEvent({ move: '车一进一', does: [{ k: 'develop', by: P('me', 'R', 1) }], flaws: [{ k: 'walk_fork', ...(by ? { by } : {}), on: P('me', 'R', 1), on2: P('me', 'C', 5) }], cost: { gain: [], lose: ['C'], cp: -450 } });
};
const PIN_TRY = () => heldEvent({ move: '马三进五', does: [{ k: 'quiet' }], flaws: [{ k: 'walk_pin', by: P('opp', 'R', 5), on: P('me', 'H', 5) }], cost: { gain: [], lose: ['H'], cp: -400 } });
const COST_TRY = () => heldEvent({ move: '兵三进一', does: [{ k: 'quiet' }], flaws: [{ k: 'waste' }], cost: { gain: [], lose: ['P', 'C'], cp: -550 } });
const OTHER_TRY = () => heldEvent({ move: '兵三进一', does: [{ k: 'quiet' }], flaws: [], cost: { gain: [], lose: [], cp: -200 } });

const overTurn = () => clone(F.over.turn);
/** The over event of section 9.8 with its packet patched; `cue` null removes the interjection. */
const overEvent = (patch = {}, cue) => {
  const event = clone(F.over.events[0]);
  Object.assign(event.over, patch);
  if (cue === null) delete event.cue;
  else if (cue) event.cue = cue;
  return event;
};
const overThread = (code, patch = {}) => [spoken(overEvent(patch)), ask(code)];
/** 为什么？ in a game-over thread after the questions `before` (each answered locally). */
const overWhy = (before, patch = {}) => [spoken(overEvent(patch)), ...before.map((code, k) => spoken({ i: k + 1, kind: 'ask', ask: code })),
  { i: before.length + 1, kind: 'ask', ask: 'why' }];

const MINE_BEST = { move: '炮二平五', cat: 'best', waited: true, self: true, try: {
  move: '炮二平五', cat: 'best', loss: 0, held: false, eval: { b: 'even' },
  does: [{ k: 'cannon_mount', by: P('me', 'C', 5), on: P('opp', 'P', 5), on2: P('me', 'P', 5) }], flaws: [], cost: null, reply: null, toward: null, chance: 'none' } };
const MINE_MISTAKE = { move: '炮五进四', cat: 'mistake', waited: false, self: true, try: { ...clone(HELD_TRY.try), held: false, reply: clone(MORE.reply) } };

/**
 * One row of section 8.6: `expect[v]` is the sentence of variant v for this packet (the template of the contract with the
 * packet's pieces written in by hand).
 */
const GOLDEN = deepFreeze([
  // ---- start ----
  { name: 'start', row: 'start', turn: clone(F.start.turn), events: clone(F.start.events),
    expect: ['小主公，红先黑后，请落第一子。', '新的一局，小主公请先行。', '出师顺利！小主公请。'] },

  // ---- opp (one sentence, cap 18) ----
  { name: 'opp.mate', row: 'opp.mate', turn: turnWith({ threats: [MATE_THREAT] }), events: OPP_LAST,
    expect: ['对方下一步有杀棋，先护帅！', '不可大意，对方要杀棋了！', '帅有危险，先解围！', '先别进攻，对方有杀着。', '要紧！先给帅找条活路。', '对方亮出杀招，快护帅！'] },
  { name: 'opp.check', row: 'opp.check', turn: oppTurn({ move: '炮2平5', check: true, does: [{ k: 'check', by: P('opp', 'C', 5) }] }), events: OPP_LAST,
    expect: ['对方将军，先把帅护好。', '被将军了，先应将。', '先解将军，别的后说。', '帅被盯上了，先解围。', '将军！先看怎么应。', '应将要紧，看看有几条路。'] },
  { name: 'opp.punished', row: 'opp.punished', turn: oppTurn({ move: '马7进5', punishes: true, does: [{ k: 'attack', by: P('opp', 'H', 5), on: P('me', 'P', 3) }] }), events: OPP_LAST,
    expect: ['上一步留了空子，被抓住了。', '这是上一步的漏洞，别急。', '对方抓住了刚才的破绽。', '刚才那步留了后患。', '空子被钻了，下回先看一眼。', '对方不客气，钻了空子。'] },
  { name: 'opp.captured', row: 'opp.captured', turn: oppTurn({ move: '马7进5', captured: 'C', does: [{ k: 'capture', by: P('opp', 'H', 5), on: P('me', 'C', 5) }] },
    { mat: { me: 'R2H2C1P5A2E2', opp: 'R2H2C2P5A2E2', cp: -450 } }), events: OPP_LAST,
    expect: ['对方吃掉了你的炮。', '丢了一个炮，稳住。', '炮被吃了，别慌。', '对方得了一个炮。', '少了一个炮，慢慢扳回来。', '炮没了，先看眼前。'] },
  { name: 'opp.threat.q (level 5)', row: 'opp.threat.q', turn: oppTurn({ move: '马7进6', does: [{ k: 'attack', by: P('opp', 'H', 6), on: P('me', 'C', 5) }] }, { level: 5, threats: [PIECE_THREAT] }), events: OPP_LAST,
    expect: ['看看对方的6路马，它瞄着谁？', '对方的6路马在打什么主意？', '留神对方的6路马的去向。'] },
  { name: 'opp.threat', row: 'opp.threat', turn: oppTurn({ move: '马7进6', does: [{ k: 'attack', by: P('opp', 'H', 6), on: P('me', 'C', 5) }] }, { threats: [PIECE_THREAT] }), events: OPP_LAST,
    expect: ['对方盯上了你的五路炮。', '你的五路炮被盯上了。', '小心，你的五路炮有危险。', '对方想吃你的五路炮。', '你的五路炮要当心。', '不可不防：你的五路炮被瞄上了。'] },
  // a threat that does not stand yet (prep): 它瞄着谁？ and 被瞄上了 would tell an aim that is not there; they give way to the next variant
  { name: 'opp.threat.q (level 5), a threat that does not stand yet', row: 'opp.threat.q', events: OPP_LAST,
    turn: oppTurn({ move: '马7进6', does: [{ k: 'develop', by: P('opp', 'H', 6) }] }, { level: 5, threats: [{ ...PIECE_THREAT, prep: true }] }),
    expect: ['对方的6路马在打什么主意？', '对方的6路马在打什么主意？', '留神对方的6路马的去向。'] },
  { name: 'opp.threat, a threat that does not stand yet', row: 'opp.threat', events: OPP_LAST,
    turn: oppTurn({ move: '马7进6', does: [{ k: 'develop', by: P('opp', 'H', 6) }] }, { threats: [{ ...PIECE_THREAT, prep: true }] }),
    expect: ['对方盯上了你的五路炮。', '你的五路炮被盯上了。', '小心，你的五路炮有危险。', '对方想吃你的五路炮。', '你的五路炮要当心。', '对方盯上了你的五路炮。'] },
  { name: 'opp.overlooked', row: 'opp.overlooked', turn: oppTurn({ move: '卒3进1', quality: 'slip', overlooked: { on: P('me', 'H', 8), move: '炮2进7' } }), events: OPP_LAST,
    expect: ['好险，对方漏看了一步。', '对方刚才错过了机会。', '司马懿也有走眼的时候。'] },
  { name: 'opp.chance', row: 'opp.chance', turn: oppTurn({ move: '卒3进1', quality: 'slip' }, { chance: { size: 'piece', theme: 'fork', area: 'left' }, known: { threats: true, chance: true } }), events: OPP_LAST,
    expect: ['左翼好像露了破绽。', '左翼有文章可做。', '看看左翼，有机会。'] },
  // a chance in the child's own palace or back rows is told without its area (CONTRACT-NOTES 138): 己方九宫有文章可做 would
  // tell the child that their own palace holds a chance
  { name: 'opp.chance, in the child\'s own palace', row: 'opp.chance', events: OPP_LAST,
    turn: oppTurn({ move: '卒3进1', quality: 'slip' }, { chance: { size: 'piece', theme: 'capture', area: 'my_palace' }, known: { threats: true, chance: true } }),
    expect: ['对方好像露了破绽。', '眼下有文章可做。', '找一找，有机会。'] },
  { name: 'opp.chance, in the child\'s own back rows', row: 'opp.chance', events: OPP_LAST,
    turn: oppTurn({ move: '卒3进1', quality: 'slip' }, { chance: { size: 'pawn', theme: 'capture', area: 'my_back' }, known: { threats: true, chance: true } }),
    expect: ['对方好像露了破绽。', '眼下有文章可做。', '找一找，有机会。'] },
  // The caption above the bubble reads 【炮8平5】顺炮: the sentence tells what kind of formation that is, never the name alone
  { name: 'opp.name (section 9.3)', row: 'opp.name', turn: clone(F.opp.turn), events: clone(F.opp.events),
    expect: ['顺炮，常见的阵势。'] },
  // The caption reads 【炮8进1】保护: the sentence tells which piece is protected, in the rival voice (自己的, not 对方的).
  // The sentence of the intent answer (对方这步的用意：给自己的5路卒补上保护。) is two characters over the cap of 18.
  { name: 'opp.effect', row: 'opp.effect', turn: oppTurn({ move: '炮8进1', does: [{ k: 'defend', on: P('opp', 'P', 5) }, { k: 'develop', by: P('opp', 'C', 8) }] }), events: OPP_LAST,
    expect: ['这步给自己的5路卒补上保护。', '这步给自己的5路卒补上保护。', '这步给自己的5路卒补上保护。'] },
  { name: 'opp.effect, the sentence of the intent answer fits', row: 'opp.effect', turn: oppTurn({ move: '车9平8', does: [{ k: 'attack', by: P('opp', 'R', 8), on: P('me', 'H', 3) }] }), events: OPP_LAST,
    expect: ['对方这步的用意：8路车捉你的三路马。', '对方的8路车捉你的三路马。', '对方这步的用意：8路车捉你的三路马。'] },
  { name: 'opp.effect, only the shorter clause fits', row: 'opp.effect', events: OPP_LAST,
    turn: oppTurn({ move: '炮8平5', does: [{ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5), on2: P('opp', 'P', 5) }] }),
    expect: ['对方的5路炮瞄着你的五路兵。', '对方的5路炮瞄着你的五路兵。', '对方的5路炮瞄着你的五路兵。'] },
  // an effect that names no piece besides the one that moved says what the caption says (【马8进7】出子): no line
  { name: 'opp: nothing to add to the caption (a developing move)', row: '', turn: oppTurn({ does: [{ k: 'develop', by: P('opp', 'H', 7) }, { k: 'defend', on: P('opp', 'P', 5) }] }), events: OPP_LAST,
    expect: ['', '', ''] },
  { name: 'opp: nothing to add to the caption (a piece that steps away)', row: '', turn: oppTurn({ move: '象5退3', does: [{ k: 'escape', by: P('opp', 'E', 3) }] }), events: OPP_LAST,
    expect: ['', '', ''] },
  { name: 'opp: nothing to add to the caption (the name of a tactic, its clause over the cap)', row: '', events: OPP_LAST,
    turn: oppTurn({ move: '马6进5', name: 'fork_two', does: [{ k: 'fork', by: P('opp', 'H', 5), on: P('me', 'R', 4), on2: P('me', 'R', 6), name: 'fork_two' }] }),
    expect: ['', '', ''] },
  // the caption of a quiet move reads 调整: no variant says that word again
  { name: 'opp.quiet', row: 'opp.quiet', turn: oppTurn({ move: '士4进5', does: [{ k: 'quiet' }] }), events: OPP_LAST,
    expect: ['对方稳稳地走了一步。', '对方没有急着进攻。', '这步不急不躁。', '司马懿在布阵。', '对方先把阵脚站稳。', '平平常常的一步。'] },
  // a move that gave something up is not called steady or ordinary (稳稳地, 把阵脚站稳, 平平常常 give way)
  { name: 'opp.quiet, a move that left a hole', row: 'opp.quiet', turn: oppTurn({ move: '士4进5', quality: 'slip', does: [{ k: 'quiet' }] }), events: OPP_LAST,
    expect: ['对方没有急着进攻。', '对方没有急着进攻。', '这步不急不躁。', '司马懿在布阵。', '对方没有急着进攻。', '对方没有急着进攻。'] },
  { name: 'opp.quiet, a soft move', row: 'opp.quiet', turn: oppTurn({ move: '士4进5', quality: 'soft', does: [{ k: 'quiet' }] }), events: OPP_LAST,
    expect: ['对方没有急着进攻。', '对方没有急着进攻。', '这步不急不躁。', '司马懿在布阵。', '对方没有急着进攻。', '对方没有急着进攻。'] },

  // ---- hint ----
  { name: 'hint 1: focus danger', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'danger', theme: 'escape' })], expect: ['先别急着进攻：对方想干什么？'] },
  { name: 'hint 1: theme capture_free', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'capture_free' })], expect: ['找一找：对方哪个子没人保护？'] },
  { name: 'hint 1: theme miss_capture', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'miss_capture' })], expect: ['找一找：对方哪个子没人保护？'] },
  { name: 'hint 1: theme fork', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'fork' })], expect: ['有没有一步，能同时捉两个子？'] },
  { name: 'hint 1: theme check', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'check' })], expect: ['对方的老将，身边还安全吗？'] },
  { name: 'hint 1: theme mate', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'finish', theme: 'mate' })], expect: ['对方的老将，身边还安全吗？'] },
  { name: 'hint 1: theme mate_threat', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'mate_threat' })], expect: ['对方的老将，身边还安全吗？'] },
  { name: 'hint 1: focus develop (section 9.4)', row: 'hint1', turn: base(), events: asLast(F.hint.events.slice(0, 2)), expect: ['你还有哪个大子没出动？'] },
  { name: 'hint 1: focus finish', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'finish', theme: 'attack' })], expect: ['怎么把对方的老将逼到没路走？'] },
  { name: 'hint 1: focus chance, a piece to attack', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'attack' })], expect: ['找一找：对方哪里有破绽？'] },
  { name: 'hint 1: focus chance, a pin', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'pin' })], expect: ['找一找：对方哪里有破绽？'] },
  { name: 'hint 1: otherwise', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'improve', theme: 'quiet' })], expect: ['哪个子待的位置最别扭？'] },
  { name: 'hint 2: focus danger', row: 'hint2', turn: base(), events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'danger', theme: 'escape' })), hintEvent(2, { piece: P('me', 'H', 8), area: 'left', theme: 'escape' })], expect: ['该照顾一下你的八路马了。'] },
  { name: 'hint 2: focus danger, the king under check', row: 'hint2', turn: base(), events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'danger', theme: 'check' })), hintEvent(2, { piece: P('me', 'K', 5), area: 'my_palace', theme: 'check' })], expect: ['该照顾一下你的帅了。'] },
  { name: 'hint 2: focus danger, a piece that helps (it stands in the way of a check)', row: 'hint2', turn: base(), events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'danger', theme: 'check' })), hintEvent(2, { piece: P('me', 'A', 4), area: 'my_palace', theme: 'check' })], expect: ['看看你的四路仕，它能帮上忙。'] },
  { name: 'hint 2: focus danger, a piece that helps (it guards)', row: 'hint2', turn: base(), events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'danger', theme: 'defend' })), hintEvent(2, { piece: P('me', 'H', 2), area: 'right', theme: 'defend' })], expect: ['看看你的二路马，它能帮上忙。'] },
  { name: 'hint 2: otherwise (section 9.4)', row: 'hint2', turn: base(), events: asLast(F.hint.events.slice(0, 3)), expect: ['看看你的二路马，机会在右翼。'] },
  // 机会在己方九宫 / 机会在己方底线 are not said (CONTRACT-NOTES 138)
  { name: 'hint 2: otherwise, the piece is headed for the child\'s own palace', row: 'hint2', turn: base(),
    events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'improve', theme: 'quiet' })), hintEvent(2, { piece: P('me', 'A', 4), area: 'my_palace', theme: 'quiet' })],
    expect: ['看看你的四路仕，它有更好的去处。'] },
  { name: 'hint 2: otherwise, the piece is headed for the child\'s own back rows', row: 'hint2', turn: base(),
    events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'improve', theme: 'quiet' })), hintEvent(2, { piece: P('me', 'R', 1), area: 'my_back', theme: 'quiet' })],
    expect: ['看看你的一路车，它有更好的去处。'] },
  { name: 'hint 3: with a line (section 9.4)', row: 'hint3', turn: base(), events: clone(F.hint.events), expect: ['可以走【马二进三】：你的三路马出动。对方多半走【车9平8】。'] },
  { name: 'hint 3: without a line', row: 'hint3', turn: base(), events: [OPP_SILENT, hintEvent(3, { move: '车二进七', does: [{ k: 'check', by: P('me', 'R', 2) }], line: null })], expect: ['可以走【车二进七】：你的二路车将军。'] },

  // ---- try: guiding questions for a held trial (cap 20) ----
  { name: 'held.mate', row: 'held.mate', turn: base(), events: [OPP_SILENT, MATE_TRY()],
    expect: ['这步走完，帅身边还安全吗？', '先看看帅有没有危险？', '对方的子离帅有多近？', '帅还有路可走吗？', '走完这步，对方能将军吗？', '不可不防：帅那边稳不稳？'] },
  { name: 'held.hang', row: 'held.hang', turn: base(), events: [OPP_SILENT, HANG_TRY()],
    expect: ['走完这步，你的四路马还有人保护吗？', '你的四路马走到那儿，谁来保它？', '且看：你的四路马会不会被白吃？', '这一步之后，你的四路马安全吗？', '你的四路马站稳了吗？谁盯着它？', '落子前想想：你的四路马有靠山吗？'] },
  { name: 'held.unguard', row: 'held.unguard', turn: base(), events: [OPP_SILENT, UNGUARD_TRY()],
    expect: ['你的六路炮一走，谁来保护你的三路马？', '你的六路炮离开后，你的三路马怎么办？', '你的三路马原本靠谁保着？', '走了你的六路炮，你的三路马就孤单了吧？', '你的六路炮是不是还有别的差事？', '想一想：你的三路马靠的是谁？'] },
  { name: 'held.threat', row: 'held.threat', turn: base(), events: [OPP_SILENT, THREAT_TRY()],
    expect: ['先看看对方的2路炮正盯着谁？', '对方的2路炮刚才想干什么？', '你的八路马现在安全吗？', '对方上一步的用意是什么？', '有没有哪个子正被瞄着？', '落子前，先数数对方的威胁。'] },
  { name: 'held.greedy (section 9.5)', row: 'held.greedy', turn: base(), events: clone(F.tryHeld.events),
    expect: ['对方的5路卒背后有没有保镖？', '吃完，你的五路炮回得来吗？', '对方的5路卒是白给的吗？再看看。', '这个子，真的没人管吗？', '吃它之前，看看谁在撑腰。', '吃完这一口，接下来呢？'] },
  { name: 'held.greedy (bad_trade)', row: 'held.greedy', turn: base(), events: [OPP_SILENT, heldEvent({ flaws: [{ k: 'bad_trade', by: P('me', 'C', 5), on: P('opp', 'P', 5) }] })],
    expect: ['对方的5路卒背后有没有保镖？', '吃完，你的五路炮回得来吗？', '对方的5路卒是白给的吗？再看看。', '这个子，真的没人管吗？', '吃它之前，看看谁在撑腰。', '吃完这一口，接下来呢？'] },
  { name: 'held.fork', row: 'held.fork', turn: base(), events: [OPP_SILENT, FORK_TRY()],
    expect: ['对方的4路马下一步能跳到哪儿？', '你的一路车和你的五路炮，是不是站得太近？', '对方有没有一步捉两个？'] },
  { name: 'held.fork (a rook reaches along a whole line)', row: 'held.fork', turn: base(), events: [OPP_SILENT, FORK_TRY(P('opp', 'R', 4))],
    expect: ['你的一路车和你的五路炮，会同时被捉吗？', '你的一路车和你的五路炮，会同时被捉吗？', '对方有没有一步捉两个？'] },
  { name: 'held.fork (two pieces attacked by different pieces)', row: 'held.fork', turn: base(), events: [OPP_SILENT, FORK_TRY(undefined)],
    expect: ['你的一路车和你的五路炮，会同时被捉吗？', '你的一路车和你的五路炮，会同时被捉吗？', '对方有没有一步捉两个？'] },
  { name: 'held.fork (a piece and the king: a check that also attacks the piece)', row: 'held.fork', turn: base(),
    events: [OPP_SILENT, heldEvent({ move: '炮二平四', does: [{ k: 'quiet' }], flaws: [{ k: 'walk_fork', by: P('opp', 'H', 4), on: P('me', 'R', 1), on2: P('me', 'K', 5) }], cost: { gain: [], lose: ['R'], cp: -900 } })],
    expect: ['对方的4路马下一步能跳到哪儿？', '对方将军的时候，你的一路车怎么办？', '对方有没有一步捉两个？'] },
  { name: 'held.pin', row: 'held.pin', turn: base(), events: [OPP_SILENT, PIN_TRY()],
    expect: ['你的五路马后面站着谁？', '你的五路马还能自由走动吗？', '对方的5路车和你的五路马在不在一条线上？'] },
  { name: 'held.cost', row: 'held.cost', turn: base(), events: [OPP_SILENT, COST_TRY()],
    expect: ['走完这步，你的炮有危险吗？', '想想：炮还安全吗？', '这步之后，炮站得稳吗？'] },
  { name: 'held.other', row: 'held.other', turn: base(), events: [OPP_SILENT, OTHER_TRY()],
    expect: ['这步走完，对方最想走哪一步？', '对方会怎么回敬这一步？', '落子前，替对方想一步。', '如果你是司马懿，会怎么应？', '这步有没有留下空子？', '再看一眼对方的子力。'] },

  // ---- try: comments (cap 24) ----
  { name: 'try.only', row: 'try.only', turn: base(), events: [OPP_SILENT, tryEvent({ only: true })],
    expect: ['【马二进三】是眼下唯一的解法，走得对。', '只有【马二进三】能解围，好眼力。', '此计可行：【马二进三】是唯一的路。'] },
  // a forced move (at most two legal moves) was not found: no 走得对, no 好眼力, no 此计可行 (CONTRACT-NOTES 147)
  { name: 'try.only, a forced move', row: 'try.only', turn: turnWith({ check: true, n: 2 }), events: [OPP_SILENT, tryEvent({ move: '帅五平六', only: true, does: [{ k: 'escape', by: P('me', 'K', 5) }] })],
    expect: ['【帅五平六】是眼下唯一的解法。'] },
  // The best there was, and nothing to praise (CONTRACT-NOTES 147): the move's own line leaves the child two points or
  // more down. The grim row stands in for only, taken, praise and steady.
  { name: 'try.grim: the line still costs a piece (in place of praise)', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '车一平三', eval: { b: 'lost' }, does: [{ k: 'attack', by: P('me', 'R', 3), on: P('opp', 'C', 7) }], cost: { gain: ['C'], lose: ['R', 'H'], cp: -850 } })],
    expect: ['【车一平三】是眼下最顽强的一步。', '局面吃紧，【车一平三】是最好的应法。', '难是难，【车一平三】没有走错。'] },
  { name: 'try.grim: the line still costs two points (in place of only)', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '相七进五', only: true, eval: { b: 'worse' }, does: [{ k: 'defend', on: P('me', 'P', 5) }], cost: { gain: [], lose: ['A'], cp: -200 } })],
    expect: ['【相七进五】是眼下最顽强的一步。', '局面吃紧，【相七进五】是最好的应法。', '难是难，【相七进五】没有走错。'] },
  // ... or the child stays far behind after it (走后形势: 很危险) and the line wins nothing
  { name: 'try.grim: far behind and nothing won (in place of steady)', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '帅五退一', eval: { b: 'lost' }, does: [{ k: 'quiet' }] })],
    expect: ['【帅五退一】是眼下最顽强的一步。', '局面吃紧，【帅五退一】是最好的应法。', '难是难，【帅五退一】没有走错。'] },
  // ... a move judged 稳健 is not the best one: 最顽强 and 最好的 are not said of it (CONTRACT-NOTES 148)
  { name: 'try.grim: a move judged good', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '帅五退一', cat: 'good', eval: { b: 'lost' }, does: [{ k: 'quiet' }] })],
    expect: ['难是难，【帅五退一】没有走错。', '局面吃紧，【帅五退一】可以走。'] },
  { name: 'try.grim: far behind and nothing won (in place of taken)', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '车二进七', eval: { b: 'lost' }, does: [{ k: 'check', by: P('me', 'R', 2) }], chance: 'taken' })],
    expect: ['【车二进七】是眼下最顽强的一步。', '局面吃紧，【车二进七】是最好的应法。', '难是难，【车二进七】没有走错。'] },
  // The words of the row follow the evaluation after the move (CONTRACT-NOTES 150). 最顽强, 局面吃紧 and 难是难 all say that
  // the position is bad; where the child is not in trouble (走后形势 均势, 占优 or 胜势) the row is reached by a line that
  // gives two points back, and that is what is said.
  { name: 'try.grim: winning, the line gives two points back', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '兵三进一', eval: { b: 'won' }, does: [{ k: 'cross_river', by: P('me', 'P', 3) }], cost: { gain: [], lose: ['A'], cp: -200 } })],
    expect: ['【兵三进一】是眼下最好的一步，只是要丢点子。', '【兵三进一】没有走错，只是要丢点子。'] },
  { name: 'try.grim: a level position, a brilliant move whose line costs a piece (in place of only)', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '车一平三', cat: 'brilliant', only: true, does: [{ k: 'attack', by: P('me', 'R', 3), on: P('opp', 'C', 7) }], cost: { gain: ['C'], lose: ['R'], cp: -450 } })],
    expect: ['【车一平三】是眼下最好的一步，只是要丢点子。', '【车一平三】没有走错，只是要丢点子。'] },
  { name: 'try.grim: ahead, a move judged good', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'good', loss: 40, eval: { b: 'better' }, does: [{ k: 'quiet' }], cost: { gain: [], lose: ['A'], cp: -200 } })],
    expect: ['【兵三进一】可以走，只是要丢点子。', '【兵三进一】没有走错，只是要丢点子。'] },
  // A move after which the child is mated has nothing to praise, whatever it does and whatever it takes (item 150): where
  // every move is mated all moves are 好棋. A fork one move before the mate was 妙哉！好一步【马六退七】：捉双。
  { name: 'try.grim: the child is mated after the move (in place of praise for a fork)', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '马六退七', eval: { b: 'lost', mate: -1 }, does: [{ k: 'fork', by: P('me', 'H', 7), on: P('opp', 'R', 7), on2: P('opp', 'C', 5) }] })],
    expect: ['【马六退七】是眼下最顽强的一步。', '局面吃紧，【马六退七】是最好的应法。', '难是难，【马六退七】没有走错。'] },
  { name: 'try.grim: the child is mated after the move (in place of praise for a capture, of taken and of avoided)', row: 'try.grim', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '车六平五', eval: { b: 'lost', mate: -2 }, does: [{ k: 'capture_free', by: P('me', 'R', 5), on: P('opp', 'P', 5) }],
      cost: { gain: ['P'], lose: [], cp: 100 }, chance: 'taken', avoided: 'greedy' })],
    expect: ['【车六平五】是眼下最顽强的一步。', '局面吃紧，【车六平五】是最好的应法。', '难是难，【车六平五】没有走错。'] },
  { name: 'try.avoided', row: 'try.avoided', turn: base(), events: [OPP_SILENT, tryEvent({ avoided: 'greedy' })],
    expect: ['这回没踩坑，【马二进三】走得稳。', '躲开了以前的坑，【马二进三】可行。'] },
  // 走得稳 is not said of a move after which the child comes out behind in material
  { name: 'try.avoided, the line still costs material', row: 'try.avoided', turn: base(),
    events: [OPP_SILENT, tryEvent({ avoided: 'greedy', eval: { b: 'worse' }, cost: { gain: [], lose: ['H'], cp: -400 } })],
    expect: ['躲开了以前的坑，【马二进三】可行。', '躲开了以前的坑，【马二进三】可行。'] },
  { name: 'try.taken', row: 'try.taken', turn: base(), events: [OPP_SILENT, tryEvent({ move: '马三进四', does: [FORK], chance: 'taken' })],
    expect: ['【马三进四】抓住了对方的破绽！', '【马三进四】正中对方的破绽。', '对方的漏洞被【马三进四】抓个正着。'] },
  { name: 'try.praise', row: 'try.praise', turn: base(), events: [OPP_SILENT, tryEvent({ move: '车二进七', does: [{ k: 'check', by: P('me', 'R', 2) }] })],
    expect: ['【车二进七】：你的二路车将军。', '你的二路车将军，【车二进七】走得好。', '好一步【车二进七】：将军。', '【车二进七】这步将军，漂亮。', '此计可行：【车二进七】将军。', '【车二进七】将军，对方难受了。'] },
  { name: 'try.praise (good, capture)', row: 'try.praise', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '炮五进四', cat: 'good', does: [{ k: 'capture', by: P('me', 'C', 5), on: P('opp', 'P', 5) }], cost: { gain: ['P'], lose: [], cp: 100 } })],
    expect: ['【炮五进四】：你的五路炮吃掉对方的5路卒。', '你的五路炮吃掉对方的5路卒，【炮五进四】走得好。', '好一步【炮五进四】：吃子。', '【炮五进四】这步吃子，漂亮。', '此计可行：【炮五进四】吃子。', '【炮五进四】吃子，对方难受了。'] },
  { name: 'try.steady (section 9.6)', row: 'try.steady', turn: base(), events: clone(F.try.events),
    expect: ['【马二进三】走得稳，没有毛病。', '【马二进三】可行。', '稳当的一步。', '【马二进三】，不急不躁。', '这步扎实。', '【马二进三】没问题。'] },
  { name: 'try.missed', row: 'try.missed', turn: base(), events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 160, does: [{ k: 'quiet' }], toward: { area: 'left', theme: 'fork' }, chance: 'missed' })],
    expect: ['【兵三进一】没危险，可左翼有个机会。', '别急，左翼还有便宜没占。', '【兵三进一】稳，但错过了左翼的机会。'] },
  // 可己方九宫有个机会 is not said (CONTRACT-NOTES 138): the area of the child's own palace or back rows is not named
  { name: 'try.missed, the better idea lies in the child\'s own palace', row: 'try.missed', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 160, does: [{ k: 'quiet' }], toward: { area: 'my_palace', theme: 'capture' }, chance: 'missed' })],
    expect: ['【兵三进一】没危险，可还有个机会没抓。', '别急，还有便宜没占。', '【兵三进一】稳，但错过了一个机会。'] },
  { name: 'try.missed, the announced chance lies in the child\'s own back rows', row: 'try.missed',
    turn: turnWith({ chance: { size: 'piece', theme: 'capture', area: 'my_back' }, known: { threats: true, chance: true } }),
    events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 160, does: [{ k: 'quiet' }], toward: null, chance: 'missed' })],
    expect: ['【兵三进一】没危险，可还有个机会没抓。', '别急，还有便宜没占。', '【兵三进一】稳，但错过了一个机会。'] },
  { name: 'try.ok', row: 'try.ok', turn: base(), events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 80, does: [{ k: 'quiet' }] })],
    expect: ['【兵三进一】可以走，不吃亏。', '【兵三进一】稳，但略慢。', '可行，只是不够紧。'] },
  { name: 'try.ok (with toward.area)', row: 'try.ok', turn: base(), events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 80, does: [{ k: 'quiet' }], toward: { area: 'right', theme: 'develop' } })],
    expect: ['【兵三进一】可以走，不吃亏。', '【兵三进一】稳，但略慢。', '可行，只是不够紧。', '【兵三进一】不坏，右翼还有更积极的走法。', '能走。不过右翼更有戏。', '【兵三进一】平平，再看看右翼？'] },
  { name: 'try.slow', row: 'try.slow', turn: base(), events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'mistake', loss: 300, does: [{ k: 'quiet' }], flaws: [{ k: 'miss_capture', on: P('opp', 'H', 3) }] })],
    expect: ['【兵三进一】慢了一点：错过了白吃对方的3路马的机会。', '【兵三进一】有点可惜：漏吃。', '这步漏吃，再想想？', '【兵三进一】不够好：漏吃。', '错过了白吃对方的3路马的机会，换一步看看？', '【兵三进一】错过了更好的。'] },

  // ---- ask (cap 50; why 90; free 70) ----
  { name: 'ask good: brilliant', row: 'ask.good', turn: base(), events: [OPP_SILENT, spoken(tryEvent({ cat: 'brilliant' })), ask('good')], expect: ['【马二进三】是妙手，难得一见。'] },
  { name: 'ask good: best', row: 'ask.good', turn: base(), events: [OPP_SILENT, spoken(tryEvent({ cat: 'best' })), ask('good')], expect: ['【马二进三】是眼下最好的一步。'] },
  { name: 'ask good: good', row: 'ask.good', turn: base(), events: [OPP_SILENT, spoken(tryEvent({ cat: 'good' })), ask('good')], expect: ['【马二进三】稳健，可以走。'] },
  { name: 'ask good: ok', row: 'ask.good', turn: base(), events: [OPP_SILENT, spoken(tryEvent({ cat: 'ok' })), ask('good')], expect: ['【马二进三】稍慢，但不算错。'] },
  { name: 'ask good: mistake, netClause(cost)', row: 'ask.good', turn: base(), events: [OPP_SILENT, HELD_TRY, ask('good')], expect: ['【炮五进四】是失误：你吃到一个卒，丢掉一个炮，算下来亏了。'] },
  { name: 'ask good: blunder, effectClause(flaws[0])', row: 'ask.good', turn: base(), events: [OPP_SILENT, spoken(MATE_TRY()), ask('good')], expect: ['【仕四进五】是漏着：这步走完，对方就有杀棋。'] },
  // 稳健，可以走 is not said of a move after which a piece falls, or in a position that stays 很危险 (CONTRACT-NOTES 148);
  // 是眼下最好的一步 stays: it is true
  { name: 'ask good: good, behind, its line still costs a piece', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵七平八', cat: 'good', eval: { b: 'worse' }, does: [{ k: 'quiet' }], cost: { gain: [], lose: ['H'], cp: -400 } })), ask('good')],
    expect: ['【兵七平八】没有走错，只是局面吃紧。'] },
  // ... 局面吃紧 only where the child is in trouble after the move: in a level or a winning position the line gives
  // material back, and that is what is said (CONTRACT-NOTES 150)
  { name: 'ask good: good, level, its line still costs a piece', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵七平八', cat: 'good', does: [{ k: 'quiet' }], cost: { gain: [], lose: ['H'], cp: -400 } })), ask('good')],
    expect: ['【兵七平八】没有走错，只是要丢点子。'] },
  { name: 'ask good: good, winning, its line gives a pawn back', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵三进一', cat: 'good', loss: 160, eval: { b: 'won' }, does: [{ k: 'cross_river', by: P('me', 'P', 3) }], cost: { gain: [], lose: ['A'], cp: -200 } })), ask('good')],
    expect: ['【兵三进一】没有走错，只是要丢点子。'] },
  { name: 'ask good: best, winning, its line gives a pawn back', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵三进一', eval: { b: 'won' }, does: [{ k: 'quiet' }], cost: { gain: [], lose: ['A'], cp: -200 } })), ask('good')],
    expect: ['【兵三进一】是眼下最好的一步。'] },
  { name: 'ask good: good, far behind', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '帅六平五', cat: 'good', eval: { b: 'lost' }, does: [{ k: 'quiet' }] })), ask('good')],
    expect: ['【帅六平五】没有走错，只是局面吃紧。'] },
  { name: 'ask good: good, far behind, but it wins material back', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮五进四', cat: 'good', eval: { b: 'lost' }, does: [{ k: 'capture', by: P('me', 'C', 5), on: P('opp', 'P', 5) }], cost: { gain: ['P'], lose: [], cp: 100 } })), ask('good')],
    expect: ['【炮五进四】稳健，可以走。'] },
  { name: 'ask good: best, far behind', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '帅五平四', eval: { b: 'lost' }, does: [{ k: 'quiet' }] })), ask('good')],
    expect: ['【帅五平四】是眼下最好的一步。'] },
  // first his reply, then what follows it (CONTRACT-NOTES 147): the outcome is introduced by 之后
  { name: 'ask reply (section 9.5)', row: 'ask.reply', turn: base(), events: clone(F.tryHeldAsk.events), expect: ['对方多半走【马7进5】，之后你吃到一个卒，丢掉一个炮，算下来亏了。'] },
  { name: 'ask reply: a quiet line', row: 'ask.reply', turn: base(), events: [OPP_SILENT, spoken(clone(F.try.events[1])), ask('reply', { more: { better: [] } })], expect: ['对方多半走【车9平8】，之后双方都没有丢子。'] },
  // 对方多半走【马8进7】，你白吃一个卒 read as if his reply gave the pawn away: the child can take it afterwards
  { name: 'ask reply: the child wins something after his reply', row: 'ask.reply', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '马二进三', reply: { first: 'opp', moves: ['马8进7', '炮五进四'], net: { gain: ['P'], lose: [], cp: 100 }, end: 'quiet' } })), ask('reply')],
    expect: ['对方多半走【马8进7】，之后你能白吃一个卒。'] },
  { name: 'ask reply: the child loses something after his reply', row: 'ask.reply', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '车一平二', cat: 'ok', loss: 90, reply: { first: 'opp', moves: ['炮7平1'], net: { gain: [], lose: ['H'], cp: -400 }, end: 'quiet' } })), ask('reply')],
    expect: ['对方多半走【炮7平1】，之后你白丢一个马。'] },
  // 之后 and 最后 do not go together: a line that ends in mate with nothing changing hands says 最后… alone
  { name: 'ask reply: the line ends in mate', row: 'ask.reply', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '车二进七', cat: 'brilliant', eval: { b: 'won', mate: 1 }, does: [{ k: 'check', by: P('me', 'R', 2) }],
      reply: { first: 'opp', moves: ['将5进1', '车二退一'], net: NET0, end: 'mate' } })), ask('reply')],
    expect: ['对方多半走【将5进1】，最后你将死对方。'] },
  { name: 'ask reply: the line wins a piece and ends in mate', row: 'ask.reply', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '车二进七', cat: 'brilliant', eval: { b: 'won', mate: 2 }, does: [{ k: 'check', by: P('me', 'R', 2) }],
      reply: { first: 'opp', moves: ['士5退4', '车二平四', '将5进1', '车四退一'], net: { gain: ['A'], lose: [], cp: 200 }, end: 'mate' } })), ask('reply')],
    expect: ['对方多半走【士5退4】，之后你能白吃一个士，最后将死对方。'] },
  { name: 'ask reply: no reply line', row: 'ask.reply', turn: base(), events: [OPP_SILENT, spoken(tryEvent()), ask('reply', { more: { better: [] } })], expect: ['对方没有特别厉害的应对。'] },
  { name: 'ask better', row: 'ask.better', turn: base(), events: [OPP_SILENT, HELD_TRY, ask('better', { more: clone(MORE) })], expect: ['更好的是【马二进三】：你的三路马出动。之后双方都没有丢子。'] },
  // what follows the better move reads as a sequence too: 之后你能白吃…, and 最后… when its line ends in mate
  { name: 'ask better: its line wins something', row: 'ask.better', turn: base(),
    events: [OPP_SILENT, HELD_TRY, ask('better', { more: { reply: clone(MORE.reply), better: [{ move: '马三进四', gain: 500, does: [FORK],
      line: { first: 'opp', moves: ['车3平2', '马四进三'], net: { gain: ['C'], lose: [], cp: 450 }, end: 'quiet' } }] } })],
    expect: ['更好的是【马三进四】：你的四路马同时捉住对方的3路车和7路炮，只能救一个。之后你能白吃一个炮。'] },
  { name: 'ask better: its line ends in mate', row: 'ask.better', turn: base(),
    events: [OPP_SILENT, HELD_TRY, ask('better', { more: { reply: clone(MORE.reply), better: [{ move: '车二进七', gain: 2000, does: [{ k: 'check', by: P('me', 'R', 2) }],
      line: { first: 'opp', moves: ['将5进1', '车二退一'], net: NET0, end: 'mate' } }] } })],
    expect: ['更好的是【车二进七】：你的二路车将军。最后你将死对方。'] },
  { name: 'ask better: no line', row: 'ask.better', turn: base(), events: [OPP_SILENT, HELD_TRY, ask('better', { more: { reply: clone(MORE.reply), better: [{ ...clone(MORE.better[0]), line: null }] } })], expect: ['更好的是【马二进三】：你的三路马出动。'] },
  { name: 'ask better: nothing better', row: 'ask.better', turn: base(), events: [OPP_SILENT, spoken(tryEvent()), ask('better', { more: { better: [] } })], expect: ['亮没找到更好的了，就它。'] },
  { name: 'ask why: a try with flaws', row: 'ask.why', turn: base(), events: [OPP_SILENT, HELD_TRY, ask('why', { more: clone(MORE) })],
    expect: ['因为对方的5路卒有7路马保护，你的五路炮吃了它会被吃回。对方走【马7进5】之后，你吃到一个卒，丢掉一个炮，算下来亏了。'] },
  // what the child wins after his answer is something the child can then take (…之后，你能白吃一个卒), not a gift of his move
  { name: 'ask why: a try with a flaw whose reply line wins something for the child', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵三进一', cat: 'mistake', loss: 200, does: [{ k: 'quiet' }], flaws: [{ k: 'waste' }],
      reply: { first: 'opp', moves: ['卒7进1', '兵三进一'], net: { gain: ['P'], lose: [], cp: 100 }, end: 'quiet' } })), ask('why')],
    expect: ['因为这步没有实际作用，白让对方走一步。对方走【卒7进1】之后，你能白吃一个卒。'] },
  // The reason for a slow move is a reason (CONTRACT-NOTES 147): about a 缓着 that does nothing in particular, what the
  // better move would have done, when the thread knows one with an effect; else that the move asks the rival no question.
  { name: 'ask why: a slow quiet move, a better move with an effect is known', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮八进三', cat: 'ok', loss: 90, does: [{ k: 'quiet' }] })),
      spoken(ask('good', { i: 2 })), ask('why', { i: 3, more: { better: [{ move: '马八进七', gain: 90, does: [{ k: 'develop', by: P('me', 'H', 7) }], line: null }] } })],
    expect: ['因为【马八进七】更紧：你的七路马出动。'] },
  { name: 'ask why: a slow quiet move, the better move is a quiet one too', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮八进三', cat: 'ok', loss: 90, does: [{ k: 'quiet' }] })),
      ask('why', { more: { better: [{ move: '帅五退一', gain: 90, does: [{ k: 'quiet' }], line: null }] } })],
    expect: ['这步没有错，只是没给对方出难题。'] },
  { name: 'ask why: a slow quiet move, nothing better is known', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮八进三', cat: 'ok', loss: 90, does: [{ k: 'quiet' }] })), ask('why', { more: { better: [] } })],
    expect: ['这步没有错，只是没给对方出难题。'] },
  { name: 'ask why: a slow quiet move, the withheld packet never came', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮八进三', cat: 'ok', loss: 90, does: [{ k: 'quiet' }] })), ask('why')],
    expect: ['这步没有错，只是没给对方出难题。'] },
  // The best there was in a position that stays bad, doing nothing in particular: 因为调整了一下阵形 is no reason for
  // 是眼下最好的一步 (CONTRACT-NOTES 148). With an effect of its own the effect stays the answer.
  { name: 'ask why: a quiet best move, far behind', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '帅五平四', eval: { b: 'lost' }, does: [{ k: 'quiet' }] })), ask('why')],
    expect: ['因为眼下没有明显更好的走法。'] },
  // 没有明显更好的走法 is said of a 稳健 move only when the thread knows that no better move is listed: the next chip
  // (有更好的吗？) must not name one right after it (CONTRACT-NOTES 150). With a better move listed the answer is that of a
  // slow move; so it is while the list has not arrived.
  { name: 'ask why: a good move without an effect whose line costs a piece, nothing better is listed', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵七平八', cat: 'good', does: [], cost: { gain: [], lose: ['H'], cp: -400 } })), ask('why', { more: { better: [] } })],
    expect: ['因为眼下没有明显更好的走法。'] },
  { name: 'ask why: a quiet good move far behind, a better move with an effect is listed', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮二平四', cat: 'good', loss: 82, eval: { b: 'lost' }, does: [{ k: 'quiet' }] })),
      ask('why', { more: { better: [{ move: '炮二平一', gain: 82, does: [{ k: 'cannon_mount', by: P('me', 'C', 1), on: P('opp', 'R', 9), on2: P('opp', 'P', 9) }], line: null }] } })],
    expect: ['因为【炮二平一】更紧：你的一路炮借对方的9路卒当炮架，瞄着9路车。'] },
  { name: 'ask why: a quiet good move far behind, the better move that is listed is a quiet one too', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮二平四', cat: 'good', loss: 82, eval: { b: 'lost' }, does: [{ k: 'quiet' }] })),
      ask('why', { more: { better: [{ move: '帅五退一', gain: 82, does: [{ k: 'quiet' }], line: null }] } })],
    expect: ['这步没有错，只是没给对方出难题。'] },
  { name: 'ask why: a quiet good move far behind, the list of better moves has not arrived', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮二平四', cat: 'good', loss: 82, eval: { b: 'lost' }, does: [{ k: 'quiet' }] })), ask('why')],
    expect: ['这步没有错，只是没给对方出难题。'] },
  { name: 'ask why: a quiet good move far behind, the better move was named by an earlier chip', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮二平四', cat: 'good', loss: 82, eval: { b: 'lost' }, does: [{ k: 'quiet' }] })),
      spoken(ask('better', { i: 2, more: { better: [{ move: '炮二平一', gain: 82, does: [{ k: 'attack', by: P('me', 'C', 1), on: P('opp', 'R', 9) }], line: null }] } })), ask('why', { i: 3 })],
    expect: ['因为【炮二平一】更紧：你的一路炮捉对方的9路车。'] },
  // the tactic of a move after which the child is mated is no reason for anything (item 150)
  { name: 'ask why: the child is mated after the move, a fork', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '马六退七', eval: { b: 'lost', mate: -1 }, does: [{ k: 'fork', by: P('me', 'H', 7), on: P('opp', 'R', 7), on2: P('opp', 'C', 5) }] })), ask('why')],
    expect: ['因为眼下没有明显更好的走法。'] },
  { name: 'ask why: a best move with an effect, far behind', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '仕六进五', eval: { b: 'lost' }, does: [{ k: 'defend', on: P('me', 'A', 4) }] })), ask('why')],
    expect: ['因为给你的四路仕补上保护。'] },
  { name: 'ask why: a quiet best move of a level position', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '帅五平四', does: [{ k: 'quiet' }] })), ask('why')],
    expect: ['因为调整了一下阵形。'] },
  // a slow move with an effect of its own keeps that effect as its answer, and so does a quiet move that is not slow
  { name: 'ask why: a slow move with an effect of its own', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '炮六平八', cat: 'ok', loss: 90, does: [{ k: 'restrict_king', on: P('opp', 'K', 5) }] })),
      ask('why', { more: { better: [{ move: '马八进七', gain: 90, does: [{ k: 'develop', by: P('me', 'H', 7) }], line: null }] } })],
    expect: ['因为封住了对方的将的一条退路。'] },
  { name: 'ask why: a quiet move that is the best there is', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '仕四进五', cat: 'best', does: [{ k: 'quiet' }] })), ask('why', { more: { better: [] } })],
    expect: ['因为调整了一下阵形。'] },
  { name: 'ask why: a try with flaws, no reply line', row: 'ask.why', turn: base(), events: [OPP_SILENT, spoken(tryEvent({ move: '兵三进一', cat: 'mistake', loss: 300, does: [{ k: 'quiet' }], flaws: [{ k: 'waste' }] })), ask('why')],
    expect: ['因为这步没有实际作用，白让对方走一步。'] },
  { name: 'ask why: a try without flaws', row: 'ask.why', turn: base(), events: [OPP_SILENT, spoken(clone(F.try.events[1])), ask('why')], expect: ['因为你的三路马出动。'] },
  { name: 'ask why: a mistake without a named flaw, the reply costs something', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵五进一', cat: 'mistake', loss: 200, does: [{ k: 'attack', by: P('me', 'P', 5), on: P('opp', 'P', 5) }], cost: { gain: [], lose: ['P'], cp: -100 },
      reply: { first: 'opp', moves: ['卒5进1'], net: { gain: [], lose: ['P'], cp: -100 }, end: 'quiet' } })), ask('why')],
    expect: ['因为对方走【卒5进1】之后，你白丢一个兵。'] },
  { name: 'ask why: a mistake without a named flaw, nothing is lost', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '兵五进一', cat: 'mistake', loss: 200, does: [{ k: 'attack', by: P('me', 'P', 5), on: P('opp', 'P', 5) }],
      reply: { first: 'opp', moves: ['卒5进1'], net: NET0, end: 'quiet' } })), ask('why')],
    expect: ['【兵五进一】是失误。'] },
  // a balance that reads 大致相当 is no reason for a mistake (因为…你吃到一个马，丢掉一个炮，大致相当。): the verdict alone
  { name: 'ask why: a mistake without a named flaw, the reply reads even', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '车一进二', cat: 'mistake', loss: 200, does: [{ k: 'develop', by: P('me', 'R', 1) }], cost: { gain: ['H'], lose: ['C'], cp: -50 },
      reply: { first: 'opp', moves: ['炮8平7'], net: { gain: ['H'], lose: ['C'], cp: -50 }, end: 'quiet' } })), ask('why')],
    expect: ['【车一进二】是失误。'] },
  { name: 'ask why: a mistake without a named flaw, the reply comes out behind', row: 'ask.why', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '车一进二', cat: 'mistake', loss: 200, does: [{ k: 'develop', by: P('me', 'R', 1) }], cost: { gain: ['P'], lose: ['C'], cp: -350 },
      reply: { first: 'opp', moves: ['炮8平7'], net: { gain: ['P'], lose: ['C'], cp: -350 }, end: 'quiet' } })), ask('why')],
    expect: ['因为对方走【炮8平7】之后，你吃到一个卒，丢掉一个炮，算下来亏了。'] },
  { name: 'ask good: a mistake without a named flaw whose balance reads even', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '车一进二', cat: 'mistake', loss: 200, does: [{ k: 'develop', by: P('me', 'R', 1) }], cost: { gain: ['H'], lose: ['C'], cp: -50 } })), ask('good')],
    expect: ['【车一进二】是失误。'] },
  { name: 'ask good: a mistake whose balance reads even, with a flaw', row: 'ask.good', turn: base(),
    events: [OPP_SILENT, spoken(tryEvent({ move: '车一进二', cat: 'mistake', loss: 200, does: [{ k: 'develop', by: P('me', 'R', 1) }], flaws: [{ k: 'waste' }], cost: { gain: ['H'], lose: ['C'], cp: -50 } })), ask('good')],
    expect: ['【车一进二】是失误：这步没有实际作用，白让对方走一步。'] },
  { name: 'ask why: no try (the intent sentence)', row: 'ask.why', turn: clone(F.opp.turn), events: [spoken({ i: 0, kind: 'opp' }), ask('why')], expect: ['对方下一步想走【炮5进4】，那样你白丢一个兵。'] },
  { name: 'ask show', row: 'ask.show', turn: base(), events: [OPP_SILENT, spoken(HANG_TRY()), ask('show', { more: { reply: { first: 'opp', moves: ['炮2进3'], net: { gain: [], lose: ['H'], cp: -400 }, end: 'quiet' }, better: [] } })],
    expect: ['是对方的2路炮在威胁。它会走【炮2进3】，之后你白丢一个马。'] },
  { name: 'ask intent: a mate threat', row: 'ask.intent', turn: turnWith({ threats: [MATE_THREAT] }), events: [OPP_SILENT, ask('intent')], expect: ['对方下一步想走【车2进7】，那就是杀棋。'] },
  { name: 'ask intent: another threat', row: 'ask.intent', turn: clone(F.opp.turn), events: [OPP_SILENT, ask('intent')], expect: ['对方下一步想走【炮5进4】，那样你白丢一个兵。'] },
  { name: 'ask intent: opp.does (section 9.7)', row: 'ask.intent', turn: clone(F.askChip.turn), events: clone(F.askChip.events), expect: ['对方这步的用意：7路马出动。'] },
  { name: 'ask intent: opp.does, a move that left a hole', row: 'ask.intent', turn: oppTurn({ quality: 'slip', does: [{ k: 'develop', by: P('opp', 'H', 7) }] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方这步的用意：7路马出动。不过这步有漏洞。'] },
  { name: 'ask intent: opp.does, a soft move', row: 'ask.intent', turn: oppTurn({ quality: 'soft', does: [{ k: 'develop', by: P('opp', 'H', 7) }] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方这步的用意：7路马出动。不过这步走得偏软。'] },
  { name: 'ask intent: another threat, after a move that left a hole', row: 'ask.intent', turn: oppTurn({ quality: 'slip' }, { threats: [PIECE_THREAT] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方下一步想走【马6进5】，那样你白丢一个炮。不过对方刚走的这步有漏洞。'] },
  { name: 'ask intent: another threat, after a soft move', row: 'ask.intent', turn: oppTurn({ quality: 'soft' }, { threats: [PIECE_THREAT] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方下一步想走【马6进5】，那样你白丢一个炮。不过对方刚走的这步偏软。'] },
  { name: 'ask intent: a move that passed something up', row: 'ask.intent', turn: oppTurn({ move: '卒3进1', quality: 'slip', overlooked: { on: P('me', 'H', 8), move: '炮2进7' }, does: [{ k: 'cross_river', by: P('opp', 'P', 3) }] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方这步的用意：3路卒过了河，之后可以横走。不过对方刚才漏看了一步。'] },
  // whose piece (CONTRACT-NOTES 138): in a sentence about the rival his own pieces are 自己的, and the piece that acts has no side word
  { name: 'ask intent: opp.does, a piece of his own is protected', row: 'ask.intent', turn: oppTurn({ move: '炮8进1', does: [{ k: 'defend', on: P('opp', 'P', 5) }] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方这步的用意：给自己的5路卒补上保护。'] },
  { name: 'ask intent: opp.does, his cannon behind his own pawn', row: 'ask.intent', events: [OPP_SILENT, ask('intent')],
    turn: oppTurn({ move: '炮8平5', does: [{ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5), on2: P('opp', 'P', 5) }] }),
    expect: ['对方这步的用意：5路炮借自己的5路卒当炮架，瞄着你的五路兵。'] },
  { name: 'ask intent: opp.does, a piece of the child is attacked', row: 'ask.intent', turn: oppTurn({ move: '车9平8', does: [{ k: 'attack', by: P('opp', 'R', 8), on: P('me', 'H', 3) }] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方这步的用意：8路车捉你的三路马。'] },
  { name: 'ask intent: nothing, known, a move that left a hole', row: 'ask.intent', turn: oppTurn({ quality: 'slip', does: [] }), events: [OPP_SILENT, ask('intent')], expect: ['对方眼下没有直接的威胁，是在调整阵形。不过这步有漏洞。'] },
  { name: 'ask intent: nothing, known', row: 'ask.intent', turn: oppTurn({ does: [] }), events: [OPP_SILENT, ask('intent')], expect: ['对方眼下没有直接的威胁，是在调整阵形。'] },
  { name: 'ask intent: nothing, not known', row: 'ask.intent', turn: oppTurn({ does: [] }, { known: { threats: false, chance: false } }), events: [OPP_SILENT, ask('intent')], expect: ['亮还在沙盘上摆，眼下没看到直接的威胁。'] },
  { name: 'ask score: even', row: 'ask.score', turn: base(), events: [OPP_SILENT, ask('score')], expect: ['现在均势。双方子力相当。'] },
  { name: 'ask score: ahead', row: 'ask.score', turn: turnWith({ eval: { b: 'better' }, mat: { me: 'R2H2C2P5A2E2', opp: 'R2H1C2P5A2E2', cp: 400 } }), events: [OPP_SILENT, ask('score')], expect: ['现在占优。你大约多一个马或炮。'] },
  { name: 'ask score: behind', row: 'ask.score', turn: turnWith({ eval: { b: 'worse' }, mat: { me: 'R2H2C2P4A2E2', opp: 'R2H2C2P5A2E2', cp: -100 } }), events: [OPP_SILENT, ask('score')], expect: ['现在落了下风。你大约少一个兵。'] },
  { name: 'ask score: a mate', row: 'ask.score', turn: turnWith({ eval: { b: 'won', mate: 3 }, mat: { me: 'R2H2C2P5A2E2', opp: 'R1H1C2P5A2E2', cp: 1300 } }), events: [OPP_SILENT, ask('score')], expect: ['现在3步之内可以将死对方。你多一个车以上。'] },
  { name: 'ask danger: a threat', row: 'ask.danger', turn: clone(F.opp.turn), events: [OPP_SILENT, ask('danger')], expect: ['要当心：对方的5路炮瞄着你的五路兵。'] },
  ...Object.entries({
    // an attack is told as a capture that then pays (the piece may aim at its target already; the move makes it worth it)
    attack: '要当心：对方想走【马6进5】，走完他的6路马就能吃掉你的五路炮了。',
    cannon_mount: '要当心：对方想走【马6进5】，走完他的6路马就能吃掉你的五路炮了。',
    check: '要当心：对方想走【马6进5】，走完就是将军。',
    fork: '要当心：对方想走【马6进5】，走完他的6路马就同时捉住你的五路炮和另一个子了。',
    discovered: '要当心：对方想走【马6进5】，走完后面的子就打到你的五路炮了。',
    pin: '要当心：对方想走【马6进5】，走完他的6路马就牵住你的五路炮了。',
  }).map(([k, text]) => ({ name: `ask danger: a threat that does not stand yet (${k})`, row: 'ask.danger', turn: turnWith({ threats: [{ ...PIECE_THREAT, k, prep: true }] }),
    events: [OPP_SILENT, ask('danger')], expect: [text] })),
  // a fork whose other target is the king (its name says so: a Threat has no on2) is a check that also attacks the piece
  { name: 'ask danger: a threat that does not stand yet (a fork with check)', row: 'ask.danger', turn: turnWith({ threats: [{ ...PIECE_THREAT, k: 'fork', name: 'check_fork', prep: true }] }),
    events: [OPP_SILENT, ask('danger')], expect: ['要当心：对方想走【马6进5】，走完他的6路马就将军，同时捉住你的五路炮。'] },
  { name: 'ask danger: none, known', row: 'ask.danger', turn: base(), events: [OPP_SILENT, ask('danger')], expect: ['眼下没有直接的危险，可以放心走。'] },
  { name: 'ask danger: none, not known', row: 'ask.danger', turn: turnWith({ known: { threats: false, chance: false } }), events: [OPP_SILENT, ask('danger')], expect: ['亮还在看，眼下没发现直接的危险。'] },
  { name: 'ask last: mine.try', row: 'ask.last', turn: turnWith({ mine: MINE_BEST }), events: [OPP_SILENT, ask('last')], expect: ['【炮二平五】是眼下最好的一步。你的五路炮借你的五路兵当炮架，瞄着对方的5路卒。'] },
  { name: 'ask last: mine.try, a mistake', row: 'ask.last', turn: turnWith({ mine: MINE_MISTAKE }), events: [OPP_SILENT, ask('last')], expect: ['【炮五进四】是失误：你吃到一个卒，丢掉一个炮，算下来亏了。'] },
  // ... also when the flaw is the reason: the effect would tell of a piece that may be gone (是漏着：你白丢一个车。你的五路车将军。)
  { name: 'ask last: mine.try, a blunder with a flaw whose piece gave check', row: 'ask.last', events: [OPP_SILENT, ask('last')],
    turn: turnWith({ mine: { move: '车五进三', cat: 'blunder', waited: true, self: true, try: { ...clone(MINE_BEST.try), move: '车五进三', cat: 'blunder', loss: 900,
      does: [{ k: 'check', by: P('me', 'R', 5) }], flaws: [{ k: 'hang', on: P('me', 'R', 5), by: P('opp', 'A', 4) }], cost: { gain: [], lose: ['R'], cp: -900 } } } }),
    expect: ['【车五进三】是漏着：你白丢一个车。'] },
  { name: 'ask last: mine.try, a blunder without a named flaw', row: 'ask.last', events: [OPP_SILENT, ask('last')],
    turn: turnWith({ mine: { move: '兵五进一', cat: 'blunder', waited: true, self: true, try: { ...clone(MINE_BEST.try), move: '兵五进一', cat: 'blunder', loss: 400,
      does: [{ k: 'attack', by: P('me', 'P', 5), on: P('opp', 'P', 5) }], flaws: [] } } }), expect: ['【兵五进一】是漏着。'] },
  { name: 'ask last: mine.try, a steady move with nothing to praise', row: 'ask.last', events: [OPP_SILENT, ask('last')],
    turn: turnWith({ mine: { move: '兵七平八', cat: 'good', waited: true, self: true, try: { ...clone(MINE_BEST.try), move: '兵七平八', cat: 'good', loss: 30,
      eval: { b: 'lost' }, does: [{ k: 'escape', by: P('me', 'P', 8) }] } } }),
    expect: ['【兵七平八】没有走错，只是局面吃紧。你的八路兵躲开了攻击。'] },
  // ... 只是要丢点子 where the child is not in trouble after the move (CONTRACT-NOTES 150)
  { name: 'ask last: mine.try, a steady move whose line gives material back in a winning position', row: 'ask.last', events: [OPP_SILENT, ask('last')],
    turn: turnWith({ mine: { move: '兵三进一', cat: 'good', waited: true, self: true, try: { ...clone(MINE_BEST.try), move: '兵三进一', cat: 'good', loss: 160,
      eval: { b: 'won' }, does: [{ k: 'cross_river', by: P('me', 'P', 3) }], cost: { gain: [], lose: ['A'], cp: -200 } } } }),
    expect: ['【兵三进一】没有走错，只是要丢点子。你的三路兵过了河，之后可以横走。'] },
  // ... and the tactic of a move after which the child is mated is not told
  { name: 'ask last: mine.try, the child is mated after the move', row: 'ask.last', events: [OPP_SILENT, ask('last')],
    turn: turnWith({ mine: { move: '马六退七', cat: 'best', waited: true, self: true, try: { ...clone(MINE_BEST.try), move: '马六退七',
      eval: { b: 'lost', mate: -1 }, does: [{ k: 'fork', by: P('me', 'H', 7), on: P('opp', 'R', 7), on2: P('opp', 'C', 5) }] } } }),
    expect: ['【马六退七】是眼下最好的一步。'] },
  { name: 'ask last: mine without try', row: 'ask.last', turn: base(), events: [OPP_SILENT, ask('last')], expect: ['【炮二平五】是好棋。'] },
  { name: 'ask last: no mine', row: 'ask.last', turn: clone(F.start.turn), events: [spoken({ i: 0, kind: 'start' }), ask('last')], expect: ['这才刚开局呢。'] },
  { name: 'ask proud', row: 'ask.proud', turn: overTurn(), events: overThread('proud'), expect: ['第18回合的【马三进四】最漂亮：捉双。'] },
  { name: 'ask proud: none', row: 'ask.proud', turn: overTurn(), events: overThread('proud', { proud: null, moves: 12, stats: { good: 12, taken: 0, captures: 2, brilliant: 0 } }),
    expect: ['这盘每一步都走得很稳。'] },
  { name: 'ask proud: none, not every move was steady', row: 'ask.proud', turn: overTurn(), events: overThread('proud', { proud: null }), expect: ['这盘还没走出最漂亮的一步，下一盘咱们一起找。'] },
  { name: 'ask improve', row: 'ask.improve', turn: overTurn(), events: overThread('improve'), expect: ['第2回合的【炮五进四】可以更好，换成【马二进三】就对了。'] },
  { name: 'ask improve: no better move', row: 'ask.improve', turn: overTurn(), events: overThread('improve', { takeaway: { kind: 'habit', code: 'greedy', n: 2, ex: { n: 2, move: '炮五进四' } } }), expect: ['第2回合的【炮五进四】可以更好。'] },
  { name: 'ask improve: none', row: 'ask.improve', turn: overTurn(), events: overThread('improve', { takeaway: { kind: 'strength', code: 'S_steady' } }), expect: ['这盘没什么大毛病。'] },
  { name: 'ask next', row: 'ask.next', turn: overTurn(), events: overThread('next'), expect: ['下一盘记住一件事——吃子之前，先看它有没有保镖。'] },
  { name: 'ask next: none', row: 'ask.next', turn: overTurn(), events: overThread('next', { goal: null }), expect: ['下一盘照这样下就行。'] },
  { name: 'ask free', row: 'ask.free', turn: base(), events: [OPP_SILENT, ask('free', { say: '如果我走马二进三，对方走炮2平5呢？' })],
    expect: ['这个亮一时答不上来。小主公在棋盘上试走一下，亮就能看明白。', '这件事亮帮不上忙。要是心里有事，记得找爸爸妈妈或老师说说。咱们接着看棋？'] },

  // ---- over (cap 80) ----
  { name: 'over: win (section 9.8)', row: 'over', turn: overTurn(), events: clone(F.over.events),
    expect: ['这盘赢得漂亮！第18回合的【马三进四】最漂亮：捉双。兵法升到「初露锋芒」！'] },
  { name: 'over: win, the goal was kept', row: 'over', turn: overTurn(), events: [overEvent({ kept: true })],
    expect: ['这盘赢得漂亮！上盘说好的，做到了！第18回合的【马三进四】最漂亮：捉双。兵法升到「初露锋芒」！'] },
  { name: 'over: loss', row: 'over', turn: overTurn(), events: [overEvent({ result: 'loss', kept: false, goal: 'miss_threat', rank: null }, 'lose')],
    expect: ['这盘惜败，不过有几步走得真不错。第18回合的【马三进四】最漂亮：捉双。'] },
  // a lost game without a proud move (CONTRACT-NOTES 138): the line does not invent one, and the goal is left to the card
  { name: 'over: loss, no proud move', row: 'over', turn: overTurn(), events: [overEvent({ result: 'loss', kept: null, proud: null, goal: 'miss_threat', rank: null }, 'lose')],
    expect: ['这盘惜败，不过有几步走得真不错。'] },
  // a lost game with nothing to point at (CONTRACT-NOTES 147): 这盘惜败。 does not stand alone in the takeaway box
  { name: 'over: loss, nothing to point at', row: 'over', turn: overTurn(),
    events: [overEvent({ result: 'loss', reason: 'resign', moves: 3, stats: { good: 1, taken: 0, captures: 0, brilliant: 0 }, takeaway: null, kept: null, proud: null, goal: 'hang_piece', rank: null }, 'lose')],
    expect: ['这盘惜败。每一盘都是练兵，下一盘再战。'] },
  { name: 'over: draw', row: 'over', turn: overTurn(), events: [overEvent({ result: 'draw', reason: 'repetition', takeaway: null, proud: null, goal: null, rank: null }, null)],
    expect: ['握手言和，旗鼓相当。'] },
]);

const TOOL_VERDICT = deepFreeze(clone(F.resume.resume.results[0].verdict));

/** Cap of the last event: 20 for the guiding question of a held trial, else CAPS by event. */
const capOf = (events) => {
  const last = events[events.length - 1];
  return last.kind === 'try' && last.try.held ? 20 : capFor(last);
};
const BRACKET_RE = /【([^】]*)】/g;
const bracketsOf = (text) => [...text.matchAll(BRACKET_RE)].map((m) => m[1]);
const balanced = (text) => text.replace(BRACKET_RE, '').search(/[【】]/) === -1;

/** Every string in a request that is a notation: what its packets put on the wire. */
function notationsOf(value, found = new Set()) {
  if (typeof value === 'string') { if (NOTATION_RE.test(value)) found.add(value); }
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => notationsOf(v, found));
  return found;
}

function walk(x, fn) {
  if (Array.isArray(x)) x.forEach((y) => walk(y, fn));
  else if (x && typeof x === 'object') { fn(x); Object.values(x).forEach((y) => walk(y, fn)); }
}
/** The same packet with the longest names: every piece carries a 前 word, every area is four characters. */
const lengthened = (g) => {
  const copy = clone(g);
  walk(copy, (o) => {
    if (typeof o.s === 'string' && typeof o.t === 'string' && typeof o.f === 'number' && o.t !== 'K') o.q = 'front';
    if (typeof o.area === 'string') o.area = o.area.startsWith('my_') ? 'my_palace' : 'their_palace';
  });
  return copy;
};
/** The same packet for a child who plays black (names and king character change; the notations are only labels here). */
const blackened = (g) => { const copy = clone(g); copy.turn.me = 'black'; return copy; };

/** A wide set of packets: the golden rows as they are, with the longest names, for a black child; every motif in every clause. */
const SWEEP = (() => {
  const cases = [];
  for (const g of GOLDEN) cases.push(g, lengthened(g), blackened(lengthened(g)));
  const Q = (s, t, f) => P(s, t, f, 'front');
  for (const k of MOTIF_CODES) {
    const mine = { k, by: Q('me', 'H', 8), on: Q('opp', 'C', 7), on2: Q('opp', 'R', 3) };
    const theirs = { k, by: Q('opp', 'H', 8), on: Q('me', 'C', 7), on2: Q('opp', 'R', 3) };
    const hint = hintEvent(3, { move: '马八进七', does: [mine], line: { first: 'opp', moves: ['车9平8'], net: NET0, end: 'quiet' } });
    cases.push(
      { name: `praise ${k}`, turn: base(), events: [OPP_SILENT, tryEvent({ does: [mine] })] },
      { name: `slow ${k}`, turn: base(), events: [OPP_SILENT, tryEvent({ cat: 'mistake', loss: 200, flaws: [theirs] })] },
      { name: `held ${k}`, turn: base(), events: [OPP_SILENT, heldEvent({ flaws: [theirs] })] },
      { name: `opp.effect ${k}`, turn: oppTurn({ does: [theirs] }), events: OPP_LAST },
      { name: `hint3 ${k}`, turn: base(), events: [OPP_SILENT, hint] },
      { name: `intent ${k}`, turn: oppTurn({ does: [theirs] }), events: [OPP_SILENT, ask('intent')] },
      { name: `danger ${k}`, turn: turnWith({ threats: [{ k, by: Q('opp', 'H', 8), on: Q('me', 'C', 7), move: '马8进7', net: { gain: [], lose: ['C'], cp: -450 }, sev: 'piece' }] }), events: [OPP_SILENT, ask('danger')] },
      { name: `danger prep ${k}`, turn: turnWith({ threats: [{ k, by: Q('opp', 'H', 8), on: Q('me', 'C', 7), move: '前卒3进1', net: { gain: [], lose: ['C'], cp: -450 }, sev: 'piece', prep: true }] }), events: [OPP_SILENT, ask('danger')] },
      { name: `danger prep ${k}, no target`, turn: turnWith({ threats: [{ k, by: Q('opp', 'H', 8), move: '前卒3进1', net: { gain: [], lose: ['C'], cp: -450 }, sev: 'piece', prep: true }] }), events: [OPP_SILENT, ask('danger')] },
      { name: `opp.threat prep ${k}`, turn: oppTurn({ does: [theirs] }, { level: 5, threats: [{ k, by: Q('opp', 'H', 8), on: Q('me', 'C', 7), move: '前卒3进1', net: { gain: [], lose: ['C'], cp: -450 }, sev: 'rook', prep: true }] }), events: OPP_LAST },
      { name: `intent slip ${k}`, turn: oppTurn({ does: [theirs], quality: 'slip' }), events: [OPP_SILENT, ask('intent')] },
      { name: `intent slip, a threat ${k}`, turn: oppTurn({ does: [theirs], quality: 'slip' }, { threats: [{ k, by: Q('opp', 'H', 8), on: Q('me', 'C', 7), move: '前卒3进1', net: { gain: ['R', 'H', 'C'], lose: ['R', 'H', 'C', 'P'], cp: -450 }, sev: 'piece' }] }), events: [OPP_SILENT, ask('intent')] },
      { name: `why, a blunder without a flaw ${k}`, turn: base(), events: [OPP_SILENT, spoken(tryEvent({ move: '前兵七进一', cat: 'blunder', loss: 500, does: [mine], flaws: [],
        reply: { first: 'opp', moves: ['前卒3进1'], net: { gain: ['P'], lose: ['R', 'H', 'C', 'P', 'A', 'E'], cp: -2000 }, end: 'mate' } })), ask('why')] },
      { name: `last ${k}`, turn: turnWith({ mine: { move: '炮五进四', cat: 'blunder', waited: true, self: true, try: { ...clone(MINE_MISTAKE.try), cat: 'blunder', does: [mine], flaws: [theirs] } } }), events: [OPP_SILENT, ask('last')] },
    );
    for (const code of ['good', 'why', 'show', 'better', 'reply']) {
      const more = clone(MORE);
      more.better[0].does = [mine];
      cases.push({ name: `${code} ${k}`, turn: base(), events: [OPP_SILENT, spoken(heldEvent({ flaws: [theirs] })), ask(code, { more })] });
    }
  }
  for (const name of PATTERN_CODES) cases.push({ name: `opp.name ${name}`, turn: oppTurn({ name }), events: OPP_LAST });
  for (const goal of HABIT_CODES) {
    for (const to of [1, 5, 9]) {
      cases.push({ name: `over ${goal} ${to}`, turn: overTurn(), events: [overEvent({ kept: true, goal, rank: { to }, proud: { n: 118, s: 'me', move: '马三进四', tag: 'great', k: 'bad_trade' } })] });
    }
    cases.push({ name: `next ${goal}`, turn: overTurn(), events: overThread('next', { goal }) });
    // 为什么？ after the game: the habit with the longest example, with and without its fix
    const lesson = { kind: 'habit', code: goal, n: 3, ex: { n: 118, move: '前兵七进一', better: '前炮进四' } };
    cases.push({ name: `over why improve ${goal}`, turn: overTurn(), events: overWhy(['improve'], { goal, takeaway: lesson }) });
    cases.push({ name: `over why next ${goal}`, turn: overTurn(), events: overWhy(['next'], { goal, takeaway: lesson }) });
    cases.push({ name: `over why ${goal}`, turn: overTurn(), events: overWhy([], { goal, takeaway: { kind: 'habit', code: goal, n: 1 } }) });
  }
  for (const k of MOTIF_CODES) cases.push({ name: `over why proud ${k}`, turn: overTurn(), events: overWhy(['proud'], { proud: { n: 118, s: 'me', move: '前兵七进一', tag: 'great', k } }) });
  cases.push({ name: 'over why, nothing concrete', turn: overTurn(), events: overWhy(['next'], { goal: null, takeaway: null, proud: null }) });
  return deepFreeze(cases);
})();

/** Every sentence the narrator can say about the sweep: each case in each variant. */
const sweepTexts = () => {
  const out = [];
  for (const c of SWEEP) {
    for (let v = 0; v < 6; v++) out.push({ name: `${c.name} v${v}`, text: composeLocal(c.turn, c.events, v), cap: capOf(c.events) });
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------------

test('golden sentence for every row of 8.6', () => {
  for (const g of GOLDEN) {
    // the packet is what the wire carries
    const wire = clone(g.events);
    const valid = validateCoachRequest({ v: 1, turn: g.turn, events: wire });
    assert.deepEqual(valid.ok ? null : [valid.path, valid.why], null, `${g.name}: the packet validates`);

    g.expect.forEach((text, v) => assert.equal(composeLocal(g.turn, g.events, v), text, `${g.name}, variant ${v}`));
    assert.equal(composeLocal(g.turn, g.events), g.expect[0], `${g.name}: the default variant is 0`);
    assert.equal(localLine(g.turn, g.events, []).row, g.row, `${g.name}: row`);
  }

  // v counts modulo the number of variants of the row
  const steady = GOLDEN.find((g) => g.name.startsWith('try.steady'));
  assert.equal(composeLocal(steady.turn, steady.events, 6), steady.expect[0]);
  assert.equal(composeLocal(steady.turn, steady.events, 15), steady.expect[3]);
  const start = GOLDEN.find((g) => g.name === 'start');
  assert.equal(composeLocal(start.turn, start.events, 4), start.expect[1]);

  // the proxy re-creates the guiding question of section 9.5 from its `v` (3): 「这个子，真的没人管吗？」
  const worked = F.tryHeldAsk;
  assert.equal(worked.events[1].v, 3);
  assert.equal(composeLocal(worked.turn, worked.events.slice(0, 2), worked.events[1].v), '这个子，真的没人管吗？');

  // a black child: 将 for the king, digits for the child's files, 汉字 for the rival's
  const black = (g) => blackened(GOLDEN.find((x) => x.name === g));
  let c = black('opp.check');
  assert.equal(composeLocal(c.turn, c.events, 0), '对方将军，先把将护好。');
  c = black('opp.captured');
  assert.equal(composeLocal(c.turn, c.events, 0), '对方吃掉了你的炮。');
  c = black('opp.threat');
  assert.equal(composeLocal(c.turn, c.events, 1), '你的5路炮被盯上了。');
  c = black('held.mate');
  assert.equal(composeLocal(c.turn, c.events, 3), '将还有路可走吗？');
  c = black('held.threat');
  assert.equal(composeLocal(c.turn, c.events, 0), '先看看对方的二路炮正盯着谁？');
  c = blackened({ turn: oppTurn({ move: '炮八平五', captured: 'P', does: [] }), events: OPP_LAST });
  assert.equal(composeLocal(c.turn, c.events, 3), '对方得了一个卒。');
});

test('the first applicable row wins', () => {
  const rowOf = (turn, events = OPP_LAST) => localLine(turn, events, []).row;
  const everything = { move: '车2进7', check: true, captured: 'H', punishes: true, name: 'iron_bolt', overlooked: { on: P('me', 'H', 8), move: '炮2进7' },
    does: [{ k: 'capture', by: P('opp', 'R', 2), on: P('me', 'H', 8) }] };
  const chance = { chance: { size: 'piece', theme: 'fork', area: 'left' }, known: { threats: true, chance: true } };

  // opp: mate threat, check, punished, captured, threat (a question from level 4), overlooked, chance, name, effect, quiet
  assert.equal(rowOf(oppTurn(everything, { threats: [MATE_THREAT, PIECE_THREAT], ...chance })), 'opp.mate');
  assert.equal(rowOf(oppTurn(everything, { threats: [PIECE_THREAT], ...chance })), 'opp.check');
  assert.equal(rowOf(oppTurn({ ...everything, check: false }, { threats: [PIECE_THREAT], ...chance })), 'opp.punished');
  assert.equal(rowOf(oppTurn({ ...everything, check: false, punishes: false }, { threats: [PIECE_THREAT], ...chance })), 'opp.captured');      // a horse fell: the news
  // ... but a rook that can be taken next comes before what was taken (the capture is on the board to see; the rook is the news)
  const ROOK_THREAT = { k: 'attack', by: P('opp', 'H', 6), on: P('me', 'R', 5), move: '马6进5', net: { gain: [], lose: ['R'], cp: -900 }, sev: 'rook' };
  const tookPawn = { move: '车2进7', captured: 'P', does: [{ k: 'capture', by: P('opp', 'R', 2), on: P('me', 'P', 8) }] };
  assert.equal(rowOf(oppTurn(tookPawn, { threats: [ROOK_THREAT], level: 3 })), 'opp.threat');
  assert.equal(rowOf(oppTurn(tookPawn, { threats: [ROOK_THREAT], level: 4 })), 'opp.threat.q');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'R' }, { threats: [ROOK_THREAT], level: 3 })), 'opp.threat');
  assert.equal(composeLocal(oppTurn(tookPawn, { threats: [ROOK_THREAT], level: 3 }), OPP_LAST, 3), '对方想吃你的五路车。');
  // ... and so does a horse or a cannon after a pawn, an advisor or an elephant was taken (CONTRACT-NOTES 138); after a
  // piece of its own size was taken the order of section 8.6 stands, and a threat to a pawn never makes a threat row
  assert.equal(rowOf(oppTurn(tookPawn, { threats: [PIECE_THREAT], level: 3 })), 'opp.threat');
  assert.equal(composeLocal(oppTurn(tookPawn, { threats: [PIECE_THREAT], level: 3 }), OPP_LAST, 0), '对方盯上了你的五路炮。');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'A' }, { threats: [PIECE_THREAT], level: 3 })), 'opp.threat');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'E' }, { threats: [PIECE_THREAT], level: 5 })), 'opp.threat.q');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'H' }, { threats: [PIECE_THREAT], level: 3 })), 'opp.captured', 'a threat of the same size keeps the order of section 8.6');
  assert.equal(rowOf(oppTurn({ ...tookPawn, captured: 'C' }, { threats: [PIECE_THREAT], level: 3 })), 'opp.captured');
  assert.equal(rowOf(oppTurn(tookPawn, { threats: [{ ...PIECE_THREAT, sev: 'pawn' }], level: 3 })), 'opp.captured');
  assert.equal(rowOf(oppTurn(tookPawn, { threats: [{ ...PIECE_THREAT, sev: 'pawn' }, ROOK_THREAT].reverse(), level: 3 })), 'opp.threat');
  assert.equal(rowOf(oppTurn({ ...tookPawn, check: true }, { threats: [ROOK_THREAT] })), 'opp.check', 'a check and a punished move still come first');
  assert.equal(rowOf(oppTurn({ ...tookPawn, punishes: true }, { threats: [ROOK_THREAT] })), 'opp.punished');
  const rest = { move: '卒3进1', name: 'pawn_lead', overlooked: everything.overlooked, does: [{ k: 'develop', by: P('opp', 'H', 7) }] };
  assert.equal(rowOf(oppTurn(rest, { threats: [PIECE_THREAT], level: 4, ...chance })), 'opp.threat.q');
  assert.equal(rowOf(oppTurn(rest, { threats: [PIECE_THREAT], level: 3, ...chance })), 'opp.threat');
  assert.equal(rowOf(oppTurn(rest, { threats: [{ ...PIECE_THREAT, sev: 'rook' }], level: 3 })), 'opp.threat');
  assert.equal(rowOf(oppTurn(rest, chance)), 'opp.overlooked');
  assert.equal(rowOf(oppTurn({ ...rest, overlooked: undefined }, chance)), 'opp.chance');
  assert.equal(rowOf(oppTurn({ ...rest, overlooked: undefined })), 'opp.name');
  // the name of a tactic is all the caption says: the row of the effect follows, and it speaks only of an effect with a target
  const protects = [{ k: 'defend', on: P('opp', 'P', 5) }];
  assert.equal(rowOf(oppTurn({ move: '炮8进1', name: 'fork_two', does: protects })), 'opp.effect');
  assert.equal(rowOf(oppTurn({ move: '炮8进1', does: protects })), 'opp.effect');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: rest.does })), '', 'a developing move: the caption alone');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: [{ k: 'quiet' }] })), 'opp.quiet');
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: [] })), 'opp.quiet');
  // a threat without a target (a threatened check) has only the question row: it is asked below level 4 too
  const CHECK_THREAT = { k: 'check', by: P('opp', 'R', 8), move: '车8进6', net: NET0, sev: 'piece', prep: true };
  assert.equal(rowOf(oppTurn({ move: '卒3进1', does: rest.does }, { threats: [CHECK_THREAT], level: 2 })), 'opp.threat.q');
  assert.equal(composeLocal(oppTurn({ move: '卒3进1', does: rest.does }, { threats: [CHECK_THREAT], level: 2 }), OPP_LAST, 0), '对方的8路车在打什么主意？');
  // a threat that wins only a pawn does not make a threat row (section 9.3: the sentence is about the opening)
  assert.equal(rowOf(clone(F.opp.turn)), 'opp.name');

  // try, held: mate before the flaw rows; the flaw rows by the first flaw; then what is lost; then the general question
  const heldRow = (patch) => rowOf(base(), [OPP_SILENT, heldEvent(patch)]);
  assert.equal(heldRow({ eval: { b: 'lost', mate: -2 }, flaws: [{ k: 'hang', on: P('me', 'H', 4), by: P('opp', 'C', 2) }] }), 'held.mate');
  assert.equal(heldRow({ flaws: [{ k: 'walk_fork', by: P('opp', 'H', 4), on: P('me', 'R', 1), on2: P('me', 'C', 5) }, { k: 'greedy', by: P('me', 'C', 5), on: P('opp', 'P', 5), on2: P('opp', 'H', 7) }] }), 'held.fork');
  assert.equal(heldRow({ flaws: [{ k: 'miss_capture', on: P('opp', 'H', 3) }] }), 'held.cost');
  assert.equal(heldRow({ flaws: [], cost: { gain: ['P'], lose: [], cp: 100 }, eval: { b: 'worse' } }), 'held.other');

  // try, not held: only, avoided, taken, praise / steady, missed, ok, slow
  const tryRow = (patch) => rowOf(base(), [OPP_SILENT, tryEvent(patch)]);
  const check = [{ k: 'check', by: P('me', 'R', 2) }];
  assert.equal(tryRow({ only: true, avoided: 'greedy', chance: 'taken', does: check }), 'try.only');
  assert.equal(tryRow({ avoided: 'greedy', chance: 'taken', does: check }), 'try.avoided');
  assert.equal(tryRow({ chance: 'taken', does: check }), 'try.taken');
  assert.equal(tryRow({ does: check }), 'try.praise');
  assert.equal(tryRow({ cat: 'brilliant', does: [{ k: 'sacrifice', by: P('me', 'R', 2) }], sac: true }), 'try.praise');
  assert.equal(tryRow({ cat: 'good', does: [{ k: 'defend', on: P('me', 'P', 5) }] }), 'try.steady', 'defend is not a notable motif');
  assert.equal(tryRow({ cat: 'ok', chance: 'missed', toward: { area: 'left' } }), 'try.missed');
  assert.equal(tryRow({ cat: 'mistake', chance: 'missed', toward: { area: 'left' }, flaws: [{ k: 'miss_capture', on: P('opp', 'H', 3) }] }), 'try.missed');
  assert.equal(tryRow({ cat: 'ok', chance: 'missed', toward: null }), 'try.ok', 'no area to point at: the plain row');
  assert.equal(tryRow({ cat: 'ok' }), 'try.ok');
  assert.equal(tryRow({ cat: 'mistake' }), 'try.slow');
  assert.equal(tryRow({ cat: 'blunder', flaws: [{ k: 'waste' }] }), 'try.slow');

  // try, not held: the grim row (CONTRACT-NOTES 147) stands in for only, taken, praise and steady when a move judged good or
  // better has nothing to praise. First case: its own line leaves the child two points or more down.
  const costly = { gain: ['C'], lose: ['R'], cp: -450 };
  const twoDown = { gain: [], lose: ['A'], cp: -200 };
  for (const cat of ['brilliant', 'best', 'good']) {
    assert.equal(tryRow({ cat, only: true, chance: 'taken', does: check, cost: costly }), 'try.grim', cat);
    assert.equal(tryRow({ cat, chance: 'taken', does: check, cost: twoDown }), 'try.grim', cat);
    assert.equal(tryRow({ cat, does: check, cost: twoDown }), 'try.grim', cat);
    assert.equal(tryRow({ cat, cost: twoDown }), 'try.grim', cat);
  }
  // pawns for as many pawns are no loss of material, though crossed pawns make the balance read two points down
  // (CONTRACT-NOTES 152); a pawn for nothing, pawns for fewer pawns and a piece next to the pawns are
  assert.equal(tryRow({ does: check, cost: { gain: ['P', 'P'], lose: ['P', 'P'], cp: -200 } }), 'try.praise');
  assert.equal(tryRow({ cost: { gain: ['P', 'P'], lose: ['P', 'P'], cp: -200 } }), 'try.steady');
  assert.equal(tryRow({ cat: 'good', cost: { gain: ['P', 'H'], lose: ['P'], cp: -200 } }), 'try.steady');
  assert.equal(composeLocal(base(), [OPP_SILENT, tryEvent({ cost: { gain: ['P', 'P'], lose: ['P', 'P'], cp: -200 } })], 0).includes('丢点子'), false);
  assert.equal(tryRow({ cost: { gain: [], lose: ['P'], cp: -200 } }), 'try.grim', 'a crossed pawn for nothing');
  assert.equal(tryRow({ cost: { gain: ['P'], lose: ['P', 'P'], cp: -300 } }), 'try.grim', 'two pawns for one');
  assert.equal(tryRow({ cost: { gain: ['P', 'P'], lose: ['P', 'A'], cp: -200 } }), 'try.grim', 'an advisor goes with the pawn');
  assert.equal(tryRow({ eval: { b: 'lost' }, cost: { gain: ['P'], lose: ['P'], cp: -100 } }), 'try.grim', 'far behind, an even exchange of pawns wins nothing');
  // one point down is not two; a move that mates, and a sound sacrifice, keep their praise
  assert.equal(tryRow({ does: check, cost: { gain: [], lose: ['P'], cp: -100 } }), 'try.praise');
  assert.equal(tryRow({ does: check, cost: { gain: ['P'], lose: ['A', 'P'], cp: -199 } }), 'try.praise');
  assert.equal(tryRow({ cat: 'brilliant', does: check, cost: costly, eval: { b: 'won', mate: 2 } }), 'try.praise');
  assert.equal(tryRow({ does: [{ k: 'mate', by: P('me', 'R', 2) }], cost: costly, eval: { b: 'won' } }), 'try.praise');
  assert.equal(tryRow({ cat: 'brilliant', does: [{ k: 'sacrifice', by: P('me', 'R', 2) }], sac: true, cost: { gain: [], lose: ['R'], cp: -900 } }), 'try.praise');
  // a trap of old that was stepped around is still told (the avoided row), without 走得稳
  assert.equal(tryRow({ only: true, avoided: 'greedy', does: check, cost: costly }), 'try.avoided');
  assert.equal(composeLocal(base(), [OPP_SILENT, tryEvent({ avoided: 'greedy', cost: costly })], 0), '躲开了以前的坑，【马二进三】可行。');
  // a slow move and a mistake are not "the best there was": their own rows stand
  assert.equal(tryRow({ cat: 'ok', cost: costly }), 'try.ok');
  assert.equal(tryRow({ cat: 'mistake', cost: costly }), 'try.slow');
  // Second case: the child stays far behind after the move (走后形势 很危险) and the line wins nothing.
  const lost = { b: 'lost' };
  assert.equal(tryRow({ eval: lost, only: true }), 'try.grim');
  assert.equal(tryRow({ eval: lost, chance: 'taken', does: check }), 'try.grim');
  assert.equal(tryRow({ eval: lost, does: check }), 'try.grim');
  assert.equal(tryRow({ eval: lost, does: [{ k: 'attack', by: P('me', 'R', 3), on: P('opp', 'C', 7) }] }), 'try.grim', 'the line of the task notes: 这步捉子，漂亮');
  assert.equal(tryRow({ eval: lost, cat: 'good' }), 'try.grim');
  assert.equal(tryRow({ eval: lost, does: check, cost: { gain: ['H'], lose: ['H'], cp: 0 } }), 'try.grim', 'an even trade wins nothing');
  // ... but a move that wins material back, or a tactic, keeps its praise however far behind the child is
  assert.equal(tryRow({ eval: lost, does: [{ k: 'capture', by: P('me', 'C', 5), on: P('opp', 'P', 5) }], cost: { gain: ['P'], lose: [], cp: 100 } }), 'try.praise');
  assert.equal(tryRow({ eval: lost, does: check, cost: { gain: ['R'], lose: ['C'], cp: 450 } }), 'try.praise');
  for (const k of ['capture_free', 'fork', 'pin', 'discovered', 'mate_threat']) {
    assert.equal(tryRow({ eval: lost, does: [{ k, by: P('me', 'H', 4), on: P('opp', 'R', 3), on2: P('opp', 'C', 7) }] }), 'try.praise', k);
  }
  assert.equal(tryRow({ eval: lost, only: true, does: [FORK] }), 'try.only');
  // behind, but not far behind (落了下风): the rows of old
  assert.equal(tryRow({ eval: { b: 'worse' }, does: check }), 'try.praise');
  assert.equal(tryRow({ eval: { b: 'worse' } }), 'try.steady');
  // a move that is not good or better is never grim, and a held trial has its question
  assert.equal(tryRow({ eval: lost, cat: 'ok' }), 'try.ok');
  assert.equal(heldRow({ eval: lost, cost: costly }), 'held.cost');
  // Third case (CONTRACT-NOTES 150): the child is mated by force after the move. Whatever tactic the move shows and
  // whatever it takes, it has nothing to praise: no exemption for a tactic motif, for a gain, for the only move, for a
  // chance that was taken or for a trap that was avoided.
  const mated = { b: 'lost', mate: -1 };
  for (const k of ['capture_free', 'fork', 'pin', 'discovered', 'mate_threat', 'check', 'attack']) {
    assert.equal(tryRow({ eval: mated, does: [{ k, by: P('me', 'H', 4), on: P('opp', 'R', 3), on2: P('opp', 'C', 7) }] }), 'try.grim', k);
  }
  assert.equal(tryRow({ eval: mated, does: check, cost: { gain: ['R'], lose: ['C'], cp: 450 } }), 'try.grim', 'what it takes does not count');
  assert.equal(tryRow({ eval: mated, only: true, does: [FORK] }), 'try.grim');
  assert.equal(tryRow({ eval: mated, chance: 'taken', does: [FORK] }), 'try.grim');
  assert.equal(tryRow({ eval: mated, avoided: 'greedy', does: [FORK] }), 'try.grim', 'neither 走得稳 nor 可行 is said');
  assert.equal(tryRow({ eval: { b: 'lost', mate: -9 }, cat: 'good', does: check }), 'try.grim');
  for (let v = 0; v < 6; v++) {
    assert.match(composeLocal(base(), [OPP_SILENT, tryEvent({ eval: mated, avoided: 'greedy', chance: 'taken', does: [FORK], cost: { gain: ['R'], lose: [], cp: 900 } })], v),
      /^(【马二进三】是眼下最顽强的一步。|局面吃紧，【马二进三】是最好的应法。|难是难，【马二进三】没有走错。)$/, `variant ${v}`);
  }
  // being mated is a bad position whatever the band says: the words are those of a position in trouble
  assert.equal(composeLocal(base(), [OPP_SILENT, tryEvent({ eval: { b: 'won', mate: -3 }, does: check })], 0), '【马二进三】是眼下最顽强的一步。');
  // a mate for the child is not one against it, and a mate that is a blunder is a held trial
  assert.equal(tryRow({ cat: 'brilliant', eval: { b: 'won', mate: 2 }, does: check }), 'try.praise');
  assert.equal(heldRow({ eval: mated, flaws: [{ k: 'allow_mate' }] }), 'held.mate');

  // The words of the grim row follow the evaluation after the move (CONTRACT-NOTES 150): 最顽强 / 局面吃紧 / 难是难 where
  // the child is in trouble (落了下风, 很危险), 只是要丢点子 where it is not (均势, 占优, 胜势).
  const grimText = (patch, v) => composeLocal(base(), [OPP_SILENT, tryEvent({ cost: twoDown, ...patch })], v);
  for (const b of ['even', 'better', 'won']) {
    assert.deepEqual([0, 1, 2].map((v) => grimText({ eval: { b } }, v)),
      ['【马二进三】是眼下最好的一步，只是要丢点子。', '【马二进三】没有走错，只是要丢点子。', '【马二进三】是眼下最好的一步，只是要丢点子。'], b);
    assert.deepEqual([0, 1].map((v) => grimText({ eval: { b }, cat: 'brilliant' }, v)), ['【马二进三】是眼下最好的一步，只是要丢点子。', '【马二进三】没有走错，只是要丢点子。'], b);
    assert.deepEqual([0, 1].map((v) => grimText({ eval: { b }, cat: 'good' }, v)), ['【马二进三】可以走，只是要丢点子。', '【马二进三】没有走错，只是要丢点子。'], b);
  }
  for (const b of ['worse', 'lost']) {
    assert.deepEqual([0, 1, 2].map((v) => grimText({ eval: { b } }, v)), ['【马二进三】是眼下最顽强的一步。', '局面吃紧，【马二进三】是最好的应法。', '难是难，【马二进三】没有走错。'], b);
    assert.deepEqual([0, 1].map((v) => grimText({ eval: { b }, cat: 'good' }, v)), ['难是难，【马二进三】没有走错。', '局面吃紧，【马二进三】可以走。'], b);
  }
  for (const b of ['even', 'better', 'won']) {
    for (const cat of ['brilliant', 'best', 'good']) {
      for (let v = 0; v < 6; v++) assert.doesNotMatch(grimText({ eval: { b }, cat }, v), /吃紧|难是难|顽强/, `${b}, ${cat}, variant ${v}`);
    }
  }

  // try.only about a forced move (at most two legal moves): one variant, the bare statement
  const forcedRow = (n) => localLine(turnWith({ n }), [OPP_SILENT, tryEvent({ only: true })], []);
  assert.deepEqual([1, 2].map((n) => forcedRow(n).text), ['【马二进三】是眼下唯一的解法。', '【马二进三】是眼下唯一的解法。']);
  assert.deepEqual([0, 1, 2, 7].map((v) => composeLocal(turnWith({ n: 2 }), [OPP_SILENT, tryEvent({ only: true })], v)), Array(4).fill('【马二进三】是眼下唯一的解法。'));
  assert.equal(composeLocal(turnWith({ n: 3 }), [OPP_SILENT, tryEvent({ only: true })], 1), '只有【马二进三】能解围，好眼力。');
  for (const text of [forcedRow(1).text, forcedRow(2).text]) assert.doesNotMatch(text, /走得对|好眼力|此计可行/);
});

test('every local line respects its cap', () => {
  const texts = sweepTexts();
  assert.ok(texts.length > 3000, 'the sweep is wide');
  for (const { name, text, cap } of texts) {
    assert.ok(plainLength(text) <= cap, `${name}: ${plainLength(text)} > ${cap}: ${text}`);
    assert.ok(balanced(text), `${name}: brackets pair up: ${text}`);
    assert.equal(text.includes('……'), false, `${name}: nothing had to be cut: ${text}`);
  }
  // the caps are the ones of section 8.3
  assert.deepEqual([CAPS.start, CAPS.opp, CAPS.try, CAPS.hint1, CAPS.hint2, CAPS.hint3, CAPS.ask, CAPS.why, CAPS.free, CAPS.over], [20, 18, 24, 20, 20, 36, 50, 90, 70, 80]);

  // a variant that would pass its cap gives way to the next one
  const long = { turn: oppTurn({ move: '炮8平5', does: [{ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5), on2: P('opp', 'P', 5) }] }), events: OPP_LAST };
  assert.equal(plainLength('对方的5路炮借自己的5路卒当炮架，瞄着你的五路兵。') > CAPS.opp, true);
  assert.equal(composeLocal(long.turn, long.events, 0), '对方的5路炮瞄着你的五路兵。');
  assert.deepEqual(localLine(long.turn, long.events, []), { text: '对方的5路炮瞄着你的五路兵。', row: 'opp.effect', v: 2 }, 'and it is never offered by localLine either');
  // the rival's line after his move is never cut: when no sentence about the effect fits, the caption stands alone
  const pinned = { turn: oppTurn({ move: '炮2进4', does: [{ k: 'pin', by: P('opp', 'C', 2), on: P('me', 'H', 8), on2: P('me', 'R', 9) }] }), events: OPP_LAST };
  assert.deepEqual([0, 1, 2].map((v) => composeLocal(pinned.turn, pinned.events, v)), ['', '', '']);
  assert.deepEqual(localLine(pinned.turn, pinned.events, []), { text: '', row: '', v: 0 });
  const fork = [OPP_SILENT, tryEvent({ move: '马三进四', cat: 'brilliant', does: [FORK] })];
  assert.equal(composeLocal(base(), fork, 0), '好一步【马三进四】：捉双。');
  assert.equal(composeLocal(base(), fork, 1), '好一步【马三进四】：捉双。');
  const wasted = [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'mistake', loss: 200, does: [{ k: 'quiet' }], flaws: [{ k: 'waste' }] })];
  assert.equal(composeLocal(base(), wasted, 0), '【兵三进一】有点可惜：空着。');
  assert.equal(composeLocal(base(), wasted, 4), '这步没有实际作用，白让对方走一步，换一步看看？');
  // held: 20, not the 24 of a comment
  const near = [OPP_SILENT, heldEvent({ flaws: [{ k: 'unguard', by: P('me', 'C', 6, 'front'), on: P('me', 'H', 3, 'back') }] })];
  assert.equal(plainLength('走了你的六路前炮，你的三路后马就孤单了吧？'), 21);
  assert.equal(composeLocal(base(), near, 3), '你的六路前炮是不是还有别的差事？');

  // pouch 3: the rival's answer is added only while it fits 36; a clause that is too long gives way to its term
  const pouch = (does, line) => [OPP_SILENT, hintEvent(3, { move: '马三进四', does, line })];
  const line = { first: 'opp', moves: ['车3平2', '马四进三'], net: { gain: ['C'], lose: [], cp: 450 }, end: 'quiet' };
  // (with 对方的 said once the whole clause fits 36 without the answer; with the longest names it gives way to the term)
  assert.equal(plainLength('可以走【马三进四】：你的四路马同时捉住对方的3路车和7路炮，只能救一个。对方多半走【车3平2】。') > CAPS.hint3, true);
  assert.equal(composeLocal(base(), pouch([FORK], line)), '可以走【马三进四】：你的四路马同时捉住对方的3路车和7路炮，只能救一个。');
  const longFork = { k: 'fork', by: P('me', 'H', 4, 'front'), on: P('opp', 'R', 3, 'front'), on2: P('opp', 'C', 7, 'front') };
  assert.equal(plainLength('可以走【马三进四】：你的四路前马同时捉住对方的3路前车和7路前炮，只能救一个。') > CAPS.hint3, true);
  assert.equal(composeLocal(base(), pouch([longFork], line)), '可以走【马三进四】：捉双。对方多半走【车3平2】。');
  const free = { k: 'capture_free', by: P('me', 'H', 4), on: P('opp', 'R', 3) };
  assert.equal(plainLength('可以走【马三进四】：你的四路马白吃对方的3路车，吃完不会被吃回。对方多半走【车3平2】。'), 40);
  assert.equal(composeLocal(base(), pouch([free], line)), '可以走【马三进四】：你的四路马白吃对方的3路车，吃完不会被吃回。');
  assert.equal(composeLocal(base(), pouch([], null)), '可以走【马三进四】。');

  // over: the goal is not part of the line (the card shows it in a row of its own, CONTRACT-NOTES 138), so even with the
  // longest of everything (a loss, the kept goal, a move number of three digits, a five-character notation, a
  // four-character term, the rank) the line is whole and nothing has to be dropped
  const full = overEvent({ result: 'loss', kept: true, goal: 'hang_piece', rank: { to: 4 }, proud: { n: 118, s: 'me', move: '马三进四', tag: 'great', k: 'bad_trade' } }, 'lose');
  const whole = '这盘惜败，不过有几步走得真不错。上盘说好的，做到了！第118回合的【马三进四】最漂亮：亏本兑子。兵法升到「初露锋芒」！';
  assert.equal(plainLength(whole), 57);
  assert.equal(composeLocal(overTurn(), [full]), whole);
  const longest = (goal, rank) => composeLocal(overTurn(), [overEvent({ result: 'loss', kept: true, goal, rank,
    proud: { n: 301, s: 'me', move: '前兵七进一', tag: 'great', k: 'bad_trade' } }, 'lose')]);
  for (const goal of HABIT_CODES) {
    for (const rank of [null, { to: 1 }, { to: 9 }]) {
      const text = longest(goal, rank);
      assert.ok(plainLength(text) <= CAPS.over, `${goal}: ${plainLength(text)}`);
      assert.ok(!text.includes('小目标') && !text.includes(HABIT_FIX[goal]), `${goal}: the goal is left to the card: ${text}`);
      assert.equal(text.endsWith('」！'), rank !== null, `${goal}: the rank sentence is never dropped: ${text}`);
    }
  }
  assert.equal(Math.max(...HABIT_CODES.map((goal) => plainLength(longest(goal, { to: 9 })))), 58, 'the longest game-over line');

  // an answer of two sentences loses its second one before anything else
  const big = { gain: ['R', 'H', 'C', 'P', 'A', 'E'], lose: ['R', 'H', 'C', 'P', 'A', 'E'], cp: 0 };
  const shown = [OPP_SILENT, spoken(heldEvent({ flaws: [{ k: 'hang', on: P('me', 'H', 4), by: P('opp', 'C', 2) }], cost: big })),
    ask('show', { more: { reply: { first: 'opp', moves: ['炮2进3'], net: big, end: 'quiet' }, better: [] } })];
  assert.equal(composeLocal(base(), shown), '是对方的2路炮在威胁。它会走【炮2进3】。');
  assert.equal(composeLocal(base(), [...shown.slice(0, 2), ask('reply', { more: shown[2].more })]), '对方多半走【炮2进3】。');
  assert.equal(composeLocal(base(), [...shown.slice(0, 2), ask('good')]), '【炮五进四】是失误：你的四路马没有保护，会被对方的2路炮白吃。');

  // if nothing fits, the shortest is cut at the cap: whole characters and whole 【】 only, the …… inside the cap.
  // (No wire-valid packet gets here: the move below is not a notation.)
  const absurd = overThread('proud', { proud: { n: 18, s: 'me', move: '马'.repeat(60), tag: 'great' } });
  const cut = composeLocal(overTurn(), absurd);
  assert.equal(cut, '第18回合的……');
  assert.ok(plainLength(cut) <= CAPS.ask && balanced(cut));
});

test('random wire-valid packets: every line is within its cap, whole, grounded and free of placeholders', () => {
  // Packets no hand-written case has: effects with pieces missing, any motif anywhere, long lists, both colours, every thread shape.
  const rng = mulberry32(8603);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const maybe = (p) => rng() < p;
  const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const PTS = ['A', 'E', 'H', 'R', 'C', 'P'];
  const AREAS = ['left', 'center', 'right', 'river', 'their_palace', 'my_palace', 'their_back', 'my_back'];
  const MOVES = { red: ['炮二平五', '马二进三', '车一平二', '前炮进四', '帅五进一', '前兵七进一'], black: ['炮8平5', '马8进7', '车9平8', '后车退2', '将5进1', '前卒3进1'] };
  let me = 'red';
  const mine = () => pick(MOVES[me]);
  const theirs = () => pick(MOVES[me === 'red' ? 'black' : 'red']);
  const piece = (s) => (maybe(0.3) ? P(s ?? pick(['me', 'opp']), pick(['K', ...PTS]), int(1, 9), pick(['front', 'mid', 'back'])) : P(s ?? pick(['me', 'opp']), pick(['K', ...PTS]), int(1, 9)));
  const effect = (codes = MOTIF_CODES) => {
    const e = { k: pick(codes) };
    if (maybe(0.8)) e.by = piece();
    if (maybe(0.8)) e.on = piece();
    if (maybe(0.7)) e.on2 = piece();
    return e;
  };
  const flaw = () => effect(FLAW_CODES);
  const list = (max, make) => Array.from({ length: int(0, max) }, make);
  const net = () => ({ gain: list(3, () => pick(PTS)), lose: list(3, () => pick(PTS)), cp: int(-1500, 1500) });
  const line = (first) => ({ first, moves: Array.from({ length: int(1, 6) }, (_, k) => ((first === 'opp') === (k % 2 === 0) ? theirs() : mine())), net: net(), end: pick(['quiet', 'check', 'mate']) });
  const evalOf = () => (maybe(0.2) ? { b: pick(['won', 'lost']), mate: int(-9, 9) } : { b: pick(['won', 'better', 'even', 'worse', 'lost']) });
  const packet = () => {
    const cat = pick(CATS);
    const held = (cat === 'mistake' || cat === 'blunder') && maybe(0.6);
    const p = { move: mine(), cat, loss: int(0, 2500), held, eval: evalOf(), does: list(3, () => effect()), flaws: list(2, flaw), cost: maybe(0.6) ? net() : null,
      reply: held || maybe(0.4) ? null : line('opp'), toward: pick([null, { theme: pick(MOTIF_CODES) }, { area: pick(AREAS), theme: pick(MOTIF_CODES) }]), chance: pick(['taken', 'missed', 'none', 'none']) };
    if (maybe(0.15)) p.only = true;
    if (maybe(0.15)) p.avoided = pick(HABIT_CODES);
    return p;
  };
  const more = () => {
    const m = {};
    if (maybe(0.8)) m.reply = line('opp');
    if (maybe(0.85)) m.better = list(2, () => ({ move: mine(), gain: int(1, 3000), does: list(3, effect), line: maybe(0.7) ? line('opp') : null }));
    return m;
  };
  const turn = () => {
    me = pick(['red', 'black']);
    const t = { ...base(), ply: int(0, 200), me, eval: evalOf(), level: int(1, 9), mat: { me: 'R2H2C2P5A2E2', opp: 'R1H2C2P4A2E2', cp: int(-2500, 2500) },
      mine: maybe(0.3) ? null : { move: mine(), cat: pick(CATS), waited: true, self: true }, opp: null,
      threats: list(3, () => ({ k: pick(['mate_threat', 'attack', 'cannon_mount', 'check', 'fork', 'discovered', 'pin']), by: piece('opp'), ...(maybe(0.8) ? { on: piece('me') } : {}), move: theirs(), net: net(),
        sev: pick(['pawn', 'piece', 'rook', 'mate']), ...(maybe(0.3) ? { prep: true } : {}) })),
      chance: maybe(0.25) ? { size: 'piece', theme: pick(MOTIF_CODES), area: pick(AREAS) } : null, known: { threats: maybe(0.8), chance: maybe(0.5) } };
    if (t.mine && maybe(0.6)) t.mine.try = { ...packet(), held: false, move: t.mine.move, cat: t.mine.cat };
    if (maybe(0.85)) {
      t.opp = { move: theirs(), check: maybe(0.15), does: list(3, effect), quality: pick(['strong', 'normal', 'normal', 'soft', 'slip']) };
      if (maybe(0.2)) t.opp.captured = pick(PTS);
      if (maybe(0.2)) t.opp.name = pick(PATTERN_CODES);
      if (maybe(0.15)) t.opp.punishes = true;
      if (maybe(0.1)) t.opp.overlooked = { on: piece('me'), move: theirs() };
    }
    return t;
  };
  const answered = (event) => (maybe(0.5) ? spoken(event, int(0, 5)) : { ...event, said: 'none' });
  const thread = () => {
    const t = turn();
    const kind = pick(['start', 'opp', 'hint', 'try', 'try', 'ask', 'ask', 'ask', 'over', 'overask']);
    if (kind === 'start') return { turn: t, events: [{ i: 0, kind: 'start' }] };
    if (kind === 'over' || kind === 'overask') {
      const result = pick(['win', 'loss', 'draw']);
      const over = { ...clone(F.over.events[0].over), result, moves: int(0, 300), stats: { good: int(0, 40), taken: 0, captures: 0, brilliant: 0 },
        takeaway: pick([null, { kind: 'strength', code: 'S_steady' }, { kind: 'habit', code: pick(HABIT_CODES), ex: maybe(0.5) ? { n: int(1, 301), move: mine(), better: mine() } : { n: int(1, 301), move: mine() } }]),
        proud: maybe(0.6) ? { n: int(1, 301), s: 'me', move: mine(), tag: 'great', ...(maybe(0.7) ? { k: pick(MOTIF_CODES) } : {}) } : null,
        goal: maybe(0.5) ? pick(HABIT_CODES) : null, kept: pick([null, true, false]), rank: maybe(0.3) ? { to: int(1, 9) } : null };
      const event = { i: 0, kind: 'over', over, ...(maybe(0.8) ? { cue: cueFor(t, { i: 0, kind: 'over', over }, {}) } : {}) };
      if (kind === 'over') return { turn: t, events: [event] };
      const first = pick(['proud', 'improve', 'next', 'why']);
      // 为什么？ follows the game-over line itself or the answer to one of its three questions
      return { turn: t, events: first !== 'why' && maybe(0.5) ? [answered(event), answered({ i: 1, kind: 'ask', ask: first }), { i: 2, kind: 'ask', ask: 'why' }]
        : [answered(event), { i: 1, kind: 'ask', ask: first }] };
    }
    const events = [kind === 'opp' ? { i: 0, kind: 'opp' } : answered({ i: 0, kind: 'opp' })];
    if (kind === 'hint') {
      const top = int(1, 3);
      const hints = [{ focus: pick(['danger', 'chance', 'develop', 'improve', 'finish']), theme: pick(MOTIF_CODES) }, { piece: piece('me'), area: pick(AREAS), theme: pick(MOTIF_CODES) },
        { move: mine(), does: list(3, effect), line: maybe(0.7) ? line('opp') : null }];
      for (let level = maybe(0.3) ? top : 1; level <= top; level++) events.push(level === top ? hintEvent(level, hints[level - 1]) : answered(hintEvent(level, hints[level - 1])));
    } else if (kind === 'try') {
      events.push({ i: 1, kind: 'try', n: 1, try: packet() });
    } else if (kind === 'ask') {
      const tried = maybe(0.7);
      if (tried) events.push(answered({ i: 1, kind: 'try', n: 1, try: packet() }));
      const code = pick(ASK_CODES.filter((c) => c !== 'free' && (tried || !['good', 'reply', 'better', 'show'].includes(c))));
      events.push({ i: 2, kind: 'ask', ask: code, ...(['reply', 'better', 'why', 'show'].includes(code) && maybe(0.6) ? { more: more() } : {}) });
    }
    return { turn: t, events };
  };

  const rows = new Set();
  let said = 0;
  let overWhys = 0;
  for (let n = 0; n < 2500; n++) {
    const { turn: t, events } = thread();
    const valid = validateCoachRequest({ v: 1, turn: t, events });
    assert.deepEqual(valid.ok ? null : [valid.path, valid.why], null, 'the generator makes wire-valid requests');
    const last = events[events.length - 1];
    const known = notationsOf({ t, events });
    const before = JSON.stringify({ t, events });
    const local = localLine(t, events, [`try.steady:${n % 6}`, `opp.effect:${n % 5}`]);
    assert.equal(composeLocal(t, events, local.v), local.text);
    rows.add(local.row);
    // 为什么？ after the game is never left without an answer (CONTRACT-NOTES item 112)
    if (events[0].kind === 'over' && last.kind === 'ask' && last.ask === 'why') { assert.notEqual(local.text, ''); overWhys++; }
    for (let v = 0; v < 6; v++) {
      const text = composeLocal(t, events, v);
      if (text === '') continue;
      said++;
      const where = `${local.row} v${v}: ${text}`;
      assert.ok(plainLength(text) <= capOf(events), `over the cap: ${where}`);
      assert.ok(balanced(text) && !text.includes('……'), `not whole: ${where}`);
      assert.doesNotMatch(text, /undefined|null|NaN|[{}A-Za-z]|[，：。！？]{2}|^[，。：]/, where);
      assert.match(text, /[。！？]$/, where);
      for (const notation of bracketsOf(text)) assert.ok(known.has(notation), `【${notation}】 is not in the packets: ${where}`);
      const sentences = text.match(/[。！？]/g).length;
      if (last.kind === 'ask') assert.ok(sentences <= (last.ask === 'why' ? 3 : 2), `section 8.3, at most ${last.ask === 'why' ? 'three' : 'two'} sentences: ${where}`);
    }
    assert.equal(JSON.stringify({ t, events }), before, 'the packets are not written to');
  }
  assert.ok(said > 8000, `sentences checked: ${said}`);
  assert.ok(overWhys > 60, `为什么？ after the game: ${overWhys}`);
  // every row of section 8.6 was reached (the free-text lines are fixed and not generated), and so was silence
  for (const row of new Set(GOLDEN.map((g) => g.row))) assert.ok(row === 'ask.free' || rows.has(row), `row not reached: ${row}`);
  assert.ok(rows.has(''));
});

test('no banned word in any template: 白赚 稳赚 必胜 引擎 程序 分数 离线 主帅 又是 总是 老是', () => {
  const BANNED = ['白赚', '稳赚', '必胜', '引擎', '程序', '分数', '离线', '主帅', '又是', '总是', '老是'];
  const texts = sweepTexts().map((t) => t.text);
  for (const who of ['me', 'opp']) {
    for (const cat of CATS) {
      for (const vsTry of [undefined, 'better', 'same', 'worse']) texts.push(composeToolReply(base(), { ...clone(TOOL_VERDICT), who, cat, vsTry }));
      // every flaw as the reason, and an answer that ends in mate
      for (const k of FLAW_CODES) {
        const flaw = { k, by: P(who, 'H', 8, 'front'), on: P(who === 'me' ? 'opp' : 'me', 'C', 7, 'front'), on2: P('opp', 'R', 3, 'front') };
        const reply = { first: who === 'me' ? 'opp' : 'me', moves: ['车2进7'], net: NET0, end: 'mate' };
        const text = composeToolReply(base(), { ...clone(TOOL_VERDICT), who, cat, flaws: [flaw], reply });
        assert.ok(plainLength(text) <= CAPS.free && balanced(text), text);
        texts.push(text);
      }
    }
  }
  assert.ok(texts.filter((t) => t !== '').length > 3000);
  for (const text of texts) {
    for (const word of BANNED) assert.equal(text.includes(word), false, `「${word}」 in: ${text}`);
    // the voice: no markdown, no Latin letters, no coordinates, no "offline" wording, the child is never 小朋友
    assert.doesNotMatch(text, /[A-Za-z*#_`]|undefined|null|NaN|小朋友|\{|\}/, text);
  }
});

test('every 【】 in the output is in the fixture\'s book', () => {
  // 1. every fixture: a bracket only ever holds a notation that the request itself carries
  let brackets = 0;
  for (const name of FIXTURE_NAMES) {
    const request = fixture(name);
    const known = notationsOf(request);
    const texts = [];
    for (let k = 1; k <= request.events.length; k++) {
      for (let v = 0; v < 6; v++) texts.push(composeLocal(request.turn, request.events.slice(0, k), v));
    }
    for (const result of request.resume?.results ?? []) if (result.ok) texts.push(composeToolReply(request.turn, result.verdict));
    for (const event of request.events) {
      for (const record of event.tools ?? []) if (record.result.ok) texts.push(composeToolReply(request.turn, record.result.verdict));
    }
    for (const text of texts) {
      assert.ok(balanced(text), `${name}: ${text}`);
      for (const notation of bracketsOf(text)) {
        brackets++;
        assert.match(notation, NOTATION_RE);
        assert.ok(known.has(notation), `${name}: 【${notation}】 is not in the packets: ${text}`);
      }
    }
  }
  assert.ok(brackets >= 40, `the fixtures put moves into brackets: ${brackets}`);

  // 2. the worked example (sections 9.4 to 9.7) with the real MoveBook, filled as the packet builders fill it
  const ref = (code) => fromMoveCode(code);
  const example = COACH_EXAMPLE_POSITIONS.horseReply;
  const position = fenToBoard(example.fen);
  const book = createMoveBook({ board: position.board, turn: position.turn });
  const start = createInitialBoard();
  book.add('mine', toLine(start, 'red', [ref(example.moves[0])]));                                              // 炮二平五
  book.add('opp', toLine(applyMove(start, ref(example.moves[0])), 'black', [ref(example.moves[1])]));           // 马8进7
  book.add('try', toLine(position.board, 'red', [ref(example.trial)]));                                         // 炮五进四
  book.add('reply', toLine(applyMove(position.board, ref(example.trial)), 'black', [ref(example.refutation), ref('9172'), ref('0122')]));
  book.add('better', toLine(position.board, 'red', [ref(example.best), ref('0807'), ref('9897')]));
  book.add('try', toLine(position.board, 'red', [ref('6656')]));                                                // 兵三进一
  book.add('tool', toLine(position.board, 'red', [ref(example.best), ref('2124'), ref('9897')]));               // 马二进三 炮2平5 车一平二
  for (const name of ['hint.json', 'try.json', 'try-held.json', 'try-held-ask.json', 'ask-chip.json', 'ask-free.json', 'ask-free-resume.json', 'ask-tools.json', 'recap.json']) {
    const request = fixture(name);
    for (const notation of notationsOf(request)) assert.ok(book.lookup(notation), `${name}: ${notation} is registered`);
    const texts = [];
    for (let k = 1; k <= request.events.length; k++) texts.push(localLine(request.turn, request.events.slice(0, k), []).text);
    for (const result of request.resume?.results ?? []) if (result.ok) texts.push(composeToolReply(request.turn, result.verdict));
    for (const text of texts) {
      const segments = parseCoachText(text, book);
      const moves = segments.filter((s) => s.type === 'move');
      assert.equal(moves.length, bracketsOf(text).length, `${name}: every bracket became a move link: ${text}`);
      for (const move of moves) assert.equal(move.link, book.lookup(move.notation));
    }
  }

  // 3. section 9.3: the threat move of the rival, registered from the position the child faces
  const cannons = fenToBoard(COACH_EXAMPLE_POSITIONS.sameCannons.fen);
  const oppBook = createMoveBook({ board: cannons.board, turn: cannons.turn });
  assert.deepEqual(oppBook.add('threat', { start: { board: cannons.board, turn: 'black' }, moves: [describeMove(cannons.board, ref('2464'))] }), ['炮5进4']);
  const intent = composeLocal(F.opp.turn, [spoken(F.opp.events[0]), ask('intent')]);
  assert.equal(intent, '对方下一步想走【炮5进4】，那样你白丢一个兵。');
  assert.equal(parseCoachText(intent, oppBook).find((s) => s.type === 'move').link, oppBook.lookup('炮5进4'));
});

test('localLine never returns one of the last three row:v keys when the row has more than three variants', () => {
  let rows = 0;
  for (const g of GOLDEN) {
    const sayable = new Set(g.expect).size;
    if (sayable <= 3) continue;
    rows++;
    // the same packet again and again, and the same row move after move (the ply grows by two)
    for (const step of [0, 2]) {
      const recent = [];
      const said = new Set();
      for (let n = 0; n < 40; n++) {
        const line = localLine({ ...g.turn, ply: g.turn.ply + step * n }, g.events, recent);
        const key = `${line.row}:${line.v}`;
        assert.equal(line.row, g.row);
        assert.equal(recent.includes(key), false, `${g.name}: ${key} after ${recent.join(' ')}`);
        assert.equal(line.text, g.expect[line.v], `${g.name}: the text is variant ${line.v}`);
        said.add(line.v);
        recent.push(key);
        if (recent.length > 3) recent.shift();
      }
      assert.ok(said.size >= 4, `${g.name}: more than three variants are in use`);
      if (step > 0) assert.equal(said.size, sayable, `${g.name}: over a game every variant gets its turn`);
    }
  }
  assert.ok(rows >= 17, `rows with more than three variants: ${rows}`);

  // the search starts at (floor(turn.ply / 2) + events.length) mod count (CONTRACT-NOTES item 111) ...
  const steady = GOLDEN.find((g) => g.name.startsWith('try.steady'));
  assert.equal(steady.turn.ply, 2);
  assert.equal(steady.events.length, 2);
  assert.deepEqual(localLine(steady.turn, steady.events, []), { text: '【马二进三】，不急不躁。', row: 'try.steady', v: 3 });
  // ... which is the same for the two plies of one move number (a red child moves on even plies, a black child on odd ones) ...
  assert.equal(localLine({ ...steady.turn, ply: 3 }, steady.events, []).v, 3);
  assert.equal(localLine({ ...steady.turn, ply: 4 }, steady.events, []).v, 4);
  assert.equal(localLine({ ...steady.turn, ply: 5 }, steady.events, []).v, 4);
  assert.equal(localLine({ ...steady.turn, ply: 9 }, steady.events, []).v, 0);                 // (4 + 2) mod 6
  // ... and one further for every further event of the thread (a second trial in the same turn)
  const second = [steady.events[0], spoken(steady.events[1], 3), { ...clone(steady.events[1]), i: 2, n: 2 }];
  assert.equal(localLine(steady.turn, second, []).v, 4);
  // ... and moves on past what was spoken lately
  assert.equal(localLine(steady.turn, steady.events, ['try.steady:3']).v, 4);
  assert.equal(localLine(steady.turn, steady.events, ['try.steady:3', 'try.steady:4', 'try.steady:5']).v, 0);
  // keys of other rows do not matter, and only the last three keys count
  assert.equal(localLine(steady.turn, steady.events, ['try.ok:3', 'opp.quiet:3', 'held.other:3']).v, 3);
  assert.equal(localLine(steady.turn, steady.events, ['try.steady:3', 'opp.quiet:0', 'opp.quiet:1', 'opp.quiet:2']).v, 3);
  // composeLocal with an explicit v does not depend on the ply: the proxy re-creates the line from v alone
  for (const ply of [0, 1, 2, 3, 40, 41]) assert.equal(composeLocal({ ...steady.turn, ply }, steady.events, 3), '【马二进三】，不急不躁。');

  // a row of three or fewer cannot always avoid a repeat: then the variant spoken longest ago is taken
  const start = GOLDEN.find((g) => g.name === 'start');
  assert.equal(localLine(start.turn, start.events, []).v, 1);                              // (0 + 1) mod 3
  assert.equal(localLine(start.turn, start.events, ['start:1']).v, 2);
  assert.equal(localLine(start.turn, start.events, ['start:2', 'start:0', 'start:1']).v, 2);
  assert.equal(localLine(start.turn, start.events, ['start:0', 'start:1', 'start:2']).v, 0);
  // a row of one sentence is that sentence
  const good = GOLDEN.find((g) => g.name === 'ask good: best');
  assert.deepEqual(localLine(good.turn, good.events, ['ask.good:0']), { text: '【马二进三】是眼下最好的一步。', row: 'ask.good', v: 0 });
  // the two free lines are chosen by meaning, never by rotation: the local line is "the model failed"
  const free = GOLDEN.find((g) => g.name === 'ask free');
  assert.deepEqual(localLine(free.turn, free.events, ['ask.free:0']), { text: free.expect[0], row: 'ask.free', v: 0 });
  assert.equal(localLine({ ...free.turn, ply: 3 }, free.events, []).v, 0);
});

test('a child of either colour hears every variant of every row (CONTRACT-NOTES item 111)', () => {
  // The start index alone, with nothing spoken before: the same row move after move. A red child faces even plies, a black
  // child odd ones. With the earlier rule (turn.ply + events.length) the start kept the parity of the colour, so of a row of six
  // a red child heard only the variants 1, 3, 5 after a rival move and a black child only 0, 2, 4.
  let checked = 0;
  for (const g of GOLDEN) {
    const sayable = new Set(g.expect).size;
    if (sayable < 2 || g.row === 'start' || g.row === 'ask.free') continue;
    for (const first of [0, 1]) {                                            // red, black
      const heard = new Set();
      const starts = [];
      for (let move = 1; move <= 12; move++) {
        const line = localLine({ ...g.turn, ply: 2 * move + first }, g.events, []);
        assert.equal(line.row, g.row);
        assert.equal(line.text, g.expect[line.v], `${g.name}: the text is variant ${line.v}`);
        heard.add(line.v);
        starts.push(line.v);
      }
      assert.equal(heard.size, sayable, `${g.name}, ${first ? 'black' : 'red'} child: every variant is heard: ${starts.join(' ')}`);
      // six moves in a row never start twice at the same variant of a row whose six variants can all be said
      if (sayable === 6) assert.equal(new Set(starts.slice(0, 6)).size, 6, `${g.name}: ${starts.join(' ')}`);
      checked++;
    }
  }
  assert.ok(checked >= 2 * 29, `rows checked for both colours: ${checked}`);

  // the two colours start at the same variant in the same move number: floor(ply / 2)
  const quiet = GOLDEN.find((g) => g.row === 'opp.quiet');
  for (let move = 1; move <= 12; move++) {
    const red = localLine({ ...quiet.turn, ply: 2 * move }, quiet.events, []);
    const black = localLine({ ...blackened(quiet).turn, ply: 2 * move + 1 }, quiet.events, []);
    assert.equal(red.v, (move + 1) % 6);
    assert.equal(black.v, red.v);
  }

  // The opening line is the one row the rule cannot vary: it is always said at ply 0 with one event, so it starts at variant 1.
  // Its other variants are heard only when the line was spoken within the last three local lines (a game started over at once).
  const start = GOLDEN.find((g) => g.name === 'start');
  assert.equal(start.turn.ply, 0);
  assert.equal(localLine(start.turn, start.events, ['try.steady:1', 'opp.quiet:2', 'over:0']).v, 1);
  assert.equal(localLine(start.turn, start.events, ['start:1']).v, 2);
  assert.equal(localLine(start.turn, start.events, ['start:1', 'start:2']).v, 0);
});

test('the frequent rows have at least six variants', () => {
  // The rows a child hears most: a rival move (quiet, captured, threat) and every trial (praise, steady, ok, slow) ...
  // (opp.effect left this list with CONTRACT-NOTES 138: it says one thing, what the move is aimed at, or nothing)
  const frequent = ['opp.quiet', 'opp.captured', 'opp.threat', 'try.praise', 'try.steady', 'try.ok', 'try.slow'];
  // ... and the other rows that section 8.6 gives six variants (D-40)
  const six = [...frequent, 'opp.mate', 'opp.check', 'opp.punished', 'held.mate', 'held.hang', 'held.unguard', 'held.threat', 'held.greedy', 'held.other'];
  assert.equal(six.length, 16);
  for (const row of six) {
    const g = GOLDEN.filter((x) => x.row === row).sort((a, b) => b.expect.length - a.expect.length)[0];
    assert.ok(g, row);
    const texts = [0, 1, 2, 3, 4, 5].map((v) => composeLocal(g.turn, g.events, v));
    assert.equal(new Set(texts).size, 6, `${row}: six different sentences`);
    assert.ok(texts.every((text) => text !== '' && plainLength(text) <= capOf(g.events)), row);
    assert.equal(composeLocal(g.turn, g.events, 6), texts[0], `${row}: exactly six`);
  }
});

test('composeLocal(turn, events, v) is deterministic and equals localLine\'s text for the same v', () => {
  const recents = [[], ['try.steady:4', 'opp.quiet:0', 'held.greedy:1'], ['start:0', 'start:1', 'start:2'], ['opp.effect:0', 'opp.effect:1', 'opp.effect:2']];
  let lines = 0;
  for (const c of SWEEP) {                                                    // every packet is deep-frozen: nothing is written to it
    for (const recent of recents) {
      const line = localLine(c.turn, c.events, recent);
      assert.deepEqual(localLine(c.turn, c.events, recent), line, c.name);
      assert.equal(composeLocal(c.turn, c.events, line.v), line.text, `${c.name}: variant ${line.v}`);
      assert.equal(typeof line.row, 'string');
      assert.ok(Number.isInteger(line.v) && line.v >= 0 && line.v <= 15, `${c.name}: v fits the wire (0..15)`);
      assert.equal(line.row === '', line.text === '', `${c.name}: a row exactly when there is a sentence`);
      lines++;
    }
    for (let v = 0; v < 8; v++) assert.equal(composeLocal(c.turn, c.events, v), composeLocal(clone(c.turn), clone(c.events), v));
  }
  assert.ok(lines > 2000);
  // the answer depends on the last event and the thread before it, not on what comes after
  const thread = F.tryHeldAsk.events;
  assert.equal(composeLocal(F.tryHeldAsk.turn, thread.slice(0, 2), 0), '对方的5路卒背后有没有保镖？');
  assert.equal(composeLocal(F.tryHeldAsk.turn, thread, 0), '对方多半走【马7进5】，之后你吃到一个卒，丢掉一个炮，算下来亏了。');
  // a v that is not a variant number counts as 0
  for (const v of [undefined, null, -1, 1.5, Number.NaN, '2']) assert.equal(composeLocal(F.try.turn, F.try.events, v), '【马二进三】走得稳，没有毛病。');
});

test('cueFor: every row of 8.7', () => {
  const quiet = base();
  // start
  assert.equal(cueFor(clone(F.start.turn), { i: 0, kind: 'start', first: true }, {}), 'go');
  // opp: a mate threat or a check -> alert; a threat on a rook or a piece, or a capture -> look; a chance -> oh; else none
  const opp = { i: 0, kind: 'opp' };
  assert.equal(cueFor(turnWith({ threats: [MATE_THREAT] }), opp, {}), 'alert');
  assert.equal(cueFor(oppTurn({ check: true }), opp, {}), 'alert');
  assert.equal(cueFor(oppTurn({ check: true, captured: 'H' }, { threats: [PIECE_THREAT], chance: { size: 'piece', theme: 'fork', area: 'left' } }), opp, {}), 'alert');
  assert.equal(cueFor(turnWith({ threats: [PIECE_THREAT] }), opp, {}), 'look');
  assert.equal(cueFor(turnWith({ threats: [{ ...PIECE_THREAT, sev: 'rook' }] }), opp, {}), 'look');
  assert.equal(cueFor(oppTurn({ captured: 'P' }), opp, {}), 'look');
  assert.equal(cueFor(oppTurn({ captured: 'P' }, { chance: { size: 'piece', theme: 'fork', area: 'left' } }), opp, {}), 'look');
  assert.equal(cueFor(turnWith({ chance: { size: 'piece', theme: 'fork', area: 'left' } }), opp, {}), 'oh');
  assert.equal(cueFor(turnWith({ threats: [{ ...PIECE_THREAT, sev: 'pawn' }], chance: { size: 'pawn', theme: 'capture_free', area: 'river' } }), opp, {}), 'oh');
  assert.equal(cueFor(clone(F.opp.turn), opp, {}), null, 'a pawn threat alone is no interjection');
  assert.equal(cueFor(quiet, opp, {}), null);
  assert.equal(cueFor(quiet, opp, { earned: true, voiced: true, lord: true }), null, 'the flags are about trials');

  // try: lord; earned + brilliant or a tactic motif -> wow; earned -> nice; voiced + blunder -> stop; voiced -> wait; else none.
  // The three praising interjections go only with a sentence from a praising row (only, avoided, taken, praise;
  // CONTRACT-NOTES 147): `plain` (a developing move, the steady row) has none, however the praise was earned.
  const plain = tryEvent();
  const tactic = tryEvent({ does: [FORK] });
  const checking = [{ k: 'check', by: P('me', 'R', 2) }];
  const brilliant = tryEvent({ cat: 'brilliant', does: checking });
  assert.equal(cueFor(quiet, tryEvent({ does: checking }), { lord: true, earned: true }), 'lord');
  assert.equal(cueFor(quiet, tactic, { lord: true, earned: true, voiced: true }), 'lord');
  assert.equal(cueFor(quiet, brilliant, { earned: true }), 'wow');
  for (const k of ['capture_free', 'fork', 'pin', 'discovered', 'mate', 'mate_threat']) {
    assert.equal(cueFor(quiet, tryEvent({ does: [{ k, by: P('me', 'H', 4), on: P('opp', 'R', 3), on2: P('opp', 'C', 7) }] }), { earned: true }), 'wow', k);
  }
  assert.equal(cueFor(quiet, tryEvent({ does: checking }), { earned: true }), 'nice', 'check is not a tactic motif');
  assert.equal(cueFor(quiet, tryEvent({ only: true }), { earned: true }), 'nice', 'the only row praises');
  assert.equal(cueFor(quiet, tryEvent({ avoided: 'greedy' }), { earned: true }), 'nice', 'the avoided row praises');
  assert.equal(cueFor(quiet, tryEvent({ chance: 'taken' }), { lord: true, earned: true }), 'lord', 'the taken row praises');
  assert.equal(cueFor(quiet, plain, { lord: true, earned: true }), null, 'the steady row: 主公英明！…不急不躁。 says two things at once');
  assert.equal(cueFor(quiet, plain, { earned: true }), null);
  assert.equal(cueFor(quiet, tryEvent({ cat: 'brilliant' }), { earned: true }), null);
  assert.equal(cueFor(quiet, tryEvent({ does: [] }), { earned: true }), null);
  assert.equal(cueFor(quiet, heldEvent({ cat: 'blunder' }), { voiced: true }), 'stop');
  assert.equal(cueFor(quiet, heldEvent(), { voiced: true }), 'wait');
  assert.equal(cueFor(quiet, heldEvent({ cat: 'blunder' }), {}), null, 'a held trial that is not voiced has no interjection');
  assert.equal(cueFor(quiet, tactic, {}), null, 'praise that was not earned has none');
  assert.equal(cueFor(quiet, plain, {}), null);
  // a move after which the child is mated is told from the grim row, whatever it does: no praising interjection, however
  // the flags were set (CONTRACT-NOTES 150). 妙哉！ was called out for a fork one move before the mate.
  const matedAfter = { b: 'lost', mate: -1 };
  for (const patch of [{ does: [FORK] }, { cat: 'brilliant', does: checking }, { only: true }, { avoided: 'greedy' }, { chance: 'taken', does: [FORK] },
    { does: [{ k: 'capture_free', by: P('me', 'R', 5), on: P('opp', 'P', 5) }], cost: { gain: ['P'], lose: [], cp: 100 } }]) {
    const event = tryEvent({ ...patch, eval: matedAfter });
    for (const flags of [{ earned: true }, { lord: true, earned: true }, { lord: true }]) assert.equal(cueFor(quiet, event, flags), null, JSON.stringify(patch));
    assert.notEqual(cueFor(quiet, tryEvent(patch), { lord: true, earned: true }), null, 'the same move with no mate after it is cheered');
  }
  assert.equal(cueFor(quiet, F.tryHeld.events[1], { voiced: true }), F.tryHeld.events[1].cue, 'section 9.5: wait');

  // hint, ask, recap: none
  for (const event of [hintEvent(1, { focus: 'danger', theme: 'escape' }), F.hint.events[3], ask('good'), ask('free', { say: '你好' }), F.recap.events[0]]) {
    assert.equal(cueFor(quiet, event, { earned: true, voiced: true, lord: true }), null, event.kind);
  }
  // over: by result
  assert.equal(cueFor(overTurn(), overEvent({ result: 'win' }), {}), 'win');
  assert.equal(cueFor(overTurn(), overEvent({ result: 'loss' }), {}), 'lose');
  assert.equal(cueFor(overTurn(), overEvent({ result: 'draw' }), {}), 'draw');
  assert.equal(cueFor(F.over.turn, F.over.events[0], {}), F.over.events[0].cue);
  assert.equal(cueFor(F.start.turn, F.start.events[0], {}), F.start.events[0].cue);

  // the table reaches every interjection, and only interjections
  const reached = new Set(['go', 'alert', 'look', 'oh', 'lord', 'wow', 'nice', 'stop', 'wait', 'win', 'lose', 'draw']);
  assert.deepEqual([...reached].sort(), [...CUE_CODES].sort());
  for (const code of reached) assert.equal(typeof CUE[code], 'string');
});

test('every verdict has exactly one cue rule and one fallback row', () => {
  // D-07, the half that lives in fallback.js (codes.test.js covers the mood): for every verdict of CATS
  // flags -> the one interjection of section 8.7, for a trial without a tactic motif. `lord` and `earned` are read for a
  // trial that gets a praising sentence (it gives check: the praise row); a verdict that has no praising row (ok, mistake,
  // blunder) has no praising interjection either (CONTRACT-NOTES 147).
  const CUES = {
    brilliant: { lord: 'lord', earned: 'wow', voiced: 'wait', none: null },
    best: { lord: 'lord', earned: 'nice', voiced: 'wait', none: null },
    good: { lord: 'lord', earned: 'nice', voiced: 'wait', none: null },
    ok: { lord: null, earned: null, voiced: 'wait', none: null },
    mistake: { lord: null, earned: null, voiced: 'wait', none: null },
    blunder: { lord: null, earned: null, voiced: 'stop', none: null },
  };
  const ROWS = { brilliant: 'try.steady', best: 'try.steady', good: 'try.steady', ok: 'try.ok', mistake: 'try.slow', blunder: 'try.slow' };
  const GOOD = {
    brilliant: '【马二进三】是妙手，难得一见。', best: '【马二进三】是眼下最好的一步。', good: '【马二进三】稳健，可以走。',
    ok: '【马二进三】稍慢，但不算错。', mistake: '【马二进三】是失误。', blunder: '【马二进三】是漏着。',
  };
  assert.deepEqual(Object.keys(CUES), [...CATS]);
  for (const cat of CATS) {
    const event = tryEvent({ cat });
    const checking = tryEvent({ cat, does: [{ k: 'check', by: P('me', 'R', 2) }] });
    assert.equal(cueFor(base(), checking, { lord: true }), CUES[cat].lord, cat);
    assert.equal(cueFor(base(), checking, { earned: true }), CUES[cat].earned, cat);
    assert.equal(cueFor(base(), event, { voiced: true }), CUES[cat].voiced, cat);
    assert.equal(cueFor(base(), event, {}), CUES[cat].none, cat);
    // with the row of a trial that has nothing special about it (steady, ok, slow) there is no praising interjection
    assert.equal(cueFor(base(), event, { lord: true, earned: true }), null, cat);
    // one row for a trial with nothing special about it, one sentence for 「这步好不好？」
    assert.equal(localLine(base(), [OPP_SILENT, event], []).row, ROWS[cat], cat);
    assert.equal(composeLocal(base(), [OPP_SILENT, spoken(event), ask('good')]), GOOD[cat], cat);
    // and one tail in the answer to a "what if"
    assert.equal(composeToolReply(base(), { seq: ['马二进三'], who: 'me', cat, loss: 0, eval: { b: 'even' }, does: [], flaws: [], cost: null, reply: null }), GOOD[cat], cat);
  }
  assert.equal(new Set(Object.values(GOOD)).size, CATS.length);
});

test('composeToolReply: the move, its verdict, the likely answer, the comparison with the try', () => {
  // section 9.7: 如果我走马二进三，对方走炮2平5呢？ The verdict about a move of the rival is a statement about his move
  // (对方这步…走得稳), never advice to the child (not 稳健，可以走).
  assert.equal(composeToolReply(base(), TOOL_VERDICT), '对方这步【炮2平5】走得稳。你多半走【车一平二】，双方都没有丢子。');
  assert.equal(composeToolReply(base(), { ...clone(TOOL_VERDICT), vsTry: 'better' }), '对方这步【炮2平5】走得稳。你多半走【车一平二】，双方都没有丢子。这样走比你正在试的那步更好。');
  assert.equal(composeToolReply(base(), { ...clone(TOOL_VERDICT), reply: null, vsTry: 'worse' }), '对方这步【炮2平5】走得稳。这样走比你正在试的那步更差。');
  // 比…差不多 is not a sentence: an equal comparison is left unsaid
  assert.equal(composeToolReply(base(), { ...clone(TOOL_VERDICT), reply: null, vsTry: 'same' }), '对方这步【炮2平5】走得稳。');
  // every verdict about a move of the rival, and about a move of the child
  const RIVAL = { brilliant: '对方这步【炮2平5】是妙手，难得一见。', best: '对方这步【炮2平5】是眼下最好的一步。', good: '对方这步【炮2平5】走得稳。',
    ok: '对方这步【炮2平5】稍慢，但不算错。', mistake: '对方这步【炮2平5】是失误。', blunder: '对方这步【炮2平5】是漏着。' };
  const CHILD = { brilliant: '【炮2平5】是妙手，难得一见。', best: '【炮2平5】是眼下最好的一步。', good: '【炮2平5】稳健，可以走。',
    ok: '【炮2平5】稍慢，但不算错。', mistake: '【炮2平5】是失误。', blunder: '【炮2平5】是漏着。' };
  for (const cat of CATS) {
    const text = composeToolReply(base(), { ...clone(TOOL_VERDICT), cat, reply: null });
    assert.equal(text, RIVAL[cat], cat);
    assert.doesNotMatch(text, /可以走/, 'no advice to the child about a move of the rival');
    assert.equal(composeToolReply(base(), { ...clone(TOOL_VERDICT), who: 'me', cat, reply: null }), CHILD[cat], cat);
  }

  // a move of the child: the rival answers; the cost is said once
  const own = { seq: ['炮五进四'], who: 'me', cat: 'mistake', loss: 350, eval: { b: 'worse' }, does: clone(HELD_TRY.try.does), flaws: clone(HELD_TRY.try.flaws),
    cost: clone(HELD_TRY.try.cost), reply: clone(MORE.reply), vsTry: 'worse' };
  assert.equal(composeToolReply(base(), own), '【炮五进四】是失误：你吃到一个卒，丢掉一个炮，算下来亏了。对方多半走【马7进5】。这样走比你正在试的那步更差。');
  // when nothing is lost the first flaw is the reason, and the answer keeps its outcome
  const slow = { ...clone(own), cat: 'blunder', flaws: [{ k: 'waste' }], cost: null, reply: { first: 'opp', moves: ['车9平8'], net: NET0, end: 'quiet' }, vsTry: undefined };
  assert.equal(composeToolReply(base(), slow), '【炮五进四】是漏着：这步没有实际作用，白让对方走一步。对方多半走【车9平8】，之后双方都没有丢子。');
  // what follows the rival's answer is told as a sequence (CONTRACT-NOTES 147): the child can take the pawn afterwards
  assert.equal(composeToolReply(base(), { ...clone(slow), cat: 'good', flaws: [], reply: { first: 'opp', moves: ['马8进7', '炮五进四'], net: { gain: ['P'], lose: [], cp: 100 }, end: 'quiet' } }),
    '【炮五进四】稳健，可以走。对方多半走【马8进7】，之后你能白吃一个卒。');
  // a mistake of the rival is one where the child gains
  const gift = { seq: ['马二进三', '炮2进7'], who: 'opp', cat: 'blunder', loss: 450, eval: { b: 'better' }, does: [], flaws: [],
    cost: { gain: ['C'], lose: [], cp: 450 }, reply: { first: 'me', moves: ['车九平八'], net: { gain: ['C'], lose: [], cp: 450 }, end: 'quiet' } };
  assert.equal(composeToolReply(base(), gift), '对方这步【炮2进7】是漏着：你白吃一个炮。你多半走【车九平八】。');
  // 你多半走【X】，… has one subject: the balance of the child's answer does not say 你 again
  const pawn = { seq: ['马二进三', '卒3进1'], who: 'opp', cat: 'mistake', loss: 200, eval: { b: 'even' }, does: [], flaws: [{ k: 'waste' }], cost: null,
    reply: { first: 'me', moves: ['兵七进一'], net: { gain: ['P'], lose: [], cp: 100 }, end: 'quiet' } };
  assert.equal(composeToolReply(base(), pawn), '对方这步【卒3进1】是失误：没有实际作用，白让你走一步。你多半走【兵七进一】，白吃一个卒。');
  assert.equal(composeToolReply(base(), { ...pawn, flaws: [], reply: { first: 'me', moves: ['炮五进四', '马7进5'], net: { gain: ['P'], lose: ['C'], cp: -350 }, end: 'quiet' } }),
    '对方这步【卒3进1】是失误。你多半走【炮五进四】，吃到一个卒，丢掉一个炮，算下来亏了。');
  // the two flaw clauses that name a side are turned round for a move of the rival: his slip gives the child the kill or the move
  const careless = { seq: ['车二进六', '士4进5'], who: 'opp', cat: 'blunder', loss: 2000, eval: { b: 'won', mate: 1 }, does: [], flaws: [{ k: 'allow_mate' }], cost: null,
    reply: { first: 'me', moves: ['车二进三'], net: NET0, end: 'mate' } };
  assert.equal(composeToolReply(base(), careless), '对方这步【士4进5】是漏着：走完之后，你就有杀棋。你多半走【车二进三】，最后将死对方。');
  assert.equal(composeToolReply(base(), { ...careless, who: 'me', seq: ['仕四进五'], eval: { b: 'lost', mate: -1 }, reply: { first: 'opp', moves: ['车2进7'], net: NET0, end: 'mate' } }),
    '【仕四进五】是漏着：这步走完，对方就有杀棋。对方多半走【车2进7】，最后你被将死。');
  // a line that ends in mate says who is mated: the child (被将死) or the rival (将死对方)
  const mated = { seq: ['仕四进五'], who: 'me', cat: 'blunder', loss: 2000, eval: { b: 'lost', mate: -1 }, does: [], flaws: [{ k: 'allow_mate' }], cost: null,
    reply: { first: 'opp', moves: ['车2进7'], net: NET0, end: 'mate' } };
  assert.equal(composeToolReply(base(), mated), '【仕四进五】是漏着：这步走完，对方就有杀棋。对方多半走【车2进7】，最后你被将死。');
  const mating = { seq: ['车二进七'], who: 'me', cat: 'brilliant', loss: 0, eval: { b: 'won', mate: 2 }, does: [{ k: 'check', by: P('me', 'R', 2) }], flaws: [], cost: null,
    reply: { first: 'opp', moves: ['将5进1', '车二退一'], net: NET0, end: 'mate' } };
  assert.equal(composeToolReply(base(), mating), '【车二进七】是妙手，难得一见。对方多半走【将5进1】，最后你将死对方。');
  const crushing = { seq: ['兵三进一', '车2进7'], who: 'opp', cat: 'best', loss: 0, eval: { b: 'lost', mate: -2 }, does: [], flaws: [], cost: null,
    reply: { first: 'me', moves: ['帅五进一', '车2退1'], net: { gain: [], lose: ['A'], cp: -200 }, end: 'mate' } };
  assert.equal(composeToolReply(base(), crushing), '对方这步【车2进7】是眼下最好的一步。你多半走【帅五进一】，白丢一个仕，最后被将死。');
  assert.equal(composeToolReply(base(), { ...crushing, reply: { ...crushing.reply, net: NET0 } }), '对方这步【车2进7】是眼下最好的一步。你多半走【帅五进一】，最后被将死。');
  // a balance the verdict sentence has just given as the reason is not repeated before the mate
  const lostAdvisor = { gain: [], lose: ['A'], cp: -200 };
  assert.equal(composeToolReply(base(), { ...mated, eval: { b: 'lost', mate: -2 }, cost: lostAdvisor, reply: { first: 'opp', moves: ['车2进7', '帅五进一', '车2退1'], net: lostAdvisor, end: 'mate' } }),
    '【仕四进五】是漏着：你白丢一个仕。对方多半走【车2进7】，最后你被将死。');
  const wonAdvisor = { gain: ['A'], lose: [], cp: 200 };
  assert.equal(composeToolReply(base(), { ...careless, eval: { b: 'won', mate: 2 }, cost: wonAdvisor, reply: { first: 'me', moves: ['车二进七', '将5进1', '车二退一'], net: wonAdvisor, end: 'mate' } }),
    '对方这步【士4进5】是漏着：你白吃一个士。你多半走【车二进七】，最后将死对方。');
  // without a mate distance in the evaluation the side that makes the last move of the line gives the mate
  assert.equal(composeToolReply(base(), { ...mating, eval: { b: 'won' } }), '【车二进七】是妙手，难得一见。对方多半走【将5进1】，最后你将死对方。');
  assert.equal(composeToolReply(base(), { ...mated, eval: { b: 'lost' } }), '【仕四进五】是漏着：这步走完，对方就有杀棋。对方多半走【车2进7】，最后你被将死。');
  assert.equal(composeToolReply(base(), { ...crushing, eval: { b: 'lost' }, reply: { ...crushing.reply, net: NET0 } }), '对方这步【车2进7】是眼下最好的一步。你多半走【帅五进一】，最后被将死。');

  // within the cap of a free answer: sentences are dropped from the end
  const big = { gain: ['R', 'H', 'C', 'P', 'A', 'E'], lose: ['R', 'H', 'C', 'P', 'A', 'E'], cp: 0 };
  const wordy = composeToolReply(base(), { ...clone(own), cost: null, flaws: [{ k: 'waste' }], reply: { first: 'opp', moves: ['马7进5'], net: big, end: 'quiet' } });
  assert.equal(wordy, '【炮五进四】是失误：这步没有实际作用，白让对方走一步。');
  assert.ok(plainLength(wordy) <= CAPS.free);
  assert.equal(composeToolReply(base(), { ...clone(own), seq: [] }), '');
});

test('composeLocal returns \'\' for nothing worth saying, never filler', () => {
  const nothing = { text: '', row: '', v: 0 };
  // a recap is never the event to answer
  assert.equal(composeLocal(F.recap.turn, F.recap.events.slice(0, 1)), '');
  assert.deepEqual(localLine(F.recap.turn, F.recap.events.slice(0, 1), []), nothing);
  // an opp event without a rival move in the brief and without a mate threat: there is nothing to read
  assert.equal(composeLocal(clone(F.start.turn), OPP_LAST), '');
  assert.equal(composeLocal(turnWith({ opp: null, threats: [MATE_THREAT] }), OPP_LAST), '对方下一步有杀棋，先护帅！', 'a mate threat is always worth a sentence');
  // no events
  assert.equal(composeLocal(base(), []), '');
  assert.deepEqual(localLine(base(), [], []), nothing);

  // questions about a trial when no trial is in the thread
  for (const code of ['good', 'reply', 'better', 'show']) assert.equal(composeLocal(base(), [OPP_SILENT, ask(code)]), '', code);
  // the rival's reply to a held trial is withheld until the follow-up brings it: nothing is claimed before
  assert.equal(composeLocal(base(), [OPP_SILENT, HELD_TRY, ask('reply')]), '');
  assert.equal(composeLocal(base(), [OPP_SILENT, HELD_TRY, ask('show')]), '');
  assert.equal(composeLocal(base(), [OPP_SILENT, HELD_TRY, ask('better')]), '', 'whether a better move exists is not known without the withheld packet');
  // once it arrived it stays known for the rest of the thread
  const later = [OPP_SILENT, HELD_TRY, spoken(ask('reply', { i: 2, more: clone(MORE) })), ask('better', { i: 3 })];
  assert.equal(composeLocal(base(), later), '更好的是【马二进三】：你的三路马出动。之后双方都没有丢子。');
  // a newer trial hides the older one
  const newer = [OPP_SILENT, HELD_TRY, spoken(ask('reply', { i: 2, more: clone(MORE) })), spoken({ ...tryEvent(), i: 3, n: 2 }), ask('reply', { i: 4, more: { better: [] } })];
  assert.equal(composeLocal(base(), newer), '对方没有特别厉害的应对。');

  // game-over questions outside a game-over thread, and turn questions inside one
  for (const code of ['proud', 'improve', 'next']) assert.equal(composeLocal(base(), [OPP_SILENT, ask(code)]), '', code);
  // after the game there is no rival intent left to explain (为什么？ is answered from the game-over packet: see its own test)
  assert.equal(composeLocal(overTurn(), overThread('intent')), '');
  assert.notEqual(composeLocal(overTurn(), overThread('why')), '');
  // a why about a move that did nothing notable
  assert.equal(composeLocal(base(), [OPP_SILENT, spoken(tryEvent({ does: [] })), ask('why')]), '');

  // every sentence that is said is one of the contract, never a stock phrase
  for (const c of SWEEP) {
    for (let v = 0; v < 6; v++) assert.doesNotMatch(composeLocal(c.turn, c.events, v), /加油|真棒|太厉害|不错哦|继续努力/);
  }
});

test('what a sentence says is in the packet', () => {
  // 握手言和。 is already the interjection of a draw: the sentence goes on from it instead of saying it twice
  const draw = { result: 'draw', reason: 'repetition', takeaway: null, proud: null, goal: null, rank: null };
  assert.equal(CUE.draw, '握手言和。');
  assert.equal(composeLocal(overTurn(), [overEvent(draw, 'draw')]), '旗鼓相当。');
  assert.equal(composeLocal(overTurn(), [overEvent(draw, null)]), '握手言和，旗鼓相当。');
  // 有几步走得真不错 needs a few good moves to point at
  const short = { result: 'loss', reason: 'resign', moves: 3, takeaway: null, proud: null, goal: null, rank: null };
  const few = { good: 1, taken: 0, captures: 0, brilliant: 0 };
  assert.equal(composeLocal(overTurn(), [overEvent({ ...short, kept: true, stats: few }, 'lose')]), '这盘惜败。上盘说好的，做到了！');
  assert.equal(composeLocal(overTurn(), [overEvent({ ...short, kept: null, rank: { to: 2 }, stats: few }, 'lose')]), `这盘惜败。兵法升到「${RANK_NAMES[1]}」！`);
  assert.equal(composeLocal(overTurn(), [overEvent({ ...short, kept: null, proud: { n: 2, s: 'me', move: '炮五进四', tag: 'great', k: 'capture' }, stats: few }, 'lose')]),
    '这盘惜败。第2回合的【炮五进四】最漂亮：吃子。');
  // ... and with nothing at all to point at (no proud move, no kept goal, no new rank) 这盘惜败。 does not stand alone in the
  // takeaway box of the card (CONTRACT-NOTES 147). The card's own line under the title says 胜败乃兵家常事: not said twice.
  for (const kept of [null, false]) {
    const alone = composeLocal(overTurn(), [overEvent({ ...short, kept, stats: few }, 'lose')]);
    assert.equal(alone, '这盘惜败。每一盘都是练兵，下一盘再战。');
    assert.ok(plainLength(alone) <= 30 && plainLength(alone) <= CAPS.over, 'within the cap of the takeaway sentence and of the line');
    assert.doesNotMatch(alone, /胜败乃兵家常事/);
  }
  assert.equal(composeLocal(overTurn(), [overEvent({ ...short, kept: null, goal: 'greedy', stats: few }, 'lose')]), '这盘惜败。每一盘都是练兵，下一盘再战。', 'the goal is the card\'s, not the line\'s');
  assert.equal(composeLocal(overTurn(), [overEvent({ ...short, kept: null, stats: { good: 2, taken: 0, captures: 0, brilliant: 0 } }, 'lose')]), '这盘惜败，不过有几步走得真不错。');
  // a win and a draw with nothing to point at are what they were
  assert.equal(composeLocal(overTurn(), [overEvent({ ...short, result: 'win', reason: 'checkmate', kept: null, stats: few })]), '这盘赢得漂亮！');
  // the goal and the rank are the tables of codes.js
  for (const goal of HABIT_CODES) {
    // the goal is said once on the card, in its own row (CONTRACT-NOTES 138): the game-over line does not carry it ...
    assert.equal(composeLocal(overTurn(), [overEvent({ goal, proud: null, rank: null })]), '这盘赢得漂亮！');
    assert.ok(!composeLocal(overTurn(), [overEvent({ goal })]).includes(HABIT_FIX[goal]), goal);
    assert.ok(!composeLocal(overTurn(), [overEvent({ goal })]).includes('小目标'), goal);
    // ... and 「下一盘注意什么？」 still answers with it: one dash, and at most the colon the goal itself holds
    const next = composeLocal(overTurn(), overThread('next', { goal }));
    for (const sentence of next.split(/[。！？]/)) assert.ok((sentence.match(/：/g) ?? []).length <= 1, sentence);
    assert.equal(next, `下一盘记住一件事——${HABIT_FIX[goal]}。`);
  }
  RANK_NAMES.forEach((name, k) => {
    assert.equal(composeLocal(overTurn(), [overEvent({ goal: null, proud: null, rank: { to: k + 1 } })]), `这盘赢得漂亮！兵法升到「${name}」！`);
  });
  assert.equal(composeLocal(overTurn(), [overEvent({ goal: null, proud: { n: 7, s: 'me', move: '车二进七', tag: 'great' }, rank: null })]), '这盘赢得漂亮！第7回合的【车二进七】最漂亮。');

  // 指给我看 names the rival's piece that threatens: the flaw's `by`, or the guard (`on2`) of a greedy capture (section 9.5)
  assert.equal(composeLocal(base(), [OPP_SILENT, HELD_TRY, ask('show', { more: clone(MORE) })]), '是对方的7路马在威胁。它会走【马7进5】，之后你吃到一个卒，丢掉一个炮，算下来亏了。');
  // a flaw that names no rival piece: the reply sentence
  const unguard = [OPP_SILENT, spoken(UNGUARD_TRY()), ask('show', { more: { reply: { first: 'opp', moves: ['炮2进4'], net: { gain: [], lose: ['H'], cp: -400 }, end: 'quiet' }, better: [] } })];
  assert.equal(composeLocal(base(), unguard), '对方多半走【炮2进4】，之后你白丢一个马。');

  // a reply line that ends in mate is not summed up as "nobody loses a piece": it says who is mated
  const mate = [OPP_SILENT, spoken(MATE_TRY()), ask('reply', { more: { reply: { first: 'opp', moves: ['车2进7'], net: NET0, end: 'mate' }, better: [] } })];
  assert.equal(composeLocal(base(), mate), '对方多半走【车2进7】，最后你被将死。');
  assert.equal(composeLocal(base(), [...mate.slice(0, 2), ask('why', { more: mate[2].more })]), '因为这步走完，对方就有杀棋。对方走【车2进7】，最后你被将死。');
  // with a balance before it the subject is not said twice: 你白丢…，最后被将死
  const costly = { reply: { first: 'opp', moves: ['车2进7', '帅五进一', '车2退1'], net: { gain: [], lose: ['A'], cp: -200 }, end: 'mate' }, better: [] };
  assert.equal(composeLocal(base(), [...mate.slice(0, 2), ask('reply', { more: costly })]), '对方多半走【车2进7】，之后你白丢一个仕，最后被将死。');
  assert.equal(composeLocal(base(), [...mate.slice(0, 2), ask('why', { more: costly })]), '因为这步走完，对方就有杀棋。对方走【车2进7】之后，你白丢一个仕，最后被将死。');
  const rookMate = [OPP_SILENT, spoken(heldEvent({ move: '兵三进一', cat: 'blunder', loss: 2000, eval: { b: 'lost', mate: -1 }, does: [{ k: 'quiet' }],
    flaws: [{ k: 'ignore_threat', by: P('opp', 'R', 2), on: P('me', 'K', 5) }], cost: null })), ask('show', { more: mate[2].more })];
  assert.equal(composeLocal(base(), rookMate), '是对方的2路车在威胁。它会走【车2进7】，最后你被将死。');
  // a line in which the child gives the mate: 将死对方
  const winning = { move: '车二进七', gain: 2000, does: [{ k: 'check', by: P('me', 'R', 2) }], line: { first: 'opp', moves: ['将5进1', '车二退一'], net: NET0, end: 'mate' } };
  assert.equal(composeLocal(base(), [OPP_SILENT, spoken(tryEvent({ cat: 'mistake', loss: 2000 })), ask('better', { more: { better: [winning] } })]),
    '更好的是【车二进七】：你的二路车将军。最后你将死对方。');
  const winsHorse = { ...winning, does: [{ k: 'capture', by: P('me', 'R', 2), on: P('opp', 'H', 2) }], line: { ...winning.line, net: { gain: ['H'], lose: [], cp: 400 } } };
  assert.equal(composeLocal(base(), [OPP_SILENT, spoken(tryEvent({ cat: 'mistake', loss: 2000 })), ask('better', { more: { better: [winsHorse] } })]),
    '更好的是【车二进七】：你的二路车吃掉对方的2路马。之后你能白吃一个马，最后将死对方。');
  const goodTry = spoken(tryEvent({ move: '车二进七', cat: 'best', eval: { b: 'won', mate: 2 }, does: [{ k: 'check', by: P('me', 'R', 2) }], reply: clone(winning.line) }));
  assert.equal(composeLocal(base(), [OPP_SILENT, goodTry, ask('reply', { more: { better: [] } })]), '对方多半走【将5进1】，最后你将死对方。');
  // every move is mated and the better one only later: the last move of its line is the rival's, so the child is the one mated
  const later = { move: '帅五进一', gain: 300, does: [{ k: 'escape', by: P('me', 'K', 5) }], line: { first: 'opp', moves: ['车2退1', '帅五退一', '车2进1'], net: NET0, end: 'mate' } };
  assert.equal(composeLocal(base(), [...mate.slice(0, 2), ask('better', { more: { reply: mate[2].more.reply, better: [later] } })]),
    '更好的是【帅五进一】：你的帅躲开了攻击。最后你被将死。');
  // the mate distance of the trial decides when it is known (a packet may list fewer moves than the line has)
  const cut = { reply: { first: 'opp', moves: ['车2进7', '帅五进一'], net: NET0, end: 'mate' }, better: [] };
  assert.equal(composeLocal(base(), [OPP_SILENT, spoken(heldEvent({ ...MATE_TRY().try, eval: { b: 'lost', mate: -4 } })), ask('reply', { more: cut })]), '对方多半走【车2进7】，最后你被将死。');
  // a line that ends in check or quietly says nothing about a mate
  for (const end of ['quiet', 'check']) {
    assert.equal(composeLocal(base(), [...mate.slice(0, 2), ask('reply', { more: { reply: { ...mate[2].more.reply, end }, better: [] } })]), '对方多半走【车2进7】，之后双方都没有丢子。');
  }

  // a mistake is explained by what it costs when it costs something, else by its flaw; a gain is never given as the reason
  const missed = tryEvent({ move: '炮五进四', cat: 'mistake', loss: 400, does: [{ k: 'capture_free', by: P('me', 'C', 5), on: P('opp', 'P', 5) }],
    flaws: [{ k: 'miss_capture', on: P('opp', 'R', 3) }], cost: { gain: ['P'], lose: [], cp: 100 } });
  assert.equal(composeLocal(base(), [OPP_SILENT, spoken(missed), ask('good')]), '【炮五进四】是失误：错过了白吃对方的3路车的机会。');

  // ... nor a balance in which the mover comes out ahead or level: 是漏着：…算下来赚了 would contradict itself
  const ahead = tryEvent({ move: '车二进五', cat: 'blunder', loss: 1500, does: [{ k: 'capture', by: P('me', 'R', 2), on: P('opp', 'R', 2) }],
    flaws: [{ k: 'miss_mate' }], cost: { gain: ['R'], lose: ['C'], cp: 450 } });
  assert.equal(composeLocal(base(), [OPP_SILENT, spoken(ahead), ask('good')]), '【车二进五】是漏着：错过了一步杀棋。');
  const level = tryEvent({ move: '炮五进四', cat: 'mistake', loss: 200, flaws: [], cost: { gain: ['P'], lose: ['P'], cp: 0 } });
  assert.equal(composeLocal(base(), [OPP_SILENT, spoken(level), ask('good')]), '【炮五进四】是失误。');
  assert.equal(composeLocal(turnWith({ mine: { move: '车二进五', cat: 'blunder', waited: true, self: true, try: clone(ahead.try) } }), [OPP_SILENT, ask('last')]),
    '【车二进五】是漏着：错过了一步杀棋。', 'what a blunder did is not added: the piece may be gone by now');
  // the same for a move of the rival in a "what if": its mistake is one in which the child comes out ahead
  const rival = { seq: ['马二进三', '炮2进7'], who: 'opp', cat: 'mistake', loss: 300, eval: { b: 'even' }, does: [], flaws: [], reply: null };
  assert.equal(composeToolReply(base(), { ...rival, cost: { gain: ['C'], lose: ['R'], cp: -450 } }), '对方这步【炮2进7】是失误。');
  assert.equal(composeToolReply(base(), { ...rival, cost: { gain: ['C'], lose: ['P'], cp: 350 } }), '对方这步【炮2进7】是失误：你吃到一个炮，丢掉一个兵，算下来赚了。');

  // 没危险 and 稳 are not said of a move whose best answer takes something (a pawn dropped while a chance was missed) ...
  const dropsPawn = (cat, chance) => [OPP_SILENT, tryEvent({ move: '兵三进一', cat, loss: 180, does: [{ k: 'quiet' }], toward: { area: 'left', theme: 'fork' }, chance,
    cost: { gain: [], lose: ['P'], cp: -100 } })];
  assert.deepEqual([0, 1, 2].map((v) => composeLocal(base(), dropsPawn('mistake', 'missed'), v)), ['别急，左翼还有便宜没占。', '别急，左翼还有便宜没占。', '别急，左翼还有便宜没占。']);
  assert.equal(localLine(base(), dropsPawn('mistake', 'missed'), []).v, 1);
  // ... and 不吃亏 / 稳 not of a slow move that comes out behind; an even trade does not
  assert.deepEqual([0, 1, 2, 3].map((v) => composeLocal(base(), dropsPawn('ok', 'none'), v)),
    ['可行，只是不够紧。', '可行，只是不够紧。', '可行，只是不够紧。', '【兵三进一】不坏，左翼还有更积极的走法。']);
  const evenTrade = [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 60, does: [{ k: 'trade', by: P('me', 'P', 3), on: P('opp', 'P', 3) }], cost: { gain: ['P'], lose: ['P'], cp: 0 } })];
  assert.equal(composeLocal(base(), evenTrade, 0), '【兵三进一】可以走，不吃亏。');

  // 慢慢扳回来 needs something to win back: after an even trade (the rival recaptures) the child is not behind
  const recapture = (cp) => oppTurn({ move: '马7进5', captured: 'C', does: [{ k: 'capture', by: P('opp', 'H', 5), on: P('me', 'C', 5) }] },
    { mat: { me: 'R2H2C1P5A2E2', opp: 'R2H2C1P5A2E2', cp } });
  assert.equal(composeLocal(recapture(0), OPP_LAST, 4), '炮没了，先看眼前。');
  assert.equal(composeLocal(recapture(-450), OPP_LAST, 4), '少了一个炮，慢慢扳回来。');
  for (let ply = 1; ply <= 12; ply++) assert.notEqual(localLine({ ...recapture(0), ply }, OPP_LAST, []).v, 4);

  // 是稳健 is not a sentence: for a steady move without a packet 「我上一步怎么样？」 gets the `good` sentence
  const bare = (cat) => composeLocal(turnWith({ mine: { move: '炮二平五', cat, waited: false, self: true } }), [OPP_SILENT, ask('last')]);
  assert.deepEqual(CATS.map(bare), ['【炮二平五】是妙手。', '【炮二平五】是好棋。', '【炮二平五】稳健，可以走。', '【炮二平五】是缓着。', '【炮二平五】是失误。', '【炮二平五】是漏着。']);

  // 下一步就要将死，必须先解围 is advice to the side under threat: about the child's own mating threat the term is said
  const threat = [{ k: 'mate_threat', by: P('me', 'R', 2) }];
  assert.equal(composeLocal(base(), [OPP_SILENT, tryEvent({ move: '车二进七', does: threat })], 0), '【车二进七】叫杀。');
  assert.equal(composeLocal(base(), [OPP_SILENT, hintEvent(3, { move: '车二进七', does: threat, line: null })]), '可以走【车二进七】：叫杀。');
  assert.equal(composeLocal(oppTurn({ move: '车2进6', does: [{ k: 'mate_threat', by: P('opp', 'R', 2) }] }), [OPP_SILENT, ask('intent')]),
    '对方这步的用意：2路车下一步就要将死，必须先解围。');

  // before the rival has moved, 是在调整阵形 has nothing to describe
  assert.equal(composeLocal(clone(F.start.turn), [spoken({ i: 0, kind: 'start' }), ask('intent')]), '对方眼下没有直接的威胁。');
  // a threat that wins nothing is named without a balance
  const checkOnly = { k: 'check', by: P('opp', 'R', 2), move: '车2进7', net: NET0, sev: 'pawn' };
  assert.equal(composeLocal(turnWith({ threats: [checkOnly] }), [OPP_SILENT, ask('intent')]), '对方下一步想走【车2进7】。');
  // ... and a check that is only threatened is not on the board yet: 下一步要将军, not the …将军 of a check given
  assert.equal(composeLocal(turnWith({ threats: [checkOnly] }), [OPP_SILENT, ask('danger')]), '要当心：对方的2路车下一步要将军。');
  assert.equal(composeLocal(oppTurn({ move: '车2进7', check: true, does: [{ k: 'check', by: P('opp', 'R', 2) }] }), [OPP_SILENT, ask('intent')]), '对方这步的用意：2路车将军。');

  // 「我有危险吗？」 with no threat listed: 没有直接的危险，可以放心走 is not said while the child is in check (the list holds
  // captures and mates, not the check itself), nor when the evaluation has found a forced mate against the child
  const checked = oppTurn({ move: '炮2平5', check: true, does: [{ k: 'check', by: P('opp', 'C', 5) }] }, { check: true });
  assert.deepEqual(checked.threats, []);
  assert.equal(composeLocal(checked, [OPP_SILENT, ask('danger')]), '被将军了，先应将。');
  assert.equal(composeLocal({ ...checked, known: { threats: false, chance: false } }, [OPP_SILENT, ask('danger')]), '被将军了，先应将。');
  assert.equal(composeLocal({ ...checked, threats: [PIECE_THREAT] }, [OPP_SILENT, ask('danger')]), '要当心：对方的6路马捉你的五路炮。', 'a listed threat is still named');
  assert.equal(composeLocal(turnWith({ eval: { b: 'lost', mate: -3 } }), [OPP_SILENT, ask('danger')]), '要当心：3步之内有被将死的危险。');
  assert.equal(composeLocal(turnWith({ eval: { b: 'lost', mate: -3 }, known: { threats: false, chance: false } }), [OPP_SILENT, ask('danger')]), '要当心：3步之内有被将死的危险。');
  assert.equal(composeLocal(turnWith({ eval: { b: 'won', mate: 3 } }), [OPP_SILENT, ask('danger')]), '眼下没有直接的危险，可以放心走。');
  assert.equal(composeLocal(turnWith({ eval: { b: 'lost' } }), [OPP_SILENT, ask('danger')]), '眼下没有直接的危险，可以放心走。', 'behind, but nothing is threatened directly');
  for (const c of SWEEP) {
    const last = c.events[c.events.length - 1];
    if (last.kind !== 'ask' || last.ask !== 'danger') continue;
    for (const patch of [{ check: true }, { eval: { b: 'lost', mate: -1 } }]) {
      assert.doesNotMatch(composeLocal({ ...c.turn, ...patch }, c.events), /放心走|没发现直接的危险/, c.name);
    }
  }

  // 「我哪步下得最好？」 without a highlight: 每一步都走得很稳 is said only when every move the child played was steady or
  // better (stats.good counts those); otherwise nothing is claimed about the moves
  const noHighlight = (moves, good) => composeLocal(overTurn(), overThread('proud', { proud: null, moves, stats: { good, taken: 0, captures: 0, brilliant: 0 } }));
  assert.equal(noHighlight(12, 12), '这盘每一步都走得很稳。');
  assert.equal(noHighlight(2, 2), '这盘每一步都走得很稳。');
  assert.equal(noHighlight(12, 11), '这盘还没走出最漂亮的一步，下一盘咱们一起找。');
  assert.equal(noHighlight(3, 0), '这盘还没走出最漂亮的一步，下一盘咱们一起找。');
  assert.equal(noHighlight(0, 0), '这盘还没走出最漂亮的一步，下一盘咱们一起找。', 'a game without a move of the child has no steady move either');
  assert.equal(composeLocal(overTurn(), overThread('proud', { result: 'loss', reason: 'resign', moves: 3, stats: { good: 1, taken: 0, captures: 0, brilliant: 0 }, proud: null, takeaway: null, goal: null, rank: null })),
    '这盘还没走出最漂亮的一步，下一盘咱们一起找。');

  // The caption carries the name of the pattern, so the sentence never is the name alone (这是顺炮。 after 【炮8平5】顺炮):
  // 常见的阵势 is said of openings, an attacking formation is worded as an attack and a weakness as a weakness (窝心马 is
  // not 常见的阵势); the name of a tactic gets no sentence of its own
  for (const name of PATTERN_CODES) {
    const texts = [0, 1, 2].map((v) => composeLocal(oppTurn({ name, does: [] }), OPP_LAST, v));
    const opening = PATTERN_CODES.indexOf(name) < 9;
    const said = opening ? `${PATTERN_NAME[name]}，常见的阵势。` : name === 'empty_cannon' ? '空头炮，厉害的攻势。' : name === 'heart_horse' ? '窝心马，是个弱点。' : null;
    if (said) assert.deepEqual(texts, [said, said, said], name);
    else for (const text of texts) assert.doesNotMatch(text, new RegExp(PATTERN_NAME[name]), name);
    if (!opening) for (const text of texts) assert.doesNotMatch(text, /常见的阵势/, name);
  }
  // a chance in the child's own palace or back rows: the area is not named, in any variant, for either colour
  for (const area of ['my_palace', 'my_back']) {
    for (const me of ['red', 'black']) {
      const own = { ...oppTurn({ move: '卒3进1' }, { chance: { size: 'piece', theme: 'capture_free', area }, known: { threats: true, chance: true } }), me };
      assert.deepEqual([0, 1, 2, 3].map((v) => composeLocal(own, OPP_LAST, v)), ['对方好像露了破绽。', '眼下有文章可做。', '找一找，有机会。', '对方好像露了破绽。'], area);
    }
  }
  // ... and nowhere does a local line say that the child's own palace or back rows hold a chance (CONTRACT-NOTES 138)
  for (const c of SWEEP) {
    for (let v = 0; v < 6; v++) assert.doesNotMatch(composeLocal(c.turn, c.events, v), /己方(?:九宫|底线)(?:有个机会|有文章|好像露|，有机会|还有便宜|的机会)|机会在己方/, c.name);
  }
  // 跳 is said of a horse
  assert.equal(composeLocal(base(), [OPP_SILENT, FORK_TRY(P('opp', 'R', 4))], 0), '你的一路车和你的五路炮，会同时被捉吗？');
  // 站得太近 is said only when one short-stepping piece attacks both: two pieces a rook or a cannon reaches along a line, or
  // two pieces attacked by different pieces, need not stand close
  for (const t of ['H', 'P', 'A', 'E', 'K']) assert.equal(composeLocal(base(), [OPP_SILENT, FORK_TRY(P('opp', t, 4))], 1), '你的一路车和你的五路炮，是不是站得太近？', t);
  for (const by of [P('opp', 'R', 4), P('opp', 'C', 4), undefined]) {
    for (let v = 0; v < 3; v++) assert.doesNotMatch(composeLocal(base(), [OPP_SILENT, FORK_TRY(by)], v), /站得太近/);
  }
  // a clause whose pieces are not in the packet says no more than the caption: no line about that rival move
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'develop' }] }), OPP_LAST, 0), '');
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'defend' }] }), OPP_LAST, 0), '');
  // a missed chance is pointed at through the try's own direction, else through the announced chance; without either it is not mentioned
  const missedTry = (toward) => [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 160, does: [{ k: 'quiet' }], toward, chance: 'missed' })];
  assert.equal(composeLocal(turnWith({ chance: { size: 'piece', theme: 'fork', area: 'river' }, known: { threats: true, chance: true } }), missedTry(null), 0), '【兵三进一】没危险，可河口有个机会。');
  assert.equal(composeLocal(base(), missedTry(null), 0), '【兵三进一】可以走，不吃亏。');
  // pouch 2 after compaction: the direction is read from the theme when the first pouch is no longer in the thread
  assert.equal(composeLocal(base(), [clone(F.recap.events[0]), hintEvent(2, { piece: P('me', 'H', 8), area: 'left', theme: 'escape' }, 11)]),
    '该照顾一下你的八路马了。');
  // what is lost in a held trial is named by its dearest piece
  assert.equal(composeLocal(base(), [OPP_SILENT, heldEvent({ flaws: [], cost: { gain: ['P'], lose: ['P', 'R', 'H'], cp: -1300 } })], 0), '走完这步，你的车有危险吗？');
});

test('the corrected sentences (CONTRACT-NOTES item 113)', () => {
  const praise = (patch) => [OPP_SILENT, tryEvent({ move: '马三进四', ...patch })];
  const six = (events, turn = base()) => [0, 1, 2, 3, 4, 5].map((v) => composeLocal(turn, events, v));

  // (e) 对方难受了 needs a gain, a threat or a check for the child in the packet; otherwise the next variant is said
  const HARD = /对方难受了/;
  const trade = praise({ move: '炮五进四', cat: 'good', does: [{ k: 'trade', by: P('me', 'C', 5), on: P('opp', 'C', 5) }], cost: { gain: ['C'], lose: ['C'], cp: 0 } });
  assert.deepEqual(six(trade), ['好一步【炮五进四】：兑子。', '好一步【炮五进四】：兑子。', '好一步【炮五进四】：兑子。', '【炮五进四】这步兑子，漂亮。', '此计可行：【炮五进四】兑子。', '好一步【炮五进四】：兑子。']);
  const crossing = praise({ move: '兵三进一', cat: 'good', does: [{ k: 'cross_river', by: P('me', 'P', 3) }] });
  assert.equal(composeLocal(base(), crossing, 5), '【兵三进一】：你的三路兵过了河，之后可以横走。');
  for (let move = 1; move <= 12; move++) {
    for (const events of [trade, crossing]) assert.doesNotMatch(localLine({ ...base(), ply: 2 * move }, events, []).text, HARD);
  }
  // a pawn that crosses the river and attacks something does press the rival; so does a trade that leads to a mate
  assert.match(composeLocal(base(), praise({ does: [{ k: 'cross_river', by: P('me', 'P', 3) }, { k: 'attack', by: P('me', 'P', 3), on: P('opp', 'H', 3) }] }), 5), HARD);
  assert.match(composeLocal(base(), praise({ does: [{ k: 'trade', by: P('me', 'C', 5), on: P('opp', 'C', 5) }], eval: { b: 'won', mate: 2 } }), 5), HARD);
  // a capture counts when the child comes out ahead in the settled balance, a sacrifice when it brings a check or a mate
  const takes = { k: 'capture', by: P('me', 'H', 4), on: P('opp', 'C', 4) };
  assert.match(composeLocal(base(), praise({ does: [takes], cost: { gain: ['C'], lose: [], cp: 450 } }), 5), HARD);
  assert.match(composeLocal(base(), praise({ does: [takes], cost: { gain: ['C'], lose: ['P'], cp: 350 } }), 5), HARD);
  assert.doesNotMatch(composeLocal(base(), praise({ does: [takes], cost: { gain: ['C'], lose: ['H'], cp: 50 } }), 5), HARD, 'the settled balance is level');
  assert.doesNotMatch(composeLocal(base(), praise({ does: [takes], cost: null }), 5), HARD, 'nothing in the packet shows the gain');
  assert.doesNotMatch(composeLocal(base(), praise({ cat: 'brilliant', sac: true, does: [{ k: 'sacrifice', by: P('me', 'H', 4) }] }), 5), HARD);
  assert.match(composeLocal(base(), praise({ cat: 'brilliant', sac: true, does: [{ k: 'sacrifice', by: P('me', 'H', 4) }, { k: 'check', by: P('me', 'R', 2) }] }), 5), HARD);
  // every notable motif: a check, a mate, a threat and a free capture press by themselves; a capture, a trade, a crossing and a
  // sacrifice do not
  const pressing = ['capture_free', 'check', 'mate', 'mate_threat', 'fork', 'discovered', 'pin', 'attack', 'cannon_mount'];
  for (const k of NOTABLE_MOTIFS) {
    const text = composeLocal(base(), praise({ does: [{ k, by: P('me', 'H', 4), on: P('opp', 'R', 3), on2: P('opp', 'C', 7) }] }), 5);
    assert.equal(HARD.test(text), pressing.includes(k), `${k}: ${text}`);
  }

  // (f) the notation and the piece that acts are not two subjects side by side: a clause that starts with its piece follows a colon
  assert.equal(composeLocal(base(), praise({ does: [takes], cost: { gain: ['C'], lose: [], cp: 450 } }), 0), '【马三进四】：你的四路马吃掉对方的4路炮。');
  assert.equal(composeLocal(base(), praise({ move: '车二进七', cat: 'brilliant', does: [{ k: 'sacrifice', by: P('me', 'R', 2) }] }), 0), '【车二进七】弃掉你的二路车换取攻势。');
  assert.equal(composeLocal(base(), praise({ move: '车二进七', does: [{ k: 'mate_threat', by: P('me', 'R', 2) }] }), 0), '【车二进七】叫杀。');
  for (const c of SWEEP) {
    for (let v = 0; v < 6; v++) assert.doesNotMatch(composeLocal(c.turn, c.events, v), /】(?:你的|对方的)/, `${c.name}: a move and a piece side by side`);
  }

  // (c) 对方多半走【X】: the pouch says 走 as every other sentence about the rival's answer does
  assert.equal(composeLocal(F.hint.turn, F.hint.events), '可以走【马二进三】：你的三路马出动。对方多半走【车9平8】。');
  for (const c of SWEEP) {
    for (let v = 0; v < 6; v++) assert.doesNotMatch(composeLocal(c.turn, c.events, v), /多半【/, c.name);
  }

  // 走得稳，没有毛病 / 稳当 / 扎实 / 没问题 are not said of a move after which the child still comes out behind in material
  const forced = [OPP_SILENT, tryEvent({ move: '马三退五', cat: 'best', does: [{ k: 'escape', by: P('me', 'H', 5) }], cost: { gain: [], lose: ['P'], cp: -100 } })];
  assert.equal(localLine(base(), forced, []).row, 'try.steady');
  assert.deepEqual(six(forced), ['【马三退五】可行。', '【马三退五】可行。', '【马三退五】，不急不躁。', '【马三退五】，不急不躁。', '【马三退五】可行。', '【马三退五】可行。']);
  const levelTrade = [OPP_SILENT, tryEvent({ move: '马三退五', cat: 'best', does: [{ k: 'escape', by: P('me', 'H', 5) }], cost: { gain: ['P'], lose: ['P'], cp: 0 } })];
  assert.equal(composeLocal(base(), levelTrade, 0), '【马三退五】走得稳，没有毛病。');

  // the rival is 对方 or 司马懿, never 它 and never 对面: no sentence starts with 它, and the read of a rival move says 它 only of
  // the piece it has just named (看看对方的6路马，它瞄着谁？)
  for (const c of SWEEP) {
    for (let v = 0; v < 6; v++) {
      const text = composeLocal(c.turn, c.events, v);
      assert.doesNotMatch(text, /^它|对面/, `${c.name}: ${text}`);
      const last = c.events[c.events.length - 1];
      if (last.kind === 'opp' && text.includes('它')) assert.match(text, /^看看对方的.+，它瞄着谁？$/, `${c.name}: ${text}`);
    }
  }
  assert.equal(composeLocal(oppTurn({ move: '马7进6', does: [] }, { threats: [PIECE_THREAT] }), OPP_LAST, 0), '对方盯上了你的五路炮。');
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'develop', by: P('opp', 'H', 7) }] }), OPP_LAST, 4), '', 'the caption says 出子 already');

  // a clause without a subject is not a sentence about the rival's move by itself (给…补上保护。 would read as an order): 这步 leads it
  const read = (effect) => composeLocal(oppTurn({ does: [effect] }), OPP_LAST, 0);
  assert.equal(read({ k: 'defend', on: P('opp', 'P', 5) }), '这步给自己的5路卒补上保护。');
  assert.equal(read({ k: 'open_rook', on: P('opp', 'R', 9) }), '这步给自己的9路车亮出了通道。');
  assert.equal(read({ k: 'restrict_king', on: P('me', 'K', 5) }), '这步封住了你的帅的一条退路。');
  assert.equal(read({ k: 'sacrifice', by: P('opp', 'R', 2) }), '', 'no piece besides the one that moved: the caption says 弃子 already');
  // a clause that starts with his piece: the sentence of the intent answer when it fits the cap, the clause by itself as variant 1
  assert.equal(read({ k: 'attack', by: P('opp', 'C', 2), on: P('me', 'P', 7) }), '对方这步的用意：2路炮捉你的七路兵。');
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'attack', by: P('opp', 'C', 2), on: P('me', 'P', 7) }] }), OPP_LAST, 1), '对方的2路炮捉你的七路兵。');
  // the same clauses where another sentence gives them their subject: the rival is that subject, so his pieces are 自己的
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'defend', on: P('opp', 'P', 5) }] }), [OPP_SILENT, ask('intent')]), '对方这步的用意：给自己的5路卒补上保护。');
  // 「我上一步怎么样？」: what the move did is a sentence of its own after the verdict, so it gets its subject in the same way
  // (…是眼下最好的一步。给你的四路马补上保护。 would read as an order to the child, …。叫杀。 is not a sentence)
  const lastOf = (does, cat = 'best') => composeLocal(turnWith({ mine: { move: '炮二平五', cat, waited: true, self: true, try: { ...clone(MINE_BEST.try), cat, does } } }), [OPP_SILENT, ask('last')]);
  assert.equal(lastOf([{ k: 'defend', on: P('me', 'H', 4) }]), '【炮二平五】是眼下最好的一步。这步给你的四路马补上保护。');
  assert.equal(lastOf([{ k: 'open_rook', on: P('me', 'R', 1) }]), '【炮二平五】是眼下最好的一步。这步给你的一路车亮出了通道。');
  assert.equal(lastOf([{ k: 'restrict_king', on: P('opp', 'K', 5) }]), '【炮二平五】是眼下最好的一步。这步封住了对方的将的一条退路。');
  assert.equal(lastOf([{ k: 'sacrifice', by: P('me', 'R', 2) }], 'brilliant'), '【炮二平五】是妙手，难得一见。这步弃掉你的二路车换取攻势。');
  assert.equal(lastOf([{ k: 'mate_threat', by: P('me', 'R', 2) }]), '【炮二平五】是眼下最好的一步。这步叫杀。');
  assert.equal(lastOf([{ k: 'quiet' }], 'good'), '【炮二平五】稳健，可以走。这步调整了一下阵形。');
  assert.equal(lastOf([{ k: 'capture' }]), '【炮二平五】是眼下最好的一步。这步吃子。', 'a clause whose pieces are not in the packet is its term');
  assert.equal(lastOf([{ k: 'develop', by: P('me', 'H', 3) }]), '【炮二平五】是眼下最好的一步。你的三路马出动。', 'a clause with its piece is left as it is');
  for (const c of SWEEP) {
    const last = c.events[c.events.length - 1];
    if (last.kind !== 'ask' || last.ask !== 'last') continue;
    // every sentence after the first starts with its subject: a piece or 这步
    const sentences = composeLocal(c.turn, c.events).split('。').filter(Boolean);
    for (const sentence of sentences.slice(1)) assert.match(sentence, /^(?:你的|对方的|这步)/, `${c.name}: ${sentence}`);
  }

  // 你大约多…, not 你多大约…: 大约 stands before 多 / 少
  const score = (cp) => composeLocal(turnWith({ mat: { me: 'R2H2C2P5A2E2', opp: 'R2H2C2P5A2E2', cp } }), [OPP_SILENT, ask('score')]);
  assert.deepEqual([0, 59, 60, -100, 200, -400, 900, -1199, 1200, -2500].map(score), ['现在均势。双方子力相当。', '现在均势。双方子力相当。', '现在均势。你大约多一个兵。',
    '现在均势。你大约少一个兵。', '现在均势。你大约多一个士或象。', '现在均势。你大约少一个马或炮。', '现在均势。你大约多一个车。', '现在均势。你大约少一个车。',
    '现在均势。你多一个车以上。', '现在均势。你少一个车以上。']);

  // a check can be blocked or its piece taken: the read of it does not tell the child to move the king away
  for (const c of [GOLDEN.find((g) => g.row === 'opp.check'), blackened(GOLDEN.find((g) => g.row === 'opp.check'))]) {
    for (let v = 0; v < 6; v++) assert.doesNotMatch(composeLocal(c.turn, c.events, v), /躲/);
  }
});

test('为什么？ after the game is over always gets a local answer (CONTRACT-NOTES item 112)', () => {
  const LAST_RESORT = '这一步的道理，下一局亮在棋盘上指给小主公看。';
  const why = (codes, patch = {}) => {
    const events = [spoken(overEvent(patch)), ...codes.map((code, k) => spoken({ i: k + 1, kind: 'ask', ask: code })), { i: codes.length + 1, kind: 'ask', ask: 'why' }];
    const valid = validateCoachRequest({ v: 1, turn: overTurn(), events });
    assert.deepEqual(valid.ok ? null : [valid.path, valid.why], null, 'the thread validates');
    const line = localLine(overTurn(), events, []);
    assert.deepEqual(line, { text: composeLocal(overTurn(), events), row: 'ask.why', v: 0 });
    assert.ok(plainLength(line.text) <= CAPS.why && line.text.match(/[。！？]/g).length <= 3, line.text);
    return line.text;
  };
  const habit = (code, ex) => ({ kind: 'habit', code, n: 1, ...(ex ? { ex } : {}) });

  // after 「我哪步下得最好？」: what the highlighted move achieved (section 9.8: 马三进四, a fork)
  assert.equal(composeLocal(overTurn(), overThread('proud')), '第18回合的【马三进四】最漂亮：捉双。');
  assert.equal(why(['proud']), '因为【马三进四】同时捉住了对方的两个子，对方只能救一个。');
  const ACHIEVED = {
    capture: '吃掉了对方的一个子', capture_free: '白吃了对方的一个子，没有被吃回', trade: '和对方兑掉了一个子', check: '将了对方一军', mate: '把对方将死了',
    mate_threat: '下一步就要将死，对方必须先解围', fork: '同时捉住了对方的两个子，对方只能救一个', discovered: '一闪开，后面的子就打到了对方的子',
    pin: '牵住了对方的子，它一动后面的子就丢', attack: '捉住了对方的一个子', defend: '给自己的子补上了保护', escape: '躲开了对方的攻击',
    block: '垫在中间，挡住了对方的攻击', block_leg: '蹩住了对方的马腿', block_eye: '塞住了对方的象眼', open_rook: '给车亮出了通道', develop: '出动了一个大子',
    cannon_mount: '架好了炮，瞄着对方的子', restrict_king: '封住了对方老将的一条退路', cross_river: '过了河，之后可以横走', sacrifice: '弃子换来了攻势',
    quiet: '把阵形调整好了',
  };
  assert.deepEqual(Object.keys(ACHIEVED), MOTIF_CODES.filter((k) => !FLAW_CODES.includes(k)), 'every effect motif has its sentence');
  for (const [k, achieved] of Object.entries(ACHIEVED)) {
    assert.equal(why(['proud'], { proud: { n: 7, s: 'me', move: '车二进七', tag: 'great', k } }), `因为【车二进七】${achieved}。`, k);
  }
  // nothing concrete about the move: the fixed sentence
  assert.equal(why(['proud'], { proud: { n: 7, s: 'me', move: '车二进七', tag: 'great' } }), LAST_RESORT, 'a highlight without a motif');
  assert.equal(why(['proud'], { proud: { n: 7, s: 'me', move: '车二进七', tag: 'great', k: 'waste' } }), LAST_RESORT, 'a flaw is nothing a move achieved');
  assert.equal(composeLocal(overTurn(), overThread('proud', { proud: null })), '这盘还没走出最漂亮的一步，下一盘咱们一起找。');
  assert.equal(why(['proud'], { proud: null }), LAST_RESORT);

  // after 「哪里还能更好？」: the habit behind the example the line quoted, and its fix
  assert.equal(composeLocal(overTurn(), overThread('improve')), '第2回合的【炮五进四】可以更好，换成【马二进三】就对了。');
  assert.equal(why(['improve']), '因为第2回合的【炮五进四】，吃子前没看对方能不能吃回。下一盘吃子之前，先看它有没有保镖。');
  for (const code of HABIT_CODES) {
    assert.equal(why(['improve'], { goal: code, takeaway: habit(code, { n: 12, move: '车一进一', better: '马二进三' }) }),
      `因为第12回合的【车一进一】，${HABIT_WORD[code]}。下一盘${HABIT_FIX[code]}。`, code);
  }
  // the line had no example to quote (这盘没什么大毛病。): nothing concrete
  assert.equal(why(['improve'], { takeaway: habit('greedy') }), LAST_RESORT);
  assert.equal(why(['improve'], { takeaway: { kind: 'strength', code: 'S_steady' }, goal: null }), LAST_RESORT);
  assert.equal(why(['improve'], { takeaway: null, goal: null }), LAST_RESORT);

  // after 「下一盘注意什么？」: the line was the fix, so the answer is the habit, with the lesson's example when there is one
  assert.equal(composeLocal(overTurn(), overThread('next')), '下一盘记住一件事——吃子之前，先看它有没有保镖。');
  assert.equal(why(['next']), '因为第2回合的【炮五进四】，吃子前没看对方能不能吃回。');
  for (const code of HABIT_CODES) {
    assert.equal(why(['next'], { goal: code, takeaway: habit(code) }), `因为这盘有一步，${HABIT_WORD[code]}。`, code);
    assert.equal(why(['next'], { goal: code, takeaway: { kind: 'strength', code: 'S_steady' } }), `因为这盘有一步，${HABIT_WORD[code]}。`, code);
  }
  // the example of another lesson is not quoted for this goal
  assert.equal(why(['next'], { goal: 'miss_threat', takeaway: habit('greedy', { n: 2, move: '炮五进四' }) }), '因为这盘有一步，没先看对方上一步的威胁。');
  assert.equal(composeLocal(overTurn(), overThread('next', { goal: null })), '下一盘照这样下就行。');
  assert.equal(why(['next'], { goal: null }), LAST_RESORT);

  // straight after the game-over line: its highlighted move (the line no longer carries the goal); without a highlighted
  // move the habit behind the goal the card shows; else the fixed sentence
  assert.equal(why([]), '因为【马三进四】同时捉住了对方的两个子，对方只能救一个。');
  assert.equal(why([], { goal: null, takeaway: { kind: 'strength', code: 'S_tactics' } }), '因为【马三进四】同时捉住了对方的两个子，对方只能救一个。');
  assert.equal(why([], { proud: null }), '因为第2回合的【炮五进四】，吃子前没看对方能不能吃回。');
  assert.equal(why([], { goal: null, takeaway: null, proud: null, rank: null }), LAST_RESORT);
  // a second 为什么？ is about the same line; after a free question nothing concrete is known
  assert.equal(why(['proud', 'why']), why(['proud']));
  assert.equal(why(['next', 'why', 'why']), why(['next']));
  assert.equal(why(['improve', 'proud']), why(['proud']));
  const afterFree = [spoken(overEvent()), spoken({ i: 1, kind: 'ask', ask: 'free' }), { i: 2, kind: 'ask', ask: 'why' }];
  assert.equal(composeLocal(overTurn(), afterFree), LAST_RESORT);

  // never empty, whatever the packet: every result, every takeaway, every question before it, both colours
  let answers = 0;
  for (const result of ['win', 'loss', 'draw']) {
    for (const takeaway of [null, { kind: 'strength', code: 'S_finish' }, { kind: 'idea', code: 'fork_two' }, habit('hang_piece'), habit('miss_mate', { n: 300, move: '前兵七进一', better: '前炮进四' })]) {
      for (const proud of [null, { n: 300, s: 'me', move: '前兵七进一', tag: 'great' }, { n: 1, s: 'me', move: '炮二平五', tag: 'great', k: 'cannon_mount' }]) {
        for (const goal of [null, 'hang_piece', 'miss_mate']) {
          for (const before of [[], ['proud'], ['improve'], ['next'], ['next', 'why'], ['free']]) {
            for (const me of ['red', 'black']) {
              const events = [spoken(overEvent({ result, takeaway, proud, goal, kept: null, rank: null })), ...before.map((code, k) => spoken({ i: k + 1, kind: 'ask', ask: code })),
                { i: before.length + 1, kind: 'ask', ask: 'why' }];
              const text = composeLocal({ ...overTurn(), me }, events);
              assert.notEqual(text, '', JSON.stringify({ result, takeaway, proud, goal, before }));
              assert.ok(plainLength(text) <= CAPS.why && balanced(text) && !text.includes('……'), text);
              assert.match(text, /^(?:因为|这一步的道理)/);
              const known = notationsOf(events);
              for (const notation of bracketsOf(text)) assert.ok(known.has(notation), `【${notation}】 is not in the packet: ${text}`);
              answers++;
            }
          }
        }
      }
    }
  }
  assert.equal(answers, 3 * 5 * 3 * 3 * 6 * 2);
  // in a turn thread 为什么？ is as before: about the trial, else the rival's intent
  assert.equal(composeLocal(clone(F.opp.turn), [spoken({ i: 0, kind: 'opp' }), ask('why')]), '对方下一步想走【炮5进4】，那样你白丢一个兵。');
});
