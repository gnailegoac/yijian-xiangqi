// Reviewer's adversarial checks of board-view.js. Run on dev/board.html?bare&nodeal.
export default async ({ page }) => {
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail: cond ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)) }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  page.on('pageerror', (e) => results.push({ name: 'PAGE ERROR', ok: false, detail: String(e) }));
  await ev(() => {
    window.__ev = [];
    for (const t of ['board:pick', 'board:dragcancel', 'board:cellfocus']) document.body.addEventListener(t, (e) => window.__ev.push([t.slice(6), e.detail.row, e.detail.col, e.detail.via ?? '']));
    window.__rej = [];
    window.addEventListener('unhandledrejection', (e) => window.__rej.push(String(e.reason)));
    const L = window.lab;
    window.A = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      mid() { const b = L.fenToBoard(L.MID).board; window.A.board = b; return window.view.setPosition(b); },
      start() { const b = L.createInitialBoard(); window.A.board = b; return window.view.setPosition(b); },
      at(id) { const p = document.querySelector(`.piece[data-id="${id}"]`); return p ? [Number(p.dataset.row), Number(p.dataset.col)] : null; },
      /** every piece element sits where the board says, no extra .piece[data-id], cells agree */
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
          if (Number(el.dataset.row) !== r || Number(el.dataset.col) !== c) bad.push(`${p.id} at ${el.dataset.row},${el.dataset.col} want ${r},${c}`);
          const want = window.view.squareCenter({ row: r, col: c });
          const hb = document.querySelector('#board').getBoundingClientRect(), eb = el.getBoundingClientRect();
          const cx = eb.left + eb.width / 2 - hb.left, cy = eb.top + eb.height / 2 - hb.top;
          if (Math.hypot(cx - want.x, cy - want.y) > 1.5) bad.push(`${p.id} drawn off by ${Math.round(Math.hypot(cx - want.x, cy - want.y))}px`);
          if (getComputedStyle(el).opacity !== '1') bad.push(`${p.id} opacity ${getComputedStyle(el).opacity}`);
        }
        for (const el of els) if (!seen.has(el)) bad.push(`extra ${el.dataset.id}`);
        const stray = document.querySelectorAll('#board .piece.is-ghost, #board .piece__tag, #board .bv-trialring, #board .bv-trail, #board .bv-anticipate, #board .bv-magnet, #board .bv-counter').length;
        if (stray) bad.push(`stray ${stray}`);
        return bad;
      },
      busy: () => document.documentElement.dataset.uiBusy ?? null,
    };
  });

  // T1: a capture committed from a hover trial (aim:false) must not leave the victim on the board
  const t1 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.mid();
    const moves = L.getPieceLegalMoves(A.board, 7, 2);          // red horse; one of its moves takes the pawn on (5,3)
    const cap = moves.find((m) => m.captured);
    v.setSelection({ row: 7, col: 2 }, moves, []);
    await v.showTentative(cap, { aim: false });
    await A.sleep(250);
    await v.commitTentative({ flags: L.QUIET });
    await A.sleep(300);
    const after = L.applyMove(A.board, cap);
    return { bad: A.consistent(after), victim: !!document.querySelector(`.piece[data-id="${cap.captured.id}"]`) };
  });
  ok('T1 hover trial of a capture (aim:false), commit: victim removed, board consistent', t1.bad.length === 0 && !t1.victim, t1);

  // T2: ttl arrows still expire after reduced motion was switched on
  const t2 = await ev(async () => {
    const A = window.A, v = window.view;
    await A.start();
    v.showArrows([{ from: { row: 9, col: 0 }, to: { row: 8, col: 0 }, style: 'reply' }], { group: 'ttl', ttl: 500 });
    v.setReducedMotion(true);
    await A.sleep(900);
    const n = document.querySelectorAll('#board .arrow').length;
    v.setReducedMotion(false);
    v.clearArrows();
    return n;
  });
  ok('T2 ttl of arrows survives setReducedMotion(true)', t2 === 0, t2);

  // T3: orientation switch during a hover trial, then retract
  const t3 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.start();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    const m = moves.find((x) => x.to.row === 7 && x.to.col === 4);
    v.setSelection({ row: 7, col: 7 }, moves, []);
    await v.showTentative(m);
    v.setOrientation('black');
    const hb = document.querySelector('#board').getBoundingClientRect();
    const el = document.querySelector('.piece[data-id="red-cannon-7"]'), eb = el.getBoundingClientRect();
    const want = v.squareCenter({ row: 7, col: 4 });
    const off = Math.hypot(eb.left + eb.width / 2 - hb.left - want.x, eb.top + eb.height / 2 - hb.top - want.y);
    const ghost = document.querySelector('#board .piece.is-ghost');
    const gb = ghost?.getBoundingClientRect(), gw = v.squareCenter({ row: 7, col: 7 });
    const goff = gb ? Math.hypot(gb.left + gb.width / 2 - hb.left - gw.x, gb.top + gb.height / 2 - hb.top - gw.y) : -1;
    const labels = [...document.querySelectorAll('#board .bv-art .bv-label')].map((n) => n.textContent).join('|');
    const marks = { ring: document.querySelectorAll('#board .bv-trialring').length, tag: document.querySelectorAll('#board .piece__tag').length, trail: document.querySelectorAll('#board .bv-trail').length, ghosts: document.querySelectorAll('#board .piece.is-ghost').length, to: document.querySelector('.board-cell.is-trial-to')?.dataset.row + ',' + document.querySelector('.board-cell.is-trial-to')?.dataset.col };
    await v.retractTentative({ reselect: false });
    await A.sleep(350);
    const bad = A.consistent(A.board);
    v.setOrientation('red');
    return { off, goff, labels, marks, bad, bad2: A.consistent(A.board) };
  });
  ok('T3 setOrientation during a hover trial keeps piece, ghost and marks in place; retract restores', t3.off < 14 && t3.goff >= 0 && t3.goff < 2 && t3.labels === '一二三四五六七八九|987654321' && t3.marks.ring === 1 && t3.marks.tag === 1 && t3.marks.trail === 1 && t3.marks.ghosts === 1 && t3.marks.to === '7,4' && t3.bad.length === 0 && t3.bad2.length === 0, t3);

  // T4: black at the bottom: a tap on the screen's bottom-left intersection is (0,8); labels; arrow keys in view space
  const t4 = await ev(async () => {
    const A = window.A, v = window.view;
    v.setOrientation('black');
    await A.start();
    const hb = document.querySelector('#board').getBoundingClientRect(), c = v.cell();
    const tab0 = [...document.querySelectorAll('.board-cell[tabindex="0"]')].map((n) => n.dataset.row + ',' + n.dataset.col).join();
    return { x: hb.left + 0.6 * c, y: hb.top + 9.8 * c, x2: hb.left + 8.6 * c, y2: hb.top + 0.8 * c, c, tab0 };
  });
  await ev(() => window.__ev.splice(0));
  await page.touchscreen.tap(t4.x, t4.y);
  await page.touchscreen.tap(t4.x2, t4.y2);
  const t4b = await ev(async () => {
    const v = window.view;
    const evs = window.__ev.splice(0).filter((e) => e[0] === 'pick');
    const labels = [...document.querySelectorAll('#board .bv-art .bv-label')].map((n) => n.textContent).join('|');
    const seals = [...document.querySelectorAll('#board .bv-art .bv-seal')].map((g) => g.textContent + g.querySelector('rect').getAttribute('x')).join();
    const tab0 = [...document.querySelectorAll('.board-cell[tabindex="0"]')].map((n) => `${n.dataset.row},${n.dataset.col}`).join();
    const aria = document.querySelector('.board-cell[data-row="2"][data-col="1"]').getAttribute('aria-label');     // black cannon on file 2
    const ariaRed = document.querySelector('.board-cell[data-row="7"][data-col="7"]').getAttribute('aria-label');  // red cannon on file 二
    // keyboard: from the black king (0,4) ArrowLeft goes to the screen-left neighbour = (0,5); ArrowUp goes to (1,5)
    const king = document.querySelector('.board-cell[data-row="0"][data-col="4"]');
    king.focus();
    king.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const f1 = document.activeElement.dataset.row + ',' + document.activeElement.dataset.col;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const f2 = document.activeElement.dataset.row + ',' + document.activeElement.dataset.col;
    document.activeElement.blur();
    v.setOrientation('red');
    return { evs, labels, seals, tab0, aria, ariaRed, f1, f2 };
  });
  ok('T4 black at the bottom: taps map to board squares, labels, seals swapped, king focus, aria files, arrows in view space',
    JSON.stringify(t4b.evs) === '[["pick",0,8,"tap"],["pick",9,0,"tap"]]' && t4b.labels === '一二三四五六七八九|987654321' && t4b.seals === '魏10,蜀870' && t4.tab0 === '0,4'
    && t4b.aria === '黑方炮，2路，第3行' && t4b.ariaRed === '红方炮，二路，第8行' && t4b.f1 === '0,5' && t4b.f2 === '1,5', { t4, t4b });

  // T5: commit right after a hover -> aim switch (the aim is not drawn yet)
  const t5 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.mid();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    const quiet = moves.find((m) => !m.captured), hit = moves.find((m) => m.captured);
    if (!hit) return { skip: true };
    v.setSelection({ row: 7, col: 7 }, moves, []);
    await v.showTentative(quiet);
    void v.showTentative(hit, { aim: true });
    const p = v.commitTentative({ flags: L.QUIET });
    await p;
    await A.sleep(400);
    return { bad: A.consistent(L.applyMove(A.board, hit)), busy: A.busy() };
  });
  ok('T5 commit during the 100 ms un-draw of a hover -> aim switch', !t5.skip && t5.bad.length === 0 && t5.busy === null, t5);

  // T6: setPosition while a cannon shot is in the air
  const t6 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.mid();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    const hit = moves.find((m) => m.captured);
    let resolved = false;
    v.playMove(hit, { actor: 'me', flags: L.QUIET }).then(() => { resolved = true; });
    await A.sleep(230);
    const b2 = L.createInitialBoard();
    await v.setPosition(b2);
    await A.sleep(0);
    const r1 = resolved;
    await A.sleep(700);
    return { r1, bad: A.consistent(b2), busy: A.busy(), n: document.querySelectorAll('#board .piece').length };
  });
  ok('T6 setPosition mid cannon shot: promise resolved, nothing stale, 32 pieces', t6.r1 && t6.bad.length === 0 && t6.busy === null && t6.n === 32, t6);

  // T7: a rival move arrives while a child trial hovers
  const t7 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.start();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    v.setSelection({ row: 7, col: 7 }, moves, []);
    await v.showTentative(moves.find((x) => x.to.row === 7 && x.to.col === 4));
    const rm = L.mv(A.board, 0, 1, 2, 2);
    await v.playMove(rm, { actor: 'rival', flags: L.QUIET });
    await A.sleep(100);
    return { bad: A.consistent(L.applyMove(A.board, rm)), trialing: document.querySelector('#board').classList.contains('is-trialing') };
  });
  ok('T7 playMove drops a hovering trial cleanly', t7.bad.length === 0 && !t7.trialing, t7);

  // T9: ghost play is aborted by a pick
  const t9 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.start();
    const b = A.board;
    const m1 = L.mv(b, 7, 7, 7, 4), b1 = L.applyMove(b, m1), m2 = L.mv(b1, 0, 7, 2, 6);
    v.previewLine([m1, m2], { stepMs: 300 });
    await A.sleep(450);
    return { ghosts: document.querySelectorAll('#board .piece.is-ghost').length, counter: document.querySelector('#board .bv-counter text')?.textContent, busy: A.busy() };
  });
  await page.locator('.board-cell[data-row="5"][data-col="4"]').tap();
  const t9b = await ev(async () => { await window.A.sleep(30); return { bad: window.A.consistent(window.A.board), busy: window.A.busy(), prev: document.querySelector('#board').classList.contains('is-previewing') }; });
  ok('T9 previewLine: ghosts + counter while it plays; a pick restores at once', t9.ghosts >= 1 && t9.counter === '2/2' && t9.busy === '1' && t9b.bad.length === 0 && t9b.busy === null && !t9b.prev, { t9, t9b });

  // T11: the river follows the tension also when the motion attribute is switched on after the tension was set
  const t11 = await ev(async () => {
    const A = window.A, v = window.view, root = document.documentElement;
    const inner = document.querySelector('#board .bv-river > i');
    root.dataset.motion = 'reduced'; v.setReducedMotion(true);
    v.setTension(1);
    v.setReducedMotion(false);                 // the stage may call this before it flips the attribute
    root.dataset.motion = 'full';
    await A.sleep(120);
    const rate = inner.getAnimations().map((a) => a.playbackRate);
    v.setTension(0.1);
    return rate;
  });
  ok('T11 river playbackRate = 0.6 + 1.4 x after the motion attribute comes back', t11.length === 1 && Math.abs(t11[0] - 2) < 0.001, t11);

  // T13: a touch drag onto a capture target: the piece goes back to its square and aims
  const t13 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.mid();
    window.__ev.splice(0);
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    const hit = moves.find((m) => m.captured);
    const once = (e) => {
      const { row, col } = e.detail;
      if (row === 7 && col === 7) v.setSelection({ row, col }, moves, []);
      else if (row === hit.to.row && col === hit.to.col) v.showTentative(hit, { aim: true });
    };
    document.body.addEventListener('board:pick', once);
    window.A.off = () => document.body.removeEventListener('board:pick', once);
    const hb = document.querySelector('#board').getBoundingClientRect();
    const a = v.squareCenter({ row: 7, col: 7 }), b = v.squareCenter(hit.to);
    return { ax: hb.left + a.x, ay: hb.top + a.y, bx: hb.left + b.x, by: hb.top + b.y, to: hit.to, c: v.cell() };
  });
  {
    const cdp = await page.context().newCDPSession(page);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(t13.ax, t13.ay) });
    const n = 10;
    for (let i = 1; i <= n; i++) {
      // the piece is drawn .6 c above the finger, so the finger ends .6 c below the target
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(t13.ax + (t13.bx - t13.ax) * i / n, t13.ay + (t13.by + 0.6 * t13.c - t13.ay) * i / n) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  const t13b = await ev(async () => {
    const A = window.A;
    await A.sleep(450);
    A.off();
    const el = document.querySelector('.piece[data-id="red-cannon-7"]');
    const hb = document.querySelector('#board').getBoundingClientRect(), eb = el.getBoundingClientRect(), want = window.view.squareCenter({ row: 7, col: 7 });
    const off = Math.hypot(eb.left + eb.width / 2 - hb.left - want.x, eb.top + eb.height / 2 - hb.top - want.y);
    const r = { evs: window.__ev.splice(0).filter((e) => e[0] !== 'cellfocus'), cls: el.className, translate: el.style.translate, off, reticle: document.querySelectorAll('#board .bv-reticle.is-lock').length };
    await window.view.retractTentative();
    await A.sleep(200);
    return r;
  });
  ok('T13 touch drag onto a capture target: pick(origin, drag), pick(target, drag); the piece is back on its square, aiming',
    JSON.stringify(t13b.evs) === JSON.stringify([['pick', 7, 7, 'drag'], ['pick', t13.to.row, t13.to.col, 'drag']]) && /is-aim/.test(t13b.cls) && !/is-dragging/.test(t13b.cls) && t13b.translate === '' && t13b.off < 0.2 * t13.c && t13b.reticle === 1, t13b);

  // T14: two trials in quick succession (D3 while the first flight is still on)
  const t14 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.start();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    const m1 = moves.find((x) => x.to.row === 7 && x.to.col === 4), m2 = moves.find((x) => x.to.row === 7 && x.to.col === 5);
    v.setSelection({ row: 7, col: 7 }, moves, []);
    void v.showTentative(m1);
    await A.sleep(60);
    await v.showTentative(m2);
    await A.sleep(100);
    const marks = { ring: document.querySelectorAll('#board .bv-trialring').length, tag: document.querySelectorAll('#board .piece__tag').length, trail: document.querySelectorAll('#board .bv-trail').length, ghosts: document.querySelectorAll('#board .piece.is-ghost').length, at: A.at('red-cannon-7') };
    await v.commitTentative({ flags: L.QUIET });
    await A.sleep(300);
    return { marks, bad: A.consistent(L.applyMove(A.board, m2)), busy: A.busy() };
  });
  ok('T14 switching the trial mid-flight leaves exactly one ring / tag / trail / ghost; commit lands on the second target', t14.marks.ring === 1 && t14.marks.tag === 1 && t14.marks.trail === 1 && t14.marks.ghosts === 1 && t14.marks.at.join() === '7,5' && t14.bad.length === 0 && t14.busy === null, t14);

  // T16: mate delivered by the child, then a new position
  const t16 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    const b = L.fenToBoard(L.MATE).board;
    await v.setPosition(b);
    const m = L.mv(b, 5, 8, 0, 8), after = L.applyMove(b, m), flags = L.flagsOf(after, m);
    const t0 = performance.now();
    await v.playMove(m, { actor: 'me', flags });
    const ms = performance.now() - t0;
    const king = document.querySelector('.piece[data-type="king"][data-color="black"]');
    const host = document.querySelector('#board');
    const r = { mate: flags.mate, ms, fallen: king.className, origin: host.style.transformOrigin, scale: getComputedStyle(host).scale, log: window.__log.slice(-14).join(';') };
    const b2 = L.createInitialBoard();
    await v.setPosition(b2);
    return { ...r, bad: A.consistent(b2), cls: [...document.querySelectorAll('#board .piece.is-fallen, #board .piece.is-grey')].length };
  });
  ok('T16 mate by the child: king fallen + grey, zoom reset, win sound, banner; setPosition clears it',
    t16.mate && /is-fallen/.test(t16.fallen) && /is-grey/.test(t16.fallen) && t16.origin === '' && (t16.scale === 'none' || t16.scale === '1') && t16.log.includes('♪ win') && t16.log.includes('fx.banner mate') && t16.bad.length === 0 && t16.cls === 0, t16);

  // T18: cancelAnimations during a hit-stop (rook rams a horse)
  const t18 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    const b = L.fenToBoard('4k4/9/9/9/9/1n7/9/9/1R7/4K4 w').board;
    await v.setPosition(b);
    const m = L.mv(b, 8, 1, 5, 1);
    let resolved = false;
    v.playMove(m, { actor: 'me', flags: L.QUIET }).then(() => { resolved = true; });
    await A.sleep(150 + 28 * 3 - 20);            // inside the hit-stop that starts at travel - 40
    v.cancelAnimations();
    await A.sleep(0);
    const r1 = resolved;
    await A.sleep(200);
    return { r1, bad: A.consistent(L.applyMove(b, m)), busy: A.busy(), log: window.__log.slice(-8).join(';') };
  });
  ok('T18 cancelAnimations inside a hit-stop: promise resolves, victim gone, piece seated', t18.r1 && t18.bad.length === 0 && t18.busy === null, t18);

  // T22: the whole 1 c x 1 c cell is the hit area: a tap near a cell's corner still reaches the nearest intersection
  await ev(async () => { await window.A.start(); window.__ev.splice(0); });
  const t22 = await ev(() => { const hb = document.querySelector('#board').getBoundingClientRect(), c = window.view.cell(), p = window.view.squareCenter({ row: 7, col: 7 }); return { x: hb.left + p.x, y: hb.top + p.y, c }; });
  for (const [dx, dy] of [[0.43, 0.43], [-0.43, 0.43], [0.43, -0.43], [-0.43, -0.43], [0.47, 0], [0, -0.47]]) await page.touchscreen.tap(t22.x + dx * t22.c, t22.y + dy * t22.c);
  const t22b = await ev(() => window.__ev.splice(0).filter((e) => e[0] === 'pick'));
  ok('T22 taps in the corners and at the edges of a cell (0.43 c diagonal, 0.47 c straight) all pick that cell', t22b.length === 6 && t22b.every((e) => e[1] === 7 && e[2] === 7 && e[3] === 'tap'), t22b);

  // T20: not interactive: no pick by tap or key, cells aria-disabled
  await ev(async () => { await window.A.start(); window.view.setInteractive(false); window.__ev.splice(0); });
  await page.locator('.board-cell[data-row="7"][data-col="7"]').tap({ force: true });
  const t20 = await ev(async () => {
    const cell = document.querySelector('.board-cell[data-row="7"][data-col="7"]');
    cell.click();
    const r = { evs: window.__ev.splice(0).filter((e) => e[0] === 'pick'), dis: document.querySelectorAll('.board-cell[aria-disabled="true"]').length, touch: getComputedStyle(cell).touchAction };
    window.view.setInteractive(true);
    return { ...r, dis2: document.querySelectorAll('.board-cell[aria-disabled="true"]').length };
  });
  ok('T20 setInteractive(false): no pick, 90 cells aria-disabled, own cells no longer touch-action none', t20.evs.length === 0 && t20.dis === 90 && t20.touch === 'manipulation' && t20.dis2 === 0, t20);

  // T21: destroy in the middle of a rival capture with a pending ttl arrow, highlight and demo ghost: nothing fires afterwards
  const t21 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.mid();
    v.showArrows([{ from: { row: 7, col: 1 }, to: { row: 7, col: 4 }, style: 'hint', demo: true }], { ttl: 400 });
    v.highlight({ pieces: [{ row: 9, col: 4 }], dim: true, ttl: 300 });
    const moves = L.getLegalMoves(A.board, 'black').filter((m) => m.captured);
    void v.playMove(moves[0], { actor: 'rival', flags: { ...L.QUIET, check: true } });
    await A.sleep(200);
    v.destroy();
    await A.sleep(1200);
    const host = document.querySelector('#board');
    return { kids: host.children.length, busy: A.busy(), rej: window.__rej.slice() };
  });
  ok('T21 destroy mid-move with pending timers: host stays empty, not busy, no rejection', t21.kids === 0 && t21.busy === null && t21.rej.length === 0, t21);

  const failed = results.filter((r) => !r.ok);
  console.log(`ADV ${results.length - failed.length}/${results.length} passed`);
  for (const r of failed) console.log(`FAIL ${r.name}\n     ${r.detail.slice(0, 1500)}`);
  if (process.env.VERBOSE) for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
};
