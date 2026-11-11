// playwright.config.js (T1) — end-to-end tests against `serve.js --mock` (contract sections 4.30.5 and 14.7).
// Only Chrome is installed locally, so the three projects are Chromium emulations of the iPad and of a phone;
// real Safari on the iPad is the owner's manual check (README).
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const WINDOWS_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// The installed Chrome is used only when the variable names one or the default Windows path exists;
// otherwise Playwright runs its own Chromium (CI: `npx playwright install --with-deps chromium`).
const chrome = process.env.PLAYWRIGHT_CHROME_PATH || (existsSync(WINDOWS_CHROME) ? WINDOWS_CHROME : '');

const touch = { hasTouch: true, isMobile: true };
/** The two extra layouts run only the flows tagged @layout or @smoke. */
const LAYOUT_AND_SMOKE = /@layout|@smoke/;

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    launchOptions: chrome ? { executablePath: chrome } : {},
  },
  projects: [
    // the default for every feature flow
    { name: 'ipad-landscape', use: { viewport: { width: 1180, height: 820 }, ...touch } },
    { name: 'ipad-portrait', grep: LAYOUT_AND_SMOKE, use: { viewport: { width: 820, height: 1180 }, ...touch } },
    { name: 'phone-360', grep: LAYOUT_AND_SMOKE, use: { viewport: { width: 360, height: 740 }, ...touch } },
  ],
  webServer: {
    command: 'node scripts/serve.js --port 5173 --mock',
    url: 'http://127.0.0.1:5173/config.json',
    reuseExistingServer: !process.env.CI,
    // The test server never needs the real gateway: a variable that is already set wins over .env.local
    // (serve.js, loadEnvFiles), so with these two the key and the gateway address never enter its process.
    // The proxy's rate limits count in mock mode as well: a run makes about 70 coach requests, so a test server that is
    // kept running would answer 429 after a few runs in one day (600 per address) and every flow that expects the mock's
    // text would fail. The four limits are lifted for the test server only.
    env: {
      COACH_API_KEY: 'mock-not-a-key',
      COACH_BASE_URL: 'http://127.0.0.1:9/v1',
      COACH_RATE_BURST: '1000',
      COACH_RATE_PER_MIN: '6000',
      COACH_IP_DAILY: '1000000',
      COACH_GLOBAL_DAILY: '1000000',
    },
  },
});
