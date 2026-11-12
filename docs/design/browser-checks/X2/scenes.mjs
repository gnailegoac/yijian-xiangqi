// Records demo scenes (real-time frames) and writes one contact sheet per scene.
// SCENES env: comma list of name:call, e.g. "rook:move('rook')"; SQ env maps are below.
import { record, sheet, clipOf, boardClip } from './lib.mjs';
const SQ = { rook: [[8, 1], [3, 1]], horse: [[7, 2], [5, 3]], cannon: [[7, 7], [7, 3]], cannonx: [[7, 7], [2, 7]], elephant: [[9, 2], [7, 4]], advisor: [[9, 3], [8, 4]], king: [[9, 4], [8, 4]], pawn: [[6, 4], [5, 4]], river: [[5, 4], [4, 4]] };
export default async ({ page }) => {
  const list = (process.env.SCENES ?? '').split(';').filter(Boolean).map((s) => { const [name, call, sq, ms, from] = s.split('|'); return { name, call, sq, ms: Number(ms || 1300), from: Number(from || 200) }; });
  const flipped = process.env.FLIP === '1';
  const out = [];
  for (const sc of list) {
    const frames = await record(page, () => page.evaluate((call) => { new Function(`return window.demo.${call}`)(); }, sc.call), sc.ms);
    let clip = await boardClip(page);
    if (sc.sq && SQ[sc.sq]) clip = await clipOf(page, SQ[sc.sq].map(([r, c]) => (flipped ? [9 - r, 8 - c] : [r, c])), 1.3);
    out.push({ sc, frames: frames.filter((f) => f.t >= sc.from), clip });
    await page.waitForTimeout(350);
  }
  console.log(JSON.stringify(await page.evaluate(() => ({ busy: document.documentElement.dataset.uiBusy ?? null, nodes: document.querySelectorAll('.bv *').length, log: window.__log.slice(-14) }))));
  for (const o of out) {
    const scale = o.clip.width > 500 ? 0.36 : Math.min(0.8, 190 / o.clip.width);
    await sheet(page, `sc-${o.sc.name}`, o.frames, { clip: o.clip, cols: 9, scale, max: 18 });
  }
};
