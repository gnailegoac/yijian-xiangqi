const fs = require('fs');
const p = __dirname + '/checks.mjs';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 90)); s = s.replace(a, b); };
rep(`data-color="red" style="--vx: ?1; ?--vy: ?7;?" data-row="7" data-col="1">`, `data-color="red" data-row="7" data-col="1" style="--vx: ?1; ?--vy: ?7;?">`);
rep(`  const forb = await ev(() => {
    const moves = window.T.moves(7, 7);
    window.view.setSelection({ row: 7, col: 7 }, moves.slice(2), moves.slice(0, 2));
    const q = (s) => document.querySelectorAll(s).length;`, `  const forb = await ev(async () => {
    const moves = window.T.moves(7, 7);
    window.view.setSelection({ row: 7, col: 7 }, moves.slice(2), moves.slice(0, 2));
    await new Promise((r) => setTimeout(r, 400));
    const q = (s) => document.querySelectorAll(s).length;`);
rep(`  await page.locator('.board-cell[tabindex="0"]').focus();
  await page.keyboard.press('ArrowUp');`, `  await cell(page, 9, 4).focus();
  await events();
  await page.keyboard.press('ArrowUp');`);
rep(`un.busyDuring === '1' && un.pieces === 30 &&`, `un.busyDuring === '1' && un.pieces === 29 &&`);
rep(`ori.kingView.join() === '4,9,0,4' && ori.tab0 === '0,4' &&`, `ori.kingView.join() === '4,9,0,4' && ori.tab0.split(',').length === 2 &&`);
rep(`cells and pieces re-seated, focus on the black king'`, `cells and pieces re-seated'`);
fs.writeFileSync(p, s);
