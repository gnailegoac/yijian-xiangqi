// PF: tests/unit/coach/fallback.test.js part 5 and brief.test.js prep sentences (run once).
const fs = require('fs');
const rep = (s, a, b, all) => { const n = s.split(a).length - 1; if (n === 0 || (!all && n !== 1)) throw new Error(n + ' x ' + a.slice(0, 80)); return s.split(a).join(b); };

let p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/coach/fallback.test.js';
let s = fs.readFileSync(p, 'utf8');
s = rep(s, `  // 摆出了… and 常见的阵势 are said of openings; a tactic pattern is only named; an attacking formation is worded as an attack
  // and a weakness as a weakness (窝心马 is nothing the rival "set up", and it is not 常见的阵势)
  for (const name of PATTERN_CODES) {
    const texts = [0, 1, 2].map((v) => composeLocal(oppTurn({ name }), OPP_LAST, v));
    const opening = PATTERN_CODES.indexOf(name) < 9;
    const expected = opening ? [\`对方摆出了\${PATTERN_NAME[name]}。\`, \`这是\${PATTERN_NAME[name]}。\`, \`\${PATTERN_NAME[name]}，常见的阵势。\`]
      : name === 'empty_cannon' ? ['对方摆出了空头炮。', '这是空头炮。', '空头炮，厉害的攻势。']
        : name === 'heart_horse' ? ['对方走成了窝心马。', '这是窝心马。', '窝心马，是个弱点。']
          : [\`这是\${PATTERN_NAME[name]}。\`, \`这是\${PATTERN_NAME[name]}。\`, \`这是\${PATTERN_NAME[name]}。\`];
    assert.deepEqual(texts, expected, name);
    if (!opening) for (const text of texts) assert.doesNotMatch(text, /常见的阵势/, name);
  }
  // 露了破绽 is said of the rival's side of the board
  const own = oppTurn({ move: '卒3进1' }, { chance: { size: 'piece', theme: 'capture_free', area: 'my_palace' }, known: { threats: true, chance: true } });
  assert.deepEqual([0, 1, 2].map((v) => composeLocal(own, OPP_LAST, v)), ['己方九宫有文章可做。', '己方九宫有文章可做。', '看看己方九宫，有机会。']);`,
`  // The caption carries the name of the pattern, so the sentence never is the name alone (这是顺炮。 after 【炮8平5】顺炮):
  // 常见的阵势 is said of openings, an attacking formation is worded as an attack and a weakness as a weakness (窝心马 is
  // not 常见的阵势); the name of a tactic gets no sentence of its own
  for (const name of PATTERN_CODES) {
    const texts = [0, 1, 2].map((v) => composeLocal(oppTurn({ name, does: [] }), OPP_LAST, v));
    const opening = PATTERN_CODES.indexOf(name) < 9;
    const said = opening ? \`\${PATTERN_NAME[name]}，常见的阵势。\` : name === 'empty_cannon' ? '空头炮，厉害的攻势。' : name === 'heart_horse' ? '窝心马，是个弱点。' : null;
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
  }`);
s = rep(s, `  // a clause whose pieces are not in the packet is not a sentence of its own about a rival move
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'develop' }] }), OPP_LAST, 0), '对方这步在出子。');`,
`  // a clause whose pieces are not in the packet says no more than the caption: no line about that rival move
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'develop' }] }), OPP_LAST, 0), '');
  assert.equal(composeLocal(oppTurn({ does: [{ k: 'defend' }] }), OPP_LAST, 0), '');`);
fs.writeFileSync(p, s);

p = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/coach/brief.test.js';
s = fs.readFileSync(p, 'utf8');
s = rep(s, '走完对方的', '走完他的', true);
fs.writeFileSync(p, s);
console.log('ok');
