# Glow

An unofficial Android app for STORZ & BICKEL Bluetooth vaporizers: VENTY, VEAZY,
VOLCANO HYBRID, CRAFTY and CRAFTY+ (see [Supported devices](#supported-devices)). It is
not made or endorsed by STORZ & BICKEL.

<p>
  <img src="docs/screenshots/connect.png" width="160" alt="Connect screen">
  <img src="docs/screenshots/venty.png" width="160" alt="VENTY dashboard while heating">
  <img src="docs/screenshots/crafty.png" width="160" alt="CRAFTY+ dashboard with the heat levels readout">
  <img src="docs/screenshots/volcano-workflows.png" width="160" alt="VOLCANO workflows">
  <img src="docs/screenshots/settings.png" width="160" alt="VENTY settings">
</p>

Screenshots from demo mode (`npm run dev`, `/?demo=venty`, `/?demo=crafty`, `/?demo=volcano`).

- **Reconnects on its own.** The app remembers your device and reconnects when you
  open it, with no Connect button and no device picker. On the first start it asks
  once for the Nearby devices permission and connects to the only device in range.
- **Runs entirely on the phone.** Everything ships inside the APK and the app talks
  to the device over Bluetooth only. There is no server, account, analytics or CDN.
  The Content-Security-Policy in `index.html` blocks any network request.
- **Dashboard:** a temperature dial that glows as the device heats up, a status line
  that mirrors the device LED (Heating, Ready, Heater off), time to ready,
  Booster/Superbooster (a readout on CRAFTY, which switches levels only with its own
  button), and lifetime hours of operation that count up live while heating. Usage per
  month, in minutes, comes from snapshots of the device's counter kept on the phone.
- **VOLCANO workflows:** Flow 1–3 and Balloon run from the phone, step by step, with
  time running and time left.
- **Settings:** every device setting the official web app offers, plus Find My and
  the Booster/Superbooster offsets. Sliders mark the factory value where STORZ & BICKEL
  documents one. Firmware update, factory reset and analysis are left out on purpose.
- **Demo mode** (Connect screen: "Try without a device") simulates a VENTY or a
  VOLCANO.

## Supported devices

| | VENTY | VEAZY | CRAFTY+ | CRAFTY, firmware V02.51+ | CRAFTY, older firmware | VOLCANO HYBRID |
|---|---|---|---|---|---|---|
| **Tried on a real device** | no | no | **yes** (V03.24) | no | no | no |
| Auto-connect | ✓ | ✓ | ✓ tested | ✓ | ✓ | ✓ |
| Temperature and target | ✓ | ✓ | ✓ tested | ✓ | ✓ | ✓ |
| Heater on/off from the app | ✓ | ✓ | ✓ tested | ✓ | – (device button only) | ✓ |
| Status line mirrors the LED (Heating / Ready) | ✓ | ✓ | ✓ tested | ✓ | ✓ | ✓ (within 1 °C of target) |
| Booster / Superbooster | ✓ switched from the app | ✓ switched from the app | ✓ readout, tested (the device button switches) | ✓ Booster readout | ✓ Booster readout | – |
| Booster / Superbooster offsets | ✓ both | ✓ both | ✓ Booster (Superbooster is always +15 °C) | ✓ Booster | ✓ Booster | – |
| Battery level | ✓ | ✓ | ✓ tested | ✓ | ✓ | – |
| Charging / Charged | ✓ | ✓ | ✓ tested | ✓ (the CRAFTY+ bit, unconfirmed) | – | – |
| Hours of operation, usage per month | ✓ | ✓ | ✓ tested | ✓ | ✓ | ✓ |
| Auto-off countdown | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Air pump | – | – | – | – | – | ✓ |
| Workflows (Flow 1–3, Balloon) | – | – | – | – | – | ✓ |
| Find My | ✓ | ✓ | ✓ | – | – | – |
| Device settings | ✓ | ✓ | ✓ | ✓ | ✓ (fewer) | ✓ |
| Device diagnostics (raw registers) | – | – | ✓ tested | ✓ | ✓ | – |

✓ supported, – not available on that device or not in the app. "tested" means tried
on a real device; everything else is built from the protocol and covered by unit tests
only. MIGHTY and MIGHTY+ are not supported: the official web app Glow's drivers are
based on has no protocol for them.

## Install

Download the APK from the newest [release](../../releases/latest) on the phone and
open it. Android asks once to allow installs from your browser.

## Build

Requires Node 22, plus JDK 21 and the Android SDK (platform 36) for the APK.

```sh
npm ci
npm run dev                 # browser, open /?demo=venty, /?demo=volcano or /?demo=crafty
npm test                    # protocol driver tests
npm run android:sync        # web build + copy into android/
cd android && ./gradlew assembleRelease
```

Releases are built by GitHub Actions (`.github/workflows/android.yml`):

- **Push to `main`:** builds a signed APK and keeps it as a workflow artifact.
- **Tag `v*`** (for example `git tag v0.2.0 && git push --tags`): also publishes a
  GitHub release with the APK attached.
- **Screens** (`.github/workflows/screens.yml`, run by hand): boots Android 12 and 15
  emulators and screenshots a debug build, to check layout and system bars before a
  release.

The signing key lives only in the repository secrets `GLOW_KEYSTORE_BASE64` and
`GLOW_KEYSTORE_PASSWORD`, plus an offline backup. Every release has to be signed
with the same key, or Android refuses to update the installed app.

## Layout

| Path | What |
|---|---|
| `src/lib/devices/` | Protocol drivers: `qvap.ts` (VENTY/VEAZY), `volcano.ts`, `crafty.ts`, plus `demo.ts` |
| `docs/protocol/` | Protocol notes per device family: services, payloads, open questions |
| `src/lib/ble/` | Bluetooth: the native plugin on Android, Web Bluetooth in a browser |
| `src/lib/connection.svelte.ts` | Auto-connect, scanning, reconnecting, commands |
| `src/lib/usage.svelte.ts` | Hours-of-operation history, session time, time to ready |
| `src/lib/workflow.svelte.ts` | The VOLCANO workflow runner |
| `src/screens/`, `src/components/` | The UI (Svelte 5) |
| `assets/src/` | Icon and splash sources (`node scripts/render-assets.mjs && npx capacitor-assets generate --android`) |

The drivers were written from the protocol used by the official web app at
app.storz-bickel.com and cross-checked against open-source projects. They have unit
tests. Only CRAFTY+ has been tried on a real device so far; VENTY, VEAZY and VOLCANO
HYBRID **have not been tested against real hardware yet**.
