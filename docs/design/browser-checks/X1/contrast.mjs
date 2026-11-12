const T = {
 chibi: { ink:'#eef2ff', ink2:'#9aa6c7', surface:'#19213a', surface2:'#222c4b', page:'#0b0f1d', edge:'#2f3b63', accent:'#ffb347', accentInk:'#2a1600', danger:'#ff6b5e', dangerInk:'#2a0a06',
   line:'#e0b56a', fieldA:'#1b2440', fieldB:'#10162b', redA:'#ff8a66', redB:'#d8402f', redC:'#8f1f14', redGlyph:'#fff3d6', blkA:'#5a6a8f', blkB:'#2a3552', blkC:'#141a2e', blkGlyph:'#eaf2ff', sel:'#ffd166', trial:'#ffb000', label:'#a98d58', frame:'#0a0d18', riverText:'#f0c27a', riverA:'#14324f', riverB:'#1f5a7a' },
 longzhong: { ink:'#232a22', ink2:'#5b6656', surface:'#fbfaf2', surface2:'#eff0e2', page:'#eef0e4', edge:'#cfd6c0', accent:'#2f7d4f', accentInk:'#ffffff', danger:'#b8281e', dangerInk:'#ffffff',
   line:'#4f5f45', fieldA:'#f2efdf', fieldB:'#e3e6cf', redA:'#e8604f', redB:'#c8362a', redC:'#8a1f16', redGlyph:'#fff6e2', blkA:'#4a5f55', blkB:'#27352f', blkC:'#131c18', blkGlyph:'#eef3ea', sel:'#1f6b3f', trial:'#8f4a00', label:'#55634a', frame:'#d9dcc2', riverText:'#4f5f45', riverA:'#cfd8c6', riverB:'#e6ebdc' },
 shachang: { ink:'#f6ead2', ink2:'#c2ae8a', surface:'#2b2219', surface2:'#3a2e21', page:'#1c1610', edge:'#5a4630', accent:'#e8a33d', accentInk:'#2a1700', danger:'#ff7a5c', dangerInk:'#2a0a06',
   line:'#4a2e10', fieldA:'#d9b77c', fieldB:'#c59d5f', redA:'#d9483a', redB:'#b3261a', redC:'#6e140d', redGlyph:'#ffeccc', blkA:'#4a423c', blkB:'#262220', blkC:'#100d0c', blkGlyph:'#f0e6d2', sel:'#7a1f12', trial:'#0b4f5a', label:'#e0c79a', frame:'#3a2a18', riverText:'#4a2e10', riverA:'#b88f52', riverB:'#cfa868' },
};
const lum = h => { const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const cr = (a,b) => { const la=lum(a), lb=lum(b); return ((Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05)); };
const f = x => x.toFixed(2);
for (const [name,t] of Object.entries(T)) {
  console.log(name);
  console.log('  ink/surface', f(cr(t.ink,t.surface)), 'ink/surface2', f(cr(t.ink,t.surface2)), 'ink/page', f(cr(t.ink,t.page)));
  console.log('  ink2/surface', f(cr(t.ink2,t.surface)), 'ink2/surface2', f(cr(t.ink2,t.surface2)), 'ink2/page', f(cr(t.ink2,t.page)));
  console.log('  accentInk/accent', f(cr(t.accentInk,t.accent)), ' dangerInk/danger', f(cr(t.dangerInk,t.danger)));
  console.log('  line/fieldA', f(cr(t.line,t.fieldA)), 'line/fieldB', f(cr(t.line,t.fieldB)));
  console.log('  redGlyph/redA', f(cr(t.redGlyph,t.redA)), 'redB', f(cr(t.redGlyph,t.redB)), 'redC', f(cr(t.redGlyph,t.redC)));
  console.log('  blkGlyph/blkA', f(cr(t.blkGlyph,t.blkA)), 'blkB', f(cr(t.blkGlyph,t.blkB)), 'blkC', f(cr(t.blkGlyph,t.blkC)));
  console.log('  sel/fieldA', f(cr(t.sel,t.fieldA)), 'sel/fieldB', f(cr(t.sel,t.fieldB)), 'trial/fieldA', f(cr(t.trial,t.fieldA)), 'trial/fieldB', f(cr(t.trial,t.fieldB)));
  console.log('  label/frame', f(cr(t.label,t.frame)), 'label/fieldA', f(cr(t.label,t.fieldA)), 'riverText/riverA', f(cr(t.riverText,t.riverA)), 'riverText/riverB', f(cr(t.riverText,t.riverB)));
  console.log('  ink/page', f(cr(t.ink,t.page)), 'accent/page', f(cr(t.accent,t.page)), 'accent/surface', f(cr(t.accent,t.surface)), 'danger/surface', f(cr(t.danger,t.surface)), 'edge/surface', f(cr(t.edge,t.surface)), 'edge/page', f(cr(t.edge,t.page)));
}
