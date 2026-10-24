# Glow privacy policy

Effective 24 October 2026.

Glow (package `pl.gogoad.glow`) is a free, open-source Bluetooth remote for compatible
heating devices, published by its developer at [github.com/andrzejdus/glow](https://github.com/andrzejdus/glow).
This policy covers the Android app.

## In short

Glow collects no personal data and shares nothing with anyone. It has no account, server,
advertising, analytics or crash reporting. It talks to your device over Bluetooth and keeps the
little it needs on your phone.

## What stays on your phone

Glow saves this in its own private app storage on the phone:

- **The device you last connected to**: its Bluetooth address, its name and its model, so Glow
  can reconnect to it when you open the app.
- **The "Auto-connect on open", "Record in the background" and "Debugging from a computer"
  settings**, and for "Record in the background" the device it records: its Bluetooth address,
  name and model.
- **Hours-of-operation history**: readings of the device's own lifetime operating counter, with
  the time of each reading (at most two an hour), kept for up to 400 days. Glow uses them to
  show the usage per month.
- **Session log**: for each time the heater was on while Glow was connected (or recording in the
  background, see below), when it started and
  ended, the target and the device's temperature every few seconds (from ten seconds before the
  heater came on until it has cooled down, for at most two minutes after), when it was ready, the heat
  level used, air on and off (VOLCANO), the battery level at the start and the end, and the Glow
  version that recorded it. Kept until you clear Glow's storage. Glow uses it for the Stats screen.
- **Background log**, only while "Record in the background" is on: what the device reported over
  Bluetooth (temperatures, heater and battery state, its settings registers, its operating
  counter), from 15 seconds before the heater came on until two minutes after it went off, while
  Glow was closed. The next time Glow connects to the device it turns the log into sessions and
  hours of operation, then deletes it. Switching the setting off deletes it too.
- **Reheats**: for the last 12 times the device lost Ready while heating (after a draw) and got it
  back, how long that took, and how many degrees below the target it was from the lowest point
  until Ready, about once a second. Glow uses them, and the session log, to show how long until
  the device is ready.

The device's own settings (temperatures, brightness and the rest) are read from and written to
the device itself; Glow does not keep a copy. The diagnostics change log exists only while the
diagnostics screen is open, and is copied to the clipboard only when you tap "Copy log".

"Record in the background" is off unless you turn it on in Settings. Turning it on asks Android to
associate Glow with that one device (Android's own "Allow Glow to manage …?" dialog). From then on,
Android tells Glow when the device comes into Bluetooth range, even while Glow is closed, and Glow
connects to it and records as described above, with a notification showing while it does. Turning
the setting off removes the association.

"Debugging from a computer" is off unless you turn it on in Settings. While it is on, a computer
that you have allowed to debug your phone (Android's USB or wireless debugging, in Developer
options) can look inside Glow, including the storage listed above, and read its log. Glow sends
nothing anywhere itself.

None of this leaves the phone through Glow. If you have turned on Android's own backup for your
phone, Android may include Glow's storage in that backup, which is kept in your Google account
under Google's terms; the developer has no access to it.

To delete it, clear Glow's storage in Android's app settings, or uninstall the app.

## No network

Glow makes no network requests. Its interface is built into the app, including its fonts, and
its Content-Security-Policy blocks every request to the internet. Android only grants the
Internet permission because the system WebView that draws the interface needs it to start.

The "Can't connect?" link on the Connect screen opens the device maker's troubleshooting page in
your web browser. That only happens when you tap it, and that website's own privacy policy then
applies.

## Permissions

| Permission | Why |
|---|---|
| Nearby devices (Bluetooth scan and connect), Android 12 and newer | To find your device and talk to it. Glow declares that it never uses Bluetooth scans to work out your location. Other Bluetooth devices seen during a scan are ignored and not kept. |
| Location (approximate and precise), Android 11 and older only | Those Android versions allow Bluetooth scans only with location access. Glow never reads your location, asks for it only while the app is open, and never in the background. |
| Companion device: device presence, running and starting in the background (Android 12 and newer) | Only after you turn on "Record in the background" and allow Android's dialog: Android then tells Glow when that one device comes into range, and lets Glow start its recorder while Glow is closed. |
| Foreground service (connected device) | The background recorder runs as a foreground service, with a notification, while it is connected to the device or waiting for it. |
| Notifications, Android 13 and newer | To show that notification. Glow asks when you turn on "Record in the background", and shows no other notifications. |
| Vibration | A short tap of feedback when you press a control. |
| Internet | Needed by the system WebView to start; Glow itself sends nothing (see above). |

## Children

Glow is meant for adults and is not directed at children.

## Changes

If this policy changes, the new version is published at this address with a new effective date.
The history of every change is in the repository.

## Contact

Questions or requests: open an issue at
[github.com/andrzejdus/glow/issues](https://github.com/andrzejdus/glow/issues).

Glow is not made, endorsed or supported by STORZ & BICKEL.
