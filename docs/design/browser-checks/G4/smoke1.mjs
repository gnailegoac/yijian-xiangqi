import { createDirectorRig } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/tests/helpers/fake-ports.js';

process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e); process.exitCode = 2; });
const rig = createDirectorRig();
const show = (label, from) => { console.log(`--- ${label}`); console.log(rig.since(from).join('\n')); };
let m = rig.mark();
rig.session.newGame({ humanColor: 'red' });
await rig.settle();
show('newGame', m); m = rig.mark();
rig.actions.tap(7, 7, 'tap');     // cannon
await rig.settle();
show('select', m); m = rig.mark();
rig.actions.tap(7, 4, 'tap');     // 炮二平五
await rig.settle();
show('trial', m); m = rig.mark();
await rig.advance(700);
show('after 700ms', m); m = rig.mark();
rig.actions.confirm();
await rig.settle();
show('confirm', m); m = rig.mark();
await rig.advance(1000);
show('after 1000ms', m); m = rig.mark();
console.log('phase', rig.state.phase, 'plies', rig.state.history.length, 'violations', rig.coach.violations, 'locals', rig.stage.model.locals.map(l => l.text));
console.log('lines', rig.stage.model.lines.map(l => `${l.kind}:${l.cue}:${l.text}:${l.end?.source}`));
rig.director.dispose(); rig.tasks.dispose();
