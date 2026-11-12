import test from 'node:test';
import { createAudio, bedVoices } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/ui/audio.js';
class P { constructor(v){this.value=v;} setValueAtTime(){return this} linearRampToValueAtTime(){return this} exponentialRampToValueAtTime(){return this} setTargetAtTime(){return this} cancelScheduledValues(){return this} }
class N { constructor(c,k){this.context=c;this.kind=k;} connect(x){return x} disconnect(){} }
class S extends N { constructor(c,k){super(c,k);this.startAt=null;this.stopAt=Infinity;} start(t=0){this.startAt=t;this.context.started.push(this)} stop(t=0){this.stopAt=t} }
class C { constructor(){this.currentTime=0;this.sampleRate=44100;this.started=[];this.destination=new N(this,'d');this.state='running';C.i=this}
 createGain(){return Object.assign(new N(this,'g'),{gain:new P(1)})} createBiquadFilter(){return Object.assign(new N(this,'b'),{frequency:new P(1),Q:new P(1)})}
 createDynamicsCompressor(){return Object.assign(new N(this,'c'),{threshold:new P(1),knee:new P(1),ratio:new P(1),attack:new P(1),release:new P(1)})}
 createConvolver(){return new N(this,'cv')} createOscillator(){return Object.assign(new S(this,'o'),{frequency:new P(1)})} createBufferSource(){return Object.assign(new S(this,'bs'),{})}
 createBuffer(c,l,sr){return {getChannelData:()=>new Float32Array(l),duration:l/sr}} addEventListener(){} removeEventListener(){} resume(){return Promise.resolve()} suspend(){return Promise.resolve()} close(){return Promise.resolve()} }
test('dbg', async t => {
  globalThis.AudioContext = C; globalThis.OfflineAudioContext = undefined;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0);
  const a = createAudio(); await a.unlock(); const ctx = C.i;
  a.setTension(1); a.music.start();
  for (let i = 0; i < 800; i++) { ctx.currentTime = Math.round((ctx.currentTime + 0.05) * 1e6) / 1e6; t.mock.timers.tick(50); }
  const ev = [];
  for (const s of ctx.started) if (s.stopAt > s.startAt) { ev.push([s.startAt, 1, s]); ev.push([s.stopAt, -1, s]); }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let n = 0, max = 0, at = 0; const live = new Set();
  let snapshot = null;
  for (const [tt, d, s] of ev) { n += d; if (d > 0) live.add(s); else live.delete(s); if (n > max) { max = n; at = tt; snapshot = [...live].map(x => `${x.kind}@${x.startAt.toFixed(4)}-${x.stopAt === Infinity ? 'inf' : x.stopAt.toFixed(4)}`); } }
  console.log('peak', max, 'at', at, 'step', (at - 0.06) / 0.15625, 'bedVoices', bedVoices(1));
  console.log(snapshot.join('\n'));
});
