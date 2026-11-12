// Renders thinking / worried / cheering with the contract's rig values, the tolerance extreme, and the shipped value.
import path from 'node:path';
export default async ({ page }) => {
  const out = process.env.RV_OUT;
  await page.addStyleTag({ content: '.bar { position: static !important; } #cmp { display:flex; flex-wrap:wrap; gap:8px; padding:8px; } #cmp .card{ width:270px } #cmp .card__full{overflow:visible}' });
  await page.evaluate(async () => {
    const { createBuddy } = await import('../src/ui/buddy.js');
    const cmp = document.createElement('div');
    cmp.id = 'cmp';
    document.querySelector('main').prepend(cmp);
    const cases = [
      ['thinking', 'contract 28', { '--fan-rot': '28deg', '--arm-l': '14deg' }],
      ['thinking', 'tol 22', { '--fan-rot': '22deg' }],
      ['thinking', 'shipped', {}],
      ['worried', 'contract 172/-6', { '--fan-rot': '172deg', '--arm-r': '-6deg', '--arm-l': '14deg' }],
      ['worried', 'tol 166/-12', { '--fan-rot': '166deg', '--arm-r': '-12deg' }],
      ['worried', 'shipped', {}],
      ['cheering', 'contract 175/-150', { '--fan-rot': '175deg', '--arm-r': '-150deg' }],
      ['cheering', 'tol 181/-144', { '--fan-rot': '181deg', '--arm-r': '-144deg' }],
      ['cheering', 'shipped', {}],
      ['listening', 'contract -5', { '--tilt': '-5deg', '--brow-y': '-1.5px', '--arm-l': '14deg' }],
      ['listening', 'shipped', {}],
      ['idle', 'shipped', {}],
    ];
    for (const [mood, label, over] of cases) {
      const card = document.createElement('div');
      card.className = 'card';
      const full = document.createElement('div');
      full.className = 'card__full';
      const row = document.createElement('div');
      row.className = 'card__row';
      const bust = document.createElement('div');
      bust.className = 'card__bust';
      const name = document.createElement('div');
      name.textContent = `${mood} · ${label}`;
      row.append(bust, name);
      card.append(full, row);
      cmp.append(card);
      for (const [h, v] of [[full, 'full'], [bust, 'bust']]) {
        const b = createBuddy(h, { variant: v, reducedMotion: true });
        b.setMood(mood, { instant: true });
        const svg = h.querySelector('svg.buddy');
        for (const [k, val] of Object.entries(over)) svg.style.setProperty(k, val);
        h.querySelector('.bubble').style.display = 'none';
        h.style.display = 'block';
      }
    }
  });
  await page.waitForTimeout(300);
  await page.locator('#cmp').screenshot({ path: path.join(out, 'cmp.png') });
};
