// Behaviour audit of src/ui/hud.js through dev/hud.html (Playwright steps for tools/shot.mjs).
// Expected values come from the contract (SPEC 4.28.7, 4.28.8, 12.3, 12.5, 12.6), not from the implementation.
import { writeFileSync } from 'node:fs';
const results = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info: cond ? '' : String(info) }); };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const tag = process.env.X7_TAG ?? 'audit';
  await page.evaluate(() => {
    window.__ev = [];
    const app = document.querySelector('#app');
    for (const t of ['hud:action', 'hud:setting', 'hud:import']) app.addEventListener(t, (e) => {
      window.__ev.push({ type: t, detail: e.detail, target: e.target.id, bubbles: e.bubbles });
    }, true);
  });
  const events = () => page.evaluate(() => window.__ev.splice(0));
  const sfx = () => page.evaluate(() => __dev.played.splice(0));
  const settle = (ms = 420) => page.waitForTimeout(ms);
  const layout = await page.evaluate(() => document.querySelector('#app').dataset.layout);
  const tap = async (sel) => { await page.locator(sel).first().click(); };

  // ---------- phases: slots, labels, hooks, no layout shift ----------
  const phases = [
    ['boot', { canUndo: false, hintLevel: 0 }], ['childTurn', { canUndo: false, hintLevel: 0 }], ['childTurn', { canUndo: true, hintLevel: 1 }],
    ['selected', { canUndo: true, hintLevel: 2 }], ['childTurn', { canUndo: true, hintLevel: 3 }], ['tentative', { canUndo: true, hintLevel: 1 }],
    ['opponentTurn', { canUndo: true, hintLevel: 0 }], ['failed', { canUndo: true, hintLevel: 0 }], ['over', { canUndo: true, hintLevel: 0 }],
  ];
  const rects = [];
  for (const [phase, extra] of phases) {
    await page.evaluate(([p, e]) => { __dev.notate(12); __dev.set(p, e); }, [phase, extra]);
    await settle(200);
    const s = await page.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 100) / 100); };
      const vis = (sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el.closest('.hud-slot') ?? el).opacity) > 0.99; };
      const hint = document.querySelector('#hint-button');
      return {
        hosts: [r('#topbar'), r('#underbar'), r('#actions'), r('#undo-button'), r('#menu-button'), r('#mute-button')],
        undo: { label: document.querySelector('#undo-button').textContent, disabled: document.querySelector('#undo-button').disabled, vis: vis('#undo-button') },
        hint: { vis: vis('#hint-button'), level: hint.dataset.level, label: hint.textContent, aria: hint.getAttribute('aria-label'), disabled: hint.disabled,
                open: [...hint.querySelectorAll('.hud-pouch')].map((p) => p.dataset.open).join('') },
        vis: { retract: vis('#retract-button'), confirm: vis('#confirm-button'), again: vis('#newgame-button'), retry: vis('#retry-opponent'), status: vis('.hud-status'), last: vis('.hud-last') },
        slots: [...document.querySelectorAll('.hud-slot')].map((el) => `${el.className.match(/hud-slot--(\w+)/)[1]}:${el.hidden ? 'h' : 'v'}${el.inert ? 'i' : 'a'}`).join(' '),
        actionsH: [...document.querySelectorAll('.hud-slot.is-on > button')].filter((b) => b.getClientRects().length).map((b) => Math.round(b.getBoundingClientRect().height)),
        retryText: document.querySelector('#retry-opponent').textContent, status: document.querySelector('.hud-status').textContent,
        slotRetry: document.querySelector('.hud-slot .hud-retry').getClientRects().length > 0,
      };
    });
    rects.push(s.hosts);
    const id = `${phase}/${extra.hintLevel}`;
    eq(`[${id}] undo label`, s.undo.label, phase === 'over' ? '回看' : '悔棋');
    eq(`[${id}] undo disabled`, s.undo.disabled, phase === 'boot' || !extra.canUndo);
    ok(`[${id}] undo visible in every phase`, s.undo.vis);
    const want = { boot: 'hint:hi trial:hi over:hi', tentative: 'hint:hi trial:va over:hi', over: 'hint:hi trial:hi over:va' }[phase] ?? 'hint:va trial:hi over:hi';
    eq(`[${id}] slots hidden + inert except the active one`, s.slots, want);
    if (['childTurn', 'selected'].includes(phase)) {
      eq(`[${id}] pouch label`, s.hint.label, ['锦囊', '再开一个', '最后一个', '锦囊已开完'][extra.hintLevel]);
      eq(`[${id}] pouch aria`, s.hint.aria, ['三个锦囊，还没打开', '第一个锦囊：问一问', '第二个锦囊：看哪里', '第三个锦囊：走哪步'][extra.hintLevel]);
      eq(`[${id}] data-level`, s.hint.level, String(extra.hintLevel));
      eq(`[${id}] disabled only at level 3`, s.hint.disabled, extra.hintLevel === 3);
      eq(`[${id}] opened pouches`, s.hint.open, ['000', '100', '110', '111'][extra.hintLevel]);
    }
    if (phase === 'opponentTurn') { eq('[opponentTurn] hint label', s.hint.label, '对方正在想…'); ok('[opponentTurn] hint disabled', s.hint.disabled); ok('[opponentTurn] no retry', !s.vis.retry && !s.vis.status); }
    if (phase === 'failed') {
      eq('[failed] retry label', s.retryText, '让他再想想'); eq('[failed] status line', s.status, '司马懿走神了——点一下，让他再想想。');
      if (layout === 'compact') { ok('[failed] compact: retry in the action slot', s.slotRetry && !s.vis.retry); }
      else { ok('[failed] #retry-opponent + status under the board', s.vis.retry && s.vis.status); ok('[failed] no second retry button', !s.slotRetry); ok('[failed] pouches disabled', s.hint.disabled); }
    }
    if (phase === 'tentative') { ok('[tentative] retract + confirm', s.vis.retract && s.vis.confirm && !s.hint.vis); }
    if (phase === 'over') { ok('[over] newgame button', s.vis.again); }
    if (phase !== 'boot') ok(`[${id}] action buttons height`, s.actionsH.every((h) => h === 48), s.actionsH);
  }
  eq('no layout shift: hosts and fixed buttons keep their boxes in every phase', [...new Set(rects.map((r) => JSON.stringify(r)))].length, 1);

  await page.evaluate(() => __dev.set('tentative', { canUndo: true })); await settle(200);
  const split = await page.evaluate(() => { const a = document.querySelector('#retract-button').getBoundingClientRect(), b = document.querySelector('#confirm-button').getBoundingClientRect(); return a.width / (a.width + b.width); });
  ok('retract takes 38 % of the pair', Math.abs(split - 0.38) < 0.012, split);

  // ---------- events of the bars ----------
  await events(); await sfx();
  await tap('#confirm-button'); eq('confirm event', (await events()).slice(0, 1), [{ type: 'hud:action', detail: { action: 'confirm' }, target: 'app', bubbles: true }]);
  ok('ui.tap on press', (await sfx()).includes('ui.tap'));
  await page.evaluate(() => __dev.set('tentative', { canUndo: true })); await settle(200); await events();
  await tap('#retract-button'); eq('retract event', (await events())[0]?.detail, { action: 'retract' });
  await page.evaluate(() => { __dev.notate(12); __dev.set('childTurn', { canUndo: true, hintLevel: 0 }); }); await settle(200); await events();
  await tap('#hint-button'); eq('hint event', (await events())[0]?.detail, { action: 'hint' });
  eq('data-level after the harness answered', await page.getAttribute('#hint-button', 'data-level'), '1');
  await tap('#mute-button'); eq('mute event', (await events())[0]?.detail, { action: 'mute' });
  eq('aria-pressed after setMuted(true)', await page.getAttribute('#mute-button', 'aria-pressed'), 'true');
  await tap('#mute-button'); await events();
  if (layout !== 'compact') { await tap('.hud-last'); eq('last-move line -> review', (await events())[0]?.detail, { action: 'review' }); eq('last-move text', await page.textContent('.hud-last'), '上一步：炮9退1'); }
  await page.evaluate(() => __dev.set('failed', { canUndo: true })); await settle(200); await events();
  await tap(layout === 'compact' ? '.hud-slot .hud-retry' : '#retry-opponent'); eq('retry-opponent event', (await events())[0]?.detail, { action: 'retry-opponent' });
  await page.evaluate(() => __dev.set('over', { canUndo: true })); await settle(200); await events();
  await tap('#undo-button'); eq('undo event at game over (label 回看)', (await events())[0]?.detail, { action: 'undo' });

  // ---------- top bar ----------
  await page.evaluate(() => { __dev.hud.setRound(7); __dev.state.mine = 9; __dev.state.lost = 7; __dev.trophies(); });
  eq('round text', await page.textContent('.hud-round'), '第 7 回合');
  const tray = await page.evaluate(() => ({ mine: [...document.querySelectorAll('.hud-tray--mine .hud-disc')].map((d) => d.textContent).join(''), more: document.querySelector('.hud-tray--mine .hud-tray__more')?.textContent,
    lostShown: document.querySelector('.hud-tray--lost').getClientRects().length > 0 }));
  eq('trophies: the newest six, newest on the right', tray.mine, '卒车象士卒马'); eq('trophies: +n', tray.more, '+3');
  eq('lost pieces only in landscape', tray.lostShown, layout === 'landscape');
  await page.evaluate(() => { __dev.state.mine = 0; __dev.state.lost = 0; __dev.trophies(); });
  ok('empty trays are hidden', await page.evaluate(() => document.querySelector('.hud-tray--mine').hidden && document.querySelector('.hud-tray--lost').hidden));

  // ---------- menu, sheets ----------
  await page.evaluate(() => __dev.set('childTurn', { canUndo: true })); await settle(200); await sfx(); await events();
  await tap('#menu-button'); await settle();
  eq('menu items in contract order', await page.evaluate(() => [...document.querySelectorAll('.hud-menu__item')].map((b) => b.textContent)), ['新对局', '棋谱', '设置', '规则速查', '认输', '关于弈间']);
  ok('ui.open with the menu', (await sfx()).includes('ui.open'));
  eq('aria-expanded', await page.getAttribute('#menu-button', 'aria-expanded'), 'true');
  await page.keyboard.press('Escape'); await settle(300);
  ok('Esc closes the menu', await page.evaluate(() => !document.querySelector('.hud-menu')));
  ok('ui.close with the menu', (await sfx()).includes('ui.close'));
  ok('focus back on the menu button', await page.evaluate(() => document.activeElement?.id === 'menu-button'));
  await tap('#menu-button'); await settle(250); await events();
  await tap('.hud-menu__item[data-menu="new-game"]'); await settle(300);
  eq('menu 新对局 -> new-game', (await events())[0]?.detail, { action: 'new-game' });
  await page.keyboard.press('Escape'); await settle(300);
  await tap('#menu-button'); await settle(250); await events();
  await tap('.hud-menu__item[data-menu="resign"]'); await settle(300);
  eq('menu 认输 -> resign', (await events())[0]?.detail, { action: 'resign' });
  await page.keyboard.press('Escape'); await settle(300);
  for (const [kind, title] of [['settings', '设置'], ['notation', '棋谱'], ['rules', '规则速查'], ['about', '关于弈间']]) {
    await sfx();
    await tap('#menu-button'); await settle(250); await tap(`.hud-menu__item[data-menu="${kind}"]`); await settle();
    eq(`[sheet ${kind}] dialog hook + title`, await page.evaluate((k) => document.querySelector(`dialog[data-dialog="${k}"][open] .hud-sheet__title`)?.textContent, kind), title);
    let inside = true;
    for (let i = 0; i < 40; i++) { await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab'); inside &&= await page.evaluate(() => !!document.activeElement?.closest('.hud-sheet')); }
    ok(`[sheet ${kind}] Tab stays inside`, inside);
    await page.keyboard.press('Escape'); await settle(350);
    ok(`[sheet ${kind}] Esc closes`, await page.evaluate((k) => !document.querySelector(`dialog[data-dialog="${k}"]`), kind));
    const heard = await sfx();
    ok(`[sheet ${kind}] ui.open and ui.close`, heard.includes('ui.open') && heard.includes('ui.close'), heard);
  }
  await page.evaluate(() => __dev.sheet('rules')); await settle();
  await page.mouse.click(6, Math.round(page.viewportSize().height * 0.06)); await settle(350);
  ok('a tap outside closes the sheet', await page.evaluate(() => !document.querySelector('dialog[data-dialog="rules"]')));

  // settings controls -> hud:setting
  await page.evaluate(() => { document.querySelector('#dev-coach').value = 'llm'; document.querySelector('#dev-rank').value = ''; __dev.syncStatus(); __dev.sheet('settings'); }); await settle(); await events();
  ok('rank row hidden when rank is empty', await page.evaluate(() => document.querySelector('.hud-rank').hidden));
  eq('coach status llm', await page.textContent('.hud-coach__line'), '军师状态：云端妙算');
  const labels = await page.evaluate(() => [...document.querySelectorAll('.hud-set__label')].map((l) => l.childNodes[0].textContent));
  eq('settings rows', labels, ['棋盘主题', '动态效果', '音效', '音乐', '音量', '打字音', '军师朗读', '震动反馈', '军师模式', '可以打字问军师', '军师多说几句', '我方执子', '存档']);
  const flip = async (label) => { await page.locator(`.hud-switch[aria-label="${label}"]`).click(); return (await events()).filter((e) => e.type === 'hud:setting').map((e) => e.detail); };
  eq('sfx off', await flip('音效'), [{ key: 'sfx', value: false }]);
  eq('music off', await flip('音乐'), [{ key: 'music', value: false }]);
  eq('typeTicks on', await flip('打字音'), [{ key: 'typeTicks', value: true }]);
  eq('readAloud on', await flip('军师朗读'), [{ key: 'readAloud', value: true }]);
  eq('haptics off', await flip('震动反馈'), [{ key: 'haptics', value: false }]);
  eq('freeText off', await flip('可以打字问军师'), [{ key: 'freeText', value: false }]);
  eq('talk more', await flip('军师多说几句'), [{ key: 'talk', value: 'more' }]);
  eq('talk smart again', await flip('军师多说几句'), [{ key: 'talk', value: 'smart' }]);
  const pick = async (text) => { await page.locator('.hud-seg__opt', { hasText: text }).click(); return (await events()).filter((e) => e.type === 'hud:setting').map((e) => e.detail); };
  eq('motion reduced', await pick('精简'), [{ key: 'motion', value: 'reduced' }]);
  eq('motion full', await pick('完整'), [{ key: 'motion', value: 'full' }]);
  eq('coach local', await pick('只用本机'), [{ key: 'coach', value: 'local' }]);
  eq('coach status after the stage answered', await page.evaluate(() => [document.querySelector('.hud-coach__line').textContent, document.querySelector('.hud-coach__why').textContent]), ['军师状态：锦囊妙计（本机）', '已在设置中选择只用本机']);
  eq('coach auto', await pick('自动'), [{ key: 'coach', value: 'auto' }]);
  eq('side black', await pick('黑方后行（魏）'), [{ key: 'side', value: 'black' }]);
  eq('side red', await pick('红方先行（蜀）'), [{ key: 'side', value: 'red' }]);
  await page.locator('.hud-theme[data-value="shachang"]').click();
  eq('theme', (await events()).filter((e) => e.type === 'hud:setting').map((e) => e.detail), [{ key: 'theme', value: 'shachang' }]);
  eq('theme applied by the harness, sheet still open', await page.evaluate(() => [document.documentElement.dataset.theme, !!document.querySelector('dialog[data-dialog="settings"]'), document.querySelector('.hud-theme[data-value="shachang"]').getAttribute('aria-pressed')]), ['shachang', true, 'true']);
  await page.locator('.hud-theme[data-value="chibi"]').click(); await events();
  await page.locator('.hud-range').focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  const vol = (await events()).filter((e) => e.type === 'hud:setting').map((e) => e.detail);
  eq('volume (0..1, step .05)', vol[vol.length - 1], { key: 'volume', value: 0.9 });
  await page.locator('[data-action="export-backup"]').click(); eq('export-backup', (await events())[0]?.detail, { action: 'export-backup' });
  for (const [reason, text] of Object.entries({ no_proxy: '没有找到军师服务（config.json 里没有 apiBase）', no_key: '服务器没有配置密钥（COACH_API_KEY）', origin: '服务器拒绝了这个网址的请求（来源不被允许）',
    unreachable: '军师服务暂时连不上，稍后会自动重试', setting: '已在设置中选择只用本机', paused: '请求太频繁，稍后恢复', version: '网页和服务器版本不一致，请刷新页面' })) {
    await page.evaluate((r) => { document.querySelector('#dev-coach').value = `local:${r}`; document.querySelector('#dev-rank').value = '初露锋芒'; __dev.syncStatus(); }, reason);
    eq(`reason ${reason} (re-drawn while open)`, await page.textContent('.hud-coach__why'), text);
  }
  eq('rank row', await page.evaluate(() => [document.querySelector('.hud-rank').hidden, document.querySelector('.hud-rank__label').textContent, document.querySelector('.hud-rank__name').textContent]), [false, '兵法境界', '初露锋芒']);
  await page.setInputFiles('#overlays input[type="file"]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"yijian-backup","v":1}') });
  await settle(200);
  eq('hud:import carries the file text', (await events()).filter((e) => e.type === 'hud:import').map((e) => e.detail), [{ text: '{"kind":"yijian-backup","v":1}' }]);
  await page.evaluate(() => __dev.hud.closeAll()); await settle(350);
  ok('closeAll closes the sheet', await page.evaluate(() => !document.querySelector('dialog[data-dialog="settings"]')));

  // notation sheet
  await page.evaluate(() => { __dev.notate(5); __dev.sheet('notation'); }); await settle();
  eq('notation rows', await page.evaluate(() => [...document.querySelectorAll('.hud-moves__row')].map((r) => [...r.children].map((c) => c.textContent).join('|'))), ['1.|炮二平五|马8进7', '2.|马二进三|车9平8', '3.|车一平二|']);
  eq('current move marked', await page.evaluate(() => document.querySelector('.hud-moves__move.is-current')?.textContent), '车一平二');
  await page.evaluate(() => __dev.notate(6));
  eq('re-drawn while open', await page.evaluate(() => document.querySelector('.hud-moves__move.is-current')?.textContent), '炮8平9');
  await events(); await page.locator('[data-action="export"]').click(); eq('export', (await events())[0]?.detail, { action: 'export' });
  eq('download label', await page.textContent('[data-action="export"]'), '下载棋谱');
  await page.evaluate(() => __dev.hud.closeAll()); await settle(350);

  await page.evaluate(() => __dev.sheet('rules')); await settle();
  eq('seven rules', await page.evaluate(() => document.querySelectorAll('.hud-rules__item').length), 7);
  await page.evaluate(() => __dev.sheet('about')); await settle();
  ok('about carries the privacy sentence', (await page.textContent('dialog[data-dialog="about"]')).includes('和军师说的话会发给 AI 服务来生成回答，请不要写姓名、电话、学校等个人信息。'));
  await page.evaluate(() => __dev.hud.closeAll()); await settle(350);

  // ---------- dialogs ----------
  const ask = async (make, act) => {
    await page.evaluate((m) => { window.__p = undefined; (m === 'resign' ? __dev.hud.confirm('resign') : __dev.hud.newGameDialog()).then((v) => { window.__p = { v }; }); }, make);
    await settle(300); await act(); await settle(300);
    return page.evaluate(() => window.__p);
  };
  await page.evaluate(() => { __dev.hud.confirm('resign'); }); await settle(300);
  eq('resign texts', await page.evaluate(() => [...document.querySelectorAll('dialog[data-dialog="resign"] :is(h2, p, button)')].map((e) => e.textContent)), ['确定认输？', '这一局就到这里。下一局，我们再来！', '继续对弈', '确认认输']);
  await page.keyboard.press('Escape'); await settle(300);
  eq('resign: go -> true', await ask('resign', () => tap('dialog[data-dialog="resign"] [data-choice="go"]')), { v: true });
  eq('resign: keep -> false', await ask('resign', () => tap('dialog[data-dialog="resign"] [data-choice="keep"]')), { v: false });
  eq('resign: Esc -> false', await ask('resign', () => page.keyboard.press('Escape')), { v: false });
  eq('resign: tap outside -> false', await ask('resign', () => page.mouse.click(5, 5)), { v: false });
  eq('resign: closeAll -> false', await ask('resign', () => page.evaluate(() => __dev.hud.closeAll())), { v: false });
  await events();
  await page.evaluate(() => { __dev.hud.newGameDialog(); }); await settle(300);
  eq('new game texts', await page.evaluate(() => [...document.querySelectorAll('dialog[data-dialog="new-game"] :is(h2, p, .hud-dialog__buttons button)')].map((e) => e.textContent)), ['开始新的对局？', '当前这盘棋会被替换。', '继续这盘', '开始新对局']);
  await page.keyboard.press('Escape'); await settle(300);
  eq('new game: keep -> null', await ask('new-game', () => tap('dialog[data-dialog="new-game"] [data-choice="keep"]')), { v: null });
  eq('new game: go -> the side of the settings', await ask('new-game', () => tap('dialog[data-dialog="new-game"] [data-choice="go"]')), { v: { humanColor: 'red' } });
  eq('no setting event when the side is unchanged', (await events()).filter((e) => e.type === 'hud:setting'), []);
  eq('new game: black', await ask('new-game', async () => { await tap('dialog[data-dialog="new-game"] [data-choice="black"]'); await tap('dialog[data-dialog="new-game"] [data-choice="go"]'); }), { v: { humanColor: 'black' } });
  eq('the chosen side becomes the setting', (await events()).filter((e) => e.type === 'hud:setting').map((e) => e.detail), [{ key: 'side', value: 'black' }]);

  // ---------- start overlay ----------
  const startTexts = async (kind) => {
    await page.evaluate((k) => { window.__s = undefined; __dev.hud.showStart({ first: { hasSave: false, firstVisit: true, canImport: true }, resume: { hasSave: true, firstVisit: false, canImport: false }, again: { hasSave: false, firstVisit: false, canImport: false } }[k]).then((v) => { window.__s = v; }); }, kind);
    await settle(300);
    return page.evaluate(() => ({ mark: document.querySelector('.hud-start__word').textContent, line: document.querySelector('.hud-start__line').textContent,
      buttons: [...document.querySelectorAll('dialog[data-dialog="start"] button[data-choice]')].map((b) => `${b.dataset.choice}:${b.textContent}`), link: document.querySelector('dialog[data-dialog="start"] [data-action="settings"]').textContent,
      size: getComputedStyle(document.querySelector('.hud-start__mark')).fontSize, figure: !!document.querySelector('.hud-start__figure svg.buddy') }));
  };
  let st = await startTexts('first');
  eq('start first visit', [st.mark, st.line, st.buttons, st.link], ['弈间', '小主公，亮在此恭候多时。这一局，由亮辅佐你。', ['new:开战！', 'import:导入存档'], '设置']);
  eq('wordmark size', st.size, layout === 'compact' ? '44px' : '56px');
  ok('诸葛亮 stands on the start overlay', st.figure);
  await page.keyboard.press('Escape'); await settle(200);
  ok('Esc does not dismiss the start overlay', await page.evaluate(() => !!document.querySelector('dialog[data-dialog="start"]') && window.__s === undefined));
  await tap('dialog[data-dialog="start"] [data-action="settings"]'); await settle();
  ok('settings open above the start overlay', await page.evaluate(() => { const s = document.querySelector('dialog[data-dialog="settings"]'); if (!s) return false; const r = s.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + 30); return s.contains(top); }));
  await page.keyboard.press('Escape'); await settle(350);
  await events();
  await page.setInputFiles('#overlays input[type="file"]', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') }); await settle(400);
  eq('start: import resolves and hands over the text', [await page.evaluate(() => window.__s), (await events()).filter((e) => e.type === 'hud:import').map((e) => e.detail)], ['import', [{ text: '{"a":1}' }]]);
  ok('start overlay gone after the choice', await page.evaluate(() => !document.querySelector('dialog[data-dialog="start"]')));
  st = await startTexts('resume');
  eq('start with a save', [st.line, st.buttons], ['小主公回来了！上一局还没下完呢。', ['continue:继续上一局', 'new:新开一局']]);
  await tap('dialog[data-dialog="start"] [data-choice="continue"]'); await settle(350);
  eq('continue', await page.evaluate(() => window.__s), 'continue');
  st = await startTexts('again');
  eq('start returning without a save', [st.line, st.buttons], ['小主公，今日再战一局？', ['new:开战！']]);
  await tap('dialog[data-dialog="start"] [data-choice="new"]'); await settle(350);
  eq('new', await page.evaluate(() => window.__s), 'new');

  // ---------- game-over card ----------
  const card = async (kind) => {
    await page.evaluate((k) => { __dev.set('over', { canUndo: true }); window.__o = __dev.hud.showOver(__dev.overViews[k]); }, kind); await settle(450);
    return page.evaluate(() => { const c = document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]'); const t = (s) => c.querySelector(s)?.textContent ?? null;
      return { title: t('.hud-over__title'), sub: t('.hud-over__sub'), reason: t('.hud-over__reason'), best: t('.hud-over__best'), heading: t('.hud-over__heading'), stats: t('.hud-over__stats'), goal: t('.hud-over__goal'), rank: t('.hud-over__rank'),
        buttons: [...c.querySelectorAll('button')].map((b) => `${b.dataset.choice}:${b.textContent}`).sort(), same: window.__o.takeaway === c.querySelector('.hud-over__takeaway'), empty: window.__o.takeaway.childNodes.length === 0 }; });
  };
  let c = await card('win');
  eq('over win', c, { title: '大获全胜！', sub: '一招绝杀，小主公威武！', reason: null, best: '本局最佳马三进四自己想的', heading: '这一局的收获', stats: '共 34 回合 · 吃子 9 · 妙手 1', goal: '下一盘小目标：吃子之前，先看它有没有保镖。', rank: '兵法境界初露锋芒', buttons: ['again:再来一局', 'review:回看棋局'], same: true, empty: true });
  c = await card('stalemate'); eq('over win by stalemate', [c.title, c.sub, c.best, c.rank], ['大获全胜！', '对方无棋可走，困毙取胜！', '本局最佳马三进四', null]);
  c = await card('loss'); eq('over loss', [c.title, c.sub, c.reason], ['惜败一局', '胜败乃兵家常事。小主公，我们再来！', null]);
  c = await card('draw'); eq('over draw', [c.title, c.sub, c.reason, c.best, c.goal], ['握手言和', '势均力敌，好一场鏖战。', '三次重复局面', null, null]);
  await settle(350);
  eq('one card at a time', await page.evaluate(() => document.querySelectorAll('dialog[data-dialog="over"]').length), 1);
  await events(); await tap('dialog[data-dialog="over"] [data-choice="review"]'); await settle(400);
  eq('回看棋局 closes the card and says review', [await page.evaluate(() => !!document.querySelector('dialog[data-dialog="over"]')), (await events()).map((e) => e.detail)], [false, [{ action: 'review' }]]);
  await card('win'); await events(); await tap('dialog[data-dialog="over"] [data-choice="again"]'); await settle(400);
  eq('再来一局 on the card', (await events())[0]?.detail, { action: 'new-game' });
  await card('loss'); await page.evaluate(() => __dev.set('childTurn', { canUndo: true })); await settle(400);
  ok('the card leaves when the phase is no longer over', await page.evaluate(() => !document.querySelector('dialog[data-dialog="over"]')));
  await card('loss'); await page.evaluate(() => { window.__o.close(); window.__o.close(); }); await settle(400);
  ok('close() is idempotent', await page.evaluate(() => !document.querySelector('dialog[data-dialog="over"]')));

  // ---------- toast, blocking ----------
  await page.evaluate(() => __dev.hud.toast('这个浏览器不让存档，关掉页面后棋局不会保留。', { ms: 500 })); await settle(250);
  eq('toast text', await page.evaluate(() => [document.querySelector('#toast').textContent, document.querySelector('#toast').hidden]), ['这个浏览器不让存档，关掉页面后棋局不会保留。', false]);
  await settle(700); ok('toast leaves after ms', await page.evaluate(() => document.querySelector('#toast').hidden));
  await page.evaluate(() => __dev.hud.blocking({ kind: 'engine-dead' })); await settle(300); await events();
  eq('blocking text', await page.textContent('dialog[data-dialog="blocking"]'), '棋局的算力没能启动。点一下重试，或者换一个新一点的浏览器（Safari、Chrome、Edge）。');
  await page.keyboard.press('Escape'); await settle(200); ok('blocking cannot be dismissed', await page.evaluate(() => !!document.querySelector('dialog[data-dialog="blocking"]')));
  await page.evaluate(() => __dev.hud.closeAll()); ok('closeAll keeps the blocking notice', await page.evaluate(() => !!document.querySelector('dialog[data-dialog="blocking"]')));
  await tap('dialog[data-dialog="blocking"] [data-choice="retry"]'); eq('retry-engine', (await events())[0]?.detail, { action: 'retry-engine' });
  await page.evaluate(() => __dev.hud.blocking(null)); await settle(900); ok('blocking(null) clears it', await page.evaluate(() => !document.querySelector('dialog[data-dialog="blocking"]')));

  // ---------- touch targets and the forbidden word, over every overlay ----------
  const small = [], words = [];
  const scan = async (name) => {
    const r = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#topbar button, #underbar button, #actions button, #overlays button, #overlays input:not([type="file"])')) {
        if (el.closest('.buddy-fig, .rival') || el.getClientRects().length === 0 || el.closest('[inert]')) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 43.99 || b.height < 43.99) bad.push(`${el.id || el.className}:${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      return { bad, text: document.querySelector('#app').textContent + [...document.querySelectorAll('#app [aria-label]')].map((e) => e.getAttribute('aria-label')).join(' '),
               over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    if (r.bad.length) small.push(`${name}: ${r.bad.join(', ')}`);
    if (r.text.includes('离线')) words.push(name);
    if (r.over > 0) small.push(`${name}: horizontal overflow ${r.over}`);
  };
  for (const p of ['childTurn', 'tentative', 'opponentTurn', 'failed', 'over']) { await page.evaluate((x) => __dev.set(x, { canUndo: true }), p); await settle(200); await scan(p); }
  await tap('#menu-button'); await settle(250); await scan('menu'); await page.keyboard.press('Escape'); await settle(250);
  for (const k of ['settings', 'notation', 'rules', 'about']) { await page.evaluate((x) => __dev.sheet(x), k); await settle(); await scan(k); }
  await page.evaluate(() => { __dev.hud.closeAll(); __dev.hud.confirm('resign'); }); await settle(300); await scan('resign');
  await page.evaluate(() => { __dev.hud.closeAll(); __dev.hud.newGameDialog(); }); await settle(300); await scan('new-game');
  await page.evaluate(() => { __dev.hud.closeAll(); __dev.hud.blocking({ kind: 'engine-dead' }); }); await settle(300); await scan('blocking'); await page.evaluate(() => __dev.hud.blocking(null));
  await page.evaluate(() => __dev.over('win', { type: false })); await settle(450); await scan('over'); await page.evaluate(() => __dev.hud.closeAll());
  await page.evaluate(() => { __dev.start('first-import'); }); await settle(400); await scan('start'); await tap('dialog[data-dialog="start"] [data-choice="new"]'); await settle(350);
  eq('every control is at least 44 x 44 and nothing overflows', small, []);
  eq('no 离线 anywhere', words, []);

  const failed = results.filter((r) => !r.pass);
  writeFileSync(`${out}-${tag}.json`, JSON.stringify({ layout, total: results.length, failed }, null, 1));
  console.log(`AUDIT ${tag} layout=${layout} total=${results.length} failed=${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.name}: ${f.info}`);
  if (failed.length) throw new Error(`${failed.length} audit checks failed`);
};
