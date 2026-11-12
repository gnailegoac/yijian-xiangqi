const fs = require('fs');
const patch = (f, pairs) => {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { if (s.split(a).length !== 2) throw new Error(f + ': anchor ' + a.slice(0, 60)); s = s.replace(a, () => b); }
  fs.writeFileSync(f, s);
  console.log(f, 'patched');
};
const R = 'C:/Users/USERNAME/git/yijian-xiangqi/';
patch(R + 'src/ui/stage.js', [
  [`const CARD_BURST_MAX_MS = 2500;       // taps that keep coming while the card comes up hold what lies around it at most this long`,
   `const CARD_BURST_MAX_MS = 4000;       // taps that keep coming while the card comes up hold what lies around it at most this long
                                      // (after his mate the card is up two seconds after the move, and a finger that has
                                      // been tapping since then is not asking for a new game yet)`],
]);
patch(R + 'src/ui/hud.js', [
  [`const CARD_BURST_MAX_MS = 2500;`, `const CARD_BURST_MAX_MS = 4000;`],
]);
