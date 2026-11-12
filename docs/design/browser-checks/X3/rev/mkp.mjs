// node mkp.mjs <out.json> <prefix> — popups and stamps: scrub to a readable time
import { writeFileSync } from 'node:fs';
const [out, prefix] = process.argv.slice(2);
const T = '__lab.pt(3,4)';
const items = [
  ['good', `__lab.fx.popup('好棋！', ${T}, {tone:'good'})`, 300, [2.3, 4, 2.4, 2.1]],
  ['great', `__lab.fx.popup('妙计！', ${T}, {tone:'great'})`, 300, [2.3, 4, 2.4, 2.1]],
  ['brill', `__lab.fx.popup('神来之笔！', ${T}, {tone:'brilliant'})`, 300, [2.3, 4, 2.4, 2.1]],
  ['lord', `__lab.fx.popup('主公英明！', ${T}, {tone:'lord'})`, 300, [2.3, 4, 2.4, 2.1]],
  ['streak', `__lab.fx.popup('3连妙手！', ${T}, {tone:'great'})`, 300, [2.3, 4, 2.4, 2.1]],
  ['mark', `__lab.fx.popup('自己想的', ${T}, {tone:'mark'})`, 300, [2.3, 4, 2.4, 2.1]],
  ['lordmark', `(__lab.fx.popup('主公英明！', ${T}, {tone:'lord'}), __lab.fx.popup('自己想的', ${T}, {tone:'mark'}))`, 300, [2.3, 4, 2.4, 2.1]],
  ['greatmark', `(__lab.fx.popup('妙计！', ${T}, {tone:'great'}), __lab.fx.popup('自己想的', ${T}, {tone:'mark'}))`, 300, [2.3, 4, 2.4, 2.1]],
  ['stampfull', `__lab.fx.stamp('当头炮！', {size:'full'})`, 500, [2.8, 4, 4.6, 2.2]],
  ['stampsmall', `__lab.fx.stamp('马后炮！', {size:'small', at:${T}})`, 300, [2.3, 4, 2.4, 2.1]],
  ['stamp5', `__lab.fx.stamp('大胆穿心！', {size:'full'})`, 500, [2.8, 4, 4.6, 2.2]],
];
const plan = [];
for (const [name, js, t, around] of items) {
  plan.push({ eval: `(__lab.fx.clear(), ${js})` });
  plan.push({ scrub: t, snap: `${prefix}-${name}`, around, css: true });
}
plan.push({ eval: '__lab.fx.clear()' });
writeFileSync(out, JSON.stringify(plan));
