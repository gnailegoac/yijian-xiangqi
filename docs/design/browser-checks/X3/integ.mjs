// Integration probe (scratch only): the real board-view (X2, in progress) driving the real fx on a blank page.
// It checks only fx's side: mount, resize, the calls board-view makes during a cannon capture with check.
export default async ({ page, shot }) => {
  const out = await page.evaluate(async () => {
    const log = [];
    try {
      const [{ createBoardView }, { createFx }, engine] = await Promise.all([import('/src/ui/board-view.js'), import('/src/ui/fx.js'), import('/src/core/engine.js')]);
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/styles/board.css'; document.head.append(link);
      await new Promise(r => { link.onload = r; link.onerror = r; });
      document.getElementById('lab').remove();
      const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:40px;top:40px;width:601px;overflow:clip;padding:36px';
      const host = document.createElement('div'); wrap.append(host); document.body.append(wrap);
      const real = createFx({ reducedMotion: false });
      const calls = {};
      const fx = new Proxy(real, { get(t, k) { const v = t[k]; if (typeof v !== 'function') return v; return (...a) => { calls[k] = (calls[k] || 0) + 1; return v.apply(t, a); }; } });
      const audio = new Proxy({}, { get: () => () => {} });
      const board = engine.createInitialBoard();
      const view = createBoardView(host, { fx, audio, bottom: 'red', theme: 'chibi' });
      await view.setPosition(board);
      await new Promise(r => setTimeout(r, 300));
      const cvs = host.querySelector('.fx-canvas');
      log.push(['mounted', !!cvs, [...host.querySelector('.bv-fx').children].map(e => e.className).join(' ')]);
      log.push(['cell', view.cell(), 'canvas', cvs && [cvs.width, cvs.height], 'css', cvs && [cvs.getBoundingClientRect().width, cvs.getBoundingClientRect().height].map(Math.round)]);
      // red cannon b2 x black horse b9 is a legal first move in xiangqi (炮二进七)
      const moves = engine.getLegalMoves(board, 'red');
      const move = moves.find(m => m.captured && m.piece.type === 'cannon');
      log.push(['move', move ? `${move.from.row},${move.from.col}->${move.to.row},${move.to.col} x ${move.captured.type}` : 'none']);
      window.__probe = { view, fx: real, calls, move };
      let peak = 0; let done = false;
      const p = view.playMove(move, { actor: 'me', flags: { capture: true, check: false, mate: false } }).then(() => { done = true; });
      const t0 = performance.now(); const shotsAt = [];
      while (!done && performance.now() - t0 < 4000) { peak = Math.max(peak, real.live); await new Promise(requestAnimationFrame); }
      await p;
      log.push(['playMove ms', Math.round(performance.now() - t0), 'peak live', peak, 'calls', JSON.stringify(calls)]);
    } catch (error) { log.push(['ERROR', String(error && error.stack || error).slice(0, 600)]); }
    return log;
  });
  for (const row of out) console.error('INTEG', JSON.stringify(row));
  // once more, with pictures
  await page.evaluate(() => { const { view, move } = window.__probe || {}; if (!view) return; });
};
