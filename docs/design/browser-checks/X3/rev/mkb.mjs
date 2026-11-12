// node mkb.mjs <out.json> <prefix> — banners: scrub to several times
import { writeFileSync } from 'node:fs';
const [out, prefix, which] = process.argv.slice(2);
const B = { start: ["__lab.fx.banner('start')", [60, 140, 400, 950]], checkm: ["__lab.fx.banner('check',{tone:'mine',avoid:__lab.pt(0,4)})", [50, 110, 300, 760]],
  checkd: ["__lab.fx.banner('check',{tone:'danger',avoid:__lab.pt(9,4)})", [300]], mate: ["__lab.fx.banner('mate')", [60, 150, 500, 1250]],
  stale: ["__lab.fx.banner('stalemate')", [400]], lose: ["__lab.fx.banner('lose')", [100, 600, 1350]], draw: ["__lab.fx.banner('draw')", [600]], river: ["__lab.fx.banner('river')", [60, 300, 640]] };
const plan = [];
for (const k of (which ? which.split(',') : Object.keys(B))) {
  const [js, times] = B[k];
  plan.push({ eval: `(__lab.fx.clear(), ${js})` });
  for (const t of times) plan.push({ scrub: t, snap: `${prefix}-${k}-${String(t).padStart(4, '0')}`, css: true });
}
plan.push({ eval: '__lab.fx.clear()' });
writeFileSync(out, JSON.stringify(plan));
