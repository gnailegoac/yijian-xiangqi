import { computeLayout } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/ui/layout.js';
const rows = [[1180,820],[1024,768],[1366,1024],[1440,900],[1920,1080],[1180,820,420],[820,1180],[768,1024],[820,1180,780],[360,560],[360,640],[360,740],[390,844],[844,390]];
for (const [W,H,vis] of rows) {
  const r = computeLayout({W,H,visibleH: vis ?? H, sheet:false});
  console.log(`${W}x${H}${vis?` kb(${vis})`:''} | ${r.layout} | c ${r.c.toFixed(2)} | Ø ${(r.c*0.88).toFixed(1)} | ${Math.round(r.boardW)} x ${Math.round(r.boardH)} | ${r.panelW} / ${Math.round(r.coachH*100)/100} | ${r.buddyH} ${r.buddy} | chips ${r.showChips ? r.chipRows : 'hidden'} | top ${r.top} bar ${r.bar} act ${r.actions} pad ${r.pad} gap ${r.gap} mini ${r.miniH} scale ${r.stageScale}`);
}
