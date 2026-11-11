// tests/unit/coach/lexicon.test.js (C1) — contract section 4.11 (and the examples of sections 8 and 9 that use it).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STRATEGIST, SELF, CHILD, RIVAL, PIECE, EVAL, AREA, SIZE, TAG, FOCUS, QUALITY_NOTE,
  pieceName, matWords, balanceWords, amountWords, lossWords, gainWords, evalWords, netClause, lineText, effectClause, threatClause,
  takeawayClause, motifTerm,
} from '../../../src/coach/lexicon.js';
import {
  MOTIF_CODES, MOTIF_TERM, PATTERN_CODES, PATTERN_NAME, HABIT_CODES, HABIT_WORD, HABIT_FIX, STRENGTH_CODES, STRENGTH_WORD, NOTATION_RE,
} from '../../../src/core/codes.js';

/** The clause templates exactly as section 4.11 prints them. */
const TEMPLATES = {
  capture: '{by}吃掉{on}',
  capture_free: '{by}白吃{on}，吃完不会被吃回',
  trade: '{by}吃{on}，自己也会被吃回，等于兑子',
  check: '{by}将军',
  mate: '{by}形成绝杀',
  mate_threat: '{by}下一步就要将死，必须先解围',
  fork: '{by}同时捉住{on}和{on2}，只能救一个',
  discovered: '{by}一闪开，后面的{on2}就打到了{on}',
  pin: '{by}牵住了{on}，它一动后面的{on2}就丢',
  attack: '{by}捉{on}',
  defend: '给{on}补上保护',
  escape: '{by}躲开了攻击',
  block: '{by}垫在中间，挡住了对{on}的攻击',
  block_leg: '{by}蹩住了{on}的马腿',
  block_eye: '{by}塞住了{on}的象眼',
  open_rook: '给{on}亮出了通道',
  develop: '{by}出动',
  cannon_mount: '{by}借{on2}当炮架，瞄着{on}',
  restrict_king: '封住了{on}的一条退路',
  cross_river: '{by}过了河，之后可以横走',
  sacrifice: '弃掉{by}换取攻势',
  quiet: '调整了一下阵形',
  hang: '{on}没有保护，会被{by}白吃',
  unguard: '{by}一走，{on}就没人保护了',
  ignore_threat: '没有理会{by}对{on}的威胁',
  greedy: '{on}有{on2}保护，{by}吃了它会被吃回',
  bad_trade: '用{by}去换{on}，换亏了',
  miss_capture: '错过了白吃{on}的机会',
  miss_mate: '错过了一步杀棋',
  allow_mate: '这步走完，对方就有杀棋',
  walk_fork: '{by}一步就能同时捉住{on}和{on2}',
  walk_pin: '{on}会被{by}牵住，动不了',
  waste: '这步没有实际作用，白让对方走一步',
};

test('every motif has a term and a clause template', () => {
  assert.deepEqual(Object.keys(TEMPLATES).sort(), [...MOTIF_CODES].sort(), 'the table of section 4.11 covers MOTIF_CODES exactly');
  assert.equal(MOTIF_CODES.length, 33);

  // three pieces whose names are known from the pieceName examples of section 4.11
  const by = { s: 'me', t: 'H', f: 8 };
  const on = { s: 'opp', t: 'H', f: 7 };
  const on2 = { s: 'opp', t: 'C', f: 5 };
  const names = {
    brief: { by: '我方八路马', on: '对方7路马', on2: '对方5路炮' },
    child: { by: '你的八路马', on: '对方的7路马', on2: '对方的5路炮' },
  };
  for (const code of MOTIF_CODES) {
    // a term
    const term = motifTerm(code);
    assert.equal(term, MOTIF_TERM[code], code);
    assert.ok(term.length >= 2 && term.length <= 4, `${code}: the term is a short word`);

    // a clause template, filled in both voices
    for (const voice of ['brief', 'child']) {
      const n = names[voice];
      let expected = TEMPLATES[code].replaceAll('{by}', n.by).replaceAll('{on2}', n.on2).replaceAll('{on}', n.on);
      // in the child voice a clause says 对方的 once (CONTRACT-NOTES 138 and 147): of the two rival pieces of this effect
      // (`on` and `on2`) the one that is named second, right after the other, has no side word
      if (voice === 'child' && TEMPLATES[code].includes('{on}') && TEMPLATES[code].includes('{on2}')) {
        const second = TEMPLATES[code].indexOf('{on2}') > TEMPLATES[code].indexOf('{on}') ? n.on2 : n.on;
        expected = expected.replace(second, second.replace('对方的', ''));
      }
      assert.equal(effectClause({ k: code, by, on, on2 }, 'red', voice), expected, `${code} / ${voice}`);
      assert.doesNotMatch(expected, /[{}]/);
      // 对方的 once in the child's voice; the model's line (brief voice) keeps every side word
      if (voice === 'child') assert.ok((expected.match(/对方的/g) ?? []).length <= 1, `${code}: ${expected}`);
    }
    // a clause is a clause: no sentence end, no bracket
    assert.doesNotMatch(effectClause({ k: code, by, on, on2 }, 'red', 'child'), /[。！？【】]/);
  }

  // two spot checks written out in full
  assert.equal(effectClause({ k: 'fork', by, on, on2 }, 'red', 'child'), '你的八路马同时捉住对方的7路马和5路炮，只能救一个');
  assert.equal(effectClause({ k: 'fork', by, on, on2 }, 'red', 'brief'), '我方八路马同时捉住对方7路马和对方5路炮，只能救一个');
  assert.equal(effectClause({ k: 'greedy', by: { s: 'me', t: 'C', f: 5 }, on: { s: 'opp', t: 'P', f: 5 }, on2: { s: 'opp', t: 'H', f: 7 } }, 'red', 'brief'),
    '对方5路卒有对方7路马保护，我方五路炮吃了它会被吃回');

  // the clauses read correctly whichever side acts (the rival's move of section 9.5: 马8进7 develops and defends the central pawn)
  assert.equal(effectClause({ k: 'develop', by: { s: 'opp', t: 'H', f: 7 } }, 'red', 'brief'), '对方7路马出动');
  assert.equal(effectClause({ k: 'defend', on: { s: 'opp', t: 'P', f: 5 } }, 'red', 'brief'), '给对方5路卒补上保护');
  assert.equal(effectClause({ k: 'open_rook', on: { s: 'me', t: 'R', f: 1 } }, 'red', 'child'), '给你的一路车亮出了通道');
  // templates without a piece need none
  for (const code of ['quiet', 'miss_mate', 'allow_mate', 'waste']) assert.equal(effectClause({ k: code }, 'red', 'brief'), TEMPLATES[code]);

  // a pattern name on an effect does not change its clause
  assert.equal(effectClause({ k: 'check', by, name: 'horse_cannon' }, 'red', 'brief'), '我方八路马将军');

  // threatClause = effectClause({k, by, on})
  const net = { gain: [], lose: ['H'], cp: -400 };
  assert.equal(threatClause({ k: 'attack', by: on2, on: by, move: '炮5进4', net, sev: 'piece' }, 'red', 'brief'), '对方5路炮捉我方八路马');
  assert.equal(threatClause({ k: 'attack', by: on2, on: by, move: '炮5进4', net, sev: 'piece' }, 'red', 'child'), '对方的5路炮捉你的八路马');
  assert.equal(threatClause({ k: 'mate_threat', by: { s: 'opp', t: 'R', f: 2 }, move: '车2进9', net: { gain: [], lose: [], cp: -9999 }, sev: 'mate' }, 'red', 'brief'),
    '对方2路车下一步就要将死，必须先解围');
  // a Threat has no on2: the cannon threat of section 9.3 names the cannon and its target
  assert.equal(threatClause({ k: 'cannon_mount', by: { s: 'opp', t: 'C', f: 5 }, on: { s: 'me', t: 'P', f: 5 }, move: '炮5进4',
    net: { gain: [], lose: ['P'], cp: -100 }, sev: 'pawn' }, 'red', 'child'), '对方的5路炮瞄着你的五路兵');

  // a clause whose piece is missing never prints a hole: it falls back to the motif's term
  assert.equal(effectClause({ k: 'capture' }, 'red', 'child'), '吃子');
  assert.equal(effectClause({ k: 'fork' }, 'red', 'brief'), '捉双');
  assert.equal(effectClause({ k: 'pin', by }, 'red', 'child'), '牵制');
  for (const code of MOTIF_CODES) {
    for (const effect of [{ k: code }, { k: code, by }, { k: code, on }, { k: code, on2 }, { k: code, by, on }, { k: code, by, on2 }, { k: code, on, on2 }]) {
      for (const voice of ['brief', 'child']) {
        const clause = effectClause(effect, 'red', voice);
        assert.ok(clause.length >= 2, `${code}: never empty`);
        assert.doesNotMatch(clause, /[{}。！？【】]|undefined|null/, `${code}: ${clause}`);
      }
    }
  }
});

test('clauses for an effect that leaves a piece out on purpose, and for a king as the second piece (CONTRACT-NOTES 133)', () => {
  const by = { s: 'opp', t: 'H', f: 3 };
  const on = { s: 'me', t: 'R', f: 6 };
  const on2 = { s: 'me', t: 'C', f: 5 };
  const king = { s: 'me', t: 'K', f: 5 };
  const child = (effect) => effectClause(effect, 'red', 'child');
  const brief = (effect) => effectClause(effect, 'red', 'brief');

  // A Threat has no on2 (section 3.6): a fork, a discovered attack and a pin are told without their second piece. Without
  // it nothing is claimed about it: not 只能救一个 (the other target may be the king), not 后面的…就丢.
  assert.equal(child({ k: 'fork', by, on }), '对方的3路马同时捉住你的六路车和另一个子');
  assert.equal(brief({ k: 'fork', by, on }), '对方3路马同时捉住我方六路车和另一个子');
  assert.equal(child({ k: 'fork', by }), '对方的3路马同时捉住两个子');
  assert.equal(child({ k: 'discovered', by, on }), '对方的3路马一闪开，后面的子就打到了你的六路车');
  assert.equal(child({ k: 'pin', by, on }), '对方的3路马牵住了你的六路车，它不能随便动');
  assert.equal(child({ k: 'cannon_mount', by: { s: 'opp', t: 'C', f: 5 }, on }), '对方的5路炮瞄着你的六路车');
  const net = { gain: [], lose: ['R'], cp: -900 };
  assert.equal(threatClause({ k: 'fork', by, on, move: '马3进4', net, sev: 'rook', prep: true }, 'red', 'child'), '对方的3路马同时捉住你的六路车和另一个子');
  assert.equal(threatClause({ k: 'pin', by, on, move: '马3进4', net, sev: 'rook', prep: true }, 'red', 'brief'), '对方3路马牵住了我方六路车，它不能随便动');

  // No single piece does the damage: two pieces attacked by different pieces (the example of the task notes).
  assert.equal(child({ k: 'fork', on, on2 }), '你的六路车和你的五路炮同时被捉，只能救一个');
  assert.equal(brief({ k: 'fork', on, on2 }), '我方六路车和我方五路炮同时被捉，只能救一个');
  assert.equal(child({ k: 'walk_fork', on, on2 }), '你的六路车和你的五路炮会同时被捉');

  // The first flaw names no rival piece that does not play the reply: no attacker, no guard, no pinner.
  assert.equal(child({ k: 'hang', on }), '你的六路车没有保护，会被白吃');
  assert.equal(child({ k: 'ignore_threat', on }), '没有理会对你的六路车的威胁');
  assert.equal(child({ k: 'walk_pin', on }), '你的六路车会被牵住，动不了');
  const greedy = { k: 'greedy', by: { s: 'me', t: 'C', f: 5 }, on: { s: 'opp', t: 'P', f: 5 } };
  assert.equal(child(greedy), '对方的5路卒有保护，你的五路炮吃它不划算');
  assert.equal(brief(greedy), '对方5路卒有保护，我方五路炮吃它不划算');
  // with all its pieces every clause is the template of section 4.11
  // (in the child's voice with 对方的 once, CONTRACT-NOTES 147; the model's line keeps both side words)
  assert.equal(child({ ...greedy, on2: { s: 'opp', t: 'H', f: 7 } }), '对方的5路卒有7路马保护，你的五路炮吃了它会被吃回');
  assert.equal(brief({ ...greedy, on2: { s: 'opp', t: 'H', f: 7 } }), '对方5路卒有对方7路马保护，我方五路炮吃了它会被吃回');
  assert.equal(child({ k: 'hang', on, by }), '你的六路车没有保护，会被对方的3路马白吃');

  // A king as the second piece. A piece that shields its king cannot step away: 它一动后面的…将就丢 was false.
  const pin = { k: 'pin', by: { s: 'me', t: 'C', f: 8 }, on: { s: 'opp', t: 'E', f: 3 }, on2: { s: 'opp', t: 'K', f: 5 } };
  assert.equal(child(pin), '你的八路炮牵住了对方的3路象，它挡着将，不能走开');
  assert.equal(brief(pin), '我方八路炮牵住了对方3路象，它挡着对方将，不能走开');
  // the piece behind is of the side just named: the child reads it without a second 对方的 (CONTRACT-NOTES 138); the model's
  // line keeps both side words
  assert.equal(child({ ...pin, on2: { s: 'opp', t: 'R', f: 3 } }), '你的八路炮牵住了对方的3路象，它一动后面的3路车就丢');
  assert.equal(brief({ ...pin, on2: { s: 'opp', t: 'R', f: 3 } }), '我方八路炮牵住了对方3路象，它一动后面的对方3路车就丢');
  assert.equal(child({ k: 'pin', by: { s: 'opp', t: 'C', f: 2 }, on: { s: 'me', t: 'H', f: 8 }, on2: { s: 'me', t: 'R', f: 9 } }), '对方的2路炮牵住了你的八路马，它一动后面的你的九路车就丢');
  assert.equal(child({ k: 'discovered', by: { s: 'opp', t: 'H', f: 5 }, on: { s: 'me', t: 'K', f: 5 }, on2: { s: 'opp', t: 'C', f: 5 } }), '对方的5路马一闪开，后面的5路炮就打到了你的帅');
  // A fork that includes the king is a check that also attacks the other piece: nobody chooses to save the other one.
  assert.equal(child({ k: 'fork', by, on, on2: king }), '对方的3路马将军，同时捉住你的六路车');
  assert.equal(child({ k: 'fork', on, on2: king }), '将军的同时，你的六路车也被捉住');
  assert.equal(child({ k: 'walk_fork', by, on, on2: king }), '对方的3路马一步就能将军，同时捉住你的六路车');
  assert.equal(child({ k: 'walk_fork', on, on2: king }), '会被将军，同时你的六路车也被捉住');
  for (const text of [child(pin), child({ k: 'fork', by, on, on2: king }), child({ k: 'fork', on, on2: king }), child({ k: 'walk_fork', by, on, on2: king })]) {
    assert.doesNotMatch(text, /就丢|只能救一个|捉住.*[帅将]$/, text);
  }
  // A Threat has no on2 to show that the second target of a fork is the king: the fork's name says it (check_fork), and
  // the clause is the same check that also attacks the piece. Any other name leaves a clause as it is.
  assert.equal(threatClause({ k: 'fork', by, on, move: '马3进4', net, sev: 'rook', name: 'check_fork', prep: true }, 'red', 'child'), '对方的3路马将军，同时捉住你的六路车');
  assert.equal(threatClause({ k: 'fork', by, on, move: '马3进4', net, sev: 'rook', name: 'check_fork', prep: true }, 'red', 'brief'), '对方3路马将军，同时捉住我方六路车');
  assert.equal(threatClause({ k: 'fork', by, on, move: '马3进4', net, sev: 'rook', name: 'fork_two', prep: true }, 'red', 'child'), '对方的3路马同时捉住你的六路车和另一个子');
  assert.equal(child({ k: 'fork', by, on, on2, name: 'check_fork' }), '对方的3路马同时捉住你的六路车和你的五路炮，只能救一个');
  assert.equal(threatClause({ k: 'mate_threat', by, move: '马3进4', net, sev: 'mate', name: 'trough_horse' }, 'red', 'child'), '对方的3路马下一步就要将死，必须先解围');
  // other clauses with a king are the templates as printed (a king can be checked, squeezed, named)
  assert.equal(child({ k: 'restrict_king', on: king }), '封住了你的帅的一条退路');
  assert.equal(child({ k: 'cannon_mount', by: { s: 'opp', t: 'C', f: 5 }, on, on2: king }), '对方的5路炮借你的帅当炮架，瞄着你的六路车');
});

test('every pattern, habit and strength code has its word', () => {
  for (const code of PATTERN_CODES) {
    assert.equal(motifTerm(code), PATTERN_NAME[code], code);
    assert.ok(motifTerm(code).length >= 2, code);
    assert.equal(takeawayClause({ kind: 'idea', code }, 'red'), '可以学的一招：' + PATTERN_NAME[code]);
  }
  for (const code of HABIT_CODES) {
    assert.ok(HABIT_WORD[code].length > 0 && HABIT_FIX[code].length > 0, code);
    assert.ok(motifTerm(code).length >= 2, code);
    // the goal follows a dash (CONTRACT-NOTES 133): never two colons in one sentence, whatever the goal holds
    assert.equal(takeawayClause({ kind: 'habit', code }, 'red'), '下一盘的小目标——' + HABIT_FIX[code]);
    assert.ok((takeawayClause({ kind: 'habit', code }, 'red').match(/：/g) ?? []).length <= 1, code);
  }
  for (const code of STRENGTH_CODES) {
    assert.equal(motifTerm(code), STRENGTH_WORD[code], code);
    assert.equal(takeawayClause({ kind: 'strength', code }, 'red'), '长处：' + STRENGTH_WORD[code]);
  }

  // motifTerm = MOTIF_TERM ?? PATTERN_NAME ?? STRENGTH_WORD ?? HABIT_WORD
  assert.equal(motifTerm('fork'), '捉双');
  assert.equal(motifTerm('same_cannons'), '顺炮');
  assert.equal(motifTerm('S_finish'), '收尾干净利落');
  assert.equal(motifTerm('hang_piece'), '走完没检查自己的子有没有保护');
  assert.equal(motifTerm('miss_threat'), '没先看对方上一步的威胁');
  assert.equal(motifTerm('greedy'), '贪吃');                    // a motif and a habit: the motif term wins
  assert.equal(motifTerm('bad_trade'), '亏本兑子');
  assert.equal(motifTerm('fork_two'), '捉双');
  for (const unknown of ['nope', 'constructor', 'toString', '__proto__', '']) assert.equal(motifTerm(unknown), '');

  // the takeaway of section 9.8, with its example
  assert.equal(takeawayClause({ kind: 'habit', code: 'greedy', n: 2, ex: { n: 2, move: '炮五进四', better: '马二进三' } }, 'red'),
    '下一盘的小目标——吃子之前，先看它有没有保镖，例如第2回合【炮五进四】，换成【马二进三】更好');
  assert.equal(takeawayClause({ kind: 'strength', code: 'S_tactics', ex: { n: 18, move: '马三进四' } }, 'red'),
    '长处：抓战术机会很准，例如第18回合【马三进四】');
  assert.equal(takeawayClause({ kind: 'idea', code: 'horse_cannon', ex: { n: 30, move: '炮8进7', better: '马7进6' } }, 'black'),
    '可以学的一招：马后炮，例如第30回合【炮8进7】，换成【马7进6】更好');
});

test('pieceName in brief and child voice for both colours', () => {
  // the two examples of section 4.11
  assert.equal(pieceName({ s: 'opp', t: 'H', f: 7 }, 'red', 'brief'), '对方7路马');
  assert.equal(pieceName({ s: 'opp', t: 'H', f: 7 }, 'red', 'child'), '对方的7路马');
  assert.equal(pieceName({ s: 'me', t: 'H', f: 8 }, 'red', 'brief'), '我方八路马');
  assert.equal(pieceName({ s: 'me', t: 'H', f: 8 }, 'red', 'child'), '你的八路马');

  // the child plays black: its own files are Arabic, the rival's are 汉字, and the characters swap
  assert.equal(pieceName({ s: 'me', t: 'H', f: 8 }, 'black', 'brief'), '我方8路马');
  assert.equal(pieceName({ s: 'me', t: 'H', f: 8 }, 'black', 'child'), '你的8路马');
  assert.equal(pieceName({ s: 'opp', t: 'H', f: 7 }, 'black', 'brief'), '对方七路马');
  assert.equal(pieceName({ s: 'opp', t: 'H', f: 7 }, 'black', 'child'), '对方的七路马');

  // every piece type with the character of its owner's colour; every file numeral
  const red = { K: '帅', A: '仕', E: '相', H: '马', R: '车', C: '炮', P: '兵' };
  const black = { K: '将', A: '士', E: '象', H: '马', R: '车', C: '炮', P: '卒' };
  assert.deepEqual(PIECE, { red, black });
  const hanzi = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  for (const t of ['A', 'E', 'H', 'R', 'C', 'P']) {
    for (let f = 1; f <= 9; f++) {
      assert.equal(pieceName({ s: 'me', t, f }, 'red', 'brief'), `我方${hanzi[f - 1]}路${red[t]}`);
      assert.equal(pieceName({ s: 'opp', t, f }, 'red', 'child'), `对方的${f}路${black[t]}`);
      assert.equal(pieceName({ s: 'me', t, f }, 'black', 'child'), `你的${f}路${black[t]}`);
      assert.equal(pieceName({ s: 'opp', t, f }, 'black', 'brief'), `对方${hanzi[f - 1]}路${red[t]}`);
    }
  }

  // kings have no file
  assert.equal(pieceName({ s: 'me', t: 'K', f: 5 }, 'red', 'brief'), '我方帅');
  assert.equal(pieceName({ s: 'me', t: 'K', f: 5 }, 'red', 'child'), '你的帅');
  assert.equal(pieceName({ s: 'opp', t: 'K', f: 5 }, 'red', 'brief'), '对方将');
  assert.equal(pieceName({ s: 'opp', t: 'K', f: 4 }, 'red', 'child'), '对方的将');
  assert.equal(pieceName({ s: 'me', t: 'K', f: 5 }, 'black', 'child'), '你的将');
  assert.equal(pieceName({ s: 'opp', t: 'K', f: 6 }, 'black', 'brief'), '对方帅');

  // 前 / 中 / 后 when the side has two or more of the type on that file
  assert.equal(pieceName({ s: 'me', t: 'R', f: 2, q: 'front' }, 'red', 'brief'), '我方二路前车');
  assert.equal(pieceName({ s: 'me', t: 'P', f: 5, q: 'mid' }, 'red', 'child'), '你的五路中兵');
  assert.equal(pieceName({ s: 'opp', t: 'C', f: 8, q: 'back' }, 'red', 'child'), '对方的8路后炮');
  assert.equal(pieceName({ s: 'opp', t: 'P', f: 3, q: 'front' }, 'black', 'brief'), '对方三路前兵');
});

test('netClause / lineText / amountWords / lossWords tables', () => {
  // amountWords: 60–199, 200–349, 350–599, 600–1199, >= 1200
  const amounts = [[60, '大约一个兵'], [100, '大约一个兵'], [199, '大约一个兵'], [200, '大约一个士或象'], [349, '大约一个士或象'],
    [350, '大约一个马或炮'], [450, '大约一个马或炮'], [599, '大约一个马或炮'], [600, '大约一个车'], [900, '大约一个车'], [1199, '大约一个车'],
    [1200, '一个车以上'], [2000, '一个车以上'], [9999, '一个车以上']];
  for (const [cp, words] of amounts) assert.equal(amountWords(cp), words, String(cp));

  // lossWords: < 30, 30–59, >= 60
  const losses = [[0, '和最好的走法几乎一样'], [29, '和最好的走法几乎一样'], [30, '只差一点点'], [59, '只差一点点'], [60, '比最好的走法亏了大约一个兵'],
    [199, '比最好的走法亏了大约一个兵'], [200, '比最好的走法亏了大约一个士或象'], [350, '比最好的走法亏了大约一个马或炮'],
    [600, '比最好的走法亏了大约一个车'], [1200, '比最好的走法亏了一个车以上']];
  for (const [loss, words] of losses) assert.equal(lossWords(loss), words, String(loss));

  // gainWords
  assert.equal(gainWords(60), '比试走的这步好大约一个兵');
  assert.equal(gainWords(350), '比试走的这步好大约一个马或炮');                               // the alternative of section 9.5
  assert.equal(gainWords(1500), '比试走的这步好一个车以上');

  // balanceWords: |cp| < 60, then more / less in each voice
  assert.equal(balanceWords(0, 'brief'), '双方子力相当。');
  assert.equal(balanceWords(59, 'child'), '双方子力相当。');
  assert.equal(balanceWords(-59, 'brief'), '双方子力相当。');
  assert.equal(balanceWords(60, 'brief'), '我方多大约一个兵。');
  assert.equal(balanceWords(-60, 'brief'), '我方少大约一个兵。');
  assert.equal(balanceWords(1150, 'brief'), '我方多大约一个车。');                              // the game of section 9.8
  assert.equal(balanceWords(1150, 'child'), '你多大约一个车。');
  assert.equal(balanceWords(-450, 'child'), '你少大约一个马或炮。');
  assert.equal(balanceWords(-1300, 'brief'), '我方少一个车以上。');

  // matWords
  assert.equal(matWords('R2H2C2P5A2E2', 'red'), '车2 马2 炮2 兵5 仕2 相2');                      // the example of section 4.11
  assert.equal(matWords('R2H2C2P5A2E2', 'black'), '车2 马2 炮2 卒5 士2 象2');
  assert.equal(matWords('R1H1C1P2A2E2', 'red'), '车1 马1 炮1 兵2 仕2 相2');
  assert.equal(matWords('H1P1A1E1', 'black'), '马1 卒1 士1 象1');
  assert.equal(matWords('', 'red'), '');

  // evalWords
  assert.deepEqual(EVAL, { won: '胜势', better: '占优', even: '均势', worse: '落了下风', lost: '很危险' });
  for (const b of ['won', 'better', 'even', 'worse', 'lost']) assert.equal(evalWords({ b }), EVAL[b]);
  assert.equal(evalWords({ b: 'won', mate: 2 }), '2步之内可以将死对方');
  assert.equal(evalWords({ b: 'won', mate: 1 }), '1步之内可以将死对方');
  assert.equal(evalWords({ b: 'lost', mate: -3 }), '3步之内有被将死的危险');
  assert.equal(evalWords({ b: 'even', mate: 0 }), '均势');

  // netClause: both empty, gain only, lose only, both with the three balances; the lists use the owner's characters
  const none = { gain: [], lose: [], cp: 0 };
  assert.equal(netClause(none, 'red', 'brief'), '双方都没有丢子');
  assert.equal(netClause(none, 'black', 'child'), '双方都没有丢子');
  assert.equal(netClause({ gain: ['P'], lose: [], cp: 100 }, 'red', 'brief'), '我方白吃一个卒');
  assert.equal(netClause({ gain: ['P'], lose: [], cp: 100 }, 'red', 'child'), '你白吃一个卒');
  assert.equal(netClause({ gain: ['P'], lose: [], cp: 100 }, 'black', 'child'), '你白吃一个兵');
  assert.equal(netClause({ gain: [], lose: ['P'], cp: -100 }, 'red', 'brief'), '我方白丢一个兵');   // the threat of section 9.3
  assert.equal(netClause({ gain: [], lose: ['C'], cp: -450 }, 'black', 'child'), '你白丢一个炮');
  assert.equal(netClause({ gain: ['P'], lose: ['C'], cp: -350 }, 'red', 'brief'), '我方吃到一个卒，丢掉一个炮，算下来亏了');   // section 9.5
  assert.equal(netClause({ gain: ['P'], lose: ['C'], cp: -350 }, 'red', 'child'), '你吃到一个卒，丢掉一个炮，算下来亏了');
  assert.equal(netClause({ gain: ['R'], lose: ['H'], cp: 500 }, 'red', 'child'), '你吃到一个车，丢掉一个马，算下来赚了');
  assert.equal(netClause({ gain: ['R'], lose: ['H'], cp: 150 }, 'red', 'brief'), '我方吃到一个车，丢掉一个马，算下来赚了');
  assert.equal(netClause({ gain: ['R'], lose: ['H'], cp: -150 }, 'red', 'brief'), '我方吃到一个车，丢掉一个马，算下来亏了');
  assert.equal(netClause({ gain: ['H'], lose: ['C'], cp: -50 }, 'red', 'brief'), '我方吃到一个马，丢掉一个炮，大致相当');
  assert.equal(netClause({ gain: ['H'], lose: ['C'], cp: 149 }, 'red', 'brief'), '我方吃到一个马，丢掉一个炮，大致相当');
  assert.equal(netClause({ gain: ['H'], lose: ['C'], cp: -149 }, 'black', 'child'), '你吃到一个马，丢掉一个炮，大致相当');
  // lists read 一个炮、两个兵
  assert.equal(netClause({ gain: [], lose: ['C', 'P', 'P'], cp: -650 }, 'red', 'brief'), '我方白丢一个炮、两个兵');
  assert.equal(netClause({ gain: ['C', 'P', 'P'], lose: [], cp: 650 }, 'red', 'child'), '你白吃一个炮、两个卒');
  assert.equal(netClause({ gain: ['A', 'E', 'P', 'P', 'P'], lose: ['R'], cp: -200 }, 'black', 'brief'), '我方吃到一个仕、一个相、三个兵，丢掉一个车，算下来亏了');
  assert.equal(netClause({ gain: ['P', 'P', 'P', 'P', 'P', 'P'], lose: [], cp: 600 }, 'red', 'brief'), '我方白吃六个卒');
  assert.equal(netClause({ gain: ['P', 'H', 'P'], lose: [], cp: 600 }, 'red', 'brief'), '我方白吃两个卒、一个马');

  // lineText: the example of section 4.11 with the net of section 9.5
  assert.equal(lineText({ first: 'opp', moves: ['马7进5', '马八进七', '马2进3'], net: { gain: ['P'], lose: ['C'], cp: -350 }, end: 'quiet' }, 'red'),
    '对方【马7进5】→我方【马八进七】→对方【马2进3】，结果：我方吃到一个卒，丢掉一个炮，算下来亏了');
  assert.equal(lineText({ first: 'opp', moves: ['车9平8', '车一平二'], net: none, end: 'quiet' }, 'red'),
    '对方【车9平8】→我方【车一平二】，结果：双方都没有丢子');
  assert.equal(lineText({ first: 'me', moves: ['车一平二'], net: none, end: 'quiet' }, 'red'), '我方【车一平二】，结果：双方都没有丢子');
  assert.equal(lineText({ first: 'opp', moves: ['炮5进4'], net: { gain: [], lose: ['P'], cp: -100 }, end: 'check' }, 'red'),
    '对方【炮5进4】，结果：我方白丢一个兵，并将军');
  assert.equal(lineText({ first: 'me', moves: ['车二进七', '将5进1', '车二退一'], net: none, end: 'mate' }, 'red'),
    '我方【车二进七】→对方【将5进1】→我方【车二退一】，结果：双方都没有丢子，最后将死');

  // the other tables, literally
  assert.deepEqual([STRATEGIST, SELF, CHILD, RIVAL], ['诸葛亮', '亮', '小主公', '司马懿']);
  assert.deepEqual(AREA, { left: '左翼', center: '中路', right: '右翼', river: '河口', their_palace: '对方九宫', my_palace: '己方九宫',
    their_back: '对方底线', my_back: '己方底线' });
  assert.deepEqual(SIZE, { pawn: '一个兵', piece: '一个马或炮', rook: '一个车', mate: '一盘棋的胜负', position: '一点阵形上的便宜' });
  assert.deepEqual(TAG, { great: '好棋', slip: '失误', missed: '错过机会', punished: '被对方抓住了疏漏' });
  assert.deepEqual(FOCUS, { danger: '先看对方的威胁', chance: '找对方的破绽', develop: '出动还没出来的子', improve: '把位置别扭的子调好',
    finish: '把优势变成杀棋' });
  assert.deepEqual(QUALITY_NOTE, { strong: '这是一步强手。', normal: '', soft: '这步走得偏软。', slip: '这步有漏洞。' });
});

test('lineText lists every ply in order', () => {
  const moves = ['炮二平五', '马8进7', '马二进三', '车9平8', '车一平二', '前卒3进1'];
  const net = { gain: [], lose: [], cp: 0 };
  for (let n = 1; n <= moves.length; n++) {
    for (const first of ['me', 'opp']) {
      const text = lineText({ first, moves: moves.slice(0, n), net, end: 'quiet' }, 'red');
      const plies = [...text.matchAll(/(我方|对方)【([^】]+)】/g)];
      assert.deepEqual(plies.map((m) => m[2]), moves.slice(0, n), 'every move, in order');
      // the sides alternate, starting with `first`
      const sides = first === 'me' ? ['我方', '对方'] : ['对方', '我方'];
      assert.deepEqual(plies.map((m) => m[1]), moves.slice(0, n).map((_, k) => sides[k % 2]));
      assert.equal(text.split('→').length, n);
      assert.ok(text.endsWith('，结果：双方都没有丢子'));
      // every bracket holds exactly one notation, unchanged
      for (const m of plies) assert.match(m[2], NOTATION_RE);
    }
  }
});

test('the rival voice: in a sentence about the rival his own pieces are 自己的, and his piece that acts has no side word (CONTRACT-NOTES 138)', () => {
  const P = (s, t, f, q) => (q ? { s, t, f, q } : { s, t, f });
  // pieceName: the child's pieces are 你的 as in the child voice; the rival's are 自己的
  assert.equal(pieceName(P('opp', 'P', 5), 'red', 'rival'), '自己的5路卒');
  assert.equal(pieceName(P('opp', 'P', 5), 'black', 'rival'), '自己的五路兵');
  assert.equal(pieceName(P('opp', 'K', 5), 'red', 'rival'), '自己的将');
  assert.equal(pieceName(P('opp', 'C', 2, 'front'), 'red', 'rival'), '自己的2路前炮');
  assert.equal(pieceName(P('me', 'H', 3), 'red', 'rival'), '你的三路马');
  assert.equal(pieceName(P('me', 'H', 3), 'red', 'rival'), pieceName(P('me', 'H', 3), 'red', 'child'));
  // the two other voices are what they were
  assert.deepEqual([pieceName(P('opp', 'H', 7), 'red', 'brief'), pieceName(P('opp', 'H', 7), 'red', 'child')], ['对方7路马', '对方的7路马']);

  const clause = (effect, me = 'red') => effectClause(effect, me, 'rival');
  // 对方这步的用意：给自己的5路卒补上保护。 (the child voice reads 给对方的5路卒补上保护)
  assert.equal(clause({ k: 'defend', on: P('opp', 'P', 5) }), '给自己的5路卒补上保护');
  assert.equal(effectClause({ k: 'defend', on: P('opp', 'P', 5) }, 'red', 'child'), '给对方的5路卒补上保护');
  assert.equal(clause({ k: 'open_rook', on: P('opp', 'R', 8) }), '给自己的8路车亮出了通道');
  // the piece that acts continues the sentence without a side word; the child's pieces keep 你的
  assert.equal(clause({ k: 'develop', by: P('opp', 'H', 7) }), '7路马出动');
  assert.equal(clause({ k: 'attack', by: P('opp', 'R', 8), on: P('me', 'H', 3) }), '8路车捉你的三路马');
  assert.equal(clause({ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5), on2: P('opp', 'P', 5) }), '5路炮借自己的5路卒当炮架，瞄着你的五路兵');
  assert.equal(clause({ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5), on2: P('me', 'C', 5) }), '5路炮借你的五路炮当炮架，瞄着你的五路兵');
  assert.equal(clause({ k: 'unguard', by: P('opp', 'H', 7), on: P('opp', 'C', 3) }), '7路马一走，自己的3路炮就没人保护了');
  assert.equal(clause({ k: 'block', by: P('opp', 'E', 5), on: P('opp', 'R', 5) }), '5路象垫在中间，挡住了对自己的5路车的攻击');
  assert.equal(clause({ k: 'restrict_king', on: P('me', 'K', 5) }), '封住了你的帅的一条退路');
  // a piece of his that follows 后面的 has no side word either
  assert.equal(clause({ k: 'discovered', by: P('opp', 'H', 5), on: P('me', 'K', 5), on2: P('opp', 'C', 5) }), '5路马一闪开，后面的5路炮就打到了你的帅');
  assert.equal(clause({ k: 'pin', by: P('opp', 'C', 2), on: P('me', 'H', 8), on2: P('me', 'R', 9) }), '2路炮牵住了你的八路马，它一动后面的你的九路车就丢');
  // a flaw of a rival move: his piece that is lost is 自己的, the child's piece that takes it 你的
  assert.equal(clause({ k: 'hang', on: P('opp', 'H', 7), by: P('me', 'R', 3) }), '自己的7路马没有保护，会被你的三路车白吃');
  // ... but where a piece of the child is the subject of the clause, 自己的 would point at that piece: his pieces are 他的
  assert.equal(clause({ k: 'walk_fork', by: P('me', 'H', 4), on: P('opp', 'R', 3), on2: P('opp', 'C', 7) }), '你的四路马一步就能同时捉住他的3路车和他的7路炮');
  assert.equal(clause({ k: 'ignore_threat', by: P('me', 'R', 3), on: P('opp', 'H', 7) }), '没有理会你的三路车对他的7路马的威胁');
  // a black child: the rival is red, his files are written in 汉字
  assert.equal(clause({ k: 'defend', on: P('opp', 'P', 5) }, 'black'), '给自己的五路兵补上保护');
  assert.equal(clause({ k: 'attack', by: P('opp', 'R', 8), on: P('me', 'H', 3) }, 'black'), '八路车捉你的3路马');
  // the shorter templates and the term when a piece is missing, as in the other voices
  assert.equal(clause({ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5) }), '5路炮瞄着你的五路兵');
  assert.equal(clause({ k: 'defend' }), MOTIF_TERM.defend);
  assert.equal(threatClause({ k: 'attack', by: P('opp', 'R', 8), on: P('me', 'H', 3), move: '车9平8', net: { gain: [], lose: ['H'], cp: -400 }, sev: 'piece' }, 'red', 'rival'), '8路车捉你的三路马');
  // no clause of the rival voice says 对方的: the sentence it continues has said 对方 already
  for (const k of MOTIF_CODES) {
    for (const me of ['red', 'black']) {
      const text = clause({ k, by: P('opp', 'H', 8), on: P('opp', 'C', 7), on2: P('opp', 'R', 3) }, me);
      assert.doesNotMatch(text, /对方的/, `${k}: ${text}`);
      assert.doesNotMatch(text, /[{}]|undefined/, `${k}: ${text}`);
    }
  }
});

test('the child voice says 对方的 once in a clause: a rival piece named right after another has no side word (CONTRACT-NOTES 147)', () => {
  const P = (s, t, f, q) => (q ? { s, t, f, q } : { s, t, f });
  const child = (effect, me = 'red') => effectClause(effect, me, 'child');
  const brief = (effect, me = 'red') => effectClause(effect, me, 'brief');
  // the three clauses the polish package listed (fork, greedy, cannon), about the child's own move
  const fork = { k: 'fork', by: P('me', 'H', 3), on: P('opp', 'R', 7), on2: P('opp', 'C', 3) };
  assert.equal(child(fork), '你的三路马同时捉住对方的7路车和3路炮，只能救一个');
  const greedy = { k: 'greedy', by: P('me', 'C', 5), on: P('opp', 'P', 5), on2: P('opp', 'H', 7) };
  assert.equal(child(greedy), '对方的5路卒有7路马保护，你的五路炮吃了它会被吃回');
  const cannon = { k: 'cannon_mount', by: P('me', 'C', 5), on: P('opp', 'A', 4), on2: P('opp', 'P', 5) };
  assert.equal(child(cannon), '你的五路炮借对方的5路卒当炮架，瞄着4路士');
  // a fork without a single forking piece, and a pin on the piece that shields the king
  assert.equal(child({ k: 'fork', on: P('opp', 'R', 7), on2: P('opp', 'C', 3) }), '对方的7路车和3路炮同时被捉，只能救一个');
  assert.equal(child({ k: 'pin', by: P('me', 'R', 2), on: P('opp', 'H', 5), on2: P('opp', 'K', 5) }), '你的二路车牵住了对方的5路马，它挡着将，不能走开');
  // the same when the rival's piece acts (his cannon behind his own pawn): the second piece of his is bare
  assert.equal(child({ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5), on2: P('opp', 'P', 5) }), '对方的5路炮借5路卒当炮架，瞄着你的五路兵');
  // 前 / 后 and a black child (the rival's files are then written in 汉字): only the side word goes
  assert.equal(child({ ...fork, on2: P('opp', 'C', 3, 'front') }), '你的三路马同时捉住对方的7路车和3路前炮，只能救一个');
  assert.equal(child(fork, 'black'), '你的3路马同时捉住对方的七路车和三路炮，只能救一个');
  // a piece of the child between two of the rival's, or a single rival piece, keeps every side word
  assert.equal(child({ k: 'cannon_mount', by: P('me', 'C', 5), on: P('opp', 'P', 5), on2: P('me', 'P', 5) }), '你的五路炮借你的五路兵当炮架，瞄着对方的5路卒');
  assert.equal(child({ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('opp', 'A', 4), on2: P('me', 'P', 5) }), '对方的5路炮借你的五路兵当炮架，瞄着对方的4路士');
  assert.equal(child({ k: 'attack', by: P('me', 'R', 2), on: P('opp', 'H', 7) }), '你的二路车捉对方的7路马');
  // the child's own pieces are not touched (你的 … 你的 as before)
  assert.equal(child({ k: 'walk_fork', by: P('opp', 'H', 5), on: P('me', 'C', 8), on2: P('me', 'A', 6) }), '对方的5路马一步就能同时捉住你的八路炮和你的六路仕');
  // the model's line (brief voice) is unchanged: every piece carries its side
  assert.equal(brief(fork), '我方三路马同时捉住对方7路车和对方3路炮，只能救一个');
  assert.equal(brief(greedy), '对方5路卒有对方7路马保护，我方五路炮吃了它会被吃回');
  assert.equal(brief(cannon), '我方五路炮借对方5路卒当炮架，瞄着对方4路士');
  // over every motif: with the rival's pieces as `on` and `on2` (the child acts) no clause says 对方的 twice
  for (const k of MOTIF_CODES) {
    for (const me of ['red', 'black']) {
      const text = child({ k, by: P('me', 'H', 8), on: P('opp', 'C', 7), on2: P('opp', 'R', 3) }, me);
      assert.ok((text.match(/对方的/g) ?? []).length <= 1, `${k}: ${text}`);
      assert.doesNotMatch(text, /[{}]|undefined/, `${k}: ${text}`);
    }
  }
});
