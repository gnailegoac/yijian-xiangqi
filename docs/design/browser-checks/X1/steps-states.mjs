// Post-JS states: applied layout, sheet open, keyboard up. Marks #chat so its box is visible.
export default async ({ page, shot }) => {
  const apply = (opts) => page.evaluate(async (o) => {
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    const app = document.getElementById('app');
    const visibleH = o.visibleH ?? innerHeight;
    const r = computeLayout({ W: innerWidth, H: innerHeight, visibleH, sheet: !!o.sheet });
    applyLayout(app, r, /** @type {any} */ ({ height: visibleH, offsetTop: 0 }));
    app.dataset.sheet = o.sheet ? '1' : '0';
    const rect = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10); };
    return { layout: r.layout, kb: r.kb, c: r.c, stageScale: r.stageScale, miniH: r.miniH, app: rect('app'), stage: rect('stage'), board: rect('board'), under: rect('underbar'), coach: rect('coach'), buddy: rect('buddy'), chat: rect('chat'), actions: rect('actions'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }, opts);
  const out = {};
  out.plain = await apply({});
  await shot('applied');
  await page.evaluate(() => { const chat = document.getElementById('chat'); chat.style.outline = '2px dashed #ff3bd4'; chat.style.outlineOffset = '-2px'; chat.style.background = 'color-mix(in srgb, var(--surface) 92%, transparent)'; });
  out.sheet = await apply({ sheet: true });
  await page.waitForTimeout(300);
  await shot('sheet');
  await page.evaluate(() => { const chat = document.getElementById('chat'); chat.style.outline = ''; chat.style.background = ''; });
  const H = await page.evaluate(() => innerHeight);
  out.kb = await apply({ visibleH: Math.round(H * 0.55) });
  await shot('kb');
  out.kbSheet = await apply({ visibleH: Math.round(H * 0.55), sheet: true });
  await shot('kb-sheet');
  console.log(JSON.stringify(out));
};
