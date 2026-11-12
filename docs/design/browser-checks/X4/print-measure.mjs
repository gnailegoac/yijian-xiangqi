// Prints measure.json (written by steps-measure.mjs) as plain tables.
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(new URL(process.argv[2] ?? './measure.json', import.meta.url), 'utf8'));
const f = x => (x == null || !Number.isFinite(x) ? '    —' : x.toFixed(1).padStart(6));
console.log('ok', r.ok, '| problems', JSON.stringify(r.problems), '| prerender ms', r.prerenderMs, '| lead s', r.lead, '| wall ms', r.wallMs, r.error ?? '');
console.log('name'.padEnd(28), 'src', '  cold', 'contr', '  diff', '   ms', 'contr', '| in play: worst', 'chibi', '  late', '    lz', '    sc', ' ms');
for (const s of r.sfx) {
  console.log(s.name.padEnd(28), String(s.sources).padStart(3), f(s.peak), f(s.contractPeak), f(s.contractPeak == null ? null : s.peak - s.contractPeak),
    String(s.ms).padStart(5), String(s.contractMs ?? '—').padStart(5), '|         ', f(s.worst), f(s.chibi), f(s.chibiLate), f(s.longzhong), f(s.shachang), String(s.msInPlay).padStart(5));
}
console.log('--- bed');
for (const b of r.bed) {
  console.log(b.label.padEnd(14), 'bpm', f(b.bpm), 'rms4', f(b.rms), 'like', f(b.rmsLikeContract), 'contract', f(b.contract), 'peak', f(b.peak), 'live', b.live, 'model', b.model,
    '| lz rms', f(b.longzhong), 'peak', f(b.peakLongzhong), 'live', b.liveLongzhong, '| sc rms', f(b.shachang), 'peak', f(b.peakShachang), 'live', b.liveShachang);
}
console.log('--- mix');
for (const m of r.mix) console.log((m.extreme ? '(extreme) ' : '') + m.label.padEnd(44), f(m.chibi), f(m.longzhong), f(m.shachang), 'contract', f(m.contract));
