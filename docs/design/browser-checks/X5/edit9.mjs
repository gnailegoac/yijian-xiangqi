import fs from 'node:fs';

const p = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/buddy.html';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };

// 1. the harness code becomes a function; a second mode shows the component inside the real shell
rep(`const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const root = document.documentElement;
`, `const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const root = document.documentElement;

if (params.has('shell')) shell(); else harness();

function harness() {
`);
rep(`setMock(['landscape', 'landscape-kb', 'portrait', 'compact'].includes(params.get('layout')) ? params.get('layout') : (innerWidth < 600 ? 'compact' : innerWidth < 900 ? 'portrait' : 'landscape'));
setRivalLayout(innerWidth < 600 ? 'compact' : innerWidth < 900 ? 'portrait' : 'landscape');
</script>`, `setMock(['landscape', 'landscape-kb', 'portrait', 'compact'].includes(params.get('layout')) ? params.get('layout') : (innerWidth < 600 ? 'compact' : innerWidth < 900 ? 'portrait' : 'landscape'));
setRivalLayout(innerWidth < 600 ? 'compact' : innerWidth < 900 ? 'portrait' : 'landscape');
}

/* ---- ?shell=1: the two characters inside the real app shell (index.html body + styles/layout.css + layout.js) ----
 * The other regions stay empty, so the shell shows its own placeholders there. Extra parameters:
 *   mood=<Mood>   say=<text>   cue=<text>   rival=<RivalMood>   line=<text>   theme, motion as above */
async function shell() {
  root.classList.add('shell');
  root.dataset.theme = ['chibi', 'longzhong', 'shachang'].includes(params.get('theme')) ? params.get('theme') : 'chibi';
  root.dataset.motion = params.get('motion') === 'reduced' ? 'reduced' : 'full';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../styles/layout.css';
  await new Promise((done) => { link.onload = done; link.onerror = done; document.head.append(link); });
  const { computeLayout, applyLayout } = await import('../src/ui/layout.js');
  const app = document.createElement('div');
  app.id = 'app';
  app.className = 'app';
  for (const [k, v] of Object.entries({ layout: 'landscape', phase: 'childTurn', ply: '0', kb: '0', sheet: '0', coach: 'local' })) app.dataset[k] = v;
  app.innerHTML = \`
    <header id="topbar" class="topbar"></header>
    <main id="stage" class="stage"><div id="board"></div></main>
    <div id="underbar" class="underbar"></div>
    <section id="coach" class="coach" aria-label="军师"><div id="buddy" class="coach__buddy"></div><div id="chat" class="coach__chat"></div></section>
    <div id="actions" class="actions"></div>
    <div id="overlays"></div>\`;
  document.body.replaceChildren(app);

  // stand-ins for the neighbours (hud top bar, chat chips): just enough to see the characters in place
  const topbar = app.querySelector('#topbar');
  topbar.classList.add('shell-topbar');
  const menu = document.createElement('span');
  menu.className = 'sq';
  menu.textContent = '≡';
  const rivalHost = document.createElement('div');
  const round = document.createElement('span');
  round.className = 'round';
  round.textContent = '第 12 回合';
  const mute = document.createElement('span');
  mute.className = 'sq';
  mute.textContent = '♪';
  topbar.append(menu, rivalHost, round, mute);
  const chat = app.querySelector('#chat');
  chat.classList.add('shell-chat');
  for (const label of ['对方想干什么？', '现在谁占上风？', '我有危险吗？', '我上一步怎么样？']) {
    const chip = document.createElement('span');
    chip.textContent = label;
    chat.append(chip);
  }

  const reduced = root.dataset.motion === 'reduced';
  let result = computeLayout({ W: innerWidth, H: innerHeight, visibleH: innerHeight, sheet: false });
  applyLayout(app, result, null);
  const buddy = createBuddy(app.querySelector('#buddy'), { variant: result.buddy, reducedMotion: reduced });
  const rival = createRivalView(rivalHost);
  rival.setReducedMotion(reduced);
  window.buddy = buddy;
  window.rival = rival;
  addEventListener('resize', () => {
    result = computeLayout({ W: innerWidth, H: innerHeight, visibleH: innerHeight, sheet: false });
    applyLayout(app, result, null);
    buddy.setVariant(result.buddy);
    chat.dataset.rows = String(result.chipRows);
    chat.hidden = !result.showChips;
  });
  chat.dataset.rows = String(result.chipRows);
  chat.hidden = !result.showChips;

  if (MOODS.includes(params.get('mood'))) buddy.setMood(params.get('mood'), { instant: true });
  if (params.get('say')) {
    const el = buddy.bubble.begin({ id: 'm1', cue: params.get('cue') });
    el.textContent = params.get('say');
    el.parentElement.dataset.state = 'done';
    el.parentElement.dataset.source = 'local';
  }
  if (params.get('rival')) rival.set(params.get('line') ? { mood: params.get('rival'), line: params.get('line') } : { mood: params.get('rival') });
}
</script>`);

// 2. styles for the shell mode
rep(`  @media (max-width: 599.98px) {
    main { padding: 0 8px; }`, `  /* ?shell=1: the harness chrome steps aside for the real shell */
  html.shell body { padding: 0; background: none; }
  .shell-topbar { display: flex; align-items: center; gap: 12px; }
  .shell-topbar .sq { flex: none; width: 44px; height: min(44px, var(--top)); border: 1px solid var(--edge); border-radius: 12px;
                      background: var(--surface); display: grid; place-items: center; }
  .shell-topbar .round { margin-left: auto; color: var(--ink-2); font-size: 14px; white-space: nowrap; }
  .shell-chat { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px; overflow: hidden; }
  .shell-chat[data-rows="1"] { flex-wrap: nowrap; }
  .shell-chat span { flex: none; height: 48px; padding: 0 16px; border-radius: 24px; display: inline-flex; align-items: center;
                     background: var(--surface); box-shadow: 0 0 0 1px var(--edge); color: var(--ink-2); font-size: 15px; white-space: nowrap; margin: 1px; }
  [data-layout="compact"] .shell-chat span { height: 36px; font-size: 13px; padding: 0 12px; }

  @media (max-width: 599.98px) {
    main { padding: 0 8px; }`);

// 3. a link to the shell mode in the header
rep(`<header class="bar">
  <h1>诸葛亮 · 司马懿</h1>`, `<header class="bar">
  <h1>诸葛亮 · 司马懿</h1>
  <a class="btn" style="display:inline-flex;align-items:center;text-decoration:none;color:inherit" href="?shell=1&mood=curious&say=哪个子还没有出动？看看它能去哪里。&cue=主公请看——&rival=thinking">放进真实外壳看看</a>`);

fs.writeFileSync(p, s);
console.log('ok');
