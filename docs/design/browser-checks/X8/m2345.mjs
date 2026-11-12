// moments 2 (zero-wait touch), 3 (face before words), 4 (the find), 5 (mate; loss)
import { recorder } from './rec.mjs';
import { execFileSync } from 'node:child_process';
const DIR = 'C:/Users/USERNAME/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X8';
const sheet = (name, files, cols = 4) => execFileSync('node', [`${DIR}/montage.mjs`, `${DIR}/${name}.png`, String(cols), ...files], { env: { ...process.env, FRAME_W: '590' } });
export default async ({ page }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const D = (fn, arg) => page.evaluate(fn, arg);
  const which = process.env.MOMENT ?? '2345';
  const tag = process.env.TAG ?? '';
  // real taps on the real board cells (touch), so nothing of the path is skipped
  const cell = async (row, col) => {
    const box = await page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const tap = async (row, col) => { const p = await cell(row, col); await page.touchscreen.tap(p.x, p.y); };

  if (which.includes('2')) {
    const rec = await recorder(page, `${DIR}/frames`, `m2${tag}`);
    await D(() => window.__dev.startScene('opening'));
    await w(900);
    await rec.start();
    await w(100);
    await tap(9, 7);                                        // lift under the finger
    await w(420);
    await tap(7, 6);                                        // hover with the 试 tag
    await w(900);
    await tap(7, 6);                                        // a second tap stamps it down
    await w(900);
    const r = await rec.stop([80, 140, 200, 300, 480, 560, 640, 760, 900, 1300, 1460, 1540, 1620, 1720, 1900, 2300]);
    console.error('m2', JSON.stringify({ frames: r.count, span: r.span }));
    sheet(`m2${tag}-touch`, r.files);
  }
  if (which.includes('3')) {
    const rec = await recorder(page, `${DIR}/frames`, `m3${tag}`);
    await D(() => window.__dev.startScene('opening'));
    await w(900);
    await tap(7, 7);
    await w(500);
    // when does the face change, measured in the page: mood right before the tap, then per frame
    await D(() => {
      const buddy = document.querySelector('#buddy svg.buddy');
      window.__moods = [];
      const t0 = performance.now();
      window.__moodT0 = t0;
      const tick = () => { window.__moods.push([Math.round(performance.now() - window.__moodT0), buddy.dataset.mood, document.querySelector('#app').dataset.phase]); if (performance.now() - t0 < 1500) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      document.querySelector('#board').addEventListener('board:pick', () => { window.__moodT0 = performance.now(); window.__moods.push(['PICK']); }, { once: true, capture: true });
    });
    await rec.start();
    await w(100);
    await tap(7, 4);
    await w(1300);
    const r = await rec.stop([60, 120, 160, 200, 240, 280, 340, 420, 520, 700, 1000, 1300]);
    const moods = await D(() => window.__moods);
    const i = moods.findIndex((m) => m[0] === 'PICK');
    const after = moods.slice(i + 1);
    const firstChange = after.find((m) => m[1] !== moods[Math.max(0, i - 1)][1]);
    console.error('m3', JSON.stringify({ frames: r.count, before: moods[Math.max(0, i - 1)], firstChange, phaseAt: after.find((m) => m[2] === 'tentative') }));
    sheet(`m3${tag}-face`, r.files);
  }
  if (which.includes('4')) {
    const rec = await recorder(page, `${DIR}/frames`, `m4${tag}`);
    await D(() => window.__dev.moment.find());
    await w(2600);
    await rec.start();
    await w(100);
    await D(() => window.__dev.act.confirm());
    await w(4200);
    const r = await rec.stop([100, 250, 400, 550, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2400, 2800, 3300, 4000]);
    console.error('m4', JSON.stringify({ frames: r.count, span: r.span }));
    sheet(`m4${tag}-find`, r.files);
  }
  if (which.includes('5')) {
    const rec = await recorder(page, `${DIR}/frames`, `m5${tag}`);
    await D(() => window.__dev.moment.mate());
    await w(2600);
    await rec.start();
    await w(100);
    await D(() => window.__dev.act.confirm());
    await w(14500);
    const r = await rec.stop([150, 300, 450, 600, 800, 1100, 1500, 1900, 2500, 3200, 4000, 5000, 6000, 6800, 7600, 8400, 9300, 10300, 11500, 14000]);
    console.error('m5', JSON.stringify({ frames: r.count, span: r.span }));
    sheet(`m5${tag}-mate`, r.files, 5);
  }
  if (which.includes('6')) {
    const rec = await recorder(page, `${DIR}/frames`, `m6${tag}`);
    await D(() => window.__dev.moment.loss());
    await w(1800);
    await D(() => window.__dev.act.confirm());
    await rec.start();
    await w(11500);
    const r = await rec.stop([300, 900, 1300, 1700, 2100, 2500, 3000, 3600, 4200, 4800, 5400, 6000, 6800, 7600, 8600, 10500]);
    console.error('m6', JSON.stringify({ frames: r.count, span: r.span }));
    sheet(`m6${tag}-loss`, r.files);
  }
};
