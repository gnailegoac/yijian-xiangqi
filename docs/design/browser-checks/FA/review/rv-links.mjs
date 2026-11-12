// Review of FA item 10 in the real page: links of the current position stay live (also after a trial is taken back and
// after a pouch), links of an earlier position are retired and read as words of their sentence in the 回看 log.
// Usage: node rv-links.mjs [size|all]
import { launch, open, sleep, waitReady, idle, waitPhase, phaseOf, tapCell, centre, SIZES, SHOTS } from './lib.mjs';

const [sizeArg = 'all'] = process.argv.slice(2);

const links = (page) => page.evaluate(() => [...document.querySelectorAll('.chat__log .move-link')].map((b) => {
  const msg = b.closest('.msg');
  return { text: b.textContent, kind: msg?.getAttribute('data-kind'), disabled: /** @type {HTMLButtonElement} */ (b).disabled, play: b.classList.contains('move-link--play') };
}));
const arrows = (page) => page.evaluate(() => document.querySelectorAll('#board .arrow').length);

async function openSheet(page) {
  if (await page.evaluate(() => document.getElementById('app')?.dataset.sheet) === '1') return;
  // as a child does on every layout: a tap on the speech bubble, on a point that is no link
  const point = await page.evaluate(() => {
    const el = document.querySelector('.bubble');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const controls = [...document.querySelectorAll('button, a, input, textarea, select')].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    let best = null;
    for (let iy = 1; iy < 8; iy++) for (let ix = 1; ix < 24; ix++) {
      const x = box.left + (box.width * ix) / 24, y = box.top + (box.height * iy) / 8;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit) || hit.closest('button, a, input, textarea, select')) continue;
      let clear = Infinity;
      for (const r of controls) clear = Math.min(clear, Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)));
      if (!best || clear > best.clear) best = { x, y, clear };
    }
    return best;
  });
  if (point) await page.touchscreen.tap(point.x, point.y);
  await page.waitForFunction(() => document.getElementById('app')?.dataset.sheet === '1', null, { timeout: 4000 }).catch(() => {});
  await sleep(400);
}
async function closeSheet(page) {
  if (await page.evaluate(() => document.getElementById('app')?.dataset.sheet) !== '1') return;
  await page.keyboard.press('Escape');
  await sleep(400);
}

/** Taps the n-th link of the log (the sheet is opened for it) and says how many arrows the board shows afterwards. */
async function tapLink(page, index) {
  await openSheet(page);
  const at = await page.evaluate((i) => {
    const b = document.querySelectorAll('.chat__log .move-link')[i];
    if (!(b instanceof HTMLElement)) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, index);
  if (!at) return -1;
  await sleep(150);
  await page.touchscreen.tap(at.x, at.y);
  await sleep(400);
  return arrows(page);
}

async function run(browser, size) {
  const out = [];
  const { context, page, errors } = await open(browser, { size, motion: 'reduced' });
  await page.goto('/?test=1', { waitUntil: 'load' });
  await waitReady(page);
  await idle(page);
  await page.waitForFunction(() => document.querySelector('.bubble')?.getAttribute('data-state') !== 'streaming', null, { timeout: 15000 });
  // round 1
  await tapCell(page, 7, 7); await waitPhase(page, 'selected');
  await tapCell(page, 7, 4); await waitPhase(page, 'tentative');
  await sleep(450);
  await page.locator('#confirm-button').tap();
  await page.waitForFunction(() => document.getElementById('app')?.dataset.ply === '2', null, { timeout: 15000 });
  await idle(page);
  await sleep(2500);                                         // the read of his move has been written
  let list = await links(page);
  const captionIndex = list.findIndex((l) => l.kind === 'caption');
  out.push(`turn 2, links in the log: ${list.map((l) => `${l.kind}:${l.text}${l.disabled ? '(retired)' : ''}`).join(' | ')}`);
  // a trial, then taken back: the links of this turn stay live
  await tapCell(page, 9, 7); await waitPhase(page, 'selected');
  await tapCell(page, 7, 6); await waitPhase(page, 'tentative');
  await sleep(1500);
  await page.locator('#retract-button').tap();
  await waitPhase(page, 'selected');
  await sleep(300);
  list = await links(page);
  const liveAfterRetract = captionIndex >= 0 && !list[captionIndex].disabled;
  const drew = await tapLink(page, captionIndex);
  await closeSheet(page);
  out.push(`after a trial was taken back: the caption link of this turn is ${liveAfterRetract ? 'live' : 'RETIRED'}, a tap draws ${drew} arrow(s)`);
  // the pouches: the link of pouch 3 is live, also after 试试这步 and 换一步
  if (await phaseOf(page) === 'selected') { await tapCell(page, 9, 7); await sleep(200); }
  for (let i = 0; i < 3; i++) { await page.locator('#hint-button').tap().catch(() => {}); await sleep(1200); }
  await sleep(1500);
  list = await links(page);
  const hintIndex = list.findIndex((l) => l.kind === 'hint' && !l.play);
  const hintLive = hintIndex >= 0 && !list[hintIndex].disabled;
  const chip = await centre(page, '.chip[data-action="pouch"]');
  let hintAfter = 'no chip';
  if (chip) {
    await page.touchscreen.tap(chip.x, chip.y);
    await waitPhase(page, 'tentative', 4000).catch(() => {});
    await sleep(1200);
    await page.locator('#retract-button').tap().catch(() => {});
    await sleep(500);
    list = await links(page);
    hintAfter = hintIndex >= 0 && !list[hintIndex].disabled ? 'live' : 'RETIRED';
  }
  out.push(`pouch 3: its link is ${hintIndex < 0 ? 'missing' : hintLive ? 'live' : 'RETIRED'}; after 试试这步 and 换一步 it is ${hintAfter}`);
  // round 2: the child plays, he answers: everything written before is retired, his new caption is live
  const before = (await links(page)).length;
  if (await phaseOf(page) === 'selected') { const sel = await page.evaluate(() => { const c = document.querySelector('.board-cell.is-selected'); return c ? [Number(c.getAttribute('data-row')), Number(c.getAttribute('data-col'))] : null; }); if (sel) await tapCell(page, sel[0], sel[1]); await sleep(200); }
  await tapCell(page, 9, 1); await waitPhase(page, 'selected');
  await tapCell(page, 7, 2); await waitPhase(page, 'tentative');
  await sleep(450);
  await page.locator('#confirm-button').tap();
  await page.waitForFunction(() => document.getElementById('app')?.dataset.ply === '4', null, { timeout: 15000 });
  await idle(page);
  await sleep(2500);
  list = await links(page);
  const old = list.slice(0, before);
  const fresh = list.slice(before);
  out.push(`turn 4: ${old.filter((l) => l.disabled).length}/${old.length} earlier links retired; new: ${fresh.map((l) => `${l.kind}:${l.text}${l.disabled ? '(retired)' : ''}`).join(' | ')}`);
  // how a retired link reads in the 回看 log
  await openSheet(page);
  const look = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.chat__log .move-link')].find((el) => /** @type {HTMLButtonElement} */ (el).disabled && !el.classList.contains('move-link--play'));
    if (!(b instanceof HTMLElement) || !b.parentElement) return null;
    b.scrollIntoView({ block: 'center' });
    const cs = getComputedStyle(b), ps = getComputedStyle(b.parentElement);
    const before = getComputedStyle(b, '::before').content, after = getComputedStyle(b, '::after').content;
    const play = [...document.querySelectorAll('.chat__log .move-link--play')].map((el) => getComputedStyle(el).display);
    return { text: b.textContent, sentence: (b.parentElement.textContent ?? '').slice(0, 40), sameColour: cs.color === ps.color, colour: cs.color, parent: ps.color,
             sameWeight: cs.fontWeight === ps.fontWeight, sameSize: cs.fontSize === ps.fontSize, sameFont: cs.fontFamily === ps.fontFamily, underline: cs.textDecorationLine, borderBottom: cs.borderBottomStyle,
             display: cs.display, background: cs.backgroundColor, opacity: cs.opacity, pointer: cs.pointerEvents, before, after, play };
  });
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/links-log-${size}.png` });
  out.push(`a retired link in the log: ${JSON.stringify(look)}`);
  const firstRetired = list.findIndex((l) => l.disabled && !l.play);
  const drewOld = await tapLink(page, firstRetired);
  const sheetStill = await page.evaluate(() => document.getElementById('app')?.dataset.sheet);
  const freshIndex = list.findIndex((l, i) => i >= before && !l.disabled && !l.play);
  const drewNew = freshIndex >= 0 ? await tapLink(page, freshIndex) : -1;
  out.push(`a tap on a retired link draws ${drewOld} arrow(s) (sheet open: ${sheetStill}); a tap on the newest live link draws ${drewNew}`);
  const ok = liveAfterRetract && drew === 1 && (hintIndex < 0 || (hintLive && hintAfter !== 'RETIRED')) && old.every((l) => l.disabled) && fresh.some((l) => !l.disabled)
    && drewOld === 0 && drewNew === 1 && !!look && look.sameColour && look.sameWeight && look.underline === 'none';
  await context.close();
  return { ok, out, errors };
}

const browser = await launch();
try {
  for (const size of sizeArg === 'all' ? Object.keys(SIZES) : [sizeArg]) {
    try {
      const v = await run(browser, size);
      console.log(`${v.ok ? 'OK  ' : 'FAIL'} ${size}\n  ${v.out.join('\n  ')}${v.errors.length ? `\n  errors: ${v.errors.slice(0, 2).join(' ; ')}` : ''}`);
    } catch (error) {
      console.log(`ERR  ${size}: ${error && error.message ? error.message.split('\n')[0] : error}`);
    }
  }
} finally {
  await browser.close();
}
