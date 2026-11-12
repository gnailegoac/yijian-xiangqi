import fs from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/ui/buddy.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, b); };
rep(`<path d="M53.5 10 Q46 15 42 30 M66.5 10 Q74 15 78 30 M60 11.5 V25" fill="none" stroke="\${FOLD}" stroke-width="1.2" stroke-linecap="round"/>`,
    `<path d="M36.5 27.5 Q60 17.5 83.5 27.5 M55 11 Q46.5 13.5 41 21.5" fill="none" stroke="\${FOLD}" stroke-width="1.3" stroke-linecap="round"/>`);
rep(`listening: row('up',    'soft',  'gathered',  -18,   14,   40,   -5,    0,    0, -1.5,    0, []),`,
    `listening: row('up',    'soft',  'gathered',  -18,   14,   40,  -11,    0,    0, -3.5,    0, []),`);
rep(`thinking:  row('side',  'hmm',   'spread',   -148,   14,   28,    5,   -8,   10,    0,    0, ['dots']),`,
    `thinking:  row('side',  'hmm',   'spread',   -148,   14,    8,    5,   -8,   10,    0,    0, ['dots']),`);
rep(`worried:   row('side',  'wavy',  'gathered',   -6,   14,  172,    4,   16,  -16,   -1,    1, ['sweat']),`,
    `worried:   row('side',  'wavy',  'gathered',  -12,   14,  128,    4,   16,  -16,   -1,    1, ['sweat']),`);
rep(`cheering:  row('happy', 'cheer', 'spread',   -150,  150,  175,    0,    0,    0,   -3,   -2, ['blush', 'note']),`,
    `cheering:  row('happy', 'cheer', 'spread',   -144,  150,  181,    0,    0,    0,   -3,   -2, ['blush', 'note']),`);
fs.writeFileSync(p, s);
console.log('ok');
