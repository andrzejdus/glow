# CRAFTY / CRAFTY+ BLE protocol

Driver: `src/lib/devices/crafty.ts`. Derived from the official STORZ & BICKEL web app v3.4.1
(`crafty.js`, `main.js`, `index.html`). Cross-checked against
[storz-rs](https://github.com/flakesonnix/storz-rs) (`src/protocol/crafty.rs`) and
[xythobuz/Volcano-Remote](https://github.com/xythobuz/Volcano-Remote) (`src/crafty.c`): both agree
on the service/characteristic UUIDs, little-endian uint16 values, °C × 10 temperatures and the
two-byte zero write to heater on/off. Neither documents charging state (see Charger below).

## Discovery

- Advertised name prefixes the official app filters on: `STORZ&BICKEL` (original CRAFTY) and
  `Storz&Bickel` (newer units). `S&B` is also in the filter list but belongs to VOLCANO (`S&B VOLCANO`),
  VENTY (`S&B VY`) and VEAZY (`S&B VZ`); the official app treats *any other* name as a CRAFTY.
  Glow only claims `STORZ&BICKEL` (case-insensitive).
- CRAFTY vs CRAFTY+ is not in the name: the official app decides by firmware major version ≥ 3.

## UUIDs

All UUIDs are `0000xxxx-4c45-4b43-4942-265a524f5453`; the table gives `xxxx`.

| Service | Char | Name | Access | Payload |
|---|---|---|---|---|
| 0001 | 0011 | Current temperature | read, notify | uint16 LE, °C × 10 |
| 0001 | 0021 | Target temperature | read, write | uint16 LE, °C × 10 |
| 0001 | 0031 | Boost offset | read, write | uint16 LE, °C × 10 (offset above target) |
| 0001 | 0041 | Battery | read, notify | uint16 LE, percent |
| 0001 | 0051 | LED brightness | read, write | uint16 LE, 0–100 (UI step 10) |
| 0001 | 0061 | Auto shutoff setting | read, write* | uint16 LE, seconds (UI 30–300, step 30) |
| 0001 | 0071 | Auto shutoff remaining | read, notify | uint16 LE, seconds |
| 0001 | 0081 | Heater on | write | `00 00` |
| 0001 | 0091 | Heater off | write | `00 00` |
| 0002 | 0032 | Firmware | read | UTF-8, e.g. `V02.51` |
| 0002 | 0052 | Serial number | read | UTF-8, first 8 chars used |
| 0002 | 0072 | BLE firmware | read | 3 bytes → `V{b0}.{b1}.{b2}` |
| 0003 | 0023 | Hours of operation | read | uint16 LE, hours |
| 0003 | 01e3 | Minutes of operation | read | uint16 LE, minutes (added to hours) |
| 0003 | 0093 | Project status register | read, notify | uint16 LE bit field (below) |
| 0003 | 01c3 | Project status register 2 | read, write, notify | uint16 LE bit field (below) |
| 0003 | 01b3 | Security code | write | uint16 LE unlock code |
| 0003 | 0083 | System status | read | uint16 LE (analysis only) |
| 0003 | 0063 | Battery status | read | uint16 LE (analysis only) |
| 0003 | 0073 | Battery status 2 | read | uint16 LE (analysis only) |
| 0003 | 01d3 | Factory reset | write | uint8 `00` after code 1000 (not implemented) |

\* The auto shutoff write must be preceded by writing **815** (`2f 03`) to the security code
characteristic. Factory reset uses code **1000**.

The official app uses Web Bluetooth `writeValue`, i.e. write with response; Glow does the same.
storz-rs writes without response, so the device seems to accept both.

## Temperatures

- Target range in the app: 40–210 °C. Values are rounded to whole degrees.
- If a target read decodes above 210, the official app treats it as °F and converts
  (`(F − 32) / 1.8`). Glow copies that heuristic.
- Boost offset range 1–99 °C, and the app keeps target + boost ≤ 210 by lowering the boost.
  Whenever the target is written, the app writes the boost offset right after it (Glow does too).
- Superboost (CRAFTY+) is target + boost + **15 °C**, fixed; the app cannot change the 15.
  Glow reports it as `superBoostOffset = boostOffset + 15`, CRAFTY+ only.
- The CRAFTY has no display, so there is no display unit to read; `unit` stays unset.

## Bit fields

Project status register (`0093`):

| Bit | Meaning |
|---|---|
| 0, 2 | Came on with the heater (with bit 4) on a CRAFTY+ V03.24 and did not follow the LED; J-Cat/crafty-control and lfuelling/sbcontrol call bits 0+2 "heating" |
| 4 | Heater active |
| 5 | Boost mode |
| 6 | Superboost mode (wins over bit 5) |
| 8 | **LED green** (ready). Not in the official app; found with Glow's diagnostics, see below, and used the same way by gsasouza/sb-crafty-watch-os (`0x0415` heating, `0x0515` reached). Glow's "Ready" on current firmware |
| 10 | Already on with the heater off (`0x0400`) on a CRAFTY+ V03.24; meaning unknown |
| 3, 13 (`0x2008`) | Error flags (trigger the app's analysis) |
| 15 | Factory reset recommended |

Project status register 2 (`01c3`), changed by read-modify-write of the cached value, then read back:

| Bit | Meaning |
|---|---|
| 0 | Vibration **disabled** |
| 1 | Charge indicator LED **disabled** |
| 2 | Target temperature reached (status, the app turns the reading green). On a CRAFTY+ V03.24 only on for ~4 s when the target is first hit, so it is not the LED; Glow uses it only on legacy firmware |
| 7 | Came on with bit 2 when the target was first hit and stayed on (observed, meaning unknown) |
| 3 | Find My CRAFTY active (set to start; the device clears it after ~30 s) |
| 12 | Permanent Bluetooth (the official code calls it `ENABLE_AUTOBLESHUTDOWN`, but the UI and the analysis text show set = Bluetooth always on) |

## Connect sequence (official app)

1. Read target temperature (`0021`).
2. Read serial (`0052`).
3. Subscribe to current temperature (`0011`), then read it.
4. Read boost offset (`0031`).
5. Read firmware (`0032`). *Legacy* = minor < 51 and major ≤ 2 (e.g. `V02.37`): no Settings tab,
   no heater control, no BLE firmware, no auto shutoff, no minutes counter, no project-register
   notifications. Major ≥ 3 → CRAFTY+ (Find My, factory reset).
6. Subscribe to status register 2 (`01c3`), then read it.
7. Read hours (`0023`), and minutes (`01e3`) unless legacy.
8. Read BLE firmware (`0072`) unless legacy.
9. Read LED brightness (`0051`).
10. Unless legacy: read auto shutoff (`0061`), subscribe to and read remaining time (`0071`).
11. Subscribe to battery (`0041`), then read it.
12. Subscribe to the project status register (`0093`) unless legacy, then read it.
13. Unless legacy: read system and battery status registers; on error flags, run the analysis.

The official app keeps one GATT operation in flight at a time; Glow puts every operation in one queue.

## Mapping to Glow

- `setHeater` → `0081` / `0091`, refused on legacy firmware (`capabilities.heaterToggle` false there).
- `setMode` cannot be done: the official app has no write for boost mode, the button on the device
  switches it. The driver exposes `modeSwitchable: false`; `setMode` resolves only for the current mode.
- `setBoostOffsets(boost)` → `0031`. `capabilities.superBoost` is false (fixed offset).
- Settings: `permanentBluetooth` (connection), `chargeIndicator` (battery), `vibration`,
  `ledBrightness`, `autoShutoff` (device). Legacy firmware hides `permanentBluetooth` and `autoShutoff`.
- `findMyDevice` → set bit 3 of `01c3` unless already set; CRAFTY+ only.
- `refresh()` re-reads target, boost, hours/minutes, LED brightness, auto shutoff, battery, and on
  legacy firmware the project status register.

## Unsure / not implemented

- **Charging**: the official app shows only the battery percentage; no charging flag is decoded.
  Its battery status bits (`0063`, `0073`) are only used for analysis messages (`0x0003` = charge
  the device, `0x4100` = let it cool down, `0x0200` error, `0x8000` in register 2 = use another
  charger). Glow found its own charger bit (see Charger) and uses `0x4100` (see Battery too hot).
- The legacy-firmware check is the official one verbatim; it misclassifies e.g. `V01.60` as non-legacy.
- Whether the original CRAFTY (firmware 2.x) ever sets the superboost bit is unknown.
- Left out on purpose: firmware update, factory reset, analysis.

## Charger

Not documented anywhere; found with Glow's Device diagnostics on a CRAFTY+ (firmware V03.24,
BLE V2.0.3, battery 99–100 %), pulling the charger out and plugging it back in. These bits all
changed together, within the same 1 s reading:

| Register | Unplugged | Plugged in | Bits |
|---|---|---|---|
| Battery status `0063` | `0x0050` | `0x80d4` | 2, 7, 15 |
| Battery status 2 `0073` | `0x0000` | `0x2000` | 13 |
| System status `0083` | `0x2404` | `0x2405` | 0 |

Glow reads battery status bit 7 as "charger connected", polled every 3 s (the register is not
notified), current firmware only. Battery % moved 99 → 100 a few seconds after plugging in.
Still open: whether one of these bits means "charging" rather than "charger connected", i.e. drops
when the battery is full; this test ran at 99–100 %, so it cannot tell.

## LED

Recorded on a CRAFTY+ (V03.24) heating to 190 °C with Glow's Device diagnostics, the user tapping
Mark at each LED change (green, red, green, red, green between 187 and 189 °C):

- Project status bit 8 switched on after each green mark and off after each red one, 4–8 s later
  every time; no other bit followed the LED. The lag is unexplained (the screen polls every 1 s).
- Project status 2 bit 2 (the official app's "reached") came on at 191 °C together with bit 7 and
  was off again 4 s later, while the LED stayed green.
- The LED is not a fixed threshold on the reported temperature: the marks were at 187–189 °C for
  both colours.
- Battery status (`0063`) bit 5 came on with the heater and went on and off near the target, close
  to but not in step with the LED; likely heater power.

## Auto-off

The official app names `0061` `characteristicautoOffCountdown` but uses it as the setting: it reads
it once, on connect, into the auto-off slider. Glow does the same. `0071` (notified) is the time
left.

CRAFTY+ V03.24, Device diagnostics through a whole heating session (0.1.40):

- `0061` stayed at 210 s from heater on to heater off. It does not count down. The setting Glow
  showed had dropped (5 to 4 min) because a scroll that started on the slider moved it (fixed in
  0.1.41), and 210 s showed as "4 min".
- `0071` starts at the setting when the heater comes on and restarts at the setting on each draw
  (172 → 210 s and 182 → 210 s, at the user's inhales), so the auto-off counts from the last draw.

CRAFTY+ V03.24, every notification recorded over adb in two heating sessions (0.1.42, 0.1.43):

- `0071` is notified every ~2.4 s, also while it does not change. While heating up, and after a
  draw cools the chamber below the target, it repeats the setting; it counts down only near the
  target.
- It starts counting up to ~1.5 s before status bit 8 (ready) is set, and it resets to the setting
  ~1 s before that bit clears at a draw.
- Its seconds are short: 195 counted in 188 s, 59 in 57 s (about 3–4 %).
- Lowering the setting while counting cuts the time left at once (202 → 179 → 118 s, by the values
  as the slider passed 3 min on its way to 2); the next draw restarts at the new setting.
- At heater off it sends 0 about 1 s before the status does. After a session ended it was seen
  counting down again from 206 s with the heater off.

## Other characteristics

Not in the official app; three clients (J-Cat/crafty-control, duramson/vo0t, lfuelling/sbcontrol)
name them alike. Glow shows them in Device diagnostics; the ranges below are from one CRAFTY+
V03.24 session that started on the charger at 100 %, then unplugged and heated to 190 °C:

| Char | Reported meaning |
|---|---|
| `00a3` | charging status. Seen: 2 on the charger (at 100 %, still taking 483 mA), 0 off it |
| `00b3` | battery voltage, mV. Seen: 4180 on the charger at 100 %, about 3070–3100 under the heater's load, 3817 at rest at 73 %. Glow shows it in Settings when it is 2.5–4.5 V |
| `00c3` | mains voltage, mV. Seen: 4974 on the charger; off it not 0 but 281–675, rising as the device heated |
| `00e3` | battery current, mA, signed: positive charges, negative drains. Seen: +483 on the charger at 100 %, −2000 to −7100 while heating, 0 with the heater off. Glow shows its size in Settings when it is at most 10 A |
| `0113` | battery temperature, °C × 10 (below) |
| `0123`, `0133` | lowest and highest battery temperature, °C × 10 (below) |

The same clients subscribe to battery status `0063`. Glow subscribes too and counts the pushes in
Device diagnostics. A CRAFTY+ pushed it when the charger came out and when bit 5 (heater power)
changed: 7 pushes in the session. A push when the charger goes in has not been seen yet, so the
3 s poll of `0063` stays.

On the phone one pass over these 13 registers took about 8–13 s, so Device diagnostics sees a
change up to that late, not within a second. The three battery temperatures (below) make the pass
longer still. That is the time each read takes, not spacing in Glow's queue: in a logcat of
2026-11-05 (CRAFTY+ V03.24, ~4100 reads) a read took 0.39 s from the call to its answer (median;
0.32 s at the 10th percentile), and answers land on a 0.4 s grid while notifications land on a 0.2 s
one, so the link runs at a ~200 ms connection interval and a read takes two of them. Notifications
do not wait for reads: `0011` came every ~2.6 s whether or not a read was in flight.

## Battery temperature

Three more characteristics in service `0003` that the official app does not read. duramson/vo0t,
joaorafaelm/crafty and NopeNix/ESP32-Crafty-Control all name them the battery temperature and its
minimum and maximum, read like the other temperatures: uint16 LE, °C × 10.

| Char | Meaning |
|---|---|
| `0113` | battery temperature |
| `0123` | lowest battery temperature (since when is unknown) |
| `0133` | highest battery temperature (since when is unknown) |

The only value seen so far is from vo0t's published diagnostics of a CRAFTY+: 27.9 °C (`17 01`).

Glow reads `0113` on connect, with `refresh()` (every ~30 s) and, while the heater is on, with the
battery poll (below), and reports it as `batteryTemp` with one decimal. It decodes it as signed, so a battery
below 0 °C would come out right, and ignores `0xffff` and anything outside −40…100 °C. If the first
read fails (firmware without the characteristic), Glow does not ask again until the next connection.
Device diagnostics shows all three in °C with the raw value in hex next to it.

Open: not yet seen on our own CRAFTY+ (V03.24); whether the original CRAFTY has these characteristics;
whether `0123` / `0133` cover the battery's life, a charge or a session.

## Battery too hot

The official app tells the user to let the device cool down when battery status `0063` has bit 8 or
bit 14 set (mask `0x4100`). Glow reports that as `batteryHot`, from the same reads and pushes as the
charger bit (current firmware only).

duramson/vo0t reads the same register differently: `0x0400` (bit 10) a battery temperature warning
and `0x3000` (bits 12–13) "overheating, let it cool down". The two readings do not agree, and none of
these bits has been seen set on our CRAFTY+ (V03.24). Glow follows the official app; Device
diagnostics shows `0063` bit by bit, so the bit that actually comes on when the battery gets hot can
be checked there. No "too cold" flag is known.

## Battery poll and capacity

While the heater is on, the app calls `pollBattery()` every ~2 s: it reads voltage `00b3` and
current `00e3`, and every ~5 s battery temperature `0113` too, for the session log; the 3 s charger
poll then reads only `0063`. With the heater off the charger poll reads voltage and current as
before (on screen only). The session log keeps one battery sample every 5 s as before, now the
time-weighted mean of the readings since the sample before (voltage, current, and the mean of
voltage × current as the power), plus the lowest current and power read, for the true peak. Up to
0.1.76 it kept a single reading every 5 s.

The cadence is what the link allows. Each read takes ~0.4 s (above), so voltage and current take
~0.8 s of every 2 s: with the charger poll (one read every 3 s), the battery temperature (every 5 s)
and the 30 s refresh (ten reads) the link is busy about three quarters of the time while heating,
against about half with the 5 s poll. Every second would need more than the link has. Polls wait
behind commands in the driver's queue, so a target, heater or setting change waits at most for the
one read in flight (~0.4 s); a round still waiting is skipped, not queued again. The background
recorder (`Recorder.java`) does the same reads with the heater on, only when nothing else is waiting,
and logs a `P` line after each round, on which the replay calls `pollBattery()`; it reads `0113` and
`0153` on connect and with its refresh too. Device diagnostics had read registers back to back
(~2.5 reads a second) through whole heating sessions before, with no dropped link or late
notifications seen.

Five more characteristics in service `0003` that the official app does not read. J-Cat/crafty-control
and duramson/vo0t name them so and read them as uint16 LE; vo0t's published CRAFTY+ diagnostics show
1931 / 3300 / 3300 mAh and 42 charge cycles.

| Char | Reported meaning |
|---|---|
| `0143` | full capacity, mAh |
| `0153` | remaining capacity, mAh |
| `0183` | design capacity, mAh |
| `0163` | discharge cycles |
| `0173` | charge cycles |

Device diagnostics shows all five, the capacities in mAh and the cycles as counts. Glow reads `0153`
on connect and with `refresh()` and reports it as `batteryCapacity` (0, `0xffff`
and anything above 20 Ah ignored; a first read that fails stops further reads until the next
connection). The session log keeps it at the start and at the end of each session, to compare the
device's own count with the current Glow adds up.

Glow also reads `0143` (full capacity), `0183` (design capacity) and `0173` (charge cycles) on
connect and with `refresh()`, never in the heating poll, and reports them as `batteryCapacityFull`,
`batteryCapacityDesign` and `batteryCycles` for the Settings battery card, so a new cell can be
watched while the gauge relearns it. The capacities follow the rules for `0153`; the cycle count
ignores `0xffff` and anything above 10000. Each of the three that fails on its first read is not
asked again until the next connection. `0163` (discharge cycles) stays in Device diagnostics only.

What the CRAFTY+ (V03.24) can push, from its GATT properties (read on the phone, 2026-11-05): in
service `0003` only `0013`, `0023`, `0063`, `0093`, `01c3` and `01e3` notify. Battery voltage
(`00b3`), current (`00e3`), battery temperature (`0113`) and the capacities (`0143`, `0153`) are
read-only, so a finer battery record has to poll them. `0183` (design capacity) and `0193` are also
writable; Glow never writes them.

The current scale is mA as read, checked on our CRAFTY+ (V03.24, Glow 0.1.76, 2026-11-05): a
230 s session to 190 °C on battery took `0153` from 1403 to 1134 mAh (−269), and `00e3` read every
5 s adds up to 312 mAh (1.12 Wh). The 16 % gap is the 5 s steps against a heater current that jumps
between 0 and about −8 A (seen −8069 mA at 3.53 V, ~28 W): steady at ~−8 A for the 80 s heat-up,
then, holding, readings 5 s apart that look unrelated (0, −5811, −7999, −3945, −632…), so the
switching is faster than 5 s; its period is not known. The in-between values suggest `00e3` is
itself averaged over a short time. On a made-up current switching every 0.5–4 s, 5 s readings add up
~9–10 % off on average (up to ~20–30 %), 2 s means ~3 % and 3 s means ~4–5 % (`sessions.test.ts`
and a simulation over 200 sessions); to be checked against `0153` on the device. `0113` went 31.5 → 38.6 °C in the same
session. Open: whether older firmware has these characteristics; why `0153` read only 1403 mAh at
98 % (vo0t's CRAFTY+ showed a 3300 mAh design capacity).
