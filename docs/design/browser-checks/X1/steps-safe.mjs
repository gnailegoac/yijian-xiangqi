// Emulates safe-area insets (a home-screen web app on an iPad: status bar 24 px, home indicator 20 px) through CDP,
// applies the layout as the stage will, and reports whether the board still fits its cell.
export default async ({ page, shot, context }) => {
  const cdp = await context.newCDPSession(page);
  let emulated = true;
  try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 20, left: 0, right: 0 } }); } catch (e) { emulated = String(e).slice(0, 200); }
  await page.waitForTimeout(200);
  const measure = () => page.evaluate(() => {
    const rect = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10); };
    const app = document.getElementById('app'); const cs = getComputedStyle(app);
    return { pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft], topbar: rect('topbar'), stage: rect('stage'), board: rect('board'), under: rect('underbar'), coach: rect('coach'), actions: rect('actions'), inner: [innerWidth, innerHeight] };
  });
  const pre = await measure();
  await shot('pre');
  await page.evaluate(async () => {
    const { computeLayout, applyLayout } = await import('/src/ui/layout.js');
    applyLayout(document.getElementById('app'), computeLayout({ W: innerWidth, H: innerHeight, visibleH: innerHeight, sheet: false }), null);
  });
  const post = await measure();
  await shot('post');
  console.log(JSON.stringify({ emulated, pre, post }));
};
