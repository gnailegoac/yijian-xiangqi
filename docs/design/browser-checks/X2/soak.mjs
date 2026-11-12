// Soak: random games through the tiny game of the harness (select, trial, switch, retract, confirm, rival reply),
// checking after every full move that the DOM is exactly the position and that nothing transient is left behind.
export default async ({ page }) => {
  const rounds = Number(process.env.ROUNDS ?? 30);
  const out = await page.evaluate(async (rounds) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { getPieceLegalMoves, tap } = window.lab;
    const game = window.game;
    const problems = [];
    const check = (where) => {
      const board = game.board;
      let n = 0;
      for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
        const p = board[row][col];
        const cellEl = document.querySelector(`.board-cell[data-row="${row}"][data-col="${col}"]`);
        if ((cellEl.dataset.piece || '') !== (p ? p.id : '')) problems.push(`${where}: cell ${row},${col} holds "${cellEl.dataset.piece}" not "${p ? p.id : ''}"`);
        if (!p) continue;
        n++;
        const el = document.querySelector(`.piece[data-id="${p.id}"]`);
        if (!el) { problems.push(`${where}: no element for ${p.id}`); continue; }
        if (el.dataset.row !== String(row) || el.dataset.col !== String(col)) problems.push(`${where}: ${p.id} drawn at ${el.dataset.row},${el.dataset.col} not ${row},${col}`);
        const box = el.getBoundingClientRect(), host = document.querySelector('#board').getBoundingClientRect(), c = window.view.cell(), want = window.view.squareCenter({ row, col });
        if (Math.abs(box.left + box.width / 2 - host.left - want.x) > 0.6 || Math.abs(box.top + box.height / 2 - host.top - want.y) > 0.12 * c + 1) problems.push(`${where}: ${p.id} is off its square`);
      }
      const all = document.querySelectorAll('.piece[data-id]').length;
      if (all !== n) problems.push(`${where}: ${all} piece elements for ${n} pieces`);
      const stray = document.querySelectorAll('.piece.is-ghost, .piece.is-trial, .piece.is-aim, .piece.is-moving, .piece.is-dragging, .piece__tag, .bv-trialring, .bv-trail, .bv-anticipate, .bv-flashring, .bv-magnet, .bv-g-trial > *').length;
      if (stray) problems.push(`${where}: ${stray} stray trial / transient nodes`);
      if (document.documentElement.dataset.uiBusy) problems.push(`${where}: still busy`);
      if (document.querySelectorAll('#board *').length - document.querySelectorAll('#board .bv-fx *').length > 400) problems.push(`${where}: more than 400 nodes`);
    };
    const idle = async () => { for (let i = 0; i < 400; i++) { if (!document.documentElement.dataset.uiBusy && (game.over || game.turn === game.human)) return; await sleep(25); } problems.push('timeout waiting for the turn'); };
    let moves = 0, games = 0;
    await window.demo.start();
    await idle();
    for (let i = 0; i < rounds; i++) {
      if (game.over) { games++; await window.demo.start(); await idle(); }
      const own = [];
      for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) { const p = game.board[row][col]; if (p && p.color === game.human && getPieceLegalMoves(game.board, row, col).length) own.push([row, col]); }
      if (!own.length) { game.over = true; continue; }
      const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
      let [row, col] = pickOne(own);
      tap(row, col);
      if (Math.random() < 0.25) { tap(row, col); [row, col] = pickOne(own); tap(row, col); }             // deselect, select another
      let targets = getPieceLegalMoves(game.board, row, col);
      const captures = targets.filter((m) => m.captured);
      let move = captures.length && Math.random() < 0.6 ? pickOne(captures) : pickOne(targets);
      tap(move.to.row, move.to.col);                                                                   // trial
      const r = Math.random();
      if (r < 0.2) { await sleep(Math.random() * 200); const other = pickOne(targets); tap(other.to.row, other.to.col); move = other; }   // switch target (or confirm when it is the same)
      else if (r < 0.35) { await sleep(Math.random() * 300); tap(row, col); await sleep(Math.random() * 200); tap(move.to.row, move.to.col); }   // retract to selected, try again
      else if (r < 0.45) { [row, col] = pickOne(own); tap(row, col); targets = getPieceLegalMoves(game.board, row, col); move = pickOne(targets); await sleep(50); if (game.selected) tap(move.to.row, move.to.col); }   // another piece
      if (game.trial) { if (Math.random() < 0.3) await sleep(Math.random() * 350); tap(game.trial.to.row, game.trial.to.col); }   // confirm, sometimes before the piece has arrived
      if (Math.random() < 0.15) { await sleep(Math.random() * 500); window.view.cancelAnimations(); }  // settle in mid-flight
      moves++;
      await idle();
      await sleep(60);
      check(`move ${moves}`);
      if (problems.length > 6) break;
    }
    return { moves, games, problems };
  }, rounds);
  console.log('SOAK', JSON.stringify(out));
};
