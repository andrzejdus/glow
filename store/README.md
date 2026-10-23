# Google Play store listing

Everything the Play Console asks for when publishing Glow, kept next to the code so it changes
with it. Nothing here is built into the app.

| File | What it is for |
|---|---|
| `listing.en-US.md` | The store listing in English (United States), the default language: app name, short description and full description, each with its Play limit and counted length. The canonical text. |
| `listing.pl-PL.md` | The same listing translated into Polish. Change the English first, then translate. |
| `graphics/icon-512.png` | The app icon for the listing: 512 × 512, 32-bit PNG, from `assets/src/`. |
| `graphics/feature-graphic.png` | The feature graphic: 1024 × 500, 24-bit PNG. Glow's name and dial in the app's colours, no device names, drawings or logos. Source: `graphics/src/feature-graphic.html`. |
| `graphics/screenshots/` | Six phone screenshots from demo mode, light theme, 1080 × 2160 24-bit PNG (Play: every side 320–3840 px, long side at most twice the short one). Upload in file-name order. |

The graphics are rendered by `scripts/store-graphics.mjs`, which needs the dev server and a
Playwright Chromium:

```sh
npm run dev -- --host 127.0.0.1 --port 5791
npm i --no-save playwright && npx playwright install chromium    # once
node scripts/store-graphics.mjs
```

`docs/screenshots/` (780 × 1688) are for the README only: at more than 2:1 they break Play's
aspect-ratio rule.

The privacy policy for the listing's "Privacy policy" field is [`../PRIVACY.md`](../PRIVACY.md),
linked as `https://github.com/andrzejdus/glow/blob/main/PRIVACY.md`.

## Wording rules

The listing stays within Play's policies on regulated products and on intellectual property:

- The app name is plain "Glow". No brand of the device maker in the name, the icon, the feature
  graphic or the short description.
- Device and model names appear only in the full description, only to say what Glow works with,
  next to the "not made, endorsed or supported by" disclaimer.
- Describe Glow as what it is: a Bluetooth remote for temperature, heater, battery, settings,
  workflows and diagnostics, with a demo mode and no network. Never mention what is used in the
  device, dosing, or effects.
