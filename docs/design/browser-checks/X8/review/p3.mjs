// probe: does the mouth keep moving when a streaming reply is cut by a trial switch / a retract by tap (no settle)?
export default async ({ page }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const out = await page.evaluate(async () => {
    const d = window.__dev, s = d.real;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.stop(); s.settle();
    s.on({});
    const b = d.G.board;
    const mv = (fr, fc, tr, tc) => ({ from: { row: fr, col: fc }, to: { row: tr, col: tc }, piece: b[fr][fc], captured: b[tr][tc] });
    const flapping = async () => { const seen = new Set(); for (let i = 0; i < 12; i++) { seen.add(document.querySelector('#buddy svg.buddy').dataset.mouth); await sleep(60); } return seen.size > 1; };
    await sleep(1500);
    const res = {};
    // a trial with a streaming reply
    await s.tentative(mv(9, 7, 7, 6), { notation: '马二进三', aim: false });
    s.verdict({ cat: 'good', final: true, held: false, voiced: false, earned: false, focus: [] });
    s.coachBegin({ id: 'x1', kind: 'try', cue: null });
    s.coachSegment('x1', { type: 'text', text: '这一步把马跳出来，' });
    await sleep(700);
    res.whileStreaming = await flapping();
    // the child taps another target: the reply is aborted silently, the new trial gets a nod and no text
    await s.tentative(mv(9, 7, 7, 8), { notation: '马二进一', aim: false });
    s.verdict({ cat: 'ok', final: true, held: false, voiced: false, earned: false, focus: [] });
    await sleep(900);
    res.afterSwitch = await flapping();
    // again, then a retract by tapping the origin (no settle)
    s.coachBegin({ id: 'x2', kind: 'try', cue: null });
    s.coachSegment('x2', { type: 'text', text: '边马不太好，' });
    await sleep(500);
    await s.retracted({ reselect: true, targets: [], forbidden: [] });
    await sleep(900);
    res.afterRetract = await flapping();
    return res;
  });
  console.error(JSON.stringify(out));
};
