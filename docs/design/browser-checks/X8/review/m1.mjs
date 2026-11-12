// moment 1: the child's own capture (aim, confirm, the cannon's arc, boom, hit-stop and shake)
import { recorder } from './rec.mjs';
import { execFileSync } from 'node:child_process';
const DIR = 'C:/Users/USERNAME/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X8/review';
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const rec = await recorder(page, `${DIR}/frames`, 'm1');
  await page.evaluate(() => window.__dev.moment.capture());
  await w(2400);                                         // aim locked, verdict, comment
  await rec.start();
  await w(120);
  await page.evaluate(() => window.__dev.act.confirm());
  await w(2600);
  const r = await rec.stop([100, 180, 260, 330, 400, 470, 540, 620, 700, 800, 900, 1050, 1250, 1500, 1900, 2400]);
  console.error(JSON.stringify({ frames: r.count, span: r.span }));
  execFileSync('node', [`${DIR}/montage.mjs`, `${DIR}/m1-capture.png`, '4', ...r.files], { env: { ...process.env, FRAME_W: '590' } });
};
