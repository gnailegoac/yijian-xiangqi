import fs from 'node:fs';
const p = 'steps-tests.mjs';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };
rep("      b.bubble.markStale('已换一步');\n      const label = root.querySelector('.bubble__stale');",
    "      await sleep(260);                                             // the tag has popped in\n      b.bubble.markStale('已换一步');\n      const label = root.querySelector('.bubble__stale');");
rep("      eq([getComputedStyle(root).fontSize, getComputedStyle(root).lineHeight, getComputedStyle(root).paddingLeft, getComputedStyle(root).paddingTop, getComputedStyle(root).borderTopWidth, getComputedStyle(root).borderTopLeftRadius],\n        ['18px', '26px', '14px', '10px', '1.5px', '16px'], 'bubble type and shape');",
    "      // the border is read from the rule: headless Chrome with an emulated device scale snaps the computed 1.5 px to 1 px\n      const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((x) => x.selectorText === '.bubble');\n      eq([getComputedStyle(root).fontSize, getComputedStyle(root).lineHeight, getComputedStyle(root).paddingLeft, getComputedStyle(root).paddingTop, rule.style.borderTopWidth, getComputedStyle(root).borderTopLeftRadius],\n        ['18px', '26px', '14px', '10px', '1.5px', '16px'], 'bubble type and shape');");
fs.writeFileSync(p, s);
console.log('ok');
