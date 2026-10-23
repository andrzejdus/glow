# Contributing to Glow

Glow has been tried on one real device so far, a CRAFTY+ on firmware V03.24. Everything else is
built from the protocol and unit tests. The most useful thing you can do is try it on the device
you own and tell us what works. Pull requests that fix a driver are just as welcome.

Glow is unofficial. It is not made, endorsed or supported by STORZ & BICKEL, and nothing of theirs
may be copied in: no code from their apps, no images, icons, fonts, product photos or manual text.
Describe what a device does in your own words and write your own code.

## Test your device

You need no development setup for this.

1. Install the [latest release](../../releases/latest) APK, or a debug APK from a pull request
   (see [Try a pull request](#try-a-pull-request)).
2. Open Glow next to your device and let it connect. Check each row of the
   [support table](README.md#supported-devices) for your model.
3. Note the firmware: **Settings**, the card at the top lists Serial, Firmware and BLE (Bootloader
   on VENTY and VEAZY). The Glow version is at the bottom of Settings.
4. On a CRAFTY: **Settings → Device diagnostics**. Leave it open, use the device (heat up, plug
   in the charger, press its button), tap **Mark now** the moment the device does something
   visible, such as the LED turning green, then **Copy log**. Other models have no diagnostics
   screen yet; a driver gets one by implementing `diagnostics()` (see `crafty.ts`).
5. Open a [device report](../../issues/new?template=device-report.yml) and paste what you found.

If Glow does not find your device at all, say what name it shows in Android's Bluetooth settings
(or in a scanner app such as nRF Connect). Glow picks the driver by the advertised name.

You do not need to share the serial number.

## Set up

Requires Node 22. For the Android app, also JDK 21 and the Android SDK with platform 36 (Android
Studio brings both; on the command line set `ANDROID_HOME`).

```sh
npm ci
npm run dev                 # http://localhost:5173
```

In the browser, **Try without a device** on the Connect screen starts the demo, or open
`/?demo=venty`, `/?demo=crafty` or `/?demo=volcano` directly. In Chrome or Edge the dev server
can also connect to a real device over Web Bluetooth.

## Check

```sh
npx svelte-check --tsconfig ./tsconfig.json   # types, Svelte
npm test                                      # vitest, src/**/*.test.ts
npx vite build
```

CI (`.github/workflows/check.yml`) runs the same on every pull request, plus an Android debug
build.

## Build and install a debug APK

```sh
npx vite build && npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Enable USB debugging on the phone first (Developer options). A debug build is signed with your
machine's own debug key and installs as a separate app, **Glow debug** (`pl.gogoad.glow.debug`),
next to a release install, so you can switch between the two. It has its own remembered device and
usage history.

With the phone connected, `chrome://inspect` in desktop Chrome opens DevTools for the debug app's
WebView (console, network, breakpoints).

`./gradlew assembleRelease` without the signing secrets gives an unsigned APK that Android will
not install; release signing only happens in CI.

### Try a pull request

Every pull request's check run keeps its debug APK as a workflow artifact (`glow-…-debug`): open
the pull request's **Checks** tab, then the run's **Summary**, and download it while signed in to
GitHub. It installs as Glow debug, next to your release app. Each CI run signs with a fresh debug
key, so uninstall Glow debug before installing one from another run.

## Add or fix a driver

| File | What |
|---|---|
| `src/lib/devices/types.ts` | `DeviceDriver`, `DeviceState`, `DriverModule`: what a driver implements and reports |
| `src/lib/devices/qvap.ts`, `volcano.ts`, `crafty.ts` | One driver module per device family |
| `src/lib/devices/registry.ts` | The list of modules; picks one by advertised name |
| `src/lib/devices/*.test.ts` | Unit tests, each with a fake `BleTransport` |
| `src/lib/devices/demo.ts` | The simulated device behind demo mode |
| `docs/protocol/*.md` | Protocol notes per family: services, payloads, what was seen on hardware, open questions |

- A driver talks to Bluetooth only through `BleTransport` (`src/lib/ble/transport.ts`), and reports
  state as partial `DeviceState` patches.
- What a device can do is in its `capabilities`; optional abilities are optional methods
  (`setPump`, `findMyDevice`, `refresh`, `diagnostics`). The UI shows only what the driver offers.
- A new device family is a new module listed in `registry.ts`, with its `DeviceKind` in
  `types.ts` and its advertised-name prefixes and service UUIDs in the module.
- A `diagnostics()` for VENTY, VEAZY or VOLCANO would help testers of those models a lot: it only
  lists raw registers, and the Diagnostics screen does the rest.
- Put the bytes you captured into a test: what the device sent, and what Glow should write back.
  The existing tests show how to feed a fake transport and assert on its reads and writes.
- Update the family's `docs/protocol/` note with what you found and on which firmware, and the
  [support table](README.md#supported-devices) (✅ only for a row tried on a real device).
- If the change affects what the demo shows, update `demo.ts` so screenshots stay true.

## Code

- TypeScript, strict. Svelte 5 with runes (`$state`, `$derived`, `$effect`, `$props`).
- Match the code around you: naming, formatting, comment style. There is no formatter config; keep
  diffs free of unrelated reformatting.
- No network. The app has no server, account or analytics, and the Content-Security-Policy in
  `index.html` blocks every request. Fonts and images are bundled. Do not add dependencies that
  call home.
- Firmware update, factory reset and the official app's analysis are left out on purpose. Pull
  requests that add them will not be merged.

## Pull requests

- One change per pull request. Titles and commit subjects follow `git log`: short, English, the
  area first ("CRAFTY: the auto-off setting no longer drops on its own while heating").
- `npx svelte-check`, `npm test` and `npx vite build` pass.
- Say what you tested it on: model and firmware, or demo mode only.
- Screenshots for visible changes (demo mode is fine).

## Licence

Contributions are published under the project's licence; see [LICENSE](LICENSE).
