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
node .maestro/run.mjs --device emulator-5554 --include emulator-only
