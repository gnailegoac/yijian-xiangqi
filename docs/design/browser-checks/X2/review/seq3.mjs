import { record, sheet, clipOf, sleep, ev } from './rlib.mjs';
import { readFileSync, existsSync } from 'node:fs';
const CSS_FILE = new URL('./try.css', import.meta.url);
export default async ({ page }) => {
  if (process.env.TRYCSS && existsSync(CSS_FILE)) await page.addStyleTag({ content: readFileSync(CSS_FILE, 'utf8') });
  await sleep(page, 400);
  const jobs = [];
  // rival horse move (quiet): the mirrored arena: black horse from (2,6) to (4,5)
  const clip = await clipOf(page, [[2, 6], [4, 5]], 1.7);
  const frames = await record(page, () => ev(page, () => { window.demo.rivalMove('horse'); }), 1300);
  jobs.push(['rival-horse', frames.filter((f) => f.t >= 200), { clip, cols: 9, scale: 0.75, max: 18 }]);
  for (const [name, f, opts] of jobs) await sheet(page, name, f, opts);
};
