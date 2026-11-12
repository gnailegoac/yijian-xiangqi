// Reviewer's before / after of the two stylesheets on dev/stage.html (reduced motion): the same page once with the
// repo's styles/hud.css + styles/buddy.css and once with the reviewed versions (snapshots/04-post-wave2-logic) served
// in their place. Portrait and compact must be pixel-identical, with the card up and after it has gone.
// In landscape the two must differ (that is the fix), which shows that the comparison sees something.
import { readFileSync } from 'node:fs';
import { grab, compare, DIFF, note, save } from './rlib.mjs';
const sleep = (page, ms) => page.waitForTimeout(ms);
const SNAP = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/snapshots/04-post-wave2-logic';

async function scenario(page, context, tag) {
  await page.waitForFunction(() => window.__dev && document.querySelectorAll('.piece').length === 32);
  await page.waitForFunction(() => (document.querySelector('#buddy .bubble__text')?.textContent ?? '').includes('上盘说好的小目标'), null, { timeout: 15000 });
  await sleep(page, 1500);                                      // the second line of the greeting stands in the bubble
  const shots = {};
  shots.game = await grab(page, `${tag}-game`);
  for (const scene of ['win', 'loss']) {
    await page.evaluate((s) => window.__dev.moment[s === 'win' ? 'mate' : 'loss'](), scene);
    await sleep(page, 1300);
    await page.evaluate(() => window.__dev.act.confirm());
    await page.waitForFunction(() => document.querySelector('#overlays .hud-layer--over.is-open > dialog[data-dialog="over"]'), null, { timeout: 30000 });
    let prev = await grab(page, `${tag}-${scene}-card`), still = 0, tries = 0;
    while (still < 2 && tries < 30) {
      await sleep(page, 400);
      const next = await grab(page, `${tag}-${scene}-card`);
      const d = await compare(context, prev.buf, next.buf, DIFF, null);
      still = d.outside === 0 ? still + 1 : 0; prev = next; tries++;
    }
    shots[`${scene}-card`] = prev;
    await page.locator('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
    await sleep(page, 1200);
    // the under-bar label is item 1 (script, not style): mask it out of the comparison by reading its box
    shots[`${scene}-closed`] = await grab(page, `${tag}-${scene}-closed`);
  }
  return shots;
}

export default async ({ page, context }) => {
  const landscape = process.env.RV_MODE === 'landscape';
  const now = await scenario(page, context, 'now');
  await page.route('**/styles/hud.css', (route) => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: readFileSync(`${SNAP}/styles/hud.css`) }));
  await page.route('**/styles/buddy.css', (route) => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: readFileSync(`${SNAP}/styles/buddy.css`) }));
  await page.reload({ waitUntil: 'load' });
  const served = await page.evaluate(async () => { const t = await (await fetch('../styles/buddy.css', { cache: 'no-store' })).text(); return t.includes('9% at 50% 95.5%'); });
  const old = await scenario(page, context, 'old');
  const fails = [], out = {};
  if (!served) fails.push('the reviewed stylesheets were not served');
  for (const key of Object.keys(now)) {
    const d = await compare(context, now[key].buf, old[key].buf, DIFF, null);
    out[key] = { differ: d.outside, box: d.box };
    if (!landscape && d.outside) fails.push(`${key}: ${d.outside} px differ between the reviewed stylesheets and now (box ${JSON.stringify(d.box)})`);
  }
  note('RV before-after', out);
  if (landscape && !(out['win-card'].differ > 0 && out.game.differ > 0)) fails.push('landscape: the comparison sees no difference, so it proves nothing');
  save('before-after.json', out);
  note('RV-RESULT', fails.length ? fails : 'ok');
  if (fails.length) throw new Error(fails.join(' | '));
};
