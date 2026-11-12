const fs = require('fs');
let s = fs.readFileSync('browser2.mjs', 'utf8');
const a = `if (which === 'perf') {`;
if (s.split(a).length !== 2) throw new Error('anchor');
const block = `// cut2: the greeting is typed at 250 ms per four characters; the child puts a move on trial when its first sentence is
// on screen and more is still coming: the whole sentence stays, the rest goes.
if (which === 'cut2') {
  for (const layout of ['landscape', 'portrait', 'phone']) {
    if (filter && !layout.includes(filter)) continue;
    const [width, height] = LAYOUTS[layout];
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.route('**/api/coach', (route) => route.continue({ url: \`\${route.request().url()}?chunkMs=250\` }));
    await page.goto(\`\${BASE}/?test=1\`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
    const read = () => page.evaluate(() => {
      const b = document.querySelector('.bubble'); const t = b ? b.querySelector('.bubble__text') : null;
      return { bubble: b ? \`\${b.dataset.state}:"\${t ? t.textContent : ''}"\` : null,
               log: [...document.querySelectorAll('.chat__log .msg[data-role="buddy"]')].map((m) => \`\${m.dataset.kind}:\${m.dataset.state}:"\${m.querySelector('.msg__text').textContent}"\`) };
    });
    // wait until a sentence end is on screen while the line is still streaming
    let seen = null;
    for (let i = 0; i < 200; i++) {
      seen = await read();
      if (seen.bubble && /^streaming:.*[。！？]/.test(seen.bubble)) break;
      if (seen.bubble && seen.bubble.startsWith('done')) break;
      await sleep(40);
    }
    console.log(\`CUT2 \${layout}: before the trial: \${JSON.stringify(seen)}\`);
    const a = await centre(page, '.board-cell[data-row="7"][data-col="7"]'); await page.touchscreen.tap(a.x, a.y); await sleep(150);
    const b = await centre(page, '.board-cell[data-row="7"][data-col="4"]'); await page.touchscreen.tap(b.x, b.y); await sleep(300);
    console.log(\`   +0.3 s after the trial: \${JSON.stringify(await read())}\`);
    await page.screenshot({ path: new URL(\`item9-cut2-\${layout}.png\`, OUT).pathname.slice(1) });
    await context.close();
  }
}

`;
s = s.replace(a, () => block + a);
fs.writeFileSync('browser2.mjs', s);
console.log('browser2.mjs: cut2 added');
