// Reviewer's state walk: applied layout with stand-in content, sheet open, keyboard up, keyboard + sheet.
export default async ({ page, shot }) => {
  await page.evaluate(async () => {
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    const app = document.getElementById('app');
    const el = (tag, style, text) => { const e = document.createElement(tag); e.style.cssText = style; if (text) e.textContent = text; return e; };
    const btn = 'border:1px solid var(--edge);border-radius:var(--r-btn);background:var(--surface-2);color:var(--ink);font:600 var(--fs-button)/1 var(--font-ui);';
    const primary = 'border:0;border-radius:var(--r-btn);background:var(--accent);color:var(--accent-ink);font:700 var(--fs-button)/1 var(--font-ui);box-shadow:0 3px 0 color-mix(in srgb, var(--accent) 55%, #000);';
    const top = document.getElementById('topbar'); top.style.cssText = 'display:flex;align-items:center;gap:8px;';
    top.append(el('button', btn + 'width:44px;height:44px;flex:none', '≡'), el('div', 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', '司马懿 魏·大都督 「小主公，请。」'), el('span', 'flex:none;color:var(--ink-2)', '第 12 回合'), el('button', btn + 'width:44px;height:44px;flex:none', '♪'));
    const board = document.getElementById('board');
    board.append(el('div', 'position:absolute;inset:0;border-radius:12px;background:linear-gradient(135deg,var(--field-a),var(--field-b));outline:3px solid var(--frame-edge);outline-offset:-3px;display:grid;place-items:center;font:700 40px var(--font-kai);color:var(--line)', '棋盘'));
    const under = document.getElementById('underbar'); under.style.cssText = 'display:flex;align-items:center;gap:12px;';
    under.append(el('button', btn + 'min-width:100px;height:48px;flex:1 0 auto;max-width:120px', '悔棋'), el('span', 'min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)', '上一步：马8进7'));
    const buddy = document.getElementById('buddy');
    buddy.append(el('div', 'position:absolute;inset:0;border:2px dashed var(--edge);border-radius:16px;display:grid;place-items:center;color:var(--ink-2)', '诸葛亮 + 气泡'));
    const chat = document.getElementById('chat');
    const inner = el('div', 'display:flex;flex-direction:column;gap:8px;padding-top:8px;height:100%;box-sizing:border-box;');
    inner.className = 'fake-chat';
    const log = el('div', 'flex:1;min-height:0;overflow:auto;background:var(--surface);border:1px solid var(--edge);border-radius:16px;padding:12px;display:none', '');
    log.className = 'fake-log';
    for (let i = 1; i <= 14; i++) log.append(el('p', 'margin:0 0 8px', `第 ${i} 回合 · 军师：这一步走得稳，小主公再看看对面的炮。`));
    const chips = el('div', 'display:flex;flex-wrap:wrap;gap:8px;');
    window.__chipH = () => (app.dataset.layout === 'compact' ? 36 : 48);
    for (const t of ['对方会怎么应？', '有更好的走法吗？', '我有危险吗？', '回看']) chips.append(el('button', btn + 'height:48px;padding:0 16px;border-radius:24px;flex:none', t));
    const input = el('textarea', 'display:none;height:44px;border-radius:12px;border:1px solid var(--edge);background:var(--surface);padding:10px;resize:none', '');
    input.className = 'fake-input'; input.placeholder = '问问军师……';
    inner.append(log, chips, input);
    chat.append(inner);
    const actions = document.getElementById('actions'); actions.style.cssText = 'display:flex;align-items:center;';
    actions.append(el('button', primary + 'flex:1;height:48px', '锦囊'));

    window.__apply = (o) => {
      const visibleH = o.visibleH ?? innerHeight;
      const r = computeLayout({ W: innerWidth, H: innerHeight, visibleH, sheet: !!o.sheet });
      app.dataset.sheet = o.sheet ? '1' : '0';
      applyLayout(app, r, { height: visibleH, offsetTop: 0 });
      document.querySelector('.fake-log').style.display = o.sheet ? 'block' : 'none';
      document.querySelector('.fake-input').style.display = (o.sheet || r.kb) ? 'block' : 'none';
      chat.style.background = o.sheet ? 'var(--surface-2)' : '';
      for (const b of chips.children) b.style.height = `${r.layout === 'compact' ? 36 : 48}px`;
      chips.style.display = r.showChips ? 'flex' : 'none';
      const rect = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10).join(' '); };
      return { layout: r.layout, kb: r.kb, c: r.c, coachH: r.coachH, buddyH: r.buddyH, showChips: r.showChips, stageScale: r.stageScale, miniH: r.miniH,
        app: rect('app'), topbar: rect('topbar'), stage: rect('stage'), board: rect('board'), under: rect('underbar'), coach: rect('coach'), buddy: rect('buddy'), chat: rect('chat'), actions: rect('actions'),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight };
    };
  });
  const kbH = await page.evaluate(() => (innerHeight >= 1000 ? 780 : innerHeight >= 800 ? 420 : innerHeight >= 700 ? 440 : Math.round(innerHeight * 0.55)));
  const states = [['base', {}], ['sheet', { sheet: true }], ['kb', { visibleH: kbH }], ['kbsheet', { visibleH: kbH, sheet: true }]];
  for (const [name, o] of states) {
    const info = await page.evaluate(opts => window.__apply(opts), o);
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10).join(' '); });
    console.log(name, JSON.stringify({ ...info, stageAfter: after }));
    await shot(name);
  }
};
