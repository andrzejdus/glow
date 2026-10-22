#!/usr/bin/env bash
# Installs the debug APK on a running emulator and screenshots the connect screen, then the
# VENTY demo's dashboard and settings. Used by .github/workflows/screens.yml.
#   scripts/emulator-shots.sh <output-dir>
set -uo pipefail

out=${1:-shots}
mkdir -p "$out"
pkg=pl.gogoad.glow

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
for p in BLUETOOTH_SCAN BLUETOOTH_CONNECT ACCESS_FINE_LOCATION; do
  adb shell pm grant "$pkg" "android.permission.$p" 2>/dev/null || true
done
adb shell svc bluetooth enable 2>/dev/null || adb shell cmd bluetooth_manager enable 2>/dev/null || true

# Taps the centre of the first on-screen node whose text or description matches.
tap() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || return 1
  adb pull /sdcard/ui.xml "$out/ui.xml" >/dev/null 2>&1 || return 1
  local xy
  xy=$(python3 - "$out/ui.xml" "$1" <<'EOF'
import re, sys, xml.etree.ElementTree as ET
pattern = re.compile(sys.argv[2], re.I)
for node in ET.parse(sys.argv[1]).iter('node'):
    label = (node.get('text') or '') + ' ' + (node.get('content-desc') or '')
    if pattern.search(label.strip()):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
EOF
)
  [ -n "$xy" ] || return 1
  adb shell input tap $xy
}

shot() {
  adb exec-out screencap -p > "$out/$1.png"
}

# Waits until a node matching the pattern is on screen (the emulator's software GPU makes
# the first WebView paint slow).
wait_for() {
  for _ in $(seq 1 ${2:-45}); do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 &&
      adb shell cat /sdcard/ui.xml 2>/dev/null | grep -qiE "$1" && return 0
    sleep 2
  done
  return 1
}

adb shell am start -W -n "$pkg/.MainActivity"
wait_for 'text="(Ready to connect|Looking for|Choose your)' 60 || echo "connect screen did not appear"
sleep 2
shot 1-connect
# A "turn Bluetooth on" or permission dialog may sit in front of the page.
tap '^(deny|cancel|no|don.t allow|not now)$' && sleep 3 && shot 1b-connect

tap '^VENTY$' && wait_for 'HOURS OF OPERATION|Hours of operation' 30 && sleep 3 && shot 2-dashboard
tap '^Settings$' && wait_for 'Auto-connect on open' 15 && sleep 2 && shot 3-settings
adb shell am force-stop "$pkg"
ls -la "$out"
