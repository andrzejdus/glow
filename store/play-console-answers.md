# Play Console answers

Ready answers for the Play Console's "App content" and "Store settings" pages, checked against
the code at version 0.1.32. Play rewords its questions now and then, so the wording below is
paraphrased; pick the answer that means the same. `TODO` marks what only the account owner can
fill in.

## Store settings

| Field | Answer |
|---|---|
| App or game | App |
| Free or paid | Free |
| Category | **Tools** (a Bluetooth remote with settings and diagnostics; nothing else fits better) |
| Tags | Up to five from Play's list that describe a Bluetooth remote or device utility, if offered. No tags about smoking, tobacco or lifestyle. |
| Email address | `TODO` (shown publicly on the listing; required) |
| Website | `https://github.com/andrzejdus/glow` |
| Phone number | `TODO` (optional; leave empty unless you want it public) |
| Privacy policy | `https://github.com/andrzejdus/glow/blob/main/PRIVACY.md` (it exists on `main` only after this branch is merged) |
| External marketing | Off is fine; it does not matter for review. |

## Privacy policy

URL above. It covers everything the app stores, the permissions and the one external link; see
[`../PRIVACY.md`](../PRIVACY.md).

## Ads

**No, my app does not contain ads.** No ad or analytics SDK is in `package.json` or
`android/app/build.gradle`, and the CSP in `index.html` (`default-src 'self'`) would block one.

## Advertising ID

**No.** The app declares no `com.google.android.gms.permission.AD_ID` and has no Google Play
services dependency that would add it.

## App access

Glow has no login, but almost everything needs a real device, so give the reviewers the demo:
choose **"All or some functionality is restricted"** and add one set of instructions.

- Name: `Demo mode (no device needed)`
- Username / password: leave empty
- Any other information:

```text
Glow has no account or login. Without a compatible Bluetooth device, use the built-in demo mode:

1. Open Glow. Android may ask to allow "Nearby devices" (Android 12+) or location (Android 11 and older) and to turn on Bluetooth. The demo works whether you allow these or not.
2. At the bottom of the Connect screen, next to "Try without a device:", tap VENTY (a portable device) or VOLCANO (a desktop device with workflows).
3. After about two seconds the dashboard of a simulated device opens; the header says "Demo device". It heats up on its own: use "Heat on", the - / + buttons and the Booster levels.
4. Tabs at the bottom: Control, Workflows (VOLCANO only: tap Flow 1 to run a program) and Settings (every device setting, plus Find My on the VENTY).
5. The back arrow at the top left, or "Disconnect" in Settings, returns to the Connect screen.

The app makes no network requests; it talks only to the device over Bluetooth.
```

Device diagnostics are offered only for the CRAFTY family, which the in-app demo does not
include, so reviewers will not reach the screen in `06-diagnostics.png`; it is real UI for a
connected CRAFTY.

## Content rating (IARC questionnaire)

- Email for the rating certificate: `TODO`
- Category: **All other app types** (the "Utility, productivity, communication or other" kind;
  not a game, not news, not education).

| Section | Answer | Why |
|---|---|---|
| Violence, blood, fear | No | Nothing of the kind in the UI. |
| Sexuality, nudity | No | |
| Language (profanity, crude humour) | No | |
| **Controlled substances (drugs, alcohol, tobacco)** | See below | The one section that touches this app. |
| Gambling, simulated gambling | No | |
| Users can interact or exchange content | No | No chat, accounts or uploads. |
| Shares the user's location with others | No | Location is never read, let alone shared. |
| Digital purchases | No | Free, no in-app purchases. |
| Unrestricted internet / web browser | No | The only link opens the maker's troubleshooting page in the system browser; the app is not a browser. |
| Promotes or sells age-restricted products | No | Nothing is sold or advertised; there is no shop link. |

**Controlled substances.** The questionnaire asks whether the app depicts, references or
encourages the use of drugs, alcohol or tobacco. Glow's own content does not: its screens show
temperatures, battery, hours of operation and device settings, and a search of `src/` for
drug, tobacco and nicotine terms finds nothing (see "Wording in the app" below). What it controls,
though, is a vaporizer, which reviewers may see as a tobacco or cannabis accessory.

- **Answer "No"** (the content of the app is what is rated): likely PEGI 3 / ESRB Everyone /
  USK 0. Accurate for the screens, but if a Play reviewer decides the device itself counts as a
  reference, Google can override the rating or ask for the questionnaire again.
- **Answer "Yes, references to tobacco" only, no use, no encouragement** (conservative):
  likely PEGI 12–16 / ESRB Teen / USK 12–16. It costs nothing for an app whose target audience is
  18+ anyway, and it removes a mismatch Google could act on later.

Recommendation: the conservative answer, since the target audience is 18+ either way. Answer
"No" to every question about *use* or *encouragement*, which is accurate in both cases. If the
user prefers the first option, keep the screenshots and listing text exactly as they are (they
show only temperatures and settings).

## Target audience and content

- Target age groups: **18 and over only**.
- Could the app or listing unintentionally appeal to children: **No** (no characters, games or
  cartoons; a device remote with temperatures and settings).
- Not in the Designed for Families programme. Both listings say Glow is intended for adults,
  and `PRIVACY.md` says it is not directed at children.

## Data safety

**Does your app collect or share any of the required user data types? No.**

With "No", Play shows "No data collected" and "No data shared", and the follow-up questions
(encryption in transit, deletion requests) do not apply. Play counts data as *collected* only
when it is sent off the device, and Glow sends nothing:

| Data the app touches | Where it goes | In the code |
|---|---|---|
| Last device: Bluetooth address, name, model; the auto-connect setting | App storage on the phone only | `save('connection', …)` in `src/lib/connection.svelte.ts`, through `@capacitor/preferences` in `src/lib/prefs.ts` |
| Hours-of-operation snapshots (device counter + time, up to 400 days) | App storage on the phone only | `save('usage:<device>', …)` in `src/lib/usage.svelte.ts` |
| Device settings and live readings | Read from and written to the device over Bluetooth; not stored | `src/lib/devices/` |
| Diagnostics change log | Memory while the screen is open; to the clipboard only on "Copy log" | `src/screens/Diagnostics.svelte` |
| Other Bluetooth devices seen in a scan | Dropped at once unless the name matches a supported model | `src/lib/ble/native-adapter.ts` |
| Location | Never read; the permission exists only because Android 11 and older require it for scans | `AndroidManifest.xml` (`maxSdkVersion="30"`) |

Network: the CSP in `index.html` allows only `'self'`, fonts are bundled from
`@fontsource-variable/roboto-flex`, and there are no analytics, crash reporting or remote
config dependencies. The "Can't connect?" link opens a web page in the user's browser on tap;
that is the user visiting a website, not the app sending data.

One thing to know: the manifest has `android:allowBackup="true"`, so Android's own Auto Backup
may copy Glow's storage into the user's Google account backup if the user has device backup on.
That is Android's backup, not data the developer receives, and Play's guidance does not count it
as collection by the app. `PRIVACY.md` says so in plain words. If you want no doubt at all, set
`allowBackup="false"` (a code change, not made here), at the cost of the history not moving to a
new phone.

Security practices on the form: data encrypted in transit does not apply (nothing is sent);
"users can request deletion" does not apply (nothing is collected); clearing the app's storage or
uninstalling removes everything. No independent security review.

## Permissions and declarations

| Permission (manifest) | Play declaration needed | Note |
|---|---|---|
| `BLUETOOTH_SCAN` (`neverForLocation`), `BLUETOOTH_CONNECT` | None | Shown to users as "Nearby devices". |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `maxSdkVersion="30"` | None | Foreground only, Android 11 and older only, for Bluetooth scans. There is no `ACCESS_BACKGROUND_LOCATION`, so the location-permissions declaration does not come up. If a reviewer asks: "Required by Android 11 and older to scan for Bluetooth LE devices; the app never reads or stores the location." |
| `VIBRATE` | None | Haptic tap feedback (`@capacitor/haptics`). |
| `INTERNET` | None | The WebView needs it; the CSP blocks all requests. |

No foreground service, exact alarms, accessibility service, SMS, call log, contacts, photos or
files permissions, so none of those declarations apply.

## Other App content items

| Item | Answer |
|---|---|
| Government app | No |
| Financial features | My app does not provide any financial features |
| Health | My app does not have any health features |
| News app | No |

## Policy notes

- **Regulated products.** Play does not allow apps that facilitate the sale of tobacco, e-cigarette
  or cannabis products, or that encourage their inappropriate use. Glow sells nothing, links to
  no shop and never names a substance; it is a remote for a device's heater and settings. Keep
  it that way in release notes and replies to reviewers too.
- **Intellectual property.** The title, icon and feature graphic carry no maker brand. Model
  names are in the full description only, as compatibility, with the disclaimer.
- **Before production**, a personal developer account created after November 2023 has to run a
  closed test with at least 12 testers for 14 days, and Play wants an Android App Bundle
  (`./gradlew bundleRelease`, not the APK the release workflow builds now), signed with an upload
  key under Play App Signing.

## Wording in the app

A search of `src/` for drug, tobacco and nicotine terms, "smoke", "dose", "inhale", "vape" and
similar finds nothing. Things a strict reviewer could still pick on, none of them changed here:

1. **Connect screen** (`src/screens/Connect.svelte`): the app name is subtitled "for STORZ &
   BICKEL devices", and the "Can't connect?" link points to storz-bickel.com. Accurate, but it is
   the maker's brand on the first screen, which invites an impersonation or trademark look. The
   store screenshots leave this screen out for that reason.
2. **Device drawings** (`src/components/Glyph.svelte`): the Connect screen draws the devices,
   redrawn from product photos. Fine as compatibility pictures, but they are the maker's product
   designs; also left out of the store graphics.
3. **Usage statistics** (`src/components/HoursCard.svelte`): "Hours of operation" with "Session",
   "Avg per month" and "this month +4 h 12 min" read as a device hour meter, which is what they
   are; a reviewer primed on the device type could read them as consumption tracking. The listing
   calls them hours of operation only.
4. **"Balloon" workflow** (`src/lib/devices/volcano.ts`): the maker's own name for one VOLCANO
   program; visible in `03-workflow-running.png`. The listing says "built-in step programs" instead.
5. **Model names in the header** (`src/components/Header.svelte`): every dashboard screenshot shows
   the connected model ("VENTY", "CRAFTY+", "VOLCANO HYBRID"). That is the app working as described;
   worth knowing because the trademark rule for the listing stops at the description.
