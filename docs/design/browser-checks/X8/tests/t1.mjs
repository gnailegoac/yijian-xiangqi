// stage.js: API surface, DOM hooks, events -> StageHandlers, keyboard shortcuts, URL switches, ?test=1 hooks
import { load, suite, calls, clearCalls, tapCell, spyAudio, audioLog } from './lib.mjs';

const PORT = ['start', 'reset', 'phase', 'selected', 'rejected', 'tentative', 'verdict', 'retracted', 'committed', 'rivalMoved', 'undone', 'hint', 'tension', 'rival', 'over',
  'arrows', 'clearArrows', 'highlight', 'preview', 'coachBegin', 'coachSegment', 'coachReset', 'coachEnd', 'coachTool', 'coachLocal', 'caption', 'childSaid', 'chips',
  'input', 'coachMode', 'beacon', 'toast', 'announce', 'dialog', 'notation', 'blocking', 'settle', 'applySettings', 'on'];

export default async ({ page }) => {
  const S = suite();
  const w = (ms) => page.waitForTimeout(ms);
  await spyAudio(page);
  await load(page);

  await S.test('every StagePort member of 3.10 is a function; nothing else is exported on the port', async (t) => {
    const got = await page.evaluate(() => Object.keys(window.__dev.real).map((k) => [k, typeof window.__dev.real[k]]));
    t.eq(got.map((g) => g[0]).sort(), [...PORT].sort(), 'members');
    t.ok(got.every((g) => g[1] === 'function'), 'all functions');
  });

  await S.test('the stage builds every module in its region and writes the DOM hooks of 4.28.9', async (t) => {
    const d = await page.evaluate(() => {
      const app = document.querySelector('#app'), html = document.documentElement;
      return {
        motion: html.dataset.motion, theme: html.dataset.theme,
        app: { phase: app.dataset.phase, ply: app.dataset.ply, layout: app.dataset.layout, kb: app.dataset.kb, sheet: app.dataset.sheet, coach: app.dataset.coach },
        bv: document.querySelector('#board').classList.contains('bv'), cells: document.querySelectorAll('.board-cell').length,
        fx: !!document.querySelector('#board .bv-fx canvas.fx-canvas'), buddy: !!document.querySelector('#buddy svg.buddy[data-mood]'), bubble: !!document.querySelector('#buddy .bubble'),
        rivalInPlate: !!document.querySelector('#topbar .hud-top__rival .rival[data-mood]'), chat: document.querySelector('#chat').classList.contains('chat'),
        ids: ['undo-button', 'hint-button', 'retract-button', 'confirm-button', 'newgame-button', 'mute-button', 'menu-button', 'retry-opponent', 'history-button', 'toast', 'board-announcement'].filter((id) => !document.getElementById(id)),
        appStyle: app.style.getPropertyValue('--c'),
      };
    });
    t.eq(d.motion, 'full', 'html[data-motion]');
    t.eq(d.theme, 'chibi', 'html[data-theme]');
    t.eq(d.app, { phase: 'childTurn', ply: '0', layout: 'landscape', kb: '0', sheet: '0', coach: 'llm' }, '#app hooks');
    t.ok(d.bv && d.cells === 90 && d.fx, 'board view with fx mounted');
    t.ok(d.buddy && d.bubble && d.chat, 'buddy, bubble, chat');
    t.ok(d.rivalInPlate, 'the rival plate was moved into the hud plate slot (host appended before createHud)');
    t.eq(d.ids, [], 'missing ids');
    t.eq(d.appStyle, '65.28px', '--c from computeLayout at 1180x820');
  });

  await S.test('hud buttons become undo / hint / confirm / retract / newGame / retryOpponent', async (t) => {
    await page.evaluate(() => window.__dev.real.phase({ phase: 'childTurn', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 2 }));
    await w(450);
    await page.click('#undo-button');
    await page.click('#hint-button');
    await page.evaluate(() => window.__dev.real.phase({ phase: 'tentative', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 2 }));
    await w(200);
    await page.click('#confirm-button');
    await page.click('#retract-button');
    await page.evaluate(() => window.__dev.real.phase({ phase: 'opponentTurn', canUndo: true, hintLevel: 0, canAsk: false, failed: true, ply: 3 }));
    await w(200);
    await page.click('#retry-opponent');
    await page.evaluate(() => window.__dev.real.phase({ phase: 'over', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 3 }));
    await w(450);
    await page.click('#newgame-button');
    await page.click('#undo-button');                              // labelled 回看 at game over, still undo
    t.eq((await calls(page)).map((c) => c[0]), ['undo', 'hint', 'confirm', 'retract', 'retryOpponent', 'newGame', 'undo'], 'calls');
    const label = await page.evaluate(() => document.querySelector('#undo-button').textContent.trim());
    t.eq(label, '回看', 'undo label at game over');
    await page.evaluate(() => window.__dev.real.phase({ phase: 'childTurn', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 2 }));
    await clearCalls(page);
  });

  await S.test('a real touch on the board becomes tap(row, col, "tap"); Enter on a focused cell becomes tap(.., "key")', async (t) => {
    await tapCell(page, 7, 7);
    await page.focus('.board-cell[data-row="9"][data-col="4"]');
    await page.keyboard.press('Enter');
    const got = await calls(page);
    t.eq(got, [['tap', 7, 7, 'tap'], ['tap', 9, 4, 'key']], 'calls');
    const act = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'activity').length);
    t.ok(act >= 2, `activity is reported for pointer and key input (got ${act})`);
    await page.evaluate(() => document.activeElement.blur());
    await clearCalls(page);
  });

  await S.test('menu: 认输 -> resign; 棋谱 -> 下载棋谱 -> exportRecord; 设置 -> a switch -> setting(key, value); 导出存档 -> exportBackup', async (t) => {
    await page.click('#menu-button'); await w(450);
    await page.click('.hud-menu__item[data-menu="resign"]'); await w(300);
    await page.evaluate(() => window.__dev.real.notation([{ n: 1, red: '炮二平五', black: '马8进7' }], 2));
    await page.click('#menu-button'); await w(450);
    await page.click('.hud-menu__item[data-menu="notation"]'); await w(450);
    await page.click('[data-action="export"]'); await w(100);
    await page.keyboard.press('Escape'); await w(400);
    await page.click('#menu-button'); await w(450);
    await page.click('.hud-menu__item[data-menu="settings"]'); await w(450);
    await page.click('.hud-switch[aria-label="打字音"]');
    await page.click('.hud-theme[data-value="longzhong"]');
    await page.click('[data-action="export-backup"]');
    await page.keyboard.press('Escape'); await w(400);
    const got = await calls(page);
    t.eq(got, [['resign'], ['exportRecord'], ['setting', 'typeTicks', true], ['setting', 'theme', 'longzhong'], ['exportBackup']], 'calls');
    await clearCalls(page);
  });

  await S.test('the mute button toggles settings.sfx and settings.music together; hud:import hands the text to importBackup', async (t) => {
    await page.click('#mute-button');
    await page.evaluate(() => document.querySelector('#app').dispatchEvent(new CustomEvent('hud:import', { bubbles: true, detail: { text: '{"kind":"yijian-backup"}' } })));
    t.eq(await calls(page), [['setting', 'sfx', false], ['setting', 'music', false], ['importBackup', '{"kind":"yijian-backup"}']], 'calls');
    // the director answers with applySettings: the button shows it and the engine is muted
    await page.evaluate(() => window.__dev.real.applySettings({ ...window.__dev.settings, sfx: false, music: false }));
    const pressed = await page.evaluate(() => document.querySelector('#mute-button').getAttribute('aria-pressed'));
    t.eq(pressed, 'true', 'aria-pressed after both are off');
    const log = await audioLog(page);
    t.ok(log.some((c) => c[0] === 'setMuted' && c[1] === true), 'audio.setMuted(true)');
    await clearCalls(page);
    await page.click('#mute-button');
    t.eq(await calls(page), [['setting', 'sfx', true], ['setting', 'music', true]], 'unmute sets both on');
    await page.evaluate(() => window.__dev.real.applySettings({ ...window.__dev.settings }));
    t.eq(await page.evaluate(() => document.querySelector('#mute-button').getAttribute('aria-pressed')), 'false', 'aria-pressed after unmute');
    await clearCalls(page);
  });

  await S.test('chips: an ask chip -> ask({code}); an action chip -> chip(spec); a typed question -> ask({text})', async (t) => {
    await page.evaluate(() => { const d = window.__dev; d.real.chips(d.SETS.held()); d.real.input({ visible: true, enabled: true }); });
    await w(100);
    await page.click('.chip[data-ask="show"]');
    await page.click('.chip[data-action="retract"]');
    await page.click('#chat-toggle'); await w(400);
    await page.fill('#chat-input', '马二进三好不好？');
    await page.keyboard.press('Enter');
    const got = await calls(page);
    t.eq(got[0], ['ask', { code: 'show' }], 'ask chip');
    t.eq([got[1][0], got[1][1].id, got[1][1].action], ['chip', 'seen', 'retract'], 'action chip');
    t.eq(got[2], ['ask', { text: '马二进三好不好？' }], 'typed question');
    t.eq(await page.evaluate(() => document.querySelector('#app').dataset.sheet), '1', 'the ✎ button opened the sheet (#app[data-sheet])');
    await page.keyboard.press('Escape'); await w(350);
    t.eq(await page.evaluate(() => document.querySelector('#app').dataset.sheet), '0', 'Esc with the focus in the sheet closes it');
    await clearCalls(page);
  });

  await S.test('move links: tap -> moveLink(link, true), again -> moveLink(link, false); ▶ 演示 -> playLine(links); chat:stop -> stopCoach', async (t) => {
    await page.evaluate(() => { const d = window.__dev; d.real.coachLocal(d.parse('走【马二进三】，再看【炮二平五】。')); });
    await w(900);
    await page.click('.bubble .move-link[data-move="9776"]');
    await page.click('.bubble .move-link[data-move="9776"]');
    await page.evaluate(() => { const d = window.__dev; d.real.settle(); d.real.coachLocal(d.parse('【炮二平五】【马8进7】', { line: true })); });
    await w(900);
    await page.click('.bubble .move-link--play');
    await page.evaluate(() => document.querySelector('#chat').dispatchEvent(new CustomEvent('chat:stop', { bubbles: true, detail: {} })));
    const got = await calls(page);
    t.eq(got.map((c) => c[0]), ['moveLink', 'moveLink', 'playLine', 'stopCoach'], 'calls');
    t.eq([got[0][1].code, got[0][2], got[1][2]], ['9776', true, false], 'link and active flags');
    t.eq(got[2][1].map((l) => l.code), ['7774', '0726'], 'playLine links');
    await page.evaluate(() => window.__dev.real.settle());
    await clearCalls(page);
  });

  await S.test('keyboard: U, H, Enter (trial only, not on a focused button), Esc (retract, else deselect), /', async (t) => {
    const phase = (p, extra = {}) => page.evaluate(([p, extra]) => window.__dev.real.phase({ phase: p, canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 2, ...extra }), [p, extra]);
    await phase('childTurn');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('u'); await page.keyboard.press('h'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    t.eq(await calls(page), [['undo'], ['hint']], 'childTurn: U and H only');
    await clearCalls(page);
    await phase('childTurn', { canUndo: false, hintLevel: 3 });
    await page.keyboard.press('u'); await page.keyboard.press('h');
    t.eq(await calls(page), [], 'nothing to undo, no pouch left: no calls');
    // selected: Esc deselects by tapping the selected square
    await page.evaluate(() => { const d = window.__dev; d.real.selected({ row: 9, col: 7 }, [], []); });
    await phase('selected');
    await page.keyboard.press('Escape');
    t.eq(await calls(page), [['tap', 9, 7, 'key']], 'Esc in selected');
    await clearCalls(page);
    // tentative: Enter confirms, Esc retracts
    await page.evaluate(() => { const d = window.__dev; const m = d.sampleMove(false); void d.real.tentative(m, { notation: 'x', aim: false }); });
    await phase('tentative');
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await page.keyboard.press('h');
    t.eq(await calls(page), [['confirm'], ['retract']], 'tentative: Enter, Esc; H does nothing');
    await clearCalls(page);
    await page.focus('#retract-button');
    await page.keyboard.press('Enter');
    t.eq(await calls(page), [['retract']], 'Enter on a focused button is that button, not confirm');
    await page.evaluate(() => document.activeElement.blur());
    await clearCalls(page);
    // '/' opens and focuses the input; keys typed there are not shortcuts
    await page.evaluate(() => window.__dev.real.input({ visible: true, enabled: true }));
    await page.keyboard.press('/'); await w(350);
    const focus = await page.evaluate(() => [document.querySelector('#app').dataset.sheet, document.activeElement.id, document.querySelector('#chat-input').value]);
    t.eq(focus, ['1', 'chat-input', ''], '/ opens the sheet, focuses the field and is not typed into it');
    t.eq(await page.evaluate(() => document.querySelector('#buddy svg.buddy').dataset.mood), 'listening', 'typing: he listens');
    await page.keyboard.press('u'); await page.keyboard.press('h');
    t.eq(await calls(page), [], 'U and H typed in the field are text');
    await page.keyboard.press('Escape'); await w(350);
    t.eq(await page.evaluate(() => document.querySelector('#app').dataset.sheet), '0', 'Esc closes the sheet first while the focus is inside it');
    t.eq(await calls(page), [], 'that Esc did not retract');
    // input absent: '/' does nothing
    await page.evaluate(() => window.__dev.real.input({ visible: false, enabled: false }));
    await page.keyboard.press('/'); await w(200);
    t.eq(await page.evaluate(() => document.querySelector('#app').dataset.sheet), '0', '/ without free text');
    // a modal dialog of the hud keeps the shortcuts away
    const answer = page.evaluate(() => window.__dev.real.dialog('resign'));
    await w(400);
    await page.keyboard.press('u'); await page.keyboard.press('Enter');
    t.eq((await calls(page)).filter((c) => c[0] === 'undo' || c[0] === 'confirm'), [], 'no shortcut while a dialog is open');
    await page.keyboard.press('Escape');
    t.eq(await answer, false, "dialog('resign') resolves false on Esc");
    await page.evaluate(() => { window.__dev.real.settle(); window.__dev.real.retracted({ reselect: false, targets: [], forbidden: [] }); });
    await clearCalls(page);
  });

  await S.test("dialog('new-game') resolves {humanColor} or null; toast, announce, blocking, notation, beacon reach the hud", async (t) => {
    const p1 = page.evaluate(() => window.__dev.real.dialog('new-game'));
    await w(500);
    await page.click('dialog[data-dialog="new-game"] [data-choice="black"]');
    await page.click('dialog[data-dialog="new-game"] [data-choice="go"]');
    t.eq(await p1, { humanColor: 'black' }, 'new-game go');
    await w(400);
    const p2 = page.evaluate(() => window.__dev.real.dialog('new-game'));
    await w(500);
    await page.click('dialog[data-dialog="new-game"] [data-choice="keep"]');
    t.eq(await p2, null, 'new-game keep');
    await w(400);
    const p3 = page.evaluate(() => window.__dev.real.dialog('resign'));
    await w(500);
    await page.click('dialog[data-dialog="resign"] [data-choice="go"]');
    t.eq(await p3, true, 'resign go');
    await w(400);
    const d = await page.evaluate(async () => {
      const s = window.__dev.real;
      s.toast('已经回到开局啦，没有可以悔的棋。');
      s.announce('对方走了 马8进7，将军！');
      s.blocking({ kind: 'engine-dead' });
      s.notation([{ n: 1, red: '炮二平五', black: '马8进7' }], 2);
      return { toast: document.querySelector('#toast').textContent, live: document.querySelector('#board-announcement').textContent,
               blocking: !!document.querySelector('dialog[data-dialog="blocking"]'), last: document.querySelector('.hud-last b').textContent };
    });
    t.eq(d, { toast: '已经回到开局啦，没有可以悔的棋。', live: '对方走了 马8进7，将军！', blocking: true, last: '马8进7' }, 'hud state');
    await w(300);
    await page.click('dialog[data-dialog="blocking"] [data-choice="retry"]');
    t.eq((await calls(page)).filter((c) => c[0] === 'retryEngine').length, 1, 'retry on the blocking notice -> retryEngine');
    await page.evaluate(() => window.__dev.real.blocking(null));
    await w(300);
    t.eq(await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="blocking"]')), false, 'blocking(null) removes it');
    await page.evaluate(() => { const s = window.__dev.real; const m = window.__dev.sampleMove(false); void s.tentative(m, { notation: 'x', aim: false }); s.phase({ phase: 'tentative', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 2 }); });
    await w(250);
    const beacon = await page.evaluate(() => { window.__dev.real.beacon(); return document.querySelector('#confirm-button').classList.contains('is-beacon'); });
    t.ok(beacon, 'beacon pulses 确定落子');
    await page.evaluate(() => { window.__dev.real.settle(); window.__dev.real.retracted({ reselect: false, targets: [], forbidden: [] }); });
    await clearCalls(page);
  });

  await S.test('coachMode writes #app[data-coach]; input({visible:false}) removes the ✎ button; chips are replaced', async (t) => {
    const d = await page.evaluate(() => {
      const s = window.__dev.real, app = document.querySelector('#app');
      s.coachMode({ mode: 'local', reason: 'no_proxy' });
      const a = app.dataset.coach;
      s.coachMode({ mode: 'llm', reason: null });
      s.input({ visible: true, enabled: true });
      const toggleOn = !!document.querySelector('#chat-toggle');
      s.input({ visible: false, enabled: false });
      const toggleOff = !!document.querySelector('#chat-toggle');
      s.chips(window.__dev.SETS.over());
      const chips = [...document.querySelectorAll('.chip')].map((c) => c.dataset.ask);
      s.chips([]);
      return { a, b: app.dataset.coach, toggleOn, toggleOff, chips, none: document.querySelectorAll('.chip').length };
    });
    t.eq(d, { a: 'local', b: 'llm', toggleOn: true, toggleOff: false, chips: ['proud', 'improve', 'next'], none: 0 }, 'state');
  });

  // ---- URL switches -------------------------------------------------------------------------------------------------------
  await S.test('?theme= sets html[data-theme] and holds until the setting changes; ?motion=reduced forces reduced; ?mute=1 mutes', async (t) => {
    await load(page, 'theme=shachang&motion=reduced&mute=1');
    const d = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bv: document.querySelector('#board').dataset.theme,
      motion: document.documentElement.dataset.motion, mute: document.querySelector('#mute-button').getAttribute('aria-pressed') }));
    t.eq(d, { theme: 'shachang', bv: 'shachang', motion: 'reduced', mute: 'true' }, 'switches applied');
    const d2 = await page.evaluate(() => {
      const s = window.__dev.real, base = window.__dev.settings;
      s.applySettings({ ...base, motion: 'full', haptics: false });                     // theme setting unchanged: the URL theme stays
      const a = [document.documentElement.dataset.theme, document.documentElement.dataset.motion];
      s.applySettings({ ...base, theme: 'longzhong', motion: 'full' });
      return { a, b: [document.documentElement.dataset.theme, document.querySelector('#board').dataset.theme] };
    });
    t.eq(d2.a, ['shachang', 'reduced'], 'unchanged theme setting keeps ?theme=; ?motion=reduced wins over the setting');
    t.eq(d2.b, ['longzhong', 'longzhong'], 'a changed theme setting applies to html and the board');
    const log = await audioLog(page);
    t.ok(log.some((c) => c[0] === 'setMuted' && c[1] === true), '?mute=1: audio.setMuted(true)');
    t.ok(log.some((c) => c[0] === 'setPalette' && c[1] === 'longzhong'), 'audio palette follows the theme');
    await page.click('#mute-button');
    t.eq(await page.evaluate(() => document.querySelector('#mute-button').getAttribute('aria-pressed')), 'false', 'a tap on the button lifts ?mute=1');
  });

  await S.test('settings.motion: auto follows prefers-reduced-motion; reduced / full are written to html[data-motion]', async (t) => {
    await load(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await w(100);
    const a = await page.evaluate(() => document.documentElement.dataset.motion);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await w(100);
    const b = await page.evaluate(() => document.documentElement.dataset.motion);
    const c = await page.evaluate(() => { const s = window.__dev.real, base = window.__dev.settings; s.applySettings({ ...base, motion: 'reduced' }); const x = document.documentElement.dataset.motion; s.applySettings({ ...base, motion: 'full' }); return [x, document.documentElement.dataset.motion]; });
    t.eq([a, b, c], ['reduced', 'full', ['reduced', 'full']], 'data-motion');
  });

  await S.test('?test=1: window.__ui = { idle(), fxLive() }; without it there is no hook', async (t) => {
    t.eq(await page.evaluate(() => typeof window.__ui), 'undefined', 'no __ui without ?test=1');
    await load(page, 'test=1');
    const d = await page.evaluate(async () => {
      const ui = window.__ui, s = window.__dev.real, dev = window.__dev;
      const keys = Object.keys(ui).sort();
      const live0 = ui.fxLive();
      // a move with a stamp is in flight: idle() must wait for it
      const m = dev.sampleMove(false);
      void s.tentative(m, { notation: 'x', aim: false });
      const t0 = performance.now();
      const b = dev.G.board.map((r) => r.slice()); b[m.to.row][m.to.col] = m.piece; b[m.from.row][m.from.col] = null;
      const view = { ...dev.viewOf(), board: b, lastMove: m, lastBy: 'child' };
      const done = s.committed({ move: m, notation: 'x', flags: { check: false, mate: false, checkedKing: null, checkers: [], crossed: false }, fromTrial: true, cat: 'good',
                                 praise: null, stamp: { text: '屏风马！', size: 'full' }, self: false, softCheck: false, view });
      let resolved = false; done.then(() => { resolved = true; });
      await ui.idle();
      const waited = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 30));
      return { keys, live0, waited, resolved, stamp: !!document.querySelector('.fx-stamp'), idleIsPromise: ui.idle() instanceof Promise };
    });
    t.eq(d.keys, ['fxLive', 'idle'], '__ui members');
    t.eq(d.live0, 0, 'fxLive() is fx.live');
    t.ok(d.waited > 1200, `idle() waited for the stamp cue (${Math.round(d.waited)} ms)`);
    t.ok(d.resolved && !d.stamp && d.idleIsPromise, 'idle() resolves after the cue; no stamp left');
  });

  S.report();
};
