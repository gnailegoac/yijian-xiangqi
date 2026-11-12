const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/ui/board-view.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 90)); s = s.replace(a, b); };
rep(`    const o = { actor: 'me', mult: 0.85, flags: opts.flags, soft: !!opts.soft, lead: 0, confirm: true, cap: 700 };
    rec.el.style.removeProperty('--hover-delay');
    if (t.aim) {`, `    const o = { actor: 'me', mult: 0.85, flags: opts.flags, soft: !!opts.soft, lead: 0, confirm: true, cap: 700 };
    if (t.aim) {`);
rep(`    const restyle = () => { rec.el.classList.remove('is-trial', 'is-pressed', 'is-selected', 'is-hover'); };
    const ring = t.ring;`, `    const restyle = () => {
      rec.el.classList.remove('is-trial', 'is-pressed', 'is-selected', 'is-hover');
      rec.el.style.removeProperty('--hover-delay');
    };
    const ring = t.ring;`);
rep(`  /** Fades a node out and removes it; with ms = 0 or reduced motion it is removed at once. @param {Element} node @param {number} ms */`,
    `  /** Fades a node out and removes it; with ms = 0 it is removed at once (callers pass 0 under reduced motion). @param {Element} node @param {number} ms */`);
fs.writeFileSync(p, s);
