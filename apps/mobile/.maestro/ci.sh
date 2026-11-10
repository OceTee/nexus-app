#!/usr/bin/env bash
# Runs inside the CI emulator step (.github/workflows/e2e.yml): installs the
# release build, routes the API and MinIO ports to the host, runs the suite.
set -euo pipefail
cd "$(dirname "$0")/.."

adb wait-for-device
# Slow emulators raise "… isn't responding" dialogs for system apps; hide them.
adb shell settings put global hide_error_dialogs 1
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null || true
adb install -r android/app/build/outputs/apk/release/app-release.apk
for port in 4000 9000; do adb reverse "tcp:$port" "tcp:$port"; done

# Airplane mode is fine here (adb runs over the emulator's own channel); the
# fingerprint flow (T-54) stays manual.
suite=0
node .maestro/run.mjs --device emulator-5554 --include emulator-only || suite=$?

# README screenshots (Phase 14), on a fresh install with a tidy status bar
# (Android's demo mode: fixed clock, full battery). They never fail the job;
# the suite's result decides it.
app=com.gladprosper.nexus.development
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null
adb shell pm clear "$app" >/dev/null
for perm in android.permission.POST_NOTIFICATIONS android.permission.READ_MEDIA_IMAGES; do
  adb shell pm grant "$app" "$perm" 2>/dev/null || true
done
for port in 4000 9000; do adb reverse "tcp:$port" "tcp:$port"; done
mkdir -p screenshots
maestro --device emulator-5554 test .maestro/screenshots/capture.yaml ||
  echo "::warning title=Screenshots::The screenshot flow did not finish; see the e2e-results artifact."
adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null || true
# Maestro writes takeScreenshot images into its own results folder.
find "$HOME/.maestro/tests" -path '*takeScreenshot*' -name '*.png' -exec cp {} screenshots/ \;
echo "Screenshots: $(ls screenshots | wc -l) files"

exit "$suite"
