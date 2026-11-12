// PF: golden cases of tests/unit/coach/fallback.test.js, part 2: intent, danger prep, last (run once).
const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/coach/fallback.test.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 80)); s = s.replace(a, b); };

// intent: the rival voice
rep(`expect: ['对方这步的用意：对方的7路马出动。'] },`, `expect: ['对方这步的用意：7路马出动。'] },`);
rep(`    expect: ['对方这步的用意：对方的3路卒过了河，之后可以横走。不过对方刚才漏看了一步。'] },`,
    `    expect: ['对方这步的用意：3路卒过了河，之后可以横走。不过对方刚才漏看了一步。'] },
  // whose piece (CONTRACT-NOTES 138): in a sentence about the rival his own pieces are 自己的, and the piece that acts has no side word
  { name: 'ask intent: opp.does, a piece of his own is protected', row: 'ask.intent', turn: oppTurn({ move: '炮8进1', does: [{ k: 'defend', on: P('opp', 'P', 5) }] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方这步的用意：给自己的5路卒补上保护。'] },
  { name: 'ask intent: opp.does, his cannon behind his own pawn', row: 'ask.intent', events: [OPP_SILENT, ask('intent')],
    turn: oppTurn({ move: '炮8平5', does: [{ k: 'cannon_mount', by: P('opp', 'C', 5), on: P('me', 'P', 5), on2: P('opp', 'P', 5) }] }),
    expect: ['对方这步的用意：5路炮借自己的5路卒当炮架，瞄着你的五路兵。'] },
  { name: 'ask intent: opp.does, a piece of the child is attacked', row: 'ask.intent', turn: oppTurn({ move: '车9平8', does: [{ k: 'attack', by: P('opp', 'R', 8), on: P('me', 'H', 3) }] }), events: [OPP_SILENT, ask('intent')],
    expect: ['对方这步的用意：8路车捉你的三路马。'] },`);

// danger, a threat that does not stand yet: the sentence is about the rival, his piece has no side word
rep(`    attack: '要当心：对方想走【马6进5】，走完对方的6路马就能吃掉你的五路炮了。',
    cannon_mount: '要当心：对方想走【马6进5】，走完对方的6路马就能吃掉你的五路炮了。',
    check: '要当心：对方想走【马6进5】，走完就是将军。',
    fork: '要当心：对方想走【马6进5】，走完对方的6路马就同时捉住你的五路炮和另一个子了。',
    discovered: '要当心：对方想走【马6进5】，走完后面的子就打到你的五路炮了。',
    pin: '要当心：对方想走【马6进5】，走完对方的6路马就牵住你的五路炮了。',`,
`    attack: '要当心：对方想走【马6进5】，走完6路马就能吃掉你的五路炮了。',
    cannon_mount: '要当心：对方想走【马6进5】，走完6路马就能吃掉你的五路炮了。',
    check: '要当心：对方想走【马6进5】，走完就是将军。',
    fork: '要当心：对方想走【马6进5】，走完6路马就同时捉住你的五路炮和另一个子了。',
    discovered: '要当心：对方想走【马6进5】，走完后面的子就打到你的五路炮了。',
    pin: '要当心：对方想走【马6进5】，走完6路马就牵住你的五路炮了。',`);
rep(`events: [OPP_SILENT, ask('danger')], expect: ['要当心：对方想走【马6进5】，走完对方的6路马就将军，同时捉住你的五路炮。'] },`,
    `events: [OPP_SILENT, ask('danger')], expect: ['要当心：对方想走【马6进5】，走完6路马就将军，同时捉住你的五路炮。'] },`);

// last: what a mistake did is never added
rep(`expect: ['【炮五进四】是失误：你吃到一个卒，丢掉一个炮，算下来亏了。你的五路炮吃掉对方的5路卒。'] },`,
    `expect: ['【炮五进四】是失误：你吃到一个卒，丢掉一个炮，算下来亏了。'] },
  // ... also when the flaw is the reason: the effect would tell of a piece that may be gone (是漏着：你白丢一个车。你的五路车将军。)
  { name: 'ask last: mine.try, a blunder with a flaw whose piece gave check', row: 'ask.last', events: [OPP_SILENT, ask('last')],
    turn: turnWith({ mine: { move: '车五进三', cat: 'blunder', waited: true, self: true, try: { ...clone(MINE_BEST.try), move: '车五进三', cat: 'blunder', loss: 900,
      does: [{ k: 'check', by: P('me', 'R', 5) }], flaws: [{ k: 'hang', on: P('me', 'R', 5), by: P('opp', 'A', 4) }], cost: { gain: [], lose: ['R'], cp: -900 } } } }),
    expect: ['【车五进三】是漏着：你白丢一个车。'] },`);

fs.writeFileSync(p, s);
console.log('ok');
