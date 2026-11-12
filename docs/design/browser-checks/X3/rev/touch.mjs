// Harness layout: touch targets, overflow, scroll, per tab.
export default async ({ page }) => {
  const out = await page.evaluate(() => {
    const r = { small: [], tabs: {} };
    for (const tab of ['全部', '粒子', '冲击', '横幅', '飘字', '场景']) {
      __lab.showTab(tab);
      const buttons = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      r.tabs[tab] = buttons.length;
      for (const b of buttons) { const q = b.getBoundingClientRect(); if (q.width < 44 || q.height < 44) r.small.push(`${tab}:${b.textContent.trim().slice(0, 12)} ${Math.round(q.width)}x${Math.round(q.height)}`); }
    }
    r.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    r.overflowY = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const board = document.getElementById('board').getBoundingClientRect();
    r.board = [Math.round(board.left), Math.round(board.top), Math.round(board.right), Math.round(board.bottom)];
    r.view = [innerWidth, innerHeight];
    r.cell = __lab.cell();
    r.layout = document.getElementById('lab').dataset.layout;
    return r;
  });
  console.error('LOG', JSON.stringify(out));
};
