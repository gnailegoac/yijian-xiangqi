// tests/unit/server/prompt.test.js (S2) — the prompt renderer: contract sections 8.1–8.5 and 14.3.
// Every expected text below is the template of section 8.4 / 8.5 filled in by hand from the packet (the "golden files" are
// the template literals of this file). A local line of 诸葛亮 is never compared with a literal: it is re-created here with
// composeLocal, as the proxy does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { SYSTEM_PROMPT, TOOLS, buildMessages, renderEvent, renderToolResult, renderTurn } from '../../../server/prompt.js';
import { composeLocal } from '../../../src/coach/fallback.js';
import { sanitizeSay, validateCoachRequest } from '../../../src/coach/protocol.js';
import { ASK_CODES, ASK_LABEL, CATS, CAT_LABEL, CUE, CUE_CODES, HABIT_CODES, NOTATION_SCAN_RE } from '../../../src/core/codes.js';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------

const FIXTURE_DIR = new URL('../../fixtures/coach/', import.meta.url);
const FIXTURE_NAMES = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json')).sort();
const stored = (name) => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** The request as the handler hands it to the renderer: validated and normalised. */
function request(body) {
  const result = validateCoachRequest(body);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
const fixture = (name) => request(stored(name));

/** The legs of the two resume fixtures, written out from the example of section 9.7 (one call, nothing refused). */
const LEGS_97 = [{ text: '', calls: [{ id: 'call_7Qm2', name: 'analyze_move', arguments: '{"notation":"炮2平5","after":["马二进三"]}' }], x: [] }];

const NOTE = '〔注〕这一条军师没有出声，不必补答。';
const notations = (text) => text.match(NOTATION_SCAN_RE) ?? [];
const bracketed = (text) => (text.match(/【[^】]*】/g) ?? []).map((m) => m.slice(1, -1));

// ---------------------------------------------------------------------------------------------------------------------
// Golden texts: the turns of section 9
// ---------------------------------------------------------------------------------------------------------------------

/** 9.2: the child opens as red. */
const TURN_START = `〔军情〕
局面：第1回合，小主公执红，轮到小主公走。开局阶段。
形势：均势。子力：我方 车2 马2 炮2 兵5 仕2 相2；对方 车2 马2 炮2 卒5 士2 象2。双方子力相当。
小主公水平：2/9（多用大白话）。
对方的威胁（清单完整）：眼下没有直接威胁。`;

/** 9.3: 1. 炮二平五 炮8平5. */
const TURN_OPP = `〔军情〕
局面：第2回合，小主公执红，轮到小主公走。开局阶段。
形势：均势。子力：我方 车2 马2 炮2 兵5 仕2 相2；对方 车2 马2 炮2 卒5 士2 象2。双方子力相当。
小主公水平：3/9（多用大白话）。
小主公上一步：【炮二平五】（好棋，是自己想出来的）。
对方刚走：【炮8平5】（顺炮）。作用：对方5路炮借对方5路卒当炮架，瞄着我方五路兵。这是一步强手。
对方的威胁（清单完整）：①对方5路炮瞄着我方五路兵，着法是对方【炮5进4】，得手后我方白丢一个兵。`;

/** 9.5: 1. 炮二平五 马8进7 (the turn of ten fixtures). */
const TURN_95 = `〔军情〕
局面：第2回合，小主公执红，轮到小主公走。开局阶段。
形势：均势。子力：我方 车2 马2 炮2 兵5 仕2 相2；对方 车2 马2 炮2 卒5 士2 象2。双方子力相当。
小主公水平：3/9（多用大白话）。
小主公上一步：【炮二平五】（好棋，是自己想出来的）。
对方刚走：【马8进7】（起马局）。作用：对方7路马出动；给对方5路卒补上保护。
对方的威胁（清单完整）：眼下没有直接威胁。`;

/** 9.8: the game is over. */
const TURN_OVER = `〔军情〕
局面：第34回合，小主公执红，轮到小主公走。残局阶段。
形势：胜势。子力：我方 车1 马1 炮1 兵2 仕2 相2；对方 马1 卒1 士1 象1。我方多大约一个车。
小主公水平：3/9（多用大白话）。
本局回顾：第18回合我方【马三进四】好棋（捉双）。
本局已讲过：捉双、贪吃。
小主公上一步：【车二进七】（好棋，是自己想出来的）。
对方的威胁（清单完整）：眼下没有直接威胁。`;

// ---------------------------------------------------------------------------------------------------------------------
// Golden texts: events
// ---------------------------------------------------------------------------------------------------------------------

const EV_START = `〔事件〕新的一局开始，小主公先行。这是小主公和你下的第一盘。
〔已喊〕「出师！」
〔要求〕用一句话给小主公鼓劲并请小主公先行。不建议具体着法。20字以内。`;

const EV_OPP_93 = `〔事件〕对方落子：【炮8平5】。
〔要求〕用一句话解读对方这步棋想干什么，18字以内。不替小主公出主意。点明对方盯上了哪个子，可以用问句，不给应法。`;

/** The rival's move of 9.5 as an earlier event (no 〔要求〕). */
const EV_OPP_95 = '〔事件〕对方落子：【马8进7】。';

const EV_INTENT = '〔事件〕小主公点了问题：「对方想干什么？」';
const EV_INTENT_LAST = `${EV_INTENT}
〔要求〕小主公问对方想干什么：根据「对方刚走」和「对方的威胁」直说。最多两句，50字以内。`;

/** 9.7; the sentence is what sanitizeSay makes of the child's text (the validator applies it). */
const SAY_97 = sanitizeSay('如果我走马二进三，对方走炮2平5呢？');
const EV_FREE_LAST = `〔事件〕小主公说：「${SAY_97}」
〔要求〕回答小主公这句话，最多三句，70字以内。与这盘棋无关就用一句话带回棋局。`;

/** The tool verdict of 9.7 as the content of a tool message. */
const TOOL_OK_97 = `〔推演结果〕走法：我方【马二进三】→对方【炮2平5】。
评定：对对方来说是稳健（和最好的走法几乎一样）。走后形势：均势。
作用：对方5路炮借对方5路卒当炮架，瞄着我方五路兵。
我方最强应对：我方【车一平二】，结果：双方都没有丢子。`;
const TOOL_FAILED_97 = '〔推演失败〕这个局面里没有这步棋。可能是：【炮2平5】、【炮8平9】。';

/** An earlier free question: without the child's sentence, with its past tool exchange. */
const EV_FREE_EARLIER_TOOLS = `〔事件〕小主公问了一个问题。
〔当时的推演〕${TOOL_OK_97}`;

const EV_WHY_LAST = `〔事件〕小主公点了问题：「为什么？」
〔要求〕小主公追问为什么：把你上一句的结论换一种更具体的说法讲清楚，引用推演里的那条变化。最多三句，90字以内。`;

const EV_HINT1 = `〔事件〕小主公打开了第一个锦囊。
〔锦囊内容〕思考方向：出动还没出来的子；主题：「出子」。`;
const EV_HINT2 = `〔事件〕小主公打开了第二个锦囊。
〔锦囊内容〕该动的子：我方二路马；区域：右翼；主题：「出子」。`;
const EV_HINT3_LAST = `〔事件〕小主公打开了第三个锦囊。
〔锦囊内容〕着法：我方【马二进三】。作用：我方三路马出动；给我方一路车亮出了通道。后续：对方【车9平8】→我方【车一平二】，结果：双方都没有丢子。
〔要求〕说出这步棋，并用一句话讲清为什么。36字以内。`;

const EV_OVER = `〔事件〕棋局结束：小主公胜（将死），共走了34步。
〔本局小结〕亮点：好棋25步，抓住机会2次，吃子9个，妙手1步。
要点：下一盘的小目标：吃子之前，先看它有没有保镖，例如第2回合【炮五进四】，换成【马二进三】更好。
最得意的一步：第18回合【马三进四】（捉双）。
下一盘小目标：吃子之前，先看它有没有保镖。
兵法境界升到了「初露锋芒」。
〔已喊〕「大捷！」
〔要求〕先用半句回应胜负（赢了一起高兴，输了先安慰），再讲「要点」里的那一条，引用本局那一步，这一句不超过30字；有「下一盘小目标」就用它收尾。一共80字以内。`;

const EV_RECAP = `〔前情〕本回合小主公已试走：【炮五进四】（失误）、【兵三进一】（缓着）、【马二进三】（好棋）；锦囊已开到第1个。
〔推演〕评定：好棋（和最好的走法几乎一样）。
走后形势：均势。
作用：我方三路马出动。`;
const EV_GOOD = '〔事件〕小主公点了问题：「这步好不好？」';
const EV_REPLY_NO_BETTER = `〔事件〕小主公点了问题：「对方会怎么应？」
〔补充推演〕更好的走法：没有找到比试走的这步更好的。`;
const EV_SCORE = '〔事件〕小主公点了问题：「现在谁占上风？」';
const EV_DANGER = '〔事件〕小主公点了问题：「我有危险吗？」';
const EV_LAST = '〔事件〕小主公点了问题：「我上一步怎么样？」';
const EV_BETTER_LAST = `〔事件〕小主公点了问题：「有更好的吗？」
〔要求〕小主公问有没有更好的：有就说出来，并用一句话讲清好在哪；没有就肯定小主公的选择。最多两句，50字以内。`;

/** The held trial of 9.5 without its 〔要求〕 (as an earlier event). */
const EV_TRY_HELD = `〔事件〕小主公试走（本回合第1次）：【炮五进四】。
〔推演〕评定：失误（比最好的走法亏了大约一个马或炮）。危险着：是。这步是小主公自己想出来的。
走后形势：落了下风。
作用：我方五路炮吃掉对方5路卒。
毛病：对方5路卒有对方7路马保护，我方五路炮吃了它会被吃回。
代价：我方吃到一个卒，丢掉一个炮，算下来亏了。
更好的方向：在右翼，和「出子」有关。具体着法暂不提供。
这是一种以前踩过的坑：吃子前没看对方能不能吃回。
〔已喊〕「且慢……」`;
const EV_TRY_HELD_LAST = `${EV_TRY_HELD}
〔要求〕这是危险着。只提一个指向明确的问题，引导小主公自己发现毛病；不说对方的反击着法，不说更好的走法。20字以内。`;

const EV_REPLY_MORE_LAST = `〔事件〕小主公点了问题：「对方会怎么应？」
〔补充推演〕对方最强应对：对方【马7进5】→我方【马八进七】→对方【马2进3】，结果：我方吃到一个卒，丢掉一个炮，算下来亏了。
更好的走法：我方【马二进三】（比试走的这步好大约一个马或炮）：我方三路马出动；给我方一路车亮出了通道。后续：对方【车9平8】→我方【车一平二】，结果：双方都没有丢子。
〔要求〕小主公问对方会怎么应：说出对方最强的应对和随后的结果。最多两句，50字以内。`;

const EV_TRY_BEST_LAST = `〔事件〕小主公试走（本回合第1次）：【马二进三】。
〔推演〕评定：好棋（和最好的走法几乎一样）。这步是小主公自己想出来的。
走后形势：均势。
作用：我方三路马出动；给我方一路车亮出了通道。
对方最强应对：对方【车9平8】→我方【车一平二】，结果：双方都没有丢子。
〔要求〕点评这步试走：前六个字先说好不好，再用一个事实说清好在哪。24字以内。`;

/** Per fixture: the turn text and the text of every event, in order. */
const GOLDEN = {
  'ask-chip.json': { turn: TURN_95, events: [EV_OPP_95, EV_INTENT_LAST] },
  'ask-free-resume-failed.json': { turn: TURN_95, events: [EV_OPP_95, EV_INTENT, EV_FREE_LAST], tool: TOOL_FAILED_97 },
  'ask-free-resume.json': { turn: TURN_95, events: [EV_OPP_95, EV_INTENT, EV_FREE_LAST], tool: TOOL_OK_97 },
  'ask-free.json': { turn: TURN_95, events: [EV_OPP_95, EV_INTENT, EV_FREE_LAST] },
  'ask-tools.json': { turn: TURN_95, events: [EV_OPP_95, EV_INTENT, EV_FREE_EARLIER_TOOLS, EV_WHY_LAST] },
  'hint.json': { turn: TURN_95, events: [EV_OPP_95, EV_HINT1, EV_HINT2, EV_HINT3_LAST] },
  'opp.json': { turn: TURN_OPP, events: [EV_OPP_93] },
  'over.json': { turn: TURN_OVER, events: [EV_OVER] },
  'recap.json': { turn: TURN_95, events: [EV_RECAP, EV_GOOD, EV_REPLY_NO_BETTER, EV_SCORE, EV_DANGER, EV_LAST, EV_BETTER_LAST] },
  'start.json': { turn: TURN_START, events: [EV_START] },
  'try-held-ask.json': { turn: TURN_95, events: [EV_OPP_95, EV_TRY_HELD, EV_REPLY_MORE_LAST] },
  'try-held.json': { turn: TURN_95, events: [EV_OPP_95, EV_TRY_HELD_LAST] },
  'try.json': { turn: TURN_95, events: [EV_OPP_95, EV_TRY_BEST_LAST] },
};

/**
 * The message list section 8.4 prescribes for a request, built here from the golden event texts and from what each
 * earlier event says about its answer: the signed reply, the local line (composeLocal on the events as received), or
 * nothing — then the 〔注〕 line (not after a recap) and the next event in the same user message.
 */
function expectedMessages(req, turnText, eventTexts, legMessages = []) {
  const out = [{ role: 'system', content: SYSTEM_PROMPT }];
  let pending = turnText;
  req.events.forEach((ev, k) => {
    pending += (pending ? '\n\n' : '') + eventTexts[k];
    if (k === req.events.length - 1) return;
    const answer = ev.said === 'llm' ? ev.reply.text : ev.said === 'local' ? composeLocal(req.turn, req.events.slice(0, k + 1), ev.v) : '';
    if (answer) {
      out.push({ role: 'user', content: pending }, { role: 'assistant', content: answer });
      pending = '';
    } else if (ev.kind !== 'recap') {
      pending += '\n' + NOTE;
    }
  });
  out.push({ role: 'user', content: pending });
  return [...out, ...legMessages];
}

// ---------------------------------------------------------------------------------------------------------------------
// The tests of section 14.3
// ---------------------------------------------------------------------------------------------------------------------

test('golden files for renderTurn / renderEvent / renderToolResult on every fixture', () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), FIXTURE_NAMES, 'every fixture of tests/fixtures/coach has a golden text');
  for (const name of FIXTURE_NAMES) {
    const req = fixture(name);
    const golden = GOLDEN[name];
    assert.equal(renderTurn(req.turn), golden.turn, `${name}: turn`);
    assert.equal(req.events.length, golden.events.length, `${name}: number of events`);
    req.events.forEach((ev, k) => assert.equal(renderEvent(ev, req.turn), golden.events[k], `${name}: events[${k}]`));

    let legMessages = [];
    if (req.resume) {
      assert.equal(renderToolResult(req.resume.results[0], req.turn.me), golden.tool, `${name}: tool result`);
      legMessages = [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_7Qm2', type: 'function',
          function: { name: 'analyze_move', arguments: '{"notation":"炮2平5","after":["马二进三"]}' } }] },
        { role: 'tool', tool_call_id: 'call_7Qm2', content: golden.tool },
      ];
    }
    assert.deepEqual(buildMessages(req, req.resume ? LEGS_97 : []), expectedMessages(req, golden.turn, golden.events, legMessages),
      `${name}: messages`);
  }
  // the past tool exchange of ask-tools.json is the verdict of 9.7
  assert.equal(renderToolResult(fixture('ask-tools.json').events[2].tools[0].result, 'red'), TOOL_OK_97);
});

test('buildMessages is byte-identical for identical input', () => {
  for (const name of FIXTURE_NAMES) {
    const legs = stored(name).resume ? LEGS_97 : [];
    const first = JSON.stringify(buildMessages(fixture(name), clone(legs)));
    const again = JSON.stringify(buildMessages(fixture(name), clone(legs)));
    assert.equal(again, first, name);
    // the same request with its keys in another order (as another client might serialise it) renders the same bytes
    const reversed = (x) => (Array.isArray(x) ? x.map(reversed)
      : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reversed(v)])) : x);
    assert.equal(JSON.stringify(buildMessages(request(reversed(stored(name))), legs)), first, `${name}, keys reversed`);
    // the input is not changed by rendering
    const req = fixture(name);
    const before = JSON.stringify(req);
    buildMessages(req, legs);
    assert.equal(JSON.stringify(req), before, `${name}: input untouched`);
  }
  // the prefix is stable: system prompt first, then the turn; a later request of the same thread repeats the earlier messages
  const two = buildMessages(fixture('ask-chip.json'), []);
  const three = buildMessages(fixture('ask-free.json'), []);
  assert.equal(two[0].content, SYSTEM_PROMPT);
  assert.deepEqual(three.slice(0, 2), two.slice(0, 2), 'system, first user message and its answer are the same bytes');
  assert.ok(two[1].content.startsWith('〔军情〕\n'));
  assert.ok(!/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/.test(JSON.stringify(three)), 'no timestamp');
});

test('a locally answered event is re-created as the assistant turn with composeLocal(turn, events, v)', () => {
  // 9.5: the held trial was answered locally with variant 3; the model sees that sentence as what 诸葛亮 said
  const req = fixture('try-held-ask.json');
  const messages = buildMessages(req, []);
  const local = composeLocal(req.turn, req.events.slice(0, 2), 3);
  assert.ok(local.length > 0, 'the local narrator has a guiding question for the held trial');
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(messages[2].content, req.events[0].reply.text, 'a model answer is replayed from its signed text');
  assert.equal(messages[4].content, local);
  assert.ok(!messages[3].content.includes('〔要求〕'), 'an earlier event carries no directive');
  assert.ok(messages[5].content.endsWith('最多两句，50字以内。'));

  // the variant matters: another v gives the line of that variant
  for (const v of [0, 1, 2, 4, 5]) {
    const other = clone(stored('try-held-ask.json'));
    other.events[1].v = v;
    const r = request(other);
    assert.equal(buildMessages(r, [])[4].content, composeLocal(r.turn, r.events.slice(0, 2), v), `variant ${v}`);
  }

  // the events are passed as received, cue included, and only up to the event that was answered
  const hint = fixture('hint.json');
  const hm = buildMessages(hint, []);
  assert.equal(hm[4].content, composeLocal(hint.turn, hint.events.slice(0, 2), 0));
  assert.equal(hm[6].content, composeLocal(hint.turn, hint.events.slice(0, 3), 0));

  // every fixture: each earlier event has exactly the answer its `said` field names
  for (const name of FIXTURE_NAMES) {
    const r = fixture(name);
    const assistant = buildMessages(r, []).filter((m) => m.role === 'assistant').map((m) => m.content);
    const expected = [];
    r.events.slice(0, -1).forEach((ev, k) => {
      const text = ev.said === 'llm' ? ev.reply.text : ev.said === 'local' ? composeLocal(r.turn, r.events.slice(0, k + 1), ev.v) : '';
      if (text) expected.push(text);
    });
    assert.deepEqual(assistant, expected, name);
  }
});

test('a silent event adds the 〔注〕 line and merges into one user message', () => {
  // try.json: the rival's move got no spoken sentence, then the child tried a move
  const req = fixture('try.json');
  const messages = buildMessages(req, []);
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user']);
  assert.equal(messages[1].content, `${TURN_95}\n\n${EV_OPP_95}\n${NOTE}\n\n${EV_TRY_BEST_LAST}`);

  // two silent events in a row, then an answered one, then the event to answer
  const body = clone(stored('hint.json'));
  body.events[0] = { i: 0, kind: 'opp', said: 'none' };
  body.events[1].said = 'none';
  delete body.events[1].v;
  const r = request(body);
  const m = buildMessages(r, []);
  assert.deepEqual(m.map((x) => x.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(m[1].content, `${TURN_95}\n\n${EV_OPP_95}\n${NOTE}\n\n${EV_HINT1}\n${NOTE}\n\n${EV_HINT2}`);
  assert.equal(m[2].content, composeLocal(r.turn, r.events.slice(0, 3), 0));
  assert.equal(m[3].content, EV_HINT3_LAST);

  // a local answer that can no longer be re-created ('' from the narrator) reads as a silent event
  const lost = clone(stored('recap.json'));
  delete lost.events[0].recap.cur;                             // after compaction the packet of the trial is gone
  lost.events = [lost.events[0], { i: 5, kind: 'ask', ask: 'reply', said: 'local', v: 0 }, { i: 6, kind: 'ask', ask: 'score' }];
  const lr = request(lost);
  const recreated = composeLocal(lr.turn, lr.events.slice(0, 2), 0);
  const lm = buildMessages(lr, []);
  const recapText = '〔前情〕本回合小主公已试走：【炮五进四】（失误）、【兵三进一】（缓着）、【马二进三】（好棋）；锦囊已开到第1个。';
  const askReply = '〔事件〕小主公点了问题：「对方会怎么应？」';
  const askScore = '〔事件〕小主公点了问题：「现在谁占上风？」\n〔要求〕小主公问现在谁占上风：按「形势」和子力对比回答，并给一个原因。最多两句，50字以内。';
  if (recreated === '') {
    assert.deepEqual(lm.map((x) => x.role), ['system', 'user']);
    assert.equal(lm[1].content, `${TURN_95}\n\n${recapText}\n\n${askReply}\n${NOTE}\n\n${askScore}`);
  } else {
    assert.deepEqual(lm.map((x) => x.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(lm[2].content, recreated);
  }

  // a recap is a summary, never an event that awaited an answer: no 〔注〕 line after it
  const rm = buildMessages(fixture('recap.json'), []);
  assert.equal(rm[1].content, `${TURN_95}\n\n${EV_RECAP}\n\n${EV_GOOD}`);
  for (const name of FIXTURE_NAMES) {
    const text = buildMessages(fixture(name), []).map((x) => x.content ?? '').join('\n');
    const silent = fixture(name).events.slice(0, -1).filter((ev, k, list) => ev.kind !== 'recap'
      && (ev.said === 'none' || (ev.said === 'local' && composeLocal(fixture(name).turn, list.slice(0, k + 1), ev.v) === ''))).length;
    assert.equal(text.split(NOTE).length - 1, silent, `${name}: one 〔注〕 line per silent event`);
  }
});

test('negative sentences appear only with their known flag', () => {
  const base = stored('start.json').turn;
  const NO_THREAT = '对方的威胁（清单完整）：眼下没有直接威胁。';
  const NO_CHANCE = '机会：没有现成的便宜可占。';
  const lines = (turn) => renderTurn(request({ v: 1, turn, events: [{ i: 0, kind: 'start' }] }).turn).split('\n');

  let t = { ...base, known: { threats: true, chance: true } };
  assert.ok(lines(t).includes(NO_THREAT));
  assert.ok(lines(t).includes(NO_CHANCE));
  t = { ...base, known: { threats: true, chance: false } };
  assert.ok(lines(t).includes(NO_THREAT));
  assert.ok(!lines(t).some((l) => l.startsWith('机会')), 'nothing about chances when it is not known that there is none');
  t = { ...base, known: { threats: false, chance: true } };
  assert.ok(!lines(t).some((l) => l.startsWith('对方的威胁')), 'nothing about threats when the list is not known to be complete');
  assert.ok(lines(t).includes(NO_CHANCE));
  t = { ...base, known: { threats: false, chance: false } };
  assert.ok(!lines(t).some((l) => l.startsWith('对方的威胁') || l.startsWith('机会')));
  assert.ok(!renderTurn(request({ v: 1, turn: t, events: [{ i: 0, kind: 'start' }] }).turn).includes('没有'));

  // with a threat in the list: 清单完整 is written only when it is known to be complete
  const threat = stored('opp.json').turn.threats[0];
  const item = '①对方5路炮瞄着我方五路兵，着法是对方【炮5进4】，得手后我方白丢一个兵。';
  t = { ...base, threats: [threat], known: { threats: true, chance: false } };
  assert.ok(lines(t).includes(`对方的威胁（清单完整）：${item}`));
  t = { ...base, threats: [threat], known: { threats: false, chance: false } };
  assert.ok(lines(t).includes(`对方的威胁：${item}`));
  assert.ok(!lines(t).join('\n').includes('清单完整'));

  // a chance is announced without a move, and then no negative sentence about chances
  t = { ...base, chance: { size: 'piece', theme: 'fork', area: 'their_palace' }, known: { threats: true, chance: true } };
  assert.ok(lines(t).includes('机会：对方阵中有破绽，在对方九宫，和「捉双」有关，分量约一个马或炮。具体着法没有提供。'));
  assert.ok(!lines(t).includes(NO_CHANCE));
});

test("a held try's rendered text contains no notation other than the tried move", () => {
  const req = fixture('try-held.json');
  const text = renderEvent(req.events[1], req.turn);
  assert.deepEqual(bracketed(text), ['炮五进四']);
  assert.deepEqual(notations(text), ['炮五进四']);
  assert.ok(text.includes('危险着：是。'));
  assert.ok(!text.includes('对方最强应对'), 'the rival reply is withheld');
  assert.ok(!text.includes('更好的走法：'), 'no better move in a first try packet');

  // every optional field of a held packet set: still nothing but the tried move
  const body = clone(stored('try-held.json'));
  Object.assign(body.events[1].try, { cat: 'blunder', only: false, repeat: true, vsPrev: 'worse', avoided: 'hang_piece',
    eval: { b: 'lost', mate: -2 }, chance: 'missed',
    flaws: [{ k: 'allow_mate' }, { k: 'hang', by: { s: 'opp', t: 'R', f: 2 }, on: { s: 'me', t: 'C', f: 5 } }] });
  body.events[1].n = 3;
  const r = request(body);
  const full = renderEvent(r.events[1], r.turn);
  assert.deepEqual(bracketed(full), ['炮五进四']);
  assert.deepEqual(notations(full), ['炮五进四']);
  assert.ok(full.startsWith('〔事件〕小主公试走（本回合第3次，上一步试走已收回）：【炮五进四】。\n'));

  // the whole request as it would go to the model: the only other notations are the two moves already played
  const all = buildMessages(req, []).slice(1).map((m) => m.content).join('\n');
  assert.deepEqual([...new Set(bracketed(all))].sort(), ['炮二平五', '炮五进四', '马8进7'].sort());
});

test('pouch 1 and 2 blocks contain no 【', () => {
  const req = fixture('hint.json');
  for (const k of [1, 2]) {
    const text = renderEvent(req.events[k], req.turn);
    assert.ok(!text.includes('【') && !text.includes('】'), text);
    assert.deepEqual(notations(text), []);
  }
  // as the event to answer, with every focus and several pieces
  const focusWord = { danger: '先看对方的威胁', chance: '找对方的破绽', develop: '出动还没出来的子', improve: '把位置别扭的子调好', finish: '把优势变成杀棋' };
  for (const [focus, word] of Object.entries(focusWord)) {
    const body = clone(stored('hint.json'));
    body.events = [body.events[0], { i: 1, kind: 'hint', level: 1, hint: { focus, theme: 'fork' } }];
    const r = request(body);
    const text = renderEvent(r.events[1], r.turn);
    assert.equal(text, `〔事件〕小主公打开了第一个锦囊。\n〔锦囊内容〕思考方向：${word}；主题：「捉双」。\n`
      + '〔要求〕只提一个帮小主公找方向的问题。不点名棋子和位置，不说着法。20字以内。');
    assert.ok(!text.includes('【'));
  }
  const pieces = [
    [{ s: 'me', t: 'R', f: 1 }, 'their_back', '我方一路车', '对方底线'],
    [{ s: 'me', t: 'P', f: 5, q: 'front' }, 'river', '我方五路前兵', '河口'],
    [{ s: 'me', t: 'K', f: 5 }, 'my_palace', '我方帅', '己方九宫'],
  ];
  for (const [piece, area, pieceWord, areaWord] of pieces) {
    const body = clone(stored('hint.json'));
    body.events = [body.events[0], body.events[1], { i: 2, kind: 'hint', level: 2, hint: { piece, area, theme: 'escape' } }];
    const r = request(body);
    const text = renderEvent(r.events[2], r.turn);
    assert.equal(text, `〔事件〕小主公打开了第二个锦囊。\n〔锦囊内容〕该动的子：${pieceWord}；区域：${areaWord}；主题：「躲开」。\n`
      + '〔要求〕点出该动哪个子、看哪一块。不说具体着法。20字以内。');
    assert.ok(!text.includes('【'));
  }
});

test('the over block contains no count of slips, blunders, misses or pouches', () => {
  // the takeaway counts its habit seven times (n: 7); nothing else in the packet has a 7
  const body = clone(stored('over.json'));
  body.events[0].over.takeaway.n = 7;
  body.events[0].over.kept = true;
  const req = request(body);
  const text = renderEvent(req.events[0], req.turn);
  assert.ok(!text.includes('7'), 'the number of slips behind the takeaway is not printed');
  const block = text.split('\n').filter((line) => !line.startsWith('〔要求〕')).join('\n');
  for (const word of ['失误', '漏着', '缓着', '错过', '锦囊', '悔棋']) assert.ok(!block.includes(word), word);
  // the numbers that are printed are the good things, the length of the game and the two move numbers
  assert.deepEqual(block.match(/\d+/g), ['34', '25', '2', '9', '1', '2', '18']);
  assert.ok(block.includes('上盘约定的小目标：做到了，要夸这一点。'));

  // a lost game with nothing to show: no line of zeros, no takeaway, no proud move, no goal, no rank
  const bare = clone(stored('over.json'));
  bare.events[0].cue = 'lose';
  bare.events[0].over = { result: 'loss', reason: 'resign', moves: 12, stats: { good: 0, taken: 0, captures: 0, brilliant: 0 },
    takeaway: null, proud: null, goal: null, kept: false, rank: null };
  const r2 = request(bare);
  assert.equal(renderEvent(r2.events[0], r2.turn), '〔事件〕棋局结束：小主公负（认输），共走了12步。\n〔已喊〕「惜哉……」\n'
    + '〔要求〕先用半句回应胜负（赢了一起高兴，输了先安慰），再讲「要点」里的那一条，引用本局那一步，这一句不超过30字；有「下一盘小目标」就用它收尾。一共80字以内。');

  // a draw; a strength and an idea as the takeaway; only some of the good things
  const draw = clone(stored('over.json'));
  delete draw.events[0].cue;
  draw.events[0].over = { result: 'draw', reason: 'repetition', moves: 40, stats: { good: 12, taken: 0, captures: 3, brilliant: 0 },
    takeaway: { kind: 'strength', code: 'S_defense' }, proud: { n: 9, s: 'me', move: '车一平二', tag: 'great' }, goal: null, kept: null, rank: null };
  const r3 = request(draw);
  assert.equal(renderEvent(r3.events[0], r3.turn).split('\n').slice(0, 4).join('\n'), '〔事件〕棋局结束：小主公和（三次重复局面），共走了40步。\n'
    + '〔本局小结〕亮点：好棋12步，吃子3个。\n要点：长处：防守很稳。\n最得意的一步：第9回合【车一平二】。');
  draw.events[0].over.takeaway = { kind: 'idea', code: 'horse_cannon', ex: { n: 21, move: '炮五平四' } };
  const r4 = request(draw);
  assert.ok(renderEvent(r4.events[0], r4.turn).includes('\n要点：可以学的一招：马后炮，例如第21回合【炮五平四】。\n'));
});

test('SYSTEM_PROMPT contains 小主公 and 诸葛亮 and none of: 主帅 阿弈 阿策 claude anthropic', () => {
  assert.ok(SYSTEM_PROMPT.includes('小主公'));
  assert.ok(SYSTEM_PROMPT.includes('诸葛亮'));
  for (const banned of ['主帅', '阿弈', '阿策', 'claude', 'anthropic']) {
    assert.ok(!SYSTEM_PROMPT.toLowerCase().includes(banned), banned);
  }
  // shipped as the contract writes it (section 8.1): the hash and the length of that text block
  assert.equal(Array.from(SYSTEM_PROMPT).length, 2452);
  assert.equal(createHash('sha256').update(SYSTEM_PROMPT, 'utf8').digest('hex'), 'c871bdc586c36ec6733a86ad36c801a414648f30cdc53c6d638e1c3b120f6a27');
  assert.ok(SYSTEM_PROMPT.startsWith('你是诸葛亮，字孔明，'));
  assert.ok(SYSTEM_PROMPT.endsWith('直接依据它作答，不必自己反复推敲。'));
  assert.equal(SYSTEM_PROMPT.split('◆').length - 1, 9, 'nine sections, marked with ◆');
  assert.ok(!SYSTEM_PROMPT.includes('\r'));
  // it is a constant: the first message of every request, whatever the request
  for (const name of FIXTURE_NAMES) {
    const first = buildMessages(fixture(name), [])[0];
    assert.deepEqual(first, { role: 'system', content: SYSTEM_PROMPT }, name);
  }
});

test('TOOLS is one strict function with additionalProperties false and every property required', () => {
  assert.equal(TOOLS.length, 1);
  const [tool] = TOOLS;
  assert.equal(tool.type, 'function');
  assert.equal(tool.function.name, 'analyze_move');
  assert.equal(tool.function.strict, true);
  const { parameters } = tool.function;
  assert.equal(parameters.type, 'object');
  assert.equal(parameters.additionalProperties, false);
  assert.deepEqual([...parameters.required].sort(), Object.keys(parameters.properties).sort());
  assert.deepEqual(Object.keys(parameters.properties), ['notation', 'after']);
  assert.equal(parameters.properties.notation.type, 'string');
  assert.deepEqual({ type: parameters.properties.after.type, items: parameters.properties.after.items }, { type: 'array', items: { type: 'string' } });
  // byte-stable, as the contract writes it (section 8.2)
  assert.equal(createHash('sha256').update(JSON.stringify(TOOLS), 'utf8').digest('hex'), 'efc9d279197da011e65563a51ad6eda2835a9edb5b4f4e2022edfa6549ee7232');
});

// ---------------------------------------------------------------------------------------------------------------------
// Every row of the tables of 8.4 and 8.5 that the fixtures do not reach
// ---------------------------------------------------------------------------------------------------------------------

test('renderTurn: every row of the table of 8.4', () => {
  const turn = {
    ply: 41, me: 'black', phase: 'middle', check: true, n: 3, back: 'undo', eval: { b: 'lost', mate: -2 },
    mat: { me: 'R1C1P3A2E1', opp: 'R2H1C1P4A2E2', cp: -650 }, level: 7,
    moments: [
      { n: 5, s: 'me', move: '马8进7', tag: 'great', k: 'develop' },
      { n: 12, s: 'opp', move: '车二进六', tag: 'punished' },
      { n: 15, s: 'me', move: '炮2平5', tag: 'slip', k: 'hang' },
      { n: 19, s: 'me', move: '车1平2', tag: 'missed' },
    ],
    taught: ['fork', 'horse_cannon', 'pin'],
    mine: { move: '车9进1', cat: 'mistake', waited: false, self: false,
      try: { move: '车9进1', cat: 'mistake', loss: 420, held: false, eval: { b: 'worse' },
        does: [{ k: 'develop', by: { s: 'me', t: 'R', f: 9 } }],
        flaws: [{ k: 'ignore_threat', by: { s: 'opp', t: 'R', f: 4 }, on: { s: 'me', t: 'H', f: 3 } }],
        cost: { gain: [], lose: ['H'], cp: -400 },
        reply: { first: 'opp', moves: ['车四进三'], net: { gain: [], lose: ['H'], cp: -400 }, end: 'check' },
        toward: { theme: 'escape' }, chance: 'missed' } },
    opp: { move: '车四进三', check: true, captured: 'H', does: [{ k: 'capture_free', by: { s: 'opp', t: 'R', f: 4 }, on: { s: 'me', t: 'H', f: 3 } },
      { k: 'check', by: { s: 'opp', t: 'R', f: 4 } }], name: 'iron_bolt', quality: 'slip', punishes: true,
      overlooked: { on: { s: 'me', t: 'C', f: 5, q: 'back' }, move: '炮五进四' } },
    threats: [
      { k: 'mate_threat', by: { s: 'opp', t: 'R', f: 4 }, move: '车四平五', net: { gain: [], lose: [], cp: -9999 }, sev: 'mate' },
      { k: 'attack', by: { s: 'opp', t: 'C', f: 8 }, on: { s: 'me', t: 'R', f: 1 }, move: '炮八进七', net: { gain: ['C'], lose: ['R'], cp: -450 }, sev: 'piece' },
    ],
    chance: { size: 'rook', theme: 'discovered', area: 'left' }, known: { threats: false, chance: true },
  };
  const req = request({ v: 1, turn, events: [{ i: 0, kind: 'opp' }] });
  assert.equal(renderTurn(req.turn), `〔军情〕
局面：第21回合，小主公执黑，轮到小主公走。中局阶段。小主公正被将军，必须应将，共有3种应法。
形势：2步之内有被将死的危险。子力：我方 车1 炮1 卒3 士2 象1；对方 车2 马1 炮1 兵4 仕2 相2。我方少大约一个车。
小主公水平：7/9（可以直接用术语）。
本局回顾：第5回合我方【马8进7】好棋（出子）；第12回合对方【车二进六】被对方抓住了疏漏；第15回合我方【炮2平5】失误（送子）；第19回合我方【车1平2】错过机会。
本局已讲过：捉双、马后炮、牵制。
小主公上一步：【车9进1】（失误，没等点评就落子了）。
〔上一步的推演〕评定：失误（比最好的走法亏了大约一个马或炮）。
走后形势：落了下风。
作用：我方9路车出动。
毛病：没有理会对方四路车对我方3路马的威胁。
代价：我方白丢一个马。
对方最强应对：对方【车四进三】，结果：我方白丢一个马，并将军。
更好的方向：和「躲开」有关。具体着法暂不提供。
这步没有去抓对方的破绽。
对方刚走：【车四进三】（铁门栓）。作用：对方四路车白吃我方3路马，吃完不会被吃回；对方四路车将军。吃掉了我方的马。这步是将军。这步是在利用小主公上一步的疏漏。对方刚才本可以走【炮五进四】吃掉我方5路后炮，但没有走。这步有漏洞。
对方的威胁：①对方四路车下一步就要将死，必须先解围，着法是对方【车四平五】；②对方八路炮捉我方1路车，着法是对方【炮八进七】，得手后我方吃到一个炮，丢掉一个车，算下来亏了。
机会：对方阵中有破绽，在左翼，和「闪击」有关，分量约一个车。具体着法没有提供。
小主公刚悔棋，回到了这个局面。`);

  // the other level notes, the other eval forms, the reload line, a side with nothing but its king
  const plain = { ...stored('start.json').turn, level: 5, eval: { b: 'better', mate: 3 }, back: 'reload', mat: { me: 'R1', opp: '', cp: 900 } };
  const lines = renderTurn(request({ v: 1, turn: plain, events: [{ i: 0, kind: 'start' }] }).turn).split('\n');
  assert.equal(lines[2], '形势：3步之内可以将死对方。子力：我方 车1；对方 无。我方多大约一个车。');
  assert.equal(lines[3], '小主公水平：5/9（可以用常见术语，顺口解释）。');
  assert.equal(lines.at(-1), '小主公刚回到这盘棋。');
  for (const [level, note] of [[1, '多用大白话'], [3, '多用大白话'], [4, '可以用常见术语，顺口解释'], [6, '可以用常见术语，顺口解释'],
    [7, '可以直接用术语'], [9, '可以直接用术语']]) {
    const t = { ...stored('start.json').turn, level };
    assert.ok(renderTurn(t).includes(`\n小主公水平：${level}/9（${note}）。\n`), `level ${level}`);
  }
});

test('the 〔推演〕 block: every optional line, and the directive of every case', () => {
  const base = clone(stored('try.json'));
  const withTry = (patch, n = 1) => {
    const body = clone(base);
    body.events[1].n = n;
    Object.assign(body.events[1].try, patch);
    const r = request(body);
    return renderEvent(r.events[1], r.turn);
  };
  const directive = (text) => text.split('\n').at(-1);

  const full = withTry({ cat: 'brilliant', loss: 45, only: true, sac: true, self: true, repeat: true, vsPrev: 'better', avoided: 'greedy',
    eval: { b: 'won', mate: 2 }, chance: 'taken', toward: null,
    does: [{ k: 'sacrifice', by: { s: 'me', t: 'H', f: 3 } }, { k: 'mate_threat', by: { s: 'me', t: 'H', f: 3 } }],
    cost: { gain: ['R'], lose: ['H'], cp: 500 },
    reply: { first: 'opp', moves: ['士5进6', '车一进九'], net: { gain: ['R'], lose: ['H'], cp: 500 }, end: 'mate' } }, 2);
  assert.equal(full, `〔事件〕小主公试走（本回合第2次，上一步试走已收回）：【马二进三】。
〔推演〕评定：妙手（只差一点点）。这是唯一不吃亏的走法。这是一步算得清的弃子。这步是小主公自己想出来的。
走后形势：2步之内可以将死对方。
作用：弃掉我方三路马换取攻势；我方三路马下一步就要将死，必须先解围。
代价：我方吃到一个车，丢掉一个马，算下来赚了。
对方最强应对：对方【士5进6】→我方【车一进九】，结果：我方吃到一个车，丢掉一个马，算下来赚了，最后将死。
小主公抓住了对方的破绽。
这回躲开了以前的坑：吃子前没看对方能不能吃回。
这步会让同一个局面第二次出现；第三次就算和棋。
和上一次试走相比：更好。
〔要求〕点评这步试走：前六个字先说好不好，再用一个事实说清好在哪。24字以内。`);

  const FINE = '〔要求〕点评这步试走：前六个字先说好不好，再用一个事实说清好在哪。24字以内。';
  const OK = '〔要求〕点评这步试走：说清它做到了什么；有「更好的方向」就提半句那一带还有更积极的走法，不说着法。24字以内。';
  const BAD = '〔要求〕点评这步试走：说清差在哪一点，不说着法。24字以内。';
  const HELD = '〔要求〕这是危险着。只提一个指向明确的问题，引导小主公自己发现毛病；不说对方的反击着法，不说更好的走法。20字以内。';
  assert.equal(directive(withTry({ cat: 'brilliant' })), FINE);
  assert.equal(directive(withTry({ cat: 'best' })), FINE);
  assert.equal(directive(withTry({ cat: 'good' })), FINE);
  assert.equal(directive(withTry({ cat: 'ok' })), OK);
  assert.equal(directive(withTry({ cat: 'mistake' })), BAD);
  assert.equal(directive(withTry({ cat: 'blunder' })), BAD);
  assert.equal(directive(withTry({ cat: 'mistake', held: true, reply: null })), HELD);
  assert.equal(directive(withTry({ cat: 'blunder', held: true, reply: null })), HELD);

  // the labels of every verdict, the loss words, the other comparison words, the two forms of a partial pointer
  for (const cat of CATS) assert.ok(withTry({ cat }).includes(`\n〔推演〕评定：${CAT_LABEL[cat]}（`), cat);
  assert.ok(withTry({ loss: 0 }).includes('（和最好的走法几乎一样）'));
  assert.ok(withTry({ loss: 59 }).includes('（只差一点点）'));
  assert.ok(withTry({ loss: 60 }).includes('（比最好的走法亏了大约一个兵）'));
  assert.ok(withTry({ loss: 950 }).includes('（比最好的走法亏了大约一个车）'));
  assert.ok(withTry({ vsPrev: 'same' }).includes('\n和上一次试走相比：差不多。\n'));
  assert.ok(withTry({ vsPrev: 'worse' }).includes('\n和上一次试走相比：更差。\n'));
  assert.ok(withTry({ cat: 'ok', toward: { area: 'center' } }).includes('\n更好的方向：在中路。具体着法暂不提供。\n'));
  assert.ok(withTry({ cat: 'ok', toward: { area: 'left', theme: 'attack' } }).includes('\n更好的方向：在左翼，和「捉子」有关。具体着法暂不提供。\n'));
  assert.ok(!withTry({ cat: 'ok', toward: {} }).includes('\n更好的方向：'));
  assert.ok(withTry({ chance: 'missed' }).includes('\n这步没有去抓对方的破绽。\n'));
  for (const habit of HABIT_CODES) assert.ok(withTry({ cat: 'mistake', habit }).includes('\n这是一种以前踩过的坑：'), habit);

  // nothing but the two fixed lines when the packet is bare
  assert.equal(withTry({ self: false, does: [], reply: null }), `〔事件〕小主公试走（本回合第1次）：【马二进三】。
〔推演〕评定：好棋（和最好的走法几乎一样）。
走后形势：均势。
${FINE}`);
});

test('renderEvent: the directive of every question, and the additions to the opp directive in their order', () => {
  const ASK_TEXT = {
    good: '小主公问这步好不好：直说评定和最主要的一个理由。最多两句，50字以内。',
    reply: '小主公问对方会怎么应：说出对方最强的应对和随后的结果。最多两句，50字以内。',
    better: '小主公问有没有更好的：有就说出来，并用一句话讲清好在哪；没有就肯定小主公的选择。最多两句，50字以内。',
    why: '小主公追问为什么：把你上一句的结论换一种更具体的说法讲清楚，引用推演里的那条变化。最多三句，90字以内。',
    show: '小主公想让你指给他看：点明是对方哪个子在威胁、它下一步会怎么走。最多两句，50字以内。',
    intent: '小主公问对方想干什么：根据「对方刚走」和「对方的威胁」直说。最多两句，50字以内。',
    score: '小主公问现在谁占上风：按「形势」和子力对比回答，并给一个原因。最多两句，50字以内。',
    danger: '小主公问自己有没有危险：按「对方的威胁」回答；清单是空的又写了「清单完整」，就说眼下没有直接的危险。最多两句，50字以内。',
    last: '小主公问上一步走得怎么样：按「上一步的推演」直说评定和一个理由。最多两句，50字以内。',
    proud: '小主公问哪步下得最好：讲「最得意的一步」，说清好在哪。最多两句，50字以内。',
    improve: '小主公问哪里还能更好：讲「要点」里的那一条，引用那一步和更好的走法，不责备。最多两句，50字以内。',
    next: '小主公问下一盘注意什么：把「下一盘小目标」说成一个开局就能用上的小办法。最多两句，50字以内。',
  };
  assert.deepEqual(Object.keys(ASK_TEXT).sort(), ASK_CODES.filter((code) => code !== 'free').sort());
  for (const [ask, want] of Object.entries(ASK_TEXT)) {
    const over = ['proud', 'improve', 'next'].includes(ask);
    const body = clone(stored(over ? 'over.json' : 'try-held.json'));
    body.events.at(-1).said = 'none';
    body.events.push({ i: 20, kind: 'ask', ask });
    const r = request(body);
    assert.equal(renderEvent(r.events.at(-1), r.turn), `〔事件〕小主公点了问题：「${ASK_LABEL[ask]}」\n〔要求〕${want}`, ask);
  }

  // an earlier free question shows neither the child's sentence nor a directive; the last one shows both
  const free = fixture('ask-free.json');
  assert.equal(renderEvent({ i: 2, kind: 'ask', ask: 'free', said: 'none' }, free.turn), '〔事件〕小主公问了一个问题。');
  assert.equal(renderEvent(free.events[2], free.turn), EV_FREE_LAST);
  // the withheld packet travels with the question that asked for it, whatever the question
  const more = stored('try-held-ask.json').events[2].more;
  const withMore = clone(stored('try-held.json'));
  withMore.events[1].said = 'none';
  withMore.events.push({ i: 2, kind: 'ask', ask: 'free', say: '为什么不行', more });
  const wm = request(withMore);
  assert.equal(renderEvent(wm.events[2], wm.turn), '〔事件〕小主公说：「为什么不行」\n'
    + EV_REPLY_MORE_LAST.split('\n').slice(1, 3).join('\n')
    + '\n〔要求〕回答小主公这句话，最多三句，70字以内。与这盘棋无关就用一句话带回棋局。');

  // start without `first`
  assert.equal(renderEvent({ i: 0, kind: 'start' }, free.turn),
    '〔事件〕新的一局开始，小主公先行。\n〔要求〕用一句话给小主公鼓劲并请小主公先行。不建议具体着法。20字以内。');

  // opp: at most one addition, in the order mate threat, other threat, punishes, overlooked, chance, back
  const OPP = '〔要求〕用一句话解读对方这步棋想干什么，18字以内。不替小主公出主意。';
  const turn = clone(stored('opp.json').turn);
  const directive = (t) => {
    const r = request({ v: 1, turn: t, events: [{ i: 0, kind: 'opp' }] });
    return renderEvent(r.events[0], r.turn).split('\n').at(-1);
  };
  const mate = { k: 'mate_threat', by: { s: 'opp', t: 'C', f: 5 }, move: '炮5进4', net: { gain: [], lose: [], cp: -9999 }, sev: 'mate' };
  const everything = { ...turn, threats: [...turn.threats, mate], chance: { size: 'pawn', theme: 'attack', area: 'center' }, back: 'undo',
    opp: { ...turn.opp, punishes: true, overlooked: { on: { s: 'me', t: 'P', f: 5 }, move: '炮5进4' } } };
  assert.equal(directive(everything), OPP + '对方下一步有杀棋，要明确提醒。');
  assert.equal(directive({ ...everything, threats: turn.threats }), OPP + '点明对方盯上了哪个子，可以用问句，不给应法。');
  assert.equal(directive({ ...everything, threats: [] }), OPP + '平静地点明这是上一步留下的空子，不责备。');
  assert.equal(directive({ ...everything, threats: [], opp: { ...everything.opp, punishes: false } }),
    OPP + '可以提一句对方刚才漏掉了什么，让小主公松一口气。');
  assert.equal(directive({ ...everything, threats: [], opp: turn.opp }), OPP + '提醒小主公那一带有机会，让小主公自己找。');
  assert.equal(directive({ ...everything, threats: [], opp: turn.opp, chance: null }), OPP + '先用半句话接上悔棋或回到棋局这件事。');
  assert.equal(directive({ ...everything, threats: [], opp: turn.opp, chance: null, back: null }), OPP);

  // 〔已喊〕 carries the words of the cue table
  for (const cue of CUE_CODES) {
    assert.ok(renderEvent({ i: 0, kind: 'opp', cue }, request({ v: 1, turn, events: [{ i: 0, kind: 'opp' }] }).turn)
      .includes(`\n〔已喊〕「${CUE[cue]}」\n`), cue);
  }

  // pouch 3 with an alternative and without a line
  const h3 = clone(stored('hint.json'));
  h3.events[3].hint = { move: '马二进三', does: [], line: null, alt: '兵三进一' };
  const hr = request(h3);
  assert.equal(renderEvent(hr.events[3], hr.turn), '〔事件〕小主公打开了第三个锦囊。\n〔锦囊内容〕着法：我方【马二进三】。另一个选择：我方【兵三进一】。\n'
    + '〔要求〕说出这步棋，并用一句话讲清为什么。36字以内。');

  // a recap with nothing but its tries, and one that only says how far the pouches were opened
  const recap = (packet) => {
    const body = clone(stored('recap.json'));
    body.events = [{ i: 0, kind: 'recap', said: 'none', recap: packet }, { i: 9, kind: 'ask', ask: 'score' }];
    const r = request(body);
    return renderEvent(r.events[0], r.turn);
  };
  assert.equal(recap({ tries: [{ move: '兵三进一', cat: 'ok' }], hint: 0 }), '〔前情〕本回合小主公已试走：【兵三进一】（缓着）。');
  assert.equal(recap({ tries: [], hint: 2 }), '〔前情〕锦囊已开到第2个。');
});

test('renderToolResult: both sides, every optional line, every error word; the call id is never printed', () => {
  const verdict = { seq: ['马八进七'], who: 'me', cat: 'mistake', loss: 380, eval: { b: 'worse' },
    does: [{ k: 'develop', by: { s: 'me', t: 'H', f: 7 } }],
    flaws: [{ k: 'unguard', by: { s: 'me', t: 'H', f: 7 }, on: { s: 'me', t: 'C', f: 8 } }],
    cost: { gain: [], lose: ['C'], cp: -450 },
    reply: { first: 'opp', moves: ['车2进7', '炮八平九'], net: { gain: [], lose: ['C'], cp: -450 }, end: 'quiet' }, vsTry: 'worse' };
  assert.equal(renderToolResult({ id: 'call_SECRET_ID_1', ok: true, verdict }, 'red'), `〔推演结果〕走法：我方【马八进七】。
评定：失误（比最好的走法亏了大约一个马或炮）。走后形势：落了下风。
作用：我方七路马出动。毛病：我方七路马一走，我方八路炮就没人保护了。代价：我方白丢一个炮。
对方最强应对：对方【车2进7】→我方【炮八平九】，结果：我方白丢一个炮。
和小主公正在试走的那步相比：更差。`);

  // a sequence of four: the sides alternate backwards from the side that plays the last move
  const long = { seq: ['马二进三', '炮8平5', '车一平二', '马2进3'], who: 'opp', cat: 'best', loss: 0, eval: { b: 'even' }, does: [], flaws: [],
    cost: null, reply: null, vsTry: 'same' };
  assert.equal(renderToolResult({ id: 'x', ok: true, verdict: long }, 'red'), `〔推演结果〕走法：我方【马二进三】→对方【炮8平5】→我方【车一平二】→对方【马2进3】。
评定：对对方来说是好棋（和最好的走法几乎一样）。走后形势：均势。
和小主公正在试走的那步相比：差不多。`);
  assert.ok(renderToolResult({ id: 'x', ok: true, verdict: { ...long, seq: ['马二进三', '炮8平5', '车一平二'], who: 'me', vsTry: 'better' } }, 'red')
    .startsWith('〔推演结果〕走法：我方【马二进三】→对方【炮8平5】→我方【车一平二】。\n评定：好棋（'));

  const errors = {
    syntax: '这不是一步合乎记谱的棋。', no_such_move: '这个局面里没有这步棋。', ambiguous: '这个写法对应不止一步棋。',
    game_over: '棋局已经结束。', busy: '沙盘正忙，没推演出来。', limit: '本轮推演次数已用完。',
  };
  for (const [error, word] of Object.entries(errors)) {
    assert.equal(renderToolResult({ id: 'call_SECRET_ID_2', ok: false, error }, 'red'), `〔推演失败〕${word}`, error);
  }
  assert.equal(renderToolResult({ id: 'x', ok: false, error: 'ambiguous', at: 0, candidates: ['车一平二', '车九平八'] }, 'black'),
    '〔推演失败〕这个写法对应不止一步棋。可能是：【车一平二】、【车九平八】。');
  assert.equal(renderToolResult({ id: 'x', ok: false, error: 'no_such_move', candidates: [] }, 'red'), '〔推演失败〕这个局面里没有这步棋。');

  // no rendered text of a resumed request contains a call id
  const req = fixture('ask-free-resume.json');
  const text = buildMessages(req, LEGS_97).map((m) => m.content ?? '').join('\n');
  assert.ok(!text.includes('call_7Qm2'));
  assert.ok(!JSON.stringify(buildMessages(fixture('ask-tools.json'), []).map((m) => m.content)).includes('call_7Qm2'));
});

test('every move the model reads is a move the request carries; user and assistant turns alternate', () => {
  // Grounding by construction (section 9.1): the renderer prints packets and never composes a move of its own.
  const carried = (x, out = new Set()) => {
    if (typeof x === 'string') for (const move of notations(x)) out.add(move);
    else if (x && typeof x === 'object') for (const value of Object.values(x)) carried(value, out);
    return out;
  };
  for (const name of FIXTURE_NAMES) {
    const req = fixture(name);
    const legs = req.resume ? LEGS_97 : [];
    const known = carried([req, legs]);
    const messages = buildMessages(req, legs);
    for (const m of messages.slice(1)) {
      for (const move of bracketed(m.content ?? '')) assert.ok(known.has(move), `${name}: 【${move}】 is in no packet`);
    }
    // the shape of a chat: system, then user and assistant in turn, ending with the user message that asks; the legs follow
    const thread = messages.filter((m) => !m.tool_calls && m.role !== 'tool');
    assert.deepEqual(thread.map((m) => m.role), ['system', ...thread.slice(1).map((_, k) => (k % 2 === 0 ? 'user' : 'assistant'))], name);
    assert.equal(thread.at(-1).role, 'user', name);
    assert.ok(thread.at(-1).content.includes('\n〔要求〕'), `${name}: the last user message says what to do`);
    assert.equal(thread.slice(1).filter((m) => m.content.includes('〔要求〕')).length, 1, `${name}: one directive, for the event to answer`);
    for (const m of thread) assert.ok(m.content.length > 0, `${name}: no empty message`);
  }

  // an `opp` event in a thread whose brief has no rival move (the validator does not forbid it) names no move
  const bare = request({ v: 1, turn: stored('start.json').turn, events: [{ i: 0, kind: 'opp' }] });
  assert.equal(renderEvent(bare.events[0], bare.turn), '〔事件〕对方落子。\n〔要求〕用一句话解读对方这步棋想干什么，18字以内。不替小主公出主意。');
});

test('buildMessages on resume: one assistant message per leg, one tool message per call, in order', () => {
  const body = clone(stored('ask-free.json'));
  const verdict = stored('ask-free-resume.json').resume.results[0].verdict;
  const legs = [
    { text: '亮先摆一摆。', calls: [
      { id: 'call_a', name: 'analyze_move', arguments: '{"notation":"炮2平5","after":["马二进三"]}' },
      { id: 'call_b', name: 'analyze_move', arguments: '{"notation":"not a move"}' },
      { id: 'call_c', name: 'analyze_move', arguments: '{"notation":"车九平八","after":[]}' },
    ], x: [{ id: 'call_b', error: 'syntax' }, { id: 'call_c', error: 'limit' }] },
    { text: '', calls: [
      { id: 'call_d', name: 'analyze_move', arguments: '{"notation":"车一平二","after":[]}' },
      { id: 'call_e', name: 'analyze_move', arguments: '{"notation":"兵三进一","after":[]}' },
    ], x: [] },
  ];
  // the client answered call_a and call_d; call_e got no answer
  body.resume = { token: 'e30.c2ln', results: [
    { id: 'call_d', ok: false, error: 'ambiguous', candidates: ['车一平二', '车九平八'] },
    { id: 'call_a', ok: true, verdict },
  ] };
  const req = request(body);
  const base = buildMessages(request(clone(stored('ask-free.json'))), []);
  const messages = buildMessages(req, legs);
  assert.deepEqual(messages.slice(0, base.length), base, 'the messages of the first leg come first, unchanged');
  assert.deepEqual(messages.slice(base.length), [
    { role: 'assistant', content: '亮先摆一摆。', tool_calls: [
      { id: 'call_a', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"炮2平5","after":["马二进三"]}' } },
      { id: 'call_b', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"not a move"}' } },
      { id: 'call_c', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"车九平八","after":[]}' } },
    ] },
    { role: 'tool', tool_call_id: 'call_a', content: TOOL_OK_97 },
    { role: 'tool', tool_call_id: 'call_b', content: '〔推演失败〕这不是一步合乎记谱的棋。' },
    { role: 'tool', tool_call_id: 'call_c', content: '〔推演失败〕本轮推演次数已用完。' },
    { role: 'assistant', content: null, tool_calls: [
      { id: 'call_d', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"车一平二","after":[]}' } },
      { id: 'call_e', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"兵三进一","after":[]}' } },
    ] },
    { role: 'tool', tool_call_id: 'call_d', content: '〔推演失败〕这个写法对应不止一步棋。可能是：【车一平二】、【车九平八】。' },
    { role: 'tool', tool_call_id: 'call_e', content: '〔推演失败〕沙盘正忙，没推演出来。' },
  ]);
  // every message has exactly the fields of its role
  for (const m of messages) {
    const keys = Object.keys(m).sort().join();
    assert.ok(['content,role', 'content,role,tool_calls', 'content,role,tool_call_id'].includes(keys), keys);
  }
});
