// Region boxes before and after applyLayout(computeLayout()), and one screenshot of the untouched page.
export default async ({ page, shot }) => {
  await shot('pre');
  const info = await page.evaluate(async () => {
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    const ids = ['topbar', 'stage', 'board', 'underbar', 'coach', 'buddy', 'chat', 'actions'];
    const boxes = () => Object.fromEntries(ids.map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, [r.left, r.top, r.width, r.height]]; }));
    const pre = boxes();
    const app = document.getElementById('app');
    const r = computeLayout({ W: innerWidth, H: innerHeight, visibleH: innerHeight, sheet: false });
    applyLayout(app, r, window.visualViewport);
    const post = boxes();
    let maxDiff = 0, worst = '';
    for (const id of ids) for (let i = 0; i < 4; i++) { const d = Math.abs(pre[id][i] - post[id][i]); if (d > maxDiff) { maxDiff = d; worst = `${id}[${i}]`; } }
    const fmt = b => b.map(n => Math.round(n * 10) / 10).join(' ');
    return { layout: r.layout, c: r.c, maxDiff: Math.round(maxDiff * 1000) / 1000, worst, board: fmt(post.board), stage: fmt(post.stage), under: fmt(post.underbar), coach: fmt(post.coach), actions: fmt(post.actions),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight };
  });
  console.log(JSON.stringify(info));
};
