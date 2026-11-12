import { record, sheet, clipOf, boardClip, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 400);
  const jobs = [];
  const cell = (r, c) => page.locator(`.board-cell[data-row="${r}"][data-col="${c}"]`);
  let clip = await clipOf(page, [[7, 7], [7, 4]], 1.3);
  jobs.push(['select', await record(page, async () => { await cell(7, 7).tap(); }, 450), { clip, cols: 8, scale: 0.8, max: 16 }]);
  jobs.push(['trial', await record(page, async () => { await cell(7, 4).tap(); }, 900), { clip, cols: 8, scale: 0.8, max: 24 }]);
  jobs.push(['stamp', await record(page, async () => { await cell(7, 4).tap(); }, 700), { clip, cols: 8, scale: 0.8, max: 24 }]);
  await sleep(page, 2500);
  await ev(page, () => window.demo.aim('cannon'));
  await sleep(page, 700);
  clip = await boardClip(page);
  jobs.push(['d6cannon', await record(page, () => ev(page, () => { window.view.commitTentative({ flags: window.lab.QUIET }); }), 1000), { clip, cols: 8, scale: 0.42, max: 32 }]);
  for (const [name, frames, opts] of jobs) await sheet(page, name, frames, opts);
};
