// C1 on the real page (verifier). Scenario A with finger taps only:
//   mode 'pre'   : while 司马懿 thinks the child taps the horse once, then taps the destination every <gap> ms
//   mode 'after' : the child waits for his move, then taps the horse and <gap> ms later the destination (no pre-selection)
// Printed: what the bubble, the log and the send button show at 1 s, 4 s, 8 s and 27 s after the trial, then after 换一步 / confirm.
import { launch, openGame, finger, game, look, bubbleStr, logStr, playCannon, sleep } from './cv-browser.mjs';

const { browser, stop } = await launch(280000);
const runs = [['pre', 140, 'no-preference'], ['pre', 300, 'reduce'], ['after', 120, 'no-preference'], ['after', 350, 'no-preference']];
try {
  for (const [mode, gap, motion] of runs) {
    const { context, page, requests, errors } = await openGame(browser, { chunkMs: 300, motion });
    await sleep(3000);
    await playCannon(page);
    const before = requests.length;
    let taps = 0;
    if (mode === 'pre') {
      await finger(page, 9, 7);
      const t0 = Date.now();
      while ((await game(page)).phase !== 'tentative' && Date.now() - t0 < 15000) { await finger(page, 7, 6); taps++; await sleep(gap); }
    } else {
      await page.waitForFunction(() => window.__yijian.session.getState().history.length >= 2, null, { timeout: 15000, polling: 10 });
      await finger(page, 9, 7); await sleep(gap); await finger(page, 7, 6); taps = 1;
      await page.waitForFunction(() => window.__yijian.session.getState().phase === 'tentative', null, { timeout: 3000 }).catch(() => {});
    }
    const g = await game(page);
    const tTrial = Date.now();
    console.log(`\n== ${mode} gap=${gap} motion=${motion}: ${taps} target taps -> ${JSON.stringify(g)}`);
    for (const at of [1000, 4000, 8000, 27000]) {
      await sleep(Math.max(0, tTrial + at - Date.now()));
      const v = await look(page);
      console.log(`  +${at / 1000}s ${bubbleStr(v)} | send=${v.send} | log: ${logStr(v, 3)}`);
      if (at === 1000 && !(v.log.some((m) => m.kind === 'opp' && m.state === 'streaming'))) break;      // not the stuck case: no need to wait
    }
    console.log(`  requests of the turn: [${requests.slice(before).map((r) => r.kinds).join(' | ')}]  page errors: ${errors.length}`);
    await finger(page, 7, 6);                                // confirm by tapping the destination again
    await sleep(600);
    const v = await look(page);
    console.log(`  after confirm (${JSON.stringify(await game(page))}): ${bubbleStr(v)} | send=${v.send} | opp lines in the log: ${v.log.filter((m) => m.kind === 'opp').map((m) => m.state + ':' + JSON.stringify(m.text)).join(' ; ') || '(none)'}`);
    await context.close();
  }
} catch (e) {
  console.log('PROBE ERROR', e && e.message ? e.message.split('\n').slice(0, 5).join(' / ') : e);
} finally {
  await stop();
}
