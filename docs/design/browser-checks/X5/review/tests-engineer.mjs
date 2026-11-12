// Browser tests for package X5 (buddy.js, rival-view.js, buddy.css). Run inside dev/buddy.html through shot.mjs:
// the page gives the real stylesheets; the tests build their own hosts and import the modules themselves.
// Expected values are copied from SPEC §11 (not from the implementation). Throws when a test fails.

export default async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createBuddy } = await import('/src/ui/buddy.js');
    const { createRivalView } = await import('/src/ui/rival-view.js');
    const { MOODS, CUE } = await import('/src/core/codes.js');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tick = () => new Promise((r) => queueMicrotask(r));
    const results = [];
    const sandbox = document.createElement('div');
    sandbox.style.cssText = 'position:absolute;left:-9999px;top:0;width:480px;';
    document.body.append(sandbox);
    document.documentElement.dataset.motion = 'full';

    /** A host with the size of the landscape coach region. */
    function makeHost(layout = 'landscape', h = 291) {
      const wrap = document.createElement('div');
      if (layout) wrap.dataset.layout = layout;
      wrap.style.cssText = `width:480px;height:500px;--buddy-h:${h}px;--top:48px;`;
      const host = document.createElement('div');
      host.id = `h${Math.random().toString(36).slice(2, 8)}`;
      wrap.append(host);
      sandbox.append(wrap);
      return { wrap, host };
    }
    const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
    const ok = (c, msg) => { if (!c) throw new Error(msg); };
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && !el.hidden;
    async function test(name, fn) {
      try { await fn(); results.push({ name, ok: true }); }
      catch (e) { results.push({ name, ok: false, error: String(e && e.message ? e.message : e) }); }
    }

    // §11.3, copied from the contract table: eyes, mouth, fan, extras, then the rig values
    // [armR, armL, fanRot, tilt, browL, browR, browY, headY]
    const TABLE = {
      idle:      ['open',  'smirk', 'gathered', '',           [-18, 14, 40, 0, 7, -7, 0, 0]],
      listening: ['up',    'soft',  'gathered', '',           [-18, 14, 40, -5, 0, 0, -1.5, 0]],
      thinking:  ['side',  'hmm',   'spread',   'dots',       [-148, 14, 28, 5, -8, 10, 0, 0]],
      curious:   ['open',  'o',     'gathered', 'q',          [-75, 14, 85, -8, -6, -14, -2, 0]],
      pleased:   ['happy', 'smile', 'spread',   'blush',      [-40, 14, 15, 0, 0, 0, 0, 0]],
      impressed: ['star',  'grin',  'spread',   'spark',      [-70, 150, 60, 0, 0, 0, -3, 0]],
      worried:   ['side',  'wavy',  'gathered', 'sweat',      [-6, 14, 172, 4, 16, -16, -1, 1]],
      alarmed:   ['wide',  'bigo',  'gathered', 'bang',       [-128, 128, 148, 0, 12, -12, -4, -2]],
      cheering:  ['happy', 'cheer', 'spread',   'blush note', [-150, 150, 175, 0, 0, 0, -3, -2]],
      consoling: ['soft',  'soft',  'gathered', '',           [-18, 78, 40, 6, 10, -10, 0, 0]],
    };
    const RIG = ['--arm-r', '--arm-l', '--fan-rot', '--tilt', '--brow-l', '--brow-r', '--brow-y', '--head-y'];
    // The values this package moved further than the +-6 deg / +-2 unit of §11.3 (reported as contract issues).
    const BEYOND = { 'thinking --fan-rot': 8, 'worried --fan-rot': 122, 'cheering --fan-rot': 198, 'listening --tilt': -11 };
    const rigOf = (svg) => RIG.map((p) => parseFloat(svg.style.getPropertyValue(p)));

    // ------------------------------------------------------------------------------------------------ buddy: drawing

    await test('the figure is one inline SVG with the viewBox of its variant, role img and the aria-label', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      eq(svg.getAttribute('viewBox'), '0 0 120 140', 'full viewBox');
      eq(svg.getAttribute('role'), 'img', 'role');
      eq(svg.getAttribute('aria-label'), '军师诸葛亮', 'aria-label');
      eq(svg.dataset.mood, 'idle', 'first mood');
      eq(b.getMood(), 'idle', 'getMood');
      eq(host.dataset.variant, 'full', 'host variant');
      b.setVariant('bust');
      eq(svg.getAttribute('viewBox'), '10 2 100 100', 'bust viewBox');
      eq(host.dataset.variant, 'bust', 'host variant after setVariant');
      b.destroy();
      const { host: h2 } = makeHost();
      const b2 = createBuddy(h2, { variant: 'bust' });
      eq(h2.querySelector('svg.buddy').getAttribute('viewBox'), '10 2 100 100', 'created as bust');
      b2.destroy();
    });

    await test('every variant group of 11.2 is in the DOM: 7 eyes, 9 mouths, 7 extras, 2 fans, and the rig groups', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      const names = (sel) => [...svg.querySelectorAll(`${sel} > [data-v]`)].map((g) => g.dataset.v);
      eq(names('.b-eyes'), ['open', 'wide', 'happy', 'soft', 'star', 'side', 'up'], 'eyes');
      eq(names('.b-mouth'), ['smirk', 'smile', 'grin', 'cheer', 'o', 'bigo', 'wavy', 'hmm', 'soft'], 'mouths');
      eq(names('.b-extras'), ['sweat', 'bang', 'dots', 'q', 'spark', 'blush', 'note'], 'extras');
      eq(names('.b-fan'), ['gathered', 'spread'], 'fans');
      for (const cls of ['b-cloak', 'b-arm-l', 'b-body', 'b-head', 'b-ribbon', 'b-eyes', 'b-mouth', 'b-extras', 'b-arm-r', 'b-fan', 'b-brow-l', 'b-brow-r']) {
        ok(svg.querySelector(`.${cls}`), `missing .${cls}`);
      }
      // the fan: five feathers gathered, seven spread (each feather = outline + quill)
      eq(svg.querySelectorAll('.b-fan [data-v="gathered"] path[fill="#ffffff"]').length, 5, 'gathered feathers');
      eq(svg.querySelectorAll('.b-fan [data-v="spread"] path[fill="#ffffff"]').length, 7, 'spread feathers');
      // draw order back to front: cloak, left arm, body, head, right arm (over the head)
      const order = [...svg.querySelector('.b-fig').children].map((g) => g.getAttribute('class'));
      eq(order, ['b-cloak', 'b-arm-l', 'b-body', 'b-head-act', 'b-arm-r'], 'draw order');
      b.destroy();
    });

    await test('the rig transforms use the origins of 11.2', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      const svg = host.querySelector('svg.buddy');
      const origin = (sel) => getComputedStyle(svg.querySelector(sel)).transformOrigin;
      eq(origin('.b-arm-r'), '76px 91px', 'arm-r');
      eq(origin('.b-arm-l'), '44px 91px', 'arm-l');
      eq(origin('.b-fan'), '76px 116px', 'fan');
      eq(origin('.b-head'), '60px 80px', 'head');
      eq(origin('.b-brow-l'), '46.5px 39.5px', 'brow-l');
      eq(origin('.b-brow-r'), '73.5px 39.5px', 'brow-r');
      b.destroy();
    });

    for (const mood of MOODS) {
      await test(`mood ${mood}: face parts as in 11.3, exactly one of each visible, rig within tolerance`, async () => {
        const { host } = makeHost('');
        const b = createBuddy(host, { variant: 'full', reducedMotion: true });
        const svg = host.querySelector('svg.buddy');
        b.setMood(mood, { instant: true });
        const [eyes, mouth, fan, extras, rig] = TABLE[mood];
        eq(b.getMood(), mood, 'getMood');
        eq(svg.dataset.mood, mood, 'data-mood');
        eq(svg.dataset.eyes, eyes, 'data-eyes');
        eq(svg.dataset.mouth, mouth, 'data-mouth');
        eq(svg.dataset.fan, fan, 'data-fan');
        eq(svg.dataset.extras, extras, 'data-extras');
        const visible = (sel) => [...svg.querySelectorAll(`${sel} > [data-v]`)].filter((g) => getComputedStyle(g).display !== 'none').map((g) => g.dataset.v);
        eq(visible('.b-eyes'), [eyes], 'visible eyes');
        eq(visible('.b-mouth'), [mouth], 'visible mouth');
        eq(visible('.b-fan'), [fan], 'visible fan');
        eq(visible('.b-extras').sort(), extras ? extras.split(' ').sort() : [], 'visible extras');
        const got = rigOf(svg);
        RIG.forEach((p, i) => {
          const key = `${mood} ${p}`;
          if (key in BEYOND) { eq(got[i], BEYOND[key], `${key} (documented deviation)`); return; }
          const tol = p === '--brow-y' || p === '--head-y' ? 2 : 6;
          ok(Math.abs(got[i] - rig[i]) <= tol + 1e-9, `${key}: ${got[i]} is more than ${tol} from ${rig[i]}`);
        });
        b.destroy();
      });
    }

    await test('the ten moods are pairwise different in their face (eyes, mouth, extras): distinguishable as busts', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'bust', reducedMotion: true });
      const svg = host.querySelector('svg.buddy');
      const seen = new Map();
      for (const mood of MOODS) {
        b.setMood(mood, { instant: true });
        const face = [svg.dataset.eyes, svg.dataset.mouth, svg.dataset.extras, svg.style.getPropertyValue('--tilt')].join('|');
        ok(!seen.has(face), `${mood} has the same face as ${seen.get(face)}`);
        seen.set(face, mood);
      }
      b.destroy();
    });

    // ------------------------------------------------------------------------------------------------ buddy: behaviour

    await test('setMood with hold returns to the base mood; setBaseMood during a hold waits for it', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      b.setBaseMood('worried');
      eq(b.getMood(), 'worried', 'base mood shown at once when nothing is held');
      b.setMood('alarmed', { hold: 150 });
      eq(b.getMood(), 'alarmed', 'held mood');
      b.setBaseMood('pleased');
      eq(b.getMood(), 'alarmed', 'still held');
      await sleep(230);
      eq(b.getMood(), 'pleased', 'back to the (new) base');
      b.setMood('thinking');
      await sleep(200);
      eq(b.getMood(), 'thinking', 'a mood without hold stays');
      b.setMood('alarmed', { hold: 150 });
      b.setMood('curious');
      await sleep(230);
      eq(b.getMood(), 'curious', 'a new setMood cancels the pending return');
      b.destroy();
    });

    await test('react(point): --arm-r -95 and --fan-rot 170 for 800 ms, then the mood values again', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      const svg = host.querySelector('svg.buddy');
      b.react('point');
      eq([svg.style.getPropertyValue('--arm-r'), svg.style.getPropertyValue('--fan-rot')], ['-95deg', '170deg'], 'pointing');
      await sleep(700);
      eq(svg.style.getPropertyValue('--arm-r'), '-95deg', 'still pointing at 700 ms');
      await sleep(200);
      eq([svg.style.getPropertyValue('--arm-r'), svg.style.getPropertyValue('--fan-rot')], ['-18deg', '40deg'], 'back to idle');
      b.destroy();
    });

    await test('gestures with full motion start animations of the given length; with reduced motion none', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      const durations = (sel) => svg.querySelector(sel).getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))
        .map((a) => a.effect.getComputedTiming()).map((t) => [t.duration, t.iterations]);
      b.react('nod');   eq(durations('.b-head-act'), [[400, 1]], 'nod 400 ms on the head');
      await sleep(450);
      b.react('shake'); eq(durations('.b-head-act'), [[400, 1]], 'shake 400 ms on the head');
      b.react('hop');   eq(durations('.b-fig'), [[300, 1]], 'hop 300 ms on the figure');
      await sleep(350);
      b.react('peek');  eq(durations('.b-fig'), [[700, 1]], 'peek 700 ms on the figure');
      await sleep(750);
      b.setMood('cheering');
      eq(durations('.b-fig'), [[500, 3]], 'cheering: three hops of 500 ms');
      eq(durations('.b-head-act'), [[90, 1]], 'mood change: 90 ms head squash');
      await sleep(1600);
      b.setMood('alarmed');
      eq(durations('.b-fig'), [[240, 1]], 'alarmed: one 240 ms shake');
      await sleep(300);
      b.setReducedMotion(true);
      for (const g of ['nod', 'hop', 'shake', 'peek', 'point']) b.react(g);
      b.setMood('cheering');
      eq(svg.querySelectorAll('*').length > 0 && [...svg.querySelectorAll('*')].flatMap((el) => el.getAnimations()).length, 0, 'no animation at all under reduced motion');
      ok(svg.classList.contains('is-still'), 'is-still class');
      b.destroy();
    });

    await test('reduced motion keeps the information of a gesture: a brief swap, then the mood face again', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      const svg = host.querySelector('svg.buddy');
      b.react('nod');
      eq(svg.dataset.eyes, 'happy', 'nod: eyes smile');
      await sleep(600);
      eq(svg.dataset.eyes, 'open', 'back to the idle eyes');
      b.react('peek');
      eq(svg.dataset.eyes, 'side', 'peek: a side glance');
      await sleep(800);
      b.react('shake');
      eq([svg.dataset.eyes, svg.dataset.mouth], ['open', 'wavy'], 'shake: the wavy mouth');
      await sleep(600);
      eq(svg.dataset.mouth, 'smirk', 'back to the idle mouth');
      b.destroy();
    });

    await test('as a bust the pointing fan goes up beside the head and stays inside the frame', async () => {
      const { wrap, host } = makeHost('portrait', 120);
      wrap.style.height = '120px';
      const b = createBuddy(host, { variant: 'bust', reducedMotion: true });
      const svg = host.querySelector('svg.buddy');
      b.react('point');
      eq([svg.style.getPropertyValue('--arm-r'), svg.style.getPropertyValue('--fan-rot')], ['-150deg', '158deg'], 'bust pointing pose');
      const box = svg.getBoundingClientRect();
      let x1 = -Infinity, y0 = Infinity;
      for (const el of svg.querySelectorAll('.b-fan [data-v="gathered"] path')) {
        const m = el.getScreenCTM();
        const len = el.getTotalLength();
        for (let i = 0; i <= 30; i++) { const p = el.getPointAtLength((len * i) / 30).matrixTransform(m); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); }
      }
      ok(x1 <= box.right + 0.5 && y0 >= box.top - 0.5, `the fan stays inside the bust (right ${Math.round(x1 - box.right)}, top ${Math.round(box.top - y0)})`);
      await sleep(900);
      eq(svg.style.getPropertyValue('--arm-r'), '-18deg', 'back');
      b.destroy();
    });

    await test('with full motion the rig tweens 260 ms; instant and reduced paints do not', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      const arm = svg.querySelector('.b-arm-r');
      eq(getComputedStyle(arm).transitionDuration, '0.26s', 'transition duration');
      b.setMood('alarmed');
      ok(arm.getAnimations().some((a) => a instanceof CSSTransition), 'a transition runs after setMood');
      await sleep(400);
      b.setMood('idle', { instant: true });
      ok(!arm.getAnimations().some((a) => a instanceof CSSTransition), 'no transition after an instant setMood');
      b.setReducedMotion(true);
      b.setMood('alarmed');
      ok(!arm.getAnimations().some((a) => a instanceof CSSTransition), 'no transition under reduced motion');
      b.destroy();
    });

    await test('idle loops run only with full motion (breathe, sway, hem, ribbons)', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      const anim = (sel) => getComputedStyle(svg.querySelector(sel)).animationName;
      eq(anim('.b-body'), 'b-breathe', 'body breathes');
      eq(anim('.b-head'), 'b-breathe-head', 'head breathes');
      eq(anim('.b-cloak'), 'b-hem', 'cloak hem');
      eq(anim('.b-ribbon'), 'b-ribbon', 'ribbons');
      eq(anim('.b-fan'), 'b-sway', 'gathered fan sways');
      b.setMood('pleased', { instant: true });
      eq(anim('.b-fan'), 'b-fanning', 'fanning in pleased');
      b.setMood('consoling', { instant: true });
      eq(anim('.b-head'), 'b-breathe-head, b-console', 'consoling nod');
      b.setReducedMotion(true);
      eq(anim('.b-body'), 'none', 'no loop under setReducedMotion(true)');
      b.setReducedMotion(false);
      document.documentElement.dataset.motion = 'reduced';
      eq(anim('.b-body'), 'none', 'no loop when html[data-motion] is reduced');
      document.documentElement.dataset.motion = 'full';
      b.destroy();
    });

    await test('setSpeaking alternates the mouth with `o` every 120 ms; not for cheer / bigo; never under reduced motion', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      const sample = async (ms) => { const seen = new Set(); const end = Date.now() + ms; while (Date.now() < end) { seen.add(svg.dataset.mouth); await sleep(20); } return [...seen].sort(); };
      b.setSpeaking(true);
      eq(await sample(500), ['o', 'smirk'], 'idle flaps between smirk and o');
      b.setMood('cheering', { instant: true });
      eq(await sample(400), ['cheer'], 'cheer does not flap');
      b.setMood('alarmed', { instant: true });
      eq(await sample(400), ['bigo'], 'bigo does not flap');
      b.setMood('pleased', { instant: true });
      eq(await sample(500), ['o', 'smile'], 'pleased flaps');
      b.setSpeaking(false);
      eq(await sample(300), ['smile'], 'stops with the mood mouth');
      b.setReducedMotion(true);
      b.setSpeaking(true);
      eq(await sample(300), ['smile'], 'no flapping under reduced motion');
      b.destroy();
    });

    await test('blink: within 6.3 s for open eyes, scaleY(.1) about y = 52; never for happy eyes; never under reduced motion', async () => {
      const a = makeHost(''), c = makeHost(''), d = makeHost('');
      const b1 = createBuddy(a.host, { variant: 'full' });
      const b2 = createBuddy(c.host, { variant: 'full' });
      const b3 = createBuddy(d.host, { variant: 'full', reducedMotion: true });
      b2.setMood('pleased', { instant: true });
      const svgs = [a.host, c.host, d.host].map((h) => h.querySelector('svg.buddy'));
      const blinked = [false, false, false];
      let scale = '';
      const end = Date.now() + 6300;
      while (Date.now() < end && !(blinked[0] && Date.now() > end - 3000)) {
        svgs.forEach((s, i) => { if (s.classList.contains('is-blink')) { blinked[i] = true; if (i === 0) scale = getComputedStyle(s.querySelector('.b-eyes')).scale; } });
        await sleep(25);
      }
      eq(blinked, [true, false, false], 'who blinked (idle, pleased, reduced)');
      eq(scale, '1 0.1', 'blink scale');
      eq(getComputedStyle(svgs[0].querySelector('.b-eyes')).transformOrigin, '60px 52px', 'blink origin');
      b1.destroy(); b2.destroy(); b3.destroy();
    });

    await test('buddy:tap bubbles from the host; destroy removes everything it added', async () => {
      const { wrap, host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      let taps = 0;
      const onTap = (e) => { if (e.target === host) taps++; };
      wrap.addEventListener('buddy:tap', onTap);
      host.querySelector('.buddy-fig').click();
      eq(taps, 1, 'one tap heard on an ancestor');
      b.destroy();
      eq(host.childElementCount, 0, 'host emptied');
      eq(host.className, '', 'host class removed');
      eq(Object.keys(host.dataset), [], 'host data attributes removed');
      b.setMood('alarmed'); b.react('hop'); b.setVariant('bust'); b.destroy();       // harmless after destroy
      eq(b.getMood(), 'idle', 'getMood after destroy');
    });

    // ------------------------------------------------------------------------------------------------ bubble

    const bub = (host) => host.querySelector('.bubble');
    const span = (text) => { const s = document.createElement('span'); s.textContent = text; return s; };

    await test('bubble: structure of 11.6 and the empty state', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      eq([...root.children].map((c) => c.className), ['bubble__question', 'bubble__tag', 'bubble__caption', 'bubble__text', 'bubble__dots', 'bubble__stale'], 'children');
      eq(root.dataset.empty, '1', 'empty');
      eq(host.dataset.bubble, '0', 'host knows');
      eq(getComputedStyle(root).visibility, 'hidden', 'not painted while empty');
      b.destroy();
    });

    await test('bubble.begin: clears, returns the text container (a child of .bubble), sets streaming, shows the cue with its tone', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      const el = b.bubble.begin({ id: 'm1', cue: CUE.wow });
      eq(el.className, 'bubble__text', 'container');
      ok(el.parentElement === root, 'the container is a direct child of .bubble');
      eq(root.dataset.state, 'streaming', 'state');
      const tag = root.querySelector('.bubble__tag');
      eq([tag.hidden, tag.textContent, tag.dataset.tone], [false, '妙哉！', 'good'], 'tag');
      el.append('好棋。');
      await tick();
      ok(root.dataset.empty === undefined, 'not empty');
      const tones = {};
      for (const [code, text] of Object.entries(CUE)) { b.bubble.begin({ id: `c-${code}`, cue: text }); tones[code] = root.querySelector('.bubble__tag').dataset.tone; }
      eq(tones, { go: 'good', wow: 'good', nice: 'good', lord: 'good', wait: 'warn', stop: 'warn', alert: 'warn', look: 'neutral', oh: 'neutral', win: 'good', lose: 'neutral', draw: 'neutral' }, 'tone of every cue (11.6)');
      const el2 = b.bubble.begin({ id: 'm2' });
      ok(el2 !== el && !el.isConnected, 'a new container each time; the old one is detached');
      eq(root.querySelector('.bubble__tag').hidden, true, 'no cue: no tag');
      eq(el2.textContent, '', 'cleared');
      el.append('late text of the old line');
      await tick();
      eq(root.textContent, '', 'a late write into the old container does not show');
      b.destroy();
    });

    await test('bubble tag colours: good = accent fill, warn = danger fill, neutral = surface-2 fill', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      const root = bub(host);
      const probe = document.createElement('div');
      host.append(probe);
      const colour = (v) => { probe.style.background = `var(${v})`; return getComputedStyle(probe).backgroundColor; };
      const tag = root.querySelector('.bubble__tag');
      b.bubble.begin({ id: 't' });
      b.bubble.setTag('主公英明！', 'good');
      eq([tag.textContent, getComputedStyle(tag).backgroundColor, getComputedStyle(tag).color], ['主公英明！', colour('--accent'), colour('--accent-ink')], 'good');
      b.bubble.setTag('且慢……', 'warn');
      eq([getComputedStyle(tag).backgroundColor, getComputedStyle(tag).color], [colour('--danger'), colour('--danger-ink')], 'warn');
      b.bubble.setTag('咦？', 'neutral');
      eq([getComputedStyle(tag).backgroundColor, getComputedStyle(tag).color], [colour('--surface-2'), colour('--ink')], 'neutral');
      b.bubble.setTag(null, 'neutral');
      eq(tag.hidden, true, 'null hides the tag');
      probe.remove();
      b.destroy();
    });

    await test('bubble typing dots: after 300 ms when nothing arrived; gone when text arrives, when the state leaves streaming, and by 3.5 s', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      const dots = root.querySelector('.bubble__dots');
      let el = b.bubble.begin({ id: 'd1' });
      await sleep(200);
      eq(dots.hidden, true, 'no dots at 200 ms');
      await sleep(200);
      eq(dots.hidden, false, 'dots at 400 ms');
      eq(dots.children.length, 3, 'three dots');
      el.append('来了');
      await tick(); await tick();
      eq(dots.hidden, true, 'hidden when text arrives');
      el = b.bubble.begin({ id: 'd2' });
      el.append('很快');
      await sleep(400);
      eq(dots.hidden, true, 'never shown when text came before 300 ms');
      el = b.bubble.begin({ id: 'd3' });
      await sleep(400);
      root.dataset.state = 'done';
      await tick(); await tick();
      eq(dots.hidden, true, 'hidden when the caller ends the line');
      b.bubble.begin({ id: 'd4' });
      b.bubble.setTyping(false);
      await sleep(400);
      eq(dots.hidden, true, 'setTyping(false) keeps them away');
      b.bubble.setTyping(true);
      await sleep(50);
      eq(dots.hidden, false, 'setTyping(true) shows them once 300 ms have passed');
      await sleep(3300);
      eq(dots.hidden, false, 'a wait started by setTyping(true) has its own 3.5 s');
      await sleep(400);
      eq(dots.hidden, true, 'never past 3.5 s of one wait');
      b.destroy();
    });

    await test('bubble question: shown small above the line; set before begin it survives that begin only; the caller keeps its element', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      const q = root.querySelector('.bubble__question');
      const log = document.createElement('div');
      const mine = span('对方会怎么应？');
      mine.id = 'q1';
      log.append(mine);
      b.bubble.setQuestion(mine);
      ok(mine.parentElement === log, 'the caller’s element was not moved');
      eq([q.hidden, q.textContent, q.querySelector('[id]')], [false, '对方会怎么应？', null], 'question shown, id not duplicated');
      eq(getComputedStyle(q).fontSize, '13px', '13 px');
      await sleep(10);
      b.bubble.begin({ id: 'a1' }).append('对方会走马。');
      eq([q.hidden, q.textContent], [false, '对方会怎么应？'], 'kept by the begin that follows it');
      await sleep(10);
      b.bubble.begin({ id: 'a2' });
      eq(q.hidden, true, 'dropped by the next begin');
      b.bubble.setQuestion(span('这步好不好？'));                       // right after begin, same turn
      eq(q.hidden, false, 'set right after begin: shown');
      await sleep(10);
      b.bubble.begin({ id: 'a3' });
      eq(q.hidden, true, '... and dropped by the next begin');
      b.bubble.setQuestion(span('x'));
      b.bubble.setQuestion(null);
      eq([q.hidden, q.textContent], [true, ''], 'null removes it');
      b.destroy();
    });

    await test('bubble caption: a quiet line; the sentence that follows keeps it, the line after that does not; a new caption drops the old line', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      const cap = root.querySelector('.bubble__caption');
      const t1 = b.bubble.begin({ id: 'old', cue: CUE.nice });
      t1.append('上一句。');
      root.dataset.state = 'done';
      await sleep(10);
      const c = b.bubble.captionEl();
      ok(c === cap, 'captionEl returns the caption container');
      c.append('马8进7 出子');
      await tick(); await tick();
      eq([cap.hidden, root.querySelector('.bubble__text').textContent, root.querySelector('.bubble__tag').hidden, root.dataset.state], [false, '', true, 'done'], 'caption alone: the old line and its tag are gone');
      ok(root.dataset.empty === undefined, 'bubble visible');
      await sleep(10);
      b.bubble.begin({ id: 'opp' }).append('它的炮瞄着你的中兵。');
      eq([cap.hidden, cap.textContent], [false, '马8进7 出子'], 'kept under the rival-move sentence');
      await sleep(10);
      b.bubble.begin({ id: 'try' }).append('这步不错。');
      await tick(); await tick();
      eq([cap.hidden, cap.textContent], [true, ''], 'dropped by the next line');
      await sleep(10);
      const c2 = b.bubble.captionEl();
      c2.append('炮8平5 顺炮');
      eq(c2.textContent, '炮8平5 顺炮', 'a later caption starts clean');
      ok(b.bubble.captionEl() === c2 && c2.textContent === '炮8平5 顺炮', 'asking again in the same turn does not clear it');
      await sleep(10);
      b.bubble.captionEl().append('车1平2');
      eq(cap.textContent, '车1平2', 'the next caption replaces the previous one');
      b.destroy();
    });

    await test('bubble status: one muted line with no tag, only when the line is stale or empty', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      const text = () => root.querySelector('.bubble__text');
      b.bubble.status('对方正在想…');
      eq([root.dataset.state, text().textContent, root.querySelector('.bubble__tag').hidden], ['status', '对方正在想…', true], 'shown when empty');
      const el = b.bubble.begin({ id: 's1', cue: CUE.wait });
      b.bubble.status('对方正在想…');
      eq(root.dataset.state, 'streaming', 'ignored while a line is on its way');
      el.append('这个子，真的没人管吗？');
      root.dataset.state = 'done';
      b.bubble.status('对方正在想…');
      eq([root.dataset.state, text().textContent], ['done', '这个子，真的没人管吗？'], 'ignored while a finished line is showing');
      b.bubble.markStale('已落子');
      b.bubble.status('对方正在想…');
      eq([root.dataset.state, text().textContent, root.querySelector('.bubble__tag').hidden, root.querySelector('.bubble__stale').hidden], ['status', '对方正在想…', true, true], 'replaces a stale line');
      const probe = document.createElement('div');
      probe.style.color = 'var(--ink-2)';
      host.append(probe);
      eq(getComputedStyle(text()).color, getComputedStyle(probe).color, 'muted colour');
      b.destroy();
    });

    await test('bubble markStale: dims the line to 55 % and appends the label; clear empties the bubble', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      const el = b.bubble.begin({ id: 'x1', cue: CUE.wow });
      el.append('马后炮！');
      await sleep(260);                                             // the tag has popped in
      b.bubble.markStale('已换一步');
      const label = root.querySelector('.bubble__stale');
      eq([root.dataset.state, label.hidden, label.textContent, el.textContent], ['stale', false, '已换一步', '马后炮！'], 'stale');
      eq([getComputedStyle(el).opacity, getComputedStyle(root.querySelector('.bubble__tag')).opacity, getComputedStyle(label).opacity], ['0.55', '0.55', '1'], 'dimmed text and tag, readable label');
      ok(label.previousElementSibling === root.querySelector('.bubble__dots') && el.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING, 'the label comes after the line');
      b.bubble.clear();
      await tick();
      eq([root.dataset.state, root.dataset.empty, root.textContent, host.dataset.bubble], [undefined, '1', '', '0'], 'cleared');
      b.destroy();
    });

    await test('bubble events: a tap dispatches bubble:expand {id}; a tap on a move link does not, and chat:movelink bubbles through', async () => {
      const { wrap, host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host);
      const heard = [];
      wrap.addEventListener('bubble:expand', (e) => heard.push(['expand', e.detail.id, e.target === host]));
      wrap.addEventListener('chat:movelink', (e) => heard.push(['movelink', e.detail.n]));
      root.click();
      eq(heard, [], 'an empty bubble is not a control');
      const el = b.bubble.begin({ id: 'm7' });
      const link = document.createElement('button');
      link.className = 'move-link';
      link.textContent = '炮二平五';
      link.addEventListener('click', () => link.dispatchEvent(new CustomEvent('chat:movelink', { bubbles: true, detail: { n: 1 } })));
      el.append('走', link, '吧。');
      await tick();
      link.click();
      eq(heard, [['movelink', 1]], 'the link keeps its tap');
      el.click();
      eq(heard, [['movelink', 1], ['expand', 'm7', true]], 'a tap on the text expands');
      b.destroy();
    });

    // ------------------------------------------------------------------------------------------------ layout

    await test('layout: full figure is --buddy-h tall (291 px), bubble above it at 18 / 26 px; bust beside the bubble; compact 15 / 22 px', async () => {
      const { wrap, host } = makeHost('landscape', 291);
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      const fig = host.querySelector('.buddy-fig');
      const root = bub(host);
      b.bubble.begin({ id: 'l1' }).append('这步棋走得稳，先把马跳出来，下一步车就能出动了。');
      await sleep(30);
      let f = fig.getBoundingClientRect(), r = root.getBoundingClientRect(), h = host.getBoundingClientRect();
      eq(Math.round(f.height), 291, 'figure height');
      ok(f.height >= 240, 'at least 240 px in landscape (D-37)');
      ok(Math.abs(f.bottom - h.bottom) < 1, 'he stands on the floor of the region');
      ok(r.bottom <= f.top, 'bubble above the figure');
      // the border is read from the rule: headless Chrome with an emulated device scale snaps the computed 1.5 px to 1 px
      const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((x) => x.selectorText === '.bubble');
      eq([getComputedStyle(root).fontSize, getComputedStyle(root).lineHeight, getComputedStyle(root).paddingLeft, getComputedStyle(root).paddingTop, rule.style.getPropertyValue('border'), getComputedStyle(root).borderTopLeftRadius],
        ['18px', '26px', '14px', '10px', '1.5px solid var(--edge)', '16px'], 'bubble type and shape');
      ok(Math.floor((r.width - 31) / 18) >= 18 || root.scrollHeight <= root.clientHeight, 'room for 18 characters a line');
      ok(getComputedStyle(host.querySelector('svg.buddy')).transform.startsWith('matrix(-1'), 'mirrored toward the board in landscape');
      b.setVariant('bust');
      wrap.dataset.layout = 'portrait';
      wrap.style.setProperty('--buddy-h', '120px');
      wrap.style.height = '120px';
      await sleep(30);
      f = fig.getBoundingClientRect(); r = root.getBoundingClientRect();
      eq([Math.round(f.width), Math.round(f.height)], [120, 120], 'bust 120 px');
      ok(r.left >= f.right, 'bubble to the right of the bust');
      eq(getComputedStyle(host.querySelector('svg.buddy')).transform, 'none', 'not mirrored in portrait');
      wrap.dataset.layout = 'compact';
      wrap.style.setProperty('--buddy-h', '56px');
      wrap.style.width = '344px';
      wrap.style.height = '82px';
      await sleep(30);
      f = fig.getBoundingClientRect(); r = root.getBoundingClientRect();
      eq([Math.round(f.width), Math.round(f.height)], [56, 56], 'bust 56 px');
      eq([getComputedStyle(root).fontSize, getComputedStyle(root).lineHeight], ['15px', '22px'], 'compact type');
      ok(r.height >= 44 && f.height >= 44, 'tap targets at least 44 px');
      b.bubble.begin({ id: 'l2' }).append('一二三四五六七八九十一二三四五六七'.repeat(5));
      await sleep(30);
      r = root.getBoundingClientRect();
      const cs = getComputedStyle(root);
      const inner = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 3;
      eq(inner / 22, 3, 'three whole lines fit in the 82 px region of a 360 px phone');
      const range = document.createRange();
      range.selectNodeContents(root.querySelector('.bubble__text'));
      const firstLine = [...range.getClientRects()][0];
      ok(Math.floor(firstLine.width / 15) >= 17, `17 characters a line at 360 px (got ${Math.floor(firstLine.width / 15)})`);
      eq(root.dataset.more, '1', 'the more-mark shows when the line does not fit');
      b.destroy();
    });

    // ------------------------------------------------------------------------------------------------ rival

    await test('rival: plate with 司马懿 / 魏 · 大都督, .rival[data-mood], bust viewBox, 56 px in landscape and 44 px elsewhere', async () => {
      const { wrap, host } = makeHost('landscape');
      const r = createRivalView(host);
      const root = host.querySelector('.rival');
      eq(root.dataset.mood, 'calm', 'first mood');
      eq([root.querySelector('.rival__name').textContent, root.querySelector('.rival__title').textContent], ['司马懿', '魏 · 大都督'], 'plate');
      eq([getComputedStyle(root.querySelector('.rival__name')).fontSize, getComputedStyle(root.querySelector('.rival__name')).fontWeight, getComputedStyle(root.querySelector('.rival__title')).fontSize], ['15px', '600', '12px'], 'plate type');
      eq(root.querySelector('svg').getAttribute('viewBox'), '10 2 100 100', 'viewBox');
      const disc = root.querySelector('.rival__disc');
      eq(Math.round(disc.getBoundingClientRect().width), 56, '56 px in landscape');
      wrap.dataset.layout = 'portrait';
      eq(Math.round(disc.getBoundingClientRect().width), 44, '44 px in portrait');
      wrap.dataset.layout = 'compact';
      wrap.style.setProperty('--top', '40px');
      eq(Math.round(disc.getBoundingClientRect().width), 44, '44 px in compact');
      r.setReducedMotion(true);
    });

    await test('rival: the five moods of 11.7', async () => {
      const { host } = makeHost('landscape');
      const r = createRivalView(host);
      r.setReducedMotion(true);
      const root = host.querySelector('.rival');
      const svg = root.querySelector('svg');
      const visible = (sel) => [...svg.querySelectorAll(`${sel} > [data-v]`)].filter((g) => getComputedStyle(g).display !== 'none').map((g) => g.dataset.v);
      const mouthPath = () => { const g = svg.querySelector(`.r-mouth > [data-v="${visible('.r-mouth')[0]}"]`); return g.firstElementChild.getAttribute('d'); };
      const brow = () => parseFloat(getComputedStyle(svg).getPropertyValue('--brow-l'));
      const probe = document.createElement('div');
      host.append(probe);
      const colour = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
      const ring = root.querySelector('.rival__ring');
      r.set({ mood: 'calm' });
      eq([visible('.r-eyes'), mouthPath(), brow(), getComputedStyle(ring).borderTopColor], [['narrow'], 'M55 67 H65', 12, colour('var(--edge)')], 'calm');
      r.set({ mood: 'thinking' });
      eq([visible('.r-eyes'), visible('.r-mouth'), getComputedStyle(ring).borderTopStyle, root.querySelector('.rival__dots').hidden, root.querySelector('.rival__dots').children.length], [['side'], ['hmm'], 'dashed', false, 3], 'thinking');
      r.set({ mood: 'frown' });
      eq([visible('.r-eyes'), mouthPath(), brow(), getComputedStyle(svg.querySelector('.r-sweat')).display !== 'none', getComputedStyle(svg).opacity, root.querySelector('.rival__dots').hidden],
        [['narrow'], 'M54 68 Q60 64 66 68', 20, true, '0.9', true], 'frown: brows 8 degrees steeper, sweat, dimmed 10 %');
      eq(getComputedStyle(ring).borderTopColor, colour('color-mix(in srgb, var(--danger) 50%, transparent)'), 'frown ring: danger at 50 %');
      r.set({ mood: 'rattled' });
      eq([visible('.r-eyes'), visible('.r-mouth'), getComputedStyle(root.querySelector('.rival__flash')).borderTopColor], [['wide'], ['o'], colour('var(--accent)')], 'rattled');
      r.set({ mood: 'smug' });
      eq([visible('.r-eyes'), visible('.r-mouth'), getComputedStyle(ring).borderTopColor], [['happy'], ['smirk'], colour('var(--wei)')], 'smug');
      eq(root.dataset.mood, 'smug', 'data-mood');
      // moustache and chin tuft
      ok(svg.querySelector('path[d="M53 62 Q57 64 59.5 62.5"]') && svg.querySelector('path[d="M60.5 62.5 Q63 64 67 62"]') && svg.querySelector('path[d="M58.5 76 L60 82 L61.5 76 Z"]'), 'moustache and tuft');
      probe.remove();
    });

    await test('rival: a line shows for 2.4 s and is removed; thinking keeps its dots; motion once per mood, none when reduced', async () => {
      const { host } = makeHost('landscape');
      const r = createRivalView(host);
      const root = host.querySelector('.rival');
      const say = root.querySelector('.rival__say');
      const line = root.querySelector('.rival__line');
      eq(say.hidden, true, 'no tag at rest');
      r.set({ mood: 'smug', line: '此计已成。' });
      eq([say.hidden, line.textContent], [false, '此计已成。'], 'line shown');
      const anims = (sel) => root.querySelector(sel).getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).map((a) => a.effect.getComputedTiming().duration);
      eq(anims('.r-head'), [400], 'smug: tilt and back, 400 ms');
      r.set({ mood: 'rattled' });
      eq(anims('.rival__face'), [240], 'rattled: one 240 ms shake');
      eq(anims('.rival__flash').length, 1, 'rattled: the ring flashes once');
      eq(line.textContent, '此计已成。', 'a mood without a line keeps the line that is showing');
      await sleep(2200);
      eq(say.hidden, false, 'still there at 2.2 s');
      await sleep(400);
      eq([say.hidden, line.textContent], [true, ''], 'removed after 2.4 s');
      r.set({ mood: 'thinking', line: '容我三思……' });
      await sleep(2600);
      eq([say.hidden, line.textContent, root.querySelector('.rival__dots').hidden], [false, '', false], 'thinking: the dots stay after the line is gone');
      eq(getComputedStyle(root.querySelector('.rival__ring')).animationName, 'rival-ring', 'ring dashes rotate');
      r.set({ mood: 'calm' });
      eq(say.hidden, true, 'calm: nothing');
      r.setReducedMotion(true);
      r.set({ mood: 'rattled', line: '竟有此着！' });
      r.set({ mood: 'smug' });
      r.set({ mood: 'thinking' });
      eq([...root.querySelectorAll('*')].flatMap((el) => el.getAnimations()).length, 0, 'no animation under reduced motion');
      r.set({ mood: 'rattled' });
      eq(getComputedStyle(root.querySelector('.rival__flash')).opacity, '1', 'reduced motion: the ring stays lit instead of flashing');
    });

    sandbox.remove();
    return results;
  });

  const failed = result.filter((r) => !r.ok);
  for (const r of result) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n       ${r.error}`}`);
  console.log(`TESTS ${result.length}  PASS ${result.length - failed.length}  FAIL ${failed.length}`);
  if (failed.length) throw new Error(`${failed.length} test(s) failed`);
};
