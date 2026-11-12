const fs = require('fs');
let s = fs.readFileSync('browser.mjs', 'utf8');
const a = `      const hb = await page.locator('#history-button').boundingBox();
      if (hb) await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2);
      else { const bb = await centre(page, '.bubble'); await page.touchscreen.tap(bb.x, bb.y); }
      await sleep(700);`;
if (!s.includes(a)) throw new Error('anchor');
s = s.replace(a, `      const hb = await page.locator('#history-button').boundingBox();
      if (hb) await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2);
      else await page.evaluate(() => document.querySelector('.bubble').dispatchEvent(new CustomEvent('bubble:expand', { bubbles: true })));   // the phone has no 回看 button outside the sheet
      await sleep(900);`);
fs.writeFileSync('browser.mjs', s);
console.log('browser.mjs fixed');
