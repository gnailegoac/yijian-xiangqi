// Pictures of the real board-view (X2, in progress) with the real fx: cannon capture, then a check banner, popup, stamp.
export default async ({ page }) => {
  const dir = process.env.FX_OUT;
  const err = await page.evaluate(async () => {
    try {
      const [{ createBoardView }, { createFx }, engine] = await Promise.all([import('/src/ui/board-view.js'), import('/src/ui/fx.js'), import('/src/core/engine.js')]);
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/styles/board.css'; document.head.append(link);
      await new Promise(r => { link.onload = r; link.onerror = r; });
      document.getElementById('lab').remove();
      const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:30px;top:20px;width:673px;overflow:clip;padding:36px';
      const host = document.createElement('div'); wrap.append(host); document.body.append(wrap);
      const fx = createFx({ reducedMotion: false });
      const audio = new Proxy({}, { get: () => () => {} });
      const board = engine.createInitialBoard();
      const view = createBoardView(host, { fx, audio, bottom: 'red', theme: 'chibi' });
      await view.setPosition(board);
      const move = engine.getLegalMoves(board, 'red').find(m => m.captured && m.piece.type === 'cannon');
      window.__probe = { view, fx, move, board, engine };
      return null;
    } catch (error) { return String(error && error.stack || error).slice(0, 600); }
  });
  if (err) { console.error('INTEG2 ERROR', err); return; }
  await page.waitForTimeout(300);
  const clip = { x: 0, y: 0, width: 760, height: 820 };
  await page.evaluate(() => { const { view, move } = window.__probe; void view.playMove(move, { actor: 'me', flags: { capture: true, check: true, mate: false } }); });
  for (let i = 1; i <= 9; i++) { await page.waitForTimeout(i < 5 ? 5 : 60); await page.screenshot({ path: `${dir}/k-move-${String(i).padStart(2, '0')}.png`, clip, scale: 'css' }); }
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const { view, fx, move } = window.__probe; const at = view.squareCenter(move.to); void fx.stamp('当头炮！', { size: 'full' }); fx.popup('主公英明！', at, { tone: 'lord' }); fx.popup('自己想的', at, { tone: 'mark' }); fx.confetti(); });
  for (let i = 1; i <= 3; i++) { await page.waitForTimeout(150); await page.screenshot({ path: `${dir}/k-praise-${String(i).padStart(2, '0')}.png`, clip, scale: 'css' }); }
};
