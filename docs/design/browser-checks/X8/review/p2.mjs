// probes P2..P6
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  const D = (fn, arg) => page.evaluate(fn, arg);
  const out = {};
  // P2: undo while the rival thinks: do the dots stay on the plate?
  await D(() => window.__dev.startScene('opening'));
  await w(600);
  await D(() => window.__dev.act.move(7, 7, 7, 4));
  await w(700);
  await D(() => window.__dev.act.confirm());
  await w(250);
  out.p2_before = await D(() => [document.querySelector('.rival').dataset.mood, document.querySelector('#app').dataset.phase]);
  await D(() => window.__dev.act.undo());
  await w(900);
  out.p2_after = await D(() => [document.querySelector('.rival').dataset.mood, document.querySelector('.rival').dataset.say, document.querySelector('#app').dataset.phase]);
  await shot('p2-undo-dots');

  // P4: tension is stale after reset
  await D(() => { window.__dev.real.tension(0.95); });
  await w(900);
  out.p4_before = await D(() => getComputedStyle(document.querySelector('.bv')).getPropertyValue('--tension') + '|' + (document.querySelector('.bv-tension') ? getComputedStyle(document.querySelector('.bv-tension')).opacity : 'none'));
  await D(() => { const d = window.__dev; d.real.settle(); d.real.reset(d.viewOf(), { deal: false }); });
  await w(1000);
  out.p4_after = await D(() => getComputedStyle(document.querySelector('.bv')).getPropertyValue('--tension') + '|' + (document.querySelector('.bv-tension') ? getComputedStyle(document.querySelector('.bv-tension')).opacity : 'none'));

  // P11: a tap on a rival piece during a trial reaches handlers.tap
  await D(() => window.__dev.startScene('opening'));
  await w(500);
  await D(() => window.__dev.act.move(7, 7, 7, 4));
  await w(900);
  await D(() => { window.__dev.calls.length = 0; });
  const box = await page.locator('.board-cell[data-row="2"][data-col="1"]').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await w(200);
  out.p11 = await D(() => window.__dev.calls.filter((c) => c[0] === 'tap'));
  await D(() => window.__dev.act.retract());
  await w(400);

  // P6: over without settle, then phase(childTurn): does the over cue go on (replay / card)?
  await D(() => window.__dev.startScene('fork'));
  await w(600);
  await D(() => { const d = window.__dev; window.__p6 = d.raw.over('loss', 'checkmate'); });
  await w(600);
  await D(() => { const d = window.__dev; d.G.phase = 'childTurn'; d.real.phase({ phase: 'childTurn', canUndo: true, hintLevel: 0, canAsk: true, failed: false, ply: 0 }); });
  await w(6000);
  out.p6 = await D(() => ({ card: !!document.querySelector('dialog[data-dialog="over"]'), ribbon: !!document.querySelector('.stage-ribbon'), lost: document.querySelector('.bv').classList.contains('is-lost'),
    pieces: document.querySelectorAll('.piece[data-id]').length, interactive: document.querySelector('.board-cell').getAttribute('aria-disabled') }));
  await shot('p6-after');
  console.error(JSON.stringify(out, null, 1));
};
