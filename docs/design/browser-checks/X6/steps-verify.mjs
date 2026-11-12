// Behaviour checks of chat-panel.js in a real browser (dev/chat.html). Prints one line per check; throws when any fails.
export default async ({ page }) => {
  await page.waitForSelector('html[data-ready="1"]');
  const results = [];
  const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sleep = (ms) => page.waitForTimeout(ms);
  const motion = await ev(() => document.documentElement.dataset.motion);

  // record events on #app
  await ev(() => {
    window.__events = [];
    for (const type of ['chat:ask', 'chat:chip', 'chat:movelink', 'chat:playline', 'chat:stop', 'chat:sheet']) {
      document.querySelector('#app').addEventListener(type, (e) => window.__events.push({ type, detail: JSON.parse(JSON.stringify(e.detail)), from: e.target.id || e.target.className }), true);
    }
    window.__dev.run.clear();
    window.__take = () => window.__events.splice(0);
  });

  // 1. structure
  const s = await ev(() => {
    const host = document.querySelector('#chat');
    const kids = [...host.children].map((c) => c.id || c.className);
    const log = host.querySelector('.chat__log'), chips = host.querySelector('.chat__chips'), toggle = host.querySelector('#chat-toggle');
    const input = host.querySelector('#chat-input'), send = host.querySelector('#chat-send'), hist = host.querySelector('#history-button');
    return { cls: host.className, sheet: host.dataset.sheet, kids,
      log: [log.getAttribute('role'), log.getAttribute('aria-live'), log.getAttribute('aria-relevant')],
      chips: [chips.getAttribute('role'), chips.getAttribute('aria-label')],
      toggle: [toggle.getAttribute('aria-label'), toggle.textContent, toggle.parentElement.className, toggle.nextElementSibling.id],
      hist: hist.textContent,
      input: [input.tagName, input.getAttribute('rows'), input.getAttribute('maxlength'), input.getAttribute('enterkeyhint'), input.placeholder, input.parentElement.className, input.parentElement.tagName],
      send: [send.getAttribute('type'), send.getAttribute('aria-label'), send.textContent, send.previousElementSibling.id] };
  });
  check('host becomes .chat[data-sheet="0"]', s.cls.split(' ').includes('chat') && s.sheet === '0', s.cls);
  check('children: head, log, chips, tools, form (+ note)', JSON.stringify(s.kids) === JSON.stringify(['chat__head', 'chat__log', 'chat__chips', 'chat__tools', 'chat__input', 'chat__note']), JSON.stringify(s.kids));
  check('log attributes', JSON.stringify(s.log) === JSON.stringify(['log', 'polite', 'additions']));
  check('chips group label', JSON.stringify(s.chips) === JSON.stringify(['group', '快捷提问']));
  check('#chat-toggle ✎ before #history-button 回看 in .chat__tools', JSON.stringify(s.toggle) === JSON.stringify(['打字问军师', '✎', 'chat__tools', 'history-button']) && s.hist === '回看', JSON.stringify(s.toggle) + s.hist);
  check('textarea attributes', JSON.stringify(s.input) === JSON.stringify(['TEXTAREA', '1', '120', 'send', '问问军师……（别写个人信息）', 'chat__input', 'FORM']), JSON.stringify(s.input));
  check('#chat-send: submit, 发送, empty', JSON.stringify(s.send) === JSON.stringify(['submit', '发送', '', 'chat-input']), JSON.stringify(s.send));

  // 2. begin / segment / end
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v1', kind: 'try', cue: '妙哉！' }); });
  let m = await ev(() => { const el = document.querySelector('.msg[data-id="v1"]'); const b = document.querySelector('.bubble'); const send = document.querySelector('#chat-send');
    return { role: el.dataset.role, kind: el.dataset.kind, state: el.dataset.state, busy: el.getAttribute('aria-busy'), cue: el.querySelector('.msg__cue')?.textContent, tone: el.querySelector('.msg__cue')?.dataset.tone,
      bstate: b.dataset.state, btag: b.querySelector('.bubble__tag')?.textContent, send: [send.dataset.mode, send.textContent, send.getAttribute('aria-label'), send.disabled] }; });
  check('begin: .msg buddy / kind / streaming / aria-busy', m.role === 'buddy' && m.kind === 'try' && m.state === 'streaming' && m.busy === 'true', JSON.stringify(m));
  check('begin: cue in the log (tone good) and in the bubble', m.cue === '妙哉！' && m.tone === 'good' && m.btag === '妙哉！' && m.bstate === 'streaming', JSON.stringify(m));
  check('while a line is coming in the send button is ■ 停止', JSON.stringify(m.send) === JSON.stringify(['stop', '■', '停止', false]), JSON.stringify(m.send));
  await ev(() => { const d = window.__dev; for (const seg of d.LINES.try) d.chat.segment('v1', seg); d.chat.end('v1', { reason: 'done', source: 'llm' }); });
  m = await ev(() => { const el = document.querySelector('.msg[data-id="v1"]'); return { state: el.dataset.state, source: el.dataset.source, text: el.querySelector('.msg__text').textContent.length }; });
  if (motion === 'full') check('a finished line keeps typing: still streaming right after end(), source already set', m.state === 'streaming' && m.source === 'llm' && m.text < 30, JSON.stringify(m));
  await sleep(1500);
  m = await ev(() => { const el = document.querySelector('.msg[data-id="v1"]'); const b = document.querySelector('.bubble'); const link = b.querySelector('.move-link'); const send = document.querySelector('#chat-send');
    return { state: el.dataset.state, source: el.dataset.source, busy: el.getAttribute('aria-busy'), text: el.querySelector('.msg__text').textContent, btext: b.querySelector('.bubble__text').textContent,
      bstate: b.dataset.state, bsource: b.dataset.source, link: link && [link.tagName, link.className, link.dataset.move, link.dataset.color, link.textContent], caret: b.querySelector('.bubble__text').classList.contains('is-streaming'),
      send: [send.dataset.mode, send.textContent, send.getAttribute('aria-label')], nodes: [...b.querySelector('.bubble__text').childNodes].map((n) => n.nodeType === 3 ? '#text' : n.tagName + '.' + n.className) }; });
  const full = '对方会走马7进5把炮吃掉，咱们只换到一个卒，亏了。吃子前先看它有没有保镖。';
  check('end(done): state done, source llm, aria-busy gone', m.state === 'done' && m.source === 'llm' && m.busy === null, JSON.stringify([m.state, m.source, m.busy]));
  check('the whole line is in the log and in the bubble', m.text === full && m.btext === full, m.text + ' | ' + m.btext);
  check('.bubble[data-state="done"][data-source="llm"]', m.bstate === 'done' && m.bsource === 'llm', JSON.stringify([m.bstate, m.bsource]));
  check('move link: button.move-link[data-move][data-color]', JSON.stringify(m.link) === JSON.stringify(['BUTTON', 'move-link', '2634', 'black', '马7进5']), JSON.stringify(m.link));
  check('bubble text holds Text and button.move-link only; caret gone', JSON.stringify(m.nodes) === JSON.stringify(['#text', 'BUTTON.move-link', '#text']) && m.caret === false, JSON.stringify(m.nodes));
  check('send button is back to 发送', JSON.stringify(m.send) === JSON.stringify(['send', '', '发送']));

  // 3. links: events bubble from the bubble and from the log
  await ev(() => window.__take());
  await page.tap('.bubble .move-link');
  let e = await ev(() => window.__take());
  check('tap on a bubble link: chat:movelink {link, active:true} reaches #app', e.length === 1 && e[0].type === 'chat:movelink' && e[0].detail.active === true && e[0].detail.link.code === '2634', JSON.stringify(e));
  check('the link is .is-active', await ev(() => document.querySelector('.bubble .move-link').classList.contains('is-active')));
  await page.tap('.bubble .move-link');
  e = await ev(() => window.__take());
  check('second tap: active:false', e.length === 1 && e[0].detail.active === false, JSON.stringify(e));
  check('a tap on a link is not a tap on the bubble (no sheet)', await ev(() => document.querySelector('#chat').dataset.sheet === '0'));

  // 4. abort drops the backlog
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v2', kind: 'try' }); for (const seg of d.LINES.try) d.chat.segment('v2', seg); });
  await sleep(motion === 'full' ? 120 : 0);
  await ev(() => window.__dev.chat.end('v2', { reason: 'aborted', source: 'none', stale: '已换一步' }));
  const a1 = await ev(() => { const el = document.querySelector('.msg[data-id="v2"]'); return { len: el.querySelector('.msg__text').textContent.length, blen: document.querySelector('.bubble__text').textContent.length, state: el.dataset.state, tag: el.querySelector('.msg__tag')?.textContent, bstate: document.querySelector('.bubble').dataset.state }; });
  await sleep(1200);
  const a2 = await ev(() => { const el = document.querySelector('.msg[data-id="v2"]'); return { len: el.querySelector('.msg__text').textContent.length, blen: document.querySelector('.bubble__text').textContent.length, cancels: window.__dev.state.speechCancels }; });
  if (motion === 'full') check('abort: the backlog is dropped (text is partial)', a1.len > 0 && a1.len < full.length && a1.blen < full.length, JSON.stringify(a1));
  check('abort: nothing grows afterwards', a1.len === a2.len && a1.blen === a2.blen, JSON.stringify([a1, a2]));
  check('abort with a stale label: state stale + tag, bubble stale', a1.state === 'stale' && a1.tag === '已换一步' && a1.bstate === 'stale', JSON.stringify(a1));
  check('abort cancels read-aloud', a2.cancels >= 1);

  // 5. empty abort leaves no trace
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v3', kind: 'try' }); d.chat.end('v3', { reason: 'aborted', source: 'none', stale: '已换一步' }); });
  m = await ev(() => ({ gone: !document.querySelector('.msg[data-id="v3"]'), empty: document.querySelector('.bubble').dataset.empty, state: document.querySelector('.bubble').dataset.state ?? null }));
  check('a line aborted before any text is removed from the log and from the bubble', m.gone && m.empty === '1', JSON.stringify(m));

  // 6. reset then local text
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v4', kind: 'ask' }); d.chat.segment('v4', d.T('这个问题')); });
  await sleep(300);
  await ev(() => { const d = window.__dev; d.chat.reset('v4'); });
  m = await ev(() => ({ t: document.querySelector('.msg[data-id="v4"] .msg__text').textContent, b: document.querySelector('.bubble__text').textContent, state: document.querySelector('.msg[data-id="v4"]').dataset.state }));
  check('reset removes what was shown; the line stays open', m.t === '' && m.b === '' && m.state === 'streaming', JSON.stringify(m));
  await ev(() => { const d = window.__dev; for (const seg of d.LINES.refused) d.chat.segment('v4', seg); d.chat.end('v4', { reason: 'done', source: 'local' }); });
  await sleep(1500);
  m = await ev(() => ({ t: document.querySelector('.msg[data-id="v4"] .msg__text').textContent, src: document.querySelector('.msg[data-id="v4"]').dataset.source, bsrc: document.querySelector('.bubble').dataset.source }));
  check('after reset the local line replaces it (source local)', m.t === '这件事亮帮不上忙。要是心里有事，记得找爸爸妈妈或老师说说。咱们接着看棋？' && m.src === 'local' && m.bsrc === 'local', JSON.stringify(m));

  // 7. cut keeps whole sentences
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v5', kind: 'opp' }); d.chat.segment('v5', d.T('对方的车正盯着咱们的马。先把马挪开，或者给它找个保')); d.chat.segment('v5', d.T('镖，不然下一步就要')); });
  await sleep(200);
  await ev(() => window.__dev.chat.end('v5', { reason: 'cut', source: 'mixed' }));
  m = await ev(() => ({ t: document.querySelector('.msg[data-id="v5"] .msg__text').textContent, b: document.querySelector('.bubble__text').textContent, st: document.querySelector('.msg[data-id="v5"]').dataset.state, src: document.querySelector('.msg[data-id="v5"]').dataset.source }));
  check('cut: whole sentences stay, the tail is dropped, source mixed', m.t === '对方的车正盯着咱们的马。' && m.b === m.t && m.st === 'done' && m.src === 'mixed', JSON.stringify(m));

  // 8. tool indicator
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v6', kind: 'ask' }); d.chat.tool('v6', { phase: 'start', notation: '炮二平五' }); });
  m = await ev(() => ({ b: document.querySelector('.bubble__text .chat-tool')?.textContent, l: document.querySelector('.msg[data-id="v6"] .chat-tool')?.textContent, empty: document.querySelector('.bubble').dataset.empty,
    vis: (() => { const r = document.querySelector('.bubble__text .chat-tool')?.getBoundingClientRect(); return r ? r.width > 0 && r.height > 0 : false; })() }));
  check('tool start: 亮在沙盘上摆一摆【炮二平五】…… in the bubble and in the log', m.b === '亮在沙盘上摆一摆【炮二平五】……' && m.l === m.b && m.vis && m.empty !== '1', JSON.stringify(m));
  await ev(() => { const d = window.__dev; d.chat.tool('v6', { phase: 'end' }); });
  m = await ev(() => ({ n: document.querySelectorAll('.chat-tool').length }));
  check('tool end: the indicator is gone', m.n === 0);
  await ev(() => { const d = window.__dev; for (const seg of d.LINES.tool) d.chat.segment('v6', seg); d.chat.end('v6', { reason: 'done', source: 'llm' }); });
  await sleep(1200);

  // 9. local(), caption(), addChild(), addEvent()
  const lid = await ev(() => window.__dev.chat.local(window.__dev.LINES.local));
  await sleep(1200);
  m = await ev((id) => { const el = document.querySelector(`.msg[data-id="${id}"]`); return el && { kind: el.dataset.kind, state: el.dataset.state, source: el.dataset.source, t: el.querySelector('.msg__text').textContent, b: document.querySelector('.bubble__text').textContent, bsrc: document.querySelector('.bubble').dataset.source }; }, lid);
  check('local(): returns the id of a line with kind system, source local', typeof lid === 'string' && lid.length > 0 && m && m.kind === 'system' && m.state === 'done' && m.source === 'local' && m.t === '好，退回小主公上一步之前。再想想！' && m.b === m.t && m.bsrc === 'local', JSON.stringify([lid, m]));
  await ev(() => { const d = window.__dev; d.chat.addEvent('第 7 回合 · 对方 马8进7'); d.chat.caption(d.LINES.caption); });
  m = await ev(() => { const b = document.querySelector('.bubble'); const cap = b.querySelector('.bubble__caption'); const last = document.querySelector('.chat__log').lastElementChild; const evt = last.previousElementSibling;
    return { cap: cap.textContent, link: cap.querySelector('.move-link')?.dataset.move, text: b.querySelector('.bubble__text').textContent, lastKind: last.dataset.kind, lastText: last.textContent, evt: [evt.tagName, evt.className, evt.textContent] }; });
  check('caption(): the bubble shows the quiet caption with its link and no line', m.cap === '马8进7出子' && m.link === '0726' && m.text === '', JSON.stringify(m));
  check('addEvent(): p.chat__event in the log; the caption is logged after it', JSON.stringify(m.evt) === JSON.stringify(['P', 'chat__event', '第 7 回合 · 对方 马8进7']) && m.lastKind === 'caption' && m.lastText === '马8进7出子', JSON.stringify(m));
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v7', kind: 'opp' }); d.chat.segment('v7', d.T('对方跳马护住了中卒。')); d.chat.end('v7', { reason: 'done', source: 'llm' }); });
  await sleep(900);
  m = await ev(() => ({ cap: document.querySelector('.bubble__caption').textContent, t: document.querySelector('.bubble__text').textContent }));
  check('a spoken opp line keeps the caption above it', m.cap === '马8进7出子' && m.t === '对方跳马护住了中卒。', JSON.stringify(m));
  await ev(() => { const d = window.__dev; d.chat.addChild('对方会怎么应？'); d.chat.begin({ id: 'v8', kind: 'ask' }); d.chat.segment('v8', d.T('它会吃炮。')); d.chat.end('v8', { reason: 'done', source: 'llm' }); });
  await sleep(700);
  m = await ev(() => { const me = [...document.querySelectorAll('.msg[data-role="me"]')].pop(); return { me: me.querySelector('.msg__text').textContent, q: document.querySelector('.bubble__question').textContent, qh: document.querySelector('.bubble__question').hidden, cap: document.querySelector('.bubble__caption').textContent, t: document.querySelector('.bubble__text').textContent }; });
  check('addChild(): .msg[data-role="me"]; the question stays above its answer; the caption is gone', m.me === '对方会怎么应？' && m.q === '对方会怎么应？' && m.qh === false && m.cap === '' && m.t === '它会吃炮。', JSON.stringify(m));

  // 10. a new line closes a line whose reply was dropped without end(); endAll
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v9', kind: 'try' }); d.chat.segment('v9', d.T('这一步')); });
  await sleep(250);
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v10', kind: 'ask' }); });
  m = await ev(() => ({ st: document.querySelector('.msg[data-id="v9"]').dataset.state, busy: document.querySelector('.msg[data-id="v9"]').getAttribute('aria-busy') }));
  check('begin() of the next line closes the one still open', m.st === 'done' && m.busy === null, JSON.stringify(m));
  await ev(() => { const d = window.__dev; d.chat.segment('v10', d.T('小主公')); });
  await sleep(200);
  await ev(() => window.__dev.chat.endAll('aborted'));
  m = await ev(() => ({ st: document.querySelector('.msg[data-id="v10"]').dataset.state, send: document.querySelector('#chat-send').dataset.mode }));
  check('endAll("aborted") ends the open line', m.st === 'done' && m.send === 'send', JSON.stringify(m));

  // 11. chips
  await ev(() => { const app = document.querySelector('#app'); window.__block = (ev2) => ev2.stopImmediatePropagation(); for (const t of ['chat:chip', 'chat:ask']) app.addEventListener(t, window.__block, true); });
  await ev(() => { const d = window.__dev; d.chat.setChips(d.CHIPS.held); window.__take(); });
  m = await ev(() => [...document.querySelectorAll('.chat__chips .chip')].map((c) => [c.tagName, c.dataset.ask ?? null, c.dataset.action ?? null, c.textContent, c.offsetHeight]));
  const chipH = await ev(() => window.__dev.layout.layout === 'compact' ? 36 : 48);
  check('setChips: button.chip[data-ask] / [data-action] with labels', JSON.stringify(m.map((c) => c.slice(0, 4))) === JSON.stringify([['BUTTON', null, 'retract', '我看出来了'], ['BUTTON', 'show', null, '指给我看'], ['BUTTON', null, 'confirm', '就走这步']]), JSON.stringify(m));
  check(`chips are ${chipH} px high`, m.every((c) => c[4] === chipH), JSON.stringify(m.map((c) => c[4])));
  await page.tap('.chip[data-ask="show"]');
  e = await ev(() => window.__take());
  m = await ev(() => { const c = document.querySelector('.chip[data-ask="show"]'); return [c.classList.contains('is-used'), c.disabled]; });
  check('an ask chip: chat:ask {code}', e.length === 1 && e[0].type === 'chat:ask' && e[0].detail.code === 'show' && !('text' in e[0].detail), JSON.stringify(e));
  check('a used chip is .is-used and disabled', m[0] === true && m[1] === true, JSON.stringify(m));
  await page.tap('.chip[data-ask="show"]', { force: true }).catch(() => {});
  check('a used chip does not fire again', (await ev(() => window.__take().length)) === 0);
  await page.tap('.chip[data-action="confirm"]');
  e = await ev(() => window.__take());
  check('an action chip: chat:chip {chip}', e.length === 1 && e[0].type === 'chat:chip' && e[0].detail.chip.action === 'confirm' && e[0].detail.chip.id === 'go' && e[0].detail.chip.label === '就走这步', JSON.stringify(e));
  await ev(() => { const d = window.__dev; d.chat.setChips(d.CHIPS.held); });
  check('the next setChips brings fresh chips', await ev(() => [...document.querySelectorAll('.chip')].every((c) => !c.disabled && !c.classList.contains('is-used'))));
  await ev(() => { const app = document.querySelector('#app'); for (const t of ['chat:chip']) app.removeEventListener(t, window.__block, true); });

  // 12. sheet: 回看 opens, ▾ closes, back button closes
  const compact = await ev(() => window.__dev.layout.layout === 'compact');
  await ev(() => window.__take());
  if (compact) await ev(() => window.__dev.chat.setSheet(true)); else await page.tap('#history-button');
  await sleep(350);
  m = await ev(() => ({ host: document.querySelector('#chat').dataset.sheet, app: document.querySelector('#app').dataset.sheet, logVisible: document.querySelector('.chat__log').getBoundingClientRect().height > 40, ev: window.__take() }));
  check('回看 opens the sheet: data-sheet="1", chat:sheet {open:true}, the log shows', m.host === '1' && m.app === '1' && m.logVisible && m.ev.length === 1 && m.ev[0].type === 'chat:sheet' && m.ev[0].detail.open === true, JSON.stringify(m));
  m = await ev(() => { const log = document.querySelector('.chat__log'); return Math.round(log.scrollHeight - log.scrollTop - log.clientHeight); });
  check('the log opens at its bottom', m <= 1, String(m));
  await page.tap('.chat__head');
  await sleep(150);
  m = await ev(() => ({ host: document.querySelector('#chat').dataset.sheet, ev: window.__take() }));
  check('▾ closes it: chat:sheet {open:false}', m.host === '0' && m.ev.length === 1 && m.ev[0].detail.open === false, JSON.stringify(m));
  await ev(() => window.__dev.chat.setSheet(true));
  await sleep(100);
  await page.goBack();
  await sleep(300);
  m = await ev(() => ({ host: document.querySelector('#chat').dataset.sheet, ready: document.documentElement.dataset.ready, ev: window.__take().map((x) => x.detail.open) }));
  check('the back button closes the sheet (and does not leave the page)', m.host === '0' && m.ready === '1' && JSON.stringify(m.ev) === JSON.stringify([true, false]), JSON.stringify(m));
  await ev(() => { window.__dev.chat.setSheet(false); window.__dev.chat.setSheet(false); });
  check('setSheet with the same state reports nothing', (await ev(() => window.__take().length)) === 0);
  await ev(() => { const c = window.__dev.chat; c.setSheet(true); });
  await sleep(100);
  await ev(() => { const c = window.__dev.chat; c.setSheet(false); c.setSheet(true); });
  await sleep(400);
  m = await ev(() => ({ host: document.querySelector('#chat').dataset.sheet, ev: window.__take().map((x) => x.detail.open) }));
  check('closed and opened again in one turn: the sheet stays open', m.host === '1' && JSON.stringify(m.ev) === JSON.stringify([true, false, true]), JSON.stringify(m));
  await page.goBack();
  await sleep(300);
  m = await ev(() => ({ host: document.querySelector('#chat').dataset.sheet, ready: document.documentElement.dataset.ready }));
  check('and the back button still closes it', m.host === '0' && m.ready === '1', JSON.stringify(m));

  // 13. the field
  if (compact) { await ev(() => window.__dev.chat.setSheet(true)); await sleep(300); }
  await page.tap('#chat-toggle');
  await sleep(300);
  m = await ev(() => ({ sheet: document.querySelector('#chat').dataset.sheet, formHidden: document.querySelector('.chat__input').hidden, focus: document.activeElement?.id, inputH: Math.round(document.querySelector('#chat-input').getBoundingClientRect().height), sendDisabled: document.querySelector('#chat-send').disabled }));
  check('✎ opens the sheet with the field focused', m.sheet === '1' && m.formHidden === false && m.focus === 'chat-input', JSON.stringify(m));
  check('one-line field (44 px), send disabled while empty', m.inputH === 44 && m.sendDisabled === true, JSON.stringify(m));
  await ev(() => window.__take());
  await page.keyboard.type('炮二平五');
  await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
  await page.keyboard.type('好不好');
  m = await ev(() => ({ v: document.querySelector('#chat-input').value, h: Math.round(document.querySelector('#chat-input').getBoundingClientRect().height), n: window.__take().length }));
  check('Shift+Enter is a new line and the field grows', m.v === '炮二平五\n好不好' && m.h > 44 && m.n === 0, JSON.stringify(m));
  await page.keyboard.press('Enter');
  m = await ev(() => ({ v: document.querySelector('#chat-input').value, focus: document.activeElement?.id, ev: window.__take(), h: Math.round(document.querySelector('#chat-input').getBoundingClientRect().height) }));
  check('Enter sends chat:ask {text}, clears the field, keeps the focus', m.v === '' && m.focus === 'chat-input' && m.ev.length === 1 && m.ev[0].type === 'chat:ask' && m.ev[0].detail.text === '炮二平五\n好不好' && !('code' in m.ev[0].detail) && m.h === 44, JSON.stringify(m));
  await page.fill('#chat-input', '一\n二\n三\n四\n五\n六');
  m = await ev(() => Math.round(document.querySelector('#chat-input').getBoundingClientRect().height));
  check('the field grows to three lines at most', m > 80 && m <= 96, String(m));
  await page.fill('#chat-input', '');
  await page.keyboard.type('字'.repeat(130), { delay: 0 });
  m = await ev(() => document.querySelector('#chat-input').value.length);
  check('maxlength 120', m === 120, String(m));
  await page.fill('#chat-input', '');
  await ev(() => window.__dev.chat.setInput({ visible: true, enabled: false }));
  await page.keyboard.type('对方回合也能打字');
  await page.keyboard.press('Enter');
  m = await ev(() => ({ v: document.querySelector('#chat-input').value, ev: window.__take().length, dis: document.querySelector('#chat-send').disabled, ta: document.querySelector('#chat-input').disabled }));
  check('setInput({enabled:false}): nothing is sent, the text stays', m.v === '对方回合也能打字' && m.ev === 0 && m.dis === true && m.ta === false, JSON.stringify(m));
  await ev(() => window.__dev.chat.setInput({ visible: true, enabled: true }));
  await page.fill('#chat-input', '');
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v11', kind: 'ask' }); d.chat.segment('v11', d.T('让亮想一想')); });
  await sleep(150);
  await page.tap('#chat-send');
  m = await ev(() => ({ ev: window.__take(), st: document.querySelector('.msg[data-id="v11"]').dataset.state, mode: document.querySelector('#chat-send').dataset.mode }));
  check('■ sends chat:stop {} and ends the line', m.ev.length === 1 && m.ev[0].type === 'chat:stop' && JSON.stringify(m.ev[0].detail) === '{}' && m.st === 'done' && m.mode === 'send', JSON.stringify(m));
  await ev(() => { document.querySelector('#app').removeEventListener('chat:ask', window.__block, true); });
  await ev(() => window.__dev.chat.setInput({ visible: false, enabled: false }));
  m = await ev(() => ({ toggle: !!document.querySelector('#chat-toggle'), input: !!document.querySelector('#chat-input'), send: !!document.querySelector('#chat-send') }));
  check('setInput({visible:false}): #chat-toggle and the field are absent', !m.toggle && !m.input && !m.send, JSON.stringify(m));
  await ev(() => window.__dev.chat.setInput({ visible: true, enabled: true }));
  m = await ev(() => ({ toggle: !!document.querySelector('#chat-toggle'), input: !!document.querySelector('#chat-input'), first: document.querySelector('.chat__tools').firstElementChild.id }));
  check('and they come back in place', m.toggle && m.input && m.first === 'chat-toggle', JSON.stringify(m));

  // 14. the log: 60 messages, sticky scrolling
  await ev(() => { window.__dev.chat.setSheet(true); window.__dev.run.flood(); });
  await sleep(1600);
  m = await ev(() => { const log = document.querySelector('.chat__log'); return { n: log.querySelectorAll('.msg').length, first: log.querySelector('.msg .msg__text').textContent, gap: Math.round(log.scrollHeight - log.scrollTop - log.clientHeight) }; });
  check('the log keeps at most 60 messages', m.n === 60, JSON.stringify(m));
  check('the oldest were dropped (first is question 6)', m.first.startsWith('第 6 个问题'), m.first);
  check('the log followed to the bottom', m.gap <= 1, String(m.gap));
  await ev(() => { const log = document.querySelector('.chat__log'); log.scrollTop = log.scrollHeight - log.clientHeight - 30; });
  await sleep(100);
  await ev(() => window.__dev.chat.addEvent('第 99 回合'));
  m = await ev(() => { const log = document.querySelector('.chat__log'); return Math.round(log.scrollHeight - log.scrollTop - log.clientHeight); });
  check('30 px above the bottom: the log still follows', m <= 1, String(m));
  await ev(() => { const log = document.querySelector('.chat__log'); log.scrollTop = log.scrollHeight - log.clientHeight - 200; });
  await sleep(100);
  await ev(() => window.__dev.chat.addEvent('第 100 回合'));
  m = await ev(() => { const log = document.querySelector('.chat__log'); return Math.round(log.scrollHeight - log.scrollTop - log.clientHeight); });
  check('200 px above the bottom: the reader is left alone', m >= 200, String(m));
  await ev(() => window.__dev.chat.setSheet(false));

  // 15. chat.tick
  await ev(() => { const d = window.__dev; d.state.tickCount = 0; d.chat.setTypeTicks(false); d.chat.local([d.T('字'.repeat(40))]); });
  await sleep(1300);
  const t0 = await ev(() => window.__dev.state.tickCount);
  check('no chat.tick while typeTicks is off', t0 === 0, String(t0));
  await ev(() => { const d = window.__dev; d.chat.setTypeTicks(true); d.chat.local([d.T('字'.repeat(40))]); });
  await sleep(1300);
  const t1 = await ev(() => window.__dev.state.tickCount);
  if (motion === 'full') check('chat.tick while characters appear, at most one per 70 ms', t1 >= 3 && t1 <= Math.ceil(1300 / 70), String(t1));
  else check('reduced motion: one tick for a line shown at once', t1 === 1, String(t1));
  await ev(() => { const d = window.__dev; d.state.tickCount = 0; document.querySelector('[data-toggle="speaking"]').click(); d.chat.local([d.T('字'.repeat(40))]); });
  await sleep(1300);
  const t2 = await ev(() => window.__dev.state.tickCount);
  check('no chat.tick while read-aloud is speaking', t2 === 0, String(t2));
  await ev(() => { document.querySelector('[data-toggle="speaking"]').click(); window.__dev.chat.setTypeTicks(false); });

  // 16. play line
  await ev(() => { const d = window.__dev; d.chat.local(d.LINES.plan, { kind: 'hint' }); window.__take(); });
  await sleep(1500);
  m = await ev(() => { const p = document.querySelector('.bubble .move-link--play'); return p && { text: p.textContent, prev: p.previousElementSibling?.dataset.move, cls: p.className, h: Math.round(parseFloat(getComputedStyle(p, '::before').height)) }; });
  check('▶ 演示 after the last of three consecutive links', m && m.text === '▶ 演示' && m.prev === '9776' && m.cls === 'move-link move-link--play', JSON.stringify(m));
  // every link takes the tap on its own word, also when the tap areas of neighbouring lines overlap
  const codes = await ev(() => [...document.querySelectorAll('.bubble .move-link[data-move]')].map((b) => b.dataset.move));
  const got = [];
  for (let i = 0; i < codes.length; i++) {
    await page.locator('.bubble .move-link[data-move]').nth(i).tap();
    const evs = await ev(() => window.__take());
    got.push(evs.map((x) => x.detail.link.code + ':' + x.detail.active).join());
  }
  check('each link of a wrapped line takes the tap on its own word', codes.length === 3 && JSON.stringify(got) === JSON.stringify(codes.map((c) => c + ':true')), JSON.stringify([codes, got]));
  await page.tap('.bubble .move-link--play');
  e = await ev(() => window.__take());
  check('chat:playline {links} with the three links in order', e.length === 1 && e[0].type === 'chat:playline' && e[0].detail.links.map((l) => l.code).join() === '7774,0726,9776', JSON.stringify(e));
  check('a link has a 44 px-high tap area', m && m.h === 44, JSON.stringify(m));

  // 17. target element (the game-over card)
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'v12', kind: 'over', target: document.querySelector('#card-text') }); for (const seg of d.LINES.card) d.chat.segment('v12', seg); d.chat.end('v12', { reason: 'done', source: 'llm' }); });
  await sleep(2000);
  m = await ev(() => ({ card: document.querySelector('#card-text').textContent, log: document.querySelector('.msg[data-id="v12"] .msg__text').textContent, kind: document.querySelector('.msg[data-id="v12"]').dataset.kind, link: document.querySelector('#card-text .move-link')?.dataset.move, bubble: document.querySelector('.bubble__text').textContent }));
  check('target element: the line is written into it and into the log, not into the bubble', m.card === '这一局你的炮用得真好，炮五进四那一下最漂亮。下一盘小目标：吃子之前，先看它有没有保镖。' && m.log === m.card && m.kind === 'over' && m.link === '7434' && !m.bubble.includes('这一局'), JSON.stringify(m));

  // 18. clear()
  await ev(() => window.__dev.chat.clear());
  m = await ev(() => ({ n: document.querySelector('.chat__log').childElementCount, empty: document.querySelector('.bubble').dataset.empty }));
  check('clear(): the log and the bubble are empty', m.n === 0 && m.empty === '1', JSON.stringify(m));

  // 19. sizes and overflow
  await ev(() => { const d = window.__dev; d.chat.setChips(d.CHIPS.turn); });
  m = await ev(() => {
    const sizes = {};
    for (const sel of ['#chat-toggle', '#history-button']) { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); sizes[sel] = [Math.round(r.width), Math.round(r.height), getComputedStyle(el.parentElement).display]; }
    return { sizes, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, chatRight: Math.round(document.querySelector('#chat').getBoundingClientRect().right), w: innerWidth };
  });
  const toolsShown = m.sizes['#chat-toggle'][2] !== 'none';
  check('tools are at least 44 x 44 (or hidden in compact)', !toolsShown || (m.sizes['#chat-toggle'][0] >= 44 && m.sizes['#chat-toggle'][1] >= 44 && m.sizes['#history-button'][0] >= 44 && m.sizes['#history-button'][1] >= 44), JSON.stringify(m.sizes));
  check('no horizontal overflow', m.overflow === 0 && m.chatRight <= m.w, JSON.stringify(m));

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '  -> ' + r.extra}`);
  console.log(`checks: ${results.length}, failed: ${failed.length}`);
  if (failed.length) throw new Error(`${failed.length} checks failed`);
};
