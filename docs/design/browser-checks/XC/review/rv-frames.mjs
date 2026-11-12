// Reviewer's look at the motion of item 2 (full motion, dev/hud.html?figure=cheering): the transitions are paused
// and stepped, so every frame is exact. Card in: he fades out (still painted until the fade ends). Card out: he is
// painted again from the first frame and fades in.
import { grab, note, save } from './rlib.mjs';
const sleep = (page, ms) => page.waitForTimeout(ms);
const STEPS = [0, 50, 100, 150, 190, 200, 250, 300];

const state = () => {
  const fig = document.querySelector('#buddy .buddy-fig'); const cs = getComputedStyle(fig);
  const card = document.querySelector('#overlays .hud-layer--over > dialog');
  return { opacity: Number(cs.opacity).toFixed(2), visibility: cs.visibility, card: card ? Number(getComputedStyle(card).opacity).toFixed(2) : null,
           anims: document.getAnimations().map((a) => `${a.transitionProperty ?? a.animationName}@${a.effect?.target?.className?.baseVal ?? String(a.effect?.target?.className).split(' ')[0]}`).filter((s) => /buddy-fig|hud-over\b/.test(s)).join(',') };
};
const hold = (t) => { for (const a of document.getAnimations()) { if (a.effect?.target?.closest?.('#overlays .hud-layer--over, #buddy .buddy-fig') && !a.effect.target.closest('svg')) { a.pause(); a.currentTime = t; } } };

export default async ({ page, shot }) => {
  await page.waitForFunction(() => window.__dev && document.querySelector('#buddy .buddy-fig'));
  await sleep(page, 1800);                                  // the three hops of cheering are over
  const fails = [], out = { in: [], out: [] };
  const box = await page.evaluate(() => { const f = document.querySelector('#buddy').getBoundingClientRect(); return { x: f.left - 90, y: f.top - 10, width: f.width + 100, height: f.height + 20 }; });
  // card in
  await page.evaluate((hold) => { window.__dev.over('win', { type: false }); (0, eval)(`(${hold})`)(0); }, hold.toString());
  for (const t of STEPS) {
    await page.evaluate(({ hold, t }) => (0, eval)(`(${hold})`)(t), { hold: hold.toString(), t });
    await sleep(page, 60);
    const s = await page.evaluate(state);
    out.in.push({ t, ...s });
    await grab(page, `in-${String(t).padStart(3, '0')}`, box);
  }
  await page.evaluate(() => { for (const a of document.getAnimations()) if (a.playState === 'paused') { try { a.finish(); } catch { a.play(); } } });
  await sleep(page, 100);
  out.inEnd = await page.evaluate(state);
  note('RV card-in', out.in.map((s) => `${s.t}:fig ${s.opacity}/${s.visibility} card ${s.card}`).join('  '));
  note('RV card-in end', out.inEnd);
  for (const s of out.in) {
    if (s.t < 200 && s.visibility !== 'visible') fails.push(`card in, ${s.t} ms: already ${s.visibility} (he must fade, not vanish)`);
    if (s.t >= 200 && (s.opacity !== '0.00')) fails.push(`card in, ${s.t} ms: opacity ${s.opacity}`);
  }
  if (out.inEnd.visibility !== 'hidden' || out.inEnd.opacity !== '0.00') fails.push(`card in, end: ${JSON.stringify(out.inEnd)}`);
  if (!(Number(out.in[1].opacity) < 1 && Number(out.in[1].opacity) > 0)) fails.push(`card in: no fade at 50 ms (${out.in[1].opacity})`);

  // card out (回看棋局)
  await page.evaluate((hold) => { document.querySelector('#overlays dialog[data-dialog="over"] [data-choice="review"]').click(); (0, eval)(`(${hold})`)(0); }, hold.toString());
  for (const t of STEPS) {
    await page.evaluate(({ hold, t }) => (0, eval)(`(${hold})`)(t), { hold: hold.toString(), t });
    await sleep(page, 40);
    const s = await page.evaluate(state);
    out.out.push({ t, ...s });
    await grab(page, `out-${String(t).padStart(3, '0')}`, box);
  }
  await page.evaluate(() => { for (const a of document.getAnimations()) if (a.playState === 'paused') { try { a.finish(); } catch { a.play(); } } });
  await sleep(page, 500);
  out.outEnd = await page.evaluate(state);
  note('RV card-out', out.out.map((s) => `${s.t}:fig ${s.opacity}/${s.visibility} card ${s.card}`).join('  '));
  note('RV card-out end', out.outEnd);
  for (const s of out.out) {
    if (s.t > 0 && s.visibility !== 'visible') fails.push(`card out, ${s.t} ms: still ${s.visibility}`);
  }
  if (!(Number(out.out[2].opacity) > 0 && Number(out.out[2].opacity) < 1)) fails.push(`card out: no fade at 100 ms (${out.out[2].opacity})`);
  if (out.outEnd.visibility !== 'visible' || out.outEnd.opacity !== '1.00' || out.outEnd.card !== null) fails.push(`card out, end: ${JSON.stringify(out.outEnd)}`);
  await shot(`${process.env.RV_TAG}-end`);
  save('frames.json', out);
  note('RV-RESULT', fails.length ? fails : 'ok');
  if (fails.length) throw new Error(fails.join(' | '));
};
