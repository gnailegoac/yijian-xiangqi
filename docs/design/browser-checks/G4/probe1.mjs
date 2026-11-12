import { createDirectorRig } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/tests/helpers/fake-ports.js';
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e); process.exitCode = 2; });
const rig = createDirectorRig();
const ref = (a, b, c, d) => ({ from: { row: a, col: b }, to: { row: c, col: d } });
const replies = [ref(0, 1, 2, 2), ref(2, 2, 0, 1)];
let k = 0;
rig.script.opponent = () => ({ move: replies[k++ % 2] });
rig.session.newGame({ humanColor: 'red' });
await rig.settle();
async function play(a, b, c, d) {
  rig.actions.tap(a, b, 'tap'); rig.actions.tap(c, d, 'tap'); await rig.settle();
  const t = rig.state.trial; console.log('trial', t?.notation, t?.repeat);
  rig.actions.confirm(); await rig.settle(); await rig.advance(1200);
  console.log('after', rig.state.phase, rig.state.history.map(p => p.notation).join(' '));
}
await play(9, 7, 7, 6);
await play(7, 6, 9, 7);
await play(9, 7, 7, 6);
await play(7, 6, 9, 7);
console.log(rig.stage.model.locals.map(l => l.text));
console.log('violations', rig.coach.violations);
rig.director.dispose(); rig.tasks.dispose();
