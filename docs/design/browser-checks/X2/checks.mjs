// Behaviour checks of board-view.js against the contract (§4.28.1, §10.2, §10.3). Run on dev/board.html?bare&nodeal.
import { cell } from './lib.mjs';
export default async ({ page }) => {
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail: cond ? '' : String(detail) }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const events = async () => ev(() => window.__ev.splice(0));
  await ev(() => {
    window.__ev = [];
    for (const t of ['board:pick', 'board:dragcancel', 'board:cellfocus']) document.body.addEventListener(t, (e) => window.__ev.push([t.slice(6), e.detail.row, e.detail.col, e.detail.via ?? '']));
    window.T = {
      start() { window.T.board = null; return window.view.setPosition(window.lab.createInitialBoard()); },
      mid() { const b = window.lab.fenToBoard(window.lab.MID).board; window.T.board = b; return window.view.setPosition(b); },
      moves(r, c) { return window.lab.getPieceLegalMoves(window.T.board ?? window.lab.createInitialBoard(), r, c); },
      pieceAt(id) { const p = document.querySelector(`.piece[data-id="${id}"]`); return p ? [Number(p.dataset.row), Number(p.dataset.col)] : null; },
      busy: () => document.documentElement.dataset.uiBusy ?? null,
    };
  });

  // ---- DOM (§10.2.4) and the hook table (§4.28.9) ----
  const dom = await ev(() => {
    const bv = document.querySelector('#board');
    return {
      cls: bv.className, bottom: bv.dataset.bottom, theme: bv.dataset.theme, c: bv.style.getPropertyValue('--c'),
      kids: [...bv.children].map((n) => (n.id ? `#${n.id}` : `${n.tagName.toLowerCase()}.${n.classList[0]}`)),
      cells: bv.querySelectorAll('button.board-cell[data-row][data-col][data-piece]').length,
      pieces: bv.querySelectorAll('.piece[data-id][data-type][data-color][data-row][data-col]').length,
      piece: bv.querySelector('.piece[data-id="red-cannon-1"]').outerHTML.replace(/\s+/g, ' '),
      hit: [bv.querySelector('.bv-hit').getAttribute('role'), bv.querySelector('.bv-hit').getAttribute('aria-label')],
      ann: [document.getElementById('board-announcement').getAttribute('role'), document.getElementById('board-announcement').getAttribute('aria-live'), document.getElementById('board-announcement').className],
      labels: [...bv.querySelectorAll('.bv-label')].map((n) => n.textContent),
      tab0: [...bv.querySelectorAll('.board-cell[tabindex="0"]')].map((n) => `${n.dataset.row},${n.dataset.col}`),
      aria: [bv.querySelector('.board-cell[data-row="7"][data-col="7"]'), bv.querySelector('.board-cell[data-row="0"][data-col="7"]'), bv.querySelector('.board-cell[data-row="4"][data-col="4"]')].map((n) => n.getAttribute('aria-label')),
      piece77: bv.querySelector('.board-cell[data-row="7"][data-col="7"]').dataset.piece,
      viewBox: bv.querySelector('.bv-art').getAttribute('viewBox'),
      center: window.view.squareCenter({ row: 0, col: 0 }), center98: window.view.squareCenter({ row: 9, col: 8 }), cell: window.view.cell(),
      ratio: bv.getBoundingClientRect().width / bv.getBoundingClientRect().height,
      touch: getComputedStyle(bv.querySelector('.board-cell.is-mine')).touchAction, touchOther: getComputedStyle(bv.querySelector('.board-cell:not(.is-mine)')).touchAction,
      userSelect: getComputedStyle(bv).userSelect, cellSize: bv.querySelector('.board-cell').getBoundingClientRect().width,
      pieceSize: bv.querySelector('.piece').getBoundingClientRect().width, glyph: parseFloat(getComputedStyle(bv.querySelector('.piece__glyph')).fontSize),
      octagon: bv.querySelector('.piece.black .piece__ring polygon') ? 1 : 0, circle: bv.querySelector('.piece.red .piece__ring circle')?.getAttribute('r'),
      seals: [...bv.querySelectorAll('.bv-seal')].map((g) => g.textContent + g.querySelector('rect').getAttribute('x')),
    };
  });
  ok('host is .bv with data-bottom / data-theme / --c', dom.cls.includes('bv') && dom.bottom === 'red' && dom.theme === 'chibi' && dom.c === '65.28px', JSON.stringify([dom.cls, dom.bottom, dom.theme, dom.c]));
  ok('layer order of §10.2.4', dom.kids.join(' ').replace(/ div\.(bv-glow|bv-deco|bv-tension|bv-edge|bv-veil)/g, '') === 'svg.bv-art div.bv-river svg.bv-marks div.bv-pieces svg.bv-over div.bv-fx div.bv-hit #board-announcement', dom.kids.join(' '));
  ok('90 cells, 32 pieces with their data attributes', dom.cells === 90 && dom.pieces === 32, `${dom.cells} ${dom.pieces}`);
  ok('piece markup of §10.2.3', /^<div class="piece red" data-id="red-cannon-1" data-type="cannon" data-color="red" data-row="7" data-col="1" style="--vx: ?1; ?--vy: ?7;?"><div class="piece__shadow"><\/div><div class="piece__body"><div class="piece__disc"><\/div><svg class="piece__ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35"><\/circle><\/svg><span class="piece__glyph">炮<\/span><\/div><\/div>$/.test(dom.piece), dom.piece);
  ok('hit group and announcement region', dom.hit.join() === 'group,棋盘' && dom.ann.join() === 'status,polite,sr-only', JSON.stringify([dom.hit, dom.ann]));
  ok('file labels, red at the bottom: top 1…9, bottom 九…一', dom.labels.join('|') === '123456789|九八七六五四三二一', dom.labels.join('|'));
  ok('roving tabindex starts on the child\'s king', dom.tab0.join() === '9,4', dom.tab0.join());
  ok('aria-label like 红方炮，二路，第8行', dom.aria[0] === '红方炮，二路，第8行' && dom.aria[1] === '黑方马，8路，第1行' && dom.aria[2] === '空位，五路，第5行', dom.aria.join(' / '));
  ok('cell keeps data-piece', dom.piece77 === 'red-cannon-7', dom.piece77);
  ok('viewBox 0 0 920 1060 and aspect ratio', dom.viewBox === '0 0 920 1060' && Math.abs(dom.ratio - 920 / 1060) < 0.002, `${dom.viewBox} ${dom.ratio}`);
  ok('squareCenter = pxPoint, cell() = c', Math.abs(dom.center.x - 0.6 * 65.28) < 0.01 && Math.abs(dom.center.y - 0.8 * 65.28) < 0.01 && Math.abs(dom.center98.x - 8.6 * 65.28) < 0.01 && Math.abs(dom.center98.y - 9.8 * 65.28) < 0.01 && dom.cell === 65.28, JSON.stringify([dom.center, dom.center98, dom.cell]));
  ok('own cells touch-action none, others manipulation; user-select none', dom.touch === 'none' && dom.touchOther === 'manipulation' && dom.userSelect === 'none', `${dom.touch} ${dom.touchOther} ${dom.userSelect}`);
  ok('cell is one full cell (>= 44 px on the iPad), piece 0.88 c, glyph 0.50 c', Math.abs(dom.cellSize - 65.28) < 0.1 && Math.abs(dom.pieceSize - 0.88 * 65.28) < 0.1 && Math.abs(dom.glyph - 32.64) < 0.1, `${dom.cellSize} ${dom.pieceSize} ${dom.glyph}`);
  ok('ring: red circle r 35, black octagon', dom.octagon === 1 && dom.circle === '35', `${dom.octagon} ${dom.circle}`);
  ok('camp seals: 蜀 at the bottom left, 魏 at the top right', dom.seals.join() === '蜀10,魏870', dom.seals.join());

  // ---- tap, selection ----
  await events();
  await cell(page, 7, 7).tap();
  ok('tap emits board:pick via tap', JSON.stringify(await events()).includes('["pick",7,7,"tap"]'));
  const sel = await ev(() => {
    const moves = window.T.moves(7, 7);
    window.view.setSelection({ row: 7, col: 7 }, moves, []);
    const q = (s) => document.querySelectorAll(s).length;
    return { n: moves.length, caps: moves.filter((m) => m.captured).length, selPiece: q('.piece.is-selected[data-id="red-cannon-7"]'), selCell: q('.board-cell.is-selected[data-row="7"][data-col="7"]'),
      legal: q('.board-cell.is-legal'), capture: q('.board-cell.is-legal.is-capture'), dots: q('circle.bv-dot'), ring: q('circle.bv-selring'), reticles: q('g.bv-reticle'),
      label: document.querySelector('.board-cell[data-row="7"][data-col="4"]').getAttribute('aria-label'), pressed: document.querySelector('.board-cell[data-row="7"][data-col="7"]').getAttribute('aria-pressed'),
      log: window.__log.slice(-2).join(';') };
  });
  ok('setSelection: classes, ring, dots, reticles, sound', sel.selPiece === 1 && sel.selCell === 1 && sel.legal === sel.n && sel.capture === sel.caps && sel.dots === sel.n - sel.caps && sel.ring === 1 && sel.reticles === sel.caps && sel.caps === 1 && sel.label.endsWith('，可走') && sel.pressed === 'true' && sel.log.includes('♪ select'), JSON.stringify(sel));
  const forb = await ev(async () => {
    const moves = window.T.moves(7, 7);
    window.view.setSelection({ row: 7, col: 7 }, moves.slice(2), moves.slice(0, 2));
    await new Promise((r) => setTimeout(r, 400));
    const q = (s) => document.querySelectorAll(s).length;
    const r = { forbid: q('g.bv-forbid'), cells: q('.board-cell.is-forbidden'), legal: q('.board-cell.is-legal'), n: moves.length, op: getComputedStyle(document.querySelector('g.bv-forbid')).opacity, sounds: window.__log.filter((l) => l.includes('♪ select')).length };
    window.view.setSelection(null);
    r.after = q('.piece.is-selected, .board-cell.is-selected, .board-cell.is-legal, .board-cell.is-forbidden');
    r.desel = window.__log.slice(-1)[0];
    window.view.setSelection({ row: 7, col: 7 }, moves, []);
    return r;
  });
  ok('forbidden targets: dot at 35 % with a bar, cell .is-forbidden; deselect clears and sounds', forb.forbid === 2 && forb.cells === 2 && forb.legal === forb.n - 2 && forb.op === '0.35' && forb.sounds === 1 && forb.after === 0 && forb.desel.includes('♪ deselect'), JSON.stringify(forb));

  // ---- trial + guard ----
  const landMs = await ev(async () => {
    const m = window.T.moves(7, 7).find((x) => x.to.row === 7 && x.to.col === 4);
    const t0 = performance.now();
    const p = window.view.showTentative(m, { liftStep: 3 });
    const busyDuring = window.T.busy();
    await p;
    return { ms: performance.now() - t0, busyDuring, busyAfter: window.T.busy(), at: window.T.pieceAt('red-cannon-7'), trial: document.querySelectorAll('.piece.is-trial[data-id="red-cannon-7"]').length,
      ghost: document.querySelectorAll('.piece.is-ghost').length, ghostId: document.querySelector('.piece.is-ghost').dataset.id ?? null, tag: document.querySelector('.piece__tag')?.textContent,
      from: document.querySelectorAll('.board-cell.is-trial-from[data-row="7"][data-col="7"]').length, to: document.querySelectorAll('.board-cell.is-trial-to[data-row="7"][data-col="4"]').length,
      ring: document.querySelectorAll('circle.bv-trialring').length, trail: document.querySelectorAll('path.bv-trail').length, cellPiece: document.querySelector('.board-cell[data-row="7"][data-col="7"]').dataset.piece,
      log: window.__log.slice(-3).join(';') };
  });
  // table B: cannon 170 + 30 d with d = 3, x 0.85 = 221 ms
  ok('showTentative: hover trial resolves at landing (221 ms), busy flag, marks, ghost, 试', Math.abs(landMs.ms - 221) < 60 && landMs.busyDuring === '1' && landMs.busyAfter === null && landMs.at.join() === '7,4' && landMs.trial === 1 && landMs.ghost === 1 && landMs.ghostId === null && landMs.tag === '试' && landMs.from === 1 && landMs.to === 1 && landMs.ring === 1 && landMs.trail === 1 && landMs.cellPiece === 'red-cannon-7', JSON.stringify(landMs));
  ok('trial sounds: travel sound with ms = 221', /move\.cannon \{"ms":221\}/.test(landMs.log), landMs.log);
  await events();
  await cell(page, 7, 4).tap();                           // right after landing: inside the 200 ms guard
  const early = await events();
  await page.waitForTimeout(260);
  const lift = await ev(() => window.__log.filter((l) => l.includes('trial.lift')).slice(-1)[0]);
  ok('trial.lift sounds at the landing with the step', lift === '♪ trial.lift {"step":3}', lift);
  await cell(page, 7, 4).tap();
  const late = await events();
  ok('guard: a tap on the destination is swallowed before 200 ms, reported after', !JSON.stringify(early).includes('pick') && JSON.stringify(late).includes('["pick",7,4,"tap"]'), JSON.stringify([early, late]));
  await cell(page, 7, 7).tap();
  ok('the origin square always reports', JSON.stringify(await events()).includes('["pick",7,7,"tap"]'));
  // D3: glide to another target, ghost stays
  const d3 = await ev(async () => {
    const ghost = document.querySelector('.piece.is-ghost'), tag = document.querySelector('.piece__tag');
    const m = window.T.moves(7, 7).find((x) => x.to.row === 7 && x.to.col === 5);
    const t0 = performance.now();
    await window.view.showTentative(m, { liftStep: 4 });
    const q = (s) => document.querySelectorAll(s).length;
    return { ms: performance.now() - t0, at: window.T.pieceAt('red-cannon-7'), sameGhost: document.querySelector('.piece.is-ghost') === ghost, sameTag: document.querySelector('.piece__tag') === tag, ghosts: q('.piece.is-ghost'), rings: q('.bv-trialring'), trails: q('.bv-trail'),
      to: q('.board-cell.is-trial-to[data-row="7"][data-col="5"]'), oldTo: q('.board-cell.is-trial-to[data-row="7"][data-col="4"]') };
  });
  // D3: 160 + 20 d with d = 1 -> 180 ms
  ok('D3 switch: glides directly (180 ms), ghost and tag stay, ring and trail re-target', Math.abs(d3.ms - 180) < 60 && d3.at.join() === '7,5' && d3.sameGhost && d3.sameTag && d3.ghosts === 1 && d3.rings === 1 && d3.trails === 1 && d3.to === 1 && d3.oldTo === 0, JSON.stringify(d3));
  // 700 ms guard (blunder)
  await ev(() => { window.view.setTrialGuard(700, true); });
  await page.waitForTimeout(350);
  await events();
  await cell(page, 7, 5).tap();
  const mid = await events();
  await page.waitForTimeout(500);
  await cell(page, 7, 5).tap();
  const after = await events();
  ok('setTrialGuard(700): swallowed at ~400 ms, reported after 700 ms', !JSON.stringify(mid).includes('pick') && JSON.stringify(after).includes('["pick",7,5,"tap"]'), JSON.stringify([mid, after]));

  // retract with reselect
  const ret = await ev(async () => {
    const t0 = performance.now();
    const p = window.view.retractTentative({ reselect: true });
    const busyDuring = window.T.busy();
    await p;
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 300));
    const q = (s) => document.querySelectorAll(s).length;
    return { ms, busyDuring, at: window.T.pieceAt('red-cannon-7'), sel: q('.piece.is-selected[data-id="red-cannon-7"]'), trial: q('.piece.is-trial'), ghost: q('.piece.is-ghost'), tag: q('.piece__tag'), ring: q('.bv-trialring'), trail: q('.bv-trail'),
      dots: q('circle.bv-dot'), tcells: q('.board-cell.is-trial-from, .board-cell.is-trial-to'), log: window.__log.slice(-1)[0] };
  });
  ok('retractTentative({reselect}): back on the origin, selected again, marks gone (240 ms)', Math.abs(ret.ms - 240) < 60 && ret.busyDuring === null && ret.at.join() === '7,7' && ret.sel === 1 && ret.trial === 0 && ret.ghost === 0 && ret.tag === 0 && ret.ring === 0 && ret.trail === 0 && ret.dots > 0 && ret.tcells === 0 && ret.log.includes('trial.retract'), JSON.stringify(ret));

  // aim trial: the piece does not travel
  const aim = await ev(async () => {
    const m = window.T.moves(7, 7).find((x) => x.captured);
    await window.view.showTentative(m, { aim: true });
    const q = (s) => document.querySelectorAll(s).length;
    return { at: window.T.pieceAt('red-cannon-7'), cls: document.querySelector('.piece[data-id="red-cannon-7"]').className, lock: q('g.bv-reticle.is-lock'), trail: q('path.bv-trail.is-aim'), ring: q('.bv-trialring'), ghost: q('.piece.is-ghost'),
      victim: !!document.querySelector('.piece[data-id="black-horse-7"]'), to: q('.board-cell.is-trial-to[data-row="0"][data-col="7"]'), tag: q('.piece[data-id="red-cannon-7"] .piece__tag') };
  });
  ok('aim trial: piece stays on its origin, reticle locks, aim line, ring on the victim', aim.at.join() === '7,7' && /is-trial/.test(aim.cls) && /is-aim/.test(aim.cls) && aim.lock === 1 && aim.trail === 1 && aim.ring === 1 && aim.ghost === 0 && aim.victim && aim.to === 1 && aim.tag === 1, JSON.stringify(aim));
  // D6: commit of the aim = the capture from the origin, within 700 ms
  const d6 = await ev(async () => {
    const n = window.__log.length;
    const t0 = performance.now();
    const p = window.view.commitTentative({ flags: window.lab.QUIET });
    const busyDuring = window.T.busy();
    await p;
    const q = (s) => document.querySelectorAll(s).length;
    return { ms: performance.now() - t0, busyDuring, busyAfter: window.T.busy(), at: window.T.pieceAt('red-cannon-7'), victim: q('.piece[data-id="black-horse-7"]'), pieces: q('.piece'), trial: q('.piece.is-trial, .piece.is-aim, .piece.is-ghost, .piece__tag'),
      marks: q('.bv-trialring, .bv-trail, .bv-reticle'), last: [q('.board-cell.is-last-from[data-row="7"][data-col="7"]'), q('.board-cell.is-last-to[data-row="0"][data-col="7"]'), document.querySelector('.bv-lastto')?.dataset.by],
      cell: document.querySelector('.board-cell[data-row="0"][data-col="7"]').dataset.piece, cellFrom: document.querySelector('.board-cell[data-row="7"][data-col="7"]').dataset.piece, sel: q('.piece.is-selected, .bv-dot, .bv-selring'),
      log: window.__log.slice(n).join(';') };
  });
  ok('D6 commit: full cannon shot from the origin in <= 700 ms, victim removed, last-move marks, cells in step', d6.ms <= 760 && d6.ms >= 560 && d6.busyDuring === '1' && d6.busyAfter === null && d6.at.join() === '0,7' && d6.victim === 0 && d6.pieces === 31 && d6.trial === 0 && d6.marks === 0 && d6.last.join() === '1,1,me' && d6.cell === 'red-cannon-7' && d6.cellFrom === '' && d6.sel === 0, JSON.stringify(d6));
  ok('D6 sounds and fx: cannon.fire, blast when 0.2, projectile, explosion, shake 3, hitStop 60, place, trial.confirm', ['♪ cannon.fire', '♪ blast {"when":0.2}', 'fx.projectile {"arc":58.752,"ms":170}', 'fx.burst explosion', 'fx.flash #fff 60', 'fx.shake 3', 'fx.hitStop 60', 'fx.haptic blast', '♪ place {"scale":1.1}', '♪ trial.confirm'].every((x) => d6.log.includes(x)), d6.log);

  // D5: the stamp
  const d5 = await ev(async () => {
    await window.T.start();
    const m = window.T.moves(7, 7).find((x) => x.to.row === 7 && x.to.col === 4);
    window.view.setSelection({ row: 7, col: 7 }, window.T.moves(7, 7), []);
    await window.view.showTentative(m);
    const n = window.__log.length, t0 = performance.now();
    await window.view.commitTentative({ flags: window.lab.QUIET });
    const q = (s) => document.querySelectorAll(s).length;
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 200));
    return { ms, at: window.T.pieceAt('red-cannon-7'), stray: q('.piece.is-trial, .piece.is-ghost, .piece__tag, .bv-trialring, .bv-trail, .bv-dot, .bv-selring'), last: q('.bv-lastto[data-by="me"]'), cell: document.querySelector('.board-cell[data-row="7"][data-col="4"]').dataset.piece, log: window.__log.slice(n).join(';') };
  });
  ok('D5 stamp: 180 ms drop, trial.confirm + haptic place, ring burst in --trial, marks cleared, cells in step', Math.abs(d5.ms - 180) < 60 && d5.at.join() === '7,4' && d5.stray === 0 && d5.last === 1 && d5.cell === 'red-cannon-7' && d5.log.includes('♪ trial.confirm') && d5.log.includes('fx.haptic place') && d5.log.includes('fx.burst ring {"color":"#ffb000"}') && (d5.log.match(/trial\.confirm/g) ?? []).length === 1, JSON.stringify(d5));

  // keyboard
  await ev(() => window.T.start());
  await events();
  await cell(page, 9, 4).focus();
  await events();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  const kf = await ev(() => { const a = document.activeElement; return [a.dataset.row, a.dataset.col, document.querySelectorAll('.board-cell[tabindex="0"]').length, a.tabIndex]; });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  const kev = JSON.stringify(await events());
  ok('keyboard: arrows move the focus in view space, roving tabindex follows, Enter / Space pick via key', kf.join() === '8,3,1,0' && kev.includes('["cellfocus",8,4,""]') && kev.includes('["cellfocus",8,3,""]') && (kev.match(/\["pick",8,3,"key"\]/g) ?? []).length === 2, `${kf} ${kev}`);

  // a tap that moved more than 10 px is not a tap
  const b = await cell(page, 6, 4).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 14, b.y + b.height / 2 + 2); await page.mouse.up();
  const moved = JSON.stringify(await events());
  ok('pointerup more than 10 px from pointerdown is not a tap', !moved.includes('"tap"'), moved);

  // drag with the mouse: origin is picked, magnet ring, drop on a target picks it via drag
  await ev(() => { window.addEventListener('board:pick', (e) => { if (e.detail.via === 'drag' && e.detail.row === 7 && e.detail.col === 7) window.view.setSelection({ row: 7, col: 7 }, window.T.moves(7, 7), []); }); });
  const from = await cell(page, 7, 7).boundingBox(), to = await cell(page, 7, 4).boundingBox(), off = await cell(page, 5, 5).boundingBox();
  const mid7 = (r) => [r.x + r.width / 2, r.y + r.height / 2];
  await page.mouse.move(...mid7(from)); await page.mouse.down();
  await page.mouse.move(mid7(from)[0] - 30, mid7(from)[1], { steps: 3 });
  await page.mouse.move(mid7(to)[0] + 12, mid7(to)[1] + 8, { steps: 6 });
  await page.waitForTimeout(60);
  const dragging = await ev(() => ({ cls: document.querySelector('.piece[data-id="red-cannon-7"]').className, tr: document.querySelector('.piece[data-id="red-cannon-7"]').style.translate, magnet: document.querySelectorAll('circle.bv-magnet').length, r: document.querySelector('circle.bv-magnet')?.getAttribute('r') }));
  await page.mouse.up();
  const dragEv = JSON.stringify(await events());
  ok('drag: origin picked via drag, piece follows the pointer, magnet ring r 56 on the near target, drop picks the target via drag', dragEv.includes('["pick",7,7,"drag"]') && dragEv.includes('["pick",7,4,"drag"]') && /is-dragging/.test(dragging.cls) && dragging.tr !== '' && dragging.magnet === 1 && dragging.r === '56', JSON.stringify([dragging, dragEv]));
  await page.waitForTimeout(250);
  await page.mouse.move(...mid7(from)); await page.mouse.down();
  await page.mouse.move(...mid7(off), { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(260);
  const dc = JSON.stringify(await events());
  const home = await ev(() => ({ tr: document.querySelector('.piece[data-id="red-cannon-7"]').style.translate, cls: document.querySelector('.piece[data-id="red-cannon-7"]').className, magnet: document.querySelectorAll('.bv-magnet').length }));
  ok('drag dropped off-target: board:dragcancel, the piece returns', dc.includes('["dragcancel",7,7,""]') && !dc.includes('"drag"') && home.tr === '' && !/is-dragging/.test(home.cls) && home.magnet === 0, JSON.stringify([dc, home]));

  // setInteractive(false)
  await ev(() => window.view.setInteractive(false));
  await events();
  await cell(page, 7, 1).tap({ force: true });
  const offEv = JSON.stringify(await events());
  const dis = await ev(() => document.querySelectorAll('.board-cell[aria-disabled="true"]').length);
  await ev(() => window.view.setInteractive(true));
  ok('setInteractive(false): cells aria-disabled, nothing is reported', !offEv.includes('pick') && dis === 90, `${offEv} ${dis}`);

  // playMove: rival capture, timing of table B x1.15 after the 260 ms anticipation, state at the end
  const pm = await ev(async () => {
    await window.T.mid();
    const bd = window.T.board;
    const m = window.lab.mv(bd, 0, 8, 9, 8);                // black rook takes the red rook down the open file, d = 9
    const n = window.__log.length, t0 = performance.now();
    const p = window.view.playMove(m, { actor: 'rival', flags: window.lab.QUIET });
    const busyDuring = window.T.busy();
    const lifted = document.querySelectorAll('.piece.is-lifted[data-id="black-rook-8"]').length, ring = document.querySelectorAll('circle.bv-anticipate').length;
    await p;
    const q = (s) => document.querySelectorAll(s).length;
    return { ms: performance.now() - t0, busyDuring, lifted, ring, at: window.T.pieceAt('black-rook-8'), victim: q('.piece[data-id="red-rook-8"]'), by: document.querySelector('.bv-lastto')?.dataset.by, anticipate: q('.bv-anticipate'), liftedAfter: q('.is-lifted'),
      log: window.__log.slice(n).join(';') };
  });
  // 260 + (150 + 28 * 9) * 1.15 = 722; the victim's 200 ms run from travel - 40 -> 882 (+60 hit-stop)
  ok('playMove rival: E1 ring + lift, rook charge x1.15, ram on a rook (hitStop 60), ends ~722-1000 ms', pm.ms > 700 && pm.ms < 1050 && pm.busyDuring === '1' && pm.lifted === 1 && pm.ring === 1 && pm.at.join() === '9,8' && pm.victim === 0 && pm.by === 'black' && pm.anticipate === 0 && pm.liftedAfter === 0 && pm.log.includes('fx.shake 2') && pm.log.includes('fx.hitStop 60') && pm.log.includes('♪ capture {"scale":1.25}') && /move\.rook \{"ms":462\.2/.test(pm.log), JSON.stringify(pm));

  // every piece type: duration of table B for actor me, landing fx and sound
  const tb = await ev(async () => {
    const out = {};
    const cases = { rook: [9, 8, 4, 8], horse: [7, 2, 5, 1], cannon: [7, 7, 7, 4], elephant: [9, 2, 7, 4], advisor: [9, 3, 8, 4], king: [9, 4, 8, 4], pawn: [6, 0, 5, 0] };
    for (const [type, s] of Object.entries(cases)) {
      await window.T.mid();
      const m = window.lab.mv(window.T.board, ...s);
      const n = window.__log.length, t0 = performance.now();
      await window.view.playMove(m, { actor: 'me', flags: window.lab.QUIET });
      out[type] = { ms: Math.round(performance.now() - t0), log: window.__log.slice(n).join(';') };
    }
    return out;
  });
  const want = { rook: [150 + 28 * 5, 'fx.burst dust {"n":8', 'fx.shake 1'], horse: [340, 'fx.burst ring {}'], cannon: [170 + 30 * 3, 'fx.burst dust {"n":4}'], elephant: [320, 'fx.burst ring {"size":1.4}', 'fx.shake 1'], advisor: [150, 'fx.trail'], king: [320, 'fx.burst ring {"color":"#ffd166"}'], pawn: [210] };
  for (const [type, [ms, ...marks]] of Object.entries(want)) {
    ok(`table B ${type}: ${ms} ms, move.${type} with ms, landing fx`, Math.abs(tb[type].ms - ms) < 70 && tb[type].log.includes(`♪ move.${type} {"ms":${ms}`) && marks.every((x) => tb[type].log.includes(x)) && tb[type].log.includes('fx.haptic place'), JSON.stringify(tb[type]));
  }

  // cancelAnimations mid-flight: nothing in flight survives, promises resolve, the final position stands
  const ca = await ev(async () => {
    await window.T.mid();
    const bd = window.T.board;
    const m = window.lab.mv(bd, 7, 2, 5, 3);                // red horse takes a pawn
    let resolved = false;
    window.view.playMove(m, { actor: 'me', flags: window.lab.QUIET }).then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 90));
    window.view.cancelAnimations();
    const q = (s) => document.querySelectorAll(s).length;
    const sync = { at: window.T.pieceAt('red-horse-2'), victim: q('.piece[data-id="black-pawn-3"]'), pieces: q('.piece'), last: q('.bv-lastto'), moving: q('.piece.is-moving'), anims: document.querySelector('#board').getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length };
    await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
    return { ...sync, resolved, busy: window.T.busy(), log: window.__log.slice(-1)[0] };
  });
  ok('cancelAnimations: piece seated, victim removed, markers drawn, no WAAPI animation left, promise resolved, fx.clear called', ca.at.join() === '5,3' && ca.victim === 0 && ca.last === 1 && ca.moving === 0 && ca.anims === 0 && ca.resolved && ca.busy === null && ca.log === 'fx.clear', JSON.stringify(ca));

  // setPosition during a trial is a hard sync
  const sp = await ev(async () => {
    await window.T.start();
    window.view.setSelection({ row: 7, col: 1 }, window.T.moves(7, 1), []);
    const m = window.T.moves(7, 1).find((x) => x.to.col === 4);
    let done = false;
    window.view.showTentative(m).then(() => { done = true; });
    window.view.showArrows([{ from: { row: 9, col: 1 }, to: { row: 7, col: 2 }, style: 'hint', demo: true }]);
    window.view.highlight({ pieces: [{ row: 9, col: 4 }], dim: true });
    window.view.setCheck('red', [{ row: 0, col: 4 }]);
    await new Promise((r) => setTimeout(r, 60));
    const before = { arrows: document.querySelectorAll('g.arrow[data-from="91"][data-to="72"][data-style="hint"]').length, check: document.querySelectorAll('circle.bv-checkring, line.bv-threat').length, isCheck: document.querySelectorAll('.board-cell.is-check[data-row="9"][data-col="4"]').length, spot: document.querySelectorAll('.bv-spot').length };
    await window.view.setPosition(window.lab.createInitialBoard(), { lastMove: null });
    await new Promise((r) => setTimeout(r, 0));
    const q = (s) => document.querySelectorAll(s).length;
    return { before, done, pieces: q('.piece'), stray: q('.piece.is-ghost, .piece.is-trial, .piece.is-selected, .piece__tag'), marks: q('.bv-marks circle, .bv-marks path, .bv-over circle, .bv-over path, .bv-over line, .bv-over rect, .bv-over polygon'),
      cls: q('.board-cell.is-selected, .board-cell.is-legal, .board-cell.is-trial-to, .board-cell.is-check'), at: window.T.pieceAt('red-cannon-1'), trialing: document.querySelector('#board').className };
  });
  ok('setPosition: cancels and clears selection / trial / arrows / highlight / check, snaps pieces', sp.before.arrows === 1 && sp.before.check === 2 && sp.before.isCheck === 1 && sp.before.spot === 1 && sp.done && sp.pieces === 32 && sp.stray === 0 && sp.marks === 0 && sp.cls === 0 && sp.at.join() === '7,1' && !/is-trialing/.test(sp.trialing), JSON.stringify(sp));

  // deal
  const dl = await ev(async () => {
    const n = window.__log.length, t0 = performance.now();
    const p = window.view.setPosition(window.lab.createInitialBoard(), { deal: true });
    await new Promise((r) => setTimeout(r, 30));
    const hidden = [...document.querySelectorAll('.piece')].filter((el) => getComputedStyle(el).opacity === '0').length;
    await p;
    return { ms: performance.now() - t0, hidden, log: window.__log.slice(n).join(';'), shown: [...document.querySelectorAll('.piece')].filter((el) => getComputedStyle(el).opacity === '1').length };
  });
  // last delay 14 * (8 + 2 * 3) = 196, + 220 = 416 ms, then the 开战！ banner (1020 ms in the stand-in fx)
  ok('G1 deal: staggered drop (416 ms), deal sound, then banner start; resolves when it ends', dl.ms > 1300 && dl.ms < 1700 && dl.hidden > 20 && dl.shown === 32 && dl.log.includes('♪ deal') && dl.log.includes('fx.banner start'), JSON.stringify(dl));

  // undoMoves: steps newest first, a captured piece comes back, ends on `board`
  const un = await ev(async () => {
    await window.T.mid();
    const b0 = window.T.board;
    const m1 = window.lab.mv(b0, 7, 2, 5, 3);
    await window.view.playMove(m1, { actor: 'me', flags: window.lab.QUIET });
    const b1 = window.lab.applyMove(b0, m1);
    const m2 = window.lab.mv(b1, 5, 4, 6, 4);
    await window.view.playMove(m2, { actor: 'rival', flags: window.lab.QUIET });
    const n = window.__log.length, t0 = performance.now();
    const p = window.view.undoMoves([m2, m1], b0);
    const busyDuring = window.T.busy();
    await p;
    const q = (s) => document.querySelectorAll(s).length;
    return { ms: performance.now() - t0, busyDuring, pieces: q('.piece'), horse: window.T.pieceAt('red-horse-2'), pawn: window.T.pieceAt('black-pawn-3'), redPawn: window.T.pieceAt('red-pawn-4'), blackPawn: window.T.pieceAt('black-pawn-4'), last: q('.bv-lastto'),
      cells: [document.querySelector('.board-cell[data-row="5"][data-col="3"]').dataset.piece, document.querySelector('.board-cell[data-row="6"][data-col="4"]').dataset.piece], log: window.__log.slice(n).join(';') };
  });
  // two steps 120 ms apart, 220 ms each: 340 ms
  ok('undoMoves: two steps in ~340 ms, both captured pieces back, cells in step', Math.abs(un.ms - 340) < 80 && un.busyDuring === '1' && un.pieces === 29 && un.horse.join() === '7,2' && un.pawn.join() === '5,3' && un.redPawn.join() === '6,4' && un.blackPawn.join() === '5,4' && un.last === 0 && un.cells.join() === 'black-pawn-3,red-pawn-4' && un.log.includes('♪ undo') && (un.log.match(/sparks/g) ?? []).length === 2, JSON.stringify(un));

  // check flags: banner tone, sounds, ring, lines; soft check
  const ck = await ev(async () => {
    const run = async (actor, soft) => {
      let bd = window.lab.fenToBoard(window.lab.CHECK).board, m = window.lab.mv(bd, 4, 0, 4, 3);
      if (actor === 'rival') { bd = window.lab.flip(bd); m = window.lab.mv(bd, 5, 8, 5, 5); }
      await window.view.setPosition(bd);
      const flags = window.lab.flagsOf(window.lab.applyMove(bd, m), m);
      const n = window.__log.length;
      await window.view.playMove(m, { actor, flags, soft });
      const q = (s) => document.querySelectorAll(s).length;
      return { flags, ring: q('circle.bv-checkring'), lines: q('line.bv-threat'), cell: document.querySelector('.board-cell.is-check')?.dataset.row, log: window.__log.slice(n).join(';') };
    };
    return { give: await run('me', false), take: await run('rival', false), soft: await run('rival', true) };
  });
  ok('E4 child gives check: banner tone mine avoiding the king, check.give, haptic check, ring + threat line', ck.give.flags.check && ck.give.ring === 1 && ck.give.lines === 1 && ck.give.cell === '0' && ck.give.log.includes('fx.banner check mine avoid') && ck.give.log.includes('♪ check.give') && ck.give.log.includes('fx.haptic check') && !ck.give.log.includes('fx.flash'), JSON.stringify(ck.give));
  ok('E4 child receives check: banner tone danger, check.take, flash, shake 2', ck.take.ring === 1 && ck.take.lines === 1 && ck.take.cell === '9' && ck.take.log.includes('fx.banner check danger avoid') && ck.take.log.includes('♪ check.take') && /fx\.flash #ff6b5e 120/.test(ck.take.log) && ck.take.log.includes('fx.shake 2'), JSON.stringify(ck.take));
  ok('soft check: ring and lines, check.soft, no banner, no shake, no flash', ck.soft.ring === 1 && ck.soft.lines === 1 && ck.soft.log.includes('♪ check.soft') && !ck.soft.log.includes('banner') && !ck.soft.log.includes('fx.shake 2') && !ck.soft.log.includes('flash'), JSON.stringify(ck.soft));
  // the next committed move answers the check: ring and lines go
  const ans = await ev(async () => {
    const bd = window.lab.flip(window.lab.fenToBoard(window.lab.CHECK).board);
    const after = window.lab.applyMove(bd, window.lab.mv(bd, 5, 8, 5, 5));
    const m = window.lab.getLegalMoves(after, 'red')[0];
    await window.view.playMove(m, { actor: 'me', flags: window.lab.QUIET });
    return document.querySelectorAll('.bv-checkring, .bv-threat, .board-cell.is-check').length;
  });
  ok('the check marks go when the next move is committed', ans === 0, ans);

  // mate: the child wins / the child is mated
  const mt = await ev(async () => {
    const run = async (actor) => {
      let bd = window.lab.fenToBoard(window.lab.MATE).board, m = window.lab.mv(bd, 5, 8, 0, 8);
      if (actor === 'rival') { bd = window.lab.flip(bd); m = window.lab.mv(bd, 4, 0, 9, 0); }
      await window.view.setPosition(bd);
      const flags = window.lab.flagsOf(window.lab.applyMove(bd, m), m);
      const n = window.__log.length, t0 = performance.now();
      await window.view.playMove(m, { actor, flags });
      const king = document.querySelector(`.piece[data-type="king"][data-color="${actor === 'me' ? 'black' : 'red'}"]`);
      return { mate: flags.mate, ms: performance.now() - t0, king: king.className, log: window.__log.slice(n).join(';') };
    };
    return { win: await run('me'), lose: await run('rival') };
  });
  ok('E5 child mates: hitStop 120, flash, explosion, banner mate, win sound, king toppled and grey', mt.win.mate && /is-fallen/.test(mt.win.king) && /is-grey/.test(mt.win.king) && ['fx.hitStop 120', 'fx.flash #fff 60', 'fx.burst explosion', 'fx.banner mate', '♪ win', 'fx.haptic win'].every((x) => mt.win.log.includes(x)) && !mt.win.log.includes('banner check'), JSON.stringify(mt.win));
  ok('E5 child is mated: only the king topples — no banner, no flash, no explosion, no win sound', mt.lose.mate && /is-fallen/.test(mt.lose.king) && !/banner|flash|explosion|♪ win|hitStop 120/.test(mt.lose.log), JSON.stringify(mt.lose));

  // river crossing (E9)
  const rv = await ev(async () => {
    const run = async (actor) => {
      let bd = window.lab.createInitialBoard().map((r) => r.slice());
      bd[5][4] = bd[6][4]; bd[6][4] = null; bd[4][4] = null; bd[3][4] = null;
      let m = window.lab.mv(bd, 5, 4, 4, 4);
      if (actor === 'rival') { bd = window.lab.flip(bd); m = window.lab.mv(bd, 4, 4, 5, 4); }
      await window.view.setPosition(bd);
      const n = window.__log.length;
      await window.view.playMove(m, { actor, flags: { ...window.lab.QUIET, crossed: true } });
      return window.__log.slice(n).join(';');
    };
    return { me: await run('me'), rival: await run('rival') };
  });
  ok('E9: splash and river sound for both, the 过河！ banner only for the child\'s pawn', rv.me.includes('fx.burst splash {"n":18}') && rv.me.includes('♪ river') && rv.me.includes('fx.banner river') && rv.rival.includes('fx.burst splash') && rv.rival.includes('♪ river') && !rv.rival.includes('banner'), JSON.stringify(rv));

  // orientation: labels, seals, cells, pieces
  const ori = await ev(async () => {
    await window.T.start();
    window.view.setOrientation('black');
    const bv = document.querySelector('#board');
    const cellTL = bv.querySelector('.board-cell');                       // first cell in view order = top left
    const king = bv.querySelector('.piece[data-id="black-king-4"]');
    const r = { labels: [...bv.querySelectorAll('.bv-label')].map((n) => n.textContent).join('|'), bottom: bv.dataset.bottom, tl: [cellTL.dataset.row, cellTL.dataset.col, cellTL.dataset.piece],
      seals: [...bv.querySelectorAll('.bv-seal')].map((g) => g.textContent + g.querySelector('rect').getAttribute('x')).join(), kingView: [king.style.getPropertyValue('--vx'), king.style.getPropertyValue('--vy'), king.dataset.row, king.dataset.col],
      tab0: [...bv.querySelectorAll('.board-cell[tabindex="0"]')].map((n) => `${n.dataset.row},${n.dataset.col}`).join(), mine: bv.querySelectorAll('.board-cell.is-mine').length, mineIsBlack: bv.querySelector('.board-cell.is-mine').dataset.piece.startsWith('black'),
      center: window.view.squareCenter({ row: 0, col: 0 }), aria: bv.querySelector('.board-cell[data-row="2"][data-col="1"]').getAttribute('aria-label'), ariaEmpty: bv.querySelector('.board-cell[data-row="4"][data-col="0"]').getAttribute('aria-label') };
    window.view.setOrientation('red');
    r.back = [...bv.querySelectorAll('.bv-label')].map((n) => n.textContent).join('|');
    return r;
  });
  ok('setOrientation(black): top 一…九, bottom 9…1, seals swap, cells and pieces re-seated', ori.labels === '一二三四五六七八九|987654321' && ori.bottom === 'black' && ori.tl.join() === '9,8,red-rook-8' && ori.seals === '魏10,蜀870' && ori.kingView.join() === '4,9,0,4' && ori.tab0.split(',').length === 2 && ori.mine === 16 && ori.mineIsBlack
    && Math.abs(ori.center.x - 8.6 * 65.28) < 0.01 && Math.abs(ori.center.y - 9.8 * 65.28) < 0.01 && ori.aria === '黑方炮，2路，第3行' && ori.ariaEmpty === '空位，1路，第5行' && ori.back === '123456789|九八七六五四三二一', JSON.stringify(ori));

  // themes: decoration and seals render, art cross-fades
  const th = await ev(async () => {
    const bv = document.querySelector('#board');
    const out = {};
    for (const t of ['longzhong', 'shachang', 'chibi']) {
      window.view.setTheme(t);
      const during = bv.querySelectorAll('svg.bv-art').length;
      await new Promise((r) => setTimeout(r, 300));
      out[t] = { during, after: bv.querySelectorAll('svg.bv-art').length, theme: bv.dataset.theme, bamboo: bv.querySelectorAll('.bv-bamboo').length, sand: bv.querySelectorAll('.bv-sand').length, rivets: bv.querySelectorAll('.bv-rivets').length,
        pennants: bv.querySelectorAll('.bv-pennant').length, glow: getComputedStyle(bv.querySelector('.bv-glow')).display, river: getComputedStyle(bv.querySelector('.bv-river')).display, riverBg: bv.querySelector('.bv-river i').style.backgroundImage.slice(0, 24),
        gridglow: bv.querySelectorAll('.bv-gridglow').length, seals: bv.querySelectorAll('.bv-seal').length, red: getComputedStyle(bv.querySelector('.piece.red .piece__glyph')).color, black: getComputedStyle(bv.querySelector('.piece.black .piece__glyph')).color,
        line: getComputedStyle(bv.querySelector('.bv-grid')).stroke };
    }
    return out;
  });
  ok('longzhong: bamboo, mist river, no glow; G3 cross-fade of the art', th.longzhong.during === 2 && th.longzhong.after === 1 && th.longzhong.theme === 'longzhong' && th.longzhong.bamboo === 2 && th.longzhong.glow === 'none' && th.longzhong.river === 'block' && th.longzhong.riverBg.startsWith('url("data:image/svg') && th.longzhong.seals === 2 && th.longzhong.line === 'rgb(79, 95, 69)', JSON.stringify(th.longzhong));
  ok('shachang: sand, rivets, two pennants, dry river', th.shachang.sand === 1 && th.shachang.rivets === 1 && th.shachang.pennants === 2 && th.shachang.river === 'none' && th.shachang.bamboo === 0 && th.shachang.seals === 2 && th.shachang.line === 'rgb(74, 46, 16)', JSON.stringify(th.shachang));
  ok('chibi: fire glow, grid glow, drifting river; glyph colours differ per side', th.chibi.glow === 'block' && th.chibi.gridglow === 1 && th.chibi.river === 'block' && th.chibi.pennants === 0 && th.chibi.red !== th.chibi.black && th.chibi.line === 'rgb(224, 181, 106)', JSON.stringify(th.chibi));

  // tension: river rate, glow, vignette
  const tn = await ev(() => {
    const bv = document.querySelector('#board');
    window.view.setTension(1);
    const hi = { rate: bv.querySelector('.bv-river i').getAnimations()[0]?.playbackRate, vig: bv.style.getPropertyValue('--vignette'), tension: bv.style.getPropertyValue('--tension') };
    window.view.setTension(0.5);
    const mid = { rate: bv.querySelector('.bv-river i').getAnimations()[0]?.playbackRate, vig: bv.style.getPropertyValue('--vignette') };
    window.view.setTension(0.1);
    return { hi, mid };
  });
  ok('setTension: river playbackRate 0.6 + 1.4 x, vignette clamp((x - .5) * 1.6, 0, .8)', tn.hi.rate === 2 && tn.hi.vig === '0.8' && tn.hi.tension === '1' && Math.abs(tn.mid.rate - 1.3) < 1e-9 && tn.mid.vig === '0', JSON.stringify(tn));

  // previewLine: ghosts only, real pieces never move, abort by cancel
  const pv = await ev(async () => {
    await window.T.start();
    let bd = window.lab.createInitialBoard();
    const steps = [[7, 7, 7, 4], [0, 7, 2, 6], [9, 7, 7, 6]], moves = [];
    for (const s of steps) { const m = window.lab.mv(bd, ...s); moves.push(m); bd = window.lab.applyMove(bd, m); }
    let done = false;
    const t0 = performance.now();
    window.view.previewLine(moves, { stepMs: 200 }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 560));
    const q = (s) => document.querySelectorAll(s).length;
    const during = { ghosts: q('.piece.is-ghost.is-preview'), real: window.T.pieceAt('red-cannon-7'), counter: document.querySelector('.bv-counter text')?.textContent, busy: window.T.busy(), pieces: q('.piece[data-id]') };
    await new Promise((r) => setTimeout(r, 1300));
    const end = { done, ms: performance.now() - t0, ghosts: q('.piece.is-ghost'), counter: q('.bv-counter'), busy: window.T.busy() };
    let done2 = false;
    window.view.previewLine(moves, { stepMs: 200 }).then(() => { done2 = true; });
    await new Promise((r) => setTimeout(r, 250));
    window.view.cancelAnimations();
    await new Promise((r) => setTimeout(r, 0));
    return { during, end, abort: { done2, ghosts: q('.piece.is-ghost'), counter: q('.bv-counter'), dimmed: q('.is-dimmed') } };
  });
  // n * stepMs + 1150 = 1750
  ok('previewLine: ghost copies play, counter n/3, real pieces stay, ends after n*stepMs + 1150, cancel restores at once', pv.during.ghosts === 3 && pv.during.real.join() === '7,7' && pv.during.counter === '3/3' && pv.during.busy === '1' && pv.during.pieces === 32 && pv.end.done && pv.end.ghosts === 0 && pv.end.counter === 0 && pv.end.busy === null && pv.abort.done2 && pv.abort.ghosts === 0 && pv.abort.counter === 0 && pv.abort.dimmed === 0, JSON.stringify(pv));

  // arrows: groups, replace, ttl, clear
  const ar = await ev(async () => {
    await window.T.start();
    const q = (s) => document.querySelectorAll(s).length;
    const n = window.__log.length;
    window.view.showArrows([{ from: { row: 7, col: 7 }, to: { row: 7, col: 4 }, style: 'hint' }], { group: 'a' });
    window.view.showArrows([{ from: { row: 9, col: 1 }, to: { row: 7, col: 2 }, style: 'idea', badge: '1' }], { group: 'b' });
    window.view.showArrows([{ from: { row: 9, col: 7 }, to: { row: 7, col: 6 }, style: 'threat' }], { group: 'b', replace: false });
    const two = [q('g.arrow'), q('g.arrow[data-style="hint"][data-from="77"][data-to="74"]'), q('.arrow__badge')];
    window.view.showArrows([{ from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, style: 'last' }], { group: 'b' });
    const replaced = q('g.arrow');
    window.view.showArrows([{ from: { row: 6, col: 0 }, to: { row: 5, col: 0 }, style: 'reply' }], { group: 'c', ttl: 150 });
    const withTtl = q('g.arrow');
    await new Promise((r) => setTimeout(r, 400));
    const afterTtl = q('g.arrow');
    window.view.clearArrows('a');
    await new Promise((r) => setTimeout(r, 220));
    const afterClearA = q('g.arrow');
    window.view.clearArrows();
    await new Promise((r) => setTimeout(r, 220));
    return { two, replaced, withTtl, afterTtl, afterClearA, none: q('g.arrow'), sound: window.__log.slice(n).filter((l) => l.includes('♪ arrow')).length };
  });
  ok('showArrows / clearArrows: groups, replace, ttl, hook attributes, arrow sound', ar.two.join() === '3,1,1' && ar.replaced === 2 && ar.withTtl === 3 && ar.afterTtl === 2 && ar.afterClearA === 1 && ar.none === 0 && ar.sound === 5, JSON.stringify(ar));

  // highlight: ttl and "cleared by the next pick"
  const hlr = await ev(async () => {
    const q = (s) => document.querySelectorAll(s).length;
    window.view.highlight({ pieces: [{ row: 9, col: 4 }], squares: [{ row: 5, col: 2 }, { row: 4, col: 4 }], dim: true, ttl: 200 });
    const shown = [q('.bv-spot'), q('.bv-hlring'), q('mask circle'), q('mask rect'), document.querySelector('mask rect:last-child').getAttribute('rx'), document.querySelector('mask circle').getAttribute('r')];
    await new Promise((r) => setTimeout(r, 480));
    const gone = q('.bv-spot') + q('.bv-hlring');
    window.view.highlight({ pieces: [{ row: 9, col: 4 }], dim: true });
    return { shown, gone };
  });
  await cell(page, 5, 5).tap();
  await page.waitForTimeout(280);
  const hlAfterPick = await ev(() => document.querySelectorAll('.bv-spot, .bv-hlring').length);
  ok('highlight: mask with a circle r 56 per piece and a rounded rect rx 24 for the area, ttl, cleared by the next pick', hlr.shown.join() === '1,1,1,2,24,56' && hlr.gone === 0 && hlAfterPick === 0, JSON.stringify([hlr, hlAfterPick]));

  // nudge, setLastMove, setCheck(null)
  const misc = await ev(async () => {
    await window.T.start();
    const n = window.__log.length;
    window.view.nudge({ row: 9, col: 0 });
    const bd = window.lab.createInitialBoard();
    window.view.setLastMove(window.lab.mv(bd, 2, 1, 2, 4), 'rival');
    window.view.setCheck('black', [{ row: 7, col: 4 }]);
    const q = (s) => document.querySelectorAll(s).length;
    const a = { log: window.__log.slice(n).join(';'), last: [q('.board-cell.is-last-from[data-row="2"][data-col="1"]'), q('.board-cell.is-last-to[data-row="2"][data-col="4"]'), document.querySelector('.bv-lastto').dataset.by], check: q('.board-cell.is-check[data-row="0"][data-col="4"]'), ring: document.querySelector('.bv-checkring').getAttribute('r') };
    window.view.setCheck(null); window.view.setLastMove(null);
    return { ...a, cleared: q('.bv-checkring, .bv-threat, .bv-lastto, .bv-lastfrom, .is-check, .is-last-to') };
  });
  ok('nudge (illegal sound + haptic), setLastMove (rival colour), setCheck and clearing', misc.log.includes('♪ illegal') && misc.log.includes('fx.haptic illegal') && misc.last.join() === '1,1,black' && misc.check === 1 && misc.ring === '50' && misc.cleared === 0, JSON.stringify(misc));

  // reduced motion: 120 ms travel, no particles, a static ring for captures
  const rm = await ev(async () => {
    window.view.setReducedMotion(true); document.documentElement.dataset.motion = 'reduced'; window.lab.fx.setReducedMotion(true);
    await window.T.mid();
    const bd = window.T.board, m = window.lab.mv(bd, 7, 2, 5, 3);
    const n = window.__log.length, t0 = performance.now();
    const p = window.view.playMove(m, { actor: 'me', flags: window.lab.QUIET });
    await new Promise((r) => setTimeout(r, 20));
    const ring = document.querySelectorAll('circle.bv-flashring').length;
    await p;
    const ms = performance.now() - t0;
    const log = window.__log.slice(n).join(';');
    window.view.setSelection({ row: 7, col: 7 }, window.lab.getPieceLegalMoves(window.lab.applyMove(bd, m), 7, 7), []);
    const m2 = window.lab.mv(window.lab.applyMove(bd, m), 7, 7, 7, 5);
    const t1 = performance.now();
    await window.view.showTentative(m2);
    const tms = performance.now() - t1;
    const q = (s) => document.querySelectorAll(s).length;
    const still = { ghost: q('.piece.is-ghost'), tag: q('.piece__tag'), ring: q('.bv-trialring'), trail: q('.bv-trail'), anim: getComputedStyle(document.querySelector('.bv-trialring')).animationName, bob: getComputedStyle(document.querySelector('.piece.is-trial .piece__body')).animationName };
    const t2 = performance.now();
    await window.view.commitTentative({ flags: window.lab.QUIET });
    const cms = performance.now() - t2;
    window.view.setReducedMotion(false); document.documentElement.dataset.motion = 'full'; window.lab.fx.setReducedMotion(false);
    return { ms, ring, log, tms, still, cms, at: window.T.pieceAt('red-cannon-7') };
  });
  ok('reduced motion: 120 ms straight travel, victim fades under one static ring, sounds unchanged, trial marks static, no loops', rm.ms < 330 && rm.ring === 1 && rm.log.includes('♪ move.horse {"ms":120}') && rm.log.includes('♪ capture') && !rm.log.includes('fx.burst') && !rm.log.includes('fx.shake') && rm.tms < 220 && rm.still.ghost === 1 && rm.still.tag === 1 && rm.still.ring === 1 && rm.still.trail === 1 && rm.still.anim === 'none' && rm.still.bob === 'none' && rm.cms < 150 && rm.at.join() === '7,5', JSON.stringify(rm));

  // node budget in a busy moment, and destroy
  const fin = await ev(async () => {
    await window.T.mid();
    const bd = window.T.board;
    const moves = window.lab.getPieceLegalMoves(bd, 9, 8);
    window.view.setSelection({ row: 9, col: 8 }, moves, []);
    await window.view.showTentative(moves.find((m) => !m.captured));
    window.view.showArrows([{ from: { row: 7, col: 7 }, to: { row: 7, col: 4 }, style: 'hint', demo: true }]);
    const nodes = document.querySelectorAll('#board *').length - document.querySelectorAll('#board .bv-fx *').length;
    window.view.destroy();
    const bv = document.querySelector('#board');
    const dead = { kids: bv.children.length, cls: bv.className, c: bv.style.getPropertyValue('--c'), busy: window.T.busy() };
    return { nodes, dead };
  });
  ok('DOM inside .bv stays within 400 nodes with a selection, a trial and an arrow', fin.nodes <= 400, fin.nodes);
  ok('destroy: host emptied, class and custom properties removed', fin.dead.kids === 0 && !/\bbv\b/.test(fin.dead.cls) && fin.dead.c === '' && fin.dead.busy === null, JSON.stringify(fin.dead));

  const failed = results.filter((r) => !r.ok);
  console.log(`CHECKS ${results.length - failed.length}/${results.length} passed`);
  for (const r of failed) console.log(`FAIL ${r.name}\n     ${r.detail.slice(0, 1100)}`);
  if (process.env.VERBOSE) for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
};
