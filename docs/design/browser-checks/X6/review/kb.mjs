// Reviewer: sheet + input + simulated keyboard, without clicking controls inside the stage.
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector('html[data-ready="1"]');
  await w(700);
  await page.evaluate(async () => {
    const d = window.__dev;
    d.run.planLine();
  });
  await w(6000);
  await page.evaluate(() => { const d = window.__dev; d.run.oppLine(); });
  await w(5500);
  await page.evaluate(() => { window.__dev.chat.setSheet(true, { focusInput: true }); });
  await w(500);
  await page.locator('#chat-input').fill('炮二平五好不好？');
  await w(200);
  await shot('1-input');
  await page.evaluate(() => { const d = window.__dev; d.state.kb = true; d.relayout(); });
  await w(500);
  await shot('2-kb');
  const m = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { app: r('#app'), chat: r('#chat'), log: r('.chat__log'), chips: r('.chat__chips'), form: r('.chat__input'), input: r('#chat-input'), send: r('#chat-send'), head: r('.chat__head'), kb: r('#fake-kb'), board: r('#board'), vh: innerHeight };
  });
  console.log('KB-METRICS ' + JSON.stringify(m));
  // send while typing: press the send button
  await page.locator('#chat-send').tap().catch(() => page.locator('#chat-send').click());
  await w(1500);
  await shot('3-sent-stop');
  await w(5000);
  await shot('4-answer');
  await page.evaluate(() => { const d = window.__dev; d.state.kb = false; d.relayout(); });
  await w(400);
  await shot('5-kb-down');
};
