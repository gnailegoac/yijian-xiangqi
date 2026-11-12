// Reviewer: with the keyboard up the field is never hidden, whatever the height of the sheet.
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector('html[data-ready="1"]');
  await w(500);
  await page.evaluate(() => { const d = window.__dev; d.run.oppLine(); });
  await w(4500);
  await page.evaluate(() => { window.__dev.chat.setSheet(true, { focusInput: true }); });
  await w(400);
  const rows = [];
  // Keyboard heights are simulated by overriding the harness's fixed height through visualViewport-like relayout.
  for (const kbH of [0, 220, 260, 300, 330]) {
    for (const lines of [1, 3]) {
      const m = await page.evaluate(async ([kbH, lines]) => {
        const d = window.__dev;
        const input = document.querySelector('#chat-input');
        input.value = lines === 1 ? '炮二平五好不好？' : '第一行\n第二行\n第三行\n第四行';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // the harness uses a fixed keyboard height; patch innerHeight-based maths by resizing the fake keyboard directly
        d.state.kb = kbH > 0;
        const realRelayout = d.relayout;
        if (kbH > 0) {
          const { computeLayout, applyLayout } = await import('../src/ui/layout.js');
          const app = document.querySelector('#app');
          const visibleH = innerHeight - kbH;
          const l = computeLayout({ W: innerWidth, H: innerHeight, visibleH, sheet: true });
          applyLayout(app, l, { height: visibleH, offsetTop: 0 });
          app.dataset.sheet = '1';
          const kb = document.querySelector('#fake-kb'); kb.hidden = false; kb.style.height = kbH + 'px';
          d.chat.setLayout({ mode: l.layout, showChips: l.showChips, chipRows: l.chipRows, kb: l.kb });
        } else {
          realRelayout();
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
        const vis = innerHeight - kbH;
        const form = r('.chat__input'), chat = r('#chat'), head = r('.chat__head'), chips = r('.chat__chips'), log = r('.chat__log'), inp = r('#chat-input'), send = r('#chat-send');
        return { kbH, lines, vis, chatH: chat.h, head: head.h, chips: chips.h, log: log.h, input: inp.h, formBottom: form.bottom, sendBottom: send.bottom, ok: form.bottom <= vis + 0.5 && form.top >= chat.top && inp.h >= 44 };
      }, [kbH, lines]);
      rows.push(m);
      if (kbH === 300) await shot(`kb300-${lines}`);
      if (kbH === 330 && lines === 1) await shot('kb330-1');
    }
  }
  for (const r of rows) console.log('FIT ' + JSON.stringify(r));
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) throw new Error(`${bad.length} states hide the field`);
};
