import fs from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/styles/buddy.css';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };
rep(`  background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--wei) 62%, var(--surface-2)), var(--surface) 78%);`,
    `  background: radial-gradient(circle at 50% 26%, color-mix(in srgb, var(--wei) 72%, #fff), var(--wei) 52%, color-mix(in srgb, var(--wei) 62%, #000) 100%);`);
fs.writeFileSync(p, s);
console.log('ok');
