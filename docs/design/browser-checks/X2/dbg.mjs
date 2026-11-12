import { record, clipOf, cell, DIR } from './lib.mjs';
import { writeFileSync } from 'node:fs';
export default async ({ page }) => {
  const clip = await clipOf(page, [[6, 3], [8, 8]], 0.9);
  const f = await record(page, () => cell(page, 7, 7).tap(), 300);
  writeFileSync(`${DIR}raw.jpg`, Buffer.from(f[f.length - 1].data, 'base64'));
  const dims = await page.evaluate(async (data) => { const i = new Image(); i.src = `data:image/jpeg;base64,${data}`; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, f[f.length - 1].data);
  console.log(JSON.stringify({ clip, n: f.length, dims, scroll: await page.evaluate(() => [scrollX, scrollY]) }));
};
