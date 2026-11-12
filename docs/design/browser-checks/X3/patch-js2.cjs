const fs = require('fs');
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); return s.replace(a, b); };
let f = 'C:/Users/USERNAME/git/yijian-xiangqi/src/ui/fx.js'; let s = fs.readFileSync(f, 'utf8');
s = rep(s, `              kick();
            }
            if (tone === 'danger') flash('--danger', 120);
          };`, `              kick();
            }
          };`);
s = rep(s, ` * from the left + fade. Times in ms; \`still\` is the hold under reduced motion (fade 150 / hold / fade 150).`,
 ` * from the left + fade. Times in ms; \`still\` is the hold under reduced motion (fade 150 / hold / fade 150).
 * The "extras" of the table in §10.4.4 (sounds, haptics, the red flash of a check the child receives) belong to the
 * caller, like every sound that goes with fx: board-view plays them at the moment it calls banner().`);
fs.writeFileSync(f, s);

f = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/fx.html'; s = fs.readFileSync(f, 'utf8');
s = rep(s, `['将军！ 被将', "check · danger", () => fx.banner('check', { tone: 'danger', avoid: king.bottom() })],`,
 `['将军！ 被将', "check · danger", () => { fx.flash('--danger', 120); return fx.banner('check', { tone: 'danger', avoid: king.bottom() }); }],`);
fs.writeFileSync(f, s);

f = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X3/verify.mjs'; s = fs.readFileSync(f, 'utf8');
s = rep(s, `check('G check slam: nothing before landing; on landing shake(2), 16 sparks and (danger) the red flash', slam.before.live === 0 && slam.before.shake === 0 && slam.after.live === 16 && slam.after.shake === 1 && slam.after.flash > 0 && slam.after.flashBg === 'rgb(255, 107, 94)', JSON.stringify(slam));`,
 `check('G check slam: nothing before landing; on landing shake(2) and 16 sparks (the flash, sounds and haptics are the caller\'s)', slam.before.live === 0 && slam.before.shake === 0 && slam.after.live === 16 && slam.after.shake === 1 && slam.after.flash === 0, JSON.stringify(slam));`);
fs.writeFileSync(f, s);
