// Renders a palette sheet for the three themes from the live stylesheets (tokens.css + themes.css).
export default async ({ page, shot }) => {
  await page.evaluate(() => {
    for (const l of [...document.querySelectorAll('link[rel="stylesheet"]')]) if (/layout\.css/.test(l.href)) l.remove();
    document.documentElement.style.cssText = 'height:auto;overflow:auto';
    document.body.style.cssText = 'height:auto;overflow:auto;margin:0;display:grid;grid-template-columns:repeat(3,1fr);';
    const style = document.createElement('style');
    style.textContent = `
      .col { padding: 14px; background: var(--page); color: var(--ink); font: 14px/20px var(--font-ui); min-height: 100vh; }
      .col h2 { margin: 0 0 8px; font: 700 26px/32px var(--font-kai); }
      .field { position: relative; height: 210px; border-radius: 10px; background: linear-gradient(135deg, var(--field-a), var(--field-b)); box-shadow: inset 0 0 0 2px var(--frame), inset 0 0 0 5px var(--frame-edge); overflow: hidden; }
      .field .grid { position: absolute; inset: 34px 20px 20px; background:
          repeating-linear-gradient(to right, var(--line) 0 2px, transparent 2px 52px),
          repeating-linear-gradient(to bottom, var(--line) 0 2px, transparent 2px 52px); }
      .field .river { position: absolute; left: 20px; right: 20px; top: 86px; height: 52px; opacity: var(--river-opacity); background: linear-gradient(to right, var(--river-a), var(--river-b), var(--river-a)); }
      .field .rt { position: absolute; left: 0; right: 0; top: 96px; text-align: center; font: 700 28px/32px var(--font-kai); color: var(--river-text); letter-spacing: .5em; opacity: .8; }
      .field .labels { position: absolute; left: 20px; right: 20px; top: 9px; display: flex; justify-content: space-between; font: 600 14px/16px var(--font-ui); color: var(--label); }
      .piece { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; }
      .piece i { position: absolute; inset: 0; border-radius: 50%; border: 3.3px solid var(--rim); background: radial-gradient(circle at 34% 26%, var(--a), var(--b) 58%, var(--cc) 100%);
                 box-shadow: 0 3px 0 var(--piece-edge), 0 0 14px var(--glow), inset 0 -2px 4px #0005, inset 0 2px 3px #fff5; }
      .piece b { position: absolute; inset: 0; display: grid; place-items: center; padding-bottom: 4%; font: 700 26px/1 var(--font-kai); color: var(--glyph); text-shadow: 0 1px 0 #0006; }
      .piece.red { --a: var(--red-a); --b: var(--red-b); --cc: var(--red-c); --rim: var(--red-rim); --glyph: var(--red-glyph); --glow: var(--red-glow); }
      .piece.black { --a: var(--blk-a); --b: var(--blk-b); --cc: var(--blk-c); --rim: var(--blk-rim); --glyph: var(--blk-glyph); --glow: var(--blk-glow); }
      .dot { position: absolute; width: 14px; height: 14px; margin: -7px; border-radius: 50%; }
      .ring { position: absolute; width: 52px; height: 52px; margin: -26px; border-radius: 50%; border: 3px dashed; }
      .ret { position: absolute; width: 50px; height: 50px; margin: -25px; border: 4px solid var(--danger); border-radius: 6px; clip-path: polygon(0 0, 30% 0, 30% 30%, 0 30%, 0 70%, 30% 70%, 30% 100%, 0 100%, 0 0, 100% 0, 100% 30%, 70% 30%, 70% 0, 100% 0, 100% 100%, 70% 100%, 70% 70%, 100% 70%, 100% 100%, 0 100%); }
      .card { margin-top: 10px; padding: 10px; border-radius: var(--r-card); background: var(--surface); border: 1px solid var(--edge); }
      .card2 { margin-top: 8px; padding: 8px 10px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--edge); }
      .btn { height: 44px; padding: 0 18px; border-radius: var(--r-btn); font: 700 16px/1 var(--font-ui); margin: 6px 6px 3px 0; }
      .pri { border: 0; background: var(--accent); color: var(--accent-ink); box-shadow: 0 3px 0 color-mix(in srgb, var(--accent) 55%, #000); }
      .sec { background: var(--surface-2); color: var(--ink); border: 1px solid var(--edge); }
      .dan { border: 0; background: var(--danger); color: var(--danger-ink); }
      .sw { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-top: 10px; }
      .sw span { height: 34px; border-radius: 6px; border: 1px solid #8884; font: 9px/11px monospace; color: #fff; text-shadow: 0 0 2px #000, 0 0 2px #000; padding: 2px; overflow: hidden; }
      .arrow { display: inline-block; width: 64px; height: 8px; border-radius: 4px; margin: 4px 6px 0 0; }
    `;
    document.head.append(style);
    const names = { chibi: '赤壁', longzhong: '隆中', shachang: '沙场' };
    const tokens = ['--page', '--frame', '--frame-edge', '--field-a', '--field-b', '--line', '--river-a', '--river-b', '--river-text', '--label', '--red-a', '--red-b', '--red-c', '--red-rim', '--red-glyph', '--blk-a', '--blk-b', '--blk-c', '--blk-rim', '--blk-glyph', '--piece-edge', '--sel', '--trial', '--ink', '--ink-2', '--surface', '--surface-2', '--edge', '--accent', '--accent-ink', '--danger', '--danger-ink', '--arrow-hint', '--arrow-idea', '--arrow-threat', '--arrow-reply', '--fx-spark', '--fx-ember', '--fx-cool', '--fx-white', '--shu', '--wei'];
    document.body.replaceChildren();
    for (const theme of ['chibi', 'longzhong', 'shachang']) {
      const col = document.createElement('div');
      col.className = 'col'; col.dataset.theme = theme;
      col.innerHTML = `<h2>${names[theme]} · ${theme}</h2>
        <div class="field"><div class="river"></div><div class="grid"></div><div class="rt">楚河 汉界</div>
          <div class="labels"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>七</span><span>八</span><span>九</span></div>
          <div class="piece red" style="left:72px;top:60px"><i></i><b>帅</b></div>
          <div class="piece red" style="left:124px;top:164px"><i></i><b>炮</b></div>
          <div class="piece black" style="left:176px;top:60px"><i></i><b>将</b></div>
          <div class="piece black" style="left:228px;top:164px"><i></i><b>卒</b></div>
          <div class="dot" style="left:280px;top:60px;background:var(--sel)"></div>
          <div class="ring" style="left:124px;top:164px;border-color:var(--sel)"></div>
          <div class="ring" style="left:332px;top:60px;border-color:var(--trial)"></div>
          <div class="ret" style="left:228px;top:164px"></div>
          <div class="ret" style="left:332px;top:164px"></div>
        </div>
        <div class="card"><b>军师：小主公，这步棋走得稳。</b><div style="color:var(--ink-2)">次要文字 secondary · 第 12 回合</div>
          <div class="card2">surface-2 · <span style="color:var(--accent);font-weight:600;border-bottom:1.5px dashed">炮二平五</span> · <span style="color:var(--danger)">danger</span></div>
          <button class="btn pri">确定落子</button><button class="btn sec">换一步</button><button class="btn dan">认输</button></div>
        <div><i class="arrow" style="background:var(--arrow-hint)"></i><i class="arrow" style="background:var(--arrow-idea)"></i><i class="arrow" style="background:var(--arrow-threat)"></i><i class="arrow" style="background:var(--arrow-reply)"></i></div>
        <div class="sw">${tokens.map(t => `<span style="background:var(${t})">${t.slice(2)}</span>`).join('')}</div>`;
      document.body.append(col);
    }
  });
  await page.waitForTimeout(200);
  await shot('palette');
};
