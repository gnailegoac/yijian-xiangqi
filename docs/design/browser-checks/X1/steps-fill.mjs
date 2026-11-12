// Fills every region with stand-in content (as the real modules will) to see that the shell holds its shape.
export default async ({ page, shot }) => {
  const info = await page.evaluate(async () => {
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    const app = document.getElementById('app');
    const r = computeLayout({ W: innerWidth, H: innerHeight, visibleH: innerHeight, sheet: false });
    applyLayout(app, r, null);
    const el = (tag, style, text) => { const e = document.createElement(tag); e.style.cssText = style; if (text) e.textContent = text; return e; };
    const btn = 'border:1px solid var(--edge);border-radius:var(--r-btn);background:var(--surface-2);color:var(--ink);font:600 var(--fs-button)/1 var(--font-ui);';
    const primary = 'border:0;border-radius:var(--r-btn);background:var(--accent);color:var(--accent-ink);font:700 var(--fs-button)/1 var(--font-ui);box-shadow:0 3px 0 color-mix(in srgb, var(--accent) 55%, #000);';
    const top = document.getElementById('topbar'); top.style.cssText = 'display:flex;align-items:center;gap:8px;';
    top.append(el('button', btn + 'width:44px;height:44px;flex:none', '≡'), el('div', 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', '司马懿  魏 · 大都督  「小主公，这一步你可看清楚了？这可是一句很长很长很长很长很长很长的话」'), el('span', 'flex:none;color:var(--ink-2)', '第 12 回合'), el('button', btn + 'width:44px;height:44px;flex:none', '♪'));
    const board = document.getElementById('board'); board.append(el('div', 'position:absolute;inset:0;border-radius:12px;background:linear-gradient(135deg,var(--field-a),var(--field-b));outline:3px solid var(--frame-edge);outline-offset:-3px;display:grid;place-items:center;font:700 40px var(--font-kai);color:var(--line)', '棋盘'));
    const under = document.getElementById('underbar'); under.style.cssText = 'display:flex;align-items:center;gap:12px;';
    under.append(el('button', btn + 'min-width:120px;height:48px;flex:none', '悔棋'), el('span', 'min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)', '上一步：马8进7'));
    const buddy = document.getElementById('buddy'); buddy.append(el('div', 'position:absolute;inset:0;border:2px dashed var(--edge);border-radius:16px;display:grid;place-items:center;color:var(--ink-2)', '诸葛亮 + 对话气泡'));
    const chat = document.getElementById('chat'); chat.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding-top:8px;';
    for (const t of ['对方会怎么应？', '有更好的走法吗？', '我有危险吗？', '这步好在哪？', '指给我看', '回看']) chat.append(el('button', btn + `height:${r.layout === 'compact' ? 36 : 48}px;padding:0 16px;border-radius:24px;flex:none`, t));
    const actions = document.getElementById('actions'); actions.style.cssText = 'display:flex;align-items:center;';
    actions.append(el('button', primary + 'flex:1;height:' + (r.layout === 'compact' ? 44 : 48) + 'px', '锦囊'));
    const rect = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10); };
    return { layout: r.layout, r: { coachH: r.coachH, buddyH: r.buddyH }, topbar: rect('topbar'), board: rect('board'), under: rect('underbar'), coach: rect('coach'), buddy: rect('buddy'), chat: rect('chat'), actions: rect('actions'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight };
  });
  await shot('fill');
  console.log(JSON.stringify(info));
};
