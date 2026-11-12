import { record, sheet, clipOf, boardClip, sleep, ev } from './rlib.mjs';
const SPEC = { rook: [[8, 1], [3, 1]], horse: [[7, 2], [5, 3]], elephant: [[9, 2], [7, 4]], advisor: [[9, 3], [8, 4]], king: [[9, 4], [8, 4]], pawn: [[6, 4], [5, 4]] };
export default async ({ page }) => {
  await sleep(page, 400);
  const jobs = [];
  for (const type of Object.keys(SPEC)) {
    const clip = await clipOf(page, SPEC[type], 1.6);
    const frames = await record(page, () => ev(page, (t) => { window.demo.capture(t); }, type), 1100);
    jobs.push([`cap-${type}`, frames.filter((f) => f.t >= 230), { clip, cols: 10, scale: 0.7, max: 20 }]);
    await sleep(page, 300);
  }
  for (const [name, frames, opts] of jobs) await sheet(page, name, frames, opts);
};
