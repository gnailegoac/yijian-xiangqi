// Reviewer's adversarial behaviour checks of chat-panel.js / stream-text.js in the real page (dev/chat.html).
export default async ({ page }) => {
  await page.waitForSelector('html[data-ready="1"]');
  const results = [];
  const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra: typeof extra === 'string' ? extra : JSON.stringify(extra) }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sleep = (ms) => page.waitForTimeout(ms);
  const motion = await ev(() => document.documentElement.dataset.motion);

  await ev(() => {
    window.__events = [];
    for (const type of ['chat:ask', 'chat:chip', 'chat:movelink', 'chat:playline', 'chat:stop', 'chat:sheet']) {
      document.querySelector('#app').addEventListener(type, (e) => { window.__events.push({ type, detail: JSON.parse(JSON.stringify(e.detail)) }); if (type !== 'chat:sheet') e.stopImmediatePropagation(); }, true);
    }
    window.__dev.run.clear();
    window.__take = () => window.__events.splice(0);
    window.__bubble = () => { const b = document.querySelector('.bubble'); return { text: b.querySelector('.bubble__text')?.textContent ?? '', cap: b.querySelector('.bubble__caption')?.textContent ?? '', tag: b.querySelector('.bubble__tag')?.hidden ? '' : (b.querySelector('.bubble__tag')?.textContent ?? ''), state: b.dataset.state ?? null, source: b.dataset.source ?? null, q: b.querySelector('.bubble__question')?.hidden ? '' : (b.querySelector('.bubble__question')?.textContent ?? '') }; };
    window.__msg = (id) => { const el = document.querySelector(`.msg[data-id="${id}"]`); return el ? { text: el.querySelector('.msg__text').textContent, state: el.dataset.state, source: el.dataset.source ?? null, typing: el.dataset.typing ?? null, tag: el.querySelector('.msg__tag')?.textContent ?? null } : null; };
  });

  // A. The script of a rival move (SPEC 5.8 E-turn): caption, the reply begins, and in the same turn a local line.
  await ev(() => { const d = window.__dev; d.chat.caption(d.LINES.caption); d.chat.begin({ id: 'a1', kind: 'opp', cue: null }); window.__aLocal = d.chat.local([d.T('这一步被抓住了。要不要悔一步重想？')]); });
  await sleep(900);
  let m = await ev(() => ({ b: window.__bubble(), a1: window.__msg('a1'), send: document.querySelector('#chat-send').dataset.mode }));
  check('A1 the local line shows in the bubble at once, the caption stays', m.b.text === '这一步被抓住了。要不要悔一步重想？' && m.b.cap === '马8进7出子', m);
  check('A2 the reply that has not spoken yet is still expected (open in the log, stop button)', m.a1 && m.a1.state === 'streaming' && m.send === 'stop', m);
  await ev(() => { const d = window.__dev; d.chat.segment('a1', d.T('对方跳马，')); d.chat.segment('a1', d.T('盯着咱们的炮。')); d.chat.end('a1', { reason: 'done', source: 'llm' }); });
  await sleep(1200);
  m = await ev(() => ({ b: window.__bubble(), a1: window.__msg('a1'), loc: window.__msg(window.__aLocal), send: document.querySelector('#chat-send').dataset.mode }));
  check('A3 its text is not lost: it is in the log, complete, source llm', m.a1 && m.a1.text === '对方跳马，盯着咱们的炮。' && m.a1.state === 'done' && m.a1.source === 'llm', m);
  check('A4 and it takes the bubble back, with the caption', m.b.text === '对方跳马，盯着咱们的炮。' && m.b.cap === '马8进7出子' && m.b.state === 'done' && m.b.source === 'llm', m);
  check('A5 the local line stays complete in the log', m.loc && m.loc.text === '这一步被抓住了。要不要悔一步重想？' && m.loc.state === 'done' && m.loc.source === 'local' && m.send === 'send', m);

  // A'. A waiting reply that never speaks is closed by the next reply, by endAll and by stop.
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'a2', kind: 'opp' }); d.chat.local([d.T('好险！对面没看见那步杀棋。')]); d.chat.begin({ id: 'a3', kind: 'ask' }); });
  m = await ev(() => ({ a2: window.__msg('a2'), a3: window.__msg('a3') }));
  check('A6 the next reply ends a reply that was still waiting (it leaves no trace)', m.a2 === null && m.a3 && m.a3.state === 'streaming', m);
  await ev(() => { const d = window.__dev; d.chat.local([d.T('不能一直将军，得换一招。')]); d.chat.endAll('aborted'); });
  m = await ev(() => ({ a3: window.__msg('a3'), send: document.querySelector('#chat-send').dataset.mode, b: window.__bubble() }));
  check('A7 endAll ends a waiting reply; the local line stays in the bubble', m.a3 === null && m.send === 'send' && m.b.text.startsWith('不能一直将军') , m);
  // a reply in mid-sentence is still cut by a local line (the child did something)
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'a4', kind: 'opp' }); d.chat.segment('a4', d.T('对方的车')); });
  await sleep(300);
  await ev(() => { const d = window.__dev; d.chat.local([d.T('不能一直将军，得换一招。')]); d.chat.segment('a4', d.T('正盯着马。')); });
  await sleep(700);
  m = await ev(() => ({ a4: window.__msg('a4'), b: window.__bubble() }));
  check('A8 a reply in mid-sentence is closed by a local line and takes no more text', m.a4 && m.a4.state === 'done' && !m.a4.text.includes('正盯着马') && m.b.text === '不能一直将军，得换一招。', m);

  // A9. a question whose answer is still awaited keeps its place above the answer when a local line came in between
  await ev(() => { const d = window.__dev; d.chat.clear(); d.chat.addChild('对方会怎么应？'); d.chat.begin({ id: 'a9', kind: 'ask' }); d.chat.local([d.T('不能一直将军，得换一招。')]); });
  await sleep(700);
  m = await ev(() => window.__bubble());
  check('A9a the local line shows without the question', m.text === '不能一直将军，得换一招。' && m.q === '', m);
  await ev(() => { const d = window.__dev; d.chat.segment('a9', d.T('它会吃炮。')); d.chat.end('a9', { reason: 'done', source: 'llm' }); });
  await sleep(700);
  m = await ev(() => ({ b: window.__bubble(), order: [...document.querySelectorAll('.chat__log .msg')].map((el) => el.querySelector('.msg__text').textContent) }));
  check('A9b the answer returns with its question; the log keeps the order question, answer, local line', m.b.text === '它会吃炮。' && m.b.q === '对方会怎么应？' && JSON.stringify(m.order) === JSON.stringify(['对方会怎么应？', '它会吃炮。', '不能一直将军，得换一招。']), m);
  // A10. the tool indicator of a waiting reply shows in the bubble again
  await ev(() => { const d = window.__dev; d.chat.clear(); d.chat.begin({ id: 'a10', kind: 'ask' }); d.chat.local([d.T('不能一直将军，得换一招。')]); d.chat.tool('a10', { phase: 'start', notation: '炮二平五' }); });
  m = await ev(() => ({ b: document.querySelector('.bubble').textContent, n: document.querySelectorAll('.chat-tool').length }));
  check('A10a tool start brings the waiting reply back with its indicator (bubble and log)', m.b.includes('亮在沙盘上摆一摆【炮二平五】……') && m.n === 2, m);
  await ev(() => { const d = window.__dev; d.chat.local([d.T('对，就是它！')]); });
  await sleep(700);
  m = await ev(() => ({ b: window.__bubble().text, n: document.querySelectorAll('.chat-tool').length, bubbleTool: document.querySelectorAll('.bubble .chat-tool').length }));
  check('A10b pushed out again: the indicator stays in the log only', m.b === '对，就是它！' && m.n === 1 && m.bubbleTool === 0, m);
  await ev(() => { const d = window.__dev; d.chat.tool('a10', { phase: 'end' }); d.chat.endAll('aborted'); });
  m = await ev(() => ({ n: document.querySelectorAll('.chat-tool').length, a10: window.__msg('a10'), send: document.querySelector('#chat-send').dataset.mode }));
  check('A10c tool end and endAll leave nothing of it', m.n === 0 && m.a10 === null && m.send === 'send', m);

  // D. ids
  await ev(() => { const d = window.__dev; d.chat.clear(); d.chat.end('nope', { reason: 'done', source: 'llm' }); d.chat.segment('nope', d.T('x')); d.chat.reset('nope'); d.chat.tool('nope', { phase: 'start' });
    d.chat.begin({ id: 'd1', kind: 'try' }); d.chat.segment('d1', d.T('第一句。')); d.chat.begin({ id: 'd1', kind: 'try' }); d.chat.segment('d1', d.T('第二句。')); d.chat.end('d1', { reason: 'done', source: 'llm' }); d.chat.segment('d1', d.T('多余')); d.chat.end('d1', { reason: 'done', source: 'local' }); });
  await sleep(900);
  m = await ev(() => ({ all: [...document.querySelectorAll('.msg[data-id="d1"]')].map((el) => [el.querySelector('.msg__text').textContent, el.dataset.state, el.dataset.source ?? null]), b: window.__bubble() }));
  check('D1 unknown ids are ignored; the same id again replaces a line that had shown nothing; nothing changes after end', JSON.stringify(m.all.at(-1)) === JSON.stringify(['第二句。', 'done', 'llm']) && m.all.length === (motion === 'full' ? 1 : 2) && m.b.text === '第二句。', m);

  // E. model text is never HTML
  await ev(() => { const d = window.__dev; d.chat.local([d.T('<img src=x onerror="window.__pwned=1"><b>粗</b>')]); d.chat.addChild('<i>斜</i>'); d.chat.addEvent('<u>线</u>'); });
  await sleep(900);
  m = await ev(() => ({ pwned: window.__pwned ?? null, imgs: document.querySelectorAll('#chat img, #chat b, #chat i, #chat u, #buddy img, #buddy b').length, b: window.__bubble().text }));
  check('E1 markup in text stays text', m.pwned === null && m.imgs === 0 && m.b.includes('<img'), m);

  // H. a line that ends with nothing leaves no trace
  await ev(() => { const d = window.__dev; d.chat.clear(); d.chat.begin({ id: 'h1', kind: 'try' }); d.chat.end('h1', { reason: 'done', source: 'none' }); });
  m = await ev(() => ({ h1: window.__msg('h1'), n: document.querySelectorAll('.msg').length, empty: document.querySelector('.bubble').dataset.empty, send: document.querySelector('#chat-send').dataset.mode }));
  check('H1 begin + end with no text: no message, empty bubble, send button back', m.h1 === null && m.n === 0 && m.empty === '1' && m.send === 'send', m);
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'h2', kind: 'try', cue: '妙哉！' }); d.chat.end('h2', { reason: 'done', source: 'local' }); });
  m = await ev(() => ({ h2: window.__msg('h2'), b: window.__bubble() }));
  check('H2 a cue alone is a line (a nod with an interjection)', m.h2 && m.h2.state === 'done' && m.b.tag === '妙哉！' && m.b.state === 'done', m);

  // J. a line for the card does not touch the bubble line that is streaming
  await ev(() => { const d = window.__dev; d.chat.clear(); d.chat.begin({ id: 'j1', kind: 'ask' }); d.chat.segment('j1', d.T('先看这里。')); d.chat.local([d.T('这一局你的炮用得真好。')], { kind: 'over', target: document.querySelector('#card-text') }); d.chat.segment('j1', d.T('再看那里。')); d.chat.end('j1', { reason: 'done', source: 'llm' }); });
  await sleep(1000);
  m = await ev(() => ({ card: document.querySelector('#card-text').textContent, b: window.__bubble(), j1: window.__msg('j1') }));
  check('J1 card line and bubble line live side by side', m.card === '这一局你的炮用得真好。' && m.b.text === '先看这里。再看那里。' && m.j1.state === 'done', m);

  // K. cut: a move after the last whole sentence goes with the tail
  await ev(() => { const d = window.__dev; d.chat.clear(); d.chat.begin({ id: 'k1', kind: 'opp' }); d.chat.segment('k1', d.T('它要吃马。')); d.chat.segment('k1', d.LINES.caption[0]); d.chat.segment('k1', d.T('之后')); d.chat.end('k1', { reason: 'cut', source: 'mixed' }); });
  await sleep(300);
  m = await ev(() => ({ k1: window.__msg('k1'), links: document.querySelectorAll('.msg[data-id="k1"] .move-link').length, b: window.__bubble() }));
  check('K1 cut keeps the whole sentences only', m.k1.text === '它要吃马。' && m.links === 0 && m.b.text === '它要吃马。' && m.b.source === 'mixed', m);
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'k2', kind: 'opp' }); d.chat.segment('k2', d.T('它要吃马')); d.chat.end('k2', { reason: 'cut', source: 'mixed' }); });
  await sleep(300);
  m = await ev(() => window.__msg('k2'));
  check('K2 cut with no sentence end keeps what was said', m.text === '它要吃马' && m.state === 'done', m);

  // G. clear() while a line streams; late calls for it are ignored
  await ev(() => { const d = window.__dev; d.chat.begin({ id: 'g1', kind: 'try' }); d.chat.segment('g1', d.T('这一步不错，')); d.chat.clear(); d.chat.segment('g1', d.T('可是')); d.chat.end('g1', { reason: 'done', source: 'llm' }); d.chat.tool('g1', { phase: 'start', notation: '炮二平五' }); });
  await sleep(400);
  m = await ev(() => ({ n: document.querySelector('.chat__log').childNodes.length, empty: document.querySelector('.bubble').dataset.empty, send: document.querySelector('#chat-send').dataset.mode, tool: document.querySelectorAll('.chat-tool').length }));
  check('G1 clear() mid-stream leaves nothing behind', m.n === 0 && m.empty === '1' && m.send === 'send' && m.tool === 0, m);

  // C. a covered link is never meant: tap in the sheet at a point where the (covered) bubble holds a link
  await ev(() => { const d = window.__dev; d.chat.clear(); d.chat.local(d.LINES.try); });
  await sleep(1500);
  await ev(() => window.__dev.chat.setSheet(true));
  await sleep(500);
  m = await ev(() => {
    window.__take();
    const covered = document.querySelector('#buddy .move-link[data-move]');
    const inLog = document.querySelector('.chat__log .move-link[data-move]');
    const box = covered.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    inLog.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1, view: window }));
    return { coveredBy: top && (top.closest('#chat') ? 'sheet' : top.className), ev: window.__take().filter((e) => e.type === 'chat:movelink').length, coveredActive: covered.classList.contains('is-active'), logActive: inLog.classList.contains('is-active'), hasBox: box.width > 0 };
  });
  check('C1 a tap delivered to a log link never activates the bubble link the sheet covers', m.hasBox && m.ev === 1 && m.logActive && !m.coveredActive, m);
  await ev(() => window.__dev.chat.setSheet(false));
  await sleep(400);

  // F. free text taken away while the field is open and focused
  await ev(() => { const d = window.__dev; d.chat.setSheet(true, { focusInput: true }); });
  await sleep(300);
  await page.locator('#chat-input').fill('写到一半');
  await ev(() => { window.__dev.chat.setInput({ visible: false, enabled: false }); });
  m = await ev(() => ({ input: !!document.querySelector('#chat-input'), toggle: !!document.querySelector('#chat-toggle'), sheet: document.querySelector('#chat').dataset.sheet, inputAttr: document.querySelector('#chat').dataset.input }));
  check('F1 setInput({visible:false}) with the field open: field and ✎ are gone, the sheet stays', !m.input && !m.toggle && m.sheet === '1' && m.inputAttr === '0', m);
  await ev(() => { window.__dev.chat.setInput({ visible: true, enabled: true }); window.__dev.chat.setSheet(false); });
  await sleep(400);

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '  -> ' + r.extra}`);
  console.log(`adversarial (${motion}): ${results.length} checks, ${failed.length} failed`);
  if (failed.length) throw new Error(`${failed.length} checks failed`);
};
