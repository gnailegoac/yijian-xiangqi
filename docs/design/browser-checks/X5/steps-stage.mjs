// Drives the live stage of dev/buddy.html through bubble states and captures the mock after each.
// Env: X5_OUT, X5_TAG, X5_STATES (comma list of state names, default all)
import path from 'node:path';

const STATES = {
  empty: async () => {},
  good: async (page) => { await page.click('[data-b="begin-good"]'); await page.waitForTimeout(1500); },
  warn: async (page) => { await page.click('[data-b="begin-warn"]'); await page.waitForTimeout(900); },
  question: async (page) => { await page.click('[data-b="question"]'); await page.click('[data-b="begin"]'); await page.waitForTimeout(1600); },
  caption: async (page) => { await page.click('[data-b="caption"]'); await page.waitForTimeout(200); },
  captionline: async (page) => { await page.click('[data-b="caption"]'); await page.click('[data-b="begin"]'); await page.waitForTimeout(1600); },
  status: async (page) => { await page.click('[data-b="clear"]'); await page.click('[data-b="status"]'); await page.waitForTimeout(200); },
  stale: async (page) => { await page.click('[data-b="begin-good"]'); await page.waitForTimeout(1500); await page.click('[data-b="stale-commit"]'); await page.waitForTimeout(200); },
  dots: async (page) => { await page.click('[data-b="begin-wait"]'); await page.waitForTimeout(700); },
  long: async (page) => { await page.click('[data-b="long"]'); await page.waitForTimeout(4200); },
};

export default async ({ page }) => {
  const out = process.env.X5_OUT;
  const tag = process.env.X5_TAG ?? 'stage';
  const names = (process.env.X5_STATES ?? Object.keys(STATES).join(',')).split(',');
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  const mock = page.locator('#mock');
  await mock.scrollIntoViewIfNeeded();
  for (const name of names) {
    await page.click('[data-b="clear"]');
    await STATES[name](page);
    await mock.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
  }
};
