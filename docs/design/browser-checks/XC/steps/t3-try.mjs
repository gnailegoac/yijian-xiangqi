// Candidate pools of light, side by side: for every entry of CANDIDATES the override CSS is injected, the feet are
// captured 4x, and the override is removed again. Run on dev/stage.html (running game) with ?motion=reduced.
import { note, zoomClip } from './lib.mjs';

const CANDIDATES = {
  now: '',
  a93x7: '#buddy .buddy-fig::before { background: radial-gradient(50% 7% at 50% 93%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 100%), radial-gradient(50% 44% at 50% 56%, color-mix(in srgb, var(--wei) 26%, transparent), transparent 100%) !important; }',
  b94x6: '#buddy .buddy-fig::before { background: radial-gradient(50% 6% at 50% 94%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 100%), radial-gradient(50% 44% at 50% 56%, color-mix(in srgb, var(--wei) 26%, transparent), transparent 100%) !important; }',
  c92x8: '#buddy .buddy-fig::before { background: radial-gradient(50% 8% at 50% 92%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 100%), radial-gradient(50% 44% at 50% 56%, color-mix(in srgb, var(--wei) 26%, transparent), transparent 100%) !important; }',
  mask: '#buddy .buddy-fig::before { -webkit-mask-image: linear-gradient(to bottom, #000 95.5%, transparent 100%); mask-image: linear-gradient(to bottom, #000 95.5%, transparent 100%); }',
};

export default async ({ page, context }) => {
  await page.waitForTimeout(Number(process.env.XC_WAIT ?? '3200'));
  const b = await page.evaluate(() => {
    const fig = document.querySelector('#buddy .buddy-fig');
    const f = fig.getBoundingClientRect();
    return { left: f.left, top: f.top, right: f.right, bottom: f.bottom, width: f.width, height: f.height };
  });
  const feet = { x: Math.max(0, b.left - b.width * 0.06 - 10), y: b.bottom - b.height * 0.32, width: b.width * 1.12 + 20, height: b.height * 0.32 + 44 };
  for (const [name, css] of Object.entries(CANDIDATES)) {
    if (css) await page.addStyleTag({ content: `${css} /* xc-try */` });
    await page.waitForTimeout(200);
    await zoomClip(page, context, `try-${name}`, feet, 4);
    await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('xc-try')) s.remove(); });
  }
  note('TRY', Object.keys(CANDIDATES));
};
