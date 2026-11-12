import fs from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/styles/buddy.css';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };
rep(`.bubble[data-empty="1"] { visibility: hidden; pointer-events: none; }
`, `.bubble[data-empty="1"] { visibility: hidden; pointer-events: none; }

/* overflow clips at the padding edge: two strips of the surface cover the paddings, so a line that does not fit
 * never peeks into them */
.bubble::before {
  content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; border-radius: inherit;
  background:
    linear-gradient(var(--surface), var(--surface)) top / 100% var(--_pad-y) no-repeat,
    linear-gradient(var(--surface), var(--surface)) bottom / 100% var(--_pad-y) no-repeat;
}
`);
rep(`/* stacked above the full figure: it rests just over his head and reaches to the right edge of the column */
.buddy-box[data-variant="full"] .bubble { align-self: end; justify-self: stretch; margin-left: calc(var(--_fig-h) * .2); }`,
`/* stacked above the full figure: it rests just over his head and grows toward the right edge of the column */
.buddy-box[data-variant="full"] .bubble {
  align-self: end; justify-self: start;
  margin-left: calc(var(--_fig-h) * .2);
  min-width: calc(var(--_inset) + var(--_fig-h) * .2 + 40px);          /* always wide enough to carry the tail */
}`);
rep(`[data-kb="1"] .bubble { display: flex; flex-direction: column; justify-content: flex-end; }`,
    `[data-kb="1"] .bubble { display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; }
[data-kb="1"] .bubble :is(.bubble__tag, .bubble__question) { display: none; }`);
rep(`  white-space: nowrap;
  transform: rotate(-2deg); transform-origin: 20% 80%;`, `  white-space: nowrap;
  position: relative; z-index: 2;
  transform: rotate(-2deg); transform-origin: 20% 80%;`);
fs.writeFileSync(p, s);
console.log('ok');
