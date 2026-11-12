const fs = require('fs'); const f = 'C:/Users/USERNAME/git/yijian-xiangqi/styles/fx.css'; let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };
rep(`  --rim: #0b0f1d;                                    /* outline colour */
  --rim-w: .055em;
  color: #ffd166;
}`, `  --rim: #0b0f1d;                                    /* outline colour */
  --rim-w: .055em;
  --rim-2: transparent;                              /* a second, outer line (only where the first is light) */
  --rim-2w: calc(1.9 * var(--rim-w));
  color: #ffd166;
}`);
rep(`    calc(.7 * var(--rim-w)) calc(-.7 * var(--rim-w)) 0 var(--rim), calc(-.7 * var(--rim-w)) calc(-.7 * var(--rim-w)) 0 var(--rim),
    0 .1em .08em #000a;`, `    calc(.7 * var(--rim-w)) calc(-.7 * var(--rim-w)) 0 var(--rim), calc(-.7 * var(--rim-w)) calc(-.7 * var(--rim-w)) 0 var(--rim),
    var(--rim-2w) 0 0 var(--rim-2), calc(-1 * var(--rim-2w)) 0 0 var(--rim-2),
    0 var(--rim-2w) 0 var(--rim-2), 0 calc(-1 * var(--rim-2w)) 0 var(--rim-2),
    calc(.7 * var(--rim-2w)) calc(.7 * var(--rim-2w)) 0 var(--rim-2), calc(-.7 * var(--rim-2w)) calc(.7 * var(--rim-2w)) 0 var(--rim-2),
    calc(.7 * var(--rim-2w)) calc(-.7 * var(--rim-2w)) 0 var(--rim-2), calc(-.7 * var(--rim-2w)) calc(-.7 * var(--rim-2w)) 0 var(--rim-2),
    0 .1em .08em #000a;`);
rep(`.fx-popup[data-tone="brilliant"] { --rim: #ffffff; --rim-w: .05em; }                    /* gold, white outline */
.fx-popup[data-tone="brilliant"] .fx-popup__text {
  -webkit-text-stroke: .012em #6b3a00;               /* keeps the gold apart from its white rim */
}`, `/* gold, white outline; a dark hairline inside and a dark line outside keep both apart from a light board */
.fx-popup[data-tone="brilliant"] { --rim: #ffffff; --rim-w: .045em; --rim-2: #3a1c00; }
.fx-popup[data-tone="brilliant"] .fx-popup__text { -webkit-text-stroke: .012em #6b3a00; }`);
fs.writeFileSync(f, s);
