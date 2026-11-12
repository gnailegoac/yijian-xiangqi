// Prints a run file of steps-tap.mjs: the summary (median / worst) and, with --runs, each run.
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const s of j.summaries ?? [j.summary]) {
  console.log(`== ${s.variant ?? ''}: ${s.page} page, ${s.input}, ${s.runs} fresh pages`);
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && 'median' in v) console.log(`  ${k.padEnd(34)} median ${String(v.median).padStart(7)}   worst ${String(v.worst).padStart(7)}   all ${JSON.stringify(v.all)}`);
    else if (Array.isArray(v)) console.log(`  ${k.padEnd(34)} ${JSON.stringify(v)}`);
  }
}
if (process.argv.includes('--runs')) {
  for (const r of j.runs) {
    console.log(`RUN ${r.run} ${r.variant ?? ''}`);
    for (const g of r.gesture) if (g.handlerMs >= 0.5 || g.type === 'pointerdown' || g.type === 'pointerup' || g.type === 'click') console.log('   ', g.type.padEnd(11), `at ${g.at}`, `handler ${g.handlerMs} ms`, g.ctorMs ? `ctor ${g.ctorMs} (${g.ctxState})` : '', g.convolverSets ? `convolver sets ${g.convolverSets} = ${g.convolverMs} ms` : '', g.offlineCtors ? `offline ctors ${g.offlineCtors}` : '', g.resumes ? `resume() x${g.resumes}` : '');
    console.log('    parts', JSON.stringify(r.parts));
    for (const k of ['unlockedEventAt', 'resumes', 'rendersStartedAt', 'renderMs', 'buffersReadyAt', 'audioTimers', 'audioTasks', 'tasksOver8', 'longtasks', 'unlockResolvedAt', 'resetAt', 'sourceBursts', 'play', 'errors']) if (r[k] !== undefined) console.log('   ', k, JSON.stringify(r[k]));
    const ev = r.eventEntries.filter(e => ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'keydown'].includes(e.name));
    console.log('    event entries', JSON.stringify(ev));
  }
}
