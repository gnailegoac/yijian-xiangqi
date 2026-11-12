// Reviewer's adversarial checks, batch 2 (mouse context: run WITHOUT --touch). dev/board.html?bare&nodeal
export default async ({ page }) => {
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail: cond ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)) }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  page.on('pageerror', (e) => results.push({ name: 'PAGE ERROR', ok: false, detail: String(e) }));
  await ev(() => {
    window.__ev = [];
    for (const t of ['board:pick', 'board:dragcancel', 'board:cellfocus']) document.body.addEventListener(t, (e) => window.__ev.push([t.slice(6), e.detail.row, e.detail.col, e.detail.via ?? '']));
    const L = window.lab;
    window.A = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      mid() { const b = L.fenToBoard(L.MID).board; window.A.board = b; return window.view.setPosition(b); },
      start() { const b = L.createInitialBoard(); window.A.board = b; return window.view.setPosition(b); },
      xy(row, col) { const hb = document.querySelector('#board').getBoundingClientRect(), p = window.view.squareCenter({ row, col }); return { x: hb.left + p.x, y: hb.top + p.y }; },
      consistent(board) {
        const bad = [];
        const els = [...document.querySelectorAll('#board .piece[data-id]')];
        const seen = new Set();
        for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
          const p = board[r][c];
          const cell = document.querySelector(`.board-cell[data-row="${r}"][data-col="${c}"]`);
          if ((cell.dataset.piece || '') !== (p ? p.id : '')) bad.push(`cell ${r},${c}=${cell.dataset.piece}`);
          if (!p) continue;
          const el = document.querySelector(`#board .piece[data-id="${p.id}"]`);
          if (!el) { bad.push(`missing ${p.id}`); continue; }
          seen.add(el);
          const want = window.view.squareCenter({ row: r, col: c });
          const hb = document.querySelector('#board').getBoundingClientRect(), eb = el.getBoundingClientRect();
          const off = Math.hypot(eb.left + eb.width / 2 - hb.left - want.x, eb.top + eb.height / 2 - hb.top - want.y);
          if (off > 1.5) bad.push(`${p.id} drawn off by ${Math.round(off)}px`);
          if (getComputedStyle(el).opacity !== '1') bad.push(`${p.id} opacity ${getComputedStyle(el).opacity}`);
          if (el.className !== `piece ${p.color}`) bad.push(`${p.id} class "${el.className}"`);
        }
        for (const el of els) if (!seen.has(el)) bad.push(`extra ${el.dataset.id}`);
        const stray = document.querySelectorAll('#board .piece.is-ghost, #board .piece__tag, #board .bv-trialring, #board .bv-trail, #board .bv-anticipate, #board .bv-magnet, #board .bv-counter').length;
        if (stray) bad.push(`stray ${stray}`);
        return bad;
      },
      busy: () => document.documentElement.dataset.uiBusy ?? null,
    };
  });

  // M1: mouse hover lifts only the child's pieces (A8); leaving drops it; a click is one pick via tap
  await ev(() => window.A.start());
  const own = await ev(() => window.A.xy(9, 0)), foe = await ev(() => window.A.xy(0, 0)), empty = await ev(() => window.A.xy(5, 4));
  await page.mouse.move(own.x, own.y);
  const h1 = await ev(() => ({ own: document.querySelector('.piece[data-id="red-rook-0"]').className, lift: getComputedStyle(document.querySelector('.piece[data-id="red-rook-0"] .piece__body')).transform }));
  await page.mouse.move(foe.x, foe.y);
  const h2 = await ev(() => ({ own: document.querySelector('.piece[data-id="red-rook-0"]').className, foe: document.querySelector('.piece[data-id="black-rook-0"]').className }));
  await ev(() => window.__ev.splice(0));
  await page.mouse.move(own.x, own.y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.move(empty.x, empty.y);
  const h3 = await ev(() => window.__ev.splice(0).filter((e) => e[0] === 'pick'));
  ok('M1 A8 hover on own piece only; click = exactly one pick via tap', /is-hover/.test(h1.own) && !/is-hover/.test(h2.own) && !/is-hover/.test(h2.foe) && JSON.stringify(h3) === '[["pick",9,0,"tap"]]', { h1, h2, h3 });

  // M2: mouse drag: follow, magnet ring near a target, drop on it -> pick(target, drag); drop elsewhere -> dragcancel + return
  const m2a = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.start();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    window.A.moves = moves;
    const h = (e) => { if (e.detail.row === 7 && e.detail.col === 7) v.setSelection({ row: 7, col: 7 }, moves, []); };
    document.body.addEventListener('board:pick', h);
    window.A.off = () => document.body.removeEventListener('board:pick', h);
    window.__ev.splice(0);
    return { a: A.xy(7, 7), b: A.xy(7, 4), far: A.xy(5, 6), c: v.cell() };
  });
  await page.mouse.move(m2a.a.x, m2a.a.y);
  await page.mouse.down();
  await page.mouse.move(m2a.a.x - 30, m2a.a.y, { steps: 3 });
  await page.mouse.move(m2a.b.x + 0.3 * m2a.c, m2a.b.y, { steps: 6 });
  await page.waitForTimeout(50);
  const m2b = await ev(() => ({ cls: document.querySelector('.piece[data-id="red-cannon-7"]').className, magnet: document.querySelectorAll('#board .bv-magnet').length, tr: document.querySelector('.piece[data-id="red-cannon-7"]').style.translate }));
  await page.mouse.move(m2a.far.x, m2a.far.y + 0.45 * m2a.c, { steps: 4 });
  await page.waitForTimeout(50);
  const m2c = await ev(() => ({ magnet: document.querySelectorAll('#board .bv-magnet').length }));
  await page.mouse.up();
  await page.waitForTimeout(300);
  const m2d = await ev(() => { const el = document.querySelector('.piece[data-id="red-cannon-7"]'); return { evs: window.__ev.splice(0).filter((e) => e[0] !== 'cellfocus'), cls: el.className, tr: el.style.translate, bad: window.A.consistent(window.A.board).filter((s) => !/class/.test(s)) }; });
  ok('M2 mouse drag: pick(origin, drag), magnet ring only near a target, off-target drop = dragcancel and return',
    /is-dragging/.test(m2b.cls) && m2b.magnet === 1 && m2b.tr !== '' && m2c.magnet === 0 && JSON.stringify(m2d.evs) === '[["pick",7,7,"drag"],["dragcancel",7,7,""]]' && !/is-dragging/.test(m2d.cls) && m2d.tr === '' && m2d.bad.length === 0, { m2b, m2c, m2d });
  await ev(() => window.A.off());

  // M3: undo of a recapture on the same square (rival took the piece that had just moved)
  const m3 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    const b0 = L.fenToBoard('4k4/9/9/9/4p4/9/4P4/9/9/4K3R w').board;
    await v.setPosition(b0);
    const m1 = L.mv(b0, 6, 4, 5, 4), b1 = L.applyMove(b0, m1);
    await v.playMove(m1, { actor: 'me', flags: L.QUIET });
    const m2 = L.mv(b1, 4, 4, 5, 4), b2 = L.applyMove(b1, m2);       // the black pawn takes it
    await v.playMove(m2, { actor: 'rival', flags: L.QUIET });
    const mid = A.consistent(b2);
    let done = false;
    const t0 = performance.now();
    v.undoMoves([m2, m1], b0).then(() => { done = true; });
    await A.sleep(60);
    const reborn = !!document.querySelector('.piece[data-id="' + m2.captured.id + '"]');
    while (!done) await A.sleep(10);
    const ms = performance.now() - t0;
    await A.sleep(50);
    return { mid, reborn, ms, bad: A.consistent(b0), last: document.querySelectorAll('#board .bv-lastto').length, log: window.__log.slice(-6).join(';') };
  });
  ok('M3 undo of two plies with a recapture on the same square: the taken piece comes back, ends on the old board, 340 ms', m3.mid.length === 0 && m3.reborn && m3.ms >= 330 && m3.ms < 460 && m3.bad.length === 0 && m3.last === 0 && m3.log.includes('♪ undo'), m3);

  // M4: three theme switches in a row leave one art; the old ones are gone after the cross-fade
  const m4 = await ev(async () => {
    const A = window.A, v = window.view;
    await A.start();
    v.setTheme('longzhong'); v.setTheme('shachang'); v.setTheme('chibi');
    const during = document.querySelectorAll('#board .bv-art').length;
    await A.sleep(320);
    const after = document.querySelectorAll('#board .bv-art').length;
    const first = document.querySelector('#board').firstElementChild.getAttribute('class');
    v.setTheme('shachang');
    const pennants = document.querySelectorAll('#board .bv-pennant').length;
    const river = getComputedStyle(document.querySelector('#board .bv-river')).display;
    v.setTheme('chibi');
    await A.sleep(260);
    return { during, after, first, pennants, river, theme: document.querySelector('#board').dataset.theme, nodes: document.querySelectorAll('#board *').length };
  });
  ok('M4 theme switches: one art afterwards, first layer; shachang has two pennants and no river', m4.during >= 2 && m4.after === 1 && m4.first === 'bv-art' && m4.pennants === 2 && m4.river === 'none' && m4.theme === 'chibi' && m4.nodes <= 400, m4);

  // M5: deal, cancelled at once: every piece shown in place, promise resolved, 开战 banner not left pending
  const m5 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    const b = L.createInitialBoard();
    let done = false;
    v.setPosition(b, { deal: true }).then(() => { done = true; });
    await A.sleep(90);
    const hidden = [...document.querySelectorAll('#board .piece')].filter((p) => getComputedStyle(p).opacity !== '1').length;
    v.cancelAnimations();
    await A.sleep(0);
    return { hidden, done, bad: A.consistent(b), busy: A.busy() };
  });
  ok('M5 deal: pieces drop in staggered; cancelAnimations shows all 32 and resolves', m5.hidden > 0 && m5.done && m5.bad.length === 0 && m5.busy === null, m5);

  // M6: the guard is per trial: a new trial starts with the default 200 ms again, and the origin always reports
  const m6a = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.start();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    v.setSelection({ row: 7, col: 7 }, moves, []);
    await v.showTentative(moves.find((x) => x.to.col === 4));
    v.setTrialGuard(700, true);
    await v.showTentative(moves.find((x) => x.to.col === 5));      // D3: a fresh trial
    await A.sleep(260);
    window.__ev.splice(0);
    return { to: A.xy(7, 5), from: A.xy(7, 7) };
  });
  await page.mouse.click(m6a.to.x, m6a.to.y);
  await page.mouse.click(m6a.from.x, m6a.from.y);
  const m6b = await ev(() => window.__ev.splice(0).filter((e) => e[0] === 'pick'));
  ok('M6 a switched trial has the default guard again (tap after 260 ms reports); origin reports', JSON.stringify(m6b) === '[["pick",7,5,"tap"],["pick",7,7,"tap"]]', m6b);

  // M7: highlight: ttl, cleared by a pick, redrawn by an orientation change
  const m7 = await ev(async () => {
    const A = window.A, v = window.view;
    await A.start();
    v.highlight({ pieces: [{ row: 7, col: 7 }], squares: [{ row: 5, col: 3 }, { row: 4, col: 5 }], dim: true, ttl: 400 });
    const on = { spot: document.querySelectorAll('#board .bv-spot').length, ring: document.querySelectorAll('#board .bv-hlring').length, area: document.querySelectorAll('#board .bv-hlarea').length, mask: document.querySelectorAll('#board mask circle').length };
    v.setOrientation('black');
    const ring = document.querySelector('#board .bv-hlring');
    const want = v.squareCenter({ row: 7, col: 7 }), c = v.cell();
    const flipped = Math.abs(Number(ring.getAttribute('cx')) / 100 * c - want.x) < 1 && Math.abs(Number(ring.getAttribute('cy')) / 100 * c - want.y) < 1;
    v.setOrientation('red');
    await A.sleep(700);
    const off = document.querySelectorAll('#board .bv-spot, #board .bv-hlring, #board .bv-hlarea, #board mask').length;
    return { on, flipped, off };
  });
  ok('M7 highlight: spot + ring + area + mask hole; follows the orientation; gone after ttl', m7.on.spot === 1 && m7.on.ring === 1 && m7.on.area === 1 && m7.on.mask === 1 && m7.flipped && m7.off === 0, m7);

  // M8: mouse pressed on an edge piece, released outside the board: coming back must not start a drag without a button
  const m8a = await ev(async () => { await window.A.start(); window.__ev.splice(0); const hb = document.querySelector('#board').getBoundingClientRect(); return { p: window.A.xy(9, 0), left: hb.left, in: window.A.xy(7, 3) }; });
  await page.mouse.move(m8a.p.x - 8, m8a.p.y);
  await page.mouse.down();
  await page.mouse.move(m8a.left - 6, m8a.p.y + 40);      // out of the board in one step
  await page.mouse.up();
  await page.mouse.move(m8a.in.x, m8a.in.y, { steps: 4 });
  await page.waitForTimeout(60);
  const m8b = await ev(() => { const el = document.querySelector('.piece[data-id="red-rook-0"]'); return { cls: el.className.replace(' is-hover', ''), tr: el.style.translate, evs: window.__ev.splice(0).filter((e) => e[0] !== 'cellfocus') }; });
  await page.mouse.down(); await page.mouse.up();
  ok('M8 a mouse button released outside the board leaves no stale press: no drag starts on re-entry', m8b.cls === 'piece red' && m8b.tr === '' && m8b.evs.length === 0, m8b);

  const failed = results.filter((r) => !r.ok);
  console.log(`ADV2 ${results.length - failed.length}/${results.length} passed`);
  for (const r of failed) console.log(`FAIL ${r.name}\n     ${r.detail.slice(0, 1500)}`);
};
