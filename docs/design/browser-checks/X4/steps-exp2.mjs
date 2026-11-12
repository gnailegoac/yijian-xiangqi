import { LAB } from './lab.mjs';
export default async ({ page }) => {
  await page.addScriptTag({ content: LAB });
  const out = await page.evaluate(async () => {
    const { render, stats } = await window.lab();
    const mixes = {
      'R1 rook takes rook + check (T=1)': [['capture', { scale: 1.25 }, 0], ['move.rook', { ms: 40 }, 0], ['trial.confirm', {}, 0.04], ['check.give', {}, 0.22]],
      'R2 cannon shot mate (T=1)': [['cannon.fire', {}, 0], ['blast', {}, 0.2], ['trial.confirm', {}, 0.56], ['win', {}, 0.7]],
      'R3 find: confirm + stamp + brilliant (T=.7)': [['trial.confirm', {}, 0], ['stamp', {}, 0.2], ['praise.brilliant', {}, 0.2]],
      'R4 rival cannon takes + check.take (T=1)': [['cannon.fire', {}, 0], ['blast', {}, 0.2], ['place', {}, 0.56], ['check.take', {}, 0.6]],
      'R5 king takes + confirm + win same instant (T=1)': [['capture', { scale: 1.4 }, 0], ['move.king', { ms: 0 }, 0], ['trial.confirm', {}, 0], ['win', {}, 0]],
      'R6 blast + confirm + check.give same instant (T=1)': [['blast', {}, 0], ['trial.confirm', {}, 0], ['check.give', {}, 0]],
      'P five stingers same instant (T=1)': [['win', {}, 0], ['capture', { scale: 1.4 }, 0], ['move.king', { ms: 0 }, 0], ['blast', {}, 0], ['trial.confirm', {}, 0]],
    };
    const res = {};
    for (const [label, list] of Object.entries(mixes)) {
      const T = label.includes('T=.7') ? 0.7 : 1;
      let worst = -Infinity; const all = [];
      for (const palette of ['chibi', 'shachang']) for (const at of [1.0, 1.05, 1.0537, 1.31, 2.0]) {
        const r = await render({ seconds: 5.5, palette, stepped: true, job: a => { a.setTension(T); a.music.start(); for (const [n, o, dt] of list) a.play(n, { ...o, when: at - 0.005 + dt }); } });
        const s = stats(r.buffer); all.push(s.peak); worst = Math.max(worst, s.peak);
      }
      res[label] = { worst, all: all.join(' ') };
    }
    // the same stacks without music
    for (const [label, list] of Object.entries(mixes)) {
      let worst = -Infinity;
      for (const at of [0.05, 0.0537]) {
        const r = await render({ seconds: 4.5, job: a => { for (const [n, o, dt] of list) a.play(n, { ...o, when: at - 0.005 + dt }); } });
        worst = Math.max(worst, stats(r.buffer).peak);
      }
      res[label].dry = worst;
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
};
