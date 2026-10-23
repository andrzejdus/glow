// Renders the Google Play listing graphics into store/graphics/:
//   icon-512.png         512 × 512, 32-bit PNG, from the app icon sources in assets/src/
//   feature-graphic.png  1024 × 500, 24-bit PNG, from store/graphics/src/feature-graphic.html
//   screenshots/*.png    1080 × 2160, 24-bit PNG, from demo mode in the light theme
//
//   npm run dev -- --host 127.0.0.1 --port 5791
//   npm i --no-save playwright && npx playwright install chromium    (once)
//   node scripts/store-graphics.mjs [http://127.0.0.1:5791/ [<output-dir>/]]
//
// Screenshots are 400 × 800 CSS px at 2.7×: Play wants every side within 320–3840 px and the
// long side at most twice the short one (docs/screenshots, at 780 × 1688, are over that).
// `shoot` and `feature` take a Playwright Browser, so they also run from an agent's browser.
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';

const OUT = new URL('../store/graphics/', import.meta.url).pathname;
const svg = (name) => readFileSync(new URL(`../assets/src/${name}.svg`, import.meta.url));

export async function icon(out = OUT) {
  const mark = await sharp(svg('mark'), { density: 144 }).resize(512, 512).png().toBuffer();
  await sharp(svg('background'), { density: 144 })
    .resize(512, 512)
    .composite([{ input: mark }])
    .ensureAlpha()
    .png()
    .toFile(`${out}icon-512.png`);
  return 'icon-512.png';
}

/** Play takes the feature graphic and screenshots as JPEG or 24-bit PNG, without alpha. */
const opaque = (png, path) => sharp(png).flatten({ background: '#ffffff' }).removeAlpha().png().toFile(path);

export async function feature(browser, base = 'http://127.0.0.1:5791/', out = OUT) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  // networkidle: the dev server's client may reload the page once while it settles.
  await page.goto(`${base}store/graphics/src/feature-graphic.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.fonts.status === 'loaded' && document.fonts.check('900 92px "Roboto Flex Variable"'));
  await opaque(await page.screenshot(), `${out}feature-graphic.png`);
  await ctx.close();
  return 'feature-graphic.png';
}

export async function shoot(browser, base = 'http://127.0.0.1:5791/', out = `${OUT}screenshots/`) {
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 800 },
    deviceScaleFactor: 2.7,
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  const shots = [];
  const open = async (demo) => {
    await page.goto(`${base}?demo=${demo}`);
    await page.getByRole('button', { name: 'Heat on' }).waitFor();
    await page.waitForTimeout(1200); // the dashboard's entry animation
  };
  const tab = async (name) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(900);
  };
  const shot = async (name) => {
    await opaque(await page.screenshot({ scale: 'device' }), `${out}${name}.png`);
    shots.push(`screenshots/${name}.png`);
  };

  // 1. VENTY heating: the dial glows while the demo heats from 142 °C to its 180 °C target.
  await open('venty');
  await shot('01-dashboard-heating');

  // 2. CRAFTY+ ready, once the demo reaches its target.
  await open('crafty');
  await page.getByText('Ready', { exact: true }).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  await shot('02-dashboard-ready');

  // 3. VOLCANO HYBRID running a workflow.
  await open('volcano');
  await tab('Workflows');
  await page.getByRole('button', { name: 'Start Flow 1' }).click();
  await page.waitForTimeout(4000);
  await shot('03-workflow-running');

  // 4. VOLCANO HYBRID dashboard with the air pump on.
  await tab('Control');
  await page.getByRole('button', { name: 'Air' }).click();
  await page.waitForTimeout(2000);
  await shot('04-air-pump');

  // 5. VENTY settings.
  await open('venty');
  await tab('Settings');
  await shot('05-settings');

  // 6. CRAFTY+ device diagnostics.
  await open('crafty');
  await tab('Settings');
  await page.getByRole('button', { name: 'Device diagnostics' }).click();
  await page.waitForTimeout(3000);
  await shot('06-diagnostics');

  await ctx.close();
  return shots;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  const out = process.argv[3] ?? OUT;
  mkdirSync(`${out}screenshots/`, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const files = [await icon(out), await feature(browser, base, out), ...(await shoot(browser, base, `${out}screenshots/`))];
    console.log(files.join('\n'));
  } finally {
    await browser.close();
  }
}
