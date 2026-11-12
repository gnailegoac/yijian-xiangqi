export default async ({ page, shot }) => {
  await page.waitForTimeout(500);
  // dismiss any start overlay if present by setting phase via dev controls is unknown; just show the top bar as-is
  await shot('calm');
  await page.evaluate(() => {
    const say = document.querySelector('.rival__say');
    const line = document.querySelector('.rival__line');
    const root = document.querySelector('.rival');
    if (!say) return;
    line.textContent = '此局是我输了。';
    say.hidden = false;
    root.dataset.mood = 'smug'; root.dataset.say = 'line';
  });
  await page.waitForTimeout(200);
  await shot('say');
  const info = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { rival: r('.rival'), disc: r('.rival__disc'), plate: r('.rival__plate'), say: r('.rival__say'), info: r('.hud-top__info'), mute: r('#mute-button'), menu: r('#menu-button'), topbar: r('#topbar'), board: r('#board'), stage: r('#stage') };
  });
  console.log(JSON.stringify(info));
};
