// Touch targets: what the finger hits just outside the visual box of the small controls, and the sizes of the rest.
export default async ({ page }) => {
  await page.waitForSelector('html[data-ready="1"]');
  const report = await page.evaluate(async () => {
    const d = window.__dev;
    const out = {};
    const size = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const hitAbove = (el, dy) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top - dy); return hit === el || el.contains(hit); };
    const hitBelow = (el, dy) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom + dy - 1); return hit === el || el.contains(hit); };
    d.chat.setChips(d.CHIPS.turn);
    await new Promise((r) => setTimeout(r, 700));
    const chip = document.querySelector('.chip');
    out.layout = d.layout.layout;
    out.chip = size(chip);
    out.chipTapAbove3 = hitAbove(chip, 3);
    out.chipTapBelow3 = hitBelow(chip, 3);
    d.chat.local(d.LINES.plan, { kind: 'hint' });
    await new Promise((r) => setTimeout(r, 1500));
    const link = document.querySelector('.bubble .move-link');
    out.link = size(link);
    out.linkTapAbove8 = hitAbove(link, 8);
    out.linkTapBelow8 = hitBelow(link, 8);
    d.chat.setSheet(true, { focusInput: true });
    await new Promise((r) => setTimeout(r, 400));
    out.head = size(document.querySelector('.chat__head'));
    out.send = size(document.querySelector('#chat-send'));
    out.sendTapBelow3 = hitBelow(document.querySelector('#chat-send'), 3);
    out.input = size(document.querySelector('#chat-input'));
    d.chat.setSheet(true);
    d.chat.setInput({ visible: true, enabled: true });
    d.chat.setSheet(false);
    d.chat.setSheet(true);
    await new Promise((r) => setTimeout(r, 400));
    out.toggleInSheet = size(document.querySelector('#chat-toggle'));
    out.sheetChip = size(document.querySelector('.chip'));
    d.chat.setSheet(false);
    const tools = document.querySelector('.chat__tools');
    out.toolsShown = getComputedStyle(tools).display !== 'none';
    if (out.toolsShown) { out.toggle = size(document.querySelector('#chat-toggle')); out.history = size(document.querySelector('#history-button')); }
    out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return out;
  });
  console.log('touch', JSON.stringify(report));
};
