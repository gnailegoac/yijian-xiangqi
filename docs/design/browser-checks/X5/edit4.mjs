import fs from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/styles/buddy.css';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };

// host variables
rep(`  --_fig-h: var(--buddy-h, 240px);
}`, `  --_fig-h: var(--buddy-h, 240px);
  --_gap: 14px;                    /* between the bust and the bubble */
  --_inset: 0px;                   /* the figure's distance from the left edge */
  --_lh: 26px;                     /* the bubble's line height: its height is always a whole number of lines */
  --_pad-y: 10px;
}
[data-layout="compact"] .buddy-box { --_gap: 6px; --_lh: 22px; --_pad-y: 6px; }
/* Landscape: his fan side faces the board on the left; this inset keeps a raised fan inside the coach column. */
[data-layout="landscape"] .buddy-box[data-variant="full"] { --_inset: calc(var(--_fig-h) * .07); }`);
rep(`  grid-template: "figure bubble" minmax(0, 1fr) / auto minmax(0, 1fr);
  column-gap: 14px;
  align-items: center;
}
[data-layout="compact"] .buddy-box[data-variant="bust"] { column-gap: 8px; align-items: start; }`,
`  grid-template: "figure bubble" minmax(0, 1fr) / auto minmax(0, 1fr);
  column-gap: var(--_gap);
  align-items: center;
}
[data-layout="compact"] .buddy-box[data-variant="bust"] { align-items: start; }`);
rep(`  display: block; height: var(--_fig-h); aspect-ratio: 120 / 140;
  margin: 0; padding: 0;`, `  display: block; height: var(--_fig-h); aspect-ratio: 120 / 140;
  margin: 0 0 0 var(--_inset); padding: 0;`);
// backdrop
rep(`    radial-gradient(50% 50% at 50% 56%, color-mix(in srgb, var(--wei) 34%, transparent), transparent 100%);`,
    `    radial-gradient(50% 50% at 50% 56%, color-mix(in srgb, var(--wei) 26%, transparent), transparent 100%);`);
rep(`  background: radial-gradient(closest-side, color-mix(in srgb, var(--wei) 46%, transparent) 62%, transparent 100%);`,
    `  background: radial-gradient(closest-side, color-mix(in srgb, var(--wei) 36%, transparent) 62%, transparent 100%);`);
// bubble box
rep(`  box-sizing: border-box; min-width: 0; max-height: 100%;
  padding: 10px 14px;
  border: 1.5px solid var(--edge); border-radius: 16px;
  background: var(--surface); color: var(--ink);
  font-size: 18px; line-height: 26px;`,
`  box-sizing: border-box; min-width: 0;
  min-height: calc(var(--_lh) + 2 * var(--_pad-y) + 3px);
  max-height: 100%;
  max-height: calc(round(down, 100% - 2 * var(--_pad-y) - 3px, var(--_lh)) + 2 * var(--_pad-y) + 3px);     /* cut between lines, never through one */
  padding: var(--_pad-y) 14px;
  border: 1.5px solid var(--edge); border-radius: 16px;
  background: var(--surface); color: var(--ink);
  font-size: 18px; line-height: var(--_lh);`);
rep(`[data-layout="compact"] .bubble { font-size: 15px; line-height: 22px; }`,
    `[data-layout="compact"] .bubble { font-size: 15px; padding-inline: 12px; }      /* 3 lines of 17 characters at 360 px */`);
rep(`.buddy-box[data-variant="full"] .bubble { align-self: end; justify-self: stretch; margin-left: calc(var(--_fig-h) * .2); min-height: 49px; }
.buddy-box[data-variant="bust"] .bubble { align-self: center; justify-self: start; min-height: 49px; }
[data-layout="compact"] .buddy-box[data-variant="bust"] .bubble { align-self: start; min-height: 45px; }`,
`.buddy-box[data-variant="full"] .bubble { align-self: end; justify-self: stretch; margin-left: calc(var(--_fig-h) * .2); }
.buddy-box[data-variant="bust"] .bubble { align-self: center; justify-self: start; }
[data-layout="compact"] .buddy-box[data-variant="bust"] .bubble { align-self: start; }`);
rep(`  left: calc(var(--_fig-h) * .4); bottom: calc(var(--_fig-h) + 12px - 8px);`,
    `  left: calc(var(--_inset) + var(--_fig-h) * .4); bottom: calc(var(--_fig-h) + 12px - 8px);`);
rep(`  left: calc(var(--_fig-h) + 14px - 8px); top: calc(50% - 8px);`,
    `  left: calc(var(--_fig-h) + var(--_gap) - 8px); top: calc(50% - 8px);`);
rep(`  width: 12px; height: 12px; left: calc(var(--_fig-h) + 8px - 6px); top: 16px;`,
    `  width: 12px; height: 12px; left: calc(var(--_fig-h) + var(--_gap) - 6px); top: 14px;`);
// question: exactly one line high
rep(`  display: block; margin: 0 0 5px; padding: 0 0 4px;
  border-bottom: 1px dashed var(--edge);
  font-size: 13px; line-height: 18px; color: var(--ink-2);`,
`  display: block; box-sizing: border-box; height: var(--_lh); margin: 0; padding: 0;
  border-bottom: 1px dashed var(--edge);
  font-size: 13px; line-height: calc(var(--_lh) - 5px); color: var(--ink-2);`);
rep(`  font-family: var(--font-kai); font-weight: 700; font-size: 1em; line-height: 24px;`,
    `  font-family: var(--font-kai); font-weight: 700; font-size: 1em; line-height: calc(var(--_lh) - 2px);`);
rep(`[data-layout="compact"] .bubble__tag { line-height: 20px; padding: 0 7px; margin-right: 6px; }`,
    `[data-layout="compact"] .bubble__tag { padding: 0 7px; margin-right: 6px; }`);
rep(`.bubble__caption:not([hidden]) ~ .bubble__text:not(:empty) { display: block; margin-top: 2px; }`,
    `.bubble__caption:not([hidden]) ~ .bubble__text:not(:empty) { display: block; }`);
rep(`.bubble__dots { display: inline-flex; align-items: center; gap: 5px; height: 26px; vertical-align: bottom; padding: 0 2px; }
[data-layout="compact"] .bubble__dots { height: 22px; }`,
    `.bubble__dots { display: inline-flex; align-items: center; gap: 5px; height: var(--_lh); vertical-align: bottom; padding: 0 2px; }`);
fs.writeFileSync(p, s);

const d = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/buddy.html';
let h = fs.readFileSync(d, 'utf8').replace(/\r\n/g, '\n');
const rep2 = (a, b) => { if (!h.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); h = h.replace(a, b); };
rep2(`  .seg { display: inline-flex; border: 1px solid var(--edge); border-radius: 12px; overflow: hidden; }`,
     `  .seg { display: inline-flex; flex-wrap: wrap; max-width: 100%; border: 1px solid var(--edge); border-radius: 12px; overflow: hidden; }`);
rep2(`  main { max-width: 1180px; margin: 0 auto; padding: 0 16px; }`,
     `  main { max-width: 1180px; margin: 0 auto; padding: 0 16px; overflow-x: clip; }`);
fs.writeFileSync(d, h);
console.log('ok');
