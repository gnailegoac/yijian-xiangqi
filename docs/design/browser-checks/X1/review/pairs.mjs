import { readFileSync } from 'node:fs';
const css = readFileSync('C:/Users/USERNAME/git/yijian-xiangqi/styles/themes.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const themes = {};
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim();
  const t = /data-theme="(\w+)"/.exec(sel)?.[1];
  if (!t || !m[2].includes('--page')) continue;
  themes[t] = Object.fromEntries(m[2].split(';').map(p => p.split(':').map(s => s.trim())).filter(p => p.length === 2));
}
const rgb = h => { const d = h.length <= 5 ? [...h.slice(1)].map(x => x + x).join('') : h.slice(1); return [0, 2, 4].map(i => parseInt(d.slice(i, i + 2), 16)); };
const lum = h => { const [r, g, b] = rgb(h).map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
const pairs = [['--label', '--field-a'], ['--label', '--field-b'], ['--label', '--frame'], ['--danger', '--field-a'], ['--danger', '--field-b'], ['--river-text', '--field-b'],
  ['--ink', '--page'], ['--ink-2', '--page'], ['--ink-2', '--surface-2'], ['--ink', '--surface-2'], ['--accent', '--surface'], ['--accent', '--page'], ['--edge', '--page'], ['--edge', '--surface'],
  ['--arrow-hint', '--field-b'], ['--arrow-idea', '--field-b'], ['--arrow-threat', '--field-b'], ['--arrow-reply', '--field-b'], ['--arrow-reply', '--field-a'], ['--arrow-idea', '--field-a'],
  ['--blk-rim', '--field-a'], ['--red-rim', '--field-a'], ['--fx-cool', '--surface'], ['--surface', '--page']];
for (const [a, b] of pairs) console.log(`${a} on ${b}`.padEnd(34), Object.keys(themes).map(t => `${t} ${cr(themes[t][a], themes[t][b])}`).join('   '));
