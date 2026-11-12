import { readFileSync, writeFileSync } from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/styles/layout.css';
let s = readFileSync(p, 'utf8');
const rep = (a, b, count) => { const n = s.split(a).length - 1; if (n !== count) throw new Error(`expected ${count}, found ${n}: ${a.slice(0, 70)}`); s = s.split(a).join(b); };
// chips placeholder only when computeLayout would show chips
rep('--_ph-btn-h: 48px; --_ph-chip-h: 48px; --_ph-undo-w: 120px; --_ph-tools: block;\n  --_ph-buddy: "bubble"', '--_ph-btn-h: 48px; --_ph-chip-h: 48px; --_ph-chips: none; --_ph-undo-w: 120px; --_ph-tools: block;\n  --_ph-buddy: "bubble"', 1);
rep('--_ph-btn-h: 48px; --_ph-chip-h: 48px; --_ph-undo-w: 120px; --_ph-tools: block;', '--_ph-btn-h: 48px; --_ph-chip-h: 48px; --_ph-undo-w: 120px; --_ph-tools: block;\n  --_ph-chips: max(0px, (var(--_h) - var(--top) - var(--bar) - var(--actions) - 20px - var(--board-h) - 149.5px) * 9999);', 2);
rep('--_ph-btn-h: 44px; --_ph-chip-h: 36px; --_ph-undo-w: 100%; --_ph-tools: none;', '--_ph-btn-h: 44px; --_ph-chip-h: 36px; --_ph-undo-w: 100%; --_ph-tools: none;\n  --_ph-chips: max(0px, (var(--_h) - var(--top) - var(--bar) - 12px - var(--board-h) - 123.5px) * 9999);', 2);
// the copies inside @media are indented by four spaces
s = s.replace(/\n    (--_ph-btn-h: 4[48]px; [^\n]*)\n  --_ph-chips:/g, '\n    $1\n    --_ph-chips:');
rep('  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 8px; overflow: hidden;\n', '  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 8px; overflow: hidden;\n  max-height: var(--_ph-chips);                 /* 0 when computeLayout would hide the chips (showChips) */\n', 1);
// grid: at least one pixel per line, and an explicit last horizontal line
rep('  --t: calc(.03 * var(--k));', '  --t: max(1px, .03 * var(--k));', 1);
rep(`  background-image:
    linear-gradient(var(--line), var(--line)),
    linear-gradient(var(--line), var(--line)),
`, `  background-image:
    linear-gradient(var(--line), var(--line)),
    linear-gradient(var(--line), var(--line)),
    linear-gradient(var(--line), var(--line)),
`, 1);
rep(`  background-size:
    var(--t) calc(100% - var(--t) / 2),
    var(--t) calc(100% - var(--t) / 2),
`, `  background-size:
    var(--t) 100%,
    var(--t) 100%,
    100% var(--t),
`, 1);
rep(`  background-position:
    left top,
    right top,
`, `  background-position:
    left top,
    right top,
    left bottom,
`, 1);
writeFileSync(p, s);
