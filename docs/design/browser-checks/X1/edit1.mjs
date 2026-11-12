import { readFileSync, writeFileSync } from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/styles/layout.css';
let s = readFileSync(p, 'utf8');
const rep = (a, b, all = false) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = all ? s.split(a).join(b) : s.replace(a, b); };
// coach padding per mode
rep('--_stage-pad: 8px; --_stage-bleed: 0px;', '--_stage-pad: 8px; --_stage-bleed: 0px; --_coach-pad: 8px 0;');
rep('    --_stage-pad: 4px;\n', '    --_stage-pad: 4px; --_coach-pad: 4px 0;\n');
rep('--_stage-pad: 0px; --_stage-bleed: 0px;', '--_stage-pad: 0px; --_stage-bleed: 0px; --_coach-pad: 0;', true);
rep('--_stage-pad: 0px; --_stage-bleed: -4px;', '--_stage-pad: 0px; --_stage-bleed: -4px; --_coach-pad: 0 0 6px;', true);
rep('  padding-block: var(--_stage-pad);\n}\n.coach__buddy', '  padding: var(--_coach-pad);\n}\n.coach__buddy');
// grid: lines end in the middle of the line they meet, so rounding never leaves a stub
rep(`    var(--t) 100%,
    var(--t) 100%,
    calc(2 * var(--k)) calc(2 * var(--k)),
    calc(2 * var(--k)) calc(2 * var(--k)),
    calc(2 * var(--k)) calc(2 * var(--k)),
    calc(2 * var(--k)) calc(2 * var(--k)),
    100% calc(4.03 * var(--k)),
    100% calc(4.03 * var(--k)),
    100% 100%,
    100% var(--k);`, `    var(--t) calc(100% - var(--t) / 2),
    var(--t) calc(100% - var(--t) / 2),
    calc(2 * var(--k)) calc(2 * var(--k)),
    calc(2 * var(--k)) calc(2 * var(--k)),
    calc(2 * var(--k)) calc(2 * var(--k)),
    calc(2 * var(--k)) calc(2 * var(--k)),
    100% calc(4.015 * var(--k)),
    100% calc(4.015 * var(--k)),
    calc(100% - var(--t) / 2) 100%,
    100% var(--k);`);
rep(`    left top,
    left bottom,
    left top,
    left calc(4.015 * var(--k));`, `    left top,
    left calc(5 * var(--k)),
    left top,
    left calc(4.015 * var(--k));`);
// placeholder colours: boxes are --surface with an --edge outline, small solid marks are --edge
rep(`    radial-gradient(circle closest-side, var(--surface-2) 94%, transparent) 56px 50% / calc(var(--top) - 8px) calc(var(--top) - 8px) no-repeat,
    linear-gradient(var(--surface-2), var(--surface-2)) calc(56px + var(--top)) calc(50% - 8px) / 64px 10px no-repeat,
    linear-gradient(var(--surface), var(--surface)) calc(56px + var(--top)) calc(50% + 8px) / 96px 8px no-repeat;`,
`    radial-gradient(circle closest-side, var(--edge) 94%, transparent) 56px 50% / calc(var(--top) - 8px) calc(var(--top) - 8px) no-repeat,
    linear-gradient(var(--edge), var(--edge)) calc(56px + var(--top)) calc(50% - 8px) / 64px 10px no-repeat,
    linear-gradient(var(--edge), var(--edge)) calc(56px + var(--top)) calc(50% + 8px) / 96px 6px no-repeat;`);
rep(`border: 1px solid var(--edge); border-radius: var(--r-btn); background: var(--surface-2);
}
.underbar:empty::after {
  content: ""; flex: none; display: var(--_ph-tools); width: 112px; height: 10px; border-radius: 5px; background: var(--surface);`,
`border: 1px solid var(--edge); border-radius: var(--r-btn); background: var(--surface);
}
.underbar:empty::after {
  content: ""; flex: none; display: var(--_ph-tools); width: 112px; height: 8px; border-radius: 4px; background: var(--edge);`);
rep(`  border: 1.5px solid color-mix(in srgb, var(--accent) 60%, var(--surface-2)); border-radius: var(--r-btn);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
  box-shadow: 0 3px 0 color-mix(in srgb, var(--accent) 34%, var(--page));`,
`  border: 1.5px solid color-mix(in srgb, var(--accent) 60%, var(--surface)); border-radius: var(--r-btn);
  background: color-mix(in srgb, var(--accent) 16%, var(--surface));
  box-shadow: 0 3px 0 color-mix(in srgb, var(--accent) 36%, var(--page));`);
rep(`  background: linear-gradient(var(--surface-2), var(--surface));`, `  background: var(--surface);`);
const i = s.indexOf('.coach__chat:empty::before {');
s = s.slice(0, i) + `.coach__chat:empty::before {
  content: ""; flex: none; width: 104px; height: var(--_ph-chip-h); margin: 1px 225px 1px 1px;
  border-radius: calc(var(--_ph-chip-h) / 2);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--edge), 112px 0 0 var(--surface), 112px 0 0 1px var(--edge), 224px 0 0 var(--surface), 224px 0 0 1px var(--edge);
}
.coach__chat:empty::after {
  content: ""; flex: none; display: var(--_ph-tools); width: 44px; height: 44px; margin: 1px 53px 1px auto;
  border-radius: 12px; background: var(--surface);
  box-shadow: 0 0 0 1px var(--edge), 52px 0 0 var(--surface), 52px 0 0 1px var(--edge);
}
`;
writeFileSync(p, s.replace(/\r\n/g, '\n'));
