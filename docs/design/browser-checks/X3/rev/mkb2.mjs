// banners at hold time + popups near edges + stamps, full board snapshots
import { writeFileSync } from 'node:fs';
const [out, prefix] = process.argv.slice(2);
const items = [
  ['start', "__lab.fx.banner('start')", 400], ['check', "__lab.fx.banner('check',{tone:'mine',avoid:__lab.pt(2,4)})", 300], ['checkd', "__lab.fx.banner('check',{tone:'danger',avoid:__lab.pt(7,4)})", 300],
  ['mate', "__lab.fx.banner('mate')", 500], ['stale', "__lab.fx.banner('stalemate')", 400], ['lose', "__lab.fx.banner('lose')", 600], ['draw', "__lab.fx.banner('draw')", 600], ['river', "__lab.fx.banner('river')", 300],
  ['popTL', "(__lab.fx.popup('神来之笔！', __lab.pt(0,0), {tone:'brilliant'}), __lab.fx.popup('自己想的', __lab.pt(0,0), {tone:'mark'}))", 400],
  ['popTR', "(__lab.fx.popup('主公英明！', __lab.pt(0,8), {tone:'lord'}), __lab.fx.popup('自己想的', __lab.pt(0,8), {tone:'mark'}))", 400],
  ['popBL', "__lab.fx.popup('3连妙手！', __lab.pt(9,0), {tone:'great'})", 400],
  ['popmid', "__lab.fx.popup('好棋！', __lab.pt(5,4), {tone:'good'})", 400],
  ['stampfull', "__lab.fx.stamp('当头炮！', {size:'full'})", 500], ['stamp5', "__lab.fx.stamp('大胆穿心！', {size:'full'})", 500],
  ['stampsmallR', "__lab.fx.stamp('马后炮！', {size:'small', at:__lab.pt(1,8)})", 300], ['stampsmallL', "__lab.fx.stamp('双车错！', {size:'small', at:__lab.pt(0,0)})", 300],
];
const plan = [];
for (const [name, js, t] of items) { plan.push({ eval: `(__lab.fx.clear(), ${js})` }); plan.push({ scrub: t, snap: `${prefix}-${name}`, css: true }); }
plan.push({ eval: '__lab.fx.clear()' });
writeFileSync(out, JSON.stringify(plan));
