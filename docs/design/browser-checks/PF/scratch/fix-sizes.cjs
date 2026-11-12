const fs = require('fs');
let s = fs.readFileSync('pf-browser.mjs', 'utf8');
const a = "  for (const size of ['L', 'P', 'C']) {\n    for (const [mode, save, button] of";
if (s.split(a).length !== 2) throw new Error('anchor');
s = s.replace(a, "  for (const size of (process.env.PF_SIZES ?? 'L,P,C').split(',')) {\n    for (const [mode, save, button] of");
fs.writeFileSync('pf-browser.mjs', s);
