# VOLCANO HYBRID — BLE protocol

Driver: `src/lib/devices/volcano.ts`. Source: the official STORZ & BICKEL web app v3.4.1 (`volcano.js`, `workflow.js`, `main.js`, `index.html`), read for protocol facts only. The register masks, the `0x10000` set-flag, 4-byte register reads and the heater/pump/temperature characteristics were cross-checked against xythobuz' open-source Volcano Remote (`github.com/xythobuz/Volcano-Remote`, `src/volcano.c`), and they match.

## Identification

- The official app's `requestDevice` filter is `namePrefix: "S&B"`, shared with VENTY (`S&B VY…`) and VEAZY (`S&B VZ…`). It treats a name that contains `S&B VOLCANO` as a Hybrid. Glow uses prefix `S&B VOLCANO` and matches it case-insensitively.
- On Android/desktop the filter also lists the Volcano services `00000001-1989-0108-1234-123456789abc`, `01000002-1989-0108-1234-123456789abc`, `10100000-…`, `10110000-…` and `10130000-…`.

## Services and characteristics

Base UUID `xxxxxxxx-5354-4f52-5a26-4249434b454c` unless written in full. All integers are little-endian.

| Service | Char | Name | Access | Payload |
|---|---|---|---|---|
| 10100000 | 10100001 | Bootloader version | read | UTF-8; contains `BL` while the device is in firmware-update mode |
| 10100000 | 10100003 | Firmware | read | UTF-8; the app shows the first 8 chars |
| 10100000 | 10100004 | BLE firmware | read | UTF-8 |
| 10100000 | 10100005 | Firmware version (update) | — | used only by the updater |
| 10100000 | 10100008 | Serial | read | UTF-8; first 8 chars |
| 10100000 | 1010000c | Register 1 (status) | read, notify | uint32 (the app decodes the low 16 bits) |
| 10100000 | 1010000d | Register 2 (settings) | read, notify, write | uint32 |
| 10100000 | 1010000e | Register 3 (settings) | read, write | uint32; not subscribed by the app |
| 10100000 | 10100011 | Code number | write | uint16 `4711` enters the bootloader (firmware update; not implemented) |
| 10100000 | 10100015/16 | History 1/2 | read | raw bytes, shown only in "Analysis" (not implemented) |
| 10110000 | 10110001 | Current temperature | read, notify | uint16, 0.1 °C |
| 10110000 | 10110003 | Target temperature | read, notify, write | read uint16 0.1 °C; write **uint32** 0.1 °C |
| 10110000 | 10110005 | LED brightness | read, write | uint16, 0–100 |
| 10110000 | 1011000c | Auto shutoff remaining | read, notify | uint16 seconds |
| 10110000 | 1011000d | Auto shutoff time | read, write | uint16 seconds |
| 10110000 | 1011000f | Heater on | write | uint8 `0x00` |
| 10110000 | 10110010 | Heater off | write | uint8 `0x00` |
| 10110000 | 10110013 | Pump on | write | uint8 `0x00` |
| 10110000 | 10110014 | Pump off | write | uint8 `0x00` |
| 10110000 | 10110015 | Hours of operation | read, notify | uint16 hours |
| 10110000 | 10110016 | Minutes of operation | read, notify | uint16 minutes (0–59) |
| 00000001-1989-… | 00000002 / 00000003 | Bootloader UART write / notify | — | framed `FE FA 7F len … xor FD`; firmware update only |

All writes are write-with-response.

### Temperatures

- Read: `Math.round(raw / 10)` °C. The app ignores current-temperature values where that result is ≥ 6536 (a 0xFFFF-ish "no sensor value"). The driver reports whole degrees, like the app.
- Write: `round(°C × 10)` as uint32 LE, e.g. 185 °C → `3A 07 00 00`. The app clamps the target to 40–230 °C before it writes. The device always works in °C. Fahrenheit only changes the device display (and the app's labels).

### Registers

| Register | Bit | Meaning |
|---|---|---|
| 1 | `0x0020` | heater on |
| 1 | `0x0200` | auto-shutoff countdown active (the app shows the countdown only then) |
| 1 | `0x2000` | pump on |
| 1 | `0x4018` (mask) | error bits → the app runs "Analysis" |
| 2 | `0x0200` | display in °F |
| 2 | `0x1000` | display-on-cooling **disabled** (inverted) |
| 2 | `0x003B` (mask) | error bits |
| 3 | `0x0400` | vibration **disabled** (inverted) |

Register writes are uint32 LE: the mask alone **clears** the bit, and `mask | 0x10000` **sets** it. Other bits are untouched. Examples:
vibration off → reg 3 `00 04 01 00`; vibration on → `00 04 00 00`; °F → reg 2 `00 02 01 00`; display on cooling off → reg 2 `00 10 01 00`.

### Settings (Settings screen for VOLCANO)

| Glow key | Official control | Encoding |
|---|---|---|
| `vibration` | Vibration | reg 3 bit `0x0400`, inverted |
| `displayOnCooling` | Display On Cooling | reg 2 bit `0x1000`, inverted |
| `ledBrightness` | LED Brightness, slider 0–100 step 10 | 10110005 uint16 |
| `autoShutoff` | Automatic Shutoff, slider 30–360 step 30 **minutes** | 1011000d uint16 = minutes × 60 |
| `fahrenheit` | tap on the temperature label | reg 2 bit `0x0200` |

Factory reset, Permanent Bluetooth and Find My are not offered for the Volcano in the official app.

## Connect sequence (official app)

1. Get services `00000001-1989…`, `01000002-1989…`, `10100000`, `10110000`.
2. Subscribe to bootloader UART notify `00000003`; keep handle `00000002`; keep code number `10100011`.
3. Read register 2 → unit, display on cooling, error check; subscribe to register 2; read it again.
4. Subscribe to the target temperature, then read it.
5. Subscribe to the current temperature, then read it.
6. Keep heater on/off and pump on/off handles.
7. Read serial `10100008`; read firmware `10100003` (and compare with the server's firmware file); read bootloader `10100001` (shows the "in update mode" dialog if it contains `BL`); read BLE firmware `10100004`.
8. Subscribe to auto-shutoff remaining `1011000c`, then read it; the same for hours `10110015` and minutes `10110016`.
9. Subscribe to register 1, then read it → heater, pump and countdown state, error check.
10. Read register 3 → vibration; keep the history handles.
11. Read the auto-shutoff time `1011000d` and the LED brightness `10110005`.
12. If an error bit was seen, run Analysis.

The Glow driver does the same, minus the bootloader, firmware-update and analysis steps. Every GATT operation goes through one queue, so there is only one in flight at a time (the official app has a 2 s "BLE pending" flag and retries a busy command every 100 ms). `refresh()` re-reads register 3, the shutoff time, the brightness and the hours/minutes, because register 3, the shutoff time and the brightness never notify.

## Workflows (app-side; `volcanoWorkflows`)

Every stage is `heat T → hold h s (if h > 0) → pump p s`:

| Workflow | Stages (°C / hold s / pump s) |
|---|---|
| Balloon (button `wf-0`) | 170…220 in 5 °C steps, each hold 0 / pump 5 |
| Flow 1 (`wf-1`) | 182/10/10, 192/7/12, 201/5/10, 220/3/10 |
| Flow 2 (`wf-2`) | 175/0/7, 180/0/7, 185/0/7, 190/0/7, 195/0/10 |
| Flow 3 (`wf-3`) | 174/20/8, 199/0/20, 213/0/10, 222/0/10 |

The Balloon popover in `index.html` reuses the "full spectrum… 5 °C steps" text. Its pump times come from `workflow.js`.

How the official app runs a workflow:

1. **Start**: it writes the first target temperature, and after 1000 ms it sends heater **on**. The official code *toggles* the heater from its own idea of the state, so it would switch the heater off if it was already on. Glow's engine should call `setHeater(true)` instead.
2. **Heat**: it polls straight away and then every **1500 ms** until the measured temperature, rounded to whole °C, is in **[target − 1, target + 1)**, so 184 or 185 counts for 185. It only waits and never times out. If the device is hotter than target + 1, it waits for it to cool down. The heater stays on for the whole workflow.
3. **Hold**: a plain delay of `hold` ms, which starts once the temperature is reached. The pump stays **off**, and the temperature is not checked again.
4. **Pump**: pump on for `pump` ms (0 ms would become 500 ms), then pump off.
5. **Next stage**: right after pump off it moves the target on to the next stage. The temperature is written **750 ms** later, and the first temperature check comes **1500 ms** later.
6. **End**: after the last pump, the target stays at the last value, so the temperature check passes at once. The app then stops the workflow: heater **off**, and pump off if it is on. Pressing the button again while a workflow runs does the same stop (heater off, pump off, all timers cleared).

Device-side quirks:

- Heater and pump state come from register 1 notifications (bits `0x20` and `0x2000`).
- The device's own auto shutoff keeps counting during a workflow (register 1 bit `0x200`, remaining time in `1011000c`).
- If vibration is enabled, the device vibrates when it reaches the setpoint. That happens on the device and has nothing to do with the app's ±1 window.
- The pump has no duration on the device side. It runs until it gets "pump off".

## Uncertain / not implemented

- The meaning of the register error bits (`0x4018` in register 1, `0x3B` in register 2) is not documented. The driver does not report them.
- Register reads use up to 4 bytes (Volcano Remote reads 4 bytes; the official app uses only the low 16 bits). Both give the same flags.
- Service `01000002-1989-…` and `10130000-…` appear in the filter but nothing in the app uses them.
- The official auto-shutoff progress bar uses the raw seconds value as a percentage (an app bug). Glow reports the remaining seconds only while register 1 bit `0x200` is set.
- Left out: firmware update (bootloader UART, code `4711`), Analysis (history characteristics) and factory reset (not offered for the Volcano anyway).
