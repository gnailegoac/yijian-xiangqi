// Reviewer's adversarial browser tests for package X5 (buddy.js, rival-view.js, buddy.css).
// Run through shot.mjs on dev/buddy.html (real stylesheets). Throws when a test fails.
// They cover what the engineer's suite (steps-tests.mjs) does not: dots on a second wait, a stale label that would
// wrap or be clipped, a gesture stand-in overtaken by a mood, the rival under html[data-motion="reduced"], the
// compact speech tag, and the bubble driven by the real chat panel.

export default async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createBuddy } = await import('/src/ui/buddy.js');
    const { createRivalView } = await import('/src/ui/rival-view.js');
    const { CUE } = await import('/src/core/codes.js');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const results = [];
    const sandbox = document.createElement('div');
    sandbox.style.cssText = 'position:absolute;left:-9999px;top:0;width:480px;';
    document.body.append(sandbox);
    document.documentElement.dataset.motion = 'full';

    function makeHost(layout = 'landscape', h = 291, w = 480, hh = 500) {
      const wrap = document.createElement('div');
      if (layout) wrap.dataset.layout = layout;
      wrap.style.cssText = `width:${w}px;height:${hh}px;--buddy-h:${h}px;--top:48px;`;
      const host = document.createElement('div');
      wrap.append(host);
      sandbox.append(wrap);
      return { wrap, host };
    }
    const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
    const ok = (c, msg) => { if (!c) throw new Error(msg); };
    async function test(name, fn) {
      try { await fn(); results.push({ name, ok: true }); }
      catch (e) { results.push({ name, ok: false, error: String(e && e.message ? e.message : e) }); }
    }
    const bub = (host) => host.querySelector('.bubble');

    // ---------------------------------------------------------------------------------------------- typing dots

    await test('dots: a second wait (setTyping(true) long after begin: resumed leg, reset) shows them again, for at most 3.5 s', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const root = bub(host), dots = root.querySelector('.bubble__dots');
      b.bubble.begin({ id: 'w1' });
      await sleep(3700);
      eq(dots.hidden, true, 'the first wait ended at 3.5 s');
      b.bubble.setTyping(true);
      await tick();
      eq(dots.hidden, false, 'a new wait shows the dots at once');
      ok(root.dataset.empty === undefined && host.dataset.bubble === '1', 'the bubble is on screen while he waits');
      await sleep(3300);
      eq(dots.hidden, false, 'still there 3.3 s into the second wait');
      await sleep(400);
      eq(dots.hidden, true, 'gone 3.5 s after the second wait began');
      b.destroy();
    });

    await test('dots: setTyping(true) while they are showing or pending never hides them and does not move the cap', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const dots = bub(host).querySelector('.bubble__dots');
      b.bubble.begin({ id: 'w2' });
      b.bubble.setTyping(true);                       // pending: still not before 300 ms
      await sleep(150);
      eq(dots.hidden, true, 'not before 300 ms');
      await sleep(250);
      eq(dots.hidden, false, 'shown at 300 ms');
      b.bubble.setTyping(true);                       // what chat-panel does with its own 300 ms timer
      eq(dots.hidden, false, 'no flicker: still shown in the same task');
      await sleep(2900);
      b.bubble.setTyping(true);
      await sleep(400);
      eq(dots.hidden, true, 'the cap still counts from begin (3.5 s)');
      b.destroy();
    });

    await test('dots: text that arrives during a wait ends it; setTyping(true) with text in the line shows nothing', async () => {
      const { host } = makeHost();
      const b = createBuddy(host, { variant: 'full' });
      const dots = bub(host).querySelector('.bubble__dots');
      const el = b.bubble.begin({ id: 'w3' });
      await sleep(350);
      eq(dots.hidden, false, 'waiting');
      el.append('来了。');
      await tick(); await tick();
      eq(dots.hidden, true, 'text ends the wait');
      b.bubble.setTyping(true);
      await tick();
      eq(dots.hidden, true, 'no dots next to text');
      el.replaceChildren();                           // reset: the line starts over
      b.bubble.setTyping(true);
      await tick();
      eq(dots.hidden, false, 'after a reset the dots return at once');
      b.bubble.markStale('已换一步');
      eq(dots.hidden, true, 'a stale line has no dots');
      b.destroy();
    });

    // ---------------------------------------------------------------------------------------------- stale label

    await test('markStale: nothing jumps, also when the last line is full; the label is inside the bubble', async () => {
      for (const layout of ['landscape', 'portrait', 'compact']) {
        const { host } = layout === 'landscape' ? makeHost('landscape', 291, 480, 500) : layout === 'portrait' ? makeHost('portrait', 120, 804, 120) : makeHost('compact', 56, 344, 130);
        const b = createBuddy(host, { variant: layout === 'landscape' ? 'full' : 'bust', reducedMotion: true });
        const root = bub(host);
        for (let n = 8; n <= 60; n++) {
          const el = b.bubble.begin({ id: `s${n}` });
          el.append('好'.repeat(n));
          root.dataset.state = 'done';
          await tick();
          const h0 = root.getBoundingClientRect().height, t0 = el.getBoundingClientRect().top;
          b.bubble.markStale('已换一步');
          const r = root.getBoundingClientRect(), label = root.querySelector('.bubble__stale'), l = label.getBoundingClientRect();
          ok(Math.abs(r.height - h0) < 0.5, `${layout}, ${n} characters: the bubble changed height (${h0} -> ${r.height})`);
          ok(Math.abs(el.getBoundingClientRect().top - t0) < 0.5, `${layout}, ${n} characters: the text moved`);
          ok(!label.hidden && l.width > 0 && l.left >= r.left && l.right <= r.right + 0.5 && l.top >= r.top - 0.5 && l.bottom <= r.bottom + 0.5,
            `${layout}, ${n} characters: the label is not fully inside the bubble`);
        }
        b.destroy();
      }
    });

    await test('markStale: a line too long for the bubble still shows its label; the next line starts clean', async () => {
      const { host } = makeHost('compact', 56, 344, 82);
      const b = createBuddy(host, { variant: 'bust', reducedMotion: true });
      const root = bub(host);
      const el = b.bubble.begin({ id: 'long' });
      el.append('一二三四五六七八九十一二三四五六七'.repeat(6));
      root.dataset.state = 'done';
      await tick(); await tick();
      eq(root.dataset.more, '1', 'the line overflows');
      b.bubble.markStale('已换一步');
      b.bubble.markStale('已落子');                     // a second label replaces the first, still without a jump
      await tick();
      eq(root.dataset.staleCorner, '1', 'corner placement');
      const r = root.getBoundingClientRect(), label = root.querySelector('.bubble__stale'), l = label.getBoundingClientRect();
      ok(!label.hidden && l.width > 0 && l.left >= r.left && l.right <= r.right + 0.5 && l.top >= r.top && l.bottom <= r.bottom + 0.5, 'label visible inside the bubble');
      const hit = document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2);
      ok(hit === label || hit === null, 'nothing lies over the label');     // null: the sandbox is off screen
      const next = b.bubble.begin({ id: 'next' });
      next.append('下一句。');
      await tick();
      eq([label.hidden, label.textContent, root.dataset.staleCorner], [true, '', undefined], 'the label is gone and reset');
      b.destroy();
    });

    await test('markStale with the keyboard up: the label takes no row of its own', async () => {
      const { wrap, host } = makeHost('landscape', 123, 480, 123);
      wrap.dataset.kb = '1';
      const b = createBuddy(host, { variant: 'bust', reducedMotion: true });
      const root = bub(host);
      const el = b.bubble.begin({ id: 'kb' });
      el.append('对方会走马7进5把炮吃掉，咱们只换到一个卒，亏了。');
      root.dataset.state = 'done';
      await tick();
      const h0 = root.getBoundingClientRect().height;
      b.bubble.markStale('已换一步');
      eq(root.getBoundingClientRect().height, h0, 'same height');
      const cs = getComputedStyle(root);
      const inner = root.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
      ok(inner >= 26 && inner % 26 <= 1, 'still a whole number of lines (got ' + inner + ' px of text)');
      b.destroy();
    });

    await test('compact: three lines of 17 characters fit in the 78 px a 360 x 640 phone leaves above the chips; one line is a 44 px target', async () => {
      const { host } = makeHost('compact', 56, 344, 78);
      const b = createBuddy(host, { variant: 'bust', reducedMotion: true });
      const root = bub(host);
      const el = b.bubble.begin({ id: 'c3' });
      el.append('一二三四五六七八九十一二三四五六七'.repeat(3));
      root.dataset.state = 'done';
      await tick(); await tick();
      const r = root.getBoundingClientRect();
      ok(r.height <= 78, 'inside the region (' + r.height + ')');
      eq(root.dataset.more, undefined, '51 characters fit: no more-mark');
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set([...range.getClientRects()].map((x) => Math.round(x.top)));
      eq(tops.size, 3, 'three lines');
      el.textContent = '好。';
      await tick(); await tick();
      ok(root.getBoundingClientRect().height >= 44, 'a one-line bubble is still 44 px high');
      b.destroy();
    });

    // ---------------------------------------------------------------------------------------------- buddy

    await test('reduced motion: a mood that arrives after a gesture ends the gesture’s stand-in; one set in the same turn keeps it', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      const svg = host.querySelector('svg.buddy');
      b.react('nod');
      eq(svg.dataset.eyes, 'happy', 'nod stand-in');
      await sleep(60);
      b.setMood('alarmed');
      eq([svg.dataset.eyes, svg.dataset.mouth], ['wide', 'bigo'], 'the alarmed face shows at once');
      await sleep(600);
      eq(svg.dataset.eyes, 'wide', 'and stays');
      b.setMood('idle');
      await sleep(20);
      b.react('shake'); b.setMood('worried');           // same turn: the stage reacts and sets the mood together
      eq(svg.dataset.mouth, 'wavy', 'stand-in kept');
      b.react('nod'); b.setMood('idle');
      eq(svg.dataset.eyes, 'happy', 'nod + idle in one turn (the `ok` row of 11.5) keeps the nod');
      await sleep(600);
      eq(svg.dataset.eyes, 'open', 'then the mood face');
      b.destroy();
    });

    await test('hold, pose and flap survive each other; destroy in the middle of all of them is silent', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      b.setBaseMood('worried');
      b.setMood('alarmed', { hold: 200 });
      b.setSpeaking(true);
      b.react('point');
      eq(svg.style.getPropertyValue('--arm-r'), '-95deg', 'pointing over the held mood');
      await sleep(300);
      eq([b.getMood(), svg.style.getPropertyValue('--arm-r')], ['worried', '-95deg'], 'the hold ended, the pose is still on');
      const seen = new Set();
      for (let i = 0; i < 20; i++) { seen.add(svg.dataset.mouth); await sleep(20); }
      eq([...seen].sort(), ['o', 'wavy'], 'the mouth flaps in the base mood after the hold');
      await sleep(400);
      eq(svg.style.getPropertyValue('--arm-r'), '-12deg', 'the pose ended: worried arm');
      b.setMood('cheering', { hold: 5000 }); b.react('point'); b.react('hop');
      b.destroy();
      const mouth = svg.dataset.mouth, arm = svg.style.getPropertyValue('--arm-r');
      await sleep(1000);
      eq([svg.dataset.mouth, svg.style.getPropertyValue('--arm-r'), b.getMood()], [mouth, arm, 'cheering'], 'nothing runs after destroy');
      b.setSpeaking(true); b.setReducedMotion(false); b.setBaseMood('idle'); b.bubble.clear();
      await sleep(200);
      eq(svg.dataset.mouth, mouth, 'calls after destroy do nothing');
    });

    await test('page hidden: blink, glance and flap stop; they resume when it is visible again', async () => {
      const { host } = makeHost('');
      const b = createBuddy(host, { variant: 'full' });
      const svg = host.querySelector('svg.buddy');
      b.setSpeaking(true);
      await sleep(300);
      let hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
      const m = svg.dataset.mouth;
      eq(m, 'smirk', 'the mouth rests while hidden');
      await sleep(400);
      eq(svg.dataset.mouth, m, 'no flapping while hidden');
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      const seen = new Set();
      for (let i = 0; i < 20; i++) { seen.add(svg.dataset.mouth); await sleep(20); }
      delete document.hidden;
      eq([...seen].sort(), ['o', 'smirk'], 'flapping again');
      b.destroy();
    });

    // ---------------------------------------------------------------------------------------------- rival

    await test('rival: no one-shot motion when html[data-motion] is not "full", even if setReducedMotion was never called', async () => {
      const { host } = makeHost('landscape');
      const r = createRivalView(host);
      const root = host.querySelector('.rival');
      const count = () => [...root.querySelectorAll('*'), root].flatMap((el) => el.getAnimations()).length;
      document.documentElement.dataset.motion = 'reduced';
      r.set({ mood: 'rattled', line: '竟有此着！' });
      r.set({ mood: 'smug' });
      eq(count(), 0, 'reduced');
      delete document.documentElement.dataset.motion;
      r.set({ mood: 'rattled' });
      eq(count(), 0, 'no attribute: the still state is the default');
      eq(getComputedStyle(root.querySelector('.rival__flash')).opacity, '1', 'the ring stays lit instead');
      document.documentElement.dataset.motion = 'full';
      r.set({ mood: 'rattled' });
      ok(count() >= 2, 'full: shake and flash');
    });

    await test('rival: in compact the spoken line takes the place of the name plate and stays clear of the right half of a 360 px bar', async () => {
      const { wrap, host } = makeHost('compact', 56, 244, 40);        // 344 px bar minus two 44 px buttons and gaps
      wrap.style.setProperty('--top', '40px');
      const r = createRivalView(host);
      r.setReducedMotion(true);
      const root = host.querySelector('.rival'), say = root.querySelector('.rival__say'), plate = root.querySelector('.rival__plate');
      r.set({ mood: 'calm', line: '此局是我输了。' });                 // the longest line of RIVAL_LINES
      const s = say.getBoundingClientRect(), p = plate.getBoundingClientRect(), d = root.querySelector('.rival__disc').getBoundingClientRect();
      ok(s.left >= d.right && s.left <= p.left + 1, `the tag starts where the plate starts (tag ${s.left}, plate ${p.left})`);
      eq(getComputedStyle(plate).visibility, 'hidden', 'the plate steps aside while he speaks');
      ok(s.right - d.left <= 200, `disc + tag fit in 200 px (got ${Math.round(s.right - d.left)})`);
      r.set({ mood: 'thinking' });
      eq(getComputedStyle(plate).visibility, 'hidden', 'the line is still showing');
      await sleep(2500);
      eq([getComputedStyle(plate).visibility, say.hidden], ['visible', false], 'the name is back; the thinking dots stay');
      ok(say.getBoundingClientRect().left >= plate.getBoundingClientRect().right, 'the dots sit to the right of the plate');
      wrap.dataset.layout = 'portrait';
      r.set({ mood: 'smug', line: '此计已成。' });
      eq(getComputedStyle(plate).visibility, 'visible', 'portrait: the plate stays');
      ok(say.getBoundingClientRect().left >= plate.getBoundingClientRect().right, 'portrait: the tag is to the right of the plate');
    });

    // ---------------------------------------------------------------------------------------------- with the real chat panel

    await test('with chat-panel: caption, sentence, trial comment, retract, tool round with late dots', async () => {
      const { createChatPanel } = await import('/src/ui/chat-panel.js');
      const { host } = makeHost('landscape');
      const chatHost = document.createElement('div');
      host.parentElement.append(chatHost);
      const b = createBuddy(host, { variant: 'full', reducedMotion: true });
      const speech = { supported: false, setEnabled() {}, feed() {}, flush() {}, cancel() {}, onSpeaking() {} };
      const audio = { play() {}, duck() {} };
      const chat = createChatPanel(chatHost, { bubble: b.bubble, speech, audio, typeTicks: false, reducedMotion: true });
      const root = bub(host);
      const T = (text) => ({ type: 'text', text });
      const q = (sel) => root.querySelector(sel);
      chat.caption([T('【马8进7】出子')]);
      await tick();
      eq([q('.bubble__caption').hidden, q('.bubble__caption').textContent.includes('出子'), root.dataset.empty], [false, true, undefined], 'caption alone');
      chat.begin({ id: 'o1', kind: 'opp', cue: null });
      chat.segment('o1', T('它的炮瞄着你的中兵。'));
      chat.end('o1', { reason: 'done', source: 'llm' });
      await tick();
      eq([q('.bubble__caption').hidden, q('.bubble__text').textContent, root.dataset.state, root.dataset.source], [false, '它的炮瞄着你的中兵。', 'done', 'llm'], 'caption + sentence');
      b.bubble.status('对方正在想…');
      eq(q('.bubble__text').textContent, '它的炮瞄着你的中兵。', 'status does not replace a finished line');
      chat.begin({ id: 't1', kind: 'try', cue: CUE.wait });
      chat.segment('t1', T('这个子，真的没人管吗？'));
      await tick();
      eq([q('.bubble__caption').hidden, q('.bubble__tag').textContent, q('.bubble__tag').dataset.tone], [true, '且慢……', 'warn'], 'a trial comment drops the caption');
      chat.end('t1', { reason: 'aborted', source: 'none', stale: '已换一步' });
      await tick();
      eq([root.dataset.state, q('.bubble__stale').textContent, q('.bubble__stale').hidden], ['stale', '已换一步', false], 'retract marks it stale');
      b.bubble.status('对方正在想…');
      eq([root.dataset.state, q('.bubble__text').textContent, q('.bubble__tag').hidden, q('.bubble__stale').hidden], ['status', '对方正在想…', true, true], 'status replaces the stale line');
      // a question with a slow tool round: the dots must come back for the resumed leg
      chat.addChild('炮二平五好不好？');
      chat.begin({ id: 'a1', kind: 'ask', cue: null });
      await sleep(450);
      eq([q('.bubble__dots').hidden, q('.bubble__question').hidden], [false, false], 'dots under the question');
      await sleep(1800);
      chat.tool('a1', { phase: 'start', notation: '炮二平五' });
      await tick();
      eq(q('.bubble__dots').hidden, true, 'the tool line replaces the dots');
      await sleep(1700);                                   // 3.95 s after begin
      chat.tool('a1', { phase: 'end' });
      await tick(); await tick();
      eq([q('.bubble__dots').hidden, root.dataset.empty], [false, undefined], 'dots again while the second leg is on its way');
      chat.segment('a1', T('这步不错。'));
      chat.end('a1', { reason: 'done', source: 'llm' });
      await tick(); await tick();
      eq([q('.bubble__dots').hidden, q('.bubble__text').textContent, q('.bubble__question').textContent], [true, '这步不错。', '炮二平五好不好？'], 'the answer under its question');
      chat.clear();
      await tick();
      eq(root.dataset.empty, '1', 'chat.clear empties the bubble');
      b.destroy();
    });

    sandbox.remove();
    return results;
  });

  const failed = result.filter((r) => !r.ok);
  for (const r of result) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n       ${r.error}`}`);
  console.log(`TESTS ${result.length}  PASS ${result.length - failed.length}  FAIL ${failed.length}`);
  if (failed.length) throw new Error(`${failed.length} test(s) failed`);
};
