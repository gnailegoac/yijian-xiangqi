const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/board.html';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 90)); s = s.replace(a, b); };
rep(`if (params.get('fx') === 'real') fx = (await import('../src/ui/fx.js')).createFx({ reducedMotion: params.get('motion') === 'reduced' });`,
`if (params.get('fx') === 'real') {                         // the real effects need their own stylesheet (package X3)
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '../styles/fx.css';
  document.head.append(link);
  fx = (await import('../src/ui/fx.js')).createFx({ reducedMotion: params.get('motion') === 'reduced' });
}`);
fs.writeFileSync(p, s);
