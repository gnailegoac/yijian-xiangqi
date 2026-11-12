// Reviewer's adversarial checks, batch 3: ghost play (F6) together with a trial. dev/board.html?bare&nodeal
export default async ({ page }) => {
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail: cond ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)) }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  page.on('pageerror', (e) => results.push({ name: 'PAGE ERROR', ok: false, detail: String(e) }));
  await ev(() => {
    const L = window.lab;
    window.A = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      start() { const b = L.createInitialBoard(); window.A.board = b; return window.view.setPosition(b); },
      mid() { const b = L.fenToBoard(L.MID).board; window.A.board = b; return window.view.setPosition(b); },
      /** centre of an element as board square (nearest), from where it is drawn */
      where(el) {
        const hb = document.querySelector('#board').getBoundingClientRect(), eb = el.getBoundingClientRect(), c = window.view.cell();
        const x = eb.left + eb.width / 2 - hb.left, y = eb.top + eb.height / 2 - hb.top;
        const vy = Math.round(y / c - 0.8), vx = Math.round(x / c - 0.6);
        return (document.querySelector('#board').dataset.bottom === 'red' ? [vy, vx] : [9 - vy, 8 - vx]).join();   // view -> board square
      },
      ghosts: () => [...document.querySelectorAll('#board .piece.is-ghost')].map((g) => `${g.className.replace('piece ', '').replace(' is-ghost', '')}@${window.A.where(g)}`),
      dimmed: () => [...document.querySelectorAll('#board .piece.is-dimmed')].map((g) => g.dataset.id).sort(),
    };
  });

  // P1: from 'now' while a hover trial is on the board; the line moves the trial piece itself (the "better move" case)
  const p1 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.start();
    const moves = L.getPieceLegalMoves(A.board, 7, 7);
    const tryMove = moves.find((x) => x.to.row === 7 && x.to.col === 4), better = moves.find((x) => x.to.row === 7 && x.to.col === 5);
    v.setSelection({ row: 7, col: 7 }, moves, []);
    await v.showTentative(tryMove);
    const before = A.ghosts();
    let done = false;
    v.previewLine([better], { stepMs: 200, from: 'now' }).then(() => { done = true; });
    await A.sleep(450);
    const during = { ghosts: A.ghosts(), dimmed: A.dimmed() };
    while (!done) await A.sleep(20);
    await A.sleep(30);
    const after = { ghosts: A.ghosts(), dimmed: A.dimmed(), piece: A.where(document.querySelector('.piece[data-id="red-cannon-7"]')), trial: document.querySelector('.piece[data-id="red-cannon-7"]').className };
    await v.retractTentative();
    await A.sleep(300);
    return { before, during, after, end: A.ghosts() };
  });
  ok('P1 preview from the committed position during a hover trial: the trial ghost stays on the origin, the line is played by a preview ghost, everything is restored',
    p1.before.join() === 'red@7,7' && p1.during.ghosts.includes('red@7,7') && p1.during.ghosts.includes('red is-preview@7,5') && p1.during.dimmed.join() === 'red-cannon-7'
    && p1.after.ghosts.join() === 'red@7,7' && p1.after.dimmed.length === 0 && p1.after.piece === '7,4' && /is-trial/.test(p1.after.trial) && p1.end.length === 0, p1);

  // P2: a real mover is dimmed while its ghost stands elsewhere; a captured piece is dimmed; restored afterwards
  const p2 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.mid();
    const b = A.board;
    const m1 = L.mv(b, 7, 2, 5, 3);                       // red horse takes the pawn on (5,3)
    let done = false;
    v.previewLine([m1], { stepMs: 200 }).then(() => { done = true; });
    await A.sleep(550);
    const during = { ghosts: A.ghosts(), dimmed: A.dimmed(), real: A.where(document.querySelector(`.piece[data-id="${m1.piece.id}"]`)) };
    while (!done) await A.sleep(20);
    await A.sleep(30);
    return { during, after: { ghosts: A.ghosts(), dimmed: A.dimmed() }, ids: [m1.piece.id, m1.captured.id].sort() };
  });
  ok('P2 ghost play: the mover and its victim are dimmed, the ghost stands on the target, the real pieces do not move',
    p2.during.ghosts.join() === 'red is-preview@5,3' && p2.during.dimmed.join() === p2.ids.join() && p2.during.real === '7,2' && p2.after.ghosts.length === 0 && p2.after.dimmed.length === 0, p2);

  // P3: from 'trial' with an aim: the mover's ghost is on the victim's square at once; the mover and the victim are dimmed
  const p3 = await ev(async () => {
    const A = window.A, L = window.lab, v = window.view;
    await A.mid();
    const b = A.board;
    const moves = L.getPieceLegalMoves(b, 7, 2);
    const cap = moves.find((m) => m.captured);
    v.setSelection({ row: 7, col: 2 }, moves, []);
    await v.showTentative(cap, { aim: true });
    const after1 = L.applyMove(b, cap);
    const reply = L.getLegalMoves(after1, 'black').find((m) => m.to.row === cap.to.row && m.to.col === cap.to.col);   // black takes back
    let done = false;
    v.previewLine(reply ? [reply] : [], { stepMs: 250, from: 'trial' }).then(() => { done = true; });
    const at0 = { ghosts: A.ghosts(), dimmed: A.dimmed() };
    await A.sleep(700);
    const during = { ghosts: A.ghosts(), dimmed: A.dimmed() };
    v.cancelAnimations();
    await A.sleep(20);
    const after = { ghosts: A.ghosts(), dimmed: A.dimmed(), done, aim: document.querySelector(`.piece[data-id="${cap.piece.id}"]`).className };
    await v.retractTentative();
    return { reply: !!reply, at0, during, after, ids: [cap.piece.id, cap.captured.id].sort(), replyId: reply?.piece.id, to: `${cap.to.row},${cap.to.col}` };
  });
  ok('P3 ghost play after an aim: ghost of the mover on the victim square, both real pieces dimmed; the reply takes the ghost; cancelAnimations restores',
    p3.reply && p3.at0.ghosts.join() === `red is-preview@${p3.to}` && p3.at0.dimmed.join() === p3.ids.join()
    && p3.during.ghosts.some((g) => g === `black is-preview@${p3.to}`) && p3.during.dimmed.includes(p3.replyId)
    && p3.after.ghosts.length === 0 && p3.after.dimmed.length === 0 && p3.after.done && /is-aim/.test(p3.after.aim), p3);

  const failed = results.filter((r) => !r.ok);
  console.log(`ADV3 ${results.length - failed.length}/${results.length} passed`);
  for (const r of failed) console.log(`FAIL ${r.name}\n     ${r.detail.slice(0, 1800)}`);
};
