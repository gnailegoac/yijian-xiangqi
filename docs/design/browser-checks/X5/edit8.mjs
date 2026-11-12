import fs from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/ui/buddy.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };
rep(`  const a0 = axes[0] - w, a1 = axes[axes.length - 1] + w, r = R - tip;
  const down = \`M\${fanPoint(a0, 12)} L\${fanPoint(a0, r)} A\${r} \${r} 0 0 1 \${fanPoint(a1, r)} L\${fanPoint(a1, 12)} A12 12 0 0 0 \${fanPoint(a0, 12)} Z\`;`,
`  const a0 = axes[0], a1 = axes[axes.length - 1], r = R - tip, bulge = (12 + R) / 2 + 3;
  const down = \`M\${fanPoint(a0, 12)} Q\${fanPoint(a0 - w, bulge)} \${fanPoint(a0, r)} A\${r} \${r} 0 0 1 \${fanPoint(a1, r)} Q\${fanPoint(a1 + w, bulge)} \${fanPoint(a1, 12)} Z\`;`);
rep(` * The feather fan. The feathers and their quills are the ones of §11.2; behind them lie the down that fills the
 * gaps between the quills (a sector that ends \`tip\` units below the feather tips) and one ink outline around the
 * whole silhouette, so the white fan reads as one solid prop on a pale robe and on a pale page alike.`,
` * The feather fan. The feathers and their quills are the ones of §11.2; behind them lie the down that fills the
 * gaps between the quills (it follows the two outer feathers and ends \`tip\` units below the feather tips) and one
 * ink outline around the whole silhouette, so the white fan reads as one solid prop on a pale robe and on a pale
 * page alike.`);
rep("${fan([-104, -97, -90, -83, -76], 7, 40, 5)}", "${fan([-104, -97, -90, -83, -76], 7, 40, 3)}");
for (const m of ['idle', 'listening', 'thinking', 'curious', 'pleased', 'worried']) {
  const re = new RegExp(`(  ${m}:\s+row\('[a-z]+',\s+'[a-z]+',\s+'[a-z]+',\s+-?\d+,\s+)14,`);
  if (!re.test(s)) throw new Error('row ' + m);
  s = s.replace(re, '$120,');
}
fs.writeFileSync(p, s);
console.log('ok');
