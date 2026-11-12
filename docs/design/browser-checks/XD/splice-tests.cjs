// XD: puts new-tests.block.js into tests/unit/ui/audio-recipes.test.js, in front of the speech.js section.
// Run again after editing the block: the old copy is replaced.
const fs = require('fs');
const path = require('path');
const file = 'C:/Users/USERNAME/git/yijian-xiangqi/tests/unit/ui/audio-recipes.test.js';
const block = fs.readFileSync(path.join(__dirname, 'new-tests.block.js'), 'utf8').replace(/\r\n/g, '\n');
let s = fs.readFileSync(file, 'utf8');
if (s.includes('\r')) throw new Error('CRLF in the test file');
const end = `// ---------------------------------------------------------------------------------------------------------------------
// speech.js
// ---------------------------------------------------------------------------------------------------------------------`;
const head = `// ---------------------------------------------------------------------------------------------------------------------
// The first gesture (CONTRACT-NOTES M-121)`;
const b = s.indexOf(end);
if (b < 0) throw new Error('no speech section');
const a = s.indexOf(head);
s = (a >= 0 ? s.slice(0, a) : s.slice(0, b)) + block + s.slice(b);
fs.writeFileSync(file, s);
console.log('spliced', block.split('\n').length, 'lines; file now', s.split('\n').length, 'lines');
