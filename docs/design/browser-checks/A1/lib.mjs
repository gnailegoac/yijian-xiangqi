// Shared helpers for the A1 browser runs.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function attr(page, sel, name) {
  return page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [sel, name]);
}
export const phase = (page) => attr(page, '#app', 'data-phase');
export const ply = async (page) => Number(await attr(page, '#app', 'data-ply'));

export async function waitFor(page, fn, arg, ms = 15000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(50);
  }
}
export const waitPhase = (page, p, ms) => waitFor(page, (want) => (Array.isArray(want) ? want : [want]).includes(document.querySelector('#app')?.getAttribute('data-phase')), p, ms, `phase ${p}`);
export const waitPly = (page, n, ms) => waitFor(page, (want) => Number(document.querySelector('#app')?.getAttribute('data-ply')) >= want, n, ms, `ply ${n}`);

export async function tapCell(page, row, col) {
  const box = await page.evaluate(([r, c]) => {
    const el = document.querySelector(`.board-cell[data-row="${r}"][data-col="${c}"]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [row, col]);
  if (!box) throw new Error(`no cell ${row},${col}`);
  await page.touchscreen.tap(box.x, box.y);
}

/** Taps the first visible element that matches; scrolls it into view first (the chip row of the phone layout scrolls). */
export async function tapSel(page, sel) {
  const found = await page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return false;
    el.scrollIntoView({ block: 'nearest', inline: 'center' });
    return true;
  }, sel);
  if (!found) throw new Error(`no visible element ${sel}`);
  await sleep(60);
  const box = await page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, inside: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, hit: !!top && (top === el || el.contains(top) || top.contains(el)) };
  }, sel);
  if (!box) throw new Error(`no visible element ${sel}`);
  if (!box.inside) throw new Error(`element ${sel} is outside the window`);
  if (!box.hit) throw new Error(`element ${sel} is covered by something else`);
  await page.touchscreen.tap(box.x, box.y);
}

export const bubble = (page) => page.evaluate(() => {
  const b = document.querySelector('.bubble');
  return b ? { state: b.getAttribute('data-state'), source: b.getAttribute('data-source'), text: b.textContent.trim().slice(0, 200) } : null;
});
export const chips = (page) => page.evaluate(() => [...document.querySelectorAll('.chip')].filter((c) => c.getBoundingClientRect().width > 0).map((c) => c.textContent.trim()));

/** The position as the board's cells know it: "rrook@90 ..." sorted. */
export const pieces = (page) => page.evaluate(() => [...document.querySelectorAll('.board-cell[data-piece]')].filter((c) => c.dataset.piece).map((c) => {
  const p = document.querySelector(`.piece[data-id="${c.dataset.piece}"]`);
  return `${p ? p.dataset.color[0] + p.dataset.type : '?'}@${c.dataset.row}${c.dataset.col}`;
}).sort().join(' '));
/** The piece elements with their marks (for debugging). */
export const pieceEls = (page) => page.evaluate(() => [...document.querySelectorAll('.piece[data-id]')].map((p) => {
  const marks = p.className.replace(/\b(piece|red|black)\b/g, '').trim();
  return `${p.dataset.color[0]}${p.dataset.type}@${p.dataset.row}${p.dataset.col}${marks ? `[${marks}]` : ''}`;
}).sort().join(' '));

export async function start(page) {
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice]'), null, 10000, 'start card');
  await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
}
