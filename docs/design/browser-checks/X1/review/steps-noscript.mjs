// Shows the .noscript message as a browser without JavaScript would (the element is injected, the CSS is the page's).
export default async ({ page, shot }) => {
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.className = 'noscript';
    p.textContent = '请开启 JavaScript 后开始对弈。';
    document.body.append(p);
  });
  await shot('noscript');
  const box = await page.evaluate(() => { const r = document.querySelector('.noscript').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(' ') + ` / ${innerWidth}x${innerHeight}`; });
  console.log('NOSCRIPT', box);
};
