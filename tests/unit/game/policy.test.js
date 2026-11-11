// Policy (SPEC 4.22, 14.4): the pure budget rules of the game layer. No clock, no DOM: plain records in, decisions out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createBudgets, shouldSpeakOpp, announceChance, voiceHeld, afterHeld, praiseFor, stampFor, rivalThinkMs, idleOffer, offerTakeback, softCheck,
} from '../../../src/game/policy.js';
import { NOTATION_RE, TACTIC_MOTIFS, STAMP_PATTERNS, PATTERN_NAME } from '../../../src/core/codes.js';
import { mulberry32 } from '../../helpers/playout.js';

// ---- builders (shapes of SPEC 3.6) ----

/** A rival move as the brief carries it (OppMove): a quiet developing move unless `over` says otherwise. */
function oppMove(over = {}) {
  return { move: '马8进7', check: false, does: [{ k: 'develop' }], quality: 'normal', ...over };
}

/** A TurnBrief of the middle game with nothing going on. */
function brief(over = {}) {
  return {
    ply: 10, me: 'red', phase: 'middle', check: false, n: 40, back: null, eval: { b: 'even' },
    mat: { me: 'R2H2C2P5A2E2', opp: 'R2H2C2P5A2E2', cp: 0 }, level: 2, moments: [], taught: [], mine: null,
    opp: oppMove(), threats: [], chance: null, known: { threats: true, chance: false },
    ...over,
  };
}

/** A Threat of the given severity (the rival's rook aims at a child piece). */
function threat(sev) {
  const on = { pawn: 'P', piece: 'H', rook: 'R', mate: 'K' }[sev];
  const cp = { pawn: -100, piece: -400, rook: -900, mate: -9999 }[sev];
  return { k: sev === 'mate' ? 'mate_threat' : 'attack', by: { s: 'opp', t: 'R', f: 8 }, on: { s: 'me', t: on, f: 3 }, move: '车8进7',
           net: { gain: [], lose: sev === 'mate' ? [] : [on], cp }, sev };
}

/** A held trial (TryPacket) that drops a horse: concrete, but neither a mate nor a rook. */
function heldPacket(over = {}) {
  return { move: '马二进四', cat: 'mistake', loss: 380, held: true, eval: { b: 'worse' }, does: [], flaws: [{ k: 'hang' }],
           cost: { gain: [], lose: ['H'], cp: -400 }, reply: null, toward: null, chance: 'none', ...over };
}

/** What praiseFor is told about a confirmed move: earned and best, nothing special, unless `over` says otherwise. */
function played(over = {}) {
  return { earned: true, cat: 'best', found: false, hintMax: 0, lead: undefined, ...over };
}

// ---- createBudgets ----

test('createBudgets: every counter starts as 4.22 says, and each game gets its own record', () => {
  assert.deepEqual(createBudgets(), {
    questions: 0, lastQuestionAt: -99, ignored: 0, silentUntil: 0, ownWayTold: false,
    lastPopupAt: -99, brilliantPopups: 0, streak: 0, takebacks: 0, idleOffers: 0, idleDeclined: false,
    stamps: [], lastCheckPly: -99, firstTrialTold: false, rivalLineAt: -99,
  });
  const a = createBudgets();
  const b = createBudgets();
  a.stamps.push('central_cannon');
  a.questions = 3;
  assert.deepEqual(b.stamps, []);
  assert.equal(b.questions, 0);
});

// ---- shouldSpeakOpp ----

test("shouldSpeakOpp: quiet developing move is silent; capture, check, piece threat, punish, named pattern, ply < 4 speak; talk 'more' always speaks", () => {
  // a quiet developing move in the middle of the game: the caption is enough
  assert.equal(shouldSpeakOpp(brief(), 'smart'), false);
  assert.equal(shouldSpeakOpp(brief({ opp: oppMove({ does: [{ k: 'quiet' }], quality: 'soft' }) }), 'smart'), false);
  assert.equal(shouldSpeakOpp(brief({ opp: oppMove({ does: [{ k: 'cross_river' }], quality: 'strong' }) }), 'smart'), false);

  // each reason of the rule, alone
  assert.equal(shouldSpeakOpp(brief({ opp: oppMove({ captured: 'P', does: [{ k: 'capture' }] }) }), 'smart'), true, 'capture');
  assert.equal(shouldSpeakOpp(brief({ opp: oppMove({ check: true, does: [{ k: 'check' }] }) }), 'smart'), true, 'check');
  assert.equal(shouldSpeakOpp(brief({ opp: oppMove({ punishes: true }) }), 'smart'), true, 'punish');
  assert.equal(shouldSpeakOpp(brief({ opp: oppMove({ name: 'screen_horses' }) }), 'smart'), true, 'named pattern');
  assert.equal(shouldSpeakOpp(brief({ opp: oppMove({ overlooked: { on: { s: 'me', t: 'C', f: 2 }, move: '车8进7' } }) }), 'smart'), true, 'overlooked');
  assert.equal(shouldSpeakOpp(brief({ chance: { size: 'piece', theme: 'fork', area: 'center' }, known: { threats: true, chance: true } }), 'smart'), true, 'chance');

  // threats: a pawn is not worth a sentence, a piece or more is
  assert.equal(shouldSpeakOpp(brief({ threats: [threat('pawn')] }), 'smart'), false, 'pawn threat');
  assert.equal(shouldSpeakOpp(brief({ threats: [threat('piece')] }), 'smart'), true, 'piece threat');
  assert.equal(shouldSpeakOpp(brief({ threats: [threat('rook')] }), 'smart'), true, 'rook threat');
  assert.equal(shouldSpeakOpp(brief({ threats: [threat('mate')] }), 'smart'), true, 'mate threat');
  assert.equal(shouldSpeakOpp(brief({ threats: [threat('pawn'), threat('pawn')] }), 'smart'), false, 'two pawn threats');
  assert.equal(shouldSpeakOpp(brief({ threats: [threat('pawn'), threat('piece')] }), 'smart'), true, 'a piece threat behind a pawn threat');

  // the first plies always get a sentence
  for (const ply of [0, 1, 2, 3]) assert.equal(shouldSpeakOpp(brief({ ply }), 'smart'), true, `ply ${ply}`);
  for (const ply of [4, 5, 40]) assert.equal(shouldSpeakOpp(brief({ ply }), 'smart'), false, `ply ${ply}`);

  // talk 'more': every rival move
  assert.equal(shouldSpeakOpp(brief(), 'more'), true);
  assert.equal(shouldSpeakOpp(brief({ ply: 60, opp: oppMove({ does: [{ k: 'quiet' }] }) }), 'more'), true);
});

test('shouldSpeakOpp: a brief with no rival move does not throw and follows the remaining reasons', () => {
  assert.equal(shouldSpeakOpp(brief({ ply: 0, opp: null }), 'smart'), true, 'the child opens: ply < 4');
  assert.equal(shouldSpeakOpp(brief({ ply: 12, opp: null }), 'smart'), false);
  assert.equal(shouldSpeakOpp(brief({ ply: 12, opp: null, threats: [threat('rook')] }), 'smart'), true);
  assert.equal(shouldSpeakOpp(brief({ ply: 12, opp: null, threats: [threat('pawn')] }), 'smart'), false);
  assert.equal(shouldSpeakOpp(brief({ ply: 12, opp: null, chance: { size: 'pawn', theme: 'capture_free', area: 'left' } }), 'smart'), true);
  assert.equal(shouldSpeakOpp(brief({ ply: 12, opp: null }), 'more'), true);
});

/**
 * A scripted game of 30 rival moves (the child plays red, so rival move k is answered at ply 2k).
 * Only the facts matter: the policy reads the brief, never the board. `speak` is what the rule of 4.22 gives for the
 * facts of that row, worked out by hand; `why` names the one reason.
 */
const SCRIPT = [
  { move: '炮8平5', speak: true, why: 'ply 2 < 4' },
  { move: '马8进7', speak: false },
  { move: '车9平8', opp: { does: [{ k: 'open_rook' }] }, speak: false },
  { move: '卒7进1', opp: { does: [{ k: 'quiet' }] }, speak: false },
  { move: '马2进3', opp: { name: 'screen_horses' }, speak: true, why: 'named pattern' },
  { move: '炮2平4', speak: false },
  { move: '士4进5', opp: { does: [{ k: 'defend' }] }, speak: false },
  { move: '卒3进1', opp: { does: [{ k: 'attack' }] }, turn: { threats: [threat('pawn')] }, speak: false },
  { move: '车8进6', opp: { does: [{ k: 'attack' }], quality: 'strong' }, turn: { threats: [threat('piece')] }, speak: true, why: 'piece threat' },
  { move: '车1平2', opp: { does: [{ k: 'open_rook' }] }, speak: false },
  { move: '炮5进4', opp: { captured: 'P', check: true, does: [{ k: 'capture' }, { k: 'check' }] }, turn: { check: true }, speak: true, why: 'capture with check' },
  { move: '车8平7', opp: { captured: 'H', does: [{ k: 'trade' }] }, speak: true, why: 'capture' },
  { move: '马7进6', opp: { does: [{ k: 'quiet' }] }, speak: false },
  { move: '炮4平6', opp: { does: [{ k: 'quiet' }] }, speak: false },
  { move: '车2进4', opp: { does: [{ k: 'quiet' }], quality: 'soft', overlooked: { on: { s: 'me', t: 'C', f: 8 }, move: '车7进1' } }, speak: true, why: 'overlooked a capture' },
  { move: '卒7进1', opp: { does: [{ k: 'cross_river' }] }, speak: false },
  { move: '马6进5', opp: { does: [{ k: 'quiet' }], quality: 'soft' },
    turn: { chance: { size: 'piece', theme: 'fork', area: 'center' }, known: { threats: true, chance: true } }, speak: true, why: 'announced chance' },
  { move: '象3进5', opp: { does: [{ k: 'defend' }] }, speak: false },
  { move: '车7退2', opp: { does: [{ k: 'escape' }] }, speak: false },
  { move: '炮4进2', opp: { does: [{ k: 'quiet' }] }, speak: false },
  { move: '车7平3', opp: { captured: 'H', punishes: true, does: [{ k: 'capture_free' }], quality: 'strong' }, speak: true, why: 'punishes' },
  { move: '象5退7', opp: { does: [{ k: 'quiet' }] }, speak: false },
  { move: '卒7平6', opp: { does: [{ k: 'attack' }] }, turn: { threats: [threat('pawn')] }, speak: false },
  { move: '马5进7', opp: { check: true, does: [{ k: 'check' }] }, turn: { check: true }, speak: true, why: 'check' },
  { move: '炮4退1', opp: { does: [{ k: 'quiet' }] }, speak: false },
  { move: '车3进3', opp: { does: [{ k: 'attack' }], quality: 'strong' }, turn: { threats: [threat('rook')] }, speak: true, why: 'rook threat' },
  { move: '卒6进1', opp: { does: [{ k: 'quiet' }] }, speak: false },
  { move: '炮4平5', opp: { does: [{ k: 'cannon_mount' }] }, speak: false },
  { move: '车3平5', opp: { captured: 'A', does: [{ k: 'capture' }] }, speak: true, why: 'capture' },
  { move: '卒6平5', opp: { does: [{ k: 'quiet' }] }, speak: false },
];

test('on a scripted 30-move game at most 40 % of rival moves get a sentence', () => {
  assert.equal(SCRIPT.length, 30);
  const turns = SCRIPT.map((row, i) => brief({ ply: 2 * (i + 1), opp: oppMove({ move: row.move, ...row.opp }), ...row.turn }));
  for (const row of SCRIPT) assert.match(row.move, NOTATION_RE);

  const spoken = turns.map(turn => shouldSpeakOpp(turn, 'smart'));
  spoken.forEach((speaks, i) => assert.equal(speaks, SCRIPT[i].speak, `rival move ${i + 1} (${SCRIPT[i].move}): ${SCRIPT[i].why ?? 'nothing notable'}`));

  const sentences = spoken.filter(Boolean).length;
  assert.equal(sentences, 11);
  assert.ok(sentences / turns.length <= 0.4, `${sentences} of ${turns.length} rival moves got a sentence`);

  // every rival move still has its caption (the director's duty); with talk 'more' every one also gets a sentence
  assert.equal(turns.filter(turn => shouldSpeakOpp(turn, 'more')).length, 30);
});

// ---- announceChance ----

test('announceChance: only a chance, and only for a child whose find rate for that tier is below 0.35', () => {
  const line = { first: 'red', moves: [], end: 'quiet' };
  const chance = { gain: 400, points: 4, tier: 1, revealDepth: 2, line };
  assert.equal(announceChance(chance, 0), true);
  assert.equal(announceChance(chance, 0.34), true);
  assert.equal(announceChance(chance, 0.35), false);
  assert.equal(announceChance(chance, 0.9), false);
  assert.equal(announceChance(null, 0), false);
  assert.equal(announceChance(null, 1), false);
});

// ---- voiceHeld ----

/** Play `moves` child moves; `heldAt(n)` says whether move n is a held trial. Counts a voiced question as the director does (SPEC 5.8, E-trial). */
function voicedMoves(b, moves, packet, heldAt = () => true) {
  const voicedAt = [];
  for (let n = 1; n <= moves; n++) {
    if (!heldAt(n)) continue;
    if (voiceHeld(packet, b, n)) {
      b.questions += 1;
      b.lastQuestionAt = n;
      voicedAt.push(n);
    }
  }
  return voicedAt;
}

test('voiceHeld: at most one per four child moves and six per game; mate or a rook loss is always voiced', () => {
  // a child who walks into a held trial on every single move of a 40-move game hears six questions, four moves apart
  const b = createBudgets();
  assert.deepEqual(voicedMoves(b, 40, heldPacket()), [1, 5, 9, 13, 17, 21]);
  assert.equal(b.questions, 6);

  // held trials at scattered moves: the fourth move after a question is the first that may be voiced again
  assert.deepEqual(voicedMoves(createBudgets(), 30, heldPacket(), n => [3, 4, 6, 7, 20, 22, 23].includes(n)), [3, 7, 20]);

  // the function only reads the budgets
  const before = createBudgets();
  voiceHeld(heldPacket(), before, 1);
  voiceHeld(heldPacket({ eval: { b: 'lost', mate: -1 } }), before, 1);
  assert.deepEqual(before, createBudgets());

  // not before silentUntil
  const quietTime = { ...createBudgets(), silentUntil: 12 };
  assert.equal(voiceHeld(heldPacket(), quietTime, 11), false);
  assert.equal(voiceHeld(heldPacket(), quietTime, 12), true);

  // outside every budget: six questions asked, the last one on the previous move, silence ordered
  const spent = { ...createBudgets(), questions: 6, lastQuestionAt: 29, silentUntil: 99 };
  assert.equal(voiceHeld(heldPacket(), spent, 30), false);
  // ... a mate against the child is always voiced
  assert.equal(voiceHeld(heldPacket({ cat: 'blunder', eval: { b: 'lost', mate: -1 }, cost: null }), spent, 30), true);
  assert.equal(voiceHeld(heldPacket({ cat: 'blunder', eval: { b: 'lost', mate: -3 } }), spent, 30), true);
  // ... and so is the loss of a rook (800 cp or more)
  assert.equal(voiceHeld(heldPacket({ cat: 'blunder', cost: { gain: [], lose: ['R'], cp: -900 } }), spent, 30), true);
  assert.equal(voiceHeld(heldPacket({ cat: 'blunder', cost: { gain: ['P'], lose: ['R'], cp: -800 } }), spent, 30), true);
  // ... but nothing smaller, and not a mate the child gives
  assert.equal(voiceHeld(heldPacket({ cost: { gain: [], lose: ['C', 'A'], cp: -799 } }), spent, 30), false);
  assert.equal(voiceHeld(heldPacket({ cost: null }), spent, 30), false);
  assert.equal(voiceHeld(heldPacket({ eval: { b: 'won', mate: 2 }, cost: null }), spent, 30), false);

  // seven severe trials in a row are all voiced, whatever the counters say
  const loud = createBudgets();
  assert.deepEqual(voicedMoves(loud, 7, heldPacket({ eval: { b: 'lost', mate: -2 } })), [1, 2, 3, 4, 5, 6, 7]);
});

// ---- afterHeld ----

test('afterHeld: two ignored questions say the own-way line once and silence three moves', () => {
  const b = createBudgets();

  // move 3: a voiced question, and the child plays the move anyway
  b.questions = 1;
  b.lastQuestionAt = 3;
  let r = afterHeld(b, 'confirmed', true, 3);
  assert.equal(r.sayOwnWay, false);
  assert.equal(r.b, b, 'the record is updated in place and handed back');
  assert.equal(b.ignored, 1);
  assert.equal(b.silentUntil, 0);
  assert.equal(b.ownWayTold, false);

  // move 7: the second one in a row
  b.questions = 2;
  b.lastQuestionAt = 7;
  r = afterHeld(b, 'confirmed', true, 7);
  assert.equal(r.sayOwnWay, true);
  assert.equal(b.ownWayTold, true);
  assert.equal(b.ignored, 0);
  assert.equal(b.silentUntil, 11);

  // three silent moves, 8 to 10; the silence holds on its own, without the one-per-four rule
  const silenceOnly = { ...b, lastQuestionAt: -99 };
  for (const n of [8, 9, 10]) {
    assert.equal(voiceHeld(heldPacket(), b, n), false, `move ${n}`);
    assert.equal(voiceHeld(heldPacket(), silenceOnly, n), false, `move ${n}, by silentUntil alone`);
  }
  assert.equal(voiceHeld(heldPacket(), b, 11), true);
  assert.equal(voiceHeld(heldPacket(), silenceOnly, 11), true);
  // a mate is voiced even then
  assert.equal(voiceHeld(heldPacket({ eval: { b: 'lost', mate: -1 } }), b, 8), true);

  // the line is said once per game; the back-off itself repeats
  assert.equal(afterHeld(b, 'confirmed', true, 11).sayOwnWay, false);
  assert.equal(b.ignored, 1);
  r = afterHeld(b, 'confirmed', true, 15);
  assert.equal(r.sayOwnWay, false);
  assert.equal(b.ignored, 0);
  assert.equal(b.silentUntil, 19);
  assert.equal(b.ownWayTold, true);
});

test('afterHeld: only voiced questions confirmed in a row count; taking the move back clears the count', () => {
  const b = createBudgets();

  // an un-voiced held move that is confirmed changes nothing
  assert.equal(afterHeld(b, 'confirmed', false, 2).sayOwnWay, false);
  assert.deepEqual(b, createBudgets());

  // ignored, then listened to, then ignored again: not "two in a row"
  afterHeld(b, 'confirmed', true, 3);
  assert.equal(b.ignored, 1);
  const back = afterHeld(b, 'retracted', true, 7);
  assert.equal(back.sayOwnWay, false);
  assert.equal(back.b.ignored, 0);
  const again = afterHeld(b, 'confirmed', true, 7);
  assert.equal(again.sayOwnWay, false);
  assert.equal(b.ignored, 1);
  assert.equal(b.silentUntil, 0);
  assert.equal(b.ownWayTold, false);

  // a retract never says the line and never orders silence
  const fresh = createBudgets();
  assert.deepEqual(afterHeld(fresh, 'retracted', false, 5), { b: createBudgets(), sayOwnWay: false });

  // an un-voiced held move confirmed between two ignored questions does not break the row ...
  const row = createBudgets();
  afterHeld(row, 'confirmed', true, 3);
  afterHeld(row, 'confirmed', false, 5);
  assert.equal(row.ignored, 1);
  assert.equal(afterHeld(row, 'confirmed', true, 7).sayOwnWay, true);
  assert.equal(row.silentUntil, 11);

  // ... but a take-back does, whether that trial was voiced or not (4.22: "retracted: ignored = 0")
  const heeded = createBudgets();
  afterHeld(heeded, 'confirmed', true, 3);
  assert.equal(afterHeld(heeded, 'retracted', false, 5).b.ignored, 0);
  assert.equal(afterHeld(heeded, 'confirmed', true, 7).sayOwnWay, false);
  assert.equal(heeded.ignored, 1);
  assert.equal(heeded.silentUntil, 0);
});

// ---- praiseFor ----

test('praiseFor: un-earned gives null; one popup per four moves; brilliant twice a game; lord needs a find with no pouch; streak counts earned moves only', () => {
  // un-earned: no popup, whatever the verdict
  for (const cat of ['brilliant', 'best', 'good', 'ok', 'mistake', 'blunder', null]) {
    const b = createBudgets();
    assert.equal(praiseFor(played({ earned: false, cat, found: true, lead: 'fork' }), b, 1), null, `cat ${cat}`);
    assert.deepEqual(b, createBudgets());
  }

  // one popup per four child moves: nine earned moves in a row pop at 1, 5 and 9; the streak runs through all of them
  {
    const b = createBudgets();
    const popups = [];
    for (let n = 1; n <= 9; n++) {
      const praise = praiseFor(played(), b, n);
      assert.equal(b.streak, n);
      if (praise) popups.push([n, praise.tier, praise.streak]);
    }
    assert.deepEqual(popups, [[1, 'good', 1], [5, 'good', 5], [9, 'good', 9]]);
    assert.equal(b.lastPopupAt, 9);
  }

  // brilliant twice a game; the third brilliant move falls through to the next tier that fits
  {
    const b = createBudgets();
    assert.deepEqual(praiseFor(played({ cat: 'brilliant', lead: 'fork' }), b, 1), { tier: 'brilliant', streak: 1 });
    // a brilliant move inside the four-move window gets no popup and does not use up the allowance
    assert.equal(praiseFor(played({ cat: 'brilliant', lead: 'fork' }), b, 3), null);
    assert.equal(b.brilliantPopups, 1);
    assert.deepEqual(praiseFor(played({ cat: 'brilliant', lead: 'fork' }), b, 5), { tier: 'brilliant', streak: 3 });
    assert.equal(b.brilliantPopups, 2);
    assert.deepEqual(praiseFor(played({ cat: 'brilliant', lead: 'fork' }), b, 9), { tier: 'great', streak: 4 });
    assert.deepEqual(praiseFor(played({ cat: 'brilliant', found: true, hintMax: 0, lead: 'fork' }), b, 13), { tier: 'lord', streak: 5 });
    assert.deepEqual(praiseFor(played({ cat: 'brilliant', lead: 'develop' }), b, 17), { tier: 'good', streak: 6 });
    assert.equal(b.brilliantPopups, 2);
  }

  // lord: the child's own find (the tactical test) with no pouch opened at all
  assert.equal(praiseFor(played({ found: true, hintMax: 0, lead: 'capture_free' }), createBudgets(), 1)?.tier, 'lord');
  assert.equal(praiseFor(played({ found: true, hintMax: 0 }), createBudgets(), 1)?.tier, 'lord');
  for (const hintMax of [1, 2, 3]) {
    assert.equal(praiseFor(played({ found: true, hintMax, lead: 'capture_free' }), createBudgets(), 1)?.tier, 'great', `pouch ${hintMax} opened`);
    assert.equal(praiseFor(played({ found: true, hintMax, lead: 'defend' }), createBudgets(), 1)?.tier, 'good', `pouch ${hintMax} opened, no tactic`);
  }
  assert.equal(praiseFor(played({ found: false, hintMax: 0, lead: 'capture_free' }), createBudgets(), 1)?.tier, 'great', 'not a find');

  // great: the leading effect is a tactic motif; anything else is good
  assert.deepEqual([...TACTIC_MOTIFS], ['capture_free', 'fork', 'pin', 'discovered', 'mate', 'mate_threat']);
  for (const lead of TACTIC_MOTIFS) assert.equal(praiseFor(played({ lead }), createBudgets(), 1)?.tier, 'great', lead);
  for (const lead of ['capture', 'check', 'trade', 'develop', 'defend', 'quiet', undefined]) {
    assert.equal(praiseFor(played({ lead }), createBudgets(), 1)?.tier, 'good', String(lead));
  }
  // a verdict that is still pending at commit (cat null) is praised by the remaining rules
  assert.deepEqual(praiseFor(played({ cat: null }), createBudgets(), 1), { tier: 'good', streak: 1 });
  assert.equal(praiseFor(played({ cat: null, lead: 'pin' }), createBudgets(), 1)?.tier, 'great');
  assert.equal(praiseFor(played({ cat: null, found: true, lead: 'pin' }), createBudgets(), 1)?.tier, 'lord');

  // streak: consecutive earned moves; an un-earned move in between starts it again
  {
    const b = createBudgets();
    const streaks = [true, true, true, false, true, false, false, true, true].map((earned, i) => {
      praiseFor(played({ earned, cat: earned ? 'best' : 'good' }), b, i + 1);
      return b.streak;
    });
    assert.deepEqual(streaks, [1, 2, 3, 0, 1, 0, 0, 1, 2]);
  }
  // ... and an un-earned move does not move the popup clock
  {
    const b = createBudgets();
    assert.equal(praiseFor(played(), b, 1)?.streak, 1);
    assert.equal(praiseFor(played({ earned: false, cat: 'ok' }), b, 2), null);
    assert.equal(b.lastPopupAt, 1);
    assert.equal(praiseFor(played(), b, 4), null, 'three moves after the popup');
    assert.deepEqual(praiseFor(played(), b, 5), { tier: 'good', streak: 2 });
  }
});

// ---- stampFor ----

test('stampFor: full the first time, small afterwards; heart_horse is never stamped', () => {
  const b = createBudgets();

  assert.deepEqual(stampFor(['trough_horse'], null, b), { text: '卧槽马！', size: 'full' });
  assert.deepEqual(b.stamps, ['trough_horse']);
  assert.deepEqual(stampFor(['trough_horse'], null, b), { text: '卧槽马！', size: 'small' });
  assert.deepEqual(stampFor(['trough_horse'], null, b), { text: '卧槽马！', size: 'small' });
  assert.deepEqual(b.stamps, ['trough_horse'], 'a pattern is listed once');

  // the opening comes first, then the patterns in their order
  assert.deepEqual(stampFor(['horse_cannon'], 'central_cannon', b), { text: '当头炮！', size: 'full' });
  assert.deepEqual(stampFor(['horse_cannon', 'double_cannon'], null, b), { text: '马后炮！', size: 'full' });
  assert.deepEqual(stampFor(['trough_horse', 'double_cannon'], null, b), { text: '卧槽马！', size: 'small' }, 'the first one decides, even when stamped before');
  assert.deepEqual(stampFor(['double_cannon'], null, b), { text: '重炮！', size: 'full' });
  assert.deepEqual(b.stamps, ['trough_horse', 'central_cannon', 'horse_cannon', 'double_cannon']);

  // nothing to stamp
  assert.equal(stampFor([], null, b), null);

  // heart_horse is a weakness, never a stamp; neither is the bare sacrifice
  const fresh = createBudgets();
  assert.equal(stampFor(['heart_horse'], null, fresh), null);
  assert.equal(stampFor([], 'heart_horse', fresh), null);
  assert.equal(stampFor(['sacrifice_play'], null, fresh), null);
  assert.equal(stampFor(['heart_horse'], null, fresh), null, 'not the second time either');
  assert.deepEqual(fresh.stamps, []);
  assert.deepEqual(stampFor(['heart_horse', 'smother'], null, fresh), { text: '闷宫！', size: 'full' });
  assert.deepEqual(stampFor(['smother'], 'heart_horse', fresh), { text: '闷宫！', size: 'small' });

  // every stampable pattern: its name and a full-width exclamation mark, full once per game
  assert.equal(STAMP_PATTERNS.length, 24);
  const all = createBudgets();
  for (const code of STAMP_PATTERNS) {
    assert.deepEqual(stampFor([code], null, all), { text: `${PATTERN_NAME[code]}！`, size: 'full' }, code);
    assert.deepEqual(stampFor([code], null, all), { text: `${PATTERN_NAME[code]}！`, size: 'small' }, code);
  }
  // a new game stamps at full size again
  assert.deepEqual(stampFor(['trough_horse'], null, createBudgets()), { text: '卧槽马！', size: 'full' });
});

// ---- rivalThinkMs ----

test('rivalThinkMs ranges; reduced motion is 300', () => {
  const info = (over = {}) => ({ forced: false, recapture: false, trouble: false, reduced: false, ...over });
  const at = x => () => x;

  // forced reply or recapture: 300 to 450 ms
  assert.equal(rivalThinkMs(info({ forced: true }), at(0)), 300);
  assert.equal(rivalThinkMs(info({ forced: true }), at(0.5)), 375);
  assert.equal(rivalThinkMs(info({ recapture: true }), at(0)), 300);
  assert.equal(rivalThinkMs(info({ recapture: true }), at(0.5)), 375);
  // in trouble: a fixed 1400 ms, the tell
  assert.equal(rivalThinkMs(info({ trouble: true }), at(0)), 1400);
  assert.equal(rivalThinkMs(info({ trouble: true }), at(0.999)), 1400);
  // a forced reply stays quick even when he is in trouble
  assert.equal(rivalThinkMs(info({ forced: true, trouble: true }), at(0.5)), 375);
  assert.equal(rivalThinkMs(info({ recapture: true, trouble: true }), at(0.5)), 375);
  // otherwise 600 to 900 ms
  assert.equal(rivalThinkMs(info(), at(0)), 600);
  assert.equal(rivalThinkMs(info(), at(0.5)), 750);

  // reduced motion: always 300, and the generator is left alone
  const untouched = () => { throw new Error('rnd must not be called'); };
  for (const forced of [false, true]) for (const recapture of [false, true]) for (const trouble of [false, true]) {
    assert.equal(rivalThinkMs({ forced, recapture, trouble, reduced: true }, untouched), 300);
  }
  assert.equal(rivalThinkMs(info({ trouble: true }), untouched), 1400);

  // the ranges, over a seeded generator
  const rnd = mulberry32(20261110);
  for (let i = 0; i < 2000; i++) {
    const quick = rivalThinkMs(info({ forced: i % 2 === 0, recapture: i % 2 === 1 }), rnd);
    assert.ok(quick >= 300 && quick < 450, `forced / recapture: ${quick}`);
    const normal = rivalThinkMs(info(), rnd);
    assert.ok(normal >= 600 && normal < 900, `normal: ${normal}`);
  }
});

// ---- idleOffer ----

test('idleOffer: 90 s, twice a game, not with a piece selected, not after a decline', () => {
  // The 90 000 ms timer itself belongs to the director (SPEC 5.8, E-turn); this is what it asks when the timer fires.
  const waiting = { phase: 'childTurn', offeredHere: false };
  assert.equal(idleOffer(waiting, createBudgets()), true);

  // only while the child is to move with nothing picked up
  for (const phase of ['selected', 'tentative', 'opponentTurn', 'over']) {
    assert.equal(idleOffer({ phase, offeredHere: false }, createBudgets()), false, phase);
  }
  // once per position
  assert.equal(idleOffer({ phase: 'childTurn', offeredHere: true }, createBudgets()), false);

  // twice a game: the director counts each offer it makes
  const b = createBudgets();
  let offers = 0;
  for (let position = 0; position < 10; position++) {
    if (idleOffer(waiting, b)) {
      b.idleOffers += 1;
      offers += 1;
    }
  }
  assert.equal(offers, 2);
  assert.equal(idleOffer(waiting, { ...createBudgets(), idleOffers: 1 }), true);
  assert.equal(idleOffer(waiting, { ...createBudgets(), idleOffers: 2 }), false);

  // never again after the child declined one
  assert.equal(idleOffer(waiting, { ...createBudgets(), idleOffers: 1, idleDeclined: true }), false);
  assert.equal(idleOffer(waiting, { ...createBudgets(), idleDeclined: true }), false);

  // it only reads
  const before = createBudgets();
  idleOffer(waiting, before);
  assert.deepEqual(before, createBudgets());
});

// ---- offerTakeback ----

test('offerTakeback: three per game, only for a punished un-commented loss of a piece or more', () => {
  const punished = { punishes: true, loss: 400, waited: false };
  assert.equal(offerTakeback(punished, createBudgets()), true);

  // a piece or more: 300 cp is the line
  assert.equal(offerTakeback({ ...punished, loss: 300 }, createBudgets()), true);
  assert.equal(offerTakeback({ ...punished, loss: 900 }, createBudgets()), true);
  assert.equal(offerTakeback({ ...punished, loss: 299 }, createBudgets()), false);
  assert.equal(offerTakeback({ ...punished, loss: 100 }, createBudgets()), false);
  // only when the rival's move punishes it
  assert.equal(offerTakeback({ ...punished, punishes: false }, createBudgets()), false);
  // only when the child confirmed before the strategist said anything
  assert.equal(offerTakeback({ ...punished, waited: true }, createBudgets()), false);

  // three per game: the director counts each offer it makes
  const b = createBudgets();
  let offers = 0;
  for (let i = 0; i < 8; i++) {
    if (offerTakeback(punished, b)) {
      b.takebacks += 1;
      offers += 1;
    }
  }
  assert.equal(offers, 3);
  assert.equal(offerTakeback(punished, { ...createBudgets(), takebacks: 2 }), true);
  assert.equal(offerTakeback(punished, { ...createBudgets(), takebacks: 3 }), false);
});

// ---- softCheck ----

test('softCheck within four plies', () => {
  // no check yet in this game: the first one gets the full treatment
  assert.equal(softCheck(0, createBudgets()), false);
  assert.equal(softCheck(37, createBudgets()), false);

  const b = { ...createBudgets(), lastCheckPly: 20 };
  for (const ply of [21, 22, 23, 24]) assert.equal(softCheck(ply, b), true, `ply ${ply}`);
  for (const ply of [25, 26, 40]) assert.equal(softCheck(ply, b), false, `ply ${ply}`);

  // a run of checks stays soft as long as the director moves the mark along (SPEC 5.8)
  const run = createBudgets();
  const soft = [10, 12, 14, 19, 21].map(ply => {
    const s = softCheck(ply, run);
    run.lastCheckPly = ply;
    return s;
  });
  assert.deepEqual(soft, [false, true, true, false, true]);
});

// ---- the Budgets record as the director shares it ----

test('each rule writes only its own counters of the Budgets record', () => {
  /** A record in the middle of a game: every counter differs from its start value where it can. */
  const used = () => ({
    questions: 2, lastQuestionAt: 9, ignored: 1, silentUntil: 3, ownWayTold: false, lastPopupAt: 6, brilliantPopups: 1, streak: 2,
    takebacks: 1, idleOffers: 1, idleDeclined: false, stamps: ['central_cannon'], lastCheckPly: 17, firstTrialTold: true, rivalLineAt: 4,
  });
  assert.deepEqual(Object.keys(used()), Object.keys(createBudgets()));

  /** The counters `act` changed, by name. */
  const changed = (act) => {
    const b = used();
    act(b);
    const before = used();
    return Object.keys(before).filter(key => JSON.stringify(b[key]) !== JSON.stringify(before[key])).sort();
  };

  // afterHeld: the ignored count, and at two the silence and the own-way mark
  assert.deepEqual(changed(b => afterHeld(b, 'confirmed', true, 12)), ['ignored', 'ownWayTold', 'silentUntil']);
  assert.deepEqual(changed(b => afterHeld(b, 'retracted', true, 12)), ['ignored']);
  assert.deepEqual(changed(b => afterHeld(b, 'confirmed', false, 12)), []);
  // praiseFor: the streak always; the popup clock (and the brilliant allowance) only with a popup
  assert.deepEqual(changed(b => praiseFor(played({ cat: 'brilliant' }), b, 12)), ['brilliantPopups', 'lastPopupAt', 'streak']);
  assert.deepEqual(changed(b => praiseFor(played(), b, 12)), ['lastPopupAt', 'streak']);
  assert.deepEqual(changed(b => praiseFor(played({ cat: 'brilliant' }), b, 8)), ['streak'], 'inside the popup window');
  assert.deepEqual(changed(b => praiseFor(played({ earned: false }), b, 12)), ['streak']);
  // stampFor: the list of stamped patterns, and only for a new one
  assert.deepEqual(changed(b => stampFor(['trough_horse'], null, b)), ['stamps']);
  assert.deepEqual(changed(b => stampFor(['central_cannon'], null, b)), []);
  assert.deepEqual(changed(b => stampFor(['heart_horse'], null, b)), []);
  // every other rule only reads: the director counts what it does itself (SPEC 5.8)
  assert.deepEqual(changed((b) => {
    voiceHeld(heldPacket(), b, 20);
    voiceHeld(heldPacket({ eval: { b: 'lost', mate: -1 } }), b, 20);
    idleOffer({ phase: 'childTurn', offeredHere: false }, b);
    offerTakeback({ punishes: true, loss: 400, waited: false }, b);
    softCheck(18, b);
  }), []);
});

test('marks that lie ahead of the game, as after an undo, never add speech: the formulas of 4.22 are not mirrored', () => {
  // An undo does not rewind the Budgets (SPEC 5.8, E-undo), so a mark can be later than the move now being played.
  const b = { ...createBudgets(), questions: 1, lastQuestionAt: 20, lastPopupAt: 20, lastCheckPly: 41 };

  for (const n of [12, 16, 20, 23]) assert.equal(voiceHeld(heldPacket(), b, n), false, `question at move ${n}`);
  assert.equal(voiceHeld(heldPacket(), b, 24), true);
  assert.equal(voiceHeld(heldPacket({ eval: { b: 'lost', mate: -1 } }), b, 12), true, 'a mate is voiced all the same');

  for (const n of [12, 16, 20, 23]) assert.equal(praiseFor(played(), b, n), null, `popup at move ${n}`);
  assert.equal(b.streak, 4, 'the moves still count for the streak');
  assert.deepEqual(praiseFor(played(), b, 24), { tier: 'good', streak: 5 });

  // softCheck is the printed body, `ply - lastCheckPly <= 4`: a check before the mark gets the quiet treatment
  assert.equal(softCheck(30, b), true);
  assert.equal(softCheck(45, b), true);
  assert.equal(softCheck(46, b), false);
});

test('random games driven the way the director scripts drive them keep the budgets of D-33 and D-34', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const rnd = mulberry32(seed);
    const b = createBudgets();
    const questions = [];
    const popups = [];
    let ownWay = 0;

    for (let n = 1; n <= 60; n++) {
      // one to three trials per move; the last one is confirmed (SPEC 5.8: E-trial, E-retract, E-commit)
      const trials = 1 + Math.floor(rnd() * 3);
      for (let t = 1; t <= trials; t++) {
        const held = rnd() < 0.5;
        const severe = held && rnd() < 0.15;
        const voiced = held && voiceHeld(heldPacket(severe ? { cat: 'blunder', eval: { b: 'lost', mate: -2 } } : {}), b, n);
        if (voiced) {
          b.questions += 1;
          b.lastQuestionAt = n;
          if (!severe) questions.push(n);
        }
        if (t < trials) {
          afterHeld(b, 'retracted', voiced, n);
          continue;
        }
        if (held && afterHeld(b, 'confirmed', voiced, n).sayOwnWay) ownWay += 1;
        const info = played({ earned: !held && rnd() < 0.6, cat: rnd() < 0.4 ? 'brilliant' : 'best', found: rnd() < 0.4,
                              hintMax: Math.floor(rnd() * 4), lead: rnd() < 0.5 ? 'fork' : 'develop' });
        const praise = praiseFor(info, b, n);
        if (praise) popups.push({ n, info, ...praise });
      }
    }

    // D-33: six ordinary questions a game, four moves apart; the own-way line once
    assert.ok(questions.length <= 6, `seed ${seed}: ${questions.length} ordinary questions`);
    for (let i = 1; i < questions.length; i++) assert.ok(questions[i] - questions[i - 1] >= 4, `seed ${seed}: questions at moves ${questions}`);
    assert.ok(ownWay <= 1, `seed ${seed}: the own-way line ${ownWay} times`);
    // D-34: popups four moves apart, only for earned moves; 神来之笔 twice; 主公英明！ only for a find with no pouch
    for (let i = 1; i < popups.length; i++) assert.ok(popups[i].n - popups[i - 1].n >= 4, `seed ${seed}: popups at moves ${popups.map(p => p.n)}`);
    assert.ok(popups.filter(p => p.tier === 'brilliant').length <= 2, `seed ${seed}`);
    for (const p of popups) {
      assert.equal(p.info.earned, true);
      if (p.tier === 'brilliant') assert.equal(p.info.cat, 'brilliant');
      if (p.tier === 'lord') assert.ok(p.info.found && p.info.hintMax === 0, `seed ${seed}, move ${p.n}`);
      assert.ok(p.streak >= 1 && p.streak <= p.n);
    }
    assert.ok(popups.length >= 3, `seed ${seed}: praise is not starved (${popups.length} popups in 60 moves)`);
  }
});

// ---- the contract's own examples ----

test('the worked examples of section 9 run through the policy', () => {
  const fixture = name => JSON.parse(readFileSync(new URL(`../../fixtures/coach/${name}.json`, import.meta.url), 'utf8'));
  const tryOf = name => fixture(name).events.find(event => event.kind === 'try').try;

  // 9.2: the child opens (no rival move in the brief); 9.3: 炮8平5 at ply 2
  assert.equal(shouldSpeakOpp(fixture('start').turn, 'smart'), true);
  assert.equal(shouldSpeakOpp(fixture('opp').turn, 'smart'), true);
  // the same rival move later in the game: its opening name still earns a sentence, its pawn threat alone does not
  const later = { ...fixture('opp').turn, ply: 20 };
  assert.equal(later.opp.name, 'same_cannons');
  assert.deepEqual(later.threats.map(t => t.sev), ['pawn']);
  assert.equal(shouldSpeakOpp(later, 'smart'), true);
  const { name: _name, ...unnamed } = later.opp;
  assert.equal(shouldSpeakOpp({ ...later, opp: unnamed }, 'smart'), false);
  assert.equal(shouldSpeakOpp({ ...later, opp: unnamed }, 'more'), true);
  // 9.8: the brief of a finished game
  assert.equal(shouldSpeakOpp(fixture('over').turn, 'smart'), false);

  // 9.5: 炮五进四 gives a cannon for a pawn (held, 350 cp): a guiding question, as long as the budget lasts
  const held = tryOf('try-held');
  assert.equal(held.held, true);
  assert.equal(held.cost.cp, -350);
  assert.equal(voiceHeld(held, createBudgets(), 2), true);
  assert.equal(voiceHeld(held, { ...createBudgets(), questions: 6 }, 2), false);
  assert.equal(voiceHeld(held, { ...createBudgets(), questions: 1, lastQuestionAt: 1 }, 2), false);
  // 9.6: an ordinary trial changes no material (cost null); the rule reads it without complaint
  const plain = tryOf('try');
  assert.equal(plain.cost, null);
  assert.equal(voiceHeld(plain, { ...createBudgets(), questions: 6 }, 2), false);
});

// ---- the import rule and purity (SPEC 2) ----

test('policy.js, rival.js and strings.js import core/codes.js only and reach for no clock, timer, DOM or random source', () => {
  for (const name of ['policy.js', 'rival.js', 'strings.js']) {
    const source = readFileSync(new URL(`../../../src/game/${name}`, import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const specifiers = [...code.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1] ?? m[2]);
    for (const specifier of specifiers) assert.equal(specifier, '../core/codes.js', `${name} imports ${specifier}`);
    if (name === 'policy.js') assert.deepEqual(specifiers, ['../core/codes.js']);

    for (const banned of ['Math.random', 'Date.now', 'new Date', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame',
                          'document', 'window', 'globalThis', 'localStorage', 'navigator', 'fetch(']) {
      assert.ok(!code.includes(banned), `${name} uses ${banned}`);
    }
    assert.ok(!/\bTODO\b|\bFIXME\b|not implemented/.test(source), `${name} has unfinished work`);
  }
});
