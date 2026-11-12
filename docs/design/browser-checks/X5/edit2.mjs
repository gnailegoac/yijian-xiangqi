import fs from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/buddy.html';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, b); };
rep('<title>dev · 诸葛亮与司马懿</title>', '<title>dev · 诸葛亮与司马懿</title>\n<link rel="icon" type="image/svg+xml" href="../favicon.svg">');
rep("  el.className = 'card';\n", "  el.className = 'card';\n  el.dataset.mood = mood;\n");
rep(`  <section id="small-section">
    <h2>138 px 全身（小尺寸检查）</h2>
    <div class="sheet sheet--small" id="sheet-small"></div>
  </section>`, `  <section id="small-section">
    <h2>56 px 头像一排 · 138 px 全身一排</h2>
    <p class="note">手机上他只有 56 px：十种神情在这个尺寸也要一眼分得出来。</p>
    <div class="strip" id="bust-strip"></div>
    <div class="sheet sheet--small" id="sheet-small"></div>
  </section>`);
rep('  .sheet--small { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }',
    '  .sheet--small { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }\n  .strip { display: flex; flex-wrap: wrap; gap: 10px 14px; margin: 0 0 14px; }\n  .strip figure { margin: 0; display: grid; justify-items: center; gap: 2px; font-size: 11px; line-height: 14px; color: var(--ink-2); }\n  .strip .card__bust .bubble { display: none; }\n  .strip .buddy-box { display: block; }');
rep("for (const mood of MOODS) $('#sheet-small').append(card(mood, true));",
    "for (const mood of MOODS) $('#sheet-small').append(card(mood, true));\nfor (const mood of MOODS) {\n  const f = document.createElement('figure');\n  const h = document.createElement('div');\n  h.className = 'card__bust';\n  const c = document.createElement('figcaption');\n  c.textContent = mood;\n  f.append(h, c);\n  $('#bust-strip').append(f);\n  const b = createBuddy(h, { variant: 'bust', reducedMotion: reducedNow() });\n  b.setMood(mood, { instant: true });\n  all.buddies.push(b);\n}");
rep("  for (const id of ['#sheet', '#sheet-small']) {", "  for (const id of ['#sheet', '#sheet-small', '#bust-strip']) {");
fs.writeFileSync(p, s);
console.log('ok');
