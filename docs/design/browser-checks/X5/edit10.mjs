import fs from 'node:fs';

const p = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/buddy.html';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };

rep(`let seq = 0;
let typer = null;
function stopTyper() { if (typer) { clearInterval(typer.timer); typer = null; buddy?.setSpeaking(false); } }`,
`let seq = 0;
let typer = null;
function stopTyper() { if (typer) { clearInterval(typer); typer = null; buddy?.setSpeaking(false); } }
/* scene steps that are still to come; a new scene, a bubble button or destroy() drops them */
let pending = [];
function later(fn, ms) { pending.push(setTimeout(() => { if (buddy) fn(); }, ms)); }
function dropPending() { pending.forEach(clearTimeout); pending = []; }`);

rep(`  const end = () => { el.parentElement.dataset.state = 'done'; el.parentElement.dataset.source = source; stopTyper(); };`,
    `  // like chat-panel: the end of a line is written on the bubble element (the container's parent)
  const end = () => { if (el.parentElement) { el.parentElement.dataset.state = 'done'; el.parentElement.dataset.source = source; } };`);
rep(`    if (reducedNow()) { queue.forEach(put); end(); return; }
    buddy.setSpeaking(true);
    typer = { timer: setInterval(() => { if (!queue.length) { end(); return; } put(queue.shift()); }, 25) };
  };
  if (delay) setTimeout(start, delay); else start();
  return id;`,
`    if (reducedNow()) { queue.forEach(put); end(); return; }
    buddy.setSpeaking(true);
    const mine = setInterval(() => {
      if (!el.isConnected) { clearInterval(mine); if (typer === mine) stopTyper(); return; }       // another line took the bubble
      if (queue.length) { put(queue.shift()); return; }
      end();
      clearInterval(mine);
      if (typer === mine) stopTyper();
    }, 25);
    typer = mine;
  };
  if (delay) later(start, delay); else start();
  return id;`);
rep(`$('#bubble-buttons').addEventListener('click', (e) => { const a = bubbleActions[e.target.dataset.b]; if (a) a(); });`,
    `$('#bubble-buttons').addEventListener('click', (e) => { const a = bubbleActions[e.target.dataset.b]; if (a) { dropPending(); a(); } });`);

rep(`    setTimeout(() => { buddy.setMood('impressed'); say(['马后炮！这一步连亮都没想到，小主公自己看出来了。'], { cue: '妙哉！' }); }, 450);
    setTimeout(() => buddy.setMood('idle'), 5200);`,
`    later(() => { buddy.setMood('impressed'); say(['马后炮！这一步连亮都没想到，小主公自己看出来了。'], { cue: '妙哉！' }); }, 450);
    later(() => buddy.setMood('idle'), 5200);`);
rep(`  good() { buddy.bubble.clear(); buddy.setMood('pleased', { hold: 1200 }); buddy.react('nod'); },`,
    `  good() { stopTyper(); buddy.bubble.clear(); buddy.setMood('pleased', { hold: 1200 }); buddy.react('nod'); },`);
rep(`    buddy.setMood('thinking');
    buddy.bubble.begin({ id: \`m\${++seq}\`, cue: null });
    setTimeout(() => { buddy.setMood('curious'); buddy.react('point');
      say(['对方会走', { move: '马7进5', color: 'black' }, '把炮吃掉，咱们只换到一个卒，亏了。'], {}); buddy.bubble.setQuestion(q); }, 1300);
    setTimeout(() => buddy.setMood('idle'), 6500);`,
`    buddy.setMood('thinking');
    stopTyper();
    buddy.bubble.begin({ id: \`m\${++seq}\`, cue: null });
    later(() => { buddy.setMood('curious'); buddy.react('point');
      say(['对方会走', { move: '马7进5', color: 'black' }, '把炮吃掉，咱们只换到一个卒，亏了。'], {}); buddy.bubble.setQuestion(q); }, 1300);
    later(() => buddy.setMood('idle'), 6500);`);
rep(`    buddy.setBaseMood('idle'); buddy.setMood('idle');
    buddy.bubble.status('对方正在想…');
    setTimeout(() => captionLine(), 900);
    setTimeout(() => say(['顺炮对阵！它的炮瞄着你的中兵。']), 1500);`,
`    buddy.setBaseMood('idle'); buddy.setMood('idle');
    stopTyper();
    buddy.bubble.clear();
    buddy.bubble.status('对方正在想…');
    later(() => captionLine(), 900);
    later(() => say(['顺炮对阵！它的炮瞄着你的中兵。']), 1500);`);
rep(`say(['哪个子还没有出动？看看它能去哪里。'], { cue: '主公请看——', source: 'local' }); setTimeout(() => buddy.setMood('idle'), 4500); },`,
    `say(['哪个子还没有出动？看看它能去哪里。'], { cue: '主公请看——', source: 'local' }); later(() => buddy.setMood('idle'), 4500); },`);
rep(`$('#scene-buttons').addEventListener('click', (e) => { const s = scenes[e.target.dataset.scene]; if (s && buddy) s(); });`,
    `$('#scene-buttons').addEventListener('click', (e) => { const s = scenes[e.target.dataset.scene]; if (s && buddy) { dropPending(); s(); } });`);
rep(`$('#destroy').addEventListener('click', () => { if (!buddy) return;`, `$('#destroy').addEventListener('click', () => { if (!buddy) return; dropPending(); stopTyper();`);
fs.writeFileSync(p, s);
console.log('ok');
