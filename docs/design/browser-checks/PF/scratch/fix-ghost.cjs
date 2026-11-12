const fs = require('fs');
let s = fs.readFileSync('pf-browser.mjs', 'utf8');
const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error('anchor ' + a.slice(0, 50)); s = s.replace(a, b); };
rep("        await tapSel(page, '.chip[data-ask=\"reply\"]');\n        const frames = [];",
    "        const asked = await page.evaluate(() => { const c = document.querySelector('.chip[data-ask=\"reply\"]') ?? document.querySelector('.chip[data-ask=\"show\"]'); return c ? c.dataset.ask : null; });\n        await tapSel(page, `.chip[data-ask=\"${asked}\"]`);\n        const frames = [];");
rep("            const g = document.querySelector('.bv-counter, .bv-step');\n            if (!g) return null;",
    "            const g = [...document.querySelectorAll('.bv-counter, .piece__tag--step')].find((el) => el.getBoundingClientRect().width > 0);\n            if (!g) return null;");
fs.writeFileSync('pf-browser.mjs', s);
