// Reviewer's adversarial checks of src/ui/hud.js through dev/hud.html (steps for tools/shot.mjs).
// They cover what the engineer's audit does not: stacking vs. keyboard order, rapid phase flips, e2e flow-10 geometry,
// repeated calls, empty input, keyboard activation, timers.
import { writeFileSync } from 'node:fs';
const results = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info: cond ? '' : String(info) }); };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const tag = process.env.X7_TAG ?? 'adv';
  await page.evaluate(() => {
    window.__ev = [];
    const app = document.querySelector('#app');
    for (const t of ['hud:action', 'hud:setting', 'hud:import']) app.addEventListener(t, (e) => { window.__ev.push({ type: t, detail: e.detail }); }, true);
  });
  const events = () => page.evaluate(() => window.__ev.splice(0));
  const sfx = () => page.evaluate(() => __dev.played.splice(0));
  const settle = (ms = 420) => page.waitForTimeout(ms);
  const layout = await page.evaluate(() => document.querySelector('#app').dataset.layout);
  const motion = await page.evaluate(() => document.documentElement.dataset.motion);
  const vp = page.viewportSize();

  // ---- 1. e2e flow 10 geometry -------------------------------------------------------------------------------------
  await page.evaluate(() => { __dev.notate(12); __dev.set('tentative', { canUndo: true }); }); await settle(250);
  const g = await page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    return { undo: r('#undo-button'), board: r('#board'), confirm: r('#confirm-button'), retract: r('#retract-button'), under: r('#underbar'), actions: r('#actions'),
             coach: r('#coach'), sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight };
  });
  const gapUndo = g.undo.y - g.board.b;
  ok('flow 10: #undo-button top - board bottom within 0..16', gapUndo >= 0 && gapUndo <= 16, gapUndo);
  ok('flow 10: #undo-button height >= 44', g.undo.h >= 44, g.undo.h);
  ok('undo is at least 120 x 48 (48 high everywhere, 120 wide outside compact)', g.undo.h >= 48 && (layout === 'compact' || g.undo.w >= 120), `${g.undo.w}x${g.undo.h}`);
  ok('flow 10: no page scroll', g.sw <= g.iw && g.sh <= g.ih, `${g.sw}/${g.iw} ${g.sh}/${g.ih}`);
  if (layout === 'landscape') ok('flow 10: confirm inside the right column bottom band', g.confirm.x >= g.coach.x - 1 && g.confirm.r <= g.coach.r + 1 && g.confirm.y >= g.coach.b - 1, JSON.stringify(g.confirm));
  if (layout === 'compact') ok('flow 10: confirm shares the row of undo', Math.abs((g.confirm.y + g.confirm.h / 2) - (g.undo.y + g.undo.h / 2)) < 2, `${g.confirm.y} vs ${g.undo.y}`);
  if (layout !== 'compact') ok('under-bar is as wide as the board', Math.abs(g.under.w - g.board.w) < 1.5 && Math.abs(g.under.x - g.board.x) < 1.5, `${g.under.x},${g.under.w} vs ${g.board.x},${g.board.w}`);
  ok('undo bottom edge stays inside the under-bar', g.undo.b + 3 <= g.under.b + 0.5, `${g.undo.b} + 3 > ${g.under.b}`);
  ok('action buttons bottom edge stays inside #actions', g.confirm.b + 3 <= g.actions.b + 0.5, `${g.confirm.b} + 3 > ${g.actions.b}`);

  // ---- 2. rapid phase flips: exactly one live slot afterwards --------------------------------------------------------
  await page.evaluate(() => {
    for (const p of ['tentative', 'childTurn', 'tentative', 'over', 'childTurn', 'tentative', 'opponentTurn', 'boot', 'selected']) __dev.set(p, { canUndo: true, hintLevel: 0 });
  });
  await settle(650);
  eq('after nine flips in one task: only the hint slot is live', await page.evaluate(() => [...document.querySelectorAll('.hud-slot')].map((el) =>
    `${el.className.match(/hud-slot--(\w+)/)[1]}:${el.hidden ? 'h' : 'v'}${el.inert ? 'i' : 'a'}:${getComputedStyle(el).opacity}`)), ['hint:va:1', 'trial:hi:0', 'over:hi:0']);
  await page.evaluate(() => { __dev.set('tentative', { canUndo: true }); });
  await page.waitForTimeout(40);
  await page.evaluate(() => { __dev.set('selected', { canUndo: true }); });
  await page.waitForTimeout(40);
  await page.evaluate(() => { __dev.set('tentative', { canUndo: true }); });
  await settle(400);
  eq('flip back within the fade: the trial slot is live, nothing else', await page.evaluate(() => [...document.querySelectorAll('.hud-slot')].map((el) =>
    `${el.hidden ? 'h' : 'v'}${el.inert ? 'i' : 'a'}:${getComputedStyle(el).opacity}`)), ['hi:0', 'va:1', 'hi:0']);
  ok('a hidden slot cannot be hit', await page.evaluate(() => document.querySelector('#hint-button').getClientRects().length === 0 && document.querySelector('#newgame-button').getClientRects().length === 0));

  // ---- 3. keyboard activation: one event, one tap sound ---------------------------------------------------------------
  await events(); await sfx();
  await page.focus('#confirm-button'); await page.keyboard.press('Enter'); await settle(100);
  eq('Enter on #confirm-button: one confirm event', (await events()).filter((e) => e.type === 'hud:action').map((e) => e.detail.action), ['confirm']);
  eq('Enter on a button: ui.tap exactly once', (await sfx()).filter((n) => n === 'ui.tap').length, 1);
  await page.evaluate(() => __dev.set('childTurn', { canUndo: false, hintLevel: 3 })); await settle(250); await events(); await sfx();
  await page.locator('#undo-button').click({ force: true }).catch(() => {});
  await page.locator('#hint-button').click({ force: true }).catch(() => {});
  eq('disabled undo and a level-3 pouch button say nothing', [(await events()).length, (await sfx()).length], [0, 0]);

  // ---- 4. the blocking notice opened BEFORE the start overlay: keyboard goes to what is on top ---------------------------
  await page.evaluate(() => { __dev.hud.closeAll(); __dev.hud.blocking({ kind: 'engine-dead' }); window.__s1 = undefined; __dev.hud.showStart({ hasSave: true, firstVisit: false, canImport: false }).then((v) => { window.__s1 = v; }); });
  await settle(450);
  const topAt = await page.evaluate(() => { const b = document.querySelector('dialog[data-dialog="blocking"]').getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!el?.closest('dialog[data-dialog="blocking"]'); });
  ok('blocking is drawn above the start overlay', topAt);
  let inside = true;
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); inside &&= await page.evaluate(() => !!document.activeElement?.closest('dialog[data-dialog="blocking"]')); }
  ok('Tab stays in the blocking notice although the start overlay was opened later', inside, await page.evaluate(() => document.activeElement?.className));
  await events();
  await page.keyboard.press('Enter'); await settle(100);
  eq('Enter on the focused retry says retry-engine', (await events()).map((e) => e.detail.action), ['retry-engine']);
  await page.evaluate(() => __dev.hud.blocking(null)); await settle(900);
  inside = true;
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); inside &&= await page.evaluate(() => !!document.activeElement?.closest('dialog[data-dialog="start"]')); }
  ok('after blocking(null) Tab is trapped in the start overlay', inside, await page.evaluate(() => document.activeElement?.className));

  // ---- 5. showStart twice: one overlay, both promises resolve -----------------------------------------------------------
  await page.evaluate(() => { window.__s2 = undefined; __dev.hud.showStart({ hasSave: false, firstVisit: true, canImport: true }).then((v) => { window.__s2 = v; }); });
  await settle(450);
  eq('a second showStart replaces the first overlay', await page.evaluate(() => [document.querySelectorAll('.hud-layer:not(.is-closing) > dialog[data-dialog="start"]').length, document.querySelector('.hud-layer:not(.is-closing) .hud-start__line').textContent]),
    [1, '小主公，亮在此恭候多时。这一局，由亮辅佐你。']);
  const go = page.locator('.hud-layer:not(.is-closing) > dialog[data-dialog="start"] [data-choice="new"]');
  await go.dblclick().catch(() => {});
  await settle(450);
  eq('both waiters resolve with the choice; a double tap resolves once', await page.evaluate(() => [window.__s1, window.__s2]), ['new', 'new']);
  ok('no start overlay left, no buddy left in #overlays', await page.evaluate(() => !document.querySelector('dialog[data-dialog="start"]') && !document.querySelector('#overlays svg.buddy')));
  ok('nothing in #overlays is left that could swallow taps', await page.evaluate(() => [...document.querySelectorAll('#overlays > .hud-layer')].length === 0));

  // ---- 6. settings from the start overlay: fresh data, focus returns, Esc leaves the overlay ----------------------------
  await page.evaluate(() => { document.querySelector('#dev-coach').value = 'local:no_key'; document.querySelector('#dev-rank').value = '天下无双'; __dev.syncStatus(); window.__s3 = undefined; __dev.hud.showStart({ hasSave: false, firstVisit: false, canImport: false }).then((v) => { window.__s3 = v; }); });
  await settle(450);
  await page.locator('dialog[data-dialog="start"] [data-action="settings"]').click(); await settle(450);
  eq('the sheet shows the latest status and rank', await page.evaluate(() => [document.querySelector('.hud-coach__why').textContent, document.querySelector('.hud-rank__name').textContent]), ['服务器没有配置密钥（COACH_API_KEY）', '天下无双']);
  await page.keyboard.press('Escape'); await settle(400);
  ok('Esc closed the sheet only', await page.evaluate(() => !document.querySelector('dialog[data-dialog="settings"]') && !!document.querySelector('dialog[data-dialog="start"]') && window.__s3 === undefined));
  ok('focus is back on the 设置 link of the start overlay', await page.evaluate(() => document.activeElement?.dataset.action === 'settings'));
  await page.locator('dialog[data-dialog="start"] [data-choice="new"]').click(); await settle(450);

  // ---- 7. toast: a later toast wins; empty text shows nothing -------------------------------------------------------------
  await page.evaluate(() => { __dev.hud.toast('甲', { ms: 300 }); }); await page.waitForTimeout(250);
  await page.evaluate(() => { __dev.hud.toast('乙', { ms: 900 }); }); await page.waitForTimeout(500);
  eq('a second toast replaces the first and keeps its own time', await page.evaluate(() => [document.querySelector('#toast').textContent, document.querySelector('#toast').hidden]), ['乙', false]);
  await settle(900);
  ok('the toast is hidden and empty afterwards', await page.evaluate(() => document.querySelector('#toast').hidden && document.querySelector('#toast').textContent === ''));
  await page.evaluate(() => { __dev.hud.toast(''); }); await page.waitForTimeout(120);
  ok('toast("") shows no empty bubble', await page.evaluate(() => document.querySelector('#toast').hidden));
  await page.evaluate(() => { __dev.hud.toast('丙', { ms: 2000 }); __dev.hud.toast(''); }); await page.waitForTimeout(350);
  ok('toast("") takes a showing toast away', await page.evaluate(() => document.querySelector('#toast').hidden));

  // ---- 8. trophies: undo shrinks the tray without a pop; extreme input ------------------------------------------------------
  await page.evaluate(() => { __dev.state.mine = 4; __dev.state.lost = 0; __dev.trophies(); __dev.state.mine = 3; __dev.trophies(); });
  ok('a shrinking tray marks nothing as new', await page.evaluate(() => !document.querySelector('.hud-tray .is-new')));
  await page.evaluate(() => { __dev.state.mine = 4; __dev.trophies(); });
  eq('a growing tray pops the newest (rightmost) disc', await page.evaluate(() => [...document.querySelectorAll('.hud-tray--mine .hud-disc')].map((d) => d.classList.contains('is-new'))), [false, false, false, true]);
  await page.evaluate(() => { const many = []; for (let i = 0; i < 16; i++) many.push({ id: `b${i}`, type: 'pawn', color: 'black' }); __dev.hud.setTrophies(many, many.map((p) => ({ ...p, color: 'red' }))); __dev.hud.setRound(300); });
  await settle(100);
  const bar = await page.evaluate(() => { const t = document.querySelector('#topbar').getBoundingClientRect(); const kids = [...document.querySelectorAll('#topbar > *')].map((k) => k.getBoundingClientRect());
    return { over: document.documentElement.scrollWidth - innerWidth, inside: kids.every((k) => k.left >= t.left - 0.5 && k.right <= t.right + 0.5), overlap: kids.some((k, i) => i > 0 && k.left < kids[i - 1].right - 0.5), more: document.querySelector('.hud-tray--mine .hud-tray__more').textContent }; });
  eq('16 trophies and round 300: nothing overflows or overlaps in the top bar', bar, { over: 0, inside: true, overlap: false, more: '+10' });
  // 司马懿's speech tag (rival-view.js) lies right of his plate: it must never cover the round or the trophies
  const visibleTray = () => page.evaluate(() => [...document.querySelectorAll('.hud-tray--mine > *')].filter((e) => e.getClientRects().length).map((e) => e.textContent).join(''));
  const clash = () => page.evaluate(() => { const say = document.querySelector('.rival__say'); if (!say || !say.getClientRects().length) return 'no tag';
    const s = say.getBoundingClientRect(); const info = document.querySelector('.hud-top__info');
    if (getComputedStyle(info).visibility === 'hidden') return 'clear';
    return [...info.querySelectorAll('.hud-round, .hud-tray')].some((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.left < s.right && b.right > s.left; }) ? 'overlap' : 'clear'; });
  for (const n of [4, 5, 6, 9]) {
    await page.evaluate((k) => { const many = []; for (let i = 0; i < k; i++) many.push({ id: `b${i}`, type: i % 2 ? 'pawn' : 'horse', color: 'black' }); __dev.hud.setTrophies(many, many.map((p) => ({ ...p, color: 'red' }))); __dev.hud.setRound(128); __dev.rival.set({ mood: 'thinking' }); }, n);
    await settle(120);
    eq(`${n} trophies: the thinking dots cover nothing`, await clash(), 'clear');
    const want = vp.width < 416 && layout === 'compact' ? { 4: '马卒马卒', 5: '马卒马+2', 6: '卒马卒+3', 9: '马卒马+6' }[n] : { 4: '马卒马卒', 5: '马卒马卒马', 6: '马卒马卒马卒', 9: '卒马卒马卒马+3' }[n];
    eq(`${n} trophies: what the tray shows`, await visibleTray(), want);
  }
  await page.evaluate(() => { __dev.rival.set({ mood: 'smug', line: '这一步，你可看懂了？' }); }); await settle(200);
  eq('his spoken line covers neither the round nor the trophies', await clash(), 'clear');
  await settle(2500);
  await page.evaluate(() => { __dev.rival.set({ mood: 'calm' }); }); await settle(100);
  ok('the round and the trophies are back after his line', await page.evaluate(() => getComputedStyle(document.querySelector('.hud-top__info')).visibility === 'visible'));
  await page.evaluate(() => { __dev.hud.setRound(0); });
  ok('round 0 hides the round label', await page.evaluate(() => document.querySelector('.hud-round').hidden));
  await page.evaluate(() => { __dev.state.mine = 0; __dev.state.lost = 0; __dev.trophies(); __dev.hud.setRound(1); });

  // ---- 9. a dialog above the game-over card; the card under a new card -----------------------------------------------------
  await page.evaluate(() => { __dev.set('over', { canUndo: true }); window.__o1 = __dev.hud.showOver(__dev.overViews.win); window.__r = undefined; __dev.hud.confirm('resign').then((v) => { window.__r = v; }); });
  await settle(500);
  ok('a dialog is above the game-over card', await page.evaluate(() => { const b = document.querySelector('dialog[data-dialog="resign"] [data-choice="go"]').getBoundingClientRect(); return !!document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('dialog[data-dialog="resign"]'); }));
  await page.evaluate(() => { window.__r2 = undefined; __dev.hud.newGameDialog().then((v) => { window.__r2 = v; }); }); await settle(400);
  eq('a second dialog settles the first with false', await page.evaluate(() => [window.__r, document.querySelectorAll('.hud-layer:not(.is-closing) > .hud-dialog').length]), [false, 1]);
  await page.evaluate(() => __dev.hud.closeAll()); await settle(450);
  eq('closeAll: the pending new-game dialog gives null, the card is gone', await page.evaluate(() => [window.__r2, !!document.querySelector('dialog[data-dialog="over"]')]), [null, false]);
  await page.evaluate(() => { window.__o1.takeaway.textContent = '晚到的一句'; window.__o1.close(); }); // streaming into a closed card must not throw
  await page.evaluate(() => { window.__o2 = __dev.hud.showOver(__dev.overViews.draw); window.__o1.close(); }); await settle(450);
  ok('close() of an old card does not close the new one', await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"][data-result="draw"]')));
  await page.evaluate(() => __dev.hud.closeAll()); await settle(400);

  // ---- 10. the menu: arrows, disabled resign, a tap on the scrim ------------------------------------------------------------
  await page.evaluate(() => __dev.set('over', { canUndo: true })); await settle(250);
  await page.locator('#menu-button').click(); await settle(450);
  ok('认输 is disabled at game over', await page.evaluate(() => document.querySelector('.hud-menu__item[data-menu="resign"]').disabled));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  eq('arrow keys walk the items', await page.evaluate(() => document.activeElement?.dataset.menu), 'notation');
  await page.keyboard.press('End');
  eq('End goes to the last item', await page.evaluate(() => document.activeElement?.dataset.menu), 'about');
  await page.keyboard.press('ArrowUp');
  eq('ArrowUp skips the disabled item', await page.evaluate(() => document.activeElement?.dataset.menu), 'rules');
  await events();
  await page.mouse.click(vp.width - 20, vp.height - 20); await settle(300);
  eq('a tap outside closes the menu and reaches nothing behind it', [await page.evaluate(() => !!document.querySelector('.hud-menu')), (await events()).length], [false, 0]);
  await page.evaluate(() => __dev.set('childTurn', { canUndo: true })); await settle(250);

  // ---- 11. the notation sheet: empty, one ply, an out-of-range `current` ------------------------------------------------------
  await page.evaluate(() => { __dev.hud.setNotation([], 0); __dev.sheet('notation'); }); await settle(450);
  eq('empty record: no row, download disabled, no last move', await page.evaluate(() => [document.querySelectorAll('.hud-moves__row').length, document.querySelector('[data-action="export"]').disabled, document.querySelector('.hud-last').hidden]), [0, true, true]);
  await page.evaluate(() => { __dev.hud.setNotation([{ n: 1, red: '炮二平五' }], 99); }); await settle(100);
  eq('an out-of-range current marks nothing and does not throw', await page.evaluate(() => [document.querySelectorAll('.hud-moves__row').length, document.querySelectorAll('.is-current').length, document.querySelector('.hud-last b').textContent]), [1, 0, '炮二平五']);
  await page.evaluate(() => __dev.hud.closeAll()); await settle(400);

  // ---- 13. double taps: the second tap never reaches the control that replaced the first one --------------------------------
  const centre = async (sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, sel);
  const dtap = async (sel, gap = 120) => { const [x, y] = await centre(sel); await page.mouse.click(x, y); await page.waitForTimeout(gap); await page.mouse.click(x, y); await page.waitForTimeout(450); };
  const actionsOf = async () => (await events()).filter((e) => e.type === 'hud:action').map((e) => e.detail.action);
  for (const gap of [60, 150, 300]) {
    await page.evaluate(() => { __dev.notate(12); __dev.set('tentative', { canUndo: true, hintLevel: 0 }); }); await settle(500); await events();
    await dtap('#retract-button', gap);
    eq(`double tap on 换一步 (${gap} ms): retract only, no pouch opened`, [await actionsOf(), await page.getAttribute('#hint-button', 'data-level')], [['retract'], '0']);
    await page.evaluate(() => { __dev.set('over', { canUndo: true }); }); await settle(500); await events();
    await dtap('#newgame-button', gap);
    eq(`double tap on 再来一局 (${gap} ms): one new game, no pouch opened`, [await actionsOf(), await page.getAttribute('#hint-button', 'data-level')], [['new-game'], '0']);
  }
  // the child's confirm ends the game: the director pushes `over` in the same task (here: a listener after the harness's)
  await page.evaluate(() => { __dev.set('tentative', { canUndo: true }); document.addEventListener('hud:action', (e) => { if (e.detail.action === 'confirm') __dev.set('over', { canUndo: true }); }, { once: true }); });
  await settle(500); await events();
  await dtap('#confirm-button', 150);
  eq('double tap on 确定落子 that ends the game: no new game is started', [await actionsOf(), await page.evaluate(() => __dev.state.phase)], [['confirm'], 'over']);
  await settle(100);
  await page.locator('#newgame-button').click(); await settle(100);
  eq('再来一局 answers once the guard is over (a scripted click waits for it)', await actionsOf(), ['new-game']);
  await page.evaluate(() => __dev.set('tentative', { canUndo: true })); await settle(500); await events();
  await page.locator('#retract-button').click();
  await page.locator('#hint-button').click();                     // right after the slot came in: Playwright waits until it can be hit
  eq('a scripted retract + hint in a row both arrive', await actionsOf(), ['retract', 'hint']);
  await page.evaluate(() => __dev.set('childTurn', { canUndo: true, hintLevel: 0 })); await settle(500); await events();
  await dtap('#menu-button');
  ok('double tap on ≡: the menu stays open', await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > .hud-menu')));
  await page.mouse.click(vp.width - 20, vp.height - 20); await settle(350);
  ok('a later tap outside still closes the menu', await page.evaluate(() => !document.querySelector('.hud-menu')));
  await page.locator('#menu-button').click(); await settle(400);
  await dtap('.hud-menu__item[data-menu="rules"]');
  ok('double tap on a menu item: the sheet stays open', await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="rules"]')));
  await page.evaluate(() => __dev.hud.closeAll()); await settle(400);
  await page.locator('#menu-button').click(); await settle(400);
  await page.evaluate(() => { window.__r3 = 'pending'; });
  await page.evaluate(() => { document.addEventListener('hud:action', (e) => { if (e.detail.action === 'resign') { /* the harness opens the dialog itself */ } }, { once: true }); });
  await dtap('.hud-menu__item[data-menu="resign"]');
  ok('double tap on 认输 in the menu: the dialog stays open and unanswered', await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="resign"]')));
  await events();
  await dtap('dialog[data-dialog="resign"] [data-choice="keep"]');
  eq('double tap on 继续对弈: the dialog closes, nothing behind it is hit', [await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="resign"]')), await actionsOf()], [false, []]);
  await page.evaluate(() => { __dev.set('over', { canUndo: true }); __dev.over('win', { type: false }); }); await settle(700); await events();
  await dtap('dialog[data-dialog="over"] [data-choice="again"]');
  eq('double tap on the card\'s 再来一局: one new game, no pouch opened', [await actionsOf(), await page.getAttribute('#hint-button', 'data-level')], [['new-game'], '0']);
  await page.evaluate(() => { __dev.set('boot', {}); window.__s4 = undefined; __dev.hud.showStart({ hasSave: false, firstVisit: true, canImport: false }).then((v) => { window.__s4 = v; }); });
  await settle(500); await events(); await sfx();
  await dtap('dialog[data-dialog="start"] [data-choice="new"]');
  eq('double tap on 开战！: resolves once and the second tap reaches nothing', [await page.evaluate(() => window.__s4), await actionsOf(), await page.evaluate(() => !!document.querySelector('#overlays > .hud-layer'))], ['new', [], false]);

  // ---- 12. reduced motion: nothing lingers ---------------------------------------------------------------------------------
  if (motion === 'reduced') {
    await page.evaluate(() => { __dev.sheet('rules'); __dev.hud.closeAll(); });
    ok('reduced motion: a closed sheet is removed at once', await page.evaluate(() => !document.querySelector('#overlays .hud-layer')));
    await page.evaluate(() => { __dev.set('tentative', { canUndo: true }); });
    eq('reduced motion: slots switch at once', await page.evaluate(() => [...document.querySelectorAll('.hud-slot')].map((el) => (el.hidden ? 'h' : 'v'))), ['h', 'v', 'h']);
    await page.evaluate(() => { __dev.hud.beaconConfirm(); __dev.hud.nudgeHint(); });
    ok('reduced motion: no beacon or nudge class', await page.evaluate(() => !document.querySelector('.is-beacon, .is-nudge')));
  }

  const failed = results.filter((r) => !r.pass);
  writeFileSync(`${out}-${tag}.json`, JSON.stringify({ layout, motion, total: results.length, failed }, null, 1));
  console.log(`ADV ${tag} layout=${layout} motion=${motion} total=${results.length} failed=${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.name}: ${f.info}`);
  if (failed.length) throw new Error(`${failed.length} adversarial checks failed`);
};
