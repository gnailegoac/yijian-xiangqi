// PF: golden cases of tests/unit/coach/fallback.test.js that changed (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/coach/fallback.test.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 80)); s = s.replace(a, b); };

// ---- opp.chance, opp.name, opp.effect, opp.quiet
rep(`    expect: ['左翼好像露了破绽。', '左翼有文章可做。', '看看左翼，有机会。'] },
  { name: 'opp.name (section 9.3)', row: 'opp.name', turn: clone(F.opp.turn), events: clone(F.opp.events),
    expect: ['对方摆出了顺炮。', '这是顺炮。', '顺炮，常见的阵势。'] },
  { name: 'opp.effect', row: 'opp.effect', turn: oppTurn({ does: [{ k: 'develop', by: P('opp', 'H', 7) }, { k: 'defend', on: P('opp', 'P', 5) }] }), events: OPP_LAST,
    expect: ['对方的7路马出动。', '对方这步在出子。', '这步的用意：出子。', '司马懿这步是出子。', '对方在出子。', '出子，不可不看。'] },
  { name: 'opp.quiet', row: 'opp.quiet', turn: oppTurn({ move: '士4进5', does: [{ k: 'quiet' }] }), events: OPP_LAST,
    expect: ['对方稳稳地调了一步。', '对方在调整阵形。', '这步不急不躁。', '司马懿在布阵。', '对方先把阵脚站稳。', '平平常常的一步。'] },
  // a move that gave something up is not called steady or ordinary (稳稳地, 把阵脚站稳, 平平常常 give way)
  { name: 'opp.quiet, a move that left a hole', row: 'opp.quiet', turn: oppTurn({ move: '士4进5', quality: 'slip', does: [{ k: 'quiet' }] }), events: OPP_LAST,
    expect: ['对方在调整阵形。', '对方在调整阵形。', '这步不急不躁。', '司马懿在布阵。', '对方在调整阵形。', '对方在调整阵形。'] },
  { name: 'opp.quiet, a soft move', row: 'opp.quiet', turn: oppTurn({ move: '士4进5', quality: 'soft', does: [{ k: 'quiet' }] }), events: OPP_LAST,
    expect: ['对方在调整阵形。', '对方在调整阵形。', '这步不急不躁。', '司马懿在布阵。', '对方在调整阵形。', '对方在调整阵形。'] },
`,
`    expect: ['左翼好像露了破绽。', '左翼有文章可做。', '看看左翼，有机会。'] },
  // a chance in the child's own palace or back rows is told without its area (CONTRACT-NOTES 138): 己方九宫有文章可做 would
  // tell the child that their own palace holds a chance
  { name: 'opp.chance, in the child\\'s own palace', row: 'opp.chance', events: OPP_LAST,
    turn: oppTurn({ move: '卒3进1', quality: 'slip' }, { chance: { size: 'piece', theme: 'capture', area: 'my_palace' }, known: { threats: true, chance: true } }),
    expect: ['对方好像露了破绽。', '眼下有文章可做。', '找一找，有机会。'] },
  { name: 'opp.chance, in the child\\'s own back rows', row: 'opp.chance', events: OPP_LAST,
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
`);

// ---- pouch 1 for a chance that is not a free capture, a fork or the king
rep(`  { name: 'hint 1: otherwise', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'improve', theme: 'quiet' })], expect: ['哪个子待的位置最别扭？'] },`,
`  { name: 'hint 1: focus chance, a piece to attack', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'attack' })], expect: ['找一找：对方哪里有破绽？'] },
  { name: 'hint 1: focus chance, a pin', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'chance', theme: 'pin' })], expect: ['找一找：对方哪里有破绽？'] },
  { name: 'hint 1: otherwise', row: 'hint1', turn: base(), events: [OPP_SILENT, hintEvent(1, { focus: 'improve', theme: 'quiet' })], expect: ['哪个子待的位置最别扭？'] },`);

// ---- pouch 2 towards the child's own palace
rep(`  { name: 'hint 2: otherwise (section 9.4)', row: 'hint2', turn: base(), events: asLast(F.hint.events.slice(0, 3)), expect: ['看看你的二路马，机会在右翼。'] },`,
`  { name: 'hint 2: otherwise (section 9.4)', row: 'hint2', turn: base(), events: asLast(F.hint.events.slice(0, 3)), expect: ['看看你的二路马，机会在右翼。'] },
  // 机会在己方九宫 / 机会在己方底线 are not said (CONTRACT-NOTES 138)
  { name: 'hint 2: otherwise, the piece is headed for the child\\'s own palace', row: 'hint2', turn: base(),
    events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'improve', theme: 'quiet' })), hintEvent(2, { piece: P('me', 'A', 4), area: 'my_palace', theme: 'quiet' })],
    expect: ['看看你的四路仕，它有更好的去处。'] },
  { name: 'hint 2: otherwise, the piece is headed for the child\\'s own back rows', row: 'hint2', turn: base(),
    events: [OPP_SILENT, spoken(hintEvent(1, { focus: 'improve', theme: 'quiet' })), hintEvent(2, { piece: P('me', 'R', 1), area: 'my_back', theme: 'quiet' })],
    expect: ['看看你的一路车，它有更好的去处。'] },`);

// ---- try.missed without an area
rep(`    expect: ['【兵三进一】没危险，可左翼有个机会。', '别急，左翼还有便宜没占。', '【兵三进一】稳，但错过了左翼的机会。'] },`,
`    expect: ['【兵三进一】没危险，可左翼有个机会。', '别急，左翼还有便宜没占。', '【兵三进一】稳，但错过了左翼的机会。'] },
  // 可己方九宫有个机会 is not said (CONTRACT-NOTES 138): the area of the child's own palace or back rows is not named
  { name: 'try.missed, the better idea lies in the child\\'s own palace', row: 'try.missed', turn: base(),
    events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 160, does: [{ k: 'quiet' }], toward: { area: 'my_palace', theme: 'capture' }, chance: 'missed' })],
    expect: ['【兵三进一】没危险，可还有个机会没抓。', '别急，还有便宜没占。', '【兵三进一】稳，但错过了一个机会。'] },
  { name: 'try.missed, the announced chance lies in the child\\'s own back rows', row: 'try.missed',
    turn: turnWith({ chance: { size: 'piece', theme: 'capture', area: 'my_back' }, known: { threats: true, chance: true } }),
    events: [OPP_SILENT, tryEvent({ move: '兵三进一', cat: 'ok', loss: 160, does: [{ k: 'quiet' }], toward: null, chance: 'missed' })],
    expect: ['【兵三进一】没危险，可还有个机会没抓。', '别急，还有便宜没占。', '【兵三进一】稳，但错过了一个机会。'] },`);

fs.writeFileSync(p, s);
console.log('ok');
