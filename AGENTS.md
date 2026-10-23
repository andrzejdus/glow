# AGENTS.md

Notes for coding agents working on Glow. `CLAUDE.md` is a symlink to this file. Humans: see
`CONTRIBUTING.md`, which this file does not repeat.

Glow is an unofficial Android app for STORZ & BICKEL Bluetooth vaporizers (VENTY, VEAZY, CRAFTY,
CRAFTY+, VOLCANO HYBRID). Capacitor 8 wraps a Svelte 5 + TypeScript web app; Bluetooth goes
through `@capacitor-community/bluetooth-le` on Android and Web Bluetooth in a browser.

## Map

| Path | What |
|---|---|
| `src/main.ts`, `src/App.svelte` | Entry: mounts the app, starts `conn` |
| `src/lib/connection.svelte.ts` | `conn`: scanning, auto-connect, reconnecting, commands, demo mode; the state every screen reads |
| `src/lib/devices/types.ts` | `DeviceDriver`, `DeviceState`, `DriverModule`, `DiagnosticValue`: the driver contract |
| `src/lib/devices/{qvap,volcano,crafty}.ts` | Drivers per family (qvap = VENTY and VEAZY); each has a `*.test.ts` with a fake transport |
| `src/lib/devices/registry.ts` | Driver modules, identification by advertised name, service UUID list |
| `src/lib/devices/demo.ts` | Simulated devices for demo mode (`/?demo=venty`, `crafty`, `volcano`) |
| `src/lib/ble/` | `BleTransport` (the only Bluetooth API drivers see), native and Web Bluetooth adapters |
| `src/lib/usage.svelte.ts`, `workflow.svelte.ts` | Hours-of-operation history; the VOLCANO workflow runner |
| `src/screens/`, `src/components/` | UI. `Diagnostics.svelte` shows a driver's `diagnostics()` registers |
| `docs/protocol/*.md` | Protocol notes per family: UUIDs, payloads, connect sequence, hardware findings, open questions |
| `android/` | Capacitor's Android project. `capacitor.build.gradle` and `capacitor.settings.gradle` are generated: do not edit |
| `.github/workflows/` | `check.yml` (PRs, no secrets), `android.yml` (signed release builds, never on PRs), `screens.yml` (emulator screenshots, manual) |
| `scripts/` | `render-assets.mjs` (icon, splash), `store-graphics.mjs` (Play graphics), `emulator-shots.sh` (used by `screens.yml`) |
| `PRIVACY.md`, `store/` | Privacy policy and the Google Play kit (listing texts, graphics, Play Console answers); prepared, not published |

## Commands

```sh
npm ci
npm run dev                                   # browser; /?demo=venty|crafty|volcano
npx svelte-check --tsconfig ./tsconfig.json   # must report 0 errors and 0 warnings
npm test                                      # vitest, src/**/*.test.ts
npx vite build && npx cap sync android
cd android && ./gradlew assembleDebug         # JDK 21, Android SDK 36; installs as pl.gogoad.glow.debug
```

## Constraints

- **No network.** No server, account, analytics, CDN or remote fonts. The Content-Security-Policy
  in `index.html` blocks every request; do not loosen it or add dependencies that call home.
  `INTERNET` in the manifest exists only because the WebView needs it.
- **Nothing from STORZ & BICKEL.** No code copied from their apps, no images, icons, fonts,
  product photos or manual text. Protocol knowledge goes into code and notes in our own words.
- **Out of scope on purpose:** firmware update, factory reset, the official app's analysis.
- **Signing:** release builds are signed in CI from secrets. Never add keystores or
  `keystore.properties`, and never add a `pull_request` trigger to `android.yml` or use
  `pull_request_target` anywhere.
- **Privacy claims follow the code.** A change to what the app stores, its permissions or its
  backup behaviour updates `PRIVACY.md` and `store/play-console-answers.md` in the same PR.
- **UI and store wording** describe a Bluetooth remote for a device (temperature, heater,
  battery, settings). No substances, dosing or effects, and no maker branding in the app name,
  icon or store graphics (Play policy and trademarks; see `store/play-console-answers.md`).
- Only the CRAFTY+ (V03.24) has been tried on hardware. Do not mark a support-table row ✅ in
  `README.md` without a report from a real device.

## Conventions

- TypeScript strict; Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), no legacy
  stores or `export let`. Shared reactive state lives in `*.svelte.ts` modules.
- Match the surrounding code; there is no formatter, so no drive-by reformatting.
- Drivers: only `BleTransport`; report state as partial `DeviceState` patches; optional abilities
  are optional methods plus `capabilities`. A protocol change comes with a test using captured
  bytes and an update to the family's `docs/protocol/` note.
- Comments say why, in plain English. UI text is short and plain, in English.
- Commits: one change each, subject in the style of `git log` (area first:
  "CRAFTY: …", "README: …", "CI: …"). Version bumps (`0.1.x`) are the maintainer's.
- Releases: a `vX.Y.Z` tag publishes a GitHub release with exactly one `glow-X.Y.Z.apk`
  (Obtainium matches it; never attach a second APK or the AAB). The signed `.aab` stays a workflow
  artifact; the Play internal-track upload runs only once `PLAY_SERVICE_ACCOUNT_JSON` is set.
- Licence: GPL-3.0-or-later (`LICENSE`); contributions are published under it.
