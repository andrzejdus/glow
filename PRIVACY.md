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
- **The "Auto-connect on open" and "Debugging from a computer" settings.**
- **Hours-of-operation history**: readings of the device's own lifetime operating counter, with
  the time of each reading (at most two an hour), kept for up to 400 days. Glow uses them to
  show the usage per month.

The device's own settings (temperatures, brightness and the rest) are read from and written to
the device itself; Glow does not keep a copy. The diagnostics change log exists only while the
diagnostics screen is open, and is copied to the clipboard only when you tap "Copy log".

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
