// Renders the README screenshots into docs/screenshots/: 390 × 844 CSS px at 2×, from demo mode
// in the light theme. Run it whenever the app's look changes, and commit the result with it.
//
//   npm run dev -- --host 127.0.0.1 --port 5791
//   npm i --no-save playwright && npx playwright install chromium    (once)
//   node scripts/readme-screenshots.mjs [http://127.0.0.1:5791/ [<output-dir>/]]
//
// `shoot` takes a Playwright Browser, so it also runs from an agent's browser.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;

/** 24-bit PNG, like the ones already in the README. */
const opaque = (png, path) => sharp(png).flatten({ background: '#ffffff' }).removeAlpha().png().toFile(path);

export async function shoot(browser, base = 'http://127.0.0.1:5791/', out = OUT) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  const shots = [];
  const status = () => page.locator('.status .line:not(.sizer)');
  const open = async (demo) => {
    await page.goto(`${base}?demo=${demo}`);
    await page.getByRole('button', { name: /^Heat( on)?$/ }).waitFor();
    await page.waitForTimeout(1200); // the dashboard's entry animation
  };
  const tab = async (name) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1200);
  };
  const shot = async (name) => {
    await opaque(await page.screenshot({ scale: 'device' }), `${out}${name}.png`);
    shots.push(`${name}.png`);
  };

  try {
    // Connect, with nothing remembered.
    await page.goto(base);
    await page.getByRole('button', { name: /Connect/ }).first().waitFor();
    await page.waitForTimeout(1500);
    await shot('connect');

    // CRAFTY+ heating, counting down to Ready, then its Stats and Settings tabs. Stats shows the
    // last finished session, picked from the history: the running one has hardly any chart yet.
    await open('crafty');
    await status().filter({ hasText: /Ready in/ }).waitFor();
    await page.waitForTimeout(1000);
    await shot('crafty');
    await tab('Stats');
    await page.locator('.history .item').nth(1).click();
    await page.waitForTimeout(1500);
    await shot('stats');
    await tab('Settings');
    await shot('settings');

    // CRAFTY+ device diagnostics, with a mark in the change log.
    await page.getByRole('button', { name: 'Device diagnostics' }).click();
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Mark now' }).click();
    await page.waitForTimeout(1500);
    await shot('diagnostics');

    // VENTY ready: it shows the target only, and the dial turns green.
    await open('venty');
    await status().filter({ hasText: /^\s*Ready\s*$/ }).waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    await shot('venty');

    // VOLCANO HYBRID workflows.
    await open('volcano');
    await tab('Workflows');
    await shot('volcano-workflows');
  } finally {
    await ctx.close();
  }
  return shots;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  const out = process.argv[3] ?? OUT;
  mkdirSync(out, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    console.log((await shoot(browser, base, out)).join('\n'));
  } finally {
    await browser.close();
  }
}
