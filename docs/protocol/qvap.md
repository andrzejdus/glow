# VENTY / VEAZY ("Qvap") BLE protocol

Driver: `src/lib/devices/qvap.ts`. Source of truth: the official web app v3.4.1
(`js/qvap.js`, `js/main.js`, `index.html`), read for protocol facts only.
Cross-checked against:

- [Volcano-Remote](https://github.com/xythobuz/Volcano-Remote) `src/venty.c` (C, Pico W):
  same masks, settings bits, 0x06 layout, brightness 1–9.
- [storz-rs](https://github.com/flakesonnix/storz-rs) `src/protocol/venty.rs` (Rust, its
  author tested it on a real Venty): same status layout, minimal init `02 1D 01 04`,
  heater modes 0–3, uint16 LE auto-off countdown.
- [home-assistant-volcano-hybrid](https://github.com/SavageNL/home-assistant-volcano-hybrid)
  `VENTY_BLE_SPEC.md`: a full write-up of the same vendor code. Its decoding agrees with
  ours throughout.

## Identification

| | |
|---|---|
| Advertised name | `S&B VY<serial>` (VENTY), `S&B VZ<serial>` (VEAZY). The app matches it with `includes()` |
| Name prefixes | `S&B VY`, `S&B VZ` |
| requestDevice filter | service `00000000-5354-4f52-5a26-4249434b454c`; optional `generic_access` (0x1800) |

## Services and characteristics

| Service | Characteristic | Use |
|---|---|---|
| `00000000-5354-4f52-5a26-4249434b454c` | `00000001-5354-4f52-5a26-4249434b454c` | every command: write (with response) + notify |
| `00001800-0000-1000-8000-00805f9b34fb` (Generic Access) | `00002a00-0000-1000-8000-00805f9b34fb` (Device Name) | read once. The serial is the second word, e.g. `S&B VY123456` gives `VY123456`. Optional |

Each write is a frame with the command id in byte 0. The device answers with a frame that
has the same id. **The device does not push**: the official app polls status every 500 ms.
Glow polls every 1 s and skips a tick while any other operation is queued. Multi-byte
values are little-endian, and temperatures are °C ×10 (the display unit never changes the
wire format).

## Command 0x01: status (20 bytes)

Request `[01 00 …]`. Reply (≥ 15 bytes, ≥ 17 with settings2):

| Byte | Field | Encoding |
|---|---|---|
| 1 | write mask (echo) | |
| 2–3 | current temperature | uint16, °C ×10 |
| 4–5 | target temperature (base) | uint16, °C ×10, 40–210 |
| 6 | boost offset | uint8 °C, 1–99 |
| 7 | superboost offset | uint8 °C, 1–99 |
| 8 | battery | % |
| 9–10 | auto-off countdown | seconds (the app adds the two bytes; Glow reads uint16 LE) |
| 11 | heater mode | 0 off, 1 normal, 2 boost, 3 superboost |
| 13 | charger connected | > 0 = charging |
| 14 | settings bits | see below |
| 15 | settings write mask (echo) | |
| 16 | settings2 bits | bit 0 = permanent Bluetooth |
| 17 | settings2 write mask (echo) | |

Settings byte 14: bit 0 `0x01` display °F, bit 1 `0x02` setpoint reached (read-only),
bit 2 `0x04` factory reset (not used by Glow), bit 3 `0x08` charge current optimization,
bit 4 `0x10` target changed with the device's buttons, bit 5 `0x20` charge voltage limit,
bit 6 `0x40` boost visualization. **On the VEAZY bit 6 is inverted** (1 = off).

### Writes

The same 20-byte frame, with byte 1 as a mask of the fields the device should take.
Everything else stays 0.

| Mask | Field | Example |
|---|---|---|
| `0x02` | target, bytes 4–5 | 185 °C: `01 02 00 00 3A 07 …` |
| `0x04` | boost offset, byte 6 | `01 04 00 00 00 00 0C …` |
| `0x08` | superboost offset, byte 7 | `01 08 … [7]=14 …` |
| `0x20` | heater mode, byte 11 | on `[11]=01`, off `[11]=00` |
| `0x80` | settings: byte 14 = new bit values, byte 15 = which bits; byte 16/17 the same for settings2 | charge optimization on: `[14]=08 [15]=08`; off: `[14]=00 [15]=08` |

## Other commands

| Cmd | Request | Reply |
|---|---|---|
| `0x02` firmware | `[02 …]` (20 B) | byte 1 flags: bit 0 = application running (else bootloader), bit 4 = invalid application, bit 5 = invalid bootloader. Bytes 2–7: firmware version, ASCII (`V01.09`). Bytes 11–16: bootloader version, ASCII |
| `0x04` usage | `[04 …]` | bytes 1–3: heater runtime in minutes (uint24); bytes 4–6: charging time in minutes (uint24) |
| `0x05` identity | `[05 …]` | bytes 15–16 prefix (`VY`/`VZ`) + bytes 9–14: the serial. Byte 18: VEAZY colour (2 blue, 3 pink, 4 orange, otherwise black) |
| `0x06` UI (**7 bytes**) | `[06 mask b2 00 00 b5 b6]`; mask 0 = read | byte 2 brightness 1–9 (mask `0x01`), byte 5 vibration 0/1 (mask `0x08`), byte 6 boost timeout disabled 0/1 (mask `0x10`, "Permanent Boost") |
| `0x0D` find my | `[0D 01 …]` | the device signals |
| `0x1D` advertising info | `[1D …]` | byte 1 bit 4 = connected while in find-my mode |

Glow never sends: `0x0C 66 33` (switches to the bootloader), `0x01`/`0x30` with bootloader
sub-commands (firmware flashing), `0x30 06` (connection-interval check for flashing), and
`0x03`/`0x23`/`0x00` (analysis that is uploaded to S&B), nor the factory-reset bit.

## Connect sequence

The official app:

1. start notifications on `…0001`
2. read GAP Device Name (serial; optional)
3. `0x02` (write with response). The reply tells it whether the application or the bootloader is running
4. `0x1D`, `0x01`, `0x04`, `0x23` (`0x03` in the bootloader), `0x05`, `0x06` (7 bytes), `0x30 06`
5. every 500 ms `0x01`, and `0x04` instead on every 31st tick

Glow does steps 1–3, then **waits for the firmware reply**. If the bootloader is running
it stops with an error, because in the bootloader `0x01` is the page-write command. Then it
sends `0x1D 01 04 05` and `06` (7 bytes), polls `0x01` every second (`0x04` every 31st
tick), and on `refresh()` sends `0x04` and `0x06`. If `0x1D` reports find-my mode, the first
status reply triggers a fresh read of `0x05` and `0x06`, as the app does.

## Model differences

| | VENTY | VEAZY |
|---|---|---|
| Boost visualization bit | direct | inverted |
| Permanent Bluetooth | read only (the app hides it) | read + write |
| Permanent Boost (0x06 byte 6) | firmware minor ≥ 8 | always |
| Colour | — | 0x05 byte 18 |

Limits: target 40–210 °C, boost and superboost offsets 1–99 °C, brightness 1–9. The app's
own settings screen has no automatic-shutoff slider and no display-on-cooling option for
this family. Glow offers neither.

## Uncertain

- **Boost and superboost from the app.** The official app only ever writes heater mode
  0 or 1, so boost is selected with the device's buttons. Glow's `setMode` writes 2 or 3
  with mask `0x20`, as storz-rs does. That is unverified on hardware. While the heater is
  off it writes nothing, so a mode change can never start heating.
- **Target in boost mode.** In boost or superboost mode the vendor app subtracts the boost
  offset (and, through a bug, `1` instead of the superboost offset) from the displayed
  target before writing. Glow treats bytes 4–5 as the base target in every mode and writes
  the base unchanged. It is not confirmed whether the device reports the base or the
  effective target in boost mode.
- **Effective temperature.** Whether superboost adds `superboost` or
  `boost + superboost` is unknown. Glow reports the raw offsets and the mode.
- **Accepting a reported target.** The vendor only accepts bytes 4–5 on the first reply
  or when bit 4 (changed on the device) is set. Glow always accepts them, except for 2.5 s
  after its own write unless they match the written value. storz-rs also always reads them.
- **Auto-off countdown.** The app adds b9 + b10. Glow reads it as uint16 LE; both agree
  below 256 s. The app draws it against 120 s. There is no writable auto-off setting:
  `writeAutoOffCountdownQVap` in the app is an empty stub, so `autoShutoffSec` stays unset.
- **Unsolicited notifications.** None are known. Glow handles any that arrive like poll
  replies.
- **Second version string.** The app labels it "Firmware Bootloader" for this family.
  Glow puts it in `firmwareBle`, the only free field.
- Status bytes 12, 18–19 and firmware bytes 8–10 are unknown.
