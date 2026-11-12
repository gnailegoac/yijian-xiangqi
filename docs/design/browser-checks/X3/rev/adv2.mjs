// More adversarial checks (reviewer): flash under hit-stop, theme change in flight, palette tokens, layer attributes.
export default async ({ page }) => {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => { __lab.setMotion(false); __lab.setTheme('chibi'); __lab.fx.clear(); });

  // 1. the impact frame: a flash started just before a hit-stop is held, then fades, and never sticks
  const fl = await ev(async () => {
    const fx = __lab.fx, el = document.querySelector('.fx-flash'); fx.clear();
    const op = () => Number(getComputedStyle(el).opacity);
    fx.flash('#fff', 60); fx.shake(3); fx.hitStop(120);
    await new Promise(r => setTimeout(r, 70)); const held = op();
    const board = document.getElementById('board');
    const t1 = getComputedStyle(board).translate;
    await new Promise(r => setTimeout(r, 30)); const t2 = getComputedStyle(board).translate;      // still frozen: the offset does not change
    await new Promise(r => setTimeout(r, 200)); const after = op();
    await new Promise(r => setTimeout(r, 300));
    return { held, after, t1, t2, end: getComputedStyle(board).translate };
  });
  check('1 flash + shake + hitStop(120): the flash and the first shake offset are held for the freeze, then both finish', fl.held > 0.25 && fl.after === 0 && fl.t1 === fl.t2 && fl.t1 !== 'none' && fl.end === 'none', fl);

  // 2. a theme change while particles fly: token colours handed in by a caller follow the new theme
  const th = await ev(async () => {
    const fx = __lab.fx, cvs = document.querySelector('.fx-canvas'); fx.clear();
    const top = async () => {
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const g = cvs.getContext('2d'), d = g.getImageData(0, 0, cvs.width, cvs.height).data; const seen = {};
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; seen[k] = (seen[k] || 0) + 1; }
      return Object.entries(seen).sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    fx.burst('ring', __lab.pt(4, 4), { size: 2, color: '--trial' });
    const a = await top();
    fx.burst('stars', __lab.pt(8, 1), { n: 3 });           // keeps the pool alive across the switch
    __lab.setTheme('longzhong');
    fx.burst('ring', __lab.pt(4, 4), { size: 2, color: '--trial' });
    const b = await top();
    fx.clear(); __lab.setTheme('chibi');
    return { a, b };
  });
  check('2 ring in --trial: #ffb000 in chibi, #8f4a00 after switching to longzhong with particles alive', th.a === '255,176,0' && th.b === '143,74,0', th);

  // 3. colours: token, var(token), plain colour and nonsense all draw without throwing
  const col = await ev(async () => {
    const fx = __lab.fx; fx.clear(); let threw = '';
    try {
      for (const color of ['--fx-cool', 'var(--fx-cool)', 'var( --fx-cool )', '#0f0', 'rgb(1 2 3 / .5)', 'nonsense', '--missing-token', '']) {
        fx.burst('ring', __lab.pt(2, 2), { color }); fx.burst('capture', __lab.pt(2, 2), { n: 4, colors: [color] }); fx.flash(color, 60);
      }
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    } catch (e) { threw = e.message; }
    const live = fx.live; fx.clear();
    return { threw, live };
  });
  check('3 any colour string is accepted', col.threw === '' && col.live === 8 * 5, col);

  // 4. the layer: canvas, wind, flash and banners are hidden from assistive tech, take no pointer events, and banners sit on --z-banner
  const lay = await ev(() => {
    const kids = [...document.querySelector('.bv-fx').children];
    return { hidden: kids.every(k => k.getAttribute('aria-hidden') === 'true'), pe: kids.every(k => getComputedStyle(k).pointerEvents === 'none'),
      z: getComputedStyle(document.querySelector('.fx-banners')).zIndex, role: kids.every(k => !k.hasAttribute('role')) };
  });
  check('4 layer attributes', lay.hidden && lay.pe && lay.z === '5' && lay.role, lay);

  // 5. the 自己想的 mark is the popup's Kai face, .42 c, --ink-2
  const mk = await ev(() => {
    const fx = __lab.fx, c = __lab.cell(); fx.clear();
    fx.popup('妙计！', __lab.pt(3, 4), { tone: 'great' }); fx.popup('自己想的', __lab.pt(3, 4), { tone: 'mark' });
    const a = getComputedStyle(document.querySelector('.fx-popup__mark'));
    const under = { font: a.fontFamily.slice(0, 12), weight: a.fontWeight, size: parseFloat(a.fontSize) / c, color: a.color };
    fx.clear(); fx.popup('自己想的', __lab.pt(3, 4), { tone: 'mark' });
    const b = getComputedStyle(document.querySelector('.fx-popup'));
    const alone = { font: b.fontFamily.slice(0, 12), weight: b.fontWeight, size: parseFloat(b.fontSize) / c, color: b.color };
    fx.clear(); return { under, alone };
  });
  const okMark = m => /KaiTi/.test(m.font) && m.weight === '700' && Math.abs(m.size - 0.42) < 0.005 && m.color === 'rgb(154, 166, 199)';
  check('5 mark: --font-kai 700, .42 c, --ink-2, alone and under a popup', okMark(mk.under) && okMark(mk.alone), mk);

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.error(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
  console.error(`\n${results.length - failed.length} of ${results.length} adversarial checks (2) passed`);
  if (failed.length) throw new Error(`${failed.length} check(s) failed`);
};
