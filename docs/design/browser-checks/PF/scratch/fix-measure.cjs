const fs = require('fs');
let s = fs.readFileSync('pf-browser.mjs', 'utf8');
const a = "    for (let i = 0; i < 40 && taken === null; i++) {\n      await sleep(100);";
if (s.split(a).length !== 2) throw new Error('anchor');
s = s.replace(a, "    for (let i = 0; i < 12 && taken === null; i++) {\n      await sleep(i === 0 ? (reduced ? 360 : 560) : 400);                 // gaps above the guard: every tap is a tap of its own");
s = s.replace("console.log(`  the first tap on the board that is taken comes ${taken} ms after the tap on 开战！ (${reduced ? 'reduced' : 'full'} motion)`);",
              "console.log(`  taps on the board every 400 ms from ${reduced ? 360 : 560} ms after the tap on 开战！: the first one that is taken comes after ${taken} ms (${reduced ? 'reduced' : 'full'} motion)`);");
fs.writeFileSync('pf-browser.mjs', s);
