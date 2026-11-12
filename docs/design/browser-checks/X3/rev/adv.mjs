// Adversarial checks for src/ui/fx.js (reviewer). Run in dev/fx.html through shot.mjs --steps.
export default async ({ page }) => {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => {
    __lab.setMotion(false); __lab.fx.clear();
    window.__shakes = () => document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length;
  });

  // 1. absurd counts must not hang the page
  const big = await ev(() => {
    const fx = __lab.fx, T = __lab.pt(3, 4), out = {};
    for (const [name, f] of Object.entries({
      capInf: () => fx.burst('capture', T, { n: Infinity }), cap1e9: () => fx.burst('capture', T, { n: 1e9 }), starsInf: () => fx.burst('stars', T, { n: Infinity }),
      splashInf: () => fx.burst('splash', T, { n: Infinity }), confInf: () => fx.confetti({ n: Infinity }), capNaN: () => fx.burst('capture', T, { n: NaN }),
      capNeg: () => fx.burst('capture', T, { n: -4 }), scaleInf: () => fx.burst('capture', T, { scale: Infinity }), sparksNaN: () => fx.burst('sparks', T, { n: NaN }),
      dustNaN: () => fx.burst('dust', T, { n: NaN }), atNaN: () => fx.burst('explosion', { x: NaN, y: NaN }),
    })) {
      fx.clear(); const t0 = performance.now();
      try { f(); out[name] = [Math.round(performance.now() - t0), fx.live]; } catch (e) { out[name] = ['THROW ' + e.message]; }
    }
    fx.clear(); return out;
  });
  check('1 absurd n / scale / at: returns fast, never throws, never exceeds the pool', Object.values(big).every(v => typeof v[0] === 'number' && v[0] < 50 && v[1] <= 320), big);

  // 2. rapid banner replacement: every promise settles, the DOM ends clean
  const rep = await ev(async () => {
    const fx = __lab.fx; fx.clear(); let settled = 0; const kinds = ['start', 'check', 'mate', 'stalemate', 'lose', 'draw', 'river'];
    const ps = kinds.map(k => fx.banner(k).then(() => { settled++; }));
    const now = document.querySelectorAll('.fx-banner').length;
    await new Promise(r => setTimeout(r, 150));
    const after150 = document.querySelectorAll('.fx-banner').length, settledEarly = settled;
    await Promise.all(ps);
    await new Promise(r => setTimeout(r, 50));
    return { now, after150, settledEarly, settled, end: document.querySelectorAll('.fx-banners > *').length, live: fx.live };
  });
  check('2 seven banners at once: six settle at once, one stays, the layer ends empty', rep.now === 7 && rep.after150 === 1 && rep.settledEarly === 6 && rep.settled === 7 && rep.end === 0, rep);

  // 3. clear() in the middle of a slam: no late shake, no late sparks, nothing left
  const cs = await ev(async () => {
    const fx = __lab.fx; fx.clear(); let done = false;
    fx.banner('mate').then(() => { done = true; });
    await new Promise(r => setTimeout(r, 100));
    fx.clear();
    await new Promise(r => setTimeout(r, 300));
    return { done, live: fx.live, shakes: __shakes(), els: document.querySelectorAll('.fx-banners > *').length };
  });
  check('3 clear() during a slam: resolved, no late shake or sparks', cs.done && cs.live === 0 && cs.shakes === 0 && cs.els === 0, cs);

  // 4. a banner replaced during its slam does not shake or spark for the old one
  const rs = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    fx.banner('check');
    await new Promise(r => setTimeout(r, 100));
    fx.banner('lose');
    let peak = 0, sh = 0; const t0 = performance.now();
    while (performance.now() - t0 < 400) { peak = Math.max(peak, fx.live); sh = Math.max(sh, __shakes()); await new Promise(requestAnimationFrame); }
    fx.clear(); return { peak, sh };
  });
  check('4 a slam replaced by a calm banner leaves no sparks and no shake', rs.peak === 0 && rs.sh === 0, rs);

  // 5. hit-stop: overlapping calls, a banner replaced while frozen, and the thaw
  const hs = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    const hover = document.querySelector('[data-sq="7,7"]').getAnimations()[0];
    fx.hitStop(60); await new Promise(r => setTimeout(r, 40)); fx.hitStop(120);
    await new Promise(r => setTimeout(r, 60)); const mid = hover.playState;        // 100 ms in: the first would have ended, the second holds
    await new Promise(r => setTimeout(r, 120)); const end = hover.playState;
    // a banner frozen by hit-stop and then replaced: it must still leave
    let first = false; fx.banner('mate').then(() => { first = true; });
    fx.hitStop(200);
    await new Promise(r => setTimeout(r, 50));
    const p2 = fx.banner('draw');
    await new Promise(r => setTimeout(r, 400));
    const banners = [...document.querySelectorAll('.fx-banner')].map(e => e.dataset.kind);
    await p2;
    await new Promise(r => setTimeout(r, 60));
    return { mid, end, first, banners, left: document.querySelectorAll('.fx-banners > *').length, hover: hover.playState };
  });
  check('5 overlapping hit-stops hold until the later one ends; a frozen banner that is replaced still leaves', hs.mid === 'paused' && hs.end === 'running' && hs.first && hs.banners.join() === 'draw' && hs.left === 0 && hs.hover === 'running', hs);

  // 6. hit-stop must not start an animation someone else had paused
  const hp = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    const el = document.querySelector('[data-sq="9,4"]');
    const mine = el.animate([{ opacity: 1 }, { opacity: .5 }], { duration: 5000 }); mine.pause();
    fx.hitStop(80);
    await new Promise(r => setTimeout(r, 140));
    const out = { mine: mine.playState };
    mine.cancel(); return out;
  });
  check('6 hit-stop leaves an animation paused by its owner paused', hp.mine === 'paused', hp);

  // 7. popups: one at a time under rapid fire; a mark arriving first moves under the popup; the layer ends clean
  const pp = await ev(async () => {
    const fx = __lab.fx, T = __lab.pt(3, 4); fx.clear();
    for (let i = 0; i < 12; i++) fx.popup('妙计！', __lab.pt(i % 10, i % 9), { tone: 'great' });
    const many = document.querySelectorAll('.fx-popup').length, liveMany = fx.live;
    fx.clear();
    fx.popup('自己想的', T, { tone: 'mark' }); fx.popup('好棋！', T, { tone: 'good' });
    const order = { popups: document.querySelectorAll('.fx-popup').length, mark: document.querySelector('.fx-popup .fx-popup__mark')?.textContent, tone: document.querySelector('.fx-popup').dataset.tone };
    fx.popup('自己想的', T, { tone: 'mark' }); fx.popup('自己想的', T, { tone: 'mark' });
    order.marks = document.querySelectorAll('.fx-popup__mark').length;
    await new Promise(r => setTimeout(r, 1100));
    return { many, liveMany, order, end: document.querySelectorAll('.fx-banners > *').length };
  });
  check('7 twelve popups in a row leave one; their stars stay within the budget; mark-then-popup nests the mark once', pp.many === 1 && pp.liveMany <= 160 && pp.order.popups === 1 && pp.order.mark === '自己想的' && pp.order.tone === 'good' && pp.order.marks === 1 && pp.end === 0, pp);

  // 8. stamp replaced: the old promise settles, one stamp shown; missing opts do not throw
  const st = await ev(async () => {
    const fx = __lab.fx; fx.clear(); let a = false;
    fx.stamp('当头炮！', { size: 'full' }).then(() => { a = true; });
    await new Promise(r => setTimeout(r, 50));
    fx.stamp('马后炮！', { size: 'small', at: __lab.pt(3, 4) });
    await new Promise(r => setTimeout(r, 0));
    const n = document.querySelectorAll('.fx-stamp').length;
    let threw = ''; let odd = null, odd2 = null;
    try { odd = fx.stamp('x'); } catch (e) { threw = e.message; }
    try { fx.stamp('x', { size: 'huge' }); } catch (e) { threw += '|' + e.message; }
    try { odd2 = fx.projectile(__lab.pt(1, 1), __lab.pt(2, 2)); } catch (e) { threw += '|' + e.message; }
    try { fx.banner('nope'); fx.popup('x', __lab.pt(1, 1), { tone: 'nope' }); fx.shake(9); fx.hitStop(-1); fx.hitStop(NaN); fx.flash('#fff', 0); fx.haptic('nope'); fx.burst('nope', __lab.pt(1, 1)); } catch (e) { threw += '|' + e.message; }
    fx.clear();
    return { a, n, threw, oddIsPromise: !!odd && typeof odd.then === 'function', odd2IsPromise: !!odd2 && typeof odd2.then === 'function' };
  });
  check('8 a replaced stamp settles; calls with missing or unknown arguments never throw', st.a && st.n === 1 && st.threw === '' && st.oddIsPromise && st.odd2IsPromise, st);

  // 9. reduced motion switched on in the middle of everything: promises still settle, nothing keeps moving
  const rm = await ev(async () => {
    const fx = __lab.fx; fx.clear(); const s = { banner: false, stamp: false, shot: false };
    fx.banner('check').then(() => { s.banner = true; }); fx.stamp('当头炮！', { size: 'full' }).then(() => { s.stamp = true; });
    fx.projectile(__lab.pt(7, 4), __lab.pt(3, 4), { arc: 40, ms: 170 }).then(() => { s.shot = true; });
    fx.confetti(); fx.shake(3); fx.hitStop(300);
    __lab.setMotion(true);
    const at = { live: fx.live, shakes: __shakes(), hover: document.querySelector('[data-sq="7,7"]').getAnimations()[0].playState };
    let peak = 0; const t0 = performance.now();
    while (performance.now() - t0 < 1700) { peak = Math.max(peak, fx.live); await new Promise(requestAnimationFrame); }
    __lab.setMotion(false);
    return { at, s, peak, left: document.querySelectorAll('.fx-banners > *').length };
  });
  check('9 reduced motion mid-flight: particles, shake and freeze stop at once, promises settle, no sparks later', rm.at.live === 0 && rm.at.shakes === 0 && rm.at.hover === 'running' && rm.s.banner && rm.s.stamp && rm.s.shot && rm.peak === 0 && rm.left === 0, rm);

  // 10. unmounted, zero-sized, resized and remounted
  const mt = await ev(async () => {
    const { createFx } = await import('/src/ui/fx.js');
    const fx = createFx(); const out = {};
    let r1 = false, r2 = false, r3 = false;
    fx.burst('capture', { x: 1, y: 1 }); fx.confetti(); fx.wind(); fx.shake(2); fx.hitStop(50); fx.flash('#fff', 60); fx.popup('x', { x: 1, y: 1 }); fx.clear(); fx.refreshPalette(); fx.resize(0, 0, 0); fx.resize(NaN, 1, 1);
    await Promise.all([fx.banner('mate').then(() => { r1 = true; }), fx.stamp('x', { size: 'full' }).then(() => { r2 = true; }), fx.projectile({ x: 0, y: 0 }, { x: 9, y: 9 }, { arc: 1, ms: 100 }).then(() => { r3 = true; })]);
    out.unmounted = r1 && r2 && r3 && fx.live === 0;
    const wrap = document.createElement('div'); wrap.className = 'bv'; wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;--c:0px';
    const inner = document.createElement('div'); inner.className = 'bv-fx'; wrap.append(inner); document.body.append(wrap);
    fx.mount(inner);
    let z = false; await fx.banner('check').then(() => { z = true; }); fx.burst('explosion', { x: 0, y: 0 });
    out.zeroSize = z && fx.live === 0 && inner.querySelectorAll('.fx-banner').length === 0;
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:460px;height:530px;--c:50px'; inner.style.cssText = 'position:absolute;inset:0';
    fx.resize(460, 530, 50);
    fx.burst('capture', { x: 100, y: 100 }); out.afterResize = fx.live;
    const inner2 = document.createElement('div'); inner2.className = 'bv-fx'; inner2.style.cssText = 'position:absolute;inset:0'; wrap.append(inner2);
    fx.mount(inner2);
    out.remount = { old: inner.children.length, fresh: [...inner2.children].map(e => e.className).join(' '), live: fx.live };
    fx.burst('ring', { x: 50, y: 50 }); out.remountLive = fx.live;
    fx.clear(); wrap.remove();
    return out;
  });
  check('10 unmounted, zero-sized and remounted fx: inert, then working, old nodes removed', mt.unmounted && mt.zeroSize && mt.afterResize === 24 && mt.remount.old === 0 && mt.remount.fresh === 'fx-canvas fx-wind fx-flash fx-banners' && mt.remount.live === 0 && mt.remountLive === 1, mt);

  // 11. resize in flight keeps particles and settles
  const rz = await ev(async () => {
    const fx = __lab.fx, c = __lab.cell(); fx.clear();
    fx.confetti(); const p = fx.projectile(__lab.pt(7, 4), __lab.pt(3, 4), { arc: 40, ms: 170 });
    fx.resize(9.2 * c * 0.5, 10.6 * c * 0.5, c * 0.5);
    const cvs = document.querySelector('.fx-canvas'); const small = [cvs.width, cvs.height, fx.live];
    await p;
    fx.resize(9.2 * c, 10.6 * c, c);
    const back = cvs.width * cvs.height;
    await new Promise(r => setTimeout(r, 100));
    const live = fx.live; fx.clear();
    return { small, back, live };
  });
  check('11 resize in flight: the projectile settles, particles survive, the backing store stays within 1.2 M', rz.small[2] === 141 && rz.back <= 1_200_000 && rz.live > 100, rz);

  // 12. idle: nothing is left running after effects end
  const idle = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    fx.burst('explosion', __lab.pt(3, 4)); fx.banner('check'); fx.stamp('当头炮！', { size: 'small', at: __lab.pt(3, 4) }); fx.popup('好棋！', __lab.pt(3, 4)); fx.hitStop(60); fx.shake(2); fx.wind();
    await new Promise(r => setTimeout(r, 1700));
    const anims = document.getElementById('board').getAnimations({ subtree: true }).filter(a => !(a.effect.target && a.effect.target.matches('[data-sq="7,7"]')));
    return { live: fx.live, layer: document.querySelectorAll('.fx-banners > *').length, anims: anims.length, translate: getComputedStyle(document.getElementById('board')).translate };
  });
  check('12 after everything ends: no particle, no element, no animation left under the board', idle.live === 0 && idle.layer === 0 && idle.anims === 0 && idle.translate === 'none', idle);

  // 13. the projectile under hit-stop is held, not skipped
  const ph = await ev(async () => {
    const fx = __lab.fx; fx.clear(); const t0 = performance.now(); let done = 0;
    const p = fx.projectile(__lab.pt(7, 4), __lab.pt(3, 4), { arc: 40, ms: 170 }).then(() => { done = performance.now() - t0; });
    await new Promise(requestAnimationFrame);
    fx.hitStop(150);
    await p; return done;
  });
  check('13 a projectile frozen for 150 ms lands about 150 ms later', ph > 290 && ph < 420, `${Math.round(ph)} ms`);

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.error(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
  console.error(`\n${results.length - failed.length} of ${results.length} adversarial checks passed`);
  if (failed.length) throw new Error(`${failed.length} check(s) failed`);
};
