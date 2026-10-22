// Renders the icon and splash sources in assets/src/*.svg into the PNGs that
// @capacitor/assets turns into every Android density:
//   node scripts/render-assets.mjs && npx capacitor-assets generate --android
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = (name) => readFileSync(new URL(`../assets/src/${name}.svg`, import.meta.url));
const out = (name) => new URL(`../assets/${name}.png`, import.meta.url).pathname;

const mark = await sharp(svg('mark'), { density: 144 }).resize(1024, 1024).png().toBuffer();
const background = await sharp(svg('background'), { density: 144 }).resize(1024, 1024).png().toBuffer();

await sharp(mark).toFile(out('icon-foreground'));
await sharp(background).toFile(out('icon-background'));
await sharp(background).composite([{ input: mark }]).toFile(out('icon-only'));

const splashMark = await sharp(mark).resize(900, 900).toBuffer();
const splashBg = await sharp(svg('background'), { density: 288 }).resize(2732, 2732).png().toBuffer();
await sharp(splashBg).composite([{ input: splashMark, gravity: 'centre' }]).toFile(out('splash'));
await sharp(splashBg).composite([{ input: splashMark, gravity: 'centre' }]).toFile(out('splash-dark'));
console.log('assets rendered');
