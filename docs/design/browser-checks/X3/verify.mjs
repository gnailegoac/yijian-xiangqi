// Behaviour checks for src/ui/fx.js, run in dev/fx.html through shot.mjs --steps.
// Expected values come from the contract (SPEC §4.28.2, §10.4), not from the implementation.
// VERIFY_SKIP_GOVERNOR=1 skips the (slow, real-time) governor check.

export default async ({ page }) => {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const sleep = ms => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const view = page.viewportSize();
  const c = await ev(() => __lab.cell());
  const W = 9.2 * c, H = 10.6 * c;

  await ev(() => { __lab.setMotion(false); __lab.fx.clear(); });

  // ---- A. API ------------------------------------------------------------------------------------------------------
  const keys = await ev(() => Object.keys(__lab.fx).sort());
  const want = ['mount', 'burst', 'trail', 'slash', 'projectile', 'confetti', 'wind', 'shake', 'hitStop', 'flash', 'banner', 'popup', 'stamp', 'haptic',
    'resize', 'refreshPalette', 'setReducedMotion', 'setHaptics', 'clear', 'live'].sort();
  check('A1 the controller has exactly the 20 members of 4.28.2', JSON.stringify(keys) === JSON.stringify(want), keys.join(','));
  check('A2 live is a number and 0 when idle', await ev(() => typeof __lab.fx.live === 'number' && __lab.fx.live === 0));
  const dom = await ev(() => { const r = document.querySelector('.bv-fx'); return [...r.children].map(e => e.tagName.toLowerCase() + '.' + e.className); });
  check('A3 mount builds canvas.fx-canvas and div.fx-banners inside .bv-fx', dom.includes('canvas.fx-canvas') && dom.includes('div.fx-banners'), dom.join(' '));

  // ---- B. catalogue counts at q = 1 --------------------------------------------------------------------------------
  const countOf = code => ev(src => { const fx = __lab.fx, T = __lab.pt(3, 4), P = __lab.pt(7, 4); fx.clear(); new Function('fx', 'T', 'P', src)(fx, T, P); const n = fx.live; fx.clear(); return n; }, code);
  const counts = [
    ['dust default', "fx.burst('dust', T)", 8], ['dust n:2 (clamped to 4)', "fx.burst('dust', T, {n:2})", 4], ['dust n:20 (clamped to 8)', "fx.burst('dust', T, {n:20})", 8],
    ['dust n:6', "fx.burst('dust', T, {n:6, dir:1})", 6], ['ring', "fx.burst('ring', T)", 1],
    ['capture n:24', "fx.burst('capture', T, {n:24})", 24], ['capture default', "fx.burst('capture', T)", 24], ['capture scale 1.25 (24·s)', "fx.burst('capture', T, {scale:1.25})", 30],
    ['capture n:12 (pawn poke)', "fx.burst('capture', T, {n:12, dir:0})", 12],
    ['explosion 48 + 8 + 1', "fx.burst('explosion', T)", 57],
    ['sparks n:16', "fx.burst('sparks', T, {n:16})", 16], ['sparks n:6', "fx.burst('sparks', T, {n:6, dir:0})", 6], ['sparks n:3 (clamped to 6)', "fx.burst('sparks', T, {n:3})", 6],
    ['sparks n:40 (clamped to 16)', "fx.burst('sparks', T, {n:40})", 16],
    ['splash', "fx.burst('splash', T)", 18], ['stars', "fx.burst('stars', T)", 14], ['stars n:8', "fx.burst('stars', T, {n:8})", 8], ['trail burst', "fx.burst('trail', T)", 10],
    ['trail(from, to)', 'fx.trail(P, T)', 10], ['slash 1 arc + 8 sparks', 'fx.slash(T)', 9], ['confetti', 'fx.confetti()', 140], ['confetti n:20', 'fx.confetti({n:20})', 20],
    ['wind', 'fx.wind()', 14], ['projectile (the ember)', 'fx.projectile(P, T, {arc: 50, ms: 170})', 1],
    ['pool capacity 320', 'for (let i = 0; i < 5; i++) fx.confetti()', 320],
    ['worst case in play: 6 + 11 + 57 + 16', "fx.burst('sparks', P, {n:6, dir:0}); fx.projectile(P, T, {arc:50, ms:170}); fx.trail(P, T); fx.burst('explosion', T); fx.burst('sparks', T, {n:16})", 90],
    ['end of game: 140 + 14', "fx.confetti(); fx.burst('stars', T, {n:14})", 154],
  ];
  for (const [name, code, expected] of counts) { const got = await countOf(code); check(`B count: ${name} = ${expected}`, got === expected, `got ${got}`); }

  // projectile: 1 + 10 trail, resolves after ms
  const proj = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    const t0 = performance.now(); let peak = 0, done = false;
    const p = fx.projectile(__lab.pt(7, 4), __lab.pt(3, 4), { arc: 0.9 * __lab.cell(), ms: 170 }).then(() => { done = performance.now() - t0; });
    while (!done) { peak = Math.max(peak, fx.live); await new Promise(requestAnimationFrame); }
    await p; return { peak, done };
  });
  check('B projectile peaks at 1 + 10 trail particles', proj.peak <= 11 && proj.peak >= 8, `peak ${proj.peak}`);
  check('B projectile resolves after about ms (170)', proj.done >= 165 && proj.done < 260, `${proj.done.toFixed(0)} ms`);

  // ---- C. the two worst loads as they are choreographed ------------------------------------------------------------
  const peakOf = name => ev(async scene => {
    const fx = __lab.fx; fx.clear(); let peak = 0, done = false;
    __lab.scenes[scene]().then(() => { done = true; });
    const t0 = performance.now();
    while ((!done || fx.live > 0) && performance.now() - t0 < 9000) { peak = Math.max(peak, fx.live); await new Promise(requestAnimationFrame); }
    return peak;
  }, name);
  const p1 = await peakOf('cannonCheck');
  check('C cannon shot with check stays within 90 live', p1 > 40 && p1 <= 90, `peak ${p1}`);
  const p2 = await peakOf('mateWin');
  check('C mate + win stays within the 160 budget', p2 >= 140 && p2 <= 160, `peak ${p2}`);
  check('C the quality tier is still 1 after normal play', (await ev(() => __lab.q())) === 1);

  // ---- D. shake ----------------------------------------------------------------------------------------------------
  const shakeInfo = level => ev(lv => {
    const fx = __lab.fx; fx.clear(); fx.shake(lv);
    const anims = document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k));
    if (anims.length !== 1) return { n: anims.length };
    const kf = anims[0].effect.getKeyframes();
    const amp = kf.map(k => { const [x, y] = k.translate.split(' ').map(parseFloat); return Math.hypot(x, y || 0); });
    return { n: 1, frames: kf.length, duration: anims[0].effect.getTiming().duration, easing: anims[0].effect.getTiming().easing, amp };
  }, level);
  for (const [level, amp, ms] of [[1, 2, 120], [2, 4, 200], [3, Math.min(7, 0.18 * c), 320]]) {
    const s = await shakeInfo(level);
    const linear = s.amp && s.amp.every((a, i) => near(a, amp * (1 - i / 7), 0.02));
    check(`D shake(${level}): ${amp.toFixed(2)} px, ${ms} ms, 8 keyframes decaying linearly, on .bv translate`, s.n === 1 && s.frames === 8 && s.duration === ms && s.easing === 'linear' && linear, JSON.stringify(s));
  }
  const replaced = await ev(() => { const fx = __lab.fx; fx.shake(1); fx.shake(3); return document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length; });
  check('D a new shake replaces the running one', replaced === 1, `animations ${replaced}`);

  // ---- E. hit-stop -------------------------------------------------------------------------------------------------
  const hs = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    const hover = document.querySelector('[data-sq="7,7"]').getAnimations()[0];
    const before = hover.playState;
    fx.burst('ring', __lab.pt(3, 4));                       // lives 300 ms
    fx.hitStop(300);
    const during = hover.playState;
    await new Promise(r => setTimeout(r, 250));
    const liveDuring = fx.live, still = hover.playState;
    await new Promise(r => setTimeout(r, 120));
    const after = hover.playState, liveAfterThaw = fx.live;
    await new Promise(r => setTimeout(r, 400));
    return { before, during, still, after, liveDuring, liveAfterThaw, liveEnd: fx.live };
  });
  check('E hitStop pauses running animations under .bv and resumes them after ms', hs.before === 'running' && hs.during === 'paused' && hs.still === 'paused' && hs.after === 'running', JSON.stringify(hs));
  check('E particles are not integrated during hit-stop (a 300 ms ring outlives a 300 ms stop)', hs.liveDuring === 1 && hs.liveAfterThaw === 1 && hs.liveEnd === 0, JSON.stringify(hs));

  // ---- F. flash ----------------------------------------------------------------------------------------------------
  const fl = await ev(async () => {
    const fx = __lab.fx, el = document.querySelector('.fx-flash');
    const idle = getComputedStyle(el).opacity;
    fx.flash('#fff', 120);
    const start = Number(getComputedStyle(el).opacity), bg = getComputedStyle(el).backgroundColor, tr = getComputedStyle(el).transitionDuration;
    await new Promise(r => setTimeout(r, 60));
    const mid = Number(getComputedStyle(el).opacity);
    await new Promise(r => setTimeout(r, 140));
    const end = Number(getComputedStyle(el).opacity);
    fx.flash('--danger', 100);
    const bg2 = getComputedStyle(el).backgroundColor, danger = getComputedStyle(el).getPropertyValue('--danger').trim();
    await new Promise(r => setTimeout(r, 150));
    return { idle, start, mid, end, bg, tr, bg2, danger };
  });
  check('F flash: opacity .35 -> 0 over ms, CSS transition, full-board overlay', fl.idle === '0' && near(fl.start, 0.35, 0.03) && fl.mid > 0.02 && fl.mid < 0.34 && fl.end === 0 && fl.tr === '0.12s' && fl.bg === 'rgb(255, 255, 255)', JSON.stringify(fl));
  check('F flash accepts a token (--danger)', fl.bg2 === 'rgb(255, 107, 94)', fl.bg2);

  // ---- G. banners --------------------------------------------------------------------------------------------------
  const TEXT = { start: '开战！', check: '将军！', mate: '绝杀！', stalemate: '困毙！', lose: '惜败，再战！', draw: '握手言和', river: '过河！' };
  const TONE = { start: 'mine', check: 'mine', mate: 'mine', stalemate: 'mine', lose: 'calm', draw: 'calm', river: 'calm' };
  const SIZE = { start: 2.0, check: 2.0, mate: 2.6, stalemate: 2.0, lose: 1.5, draw: 1.5, river: 1.1 };
  const TOTAL = { start: 220 + 600 + 200, check: 180 + 450 + 200, mate: 220 + 900 + 250, stalemate: 220 + 800 + 200, lose: 300 + 900 + 300, draw: 300 + 900 + 300, river: 160 + 400 + 140 };
  for (const kind of Object.keys(TEXT)) {
    const b = await ev(async k => {
      const fx = __lab.fx; fx.clear();
      const t0 = performance.now();
      const p = fx.banner(k);
      const els = document.querySelectorAll('.fx-banner');
      const el = els[0], br = el.getBoundingClientRect(), bo = document.getElementById('board').getBoundingClientRect();
      const info = { n: els.length, kind: el.dataset.kind, tone: el.dataset.tone, text: el.textContent, fs: parseFloat(getComputedStyle(el).fontSize), h: el.offsetHeight, w: el.offsetWidth,
        mid: el.offsetTop + el.offsetHeight / 2, left: el.offsetLeft, role: el.getAttribute('role'), font: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight,
        textW: el.querySelector('.fx-banner__text').offsetWidth, svg: el.querySelector('svg').getAttribute('viewBox') + '|' + el.querySelector('svg').getAttribute('preserveAspectRatio'),
        path: el.querySelector('path').getAttribute('d') };
      await p;
      info.ms = performance.now() - t0; info.left_after = document.querySelectorAll('.fx-banner').length;
      return info;
    }, kind);
    const specFs = SIZE[kind] * Math.max(20, Math.min(48, c));          // 2.0 c (40–96 px), other sizes in proportion
    const fsOk = (near(b.fs, specFs, 0.1) && b.textW <= 0.92 * W + 1) || (b.fs < specFs && near(b.textW, 0.92 * W, 2));   // set smaller only when it would not fit
    const fs = b.fs;
    check(`G banner ${kind}: 「${TEXT[kind]}」 tone ${TONE[kind]}, font ${specFs.toFixed(1)} px (or fitted), band 1.6 x font, full width, on the centre line`,
      b.n === 1 && b.kind === kind && b.tone === TONE[kind] && b.text === TEXT[kind] && fsOk && near(b.h, 1.6 * fs, 1.5) && near(b.w, W, 1.5) && near(b.mid, H / 2, 1.5) && b.left === 0 &&
      b.role === null && b.weight === '700' && /KaiTi/.test(b.font) && b.svg === '0 0 400 60|none' && b.path.startsWith('M4 30 C20 8 60 6 110 10'), JSON.stringify({ ...b, path: undefined, font: undefined }));
    check(`G banner ${kind}: resolves after in + hold + out = ${TOTAL[kind]} ms and removes itself`, b.ms >= TOTAL[kind] - 20 && b.ms <= TOTAL[kind] + 120 && b.left_after === 0, `${b.ms.toFixed(0)} ms`);
    check(`G banner ${kind}: the text fits the board`, b.textW <= W, `text ${b.textW.toFixed(0)} of ${W.toFixed(0)}`);
  }
  const tones = await ev(() => {
    const fx = __lab.fx, out = {};
    for (const tone of ['mine', 'danger', 'calm']) {
      fx.clear(); fx.banner('check', { tone });
      const el = document.querySelector('.fx-banner'), cs = getComputedStyle(el);
      out[tone] = { tone: el.dataset.tone, ink: cs.color, band: getComputedStyle(el.querySelector('.fx-brush--fill')).fill, line: getComputedStyle(el.querySelector('.fx-brush--fill')).stroke };
    }
    fx.clear(); fx.banner('river'); out.river = getComputedStyle(document.querySelector('.fx-banner')).color;
    fx.clear(); return out;
  });
  check('G tone mine: band --accent at 92 %, text --accent-ink', /0\.92/.test(tones.mine.band) && tones.mine.ink === 'rgb(42, 22, 0)', JSON.stringify(tones.mine));
  check('G tone danger: band --danger, text --danger-ink', tones.danger.band === 'rgb(255, 107, 94)' && tones.danger.ink === 'rgb(42, 10, 6)', JSON.stringify(tones.danger));
  check('G tone calm: band --surface at 92 %, text --ink, --edge line', /0\.92/.test(tones.calm.band) && tones.calm.ink === 'rgb(238, 242, 255)' && tones.calm.line === 'rgb(47, 59, 99)', JSON.stringify(tones.calm));
  check('G river text is --fx-cool', tones.river === 'rgb(88, 220, 255)', tones.river);

  const avoid = await ev(() => {
    const fx = __lab.fx, c = __lab.cell(), out = {};
    const mid = () => { const el = document.querySelector('.fx-banner'); return [(el.offsetTop + el.offsetHeight / 2) / (10.6 * c), el.offsetHeight / 2]; };
    for (const row of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) { fx.clear(); fx.banner('check', { avoid: __lab.pt(row, 4) }); out[row] = mid(); }
    fx.clear(); return out;
  });
  let avoidOk = true; const avoidDetail = [];
  for (let row = 0; row <= 9; row++) {
    const [at, half] = avoid[row], y = (0.8 + row) * c;
    const within = Math.abs(y - H / 2) <= half + 1.2 * c;
    const expected = within ? (y < H / 2 ? 0.75 : 0.25) : 0.5;
    avoidDetail.push(`${row}:${at.toFixed(2)}`);
    if (!near(at, expected, 0.01)) avoidOk = false;
  }
  check('G avoid: the band moves to the other half when the point is within 1.2 c of it, else stays on the centre line', avoidOk, avoidDetail.join(' '));

  const one = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    const t0 = performance.now(); let first = -1;
    fx.banner('mate').then(() => { first = performance.now() - t0; });
    await new Promise(r => setTimeout(r, 100));
    fx.banner('lose');
    await new Promise(r => setTimeout(r, 30));
    const during = document.querySelectorAll('.fx-banner').length;
    await new Promise(r => setTimeout(r, 150));
    const kinds = [...document.querySelectorAll('.fx-banner')].map(e => e.dataset.kind);
    fx.clear();
    return { first, during, kinds };
  });
  check('G one banner at a time: a new one replaces the current with an 80 ms fade and settles its promise', one.first >= 90 && one.first < 160 && one.during === 2 && one.kinds.join() === 'lose', JSON.stringify(one));

  const slam = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    fx.banner('check', { tone: 'danger' });
    const flash = document.querySelector('.fx-flash');
    await new Promise(r => setTimeout(r, 150));
    const before = { live: fx.live, shake: document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length };
    await new Promise(r => setTimeout(r, 70));
    const after = { live: fx.live, shake: document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length, flash: Number(getComputedStyle(flash).opacity),
      flashBg: getComputedStyle(flash).backgroundColor };
    fx.clear();
    return { before, after };
  });
  check('G check slam: nothing before landing; on landing shake(2) and 16 sparks (the flash, sounds and haptics belong to the caller)', slam.before.live === 0 && slam.before.shake === 0 && slam.after.live === 16 && slam.after.shake === 1 && slam.after.flash === 0, JSON.stringify(slam));
  const calmBanner = await ev(async () => {
    const fx = __lab.fx; fx.clear(); fx.banner('lose'); let peak = 0, shakes = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 500) { peak = Math.max(peak, fx.live); shakes = Math.max(shakes, document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length); await new Promise(requestAnimationFrame); }
    const anims = document.querySelector('.fx-banner').getAnimations({ subtree: true }).flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k)));
    fx.clear(); return { peak, shakes, clip: anims.includes('clipPath') };
  });
  check('G lose banner: never a slam (no sparks, no shake, no wipe)', calmBanner.peak === 0 && calmBanner.shakes === 0 && !calmBanner.clip, JSON.stringify(calmBanner));

  // ---- H. popups ---------------------------------------------------------------------------------------------------
  const STARS = { good: 0, great: 8, brilliant: 14, lord: 14 };
  for (const tone of Object.keys(STARS)) {
    const p = await ev(async t => {
      const fx = __lab.fx; fx.clear();
      const at = __lab.pt(3, 4);
      fx.popup('妙计！', at, { tone: t });
      const els = document.querySelectorAll('.fx-popup'), el = els[0];
      const info = { n: els.length, tone: el.dataset.tone, text: el.querySelector('.fx-popup__text').textContent, fs: parseFloat(getComputedStyle(el).fontSize), live: fx.live,
        weight: getComputedStyle(el).fontWeight, band: !!el.querySelector('svg'), bottom: el.offsetTop + el.offsetHeight, cx: el.offsetLeft + el.offsetWidth / 2, atY: at.y, atX: at.x };
      const t0 = performance.now();
      while (document.querySelector('.fx-popup') && performance.now() - t0 < 2000) await new Promise(requestAnimationFrame);
      info.ms = performance.now() - t0;
      return info;
    }, tone);
    check(`H popup ${tone}: .fx-popup[data-tone], font max(20px, .62c), ${STARS[tone]} stars, above the square, gone after 900 ms`,
      p.n === 1 && p.tone === tone && p.text === '妙计！' && near(p.fs, Math.max(20, 0.62 * c), 0.1) && p.live === STARS[tone] && p.weight === '700' && p.band === (tone === 'lord') &&
      p.bottom <= p.atY - 0.4 * c && near(p.cx, p.atX, 2) && p.ms >= 860 && p.ms <= 1050, JSON.stringify(p));
  }
  const pop2 = await ev(async () => {
    const fx = __lab.fx, c = __lab.cell(), out = {}; fx.clear();
    fx.popup('好棋！', __lab.pt(3, 4)); out.defaultTone = document.querySelector('.fx-popup').dataset.tone;
    fx.popup('妙计！', __lab.pt(5, 2), { tone: 'great' }); out.oneAtATime = [...document.querySelectorAll('.fx-popup')].map(e => e.textContent).join('|');
    fx.popup('自己想的', __lab.pt(5, 2), { tone: 'mark' });
    const pop = document.querySelector('.fx-popup'), mark = pop.querySelector('.fx-popup__mark');
    out.markUnder = !!mark && mark.textContent === '自己想的' && mark.getBoundingClientRect().top >= pop.querySelector('.fx-popup__text').getBoundingClientRect().bottom - 2;
    out.markFs = parseFloat(getComputedStyle(mark).fontSize) / c; out.popups = document.querySelectorAll('.fx-popup').length;
    fx.clear();
    fx.popup('自己想的', __lab.pt(5, 2), { tone: 'mark' });
    const alone = document.querySelector('.fx-popup'); out.aloneTone = alone.dataset.tone; out.aloneFs = parseFloat(getComputedStyle(alone).fontSize) / c; out.aloneLive = fx.live;
    out.aloneAbove = alone.offsetTop + alone.offsetHeight <= __lab.pt(5, 2).y - 0.4 * c;
    const t0 = performance.now();
    while (document.querySelector('.fx-popup') && performance.now() - t0 < 2000) await new Promise(requestAnimationFrame);
    out.aloneMs = performance.now() - t0;
    // clamped inside the board, in every corner, from first to last frame
    out.inside = true;
    const board = document.getElementById('board').getBoundingClientRect();
    for (const [row, col] of [[0, 0], [0, 8], [9, 0], [9, 8], [0, 4]]) {
      fx.clear(); fx.popup('神来之笔！', __lab.pt(row, col), { tone: 'brilliant' });
      const el = document.querySelector('.fx-popup');
      for (const t of [0, 450, 899]) {
        for (const a of el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = t; }
        const r = el.getBoundingClientRect();
        if (r.left < board.left - 0.5 || r.right > board.right + 0.5 || r.top < board.top - 0.5 || r.bottom > board.bottom + 0.5) out.inside = false;
      }
    }
    fx.clear();
    return out;
  });
  check('H popup: tone defaults to good; one at a time', pop2.defaultTone === 'good' && pop2.oneAtATime === '妙计！', JSON.stringify(pop2));
  check('H mark: 自己想的 hangs under the praise popup at .42 c', pop2.markUnder && near(pop2.markFs, 0.42, 0.005) && pop2.popups === 1, JSON.stringify(pop2));
  check('H mark alone: above the piece for 700 ms, no particles', pop2.aloneTone === 'mark' && near(pop2.aloneFs, 0.42, 0.005) && pop2.aloneLive === 0 && pop2.aloneAbove && pop2.aloneMs >= 670 && pop2.aloneMs <= 850, JSON.stringify(pop2));
  check('H popup stays inside the board in every corner while it rises', pop2.inside);

  // ---- I. stamps ---------------------------------------------------------------------------------------------------
  const st = await ev(async () => {
    const fx = __lab.fx, c = __lab.cell(), out = {}; fx.clear();
    let t0 = performance.now();
    const p = fx.stamp('当头炮！', { size: 'full' });
    const el = document.querySelector('.fx-stamp'), seal = el.querySelector('.fx-stamp__seal'), cs = getComputedStyle(seal);
    out.full = { n: document.querySelectorAll('.fx-stamp').length, text: el.textContent, fs: parseFloat(getComputedStyle(el).fontSize) / c, rotate: getComputedStyle(el).rotate,
      cx: (el.offsetLeft + el.offsetWidth / 2) / (9.2 * c), cy: (el.offsetTop + el.offsetHeight / 2) / (10.6 * c), color: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight,
      border: parseFloat(cs.borderTopWidth) / parseFloat(cs.fontSize), outline: parseFloat(cs.outlineWidth) / parseFloat(cs.fontSize), offset: parseFloat(cs.outlineOffset) / parseFloat(cs.fontSize),
      radius: parseFloat(cs.borderTopLeftRadius) / parseFloat(cs.fontSize), padV: parseFloat(cs.paddingTop) / parseFloat(cs.fontSize), padH: parseFloat(cs.paddingLeft) / parseFloat(cs.fontSize),
      liveStart: fx.live };
    await new Promise(r => setTimeout(r, 215));
    out.full.liveLanded = fx.live;
    out.full.shake = document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length;
    await p; out.full.ms = performance.now() - t0; out.full.left = document.querySelectorAll('.fx-stamp').length;
    t0 = performance.now();
    const at = __lab.pt(3, 4);
    const q = fx.stamp('马后炮！', { size: 'small', at });
    const s = document.querySelector('.fx-stamp');
    out.small = { fs: parseFloat(getComputedStyle(s).fontSize) / c, cx: s.offsetLeft + s.offsetWidth / 2 - at.x, cy: (at.y - (s.offsetTop + s.offsetHeight / 2)) / c };
    let peak = 0; let done = false; q.then(() => { done = true; });
    while (!done) { peak = Math.max(peak, fx.live); await new Promise(requestAnimationFrame); }
    out.small.ms = performance.now() - t0; out.small.peak = peak;
    // a long name never leaves the board
    fx.stamp('大胆穿心大胆穿心！', { size: 'full' });
    const long = document.querySelector('.fx-stamp'); out.longW = long.offsetWidth / (9.2 * c);
    fx.stamp('双车错！', { size: 'small', at: __lab.pt(0, 0) });
    const edge = document.querySelector('.fx-stamp'); out.edge = { left: edge.offsetLeft, top: edge.offsetTop, n: document.querySelectorAll('.fx-stamp').length };
    fx.clear();
    return out;
  });
  const snap = Math.max(0.012, 1 / (1.5 * c));             // borders snap to whole pixels
  check('I stamp full: seal red (--danger), 1.5 c, rotated -8°, centred at 34 % of the board height, the double box of 10.4.4',
    st.full.n === 1 && st.full.text === '当头炮！' && near(st.full.fs, 1.5, 0.01) && st.full.rotate === '-8deg' && near(st.full.cx, 0.5, 0.005) && near(st.full.cy, 0.34, 0.005) &&
    st.full.color === 'rgb(255, 107, 94)' && st.full.weight === '700' && near(st.full.border, 0.08, snap) && near(st.full.outline, 0.03, snap) && near(st.full.offset, 0.06, snap) &&
    near(st.full.radius, 0.12, 0.012) && near(st.full.padV, 0.08, 0.012) && near(st.full.padH, 0.3, 0.012), JSON.stringify(st.full));
  check('I stamp full: on landing shake(1) and 10 sparks; resolves after 160 + 900 + 250 ms', st.full.liveStart === 0 && st.full.liveLanded === 10 && st.full.shake === 1 && st.full.ms >= 1290 && st.full.ms <= 1450 && st.full.left === 0, JSON.stringify(st.full));
  check('I stamp small: .7 c, .9 c above the square, no sparks, resolves after 120 + 500 + 200 ms', near(st.small.fs, 0.7, 0.01) && near(st.small.cx, 0, 1) && near(st.small.cy, 0.9, 0.02) && st.small.peak === 0 && st.small.ms >= 800 && st.small.ms <= 960, JSON.stringify(st.small));
  check('I stamp: a long name is fitted, an edge square is clamped, one stamp at a time', st.longW <= 0.93 && st.edge.left >= 0 && st.edge.top >= 0 && st.edge.n === 1, JSON.stringify({ longW: st.longW, edge: st.edge }));

  // ---- J. clear ----------------------------------------------------------------------------------------------------
  const cl = await ev(async () => {
    const fx = __lab.fx; fx.clear();
    const settled = { banner: false, stamp: false, projectile: false };
    fx.banner('mate').then(() => { settled.banner = true; });
    fx.stamp('当头炮！', { size: 'full' }).then(() => { settled.stamp = true; });
    fx.projectile(__lab.pt(7, 4), __lab.pt(3, 4), { arc: 40, ms: 5000 }).then(() => { settled.projectile = true; });
    fx.popup('妙计！', __lab.pt(3, 4), { tone: 'great' }); fx.confetti(); fx.shake(3); fx.hitStop(5000); fx.flash('#fff', 5000); fx.burst('ring', __lab.pt(1, 1));
    const hover = document.querySelector('[data-sq="7,7"]').getAnimations()[0];
    const before = { live: fx.live, els: document.querySelectorAll('.fx-banner, .fx-popup, .fx-stamp').length, hover: hover.playState };
    fx.clear();
    await new Promise(r => setTimeout(r, 20));
    return { before, settled, live: fx.live, els: document.querySelectorAll('.fx-banner, .fx-popup, .fx-stamp, .fx-ring').length, hover: hover.playState,
      shake: document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length, flash: getComputedStyle(document.querySelector('.fx-flash')).opacity };
  });
  check('J clear(): kills particles, projectile, banner, popup, stamp, shake, ends the hit-stop and resolves pending promises',
    cl.before.live > 140 && cl.before.els === 3 && cl.before.hover === 'paused' && cl.settled.banner && cl.settled.stamp && cl.settled.projectile && cl.live === 0 && cl.els === 0 && cl.hover === 'running' && cl.shake === 0 && cl.flash === '0', JSON.stringify(cl));

  // ---- K. canvas and loop ------------------------------------------------------------------------------------------
  const cv = await ev(async () => {
    const fx = __lab.fx, c = __lab.cell(), cvs = document.querySelector('.fx-canvas'), board = document.getElementById('board').getBoundingClientRect(), r = cvs.getBoundingClientRect();
    const out = { pixels: cvs.width * cvs.height, w: cvs.width, h: cvs.height, dpr: devicePixelRatio, bleedL: (board.left - r.left) / c, bleedT: (board.top - r.top) / c, cssW: r.width, cssH: r.height,
      pe: getComputedStyle(cvs).pointerEvents, canvases: document.querySelectorAll('.bv canvas').length };
    // the loop runs only while something is alive
    const raf = window.requestAnimationFrame; let frames = 0;
    window.requestAnimationFrame = cb => { if (cb.name === 'frame') frames++; return raf(cb); };
    fx.clear();
    await new Promise(r2 => setTimeout(r2, 200)); out.idleFrames = frames;
    fx.burst('ring', __lab.pt(3, 4));
    await new Promise(r2 => setTimeout(r2, 450)); out.busyFrames = frames - out.idleFrames; const mark = frames;
    await new Promise(r2 => setTimeout(r2, 300)); out.afterFrames = frames - mark; out.live = fx.live;
    window.requestAnimationFrame = raf;
    // the canvas is left empty when everything has died
    const g = cvs.getContext('2d'), data = g.getImageData(0, 0, cvs.width, cvs.height).data; let dirty = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) dirty++;
    out.dirty = dirty;
    return out;
  });
  const cssW = W + c, cssH = H + c, scale = Math.min(cv.dpr, 2, Math.sqrt(1_200_000 / (cssW * cssH)));
  check('K one canvas, bleeding .5 c, pointer-events none, backing store <= 1.2 M pixels at min(dpr, 2, sqrt(1.2M / css area))',
    cv.canvases === 1 && near(cv.bleedL, 0.5, 0.01) && near(cv.bleedT, 0.5, 0.01) && cv.pe === 'none' && cv.pixels <= 1_200_000 && near(cv.w, cssW * scale, 1.01) && near(cv.h, cssH * scale, 1.01), JSON.stringify(cv));
  check('K requestAnimationFrame runs only while particles are alive; the canvas ends empty', cv.idleFrames === 0 && cv.busyFrames >= 10 && cv.busyFrames <= 40 && cv.afterFrames === 0 && cv.live === 0 && cv.dirty === 0, JSON.stringify(cv));

  // ---- L. haptics --------------------------------------------------------------------------------------------------
  const hp = await ev(() => {
    const fx = __lab.fx, calls = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: p => { calls.push(p); return true; } });
    for (const k of ['tap', 'place', 'capture', 'blast', 'check', 'win', 'illegal']) fx.haptic(k);
    const on = JSON.stringify(calls); calls.length = 0;
    fx.setHaptics(false); fx.haptic('win'); const off = calls.length;
    fx.setHaptics(true); fx.setReducedMotion(true); fx.haptic('win'); const reduced = calls.length;
    fx.setReducedMotion(false); fx.haptic('tap'); const back = calls.length;
    return { on, off, reduced, back };
  });
  check('L haptic patterns of 10.4.3; silent when haptics are off or motion is reduced', hp.on === '[8,12,25,[15,40,35],[30,40,30],[20,30,20,30,60],[6,30,6]]' && hp.off === 0 && hp.reduced === 0 && hp.back === 1, JSON.stringify(hp));

  // ---- M. reduced motion -------------------------------------------------------------------------------------------
  const rm = await ev(async () => {
    const fx = __lab.fx, T = __lab.pt(3, 4), P = __lab.pt(7, 4), out = {}; fx.clear();
    fx.confetti();
    __lab.setMotion(true);                                  // html[data-motion=reduced] + fx.setReducedMotion(true)
    out.killedOnSwitch = fx.live;
    out.motionAttr = document.documentElement.dataset.motion;
    const live = [];
    for (const k of ['dust', 'ring', 'capture', 'explosion', 'sparks', 'splash', 'stars', 'trail']) { fx.burst(k, T, { dir: 0 }); live.push(fx.live); }
    fx.trail(P, T); live.push(fx.live); fx.slash(T); live.push(fx.live); fx.confetti(); live.push(fx.live); fx.wind(); live.push(fx.live);
    out.live = live.join('');
    out.rings = document.querySelectorAll('.fx-ring').length;            // ring + explosion
    let resolved = false; fx.projectile(P, T, { arc: 50, ms: 170 }).then(() => { resolved = true; });
    await Promise.resolve(); await Promise.resolve();
    out.projectileAtOnce = resolved; out.ringsAfterProjectile = document.querySelectorAll('.fx-ring').length;
    const hover = document.querySelector('[data-sq="7,7"]').getAnimations()[0];
    fx.shake(3); fx.hitStop(300); fx.flash('#fff', 100);
    out.shake = document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length;
    out.hover = hover.playState; out.flash = getComputedStyle(document.querySelector('.fx-flash')).opacity;
    out.wind = document.querySelector('.fx-wind > i').getAnimations().length;
    await new Promise(r => setTimeout(r, 300)); out.ringsLater = document.querySelectorAll('.fx-ring').length;
    // banner: fade 150 / hold 800 / fade 150 for check, no transform, no wipe, no shake, no sparks
    let t0 = performance.now();
    const p = fx.banner('check', { tone: 'danger' });
    const b = document.querySelector('.fx-banner');
    const props = new Set(b.getAnimations({ subtree: true }).flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k))));
    out.bannerProps = [...props].join(); let peak = 0, shakes = 0, done = false; p.then(() => { done = true; });
    while (!done) { peak = Math.max(peak, fx.live); shakes = Math.max(shakes, document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length); await new Promise(requestAnimationFrame); }
    out.bannerMs = performance.now() - t0; out.bannerLive = peak; out.bannerShake = shakes; out.bannerFlash = getComputedStyle(document.querySelector('.fx-flash')).opacity;
    // popup: in place, hold 900, fade 200, no stars
    fx.popup('神来之笔！', T, { tone: 'brilliant' });
    const pop = document.querySelector('.fx-popup');
    out.popupProps = [...new Set(pop.getAnimations({ subtree: true }).flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k))))].join();
    out.popupLive = fx.live; t0 = performance.now();
    while (document.querySelector('.fx-popup')) await new Promise(requestAnimationFrame);
    out.popupMs = performance.now() - t0;
    // stamp: fade in / out, no shake, no sparks
    t0 = performance.now(); peak = 0; shakes = 0; done = false;
    fx.stamp('当头炮！', { size: 'full' }).then(() => { done = true; });
    out.stampProps = [...new Set(document.querySelector('.fx-stamp').getAnimations({ subtree: true }).flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k))))].join();
    while (!done) { peak = Math.max(peak, fx.live); shakes = Math.max(shakes, document.getElementById('board').getAnimations().filter(a => a.effect.getKeyframes().some(k => 'translate' in k)).length); await new Promise(requestAnimationFrame); }
    out.stampMs = performance.now() - t0; out.stampLive = peak; out.stampShake = shakes;
    __lab.setMotion(false);
    fx.burst('ring', T); out.backToFull = fx.live; fx.clear();
    return out;
  });
  check('M reduced motion: switching it on kills live particles; no particle is ever spawned', rm.killedOnSwitch === 0 && rm.live === '000000000000' && rm.motionAttr === 'reduced', JSON.stringify({ killed: rm.killedOnSwitch, live: rm.live }));
  check('M reduced motion: ring and explosion leave a static CSS ring that fades in 200 ms; the projectile resolves at once with a target ring only', rm.rings === 2 && rm.projectileAtOnce && rm.ringsAfterProjectile === 3 && rm.ringsLater === 0, JSON.stringify(rm));
  check('M reduced motion: shake, hit-stop, flash and wind are off', rm.shake === 0 && rm.hover === 'running' && rm.flash === '0' && rm.wind === 0, JSON.stringify(rm));
  check('M reduced motion: check banner = fade 150 / hold 800 / fade 150, opacity only, no sparks, no shake, no flash', rm.bannerProps === 'opacity' && rm.bannerMs >= 1080 && rm.bannerMs <= 1250 && rm.bannerLive === 0 && rm.bannerShake === 0 && rm.bannerFlash === '0', JSON.stringify(rm));
  check('M reduced motion: popup in place, hold 900 + fade 200, no stars', rm.popupProps === 'opacity' && rm.popupLive === 0 && rm.popupMs >= 1070 && rm.popupMs <= 1250, JSON.stringify(rm));
  check('M reduced motion: stamp fades in and out, no shake, no sparks', rm.stampProps === 'opacity' && rm.stampLive === 0 && rm.stampShake === 0 && rm.stampMs >= 1180 && rm.stampMs <= 1400, JSON.stringify(rm));
  check('M full motion comes back when the switch is turned off', rm.backToFull === 1);

  // ---- N. themes ---------------------------------------------------------------------------------------------------
  const th = await ev(() => {
    const fx = __lab.fx, out = {};
    const paint = () => { // draw one frame synchronously is not possible; read the canvas after a forced frame instead
      return null; };
    for (const id of ['chibi', 'longzhong', 'shachang']) {
      __lab.setTheme(id);
      fx.clear(); fx.banner('check');
      const el = document.querySelector('.fx-banner');
      out[id] = { ink: getComputedStyle(el).color, band: getComputedStyle(el.querySelector('.fx-brush--fill')).fill };
      fx.clear();
    }
    __lab.setTheme('chibi');
    return out;
  });
  const srgb = (v, hex) => { const m = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+) \/ 0\.92\)/.exec(v); return !!m && [1, 2, 3].every(i => near(Number(m[i]) * 255, parseInt(hex.slice(2 * i - 1, 2 * i + 1), 16), 0.6)); };
  check('N banners follow the theme tokens (accent at 92 % / accent-ink of the three themes)', srgb(th.chibi.band, '#ffb347') && srgb(th.longzhong.band, '#2f7d4f') && srgb(th.shachang.band, '#e8a33d') && th.chibi.ink === 'rgb(42, 22, 0)' && th.longzhong.ink === 'rgb(255, 255, 255)' && th.shachang.ink === 'rgb(42, 23, 0)', JSON.stringify(th));
  const pal = await ev(async () => {
    const fx = __lab.fx, cvs = document.querySelector('.fx-canvas'), out = {};
    const sample = async (theme) => {
      __lab.setTheme(theme); fx.clear();
      fx.burst('ring', __lab.pt(4, 4), { size: 2 });       // default colour: --sel
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const g = cvs.getContext('2d'), d = g.getImageData(0, 0, cvs.width, cvs.height).data; const seen = {};
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; seen[k] = (seen[k] || 0) + 1; }
      fx.clear();
      return Object.entries(seen).sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    out.chibi = await sample('chibi'); out.longzhong = await sample('longzhong'); out.shachang = await sample('shachang');
    __lab.setTheme('chibi');
    return out;
  });
  check('N refreshPalette: the ring is drawn in --sel of each theme (#ffd166 / #1f6b3f / #7a1f12)', pal.chibi === '255,209,102' && pal.longzhong === '31,107,63' && pal.shachang === '122,31,18', JSON.stringify(pal));

  // ---- O. the quality governor (last: a lower tier stays for the page's lifetime) ----------------------------------
  if (!process.env.VERIFY_SKIP_GOVERNOR) {
    const gv = await ev(async () => {
      const fx = __lab.fx, out = { steps: [] }; fx.clear();
      out.start = __lab.q();
      __lab.setSlow(true);
      const t0 = performance.now(); let q = out.start;
      while (performance.now() - t0 < 12000 && __lab.q() > 0.35) {
        if (fx.live < 40) fx.confetti({ n: 60 });
        await new Promise(requestAnimationFrame);
        if (__lab.q() !== q) { q = __lab.q(); out.steps.push([q, Math.round(performance.now() - t0)]); }
      }
      __lab.setSlow(false); fx.clear();
      const T = __lab.pt(3, 4);
      fx.confetti(); out.confetti = fx.live; fx.clear();
      fx.burst('explosion', T); out.explosion = fx.live; fx.clear();
      fx.burst('sparks', T, { n: 6 }); out.sparks6 = fx.live; fx.clear();
      fx.burst('ring', T); out.ring = fx.live; fx.clear();
      fx.burst('stars', T, { n: 14 }); out.stars = fx.live; fx.clear();
      // it never recovers: run fast frames for a while
      fx.confetti();
      await new Promise(r => setTimeout(r, 1500));
      out.afterFast = __lab.q(); fx.clear();
      out.meter = document.getElementById('m-q').textContent;
      return out;
    });
    check('O governor: starts at q = 1 and steps 1 -> 0.6 -> 0.35 under forced slow frames (average gap > 22 ms for 20 frames)', gv.start === 1 && gv.steps.map(s => s[0]).join() === '0.6,0.35', JSON.stringify(gv.steps));
    check('O at q = 0.35 every count is multiplied by q (minimum 3) and smoke and soft sprites are dropped', gv.confetti === 49 && gv.explosion === 1 + 6 + 8 && gv.sparks6 === 3 && gv.ring === 1 && gv.stars === 5, JSON.stringify(gv));
    check('O the lower tier stays for the page lifetime; the harness shows it', gv.afterFast === 0.35 && gv.meter === '0.35', JSON.stringify({ afterFast: gv.afterFast, meter: gv.meter }));
  }

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.error(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
  console.error(`\n${results.length - failed.length} of ${results.length} checks passed at ${view.width}x${view.height} (c = ${c})`);
  if (failed.length) throw new Error(`${failed.length} check(s) failed`);
};
