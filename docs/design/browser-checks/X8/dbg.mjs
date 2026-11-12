export default async ({ page }) => {
  await page.waitForTimeout(1500);
  const d = await page.evaluate(async () => {
    const dev = window.__dev, s = dev.real, b = dev.G.board;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = { from: { row: 7, col: 7 }, to: { row: 7, col: 4 }, piece: b[7][7], captured: null };
    await s.tentative(m, { notation: 'x', aim: false });
    const chat = document.querySelector('#chat');
    const seen = [];
    const mo = new MutationObserver(() => seen.push(chat.style.maxHeight));
    mo.observe(chat, { attributes: true, attributeFilter: ['style'] });
    document.querySelector('#history-button').click();
    const r0 = chat.getBoundingClientRect();
    await sleep(500);
    const r = chat.getBoundingClientRect();
    const cell = document.querySelector('.board-cell[data-row="7"][data-col="4"]').getBoundingClientRect();
    return { seen, now: chat.style.maxHeight, r0: [r0.top, r0.bottom], r: [r.top, r.bottom], cell: cell.bottom, layout: document.querySelector('#app').dataset.layout, sheet: document.querySelector('#app').dataset.sheet };
  });
  console.error(JSON.stringify(d));
};
